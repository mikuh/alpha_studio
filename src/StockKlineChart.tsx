import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  createChart,
  type CandlestickData,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { ChartCandlestick } from 'lucide-react';
import { fetchJqDailyBars, fetchJqHistoricalBars, type JqDailyBar, type JqHistoricalBar } from './jqdata';
import { sampleBars, type ResearchQuote } from './research';

type KlineInterval = '1m' | '5m' | '1d' | '1w' | '1mo';
type ChartSource = 'loading' | 'jqdata' | 'snapshot';

const INTERVALS: Array<{ id: KlineInterval; label: string }> = [
  { id: '1m', label: '1分' },
  { id: '5m', label: '5分' },
  { id: '1d', label: '日K' },
  { id: '1w', label: '周K' },
  { id: '1mo', label: '月K' },
];

function dateStamp(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function daysAgo(days: number): string {
  const value = new Date();
  value.setDate(value.getDate() - days);
  return dateStamp(value);
}

function minuteTimestamp(value: string): UTCTimestamp | null {
  const parsed = new Date(value.replace(' ', 'T')).getTime();
  return Number.isFinite(parsed) ? (Math.floor(parsed / 1000) as UTCTimestamp) : null;
}

function toDailyCandles(bars: JqDailyBar[]): CandlestickData<Time>[] {
  return bars
    .filter((bar) => [bar.open, bar.high, bar.low, bar.close].every(Number.isFinite))
    .map((bar) => ({ time: bar.date.slice(0, 10), open: bar.open, high: bar.high, low: bar.low, close: bar.close }));
}

function toMinuteCandles(bars: JqHistoricalBar[]): CandlestickData<Time>[] {
  return bars.flatMap((bar) => {
    const time = minuteTimestamp(bar.time);
    return time === null || ![bar.open, bar.high, bar.low, bar.close].every(Number.isFinite)
      ? []
      : [{ time, open: bar.open, high: bar.high, low: bar.low, close: bar.close }];
  });
}

function aggregateCandles(
  candles: CandlestickData<Time>[],
  interval: Extract<KlineInterval, '5m' | '1w' | '1mo'>,
): CandlestickData<Time>[] {
  const groups = new Map<string, CandlestickData<Time>[]>();
  candles.forEach((candle) => {
    let key: string;
    if (interval === '5m') {
      const timestamp = Number(candle.time);
      key = String(Math.floor(timestamp / 300) * 300);
    } else {
      const text = String(candle.time).slice(0, 10);
      const date = new Date(`${text}T12:00:00`);
      if (interval === '1mo') key = text.slice(0, 7);
      else {
        const monday = new Date(date);
        monday.setDate(date.getDate() - ((date.getDay() + 6) % 7));
        key = dateStamp(monday);
      }
    }
    const group = groups.get(key);
    if (group) group.push(candle);
    else groups.set(key, [candle]);
  });
  return Array.from(groups.values()).map((group) => ({
    time: group[0].time,
    open: group[0].open,
    high: Math.max(...group.map((item) => item.high)),
    low: Math.min(...group.map((item) => item.low)),
    close: group[group.length - 1].close,
  }));
}

function snapshotCandles(quote: ResearchQuote, interval: KlineInterval): CandlestickData<Time>[] {
  if (interval === '1d' || interval === '1w' || interval === '1mo') {
    const count = interval === '1d' ? 72 : interval === '1w' ? 360 : 720;
    const daily = sampleBars(`${quote.code}:${interval}`, quote.price, count).map((bar) => ({
      time: bar.date,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
    } satisfies CandlestickData<Time>));
    return interval === '1d' ? daily : aggregateCandles(daily, interval);
  }

  const seconds = interval === '1m' ? 60 : 300;
  const count = interval === '1m' ? 78 : 72;
  let seed = Array.from(`${quote.code}:${interval}`).reduce(
    (value, character) => Math.imul(value ^ character.charCodeAt(0), 16777619),
    2166136261,
  ) >>> 0;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const volatility = interval === '1m' ? 0.0008 : 0.0018;
  const end = Math.floor(Date.now() / seconds / 1000) * seconds;
  let close = (quote.open ?? quote.prevClose) || quote.price;
  const candles = Array.from({ length: count }, (_, index) => {
    const open = close;
    const progress = index / Math.max(1, count - 1);
    const targetDrift = ((quote.price - close) / Math.max(1, count - index)) / Math.max(close, 0.01);
    close = Math.max(0.01, open * (1 + targetDrift + (random() - 0.5) * volatility));
    const wick = (0.18 + random() * 0.55) * volatility;
    return {
      time: (end - (count - index - 1) * seconds) as UTCTimestamp,
      open,
      high: Math.max(open, close) * (1 + wick),
      low: Math.min(open, close) * (1 - wick),
      close,
    } satisfies CandlestickData<Time>;
  });
  const scale = quote.price / candles[candles.length - 1].close;
  return candles.map((candle) => ({
    ...candle,
    open: candle.open * scale,
    high: candle.high * scale,
    low: candle.low * scale,
    close: candle.close * scale,
  }));
}

async function loadHistoricalCandles(code: string, interval: KlineInterval): Promise<CandlestickData<Time>[] | null> {
  if (interval === '1m' || interval === '5m') {
    const bars = await fetchJqHistoricalBars(code, daysAgo(7), dateStamp(new Date()), '1m', { fq: 'none' });
    if (!bars?.length) return null;
    const candles = toMinuteCandles(bars);
    return interval === '1m' ? candles.slice(-240) : aggregateCandles(candles, '5m').slice(-160);
  }
  const bars = await fetchJqDailyBars(code, 720);
  if (!bars?.length) return null;
  const daily = toDailyCandles(bars);
  if (interval === '1d') return daily.slice(-120);
  return aggregateCandles(daily, interval).slice(interval === '1w' ? -120 : -72);
}

export function StockKlineChart({ quote }: { quote: ResearchQuote }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [interval, setInterval] = useState<KlineInterval>('1d');
  const fallback = useMemo(() => snapshotCandles(quote, interval), [interval, quote]);
  const [candles, setCandles] = useState<CandlestickData<Time>[]>(fallback);
  const [source, setSource] = useState<ChartSource>('loading');

  useEffect(() => {
    let active = true;
    setCandles(fallback);
    setSource('loading');
    void loadHistoricalCandles(quote.code, interval).then((historical) => {
      if (!active) return;
      if (historical?.length) {
        setCandles(historical);
        setSource('jqdata');
      } else {
        setSource('snapshot');
      }
    }).catch(() => {
      if (active) setSource('snapshot');
    });
    return () => { active = false; };
  }, [fallback, interval, quote.code]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const probe = document.createElement('canvas');
    if (!probe.getContext('2d')) return;
    const style = getComputedStyle(host);
    const textColor = style.getPropertyValue('--text-muted').trim() || '#8b8b8b';
    const gridColor = style.getPropertyValue('--border').trim() || 'rgba(128, 128, 128, 0.16)';
    const chart = createChart(host, {
      width: host.clientWidth || 320,
      height: 208,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor,
        fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
        fontSize: 10,
      },
      grid: { vertLines: { color: gridColor }, horzLines: { color: gridColor } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.1 } },
      timeScale: {
        borderVisible: false,
        timeVisible: interval === '1m' || interval === '5m',
        secondsVisible: false,
        rightOffset: 2,
        barSpacing: interval === '1m' ? 5 : 7,
      },
      localization: { locale: 'zh-CN', priceFormatter: (price: number) => price.toFixed(quote.price < 10 ? 3 : 2) },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#f0445a',
      downColor: '#00b578',
      borderUpColor: '#f0445a',
      borderDownColor: '#00b578',
      wickUpColor: '#f0445a',
      wickDownColor: '#00b578',
      priceLineColor: quote.changePct >= 0 ? '#f0445a' : '#00b578',
      priceLineWidth: 1,
    });
    series.setData(candles);
    chart.timeScale().fitContent();
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) chart.applyOptions({ width });
    });
    observer.observe(host);
    return () => {
      observer.disconnect();
      chart.remove();
    };
  }, [candles, interval, quote.changePct, quote.price]);

  const latest = candles[candles.length - 1];
  const sourceLabel = source === 'jqdata'
    ? '聚宽历史行情 · 前复权'
    : source === 'loading'
      ? '正在加载历史行情…'
      : '快照模拟 · 非历史数据';

  return (
    <section className="market-card stock-kline-card" aria-label={`${quote.name} K线图`}>
      <header className="stock-kline-heading">
        <span><strong>K 线行情</strong><em>{sourceLabel}</em></span>
        <span className="stock-kline-brand"><ChartCandlestick size={13} /> TradingView</span>
      </header>
      <div className="stock-kline-intervals" role="tablist" aria-label="K线周期">
        {INTERVALS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={interval === item.id}
            onClick={() => setInterval(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {latest && (
        <div className="stock-kline-ohlc" aria-label="最新K线价格">
          <span>开 <b>{latest.open.toFixed(2)}</b></span>
          <span>高 <b>{latest.high.toFixed(2)}</b></span>
          <span>低 <b>{latest.low.toFixed(2)}</b></span>
          <span>收 <b>{latest.close.toFixed(2)}</b></span>
        </div>
      )}
      <div ref={hostRef} className="stock-kline-canvas" data-chart-source={source} />
    </section>
  );
}
