import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Check,
  ChevronRight,
  Clock3,
  Crosshair,
  FileInput,
  Layers,
  Loader2,
  MessageSquarePlus,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
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
  type PremarketTheme,
  type PremarketThemeRun,
  type PremarketThemeTrigger,
} from './themeResearch';
import {
  DEFAULT_THEME_BACKTEST_CONFIG,
  IMPORTANT_TRIGGER_STATES,
  TRIGGER_STATUS_LABELS,
  THEME_TRACKING_CHANGED_EVENT,
  THEME_REVIEWS_CHANGED_EVENT,
  createDailyReview,
  hydrateThemeValidationFromLocalStore,
  loadThemeBacktestRuns,
  loadThemeReviews,
  loadThemeTrackingEvents,
  overrideTrackingEvent,
  runThemeBacktest,
  eligibleOpenReports,
  selectBacktestCandidate,
  saveThemeBacktestRun,
  saveThemeReviews,
  saveThemeTrackingEvents,
  summarizeStockConditions,
  type BacktestCurvePoint,
  type BacktestPriceBar,
  type ThemeBacktestConfig,
  type ThemeBacktestRun,
  type ThemeDailyReview,
  type ThemeTrackingEvent,
  type TriggerEvaluationStatus,
} from './themeValidation';
import {
  buildThemeLedger,
  summarizeLedger,
  type ThemeDayOutcome,
  type ThemeLedgerEntry,
} from './themeLedger';
import {
  THEME_ENGINE_TICK_EVENT,
  THEME_SYSTEM_NOTIFICATIONS_KEY,
  runTrackingTick,
  shanghaiTradeDate,
  type ThemeEngineTickDetail,
} from './themeTrackingEngine';
import { loadLocalStoreSnapshot } from './localStore';
import { insertIntoComposer } from './composerBridge';
import { buildResearchCalibration } from './researchCalibration';

type ValidationView = 'cockpit' | 'ledger' | 'review' | 'backtest' | 'calibration';

const VIEW_LABELS: Record<ValidationView, string> = {
  cockpit: '今日作战',
  ledger: '主题台账',
  review: '收盘复盘',
  backtest: '净值回测',
  calibration: '概率校准',
};

const ROLE_ORDER = ['龙头', '情绪龙头', '中军', '容量核心', '趋势核心', '先锋', '补涨', '情绪扩散'];

const STOCK_CONDITION_LABELS = {
  ready: '买入条件达成',
  partial: '部分达成',
  waiting: '等待触发',
  blocked: '失效 / 禁止',
  data_missing: '待补数据',
} as const;

function roleOrderIndex(role: string | undefined): number {
  if (!role) return ROLE_ORDER.length;
  const index = ROLE_ORDER.findIndex((item) => role.includes(item));
  return index < 0 ? ROLE_ORDER.length : index;
}

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

function formatShortDate(value: string): string {
  return value ? `${Number(value.slice(5, 7))}/${Number(value.slice(8, 10))}` : '';
}

function formatPercent(value: number): string {
  const prefix = value > 0 ? '+' : '';
  return `${prefix}${value.toFixed(2)}%`;
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
  const [view, setView] = useState<ValidationView>('cockpit');
  const [reports, setReports] = useState<PremarketThemeRun[]>(() => loadPremarketThemeRuns());
  const [selectedReportId, setSelectedReportId] = useState(() => reports[0]?.id || '');
  const [events, setEvents] = useState<ThemeTrackingEvent[]>(() => loadThemeTrackingEvents());
  const [reviews, setReviews] = useState<ThemeDailyReview[]>(() => loadThemeReviews());
  const [backtestRuns, setBacktestRuns] = useState<ThemeBacktestRun[]>(() => loadThemeBacktestRuns());
  const [quotes, setQuotes] = useState<Map<string, ResearchQuote>>(new Map());
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
  const lastImmediateAiEventId = useRef<string | null>(null);

  const selectedReport = useMemo(
    () => reports.find((report) => report.id === selectedReportId) ?? reports[0] ?? null,
    [reports, selectedReportId],
  );

  const ledgerEntries = useMemo(() => buildThemeLedger(reports, events), [reports, events]);
  const ledgerSummary = useMemo(() => summarizeLedger(ledgerEntries, reports), [ledgerEntries, reports]);

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
    const handleEngineTick = (event: Event) => {
      const detail = (event as CustomEvent<ThemeEngineTickDetail>).detail;
      if (!detail) return;
      setQuotes(new Map(detail.quotes));
      setDataAsOf(detail.asOfLabel);
      setDataError(detail.errors[0] || '');
    };
    window.addEventListener(PREMARKET_THEME_RUNS_CHANGED_EVENT, handleRuns);
    window.addEventListener(PREMARKET_THEME_IMPORT_EVENT, handleImport);
    window.addEventListener(THEME_TRACKING_CHANGED_EVENT, handleTracking);
    window.addEventListener(THEME_REVIEWS_CHANGED_EVENT, handleReviews);
    window.addEventListener(AUTOMATION_TASKS_CHANGED_EVENT, handleAutomations);
    window.addEventListener(THEME_ENGINE_TICK_EVENT, handleEngineTick);
    return () => {
      disposed = true;
      window.removeEventListener(PREMARKET_THEME_RUNS_CHANGED_EVENT, handleRuns);
      window.removeEventListener(PREMARKET_THEME_IMPORT_EVENT, handleImport);
      window.removeEventListener(THEME_TRACKING_CHANGED_EVENT, handleTracking);
      window.removeEventListener(THEME_REVIEWS_CHANGED_EVENT, handleReviews);
      window.removeEventListener(AUTOMATION_TASKS_CHANGED_EVENT, handleAutomations);
      window.removeEventListener(THEME_ENGINE_TICK_EVENT, handleEngineTick);
    };
  }, []);

  const selectedReportIsHistorical = Boolean(selectedReport && selectedReport.tradeDate !== shanghaiTradeDate());

  const refreshMonitor = useCallback(async () => {
    if (!selectedReport) return;
    if (selectedReport.tradeDate !== shanghaiTradeDate()) {
      setDataAsOf('历史快照');
      setDataError('历史报告仅展示已记录事件，不使用当前行情补算盘中触发。');
      return;
    }
    setRefreshing(true);
    try {
      const detail = await runTrackingTick({ force: true });
      if (!detail) setDataError('暂无可评估的今日报告标的。');
    } catch (error) {
      setDataError(error instanceof Error ? error.message : String(error));
    } finally {
      setRefreshing(false);
    }
  }, [selectedReport]);

  useEffect(() => {
    if (!selectedReport || view !== 'cockpit' || selectedReportIsHistorical) return;
    void refreshMonitor();
    const timer = window.setInterval(() => {
      void runTrackingTick({ force: true }).catch(() => undefined);
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [refreshMonitor, selectedReport, selectedReportIsHistorical, view]);

  useEffect(() => {
    if (selectedReportIsHistorical) {
      setDataAsOf('历史快照');
      setDataError('历史报告仅展示已记录事件，不使用当前行情补算盘中触发。');
    }
  }, [selectedReportIsHistorical]);

  const selectedReview = reviews.find((review) => review.reportId === selectedReport?.id) ?? null;
  const latest = useMemo(() => selectedReport ? latestByTrigger(events, selectedReport.id) : new Map<string, ThemeTrackingEvent>(), [events, selectedReport]);
  const importantCount = Array.from(latest.values()).filter((event) => IMPORTANT_TRIGGER_STATES.has(event.status)).length;

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

  const openReportInCockpit = useCallback((reportId: string) => {
    setSelectedReportId(reportId);
    setView('cockpit');
  }, []);

  return (
    <section className="rv-shell" aria-label="日报跟踪作战台">
      <header className="rv-head">
        <div>
          <h3>日报跟踪</h3>
          <span>盘前报告 → 盘中自动记录 → 台账 → 复盘 → 回测</span>
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

      {reports.length ? (
        <div className="rv-kpi-strip" aria-label="跟踪概览">
          <div><span>覆盖交易日</span><strong>{ledgerSummary.coveredDays}</strong></div>
          <div><span>结构化报告</span><strong>{ledgerSummary.reportCount}</strong></div>
          <div><span>活跃/累计题材</span><strong>{ledgerSummary.activeThemes}<em>/{ledgerSummary.totalThemes}</em></strong></div>
          <div>
            <span>触发兑现率</span>
            <strong>{ledgerSummary.hitRatePct === null ? '—' : `${ledgerSummary.hitRatePct.toFixed(0)}%`}<em>{ledgerSummary.decidedTriggers ? ` · ${ledgerSummary.decidedTriggers}次` : ''}</em></strong>
          </div>
        </div>
      ) : null}

      <div className="rv-view-tabs five" role="tablist" aria-label="跟踪验证视图">
        {(Object.keys(VIEW_LABELS) as ValidationView[]).map((key) => (
          <button key={key} type="button" role="tab" aria-selected={view === key} className={view === key ? 'active' : ''} onClick={() => setView(key)}>
            {VIEW_LABELS[key]}
            {key === 'cockpit' && importantCount > 0 ? <em>{importantCount}</em> : null}
          </button>
        ))}
      </div>

      {reports.length && (view === 'cockpit' || view === 'review') ? (
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
        {selectedReport && view === 'cockpit' ? (
          <CockpitView
            report={selectedReport}
            events={events}
            latest={latest}
            quotes={quotes}
            refreshing={refreshing}
            dataAsOf={dataAsOf}
            dataError={dataError}
            historical={selectedReportIsHistorical}
            aiMonitorEnabled={Boolean(aiMonitorTask)}
            notificationsEnabled={notificationsEnabled}
            onRefresh={() => void refreshMonitor()}
            onToggleAiMonitor={toggleAiMonitor}
            onToggleNotifications={() => void toggleNotifications()}
            onOverride={(event, status, reason) => {
              const next = overrideTrackingEvent(events, event, status, reason);
              setEvents(next);
              saveThemeTrackingEvents(next);
            }}
          />
        ) : null}
        {selectedReport && view === 'ledger' ? (
          <LedgerView entries={ledgerEntries} onOpenReport={openReportInCockpit} />
        ) : null}
        {selectedReport && view === 'review' ? (
          <ReviewView
            report={selectedReport}
            review={selectedReview}
            reviews={reviews}
            reports={reports}
            onCreate={createReview}
            onAcceptRules={acceptRuleChanges}
            onSelectReport={setSelectedReportId}
          />
        ) : null}
        {selectedReport && view === 'backtest' ? (
          <BacktestView reports={reports} events={events} runs={backtestRuns} onRun={(run) => {
            setBacktestRuns(saveThemeBacktestRun(run));
          }} />
        ) : null}
        {selectedReport && view === 'calibration' ? (
          <CalibrationView reports={reports} reviews={reviews} />
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
      <span>使用 Alpha Studio 盘前主题技能生成日报，完成后会自动入库并在交易时段自动记录盘中触发；也可以导入已有 JSON、Markdown 或 HTML。</span>
      <button type="button" onClick={onImport}><FileInput size={13} />导入报告</button>
    </div>
  );
}

// ---- 今日作战 --------------------------------------------------------------

function CockpitView({
  report,
  events,
  latest,
  quotes,
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
  quotes: Map<string, ResearchQuote>;
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
        <span className={historical || dataError ? 'warn' : 'ready'}><Activity size={12} />{historical ? '历史快照' : dataError ? '行情部分不可用' : '盘中自动记录中'}</span>
        <span>{historical ? '仅展示已记录事件' : dataAsOf ? `更新 ${dataAsOf}` : '等待行情'}</span>
        <button type="button" className={aiMonitorEnabled ? 'active' : ''} onClick={onToggleAiMonitor}>{aiMonitorEnabled ? 'AI 10分钟 · 已开' : '启用 AI 10分钟'}</button>
        <button type="button" className={notificationsEnabled ? 'active' : ''} onClick={onToggleNotifications} title="已触发、升级确认和已失效的系统通知">{notificationsEnabled ? '通知已开' : '系统通知'}</button>
        <button type="button" onClick={onRefresh} disabled={refreshing}>{refreshing ? <Loader2 size={12} className="spin" /> : <RefreshCw size={12} />}刷新</button>
      </div>
      {dataError ? <div className="rv-error"><AlertTriangle size={13} />{dataError}</div> : null}
      <section className="rv-section rv-gate">
        <header>
          <div><strong>今日执行 · {report.executionGate.state}</strong><span>{report.capitalAttackPath.primaryRoute || '主路径待确认'}</span></div>
          <em>{report.capitalAttackPath.todayAttackProbability || '未给概率'}</em>
        </header>
        <p>{report.capitalAttackPath.actionCondition || report.executionGate.triggerBeforeAction.join('；') || '等待报告条件确认。'}</p>
        {report.executionGate.todayOnlyDo.length || report.executionGate.todayDoNotDo.length ? (
          <div className="rv-gate-rules">
            {report.executionGate.todayOnlyDo.slice(0, 3).map((item) => <span key={item} className="do">只做 · {item}</span>)}
            {report.executionGate.todayDoNotDo.slice(0, 3).map((item) => <span key={item} className="dont">不做 · {item}</span>)}
          </div>
        ) : null}
      </section>
      {[...report.themes].sort((a, b) => a.rank - b.rank).map((theme) => (
        <ThemeBattleCard
          key={theme.id}
          theme={theme}
          quotes={quotes}
          latest={latest}
          historical={historical}
          onOverride={setOverriding}
        />
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

function ThemeBattleCard({
  theme,
  quotes,
  latest,
  historical,
  onOverride,
}: {
  theme: PremarketTheme;
  quotes: Map<string, ResearchQuote>;
  latest: Map<string, ThemeTrackingEvent>;
  historical: boolean;
  onOverride: (event: ThemeTrackingEvent) => void;
}) {
  const [expandedStockKey, setExpandedStockKey] = useState('');
  const stocks = [...theme.stocks].sort((a, b) =>
    roleOrderIndex(a.role) === roleOrderIndex(b.role)
      ? a.roleRank - b.roleRank
      : roleOrderIndex(a.role) - roleOrderIndex(b.role));
  const conditionRows = stocks.map((stock) => ({
    stock,
    key: `${stock.code || stock.name}:${stock.role || ''}:${stock.roleRank}`,
    summary: summarizeStockConditions(theme, stock, latest),
  }));
  const readyCount = conditionRows.filter((row) => row.summary.state === 'ready').length;
  const blockedCount = conditionRows.filter((row) => row.summary.state === 'blocked').length;
  return (
    <section className="rv-section rv-trigger-section">
      <header>
        <div><strong>#{theme.rank} {theme.name}</strong><span>{theme.grade} · {theme.lifecycle} · {theme.capitalType}</span></div>
        <div className="rv-theme-condition-summary">
          {readyCount ? <span className="ready">达成 {readyCount}</span> : null}
          {blockedCount ? <span className="blocked">失效 {blockedCount}</span> : null}
          <em>{theme.todayAttackProbability}</em>
        </div>
      </header>
      {stocks.length ? (
        <table className="rv-matrix" aria-label={`${theme.name} 角色矩阵`}>
          <thead>
            <tr><th>角色</th><th>标的 / 真实性</th><th className="num">行情</th><th>报告条件</th></tr>
          </thead>
          <tbody>
            {conditionRows.map(({ stock, key, summary }) => {
              const quote = stock.code ? quotes.get(stock.code) : undefined;
              const tone = quote ? (quote.changePct > 0 ? 'up' : quote.changePct < 0 ? 'down' : '') : '';
              const expanded = expandedStockKey === key;
              return (
                <Fragment key={key}>
                  <tr className={`rv-stock-decision-row state-${summary.state}`}>
                    <td><span className="rv-role-chip">{stock.role || '未标注'}{stock.roleRank > 1 ? ` ${stock.roleRank}` : ''}</span></td>
                    <td className="rv-matrix-name"><strong>{stock.name}</strong><span>{stock.code || '缺代码'} · {stock.authenticity || '真实性未标注'}</span></td>
                    <td className={`num ${tone}`}><strong>{quote ? quote.price.toFixed(2) : historical ? '—' : '…'}</strong><span>{quote ? formatPercent(quote.changePct) : historical ? '历史' : '等待'}</span></td>
                    <td>
                      <button
                        type="button"
                        className={`rv-stock-condition state-${summary.state}`}
                        aria-expanded={expanded}
                        onClick={() => setExpandedStockKey(expanded ? '' : key)}
                      >
                        <span>{STOCK_CONDITION_LABELS[summary.state]}</span>
                        <em>{summary.confirmed}/{summary.total || '—'}</em>
                        <ChevronRight size={12} />
                      </button>
                    </td>
                  </tr>
                  {expanded ? (
                    <tr key={`${key}:detail`} className="rv-stock-condition-detail">
                      <td colSpan={4}>
                        <div className="rv-stock-condition-action"><strong>当前动作</strong><span>{summary.action}</span></div>
                        <div className="rv-stock-condition-columns">
                          <div>
                            <strong><Check size={12} />买入条件</strong>
                            {summary.entryConditions.length ? <ul>{summary.entryConditions.map((condition) => <li key={condition}>{condition}</li>)}</ul> : <p>报告未提供逐股买入条件。</p>}
                          </div>
                          <div>
                            <strong><ShieldAlert size={12} />失效条件</strong>
                            {summary.invalidationConditions.length ? <ul>{summary.invalidationConditions.map((condition) => <li key={condition}>{condition}</li>)}</ul> : <p>报告未提供逐股失效条件。</p>}
                          </div>
                        </div>
                        <div className="rv-stock-trigger-audit">
                          {summary.triggers.map((trigger) => (
                            <TriggerRow key={trigger.id} trigger={trigger} event={latest.get(trigger.id)} historical={historical} onOverride={onOverride} />
                          ))}
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      ) : <div className="rv-muted-row">报告未提供角色矩阵标的。</div>}
      <div className="rv-trigger-list">
        {theme.triggerSpecs.length ? theme.triggerSpecs.map((trigger) => (
          <TriggerRow key={trigger.id} trigger={trigger} event={latest.get(trigger.id)} historical={historical} onOverride={onOverride} />
        )) : <div className="rv-muted-row">报告未提供可机读触发条件。</div>}
      </div>
    </section>
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

// ---- 主题台账 --------------------------------------------------------------

const DAY_VERDICT_LABELS: Record<ThemeDayOutcome['verdict'], string> = {
  hit: '触发兑现',
  miss: '触发失效',
  mixed: '有触发有失效',
  pending: '未触发/观察中',
  no_data: '缺盘中记录',
};

function LedgerView({ entries, onOpenReport }: { entries: ThemeLedgerEntry[]; onOpenReport: (reportId: string) => void }) {
  const [expandedKey, setExpandedKey] = useState<string | null>(entries[0]?.key ?? null);
  if (!entries.length) {
    return (
      <div className="rv-empty compact">
        <Layers size={24} />
        <strong>台账为空</strong>
        <span>入库两天以上的盘前报告后，这里会自动聚合每个题材的连续跟踪轨迹、角色标的与触发兑现率。</span>
      </div>
    );
  }
  return (
    <div className="rv-stack">
      {entries.map((entry) => {
        const expanded = expandedKey === entry.key;
        return (
          <section key={entry.key} className={`rv-section rv-ledger-card${entry.active ? '' : ' inactive'}`}>
            <header onClick={() => setExpandedKey(expanded ? null : entry.key)} role="button" tabIndex={0}
              onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') setExpandedKey(expanded ? null : entry.key); }}>
              <div>
                <strong>{entry.active ? `#${entry.latestRank} ` : ''}{entry.name}</strong>
                <span>
                  {entry.latestGrade} · {entry.latestLifecycle} · 跟踪 {entry.daysTracked} 天
                  {entry.active ? '' : ` · 最后出现 ${formatShortDate(entry.lastDate)}`}
                </span>
              </div>
              <em>{entry.hitRatePct === null ? '无触发样本' : `兑现 ${entry.hitRatePct.toFixed(0)}%`}</em>
            </header>
            <div className="rv-ledger-track" aria-label={`${entry.name} 逐日轨迹`}>
              {entry.timeline.map((day) => (
                <button
                  key={`${day.reportId}:${day.themeId}`}
                  type="button"
                  className={`rv-day-dot verdict-${day.verdict}`}
                  title={`${day.tradeDate} · 排名#${day.rank} · ${day.grade}级 · ${DAY_VERDICT_LABELS[day.verdict]}${day.triggerTotal ? ` (${day.triggeredCount}/${day.triggerTotal} 触发)` : ''}`}
                  onClick={() => onOpenReport(day.reportId)}
                >
                  <span>{formatShortDate(day.tradeDate)}</span>
                  <strong>{day.grade}</strong>
                </button>
              ))}
            </div>
            {expanded ? (
              <div className="rv-ledger-detail">
                <p className="rv-ledger-conclusion">{entry.latestConclusion || '最新报告未给出结论。'}</p>
                <div className="rv-ledger-stocks">
                  {entry.stocks.map((stock) => (
                    <span key={stock.code || stock.name} className="rv-stock-chip" title={`出现 ${stock.appearances} 次 · 最后 ${stock.lastDate}`}>
                      <em>{stock.role}</em>{stock.name}{stock.authenticity ? `（${stock.authenticity}）` : ''}
                      {stock.appearances > 1 ? <i>×{stock.appearances}</i> : null}
                    </span>
                  ))}
                  {!entry.stocks.length ? <span className="rv-stock-chip"><em>—</em>无标的记录</span> : null}
                </div>
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

// ---- 收盘复盘 --------------------------------------------------------------

function ReviewView({
  report,
  review,
  reviews,
  reports,
  onCreate,
  onAcceptRules,
  onSelectReport,
}: {
  report: PremarketThemeRun;
  review: ThemeDailyReview | null;
  reviews: ThemeDailyReview[];
  reports: PremarketThemeRun[];
  onCreate: () => void;
  onAcceptRules: (review: ThemeDailyReview) => void;
  onSelectReport: (reportId: string) => void;
}) {
  const knownReports = new Set(reports.map((item) => item.id));
  const history = [...reviews]
    .filter((item) => knownReports.has(item.reportId))
    .sort((a, b) => b.tradeDate.localeCompare(a.tradeDate));
  const historySection = history.length > 1 ? (
    <section className="rv-section">
      <header><div><strong>复盘历史</strong><span>逐日评分趋势，点击切换基线报告</span></div></header>
      <div className="rv-review-history">
        {history.slice(0, 14).map((item) => (
          <button
            key={item.id}
            type="button"
            className={item.reportId === report.id ? 'active' : ''}
            onClick={() => onSelectReport(item.reportId)}
          >
            <span>{formatShortDate(item.tradeDate)}</span>
            <strong className={item.score >= 70 ? 'up' : item.score >= 45 ? '' : 'down'}>{item.score}</strong>
          </button>
        ))}
      </div>
    </section>
  ) : null;
  if (!review) {
    return (
      <div className="rv-stack">
        {historySection}
        <div className="rv-empty compact"><RotateCcw size={28} /><strong>尚未生成收盘复盘</strong><span>将报告与已记录的盘中状态逐项对照，不使用事后信息改写原判断。</span><button type="button" onClick={onCreate}><Play size={13} />生成复盘</button></div>
      </div>
    );
  }
  return (
    <div className="rv-stack">
      {historySection}
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

// ---- 净值回测 --------------------------------------------------------------

interface BacktestPreset {
  label: string;
  config: Partial<ThemeBacktestConfig>;
}

const BACKTEST_PRESETS: BacktestPreset[] = [
  { label: '龙头 T+1', config: { name: 'Top1·龙头·T+1', stockRole: '龙头', roleRank: 1, holdingDays: 1 } },
  { label: '中军 T+1', config: { name: 'Top1·第一中军·T+1', stockRole: '中军', roleRank: 1, holdingDays: 1 } },
  { label: '中军 T+3', config: { name: 'Top1·第一中军·T+3', stockRole: '中军', roleRank: 1, holdingDays: 3 } },
  { label: '趋势核心 T+2', config: { name: 'Top1·趋势核心·T+2', stockRole: '趋势核心', roleRank: 1, holdingDays: 2 } },
  { label: '补涨 T+1', config: { name: 'Top1·补涨·T+1', stockRole: '补涨', roleRank: 1, holdingDays: 1 } },
];

const SCAN_ROLES = ['龙头', '中军', '趋势核心', '补涨'];
const SCAN_HOLDING_DAYS = [1, 2, 3, 5];

interface ScanCell {
  role: string;
  holdingDays: number;
  totalReturnPct: number;
  winRatePct: number;
  sampleCount: number;
}

function CalibrationView({ reports, reviews }: { reports: PremarketThemeRun[]; reviews: ThemeDailyReview[] }) {
  const calibration = useMemo(() => buildResearchCalibration(reports, reviews), [reports, reviews]);
  const pct = (value: number | null) => value === null ? '—' : `${(value * 100).toFixed(1)}%`;
  const score = (value: number | null) => value === null ? '—' : value.toFixed(3);
  const biasLabel = calibration.bias === null
    ? '—'
    : Math.abs(calibration.bias) < 0.03
      ? '基本平衡'
      : calibration.bias > 0 ? '整体高估' : '整体低估';
  return <div className="rv-calibration">
    <section className="rv-section">
      <header><div><strong>概率可靠性</strong><span>盘前预测 × 不可变收盘复盘</span></div><button type="button" onClick={() => insertIntoComposer('使用 $alpha-studio-research-calibration 深度审计当前 Alpha Studio 日报概率与复盘结果；严格沿用工作台的结果定义，不自行补标签。')}><Activity size={13} />Agent 审计</button></header>
      <div className="rv-calibration-metrics">
        <div><span>有效样本</span><strong>{calibration.sampleCount}</strong><em>{calibration.reportCount} 份报告</em></div>
        <div><span>Brier 分数</span><strong>{score(calibration.brierScore)}</strong><em>越低越好</em></div>
        <div><span>平均预测</span><strong>{pct(calibration.meanProbability)}</strong><em>事前概率</em></div>
        <div><span>实际兑现</span><strong>{pct(calibration.meanOutcome)}</strong><em>触发审计结果</em></div>
        <div><span>平均绝对误差</span><strong>{score(calibration.meanAbsoluteError)}</strong><em>MAE</em></div>
        <div className={calibration.bias && calibration.bias > 0.03 ? 'warn' : ''}><span>方向偏差</span><strong>{pct(calibration.bias)}</strong><em>{biasLabel}</em></div>
      </div>
      <p className={`rv-calibration-note ${calibration.sampleSufficient ? '' : 'warn'}`}><AlertTriangle size={12} />{calibration.sampleSufficient ? `已达到基础校准样本阈值；另有 ${calibration.excludedCount} 个主题因缺少可解析概率或有效复盘而排除。` : `当前仅 ${calibration.sampleCount} 个有效样本，低于 20 个基础阈值；先积累数据，不据此调整核心规则。另排除 ${calibration.excludedCount} 个主题。`}</p>
    </section>
    <section className="rv-section">
      <header><div><strong>可靠性分桶</strong><span>同一概率区间的预测与兑现对照</span></div></header>
      {calibration.buckets.length ? <div className="rv-calibration-buckets">{calibration.buckets.map((bucket) => <article key={bucket.label}>
        <header><strong>{bucket.label}</strong><span>{bucket.count} 个样本</span></header>
        <div className="rv-calibration-track"><i style={{ width: `${bucket.meanProbability * 100}%` }} /><b style={{ left: `${Math.min(100, bucket.meanOutcome * 100)}%` }} /></div>
        <footer><span>预测 {pct(bucket.meanProbability)}</span><span>兑现 {pct(bucket.meanOutcome)}</span><em className={Math.abs(bucket.bias) >= 0.1 ? 'warn' : ''}>{bucket.bias > 0 ? '高估' : bucket.bias < 0 ? '低估' : '平衡'} {pct(Math.abs(bucket.bias))}</em></footer>
      </article>)}</div> : <div className="rv-empty-inline">完成至少一份含可解析概率和触发复盘的日报后显示分桶。</div>}
      <p className="rv-calibration-definition">口径：hit=1、partial=0.5、not_triggered/miss=0、data_missing 排除；同一主题多个触发取平均。本页评估“触发兑现概率”，不代表收益率或可成交性。</p>
    </section>
  </div>;
}

function BacktestView({ reports, events, runs, onRun }: { reports: PremarketThemeRun[]; events: ThemeTrackingEvent[]; runs: ThemeBacktestRun[]; onRun: (run: ThemeBacktestRun) => void }) {
  const [config, setConfig] = useState<ThemeBacktestConfig>(DEFAULT_THEME_BACKTEST_CONFIG);
  const [running, setRunning] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');
  const [activeRun, setActiveRun] = useState<ThemeBacktestRun | null>(runs[0] ?? null);
  const [scanResults, setScanResults] = useState<ScanCell[] | null>(null);

  const dateRange = useCallback(() => {
    const eligible = reports.filter((report) => report.tradeDate);
    if (!eligible.length) throw new Error('没有带交易日期的结构化报告。');
    const dates = eligible.map((report) => report.tradeDate).sort();
    const start = config.dateFrom || dates[0];
    const endBase = config.dateTo || dates[dates.length - 1];
    const endDate = new Date(`${endBase}T00:00:00+08:00`);
    endDate.setDate(endDate.getDate() + 12);
    const end = endDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
    return { start, end };
  }, [config.dateFrom, config.dateTo, reports]);

  const requireJq = useCallback(async () => {
    const jqConfig = await loadJqDataConfig();
    if (!jqConfig.enabled || !jqConfig.passwordConfigured) throw new Error('净值回测需要先在设置中启用 JQData；不会使用样例行情代替。');
  }, []);

  const execute = useCallback(async () => {
    setRunning(true);
    setError('');
    try {
      await requireJq();
      const { start, end } = dateRange();
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
  }, [config, dateRange, events, onRun, reports, requireJq]);

  const scan = useCallback(async () => {
    setScanning(true);
    setError('');
    try {
      await requireJq();
      const { start, end } = dateRange();
      const codes = new Set<string>();
      for (const role of SCAN_ROLES) {
        const scanConfig = { ...config, stockRole: role, roleRank: 1 };
        for (const report of eligibleOpenReports(reports, scanConfig)) {
          const candidate = selectBacktestCandidate(report, scanConfig);
          if (candidate?.stock.code) codes.add(candidate.stock.code);
        }
      }
      if (!codes.size) throw new Error('没有可用于扫描的角色标的。');
      const dailyEntries = await Promise.all(Array.from(codes).map(async (code) =>
        [code, toBacktestBars(await fetchJqHistoricalBars(code, start, end, '1d', { fq: 'pre' }))] as const));
      const benchmark = toBacktestBars(await fetchJqHistoricalBars(config.benchmarkCode, start, end, '1d', { fq: 'pre' }));
      if (!benchmark.length) throw new Error('JQData 未返回沪深300基准行情。');
      const dailyBarsByCode = new Map(dailyEntries);
      const cells: ScanCell[] = [];
      for (const role of SCAN_ROLES) {
        for (const holdingDays of SCAN_HOLDING_DAYS) {
          const run = runThemeBacktest({
            reports,
            events,
            dailyBarsByCode,
            benchmarkBars: benchmark,
            config: { ...config, stockRole: role, roleRank: 1, holdingDays, name: `扫描·${role}·T+${holdingDays}` },
            dataSource: 'jqdata',
            dataVersion: new Date().toISOString(),
          });
          cells.push({
            role,
            holdingDays,
            totalReturnPct: run.metrics.totalReturnPct,
            winRatePct: run.metrics.winRatePct,
            sampleCount: run.metrics.sampleCount,
          });
        }
      }
      setScanResults(cells);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setScanning(false);
    }
  }, [config, dateRange, events, reports, requireJq]);

  return (
    <div className="rv-stack">
      <div className="rv-presets" role="group" aria-label="策略预设">
        {BACKTEST_PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            className={preset.config.stockRole === config.stockRole && preset.config.holdingDays === config.holdingDays ? 'active' : ''}
            onClick={() => setConfig({ ...config, ...preset.config })}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <section className="rv-section rv-backtest-config">
        <header>
          <div><strong>{config.name}</strong><span>信号曲线 + 可执行净值 · 防未来函数</span></div>
          <div className="rv-backtest-actions">
            <button type="button" onClick={() => insertIntoComposer([
              '请通过对话回测 Alpha Studio 每日结构化日报。',
              `策略：题材排名 ${config.themeRank}，角色 ${config.stockRole} 第 ${config.roleRank} 顺位，持有 T+${config.holdingDays}。`,
              `范围：${config.dateFrom || '最早留档日'} 至 ${config.dateTo || '最新留档日'}。`,
              `成本：佣金率 ${config.commissionRate}，最低佣金 ${config.minimumCommission} 元，印花税率 ${config.stampDutyRate}，滑点 ${config.slippageBps}bp。`,
              '请严格使用事前报告快照和已留痕触发事件，排除未来函数，并给出样本、净值、最大回撤、胜率、超额收益、未成交与数据缺口。',
            ].join('\n'))}><MessageSquarePlus size={13} />对话回测</button>
            <button type="button" onClick={() => void scan()} disabled={scanning || running}>{scanning ? <Loader2 size={13} className="spin" /> : <Crosshair size={13} />}扫描矩阵</button>
            <button type="button" className="primary" onClick={() => void execute()} disabled={running || scanning}>{running ? <Loader2 size={13} className="spin" /> : <Play size={13} />}运行</button>
          </div>
        </header>
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
      {scanResults ? (
        <section className="rv-section">
          <header><div><strong>角色 × 持有期扫描</strong><span>信号毛收益（不含费用/成交约束）；点击单元格套用配置</span></div></header>
          <div className="rv-scan-grid" style={{ gridTemplateColumns: `64px repeat(${SCAN_HOLDING_DAYS.length}, minmax(0, 1fr))` }}>
            <span className="rv-scan-head" />
            {SCAN_HOLDING_DAYS.map((days) => <span key={days} className="rv-scan-head">T+{days}</span>)}
            {SCAN_ROLES.map((role) => (
              <ScanRow
                key={role}
                role={role}
                cells={scanResults.filter((cell) => cell.role === role)}
                onPick={(cell) => setConfig({ ...config, stockRole: cell.role, roleRank: 1, holdingDays: cell.holdingDays, name: `Top1·${cell.role}·T+${cell.holdingDays}` })}
              />
            ))}
          </div>
        </section>
      ) : null}
      {runs.length > 1 ? (
        <section className="rv-section">
          <header><div><strong>历史回测记录</strong><span>最近 {Math.min(runs.length, 8)} 次，点击查看</span></div></header>
          <div className="rv-run-history">
            {runs.slice(0, 8).map((run) => (
              <button key={run.id} type="button" className={activeRun?.id === run.id ? 'active' : ''} onClick={() => setActiveRun(run)}>
                <span>{formatDateTime(run.createdAt)}</span>
                <strong>{run.config.name}</strong>
                <em className={run.metrics.totalReturnPct >= 0 ? 'up' : 'down'}>{formatPercent(run.metrics.totalReturnPct)}</em>
              </button>
            ))}
          </div>
        </section>
      ) : null}
      {activeRun ? <BacktestResults run={activeRun} /> : <div className="rv-empty compact"><BarChart3 size={24} /><strong>等待第一次可信回测</strong><span>只使用结构化报告和 JQData 历史行情，缺失样本会留在排除清单。</span></div>}
    </div>
  );
}

function ScanRow({ role, cells, onPick }: { role: string; cells: ScanCell[]; onPick: (cell: ScanCell) => void }) {
  return (
    <>
      <span className="rv-scan-role">{role}</span>
      {cells.map((cell) => (
        <button
          key={`${cell.role}:${cell.holdingDays}`}
          type="button"
          className={`rv-scan-cell ${cell.sampleCount ? (cell.totalReturnPct >= 0 ? 'up' : 'down') : 'empty'}`}
          onClick={() => onPick(cell)}
          title={`${role} T+${cell.holdingDays} · 胜率 ${cell.winRatePct.toFixed(0)}% · ${cell.sampleCount} 笔`}
        >
          <strong>{cell.sampleCount ? formatPercent(cell.totalReturnPct) : '—'}</strong>
          <span>{cell.sampleCount ? `${cell.winRatePct.toFixed(0)}% · ${cell.sampleCount}笔` : '无样本'}</span>
        </button>
      ))}
    </>
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
