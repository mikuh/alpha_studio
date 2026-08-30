import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { App, splitStreamingMarkdown } from './App';
import { ALPHA_GATEWAY_PROVIDER_ID, clearClientLicenseSession, loadClientLicenseSession, saveClientLicenseSession } from './license';
import { DEFAULT_MODEL_PROFILE_ID, defaultModelProfiles, modelProfilesFromCodexCatalog } from './models';
import type { CodexModelCatalogItem } from './types';
import { useChatStore } from './store';
import type { Conversation } from './types';
import { INTRADAY_MONITOR_CARD_PROMPT, REPORT_REVIEW_CARD_PROMPT } from './themeAbilities';
import { ALPHA_STUDIO_DAILY_THEME_SKILL_ID } from './themeResearch';
import {
  COMPANY_THESIS_CARD_PROMPT,
  EVIDENCE_INTELLIGENCE_CARD_PROMPT,
  FACTOR_MINING_CARD_PROMPT,
  MAINLINE_TREND_CARD_PROMPT,
  RESEARCH_CALIBRATION_CARD_PROMPT,
} from './domain';

const windowMockState = vi.hoisted(() => ({
  fullscreen: false,
  resizeHandler: null as (() => void) | null,
}));
const codexCatalogMockState = vi.hoisted(() => ({
  status: { installed: true, version: 'test', path: '/usr/bin/codex', loggedIn: false, accountEmail: undefined as string | undefined, error: 'Alpha Studio 的 GPT 尚未完成设备授权。' },
  models: [] as CodexModelCatalogItem[],
  error: null as Error | null,
}));
vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: vi.fn((path: string) => `asset://localhost/${path}`),
  invoke: vi.fn((command: string, args?: { request?: { method?: string; name?: string; data?: string; currentPath?: string; path?: string; params?: Record<string, unknown> } }) => {
    if (command === 'plugin:window|is_fullscreen') return Promise.resolve(windowMockState.fullscreen);
    if (command === 'codex_check') {
      return Promise.resolve({ ...codexCatalogMockState.status });
    }
    if (command === 'codex_models') return codexCatalogMockState.error ? Promise.reject(codexCatalogMockState.error) : Promise.resolve(codexCatalogMockState.models);
    if (command === 'codex_login') return Promise.resolve({ codexHome: '/Users/demo/.alpha-studio/codex-home' });
    if (command === 'codex_revoke_authorization') return Promise.resolve({ codexHome: '/Users/demo/.alpha-studio/codex-home' });
    if (command === 'codex_subscription_usage') {
      return Promise.resolve({
        source: 'codex-cli',
        generatedAt: '2026-07-09T08:30:00.000Z',
        rateLimits: {
          limitId: 'codex',
          primary: { usedPercent: 37, windowDurationMins: 300, resetsAt: 1783596585 },
          secondary: { usedPercent: 77, windowDurationMins: 10080, resetsAt: 1783927546 },
          planType: 'pro',
        },
        rateLimitsByLimitId: null,
        rateLimitResetCredits: { availableCount: 2 },
      });
    }
    if (command === 'project_folder_create') {
      return Promise.resolve({
        path: `/Users/demo/.alphastudio/projects/${args?.request?.name || 'Research Topic'}`,
      });
    }
    if (command === 'project_folder_rename') {
      return Promise.resolve({
        path: `/Users/demo/.alphastudio/projects/${args?.request?.name || 'Research Topic'}`,
      });
    }
    if (command === 'clipboard_attachment_save') {
      return Promise.resolve(`/Users/demo/.alpha-studio/attachments/clipboard/${args?.request?.name || 'attachment.bin'}`);
    }
    if (command === 'list_open_apps') return Promise.resolve(['finder', 'preview']);
    if (command === 'local_image_data_url') return Promise.resolve('data:image/png;base64,preview');
    if (command === 'local_text_file_read') {
      const path = args?.request?.path || '/tmp/file.md';
      if (path.endsWith('.html')) {
        return Promise.resolve({
          path,
          content: '<!doctype html><html><head><title>报告</title><link rel="stylesheet" href="./report-style.css"></head><body><img src="./alpha-studio-logo.png" alt="Alpha Studio Research logo"><main>HTML 报告内容</main></body></html>',
          bytes: 206,
          truncated: false,
        });
      }
      if (path.endsWith('.css')) {
        return Promise.resolve({
          path,
          content: 'body { color: rgb(31, 31, 31); } main { min-height: 24px; }',
          bytes: 61,
          truncated: false,
        });
      }
      return Promise.resolve({
        path,
        content: '# 合规意见\n\n文件预览内容',
        bytes: 18,
        truncated: false,
      });
    }
    if (command === 'local_directory_list') {
      const path = args?.request?.path || '/tmp/alpha-studio';
      if (path.endsWith('/docs')) {
        return Promise.resolve([
          { name: 'sources.pdf', path: `${path}/sources.pdf`, isDirectory: false, isSymlink: false, bytes: 2048 },
        ]);
      }
      return Promise.resolve([
        { name: 'docs', path: `${path}/docs`, isDirectory: true, isSymlink: false, bytes: 0 },
        { name: 'overview.md', path: `${path}/overview.md`, isDirectory: false, isSymlink: false, bytes: 512 },
      ]);
    }
    if (command === 'git_status') {
      return Promise.resolve({
        cwd: '/tmp/alpha-studio',
        isRepository: false,
        ahead: 0,
        behind: 0,
        clean: true,
        changes: [],
      });
    }
    return Promise.resolve(undefined);
  }),
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: vi.fn(() => ({
    setTheme: vi.fn(() => Promise.resolve()),
    isFullscreen: vi.fn(() => Promise.resolve(windowMockState.fullscreen)),
    onResized: vi.fn((handler: () => void) => {
      windowMockState.resizeHandler = handler;
      return Promise.resolve(() => {
        if (windowMockState.resizeHandler === handler) windowMockState.resizeHandler = null;
      });
    }),
    onFocusChanged: vi.fn(() => Promise.resolve(() => {})),
  })),
}));

function conversation(patch: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conv-right-panel',
    title: 'Right panel check',
    messages: [{ id: 'msg-1', role: 'user', timestamp: 1, blocks: [{ type: 'text', content: 'hi' }] }],
    cwd: '/tmp/alpha-studio',
    createdAt: 1,
    updatedAt: 1,
    status: 'idle',
    ...patch,
  };
}

function futureIso(ms = 86_400_000) {
  return new Date(Date.now() + ms).toISOString();
}

function seedClientLicenseSession(codexSubscriptionEnabled = true, leaseExpiresAt = futureIso()) {
  saveClientLicenseSession({
    apiBaseUrl: 'http://localhost:18080',
    activatedAt: 1,
    lastValidatedAt: Date.now(),
    tenant: {
      id: 'tenant_demo',
      name: 'Demo Fund',
      maxDevices: 5,
      codexSubscriptionEnabled,
      codexSubscriptionPlan: codexSubscriptionEnabled ? 'monthly' : null,
    },
    user: {
      id: 'user_demo',
      email: 'user@demo.local',
      name: 'Demo User',
    },
    device: {
      id: 'dev_demo',
      accessToken: 'device-token',
      leaseExpiresAt,
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
    codexAccounts: codexSubscriptionEnabled ? [
      {
        id: 'codex_demo',
        email: 'codex-demo@alpha.local',
        loginHint: 'Use browser login handoff',
        plan: 'team',
        seatLimit: 3,
        expiresAt: '2026-08-01T00:00:00.000Z',
      },
    ] : [],
  });
}

function jsonResponse(body: unknown) {
  return {
    ok: true,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;
}

function cloudMarketSnapshot(codes?: string[]) {
  const rows = [
    ['000001.XSHG', '上证指数', '主要指数', 3832.26, 3804.69, 810_000_000_000],
    ['399001.XSHE', '深证成指', '主要指数', 13578.93, 13285.80, 920_000_000_000],
    ['399006.XSHE', '创业板指', '主要指数', 3343.96, 3244.61, 420_000_000_000],
    ['600519.XSHG', '贵州茅台', '白酒', 1190, 1200, 9_000_000_000],
    ['000001.XSHE', '平安银行', '银行', 10.4, 10.5, 310_000_000],
    ['300750.XSHE', '宁德时代', '电池', 210, 205, 1_500_000_000],
    ['688981.XSHG', '中芯国际', '半导体', 58, 56, 2_100_000_000],
    ['600036.XSHG', '招商银行', '银行', 35.5, 35.1, 980_000_000],
    ['601127.XSHG', '赛力斯', '汽车', 88.8, 86.4, 1_280_000_000],
    ['510300.XSHG', '沪深300ETF', '宽基ETF', 4.12, 4.08, 5_900_000_000],
    ['159915.XSHE', '创业板ETF', '宽基ETF', 2.31, 2.28, 2_100_000_000],
  ].map(([code, name, sector, price, prevClose, turnoverAmount]) => ({
    code,
    rawCode: String(code).slice(0, 6),
    name,
    market: String(code).endsWith('XSHG') ? 'SH' : 'SZ',
    board: String(sector).endsWith('ETF') ? `${String(code).endsWith('XSHG') ? '沪' : '深'}市ETF` : String(code).startsWith('688') ? '科创板' : String(code).startsWith('3') ? '创业板' : '主板',
    sector,
    securityType: String(sector).endsWith('ETF') ? 'etf' : String(sector) === '主要指数' ? 'index' : 'stock',
    source: 'eastmoney',
    price,
    prevClose,
    changeAmt: Number(price) - Number(prevClose),
    changePct: ((Number(price) - Number(prevClose)) / Number(prevClose)) * 100,
    open: prevClose,
    high: Number(price) * 1.01,
    low: Number(price) * 0.99,
    volumeShares: 1_000_000,
    turnoverAmount,
    marketCapAmount: Number(price) * 100_000_000,
    turnoverRate: 2.3,
    volumeRatio: 1.4,
    status: 2,
  }));
  const requested = codes?.length ? new Set(codes) : null;
  return {
    schemaVersion: 1,
    sequence: 7,
    market: 'a-share',
    source: 'eastmoney',
    asOf: '2026-08-01T03:35:00.000Z',
    generatedAt: '2026-08-01T03:35:00.000Z',
    stale: false,
    quotes: requested ? rows.filter((row) => requested.has(String(row.code))) : rows,
    warnings: [],
  };
}

function cloudCapitalFlowSnapshot(code = '600519.XSHG') {
  const emptyGross = { inflow: null, outflow: null, netPct: null };
  const buckets = [
    { key: 'xl', label: '超大单', net: 86_000_000, ...emptyGross },
    { key: 'l', label: '大单', net: 34_000_000, ...emptyGross },
    { key: 'm', label: '中单', net: -29_000_000, ...emptyGross },
    { key: 's', label: '小单', net: -91_000_000, ...emptyGross },
  ];
  const emptyBuckets = buckets.map((bucket) => ({ ...bucket, net: null }));
  return {
    schemaVersion: 1,
    code,
    daily: [
      { time: '2026-07-30', mainNet: -30_000_000, mainNetPct: null, changePct: null, buckets: emptyBuckets },
      { time: '2026-07-31', mainNet: 120_000_000, mainNetPct: null, changePct: null, buckets },
    ],
    intraday: [
      { time: '2026-07-31 09:30', mainNet: 12_000_000, mainNetPct: null, changePct: null, buckets },
      { time: '2026-07-31 15:00', mainNet: 120_000_000, mainNetPct: null, changePct: null, buckets },
    ],
    intradayMode: 'cumulative',
    source: 'tencent',
    sourceLabel: '腾讯财经免费资金流',
    asOf: '2026-07-31 15:00',
    generatedAt: '2026-08-01T03:35:00.000Z',
    stale: false,
    warnings: ['免费版展示四档净额；未将净额反推为各档流入/流出。'],
  };
}

function mockLocalHtmlPreviewFiles() {
  vi.mocked(invoke).mockImplementation((command: string, args?: unknown) => {
    const request = args && typeof args === 'object' && 'request' in args
      ? (args as { request?: { path?: string } }).request
      : undefined;
    if (command === 'local_image_data_url') return Promise.resolve('data:image/png;base64,preview');
    if (command === 'local_text_file_read') {
      const path = request?.path || '/tmp/file.md';
      if (path.endsWith('.html')) {
        return Promise.resolve({
          path,
          content: '<!doctype html><html><head><title>报告</title><link rel="stylesheet" href="./report-style.css"></head><body><img src="./alpha-studio-logo.png" alt="Alpha Studio Research logo"><main>HTML 报告内容</main></body></html>',
          bytes: 206,
          truncated: false,
        });
      }
      if (path.endsWith('.css')) {
        return Promise.resolve({
          path,
          content: 'body { color: rgb(31, 31, 31); } main { min-height: 24px; }',
          bytes: 61,
          truncated: false,
        });
      }
    }
    if (command === 'list_open_apps') return Promise.resolve(['finder']);
    return Promise.resolve(undefined);
  });
}

describe('right feature panel', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    cleanup();
  });

  beforeEach(() => {
    windowMockState.fullscreen = false;
    windowMockState.resizeHandler = null;
    Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
    window.localStorage.clear();
    codexCatalogMockState.status.loggedIn = false;
    codexCatalogMockState.status.accountEmail = 'codex-demo@alpha.local';
    codexCatalogMockState.models = [];
    codexCatalogMockState.error = null;
    seedClientLicenseSession();
    vi.stubGlobal('fetch', vi.fn((input?: RequestInfo | URL) => {
      const url = String(input ?? '');
      if (url.includes('/api/market/capital-flow/')) {
        return Promise.resolve(jsonResponse(cloudCapitalFlowSnapshot(decodeURIComponent(url.split('/').pop() || '600519.XSHG'))));
      }
      if (url.includes('/api/market/snapshot')) {
        const parsed = new URL(url);
        const codes = parsed.searchParams.get('codes')?.split(',').filter(Boolean);
        return Promise.resolve(jsonResponse(cloudMarketSnapshot(codes)));
      }
      return Promise.resolve(jsonResponse({ leaseExpiresAt: futureIso() }));
    }));
    useChatStore.setState({
      conversations: [conversation()],
      subscriptionUsage: [],
      projects: [],
      currentConversationId: 'conv-right-panel',
      selectedModelProfileId: DEFAULT_MODEL_PROFILE_ID,
      modelProfiles: defaultModelProfiles(),
      workModeId: 'finance-research',
      codexStatus: { installed: true, loggedIn: true, accountEmail: 'codex-demo@alpha.local', path: '/usr/bin/codex', version: 'test' },
      codexModelCatalog: null,
      codexModelCatalogError: null,
      isRefreshingCodexModels: false,
      reasoningEffort: 'medium',
      isCheckingCodex: false,
      error: null,
      projectSort: 'updated',
      conversationSort: 'updated',
    });
  });

  const CODEX_MODEL_CATALOG: CodexModelCatalogItem[] = [
    { id: 'gpt-5.6-sol', displayName: 'GPT-5.6 Sol', isDefault: true, hidden: false, defaultReasoningEffort: 'max', supportedReasoningEfforts: [{ reasoningEffort: 'high', description: 'Thorough' }, { reasoningEffort: 'max', description: 'Maximum' }, { reasoningEffort: 'ultra', description: 'Ultra' }] },
    { id: 'gpt-5.6-terra', displayName: 'GPT-5.6 Terra', isDefault: false, hidden: false, defaultReasoningEffort: 'high', supportedReasoningEfforts: [{ reasoningEffort: 'low', description: 'Fast' }, { reasoningEffort: 'medium', description: 'Balanced' }, { reasoningEffort: 'high', description: 'Thorough' }, { reasoningEffort: 'max', description: 'Maximum' }] },
    { id: 'gpt-5.6-luna', displayName: 'GPT-5.6 Luna', isDefault: false, hidden: false, defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'low', description: 'Fast' }, { reasoningEffort: 'medium', description: 'Balanced' }] },
  ];

  it('blocks the workspace until the client is activated', () => {
    clearClientLicenseSession();

    const { container } = render(<App />);

    expect(screen.getByRole('heading', { name: '激活 Alpha Studio' })).toBeInTheDocument();
    expect(screen.getByLabelText('公司名称')).toBeInTheDocument();
    expect(screen.getByLabelText('授权码')).toBeInTheDocument();
    expect(screen.queryByLabelText('后台地址')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('设备名称')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('用户邮箱')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('用户名称')).not.toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')).toHaveLength(4);
    expect(screen.getByRole('button', { name: '激活并进入' })).toBeDisabled();
    expect(container.querySelector('.license-window-drag-region')).toHaveAttribute('data-tauri-drag-region');
    expect(container.querySelector('.app-shell')).not.toBeInTheDocument();
  });

  it('shows the full activation agreements before consent', async () => {
    clearClientLicenseSession();
    const user = userEvent.setup();

    render(<App />);
    await user.click(screen.getAllByRole('button', { name: '查看' })[0]);

    expect(screen.getByRole('dialog', { name: 'Alpha Studio 软件许可及用户服务协议' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '2. 软件费与 Token 消耗费' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '我已阅读' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps a fresh stored activation when the startup lease refresh fails', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));

    const { container } = render(<App />);

    expect(container.querySelector('.app-shell')).toBeInTheDocument();
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      'http://localhost:18080/api/devices/lease',
      expect.objectContaining({ method: 'POST' }),
    ));
    expect(screen.queryByRole('heading', { name: '激活 Alpha Studio' })).not.toBeInTheDocument();
    expect(loadClientLicenseSession()?.device.id).toBe('dev_demo');
  });

  it('keeps an in-app activation when the startup effect is re-executed in development', async () => {
    clearClientLicenseSession();
    useChatStore.getState().setClientLicenseSession(null);
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      tenant: {
        id: 'tenant_demo',
        name: 'Demo Fund',
        maxDevices: 5,
        codexSubscriptionEnabled: false,
      },
      user: {
        id: 'user_demo',
        email: 'user@demo.local',
        name: 'Demo User',
      },
      device: {
        id: 'dev_demo',
        accessToken: 'device-token',
        leaseExpiresAt: futureIso(),
      },
      models: [],
      codexAccounts: [],
    }));
    const user = userEvent.setup();
    const originalRefresh = useChatStore.getState().refreshClientLicenseSession;

    const { container } = render(<App />);
    await user.type(screen.getByLabelText('公司名称'), 'Demo Fund');
    await user.type(screen.getByLabelText('授权码'), 'AS-TEST-CODE');
    for (const checkbox of screen.getAllByRole('checkbox')) await user.click(checkbox);
    await user.click(screen.getByRole('button', { name: '激活并进入' }));

    await waitFor(() => expect(container.querySelector('.app-shell')).toBeInTheDocument());
    const stored = loadClientLicenseSession();
    expect(stored?.device.accessToken).toBe('device-token');

    const refreshedLifecycle = vi.fn(() => Promise.resolve(stored));
    act(() => {
      useChatStore.setState({ refreshClientLicenseSession: refreshedLifecycle });
    });

    await waitFor(() => expect(refreshedLifecycle).toHaveBeenCalled());
    expect(screen.queryByRole('heading', { name: '激活 Alpha Studio' })).not.toBeInTheDocument();
    expect(container.querySelector('.app-shell')).toBeInTheDocument();
    expect(useChatStore.getState().clientLicenseSession?.device.id).toBe('dev_demo');

    act(() => {
      useChatStore.setState({ refreshClientLicenseSession: originalRefresh });
    });
  });

  it('returns a freshly stored device to activation when the backend has revoked it', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: () => Promise.resolve(JSON.stringify({
        error: { message: 'device is not active for this tenant' },
      })),
    } as Response);

    const { container } = render(<App />);

    expect(container.querySelector('.app-shell')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('heading', { name: '激活 Alpha Studio' })).toBeInTheDocument());
    expect(loadClientLicenseSession()).toBeNull();
    expect(container.querySelector('.app-shell')).not.toBeInTheDocument();
  });

  it('refreshes admin-managed models when the app regains focus', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      leaseExpiresAt: futureIso(),
      models: [
        {
          id: 'gpt-5.5',
          label: 'GPT-5.5 API',
          provider: 'openai',
          mode: 'gateway_api',
          enabled: true,
        },
      ],
    }));
    render(<App />);
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.filter(([input]) => String(input).includes('/api/devices/lease'))).toHaveLength(1));

    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      leaseExpiresAt: futureIso(),
      models: [
        {
          id: 'deepseek-v4-flash',
          label: 'DeepSeek V4 Flash',
          provider: 'deepseek',
          mode: 'gateway_api',
          enabled: true,
        },
      ],
    }));
    window.dispatchEvent(new Event('focus'));

    await waitFor(() => expect(loadClientLicenseSession()?.models.map((model) => model.id)).toEqual(['deepseek-v4-flash']));
    await user.click(screen.getByTitle('选择模型与推理强度'));
    const modelMenu = screen.getByRole('menu', { name: '选择模型' });
    expect(within(modelMenu).queryByRole('menuitemradio', { name: /GPT-5\.5 API/ })).not.toBeInTheDocument();
    expect(within(modelMenu).getByRole('menuitemradio', { name: /DeepSeek V4 Flash/ })).toBeInTheDocument();
  });

  it('requires renewal when the stored activation has expired', async () => {
    seedClientLicenseSession(true, new Date(Date.now() - 60_000).toISOString());
    vi.mocked(fetch)
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('offline'));

    const { container } = render(<App />);

    expect(screen.getByRole('heading', { name: '正在校验 Alpha Studio 授权' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('heading', { name: '激活 Alpha Studio' })).toBeInTheDocument());
    expect(loadClientLicenseSession()).toBeNull();
    expect(container.querySelector('.app-shell')).not.toBeInTheDocument();
  });

  it('removes coding tools from the right-top toolbar in the finance workspace', () => {
    const { container } = render(<App />);

    expect(screen.queryByLabelText('环境信息')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('用其他软件打开')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('打开下方终端')).not.toBeInTheDocument();
    expect(screen.getByLabelText('打开文件')).toBeInTheDocument();
    expect(screen.getByLabelText('打开投研工作台')).toBeInTheDocument();
    expect(screen.getByLabelText('打开浏览器')).toBeInTheDocument();
    expect(screen.queryByLabelText('日报决策')).not.toBeInTheDocument();
    expect(container.querySelector('.open-app-trigger-icon')).not.toBeInTheDocument();
    expect(document.querySelector('.app-shell')).toHaveAttribute('data-work-mode', 'finance-research');
  });

  it('does not archive the current conversation with Command+Shift+A', () => {
    render(<App />);

    fireEvent.keyDown(window, { metaKey: true, shiftKey: true, code: 'KeyA', key: 'A' });

    expect(useChatStore.getState().conversations[0]?.archivedAt).toBeUndefined();
    expect(useChatStore.getState().currentConversationId).toBe('conv-right-panel');
  });

  it('uses one instrument-control treatment for the workspace chrome tools', () => {
    const { container } = render(<App />);
    const panelActions = document.querySelector('.top-bar-panel-actions');
    const panelTools = panelActions?.querySelectorAll('.topbar-tool-button');

    expect(panelActions).toBeInTheDocument();
    expect(panelTools).toHaveLength(4);
    panelTools?.forEach((tool) => expect(tool).toHaveClass('chrome-tool-button'));
    expect(container.querySelector('.sidebar-collapse-btn')).toHaveClass('chrome-tool-button');
    expect(container.querySelector('.sidebar-collapse-btn svg')).toHaveClass('lucide-arrow-left-to-line');
    expect(screen.getByLabelText('打开 AI 同事面板').querySelector('svg')).toHaveClass('lucide-users-round');

    const css = readFileSync(`${process.cwd()}/src/styles.css`, 'utf8');
    expect(css).toMatch(/\.top-bar-panel-actions\s*{[^}]*height:\s*34px;[^}]*gap:\s*0;[^}]*border:\s*1px solid var\(--border-strong\);/s);
    expect(css).toMatch(/\.chrome-tool-button svg\s*{[^}]*width:\s*16px;[^}]*height:\s*16px;[^}]*stroke-width:\s*1\.65;[^}]*stroke-linecap:\s*square;/s);
    expect(css).toMatch(/\.sidebar-collapse-btn\.chrome-tool-button\s*{[^}]*top:\s*0;[^}]*right:\s*0;[^}]*align-self:\s*center;/s);
    expect(css).toMatch(/\.top-bar-panel-actions\s*>\s*\.topbar-tool-button\[aria-pressed='true'\]\s*{[^}]*background:\s*var\(--text\);[^}]*color:\s*var\(--bg\);[^}]*box-shadow:\s*inset 0 -2px 0 var\(--accent\);/s);
  });

  it('shows daily decision only for daily-report conversations and closes it after switching away', async () => {
    const user = userEvent.setup();
    const dailyConversation = conversation({
      id: 'conv-daily',
      title: '今日盘前日报',
      messages: [{
        id: 'daily-user',
        role: 'user',
        timestamp: 1,
        blocks: [{ type: 'text', content: '生成今日盘前日报' }],
        selectedSkill: { id: ALPHA_STUDIO_DAILY_THEME_SKILL_ID, title: '盘前主题日报' },
      }],
    });
    const normalConversation = conversation({ id: 'conv-normal', title: '普通研究对话' });
    useChatStore.setState({ conversations: [dailyConversation, normalConversation], currentConversationId: dailyConversation.id });
    const { container } = render(<App />);

    expect(screen.getByLabelText('日报决策')).toBeInTheDocument();
    expect(screen.getByLabelText('日报决策').querySelector('svg')).toHaveClass('lucide-file-check-corner');
    expect(container.querySelector('.app-shell')).toHaveClass('daily-decision-available');
    await user.click(screen.getByLabelText('日报决策'));
    await waitFor(() => expect(container.querySelector('.dd-panel')).toBeInTheDocument());

    useChatStore.getState().setCurrentConversation(normalConversation.id);
    await waitFor(() => {
      expect(screen.queryByLabelText('日报决策')).not.toBeInTheDocument();
      expect(container.querySelector('.dd-panel')).not.toBeInTheDocument();
      expect(Array.from(container.querySelectorAll('.right-dock-tab')).some((tab) => tab.textContent?.includes('日报决策'))).toBe(false);
      expect(container.querySelector('.app-shell')).not.toHaveClass('daily-decision-available');
    });
  });

  it('exposes the finance dock tools as direct right-top actions', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    const filesToggle = screen.getByLabelText('打开文件');
    const workbenchToggle = screen.getByLabelText('打开投研工作台');
    const browserToggle = screen.getByLabelText('打开浏览器');

    expect(filesToggle).toHaveAttribute('aria-pressed', 'false');
    expect(filesToggle.querySelector('svg')).toHaveClass('lucide-folder');
    expect(workbenchToggle).toHaveAttribute('aria-pressed', 'false');
    expect(workbenchToggle.querySelector('svg')).toHaveClass('lucide-chart-candlestick');
    expect(browserToggle).toHaveAttribute('aria-pressed', 'false');
    expect(browserToggle.querySelector('svg')).toHaveClass('lucide-compass');
    expect(browserToggle.closest('.top-bar')).toBeNull();
    expect(browserToggle.closest('.top-bar-actions')?.parentElement).toBe(document.body);
    expect(container.querySelector('.features-panel')).not.toBeInTheDocument();

    await user.click(browserToggle);

    expect(container.querySelector('.browser-dock-panel')).toBeInTheDocument();
    expect(screen.getByLabelText('关闭浏览器')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('打开投研工作台')).toHaveAttribute('aria-pressed', 'false');
  });

  it('opens and closes the research directory from the right-top file action', async () => {
    const user = userEvent.setup();
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
    const { container } = render(<App />);

    await user.click(screen.getByLabelText('打开文件'));

    const filePanel = await screen.findByLabelText('研究主题文件');
    expect(await within(filePanel).findByText('overview.md')).toBeInTheDocument();
    expect(screen.getByLabelText('关闭文件')).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByLabelText('关闭文件'));

    expect(container.querySelector('.right-dock-workspace')).toHaveClass('collapsed');
    expect(screen.getByLabelText('打开文件')).toHaveAttribute('aria-pressed', 'false');
  });

  it('renders mentioned stocks as cards and opens the matching workbench detail', async () => {
    const user = userEvent.setup();
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
    useChatStore.setState({
      conversations: [conversation({
        messages: [
          { id: 'msg-1', role: 'user', timestamp: 1, blocks: [{ type: 'text', content: '比较贵州茅台和宁德时代' }] },
          { id: 'msg-2', role: 'assistant', timestamp: 2, blocks: [{ type: 'text', content: '贵州茅台（600519.XSHG）偏消费防御，宁德时代（300750）偏成长，中文在线（300364.XSHE）关注内容产业催化。' }] },
        ],
      })],
      currentConversationId: 'conv-right-panel',
    });
    const { container } = render(<App />);

    const relatedStocks = screen.getAllByLabelText('对话相关股票');
    expect(relatedStocks).toHaveLength(1);
    expect(within(relatedStocks[0]).getAllByRole('button')).toHaveLength(3);
    expect(within(relatedStocks[0]).getByText('600519')).toBeInTheDocument();
    expect(within(relatedStocks[0]).getByText('白酒')).toBeInTheDocument();
    const userMessage = container.querySelector('[data-message-id="msg-1"]') as HTMLElement;
    expect(userMessage.querySelector('.stock-mention-strip')).not.toBeInTheDocument();
    expect(within(userMessage).getByRole('button', { name: '打开贵州茅台投研详情' }))
      .toHaveClass('stock-inline-mention');
    const assistantMessage = container.querySelector('[data-message-id="msg-2"]') as HTMLElement;
    const inlineStock = within(assistantMessage).getByRole('button', { name: '打开贵州茅台投研详情' });
    expect(inlineStock).toHaveClass('stock-inline-mention');
    expect(inlineStock).toHaveTextContent('贵州茅台600519');
    expect(within(assistantMessage).getByRole('button', { name: '打开中文在线投研详情' }))
      .toHaveTextContent('中文在线300364');

    vi.mocked(invoke).mockClear();
    await user.click(inlineStock);

    const workbench = await screen.findByLabelText('投研工作台');
    await waitFor(() => expect(within(workbench).getByRole('heading', { name: '贵州茅台' })).toBeInTheDocument());
    const kline = within(workbench).getByLabelText('贵州茅台 K线图');
    expect(await within(kline).findByText('行情快照 · 本地走势预览')).toBeInTheDocument();
    expect(within(kline).queryByRole('button', { name: /历史行情/ })).not.toBeInTheDocument();
    expect(within(container.querySelector('.right-dock-workspace') as HTMLElement).getByRole('tab', { name: '投研工作台' }))
      .toHaveAttribute('aria-selected', 'true');
  });

  it('keeps the side-chat composer multiline before the sidebar is expanded', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    fireEvent.keyDown(window, { metaKey: true, altKey: true, code: 'KeyS' });

    expect(container.querySelector('.app-shell')).not.toHaveClass('right-dock-expanded');
    expect(screen.getByLabelText('展开侧边栏')).toHaveAttribute('aria-pressed', 'false');
    const composerCard = container.querySelector('.side-chat-composer .composer-card') as HTMLElement;
    expect(composerCard).toBeInTheDocument();
    expect(composerCard).not.toHaveClass('compact');
  });

  it('creates blank research topic folders under .alphastudio and syncs the folder name on rename', async () => {
    const user = userEvent.setup();
    (window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    render(<App />);

    await user.click(screen.getByLabelText('新建研究主题'));
    const menu = document.querySelector('.cmenu') as HTMLElement;
    await user.click(within(menu).getByRole('menuitem', { name: '新建空白研究主题' }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('project_folder_create', {
        request: { name: '新研究主题 1' },
      });
    });
    await waitFor(() => {
      expect(useChatStore.getState().projects[0]).toMatchObject({
        name: '新研究主题 1',
        cwd: '/Users/demo/.alphastudio/projects/新研究主题 1',
      });
    });
    const nameInput = screen.getByDisplayValue('新研究主题 1');
    await user.clear(nameInput);
    await user.type(nameInput, '投资研究{Enter}');

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('project_folder_rename', {
        request: {
          currentPath: '/Users/demo/.alphastudio/projects/新研究主题 1',
          name: '投资研究',
        },
      });
    });
    await waitFor(() => {
      expect(useChatStore.getState().projects[0]).toMatchObject({
        name: '投资研究',
        cwd: '/Users/demo/.alphastudio/projects/投资研究',
      });
    });
  });

  it('portals shared action menus above clipped top-bar and sidebar surfaces', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: '对话操作' }));
    const titleMenu = document.querySelector('.cmenu') as HTMLElement;
    expect(titleMenu).toBeInTheDocument();
    expect(titleMenu.parentElement).toBe(document.body);
    expect(titleMenu.closest('.top-bar')).toBeNull();

    await user.hover(within(titleMenu).getByRole('menuitem', { name: '复制' }));
    const flyout = titleMenu.querySelector('.cmenu-flyout > .cmenu') as HTMLElement;
    expect(flyout).toBeInTheDocument();
    expect(flyout.parentElement).toHaveClass('cmenu-flyout');

    await user.click(screen.getByRole('button', { name: '关闭菜单' }));
    await user.click(screen.getByRole('button', { name: '新建研究主题' }));

    const sidebarMenu = document.querySelector('.cmenu') as HTMLElement;
    expect(sidebarMenu).toBeInTheDocument();
    expect(sidebarMenu.parentElement).toBe(document.body);
    expect(sidebarMenu.closest('.sidebar')).toBeNull();
  });

  it('opens the mobile market console and navigates into secondary pages', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByLabelText('打开投研工作台'));

    const workbench = await screen.findByLabelText('投研工作台');
    await waitFor(() => expect(within(workbench).getByText(/云端行情快照/)).toBeInTheDocument());
    expect(within(workbench).getByRole('heading', { name: '市场' })).toBeInTheDocument();
    expect(within(workbench).getByRole('tab', { name: /自选/ })).toBeInTheDocument();
    expect(within(workbench).getByRole('tab', { name: '市场' })).toHaveAttribute('aria-selected', 'true');
    expect(within(workbench).getByRole('tab', { name: '实盘' })).toBeInTheDocument();
    expect(within(workbench).getByRole('tab', { name: '资产' })).toBeInTheDocument();
    expect(within(workbench).getByRole('tab', { name: '发现' })).toBeInTheDocument();
    expect(within(workbench).getByLabelText('主要指数')).toBeInTheDocument();
    expect(within(workbench).getByLabelText('热门榜单')).toBeInTheDocument();
    expect(within(workbench).getByLabelText('投资主题')).toBeInTheDocument();
    expect(within(workbench).getByLabelText('智能盯盘')).toBeInTheDocument();
    expect(within(workbench).getByLabelText('产业链')).toBeInTheDocument();
    expect(within(workbench).getByLabelText('市场热力')).toBeInTheDocument();
    const marketScope = within(workbench).getByRole('tablist', { name: '市场范围' });
    expect(within(marketScope).getByRole('tab', { name: '沪深' })).toBeInTheDocument();
    expect(within(marketScope).getByRole('tab', { name: 'ETF' })).toBeInTheDocument();
    expect(within(marketScope).queryByRole('tab', { name: '港股' })).not.toBeInTheDocument();
    expect(within(marketScope).queryByRole('tab', { name: '美股' })).not.toBeInTheDocument();
    expect(workbench.querySelectorAll('[draggable="true"]').length).toBeGreaterThan(5);

    await user.click(within(marketScope).getByRole('tab', { name: 'ETF' }));
    expect(within(workbench).getByRole('heading', { name: 'ETF 专区' })).toBeInTheDocument();
    expect(within(workbench).getByRole('button', { name: '查看沪深300ETF详情' })).toBeInTheDocument();
    expect(within(workbench).getByRole('button', { name: '查看创业板ETF详情' })).toBeInTheDocument();
    expect(within(workbench).getByText('2 只')).toBeInTheDocument();
    await user.click(within(workbench).getByRole('button', { name: '返回上一级' }));

    await user.click(within(workbench).getByRole('button', { name: '查看全部市场热力' }));
    expect(within(workbench).getByRole('heading', { name: '热力图' })).toBeInTheDocument();
    const heatViewSwitch = within(workbench).getByRole('tablist', { name: '热力图显示方式' });
    expect(within(heatViewSwitch).getByRole('tab', { name: '矩形热力图' })).toHaveAttribute('aria-selected', 'true');
    expect(within(workbench).getByLabelText('板块热力图')).toBeInTheDocument();
    await user.click(within(heatViewSwitch).getByRole('tab', { name: '排行列表' }));
    expect(within(workbench).getByLabelText('板块涨跌幅排行')).toBeInTheDocument();
    await user.click(within(workbench).getByRole('button', { name: '返回上一级' }));

    await user.click(within(workbench).getAllByRole('button', { name: /查看贵州茅台详情/ })[0]);
    expect(within(workbench).getByRole('heading', { name: '贵州茅台' })).toBeInTheDocument();
    expect(within(workbench).queryByText('二级页面')).not.toBeInTheDocument();
    expect(within(workbench).getByRole('tab', { name: '行情' })).toHaveAttribute('aria-selected', 'true');
    expect(within(workbench).getByRole('tab', { name: '持仓' })).toBeInTheDocument();
    expect(within(workbench).getByLabelText('贵州茅台 K线图')).toBeInTheDocument();
    const klineChart = within(workbench).getByLabelText('贵州茅台 K线图');
    const klineInteraction = klineChart.querySelector('.stock-kline-interaction');
    const activateKline = within(klineChart).getByRole('button', { name: '点击启用K线图交互' });
    expect(klineInteraction).toHaveAttribute('data-chart-interactive', 'false');
    expect(fireEvent.wheel(activateKline, { deltaY: 96 })).toBe(true);
    await user.click(activateKline);
    expect(klineInteraction).toHaveAttribute('data-chart-interactive', 'true');
    expect(within(klineChart).getByText('移动十字线查看详情 · 点击外部退出')).toBeInTheDocument();
    expect(within(klineChart).getByLabelText('最新K线详情')).toHaveTextContent('较前收');
    expect(within(klineChart).getByLabelText('最新K线详情')).toHaveTextContent('K线实体');
    const klineTabs = within(workbench).getByRole('tablist', { name: 'K线周期' });
    expect(within(klineTabs).getByRole('tab', { name: '日K' })).toHaveAttribute('aria-selected', 'true');
    await user.click(within(klineTabs).getByRole('tab', { name: '周K' }));
    expect(within(klineTabs).getByRole('tab', { name: '周K' })).toHaveAttribute('aria-selected', 'true');
    expect(klineInteraction).toHaveAttribute('data-chart-interactive', 'false');
    expect(within(workbench).getByText(/云端 · 东方财富/)).toBeInTheDocument();
    await user.click(within(workbench).getByRole('tab', { name: '资金' }));
    expect(within(workbench).getByText('资金分布')).toBeInTheDocument();
    expect(within(workbench).getByText('资金流向')).toBeInTheDocument();
    expect(within(workbench).getByRole('tablist', { name: '资金流向周期' })).toBeInTheDocument();
    expect(await within(workbench).findByText('腾讯财经免费资金流')).toBeInTheDocument();
    expect(within(workbench).getByText('免费版仅展示各档净额，不把净额反推为各档流入/流出。')).toBeInTheDocument();
    expect(within(workbench).getAllByText('+1.20亿').length).toBeGreaterThan(0);
    expect(within(workbench).getByText('AI 庄家去留研判')).toBeInTheDocument();
    await user.click(within(workbench).getByRole('button', { name: '进入对话研判“庄家是否还在”' }));
    const composer = document.querySelector('.main-stage .composer-card') as HTMLElement;
    expect((within(composer).getByRole('textbox') as HTMLTextAreaElement).value).toContain('做“庄家去留研判”');
    expect((within(composer).getByRole('textbox') as HTMLTextAreaElement).value).toContain('不得把单笔大单或资金流标签直接等同于庄家');
    expect((within(composer).getByRole('textbox') as HTMLTextAreaElement).value).toContain('最近20—60个交易日');
    expect((within(composer).getByRole('textbox') as HTMLTextAreaElement).value).toContain('高概率仍在 / 疑似仍在但有分歧 / 疑似派发或撤退 / 无法判断');
    expect((within(composer).getByRole('textbox') as HTMLTextAreaElement).value).toContain('“庄家仍在”不等于股价一定上涨');
    expect(within(workbench).getByRole('button', { name: '返回上一级' })).toBeInTheDocument();

    await user.click(within(workbench).getByRole('button', { name: '返回上一级' }));
    expect(within(workbench).getByRole('heading', { name: '市场' })).toBeInTheDocument();
    expect(container.querySelector('.market-app')).toBeInTheDocument();
  });

  it('fills every research tool page with structured, filterable content', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByLabelText('打开投研工作台'));
    const workbench = await screen.findByLabelText('投研工作台');
    await waitFor(() => expect(within(workbench).getByText(/云端行情快照/)).toBeInTheDocument());
    await user.click(within(workbench).getByRole('tab', { name: '发现' }));

    await user.click(within(workbench).getByRole('button', { name: /选股器/ }));
    expect(within(workbench).getByRole('tablist', { name: '选股条件' })).toBeInTheDocument();
    expect(within(workbench).getByLabelText('筛选概览')).toBeInTheDocument();
    await user.click(within(workbench).getByRole('button', { name: '返回上一级' }));

    await user.click(within(workbench).getByRole('button', { name: /新股中心/ }));
    expect(within(workbench).getByLabelText('发行概览')).toBeInTheDocument();
    expect(within(workbench).getByRole('tablist', { name: '新股阶段' })).toBeInTheDocument();
    expect(within(workbench).getByText('华芯装备')).toBeInTheDocument();
    await user.click(within(workbench).getByRole('button', { name: '返回上一级' }));

    await user.click(within(workbench).getByRole('button', { name: /财报日历/ }));
    expect(within(workbench).getByRole('tablist', { name: '财报范围' })).toBeInTheDocument();
    expect(within(workbench).getByText('未来披露窗口')).toBeInTheDocument();
    await user.click(within(workbench).getByRole('button', { name: '返回上一级' }));

    await user.click(within(workbench).getByRole('button', { name: /宏观数据/ }));
    expect(within(workbench).getByLabelText('宏观指标看板')).toBeInTheDocument();
    expect(within(workbench).getByText('制造业 PMI')).toBeInTheDocument();
    await user.click(within(workbench).getByRole('button', { name: '返回上一级' }));

    await user.click(within(workbench).getByRole('button', { name: /股息排行/ }));
    expect(within(workbench).getByLabelText('股息池概览')).toBeInTheDocument();
    expect(within(workbench).getByText('收益与稳定性并看')).toBeInTheDocument();
    await user.click(within(workbench).getByRole('button', { name: '返回上一级' }));

    await user.click(within(workbench).getByRole('button', { name: /财经日历/ }));
    expect(within(workbench).getByRole('tablist', { name: '财经日历分类' })).toBeInTheDocument();
    expect(within(workbench).getByText('未来两周')).toBeInTheDocument();
  });

  it('shows all starred stocks by default and filters the watchlist to current holdings', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem('alpha-studio.research-state.v2', JSON.stringify({
      version: 3,
      cash: 100_000,
      netDeposits: 121_000,
      watchlist: ['600519.XSHG', '300750.XSHE'],
      holdings: [{ code: '300750.XSHE', quantity: 100, avgCost: 210, openedAt: Date.now() }],
      portfolios: [],
      trades: [],
      customSecurities: {},
    }));
    render(<App />);

    await user.click(screen.getByLabelText('打开投研工作台'));
    const workbench = await screen.findByLabelText('投研工作台');
    await waitFor(() => expect(within(workbench).getByText(/云端行情快照/)).toBeInTheDocument());
    await user.click(within(workbench).getByRole('tab', { name: /自选/ }));

    const scopeTabs = within(workbench).getByRole('tablist', { name: '自选范围' });
    expect(within(scopeTabs).getByRole('tab', { name: /全部/ })).toHaveAttribute('aria-selected', 'true');
    expect(within(workbench).getByText('全部自选')).toBeInTheDocument();
    expect(within(workbench).getByRole('button', { name: '查看贵州茅台详情' })).toBeInTheDocument();
    expect(within(workbench).getByRole('button', { name: '查看宁德时代详情' })).toBeInTheDocument();
    expect(within(workbench).queryByRole('button', { name: '查看赛力斯详情' })).not.toBeInTheDocument();
    expect(workbench.querySelectorAll('.market-stock-sparkline').length).toBeGreaterThan(0);
    expect(workbench.querySelector('.market-stock-row-main > i')).not.toBeInTheDocument();
    expect(workbench.querySelectorAll('.market-stock-price').length).toBeGreaterThan(0);
    expect(workbench.querySelectorAll('.market-stock-change').length).toBeGreaterThan(0);
    expect(workbench.querySelector('.market-watchlist-card .market-watch-toggle')).not.toBeInTheDocument();
    expect(workbench.querySelector('.market-watchlist-card .market-stock-row-main > .lucide-chevron-right')).not.toBeInTheDocument();

    await user.click(within(scopeTabs).getByRole('tab', { name: /持仓/ }));
    expect(within(scopeTabs).getByRole('tab', { name: /持仓/ })).toHaveAttribute('aria-selected', 'true');
    expect(within(workbench).getByText('我的持仓')).toBeInTheDocument();
    expect(within(workbench).getByRole('button', { name: '查看宁德时代详情' })).toBeInTheDocument();
    expect(within(workbench).queryByRole('button', { name: '查看贵州茅台详情' })).not.toBeInTheDocument();

    const holdingGroup = within(workbench).getByLabelText('整组持仓');
    expect(holdingGroup).toHaveAttribute('draggable', 'true');
    expect(within(holdingGroup).getByText('拖动此处，将整组持仓交给对话')).toBeInTheDocument();
    const dragPayload = new Map<string, string>();
    const dataTransfer = {
      types: ['application/x-alpha-research-context', 'text/plain'],
      getData: (type: string) => dragPayload.get(type) ?? '',
      setData: (type: string, value: string) => { dragPayload.set(type, value); },
      dropEffect: 'none',
      effectAllowed: 'all',
    };
    fireEvent.dragStart(holdingGroup, { dataTransfer });
    expect(dragPayload.get('application/x-alpha-research-context')).toContain('当前持仓明细');
    expect(dragPayload.get('application/x-alpha-research-context')).toContain('宁德时代（300750.XSHE）');
    expect(dragPayload.get('application/x-alpha-research-context')).toContain('成本 210.00');

    const composerCard = document.querySelector('.main-stage .composer-card') as HTMLElement;
    fireEvent.dragOver(composerCard, { dataTransfer });
    fireEvent.drop(composerCard, { dataTransfer });
    expect((within(composerCard).getByRole('textbox') as HTMLTextAreaElement).value).toContain('当前持仓明细');
    expect((within(composerCard).getByRole('textbox') as HTMLTextAreaElement).value).toContain('宁德时代（300750.XSHE）');

    dragPayload.clear();
    const holdingRow = within(workbench).getByRole('button', { name: '查看宁德时代详情' }).closest('.market-stock-row') as HTMLElement;
    fireEvent.dragStart(holdingRow, { dataTransfer });
    expect(dragPayload.get('application/x-alpha-research-context')).toContain('请分析股票 宁德时代');
    expect(dragPayload.get('application/x-alpha-research-context')).not.toContain('当前持仓明细');

    await user.click(within(workbench).getByRole('button', { name: '查看宁德时代详情' }));
    await user.click(within(workbench).getByRole('tab', { name: '持仓' }));
    const position = within(workbench).getByRole('region', { name: '宁德时代持仓信息' });
    expect(within(position).getByText('持仓盈亏')).toBeInTheDocument();
    expect(within(position).getByText('今日盈亏')).toBeInTheDocument();
    expect(within(position).getByText('+500.00')).toBeInTheDocument();
    expect(within(position).getByText('21,000.00')).toBeInTheDocument();
    expect(within(position).getByText('17.36%')).toBeInTheDocument();
    expect(within(position).getAllByText('100 股')).toHaveLength(3);
  });

  it('does not value recorded holdings with offline sample quotes', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem('alpha-studio.research-state.v2', JSON.stringify({
      version: 3,
      cash: 100_000,
      netDeposits: 121_000,
      watchlist: ['600519.XSHG'],
      holdings: [{ code: '600519.XSHG', quantity: 100, avgCost: 1500, openedAt: Date.now() }],
      portfolios: [],
      trades: [],
      customSecurities: {},
    }));
    vi.mocked(fetch).mockImplementation((input?: RequestInfo | URL) => {
      const url = String(input ?? '');
      if (url.includes('/api/market/snapshot')) {
        return Promise.resolve(jsonResponse({ ...cloudMarketSnapshot([]), quotes: [] }));
      }
      return Promise.resolve(jsonResponse({ leaseExpiresAt: futureIso() }));
    });
    render(<App />);

    await user.click(screen.getByLabelText('打开投研工作台'));
    const workbench = await screen.findByLabelText('投研工作台');
    await waitFor(() => expect(within(workbench).getByText(/内置样例 · 云端暂不可用/)).toBeInTheDocument());
    await user.click(within(workbench).getByRole('tab', { name: '资产' }));

    expect(within(workbench).getByText('账户估值已暂停')).toBeInTheDocument();
    expect(within(workbench).getByText(/不会使用内置样例价格计算总资产/)).toBeInTheDocument();
    expect(within(workbench).getByText(/100 股 · 等待可信行情/)).toBeInTheDocument();
    expect(workbench.querySelector('.market-assets-hero')).toHaveTextContent('—');
  });

  it('marks a manual market refresh as a forced upstream refresh', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByLabelText('打开投研工作台'));
    const workbench = await screen.findByLabelText('投研工作台');
    await waitFor(() => expect(within(workbench).getByText(/云端行情快照/)).toBeInTheDocument());
    vi.mocked(fetch).mockClear();
    await user.click(within(workbench).getByLabelText('刷新行情'));

    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([input]) => {
      const url = String(input ?? '');
      return url.includes('/api/market/snapshot') && url.includes('forceRefresh=true');
    })).toBe(true));
  });

  it('searches cloud-market stocks and opens a dedicated stock page', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByLabelText('打开投研工作台'));
    const workbench = await screen.findByLabelText('投研工作台');
    await waitFor(() => expect(within(workbench).getAllByText('赛力斯').length).toBeGreaterThan(0));

    await user.click(within(workbench).getByLabelText('搜索股票'));
    expect(within(workbench).getByRole('heading', { name: '搜索' })).toBeInTheDocument();
    await user.type(within(workbench).getByPlaceholderText('股票名称、代码或行业'), '赛力斯');
    expect(workbench.querySelector('.market-secondary-page .market-stock-row-main > .lucide-chevron-right')).not.toBeInTheDocument();
    await user.click(within(workbench).getByRole('button', { name: '添加自选赛力斯' }));

    const persisted = JSON.parse(window.localStorage.getItem('alpha-studio.research-state.v2') || '{}');
    expect(persisted.customSecurities?.['601127.XSHG']?.name).toBe('赛力斯');
    expect(persisted.watchlist).toContain('601127.XSHG');

    await user.click(within(workbench).getByRole('button', { name: '查看赛力斯详情' }));
    expect(within(workbench).getByRole('heading', { name: '赛力斯' })).toBeInTheDocument();
    expect(within(workbench).getByRole('button', { name: '返回上一级' })).toBeInTheDocument();
  });

  it('supports local live-trade records, funding and assets in the bottom navigation', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByLabelText('打开投研工作台'));
    const workbench = await screen.findByLabelText('投研工作台');
    await waitFor(() => expect(within(workbench).getByText(/云端行情快照/)).toBeInTheDocument());
    await user.click(within(workbench).getByRole('tab', { name: '实盘' }));

    expect(within(workbench).getByLabelText('实盘交易记录')).toBeInTheDocument();
    expect(within(workbench).getByLabelText('成交日期与时间')).toHaveAttribute('type', 'datetime-local');
    expect(within(workbench).getByLabelText('入金出金金额')).toBeInTheDocument();
    expect(within(workbench).getByRole('button', { name: '记录入金' })).toBeInTheDocument();
    expect(within(workbench).getByRole('button', { name: '记录出金' })).toBeInTheDocument();

    await user.click(within(workbench).getByRole('button', { name: '记录入金' }));
    expect(within(workbench).getByText(/入金 10\.00万 记录已保存/)).toBeInTheDocument();

    await user.click(within(workbench).getByRole('tab', { name: '资产' }));
    expect(within(workbench).getByRole('heading', { name: '资产' })).toBeInTheDocument();
    expect(within(workbench).getByText(/总资产 · 实盘记录/)).toBeInTheDocument();
    await user.click(within(workbench).getByRole('button', { name: /股票组合/ }));
    expect(within(workbench).getByRole('heading', { name: '股票组合' })).toBeInTheDocument();
    expect(within(workbench).getByRole('button', { name: '返回上一级' })).toBeInTheDocument();
  });

  it('creates, edits and deletes a persisted stock portfolio', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByLabelText('打开投研工作台'));
    const workbench = await screen.findByLabelText('投研工作台');
    await waitFor(() => expect(within(workbench).getByText(/云端行情快照/)).toBeInTheDocument());
    await user.click(within(workbench).getByRole('tab', { name: '资产' }));
    await user.click(within(workbench).getByRole('button', { name: /股票组合/ }));

    await user.click(within(workbench).getByRole('button', { name: '新建组合' }));
    await user.type(within(workbench).getByLabelText('组合名称'), 'AI 算力跟踪');
    await user.type(within(workbench).getByLabelText('组合备注'), '观察产业链催化');
    await user.click(within(workbench).getByRole('button', { name: '添加宁德时代' }));
    await user.click(within(workbench).getByRole('button', { name: '创建组合' }));

    expect(within(workbench).getByText('AI 算力跟踪')).toBeInTheDocument();
    let persisted = JSON.parse(window.localStorage.getItem('alpha-studio.research-state.v2') || '{}');
    expect(persisted.portfolios.at(-1)).toMatchObject({ name: 'AI 算力跟踪', codes: ['300750.XSHE'], note: '观察产业链催化' });

    await user.click(within(workbench).getByRole('button', { name: '编辑组合AI 算力跟踪' }));
    const nameInput = within(workbench).getByLabelText('组合名称');
    await user.clear(nameInput);
    await user.type(nameInput, 'AI 成长组合');
    await user.click(within(workbench).getByRole('button', { name: '添加贵州茅台' }));
    await user.click(within(workbench).getByRole('button', { name: '保存修改' }));

    expect(within(workbench).getByText('AI 成长组合')).toBeInTheDocument();
    persisted = JSON.parse(window.localStorage.getItem('alpha-studio.research-state.v2') || '{}');
    expect(persisted.portfolios.at(-1)).toMatchObject({ name: 'AI 成长组合', codes: ['300750.XSHE', '600519.XSHG'] });

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await user.click(within(workbench).getByRole('button', { name: '删除组合AI 成长组合' }));
    expect(within(workbench).queryByText('AI 成长组合')).not.toBeInTheDocument();
    persisted = JSON.parse(window.localStorage.getItem('alpha-studio.research-state.v2') || '{}');
    expect(persisted.portfolios.some((portfolio: { name: string }) => portfolio.name === 'AI 成长组合')).toBe(false);
  });

  it('closes the right sidebar before opening the skills page', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByLabelText('打开浏览器'));
    expect(container.querySelector('.browser-dock-panel')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '技能' }));

    const skillsPage = container.querySelector('.skills-page') as HTMLElement;
    const dock = container.querySelector('.right-dock-workspace') as HTMLElement;
    expect(skillsPage).toBeInTheDocument();
    expect(dock).toHaveClass('collapsed');
    expect(screen.queryByLabelText('关闭浏览器')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('打开 AI 同事面板')).not.toBeInTheDocument();
  });

  it('closes the right sidebar and removes workspace toggles before opening settings', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByLabelText('打开浏览器'));
    await user.click(within(container.querySelector('.sidebar') as HTMLElement).getByRole('button', { name: '设置' }));

    const dock = container.querySelector('.right-dock-workspace') as HTMLElement;
    expect(screen.getByRole('dialog', { name: '设置' })).toBeInTheDocument();
    expect(dock).toHaveClass('collapsed');
    expect(screen.queryByLabelText('关闭浏览器')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('打开浏览器')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('打开 AI 同事面板')).not.toBeInTheDocument();
  });

  it('opens the AI coworkers panel from the top-right toggle', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    const coworkersToggle = screen.getByLabelText('打开 AI 同事面板');

    expect(coworkersToggle).toHaveAttribute('aria-pressed', 'false');

    await user.click(coworkersToggle);

    const panel = container.querySelector('.coworkers-panel') as HTMLElement;
    expect(panel).toBeInTheDocument();
    expect(within(panel).getByText('AI 投研团队')).toBeInTheDocument();
    expect(within(panel).getByText('9 位在线')).toBeInTheDocument();
    expect(container.querySelectorAll('.coworker-card')).toHaveLength(9);
    const workflowsToggle = within(panel).getByRole('tab', { name: /协作模板/ });
    expect(workflowsToggle).toHaveAttribute('aria-selected', 'false');
    expect(within(panel).queryByText('盘前投资委员会')).not.toBeInTheDocument();
    expect(within(panel).getByText('市场策略官')).toBeInTheDocument();
    expect(within(panel).getByText('基金经理副官')).toBeInTheDocument();
    expect(screen.getByLabelText('关闭 AI 同事面板')).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByLabelText('关闭 AI 同事面板'));

    expect(container.querySelector('.right-dock-workspace')).toHaveClass('collapsed');
  });

  it('keeps the original right sidebar available while AI coworkers are open', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByLabelText('打开 AI 同事面板'));

    expect(container.querySelector('.coworkers-panel')).toBeInTheDocument();
    expect(screen.getByLabelText('打开浏览器')).toHaveAttribute('aria-pressed', 'false');

    await user.click(screen.getByLabelText('打开浏览器'));

    expect(container.querySelector('.browser-dock-panel')).toBeInTheDocument();
    expect(container.querySelector('.coworkers-panel')).not.toBeInTheDocument();
    expect(screen.getByLabelText('关闭浏览器')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('打开 AI 同事面板')).toHaveAttribute('aria-pressed', 'false');
  });

  it('restores the active right-dock tab after visiting AI coworkers', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByLabelText('打开浏览器'));

    expect(container.querySelector('.right-dock-tab.active')).toHaveTextContent('新标签');
    expect(container.querySelector('.browser-dock-panel')).toBeInTheDocument();

    await user.click(screen.getByLabelText('打开 AI 同事面板'));
    expect(container.querySelector('.coworkers-panel')).toBeInTheDocument();

    await user.click(screen.getByLabelText('打开浏览器'));

    expect(container.querySelector('.coworkers-panel')).not.toBeInTheDocument();
    expect(container.querySelector('.right-dock-tab.active')).toHaveTextContent('新标签');
    expect(container.querySelector('.browser-dock-panel')).toBeInTheDocument();
    expect(container.querySelectorAll('.right-dock-tab')).toHaveLength(1);
  });

  it('prefills the composer from an empty-state suggestion without sending', async () => {
    const user = userEvent.setup();
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    useChatStore.setState({
      conversations: [conversation({ messages: [] })],
      currentConversationId: 'conv-right-panel',
      sendMessage,
    });
    const { container } = render(<App />);

    const composerCard = container.querySelector('.main-stage .composer-card') as HTMLElement;
    expect(composerCard).not.toHaveClass('compact');
    const textbox = within(composerCard).getByRole('textbox');
    const suggestions = [
      ['生成今日报告', `使用 $${ALPHA_STUDIO_DAILY_THEME_SKILL_ID} 生成今日的报告`],
      ['产业主线早报', MAINLINE_TREND_CARD_PROMPT],
      ['盘中监控', INTRADAY_MONITOR_CARD_PROMPT],
      ['晚间复盘', REPORT_REVIEW_CARD_PROMPT],
      ['核验研究证据', EVIDENCE_INTELLIGENCE_CARD_PROMPT],
      ['公司 Thesis', COMPANY_THESIS_CARD_PROMPT],
      ['研究校准', RESEARCH_CALIBRATION_CARD_PROMPT],
      ['挖掘量化因子', FACTOR_MINING_CARD_PROMPT],
    ];

    for (const [title, prompt] of suggestions) {
      await user.click(screen.getByRole('button', { name: new RegExp(title) }));
      expect(textbox).toHaveValue(prompt);
    }
    expect(screen.getByRole('button', { name: /生成今日报告/ }).querySelector('.lucide-file-chart-column')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /产业主线早报/ }).querySelector('.lucide-network')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /盘中监控/ }).querySelector('.lucide-activity')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /晚间复盘/ }).querySelector('.lucide-moon-star')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /核验研究证据/ }).querySelector('.lucide-database')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /公司 Thesis/ }).querySelector('.lucide-target')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /研究校准/ }).querySelector('.lucide-sliders-horizontal')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /挖掘量化因子/ }).querySelector('.lucide-chart-candlestick')).toBeInTheDocument();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('pastes images and files into the composer as readable desktop attachments', async () => {
    (window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    const { container } = render(<App />);
    const composerCard = container.querySelector('.main-stage .composer-card') as HTMLElement;
    const textbox = within(composerCard).getByRole('textbox');
    const image = new File([new Uint8Array([137, 80, 78, 71])], 'chart.png', { type: 'image/png' });
    const document = new File(['research notes'], 'notes.pdf', { type: 'application/pdf' });

    fireEvent.paste(textbox, { clipboardData: { files: [image, document], items: [] } });

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('clipboard_attachment_save', {
      request: { name: 'chart.png', data: 'iVBORw==' },
    }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('clipboard_attachment_save', {
      request: { name: 'notes.pdf', data: 'cmVzZWFyY2ggbm90ZXM=' },
    }));
    expect(await within(composerCard).findByAltText('chart.png')).toBeInTheDocument();
    expect(within(composerCard).getByRole('button', { name: '查看图片 chart.png' })).toHaveClass('att-thumb-preview');
    expect(within(composerCard).getByRole('button', { name: '移除 chart.png' })).toBeInTheDocument();
    expect(within(composerCard).getByText('notes.pdf')).toBeInTheDocument();
    expect(within(composerCard).getByLabelText('发送')).toBeEnabled();
  });

  it('renders sent images as clickable thumbnail buttons', async () => {
    const user = userEvent.setup();
    useChatStore.setState({
      conversations: [conversation({
        messages: [{
          id: 'msg-with-images',
          role: 'user',
          timestamp: 1,
          blocks: [{ type: 'text', content: '参考图' }],
          attachments: [
            { id: 'image-1', name: 'one.png', kind: 'image', ext: 'png', previewUrl: 'data:image/png;base64,one' },
            { id: 'image-2', name: 'two.png', kind: 'image', ext: 'png', previewUrl: 'data:image/png;base64,two' },
          ],
        }],
      })],
    });
    const { container } = render(<App />);
    const list = container.querySelector('.message-list') as HTMLElement;

    expect(list.querySelectorAll('.message-image')).toHaveLength(2);
    await user.click(within(list).getByRole('button', { name: '查看图片 one.png' }));
    expect(screen.getByRole('dialog', { name: 'one.png' })).toBeInTheDocument();
  });

  it('does not show persistent context window usage in the composer', () => {
    const { container } = render(<App />);
    const composerCard = container.querySelector('.main-stage .composer-card') as HTMLElement;

    expect(composerCard.querySelector('.context-window-indicator')).not.toBeInTheDocument();
    expect(within(composerCard).queryByText(/% 已用/)).not.toBeInTheDocument();
  });

  it('shows automatic context compaction only as a conversation event while it is running', () => {
    useChatStore.setState({
      conversations: [conversation({
        status: 'streaming',
        messages: [
          { id: 'msg-1', role: 'user', timestamp: 1, blocks: [{ type: 'text', content: '继续分析' }] },
          {
            id: 'msg-2',
            role: 'assistant',
            timestamp: 2,
            isStreaming: true,
            blocks: [{ type: 'tool', id: 'compact-1', title: 'context_compaction', status: 'in_progress' }],
          },
        ],
      })],
    });

    const { container } = render(<App />);

    expect(screen.getByText('正在自动压缩上下文')).toBeInTheDocument();
    expect(container.querySelector('.context-window-indicator')).not.toBeInTheDocument();
  });

  it('explains prolonged streaming silence and offers an inline stop action', async () => {
    const user = userEvent.setup();
    const now = Date.now();
    useChatStore.setState({
      conversations: [conversation({
        status: 'streaming',
        updatedAt: now - 309_000,
        messages: [
          { id: 'msg-1', role: 'user', timestamp: now - 465_000, blocks: [{ type: 'text', content: '生成报告' }] },
          { id: 'msg-2', role: 'assistant', timestamp: now - 464_000, isStreaming: true, blocks: [] },
        ],
      })],
    });

    render(<App />);

    const indicator = screen.getByRole('status', { name: '等待模型响应较久' });
    expect(indicator).toHaveAttribute('data-state', 'stalled');
    expect(indicator).toHaveTextContent(/总计 7分4[4-5]秒/);
    expect(indicator).toHaveTextContent(/5分(?:9|10)秒没有新进展/);
    expect(within(indicator).getByRole('button', { name: '停止当前任务' })).toBeInTheDocument();

    await user.click(within(indicator).getByRole('button', { name: '停止当前任务' }));

    await waitFor(() => expect(useChatStore.getState().conversations[0].status).toBe('idle'));
    expect(screen.queryByRole('status', { name: '等待模型响应较久' })).not.toBeInTheDocument();
  });

  it('returns the waiting indicator to normal as soon as new progress arrives', () => {
    const now = Date.now();
    useChatStore.setState({
      conversations: [conversation({
        status: 'streaming',
        updatedAt: now - 75_000,
        messages: [
          { id: 'msg-1', role: 'user', timestamp: now - 120_000, blocks: [{ type: 'text', content: '继续分析' }] },
          { id: 'msg-2', role: 'assistant', timestamp: now - 119_000, isStreaming: true, blocks: [] },
        ],
      })],
    });

    render(<App />);

    expect(screen.getByRole('status', { name: '任务仍在运行' })).toHaveAttribute('data-state', 'waiting');
    act(() => {
      const current = useChatStore.getState().conversations[0];
      useChatStore.setState({ conversations: [{ ...current, updatedAt: Date.now() }] });
    });

    expect(screen.getByRole('status', { name: '正在处理' })).toHaveAttribute('data-state', 'active');
    expect(screen.queryByText(/没有新进展/)).not.toBeInTheDocument();
  });

  it('only follows streaming messages while the conversation scroll is near the bottom', () => {
    useChatStore.setState({
      conversations: [conversation({
        status: 'streaming',
        messages: [
          { id: 'msg-1', role: 'user', timestamp: 1, blocks: [{ type: 'text', content: '继续分析' }] },
          { id: 'msg-2', role: 'assistant', timestamp: 2, isStreaming: true, blocks: [{ type: 'text', content: '第一段' }] },
        ],
      })],
    });
    const { container } = render(<App />);
    const messageScroll = container.querySelector('.message-scroll') as HTMLDivElement;
    let scrollHeight = 1_000;
    let scrollTop = 700;
    const setScrollTop = vi.fn((value: number) => {
      scrollTop = Math.min(value, scrollHeight - 300);
    });
    Object.defineProperties(messageScroll, {
      clientHeight: { configurable: true, get: () => 300 },
      scrollHeight: { configurable: true, get: () => scrollHeight },
      scrollTop: { configurable: true, get: () => scrollTop, set: setScrollTop },
    });
    const updateStreamingText = (content: string) => {
      const current = useChatStore.getState().conversations[0];
      useChatStore.setState({
        conversations: [{
          ...current,
          messages: current.messages.map((message) => message.id === 'msg-2'
            ? { ...message, blocks: [{ type: 'text', content }] }
            : message),
        }],
      });
    };

    fireEvent.scroll(messageScroll);
    scrollHeight = 1_100;
    act(() => updateStreamingText('第一段，继续生成'));
    expect(setScrollTop).toHaveBeenLastCalledWith(1_100);
    expect(scrollTop).toBe(800);

    scrollTop = 400;
    fireEvent.scroll(messageScroll);
    setScrollTop.mockClear();
    scrollHeight = 1_200;
    act(() => updateStreamingText('第一段，继续生成。用户正在查看上文'));
    expect(setScrollTop).not.toHaveBeenCalled();
    expect(scrollTop).toBe(400);

    scrollTop = 900;
    fireEvent.scroll(messageScroll);
    scrollHeight = 1_300;
    act(() => updateStreamingText('第一段，继续生成。用户已经回到最新内容'));
    expect(setScrollTop).toHaveBeenLastCalledWith(1_300);
    expect(scrollTop).toBe(1_000);
  });

  it('mounts long transcripts in bounded batches and keeps older messages available', async () => {
    const user = userEvent.setup();
    const messages = Array.from({ length: 120 }, (_, index) => ({
      id: `long-message-${index}`,
      role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
      timestamp: index + 1,
      blocks: [{ type: 'text' as const, content: `第 ${index + 1} 条消息` }],
    }));
    useChatStore.setState({ conversations: [conversation({ messages })] });

    const { container } = render(<App />);
    const list = container.querySelector('.message-list') as HTMLElement;

    expect(list.querySelectorAll('[data-message-id]')).toHaveLength(48);
    expect(list.querySelector('[data-message-id="long-message-0"]')).not.toBeInTheDocument();
    expect(list.querySelector('[data-message-id="long-message-119"]')).toBeInTheDocument();
    expect(within(list).getByText('还有 72 条较早记录')).toBeInTheDocument();

    await user.click(within(list).getByRole('button', { name: '加载更早的 48 条消息' }));
    expect(list.querySelectorAll('[data-message-id]')).toHaveLength(96);
    expect(within(list).getByText('还有 24 条较早记录')).toBeInTheDocument();

    await user.click(within(list).getByRole('button', { name: '加载更早的 24 条消息' }));
    expect(list.querySelectorAll('[data-message-id]')).toHaveLength(120);
    expect(list.querySelector('[data-message-id="long-message-0"]')).toBeInTheDocument();
    expect(list.querySelector('.message-history-loader')).not.toBeInTheDocument();
  });

  it('freezes large completed Markdown chunks but keeps open code fences together', () => {
    const completedChunk = `${'长期研究结论。'.repeat(700)}\n\n`;
    const split = splitStreamingMarkdown(`${completedChunk}仍在生成的尾部`);
    expect(split.settled).toEqual([completedChunk]);
    expect(split.active).toBe('仍在生成的尾部');

    const openFence = `\`\`\`ts\n${'const value = 1;\n\n'.repeat(300)}`;
    const fencedSplit = splitStreamingMarkdown(openFence);
    expect(fencedSplit.settled).toEqual([]);
    expect(fencedSplit.active).toBe(openFence);
  });

  it('imports a coworker preset task into the composer with one click', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByLabelText('打开 AI 同事面板'));
    const panel = container.querySelector('.coworkers-panel') as HTMLElement;
    const head = within(panel).getByRole('button', { name: /①市场策略官/ });
    await user.click(head);
    const card = head.closest('.coworker-card') as HTMLElement;
    await user.click(within(card).getByRole('button', { name: /今日市场主线/ }));

    const composerCard = container.querySelector('.main-stage .composer-card') as HTMLElement;
    expect(within(composerCard).getByText('市场策略官')).toBeInTheDocument();
    const textarea = within(composerCard).getByRole('textbox') as HTMLTextAreaElement;
    expect(textarea.value).toContain('梳理今天市场的主线');
  });

  it('imports a coworker workflow preset into the composer with one click', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByLabelText('打开 AI 同事面板'));
    const panel = container.querySelector('.coworkers-panel') as HTMLElement;
    await user.click(within(panel).getByRole('tab', { name: /协作模板/ }));
    const workflow = within(panel).getByText('盘前投资委员会').closest('.coworker-workflow') as HTMLElement;
    await user.click(within(workflow).getByRole('button', { name: /召集/ }));

    const composerCard = container.querySelector('.main-stage .composer-card') as HTMLElement;
    expect(composerCard.querySelectorAll('.composer-coworker-chip')).toHaveLength(6);
    expect(within(composerCard).getByText('市场策略官')).toBeInTheDocument();
    expect(within(composerCard).getByText('行业主题研究员')).toBeInTheDocument();
    expect(within(composerCard).getByText('风险控制官')).toBeInTheDocument();
    const textarea = within(composerCard).getByRole('textbox') as HTMLTextAreaElement;
    expect(textarea.value).toContain('请召开一次盘前投资委员会');
  });

  it('deduplicates coworkers when importing a workflow preset', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByLabelText('打开 AI 同事面板'));
    const panel = container.querySelector('.coworkers-panel') as HTMLElement;
    await user.click(within(panel).getByRole('button', { name: '召集 风险控制官 到对话框' }));

    await user.click(within(panel).getByRole('tab', { name: /协作模板/ }));
    const workflow = within(panel).getByText('盘前投资委员会').closest('.coworker-workflow') as HTMLElement;
    await user.click(within(workflow).getByRole('button', { name: /召集/ }));

    const composerCard = container.querySelector('.main-stage .composer-card') as HTMLElement;
    expect(composerCard.querySelectorAll('.composer-coworker-chip')).toHaveLength(6);
    expect(within(composerCard).getAllByText('风险控制官')).toHaveLength(1);
  });

  it('shows the Alpha Studio premarket skill in the composer skills menu', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    const composerCard = container.querySelector('.main-stage .composer-card') as HTMLElement;

    await user.click(within(composerCard).getByLabelText('添加内容'));
    const flyoutRow = document.querySelector('.plus-menu .plus-flyout-row') as HTMLElement;
    expect(flyoutRow).toBeInTheDocument();
    fireEvent.mouseEnter(flyoutRow);

    expect(await screen.findByRole('menuitem', { name: '$alpha-studio-daily-theme-research' })).toBeInTheDocument();
  });

  it('collects multiple coworkers dropped onto the composer without duplicates', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    const composerCard = container.querySelector('.main-stage .composer-card') as HTMLElement;

    const dropCoworker = (payload: { id: string; no: string; name: string }) => {
      const dataTransfer = {
        types: ['application/x-alpha-coworker'],
        getData: (type: string) =>
          type === 'application/x-alpha-coworker' ? JSON.stringify(payload) : '',
        setData: vi.fn(),
        dropEffect: 'none',
        effectAllowed: 'all',
      };
      fireEvent.dragOver(composerCard, { dataTransfer });
      expect(composerCard).toHaveClass('coworker-drag-over');
      fireEvent.drop(composerCard, { dataTransfer });
    };

    dropCoworker({ id: 'mainline', no: '①', name: '主线交易官' });
    dropCoworker({ id: 'risk', no: '⑦', name: '风险控制官' });
    dropCoworker({ id: 'mainline', no: '①', name: '主线交易官' });

    expect(composerCard).not.toHaveClass('coworker-drag-over');
    const chips = composerCard.querySelectorAll('.composer-coworker-chip');
    expect(chips).toHaveLength(2);
    expect(within(composerCard).getByText('召集同事协同')).toBeInTheDocument();
    expect(within(composerCard).getByText('主线交易官')).toBeInTheDocument();
    expect(within(composerCard).getByText('风险控制官')).toBeInTheDocument();

    await user.click(within(composerCard).getByLabelText('移除 风险控制官'));

    expect(composerCard.querySelectorAll('.composer-coworker-chip')).toHaveLength(1);
    expect(within(composerCard).getByText('召集同事')).toBeInTheDocument();
  });

  it('drops research context into the composer as a natural-language prompt', () => {
    const { container } = render(<App />);
    const composerCard = container.querySelector('.main-stage .composer-card') as HTMLElement;
    const dataTransfer = {
      types: ['application/x-alpha-research-context'],
      getData: (type: string) =>
        type === 'application/x-alpha-research-context'
          ? '请分析股票 平安银行（000001.XSHE）。\n当前价格 11.42。'
          : '',
      setData: vi.fn(),
      dropEffect: 'none',
      effectAllowed: 'all',
    };

    fireEvent.dragOver(composerCard, { dataTransfer });
    expect(composerCard).toHaveClass('coworker-drag-over');
    fireEvent.drop(composerCard, { dataTransfer });

    const textarea = within(composerCard).getByRole('textbox') as HTMLTextAreaElement;
    expect(textarea.value).toContain('请分析股票 平安银行');
    expect(textarea.value).toContain('000001.XSHE');
  });

  it('keeps coding-only tabs out while exposing research files in the right sidebar add menu', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByLabelText('打开浏览器'));
    const dock = container.querySelector('.right-dock-workspace') as HTMLElement;
    await user.click(within(dock).getByLabelText('添加侧边栏标签'));
    const tabMenu = container.querySelector('.right-dock-tab-menu') as HTMLElement;

    expect(within(tabMenu).getByRole('button', { name: /浏览器/ })).toBeInTheDocument();
    expect(within(tabMenu).queryByRole('button', { name: /侧边聊天/ })).not.toBeInTheDocument();
    expect(within(tabMenu).queryByRole('button', { name: /审查/ })).not.toBeInTheDocument();
    expect(within(tabMenu).queryByRole('button', { name: /^终端$/ })).not.toBeInTheDocument();
    expect(within(tabMenu).getByRole('button', { name: /文件/ })).toBeInTheDocument();
  });

  it('browses the research directory and drops file or folder paths into the composer', async () => {
    const user = userEvent.setup();
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
    const { container } = render(<App />);

    await user.click(screen.getByLabelText('打开浏览器'));
    const dock = container.querySelector('.right-dock-workspace') as HTMLElement;
    await user.click(within(dock).getByLabelText('添加侧边栏标签'));
    await user.click(within(container.querySelector('.right-dock-tab-menu') as HTMLElement).getByRole('button', { name: /文件/ }));

    const filePanel = await screen.findByLabelText('研究主题文件');
    expect(await within(filePanel).findByText('overview.md')).toBeInTheDocument();
    await user.click(within(filePanel).getByText('docs'));
    expect(await within(filePanel).findByText('sources.pdf')).toBeInTheDocument();

    const transferValues = new Map<string, string>();
    const dataTransfer = {
      types: [] as string[],
      effectAllowed: 'all',
      dropEffect: 'none',
      setData: vi.fn((type: string, value: string) => {
        transferValues.set(type, value);
        if (!dataTransfer.types.includes(type)) dataTransfer.types.push(type);
      }),
      getData: vi.fn((type: string) => transferValues.get(type) || ''),
    };
    const fileRow = within(filePanel).getByRole('treeitem', { name: /overview\.md/ });
    fireEvent.dragStart(fileRow, { dataTransfer });

    const composerCard = container.querySelector('.main-stage .composer-card') as HTMLElement;
    fireEvent.dragOver(composerCard, { dataTransfer });
    expect(composerCard).toHaveClass('path-drag-over');
    fireEvent.drop(composerCard, { dataTransfer });

    expect(await within(composerCard).findByText('overview.md')).toBeInTheDocument();
    expect(composerCard).not.toHaveClass('path-drag-over');

    const directoryRow = within(filePanel).getByRole('treeitem', { name: /docs/ });
    fireEvent.dragStart(directoryRow, { dataTransfer });
    fireEvent.dragOver(composerCard, { dataTransfer });
    fireEvent.drop(composerCard, { dataTransfer });

    expect(await within(composerCard).findByText('文件夹路径')).toBeInTheDocument();
    expect(within(composerCard).getByText('docs')).toBeInTheDocument();
  });

  it('opens the skills page from the sidebar skills menu', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByRole('button', { name: '技能' }));

    const skillsPage = container.querySelector('.skills-page') as HTMLElement;
    expect(skillsPage).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '设置' })).not.toBeInTheDocument();
    expect(within(skillsPage).getByRole('heading', { name: '技能' })).toBeInTheDocument();
    expect(within(skillsPage).queryByLabelText('收起侧栏')).not.toBeInTheDocument();
    expect(within(skillsPage).queryByLabelText('展开侧栏')).not.toBeInTheDocument();
    expect(within(skillsPage).getByPlaceholderText('搜索技能')).toBeInTheDocument();
    expect(within(skillsPage).getByText('官方')).toBeInTheDocument();
    expect(within(skillsPage).getByText('个人')).toBeInTheDocument();
    expect(within(skillsPage).getByText('系统')).toBeInTheDocument();
    expect(within(skillsPage).getByText('Browser')).toBeInTheDocument();
    expect(within(skillsPage).getByText('Alpha Studio A股因子挖掘')).toBeInTheDocument();
    expect(within(skillsPage).getByText('Alpha Studio 盘前主题')).toBeInTheDocument();
    expect(within(skillsPage).queryByText('iOS App Intents')).not.toBeInTheDocument();
    expect(within(skillsPage).queryByText('SwiftUI Performance Audit')).not.toBeInTheDocument();
    expect(within(skillsPage).getByText('Skill Installer')).toBeInTheDocument();
  });

  it('shows a sidebar reopen button on the skills page after collapsing the sidebar', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByRole('button', { name: '技能' }));
    await user.click(screen.getByRole('button', { name: '收起侧栏' }));

    const skillsPage = container.querySelector('.skills-page') as HTMLElement;
    expect(container.querySelector('.app-shell')).toHaveClass('sidebar-collapsed');

    await user.click(within(skillsPage).getByLabelText('展开侧栏'));

    expect(container.querySelector('.app-shell')).not.toHaveClass('sidebar-collapsed');
    expect(container.querySelector('.sidebar')).not.toHaveClass('collapsed');
    expect(within(skillsPage).queryByLabelText('展开侧栏')).not.toBeInTheDocument();
  });

  it('opens the automations page from the sidebar automation menu', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByRole('button', { name: '自动化' }));

    const automationPage = container.querySelector('.automation-page') as HTMLElement;
    expect(automationPage).toBeInTheDocument();
    expect(container.querySelector('.top-bar')).not.toBeInTheDocument();
    expect(automationPage.querySelector('.automation-topbar')).toHaveAttribute('data-tauri-drag-region', 'deep');
    expect(screen.queryByRole('dialog', { name: '设置' })).not.toBeInTheDocument();
    expect(within(automationPage).getByRole('heading', { name: '已安排的任务' })).toBeInTheDocument();
    expect(within(automationPage).getByRole('tab', { name: '已安排' })).toHaveAttribute('aria-selected', 'true');
    expect(within(automationPage).getByRole('button', { name: '创建计划任务' })).toBeInTheDocument();
    expect(within(automationPage).getByText('创建首个已安排任务')).toBeInTheDocument();
  });

  it('opens the manual automation editor from the create button', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByRole('button', { name: '自动化' }));
    const automationPage = container.querySelector('.automation-page') as HTMLElement;
    await user.click(within(automationPage).getByRole('button', { name: '创建计划任务' }));

    const editor = within(automationPage).getByRole('complementary', { name: '手动创建自动化任务' });
    expect(within(editor).getByPlaceholderText('已安排任务标题')).toBeInTheDocument();
    expect(within(editor).getByPlaceholderText('描述 GPT 应该做什么')).toBeInTheDocument();
    expect(within(editor).getByLabelText('运行于')).toHaveValue('工作树');
    expect(within(editor).getByLabelText('重复')).toHaveValue('daily');
    expect(within(editor).getByLabelText('时间')).toHaveTextContent('9:00');
    expect(within(editor).getByLabelText('模型')).toHaveValue('gpt-5.5');
  });

  it('uses a compact keyboard-friendly time picker for automation schedules', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByRole('button', { name: '自动化' }));
    const automationPage = container.querySelector('.automation-page') as HTMLElement;
    await user.click(within(automationPage).getByRole('button', { name: '创建计划任务' }));

    const editor = within(automationPage).getByRole('complementary', { name: '手动创建自动化任务' });
    const timeTrigger = within(editor).getByRole('button', { name: '时间' });
    expect(timeTrigger).toHaveAttribute('aria-expanded', 'false');
    expect(timeTrigger).toHaveTextContent('9:00');

    await user.click(timeTrigger);
    let timePicker = within(editor).getByRole('dialog', { name: '选择时间' });
    expect(timeTrigger).toHaveAttribute('aria-expanded', 'true');
    expect(within(timePicker).getByRole('button', { name: '9 时' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(within(timePicker).getByRole('button', { name: '14 时' }));
    expect(timeTrigger).toHaveTextContent('14:00');
    timePicker = within(editor).getByRole('dialog', { name: '选择时间' });
    await user.click(within(timePicker).getByRole('button', { name: '30 分' }));

    expect(within(editor).queryByRole('dialog', { name: '选择时间' })).not.toBeInTheDocument();
    expect(timeTrigger).toHaveTextContent('14:30');
    await user.keyboard('{ArrowUp}');
    expect(timeTrigger).toHaveTextContent('14:45');

    await user.click(timeTrigger);
    expect(within(editor).getByRole('dialog', { name: '选择时间' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(within(editor).queryByRole('dialog', { name: '选择时间' })).not.toBeInTheDocument();
  });

  it('opens the automation time picker upward when the lower viewport has no room', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByRole('button', { name: '自动化' }));
    const automationPage = container.querySelector('.automation-page') as HTMLElement;
    await user.click(within(automationPage).getByRole('button', { name: '创建计划任务' }));

    const editor = within(automationPage).getByRole('complementary', { name: '手动创建自动化任务' });
    const timeTrigger = within(editor).getByRole('button', { name: '时间' });
    vi.stubGlobal('innerHeight', 720);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function getBoundingClientRect(this: HTMLElement) {
      if (this === timeTrigger) {
        return { x: 900, y: 530, left: 900, top: 530, right: 1100, bottom: 560, width: 200, height: 30, toJSON: () => ({}) } as DOMRect;
      }
      if (this.classList.contains('automation-time-popover')) {
        return { x: 818, y: 568, left: 818, top: 568, right: 1100, bottom: 848, width: 282, height: 280, toJSON: () => ({}) } as DOMRect;
      }
      return { x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) } as DOMRect;
    });

    await user.click(timeTrigger);

    await waitFor(() => expect(within(editor).getByRole('dialog', { name: '选择时间' })).toHaveClass('open-above'));
  });

  it('does not show the left sidebar collapse button in the automation page', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByRole('button', { name: '自动化' }));
    const automationPage = container.querySelector('.automation-page') as HTMLElement;
    await user.click(within(automationPage).getByRole('button', { name: '创建计划任务' }));

    expect(within(automationPage).getByRole('complementary', { name: '手动创建自动化任务' })).toBeInTheDocument();
    expect(within(automationPage).queryByLabelText('收起侧栏')).not.toBeInTheDocument();
    expect(within(automationPage).queryByLabelText('展开侧栏')).not.toBeInTheDocument();
  });

  it('offers richer automation schedules and usage-based models', async () => {
    const user = userEvent.setup();
    useChatStore.setState({
      modelProfiles: [
        ...defaultModelProfiles(),
        {
          id: 'gateway:gpt-5.5',
          label: 'GPT-5.5 API',
          providerId: ALPHA_GATEWAY_PROVIDER_ID,
          model: 'gpt-5.5',
          wireApi: 'responses',
          enabled: true,
          supportsReasoningEffort: true,
        },
      ],
    });
    const { container } = render(<App />);

    await user.click(screen.getByRole('button', { name: '自动化' }));
    const automationPage = container.querySelector('.automation-page') as HTMLElement;
    await user.click(within(automationPage).getByRole('button', { name: '创建计划任务' }));

    const editor = within(automationPage).getByRole('complementary', { name: '手动创建自动化任务' });
    const repeatSelect = within(editor).getByLabelText('重复') as HTMLSelectElement;
    expect(Array.from(repeatSelect.options).map((option) => option.value)).toEqual([
      'daily',
      'weekdays',
      'weekly',
      'monthly',
      'interval',
      'custom',
    ]);

    await user.selectOptions(repeatSelect, 'weekly');
    expect(within(editor).getByLabelText('星期')).toHaveValue('五');
    expect(within(editor).getByLabelText('时间')).toHaveTextContent('9:00');

    await user.selectOptions(repeatSelect, 'custom');
    const customSchedule = within(editor).getByLabelText('自定义重复规则');
    expect(repeatSelect).toHaveValue('custom');
    expect(customSchedule).toHaveValue('Cron: 0 9 * * *');
    await user.clear(customSchedule);
    await user.type(customSchedule, '每 2 天 9:00');
    expect(customSchedule).toHaveValue('每 2 天 9:00');

    const modelSelect = within(editor).getByLabelText('模型') as HTMLSelectElement;
    expect(Array.from(modelSelect.options).map((option) => option.value)).toContain('gateway:gpt-5.5');
    await user.selectOptions(modelSelect, 'gateway:gpt-5.5');
    expect(modelSelect).toHaveValue('gateway:gpt-5.5');
  });

  it('hides unavailable subscription models in the manual automation editor', async () => {
    seedClientLicenseSession(false);
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByRole('button', { name: '自动化' }));
    const automationPage = container.querySelector('.automation-page') as HTMLElement;
    await user.click(within(automationPage).getByRole('button', { name: '创建计划任务' }));

    const editor = within(automationPage).getByRole('complementary', { name: '手动创建自动化任务' });
    const modelSelect = within(editor).getByLabelText('模型') as HTMLSelectElement;
    await waitFor(() => expect(modelSelect).toHaveValue('gpt-5.5'));

    const optionValues = Array.from(modelSelect.options).map((option) => option.value);
    expect(optionValues).toContain('gpt-5.5');
    expect(optionValues).not.toEqual(expect.arrayContaining(['GPT-5.5 超高', 'GPT-5.5 高', 'GPT-5.5 标准']));
    expect(modelSelect.querySelector('optgroup[label="订阅模型"]')).not.toBeInTheDocument();
  });

  it('offers dynamic catalog profiles and model-specific efforts in automation editor', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
    codexCatalogMockState.status.loggedIn = true;
    useChatStore.setState({ codexStatus: { installed: true, version: 'test', path: '/usr/bin/codex', loggedIn: true, accountEmail: 'codex-demo@alpha.local' }, codexModelCatalog: CODEX_MODEL_CATALOG, modelProfiles: modelProfilesFromCodexCatalog(CODEX_MODEL_CATALOG), selectedModelProfileId: 'gpt-5.6-sol', reasoningEffort: 'ultra' });
    const user = userEvent.setup();
    const { container } = render(<App />);
    await user.click(screen.getByRole('button', { name: '自动化' }));
    const page = container.querySelector('.automation-page') as HTMLElement;
    await user.click(within(page).getByRole('button', { name: '创建计划任务' }));
    const editor = within(page).getByRole('complementary', { name: '手动创建自动化任务' });
    const model = within(editor).getByLabelText('模型') as HTMLSelectElement;
    const effort = within(editor).getByLabelText('推理') as HTMLSelectElement;
    expect(Array.from(model.options).map((option) => option.value)).toEqual(expect.arrayContaining(['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']));
    await user.selectOptions(model, 'gpt-5.6-sol');
    expect(Array.from(effort.options).map((option) => option.value)).toEqual(expect.arrayContaining(['high', 'max', 'ultra']));
    await user.selectOptions(model, 'gpt-5.6-terra');
    expect(effort).toHaveValue('max');
    expect(Array.from(effort.options).map((option) => option.value)).not.toContain('ultra');
  });

  it('migrates a legacy automation model string before running', async () => {
    window.localStorage.setItem('alpha:automation-tasks-v1', JSON.stringify([{ id: 'legacy', title: '旧任务', prompt: '执行旧任务', environment: '当前对话', project: '选择项目', schedule: '每天 9:00', model: 'GPT-5.5 超高', createdAt: 1 }]));
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    useChatStore.setState({ modelProfiles: defaultModelProfiles(), selectedModelProfileId: 'gpt-5.4', reasoningEffort: 'low', sendMessage });
    const user = userEvent.setup();
    const { container } = render(<App />);
    await user.click(screen.getByRole('button', { name: '自动化' }));
    const page = container.querySelector('.automation-page') as HTMLElement;
    const row = within(page).getByRole('button', { name: /旧任务/ }).closest('.automation-task-row') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: '立即执行' }));
    expect(useChatStore.getState()).toMatchObject({ selectedModelProfileId: 'gpt-5.5', reasoningEffort: 'xhigh' });
    expect(sendMessage).toHaveBeenCalledWith(expect.stringContaining('模型：GPT-5.5'));
  });

  it('prefills the manual automation editor from a template', async () => {
    const user = userEvent.setup();
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    useChatStore.setState({ sendMessage });
    const { container } = render(<App />);

    await user.click(screen.getByRole('button', { name: '自动化' }));
    const automationPage = container.querySelector('.automation-page') as HTMLElement;
    await user.click(within(automationPage).getByRole('tab', { name: '模板' }));
    expect(within(automationPage).getByRole('heading', { name: '金融投研' })).toBeInTheDocument();
    expect(within(automationPage).queryByRole('button', { name: /扫描最近提交/ })).not.toBeInTheDocument();
    await user.click(within(automationPage).getByRole('button', { name: /盘后市场复盘/ }));

    const editor = within(automationPage).getByRole('complementary', { name: '手动创建自动化任务' });
    expect(within(editor).getByLabelText('已安排任务标题')).toHaveValue('盘后市场复盘');
    expect(within(editor).getByLabelText('提示词')).toHaveValue('生成盘后市场复盘：总结指数与成交、市场情绪、领涨题材、核心个股梯队和资金风格，区分机构与短线资金线索，评估主题生命周期，并形成下一交易日的观察重点、触发条件和风险预案。');
    expect(within(editor).getByLabelText('重复')).toHaveValue('weekdays');
    expect(within(editor).getByLabelText('时间')).toHaveTextContent('15:30');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('creates a scheduled automation task from the manual editor', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByRole('button', { name: '自动化' }));
    const automationPage = container.querySelector('.automation-page') as HTMLElement;
    await user.click(within(automationPage).getByRole('button', { name: '创建计划任务' }));
    const editor = within(automationPage).getByRole('complementary', { name: '手动创建自动化任务' });

    await user.type(within(editor).getByLabelText('已安排任务标题'), '每日 Neostream 题材研究日报');
    await user.type(within(editor).getByLabelText('提示词'), '汇总 Neostream 每日题材研究，并突出异常波动。');
    await user.click(within(automationPage).getByRole('button', { name: '创建计划任务' }));

    expect(within(automationPage).getByRole('group', { name: '任务状态筛选' })).toBeInTheDocument();
    expect(within(automationPage).getByRole('button', { name: /每日 Neostream 题材研究日报/ })).toBeInTheDocument();
    expect(within(automationPage).getByText('Next run 待安排 · 每天 9:00')).toBeInTheDocument();
  });

  it('pauses scheduled tasks and filters enabled and paused tasks separately', async () => {
    window.localStorage.setItem('alpha:automation-tasks-v1', JSON.stringify([
      { id: 'enabled-task', title: '已开启日报', prompt: '生成日报', environment: '当前对话', project: '选择项目', schedule: '每天 9:00', model: 'GPT-5.5', createdAt: 2 },
      { id: 'paused-task', title: '已暂停周报', prompt: '生成周报', environment: '当前对话', project: '选择项目', schedule: '每周五 17:30', model: 'GPT-5.5', createdAt: 1, paused: true },
    ]));
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByRole('button', { name: '自动化' }));
    const automationPage = container.querySelector('.automation-page') as HTMLElement;
    expect(within(automationPage).getByRole('button', { name: /已开启日报/ })).toBeInTheDocument();
    expect(within(automationPage).getByRole('button', { name: /已暂停周报/ })).toBeInTheDocument();

    await user.click(within(automationPage).getByRole('button', { name: '已暂停' }));
    expect(within(automationPage).queryByRole('button', { name: /已开启日报/ })).not.toBeInTheDocument();
    const pausedRow = within(automationPage).getByRole('button', { name: /已暂停周报/ }).closest('.automation-task-row') as HTMLElement;
    expect(pausedRow).toHaveClass('paused');
    await user.click(within(pausedRow).getByRole('button', { name: '恢复任务' }));
    expect(within(automationPage).getByText('没有已暂停的任务')).toBeInTheDocument();

    await user.click(within(automationPage).getByRole('button', { name: '已开启' }));
    expect(within(automationPage).getByRole('button', { name: /已开启日报/ })).toBeInTheDocument();
    expect(within(automationPage).getByRole('button', { name: /已暂停周报/ })).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem('alpha:automation-tasks-v1') || '[]')).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'paused-task', paused: false })]),
    );
  });

  it('runs edits and deletes scheduled automation tasks from the task row', async () => {
    const user = userEvent.setup();
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    useChatStore.setState({ sendMessage });
    const { container } = render(<App />);

    await user.click(screen.getByRole('button', { name: '自动化' }));
    let automationPage = container.querySelector('.automation-page') as HTMLElement;
    await user.click(within(automationPage).getByRole('button', { name: '创建计划任务' }));
    let editor = within(automationPage).getByRole('complementary', { name: '手动创建自动化任务' });

    await user.type(within(editor).getByLabelText('已安排任务标题'), '每日 Neostream 题材研究日报');
    await user.type(within(editor).getByLabelText('提示词'), '汇总 Neostream 每日题材研究，并突出异常波动。');
    await user.click(within(automationPage).getByRole('button', { name: '创建计划任务' }));

    let taskRow = within(automationPage)
      .getByRole('button', { name: /每日 Neostream 题材研究日报/ })
      .closest('.automation-task-row') as HTMLElement;
    await user.click(within(taskRow).getByLabelText('立即执行'));

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(useChatStore.getState().conversations).toHaveLength(1);
    expect(useChatStore.getState().currentConversationId).toBe('conv-right-panel');
    const sentPrompt = sendMessage.mock.calls[0][0] as string;
    expect(sentPrompt).toContain('请立即执行已安排任务「每日 Neostream 题材研究日报」。');
    expect(sentPrompt).toContain('汇总 Neostream 每日题材研究，并突出异常波动。');

    await user.click(screen.getByRole('button', { name: '自动化' }));
    automationPage = container.querySelector('.automation-page') as HTMLElement;
    taskRow = within(automationPage)
      .getByRole('button', { name: /每日 Neostream 题材研究日报/ })
      .closest('.automation-task-row') as HTMLElement;
    await user.click(within(taskRow).getByLabelText('编辑'));

    editor = within(automationPage).getByRole('complementary', { name: '手动创建自动化任务' });
    await user.clear(within(editor).getByLabelText('已安排任务标题'));
    await user.type(within(editor).getByLabelText('已安排任务标题'), '更新后的任务');
    await user.click(within(automationPage).getByRole('button', { name: '保存任务' }));

    expect(within(automationPage).getByRole('button', { name: /更新后的任务/ })).toBeInTheDocument();

    taskRow = within(automationPage)
      .getByRole('button', { name: /更新后的任务/ })
      .closest('.automation-task-row') as HTMLElement;
    await user.click(within(taskRow).getByLabelText('删除'));

    expect(within(automationPage).queryByRole('button', { name: /更新后的任务/ })).not.toBeInTheDocument();
    expect(within(automationPage).getByText('创建首个已安排任务')).toBeInTheDocument();
  });

  it('filters the skills catalog by category from the skills filter menu', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByRole('button', { name: '技能' }));
    const skillsPage = container.querySelector('.skills-page') as HTMLElement;

    await user.click(within(skillsPage).getByLabelText('筛选技能'));
    const filterMenu = screen.getByRole('menu', { name: '技能分类' });
    await user.click(within(filterMenu).getByRole('menuitemradio', { name: '推荐' }));

    expect(within(skillsPage).getByText('推荐')).toBeInTheDocument();
    expect(within(skillsPage).getByText('Playwright')).toBeInTheDocument();
    expect(within(skillsPage).queryByText('Browser')).not.toBeInTheDocument();
  });

  it('keeps repository Skills in the official category', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByRole('button', { name: '技能' }));
    const skillsPage = container.querySelector('.skills-page') as HTMLElement;
    await user.click(within(skillsPage).getByLabelText('筛选技能'));
    await user.click(screen.getByRole('menuitemradio', { name: '官方' }));

    expect(within(skillsPage).getByText('Alpha Studio A股因子挖掘')).toBeInTheDocument();
    expect(within(skillsPage).getByText('Alpha Studio 盘前主题')).toBeInTheDocument();
    expect(within(skillsPage).getByText('Alpha Studio 盘中监控')).toBeInTheDocument();
    expect(within(skillsPage).getByText('Alpha Studio 日报复盘')).toBeInTheDocument();
    expect(within(skillsPage).queryByText('Browser')).not.toBeInTheDocument();
    expect(within(skillsPage).queryByText('OpenAI Docs')).not.toBeInTheDocument();
  });

  it('opens a skill detail dialog and queues the skill for the chat composer', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByRole('button', { name: '技能' }));
    const skillsPage = container.querySelector('.skills-page') as HTMLElement;
    await user.click(within(skillsPage).getByRole('button', { name: /OpenAI Docs/ }));

    const dialog = screen.getByRole('dialog', { name: 'OpenAI Docs Skill' });
    expect(within(dialog).getByText(/Reference OpenAI docs/)).toBeInTheDocument();
    expect(within(dialog).getByRole('switch', { name: '禁用 OpenAI Docs' })).toHaveAttribute('aria-checked', 'true');
    expect(within(dialog).getByText('系统 · 由 Codex 运行时提供')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: '卸载' })).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: '在对话中试用' }));

    expect(container.querySelector('.skills-page')).not.toBeInTheDocument();
    const composer = document.querySelector('.composer-card') as HTMLElement;
    expect(within(composer).getByText('$openai-docs')).toBeInTheDocument();
    expect(within(composer).getByText('将优先使用这个 Skill')).toBeInTheDocument();
  });

  it('installs a recommended skill and makes it available in the composer skills menu', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByRole('button', { name: '技能' }));
    const skillsPage = container.querySelector('.skills-page') as HTMLElement;
    await user.click(within(skillsPage).getByLabelText('筛选技能'));
    await user.click(screen.getByRole('menuitemradio', { name: '推荐' }));
    await user.click(within(skillsPage).getByRole('button', { name: '添加 Playwright' }));

    await user.click(within(container.querySelector('.nav-menu') as HTMLElement).getByRole('button', { name: '新对话' }));
    await user.click(screen.getByLabelText('添加内容'));
    const plusMenu = document.querySelector('.plus-menu') as HTMLElement;
    fireEvent.click(within(plusMenu).getByRole('button', { name: /技能/ }));

    expect(screen.getByRole('menuitem', { name: '$playwright' })).toBeInTheDocument();
  });

  it('returns from the skills page to chat when starting a new conversation', async () => {
    const user = userEvent.setup();
    useChatStore.setState({
      conversations: [conversation({ messages: [] })],
      currentConversationId: 'conv-right-panel',
    });
    const { container } = render(<App />);

    await user.click(screen.getByRole('button', { name: '技能' }));
    expect(container.querySelector('.skills-page')).toBeInTheDocument();

    await user.click(within(container.querySelector('.nav-menu') as HTMLElement).getByRole('button', { name: '新对话' }));

    expect(container.querySelector('.skills-page')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('询问投研问题，或录入实盘持仓与买卖记录')).toBeInTheDocument();
  });

  it('renders Codex-style relative times in the sidebar', () => {
    const now = new Date('2026-06-22T12:00:00.000Z').getTime();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    useChatStore.setState({
      conversations: [
        conversation({
          id: 'conv-four-days',
          title: '提交并推送代码',
          updatedAt: now - 4 * 86_400_000,
        }),
        conversation({
          id: 'conv-ten-days',
          title: '填写开发备注注原因',
          updatedAt: now - 10 * 86_400_000,
        }),
      ],
      currentConversationId: 'conv-four-days',
    });

    const { container } = render(<App />);
    const sidebar = container.querySelector('.sidebar') as HTMLElement;

    expect(within(sidebar).getByText('4 天')).toBeInTheDocument();
    expect(within(sidebar).getByText('1 周')).toBeInTheDocument();
    expect(within(sidebar).queryByText('4天')).not.toBeInTheDocument();
  });

  it('keeps standalone conversations to the latest eight until expanded', async () => {
    const user = userEvent.setup();
    const conversations = Array.from({ length: 10 }, (_, index) => conversation({
      id: `standalone-${index + 1}`,
      title: `未归类对话 ${index + 1}`,
      createdAt: index + 1,
      updatedAt: index + 1,
    }));
    useChatStore.setState({
      conversations,
      projects: [],
      currentConversationId: 'standalone-10',
      conversationSort: 'updated',
    });

    const { container } = render(<App />);
    const sidebar = container.querySelector('.sidebar') as HTMLElement;

    expect(within(sidebar).queryByRole('button', { name: '展开或收起对话' })).not.toBeInTheDocument();
    const sectionCollapse = within(sidebar).getByRole('button', { name: '对话，收起列表' });
    expect(sectionCollapse).toHaveAttribute('aria-expanded', 'true');

    await user.click(sectionCollapse);

    expect(within(sidebar).queryByText('未归类对话 10')).not.toBeInTheDocument();
    const sectionExpand = within(sidebar).getByRole('button', { name: '对话，展开列表' });
    expect(sectionExpand).toHaveAttribute('aria-expanded', 'false');

    await user.click(sectionExpand);

    expect(within(sidebar).getByText('未归类对话 10')).toBeInTheDocument();
    expect(within(sidebar).getByText('未归类对话 3')).toBeInTheDocument();
    expect(within(sidebar).queryByText('未归类对话 2')).not.toBeInTheDocument();
    const expand = within(sidebar).getByRole('button', { name: '展开显示，另有 2 个对话' });
    expect(expand).toHaveAttribute('aria-expanded', 'false');

    await user.click(expand);

    expect(within(sidebar).getByText('未归类对话 2')).toBeInTheDocument();
    expect(within(sidebar).getByText('未归类对话 1')).toBeInTheDocument();
    const collapse = within(sidebar).getByRole('button', { name: '收起显示' });
    expect(collapse).toHaveAttribute('aria-expanded', 'true');

    await user.click(collapse);

    expect(within(sidebar).queryByText('未归类对话 2')).not.toBeInTheDocument();
  });

  it('applies the eight-conversation preview inside research themes', async () => {
    const conversations = Array.from({ length: 10 }, (_, index) => conversation({
      id: `project-conversation-${index + 1}`,
      title: `主题对话 ${index + 1}`,
      projectId: 'project-alpha',
      createdAt: index + 1,
      updatedAt: index + 1,
    }));
    useChatStore.setState({
      conversations,
      projects: [{
        id: 'project-alpha',
        name: 'alpha_studio',
        cwd: '/tmp/alpha-studio',
        createdAt: 1,
        updatedAt: 10,
      }],
      currentConversationId: 'project-conversation-10',
      conversationSort: 'updated',
    });

    const { container } = render(<App />);
    const sidebar = container.querySelector('.sidebar') as HTMLElement;

    await waitFor(() => expect(within(sidebar).getByText('主题对话 3')).toBeInTheDocument());
    expect(within(sidebar).queryByText('主题对话 2')).not.toBeInTheDocument();
    const expand = within(sidebar).getByRole('button', { name: '展开显示，另有 2 个对话' });
    expect(expand).toHaveClass('nested');
  });

  it('shows the activated tenant name in the sidebar title area without an icon', () => {
    const { container } = render(<App />);
    const sidebar = container.querySelector('.sidebar') as HTMLElement;
    const account = within(sidebar).getByText('Demo Fund').closest('.sidebar-account') as HTMLElement;

    expect(account).toBeInTheDocument();
    expect(account).toHaveAttribute('title', 'Demo Fund · Demo User · user@demo.local');
    expect(account.querySelector('svg')).not.toBeInTheDocument();
  });

  it('marks the app shell as fullscreen so the sidebar title can use the left edge', () => {
    Object.defineProperty(document, 'fullscreenElement', { value: document.body, configurable: true });

    const { container } = render(<App />);

    expect(container.querySelector('.app-shell')).toHaveClass('window-fullscreen');
  });

  it('keeps the workspace and tenant identity visible when the fullscreen sidebar is collapsed', async () => {
    Object.defineProperty(document, 'fullscreenElement', { value: document.body, configurable: true });
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByRole('button', { name: '收起侧栏' }));

    const identity = container.querySelector('.collapsed-sidebar-identity') as HTMLElement;
    expect(container.querySelector('.app-shell')).toHaveClass('window-fullscreen', 'sidebar-collapsed');
    expect(identity).toHaveTextContent('ALPHASTUDIO');
    expect(identity).toHaveTextContent('Demo Fund');
    expect(identity).toHaveAttribute('title', 'Demo Fund · Demo User · user@demo.local');
  });

  it('does not show the mobile entry in the sidebar navigation', () => {
    const { container } = render(<App />);
    const navMenu = container.querySelector('.nav-menu') as HTMLElement;

    expect(within(navMenu).queryByRole('button', { name: '移动端' })).not.toBeInTheDocument();
    expect(within(navMenu).queryByRole('button', { name: '提醒' })).not.toBeInTheDocument();
    expect(within(navMenu).getByRole('button', { name: '自动化' })).toBeInTheDocument();
  });

  it('does not show the static usage card in the sidebar footer', () => {
    const { container } = render(<App />);
    const sidebar = container.querySelector('.sidebar') as HTMLElement;

    expect(sidebar.querySelector('.usage-card')).not.toBeInTheDocument();
    expect(within(sidebar).queryByText('剩余 12% 使用量')).not.toBeInTheDocument();
    expect(within(sidebar).queryByRole('button', { name: '添加额度' })).not.toBeInTheDocument();
    expect(within(sidebar).getByRole('button', { name: '设置' })).toBeInTheDocument();
  });

  it('shows subscription and pay-as-you-go billing in usage settings', async () => {
    const user = userEvent.setup();
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
    useChatStore.setState({
      subscriptionUsage: [{
        month: '2026-07',
        modelId: 'gpt-5.6-sol',
        label: 'GPT-5.6 Sol',
        runCount: 3,
        inputTokens: 32_000,
        outputTokens: 2_400,
        reasoningTokens: 800,
        cachedTokens: 18_000,
        totalTokens: 34_400,
        lastUsedAt: Date.parse('2026-07-09T08:20:00.000Z'),
      }],
    });
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/api/client/billing-summary')) {
        return Promise.resolve(jsonResponse({
          tenant: {
            id: 'tenant_demo',
            name: 'Demo Fund',
            maxDevices: 5,
            billingMode: 'hybrid',
            balanceYuan: 96.75,
            subscriptionPlan: 'pro',
            subscriptionExpiresAt: '2026-08-01T00:00:00.000Z',
            codexSubscriptionEnabled: true,
            codexSubscriptionPlan: 'monthly',
            codexSubscriptionExpiresAt: '2026-08-01T00:00:00.000Z',
          },
          activeDevices: 2,
          period: {
            currentMonthStart: '2026-07-01T00:00:00.000Z',
            currentMonthEnd: '2026-08-01T00:00:00.000Z',
            generatedAt: '2026-07-09T08:30:00.000Z',
          },
          usage: {
            currentMonth: {
              runCount: 8,
              inputTokens: 12000,
              outputTokens: 4200,
              reasoningTokens: 1600,
              cachedTokens: 3200,
              totalTokens: 21000,
              costYuan: 2.6,
              billableYuan: 3.25,
              lastUsedAt: '2026-07-09T08:00:00.000Z',
            },
            allTime: {
              runCount: 32,
              inputTokens: 48000,
              outputTokens: 16800,
              reasoningTokens: 6400,
              cachedTokens: 12800,
              totalTokens: 84000,
              costYuan: 10.4,
              billableYuan: 13,
              lastUsedAt: '2026-07-09T08:00:00.000Z',
            },
            models: [
              {
                modelId: 'gpt-5.5',
                label: 'GPT-5.5 API',
                provider: 'openai',
                runCount: 8,
                inputTokens: 12000,
                outputTokens: 4200,
                reasoningTokens: 1600,
                cachedTokens: 3200,
                totalTokens: 21000,
                costYuan: 2.6,
                billableYuan: 3.25,
                lastUsedAt: '2026-07-09T08:00:00.000Z',
              },
            ],
            recentLedger: [
              {
                id: 'ledger_1',
                runId: 'run_1',
                entryType: 'usage_charge',
                amountYuan: -3.250001,
                description: 'gpt-5.5 usage charge',
                createdAt: '2026-07-09T08:00:00.000Z',
                entryCount: 4,
              },
            ],
            ledgerPagination: {
              page: 1,
              pageSize: 8,
              total: 17,
              totalPages: 3,
              hasPrevious: false,
              hasNext: true,
            },
          },
        }));
      }
      return Promise.resolve(jsonResponse({ leaseExpiresAt: futureIso() }));
    });
    const { container } = render(<App />);

    await user.click(within(container.querySelector('.sidebar') as HTMLElement).getByRole('button', { name: '设置' }));
    const settings = screen.getByRole('dialog', { name: '设置' });
    await user.click(within(settings).getByRole('button', { name: '使用情况和计费' }));

    expect(await within(settings).findByText('订阅 + 按量')).toBeInTheDocument();
    expect(within(settings).getByText('GPT 订阅')).toBeInTheDocument();
    expect(within(settings).getByText('剩余用量')).toBeInTheDocument();
    expect(within(settings).getByText('5 小时')).toBeInTheDocument();
    expect(within(settings).getByText('1 周')).toBeInTheDocument();
    expect(within(settings).getByText('63%')).toBeInTheDocument();
    expect(within(settings).getByText('23%')).toBeInTheDocument();
    expect(within(settings).getByText('API 套餐')).toBeInTheDocument();
    expect(within(settings).getByText(/96\.75/)).toBeInTheDocument();
    expect(within(settings).getAllByText(/3\.25/).length).toBeGreaterThan(0);
    expect(within(settings).getByText('GPT-5.6 Sol')).toBeInTheDocument();
    expect(within(settings).getByText('Included')).toHaveAttribute('title', '费用已包含在 GPT 订阅中');
    expect(within(settings).getByText('34,400')).toBeInTheDocument();
    expect(within(settings).getByText('GPT-5.5 API')).toBeInTheDocument();
    expect(within(settings).getByText('gpt-5.5 usage charge')).toBeInTheDocument();
    expect(within(settings).getByText(/4 笔合计/)).toBeInTheDocument();
    expect(within(settings).getByText('-¥3.250001')).toBeInTheDocument();
    expect(within(settings).getByText('第 1 / 3 页')).toBeInTheDocument();
    expect(within(settings).queryByText('PolyForm Noncommercial License 1.0.0。')).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:18080/api/client/billing-summary',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"tenantId":"tenant_demo"'),
      }),
    );

    await user.click(within(settings).getByRole('button', { name: '下一页' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      'http://localhost:18080/api/client/billing-summary',
      expect.objectContaining({ body: expect.stringContaining('"ledgerPage":2') }),
    ));
    expect(invoke).toHaveBeenCalledWith('codex_subscription_usage');
  });

  it('labels model picker groups as subscription and usage-based models', async () => {
    const user = userEvent.setup();
    useChatStore.setState({
      modelProfiles: [
        ...defaultModelProfiles(),
        {
          id: 'alpha-gateway-gpt-5.5',
          label: 'GPT-5.5 API',
          providerId: 'alpha-gateway',
          model: 'gpt-5.5',
          wireApi: 'responses',
          enabled: true,
          supportsReasoningEffort: true,
        },
      ],
    });
    render(<App />);

    const modelPicker = screen.getByTitle('选择模型与推理强度');
    expect(modelPicker.querySelector('.model-pill-icon')).not.toBeInTheDocument();
    expect(modelPicker.querySelector('.model-pill-label')).toBeInTheDocument();
    await user.click(modelPicker);
    const modelMenu = screen.getByRole('menu', { name: '选择模型' });
    expect(within(modelMenu).getByText('订阅模型')).toBeInTheDocument();
    expect(within(modelMenu).getByText('按量模型')).toBeInTheDocument();
    expect(within(modelMenu).getByRole('button', { name: '刷新模型列表' })).toBeInTheDocument();
    expect(screen.queryByText('内置模型')).not.toBeInTheDocument();
    expect(screen.queryByText('自定义模型')).not.toBeInTheDocument();

    const editButton = within(modelMenu).getByRole('button', { name: '编辑 GPT-5.5 API 的模型选项' });
    await user.click(editButton);

    expect(editButton).toHaveAttribute('aria-expanded', 'true');
    const optionsMenu = screen.getByRole('menu', { name: 'GPT-5.5 API 模型选项' });
    expect(optionsMenu.closest('.model-choice-flyout')?.parentElement).toBe(document.body);
    expect(within(optionsMenu).getByText('思考强度')).toBeInTheDocument();
    expect(within(optionsMenu).getByText('速度')).toBeInTheDocument();
  });

  it('opens model-specific options from the row edit action', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByTitle('选择模型与推理强度'));
    const modelMenu = screen.getByRole('menu', { name: '选择模型' });
    const editButton = within(modelMenu).getByRole('button', { name: /编辑 GPT-5\.5 API 的模型选项/ });
    await user.click(editButton);

    const optionsMenu = screen.getByRole('menu', { name: /GPT-5\.5 API 模型选项/ });
    expect(within(optionsMenu).getByText('默认速度')).toBeVisible();
    expect(within(optionsMenu).getByText('1.5x speed, increased usage')).toBeVisible();
  });

  it('only shows settings supported by the edited model', async () => {
    const user = userEvent.setup();
    useChatStore.setState({
      selectedModelProfileId: 'static-model',
      modelProfiles: [
        ...defaultModelProfiles(),
        {
          id: 'static-model',
          label: 'Static Model',
          providerId: 'custom',
          model: 'static-model',
          wireApi: 'chat',
          baseUrl: 'http://localhost:9000',
          enabled: true,
          supportsReasoningEffort: false,
        },
      ],
    });
    render(<App />);

    await user.click(screen.getByTitle('选择模型与推理强度'));
    const modelMenu = screen.getByRole('menu', { name: '选择模型' });
    await user.click(within(modelMenu).getByRole('button', { name: '编辑 Static Model 的模型选项' }));

    const optionsMenu = screen.getByRole('menu', { name: 'Static Model 模型选项' });
    expect(within(optionsMenu).getByText('此模型不提供思考强度设置')).toBeInTheDocument();
    expect(within(optionsMenu).getByText('默认速度')).toBeInTheDocument();
    expect(within(optionsMenu).queryByRole('menuitemradio', { name: '低' })).not.toBeInTheDocument();
  });

  it('keeps the active model flyout open while the pointer crosses the menu gap', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByTitle('选择模型与推理强度'));
    const modelMenu = screen.getByRole('menu', { name: '选择模型' });
    const editButton = within(modelMenu).getByRole('button', { name: /编辑 GPT-5\.5 API 的模型选项/ });
    await user.click(editButton);
    fireEvent.mouseLeave(modelMenu);

    expect(editButton).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu', { name: /GPT-5\.5 API 模型选项/ })).toBeVisible();
  });

  it('loads authorized Codex catalog models into the picker', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
    codexCatalogMockState.status.loggedIn = true;
    codexCatalogMockState.models = CODEX_MODEL_CATALOG;
    seedClientLicenseSession(true);
    useChatStore.setState({ codexStatus: null });
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('codex_models', { request: { forceRefetch: false } }));
    await user.click(screen.getByTitle('选择模型与推理强度'));
    expect(screen.getByRole('menuitemradio', { name: /GPT-5.6 Sol/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: /GPT-5.6 Terra/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: /GPT-5.6 Luna/ })).toBeInTheDocument();
    expect(screen.getByText('GPT-5.5 API')).toBeInTheDocument();
  });

  it('clamps reasoning effort when switching catalog models', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
    codexCatalogMockState.status.loggedIn = true;
    codexCatalogMockState.models = CODEX_MODEL_CATALOG;
    useChatStore.setState({ codexModelCatalog: CODEX_MODEL_CATALOG, modelProfiles: modelProfilesFromCodexCatalog(CODEX_MODEL_CATALOG), selectedModelProfileId: 'gpt-5.6-sol', reasoningEffort: 'ultra' });
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByTitle('选择模型与推理强度'));
    const modelMenu = screen.getByRole('menu', { name: '选择模型' });
    await user.click(within(modelMenu).getByRole('button', { name: '编辑 GPT-5.6 Sol 的模型选项' }));
    const solOptions = screen.getByRole('menu', { name: 'GPT-5.6 Sol 模型选项' });
    expect(within(solOptions).getByRole('menuitemradio', { name: 'Ultra' })).toBeInTheDocument();
    fireEvent.click(within(modelMenu).getByRole('menuitemradio', { name: /GPT-5.6 Terra/ }));
    await waitFor(() => expect(useChatStore.getState().reasoningEffort).toBe('high'));
    await user.click(screen.getByTitle('选择模型与推理强度'));
    const terraMenu = screen.getByRole('menu', { name: '选择模型' });
    await user.click(within(terraMenu).getByRole('button', { name: '编辑 GPT-5.6 Terra 的模型选项' }));
    const terraOptions = screen.getByRole('menu', { name: 'GPT-5.6 Terra 模型选项' });
    expect(within(terraOptions).queryByRole('menuitemradio', { name: 'Ultra' })).not.toBeInTheDocument();
    expect(within(terraOptions).getAllByRole('menuitemradio').map((item) => item.textContent)).toEqual(expect.arrayContaining(['低', '中', '高', 'Max', '标准默认速度', '快速1.5x speed, increased usage']));
  });

  it('keeps fallback picker usable when catalog refresh fails', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
    codexCatalogMockState.status.loggedIn = true;
    codexCatalogMockState.error = new Error('catalog offline');
    useChatStore.setState({ codexStatus: { installed: true, loggedIn: false, path: '/usr/bin/codex', version: 'test' } });
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(useChatStore.getState().codexModelCatalogError).toBe('catalog offline'));
    await user.click(screen.getByTitle('选择模型与推理强度'));
    const pickerMenu = screen.getByRole('menu', { name: '选择模型' });
    expect(within(pickerMenu).getByRole('menuitemradio', { name: /GPT-5\.5 API/ })).toBeInTheDocument();
    await user.click(within(pickerMenu).getByRole('button', { name: '编辑 GPT-5.5 API 的模型选项' }));
    expect(screen.getByRole('menu', { name: 'GPT-5.5 API 模型选项' })).toBeInTheDocument();
  });

  it('hides subscription models and the unavailable engine notice when Codex is not authorized', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
    const user = userEvent.setup();
    useChatStore.setState({
      codexStatus: {
        installed: true,
        version: 'test',
        path: '/usr/bin/codex',
        loggedIn: false,
        error: 'Alpha Studio 的 GPT 尚未完成设备授权。',
      },
      selectedModelProfileId: DEFAULT_MODEL_PROFILE_ID,
      modelProfiles: [
        ...defaultModelProfiles(),
        {
          id: 'gateway:gpt-5.5',
          label: 'GPT-5.5 API',
          providerId: 'alpha-gateway',
          model: 'gpt-5.5',
          wireApi: 'responses',
          enabled: true,
          supportsReasoningEffort: true,
        },
      ],
    });

    render(<App />);

    expect(screen.queryByText('AI 引擎暂不可用')).not.toBeInTheDocument();
    expect(screen.queryByText('Alpha Studio 的 GPT 尚未完成设备授权。')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('继续追问投研问题')).toBeEnabled();

    await user.click(screen.getByTitle('选择模型与推理强度'));
    const modelMenu = document.querySelector('.model-choice-menu') as HTMLElement;

    expect(await screen.findByText('按量模型')).toBeInTheDocument();
    expect(within(modelMenu).getByRole('menuitemradio', { name: /GPT-5.5 API/ })).toBeInTheDocument();
    expect(screen.queryByText('订阅模型')).not.toBeInTheDocument();
    expect(within(modelMenu).queryByRole('menuitemradio', { name: /^GPT-5.5(?:中|高|低|超高|Max|Ultra)?$/ })).not.toBeInTheDocument();
  });

  it('keeps empty local model config from restoring subscription models without Codex subscription', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
    seedClientLicenseSession(false);
    vi.mocked(invoke).mockImplementation((command: string) => {
      if (command === 'codex_check') {
        return Promise.resolve({
          installed: true,
          version: 'test',
          path: '/usr/bin/codex',
          loggedIn: false,
          error: 'Alpha Studio 的 GPT 尚未完成设备授权。',
        });
      }
      if (command === 'model_config_load') {
        return Promise.resolve({
          selectedModelProfileId: DEFAULT_MODEL_PROFILE_ID,
          modelProfiles: [],
          path: '/tmp/model-providers.json',
        });
      }
      if (command === 'codex_login') return Promise.resolve({ codexHome: '/Users/demo/.alpha-studio/codex-home' });
      if (command === 'codex_revoke_authorization') return Promise.resolve({ codexHome: '/Users/demo/.alpha-studio/codex-home' });
      if (command === 'list_open_apps') return Promise.resolve(['finder']);
      if (command === 'local_image_data_url') return Promise.resolve('data:image/png;base64,preview');
      if (command === 'git_status') {
        return Promise.resolve({
          cwd: '/tmp/alpha-studio',
          isRepository: false,
          ahead: 0,
          behind: 0,
          clean: true,
          changes: [],
        });
      }
      return Promise.resolve(undefined);
    });
    const user = userEvent.setup();
    useChatStore.setState({
      clientLicenseSession: null,
      codexStatus: {
        installed: true,
        version: 'test',
        path: '/usr/bin/codex',
        loggedIn: false,
        error: 'Alpha Studio 的 GPT 尚未完成设备授权。',
      },
      selectedModelProfileId: DEFAULT_MODEL_PROFILE_ID,
      modelProfiles: defaultModelProfiles(),
    });

    render(<App />);

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('model_config_load'));
    await waitFor(() => expect(screen.getByTitle('选择模型与推理强度')).toHaveTextContent('5.5 API'));
    expect(screen.queryByText('AI 引擎暂不可用')).not.toBeInTheDocument();
    expect(screen.queryByText('Alpha Studio 的 GPT 尚未完成设备授权。')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('继续追问投研问题')).toBeEnabled();

    await user.click(screen.getByTitle('选择模型与推理强度'));
    const modelMenu = document.querySelector('.model-choice-menu') as HTMLElement;

    expect(await screen.findByText('按量模型')).toBeInTheDocument();
    expect(screen.queryByText('订阅模型')).not.toBeInTheDocument();
    expect(within(modelMenu).getByRole('menuitemradio', { name: /GPT-5.5 API/ })).toBeInTheDocument();
    expect(within(modelMenu).queryByRole('menuitemradio', { name: /^GPT-5.5(?:中|高|低|超高|Max|Ultra)?$/ })).not.toBeInTheDocument();
  });

  it('keeps finance settings focused and removes user model configuration', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(within(container.querySelector('.sidebar') as HTMLElement).getByRole('button', { name: '设置' }));

    const settings = screen.getByRole('dialog', { name: '设置' });
    expect(within(settings).getByRole('heading', { name: '显示偏好' })).toBeInTheDocument();
    expect(within(settings).getByText('界面主题')).toBeInTheDocument();
    expect(within(settings).getByRole('button', { name: '账户与授权' })).toBeInTheDocument();
    expect(within(settings).queryByText('金融数据')).not.toBeInTheDocument();
    expect(within(settings).getByRole('button', { name: '已归档对话' })).toBeInTheDocument();
    expect(within(settings).queryByRole('button', { name: '模型' })).not.toBeInTheDocument();
    expect(within(settings).queryByText('自定义模型')).not.toBeInTheDocument();
    expect(within(settings).queryByText('API Key')).not.toBeInTheDocument();
    expect(within(settings).queryByRole('button', { name: '个性化' })).not.toBeInTheDocument();
    expect(within(settings).queryByRole('button', { name: '键盘快捷键' })).not.toBeInTheDocument();
    expect(within(settings).queryByRole('button', { name: '浏览器' })).not.toBeInTheDocument();
  });

  it('keeps client license details out of chat and allows logout from profile settings', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    expect(container.querySelector('.client-license-banner')).not.toBeInTheDocument();
    expect(screen.queryByText(/GPT 订阅账号/)).not.toBeInTheDocument();

    await user.click(within(container.querySelector('.sidebar') as HTMLElement).getByRole('button', { name: '设置' }));
    const settings = screen.getByRole('dialog', { name: '设置' });
    await user.click(within(settings).getByRole('button', { name: '账户与授权' }));

    expect(within(settings).getByText('GPT 订阅账号')).toBeInTheDocument();
    expect(within(settings).queryByText('codex-demo@alpha.local')).not.toBeInTheDocument();
    expect(within(settings).getByText('Use browser login handoff')).toBeInTheDocument();
    expect(within(settings).getByText('设备授权')).toBeInTheDocument();
    expect(within(settings).queryByText('设备租约')).not.toBeInTheDocument();

    await user.click(within(settings).getByRole('button', { name: '退出登录' }));

    await waitFor(() => expect(screen.getByRole('heading', { name: '激活 Alpha Studio' })).toBeInTheDocument());
    expect(loadClientLicenseSession()).toBeNull();
  });

  it('hides internal placeholder user details behind a natural local authorization identity', async () => {
    const stored = loadClientLicenseSession()!;
    saveClientLicenseSession({
      ...stored,
      tenant: { ...stored.tenant, name: '德靖私募' },
      user: {
        ...stored.user,
        name: 'Alpha Studio User',
        email: 'local@alpha-studio.local',
      },
    });
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(within(container.querySelector('.sidebar') as HTMLElement).getByRole('button', { name: '设置' }));
    const settings = screen.getByRole('dialog', { name: '设置' });
    await user.click(within(settings).getByRole('button', { name: '账户与授权' }));

    expect(within(settings).getByText('本机授权')).toBeInTheDocument();
    expect(within(settings).getByText('授权身份')).toBeInTheDocument();
    expect(within(settings).getByText('本机用户')).toBeInTheDocument();
    expect(within(settings).getByText('德靖')).toBeInTheDocument();
    expect(within(settings).queryByText('Alpha Studio User')).not.toBeInTheDocument();
    expect(within(settings).queryByText('local@alpha-studio.local')).not.toBeInTheDocument();
  });

  it('shows installed devices and lets the first device revoke another device', async () => {
    const deviceSummary = {
      activeDevices: 2,
      maxDevices: 5,
      isAdministrator: true,
      devices: [
        {
          id: 'dev_demo',
          name: 'Alpha Studio MacIntel',
          status: 'active',
          isCurrent: true,
          isAdministrator: true,
          createdAt: '2026-07-01T00:00:00.000Z',
          lastSeenAt: '2026-07-16T08:30:00.000Z',
        },
        {
          id: 'dev_other',
          name: 'Alpha Studio Win32',
          status: 'active',
          isCurrent: false,
          isAdministrator: false,
          createdAt: '2026-07-02T00:00:00.000Z',
          lastSeenAt: '2026-07-16T07:30:00.000Z',
        },
      ],
    };
    vi.mocked(fetch).mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith('/api/client/devices/revoke')) {
        return Promise.resolve(jsonResponse({
          ...deviceSummary,
          activeDevices: 1,
          devices: deviceSummary.devices.map((device) => (
            device.id === 'dev_other' ? { ...device, status: 'revoked' } : device
          )),
        }));
      }
      if (url.endsWith('/api/client/devices')) return Promise.resolve(jsonResponse(deviceSummary));
      return Promise.resolve(jsonResponse({ leaseExpiresAt: futureIso() }));
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(within(container.querySelector('.sidebar') as HTMLElement).getByRole('button', { name: '设置' }));
    const settings = screen.getByRole('dialog', { name: '设置' });
    await user.click(within(settings).getByRole('button', { name: '账户与授权' }));

    expect(await within(settings).findByText('Alpha Studio MacIntel')).toBeInTheDocument();
    expect(within(settings).getByText('Alpha Studio Win32')).toBeInTheDocument();
    expect(within(settings).getByText('管理员')).toBeInTheDocument();
    expect(within(settings).getByText('本机')).toBeInTheDocument();
    expect(within(settings).getByText('2 / 5')).toBeInTheDocument();

    await user.click(within(settings).getByRole('button', { name: '解除 Alpha Studio Win32 的授权' }));

    await waitFor(() => expect(within(settings).getByText('已解除授权')).toBeInTheDocument());
    expect(within(settings).getByText('1 / 5')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:18080/api/client/devices/revoke',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"targetDeviceId":"dev_other"'),
      }),
    );
  });

  it('does not offer device revocation controls on a non-administrator device', async () => {
    vi.mocked(fetch).mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith('/api/client/devices')) {
        return Promise.resolve(jsonResponse({
          activeDevices: 2,
          maxDevices: 5,
          isAdministrator: false,
          devices: [
            {
              id: 'dev_admin',
              name: 'Administrator Mac',
              status: 'active',
              isCurrent: false,
              isAdministrator: true,
              createdAt: '2026-07-01T00:00:00.000Z',
            },
            {
              id: 'dev_demo',
              name: 'Current Mac',
              status: 'active',
              isCurrent: true,
              isAdministrator: false,
              createdAt: '2026-07-02T00:00:00.000Z',
            },
          ],
        }));
      }
      return Promise.resolve(jsonResponse({ leaseExpiresAt: futureIso() }));
    });
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(within(container.querySelector('.sidebar') as HTMLElement).getByRole('button', { name: '设置' }));
    const settings = screen.getByRole('dialog', { name: '设置' });
    await user.click(within(settings).getByRole('button', { name: '账户与授权' }));

    expect(await within(settings).findByText('Administrator Mac')).toBeInTheDocument();
    expect(within(settings).queryByRole('button', { name: /解除 .* 的授权/ })).not.toBeInTheDocument();
  });

  it('requires an explicit button press to launch Codex CLI device authorization', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
    useChatStore.setState({
      codexStatus: {
        installed: true,
        loggedIn: false,
        path: '/usr/bin/codex',
        version: 'test',
        error: 'Alpha Studio 的 GPT 尚未完成设备授权。',
      },
    });
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(within(container.querySelector('.sidebar') as HTMLElement).getByRole('button', { name: '设置' }));
    const settings = screen.getByRole('dialog', { name: '设置' });
    await user.click(within(settings).getByRole('button', { name: '账户与授权' }));

    const loginButton = within(settings).getByRole('button', { name: '授权 GPT' });
    expect(invoke).not.toHaveBeenCalledWith('codex_login');

    await user.click(loginButton);

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('codex_login'));
  });

  it('shows the Codex CLI as authorized after device authorization is detected', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
    vi.mocked(invoke).mockImplementation((command: string) => {
      if (command === 'codex_check') {
        return Promise.resolve({
          installed: true,
          version: 'test',
          path: '/usr/bin/codex',
          loggedIn: true,
          accountEmail: 'codex-demo@alpha.local',
        });
      }
      if (command === 'codex_login') return Promise.resolve({ codexHome: '/Users/demo/.alpha-studio/codex-home' });
      if (command === 'codex_revoke_authorization') return Promise.resolve({ codexHome: '/Users/demo/.alpha-studio/codex-home' });
      if (command === 'list_open_apps') return Promise.resolve(['finder']);
      if (command === 'local_image_data_url') return Promise.resolve('data:image/png;base64,preview');
      if (command === 'git_status') {
        return Promise.resolve({
          cwd: '/tmp/alpha-studio',
          isRepository: false,
          ahead: 0,
          behind: 0,
          clean: true,
          changes: [],
        });
      }
      return Promise.resolve(undefined);
    });
    useChatStore.setState({
      codexStatus: { installed: true, loggedIn: true, accountEmail: 'codex-demo@alpha.local', path: '/usr/bin/codex', version: 'test' },
    });
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(within(container.querySelector('.sidebar') as HTMLElement).getByRole('button', { name: '设置' }));
    const settings = screen.getByRole('dialog', { name: '设置' });
    await user.click(within(settings).getByRole('button', { name: '账户与授权' }));

    await waitFor(() => expect(within(settings).getByText('已授权')).toBeInTheDocument());
    expect(within(settings).queryByRole('button', { name: '授权 GPT' })).not.toBeInTheDocument();
  });

  it('revokes Codex CLI authorization from profile settings', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
    let revoked = false;
    vi.mocked(invoke).mockImplementation((command: string) => {
      if (command === 'codex_check') {
        return Promise.resolve({
          installed: true,
          version: 'test',
          path: '/usr/bin/codex',
          loggedIn: !revoked,
          accountEmail: revoked ? undefined : 'codex-demo@alpha.local',
          error: revoked ? 'Alpha Studio 的 GPT 尚未完成设备授权。' : undefined,
        });
      }
      if (command === 'codex_revoke_authorization') {
        revoked = true;
        return Promise.resolve({ codexHome: '/Users/demo/.alpha-studio/codex-home' });
      }
      if (command === 'codex_login') return Promise.resolve({ codexHome: '/Users/demo/.alpha-studio/codex-home' });
      if (command === 'list_open_apps') return Promise.resolve(['finder']);
      if (command === 'local_image_data_url') return Promise.resolve('data:image/png;base64,preview');
      if (command === 'git_status') {
        return Promise.resolve({
          cwd: '/tmp/alpha-studio',
          isRepository: false,
          ahead: 0,
          behind: 0,
          clean: true,
          changes: [],
        });
      }
      return Promise.resolve(undefined);
    });
    useChatStore.setState({
      codexStatus: { installed: true, loggedIn: true, accountEmail: 'codex-demo@alpha.local', path: '/usr/bin/codex', version: 'test' },
    });
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(within(container.querySelector('.sidebar') as HTMLElement).getByRole('button', { name: '设置' }));
    const settings = screen.getByRole('dialog', { name: '设置' });
    await user.click(within(settings).getByRole('button', { name: '账户与授权' }));

    await user.click(await within(settings).findByRole('button', { name: '撤销授权' }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('codex_revoke_authorization'));
    await waitFor(() => expect(within(settings).getByText('未授权')).toBeInTheDocument());
    expect(within(settings).getByRole('button', { name: '授权 GPT' })).toBeInTheDocument();
    expect(within(settings).queryByRole('button', { name: '撤销授权' })).not.toBeInTheDocument();
  });

  it('selects a skill from the composer plugin flyout and sends it with the message', async () => {
    const user = userEvent.setup();
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    useChatStore.setState({ sendMessage });
    render(<App />);

    await user.click(screen.getByLabelText('添加内容'));
    const plusMenu = document.querySelector('.plus-menu') as HTMLElement;
    fireEvent.click(within(plusMenu).getByRole('button', { name: /技能/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: '$chrome' }));

    const composer = document.querySelector('.composer-card') as HTMLElement;
    expect(within(composer).getByText('$chrome')).toBeInTheDocument();

    await user.type(within(composer).getByRole('textbox'), '检查页面控制台');
    await user.click(within(composer).getByLabelText('发送'));

    expect(sendMessage).toHaveBeenCalledOnce();
    expect(sendMessage.mock.calls[0]?.slice(0, 4)).toEqual([
      '检查页面控制台',
      [],
      expect.objectContaining({ id: 'chrome', title: 'Chrome' }),
      [],
    ]);
  });

  it('keeps the finance composer menu focused on attachments and skills', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByLabelText('添加内容'));
    const plusMenu = document.querySelector('.plus-menu') as HTMLElement;

    expect(within(plusMenu).getByRole('menuitem', { name: '添加照片和文件' })).toBeInTheDocument();
    expect(within(plusMenu).getByRole('button', { name: /技能/ })).toBeInTheDocument();
    expect(within(plusMenu).queryByText('计划模式')).not.toBeInTheDocument();
    expect(within(plusMenu).queryByText('追求目标')).not.toBeInTheDocument();
  });

  it('anchors the composer menu directly above the add-content button', async () => {
    const user = userEvent.setup();
    render(<App />);

    const trigger = screen.getByLabelText('添加内容');
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
      left: 40,
      top: 700,
    } as DOMRect);

    await user.click(trigger);

    const plusMenu = document.querySelector('.plus-menu') as HTMLElement;
    expect(plusMenu.style.left).toBe('40px');
    expect(plusMenu.style.bottom).toBe(`${window.innerHeight - 700 + 8}px`);
  });

  it('queues follow-up messages from the composer while a response is streaming', async () => {
    const user = userEvent.setup();
    const initialStore = useChatStore.getInitialState();
    useChatStore.setState({
      conversations: [
        conversation({
          status: 'streaming',
          runId: 'run-current',
          messages: [
            { id: 'user-current', role: 'user', timestamp: 1, blocks: [{ type: 'text', content: '第一条' }] },
            { id: 'assistant-current', role: 'assistant', timestamp: 1, isStreaming: true, blocks: [] },
          ],
        }),
      ],
      currentConversationId: 'conv-right-panel',
      sendMessage: initialStore.sendMessage,
      removeQueuedMessage: initialStore.removeQueuedMessage,
      updateQueuedMessage: initialStore.updateQueuedMessage,
      reorderQueuedMessage: initialStore.reorderQueuedMessage,
      sendQueuedMessageNow: initialStore.sendQueuedMessageNow,
    });
    const { container } = render(<App />);

    const composerCard = container.querySelector('.main-stage .composer-card') as HTMLElement;
    const textbox = within(composerCard).getByRole('textbox') as HTMLTextAreaElement;
    expect(textbox).not.toBeDisabled();

    await user.type(textbox, '第二条');
    await user.click(within(composerCard).getByLabelText('加入队列'));

    const queue = container.querySelector('.composer-queue') as HTMLElement;
    expect(queue).toBeInTheDocument();
    expect(within(queue).getByText('第二条')).toBeInTheDocument();
    expect(queue.querySelector('.composer-queue-no')).not.toBeInTheDocument();
    expect(textbox).toHaveValue('');
    expect(useChatStore.getState().conversations[0].messages).toHaveLength(2);
    expect(useChatStore.getState().conversations[0].queuedMessages?.[0]).toMatchObject({ text: '第二条' });

    await user.click(within(queue).getByLabelText('删除队列消息 第二条'));

    expect(container.querySelector('.composer-queue')).not.toBeInTheDocument();
    expect(useChatStore.getState().conversations[0].queuedMessages ?? []).toHaveLength(0);
  });

  it('edits, guides, and reorders queued composer messages', async () => {
    const user = userEvent.setup();
    const initialStore = useChatStore.getInitialState();
    useChatStore.setState({
      conversations: [
        conversation({
          status: 'streaming',
          runId: 'run-current',
          messages: [
            { id: 'user-current', role: 'user', timestamp: 1, blocks: [{ type: 'text', content: '第一条' }] },
            { id: 'assistant-current', role: 'assistant', timestamp: 1, isStreaming: true, blocks: [] },
          ],
          queuedMessages: [
            { id: 'queue-a', text: '第二条', createdAt: 2 },
            { id: 'queue-b', text: '第三条', createdAt: 3 },
          ],
        }),
      ],
      currentConversationId: 'conv-right-panel',
      sendMessage: initialStore.sendMessage,
      removeQueuedMessage: initialStore.removeQueuedMessage,
      updateQueuedMessage: initialStore.updateQueuedMessage,
      reorderQueuedMessage: initialStore.reorderQueuedMessage,
      sendQueuedMessageNow: initialStore.sendQueuedMessageNow,
    });
    const { container } = render(<App />);
    const queue = container.querySelector('.composer-queue') as HTMLElement;

    await user.click(within(queue).getByLabelText('更多队列操作 第二条'));
    await user.click(within(queue).getByRole('menuitem', { name: '编辑消息' }));
    const editBox = queue.querySelector('.composer-queue-edit') as HTMLTextAreaElement;
    await user.clear(editBox);
    await user.type(editBox, '第二条修改');
    await user.click(within(queue).getByLabelText('保存队列消息'));

    expect(useChatStore.getState().conversations[0].queuedMessages?.[0].text).toBe('第二条修改');

    const items = Array.from(queue.querySelectorAll('.composer-queue-item')) as HTMLElement[];
    const data = new Map<string, string>();
    const dataTransfer = {
      effectAllowed: 'move',
      dropEffect: 'move',
      setData: vi.fn((type: string, value: string) => data.set(type, value)),
      getData: vi.fn((type: string) => data.get(type) || ''),
    };
    fireEvent.dragStart(items[1], { dataTransfer });
    fireEvent.dragOver(items[0], { dataTransfer, clientY: 0 });
    fireEvent.drop(items[0], { dataTransfer, clientY: 0 });

    expect(useChatStore.getState().conversations[0].queuedMessages?.map((item) => item.id)).toEqual(['queue-b', 'queue-a']);

    await user.click(within(queue).getByLabelText('引导发送队列消息 第二条修改'));

    expect(useChatStore.getState().conversations[0].queuedMessages?.map((item) => item.id)).toEqual(['queue-b']);
    expect(useChatStore.getState().conversations[0].guidedQueuedMessages?.map((item) => item.id)).toEqual(['queue-a']);
    expect(within(queue).queryByText('第二条修改')).not.toBeInTheDocument();
  });

  it('renders the selected skill as a dollar-prefixed label in the user message', () => {
    useChatStore.setState({
      conversations: [
        conversation({
          messages: [
            {
              id: 'msg-skill',
              role: 'user',
              timestamp: 1,
              blocks: [{ type: 'text', content: '检查页面控制台' }],
              selectedSkill: { id: 'chrome', title: 'Chrome' },
            },
          ],
        }),
      ],
    });

    const { container } = render(<App />);
    const messageList = container.querySelector('.message-list') as HTMLElement;

    expect(within(messageList).getByText('$chrome')).toBeInTheDocument();
  });

  it('briefly replaces the message copy icon with a success check', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    const view = render(<App />);

    try {
      const copyButton = screen.getByRole('button', { name: '复制' });
      await act(async () => {
        fireEvent.click(copyButton);
        await Promise.resolve();
      });

      expect(writeText).toHaveBeenCalledWith('hi');
      expect(screen.getByRole('button', { name: '已复制' })).toHaveClass('copied');

      act(() => vi.advanceTimersByTime(1800));
      expect(screen.getByRole('button', { name: '复制' })).not.toHaveClass('copied');
    } finally {
      view.unmount();
      vi.useRealTimers();
      delete (navigator as unknown as { clipboard?: Clipboard }).clipboard;
    }
  });

  it('keeps long markdown code blocks compact until the user expands them', async () => {
    const user = userEvent.setup();
    const jsonLines = Array.from({ length: 18 }, (_, index) => `  "field_${index + 1}": ${index + 1}`);
    useChatStore.setState({
      conversations: [
        conversation({
          messages: [
            {
              id: 'assistant-long-code',
              role: 'assistant',
              timestamp: 1,
              blocks: [{ type: 'text', content: `\`\`\`json\n{\n${jsonLines.join(',\n')}\n}\n\`\`\`` }],
            },
          ],
        }),
      ],
    });

    const { container } = render(<App />);
    const codeBlock = container.querySelector('.markdown-code-block') as HTMLElement;
    const expand = within(codeBlock).getByRole('button', { name: '展开代码' });

    expect(codeBlock).toHaveClass('is-collapsed');
    expect(codeBlock).toHaveTextContent('JSON');
    expect(codeBlock).toHaveTextContent('20 行');
    expect(expand).toHaveAttribute('aria-expanded', 'false');

    await user.click(expand);

    expect(codeBlock).toHaveClass('is-expanded');
    expect(within(codeBlock).getByRole('button', { name: '收起代码' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('leaves short markdown code blocks fully visible', () => {
    useChatStore.setState({
      conversations: [
        conversation({
          messages: [
            {
              id: 'assistant-short-code',
              role: 'assistant',
              timestamp: 1,
              blocks: [{ type: 'text', content: '```ts\nconst answer = 42;\n```' }],
            },
          ],
        }),
      ],
    });

    const { container } = render(<App />);
    const codeBlock = container.querySelector('.markdown-code-block') as HTMLElement;

    expect(codeBlock).toHaveClass('is-static');
    expect(within(codeBlock).queryByRole('button', { name: '展开代码' })).not.toBeInTheDocument();
  });

  it('renders generated image result blocks as clickable previews in chat', async () => {
    const user = userEvent.setup();
    useChatStore.setState({
      conversations: [
        conversation({
          messages: [
            {
              id: 'assistant-image',
              role: 'assistant',
              timestamp: 1,
              blocks: [
                {
                  type: 'image_result',
                  id: 'img-result',
                  title: '生成结果',
                  images: [
                    {
                      id: 'cat-preview',
                      src: '/Users/geb/.codex/generated_images/cat.png',
                      alt: '猫图预览',
                      name: 'cat.png',
                    },
                  ],
                },
              ],
            },
          ],
        }),
      ],
    });

    const { container } = render(<App />);
    const preview = within(container.querySelector('.message-list') as HTMLElement).getByRole('button', { name: /查看生成图片 猫图预览/ });

    expect(preview).toBeInTheDocument();
    expect(within(preview).getByAltText('猫图预览')).toBeInTheDocument();

    await user.click(preview);

    expect(screen.getByRole('dialog', { name: '猫图预览' })).toBeInTheDocument();
  });

  it('hides persisted image cards that came from ordinary command output', () => {
    useChatStore.setState({
      conversations: [
        conversation({
          messages: [
            {
              id: 'assistant-false-image',
              role: 'assistant',
              timestamp: 1,
              blocks: [
                {
                  type: 'tool',
                  id: 'exec-web-1',
                  title: 'command_execution',
                  status: 'completed',
                  output: 'curl search page',
                },
                {
                  type: 'image_result',
                  id: 'exec-web-1-result',
                  title: '生成结果',
                  images: [
                    {
                      id: 'bing-icon',
                      src: 'https://www.bing.com/sa/simg/facebook_sharing_5.png',
                      alt: 'facebook_sharing_5.png',
                      name: 'facebook_sharing_5.png',
                    },
                  ],
                },
              ],
            },
          ],
        }),
      ],
    });

    const { container } = render(<App />);
    const messageList = container.querySelector('.message-list') as HTMLElement;

    expect(messageList.querySelector('.generated-image-result')).toBeNull();
    expect(within(messageList).queryByRole('button', { name: /facebook_sharing_5/ })).not.toBeInTheDocument();
  });

  it('falls back to a local data URL when the Tauri asset preview cannot load', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
    useChatStore.setState({
      conversations: [
        conversation({
          messages: [
            {
              id: 'assistant-image',
              role: 'assistant',
              timestamp: 1,
              blocks: [
                {
                  type: 'image_result',
                  id: 'img-result',
                  title: '生成结果',
                  images: [
                    {
                      id: 'cat-preview',
                      src: '/Users/geb/.alpha-studio/codex-home/generated_images/cat.png',
                      alt: '猫图预览',
                      name: 'cat.png',
                    },
                  ],
                },
              ],
            },
          ],
        }),
      ],
    });

    const { container } = render(<App />);
    const preview = within(container.querySelector('.message-list') as HTMLElement).getByRole('button', { name: /查看生成图片 猫图预览/ });
    const image = within(preview).getByAltText('猫图预览') as HTMLImageElement;

    expect(image.getAttribute('src')).toBe('file:///Users/geb/.alpha-studio/codex-home/generated_images/cat.png');

    fireEvent.error(image);

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('local_image_data_url', { request: { path: '/Users/geb/.alpha-studio/codex-home/generated_images/cat.png' } }));
    await waitFor(() => expect((within(preview).getByAltText('猫图预览') as HTMLImageElement).getAttribute('src')).toBe('data:image/png;base64,preview'));
    expect(within(preview).queryByText('图片预览不可用')).not.toBeInTheDocument();
  });

  it('renders generated files as Codex-style result cards with an open menu', async () => {
    const user = userEvent.setup();
    useChatStore.setState({
      conversations: [
        conversation({
          messages: [
            {
              id: 'assistant-file',
              role: 'assistant',
              timestamp: 1,
              blocks: [
                {
                  type: 'file_result',
                  id: 'file-result',
                  title: '生成文件',
                  files: [
                    {
                      id: 'cat-file',
                      path: '/Users/geb/.alpha-studio/codex-home/generated_images/cat-illustration.png',
                      name: 'cat-illustration.png',
                      ext: 'png',
                      kind: 'image',
                    },
                  ],
                },
              ],
            },
          ],
        }),
      ],
    });

    const { container } = render(<App />);
    const card = within(container.querySelector('.message-list') as HTMLElement).getByRole('button', { name: '打开 cat-illustration.png' });

    expect(within(card).getByText('cat-illustration.png')).toBeInTheDocument();
    expect(within(card).getByText('图像 · PNG')).toBeInTheDocument();
    const openMenuButton = within(card).getByRole('button', { name: 'cat-illustration.png 打开方式' });
    await user.click(openMenuButton);

    expect(await screen.findByRole('menuitem', { name: '侧边栏预览' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Default app' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Cursor' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Terminal' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '在 Finder 中显示' })).toBeInTheDocument();

    await user.click(openMenuButton);
    fireEvent.contextMenu(card, { clientX: 420, clientY: 320 });

    expect(screen.getByRole('menuitem', { name: '打开文件' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '在 Preview 中打开' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '复制路径' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '复制文件内容' })).toBeInTheDocument();
  });

  it('hides remote HTML source pages from persisted generated-file cards', () => {
    useChatStore.setState({
      conversations: [
        conversation({
          messages: [
            {
              id: 'assistant-source-page',
              role: 'assistant',
              timestamp: 1,
              blocks: [
                {
                  type: 'file_result',
                  id: 'false-positive-source-page',
                  title: '生成文件',
                  files: [
                    {
                      id: 'mofcom-source',
                      path: 'https://www.mofcom.gov.cn/art/2026/art_c9b4c4851de94b18809007ff90d9cce0.html',
                      name: 'art_c9b4c4851de94b18809007ff90d9cce0.html',
                      ext: 'html',
                      kind: 'file',
                    },
                  ],
                },
              ],
            },
          ],
        }),
      ],
    });

    const { container } = render(<App />);
    const messageList = container.querySelector('.message-list') as HTMLElement;

    expect(within(messageList).queryByRole('button', { name: '打开 art_c9b4c4851de94b18809007ff90d9cce0.html' })).not.toBeInTheDocument();
    expect(messageList.querySelector('.generated-file-result')).toBeNull();
  });

  it('hides persisted generated-file cards when their local files no longer exist', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
    vi.mocked(invoke).mockImplementation((command: string) => {
      if (command === 'local_file_exists') return Promise.resolve(false);
      return Promise.resolve(undefined);
    });
    useChatStore.setState({
      conversations: [
        conversation({
          messages: [
            {
              id: 'assistant-missing-temp-pdfs',
              role: 'assistant',
              timestamp: 1,
              blocks: [
                {
                  type: 'file_result',
                  id: 'stale-temp-pdfs',
                  title: '生成文件',
                  files: [
                    {
                      id: 'missing-abnormal',
                      path: '/var/folders/demo/T/tmp.1gyXXKvaSo/abnormal.pdf',
                      name: 'abnormal.pdf',
                      ext: 'pdf',
                      kind: 'file',
                    },
                    {
                      id: 'missing-reduction',
                      path: '/var/folders/demo/T/tmp.1gyXXKvaSo/reduction.pdf',
                      name: 'reduction.pdf',
                      ext: 'pdf',
                      kind: 'file',
                    },
                  ],
                },
              ],
            },
          ],
        }),
      ],
    });

    const { container } = render(<App />);
    const messageList = container.querySelector('.message-list') as HTMLElement;
    expect(within(messageList).getByRole('button', { name: '打开 abnormal.pdf' })).toBeInTheDocument();

    await waitFor(() => {
      expect(within(messageList).queryByRole('button', { name: '打开 abnormal.pdf' })).not.toBeInTheDocument();
      expect(within(messageList).queryByRole('button', { name: '打开 reduction.pdf' })).not.toBeInTheDocument();
    });
    expect(messageList.querySelector('.generated-file-result')).toBeNull();
  });

  it('shows a Codex-style local file menu on right click and decodes Chinese paths', async () => {
    const user = userEvent.setup();
    useChatStore.setState({
      conversations: [
        conversation({
          messages: [
            {
              id: 'assistant-pdf-link',
              role: 'assistant',
              timestamp: 1,
              blocks: [
                {
                  type: 'text',
                  content: '[PDF 文件](/Users/geb/.alphastudio/projects/投研/reports/report.pdf)',
                },
              ],
            },
          ],
        }),
      ],
    });

    render(<App />);
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
    vi.mocked(invoke).mockImplementation((command: string) => {
      if (command === 'list_open_apps') return Promise.resolve(['finder', 'preview']);
      return Promise.resolve(undefined);
    });
    const link = screen.getByRole('link', { name: /PDF 文件/ });

    fireEvent.contextMenu(link, { clientX: 420, clientY: 320 });

    expect(await screen.findByRole('menuitem', { name: '打开文件' })).toBeInTheDocument();
    expect(await screen.findByRole('menuitem', { name: '在 Preview 中打开' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '打开方式' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '复制路径' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '复制文件内容' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '在 Finder 中显示' })).toBeInTheDocument();

    await user.click(screen.getByRole('menuitem', { name: '在 Preview 中打开' }));

    expect(invoke).toHaveBeenCalledWith('open_in_app', {
      request: {
        app: 'preview',
        path: '/Users/geb/.alphastudio/projects/投研/reports/report.pdf',
      },
    });
  });

  it('opens generated HTML files in the browser dock instead of raw source preview', async () => {
    const user = userEvent.setup();
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
    mockLocalHtmlPreviewFiles();
    useChatStore.setState({
      conversations: [
        conversation({
          messages: [
            {
              id: 'assistant-file',
              role: 'assistant',
              timestamp: 1,
              blocks: [
                {
                  type: 'file_result',
                  id: 'file-result',
                  title: '生成文件',
                  files: [
                    {
                      id: 'report-html',
                      path: '/Users/geb/reports/daily-theme/index.html',
                      name: 'index.html',
                      ext: 'html',
                      kind: 'file',
                    },
                  ],
                },
              ],
            },
          ],
        }),
      ],
    });

    const { container } = render(<App />);
    const card = within(container.querySelector('.message-list') as HTMLElement).getByRole('button', { name: '打开 index.html' });

    expect(within(card).getByRole('button', { name: 'index.html 打开方式' })).toBeInTheDocument();
    await user.click(card);

    await waitFor(() => expect(container.querySelector('.browser-frame')).not.toBeNull());
    expect(screen.getByPlaceholderText('搜索或输入网址')).toHaveValue('/Users/geb/reports/daily-theme/index.html');
    const frame = container.querySelector('.browser-frame') as HTMLIFrameElement;
    await waitFor(() => expect(frame?.getAttribute('srcdoc')).toContain('HTML 报告内容'));
    expect(frame?.getAttribute('srcdoc')).toContain('<style>');
    expect(frame?.getAttribute('srcdoc')).toContain('data:image/png;base64,preview');
    expect(screen.queryByText('<!doctype html>')).not.toBeInTheDocument();
  });

  it('reuses the existing browser tab when the same local file is opened repeatedly', async () => {
    const user = userEvent.setup();
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
    mockLocalHtmlPreviewFiles();
    useChatStore.setState({
      conversations: [
        conversation({
          messages: [
            {
              id: 'assistant-link',
              role: 'assistant',
              timestamp: 1,
              blocks: [
                {
                  type: 'text',
                  content: '已生成今日报告：[index.html](/Users/geb/reports/daily-theme/index.html)',
                },
              ],
            },
          ],
        }),
      ],
    });

    const { container } = render(<App />);
    const link = screen.getByRole('link', { name: /index\.html/ });

    await user.click(link);
    await waitFor(() => expect(container.querySelector('.browser-frame')).not.toBeNull());
    await user.click(link);

    const dock = container.querySelector('.right-dock-workspace') as HTMLElement;
    expect(container.querySelectorAll('.browser-dock-panel')).toHaveLength(1);
    expect(within(dock).getAllByRole('tab', { name: 'index' })).toHaveLength(1);
    expect(within(dock).getByRole('tab', { name: 'index' })).toHaveAttribute('aria-selected', 'true');
  });

  it('opens local HTML markdown links in the browser dock', async () => {
    const user = userEvent.setup();
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
    mockLocalHtmlPreviewFiles();
    useChatStore.setState({
      conversations: [
        conversation({
          messages: [
            {
              id: 'assistant-link',
              role: 'assistant',
              timestamp: 1,
              blocks: [
                {
                  type: 'text',
                  content: '已生成今日报告：[index.html](/Users/geb/reports/daily-theme/index.html)',
                },
              ],
            },
          ],
        }),
      ],
    });

    const { container } = render(<App />);
    await user.click(screen.getByRole('link', { name: /index\.html/ }));

    await waitFor(() => expect(container.querySelector('.browser-frame')).not.toBeNull());
    expect(screen.getByPlaceholderText('搜索或输入网址')).toHaveValue('/Users/geb/reports/daily-theme/index.html');
    const frame = container.querySelector('.browser-frame') as HTMLIFrameElement;
    await waitFor(() => expect(frame?.getAttribute('srcdoc')).toContain('HTML 报告内容'));
    expect(frame?.getAttribute('srcdoc')).toContain('<style>');
    expect(frame?.getAttribute('srcdoc')).toContain('data:image/png;base64,preview');
  });

  it('deduplicates generated files into a single handoff at the end of the response', async () => {
    const user = userEvent.setup();
    useChatStore.setState({
      conversations: [
        conversation({
          messages: [
            {
              id: 'assistant-inline-html',
              role: 'assistant',
              timestamp: 1,
              blocks: [
                {
                  type: 'text',
                  content: 'PDF 未导出：本机 Playwright 浏览器二进制未安装；HTML 已包含样式和 logo，可直接打开或用浏览器打印为 PDF。\n\n[index.html](/Users/geb/reports/daily-theme/index.html)',
                },
                {
                  type: 'file_result',
                  id: 'duplicate-index-result',
                  title: '生成文件',
                  files: [
                    {
                      id: 'duplicate-index-file',
                      path: '/Users/geb/reports/daily-theme/index.html',
                      name: 'index.html',
                      ext: 'html',
                      kind: 'file',
                    },
                  ],
                },
                {
                  type: 'tool',
                  id: 'verify-report',
                  title: 'shell',
                  status: 'completed',
                  input: 'test -f /Users/geb/reports/daily-theme/index.html',
                },
                { type: 'text', content: '报告已经完成校验。' },
              ],
            },
          ],
        }),
      ],
    });

    const { container } = render(<App />);
    const markdown = container.querySelector('.markdown-content') as HTMLElement;
    const bubble = container.querySelector('.message.assistant .bubble') as HTMLElement;
    const handoff = within(bubble).getByRole('region', { name: '交付文件' });
    const cards = within(handoff).getAllByRole('button', { name: '打开 index.html' });
    const card = cards[0];

    expect(cards).toHaveLength(1);
    expect(markdown.contains(card)).toBe(false);
    expect(bubble.lastElementChild).toBe(handoff);
    expect(within(handoff).getByText('01')).toBeInTheDocument();

    await user.click(within(card).getByRole('button', { name: 'index.html 打开方式' }));

    const menu = await screen.findByRole('menu');
    expect(menu.parentElement).toBe(document.body);
    expect(markdown.contains(menu)).toBe(false);
    expect(within(menu).getByRole('menuitem', { name: '侧边浏览器' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Default app' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Terminal' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: '在 Finder 中显示' })).toBeInTheDocument();
  });

  it('renders local file paths in assistant text as previewable file cards', async () => {
    const user = userEvent.setup();
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
    vi.mocked(invoke).mockImplementation((command: string, args?: unknown) => {
      const request = args && typeof args === 'object' && 'request' in args
        ? (args as { request?: { path?: string } }).request
        : undefined;
      if (command === 'local_text_file_read') {
        return Promise.resolve({
          path: request?.path || '/tmp/file.md',
          content: '# 合规意见\n\n文件预览内容',
          bytes: 18,
          truncated: false,
        });
      }
      if (command === 'list_open_apps') return Promise.resolve(['finder']);
      if (command === 'local_image_data_url') return Promise.resolve('data:image/png;base64,preview');
      return Promise.resolve(undefined);
    });
    useChatStore.setState({
      conversations: [
        conversation({
          messages: [
            { id: 'msg-1', role: 'user', timestamp: 1, blocks: [{ type: 'text', content: '请生成纪要' }] },
            {
              id: 'msg-2',
              role: 'assistant',
              timestamp: 2,
              blocks: [
                {
                  type: 'text',
                  content: '⑨ 合规与档案管家:已完成 | 文件=/Users/geb/codes/alpha_studio/src-tauri/coworker-notes/pre-market-committee-2026-07-07/compliance.md',
                },
              ],
            },
          ],
        }),
      ],
    });

    const { container } = render(<App />);
    const card = within(container.querySelector('.message-list') as HTMLElement).getByRole('button', { name: '打开 compliance.md' });

    expect(within(card).getByText('compliance.md')).toBeInTheDocument();
    expect(within(card).getByText('文档 · MD')).toBeInTheDocument();
    await user.click(card);

    await screen.findByRole('heading', { name: '合规意见' });
    expect(screen.getByText('文件预览内容')).toBeInTheDocument();
  });

  it('does not mount a bottom terminal in the finance workspace', () => {
    const { container } = render(<App />);

    expect(screen.queryByLabelText('打开下方终端')).not.toBeInTheDocument();
    expect(container.querySelector('.workspace > .terminal-panel')).not.toBeInTheDocument();
  });

  it('opens side chat as its own Codex-style right dock tab from the keyboard shortcut', async () => {
    const { container } = render(<App />);

    fireEvent.keyDown(window, { metaKey: true, altKey: true, code: 'KeyS' });

    const sideChat = container.querySelector('.side-chat-panel') as HTMLElement;
    expect(sideChat).toBeInTheDocument();
    expect(container.querySelector('.features-panel')).not.toBeInTheDocument();
    expect(within(container.querySelector('.right-dock-workspace') as HTMLElement).getByRole('tab', { name: '侧边聊天' })).toHaveAttribute('aria-selected', 'true');
    expect(within(sideChat).getByPlaceholderText('询问投研问题，或录入实盘持仓与买卖记录')).toBeInTheDocument();
  });

  it('routes selected main-chat text into the main composer or an ephemeral side chat', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    const mainMessage = within(container.querySelector('.message-list') as HTMLElement).getByText('hi');
    const selectMainMessage = () => {
      const range = document.createRange();
      range.selectNodeContents(mainMessage);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      fireEvent.mouseUp(container.querySelector('.message-scroll') as HTMLElement, { clientX: 320, clientY: 240 });
    };

    selectMainMessage();
    const selectionToolbar = await screen.findByRole('toolbar', { name: '选中文本操作' });
    await user.click(within(selectionToolbar).getByRole('button', { name: '添加到对话' }));
    expect(screen.getByText('1 个已选文本片段')).toBeInTheDocument();

    await user.click(screen.getByLabelText('移除选中文本片段 1'));
    expect(screen.queryByText('1 个已选文本片段')).not.toBeInTheDocument();

    selectMainMessage();
    await user.click(within(await screen.findByRole('toolbar', { name: '选中文本操作' })).getByRole('button', { name: '在侧边聊天中提问' }));

    const sideChat = container.querySelector('.side-chat-panel') as HTMLElement;
    expect(sideChat).toBeInTheDocument();
    expect(within(sideChat).getByText('1 个已选文本片段')).toBeInTheDocument();
    expect(within(sideChat).getByText('关闭标签后即会消失。', { exact: false })).toBeInTheDocument();

    const sideInput = within(sideChat).getByPlaceholderText('询问投研问题，或录入实盘持仓与买卖记录');
    await user.type(sideInput, '这句话是什么意思？');
    await user.click(within(sideChat).getByLabelText('发送'));

    expect(within(sideChat).getByText('这句话是什么意思？')).toBeInTheDocument();
    const sideConversation = useChatStore.getState().conversations.find((item) => item.ephemeral);
    expect(sideConversation?.messages[0].selectedTextContexts?.[0].text).toBe('hi');
    expect(useChatStore.getState().conversations.find((item) => item.id === 'conv-right-panel')?.messages).toHaveLength(1);

    await user.click(within(container.querySelector('.right-dock-workspace') as HTMLElement).getByLabelText('关闭侧边聊天标签'));
    expect(useChatStore.getState().conversations.some((item) => item.ephemeral)).toBe(false);
    expect(container.querySelector('.side-chat-panel')).not.toBeInTheDocument();
  });

  it('shows browser as a tabbed finance workspace with a pruned add-tab menu', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByLabelText('打开浏览器'));

    const browser = container.querySelector('.browser-dock-panel') as HTMLElement;
    const dock = container.querySelector('.right-dock-workspace') as HTMLElement;
    expect(browser).toBeInTheDocument();
    expect(within(dock).getByRole('tab', { name: '新标签' })).toHaveAttribute('aria-selected', 'true');
    expect(within(browser).getByText('官网')).toBeInTheDocument();
    expect(within(browser).getByRole('button', { name: '打开元流涌现官网' })).toBeInTheDocument();

    await user.click(within(dock).getByLabelText('添加侧边栏标签'));
    const tabMenu = container.querySelector('.right-dock-tab-menu') as HTMLElement;
    expect(tabMenu).toBeInTheDocument();
    expect(within(tabMenu).getByRole('button', { name: /浏览器/ })).toBeInTheDocument();
    expect(within(tabMenu).queryByRole('button', { name: /侧边聊天/ })).not.toBeInTheDocument();
    expect(within(tabMenu).queryByRole('button', { name: /审查/ })).not.toBeInTheDocument();
    expect(within(tabMenu).queryByRole('button', { name: /^终端$/ })).not.toBeInTheDocument();
    expect(within(tabMenu).getByRole('button', { name: /文件/ })).toBeInTheDocument();
  });

  it('opens the Yuanliu official website from the browser start page', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByLabelText('打开浏览器'));

    const browser = container.querySelector('.browser-dock-panel') as HTMLElement;
    await user.click(within(browser).getByRole('button', { name: '打开元流涌现官网' }));

    expect(within(browser).getByPlaceholderText('搜索或输入网址')).toHaveValue('https://yuanliu.ai');
  });

  it('restores a wide right sidebar beyond the former 620px limit', async () => {
    window.localStorage.setItem('alpha:right-sidebar-width', '1040');
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByLabelText('打开浏览器'));

    const shell = container.querySelector('.app-shell') as HTMLElement;
    expect(shell.style.getPropertyValue('--right-sidebar-width')).toBe('1040px');
    expect(shell.style.getPropertyValue('--right-panel-main-min-width')).toBe('360px');

    const row = container.querySelector('.workspace-row') as HTMLElement;
    const dock = container.querySelector('.right-dock-workspace') as HTMLElement;
    const resizer = container.querySelector('.right-panel-resizer') as HTMLElement;
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({ width: 1500 } as DOMRect);
    vi.spyOn(dock, 'getBoundingClientRect').mockReturnValue({ width: 1040 } as DOMRect);
    Object.defineProperty(resizer, 'setPointerCapture', { value: vi.fn(), configurable: true });

    fireEvent.pointerDown(resizer, { clientX: 1050, pointerId: 1 });
    fireEvent.pointerMove(resizer, { clientX: 1010, pointerId: 1 });
    fireEvent.pointerUp(resizer, { pointerId: 1 });

    expect(shell.style.getPropertyValue('--right-sidebar-width')).toBe('1080px');
  });

  it('expands and restores the right dock from the tab bar action', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByLabelText('打开浏览器'));

    const shell = container.querySelector('.app-shell') as HTMLElement;
    const dock = container.querySelector('.right-dock-workspace') as HTMLElement;
    expect(container.querySelector('.right-panel-resizer')).toBeInTheDocument();
    expect(within(dock).getByRole('button', { name: '展开侧边栏' })).toHaveAttribute('aria-pressed', 'false');

    await user.click(within(dock).getByRole('button', { name: '展开侧边栏' }));

    expect(shell).toHaveClass('right-dock-expanded');
    expect(container.querySelector('.right-panel-resizer')).not.toBeInTheDocument();
    expect(within(dock).getByRole('button', { name: '还原侧边栏' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(within(dock).getByRole('button', { name: '还原侧边栏' }));

    expect(shell).not.toHaveClass('right-dock-expanded');
    expect(container.querySelector('.right-panel-resizer')).toBeInTheDocument();
    expect(within(dock).getByRole('button', { name: '展开侧边栏' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('keeps the current chat composer available while the right dock is expanded', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByLabelText('打开浏览器'));

    const dock = container.querySelector('.right-dock-workspace') as HTMLElement;
    await user.click(within(dock).getByRole('button', { name: '展开侧边栏' }));

    expect(container.querySelector('.app-shell')).toHaveClass('right-dock-expanded');
    const overlay = container.querySelector('.dock-composer-overlay') as HTMLElement;
    expect(overlay).toBeInTheDocument();
    expect(container.querySelector('.side-chat-composer')).not.toBeInTheDocument();
    const card = within(overlay).getByRole('textbox').closest('.composer-card') as HTMLElement;
    expect(card).not.toHaveClass('compact');
    expect(card.querySelector('.composer-toolbar .composer-meta')).toBeInTheDocument();

    const textarea = within(overlay).getByPlaceholderText('继续追问投研问题');
    await user.type(textarea, '继续检查');

    expect(textarea).toHaveValue('继续检查');
    expect(card).not.toHaveClass('compact');
  });

  it('opens assistant markdown links in new right dock browser tabs', async () => {
    const user = userEvent.setup();
    const firstUrl = 'https://finance.sina.com.cn/stock/robotics';
    const secondUrl = 'https://www.cls.cn/detail/robotics';
    useChatStore.setState({
      conversations: [
        conversation({
          messages: [
            {
              id: 'assistant-link',
              role: 'assistant',
              timestamp: 1,
              blocks: [{ type: 'text', content: `来源：[新浪财经](${firstUrl})、[财联社](${secondUrl})。` }],
            },
          ],
        }),
      ],
    });

    const { container } = render(<App />);

    await user.click(screen.getByRole('link', { name: '新浪财经' }));
    await user.click(screen.getByRole('link', { name: '财联社' }));

    const dock = container.querySelector('.right-dock-workspace') as HTMLElement;
    const browsers = Array.from(container.querySelectorAll('.browser-dock-panel'));
    const activeBrowser = container.querySelector('.right-dock-pane.active .browser-dock-panel') as HTMLElement;
    expect(browsers).toHaveLength(2);
    const browserTabs = within(dock).getAllByRole('tab', { name: /robotics/ });
    expect(browserTabs).toHaveLength(2);
    expect(browserTabs[0]).toHaveTextContent('robotics · finance.sina.com.cn');
    expect(browserTabs[1]).toHaveTextContent('robotics · cls.cn');
    expect(within(activeBrowser).getByPlaceholderText('搜索或输入网址')).toHaveValue(secondUrl);
    expect(activeBrowser.querySelector('.browser-frame')).toHaveAttribute('src', secondUrl);
    expect(browsers[0].querySelector('.browser-frame')).toHaveAttribute('src', firstUrl);

    const tabScroller = dock.querySelector('.right-dock-tab-scroll') as HTMLElement;
    Object.defineProperties(tabScroller, {
      scrollWidth: { value: 520, configurable: true },
      clientWidth: { value: 200, configurable: true },
    });
    tabScroller.scrollLeft = 0;
    fireEvent.wheel(tabScroller, { deltaY: 96 });
    expect(tabScroller.scrollLeft).toBe(96);
  });

  it('opens the active browser address externally from the address bar action', async () => {
    const user = userEvent.setup();
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const url = 'https://www.cls.cn/detail/robotics';
    useChatStore.setState({
      conversations: [
        conversation({
          messages: [
            {
              id: 'assistant-link',
              role: 'assistant',
              timestamp: 1,
              blocks: [{ type: 'text', content: `来源：[财联社](${url})。` }],
            },
          ],
        }),
      ],
    });

    const { container } = render(<App />);

    await user.click(screen.getByRole('link', { name: '财联社' }));

    const activeBrowser = container.querySelector('.right-dock-pane.active .browser-dock-panel') as HTMLElement;
    const externalOpen = within(activeBrowser).getByRole('button', { name: '在外部浏览器打开' });
    expect(externalOpen).not.toBeDisabled();

    await user.click(externalOpen);

    expect(openSpy).toHaveBeenCalledWith(url, '_blank', 'noopener,noreferrer');
  });

  it('supports address-bar search and browser history navigation', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByLabelText('打开浏览器'));

    const browser = container.querySelector('.right-dock-pane.active .browser-dock-panel') as HTMLElement;
    const address = within(browser).getByPlaceholderText('搜索或输入网址');
    await user.type(address, 'alpha studio market research{Enter}');

    expect(browser.querySelector('.browser-frame')).toHaveAttribute(
      'src',
      'https://www.google.com/search?q=alpha%20studio%20market%20research',
    );

    await user.clear(address);
    await user.type(address, 'example.com{Enter}');
    expect(browser.querySelector('.browser-frame')).toHaveAttribute('src', 'https://example.com');

    const back = within(browser).getByRole('button', { name: '后退' });
    expect(back).not.toBeDisabled();
    await user.click(back);
    expect(browser.querySelector('.browser-frame')).toHaveAttribute(
      'src',
      'https://www.google.com/search?q=alpha%20studio%20market%20research',
    );
    expect(within(browser).getByRole('button', { name: '前进' })).not.toBeDisabled();
  });

  it('selects the complete browser address when the address field is clicked', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByLabelText('打开浏览器'));

    const browser = container.querySelector('.right-dock-pane.active .browser-dock-panel') as HTMLElement;
    const address = within(browser).getByPlaceholderText('搜索或输入网址') as HTMLInputElement;
    await user.type(address, 'example.com{Enter}');

    address.setSelectionRange(4, 4);
    await user.click(address);

    expect(address.selectionStart).toBe(0);
    expect(address.selectionEnd).toBe(address.value.length);
  });

  it('opens local browser addresses through the desktop external-open command', async () => {
    const user = userEvent.setup();
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
    mockLocalHtmlPreviewFiles();
    const htmlPath = '/Users/geb/reports/daily-theme/index.html';
    useChatStore.setState({
      conversations: [
        conversation({
          messages: [
            {
              id: 'assistant-link',
              role: 'assistant',
              timestamp: 1,
              blocks: [{ type: 'text', content: `已生成今日报告：[index.html](${htmlPath})` }],
            },
          ],
        }),
      ],
    });

    const { container } = render(<App />);

    await user.click(screen.getByRole('link', { name: /index\.html/ }));
    await waitFor(() => expect(container.querySelector('.browser-frame')).not.toBeNull());

    vi.mocked(invoke).mockClear();
    const activeBrowser = container.querySelector('.right-dock-pane.active .browser-dock-panel') as HTMLElement;
    await user.click(within(activeBrowser).getByRole('button', { name: '在外部浏览器打开' }));

    expect(invoke).toHaveBeenCalledWith('open_external_target', { request: { target: htmlPath } });
  });

  it('groups consecutive web search tool rows behind one disclosure', async () => {
    const user = userEvent.setup();
    useChatStore.setState({
      conversations: [
        conversation({
          messages: [
            {
              id: 'assistant-web-searches',
              role: 'assistant',
              timestamp: 1,
              blocks: [
                { type: 'tool', id: 'web-1', title: 'web.run search_query', status: 'completed', input: '机器人 产业链 最新政策', output: '搜索结果 1' },
                { type: 'tool', id: 'web-2', title: 'web.run search_query', status: 'completed', input: '国产算力 交换机 订单', output: '搜索结果 2' },
                { type: 'tool', id: 'web-3', title: 'web.search', status: 'completed', input: 'CGT 征求意见 国家药监局', output: '搜索结果 3' },
              ],
            },
          ],
        }),
      ],
    });

    const { container } = render(<App />);
    const messageList = container.querySelector('.message-list') as HTMLElement;
    const groupLabel = within(messageList).getByText('已搜索网页 3 次');
    const group = groupLabel.closest('details') as HTMLElement;

    expect(group).toHaveClass('web-search-group');
    expect(within(messageList).queryByText('机器人 产业链 最新政策')).not.toBeInTheDocument();

    await user.click(groupLabel);

    expect(within(group).getAllByText(/搜索 0[1-3]/)).toHaveLength(3);
    expect(within(group).getByText('机器人 产业链 最新政策')).toBeInTheDocument();
    expect(within(group).getByText('国产算力 交换机 订单')).toBeInTheDocument();
    expect(within(group).getByText('CGT 征求意见 国家药监局')).toBeInTheDocument();
    expect(group.querySelector('.event-chevron')).not.toBeInTheDocument();
  });

  it('shows edited file names and change details instead of an empty disclosure', async () => {
    const user = userEvent.setup();
    useChatStore.setState({
      conversations: [
        conversation({
          messages: [
            {
              id: 'assistant-file-edits',
              role: 'assistant',
              timestamp: 1,
              blocks: [
                {
                  type: 'tool',
                  id: 'edit-1',
                  title: 'fileChange',
                  status: 'completed',
                  output: JSON.stringify([
                    { path: '/Users/geb/codes/alpha_studio/src/App.tsx', kind: 'update', additions: 12, deletions: 3 },
                    { path: '/Users/geb/codes/alpha_studio/src/styles.css', kind: 'update', additions: 24, deletions: 0 },
                  ]),
                },
              ],
            },
          ],
        }),
      ],
    });

    const { container } = render(<App />);
    const messageList = container.querySelector('.message-list') as HTMLElement;
    const editLabel = within(messageList).getByText('已编辑');
    const editDetails = editLabel.closest('details') as HTMLElement;

    expect(within(editDetails).getByText('2 个文件 · +36 −3')).toBeInTheDocument();
    expect(within(editDetails).queryByText('变更明细')).not.toBeInTheDocument();

    await user.click(editLabel);

    expect(within(editDetails).getByText('变更明细')).toBeInTheDocument();
    expect(within(editDetails).getByText('…/src/App.tsx')).toBeInTheDocument();
    expect(within(editDetails).getByText('…/src/styles.css')).toBeInTheDocument();
    expect(within(editDetails).getAllByText('修改')).toHaveLength(2);
  });

  it('explains when an edit tool returned no change details', async () => {
    const user = userEvent.setup();
    useChatStore.setState({
      conversations: [
        conversation({
          messages: [
            {
              id: 'assistant-empty-edit',
              role: 'assistant',
              timestamp: 1,
              blocks: [{ type: 'tool', id: 'edit-empty', title: 'fileChange', status: 'completed' }],
            },
          ],
        }),
      ],
    });

    const { container } = render(<App />);
    const messageList = container.querySelector('.message-list') as HTMLElement;
    await user.click(within(messageList).getByText('已编辑'));

    expect(within(messageList).getByText('编辑工具未返回变更明细，可在右侧 Git 面板查看工作区差异。')).toBeInTheDocument();
  });

  it('collapses and reopens a finance tool without duplicating its dock tab', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByLabelText('打开浏览器'));

    const dock = container.querySelector('.right-dock-workspace') as HTMLElement;
    const browser = container.querySelector('.browser-dock-panel') as HTMLElement;
    expect(browser).toBeInTheDocument();
    expect(within(dock).getByRole('tab', { name: '新标签' })).toHaveAttribute('aria-selected', 'true');

    await user.click(screen.getByLabelText('关闭浏览器'));
    expect(dock).toHaveClass('collapsed');
    expect(container.querySelector('.browser-dock-panel')).toBe(browser);

    await user.click(screen.getByLabelText('打开浏览器'));
    expect(dock).not.toHaveClass('collapsed');
    expect(container.querySelector('.browser-dock-panel')).toBe(browser);
    expect(within(dock).getByRole('tab', { name: '新标签' })).toHaveAttribute('aria-selected', 'true');
    expect(within(dock).getAllByRole('tab', { name: '新标签' })).toHaveLength(1);
  });

  it('closes right dock tabs from the hover-only tab close button', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    fireEvent.keyDown(window, { metaKey: true, altKey: true, code: 'KeyS' });

    const dock = container.querySelector('.right-dock-workspace') as HTMLElement;
    expect(within(dock).getByRole('tab', { name: '侧边聊天' })).toBeInTheDocument();

    await user.click(within(dock).getByLabelText('关闭侧边聊天标签'));

    expect(container.querySelector('.side-chat-panel')).not.toBeInTheDocument();
    expect(dock).toHaveClass('collapsed');
    expect(within(dock).queryByRole('tab', { name: '侧边聊天' })).not.toBeInTheDocument();
  });

  it('shows terminal tab close buttons only on hover', () => {
    const cssPath = `${process.cwd()}/src/styles.css`;
    const css = readFileSync(cssPath, 'utf8');

    expect(css).toMatch(/\.terminal-tab-close\s*{[^}]*opacity:\s*0;[^}]*pointer-events:\s*none;/s);
    expect(css).toMatch(/\.terminal-tab:hover\s+\.terminal-tab-close,\s*\.terminal-tab-close:focus-visible\s*{[^}]*opacity:\s*0\.65;[^}]*pointer-events:\s*auto;/s);
    expect(css).not.toMatch(/\.terminal-tab\.active\s+\.terminal-tab-close/);
    expect(css).toMatch(/\.right-dock-tab-close\s*{[^}]*opacity:\s*0;[^}]*pointer-events:\s*none;/s);
    expect(css).toMatch(/\.right-dock-tab:hover\s+\.right-dock-tab-close,\s*\.right-dock-tab:focus-within\s+\.right-dock-tab-close,\s*\.right-dock-tab-close:focus-visible\s*{[^}]*opacity:\s*0\.65;[^}]*pointer-events:\s*auto;/s);
    expect(css).not.toMatch(/\.right-dock-tab\.active\s+\.right-dock-tab-close/);
  });

  it('shows the browser external-open action on address field hover or focus', () => {
    const cssPath = `${process.cwd()}/src/styles.css`;
    const css = readFileSync(cssPath, 'utf8');

    expect(css).toMatch(/\.browser-external-open\s*{[^}]*opacity:\s*0;[^}]*pointer-events:\s*none;/s);
    expect(css).toContain('.browser-address-field:hover .browser-external-open:not(:disabled),');
    expect(css).toContain('.browser-address-field:focus-within .browser-external-open:not(:disabled),');
    expect(css).toMatch(/\.browser-address-field:hover\s+\.browser-external-open:not\(:disabled\),\s*\.browser-address-field:focus-within\s+\.browser-external-open:not\(:disabled\),\s*\.browser-external-open:focus-visible:not\(:disabled\)\s*{[^}]*opacity:\s*0\.72;[^}]*pointer-events:\s*auto;/s);
  });

  it('adapts the conversation composer to the width left by a wide right dock', () => {
    const cssPath = `${process.cwd()}/src/styles.css`;
    const css = readFileSync(cssPath, 'utf8');

    expect(css).toMatch(/\.right-dock-workspace\s*{[^}]*width:\s*min\(\s*var\(--right-sidebar-width, 416px\),\s*calc\(100% - var\(--right-panel-main-min-width, 360px\)\)\s*\);/s);
    expect(css).toMatch(/\.main-stage\s*{[^}]*container-name:\s*main-stage;[^}]*container-type:\s*inline-size;/s);
    expect(css).toMatch(/@container main-stage \(max-width:\s*520px\)\s*{[\s\S]*?\.composer-toolbar\s*{[^}]*flex-wrap:\s*nowrap;[\s\S]*?\.approval-pill > span,[\s\S]*?\.approval-pill > \.lucide-chevron-down\s*{[^}]*display:\s*none;/s);
    expect(css).toMatch(/\.suggestion-row\s*{[^}]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(min\(180px, 100%\), 1fr\)\);/s);
    expect(css).toMatch(/@container main-stage \(max-width:\s*520px\)\s*{[\s\S]*?\.suggestion-row\s*{[^}]*grid-template-columns:\s*1fr;/s);
    expect(css).not.toMatch(/\.suggestion-card:nth-child\(n \+ 2\)\s*{[^}]*display:\s*none;/s);
    expect(css).not.toContain('.model-pill-icon');
  });

  it('keeps panel actions fixed while environment actions move beside an open right dock', () => {
    const cssPath = `${process.cwd()}/src/styles.css`;
    const css = readFileSync(cssPath, 'utf8');

    expect(css).toMatch(/\.top-bar-actions\s*{[^}]*position:\s*fixed;[^}]*top:\s*8px;[^}]*right:\s*12px;[^}]*z-index:\s*90;/s);
    expect(css).toMatch(/@media \(max-width:\s*900px\)\s*{[\s\S]*?\.top-bar-actions\s*{[^}]*z-index:\s*130;/s);
    expect(css).toMatch(/\.top-bar-env-actions,\s*\.top-bar-panel-actions\s*{[^}]*display:\s*inline-flex;[^}]*gap:\s*4px;/s);
    expect(css).toMatch(/\.app-shell\.right-panel-open\s+\.top-bar-env-actions\s*{[^}]*position:\s*fixed;[^}]*top:\s*8px;[^}]*right:\s*calc\(var\(--right-sidebar-width, 416px\) \+ 16px\);/s);
    expect(css).toMatch(/\.app-shell\.git-panel-open\s+\.top-bar-env-actions\s*{[^}]*right:\s*calc\(var\(--git-panel-width, 430px\) \+ 16px\);/s);
    expect(css).toMatch(/\.app-shell\.review-panel-open\s+\.top-bar-env-actions\s*{[^}]*right:\s*calc\(var\(--review-panel-width, 704px\) \+ 16px\);/s);
    expect(css).not.toMatch(/\.app-shell\.right-panel-open\s+\.top-bar-actions\s*{/);
    expect(css).not.toMatch(/\.app-shell\.git-panel-open\s+\.top-bar-actions\s*{/);
    expect(css).not.toMatch(/\.app-shell\.review-panel-open\s+\.top-bar-actions\s*{/);
    expect(css).toMatch(/\.app-shell\.right-dock-expanded\s+\.main-stage\s*{[^}]*display:\s*none;/s);
    expect(css).toMatch(/\.app-shell\.right-dock-expanded\s+\.right-dock-workspace\s*{[^}]*width:\s*auto;[^}]*flex:\s*1 1 auto;/s);
    expect(css).toMatch(/\.right-dock-expand-btn\s*{[^}]*width:\s*30px;[^}]*height:\s*30px;/s);
    expect(css).toMatch(/\.app-shell\s*{[^}]*--top-panel-actions-width:\s*132px;/s);
    expect(css).toMatch(/\.app-shell\.daily-decision-available\s*{[^}]*--top-panel-actions-width:\s*166px;/s);
    expect(css).toMatch(/\.right-dock-tabs\s*{[^}]*padding:\s*0 calc\(var\(--top-panel-actions-width\) \+ 56px\) 0 8px;/s);
    expect(css).toMatch(/\.right-dock-tabbar-actions\s*{[^}]*right:\s*calc\(var\(--top-panel-actions-width\) \+ 20px\);/s);
    expect(css).toMatch(/\.app-shell\.right-dock-expanded\s+\.right-dock-tabs\s*{[^}]*padding-right:\s*calc\(var\(--top-panel-actions-width\) \+ 56px\);/s);
    expect(css).toMatch(/\.app-shell\.right-dock-expanded\s+\.right-dock-tabbar-actions\s*{[^}]*right:\s*calc\(var\(--top-panel-actions-width\) \+ 20px\);/s);
    expect(css).toMatch(/\.coworkers-panel-head\s*{[^}]*padding:\s*13px calc\(var\(--top-panel-actions-width\) \+ 17px\) 10px 16px;/s);
    expect(css).toMatch(/\.environment-menu\s*{[^}]*position:\s*fixed;[^}]*top:\s*48px;[^}]*right:\s*16px;[^}]*width:\s*304px;/s);
    expect(css).toMatch(/\.app-shell\.right-panel-open\s+\.environment-menu\s*{[^}]*right:\s*calc\(var\(--right-sidebar-width, 416px\) \+ 16px\);/s);
    expect(css).toMatch(/\.top-bar-actions\s+button:focus\s*{[^}]*outline:\s*none;/s);
    expect(css).toMatch(/\.topbar-menu\s*>\s*\.menu-backdrop\s*{[^}]*top:\s*44px;/s);
  });

  it('renders sidebar hover actions as readable floating pills', () => {
    const cssPath = `${process.cwd()}/src/styles.css`;
    const css = readFileSync(cssPath, 'utf8');

    expect(css).toMatch(/\.project-actions,\s*\.conv-actions\s*{[^}]*border:\s*1px solid var\(--border\);[^}]*border-radius:\s*8px;[^}]*background:\s*color-mix\(in srgb, var\(--bg\) 92%, var\(--bg-hover\)\);[^}]*box-shadow:\s*0 2px 8px rgba\(0, 0, 0, 0\.10\);/s);
    expect(css).toMatch(/\.project-actions \.row-icon-btn,\s*\.conv-actions \.row-icon-btn\s*{[^}]*background:\s*var\(--bg-elev-1\);[^}]*color:\s*var\(--text\);/s);
    expect(css).toMatch(/\.conv-row:hover \.conv-title,\s*\.conv-row\.menu-open \.conv-title\s*{[^}]*padding-right:\s*58px;/s);
    expect(css).not.toMatch(/\.project-actions,\s*\.conv-actions\s*{[^}]*background:\s*linear-gradient\(to right, transparent/s);
  });

  it('keeps the settings icon readable on hover and keyboard focus', () => {
    const cssPath = `${process.cwd()}/src/styles.css`;
    const css = readFileSync(cssPath, 'utf8');

    expect(css).toMatch(/\.sidebar-footer \.settings-entry:hover svg,\s*\.sidebar-footer \.settings-entry:focus-visible svg\s*{[^}]*color:\s*inherit;/s);
  });

  it('keeps the review workspace styled as tabs with a hideable file list', () => {
    const cssPath = `${process.cwd()}/src/styles.css`;
    const css = readFileSync(cssPath, 'utf8');

    expect(css).toMatch(/\.right-dock-tabbar\s*{[^}]*height:\s*56px;[^}]*border-bottom:\s*1px solid var\(--border\);/s);
    expect(css).toMatch(/\.right-dock-tab\.active\s*{[^}]*background:\s*var\(--accent-soft\);[^}]*font-weight:\s*600;/s);
    expect(css).toMatch(/\.right-dock-workspace\.collapsed\s*{[^}]*display:\s*none;/s);
    expect(css).toMatch(/\.review-status-menu\s*{[^}]*min-width:\s*212px;[^}]*border-radius:\s*13px;/s);
    expect(css).toMatch(/\.review-file-list-toggle\.active\s*{[^}]*background:\s*var\(--bg-soft\);/s);
    expect(css).toMatch(/\.review-tree-head input\s*{[^}]*border:\s*1px solid var\(--border\);[^}]*border-radius:\s*10px;/s);
    expect(css).toMatch(/\.review-scroll\s*{[^}]*padding-bottom:\s*76px;/s);
    expect(css).toMatch(/\.review-floating\s*{[^}]*bottom:\s*42px;[^}]*z-index:\s*24;/s);
  });

  it('maps catalog models to model-specific reasoning options', () => {
    const catalog: CodexModelCatalogItem[] = [{ id: 'gpt-5.6-sol', displayName: 'GPT-5.6 Sol', isDefault: true, hidden: false, defaultReasoningEffort: 'max', supportedReasoningEfforts: [{ reasoningEffort: 'high', description: 'Thorough' }, { reasoningEffort: 'max', description: 'Maximum' }, { reasoningEffort: 'ultra', description: 'Ultra' }] }];
    const [profile] = modelProfilesFromCodexCatalog(catalog);
    expect(profile.label).toBe('GPT-5.6 Sol');
    expect(profile.supportedReasoningEfforts?.map((item) => item.reasoningEffort)).toEqual(['high', 'max', 'ultra']);
  });
});
