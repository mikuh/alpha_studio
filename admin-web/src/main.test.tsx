import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
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
    endpointPath: '/chat/completions',
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
    inputYuanPerMillion: 1.2,
    outputYuanPerMillion: 4.8,
    reasoningYuanPerMillion: 4.8,
    cachedInputYuanPerMillion: 0.3,
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
    endpointPath: '/chat/completions',
    upstreamModel: 'deepseek-chat',
    enabled: true,
    sortOrder: 20,
    inputYuanPerMillion: 0.14,
    outputYuanPerMillion: 0.28,
    reasoningYuanPerMillion: 0,
    cachedInputYuanPerMillion: 0,
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
    balanceYuan: 1200,
    subscriptionPlan: 'pro',
    subscriptionExpiresAt: null,
    codexSubscriptionEnabled: true,
    codexSubscriptionPlan: 'monthly',
    codexSubscriptionExpiresAt: null,
    activeDevices: 1,
    billableYuan: 24,
  },
];

const deletedTenant = {
  ...tenants[0],
  id: 'tenant_deleted',
  name: 'Deleted Fund',
};

const betaTenant = {
  ...tenants[0],
  id: 'tenant_beta',
  name: 'Beta Fund',
  maxDevices: 2,
  activeDevices: 0,
  balanceYuan: 500,
  codexSubscriptionEnabled: false,
};

let currentTenants = tenants;

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
    currentTenants = tenants;
    localStorage.setItem('alpha-admin-token', 'test-token');
    document.body.innerHTML = '<div id="root"></div>';
    window.history.replaceState({}, '', '/admin/');
    fetchMock = vi.fn(mockFetch);
    vi.stubGlobal('fetch', fetchMock);
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

  it('saves model prices as fractional yuan per million tokens', async () => {
    await import('./main');

    fireEvent.click(await screen.findByRole('button', { name: '模型网关' }));
    const modelForm = (await screen.findByRole('heading', { name: '新增模型路由' })).closest('form') as HTMLElement;

    fireEvent.change(within(modelForm).getByLabelText('模型 ID'), { target: { value: 'deepseek-v4-flash' } });
    fireEvent.change(within(modelForm).getByLabelText('显示名称'), { target: { value: 'DeepSeek V4 Flash' } });
    fireEvent.change(within(modelForm).getByLabelText('上游模型名'), { target: { value: 'deepseek-v4-flash' } });
    fireEvent.change(within(modelForm).getByLabelText('输入 元/百万'), { target: { value: '1.25' } });
    fireEvent.change(within(modelForm).getByLabelText('输出 元/百万'), { target: { value: '2.5' } });
    fireEvent.change(within(modelForm).getByLabelText('缓存输入 元/百万'), { target: { value: '0.02' } });
    fireEvent.click(within(modelForm).getByRole('button', { name: '保存模型' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/model-routes',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          modelId: 'deepseek-v4-flash',
          label: 'DeepSeek V4 Flash',
          provider: 'openai',
          mode: 'gateway_api',
          baseUrl: 'https://api.openai.com/v1',
          endpointPath: '/responses',
          upstreamModel: 'deepseek-v4-flash',
          enabled: true,
          sortOrder: 100,
          inputYuanPerMillion: 1.25,
          outputYuanPerMillion: 2.5,
          reasoningYuanPerMillion: 0,
          cachedInputYuanPerMillion: 0.02,
          markupBps: 2500,
        }),
      }),
    ));
  });

  it('deletes a Codex account from the account pool', async () => {
    await import('./main');

    fireEvent.click(await screen.findByRole('button', { name: 'Codex 账号' }));
    await screen.findByText('codex-alpha@example.com');

    fireEvent.click(screen.getByRole('button', { name: '删除账号' }));
    const dialog = await screen.findByRole('dialog', { name: '删除 Codex 账号' });
    fireEvent.click(within(dialog).getByRole('button', { name: '删除账号' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/codex-accounts/codex_alpha',
      expect.objectContaining({ method: 'DELETE' }),
    ));
  });

  it('revokes and deletes authorization codes from the records list', async () => {
    await import('./main');

    fireEvent.click(await screen.findByRole('button', { name: '客户' }));
    await screen.findByText('ALPHA-CODE-1234');

    fireEvent.click(screen.getByRole('button', { name: '撤销授权码' }));
    let dialog = await screen.findByRole('dialog', { name: '撤销授权码' });
    fireEvent.click(within(dialog).getByRole('button', { name: '撤销授权码' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/authorization-codes/auth_alpha',
      expect.objectContaining({
        body: JSON.stringify({ status: 'revoked' }),
        method: 'PATCH',
      }),
    ));

    fireEvent.click(screen.getByRole('button', { name: '删除授权码' }));
    dialog = await screen.findByRole('dialog', { name: '删除授权码' });
    fireEvent.click(within(dialog).getByRole('button', { name: '删除授权码' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/authorization-codes/auth_alpha',
      expect.objectContaining({ method: 'DELETE' }),
    ));
  });

  it('resets a stale authorization-code tenant before generating a code', async () => {
    currentTenants = [deletedTenant, tenants[0]];

    await import('./main');

    fireEvent.click(await screen.findByRole('button', { name: '客户' }));
    await screen.findByText('Deleted Fund · 0 条授权码');

    currentTenants = tenants;
    fireEvent.click(screen.getByRole('button', { name: '刷新' }));

    await waitFor(() => expect(screen.queryByText('Deleted Fund · 0 条授权码')).toBeNull());
    await screen.findByText('Alpha Fund · 1 条授权码');

    fireEvent.click(screen.getByRole('button', { name: '生成授权码' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/authorization-codes',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          tenantId: 'tenant_alpha',
          maxDevices: 3,
          expiresAt: null,
          note: '',
        }),
      }),
    ));
  });

  it('generates authorization codes for the selected customer row', async () => {
    currentTenants = [tenants[0], betaTenant];

    await import('./main');

    fireEvent.click(await screen.findByRole('button', { name: '客户' }));
    await screen.findByRole('heading', { name: '客户与授权' });
    const betaRow = screen.getByText('Beta Fund').closest('tr');
    expect(betaRow).toBeTruthy();

    fireEvent.click(within(betaRow as HTMLElement).getByRole('button', { name: '授权码' }));

    await screen.findByText('Beta Fund · 0 条授权码');
    fireEvent.click(screen.getByRole('button', { name: '生成授权码' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/authorization-codes',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          tenantId: 'tenant_beta',
          maxDevices: 2,
          expiresAt: null,
          note: '',
        }),
      }),
    ));
  });

  it('deletes tenants from the customer list', async () => {
    await import('./main');

    fireEvent.click(await screen.findByRole('button', { name: '客户' }));
    await waitFor(() => expect(screen.getAllByText('Alpha Fund').length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole('button', { name: '删除客户' }));
    const dialog = await screen.findByRole('dialog', { name: '删除客户' });
    fireEvent.click(within(dialog).getByRole('button', { name: '删除客户' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/tenants/tenant_alpha',
      expect.objectContaining({ method: 'DELETE' }),
    ));
  });

  it('keeps the selected admin section in the url across reloads', async () => {
    window.history.replaceState({}, '', '/admin/tenants');

    await import('./main');

    expect(await screen.findByRole('heading', { name: '客户与授权' })).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText('Alpha Fund').length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole('button', { name: '审计' }));

    expect(window.location.pathname).toBe('/admin/audit');
    expect(await screen.findByRole('heading', { name: '审计日志' })).toBeTruthy();
  });
});

async function mockFetch(input: RequestInfo | URL, init?: RequestInit) {
  const path = String(input);
  const method = init?.method || 'GET';
  if (path === '/api/admin/summary') {
    return jsonResponse({
      tenants: 0,
      activeDevices: 0,
      runs: 0,
      billableYuan: 0,
      configuredProviders: 1,
    });
  }
  if (path === '/api/admin/tenants') return jsonResponse({ tenants: currentTenants });
  if (path === '/api/admin/authorization-codes' && method === 'POST') return jsonResponse({ authorizationCode: 'NEW-CODE-1234' });
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
