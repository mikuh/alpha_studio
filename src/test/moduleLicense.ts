import type { ClientLicenseSession } from '../license';
export function moduleTestSession(enabledModules: string[] = []): ClientLicenseSession {
  return {
    apiBaseUrl: 'https://modules.example.test', activatedAt: Date.now(), lastValidatedAt: Date.now(),
    tenant: { id: 'module-tenant', name: 'Module Customer', maxDevices: 2, codexSubscriptionEnabled: false, enabledModules },
    user: { id: 'module-user', name: 'User', email: 'user@example.test' },
    device: { id: 'module-device', accessToken: 'module-test-token', leaseExpiresAt: new Date(Date.now() + 86400000).toISOString() },
    models: [], codexAccounts: [],
  };
}
