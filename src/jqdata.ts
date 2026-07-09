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

export function emptyJqDataConfig(): JqDataConfig {
  return {
    version: 1,
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
      message: '浏览器预览模式不会调用本地 JQData SDK/RPC。请在桌面应用中测试 JQData。',
    };
  }
  return invoke<JqDataProbeResult>('jqdata_test_connection');
}

export function jqDataUpdatedAtLabel(value: string): string {
  const millis = Number(value);
  if (!Number.isFinite(millis) || millis <= 0) return '尚未保存';
  return new Date(millis).toLocaleString('zh-CN', { hour12: false });
}

// ---- Generic JQData SDK/RPC query bridge ----------------------------------

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
// maps this to jqdatasdk SDK/RPC and returns tidy rows.
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
        errors: unique.map((code) => `${code}：${result.message || '聚宽 SDK/RPC 未返回可用报价。'}`),
        requested: unique.length,
        asOfDate: marketCacheLabel(cached),
        cached: true,
        cacheFetchedAt: cached.fetchedAt,
      };
    }
    return {
      prices: map,
      errors: unique.map((code) => `${code}：${result.message || '聚宽 SDK/RPC 未返回可用报价。'}`),
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
