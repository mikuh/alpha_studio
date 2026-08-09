import { invoke } from '@tauri-apps/api/core';
import { isTauriRuntime } from './codexBridge';
import {
  isMarketCacheUsable,
  loadMarketCache,
  marketCacheExpiresAt,
  marketCacheLabel,
  saveMarketCache,
  stableCacheKey,
  stableCodesCacheKey,
} from './localStore';

export interface JqDataConfig {
  version: number;
  enabled: boolean;
  username: string;
  passwordConfigured: boolean;
  apiUrl: string;
  updatedAt: string;
  path: string;
}

export interface JqDataConfigSaveInput {
  enabled: boolean;
  username: string;
  password?: string;
  apiUrl?: string;
}

export interface JqDataProbeResult {
  ok: boolean;
  message: string;
  queryCount?: unknown;
  sample?: {
    priceRows?: Record<string, unknown>[];
    tradeDays?: string[];
    tradeDaysError?: string;
    priceError?: string;
    transport?: string;
    permissionNote?: string;
    authMessage?: string;
    httpError?: string;
  };
}

export const JQDATA_CAPABILITIES = [
  { title: '行情 Bar', detail: '股票、基金、指数、期货的日线、分钟线和部分 tick 数据' },
  { title: '交易日历', detail: '交易日、全市场交易日和代码归一化' },
  { title: '证券基础信息', detail: '股票、基金、指数、期货列表与单标的信息' },
  { title: '行业/概念', detail: '行业列表、概念列表、指数/行业/概念成分股' },
  { title: '资金与情绪', detail: '个股资金流、融资融券、龙虎榜等交易线索' },
  { title: '财务基本面', detail: '估值、利润表、现金流量表、资产负债表与连续财务查询' },
  { title: '衍生品', detail: '期货合约、主力合约、期权行情和合约资料' },
  { title: '宏观与因子', detail: '宏观数据、Alpha101/Alpha191、聚宽因子和风险模型' },
] as const;

export type JqDataCatalogStatus = 'embedded' | 'queryable' | 'planned';

export interface JqDataCatalogItem {
  id: string;
  domain: string;
  group: '市场基础' | '股票研究' | '多资产' | '量化模型' | '另类数据';
  methods: string[];
  entry: string;
  status: JqDataCatalogStatus;
  summary: string;
  freshness: string;
  permission: string;
  example: string;
  agentPrompt: string;
}

const catalogItem = (
  item: Omit<JqDataCatalogItem, 'agentPrompt'> & { researchUse: string },
): JqDataCatalogItem => ({
  ...item,
  agentPrompt: [
    `请使用聚宽 JQData 的「${item.domain}」能力完成研究。`,
    `建议接口：${item.methods.join(' / ')}。`,
    `研究用途：${item.researchUse}。`,
    `数据时效：${item.freshness}；权限提示：${item.permission}。`,
    '请先确认账号权限、日期口径、复权方式和是否存在未来函数，再给出可复现的查询代码、关键字段解释与投资结论。',
  ].join('\n'),
});

// Official JQData domains, mapped to Alpha Studio's actual desktop bridge.
// "embedded" means a visible workbench workflow exists; "queryable" means
// get_price/get_security_info can query the asset but no dedicated workflow
// exists; "planned" means the current native HTTP bridge does not expose it.
export const JQDATA_CATALOG: readonly JqDataCatalogItem[] = [
  catalogItem({
    id: 'bars', domain: '行情与 Bar', group: '市场基础', methods: ['get_price', 'get_bars'],
    entry: '市场 → 个股 K 线', status: 'embedded',
    summary: '股票、指数、基金、可转债、期货和期权的日线/分钟线；工作台当前用 get_price。',
    freshness: '盘中源优先；聚宽日线盘后更新', permission: '基础行情权限',
    example: "get_price('000001.XSHE', count=60, unit='1d', fields=['open','close','high','low','volume','money'])",
    researchUse: '验证趋势、量价、波动率、涨跌停和停牌状态',
  }),
  catalogItem({
    id: 'security', domain: '证券基础信息', group: '市场基础', methods: ['get_security_info'],
    entry: '市场 → 搜索加股', status: 'embedded',
    summary: '名称、类型、上市/退市日期等单标的元数据。',
    freshness: '证券状态变更后更新', permission: '基础信息权限',
    example: "get_security_info('000001.XSHE')",
    researchUse: '核对代码、证券类型、上市时间和样本存续期',
  }),
  catalogItem({
    id: 'calendar-universe', domain: '交易日历与标的池', group: '市场基础', methods: ['get_trade_days', 'get_all_securities', 'normalize_code'],
    entry: '尚无工作台入口', status: 'planned',
    summary: '交易日、代码归一化，以及股票/基金/指数/期货等全量标的列表。',
    freshness: '交易日历与证券列表定期更新', permission: '基础信息权限',
    example: "get_all_securities(types=['stock'], date='2026-07-14')",
    researchUse: '构建无幸存者偏差的历史股票池和回测交易日轴',
  }),
  catalogItem({
    id: 'ticks-auction', domain: 'Tick 与集合竞价', group: '市场基础', methods: ['get_ticks', 'get_call_auction'],
    entry: '尚无工作台入口', status: 'planned',
    summary: '逐笔成交与盘前集合竞价数据，用于微观结构和开盘确认。',
    freshness: '盘后入库；集合竞价按官方口径', permission: 'Tick/特色数据可能需单独权限',
    example: "get_ticks('000001.XSHE', end_dt='2026-07-14 15:00:00', count=1000)",
    researchUse: '判断主动买卖、冲击成本、开盘抢筹与竞价异常',
  }),
  catalogItem({
    id: 'industry-concept', domain: '行业、概念与成分', group: '股票研究', methods: ['get_industry', 'get_industries', 'get_concepts', 'get_industry_stocks', 'get_concept_stocks', 'get_index_stocks'],
    entry: '个股画像（仅行业归属）', status: 'embedded',
    summary: '当前已展示单股行业归属；板块列表、概念和历史成分股尚未桥接。',
    freshness: '行业/概念通常日更，成分需按日期查询', permission: '行业概念权限',
    example: "get_industry('000001.XSHE', date='2026-07-14')",
    researchUse: '识别主线归属、行业暴露、概念扩散和历史成分偏差',
  }),
  catalogItem({
    id: 'money-flow', domain: '个股资金流', group: '股票研究', methods: ['get_money_flow'],
    entry: '市场 → 个股画像', status: 'embedded',
    summary: '主力/超大单/大单/中单/小单净流入及占比。',
    freshness: '盘后约 20:00 更新', permission: '交易统计权限',
    example: "get_money_flow('000001.XSHE', start_date='2026-07-01', end_date='2026-07-14')",
    researchUse: '区分价格上涨是资金驱动、存量博弈还是脉冲异动',
  }),
  catalogItem({
    id: 'mtss', domain: '融资融券', group: '股票研究', methods: ['get_mtss', 'get_mtss_list'],
    entry: '市场 → 个股画像', status: 'embedded',
    summary: '融资余额、买入/偿还额、融券余额等杠杆交易数据。',
    freshness: '交易日盘后更新', permission: '融资融券权限',
    example: "get_mtss('000001.XSHE', start_date='2026-06-01', end_date='2026-07-14')",
    researchUse: '识别杠杆拥挤、融资加速与去杠杆压力',
  }),
  catalogItem({
    id: 'locked-company', domain: '解禁与公司事件', group: '股票研究', methods: ['get_locked_shares', 'finance.run_query'],
    entry: '市场 → 个股画像（仅解禁）', status: 'embedded',
    summary: '已展示限售解禁；股东、质押、分红、公告等上市公司表尚未桥接。',
    freshness: '公告/事件数据按披露更新', permission: 'finance 数据库权限',
    example: "get_locked_shares(['000001.XSHE'], start_date='2026-07-14', forward_count=180)",
    researchUse: '评估未来供给、减持压力、质押风险和公司行为催化',
  }),
  catalogItem({
    id: 'fundamentals', domain: '财务、估值与连续财务', group: '股票研究', methods: ['get_fundamentals', 'get_fundamentals_continuously', 'finance.run_query'],
    entry: '尚无工作台入口', status: 'planned',
    summary: '估值、利润表、资产负债表、现金流量表、财务指标和报告期数据。',
    freshness: '随财报披露更新；必须使用可见日期', permission: '财务数据库权限',
    example: "get_fundamentals(query(valuation.code, valuation.pe_ratio, indicator.roe).filter(valuation.code=='000001.XSHE'), date='2026-07-14')",
    researchUse: '验证盈利质量、现金流、资产负债表韧性、估值与预期差',
  }),
  catalogItem({
    id: 'billboard-stats', domain: '龙虎榜与交易统计', group: '股票研究', methods: ['get_billboard_list', 'finance.run_query'],
    entry: '尚无工作台入口', status: 'planned',
    summary: '龙虎榜、全市场成交概况及部分异常交易统计。',
    freshness: '龙虎榜约 20:00/22:00 更新', permission: '交易统计权限',
    example: "get_billboard_list(stock_list=['000001.XSHE'], start_date='2026-07-01', end_date='2026-07-14')",
    researchUse: '识别席位结构、游资/机构参与度和交易拥挤',
  }),
  catalogItem({
    id: 'connect', domain: '沪深港通', group: '股票研究', methods: ['finance.run_query'],
    entry: '尚无工作台入口', status: 'planned',
    summary: '沪股通、深股通和港股通名单、持股与交易相关数据表。',
    freshness: '交易日更新，具体以表口径为准', permission: 'finance 数据库权限',
    example: "finance.run_query(query(finance.STK_EL_CONST_CHANGE).limit(50))",
    researchUse: '跟踪北向持股变化、资格调整和跨市场资金偏好',
  }),
  ...[
    ['index', '指数', '指数行情/成分', "get_price('000300.XSHG', count=60, unit='1d')", '比较基准、风格轮动和指数成分贡献'],
    ['fund', '基金', '场内基金行情；场外净值/持仓尚无入口', "get_price('510300.XSHG', count=60, unit='1d')", '跟踪 ETF 资金代理、折溢价、净值与持仓结构'],
    ['futures', '期货', '期货合约行情与持仓量', "get_price('IF2609.CCFX', count=60, unit='1d')", '观察基差、期限结构、展期和风险偏好'],
    ['options', '期权', '金融/商品期权合约与行情', "get_price('10000001.XSHG', count=60, unit='1d')", '提取隐含波动、偏度和尾部风险定价'],
    ['bonds', '债券与可转债', '债券/转债基础信息与行情', "get_price('110059.XSHG', count=60, unit='1d')", '评估信用/利率敏感度、转股溢价和双低机会'],
  ].map(([id, domain, summary, example, researchUse]) => catalogItem({
    id, domain, group: '多资产', methods: ['get_price', 'get_security_info'],
    entry: '通用接口可查，尚无专属视图', status: 'queryable', summary,
    freshness: '盘后行情；品种专项数据按表更新', permission: '对应品种行情权限',
    example, researchUse,
  })),
  catalogItem({
    id: 'money-flow-pro', domain: '资金流因子 Pro', group: '量化模型', methods: ['get_money_flow_pro'],
    entry: '尚无工作台入口', status: 'planned',
    summary: '日/分钟级资金流特色数据与资金流因子。',
    freshness: '分钟约 15:00，日级约 19:00', permission: '特色数据需单独采购/授权',
    example: "get_money_flow_pro(['000001.XSHE'], end_date='2026-07-14', count=20, frequency='daily')",
    researchUse: '量化主力资金持续性、反转/趋势与资金拥挤',
  }),
  catalogItem({
    id: 'jq-factors', domain: '聚宽因子库', group: '量化模型', methods: ['get_all_factors', 'get_factor_values', 'get_factor_kanban_values'],
    entry: '尚无工作台入口', status: 'planned',
    summary: '质量、情绪、风险、成长、基础和每股等数百个因子。',
    freshness: '因子按各自定义更新', permission: '聚宽因子权限',
    example: "get_factor_values(['000001.XSHE'], ['ROE_TTM'], end_date='2026-07-14', count=20)",
    researchUse: '做横截面排名、因子暴露、IC/分层收益与组合归因',
  }),
  catalogItem({
    id: 'alpha-technical', domain: 'Alpha101/191 与技术指标', group: '量化模型', methods: ['alpha_101', 'alpha_191', 'technical_analysis'],
    entry: '尚无工作台入口', status: 'planned',
    summary: '经典 Alpha 因子与技术分析指标库。',
    freshness: '随行情更新', permission: '相应因子/指标权限',
    example: "alpha_191.alpha_001('000001.XSHE', '2026-07-14')",
    researchUse: '构造可复现的信号，并检验换手、衰减和拥挤度',
  }),
  catalogItem({
    id: 'risk-model', domain: '风险模型 CNE5/CNE6', group: '量化模型', methods: ['risk.run_query'],
    entry: '尚无工作台入口', status: 'planned',
    summary: '风格因子收益、暴露、协方差和特异风险等风险模型数据。',
    freshness: '交易日更新，CNE6 Pro 视权限', permission: '风险模型权限',
    example: "risk.run_query(query(risk.STK_EXPOSURE).filter(risk.STK_EXPOSURE.code=='000001.XSHE'))",
    researchUse: '拆解行业/风格暴露、风险贡献和非预期共振回撤',
  }),
  catalogItem({
    id: 'sentiment', domain: '舆情数据', group: '另类数据', methods: ['finance.run_query'],
    entry: '尚无工作台入口', status: 'planned',
    summary: '媒体/舆情相关数据表，范围以账号权限和官方字典为准。',
    freshness: '按数据表更新', permission: '舆情数据权限',
    example: "finance.run_query(query(finance.CCTV_NEWS).limit(50))",
    researchUse: '验证叙事热度、催化传播、情绪拐点与事件风险',
  }),
  catalogItem({
    id: 'macro', domain: '宏观数据', group: '另类数据', methods: ['macro.run_query'],
    entry: '尚无工作台入口', status: 'planned',
    summary: '国内重要宏观时间序列；官方文档提示部分宏观数据可能停止更新。',
    freshness: '低频发布，需逐表核对最后更新时间', permission: '宏观数据库权限',
    example: 'macro.run_query(query(macro.MAC_MONEY_SUPPLY_MONTH).limit(24))',
    researchUse: '建立流动性、信用、增长和通胀的宏观情景约束',
  }),
] as const;

export function emptyJqDataConfig(): JqDataConfig {
  return {
    version: 2,
    enabled: false,
    username: '',
    passwordConfigured: false,
    apiUrl: 'https://dataapi.joinquant.com/v2/apis',
    updatedAt: '',
    path: '~/.alpha-studio/jqdata-config.json',
  };
}

export async function loadJqDataConfig(): Promise<JqDataConfig> {
  if (!isTauriRuntime()) return emptyJqDataConfig();
  return invoke<JqDataConfig>('jqdata_config_load');
}

export async function saveJqDataConfig(input: JqDataConfigSaveInput): Promise<{ path: string } | null> {
  if (!isTauriRuntime()) return null;
  return invoke<{ path: string }>('jqdata_config_save', { request: input });
}

export async function testJqDataConnection(): Promise<JqDataProbeResult> {
  if (!isTauriRuntime()) {
    return {
      ok: false,
      message: '浏览器预览模式不会调用 JQData HTTP API。请在桌面应用中测试 JQData。',
    };
  }
  return invoke<JqDataProbeResult>('jqdata_test_connection');
}

export function jqDataUpdatedAtLabel(value: string): string {
  const millis = Number(value);
  if (!Number.isFinite(millis) || millis <= 0) return '尚未保存';
  return new Date(millis).toLocaleString('zh-CN', { hour12: false });
}

// ---- Generic JQData native HTTP query bridge -------------------------------

export interface JqDataQueryResult {
  ok: boolean;
  message?: string;
  rows?: Record<string, unknown>[];
}

export async function jqDataQuery(
  method: string,
  params: Record<string, unknown> = {},
): Promise<JqDataQueryResult> {
  if (!isTauriRuntime()) {
    return { ok: false, message: '浏览器预览模式不会调用 JQData，工作台不会用样例行情替代真实数据。' };
  }
  try {
    const result = await invoke<{ ok: boolean; message?: string; rows?: unknown }>(
      'jqdata_query',
      { request: { method, params } },
    );
    return {
      ok: result.ok,
      message: result.message,
      rows: Array.isArray(result.rows) ? (result.rows as Record<string, unknown>[]) : undefined,
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

export interface JqResearchSnapshot {
  code: string;
  asOfDate: string;
  privileges: string[];
  fundamentals: Record<string, unknown> | null;
  moneyFlow: Record<string, unknown>[];
  mtss: Record<string, unknown>[];
  industry: Record<string, unknown>[];
  concepts: Record<string, unknown>[];
  lockedShares: Record<string, unknown>[];
  billboard: Record<string, unknown>[];
  preopen: Record<string, unknown>[];
  companyResearch: Record<string, unknown>[];
  warnings: string[];
}

function daysBefore(dateText: string, days: number): string {
  const date = new Date(`${dateText}T12:00:00`);
  if (!Number.isFinite(date.getTime())) return dateText;
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

export async function fetchJqResearchSnapshot(
  code: string,
  asOfDate: string,
): Promise<JqResearchSnapshot> {
  const startDate = daysBefore(asOfDate, 90);
  const [privileges, fundamentals, moneyFlow, mtss, industry, concepts, lockedShares, billboard, preopen, companyResearch] =
    await Promise.all([
      jqDataQuery('get_privilege'),
      jqDataQuery('get_fundamentals_snapshot', { code, date: asOfDate }),
      jqDataQuery('get_money_flow', { code, end_date: asOfDate, count: 10 }),
      jqDataQuery('get_mtss', { code, end_date: asOfDate, count: 10 }),
      jqDataQuery('get_industry', { code, date: asOfDate }),
      jqDataQuery('get_concept', { code, date: asOfDate }),
      jqDataQuery('get_locked_shares', { code, start_date: asOfDate, forward_count: 365 }),
      jqDataQuery('get_billboard_list', { code, start_date: startDate, end_date: asOfDate }),
      jqDataQuery('get_preopen_infos', { code }),
      jqDataQuery('get_company_research', { code, date: asOfDate }),
    ]);

  const results = [privileges, fundamentals, moneyFlow, mtss, industry, concepts, lockedShares, billboard, preopen, companyResearch];
  const warnings = results
    .filter((result) => !result.ok && result.message)
    .map((result) => result.message as string);

  return {
    code,
    asOfDate,
    privileges: (privileges.rows ?? [])
      .map((row) => String(row.privilege ?? ''))
      .filter(Boolean),
    fundamentals: fundamentals.rows?.[0] ?? null,
    moneyFlow: moneyFlow.rows ?? [],
    mtss: mtss.rows ?? [],
    industry: industry.rows ?? [],
    concepts: concepts.rows ?? [],
    lockedShares: lockedShares.rows ?? [],
    billboard: billboard.rows ?? [],
    preopen: preopen.rows ?? [],
    companyResearch: companyResearch.rows ?? [],
    warnings,
  };
}

export async function fetchJqSecurityUniverse(
  type: 'stock' | 'fund' | 'index' | 'futures',
  asOfDate: string,
  limit = 120,
): Promise<Record<string, unknown>[]> {
  const result = await jqDataQuery('get_all_securities', { types: [type], date: asOfDate, limit });
  return result.ok ? result.rows ?? [] : [];
}

export interface JqDailyBar {
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
  money?: number;
  paused?: boolean;
  avg?: number;
  preClose?: number;
  highLimit?: number;
  lowLimit?: number;
}

export interface JqHistoricalBar extends JqDailyBar {
  time: string;
}

function normalizeRowKey(key: string): string {
  return key.toLowerCase().replace(/[\s_]+/g, '');
}

function rowValue(row: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (key in row) return row[key];
  }
  const normalizedKeys = new Set(keys.map(normalizeRowKey));
  for (const [key, value] of Object.entries(row)) {
    if (normalizedKeys.has(normalizeRowKey(key))) return value;
  }
  return undefined;
}

function rowString(row: Record<string, unknown>, ...keys: string[]): string {
  const value = rowValue(row, keys);
  if (typeof value === 'string') return value.trim();
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function rowNumber(row: Record<string, unknown>, ...keys: string[]): number {
  const value = rowValue(row, keys);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function rowBoolean(row: Record<string, unknown>, ...keys: string[]): boolean | undefined {
  const value = rowValue(row, keys);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n', ''].includes(normalized)) return false;
  }
  return undefined;
}

function finiteOrUndefined(value: number): number | undefined {
  return Number.isFinite(value) ? value : undefined;
}

function parseDailyBars(rows: Record<string, unknown>[] | undefined): JqDailyBar[] {
  if (!rows?.length) return [];
  return rows
    .map((row) => ({
      date: String(row.date ?? row.index ?? ''),
      open: rowNumber(row, 'open'),
      close: rowNumber(row, 'close'),
      high: rowNumber(row, 'high'),
      low: rowNumber(row, 'low'),
      volume: rowNumber(row, 'volume'),
      money: finiteOrUndefined(rowNumber(row, 'money')),
      paused: rowBoolean(row, 'paused'),
      avg: finiteOrUndefined(rowNumber(row, 'avg')),
      preClose: finiteOrUndefined(rowNumber(row, 'pre_close', 'pre close', 'preclose')),
      highLimit: finiteOrUndefined(rowNumber(row, 'high_limit', 'high limit', 'highlimit')),
      lowLimit: finiteOrUndefined(rowNumber(row, 'low_limit', 'low limit', 'lowlimit')),
    }))
    .filter((bar) => bar.date && Number.isFinite(bar.close));
}

function parseHistoricalBars(rows: Record<string, unknown>[] | undefined): JqHistoricalBar[] {
  if (!rows?.length) return [];
  return rows
    .map((row) => {
      const time = rowString(row, 'index', 'time', 'datetime', 'date');
      return {
        time,
        date: time.slice(0, 10),
        open: rowNumber(row, 'open'),
        close: rowNumber(row, 'close'),
        high: rowNumber(row, 'high'),
        low: rowNumber(row, 'low'),
        volume: rowNumber(row, 'volume'),
        money: finiteOrUndefined(rowNumber(row, 'money')),
        paused: rowBoolean(row, 'paused'),
        avg: finiteOrUndefined(rowNumber(row, 'avg')),
        preClose: finiteOrUndefined(rowNumber(row, 'pre_close', 'pre close', 'preclose')),
        highLimit: finiteOrUndefined(rowNumber(row, 'high_limit', 'high limit', 'highlimit')),
        lowLimit: finiteOrUndefined(rowNumber(row, 'low_limit', 'low limit', 'lowlimit')),
      };
    })
    .filter((bar) => bar.time && Number.isFinite(bar.open) && Number.isFinite(bar.close))
    .sort((a, b) => a.time.localeCompare(b.time));
}

interface CachedJqLivePrice extends JqLivePrice {
  code: string;
}

function jqLiveRowsFromMap(prices: Map<string, JqLivePrice>): CachedJqLivePrice[] {
  return Array.from(prices.entries()).map(([code, value]) => ({ ...value, code }));
}

function jqLiveMapFromRows(rows: unknown): Map<string, JqLivePrice> {
  const map = new Map<string, JqLivePrice>();
  if (!Array.isArray(rows)) return map;
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const value = row as CachedJqLivePrice;
    if (typeof value.code === 'string' && Number.isFinite(Number(value.price))) {
      map.set(value.code, value);
    }
  }
  return map;
}

// Daily bars for one security, oldest first. Returns null when JQData is
// unavailable or returns no usable rows.
export async function fetchJqDailyBars(
  code: string,
  count = 60,
  options: { forceRefresh?: boolean } = {},
): Promise<JqDailyBar[] | null> {
  const cacheKey = stableCacheKey([code, '1d', count, todayStamp()]);
  const cached = await loadMarketCache<JqDailyBar[]>('jqdata', 'daily_bars', cacheKey);
  if (!options.forceRefresh && isMarketCacheUsable(cached)) return cached?.normalizedPayload ?? null;
  const result = await jqDataQuery('get_price', {
    code,
    count,
    unit: '1d',
    end_date: todayStamp(),
  });
  if (!result.ok || !result.rows?.length) return cached?.normalizedPayload ?? null;
  const bars = parseDailyBars(result.rows);
  if (bars.length) {
    void saveMarketCache({
      source: 'jqdata',
      scope: 'daily_bars',
      cacheKey,
      code,
      normalizedPayload: bars,
      tradeDate: bars[bars.length - 1]?.date,
      asOf: bars[bars.length - 1]?.date,
      fetchedAt: new Date().toISOString(),
      expiresAt: marketCacheExpiresAt('daily_bars'),
    }).catch(() => undefined);
  }
  return bars.length ? bars : null;
}

export async function fetchJqHistoricalBars(
  code: string,
  startDate: string,
  endDate: string,
  unit: '1d' | '1m' = '1d',
  options: { forceRefresh?: boolean; fq?: 'pre' | 'post' | 'none' } = {},
): Promise<JqHistoricalBar[] | null> {
  const fq = options.fq ?? 'pre';
  const cacheKey = stableCacheKey([code, unit, startDate, endDate, fq]);
  const scope = unit === '1m' ? 'minute_bars_history' : 'daily_bars_history';
  const cached = await loadMarketCache<JqHistoricalBar[]>('jqdata', scope, cacheKey);
  if (!options.forceRefresh && cached?.normalizedPayload?.length) return cached.normalizedPayload;
  const result = await jqDataQuery('get_price', {
    code,
    start_date: unit === '1m' ? `${startDate} 09:30:00` : startDate,
    end_date: unit === '1m' ? `${endDate} 15:00:00` : endDate,
    unit,
    fq,
    skip_paused: false,
    fill_paused: true,
    fields: ['open', 'close', 'high', 'low', 'volume', 'money', 'paused', 'high_limit', 'low_limit'],
  });
  if (!result.ok || !result.rows?.length) return cached?.normalizedPayload ?? null;
  const bars = parseHistoricalBars(result.rows);
  if (bars.length) {
    void saveMarketCache({
      source: 'jqdata',
      scope,
      cacheKey,
      code,
      normalizedPayload: bars,
      tradeDate: bars[bars.length - 1].date,
      asOf: bars[bars.length - 1].time,
      fetchedAt: new Date().toISOString(),
      expiresAt: marketCacheExpiresAt('daily_bars'),
    }).catch(() => undefined);
  }
  return bars.length ? bars : null;
}

export interface JqLivePrice {
  code: string;
  date?: string;
  price: number;
  prevClose: number | null;
  high?: number;
  low?: number;
  volumeShares?: number;
  turnoverAmount?: number;
  avg?: number;
  highLimit?: number;
  lowLimit?: number;
  paused?: boolean;
}

export interface JqLatestPriceBatch {
  prices: Map<string, JqLivePrice>;
  errors: string[];
  requested: number;
  asOfDate?: string;
  cached?: boolean;
  cacheFetchedAt?: string;
}

// Latest close plus previous close for a batch of securities. The desktop side
// maps this to JQData's HTTP API and returns tidy rows.
export async function fetchJqLatestPriceBatch(
  codes: string[],
  options: { forceRefresh?: boolean } = {},
): Promise<JqLatestPriceBatch> {
  const unique = Array.from(new Set(codes.filter(Boolean))).slice(0, 140);
  if (!unique.length) return { prices: new Map(), errors: ['没有需要刷新的标的。'], requested: 0 };
  const cacheKey = stableCodesCacheKey(unique);
  const cached = await loadMarketCache<CachedJqLivePrice[]>('jqdata', 'latest_prices', cacheKey);
  if (!options.forceRefresh && isMarketCacheUsable(cached)) {
    return {
      prices: jqLiveMapFromRows(cached?.normalizedPayload),
      errors: [],
      requested: unique.length,
      asOfDate: marketCacheLabel(cached) ?? cached?.asOf,
      cached: true,
      cacheFetchedAt: cached?.fetchedAt,
    };
  }
  const map = new Map<string, JqLivePrice>();
  const errors: string[] = [];
  let asOfDate = '';

  const result = await jqDataQuery('get_price', {
    codes: unique,
    count: 2,
    unit: '1d',
    end_date: todayStamp(),
  });
  if (!result.ok) {
    if (cached?.normalizedPayload) {
      return {
        prices: jqLiveMapFromRows(cached.normalizedPayload),
        errors: unique.map((code) => `${code}：${result.message || '聚宽 HTTP API 未返回可用报价。'}`),
        requested: unique.length,
        asOfDate: marketCacheLabel(cached),
        cached: true,
        cacheFetchedAt: cached.fetchedAt,
      };
    }
    return {
      prices: map,
      errors: unique.map((code) => `${code}：${result.message || '聚宽 HTTP API 未返回可用报价。'}`),
      requested: unique.length,
    };
  }

  for (const code of unique) {
    const rows = (result.rows ?? []).filter((row) => rowString(row, 'code') === code);
    const bars = parseDailyBars(rows);
    if (!bars.length) {
      errors.push(`${code}：未返回行情行。`);
      continue;
    }
    const last = bars[bars.length - 1];
    const prev = bars.length > 1 ? bars[bars.length - 2] : null;
    if (!asOfDate || last.date > asOfDate) asOfDate = last.date;
    map.set(code, {
      code,
      date: last.date,
      price: last.close,
      prevClose: last.preClose ?? prev?.close ?? null,
      high: last.high,
      low: last.low,
      volumeShares: last.volume,
      turnoverAmount: last.money,
      avg: last.avg,
      highLimit: last.highLimit,
      lowLimit: last.lowLimit,
      paused: last.paused,
    });
  }
  if (map.size) {
    void saveMarketCache({
      source: 'jqdata',
      scope: 'latest_prices',
      cacheKey,
      universe: unique,
      normalizedPayload: jqLiveRowsFromMap(map),
      tradeDate: asOfDate || undefined,
      asOf: asOfDate || undefined,
      fetchedAt: new Date().toISOString(),
      expiresAt: marketCacheExpiresAt('latest_prices'),
    }).catch(() => undefined);
  }
  return { prices: map, errors, requested: unique.length, asOfDate: asOfDate || undefined };
}

export async function fetchJqLatestPrices(codes: string[]): Promise<Map<string, JqLivePrice> | null> {
  const result = await fetchJqLatestPriceBatch(codes);
  const map = result.prices;
  return map.size ? map : null;
}

export interface JqSecurityInfo {
  code: string;
  displayName: string;
  name?: string;
  type?: string;
  startDate?: string;
  endDate?: string;
}

// Look up one security's metadata (used when adding stocks outside the local
// built-in catalog by code).
export async function fetchJqSecurityInfo(code: string): Promise<JqSecurityInfo | null> {
  const result = await jqDataQuery('get_security_info', { code });
  const row = result.rows?.[0];
  if (!result.ok || !row) return null;
  const displayName = rowString(row, 'display_name', 'display name', 'displayName', 'name');
  if (!displayName) return null;
  return {
    code: rowString(row, 'code') || code,
    displayName,
    name: rowString(row, 'name') || undefined,
    type: rowString(row, 'type') || undefined,
    startDate: rowString(row, 'start_date', 'start date', 'startDate') || undefined,
    endDate: rowString(row, 'end_date', 'end date', 'endDate') || undefined,
  };
}

function todayStamp(): string {
  const now = new Date();
  return dateStamp(now);
}

function dateStamp(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function offsetDateStamp(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return dateStamp(date);
}

function sortRowsByDate(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return [...rows].sort((a, b) => rowString(a, 'date').localeCompare(rowString(b, 'date')));
}

function latestRow(rows: Record<string, unknown>[] | undefined): Record<string, unknown> | null {
  if (!rows?.length) return null;
  const sorted = sortRowsByDate(rows);
  return sorted[sorted.length - 1] ?? null;
}

function queryWarning(label: string, result: JqDataQueryResult): string | null {
  if (!result.ok) return `${label}：${result.message || '聚宽未返回可用数据'}`;
  if (!result.rows?.length) return `${label}：近段时间暂无记录`;
  return null;
}

export interface JqMoneyFlowSummary {
  rows: number;
  latestDate: string;
  latestMainNetAmount: number | null;
  latestMainNetPct: number | null;
  fiveDayMainNetAmount: number | null;
}

export type JqCapitalFlowBucketKey = 'xl' | 'l' | 'm' | 's';

export interface JqCapitalFlowBucket {
  key: JqCapitalFlowBucketKey;
  label: '超大单' | '大单' | '中单' | '小单';
  /** Amounts are normalized to yuan. Basic get_money_flow amounts arrive in ten-thousand yuan. */
  inflow: number | null;
  outflow: number | null;
  net: number | null;
  netPct: number | null;
}

export interface JqCapitalFlowPoint {
  time: string;
  mainNet: number | null;
  mainNetPct: number | null;
  changePct: number | null;
  buckets: JqCapitalFlowBucket[];
}

export interface JqCapitalFlowSnapshot {
  code: string;
  daily: JqCapitalFlowPoint[];
  intraday: JqCapitalFlowPoint[];
  source: 'pro' | 'basic' | 'none';
  sourceLabel: string;
  warnings: string[];
}

const CAPITAL_FLOW_BUCKETS: ReadonlyArray<Pick<JqCapitalFlowBucket, 'key' | 'label'>> = [
  { key: 'xl', label: '超大单' },
  { key: 'l', label: '大单' },
  { key: 'm', label: '中单' },
  { key: 's', label: '小单' },
];

function nullableRowNumber(row: Record<string, unknown>, ...keys: string[]): number | null {
  return finiteOrNull(rowNumber(row, ...keys));
}

/**
 * Normalize the two JQData money-flow schemas into one yuan-denominated model.
 * get_money_flow reports net_amount_* in ten-thousand yuan, while
 * get_money_flow_pro reports inflow/outflow/netflow_* in yuan.
 */
export function parseJqCapitalFlowRows(
  rows: Record<string, unknown>[],
  schema: 'basic' | 'pro',
): JqCapitalFlowPoint[] {
  const multiplier = schema === 'basic' ? 10_000 : 1;
  return rows.map((row) => {
    const buckets = CAPITAL_FLOW_BUCKETS.map(({ key, label }) => {
      const inflowRaw = nullableRowNumber(row, `inflow_${key}`, `inflow ${key}`);
      const outflowRaw = nullableRowNumber(row, `outflow_${key}`, `outflow ${key}`);
      const netRaw = schema === 'basic'
        ? nullableRowNumber(row, `net_amount_${key}`, `net amount ${key}`)
        : nullableRowNumber(row, `netflow_${key}`, `netflow ${key}`, `net_amount_${key}`);
      const derivedNet = netRaw ?? (
        inflowRaw !== null && outflowRaw !== null ? inflowRaw - outflowRaw : null
      );
      return {
        key,
        label,
        inflow: inflowRaw === null ? null : inflowRaw * multiplier,
        outflow: outflowRaw === null ? null : outflowRaw * multiplier,
        net: derivedNet === null ? null : derivedNet * multiplier,
        netPct: nullableRowNumber(row, `net_pct_${key}`, `net pct ${key}`),
      } satisfies JqCapitalFlowBucket;
    });
    const explicitMain = nullableRowNumber(row, 'net_amount_main', 'net amount main', 'netAmountMain');
    const derivedMain = [buckets[0]?.net, buckets[1]?.net]
      .filter((value): value is number => value !== null && value !== undefined)
      .reduce((sum, value) => sum + value, 0);
    const hasDerivedMain = buckets.slice(0, 2).some((bucket) => bucket.net !== null);
    return {
      time: rowString(row, 'time', 'date', 'day'),
      mainNet: explicitMain === null
        ? (hasDerivedMain ? derivedMain : null)
        : explicitMain * multiplier,
      mainNetPct: nullableRowNumber(row, 'net_pct_main', 'net pct main', 'netPctMain'),
      changePct: nullableRowNumber(row, 'change_pct', 'change pct', 'changePct'),
      buckets,
    } satisfies JqCapitalFlowPoint;
  }).filter((point) => point.time && (
    point.mainNet !== null || point.buckets.some((bucket) => bucket.net !== null || bucket.inflow !== null || bucket.outflow !== null)
  )).sort((a, b) => a.time.localeCompare(b.time));
}

const CAPITAL_FLOW_PRO_FIELDS = [
  'inflow_xl', 'inflow_l', 'inflow_m', 'inflow_s',
  'outflow_xl', 'outflow_l', 'outflow_m', 'outflow_s',
  'netflow_xl', 'netflow_l', 'netflow_m', 'netflow_s',
] as const;

export async function fetchJqCapitalFlow(code: string): Promise<JqCapitalFlowSnapshot | null> {
  if (!isTauriRuntime()) return null;
  const end = todayStamp();
  const [basicResult, proDailyResult, proMinuteResult] = await Promise.all([
    jqDataQuery('get_money_flow', { code, date: offsetDateStamp(-120), end_date: end }),
    jqDataQuery('get_money_flow_pro', {
      code,
      end_date: end,
      count: 40,
      frequency: 'daily',
      fields: CAPITAL_FLOW_PRO_FIELDS,
      data_type: 'money',
    }),
    jqDataQuery('get_money_flow_pro', {
      code,
      end_date: `${end} 15:00:00`,
      count: 240,
      frequency: '1m',
      fields: CAPITAL_FLOW_PRO_FIELDS,
      data_type: 'money',
    }),
  ]);

  const basicDaily = basicResult.ok ? parseJqCapitalFlowRows(basicResult.rows ?? [], 'basic') : [];
  const proDaily = proDailyResult.ok ? parseJqCapitalFlowRows(proDailyResult.rows ?? [], 'pro') : [];
  const intraday = proMinuteResult.ok ? parseJqCapitalFlowRows(proMinuteResult.rows ?? [], 'pro') : [];
  const daily = proDaily.length ? proDaily : basicDaily;
  const source = proDaily.length || intraday.length ? 'pro' : basicDaily.length ? 'basic' : 'none';
  const warnings: string[] = [];
  if (!daily.length) warnings.push(basicResult.message || proDailyResult.message || '近段时间暂无日级资金流记录。');
  if (!intraday.length) warnings.push('分钟资金流需要 JQData 资金流因子 Pro 权限；当前仅展示可用的盘后日级数据。');

  return {
    code,
    daily,
    intraday,
    source,
    sourceLabel: source === 'pro'
      ? 'JQData 资金流因子 Pro'
      : source === 'basic'
        ? 'JQData 交易统计 · 盘后约 20:00'
        : 'JQData 暂无可用资金流',
    warnings: Array.from(new Set(warnings.filter(Boolean))),
  };
}

export interface JqMtssSummary {
  rows: number;
  latestDate: string;
  finValue: number | null;
  finBuyValue: number | null;
  finRefundValue: number | null;
  secValue: number | null;
}

export interface JqLockedSharesSummary {
  rows: number;
  nextDate: string;
  shareRate: number | null;
  lockedShares: number | null;
}

export interface JqSecurityProfile {
  code: string;
  info?: JqSecurityInfo;
  industryNames: string[];
  moneyFlow?: JqMoneyFlowSummary;
  mtss?: JqMtssSummary;
  lockedShares?: JqLockedSharesSummary;
  warnings: string[];
}

export async function fetchJqSecurityProfile(code: string): Promise<JqSecurityProfile | null> {
  if (!isTauriRuntime()) return null;
  const end = todayStamp();
  const [infoResult, moneyResult, mtssResult, industryResult, lockedResult] = await Promise.all([
    jqDataQuery('get_security_info', { code }),
    jqDataQuery('get_money_flow', { code, date: offsetDateStamp(-18), end_date: end }),
    jqDataQuery('get_mtss', { code, date: offsetDateStamp(-45), end_date: end }),
    jqDataQuery('get_industry', { code, date: end }),
    jqDataQuery('get_locked_shares', { code, date: end, end_date: offsetDateStamp(240) }),
  ]);

  const warnings = [
    queryWarning('资金流', moneyResult),
    queryWarning('融资融券', mtssResult),
    queryWarning('行业归属', industryResult),
    queryWarning('限售解禁', lockedResult),
  ].filter((item): item is string => Boolean(item));

  const info = (() => {
    const row = infoResult.rows?.[0];
    if (!infoResult.ok || !row) return undefined;
    const displayName = rowString(row, 'display_name', 'display name', 'displayName', 'name');
    if (!displayName) return undefined;
    return {
      code: rowString(row, 'code') || code,
      displayName,
      name: rowString(row, 'name') || undefined,
      type: rowString(row, 'type') || undefined,
      startDate: rowString(row, 'start_date', 'start date', 'startDate') || undefined,
      endDate: rowString(row, 'end_date', 'end date', 'endDate') || undefined,
    } satisfies JqSecurityInfo;
  })();

  const moneyRows = sortRowsByDate(moneyResult.rows ?? []);
  const moneyLatest = latestRow(moneyRows);
  const moneyFlow = moneyLatest
    ? {
        rows: moneyRows.length,
        latestDate: rowString(moneyLatest, 'date'),
        latestMainNetAmount: finiteOrNull(
          rowNumber(moneyLatest, 'net_amount_main', 'net amount main', 'netAmountMain'),
        ),
        latestMainNetPct: finiteOrNull(
          rowNumber(moneyLatest, 'net_pct_main', 'net pct main', 'netPctMain'),
        ),
        fiveDayMainNetAmount: finiteOrNull(
          moneyRows.slice(-5).reduce((sum, row) => {
            const value = rowNumber(row, 'net_amount_main', 'net amount main', 'netAmountMain');
            return sum + (Number.isFinite(value) ? value : 0);
          }, 0),
        ),
      }
    : undefined;

  const mtssLatest = latestRow(mtssResult.rows);
  const mtss = mtssLatest
    ? {
        rows: mtssResult.rows?.length ?? 0,
        latestDate: rowString(mtssLatest, 'date'),
        finValue: finiteOrNull(rowNumber(mtssLatest, 'fin_value', 'fin value', 'finValue')),
        finBuyValue: finiteOrNull(rowNumber(mtssLatest, 'fin_buy_value', 'fin buy value', 'finBuyValue')),
        finRefundValue: finiteOrNull(rowNumber(mtssLatest, 'fin_refund_value', 'fin refund value', 'finRefundValue')),
        secValue: finiteOrNull(rowNumber(mtssLatest, 'sec_value', 'sec value', 'secValue')),
      }
    : undefined;

  const lockedRows = sortRowsByDate(lockedResult.rows ?? []);
  const lockedLatest = lockedRows[0] ?? null;
  const lockedShares = lockedLatest
    ? {
        rows: lockedRows.length,
        nextDate: rowString(lockedLatest, 'date'),
        shareRate: finiteOrNull(rowNumber(lockedLatest, 'rate1', 'rate', 'share_ratio', 'share ratio')),
        lockedShares: finiteOrNull(rowNumber(lockedLatest, 'num', 'locked_shares', 'locked shares')),
      }
    : undefined;

  const industryNames = Array.from(
    new Set(
      (industryResult.rows ?? [])
        .map((row) => rowString(row, 'industry_name', 'industry name', 'name'))
        .filter(Boolean),
    ),
  );

  return { code, info, industryNames, moneyFlow, mtss, lockedShares, warnings };
}

function finiteOrNull(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}
