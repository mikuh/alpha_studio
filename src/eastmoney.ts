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
import { boardFromCode, type LivePriceOverride, type ResearchQuote } from './research';

export interface EastmoneyRealtimeResult {
  ok: boolean;
  message?: string;
  quoteRows?: Record<string, unknown>[];
  tickRows?: Record<string, unknown>[];
}

export interface EastmoneyRealtimeBatch {
  prices: Map<string, LivePriceOverride>;
  errors: string[];
  requested: number;
  asOfLabel?: string;
  cached?: boolean;
  cacheFetchedAt?: string;
}

export interface EastmoneyMarketBatch {
  quotes: ResearchQuote[];
  errors: string[];
  requested: number;
  asOfLabel?: string;
  cached?: boolean;
  cacheFetchedAt?: string;
}

export interface EastmoneyTick {
  code: string;
  time: string;
  price: number;
  volumeHands?: number;
  volumeShares?: number;
  turnoverAmount?: number;
  tradeCount?: number;
  side?: string;
  sideCode?: number;
}

function rowValue(row: Record<string, unknown>, key: string): unknown {
  return row[key];
}

function rowString(row: Record<string, unknown>, key: string): string {
  const value = rowValue(row, key);
  if (typeof value === 'string') return value.trim();
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function rowNumber(row: Record<string, unknown>, key: string): number {
  const value = rowValue(row, key);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function finiteOrUndefined(value: number): number | undefined {
  return Number.isFinite(value) ? value : undefined;
}

function currentTimeLabel(): string {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false });
}

interface CachedRealtimeRow extends LivePriceOverride {
  code: string;
}

function realtimeRowsFromMap(prices: Map<string, LivePriceOverride>): CachedRealtimeRow[] {
  return Array.from(prices.entries()).map(([code, value]) => ({ code, ...value }));
}

function realtimeMapFromRows(rows: unknown): Map<string, LivePriceOverride> {
  const map = new Map<string, LivePriceOverride>();
  if (!Array.isArray(rows)) return map;
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const { code, ...rest } = row as CachedRealtimeRow;
    if (typeof code === 'string' && Number.isFinite(Number(rest.price))) {
      map.set(code, rest);
    }
  }
  return map;
}

export function eastmoneySecidFromCode(code: string): string | null {
  const raw = code.trim().toUpperCase();
  const suffixed = raw.match(/^(\d{6})\.(XSHG|XSHE)$/);
  if (suffixed) return `${suffixed[2] === 'XSHG' ? '1' : '0'}.${suffixed[1]}`;
  const prefixed = raw.match(/^(SH|SZ)(\d{6})$/);
  if (prefixed) return `${prefixed[1] === 'SH' ? '1' : '0'}.${prefixed[2]}`;
  if (!/^\d{6}$/.test(raw)) return null;
  return `${raw.startsWith('6') || raw.startsWith('5') || raw.startsWith('9') ? '1' : '0'}.${raw}`;
}

export async function fetchEastmoneyRealtimeBatch(
  codes: string[],
  options: { forceRefresh?: boolean } = {},
): Promise<EastmoneyRealtimeBatch> {
  const unique = Array.from(new Set(codes.filter((code) => eastmoneySecidFromCode(code)))).slice(0, 220);
  if (!unique.length) return { prices: new Map(), errors: ['没有可用于东方财富实时接口的标的。'], requested: 0 };
  const cacheKey = stableCodesCacheKey(unique);
  const cached = await loadMarketCache<CachedRealtimeRow[]>('eastmoney', 'realtime_quotes', cacheKey);
  if (!options.forceRefresh && isMarketCacheUsable(cached)) {
    return {
      prices: realtimeMapFromRows(cached?.normalizedPayload),
      errors: [],
      requested: unique.length,
      asOfLabel: marketCacheLabel(cached) ?? cached?.asOf,
      cached: true,
      cacheFetchedAt: cached?.fetchedAt,
    };
  }
  if (!isTauriRuntime()) {
    return {
      prices: realtimeMapFromRows(cached?.normalizedPayload),
      errors: ['浏览器预览模式不会调用东方财富实时接口，请在桌面应用中刷新。'],
      requested: unique.length,
      cached: Boolean(cached?.normalizedPayload),
      asOfLabel: marketCacheLabel(cached),
    };
  }

  try {
    const result = await invoke<EastmoneyRealtimeResult>('eastmoney_realtime_query', {
      request: { codes: unique },
    });
    const prices = parseEastmoneyQuoteRows(result.quoteRows);
    const errors = result.message ? [result.message] : [];
    const returned = new Set(prices.keys());
    for (const code of unique) {
      if (!returned.has(code)) errors.push(`${code}：东方财富实时接口未返回。`);
    }
    const batch = {
      prices,
      errors,
      requested: unique.length,
      asOfLabel: prices.size ? currentTimeLabel() : undefined,
    };
    if (prices.size) {
      void saveMarketCache({
        source: 'eastmoney',
        scope: 'realtime_quotes',
        cacheKey,
        universe: unique,
        normalizedPayload: realtimeRowsFromMap(prices),
        asOf: batch.asOfLabel,
        fetchedAt: new Date().toISOString(),
        expiresAt: marketCacheExpiresAt('realtime_quotes'),
      }).catch(() => undefined);
    }
    return batch;
  } catch (error) {
    if (cached?.normalizedPayload) {
      return {
        prices: realtimeMapFromRows(cached.normalizedPayload),
        errors: [error instanceof Error ? error.message : String(error)],
        requested: unique.length,
        asOfLabel: marketCacheLabel(cached),
        cached: true,
        cacheFetchedAt: cached.fetchedAt,
      };
    }
    return {
      prices: new Map(),
      errors: [error instanceof Error ? error.message : String(error)],
      requested: unique.length,
    };
  }
}

export async function fetchEastmoneyTicks(code: string, count = 20): Promise<EastmoneyTick[]> {
  if (!eastmoneySecidFromCode(code)) return [];
  const cacheKey = stableCacheKey([code, count]);
  const cached = await loadMarketCache<EastmoneyTick[]>('eastmoney', 'ticks', cacheKey);
  if (isMarketCacheUsable(cached)) return cached?.normalizedPayload ?? [];
  if (!isTauriRuntime()) return cached?.normalizedPayload ?? [];
  const result = await invoke<EastmoneyRealtimeResult>('eastmoney_realtime_query', {
    request: { codes: [], tickCode: code, tickCount: count },
  });
  const ticks = parseEastmoneyTickRows(result.tickRows);
  if (ticks.length) {
    void saveMarketCache({
      source: 'eastmoney',
      scope: 'ticks',
      cacheKey,
      code,
      normalizedPayload: ticks,
      asOf: ticks[0]?.time,
      fetchedAt: new Date().toISOString(),
      expiresAt: marketCacheExpiresAt('ticks'),
    }).catch(() => undefined);
  }
  return ticks.length ? ticks : cached?.normalizedPayload ?? [];
}

export async function fetchEastmoneyFullMarket(
  pageSize = 6000,
  options: { forceRefresh?: boolean } = {},
): Promise<EastmoneyMarketBatch> {
  const cacheKey = stableCacheKey([pageSize]);
  const cached = await loadMarketCache<ResearchQuote[]>('eastmoney', 'full_market', cacheKey);
  if (!options.forceRefresh && isMarketCacheUsable(cached)) {
    return {
      quotes: cached?.normalizedPayload ?? [],
      errors: [],
      requested: pageSize,
      asOfLabel: marketCacheLabel(cached) ?? cached?.asOf,
      cached: true,
      cacheFetchedAt: cached?.fetchedAt,
    };
  }
  if (!isTauriRuntime()) {
    return {
      quotes: cached?.normalizedPayload ?? [],
      errors: ['浏览器预览模式不会调用东方财富行情接口，请在桌面应用中刷新。'],
      requested: pageSize,
      cached: Boolean(cached?.normalizedPayload),
      asOfLabel: marketCacheLabel(cached),
    };
  }

  try {
    const result = await invoke<EastmoneyRealtimeResult>('eastmoney_realtime_query', {
      request: { codes: [], fullMarket: true, pageSize },
    });
    const quotes = parseEastmoneyMarketRows(result.quoteRows);
    const batch = {
      quotes,
      errors: result.message ? [result.message] : [],
      requested: pageSize,
      asOfLabel: quotes.length ? currentTimeLabel() : undefined,
    };
    if (quotes.length) {
      void saveMarketCache({
        source: 'eastmoney',
        scope: 'full_market',
        cacheKey,
        universe: quotes.map((quote) => quote.code),
        normalizedPayload: quotes,
        asOf: batch.asOfLabel,
        fetchedAt: new Date().toISOString(),
        expiresAt: marketCacheExpiresAt('full_market'),
      }).catch(() => undefined);
    }
    return batch;
  } catch (error) {
    if (cached?.normalizedPayload?.length) {
      return {
        quotes: cached.normalizedPayload,
        errors: [error instanceof Error ? error.message : String(error)],
        requested: pageSize,
        asOfLabel: marketCacheLabel(cached),
        cached: true,
        cacheFetchedAt: cached.fetchedAt,
      };
    }
    return {
      quotes: [],
      errors: [error instanceof Error ? error.message : String(error)],
      requested: pageSize,
    };
  }
}

function parseEastmoneyQuoteRows(rows: Record<string, unknown>[] | undefined): Map<string, LivePriceOverride> {
  const map = new Map<string, LivePriceOverride>();
  for (const row of rows ?? []) {
    const code = rowString(row, 'code');
    const price = rowNumber(row, 'price');
    if (!code || !Number.isFinite(price) || price <= 0) continue;
    const prevClose = rowNumber(row, 'prevClose');
    const changeAmt = rowNumber(row, 'changeAmt');
    const fallbackPrevClose = Number.isFinite(changeAmt) ? price - changeAmt : null;
    const marketCapAmount = rowNumber(row, 'marketCapAmount');
    map.set(code, {
      source: 'eastmoney',
      price,
      prevClose: Number.isFinite(prevClose) && prevClose > 0 ? prevClose : fallbackPrevClose,
      high: finiteOrUndefined(rowNumber(row, 'high')),
      low: finiteOrUndefined(rowNumber(row, 'low')),
      volumeShares: finiteOrUndefined(rowNumber(row, 'volumeShares')),
      turnoverAmount: finiteOrUndefined(rowNumber(row, 'turnoverAmount')),
      marketCapAmount: finiteOrUndefined(marketCapAmount),
      turnoverRate: finiteOrUndefined(rowNumber(row, 'turnoverRate')),
      volumeRatio: finiteOrUndefined(rowNumber(row, 'volumeRatio')),
      paused: rowNumber(row, 'status') !== 2 && Number.isFinite(rowNumber(row, 'status')),
    });
  }
  return map;
}

function parseEastmoneyMarketRows(rows: Record<string, unknown>[] | undefined): ResearchQuote[] {
  return (rows ?? [])
    .map((row) => {
      const code = rowString(row, 'code');
      const name = rowString(row, 'name') || code;
      const sector = rowString(row, 'sector') || '未分类';
      const price = rowNumber(row, 'price');
      const prevClose = rowNumber(row, 'prevClose');
      const changeAmt = rowNumber(row, 'changeAmt');
      const usablePrevClose = Number.isFinite(prevClose) && prevClose > 0
        ? prevClose
        : Number.isFinite(changeAmt)
          ? price - changeAmt
          : price;
      const volumeShares = finiteOrUndefined(rowNumber(row, 'volumeShares'));
      const turnoverAmount = finiteOrUndefined(rowNumber(row, 'turnoverAmount'));
      const marketCapAmount = finiteOrUndefined(rowNumber(row, 'marketCapAmount'));
      const turnoverRate = finiteOrUndefined(rowNumber(row, 'turnoverRate'));
      const volumeRatio = finiteOrUndefined(rowNumber(row, 'volumeRatio'));
      return {
        code,
        name,
        board: boardFromCode(code),
        sector,
        price,
        prevClose: usablePrevClose,
        changePct: usablePrevClose > 0 ? ((price - usablePrevClose) / usablePrevClose) * 100 : 0,
        changeAmt: price - usablePrevClose,
        high: finiteOrUndefined(rowNumber(row, 'high')) ?? price,
        low: finiteOrUndefined(rowNumber(row, 'low')) ?? price,
        volume: volumeShares ? volumeShares / 1_000_000 : 0,
        turnover: turnoverAmount ? turnoverAmount / 100_000_000 : 0,
        marketCap: marketCapAmount ? marketCapAmount / 100_000_000 : 0,
        volumeShares,
        turnoverAmount,
        turnoverRate,
        volumeRatio,
        paused: rowNumber(row, 'status') !== 2 && Number.isFinite(rowNumber(row, 'status')),
        tags: [],
        thesis: '',
        source: 'eastmoney' as const,
      };
    })
    .filter((quote) => quote.code && Number.isFinite(quote.price) && quote.price > 0);
}

function parseEastmoneyTickRows(rows: Record<string, unknown>[] | undefined): EastmoneyTick[] {
  return (rows ?? [])
    .map((row) => ({
      code: rowString(row, 'code'),
      time: rowString(row, 'time'),
      price: rowNumber(row, 'price'),
      volumeHands: finiteOrUndefined(rowNumber(row, 'volumeHands')),
      volumeShares: finiteOrUndefined(rowNumber(row, 'volumeShares')),
      turnoverAmount: finiteOrUndefined(rowNumber(row, 'turnoverAmount')),
      tradeCount: finiteOrUndefined(rowNumber(row, 'tradeCount')),
      side: rowString(row, 'side') || undefined,
      sideCode: finiteOrUndefined(rowNumber(row, 'sideCode')),
    }))
    .filter((tick) => tick.time && Number.isFinite(tick.price));
}
