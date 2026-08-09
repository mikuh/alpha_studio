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
  {
    provider: 'volcengine-ark-responses',
    label: '火山方舟 Responses',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    endpointPath: '/responses',
    enabled: true,
    keyConfigured: true,
    keyMask: 'ark-****test',
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
    contextWindowTokens: 258_000,
    maxOutputTokens: 32_000,
    supportedReasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh'],
    defaultReasoningEffort: 'medium',
    fastModeSupported: true,
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
    contextWindowTokens: 64_000,
    maxOutputTokens: 32_000,
    supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
    defaultReasoningEffort: 'medium',
    fastModeSupported: false,
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
    codeHint: 'ALP****1234',
    revealable: true,
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
    tenantIds: ['tenant_alpha'],
    tenantNames: ['Alpha Fund'],
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

const skillReleases = [
  {
    id: 'skillrel_current',
    version: '1.2.4',
    channel: 'stable',
    status: 'published',
    minClientVersion: '0.1.0',
    releaseNotes: 'current fixture',
    codecVersion: 1,
    skillCount: 3,
    encodedFileCount: 6,
    manifestSummary: { skills: [
      { skillName: 'alpha-studio-current-one' },
      { skillName: 'alpha-studio-current-two' },
      { skillName: 'alpha-studio-current-three' },
    ] },
    artifactSha256: 'b'.repeat(64),
    artifactSize: 2048,
    createdAt: '2026-07-03T00:00:00Z',
    publishedAt: '2026-07-04T00:00:00Z',
  },
  {
    id: 'skillrel_alpha',
    version: '1.2.3',
    channel: 'stable',
    status: 'archived',
    minClientVersion: '0.1.0',
    releaseNotes: 'fixture',
    codecVersion: 1,
    skillCount: 2,
    encodedFileCount: 4,
    manifestSummary: { skills: [{ skillName: 'alpha-studio-one' }, { skillName: 'alpha-studio-two' }] },
    artifactSha256: 'a'.repeat(64),
    artifactSize: 1024,
    createdAt: '2026-07-01T00:00:00Z',
    publishedAt: '2026-07-02T00:00:00Z',
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
    expect(deepseekProvider.className).toContain('selected');
  });

  it('saves model prices as fractional yuan per million tokens', async () => {
    await import('./main');

    fireEvent.click(await screen.findByRole('button', { name: '模型网关' }));
    fireEvent.click(await screen.findByRole('button', { name: '新增模型' }));
    const modelForm = (await screen.findByRole('dialog', { name: '新增模型路由' })) as HTMLElement;

    fireEvent.change(within(modelForm).getByLabelText('模型 ID'), { target: { value: 'deepseek-v4-pro-260425' } });
    fireEvent.change(within(modelForm).getByLabelText('显示名称'), { target: { value: 'DeepSeek V4 Pro' } });
    fireEvent.change(within(modelForm).getByLabelText('上游模型名'), { target: { value: 'deepseek-v4-pro-260425' } });
    expect(within(modelForm).getByLabelText('上下文窗口 tokens')).toHaveValue(1_048_576);
    expect(within(modelForm).getByLabelText('最大回答 tokens')).toHaveValue(393_216);
    fireEvent.change(within(modelForm).getByLabelText('上下文窗口 tokens'), { target: { value: '128000' } });
    expect(within(modelForm).queryByLabelText('思考强度 low')).toBeNull();
    expect(within(modelForm).getByLabelText('思考强度 none')).toBeDisabled();
    expect(within(modelForm).getByLabelText('思考强度 high')).toBeDisabled();
    expect(within(modelForm).getByLabelText('思考强度 max')).toBeDisabled();
    fireEvent.change(within(modelForm).getByLabelText('默认思考强度'), { target: { value: 'max' } });
    fireEvent.click(within(modelForm).getByLabelText('支持 Fast 模式'));
    fireEvent.change(within(modelForm).getByLabelText('输入 元/百万'), { target: { value: '1.25' } });
    fireEvent.change(within(modelForm).getByLabelText('输出 元/百万'), { target: { value: '2.5' } });
    fireEvent.change(within(modelForm).getByLabelText('缓存输入 元/百万'), { target: { value: '0.02' } });
    fireEvent.change(within(modelForm).getByLabelText('用户价格倍率'), { target: { value: '1.5' } });
    expect(within(modelForm).getByText(/输入.*¥1\.875.*输出.*¥3\.75.*缓存输入.*¥0\.03/)).toBeTruthy();
    fireEvent.click(within(modelForm).getByRole('button', { name: '保存模型' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/model-routes',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          modelId: 'deepseek-v4-pro-260425',
          label: 'DeepSeek V4 Pro',
          provider: 'openai',
          mode: 'gateway_api',
          baseUrl: 'https://api.openai.com/v1',
          endpointPath: '/responses',
          upstreamModel: 'deepseek-v4-pro-260425',
          contextWindowTokens: 128000,
          maxOutputTokens: 393216,
          supportedReasoningEfforts: ['none', 'high', 'max'],
          defaultReasoningEffort: 'max',
          fastModeSupported: true,
          enabled: true,
          sortOrder: 100,
          inputYuanPerMillion: 1.25,
          outputYuanPerMillion: 2.5,
          reasoningYuanPerMillion: 0,
          cachedInputYuanPerMillion: 0.02,
          markupBps: 5000,
        }),
      }),
    ));
  });

  it('uses verified Ark limits and Ark reasoning choices for DeepSeek V4 Pro', async () => {
    await import('./main');

    fireEvent.click(await screen.findByRole('button', { name: '模型网关' }));
    fireEvent.click(await screen.findByRole('button', { name: /火山方舟 Responses/ }));
    fireEvent.click(await screen.findByRole('button', { name: '新增模型' }));
    const modelForm = await screen.findByRole('dialog', { name: '新增模型路由' });

    fireEvent.change(within(modelForm).getByLabelText('模型 ID'), { target: { value: 'deepseek-v4-pro-260425' } });
    fireEvent.change(within(modelForm).getByLabelText('上游模型名'), { target: { value: 'deepseek-v4-pro-260425' } });

    expect(within(modelForm).getByLabelText('上下文窗口 tokens')).toHaveValue(1_048_576);
    expect(within(modelForm).getByLabelText('最大回答 tokens')).toHaveValue(393_216);
    expect(within(modelForm).getByLabelText('思考强度 low')).toBeDisabled();
    expect(within(modelForm).getByLabelText('思考强度 medium')).toBeDisabled();
    expect(within(modelForm).getByLabelText('思考强度 high')).toBeDisabled();
    expect(within(modelForm).queryByLabelText('思考强度 none')).toBeNull();
    expect(within(modelForm).queryByLabelText('思考强度 max')).toBeNull();
    expect(within(modelForm).getByLabelText('默认思考强度')).toHaveValue('high');
  });

  it('discovers provider models and fills a model route', async () => {
    await import('./main');

    fireEvent.click(await screen.findByRole('button', { name: '模型网关' }));
    fireEvent.click(await screen.findByRole('button', { name: '编辑供应商' }));
    const providerDialog = await screen.findByRole('dialog', { name: '编辑供应商' });
    fireEvent.click(within(providerDialog).getByRole('button', { name: '获取模型' }));
    await screen.findByText('已发现 2 个模型');
    fireEvent.click(within(providerDialog).getByRole('button', { name: '取消' }));
    fireEvent.click(screen.getByRole('button', { name: '新增模型' }));
    const modelDialog = await screen.findByRole('dialog', { name: '新增模型路由' });
    const discovered = within(modelDialog).getByLabelText('已发现模型（2）');
    fireEvent.change(discovered, { target: { value: 'gpt-test-mini' } });

    expect((within(modelDialog).getByLabelText('模型 ID') as HTMLInputElement).value).toBe('gpt-test-mini');
    expect((within(modelDialog).getByLabelText('上游模型名') as HTMLInputElement).value).toBe('gpt-test-mini');
    expect((within(modelDialog).getByLabelText('显示名称') as HTMLInputElement).value).toBe('GPT Test Mini');
  });

  it('deletes a Codex account from the account pool', async () => {
    await import('./main');

    fireEvent.click(await screen.findByRole('button', { name: 'GPT 账号' }));
    await screen.findByText('codex-alpha@example.com');

    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    const dialog = await screen.findByRole('dialog', { name: '删除 GPT 账号' });
    fireEvent.click(within(dialog).getByRole('button', { name: '删除账号' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/codex-accounts/codex_alpha',
      expect.objectContaining({ method: 'DELETE' }),
    ));
  });

  it('can republish an archived protected Skill release as a rollback', async () => {
    await import('./main');

    fireEvent.click(await screen.findByRole('button', { name: 'Skills 发行' }));
    await screen.findByText('1.2.3');
    fireEvent.click(screen.getByRole('button', { name: '回滚到此版本' }));
    const dialog = await screen.findByRole('dialog', { name: '回滚 Skill 版本' });
    fireEvent.click(within(dialog).getByRole('button', { name: '确认回滚' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/skill-releases/skillrel_alpha/publish',
      expect.objectContaining({ method: 'POST' }),
    ));
  });

  it('shows the complete Skill list for every currently published channel', async () => {
    await import('./main');

    fireEvent.click(await screen.findByRole('button', { name: 'Skills 发行' }));
    const currentReleases = await screen.findByRole('region', { name: '当前已发布 Skills' });

    expect(within(currentReleases).getByText('当前版本 1.2.4')).toBeTruthy();
    expect(within(currentReleases).getByText('3 个官方 Skills')).toBeTruthy();
    expect(within(currentReleases).getByText('alpha-studio-current-one')).toBeTruthy();
    expect(within(currentReleases).getByText('alpha-studio-current-two')).toBeTruthy();
    expect(within(currentReleases).getByText('alpha-studio-current-three')).toBeTruthy();
  });

  it('assigns one GPT account to multiple customers', async () => {
    currentTenants = [tenants[0], betaTenant];
    await import('./main');

    fireEvent.click(await screen.findByRole('button', { name: 'GPT 账号' }));
    await screen.findByText('codex-alpha@example.com');
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));

    fireEvent.click(screen.getByRole('button', { name: 'Beta Fund', pressed: false }));
    fireEvent.click(screen.getByRole('button', { name: '保存账号' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/codex-accounts',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"tenantIds":["tenant_alpha","tenant_beta"]'),
      }),
    ));
  });

  it('revokes and deletes authorization codes from the records list', async () => {
    await import('./main');

    fireEvent.click(await screen.findByRole('button', { name: '客户' }));
    await screen.findByText('ALP****1234');

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

  it('reveals, copies, and hides an authorization code on demand', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    await import('./main');

    fireEvent.click(await screen.findByRole('button', { name: '客户' }));
    await screen.findByText('ALP****1234');
    expect(screen.queryByText('ALPHA-CODE-1234')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '显示' }));
    expect(await screen.findByText('ALPHA-CODE-1234')).toBeTruthy();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/authorization-codes/auth_alpha/reveal',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ authorization: 'Bearer test-token' }),
      }),
    ));

    fireEvent.click(screen.getByRole('button', { name: '复制' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('ALPHA-CODE-1234'));
    fireEvent.click(screen.getByRole('button', { name: '隐藏' }));
    await waitFor(() => expect(screen.queryByText('ALPHA-CODE-1234')).toBeNull());
    expect(screen.getByText('ALP****1234')).toBeTruthy();
  });

  it('resets a stale authorization-code tenant before generating a code', async () => {
    currentTenants = [deletedTenant, tenants[0]];

    await import('./main');

    fireEvent.click(await screen.findByRole('button', { name: '客户' }));
    await screen.findByText('Deleted Fund · 0 条授权码');

    currentTenants = tenants;
    fireEvent.click(screen.getByRole('button', { name: '刷新数据' }));

    await waitFor(() => expect(screen.queryByText('Deleted Fund · 0 条授权码')).toBeNull());
    await screen.findByText('Alpha Fund · 1 条授权码');

    fireEvent.click(screen.getByRole('button', { name: '生成授权码' }));
    const codeDialog = await screen.findByRole('dialog', { name: '生成授权码' });
    fireEvent.click(within(codeDialog).getByRole('button', { name: '生成授权码' }));

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
    const codeDialog = await screen.findByRole('dialog', { name: '生成授权码' });
    fireEvent.click(within(codeDialog).getByRole('button', { name: '生成授权码' }));

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

    fireEvent.click(screen.getByRole('button', { name: '删除', exact: true }));
    const dialog = await screen.findByRole('dialog', { name: '删除客户' });
    fireEvent.click(within(dialog).getByRole('button', { name: '删除客户' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/tenants/tenant_alpha',
      expect.objectContaining({ method: 'DELETE' }),
    ));
  });

  it('shows per-customer LLM usage and pages billing ledger on the server', async () => {
    await import('./main');

    fireEvent.click(await screen.findByRole('button', { name: 'LLM 用量' }));

    expect(await screen.findByRole('heading', { name: 'LLM 用量与账单' })).toBeTruthy();
    expect(await screen.findByText('GPT-5.5 API')).toBeTruthy();
    expect(screen.getByText('usage charge 1')).toBeTruthy();
    expect(screen.getByText('第 1 / 3 页 · 每页 20 条')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '下一页' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/tenants/tenant_alpha/billing?page=2&pageSize=20',
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer test-token' }),
      }),
    ));
    expect(await screen.findByText('usage charge 2')).toBeTruthy();
  });

  it('records an already-received offline payment without exposing payment or refund actions', async () => {
    await import('./main');
    fireEvent.click(await screen.findByRole('button', { name: 'LLM 用量' }));

    fireEvent.change(await screen.findByLabelText('实收金额 元'), { target: { value: '250.125001' } });
    fireEvent.change(screen.getByLabelText('线下凭证号'), { target: { value: 'BANK-20260804-01' } });
    fireEvent.click(screen.getByRole('button', { name: '登记已收款项' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/tenants/tenant_alpha/offline-payments',
      expect.objectContaining({ method: 'POST' }),
    ));
    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/offline-payments'));
    expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
      amountYuan: 250.125001,
      reference: 'BANK-20260804-01',
    });
    expect(await screen.findByText('线下收款记录已登记；系统未发起任何支付')).toBeTruthy();
    expect(screen.getByText('这里只记录已经在线下收到的款项，不发起支付、扣款或退款')).toBeTruthy();
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
  if (path.startsWith('/api/admin/tenants/tenant_alpha/billing?')) {
    const page = new URL(path, 'https://admin.test').searchParams.get('page') === '2' ? 2 : 1;
    return jsonResponse(tenantBillingSummary(page));
  }
  if (path === '/api/admin/billing/reconciliation') return jsonResponse({
    balanced: true,
    requiresReview: false,
    generatedAt: '2026-08-04T08:00:00.000Z',
    paymentCapability: 'offline-records-only',
    tenants: [{
      tenantId: 'tenant_alpha',
      tenantName: 'Alpha Fund',
      storedBalanceYuan: 1200,
      ledgerBalanceYuan: 1200,
      differenceYuan: 0,
      openRuns: 0,
      staleOpenRuns: 0,
      failedRuns24h: 0,
      usageEvents24h: 1,
      totalTokens24h: 21000,
      unverifiedUsageEvents24h: 0,
      billableYuan24h: 3.25,
      balanced: true,
      requiresReview: false,
    }],
  });
  if (path === '/api/admin/authorization-codes' && method === 'POST') return jsonResponse({ authorizationCode: 'NEW-CODE-1234' });
  if (path === '/api/admin/authorization-codes') return jsonResponse({ authorizationCodes });
  if (path === '/api/admin/authorization-codes/auth_alpha/reveal' && method === 'POST') {
    return jsonResponse({ authorizationCode: 'ALPHA-CODE-1234' });
  }
  if (path === '/api/admin/provider-configs') return jsonResponse({ providers });
  if (path === '/api/admin/provider-configs/discover-models') return jsonResponse({
    models: [
      { id: 'gpt-test', label: 'GPT Test' },
      { id: 'gpt-test-mini', label: 'GPT Test Mini' },
    ],
  });
  if (path === '/api/admin/model-routes') return jsonResponse({ models });
  if (path === '/api/admin/codex-accounts') return jsonResponse({ accounts: codexAccounts });
  if (path === '/api/admin/skill-releases' && method === 'GET') return jsonResponse({ releases: skillReleases });
  if (path === '/api/admin/audit-logs') return jsonResponse({ logs: [] });
  if (
    path.startsWith('/api/admin/codex-accounts/') ||
    path.startsWith('/api/admin/authorization-codes/') ||
    path.startsWith('/api/admin/tenants/') ||
    path.startsWith('/api/admin/skill-releases/')
  ) return jsonResponse({ ok: true });
  return new Response('not found', { status: 404 });
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function tenantBillingSummary(page: number) {
  const usage = {
    runCount: 8,
    inputTokens: 12000,
    outputTokens: 4200,
    reasoningTokens: 1600,
    cachedTokens: 3200,
    totalTokens: 21000,
    costYuan: 2.6,
    billableYuan: 3.25,
    lastUsedAt: '2026-07-09T08:00:00.000Z',
  };
  return {
    tenant: tenants[0],
    period: {
      currentMonthStart: '2026-07-01T00:00:00.000Z',
      currentMonthEnd: '2026-08-01T00:00:00.000Z',
      generatedAt: '2026-07-09T08:30:00.000Z',
    },
    usage: {
      currentMonth: usage,
      allTime: { ...usage, runCount: 32, totalTokens: 84000, billableYuan: 13 },
      models: [{ ...usage, modelId: 'gpt-5.5', label: 'GPT-5.5 API', provider: 'openai' }],
      recentLedger: [{
        id: `ledger_${page}`,
        runId: `run_${page}`,
        entryType: 'usage_charge',
        amountYuan: -3.25,
        description: `usage charge ${page}`,
        createdAt: '2026-07-09T08:00:00.000Z',
      }],
      ledgerPagination: {
        page,
        pageSize: 20,
        total: 41,
        totalPages: 3,
        hasPrevious: page > 1,
        hasNext: page < 3,
      },
      offlinePayments: [],
    },
  };
}
