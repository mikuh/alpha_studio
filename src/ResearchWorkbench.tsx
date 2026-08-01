import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { DragEvent as ReactDragEvent, FormEvent } from 'react';
import {
  Activity,
  ArrowLeft,
  BarChart3,
  BellRing,
  BriefcaseBusiness,
  CalendarDays,
  ChartCandlestick,
  ChevronRight,
  CircleDollarSign,
  Compass,
  Database,
  Flame,
  Landmark,
  LayoutGrid,
  List,
  ListFilter,
  Loader2,
  Network,
  Newspaper,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Star,
  Trash2,
  TrendingUp,
  UserRound,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { fetchCloudFullMarket, fetchCloudRealtimeBatch, subscribeCloudMarket } from './cloudMarket';
import {
  RESEARCH_CATALOG,
  RESEARCH_DRAG_MIME,
  RESEARCH_INDEXES,
  RESEARCH_STATE_CHANGE_EVENT,
  applyCashFlow,
  buildIndexQuotes,
  buildQuoteMap,
  changeTone,
  clearLiveAccountRecords,
  computeMarketOverview,
  computeSectorHeat,
  formatMoney,
  formatPercent,
  formatSignedMoney,
  holdingPrompt,
  loadResearchState,
  normalizeResearchState,
  placeOrder,
  registerCustomSecurity,
  researchAccountSummary,
  saveResearchState,
  securityPrompt,
  shortCode,
  toggleWatchlist,
  type LivePriceOverride,
  type ResearchOrderSide,
  type ResearchQuote,
  type ResearchState,
} from './research';
import { insertIntoComposer } from './composerBridge';
import { loadLocalStoreSnapshot, scheduleLocalStoreCommit } from './localStore';
import { StockKlineChart } from './StockKlineChart';
import './researchMarketApp.css';

type PrimarySection = 'watchlist' | 'market' | 'trade' | 'assets' | 'discover';
type MarketListKind = 'gainers' | 'turnover' | 'connect' | 'signals' | 'all';
type FeatureKind = 'screener' | 'ipo' | 'etf' | 'earnings' | 'macro' | 'dividend' | 'calendar' | 'portfolio';

type MarketRoute =
  | { kind: 'root' }
  | { kind: 'search' }
  | { kind: 'stock'; code: string }
  | { kind: 'index'; code: string }
  | { kind: 'list'; list: MarketListKind }
  | { kind: 'heat' }
  | { kind: 'themes' }
  | { kind: 'theme'; sector: string }
  | { kind: 'feature'; feature: FeatureKind };

interface TradePrefill {
  side: ResearchOrderSide;
  code: string;
  price: number;
}

const PRIMARY_NAV: Array<{ id: PrimarySection; label: string; icon: LucideIcon }> = [
  { id: 'watchlist', label: '自选', icon: Star },
  { id: 'market', label: '市场', icon: Compass },
  { id: 'trade', label: '实盘', icon: ChartCandlestick },
  { id: 'assets', label: '资产', icon: Wallet },
  { id: 'discover', label: '发现', icon: Sparkles },
];

const FEATURE_META: Record<FeatureKind, { title: string; eyebrow: string; detail: string; prompt: string; icon: LucideIcon }> = {
  screener: { title: '选股器', eyebrow: '行情筛选', detail: '按涨幅、成交活跃度、板块和风险条件缩小范围', prompt: '请为当前 A 股行情池设计一组可复现的选股条件，覆盖趋势、流动性、估值和风险过滤。', icon: ListFilter },
  ipo: { title: '新股中心', eyebrow: '发行日历', detail: '核验申购、上市、估值和可比公司', prompt: '请整理近期 A 股新股申购与上市日历，核验发行估值、行业可比公司和主要风险。', icon: Plus },
  etf: { title: 'ETF 专区', eyebrow: '指数工具', detail: '宽基、行业、主题和商品 ETF 的研究入口', prompt: '请按宽基、行业、主题和商品分类整理可交易 ETF，并比较规模、流动性、跟踪误差和费率。', icon: BarChart3 },
  earnings: { title: '财报日历', eyebrow: '业绩验证', detail: '财报、业绩预告和重要公司事件', prompt: '请整理未来两周 A 股重点财报与业绩预告，优先覆盖我的自选和持仓，并标注预期差风险。', icon: BriefcaseBusiness },
  macro: { title: '宏观数据', eyebrow: '周期定位', detail: 'PMI、社融、通胀、进出口与 GDP', prompt: '请整理近期中国宏观数据，覆盖 PMI、社融、通胀、进出口和 GDP，并解释可能影响的 A 股行业。', icon: Landmark },
  dividend: { title: '股息排行', eyebrow: '现金回报', detail: '股息率、分红持续性与除权除息安排', prompt: '请核验当前 A 股高股息标的的最新分红方案、股息率和可持续性，区分一次性高分红与稳定现金回报。', icon: CircleDollarSign },
  calendar: { title: '财经日历', eyebrow: '事件驱动', detail: '政策、宏观、行业和公司事件统一查看', prompt: '请整理未来两周影响 A 股的财经日历，按宏观、政策、行业和公司事件分类并标注影响方向。', icon: CalendarDays },
  portfolio: { title: '股票组合', eyebrow: '组合研究', detail: '按主题维护观察组并跟踪组合暴露', prompt: '请复盘我的股票组合，分析行业暴露、相关性、集中度和需要调整的观察优先级。', icon: BriefcaseBusiness },
};

const CHAIN_PRESETS = [
  { name: 'AI 算力', sectors: ['半导体', '算力', '光通信', '通信设备', 'AI应用', '软件'] },
  { name: '先进制造', sectors: ['电池', '汽车', '光伏', '有色金属', '元件'] },
  { name: '高股息资产', sectors: ['银行', '电力', '煤炭', '石油石化', '通信运营', '保险'] },
];

function startResearchDrag(event: ReactDragEvent<HTMLElement>, prompt: string) {
  event.dataTransfer.setData(RESEARCH_DRAG_MIME, prompt);
  event.dataTransfer.setData('text/plain', prompt);
  event.dataTransfer.effectAllowed = 'copy';
}

function quoteTurnover(quote: ResearchQuote): number {
  return quote.turnoverAmount ?? quote.turnover * 100_000_000;
}

function isEtfQuote(quote: ResearchQuote): boolean {
  return quote.securityType === 'etf' || quote.board.endsWith('ETF');
}

function formatPositionMoney(value: number, signed = false): string {
  if (!Number.isFinite(value)) return '—';
  const sign = signed && value > 0 ? '+' : '';
  return `${sign}${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatPositionWeight(value: number): string {
  return Number.isFinite(value) ? `${value.toFixed(2)}%` : '—';
}

function datetimeLocalValue(timestamp = Date.now()): string {
  const date = new Date(timestamp);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function tradeKindLabel(kind: ResearchState['trades'][number]['kind']): string {
  if (kind === 'buy') return '买入';
  if (kind === 'sell') return '卖出';
  return kind === 'deposit' ? '入金' : '出金';
}

function quoteOverride(quote: ResearchQuote): LivePriceOverride {
  return {
    source: quote.source === 'sample' ? 'eastmoney' : quote.source,
    price: quote.price,
    prevClose: quote.prevClose,
    open: quote.open,
    high: quote.high,
    low: quote.low,
    volumeShares: quote.volumeShares,
    turnoverAmount: quote.turnoverAmount,
    marketCapAmount: quote.marketCap * 100_000_000,
    turnoverRate: quote.turnoverRate,
    volumeRatio: quote.volumeRatio,
    paused: quote.paused,
  };
}

function quoteSourceLabel(source: ResearchQuote['source']): string {
  if (source === 'eastmoney') return '云端 · 东方财富';
  if (source === 'tencent') return '云端 · 腾讯备源';
  if (source === 'jqdata') return '聚宽行情';
  return '样例行情';
}

function marketPrompt(title: string, lines: string[]): string {
  return [`请分析证券工作台中的「${title}」。`, ...lines, '请区分事实、推断与待核验项，并给出关键风险、反证条件和下一步动作。'].join('\n');
}

function primaryTitle(section: PrimarySection): string {
  return PRIMARY_NAV.find((item) => item.id === section)?.label ?? '市场';
}

function listTitle(kind: MarketListKind): string {
  return { gainers: '领涨榜', turnover: '成交额榜', connect: '沪深通观察', signals: '智能盯盘', all: '全部股票' }[kind];
}

function routeTitle(route: MarketRoute, quoteMap: Map<string, ResearchQuote>): string {
  if (route.kind === 'search') return '搜索';
  if (route.kind === 'stock') return quoteMap.get(route.code)?.name ?? '股票详情';
  if (route.kind === 'index') return RESEARCH_INDEXES.find((item) => item.code === route.code)?.name ?? '指数详情';
  if (route.kind === 'list') return listTitle(route.list);
  if (route.kind === 'heat') return '热力图';
  if (route.kind === 'themes') return '投资主题';
  if (route.kind === 'theme') return route.sector;
  if (route.kind === 'feature') return FEATURE_META[route.feature].title;
  return '';
}

function SectionHeading({ title, meta, onOpen }: { title: string; meta?: string; onOpen?: () => void }) {
  return (
    <header className="market-section-heading">
      <span><strong>{title}</strong>{meta && <em>{meta}</em>}</span>
      {onOpen && <button type="button" onClick={onOpen} aria-label={`查看全部${title}`}>更多 <ChevronRight size={14} /></button>}
    </header>
  );
}

function sparklineValues(quote: ResearchQuote, count = 28): number[] {
  const low = Math.min(quote.low, quote.price, quote.open ?? quote.prevClose);
  const high = Math.max(quote.high, quote.price, quote.open ?? quote.prevClose);
  const span = Math.max(high - low, quote.price * 0.006, 0.01);
  const start = quote.open ?? quote.prevClose;
  let seed = Array.from(quote.code).reduce((value, character) => Math.imul(value ^ character.charCodeAt(0), 16777619), 2166136261) >>> 0;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const values = Array.from({ length: count }, (_, index) => {
    const progress = index / (count - 1);
    const baseline = start + (quote.price - start) * progress;
    const envelope = Math.sin(Math.PI * progress);
    const wave = (Math.sin(progress * Math.PI * 4 + random() * 0.7) * 0.12 + (random() - 0.5) * 0.2) * span * envelope;
    return Math.max(low, Math.min(high, baseline + wave));
  });
  values[0] = start;
  values[values.length - 1] = quote.price;
  return values;
}

function MiniSparkline({ quote, detailed = false }: { quote: ResearchQuote; detailed?: boolean }) {
  const gradientId = useId().replace(/:/g, '');
  const values = sparklineValues(quote, detailed ? 44 : 28);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 0.01);
  const width = detailed ? 320 : 96;
  const height = detailed ? 92 : 38;
  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * width;
    const y = height - 3 - ((value - min) / span) * (height - 6);
    return { x, y };
  });
  const line = points.slice(1, -1).reduce((path, point, index) => {
    const next = points[index + 2];
    const midpointX = (point.x + next.x) / 2;
    const midpointY = (point.y + next.y) / 2;
    return `${path} Q ${point.x.toFixed(2)},${point.y.toFixed(2)} ${midpointX.toFixed(2)},${midpointY.toFixed(2)}`;
  }, `M ${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}`) + ` L ${points[points.length - 1].x.toFixed(2)},${points[points.length - 1].y.toFixed(2)}`;
  const area = `${line} L ${width},${height} L 0,${height} Z`;
  const tone = changeTone(quote.changePct);
  return (
    <svg
      className={`market-sparkline ${tone} ${detailed ? 'detailed' : ''}`}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`${quote.name}当日价格区间走势示意`}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.18" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      {detailed && <line x1="0" x2={width} y1={height / 2} y2={height / 2} className="market-sparkline-guide" />}
      <path d={area} className="market-sparkline-area" fill={`url(#${gradientId})`} />
      <path d={line} className="market-sparkline-line" />
      {detailed && <circle cx={width - 2} cy={points[points.length - 1].y} r="3" className="market-sparkline-dot" />}
    </svg>
  );
}

function StockRow({ quote, watched, onOpen, onWatch, metric, showChevron = true }: { quote: ResearchQuote; watched: boolean; onOpen: () => void; onWatch?: () => void; metric?: string; showChevron?: boolean }) {
  return (
    <article className="market-stock-row" draggable onDragStart={(event) => startResearchDrag(event, securityPrompt(quote))}>
      <button type="button" className="market-stock-row-main" onClick={onOpen} aria-label={`查看${quote.name}详情`}>
        <span><strong>{quote.name}</strong><em>{shortCode(quote.code)} · {quote.sector}</em></span>
        <small aria-hidden={!metric}>{metric ?? ''}</small>
        <span className="market-stock-sparkline"><MiniSparkline quote={quote} /></span>
        <span className={`market-stock-price ${changeTone(quote.changePct)}`}><strong>{quote.price.toFixed(2)}</strong><em>昨收 {quote.prevClose.toFixed(2)}</em></span>
        <span className={`market-stock-change ${changeTone(quote.changePct)}`}><strong>{formatPercent(quote.changePct)}</strong><em>{formatSignedMoney(quote.changeAmt)}</em></span>
        {showChevron && <ChevronRight size={14} />}
      </button>
      {onWatch && <button type="button" className={`market-watch-toggle ${watched ? 'active' : ''}`} onClick={onWatch} aria-label={watched ? `取消自选${quote.name}` : `添加自选${quote.name}`}><Star size={14} fill={watched ? 'currentColor' : 'none'} /></button>}
    </article>
  );
}

function EmptyState({ title, detail, action, onAction }: { title: string; detail: string; action?: string; onAction?: () => void }) {
  return <div className="market-empty"><Activity size={24} /><strong>{title}</strong><span>{detail}</span>{action && onAction && <button type="button" onClick={onAction}>{action}</button>}</div>;
}

function MarketHome({ quotes, indexQuotes, state, loading, onRoute }: { quotes: ResearchQuote[]; indexQuotes: ReturnType<typeof buildIndexQuotes>; state: ResearchState; loading: boolean; onRoute: (route: MarketRoute) => void }) {
  const overview = useMemo(() => computeMarketOverview(quotes), [quotes]);
  const themes = useMemo(() => computeSectorHeat(quotes).slice(0, 8), [quotes]);
  const gainers = useMemo(() => [...quotes].sort((a, b) => b.changePct - a.changePct).slice(0, 5), [quotes]);
  const hot = useMemo(() => [...quotes].sort((a, b) => quoteTurnover(b) - quoteTurnover(a)).slice(0, 5), [quotes]);
  const signals = useMemo(() => [...quotes].filter((quote) => quote.volumeRatio || quote.turnoverRate).sort((a, b) => ((b.volumeRatio ?? 0) * 4 + (b.turnoverRate ?? 0)) - ((a.volumeRatio ?? 0) * 4 + (a.turnoverRate ?? 0))).slice(0, 3), [quotes]);
  const maxBucket = Math.max(1, ...overview.buckets.map((bucket) => bucket.count));

  return (
    <div className="market-root-page" aria-label="沪深市场首页">
      <div className="market-market-tabs" role="tablist" aria-label="市场范围">
        <button type="button" role="tab" aria-selected="true">沪深</button>
        <button type="button" role="tab" aria-selected="false" onClick={() => onRoute({ kind: 'feature', feature: 'etf' })}>ETF</button>
      </div>

      <section className="market-card market-index-section" aria-label="主要指数">
        <SectionHeading title="主要指数" meta="红涨绿跌" />
        {indexQuotes.length ? <div className="market-index-grid">{indexQuotes.map((index) => (
          <button key={index.code} type="button" className={changeTone(index.changePct)} draggable onDragStart={(event) => startResearchDrag(event, marketPrompt(index.name, [`点位 ${index.price.toFixed(2)}，涨跌 ${formatPercent(index.changePct)}。`]))} onClick={() => onRoute({ kind: 'index', code: index.code })}>
            <span>{index.name}</span><strong>{index.price.toFixed(2)}</strong><em>{formatSignedMoney(index.changeAmt)} · {formatPercent(index.changePct)}</em>
          </button>
        ))}</div> : <EmptyState title={loading ? '行情读取中' : '指数暂不可用'} detail="刷新后显示真实指数行情，不使用伪造点位。" />}
        <div className="market-breadth-strip">
          <span><em>上涨</em><strong className="up">{overview.upCount}</strong></span>
          <i><b className="up" style={{ width: `${quotes.length ? (overview.upCount / quotes.length) * 100 : 0}%` }} /><b className="flat" style={{ width: `${quotes.length ? (overview.flatCount / quotes.length) * 100 : 0}%` }} /><b className="down" style={{ width: `${quotes.length ? (overview.downCount / quotes.length) * 100 : 0}%` }} /></i>
          <span><em>下跌</em><strong className="down">{overview.downCount}</strong></span>
        </div>
      </section>

      <section className="market-quick-grid" aria-label="市场快捷入口">
        {(['screener', 'ipo', 'etf', 'earnings'] as FeatureKind[]).map((kind) => {
          const item = FEATURE_META[kind]; const Icon = item.icon;
          return <button key={kind} type="button" draggable onDragStart={(event) => startResearchDrag(event, item.prompt)} onClick={() => onRoute({ kind: 'feature', feature: kind })}><i><Icon size={16} /></i><span>{item.title}</span></button>;
        })}
      </section>

      <section className="market-card" aria-label="热门榜单">
        <SectionHeading title="热门榜单" meta="行情池实时排序" onOpen={() => onRoute({ kind: 'list', list: 'gainers' })} />
        <div className="market-rank-switches">
          <button type="button" onClick={() => onRoute({ kind: 'list', list: 'gainers' })}><TrendingUp size={13} />领涨榜</button>
          <button type="button" onClick={() => onRoute({ kind: 'list', list: 'turnover' })}><Flame size={13} />成交额榜</button>
          <button type="button" onClick={() => onRoute({ kind: 'list', list: 'connect' })}><Compass size={13} />沪深通</button>
        </div>
        <div className="market-preview-list">{gainers.map((quote) => <StockRow key={quote.code} quote={quote} watched={state.watchlist.includes(quote.code)} onOpen={() => onRoute({ kind: 'stock', code: quote.code })} />)}</div>
      </section>

      <section className="market-card" aria-label="投资主题">
        <SectionHeading title="投资主题" meta="板块强弱与代表公司" onOpen={() => onRoute({ kind: 'themes' })} />
        <div className="market-theme-grid">{themes.slice(0, 6).map((theme) => (
          <button key={theme.sector} type="button" className={changeTone(theme.avgPct)} draggable onDragStart={(event) => startResearchDrag(event, marketPrompt(theme.sector, [`板块平均涨跌 ${formatPercent(theme.avgPct)}，样本 ${theme.count} 只。`]))} onClick={() => onRoute({ kind: 'theme', sector: theme.sector })}>
            <span>{theme.sector}</span><strong>{formatPercent(theme.avgPct)}</strong><em>{theme.count} 只</em>
          </button>
        ))}</div>
      </section>

      <section className="market-card" aria-label="智能盯盘">
        <SectionHeading title="智能盯盘" meta="量比与换手异常" onOpen={() => onRoute({ kind: 'list', list: 'signals' })} />
        {signals.length ? <div className="market-signal-list">{signals.map((quote, index) => (
          <button key={quote.code} type="button" draggable onDragStart={(event) => startResearchDrag(event, securityPrompt(quote))} onClick={() => onRoute({ kind: 'stock', code: quote.code })}>
            <time>{index ? `T-${index * 3}m` : 'NOW'}</time><i><BellRing size={13} /></i><span><strong>{quote.name}</strong><em>量比 {(quote.volumeRatio ?? 0).toFixed(2)} · 换手 {formatPercent(quote.turnoverRate ?? 0)}</em></span><b className={changeTone(quote.changePct)}>{formatPercent(quote.changePct)}</b><ChevronRight size={13} />
          </button>
        ))}</div> : <EmptyState title="暂无异动信号" detail="当前行情源没有返回量比或换手率。" />}
      </section>

      <section className="market-card" aria-label="产业链">
        <SectionHeading title="产业链" meta="按投资逻辑组织标的" />
        <div className="market-chain-list">{CHAIN_PRESETS.map((chain) => {
          const members = quotes.filter((quote) => chain.sectors.includes(quote.sector)).sort((a, b) => quoteTurnover(b) - quoteTurnover(a)).slice(0, 3);
          return <button key={chain.name} type="button" draggable onDragStart={(event) => startResearchDrag(event, marketPrompt(`${chain.name}产业链`, members.map((quote) => `${quote.name} ${formatPercent(quote.changePct)}`)))} onClick={() => members[0] && onRoute({ kind: 'theme', sector: members[0].sector })}><i><Network size={15} /></i><span><strong>{chain.name}</strong><em>{members.map((quote) => quote.name).join(' · ') || '等待真实行情'}</em></span><ChevronRight size={14} /></button>;
        })}</div>
      </section>

      <section className="market-card" aria-label="市场热力">
        <SectionHeading title="市场热力" meta="颜色看涨跌，板块可下钻" onOpen={() => onRoute({ kind: 'heat' })} />
        <div className="market-heat-grid">{themes.map((theme, index) => <button key={theme.sector} type="button" className={changeTone(theme.avgPct)} style={{ gridColumn: index < 2 ? 'span 2' : 'span 1' }} onClick={() => onRoute({ kind: 'theme', sector: theme.sector })}><span>{theme.sector}</span><strong>{formatPercent(theme.avgPct)}</strong></button>)}</div>
        <div className="market-distribution" aria-label="涨跌分布">{overview.buckets.map((bucket) => <div key={bucket.id}><span>{bucket.count}</span><i className={bucket.tone} style={{ height: `${Math.max(3, (bucket.count / maxBucket) * 52)}px` }} /><em>{bucket.label}</em></div>)}</div>
      </section>

      <section className="market-card" aria-label="研究日历">
        <SectionHeading title="研究日历" meta="数据、业绩与现金回报" />
        <div className="market-feature-list">{(['macro', 'dividend', 'calendar'] as FeatureKind[]).map((kind) => {
          const item = FEATURE_META[kind]; const Icon = item.icon;
          return <button key={kind} type="button" draggable onDragStart={(event) => startResearchDrag(event, item.prompt)} onClick={() => onRoute({ kind: 'feature', feature: kind })}><i><Icon size={15} /></i><span><strong>{item.title}</strong><em>{item.detail}</em></span><ChevronRight size={14} /></button>;
        })}</div>
      </section>

      <section className="market-card" aria-label="活跃股票">
        <SectionHeading title="活跃股票" meta={`${quotes.length} 只真实行情`} onOpen={() => onRoute({ kind: 'list', list: 'all' })} />
        <div className="market-preview-list">{hot.slice(0, 5).map((quote) => <StockRow key={quote.code} quote={quote} watched={state.watchlist.includes(quote.code)} metric={formatMoney(quoteTurnover(quote))} onOpen={() => onRoute({ kind: 'stock', code: quote.code })} />)}</div>
      </section>
    </div>
  );
}

function WatchlistHome({ state, quotes, onRoute }: { state: ResearchState; quotes: ResearchQuote[]; onRoute: (route: MarketRoute) => void }) {
  const PAGE_SIZE = 80;
  const [scope, setScope] = useState<'all' | 'holdings'>('all');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const watchedCodes = useMemo(() => new Set(state.watchlist), [state.watchlist]);
  const holdingCodes = useMemo(() => new Set(state.holdings.map((holding) => holding.code)), [state.holdings]);
  const orderedQuotes = useMemo(() => {
    const selectedCodes = scope === 'holdings' ? holdingCodes : watchedCodes;
    const source = quotes.filter((quote) => selectedCodes.has(quote.code));
    return [...source].sort((a, b) => quoteTurnover(b) - quoteTurnover(a));
  }, [holdingCodes, quotes, scope, watchedCodes]);
  const visibleQuotes = useMemo(() => orderedQuotes.slice(0, visibleCount), [orderedQuotes, visibleCount]);
  const rising = orderedQuotes.filter((quote) => quote.changePct > 0).length;
  const falling = orderedQuotes.filter((quote) => quote.changePct < 0).length;

  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [scope]);
  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || visibleCount >= orderedQuotes.length || typeof IntersectionObserver === 'undefined') return undefined;
    const root = target.closest('.market-app-body');
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisibleCount((current) => Math.min(current + PAGE_SIZE, orderedQuotes.length));
      }
    }, { root, rootMargin: '240px 0px' });
    observer.observe(target);
    return () => observer.disconnect();
  }, [orderedQuotes.length, visibleCount]);

  return (
    <div className="market-root-page market-watchlist-page">
      <div className="market-watchlist-tabs" role="tablist" aria-label="自选范围">
        <button type="button" role="tab" aria-selected={scope === 'all'} onClick={() => setScope('all')}>全部 <em>{state.watchlist.length}</em></button>
        <button type="button" role="tab" aria-selected={scope === 'holdings'} onClick={() => setScope('holdings')}>持仓 <em>{state.holdings.length}</em></button>
      </div>
      <section className="market-watchlist-summary" aria-label="行情概览">
        <span><em>{scope === 'all' ? '全部自选' : '我的持仓'}</em><strong>{orderedQuotes.length} 只</strong></span>
        <span><em>上涨</em><strong className="up">{rising}</strong></span>
        <span><em>下跌</em><strong className="down">{falling}</strong></span>
        <button type="button" onClick={() => onRoute({ kind: 'search' })}><Search size={14} />搜索 / 添加</button>
      </section>
      <section className="market-card market-watchlist-card">
        <div className="market-watchlist-columns"><span>名称 / 代码</span><span>走势</span><span>价格</span><span>涨跌幅</span></div>
        {visibleQuotes.length ? (
          <div className="market-preview-list">{visibleQuotes.map((quote) => (
            <StockRow key={quote.code} quote={quote} watched={watchedCodes.has(quote.code)} onOpen={() => onRoute({ kind: 'stock', code: quote.code })} showChevron={false} />
          ))}{visibleCount < orderedQuotes.length && <div ref={loadMoreRef} className="market-watchlist-load-more" aria-label="继续加载股票"><Loader2 size={14} className="spin" /><span>已显示 {visibleQuotes.length} / {orderedQuotes.length}，继续下滑加载</span></div>}</div>
        ) : scope === 'holdings'
          ? <EmptyState title="暂无持仓股票" detail="录入实盘买入记录后，持仓股票会出现在这里。" />
          : <EmptyState title="暂无自选股票" detail="搜索股票并点亮星标，它会出现在这里。" action="搜索股票" onAction={() => onRoute({ kind: 'search' })} />}
      </section>
    </div>
  );
}

function TradeHome({ quotes, state, initial, onCommit, onRoute }: { quotes: ResearchQuote[]; state: ResearchState; initial: TradePrefill | null; onCommit: (state: ResearchState) => void; onRoute: (route: MarketRoute) => void }) {
  const [side, setSide] = useState<ResearchOrderSide>(initial?.side ?? 'buy');
  const [code, setCode] = useState(initial?.code ?? quotes[0]?.code ?? '');
  const quote = quotes.find((item) => item.code === code) ?? quotes[0];
  const [price, setPrice] = useState(initial?.price ? initial.price.toFixed(2) : quote?.price.toFixed(2) ?? '');
  const [quantity, setQuantity] = useState('100');
  const [cashAmount, setCashAmount] = useState('100000');
  const [recordedAt, setRecordedAt] = useState(() => datetimeLocalValue());
  const [notice, setNotice] = useState('');

  useEffect(() => { if (!initial) return; setSide(initial.side); setCode(initial.code); setPrice(initial.price.toFixed(2)); }, [initial]);
  useEffect(() => { const next = quotes.find((item) => item.code === code); if (next) setPrice(next.price.toFixed(2)); }, [code, quotes]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!quote) return setNotice('请选择可交易股票。');
    const result = placeOrder(state, { side, code: quote.code, name: quote.name, price: Number(price), quantity: Number(quantity), createdAt: new Date(recordedAt).getTime() });
    if (result.error) return setNotice(result.error);
    onCommit(result.state); setNotice(`${side === 'buy' ? '买入' : '卖出'}实盘记录已保存。`);
  };
  const cashFlow = (kind: 'deposit' | 'withdraw') => {
    const result = applyCashFlow(state, kind, Number(cashAmount), new Date(recordedAt).getTime());
    if (result.error) return setNotice(result.error);
    onCommit(result.state); setNotice(`${kind === 'deposit' ? '入金' : '出金'} ${formatMoney(Number(cashAmount))} 记录已保存。`);
  };
  const clearRecords = () => {
    if (!window.confirm('清空全部持仓、资金余额和交易记录？\n\n自选股和观察组合会保留，清空后可以重新录入实盘数据。')) return;
    onCommit(clearLiveAccountRecords(state));
    setNotice('实盘账户记录已清空，可以重新录入。');
  };

  return <div className="market-root-page">
    <section className="market-trade-ticket market-card" aria-label="实盘交易记录">
      <header><span><em>实盘记录</em><strong>{quote?.name ?? '选择股票'}</strong></span><b className={quote ? changeTone(quote.changePct) : 'flat'}>{quote ? `${quote.price.toFixed(2)} ${formatPercent(quote.changePct)}` : '—'}</b></header>
      <p className="market-record-disclaimer">手工记录已发生的实盘操作，仅保存在本地；不连接券商，不会发起下单。也可在对话中说：“记录 7 月 30 日 10:15 以 210 元买入宁德时代 300 股”。</p>
      <div className="market-buy-sell"><button type="button" className={side === 'buy' ? 'active buy' : ''} onClick={() => setSide('buy')}>记录买入</button><button type="button" className={side === 'sell' ? 'active sell' : ''} onClick={() => setSide('sell')}>记录卖出</button></div>
      <form onSubmit={submit}>
        <label>股票<select value={code} onChange={(event) => setCode(event.target.value)}>{quotes.slice(0, 200).map((item) => <option key={item.code} value={item.code}>{item.name} {shortCode(item.code)}</option>)}</select></label>
        <div className="market-order-grid"><label>成交价格<input value={price} inputMode="decimal" onChange={(event) => setPrice(event.target.value)} /></label><label>成交数量<input value={quantity} inputMode="numeric" onChange={(event) => setQuantity(event.target.value)} /></label></div>
        <label>成交日期与时间<input type="datetime-local" value={recordedAt} onChange={(event) => setRecordedAt(event.target.value)} /></label>
        <div className="market-order-summary"><span>当前记录现金 <strong>{formatMoney(state.cash)}</strong></span><span>成交金额 <strong>{formatMoney(Number(price) * Number(quantity) || 0)}</strong></span></div>
        <button type="submit" className={`market-submit-order ${side}`}>{side === 'buy' ? '保存买入记录' : '保存卖出记录'}</button>
      </form>{notice && <p className="market-trade-notice">{notice}</p>}
    </section>
    <section className="market-card"><SectionHeading title="资金记录" meta="仅用于还原实盘账户" /><div className="market-cash-flow"><label aria-label="入金出金金额">金额<input value={cashAmount} onChange={(event) => setCashAmount(event.target.value)} /></label><button type="button" onClick={() => cashFlow('deposit')}>记录入金</button><button type="button" onClick={() => cashFlow('withdraw')}>记录出金</button></div><p className="market-cash-hint">也可在对话中说：“给账户增加资金 10 万元”或“从账户减少资金 2 万元”。</p></section>
    <section className="market-card"><SectionHeading title="当前持仓" meta={`${state.holdings.length} 只`} />{state.holdings.length ? <div className="market-feature-list">{state.holdings.map((holding) => { const item = quotes.find((candidate) => candidate.code === holding.code); return item ? <button key={holding.code} type="button" onClick={() => onRoute({ kind: 'stock', code: holding.code })}><span><strong>{item.name}</strong><em>{holding.quantity} 股 · 成本 {holding.avgCost.toFixed(2)}</em></span><ChevronRight size={14} /></button> : null; })}</div> : <EmptyState title="暂无持仓" detail="录入实盘买入记录后，持仓会显示在这里。" />}</section>
    <section className="market-card"><SectionHeading title="最近实盘记录" meta={`${state.trades.length} 条`} />{state.trades.length ? <div className="market-trade-log">{state.trades.slice(0, 8).map((trade) => <div key={trade.id}><span><strong>{tradeKindLabel(trade.kind)} {trade.name ?? ''}</strong><em>{new Date(trade.createdAt).toLocaleString('zh-CN', { hour12: false })}</em></span><b>{trade.quantity ? `${trade.quantity} 股 · ` : ''}{formatMoney(trade.amount)}</b></div>)}</div> : <EmptyState title="暂无交易记录" detail="录入后会按成交时间展示。" />}<div className="market-record-reset"><p>重新录入前，可一次清空资金、持仓与流水；自选和观察组合不受影响。</p><button type="button" onClick={clearRecords} disabled={!state.cash && !state.holdings.length && !state.trades.length}><Trash2 size={13} />清空并重新录入</button></div></section>
  </div>;
}

function AssetsHome({ state, summary, quoteMap, onRoute }: { state: ResearchState; summary: ReturnType<typeof researchAccountSummary>; quoteMap: Map<string, ResearchQuote>; onRoute: (route: MarketRoute) => void }) {
  return <div className="market-root-page"><section className="market-assets-hero" draggable onDragStart={(event) => startResearchDrag(event, marketPrompt('实盘账户记录', [`总资产 ${formatMoney(summary.totalAssets)}，现金 ${formatMoney(state.cash)}，浮盈亏 ${formatSignedMoney(summary.pnl)}。`]))}><span>总资产 · 实盘记录</span><strong>{formatMoney(summary.totalAssets)}</strong><div><span>浮盈亏 <b className={changeTone(summary.pnl)}>{formatSignedMoney(summary.pnl)}</b></span><span>仓位 <b>{formatPercent(summary.exposurePct)}</b></span></div></section><section className="market-card"><SectionHeading title="持仓" meta={`${summary.holdings.length} 只`} />{summary.holdings.length ? <div className="market-preview-list">{summary.holdings.map((holding) => <StockRow key={holding.code} quote={holding.quote} watched={state.watchlist.includes(holding.code)} metric={`${holding.quantity} 股 · ${formatSignedMoney(holding.pnl)}`} onOpen={() => onRoute({ kind: 'stock', code: holding.code })} />)}</div> : <EmptyState title="当前空仓" detail="资产页只显示你手工录入的实盘持仓，不填充演示仓位。" />}</section><section className="market-card"><SectionHeading title="组合与记录" /><div className="market-feature-list"><button type="button" onClick={() => onRoute({ kind: 'feature', feature: 'portfolio' })}><i><BriefcaseBusiness size={15} /></i><span><strong>股票组合</strong><em>{state.portfolios.length} 个观察组合</em></span><ChevronRight size={14} /></button><button type="button" onClick={() => insertIntoComposer(marketPrompt('实盘交易记录', state.trades.slice(0, 20).map((trade) => `${tradeKindLabel(trade.kind)} ${trade.name ?? ''} ${formatMoney(trade.amount)}`)))}><i><Activity size={15} /></i><span><strong>实盘交易记录</strong><em>{state.trades.length} 条本地记录</em></span><ChevronRight size={14} /></button></div></section></div>;
}

function DiscoverHome({ state, onRoute }: { state: ResearchState; onRoute: (route: MarketRoute) => void }) {
  return <div className="market-root-page"><section className="market-discover-hero"><span><Sparkles size={15} /> Alpha Research</span><strong>从行情进入研究，而不是堆功能页</strong><p>每个入口都是独立二级页面；卡片也可以拖入旁边对话框继续分析。</p></section><section className="market-card"><SectionHeading title="研究工具" /><div className="market-discover-grid">{(Object.keys(FEATURE_META) as FeatureKind[]).map((kind) => { const item = FEATURE_META[kind]; const Icon = item.icon; return <button key={kind} type="button" draggable onDragStart={(event) => startResearchDrag(event, item.prompt)} onClick={() => onRoute({ kind: 'feature', feature: kind })}><i><Icon size={17} /></i><span><strong>{item.title}</strong><em>{item.eyebrow}</em></span></button>; })}</div></section><section className="market-card"><SectionHeading title="我的研究" /><div className="market-feature-list"><button type="button" onClick={() => onRoute({ kind: 'feature', feature: 'portfolio' })}><i><BriefcaseBusiness size={15} /></i><span><strong>观察组合</strong><em>{state.portfolios.length} 个组合</em></span><ChevronRight size={14} /></button><button type="button" onClick={() => insertIntoComposer('请根据当前自选、持仓、行情宽度和热门主题生成一份今日 A 股复盘。')}><i><Newspaper size={15} /></i><span><strong>生成市场复盘</strong><em>交给 Agent 汇总事实与风险</em></span><ChevronRight size={14} /></button></div></section></div>;
}

function SearchPage({ quotes, state, onStock, onToggle }: { quotes: ResearchQuote[]; state: ResearchState; onStock: (code: string) => void; onToggle: (quote: ResearchQuote) => void }) {
  const [query, setQuery] = useState('');
  const result = useMemo(() => { const normalized = query.trim().toLowerCase(); return quotes.filter((quote) => !normalized || [quote.name, quote.code, shortCode(quote.code), quote.sector].join(' ').toLowerCase().includes(normalized)).slice(0, 80); }, [query, quotes]);
  return <div className="market-secondary-page"><div className="market-search-box"><Search size={16} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="股票名称、代码或行业" /></div><div className="market-preview-list">{result.map((quote) => <StockRow key={quote.code} quote={quote} watched={state.watchlist.includes(quote.code)} onOpen={() => onStock(quote.code)} onWatch={() => onToggle(quote)} showChevron={false} />)}</div></div>;
}

function StockPage({ quote, quotes, state, summary, onToggle, onTrade, onStock }: { quote: ResearchQuote | null; quotes: ResearchQuote[]; state: ResearchState; summary: ReturnType<typeof researchAccountSummary>; onToggle: (quote: ResearchQuote) => void; onTrade: (side: ResearchOrderSide, quote: ResearchQuote) => void; onStock: (code: string) => void }) {
  const [tab, setTab] = useState<'quote' | 'position' | 'capital' | 'research'>('quote');
  if (!quote) return <EmptyState title="股票行情不可用" detail="当前真实行情池未返回该标的，请稍后刷新。" />;
  const peers = quotes.filter((item) => item.sector === quote.sector && item.code !== quote.code).sort((a, b) => quoteTurnover(b) - quoteTurnover(a)).slice(0, 5);
  const range = quote.high > quote.low ? ((quote.price - quote.low) / (quote.high - quote.low)) * 100 : 50;
  const holding = summary.holdings.find((item) => item.code === quote.code);
  const openedLabel = holding ? new Date(holding.openedAt).toLocaleDateString('zh-CN') : '';
  return <div className="market-secondary-page stock-detail-page">
    <section className="stock-quote-hero" draggable onDragStart={(event) => startResearchDrag(event, securityPrompt(quote))}>
      <header><span><strong>{quote.name}</strong><em>{quote.code} · {quote.board}</em></span><button type="button" className={state.watchlist.includes(quote.code) ? 'active' : ''} onClick={() => onToggle(quote)}><Star size={16} fill={state.watchlist.includes(quote.code) ? 'currentColor' : 'none'} />{state.watchlist.includes(quote.code) ? '已自选' : '加自选'}</button></header>
      <div className={changeTone(quote.changePct)}><strong>{quote.price.toFixed(2)}</strong><span>{formatSignedMoney(quote.changeAmt)}<br />{formatPercent(quote.changePct)}</span></div>
      <p>{quote.sector} · {quote.tags.join(' · ') || '沪深股票'} · {quoteSourceLabel(quote.source)}</p>
    </section>
    <div className="stock-detail-tabs" role="tablist" aria-label="股票详情页签">
      <button type="button" role="tab" aria-selected={tab === 'quote'} onClick={() => setTab('quote')}>行情</button>
      <button type="button" role="tab" aria-selected={tab === 'position'} onClick={() => setTab('position')}>持仓{holding && <i aria-hidden="true" />}</button>
      <button type="button" role="tab" aria-selected={tab === 'capital'} onClick={() => setTab('capital')}>资金</button>
      <button type="button" role="tab" aria-selected={tab === 'research'} onClick={() => setTab('research')}>研究</button>
    </div>
    {tab === 'quote' && <><StockKlineChart quote={quote} /><section className="market-card"><SectionHeading title="日内行情" meta="真实快照" /><div className="stock-range"><span>最低 {quote.low.toFixed(2)}</span><i><b style={{ left: `${Math.max(0, Math.min(100, range))}%` }} /></i><span>最高 {quote.high.toFixed(2)}</span></div><div className="stock-metric-grid"><span><em>今开</em><strong>{quote.open?.toFixed(2) ?? '—'}</strong></span><span><em>昨收</em><strong>{quote.prevClose.toFixed(2)}</strong></span><span><em>成交额</em><strong>{formatMoney(quoteTurnover(quote))}</strong></span><span><em>换手率</em><strong>{quote.turnoverRate === undefined ? '—' : formatPercent(quote.turnoverRate)}</strong></span><span><em>量比</em><strong>{quote.volumeRatio?.toFixed(2) ?? '—'}</strong></span><span><em>总市值</em><strong>{formatMoney(quote.marketCap * 100_000_000)}</strong></span></div></section><section className="market-card"><SectionHeading title="同行业" meta={quote.sector} /><div className="market-preview-list">{peers.map((peer) => <StockRow key={peer.code} quote={peer} watched={state.watchlist.includes(peer.code)} onOpen={() => onStock(peer.code)} />)}</div></section></>}
    {tab === 'position' && (holding ? <section className="market-card stock-position-card" aria-label={`${quote.name}持仓信息`}>
      <header className="stock-position-heading"><span><i><BriefcaseBusiness size={15} /></i><span><strong>我的持仓</strong><em>本地实盘记录 · 建仓于 {openedLabel}</em></span></span><b>{holding.quantity.toLocaleString('zh-CN')} 股</b></header>
      <div className="stock-position-pnl">
        <span><em>持仓盈亏</em><strong className={changeTone(holding.pnl)}>{formatPositionMoney(holding.pnl, true)}</strong><b className={changeTone(holding.pnlPct)}>{formatPercent(holding.pnlPct)}</b></span>
        <span><em>今日盈亏</em><strong className={changeTone(holding.todayPnl)}>{formatPositionMoney(holding.todayPnl, true)}</strong><b className={changeTone(holding.todayPnlPct)}>{formatPercent(holding.todayPnlPct)}</b></span>
      </div>
      <div className="stock-position-grid">
        <span><em>持股市值</em><strong>{formatPositionMoney(holding.marketValue)}</strong></span>
        <span><em>持有数量</em><strong>{holding.quantity.toLocaleString('zh-CN')} 股</strong></span>
        <span><em>摊薄成本</em><strong>{holding.avgCost.toFixed(2)}</strong></span>
        <span><em>可卖数量</em><strong>{holding.quantity.toLocaleString('zh-CN')} 股</strong></span>
        <span><em>当前价格</em><strong>{quote.price.toFixed(2)}</strong></span>
        <span><em>持仓占比</em><strong>{formatPositionWeight(holding.weightPct)}</strong></span>
      </div>
      <p className="stock-position-note">盈亏按最新行情与摊薄成本估算，暂未计入佣金、税费和滑点。</p>
      <button type="button" className="market-agent-action" onClick={() => insertIntoComposer(holdingPrompt(holding))}><Sparkles size={15} />交给 Agent 分析持仓</button>
    </section> : <section className="market-card stock-position-card" aria-label={`${quote.name}持仓信息`}><EmptyState title="暂无该股票持仓" detail="录入实盘买入记录后，这里会自动计算市值、持仓盈亏、今日盈亏和仓位占比。" action="记录买入" onAction={() => onTrade('buy', quote)} /></section>)}
    {tab === 'capital' && <section className="market-card"><SectionHeading title="资金与活跃度" meta="基于当前行情字段" /><div className="stock-metric-grid"><span><em>成交额</em><strong>{formatMoney(quoteTurnover(quote))}</strong></span><span><em>成交量</em><strong>{quote.volumeShares ? formatMoney(quote.volumeShares) : formatMoney(quote.volume * 1_000_000)}</strong></span><span><em>换手率</em><strong>{quote.turnoverRate === undefined ? '—' : formatPercent(quote.turnoverRate)}</strong></span><span><em>量比</em><strong>{quote.volumeRatio?.toFixed(2) ?? '—'}</strong></span></div><button type="button" className="market-agent-action" onClick={() => insertIntoComposer(securityPrompt(quote))}><Sparkles size={15} />交给 Agent 分析资金与量价</button></section>}
    {tab === 'research' && <section className="market-card"><SectionHeading title="公司研究" meta="事实与观点分开" /><div className="stock-thesis"><strong>研究起点</strong><p>{quote.thesis || '从财务、行业、估值、催化和风险五个维度建立研究。'}</p></div><div className="market-feature-list">{(['earnings', 'dividend', 'calendar'] as FeatureKind[]).map((kind) => <button key={kind} type="button" onClick={() => insertIntoComposer(`${FEATURE_META[kind].prompt}\n重点研究：${quote.name}（${quote.code}）。`)}><span><strong>{FEATURE_META[kind].title}</strong><em>围绕 {quote.name} 深入核验</em></span><ChevronRight size={14} /></button>)}</div></section>}
    <div className="stock-trade-bar"><button type="button" className="sell" onClick={() => onTrade('sell', quote)}>记录卖出</button><button type="button" className="buy" onClick={() => onTrade('buy', quote)}>记录买入</button></div>
  </div>;
}

function IndexPage({ index }: { index: ReturnType<typeof buildIndexQuotes>[number] | undefined }) {
  if (!index) return <EmptyState title="指数行情不可用" detail="刷新真实行情后再查看指数详情。" />;
  return <div className="market-secondary-page"><section className={`stock-quote-hero ${changeTone(index.changePct)}`} draggable onDragStart={(event) => startResearchDrag(event, marketPrompt(index.name, [`点位 ${index.price.toFixed(2)}，涨跌幅 ${formatPercent(index.changePct)}。`]))}><header><span><strong>{index.name}</strong><em>{index.code}</em></span></header><div className={changeTone(index.changePct)}><strong>{index.price.toFixed(2)}</strong><span>{formatSignedMoney(index.changeAmt)}<br />{formatPercent(index.changePct)}</span></div><p>指数快照 · 点击返回不会改变市场首页滚动状态</p></section><section className="market-card"><SectionHeading title="指数研究" /><button type="button" className="market-agent-action" onClick={() => insertIntoComposer(marketPrompt(index.name, [`当前点位 ${index.price.toFixed(2)}，涨跌 ${formatPercent(index.changePct)}。`, '请结合市场宽度、成交额和领涨板块解释指数表现。']))}><Sparkles size={15} />交给 Agent 解读</button></section></div>;
}

function ListPage({ kind, quotes, state, onStock, onToggle }: { kind: MarketListKind; quotes: ResearchQuote[]; state: ResearchState; onStock: (code: string) => void; onToggle: (quote: ResearchQuote) => void }) {
  const sorted = useMemo(() => { const list = [...quotes]; if (kind === 'gainers') return list.sort((a, b) => b.changePct - a.changePct); if (kind === 'turnover') return list.sort((a, b) => quoteTurnover(b) - quoteTurnover(a)); if (kind === 'signals') return list.filter((quote) => quote.volumeRatio || quote.turnoverRate).sort((a, b) => ((b.volumeRatio ?? 0) * 4 + (b.turnoverRate ?? 0)) - ((a.volumeRatio ?? 0) * 4 + (a.turnoverRate ?? 0))); if (kind === 'connect') return list.sort((a, b) => (b.marketCap + quoteTurnover(b) / 100_000_000) - (a.marketCap + quoteTurnover(a) / 100_000_000)); return list.sort((a, b) => shortCode(a.code).localeCompare(shortCode(b.code))); }, [kind, quotes]);
  return <div className="market-secondary-page"><div className="market-list-filter"><button type="button" className="active">全部股票</button><button type="button">实时</button><span>{sorted.length} 只</span></div>{kind === 'connect' && <p className="market-source-note"><Database size={13} />当前为大市值与流动性代理排序，不冒充官方沪深股通成分；分析时需核验最新资格名单。</p>}<div className="market-preview-list">{sorted.slice(0, 160).map((quote) => <StockRow key={quote.code} quote={quote} watched={state.watchlist.includes(quote.code)} metric={kind === 'turnover' ? formatMoney(quoteTurnover(quote)) : kind === 'signals' ? `量比 ${(quote.volumeRatio ?? 0).toFixed(2)}` : undefined} onOpen={() => onStock(quote.code)} onWatch={() => onToggle(quote)} />)}</div></div>;
}

function ThemesPage({ quotes, onTheme }: { quotes: ResearchQuote[]; onTheme: (sector: string) => void }) {
  const themes = computeSectorHeat(quotes);
  return <div className="market-secondary-page"><div className="market-theme-list">{themes.map((theme, index) => <button key={theme.sector} type="button" className={changeTone(theme.avgPct)} draggable onDragStart={(event) => startResearchDrag(event, marketPrompt(theme.sector, [`平均涨跌 ${formatPercent(theme.avgPct)}，样本 ${theme.count} 只。`]))} onClick={() => onTheme(theme.sector)}><i>{index + 1}</i><span><strong>{theme.sector}</strong><em>{theme.count} 只成分</em></span><b>{formatPercent(theme.avgPct)}</b><ChevronRight size={14} /></button>)}</div></div>;
}

type HeatView = 'map' | 'list';
type HeatFilter = 'all' | 'up' | 'down';

const HEAT_TILE_PATTERN = [
  'xl', 'xl', 'wide', 'wide', 'large', 'wide', 'tall', 'wide', 'large', 'wide',
  'wide', 'large', 'tall', 'wide', 'small', 'small', 'wide', 'small', 'small', 'small',
];

function heatIntensity(changePct: number): string {
  const level = Math.max(1, Math.min(5, Math.ceil(Math.abs(changePct) / 1.5)));
  return `heat-${level}`;
}

function HeatMapPage({ quotes, onTheme }: { quotes: ResearchQuote[]; onTheme: (sector: string) => void }) {
  const [view, setView] = useState<HeatView>('map');
  const [filter, setFilter] = useState<HeatFilter>('all');
  const themes = useMemo(() => computeSectorHeat(quotes), [quotes]);
  const visibleThemes = useMemo(() => themes.filter((theme) => {
    if (filter === 'up') return theme.avgPct > 0;
    if (filter === 'down') return theme.avgPct < 0;
    return true;
  }), [filter, themes]);

  return <div className="market-secondary-page market-heat-page">
    <div className="market-heat-toolbar">
      <div className="market-heat-view-switch" role="tablist" aria-label="热力图显示方式">
        <button type="button" role="tab" aria-selected={view === 'map'} onClick={() => setView('map')} aria-label="矩形热力图"><LayoutGrid size={15} /><span>热力</span></button>
        <button type="button" role="tab" aria-selected={view === 'list'} onClick={() => setView('list')} aria-label="排行列表"><List size={15} /><span>排行</span></button>
      </div>
      <label className="market-heat-filter"><SlidersHorizontal size={14} /><span>筛选</span><select value={filter} onChange={(event) => setFilter(event.target.value as HeatFilter)} aria-label="板块筛选"><option value="all">全部</option><option value="up">上涨</option><option value="down">下跌</option></select></label>
    </div>

    {view === 'map' ? <div className="market-heat-treemap" aria-label="板块热力图">
      {visibleThemes.map((theme, index) => <button
        key={theme.sector}
        type="button"
        className={`${changeTone(theme.avgPct)} ${heatIntensity(theme.avgPct)} ${HEAT_TILE_PATTERN[index % HEAT_TILE_PATTERN.length]}`}
        draggable
        onDragStart={(event) => startResearchDrag(event, marketPrompt(theme.sector, [`平均涨跌 ${formatPercent(theme.avgPct)}，样本 ${theme.count} 只。`]))}
        onClick={() => onTheme(theme.sector)}
        aria-label={`${theme.sector} ${formatPercent(theme.avgPct)}`}
      ><strong>{theme.sector}</strong><span>{formatPercent(theme.avgPct)}</span><em>{theme.count} 只</em></button>)}
    </div> : <div className="market-heat-ranking" aria-label="板块涨跌幅排行">
      <header><span>板块名称</span><span>成分数</span><span>日涨跌幅</span></header>
      {visibleThemes.map((theme) => <button
        key={theme.sector}
        type="button"
        className={changeTone(theme.avgPct)}
        draggable
        onDragStart={(event) => startResearchDrag(event, marketPrompt(theme.sector, [`平均涨跌 ${formatPercent(theme.avgPct)}，样本 ${theme.count} 只。`]))}
        onClick={() => onTheme(theme.sector)}
      ><strong>{theme.sector}</strong><em>{theme.count} 只</em><span>{formatPercent(theme.avgPct)}</span><ChevronRight size={13} /></button>)}
    </div>}

    {!visibleThemes.length && <EmptyState title="暂无符合条件的板块" detail="切换筛选条件查看其他板块。" />}
  </div>;
}

function ThemePage({ sector, quotes, state, onStock, onToggle }: { sector: string; quotes: ResearchQuote[]; state: ResearchState; onStock: (code: string) => void; onToggle: (quote: ResearchQuote) => void }) {
  const members = quotes.filter((quote) => quote.sector === sector).sort((a, b) => b.changePct - a.changePct);
  const avg = members.length ? members.reduce((sum, quote) => sum + quote.changePct, 0) / members.length : 0;
  return <div className="market-secondary-page"><section className={`market-theme-hero ${changeTone(avg)}`} draggable onDragStart={(event) => startResearchDrag(event, marketPrompt(sector, [`板块平均涨跌 ${formatPercent(avg)}，共 ${members.length} 只。`]))}><span>板块平均涨跌</span><strong>{formatPercent(avg)}</strong><em>{members.length} 只行情样本</em></section><section className="market-card"><SectionHeading title="板块成分" meta="点击进入股票详情" /><div className="market-preview-list">{members.map((quote) => <StockRow key={quote.code} quote={quote} watched={state.watchlist.includes(quote.code)} onOpen={() => onStock(quote.code)} onWatch={() => onToggle(quote)} />)}</div></section></div>;
}

function EtfPage({ quotes, state, onStock }: { quotes: ResearchQuote[]; state: ResearchState; onStock: (code: string) => void }) {
  const [sort, setSort] = useState<'turnover' | 'gainers' | 'code'>('turnover');
  const etfs = useMemo(() => quotes.filter(isEtfQuote), [quotes]);
  const sorted = useMemo(() => {
    const list = [...etfs];
    if (sort === 'gainers') return list.sort((a, b) => b.changePct - a.changePct);
    if (sort === 'code') return list.sort((a, b) => shortCode(a.code).localeCompare(shortCode(b.code)));
    return list.sort((a, b) => quoteTurnover(b) - quoteTurnover(a));
  }, [etfs, sort]);
  const meta = FEATURE_META.etf;
  return <div className="market-secondary-page">
    <section className="market-feature-hero" draggable onDragStart={(event) => startResearchDrag(event, meta.prompt)}><i><BarChart3 size={20} /></i><span><em>{meta.eyebrow}</em><strong>{meta.title}</strong><p>A 股场内 ETF 实时行情，覆盖沪深交易所上市品种</p></span></section>
    <div className="market-list-filter" role="tablist" aria-label="ETF 排序">
      <button type="button" role="tab" aria-selected={sort === 'turnover'} className={sort === 'turnover' ? 'active' : ''} onClick={() => setSort('turnover')}>成交额</button>
      <button type="button" role="tab" aria-selected={sort === 'gainers'} className={sort === 'gainers' ? 'active' : ''} onClick={() => setSort('gainers')}>涨幅</button>
      <button type="button" role="tab" aria-selected={sort === 'code'} className={sort === 'code' ? 'active' : ''} onClick={() => setSort('code')}>代码</button>
      <span>{etfs.length} 只</span>
    </div>
    {sorted.length ? <div className="market-preview-list">{sorted.slice(0, 160).map((quote) => <StockRow key={quote.code} quote={quote} watched={state.watchlist.includes(quote.code)} metric={formatMoney(quoteTurnover(quote))} onOpen={() => onStock(quote.code)} />)}</div> : <section className="market-card"><EmptyState title="ETF 行情暂不可用" detail="云端行情尚未返回 A 股 ETF，请刷新或检查服务端行情容量。" /></section>}
    <button type="button" className="market-agent-action market-agent-sticky" onClick={() => insertIntoComposer(meta.prompt)}><Sparkles size={15} />交给 Agent 继续研究</button>
  </div>;
}

function FeaturePage({ kind, quotes, state, onStock }: { kind: FeatureKind; quotes: ResearchQuote[]; state: ResearchState; onStock: (code: string) => void }) {
  const meta = FEATURE_META[kind]; const Icon = meta.icon;
  const candidates = useMemo(() => { if (kind === 'dividend') return quotes.filter((quote) => quote.tags.includes('高股息')).slice(0, 12); if (kind === 'screener') return [...quotes].filter((quote) => quote.changePct > 0).sort((a, b) => quoteTurnover(b) - quoteTurnover(a)).slice(0, 12); return []; }, [kind, quotes]);
  if (kind === 'etf') return <EtfPage quotes={quotes} state={state} onStock={onStock} />;
  return <div className="market-secondary-page"><section className="market-feature-hero" draggable onDragStart={(event) => startResearchDrag(event, meta.prompt)}><i><Icon size={20} /></i><span><em>{meta.eyebrow}</em><strong>{meta.title}</strong><p>{meta.detail}</p></span></section>{kind === 'portfolio' ? <section className="market-card"><SectionHeading title="观察组合" meta={`${state.portfolios.length} 个`} /><div className="market-portfolio-list">{state.portfolios.map((portfolio) => <article key={portfolio.id} draggable onDragStart={(event) => startResearchDrag(event, marketPrompt(portfolio.name, [`成分：${portfolio.codes.join('、')}。`, portfolio.note]))}><header><strong>{portfolio.name}</strong><em>{portfolio.codes.length} 只</em></header><p>{portfolio.note || '暂无备注'}</p><div>{portfolio.codes.map((code) => { const quote = quotes.find((item) => item.code === code); return quote ? <button key={code} type="button" onClick={() => onStock(code)}>{quote.name}</button> : null; })}</div></article>)}</div></section> : candidates.length ? <section className="market-card"><SectionHeading title={kind === 'dividend' ? '高股息观察池' : '筛选结果'} meta="需继续核验" /><div className="market-preview-list">{candidates.map((quote) => <StockRow key={quote.code} quote={quote} watched={state.watchlist.includes(quote.code)} onOpen={() => onStock(quote.code)} />)}</div></section> : <section className="market-card"><div className="market-feature-guidance"><Database size={20} /><strong>进入数据核验流程</strong><p>该页面不展示伪造日历或预测值。点击下方按钮，把当前研究目标交给 Agent，通过已授权数据源或公开资料核验。</p></div></section>}<button type="button" className="market-agent-action market-agent-sticky" onClick={() => insertIntoComposer(meta.prompt)}><Sparkles size={15} />交给 Agent 继续研究</button></div>;
}

export function ResearchWorkbenchPanel() {
  const [state, setState] = useState<ResearchState>(() => loadResearchState());
  const [primary, setPrimary] = useState<PrimarySection>('market');
  const [routes, setRoutes] = useState<MarketRoute[]>([{ kind: 'root' }]);
  const [quotes, setQuotes] = useState<ResearchQuote[]>([]);
  const [overrides, setOverrides] = useState<Map<string, LivePriceOverride>>(new Map());
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState('等待行情');
  const [tradePrefill, setTradePrefill] = useState<TradePrefill | null>(null);
  const stateRef = useRef(state); stateRef.current = state;
  const refreshingRef = useRef(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const route = routes[routes.length - 1];

  const commit = useCallback((next: ResearchState) => {
    setState(next); saveResearchState(next);
    scheduleLocalStoreCommit('research', { research: next, audit: { domain: 'research', action: 'state.persist', payload: { holdings: next.holdings.length, watchlist: next.watchlist.length, trades: next.trades.length } } });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadLocalStoreSnapshot().then((snapshot) => { if (!cancelled && snapshot?.research) setState(normalizeResearchState(snapshot.research as Partial<ResearchState>)); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const syncResearchState = () => {
      const next = loadResearchState();
      stateRef.current = next;
      setState(next);
    };
    window.addEventListener(RESEARCH_STATE_CHANGE_EVENT, syncResearchState);
    window.addEventListener('storage', syncResearchState);
    return () => {
      window.removeEventListener(RESEARCH_STATE_CHANGE_EVENT, syncResearchState);
      window.removeEventListener('storage', syncResearchState);
    };
  }, []);

  const refresh = useCallback(async (forceRefresh = false) => {
    if (refreshingRef.current) return;
    refreshingRef.current = true; setRefreshing(true); setStatus('行情读取中');
    try {
      const current = stateRef.current;
      const codes = Array.from(new Set([...RESEARCH_INDEXES.map((item) => item.code), ...RESEARCH_CATALOG.map((item) => item.code), ...current.watchlist, ...current.holdings.map((item) => item.code), ...Object.keys(current.customSecurities)]));
      const [market, realtime] = await Promise.all([fetchCloudFullMarket(8000, { forceRefresh }), fetchCloudRealtimeBatch(codes, { forceRefresh })]);
      const nextOverrides = new Map(realtime.prices);
      market.quotes.forEach((quote) => nextOverrides.set(quote.code, quoteOverride(quote)));
      setQuotes(market.quotes); setOverrides(nextOverrides);
      const label = market.asOfLabel ?? realtime.asOfLabel ?? new Date().toLocaleTimeString('zh-CN', { hour12: false });
      setStatus(market.quotes.length || realtime.prices.size ? `${market.cached || realtime.cached ? '云端缓存' : '云端实时'} ${label}` : '行情不可用');
    } catch {
      setStatus('行情不可用');
    } finally {
      refreshingRef.current = false; setRefreshing(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => subscribeCloudMarket((update) => {
    setQuotes(update.quotes);
    setOverrides(update.prices);
    setStatus(`${update.cached ? '云端缓存' : '云端推送'} ${update.asOfLabel ?? ''}`.trim());
  }, () => setStatus('云端广播重连中')), []);

  const catalogMap = useMemo(() => buildQuoteMap(state, overrides), [state, overrides]);
  const quoteMap = useMemo(() => { const map = new Map<string, ResearchQuote>(); quotes.forEach((quote) => map.set(quote.code, quote)); catalogMap.forEach((quote, code) => { if (quote.source !== 'sample' && !map.has(code)) map.set(code, quote); }); return map; }, [catalogMap, quotes]);
  const universe = useMemo(() => Array.from(quoteMap.values()), [quoteMap]);
  const stockUniverse = useMemo(() => universe.filter((quote) => !isEtfQuote(quote)), [universe]);
  const indexQuotes = useMemo(() => buildIndexQuotes(overrides).filter((index) => index.source !== 'sample'), [overrides]);
  const summary = useMemo(() => researchAccountSummary(state, quoteMap), [quoteMap, state]);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    if (typeof body.scrollTo === 'function') body.scrollTo({ top: 0 });
    else body.scrollTop = 0;
  }, [primary, route]);

  const push = (next: MarketRoute) => setRoutes((current) => [...current, next]);
  const back = () => setRoutes((current) => current.length > 1 ? current.slice(0, -1) : current);
  const goPrimary = (next: PrimarySection) => { setPrimary(next); setRoutes([{ kind: 'root' }]); };
  const openStock = (code: string) => push({ kind: 'stock', code });
  const toggleQuote = (quote: ResearchQuote) => {
    const registered = registerCustomSecurity(stateRef.current, quote.code, { name: quote.name, sector: quote.sector, basePrice: quote.price });
    commit(toggleWatchlist(registered, quote.code));
  };
  const openTrade = (side: ResearchOrderSide, quote: ResearchQuote) => {
    const registered = registerCustomSecurity(stateRef.current, quote.code, { name: quote.name, sector: quote.sector, basePrice: quote.price });
    if (registered !== stateRef.current) commit(registered);
    setTradePrefill({ side, code: quote.code, price: quote.price });
    goPrimary('trade');
  };

  const renderPage = () => {
    if (route.kind === 'search') return <SearchPage quotes={universe} state={state} onStock={openStock} onToggle={toggleQuote} />;
    if (route.kind === 'stock') return <StockPage quote={quoteMap.get(route.code) ?? null} quotes={universe} state={state} summary={summary} onToggle={toggleQuote} onTrade={openTrade} onStock={openStock} />;
    if (route.kind === 'index') return <IndexPage index={indexQuotes.find((item) => item.code === route.code)} />;
    if (route.kind === 'list') return <ListPage kind={route.list} quotes={stockUniverse} state={state} onStock={openStock} onToggle={toggleQuote} />;
    if (route.kind === 'heat') return <HeatMapPage quotes={stockUniverse} onTheme={(sector) => push({ kind: 'theme', sector })} />;
    if (route.kind === 'themes') return <ThemesPage quotes={stockUniverse} onTheme={(sector) => push({ kind: 'theme', sector })} />;
    if (route.kind === 'theme') return <ThemePage sector={route.sector} quotes={stockUniverse} state={state} onStock={openStock} onToggle={toggleQuote} />;
    if (route.kind === 'feature') return <FeaturePage kind={route.feature} quotes={route.feature === 'etf' ? universe : stockUniverse} state={state} onStock={openStock} />;
    if (primary === 'watchlist') return <WatchlistHome state={state} quotes={universe} onRoute={push} />;
    if (primary === 'trade') return <TradeHome quotes={universe} state={state} initial={tradePrefill} onCommit={commit} onRoute={push} />;
    if (primary === 'assets') return <AssetsHome state={state} summary={summary} quoteMap={quoteMap} onRoute={push} />;
    if (primary === 'discover') return <DiscoverHome state={state} onRoute={push} />;
    return <MarketHome quotes={stockUniverse} indexQuotes={indexQuotes} state={state} loading={refreshing} onRoute={push} />;
  };

  const secondary = route.kind !== 'root';
  return (
    <section className="market-app right-dock-panel" aria-label="投研工作台">
      <header className={`market-app-header ${secondary ? 'secondary' : ''}`}>
        {secondary ? <button type="button" className="market-header-back" onClick={back} aria-label="返回上一级"><ArrowLeft size={18} /></button> : <span className="market-app-logo"><TrendingUp size={17} /></span>}
        <span className="market-header-title"><h2>{secondary ? routeTitle(route, quoteMap) : primaryTitle(primary)}</h2>{!secondary && <em>{status}</em>}</span>
        <div className="market-header-actions">
          {!secondary && <button type="button" onClick={() => push({ kind: 'search' })} aria-label="搜索股票"><Search size={17} /></button>}
          <button type="button" onClick={() => void refresh(true)} disabled={refreshing} aria-label="刷新行情">{refreshing ? <Loader2 size={17} className="spin" /> : <RefreshCw size={17} />}</button>
        </div>
      </header>
      <div ref={bodyRef} className="market-app-body">{renderPage()}</div>
      <nav className="market-bottom-nav" role="tablist" aria-label="投研工作台主导航">{PRIMARY_NAV.map((item) => { const Icon = item.icon; const selected = !secondary && primary === item.id; return <button key={item.id} type="button" role="tab" aria-selected={selected} className={selected ? 'active' : ''} onClick={() => goPrimary(item.id)}><Icon size={17} fill={item.id === 'watchlist' && selected ? 'currentColor' : 'none'} /><span>{item.label}</span>{item.id === 'watchlist' && state.watchlist.length > 0 && <em>{state.watchlist.length}</em>}</button>; })}</nav>
    </section>
  );
}
