import {
  getOrCreateDeviceFingerprint,
  loadClientLicenseSession,
  type ClientLicenseSession,
} from './license';
import {
  RESEARCH_CATALOG,
  RESEARCH_INDEXES,
  boardFromCode,
  type LivePriceOverride,
  type ResearchQuote,
  type ResearchQuoteSource,
} from './research';

/**
 * 客户端不直连任何行情网站。所有请求统一进入 Alpha 云端市场服务，由服务端
 * 负责主备源、归一化、缓存和广播。
 */

export interface CloudRealtimeBatch {
  prices: Map<string, LivePriceOverride>;
  errors: string[];
  requested: number;
  asOfLabel?: string;
  cached?: boolean;
  cacheFetchedAt?: string;
}

export interface CloudFullMarketBatch {
  quotes: ResearchQuote[];
  errors: string[];
  requested: number;
  asOfLabel?: string;
  cached?: boolean;
  cacheFetchedAt?: string;
}

export interface CloudMarketQuote {
  code: string;
  rawCode: string;
  name: string;
  market: string;
  board: string;
  sector: string;
  securityType?: 'stock' | 'etf' | 'index';
  source: 'eastmoney' | 'tencent';
  price: number;
  prevClose: number;
  changePct: number;
  changeAmt: number;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  volumeShares?: number | null;
  turnoverAmount?: number | null;
  marketCapAmount?: number | null;
  floatMarketCapAmount?: number | null;
  turnoverRate?: number | null;
  volumeRatio?: number | null;
  pb?: number | null;
  status?: number | null;
}

export interface CloudMarketSnapshot {
  schemaVersion: number;
  sequence: number;
  market: string;
  source: 'eastmoney' | 'tencent';
  asOf: string;
  generatedAt: string;
  stale: boolean;
  quotes: CloudMarketQuote[];
  warnings: string[];
}

export interface CloudMarketUpdate extends CloudFullMarketBatch {
  prices: Map<string, LivePriceOverride>;
  sequence: number;
  source: CloudMarketSnapshot['source'];
}

export type CloudCapitalFlowBucketKey = 'xl' | 'l' | 'm' | 's';

export interface CloudCapitalFlowBucket {
  key: CloudCapitalFlowBucketKey;
  label: '超大单' | '大单' | '中单' | '小单';
  inflow: number | null;
  outflow: number | null;
  net: number | null;
  netPct: number | null;
}

export interface CloudCapitalFlowPoint {
  time: string;
  mainNet: number | null;
  mainNetPct: number | null;
  changePct: number | null;
  buckets: CloudCapitalFlowBucket[];
}

export interface CloudCapitalFlowSnapshot {
  schemaVersion: number;
  code: string;
  daily: CloudCapitalFlowPoint[];
  intraday: CloudCapitalFlowPoint[];
  intradayMode: 'cumulative' | 'incremental';
  source: 'tencent' | 'eastmoney';
  sourceLabel: string;
  asOf: string;
  generatedAt: string;
  stale: boolean;
  warnings: string[];
}

const INDEX_CODES = new Set(RESEARCH_INDEXES.map((item) => item.code));
const CATALOG_BY_CODE = new Map(RESEARCH_CATALOG.map((item) => [item.code, item]));

function asFinite(value: number | null | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asSource(value: string): Exclude<ResearchQuoteSource, 'sample'> {
  return value === 'tencent' ? 'tencent' : 'eastmoney';
}

function cloudHeaders(session: ClientLicenseSession): HeadersInit {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${session.device.accessToken}`,
    'x-alpha-tenant-id': session.tenant.id,
    'x-alpha-device-id': session.device.id,
    'x-alpha-device-fingerprint': getOrCreateDeviceFingerprint(),
  };
}

function cloudSession(): ClientLicenseSession {
  const session = loadClientLicenseSession();
  if (!session) throw new Error('尚未激活云端授权，无法读取云端行情。');
  return session;
}

function marketUrl(session: ClientLicenseSession, path: string): URL {
  return new URL(path, `${session.apiBaseUrl.replace(/\/$/, '')}/`);
}

async function parseCloudError(response: Response): Promise<string> {
  try {
    const payload = await response.json() as { error?: string; message?: string };
    return payload.message || payload.error || `云端行情请求失败（HTTP ${response.status}）`;
  } catch {
    return `云端行情请求失败（HTTP ${response.status}）`;
  }
}

async function fetchCloudSnapshot(codes?: string[], limit?: number, forceRefresh = false): Promise<CloudMarketSnapshot> {
  const session = cloudSession();
  const url = marketUrl(session, '/api/market/snapshot');
  if (codes?.length) url.searchParams.set('codes', codes.join(','));
  if (limit) url.searchParams.set('limit', String(limit));
  if (forceRefresh) url.searchParams.set('forceRefresh', 'true');
  const response = await fetch(url, { headers: cloudHeaders(session) });
  if (!response.ok) throw new Error(await parseCloudError(response));
  const snapshot = await response.json() as CloudMarketSnapshot;
  if (!snapshot || !Array.isArray(snapshot.quotes)) throw new Error('云端行情响应格式无效。');
  return snapshot;
}

export async function fetchCloudCapitalFlow(code: string): Promise<CloudCapitalFlowSnapshot> {
  const normalized = normalizeCloudMarketCode(code);
  if (!normalized) throw new Error('资金流证券代码格式无效。');
  const session = cloudSession();
  const url = marketUrl(session, `/api/market/capital-flow/${encodeURIComponent(normalized)}`);
  const response = await fetch(url, { headers: cloudHeaders(session) });
  if (!response.ok) throw new Error(await parseCloudError(response));
  const snapshot = await response.json() as CloudCapitalFlowSnapshot;
  if (!snapshot || !Array.isArray(snapshot.daily) || !Array.isArray(snapshot.intraday)) {
    throw new Error('云端资金流响应格式无效。');
  }
  return snapshot;
}

function timeLabel(value: string): string | undefined {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value || undefined;
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour12: false });
}

function quoteOverride(quote: CloudMarketQuote): LivePriceOverride {
  return {
    source: asSource(quote.source),
    date: undefined,
    price: quote.price,
    prevClose: quote.prevClose > 0 ? quote.prevClose : null,
    open: asFinite(quote.open),
    high: asFinite(quote.high),
    low: asFinite(quote.low),
    volumeShares: asFinite(quote.volumeShares),
    turnoverAmount: asFinite(quote.turnoverAmount),
    marketCapAmount: asFinite(quote.marketCapAmount),
    turnoverRate: asFinite(quote.turnoverRate),
    volumeRatio: asFinite(quote.volumeRatio),
    paused: typeof quote.status === 'number' ? quote.status !== 2 : undefined,
  };
}

function snapshotPrices(snapshot: CloudMarketSnapshot): Map<string, LivePriceOverride> {
  return new Map(snapshot.quotes
    .filter((quote) => quote.code && Number.isFinite(quote.price) && quote.price > 0)
    .map((quote) => [quote.code, quoteOverride(quote)]));
}

function researchQuote(quote: CloudMarketQuote): ResearchQuote | null {
  if (!quote.code || !Number.isFinite(quote.price) || quote.price <= 0) return null;
  const catalog = CATALOG_BY_CODE.get(quote.code);
  const prevClose = quote.prevClose > 0 ? quote.prevClose : quote.price;
  const changeAmt = Number.isFinite(quote.changeAmt) ? quote.changeAmt : quote.price - prevClose;
  const changePct = Number.isFinite(quote.changePct)
    ? quote.changePct
    : prevClose > 0 ? (changeAmt / prevClose) * 100 : 0;
  const volumeShares = asFinite(quote.volumeShares);
  const turnoverAmount = asFinite(quote.turnoverAmount);
  const marketCapAmount = asFinite(quote.marketCapAmount);
  return {
    code: quote.code,
    name: quote.name || catalog?.name || quote.rawCode,
    board: quote.board || catalog?.board || boardFromCode(quote.code),
    sector: quote.sector && quote.sector !== '未分类' ? quote.sector : catalog?.sector || '未分类',
    securityType: quote.securityType,
    price: quote.price,
    prevClose,
    changePct,
    changeAmt,
    open: asFinite(quote.open),
    high: asFinite(quote.high) ?? Math.max(quote.price, prevClose),
    low: asFinite(quote.low) ?? Math.min(quote.price, prevClose),
    volume: volumeShares ? volumeShares / 1_000_000 : 0,
    turnover: turnoverAmount ? turnoverAmount / 100_000_000 : 0,
    marketCap: marketCapAmount ? marketCapAmount / 100_000_000 : 0,
    volumeShares,
    turnoverAmount,
    turnoverRate: asFinite(quote.turnoverRate),
    volumeRatio: asFinite(quote.volumeRatio),
    paused: typeof quote.status === 'number' ? quote.status !== 2 : undefined,
    tags: catalog?.tags ?? [],
    thesis: catalog?.thesis ?? '',
    source: asSource(quote.source),
  };
}

function snapshotQuotes(snapshot: CloudMarketSnapshot): ResearchQuote[] {
  return snapshot.quotes
    .filter((quote) => !INDEX_CODES.has(quote.code))
    .map(researchQuote)
    .filter((quote): quote is ResearchQuote => quote !== null);
}

function updateFromSnapshot(snapshot: CloudMarketSnapshot, requested: number): CloudMarketUpdate {
  return {
    quotes: snapshotQuotes(snapshot),
    prices: snapshotPrices(snapshot),
    errors: snapshot.warnings ?? [],
    requested,
    asOfLabel: timeLabel(snapshot.asOf),
    cached: snapshot.stale,
    cacheFetchedAt: snapshot.generatedAt,
    sequence: snapshot.sequence,
    source: snapshot.source,
  };
}

export function normalizeCloudMarketCode(code: string): string | null {
  const raw = code.trim().toUpperCase();
  const suffixed = raw.match(/^(\d{6})\.(XSHG|XSHE)$/);
  if (suffixed) return `${suffixed[1]}.${suffixed[2]}`;
  const prefixed = raw.match(/^(SH|SZ)(\d{6})$/);
  if (prefixed) return `${prefixed[2]}.${prefixed[1] === 'SH' ? 'XSHG' : 'XSHE'}`;
  if (!/^\d{6}$/.test(raw)) return null;
  return `${raw}.${raw.startsWith('6') || raw.startsWith('5') || raw.startsWith('9') ? 'XSHG' : 'XSHE'}`;
}

export async function fetchCloudRealtimeBatch(
  codes: string[],
  options: { forceRefresh?: boolean } = {},
): Promise<CloudRealtimeBatch> {
  const unique = Array.from(new Set(codes.map(normalizeCloudMarketCode).filter((code): code is string => Boolean(code)))).slice(0, 220);
  if (!unique.length) return { prices: new Map(), errors: ['没有可用的证券代码。'], requested: 0 };
  try {
    const snapshot = await fetchCloudSnapshot(unique, unique.length, options.forceRefresh);
    return {
      prices: snapshotPrices(snapshot),
      errors: snapshot.warnings ?? [],
      requested: unique.length,
      asOfLabel: timeLabel(snapshot.asOf),
      cached: snapshot.stale,
      cacheFetchedAt: snapshot.generatedAt,
    };
  } catch (error) {
    return { prices: new Map(), errors: [error instanceof Error ? error.message : String(error)], requested: unique.length };
  }
}

export async function fetchCloudFullMarket(
  pageSize = 8000,
  options: { forceRefresh?: boolean } = {},
): Promise<CloudFullMarketBatch> {
  try {
    const snapshot = await fetchCloudSnapshot(undefined, pageSize, options.forceRefresh);
    const update = updateFromSnapshot(snapshot, pageSize);
    return update;
  } catch (error) {
    return { quotes: [], errors: [error instanceof Error ? error.message : String(error)], requested: pageSize };
  }
}

/** 订阅云端统一行情广播。返回取消订阅函数；不支持 EventSource 时自动降级为轮询。 */
export function subscribeCloudMarket(
  onUpdate: (update: CloudMarketUpdate) => void,
  onError?: (message: string) => void,
): () => void {
  if (typeof window === 'undefined') return () => undefined;
  let session: ClientLicenseSession;
  try {
    session = cloudSession();
  } catch (error) {
    onError?.(error instanceof Error ? error.message : String(error));
    return () => undefined;
  }
  const url = marketUrl(session, '/api/market/stream');
  url.searchParams.set('tenantId', session.tenant.id);
  url.searchParams.set('deviceId', session.device.id);
  const controller = new AbortController();
  let stopped = false;
  void consumeAuthenticatedMarketStream(url, session, controller.signal, (snapshot) => {
    onUpdate(updateFromSnapshot(snapshot, snapshot.quotes.length));
  }, (message) => {
    if (!stopped) onError?.(message);
  });
  return () => {
    stopped = true;
    controller.abort();
  };
}

async function consumeAuthenticatedMarketStream(
  url: URL,
  session: ClientLicenseSession,
  signal: AbortSignal,
  onSnapshot: (snapshot: CloudMarketSnapshot) => void,
  onError: (message: string) => void,
): Promise<void> {
  while (!signal.aborted) {
    try {
      const response = await fetch(url, {
        headers: cloudHeaders(session),
        signal,
      });
      if (!response.ok) throw new Error(await parseCloudError(response));
      const reader = response.body?.getReader();
      if (!reader) throw new Error('当前环境不支持云端行情流。');
      const decoder = new TextDecoder();
      let buffer = '';
      while (!signal.aborted) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf('\n\n');
        while (boundary >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const event = frame.split(/\r?\n/).find((line) => line.startsWith('event:'))?.slice(6).trim();
          const data = frame.split(/\r?\n/)
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart())
            .join('\n');
          if (event === 'snapshot' && data) {
            const snapshot = JSON.parse(data) as CloudMarketSnapshot;
            if (Array.isArray(snapshot.quotes)) onSnapshot(snapshot);
          }
          boundary = buffer.indexOf('\n\n');
        }
      }
    } catch (error) {
      if (signal.aborted) return;
      onError(error instanceof Error ? error.message : '云端行情广播暂时中断，正在自动重连。');
    }
    await new Promise<void>((resolve) => {
      const timer = window.setTimeout(resolve, 3_000);
      signal.addEventListener('abort', () => {
        window.clearTimeout(timer);
        resolve();
      }, { once: true });
    });
  }
}
