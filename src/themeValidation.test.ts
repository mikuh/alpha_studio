import { beforeEach, describe, expect, it } from 'vitest';
import type { PremarketThemeRun } from './themeResearch';
import {
  DEFAULT_THEME_BACKTEST_CONFIG,
  eligibleOpenReports,
  evaluateThemeTrigger,
  ingestThemeMonitorResult,
  ingestThemeReviewResult,
  loadThemeReviews,
  loadThemeTrackingEvents,
  mergeTrackingEvaluations,
  runThemeBacktest,
  selectBacktestCandidate,
  summarizeStockConditions,
  type BacktestPriceBar,
  type ThemeTrackingEvent,
} from './themeValidation';

function report(overrides: Partial<PremarketThemeRun> = {}): PremarketThemeRun {
  return {
    schema: 'alpha.premarket_theme.v2',
    sourceSchema: 'alpha.premarket_theme.v2',
    id: 'report-1',
    contentHash: 'hash-1',
    tradeDate: '2026-07-13',
    generatedAt: '2026-07-13T01:20:00.000Z',
    dataCutoff: '2026-07-13T01:20:00.000Z',
    importedAt: '2026-07-13T01:20:01.000Z',
    reportMode: 'pre_market',
    title: '盘前主题研究',
    executionGate: {
      state: '触发后轻仓试错',
      todayOnlyDo: [],
      todayDoNotDo: [],
      triggerBeforeAction: [],
      failureAction: '保持观察',
    },
    capitalAttackPath: {
      primaryRoute: 'AI', backupRoute: '', invalidationRoute: '', todayAttackProbability: '60%', rationale: '', actionCondition: '',
    },
    marketSentiment: 'trial',
    previousContinuity: [],
    themes: [{
      id: 'theme-1', rank: 1, name: 'AI 算力', grade: 'S', conclusion: '', lifecycle: 'startup', capitalType: 'mixed',
      attackPath: '中军先行', todayAttackProbability: '60%', researchProbability: '65%', observationWeight: '高',
      todayOnlyDo: [], todayDoNotDo: [], triggers: ['涨幅确认'], invalidation: '', risk: '', status: 'pending',
      triggerSpecs: [{
        id: 'trigger-1', label: '中军涨幅超过 2%', evaluator: 'quote', subjectCode: '000001.XSHE', field: 'changePct',
        operator: 'gte', threshold: 2, windowStart: '09:30', windowEnd: '14:55', confirmForSeconds: 0,
        dataSource: 'eastmoney', actionOnTrigger: '继续确认', actionOnFailure: '停止跟踪',
      }],
      stocks: [
        { name: 'A', code: '000002.XSHE', role: '中军', roleRank: 2, authenticity: 'A' },
        { name: 'B', code: '000001.XSHE', role: '中军', roleRank: 1, authenticity: 'A' },
      ],
    }],
    risks: [], sourceNotes: [], reportMarkdown: '',
    ...overrides,
  };
}

function bar(time: string, open: number, close = open, extras: Partial<BacktestPriceBar> = {}): BacktestPriceBar {
  return { time, open, close, high: Math.max(open, close), low: Math.min(open, close), volume: 100_000, ...extras };
}

describe('theme validation and backtest', () => {
  beforeEach(() => window.localStorage.clear());

  it('enforces the 09:24:59 Shanghai anti-lookahead cutoff and keeps the latest eligible report', () => {
    const early = report({ id: 'early', contentHash: 'early', generatedAt: '2026-07-13T01:24:58.000Z', dataCutoff: '2026-07-13T01:24:59.000Z' });
    const late = report({ id: 'late', contentHash: 'late', generatedAt: '2026-07-13T01:25:00.000Z', dataCutoff: '2026-07-13T01:25:00.000Z' });
    expect(eligibleOpenReports([early, late], DEFAULT_THEME_BACKTEST_CONFIG).map((item) => item.id)).toEqual(['early']);
  });

  it('selects rank one and the first central-capacity stock deterministically', () => {
    const selected = selectBacktestCandidate(report(), DEFAULT_THEME_BACKTEST_CONFIG);
    expect(selected?.theme.rank).toBe(1);
    expect(selected?.stock.code).toBe('000001.XSHE');
  });

  it('evaluates numeric quote rules locally', () => {
    const item = report();
    const theme = item.themes[0];
    const result = evaluateThemeTrigger(item, theme.triggerSpecs[0], {
      now: new Date('2026-07-13T02:00:00.000Z'),
      theme,
      quotes: new Map([['000001.XSHE', {
        code: '000001.XSHE', name: 'B', board: '深市', sector: 'AI', price: 10.3, prevClose: 10,
        changePct: 3, changeAmt: 0.3, high: 10.4, low: 10, volume: 1, turnover: 1, marketCap: 1,
        tags: [], thesis: '', source: 'eastmoney',
      }]]),
    });
    expect(result.status).toBe('triggered');
    expect(result.marketPrice).toBe(10.3);
  });

  it('summarizes per-stock buy and invalidation conditions from immutable trigger events', () => {
    const item = report();
    const theme = {
      ...item.themes[0],
      invalidation: '中军跌破关键位',
      stocks: [{
        ...item.themes[0].stocks[1],
        triggerIds: ['trigger-1'],
        entryConditions: ['涨幅确认后等待二次承接'],
        invalidationConditions: ['放量转负'],
      }],
    };
    const triggered = new Map([['trigger-1', {
      id: 'event-ready', reportId: item.id, tradeDate: item.tradeDate, themeId: theme.id, triggerId: 'trigger-1',
      status: 'triggered' as const, observedAt: '2026-07-13T02:00:00.000Z', evidence: '涨幅3%', source: 'eastmoney', actor: 'rule' as const,
    }]]);
    const ready = summarizeStockConditions(theme, theme.stocks[0], triggered);
    expect(ready).toMatchObject({ state: 'ready', confirmed: 1, total: 1 });
    expect(ready.entryConditions).toContain('涨幅确认后等待二次承接');
    expect(ready.invalidationConditions).toContain('中军跌破关键位');

    const invalidated = new Map([['trigger-1', { ...triggered.get('trigger-1')!, id: 'event-blocked', status: 'invalidated' as const }]]);
    expect(summarizeStockConditions(theme, theme.stocks[0], invalidated).state).toBe('blocked');
  });

  it('does not append a duplicate when the newest trigger state and evidence are unchanged', () => {
    const newest: ThemeTrackingEvent = {
      id: 'new', reportId: 'report-1', tradeDate: '2026-07-13', themeId: 'theme-1', triggerId: 'trigger-1',
      status: 'triggered', observedAt: '2026-07-13T02:00:00.000Z', evidence: '已达阈值', source: 'eastmoney', actor: 'rule',
    };
    const oldest = { ...newest, id: 'old', status: 'not_triggered' as const, observedAt: '2026-07-13T01:40:00.000Z', evidence: '未达阈值' };
    const result = mergeTrackingEvaluations([newest, oldest], [{ ...newest, observedAt: '2026-07-13T02:01:00.000Z' }]);
    expect(result).toHaveLength(2);
  });

  it('ingests AI monitor events only when report and trigger ids match', () => {
    const result = ingestThemeMonitorResult(`\`\`\`json
${JSON.stringify({
  schema: 'alpha.theme_monitor.v1', reportContentHash: 'hash-1', observedAt: '2026-07-13T02:10:00.000Z',
  events: [{ themeId: 'theme-1', triggerId: 'trigger-1', status: 'partial', evidence: '量能接近阈值', source: '东方财富', confidence: 0.7 }],
})}
\`\`\``, [report()]);
    expect(result).toMatchObject({ ok: true, added: 1 });
    expect(loadThemeTrackingEvents()[0]).toMatchObject({ actor: 'ai', status: 'partial', triggerId: 'trigger-1' });
  });

  it('ingests a structured AI close review against the immutable report snapshot', () => {
    const result = ingestThemeReviewResult(`\`\`\`json
${JSON.stringify({
  schema: 'alpha.theme_review.v1', reportId: 'report-1', generatedAt: '2026-07-13T07:10:00.000Z', score: 78,
  missingIntradayHistory: false, summary: '主路径部分命中',
  items: [{ id: 'route', label: '主路径', verdict: 'partial', evidence: '中军走强但宽度不足', attribution: 'thesis' }],
  lessons: ['保留宽度确认'], proposedRuleChanges: ['调整持续时间'],
})}
\`\`\``, [report()]);
    expect(result.ok).toBe(true);
    expect(loadThemeReviews()[0]).toMatchObject({ reportId: 'report-1', score: 78, summary: '主路径部分命中' });
  });

  it('produces theoretical and executable T+1 curves with fees, lots, and deterministic hash', () => {
    const item = report();
    const events: ThemeTrackingEvent[] = [{
      id: 'event-1', reportId: item.id, tradeDate: item.tradeDate, themeId: 'theme-1', triggerId: 'trigger-1',
      status: 'triggered', observedAt: '2026-07-13T01:35:00.000Z', evidence: '事前触发', source: 'eastmoney', actor: 'rule', marketPrice: 10,
    }];
    const daily = [bar('2026-07-13 00:00:00', 10), bar('2026-07-14 00:00:00', 11)];
    const rawDaily = [bar('2026-07-13 00:00:00', 20), bar('2026-07-14 00:00:00', 22)];
    const minutes = [bar('2026-07-13 09:36:00', 20, 20, { money: 2_000_000, volume: 100_000 })];
    const input = {
      reports: [item], events,
      dailyBarsByCode: new Map([['000001.XSHE', daily]]),
      rawDailyBarsByCode: new Map([['000001.XSHE', rawDaily]]),
      minuteBarsByCode: new Map([['000001.XSHE', minutes]]),
      benchmarkBars: [bar('2026-07-13', 4_000), bar('2026-07-14', 4_040)],
      dataSource: 'jqdata', dataVersion: 'fixture-v1',
    };
    const first = runThemeBacktest(input);
    const second = runThemeBacktest(input);
    expect(first.runHash).toBe(second.runHash);
    expect(first.signalTrades).toHaveLength(1);
    expect(first.signalTrades[0].grossReturnPct).toBeCloseTo(10);
    expect(first.executableTrades).toHaveLength(1);
    expect(first.executableTrades[0].entryAt).toContain('09:36');
    expect(first.executableTrades[0].entryPrice).toBeGreaterThan(20);
    expect(first.executableTrades[0].adjustmentFactor).toBeCloseTo(0.5);
    expect(first.executableTrades[0].quantity % 100).toBe(0);
    expect(first.executableTrades[0].fees).toBeGreaterThan(0);
    expect(first.executableCurve[first.executableCurve.length - 1]?.value).toBeGreaterThan(1_000_000);
  });

  it('keeps locked-limit-up observations in the signal curve but excludes them from executable NAV', () => {
    const item = report();
    const daily = [
      bar('2026-07-13', 11, 11, { high: 11, low: 11, highLimit: 11 }),
      bar('2026-07-14', 11.5),
    ];
    const run = runThemeBacktest({
      reports: [item], events: [], dailyBarsByCode: new Map([['000001.XSHE', daily]]),
      minuteBarsByCode: new Map(), benchmarkBars: [bar('2026-07-13', 4_000)],
      dataSource: 'jqdata', dataVersion: 'fixture-v1',
    });
    expect(run.signalTrades).toHaveLength(1);
    expect(run.executableTrades).toHaveLength(0);
    expect(run.exclusions.some((item) => item.reason.includes('事前确认'))).toBe(true);
  });
});
