import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activateClient,
  clearClientLicenseSession,
  ENTERPRISE_AUTHORIZATION_CHECK_INTERVAL_MS,
  isEnterpriseAuthorizationFresh,
  loadClientLicenseSession,
  renewClientLease,
} from './license';
import { currentClientAgreementAcceptance } from './legal';

const start = Date.UTC(2026, 7, 4, 9, 0, 0);

describe('安装、升级、断网、授权过期和恢复生命周期', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(start);
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('keeps a valid local lease through restart, blocks after expiry, and recovers online', async () => {
    expect(loadClientLicenseSession()).toBeNull();
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      tenant: {
        id: 'tenant_lifecycle',
        name: 'Lifecycle Customer',
        maxDevices: 2,
        codexSubscriptionEnabled: false,
      },
      user: { id: 'user_lifecycle', email: 'user@example.test', name: 'User' },
      device: {
        id: 'device_lifecycle',
        accessToken: 'token-v1',
        leaseExpiresAt: '2026-09-01T00:00:00.000Z',
      },
      models: [],
      codexAccounts: [],
    }));

    await activateClient({
      apiBaseUrl: 'https://api.example.test',
      companyName: 'Lifecycle Customer',
      authorizationCode: 'AS-LIFECYCLE',
      deviceName: 'Test Mac',
      fingerprint: 'fingerprint-lifecycle',
      agreementAcceptance: currentClientAgreementAcceptance({
        serviceTerms: true,
        privacyPolicy: true,
        thirdPartyModelNotice: true,
        researchRiskDisclosure: true,
      }),
    });

    const afterRestart = loadClientLicenseSession();
    expect(afterRestart?.device.accessToken).toBe('token-v1');
    expect(isEnterpriseAuthorizationFresh(afterRestart!, start + 24 * 60 * 60 * 1000)).toBe(true);

    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('offline'));
    await expect(renewClientLease(afterRestart!)).rejects.toThrow('无法连接 Alpha Studio 服务');
    expect(isEnterpriseAuthorizationFresh(loadClientLicenseSession()!, start + 24 * 60 * 60 * 1000)).toBe(true);

    const expiredAt = start + ENTERPRISE_AUTHORIZATION_CHECK_INTERVAL_MS + 30_000;
    vi.setSystemTime(expiredAt);
    expect(isEnterpriseAuthorizationFresh(loadClientLicenseSession()!, expiredAt)).toBe(false);

    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      accessToken: 'token-v2',
      leaseExpiresAt: '2026-09-15T00:00:00.000Z',
    }));
    const recovered = await renewClientLease(loadClientLicenseSession()!);
    expect(recovered.device.accessToken).toBe('token-v2');
    expect(isEnterpriseAuthorizationFresh(recovered, expiredAt)).toBe(true);

    clearClientLicenseSession();
    expect(loadClientLicenseSession()).toBeNull();
  });

  it('restores a pre-upgrade session while ignoring additional storage fields', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      tenant: { id: 'tenant_upgrade', name: 'Upgrade Customer', maxDevices: 1, codexSubscriptionEnabled: false },
      user: { id: 'user_upgrade', email: 'upgrade@example.test', name: 'Upgrade User' },
      device: { id: 'device_upgrade', accessToken: 'upgrade-token', leaseExpiresAt: '2026-09-01T00:00:00.000Z' },
      models: [],
      codexAccounts: [],
    }));
    await activateClient({
      apiBaseUrl: 'https://api.example.test/',
      companyName: 'Upgrade Customer',
      authorizationCode: 'AS-UPGRADE',
      deviceName: 'Upgrade Mac',
      fingerprint: 'fingerprint-upgrade',
      agreementAcceptance: currentClientAgreementAcceptance({
        serviceTerms: true,
        privacyPolicy: true,
        thirdPartyModelNotice: true,
        researchRiskDisclosure: true,
      }),
    });

    const key = 'alpha:client-license-session';
    const stored = JSON.parse(localStorage.getItem(key) || '{}') as Record<string, unknown>;
    localStorage.setItem(key, JSON.stringify({ ...stored, previousClientVersion: '0.0.9' }));

    expect(loadClientLicenseSession()).toMatchObject({
      apiBaseUrl: 'https://api.example.test',
      device: { accessToken: 'upgrade-token' },
    });
  });
});

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;
}
