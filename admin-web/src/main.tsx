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
      setNotice('授权码已生成，明文只在这里显示一次');
      await load();
    });
  };

  const saveProvider = async (event: FormEvent) => {
    event.preventDefault();
    await mutate(async () => {
      await api('/api/admin/provider-configs', token, {
        method: 'POST',
        body: JSON.stringify(providerForm),
      });
      setProviderForm({ ...emptyProviderForm, apiKey: '' });
      setNotice('供应商配置已保存');
      await load();
    });
  };

  const saveModel = async (event: FormEvent) => {
    event.preventDefault();
    await mutate(async () => {
      await api('/api/admin/model-routes', token, {
        method: 'POST',
        body: JSON.stringify({ ...modelForm, id: modelForm.id || undefined }),
      });
      setModelForm(emptyModelForm);
      setNotice('模型路由已保存');
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
              <TenantTable tenants={tenants} onEdit={setTenantForm} />
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
              <AuthorizationCodeTable codes={authorizationCodes} />
            </section>
          </GridSection>
        )}
        {activeTab === 'gateway' && (
          <GridSection>
            <ProviderForm
              form={providerForm}
              setForm={setProviderForm}
              providers={providers}
              onSubmit={saveProvider}
              loading={loading}
            />
            <ModelForm
              form={modelForm}
              setForm={setModelForm}
              providers={providers}
              onSubmit={saveModel}
              loading={loading}
            />
            <section className="panel span-2">
              <div className="panel-head">
                <h2>模型路由</h2>
                <span>{models.length} 个</span>
              </div>
              <ModelTable models={models} onEdit={setModelForm} />
            </section>
          </GridSection>
        )}
        {activeTab === 'codex' && (
          <GridSection>
            <CodexAccountForm
              form={codexForm}
              setForm={setCodexForm}
              tenants={tenants}
              onSubmit={saveCodexAccount}
              loading={loading}
            />
            <section className="panel span-2">
              <div className="panel-head">
                <h2>Codex 订阅账号池</h2>
                <span>{codexAccounts.length} 个账号</span>
              </div>
              <CodexAccountTable accounts={codexAccounts} onEdit={setCodexForm} />
            </section>
          </GridSection>
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

function ProviderForm({ form, setForm, providers, onSubmit, loading }: {
  form: typeof emptyProviderForm;
  setForm: (form: typeof emptyProviderForm) => void;
  providers: ProviderConfig[];
  onSubmit: (event: FormEvent) => void;
  loading: boolean;
}) {
  return (
    <form className="panel form-panel" onSubmit={onSubmit}>
      <div className="panel-head compact"><h2>上游供应商</h2></div>
      <div className="provider-list">
        {providers.map((provider) => (
          <button
            type="button"
            className={form.provider === provider.provider ? 'provider-card selected' : 'provider-card'}
            key={provider.provider}
            onClick={() => setForm({
              provider: provider.provider,
              label: provider.label,
              baseUrl: provider.baseUrl,
              endpointPath: provider.endpointPath,
              apiKey: '',
              enabled: provider.enabled,
            })}
          >
            <strong>{provider.label}</strong>
            <span>{provider.keyConfigured ? provider.keyMask : '未配置 key'}</span>
          </button>
        ))}
      </div>
      <div className="form-grid">
        <Field label="Provider ID" value={form.provider} onChange={(provider) => setForm({ ...form, provider })} />
        <Field label="显示名称" value={form.label} onChange={(label) => setForm({ ...form, label })} />
        <Field label="Base URL" value={form.baseUrl} onChange={(baseUrl) => setForm({ ...form, baseUrl })} />
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

function ModelForm({ form, setForm, providers, onSubmit, loading }: {
  form: typeof emptyModelForm;
  setForm: (form: typeof emptyModelForm) => void;
  providers: ProviderConfig[];
  onSubmit: (event: FormEvent) => void;
  loading: boolean;
}) {
  return (
    <form className="panel form-panel" onSubmit={onSubmit}>
      <div className="panel-head compact">
        <h2>{form.id ? '编辑模型路由' : '新增模型路由'}</h2>
        {form.id && <button type="button" className="secondary" onClick={() => setForm(emptyModelForm)}>新建</button>}
      </div>
      <div className="form-grid">
        <Field label="模型 ID" value={form.modelId} onChange={(modelId) => setForm({ ...form, modelId })} />
        <Field label="显示名称" value={form.label} onChange={(label) => setForm({ ...form, label })} />
        <Select label="供应商" value={form.provider} onChange={(provider) => setForm({ ...form, provider })} options={providers.map((provider) => provider.provider)} />
        <Field label="上游模型名" value={form.upstreamModel} onChange={(upstreamModel) => setForm({ ...form, upstreamModel })} />
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
      <div className="form-actions"><button type="submit" disabled={loading}>保存模型</button></div>
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

function TenantTable({ tenants, onEdit }: { tenants: Tenant[]; onEdit: (form: typeof emptyTenantForm) => void }) {
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
              <td><button className="secondary" type="button" onClick={() => onEdit({
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
              })}>编辑</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AuthorizationCodeTable({ codes }: { codes: AuthorizationCode[] }) {
  if (codes.length === 0) return <div className="empty">暂无授权码。</div>;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>客户</th><th>授权码</th><th>机器数</th><th>到期</th><th>最近使用</th><th>状态</th></tr></thead>
        <tbody>
          {codes.map((code) => (
            <tr key={code.id}>
              <td><strong>{code.tenantName}</strong><span>{code.note || code.tenantId}</span></td>
              <td>{code.codeHint}</td>
              <td>{code.maxDevices}</td>
              <td>{formatDate(code.expiresAt)}</td>
              <td>{formatDate(code.lastUsedAt)}</td>
              <td><Status value={code.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ModelTable({ models, onEdit }: { models: ModelRoute[]; onEdit: (form: typeof emptyModelForm) => void }) {
  if (models.length === 0) return <div className="empty">暂无模型路由。</div>;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>模型</th><th>上游</th><th>价格 cents/M</th><th>状态</th><th /></tr></thead>
        <tbody>
          {models.map((model) => (
            <tr key={model.id}>
              <td><strong>{model.label}</strong><span>{model.modelId}</span></td>
              <td><strong>{model.provider}</strong><span>{model.upstreamModel}</span></td>
              <td>{model.inputCentsPerMillion}/{model.outputCentsPerMillion} + {model.markupBps}bps</td>
              <td><Status value={model.enabled && model.providerReady ? 'ready' : model.enabled ? 'provider missing' : 'disabled'} /></td>
              <td><button className="secondary" type="button" onClick={() => onEdit({ ...model })}>编辑</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CodexAccountTable({ accounts, onEdit }: { accounts: CodexAccount[]; onEdit: (form: typeof emptyCodexForm) => void }) {
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
              <td><button className="secondary" type="button" onClick={() => onEdit({
                id: account.id,
                tenantId: account.tenantId || '',
                email: account.email,
                loginSecret: '',
                loginHint: account.loginHint,
                plan: account.plan,
                status: account.status,
                seatLimit: account.seatLimit,
                expiresAt: toLocalInput(account.expiresAt),
              })}>编辑</button></td>
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
