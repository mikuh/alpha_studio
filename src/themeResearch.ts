import {
  formatMoney,
  formatPercent,
  formatSignedMoney,
  sectorExposure,
  shortCode,
  type ResearchAccountSummary,
  type ResearchPortfolio,
  type ResearchQuote,
  type ResearchState,
} from './research';
import { scheduleLocalStoreCommit } from './localStore';

export const ALPHA_STUDIO_DAILY_THEME_SKILL_ID = 'alpha-studio-daily-theme-research';
export const ALPHA_STUDIO_DAILY_THEME_SKILL_TITLE = 'Alpha Studio 盘前主题';
export const PREMARKET_THEME_SCHEMA_V1 = 'alpha.premarket_theme.v1';
export const PREMARKET_THEME_SCHEMA = 'alpha.premarket_theme.v2';
export const PREMARKET_THEME_RUNS_KEY = 'alpha-studio.premarket-theme-runs.v1';
export const PREMARKET_THEME_RUNS_CHANGED_EVENT = 'alpha-studio:premarket-theme-runs-changed';
export const PREMARKET_THEME_IMPORT_EVENT = 'alpha-studio:premarket-theme-import';

export type PremarketThemeStatus = 'pending' | 'watching' | 'adopted' | 'ignored' | 'review';

export interface ExecutionGate {
  state: string;
  todayOnlyDo: string[];
  todayDoNotDo: string[];
  triggerBeforeAction: string[];
  failureAction: string;
}

export interface CapitalAttackPath {
  primaryRoute: string;
  backupRoute: string;
  invalidationRoute: string;
  todayAttackProbability: string;
  rationale: string;
  actionCondition: string;
}

export interface PremarketHoldingWindow {
  elapsedTradingDays: string;
  estimatedRemainingWindow: string;
  defaultProtocol: string;
  extensionConditions: string[];
  exitConditions: string[];
}

export interface PremarketThemeStock {
  name: string;
  code?: string;
  role?: string;
  roleRank: number;
  authenticity?: string;
}

export type ThemeTriggerEvaluator = 'quote' | 'breadth' | 'time' | 'ai' | 'manual';
export type ThemeTriggerOperator = 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'contains';

export interface PremarketThemeTrigger {
  id: string;
  label: string;
  evaluator: ThemeTriggerEvaluator;
  subjectCode?: string;
  field?: string;
  operator?: ThemeTriggerOperator;
  threshold?: number | string;
  windowStart?: string;
  windowEnd?: string;
  confirmForSeconds: number;
  dataSource: string;
  actionOnTrigger: string;
  actionOnFailure: string;
}

export interface PremarketTheme {
  id: string;
  rank: number;
  name: string;
  grade: 'S' | 'A' | 'B' | 'C';
  conclusion: string;
  lifecycle: string;
  capitalType: string;
  attackPath: string;
  todayAttackProbability: string;
  researchProbability: string;
  observationWeight: string;
  holdingWindow?: PremarketHoldingWindow;
  todayOnlyDo: string[];
  todayDoNotDo: string[];
  triggers: string[];
  triggerSpecs: PremarketThemeTrigger[];
  invalidation: string;
  risk: string;
  stocks: PremarketThemeStock[];
  status: PremarketThemeStatus;
}

export interface PremarketContinuityRow {
  name: string;
  status: string;
  action: string;
  evidence: string;
}

export interface PremarketThemeRun {
  id: string;
  schema: typeof PREMARKET_THEME_SCHEMA;
  sourceSchema: typeof PREMARKET_THEME_SCHEMA | typeof PREMARKET_THEME_SCHEMA_V1;
  tradeDate: string;
  dataCutoff: string;
  contentHash: string;
  generatedAt: string;
  importedAt: string;
  reportMode: string;
  title: string;
  executionGate: ExecutionGate;
  capitalAttackPath: CapitalAttackPath;
  marketSentiment: string;
  themes: PremarketTheme[];
  previousContinuity: PremarketContinuityRow[];
  risks: string[];
  sourceNotes: string[];
  reportMarkdown: string;
  sourceConversationId?: string;
  sourceMessageId?: string;
  sourceBoundAt?: string;
}

export interface PremarketThemePromptInput {
  state: ResearchState;
  summary: ResearchAccountSummary;
  quotes: Map<string, ResearchQuote>;
  fullMarketQuotes: ResearchQuote[];
  previousRuns: PremarketThemeRun[];
  generatedAt?: Date;
}

export interface PremarketThemeParseResult {
  ok: boolean;
  run?: PremarketThemeRun;
  error?: string;
}

export function automaticPremarketThemeImportError(run: PremarketThemeRun): string | null {
  const missing: string[] = [];
  const absent = (value: unknown) => typeof value !== 'string'
    || !value.trim()
    || /^(?:未给出|待确认|待验证)$/i.test(value.trim());
  const requireText = (label: string, value: unknown) => {
    if (absent(value)) missing.push(label);
  };
  requireText('交易日', run.tradeDate);
  requireText('生成时间', run.generatedAt);
  requireText('数据截止时间', run.dataCutoff);
  requireText('报告模式', run.reportMode);
  requireText('报告标题', run.title);
  if (run.sourceSchema !== PREMARKET_THEME_SCHEMA) missing.push('v2结构化协议');
  requireText('执行闸门', run.executionGate.state);
  if (!run.executionGate.todayOnlyDo.length) missing.push('全局今日只做');
  if (!run.executionGate.todayDoNotDo.length) missing.push('全局今日不做');
  if (!run.executionGate.triggerBeforeAction.length) missing.push('全局触发再做');
  requireText('全局失效动作', run.executionGate.failureAction);
  requireText('主路径', run.capitalAttackPath.primaryRoute);
  requireText('备选路径', run.capitalAttackPath.backupRoute);
  requireText('失效路径', run.capitalAttackPath.invalidationRoute);
  requireText('全局今日进攻概率', run.capitalAttackPath.todayAttackProbability);
  requireText('资金路径理由', run.capitalAttackPath.rationale);
  requireText('资金路径行动条件', run.capitalAttackPath.actionCondition);
  requireText('市场情绪', run.marketSentiment);
  if (!run.previousContinuity.length || run.previousContinuity.some((row) => [row.name, row.status, row.action, row.evidence].some(absent))) {
    missing.push('上一期连续跟踪');
  }
  if (!run.risks.length || run.risks.some(absent)) missing.push('全局风险');
  if (!run.sourceNotes.length || run.sourceNotes.some(absent)) missing.push('数据来源');
  for (const theme of run.themes) {
    const prefix = `题材“${theme.name}”`;
    requireText(`${prefix}结论`, theme.conclusion);
    requireText(`${prefix}生命周期`, theme.lifecycle);
    requireText(`${prefix}资金类型`, theme.capitalType);
    requireText(`${prefix}进攻路径`, theme.attackPath);
    requireText(`${prefix}今日进攻概率`, theme.todayAttackProbability);
    requireText(`${prefix}研究概率`, theme.researchProbability);
    requireText(`${prefix}观察权重`, theme.observationWeight);
    if (!theme.todayOnlyDo.length) missing.push(`${prefix}今日只做`);
    if (!theme.todayDoNotDo.length) missing.push(`${prefix}今日不做`);
    requireText(`${prefix}失效条件`, theme.invalidation);
    requireText(`${prefix}风险`, theme.risk);
    const holding = theme.holdingWindow;
    if (!holding
      || [holding.elapsedTradingDays, holding.estimatedRemainingWindow, holding.defaultProtocol].some(absent)
      || !holding.extensionConditions.length
      || holding.extensionConditions.some(absent)
      || !holding.exitConditions.length
      || holding.exitConditions.some(absent)) {
      missing.push(`${prefix}完整持有窗口`);
    }
    if (!theme.triggerSpecs.length) {
      missing.push(`${prefix}触发条件`);
    } else {
      for (const trigger of theme.triggerSpecs) {
        const triggerPrefix = `${prefix}触发“${trigger.label || trigger.id}”`;
        if ([trigger.id, trigger.label, trigger.dataSource, trigger.actionOnTrigger, trigger.actionOnFailure].some(absent)) {
          missing.push(`${triggerPrefix}基础字段`);
        }
        if (trigger.evaluator === 'quote' && (absent(trigger.subjectCode) || absent(trigger.field))) {
          missing.push(`${triggerPrefix}标的/指标`);
        }
        if ((trigger.evaluator === 'quote' || trigger.evaluator === 'breadth')
          && (!trigger.operator || trigger.threshold === undefined || trigger.threshold === '')) {
          missing.push(`${triggerPrefix}运算符/阈值`);
        }
        if (trigger.evaluator === 'time' && (!trigger.operator || (trigger.threshold === undefined && absent(trigger.windowStart)))) {
          missing.push(`${triggerPrefix}时间规则`);
        }
      }
    }
    if (!theme.stocks.length || theme.stocks.some((stock) => absent(stock.name)
      || absent(stock.code)
      || absent(stock.role)
      || stock.roleRank <= 0
      || absent(stock.authenticity))) {
      missing.push(`${prefix}证券代码/角色/真实性`);
    }
  }
  return missing.length ? `结构化跟踪数据不完整：${missing.slice(0, 8).join('、')}${missing.length > 8 ? '等' : ''}。` : null;
}

export const PREMARKET_THEME_STATUS_LABELS: Record<PremarketThemeStatus, string> = {
  pending: '待确认',
  watching: '观察中',
  adopted: '已采纳',
  ignored: '已忽略',
  review: '加入复盘',
};

function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function stringValue(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    const single = stringValue(value);
    return single ? [single] : [];
  }
  return value.map((item) => stringValue(item)).filter(Boolean);
}

function normalizeGrade(value: unknown): PremarketTheme['grade'] {
  const grade = stringValue(value).toUpperCase();
  return grade === 'S' || grade === 'A' || grade === 'B' || grade === 'C' ? grade : 'C';
}

function normalizeStatus(value: unknown): PremarketThemeStatus {
  if (value === 'watching' || value === 'adopted' || value === 'ignored' || value === 'review') return value;
  return 'pending';
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function normalizeStock(value: unknown, index = 0): PremarketThemeStock | null {
  if (typeof value === 'string') return { name: value, roleRank: index + 1 };
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const name = stringValue(raw.name || raw.displayName || raw.display_name);
  if (!name) return null;
  return {
    name,
    code: stringValue(raw.code) || undefined,
    role: stringValue(raw.role) || undefined,
    roleRank: positiveInteger(raw.roleRank || raw.role_rank, index + 1),
    authenticity: stringValue(raw.authenticity || raw.relevance || raw.evidenceLevel || raw.evidence_level) || undefined,
  };
}

function normalizeTriggerEvaluator(value: unknown): ThemeTriggerEvaluator {
  const evaluator = stringValue(value).toLowerCase();
  return evaluator === 'quote' || evaluator === 'breadth' || evaluator === 'time' || evaluator === 'manual'
    ? evaluator
    : 'ai';
}

function normalizeTriggerOperator(value: unknown): ThemeTriggerOperator | undefined {
  const operator = stringValue(value).toLowerCase();
  return operator === 'gt' || operator === 'gte' || operator === 'lt' || operator === 'lte' || operator === 'eq' || operator === 'contains'
    ? operator
    : undefined;
}

function normalizeTrigger(value: unknown, themeId: string, index: number): PremarketThemeTrigger | null {
  if (typeof value === 'string') {
    return {
      id: `${themeId}-trigger-${index + 1}`,
      label: value,
      evaluator: 'ai',
      confirmForSeconds: 0,
      dataSource: '待验证',
      actionOnTrigger: '等待二次确认',
      actionOnFailure: '继续观察',
    };
  }
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const label = stringValue(raw.label || raw.name || raw.description || raw.condition);
  if (!label) return null;
  const thresholdValue = raw.threshold ?? raw.value;
  return {
    id: stringValue(raw.id) || `${themeId}-trigger-${index + 1}`,
    label,
    evaluator: normalizeTriggerEvaluator(raw.evaluator || raw.type),
    subjectCode: stringValue(raw.subjectCode || raw.subject_code || raw.code) || undefined,
    field: stringValue(raw.field || raw.metric) || undefined,
    operator: normalizeTriggerOperator(raw.operator || raw.op),
    threshold: typeof thresholdValue === 'number' || typeof thresholdValue === 'string' ? thresholdValue : undefined,
    windowStart: stringValue(raw.windowStart || raw.window_start) || undefined,
    windowEnd: stringValue(raw.windowEnd || raw.window_end) || undefined,
    confirmForSeconds: Math.max(0, Number(raw.confirmForSeconds || raw.confirm_for_seconds) || 0),
    dataSource: stringValue(raw.dataSource || raw.data_source, '待验证'),
    actionOnTrigger: stringValue(raw.actionOnTrigger || raw.action_on_trigger, '等待二次确认'),
    actionOnFailure: stringValue(raw.actionOnFailure || raw.action_on_failure, '继续观察'),
  };
}

function normalizeHoldingWindow(value: unknown): PremarketHoldingWindow | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const window = {
    elapsedTradingDays: stringValue(raw.elapsedTradingDays || raw.elapsed_trading_days || raw.elapsed || raw.runningDays || raw.running_days),
    estimatedRemainingWindow: stringValue(
      raw.estimatedRemainingWindow ||
        raw.estimated_remaining_window ||
        raw.remainingWindow ||
        raw.remaining_window ||
        raw.window,
    ),
    defaultProtocol: stringValue(raw.defaultProtocol || raw.default_protocol || raw.holdingProtocol || raw.holding_protocol),
    extensionConditions: stringList(raw.extensionConditions || raw.extension_conditions || raw.extendConditions || raw.extend_conditions),
    exitConditions: stringList(raw.exitConditions || raw.exit_conditions || raw.shorteningConditions || raw.shortening_conditions),
  };
  if (
    !window.elapsedTradingDays &&
    !window.estimatedRemainingWindow &&
    !window.defaultProtocol &&
    !window.extensionConditions.length &&
    !window.exitConditions.length
  ) {
    return undefined;
  }
  return window;
}

function objectRoute(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const raw = value as Record<string, unknown>;
  return stringValue(raw.route || raw.primaryRoute || raw.primary_route || raw.path);
}

function normalizeTheme(value: unknown, index: number): PremarketTheme | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const name = stringValue(raw.name || raw.theme);
  if (!name) return null;
  const id = stringValue(raw.id) || `theme-${index + 1}-${name}`;
  const structuredTriggers = raw.triggerSpecs || raw.trigger_specs;
  const triggerValues = Array.isArray(structuredTriggers)
    ? structuredTriggers
    : stringList(raw.triggers || raw.confirmationTriggers || raw.confirmation_triggers);
  return {
    id,
    rank: positiveInteger(raw.rank, index + 1),
    name,
    grade: normalizeGrade(raw.grade),
    conclusion: stringValue(raw.conclusion || raw.verdict || raw.todayConclusion),
    lifecycle: stringValue(raw.lifecycle || raw.lifecycleStage || raw.stage, '待验证'),
    capitalType: stringValue(raw.capitalType || raw.capital_type, '待验证'),
    attackPath: stringValue(raw.attackPath || raw.attack_path) || objectRoute(raw.capitalAttackPath || raw.capital_attack_path),
    todayAttackProbability: stringValue(
      raw.todayAttackProbability ||
        raw.today_attack_probability ||
        raw.probabilityAttackToday ||
        raw.probability_attack_today ||
        raw.attackProbabilityToday ||
        raw.attack_probability_today,
      '未给出',
    ),
    researchProbability: stringValue(raw.researchProbability || raw.research_probability || raw.probability, '未给出'),
    observationWeight: stringValue(raw.observationWeight || raw.observation_weight || raw.weight, '未给出'),
    holdingWindow: normalizeHoldingWindow(raw.holdingWindow || raw.holding_window || raw.durationReview || raw.duration_review),
    todayOnlyDo: stringList(raw.todayOnlyDo || raw.today_only_do),
    todayDoNotDo: stringList(raw.todayDoNotDo || raw.today_do_not_do),
    triggers: stringList(raw.triggers || raw.confirmationTriggers || raw.confirmation_triggers),
    triggerSpecs: triggerValues
      .map((trigger, triggerIndex) => normalizeTrigger(trigger, id, triggerIndex))
      .filter((trigger): trigger is PremarketThemeTrigger => Boolean(trigger)),
    invalidation: stringValue(raw.invalidation || raw.failureAction || raw.failure_action),
    risk: stringValue(raw.risk || raw.riskNote || raw.risk_note),
    stocks: Array.isArray(raw.stocks) ? raw.stocks.map(normalizeStock).filter((item): item is PremarketThemeStock => Boolean(item)) : [],
    status: normalizeStatus(raw.status),
  };
}

function normalizeCapitalAttackPath(value: unknown): CapitalAttackPath {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    primaryRoute: stringValue(raw.primaryRoute || raw.primary_route || raw.primary || raw.topAttackHypothesis || raw.top_attack_hypothesis),
    backupRoute: stringValue(raw.backupRoute || raw.backup_route || raw.backup),
    invalidationRoute: stringValue(raw.invalidationRoute || raw.invalidation_route || raw.invalidation || raw.failureRoute || raw.failure_route),
    todayAttackProbability: stringValue(
      raw.todayAttackProbability ||
        raw.today_attack_probability ||
        raw.probabilityToday ||
        raw.probability_today ||
        raw.todayProbability ||
        raw.today_probability,
    ),
    rationale: stringValue(raw.rationale || raw.reason || raw.whyFundsChoose || raw.why_funds_choose),
    actionCondition: stringValue(raw.actionCondition || raw.action_condition || raw.onlyIf || raw.only_if || raw.confirmationConditions || raw.confirmation_conditions),
  };
}

function normalizeExecutionGate(value: unknown): ExecutionGate {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    state: stringValue(raw.state || raw.gate || raw.executionGate, '只观察'),
    todayOnlyDo: stringList(raw.todayOnlyDo || raw.today_only_do),
    todayDoNotDo: stringList(raw.todayDoNotDo || raw.today_do_not_do),
    triggerBeforeAction: stringList(raw.triggerBeforeAction || raw.trigger_before_action || raw.triggers),
    failureAction: stringValue(raw.failureAction || raw.failure_action, '证据不足或触发失败时保持观察。'),
  };
}

function isAuctionReportMode(reportMode: string): boolean {
  return /auction|9:25|集合竞价/i.test(reportMode);
}

function missingDailyReportSections(reportMarkdown: string, reportMode: string): string[] {
  if (!reportMarkdown.trim()) return [];
  const text = reportMarkdown.replace(/```[\s\S]*?```/g, '');
  if (isAuctionReportMode(reportMode)) {
    return [
      ['9:25确认结论'],
      ['只做什么角色', '只做'],
      ['不做什么角色', '不做'],
      ['9:30-9:45'],
      ['失败动作'],
    ]
      .filter((aliases) => !aliases.some((alias) => text.includes(alias)))
      .map((aliases) => aliases[0]);
  }
  return [
    ['今日执行闸门'],
    ['今日资金进攻路径', '资金进攻路径'],
    ['今日进攻概率'],
    ['情绪指标仪表盘', '情绪指标'],
    ['隔夜全球线索'],
    ['全球线索到A股题材映射', 'A股题材映射'],
    ['上一期主题连续跟踪'],
    ['题材分级与生命周期', '题材分级'],
    ['题材持续时间与持有复核', '预计剩余窗口'],
    ['龙头 / 中军 / 趋势核心 / 补涨矩阵', '补涨矩阵'],
    ['研究概率'],
    ['观察权重'],
    ['风险提示'],
  ]
    .filter((aliases) => !aliases.some((alias) => text.includes(alias)))
    .map((aliases) => aliases[0]);
}

function normalizeContinuity(value: unknown): PremarketContinuityRow[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const raw = item as Record<string, unknown>;
      const name = stringValue(raw.name || raw.theme);
      if (!name) return null;
      return {
        name,
        status: stringValue(raw.status || raw.continuityStatus || raw.continuity_label),
        action: stringValue(raw.action || raw.carryoverAction || raw.carryover_action),
        evidence: stringValue(raw.evidence || raw.evidenceSummary || raw.evidence_summary),
      };
    })
    .filter((item): item is PremarketContinuityRow => Boolean(item));
}

function extractJsonCandidates(text: string): Array<{ json: string; endIndex: number }> {
  const candidates: Array<{ json: string; endIndex: number }> = [];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = fenced.exec(text))) {
    candidates.push({ json: match[1].trim(), endIndex: fenced.lastIndex });
  }
  const schemaIndex = Math.max(text.indexOf(PREMARKET_THEME_SCHEMA), text.indexOf(PREMARKET_THEME_SCHEMA_V1));
  if (schemaIndex >= 0) {
    const start = text.lastIndexOf('{', schemaIndex);
    const end = text.indexOf('\n\n', schemaIndex);
    if (start >= 0) {
      candidates.push({ json: text.slice(start, end >= 0 ? end : undefined).trim(), endIndex: end >= 0 ? end : text.length });
    }
  }
  return candidates;
}

function markdownAfterFirstJson(text: string, endIndex: number): string {
  return text.slice(endIndex).trim();
}

function shanghaiDate(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(parsed));
}

export function stableThemeContentHash(value: unknown): string {
  const text = typeof value === 'string' ? value : stableJson(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function legacySecurityCode(value: string): string | undefined {
  const explicit = value.match(/\b(\d{6})\.(XSHG|XSHE)\b/i);
  if (explicit) return `${explicit[1]}.${explicit[2].toUpperCase()}`;
  const plain = value.match(/(?:^|[^\d])(\d{6})(?!\d)/)?.[1];
  if (!plain) return undefined;
  return `${plain}.${plain.startsWith('6') || plain.startsWith('9') ? 'XSHG' : 'XSHE'}`;
}

function legacyTimestamp(text: string): string {
  const iso = text.match(/20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})/)?.[0];
  if (iso && Number.isFinite(Date.parse(iso))) return new Date(iso).toISOString();
  const local = text.match(/(20\d{2}[-/]\d{2}[-/]\d{2})\s+(\d{1,2}:\d{2}(?::\d{2})?)/);
  if (local) {
    const parsed = Date.parse(`${local[1].split('/').join('-')}T${local[2]}+08:00`);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return '';
}

export function extractLegacyPremarketThemeDraft(text: string, title = '导入的历史日报'): PremarketThemeRun | null {
  const rows = text.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.includes('|') && !/^\|?\s*:?-{2,}/.test(line))
    .map((line) => line.split('|').map((cell) => cell.trim()).filter(Boolean))
    .filter((cells) => cells.length > 1);
  const table = (headers: string[]) => {
    const start = rows.findIndex((cells) => headers.every((header) => cells.includes(header)));
    if (start < 0) return [] as string[][];
    const width = rows[start].length;
    const body: string[][] = [];
    for (const cells of rows.slice(start + 1)) {
      if (cells.length !== width) break;
      body.push(cells);
    }
    return body;
  };
  const gradeRows = table(['评级', '主题', '生命周期', '今日进攻概率', '观察权重']);
  const roleRows = table(['题材', '角色', '标的']).filter((cells) => /\d{6}/.test(cells[2] || ''));
  if (!roleRows.length) return null;
  const normalizedTokens = (value: string) => value.split(/[\/／]/).map((item) => item.replace(/医药医疗|医药/g, '医药').trim()).filter(Boolean);
  const matchScore = (left: string, right: string) => {
    const leftTokens = normalizedTokens(left);
    const rightTokens = normalizedTokens(right);
    return leftTokens.reduce((score, token) => score + (rightTokens.some((item) => item.includes(token) || token.includes(item)) ? 1 : 0), 0);
  };
  const themeRows = gradeRows.length
    ? gradeRows.map((cells, index) => ({
      rank: index + 1,
      grade: normalizeGrade(cells[0]),
      name: cells[1],
      lifecycle: cells[2] || '待确认',
      capitalType: cells[3] || '待确认',
      todayAttackProbability: cells[4] || '未给出',
      researchProbability: cells[5] || '未给出',
      observationWeight: cells[6] || '未给出',
      conclusion: cells[7] || '由历史报告抽取，待用户确认。',
    }))
    : Array.from(new Set(roleRows.map((cells) => cells[0]))).map((name, index) => ({
      rank: index + 1, grade: 'C' as const, name, lifecycle: '待确认', capitalType: '待确认',
      todayAttackProbability: '未给出', researchProbability: '未给出', observationWeight: '未给出',
      conclusion: '由历史报告表格抽取，待用户确认。',
    }));
  const stockMap = new Map(themeRows.map((theme) => [theme.name, [] as PremarketThemeStock[]]));
  for (const cells of roleRows) {
    const [roleTheme, role, stockCell] = cells;
    const target = [...themeRows].sort((left, right) => matchScore(right.name, roleTheme) - matchScore(left.name, roleTheme))[0];
    if (!target || matchScore(target.name, roleTheme) === 0) continue;
    const chunks = stockCell.split(/[、,，/]/).map((item) => item.trim()).filter(Boolean);
    for (const [index, chunk] of chunks.entries()) {
      const code = legacySecurityCode(chunk);
      const authenticity = chunk.match(/[（(]([ABCD](?:[+-])?)[）)]/i)?.[1]?.toUpperCase();
      const name = chunk
        .replace(/\(?\d{6}(?:\.(?:XSHG|XSHE|SH|SZ))?\)?/gi, '')
        .replace(/[（(][ABCD](?:[+-])?[）)]/gi, '')
        .trim();
      if (!name && !code) continue;
      stockMap.get(target.name)?.push({ name: name || code as string, code, role, roleRank: index + 1, authenticity });
    }
  }
  const generatedAt = legacyTimestamp(text);
  const dateMatch = text.match(/20\d{2}[-/]\d{2}[-/]\d{2}/)?.[0]?.split('/').join('-');
  const tradeDate = dateMatch || (generatedAt ? shanghaiDate(generatedAt) : '');
  const displayTitle = /^(?:index|导入的历史日报)$/i.test(title) && tradeDate
    ? `${Number(tradeDate.slice(5, 7))}月${Number(tradeDate.slice(8, 10))}日${/盘中/.test(text) ? '盘中' : '历史'}主题研究`
    : title;
  const canEstablishTiming = Boolean(generatedAt && tradeDate);
  const executionRows = table(['项目', '结论', '执行含义']);
  const execution = new Map(executionRows.map((cells) => [cells[0], cells]));
  const pathRows = table(['层级', '资金进攻路径', '今日进攻概率', '为什么现在', '失效路线']);
  const primaryPath = pathRows.find((cells) => /主路径/.test(cells[0])) || pathRows[0];
  const backupPath = pathRows.find((cells) => /备选/.test(cells[0]));
  const holdingRows = table(['主题', '已运行', '预计剩余窗口', '默认持有协议', '延长条件', '缩短/退出条件']);
  const triggerRows = table(['时点', '观察对象', '确认条件', '失败动作']);
  const draftThemes: PremarketTheme[] = themeRows.map((value) => {
    const holding = [...holdingRows].sort((left, right) => matchScore(right[0], value.name) - matchScore(left[0], value.name))[0];
    const matchedTriggers = triggerRows.filter((cells) => matchScore(cells[1], value.name) > 0);
    const effectiveTriggers = matchedTriggers.length ? matchedTriggers : value.rank === 1 ? triggerRows.slice(0, 1) : [];
    return {
      id: `legacy-theme-${value.rank}`,
      rank: value.rank,
      name: value.name,
      grade: value.grade,
      conclusion: value.conclusion,
      lifecycle: value.lifecycle,
      capitalType: value.capitalType,
      attackPath: value.rank === 1 ? primaryPath?.[1] || '观察路径' : value.rank === 2 ? backupPath?.[1] || '观察路径' : '观察路径',
      todayAttackProbability: value.todayAttackProbability,
      researchProbability: value.researchProbability,
      observationWeight: value.observationWeight,
      holdingWindow: holding && matchScore(holding[0], value.name) > 0 ? {
        elapsedTradingDays: holding[1], estimatedRemainingWindow: holding[2], defaultProtocol: holding[3],
        extensionConditions: [holding[4]].filter(Boolean), exitConditions: [holding[5]].filter(Boolean),
      } : undefined,
      todayOnlyDo: [execution.get('今日只做')?.[2] || '仅按报告条件观察'].filter(Boolean),
      todayDoNotDo: [execution.get('今日不做')?.[2] || '不事后补写触发'].filter(Boolean),
      triggers: effectiveTriggers.map((cells) => cells[2]),
      triggerSpecs: effectiveTriggers.map((cells, index) => ({
        id: `legacy-theme-${value.rank}-trigger-${index + 1}`,
        label: `${cells[0]} ${cells[2]}`.trim(), evaluator: 'manual' as const, confirmForSeconds: 0,
        dataSource: '导入报告', actionOnTrigger: '用户确认后继续跟踪', actionOnFailure: cells[3] || '继续观察',
      })),
      invalidation: effectiveTriggers.map((cells) => cells[3]).filter(Boolean).join('；'),
      risk: '历史 HTML/Markdown 抽取结果需人工确认', stocks: stockMap.get(value.name) || [], status: 'pending',
    };
  });
  const hashBasis = { title: displayTitle, tradeDate, generatedAt, themes: draftThemes, text };
  return {
    schema: PREMARKET_THEME_SCHEMA,
    sourceSchema: PREMARKET_THEME_SCHEMA_V1,
    id: `legacy-${stableThemeContentHash(hashBasis).slice(6)}`,
    contentHash: stableThemeContentHash(hashBasis),
    tradeDate,
    generatedAt: generatedAt || new Date().toISOString(),
    dataCutoff: generatedAt || '',
    importedAt: new Date().toISOString(),
    reportMode: canEstablishTiming ? 'legacy_import' : 'legacy_import_missing_time',
    title: displayTitle,
    executionGate: {
      state: execution.get('全局状态')?.[1] || '只观察',
      todayOnlyDo: [execution.get('今日只做')?.[2] || execution.get('今日只做')?.[1]].filter((item): item is string => Boolean(item)),
      todayDoNotDo: [execution.get('今日不做')?.[2] || execution.get('今日不做')?.[1]].filter((item): item is string => Boolean(item)),
      triggerBeforeAction: [execution.get('触发再做')?.[2] || execution.get('触发再做')?.[1]].filter((item): item is string => Boolean(item)),
      failureAction: execution.get('失效动作')?.[2] || execution.get('失效动作')?.[1] || '仅用于阅读与复盘。',
    },
    capitalAttackPath: {
      primaryRoute: primaryPath?.[1] || '', backupRoute: backupPath?.[1] || '',
      invalidationRoute: primaryPath?.[4] || '', todayAttackProbability: primaryPath?.[2] || '未给出',
      rationale: primaryPath?.[3] || '', actionCondition: execution.get('触发再做')?.[2] || '',
    },
    marketSentiment: '待确认', previousContinuity: [], themes: draftThemes,
    risks: ['历史 Markdown/HTML 由本地启发式抽取，未经确认不得用于回测。'],
    sourceNotes: ['legacy heuristic extraction'], reportMarkdown: text,
  };
}

export function parsePremarketThemeResult(text: string, options: { requireCompleteReport?: boolean } = {}): PremarketThemeParseResult {
  for (const candidate of extractJsonCandidates(text)) {
    try {
      const parsed = JSON.parse(candidate.json) as Record<string, unknown>;
      if (parsed.schema !== PREMARKET_THEME_SCHEMA && parsed.schema !== PREMARKET_THEME_SCHEMA_V1) continue;
      const themes = Array.isArray(parsed.themes)
        ? parsed.themes.map(normalizeTheme).filter((item): item is PremarketTheme => Boolean(item))
        : [];
      if (!themes.length) {
        return { ok: false, error: '结构化结果里没有可用主题。' };
      }
      const now = new Date().toISOString();
      const generatedAt = stringValue(parsed.generatedAt || parsed.generated_at) || now;
      const dataCutoff = stringValue(parsed.dataCutoff || parsed.data_cutoff) || generatedAt;
      const reportMode = stringValue(parsed.reportMode || parsed.report_mode, 'pre_market');
      const reportMarkdown = markdownAfterFirstJson(text, candidate.endIndex);
      const hashPayload = { ...parsed };
      delete hashPayload.id;
      delete hashPayload.contentHash;
      delete hashPayload.content_hash;
      delete hashPayload.importedAt;
      delete hashPayload.imported_at;
      const capitalAttackPath = normalizeCapitalAttackPath(parsed.capitalAttackPath || parsed.capital_attack_path);
      const missingSections = missingDailyReportSections(reportMarkdown, reportMode);
      const shouldValidateReport = options.requireCompleteReport ?? Boolean(reportMarkdown.trim());
      if (shouldValidateReport && missingSections.length) {
        return {
          ok: false,
          error: `完整报告缺少必填模块：${missingSections.join('、')}。请按 ${ALPHA_STUDIO_DAILY_THEME_SKILL_ID} / neostream-daily-theme-research 标准重生成。`,
        };
      }
      if (shouldValidateReport && !isAuctionReportMode(reportMode)) {
        const missingPathFields = [
          !capitalAttackPath.primaryRoute && '主路径',
          !capitalAttackPath.backupRoute && '备选路径',
          !capitalAttackPath.invalidationRoute && '失效路径',
          !capitalAttackPath.todayAttackProbability && '今日进攻概率',
        ].filter(Boolean);
        if (missingPathFields.length) {
          return {
            ok: false,
            error: `结构化资金进攻路径不完整：缺少${missingPathFields.join('、')}。`,
          };
        }
      }
      return {
        ok: true,
        run: {
          id: stringValue(parsed.id) || createId('premarket'),
          schema: PREMARKET_THEME_SCHEMA,
          sourceSchema: parsed.schema as PremarketThemeRun['sourceSchema'],
          tradeDate: stringValue(parsed.tradeDate || parsed.trade_date) || shanghaiDate(generatedAt),
          dataCutoff,
          contentHash: stableThemeContentHash({ structured: hashPayload, reportMarkdown }),
          generatedAt,
          importedAt: now,
          reportMode,
          title: stringValue(parsed.title, '盘前主题研究'),
          executionGate: normalizeExecutionGate(parsed.executionGate || parsed.execution_gate),
          capitalAttackPath,
          marketSentiment: stringValue(parsed.marketSentiment || parsed.market_sentiment, '未给出'),
          themes,
          previousContinuity: normalizeContinuity(parsed.previousContinuity || parsed.previous_continuity),
          risks: stringList(parsed.risks),
          sourceNotes: stringList(parsed.sourceNotes || parsed.source_notes),
          reportMarkdown,
        },
      };
    } catch {
      // Try the next candidate; Codex output may contain other fenced blocks.
    }
  }
  return { ok: false, error: `最近回复中没有找到 ${PREMARKET_THEME_SCHEMA} JSON。` };
}

export function normalizePremarketThemeRun(value: unknown): PremarketThemeRun | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (raw.schema !== PREMARKET_THEME_SCHEMA && raw.schema !== PREMARKET_THEME_SCHEMA_V1) return null;
  const parsed = parsePremarketThemeResult(`\`\`\`json\n${JSON.stringify(raw)}\n\`\`\``, { requireCompleteReport: false });
  if (!parsed.ok || !parsed.run) return null;
  const sourceSchema = raw.sourceSchema === PREMARKET_THEME_SCHEMA_V1 || raw.source_schema === PREMARKET_THEME_SCHEMA_V1
    ? PREMARKET_THEME_SCHEMA_V1
    : parsed.run.sourceSchema;
  const storedMarkdown = stringValue(raw.reportMarkdown || raw.report_markdown) || parsed.run.reportMarkdown;
  const legacyDraft = sourceSchema === PREMARKET_THEME_SCHEMA_V1 && storedMarkdown
    ? extractLegacyPremarketThemeDraft(storedMarkdown, stringValue(raw.title, parsed.run.title))
    : null;
  return {
    ...(legacyDraft || parsed.run),
    id: stringValue(raw.id) || parsed.run.id,
    sourceSchema,
    importedAt: stringValue(raw.importedAt || raw.imported_at) || parsed.run.importedAt,
    contentHash: stringValue(raw.contentHash || raw.content_hash) || parsed.run.contentHash,
    reportMarkdown: storedMarkdown,
    sourceConversationId: stringValue(raw.sourceConversationId || raw.source_conversation_id) || undefined,
    sourceMessageId: stringValue(raw.sourceMessageId || raw.source_message_id) || undefined,
    sourceBoundAt: stringValue(raw.sourceBoundAt || raw.source_bound_at) || undefined,
  };
}

export function bindPremarketThemeRun(
  run: PremarketThemeRun,
  sourceConversationId: string,
  sourceMessageId?: string,
): PremarketThemeRun {
  return {
    ...run,
    sourceConversationId,
    sourceMessageId,
    sourceBoundAt: new Date().toISOString(),
  };
}

export function loadPremarketThemeRuns(): PremarketThemeRun[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(PREMARKET_THEME_RUNS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizePremarketThemeRun).filter((item): item is PremarketThemeRun => Boolean(item));
  } catch {
    return [];
  }
}

export function savePremarketThemeRun(run: PremarketThemeRun): PremarketThemeRun[] {
  if (typeof window === 'undefined') return [run];
  const existingRuns = loadPremarketThemeRuns();
  const storedRun = existingRuns.some((item) => item.id === run.id && item.contentHash !== run.contentHash)
    ? { ...run, id: `${run.id}-${run.contentHash.slice(0, 10)}` }
    : run;
  const next = [
    storedRun,
    ...existingRuns.filter((item) => {
      if (item.contentHash === storedRun.contentHash || item.id === storedRun.id) return false;
      const replacesLegacyDraft = storedRun.sourceSchema === PREMARKET_THEME_SCHEMA
        && item.sourceSchema === PREMARKET_THEME_SCHEMA_V1
        && item.reportMode === 'legacy_import'
        && item.tradeDate === storedRun.tradeDate;
      return !replacesLegacyDraft;
    }),
  ];
  window.localStorage.setItem(PREMARKET_THEME_RUNS_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(PREMARKET_THEME_RUNS_CHANGED_EVENT, { detail: next }));
  schedulePremarketThemePersist(next);
  return next;
}

export function savePremarketThemeRuns(runs: PremarketThemeRun[]): PremarketThemeRun[] {
  const seen = new Set<string>();
  const normalized = runs
    .map(normalizePremarketThemeRun)
    .filter((item): item is PremarketThemeRun => Boolean(item))
    .filter((item) => {
      if (seen.has(item.contentHash)) return false;
      seen.add(item.contentHash);
      return true;
    });
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(PREMARKET_THEME_RUNS_KEY, JSON.stringify(normalized));
    window.dispatchEvent(new CustomEvent(PREMARKET_THEME_RUNS_CHANGED_EVENT, { detail: normalized }));
    schedulePremarketThemePersist(normalized);
  }
  return normalized;
}

function schedulePremarketThemePersist(runs: PremarketThemeRun[]): void {
  scheduleLocalStoreCommit('premarket-theme-runs', {
    premarketThemeRuns: runs,
    audit: {
      domain: 'theme_research',
      action: 'runs.persist',
      payload: { count: runs.length },
    },
  });
}

function quoteLine(quote: ResearchQuote): string {
  return `${quote.name}(${shortCode(quote.code)}) ${quote.sector} ${formatPercent(quote.changePct)} 成交额${formatMoney(quote.turnover * 100000000)}`;
}

function topQuotes(quotes: ResearchQuote[], sort: (a: ResearchQuote, b: ResearchQuote) => number, count = 8): string[] {
  return [...quotes].sort(sort).slice(0, count).map(quoteLine);
}

function portfolioLine(portfolio: ResearchPortfolio, quotes: Map<string, ResearchQuote>): string {
  const members = portfolio.codes.map((code) => quotes.get(code)?.name ?? shortCode(code)).join('、') || '暂无成分';
  return `${portfolio.name}: ${members}${portfolio.note ? `；备注：${portfolio.note}` : ''}`;
}

function previousLedgerLines(previousRuns: PremarketThemeRun[]): string[] {
  const latest = previousRuns[0];
  if (!latest) return ['未获得上一期主题台账，本期从零建立连续跟踪。'];
  return latest.themes.map((theme) => {
    const label = PREMARKET_THEME_STATUS_LABELS[theme.status];
    return `${theme.name}: ${theme.grade}，${theme.lifecycle}，上次状态 ${label}，结论：${theme.conclusion || '未给出'}`;
  });
}

export function buildPremarketThemePrompt(input: PremarketThemePromptInput): string {
  const generatedAt = input.generatedAt ?? new Date();
  const quotes = input.quotes;
  const watchlist = input.state.watchlist
    .map((code) => quotes.get(code))
    .filter((quote): quote is ResearchQuote => Boolean(quote))
    .map(quoteLine);
  const holdings = input.summary.holdings.map(
    (row) =>
      `${row.quote.name}(${shortCode(row.code)}) ${row.quantity}股，占总资产${formatPercent(row.weightPct)}，浮盈亏${formatSignedMoney(row.pnl)}，行业${row.quote.sector}`,
  );
  const exposures = sectorExposure(input.summary).map((row) => `${row.sector} ${formatPercent(row.pct)}`);
  const marketQuotes = input.fullMarketQuotes.length ? input.fullMarketQuotes : Array.from(quotes.values());
  const gainers = topQuotes(marketQuotes, (a, b) => b.changePct - a.changePct, 10);
  const losers = topQuotes(marketQuotes, (a, b) => a.changePct - b.changePct, 8);
  const turnover = topQuotes(marketQuotes, (a, b) => b.turnover - a.turnover, 8);
  const portfolios = input.state.portfolios.map((portfolio) => portfolioLine(portfolio, quotes));
  const previousLedger = previousLedgerLines(input.previousRuns);

  return [
    '请使用 alpha-studio-daily-theme-research skill 生成 Alpha Studio 右侧投研工作台的盘前主题研究。',
    '该 skill 的研究规则、报告深度、模块顺序、评分/连续跟踪/产业链真实性/校验要求必须与 neostream-daily-theme-research 保持一致；只把名称与品牌替换为 Alpha Studio / Alpha Studio Research。',
    '',
    '输出要求：',
    `1. 先输出一个 fenced JSON 代码块，schema 必须为 \`${PREMARKET_THEME_SCHEMA}\`。`,
    '2. JSON 后继续输出完整 Markdown 研究报告，保留 Alpha Studio Research 的风格；默认是正式日报，不要压缩成 3-5 页骨架或只给卡片摘要。',
    '3. JSON 用于工作台卡片，Markdown 用于完整报告归档。',
    '4. 必须根据当前生成时间判断是盘前、盘前延迟版、盘中更新还是复盘 + 次日前瞻；不要混用前收盘情绪和盘中数据。',
    '5. 需要浏览或验证最新市场/新闻数据，并在 Markdown 报告里列出来源；如果当前上下文数据不足，执行闸门默认 `只观察`。',
    '6. 正式 Markdown 报告必须出现这些显式标题/标签：`今日执行闸门`、`今日资金进攻路径`、`今日进攻概率`、`情绪指标仪表盘`、`隔夜全球线索`、`全球线索到A股题材映射`、`上一期主题连续跟踪`、`题材分级与生命周期`、`题材持续时间与持有复核`、`龙头 / 中军 / 趋势核心 / 补涨矩阵`、`研究概率`、`观察权重`、`风险提示`。',
    '7. `今日资金进攻路径` 必须放在广义题材排名之前，包含主路径、备选路径、失效路径、今日进攻概率、资金为什么现在会选择该路径、只在什么条件下做。',
    '8. 每个 S/A/B 主题必须给出已运行天数、预计剩余窗口、默认持有协议、延长条件、缩短/退出条件；没有历史样本时写 `模型估计`。',
    '9. 股票角色矩阵必须保留一行多股的 `龙头 / 中军 / 趋势核心 / 补涨矩阵` 节奏，默认不要拆成 ROLE MATRIX I/II；使用 5 列紧凑表：`题材 / 角色 / 标的 / 角色逻辑 / 确认/失效`。不要把 `持有复核`、`今日处理` 做成角色矩阵列；这些内容放到表后的 callout 或单独 `角色限制` 表。产业链真实性只写股票名后的评级括号，如 `浪潮信息（A）`，表后一句解释 A/B/C/D。',
    '',
    'JSON 结构必须使用这些字段：',
    JSON.stringify(
      {
        schema: PREMARKET_THEME_SCHEMA,
        tradeDate: generatedAt.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }),
        dataCutoff: generatedAt.toISOString(),
        generatedAt: generatedAt.toISOString(),
        reportMode: 'pre_market|delayed_pre_market|intraday|post_market',
        title: '盘前主题研究',
        executionGate: {
          state: '完全不做|只观察|触发后轻仓试错|只做主线核心|持有/减仓优先',
          todayOnlyDo: ['...'],
          todayDoNotDo: ['...'],
          triggerBeforeAction: ['...'],
          failureAction: '...',
        },
        capitalAttackPath: {
          primaryRoute: '主路径 / top attack hypothesis',
          backupRoute: '备选路径',
          invalidationRoute: '失效路径',
          todayAttackProbability: '今日进攻概率',
          rationale: '为什么资金会选择这条路径',
          actionCondition: '只在什么条件下做',
        },
        marketSentiment: 'defensive|trial|active|aggressive + 中文解释',
        previousContinuity: [{ name: '主题', status: '继续/降级观察/减仓退出/结束/缺席复核', action: '...', evidence: '...' }],
        themes: [
          {
            id: 'theme-ai-hardware',
            rank: 1,
            name: 'AI硬件',
            grade: 'S|A|B|C',
            conclusion: '...',
            lifecycle: 'startup|fermentation|climax|retreat',
            capitalType: 'institutional|hot_money|mixed',
            attackPath: '双核共振|中军先行|龙头先行|轮动防守|无主线观察',
            todayAttackProbability: '今日进攻概率',
            researchProbability: '1-3交易日研究概率',
            observationWeight: '观察权重',
            holdingWindow: {
              elapsedTradingDays: '已运行交易日',
              estimatedRemainingWindow: '预计剩余窗口，必须注明模型估计/历史样本/混合估计',
              defaultProtocol: '默认持有协议',
              extensionConditions: ['延长条件'],
              exitConditions: ['缩短/退出条件'],
            },
            todayOnlyDo: ['...'],
            todayDoNotDo: ['...'],
            triggers: ['...'],
            triggerSpecs: [{
              id: 'theme-ai-hardware-breadth',
              label: '题材上涨家数占比超过 60%',
              evaluator: 'breadth|quote|time|ai|manual',
              subjectCode: '000000.XSHE',
              field: 'changePct|volumeRatio|breadthPct|time',
              operator: 'gt|gte|lt|lte|eq|contains',
              threshold: 60,
              windowStart: '09:30',
              windowEnd: '10:00',
              confirmForSeconds: 60,
              dataSource: 'eastmoney|jqdata|official_news',
              actionOnTrigger: '等待二次确认',
              actionOnFailure: '继续观察',
            }],
            invalidation: '...',
            risk: '...',
            stocks: [{ name: '标的（A）', code: '000000.XSHE', role: '中军/趋势核心/龙头/补涨', roleRank: 1, authenticity: 'A/B/C/D' }],
          },
        ],
        risks: ['...'],
        sourceNotes: ['...'],
      },
      null,
      2,
    ),
    '',
    'Markdown 正式报告推荐顺序（与 neostream-daily-theme-research 保持一致）：',
    '1. 标题/封面信息：生成时间、数据窗口、报告模式。',
    '2. 市场页：第一句给 command-level 结论；随后是今日执行闸门、今日资金进攻路径、情绪指标仪表盘。',
    '3. 隔夜全球页：美股/港股/A50/汇率利率/商品/宏观日历，并逐条映射 A 股确认要求。',
    '4. 数据口径与上一期连续跟踪：口径冲突写明来源，上一期活跃主题不可消失。',
    '5. 新闻催化与题材全景：区分国家级、产业级、公司级和社媒热度。',
    '6. 题材排名与生命周期：S/A/B/C、资金类型、今日进攻概率、研究概率、观察权重、今日结论、今日只做、今日不做。',
    '7. 题材持续时间与持有复核：已运行、预计剩余窗口、持有协议、延长/退出条件。',
    '8. 股票角色矩阵：龙头 / 中军 / 趋势核心 / 补涨矩阵，尽量一页呈现；只用 5 列紧凑表，保留评级后缀和确认/失效，持有复核不要做成矩阵列。',
    '9. 盘中触发、禁止交易区、隔夜持有纪律、来源与风险提示。',
    '',
    '当前本地上下文：',
    `- 生成时间：${generatedAt.toLocaleString('zh-CN', { hour12: false })}`,
    '- 数据口径：右侧投研工作台提供本地自选、持仓、组合、指数/全市场快照；正式结论必须重新验证最新市场、公告和新闻来源。',
    `- 模拟账户：总资产 ${formatMoney(input.summary.totalAssets)}，现金 ${formatMoney(input.state.cash)}，仓位 ${formatPercent(input.summary.exposurePct)}，最大单票 ${formatPercent(input.summary.concentrationPct)}。`,
    `- 行业暴露：${exposures.join('；') || '暂无持仓暴露'}`,
    '- 持仓：',
    ...(holdings.length ? holdings.map((line) => `  - ${line}`) : ['  - 暂无持仓']),
    '- 自选：',
    ...(watchlist.length ? watchlist.map((line) => `  - ${line}`) : ['  - 暂无自选真实行情']),
    '- 组合：',
    ...(portfolios.length ? portfolios.map((line) => `  - ${line}`) : ['  - 暂无组合']),
    '- 市场快照（本地行情，仅作上下文，正式报告仍需验证来源）：',
    `  - 涨幅靠前：${gainers.join('；') || '暂无'}`,
    `  - 跌幅靠前：${losers.join('；') || '暂无'}`,
    `  - 成交额靠前：${turnover.join('；') || '暂无'}`,
    '- 上一期主题连续跟踪：',
    ...previousLedger.map((line) => `  - ${line}`),
  ].join('\n');
}
