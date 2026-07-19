// 主题台账：把多天的盘前日报聚合成"题材 → 逐日轨迹 → 角色标的 → 触发兑现"的长期视图。
// 纯函数、无 React/IO 依赖，方便单元测试。

import type { PremarketTheme, PremarketThemeRun, PremarketThemeStock } from './themeResearch';
import { IMPORTANT_TRIGGER_STATES, type ThemeTrackingEvent, type TriggerEvaluationStatus } from './themeValidation';

export interface ThemeDayOutcome {
  tradeDate: string;
  reportId: string;
  themeId: string;
  rank: number;
  grade: PremarketTheme['grade'];
  lifecycle: string;
  capitalType: string;
  todayAttackProbability: string;
  conclusion: string;
  /** 该题材当日触发规则总数 / 已触发（含升级）/ 已失效 */
  triggerTotal: number;
  triggeredCount: number;
  invalidatedCount: number;
  /** 当日综合结果：用于台账时间轴着色 */
  verdict: 'hit' | 'miss' | 'mixed' | 'pending' | 'no_data';
}

export interface LedgerStock {
  code?: string;
  name: string;
  role: string;
  latestRoleRank: number;
  authenticity?: string;
  appearances: number;
  lastDate: string;
}

export interface ThemeLedgerEntry {
  key: string;
  name: string;
  firstDate: string;
  lastDate: string;
  daysTracked: number;
  /** 是否出现在最近一个交易日的报告里 */
  active: boolean;
  latestRank: number;
  latestGrade: PremarketTheme['grade'];
  latestLifecycle: string;
  latestCapitalType: string;
  latestProbability: string;
  latestConclusion: string;
  timeline: ThemeDayOutcome[];
  stocks: LedgerStock[];
  triggerTotal: number;
  triggeredCount: number;
  invalidatedCount: number;
  /** 触发兑现率（已触发 / 有结论的触发数），无样本时为 null */
  hitRatePct: number | null;
}

export function normalizeThemeKey(name: string): string {
  return name.replace(/\s+/g, '').replace(/[／]/g, '/').toLowerCase();
}

function latestEventByTrigger(events: ThemeTrackingEvent[], reportId: string, themeId: string): Map<string, ThemeTrackingEvent> {
  const map = new Map<string, ThemeTrackingEvent>();
  const sorted = events
    .filter((event) => event.reportId === reportId && event.themeId === themeId)
    .sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  for (const event of sorted) map.set(event.triggerId, event);
  return map;
}

function isTriggeredStatus(status: TriggerEvaluationStatus): boolean {
  return status === 'triggered' || status === 'upgraded';
}

function dayVerdict(triggerTotal: number, triggered: number, invalidated: number, observed: number): ThemeDayOutcome['verdict'] {
  if (!triggerTotal || !observed) return 'no_data';
  if (triggered > 0 && invalidated === 0) return 'hit';
  if (invalidated > 0 && triggered === 0) return 'miss';
  if (triggered > 0 && invalidated > 0) return 'mixed';
  return 'pending';
}

export function buildThemeDayOutcome(report: PremarketThemeRun, theme: PremarketTheme, events: ThemeTrackingEvent[]): ThemeDayOutcome {
  const latest = latestEventByTrigger(events, report.id, theme.id);
  const statuses = theme.triggerSpecs.map((trigger) => latest.get(trigger.id)?.status).filter((status): status is TriggerEvaluationStatus => Boolean(status));
  const triggeredCount = statuses.filter(isTriggeredStatus).length;
  const invalidatedCount = statuses.filter((status) => status === 'invalidated' || status === 'downgraded').length;
  return {
    tradeDate: report.tradeDate,
    reportId: report.id,
    themeId: theme.id,
    rank: theme.rank,
    grade: theme.grade,
    lifecycle: theme.lifecycle,
    capitalType: theme.capitalType,
    todayAttackProbability: theme.todayAttackProbability,
    conclusion: theme.conclusion,
    triggerTotal: theme.triggerSpecs.length,
    triggeredCount,
    invalidatedCount,
    verdict: dayVerdict(theme.triggerSpecs.length, triggeredCount, invalidatedCount, statuses.length),
  };
}

function mergeStock(target: Map<string, LedgerStock>, stock: PremarketThemeStock, tradeDate: string): void {
  const key = stock.code || `name:${stock.name}`;
  const existing = target.get(key);
  if (!existing) {
    target.set(key, {
      code: stock.code,
      name: stock.name,
      role: stock.role || '未标注',
      latestRoleRank: stock.roleRank,
      authenticity: stock.authenticity,
      appearances: 1,
      lastDate: tradeDate,
    });
    return;
  }
  existing.appearances += 1;
  if (tradeDate >= existing.lastDate) {
    existing.lastDate = tradeDate;
    existing.role = stock.role || existing.role;
    existing.latestRoleRank = stock.roleRank;
    existing.authenticity = stock.authenticity || existing.authenticity;
    existing.name = stock.name || existing.name;
  }
}

/**
 * 把全部日报聚合成主题台账。
 * - 每个交易日只取最新一份报告（同日多份时按生成时间选最新），避免重复计数；
 * - 题材按标准化名称跨日合并；
 * - 触发兑现只统计已记录的盘中事件，不事后补算。
 */
export function buildThemeLedger(reports: PremarketThemeRun[], events: ThemeTrackingEvent[]): ThemeLedgerEntry[] {
  const byDate = new Map<string, PremarketThemeRun>();
  for (const report of reports) {
    if (!report.tradeDate) continue;
    const current = byDate.get(report.tradeDate);
    if (!current || Date.parse(report.generatedAt) > Date.parse(current.generatedAt)) byDate.set(report.tradeDate, report);
  }
  const orderedReports = Array.from(byDate.values()).sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
  const latestDate = orderedReports[orderedReports.length - 1]?.tradeDate ?? '';

  const entries = new Map<string, { name: string; timeline: ThemeDayOutcome[]; stocks: Map<string, LedgerStock> }>();
  for (const report of orderedReports) {
    for (const theme of report.themes) {
      const key = normalizeThemeKey(theme.name);
      let entry = entries.get(key);
      if (!entry) {
        entry = { name: theme.name, timeline: [], stocks: new Map() };
        entries.set(key, entry);
      }
      entry.name = theme.name;
      entry.timeline.push(buildThemeDayOutcome(report, theme, events));
      for (const stock of theme.stocks) mergeStock(entry.stocks, stock, report.tradeDate);
    }
  }

  const result: ThemeLedgerEntry[] = [];
  for (const [key, entry] of entries) {
    const timeline = entry.timeline;
    const last = timeline[timeline.length - 1];
    const triggerTotal = timeline.reduce((sum, day) => sum + day.triggerTotal, 0);
    const triggeredCount = timeline.reduce((sum, day) => sum + day.triggeredCount, 0);
    const invalidatedCount = timeline.reduce((sum, day) => sum + day.invalidatedCount, 0);
    const decided = triggeredCount + invalidatedCount;
    result.push({
      key,
      name: entry.name,
      firstDate: timeline[0].tradeDate,
      lastDate: last.tradeDate,
      daysTracked: new Set(timeline.map((day) => day.tradeDate)).size,
      active: Boolean(latestDate) && last.tradeDate === latestDate,
      latestRank: last.rank,
      latestGrade: last.grade,
      latestLifecycle: last.lifecycle,
      latestCapitalType: last.capitalType,
      latestProbability: last.todayAttackProbability,
      latestConclusion: last.conclusion,
      timeline,
      stocks: Array.from(entry.stocks.values()).sort((a, b) =>
        a.role === b.role ? a.latestRoleRank - b.latestRoleRank : a.role.localeCompare(b.role, 'zh-CN')),
      triggerTotal,
      triggeredCount,
      invalidatedCount,
      hitRatePct: decided > 0 ? (triggeredCount / decided) * 100 : null,
    });
  }
  return result.sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    if (a.lastDate !== b.lastDate) return b.lastDate.localeCompare(a.lastDate);
    if (a.active && b.active) return a.latestRank - b.latestRank;
    return b.daysTracked - a.daysTracked;
  });
}

export interface LedgerSummary {
  reportCount: number;
  coveredDays: number;
  firstDate: string;
  lastDate: string;
  activeThemes: number;
  totalThemes: number;
  decidedTriggers: number;
  hitRatePct: number | null;
}

export function summarizeLedger(entries: ThemeLedgerEntry[], reports: PremarketThemeRun[]): LedgerSummary {
  const dates = Array.from(new Set(reports.map((report) => report.tradeDate).filter(Boolean))).sort();
  const triggered = entries.reduce((sum, entry) => sum + entry.triggeredCount, 0);
  const invalidated = entries.reduce((sum, entry) => sum + entry.invalidatedCount, 0);
  const decided = triggered + invalidated;
  return {
    reportCount: reports.length,
    coveredDays: dates.length,
    firstDate: dates[0] ?? '',
    lastDate: dates[dates.length - 1] ?? '',
    activeThemes: entries.filter((entry) => entry.active).length,
    totalThemes: entries.length,
    decidedTriggers: decided,
    hitRatePct: decided > 0 ? (triggered / decided) * 100 : null,
  };
}

/** 当日重要事件计数（用于面板红点）。 */
export function countImportantEvents(events: ThemeTrackingEvent[], reportId: string): number {
  const latest = new Map<string, ThemeTrackingEvent>();
  for (const event of events.filter((item) => item.reportId === reportId).sort((a, b) => a.observedAt.localeCompare(b.observedAt))) {
    latest.set(event.triggerId, event);
  }
  return Array.from(latest.values()).filter((event) => IMPORTANT_TRIGGER_STATES.has(event.status)).length;
}
