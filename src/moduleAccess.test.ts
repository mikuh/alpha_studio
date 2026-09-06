import { afterEach, describe, expect, it, vi } from 'vitest';
import { authorizeModuleTask } from './moduleAccess';
import { moduleTestSession } from './test/moduleLicense';
import { hasModule, normalizeEnabledModules } from '../shared/productModules';
import { loadClientLicenseSession, renewClientLease, saveClientLicenseSession } from './license';

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

describe('customer module permissions', () => {
  it('defaults to deny and keeps grants isolated between customers', () => {
    expect(hasModule(null, 'browser')).toBe(false);
    expect(hasModule(moduleTestSession(), 'browser')).toBe(false);
    expect(hasModule(moduleTestSession(['browser']), 'browser')).toBe(true);
    expect(hasModule(moduleTestSession(['files']), 'browser')).toBe(false);
    expect(normalizeEnabledModules(['browser', 'unknown', 1, 'browser'])).toEqual(['browser']);
  });

  it('rejects direct skill invocation and coworker tasks without making a request', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    await expect(authorizeModuleTask(moduleTestSession(), '使用 $alpha-studio-daily-theme-research')).rejects.toThrow('未开通');
    await expect(authorizeModuleTask(moduleTestSession(), '分析市场', undefined, true)).rejects.toThrow('AI 同事');
    await expect(authorizeModuleTask(moduleTestSession(), '普通对话')).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('checks current server grants even when the local session claims access', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'module revoked' } }), { status: 403 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(authorizeModuleTask(moduleTestSession(['daily-report']), '使用 $alpha-studio-daily-theme-research')).rejects.toThrow('module revoked');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ tenantId: 'module-tenant', deviceId: 'module-device', moduleIds: ['daily-report'] });
    expect(fetchMock.mock.calls[0][1].headers.authorization).toBe('Bearer module-test-token');
  });

  it('replaces cached permissions on renewal, including missing grants from an older server', async () => {
    const session = moduleTestSession(['files', 'browser']); saveClientLicenseSession(session);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ leaseExpiresAt: session.device.leaseExpiresAt, tenant: { ...session.tenant, enabledModules: ['daily-report'] } }))));
    const renewed = await renewClientLease(session);
    expect(renewed.tenant.enabledModules).toEqual(['daily-report']);
    expect(loadClientLicenseSession()?.tenant.enabledModules).toEqual(['daily-report']);
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ leaseExpiresAt: session.device.leaseExpiresAt })));
    expect((await renewClientLease(renewed)).tenant.enabledModules).toEqual([]);
  });

  it('fails closed if the authorization server is offline or returns an invalid success body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(authorizeModuleTask(moduleTestSession(['daily-report']), '', 'alpha-studio-daily-theme-research')).rejects.toThrow('无法连接');
    vi.mocked(fetch).mockResolvedValue(new Response('{}'));
    await expect(authorizeModuleTask(moduleTestSession(['daily-report']), '', 'alpha-studio-daily-theme-research')).rejects.toThrow('校验失败');
  });
});
