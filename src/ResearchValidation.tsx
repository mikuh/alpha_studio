import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Clock3,
  FileInput,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react';
import { fetchEastmoneyRealtimeBatch } from './eastmoney';
import { fetchJqHistoricalBars, loadJqDataConfig } from './jqdata';
import {
  AUTOMATION_TASKS_CHANGED_EVENT,
  addScheduledAutomationTask,
  detectAutomationIntent,
  loadScheduledAutomationTasks,
  saveScheduledAutomationTasks,
} from './automation';
import {
  ALPHA_STUDIO_INTRADAY_MONITOR_SKILL_ID,
  ALPHA_STUDIO_INTRADAY_MONITOR_SKILL_TITLE,
  INTRADAY_MONITOR_CARD_PROMPT,
} from './themeAbilities';
import { useChatStore } from './store';
import type { ResearchQuote } from './research';
import {
  PREMARKET_THEME_IMPORT_EVENT,
  PREMARKET_THEME_RUNS_CHANGED_EVENT,
  extractLegacyPremarketThemeDraft,
  loadPremarketThemeRuns,
  parsePremarketThemeResult,
  savePremarketThemeRun,
  savePremarketThemeRuns,
  type PremarketThemeRun,
  type PremarketThemeTrigger,
} from './themeResearch';
import {
  DEFAULT_THEME_BACKTEST_CONFIG,
  TRIGGER_STATUS_LABELS,
  THEME_TRACKING_CHANGED_EVENT,
  THEME_REVIEWS_CHANGED_EVENT,
  createDailyReview,
  evaluateThemeTrigger,
  hydrateThemeValidationFromLocalStore,
  loadThemeBacktestRuns,
  loadThemeReviews,
  loadThemeTrackingEvents,
  mergeTrackingEvaluations,
  overrideTrackingEvent,
  runThemeBacktest,
  eligibleOpenReports,
  selectBacktestCandidate,
  saveThemeBacktestRun,
  saveThemeReviews,
  saveThemeTrackingEvents,
  type BacktestCurvePoint,
  type BacktestPriceBar,
  type ThemeBacktestConfig,
  type ThemeBacktestRun,
  type ThemeDailyReview,
  type ThemeTrackingEvent,
  type TriggerEvaluationStatus,
} from './themeValidation';
import { loadLocalStoreSnapshot } from './localStore';

type ValidationView = 'monitor' | 'review' | 'backtest';

const VIEW_LABELS: Record<ValidationView, string> = {
  monitor: '实时监控',
  review: '收盘复盘',
  backtest: '策略回测',
};

const IMPORTANT_TRIGGER_STATES = new Set<TriggerEvaluationStatus>(['triggered', 'upgraded', 'invalidated']);
const THEME_SYSTEM_NOTIFICATIONS_KEY = 'alpha-studio.theme-system-notifications.v1';

function latestByTrigger(events: ThemeTrackingEvent[], reportId: string): Map<string, ThemeTrackingEvent> {
  const map = new Map<string, ThemeTrackingEvent>();
  const sorted = events
    .filter((event) => event.reportId === reportId)
    .sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  for (const event of sorted) map.set(event.triggerId, event);
  return map;
}

function formatDateTime(value: string): string {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed)
    ? new Date(parsed).toLocaleString('zh-CN', { hour12: false })
    : value || '未知';
}

function shanghaiTradeDate(value = new Date()): string {
  return value.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
}

function formatPercent(value: number): string {
  const prefix = value > 0 ? '+' : '';
  return `${prefix}${value.toFixed(2)}%`;
}

function reportCodes(report: PremarketThemeRun | null): string[] {
  if (!report) return [];
  return Array.from(new Set(report.themes.flatMap((theme) => theme.stocks.map((stock) => stock.code).filter((code): code is string => Boolean(code)))));
}

function reportQuoteMap(report: PremarketThemeRun, prices: Awaited<ReturnType<typeof fetchEastmoneyRealtimeBatch>>['prices']): Map<string, ResearchQuote> {
  const stocks = new Map(report.themes.flatMap((theme) => theme.stocks).filter((stock) => stock.code).map((stock) => [stock.code as string, stock]));
  const quotes = new Map<string, ResearchQuote>();
  for (const [code, live] of prices) {
    const stock = stocks.get(code);
    const prevClose = live.prevClose && live.prevClose > 0 ? live.prevClose : live.price;
    quotes.set(code, {
      code,
      name: stock?.name || code,
      board: code.endsWith('.XSHG') ? '沪市' : '深市',
      sector: report.themes.find((theme) => theme.stocks.some((item) => item.code === code))?.name || '报告标的',
      price: live.price,
      prevClose,
      changePct: prevClose > 0 ? (live.price / prevClose - 1) * 100 : 0,
      changeAmt: live.price - prevClose,
      open: live.open,
      high: live.high || live.price,
      low: live.low || live.price,
      volume: (live.volumeShares || 0) / 1_000_000,
      turnover: (live.turnoverAmount || 0) / 100_000_000,
      marketCap: (live.marketCapAmount || 0) / 100_000_000,
      volumeShares: live.volumeShares,
      turnoverAmount: live.turnoverAmount,
      turnoverRate: live.turnoverRate,
      volumeRatio: live.volumeRatio,
      highLimit: live.highLimit,
      lowLimit: live.lowLimit,
      paused: live.paused,
      tags: [],
      thesis: '',
      source: 'eastmoney',
    });
  }
  return quotes;
}

function toBacktestBars(bars: Awaited<ReturnType<typeof fetchJqHistoricalBars>>): BacktestPriceBar[] {
  return (bars ?? []).map((bar) => ({
    time: bar.time,
    open: bar.open,
    close: bar.close,
    high: bar.high,
    low: bar.low,
    volume: bar.volume,
    money: bar.money,
    paused: bar.paused,
    highLimit: bar.highLimit,
    lowLimit: bar.lowLimit,
  }));
}

export function ResearchValidationPanel() {
  const [view, setView] = useState<ValidationView>('monitor');
  const [reports, setReports] = useState<PremarketThemeRun[]>(() => loadPremarketThemeRuns());
  const [selectedReportId, setSelectedReportId] = useState(() => reports[0]?.id || '');
  const [events, setEvents] = useState<ThemeTrackingEvent[]>(() => loadThemeTrackingEvents());
  const [reviews, setReviews] = useState<ThemeDailyReview[]>(() => loadThemeReviews());
  const [backtestRuns, setBacktestRuns] = useState<ThemeBacktestRun[]>(() => loadThemeBacktestRuns());
  const [dataAsOf, setDataAsOf] = useState<string>('');
  const [dataError, setDataError] = useState<string>('');
  const [refreshing, setRefreshing] = useState(false);
  const [importMessage, setImportMessage] = useState('');
  const [pendingImport, setPendingImport] = useState<PremarketThemeRun | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const currentConversationId = useChatStore((state) => state.currentConversationId);
  const [automationTasks, setAutomationTasks] = useState(() => loadScheduledAutomationTasks());
  const [notificationsEnabled, setNotificationsEnabled] = useState(() => typeof Notification !== 'undefined'
    && Notification.permission === 'granted'
    && window.localStorage.getItem(THEME_SYSTEM_NOTIFICATIONS_KEY) === '1');
  const notifiedEventIds = useRef(new Set<string>());
  const lastBreadthAt = useRef(0);
  const lastImmediateAiEventId = useRef<string | null>(null);

  const selectedReport = useMemo(
    () => reports.find((report) => report.id === selectedReportId) ?? reports[0] ?? null,
    [reports, selectedReportId],
  );

  useEffect(() => {
    let disposed = false;
    void Promise.all([loadLocalStoreSnapshot(), hydrateThemeValidationFromLocalStore()]).then(([snapshot]) => {
      if (disposed) return;
      if (snapshot?.premarketThemeRuns?.length) {
        const hydrated = savePremarketThemeRuns(snapshot.premarketThemeRuns as PremarketThemeRun[]);
        setReports(hydrated);
        setSelectedReportId((current) => current || hydrated[0]?.id || '');
      }
      setEvents(loadThemeTrackingEvents());
      setReviews(loadThemeReviews());
      setBacktestRuns(loadThemeBacktestRuns());
    }).catch(() => undefined);
    const handleRuns = () => {
      const next = loadPremarketThemeRuns();
      setReports(next);
      setSelectedReportId((current) => next.some((report) => report.id === current) ? current : next[0]?.id || '');
    };
    const handleImport = (event: Event) => {
      const detail = (event as CustomEvent<{ ok?: boolean; error?: string }>).detail;
      setImportMessage(detail?.ok ? '日报已自动进入跟踪库。' : detail?.error || '日报未进入跟踪库。');
    };
    const handleTracking = () => setEvents(loadThemeTrackingEvents());
    const handleReviews = () => setReviews(loadThemeReviews());
    const handleAutomations = () => setAutomationTasks(loadScheduledAutomationTasks());
    window.addEventListener(PREMARKET_THEME_RUNS_CHANGED_EVENT, handleRuns);
    window.addEventListener(PREMARKET_THEME_IMPORT_EVENT, handleImport);
    window.addEventListener(THEME_TRACKING_CHANGED_EVENT, handleTracking);
    window.addEventListener(THEME_REVIEWS_CHANGED_EVENT, handleReviews);
    window.addEventListener(AUTOMATION_TASKS_CHANGED_EVENT, handleAutomations);
    return () => {
      disposed = true;
      window.removeEventListener(PREMARKET_THEME_RUNS_CHANGED_EVENT, handleRuns);
      window.removeEventListener(PREMARKET_THEME_IMPORT_EVENT, handleImport);
      window.removeEventListener(THEME_TRACKING_CHANGED_EVENT, handleTracking);
      window.removeEventListener(THEME_REVIEWS_CHANGED_EVENT, handleReviews);
      window.removeEventListener(AUTOMATION_TASKS_CHANGED_EVENT, handleAutomations);
    };
  }, []);

  const refreshMonitor = useCallback(async (forceBreadth = false) => {
    if (!selectedReport) return;
    if (selectedReport.tradeDate !== shanghaiTradeDate()) {
      setDataAsOf('历史快照');
      setDataError('历史报告仅展示已记录事件，不使用当前行情补算盘中触发。');
      return;
    }
    const codes = reportCodes(selectedReport);
    if (!codes.length) {
      setDataError('报告没有可用于实时监控的证券代码。');
      return;
    }
    setRefreshing(true);
    try {
      const batch = await fetchEastmoneyRealtimeBatch(codes, { forceRefresh: true });
      const quotes = reportQuoteMap(selectedReport, batch.prices);
      const now = new Date();
      const evaluateBreadth = forceBreadth || now.getTime() - lastBreadthAt.current >= 60_000;
      if (evaluateBreadth) lastBreadthAt.current = now.getTime();
      const evaluations = selectedReport.themes.flatMap((theme) => theme.triggerSpecs
        .filter((trigger) => trigger.evaluator !== 'breadth' || evaluateBreadth)
        .map((trigger) => evaluateThemeTrigger(selectedReport, trigger, { now, theme, quotes })));
      setEvents((current) => {
        const next = mergeTrackingEvaluations(current, evaluations);
        if (next !== current) saveThemeTrackingEvents(next);
        return next;
      });
      setDataAsOf(batch.asOfLabel || new Date().toLocaleTimeString('zh-CN', { hour12: false }));
      setDataError(batch.errors.length ? batch.errors[0] : '');
    } catch (error) {
      setDataError(error instanceof Error ? error.message : String(error));
    } finally {
      setRefreshing(false);
    }
  }, [selectedReport]);

  useEffect(() => {
    if (!selectedReport || view !== 'monitor') return;
    void refreshMonitor(true);
    const timer = window.setInterval(() => void refreshMonitor(false), 30_000);
    return () => window.clearInterval(timer);
  }, [refreshMonitor, selectedReport, view]);

  const selectedReview = reviews.find((review) => review.reportId === selectedReport?.id) ?? null;
  const latest = useMemo(() => selectedReport ? latestByTrigger(events, selectedReport.id) : new Map<string, ThemeTrackingEvent>(), [events, selectedReport]);
  const selectedReportIsHistorical = Boolean(selectedReport && selectedReport.tradeDate !== shanghaiTradeDate());
  const importantCount = Array.from(latest.values()).filter((event) => IMPORTANT_TRIGGER_STATES.has(event.status)).length;

  useEffect(() => {
    if (!notificationsEnabled || typeof Notification === 'undefined' || !selectedReport) return;
    const recent = events.find((event) => event.reportId === selectedReport.id
      && IMPORTANT_TRIGGER_STATES.has(event.status)
      && Date.now() - Date.parse(event.observedAt) < 120_000
      && !notifiedEventIds.current.has(event.id));
    if (!recent) return;
    notifiedEventIds.current.add(recent.id);
    const trigger = selectedReport.themes.flatMap((theme) => theme.triggerSpecs).find((item) => item.id === recent.triggerId);
    new Notification(`Alpha Studio · ${TRIGGER_STATUS_LABELS[recent.status]}`, {
      body: `${trigger?.label || recent.triggerId}：${recent.evidence}`,
      tag: `${recent.reportId}:${recent.triggerId}`,
    });
  }, [events, notificationsEnabled, selectedReport]);

  const toggleNotifications = useCallback(async () => {
    if (notificationsEnabled) {
      window.localStorage.removeItem(THEME_SYSTEM_NOTIFICATIONS_KEY);
      setNotificationsEnabled(false);
      return;
    }
    if (typeof Notification === 'undefined') {
      setImportMessage('当前系统不支持通知权限。');
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      window.localStorage.setItem(THEME_SYSTEM_NOTIFICATIONS_KEY, '1');
      setNotificationsEnabled(true);
    } else {
      setImportMessage('系统通知未授权，面板红点仍会正常显示。');
    }
  }, [notificationsEnabled]);

  const createReview = useCallback(() => {
    if (!selectedReport) return;
    const review = createDailyReview(selectedReport, events);
    const next = [review, ...reviews.filter((item) => item.reportId !== selectedReport.id)];
    setReviews(next);
    saveThemeReviews(next);
  }, [events, reviews, selectedReport]);

  const acceptRuleChanges = useCallback((review: ThemeDailyReview) => {
    if (!review.proposedRuleChanges.length || review.acceptedRuleVersion) return;
    const next = reviews.map((item) => item.id === review.id
      ? { ...item, acceptedRuleVersion: `rules-${review.tradeDate}-${Date.now().toString(36)}` }
      : item);
    setReviews(next);
    saveThemeReviews(next);
  }, [reviews]);

  useEffect(() => {
    const generateDueReviews = () => {
      const now = new Date();
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
      }).formatToParts(now);
      const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
      const today = `${values.year}-${values.month}-${values.day}`;
      const clock = `${values.hour}:${values.minute}`;
      const reviewed = new Set(reviews.map((review) => review.reportId));
      const due = reports.filter((report) => !reviewed.has(report.id) && (report.tradeDate < today || (report.tradeDate === today && clock >= '15:05')));
      if (!due.length) return;
      const next = [...due.map((report) => createDailyReview(report, events)), ...reviews];
      setReviews(next);
      saveThemeReviews(next);
    };
    generateDueReviews();
    const timer = window.setInterval(generateDueReviews, 60_000);
    return () => window.clearInterval(timer);
  }, [events, reports, reviews]);

  const aiMonitorTask = automationTasks.find((task) => task.kind === 'intraday-monitor' && task.conversationId === currentConversationId);

  useEffect(() => {
    const newestRuleChange = events.find((event) => event.reportId === selectedReport?.id
      && event.actor === 'rule'
      && IMPORTANT_TRIGGER_STATES.has(event.status));
    if (!newestRuleChange) return;
    if (lastImmediateAiEventId.current === null) {
      lastImmediateAiEventId.current = newestRuleChange.id;
      return;
    }
    if (lastImmediateAiEventId.current === newestRuleChange.id) return;
    lastImmediateAiEventId.current = newestRuleChange.id;
    if (!aiMonitorTask?.conversationId || Date.now() - Date.parse(newestRuleChange.observedAt) > 120_000) return;
    const state = useChatStore.getState();
    const conversation = state.conversations.find((item) => item.id === aiMonitorTask.conversationId);
    if (!conversation || conversation.status !== 'idle') return;
    void state.sendMessageToConversation(
      conversation.id,
      `数值规则刚发生关键状态变化，请立即追加一次语义/新闻证据检查。\nreportId: ${newestRuleChange.reportId}\ntriggerId: ${newestRuleChange.triggerId}\n状态：${TRIGGER_STATUS_LABELS[newestRuleChange.status]}\n证据：${newestRuleChange.evidence}`,
      undefined,
      { id: ALPHA_STUDIO_INTRADAY_MONITOR_SKILL_ID, title: ALPHA_STUDIO_INTRADAY_MONITOR_SKILL_TITLE },
      undefined,
      true,
    );
  }, [aiMonitorTask, events, selectedReport]);
  const toggleAiMonitor = useCallback(() => {
    if (aiMonitorTask) {
      saveScheduledAutomationTasks(automationTasks.filter((task) => task.id !== aiMonitorTask.id));
      setImportMessage('AI 语义监控已关闭；本地数值规则仍持续运行。');
      return;
    }
    if (!currentConversationId) {
      setImportMessage('请先选择一个对话，再启用 AI 语义监控。');
      return;
    }
    const form = detectAutomationIntent(INTRADAY_MONITOR_CARD_PROMPT);
    if (!form) return;
    addScheduledAutomationTask({ ...form, conversationId: currentConversationId });
    setImportMessage('AI 语义监控已启用：A 股交易时段每 10 分钟检查，仅应用运行时执行。');
  }, [aiMonitorTask, automationTasks, currentConversationId]);

  const importReport = useCallback(async (file: File) => {
    const raw = await file.text();
    let text = raw;
    if (file.name.toLowerCase().endsWith('.html')) {
      const document = new DOMParser().parseFromString(raw, 'text/html');
      const tableRows = Array.from(document.querySelectorAll('tr')).map((row) =>
        `| ${Array.from(row.querySelectorAll('th,td')).map((cell) => cell.textContent?.trim() || '').join(' | ')} |`,
      );
      text = `${document.body.textContent || ''}\n${tableRows.join('\n')}`;
    }
    const parsed = parsePremarketThemeResult(text, { requireCompleteReport: false });
    if (!parsed.ok || !parsed.run) {
      const draft = extractLegacyPremarketThemeDraft(text, file.name.replace(/\.[^.]+$/, ''));
      if (draft) {
        setPendingImport(draft);
        setImportMessage('已抽取历史报告，请确认题材顺序、中军顺序、代码和时间口径。');
      } else {
        setImportMessage(parsed.error || '报告无法解析；未找到可确认的题材/角色表格。');
      }
      return;
    }
    savePremarketThemeRun(parsed.run);
    setImportMessage(`已导入 ${parsed.run.tradeDate} · ${parsed.run.title}`);
  }, []);

  return (
    <section className="rv-shell" aria-label="跟踪验证中心">
      <header className="rv-head">
        <div>
          <h3>跟踪验证中心</h3>
          <span>报告 → 观察 → 复盘 → 回测</span>
        </div>
        <div className="rv-head-actions">
          <input
            ref={importRef}
            type="file"
            accept=".json,.md,.markdown,.html,.htm"
            hidden
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) void importReport(file);
              event.currentTarget.value = '';
            }}
          />
          <button type="button" onClick={() => importRef.current?.click()} title="导入 JSON、Markdown 或 HTML 报告">
            <FileInput size={13} />导入
          </button>
        </div>
      </header>

      <div className="rv-view-tabs" role="tablist" aria-label="跟踪验证视图">
        {(Object.keys(VIEW_LABELS) as ValidationView[]).map((key) => (
          <button key={key} type="button" role="tab" aria-selected={view === key} className={view === key ? 'active' : ''} onClick={() => setView(key)}>
            {VIEW_LABELS[key]}
            {key === 'monitor' && importantCount > 0 ? <em>{importantCount}</em> : null}
          </button>
        ))}
      </div>

      {reports.length ? (
        <div className="rv-baseline">
          <label>
            <span>基线报告</span>
            <select value={selectedReport?.id || ''} onChange={(event) => setSelectedReportId(event.target.value)}>
              {reports.map((report) => <option key={report.id} value={report.id}>{report.tradeDate} · {report.title}</option>)}
            </select>
          </label>
          {selectedReport ? (
            <div className="rv-baseline-meta">
              <span><Clock3 size={11} />截止 {formatDateTime(selectedReport.dataCutoff)}</span>
              <strong>{selectedReport.executionGate.state}</strong>
              <span>{selectedReport.sourceSchema === selectedReport.schema ? 'v2 可审计' : 'v1 兼容'}</span>
            </div>
          ) : null}
        </div>
      ) : null}

      {importMessage ? <div className="rv-notice">{importMessage}</div> : null}

      <div className="rv-content">
        {!selectedReport ? <ValidationEmpty onImport={() => importRef.current?.click()} /> : null}
        {selectedReport && view === 'monitor' ? (
          <MonitorView
            report={selectedReport}
            events={events}
            latest={latest}
            refreshing={refreshing}
            dataAsOf={dataAsOf}
            dataError={dataError}
            historical={selectedReportIsHistorical}
            aiMonitorEnabled={Boolean(aiMonitorTask)}
            notificationsEnabled={notificationsEnabled}
            onRefresh={() => void refreshMonitor(true)}
            onToggleAiMonitor={toggleAiMonitor}
            onToggleNotifications={() => void toggleNotifications()}
            onOverride={(event, status, reason) => {
              const next = overrideTrackingEvent(events, event, status, reason);
              setEvents(next);
              saveThemeTrackingEvents(next);
            }}
          />
        ) : null}
        {selectedReport && view === 'review' ? (
          <ReviewView report={selectedReport} review={selectedReview} onCreate={createReview} onAcceptRules={acceptRuleChanges} />
        ) : null}
        {selectedReport && view === 'backtest' ? (
          <BacktestView reports={reports} events={events} runs={backtestRuns} onRun={(run) => {
            setBacktestRuns(saveThemeBacktestRun(run));
          }} />
        ) : null}
      </div>
      {pendingImport ? (
        <div className="rv-import-confirm" role="dialog" aria-modal="true" aria-label="确认历史报告抽取结果">
          <div>
            <header><strong>确认历史报告</strong><span>不改写原文，确认后保存不可变快照</span></header>
            <dl>
              <div><dt>交易日</dt><dd>{pendingImport.tradeDate || '缺失'}</dd></div>
              <div><dt>生成/截止</dt><dd>{pendingImport.dataCutoff ? formatDateTime(pendingImport.dataCutoff) : '缺失，不进入回测'}</dd></div>
            </dl>
            <div className="rv-import-themes">
              {pendingImport.themes.map((theme) => <p key={theme.id}><strong>#{theme.rank} {theme.name}</strong><span>{theme.stocks.map((stock) => `${stock.role || '待确认'}${stock.roleRank} ${stock.name} ${stock.code || '缺代码'}`).join('；') || '缺标的'}</span></p>)}
            </div>
            <p className="rv-warning-note"><AlertTriangle size={12} />启发式抽取的历史报告默认仅用于阅读、跟踪和复盘；不会事后补写 AI/新闻触发。</p>
            <footer><button type="button" onClick={() => setPendingImport(null)}>取消</button><button type="button" onClick={() => { savePremarketThemeRun(pendingImport); setPendingImport(null); setImportMessage(`已导入 ${pendingImport.title}`); }}>确认入库</button></footer>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ValidationEmpty({ onImport }: { onImport: () => void }) {
  return (
    <div className="rv-empty">
      <ShieldCheck size={28} />
      <strong>还没有可跟踪的结构化日报</strong>
      <span>使用 Alpha Studio 盘前主题技能生成日报，完成后会自动入库；也可以导入已有 JSON、Markdown 或 HTML。</span>
      <button type="button" onClick={onImport}><FileInput size={13} />导入报告</button>
    </div>
  );
}

function MonitorView({
  report,
  events,
  latest,
  refreshing,
  dataAsOf,
  dataError,
  historical,
  aiMonitorEnabled,
  notificationsEnabled,
  onRefresh,
  onToggleAiMonitor,
  onToggleNotifications,
  onOverride,
}: {
  report: PremarketThemeRun;
  events: ThemeTrackingEvent[];
  latest: Map<string, ThemeTrackingEvent>;
  refreshing: boolean;
  dataAsOf: string;
  dataError: string;
  historical: boolean;
  aiMonitorEnabled: boolean;
  notificationsEnabled: boolean;
  onRefresh: () => void;
  onToggleAiMonitor: () => void;
  onToggleNotifications: () => void;
  onOverride: (event: ThemeTrackingEvent, status: TriggerEvaluationStatus, reason: string) => void;
}) {
  const [overriding, setOverriding] = useState<ThemeTrackingEvent | null>(null);
  const [overrideStatus, setOverrideStatus] = useState<TriggerEvaluationStatus>('triggered');
  const [reason, setReason] = useState('');
  const reportEvents = events.filter((event) => event.reportId === report.id).slice(0, 20);
  return (
    <div className="rv-stack">
      <div className="rv-status-strip">
        <span className={historical || dataError ? 'warn' : 'ready'}><Activity size={12} />{historical ? '历史快照' : dataError ? '行情部分不可用' : '实时行情'}</span>
        <span>{historical ? '仅展示已记录事件' : dataAsOf ? `更新 ${dataAsOf}` : '等待行情'}</span>
        <button type="button" className={aiMonitorEnabled ? 'active' : ''} onClick={onToggleAiMonitor}>{aiMonitorEnabled ? 'AI 10分钟 · 已开' : '启用 AI 10分钟'}</button>
        <button type="button" className={notificationsEnabled ? 'active' : ''} onClick={onToggleNotifications} title="已触发、升级确认和已失效的系统通知">{notificationsEnabled ? '通知已开' : '系统通知'}</button>
        <button type="button" onClick={onRefresh} disabled={refreshing}>{refreshing ? <Loader2 size={12} className="spin" /> : <RefreshCw size={12} />}刷新</button>
      </div>
      {dataError ? <div className="rv-error"><AlertTriangle size={13} />{dataError}</div> : null}
      <section className="rv-section">
        <header><div><strong>今日执行</strong><span>{report.capitalAttackPath.primaryRoute || '主路径待确认'}</span></div><em>{report.capitalAttackPath.todayAttackProbability || '未给概率'}</em></header>
        <p>{report.capitalAttackPath.actionCondition || report.executionGate.triggerBeforeAction.join('；') || '等待报告条件确认。'}</p>
      </section>
      {[...report.themes].sort((a, b) => a.rank - b.rank).map((theme) => (
        <section key={theme.id} className="rv-section rv-trigger-section">
          <header>
            <div><strong>#{theme.rank} {theme.name}</strong><span>{theme.grade} · {theme.lifecycle} · {theme.capitalType}</span></div>
            <em>{theme.todayAttackProbability}</em>
          </header>
          <div className="rv-trigger-list">
            {theme.triggerSpecs.length ? theme.triggerSpecs.map((trigger) => (
              <TriggerRow key={trigger.id} trigger={trigger} event={latest.get(trigger.id)} historical={historical} onOverride={setOverriding} />
            )) : <div className="rv-muted-row">报告未提供可机读触发条件。</div>}
          </div>
        </section>
      ))}
      <section className="rv-section">
        <header><div><strong>变化时间线</strong><span>只记录状态或证据变化</span></div></header>
        <div className="rv-timeline">
          {reportEvents.length ? reportEvents.map((event) => (
            <div key={event.id} className={`rv-timeline-row status-${event.status}`}>
              <span>{formatDateTime(event.observedAt)}</span>
              <strong>{TRIGGER_STATUS_LABELS[event.status]}</strong>
              <p>{event.evidence}</p>
            </div>
          )) : <div className="rv-muted-row">{historical ? '缺少盘中观察历史，未补造触发事件。' : '等待第一个观察事件。'}</div>}
        </div>
      </section>
      {overriding ? (
        <div className="rv-override" role="dialog" aria-label="人工覆写触发状态">
          <strong>人工覆写 · {overriding.evidence}</strong>
          <select value={overrideStatus} onChange={(event) => setOverrideStatus(event.target.value as TriggerEvaluationStatus)}>
            {Object.entries(TRIGGER_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="必须填写覆写依据" />
          <div><button type="button" onClick={() => setOverriding(null)}>取消</button><button type="button" disabled={!reason.trim()} onClick={() => { onOverride(overriding, overrideStatus, reason.trim()); setOverriding(null); setReason(''); }}>保存留痕</button></div>
        </div>
      ) : null}
    </div>
  );
}

export function TriggerRow({
  trigger,
  event,
  historical = false,
  onOverride,
}: {
  trigger: PremarketThemeTrigger;
  event?: ThemeTrackingEvent;
  historical?: boolean;
  onOverride: (event: ThemeTrackingEvent) => void;
}) {
  const status = event?.status || (historical ? 'data_missing' : 'not_due');
  const evidence = event?.evidence || (historical ? '缺少当日盘中观察记录' : `等待 ${trigger.dataSource}`);
  return (
    <div className={`rv-trigger-row status-${status}`}>
      <span className="rv-trigger-dot" />
      <div><strong>{trigger.label}</strong><span>{evidence}</span></div>
      <em>{TRIGGER_STATUS_LABELS[status]}</em>
      {event ? <button type="button" onClick={() => onOverride(event)}>覆写</button> : null}
    </div>
  );
}

function ReviewView({ report, review, onCreate, onAcceptRules }: { report: PremarketThemeRun; review: ThemeDailyReview | null; onCreate: () => void; onAcceptRules: (review: ThemeDailyReview) => void }) {
  if (!review) {
    return <div className="rv-empty"><RotateCcw size={28} /><strong>尚未生成收盘复盘</strong><span>将报告与已记录的盘中状态逐项对照，不使用事后信息改写原判断。</span><button type="button" onClick={onCreate}><Play size={13} />生成复盘</button></div>;
  }
  return (
    <div className="rv-stack">
      <section className="rv-review-score">
        <div><span>总体评分</span><strong>{review.score}</strong><em>/ 100</em></div>
        <p>{review.summary}</p>
        {review.missingIntradayHistory ? <span className="rv-warning-note"><AlertTriangle size={12} />缺少盘中观察历史</span> : null}
      </section>
      <section className="rv-section">
        <header><div><strong>预测与触发审计</strong><span>{report.tradeDate}</span></div></header>
        <div className="rv-review-list">
          {review.items.map((item) => <div key={item.id}><span>{item.label}</span><strong className={`verdict-${item.verdict}`}>{item.verdict}</strong><p>{item.evidence}</p></div>)}
        </div>
      </section>
      <section className="rv-section">
        <header><div><strong>规则校准建议</strong><span>{review.acceptedRuleVersion ? `已产生 ${review.acceptedRuleVersion}` : '确认后才产生新版本'}</span></div>{review.proposedRuleChanges.length && !review.acceptedRuleVersion ? <button type="button" onClick={() => onAcceptRules(review)}>确认新版本</button> : null}</header>
        {review.proposedRuleChanges.length ? review.proposedRuleChanges.map((item) => <p key={item}>{item}</p>) : <p>当前没有需要修改的规则。</p>}
      </section>
    </div>
  );
}

function BacktestView({ reports, events, runs, onRun }: { reports: PremarketThemeRun[]; events: ThemeTrackingEvent[]; runs: ThemeBacktestRun[]; onRun: (run: ThemeBacktestRun) => void }) {
  const [config, setConfig] = useState<ThemeBacktestConfig>(DEFAULT_THEME_BACKTEST_CONFIG);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [activeRun, setActiveRun] = useState<ThemeBacktestRun | null>(runs[0] ?? null);

  const execute = useCallback(async () => {
    setRunning(true);
    setError('');
    try {
      const jqConfig = await loadJqDataConfig();
      if (!jqConfig.enabled || !jqConfig.passwordConfigured) throw new Error('策略回测需要先在设置中启用 JQData；不会使用样例行情代替。');
      const eligible = reports.filter((report) => report.tradeDate);
      if (!eligible.length) throw new Error('没有带交易日期的结构化报告。');
      const dates = eligible.map((report) => report.tradeDate).sort();
      const start = config.dateFrom || dates[0];
      const endBase = config.dateTo || dates[dates.length - 1];
      const endDate = new Date(`${endBase}T00:00:00+08:00`);
      endDate.setDate(endDate.getDate() + 12);
      const end = endDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
      const backtestEligible = eligibleOpenReports(reports, config);
      const selections = backtestEligible.map((report) => ({ report, candidate: selectBacktestCandidate(report, config) }));
      const codes = Array.from(new Set(selections.map((item) => item.candidate?.stock.code).filter((code): code is string => Boolean(code))));
      const [dailyEntries, rawDailyEntries] = await Promise.all([
        Promise.all(codes.map(async (code) => [code, toBacktestBars(await fetchJqHistoricalBars(code, start, end, '1d', { fq: 'pre' }))] as const)),
        Promise.all(codes.map(async (code) => [code, toBacktestBars(await fetchJqHistoricalBars(code, start, end, '1d', { fq: 'none' }))] as const)),
      ]);
      const reportsWithEvents = new Set(events.map((event) => event.reportId));
      const eventCodes = new Set(selections.filter((item) => reportsWithEvents.has(item.report.id)).map((item) => item.candidate?.stock.code).filter((code): code is string => Boolean(code)));
      const minuteEntries = await Promise.all(Array.from(eventCodes).map(async (code) => [code, toBacktestBars(await fetchJqHistoricalBars(code, start, end, '1m', { fq: 'none' }))] as const));
      const benchmark = toBacktestBars(await fetchJqHistoricalBars(config.benchmarkCode, start, end, '1d', { fq: 'pre' }));
      if (!benchmark.length) throw new Error('JQData 未返回沪深300基准行情。');
      const backtestInput = {
        reports,
        events,
        dailyBarsByCode: new Map(dailyEntries),
        rawDailyBarsByCode: new Map(rawDailyEntries),
        minuteBarsByCode: new Map(minuteEntries),
        benchmarkBars: benchmark,
        config,
        dataSource: 'jqdata',
        dataVersion: new Date().toISOString(),
      };
      const run = runThemeBacktest(backtestInput);
      run.sensitivity = [0, 5, 10].map((slippageBps) => ({
        slippageBps,
        executableReturnPct: runThemeBacktest({ ...backtestInput, config: { ...config, slippageBps } }).metrics.executableReturnPct,
      }));
      setActiveRun(run);
      onRun(run);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setRunning(false);
    }
  }, [config, events, onRun, reports]);

  return (
    <div className="rv-stack">
      <section className="rv-section rv-backtest-config">
        <header><div><strong>{config.name}</strong><span>信号曲线 + 可执行净值</span></div><button type="button" onClick={() => void execute()} disabled={running}>{running ? <Loader2 size={13} className="spin" /> : <Play size={13} />}运行</button></header>
        <div className="rv-form-grid">
          <label>题材排名<input type="number" min="1" value={config.themeRank} onChange={(event) => setConfig({ ...config, themeRank: Number(event.target.value) || 1 })} /></label>
          <label>股票角色<select value={config.stockRole} onChange={(event) => setConfig({ ...config, stockRole: event.target.value })}><option>中军</option><option>趋势核心</option><option>龙头</option><option>补涨</option></select></label>
          <label>角色顺序<input type="number" min="1" value={config.roleRank} onChange={(event) => setConfig({ ...config, roleRank: Number(event.target.value) || 1 })} /></label>
          <label>持有日<input type="number" min="1" max="20" value={config.holdingDays} onChange={(event) => setConfig({ ...config, holdingDays: Number(event.target.value) || 1 })} /></label>
          <label>佣金率<input type="number" step="0.0001" value={config.commissionRate} onChange={(event) => setConfig({ ...config, commissionRate: Number(event.target.value) || 0 })} /></label>
          <label>滑点 bp<select value={config.slippageBps} onChange={(event) => setConfig({ ...config, slippageBps: Number(event.target.value) })}><option value="0">0</option><option value="5">5</option><option value="10">10</option></select></label>
        </div>
      </section>
      {error ? <div className="rv-error"><AlertTriangle size={13} />{error}</div> : null}
      {activeRun ? <BacktestResults run={activeRun} /> : <div className="rv-empty compact"><BarChart3 size={24} /><strong>等待第一次可信回测</strong><span>只使用结构化报告和 JQData 历史行情，缺失样本会留在排除清单。</span></div>}
    </div>
  );
}

function BacktestResults({ run }: { run: ThemeBacktestRun }) {
  const metrics = run.metrics;
  return (
    <>
      <div className="rv-metrics">
        <Metric label="信号收益" value={formatPercent(metrics.totalReturnPct)} tone={metrics.totalReturnPct} />
        <Metric label="可执行收益" value={formatPercent(metrics.executableReturnPct)} tone={metrics.executableReturnPct} />
        <Metric label="超额收益" value={formatPercent(metrics.excessReturnPct)} tone={metrics.excessReturnPct} />
        <Metric label="最大回撤" value={formatPercent(metrics.maxDrawdownPct)} tone={metrics.maxDrawdownPct} />
        <Metric label="胜率" value={`${metrics.winRatePct.toFixed(1)}%`} />
        <Metric label="平均单笔" value={formatPercent(metrics.averageTradePct)} tone={metrics.averageTradePct} />
        <Metric label="中位单笔" value={formatPercent(metrics.medianTradePct)} tone={metrics.medianTradePct} />
        <Metric label="盈亏比" value={metrics.profitLossRatio === null ? '样本不足' : metrics.profitLossRatio.toFixed(2)} />
        <Metric label="有效样本" value={`${metrics.sampleCount}/${metrics.eligibleReports}`} />
        <Metric label="覆盖率" value={`${metrics.coveragePct.toFixed(1)}%`} />
      </div>
      {run.sensitivity?.length ? <div className="rv-sensitivity"><strong>滑点敏感性</strong>{run.sensitivity.map((item) => <span key={item.slippageBps}>{item.slippageBps}bp <em>{formatPercent(item.executableReturnPct)}</em></span>)}</div> : null}
      <section className="rv-section">
        <header><div><strong>资金净值</strong><span>运行哈希 {run.runHash}</span></div></header>
        <CurveChart signal={run.signalCurve} executable={run.executableCurve} benchmark={run.benchmarkCurve} />
        <div className="rv-chart-legend"><span className="signal">信号曲线</span><span className="executable">可执行净值</span><span className="benchmark">沪深300</span></div>
      </section>
      <section className="rv-section">
        <header><div><strong>逐日交易账本</strong><span>{run.dataSource} · {formatDateTime(run.createdAt)}</span></div></header>
        <div className="rv-trade-list">
          {run.signalTrades.map((trade) => (
            <div key={trade.id}><span>{trade.tradeDate}</span><strong>{trade.theme} · {trade.name}</strong><em className={trade.grossReturnPct >= 0 ? 'up' : 'down'}>{formatPercent(trade.grossReturnPct)}</em><p>{trade.entryPrice.toFixed(2)} → {trade.exitPrice.toFixed(2)} · {trade.evidence}</p></div>
          ))}
          {!run.signalTrades.length ? <div className="rv-muted-row">没有形成有效交易样本。</div> : null}
        </div>
      </section>
      {run.exclusions.length ? <section className="rv-section"><header><div><strong>排除与未成交</strong><span>{run.exclusions.length} 项</span></div></header><div className="rv-exclusions">{run.exclusions.slice(0, 12).map((item, index) => <p key={`${item.reportId}:${index}`}><span>{item.tradeDate}</span>{item.reason}</p>)}</div></section> : null}
    </>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: number }) {
  return <div><span>{label}</span><strong className={tone === undefined ? '' : tone >= 0 ? 'up' : 'down'}>{value}</strong></div>;
}

function CurveChart({ signal, executable, benchmark }: { signal: BacktestCurvePoint[]; executable: BacktestCurvePoint[]; benchmark: BacktestCurvePoint[] }) {
  const width = 720;
  const height = 220;
  const all = [...signal, ...executable, ...benchmark].filter((point) => Number.isFinite(point.value));
  if (all.length < 2) return <div className="rv-chart-empty">样本不足，暂时无法绘制净值曲线。</div>;
  const dates = Array.from(new Set(all.map((point) => point.date))).sort();
  const min = Math.min(...all.map((point) => point.value));
  const max = Math.max(...all.map((point) => point.value));
  const span = Math.max(1, max - min);
  const path = (points: BacktestCurvePoint[]) => points.map((point, index) => {
    const x = dates.length > 1 ? dates.indexOf(point.date) / (dates.length - 1) * width : 0;
    const y = height - (point.value - min) / span * height;
    return `${index ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <div className="rv-chart-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="信号、可执行与沪深300净值曲线">
        <line x1="0" y1={height / 2} x2={width} y2={height / 2} className="grid" />
        <path d={path(benchmark)} className="benchmark" />
        <path d={path(signal)} className="signal" />
        <path d={path(executable)} className="executable" />
      </svg>
    </div>
  );
}
