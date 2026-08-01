import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  FileChartColumn,
  Loader2,
  MessageSquarePlus,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Target,
  X,
} from 'lucide-react';
import { coworkerSelectionsByIds } from './coworkers';
import {
  AI_RISK_LABELS,
  DAILY_DECISION_CHANGED_EVENT,
  RECOMMENDATION_ACTION_LABELS,
  RECOMMENDATION_PRIORITY_LABELS,
  beginJointResearch,
  buildJointResearchPrompt,
  buildRiskAssessmentPrompt,
  createDecisionId,
  createRecommendationFromRun,
  currentRiskAssessment,
  decideRecommendation,
  failJointResearch,
  loadDailyDecisionState,
  markJointResearchRunning,
  updateRecommendation,
  type DailyDecisionState,
  type JointResearchRun,
  type RecommendationAction,
  type RecommendationPriority,
  type ResearchRecommendation,
} from './dailyDecision';
import { insertIntoComposer } from './composerBridge';
import { fetchCloudRealtimeBatch } from './cloudMarket';
import { buildQuoteMap, loadResearchState, sectorExposure, researchAccountSummary } from './research';
import { useChatStore, useCurrentConversation } from './store';
import {
  ALPHA_STUDIO_DAILY_THEME_SKILL_ID,
  ALPHA_STUDIO_DAILY_THEME_SKILL_TITLE,
  PREMARKET_THEME_RUNS_CHANGED_EVENT,
  loadPremarketThemeRuns,
  type PremarketTheme,
  type PremarketThemeRun,
} from './themeResearch';

type DailyDecisionTab = 'summary' | 'themes' | 'research' | 'recommendations';

const TAB_LABELS: Record<DailyDecisionTab, string> = {
  summary: '今日摘要',
  themes: '主题',
  research: '联合研判',
  recommendations: '建议卡',
};

export function DailyDecisionPanel() {
  const conversation = useCurrentConversation();
  const sendMessageToConversation = useChatStore((state) => state.sendMessageToConversation);
  const [reports, setReports] = useState(() => loadPremarketThemeRuns());
  const [decisionState, setDecisionState] = useState(() => loadDailyDecisionState());
  const [tab, setTab] = useState<DailyDecisionTab>('summary');
  const [selectedReportId, setSelectedReportId] = useState('');
  const [selection, setSelection] = useState<{ themeId: string; stockCodes: string[] }>({ themeId: '', stockCodes: [] });
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const handleReports = () => setReports(loadPremarketThemeRuns());
    const handleDecision = () => setDecisionState(loadDailyDecisionState());
    window.addEventListener(PREMARKET_THEME_RUNS_CHANGED_EVENT, handleReports);
    window.addEventListener(DAILY_DECISION_CHANGED_EVENT, handleDecision);
    return () => {
      window.removeEventListener(PREMARKET_THEME_RUNS_CHANGED_EVENT, handleReports);
      window.removeEventListener(DAILY_DECISION_CHANGED_EVENT, handleDecision);
    };
  }, []);

  const conversationReports = useMemo(() => reports
    .filter((report) => report.sourceConversationId === conversation?.id)
    .sort((left, right) => Date.parse(right.generatedAt) - Date.parse(left.generatedAt)), [conversation?.id, reports]);
  const report = conversationReports.find((item) => item.id === selectedReportId) ?? conversationReports[0] ?? null;
  const hasDailyThemeTurn = Boolean(conversation?.messages.some((message) => message.role === 'user' && (
    message.selectedSkill?.id === ALPHA_STUDIO_DAILY_THEME_SKILL_ID
    || message.blocks.some((block) => block.type === 'text' && block.content.includes(ALPHA_STUDIO_DAILY_THEME_SKILL_ID))
  )));
  const latestUserMessage = [...(conversation?.messages ?? [])].reverse().find((message) => message.role === 'user');
  const latestTurnIsDailyTheme = Boolean(latestUserMessage && (
    latestUserMessage.selectedSkill?.id === ALPHA_STUDIO_DAILY_THEME_SKILL_ID
    || latestUserMessage.blocks.some((block) => block.type === 'text' && block.content.includes(ALPHA_STUDIO_DAILY_THEME_SKILL_ID))
  ));
  const latestAssistantMessage = [...(conversation?.messages ?? [])].reverse().find((message) => message.role === 'assistant' && message.timestamp >= (latestUserMessage?.timestamp ?? 0));
  const latestDailyTurnUnstructured = latestTurnIsDailyTheme
    && conversation?.status !== 'streaming'
    && Boolean(latestAssistantMessage)
    && !conversationReports.some((item) => item.sourceMessageId === latestAssistantMessage?.id);

  useEffect(() => {
    setSelectedReportId(conversationReports[0]?.id ?? '');
    setSelection({ themeId: conversationReports[0]?.themes[0]?.id ?? '', stockCodes: [] });
    setTab('summary');
    setNotice('');
  }, [conversation?.id, conversationReports[0]?.id]);

  const reportRuns = decisionState.jointResearchRuns.filter((run) => run.reportId === report?.id);
  const reportRecommendations = decisionState.recommendations.filter((item) => item.reportId === report?.id);

  const requestStructureRepair = useCallback(() => {
    if (!conversation) return;
    const prompt = [
      '请根据本对话中刚生成的盘前主题日报，补充输出完整的 alpha.premarket_theme.v2 结构化 JSON。',
      '不要重写整份报告；只补全工作台入库所需 JSON，必须包含执行闸门、资金进攻路径、市场情绪、主题、角色标的、风险、触发和失效条件。',
    ].join('\n');
    void sendMessageToConversation(conversation.id, prompt, undefined, {
      id: ALPHA_STUDIO_DAILY_THEME_SKILL_ID,
      title: ALPHA_STUDIO_DAILY_THEME_SKILL_TITLE,
    });
    setNotice('已在当前对话请求补全结构化日报。');
  }, [conversation, sendMessageToConversation]);

  const runJointResearch = useCallback(async (theme: PremarketTheme, stockCodes: string[]) => {
    if (!conversation || !report || conversation.status === 'streaming') {
      setNotice(conversation?.status === 'streaming' ? '当前对话仍在运行，请完成后再发起联合研判。' : '当前没有可研判的日报。');
      return;
    }
    const chosenStocks = theme.stocks.filter((stock) => stock.code && stockCodes.includes(stock.code));
    const run = beginJointResearch({
      id: createDecisionId('joint'),
      reportId: report.id,
      reportContentHash: report.contentHash,
      conversationId: conversation.id,
      selection: {
        themeId: theme.id,
        themeName: theme.name,
        stockCodes: chosenStocks.map((stock) => stock.code!),
        stockNames: chosenStocks.map((stock) => stock.name),
      },
    });
    setTab('research');
    setNotice('');
    try {
      const researchState = loadResearchState();
      const codes = Array.from(new Set([
        ...chosenStocks.map((stock) => stock.code!).filter(Boolean),
        ...researchState.watchlist,
        ...researchState.holdings.map((holding) => holding.code),
      ]));
      const live = codes.length ? await fetchCloudRealtimeBatch(codes) : null;
      const quotes = buildQuoteMap(researchState, live?.prices ?? undefined);
      const summary = researchAccountSummary(researchState, quotes);
      const context = [
        `行情时点：${live?.asOfLabel || '未取得最新行情'}`,
        `现金：${researchState.cash.toFixed(2)}`,
        `自选：${researchState.watchlist.map((code) => quotes.get(code)?.name ? `${quotes.get(code)!.name}(${code})` : code).join('、') || '无'}`,
        `持仓：${[
          ...summary.holdings.map((row) => `${row.quote.name} ${row.code}${summary.valuationComplete ? ` ${row.weightPct.toFixed(2)}%` : ' 占比待行情完整后计算'}`),
          ...summary.unpricedHoldings.map((row) => `${row.quote?.name ?? row.code} ${row.code} 缺少可信行情`),
        ].join('；') || '无'}`,
        `行业暴露：${sectorExposure(summary).map((row) => `${row.sector} ${row.pct.toFixed(2)}%`).join('；') || '无'}`,
        `组合：${researchState.portfolios.map((portfolio) => `${portfolio.name}(${portfolio.codes.join('、')})`).join('；') || '无'}`,
        `所选标的行情：${chosenStocks.map((stock) => {
          const quote = stock.code ? quotes.get(stock.code) : undefined;
          return `${stock.name}${quote ? ` ${quote.price.toFixed(2)} ${quote.changePct >= 0 ? '+' : ''}${quote.changePct.toFixed(2)}%` : ' 暂无行情'}`;
        }).join('；') || '主题级研判'}`,
      ].join('\n');
      const prompt = buildJointResearchPrompt({
        run,
        reportContext: {
          tradeDate: report.tradeDate,
          dataCutoff: report.dataCutoff,
          executionGate: report.executionGate,
          capitalAttackPath: report.capitalAttackPath,
          marketSentiment: report.marketSentiment,
          theme,
          risks: report.risks,
          sourceNotes: report.sourceNotes,
        },
        researchContext: context,
      });
      await sendMessageToConversation(
        conversation.id,
        prompt,
        undefined,
        undefined,
        coworkerSelectionsByIds(['mainline', 'risk']),
      );
      markJointResearchRunning(run.id);
    } catch (error) {
      failJointResearch(run.id, error instanceof Error ? error.message : String(error));
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }, [conversation, report, sendMessageToConversation]);

  if (!conversation) return <DecisionEmpty title="日报决策" text="请选择一个对话。" />;
  if (!report) {
    return (
      <section className="dd-panel right-dock-panel" aria-label="日报决策">
        <DecisionHeader />
        <DecisionEmpty
          title={hasDailyThemeTurn ? '日报尚未结构化入库' : '当前对话没有结构化日报'}
          text={hasDailyThemeTurn ? '报告正文已经生成，但没有找到完整的工作台 JSON。可以让 AI 在当前对话补全一次。' : '请先使用 Alpha Studio 盘前主题 Skill 生成当天日报。'}
          action={hasDailyThemeTurn ? <button type="button" onClick={requestStructureRepair}><Sparkles size={13} />AI补全结构化数据</button> : undefined}
        />
        {notice && <p className="dd-notice">{notice}</p>}
      </section>
    );
  }

  return (
    <section className="dd-panel right-dock-panel" aria-label="日报决策">
      <DecisionHeader>
        {conversationReports.length > 1 && (
          <select value={report.id} onChange={(event) => setSelectedReportId(event.target.value)} aria-label="日报版本">
            {conversationReports.map((item, index) => <option key={item.id} value={item.id}>{index === 0 ? '最新 · ' : ''}{item.tradeDate} · {shortTime(item.generatedAt)}</option>)}
          </select>
        )}
      </DecisionHeader>
      <nav className="dd-tabs" role="tablist" aria-label="日报决策页签">
        {(Object.keys(TAB_LABELS) as DailyDecisionTab[]).map((key, index) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} data-index={String(index + 1).padStart(2, '0')} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>
            {TAB_LABELS[key]}
            {key === 'research' && reportRuns.length > 0 && <em>{reportRuns.length}</em>}
            {key === 'recommendations' && reportRecommendations.length > 0 && <em>{reportRecommendations.length}</em>}
          </button>
        ))}
      </nav>
      <div className="dd-body">
        {latestDailyTurnUnstructured && (
          <div className="dd-structure-warning"><AlertTriangle size={14} /><span>最新日报回复没有合格的结构化 JSON，当前仍显示上一版本。</span><button type="button" onClick={requestStructureRepair}><Sparkles size={12} />AI补全结构化数据</button></div>
        )}
        {report.id !== conversationReports[0]?.id && <p className="dd-notice">当前查看的是历史日报版本；其研判和建议仍保留，但来源已经更新。</p>}
        {notice && <p className="dd-notice">{notice}</p>}
        {tab === 'summary' && <DailySummary report={report} />}
        {tab === 'themes' && (
          <ThemeSelection
            report={report}
            selection={selection}
            onSelectionChange={setSelection}
            onResearch={(theme, stockCodes) => void runJointResearch(theme, stockCodes)}
          />
        )}
        {tab === 'research' && (
          <JointResearchView
            runs={reportRuns}
            report={report}
            onCreateRecommendation={(run) => {
              const recommendation = createRecommendationFromRun(run, report.dataCutoff);
              if (recommendation) setTab('recommendations');
            }}
            onRetry={(run) => {
              const theme = report.themes.find((item) => item.id === run.selection.themeId);
              if (theme) void runJointResearch(theme, run.selection.stockCodes);
            }}
            onContinue={(run) => {
              insertIntoComposer(`继续追问本次联合研判（${run.id}，${run.selection.themeName}）：`);
            }}
            onAbandon={(run) => failJointResearch(run.id, '用户已放弃本次研究；迟到的结构化结果不会写入建议卡。')}
          />
        )}
        {tab === 'recommendations' && (
          <RecommendationList
            recommendations={reportRecommendations}
            state={decisionState}
            conversationStreaming={conversation.status === 'streaming'}
            onRiskReview={(recommendation) => {
              if (conversation.status === 'streaming') {
                setNotice('当前对话仍在运行，请完成后再重新评估风险。');
                return;
              }
              void sendMessageToConversation(
                conversation.id,
                buildRiskAssessmentPrompt(recommendation),
                undefined,
                undefined,
                coworkerSelectionsByIds(['risk']),
              );
            }}
          />
        )}
      </div>
    </section>
  );
}

function DecisionHeader({ children }: { children?: ReactNode }) {
  return (
    <header className="dd-head">
      <div className="dd-head-copy">
        <div className="dd-head-kicker"><span>DAILY DECISION</span><em>LOCAL RESEARCH LOOP</em></div>
        <div className="dd-head-title"><FileChartColumn size={15} /><strong>日报决策</strong><span><i />研究闭环在线</span></div>
      </div>
      {children && <div className="dd-head-tools">{children}</div>}
    </header>
  );
}

function DecisionEmpty({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return <div className="dd-empty"><em>NO ACTIVE REPORT / WAITING FOR DATA</em><FileChartColumn size={28} /><strong>{title}</strong><span>{text}</span>{action}</div>;
}

function DailySummary({ report }: { report: PremarketThemeRun }) {
  return (
    <div className="dd-stack">
      <section className="dd-hero">
        <div><span>{report.tradeDate}</span><em>{report.reportMode}</em></div>
        <h2>{report.title}</h2>
        <p>生成 {formatDateTime(report.generatedAt)} · 数据截止 {formatDateTime(report.dataCutoff)}</p>
        <strong>{report.executionGate.state}</strong>
      </section>
      <section className="dd-section">
        <header><Target size={14} /><strong>资金进攻路径</strong><em>{report.capitalAttackPath.todayAttackProbability}</em></header>
        <dl className="dd-paths">
          <div><dt>主路径</dt><dd>{report.capitalAttackPath.primaryRoute || '未给出'}</dd></div>
          <div><dt>备选</dt><dd>{report.capitalAttackPath.backupRoute || '未给出'}</dd></div>
          <div><dt>失效</dt><dd>{report.capitalAttackPath.invalidationRoute || '未给出'}</dd></div>
        </dl>
        <p>{report.capitalAttackPath.rationale}</p>
      </section>
      <section className="dd-section"><header><Sparkles size={14} /><strong>市场情绪</strong></header><p>{report.marketSentiment}</p></section>
      <TwoColumnRules title="今日执行纪律" positive={report.executionGate.todayOnlyDo} negative={report.executionGate.todayDoNotDo} />
      <ListSection icon={<AlertTriangle size={14} />} title="主要风险" items={report.risks} />
      <ListSection icon={<ClipboardCheck size={14} />} title="来源说明" items={report.sourceNotes} />
    </div>
  );
}

function ThemeSelection({
  report,
  selection,
  onSelectionChange,
  onResearch,
}: {
  report: PremarketThemeRun;
  selection: { themeId: string; stockCodes: string[] };
  onSelectionChange: (next: { themeId: string; stockCodes: string[] }) => void;
  onResearch: (theme: PremarketTheme, stockCodes: string[]) => void;
}) {
  return (
    <div className="dd-stack">
      {[...report.themes].sort((a, b) => a.rank - b.rank).map((theme) => {
        const active = selection.themeId === theme.id;
        const selectedCodes = active ? selection.stockCodes : [];
        return (
          <section key={theme.id} className={`dd-theme-card ${active ? 'active' : ''}`}>
            <header onClick={() => onSelectionChange({ themeId: theme.id, stockCodes: [] })}>
              <div><strong>#{theme.rank} {theme.name}</strong><span>{theme.grade} · {theme.lifecycle} · {theme.capitalType}</span></div>
              <em>{theme.todayAttackProbability}</em>
            </header>
            <p>{theme.conclusion}</p>
            <div className="dd-theme-meta"><span>触发 · {theme.triggers.join('；') || '未给出'}</span><span>失效 · {theme.invalidation || '未给出'}</span><span>风险 · {theme.risk || '未给出'}</span></div>
            <div className="dd-stock-matrix">
              {theme.stocks.map((stock) => {
                const code = stock.code || '';
                const selected = Boolean(code && selectedCodes.includes(code));
                return (
                  <div key={`${stock.code}:${stock.name}`} className="dd-stock-row">
                    <button type="button" className={selected ? 'selected' : ''} disabled={!code} onClick={() => {
                      const next = selected ? selectedCodes.filter((item) => item !== code) : [...selectedCodes, code];
                      onSelectionChange({ themeId: theme.id, stockCodes: next });
                    }}>
                      <span>{stock.role || '标的'}{stock.roleRank > 1 ? ` ${stock.roleRank}` : ''}</span>
                      <strong>{stock.name}</strong>
                      <em>{stock.code || '缺代码'}</em>
                      {selected && <Check size={12} />}
                    </button>
                    <button type="button" className="dd-stock-research" disabled={!code} onClick={() => onResearch(theme, code ? [code] : [])}>研究该标的</button>
                  </div>
                );
              })}
            </div>
            <footer>
              <button type="button" className="primary" onClick={() => onResearch(theme, selectedCodes)}><MessageSquarePlus size={13} />{selectedCodes.length ? `研判所选 ${selectedCodes.length} 只` : '①⑦⑧联合研判'}</button>
            </footer>
          </section>
        );
      })}
    </div>
  );
}

function JointResearchView({
  runs,
  report,
  onCreateRecommendation,
  onRetry,
  onContinue,
  onAbandon,
}: {
  runs: JointResearchRun[];
  report: PremarketThemeRun;
  onCreateRecommendation: (run: JointResearchRun) => void;
  onRetry: (run: JointResearchRun) => void;
  onContinue: (run: JointResearchRun) => void;
  onAbandon: (run: JointResearchRun) => void;
}) {
  if (!runs.length) return <DecisionEmpty title="还没有联合研判" text="到“主题”中选择主题或标的，召集①⑦⑧形成联合结论。" />;
  return (
    <div className="dd-stack">
      {runs.map((run) => (
        <section key={run.id} className={`dd-research-card status-${run.status}`}>
          <header><div><strong>{run.selection.themeName}{run.selection.stockNames.length ? ` / ${run.selection.stockNames.join('、')}` : ''}</strong><span>{run.id} · 来源 {report.tradeDate} · {run.reportContentHash.slice(0, 10)}</span></div><StatusPill status={run.status} /></header>
          {run.status === 'running' && <div className="dd-running"><Loader2 size={15} className="spin" /><span>{jointResearchProgressText(run)}</span><button type="button" onClick={() => onAbandon(run)}>放弃本次研究</button></div>}
          {run.status === 'pending' && <div className="dd-running"><Clock3 size={15} /><span>正在整理行情、自选、持仓、组合与行业暴露上下文。</span><button type="button" onClick={() => onAbandon(run)}>放弃本次研究</button></div>}
          {run.status === 'failed' && <div className="dd-error"><AlertTriangle size={14} />{run.error || '结构化研判失败'}<button type="button" onClick={() => onRetry(run)}><RefreshCw size={12} />重新研判</button></div>}
          {run.conclusion && (
            <>
              <div className="dd-conclusion"><strong>{RECOMMENDATION_ACTION_LABELS[run.conclusion.action]} · {RECOMMENDATION_PRIORITY_LABELS[run.conclusion.priority]}优先级</strong><p>{run.conclusion.summary}</p></div>
              <Opinion title="① 主线判断" text={run.conclusion.mainlineView} />
              <Opinion title="⑦ AI风险分析" text={run.conclusion.riskView} />
              <Opinion title="⑧ 综合取舍" text={run.conclusion.pmView} />
              {run.conclusion.disagreements.length > 0 && <ListSection icon={<AlertTriangle size={14} />} title="核心分歧" items={run.conclusion.disagreements} />}
              <TwoColumnRules title="触发与失效" positive={run.conclusion.triggers} negative={run.conclusion.invalidations} />
              <footer className="dd-actions"><button type="button" className="primary" onClick={() => onCreateRecommendation(run)}>形成建议卡<ChevronRight size={13} /></button><button type="button" onClick={() => onContinue(run)}>继续追问</button></footer>
            </>
          )}
        </section>
      ))}
    </div>
  );
}

function RecommendationList({
  recommendations,
  state,
  conversationStreaming,
  onRiskReview,
}: {
  recommendations: ResearchRecommendation[];
  state: DailyDecisionState;
  conversationStreaming: boolean;
  onRiskReview: (recommendation: ResearchRecommendation) => void;
}) {
  const [expandedId, setExpandedId] = useState(recommendations[0]?.id ?? '');
  if (!recommendations.length) return <DecisionEmpty title="还没有建议卡" text="完成联合研判后，点击“形成建议卡”。" />;
  return <div className="dd-stack">{recommendations.map((recommendation) => (
    <RecommendationEditor
      key={recommendation.id}
      recommendation={recommendation}
      state={state}
      expanded={expandedId === recommendation.id}
      onToggle={() => setExpandedId(expandedId === recommendation.id ? '' : recommendation.id)}
      onRiskReview={onRiskReview}
      conversationStreaming={conversationStreaming}
    />
  ))}</div>;
}

function RecommendationEditor({ recommendation, state, expanded, onToggle, onRiskReview, conversationStreaming }: {
  recommendation: ResearchRecommendation;
  state: DailyDecisionState;
  expanded: boolean;
  onToggle: () => void;
  onRiskReview: (recommendation: ResearchRecommendation) => void;
  conversationStreaming: boolean;
}) {
  const [draft, setDraft] = useState(recommendation);
  const [decisionNote, setDecisionNote] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState('');
  const risk = currentRiskAssessment(state, recommendation);
  useEffect(() => setDraft(recommendation), [recommendation]);
  const save = () => {
    const next = updateRecommendation(recommendation.id, {
      themeName: draft.themeName,
      stockCodes: draft.stockCodes,
      stockNames: draft.stockNames,
      action: draft.action,
      priority: draft.priority,
      suggestedWeight: draft.suggestedWeight,
      priceRange: draft.priceRange,
      reviewAt: draft.reviewAt,
      thesis: draft.thesis,
      counterArguments: draft.counterArguments,
      triggers: draft.triggers,
      invalidations: draft.invalidations,
      userNote: draft.userNote,
    });
    setError(next?.status === 'risk_stale' ? '关键字段已修改，请重新执行 AI 风险评估。' : '');
  };
  const decide = (decision: 'confirmed' | 'deferred' | 'rejected') => {
    const result = decideRecommendation(recommendation.id, decision, { note: decisionNote, reviewAt: draft.reviewAt, acknowledged });
    setError(result.error || '');
  };
  return (
    <section className={`dd-rec-card status-${recommendation.status}`}>
      <header onClick={onToggle}><div><strong>{recommendation.themeName}{recommendation.stockNames.length ? ` / ${recommendation.stockNames.join('、')}` : ''}</strong><span>{recommendation.id} · v{recommendation.version}</span></div><RecommendationStatus status={recommendation.status} /></header>
      {!expanded ? <p>{RECOMMENDATION_ACTION_LABELS[recommendation.action]} · {RECOMMENDATION_PRIORITY_LABELS[recommendation.priority]}优先级</p> : (
        <div className="dd-rec-form">
          <div className="dd-form-grid">
            <label>研究主题<input value={draft.themeName} onChange={(event) => setDraft({ ...draft, themeName: event.target.value })} /></label>
            <label>研究标的<input value={draft.stockNames.join('、')} onChange={(event) => setDraft({ ...draft, stockNames: splitInlineList(event.target.value) })} placeholder="多个标的以顿号或逗号分隔" /></label>
            <label>标的代码<input value={draft.stockCodes.join('、')} onChange={(event) => setDraft({ ...draft, stockCodes: splitInlineList(event.target.value) })} placeholder="多个代码以顿号或逗号分隔" /></label>
            <label>建议动作<select value={draft.action} onChange={(event) => setDraft({ ...draft, action: event.target.value as RecommendationAction })}>{Object.entries(RECOMMENDATION_ACTION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label>优先级<select value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: event.target.value as RecommendationPriority })}>{Object.entries(RECOMMENDATION_PRIORITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label>研究/模拟权重<input value={draft.suggestedWeight} onChange={(event) => setDraft({ ...draft, suggestedWeight: event.target.value })} /></label>
            <label>观察价格区间<input value={draft.priceRange} onChange={(event) => setDraft({ ...draft, priceRange: event.target.value })} /></label>
            <label>复核时间<input value={draft.reviewAt} onChange={(event) => setDraft({ ...draft, reviewAt: event.target.value })} placeholder="如 10:30 或 2026-07-20" /></label>
          </div>
          <p className="dd-data-cutoff">数据时点：{recommendation.dataCutoff || '未给出'} · 当前版本 v{recommendation.version}</p>
          <ListEditor label="核心依据" value={draft.thesis} onChange={(value) => setDraft({ ...draft, thesis: value })} />
          <ListEditor label="反对理由" value={draft.counterArguments} onChange={(value) => setDraft({ ...draft, counterArguments: value })} />
          <ListEditor label="触发条件" value={draft.triggers} onChange={(value) => setDraft({ ...draft, triggers: value })} />
          <ListEditor label="失效条件" value={draft.invalidations} onChange={(value) => setDraft({ ...draft, invalidations: value })} />
          <label>用户备注<textarea value={draft.userNote} onChange={(event) => setDraft({ ...draft, userNote: event.target.value })} placeholder="记录你的判断、保留意见或执行前提" /></label>
          <button type="button" onClick={save}>保存修改</button>
          <section className={`dd-risk-box ${risk ? `risk-${risk.conclusion}` : 'stale'}`}>
            <header><ShieldAlert size={14} /><strong>AI风险评估</strong>{risk && <em>{AI_RISK_LABELS[risk.conclusion]}</em>}</header>
            {risk ? <><p>{risk.summary}</p>{risk.findings.map((item) => <span key={item}>• {item}</span>)}</> : <p>当前建议版本没有有效的 AI 风险结论。</p>}
            {(recommendation.status === 'risk_stale' || !risk) && <button type="button" disabled={conversationStreaming} onClick={() => onRiskReview(recommendation)}>{conversationStreaming ? <Loader2 size={12} className="spin" /> : <RefreshCw size={12} />}重新风险评估</button>}
          </section>
          <label>决策备注<textarea value={decisionNote} onChange={(event) => setDecisionNote(event.target.value)} placeholder="否决必须填写；高风险确认也必须填写" /></label>
          <label className="dd-ack"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />我确认这仅是研究建议，后续需要人工执行</label>
          {error && <p className="dd-error"><AlertTriangle size={13} />{error}</p>}
          <footer className="dd-actions"><button type="button" onClick={() => decide('deferred')}>暂缓</button><button type="button" className="danger" onClick={() => decide('rejected')}>否决</button><button type="button" className="primary" disabled={recommendation.status !== 'risk_ready'} onClick={() => decide('confirmed')}>确认研究建议</button></footer>
        </div>
      )}
    </section>
  );
}

function ListEditor({ label, value, onChange }: { label: string; value: string[]; onChange: (next: string[]) => void }) {
  return <label>{label}<textarea value={value.join('\n')} onChange={(event) => onChange(event.target.value.split('\n').map((item) => item.trim()).filter(Boolean))} /></label>;
}

function splitInlineList(value: string): string[] {
  return value.split(/[、,，;；\n]/).map((item) => item.trim()).filter(Boolean);
}

function Opinion({ title, text }: { title: string; text: string }) { return <div className="dd-opinion"><strong>{title}</strong><p>{text || '未给出'}</p></div>; }
function ListSection({ icon, title, items }: { icon: ReactNode; title: string; items: string[] }) { return <section className="dd-section"><header>{icon}<strong>{title}</strong></header>{items.length ? <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul> : <p>未给出</p>}</section>; }
function TwoColumnRules({ title, positive, negative }: { title: string; positive: string[]; negative: string[] }) { return <section className="dd-section"><header><ClipboardCheck size={14} /><strong>{title}</strong></header><div className="dd-rules"><div><em>只做/触发</em>{positive.map((item) => <span key={item}>✓ {item}</span>)}</div><div><em>不做/失效</em>{negative.map((item) => <span key={item}>× {item}</span>)}</div></div></section>; }
function StatusPill({ status }: { status: JointResearchRun['status'] }) { const labels = { pending: '等待', running: '运行中', completed: '已完成', failed: '失败' }; return <em className={`dd-status ${status}`}>{labels[status]}</em>; }

function jointResearchProgressText(run: JointResearchRun): string {
  if (run.phase === 'analyst_research') {
    return run.evidenceRepairAttempt
      ? '①⑦研究已返回，正在自动整理结构化证据包。'
      : '第一阶段：①市场策略官与⑦风险控制官正在并行研究。';
  }
  return run.synthesisAttempt
    ? '第二阶段：⑧正在修复结构化综合结论。'
    : '第一阶段已验收；第二阶段由⑧汇总分歧并形成建议草稿。';
}
function RecommendationStatus({ status }: { status: ResearchRecommendation['status'] }) { const labels: Record<ResearchRecommendation['status'], string> = { draft: '草稿', risk_stale: '待风险复核', risk_ready: '待确认', confirmed: '待人工处理', deferred: '暂缓', rejected: '否决', source_outdated: '来源已更新' }; return <em className={`dd-status ${status}`}>{labels[status]}</em>; }
function formatDateTime(value: string) { const timestamp = Date.parse(value); return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString('zh-CN', { hour12: false }) : value || '未给出'; }
function shortTime(value: string) { const timestamp = Date.parse(value); return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' }) : value; }
