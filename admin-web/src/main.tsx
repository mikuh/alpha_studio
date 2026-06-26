import { FormEvent, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

type Tab = 'overview' | 'tenants' | 'codes' | 'gateway' | 'codex' | 'audit';

interface Summary {
  tenants: number;
  activeDevices: number;
  runs: number;
  billableCents: number;
  configuredProviders: number;
}

interface Tenant {
  id: string;
  name: string;
  status: string;
  maxDevices: number;
  billingMode: string;
  balanceCents: number;
  subscriptionPlan?: string | null;
  subscriptionExpiresAt?: string | null;
  codexSubscriptionEnabled: boolean;
  codexSubscriptionPlan?: string | null;
  codexSubscriptionExpiresAt?: string | null;
  activeDevices: number;
  billableCents: number;
}

interface AuthorizationCode {
  id: string;
  tenantId: string;
  tenantName: string;
  authorizationCode?: string | null;
  codeHint: string;
  maxDevices: number;
  status: string;
  expiresAt?: string | null;
  lastUsedAt?: string | null;
  note: string;
  createdAt: string;
}

interface ProviderConfig {
  provider: string;
  label: string;
  baseUrl: string;
  endpointPath: string;
  enabled: boolean;
  keyConfigured: boolean;
  keyMask?: string | null;
}

interface ModelRoute {
  id: string;
  modelId: string;
  label: string;
  provider: string;
  mode: string;
  baseUrl: string;
  endpointPath: string;
  upstreamModel: string;
  enabled: boolean;
  sortOrder: number;
  inputCentsPerMillion: number;
  outputCentsPerMillion: number;
  reasoningCentsPerMillion: number;
  cachedInputCentsPerMillion: number;
  markupBps: number;
  providerReady: boolean;
}

interface CodexAccount {
  id: string;
  tenantId?: string | null;
  tenantName?: string | null;
  email: string;
  loginSecretConfigured: boolean;
  loginSecretMask?: string | null;
  loginHint: string;
  plan: string;
  status: string;
  seatLimit: number;
  expiresAt?: string | null;
}

interface AuditLog {
  tenantId: string;
  action: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

const defaultSummary: Summary = {
  tenants: 0,
  activeDevices: 0,
  runs: 0,
  billableCents: 0,
  configuredProviders: 0,
};

const emptyTenantForm = {
  id: '',
  name: '',
  status: 'active',
  maxDevices: 3,
  billingMode: 'hybrid',
  balanceCents: 0,
  subscriptionPlan: '',
  subscriptionExpiresAt: '',
  codexSubscriptionEnabled: false,
  codexSubscriptionPlan: 'monthly',
  codexSubscriptionExpiresAt: '',
};

const emptyCodeForm = {
  tenantId: '',
  maxDevices: 3,
  expiresAt: '',
  note: '',
};

const emptyProviderForm = {
  provider: 'openai',
  label: 'OpenAI',
  baseUrl: 'https://api.openai.com/v1',
  endpointPath: '/responses',
  apiKey: '',
  enabled: true,
};

const emptyModelForm = {
  id: '',
  modelId: '',
  label: '',
  provider: 'openai',
  mode: 'gateway_api',
  baseUrl: 'https://api.openai.com/v1',
  endpointPath: '/responses',
  upstreamModel: '',
  enabled: true,
  sortOrder: 100,
  inputCentsPerMillion: 0,
  outputCentsPerMillion: 0,
  reasoningCentsPerMillion: 0,
  cachedInputCentsPerMillion: 0,
  markupBps: 2500,
};

const emptyCodexForm = {
  id: '',
  tenantId: '',
  email: '',
  loginSecret: '',
  loginHint: '',
  plan: 'monthly',
  status: 'active',
  seatLimit: 1,
  expiresAt: '',
};

function App() {
  const [token, setToken] = useState(() => localStorage.getItem('alpha-admin-token') || '');
  const [email, setEmail] = useState('admin@alpha-studio.local');
  const [password, setPassword] = useState('');
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [summary, setSummary] = useState<Summary>(defaultSummary);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [authorizationCodes, setAuthorizationCodes] = useState<AuthorizationCode[]>([]);
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [models, setModels] = useState<ModelRoute[]>([]);
  const [codexAccounts, setCodexAccounts] = useState<CodexAccount[]>([]);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [tenantForm, setTenantForm] = useState(emptyTenantForm);
  const [codeForm, setCodeForm] = useState(emptyCodeForm);
  const [providerForm, setProviderForm] = useState(emptyProviderForm);
  const [modelForm, setModelForm] = useState(emptyModelForm);
  const [selectedProviderId, setSelectedProviderId] = useState(emptyProviderForm.provider);
  const [codexForm, setCodexForm] = useState(emptyCodexForm);
  const [activationProbe, setActivationProbe] = useState({
    companyName: '',
    authorizationCode: '',
    fingerprint: `admin-test-${Math.random().toString(16).slice(2, 8)}`,
    deviceName: 'Alpha Studio Test Mac',
  });
  const [generatedCode, setGeneratedCode] = useState('');
  const [probeResult, setProbeResult] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const money = useMemo(() => formatCents(summary.billableCents), [summary.billableCents]);
  const selectedProvider = useMemo(
    () => selectedProviderId ? providers.find((provider) => provider.provider === selectedProviderId) || providers[0] || null : null,
    [providers, selectedProviderId],
  );
  const selectedProviderModels = useMemo(
    () => models.filter((model) => model.provider === selectedProvider?.provider),
    [models, selectedProvider],
  );

  useEffect(() => {
    if (!providers.length || !selectedProviderId || providers.some((provider) => provider.provider === selectedProviderId)) return;
    const nextProvider = providers[0];
    setSelectedProviderId(nextProvider.provider);
    setProviderForm(providerFormFromConfig(nextProvider));
    setModelForm(modelFormForProvider(nextProvider));
  }, [providers, selectedProviderId]);

  const login = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!response.ok) throw new Error(await response.text());
      const data = await response.json();
      localStorage.setItem('alpha-admin-token', data.token);
      setToken(data.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败');
    } finally {
      setLoading(false);
    }
  };

  const load = async () => {
    setError('');
    setLoading(true);
    try {
      const [
        summaryData,
        tenantData,
        codeData,
        providerData,
        modelData,
        codexData,
        auditData,
      ] = await Promise.all([
        api<Summary>('/api/admin/summary', token),
        api<{ tenants: Tenant[] }>('/api/admin/tenants', token),
        api<{ authorizationCodes: AuthorizationCode[] }>('/api/admin/authorization-codes', token),
        api<{ providers: ProviderConfig[] }>('/api/admin/provider-configs', token),
        api<{ models: ModelRoute[] }>('/api/admin/model-routes', token),
        api<{ accounts: CodexAccount[] }>('/api/admin/codex-accounts', token),
        api<{ logs: AuditLog[] }>('/api/admin/audit-logs', token),
      ]);
      setSummary(summaryData);
      setTenants(tenantData.tenants || []);
      setAuthorizationCodes(codeData.authorizationCodes || []);
      setProviders(providerData.providers || []);
      setModels(modelData.models || []);
      setCodexAccounts(codexData.accounts || []);
      setLogs(auditData.logs || []);
      if (!codeForm.tenantId && tenantData.tenants?.[0]) {
        setCodeForm((form) => ({ ...form, tenantId: tenantData.tenants[0].id }));
      }
      if (!codexForm.tenantId && tenantData.tenants?.[0]) {
        setCodexForm((form) => ({ ...form, tenantId: tenantData.tenants[0].id }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) void load();
  }, [token]);

  const saveTenant = async (event: FormEvent) => {
    event.preventDefault();
    await mutate(async () => {
      await api('/api/admin/tenants', token, {
        method: 'POST',
        body: JSON.stringify({
          ...tenantForm,
          id: tenantForm.id || undefined,
          subscriptionPlan: tenantForm.subscriptionPlan || null,
          subscriptionExpiresAt: toIsoOrNull(tenantForm.subscriptionExpiresAt),
          codexSubscriptionPlan: tenantForm.codexSubscriptionPlan || null,
          codexSubscriptionExpiresAt: toIsoOrNull(tenantForm.codexSubscriptionExpiresAt),
        }),
      });
      setTenantForm(emptyTenantForm);
      setNotice('客户已保存');
      await load();
    });
  };

  const createAuthorizationCode = async (event: FormEvent) => {
    event.preventDefault();
    await mutate(async () => {
      const data = await api<{ authorizationCode: string }>('/api/admin/authorization-codes', token, {
        method: 'POST',
        body: JSON.stringify({
          tenantId: codeForm.tenantId,
          maxDevices: codeForm.maxDevices,
          expiresAt: toIsoOrNull(codeForm.expiresAt),
          note: codeForm.note,
        }),
      });
      setGeneratedCode(data.authorizationCode);
      setNotice('授权码已生成，可在授权码记录中继续查看');
      await load();
    });
  };

  const saveProvider = async (event: FormEvent) => {
    event.preventDefault();
    const providerId = providerForm.provider.trim().toLowerCase();
    await mutate(async () => {
      await api('/api/admin/provider-configs', token, {
        method: 'POST',
        body: JSON.stringify(providerForm),
      });
      setSelectedProviderId(providerId);
      setProviderForm({ ...providerForm, provider: providerId, apiKey: '' });
      setModelForm(modelFormForProvider({
        provider: providerId,
        baseUrl: providerForm.baseUrl,
        endpointPath: providerForm.endpointPath,
      }));
      setNotice('供应商配置已保存');
      await load();
    });
  };

  const saveModel = async (event: FormEvent) => {
    event.preventDefault();
    const providerId = modelForm.provider;
    await mutate(async () => {
      await api('/api/admin/model-routes', token, {
        method: 'POST',
        body: JSON.stringify({ ...modelForm, id: modelForm.id || undefined }),
      });
      setSelectedProviderId(providerId);
      setModelForm(modelFormForProvider(providers.find((provider) => provider.provider === providerId)));
      setNotice('模型路由已保存');
      await load();
    });
  };

  const selectProvider = (provider: ProviderConfig) => {
    setSelectedProviderId(provider.provider);
    setProviderForm(providerFormFromConfig(provider));
    setModelForm(modelFormForProvider(provider));
  };

  const createProvider = () => {
    setSelectedProviderId('');
    setProviderForm({ ...emptyProviderForm, provider: '', label: '', apiKey: '' });
    setModelForm(modelFormForProvider(null));
  };

  const createModelForSelectedProvider = () => {
    setModelForm(modelFormForProvider(selectedProvider));
  };

  const changeModelProvider = (providerId: string) => {
    const provider = providers.find((candidate) => candidate.provider === providerId);
    setSelectedProviderId(providerId);
    setModelForm((form) => ({
      ...form,
      provider: providerId,
      baseUrl: provider?.baseUrl || form.baseUrl,
      endpointPath: provider?.endpointPath || form.endpointPath,
    }));
  };

  const deleteProvider = async (provider: ProviderConfig) => {
    if (!window.confirm(`删除供应商 ${provider.label} 会同时删除其下模型，继续吗？`)) return;
    await mutate(async () => {
      await api(`/api/admin/provider-configs/${encodeURIComponent(provider.provider)}`, token, {
        method: 'DELETE',
      });
      const nextProvider = providers.find((candidate) => candidate.provider !== provider.provider) || null;
      setSelectedProviderId(nextProvider?.provider || '');
      setProviderForm(nextProvider ? providerFormFromConfig(nextProvider) : { ...emptyProviderForm, provider: '', label: '', apiKey: '' });
      setModelForm(modelFormForProvider(nextProvider));
      setNotice('供应商已删除');
      await load();
    });
  };

  const deleteModel = async (model: ModelRoute) => {
    if (!window.confirm(`删除模型 ${model.label}？`)) return;
    await mutate(async () => {
      await api(`/api/admin/model-routes/${encodeURIComponent(model.id)}`, token, {
        method: 'DELETE',
      });
      if (modelForm.id === model.id) setModelForm(modelFormForProvider(selectedProvider));
      setNotice('模型路由已删除');
      await load();
    });
  };

  const deleteTenant = async (tenant: Tenant) => {
    if (!window.confirm(`删除客户 ${tenant.name} 会清理其授权码、设备和用量记录，继续吗？`)) return;
    await mutate(async () => {
      await api(`/api/admin/tenants/${encodeURIComponent(tenant.id)}`, token, {
        method: 'DELETE',
      });
      if (tenantForm.id === tenant.id) setTenantForm(emptyTenantForm);
      setNotice('客户已删除');
      await load();
    });
  };

  const updateAuthorizationCodeStatus = async (code: AuthorizationCode, status: string) => {
    const action = status === 'revoked' ? '撤销' : '更新';
    if (!window.confirm(`${action}授权码 ${code.codeHint}？`)) return;
    await mutate(async () => {
      await api(`/api/admin/authorization-codes/${encodeURIComponent(code.id)}`, token, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      setNotice(status === 'revoked' ? '授权码已撤销' : '授权码状态已更新');
      await load();
    });
  };

  const deleteAuthorizationCode = async (code: AuthorizationCode) => {
    if (!window.confirm(`删除授权码 ${code.codeHint}？`)) return;
    await mutate(async () => {
      await api(`/api/admin/authorization-codes/${encodeURIComponent(code.id)}`, token, {
        method: 'DELETE',
      });
      setNotice('授权码已删除');
      await load();
    });
  };

  const saveCodexAccount = async (event: FormEvent) => {
    event.preventDefault();
    await mutate(async () => {
      await api('/api/admin/codex-accounts', token, {
        method: 'POST',
        body: JSON.stringify({
          ...codexForm,
          id: codexForm.id || undefined,
          tenantId: codexForm.tenantId || null,
          expiresAt: toIsoOrNull(codexForm.expiresAt),
        }),
      });
      setCodexForm(emptyCodexForm);
      setNotice('Codex 账号已保存');
      await load();
    });
  };

  const updateCodexAccountStatus = async (account: CodexAccount, status: string) => {
    const form = codexFormFromAccount(account);
    await mutate(async () => {
      await api('/api/admin/codex-accounts', token, {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          status,
          tenantId: form.tenantId || null,
          expiresAt: toIsoOrNull(form.expiresAt),
        }),
      });
      setNotice(status === 'active' ? 'Codex 账号已启用' : 'Codex 账号已停用');
      await load();
    });
  };

  const deleteCodexAccount = async (account: CodexAccount) => {
    if (!window.confirm(`删除 Codex 账号 ${account.email}？`)) return;
    await mutate(async () => {
      await api(`/api/admin/codex-accounts/${encodeURIComponent(account.id)}`, token, {
        method: 'DELETE',
      });
      if (codexForm.id === account.id) setCodexForm(emptyCodexForm);
      setNotice('Codex 账号已删除');
      await load();
    });
  };

  const testActivation = async (event: FormEvent) => {
    event.preventDefault();
    await mutate(async () => {
      const data = await publicApi<Record<string, unknown>>('/api/client/activate', {
        method: 'POST',
        body: JSON.stringify(activationProbe),
      });
      setProbeResult(JSON.stringify(data, null, 2));
      setNotice('客户端授权激活链路通过');
      await load();
    });
  };

  const mutate = async (operation: () => Promise<void>) => {
    setError('');
    setNotice('');
    setLoading(true);
    try {
      await operation();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <main className="login-screen">
        <form className="login-panel" onSubmit={login}>
          <div>
            <h1>Alpha Studio Admin</h1>
            <p>内部运营后台</p>
          </div>
          <label>
            邮箱
            <input value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label>
            密码
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          {error && <div className="error">{error}</div>}
          <button type="submit" disabled={loading}>{loading ? '登录中...' : '登录'}</button>
        </form>
      </main>
    );
  }

  return (
    <main className="admin-shell">
      <aside>
        <div className="brand">
          <span>AS</span>
          <div>
            <strong>Alpha Studio</strong>
            <small>Internal Admin</small>
          </div>
        </div>
        <nav>
          {[
            ['overview', '总览'],
            ['tenants', '客户'],
            ['codes', '授权码'],
            ['gateway', '模型网关'],
            ['codex', 'Codex 账号'],
            ['audit', '审计'],
          ].map(([tab, label]) => (
            <button
              className={activeTab === tab ? 'active' : ''}
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab as Tab)}
            >
              {label}
            </button>
          ))}
        </nav>
        <button
          className="ghost"
          type="button"
          onClick={() => {
            localStorage.removeItem('alpha-admin-token');
            setToken('');
          }}
        >
          退出登录
        </button>
      </aside>
      <section className="content">
        <header>
          <div>
            <h1>{tabTitle(activeTab)}</h1>
            <p>{tabSubtitle(activeTab)}</p>
          </div>
          <button type="button" onClick={() => void load()} disabled={loading}>
            {loading ? '刷新中...' : '刷新'}
          </button>
        </header>
        {error && <div className="error">{error}</div>}
        {notice && <div className="notice">{notice}</div>}
        {activeTab === 'overview' && (
          <>
            <div className="metric-grid">
              <Metric label="客户数" value={summary.tenants.toLocaleString()} />
              <Metric label="活跃设备" value={summary.activeDevices.toLocaleString()} />
              <Metric label="模型运行" value={summary.runs.toLocaleString()} />
              <Metric label="API 应收" value={money} />
              <Metric label="已配置上游" value={summary.configuredProviders.toLocaleString()} />
            </div>
            <section className="panel">
              <div className="panel-head">
                <h2>最近客户</h2>
                <span>{tenants.length} 个客户</span>
              </div>
              <TenantTable tenants={tenants.slice(0, 6)} onEdit={setTenantForm} />
            </section>
          </>
        )}
        {activeTab === 'tenants' && (
          <GridSection>
            <TenantForm form={tenantForm} setForm={setTenantForm} onSubmit={saveTenant} loading={loading} />
            <section className="panel span-2">
              <div className="panel-head">
                <h2>客户列表</h2>
                <span>{tenants.length} 个</span>
              </div>
              <TenantTable tenants={tenants} onEdit={setTenantForm} onDelete={deleteTenant} />
            </section>
          </GridSection>
        )}
        {activeTab === 'codes' && (
          <GridSection>
            <AuthorizationCodeForm
              form={codeForm}
              setForm={setCodeForm}
              tenants={tenants}
              generatedCode={generatedCode}
              onSubmit={createAuthorizationCode}
              loading={loading}
            />
            <ActivationProbe
              form={activationProbe}
              setForm={setActivationProbe}
              result={probeResult}
              onSubmit={testActivation}
              loading={loading}
            />
            <section className="panel span-2">
              <div className="panel-head">
                <h2>授权码记录</h2>
                <span>{authorizationCodes.length} 条</span>
              </div>
              <AuthorizationCodeTable
                codes={authorizationCodes}
                onRevoke={(code) => updateAuthorizationCodeStatus(code, 'revoked')}
                onDelete={deleteAuthorizationCode}
              />
            </section>
          </GridSection>
        )}
        {activeTab === 'gateway' && (
          <GatewayWorkspace
            providerForm={providerForm}
            setProviderForm={setProviderForm}
            modelForm={modelForm}
            setModelForm={setModelForm}
            providers={providers}
            models={models}
            selectedProvider={selectedProvider}
            selectedProviderModels={selectedProviderModels}
            onSelectProvider={selectProvider}
            onCreateProvider={createProvider}
            onDeleteProvider={deleteProvider}
            onSubmitProvider={saveProvider}
            onCreateModel={createModelForSelectedProvider}
            onChangeModelProvider={changeModelProvider}
            onDeleteModel={deleteModel}
            onSubmitModel={saveModel}
            loading={loading}
          />
        )}
        {activeTab === 'codex' && (
          <CodexWorkspace
            accounts={codexAccounts}
            form={codexForm}
            setForm={setCodexForm}
            tenants={tenants}
            onSubmit={saveCodexAccount}
            onEdit={setCodexForm}
            onDelete={deleteCodexAccount}
            onSetStatus={updateCodexAccountStatus}
            loading={loading}
          />
        )}
        {activeTab === 'audit' && (
          <section className="panel">
            <div className="panel-head">
              <h2>最近审计日志</h2>
              <span>{logs.length} 条</span>
            </div>
            <div className="audit-list">
              {logs.length === 0 ? (
                <div className="empty">暂无审计事件。</div>
              ) : logs.map((log) => (
                <article key={`${log.createdAt}-${log.action}`}>
                  <div>
                    <strong>{log.action}</strong>
                    <span>{log.tenantId}</span>
                  </div>
                  <time>{new Date(log.createdAt).toLocaleString()}</time>
                  <code>{JSON.stringify(log.payload)}</code>
                </article>
              ))}
            </div>
          </section>
        )}
      </section>
    </main>
  );
}

function TenantForm({ form, setForm, onSubmit, loading }: {
  form: typeof emptyTenantForm;
  setForm: (form: typeof emptyTenantForm) => void;
  onSubmit: (event: FormEvent) => void;
  loading: boolean;
}) {
  return (
    <form className="panel form-panel" onSubmit={onSubmit}>
      <div className="panel-head compact">
        <h2>{form.id ? '编辑客户' : '新增客户'}</h2>
        {form.id && <button type="button" className="secondary" onClick={() => setForm(emptyTenantForm)}>新建</button>}
      </div>
      <div className="form-grid">
        <Field label="公司名称" value={form.name} onChange={(name) => setForm({ ...form, name })} required />
        <Field label="客户 ID" value={form.id} onChange={(id) => setForm({ ...form, id })} placeholder="留空自动生成" />
        <Select label="状态" value={form.status} onChange={(status) => setForm({ ...form, status })} options={['active', 'suspended']} />
        <NumberField label="授权机器数" value={form.maxDevices} onChange={(maxDevices) => setForm({ ...form, maxDevices })} />
        <Select label="计费模式" value={form.billingMode} onChange={(billingMode) => setForm({ ...form, billingMode })} options={['hybrid', 'gateway_api', 'subscription']} />
        <NumberField label="预付余额 cents" value={form.balanceCents} onChange={(balanceCents) => setForm({ ...form, balanceCents })} />
        <Field label="API 套餐" value={form.subscriptionPlan} onChange={(subscriptionPlan) => setForm({ ...form, subscriptionPlan })} />
        <Field label="API 到期时间" type="datetime-local" value={form.subscriptionExpiresAt} onChange={(subscriptionExpiresAt) => setForm({ ...form, subscriptionExpiresAt })} />
        <label className="check-row">
          <input type="checkbox" checked={form.codexSubscriptionEnabled} onChange={(event) => setForm({ ...form, codexSubscriptionEnabled: event.target.checked })} />
          启用 Codex 订阅能力
        </label>
        <Select label="Codex 套餐" value={form.codexSubscriptionPlan} onChange={(codexSubscriptionPlan) => setForm({ ...form, codexSubscriptionPlan })} options={['monthly', 'yearly']} />
        <Field label="Codex 到期时间" type="datetime-local" value={form.codexSubscriptionExpiresAt} onChange={(codexSubscriptionExpiresAt) => setForm({ ...form, codexSubscriptionExpiresAt })} />
      </div>
      <div className="form-actions">
        <button type="submit" disabled={loading}>{loading ? '保存中...' : '保存客户'}</button>
      </div>
    </form>
  );
}

function AuthorizationCodeForm({ form, setForm, tenants, generatedCode, onSubmit, loading }: {
  form: typeof emptyCodeForm;
  setForm: (form: typeof emptyCodeForm) => void;
  tenants: Tenant[];
  generatedCode: string;
  onSubmit: (event: FormEvent) => void;
  loading: boolean;
}) {
  return (
    <form className="panel form-panel" onSubmit={onSubmit}>
      <div className="panel-head compact"><h2>生成客户授权码</h2></div>
      <div className="form-grid">
        <Select label="客户" value={form.tenantId} onChange={(tenantId) => setForm({ ...form, tenantId })} options={tenants.map((tenant) => tenant.id)} optionLabels={Object.fromEntries(tenants.map((tenant) => [tenant.id, tenant.name]))} />
        <NumberField label="授权机器数" value={form.maxDevices} onChange={(maxDevices) => setForm({ ...form, maxDevices })} />
        <Field label="到期时间" type="datetime-local" value={form.expiresAt} onChange={(expiresAt) => setForm({ ...form, expiresAt })} />
        <Field label="备注" value={form.note} onChange={(note) => setForm({ ...form, note })} />
      </div>
      {generatedCode && <div className="secret-box"><span>新授权码</span><strong>{generatedCode}</strong></div>}
      <div className="form-actions"><button type="submit" disabled={loading || !form.tenantId}>生成授权码</button></div>
    </form>
  );
}

function ActivationProbe({ form, setForm, result, onSubmit, loading }: {
  form: typeof activationProbeShape;
  setForm: (form: typeof activationProbeShape) => void;
  result: string;
  onSubmit: (event: FormEvent) => void;
  loading: boolean;
}) {
  return (
    <form className="panel form-panel" onSubmit={onSubmit}>
      <div className="panel-head compact"><h2>模拟客户端首次激活</h2></div>
      <div className="form-grid">
        <Field label="公司名称" value={form.companyName} onChange={(companyName) => setForm({ ...form, companyName })} />
        <Field label="授权码" value={form.authorizationCode} onChange={(authorizationCode) => setForm({ ...form, authorizationCode })} />
        <Field label="机器指纹" value={form.fingerprint} onChange={(fingerprint) => setForm({ ...form, fingerprint })} />
        <Field label="设备名" value={form.deviceName} onChange={(deviceName) => setForm({ ...form, deviceName })} />
      </div>
      <div className="form-actions"><button type="submit" disabled={loading}>测试激活</button></div>
      {result && <pre className="result-box">{result}</pre>}
    </form>
  );
}

const activationProbeShape = {
  companyName: '',
  authorizationCode: '',
  fingerprint: '',
  deviceName: '',
};

function providerFormFromConfig(provider: ProviderConfig): typeof emptyProviderForm {
  return {
    provider: provider.provider,
    label: provider.label,
    baseUrl: provider.baseUrl,
    endpointPath: provider.endpointPath,
    apiKey: '',
    enabled: provider.enabled,
  };
}

function modelFormForProvider(provider?: Pick<ProviderConfig, 'provider' | 'baseUrl' | 'endpointPath'> | null): typeof emptyModelForm {
  return {
    ...emptyModelForm,
    provider: provider?.provider || '',
    baseUrl: provider?.baseUrl || '',
    endpointPath: provider?.endpointPath || emptyModelForm.endpointPath,
  };
}

function modelFormFromRoute(model: ModelRoute): typeof emptyModelForm {
  return {
    id: model.id,
    modelId: model.modelId,
    label: model.label,
    provider: model.provider,
    mode: model.mode,
    baseUrl: model.baseUrl,
    endpointPath: model.endpointPath,
    upstreamModel: model.upstreamModel,
    enabled: model.enabled,
    sortOrder: model.sortOrder,
    inputCentsPerMillion: model.inputCentsPerMillion,
    outputCentsPerMillion: model.outputCentsPerMillion,
    reasoningCentsPerMillion: model.reasoningCentsPerMillion,
    cachedInputCentsPerMillion: model.cachedInputCentsPerMillion,
    markupBps: model.markupBps,
  };
}

function codexFormFromAccount(account: CodexAccount): typeof emptyCodexForm {
  return {
    id: account.id,
    tenantId: account.tenantId || '',
    email: account.email,
    loginSecret: '',
    loginHint: account.loginHint,
    plan: account.plan,
    status: account.status,
    seatLimit: account.seatLimit,
    expiresAt: toLocalInput(account.expiresAt),
  };
}

function GatewayWorkspace({
  providerForm,
  setProviderForm,
  modelForm,
  setModelForm,
  providers,
  models,
  selectedProvider,
  selectedProviderModels,
  onSelectProvider,
  onCreateProvider,
  onDeleteProvider,
  onSubmitProvider,
  onCreateModel,
  onChangeModelProvider,
  onDeleteModel,
  onSubmitModel,
  loading,
}: {
  providerForm: typeof emptyProviderForm;
  setProviderForm: (form: typeof emptyProviderForm) => void;
  modelForm: typeof emptyModelForm;
  setModelForm: (form: typeof emptyModelForm) => void;
  providers: ProviderConfig[];
  models: ModelRoute[];
  selectedProvider: ProviderConfig | null;
  selectedProviderModels: ModelRoute[];
  onSelectProvider: (provider: ProviderConfig) => void;
  onCreateProvider: () => void;
  onDeleteProvider: (provider: ProviderConfig) => void;
  onSubmitProvider: (event: FormEvent) => void;
  onCreateModel: () => void;
  onChangeModelProvider: (providerId: string) => void;
  onDeleteModel: (model: ModelRoute) => void;
  onSubmitModel: (event: FormEvent) => void;
  loading: boolean;
}) {
  const modelCounts = useMemo(() => {
    const counts = new Map<string, number>();
    models.forEach((model) => counts.set(model.provider, (counts.get(model.provider) || 0) + 1));
    return counts;
  }, [models]);

  return (
    <div className="gateway-layout">
      <section className="panel provider-browser">
        <div className="panel-head compact">
          <div>
            <h2>供应商</h2>
            <span>{providers.length} 个上游，{models.length} 个模型</span>
          </div>
          <button className="secondary" type="button" onClick={onCreateProvider}>新增</button>
        </div>
        <div className="provider-tree">
          {providers.length === 0 ? (
            <div className="empty">暂无供应商。</div>
          ) : providers.map((provider) => {
            const modelCount = modelCounts.get(provider.provider) || 0;
            return (
              <button
                type="button"
                className={selectedProvider?.provider === provider.provider ? 'provider-node selected' : 'provider-node'}
                key={provider.provider}
                onClick={() => onSelectProvider(provider)}
              >
                <span>
                  <strong>{provider.label}</strong>
                  <small>{provider.provider}</small>
                </span>
                <em>{modelCount} 个模型</em>
                <small>{provider.enabled ? (provider.keyConfigured ? provider.keyMask : '未配置 key') : '已停用'}</small>
              </button>
            );
          })}
        </div>
      </section>

      <div className="gateway-detail">
        <ProviderForm
          form={providerForm}
          setForm={setProviderForm}
          selectedProvider={selectedProvider}
          selectedModelCount={selectedProviderModels.length}
          onNew={onCreateProvider}
          onDelete={onDeleteProvider}
          onSubmit={onSubmitProvider}
          loading={loading}
        />
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>{selectedProvider ? `${selectedProvider.label} 模型` : '模型'}</h2>
              <span>{selectedProvider ? `${selectedProvider.provider} 下 ${selectedProviderModels.length} 个模型` : '请先选择供应商'}</span>
            </div>
            <button type="button" onClick={onCreateModel} disabled={loading || !selectedProvider}>新增模型</button>
          </div>
          <ModelTable
            models={selectedProviderModels}
            onEdit={(model) => setModelForm(modelFormFromRoute(model))}
            onDelete={onDeleteModel}
          />
        </section>
        <ModelForm
          form={modelForm}
          setForm={setModelForm}
          providers={providers}
          onProviderChange={onChangeModelProvider}
          onSubmit={onSubmitModel}
          loading={loading}
        />
      </div>
    </div>
  );
}

function CodexWorkspace({
  accounts,
  form,
  setForm,
  tenants,
  onSubmit,
  onEdit,
  onDelete,
  onSetStatus,
  loading,
}: {
  accounts: CodexAccount[];
  form: typeof emptyCodexForm;
  setForm: (form: typeof emptyCodexForm) => void;
  tenants: Tenant[];
  onSubmit: (event: FormEvent) => void;
  onEdit: (form: typeof emptyCodexForm) => void;
  onDelete: (account: CodexAccount) => void;
  onSetStatus: (account: CodexAccount, status: string) => void;
  loading: boolean;
}) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const normalizedQuery = query.trim().toLowerCase();
  const filteredAccounts = accounts.filter((account) => {
    const matchesStatus = status === 'all' || account.status === status;
    const haystack = [
      account.email,
      account.tenantName || '',
      account.loginHint,
      account.plan,
      account.id,
    ].join(' ').toLowerCase();
    return matchesStatus && (!normalizedQuery || haystack.includes(normalizedQuery));
  });
  const activeCount = accounts.filter((account) => account.status === 'active').length;
  const assignedCount = accounts.filter((account) => account.tenantId).length;

  return (
    <div className="management-layout codex-layout">
      <section className="panel management-list">
        <div className="panel-head">
          <div>
            <h2>Codex 账号池</h2>
            <span>{accounts.length} 个账号，{activeCount} 个可用，{assignedCount} 个已分配</span>
          </div>
          <button type="button" onClick={() => setForm(emptyCodexForm)}>新增账号</button>
        </div>
        <div className="stat-strip">
          <div className="mini-stat"><span>可用</span><strong>{activeCount}</strong></div>
          <div className="mini-stat"><span>未分配</span><strong>{accounts.length - assignedCount}</strong></div>
          <div className="mini-stat"><span>停用</span><strong>{accounts.filter((account) => account.status !== 'active').length}</strong></div>
        </div>
        <div className="workspace-toolbar">
          <input
            aria-label="搜索 Codex 账号"
            className="toolbar-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索邮箱、客户或登录提示"
          />
          <select
            aria-label="筛选 Codex 状态"
            className="toolbar-select"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="all">全部状态</option>
            <option value="active">active</option>
            <option value="suspended">suspended</option>
          </select>
        </div>
        <CodexAccountTable
          accounts={filteredAccounts}
          onEdit={onEdit}
          onDelete={onDelete}
          onSetStatus={onSetStatus}
        />
      </section>
      <CodexAccountForm
        form={form}
        setForm={setForm}
        tenants={tenants}
        onSubmit={onSubmit}
        loading={loading}
      />
    </div>
  );
}

function ProviderForm({ form, setForm, selectedProvider, selectedModelCount, onNew, onDelete, onSubmit, loading }: {
  form: typeof emptyProviderForm;
  setForm: (form: typeof emptyProviderForm) => void;
  selectedProvider: ProviderConfig | null;
  selectedModelCount: number;
  onNew: () => void;
  onDelete: (provider: ProviderConfig) => void;
  onSubmit: (event: FormEvent) => void;
  loading: boolean;
}) {
  return (
    <form className="panel form-panel" onSubmit={onSubmit}>
      <div className="panel-head compact">
        <div>
          <h2>{selectedProvider ? '供应商配置' : '新增供应商'}</h2>
          <span>{selectedProvider ? `${selectedModelCount} 个模型挂在此供应商下` : '保存后可在其下新增模型'}</span>
        </div>
        <div className="head-actions">
          <button type="button" className="secondary" onClick={onNew}>新增</button>
          {selectedProvider && (
            <button type="button" className="secondary danger" onClick={() => onDelete(selectedProvider)}>删除</button>
          )}
        </div>
      </div>
      <div className="form-grid">
        <Field label="Provider ID" value={form.provider} onChange={(provider) => setForm({ ...form, provider })} required />
        <Field label="显示名称" value={form.label} onChange={(label) => setForm({ ...form, label })} required />
        <Field label="Base URL" value={form.baseUrl} onChange={(baseUrl) => setForm({ ...form, baseUrl })} required />
        <Field label="Endpoint Path" value={form.endpointPath} onChange={(endpointPath) => setForm({ ...form, endpointPath })} />
        <Field label="API Key" type="password" value={form.apiKey} onChange={(apiKey) => setForm({ ...form, apiKey })} placeholder="留空则保留原 key" />
        <label className="check-row">
          <input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} />
          启用供应商
        </label>
      </div>
      <div className="form-actions"><button type="submit" disabled={loading}>保存供应商</button></div>
    </form>
  );
}

function ModelForm({ form, setForm, providers, onProviderChange, onSubmit, loading }: {
  form: typeof emptyModelForm;
  setForm: (form: typeof emptyModelForm) => void;
  providers: ProviderConfig[];
  onProviderChange: (providerId: string) => void;
  onSubmit: (event: FormEvent) => void;
  loading: boolean;
}) {
  const providerOptions = providers.some((provider) => provider.provider === form.provider)
    ? providers.map((provider) => provider.provider)
    : [form.provider, ...providers.map((provider) => provider.provider)].filter(Boolean);

  return (
    <form className="panel form-panel" onSubmit={onSubmit}>
      <div className="panel-head compact">
        <h2>{form.id ? '编辑模型路由' : '新增模型路由'}</h2>
        {form.id && (
          <button
            type="button"
            className="secondary"
            onClick={() => setForm(modelFormForProvider(providers.find((provider) => provider.provider === form.provider)))}
          >
            新建
          </button>
        )}
      </div>
      <div className="form-grid">
        <Field label="模型 ID" value={form.modelId} onChange={(modelId) => setForm({ ...form, modelId })} required />
        <Field label="显示名称" value={form.label} onChange={(label) => setForm({ ...form, label })} required />
        <Select label="供应商" value={form.provider} onChange={onProviderChange} options={providerOptions} />
        <Field label="上游模型名" value={form.upstreamModel} onChange={(upstreamModel) => setForm({ ...form, upstreamModel })} required />
        <Field label="Base URL" value={form.baseUrl} onChange={(baseUrl) => setForm({ ...form, baseUrl })} />
        <Field label="Endpoint Path" value={form.endpointPath} onChange={(endpointPath) => setForm({ ...form, endpointPath })} />
        <NumberField label="排序" value={form.sortOrder} onChange={(sortOrder) => setForm({ ...form, sortOrder })} />
        <NumberField label="输入 cents/M" value={form.inputCentsPerMillion} onChange={(inputCentsPerMillion) => setForm({ ...form, inputCentsPerMillion })} />
        <NumberField label="输出 cents/M" value={form.outputCentsPerMillion} onChange={(outputCentsPerMillion) => setForm({ ...form, outputCentsPerMillion })} />
        <NumberField label="推理 cents/M" value={form.reasoningCentsPerMillion} onChange={(reasoningCentsPerMillion) => setForm({ ...form, reasoningCentsPerMillion })} />
        <NumberField label="缓存输入 cents/M" value={form.cachedInputCentsPerMillion} onChange={(cachedInputCentsPerMillion) => setForm({ ...form, cachedInputCentsPerMillion })} />
        <NumberField label="加价 bps" value={form.markupBps} onChange={(markupBps) => setForm({ ...form, markupBps })} />
        <label className="check-row">
          <input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} />
          启用模型
        </label>
      </div>
      <div className="form-actions"><button type="submit" disabled={loading || providers.length === 0}>保存模型</button></div>
    </form>
  );
}

function CodexAccountForm({ form, setForm, tenants, onSubmit, loading }: {
  form: typeof emptyCodexForm;
  setForm: (form: typeof emptyCodexForm) => void;
  tenants: Tenant[];
  onSubmit: (event: FormEvent) => void;
  loading: boolean;
}) {
  return (
    <form className="panel form-panel" onSubmit={onSubmit}>
      <div className="panel-head compact">
        <h2>{form.id ? '编辑 Codex 账号' : '新增 Codex 账号'}</h2>
        {form.id && <button type="button" className="secondary" onClick={() => setForm(emptyCodexForm)}>新建</button>}
      </div>
      <div className="form-grid">
        <Select label="分配客户" value={form.tenantId} onChange={(tenantId) => setForm({ ...form, tenantId })} options={['', ...tenants.map((tenant) => tenant.id)]} optionLabels={{ '': '未分配', ...Object.fromEntries(tenants.map((tenant) => [tenant.id, tenant.name])) }} />
        <Field label="Codex 登录邮箱" value={form.email} onChange={(email) => setForm({ ...form, email })} />
        <Field label="登录凭据/一次性说明" type="password" value={form.loginSecret} onChange={(loginSecret) => setForm({ ...form, loginSecret })} placeholder="留空保留原值" />
        <Field label="登录提示" value={form.loginHint} onChange={(loginHint) => setForm({ ...form, loginHint })} />
        <Select label="套餐" value={form.plan} onChange={(plan) => setForm({ ...form, plan })} options={['monthly', 'yearly']} />
        <Select label="状态" value={form.status} onChange={(status) => setForm({ ...form, status })} options={['active', 'suspended']} />
        <NumberField label="席位数" value={form.seatLimit} onChange={(seatLimit) => setForm({ ...form, seatLimit })} />
        <Field label="到期时间" type="datetime-local" value={form.expiresAt} onChange={(expiresAt) => setForm({ ...form, expiresAt })} />
      </div>
      <div className="form-actions"><button type="submit" disabled={loading}>保存账号</button></div>
    </form>
  );
}

function TenantTable({ tenants, onEdit, onDelete }: {
  tenants: Tenant[];
  onEdit: (form: typeof emptyTenantForm) => void;
  onDelete?: (tenant: Tenant) => void;
}) {
  if (tenants.length === 0) return <div className="empty">暂无客户。</div>;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>客户</th><th>设备</th><th>余额</th><th>Codex</th><th>状态</th><th /></tr></thead>
        <tbody>
          {tenants.map((tenant) => (
            <tr key={tenant.id}>
              <td><strong>{tenant.name}</strong><span>{tenant.id}</span></td>
              <td>{tenant.activeDevices}/{tenant.maxDevices}</td>
              <td>{formatCents(tenant.balanceCents)}</td>
              <td>{tenant.codexSubscriptionEnabled ? `${tenant.codexSubscriptionPlan || '-'} / ${formatDate(tenant.codexSubscriptionExpiresAt)}` : '未启用'}</td>
              <td><Status value={tenant.status} /></td>
              <td>
                <div className="table-actions">
                  <button className="secondary" type="button" onClick={() => onEdit({
                    id: tenant.id,
                    name: tenant.name,
                    status: tenant.status,
                    maxDevices: tenant.maxDevices,
                    billingMode: tenant.billingMode,
                    balanceCents: tenant.balanceCents,
                    subscriptionPlan: tenant.subscriptionPlan || '',
                    subscriptionExpiresAt: toLocalInput(tenant.subscriptionExpiresAt),
                    codexSubscriptionEnabled: tenant.codexSubscriptionEnabled,
                    codexSubscriptionPlan: tenant.codexSubscriptionPlan || 'monthly',
                    codexSubscriptionExpiresAt: toLocalInput(tenant.codexSubscriptionExpiresAt),
                  })}>编辑</button>
                  {onDelete && (
                    <button className="secondary danger" type="button" onClick={() => onDelete(tenant)}>删除客户</button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AuthorizationCodeTable({ codes, onRevoke, onDelete }: {
  codes: AuthorizationCode[];
  onRevoke?: (code: AuthorizationCode) => void;
  onDelete?: (code: AuthorizationCode) => void;
}) {
  if (codes.length === 0) return <div className="empty">暂无授权码。</div>;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>客户</th><th>授权码</th><th>机器数</th><th>到期</th><th>最近使用</th><th>状态</th><th /></tr></thead>
        <tbody>
          {codes.map((code) => (
            <tr key={code.id}>
              <td><strong>{code.tenantName}</strong><span>{code.note || code.tenantId}</span></td>
              <td><code className="secret-code">{code.authorizationCode || code.codeHint}</code></td>
              <td>{code.maxDevices}</td>
              <td>{formatDate(code.expiresAt)}</td>
              <td>{formatDate(code.lastUsedAt)}</td>
              <td><Status value={code.status} /></td>
              <td>
                <div className="table-actions">
                  {onRevoke && code.status === 'active' && (
                    <button className="secondary" type="button" onClick={() => onRevoke(code)}>撤销授权码</button>
                  )}
                  {onDelete && (
                    <button className="secondary danger" type="button" onClick={() => onDelete(code)}>删除授权码</button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ModelTable({ models, onEdit, onDelete }: {
  models: ModelRoute[];
  onEdit: (model: ModelRoute) => void;
  onDelete: (model: ModelRoute) => void;
}) {
  if (models.length === 0) return <div className="empty">当前供应商下暂无模型路由。</div>;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>模型</th><th>上游模型</th><th>价格 cents/M</th><th>状态</th><th /></tr></thead>
        <tbody>
          {models.map((model) => (
            <tr key={model.id}>
              <td><strong>{model.label}</strong><span>{model.modelId}</span></td>
              <td><strong>{model.upstreamModel}</strong><span>{model.endpointPath}</span></td>
              <td>{model.inputCentsPerMillion}/{model.outputCentsPerMillion} + {model.markupBps}bps</td>
              <td><Status value={model.enabled && model.providerReady ? 'ready' : model.enabled ? 'provider missing' : 'disabled'} /></td>
              <td>
                <div className="table-actions">
                  <button className="secondary" type="button" onClick={() => onEdit(model)}>编辑</button>
                  <button className="secondary danger" type="button" onClick={() => onDelete(model)}>删除</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CodexAccountTable({ accounts, onEdit, onDelete, onSetStatus }: {
  accounts: CodexAccount[];
  onEdit: (form: typeof emptyCodexForm) => void;
  onDelete: (account: CodexAccount) => void;
  onSetStatus: (account: CodexAccount, status: string) => void;
}) {
  if (accounts.length === 0) return <div className="empty">暂无 Codex 账号。</div>;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>账号</th><th>客户</th><th>套餐</th><th>凭据</th><th>状态</th><th /></tr></thead>
        <tbody>
          {accounts.map((account) => (
            <tr key={account.id}>
              <td><strong>{account.email}</strong><span>{account.loginHint || account.id}</span></td>
              <td>{account.tenantName || '未分配'}</td>
              <td>{account.plan} / {formatDate(account.expiresAt)}</td>
              <td>{account.loginSecretConfigured ? account.loginSecretMask : '未配置'}</td>
              <td><Status value={account.status} /></td>
              <td>
                <div className="table-actions">
                  <button className="secondary" type="button" onClick={() => onEdit(codexFormFromAccount(account))}>编辑</button>
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => onSetStatus(account, account.status === 'active' ? 'suspended' : 'active')}
                  >
                    {account.status === 'active' ? '停用' : '启用'}
                  </button>
                  <button className="secondary danger" type="button" onClick={() => onDelete(account)}>删除账号</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GridSection({ children }: { children: React.ReactNode }) {
  return <div className="work-grid">{children}</div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', required = false, placeholder = '' }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <label>
      {label}
      <input type={type} value={value} required={required} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label>
      {label}
      <input type="number" value={value} onChange={(event) => onChange(Number(event.target.value || 0))} />
    </label>
  );
}

function Select({ label, value, onChange, options, optionLabels = {} }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  optionLabels?: Record<string, string>;
}) {
  return (
    <label>
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option || 'empty'} value={option}>{optionLabels[option] || option || '未分配'}</option>
        ))}
      </select>
    </label>
  );
}

function Status({ value }: { value: string }) {
  return <span className={`status ${value.includes('ready') || value === 'active' ? 'ok' : 'warn'}`}>{value}</span>;
}

async function api<T>(path: string, token: string, options: RequestInit = {}): Promise<T> {
  return request<T>(path, {
    ...options,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
}

async function publicApi<T>(path: string, options: RequestInit = {}): Promise<T> {
  return request<T>(path, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
  });
}

async function request<T>(path: string, options: RequestInit): Promise<T> {
  const response = await fetch(path, options);
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

function tabTitle(tab: Tab) {
  return {
    overview: '运营总览',
    tenants: '客户与计费',
    codes: '客户授权',
    gateway: '模型网关',
    codex: 'Codex 订阅账号',
    audit: '审计日志',
  }[tab];
}

function tabSubtitle(tab: Tab) {
  return {
    overview: '客户、设备、模型网关和用量账本状态。',
    tenants: '维护基金公司客户、授权机器数、余额和订阅有效期。',
    codes: '为客户生成一次性授权码，并模拟客户端首次激活。',
    gateway: '在后台配置上游 key、模型别名、价格和加价规则。',
    codex: '管理我们提供给客户使用的 Codex 订阅账号。',
    audit: '查看资金、授权、模型和账号配置变更。',
  }[tab];
}

function formatCents(cents: number) {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
}

function formatDate(value?: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString();
}

function toIsoOrNull(value: string) {
  if (!value) return null;
  return new Date(value).toISOString();
}

function toLocalInput(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

createRoot(document.getElementById('root')!).render(<App />);
