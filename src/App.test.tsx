import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { App } from './App';
import { ALPHA_GATEWAY_PROVIDER_ID, clearClientLicenseSession, loadClientLicenseSession, saveClientLicenseSession } from './license';
import { DEFAULT_MODEL_PROFILE_ID, defaultModelProfiles, modelProfilesFromCodexCatalog } from './models';
import type { CodexModelCatalogItem } from './types';
import { useChatStore } from './store';
import type { Conversation } from './types';
import { INTRADAY_MONITOR_CARD_PROMPT, REPORT_REVIEW_CARD_PROMPT } from './themeAbilities';

const windowMockState = vi.hoisted(() => ({
  fullscreen: false,
  resizeHandler: null as (() => void) | null,
}));
const codexCatalogMockState = vi.hoisted(() => ({
  status: { installed: true, version: 'test', path: '/usr/bin/codex', loggedIn: false, error: 'Alpha Studio 的 Codex CLI 尚未完成设备授权。' },
  models: [] as CodexModelCatalogItem[],
  error: null as Error | null,
}));

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: vi.fn((path: string) => `asset://localhost/${path}`),
  invoke: vi.fn((command: string, args?: { request?: { method?: string; name?: string; data?: string; currentPath?: string; path?: string; params?: Record<string, unknown>; codes?: string[]; tickCode?: string; tickCount?: number; fullMarket?: boolean; pageSize?: number } }) => {
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
    if (command === 'jqdata_config_load') {
      return Promise.resolve({
        version: 1,
        enabled: true,
        username: 'demo-user',
        passwordConfigured: true,
        apiUrl: 'https://dataapi.joinquant.com/v2/apis',
        updatedAt: '1',
        path: '/Users/demo/.alpha-studio/jqdata-config.json',
      });
    }
    if (command === 'jqdata_config_save') return Promise.resolve({ path: '/Users/demo/.alpha-studio/jqdata-config.json' });
    if (command === 'jqdata_test_connection') {
      return Promise.resolve({
        ok: true,
        message: 'JQData 连接成功。',
        queryCount: { total: 1000 },
        sample: { tradeDays: ['2024-01-02'], priceRows: [{ index: '2024-01-02', close: 9.1 }] },
      });
    }
    if (command === 'eastmoney_realtime_query') {
      const request = args?.request;
      const codes = Array.isArray(request?.codes) ? request.codes : [];
      if (request?.fullMarket) {
        const fullRows = [
          ['600519.XSHG', '贵州茅台', '白酒', 1190, 1200, 9_000_000_000],
          ['000001.XSHE', '平安银行', '银行', 10.4, 10.5, 310_000_000],
          ['300750.XSHE', '宁德时代', '电池', 210, 205, 1_500_000_000],
          ['688981.XSHG', '中芯国际', '半导体', 58, 56, 2_100_000_000],
          ['600036.XSHG', '招商银行', '银行', 35.5, 35.1, 980_000_000],
          ['601127.XSHG', '赛力斯', '汽车', 88.8, 86.4, 1_280_000_000],
        ].map(([code, name, sector, price, prevClose, turnoverAmount]) => ({
          code,
          name,
          sector,
          source: 'eastmoney',
          price,
          prevClose,
          changeAmt: Number(price) - Number(prevClose),
          changePct: ((Number(price) - Number(prevClose)) / Number(prevClose)) * 100,
          high: Number(price) * 1.01,
          low: Number(price) * 0.99,
          volumeShares: 1_000_000,
          turnoverAmount,
          marketCapAmount: Number(price) * 100_000_000,
          status: 2,
        }));
        return Promise.resolve({ ok: true, quoteRows: fullRows, tickRows: [] });
      }
      const quoteRows = codes.map((code) => {
        const seed = Array.from(code).reduce((sum, char) => sum + char.charCodeAt(0), 0);
        const prevClose = 10 + (seed % 80);
        const price = Number((prevClose * (1 + (((seed % 7) - 3) / 100))).toFixed(2));
        return {
          code,
          name: '测试标的',
          source: 'eastmoney',
          price,
          prevClose,
          changeAmt: Number((price - prevClose).toFixed(2)),
          changePct: Number((((price - prevClose) / prevClose) * 100).toFixed(2)),
          high: Math.max(prevClose, price) * 1.01,
          low: Math.min(prevClose, price) * 0.99,
          volumeShares: 1_200_000 + seed * 100,
          turnoverAmount: price * 1_200_000,
          marketCapAmount: price * 100_000_000,
          status: 2,
        };
      });
      const tickRows = request?.tickCode
        ? [
            { code: request.tickCode, time: '10:29:54', price: 11.2, volumeHands: 12, volumeShares: 1200, side: '买盘', sideCode: 2 },
            { code: request.tickCode, time: '10:29:57', price: 11.19, volumeHands: 8, volumeShares: 800, side: '卖盘', sideCode: 1 },
          ]
        : [];
      return Promise.resolve({ ok: quoteRows.length > 0 || tickRows.length > 0, quoteRows, tickRows });
    }
    if (command === 'jqdata_query') {
      const request = args?.request;
      if (request?.method === 'get_price') {
        const codes = Array.isArray(request.params?.codes)
          ? request.params.codes.filter((item): item is string => typeof item === 'string')
          : [typeof request.params?.code === 'string' ? request.params.code : '000001.XSHE'];
        const rows = codes.flatMap((code) => {
          const seed = Array.from(code).reduce((sum, char) => sum + char.charCodeAt(0), 0);
          const prevClose = 10 + (seed % 80);
          const close = Number((prevClose * (1 + (((seed % 7) - 3) / 100))).toFixed(2));
          return [
            {
              code,
              date: '2026-07-06',
              open: prevClose * 0.99,
              close: prevClose,
              high: prevClose * 1.01,
              low: prevClose * 0.98,
              volume: 1_000_000 + seed * 100,
              money: prevClose * 1_000_000,
            },
            {
              code,
              date: '2026-07-07',
              open: prevClose,
              close,
              high: Math.max(prevClose, close) * 1.01,
              low: Math.min(prevClose, close) * 0.99,
              volume: 1_200_000 + seed * 100,
              money: close * 1_200_000,
              pre_close: prevClose,
            },
          ];
        });
        return Promise.resolve({
          ok: true,
          rows,
        });
      }
      if (request?.method === 'get_security_info') {
        const code = typeof request.params?.code === 'string' ? request.params.code : '000001.XSHE';
        return Promise.resolve({ ok: true, rows: [{ code, display_name: '测试标的', name: '测试标的' }] });
      }
      if (request?.method === 'get_privilege') {
        return Promise.resolve({
          ok: true,
          rows: ['VALUATION', 'INDICATOR', 'BALANCE', 'INCOME', 'CASH_FLOW', 'GET_MONEY_FLOW', 'GET_MTSS', 'GET_BILLBOARD_LIST', 'GET_INDUSTRY', 'GET_CONCEPT', 'GET_LOCKED_SHARES', 'GET_PREOPEN_INFOS', 'GET_ALL_SECURITIES'].map((privilege) => ({ privilege })),
        });
      }
      if (request?.method === 'get_fundamentals_snapshot') {
        return Promise.resolve({ ok: true, rows: [{ code: '000001.XSHE', pe_ratio: 5.8, pb_ratio: 0.58, roe: 10.4, net_profit_margin: 25.7, inc_revenue_year_on_year: 2.1, inc_net_profit_year_on_year: 4.8, total_assets: 5_300_000_000_000, total_liability: 4_860_000_000_000, net_operate_cash_flow: 64_210_000_000, net_profit: 54_400_000_000 }] });
      }
      if (request?.method === 'get_money_flow') {
        return Promise.resolve({ ok: true, rows: [{ date: '2026-07-10', change_pct: 0.8, net_amount_main: 1200, net_pct_main: 3.2 }, { date: '2026-07-13', change_pct: -0.2, net_amount_main: -320, net_pct_main: -0.9 }] });
      }
      if (request?.method === 'get_mtss') {
        return Promise.resolve({ ok: true, rows: [{ date: '2026-07-10', fin_value: 46_312_000_000, fin_buy_value: 843_100_000, sec_value: 73_200_000 }, { date: '2026-07-13', fin_value: 46_783_000_000, fin_buy_value: 921_000_000, sec_value: 69_800_000 }] });
      }
      if (request?.method === 'get_industry') {
        return Promise.resolve({ ok: true, rows: [{ code: '000001.XSHE', category: '申万一级', industry_code: '801780', industry_name: '银行' }] });
      }
      if (request?.method === 'get_concept') {
        return Promise.resolve({ ok: true, rows: [{ code: '000001.XSHE', concept_code: 'SC0098', name: '高股息' }] });
      }
      if (request?.method === 'get_locked_shares') {
        return Promise.resolve({ ok: true, rows: [{ day: '2026-09-01', num: 20_000_000, rate1: 0.1, type: '首发原股东限售股份' }] });
      }
      if (request?.method === 'get_billboard_list') {
        return Promise.resolve({ ok: true, rows: [{ day: '2026-07-01', direction: 'BUY', sales_depart_name: '机构专用', net_value: 18_000_000 }] });
      }
      if (request?.method === 'get_preopen_infos') {
        return Promise.resolve({ ok: true, rows: [{ code: '000001.XSHE', high_limit: 12.54, low_limit: 10.26 }] });
      }
      if (request?.method === 'get_company_research') {
        return Promise.resolve({ ok: true, rows: [{ section: 'northbound', day: '2026-07-13', share_number: 120_000_000, share_ratio: 0.62 }, { section: 'forecast', pub_date: '2026-07-08', type: '预增', profit_ratio_min: 3.2, profit_ratio_max: 6.8 }, { section: 'shareholders', end_date: '2026-03-31', shareholder_name: '测试股东', share_ratio: 8.2, share_pledge_freeze: 0 }, { section: 'pledge', pub_date: '2026-06-01', pledge_number: 12_000_000, pledge_total_ratio: 0.06 }] });
      }
      if (request?.method === 'get_all_securities') {
        return Promise.resolve({ ok: true, rows: [{ index: '000001.XSHE', display_name: '平安银行', start_date: '1991-04-03', end_date: '2200-01-01' }] });
      }
      return Promise.resolve({ ok: true, rows: [] });
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
    codexCatalogMockState.models = [];
    codexCatalogMockState.error = null;
    seedClientLicenseSession();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse({
      leaseExpiresAt: futureIso(),
    }))));
    useChatStore.setState({
      conversations: [conversation()],
      projects: [],
      currentConversationId: 'conv-right-panel',
      selectedModelProfileId: DEFAULT_MODEL_PROFILE_ID,
      modelProfiles: defaultModelProfiles(),
      workModeId: 'finance-research',
      codexStatus: { installed: true, loggedIn: true, path: '/usr/bin/codex', version: 'test' },
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
    expect(container.querySelector('.license-window-drag-region')).toHaveAttribute('data-tauri-drag-region');
    expect(container.querySelector('.app-shell')).not.toBeInTheDocument();
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
    expect(screen.getByLabelText('打开投研工作台')).toBeInTheDocument();
    expect(screen.getByLabelText('打开浏览器')).toBeInTheDocument();
    expect(container.querySelector('.open-app-trigger-icon')).not.toBeInTheDocument();
    expect(document.querySelector('.app-shell')).toHaveAttribute('data-work-mode', 'finance-research');
  });

  it('exposes the two finance tools as direct right-top actions', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    const workbenchToggle = screen.getByLabelText('打开投研工作台');
    const browserToggle = screen.getByLabelText('打开浏览器');

    expect(workbenchToggle).toHaveAttribute('aria-pressed', 'false');
    expect(workbenchToggle.querySelector('svg')).toHaveClass('lucide-chart-line');
    expect(browserToggle).toHaveAttribute('aria-pressed', 'false');
    expect(browserToggle.querySelector('svg')).toHaveClass('lucide-globe');
    expect(container.querySelector('.features-panel')).not.toBeInTheDocument();

    await user.click(browserToggle);

    expect(container.querySelector('.browser-dock-panel')).toBeInTheDocument();
    expect(screen.getByLabelText('关闭浏览器')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('打开投研工作台')).toHaveAttribute('aria-pressed', 'false');
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

  it('opens the research workbench from the finance right sidebar', async () => {
    const user = userEvent.setup();
    (window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    const { container } = render(<App />);

    await user.click(screen.getByLabelText('打开投研工作台'));

    const workbench = await screen.findByLabelText('投研工作台');
    expect(workbench).toBeInTheDocument();
    expect(within(workbench).getByRole('heading', { name: '投研工作台' })).toBeInTheDocument();
    expect(within(workbench).getByRole('tab', { name: '日报跟踪' })).toBeInTheDocument();
    await waitFor(() => expect(within(workbench).getAllByText(/实时/).length).toBeGreaterThan(0));
    expect(within(workbench).getByText('总资产')).toBeInTheDocument();
    expect(within(workbench).queryByText('聚宽数据雷达')).not.toBeInTheDocument();
    expect(within(workbench).queryByText('财务基本面')).not.toBeInTheDocument();
    expect(within(workbench).getByRole('tab', { name: '研究数据' })).toBeInTheDocument();
    expect(within(workbench).getByRole('tab', { name: '市场' })).toHaveAttribute('aria-selected', 'true');
    expect(within(workbench).getByText('股票排行')).toBeInTheDocument();
    expect(within(workbench).getByText('上证指数')).toBeInTheDocument();
    expect(within(workbench).queryByRole('tab', { name: '盘前主题' })).not.toBeInTheDocument();
    expect(within(workbench).queryByText('盘前主题')).not.toBeInTheDocument();
    expect(workbench.querySelector('.rw-data-pill')).toHaveTextContent(/实时 \d{1,2}:\d{2}:\d{2}/);
    await user.click(within(workbench).getByRole('tab', { name: '研究数据' }));
    expect(within(workbench).getByLabelText('研究数据筛选')).toBeInTheDocument();
    expect(within(workbench).getByRole('button', { name: '基本面' })).toBeInTheDocument();
    expect(within(workbench).getByRole('button', { name: '资金交易' })).toBeInTheDocument();
    expect(within(workbench).getByRole('button', { name: '行业成分' })).toBeInTheDocument();
    expect(within(workbench).getByRole('button', { name: '公司事件' })).toBeInTheDocument();
    expect(within(workbench).getByRole('button', { name: '多资产' })).toBeInTheDocument();
    await waitFor(() => expect(within(workbench).getByRole('heading', { name: '核心财务快照' })).toBeInTheDocument());
    expect(within(workbench).getByText('净资产收益率（ROE）')).toBeInTheDocument();
    expect(within(workbench).getByRole('heading', { name: '研究动作' })).toBeInTheDocument();
    expect(workbench.querySelectorAll('.rw-research-draggable[draggable="true"]').length).toBeGreaterThanOrEqual(14);
    await user.click(within(workbench).getByRole('button', { name: '资金交易' }));
    expect(within(workbench).getByRole('heading', { name: '资金流向' })).toBeInTheDocument();
    expect(workbench.querySelectorAll('.rw-capital-lens .rw-research-draggable[draggable="true"]').length).toBeGreaterThanOrEqual(8);
    await user.click(within(workbench).getByRole('button', { name: '行业成分' }));
    expect(workbench.querySelectorAll('.rw-industry-lens .rw-research-draggable[draggable="true"]').length).toBeGreaterThanOrEqual(2);
    await user.click(within(workbench).getByRole('button', { name: '公司事件' }));
    expect(workbench.querySelectorAll('.rw-events-lens .rw-research-draggable[draggable="true"]').length).toBeGreaterThanOrEqual(8);
    await user.click(within(workbench).getByRole('button', { name: '多资产' }));
    await waitFor(() => expect(workbench.querySelector('.rw-assets-lens .rw-research-draggable[draggable="true"]')).not.toBeNull());
    expect(within(workbench).queryByText('待接入')).not.toBeInTheDocument();
    expect(within(workbench).queryByText('接口可查')).not.toBeInTheDocument();
    await user.click(within(workbench).getByRole('tab', { name: /行情/ }));
    await waitFor(() => expect(within(workbench).getByText('行情仪表盘')).toBeInTheDocument());
    expect(within(workbench).getByText('市场宽度')).toBeInTheDocument();
    expect(within(workbench).getByText('成交额结构')).toBeInTheDocument();
    expect(within(workbench).getByText('市场分层')).toBeInTheDocument();
    expect(within(workbench).getByText('板块强弱')).toBeInTheDocument();
    expect(within(workbench).getByText('活跃度排行')).toBeInTheDocument();
    await waitFor(() => expect(within(workbench).getByText('市场快照')).toBeInTheDocument());
    expect(within(workbench).getByText('行业热力图')).toBeInTheDocument();
    expect(within(workbench).getByText('涨跌分布')).toBeInTheDocument();
    expect(within(workbench).getByText(/D3 treemap · 行情池 6 只/)).toBeInTheDocument();
    expect(workbench.querySelector('.rw-treemap-canvas')).toBeInTheDocument();
    const treemapMode = within(workbench).getByRole('group', { name: '热力图显示模式' });
    expect(within(treemapMode).getByRole('button', { name: '核心' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(treemapMode).getByRole('button', { name: '板块' })).toBeInTheDocument();
    expect(within(treemapMode).getByRole('button', { name: '细节' })).toBeInTheDocument();
    expect(within(workbench).getByLabelText('强弱行业')).toBeInTheDocument();
    expect(workbench.querySelector('.rw-data-pill')).toHaveTextContent(/实时 \d{1,2}:\d{2}:\d{2}/);
    expect(within(workbench).queryByRole('tab', { name: '盘前主题' })).not.toBeInTheDocument();
  });

  it('searches full-market-only stocks when creating a research portfolio', async () => {
    const user = userEvent.setup();
    (window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    const { container } = render(<App />);

    await user.click(screen.getByLabelText('打开投研工作台'));

    const workbench = await screen.findByLabelText('投研工作台');
    await waitFor(() => expect(within(workbench).getByText('赛力斯')).toBeInTheDocument());

    await user.click(within(workbench).getByRole('tab', { name: /组合/ }));
    await user.click(within(workbench).getByRole('button', { name: /新建组合/ }));
    await user.type(within(workbench).getByPlaceholderText('组合名称，如：AI 算力观察'), '智能车观察');
    await user.type(within(workbench).getByPlaceholderText('搜索加入成分股（默认展示自选与持仓）'), '赛力斯');
    await user.click(await within(workbench).findByRole('button', { name: /赛力斯/ }));
    await user.click(within(workbench).getByRole('button', { name: /创建组合（1 只）/ }));

    expect(within(workbench).getByText('智能车观察')).toBeInTheDocument();
    expect(within(workbench).getByText('赛力斯')).toBeInTheDocument();
    const persisted = JSON.parse(window.localStorage.getItem('alpha-studio.research-state.v2') || '{}');
    expect(persisted.customSecurities?.['601127.XSHG']?.name).toBe('赛力斯');
    expect(persisted.portfolios?.some((portfolio: { codes?: string[] }) => portfolio.codes?.includes('601127.XSHG'))).toBe(true);
  });

  it('supports simulated funding and trading inside the research workbench', async () => {
    const user = userEvent.setup();
    (window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    const { container } = render(<App />);

    await user.click(screen.getByLabelText('打开投研工作台'));

    const workbench = await screen.findByLabelText('投研工作台');
    await user.click(within(workbench).getByRole('tab', { name: /交易/ }));

    expect(within(workbench).getByLabelText('入金出金金额')).toBeInTheDocument();
    expect(within(workbench).getByRole('button', { name: /入金/ })).toBeInTheDocument();
    expect(within(workbench).getByRole('button', { name: /出金/ })).toBeInTheDocument();
    expect(within(workbench).getByText('模拟下单')).toBeInTheDocument();

    await user.click(within(workbench).getByRole('button', { name: /入金/ }));
    expect(within(workbench).getByText(/入金 10\.00万 成功/)).toBeInTheDocument();

    await user.click(within(workbench).getByRole('tab', { name: /组合/ }));
    expect(within(workbench).getByText('股票组合')).toBeInTheDocument();
    expect(within(workbench).getByText('核心资产观察')).toBeInTheDocument();
    expect(within(workbench).getByRole('button', { name: /新建组合/ })).toBeInTheDocument();
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

    expect(container.querySelector('.right-dock-tab.active')).toHaveTextContent('浏览器');
    expect(container.querySelector('.browser-dock-panel')).toBeInTheDocument();

    await user.click(screen.getByLabelText('打开 AI 同事面板'));
    expect(container.querySelector('.coworkers-panel')).toBeInTheDocument();

    await user.click(screen.getByLabelText('打开浏览器'));

    expect(container.querySelector('.coworkers-panel')).not.toBeInTheDocument();
    expect(container.querySelector('.right-dock-tab.active')).toHaveTextContent('浏览器');
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
      ['生成今日报告', '使用 alpha-studio-daily-theme-research 生成今日的报告'],
      ['盘中监控', INTRADAY_MONITOR_CARD_PROMPT],
      ['晚间复盘', REPORT_REVIEW_CARD_PROMPT],
    ];

    for (const [title, prompt] of suggestions) {
      await user.click(screen.getByRole('button', { name: new RegExp(title) }));
      expect(textbox).toHaveValue(prompt);
    }
    expect(screen.getByRole('button', { name: /生成今日报告/ }).querySelector('.lucide-file-chart-column')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /盘中监控/ }).querySelector('.lucide-activity')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /晚间复盘/ }).querySelector('.lucide-moon-star')).toBeInTheDocument();
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
    expect(within(composerCard).getByText('notes.pdf')).toBeInTheDocument();
    expect(within(composerCard).getByLabelText('发送')).toBeEnabled();
  });

  it('shows the background context window usage in the composer', () => {
    const { container } = render(<App />);
    const composerCard = container.querySelector('.main-stage .composer-card') as HTMLElement;
    const indicator = composerCard.querySelector('.context-window-indicator') as HTMLElement;

    expect(indicator).toBeInTheDocument();
    expect(indicator).toHaveTextContent('% 已用');
    expect(indicator).toHaveAttribute('title', expect.stringContaining('背景信息窗口'));
    expect(indicator).toHaveAttribute('title', expect.stringContaining('共 258k'));
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
    fireEvent.mouseEnter(composerCard.querySelector('.plus-flyout-row') as HTMLElement);

    expect(await screen.findByRole('menuitem', { name: /Alpha Studio 盘前主题/ })).toBeInTheDocument();
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

  it('keeps coding tabs out of the right sidebar add menu', async () => {
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
    expect(within(tabMenu).queryByRole('button', { name: /文件/ })).not.toBeInTheDocument();
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
    expect(within(skillsPage).getByText('个人')).toBeInTheDocument();
    expect(within(skillsPage).getByText('系统')).toBeInTheDocument();
    expect(within(skillsPage).getByText('Browser')).toBeInTheDocument();
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
    expect(automationPage.querySelector('.automation-drag-strip')).toHaveAttribute('data-tauri-drag-region');
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
    expect(within(editor).getByPlaceholderText('描述 Codex 应该做什么')).toBeInTheDocument();
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
    useChatStore.setState({ codexStatus: { installed: true, version: 'test', path: '/usr/bin/codex', loggedIn: true }, codexModelCatalog: CODEX_MODEL_CATALOG, modelProfiles: modelProfilesFromCodexCatalog(CODEX_MODEL_CATALOG), selectedModelProfileId: 'gpt-5.6-sol', reasoningEffort: 'ultra' });
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
    await user.click(within(automationPage).getByRole('button', { name: /CI 失败总结/ }));

    const editor = within(automationPage).getByRole('complementary', { name: '手动创建自动化任务' });
    expect(within(editor).getByLabelText('已安排任务标题')).toHaveValue('CI 失败总结');
    expect(within(editor).getByLabelText('提示词')).toHaveValue('总结上一个 CI 窗口中的失败和不稳定测试，并给出首要修复建议。');
    expect(within(editor).getByLabelText('重复')).toHaveValue('daily');
    expect(within(editor).getByLabelText('时间')).toHaveTextContent('21:00');
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

    expect(within(automationPage).getByRole('heading', { name: '当前' })).toBeInTheDocument();
    expect(within(automationPage).getByRole('button', { name: /每日 Neostream 题材研究日报/ })).toBeInTheDocument();
    expect(within(automationPage).getByText('Next run 待安排 · 每天 9:00')).toBeInTheDocument();
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

  it('opens a skill detail dialog and queues the skill for the chat composer', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByRole('button', { name: '技能' }));
    const skillsPage = container.querySelector('.skills-page') as HTMLElement;
    await user.click(within(skillsPage).getByRole('button', { name: /OpenAI Docs/ }));

    const dialog = screen.getByRole('dialog', { name: 'OpenAI Docs Skill' });
    expect(within(dialog).getByText(/Reference OpenAI docs/)).toBeInTheDocument();
    expect(within(dialog).getByRole('switch', { name: '禁用 OpenAI Docs' })).toHaveAttribute('aria-checked', 'true');

    await user.click(within(dialog).getByRole('button', { name: '在对话中试用' }));

    expect(container.querySelector('.skills-page')).not.toBeInTheDocument();
    const composer = document.querySelector('.composer-card') as HTMLElement;
    expect(within(composer).getByText('OpenAI Docs')).toBeInTheDocument();
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

    expect(screen.getByRole('menuitem', { name: 'Playwright' })).toBeInTheDocument();
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
    expect(screen.getByPlaceholderText('询问市场、行业、公司或组合问题')).toBeInTheDocument();
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
                amountYuan: -3.25,
                description: 'gpt-5.5 usage charge',
                createdAt: '2026-07-09T08:00:00.000Z',
              },
            ],
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
    expect(within(settings).getByText('Codex 订阅')).toBeInTheDocument();
    expect(within(settings).getByText('剩余用量')).toBeInTheDocument();
    expect(within(settings).getByText('5 小时')).toBeInTheDocument();
    expect(within(settings).getByText('1 周')).toBeInTheDocument();
    expect(within(settings).getByText('63%')).toBeInTheDocument();
    expect(within(settings).getByText('23%')).toBeInTheDocument();
    expect(within(settings).getByText('API 套餐')).toBeInTheDocument();
    expect(within(settings).getByText(/96\.75/)).toBeInTheDocument();
    expect(within(settings).getAllByText(/3\.25/).length).toBeGreaterThan(0);
    expect(within(settings).getByText('GPT-5.5 API')).toBeInTheDocument();
    expect(within(settings).getByText('gpt-5.5 usage charge')).toBeInTheDocument();
    expect(within(settings).queryByText('PolyForm Noncommercial License 1.0.0。')).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:18080/api/client/billing-summary',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"tenantId":"tenant_demo"'),
      }),
    );
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

    await user.click(screen.getByTitle('选择模型与推理强度'));
    const modelMenu = document.querySelector('.model-choice-menu') as HTMLElement;
    const modelRow = within(modelMenu).getByText(/GPT-5\.5 API|5\.5 API/).closest('.model-flyout-row') as HTMLElement;
    fireEvent.mouseEnter(modelRow);

    expect(await screen.findByText('订阅模型')).toBeInTheDocument();
    expect(screen.getByText('按量模型')).toBeInTheDocument();
    expect(screen.queryByText('内置模型')).not.toBeInTheDocument();
    expect(screen.queryByText('自定义模型')).not.toBeInTheDocument();
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
    await user.hover(screen.getByRole('button', { name: /GPT-5.6 Sol/ }));
    expect(screen.getByRole('menuitemradio', { name: 'GPT-5.6 Sol' })).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: 'GPT-5.6 Terra' })).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: 'GPT-5.6 Luna' })).toBeInTheDocument();
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
    expect(screen.getByRole('menuitemradio', { name: 'Ultra' })).toBeInTheDocument();
    await user.hover(screen.getByRole('button', { name: /GPT-5.6 Sol/ }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'GPT-5.6 Terra' }));
    await waitFor(() => expect(useChatStore.getState().reasoningEffort).toBe('high'));
    await user.click(screen.getByTitle('选择模型与推理强度'));
    expect(screen.queryByRole('menuitemradio', { name: 'Ultra' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('menuitemradio').map((item) => item.textContent)).toEqual(expect.arrayContaining(['低', '中', '高', 'Max']));
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
    const pickerMenu = screen.getByRole('menu');
    await user.hover(within(pickerMenu).getByRole('button', { name: /GPT-5\.5 API|5\.5 API/ }));
    expect(screen.getByRole('menuitemradio', { name: 'GPT-5.5' })).toBeInTheDocument();
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
        error: 'Alpha Studio 的 Codex CLI 尚未完成设备授权。',
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
    expect(screen.queryByText('Alpha Studio 的 Codex CLI 尚未完成设备授权。')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('继续追问投研问题')).toBeEnabled();

    await user.click(screen.getByTitle('选择模型与推理强度'));
    const modelMenu = document.querySelector('.model-choice-menu') as HTMLElement;
    const modelRow = within(modelMenu).getByText('GPT-5.5 API').closest('.model-flyout-row') as HTMLElement;
    fireEvent.mouseEnter(modelRow);

    expect(await screen.findByText('按量模型')).toBeInTheDocument();
    expect(screen.getAllByText('GPT-5.5 API').length).toBeGreaterThan(0);
    expect(screen.queryByText('订阅模型')).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitemradio', { name: 'GPT-5.5' })).not.toBeInTheDocument();
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
          error: 'Alpha Studio 的 Codex CLI 尚未完成设备授权。',
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
        error: 'Alpha Studio 的 Codex CLI 尚未完成设备授权。',
      },
      selectedModelProfileId: DEFAULT_MODEL_PROFILE_ID,
      modelProfiles: defaultModelProfiles(),
    });

    render(<App />);

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('model_config_load'));
    await waitFor(() => expect(screen.getByTitle('选择模型与推理强度')).toHaveTextContent('5.5 API'));
    expect(screen.queryByText('AI 引擎暂不可用')).not.toBeInTheDocument();
    expect(screen.queryByText('Alpha Studio 的 Codex CLI 尚未完成设备授权。')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('继续追问投研问题')).toBeEnabled();

    await user.click(screen.getByTitle('选择模型与推理强度'));
    const modelMenu = document.querySelector('.model-choice-menu') as HTMLElement;
    const modelRow = within(modelMenu).getByText('GPT-5.5 API').closest('.model-flyout-row') as HTMLElement;
    fireEvent.mouseEnter(modelRow);

    expect(await screen.findByText('按量模型')).toBeInTheDocument();
    expect(screen.queryByText('订阅模型')).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitemradio', { name: 'GPT-5.5' })).not.toBeInTheDocument();
  });

  it('keeps finance settings focused and removes user model configuration', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(within(container.querySelector('.sidebar') as HTMLElement).getByRole('button', { name: '设置' }));

    const settings = screen.getByRole('dialog', { name: '设置' });
    expect(within(settings).getByRole('heading', { name: '显示偏好' })).toBeInTheDocument();
    expect(within(settings).getByText('界面主题')).toBeInTheDocument();
    expect(within(settings).getByRole('button', { name: '账户与授权' })).toBeInTheDocument();
    expect(within(settings).getByRole('button', { name: '聚宽数据' })).toBeInTheDocument();
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
    expect(screen.queryByText(/Codex 订阅账号/)).not.toBeInTheDocument();

    await user.click(within(container.querySelector('.sidebar') as HTMLElement).getByRole('button', { name: '设置' }));
    const settings = screen.getByRole('dialog', { name: '设置' });
    await user.click(within(settings).getByRole('button', { name: '账户与授权' }));

    expect(within(settings).getByText('Codex 订阅账号')).toBeInTheDocument();
    expect(within(settings).getByText('codex-demo@alpha.local')).toBeInTheDocument();
    expect(within(settings).getByText('Use browser login handoff')).toBeInTheDocument();
    expect(within(settings).getByText('设备授权')).toBeInTheDocument();
    expect(within(settings).queryByText('设备租约')).not.toBeInTheDocument();

    await user.click(within(settings).getByRole('button', { name: '退出登录' }));

    await waitFor(() => expect(screen.getByRole('heading', { name: '激活 Alpha Studio' })).toBeInTheDocument());
    expect(loadClientLicenseSession()).toBeNull();
  });

  it('requires an explicit button press to launch Codex CLI device authorization', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
    useChatStore.setState({
      codexStatus: {
        installed: true,
        loggedIn: false,
        path: '/usr/bin/codex',
        version: 'test',
        error: 'Alpha Studio 的 Codex CLI 尚未完成设备授权。',
      },
    });
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(within(container.querySelector('.sidebar') as HTMLElement).getByRole('button', { name: '设置' }));
    const settings = screen.getByRole('dialog', { name: '设置' });
    await user.click(within(settings).getByRole('button', { name: '账户与授权' }));

    const loginButton = within(settings).getByRole('button', { name: '授权 Codex CLI' });
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
      codexStatus: { installed: true, loggedIn: true, path: '/usr/bin/codex', version: 'test' },
    });
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(within(container.querySelector('.sidebar') as HTMLElement).getByRole('button', { name: '设置' }));
    const settings = screen.getByRole('dialog', { name: '设置' });
    await user.click(within(settings).getByRole('button', { name: '账户与授权' }));

    await waitFor(() => expect(within(settings).getByText('已授权')).toBeInTheDocument());
    expect(within(settings).queryByRole('button', { name: '授权 Codex CLI' })).not.toBeInTheDocument();
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
          error: revoked ? 'Alpha Studio 的 Codex CLI 尚未完成设备授权。' : undefined,
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
      codexStatus: { installed: true, loggedIn: true, path: '/usr/bin/codex', version: 'test' },
    });
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(within(container.querySelector('.sidebar') as HTMLElement).getByRole('button', { name: '设置' }));
    const settings = screen.getByRole('dialog', { name: '设置' });
    await user.click(within(settings).getByRole('button', { name: '账户与授权' }));

    await user.click(await within(settings).findByRole('button', { name: '撤销授权' }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('codex_revoke_authorization'));
    await waitFor(() => expect(within(settings).getByText('未授权')).toBeInTheDocument());
    expect(within(settings).getByRole('button', { name: '授权 Codex CLI' })).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('menuitem', { name: 'Chrome' }));

    const composer = document.querySelector('.composer-card') as HTMLElement;
    expect(within(composer).getByText('Chrome')).toBeInTheDocument();

    await user.type(within(composer).getByRole('textbox'), '检查页面控制台');
    await user.click(within(composer).getByLabelText('发送'));

    expect(sendMessage).toHaveBeenCalledWith(
      '检查页面控制台',
      [],
      expect.objectContaining({ id: 'chrome', title: 'Chrome' }),
      [],
    );
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

    expect(within(messageList).getByText('$Chrome')).toBeInTheDocument();
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

    expect(convertFileSrc).toHaveBeenCalledWith('/Users/geb/.alpha-studio/codex-home/generated_images/cat.png');
    expect(image.getAttribute('src')).toBe('asset://localhost//Users/geb/.alpha-studio/codex-home/generated_images/cat.png');

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

    await waitFor(() => expect(convertFileSrc).toHaveBeenCalledWith('/Users/geb/reports/daily-theme/index.html'));
    await waitFor(() => expect(container.querySelector('.browser-frame')).not.toBeNull());
    expect(screen.getByPlaceholderText('搜索或输入网址')).toHaveValue('/Users/geb/reports/daily-theme/index.html');
    const frame = container.querySelector('.browser-frame') as HTMLIFrameElement;
    await waitFor(() => expect(frame?.getAttribute('srcdoc')).toContain('HTML 报告内容'));
    expect(frame?.getAttribute('srcdoc')).toContain('<style>');
    expect(frame?.getAttribute('srcdoc')).toContain('data:image/png;base64,preview');
    expect(screen.queryByText('<!doctype html>')).not.toBeInTheDocument();
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

    await waitFor(() => expect(convertFileSrc).toHaveBeenCalledWith('/Users/geb/reports/daily-theme/index.html'));
    await waitFor(() => expect(container.querySelector('.browser-frame')).not.toBeNull());
    expect(screen.getByPlaceholderText('搜索或输入网址')).toHaveValue('/Users/geb/reports/daily-theme/index.html');
    const frame = container.querySelector('.browser-frame') as HTMLIFrameElement;
    await waitFor(() => expect(frame?.getAttribute('srcdoc')).toContain('HTML 报告内容'));
    expect(frame?.getAttribute('srcdoc')).toContain('<style>');
    expect(frame?.getAttribute('srcdoc')).toContain('data:image/png;base64,preview');
  });

  it('renders inline generated file menus outside clipped markdown content', async () => {
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
              ],
            },
          ],
        }),
      ],
    });

    const { container } = render(<App />);
    const markdown = container.querySelector('.markdown-content') as HTMLElement;
    const card = within(markdown).getByRole('button', { name: '打开 index.html' });

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
    expect(within(sideChat).getByPlaceholderText('询问市场、行业、公司或组合问题')).toBeInTheDocument();
  });

  it('shows browser as a tabbed finance workspace with a pruned add-tab menu', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByLabelText('打开浏览器'));

    const browser = container.querySelector('.browser-dock-panel') as HTMLElement;
    const dock = container.querySelector('.right-dock-workspace') as HTMLElement;
    expect(browser).toBeInTheDocument();
    expect(within(dock).getByRole('tab', { name: '浏览器' })).toHaveAttribute('aria-selected', 'true');

    await user.click(within(dock).getByLabelText('添加侧边栏标签'));
    const tabMenu = container.querySelector('.right-dock-tab-menu') as HTMLElement;
    expect(tabMenu).toBeInTheDocument();
    expect(within(tabMenu).getByRole('button', { name: /浏览器/ })).toBeInTheDocument();
    expect(within(tabMenu).queryByRole('button', { name: /侧边聊天/ })).not.toBeInTheDocument();
    expect(within(tabMenu).queryByRole('button', { name: /审查/ })).not.toBeInTheDocument();
    expect(within(tabMenu).queryByRole('button', { name: /^终端$/ })).not.toBeInTheDocument();
    expect(within(tabMenu).queryByRole('button', { name: /文件/ })).not.toBeInTheDocument();
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
    expect(card).toHaveClass('compact');

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
    expect(within(dock).getAllByRole('tab', { name: '浏览器' })).toHaveLength(2);
    expect(within(activeBrowser).getByPlaceholderText('搜索或输入网址')).toHaveValue(secondUrl);
    expect(activeBrowser.querySelector('.browser-frame')).toHaveAttribute('src', secondUrl);
    expect(browsers[0].querySelector('.browser-frame')).toHaveAttribute('src', firstUrl);
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

    expect(within(group).getAllByText('已搜索网页')).toHaveLength(3);
    expect(within(group).getByText('机器人 产业链 最新政策')).toBeInTheDocument();
    expect(within(group).getByText('国产算力 交换机 订单')).toBeInTheDocument();
    expect(within(group).getByText('CGT 征求意见 国家药监局')).toBeInTheDocument();
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
    expect(within(dock).getByRole('tab', { name: '浏览器' })).toHaveAttribute('aria-selected', 'true');

    await user.click(screen.getByLabelText('关闭浏览器'));
    expect(dock).toHaveClass('collapsed');
    expect(container.querySelector('.browser-dock-panel')).toBe(browser);

    await user.click(screen.getByLabelText('打开浏览器'));
    expect(dock).not.toHaveClass('collapsed');
    expect(container.querySelector('.browser-dock-panel')).toBe(browser);
    expect(within(dock).getByRole('tab', { name: '浏览器' })).toHaveAttribute('aria-selected', 'true');
    expect(within(dock).getAllByRole('tab', { name: '浏览器' })).toHaveLength(1);
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
    expect(css).toMatch(/@container main-stage \(max-width:\s*520px\)\s*{[\s\S]*?\.composer-toolbar\s*{[^}]*flex-wrap:\s*nowrap;[\s\S]*?\.context-window-indicator > span\s*{[^}]*display:\s*none;/s);
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
    expect(css).toMatch(/\.right-dock-tabs\s*{[^}]*padding:\s*0 154px 0 8px;/s);
    expect(css).toMatch(/\.right-dock-tabbar-actions\s*{[^}]*right:\s*118px;/s);
    expect(css).toMatch(/\.app-shell\.right-dock-expanded\s+\.right-dock-tabs\s*{[^}]*padding-right:\s*50px;/s);
    expect(css).toMatch(/\.app-shell\.right-dock-expanded\s+\.right-dock-tabbar-actions\s*{[^}]*right:\s*12px;/s);
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

  it('keeps the review workspace styled as tabs with a hideable file list', () => {
    const cssPath = `${process.cwd()}/src/styles.css`;
    const css = readFileSync(cssPath, 'utf8');

    expect(css).toMatch(/\.right-dock-tabbar\s*{[^}]*height:\s*44px;[^}]*border-bottom:\s*1px solid var\(--border\);/s);
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
