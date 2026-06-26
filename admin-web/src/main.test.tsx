import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const providers = [
  {
    provider: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    endpointPath: '/responses',
    enabled: true,
    keyConfigured: true,
    keyMask: 'sk-****test',
  },
  {
    provider: 'deepseek',
    label: 'DeepSeek OpenAI-Compatible',
    baseUrl: 'https://api.deepseek.com/v1',
    endpointPath: '/responses',
    enabled: true,
    keyConfigured: false,
    keyMask: null,
  },
];

const models = [
  {
    id: 'route_gpt_55',
    modelId: 'gpt-5.5',
    label: 'GPT-5.5 API',
    provider: 'openai',
    mode: 'gateway_api',
    baseUrl: 'https://api.openai.com/v1',
    endpointPath: '/responses',
    upstreamModel: 'gpt-5.5',
    enabled: true,
    sortOrder: 10,
    inputCentsPerMillion: 120,
    outputCentsPerMillion: 480,
    reasoningCentsPerMillion: 480,
    cachedInputCentsPerMillion: 30,
    markupBps: 2500,
    providerReady: true,
  },
  {
    id: 'route_deepseek_chat',
    modelId: 'deepseek-chat',
    label: 'DeepSeek Chat',
    provider: 'deepseek',
    mode: 'gateway_api',
    baseUrl: 'https://api.deepseek.com/v1',
    endpointPath: '/responses',
    upstreamModel: 'deepseek-chat',
    enabled: true,
    sortOrder: 20,
    inputCentsPerMillion: 14,
    outputCentsPerMillion: 28,
    reasoningCentsPerMillion: 0,
    cachedInputCentsPerMillion: 0,
    markupBps: 2500,
    providerReady: false,
  },
];

const tenants = [
  {
    id: 'tenant_alpha',
    name: 'Alpha Fund',
    status: 'active',
    maxDevices: 3,
    billingMode: 'hybrid',
    balanceCents: 120000,
    subscriptionPlan: 'pro',
    subscriptionExpiresAt: null,
    codexSubscriptionEnabled: true,
    codexSubscriptionPlan: 'monthly',
    codexSubscriptionExpiresAt: null,
    activeDevices: 1,
    billableCents: 2400,
  },
];

const authorizationCodes = [
  {
    id: 'auth_alpha',
    tenantId: 'tenant_alpha',
    tenantName: 'Alpha Fund',
    authorizationCode: 'ALPHA-CODE-1234',
    codeHint: 'ALP****1234',
    maxDevices: 3,
    status: 'active',
    expiresAt: null,
    lastUsedAt: null,
    note: 'primary onboarding',
    createdAt: '2026-06-26T00:00:00Z',
  },
];

const codexAccounts = [
  {
    id: 'codex_alpha',
    tenantId: 'tenant_alpha',
    tenantName: 'Alpha Fund',
    email: 'codex-alpha@example.com',
    loginSecretConfigured: true,
    loginSecretMask: 'one-******cret',
    loginHint: 'Browser login handoff',
    plan: 'monthly',
    status: 'active',
    seatLimit: 1,
    expiresAt: null,
  },
];

describe('admin model gateway', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    localStorage.setItem('alpha-admin-token', 'test-token');
    document.body.innerHTML = '<div id="root"></div>';
    fetchMock = vi.fn(mockFetch);
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('confirm', vi.fn(() => true));
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('nests model routes under the selected provider', async () => {
    await import('./main');

    fireEvent.click(await screen.findByRole('button', { name: '模型网关' }));
    const deepseekProvider = await screen.findByRole('button', { name: /DeepSeek OpenAI-Compatible/ });

    fireEvent.click(deepseekProvider);

    await waitFor(() => expect(screen.queryByText('GPT-5.5 API')).toBeNull());
    expect(screen.getByText('DeepSeek Chat')).toBeTruthy();
    expect((screen.getByLabelText('供应商') as HTMLSelectElement).value).toBe('deepseek');
  });

  it('deletes a Codex account from the account pool', async () => {
    await import('./main');

    fireEvent.click(await screen.findByRole('button', { name: 'Codex 账号' }));
    await screen.findByText('codex-alpha@example.com');

    fireEvent.click(screen.getByRole('button', { name: '删除账号' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/codex-accounts/codex_alpha',
      expect.objectContaining({ method: 'DELETE' }),
    ));
  });

  it('revokes and deletes authorization codes from the records list', async () => {
    await import('./main');

    fireEvent.click(await screen.findByRole('button', { name: '授权码' }));
    await screen.findByText('ALPHA-CODE-1234');

    fireEvent.click(screen.getByRole('button', { name: '撤销授权码' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/authorization-codes/auth_alpha',
      expect.objectContaining({
        body: JSON.stringify({ status: 'revoked' }),
        method: 'PATCH',
      }),
    ));

    fireEvent.click(screen.getByRole('button', { name: '删除授权码' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/authorization-codes/auth_alpha',
      expect.objectContaining({ method: 'DELETE' }),
    ));
  });

  it('deletes tenants from the customer list', async () => {
    await import('./main');

    fireEvent.click(await screen.findByRole('button', { name: '客户' }));
    await screen.findByText('Alpha Fund');

    fireEvent.click(screen.getByRole('button', { name: '删除客户' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/tenants/tenant_alpha',
      expect.objectContaining({ method: 'DELETE' }),
    ));
  });
});

async function mockFetch(input: RequestInfo | URL) {
  const path = String(input);
  if (path === '/api/admin/summary') {
    return jsonResponse({
      tenants: 0,
      activeDevices: 0,
      runs: 0,
      billableCents: 0,
      configuredProviders: 1,
    });
  }
  if (path === '/api/admin/tenants') return jsonResponse({ tenants });
  if (path === '/api/admin/authorization-codes') return jsonResponse({ authorizationCodes });
  if (path === '/api/admin/provider-configs') return jsonResponse({ providers });
  if (path === '/api/admin/model-routes') return jsonResponse({ models });
  if (path === '/api/admin/codex-accounts') return jsonResponse({ accounts: codexAccounts });
  if (path === '/api/admin/audit-logs') return jsonResponse({ logs: [] });
  if (
    path.startsWith('/api/admin/codex-accounts/') ||
    path.startsWith('/api/admin/authorization-codes/') ||
    path.startsWith('/api/admin/tenants/')
  ) return jsonResponse({ ok: true });
  return new Response('not found', { status: 404 });
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
