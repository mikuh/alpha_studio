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
export const PREMARKET_THEME_SCHEMA = 'alpha.premarket_theme.v1';
export const PREMARKET_THEME_RUNS_KEY = 'alpha-studio.premarket-theme-runs.v1';

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
  authenticity?: string;
}

export interface PremarketTheme {
  id: string;
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

function normalizeStock(value: unknown): PremarketThemeStock | null {
  if (typeof value === 'string') return { name: value };
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const name = stringValue(raw.name || raw.displayName || raw.display_name);
  if (!name) return null;
  return {
    name,
    code: stringValue(raw.code) || undefined,
    role: stringValue(raw.role) || undefined,
    authenticity: stringValue(raw.authenticity || raw.relevance || raw.evidenceLevel || raw.evidence_level) || undefined,
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
  return {
    id: stringValue(raw.id) || `theme-${index + 1}-${name}`,
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
  const schemaIndex = text.indexOf(PREMARKET_THEME_SCHEMA);
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

export function parsePremarketThemeResult(text: string, options: { requireCompleteReport?: boolean } = {}): PremarketThemeParseResult {
  for (const candidate of extractJsonCandidates(text)) {
    try {
      const parsed = JSON.parse(candidate.json) as Record<string, unknown>;
      if (parsed.schema !== PREMARKET_THEME_SCHEMA) continue;
      const themes = Array.isArray(parsed.themes)
        ? parsed.themes.map(normalizeTheme).filter((item): item is PremarketTheme => Boolean(item))
        : [];
      if (!themes.length) {
        return { ok: false, error: '结构化结果里没有可用主题。' };
      }
      const now = new Date().toISOString();
      const reportMode = stringValue(parsed.reportMode || parsed.report_mode, 'pre_market');
      const reportMarkdown = markdownAfterFirstJson(text, candidate.endIndex);
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
          generatedAt: stringValue(parsed.generatedAt || parsed.generated_at) || now,
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

function normalizeRun(value: unknown): PremarketThemeRun | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (raw.schema !== PREMARKET_THEME_SCHEMA) return null;
  const parsed = parsePremarketThemeResult(`\`\`\`json\n${JSON.stringify(raw)}\n\`\`\``, { requireCompleteReport: false });
  if (!parsed.ok || !parsed.run) return null;
  return {
    ...parsed.run,
    id: stringValue(raw.id) || parsed.run.id,
    importedAt: stringValue(raw.importedAt || raw.imported_at) || parsed.run.importedAt,
    reportMarkdown: stringValue(raw.reportMarkdown || raw.report_markdown) || parsed.run.reportMarkdown,
  };
}

export function loadPremarketThemeRuns(): PremarketThemeRun[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(PREMARKET_THEME_RUNS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeRun).filter((item): item is PremarketThemeRun => Boolean(item));
  } catch {
    return [];
  }
}

export function savePremarketThemeRun(run: PremarketThemeRun): PremarketThemeRun[] {
  if (typeof window === 'undefined') return [run];
  const next = [run, ...loadPremarketThemeRuns().filter((item) => item.id !== run.id)].slice(0, 30);
  window.localStorage.setItem(PREMARKET_THEME_RUNS_KEY, JSON.stringify(next));
  schedulePremarketThemePersist(next);
  return next;
}

export function savePremarketThemeRuns(runs: PremarketThemeRun[]): PremarketThemeRun[] {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(PREMARKET_THEME_RUNS_KEY, JSON.stringify(runs.slice(0, 30)));
    schedulePremarketThemePersist(runs.slice(0, 30));
  }
  return runs.slice(0, 30);
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
    '1. 先输出一个 fenced JSON 代码块，schema 必须为 `alpha.premarket_theme.v1`。',
    '2. JSON 后继续输出完整 Markdown 研究报告，保留 Alpha Studio Research 的风格；默认是正式日报，不要压缩成 3-5 页骨架或只给卡片摘要。',
    '3. JSON 用于工作台卡片，Markdown 用于完整报告归档。',
    '4. 必须根据当前生成时间判断是盘前、盘前延迟版、盘中更新还是复盘 + 次日前瞻；不要混用前收盘情绪和盘中数据。',
    '5. 需要浏览或验证最新市场/新闻数据，并在 Markdown 报告里列出来源；如果当前上下文数据不足，执行闸门默认 `只观察`。',
    '6. 正式 Markdown 报告必须出现这些显式标题/标签：`今日执行闸门`、`今日资金进攻路径`、`今日进攻概率`、`情绪指标仪表盘`、`隔夜全球线索`、`全球线索到A股题材映射`、`上一期主题连续跟踪`、`题材分级与生命周期`、`题材持续时间与持有复核`、`龙头 / 中军 / 趋势核心 / 补涨矩阵`、`研究概率`、`观察权重`、`风险提示`。',
    '7. `今日资金进攻路径` 必须放在广义题材排名之前，包含主路径、备选路径、失效路径、今日进攻概率、资金为什么现在会选择该路径、只在什么条件下做。',
    '8. 每个 S/A/B 主题必须给出已运行天数、预计剩余窗口、默认持有协议、延长条件、缩短/退出条件；没有历史样本时写 `模型估计`。',
    '9. 股票角色矩阵必须保留一行多股的 `龙头 / 中军 / 趋势核心 / 补涨矩阵` 节奏，产业链真实性只写股票名后的评级括号，如 `浪潮信息（A）`，表后一句解释 A/B/C/D。',
    '',
    'JSON 结构必须使用这些字段：',
    JSON.stringify(
      {
        schema: PREMARKET_THEME_SCHEMA,
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
            invalidation: '...',
            risk: '...',
            stocks: [{ name: '标的（A）', code: '000000.XSHE', role: '中军/趋势核心/龙头/补涨', authenticity: 'A/B/C/D' }],
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
    '8. 股票角色矩阵：龙头 / 中军 / 趋势核心 / 补涨矩阵，保留评级后缀和确认/失效。',
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
