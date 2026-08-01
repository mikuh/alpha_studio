import { beforeEach, describe, expect, it } from 'vitest';
import { applyCashFlow, defaultResearchState, loadResearchState, saveResearchState } from './research';
import { executeResearchChatCommand } from './researchChat';

describe('实盘账户对话指令', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('用明确对话直接修正当前持仓', () => {
    const result = executeResearchChatCommand('把宁德时代的持仓修正为 300 股，成本 210 元');

    expect(result.handled).toBe(true);
    expect(result.reply).toContain('当前持仓修正为 300 股');
    expect(loadResearchState().holdings).toContainEqual(expect.objectContaining({
      code: '300750.XSHE',
      quantity: 300,
      avgCost: 210,
    }));
  });

  it('记录带有历史成交时间的买入，并同步更新持仓和资金', () => {
    executeResearchChatCommand('记录入金 10 万元');

    const result = executeResearchChatCommand('请记录 2026-07-30 10:15 以 10 元买入平安银行 1000 股');
    const state = loadResearchState();
    const trade = state.trades.find((item) => item.kind === 'buy');

    expect(result.handled).toBe(true);
    expect(result.reply).toContain('已记录买入');
    expect(state.cash).toBe(90_000);
    expect(state.holdings[0]).toMatchObject({ code: '000001.XSHE', quantity: 1000, avgCost: 10 });
    expect(trade).toBeDefined();
    expect(new Date(trade!.createdAt).getFullYear()).toBe(2026);
    expect(new Date(trade!.createdAt).getMonth()).toBe(6);
    expect(new Date(trade!.createdAt).getDate()).toBe(30);
    expect(new Date(trade!.createdAt).getHours()).toBe(10);
    expect(new Date(trade!.createdAt).getMinutes()).toBe(15);
  });

  it('支持用自然语言增加或减少资金，并生成资金流水', () => {
    const added = executeResearchChatCommand('给我的账户增加资金 10 万元');
    const reduced = executeResearchChatCommand('从账户减少资金 2.5 万元');
    const state = loadResearchState();

    expect(added.handled).toBe(true);
    expect(added.reply).toContain('已增加资金 10.00万');
    expect(reduced.handled).toBe(true);
    expect(reduced.reply).toContain('已减少资金 2.50万');
    expect(state.cash).toBe(75_000);
    expect(state.netDeposits).toBe(75_000);
    expect(state.trades.map((trade) => trade.kind)).toEqual(['withdraw', 'deposit']);
  });

  it('资金减少超过当前现金时不修改数据', () => {
    executeResearchChatCommand('转入 1 万元到账户');

    const result = executeResearchChatCommand('从账户减少资金 2 万元');

    expect(result.handled).toBe(true);
    expect(result.reply).toContain('这笔资金记录没有保存');
    expect(loadResearchState().cash).toBe(10_000);
  });

  it('可修改最近一笔买卖记录，但不静默回算当前持仓', () => {
    saveResearchState(applyCashFlow(defaultResearchState(), 'deposit', 100_000).state);
    executeResearchChatCommand('记录以 10 元买入平安银行 1000 股');

    const result = executeResearchChatCommand('把最近一笔买入记录的价格更正为 10.5 元');
    const state = loadResearchState();

    expect(result.handled).toBe(true);
    expect(result.reply).toContain('当前持仓和现金未随历史记录回算');
    expect(state.trades.find((trade) => trade.kind === 'buy')?.price).toBe(10.5);
    expect(state.holdings[0].avgCost).toBe(10);
  });

  it('不把假设性投研问题误判成写入指令', () => {
    expect(executeResearchChatCommand('如果宁德时代跌到 210 元，建议买入 300 股吗？')).toEqual({ handled: false });
    expect(executeResearchChatCommand('如果给账户增加资金 10 万元，仓位会变成多少？')).toEqual({ handled: false });
    expect(loadResearchState().holdings).toHaveLength(0);
  });

  it('可用对话清空资金、持仓与买卖记录', () => {
    let state = applyCashFlow(defaultResearchState(), 'deposit', 100_000).state;
    state.holdings = [{ code: '000001.XSHE', quantity: 100, avgCost: 10, openedAt: Date.now() }];
    saveResearchState(state);

    const result = executeResearchChatCommand('清空全部持仓和交易记录，我要重新录入');

    expect(result.handled).toBe(true);
    expect(loadResearchState()).toMatchObject({ cash: 0, netDeposits: 0, holdings: [], trades: [] });
  });
});
