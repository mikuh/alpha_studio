import { describe, expect, it } from 'vitest';
import { isChinaTradingTime, isMarketCacheUsable, marketCacheExpiresAt } from './localStore';
import type { MarketCacheEntry } from './localStore';

describe('market cache policy', () => {
  it('uses short TTLs during China A-share trading time', () => {
    const now = new Date('2026-07-08T02:00:00.000Z'); // 10:00 Asia/Shanghai

    expect(isChinaTradingTime(now)).toBe(true);
    expect(Date.parse(marketCacheExpiresAt('realtime_quotes', now)) - now.getTime()).toBe(60_000);
    expect(Date.parse(marketCacheExpiresAt('full_market', now)) - now.getTime()).toBe(300_000);
  });

  it('keeps weekend cache valid until the next weekday open', () => {
    const saturday = new Date('2026-07-11T02:00:00.000Z'); // Saturday 10:00 Asia/Shanghai

    expect(isChinaTradingTime(saturday)).toBe(false);
    expect(marketCacheExpiresAt('full_market', saturday)).toBe('2026-07-13T01:15:00.000Z');
  });

  it('rejects expired or non-success cache entries', () => {
    const entry: MarketCacheEntry = {
      source: 'eastmoney',
      scope: 'full_market',
      cacheKey: '6000',
      normalizedPayload: [{ code: '600519.XSHG' }],
      fetchedAt: '2026-07-08T01:00:00.000Z',
      expiresAt: '2026-07-08T01:05:00.000Z',
      status: 'success',
      updatedAt: '2026-07-08T01:00:00.000Z',
    };

    expect(isMarketCacheUsable(entry, new Date('2026-07-08T01:04:00.000Z'))).toBe(true);
    expect(isMarketCacheUsable(entry, new Date('2026-07-08T01:06:00.000Z'))).toBe(false);
    expect(isMarketCacheUsable({ ...entry, status: 'error' }, new Date('2026-07-08T01:04:00.000Z'))).toBe(false);
  });
});
