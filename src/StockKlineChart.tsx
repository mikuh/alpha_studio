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
import { changeTone, formatPercent, sampleBars, type ResearchQuote } from './research';

type KlineInterval = '1m' | '5m' | '1d' | '1w' | '1mo';
interface InspectedCandle {
  candle: CandlestickData<Time>;
  previousClose?: number;
}

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

function snapshotDailyCandles(quote: ResearchQuote, count: number): CandlestickData<Time>[] {
  const anchor = quote.prevClose > 0 ? quote.prevClose : quote.price;
  const generated = sampleBars(`${quote.code}:kline`, anchor, Math.max(2, count)).map((bar) => ({
    time: bar.date,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
  } satisfies CandlestickData<Time>));

  // Keep the simulated history visually continuous with the real quote. The
  // penultimate close is yesterday's close; the last bar is today's snapshot.
  const previousGenerated = generated[generated.length - 2];
  const scale = previousGenerated.close > 0 ? anchor / previousGenerated.close : 1;
  const scaled = generated.map((candle) => ({
    ...candle,
    open: candle.open * scale,
    high: candle.high * scale,
    low: candle.low * scale,
    close: candle.close * scale,
  }));
  const open = quote.open && quote.open > 0 ? quote.open : anchor;
  const close = quote.price;
  const high = Math.max(open, close, quote.high);
  const low = Math.min(open, close, quote.low);
  scaled[scaled.length - 1] = {
    time: scaled[scaled.length - 1].time,
    open,
    high,
    low,
    close,
  };
  return scaled;
}

function snapshotCandles(quote: ResearchQuote, interval: KlineInterval): CandlestickData<Time>[] {
  if (interval === '1d' || interval === '1w' || interval === '1mo') {
    const count = interval === '1d' ? 72 : interval === '1w' ? 360 : 720;
    const daily = snapshotDailyCandles(quote, count);
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

function candleTimeKey(time: Time): string {
  if (typeof time === 'number' || typeof time === 'string') return String(time);
  return `${time.year}-${String(time.month).padStart(2, '0')}-${String(time.day).padStart(2, '0')}`;
}

function candleTimeLabel(time: Time, intraday: boolean): string {
  if (typeof time === 'number') {
    return new Date(time * 1000).toLocaleString('zh-CN', intraday
      ? { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }
      : { year: 'numeric', month: '2-digit', day: '2-digit' });
  }
  const value = typeof time === 'string' ? time : candleTimeKey(time);
  return value.slice(0, intraday ? 16 : 10);
}

export function StockKlineChart({ quote }: { quote: ResearchQuote }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const interactionRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);
  const [interval, setInterval] = useState<KlineInterval>('1d');
  const [isInteractive, setIsInteractive] = useState(false);
  const fallback = useMemo(() => snapshotCandles(quote, interval), [interval, quote]);
  const [candles, setCandles] = useState<CandlestickData<Time>[]>(fallback);
  const [inspected, setInspected] = useState<InspectedCandle | null>(null);

  useEffect(() => {
    setInspected(null);
    setCandles(fallback);
  }, [fallback]);

  useEffect(() => {
    if (!isInteractive) return;
    const leaveChart = (event: PointerEvent) => {
      const interaction = interactionRef.current;
      if (interaction && event.target instanceof Node && !interaction.contains(event.target)) {
        setIsInteractive(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsInteractive(false);
    };
    document.addEventListener('pointerdown', leaveChart, true);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('pointerdown', leaveChart, true);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isInteractive]);

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
      handleScroll: isInteractive,
      handleScale: isInteractive,
    });
    chartRef.current = chart;
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
    const candleIndexes = new Map(candles.map((candle, index) => [candleTimeKey(candle.time), index]));
    const inspectCandle = (param: Parameters<Parameters<typeof chart.subscribeCrosshairMove>[0]>[0]) => {
      const item = param.seriesData.get(series);
      if (!param.point || !item || !('open' in item) || !('high' in item) || !('low' in item) || !('close' in item)) {
        setInspected(null);
        return;
      }
      const candle = item as CandlestickData<Time>;
      const index = candleIndexes.get(candleTimeKey(candle.time));
      setInspected({ candle, previousClose: index && index > 0 ? candles[index - 1].close : undefined });
    };
    chart.subscribeCrosshairMove(inspectCandle);
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) chart.applyOptions({ width });
    });
    observer.observe(host);
    return () => {
      chart.unsubscribeCrosshairMove(inspectCandle);
      observer.disconnect();
      if (chartRef.current === chart) chartRef.current = null;
      chart.remove();
    };
  }, [candles, interval, quote.changePct, quote.price]);

  useEffect(() => {
    chartRef.current?.applyOptions({
      handleScroll: isInteractive,
      handleScale: isInteractive,
    });
  }, [isInteractive]);

  const latest = candles[candles.length - 1];
  const shown = inspected?.candle ?? latest;
  const shownIndex = shown ? candles.findIndex((candle) => candleTimeKey(candle.time) === candleTimeKey(shown.time)) : -1;
  const previousClose = inspected?.previousClose
    ?? (shownIndex > 0 ? candles[shownIndex - 1].close : undefined);
  const changePct = shown && previousClose && previousClose > 0
    ? ((shown.close - previousClose) / previousClose) * 100
    : undefined;
  const bodyPct = shown && shown.open > 0 ? ((shown.close - shown.open) / shown.open) * 100 : undefined;
  const sourceLabel = '行情快照 · 本地走势预览';

  return (
    <section className="market-card stock-kline-card" aria-label={`${quote.name} K线图`}>
      <header className="stock-kline-heading">
        <span><strong>K 线行情</strong><em>{sourceLabel}</em></span>
        <span className="stock-kline-actions">
          <span className="stock-kline-brand"><ChartCandlestick size={13} /> TradingView</span>
        </span>
      </header>
      <div className="stock-kline-intervals" role="tablist" aria-label="K线周期">
        {INTERVALS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={interval === item.id}
            onClick={() => {
              setInterval(item.id);
              setIsInteractive(false);
              setInspected(null);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      {shown && (
        <div className="stock-kline-ohlc" aria-label={inspected ? '光标所选K线详情' : '最新K线详情'} aria-live="polite">
          <span className="stock-kline-time">{inspected ? '所选' : '最新'} <b>{candleTimeLabel(shown.time, interval === '1m' || interval === '5m')}</b></span>
          <span>开 <b>{shown.open.toFixed(2)}</b></span>
          <span>高 <b>{shown.high.toFixed(2)}</b></span>
          <span>低 <b>{shown.low.toFixed(2)}</b></span>
          <span>收 <b>{shown.close.toFixed(2)}</b></span>
          {changePct !== undefined && <span>较前收 <b className={changeTone(changePct)}>{formatPercent(changePct)}</b></span>}
          {bodyPct !== undefined && <span title="收盘价相对开盘价的涨跌">K线实体 <b className={changeTone(bodyPct)}>{formatPercent(bodyPct)}</b></span>}
        </div>
      )}
      <div
        ref={interactionRef}
        className={`stock-kline-interaction${isInteractive ? ' is-active' : ''}`}
        data-chart-interactive={isInteractive}
      >
        <div ref={hostRef} className="stock-kline-canvas" data-chart-source="snapshot" />
        {!isInteractive && (
          <button
            type="button"
            className="stock-kline-activation"
            aria-label="点击启用K线图交互"
            onClick={() => setIsInteractive(true)}
          >
            <span>点击后操作 K 线</span>
          </button>
        )}
        {isInteractive && <span className="stock-kline-active-hint">移动十字线查看详情 · 点击外部退出</span>}
      </div>
    </section>
  );
}
