import { invoke } from '@tauri-apps/api/core';
import { isTauriRuntime } from './codexBridge';

export const LOCAL_DB_MIGRATED_KEY = 'alpha-studio.local-db-migrated.v1';
export const CHAT_STATE_KEY = 'alpha-studio.chat.v2';
export const RESEARCH_STATE_KEY = 'alpha-studio.research-state.v2';
export const PREMARKET_THEME_RUNS_KEY = 'alpha-studio.premarket-theme-runs.v1';
export const AUTOMATION_TASKS_KEY = 'alpha:automation-tasks-v1';

export interface LocalStoreInfo {
  dbPath: string;
  backupDir: string;
  schemaVersion: number;
  hasData: boolean;
}

export interface LocalStoreSnapshot {
  dbPath: string;
  backupDir: string;
  schemaVersion: number;
  chat?: unknown;
  research?: unknown;
  premarketThemeRuns: unknown[];
  themeTrackingEvents: unknown[];
  themeReviews: unknown[];
  themeBacktestRuns: unknown[];
  automationTasks: unknown[];
  jointResearchRuns: unknown[];
  researchRecommendations: unknown[];
  aiRiskAssessments: unknown[];
  recommendationEvents: unknown[];
}

export interface LocalStoreCommitRequest {
  chat?: unknown;
  research?: unknown;
  premarketThemeRuns?: unknown[];
  themeTrackingEvents?: unknown[];
  themeReviews?: unknown[];
  themeBacktestRuns?: unknown[];
  automationTasks?: unknown[];
  jointResearchRuns?: unknown[];
  researchRecommendations?: unknown[];
  aiRiskAssessments?: unknown[];
  recommendationEvents?: unknown[];
  audit?: {
    domain: string;
    action: string;
    entityId?: string;
    payload?: unknown;
  };
}

export interface MarketCacheEntry<T = unknown> {
  source: string;
  scope: string;
  cacheKey: string;
  code?: string;
  universe?: string[];
  paramsHash?: string;
  rawPayload?: unknown;
  normalizedPayload?: T;
  tradeDate?: string;
  asOf?: string;
  fetchedAt: string;
  expiresAt: string;
  status: string;
  error?: string;
  updatedAt: string;
}

export interface MarketCachePut<T = unknown> {
  source: string;
  scope: string;
  cacheKey: string;
  code?: string;
  universe?: string[];
  paramsHash?: string;
  rawPayload?: unknown;
  normalizedPayload?: T;
  tradeDate?: string;
  asOf?: string;
  fetchedAt: string;
  expiresAt?: string;
  status?: string;
  error?: string;
}

let bootstrapPromise: Promise<LocalStoreSnapshot | null> | null = null;
const commitTimers = new Map<string, number>();

export async function localStoreInfo(): Promise<LocalStoreInfo | null> {
  if (!isTauriRuntime()) return null;
  return invoke<LocalStoreInfo>('local_store_info');
}

export async function loadLocalStoreSnapshot(): Promise<LocalStoreSnapshot | null> {
  if (!isTauriRuntime()) return null;
  if (!bootstrapPromise) {
    bootstrapPromise = loadLocalStoreSnapshotOnce();
  }
  return bootstrapPromise;
}

export async function reloadLocalStoreSnapshot(): Promise<LocalStoreSnapshot | null> {
  if (!isTauriRuntime()) return null;
  bootstrapPromise = loadLocalStoreSnapshotOnce();
  return bootstrapPromise;
}

export async function commitLocalStore(request: LocalStoreCommitRequest): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke('local_store_commit', { request });
}

export function scheduleLocalStoreCommit(key: string, request: LocalStoreCommitRequest, delayMs = 500): void {
  if (!isTauriRuntime() || typeof window === 'undefined') return;
  const existing = commitTimers.get(key);
  if (existing) window.clearTimeout(existing);
  const timer = window.setTimeout(() => {
    commitTimers.delete(key);
    void commitLocalStore(request).catch((error) => {
      console.warn(`Alpha Studio local store commit failed for ${key}:`, error);
    });
  }, delayMs);
  commitTimers.set(key, timer);
}

export async function loadMarketCache<T = unknown>(
  source: string,
  scope: string,
  cacheKey: string,
): Promise<MarketCacheEntry<T> | null> {
  if (!isTauriRuntime()) return null;
  return invoke<MarketCacheEntry<T> | null>('market_cache_get', {
    request: { source, scope, cacheKey },
  });
}

export async function saveMarketCache<T = unknown>(entry: MarketCachePut<T>): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke('market_cache_put', {
    request: {
      ...entry,
      expiresAt: entry.expiresAt ?? marketCacheExpiresAt(entry.scope),
      status: entry.status ?? 'success',
    },
  });
}

export function stableCacheKey(parts: Array<string | number | boolean | null | undefined>): string {
  return parts.map((part) => String(part ?? '')).join('|');
}

export function stableCodesCacheKey(codes: string[], limit?: number): string {
  const unique = Array.from(new Set(codes.map((code) => code.trim()).filter(Boolean))).sort();
  return (limit ? unique.slice(0, limit) : unique).join(',');
}

export function isMarketCacheUsable(entry: MarketCacheEntry | null | undefined, now = new Date()): boolean {
  if (!entry || entry.status !== 'success' || entry.normalizedPayload === undefined) return false;
  const expiresAt = Date.parse(entry.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt > now.getTime();
}

export function marketCacheExpiresAt(scope: string, now = new Date()): string {
  const ttl = tradingTtlMs(scope, now);
  if (ttl !== null) return new Date(now.getTime() + ttl).toISOString();
  return new Date(nonTradingExpiryMs(now)).toISOString();
}

export function marketCacheLabel(entry: MarketCacheEntry | null | undefined): string | undefined {
  if (!entry) return undefined;
  const fetched = Date.parse(entry.fetchedAt);
  if (!Number.isFinite(fetched)) return entry.asOf ? `缓存 ${entry.asOf}` : '缓存';
  return `缓存 ${new Date(fetched).toLocaleString('zh-CN', { hour12: false })}`;
}

export function isChinaTradingTime(now = new Date()): boolean {
  const session = chinaMarketSession(now);
  return session === 'morning' || session === 'afternoon';
}

async function loadLocalStoreSnapshotOnce(): Promise<LocalStoreSnapshot | null> {
  const info = await localStoreInfo();
  if (!info) return null;
  if (!info.hasData) {
    const legacy = readLegacyPayloads();
    if (legacy.sourceKeys.length > 0) {
      const snapshot = await invoke<LocalStoreSnapshot>('local_store_import_legacy', {
        request: legacy,
      });
      window.localStorage.setItem(LOCAL_DB_MIGRATED_KEY, String(Date.now()));
      return snapshot;
    }
  }
  return invoke<LocalStoreSnapshot>('local_store_load');
}

function readLegacyPayloads(): {
  chat?: unknown;
  research?: unknown;
  premarketThemeRuns?: unknown[];
  automationTasks?: unknown[];
  jointResearchRuns?: unknown[];
  researchRecommendations?: unknown[];
  aiRiskAssessments?: unknown[];
  recommendationEvents?: unknown[];
  sourceKeys: string[];
} {
  const sourceKeys: string[] = [];
  const chat = readLocalJson(CHAT_STATE_KEY);
  const research = readLocalJson(RESEARCH_STATE_KEY);
  const premarketThemeRuns = readLocalJson(PREMARKET_THEME_RUNS_KEY);
  const automationTasks = readLocalJson(AUTOMATION_TASKS_KEY);
  const dailyDecision = readLocalJson('alpha-studio.daily-decision.v1') as {
    jointResearchRuns?: unknown[];
    recommendations?: unknown[];
    riskAssessments?: unknown[];
    recommendationEvents?: unknown[];
  } | undefined;

  if (chat !== undefined) sourceKeys.push(CHAT_STATE_KEY);
  if (research !== undefined) sourceKeys.push(RESEARCH_STATE_KEY);
  if (premarketThemeRuns !== undefined) sourceKeys.push(PREMARKET_THEME_RUNS_KEY);
  if (automationTasks !== undefined) sourceKeys.push(AUTOMATION_TASKS_KEY);
  if (dailyDecision !== undefined) sourceKeys.push('alpha-studio.daily-decision.v1');

  return {
    chat: unwrapZustandState(chat),
    research,
    premarketThemeRuns: Array.isArray(premarketThemeRuns) ? premarketThemeRuns : undefined,
    automationTasks: Array.isArray(automationTasks) ? automationTasks : undefined,
    jointResearchRuns: Array.isArray(dailyDecision?.jointResearchRuns) ? dailyDecision.jointResearchRuns : undefined,
    researchRecommendations: Array.isArray(dailyDecision?.recommendations) ? dailyDecision.recommendations : undefined,
    aiRiskAssessments: Array.isArray(dailyDecision?.riskAssessments) ? dailyDecision.riskAssessments : undefined,
    recommendationEvents: Array.isArray(dailyDecision?.recommendationEvents) ? dailyDecision.recommendationEvents : undefined,
    sourceKeys,
  };
}

function readLocalJson(key: string): unknown | undefined {
  if (typeof window === 'undefined') return undefined;
  const raw = window.localStorage.getItem(key);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function unwrapZustandState(value: unknown): unknown {
  if (value && typeof value === 'object' && 'state' in value) {
    return (value as { state?: unknown }).state;
  }
  return value;
}

function tradingTtlMs(scope: string, now: Date): number | null {
  if (!isChinaTradingTime(now)) {
    if (scope === 'ticks') return 15 * 60 * 1000;
    return null;
  }
  if (scope === 'full_market') return 5 * 60 * 1000;
  if (scope === 'ticks') return 30 * 1000;
  if (scope === 'daily_bars') return null;
  return 60 * 1000;
}

type ChinaMarketSession = 'weekend' | 'preopen' | 'morning' | 'midday' | 'afternoon' | 'afterClose';

function chinaMarketSession(now: Date): ChinaMarketSession {
  const parts = chinaParts(now);
  if (parts.weekday === 0 || parts.weekday === 6) return 'weekend';
  const minutes = parts.hour * 60 + parts.minute;
  if (minutes < 9 * 60 + 15) return 'preopen';
  if (minutes < 11 * 60 + 30) return 'morning';
  if (minutes < 13 * 60) return 'midday';
  if (minutes < 15 * 60) return 'afternoon';
  return 'afterClose';
}

function nonTradingExpiryMs(now: Date): number {
  const parts = chinaParts(now);
  const session = chinaMarketSession(now);
  if (session === 'preopen') return chinaWallTimeUtcMs(parts.year, parts.month, parts.day, 9, 15);
  if (session === 'midday') return chinaWallTimeUtcMs(parts.year, parts.month, parts.day, 12, 55);
  return nextWeekdayOpenUtcMs(parts, session === 'afterClose' ? 1 : 0);
}

function nextWeekdayOpenUtcMs(parts: ChinaParts, startOffsetDays: number): number {
  for (let offset = startOffsetDays; offset < startOffsetDays + 8; offset += 1) {
    const candidate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + offset));
    const weekday = candidate.getUTCDay();
    if (weekday !== 0 && weekday !== 6) {
      return Date.UTC(
        candidate.getUTCFullYear(),
        candidate.getUTCMonth(),
        candidate.getUTCDate(),
        1,
        15,
      );
    }
  }
  return Date.now() + 12 * 60 * 60 * 1000;
}

interface ChinaParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
}

function chinaParts(date: Date): ChinaParts {
  const china = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return {
    year: china.getUTCFullYear(),
    month: china.getUTCMonth() + 1,
    day: china.getUTCDate(),
    hour: china.getUTCHours(),
    minute: china.getUTCMinutes(),
    weekday: china.getUTCDay(),
  };
}

function chinaWallTimeUtcMs(year: number, month: number, day: number, hour: number, minute: number): number {
  return Date.UTC(year, month - 1, day, hour - 8, minute);
}
