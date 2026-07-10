import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ALPHA_GATEWAY_PROVIDER_ID,
  activateClient,
  clearClientLicenseSession,
  createGatewayRun,
  defaultAlphaApiBaseUrl,
  fetchClientBillingSummary,
  loadClientLicenseSession,
  modelProfilesFromClientLicense,
  renewClientLease,
  saveClientLicenseSession,
} from './license';
import { modelProfilesFromCodexCatalog } from './models';
import type { CodexModelCatalogItem } from './types';

const activationResponse = {
  tenant: {
    id: 'tenant_demo',
    name: 'Demo Fund',
    maxDevices: 2,
    codexSubscriptionEnabled: false,
  },
  user: {
    id: 'user_demo',
    email: 'user@demo.local',
    name: 'Demo User',
  },
  device: {
    id: 'dev_demo',
    leaseExpiresAt: '2026-07-01T00:00:00.000Z',
  },
  models: [
    {
      id: 'gpt-5.5',
      label: 'GPT-5.5 API',
      provider: 'openai',
      mode: 'gateway_api',
      enabled: true,
    },
  ],
  codexAccounts: [],
};

const catalog: CodexModelCatalogItem[] = [
  {
    id: 'gpt-5.6-sol',
    displayName: 'GPT-5.6 Sol',
    isDefault: true,
    hidden: false,
    defaultReasoningEffort: 'max',
    supportedReasoningEfforts: [
      { reasoningEffort: 'high', description: 'Thorough' },
      { reasoningEffort: 'max', description: 'Maximum' },
      { reasoningEffort: 'ultra', description: 'Ultra' },
    ],
  },
  {
    id: 'gpt-5.6-terra',
    displayName: 'GPT-5.6 Terra',
    isDefault: false,
    hidden: false,
    defaultReasoningEffort: 'high',
    supportedReasoningEfforts: [
      { reasoningEffort: 'low', description: 'Fast' },
      { reasoningEffort: 'high', description: 'Thorough' },
      { reasoningEffort: 'max', description: 'Maximum' },
    ],
  },
];

describe('client license session', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not produce a usable session before activation', () => {
    expect(loadClientLicenseSession()).toBeNull();
  });

  it('activates by company and authorization code, then stores the tenant/device session', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(activationResponse));

    const session = await activateClient({
      apiBaseUrl: 'http://localhost:18080',
      companyName: 'Demo Fund',
      authorizationCode: 'AS-TEST-CODE',
      deviceName: 'Geb Mac',
      fingerprint: 'fp-test',
    });

    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:18080/api/client/activate',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"companyName":"Demo Fund"'),
      }),
    );
    expect(session.tenant.id).toBe('tenant_demo');
    expect(loadClientLicenseSession()?.device.id).toBe('dev_demo');
  });

  it('maps gateway models without enabling Codex subscription models', () => {
    saveClientLicenseSession({
      apiBaseUrl: defaultAlphaApiBaseUrl(),
      activatedAt: 1,
      ...activationResponse,
    });

    const profiles = modelProfilesFromClientLicense(loadClientLicenseSession()!);

    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({
      id: 'gpt-5.5',
      providerId: 'alpha-gateway',
      model: 'gpt-5.5',
      wireApi: 'responses',
    });
  });

  it('keeps Codex subscription models available only when the backend grants subscription access', () => {
    const profiles = modelProfilesFromClientLicense({
      apiBaseUrl: defaultAlphaApiBaseUrl(),
      activatedAt: 1,
      ...activationResponse,
      tenant: {
        ...activationResponse.tenant,
        codexSubscriptionEnabled: true,
        codexSubscriptionPlan: 'monthly',
      },
    });

    expect(profiles.some((profile) => profile.providerId === 'openai' && profile.builtIn)).toBe(true);
    expect(profiles.some((profile) => profile.providerId === 'alpha-gateway')).toBe(true);
  });

  it('uses the supplied Codex subscription catalog without changing gateway order', () => {
    saveClientLicenseSession({
      apiBaseUrl: defaultAlphaApiBaseUrl(),
      activatedAt: 1,
      ...activationResponse,
      tenant: {
        ...activationResponse.tenant,
        codexSubscriptionEnabled: true,
      },
    });
    const session = loadClientLicenseSession()!;
    const dynamic = modelProfilesFromCodexCatalog(catalog);

    const profiles = modelProfilesFromClientLicense(session, dynamic);

    expect(profiles.slice(0, 2).map((profile) => profile.id)).toEqual([
      'gpt-5.6-sol', 'gpt-5.6-terra',
    ]);
    expect(profiles.filter((profile) => profile.providerId === ALPHA_GATEWAY_PROVIDER_ID).map((profile) => profile.model))
      .toEqual(session.models.filter((model) => model.enabled && model.mode === 'gateway_api').map((model) => model.id));
  });

  it('prefixes a gateway id that collides with the dynamic subscription catalog', () => {
    saveClientLicenseSession({
      apiBaseUrl: defaultAlphaApiBaseUrl(),
      activatedAt: 1,
      ...activationResponse,
      tenant: {
        ...activationResponse.tenant,
        codexSubscriptionEnabled: true,
      },
    });
    const session = loadClientLicenseSession()!;
    session.models = [{
      id: 'gpt-5.6-sol',
      label: 'GPT-5.6 Sol API',
      provider: 'openai',
      mode: 'gateway_api',
      enabled: true,
    }];

    const profiles = modelProfilesFromClientLicense(session, modelProfilesFromCodexCatalog(catalog));

    expect(profiles.map((profile) => profile.id)).toContain('gateway:gpt-5.6-sol');
  });

  it('ignores supplied subscription profiles when the tenant lacks subscription access', () => {
    saveClientLicenseSession({
      apiBaseUrl: defaultAlphaApiBaseUrl(),
      activatedAt: 1,
      ...activationResponse,
      tenant: {
        ...activationResponse.tenant,
        codexSubscriptionEnabled: true,
      },
    });
    const session = loadClientLicenseSession()!;
    session.tenant.codexSubscriptionEnabled = false;

    const profiles = modelProfilesFromClientLicense(session, modelProfilesFromCodexCatalog(catalog));

    expect(profiles.some((profile) => profile.builtIn)).toBe(false);
    expect(profiles.some((profile) => profile.providerId === ALPHA_GATEWAY_PROVIDER_ID)).toBe(true);
  });

  it('creates a gateway run token for the current tenant device and selected model', async () => {
    saveClientLicenseSession({
      apiBaseUrl: 'http://localhost:18080',
      activatedAt: 1,
      ...activationResponse,
    });
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      runId: 'run_1',
      runToken: 'run-token',
      gatewayUrl: 'http://localhost:18080/v1/responses',
    }));

    const run = await createGatewayRun('gpt-5.5', 5);

    expect(run.providerBaseUrl).toBe('http://localhost:18080/v1');
    expect(run.providerApiKey).toBe('run-token');
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:18080/api/runs/create',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"tenantId":"tenant_demo"'),
      }),
    );
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:18080/api/runs/create',
      expect.objectContaining({
        body: expect.stringContaining('"budgetYuan":5'),
      }),
    );
  });

  it('loads the client billing summary for the active device', async () => {
    saveClientLicenseSession({
      apiBaseUrl: 'http://localhost:18080',
      activatedAt: 1,
      ...activationResponse,
    });
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      tenant: {
        id: 'tenant_demo',
        name: 'Demo Fund',
        maxDevices: 2,
        billingMode: 'hybrid',
        balanceYuan: 88,
        codexSubscriptionEnabled: true,
        codexSubscriptionPlan: 'monthly',
      },
      activeDevices: 1,
      period: {
        currentMonthStart: '2026-07-01T00:00:00.000Z',
        currentMonthEnd: '2026-08-01T00:00:00.000Z',
        generatedAt: '2026-07-09T00:00:00.000Z',
      },
      usage: {
        currentMonth: {
          runCount: 2,
          inputTokens: 100,
          outputTokens: 50,
          reasoningTokens: 0,
          cachedTokens: 10,
          totalTokens: 160,
          costYuan: 0.01,
          billableYuan: 0.02,
          lastUsedAt: '2026-07-09T00:00:00.000Z',
        },
        allTime: {
          runCount: 3,
          inputTokens: 200,
          outputTokens: 70,
          reasoningTokens: 0,
          cachedTokens: 10,
          totalTokens: 280,
          costYuan: 0.03,
          billableYuan: 0.04,
          lastUsedAt: '2026-07-09T00:00:00.000Z',
        },
        models: [],
        recentLedger: [],
      },
    }));

    const summary = await fetchClientBillingSummary(loadClientLicenseSession()!);

    expect(summary.tenant.balanceYuan).toBe(88);
    expect(summary.usage.currentMonth.billableYuan).toBe(0.02);
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:18080/api/client/billing-summary',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"deviceId":"dev_demo"'),
      }),
    );
  });

  it('refreshes stored gateway models when renewing the device lease returns a model catalog', async () => {
    saveClientLicenseSession({
      apiBaseUrl: 'http://localhost:18080',
      activatedAt: 1,
      ...activationResponse,
    });
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      leaseExpiresAt: '2026-07-01T00:05:00.000Z',
      models: [
        {
          id: 'gpt-5.4-mini',
          label: 'GPT-5.4 Mini API',
          provider: 'openai',
          mode: 'gateway_api',
          enabled: true,
        },
      ],
    }));

    const renewed = await renewClientLease(loadClientLicenseSession()!);

    expect(renewed.models).toHaveLength(1);
    expect(renewed.models[0]).toMatchObject({
      id: 'gpt-5.4-mini',
      label: 'GPT-5.4 Mini API',
    });
    expect(loadClientLicenseSession()?.models[0]?.id).toBe('gpt-5.4-mini');
  });

  it('refreshes stored tenant Codex subscription status when renewing the device lease', async () => {
    saveClientLicenseSession({
      apiBaseUrl: 'http://localhost:18080',
      activatedAt: 1,
      ...activationResponse,
    });
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      leaseExpiresAt: '2026-07-01T00:05:00.000Z',
      tenant: {
        id: 'tenant_demo',
        name: 'Demo Fund',
        maxDevices: 5,
        codexSubscriptionEnabled: true,
        codexSubscriptionPlan: 'monthly',
        codexSubscriptionExpiresAt: null,
      },
      codexAccounts: [
        {
          id: 'codex_demo',
          email: 'codex-demo@alpha.local',
          loginHint: 'Use browser login handoff',
          plan: 'monthly',
          seatLimit: 5,
          expiresAt: null,
        },
      ],
    }));

    const renewed = await renewClientLease(loadClientLicenseSession()!);

    expect(renewed.tenant.codexSubscriptionEnabled).toBe(true);
    expect(renewed.tenant.maxDevices).toBe(5);
    expect(renewed.codexAccounts[0]?.email).toBe('codex-demo@alpha.local');
    expect(loadClientLicenseSession()?.tenant.codexSubscriptionEnabled).toBe(true);
  });

  it('clears the stored session', () => {
    saveClientLicenseSession({
      apiBaseUrl: defaultAlphaApiBaseUrl(),
      activatedAt: 1,
      ...activationResponse,
    });
    clearClientLicenseSession();
    expect(loadClientLicenseSession()).toBeNull();
  });
});

function jsonResponse(body: unknown) {
  return {
    ok: true,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;
}
