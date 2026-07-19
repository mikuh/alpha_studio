import { loadLocalStoreSnapshot, scheduleLocalStoreCommit } from './localStore';
import type { ResearchQuote } from './research';
import type {
  PremarketTheme,
  PremarketThemeRun,
  PremarketThemeStock,
  PremarketThemeTrigger,
  ThemeTriggerOperator,
} from './themeResearch';

export const THEME_TRACKING_EVENTS_KEY = 'alpha-studio.theme-tracking-events.v1';
export const THEME_REVIEWS_KEY = 'alpha-studio.theme-reviews.v1';
export const THEME_BACKTEST_RUNS_KEY = 'alpha-studio.theme-backtest-runs.v1';
export const THEME_MONITOR_EVENT_SCHEMA = 'alpha.theme_monitor.v1';
export const THEME_REVIEW_SCHEMA = 'alpha.theme_review.v1';
export const THEME_TRACKING_CHANGED_EVENT = 'alpha:theme-tracking-changed';
export const THEME_REVIEWS_CHANGED_EVENT = 'alpha:theme-reviews-changed';

export type TriggerEvaluationStatus =
  | 'not_due'
  | 'not_triggered'
  | 'partial'
  | 'triggered'
  | 'upgraded'
  | 'downgraded'
  | 'invalidated'
  | 'data_missing'
  | 'awaiting_manual';

export const IMPORTANT_TRIGGER_STATES = new Set<TriggerEvaluationStatus>(['triggered', 'upgraded', 'invalidated']);

export const TRIGGER_STATUS_LABELS: Record<TriggerEvaluationStatus, string> = {
  not_due: '未到时点',
  not_triggered: '未触发',
  partial: '部分满足',
  triggered: '已触发',
  upgraded: '升级确认',
  downgraded: '降级',
  invalidated: '已失效',
  data_missing: '数据不足',
  awaiting_manual: '待人工确认',
};

export interface ThemeTrackingEvent {
  id: string;
  reportId: string;
  tradeDate: string;
  themeId: string;
  triggerId: string;
  status: TriggerEvaluationStatus;
  previousStatus?: TriggerEvaluationStatus;
  observedAt: string;
  evidence: string;
  source: string;
  confidence?: number;
  marketPrice?: number;
  actor: 'rule' | 'ai' | 'user';
  reason?: string;
}

export type ReviewVerdict = 'hit' | 'partial' | 'not_triggered' | 'miss' | 'data_missing';

export interface ThemeReviewItem {
  id: string;
  label: string;
  verdict: ReviewVerdict;
  evidence: string;
  attribution: 'thesis' | 'trigger' | 'data' | 'new_information';
}

export interface ThemeDailyReview {
  id: string;
  reportId: string;
  tradeDate: string;
  generatedAt: string;
  score: number;
  missingIntradayHistory: boolean;
  summary: string;
  items: ThemeReviewItem[];
  lessons: string[];
  proposedRuleChanges: string[];
  acceptedRuleVersion?: string;
}

export interface BacktestPriceBar {
  time: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
  money?: number;
  paused?: boolean;
  highLimit?: number;
  lowLimit?: number;
}

export interface ThemeBacktestConfig {
  name: string;
  dateFrom?: string;
  dateTo?: string;
  themeRank: number;
  stockRole: string;
  roleRank: number;
  holdingDays: number;
  initialCapital: number;
  commissionRate: number;
  minimumCommission: number;
  stampDutyRate: number;
  slippageBps: number;
  entryCutoff: string;
  benchmarkCode: string;
}

export const DEFAULT_THEME_BACKTEST_CONFIG: ThemeBacktestConfig = {
  name: 'Top1·第一中军·T+1',
  themeRank: 1,
  stockRole: '中军',
  roleRank: 1,
  holdingDays: 1,
  initialCapital: 1_000_000,
  commissionRate: 0.0003,
  minimumCommission: 5,
  stampDutyRate: 0.0005,
  slippageBps: 5,
  entryCutoff: '14:55',
  benchmarkCode: '000300.XSHG',
};

export interface ThemeBacktestTrade {
  id: string;
  reportId: string;
  tradeDate: string;
  theme: string;
  code: string;
  name: string;
  entryAt: string;
  exitAt: string;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  grossReturnPct: number;
  netReturnPct: number;
  fees: number;
  mode: 'signal' | 'executable';
  evidence: string;
  dataQuality: 'verified' | 'degraded';
  adjustmentFactor?: number;
}

export interface BacktestCurvePoint {
  date: string;
  value: number;
}

export interface ThemeBacktestMetrics {
  totalReturnPct: number;
  executableReturnPct: number;
  excessReturnPct: number;
  maxDrawdownPct: number;
  winRatePct: number;
  averageTradePct: number;
  medianTradePct: number;
  profitLossRatio: number | null;
  sampleCount: number;
  eligibleReports: number;
  coveragePct: number;
}

export interface ThemeBacktestRun {
  id: string;
  runHash: string;
  createdAt: string;
  dataSource: string;
  dataVersion: string;
  config: ThemeBacktestConfig;
  signalCurve: BacktestCurvePoint[];
  executableCurve: BacktestCurvePoint[];
  benchmarkCurve: BacktestCurvePoint[];
  signalTrades: ThemeBacktestTrade[];
  executableTrades: ThemeBacktestTrade[];
  exclusions: Array<{ reportId: string; tradeDate: string; reason: string }>;
  metrics: ThemeBacktestMetrics;
  sensitivity?: Array<{ slippageBps: number; executableReturnPct: number }>;
}

interface TriggerContext {
  now: Date;
  theme: PremarketTheme;
  quotes: Map<string, ResearchQuote>;
}

interface BacktestInput {
  reports: PremarketThemeRun[];
  events: ThemeTrackingEvent[];
  dailyBarsByCode: Map<string, BacktestPriceBar[]>;
  rawDailyBarsByCode?: Map<string, BacktestPriceBar[]>;
  minuteBarsByCode?: Map<string, BacktestPriceBar[]>;
  benchmarkBars: BacktestPriceBar[];
  config?: Partial<ThemeBacktestConfig>;
  dataSource: string;
  dataVersion: string;
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function loadArray<T>(key: string): T[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || '[]') as unknown;
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

function saveArray<T>(key: string, values: T[]): void {
  if (typeof window !== 'undefined') window.localStorage.setItem(key, JSON.stringify(values));
}

export function loadThemeTrackingEvents(): ThemeTrackingEvent[] {
  return loadArray<ThemeTrackingEvent>(THEME_TRACKING_EVENTS_KEY);
}

export function saveThemeTrackingEvents(events: ThemeTrackingEvent[]): ThemeTrackingEvent[] {
  saveArray(THEME_TRACKING_EVENTS_KEY, events);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(THEME_TRACKING_CHANGED_EVENT, { detail: events }));
  scheduleLocalStoreCommit('theme-tracking-events', {
    themeTrackingEvents: events,
    audit: { domain: 'theme_validation', action: 'tracking.persist', payload: { count: events.length } },
  });
  return events;
}

export function ingestThemeMonitorResult(text: string, reports: PremarketThemeRun[]): { ok: boolean; added: number; error?: string } {
  const fenced = Array.from(text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi));
  for (const match of fenced) {
    try {
      const raw = JSON.parse(match[1]) as Record<string, unknown>;
      if (raw.schema !== THEME_MONITOR_EVENT_SCHEMA || !Array.isArray(raw.events)) continue;
      const report = reports.find((item) => item.id === raw.reportId || item.contentHash === raw.reportContentHash);
      if (!report) return { ok: false, added: 0, error: '监控结果无法匹配不可变报告快照。' };
      const knownTriggers = new Map(report.themes.flatMap((theme) => theme.triggerSpecs.map((trigger) => [trigger.id, theme.id] as const)));
      const allowedStatuses = new Set<TriggerEvaluationStatus>(Object.keys(TRIGGER_STATUS_LABELS) as TriggerEvaluationStatus[]);
      const observedAt = typeof raw.observedAt === 'string' && Number.isFinite(Date.parse(raw.observedAt))
        ? raw.observedAt
        : new Date().toISOString();
      const evaluations = raw.events.flatMap((value) => {
        if (!value || typeof value !== 'object') return [];
        const event = value as Record<string, unknown>;
        const triggerId = typeof event.triggerId === 'string' ? event.triggerId : '';
        const status = typeof event.status === 'string' ? event.status as TriggerEvaluationStatus : 'data_missing';
        const themeId = knownTriggers.get(triggerId);
        if (!themeId || !allowedStatuses.has(status)) return [];
        return [{
          reportId: report.id,
          tradeDate: report.tradeDate,
          themeId,
          triggerId,
          status,
          observedAt,
          evidence: typeof event.evidence === 'string' ? event.evidence : '未提供证据',
          source: typeof event.source === 'string' ? event.source : '未标明来源',
          confidence: typeof event.confidence === 'number' ? Math.max(0, Math.min(1, event.confidence)) : undefined,
          marketPrice: typeof event.marketPrice === 'number' ? event.marketPrice : undefined,
          actor: 'ai' as const,
        }];
      });
      if (!evaluations.length) return { ok: false, added: 0, error: '监控 JSON 没有可匹配的 triggerId。' };
      const current = loadThemeTrackingEvents();
      const next = mergeTrackingEvaluations(current, evaluations);
      if (next !== current) saveThemeTrackingEvents(next);
      return { ok: true, added: next.length - current.length };
    } catch {
      // Try other fenced JSON blocks in the same reply.
    }
  }
  return { ok: false, added: 0, error: `未找到 ${THEME_MONITOR_EVENT_SCHEMA} JSON。` };
}

export function loadThemeReviews(): ThemeDailyReview[] {
  return loadArray<ThemeDailyReview>(THEME_REVIEWS_KEY);
}

export function saveThemeReviews(reviews: ThemeDailyReview[]): ThemeDailyReview[] {
  saveArray(THEME_REVIEWS_KEY, reviews);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(THEME_REVIEWS_CHANGED_EVENT, { detail: reviews }));
  scheduleLocalStoreCommit('theme-reviews', {
    themeReviews: reviews,
    audit: { domain: 'theme_validation', action: 'reviews.persist', payload: { count: reviews.length } },
  });
  return reviews;
}

export function ingestThemeReviewResult(text: string, reports: PremarketThemeRun[]): { ok: boolean; error?: string } {
  const fenced = Array.from(text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi));
  for (const match of fenced) {
    try {
      const raw = JSON.parse(match[1]) as Record<string, unknown>;
      if (raw.schema !== THEME_REVIEW_SCHEMA) continue;
      const report = reports.find((item) => item.id === raw.reportId || item.contentHash === raw.reportContentHash);
      if (!report) return { ok: false, error: '复盘结果无法匹配不可变报告快照。' };
      const verdicts = new Set<ReviewVerdict>(['hit', 'partial', 'not_triggered', 'miss', 'data_missing']);
      const attributions = new Set<ThemeReviewItem['attribution']>(['thesis', 'trigger', 'data', 'new_information']);
      const items = Array.isArray(raw.items) ? raw.items.flatMap((value, index) => {
        if (!value || typeof value !== 'object') return [];
        const item = value as Record<string, unknown>;
        const verdict = item.verdict as ReviewVerdict;
        const attribution = item.attribution as ThemeReviewItem['attribution'];
        if (!verdicts.has(verdict) || !attributions.has(attribution)) return [];
        return [{
          id: typeof item.id === 'string' ? item.id : `ai-review-${index + 1}`,
          label: typeof item.label === 'string' ? item.label : `复盘项 ${index + 1}`,
          verdict,
          evidence: typeof item.evidence === 'string' ? item.evidence : '未提供证据',
          attribution,
        }];
      }) : [];
      if (!items.length) return { ok: false, error: '复盘 JSON 缺少可审计条目。' };
      const score = typeof raw.score === 'number' ? Math.max(0, Math.min(100, Math.round(raw.score))) : 0;
      const review: ThemeDailyReview = {
        id: typeof raw.id === 'string' ? raw.id : createId('review-ai'),
        reportId: report.id,
        tradeDate: report.tradeDate,
        generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt : new Date().toISOString(),
        score,
        missingIntradayHistory: Boolean(raw.missingIntradayHistory),
        summary: typeof raw.summary === 'string' ? raw.summary : `AI 复盘评分 ${score}。`,
        items,
        lessons: Array.isArray(raw.lessons) ? raw.lessons.filter((item): item is string => typeof item === 'string') : [],
        proposedRuleChanges: Array.isArray(raw.proposedRuleChanges) ? raw.proposedRuleChanges.filter((item): item is string => typeof item === 'string') : [],
      };
      saveThemeReviews([review, ...loadThemeReviews().filter((item) => item.reportId !== report.id)]);
      return { ok: true };
    } catch {
      // Try the next fenced JSON block.
    }
  }
  return { ok: false, error: `未找到 ${THEME_REVIEW_SCHEMA} JSON。` };
}

export function loadThemeBacktestRuns(): ThemeBacktestRun[] {
  return loadArray<ThemeBacktestRun>(THEME_BACKTEST_RUNS_KEY);
}

export function saveThemeBacktestRun(run: ThemeBacktestRun): ThemeBacktestRun[] {
  const next = [run, ...loadThemeBacktestRuns().filter((item) => item.runHash !== run.runHash)].slice(0, 50);
  saveArray(THEME_BACKTEST_RUNS_KEY, next);
  scheduleLocalStoreCommit('theme-backtest-runs', {
    themeBacktestRuns: next,
    audit: { domain: 'theme_validation', action: 'backtest.persist', entityId: run.id, payload: { runHash: run.runHash } },
  });
  return next;
}

export async function hydrateThemeValidationFromLocalStore(): Promise<void> {
  const snapshot = await loadLocalStoreSnapshot();
  if (!snapshot) return;
  if (snapshot.themeTrackingEvents?.length) saveArray(THEME_TRACKING_EVENTS_KEY, snapshot.themeTrackingEvents);
  if (snapshot.themeReviews?.length) saveArray(THEME_REVIEWS_KEY, snapshot.themeReviews);
  if (snapshot.themeBacktestRuns?.length) saveArray(THEME_BACKTEST_RUNS_KEY, snapshot.themeBacktestRuns);
}

function shanghaiClock(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

function shanghaiDateTime(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}`;
}

function compareClock(left: string, right: string): number {
  return left.localeCompare(right);
}

function compareValue(actual: number | string, operator: ThemeTriggerOperator | undefined, threshold: number | string | undefined): boolean {
  if (threshold === undefined || !operator) return false;
  if (operator === 'contains') return String(actual).includes(String(threshold));
  const left = Number(actual);
  const right = Number(threshold);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  if (operator === 'gt') return left > right;
  if (operator === 'gte') return left >= right;
  if (operator === 'lt') return left < right;
  if (operator === 'lte') return left <= right;
  return left === right;
}

function quoteMetric(quote: ResearchQuote, field: string): number | undefined {
  if (field === 'price') return quote.price;
  if (field === 'changePct') return quote.changePct;
  if (field === 'volumeRatio') return quote.volumeRatio;
  if (field === 'turnoverRate') return quote.turnoverRate;
  if (field === 'turnoverAmount') return quote.turnoverAmount;
  if (field === 'high') return quote.high;
  if (field === 'low') return quote.low;
  return undefined;
}

export function evaluateThemeTrigger(
  report: PremarketThemeRun,
  trigger: PremarketThemeTrigger,
  context: TriggerContext,
): Omit<ThemeTrackingEvent, 'id' | 'previousStatus'> {
  const observedAt = context.now.toISOString();
  const clock = shanghaiClock(context.now);
  if (trigger.windowStart && compareClock(clock, trigger.windowStart) < 0) {
    return baseEvaluation(report, context.theme, trigger, 'not_due', observedAt, `等待 ${trigger.windowStart} 观察窗口`, trigger.dataSource);
  }
  if (trigger.windowEnd && compareClock(clock, trigger.windowEnd) > 0) {
    return baseEvaluation(report, context.theme, trigger, 'invalidated', observedAt, `已超过 ${trigger.windowEnd} 且未确认`, trigger.dataSource);
  }
  if (trigger.evaluator === 'ai' || trigger.evaluator === 'manual') {
    return baseEvaluation(report, context.theme, trigger, 'awaiting_manual', observedAt, '需要 AI 证据或人工确认', trigger.dataSource);
  }
  if (trigger.evaluator === 'time') {
    const actual = clock;
    const matched = compareValue(actual, trigger.operator, trigger.threshold ?? trigger.windowStart);
    return baseEvaluation(report, context.theme, trigger, matched ? 'triggered' : 'not_triggered', observedAt, `当前时间 ${actual}`, trigger.dataSource);
  }
  if (trigger.evaluator === 'breadth') {
    const codes = context.theme.stocks.map((stock) => stock.code).filter((code): code is string => Boolean(code));
    const quotes = codes.map((code) => context.quotes.get(code)).filter((quote): quote is ResearchQuote => Boolean(quote));
    if (!quotes.length) return baseEvaluation(report, context.theme, trigger, 'data_missing', observedAt, '题材成分行情不可用', trigger.dataSource);
    const breadthPct = quotes.filter((quote) => quote.changePct > 0).length / quotes.length * 100;
    const matched = compareValue(breadthPct, trigger.operator, trigger.threshold);
    return baseEvaluation(report, context.theme, trigger, matched ? 'triggered' : 'not_triggered', observedAt, `上涨 ${quotes.filter((quote) => quote.changePct > 0).length}/${quotes.length}，宽度 ${breadthPct.toFixed(1)}%`, trigger.dataSource);
  }
  const quote = trigger.subjectCode ? context.quotes.get(trigger.subjectCode) : undefined;
  const metric = quote && trigger.field ? quoteMetric(quote, trigger.field) : undefined;
  if (!quote || metric === undefined) return baseEvaluation(report, context.theme, trigger, 'data_missing', observedAt, '标的或指标行情不可用', trigger.dataSource);
  const matched = compareValue(metric, trigger.operator, trigger.threshold);
  return {
    ...baseEvaluation(report, context.theme, trigger, matched ? 'triggered' : 'not_triggered', observedAt, `${quote.name} ${trigger.field}=${metric.toFixed(2)}`, quote.source),
    marketPrice: quote.price,
  };
}

function baseEvaluation(
  report: PremarketThemeRun,
  theme: PremarketTheme,
  trigger: PremarketThemeTrigger,
  status: TriggerEvaluationStatus,
  observedAt: string,
  evidence: string,
  source: string,
): Omit<ThemeTrackingEvent, 'id' | 'previousStatus'> {
  return {
    reportId: report.id,
    tradeDate: report.tradeDate,
    themeId: theme.id,
    triggerId: trigger.id,
    status,
    observedAt,
    evidence,
    source,
    confidence: trigger.evaluator === 'quote' || trigger.evaluator === 'breadth' || trigger.evaluator === 'time' ? 1 : undefined,
    actor: 'rule',
  };
}

export function mergeTrackingEvaluations(
  existing: ThemeTrackingEvent[],
  evaluations: Array<Omit<ThemeTrackingEvent, 'id' | 'previousStatus'>>,
): ThemeTrackingEvent[] {
  const latestByTrigger = new Map<string, ThemeTrackingEvent>();
  for (const event of existing) {
    const key = `${event.reportId}:${event.triggerId}`;
    const current = latestByTrigger.get(key);
    if (!current || Date.parse(event.observedAt) > Date.parse(current.observedAt)) latestByTrigger.set(key, event);
  }
  const additions: ThemeTrackingEvent[] = [];
  for (const evaluation of evaluations) {
    const previous = latestByTrigger.get(`${evaluation.reportId}:${evaluation.triggerId}`);
    if (previous?.status === evaluation.status && previous.evidence === evaluation.evidence) continue;
    additions.push({
      ...evaluation,
      id: createId('trigger'),
      previousStatus: previous?.status,
    });
  }
  return additions.length ? [...additions.reverse(), ...existing] : existing;
}

export function overrideTrackingEvent(
  existing: ThemeTrackingEvent[],
  base: ThemeTrackingEvent,
  status: TriggerEvaluationStatus,
  reason: string,
): ThemeTrackingEvent[] {
  const event: ThemeTrackingEvent = {
    ...base,
    id: createId('override'),
    previousStatus: base.status,
    status,
    observedAt: new Date().toISOString(),
    evidence: `用户覆写：${reason}`,
    source: 'user',
    actor: 'user',
    reason,
  };
  return [event, ...existing];
}

export function createDailyReview(report: PremarketThemeRun, events: ThemeTrackingEvent[]): ThemeDailyReview {
  const reportEvents = events.filter((event) => event.reportId === report.id);
  const latest = latestEvents(reportEvents);
  const items = report.themes.flatMap((theme) => theme.triggerSpecs.map((trigger) => {
    const event = latest.get(trigger.id);
    const verdict: ReviewVerdict = !event
      ? 'data_missing'
      : event.status === 'triggered' || event.status === 'upgraded'
        ? 'hit'
        : event.status === 'partial'
          ? 'partial'
          : event.status === 'not_triggered' || event.status === 'not_due'
            ? 'not_triggered'
            : event.status === 'data_missing'
              ? 'data_missing'
              : 'miss';
    return {
      id: `${theme.id}:${trigger.id}`,
      label: `${theme.name} · ${trigger.label}`,
      verdict,
      evidence: event?.evidence || '缺少盘中事件',
      attribution: !event || event.status === 'data_missing' ? 'data' : event.actor === 'ai' ? 'new_information' : 'trigger',
    } satisfies ThemeReviewItem;
  }));
  const scored = items.filter((item) => item.verdict !== 'data_missing');
  const score = scored.length
    ? Math.round(scored.reduce((sum, item) => sum + (item.verdict === 'hit' ? 100 : item.verdict === 'partial' ? 60 : item.verdict === 'not_triggered' ? 50 : 0), 0) / scored.length)
    : 0;
  return {
    id: createId('review'),
    reportId: report.id,
    tradeDate: report.tradeDate,
    generatedAt: new Date().toISOString(),
    score,
    missingIntradayHistory: reportEvents.length === 0,
    summary: reportEvents.length ? `完成 ${items.length} 项触发审计，综合评分 ${score}。` : '缺少盘中观察历史，仅保留收盘补充复盘入口。',
    items,
    lessons: score >= 70 ? ['保留已被市场验证的触发定义。'] : ['优先检查触发阈值与数据覆盖，不用事后结果改写原假设。'],
    proposedRuleChanges: items.filter((item) => item.verdict === 'miss').map((item) => `复核规则：${item.label}`),
  };
}

function latestEvents(events: ThemeTrackingEvent[]): Map<string, ThemeTrackingEvent> {
  const sorted = [...events].sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
  const map = new Map<string, ThemeTrackingEvent>();
  for (const event of sorted) map.set(event.triggerId, event);
  return map;
}

export function eligibleOpenReports(reports: PremarketThemeRun[], config: ThemeBacktestConfig): PremarketThemeRun[] {
  const byDate = new Map<string, PremarketThemeRun>();
  for (const report of reports) {
    if (config.dateFrom && report.tradeDate < config.dateFrom) continue;
    if (config.dateTo && report.tradeDate > config.dateTo) continue;
    if (!isEligibleBeforeOpen(report)) continue;
    const current = byDate.get(report.tradeDate);
    if (!current || Date.parse(report.generatedAt) > Date.parse(current.generatedAt)) byDate.set(report.tradeDate, report);
  }
  return Array.from(byDate.values()).sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
}

export function isEligibleBeforeOpen(report: PremarketThemeRun): boolean {
  if (!report.tradeDate || !/^(pre_market|auction|call_auction)$/i.test(report.reportMode)) return false;
  return beforeShanghaiCutoff(report.generatedAt, report.tradeDate) && beforeShanghaiCutoff(report.dataCutoff, report.tradeDate);
}

function beforeShanghaiCutoff(value: string, tradeDate: string): boolean {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return false;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(parsed));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const date = `${values.year}-${values.month}-${values.day}`;
  const clock = `${values.hour}:${values.minute}:${values.second}`;
  return date < tradeDate || (date === tradeDate && clock <= '09:24:59');
}

export function selectBacktestCandidate(report: PremarketThemeRun, config: ThemeBacktestConfig): { theme: PremarketTheme; stock: PremarketThemeStock } | null {
  const theme = [...report.themes].sort((a, b) => a.rank - b.rank).find((item) => item.rank === config.themeRank);
  if (!theme) return null;
  const stock = [...theme.stocks]
    .filter((item) => item.role?.includes(config.stockRole) && item.code)
    .sort((a, b) => a.roleRank - b.roleRank)
    .find((item) => item.roleRank === config.roleRank);
  return stock ? { theme, stock } : null;
}

function barsByDate(bars: BacktestPriceBar[]): Map<string, BacktestPriceBar> {
  return new Map(bars.map((bar) => [bar.time.slice(0, 10), bar]));
}

function sortedBars(bars: BacktestPriceBar[]): BacktestPriceBar[] {
  return [...bars].sort((a, b) => a.time.localeCompare(b.time));
}

function nextDailyBar(bars: BacktestPriceBar[], tradeDate: string, holdingDays: number): BacktestPriceBar | null {
  const future = sortedBars(bars).filter((bar) => bar.time.slice(0, 10) > tradeDate);
  return future[Math.max(0, holdingDays - 1)] ?? null;
}

function commission(amount: number, config: ThemeBacktestConfig): number {
  return Math.max(config.minimumCommission, amount * config.commissionRate);
}

function stampDutyRate(tradeDate: string, config: ThemeBacktestConfig): number {
  return tradeDate >= '2023-08-28' ? config.stampDutyRate : 0.001;
}

function isLockedAtLimit(bar: BacktestPriceBar, side: 'buy' | 'sell'): boolean {
  if (side === 'buy') return Boolean(bar.highLimit && bar.open >= bar.highLimit && bar.low >= bar.highLimit);
  return Boolean(bar.lowLimit && bar.open <= bar.lowLimit && bar.high <= bar.lowLimit);
}

function maxDrawdown(curve: BacktestCurvePoint[]): number {
  let peak = curve[0]?.value ?? 0;
  let drawdown = 0;
  for (const point of curve) {
    peak = Math.max(peak, point.value);
    if (peak > 0) drawdown = Math.min(drawdown, (point.value - peak) / peak * 100);
  }
  return drawdown;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function runThemeBacktest(input: BacktestInput): ThemeBacktestRun {
  const config = { ...DEFAULT_THEME_BACKTEST_CONFIG, ...input.config };
  const reports = eligibleOpenReports(input.reports, config);
  const exclusions: ThemeBacktestRun['exclusions'] = [];
  const inRange = input.reports.filter((report) => (!config.dateFrom || report.tradeDate >= config.dateFrom) && (!config.dateTo || report.tradeDate <= config.dateTo));
  const eligibleIds = new Set(reports.map((report) => report.id));
  for (const report of inRange) {
    if (!eligibleIds.has(report.id)) exclusions.push({
      reportId: report.id,
      tradeDate: report.tradeDate,
      reason: isEligibleBeforeOpen(report) ? '同日存在更晚的合格报告' : '报告模式或生成/数据截止时间不符合 09:24:59 防未来函数规则',
    });
  }
  const signalTrades: ThemeBacktestTrade[] = [];
  const executableTrades: ThemeBacktestTrade[] = [];
  const signalCurve: BacktestCurvePoint[] = [{ date: reports[0]?.tradeDate || '', value: config.initialCapital }];
  const executableCurve: BacktestCurvePoint[] = [{ date: reports[0]?.tradeDate || '', value: config.initialCapital }];
  let signalValue = config.initialCapital;
  let executableCash = config.initialCapital;
  let executableAvailableDate = '';

  for (const report of reports) {
    const candidate = selectBacktestCandidate(report, config);
    if (!candidate) {
      exclusions.push({ reportId: report.id, tradeDate: report.tradeDate, reason: '缺少指定题材排名或中军代码' });
      continue;
    }
    const code = candidate.stock.code as string;
    const bars = input.dailyBarsByCode.get(code) ?? [];
    const signalEntry = barsByDate(bars).get(report.tradeDate);
    const signalExit = nextDailyBar(bars, report.tradeDate, config.holdingDays);
    if (!signalEntry || !signalExit || signalEntry.paused || !Number.isFinite(signalEntry.open) || !Number.isFinite(signalExit.open)) {
      exclusions.push({ reportId: report.id, tradeDate: report.tradeDate, reason: '开盘行情缺失或停牌' });
      continue;
    }
    const grossReturn = signalExit.open / signalEntry.open - 1;
    signalValue *= 1 + grossReturn;
    signalCurve.push({ date: signalExit.time.slice(0, 10), value: signalValue });
    signalTrades.push({
      id: `${report.id}:signal`, reportId: report.id, tradeDate: report.tradeDate,
      theme: candidate.theme.name, code, name: candidate.stock.name,
      entryAt: `${report.tradeDate} 09:30`, exitAt: `${signalExit.time.slice(0, 10)} 09:30`,
      entryPrice: signalEntry.open, exitPrice: signalExit.open, quantity: 0,
      grossReturnPct: grossReturn * 100, netReturnPct: grossReturn * 100, fees: 0,
      mode: 'signal', evidence: '报告时点合格；按开盘到下一交易日开盘测量信号。', dataQuality: 'verified',
    });

    if (report.tradeDate < executableAvailableDate) {
      exclusions.push({ reportId: report.id, tradeDate: report.tradeDate, reason: `上一笔持仓资金占用至 ${executableAvailableDate}` });
      continue;
    }
    const rawBars = input.rawDailyBarsByCode?.get(code) ?? bars;
    const entry = barsByDate(rawBars).get(report.tradeDate);
    const exit = nextDailyBar(rawBars, report.tradeDate, config.holdingDays);
    if (!entry || !exit || entry.paused || !Number.isFinite(entry.open) || !Number.isFinite(exit.open)) {
      exclusions.push({ reportId: report.id, tradeDate: report.tradeDate, reason: '原始价格成交可行性数据缺失' });
      continue;
    }
    if (['完全不做', '只观察', '持有/减仓优先'].includes(report.executionGate.state)) {
      exclusions.push({ reportId: report.id, tradeDate: report.tradeDate, reason: `执行闸门为${report.executionGate.state}` });
      continue;
    }
    const required = new Set(candidate.theme.triggerSpecs.map((trigger) => trigger.id));
    const triggerEvents = input.events
      .filter((event) => event.reportId === report.id && required.has(event.triggerId) && (event.status === 'triggered' || event.status === 'upgraded'))
      .sort((a, b) => a.observedAt.localeCompare(b.observedAt));
    if (!required.size || new Set(triggerEvents.map((event) => event.triggerId)).size < required.size) {
      exclusions.push({ reportId: report.id, tradeDate: report.tradeDate, reason: '缺少全部必需触发的事前确认事件' });
      continue;
    }
    const confirmedAt = triggerEvents[triggerEvents.length - 1].observedAt;
    const confirmedClock = shanghaiClock(new Date(confirmedAt));
    if (confirmedClock > config.entryCutoff) {
      exclusions.push({ reportId: report.id, tradeDate: report.tradeDate, reason: `触发晚于 ${config.entryCutoff}` });
      continue;
    }
    const minuteBars = sortedBars(input.minuteBarsByCode?.get(code) ?? []);
    const confirmedLocal = shanghaiDateTime(new Date(confirmedAt));
    const minute = minuteBars.find((bar) => bar.time.replace('T', ' ') > confirmedLocal && bar.time.slice(0, 10) === report.tradeDate);
    const hasMinuteVwap = Boolean(minute?.money && minute.volume > 0);
    const rawEntryPrice = minute
      ? hasMinuteVwap ? (minute.money as number) / minute.volume : minute.open
      : undefined;
    if (!rawEntryPrice || !Number.isFinite(rawEntryPrice)) {
      exclusions.push({ reportId: report.id, tradeDate: report.tradeDate, reason: '触发后一分钟成交价不可用' });
      continue;
    }
    if (isLockedAtLimit(entry, 'buy') || (minute && isLockedAtLimit(minute, 'buy'))) {
      exclusions.push({ reportId: report.id, tradeDate: report.tradeDate, reason: '开盘或触发后行情锁死涨停，不假设成交' });
      continue;
    }
    let executableExit = exit;
    let exitAt = `${exit.time.slice(0, 10)} 09:30`;
    if (exit.paused || isLockedAtLimit(exit, 'sell')) {
      const delayed = minuteBars.find((bar) => bar.time.slice(0, 10) === exit.time.slice(0, 10)
        && !bar.paused && !isLockedAtLimit(bar, 'sell') && bar.time.slice(11, 16) >= '09:31');
      if (!delayed) {
        exclusions.push({ reportId: report.id, tradeDate: report.tradeDate, reason: '次日停牌或锁死跌停，无法证明可成交退出' });
        continue;
      }
      executableExit = delayed;
      exitAt = delayed.time;
    }
    const entryPrice = rawEntryPrice * (1 + config.slippageBps / 10_000);
    const exitPrice = executableExit.open * (1 - config.slippageBps / 10_000);
    let quantity = Math.floor(executableCash / entryPrice / 100) * 100;
    if (quantity <= 0) {
      exclusions.push({ reportId: report.id, tradeDate: report.tradeDate, reason: '可用资金不足一手' });
      continue;
    }
    let buyAmount = entryPrice * quantity;
    let buyFee = commission(buyAmount, config);
    if (buyAmount + buyFee > executableCash) {
      quantity = Math.floor((executableCash - config.minimumCommission) / entryPrice / 100) * 100;
      if (quantity <= 0) {
        exclusions.push({ reportId: report.id, tradeDate: report.tradeDate, reason: '扣除佣金后可用资金不足一手' });
        continue;
      }
      buyAmount = entryPrice * quantity;
      buyFee = commission(buyAmount, config);
    }
    const sellAmount = exitPrice * quantity;
    const sellFee = commission(sellAmount, config) + sellAmount * stampDutyRate(exit.time.slice(0, 10), config);
    const fees = buyFee + sellFee;
    const before = executableCash;
    executableCash += sellAmount - buyAmount - fees;
    const netReturn = before > 0 ? executableCash / before - 1 : 0;
    executableAvailableDate = executableExit.time.slice(0, 10);
    executableCurve.push({ date: executableAvailableDate, value: executableCash });
    executableTrades.push({
      id: `${report.id}:executable`, reportId: report.id, tradeDate: report.tradeDate,
      theme: candidate.theme.name, code, name: candidate.stock.name,
      entryAt: minute?.time || confirmedAt, exitAt,
      entryPrice, exitPrice, quantity, grossReturnPct: (executableExit.open / rawEntryPrice - 1) * 100,
      netReturnPct: netReturn * 100, fees, mode: 'executable',
      evidence: `全部触发于 ${confirmedClock} 前确认；下一分钟${hasMinuteVwap ? 'VWAP' : '开盘价降级'}入场。`, dataQuality: hasMinuteVwap ? 'verified' : 'degraded',
      adjustmentFactor: entry.open > 0 ? signalEntry.open / entry.open : undefined,
    });
  }

  const benchmarkBars = sortedBars(input.benchmarkBars);
  const benchmarkCurve: BacktestCurvePoint[] = [];
  const firstBenchmark = benchmarkBars.find((bar) => !config.dateFrom || bar.time.slice(0, 10) >= config.dateFrom);
  if (firstBenchmark?.open) {
    for (const bar of benchmarkBars) {
      const date = bar.time.slice(0, 10);
      if ((config.dateFrom && date < config.dateFrom) || (config.dateTo && date > config.dateTo)) continue;
      benchmarkCurve.push({ date, value: config.initialCapital * bar.close / firstBenchmark.open });
    }
  }
  const returns = signalTrades.map((trade) => trade.grossReturnPct);
  const wins = returns.filter((value) => value > 0);
  const losses = returns.filter((value) => value < 0);
  const benchmarkReturn = benchmarkCurve.length ? benchmarkCurve[benchmarkCurve.length - 1].value / config.initialCapital - 1 : 0;
  const totalReturn = signalValue / config.initialCapital - 1;
  const metrics: ThemeBacktestMetrics = {
    totalReturnPct: totalReturn * 100,
    executableReturnPct: (executableCash / config.initialCapital - 1) * 100,
    excessReturnPct: (totalReturn - benchmarkReturn) * 100,
    maxDrawdownPct: maxDrawdown(signalCurve),
    winRatePct: returns.length ? wins.length / returns.length * 100 : 0,
    averageTradePct: returns.length ? returns.reduce((sum, value) => sum + value, 0) / returns.length : 0,
    medianTradePct: median(returns),
    profitLossRatio: wins.length && losses.length
      ? (wins.reduce((sum, value) => sum + value, 0) / wins.length) / Math.abs(losses.reduce((sum, value) => sum + value, 0) / losses.length)
      : null,
    sampleCount: signalTrades.length,
    eligibleReports: reports.length,
    coveragePct: reports.length ? signalTrades.length / reports.length * 100 : 0,
  };
  const hashSource = JSON.stringify({
    reports: reports.map((report) => report.contentHash), config, dataSource: input.dataSource, dataVersion: input.dataVersion,
  });
  return {
    id: createId('backtest'),
    runHash: stableHash(hashSource),
    createdAt: new Date().toISOString(),
    dataSource: input.dataSource,
    dataVersion: input.dataVersion,
    config,
    signalCurve,
    executableCurve,
    benchmarkCurve,
    signalTrades,
    executableTrades,
    exclusions,
    metrics,
  };
}

function stableHash(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `bt-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
