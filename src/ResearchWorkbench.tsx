// 投研工作台：富途风格的右侧面板。
// 行情池、市场聚合、自选、持仓、模拟交易（入金出金 + 限价买卖）、股票组合。
// 所有卡片都可拖拽到对话框，生成自然语言 prompt 交给 Agent。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, DragEvent as ReactDragEvent, FormEvent } from 'react';
import {
  hierarchy,
  treemap,
  treemapSquarify,
  type HierarchyRectangularNode,
} from 'd3-hierarchy';
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineSeries,
  LineStyle,
  createChart,
  type CandlestickData,
  type LineData,
  type MouseEventParams,
  type Time,
} from 'lightweight-charts';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ChartCandlestick,
  Database,
  GripVertical,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Star,
  Trash2,
  Wallet,
  X,
} from 'lucide-react';
import {
  emptyJqDataConfig,
  fetchJqDailyBars,
  fetchJqLatestPriceBatch,
  fetchJqSecurityProfile,
  loadJqDataConfig,
  type JqDataConfig,
  type JqSecurityProfile,
} from './jqdata';
import {
  fetchEastmoneyFullMarket,
  fetchEastmoneyRealtimeBatch,
  fetchEastmoneyTicks,
  type EastmoneyTick,
} from './eastmoney';
import {
  RESEARCH_ANALYSIS_TASKS,
  RESEARCH_CATALOG,
  RESEARCH_DRAG_MIME,
  RESEARCH_INDEXES,
  accountPrompt,
  applyCashFlow,
  buildIndexQuotes,
  buildQuoteMap,
  changeTone,
  computeMarketOverview,
  computeSectorHeat,
  createPortfolio,
  deletePortfolio,
  formatMoney,
  formatPercent,
  formatSignedMoney,
  holdingPrompt,
  loadResearchState,
  marketSnapshotPrompt,
  normalizeResearchState,
  placeOrder,
  portfolioPrompt,
  rankListPrompt,
  registerCustomSecurity,
  researchAccountSummary,
  saveResearchState,
  sectorExposure,
  sectorExposurePrompt,
  sectorHeatPrompt,
  securityPrompt,
  shortCode,
  distributionPrompt,
  toggleWatchlist,
  tradeLogPrompt,
  tradePrompt,
  watchlistPrompt,
  type LivePriceOverride,
  type ResearchBar,
  type ResearchOrderSide,
  type ResearchQuote,
  type ResearchState,
  type ResearchTrade,
} from './research';
import { loadLocalStoreSnapshot, scheduleLocalStoreCommit } from './localStore';

type WorkbenchTab = 'market' | 'overview' | 'watchlist' | 'holdings' | 'trade' | 'portfolios';
type MarketDataSource = 'eastmoney' | 'jqdata' | null;
type MarketRankMode = 'gainers' | 'losers' | 'turnoverRate' | 'turnover';
type MarketBoardFilter = 'all' | 'main' | 'startup' | 'star';
type TreemapViewMode = 'focus' | 'sectors' | 'full';
type DataPillTone = 'checking' | 'ready' | 'missing';

interface DataPillState {
  tone: DataPillTone;
  label: string;
  title?: string;
}

const TAB_LABELS: Record<WorkbenchTab, string> = {
  market: '市场',
  overview: '行情',
  watchlist: '自选',
  holdings: '持仓',
  trade: '交易',
  portfolios: '组合',
};

interface TradePrefill {
  side: ResearchOrderSide;
  code: string;
  price?: number;
}

function startResearchDrag(event: ReactDragEvent<HTMLElement>, prompt: string) {
  event.dataTransfer.setData(RESEARCH_DRAG_MIME, prompt);
  event.dataTransfer.setData('text/plain', prompt);
  event.dataTransfer.effectAllowed = 'copy';
}

function startNestedResearchDrag(event: ReactDragEvent<HTMLElement>, prompt: string) {
  event.stopPropagation();
  startResearchDrag(event, prompt);
}

function realQuoteSourceLabel(source: ResearchQuote['source']): string {
  if (source === 'eastmoney') return '东方财富实时快照';
  if (source === 'jqdata') return '聚宽日线快照';
  return '本地样例';
}

function formatRefreshTime(timestamp: number | null): string | null {
  if (!timestamp) return null;
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour12: false });
}

function liveOverrideFromQuote(quote: ResearchQuote): LivePriceOverride {
  return {
    source: quote.source === 'sample' ? 'eastmoney' : quote.source,
    price: quote.price,
    prevClose: quote.prevClose,
    high: quote.high,
    low: quote.low,
    volumeShares: quote.volumeShares,
    turnoverAmount: quote.turnoverAmount,
    marketCapAmount: quote.marketCap ? quote.marketCap * 100_000_000 : undefined,
    turnoverRate: quote.turnoverRate,
    volumeRatio: quote.volumeRatio,
    paused: quote.paused,
  };
}

function quoteSearchText(quote: ResearchQuote): string {
  const rawCode = shortCode(quote.code);
  const exchangePrefix = quote.code.endsWith('.XSHG') ? 'sh' : quote.code.endsWith('.XSHE') ? 'sz' : '';
  return [
    quote.code,
    rawCode,
    exchangePrefix ? `${exchangePrefix}${rawCode}` : '',
    quote.name,
    quote.sector,
    ...quote.tags,
  ].join(' ').toLowerCase();
}

function quoteMatchesQuery(quote: ResearchQuote, normalizedQuery: string): boolean {
  return !normalizedQuery || quoteSearchText(quote).includes(normalizedQuery);
}

function mergeQuoteUniverse(
  quotes: Map<string, ResearchQuote>,
  fullMarketQuotes: ResearchQuote[],
): Map<string, ResearchQuote> {
  const universe = new Map(quotes);
  for (const quote of fullMarketQuotes) {
    if (!universe.has(quote.code)) universe.set(quote.code, quote);
  }
  return universe;
}

function summarizeJqErrors(errors: string[], requested: number): string | null {
  const messages = Array.from(
    new Set(
      errors
        .map((error) => error.replace(/^[^.。；;：:]+[：:]\s*/, '').trim())
        .filter(Boolean),
    ),
  );
  if (!messages.length) return null;
  const permission = messages.find((message) => message.includes('账号无有效权限'));
  const auth = messages.find((message) => message.includes('认证失败') || message.includes('权限'));
  const picked = permission || auth || messages[0];
  const suffix = requested > 1 ? `（影响 ${errors.length}/${requested} 个标的）` : '';
  return `${picked}${suffix}`;
}

function simpleMetricPrompt(label: string, value: string, detail: string): string {
  return [
    `请解读投研工作台指标「${label}」。`,
    `当前值：${value}。`,
    detail,
    '请说明它对市场判断、持仓风险和下一步数据验证的含义。',
  ].join('\n');
}

function stockTickPrompt(quote: ResearchQuote, ticks: EastmoneyTick[]): string {
  const lines = ticks.slice(0, 12).map((tick) =>
    `- ${tick.time} ${tick.side ?? '中性'} ${tick.price.toFixed(2)} ${tick.volumeHands ? `${tick.volumeHands.toFixed(0)}手` : ''}`.trim(),
  );
  return [
    `请分析 ${quote.name}（${quote.code}）最近分笔成交。`,
    ...(lines.length ? lines : ['- 暂无分笔成交。']),
    '请判断主动买卖力量、盘口短线情绪、是否需要等待更好的成交确认。',
  ].join('\n');
}

function profilePrompt(quote: ResearchQuote, profile: JqSecurityProfile): string {
  const lines = [
    profile.info?.type ? `证券类型：${profile.info.type}` : '',
    profile.info?.startDate ? `上市日期：${profile.info.startDate}` : '',
    profile.industryNames.length ? `行业归属：${profile.industryNames.join(' / ')}` : '',
    profile.moneyFlow ? `主力净流：${profile.moneyFlow.latestMainNetAmount === null ? '缺失' : formatMoney(profile.moneyFlow.latestMainNetAmount * 10000)}，5 日 ${profile.moneyFlow.fiveDayMainNetAmount === null ? '缺失' : formatMoney(profile.moneyFlow.fiveDayMainNetAmount * 10000)}` : '',
    profile.mtss ? `融资余额：${profile.mtss.finValue === null ? '缺失' : formatMoney(profile.mtss.finValue)}，融券余额：${profile.mtss.secValue === null ? '缺失' : formatMoney(profile.mtss.secValue)}` : '',
    profile.lockedShares ? `后续解禁：${profile.lockedShares.lockedShares === null ? '缺失' : formatMoney(profile.lockedShares.lockedShares)}，占比 ${profile.lockedShares.shareRate === null ? '缺失' : formatPercent(profile.lockedShares.shareRate)}` : '',
  ].filter(Boolean);
  return [
    `请基于聚宽个股画像分析 ${quote.name}（${quote.code}）。`,
    ...(lines.length ? lines : ['聚宽个股画像暂无完整返回。']),
    profile.warnings.length ? `数据缺口：${compactProfileWarning(profile.warnings) ?? profile.warnings.join('；')}` : '',
    '请判断资金驱动、杠杆压力、行业归属和解禁风险，并给出后续需要补查的财务/因子字段。',
  ].filter(Boolean).join('\n');
}

function profileMetricPrompt(quote: ResearchQuote, label: string, value: string, meta: string): string {
  return [
    `请解读 ${quote.name}（${quote.code}）的聚宽指标「${label}」。`,
    `当前值：${value}；口径：${meta}。`,
    '请说明这个指标对短线资金、基本面验证、风险控制和后续跟踪动作的含义。',
  ].join('\n');
}

function quoteCandlePrompt(quote: ResearchQuote, bars: ResearchBar[]): string {
  const latest = bars[bars.length - 1];
  const first = bars[0];
  return [
    `请解读 ${quote.name}（${quote.code}）的聚宽日线走势。`,
    latest && first
      ? `样本区间 ${first.date} 至 ${latest.date}，最新收盘 ${latest.close.toFixed(2)}，最高 ${latest.high.toFixed(2)}，最低 ${latest.low.toFixed(2)}。`
      : '日线样本不足。',
    '请给出趋势结构、量价背离、关键支撑压力、适合等待还是交易的判断。',
  ].join('\n');
}

export function ResearchWorkbenchPanel() {
  const [config, setConfig] = useState<JqDataConfig>(() => emptyJqDataConfig());
  const [configLoading, setConfigLoading] = useState(true);
  const [state, setState] = useState<ResearchState>(() => loadResearchState());
  const [tab, setTab] = useState<WorkbenchTab>('market');
  const [liveOverrides, setLiveOverrides] = useState<Map<string, LivePriceOverride> | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [lastRefreshAt, setLastRefreshAt] = useState<number | null>(null);
  const [dataAsOfDate, setDataAsOfDate] = useState<string | null>(null);
  const [marketDataSource, setMarketDataSource] = useState<MarketDataSource>(null);
  const [marketDataCached, setMarketDataCached] = useState(false);
  const [fullMarketQuotes, setFullMarketQuotes] = useState<ResearchQuote[]>([]);
  const [fullMarketRefreshing, setFullMarketRefreshing] = useState(false);
  const [fullMarketError, setFullMarketError] = useState<string | null>(null);
  const [fullMarketAsOfLabel, setFullMarketAsOfLabel] = useState<string | null>(null);
  const [fullMarketRefreshAt, setFullMarketRefreshAt] = useState<number | null>(null);
  const [fullMarketCached, setFullMarketCached] = useState(false);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [tradePrefill, setTradePrefill] = useState<TradePrefill | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const commit = useCallback((next: ResearchState) => {
    setState(next);
    saveResearchState(next);
    scheduleLocalStoreCommit('research', {
      research: next,
      audit: {
        domain: 'research',
        action: 'state.persist',
        payload: {
          holdings: next.holdings.length,
          watchlist: next.watchlist.length,
          trades: next.trades.length,
        },
      },
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadLocalStoreSnapshot()
      .then((snapshot) => {
        if (cancelled || !snapshot?.research) return;
        const next = normalizeResearchState(snapshot.research as Partial<ResearchState>);
        setState(next);
        stateRef.current = next;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setConfigLoading(true);
    void loadJqDataConfig()
      .then((next) => {
        if (!cancelled) setConfig(next);
      })
      .catch(() => {
        if (!cancelled) setConfig(emptyJqDataConfig());
      })
      .finally(() => {
        if (!cancelled) setConfigLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const jqReady = Boolean(config.enabled && config.username && config.passwordConfigured);

  const ensureQuoteRegistered = useCallback((baseState: ResearchState, quote: ResearchQuote): ResearchState => {
    return registerCustomSecurity(baseState, quote.code, {
      name: quote.name,
      sector: quote.sector,
      basePrice: quote.price,
    });
  }, []);

  const rememberQuoteOverride = useCallback((quote: ResearchQuote) => {
    setLiveOverrides((current) => {
      const next = new Map(current ?? []);
      next.set(quote.code, liveOverrideFromQuote(quote));
      return next;
    });
    setMarketDataSource('eastmoney');
    setDataAsOfDate(new Date().toLocaleTimeString('zh-CN', { hour12: false }));
    setLastRefreshAt(Date.now());
  }, []);

  const toggleQuoteWatch = useCallback((quote: ResearchQuote) => {
    rememberQuoteOverride(quote);
    const prepared = ensureQuoteRegistered(stateRef.current, quote);
    commit(toggleWatchlist(prepared, quote.code));
  }, [commit, ensureQuoteRegistered, rememberQuoteOverride]);

  const openQuoteTrade = useCallback((quote: ResearchQuote, prefill: TradePrefill) => {
    rememberQuoteOverride(quote);
    const prepared = ensureQuoteRegistered(stateRef.current, quote);
    if (prepared !== stateRef.current) commit(prepared);
    setTradePrefill(prefill);
    setTab('trade');
  }, [commit, ensureQuoteRegistered, rememberQuoteOverride]);

  const refreshQuotes = useCallback(async (forceRefresh = false) => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const current = stateRef.current;
      const codes = Array.from(
        new Set([
          ...RESEARCH_INDEXES.map((item) => item.code),
          ...RESEARCH_CATALOG.map((item) => item.code),
          ...Object.keys(current.customSecurities),
          ...current.watchlist,
          ...current.holdings.map((item) => item.code),
          ...current.portfolios.flatMap((item) => item.codes),
        ]),
      );
      const realtime = await fetchEastmoneyRealtimeBatch(codes, { forceRefresh });
      if (realtime.prices.size) {
        setLiveOverrides(realtime.prices);
        setDataError(realtime.errors.length ? summarizeJqErrors(realtime.errors, realtime.requested) : null);
        setDataAsOfDate(realtime.asOfLabel ?? null);
        setMarketDataSource('eastmoney');
        setMarketDataCached(Boolean(realtime.cached));
        setLastRefreshAt(Date.now());
        return;
      }

      if (!jqReady) {
        setLiveOverrides(null);
        setDataAsOfDate(null);
        setMarketDataSource(null);
        setMarketDataCached(false);
        setDataError(
          summarizeJqErrors(realtime.errors, realtime.requested) ||
            '东方财富实时接口未返回可用报价；聚宽未配置，无法回退到日线数据。',
        );
        return;
      }

      const result = await fetchJqLatestPriceBatch(codes, { forceRefresh });
      if (result.prices.size) {
        setLiveOverrides(result.prices);
        const fallbackNote = realtime.errors.length
          ? `东方财富实时未返回，已回退聚宽日线。${summarizeJqErrors(realtime.errors, realtime.requested) ?? ''}`.trim()
          : null;
        setDataError(fallbackNote || (result.errors.length ? summarizeJqErrors(result.errors, result.requested) : null));
        setDataAsOfDate(result.asOfDate ?? null);
        setMarketDataSource('jqdata');
        setMarketDataCached(Boolean(result.cached));
        setLastRefreshAt(Date.now());
      } else {
        setLiveOverrides(null);
        setDataAsOfDate(null);
        setMarketDataSource(null);
        setMarketDataCached(false);
        setDataError(
          summarizeJqErrors([...realtime.errors, ...result.errors], Math.max(realtime.requested, result.requested)) ||
            '未获取到真实 JQData 行情，请在设置中测试聚宽账号与权限。',
        );
      }
    } catch (error) {
      setLiveOverrides(null);
      setDataAsOfDate(null);
      setMarketDataSource(null);
      setMarketDataCached(false);
      setDataError(error instanceof Error ? error.message : String(error));
    } finally {
      setRefreshing(false);
    }
  }, [jqReady, refreshing]);

  const refreshFullMarket = useCallback(async (forceRefresh = false) => {
    if (fullMarketRefreshing) return;
    setFullMarketRefreshing(true);
    try {
      const result = await fetchEastmoneyFullMarket(6000, { forceRefresh });
      if (result.quotes.length) {
        setFullMarketQuotes(result.quotes);
        setFullMarketError(result.errors.length ? summarizeJqErrors(result.errors, result.requested) : null);
        setFullMarketAsOfLabel(result.asOfLabel ?? null);
        setFullMarketRefreshAt(Date.now());
        setFullMarketCached(Boolean(result.cached));
      } else {
        setFullMarketQuotes([]);
        setFullMarketAsOfLabel(null);
        setFullMarketRefreshAt(null);
        setFullMarketCached(false);
        setFullMarketError(
          summarizeJqErrors(result.errors, result.requested) || '东方财富行情接口未返回可用股票行情。',
        );
      }
    } catch (error) {
      setFullMarketQuotes([]);
      setFullMarketAsOfLabel(null);
      setFullMarketRefreshAt(null);
      setFullMarketCached(false);
      setFullMarketError(error instanceof Error ? error.message : String(error));
    } finally {
      setFullMarketRefreshing(false);
    }
  }, [fullMarketRefreshing]);

  // 工作台打开后自动刷新一次真实行情；优先东方财富实时，失败再回退聚宽日线。
  const autoRefreshedRef = useRef(false);
  useEffect(() => {
    if (configLoading || autoRefreshedRef.current) return;
    autoRefreshedRef.current = true;
    void refreshQuotes();
  }, [configLoading, refreshQuotes]);

  const fullMarketRefreshedRef = useRef(false);
  useEffect(() => {
    if (!['market', 'overview'].includes(tab) || fullMarketRefreshedRef.current) return;
    fullMarketRefreshedRef.current = true;
    void refreshFullMarket();
  }, [refreshFullMarket, tab]);

  const quotes = useMemo(() => {
    if (!liveOverrides?.size) return new Map<string, ResearchQuote>();
    const all = buildQuoteMap(state, liveOverrides);
    return new Map(Array.from(all.entries()).filter(([, quote]) => quote.source !== 'sample'));
  }, [liveOverrides, state]);
  const portfolioQuoteUniverse = useMemo(
    () => mergeQuoteUniverse(quotes, fullMarketQuotes),
    [quotes, fullMarketQuotes],
  );
  const indexQuotes = useMemo(
    () => (liveOverrides?.size ? buildIndexQuotes(liveOverrides).filter((index) => index.source !== 'sample') : []),
    [liveOverrides],
  );
  const summary = useMemo(() => researchAccountSummary(state, quotes), [state, quotes]);

  const fullMarketTimeLabel = fullMarketAsOfLabel ?? formatRefreshTime(fullMarketRefreshAt);
  const dataPill: DataPillState = tab === 'overview' || tab === 'market'
    ? fullMarketRefreshing
      ? { tone: 'checking', label: '行情读取中' }
      : fullMarketQuotes.length
        ? {
            tone: 'ready',
            label: fullMarketTimeLabel
              ? `${fullMarketCached ? '缓存' : '实时'} ${fullMarketTimeLabel}`
              : fullMarketCached ? '缓存行情' : '实时行情',
            title: `东方财富行情池 ${fullMarketQuotes.length} 只${fullMarketTimeLabel ? `，${fullMarketTimeLabel} 更新` : ''}${fullMarketCached ? '，来自本地缓存' : ''}`,
          }
      : fullMarketError
        ? { tone: 'missing', label: '行情不可用' }
        : { tone: 'checking', label: '等待行情' }
    : configLoading
      ? { tone: 'checking', label: '检测中' }
      : dataError && !liveOverrides?.size
      ? { tone: 'missing', label: '真实数据不可用' }
    : dataError
      ? { tone: 'missing', label: '部分未返回' }
      : liveOverrides && marketDataSource === 'eastmoney'
        ? { tone: 'ready', label: dataAsOfDate ? `${marketDataCached ? '缓存' : '实时'} ${dataAsOfDate}` : marketDataCached ? '缓存行情' : '实时行情' }
      : liveOverrides && marketDataSource === 'jqdata'
        ? { tone: 'ready', label: dataAsOfDate ? `${marketDataCached ? '缓存' : '日线'} ${dataAsOfDate}` : marketDataCached ? '缓存日线' : '日线数据' }
      : { tone: 'checking', label: refreshing ? '读取中' : '等待刷新' };

  const openTrade = useCallback((prefill: TradePrefill) => {
    setTradePrefill(prefill);
    setTab('trade');
  }, []);

  const openDetail = useCallback((code: string) => {
    setSelectedCode(code);
    setTab('market');
  }, []);

  const accountDragPrompt = accountPrompt(state, summary);
  const refreshBusy = tab === 'market'
    ? fullMarketRefreshing || refreshing
    : tab === 'overview'
      ? fullMarketRefreshing
      : refreshing;
  const refreshesFullMarket = tab === 'market' || tab === 'overview';
  const footerRefreshAt = refreshesFullMarket ? fullMarketRefreshAt ?? lastRefreshAt : lastRefreshAt;

  return (
    <section className="rw-panel right-dock-panel" aria-label="投研工作台">
      <header className="rw-head">
        <div className="rw-head-title">
          <h2>投研工作台</h2>
          <span>模拟账户 · 卡片可拖入对话框交给 Agent</span>
        </div>
        <div className="rw-head-actions">
          <span className={`rw-data-pill ${dataPill.tone}`} title={dataPill.title}>
            <Database size={12} />
            {dataPill.label}
          </span>
          <button
            type="button"
            className="rw-icon-btn"
            onClick={() => {
              if (tab === 'market') {
                void refreshFullMarket(true);
                void refreshQuotes(true);
                return;
              }
              void (tab === 'overview' ? refreshFullMarket(true) : refreshQuotes(true));
            }}
            disabled={refreshBusy}
            aria-label="刷新行情"
            title={tab === 'market' ? '刷新行情股票排行和指数行情' : tab === 'overview' ? '从东方财富刷新行情池' : '从东方财富刷新自选与持仓行情；失败时回退聚宽日线'}
          >
            {refreshBusy ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
          </button>
        </div>
      </header>

      <div
        className="rw-account-strip"
        draggable
        onDragStart={(event) => startResearchDrag(event, accountDragPrompt)}
        title="拖拽到对话框，让 Agent 复盘整个模拟账户"
        aria-label="模拟账户概览"
      >
        <span className="rw-drag-grip"><GripVertical size={13} /></span>
        <AccountMetric label="总资产" value={formatMoney(summary.totalAssets)} strong />
        <AccountMetric
          label="浮盈亏"
          value={formatSignedMoney(summary.pnl)}
          tone={changeTone(summary.pnl)}
        />
        <AccountMetric
          label="累计收益"
          value={formatPercent(summary.totalReturnPct)}
          tone={changeTone(summary.totalReturn)}
        />
        <AccountMetric label="现金" value={formatMoney(state.cash)} />
        <AccountMetric label="仓位" value={formatPercent(summary.exposurePct)} />
      </div>

      <nav className="rw-tabs" role="tablist" aria-label="投研工作台页签">
        {(Object.keys(TAB_LABELS) as WorkbenchTab[]).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={`rw-tab ${tab === key ? 'active' : ''}`}
            onClick={() => setTab(key)}
          >
            {TAB_LABELS[key]}
            {key === 'overview' && fullMarketQuotes.length > 0 && <em>{fullMarketQuotes.length}</em>}
            {key === 'watchlist' && state.watchlist.length > 0 && <em>{state.watchlist.length}</em>}
            {key === 'holdings' && state.holdings.length > 0 && <em>{state.holdings.length}</em>}
            {key === 'portfolios' && state.portfolios.length > 0 && <em>{state.portfolios.length}</em>}
          </button>
        ))}
      </nav>

      <div className="rw-body">
        {tab === 'market' && (
          <MarketTab
            state={state}
            quotes={fullMarketQuotes}
            indexQuotes={indexQuotes}
            jqReady={jqReady}
            selectedCode={selectedCode}
            dataError={fullMarketError}
            loading={fullMarketRefreshing}
            refreshing={fullMarketRefreshing || refreshing}
            onRefresh={() => {
              void refreshFullMarket(true);
              void refreshQuotes(true);
            }}
            onSelect={setSelectedCode}
            onToggleWatch={toggleQuoteWatch}
            onTrade={openQuoteTrade}
          />
        )}
        {tab === 'overview' && (
          <FullMarketTab
            state={state}
            quotes={fullMarketQuotes}
            loading={fullMarketRefreshing}
            error={fullMarketError}
            asOfLabel={fullMarketAsOfLabel}
            jqReady={jqReady}
            onRefresh={() => void refreshFullMarket(true)}
            onToggleWatch={toggleQuoteWatch}
            onTrade={openQuoteTrade}
          />
        )}
        {tab === 'watchlist' && (
          <WatchlistTab
            state={state}
            quotes={quotes}
            onToggleWatch={(code) => commit(toggleWatchlist(state, code))}
            onDetail={openDetail}
            onTrade={openTrade}
          />
        )}
        {tab === 'holdings' && (
          <HoldingsTab
            summary={summary}
            holdingCount={state.holdings.length}
            onDetail={openDetail}
            onTrade={openTrade}
          />
        )}
        {tab === 'trade' && (
          <TradeTab
            state={state}
            quotes={quotes}
            summary={summary}
            prefill={tradePrefill}
            onConsumePrefill={() => setTradePrefill(null)}
            onCommit={commit}
          />
        )}
        {tab === 'portfolios' && (
          <PortfoliosTab
            state={state}
            quotes={portfolioQuoteUniverse}
            onCommit={commit}
            onDetail={openDetail}
          />
        )}
      </div>

      <footer className="rw-quick" aria-label="AI 分析任务">
        <span className="rw-quick-label"><Sparkles size={12} />拖给 Agent</span>
        <div className="rw-quick-chips">
          {RESEARCH_ANALYSIS_TASKS.map((task) => (
            <span
              key={task.id}
              className="rw-quick-chip"
              draggable
              onDragStart={(event) => startResearchDrag(event, `${task.prompt}\n\n${accountDragPrompt}`)}
              title={task.prompt}
            >
              {task.title}
            </span>
          ))}
        </div>
        {footerRefreshAt && (
          <span className="rw-quick-refreshed">
            {formatRefreshTime(footerRefreshAt)} 更新
          </span>
        )}
      </footer>
    </section>
  );
}

function AccountMetric({
  label,
  value,
  tone,
  strong,
}: {
  label: string;
  value: string;
  tone?: 'up' | 'down' | 'flat';
  strong?: boolean;
}) {
  return (
    <span className={`rw-metric ${tone ?? ''} ${strong ? 'strong' : ''}`}>
      <em>{label}</em>
      <strong>{value}</strong>
    </span>
  );
}

// ---- 市场 --------------------------------------------------------------------

function MarketTab({
  state,
  quotes,
  indexQuotes,
  jqReady,
  selectedCode,
  dataError,
  loading,
  refreshing,
  onRefresh,
  onSelect,
  onToggleWatch,
  onTrade,
}: {
  state: ResearchState;
  quotes: ResearchQuote[];
  indexQuotes: ReturnType<typeof buildIndexQuotes>;
  jqReady: boolean;
  selectedCode: string | null;
  dataError: string | null;
  loading: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onSelect: (code: string | null) => void;
  onToggleWatch: (quote: ResearchQuote) => void;
  onTrade: (quote: ResearchQuote, prefill: TradePrefill) => void;
}) {
  const [query, setQuery] = useState('');
  const [rankMode, setRankMode] = useState<MarketRankMode>('gainers');
  const [boardFilter, setBoardFilter] = useState<MarketBoardFilter>('all');
  const [displayLimit, setDisplayLimit] = useState(120);

  const allQuotes = quotes;

  useEffect(() => {
    setDisplayLimit(120);
  }, [boardFilter, query, rankMode]);

  const normalizedQuery = query.trim().toLowerCase();
  const visible = useMemo(() => {
    const filtered = allQuotes.filter((quote) => {
      if (boardFilter === 'main' && !quote.board.includes('主板')) return false;
      if (boardFilter === 'startup' && !quote.board.includes('创业板')) return false;
      if (boardFilter === 'star' && !quote.board.includes('科创板')) return false;
      if (!normalizedQuery) return true;
      return quoteMatchesQuery(quote, normalizedQuery);
    });
    const sorted = [...filtered];
    if (rankMode === 'gainers') sorted.sort((a, b) => b.changePct - a.changePct);
    if (rankMode === 'losers') sorted.sort((a, b) => a.changePct - b.changePct);
    if (rankMode === 'turnoverRate') sorted.sort((a, b) => (b.turnoverRate ?? -1) - (a.turnoverRate ?? -1));
    if (rankMode === 'turnover') sorted.sort((a, b) => b.turnover - a.turnover);
    return sorted;
  }, [allQuotes, boardFilter, normalizedQuery, rankMode]);

  const rows = visible.slice(0, displayLimit);

  const selected = selectedCode ? allQuotes.find((quote) => quote.code === selectedCode) ?? null : null;

  return (
    <div className="rw-tab-page">
      <div className="rw-index-row">
        {indexQuotes.map((index) => (
          <article
            key={index.code}
            className={`rw-index-card ${changeTone(index.changePct)}`}
            draggable
            onDragStart={(event) =>
              startResearchDrag(
                event,
                `请解读指数 ${index.name}（${index.code}）当前点位 ${index.price.toFixed(2)}、涨跌幅 ${formatPercent(index.changePct)} 的市场含义，并结合我的持仓判断仓位应对。`,
              )
            }
          >
            <span className="rw-index-name">{index.name}</span>
            <strong>{index.price.toFixed(2)}</strong>
            <em>
              {formatSignedMoney(index.changeAmt)} {formatPercent(index.changePct)}
            </em>
          </article>
        ))}
      </div>

      {allQuotes.length === 0 && (
        <RealDataEmptyState
          refreshing={loading || refreshing}
          error={dataError}
          onRefresh={onRefresh}
        />
      )}

      {selected && (
        <StockDetailCard
          quote={selected}
          jqReady={jqReady}
          watched={state.watchlist.includes(selected.code)}
          held={state.holdings.some((item) => item.code === selected.code)}
          onClose={() => onSelect(null)}
          onToggleWatch={() => onToggleWatch(selected)}
          onTrade={(prefill) => onTrade(selected, prefill)}
        />
      )}

      {allQuotes.length > 0 && (
        <section className="rw-section" aria-label="股票排行">
          <header className="rw-section-head">
            <span>股票排行</span>
            <em>东方财富实时 · {allQuotes.length} 只</em>
          </header>
          <div className="rw-market-filters">
            <div className="rw-sort-chips">
              {([
                ['all', '沪深京'],
                ['main', '主板'],
                ['startup', '创业板'],
                ['star', '科创板'],
              ] as Array<[MarketBoardFilter, string]>).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={boardFilter === key ? 'active' : ''}
                  onClick={() => setBoardFilter(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="rw-sort-chips">
              {([
                ['gainers', '涨幅榜'],
                ['losers', '跌幅榜'],
                ['turnoverRate', '换手榜'],
                ['turnover', '成交额'],
              ] as Array<[MarketRankMode, string]>).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={rankMode === key ? 'active' : ''}
                  onClick={() => setRankMode(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <label className="rw-search">
              <Search size={13} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索所有股票：代码 / 名称 / 行业"
                spellCheck={false}
              />
              {query && (
                <button type="button" onClick={() => setQuery('')} aria-label="清空搜索">
                  <X size={12} />
                </button>
              )}
          </label>
          <div className="rw-stock-list">
            {rows.map((quote) => (
              <StockRow
                key={quote.code}
                quote={quote}
                watched={state.watchlist.includes(quote.code)}
                active={selectedCode === quote.code}
                onClick={() => onSelect(selectedCode === quote.code ? null : quote.code)}
                onToggleWatch={() => onToggleWatch(quote)}
              />
            ))}
            {visible.length === 0 && <div className="rw-empty">没有匹配的真实行情标的。</div>}
          </div>
          {visible.length > rows.length && (
            <button type="button" className="rw-load-more" onClick={() => setDisplayLimit((value) => value + 160)}>
              加载更多 {rows.length}/{visible.length}
            </button>
          )}
        </section>
      )}
    </div>
  );
}

function MarketSnapshotPanel({
  quotes,
  heatPromptQuotes = quotes,
  overview,
  heatTiles,
  dataError,
  dataAsOfDate,
  marketDataSource,
  liveQuoteCount,
  onSelect,
  onFilterSector,
}: {
  quotes: ResearchQuote[];
  heatPromptQuotes?: ResearchQuote[];
  overview: ReturnType<typeof computeMarketOverview>;
  heatTiles: ReturnType<typeof computeSectorHeat>;
  dataError: string | null;
  dataAsOfDate: string | null;
  marketDataSource: MarketDataSource;
  liveQuoteCount: number;
  onSelect: (code: string | null) => void;
  onFilterSector: (sector: string) => void;
}) {
  const medianChange = useMemo(() => median(quotes.map((quote) => quote.changePct)), [quotes]);
  const totalTurnover = useMemo(
    () => quotes.reduce((sum, quote) => sum + quote.turnover * 100000000, 0),
    [quotes],
  );
  const turnoverLeaders = useMemo(
    () => [...quotes].sort((a, b) => b.turnover - a.turnover).slice(0, 5),
    [quotes],
  );
  const movers = useMemo(
    () => [...quotes].sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct)).slice(0, 5),
    [quotes],
  );
  const strongest = heatTiles[0] ?? null;
  const weakest = heatTiles[heatTiles.length - 1] ?? null;
  const sourceName = marketDataSource === 'eastmoney' ? '东方财富实时' : '聚宽日线';
  const sourceText = liveQuoteCount
    ? dataError
      ? `部分未返回 · ${sourceName} ${dataAsOfDate ?? '最新'} · ${liveQuoteCount} 只`
      : `${sourceName} ${dataAsOfDate ?? '最新'} · ${liveQuoteCount} 只`
    : dataError
      ? '真实行情未返回'
      : '真实行情';
  const snapshotPrompt = marketSnapshotPrompt({
    title: '市场快照',
    quotes,
    overview,
    sourceLabel: sourceName,
    asOfLabel: dataAsOfDate,
    note: dataError,
  });

  return (
    <section
      className="rw-section rw-market-snapshot"
      aria-label="市场快照"
      draggable
      onDragStart={(event) => startResearchDrag(event, snapshotPrompt)}
      title="拖拽市场快照到对话框"
    >
      <header className="rw-section-head">
        <span><Database size={13} /> 市场快照</span>
        <em>{sourceText}</em>
      </header>
      <div className="rw-market-metrics">
        <article
          draggable
          onDragStart={(event) =>
            startNestedResearchDrag(
              event,
              simpleMetricPrompt(
                '涨跌家数',
                `${overview.upCount}/${overview.downCount}`,
                `平盘 ${overview.flatCount}，样本 ${quotes.length} 只，数据口径 ${sourceName}。`,
              ),
            )
          }
        >
          <em>涨跌家数</em>
          <strong>
            <span className="up">{overview.upCount}</span>
            <i>/</i>
            <span className="down">{overview.downCount}</span>
          </strong>
          <span>平盘 {overview.flatCount}</span>
        </article>
        <article
          draggable
          onDragStart={(event) =>
            startNestedResearchDrag(
              event,
              simpleMetricPrompt(
                '中位涨跌',
                formatPercent(medianChange),
                `${dataAsOfDate ? `${sourceName} ${dataAsOfDate}` : `${quotes.length} 只真实行情`}。`,
              ),
            )
          }
        >
          <em>中位涨跌</em>
          <strong className={changeTone(medianChange)}>{formatPercent(medianChange)}</strong>
          <span>{dataAsOfDate ? `${sourceName} ${dataAsOfDate}` : `${quotes.length} 只真实行情`}</span>
        </article>
        <article
          draggable
          onDragStart={(event) =>
            startNestedResearchDrag(
              event,
              simpleMetricPrompt(
                '成交额',
                formatMoney(totalTurnover),
                `按${sourceName}成交额汇总，样本 ${quotes.length} 只。`,
              ),
            )
          }
        >
          <em>成交额</em>
          <strong>{formatMoney(totalTurnover)}</strong>
          <span>按{sourceName}成交额汇总</span>
        </article>
        {strongest && (
          <button
            type="button"
            draggable
            onDragStart={(event) => startNestedResearchDrag(event, sectorHeatPrompt(strongest, heatPromptQuotes))}
            onClick={() => onFilterSector(strongest.sector)}
          >
            <em>最强行业</em>
            <strong className={changeTone(strongest.avgPct)}>{strongest.sector}</strong>
            <span>{formatPercent(strongest.avgPct)}</span>
          </button>
        )}
        {weakest && (
          <button
            type="button"
            draggable
            onDragStart={(event) => startNestedResearchDrag(event, sectorHeatPrompt(weakest, heatPromptQuotes))}
            onClick={() => onFilterSector(weakest.sector)}
          >
            <em>最弱行业</em>
            <strong className={changeTone(weakest.avgPct)}>{weakest.sector}</strong>
            <span>{formatPercent(weakest.avgPct)}</span>
          </button>
        )}
      </div>
      <div className="rw-market-lists">
        <SnapshotList title="成交额 Top" rows={turnoverLeaders} metric="turnover" onSelect={onSelect} />
        <SnapshotList title="异动榜" rows={movers} metric="change" onSelect={onSelect} />
      </div>
      {dataError && <p className="rw-source-note">{dataError}</p>}
    </section>
  );
}

interface MarketSectorTurnoverStat {
  sector: string;
  turnover: number;
  count: number;
  avgPct: number;
  upCount: number;
}

interface MarketBoardStat {
  board: string;
  count: number;
  avgPct: number;
  turnover: number;
  upCount: number;
}

interface IndustryTreemapSector {
  sector: string;
  count: number;
  avgPct: number;
  turnover: number;
  marketCap: number;
  sizeValue: number;
  upCount: number;
  downCount: number;
  quotes: ResearchQuote[];
}

interface IndustryTreemapDatum {
  name: string;
  value: number;
  type: 'root' | 'sector' | 'sectorSummary' | 'stock' | 'aggregate';
  sector?: string;
  avgPct?: number;
  count?: number;
  upCount?: number;
  downCount?: number;
  turnover?: number;
  quote?: ResearchQuote;
  children?: IndustryTreemapDatum[];
}

function FullMarketDashboard({
  quotes,
  allQuotes,
  overview,
  heatTiles,
  sectorFilter,
  asOfLabel,
  onFilterSector,
  onSelect,
}: {
  quotes: ResearchQuote[];
  allQuotes: ResearchQuote[];
  overview: ReturnType<typeof computeMarketOverview>;
  heatTiles: ReturnType<typeof computeSectorHeat>;
  sectorFilter: string | null;
  asOfLabel: string | null;
  onFilterSector: (sector: string) => void;
  onSelect: (code: string | null) => void;
}) {
  const total = Math.max(1, quotes.length);
  const upRatio = (overview.upCount / total) * 100;
  const downRatio = (overview.downCount / total) * 100;
  const flatRatio = (overview.flatCount / total) * 100;
  const totalTurnover = useMemo(
    () => quotes.reduce((sum, quote) => sum + quoteTurnoverAmount(quote), 0),
    [quotes],
  );
  const medianChange = useMemo(() => median(quotes.map((quote) => quote.changePct)), [quotes]);
  const limitStats = useMemo(() => computeMarketLimitStats(quotes), [quotes]);
  const sectorTurnover = useMemo(() => aggregateSectorTurnover(quotes).slice(0, 6), [quotes]);
  const boardStats = useMemo(() => aggregateBoardStats(quotes), [quotes]);
  const turnoverRateRows = useMemo(
    () => [...quotes].filter((quote) => Number.isFinite(quote.turnoverRate)).sort((a, b) => (b.turnoverRate ?? 0) - (a.turnoverRate ?? 0)).slice(0, 5),
    [quotes],
  );
  const volumeRatioRows = useMemo(
    () => [...quotes].filter((quote) => Number.isFinite(quote.volumeRatio)).sort((a, b) => (b.volumeRatio ?? 0) - (a.volumeRatio ?? 0)).slice(0, 5),
    [quotes],
  );
  const turnoverRows = useMemo(() => [...quotes].sort((a, b) => b.turnover - a.turnover).slice(0, 5), [quotes]);
  const gainRows = useMemo(() => [...quotes].sort((a, b) => b.changePct - a.changePct).slice(0, 5), [quotes]);
  const activityLeftRows = turnoverRateRows.length ? turnoverRateRows : turnoverRows;
  const activityRightRows = volumeRatioRows.length ? volumeRatioRows : gainRows;
  const strongest = heatTiles.slice(0, 4);
  const weakest = heatTiles.slice(-4).reverse();
  const maxSectorTurnover = Math.max(1, ...sectorTurnover.map((row) => row.turnover));
  const maxBoardCount = Math.max(1, ...boardStats.map((row) => row.count));
  const scopeLabel = sectorFilter ? `${sectorFilter} ${quotes.length} 只` : `行情池 ${quotes.length} 只`;
  const sourceLabel = asOfLabel ? `东方财富 ${asOfLabel}` : '东方财富实时';
  const dashboardPrompt = [
    marketSnapshotPrompt({
      title: sectorFilter ? `${sectorFilter} 行情切片` : '行情仪表盘',
      quotes,
      overview,
      sourceLabel,
      asOfLabel,
    }),
    `市场宽度：上涨占比 ${formatPlainPercent(upRatio)}，下跌占比 ${formatPlainPercent(downRatio)}，中位涨跌 ${formatPercent(medianChange)}。`,
    `极值信号：强涨 ${limitStats.strongUp}，强跌 ${limitStats.strongDown}，涨停/近涨停 ${limitStats.nearLimitUp}，跌停/近跌停 ${limitStats.nearLimitDown}，停牌 ${limitStats.paused}。`,
    `成交额结构：${sectorTurnover.map((row) => `${row.sector} ${formatMoney(row.turnover)}`).join('；') || '暂无'}。`,
    `市场分层：${boardStats.map((row) => `${row.board} ${row.count}只 ${formatPercent(row.avgPct)}`).join('；') || '暂无'}。`,
  ].join('\n');

  return (
    <section
      className="rw-section rw-full-dashboard"
      aria-label="行情仪表盘"
      draggable
      onDragStart={(event) => startResearchDrag(event, dashboardPrompt)}
      title="拖拽行情仪表盘到对话框"
    >
      <header className="rw-section-head">
        <span><Database size={13} /> 行情仪表盘</span>
        <em>{scopeLabel} · {sourceLabel}</em>
      </header>

      <div className="rw-full-kpi-grid">
        <article
          className={`rw-breadth-card ${overview.upCount >= overview.downCount ? 'up' : 'down'}`}
          draggable
          onDragStart={(event) =>
            startNestedResearchDrag(
              event,
              simpleMetricPrompt(
                '市场宽度',
                `上涨 ${overview.upCount} / 下跌 ${overview.downCount}`,
                `${scopeLabel}，上涨占比 ${formatPlainPercent(upRatio)}，平盘 ${overview.flatCount}，中位涨跌 ${formatPercent(medianChange)}。`,
              ),
            )
          }
        >
          <span>市场宽度</span>
          <strong>{formatPlainPercent(upRatio)}</strong>
          <div className="rw-breadth-meter" aria-hidden="true">
            <i className="down" style={{ width: `${Math.max(1, downRatio)}%` }} />
            <i className="flat" style={{ width: `${Math.max(1, flatRatio)}%` }} />
            <i className="up" style={{ width: `${Math.max(1, upRatio)}%` }} />
          </div>
          <em>涨 {overview.upCount} · 跌 {overview.downCount} · 平 {overview.flatCount}</em>
        </article>

        <article
          className="rw-turnover-card"
          draggable
          onDragStart={(event) =>
            startNestedResearchDrag(
              event,
              simpleMetricPrompt(
                '行情池成交额',
                formatMoney(totalTurnover),
                `${scopeLabel}，按东方财富返回成交额汇总；中位涨跌 ${formatPercent(medianChange)}。`,
              ),
            )
          }
        >
          <span>成交额</span>
          <strong>{formatMoney(totalTurnover)}</strong>
          <em>中位涨跌 <b className={changeTone(medianChange)}>{formatPercent(medianChange)}</b></em>
        </article>

        <article
          className="rw-limit-card"
          draggable
          onDragStart={(event) =>
            startNestedResearchDrag(
              event,
              simpleMetricPrompt(
                '极值信号',
                `强涨 ${limitStats.strongUp} / 强跌 ${limitStats.strongDown}`,
                `涨停或近涨停 ${limitStats.nearLimitUp}，跌停或近跌停 ${limitStats.nearLimitDown}，停牌 ${limitStats.paused}；样本 ${scopeLabel}。`,
              ),
            )
          }
        >
          <span>极值信号</span>
          <div className="rw-limit-grid">
            <i className="up"><b>{limitStats.nearLimitUp}</b>近涨停</i>
            <i className="up"><b>{limitStats.strongUp}</b>强涨</i>
            <i className="down"><b>{limitStats.nearLimitDown}</b>近跌停</i>
            <i className="down"><b>{limitStats.strongDown}</b>强跌</i>
          </div>
        </article>
      </div>

      <div className="rw-full-chart-grid">
        <article className="rw-chart-panel">
          <header>
            <span>成交额结构</span>
            <em>行业资金集中度</em>
          </header>
          <div className="rw-hbar-list">
            {sectorTurnover.map((row) => (
              <button
                key={row.sector}
                type="button"
                draggable
                onDragStart={(event) =>
                  startNestedResearchDrag(event, sectorTurnoverPrompt(row, quotes, scopeLabel))
                }
                onClick={() => onFilterSector(row.sector)}
              >
                <span>{row.sector}</span>
                <strong>{formatMoney(row.turnover)}</strong>
                <em>{row.count} 只 · {formatPercent(row.avgPct)}</em>
                <i style={{ width: `${Math.max(5, (row.turnover / maxSectorTurnover) * 100)}%` }} />
              </button>
            ))}
          </div>
        </article>

        <article className="rw-chart-panel">
          <header>
            <span>市场分层</span>
            <em>板块样本与表现</em>
          </header>
          <div className="rw-board-stack" aria-hidden="true">
            {boardStats.map((row) => (
              <i
                key={row.board}
                className={changeTone(row.avgPct)}
                style={{ width: `${Math.max(4, (row.count / total) * 100)}%` }}
                title={`${row.board} ${row.count} 只`}
              />
            ))}
          </div>
          <div className="rw-board-list">
            {boardStats.map((row) => (
              <div
                key={row.board}
                className="rw-board-row"
                draggable
                onDragStart={(event) =>
                  startNestedResearchDrag(event, boardStructurePrompt(row, quotes, scopeLabel))
                }
              >
                <span>{row.board}</span>
                <strong className={changeTone(row.avgPct)}>{formatPercent(row.avgPct)}</strong>
                <em>{row.count} 只 · {formatMoney(row.turnover)}</em>
                <i style={{ width: `${Math.max(6, (row.count / maxBoardCount) * 100)}%` }} />
              </div>
            ))}
          </div>
        </article>

        <article className="rw-chart-panel">
          <header>
            <span>板块强弱</span>
            <em>平均涨跌幅</em>
          </header>
          <div className="rw-strength-grid">
            <MarketStrengthList
              title="强势"
              rows={strongest}
              quotes={allQuotes}
              onFilterSector={onFilterSector}
            />
            <MarketStrengthList
              title="弱势"
              rows={weakest}
              quotes={allQuotes}
              onFilterSector={onFilterSector}
            />
          </div>
        </article>

        <article className="rw-chart-panel">
          <header>
            <span>活跃度排行</span>
            <em>可用字段自动切换</em>
          </header>
          <div className="rw-activity-grid">
            <MarketMiniRank
              title={turnoverRateRows.length ? '换手率 Top' : '成交额 Top'}
              rows={activityLeftRows}
              value={(quote) => turnoverRateRows.length ? formatPercent(quote.turnoverRate ?? 0) : formatMoney(quoteTurnoverAmount(quote))}
              promptMetric={turnoverRateRows.length ? '换手率' : '成交额'}
              onSelect={onSelect}
            />
            <MarketMiniRank
              title={volumeRatioRows.length ? '量比 Top' : '涨幅 Top'}
              rows={activityRightRows}
              value={(quote) => volumeRatioRows.length ? `${(quote.volumeRatio ?? 0).toFixed(2)}x` : formatPercent(quote.changePct)}
              promptMetric={volumeRatioRows.length ? '量比' : '涨幅'}
              onSelect={onSelect}
            />
          </div>
        </article>
      </div>
    </section>
  );
}

function quoteTurnoverAmount(quote: ResearchQuote): number {
  return quote.turnoverAmount ?? quote.turnover * 100_000_000;
}

function formatPlainPercent(value: number): string {
  if (!Number.isFinite(value)) return '-';
  return `${value.toFixed(1)}%`;
}

function normalizeBoardLabel(board: string): string {
  if (board.includes('科创')) return '科创板';
  if (board.includes('创业')) return '创业板';
  if (board.includes('北')) return '北交所';
  if (board.includes('主板')) return '主板';
  return board || '其他';
}

function computeMarketLimitStats(quotes: ResearchQuote[]) {
  let nearLimitUp = 0;
  let nearLimitDown = 0;
  let strongUp = 0;
  let strongDown = 0;
  let paused = 0;
  for (const quote of quotes) {
    const hitUpLimit = Number.isFinite(quote.highLimit) && quote.highLimit ? quote.price >= quote.highLimit * 0.999 : false;
    const hitDownLimit = Number.isFinite(quote.lowLimit) && quote.lowLimit ? quote.price <= quote.lowLimit * 1.001 : false;
    if (hitUpLimit || quote.changePct >= 9.8) nearLimitUp += 1;
    if (hitDownLimit || quote.changePct <= -9.8) nearLimitDown += 1;
    if (quote.changePct >= 7) strongUp += 1;
    if (quote.changePct <= -7) strongDown += 1;
    if (quote.paused) paused += 1;
  }
  return { nearLimitUp, nearLimitDown, strongUp, strongDown, paused };
}

function aggregateSectorTurnover(quotes: ResearchQuote[]): MarketSectorTurnoverStat[] {
  const groups = new Map<string, { turnover: number; totalPct: number; count: number; upCount: number }>();
  for (const quote of quotes) {
    const group = groups.get(quote.sector) ?? { turnover: 0, totalPct: 0, count: 0, upCount: 0 };
    group.turnover += quoteTurnoverAmount(quote);
    group.totalPct += quote.changePct;
    group.count += 1;
    if (quote.changePct > 0) group.upCount += 1;
    groups.set(quote.sector, group);
  }
  return Array.from(groups.entries())
    .map(([sector, group]) => ({
      sector,
      turnover: group.turnover,
      count: group.count,
      avgPct: group.count ? group.totalPct / group.count : 0,
      upCount: group.upCount,
    }))
    .sort((a, b) => b.turnover - a.turnover);
}

function aggregateBoardStats(quotes: ResearchQuote[]): MarketBoardStat[] {
  const groups = new Map<string, { turnover: number; totalPct: number; count: number; upCount: number }>();
  for (const quote of quotes) {
    const board = normalizeBoardLabel(quote.board);
    const group = groups.get(board) ?? { turnover: 0, totalPct: 0, count: 0, upCount: 0 };
    group.turnover += quoteTurnoverAmount(quote);
    group.totalPct += quote.changePct;
    group.count += 1;
    if (quote.changePct > 0) group.upCount += 1;
    groups.set(board, group);
  }
  return Array.from(groups.entries())
    .map(([board, group]) => ({
      board,
      count: group.count,
      avgPct: group.count ? group.totalPct / group.count : 0,
      turnover: group.turnover,
      upCount: group.upCount,
    }))
    .sort((a, b) => b.count - a.count);
}

function sectorTurnoverPrompt(row: MarketSectorTurnoverStat, quotes: ResearchQuote[], scopeLabel: string): string {
  const leaders = quotes
    .filter((quote) => quote.sector === row.sector)
    .sort((a, b) => quoteTurnoverAmount(b) - quoteTurnoverAmount(a))
    .slice(0, 8)
    .map((quote) => `- ${quote.name}（${quote.code}）：成交额 ${formatMoney(quoteTurnoverAmount(quote))}，涨跌幅 ${formatPercent(quote.changePct)}`);
  return [
    `请分析${scopeLabel}中的行业成交额结构。`,
    `${row.sector}成交额 ${formatMoney(row.turnover)}，样本 ${row.count} 只，上涨 ${row.upCount} 只，平均涨跌幅 ${formatPercent(row.avgPct)}。`,
    '成交额代表标的：',
    ...(leaders.length ? leaders : ['- 暂无可用标的。']),
    '请判断资金是在主线集中、轮动扩散还是单点异动，并给出应继续验证的聚宽资金/行业/成分字段。',
  ].join('\n');
}

function boardStructurePrompt(row: MarketBoardStat, quotes: ResearchQuote[], scopeLabel: string): string {
  const leaders = quotes
    .filter((quote) => normalizeBoardLabel(quote.board) === row.board)
    .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
    .slice(0, 8)
    .map((quote) => `- ${quote.name}（${quote.code}）：${quote.sector}，${formatPercent(quote.changePct)}，成交额 ${formatMoney(quoteTurnoverAmount(quote))}`);
  return [
    `请分析${scopeLabel}中的「${row.board}」市场分层。`,
    `${row.board}样本 ${row.count} 只，上涨 ${row.upCount} 只，平均涨跌幅 ${formatPercent(row.avgPct)}，成交额 ${formatMoney(row.turnover)}。`,
    '分层内异动标的：',
    ...(leaders.length ? leaders : ['- 暂无可用标的。']),
    '请判断风险偏好是否偏向成长/核心/小盘，并说明对选股和仓位的影响。',
  ].join('\n');
}

function activityRankPrompt(
  title: string,
  rows: ResearchQuote[],
  value: (quote: ResearchQuote) => string,
  promptMetric: string,
): string {
  const lines = rows.map((quote, index) =>
    `${index + 1}. ${quote.name}（${quote.code}）：${quote.sector}，${promptMetric} ${value(quote)}，涨跌幅 ${formatPercent(quote.changePct)}，成交额 ${formatMoney(quoteTurnoverAmount(quote))}`,
  );
  return [
    `请解读行情池「${title}」。`,
    ...(lines.length ? lines : ['暂无排行数据。']),
    '请识别主动资金、短线拥挤度和可能的回落风险，并给出可继续跟踪的触发条件。',
  ].join('\n');
}

function MarketStrengthList({
  title,
  rows,
  quotes,
  onFilterSector,
}: {
  title: string;
  rows: ReturnType<typeof computeSectorHeat>;
  quotes: ResearchQuote[];
  onFilterSector: (sector: string) => void;
}) {
  return (
    <div className="rw-strength-list">
      <strong>{title}</strong>
      {rows.map((row) => (
        <button
          key={`${title}-${row.sector}`}
          type="button"
          className={changeTone(row.avgPct)}
          style={{ ['--strength' as string]: Math.min(1, Math.abs(row.avgPct) / 4) }}
          draggable
          onDragStart={(event) => startNestedResearchDrag(event, sectorHeatPrompt(row, quotes))}
          onClick={() => onFilterSector(row.sector)}
        >
          <span>{row.sector}</span>
          <em>{row.count} 只</em>
          <i className={changeTone(row.avgPct)}>{formatPercent(row.avgPct)}</i>
        </button>
      ))}
    </div>
  );
}

function MarketMiniRank({
  title,
  rows,
  value,
  promptMetric,
  onSelect,
}: {
  title: string;
  rows: ResearchQuote[];
  value: (quote: ResearchQuote) => string;
  promptMetric: string;
  onSelect: (code: string | null) => void;
}) {
  return (
    <div className="rw-mini-rank">
      <strong
        draggable
        onDragStart={(event) =>
          startNestedResearchDrag(event, activityRankPrompt(title, rows, value, promptMetric))
        }
        title={`拖拽${title}到对话框`}
      >
        {title}
      </strong>
      {rows.map((quote) => (
        <button
          key={`${title}-${quote.code}`}
          type="button"
          draggable
          onDragStart={(event) => startNestedResearchDrag(event, securityPrompt(quote))}
          onClick={() => onSelect(quote.code)}
        >
          <span>{quote.name}</span>
          <em>{quote.sector}</em>
          <i className={promptMetric === '涨幅' ? changeTone(quote.changePct) : undefined}>{value(quote)}</i>
        </button>
      ))}
    </div>
  );
}

const TREEMAP_WIDTH = 1000;
const TREEMAP_HEIGHT = 620;
const TREEMAP_VIEW_OPTIONS: Array<{
  mode: TreemapViewMode;
  label: string;
  hint: string;
  maxSectors: number;
  maxStocks: number;
}> = [
  {
    mode: 'focus',
    label: '核心',
    hint: '成交额前 24 行业，每行业保留核心个股',
    maxSectors: 24,
    maxStocks: 5,
  },
  {
    mode: 'sectors',
    label: '板块',
    hint: '只看行业层，不展示个股碎片',
    maxSectors: 72,
    maxStocks: 0,
  },
  {
    mode: 'full',
    label: '细节',
    hint: '展开更多行业和少量代表个股',
    maxSectors: 120,
    maxStocks: 3,
  },
];

function quoteTreemapSize(quote: ResearchQuote): number {
  const turnover = quoteTurnoverAmount(quote);
  if (turnover > 0) return turnover;
  const marketCap = quote.marketCap > 0 ? quote.marketCap * 100_000_000 : 0;
  if (marketCap > 0) return marketCap;
  return 1;
}

function aggregateIndustryTreemap(quotes: ResearchQuote[]): IndustryTreemapSector[] {
  const groups = new Map<
    string,
    {
      totalPct: number;
      turnover: number;
      marketCap: number;
      sizeValue: number;
      upCount: number;
      downCount: number;
      quotes: ResearchQuote[];
    }
  >();
  for (const quote of quotes) {
    const group = groups.get(quote.sector) ?? {
      totalPct: 0,
      turnover: 0,
      marketCap: 0,
      sizeValue: 0,
      upCount: 0,
      downCount: 0,
      quotes: [],
    };
    group.totalPct += quote.changePct;
    group.turnover += quoteTurnoverAmount(quote);
    group.marketCap += quote.marketCap > 0 ? quote.marketCap * 100_000_000 : 0;
    group.sizeValue += quoteTreemapSize(quote);
    if (quote.changePct > 0) group.upCount += 1;
    if (quote.changePct < 0) group.downCount += 1;
    group.quotes.push(quote);
    groups.set(quote.sector, group);
  }
  return Array.from(groups.entries())
    .map(([sector, group]) => {
      const sortedQuotes = group.quotes
        .slice()
        .sort((a, b) => quoteTreemapSize(b) - quoteTreemapSize(a));
      return {
        sector,
        count: group.quotes.length,
        avgPct: group.quotes.length ? group.totalPct / group.quotes.length : 0,
        turnover: group.turnover,
        marketCap: group.marketCap,
        sizeValue: group.sizeValue || group.quotes.length,
        upCount: group.upCount,
        downCount: group.downCount,
        quotes: sortedQuotes,
      };
    })
    .sort((a, b) => b.sizeValue - a.sizeValue);
}

function industryTreemapPrompt(sectors: IndustryTreemapSector[], scopeLabel: string): string {
  const lines = sectors.slice(0, 12).map((sector, index) =>
    `${index + 1}. ${sector.sector}：${formatPercent(sector.avgPct)}，${sector.count} 只，成交额 ${formatMoney(sector.turnover)}，上涨 ${sector.upCount} / 下跌 ${sector.downCount}`,
  );
  return [
    `请解读${scopeLabel}行业热力树图。`,
    ...(lines.length ? lines : ['暂无行业热力数据。']),
    '请判断主线行业、轮动扩散、亏钱效应集中区，以及哪些行业需要进一步打开成分股验证。',
  ].join('\n');
}

function treemapRectStyle(node: HierarchyRectangularNode<IndustryTreemapDatum>): CSSProperties {
  return {
    left: `${(node.x0 / TREEMAP_WIDTH) * 100}%`,
    top: `${(node.y0 / TREEMAP_HEIGHT) * 100}%`,
    width: `${Math.max(0, ((node.x1 - node.x0) / TREEMAP_WIDTH) * 100)}%`,
    height: `${Math.max(0, ((node.y1 - node.y0) / TREEMAP_HEIGHT) * 100)}%`,
  };
}

function heatIntensity(value: number, max = 5): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.abs(value) / max);
}

function treemapHeatVars(value: number, max = 5): CSSProperties {
  const intensity = heatIntensity(value, max);
  return {
    ['--heat-strong' as string]: `${Math.round(38 + intensity * 44)}%`,
    ['--heat-soft' as string]: `${Math.round(18 + intensity * 34)}%`,
  };
}

function treemapModeConfig(mode: TreemapViewMode) {
  return TREEMAP_VIEW_OPTIONS.find((option) => option.mode === mode) ?? TREEMAP_VIEW_OPTIONS[0];
}

function IndustryHeatTreemap({
  quotes,
  sectorFilter,
  onFilterSector,
  onSelect,
}: {
  quotes: ResearchQuote[];
  sectorFilter: string | null;
  onFilterSector: (sector: string) => void;
  onSelect: (code: string | null) => void;
}) {
  const [viewMode, setViewMode] = useState<TreemapViewMode>('focus');
  const viewConfig = treemapModeConfig(viewMode);
  const sectors = useMemo(() => aggregateIndustryTreemap(quotes), [quotes]);
  const visibleSectors = useMemo(
    () => sectors.slice(0, Math.min(viewConfig.maxSectors, sectors.length)),
    [sectors, viewConfig.maxSectors],
  );
  const sectorByName = useMemo(
    () => new Map(sectors.map((sector) => [sector.sector, sector])),
    [sectors],
  );
  const strongestSectors = useMemo(
    () => [...sectors].sort((a, b) => b.avgPct - a.avgPct).slice(0, 3),
    [sectors],
  );
  const weakestSectors = useMemo(
    () => [...sectors].sort((a, b) => a.avgPct - b.avgPct).slice(0, 3),
    [sectors],
  );
  const tree = useMemo(() => {
    const data: IndustryTreemapDatum = {
      name: '行情池',
      type: 'root',
      value: visibleSectors.reduce((sum, sector) => sum + sector.sizeValue, 0),
      children: visibleSectors.map((sector) => {
        if (viewMode === 'sectors') {
          return {
            name: sector.sector,
            type: 'sectorSummary',
            sector: sector.sector,
            avgPct: sector.avgPct,
            count: sector.count,
            upCount: sector.upCount,
            downCount: sector.downCount,
            turnover: sector.turnover,
            value: sector.sizeValue,
          };
        }
        const primaryQuotes = sector.quotes.slice(0, viewConfig.maxStocks);
        const shownValue = primaryQuotes.reduce((sum, quote) => sum + quoteTreemapSize(quote), 0);
        const shownTurnover = primaryQuotes.reduce((sum, quote) => sum + quoteTurnoverAmount(quote), 0);
        const remainderCount = Math.max(0, sector.count - primaryQuotes.length);
        const remainderValue = Math.max(0, sector.sizeValue - shownValue);
        const remainderTurnover = Math.max(0, sector.turnover - shownTurnover);
        const children: IndustryTreemapDatum[] = primaryQuotes.map((quote) => ({
          name: quote.name,
          type: 'stock',
          sector: sector.sector,
          avgPct: quote.changePct,
          turnover: quoteTurnoverAmount(quote),
          value: quoteTreemapSize(quote),
          quote,
        }));
        if (remainderCount > 0 && remainderValue > 0) {
          children.push({
            name: `其余${remainderCount}只`,
            type: 'aggregate',
            sector: sector.sector,
            avgPct: sector.avgPct,
            count: remainderCount,
            upCount: sector.upCount,
            downCount: sector.downCount,
            turnover: remainderTurnover,
            value: remainderValue,
          });
        }
        return {
          name: sector.sector,
          type: 'sector',
          sector: sector.sector,
          avgPct: sector.avgPct,
          count: sector.count,
          turnover: sector.turnover,
          value: 0,
          children,
        };
      }),
    };
    const root = hierarchy<IndustryTreemapDatum>(data)
      .sum((node) =>
        node.type === 'stock' || node.type === 'aggregate' || node.type === 'sectorSummary'
          ? node.value
          : 0,
      )
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    return treemap<IndustryTreemapDatum>()
      .tile(treemapSquarify.ratio(1.18))
      .size([TREEMAP_WIDTH, TREEMAP_HEIGHT])
      .paddingOuter(2)
      .paddingTop((node) => (node.depth === 1 && node.data.type === 'sector' ? 24 : 0))
      .paddingInner(viewMode === 'sectors' ? 3 : 2)
      .round(true)(root);
  }, [viewConfig.maxStocks, viewMode, visibleSectors]);

  const sectorNodes = tree
    .descendants()
    .filter((node) => node.depth === 1 && node.data.type === 'sector');
  const summaryNodes = tree
    .leaves()
    .filter((node) => node.data.type === 'sectorSummary');
  const stockNodes = tree
    .leaves()
    .filter((node) => node.data.type === 'stock' && node.data.quote);
  const aggregateNodes = tree
    .leaves()
    .filter((node) => node.data.type === 'aggregate');
  const totalTurnover = visibleSectors.reduce((sum, sector) => sum + sector.turnover, 0);
  const prompt = industryTreemapPrompt(sectors, `行情池 ${quotes.length} 只股票`);

  if (!sectors.length) {
    return <div className="rw-treemap-empty">暂无可用于行业热力图的行情数据。</div>;
  }

  return (
    <div
      className="rw-heat-treemap"
      draggable
      onDragStart={(event) => startResearchDrag(event, prompt)}
      title="拖拽行业热力树图到对话框"
    >
      <div className="rw-treemap-toolbar">
        <div className="rw-treemap-mode" role="group" aria-label="热力图显示模式">
          {TREEMAP_VIEW_OPTIONS.map((option) => (
            <button
              key={option.mode}
              type="button"
              className={viewMode === option.mode ? 'active' : ''}
              aria-pressed={viewMode === option.mode}
              draggable={false}
              onClick={() => setViewMode(option.mode)}
              title={option.hint}
            >
              {option.label}
            </button>
          ))}
        </div>
        <span>{viewConfig.hint}</span>
      </div>
      <div className="rw-treemap-pulse" aria-label="强弱行业">
        <span>强势</span>
        {strongestSectors.map((sector) => (
          <button
            key={`strong-${sector.sector}`}
            type="button"
            className={changeTone(sector.avgPct)}
            draggable
            onDragStart={(event) => startNestedResearchDrag(event, sectorHeatPrompt({ sector: sector.sector, avgPct: sector.avgPct, count: sector.count }, quotes))}
            onClick={() => onFilterSector(sector.sector)}
            title={`${sector.sector} ${formatPercent(sector.avgPct)}，${sector.count} 只`}
          >
            {sector.sector} <b>{formatPercent(sector.avgPct)}</b>
          </button>
        ))}
        <span>弱势</span>
        {weakestSectors.map((sector) => (
          <button
            key={`weak-${sector.sector}`}
            type="button"
            className={changeTone(sector.avgPct)}
            draggable
            onDragStart={(event) => startNestedResearchDrag(event, sectorHeatPrompt({ sector: sector.sector, avgPct: sector.avgPct, count: sector.count }, quotes))}
            onClick={() => onFilterSector(sector.sector)}
            title={`${sector.sector} ${formatPercent(sector.avgPct)}，${sector.count} 只`}
          >
            {sector.sector} <b>{formatPercent(sector.avgPct)}</b>
          </button>
        ))}
      </div>
      <div className="rw-treemap-canvas" role="img" aria-label="行业热力树图">
        {sectorNodes.map((node) => {
          const sector = node.data.sector ? sectorByName.get(node.data.sector) : undefined;
          if (!sector) return null;
          const width = node.x1 - node.x0;
          const height = node.y1 - node.y0;
          if (width < 104 || height < 52) return null;
          return (
            <button
              key={`sector-${sector.sector}`}
              type="button"
              className={`rw-treemap-sector ${changeTone(sector.avgPct)} ${sectorFilter === sector.sector ? 'active' : ''}`}
              style={{
                ...treemapRectStyle(node),
                height: `${(Math.min(22, height) / TREEMAP_HEIGHT) * 100}%`,
                ...treemapHeatVars(sector.avgPct),
              }}
              draggable
              onDragStart={(event) =>
                startNestedResearchDrag(
                  event,
                  sectorHeatPrompt({ sector: sector.sector, avgPct: sector.avgPct, count: sector.count }, quotes),
                )
              }
              onClick={() => onFilterSector(sector.sector)}
              title={`${sector.sector} ${formatPercent(sector.avgPct)}，${sector.count} 只`}
            >
              <span>{sector.sector}</span>
              <strong>{formatPercent(sector.avgPct)}</strong>
            </button>
          );
        })}
        {summaryNodes.map((node) => {
          const sector = node.data.sector ? sectorByName.get(node.data.sector) : undefined;
          if (!sector) return null;
          const width = node.x1 - node.x0;
          const height = node.y1 - node.y0;
          const tiny = width < 96 || height < 44;
          const compact = width < 150 || height < 74;
          return (
            <button
              key={`summary-${sector.sector}`}
              type="button"
              className={`rw-treemap-leaf summary ${changeTone(sector.avgPct)} ${tiny ? 'tiny' : ''} ${sectorFilter === sector.sector ? 'active-sector' : ''}`}
              style={{
                ...treemapRectStyle(node),
                ...treemapHeatVars(sector.avgPct),
              }}
              draggable
              onDragStart={(event) => startNestedResearchDrag(event, sectorHeatPrompt({ sector: sector.sector, avgPct: sector.avgPct, count: sector.count }, quotes))}
              onClick={() => onFilterSector(sector.sector)}
              title={`${sector.sector} ${formatPercent(sector.avgPct)}，上涨 ${sector.upCount} / 下跌 ${sector.downCount}，成交额 ${formatMoney(sector.turnover)}`}
            >
              {!tiny && <span>{sector.sector}</span>}
              {!tiny && <strong>{formatPercent(sector.avgPct)}</strong>}
              {!tiny && !compact && <em>{sector.count} 只 · {formatMoney(sector.turnover)}</em>}
            </button>
          );
        })}
        {stockNodes.map((node) => {
          const quote = node.data.quote;
          if (!quote) return null;
          const width = node.x1 - node.x0;
          const height = node.y1 - node.y0;
          const tiny = width < 76 || height < 36;
          const compact = width < 116 || height < 58;
          return (
            <button
              key={`stock-${quote.code}`}
              type="button"
              className={`rw-treemap-leaf ${changeTone(quote.changePct)} ${tiny ? 'tiny' : ''} ${sectorFilter === quote.sector ? 'active-sector' : ''}`}
              style={{
                ...treemapRectStyle(node),
                ...treemapHeatVars(quote.changePct, 6),
              }}
              draggable
              onDragStart={(event) => startNestedResearchDrag(event, securityPrompt(quote))}
              onClick={() => onSelect(quote.code)}
              title={`${quote.name} ${formatPercent(quote.changePct)}，成交额 ${formatMoney(quoteTurnoverAmount(quote))}`}
            >
              {!tiny && <span>{quote.name}</span>}
              {!tiny && <strong>{formatPercent(quote.changePct)}</strong>}
              {!tiny && !compact && <em>{formatMoney(quoteTurnoverAmount(quote))}</em>}
            </button>
          );
        })}
        {aggregateNodes.map((node) => {
          const width = node.x1 - node.x0;
          const height = node.y1 - node.y0;
          const tiny = width < 86 || height < 38;
          const compact = width < 128 || height < 58;
          const sector = node.data.sector ? sectorByName.get(node.data.sector) : undefined;
          return (
            <button
              key={`aggregate-${node.data.sector}`}
              type="button"
              className={`rw-treemap-leaf aggregate ${changeTone(node.data.avgPct ?? 0)} ${tiny ? 'tiny' : ''} ${sectorFilter === node.data.sector ? 'active-sector' : ''}`}
              style={{
                ...treemapRectStyle(node),
                ...treemapHeatVars(node.data.avgPct ?? 0),
              }}
              draggable
              onDragStart={(event) =>
                sector &&
                startNestedResearchDrag(
                  event,
                  sectorHeatPrompt({ sector: sector.sector, avgPct: sector.avgPct, count: sector.count }, quotes),
                )
              }
              onClick={() => node.data.sector && onFilterSector(node.data.sector)}
              title={`${node.data.sector} ${node.data.name}，成交额 ${formatMoney(node.data.turnover ?? 0)}`}
            >
              {!tiny && <span>{node.data.name}</span>}
              {!tiny && <strong>{formatPercent(node.data.avgPct ?? 0)}</strong>}
              {!tiny && !compact && <em>{formatMoney(node.data.turnover ?? 0)}</em>}
            </button>
          );
        })}
      </div>
      <div className="rw-treemap-footer">
        <span>面积：成交额</span>
        <span>颜色：涨跌幅</span>
        <em>展示 {visibleSectors.length}/{sectors.length} 行业 · 成交额 {formatMoney(totalTurnover)}</em>
      </div>
    </div>
  );
}

function RealDataEmptyState({
  refreshing,
  error,
  onRefresh,
}: {
  refreshing: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  const title = refreshing ? '正在读取真实行情' : '未获取到真实行情';
  const detail = error || '东方财富实时与聚宽日线都没有返回可用报价，工作台不会用样例数据替代真实行情。';

  return (
    <section className="rw-section rw-real-empty" aria-label="真实数据状态">
      <header>
        <Database size={18} />
        <strong>{title}</strong>
      </header>
      <p>{detail}</p>
      {error?.includes('账号无有效权限') && (
        <p>
          当前聚宽账号没有返回可用的数据调用权限。请在设置里测试 SDK/RPC 连接，或确认账号权限仍然有效。
        </p>
      )}
      <button type="button" className="rw-btn ghost" onClick={onRefresh} disabled={refreshing}>
        {refreshing ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />}
        重新读取真实行情
      </button>
    </section>
  );
}

function FullMarketTab({
  state,
  quotes,
  loading,
  error,
  asOfLabel,
  jqReady,
  onRefresh,
  onToggleWatch,
  onTrade,
}: {
  state: ResearchState;
  quotes: ResearchQuote[];
  loading: boolean;
  error: string | null;
  asOfLabel: string | null;
  jqReady: boolean;
  onRefresh: () => void;
  onToggleWatch: (quote: ResearchQuote) => void;
  onTrade: (quote: ResearchQuote, prefill: TradePrefill) => void;
}) {
  const [sectorFilter, setSectorFilter] = useState<string | null>(null);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const scopedQuotes = useMemo(
    () => (sectorFilter ? quotes.filter((quote) => quote.sector === sectorFilter) : quotes),
    [quotes, sectorFilter],
  );
  const overview = useMemo(() => computeMarketOverview(scopedQuotes), [scopedQuotes]);
  const fullHeatTiles = useMemo(() => computeSectorHeat(quotes), [quotes]);
  const scopedHeatTiles = useMemo(() => computeSectorHeat(scopedQuotes), [scopedQuotes]);
  const selected = selectedCode ? quotes.find((quote) => quote.code === selectedCode) ?? null : null;

  if (!quotes.length) {
    return (
      <div className="rw-tab-page">
        <RealDataEmptyState refreshing={loading} error={error} onRefresh={onRefresh} />
      </div>
    );
  }

  return (
    <div className="rw-tab-page">
      {sectorFilter && (
        <div className="rw-filter-note">
          <span>当前筛选：{sectorFilter} · {scopedQuotes.length} 只</span>
          <button type="button" onClick={() => setSectorFilter(null)}>全部行情</button>
        </div>
      )}
      <FullMarketDashboard
        quotes={scopedQuotes}
        allQuotes={quotes}
        overview={overview}
        heatTiles={scopedHeatTiles}
        sectorFilter={sectorFilter}
        asOfLabel={asOfLabel}
        onFilterSector={setSectorFilter}
        onSelect={setSelectedCode}
      />
      <MarketSnapshotPanel
        quotes={scopedQuotes}
        heatPromptQuotes={quotes}
        overview={overview}
        heatTiles={sectorFilter ? scopedHeatTiles : fullHeatTiles}
        dataError={error}
        dataAsOfDate={asOfLabel}
        marketDataSource="eastmoney"
        liveQuoteCount={scopedQuotes.length}
        onSelect={setSelectedCode}
        onFilterSector={setSectorFilter}
      />

      <section className="rw-section" aria-label="行业热力图">
        <header className="rw-section-head">
          <span>行业热力图</span>
          <em>D3 treemap · 行情池 {quotes.length} 只</em>
        </header>
        <IndustryHeatTreemap
          quotes={quotes}
          sectorFilter={sectorFilter}
          onFilterSector={(sector) => setSectorFilter(sectorFilter === sector ? null : sector)}
          onSelect={setSelectedCode}
        />
      </section>

      <section className="rw-section" aria-label="涨跌分布">
        <header className="rw-section-head">
          <span>涨跌分布</span>
          <em>{sectorFilter ? `${sectorFilter} ` : '行情池 '}{scopedQuotes.length} 只</em>
        </header>
        <DistributionChart
          overview={overview}
          scopeLabel={sectorFilter ? `${sectorFilter} ${scopedQuotes.length} 只股票` : `行情池 ${scopedQuotes.length} 只股票`}
        />
      </section>

      {selected && (
        <StockDetailCard
          quote={selected}
          jqReady={jqReady}
          watched={state.watchlist.includes(selected.code)}
          held={state.holdings.some((item) => item.code === selected.code)}
          onClose={() => setSelectedCode(null)}
          onToggleWatch={() => onToggleWatch(selected)}
          onTrade={(prefill) => onTrade(selected, prefill)}
        />
      )}
    </div>
  );
}

function SnapshotList({
  title,
  rows,
  metric,
  onSelect,
}: {
  title: string;
  rows: ResearchQuote[];
  metric: 'turnover' | 'change';
  onSelect: (code: string | null) => void;
}) {
  return (
    <div className="rw-snapshot-list">
      <strong
        draggable
        onDragStart={(event) => startNestedResearchDrag(event, rankListPrompt(title, rows, metric))}
        title={`拖拽${title}榜单到对话框`}
      >
        {title}
      </strong>
      {rows.map((quote) => (
        <button
          key={quote.code}
          type="button"
          draggable
          onDragStart={(event) => startNestedResearchDrag(event, securityPrompt(quote))}
          onClick={() => onSelect(quote.code)}
        >
          <span>{quote.name}</span>
          <em>{quote.sector}</em>
          <i className={changeTone(quote.changePct)}>
            {metric === 'turnover'
              ? formatMoney(quote.turnover * 100000000)
              : formatPercent(quote.changePct)}
          </i>
        </button>
      ))}
    </div>
  );
}

function median(values: number[]): number {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[midpoint - 1] + sorted[midpoint]) / 2
    : sorted[midpoint];
}

function StockRow({
  quote,
  watched,
  active,
  onClick,
  onToggleWatch,
}: {
  quote: ResearchQuote;
  watched: boolean;
  active?: boolean;
  onClick: () => void;
  onToggleWatch: () => void;
}) {
  const tone = changeTone(quote.changePct);
  return (
    <article
      className={`rw-stock-row ${active ? 'active' : ''}`}
      draggable
      onDragStart={(event) => startResearchDrag(event, securityPrompt(quote))}
    >
      <button type="button" className="rw-stock-main" onClick={onClick}>
        <span className="rw-stock-name">
          <strong>{quote.name}</strong>
          <em>
            {shortCode(quote.code)} · {quote.sector}
            {quote.source !== 'sample' && <i className="rw-live-dot" title={realQuoteSourceLabel(quote.source)} />}
          </em>
        </span>
        <span className="rw-stock-price">
          <strong className={tone}>{quote.price >= 1000 ? quote.price.toFixed(1) : quote.price.toFixed(2)}</strong>
          <em>{formatMoney(quote.turnover * 100000000)}</em>
        </span>
        <span className={`rw-change-pill ${tone}`}>{formatPercent(quote.changePct)}</span>
      </button>
      <button
        type="button"
        className={`rw-star ${watched ? 'active' : ''}`}
        onClick={onToggleWatch}
        aria-label={watched ? `将 ${quote.name} 移出自选` : `将 ${quote.name} 加入自选`}
        title={watched ? '移出自选' : '加入自选'}
      >
        <Star size={13} />
      </button>
    </article>
  );
}

function StockDetailCard({
  quote,
  jqReady,
  watched,
  held,
  onClose,
  onToggleWatch,
  onTrade,
}: {
  quote: ResearchQuote;
  jqReady: boolean;
  watched: boolean;
  held: boolean;
  onClose: () => void;
  onToggleWatch: () => void;
  onTrade: (prefill: TradePrefill) => void;
}) {
  const [liveBars, setLiveBars] = useState<ResearchBar[] | null>(null);
  const [loadingBars, setLoadingBars] = useState(false);
  const [profile, setProfile] = useState<JqSecurityProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [ticks, setTicks] = useState<EastmoneyTick[] | null>(null);
  const [loadingTicks, setLoadingTicks] = useState(false);
  const [tickError, setTickError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setTicks(null);
    setTickError(null);
    setLoadingTicks(true);
    void fetchEastmoneyTicks(quote.code, 20)
      .then((next) => {
        if (!cancelled) setTicks(next);
      })
      .catch((error) => {
        if (!cancelled) setTickError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setLoadingTicks(false);
      });
    return () => {
      cancelled = true;
    };
  }, [quote.code]);

  useEffect(() => {
    let cancelled = false;
    setLiveBars(null);
    setProfile(null);
    if (!jqReady) return;
    setLoadingBars(true);
    void fetchJqDailyBars(quote.code, 60)
      .then((bars) => {
        if (!cancelled && bars?.length) setLiveBars(bars);
      })
      .finally(() => {
        if (!cancelled) setLoadingBars(false);
      });
    setLoadingProfile(true);
    void fetchJqSecurityProfile(quote.code)
      .then((next) => {
        if (!cancelled) setProfile(next);
      })
      .finally(() => {
        if (!cancelled) setLoadingProfile(false);
      });
    return () => {
      cancelled = true;
    };
  }, [quote.code, jqReady]);

  const bars = useMemo(() => liveBars ?? [], [liveBars]);
  const tone = changeTone(quote.changePct);

  return (
    <section
      className="rw-detail-card"
      aria-label={`${quote.name} 详情`}
      draggable
      onDragStart={(event) => startResearchDrag(event, securityPrompt(quote))}
    >
      <header className="rw-detail-head">
        <div className="rw-detail-title">
          <strong>{quote.name}</strong>
          <em>
            {quote.code} · {quote.board} · {quote.sector}
          </em>
        </div>
        <button type="button" className="rw-icon-btn" onClick={onClose} aria-label="关闭详情">
          <X size={14} />
        </button>
      </header>
      <div className="rw-detail-price">
        <strong className={tone}>{quote.price.toFixed(2)}</strong>
        <span className={tone}>
          {formatSignedMoney(quote.changeAmt)} {formatPercent(quote.changePct)}
        </span>
        <em>
          {liveBars ? '聚宽日线' : loadingBars ? '加载聚宽日线…' : '日线未返回'} · 60 交易日
        </em>
      </div>
      {bars.length > 0 ? (
        <CandleChart bars={bars} dragPrompt={quoteCandlePrompt(quote, bars)} />
      ) : (
        <div className="rw-real-chart-empty">
          {loadingBars ? '正在读取聚宽 60 日 K 线…' : '聚宽未返回 60 日 K 线，当前不展示替代行情。'}
        </div>
      )}
      <dl className="rw-detail-stats">
        <div><dt>最高</dt><dd>{quote.high.toFixed(2)}</dd></div>
        <div><dt>最低</dt><dd>{quote.low.toFixed(2)}</dd></div>
        <div><dt>成交额</dt><dd>{formatMoney(quote.turnover * 100000000)}</dd></div>
        <div><dt>总市值</dt><dd>{formatMoney(quote.marketCap * 100000000)}</dd></div>
        {quote.highLimit && <div><dt>涨停</dt><dd>{quote.highLimit.toFixed(2)}</dd></div>}
        {quote.lowLimit && <div><dt>跌停</dt><dd>{quote.lowLimit.toFixed(2)}</dd></div>}
        {quote.paused && <div><dt>状态</dt><dd>停牌</dd></div>}
      </dl>
      <EastmoneyTickTape quote={quote} loading={loadingTicks} ticks={ticks} error={tickError} />
      <JqProfileCard quote={quote} jqReady={jqReady} loading={loadingProfile} profile={profile} />
      {quote.thesis && <p className="rw-detail-thesis">{quote.thesis}</p>}
      <div className="rw-detail-actions">
        <button type="button" className="rw-btn buy" onClick={() => onTrade({ side: 'buy', code: quote.code, price: quote.price })}>
          买入
        </button>
        <button
          type="button"
          className="rw-btn sell"
          disabled={!held}
          title={held ? undefined : '暂无持仓可卖'}
          onClick={() => onTrade({ side: 'sell', code: quote.code, price: quote.price })}
        >
          卖出
        </button>
        <button type="button" className={`rw-btn ghost ${watched ? 'active' : ''}`} onClick={onToggleWatch}>
          <Star size={13} />
          {watched ? '已自选' : '加自选'}
        </button>
      </div>
    </section>
  );
}

function EastmoneyTickTape({
  quote,
  loading,
  ticks,
  error,
}: {
  quote: ResearchQuote;
  loading: boolean;
  ticks: EastmoneyTick[] | null;
  error: string | null;
}) {
  const rows = ticks?.length ? [...ticks].reverse().slice(0, 8) : [];
  if (!loading && !error && !rows.length) return null;
  const dragPrompt = stockTickPrompt(quote, rows);
  return (
    <div
      className="rw-tick-card"
      draggable
      onDragStart={(event) => startNestedResearchDrag(event, dragPrompt)}
      title="拖拽分笔成交到对话框"
    >
      <header>
        <strong>分笔成交</strong>
        <em>{loading ? '读取中' : rows.length ? '东方财富实时' : '未返回'}</em>
      </header>
      {rows.length > 0 ? (
        <div className="rw-tick-list">
          {rows.map((tick, index) => {
            const tone = tick.side === '买盘' ? 'up' : tick.side === '卖盘' ? 'down' : 'flat';
            return (
              <span
                key={`${tick.time}-${index}`}
                draggable
                onDragStart={(event) => {
                  startNestedResearchDrag(
                    event,
                    stockTickPrompt(quote, [tick]),
                  );
                }}
              >
                <em>{tick.time}</em>
                <strong className={tone}>{tick.price.toFixed(2)}</strong>
                <i>{tick.volumeHands ? `${tick.volumeHands.toFixed(0)}手` : '-'}</i>
                <b className={tone}>{tick.side ?? '中性'}</b>
              </span>
            );
          })}
        </div>
      ) : (
        <p>{loading ? '正在读取东方财富最近分笔成交…' : error || '东方财富未返回最近分笔成交。'}</p>
      )}
    </div>
  );
}

function JqProfileCard({
  quote,
  jqReady,
  loading,
  profile,
}: {
  quote: ResearchQuote;
  jqReady: boolean;
  loading: boolean;
  profile: JqSecurityProfile | null;
}) {
  if (!jqReady) {
    return null;
  }

  if (loading) {
    return (
      <section className="rw-profile-card muted" aria-label="资金与风控数据">
        <strong><Loader2 size={12} className="spin" /> 正在读取资金与风控数据</strong>
        <span>读取聚宽资金流、融资融券、行业归属和限售解禁。</span>
      </section>
    );
  }

  if (!profile) {
    return (
      <section className="rw-profile-card muted" aria-label="资金与风控数据">
        <strong>资金与风控</strong>
        <span>聚宽未返回可用资金/两融数据，请在设置中测试 JQData 连接。</span>
      </section>
    );
  }

  const moneyFlow = profile.moneyFlow;
  const mtss = profile.mtss;
  const locked = profile.lockedShares;
  const warning = compactProfileWarning(profile.warnings);
  const rows: Array<{ label: string; value: string; meta: string; tone?: 'up' | 'down' | 'flat' }> = [];

  if (profile.info?.type || profile.info?.startDate || profile.info?.endDate) {
    rows.push({
      label: '证券档案',
      value: profile.info?.type || '证券',
      meta: [
        profile.info?.startDate ? `上市 ${profile.info.startDate}` : '',
        profile.info?.endDate ? `退市 ${profile.info.endDate}` : '',
      ].filter(Boolean).join(' · ') || profile.info?.displayName || '聚宽返回',
    });
  }
  if (profile.industryNames.length) {
    rows.push({
      label: '行业归属',
      value: profile.industryNames.join(' / '),
      meta: `${profile.industryNames.length} 个口径`,
    });
  }
  if (moneyFlow?.latestMainNetAmount !== null && moneyFlow?.latestMainNetAmount !== undefined) {
    rows.push({
      label: '主力净流',
      value: formatMoney(moneyFlow.latestMainNetAmount * 10000),
      meta: `${moneyFlow.latestDate || '最新交易日'} · ${moneyFlow.rows} 条`,
      tone: changeTone(moneyFlow.latestMainNetAmount),
    });
  }
  if (moneyFlow?.fiveDayMainNetAmount !== null && moneyFlow?.fiveDayMainNetAmount !== undefined) {
    rows.push({
      label: '5 日主力净流',
      value: formatMoney(moneyFlow.fiveDayMainNetAmount * 10000),
      meta:
        moneyFlow.latestMainNetPct === null || moneyFlow.latestMainNetPct === undefined
          ? '占比缺失'
          : `最新占比 ${formatPercent(moneyFlow.latestMainNetPct)} · ${moneyFlow.rows} 条`,
      tone: changeTone(moneyFlow.fiveDayMainNetAmount),
    });
  }
  if (mtss?.finValue !== null && mtss?.finValue !== undefined) {
    rows.push({
      label: '融资余额',
      value: formatMoney(mtss.finValue),
      meta: `${mtss.latestDate || '最新交易日'} · ${mtss.rows} 条`,
    });
  }
  if (mtss?.secValue !== null && mtss?.secValue !== undefined) {
    rows.push({
      label: '融券余额',
      value: formatMoney(mtss.secValue),
      meta:
        mtss.finBuyValue === null || mtss.finBuyValue === undefined
          ? '融资买入缺失'
          : `融资买入 ${formatMoney(mtss.finBuyValue)}`,
    });
  }
  if (mtss?.finRefundValue !== null && mtss?.finRefundValue !== undefined) {
    rows.push({
      label: '融资偿还',
      value: formatMoney(mtss.finRefundValue),
      meta: mtss.latestDate || '最新交易日',
    });
  }
  if (locked?.lockedShares !== null && locked?.lockedShares !== undefined) {
    rows.push({
      label: '后续解禁',
      value: formatMoney(locked.lockedShares),
      meta: [
        locked.nextDate || '后续日期',
        locked.shareRate === null || locked.shareRate === undefined ? '' : `占比 ${formatPercent(locked.shareRate)}`,
        `${locked.rows} 条`,
      ].filter(Boolean).join(' · '),
    });
  }

  if (!rows.length) {
    if (!warning) return null;
    return (
      <section className="rw-profile-card muted" aria-label="资金与风控数据">
        <strong>资金与风控</strong>
        <span>{warning}</span>
      </section>
    );
  }

  return (
    <section
      className="rw-profile-card"
      aria-label="资金与风控数据"
      draggable
      onDragStart={(event) => startNestedResearchDrag(event, profilePrompt(quote, profile))}
      title="拖拽聚宽资金与风控画像到对话框"
    >
      <header>
        <strong>资金与风控</strong>
        <em>聚宽按需数据</em>
      </header>
      <div className="rw-profile-grid">
        {rows.map((row) => (
          <article
            key={`${row.label}-${row.value}`}
            draggable
            onDragStart={(event) =>
              startNestedResearchDrag(event, profileMetricPrompt(quote, row.label, row.value, row.meta))
            }
          >
            <span>{row.label}</span>
            <strong className={row.tone}>{row.value}</strong>
            <em>{row.meta}</em>
          </article>
        ))}
      </div>
      {warning && (
        <div className="rw-profile-gaps">
          <span>{warning}</span>
        </div>
      )}
    </section>
  );
}

function compactProfileWarning(warnings: string[]): string | null {
  const unique = Array.from(new Set(warnings.filter(Boolean)));
  if (!unique.length) return null;
  const auth = unique.find((warning) => warning.includes('认证失败') || warning.includes('账号') || warning.includes('权限'));
  if (auth) return '聚宽资金/行业数据未读取成功：认证失败或权限不足，请在设置中测试 JQData 连接。';
  const noRecord = unique.every((warning) => warning.includes('暂无记录') || warning.includes('无记录'));
  if (noRecord) return null;
  return unique[0];
}

interface CandleChartSnapshot {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  ma5?: number;
}

function chartCssVar(element: HTMLElement, name: string, fallback: string) {
  return getComputedStyle(element).getPropertyValue(name).trim() || fallback;
}

function chartTimeKey(time: Time | undefined) {
  if (!time) return '';
  if (typeof time === 'string' || typeof time === 'number') return String(time);
  return `${time.year}-${String(time.month).padStart(2, '0')}-${String(time.day).padStart(2, '0')}`;
}

function chartPrice(value: number) {
  return value.toFixed(2);
}

function buildMa5Data(view: ResearchBar[]): LineData[] {
  const ma5: LineData[] = [];
  for (let i = 4; i < view.length; i += 1) {
    const value = view.slice(i - 4, i + 1).reduce((sum, bar) => sum + bar.close, 0) / 5;
    ma5.push({ time: view[i].date, value });
  }
  return ma5;
}

function snapshotFromBar(bar: ResearchBar, ma5?: number): CandleChartSnapshot {
  return {
    date: bar.date,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    ma5,
  };
}

function CandleChart({ bars, dragPrompt }: { bars: ResearchBar[]; dragPrompt?: string }) {
  const chartHostRef = useRef<HTMLDivElement | null>(null);
  const view = useMemo(() => bars.slice(-60), [bars]);
  const candleData = useMemo<CandlestickData[]>(() => view.map((bar) => ({
    time: bar.date,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
  })), [view]);
  const ma5Data = useMemo(() => buildMa5Data(view), [view]);
  const barsByDate = useMemo(() => new Map(view.map((bar) => [bar.date, bar])), [view]);
  const ma5ByDate = useMemo(() => new Map(ma5Data.map((item) => [chartTimeKey(item.time), item.value])), [ma5Data]);
  const latestSnapshot = useMemo(() => {
    const latest = view[view.length - 1];
    return latest ? snapshotFromBar(latest, ma5ByDate.get(latest.date)) : null;
  }, [ma5ByDate, view]);
  const [snapshot, setSnapshot] = useState<CandleChartSnapshot | null>(latestSnapshot);

  useEffect(() => {
    setSnapshot(latestSnapshot);
  }, [latestSnapshot]);

  useEffect(() => {
    const host = chartHostRef.current;
    if (!host || !candleData.length || typeof ResizeObserver === 'undefined') return undefined;

    const upColor = chartCssVar(host, '--rw-up', '#d92d2d');
    const downColor = chartCssVar(host, '--rw-down', '#14804a');
    const textColor = chartCssVar(host, '--rw-chart-text', '#8a8f98');
    const borderColor = chartCssVar(host, '--rw-chart-border', 'rgba(0, 0, 0, 0.08)');
    const gridColor = chartCssVar(host, '--rw-chart-grid', 'rgba(0, 0, 0, 0.06)');
    const bgColor = chartCssVar(host, '--rw-chart-bg', '#ffffff');
    const warningColor = chartCssVar(host, '--warning', '#d5a552');

    const chart = createChart(host, {
      autoSize: true,
      height: 178,
      layout: {
        background: { type: ColorType.Solid, color: bgColor },
        textColor,
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", system-ui, sans-serif',
        fontSize: 10,
      },
      grid: {
        vertLines: { color: gridColor, style: LineStyle.Dotted },
        horzLines: { color: gridColor, style: LineStyle.Dotted },
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.16, bottom: 0.16 },
      },
      leftPriceScale: { visible: false },
      timeScale: {
        borderColor,
        borderVisible: false,
        rightOffset: 5,
        barSpacing: 7,
        minBarSpacing: 3,
        timeVisible: false,
        secondsVisible: false,
      },
      crosshair: {
        mode: CrosshairMode.MagnetOHLC,
        vertLine: {
          color: textColor,
          labelBackgroundColor: textColor,
          style: LineStyle.Dashed,
          width: 1,
        },
        horzLine: {
          color: textColor,
          labelBackgroundColor: textColor,
          style: LineStyle.Dashed,
          width: 1,
        },
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
      handleScale: {
        mouseWheel: true,
        pinch: true,
        axisPressedMouseMove: true,
        axisDoubleClickReset: true,
      },
      localization: {
        locale: 'zh-CN',
        dateFormat: 'yyyy-MM-dd',
        priceFormatter: chartPrice,
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor,
      downColor,
      borderUpColor: upColor,
      borderDownColor: downColor,
      wickUpColor: upColor,
      wickDownColor: downColor,
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
      priceLineColor: upColor,
      priceLineStyle: LineStyle.Dashed,
    });
    candleSeries.setData(candleData);

    const ma5Series = chart.addSeries(LineSeries, {
      color: warningColor,
      lineWidth: 1,
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
    });
    ma5Series.setData(ma5Data);
    chart.timeScale().fitContent();

    const handleCrosshairMove = (param: MouseEventParams<Time>) => {
      const date = chartTimeKey(param.time);
      const bar = barsByDate.get(date);
      if (!bar) {
        setSnapshot(latestSnapshot);
        return;
      }
      setSnapshot(snapshotFromBar(bar, ma5ByDate.get(date)));
    };

    chart.subscribeCrosshairMove(handleCrosshairMove);
    return () => {
      chart.unsubscribeCrosshairMove(handleCrosshairMove);
      chart.remove();
    };
  }, [barsByDate, candleData, latestSnapshot, ma5ByDate, ma5Data]);

  if (!view.length) return null;

  return (
    <div
      className="rw-candle-chart"
      role="img"
      aria-label="交互式日 K 线图"
      draggable={Boolean(dragPrompt)}
      onDragStart={dragPrompt ? (event) => startNestedResearchDrag(event, dragPrompt) : undefined}
      title={dragPrompt ? '拖拽日线图到对话框' : undefined}
    >
      {snapshot && (
        <div className="rw-chart-legend" aria-hidden="true">
          <span>{snapshot.date}</span>
          <span>开 {chartPrice(snapshot.open)}</span>
          <span>高 {chartPrice(snapshot.high)}</span>
          <span>低 {chartPrice(snapshot.low)}</span>
          <span>收 {chartPrice(snapshot.close)}</span>
          {snapshot.ma5 !== undefined && <span className="rw-chart-ma">MA5 {chartPrice(snapshot.ma5)}</span>}
        </div>
      )}
      <div ref={chartHostRef} className="rw-candle-host" />
    </div>
  );
}

function DistributionChart({
  overview,
  scopeLabel,
}: {
  overview: ReturnType<typeof computeMarketOverview>;
  scopeLabel: string;
}) {
  const maxCount = Math.max(1, ...overview.buckets.map((bucket) => bucket.count));
  const total = overview.upCount + overview.downCount + overview.flatCount || 1;
  return (
    <div
      className="rw-distribution"
      draggable
      onDragStart={(event) => startResearchDrag(event, distributionPrompt(overview, scopeLabel))}
      title="拖拽涨跌分布到对话框"
    >
      <div className="rw-distribution-bars">
        {overview.buckets.map((bucket) => (
          <div key={bucket.id} className={`rw-distribution-col ${bucket.tone}`}>
            <span className="rw-distribution-count">{bucket.count}</span>
            <span
              className="rw-distribution-bar"
              style={{ height: `${Math.max(3, (bucket.count / maxCount) * 56)}px` }}
            />
            <span className="rw-distribution-label">{bucket.label}</span>
          </div>
        ))}
      </div>
      <div className="rw-distribution-summary">
        <span className="down">下跌 {overview.downCount}</span>
        <span className="rw-distribution-meter">
          <i className="down" style={{ flexGrow: overview.downCount / total || 0.001 }} />
          <i className="flat" style={{ flexGrow: overview.flatCount / total || 0.001 }} />
          <i className="up" style={{ flexGrow: overview.upCount / total || 0.001 }} />
        </span>
        <span className="up">上涨 {overview.upCount}</span>
      </div>
    </div>
  );
}

// ---- 自选 --------------------------------------------------------------------

function WatchlistTab({
  state,
  quotes,
  onToggleWatch,
  onDetail,
  onTrade,
}: {
  state: ResearchState;
  quotes: Map<string, ResearchQuote>;
  onToggleWatch: (code: string) => void;
  onDetail: (code: string) => void;
  onTrade: (prefill: TradePrefill) => void;
}) {
  const rows = state.watchlist
    .map((code) => quotes.get(code))
    .filter((quote): quote is ResearchQuote => Boolean(quote));

  return (
    <div className="rw-tab-page">
      <section className="rw-section" aria-label="自选股">
        <header className="rw-section-head">
          <span>自选股</span>
          <span
            className="rw-drag-chip"
            draggable
            onDragStart={(event) => startResearchDrag(event, watchlistPrompt(rows))}
            title="拖拽整份自选清单到对话框"
          >
            <GripVertical size={12} />
            整份拖给 Agent
          </span>
        </header>
        <div className="rw-stock-list">
          {rows.map((quote) => (
            <article
              key={quote.code}
              className="rw-stock-row"
              draggable
              onDragStart={(event) => startResearchDrag(event, securityPrompt(quote))}
            >
              <button type="button" className="rw-stock-main" onClick={() => onDetail(quote.code)}>
                <span className="rw-stock-name">
                  <strong>{quote.name}</strong>
                  <em>
                    {shortCode(quote.code)} · {quote.sector}
                    {quote.source !== 'sample' && <i className="rw-live-dot" title={realQuoteSourceLabel(quote.source)} />}
                  </em>
                </span>
                <span className="rw-stock-price">
                  <strong className={changeTone(quote.changePct)}>{quote.price.toFixed(2)}</strong>
                  <em>{formatSignedMoney(quote.changeAmt)}</em>
                </span>
                <span className={`rw-change-pill ${changeTone(quote.changePct)}`}>
                  {formatPercent(quote.changePct)}
                </span>
              </button>
              <div className="rw-row-actions">
                <button type="button" onClick={() => onTrade({ side: 'buy', code: quote.code, price: quote.price })}>
                  买
                </button>
                <button
                  type="button"
                  onClick={() => onToggleWatch(quote.code)}
                  aria-label={`将 ${quote.name} 移出自选`}
                  title="移出自选"
                >
                  <X size={12} />
                </button>
              </div>
            </article>
          ))}
          {rows.length === 0 && (
            <div className="rw-empty">
              {state.watchlist.length
                ? '自选标的尚未拿到真实行情，请刷新或检查聚宽权限。'
                : '自选为空。去「市场」页点星号，或直接搜索 6 位代码添加。'}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

// ---- 持仓 --------------------------------------------------------------------

function HoldingsTab({
  summary,
  holdingCount,
  onDetail,
  onTrade,
}: {
  summary: ReturnType<typeof researchAccountSummary>;
  holdingCount: number;
  onDetail: (code: string) => void;
  onTrade: (prefill: TradePrefill) => void;
}) {
  const exposure = sectorExposure(summary);
  const holdingsPrompt = [
    '请复盘我的全部模拟持仓明细。',
    ...summary.holdings.map(
      (row) =>
        `- ${row.quote.name}（${row.code}）：${row.quantity}股，市值 ${formatMoney(row.marketValue)}，浮盈亏 ${formatSignedMoney(row.pnl)}（${formatPercent(row.pnlPct)}），权重 ${formatPercent(row.weightPct)}`,
    ),
    '请判断组合集中度、行业暴露、止盈止损和是否需要调仓。',
  ].join('\n');
  return (
    <div className="rw-tab-page">
      <div className="rw-holding-summary">
        <article
          draggable
          onDragStart={(event) =>
            startResearchDrag(
              event,
              simpleMetricPrompt('持仓市值', formatMoney(summary.marketValue), `持仓成本 ${formatMoney(summary.cost)}。`),
            )
          }
        >
          <em>持仓市值</em>
          <strong>{formatMoney(summary.marketValue)}</strong>
        </article>
        <article
          draggable
          onDragStart={(event) =>
            startResearchDrag(
              event,
              simpleMetricPrompt('浮盈亏', formatSignedMoney(summary.pnl), `收益率按持仓成本计算，当前持仓成本 ${formatMoney(summary.cost)}。`),
            )
          }
        >
          <em>浮盈亏</em>
          <strong className={changeTone(summary.pnl)}>{formatSignedMoney(summary.pnl)}</strong>
        </article>
        <article
          draggable
          onDragStart={(event) =>
            startResearchDrag(
              event,
              simpleMetricPrompt('最大单票占比', formatPercent(summary.concentrationPct), '用于衡量单一持仓对组合净值的冲击。'),
            )
          }
        >
          <em>最大单票占比</em>
          <strong>{formatPercent(summary.concentrationPct)}</strong>
        </article>
      </div>

      <section className="rw-section" aria-label="持仓明细">
        <header className="rw-section-head">
          <span>持仓明细</span>
          <span
            className="rw-drag-chip"
            draggable
            onDragStart={(event) => startResearchDrag(event, holdingsPrompt)}
            title="拖拽整份持仓明细到对话框"
          >
            <GripVertical size={12} />
            {summary.holdings.length} 只持仓
          </span>
        </header>
        <div className="rw-stock-list">
          {summary.holdings.map((row) => (
            <article
              key={row.code}
              className="rw-holding-row"
              draggable
              onDragStart={(event) => startResearchDrag(event, holdingPrompt(row))}
            >
              <button type="button" className="rw-stock-main" onClick={() => onDetail(row.code)}>
                <span className="rw-stock-name">
                  <strong>{row.quote.name}</strong>
                  <em>
                    {row.quantity} 股 · 成本 {row.avgCost.toFixed(2)}
                  </em>
                </span>
                <span className="rw-stock-price">
                  <strong>{formatMoney(row.marketValue)}</strong>
                  <em>现价 {row.quote.price.toFixed(2)}</em>
                </span>
                <span className={`rw-holding-pnl ${changeTone(row.pnl)}`}>
                  <strong>{formatSignedMoney(row.pnl)}</strong>
                  <em>{formatPercent(row.pnlPct)}</em>
                </span>
              </button>
              <div className="rw-row-actions">
                <button type="button" onClick={() => onTrade({ side: 'buy', code: row.code, price: row.quote.price })}>
                  买
                </button>
                <button type="button" onClick={() => onTrade({ side: 'sell', code: row.code, price: row.quote.price })}>
                  卖
                </button>
              </div>
            </article>
          ))}
          {summary.holdings.length === 0 && (
            <div className="rw-empty">
              {holdingCount
                ? '已有持仓，但尚未拿到这些标的的真实行情，暂不计算市值和盈亏。'
                : '暂无持仓。到「交易」页入金后模拟买入即可生成持仓数据。'}
            </div>
          )}
        </div>
      </section>

      {exposure.length > 0 && (
        <section
          className="rw-section"
          aria-label="行业暴露"
          draggable
          onDragStart={(event) => startResearchDrag(event, sectorExposurePrompt(exposure))}
          title="拖拽行业暴露到对话框"
        >
          <header className="rw-section-head">
            <span>行业暴露</span>
            <em>按市值占比</em>
          </header>
          <div className="rw-exposure-list">
            {exposure.map((row) => (
              <div
                key={row.sector}
                className="rw-exposure-row"
                draggable
                onDragStart={(event) =>
                  startNestedResearchDrag(
                    event,
                    sectorExposurePrompt([row]),
                  )
                }
              >
                <span>{row.sector}</span>
                <span className="rw-exposure-track">
                  <i style={{ width: `${Math.min(100, row.pct)}%` }} />
                </span>
                <em>{formatPercent(row.pct)}</em>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ---- 交易 --------------------------------------------------------------------

const TRADE_KIND_LABELS: Record<ResearchTrade['kind'], string> = {
  buy: '买入',
  sell: '卖出',
  deposit: '入金',
  withdraw: '出金',
};

function TradeTab({
  state,
  quotes,
  summary,
  prefill,
  onConsumePrefill,
  onCommit,
}: {
  state: ResearchState;
  quotes: Map<string, ResearchQuote>;
  summary: ReturnType<typeof researchAccountSummary>;
  prefill: TradePrefill | null;
  onConsumePrefill: () => void;
  onCommit: (next: ResearchState) => void;
}) {
  const [cashAmount, setCashAmount] = useState('100000');
  const [cashNotice, setCashNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [side, setSide] = useState<ResearchOrderSide>('buy');
  const [codeQuery, setCodeQuery] = useState('');
  const [selectedTradeCode, setSelectedTradeCode] = useState<string | null>(
    state.holdings[0]?.code ?? state.watchlist[0] ?? RESEARCH_CATALOG[0]?.code ?? null,
  );
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('100');
  const [orderNotice, setOrderNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const tradeQuote = selectedTradeCode ? quotes.get(selectedTradeCode) ?? null : null;

  useEffect(() => {
    if (!prefill) return;
    setSide(prefill.side);
    setSelectedTradeCode(prefill.code);
    if (prefill.price) setPrice(String(Number(prefill.price.toFixed(2))));
    setOrderNotice(null);
    onConsumePrefill();
  }, [prefill, onConsumePrefill]);

  useEffect(() => {
    if (!tradeQuote) return;
    setPrice((current) => (current ? current : String(Number(tradeQuote.price.toFixed(2)))));
  }, [tradeQuote]);

  const holding = state.holdings.find((item) => item.code === selectedTradeCode);
  const priceValue = Number(price);
  const quantityValue = Math.floor(Number(quantity));
  const estimated =
    Number.isFinite(priceValue) && Number.isFinite(quantityValue) && priceValue > 0 && quantityValue > 0
      ? priceValue * quantityValue
      : 0;

  const pickerCandidates = useMemo(() => {
    const normalized = codeQuery.trim().toLowerCase();
    const all = Array.from(quotes.values());
    const scoped = normalized
      ? all.filter((quote) => quoteMatchesQuery(quote, normalized))
      : all.filter(
          (quote) =>
            state.holdings.some((item) => item.code === quote.code) ||
            state.watchlist.includes(quote.code),
        );
    return scoped.slice(0, 8);
  }, [codeQuery, quotes, state.holdings, state.watchlist]);
  const fundsPrompt = accountPrompt(state, summary);
  const tradesPrompt = tradeLogPrompt(state.trades);

  const applyPortion = (portion: number) => {
    if (!Number.isFinite(priceValue) || priceValue <= 0) return;
    if (side === 'buy') {
      const lots = Math.floor((state.cash * portion) / priceValue / 100);
      setQuantity(String(Math.max(0, lots) * 100));
    } else if (holding) {
      const raw = Math.floor(holding.quantity * portion);
      setQuantity(String(portion === 1 ? holding.quantity : Math.max(0, raw)));
    }
  };

  const submitCash = (flowSide: 'deposit' | 'withdraw') => {
    const result = applyCashFlow(state, flowSide, Number(cashAmount));
    if (result.error) {
      setCashNotice({ tone: 'error', text: result.error });
      return;
    }
    onCommit(result.state);
    setCashNotice({
      tone: 'ok',
      text: `${flowSide === 'deposit' ? '入金' : '出金'} ${formatMoney(Number(cashAmount))} 成功`,
    });
  };

  const submitOrder = (event: FormEvent) => {
    event.preventDefault();
    if (!selectedTradeCode || !tradeQuote) {
      setOrderNotice({ tone: 'error', text: '请先选择已有真实行情的股票。' });
      return;
    }
    const result = placeOrder(state, {
      side,
      code: selectedTradeCode,
      name: tradeQuote.name,
      price: priceValue,
      quantity: quantityValue,
    });
    if (result.error) {
      setOrderNotice({ tone: 'error', text: result.error });
      return;
    }
    onCommit(result.state);
    setOrderNotice({
      tone: 'ok',
      text: `已成交：${side === 'buy' ? '买入' : '卖出'} ${tradeQuote.name} ${quantityValue} 股 @ ${priceValue.toFixed(2)}`,
    });
  };

  return (
    <div className="rw-tab-page">
      <section
        className="rw-section"
        aria-label="资金管理"
        draggable
        onDragStart={(event) => startResearchDrag(event, fundsPrompt)}
        title="拖拽资金与账户概览到对话框"
      >
        <header className="rw-section-head">
          <span><Wallet size={13} /> 资金</span>
          <em>现金 {formatMoney(state.cash)} · 净入金 {formatMoney(state.netDeposits)}</em>
        </header>
        <div className="rw-cash-row">
          <input
            value={cashAmount}
            onChange={(event) => {
              setCashAmount(event.target.value);
              setCashNotice(null);
            }}
            inputMode="decimal"
            aria-label="入金出金金额"
            placeholder="金额"
          />
          <button type="button" className="rw-btn buy" onClick={() => submitCash('deposit')}>
            <ArrowDownToLine size={13} />
            入金
          </button>
          <button type="button" className="rw-btn ghost" onClick={() => submitCash('withdraw')}>
            <ArrowUpFromLine size={13} />
            出金
          </button>
        </div>
        {cashNotice && <p className={`rw-notice ${cashNotice.tone}`}>{cashNotice.text}</p>}
      </section>

      <section
        className="rw-section"
        aria-label="模拟下单"
        draggable={Boolean(tradeQuote)}
        onDragStart={tradeQuote ? (event) => startResearchDrag(event, securityPrompt(tradeQuote)) : undefined}
        title={tradeQuote ? '拖拽当前下单标的到对话框' : undefined}
      >
        <header className="rw-section-head">
          <span><ChartCandlestick size={13} /> 模拟下单</span>
          <em>限价成交 · 生成持仓数据</em>
        </header>
        <form className="rw-order-form" onSubmit={submitOrder}>
          <div className="rw-segmented">
            <button
              type="button"
              className={side === 'buy' ? 'active buy' : ''}
              onClick={() => {
                setSide('buy');
                setOrderNotice(null);
              }}
            >
              买入
            </button>
            <button
              type="button"
              className={side === 'sell' ? 'active sell' : ''}
              onClick={() => {
                setSide('sell');
                setOrderNotice(null);
              }}
            >
              卖出
            </button>
          </div>

          <div className="rw-order-picker">
            <button
              type="button"
              className="rw-order-picked"
              draggable={Boolean(tradeQuote)}
              onDragStart={
                tradeQuote
                  ? (event) => startNestedResearchDrag(event, securityPrompt(tradeQuote))
                  : undefined
              }
              onClick={() => setPickerOpen((open) => !open)}
              aria-expanded={pickerOpen}
            >
              {tradeQuote ? (
                <>
                  <strong>{tradeQuote.name}</strong>
                  <em>{shortCode(tradeQuote.code)} · 现价 {tradeQuote.price.toFixed(2)}</em>
                </>
              ) : (
                <strong>选择股票</strong>
              )}
            </button>
            {pickerOpen && (
              <div className="rw-order-picker-pop">
                <label className="rw-search">
                  <Search size={13} />
                  <input
                    autoFocus
                    value={codeQuery}
                    onChange={(event) => setCodeQuery(event.target.value)}
                    placeholder="搜索代码 / 名称"
                    spellCheck={false}
                  />
                </label>
                <div className="rw-order-picker-list">
                  {pickerCandidates.map((quote) => (
                    <button
                      key={quote.code}
                      type="button"
                      draggable
                      onDragStart={(event) => startNestedResearchDrag(event, securityPrompt(quote))}
                      onClick={() => {
                        setSelectedTradeCode(quote.code);
                        setPrice(String(Number(quote.price.toFixed(2))));
                        setPickerOpen(false);
                        setCodeQuery('');
                        setOrderNotice(null);
                      }}
                    >
                      <strong>{quote.name}</strong>
                      <em>{shortCode(quote.code)}</em>
                      <span className={changeTone(quote.changePct)}>{quote.price.toFixed(2)}</span>
                    </button>
                  ))}
                  {pickerCandidates.length === 0 && <div className="rw-empty">没有可用真实行情标的</div>}
                </div>
              </div>
            )}
          </div>

          <div className="rw-order-inputs">
            <label>
              <span>价格</span>
              <input
                value={price}
                onChange={(event) => {
                  setPrice(event.target.value);
                  setOrderNotice(null);
                }}
                inputMode="decimal"
              />
            </label>
            <label>
              <span>数量（股）</span>
              <input
                value={quantity}
                onChange={(event) => {
                  setQuantity(event.target.value);
                  setOrderNotice(null);
                }}
                inputMode="numeric"
              />
            </label>
          </div>

          <div className="rw-portion-row">
            {([
              [0.25, '1/4'],
              [0.5, '1/2'],
              [0.75, '3/4'],
              [1, side === 'buy' ? '全仓' : '全部'],
            ] as Array<[number, string]>).map(([portion, label]) => (
              <button key={label} type="button" onClick={() => applyPortion(portion)}>
                {label}
              </button>
            ))}
          </div>

          <div className="rw-order-meta">
            <span>
              {side === 'buy'
                ? `可用现金 ${formatMoney(state.cash)}`
                : `可卖 ${holding ? holding.quantity : 0} 股`}
            </span>
            <span>预估金额 {estimated ? formatMoney(estimated) : '-'}</span>
          </div>

          {orderNotice && <p className={`rw-notice ${orderNotice.tone}`}>{orderNotice.text}</p>}

          <button type="submit" className={`rw-order-submit ${side}`}>
            {side === 'buy' ? '模拟买入' : '模拟卖出'}
            {tradeQuote ? ` ${tradeQuote.name}` : ''}
          </button>
        </form>
      </section>

      <section
        className="rw-section"
        aria-label="交易与资金流水"
        draggable
        onDragStart={(event) => startResearchDrag(event, tradesPrompt)}
        title="拖拽交易与资金流水到对话框"
      >
        <header className="rw-section-head">
          <span>流水</span>
          <em>{state.trades.length} 笔 · 仓位 {formatPercent(summary.exposurePct)}</em>
        </header>
        <div className="rw-trade-log">
          {state.trades.slice(0, 30).map((trade) => (
            <div
              key={trade.id}
              className={`rw-trade-row ${trade.kind}`}
              draggable
              onDragStart={(event) => startNestedResearchDrag(event, tradePrompt(trade))}
            >
              <span className={`rw-trade-kind ${trade.kind}`}>{TRADE_KIND_LABELS[trade.kind]}</span>
              <span className="rw-trade-main">
                {trade.name ? (
                  <>
                    <strong>{trade.name}</strong>
                    <em>
                      {trade.quantity} 股 @ {trade.price?.toFixed(2)}
                    </em>
                  </>
                ) : (
                  <strong>{formatMoney(trade.amount)}</strong>
                )}
              </span>
              <span className="rw-trade-amount">
                {trade.kind === 'buy' || trade.kind === 'withdraw' ? '-' : '+'}
                {formatMoney(trade.amount)}
              </span>
              <span className="rw-trade-time">
                {new Date(trade.createdAt).toLocaleString('zh-CN', {
                  month: '2-digit',
                  day: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: false,
                })}
              </span>
            </div>
          ))}
          {state.trades.length === 0 && <div className="rw-empty">暂无流水，入金或下单后会在这里留痕。</div>}
        </div>
      </section>
    </div>
  );
}

// ---- 组合 --------------------------------------------------------------------

function PortfoliosTab({
  state,
  quotes,
  onCommit,
  onDetail,
}: {
  state: ResearchState;
  quotes: Map<string, ResearchQuote>;
  onCommit: (next: ResearchState) => void;
  onDetail: (code: string) => void;
}) {
  const [builderOpen, setBuilderOpen] = useState(false);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [memberCodes, setMemberCodes] = useState<string[]>([]);
  const [memberQuery, setMemberQuery] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const candidates = useMemo(() => {
    const normalized = memberQuery.trim().toLowerCase();
    const preferred = new Set([
      ...state.watchlist,
      ...state.holdings.map((item) => item.code),
    ]);
    const all = Array.from(quotes.values());
    const scoped = normalized
      ? all.filter((quote) => quoteMatchesQuery(quote, normalized))
      : all.filter((quote) => preferred.has(quote.code));
    return scoped.slice(0, 10);
  }, [memberQuery, quotes, state.watchlist, state.holdings]);

  const toggleMember = (code: string) => {
    setNotice(null);
    setMemberCodes((current) =>
      current.includes(code) ? current.filter((item) => item !== code) : [...current, code],
    );
  };

  const submit = () => {
    const preparedState = memberCodes.reduce((current, code) => {
      const quote = quotes.get(code);
      if (!quote) return current;
      return registerCustomSecurity(current, quote.code, {
        name: quote.name,
        sector: quote.sector,
        basePrice: quote.price,
      });
    }, state);
    const result = createPortfolio(preparedState, name, memberCodes, note);
    if (result.error) {
      setNotice(result.error);
      return;
    }
    onCommit(result.state);
    setName('');
    setNote('');
    setMemberCodes([]);
    setMemberQuery('');
    setNotice(null);
    setBuilderOpen(false);
  };

  return (
    <div className="rw-tab-page">
      <section className="rw-section" aria-label="股票组合">
        <header className="rw-section-head">
          <span>股票组合</span>
          <button type="button" className="rw-mini-btn" onClick={() => setBuilderOpen((open) => !open)}>
            <Plus size={12} />
            新建组合
          </button>
        </header>

        {builderOpen && (
          <div className="rw-portfolio-builder">
            <input
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setNotice(null);
              }}
              placeholder="组合名称，如：AI 算力观察"
            />
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="备注（可选）：组合主线 / 观察目的"
            />
            {memberCodes.length > 0 && (
              <div className="rw-member-chips">
                {memberCodes.map((code) => (
                  <span key={code} className="rw-member-chip">
                    {quotes.get(code)?.name ?? shortCode(code)}
                    <button type="button" onClick={() => toggleMember(code)} aria-label={`移除 ${code}`}>
                      <X size={11} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <label className="rw-search">
              <Search size={13} />
              <input
                value={memberQuery}
                onChange={(event) => setMemberQuery(event.target.value)}
                placeholder="搜索加入成分股（默认展示自选与持仓）"
                spellCheck={false}
              />
            </label>
            <div className="rw-member-candidates">
              {candidates.map((quote) => {
                const checked = memberCodes.includes(quote.code);
                return (
                  <button
                    key={quote.code}
                    type="button"
                    className={checked ? 'active' : ''}
                    draggable
                    onDragStart={(event) => startNestedResearchDrag(event, securityPrompt(quote))}
                    onClick={() => toggleMember(quote.code)}
                  >
                    <strong>{quote.name}</strong>
                    <em>{shortCode(quote.code)} · {quote.sector}</em>
                    <span className={changeTone(quote.changePct)}>{formatPercent(quote.changePct)}</span>
                  </button>
                );
              })}
              {candidates.length === 0 && <div className="rw-empty">没有可用真实行情标的</div>}
            </div>
            {notice && <p className="rw-notice error">{notice}</p>}
            <button type="button" className="rw-order-submit buy" onClick={submit}>
              创建组合（{memberCodes.length} 只）
            </button>
          </div>
        )}

        <div className="rw-portfolio-list">
          {state.portfolios.map((portfolio) => {
            const members = portfolio.codes
              .map((code) => quotes.get(code))
              .filter((quote): quote is ResearchQuote => Boolean(quote));
            const avgPct = members.length
              ? members.reduce((sum, quote) => sum + quote.changePct, 0) / members.length
              : 0;
            return (
              <article
                key={portfolio.id}
                className="rw-portfolio-card"
                draggable
                onDragStart={(event) => startResearchDrag(event, portfolioPrompt(portfolio, quotes))}
              >
                <header>
                  <span className="rw-portfolio-title">
                    <strong>{portfolio.name}</strong>
                    <em>
                      {portfolio.note ||
                        (members.length ? `${members.length} 只真实行情成分` : `${portfolio.codes.length} 只待行情`)}
                    </em>
                  </span>
                  <span className={`rw-change-pill ${changeTone(avgPct)}`}>{formatPercent(avgPct)}</span>
                  <button
                    type="button"
                    className="rw-icon-btn danger"
                    onClick={() => onCommit(deletePortfolio(state, portfolio.id))}
                    aria-label={`删除组合 ${portfolio.name}`}
                    title="删除组合"
                  >
                    <Trash2 size={13} />
                  </button>
                </header>
                <div className="rw-portfolio-members">
                  {members.map((quote) => (
                    <button
                      key={quote.code}
                      type="button"
                      className={`rw-portfolio-member ${changeTone(quote.changePct)}`}
                      draggable
                      onDragStart={(event) => startNestedResearchDrag(event, securityPrompt(quote))}
                      onClick={() => onDetail(quote.code)}
                    >
                      {quote.name}
                      <em>{formatPercent(quote.changePct)}</em>
                    </button>
                  ))}
                </div>
                <footer>
                  <GripVertical size={12} />
                  拖拽整个组合到对话框，让 Agent 分析主线与风险
                </footer>
              </article>
            );
          })}
          {state.portfolios.length === 0 && !builderOpen && (
            <div className="rw-empty">还没有组合。点「新建组合」把自选或持仓打包成观察组。</div>
          )}
        </div>
      </section>
    </div>
  );
}
