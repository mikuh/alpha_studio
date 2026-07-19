import { describe, expect, it } from 'vitest';
import { collectReportCodes, isWithinTrackingWindow } from './themeTrackingEngine';
import type { PremarketThemeRun } from './themeResearch';

function shanghaiDate(clock: string, weekdayDate: string): Date {
  return new Date(`${weekdayDate}T${clock}:00+08:00`);
}

describe('isWithinTrackingWindow', () => {
  // 2026-07-15 是周三，2026-07-18 是周六。
  it('is active during morning and afternoon sessions on weekdays', () => {
    expect(isWithinTrackingWindow(shanghaiDate('09:20', '2026-07-15'))).toBe(true);
    expect(isWithinTrackingWindow(shanghaiDate('10:30', '2026-07-15'))).toBe(true);
    expect(isWithinTrackingWindow(shanghaiDate('13:05', '2026-07-15'))).toBe(true);
    expect(isWithinTrackingWindow(shanghaiDate('15:04', '2026-07-15'))).toBe(true);
  });

  it('is inactive outside sessions, at lunch break and on weekends', () => {
    expect(isWithinTrackingWindow(shanghaiDate('08:00', '2026-07-15'))).toBe(false);
    expect(isWithinTrackingWindow(shanghaiDate('12:00', '2026-07-15'))).toBe(false);
    expect(isWithinTrackingWindow(shanghaiDate('15:30', '2026-07-15'))).toBe(false);
    expect(isWithinTrackingWindow(shanghaiDate('10:30', '2026-07-18'))).toBe(false);
  });
});

describe('collectReportCodes', () => {
  it('deduplicates security codes across reports and themes', () => {
    const base = {
      schema: 'alpha.premarket_theme.v2',
      sourceSchema: 'alpha.premarket_theme.v2',
      contentHash: 'hash',
      dataCutoff: '',
      generatedAt: '',
      importedAt: '',
      reportMode: 'pre_market',
      title: '',
      executionGate: { state: '', todayOnlyDo: [], todayDoNotDo: [], triggerBeforeAction: [], failureAction: '' },
      capitalAttackPath: { primaryRoute: '', backupRoute: '', invalidationRoute: '', todayAttackProbability: '', rationale: '', actionCondition: '' },
      marketSentiment: '',
      previousContinuity: [],
      risks: [],
      sourceNotes: [],
      reportMarkdown: '',
    } satisfies Omit<PremarketThemeRun, 'id' | 'tradeDate' | 'themes'>;
    const themeBase = {
      rank: 1, grade: 'S' as const, conclusion: '', lifecycle: '', capitalType: '', attackPath: '',
      todayAttackProbability: '', researchProbability: '', observationWeight: '',
      todayOnlyDo: [], todayDoNotDo: [], triggers: [], triggerSpecs: [], invalidation: '', risk: '', status: 'pending' as const,
    };
    const reports: PremarketThemeRun[] = [
      {
        ...base, id: 'r1', tradeDate: '2026-07-15',
        themes: [{ ...themeBase, id: 't1', name: 'A', stocks: [
          { name: 'x', code: '000001.XSHE', roleRank: 1 },
          { name: 'y', roleRank: 2 },
        ] }],
      },
      {
        ...base, id: 'r2', tradeDate: '2026-07-15',
        themes: [{ ...themeBase, id: 't2', name: 'B', stocks: [
          { name: 'x', code: '000001.XSHE', roleRank: 1 },
          { name: 'z', code: '600000.XSHG', roleRank: 1 },
        ] }],
      },
    ];

    expect(collectReportCodes(reports).sort()).toEqual(['000001.XSHE', '600000.XSHG']);
  });
});
