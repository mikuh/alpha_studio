import {
  DEFAULT_CUSTOM_MODEL_CONTEXT_WINDOW_TOKENS,
  defaultModelProfiles,
  isReasoningEffort,
  normalizeCustomModelContextWindowTokens,
  normalizeCustomModelMaxOutputTokens,
  publicModelLabel,
  type ModelProfile,
} from './models';
import type { ClientAgreementAcceptance } from './legal';
import { normalizeEnabledModules } from '../shared/productModules';

const SESSION_KEY = 'alpha:client-license-session';
const DEVICE_FINGERPRINT_KEY = 'alpha:device-fingerprint';
export const ALPHA_GATEWAY_PROVIDER_ID = 'alpha-gateway';
export const ENTERPRISE_AUTHORIZATION_CHECK_INTERVAL_MS = 5 * 24 * 60 * 60 * 1000;
export const CLIENT_MODEL_CATALOG_SYNC_INTERVAL_MS = 60 * 1000;

export interface ClientTenant {
  enabledModules?: string[];
  id: string;
  name: string;
  maxDevices: number;
  billingMode?: string;
  balanceYuan?: number;
  subscriptionPlan?: string | null;
  subscriptionExpiresAt?: string | null;
  codexSubscriptionEnabled: boolean;
  codexSubscriptionPlan?: string | null;
  codexSubscriptionExpiresAt?: string | null;
}

export interface ClientUser {
  id: string;
  email: string;
  name: string;
}

export interface ClientDevice {
  id: string;
  accessToken: string;
  leaseExpiresAt: string;
}

export interface ClientManagedDevice {
  id: string;
  name: string;
  status: 'active' | 'revoked' | string;
  isCurrent: boolean;
  isAdministrator: boolean;
  createdAt: string;
  lastSeenAt?: string | null;
  leaseExpiresAt?: string | null;
}

export interface ClientDeviceSummary {
  activeDevices: number;
  maxDevices: number;
  isAdministrator: boolean;
  devices: ClientManagedDevice[];
}

export interface ClientModel {
  id: string;
  label: string;
  provider: string;
  mode: string;
  enabled: boolean;
  contextWindowTokens?: number;
  maxOutputTokens?: number;
  supportedReasoningEfforts?: string[];
  defaultReasoningEffort?: string;
  fastModeSupported?: boolean;
}

export interface ClientCodexAccount {
  id: string;
  email: string;
  loginHint?: string;
  plan: string;
  seatLimit: number;
  expiresAt?: string | null;
}

export interface ClientLicenseSession {
  apiBaseUrl: string;
  activatedAt: number;
  lastValidatedAt?: number;
  tenant: ClientTenant;
  user: ClientUser;
  device: ClientDevice;
  models: ClientModel[];
  codexAccounts: ClientCodexAccount[];
}

export interface ClientActivateInput {
  apiBaseUrl: string;
  companyName: string;
  authorizationCode: string;
  deviceName: string;
  fingerprint?: string;
  userEmail?: string;
  userName?: string;
  agreementAcceptance: ClientAgreementAcceptance;
}

export interface GatewayRunConfig {
  runId: string;
  providerId: string;
  providerBaseUrl: string;
  providerApiKey: string;
  providerWireApi: 'responses';
}

export interface BillingUsageTotals {
  runCount: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  totalTokens: number;
  costYuan: number;
  billableYuan: number;
  lastUsedAt?: string | null;
}

export interface BillingModelUsage extends BillingUsageTotals {
  modelId: string;
  label: string;
  provider?: string | null;
}

export interface BillingLedgerEntry {
  id: string;
  runId?: string | null;
  entryType: string;
  amountYuan: number;
  description: string;
  createdAt: string;
  entryCount?: number;
}

export interface BillingLedgerPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasPrevious: boolean;
  hasNext: boolean;
}

export type BillingPeriodKind = 'month' | 'year';

export interface BillingPeriodSelection {
  kind: BillingPeriodKind;
  value: string;
}

export interface ClientBillingSummary {
  tenant: ClientTenant & {
    billingMode: string;
    balanceYuan: number;
    subscriptionPlan?: string | null;
    subscriptionExpiresAt?: string | null;
  };
  activeDevices: number;
  period: {
    kind?: BillingPeriodKind;
    value?: string;
    start?: string;
    end?: string;
    currentMonthStart: string;
    currentMonthEnd: string;
    generatedAt: string;
  };
  usage: {
    selectedPeriod?: BillingUsageTotals;
    currentMonth: BillingUsageTotals;
    allTime: BillingUsageTotals;
    models: BillingModelUsage[];
    recentLedger: BillingLedgerEntry[];
    ledgerPagination?: BillingLedgerPagination;
  };
}

export function defaultAlphaApiBaseUrl(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return normalizeApiBaseUrl(env?.VITE_ALPHA_API_BASE_URL || 'http://localhost:18080');
}

export function loadClientLicenseSession(): ClientLicenseSession | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return normalizeClientLicenseSession(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveClientLicenseSession(session: ClientLicenseSession): void {
  window.localStorage.setItem(SESSION_KEY, JSON.stringify({
    ...session,
    apiBaseUrl: normalizeApiBaseUrl(session.apiBaseUrl),
  }));
}

export function clearClientLicenseSession(): void {
  window.localStorage.removeItem(SESSION_KEY);
}

export function getOrCreateDeviceFingerprint(): string {
  const saved = window.localStorage.getItem(DEVICE_FINGERPRINT_KEY);
  if (saved) return saved;
  const generated = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `device-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  window.localStorage.setItem(DEVICE_FINGERPRINT_KEY, generated);
  return generated;
}

export async function activateClient(input: ClientActivateInput): Promise<ClientLicenseSession> {
  const apiBaseUrl = normalizeApiBaseUrl(input.apiBaseUrl || defaultAlphaApiBaseUrl());
  const body = {
    companyName: input.companyName,
    authorizationCode: input.authorizationCode,
    fingerprint: input.fingerprint || getOrCreateDeviceFingerprint(),
    deviceName: input.deviceName,
    userEmail: input.userEmail || undefined,
    userName: input.userName || undefined,
    agreementAcceptance: input.agreementAcceptance,
  };
  const data = await alphaFetch<Omit<ClientLicenseSession, 'apiBaseUrl' | 'activatedAt'>>(
    apiBaseUrl,
    '/api/client/activate',
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
  );
  const session = normalizeClientLicenseSession({
    ...data,
    apiBaseUrl,
    activatedAt: Date.now(),
    lastValidatedAt: Date.now(),
  });
  if (!session) {
    throw new Error('Alpha Studio 激活响应不完整，缺少有效的客户、用户或设备访问令牌。请确认客户端与后台版本一致。');
  }
  saveClientLicenseSession(session);
  return session;
}

export async function renewClientLease(session: ClientLicenseSession): Promise<ClientLicenseSession> {
  const data = await alphaFetch<{
    accessToken?: string;
    leaseExpiresAt: string;
    tenant?: ClientTenant;
    models?: ClientModel[];
    codexAccounts?: ClientCodexAccount[];
  }>(session.apiBaseUrl, '/api/devices/lease', {
    method: 'POST',
    headers: deviceAuthorizationHeaders(session),
    body: JSON.stringify({
      tenantId: session.tenant.id,
      deviceId: session.device.id,
    }),
  });
  const renewed = {
    ...session,
    lastValidatedAt: Date.now(),
    device: {
      ...session.device,
      accessToken: data.accessToken || session.device.accessToken,
      leaseExpiresAt: data.leaseExpiresAt,
    },
    tenant: { ...session.tenant, ...data.tenant, enabledModules: normalizeEnabledModules(data.tenant?.enabledModules) },
    models: Array.isArray(data.models) ? data.models : session.models,
    codexAccounts: Array.isArray(data.codexAccounts) ? data.codexAccounts : session.codexAccounts,
  };
  saveClientLicenseSession(renewed);
  return renewed;
}

export async function validateCodexAuthorization(
  session: ClientLicenseSession,
  email: string,
): Promise<{ authorized: true; accountId: string; email: string }> {
  return alphaFetch(session.apiBaseUrl, '/api/client/codex-authorization', {
    method: 'POST',
    headers: deviceAuthorizationHeaders(session),
    body: JSON.stringify({
      tenantId: session.tenant.id,
      deviceId: session.device.id,
      fingerprint: getOrCreateDeviceFingerprint(),
      email: email.trim(),
    }),
  }, { retryLoopback: true });
}

export function isCodexAccountAllowed(
  session: ClientLicenseSession | null | undefined,
  email: string | null | undefined,
): boolean {
  const normalized = email?.trim().toLowerCase();
  return Boolean(
    session?.tenant.codexSubscriptionEnabled
    && normalized
    && session.codexAccounts.some((account) => account.email.trim().toLowerCase() === normalized),
  );
}

export function isEnterpriseAuthorizationFresh(
  session: ClientLicenseSession,
  now = Date.now(),
): boolean {
  return enterpriseAuthorizationValidUntil(session) > now + 15_000;
}

export function enterpriseAuthorizationValidUntil(session: ClientLicenseSession): number {
  const validatedAt = session.lastValidatedAt ?? session.activatedAt;
  const leaseExpiresAt = new Date(session.device.leaseExpiresAt).getTime();
  if (!Number.isFinite(validatedAt) || !Number.isFinite(leaseExpiresAt)) return 0;
  return Math.min(
    validatedAt + ENTERPRISE_AUTHORIZATION_CHECK_INTERVAL_MS,
    leaseExpiresAt,
  );
}

export async function fetchClientDevices(session: ClientLicenseSession): Promise<ClientDeviceSummary> {
  return alphaFetch<ClientDeviceSummary>(session.apiBaseUrl, '/api/client/devices', {
    method: 'POST',
    headers: deviceAuthorizationHeaders(session),
    body: JSON.stringify({
      tenantId: session.tenant.id,
      deviceId: session.device.id,
      fingerprint: getOrCreateDeviceFingerprint(),
    }),
  }, { retryLoopback: true });
}

export async function revokeClientDevice(
  session: ClientLicenseSession,
  targetDeviceId: string,
): Promise<ClientDeviceSummary> {
  return alphaFetch<ClientDeviceSummary>(session.apiBaseUrl, '/api/client/devices/revoke', {
    method: 'POST',
    headers: deviceAuthorizationHeaders(session),
    body: JSON.stringify({
      tenantId: session.tenant.id,
      deviceId: session.device.id,
      fingerprint: getOrCreateDeviceFingerprint(),
      targetDeviceId,
    }),
  }, { retryLoopback: true });
}

// One Codex task can make many sequential model requests while it researches,
// calls tools, and writes a final answer. Five yuan was too small for legitimate
// long-form tasks because every repeated input is counted cumulatively.
export const DEFAULT_GATEWAY_TASK_SPEND_LIMIT_YUAN = 20;

export async function createGatewayRun(
  modelId: string,
  spendLimitYuan = DEFAULT_GATEWAY_TASK_SPEND_LIMIT_YUAN,
  fastMode = false,
): Promise<GatewayRunConfig> {
  const session = loadClientLicenseSession();
  if (!session) throw new Error('Alpha Studio 客户端尚未激活。');
  const data = await alphaFetch<{ runId: string; runToken: string }>(session.apiBaseUrl, '/api/runs/create', {
    method: 'POST',
    headers: deviceAuthorizationHeaders(session),
    body: JSON.stringify({
      tenantId: session.tenant.id,
      userId: session.user.id,
      deviceId: session.device.id,
      modelId,
      // This caps cumulative exposure for the whole multi-request task; the
      // server does not reserve it from the account balance.
      budgetYuan: spendLimitYuan,
      fastMode,
    }),
  });
  return {
    runId: data.runId,
    providerId: ALPHA_GATEWAY_PROVIDER_ID,
    providerBaseUrl: `${session.apiBaseUrl}/v1`,
    providerApiKey: data.runToken,
    providerWireApi: 'responses',
  };
}

export async function fetchClientBillingSummary(
  session: ClientLicenseSession,
  options: { page?: number; pageSize?: number; period?: BillingPeriodSelection } = {},
): Promise<ClientBillingSummary> {
  return alphaFetch<ClientBillingSummary>(session.apiBaseUrl, '/api/client/billing-summary', {
    method: 'POST',
    headers: deviceAuthorizationHeaders(session),
    body: JSON.stringify({
      tenantId: session.tenant.id,
      deviceId: session.device.id,
      ledgerPage: options.page ?? 1,
      ledgerPageSize: options.pageSize ?? 8,
      ...(options.period ? {
        periodKind: options.period.kind,
        periodValue: options.period.value,
      } : {}),
    }),
  }, { retryLoopback: true });
}

function deviceAuthorizationHeaders(session: ClientLicenseSession): HeadersInit {
  return { authorization: `Bearer ${session.device.accessToken}` };
}

export function modelProfilesFromClientLicense(
  session: ClientLicenseSession,
  availableSubscriptionProfiles: readonly ModelProfile[] = defaultModelProfiles(),
): ModelProfile[] {
  const subscriptionProfiles = session.tenant.codexSubscriptionEnabled && session.codexAccounts.length > 0
    ? availableSubscriptionProfiles.map((profile) => ({ ...profile }))
    : [];
  const occupied = new Set(subscriptionProfiles.map((profile) => profile.id));
  const gatewayProfiles = session.models
    .filter((model) => model.enabled && model.mode === 'gateway_api')
    .map((model) => {
      const id = occupied.has(model.id) ? `gateway:${model.id}` : model.id;
      occupied.add(id);
      const supportedReasoningEfforts = (model.supportedReasoningEfforts ?? ['low', 'medium', 'high', 'xhigh'])
        .filter(isReasoningEffort)
        .map((reasoningEffort) => ({ reasoningEffort, description: '' }));
      const defaultReasoningEffort = isReasoningEffort(model.defaultReasoningEffort)
        && supportedReasoningEfforts.some((item) => item.reasoningEffort === model.defaultReasoningEffort)
        ? model.defaultReasoningEffort
        : supportedReasoningEfforts[0]?.reasoningEffort;
      return {
        id,
        label: publicModelLabel(model.label),
        providerId: ALPHA_GATEWAY_PROVIDER_ID,
        model: model.id,
        wireApi: 'responses' as const,
        contextWindowTokens: model.provider.trim().toLowerCase() === 'openai'
          ? undefined
          : model.contextWindowTokens
            ? normalizeCustomModelContextWindowTokens(model.contextWindowTokens)
            : DEFAULT_CUSTOM_MODEL_CONTEXT_WINDOW_TOKENS,
        maxOutputTokens: model.provider.trim().toLowerCase() === 'openai'
          ? undefined
          : normalizeCustomModelMaxOutputTokens(
              model.maxOutputTokens,
              model.contextWindowTokens ?? DEFAULT_CUSTOM_MODEL_CONTEXT_WINDOW_TOKENS,
            ),
        enabled: true,
        supportsReasoningEffort: supportedReasoningEfforts.some(({ reasoningEffort }) => reasoningEffort !== 'none'),
        supportedReasoningEfforts,
        defaultReasoningEffort,
        supportsFastMode: model.fastModeSupported !== false,
      };
    });
  return [...subscriptionProfiles, ...gatewayProfiles];
}

async function alphaFetch<T>(
  apiBaseUrl: string,
  path: string,
  init: RequestInit,
  options: { retryLoopback?: boolean } = {},
): Promise<T> {
  const baseUrls = options.retryLoopback
    ? apiBaseUrlCandidates(apiBaseUrl)
    : [normalizeApiBaseUrl(apiBaseUrl)];
  let response: Response | null = null;
  let lastError: unknown = null;

  for (const baseUrl of baseUrls) {
    try {
      response = await fetch(`${baseUrl}${path}`, {
        ...init,
        headers: {
          'content-type': 'application/json',
          ...(init.headers || {}),
        },
      });
      break;
    } catch (error) {
      lastError = error;
    }
  }

  if (!response) {
    const endpoint = normalizeApiBaseUrl(apiBaseUrl);
    const originalMessage = lastError instanceof Error && lastError.message.trim()
      ? ` 原始错误：${lastError.message.trim()}`
      : '';
    const nextStep = endpoint.startsWith('http://localhost')
      ? '本地部署可执行 docker compose up -d。'
      : '请检查网络或服务地址。';
    throw new Error(`无法连接 Alpha Studio 服务（${endpoint}）。请确认后台服务已启动；${nextStep}${originalMessage}`);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new AlphaApiError(
      apiErrorMessage(text) || `Alpha Studio API ${response.status}`,
      response.status,
    );
  }

  try {
    return await response.json();
  } catch {
    throw new Error(`Alpha Studio 服务返回了无效数据（${path}）。`);
  }
}

export class AlphaApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'AlphaApiError';
    this.status = status;
  }
}

export function isClientAuthorizationError(error: unknown): boolean {
  return error instanceof AlphaApiError && (error.status === 401 || error.status === 403);
}

function normalizeClientLicenseSession(value: unknown): ClientLicenseSession | null {
  if (!value || typeof value !== 'object') return null;
  const parsed = value as Partial<ClientLicenseSession>;
  if (
    typeof parsed.apiBaseUrl !== 'string'
    || !parsed.apiBaseUrl.trim()
    || typeof parsed.activatedAt !== 'number'
    || !Number.isFinite(parsed.activatedAt)
    || !parsed.tenant
    || typeof parsed.tenant.id !== 'string'
    || !parsed.tenant.id.trim()
    || !parsed.user
    || typeof parsed.user.id !== 'string'
    || !parsed.user.id.trim()
    || !parsed.device
    || typeof parsed.device.id !== 'string'
    || !parsed.device.id.trim()
    || typeof parsed.device.accessToken !== 'string'
    || !parsed.device.accessToken.trim()
    || typeof parsed.device.leaseExpiresAt !== 'string'
    || !Number.isFinite(Date.parse(parsed.device.leaseExpiresAt))
  ) {
    return null;
  }
  return {
    ...parsed,
    apiBaseUrl: normalizeApiBaseUrl(parsed.apiBaseUrl),
    tenant: { ...parsed.tenant, enabledModules: normalizeEnabledModules(parsed.tenant.enabledModules) },
    user: parsed.user,
    device: parsed.device,
    models: Array.isArray(parsed.models) ? parsed.models : [],
    codexAccounts: Array.isArray(parsed.codexAccounts) ? parsed.codexAccounts : [],
  } as ClientLicenseSession;
}

function apiBaseUrlCandidates(value: string): string[] {
  const normalized = normalizeApiBaseUrl(value);
  const candidates = [normalized];
  try {
    const url = new URL(normalized);
    if (url.protocol === 'http:' && url.hostname === 'localhost') {
      url.hostname = '127.0.0.1';
      candidates.push(url.toString().replace(/\/$/, ''));
    }
  } catch {
    // The primary request below will produce the actionable error message.
  }
  return [...new Set(candidates)];
}

function apiErrorMessage(text: string): string {
  if (!text.trim()) return '';
  try {
    const payload = JSON.parse(text) as { error?: { message?: unknown }; message?: unknown };
    const message = payload.error?.message ?? payload.message;
    if (typeof message === 'string' && message.trim()) return message.trim();
  } catch {
    // Preserve non-JSON API errors below.
  }
  return text.trim();
}

function normalizeApiBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

// Module operations always consult the server; cached UI visibility is not authorization.
export async function authorizeClientModules(session: ClientLicenseSession, moduleIds: string[]): Promise<void> {
  if (!moduleIds.length) return;
  const result = await alphaFetch<{ authorized: boolean }>(session.apiBaseUrl, '/api/client/modules/authorize', {
    method: 'POST',
    headers: deviceAuthorizationHeaders(session),
    body: JSON.stringify({ tenantId: session.tenant.id, deviceId: session.device.id, moduleIds }),
  });
  if (result.authorized !== true) throw new Error('模块权限校验失败，请刷新授权后重试。');
}
