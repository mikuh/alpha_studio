import { describe, expect, it } from 'vitest';
import { eastmoneySecidFromCode } from './eastmoney';

describe('eastmoneySecidFromCode', () => {
  it('maps A-share and index codes to Eastmoney secids', () => {
    expect(eastmoneySecidFromCode('600519.XSHG')).toBe('1.600519');
    expect(eastmoneySecidFromCode('000001.XSHE')).toBe('0.000001');
    expect(eastmoneySecidFromCode('000001.XSHG')).toBe('1.000001');
    expect(eastmoneySecidFromCode('399001.XSHE')).toBe('0.399001');
    expect(eastmoneySecidFromCode('sh600036')).toBe('1.600036');
    expect(eastmoneySecidFromCode('SZ002594')).toBe('0.002594');
    expect(eastmoneySecidFromCode('茅台')).toBeNull();
  });
});
