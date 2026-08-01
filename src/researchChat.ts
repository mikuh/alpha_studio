import {
  RESEARCH_CATALOG,
  applyCashFlow,
  clearLiveAccountRecords,
  formatMoney,
  loadResearchState,
  normalizeSecurityCode,
  placeOrder,
  saveResearchState,
  type ResearchOrderSide,
  type ResearchState,
  type ResearchTrade,
} from './research';
import { scheduleLocalStoreCommit } from './localStore';

export interface ResearchChatCommandResult {
  handled: boolean;
  reply?: string;
}

const COMMAND_WORDS = /(?:记录|录入|登记|新增|添加|增加|追加|减少|扣减|转入|转出|修改|更正|修正|调整|设置|删除|移除|清空|重置)/;
const BUY_SELL = /(?:买入|卖出)/;

function compact(input: string): string {
  return input.replace(/[,，]/g, '').replace(/\s+/g, ' ').trim();
}

function amountFromText(raw: string, unit?: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return Number.NaN;
  if (unit === '万' || unit === 'w' || unit === 'W') return value * 10_000;
  return value;
}

function parseCashAmount(message: string): number | null {
  const afterKind = message.match(/(?:入金|出金|转入|转出|增加|追加|添加|减少|扣减)(?:我的|自己的|到|从|给|账户|现金|资金|余额|金额|中|里|为|是|\s)*?(\d+(?:\.\d+)?)\s*(万|[wW])?\s*元?/);
  const beforeKind = message.match(/(\d+(?:\.\d+)?)\s*(万|[wW])?\s*元?\s*(?:入金|出金|转入|转出|增加|追加|添加|减少|扣减)/);
  const match = afterKind ?? beforeKind;
  if (!match) return null;
  const value = amountFromText(match[1], match[2]);
  return Number.isFinite(value) ? value : null;
}

function parseQuantity(message: string): number | null {
  const match = message.match(/(\d+(?:\.\d+)?)\s*(万|[wW])?\s*股/);
  if (!match) return null;
  const value = amountFromText(match[1], match[2]);
  return Number.isFinite(value) ? Math.floor(value) : null;
}

function parsePrice(message: string): number | null {
  const keyed = message.match(/(?:成交价(?:格)?|价格|均价|成本价?|以)(?:改成|更正为|修正为|调整为|设置为|为|是)?\s*(\d+(?:\.\d+)?)\s*元?/);
  if (keyed) return Number(keyed[1]);
  const beforeSide = message.match(/(\d+(?:\.\d+)?)\s*元\s*(?:买入|卖出)/);
  return beforeSide ? Number(beforeSide[1]) : null;
}

function parseRecordedAt(message: string, now = new Date()): number | null {
  const full = message.match(/(20\d{2})[-/.\u5e74](\d{1,2})[-/.\u6708](\d{1,2})(?:日)?(?:\s+|[Tt])?(\d{1,2})?(?::|时)?(\d{1,2})?(?:分)?/);
  if (full) {
    const date = new Date(Number(full[1]), Number(full[2]) - 1, Number(full[3]), Number(full[4] ?? 0), Number(full[5] ?? 0));
    return Number.isNaN(date.getTime()) ? null : date.getTime();
  }
  const monthDay = message.match(/(\d{1,2})月(\d{1,2})日?(?:\s*)?(\d{1,2})?(?::|时)?(\d{1,2})?(?:分)?/);
  if (monthDay) {
    const date = new Date(now.getFullYear(), Number(monthDay[1]) - 1, Number(monthDay[2]), Number(monthDay[3] ?? 0), Number(monthDay[4] ?? 0));
    return Number.isNaN(date.getTime()) ? null : date.getTime();
  }
  const clock = message.match(/(?:今天|昨天|刚刚|成交时间|时间)?\s*(\d{1,2}):(\d{2})/);
  if (clock) {
    const date = new Date(now);
    if (message.includes('昨天')) date.setDate(date.getDate() - 1);
    date.setHours(Number(clock[1]), Number(clock[2]), 0, 0);
    return date.getTime();
  }
  if (message.includes('昨天')) {
    const date = new Date(now);
    date.setDate(date.getDate() - 1);
    return date.getTime();
  }
  return null;
}

function securityFromMessage(message: string, state: ResearchState): { code: string; name: string } | null {
  const codeMatch = message.match(/(?<!\d)(?:sh|sz)?\d{6}(?:\.(?:XSHG|XSHE))?(?!\d)/i)?.[0];
  if (codeMatch) {
    const code = normalizeSecurityCode(codeMatch);
    if (code) {
      const catalog = RESEARCH_CATALOG.find((item) => item.code === code);
      return { code, name: state.customSecurities[code]?.name ?? catalog?.name ?? code.slice(0, 6) };
    }
  }
  const candidates = [
    ...RESEARCH_CATALOG.map((item) => ({ code: item.code, name: item.name })),
    ...Object.entries(state.customSecurities).map(([code, item]) => ({ code, name: item.name })),
  ].sort((a, b) => b.name.length - a.name.length);
  return candidates.find((item) => item.name && message.includes(item.name)) ?? null;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false });
}

function save(next: ResearchState): void {
  saveResearchState(next);
  scheduleLocalStoreCommit('research', {
    research: next,
    audit: {
      domain: 'research',
      action: 'chat.command',
      payload: { holdings: next.holdings.length, trades: next.trades.length },
    },
  });
}

function updateHoldingCommand(message: string, state: ResearchState): ResearchChatCommandResult | null {
  const isHoldingCommand = /(?:持仓|持有)/.test(message) && /(?:设置|修正|更正|调整|改成|设为|调为|删除|移除|清空)/.test(message);
  if (!isHoldingCommand) return null;
  const security = securityFromMessage(message, state);
  if (!security && /(?:交易|买卖|流水|全部|所有|账户|实盘)/.test(message)) return null;
  if (!security) return { handled: true, reply: '我识别到你要修改持仓，但没有识别到股票。请说明名称或 6 位代码，例如：“把宁德时代持仓修正为 300 股，成本 210 元”。' };
  const remove = /(?:删除|移除|清空|清仓)/.test(message);
  const quantity = remove ? 0 : parseQuantity(message);
  const existing = state.holdings.find((item) => item.code === security.code);
  if (quantity === null) return { handled: true, reply: `请告诉我 ${security.name} 修正后的持仓数量，例如“设置为 300 股”。` };
  if (quantity <= 0) {
    save({ ...state, holdings: state.holdings.filter((item) => item.code !== security.code) });
    return { handled: true, reply: `已将 ${security.name}（${security.code}）从当前持仓中移除。历史买卖记录未删除。` };
  }
  const price = parsePrice(message) ?? existing?.avgCost ?? null;
  if (!price || price <= 0) return { handled: true, reply: `请同时告诉我 ${security.name} 的持仓成本，例如“成本 210 元”。` };
  const openedAt = parseRecordedAt(message) ?? existing?.openedAt ?? Date.now();
  const nextHolding = { code: security.code, quantity, avgCost: price, openedAt };
  const holdings = existing
    ? state.holdings.map((item) => item.code === security.code ? nextHolding : item)
    : [...state.holdings, nextHolding];
  save({
    ...state,
    holdings,
    watchlist: state.watchlist.includes(security.code) ? state.watchlist : [...state.watchlist, security.code],
  });
  return {
    handled: true,
    reply: `已将 ${security.name}（${security.code}）的当前持仓修正为 ${quantity.toLocaleString('zh-CN')} 股，成本 ${price.toFixed(2)} 元。\n\n这是对当前持仓的直接校正，不会伪造或改写历史买卖记录。`,
  };
}

function clearCommand(message: string, state: ResearchState): ResearchChatCommandResult | null {
  if (!/(?:清空|重置)/.test(message)) return null;
  const holdings = /(?:持仓|仓位)/.test(message);
  const trades = /(?:交易|买卖|流水|记录)/.test(message);
  const funds = /(?:资金|现金|账户|全部|实盘)/.test(message);
  if (!holdings && !trades && !funds) return null;
  if ((holdings && trades) || funds) {
    save(clearLiveAccountRecords(state));
    return { handled: true, reply: '已清空本地实盘账户的资金、持仓和交易记录。自选股与观察组合已保留，现在可以重新录入。' };
  }
  if (holdings) {
    save({ ...state, holdings: [] });
    return { handled: true, reply: '已清空当前持仓。资金余额和历史交易记录已保留。' };
  }
  save({ ...state, trades: [] });
  return { handled: true, reply: '已清空历史交易记录。当前资金和持仓已保留。' };
}

function findLatestTrade(state: ResearchState, message: string): ResearchTrade | null {
  const side: ResearchOrderSide | null = message.includes('买入') ? 'buy' : message.includes('卖出') ? 'sell' : null;
  return state.trades.find((trade) => (!side || trade.kind === side) && (trade.kind === 'buy' || trade.kind === 'sell')) ?? null;
}

function editTradeCommand(message: string, state: ResearchState): ResearchChatCommandResult | null {
  const targetsLatest = /(?:上一笔|最近一笔|最新一笔)/.test(message);
  if (!targetsLatest || !/(?:交易|买入|卖出|记录)/.test(message)) return null;
  const target = findLatestTrade(state, message);
  if (!target) return { handled: true, reply: '没有找到可修改的买卖记录。' };
  if (/(?:删除|移除)/.test(message)) {
    save({ ...state, trades: state.trades.filter((trade) => trade.id !== target.id) });
    return { handled: true, reply: `已删除最近一笔${target.kind === 'buy' ? '买入' : '卖出'}记录：${target.name ?? target.code ?? '未知标的'}，${formatMoney(target.amount)}。\n\n只删除了历史记录，当前持仓和现金未自动回算。` };
  }
  if (!/(?:修改|更正|修正|调整)/.test(message)) return null;
  const price = parsePrice(message);
  const quantity = parseQuantity(message);
  const createdAt = parseRecordedAt(message);
  if (price === null && quantity === null && createdAt === null) {
    return { handled: true, reply: '请说明要修改的价格、数量或成交时间。例如：“把上一笔买入记录的价格改成 210 元”。' };
  }
  const nextPrice = price ?? target.price;
  const nextQuantity = quantity ?? target.quantity;
  const next: ResearchTrade = {
    ...target,
    price: nextPrice,
    quantity: nextQuantity,
    amount: nextPrice && nextQuantity ? nextPrice * nextQuantity : target.amount,
    createdAt: createdAt ?? target.createdAt,
  };
  save({ ...state, trades: state.trades.map((trade) => trade.id === target.id ? next : trade).sort((a, b) => b.createdAt - a.createdAt) });
  return {
    handled: true,
    reply: `已更正最近一笔${next.kind === 'buy' ? '买入' : '卖出'}记录：${next.name ?? next.code ?? '未知标的'}，${next.quantity ?? 0} 股 @ ${next.price?.toFixed(2) ?? '—'}，时间 ${formatTime(next.createdAt)}。\n\n历史记录已修改；为避免擅自改动实盘数据，当前持仓和现金未随历史记录回算。如需同步，请继续告诉我目标持仓或现金余额。`,
  };
}

function recordTradeCommand(message: string, state: ResearchState): ResearchChatCommandResult | null {
  const explicitRecord = /(?:记录|录入|登记|新增|添加)/.test(message) && BUY_SELL.test(message);
  if (!explicitRecord) return null;
  const side: ResearchOrderSide = message.includes('卖出') ? 'sell' : 'buy';
  const security = securityFromMessage(message, state);
  const price = parsePrice(message);
  const quantity = parseQuantity(message);
  if (!security || price === null || quantity === null) {
    return {
      handled: true,
      reply: '请同时说明股票、成交价格和数量。例如：“记录 2026-07-30 10:15 以 210 元买入宁德时代 300 股”。',
    };
  }
  const createdAt = parseRecordedAt(message) ?? Date.now();
  const result = placeOrder(state, { side, code: security.code, name: security.name, price, quantity, createdAt });
  if (result.error) {
    const fundingHint = side === 'buy' && result.error.includes('现金不足') ? '你可以先在“实盘”页记录入金，或直接用对话修正当前持仓。' : '';
    return { handled: true, reply: `这笔记录没有保存：${result.error}${fundingHint ? `\n\n${fundingHint}` : ''}` };
  }
  save(result.state);
  return {
    handled: true,
    reply: `已记录${side === 'buy' ? '买入' : '卖出'} ${security.name}（${security.code}）${quantity.toLocaleString('zh-CN')} 股，成交价 ${price.toFixed(2)} 元，成交金额 ${formatMoney(price * quantity)}，时间 ${formatTime(createdAt)}。\n\n当前持仓和资金余额已同步更新。`,
  };
}

function cashFlowCommand(message: string, state: ResearchState): ResearchChatCommandResult | null {
  const hasDirectFlow = /(?:入金|出金|转入|转出)/.test(message);
  const hasFundsAndDelta = /(?:资金|现金|账户|余额)/.test(message) && /(?:增加|追加|添加|减少|扣减)/.test(message);
  if (!hasDirectFlow && !hasFundsAndDelta) return null;
  const side = /(?:出金|转出|减少|扣减)/.test(message) ? 'withdraw' : 'deposit';
  const amount = parseCashAmount(message);
  if (amount === null) return { handled: true, reply: '请说明要增加或减少的资金金额，例如：“给账户增加资金 10 万元”。' };
  const createdAt = parseRecordedAt(message) ?? Date.now();
  const result = applyCashFlow(state, side, amount, createdAt);
  if (result.error) return { handled: true, reply: `这笔资金记录没有保存：${result.error}` };
  save(result.state);
  return {
    handled: true,
    reply: `已${side === 'deposit' ? '增加' : '减少'}资金 ${formatMoney(amount)}，并记录为${side === 'deposit' ? '入金' : '出金'}流水；时间 ${formatTime(createdAt)}。当前现金余额为 ${formatMoney(result.state.cash)}。`,
  };
}

/**
 * 只处理带有明确写入动作的实盘账户指令。投研问句和假设性买卖不会命中。
 */
export function executeResearchChatCommand(input: string): ResearchChatCommandResult {
  const message = compact(input);
  if (!message || !COMMAND_WORDS.test(message)) return { handled: false };
  if (/^(?:如果|假如|假设|举例|例如)/.test(message)) return { handled: false };
  const state = loadResearchState();
  return updateHoldingCommand(message, state)
    ?? editTradeCommand(message, state)
    ?? clearCommand(message, state)
    ?? cashFlowCommand(message, state)
    ?? recordTradeCommand(message, state)
    ?? { handled: false };
}
