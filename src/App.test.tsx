import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { DEFAULT_MODEL_PROFILE_ID, defaultModelProfiles } from './models';
import { useChatStore } from './store';
import type { Conversation } from './types';

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

describe('right feature panel', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    useChatStore.setState({
      conversations: [conversation()],
      projects: [],
      currentConversationId: 'conv-right-panel',
      selectedModelProfileId: DEFAULT_MODEL_PROFILE_ID,
      modelProfiles: defaultModelProfiles(),
      workModeId: 'core-coding',
      codexStatus: { installed: true, loggedIn: true, path: '/usr/bin/codex', version: 'test' },
      isCheckingCodex: false,
      error: null,
      projectSort: 'updated',
      conversationSort: 'updated',
    });
  });

  it('opens the Codex-style environment card from the right-top toolbar', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByLabelText('环境信息'));

    const menu = container.querySelector('.environment-menu');
    expect(menu).toBeInTheDocument();
    expect(menu).toHaveAttribute('data-codex-panel', 'environment');
    expect(within(menu as HTMLElement).getByText('环境信息')).toBeInTheDocument();
    expect(within(menu as HTMLElement).getByText('alpha-studio 不是 Git 仓库。')).toBeInTheDocument();
    expect(within(menu as HTMLElement).getByText('来源')).toBeInTheDocument();
    expect(within(menu as HTMLElement).getByText('暂无来源')).toBeInTheDocument();

    expect(container.querySelector('.features-panel')).not.toBeInTheDocument();
    expect(container.querySelector('.open-app-trigger-icon')).toBeInTheDocument();
    expect(document.querySelector('.app-shell')).toHaveAttribute('data-work-mode', 'core-coding');
  });

  it('switches from the environment card to the right sidebar in one toolbar click', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    const rightPanelToggle = screen.getByLabelText('打开侧边栏');

    expect(rightPanelToggle).toHaveAttribute('aria-pressed', 'false');
    expect(rightPanelToggle.querySelector('svg')).toHaveClass('lucide-panel-right');

    await user.click(screen.getByLabelText('环境信息'));
    expect(container.querySelector('.environment-menu')).toBeInTheDocument();

    await user.click(rightPanelToggle);

    expect(container.querySelector('.environment-menu')).not.toBeInTheDocument();
    expect(container.querySelector('.features-panel')).toBeInTheDocument();
    expect(screen.getAllByLabelText('关闭侧边栏')[0]).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByLabelText('关闭侧边栏')[0].querySelector('svg')).toHaveClass('lucide-panel-right-close');
  });

  it('opens the top-right terminal button as the bottom terminal panel', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    const terminalToggle = screen.getByLabelText('打开下方终端');

    expect(terminalToggle).toHaveAttribute('aria-pressed', 'false');
    expect(terminalToggle.querySelector('svg')).toHaveClass('lucide-panel-bottom');

    await user.click(terminalToggle);

    const bottomTerminal = container.querySelector('.workspace > .terminal-panel');
    expect(bottomTerminal).toBeInTheDocument();
    expect(bottomTerminal).not.toHaveClass('terminal-dock-panel');
    expect(container.querySelector('.terminal-dock-panel')).not.toBeInTheDocument();
    expect(screen.getByLabelText('收起下方终端')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('收起下方终端').querySelector('svg')).toHaveClass('lucide-panel-bottom-close');
  });

  it('keeps bottom terminal tabs mounted and numbered sequentially while collapsed', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByLabelText('打开下方终端'));
    const bottomTerminal = container.querySelector('.workspace > .terminal-panel') as HTMLElement;
    expect(bottomTerminal).toBeInTheDocument();

    const addTab = within(bottomTerminal).getByTitle('新建终端');
    await user.click(addTab);
    await user.click(addTab);
    expect(within(bottomTerminal).getAllByText(/alpha-studio \d/).map((node) => node.textContent)).toEqual([
      'alpha-studio 1',
      'alpha-studio 2',
      'alpha-studio 3',
    ]);

    await user.click(within(bottomTerminal).getAllByLabelText('关闭终端')[1]);
    expect(within(bottomTerminal).getAllByText(/alpha-studio \d/).map((node) => node.textContent)).toEqual([
      'alpha-studio 1',
      'alpha-studio 2',
    ]);

    await user.click(addTab);
    expect(within(bottomTerminal).getAllByText(/alpha-studio \d/).map((node) => node.textContent)).toEqual([
      'alpha-studio 1',
      'alpha-studio 2',
      'alpha-studio 3',
    ]);

    await user.click(within(bottomTerminal).getByLabelText('收起终端面板'));
    expect(bottomTerminal).toHaveClass('collapsed');
    expect(container.querySelector('.workspace > .terminal-panel')).toBe(bottomTerminal);

    await user.click(screen.getByLabelText('打开下方终端'));
    expect(bottomTerminal).not.toHaveClass('collapsed');
    expect(within(bottomTerminal).getAllByText(/alpha-studio \d/).map((node) => node.textContent)).toEqual([
      'alpha-studio 1',
      'alpha-studio 2',
      'alpha-studio 3',
    ]);
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
    expect(within(sideChat).getByPlaceholderText('要求 Codex 执行任务')).toBeInTheDocument();
  });

  it('shows review as a Codex-style tabbed workspace with an add-tab menu', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByLabelText('打开侧边栏'));
    const launcher = container.querySelector('.features-panel') as HTMLElement;
    expect(launcher).toBeInTheDocument();

    await user.click(within(launcher).getByRole('button', { name: /审查/ }));

    const review = container.querySelector('.review-panel') as HTMLElement;
    const dock = container.querySelector('.right-dock-workspace') as HTMLElement;
    expect(review).toBeInTheDocument();
    expect(within(dock).getByRole('tab', { name: '审查' })).toHaveAttribute('aria-selected', 'true');

    await user.click(within(dock).getByLabelText('添加侧边栏标签'));
    const tabMenu = container.querySelector('.right-dock-tab-menu') as HTMLElement;
    expect(tabMenu).toBeInTheDocument();
    expect(within(tabMenu).getByRole('button', { name: /浏览器/ })).toBeInTheDocument();
    expect(within(tabMenu).getByRole('button', { name: /^终端$/ })).toBeInTheDocument();
    expect(within(tabMenu).getByRole('button', { name: /文件/ })).toBeInTheDocument();
    expect(within(tabMenu).getByRole('button', { name: /侧边聊天/ })).toBeInTheDocument();

    await user.click(within(tabMenu).getByRole('button', { name: /浏览器/ }));
    expect(container.querySelector('.browser-dock-panel')).toBeInTheDocument();
    expect(container.querySelector('.review-panel')).toBeInTheDocument();
    expect(within(dock).getByRole('tab', { name: '浏览器' })).toHaveAttribute('aria-selected', 'true');

    await user.click(within(dock).getByLabelText('添加侧边栏标签'));
    const nextTabMenu = container.querySelector('.right-dock-tab-menu') as HTMLElement;
    await user.click(within(nextTabMenu).getByRole('button', { name: /^终端$/ }));
    expect(container.querySelector('.terminal-dock-panel')).toBeInTheDocument();
    expect(container.querySelector('.review-panel')).toBeInTheDocument();
    expect(within(dock).getByRole('tab', { name: '终端' })).toHaveAttribute('aria-selected', 'true');
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
