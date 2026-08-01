// 盘中触发自动记录引擎。
// 只要应用在运行、处于 A 股交易时段，就每 30 秒对"今日"全部结构化日报做一次
// 规则评估并把状态变化写入跟踪事件流 —— 不依赖日报跟踪面板是否打开。
// 面板只负责展示：通过 THEME_ENGINE_TICK_EVENT 订阅最新行情快照与评估结果。

import { useEffect } from 'react';
import { fetchCloudRealtimeBatch } from './cloudMarket';
import type { ResearchQuote } from './research';
import {
  loadPremarketThemeRuns,
  type PremarketThemeRun,
} from './themeResearch';
import {
  IMPORTANT_TRIGGER_STATES,
  TRIGGER_STATUS_LABELS,
  evaluateThemeTrigger,
  loadThemeTrackingEvents,
  mergeTrackingEvaluations,
  saveThemeTrackingEvents,
  type ThemeTrackingEvent,
} from './themeValidation';

export const THEME_ENGINE_TICK_EVENT = 'alpha:theme-engine-tick';
export const THEME_SYSTEM_NOTIFICATIONS_KEY = 'alpha-studio.theme-system-notifications.v1';

export interface ThemeEngineTickDetail {
  observedAt: string;
  tradeDate: string;
  asOfLabel: string;
  errors: string[];
  evaluatedReportIds: string[];
  addedEventIds: string[];
  quotes: Array<[string, ResearchQuote]>;
}

let ticking = false;
let lastBreadthAt = 0;
const notifiedEventIds = new Set<string>();

export function shanghaiTradeDate(value = new Date()): string {
  return value.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
}

function shanghaiClockAndWeekday(value: Date): { clock: string; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const weekdayIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(values.weekday);
  return { clock: `${values.hour}:${values.minute}`, weekday: weekdayIndex };
}

/** A 股跟踪窗口：工作日 09:15–11:35 与 12:55–15:05（含收盘后的最后一次落账）。 */
export function isWithinTrackingWindow(value = new Date()): boolean {
  const { clock, weekday } = shanghaiClockAndWeekday(value);
  if (weekday === 0 || weekday === 6) return false;
  return (clock >= '09:15' && clock <= '11:35') || (clock >= '12:55' && clock <= '15:05');
}

export function collectReportCodes(reports: PremarketThemeRun[]): string[] {
  return Array.from(new Set(reports.flatMap((report) =>
    report.themes.flatMap((theme) => theme.stocks.map((stock) => stock.code).filter((code): code is string => Boolean(code))))));
}

export function buildQuoteMap(
  reports: PremarketThemeRun[],
  prices: Awaited<ReturnType<typeof fetchCloudRealtimeBatch>>['prices'],
): Map<string, ResearchQuote> {
  const stocks = new Map<string, { name: string; sector: string }>();
  for (const report of reports) {
    for (const theme of report.themes) {
      for (const stock of theme.stocks) {
        if (stock.code && !stocks.has(stock.code)) stocks.set(stock.code, { name: stock.name, sector: theme.name });
      }
    }
  }
  const quotes = new Map<string, ResearchQuote>();
  for (const [code, live] of prices) {
    const meta = stocks.get(code);
    const prevClose = live.prevClose && live.prevClose > 0 ? live.prevClose : live.price;
    quotes.set(code, {
      code,
      name: meta?.name || code,
      board: code.endsWith('.XSHG') ? '沪市' : '深市',
      sector: meta?.sector || '报告标的',
      price: live.price,
      prevClose,
      changePct: prevClose > 0 ? (live.price / prevClose - 1) * 100 : 0,
      changeAmt: live.price - prevClose,
      open: live.open,
      high: live.high || live.price,
      low: live.low || live.price,
      volume: (live.volumeShares || 0) / 1_000_000,
      turnover: (live.turnoverAmount || 0) / 100_000_000,
      marketCap: (live.marketCapAmount || 0) / 100_000_000,
      volumeShares: live.volumeShares,
      turnoverAmount: live.turnoverAmount,
      turnoverRate: live.turnoverRate,
      volumeRatio: live.volumeRatio,
      highLimit: live.highLimit,
      lowLimit: live.lowLimit,
      paused: live.paused,
      tags: [],
      thesis: '',
      source: live.source ?? 'eastmoney',
    });
  }
  return quotes;
}

function systemNotificationsEnabled(): boolean {
  return typeof Notification !== 'undefined'
    && Notification.permission === 'granted'
    && typeof window !== 'undefined'
    && window.localStorage.getItem(THEME_SYSTEM_NOTIFICATIONS_KEY) === '1';
}

function notifyImportantAdditions(reports: PremarketThemeRun[], additions: ThemeTrackingEvent[]): void {
  if (!systemNotificationsEnabled()) return;
  const triggers = new Map(reports.flatMap((report) =>
    report.themes.flatMap((theme) => theme.triggerSpecs.map((trigger) => [`${report.id}:${trigger.id}`, trigger.label] as const))));
  for (const event of additions) {
    if (!IMPORTANT_TRIGGER_STATES.has(event.status) || notifiedEventIds.has(event.id)) continue;
    notifiedEventIds.add(event.id);
    new Notification(`Alpha Studio · ${TRIGGER_STATUS_LABELS[event.status]}`, {
      body: `${triggers.get(`${event.reportId}:${event.triggerId}`) || event.triggerId}：${event.evidence}`,
      tag: `${event.reportId}:${event.triggerId}`,
    });
  }
}

/**
 * 执行一次盘中扫描：拉取今日全部报告标的的实时行情，评估所有数值触发规则，
 * 状态变化写入事件流，并广播 tick 事件供 UI 展示。
 * force = true 时忽略交易时段限制（用户手动刷新）。
 */
export async function runTrackingTick(options: { force?: boolean } = {}): Promise<ThemeEngineTickDetail | null> {
  if (ticking || typeof window === 'undefined') return null;
  const now = new Date();
  if (!options.force && !isWithinTrackingWindow(now)) return null;
  const today = shanghaiTradeDate(now);
  const reports = loadPremarketThemeRuns().filter((report) => report.tradeDate === today);
  if (!reports.length) return null;
  const codes = collectReportCodes(reports);
  if (!codes.length) return null;
  ticking = true;
  try {
    const batch = await fetchCloudRealtimeBatch(codes, { forceRefresh: true });
    const quotes = buildQuoteMap(reports, batch.prices);
    const evaluateBreadth = options.force || now.getTime() - lastBreadthAt >= 60_000;
    if (evaluateBreadth) lastBreadthAt = now.getTime();
    const evaluations = reports.flatMap((report) => report.themes.flatMap((theme) => theme.triggerSpecs
      .filter((trigger) => trigger.evaluator !== 'breadth' || evaluateBreadth)
      .map((trigger) => evaluateThemeTrigger(report, trigger, { now, theme, quotes }))));
    const current = loadThemeTrackingEvents();
    const next = mergeTrackingEvaluations(current, evaluations);
    const existingIds = new Set(current.map((event) => event.id));
    const additions = next === current ? [] : next.filter((event) => !existingIds.has(event.id));
    if (additions.length) {
      saveThemeTrackingEvents(next);
      notifyImportantAdditions(reports, additions);
    }
    const detail: ThemeEngineTickDetail = {
      observedAt: now.toISOString(),
      tradeDate: today,
      asOfLabel: batch.asOfLabel || now.toLocaleTimeString('zh-CN', { hour12: false }),
      errors: batch.errors,
      evaluatedReportIds: reports.map((report) => report.id),
      addedEventIds: additions.map((event) => event.id),
      quotes: Array.from(quotes.entries()),
    };
    window.dispatchEvent(new CustomEvent<ThemeEngineTickDetail>(THEME_ENGINE_TICK_EVENT, { detail }));
    return detail;
  } finally {
    ticking = false;
  }
}

/** 挂在 App 根组件上，让盘中记录独立于日报跟踪面板运行。 */
export function useThemeTrackingEngine(intervalMs = 30_000): void {
  useEffect(() => {
    const tick = () => {
      void runTrackingTick().catch(() => undefined);
    };
    tick();
    const timer = window.setInterval(tick, intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
}
