import { FormEvent, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

type Tab = 'overview' | 'tenants' | 'usage' | 'gateway' | 'codex' | 'skills' | 'audit';

interface Summary {
  tenants: number;
  activeDevices: number;
  runs: number;
  billableYuan: number;
  configuredProviders: number;
}

interface Tenant {
  id: string;
  name: string;
  status: string;
  maxDevices: number;
  billingMode: string;
  balanceYuan: number;
  subscriptionPlan?: string | null;
  subscriptionExpiresAt?: string | null;
  codexSubscriptionEnabled: boolean;
  codexSubscriptionPlan?: string | null;
  codexSubscriptionExpiresAt?: string | null;
  activeDevices: number;
  billableYuan: number;
}

interface AuthorizationCode {
  id: string;
  tenantId: string;
  tenantName: string;
  codeHint: string;
  revealable: boolean;
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
  apiFormat?: string;
  authType?: string;
  authHeader?: string;
  customHeaders?: Record<string, string>;
  queryParams?: Record<string, string>;
  requestTimeoutMs?: number;
  maxRetries?: number;
  enabled: boolean;
  keyConfigured: boolean;
  keyMask?: string | null;
}

interface DiscoveredModel {
  id: string;
  label: string;
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
  contextWindowTokens: number;
  maxOutputTokens: number;
  supportedReasoningEfforts: string[];
  defaultReasoningEffort: string;
  fastModeSupported: boolean;
  enabled: boolean;
  sortOrder: number;
  inputYuanPerMillion: number;
  outputYuanPerMillion: number;
  reasoningYuanPerMillion: number;
  cachedInputYuanPerMillion: number;
  markupBps: number;
  providerReady: boolean;
}

interface CodexAccount {
  id: string;
  tenantId?: string | null;
  tenantName?: string | null;
  tenantIds?: string[];
  tenantNames?: string[];
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

interface SkillRelease {
  id: string;
  version: string;
  channel: 'dev' | 'beta' | 'stable' | string;
  status: 'draft' | 'published' | 'archived' | string;
  minClientVersion: string;
  releaseNotes: string;
  codecVersion: number;
  skillCount: number;
  encodedFileCount: number;
  manifestSummary: {
    skills?: Array<{ skillName: string }>;
  };
  artifactSha256: string;
  artifactSize: number;
  createdAt: string;
  publishedAt?: string | null;
}

interface BillingUsageTotals {
  runCount: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  totalTokens: number;
  costYuan: number;
  billableYuan: number;
  lastUsedAt?: string | null;
}

interface BillingModelUsage extends BillingUsageTotals {
  modelId: string;
  label: string;
  provider?: string | null;
}

interface BillingLedgerEntry {
  id: string;
  runId?: string | null;
  entryType: string;
  amountYuan: number;
  description: string;
  createdAt: string;
  entryCount?: number;
}

interface BillingLedgerPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasPrevious: boolean;
  hasNext: boolean;
}

interface OfflinePaymentRecord {
  id: string;
  recordType: 'offline_receipt' | 'correction';
  amountYuan: number;
  reference: string;
  note: string;
  receivedAt: string;
  reversesRecordId?: string | null;
  recordedBy: string;
  createdAt: string;
}

interface BillingReconciliationTenant {
  tenantId: string;
  tenantName: string;
  storedBalanceYuan: number;
  ledgerBalanceYuan: number;
  differenceYuan: number;
  openRuns: number;
  staleOpenRuns: number;
  failedRuns24h: number;
  usageEvents24h: number;
  totalTokens24h: number;
  unverifiedUsageEvents24h: number;
  billableYuan24h: number;
  balanced: boolean;
  requiresReview: boolean;
}

interface BillingReconciliation {
  balanced: boolean;
  requiresReview: boolean;
  generatedAt: string;
  paymentCapability: 'offline-records-only';
  tenants: BillingReconciliationTenant[];
}

interface TenantBillingSummary {
  tenant: Pick<Tenant, 'id' | 'name' | 'status' | 'billingMode' | 'balanceYuan' | 'subscriptionPlan' | 'subscriptionExpiresAt' | 'codexSubscriptionEnabled' | 'codexSubscriptionPlan' | 'codexSubscriptionExpiresAt'>;
  period: {
    currentMonthStart: string;
    currentMonthEnd: string;
    generatedAt: string;
  };
  usage: {
    currentMonth: BillingUsageTotals;
    allTime: BillingUsageTotals;
    models: BillingModelUsage[];
    recentLedger: BillingLedgerEntry[];
    ledgerPagination: BillingLedgerPagination;
    offlinePayments: OfflinePaymentRecord[];
  };
}

interface ConfirmDialogState {
  title: string;
  message: string;
  detail?: string;
  confirmLabel: string;
  onConfirm: () => Promise<void> | void;
}

type FormDialog = 'tenant' | 'authorization' | 'activation' | 'provider' | 'model' | 'codex' | null;

const defaultSummary: Summary = {
  tenants: 0,
  activeDevices: 0,
  runs: 0,
  billableYuan: 0,
  configuredProviders: 0,
};

const emptyTenantForm = {
  id: '',
  name: '',
  status: 'active',
  maxDevices: 3,
  billingMode: 'hybrid',
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
  apiFormat: 'responses',
  authType: 'bearer',
  authHeader: 'authorization',
  customHeaders: '{}',
  queryParams: '{}',
  requestTimeoutMs: 300000,
  maxRetries: 2,
  enabled: true,
};

const providerPresets: Array<{ id: string; label: string; config: Omit<typeof emptyProviderForm, 'apiKey' | 'enabled'> }> = [
  { id: 'openai', label: 'OpenAI · Responses', config: { provider: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', endpointPath: '/responses', apiFormat: 'responses', authType: 'bearer', authHeader: 'authorization', customHeaders: '{}', queryParams: '{}', requestTimeoutMs: 300000, maxRetries: 2 } },
  { id: 'anthropic', label: 'Anthropic · Messages', config: { provider: 'anthropic', label: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1', endpointPath: '/messages', apiFormat: 'anthropic_messages', authType: 'api_key_header', authHeader: 'x-api-key', customHeaders: '{"anthropic-version":"2023-06-01"}', queryParams: '{}', requestTimeoutMs: 300000, maxRetries: 2 } },
  { id: 'google', label: 'Google Gemini · 原生', config: { provider: 'google', label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', endpointPath: '/models/{model}:generateContent', apiFormat: 'gemini_generate_content', authType: 'query_param', authHeader: 'key', customHeaders: '{}', queryParams: '{}', requestTimeoutMs: 300000, maxRetries: 2 } },
  { id: 'deepseek', label: 'DeepSeek · Chat', config: { provider: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', endpointPath: '/chat/completions', apiFormat: 'chat_completions', authType: 'bearer', authHeader: 'authorization', customHeaders: '{}', queryParams: '{}', requestTimeoutMs: 300000, maxRetries: 2 } },
  { id: 'openrouter', label: 'OpenRouter · Responses', config: { provider: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', endpointPath: '/responses', apiFormat: 'responses', authType: 'bearer', authHeader: 'authorization', customHeaders: '{}', queryParams: '{}', requestTimeoutMs: 300000, maxRetries: 2 } },
  { id: 'azure-openai', label: 'Azure OpenAI · Responses', config: { provider: 'azure-openai', label: 'Azure OpenAI', baseUrl: 'https://YOUR_RESOURCE.openai.azure.com/openai/v1', endpointPath: '/responses', apiFormat: 'responses', authType: 'api_key_header', authHeader: 'api-key', customHeaders: '{}', queryParams: '{"api-version":"2025-04-01-preview"}', requestTimeoutMs: 300000, maxRetries: 2 } },
  { id: 'ollama', label: 'Ollama · 本地免鉴权', config: { provider: 'ollama', label: 'Ollama (Local)', baseUrl: 'http://host.docker.internal:11434/v1', endpointPath: '/chat/completions', apiFormat: 'chat_completions', authType: 'none', authHeader: 'authorization', customHeaders: '{}', queryParams: '{}', requestTimeoutMs: 300000, maxRetries: 1 } },
  { id: 'dashscope', label: '阿里云百炼 / Qwen · Chat', config: { provider: 'dashscope', label: 'Alibaba Cloud DashScope / Qwen', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', endpointPath: '/chat/completions', apiFormat: 'chat_completions', authType: 'bearer', authHeader: 'authorization', customHeaders: '{}', queryParams: '{}', requestTimeoutMs: 300000, maxRetries: 2 } },
  { id: 'moonshot', label: 'Moonshot / Kimi · Chat', config: { provider: 'moonshot', label: 'Moonshot AI / Kimi', baseUrl: 'https://api.moonshot.cn/v1', endpointPath: '/chat/completions', apiFormat: 'chat_completions', authType: 'bearer', authHeader: 'authorization', customHeaders: '{}', queryParams: '{}', requestTimeoutMs: 300000, maxRetries: 2 } },
  { id: 'siliconflow', label: 'SiliconFlow · Chat', config: { provider: 'siliconflow', label: 'SiliconFlow', baseUrl: 'https://api.siliconflow.cn/v1', endpointPath: '/chat/completions', apiFormat: 'chat_completions', authType: 'bearer', authHeader: 'authorization', customHeaders: '{}', queryParams: '{}', requestTimeoutMs: 300000, maxRetries: 2 } },
  { id: 'zhipu', label: '智谱 GLM · Chat', config: { provider: 'zhipu', label: 'Zhipu AI / GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', endpointPath: '/chat/completions', apiFormat: 'chat_completions', authType: 'bearer', authHeader: 'authorization', customHeaders: '{}', queryParams: '{}', requestTimeoutMs: 300000, maxRetries: 2 } },
  { id: 'volcengine-ark', label: '火山方舟 · Chat', config: { provider: 'volcengine-ark', label: 'Volcengine Ark', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', endpointPath: '/chat/completions', apiFormat: 'chat_completions', authType: 'bearer', authHeader: 'authorization', customHeaders: '{}', queryParams: '{}', requestTimeoutMs: 300000, maxRetries: 2 } },
  { id: 'cli-proxy', label: 'CLIProxyAPI · Responses', config: { provider: 'cli-proxy', label: 'CLIProxyAPI', baseUrl: 'https://gpt.yuanliu.cloud/v1', endpointPath: '/responses', apiFormat: 'responses', authType: 'bearer', authHeader: 'authorization', customHeaders: '{}', queryParams: '{}', requestTimeoutMs: 300000, maxRetries: 2 } },
];

const reasoningEffortOptions = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const reasoningEffortLabels: Record<string, string> = {
  none: '关闭',
  minimal: '极低',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '超高',
  max: '最大',
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
  contextWindowTokens: 64_000,
  maxOutputTokens: 32_000,
  supportedReasoningEfforts: ['none'] as string[],
  defaultReasoningEffort: 'none',
  fastModeSupported: false,
  enabled: true,
  sortOrder: 100,
  inputYuanPerMillion: 0,
  outputYuanPerMillion: 0,
  reasoningYuanPerMillion: 0,
  cachedInputYuanPerMillion: 0,
  priceMultiplier: 1.25,
};

const emptyCodexForm = {
  id: '',
  tenantIds: [] as string[],
  email: '',
  loginSecret: '',
  loginHint: '',
  plan: 'monthly',
  status: 'active',
  seatLimit: 1,
  expiresAt: '',
};

const navItems: Array<[Tab, string]> = [
  ['overview', '总览'],
  ['tenants', '客户'],
  ['usage', 'LLM 用量'],
  ['gateway', '模型网关'],
  ['codex', 'GPT 账号'],
  ['skills', 'Skills 发行'],
  ['audit', '审计'],
];

const navIcons: Record<Tab, React.JSX.Element> = {
  overview: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  ),
  tenants: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9.5" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M15.5 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  usage: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19V9" /><path d="M10 19V5" /><path d="M16 19v-7" /><path d="M22 19V3" />
      <path d="M2 19h22" />
    </svg>
  ),
  gateway: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5" cy="12" r="2.5" /><circle cx="19" cy="6" r="2.5" /><circle cx="19" cy="18" r="2.5" />
      <path d="M7.3 10.8 16.7 7.2" /><path d="M7.3 13.2 16.7 16.8" />
    </svg>
  ),
  codex: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8" /><path d="M12 17v4" />
      <path d="m9 8 2 2.5L9 13" /><path d="M13 13h3" />
    </svg>
  ),
  skills: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m12 2 8 4.5v9L12 20l-8-4.5v-9z" /><path d="m4 6.5 8 4.5 8-4.5" /><path d="M12 11v9" />
    </svg>
  ),
  audit: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" /><path d="M9 13h6" /><path d="M9 17h4" />
    </svg>
  ),
};

function App() {
  const [token, setToken] = useState(() => localStorage.getItem('alpha-admin-token') || '');
  const [email, setEmail] = useState('admin@alpha-studio.local');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [activeTab, setActiveTab] = useState<Tab>(() => tabFromLocation());
  const [summary, setSummary] = useState<Summary>(defaultSummary);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [authorizationCodes, setAuthorizationCodes] = useState<AuthorizationCode[]>([]);
  const [revealedAuthorizationCodes, setRevealedAuthorizationCodes] = useState<Record<string, string>>({});
  const [revealingAuthorizationCodeId, setRevealingAuthorizationCodeId] = useState('');
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [models, setModels] = useState<ModelRoute[]>([]);
  const [discoveredModels, setDiscoveredModels] = useState<DiscoveredModel[]>([]);
  const [codexAccounts, setCodexAccounts] = useState<CodexAccount[]>([]);
  const [skillReleases, setSkillReleases] = useState<SkillRelease[]>([]);
  const [skillBundleFile, setSkillBundleFile] = useState<File | null>(null);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [selectedUsageTenantId, setSelectedUsageTenantId] = useState('');
  const [tenantBilling, setTenantBilling] = useState<TenantBillingSummary | null>(null);
  const [billingReconciliation, setBillingReconciliation] = useState<BillingReconciliation | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageError, setUsageError] = useState('');
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
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [formDialog, setFormDialog] = useState<FormDialog>(null);

  const money = useMemo(() => formatYuan(summary.billableYuan), [summary.billableYuan]);
  const selectedProvider = useMemo(
    () => selectedProviderId ? providers.find((provider) => provider.provider === selectedProviderId) || providers[0] || null : null,
    [providers, selectedProviderId],
  );
  const selectedProviderModels = useMemo(
    () => models.filter((model) => model.provider === selectedProvider?.provider),
    [models, selectedProvider],
  );
  const providerFormTarget = useMemo(
    () => selectedProvider?.provider === providerForm.provider ? selectedProvider : null,
    [providerForm.provider, selectedProvider],
  );
  const selectedAuthorizationTenant = useMemo(
    () => tenants.find((tenant) => tenant.id === codeForm.tenantId) || tenants[0] || null,
    [tenants, codeForm.tenantId],
  );
  const selectedAuthorizationCodes = useMemo(
    () => authorizationCodes.filter((code) => code.tenantId === selectedAuthorizationTenant?.id),
    [authorizationCodes, selectedAuthorizationTenant],
  );

  useEffect(() => {
    if (!providers.length || !selectedProviderId || providers.some((provider) => provider.provider === selectedProviderId)) return;
    const nextProvider = providers[0];
    setSelectedProviderId(nextProvider.provider);
    setProviderForm(providerFormFromConfig(nextProvider));
    setModelForm(modelFormForProvider(nextProvider));
  }, [providers, selectedProviderId]);

  useEffect(() => {
    const handlePopState = () => setActiveTab(tabFromLocation());
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    document.title = `${tabTitle(activeTab)} - Alpha Studio Admin`;
  }, [activeTab]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const navigateTab = (tab: Tab) => {
    setActiveTab(tab);
    const nextPath = pathForTab(tab);
    if (window.location.pathname !== nextPath) {
      window.history.pushState({}, '', nextPath);
    }
  };

  const login = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, totpCode }),
      });
      if (!response.ok) throw new Error(await response.text());
      const data = await response.json();
      localStorage.setItem('alpha-admin-token', data.token);
      setToken(data.token);
      setTotpCode('');
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
        skillReleaseData,
        auditData,
      ] = await Promise.all([
        api<Summary>('/api/admin/summary', token),
        api<{ tenants: Tenant[] }>('/api/admin/tenants', token),
        api<{ authorizationCodes: AuthorizationCode[] }>('/api/admin/authorization-codes', token),
        api<{ providers: ProviderConfig[] }>('/api/admin/provider-configs', token),
        api<{ models: ModelRoute[] }>('/api/admin/model-routes', token),
        api<{ accounts: CodexAccount[] }>('/api/admin/codex-accounts', token),
        api<{ releases: SkillRelease[] }>('/api/admin/skill-releases', token),
        api<{ logs: AuditLog[] }>('/api/admin/audit-logs', token),
      ]);
      setSummary(summaryData);
      const loadedTenants = tenantData.tenants || [];
      setTenants(loadedTenants);
      setSelectedUsageTenantId((tenantId) => selectExistingTenantId(loadedTenants, tenantId));
      setAuthorizationCodes(codeData.authorizationCodes || []);
      setRevealedAuthorizationCodes({});
      setProviders(providerData.providers || []);
      setModels(modelData.models || []);
      setCodexAccounts(codexData.accounts || []);
      setSkillReleases(skillReleaseData.releases || []);
      setLogs(auditData.logs || []);
      setCodeForm((form) => ({ ...form, tenantId: selectExistingTenantId(loadedTenants, form.tenantId) }));
      setCodexForm((form) => ({
        ...form,
        tenantIds: form.tenantIds.filter((tenantId) => loadedTenants.some((tenant) => tenant.id === tenantId)),
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  const loadTenantBilling = async (tenantId: string, page = 1) => {
    if (!tenantId) {
      setTenantBilling(null);
      return;
    }
    setUsageLoading(true);
    setUsageError('');
    try {
      const data = await api<TenantBillingSummary>(
        `/api/admin/tenants/${encodeURIComponent(tenantId)}/billing?page=${page}&pageSize=20`,
        token,
      );
      setTenantBilling(data);
    } catch (err) {
      setUsageError(err instanceof Error ? err.message : '用量数据加载失败');
    } finally {
      setUsageLoading(false);
    }
  };

  const loadBillingReconciliation = async () => {
    try {
      setBillingReconciliation(await api<BillingReconciliation>('/api/admin/billing/reconciliation', token));
    } catch (err) {
      setUsageError(err instanceof Error ? err.message : '对账状态加载失败');
    }
  };

  useEffect(() => {
    if (token) void load();
  }, [token]);

  useEffect(() => {
    if (token && activeTab === 'usage' && selectedUsageTenantId) {
      void loadTenantBilling(selectedUsageTenantId, 1);
      void loadBillingReconciliation();
    }
  }, [token, activeTab, selectedUsageTenantId]);

  const recordOfflinePayment = async (input: {
    amountYuan: number;
    reference: string;
    note: string;
    receivedAt: string;
  }) => {
    if (!selectedUsageTenantId) return;
    await mutate(async () => {
      await api(`/api/admin/tenants/${encodeURIComponent(selectedUsageTenantId)}/offline-payments`, token, {
        method: 'POST',
        body: JSON.stringify({
          ...input,
          receivedAt: toIsoOrNull(input.receivedAt),
          operationKey: crypto.randomUUID(),
        }),
      });
      setNotice('线下收款记录已登记；系统未发起任何支付');
      await Promise.all([
        loadTenantBilling(selectedUsageTenantId, tenantBilling?.usage.ledgerPagination.page ?? 1),
        loadBillingReconciliation(),
        load(),
      ]);
    });
  };

  const correctOfflinePayment = async (paymentId: string, note: string) => {
    await mutate(async () => {
      await api(`/api/admin/offline-payments/${encodeURIComponent(paymentId)}/correct`, token, {
        method: 'POST',
        body: JSON.stringify({ operationKey: crypto.randomUUID(), note }),
      });
      setNotice('线下收款登记已用更正流水冲销；系统未发起退款');
      await Promise.all([
        loadTenantBilling(selectedUsageTenantId, tenantBilling?.usage.ledgerPagination.page ?? 1),
        loadBillingReconciliation(),
        load(),
      ]);
    });
  };

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
      setFormDialog(null);
      setNotice('客户已保存');
      await load();
    });
  };

  const createAuthorizationCode = async (event: FormEvent) => {
    event.preventDefault();
    await mutate(async () => {
      if (!selectedAuthorizationTenant) throw new Error('请先选择客户');
      const data = await api<{ authorizationCode: string }>('/api/admin/authorization-codes', token, {
        method: 'POST',
        body: JSON.stringify({
          tenantId: selectedAuthorizationTenant.id,
          maxDevices: codeForm.maxDevices,
          expiresAt: toIsoOrNull(codeForm.expiresAt),
          note: codeForm.note,
        }),
      });
      setGeneratedCode(data.authorizationCode);
      setNotice(`${selectedAuthorizationTenant.name} 的授权码已生成`);
      await load();
    });
  };

  const saveProvider = async (event: FormEvent) => {
    event.preventDefault();
    const providerId = providerForm.provider.trim().toLowerCase();
    await mutate(async () => {
      await api('/api/admin/provider-configs', token, {
        method: 'POST',
        body: JSON.stringify(providerPayload(providerForm)),
      });
      setSelectedProviderId(providerId);
      setProviderForm({ ...providerForm, provider: providerId, apiKey: '' });
      setModelForm(modelFormForProvider({
        provider: providerId,
        baseUrl: providerForm.baseUrl,
        endpointPath: providerForm.endpointPath,
      }));
      setFormDialog(null);
      setNotice('供应商配置已保存');
      await load();
    });
  };

  const discoverProviderModels = async () => {
    await mutate(async () => {
      const data = await api<{ models: DiscoveredModel[] }>('/api/admin/provider-configs/discover-models', token, {
        method: 'POST',
        body: JSON.stringify(providerPayload(providerForm)),
      });
      const discovered = data.models || [];
      setDiscoveredModels(discovered);
      if (discovered.length === 1) {
        setModelForm((form) => applyVerifiedModelCapabilities({
          ...form,
          modelId: form.modelId || discovered[0].id,
          upstreamModel: discovered[0].id,
          label: form.label || discovered[0].label,
        }));
      }
      setNotice(`已发现 ${discovered.length} 个模型`);
    });
  };

  const saveModel = async (event: FormEvent) => {
    event.preventDefault();
    const providerId = modelForm.provider;
    await mutate(async () => {
      const { priceMultiplier, ...route } = modelForm;
      await api('/api/admin/model-routes', token, {
        method: 'POST',
        body: JSON.stringify({
          ...route,
          id: route.id || undefined,
          markupBps: markupBpsFromPriceMultiplier(priceMultiplier),
        }),
      });
      setSelectedProviderId(providerId);
      setModelForm(modelFormForProvider(providers.find((provider) => provider.provider === providerId)));
      setFormDialog(null);
      setNotice('模型路由已保存');
      await load();
    });
  };

  const selectProvider = (provider: ProviderConfig) => {
    setSelectedProviderId(provider.provider);
    setProviderForm(providerFormFromConfig(provider));
    setModelForm(modelFormForProvider(provider));
    setDiscoveredModels([]);
  };

  const createProvider = () => {
    setProviderForm({ ...emptyProviderForm, provider: '', label: '', apiKey: '' });
    setModelForm(modelFormForProvider(null));
    setDiscoveredModels([]);
    setFormDialog('provider');
  };

  const createModelForSelectedProvider = () => {
    setModelForm(modelFormForProvider(selectedProvider));
    setFormDialog('model');
  };

  const editProvider = (provider: ProviderConfig) => {
    selectProvider(provider);
    setFormDialog('provider');
  };

  const editModel = (model: ModelRoute) => {
    setModelForm(modelFormFromRoute(model));
    setFormDialog('model');
  };

  const changeModelProvider = (providerId: string) => {
    const provider = providers.find((candidate) => candidate.provider === providerId);
    setSelectedProviderId(providerId);
    setModelForm((form) => applyVerifiedModelCapabilities({
      ...form,
      provider: providerId,
      baseUrl: provider?.baseUrl || form.baseUrl,
      endpointPath: provider?.endpointPath || form.endpointPath,
      contextWindowTokens: defaultContextWindowTokens(providerId),
      maxOutputTokens: emptyModelForm.maxOutputTokens,
      supportedReasoningEfforts: emptyModelForm.supportedReasoningEfforts,
      defaultReasoningEffort: emptyModelForm.defaultReasoningEffort,
    }));
  };

  const deleteProvider = async (provider: ProviderConfig) => {
    setConfirmDialog({
      title: '删除供应商',
      message: `确定删除 ${provider.label}？`,
      detail: `${provider.provider} 下的模型路由也会一起删除，操作不可恢复。`,
      confirmLabel: '删除供应商',
      onConfirm: () => mutate(async () => {
        await api(`/api/admin/provider-configs/${encodeURIComponent(provider.provider)}`, token, {
          method: 'DELETE',
        });
        const nextProvider = providers.find((candidate) => candidate.provider !== provider.provider) || null;
        setSelectedProviderId(nextProvider?.provider || '');
        setProviderForm(nextProvider ? providerFormFromConfig(nextProvider) : { ...emptyProviderForm, provider: '', label: '', apiKey: '' });
        setModelForm(modelFormForProvider(nextProvider));
        setNotice('供应商已删除');
        await load();
      }),
    });
  };

  const deleteModel = async (model: ModelRoute) => {
    setConfirmDialog({
      title: '删除模型路由',
      message: `确定删除 ${model.label}？`,
      detail: `模型 ID：${model.modelId}`,
      confirmLabel: '删除模型',
      onConfirm: () => mutate(async () => {
        await api(`/api/admin/model-routes/${encodeURIComponent(model.id)}`, token, {
          method: 'DELETE',
        });
        if (modelForm.id === model.id) setModelForm(modelFormForProvider(selectedProvider));
        setNotice('模型路由已删除');
        await load();
      }),
    });
  };

  const deleteTenant = async (tenant: Tenant) => {
    setConfirmDialog({
      title: '删除客户',
      message: `确定删除 ${tenant.name}？`,
      detail: `客户 ID：${tenant.id}。这会清理其授权码、设备和用量记录，操作不可恢复。`,
      confirmLabel: '删除客户',
      onConfirm: () => mutate(async () => {
        await api(`/api/admin/tenants/${encodeURIComponent(tenant.id)}`, token, {
          method: 'DELETE',
        });
        if (tenantForm.id === tenant.id) setTenantForm(emptyTenantForm);
        setNotice('客户已删除');
        await load();
      }),
    });
  };

  const updateAuthorizationCodeStatus = async (code: AuthorizationCode, status: string) => {
    const action = status === 'revoked' ? '撤销' : '更新';
    setConfirmDialog({
      title: `${action}授权码`,
      message: `确定${action}授权码 ${code.codeHint}？`,
      detail: `客户：${code.tenantName}`,
      confirmLabel: status === 'revoked' ? '撤销授权码' : '更新状态',
      onConfirm: () => mutate(async () => {
        await api(`/api/admin/authorization-codes/${encodeURIComponent(code.id)}`, token, {
          method: 'PATCH',
          body: JSON.stringify({ status }),
        });
        setNotice(status === 'revoked' ? '授权码已撤销' : '授权码状态已更新');
        await load();
      }),
    });
  };

  const deleteAuthorizationCode = async (code: AuthorizationCode) => {
    setConfirmDialog({
      title: '删除授权码',
      message: `确定删除授权码 ${code.codeHint}？`,
      detail: `客户：${code.tenantName}`,
      confirmLabel: '删除授权码',
      onConfirm: () => mutate(async () => {
        await api(`/api/admin/authorization-codes/${encodeURIComponent(code.id)}`, token, {
          method: 'DELETE',
        });
        setNotice('授权码已删除');
        await load();
      }),
    });
  };

  const toggleAuthorizationCodeVisibility = async (code: AuthorizationCode) => {
    if (revealedAuthorizationCodes[code.id]) {
      setRevealedAuthorizationCodes((current) => {
        const next = { ...current };
        delete next[code.id];
        return next;
      });
      return;
    }
    if (!code.revealable) {
      setError('该旧授权码没有可恢复的加密副本，请生成新授权码后撤销旧码。');
      return;
    }
    setError('');
    setRevealingAuthorizationCodeId(code.id);
    try {
      const data = await api<{ authorizationCode: string }>(
        `/api/admin/authorization-codes/${encodeURIComponent(code.id)}/reveal`,
        token,
        { method: 'POST' },
      );
      setRevealedAuthorizationCodes((current) => ({
        ...current,
        [code.id]: data.authorizationCode,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : '授权码读取失败');
    } finally {
      setRevealingAuthorizationCodeId('');
    }
  };

  const saveCodexAccount = async (event: FormEvent) => {
    event.preventDefault();
    await mutate(async () => {
      await api('/api/admin/codex-accounts', token, {
        method: 'POST',
        body: JSON.stringify({
          ...codexForm,
          id: codexForm.id || undefined,
          expiresAt: toIsoOrNull(codexForm.expiresAt),
        }),
      });
      setCodexForm(emptyCodexForm);
      setFormDialog(null);
      setNotice('GPT 账号已保存');
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
          expiresAt: toIsoOrNull(form.expiresAt),
        }),
      });
      setNotice(status === 'active' ? 'GPT 账号已启用' : 'GPT 账号已停用');
      await load();
    });
  };

  const deleteCodexAccount = async (account: CodexAccount) => {
    setConfirmDialog({
      title: '删除 GPT 账号',
      message: `确定删除 ${account.email}？`,
      detail: codexAccountTenantNames(account).length > 0 ? `当前分配客户：${codexAccountTenantNames(account).join('、')}` : '当前未分配给客户。',
      confirmLabel: '删除账号',
      onConfirm: () => mutate(async () => {
        await api(`/api/admin/codex-accounts/${encodeURIComponent(account.id)}`, token, {
          method: 'DELETE',
        });
        if (codexForm.id === account.id) setCodexForm(emptyCodexForm);
        setNotice('GPT 账号已删除');
        await load();
      }),
    });
  };

  const uploadSkillRelease = async (event: FormEvent) => {
    event.preventDefault();
    await mutate(async () => {
      if (!skillBundleFile) throw new Error('请选择由 npm run skills:release 生成的 .asb.json 文件');
      const artifactBase64 = await fileToBase64(skillBundleFile);
      await api('/api/admin/skill-releases', token, {
        method: 'POST',
        body: JSON.stringify({ artifactBase64 }),
      });
      setSkillBundleFile(null);
      setNotice('受保护的 Skill 发行包已上传为草稿');
      await load();
    });
  };

  const publishSkillRelease = (release: SkillRelease) => {
    const isRollback = release.status === 'archived';
    setConfirmDialog({
      title: isRollback ? '回滚 Skill 版本' : '发布 Skill 版本',
      message: `${isRollback ? '回滚到' : '发布'} ${release.version}（${release.channel}）？`,
      detail: '客户端将在下次同步时下载此版本；下载、校验或解码失败时仍保留上一个可用版本。',
      confirmLabel: isRollback ? '确认回滚' : '确认发布',
      onConfirm: () => mutate(async () => {
        await api(`/api/admin/skill-releases/${encodeURIComponent(release.id)}/publish`, token, {
          method: 'POST',
        });
        setNotice(isRollback ? `已回滚到 ${release.version}` : `已发布 ${release.version}`);
        await load();
      }),
    });
  };

  const deleteSkillRelease = (release: SkillRelease) => {
    setConfirmDialog({
      title: '删除 Skill 发行草稿',
      message: `确定删除 ${release.version}（${release.channel}）？`,
      detail: '当前已发布版本不能删除；历史版本删除后将无法再用于回滚。',
      confirmLabel: '删除版本',
      onConfirm: () => mutate(async () => {
        await api(`/api/admin/skill-releases/${encodeURIComponent(release.id)}`, token, {
          method: 'DELETE',
        });
        setNotice('Skill 发行版本已删除');
        await load();
      }),
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

  const selectTenantForAuthorization = (tenant: Tenant) => {
    setGeneratedCode('');
    setProbeResult('');
    setCodeForm((form) => ({ ...form, tenantId: tenant.id, maxDevices: tenant.maxDevices }));
    setActivationProbe((form) => ({ ...form, companyName: tenant.name }));
  };

  const createTenant = () => {
    setTenantForm(emptyTenantForm);
    setFormDialog('tenant');
  };

  const editTenant = (form: typeof emptyTenantForm) => {
    setTenantForm(form);
    setFormDialog('tenant');
  };

  const createCodeForSelectedTenant = () => {
    if (!selectedAuthorizationTenant) return;
    setGeneratedCode('');
    setCodeForm({
      tenantId: selectedAuthorizationTenant.id,
      maxDevices: selectedAuthorizationTenant.maxDevices,
      expiresAt: '',
      note: '',
    });
    setFormDialog('authorization');
  };

  const testSelectedTenantActivation = () => {
    if (!selectedAuthorizationTenant) return;
    setProbeResult('');
    setActivationProbe((form) => ({ ...form, companyName: selectedAuthorizationTenant.name }));
    setFormDialog('activation');
  };

  const createCodexAccount = () => {
    setCodexForm(emptyCodexForm);
    setFormDialog('codex');
  };

  const editCodexAccount = (form: typeof emptyCodexForm) => {
    setCodexForm(form);
    setFormDialog('codex');
  };

  const closeFormDialog = () => {
    if (!loading) setFormDialog(null);
  };

  const confirmPendingAction = async () => {
    if (!confirmDialog) return;
    const { onConfirm } = confirmDialog;
    setConfirmDialog(null);
    await onConfirm();
  };

  if (!token) {
    return (
      <main className="login-screen">
        <form className="login-panel" onSubmit={login}>
          <div>
            <div className="login-brand" aria-hidden="true">AS</div>
            <h1 style={{ marginTop: 18 }}>Alpha Studio Admin</h1>
            <p>内部运营后台 · 请使用管理员账号登录</p>
          </div>
          <label>
            邮箱
            <input autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label>
            密码
            <input autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          <label>
            动态验证码
            <input
              autoComplete="one-time-code"
              inputMode="numeric"
              maxLength={6}
              pattern="[0-9]{6}"
              placeholder="认证器中的 6 位验证码"
              value={totpCode}
              onChange={(event) => setTotpCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
            />
          </label>
          {error && <div className="error">{error}</div>}
          <button type="submit" disabled={loading || totpCode.length !== 6}>{loading ? '登录中...' : '登录'}</button>
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
          {navItems.map(([tab, label]) => (
            <button
              className={activeTab === tab ? 'active' : ''}
              key={tab}
              type="button"
              onClick={() => navigateTab(tab)}
            >
              <span className="nav-icon" aria-hidden="true">{navIcons[tab]}</span>
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
          <div className="page-actions">
            <button
              className="secondary"
              type="button"
              onClick={() => activeTab === 'usage'
                ? void loadTenantBilling(selectedUsageTenantId, tenantBilling?.usage.ledgerPagination.page ?? 1)
                : void load()}
              disabled={loading || usageLoading}
            >
              {loading || usageLoading ? '刷新中...' : '刷新数据'}
            </button>
            {activeTab === 'tenants' && <button type="button" onClick={createTenant}>新增客户</button>}
            {activeTab === 'gateway' && <button type="button" onClick={createProvider}>新增供应商</button>}
            {activeTab === 'codex' && <button type="button" onClick={createCodexAccount}>新增账号</button>}
          </div>
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
              <TenantTable tenants={tenants.slice(0, 6)} onEdit={editTenant} />
            </section>
          </>
        )}
        {activeTab === 'tenants' && (
          <div className="page-stack">
            <section className="panel">
              <div className="panel-head">
                <div>
                  <h2>客户列表</h2>
                  <span>{tenants.length} 个客户 · 选择“授权码”查看对应记录</span>
                </div>
              </div>
              <TenantTable
                tenants={tenants}
                onEdit={editTenant}
                onDelete={deleteTenant}
                onManageCodes={selectTenantForAuthorization}
                selectedTenantId={selectedAuthorizationTenant?.id}
              />
            </section>
            <TenantAuthorizationPanel
              tenant={selectedAuthorizationTenant}
              codes={selectedAuthorizationCodes}
              onCreateCode={createCodeForSelectedTenant}
              onTestActivation={testSelectedTenantActivation}
              onRevoke={(code) => updateAuthorizationCodeStatus(code, 'revoked')}
              onDelete={deleteAuthorizationCode}
              revealedCodes={revealedAuthorizationCodes}
              revealingCodeId={revealingAuthorizationCodeId}
              onToggleReveal={(code) => void toggleAuthorizationCodeVisibility(code)}
            />
          </div>
        )}
        {activeTab === 'usage' && (
          <TenantUsageWorkspace
            tenants={tenants}
            selectedTenantId={selectedUsageTenantId}
            summary={tenantBilling}
            reconciliation={billingReconciliation}
            loading={usageLoading}
            error={usageError}
            onSelectTenant={setSelectedUsageTenantId}
            onPageChange={(page) => void loadTenantBilling(selectedUsageTenantId, page)}
            onRecordOfflinePayment={recordOfflinePayment}
            onCorrectOfflinePayment={correctOfflinePayment}
            onRefreshReconciliation={() => void loadBillingReconciliation()}
          />
        )}
        {activeTab === 'gateway' && (
          <GatewayWorkspace
            providers={providers}
            models={models}
            selectedProvider={selectedProvider}
            selectedProviderModels={selectedProviderModels}
            onSelectProvider={selectProvider}
            onEditProvider={editProvider}
            onDeleteProvider={deleteProvider}
            onCreateModel={createModelForSelectedProvider}
            onEditModel={editModel}
            onDeleteModel={deleteModel}
          />
        )}
        {activeTab === 'codex' && (
          <CodexWorkspace
            accounts={codexAccounts}
            onEdit={editCodexAccount}
            onDelete={deleteCodexAccount}
            onSetStatus={updateCodexAccountStatus}
          />
        )}
        {activeTab === 'skills' && (
          <SkillReleaseWorkspace
            releases={skillReleases}
            bundleFile={skillBundleFile}
            loading={loading}
            onBundleFileChange={setSkillBundleFile}
            onUpload={uploadSkillRelease}
            onPublish={publishSkillRelease}
            onDelete={deleteSkillRelease}
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
      {formDialog === 'tenant' && (
        <Modal
          title={tenantForm.id ? '编辑客户' : '新增客户'}
          description={tenantForm.id ? `更新 ${tenantForm.name} 的基础资料与服务配置。` : '创建客户后即可生成授权码并分配 GPT 账号。'}
          onClose={closeFormDialog}
        >
          <TenantForm form={tenantForm} setForm={setTenantForm} onSubmit={saveTenant} onCancel={closeFormDialog} loading={loading} />
        </Modal>
      )}
      {formDialog === 'authorization' && selectedAuthorizationTenant && (
        <Modal
          title="生成授权码"
          description={`为 ${selectedAuthorizationTenant.name} 创建新的设备授权码。`}
          onClose={closeFormDialog}
        >
          <AuthorizationCodeForm
            form={codeForm}
            setForm={setCodeForm}
            generatedCode={generatedCode}
            onSubmit={createAuthorizationCode}
            onCancel={closeFormDialog}
            loading={loading}
          />
        </Modal>
      )}
      {formDialog === 'activation' && selectedAuthorizationTenant && (
        <Modal
          title="模拟首次激活"
          description={`验证 ${selectedAuthorizationTenant.name} 的客户端激活链路。`}
          onClose={closeFormDialog}
        >
          <ActivationProbe
            form={activationProbe}
            setForm={setActivationProbe}
            result={probeResult}
            onSubmit={testActivation}
            onCancel={closeFormDialog}
            loading={loading}
          />
        </Modal>
      )}
      {formDialog === 'provider' && (
        <Modal
          title={providerFormTarget ? '编辑供应商' : '新增供应商'}
          description={providerFormTarget ? `配置 ${providerFormTarget.label} 的接口、鉴权和请求策略。` : '接入新的模型服务供应商。'}
          onClose={closeFormDialog}
          size="wide"
        >
          <ProviderForm
            form={providerForm}
            setForm={setProviderForm}
            selectedProvider={providerFormTarget}
            selectedModelCount={selectedProviderModels.length}
            onSubmit={saveProvider}
            onDiscoverModels={discoverProviderModels}
            onCancel={closeFormDialog}
            loading={loading}
          />
        </Modal>
      )}
      {formDialog === 'model' && (
        <Modal
          title={modelForm.id ? '编辑模型路由' : '新增模型路由'}
          description="配置上游模型映射、计费价格与路由状态。"
          onClose={closeFormDialog}
          size="wide"
        >
          <ModelForm
            form={modelForm}
            setForm={setModelForm}
            providers={providers}
            onProviderChange={changeModelProvider}
            onSubmit={saveModel}
            discoveredModels={discoveredModels}
            onCancel={closeFormDialog}
            loading={loading}
          />
        </Modal>
      )}
      {formDialog === 'codex' && (
        <Modal
          title={codexForm.id ? '编辑 GPT 账号' : '新增 GPT 账号'}
          description="维护订阅账号、可用席位以及客户分配关系。"
          onClose={closeFormDialog}
        >
          <CodexAccountForm
            form={codexForm}
            setForm={setCodexForm}
            tenants={tenants}
            onSubmit={saveCodexAccount}
            onCancel={closeFormDialog}
            loading={loading}
          />
        </Modal>
      )}
      <ConfirmDialog
        dialog={confirmDialog}
        loading={loading}
        onCancel={() => setConfirmDialog(null)}
        onConfirm={confirmPendingAction}
      />
    </main>
  );
}

function TenantForm({ form, setForm, onSubmit, onCancel, loading }: {
  form: typeof emptyTenantForm;
  setForm: (form: typeof emptyTenantForm) => void;
  onSubmit: (event: FormEvent) => void;
  onCancel: () => void;
  loading: boolean;
}) {
  return (
    <form className="form-panel modal-form" onSubmit={onSubmit}>
      <div className="form-grid">
        <Field label="公司名称" value={form.name} onChange={(name) => setForm({ ...form, name })} required />
        <Field label="客户 ID" value={form.id} onChange={(id) => setForm({ ...form, id })} placeholder="留空自动生成" />
        <Select label="状态" value={form.status} onChange={(status) => setForm({ ...form, status })} options={['active', 'suspended']} />
        <NumberField label="授权机器数" value={form.maxDevices} onChange={(maxDevices) => setForm({ ...form, maxDevices })} />
        <Select label="计费模式" value={form.billingMode} onChange={(billingMode) => setForm({ ...form, billingMode })} options={['hybrid', 'gateway_api', 'subscription']} />
        <div className="form-hint">余额不能直接编辑，请在“LLM 用量”中登记实际收到的线下款项。</div>
        <Field label="API 套餐" value={form.subscriptionPlan} onChange={(subscriptionPlan) => setForm({ ...form, subscriptionPlan })} />
        <Field label="API 到期时间" type="datetime-local" value={form.subscriptionExpiresAt} onChange={(subscriptionExpiresAt) => setForm({ ...form, subscriptionExpiresAt })} />
        <label className="check-row">
          <input type="checkbox" checked={form.codexSubscriptionEnabled} onChange={(event) => setForm({ ...form, codexSubscriptionEnabled: event.target.checked })} />
          启用 GPT 订阅服务
        </label>
        <Select label="GPT 套餐" value={form.codexSubscriptionPlan} onChange={(codexSubscriptionPlan) => setForm({ ...form, codexSubscriptionPlan })} options={['monthly', 'yearly']} />
        <Field label="GPT 到期时间" type="datetime-local" value={form.codexSubscriptionExpiresAt} onChange={(codexSubscriptionExpiresAt) => setForm({ ...form, codexSubscriptionExpiresAt })} />
      </div>
      <div className="form-actions">
        <button type="button" className="secondary" onClick={onCancel} disabled={loading}>取消</button>
        <button type="submit" disabled={loading}>{loading ? '保存中...' : '保存客户'}</button>
      </div>
    </form>
  );
}

function TenantAuthorizationPanel({
  tenant,
  codes,
  onCreateCode,
  onTestActivation,
  onRevoke,
  onDelete,
  revealedCodes,
  revealingCodeId,
  onToggleReveal,
}: {
  tenant: Tenant | null;
  codes: AuthorizationCode[];
  onCreateCode: () => void;
  onTestActivation: () => void;
  onRevoke: (code: AuthorizationCode) => void;
  onDelete: (code: AuthorizationCode) => void;
  revealedCodes: Record<string, string>;
  revealingCodeId: string;
  onToggleReveal: (code: AuthorizationCode) => void;
}) {
  const activeCodes = codes.filter((code) => code.status === 'active').length;

  return (
    <section className="panel tenant-auth-panel">
      <div className="panel-head">
        <div>
          <h2>客户授权</h2>
          <span>{tenant ? `${tenant.name} · ${codes.length} 条授权码` : '选择客户后管理授权码'}</span>
        </div>
        {tenant && (
          <div className="head-actions">
            <button className="secondary" type="button" onClick={onTestActivation}>模拟激活</button>
            <button type="button" onClick={onCreateCode}>生成授权码</button>
          </div>
        )}
      </div>
      {!tenant ? (
        <div className="empty">从客户列表选择“授权码”，即可查看和管理对应记录。</div>
      ) : (
        <>
          <div className="tenant-auth-strip">
            <div className="mini-stat"><span>当前客户</span><strong>{tenant.name}</strong></div>
            <div className="mini-stat"><span>授权机器数</span><strong>{tenant.maxDevices}</strong></div>
            <div className="mini-stat"><span>活跃授权码</span><strong>{activeCodes}</strong></div>
          </div>
          <div className="panel-subhead">
            <div>
              <h3>授权码记录</h3>
              <span>仅显示当前客户的授权码</span>
            </div>
            <span>{codes.length} 条</span>
          </div>
          <AuthorizationCodeTable
            codes={codes}
            showTenant={false}
            onRevoke={onRevoke}
            onDelete={onDelete}
            revealedCodes={revealedCodes}
            revealingCodeId={revealingCodeId}
            onToggleReveal={onToggleReveal}
          />
        </>
      )}
    </section>
  );
}

function AuthorizationCodeForm({ form, setForm, generatedCode, onSubmit, onCancel, loading }: {
  form: typeof emptyCodeForm;
  setForm: (form: typeof emptyCodeForm) => void;
  generatedCode: string;
  onSubmit: (event: FormEvent) => void;
  onCancel: () => void;
  loading: boolean;
}) {
  return (
    <form className="form-panel modal-form" onSubmit={onSubmit}>
      <div className="form-grid compact-grid">
        <NumberField label="授权机器数" value={form.maxDevices} onChange={(maxDevices) => setForm({ ...form, maxDevices })} />
        <Field label="到期时间" type="datetime-local" value={form.expiresAt} onChange={(expiresAt) => setForm({ ...form, expiresAt })} />
        <Field label="备注" value={form.note} onChange={(note) => setForm({ ...form, note })} />
      </div>
      {generatedCode && (
        <div className="secret-box modal-result">
          <div className="secret-box-head"><span>新授权码 · 请妥善保存</span><CopyButton text={generatedCode} /></div>
          <strong>{generatedCode}</strong>
        </div>
      )}
      <div className="form-actions">
        <button type="button" className="secondary" onClick={onCancel} disabled={loading}>关闭</button>
        <button type="submit" disabled={loading}>{loading ? '生成中...' : generatedCode ? '再生成一个' : '生成授权码'}</button>
      </div>
    </form>
  );
}

function ActivationProbe({ form, setForm, result, onSubmit, onCancel, loading }: {
  form: typeof activationProbeShape;
  setForm: (form: typeof activationProbeShape) => void;
  result: string;
  onSubmit: (event: FormEvent) => void;
  onCancel: () => void;
  loading: boolean;
}) {
  return (
    <form className="form-panel modal-form" onSubmit={onSubmit}>
      <div className="form-grid">
        <Field label="公司名称" value={form.companyName} onChange={(companyName) => setForm({ ...form, companyName })} />
        <Field label="授权码" value={form.authorizationCode} onChange={(authorizationCode) => setForm({ ...form, authorizationCode })} />
        <Field label="机器指纹" value={form.fingerprint} onChange={(fingerprint) => setForm({ ...form, fingerprint })} />
        <Field label="设备名" value={form.deviceName} onChange={(deviceName) => setForm({ ...form, deviceName })} />
      </div>
      {result && <pre className="result-box modal-result">{result}</pre>}
      <div className="form-actions">
        <button type="button" className="secondary" onClick={onCancel} disabled={loading}>关闭</button>
        <button type="submit" disabled={loading}>{loading ? '测试中...' : '测试激活'}</button>
      </div>
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
    apiFormat: provider.apiFormat || inferApiFormat(provider.provider, provider.endpointPath),
    authType: provider.authType || (provider.provider === 'anthropic' ? 'api_key_header' : 'bearer'),
    authHeader: provider.authHeader || (provider.provider === 'anthropic' ? 'x-api-key' : 'authorization'),
    customHeaders: JSON.stringify(provider.customHeaders || {}, null, 2),
    queryParams: JSON.stringify(provider.queryParams || {}, null, 2),
    requestTimeoutMs: provider.requestTimeoutMs || 300000,
    maxRetries: provider.maxRetries ?? 2,
    enabled: provider.enabled,
  };
}

function providerPayload(form: typeof emptyProviderForm) {
  return {
    ...form,
    customHeaders: parseStringMap(form.customHeaders, '自定义 Headers'),
    queryParams: parseStringMap(form.queryParams, 'Query 参数'),
  };
}

function parseStringMap(value: string, label: string): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value || '{}');
  } catch {
    throw new Error(`${label} 必须是合法 JSON`);
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error(`${label} 必须是 JSON 对象`);
  }
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.some(([, item]) => typeof item !== 'string')) {
    throw new Error(`${label} 的值必须全部是字符串`);
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

function inferApiFormat(provider: string, endpointPath: string) {
  const path = endpointPath.toLowerCase().split('?')[0];
  if (provider === 'anthropic' || path.endsWith('/messages')) return 'anthropic_messages';
  if (provider === 'google' && path.includes(':generatecontent')) return 'gemini_generate_content';
  if (path.endsWith('/chat/completions')) return 'chat_completions';
  return 'responses';
}

function defaultContextWindowTokens(provider: string | undefined) {
  return provider === 'openai' || provider === 'cli-proxy' ? 258_000 : 64_000;
}

function verifiedModelLimits(...identifiers: string[]) {
  const identity = identifiers.join(' ').trim().toLowerCase();
  if (/glm-5[.-]2(?:-|\b)/.test(identity)) {
    return { contextWindowTokens: 1_048_576, maxOutputTokens: 131_072 };
  }
  if (/deepseek-v4-(?:pro|flash)(?:-|\b)/.test(identity)) {
    return { contextWindowTokens: 1_048_576, maxOutputTokens: 393_216 };
  }
  return null;
}

type VerifiedReasoningCapability = {
  supportedReasoningEfforts: string[];
  defaultReasoningEffort: string;
  description: string;
};

function verifiedReasoningCapability(
  provider: string,
  baseUrl: string,
  ...identifiers: string[]
): VerifiedReasoningCapability | null {
  const identity = identifiers.join(' ').trim().toLowerCase();
  const providerId = provider.trim().toLowerCase();
  const ark = providerId.startsWith('volcengine-ark') || baseUrl.toLowerCase().includes('ark.cn-beijing.volces.com');
  const capability = (supportedReasoningEfforts: string[], defaultReasoningEffort: string, description: string) => ({
    supportedReasoningEfforts,
    defaultReasoningEffort,
    description,
  });

  if (/deepseek-v4-(?:pro|flash)(?:-|\b)/.test(identity)) {
    if (ark) return capability(['low', 'medium', 'high'], 'high', '火山方舟公开推理强度契约');
    if (/deepseek-v4-flash(?:-|\b)/.test(identity)) {
      return capability(['none', 'low', 'high', 'max'], 'high', 'DeepSeek V4 Flash 原生有效强度');
    }
    return capability(['none', 'high', 'max'], 'high', 'DeepSeek V4 Pro 原生有效强度');
  }
  if (/glm-5[.-]2(?:-|\b)/.test(identity)) {
    if (ark) return capability(['low', 'medium', 'high'], 'high', '火山方舟公开推理强度契约');
    return capability(['none', 'high', 'max'], providerId === 'zhipu' ? 'max' : 'high', 'GLM-5.2 原生有效语义');
  }

  if (/gpt-5[.-]6(?:-(?:sol|terra|luna))?(?:-|\b)/.test(identity)) {
    return capability(['none', 'low', 'medium', 'high', 'xhigh', 'max'], 'medium', 'OpenAI GPT-5.6 官方模型能力');
  }
  if (/gpt-5[.-]5-pro(?:-|\b)/.test(identity)) {
    return capability(['medium', 'high', 'xhigh'], 'high', 'OpenAI GPT-5.5 Pro 官方模型能力');
  }
  if (/gpt-5[.-]4-pro(?:-|\b)/.test(identity)) {
    return capability(['medium', 'high', 'xhigh'], 'medium', 'OpenAI GPT-5.4 Pro 官方模型能力');
  }
  if (/gpt-5[.-]2-pro(?:-|\b)/.test(identity)) {
    return capability(['medium', 'high', 'xhigh'], 'medium', 'OpenAI GPT-5.2 Pro 官方模型能力');
  }
  if (/(?:^|\s)gpt-5-pro(?:-|\s|$)/.test(identity)) {
    return capability(['high'], 'high', 'OpenAI GPT-5 Pro 固定 high');
  }
  if (/gpt-5[.-][23]-codex(?:-|\b)/.test(identity)) {
    return capability(['low', 'medium', 'high', 'xhigh'], 'medium', 'OpenAI Codex 模型能力');
  }
  if (/gpt-5[.-]5(?:-|\b)/.test(identity)) {
    return capability(['none', 'low', 'medium', 'high', 'xhigh'], 'medium', 'OpenAI GPT-5.5 官方模型能力');
  }
  if (/gpt-5[.-](?:4|2)(?:-(?:mini|nano))?(?:-|\b)/.test(identity)) {
    return capability(['none', 'low', 'medium', 'high', 'xhigh'], 'none', 'OpenAI GPT-5.4/5.2 官方模型能力');
  }
  if (/gpt-5[.-]1(?:-|\b)/.test(identity)) {
    return capability(['none', 'low', 'medium', 'high'], 'none', 'OpenAI GPT-5.1 官方模型能力');
  }
  if (/(?:^|\s)gpt-5(?:-\d{4}-\d{2}-\d{2})?(?:\s|$)/.test(identity)) {
    return capability(['minimal', 'low', 'medium', 'high'], 'medium', 'OpenAI GPT-5 官方模型能力');
  }
  if (/(?:^|\s)(?:o1|o3|o4-mini)(?:-|\s|$)/.test(identity)) {
    return capability(['low', 'medium', 'high'], 'medium', 'OpenAI o 系列推理模型');
  }
  if (/gpt-(?:4[.-]1|4o)(?:-|\b)/.test(identity)) {
    return capability(['none'], 'none', '非推理模型，不发送 reasoning.effort');
  }

  if (/claude-(?:fable|mythos)-5(?:-|\b)|claude-(?:opus|sonnet)-5(?:-|\b)|claude-opus-4[.-](?:7|8)(?:-|\b)/.test(identity)) {
    const canDisable = !/claude-(?:fable|mythos)-5(?:-|\b)/.test(identity);
    return capability(
      [...(canDisable ? ['none'] : []), 'low', 'medium', 'high', 'xhigh', 'max'],
      'high',
      'Claude adaptive thinking + output_config.effort',
    );
  }
  if (/claude-mythos-preview(?:-|\b)|claude-(?:opus|sonnet)-4[.-]6(?:-|\b)/.test(identity)) {
    const canDisable = !/claude-mythos-preview(?:-|\b)/.test(identity);
    return capability(
      [...(canDisable ? ['none'] : []), 'low', 'medium', 'high', 'max'],
      'high',
      'Claude adaptive thinking + output_config.effort',
    );
  }
  if (/claude-opus-4[.-]5(?:-|\b)/.test(identity)) {
    return capability(['none', 'low', 'medium', 'high'], 'high', 'Claude 4.5 manual thinking 兼容映射');
  }
  if (/claude-(?:sonnet|haiku)-4[.-]5(?:-|\b)|claude-3[.-]7-sonnet(?:-|\b)/.test(identity)) {
    return capability(['none', 'high'], 'none', 'Claude manual thinking 开关');
  }
  if (/claude-3(?:-|\b)/.test(identity)) {
    return capability(['none'], 'none', 'Claude 非思考模型');
  }

  if (/gemini-3[.-]1-pro(?:-|\b)/.test(identity)) {
    return capability(['low', 'medium', 'high'], 'high', 'Gemini 3.1 Pro thinkingLevel');
  }
  if (/gemini-3-pro(?:-|\b)/.test(identity)) {
    return capability(['low', 'high'], 'high', 'Gemini 3 Pro thinkingLevel');
  }
  if (/gemini-3[.-]1-flash-lite-image(?:-|\b)/.test(identity)) {
    return capability(['minimal', 'high'], 'minimal', 'Gemini Flash-Lite Image thinkingLevel');
  }
  if (/gemini-3(?:[.-]\d+)?-(?:flash|flash-lite)(?:-|\b)/.test(identity)) {
    return capability(['minimal', 'low', 'medium', 'high'], /flash-lite/.test(identity) ? 'minimal' : 'medium', 'Gemini 3.x thinkingLevel');
  }
  if (/gemini-2[.-]5-pro(?:-|\b)/.test(identity)) {
    return capability(['minimal', 'low', 'medium', 'high'], 'medium', 'Gemini 2.5 Pro thinkingBudget 映射');
  }
  if (/gemini-2[.-]5-flash(?:-lite)?(?:-|\b)/.test(identity)) {
    return capability(['none', 'minimal', 'low', 'medium', 'high'], /flash-lite/.test(identity) ? 'none' : 'medium', 'Gemini 2.5 Flash thinkingBudget 映射');
  }

  if (/qwen3[.-]8-max(?:-|\b)/.test(identity)) {
    return capability(['none', 'low', 'medium', 'xhigh'], 'xhigh', 'Qwen3.8 Max 原生强度');
  }
  if (/qwq(?:-|\b)|qwen[^\s]*thinking/.test(identity)) {
    return capability(['high'], 'high', 'Qwen 固定思考模型');
  }
  if (/qwen3[.-](?:7|6|5)(?:-|\b)/.test(identity)) {
    return capability(['none', 'high'], 'high', 'Qwen 混合思考开关');
  }
  if (/qwen3(?:-|\b)/.test(identity)) {
    return capability(['none', 'high'], /qwen3-(?:max|plus|flash|turbo)/.test(identity) ? 'none' : 'high', 'Qwen 混合思考开关');
  }

  if (/kimi(?:\/|-)?kimi-k3(?:-|\b)|kimi-k3(?:-|\b)/.test(identity)) {
    return capability(['max'], 'max', 'Kimi K3 固定 max');
  }
  if (/kimi-k2[.-]7-code(?:-|\b)|kimi[^\s]*thinking/.test(identity)) {
    return capability(['high'], 'high', 'Kimi 固定思考模型');
  }
  if (/kimi-k2[.-](?:5|6)(?:-|\b)/.test(identity)) {
    return capability(['none', 'high'], providerId === 'moonshot' ? 'high' : 'none', 'Kimi 混合思考开关');
  }

  if (/doubao[^\s]*thinking/.test(identity)) {
    return capability(['high'], 'high', 'Doubao 固定思考模型');
  }
  if (/doubao-seed-1[.-]6-flash(?:-|\b)/.test(identity)) {
    return capability(['none', 'high'], 'high', 'Doubao 思考开关');
  }
  if (/doubao-seed-1[.-]6(?:-|\b)/.test(identity)) {
    return capability(['none', 'medium', 'high'], 'high', 'Doubao 关闭 / 自动 / 开启');
  }
  if (/doubao-seed(?:-|\b)/.test(identity)) {
    return capability(['none', 'high'], 'high', 'Doubao 保守思考开关');
  }

  return null;
}

function applyVerifiedModelCapabilities(form: typeof emptyModelForm): typeof emptyModelForm {
  const limits = verifiedModelLimits(form.modelId, form.upstreamModel);
  const reasoning = verifiedReasoningCapability(
    form.provider,
    form.baseUrl,
    form.modelId,
    form.upstreamModel,
  );
  return {
    ...form,
    ...(limits || {}),
    ...(reasoning ? {
      supportedReasoningEfforts: reasoning.supportedReasoningEfforts,
      defaultReasoningEffort: reasoning.defaultReasoningEffort,
    } : {}),
  };
}

function modelFormForProvider(provider?: Pick<ProviderConfig, 'provider' | 'baseUrl' | 'endpointPath'> | null): typeof emptyModelForm {
  return {
    ...emptyModelForm,
    provider: provider?.provider || '',
    baseUrl: provider?.baseUrl || '',
    endpointPath: provider?.endpointPath || emptyModelForm.endpointPath,
    contextWindowTokens: defaultContextWindowTokens(provider?.provider),
  };
}

function modelFormFromRoute(model: ModelRoute): typeof emptyModelForm {
  return applyVerifiedModelCapabilities({
    id: model.id,
    modelId: model.modelId,
    label: model.label,
    provider: model.provider,
    mode: model.mode,
    baseUrl: model.baseUrl,
    endpointPath: model.endpointPath,
    upstreamModel: model.upstreamModel,
    contextWindowTokens: model.contextWindowTokens,
    maxOutputTokens: model.maxOutputTokens,
    supportedReasoningEfforts: model.supportedReasoningEfforts,
    defaultReasoningEffort: model.defaultReasoningEffort,
    fastModeSupported: model.fastModeSupported,
    enabled: model.enabled,
    sortOrder: model.sortOrder,
    inputYuanPerMillion: model.inputYuanPerMillion,
    outputYuanPerMillion: model.outputYuanPerMillion,
    reasoningYuanPerMillion: model.reasoningYuanPerMillion,
    cachedInputYuanPerMillion: model.cachedInputYuanPerMillion,
    priceMultiplier: priceMultiplierFromMarkupBps(model.markupBps),
  });
}

function codexFormFromAccount(account: CodexAccount): typeof emptyCodexForm {
  return {
    id: account.id,
    tenantIds: codexAccountTenantIds(account),
    email: account.email,
    loginSecret: '',
    loginHint: account.loginHint,
    plan: account.plan,
    status: account.status,
    seatLimit: account.seatLimit,
    expiresAt: toLocalInput(account.expiresAt),
  };
}

function codexAccountTenantIds(account: CodexAccount): string[] {
  return account.tenantIds?.length ? account.tenantIds : account.tenantId ? [account.tenantId] : [];
}

function codexAccountTenantNames(account: CodexAccount): string[] {
  return account.tenantNames?.length ? account.tenantNames : account.tenantName ? [account.tenantName] : [];
}

function selectExistingTenantId(tenants: Tenant[], tenantId: string) {
  if (tenantId && tenants.some((tenant) => tenant.id === tenantId)) return tenantId;
  return tenants[0]?.id || '';
}

function GatewayWorkspace({
  providers,
  models,
  selectedProvider,
  selectedProviderModels,
  onSelectProvider,
  onEditProvider,
  onDeleteProvider,
  onCreateModel,
  onEditModel,
  onDeleteModel,
}: {
  providers: ProviderConfig[];
  models: ModelRoute[];
  selectedProvider: ProviderConfig | null;
  selectedProviderModels: ModelRoute[];
  onSelectProvider: (provider: ProviderConfig) => void;
  onEditProvider: (provider: ProviderConfig) => void;
  onDeleteProvider: (provider: ProviderConfig) => void;
  onCreateModel: () => void;
  onEditModel: (model: ModelRoute) => void;
  onDeleteModel: (model: ModelRoute) => void;
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
        </div>
        <div className="provider-tree">
          {providers.length === 0 ? (
            <div className="empty"><strong>暂无供应商</strong><span>点击页面右上角“新增供应商”开始接入。</span></div>
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
                <small>{provider.enabled ? (provider.authType === 'none' ? '免鉴权' : provider.keyConfigured ? provider.keyMask : '未配置 key') : '已停用'}</small>
              </button>
            );
          })}
        </div>
      </section>

      <section className="panel gateway-detail-panel">
        <div className="panel-head gateway-panel-head">
          <div>
            <h2>{selectedProvider ? `${selectedProvider.label} 模型` : '模型'}</h2>
            <span>{selectedProvider ? `${selectedProvider.provider} 下 ${selectedProviderModels.length} 个模型` : '请先选择供应商'}</span>
          </div>
          <div className="head-actions">
            {selectedProvider && <button className="secondary" type="button" onClick={() => onEditProvider(selectedProvider)}>编辑供应商</button>}
            {selectedProvider && <button className="secondary danger" type="button" onClick={() => onDeleteProvider(selectedProvider)}>删除供应商</button>}
            <button type="button" onClick={onCreateModel} disabled={!selectedProvider}>新增模型</button>
          </div>
        </div>
        {selectedProvider ? (
          <>
            <div className="provider-summary-grid">
              <div className="provider-summary-item endpoint">
                <span>请求地址</span>
                <strong title={`${selectedProvider.baseUrl}${selectedProvider.endpointPath}`}>{selectedProvider.baseUrl}{selectedProvider.endpointPath}</strong>
              </div>
              <div className="provider-summary-item">
                <span>上游协议</span>
                <strong>{selectedProvider.apiFormat || inferApiFormat(selectedProvider.provider, selectedProvider.endpointPath)}</strong>
              </div>
              <div className="provider-summary-item">
                <span>鉴权状态</span>
                <strong>{selectedProvider.authType === 'none' ? '免鉴权' : selectedProvider.keyConfigured ? '密钥已配置' : '密钥未配置'}</strong>
              </div>
              <div className="provider-summary-item status-item">
                <span>服务状态</span>
                <Status value={selectedProvider.enabled ? 'active' : 'disabled'} />
              </div>
            </div>
            <div className="panel-subhead model-list-head">
              <div><h3>模型路由</h3><span>价格为每百万 Tokens 的上游成本与用户结算价</span></div>
              <span>{selectedProviderModels.length} 个</span>
            </div>
            <ModelTable models={selectedProviderModels} onEdit={onEditModel} onDelete={onDeleteModel} />
          </>
        ) : (
          <div className="empty">
            <strong>尚未配置供应商</strong>
            <span>新增供应商后，可继续配置模型路由和计费价格。</span>
          </div>
        )}
      </section>
    </div>
  );
}

function CodexWorkspace({
  accounts,
  onEdit,
  onDelete,
  onSetStatus,
}: {
  accounts: CodexAccount[];
  onEdit: (form: typeof emptyCodexForm) => void;
  onDelete: (account: CodexAccount) => void;
  onSetStatus: (account: CodexAccount, status: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const normalizedQuery = query.trim().toLowerCase();
  const filteredAccounts = accounts.filter((account) => {
    const matchesStatus = status === 'all' || account.status === status;
    const haystack = [
      account.email,
      ...codexAccountTenantNames(account),
      account.loginHint,
      account.plan,
      account.id,
    ].join(' ').toLowerCase();
    return matchesStatus && (!normalizedQuery || haystack.includes(normalizedQuery));
  });
  const activeCount = accounts.filter((account) => account.status === 'active').length;
  const assignedCount = accounts.filter((account) => codexAccountTenantIds(account).length > 0).length;

  return (
    <div className="page-stack">
      <section className="panel management-list">
        <div className="panel-head">
          <div>
            <h2>GPT 账号池</h2>
            <span>{accounts.length} 个账号，{activeCount} 个可用，{assignedCount} 个已分配</span>
          </div>
        </div>
        <div className="stat-strip">
          <div className="mini-stat"><span>可用</span><strong>{activeCount}</strong></div>
          <div className="mini-stat"><span>未分配</span><strong>{accounts.length - assignedCount}</strong></div>
          <div className="mini-stat"><span>停用</span><strong>{accounts.filter((account) => account.status !== 'active').length}</strong></div>
        </div>
        <div className="workspace-toolbar">
          <input
            aria-label="搜索 GPT 账号"
            className="toolbar-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索邮箱、客户或登录提示"
          />
          <select
            aria-label="筛选 GPT 状态"
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
    </div>
  );
}

function SkillReleaseWorkspace({
  releases,
  bundleFile,
  loading,
  onBundleFileChange,
  onUpload,
  onPublish,
  onDelete,
}: {
  releases: SkillRelease[];
  bundleFile: File | null;
  loading: boolean;
  onBundleFileChange: (file: File | null) => void;
  onUpload: (event: FormEvent) => void;
  onPublish: (release: SkillRelease) => void;
  onDelete: (release: SkillRelease) => void;
}) {
  const channelOrder = new Map([['stable', 0], ['beta', 1], ['dev', 2]]);
  const published = releases
    .filter((release) => release.status === 'published')
    .sort((left, right) => (channelOrder.get(left.channel) ?? 99) - (channelOrder.get(right.channel) ?? 99));
  return (
    <div className="page-stack skill-release-workspace">
      <section className="panel skill-upload-panel">
        <div className="panel-head">
          <div>
            <h2>上传受保护发行包</h2>
            <span>源码留在 Git；后台只保存构建生成、仍处于 AES-GCM 编码状态的 .asb.json 产物</span>
          </div>
        </div>
        <form className="skill-upload-form" onSubmit={onUpload}>
          <label>
            Skill 发行包
            <input
              key={bundleFile?.name || 'empty-skill-bundle'}
              type="file"
              accept=".json,.asb.json,application/json"
              onChange={(event) => onBundleFileChange(event.target.files?.[0] || null)}
            />
          </label>
          <div className="skill-upload-copy">
            <strong>{bundleFile?.name || '尚未选择发行包'}</strong>
            <span>{bundleFile ? formatBytes(bundleFile.size) : '在 alpha_studio 仓库根目录运行：npm run skills:release -- --version=x.y.z（无需指定 skills/）'}</span>
          </div>
          <button type="submit" disabled={loading || !bundleFile}>上传为草稿</button>
        </form>
        <div className="skill-security-note">
          <strong>保护链路保持不变</strong>
          <span>后台拒绝明文或伪装文件；客户端只有在 SHA-256、.asx 认证、路径与受保护清单全部通过后才切换版本。</span>
        </div>
      </section>
      <section className="panel current-skill-releases" aria-label="当前已发布 Skills">
        <div className="panel-head">
          <div>
            <h2>当前已发布内容</h2>
            <span>官方 Skills 按渠道整包发布、整包更新和整包回滚</span>
          </div>
        </div>
        {published.length === 0 ? (
          <div className="empty compact-empty">
            <strong>当前没有已发布的 Skill 版本</strong>
            <span>草稿发布后，这里会按渠道列出完整 Skill 清单。</span>
          </div>
        ) : (
          <div className="current-skill-release-grid">
            {published.map((release) => {
              const names = release.manifestSummary?.skills?.map((skill) => skill.skillName) || [];
              return (
                <article className="current-skill-release-card" key={release.id}>
                  <div className="current-skill-release-head">
                    <div>
                      <strong>{release.channel}</strong>
                      <span>当前版本 {release.version}</span>
                    </div>
                    <Status value={release.status} />
                  </div>
                  <div className="current-skill-release-meta">
                    <strong>{release.skillCount} 个官方 Skills</strong>
                    <span>{release.encodedFileCount} 个受保护文件 · 客户端 ≥ {release.minClientVersion}</span>
                  </div>
                  {names.length > 0 ? (
                    <div className="current-skill-list" aria-label={`${release.channel} 当前 Skill 清单`}>
                      {names.map((name) => <code key={name}>{name}</code>)}
                    </div>
                  ) : (
                    <span className="current-skill-list-missing">该历史记录没有可展示的 Skill 清单</span>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
      <section className="panel management-list">
        <div className="panel-head">
          <div>
            <h2>发行历史</h2>
            <span>{releases.length} 个不可变版本 · {published.length} 个渠道当前已发布</span>
          </div>
        </div>
        {releases.length === 0 ? (
          <div className="empty">
            <strong>暂无 Skill 发行版本</strong>
            <span>上传发行包后先作为草稿保存，确认后再发布到对应渠道。</span>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="skill-release-table">
              <thead><tr><th>版本</th><th>渠道 / 状态</th><th>内容</th><th>兼容性</th><th>产物校验</th><th>时间</th><th className="col-actions">操作</th></tr></thead>
              <tbody>
                {releases.map((release) => {
                  const names = release.manifestSummary?.skills?.map((skill) => skill.skillName) || [];
                  return (
                    <tr key={release.id}>
                      <td><strong>{release.version}</strong><span>{release.id}</span></td>
                      <td><strong>{release.channel}</strong><Status value={release.status} /></td>
                      <td><strong>{release.skillCount} Skills · {release.encodedFileCount} 文件</strong><span>{names.join('、') || release.releaseNotes || '-'}</span></td>
                      <td><strong>客户端 ≥ {release.minClientVersion}</strong><span>codec v{release.codecVersion}</span></td>
                      <td><code>{release.artifactSha256.slice(0, 16)}…</code><span>{formatBytes(release.artifactSize)}</span></td>
                      <td><strong>{new Date(release.publishedAt || release.createdAt).toLocaleString()}</strong><span>{release.publishedAt ? '发布时间' : '创建时间'}</span></td>
                      <td className="col-actions">
                        <div className="table-actions">
                          {release.status !== 'published' && (
                            <button type="button" onClick={() => onPublish(release)}>{release.status === 'archived' ? '回滚到此版本' : '发布'}</button>
                          )}
                          {release.status !== 'published' && (
                            <button className="danger" type="button" onClick={() => onDelete(release)}>删除</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function ProviderForm({ form, setForm, selectedProvider, selectedModelCount, onSubmit, onDiscoverModels, onCancel, loading }: {
  form: typeof emptyProviderForm;
  setForm: (form: typeof emptyProviderForm) => void;
  selectedProvider: ProviderConfig | null;
  selectedModelCount: number;
  onSubmit: (event: FormEvent) => void;
  onDiscoverModels: () => void;
  onCancel: () => void;
  loading: boolean;
}) {
  return (
    <form className="form-panel modal-form" onSubmit={onSubmit}>
      <div className="modal-context">{selectedProvider ? `${selectedModelCount} 个模型挂在此供应商下` : '保存后可在其下新增模型'}</div>
      <div className="form-grid">
        <label>
          供应商预设
          <select
            value=""
            onChange={(event) => {
              const preset = providerPresets.find((item) => item.id === event.target.value);
              if (preset) setForm({ ...form, ...preset.config });
            }}
          >
            <option value="">选择后自动填充</option>
            {providerPresets.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
          </select>
        </label>
        <Field label="Provider ID" value={form.provider} onChange={(provider) => setForm({ ...form, provider })} required />
        <Field label="显示名称" value={form.label} onChange={(label) => setForm({ ...form, label })} required />
        <Field label="Base URL" value={form.baseUrl} onChange={(baseUrl) => setForm({ ...form, baseUrl })} required />
        <Field label="Endpoint Path" value={form.endpointPath} onChange={(endpointPath) => setForm({ ...form, endpointPath })} />
        <Select label="上游协议" value={form.apiFormat} onChange={(apiFormat) => setForm({ ...form, apiFormat })} options={['auto', 'responses', 'chat_completions', 'anthropic_messages', 'gemini_generate_content']} optionLabels={{ auto: '自动识别', responses: 'OpenAI Responses', chat_completions: 'OpenAI Chat Completions', anthropic_messages: 'Anthropic Messages', gemini_generate_content: 'Gemini generateContent' }} />
        <Select label="鉴权方式" value={form.authType} onChange={(authType) => setForm({ ...form, authType })} options={['bearer', 'api_key_header', 'query_param', 'none']} optionLabels={{ bearer: 'Authorization: Bearer', api_key_header: 'API Key Header', query_param: 'Query 参数', none: '免鉴权' }} />
        <Field label="鉴权 Header / Query 名" value={form.authHeader} onChange={(authHeader) => setForm({ ...form, authHeader })} placeholder="authorization / x-api-key / key" />
        <Field label="API Key" type="password" value={form.apiKey} onChange={(apiKey) => setForm({ ...form, apiKey })} placeholder="留空则保留原 key" />
        <TextArea label="自定义 Headers（JSON）" value={form.customHeaders} onChange={(customHeaders) => setForm({ ...form, customHeaders })} placeholder='{"HTTP-Referer":"https://example.com"}' />
        <TextArea label="Query 参数（JSON）" value={form.queryParams} onChange={(queryParams) => setForm({ ...form, queryParams })} placeholder='{"api-version":"2025-04-01-preview"}' />
        <NumberField label="请求超时 ms" value={form.requestTimeoutMs} min={1000} step={1000} onChange={(requestTimeoutMs) => setForm({ ...form, requestTimeoutMs })} />
        <NumberField label="自动重试次数" value={form.maxRetries} min={0} step={1} onChange={(maxRetries) => setForm({ ...form, maxRetries })} />
        <label className="check-row">
          <input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} />
          启用供应商
        </label>
      </div>
      <div className="form-actions">
        <button type="button" className="secondary" onClick={onCancel} disabled={loading}>取消</button>
        <button type="button" className="secondary" disabled={loading || !form.baseUrl || (form.authType !== 'none' && !form.apiKey && !selectedProvider?.keyConfigured)} onClick={onDiscoverModels}>获取模型</button>
        <button type="submit" disabled={loading}>保存供应商</button>
      </div>
    </form>
  );
}

function ModelForm({ form, setForm, providers, onProviderChange, onSubmit, discoveredModels, onCancel, loading }: {
  form: typeof emptyModelForm;
  setForm: (form: typeof emptyModelForm) => void;
  providers: ProviderConfig[];
  onProviderChange: (providerId: string) => void;
  onSubmit: (event: FormEvent) => void;
  discoveredModels: DiscoveredModel[];
  onCancel: () => void;
  loading: boolean;
}) {
  const providerOptions = providers.some((provider) => provider.provider === form.provider)
    ? providers.map((provider) => provider.provider)
    : [form.provider, ...providers.map((provider) => provider.provider)].filter(Boolean);
  const verifiedReasoning = verifiedReasoningCapability(
    form.provider,
    form.baseUrl,
    form.modelId,
    form.upstreamModel,
  );
  const availableReasoningEfforts = verifiedReasoning?.supportedReasoningEfforts || reasoningEffortOptions;

  return (
    <form className="form-panel modal-form" onSubmit={onSubmit}>
      <div className="form-grid">
        {discoveredModels.length > 0 && (
          <label>
            已发现模型（{discoveredModels.length}）
            <select
              value=""
              onChange={(event) => {
                const model = discoveredModels.find((item) => item.id === event.target.value);
                if (model) setForm(applyVerifiedModelCapabilities({ ...form, modelId: model.id, upstreamModel: model.id, label: model.label }));
              }}
            >
              <option value="">选择模型并自动填充</option>
              {discoveredModels.map((model) => <option key={model.id} value={model.id}>{model.label} · {model.id}</option>)}
            </select>
          </label>
        )}
        <Field label="模型 ID" value={form.modelId} onChange={(modelId) => setForm(applyVerifiedModelCapabilities({ ...form, modelId }))} required />
        <Field label="显示名称" value={form.label} onChange={(label) => setForm({ ...form, label })} required />
        <Select label="供应商" value={form.provider} onChange={onProviderChange} options={providerOptions} />
        <Field label="上游模型名" value={form.upstreamModel} onChange={(upstreamModel) => setForm(applyVerifiedModelCapabilities({ ...form, upstreamModel }))} required />
        <Field label="Base URL" value={form.baseUrl} onChange={(baseUrl) => setForm({ ...form, baseUrl })} />
        <Field label="Endpoint Path" value={form.endpointPath} onChange={(endpointPath) => setForm({ ...form, endpointPath })} />
        <NumberField label="上下文窗口 tokens" value={form.contextWindowTokens} min={16_000} max={2_000_000} step={1} title="桌面端会根据该窗口管理上下文；自定义上游约在 90% 时提前压缩历史" onChange={(contextWindowTokens) => setForm({ ...form, contextWindowTokens })} />
        <NumberField label="最大回答 tokens" value={form.maxOutputTokens} min={1_000} max={1_000_000} step={1} title="用于限制上游回答并计算足以容纳完整请求的单次任务安全预算" onChange={(maxOutputTokens) => setForm({ ...form, maxOutputTokens })} />
        <div className="field-wide capability-field">
          <span>支持思考强度</span>
          <div className="capability-checks">
            {availableReasoningEfforts.map((effort) => (
              <label key={effort}>
                <input
                  type="checkbox"
                  aria-label={`思考强度 ${effort}`}
                  checked={form.supportedReasoningEfforts.includes(effort)}
                  disabled={Boolean(verifiedReasoning)}
                  onChange={(event) => {
                    const supportedReasoningEfforts = event.target.checked
                      ? [...form.supportedReasoningEfforts, effort]
                      : form.supportedReasoningEfforts.filter((item) => item !== effort);
                    const defaultReasoningEffort = supportedReasoningEfforts.includes(form.defaultReasoningEffort)
                      ? form.defaultReasoningEffort
                      : supportedReasoningEfforts[0] || '';
                    setForm({ ...form, supportedReasoningEfforts, defaultReasoningEffort });
                  }}
                />
                {reasoningEffortLabels[effort] || effort} <small>{effort}</small>
              </label>
            ))}
          </div>
          <small>
            {verifiedReasoning
              ? `已按${verifiedReasoning.description}锁定；网关会转换成该供应商的真实参数。`
              : '未识别的自定义模型可手动配置；只选择上游官方明确支持的值。'}
          </small>
        </div>
        <Select label="默认思考强度" value={form.defaultReasoningEffort} onChange={(defaultReasoningEffort) => setForm({ ...form, defaultReasoningEffort })} options={form.supportedReasoningEfforts} optionLabels={reasoningEffortLabels} />
        <NumberField label="排序" value={form.sortOrder} onChange={(sortOrder) => setForm({ ...form, sortOrder })} />
        <NumberField label="输入 元/百万" value={form.inputYuanPerMillion} min={0} step="any" onChange={(inputYuanPerMillion) => setForm({ ...form, inputYuanPerMillion })} />
        <NumberField label="输出 元/百万" value={form.outputYuanPerMillion} min={0} step="any" onChange={(outputYuanPerMillion) => setForm({ ...form, outputYuanPerMillion })} />
        <NumberField label="推理 元/百万" value={form.reasoningYuanPerMillion} min={0} step="any" onChange={(reasoningYuanPerMillion) => setForm({ ...form, reasoningYuanPerMillion })} />
        <NumberField label="缓存输入 元/百万" value={form.cachedInputYuanPerMillion} min={0} step="any" onChange={(cachedInputYuanPerMillion) => setForm({ ...form, cachedInputYuanPerMillion })} />
        <NumberField label="用户价格倍率" value={form.priceMultiplier} min={1} step={0.01} title="用户结算单价 = 上游成本单价 × 倍率；1.25 表示加价 25%" onChange={(priceMultiplier) => setForm({ ...form, priceMultiplier })} />
        <div className="field-wide price-multiplier-preview">
          <span>倍率后用户单价</span>
          <strong>
            输入 {formatYuanPerMillion(userPrice(form.inputYuanPerMillion, form.priceMultiplier))}
            {' · '}输出 {formatYuanPerMillion(userPrice(form.outputYuanPerMillion, form.priceMultiplier))}
            {' · '}缓存输入 {formatYuanPerMillion(userPrice(form.cachedInputYuanPerMillion, form.priceMultiplier))}
          </strong>
          <small>实际用量结算由服务端按 ×{formatPriceMultiplier(form.priceMultiplier)} 计算。</small>
        </div>
        <label className="check-row">
          <input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} />
          启用模型
        </label>
        <label className="check-row">
          <input type="checkbox" checked={form.fastModeSupported} onChange={(event) => setForm({ ...form, fastModeSupported: event.target.checked })} />
          支持 Fast 模式
        </label>
      </div>
      <div className="form-actions">
        <button type="button" className="secondary" onClick={onCancel} disabled={loading}>取消</button>
        <button type="submit" disabled={loading || providers.length === 0 || form.supportedReasoningEfforts.length === 0}>保存模型</button>
      </div>
    </form>
  );
}

function TenantPicker({ tenants, selected, onChange }: {
  tenants: Tenant[];
  selected: string[];
  onChange: (tenantIds: string[]) => void;
}) {
  const toggle = (tenantId: string) => {
    onChange(selected.includes(tenantId)
      ? selected.filter((id) => id !== tenantId)
      : [...selected, tenantId]);
  };

  return (
    <div className="field-wide tenant-picker-field">
      <div className="tenant-picker-head">
        <span>分配客户</span>
        {selected.length > 0 && (
          <button type="button" className="linklike" onClick={() => onChange([])}>清空（{selected.length}）</button>
        )}
      </div>
      {tenants.length === 0 ? (
        <div className="tenant-picker-empty">暂无客户，先在「客户」页创建后再分配。</div>
      ) : (
        <div className="tenant-picker" role="group" aria-label="分配客户">
          {tenants.map((tenant) => {
            const active = selected.includes(tenant.id);
            return (
              <button
                type="button"
                key={tenant.id}
                className={active ? 'tenant-chip active' : 'tenant-chip'}
                aria-pressed={active}
                onClick={() => toggle(tenant.id)}
              >
                <span className="tenant-chip-check" aria-hidden="true">
                  {active ? (
                    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m5 10.5 3.2 3.2L15 6.5" /></svg>
                  ) : null}
                </span>
                {tenant.name}
              </button>
            );
          })}
        </div>
      )}
      <small>可多选，不选择表示暂不分配给任何客户。</small>
    </div>
  );
}

function CodexAccountForm({ form, setForm, tenants, onSubmit, onCancel, loading }: {
  form: typeof emptyCodexForm;
  setForm: (form: typeof emptyCodexForm) => void;
  tenants: Tenant[];
  onSubmit: (event: FormEvent) => void;
  onCancel: () => void;
  loading: boolean;
}) {
  return (
    <form className="form-panel modal-form" onSubmit={onSubmit}>
      <div className="form-grid">
        <Field label="GPT 登录邮箱" value={form.email} onChange={(email) => setForm({ ...form, email })} />
        <Field label="登录提示" value={form.loginHint} onChange={(loginHint) => setForm({ ...form, loginHint })} />
        <Field label="登录凭据/一次性说明" type="password" value={form.loginSecret} onChange={(loginSecret) => setForm({ ...form, loginSecret })} placeholder="留空保留原值" />
        <Select label="套餐" value={form.plan} onChange={(plan) => setForm({ ...form, plan })} options={['monthly', 'yearly']} optionLabels={{ monthly: '按月', yearly: '按年' }} />
        <Select label="状态" value={form.status} onChange={(status) => setForm({ ...form, status })} options={['active', 'suspended']} optionLabels={{ active: '启用', suspended: '停用' }} />
        <NumberField label="席位数" value={form.seatLimit} onChange={(seatLimit) => setForm({ ...form, seatLimit })} />
        <Field label="到期时间" type="datetime-local" value={form.expiresAt} onChange={(expiresAt) => setForm({ ...form, expiresAt })} />
        <TenantPicker
          tenants={tenants}
          selected={form.tenantIds}
          onChange={(tenantIds) => setForm({ ...form, tenantIds })}
        />
      </div>
      <div className="form-actions">
        <button type="button" className="secondary" onClick={onCancel} disabled={loading}>取消</button>
        <button type="submit" disabled={loading}>保存账号</button>
      </div>
    </form>
  );
}

function TenantTable({ tenants, onEdit, onDelete, onManageCodes, selectedTenantId }: {
  tenants: Tenant[];
  onEdit: (form: typeof emptyTenantForm) => void;
  onDelete?: (tenant: Tenant) => void;
  onManageCodes?: (tenant: Tenant) => void;
  selectedTenantId?: string;
}) {
  if (tenants.length === 0) return <div className="empty"><strong>暂无客户</strong><span>点击页面右上角“新增客户”创建第一条记录。</span></div>;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>客户</th><th>设备</th><th>余额</th><th>GPT</th><th>状态</th><th className="col-actions" /></tr></thead>
        <tbody>
          {tenants.map((tenant) => (
            <tr className={tenant.id === selectedTenantId ? 'selected-row' : ''} key={tenant.id}>
              <td><strong>{tenant.name}</strong><span>{tenant.id}</span></td>
              <td className="nowrap">{tenant.activeDevices}/{tenant.maxDevices}</td>
              <td className="nowrap">{formatYuan(tenant.balanceYuan)}</td>
              <td className="nowrap">{tenant.codexSubscriptionEnabled
                ? <><PlanBadge plan={tenant.codexSubscriptionPlan || 'monthly'} /><span>{formatDate(tenant.codexSubscriptionExpiresAt)}</span></>
                : <span className="cell-muted">未启用</span>}</td>
              <td><Status value={tenant.status} /></td>
              <td className="col-actions">
                <div className="table-actions">
                  {onManageCodes && (
                    <button className="secondary" type="button" onClick={() => onManageCodes(tenant)}>授权码</button>
                  )}
                  <button className="secondary" type="button" onClick={() => onEdit({
                    id: tenant.id,
                    name: tenant.name,
                    status: tenant.status,
                    maxDevices: tenant.maxDevices,
                    billingMode: tenant.billingMode,
                    subscriptionPlan: tenant.subscriptionPlan || '',
                    subscriptionExpiresAt: toLocalInput(tenant.subscriptionExpiresAt),
                    codexSubscriptionEnabled: tenant.codexSubscriptionEnabled,
                    codexSubscriptionPlan: tenant.codexSubscriptionPlan || 'monthly',
                    codexSubscriptionExpiresAt: toLocalInput(tenant.codexSubscriptionExpiresAt),
                  })}>编辑</button>
                  {onDelete && (
                    <button className="secondary danger" type="button" onClick={() => onDelete(tenant)}>删除</button>
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

function TenantUsageWorkspace({
  tenants,
  selectedTenantId,
  summary,
  reconciliation,
  loading,
  error,
  onSelectTenant,
  onPageChange,
  onRecordOfflinePayment,
  onCorrectOfflinePayment,
  onRefreshReconciliation,
}: {
  tenants: Tenant[];
  selectedTenantId: string;
  summary: TenantBillingSummary | null;
  reconciliation: BillingReconciliation | null;
  loading: boolean;
  error: string;
  onSelectTenant: (tenantId: string) => void;
  onPageChange: (page: number) => void;
  onRecordOfflinePayment: (input: { amountYuan: number; reference: string; note: string; receivedAt: string }) => Promise<void>;
  onCorrectOfflinePayment: (paymentId: string, note: string) => Promise<void>;
  onRefreshReconciliation: () => void;
}) {
  const currentMonth = summary?.usage.currentMonth;
  const allTime = summary?.usage.allTime;
  const models = summary?.usage.models ?? [];
  const ledger = summary?.usage.recentLedger ?? [];
  const offlinePayments = summary?.usage.offlinePayments ?? [];
  const pagination = summary?.usage.ledgerPagination;
  const showingSelectedTenant = summary?.tenant.id === selectedTenantId;
  const tenantReconciliation = reconciliation?.tenants.find((tenant) => tenant.tenantId === selectedTenantId);
  const [paymentForm, setPaymentForm] = useState({ amountYuan: '', reference: '', note: '', receivedAt: '' });
  const [correction, setCorrection] = useState({ paymentId: '', note: '' });

  const submitOfflinePayment = async (event: FormEvent) => {
    event.preventDefault();
    const amountYuan = Number(paymentForm.amountYuan);
    if (!Number.isFinite(amountYuan) || amountYuan <= 0 || !paymentForm.reference.trim()) return;
    await onRecordOfflinePayment({
      amountYuan,
      reference: paymentForm.reference.trim(),
      note: paymentForm.note.trim(),
      receivedAt: paymentForm.receivedAt,
    });
    setPaymentForm({ amountYuan: '', reference: '', note: '', receivedAt: '' });
  };

  const submitCorrection = async (event: FormEvent) => {
    event.preventDefault();
    if (!correction.paymentId || correction.note.trim().length < 3) return;
    await onCorrectOfflinePayment(correction.paymentId, correction.note.trim());
    setCorrection({ paymentId: '', note: '' });
  };

  return (
    <div className="usage-workspace">
      <section className="panel usage-summary-panel">
        <div className="panel-head usage-panel-head">
          <div>
            <h2>客户 LLM 用量</h2>
            <span>{summary ? `${formatMonth(summary.period.currentMonthStart)}账期 · 更新于 ${formatDate(summary.period.generatedAt)}` : '选择客户查看模型调用、Tokens、费用和账单流水'}</span>
          </div>
          <label className="usage-tenant-select">
            <span>客户</span>
            <select value={selectedTenantId} onChange={(event) => onSelectTenant(event.target.value)} aria-label="用量客户">
              {tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}
            </select>
          </label>
        </div>
        {tenants.length === 0 ? (
          <div className="empty">暂无客户，请先创建客户。</div>
        ) : error ? (
          <div className="usage-error">{error}</div>
        ) : loading && !showingSelectedTenant ? (
          <div className="empty">正在加载用量数据…</div>
        ) : summary && showingSelectedTenant ? (
          <>
            <div className="usage-metric-grid">
              <UsageMetric label="本月费用" value={formatYuan(currentMonth?.billableYuan ?? 0)} meta={`${formatWholeNumber(currentMonth?.runCount ?? 0)} 次调用`} />
              <UsageMetric label="本月 Tokens" value={formatWholeNumber(currentMonth?.totalTokens ?? 0)} meta={formatUsageBreakdown(currentMonth)} />
              <UsageMetric label="账户余额" value={formatYuan(summary.tenant.balanceYuan)} meta={formatBillingMode(summary.tenant.billingMode)} />
              <UsageMetric label="累计费用" value={formatYuan(allTime?.billableYuan ?? 0)} meta={`累计 ${formatWholeNumber(allTime?.runCount ?? 0)} 次调用`} />
            </div>
            <div className="usage-detail-strip">
              <span><strong>客户</strong>{summary.tenant.name}</span>
              <span><strong>状态</strong><Status value={summary.tenant.status} /></span>
              <span><strong>最近使用</strong>{formatDate(currentMonth?.lastUsedAt || allTime?.lastUsedAt)}</span>
            </div>
          </>
        ) : (
          <div className="empty">正在加载用量数据…</div>
        )}
      </section>

      {summary && showingSelectedTenant && (
        <>
          <section className="panel offline-payment-panel">
            <div className="panel-head">
              <div><h2>线下收款登记</h2><span>这里只记录已经在线下收到的款项，不发起支付、扣款或退款</span></div>
              <button className="secondary" type="button" onClick={onRefreshReconciliation}>刷新对账</button>
            </div>
            <div className={`reconciliation-strip ${tenantReconciliation?.requiresReview ? 'warning' : 'balanced'}`}>
              <span><strong>对账状态</strong>{tenantReconciliation?.requiresReview ? '需要核对' : '一致'}</span>
              <span><strong>当前余额</strong>{formatYuan(tenantReconciliation?.storedBalanceYuan ?? summary.tenant.balanceYuan)}</span>
              <span><strong>账本余额</strong>{formatYuan(tenantReconciliation?.ledgerBalanceYuan ?? 0)}</span>
              <span><strong>24h Tokens / 用量待核对</strong>{formatWholeNumber(tenantReconciliation?.totalTokens24h ?? 0)} / {formatWholeNumber(tenantReconciliation?.unverifiedUsageEvents24h ?? 0)}</span>
            </div>
            <form className="offline-payment-form" onSubmit={(event) => void submitOfflinePayment(event)}>
              <NumberField label="实收金额 元" value={Number(paymentForm.amountYuan || 0)} min={0.000001} step={0.000001} onChange={(amountYuan) => setPaymentForm({ ...paymentForm, amountYuan: String(amountYuan) })} />
              <Field label="线下凭证号" value={paymentForm.reference} onChange={(reference) => setPaymentForm({ ...paymentForm, reference })} placeholder="银行流水号/收据号/合同编号" required />
              <Field label="收款时间" type="datetime-local" value={paymentForm.receivedAt} onChange={(receivedAt) => setPaymentForm({ ...paymentForm, receivedAt })} />
              <Field label="备注" value={paymentForm.note} onChange={(note) => setPaymentForm({ ...paymentForm, note })} placeholder="可选" />
              <button type="submit" disabled={loading || Number(paymentForm.amountYuan) <= 0 || !paymentForm.reference.trim()}>{loading ? '登记中…' : '登记已收款项'}</button>
            </form>
            {offlinePayments.length === 0 ? <div className="empty">暂无线下收款登记。</div> : (
              <div className="table-wrap">
                <table className="offline-payment-table">
                  <thead><tr><th>时间</th><th>凭证</th><th>类型</th><th>金额</th><th>备注</th><th /></tr></thead>
                  <tbody>{offlinePayments.map((record) => (
                    <tr key={record.id}>
                      <td className="nowrap">{formatDate(record.receivedAt)}</td>
                      <td><strong>{record.reference}</strong><span>{record.recordedBy}</span></td>
                      <td>{record.recordType === 'offline_receipt' ? '线下实收' : '差错更正'}</td>
                      <td className={`nowrap usage-amount ${record.amountYuan < 0 ? 'charge' : 'credit'}`}>{formatSignedYuan(record.amountYuan)}</td>
                      <td>{record.note || '-'}</td>
                      <td className="col-actions">{record.recordType === 'offline_receipt' && !offlinePayments.some((item) => item.reversesRecordId === record.id) && (
                        <button className="secondary" type="button" onClick={() => setCorrection({ paymentId: record.id, note: '' })}>更正</button>
                      )}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
            {correction.paymentId && (
              <form className="offline-correction-form" onSubmit={(event) => void submitCorrection(event)}>
                <Field label="更正原因" value={correction.note} onChange={(note) => setCorrection({ ...correction, note })} placeholder="说明为什么该登记需要冲销" required />
                <div className="form-actions">
                  <button className="secondary" type="button" onClick={() => setCorrection({ paymentId: '', note: '' })}>取消</button>
                  <button className="danger" type="submit" disabled={loading || correction.note.trim().length < 3}>确认生成更正流水</button>
                </div>
                <small>该操作只冲销系统内登记，不会向客户发起退款。</small>
              </form>
            )}
          </section>

          <section className="panel">
            <div className="panel-head">
              <div><h2>模型用量</h2><span>按本月应收费用从高到低排序</span></div>
              <span>{models.length} 个模型</span>
            </div>
            {models.length === 0 ? <div className="empty">本月还没有按量 API 消耗。</div> : (
              <div className="table-wrap">
                <table className="usage-model-table">
                  <thead><tr><th>模型</th><th>供应商</th><th>调用</th><th>Tokens</th><th>费用</th><th>最近使用</th></tr></thead>
                  <tbody>{models.map((model) => (
                    <tr key={model.modelId}>
                      <td><strong>{model.label || model.modelId}</strong><span title={model.modelId}>{model.modelId}</span></td>
                      <td>{model.provider || '-'}</td>
                      <td className="nowrap">{formatWholeNumber(model.runCount)}</td>
                      <td className="nowrap" title={formatUsageBreakdown(model)}>{formatWholeNumber(model.totalTokens)}</td>
                      <td className="nowrap">{formatYuan(model.billableYuan)}</td>
                      <td className="nowrap">{formatDate(model.lastUsedAt)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </section>

          <section className="panel">
            <div className="panel-head">
              <div><h2>账单流水</h2><span>同一运行的流水已合并，金额为该运行累计变动</span></div>
              <span>共 {formatWholeNumber(pagination?.total ?? ledger.length)} 条汇总</span>
            </div>
            {ledger.length === 0 ? <div className="empty">暂无账单流水。</div> : (
              <div className="table-wrap">
                <table className="usage-ledger-table">
                  <thead><tr><th>时间</th><th>说明</th><th>运行 ID</th><th>金额</th></tr></thead>
                  <tbody>{ledger.map((entry) => (
                    <tr key={entry.id}>
                      <td className="nowrap">{formatDate(entry.createdAt)}</td>
                      <td><strong title={entry.description}>{entry.description || entry.entryType}</strong><span>{entry.entryType}{(entry.entryCount ?? 1) > 1 ? ` · ${entry.entryCount} 笔合计` : ''}</span></td>
                      <td><code title={entry.runId || undefined}>{entry.runId || '-'}</code></td>
                      <td className={`nowrap usage-amount ${entry.amountYuan < 0 ? 'charge' : 'credit'}`}>{formatSignedLedgerYuan(entry.amountYuan)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
            {pagination && pagination.totalPages > 1 && (
              <div className="usage-pagination">
                <span>第 {pagination.page} / {pagination.totalPages} 页 · 每页 {pagination.pageSize} 条</span>
                <div>
                  <button className="secondary" type="button" disabled={loading || !pagination.hasPrevious} onClick={() => onPageChange(pagination.page - 1)}>上一页</button>
                  <button className="secondary" type="button" disabled={loading || !pagination.hasNext} onClick={() => onPageChange(pagination.page + 1)}>下一页</button>
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function UsageMetric({ label, value, meta }: { label: string; value: string; meta: string }) {
  return <div className="usage-metric"><span>{label}</span><strong>{value}</strong><small>{meta}</small></div>;
}

function AuthorizationCodeTable({
  codes,
  onRevoke,
  onDelete,
  revealedCodes,
  revealingCodeId,
  onToggleReveal,
  showTenant = true,
}: {
  codes: AuthorizationCode[];
  onRevoke?: (code: AuthorizationCode) => void;
  onDelete?: (code: AuthorizationCode) => void;
  revealedCodes: Record<string, string>;
  revealingCodeId: string;
  onToggleReveal: (code: AuthorizationCode) => void;
  showTenant?: boolean;
}) {
  if (codes.length === 0) return <div className="empty">暂无授权码。</div>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {showTenant && <th>客户</th>}
            <th>授权码</th>
            <th>机器数</th>
            <th>到期</th>
            <th>最近使用</th>
            <th>状态</th>
            <th className="col-actions" />
          </tr>
        </thead>
        <tbody>
          {codes.map((code) => {
            const revealedCode = revealedCodes[code.id];
            const revealing = revealingCodeId === code.id;
            return (
            <tr key={code.id}>
              {showTenant && <td><strong>{code.tenantName}</strong><span>{code.note || code.tenantId}</span></td>}
              <td>
                <div className="authorization-code-cell">
                  <code className="secret-code">{revealedCode || code.codeHint}</code>
                  <button
                    className="secondary secret-toggle"
                    type="button"
                    disabled={revealing || !code.revealable}
                    title={code.revealable ? undefined : '旧授权码没有加密副本，请生成新码'}
                    onClick={() => onToggleReveal(code)}
                  >
                    {revealing ? '读取中…' : revealedCode ? '隐藏' : code.revealable ? '显示' : '不可显示'}
                  </button>
                  {revealedCode && <CopyButton text={revealedCode} />}
                </div>
                {!code.revealable && <span className="legacy-secret-note">旧码需重新生成</span>}
              </td>
              <td className="nowrap">{code.maxDevices}</td>
              <td className="nowrap">{formatDate(code.expiresAt)}</td>
              <td className="nowrap">{formatDate(code.lastUsedAt)}</td>
              <td><Status value={code.status} /></td>
              <td className="col-actions">
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
          );})}
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
  if (models.length === 0) return <div className="empty"><strong>暂无模型路由</strong><span>点击“新增模型”配置第一条上游映射。</span></div>;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>模型</th><th>上游模型</th><th>成本 / 用户价 元/百万</th><th>状态</th><th className="col-actions" /></tr></thead>
        <tbody>
          {models.map((model) => (
            <tr key={model.id}>
              <td><strong>{model.label}</strong><span>{model.modelId}</span></td>
              <td><strong>{model.upstreamModel}</strong><span>{model.endpointPath} · 上下文 {formatWholeNumber(model.contextWindowTokens)} / 回答 {formatWholeNumber(model.maxOutputTokens)} tokens · 思考 {model.supportedReasoningEfforts.join('/')} · {model.fastModeSupported ? 'Fast' : '标准速度'}</span></td>
              <td>
                <strong>成本 {formatYuanPerMillion(model.inputYuanPerMillion)} / {formatYuanPerMillion(model.outputYuanPerMillion)}</strong>
                <span>用户 {formatYuanPerMillion(userPrice(model.inputYuanPerMillion, priceMultiplierFromMarkupBps(model.markupBps)))} / {formatYuanPerMillion(userPrice(model.outputYuanPerMillion, priceMultiplierFromMarkupBps(model.markupBps)))} · ×{formatPriceMultiplier(priceMultiplierFromMarkupBps(model.markupBps))}</span>
              </td>
              <td><Status value={model.enabled && model.providerReady ? 'ready' : model.enabled ? 'provider missing' : 'disabled'} /></td>
              <td className="col-actions">
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
  if (accounts.length === 0) {
    return (
      <div className="empty">
        <strong>暂无 GPT 账号</strong>
        <span>点击页面右上角“新增账号”录入第一个订阅账号。</span>
      </div>
    );
  }
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>账号</th><th>分配客户</th><th>套餐</th><th>凭据</th><th>状态</th><th className="col-actions" /></tr></thead>
        <tbody>
          {accounts.map((account) => {
            const tenantNames = codexAccountTenantNames(account);
            return (
              <tr key={account.id}>
                <td><strong>{account.email}</strong><span>{account.loginHint || account.id}</span></td>
                <td>
                  {tenantNames.length > 0 ? (
                    <TagList items={tenantNames} />
                  ) : <span className="cell-muted">未分配</span>}
                </td>
                <td className="nowrap"><PlanBadge plan={account.plan} /><span>{formatDate(account.expiresAt)}</span></td>
                <td className="nowrap">{account.loginSecretConfigured
                  ? <code className="secret-code">{account.loginSecretMask}</code>
                  : <span className="cell-muted">未配置</span>}</td>
                <td><Status value={account.status} /></td>
                <td className="col-actions">
                  <div className="table-actions">
                    <button className="secondary" type="button" onClick={() => onEdit(codexFormFromAccount(account))}>编辑</button>
                    <button
                      className="secondary"
                      type="button"
                      onClick={() => onSetStatus(account, account.status === 'active' ? 'suspended' : 'active')}
                    >
                      {account.status === 'active' ? '停用' : '启用'}
                    </button>
                    <button className="secondary danger" type="button" onClick={() => onDelete(account)}>删除</button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Modal({ title, description, onClose, size = 'default', children }: {
  title: string;
  description?: string;
  onClose: () => void;
  size?: 'default' | 'wide';
  children: React.ReactNode;
}) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className={`form-dialog ${size === 'wide' ? 'wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="form-dialog-title"
        aria-describedby={description ? 'form-dialog-description' : undefined}
      >
        <div className="form-dialog-head">
          <div>
            <h2 id="form-dialog-title">{title}</h2>
            {description && <p id="form-dialog-description">{description}</p>}
          </div>
          <button className="dialog-close" type="button" aria-label="关闭" onClick={onClose}>×</button>
        </div>
        <div className="form-dialog-body">{children}</div>
      </section>
    </div>
  );
}

function ConfirmDialog({ dialog, loading, onCancel, onConfirm }: {
  dialog: ConfirmDialogState | null;
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    if (!dialog) return;
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !loading) onCancel();
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [dialog, loading, onCancel]);

  if (!dialog) return null;
  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <div className="confirm-mark" aria-hidden="true">!</div>
        <div className="confirm-copy">
          <h2 id="confirm-title">{dialog.title}</h2>
          <p>{dialog.message}</p>
          {dialog.detail && <div className="confirm-detail">{dialog.detail}</div>}
        </div>
        <div className="confirm-actions">
          <button type="button" className="secondary" onClick={onCancel} disabled={loading}>取消</button>
          <button type="button" className="danger-primary" onClick={onConfirm} disabled={loading} autoFocus>
            {loading ? '处理中...' : dialog.confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // Clipboard unavailable (e.g. insecure context); silently ignore.
    }
  };

  return (
    <button type="button" className={copied ? 'copy-button copied' : 'copy-button'} onClick={() => void copy()}>
      {copied ? '已复制' : '复制'}
    </button>
  );
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

function TextArea({ label, value, onChange, placeholder = '' }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label>
      {label}
      <textarea value={value} placeholder={placeholder} rows={3} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function NumberField({ label, value, onChange, min, max, step = 1, title }: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number | 'any';
  title?: string;
}) {
  return (
    <label title={title}>
      {label}
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        title={title}
        onChange={(event) => onChange(Number(event.target.value || 0))}
      />
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
  const tone = value.includes('ready') || value === 'active' || value === 'published'
    ? 'ok'
    : ['suspended', 'revoked', 'disabled', 'expired'].includes(value)
      ? 'bad'
      : 'warn';
  return <span className={`status ${tone}`}>{statusLabel(value)}</span>;
}

function statusLabel(value: string) {
  return ({
    active: '启用',
    suspended: '停用',
    revoked: '已撤销',
    disabled: '已停用',
    ready: '就绪',
    draft: '草稿',
    published: '已发布',
    archived: '历史版本',
    'provider missing': '缺少供应商',
  } as Record<string, string>)[value] || value;
}

function TagList({ items }: { items: string[] }) {
  return (
    <div className="tag-list">
      {items.map((item) => <span className="tag" key={item}>{item}</span>)}
    </div>
  );
}

function PlanBadge({ plan }: { plan: string }) {
  const label = ({ monthly: '按月', yearly: '按年' } as Record<string, string>)[plan] || plan;
  return <span className={`plan-badge plan-${plan}`}>{label}</span>;
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

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取 Skill 发行包失败'));
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const separator = result.indexOf(',');
      if (separator < 0) reject(new Error('Skill 发行包无法转换为上传格式'));
      else resolve(result.slice(separator + 1));
    };
    reader.readAsDataURL(file);
  });
}

function tabTitle(tab: Tab) {
  return {
    overview: '运营总览',
    tenants: '客户与授权',
    usage: 'LLM 用量与账单',
    gateway: '模型网关',
    codex: 'GPT 订阅账号',
    skills: 'Skills 发行管理',
    audit: '审计日志',
  }[tab];
}

function tabSubtitle(tab: Tab) {
  return {
    overview: '客户、设备、模型网关和用量账本状态。',
    tenants: '维护基金公司客户，并在客户上下文中生成和管理授权码。',
    usage: '按客户查看月度模型调用、Tokens、费用和完整账单流水。',
    gateway: '在后台配置上游 key、模型别名、价格和加价规则。',
    codex: '管理我们提供给客户使用的 GPT 订阅账号。',
    skills: '上传、发布、灰度和回滚受保护的 Alpha Studio Skill 版本。',
    audit: '查看资金、授权、模型和账号配置变更。',
  }[tab];
}

function tabFromLocation(): Tab {
  const segment = window.location.pathname.replace(/\/+$/, '').split('/').pop() || '';
  if (segment === 'codes') return 'tenants';
  if (isTab(segment)) return segment;
  const hashTab = window.location.hash.replace(/^#\/?/, '');
  if (hashTab === 'codes') return 'tenants';
  if (isTab(hashTab)) return hashTab;
  return 'overview';
}

function pathForTab(tab: Tab) {
  return tab === 'overview' ? '/admin/' : `/admin/${tab}`;
}

function isTab(value: string): value is Tab {
  return navItems.some(([tab]) => tab === value);
}

function formatYuan(yuan: number) {
  const safe = Number.isFinite(yuan) ? yuan : 0;
  const absolute = Math.abs(safe);
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: 2,
    maximumFractionDigits: absolute > 0 && absolute < 1 ? 4 : 2,
  }).format(safe);
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatSignedYuan(yuan: number) {
  return `${yuan > 0 ? '+' : ''}${formatYuan(yuan)}`;
}

function formatSignedLedgerYuan(yuan: number) {
  const safe = Number.isFinite(yuan) ? yuan : 0;
  const formatted = new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(safe);
  return `${safe > 0 ? '+' : ''}${formatted}`;
}

function formatWholeNumber(value: number) {
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(Number(value) || 0);
}

function formatUsageBreakdown(usage?: BillingUsageTotals | null) {
  if (!usage) return '输入 0 · 输出 0';
  const parts = [
    `输入 ${formatWholeNumber(usage.inputTokens)}`,
    `输出 ${formatWholeNumber(usage.outputTokens)}`,
  ];
  if (usage.reasoningTokens > 0) parts.push(`推理 ${formatWholeNumber(usage.reasoningTokens)}`);
  if (usage.cachedTokens > 0) parts.push(`缓存 ${formatWholeNumber(usage.cachedTokens)}`);
  return parts.join(' · ');
}

function formatMonth(value: string) {
  return new Date(value).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' });
}

function formatBillingMode(mode: string) {
  return ({ hybrid: '订阅 + 按量', gateway_api: '按量付费', subscription: '订阅' } as Record<string, string>)[mode] || mode;
}

function formatYuanPerMillion(yuan: number) {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  }).format(yuan);
}

function priceMultiplierFromMarkupBps(markupBps: number) {
  return 1 + Math.max(0, Number(markupBps) || 0) / 10_000;
}

function markupBpsFromPriceMultiplier(multiplier: number) {
  const normalized = Number.isFinite(multiplier) ? Math.max(1, multiplier) : 1;
  return Math.round((normalized - 1) * 10_000);
}

function userPrice(cost: number, multiplier: number) {
  return Math.max(0, Number(cost) || 0) * Math.max(1, Number(multiplier) || 1);
}

function formatPriceMultiplier(multiplier: number) {
  return new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 4 }).format(Math.max(1, Number(multiplier) || 1));
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
