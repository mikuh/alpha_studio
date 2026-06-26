import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { App } from './App';
import { clearClientLicenseSession, loadClientLicenseSession, saveClientLicenseSession } from './license';
import { DEFAULT_MODEL_PROFILE_ID, defaultModelProfiles } from './models';
import { useChatStore } from './store';
import type { Conversation } from './types';

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: vi.fn((path: string) => `asset://localhost/${path}`),
  invoke: vi.fn((command: string) => {
    if (command === 'codex_check') {
      return Promise.resolve({
        installed: true,
        version: 'test',
        path: '/usr/bin/codex',
        loggedIn: false,
        error: 'Alpha Studio 的 Codex CLI 尚未完成设备授权。',
      });
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
  }),
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: vi.fn(() => ({
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

function seedClientLicenseSession() {
  saveClientLicenseSession({
    apiBaseUrl: 'http://localhost:18080',
    activatedAt: 1,
    tenant: {
      id: 'tenant_demo',
      name: 'Demo Fund',
      maxDevices: 5,
      codexSubscriptionEnabled: true,
      codexSubscriptionPlan: 'monthly',
    },
    user: {
      id: 'user_demo',
      email: 'user@demo.local',
      name: 'Demo User',
    },
    device: {
      id: 'dev_demo',
      leaseExpiresAt: '2026-07-01T00:00:00.000Z',
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
    codexAccounts: [
      {
        id: 'codex_demo',
        email: 'codex-demo@alpha.local',
        loginHint: 'Use browser login handoff',
        plan: 'team',
        seatLimit: 3,
        expiresAt: '2026-08-01T00:00:00.000Z',
      },
    ],
  });
}

function jsonResponse(body: unknown) {
  return {
    ok: true,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;
}

describe('right feature panel', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    cleanup();
  });

  beforeEach(() => {
    window.localStorage.clear();
    seedClientLicenseSession();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse({
      leaseExpiresAt: '2026-07-01T00:05:00.000Z',
    }))));
    useChatStore.setState({
      conversations: [conversation()],
      projects: [],
      currentConversationId: 'conv-right-panel',
      selectedModelProfileId: DEFAULT_MODEL_PROFILE_ID,
      modelProfiles: defaultModelProfiles(),
      workModeId: 'finance-research',
      codexStatus: { installed: true, loggedIn: true, path: '/usr/bin/codex', version: 'test' },
      isCheckingCodex: false,
      error: null,
      projectSort: 'updated',
      conversationSort: 'updated',
    });
  });

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

  it('removes coding tools from the right-top toolbar in the finance workspace', () => {
    const { container } = render(<App />);

    expect(screen.queryByLabelText('环境信息')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('用其他软件打开')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('打开下方终端')).not.toBeInTheDocument();
    expect(screen.getByLabelText('打开侧边栏')).toBeInTheDocument();
    expect(container.querySelector('.open-app-trigger-icon')).not.toBeInTheDocument();
    expect(document.querySelector('.app-shell')).toHaveAttribute('data-work-mode', 'finance-research');
  });

  it('opens the finance right sidebar without coding actions', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    const rightPanelToggle = screen.getByLabelText('打开侧边栏');

    expect(rightPanelToggle).toHaveAttribute('aria-pressed', 'false');
    expect(rightPanelToggle.querySelector('svg')).toHaveClass('lucide-panel-right');

    await user.click(rightPanelToggle);

    const featuresPanel = container.querySelector('.features-panel') as HTMLElement;
    expect(featuresPanel).toBeInTheDocument();
    expect(featuresPanel).toHaveAccessibleName('投研侧栏');
    expect(within(featuresPanel).getByRole('button', { name: /浏览器/ })).toBeInTheDocument();
    expect(within(featuresPanel).getByRole('button', { name: /侧边聊天/ })).toBeInTheDocument();
    expect(within(featuresPanel).queryByRole('button', { name: /审查/ })).not.toBeInTheDocument();
    expect(within(featuresPanel).queryByRole('button', { name: /^终端$/ })).not.toBeInTheDocument();
    expect(within(featuresPanel).queryByRole('button', { name: /文件/ })).not.toBeInTheDocument();
    expect(screen.getAllByLabelText('关闭侧边栏')[0]).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByLabelText('关闭侧边栏')[0].querySelector('svg')).toHaveClass('lucide-panel-right-close');
  });

  it('keeps coding tabs out of the right sidebar add menu', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByLabelText('打开侧边栏'));
    const launcher = container.querySelector('.features-panel') as HTMLElement;
    await user.click(within(launcher).getByRole('button', { name: /浏览器/ }));
    const dock = container.querySelector('.right-dock-workspace') as HTMLElement;
    await user.click(within(dock).getByLabelText('添加侧边栏标签'));
    const tabMenu = container.querySelector('.right-dock-tab-menu') as HTMLElement;

    expect(within(tabMenu).getByRole('button', { name: /浏览器/ })).toBeInTheDocument();
    expect(within(tabMenu).getByRole('button', { name: /侧边聊天/ })).toBeInTheDocument();
    expect(within(tabMenu).queryByRole('button', { name: /审查/ })).not.toBeInTheDocument();
    expect(within(tabMenu).queryByRole('button', { name: /^终端$/ })).not.toBeInTheDocument();
    expect(within(tabMenu).queryByRole('button', { name: /文件/ })).not.toBeInTheDocument();
  });

  it('opens the skills page from the sidebar capability menu', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByRole('button', { name: '能力' }));

    const skillsPage = container.querySelector('.skills-page') as HTMLElement;
    expect(skillsPage).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '设置' })).not.toBeInTheDocument();
    expect(within(skillsPage).getByRole('heading', { name: '技能' })).toBeInTheDocument();
    expect(within(skillsPage).getByPlaceholderText('搜索能力和技能')).toBeInTheDocument();
    expect(within(skillsPage).getByText('个人')).toBeInTheDocument();
    expect(within(skillsPage).getByText('系统')).toBeInTheDocument();
    expect(within(skillsPage).getByText('Browser')).toBeInTheDocument();
    expect(within(skillsPage).getByText('Skill Installer')).toBeInTheDocument();
  });

  it('filters the skills catalog by category from the capability filter menu', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByRole('button', { name: '能力' }));
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

    await user.click(screen.getByRole('button', { name: '能力' }));
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

  it('installs a recommended skill and makes it available in the composer capability menu', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByRole('button', { name: '能力' }));
    const skillsPage = container.querySelector('.skills-page') as HTMLElement;
    await user.click(within(skillsPage).getByLabelText('筛选技能'));
    await user.click(screen.getByRole('menuitemradio', { name: '推荐' }));
    await user.click(within(skillsPage).getByRole('button', { name: '添加 Playwright' }));

    await user.click(within(container.querySelector('.nav-menu') as HTMLElement).getByRole('button', { name: '新对话' }));
    await user.click(screen.getByLabelText('添加内容'));
    const plusMenu = document.querySelector('.plus-menu') as HTMLElement;
    fireEvent.click(within(plusMenu).getByRole('button', { name: /能力/ }));

    expect(screen.getByRole('menuitem', { name: 'Playwright' })).toBeInTheDocument();
  });

  it('returns from the skills page to chat when starting a new conversation', async () => {
    const user = userEvent.setup();
    useChatStore.setState({
      conversations: [conversation({ messages: [] })],
      currentConversationId: 'conv-right-panel',
    });
    const { container } = render(<App />);

    await user.click(screen.getByRole('button', { name: '能力' }));
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

  it('does not show the static usage card in the sidebar footer', () => {
    const { container } = render(<App />);
    const sidebar = container.querySelector('.sidebar') as HTMLElement;

    expect(sidebar.querySelector('.usage-card')).not.toBeInTheDocument();
    expect(within(sidebar).queryByText('剩余 12% 使用量')).not.toBeInTheDocument();
    expect(within(sidebar).queryByRole('button', { name: '添加额度' })).not.toBeInTheDocument();
    expect(within(sidebar).getByRole('button', { name: '设置' })).toBeInTheDocument();
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
    const modelRow = within(modelMenu).getByText('GPT-5.5').closest('.model-flyout-row') as HTMLElement;
    fireEvent.mouseEnter(modelRow);

    expect(await screen.findByText('订阅模型')).toBeInTheDocument();
    expect(screen.getByText('按量模型')).toBeInTheDocument();
    expect(screen.queryByText('内置模型')).not.toBeInTheDocument();
    expect(screen.queryByText('自定义模型')).not.toBeInTheDocument();
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

  it('keeps the work mode selector out of general settings', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(within(container.querySelector('.sidebar') as HTMLElement).getByRole('button', { name: '设置' }));

    const settings = screen.getByRole('dialog', { name: '设置' });
    expect(within(settings).getByRole('heading', { name: '常规' })).toBeInTheDocument();
    expect(within(settings).getByText('默认权限')).toBeInTheDocument();
    expect(within(settings).queryByRole('heading', { name: '投研协作' })).not.toBeInTheDocument();
    expect(within(settings).queryByRole('radiogroup', { name: '工作模式' })).not.toBeInTheDocument();
    expect(settings.querySelector('.work-mode-panel')).not.toBeInTheDocument();
  });

  it('keeps client license details out of chat and allows logout from profile settings', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    expect(container.querySelector('.client-license-banner')).not.toBeInTheDocument();
    expect(screen.queryByText(/Codex 订阅账号/)).not.toBeInTheDocument();

    await user.click(within(container.querySelector('.sidebar') as HTMLElement).getByRole('button', { name: '设置' }));
    const settings = screen.getByRole('dialog', { name: '设置' });
    await user.click(within(settings).getByRole('button', { name: '个人资料' }));

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
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(within(container.querySelector('.sidebar') as HTMLElement).getByRole('button', { name: '设置' }));
    const settings = screen.getByRole('dialog', { name: '设置' });
    await user.click(within(settings).getByRole('button', { name: '个人资料' }));

    const loginButton = within(settings).getByRole('button', { name: '授权 Codex CLI' });
    expect(invoke).not.toHaveBeenCalledWith('codex_login');

    await user.click(loginButton);

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('codex_login'));
  });

  it('selects a skill from the composer plugin flyout and sends it with the message', async () => {
    const user = userEvent.setup();
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    useChatStore.setState({ sendMessage });
    render(<App />);

    await user.click(screen.getByLabelText('添加内容'));
    const plusMenu = document.querySelector('.plus-menu') as HTMLElement;
    fireEvent.click(within(plusMenu).getByRole('button', { name: /能力/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Chrome' }));

    const composer = document.querySelector('.composer-card') as HTMLElement;
    expect(within(composer).getByText('Chrome')).toBeInTheDocument();

    await user.type(within(composer).getByRole('textbox'), '检查页面控制台');
    await user.click(within(composer).getByLabelText('发送'));

    expect(sendMessage).toHaveBeenCalledWith(
      '检查页面控制台',
      [],
      expect.objectContaining({ id: 'chrome', title: 'Chrome' }),
    );
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

  it('renders generated files as Codex-style result cards', () => {
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
    const card = within(container.querySelector('.message-list') as HTMLElement).getByRole('group', { name: 'cat-illustration.png' });

    expect(within(card).getByText('cat-illustration.png')).toBeInTheDocument();
    expect(within(card).getByText('图像 · PNG')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: '打开方式' })).toBeInTheDocument();
  });

  it('does not mount a bottom terminal in the finance workspace', () => {
    const { container } = render(<App />);

    expect(screen.queryByLabelText('打开下方终端')).not.toBeInTheDocument();
    expect(container.querySelector('.workspace > .terminal-panel')).not.toBeInTheDocument();
  });

  it('opens side chat as its own Codex-style right dock tab', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByLabelText('打开侧边栏'));
    const launcher = container.querySelector('.features-panel') as HTMLElement;
    expect(launcher).toBeInTheDocument();

    await user.click(within(launcher).getByRole('button', { name: /侧边聊天/ }));

    const sideChat = container.querySelector('.side-chat-panel') as HTMLElement;
    expect(sideChat).toBeInTheDocument();
    expect(container.querySelector('.features-panel')).not.toBeInTheDocument();
    expect(within(container.querySelector('.right-dock-workspace') as HTMLElement).getByRole('tab', { name: '侧边聊天' })).toHaveAttribute('aria-selected', 'true');
    expect(within(sideChat).getByPlaceholderText('询问市场、行业、公司或组合问题')).toBeInTheDocument();
  });

  it('shows browser as a tabbed finance workspace with a pruned add-tab menu', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByLabelText('打开侧边栏'));
    const launcher = container.querySelector('.features-panel') as HTMLElement;
    expect(launcher).toBeInTheDocument();

    await user.click(within(launcher).getByRole('button', { name: /浏览器/ }));

    const browser = container.querySelector('.browser-dock-panel') as HTMLElement;
    const dock = container.querySelector('.right-dock-workspace') as HTMLElement;
    expect(browser).toBeInTheDocument();
    expect(within(dock).getByRole('tab', { name: '浏览器' })).toHaveAttribute('aria-selected', 'true');

    await user.click(within(dock).getByLabelText('添加侧边栏标签'));
    const tabMenu = container.querySelector('.right-dock-tab-menu') as HTMLElement;
    expect(tabMenu).toBeInTheDocument();
    expect(within(tabMenu).getByRole('button', { name: /浏览器/ })).toBeInTheDocument();
    expect(within(tabMenu).getByRole('button', { name: /侧边聊天/ })).toBeInTheDocument();
    expect(within(tabMenu).queryByRole('button', { name: /审查/ })).not.toBeInTheDocument();
    expect(within(tabMenu).queryByRole('button', { name: /^终端$/ })).not.toBeInTheDocument();
    expect(within(tabMenu).queryByRole('button', { name: /文件/ })).not.toBeInTheDocument();
  });

  it('collapses and reopens the right sidebar without unmounting dock tabs', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByLabelText('打开侧边栏'));
    const launcher = container.querySelector('.features-panel') as HTMLElement;
    await user.click(within(launcher).getByRole('button', { name: /侧边聊天/ }));

    const dock = container.querySelector('.right-dock-workspace') as HTMLElement;
    const sideChat = container.querySelector('.side-chat-panel') as HTMLElement;
    expect(sideChat).toBeInTheDocument();
    expect(within(dock).getByRole('tab', { name: '侧边聊天' })).toHaveAttribute('aria-selected', 'true');

    await user.click(screen.getByLabelText('关闭侧边栏'));
    expect(dock).toHaveClass('collapsed');
    expect(container.querySelector('.side-chat-panel')).toBe(sideChat);

    await user.click(screen.getByLabelText('打开侧边栏'));
    expect(dock).not.toHaveClass('collapsed');
    expect(container.querySelector('.side-chat-panel')).toBe(sideChat);
    expect(within(dock).getByRole('tab', { name: '侧边聊天' })).toHaveAttribute('aria-selected', 'true');
  });

  it('closes right dock tabs from the hover-only tab close button', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByLabelText('打开侧边栏'));
    const launcher = container.querySelector('.features-panel') as HTMLElement;
    await user.click(within(launcher).getByRole('button', { name: /侧边聊天/ }));

    const dock = container.querySelector('.right-dock-workspace') as HTMLElement;
    expect(within(dock).getByRole('tab', { name: '侧边聊天' })).toBeInTheDocument();

    await user.click(within(dock).getByLabelText('关闭侧边聊天标签'));

    expect(container.querySelector('.side-chat-panel')).not.toBeInTheDocument();
    expect(container.querySelector('.features-panel')).toBeInTheDocument();
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

  it('moves environment actions to the left edge of an open right dock', () => {
    const cssPath = `${process.cwd()}/src/styles.css`;
    const css = readFileSync(cssPath, 'utf8');

    expect(css).toMatch(/\.top-bar-actions\s*{[^}]*position:\s*fixed;[^}]*top:\s*8px;[^}]*right:\s*12px;[^}]*z-index:\s*90;/s);
    expect(css).toMatch(/\.top-bar-env-actions,\s*\.top-bar-panel-actions\s*{[^}]*display:\s*inline-flex;[^}]*gap:\s*4px;/s);
    expect(css).toMatch(/\.app-shell\.right-panel-open\s+\.top-bar-env-actions\s*{[^}]*position:\s*fixed;[^}]*top:\s*8px;[^}]*right:\s*calc\(var\(--right-sidebar-width, 416px\) \+ 16px\);/s);
    expect(css).toMatch(/\.app-shell\.git-panel-open\s+\.top-bar-env-actions\s*{[^}]*right:\s*calc\(var\(--git-panel-width, 430px\) \+ 16px\);/s);
    expect(css).toMatch(/\.app-shell\.review-panel-open\s+\.top-bar-env-actions\s*{[^}]*right:\s*calc\(var\(--review-panel-width, 704px\) \+ 16px\);/s);
    expect(css).not.toMatch(/\.app-shell\.review-panel-open\s+\.top-bar-actions\s*{/);
    expect(css).not.toMatch(/\.app-shell\.git-panel-open\s+\.top-bar-actions\s*{/);
    expect(css).toMatch(/\.right-dock-tabs\s*{[^}]*padding:\s*0 76px 0 8px;/s);
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
    expect(css).toMatch(/\.right-dock-tab\.active\s*{[^}]*background:\s*var\(--bg-soft\);[^}]*font-weight:\s*600;/s);
    expect(css).toMatch(/\.right-dock-workspace\.collapsed\s*{[^}]*display:\s*none;/s);
    expect(css).toMatch(/\.review-status-menu\s*{[^}]*min-width:\s*212px;[^}]*border-radius:\s*13px;/s);
    expect(css).toMatch(/\.review-file-list-toggle\.active\s*{[^}]*background:\s*var\(--bg-soft\);/s);
    expect(css).toMatch(/\.review-tree-head input\s*{[^}]*border:\s*1px solid var\(--border\);[^}]*border-radius:\s*10px;/s);
    expect(css).toMatch(/\.review-scroll\s*{[^}]*padding-bottom:\s*76px;/s);
    expect(css).toMatch(/\.review-floating\s*{[^}]*bottom:\s*42px;[^}]*z-index:\s*24;/s);
  });
});
