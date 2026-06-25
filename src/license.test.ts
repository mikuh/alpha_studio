import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activateClient,
  clearClientLicenseSession,
  createGatewayRun,
  defaultAlphaApiBaseUrl,
  loadClientLicenseSession,
  modelProfilesFromClientLicense,
  saveClientLicenseSession,
} from './license';

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

    const run = await createGatewayRun('gpt-5.5', 500);

    expect(run.providerBaseUrl).toBe('http://localhost:18080/v1');
    expect(run.providerApiKey).toBe('run-token');
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:18080/api/runs/create',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"tenantId":"tenant_demo"'),
      }),
    );
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
