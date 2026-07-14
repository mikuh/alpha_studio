import { defaultModelProfiles, type ModelProfile } from './models';

const SESSION_KEY = 'alpha:client-license-session';
const DEVICE_FINGERPRINT_KEY = 'alpha:device-fingerprint';
export const ALPHA_GATEWAY_PROVIDER_ID = 'alpha-gateway';

export interface ClientTenant {
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
  leaseExpiresAt: string;
}

export interface ClientModel {
  id: string;
  label: string;
  provider: string;
  mode: string;
  enabled: boolean;
}

export interface ClientCodexAccount {
  id: string;
  email: string;
  loginSecret?: string;
  loginHint?: string;
  plan: string;
  seatLimit: number;
  expiresAt?: string | null;
}

export interface ClientLicenseSession {
  apiBaseUrl: string;
  activatedAt: number;
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
    currentMonthStart: string;
    currentMonthEnd: string;
    generatedAt: string;
  };
  usage: {
    currentMonth: BillingUsageTotals;
    allTime: BillingUsageTotals;
    models: BillingModelUsage[];
    recentLedger: BillingLedgerEntry[];
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
    const parsed = JSON.parse(raw) as ClientLicenseSession;
    if (!parsed?.tenant?.id || !parsed?.device?.id || !parsed?.apiBaseUrl) return null;
    return {
      ...parsed,
      apiBaseUrl: normalizeApiBaseUrl(parsed.apiBaseUrl),
      models: Array.isArray(parsed.models) ? parsed.models : [],
      codexAccounts: Array.isArray(parsed.codexAccounts) ? parsed.codexAccounts : [],
    };
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
  };
  const data = await alphaFetch<Omit<ClientLicenseSession, 'apiBaseUrl' | 'activatedAt'>>(
    apiBaseUrl,
    '/api/client/activate',
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
  );
  const session: ClientLicenseSession = {
    ...data,
    apiBaseUrl,
    activatedAt: Date.now(),
  };
  saveClientLicenseSession(session);
  return session;
}

export async function renewClientLease(session: ClientLicenseSession): Promise<ClientLicenseSession> {
  const data = await alphaFetch<{
    leaseExpiresAt: string;
    tenant?: ClientTenant;
    models?: ClientModel[];
    codexAccounts?: ClientCodexAccount[];
  }>(session.apiBaseUrl, '/api/devices/lease', {
    method: 'POST',
    body: JSON.stringify({
      tenantId: session.tenant.id,
      deviceId: session.device.id,
    }),
  });
  const renewed = {
    ...session,
    device: {
      ...session.device,
      leaseExpiresAt: data.leaseExpiresAt,
    },
    tenant: data.tenant ? { ...session.tenant, ...data.tenant } : session.tenant,
    models: Array.isArray(data.models) ? data.models : session.models,
    codexAccounts: Array.isArray(data.codexAccounts) ? data.codexAccounts : session.codexAccounts,
  };
  saveClientLicenseSession(renewed);
  return renewed;
}

export async function createGatewayRun(modelId: string, budgetYuan = 5): Promise<GatewayRunConfig> {
  const session = loadClientLicenseSession();
  if (!session) throw new Error('Alpha Studio 客户端尚未激活。');
  const data = await alphaFetch<{ runId: string; runToken: string }>(session.apiBaseUrl, '/api/runs/create', {
    method: 'POST',
    body: JSON.stringify({
      tenantId: session.tenant.id,
      userId: session.user.id,
      deviceId: session.device.id,
      modelId,
      budgetYuan,
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

export async function fetchClientBillingSummary(session: ClientLicenseSession): Promise<ClientBillingSummary> {
  return alphaFetch<ClientBillingSummary>(session.apiBaseUrl, '/api/client/billing-summary', {
    method: 'POST',
    body: JSON.stringify({
      tenantId: session.tenant.id,
      deviceId: session.device.id,
    }),
  }, { retryLoopback: true });
}

export function modelProfilesFromClientLicense(
  session: ClientLicenseSession,
  availableSubscriptionProfiles: readonly ModelProfile[] = defaultModelProfiles(),
): ModelProfile[] {
  const subscriptionProfiles = session.tenant.codexSubscriptionEnabled
    ? availableSubscriptionProfiles.map((profile) => ({ ...profile }))
    : [];
  const occupied = new Set(subscriptionProfiles.map((profile) => profile.id));
  const gatewayProfiles = session.models
    .filter((model) => model.enabled && model.mode === 'gateway_api')
    .map((model) => {
      const id = occupied.has(model.id) ? `gateway:${model.id}` : model.id;
      occupied.add(id);
      return {
        id,
        label: model.label,
        providerId: ALPHA_GATEWAY_PROVIDER_ID,
        model: model.id,
        wireApi: 'responses' as const,
        enabled: true,
        supportsReasoningEffort: true,
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
    throw new Error(apiErrorMessage(text) || `Alpha Studio API ${response.status}`);
  }

  try {
    return await response.json();
  } catch {
    throw new Error(`Alpha Studio 服务返回了无效数据（${path}）。`);
  }
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
