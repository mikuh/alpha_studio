import { describe, expect, it } from 'vitest';
import type { PremarketTheme, PremarketThemeRun } from './themeResearch';
import type { ThemeTrackingEvent } from './themeValidation';
import { buildThemeLedger, normalizeThemeKey, summarizeLedger } from './themeLedger';

function theme(overrides: Partial<PremarketTheme> = {}): PremarketTheme {
  return {
    id: 'theme-1',
    rank: 1,
    name: 'AI 算力',
    grade: 'S',
    conclusion: '主线延续',
    lifecycle: 'fermentation',
    capitalType: 'mixed',
    attackPath: '中军先行',
    todayAttackProbability: '60%',
    researchProbability: '65%',
    observationWeight: '高',
    todayOnlyDo: [],
    todayDoNotDo: [],
    triggers: [],
    triggerSpecs: [{
      id: 'trigger-1',
      label: '中军涨幅超过 2%',
      evaluator: 'quote',
      subjectCode: '000001.XSHE',
      field: 'changePct',
      operator: 'gte',
      threshold: 2,
      confirmForSeconds: 0,
      dataSource: 'eastmoney',
      actionOnTrigger: '继续确认',
      actionOnFailure: '停止跟踪',
    }],
    invalidation: '',
    risk: '',
    stocks: [
      { name: '中军股', code: '000001.XSHE', role: '中军', roleRank: 1, authenticity: 'A' },
      { name: '龙头股', code: '000002.XSHE', role: '龙头', roleRank: 1, authenticity: 'B' },
    ],
    status: 'pending',
    ...overrides,
  };
}

function report(tradeDate: string, overrides: Partial<PremarketThemeRun> = {}): PremarketThemeRun {
  return {
    schema: 'alpha.premarket_theme.v2',
    sourceSchema: 'alpha.premarket_theme.v2',
    id: `report-${tradeDate}`,
    contentHash: `hash-${tradeDate}`,
    tradeDate,
    generatedAt: `${tradeDate}T01:00:00.000Z`,
    dataCutoff: `${tradeDate}T01:00:00.000Z`,
    importedAt: `${tradeDate}T01:00:01.000Z`,
    reportMode: 'pre_market',
    title: '盘前主题研究',
    executionGate: { state: '触发后轻仓试错', todayOnlyDo: [], todayDoNotDo: [], triggerBeforeAction: [], failureAction: '' },
    capitalAttackPath: { primaryRoute: 'AI', backupRoute: '', invalidationRoute: '', todayAttackProbability: '60%', rationale: '', actionCondition: '' },
    marketSentiment: 'trial',
    previousContinuity: [],
    themes: [theme()],
    risks: [],
    sourceNotes: [],
    reportMarkdown: '',
    ...overrides,
  };
}

function trackingEvent(reportId: string, status: ThemeTrackingEvent['status'], observedAt: string): ThemeTrackingEvent {
  return {
    id: `event-${reportId}-${status}-${observedAt}`,
    reportId,
    tradeDate: reportId.replace('report-', ''),
    themeId: 'theme-1',
    triggerId: 'trigger-1',
    status,
    observedAt,
    evidence: 'test',
    source: 'eastmoney',
    actor: 'rule',
  };
}

describe('normalizeThemeKey', () => {
  it('merges the same theme across whitespace and slash variants', () => {
    expect(normalizeThemeKey('AI 算力')).toBe(normalizeThemeKey('AI算力'));
    expect(normalizeThemeKey('影视／院线')).toBe(normalizeThemeKey('影视/院线'));
  });
});

describe('buildThemeLedger', () => {
  it('aggregates a theme across days with trigger outcomes and role stocks', () => {
    const reports = [report('2026-07-14'), report('2026-07-15')];
    const events = [
      trackingEvent('report-2026-07-14', 'triggered', '2026-07-14T02:00:00Z'),
      trackingEvent('report-2026-07-15', 'invalidated', '2026-07-15T05:00:00Z'),
    ];

    const entries = buildThemeLedger(reports, events);

    expect(entries).toHaveLength(1);
    const entry = entries[0];
    expect(entry.daysTracked).toBe(2);
    expect(entry.firstDate).toBe('2026-07-14');
    expect(entry.lastDate).toBe('2026-07-15');
    expect(entry.active).toBe(true);
    expect(entry.timeline.map((day) => day.verdict)).toEqual(['hit', 'miss']);
    expect(entry.triggeredCount).toBe(1);
    expect(entry.invalidatedCount).toBe(1);
    expect(entry.hitRatePct).toBe(50);
    expect(entry.stocks).toHaveLength(2);
    expect(entry.stocks.find((stock) => stock.code === '000001.XSHE')?.appearances).toBe(2);
  });

  it('keeps only the newest report per trade date and marks stale themes inactive', () => {
    const early = report('2026-07-15', { id: 'report-early', generatedAt: '2026-07-15T00:30:00.000Z' });
    const late = report('2026-07-15', {
      id: 'report-late',
      generatedAt: '2026-07-15T01:30:00.000Z',
      themes: [theme({ name: '创新药', id: 'theme-2' })],
    });
    const old = report('2026-07-10');

    const entries = buildThemeLedger([early, late, old], []);

    const names = entries.map((entry) => entry.name);
    expect(names).toContain('创新药');
    const ai = entries.find((entry) => entry.name === 'AI 算力');
    expect(ai?.active).toBe(false);
    expect(ai?.daysTracked).toBe(1);
    const drug = entries.find((entry) => entry.name === '创新药');
    expect(drug?.active).toBe(true);
    expect(entries[0].name).toBe('创新药');
  });

  it('reports no_data verdict when a day has no recorded intraday events', () => {
    const entries = buildThemeLedger([report('2026-07-15')], []);
    expect(entries[0].timeline[0].verdict).toBe('no_data');
    expect(entries[0].hitRatePct).toBeNull();
  });
});

describe('summarizeLedger', () => {
  it('summarizes coverage and hit rate across the library', () => {
    const reports = [report('2026-07-14'), report('2026-07-15')];
    const events = [
      trackingEvent('report-2026-07-14', 'triggered', '2026-07-14T02:00:00Z'),
      trackingEvent('report-2026-07-15', 'triggered', '2026-07-15T02:00:00Z'),
    ];
    const entries = buildThemeLedger(reports, events);

    const summary = summarizeLedger(entries, reports);

    expect(summary.coveredDays).toBe(2);
    expect(summary.reportCount).toBe(2);
    expect(summary.activeThemes).toBe(1);
    expect(summary.totalThemes).toBe(1);
    expect(summary.decidedTriggers).toBe(2);
    expect(summary.hitRatePct).toBe(100);
  });
});
