import { describe, expect, it } from 'vitest';
import { parseJqCapitalFlowRows } from './jqdata';

describe('JQData capital flow normalization', () => {
  it('converts basic net amounts from ten-thousand yuan to yuan', () => {
    const [point] = parseJqCapitalFlowRows([{
      date: '2026-07-31',
      net_amount_main: 67.72,
      net_pct_main: 1.5,
      net_amount_xl: 22.84,
      net_amount_l: 44.88,
      net_amount_m: 7.79,
      net_amount_s: -0.78,
    }], 'basic');

    expect(point).toMatchObject({
      time: '2026-07-31',
      mainNet: 677_200,
      mainNetPct: 1.5,
    });
    expect(point.buckets.map((bucket) => bucket.net)).toEqual([228_400, 448_800, 77_900, -7_800]);
    expect(point.buckets.every((bucket) => bucket.inflow === null && bucket.outflow === null)).toBe(true);
  });

  it('preserves Pro inflow/outflow amounts and derives main flow', () => {
    const [point] = parseJqCapitalFlowRows([{
      time: '2026-07-31 14:59:00',
      inflow_xl: 2_055_800,
      inflow_l: 2_286_100,
      inflow_m: 1_779_000,
      inflow_s: 4_841_300,
      outflow_xl: 1_827_400,
      outflow_l: 1_922_900,
      outflow_m: 1_701_100,
      outflow_s: 4_833_500,
      netflow_xl: 228_400,
      netflow_l: 363_200,
      netflow_m: 77_900,
      netflow_s: 7_800,
    }], 'pro');

    expect(point.time).toBe('2026-07-31 14:59:00');
    expect(point.mainNet).toBe(591_600);
    expect(point.buckets[0]).toMatchObject({
      label: '超大单',
      inflow: 2_055_800,
      outflow: 1_827_400,
      net: 228_400,
    });
  });
});
