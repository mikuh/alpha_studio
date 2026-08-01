import { describe, expect, it } from 'vitest';
import { normalizeCloudMarketCode } from './cloudMarket';

describe('normalizeCloudMarketCode', () => {
  it('normalizes A-share and index codes for the cloud contract', () => {
    expect(normalizeCloudMarketCode('600519.XSHG')).toBe('600519.XSHG');
    expect(normalizeCloudMarketCode('000001.XSHE')).toBe('000001.XSHE');
    expect(normalizeCloudMarketCode('000001.XSHG')).toBe('000001.XSHG');
    expect(normalizeCloudMarketCode('399001.XSHE')).toBe('399001.XSHE');
    expect(normalizeCloudMarketCode('sh600036')).toBe('600036.XSHG');
    expect(normalizeCloudMarketCode('SZ002594')).toBe('002594.XSHE');
    expect(normalizeCloudMarketCode('茅台')).toBeNull();
  });
});
