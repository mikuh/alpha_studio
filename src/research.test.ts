import { beforeEach, describe, expect, it } from 'vitest';
import {
  RESEARCH_CATALOG,
  accountPrompt,
  applyCashFlow,
  buildQuoteMap,
  clearLiveAccountRecords,
  computeMarketOverview,
  computeSectorHeat,
  createPortfolio,
  defaultResearchState,
  deletePortfolio,
  distributionPrompt,
  loadResearchState,
  marketSnapshotPrompt,
  normalizeResearchState,
  normalizeSecurityCode,
  placeOrder,
  rankListPrompt,
  registerCustomSecurity,
  researchAccountSummary,
  sampleBars,
  saveResearchState,
  sectorExposure,
  sectorExposurePrompt,
  sectorHeatPrompt,
  toggleWatchlist,
  tradeLogPrompt,
  tradePrompt,
  updatePortfolio,
  type ResearchState,
} from './research';

function blankState(): ResearchState {
  return {
    version: 3,
    cash: 100000,
    netDeposits: 100000,
    watchlist: [],
    holdings: [],
    portfolios: [],
    trades: [],
    customSecurities: {},
  };
}

describe('normalizeSecurityCode', () => {
  it('normalizes bare, prefixed and suffixed codes to JQData format', () => {
    expect(normalizeSecurityCode('600519')).toBe('600519.XSHG');
    expect(normalizeSecurityCode('000001')).toBe('000001.XSHE');
    expect(normalizeSecurityCode('300750')).toBe('300750.XSHE');
    expect(normalizeSecurityCode('sh600036')).toBe('600036.XSHG');
    expect(normalizeSecurityCode('SZ002594')).toBe('002594.XSHE');
    expect(normalizeSecurityCode('688981.XSHG')).toBe('688981.XSHG');
    expect(normalizeSecurityCode('茅台')).toBeNull();
    expect(normalizeSecurityCode('12345')).toBeNull();
  });
});

describe('sampleBars', () => {
  it('is deterministic and anchors the last close to the base price', () => {
    const first = sampleBars('600519.XSHG', 1500, 60);
    const second = sampleBars('600519.XSHG', 1500, 60);
    expect(first).toEqual(second);
    expect(first).toHaveLength(60);
    expect(first[first.length - 1].close).toBeCloseTo(1500, 6);
    for (const bar of first) {
      expect(bar.high).toBeGreaterThanOrEqual(Math.max(bar.open, bar.close) - 1e-9);
      expect(bar.low).toBeLessThanOrEqual(Math.min(bar.open, bar.close) + 1e-9);
    }
  });
});

describe('cash flows', () => {
  it('deposits and withdraws with trade log entries', () => {
    let state = blankState();
    const deposit = applyCashFlow(state, 'deposit', 50000);
    expect(deposit.error).toBeUndefined();
    state = deposit.state;
    expect(state.cash).toBe(150000);
    expect(state.netDeposits).toBe(150000);
    expect(state.trades[0].kind).toBe('deposit');

    const withdraw = applyCashFlow(state, 'withdraw', 20000);
    state = withdraw.state;
    expect(state.cash).toBe(130000);
    expect(state.netDeposits).toBe(130000);
    expect(state.trades[0].kind).toBe('withdraw');
  });

  it('rejects invalid amounts and overdrafts without mutating state', () => {
    const state = blankState();
    expect(applyCashFlow(state, 'deposit', 0).error).toBeTruthy();
    expect(applyCashFlow(state, 'deposit', Number.NaN).error).toBeTruthy();
    const overdraft = applyCashFlow(state, 'withdraw', 999999);
    expect(overdraft.error).toContain('可用资金不足');
    expect(overdraft.state).toBe(state);
  });
});

describe('placeOrder', () => {
  it('fills a buy order, merges average cost and auto-watches the code', () => {
    let state = blankState();
    const first = placeOrder(state, { side: 'buy', code: '000001.XSHE', name: '平安银行', price: 10, quantity: 1000 });
    expect(first.error).toBeUndefined();
    state = first.state;
    expect(state.cash).toBe(90000);
    expect(state.holdings).toEqual([
      expect.objectContaining({ code: '000001.XSHE', quantity: 1000, avgCost: 10 }),
    ]);
    expect(state.watchlist).toContain('000001.XSHE');
    expect(state.trades[0]).toMatchObject({ kind: 'buy', quantity: 1000, amount: 10000 });

    const second = placeOrder(state, { side: 'buy', code: '000001.XSHE', name: '平安银行', price: 12, quantity: 500 });
    state = second.state;
    expect(state.holdings[0].quantity).toBe(1500);
    expect(state.holdings[0].avgCost).toBeCloseTo((10 * 1000 + 12 * 500) / 1500, 6);
  });

  it('rejects buys that break lot size or exceed cash', () => {
    const state = blankState();
    expect(placeOrder(state, { side: 'buy', code: 'x', name: 'x', price: 10, quantity: 150 }).error).toContain('100 股');
    const tooBig = placeOrder(state, { side: 'buy', code: 'x', name: 'x', price: 100, quantity: 2000 });
    expect(tooBig.error).toContain('现金不足');
    expect(tooBig.state).toBe(state);
    expect(placeOrder(state, { side: 'buy', code: 'x', name: 'x', price: 0, quantity: 100 }).error).toBeTruthy();
    expect(placeOrder(state, { side: 'buy', code: 'x', name: 'x', price: 10, quantity: 0 }).error).toBeTruthy();
  });

  it('sells partially and removes the holding when fully closed', () => {
    let state = blankState();
    state = placeOrder(state, { side: 'buy', code: '000001.XSHE', name: '平安银行', price: 10, quantity: 1000 }).state;

    const partial = placeOrder(state, { side: 'sell', code: '000001.XSHE', name: '平安银行', price: 11, quantity: 400 });
    expect(partial.error).toBeUndefined();
    state = partial.state;
    expect(state.cash).toBe(90000 + 4400);
    expect(state.holdings[0].quantity).toBe(600);

    const full = placeOrder(state, { side: 'sell', code: '000001.XSHE', name: '平安银行', price: 11, quantity: 600 });
    state = full.state;
    expect(state.holdings).toHaveLength(0);
  });

  it('rejects sells without a holding or beyond the held quantity', () => {
    let state = blankState();
    expect(placeOrder(state, { side: 'sell', code: 'x', name: 'X', price: 10, quantity: 100 }).error).toContain('没有持有');
    state = placeOrder(state, { side: 'buy', code: '000001.XSHE', name: '平安银行', price: 10, quantity: 100 }).state;
    const tooMany = placeOrder(state, { side: 'sell', code: '000001.XSHE', name: '平安银行', price: 10, quantity: 200 });
    expect(tooMany.error).toContain('可卖数量不足');
  });
});

describe('watchlist and portfolios', () => {
  it('toggles watchlist membership', () => {
    let state = blankState();
    state = toggleWatchlist(state, '600519.XSHG');
    expect(state.watchlist).toEqual(['600519.XSHG']);
    state = toggleWatchlist(state, '600519.XSHG');
    expect(state.watchlist).toEqual([]);
  });

  it('creates and deletes portfolios with validation', () => {
    let state = blankState();
    expect(createPortfolio(state, '  ', ['600519.XSHG']).error).toBeTruthy();
    expect(createPortfolio(state, '组合', []).error).toBeTruthy();

    const created = createPortfolio(state, 'AI 观察', ['600519.XSHG', '600519.XSHG', '300750.XSHE'], '主线备注');
    expect(created.error).toBeUndefined();
    state = created.state;
    expect(state.portfolios).toHaveLength(1);
    expect(state.portfolios[0].codes).toEqual(['600519.XSHG', '300750.XSHE']);
    expect(state.portfolios[0].note).toBe('主线备注');

    state = deletePortfolio(state, state.portfolios[0].id);
    expect(state.portfolios).toHaveLength(0);
  });

  it('updates a portfolio name, note and unique members with validation', () => {
    const created = createPortfolio(blankState(), '旧组合', ['600519.XSHG'], '旧备注').state;
    const id = created.portfolios[0].id;

    expect(updatePortfolio(created, id, ' ', ['300750.XSHE']).error).toBe('请输入组合名称。');
    expect(updatePortfolio(created, id, '新组合', []).error).toBe('请至少选择一只股票。');
    expect(updatePortfolio(created, 'missing', '新组合', ['300750.XSHE']).error).toBe('组合不存在或已被删除。');

    const updated = updatePortfolio(created, id, '  AI 成长  ', ['300750.XSHE', '300750.XSHE', '688981.XSHG'], '  主线更新  ');
    expect(updated.error).toBeUndefined();
    expect(updated.state.portfolios[0]).toMatchObject({
      id,
      name: 'AI 成长',
      codes: ['300750.XSHE', '688981.XSHG'],
      note: '主线更新',
    });
    expect(updated.state.portfolios[0].createdAt).toBe(created.portfolios[0].createdAt);
  });
});

describe('quotes and market stats', () => {
  it('keeps a broad built-in research catalog across major sectors', () => {
    const sectors = new Set(RESEARCH_CATALOG.map((entry) => entry.sector));
    expect(RESEARCH_CATALOG.length).toBeGreaterThanOrEqual(70);
    expect(sectors.size).toBeGreaterThanOrEqual(25);
  });

  it('builds quotes for the whole catalog plus custom securities', () => {
    let state = blankState();
    state = registerCustomSecurity(state, '601127.XSHG', { name: '赛力斯', basePrice: 88 });
    const quotes = buildQuoteMap(state);
    expect(quotes.size).toBe(RESEARCH_CATALOG.length + 1);
    expect(quotes.get('601127.XSHG')?.name).toBe('赛力斯');
    expect(quotes.get('601127.XSHG')?.price).toBeCloseTo(88, 6);
  });

  it('applies live overrides and recomputes the change percent', () => {
    const state = blankState();
    const overrides = new Map([[
      '600519.XSHG',
      {
        price: 1600,
        prevClose: 1500,
        high: 1618,
        low: 1498,
        volumeShares: 12_000_000,
        turnoverAmount: 19_200_000_000,
        highLimit: 1650,
        lowLimit: 1350,
      },
    ]]);
    const quotes = buildQuoteMap(state, overrides);
    const quote = quotes.get('600519.XSHG');
    expect(quote?.source).toBe('jqdata');
    expect(quote?.price).toBe(1600);
    expect(quote?.changePct).toBeCloseTo((100 / 1500) * 100, 6);
    expect(quote?.high).toBe(1618);
    expect(quote?.low).toBe(1498);
    expect(quote?.volume).toBe(12);
    expect(quote?.turnover).toBe(192);
    expect(quote?.highLimit).toBe(1650);
    expect(quote?.lowLimit).toBe(1350);
  });

  it('computes distribution buckets that cover every sample', () => {
    const quotes = buildQuoteMap(blankState());
    const overview = computeMarketOverview(quotes.values());
    const bucketSum = overview.buckets.reduce((sum, bucket) => sum + bucket.count, 0);
    expect(bucketSum).toBe(quotes.size);
    expect(overview.upCount + overview.downCount + overview.flatCount).toBe(quotes.size);
    const heat = computeSectorHeat(quotes.values());
    expect(heat.length).toBeGreaterThan(5);
  });

  it('builds drag prompts for market snapshot, ranks, heat and distribution objects', () => {
    const quoteList = Array.from(buildQuoteMap(blankState()).values()).slice(0, 12);
    const overview = computeMarketOverview(quoteList);
    const heat = computeSectorHeat(quoteList)[0];

    const marketPrompt = marketSnapshotPrompt({
      title: '市场快照',
      quotes: quoteList,
      overview,
      sourceLabel: '东方财富实时',
      asOfLabel: '10:30:00',
    });
    expect(marketPrompt).toContain('涨跌家数');
    expect(marketPrompt).toContain('成交额 Top');
    expect(marketPrompt).toContain('JQData 字段');

    expect(rankListPrompt('成交额 Top', quoteList.slice(0, 3), 'turnover')).toContain('共振');
    expect(sectorHeatPrompt(heat, quoteList)).toContain(heat.sector);
    expect(distributionPrompt(overview, '全市场 12 只股票')).toContain('分布桶');
  });
});

describe('account summary', () => {
  it('computes market value, pnl, exposure and weights from quotes', () => {
    let state = blankState();
    state = placeOrder(state, { side: 'buy', code: '600519.XSHG', name: '贵州茅台', price: 1000, quantity: 100 }).state;
    const overrides = new Map([[
      '600519.XSHG',
      { price: 1100, prevClose: 1000 },
    ]]);
    const quotes = buildQuoteMap(state, overrides);
    const summary = researchAccountSummary(state, quotes);
    expect(summary.valuationComplete).toBe(true);
    expect(summary.unpricedHoldings).toEqual([]);
    expect(summary.marketValue).toBe(110000);
    expect(summary.pnl).toBe(10000);
    expect(summary.holdings[0].todayPnl).toBe(10000);
    expect(summary.holdings[0].todayPnlPct).toBeCloseTo(10, 6);
    expect(summary.totalAssets).toBe(state.cash + 110000);
    expect(summary.totalReturn).toBeCloseTo(summary.totalAssets - state.netDeposits, 6);
    expect(summary.holdings[0].weightPct).toBeCloseTo((110000 / summary.totalAssets) * 100, 6);
    const exposure = sectorExposure(summary);
    expect(exposure[0]).toMatchObject({ sector: '白酒' });
    expect(exposure[0].pct).toBeCloseTo(100, 6);
    expect(sectorExposurePrompt(exposure)).toContain('集中度风险');
    expect(sectorExposurePrompt(exposure)).toContain('白酒');

    const prompt = accountPrompt(state, summary);
    expect(prompt).toContain('贵州茅台（600519.XSHG）');
    expect(prompt).toContain('成本 1000.00');
    expect(prompt).toContain('现价 1100.00');
    expect(prompt).toContain('今日盈亏 +1.00万');
  });

  it('never uses sample quotes to value a recorded live holding', () => {
    let state = blankState();
    state = placeOrder(state, { side: 'buy', code: '600519.XSHG', name: '贵州茅台', price: 1000, quantity: 100 }).state;
    const quotes = buildQuoteMap(state);
    const summary = researchAccountSummary(state, quotes);

    expect(quotes.get('600519.XSHG')?.source).toBe('sample');
    expect(summary.valuationComplete).toBe(false);
    expect(summary.holdings).toEqual([]);
    expect(summary.unpricedHoldings).toHaveLength(1);
    expect(summary.unpricedHoldings[0]).toMatchObject({ code: '600519.XSHG', reason: 'sample' });
    expect(accountPrompt(state, summary)).toContain('不使用样例价格估值');
    expect(accountPrompt(state, summary)).toContain('总资产、持仓盈亏、累计收益和仓位暂不可完整计算');
  });
});

describe('trade drag prompts', () => {
  it('summarizes individual trades and the trade log for the composer', () => {
    const trade = {
      id: 't1',
      kind: 'buy' as const,
      code: '600519.XSHG',
      name: '贵州茅台',
      price: 1000,
      quantity: 100,
      amount: 100000,
      createdAt: Date.UTC(2026, 6, 8, 9, 30),
    };

    expect(tradePrompt(trade)).toContain('实盘买入记录');
    expect(tradePrompt(trade)).toContain('止盈止损');
    expect(tradeLogPrompt([trade])).toContain('交易纪律');
    expect(tradeLogPrompt([trade])).toContain('贵州茅台');
  });
});

describe('实盘记录管理', () => {
  it('保存用户设置的成交时间，并用该时间标记首次建仓', () => {
    const createdAt = Date.UTC(2026, 6, 7, 1, 35);
    const result = placeOrder(blankState(), {
      side: 'buy',
      code: '000001.XSHE',
      name: '平安银行',
      price: 10,
      quantity: 100,
      createdAt,
    });

    expect(result.error).toBeUndefined();
    expect(result.state.trades[0].createdAt).toBe(createdAt);
    expect(result.state.holdings[0].openedAt).toBe(createdAt);
  });

  it('清空资金、持仓和交易记录，保留自选与观察组合', () => {
    let state = applyCashFlow(blankState(), 'deposit', 50_000).state;
    state = placeOrder(state, { side: 'buy', code: '000001.XSHE', name: '平安银行', price: 10, quantity: 100 }).state;
    state.watchlist = ['000001.XSHE'];
    state.portfolios = [{ id: 'p1', name: '观察', codes: ['000001.XSHE'], note: '', createdAt: 1 }];

    const cleared = clearLiveAccountRecords(state);
    expect(cleared).toMatchObject({ cash: 0, netDeposits: 0, holdings: [], trades: [] });
    expect(cleared.watchlist).toEqual(['000001.XSHE']);
    expect(cleared.portfolios).toHaveLength(1);
  });
});

describe('persistence', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('round-trips v3 state through localStorage', () => {
    let state = defaultResearchState();
    state = applyCashFlow(state, 'deposit', 200000).state;
    state = placeOrder(state, { side: 'buy', code: '600519.XSHG', name: '贵州茅台', price: 1000, quantity: 100 }).state;
    saveResearchState(state);
    const loaded = loadResearchState();
    expect(loaded.cash).toBe(state.cash);
    expect(loaded.holdings).toHaveLength(state.holdings.length);
    expect(loaded.version).toBe(3);
  });

  it('migrates legacy v1 state and derives net deposits', () => {
    window.localStorage.setItem(
      'alpha-studio.research-state.v1',
      JSON.stringify({
        cash: 500000,
        watchlist: ['000001.XSHE'],
        holdings: [{ code: '000001.XSHE', quantity: 1000, avgCost: 10 }],
        portfolios: [{ id: 'p1', name: '旧组合', codes: ['000001.XSHE'], note: '' }],
        trades: [],
      }),
    );
    const loaded = loadResearchState();
    expect(loaded.version).toBe(3);
    expect(loaded.cash).toBe(500000);
    expect(loaded.netDeposits).toBe(500000 + 10000);
    expect(loaded.holdings[0]).toMatchObject({ code: '000001.XSHE', quantity: 1000 });
    expect(loaded.portfolios[0].name).toBe('旧组合');
  });

  it('falls back to defaults for corrupted payloads', () => {
    window.localStorage.setItem('alpha-studio.research-state.v2', '{not json');
    const loaded = loadResearchState();
    expect(loaded.cash).toBe(defaultResearchState().cash);
  });

  it('starts new installs without seeded cash or holdings', () => {
    const state = defaultResearchState();
    expect(state.cash).toBe(0);
    expect(state.netDeposits).toBe(0);
    expect(state.holdings).toEqual([]);
  });

  it('clears the exact legacy demo account without deleting user-modified accounts', () => {
    const legacyDemo = {
      version: 2,
      cash: 1_000_000,
      netDeposits: 1_000_000,
      watchlist: [],
      holdings: [
        { code: '000001.XSHE', quantity: 12000, avgCost: 10.96, openedAt: 1 },
        { code: '300750.XSHE', quantity: 800, avgCost: 198.4, openedAt: 1 },
        { code: '600036.XSHG', quantity: 5000, avgCost: 34.2, openedAt: 1 },
      ],
      portfolios: [],
      trades: [],
      customSecurities: {},
    };
    const demo = normalizeResearchState(legacyDemo);
    expect(demo).toMatchObject({ version: 3, cash: 0, netDeposits: 0, holdings: [] });

    const modified = normalizeResearchState({ ...legacyDemo, cash: 900_000 });
    expect(modified.cash).toBe(900_000);
    expect(modified.holdings).toHaveLength(3);
  });
});
