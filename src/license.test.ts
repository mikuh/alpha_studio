import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ALPHA_GATEWAY_PROVIDER_ID,
  activateClient,
  clearClientLicenseSession,
  createGatewayRun,
  defaultAlphaApiBaseUrl,
  fetchClientBillingSummary,
  fetchClientDevices,
  isCodexAccountAllowed,
  isClientAuthorizationError,
  isEnterpriseAuthorizationFresh,
  loadClientLicenseSession,
  modelProfilesFromClientLicense,
  renewClientLease,
  revokeClientDevice,
  saveClientLicenseSession,
  validateCodexAuthorization,
} from './license';
import { modelProfilesFromCodexCatalog } from './models';
import type { CodexModelCatalogItem } from './types';
import { currentClientAgreementAcceptance } from './legal';

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
    accessToken: 'device-token',
    leaseExpiresAt: '2026-07-01T00:00:00.000Z',
  },
  models: [
    {
      id: 'gpt-5.5',
      label: 'GPT-5.5 API',
      provider: 'openai',
      mode: 'gateway_api',
      enabled: true,
      supportedReasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
      defaultReasoningEffort: 'medium',
      fastModeSupported: true,
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

const assignedCodexAccount = {
  id: 'codex_demo',
  email: 'managed@demo.local',
  plan: 'monthly',
  seatLimit: 2,
};

const acceptedAgreements = currentClientAgreementAcceptance({
  serviceTerms: true,
  privacyPolicy: true,
  thirdPartyModelNotice: true,
  researchRiskDisclosure: true,
});

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
      agreementAcceptance: acceptedAgreements,
    });

    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:18080/api/client/activate',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"companyName":"Demo Fund"'),
      }),
    );
    expect(session.tenant.id).toBe('tenant_demo');
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string)).toMatchObject({
      agreementAcceptance: {
        serviceTermsVersion: '2026-08-04',
        serviceTermsAccepted: true,
        privacyPolicyAccepted: true,
        thirdPartyModelNoticeAccepted: true,
        researchRiskDisclosureAccepted: true,
      },
    });
    expect(loadClientLicenseSession()?.device.id).toBe('dev_demo');
  });

  it('rejects an activation response that cannot be restored on the next launch', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      ...activationResponse,
      device: {
        id: activationResponse.device.id,
        leaseExpiresAt: activationResponse.device.leaseExpiresAt,
      },
    }));

    await expect(activateClient({
      apiBaseUrl: 'http://localhost:18080',
      companyName: 'Demo Fund',
      authorizationCode: 'AS-TEST-CODE',
      deviceName: 'Geb Mac',
      fingerprint: 'fp-test',
      agreementAcceptance: acceptedAgreements,
    })).rejects.toThrow('激活响应不完整');

    expect(loadClientLicenseSession()).toBeNull();
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
      supportsReasoningEffort: true,
      defaultReasoningEffort: 'medium',
      supportsFastMode: true,
    });
    expect(profiles[0].supportedReasoningEfforts?.map((item) => item.reasoningEffort)).toEqual([
      'none', 'low', 'medium', 'high', 'xhigh', 'max',
    ]);
    expect(profiles[0].contextWindowTokens).toBeUndefined();
  });

  it('propagates each gateway model context window to the desktop profile', () => {
    const profiles = modelProfilesFromClientLicense({
      apiBaseUrl: defaultAlphaApiBaseUrl(),
      activatedAt: 1,
      ...activationResponse,
      models: [{
        id: 'claude-route',
        label: 'Claude Route',
        provider: 'anthropic',
        mode: 'gateway_api',
        enabled: true,
        contextWindowTokens: 200_000,
        maxOutputTokens: 40_000,
      }],
    });

    expect(profiles[0]).toMatchObject({
      id: 'claude-route',
      providerId: ALPHA_GATEWAY_PROVIDER_ID,
      contextWindowTokens: 200_000,
      maxOutputTokens: 40_000,
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
      codexAccounts: [assignedCodexAccount],
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
      codexAccounts: [assignedCodexAccount],
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
      codexAccounts: [assignedCodexAccount],
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

  it('does not expose Codex subscription models until an administrator assigns an account', () => {
    const profiles = modelProfilesFromClientLicense({
      apiBaseUrl: defaultAlphaApiBaseUrl(),
      activatedAt: 1,
      ...activationResponse,
      tenant: {
        ...activationResponse.tenant,
        codexSubscriptionEnabled: true,
      },
      codexAccounts: [],
    }, modelProfilesFromCodexCatalog(catalog));

    expect(profiles.some((profile) => profile.builtIn)).toBe(false);
  });

  it('matches the local Codex identity only to a backend-assigned account', () => {
    const session = {
      apiBaseUrl: defaultAlphaApiBaseUrl(),
      activatedAt: 1,
      ...activationResponse,
      tenant: { ...activationResponse.tenant, codexSubscriptionEnabled: true },
      codexAccounts: [assignedCodexAccount],
    };

    expect(isCodexAccountAllowed(session, ' MANAGED@demo.local ')).toBe(true);
    expect(isCodexAccountAllowed(session, 'other@demo.local')).toBe(false);
  });

  it('expires the cached enterprise authorization after five days', () => {
    const validatedAt = Date.UTC(2026, 6, 1);
    const session = {
      apiBaseUrl: defaultAlphaApiBaseUrl(),
      activatedAt: validatedAt,
      lastValidatedAt: validatedAt,
      ...activationResponse,
      device: {
        ...activationResponse.device,
        leaseExpiresAt: '2026-07-10T00:00:00.000Z',
      },
    };

    expect(isEnterpriseAuthorizationFresh(session, validatedAt + 4 * 24 * 60 * 60 * 1000)).toBe(true);
    expect(isEnterpriseAuthorizationFresh(session, validatedAt + 5 * 24 * 60 * 60 * 1000)).toBe(false);
  });

  it('asks the backend to authorize the exact signed-in Codex account', async () => {
    saveClientLicenseSession({
      apiBaseUrl: 'http://localhost:18080',
      activatedAt: 1,
      ...activationResponse,
    });
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      authorized: true,
      accountId: 'codex_demo',
      email: 'managed@demo.local',
    }));

    const result = await validateCodexAuthorization(
      loadClientLicenseSession()!,
      'managed@demo.local',
    );

    expect(result.authorized).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:18080/api/client/codex-authorization',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"email":"managed@demo.local"'),
      }),
    );
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

    const run = await createGatewayRun('gpt-5.5');

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
        body: expect.stringContaining('"budgetYuan":20'),
      }),
    );
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:18080/api/runs/create',
      expect.objectContaining({
        body: expect.stringContaining('"fastMode":false'),
      }),
    );
  });

  it('marks fast gateway runs so the server can size their safety budget at priority prices', async () => {
    saveClientLicenseSession({
      apiBaseUrl: 'http://localhost:18080',
      activatedAt: 1,
      ...activationResponse,
    });
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      runId: 'run_fast',
      runToken: 'run-token-fast',
      gatewayUrl: 'http://localhost:18080/v1/responses',
    }));

    await createGatewayRun('gpt-5.5', 20, true);

    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:18080/api/runs/create',
      expect.objectContaining({
        body: expect.stringContaining('"fastMode":true'),
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

    const summary = await fetchClientBillingSummary(loadClientLicenseSession()!, {
      period: { kind: 'year', value: '2025' },
    });

    expect(summary.tenant.balanceYuan).toBe(88);
    expect(summary.usage.currentMonth.billableYuan).toBe(0.02);
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:18080/api/client/billing-summary',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringMatching(/"deviceId":"dev_demo".*"periodKind":"year".*"periodValue":"2025"/),
      }),
    );
  });

  it('loads all devices and revokes another device through the administrator device', async () => {
    saveClientLicenseSession({
      apiBaseUrl: 'http://localhost:18080',
      activatedAt: 1,
      ...activationResponse,
    });
    const summary = {
      activeDevices: 2,
      maxDevices: 2,
      isAdministrator: true,
      devices: [
        {
          id: 'dev_demo',
          name: 'Alpha Studio MacIntel',
          status: 'active',
          isCurrent: true,
          isAdministrator: true,
          createdAt: '2026-07-01T00:00:00.000Z',
        },
        {
          id: 'dev_other',
          name: 'Alpha Studio Win32',
          status: 'active',
          isCurrent: false,
          isAdministrator: false,
          createdAt: '2026-07-02T00:00:00.000Z',
        },
      ],
    };
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(summary))
      .mockResolvedValueOnce(jsonResponse({
        ...summary,
        activeDevices: 1,
        devices: summary.devices.map((device) => (
          device.id === 'dev_other' ? { ...device, status: 'revoked' } : device
        )),
      }));

    const devices = await fetchClientDevices(loadClientLicenseSession()!);
    const revoked = await revokeClientDevice(loadClientLicenseSession()!, 'dev_other');

    expect(devices.isAdministrator).toBe(true);
    expect(devices.devices).toHaveLength(2);
    expect(revoked.activeDevices).toBe(1);
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      'http://localhost:18080/api/client/devices/revoke',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"targetDeviceId":"dev_other"'),
      }),
    );
  });

  it('classifies a forbidden lease response as a client authorization failure', async () => {
    saveClientLicenseSession({
      apiBaseUrl: 'http://localhost:18080',
      activatedAt: 1,
      ...activationResponse,
    });
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: () => Promise.resolve(JSON.stringify({
        error: { message: 'device is not active for this tenant' },
      })),
    } as Response);

    const error = await renewClientLease(loadClientLicenseSession()!).catch((caught) => caught);

    expect(isClientAuthorizationError(error)).toBe(true);
    expect(error).toMatchObject({ status: 403 });
  });

  it('turns a network-level billing failure into an actionable error', async () => {
    saveClientLicenseSession({
      apiBaseUrl: 'https://billing.example.test',
      activatedAt: 1,
      ...activationResponse,
    });
    vi.mocked(fetch).mockRejectedValue(new TypeError('Load failed'));

    await expect(fetchClientBillingSummary(loadClientLicenseSession()!)).rejects.toThrow(
      '无法连接 Alpha Studio 服务（https://billing.example.test）。请确认后台服务已启动；请检查网络或服务地址。 原始错误：Load failed',
    );
  });

  it('retries localhost through IPv4 when the first address cannot connect', async () => {
    saveClientLicenseSession({
      apiBaseUrl: 'http://localhost:18080',
      activatedAt: 1,
      ...activationResponse,
    });
    vi.mocked(fetch)
      .mockRejectedValueOnce(new TypeError('Load failed'))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    await expect(fetchClientBillingSummary(loadClientLicenseSession()!)).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:18080/api/client/billing-summary',
      expect.objectContaining({ method: 'POST' }),
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
