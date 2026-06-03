import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type {
  ChangeEvent,
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  AlertCircle,
  ArrowDownAZ,
  ArrowDownUp,
  ArrowUp,
  Bot,
  Briefcase,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Copy,
  Cpu,
  Expand,
  FileText,
  Folder,
  FolderInput,
  FolderOpen,
  FolderPlus,
  History,
  Info,
  Loader2,
  Mail,
  MessageCircle,
  MessageSquare,
  Mic,
  Moon,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Shrink,
  SlidersHorizontal,
  Smartphone,
  Square,
  SquarePen,
  Star,
  Sun,
  Terminal,
  Trash2,
  Users,
  Workflow,
  X,
  Zap,
} from 'lucide-react';
import { isTauriRuntime, revealPath, subscribeCodexEvents } from './codexBridge';
import { coworkers } from './coworkers';
import {
  EFFORT_OPTIONS,
  MODEL_OPTIONS,
  SPEED_OPTIONS,
  effortLabel,
  modelLabel,
  shortModelLabel,
  type ReasoningEffort,
  type Speed,
} from './models';
import { useChatStore, useCurrentConversation } from './store';
import type { ChatMessage, Conversation, Holding, MessageBlock, Project, ProjectSort, SandboxMode, WatchItem } from './types';

type RightPanel = 'none' | 'coworker' | 'portfolio';

export function App() {
  const refreshCodexStatus = useChatStore((state) => state.refreshCodexStatus);
  const handleCodexEvent = useChatStore((state) => state.handleCodexEvent);
  const conversations = useChatStore((state) => state.conversations);
  const currentConversationId = useChatStore((state) => state.currentConversationId);
  const setCurrentConversation = useChatStore((state) => state.setCurrentConversation);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window === 'undefined') return SIDEBAR_DEFAULT_WIDTH;
    const saved = Number(window.localStorage.getItem(SIDEBAR_WIDTH_KEY));
    return Number.isFinite(saved) && saved >= SIDEBAR_MIN_WIDTH && saved <= SIDEBAR_MAX_WIDTH
      ? saved
      : SIDEBAR_DEFAULT_WIDTH;
  });
  const [rightPanel, setRightPanel] = useState<RightPanel>('none');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    if (typeof window === 'undefined') return 'dark';
    const saved = window.localStorage.getItem(THEME_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  const [windowFocused, setWindowFocused] = useState(true);

  const toggleRightPanel = (panel: Exclude<RightPanel, 'none'>) =>
    setRightPanel((current) => (current === panel ? 'none' : panel));
  const toggleTheme = () => setTheme((value) => (value === 'dark' ? 'light' : 'dark'));

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(THEME_KEY, theme);
    if (isTauriRuntime()) {
      void import('@tauri-apps/api/window')
        .then(({ getCurrentWindow }) => getCurrentWindow().setTheme(theme))
        .catch(() => {
          /* set-theme may be unavailable in some webviews */
        });
    }
  }, [theme]);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | null = null;

    if (isTauriRuntime()) {
      void import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
        if (disposed) return;
        void getCurrentWindow()
          .onFocusChanged(({ payload: focused }) => setWindowFocused(focused))
          .then((unlisten) => {
            if (disposed) unlisten();
            else cleanup = unlisten;
          });
      });
    } else {
      const onFocus = () => setWindowFocused(true);
      const onBlur = () => setWindowFocused(false);
      setWindowFocused(document.hasFocus());
      window.addEventListener('focus', onFocus);
      window.addEventListener('blur', onBlur);
      cleanup = () => {
        window.removeEventListener('focus', onFocus);
        window.removeEventListener('blur', onBlur);
      };
    }

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  useEffect(() => {
    if (!currentConversationId && conversations[0]) {
      setCurrentConversation(conversations[0].id);
    }
  }, [conversations, currentConversationId, setCurrentConversation]);

  useEffect(() => {
    void refreshCodexStatus();
  }, [refreshCodexStatus]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void subscribeCodexEvents(handleCodexEvent).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [handleCodexEvent]);

  return (
    <div
      className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''} ${windowFocused ? '' : 'window-inactive'}`}
      style={{ ['--sidebar-width']: `${sidebarWidth}px` } as CSSProperties}
    >
      <Sidebar
        collapsed={sidebarCollapsed}
        onCollapse={() => setSidebarCollapsed(true)}
        portfolioOpen={rightPanel === 'portfolio'}
        onOpenPortfolio={() => toggleRightPanel('portfolio')}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      {!sidebarCollapsed && (
        <SidebarResizer
          min={SIDEBAR_MIN_WIDTH}
          max={SIDEBAR_MAX_WIDTH}
          defaultWidth={SIDEBAR_DEFAULT_WIDTH}
          onCommit={setSidebarWidth}
        />
      )}
      <main className="main-stage">
        <TopBar
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={() => setSidebarCollapsed((value) => !value)}
          coworkerOpen={rightPanel === 'coworker'}
          onToggleCoworker={() => toggleRightPanel('coworker')}
          portfolioOpen={rightPanel === 'portfolio'}
          onTogglePortfolio={() => toggleRightPanel('portfolio')}
        />
        <ChatArea />
      </main>
      {rightPanel === 'coworker' && <FinanceCoworkerPanel onClose={() => setRightPanel('none')} />}
      {rightPanel === 'portfolio' && <PortfolioPanel onClose={() => setRightPanel('none')} />}
      <SettingsPage
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
    </div>
  );
}

const SIDEBAR_WIDTH_KEY = 'alpha:codex-sidebar-width';
const THEME_KEY = 'alpha:codex-theme';
const SIDEBAR_MIN_WIDTH = 244;
const SIDEBAR_MAX_WIDTH = 420;
const SIDEBAR_DEFAULT_WIDTH = 294;

function SidebarResizer({
  min,
  max,
  defaultWidth,
  onCommit,
}: {
  min: number;
  max: number;
  defaultWidth: number;
  onCommit: (width: number) => void;
}) {
  const [active, setActive] = useState(false);
  const drag = useRef<{ x: number; w: number; shell: HTMLElement | null }>({ x: 0, w: 0, shell: null });

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const handle = event.currentTarget;
    const shell = handle.closest('.app-shell') as HTMLElement | null;
    if (!shell) return;
    const sidebar = shell.querySelector('.sidebar') as HTMLElement | null;
    drag.current = {
      x: event.clientX,
      w: sidebar ? sidebar.getBoundingClientRect().width : defaultWidth,
      shell,
    };
    setActive(true);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      /* pointer capture unsupported */
    }
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const { shell, w, x } = drag.current;
    if (!shell) return;
    const next = Math.min(max, Math.max(min, w + (event.clientX - x)));
    shell.style.setProperty('--sidebar-width', `${next}px`);
  };

  const finishDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const shell = drag.current.shell;
    if (!shell) return;
    drag.current.shell = null;
    setActive(false);
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    const resolved = parseFloat(getComputedStyle(shell).getPropertyValue('--sidebar-width'));
    onCommit(Math.round(Number.isFinite(resolved) ? resolved : defaultWidth));
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* pointer already released */
    }
  };

  return (
    <div
      className={`sidebar-resizer ${active ? 'active' : ''}`}
      role="separator"
      aria-orientation="vertical"
      aria-label="拖动调整侧栏宽度"
      title="拖动调整宽度 · 双击复位"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onDoubleClick={() => onCommit(defaultWidth)}
    />
  );
}

/* ------------------------------------------------------------------ sidebar */

function Sidebar({
  collapsed,
  onCollapse,
  portfolioOpen,
  onOpenPortfolio,
  onOpenSettings,
}: {
  collapsed: boolean;
  onCollapse: () => void;
  portfolioOpen: boolean;
  onOpenPortfolio: () => void;
  onOpenSettings: () => void;
}) {
  const conversations = useChatStore((state) => state.conversations);
  const projects = useChatStore((state) => state.projects);
  const currentConversationId = useChatStore((state) => state.currentConversationId);
  const createConversation = useChatStore((state) => state.createConversation);
  const setCurrentConversation = useChatStore((state) => state.setCurrentConversation);
  const deleteConversation = useChatStore((state) => state.deleteConversation);
  const renameConversation = useChatStore((state) => state.renameConversation);
  const toggleConversationPin = useChatStore((state) => state.toggleConversationPin);
  const createProject = useChatStore((state) => state.createProject);
  const renameProject = useChatStore((state) => state.renameProject);
  const setProjectCwd = useChatStore((state) => state.setProjectCwd);
  const toggleProjectPin = useChatStore((state) => state.toggleProjectPin);
  const deleteProject = useChatStore((state) => state.deleteProject);
  const projectSort = useChatStore((state) => state.projectSort);
  const setProjectSort = useChatStore((state) => state.setProjectSort);
  const conversationSort = useChatStore((state) => state.conversationSort);
  const setConversationSort = useChatStore((state) => state.setConversationSort);

  const pinnedConversations = useMemo(
    () => sortConversations(conversations.filter((conversation) => conversation.pinned), conversationSort),
    [conversations, conversationSort],
  );
  const standalone = useMemo(
    () => conversations.filter((conversation) => !conversation.projectId && !conversation.pinned),
    [conversations],
  );
  const conversationGroups = useMemo(
    () => groupStandaloneConversations(standalone, conversationSort),
    [standalone, conversationSort],
  );
  const sortedProjects = useMemo(() => sortProjects(projects, projectSort), [projects, projectSort]);

  const [menu, setMenu] = useState<SidebarMenu | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [automationOpen, setAutomationOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingConversationId, setEditingConversationId] = useState<string | null>(null);
  const [conversationsCollapsed, setConversationsCollapsed] = useState(false);

  const closeMenu = () => setMenu(null);
  const anyExpanded = projects.some((project) => expanded[project.id]);
  const collapseAll = () => setExpanded({});
  const expandAll = () =>
    setExpanded(Object.fromEntries(projects.map((project) => [project.id, true])));

  useEffect(() => {
    const handleKeyDown = (event: WindowEventMap['keydown']) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const toggleProject = (id: string) =>
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  const handleNewBlankProject = () => {
    closeMenu();
    const id = createProject();
    setExpanded((prev) => ({ ...prev, [id]: true }));
    setEditingProjectId(id);
  };

  const handleUseExistingFolder = async () => {
    closeMenu();
    const dir = await pickFolder();
    if (!dir) return;
    const id = createProject({ name: basename(dir), cwd: dir });
    setExpanded((prev) => ({ ...prev, [id]: true }));
    createConversation(id);
  };

  const chooseProjectFolder = async (project: Project) => {
    const dir = await pickFolder();
    if (dir) setProjectCwd(project.id, dir);
  };

  const openProjectInFinder = async (project: Project) => {
    if (project.cwd && (await revealPath(project.cwd))) return;
    await chooseProjectFolder(project);
  };

  const openNewProjectMenu = (event: ReactMouseEvent) => {
    setMenu({
      owner: 'add',
      ...anchorFromButton(event),
      items: [
        { kind: 'item', icon: <FolderPlus size={15} />, label: '新建空白项目', onSelect: handleNewBlankProject },
        { kind: 'item', icon: <FolderOpen size={15} />, label: '使用现有文件夹', onSelect: () => void handleUseExistingFolder() },
      ],
    });
  };

  const openSectionMenu = (event: ReactMouseEvent) => {
    setMenu({
      owner: 'section',
      ...anchorFromButton(event),
      items: [
        { kind: 'item', icon: <Shrink size={15} />, label: '全部收起', onSelect: collapseAll },
        { kind: 'item', icon: <Expand size={15} />, label: '全部展开', onSelect: expandAll },
        { kind: 'separator' },
        {
          kind: 'submenu',
          icon: <ArrowDownUp size={15} />,
          label: '排序条件',
          children: [
            { kind: 'radio', icon: <Clock3 size={15} />, label: '更新时间', checked: projectSort === 'updated', onSelect: () => setProjectSort('updated') },
            { kind: 'radio', icon: <CalendarDays size={15} />, label: '创建时间', checked: projectSort === 'created', onSelect: () => setProjectSort('created') },
            { kind: 'radio', icon: <ArrowDownAZ size={15} />, label: '名称', checked: projectSort === 'name', onSelect: () => setProjectSort('name') },
          ],
        },
      ],
    });
  };

  const openConversationSectionMenu = (event: ReactMouseEvent) => {
    setMenu({
      owner: 'conv-section',
      ...anchorFromButton(event),
      items: [
        {
          kind: 'item',
          icon: conversationsCollapsed ? <Expand size={15} /> : <Shrink size={15} />,
          label: conversationsCollapsed ? '展开列表' : '收起列表',
          onSelect: () => setConversationsCollapsed((value) => !value),
        },
        { kind: 'separator' },
        {
          kind: 'submenu',
          icon: <ArrowDownUp size={15} />,
          label: '排序条件',
          children: [
            { kind: 'radio', icon: <Clock3 size={15} />, label: '更新时间', checked: conversationSort === 'updated', onSelect: () => setConversationSort('updated') },
            { kind: 'radio', icon: <CalendarDays size={15} />, label: '创建时间', checked: conversationSort === 'created', onSelect: () => setConversationSort('created') },
            { kind: 'radio', icon: <ArrowDownAZ size={15} />, label: '名称', checked: conversationSort === 'name', onSelect: () => setConversationSort('name') },
          ],
        },
      ],
    });
  };

  const openConversationMenu = (conversation: Conversation, anchor: MenuAnchor) => {
    setMenu({
      owner: conversation.id,
      ...anchor,
      items: [
        {
          kind: 'item',
          icon: conversation.pinned ? <PinOff size={15} /> : <Pin size={15} />,
          label: conversation.pinned ? '取消置顶' : '置顶对话',
          onSelect: () => toggleConversationPin(conversation.id),
        },
        {
          kind: 'item',
          icon: <FolderOpen size={15} />,
          label: '在访达中打开',
          disabled: !conversation.cwd,
          onSelect: () => void revealPath(conversation.cwd),
        },
        { kind: 'item', icon: <Pencil size={15} />, label: '重命名', onSelect: () => setEditingConversationId(conversation.id) },
        { kind: 'separator' },
        { kind: 'item', icon: <Trash2 size={15} />, label: '删除对话', danger: true, onSelect: () => deleteConversation(conversation.id) },
      ],
    });
  };

  const commitConversationRename = (id: string, name: string) => {
    renameConversation(id, name);
    setEditingConversationId(null);
  };
  const cancelConversationRename = () => setEditingConversationId(null);

  const openProjectMenu = (project: Project, anchor: MenuAnchor) => {
    setMenu({
      owner: project.id,
      ...anchor,
      items: [
        {
          kind: 'item',
          icon: project.pinned ? <PinOff size={15} /> : <Pin size={15} />,
          label: project.pinned ? '取消置顶' : '置顶项目',
          onSelect: () => toggleProjectPin(project.id),
        },
        { kind: 'item', icon: <FolderOpen size={15} />, label: '在访达中打开', onSelect: () => void openProjectInFinder(project) },
        { kind: 'item', icon: <FolderInput size={15} />, label: '设置工作目录', onSelect: () => void chooseProjectFolder(project) },
        { kind: 'item', icon: <Pencil size={15} />, label: '重命名项目', onSelect: () => setEditingProjectId(project.id) },
        {
          kind: 'item',
          icon: <SquarePen size={15} />,
          label: '新建对话',
          onSelect: () => {
            setExpanded((prev) => ({ ...prev, [project.id]: true }));
            createConversation(project.id);
          },
        },
        { kind: 'separator' },
        { kind: 'item', icon: <Trash2 size={15} />, label: '移除项目', danger: true, onSelect: () => deleteProject(project.id) },
      ],
    });
  };

  const openProjectFromSearch = (projectId: string) => {
    const latest = conversations
      .filter((conversation) => conversation.projectId === projectId)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (latest) {
      setCurrentConversation(latest.id);
    } else {
      createConversation(projectId);
    }
    setExpanded((prev) => ({ ...prev, [projectId]: true }));
  };

  return (
    <>
      <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`} aria-hidden={collapsed}>
        <div className="sidebar-traffic" data-tauri-drag-region>
          <button
            className="sidebar-collapse-btn"
            type="button"
            onClick={onCollapse}
            aria-label="收起侧栏"
            title="收起侧栏"
          >
            <PanelLeftClose size={16} />
          </button>
        </div>
        <div className="sidebar-scroll">
          <div className="sidebar-menu-panel nav-menu">
            <button className="nav-item primary" type="button" onClick={() => createConversation()}>
              <SquarePen size={15} />
              <span className="nav-label">新对话</span>
            </button>
            <button className={`nav-item ${searchOpen ? 'active' : ''}`} type="button" onClick={() => setSearchOpen(true)}>
              <Search size={15} />
              <span className="nav-label">搜索</span>
            </button>
            <button
              className={`nav-item ${automationOpen ? 'active' : ''}`}
              type="button"
              onClick={() => setAutomationOpen(true)}
            >
              <Workflow size={15} />
              <span className="nav-label">自动化</span>
              <span className="nav-badge">0</span>
            </button>
            <button
              className={`nav-item ${mobileOpen ? 'active' : ''}`}
              type="button"
              onClick={() => setMobileOpen(true)}
            >
              <Smartphone size={15} />
              <span className="nav-label">Alpha 移动版</span>
            </button>
          </div>

          {pinnedConversations.length > 0 && (
            <div className="pinned-conversations" aria-label="置顶对话">
              <div className="sidebar-section-label">置顶</div>
              <div className="sidebar-menu-panel conv-group pinned">
                {pinnedConversations.map((conversation) => (
                  <ConversationRow
                    key={conversation.id}
                    conversation={conversation}
                    active={conversation.id === currentConversationId}
                    menuOpen={menu?.owner === conversation.id}
                    editing={editingConversationId === conversation.id}
                    showPinIndicator={false}
                    onSelect={() => setCurrentConversation(conversation.id)}
                    onOpenMenu={(anchor) => openConversationMenu(conversation, anchor)}
                    onCommitRename={(name) => commitConversationRename(conversation.id, name)}
                    onCancelRename={cancelConversationRename}
                  />
                ))}
              </div>
            </div>
          )}

          <SectionLabel>资产 · 视图</SectionLabel>
          <div className="sidebar-menu-panel nav-menu">
            <button className="nav-item" type="button" onClick={() => setAutomationOpen(true)}>
              <FileText size={15} />
              <span className="nav-label">晨报</span>
              <span className="nav-badge">草稿</span>
            </button>
            <button className="nav-item" type="button" onClick={() => setAutomationOpen(true)}>
              <Zap size={15} />
              <span className="nav-label">操作清单</span>
              <span className="nav-badge">18</span>
            </button>
            <button
              className={`nav-item ${portfolioOpen ? 'active' : ''}`}
              type="button"
              onClick={onOpenPortfolio}
            >
              <Briefcase size={15} />
              <span className="nav-label">持仓 / 自选</span>
            </button>
          </div>

        <div className={`sidebar-group-head ${menu?.owner === 'section' || menu?.owner === 'add' ? 'menu-open' : ''}`}>
          <span className="sidebar-group-label">项目</span>
          <span className="sidebar-group-actions">
            <button
              className="group-action"
              type="button"
              onClick={anyExpanded ? collapseAll : expandAll}
              aria-label={anyExpanded ? '全部收起' : '全部展开'}
              title={anyExpanded ? '全部收起' : '全部展开'}
            >
              {anyExpanded ? <Shrink size={15} /> : <Expand size={15} />}
            </button>
            <button
              className={`group-action ${menu?.owner === 'section' ? 'active' : ''}`}
              type="button"
              onClick={openSectionMenu}
              aria-label="排序与整理"
              title="排序与整理"
            >
              <MoreHorizontal size={15} />
            </button>
            <button
              className={`group-action ${menu?.owner === 'add' ? 'active' : ''}`}
              type="button"
              onClick={openNewProjectMenu}
              aria-label="新建项目"
              title="新建项目"
            >
              <SquarePen size={15} />
            </button>
          </span>
        </div>
        <div className="sidebar-menu-panel project-menu">
          {projects.length === 0 ? (
            <div className="sidebar-hint">用项目把对话固定到一个工作目录</div>
          ) : (
            sortedProjects.map((project) => (
              <ProjectItem
                key={project.id}
                project={project}
                expanded={Boolean(expanded[project.id])}
                editing={editingProjectId === project.id}
                menuOpen={menu?.owner === project.id}
                conversations={conversations.filter((conversation) => conversation.projectId === project.id && !conversation.pinned)}
                currentConversationId={currentConversationId}
                activeMenuId={menu?.owner ?? null}
                editingConversationId={editingConversationId}
                onToggle={() => toggleProject(project.id)}
                onSelectConversation={setCurrentConversation}
                onNewConversation={() => {
                  setExpanded((prev) => ({ ...prev, [project.id]: true }));
                  createConversation(project.id);
                }}
                onOpenConversationMenu={openConversationMenu}
                onCommitConversationRename={commitConversationRename}
                onCancelConversationRename={cancelConversationRename}
                onCommitRename={(name) => {
                  renameProject(project.id, name);
                  setEditingProjectId(null);
                }}
                onCancelRename={() => setEditingProjectId(null)}
                onOpenMenu={(anchor) => openProjectMenu(project, anchor)}
              />
            ))
          )}
        </div>

        <div className={`sidebar-group-head ${menu?.owner === 'conv-section' ? 'menu-open' : ''}`}>
          <span className="sidebar-group-label">对话</span>
          <span className="sidebar-group-actions">
            <button
              className="group-action"
              type="button"
              onClick={() => setConversationsCollapsed((value) => !value)}
              aria-label={conversationsCollapsed ? '展开列表' : '收起列表'}
              title={conversationsCollapsed ? '展开列表' : '收起列表'}
            >
              {conversationsCollapsed ? <Expand size={15} /> : <Shrink size={15} />}
            </button>
            <button
              className={`group-action ${menu?.owner === 'conv-section' ? 'active' : ''}`}
              type="button"
              onClick={openConversationSectionMenu}
              aria-label="排序与整理"
              title="排序与整理"
            >
              <MoreHorizontal size={15} />
            </button>
            <button
              className="group-action"
              type="button"
              onClick={() => createConversation()}
              aria-label="新建对话"
              title="新建对话"
            >
              <SquarePen size={15} />
            </button>
          </span>
        </div>
        {conversationsCollapsed ? null : conversationGroups.length === 0 ? (
          <div className="sidebar-hint">暂无未归类的对话</div>
        ) : (
          conversationGroups.map((group) => (
            <div key={group.label} className="conversation-date-group">
              {group.label && <div className="sidebar-section-label">{group.label}</div>}
              <div className="sidebar-menu-panel conv-group">
                {group.items.map((conversation) => (
                  <ConversationRow
                    key={conversation.id}
                    conversation={conversation}
                    active={conversation.id === currentConversationId}
                    menuOpen={menu?.owner === conversation.id}
                    editing={editingConversationId === conversation.id}
                    onSelect={() => setCurrentConversation(conversation.id)}
                    onOpenMenu={(anchor) => openConversationMenu(conversation, anchor)}
                    onCommitRename={(name) => commitConversationRename(conversation.id, name)}
                    onCancelRename={cancelConversationRename}
                  />
                ))}
              </div>
            </div>
          ))
        )}
        </div>
        <div className="sidebar-footer">
          <button
            className="nav-item settings-entry"
            type="button"
            aria-label="设置"
            title="设置"
            onClick={onOpenSettings}
          >
            <Settings size={15} />
            <span className="nav-label">设置</span>
          </button>
        </div>
      </aside>
      {menu && <ContextMenu menu={menu} onClose={closeMenu} />}
      <SearchDialog
        open={searchOpen}
        conversations={conversations}
        projects={projects}
        currentConversationId={currentConversationId}
        onClose={() => setSearchOpen(false)}
        onSelectConversation={(id) => {
          setCurrentConversation(id);
          setSearchOpen(false);
        }}
        onOpenProject={(id) => {
          openProjectFromSearch(id);
          setSearchOpen(false);
        }}
        onNewConversation={() => {
          createConversation();
          setSearchOpen(false);
        }}
      />
      <AutomationDialog open={automationOpen} onClose={() => setAutomationOpen(false)} />
      <MobileDialog open={mobileOpen} onClose={() => setMobileOpen(false)} />
    </>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="sidebar-section-label" style={{ marginTop: 14 }}>{children}</div>;
}

function SearchDialog({
  open,
  conversations,
  projects,
  currentConversationId,
  onClose,
  onSelectConversation,
  onOpenProject,
  onNewConversation,
}: {
  open: boolean;
  conversations: Conversation[];
  projects: Project[];
  currentConversationId: string | null;
  onClose: () => void;
  onSelectConversation: (id: string) => void;
  onOpenProject: (id: string) => void;
  onNewConversation: () => void;
}) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: WindowEventMap['keydown']) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  const normalized = query.trim().toLowerCase();
  const conversationResults = useMemo(() => {
    const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);
    if (!normalized) return sorted.slice(0, 7);
    return sorted
      .filter((conversation) => {
        const project = projects.find((item) => item.id === conversation.projectId);
        return [conversation.title, conversation.cwd, project?.name]
          .filter(Boolean)
          .some((value) => value!.toLowerCase().includes(normalized));
      })
      .slice(0, 8);
  }, [conversations, normalized, projects]);

  const projectResults = useMemo(() => {
    if (!normalized) return projects.slice(0, 5);
    return projects
      .filter((project) =>
        [project.name, project.cwd]
          .filter(Boolean)
          .some((value) => value!.toLowerCase().includes(normalized)),
      )
      .slice(0, 6);
  }, [normalized, projects]);

  if (!open) return null;

  return (
    <div className="dialog-layer" role="presentation">
      <button className="dialog-backdrop" type="button" aria-label="关闭搜索" onClick={onClose} />
      <section className="command-dialog" role="dialog" aria-modal="true" aria-label="搜索">
        <div className="command-input-row">
          <Search size={16} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索对话、项目或工作目录"
          />
          <button type="button" className="icon-mini" onClick={onClose} aria-label="关闭搜索">
            <X size={14} />
          </button>
        </div>

        <div className="command-content">
          <button type="button" className="command-result new" onClick={onNewConversation}>
            <Plus size={15} />
            <span>
              <strong>新对话</strong>
              <em>从空白上下文开始</em>
            </span>
          </button>

          {projectResults.length > 0 && (
            <div className="command-section">
              <div className="command-section-label">项目</div>
              {projectResults.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  className="command-result"
                  onClick={() => onOpenProject(project.id)}
                >
                  <Folder size={15} />
                  <span>
                    <strong>{project.name}</strong>
                    <em>{project.cwd ? shortenPath(project.cwd) : '未指定目录'}</em>
                  </span>
                </button>
              ))}
            </div>
          )}

          {conversationResults.length > 0 && (
            <div className="command-section">
              <div className="command-section-label">{normalized ? '匹配对话' : '最近对话'}</div>
              {conversationResults.map((conversation) => (
                <button
                  key={conversation.id}
                  type="button"
                  className={`command-result ${conversation.id === currentConversationId ? 'active' : ''}`}
                  onClick={() => onSelectConversation(conversation.id)}
                >
                  {conversation.status === 'streaming' ? (
                    <Loader2 size={15} className="spin" />
                  ) : (
                    <MessageSquare size={15} />
                  )}
                  <span>
                    <strong>{conversation.title}</strong>
                    <em>
                      {conversation.cwd ? shortenPath(conversation.cwd) : '未指定目录'} · {formatRelative(conversation.updatedAt)}
                    </em>
                  </span>
                </button>
              ))}
            </div>
          )}

          {projectResults.length === 0 && conversationResults.length === 0 && (
            <div className="command-empty">
              <Search size={16} />
              <span>没有匹配结果</span>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function AutomationDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;

  return (
    <UtilityDialog icon={<Workflow size={16} />} title="自动化" onClose={onClose}>
      <div className="utility-list">
        <UtilityRow
          icon={<Clock3 size={15} />}
          title="每日晨报"
          description="盘前主线、持仓风险和待跟踪问题"
          badge="草稿"
        />
        <UtilityRow
          icon={<Briefcase size={15} />}
          title="持仓监控"
          description="价格、新闻和基本面变化的本地提醒队列"
          badge="未启用"
        />
        <UtilityRow
          icon={<History size={15} />}
          title="复盘提醒"
          description="把已完成对话沉淀为下一次检查点"
          badge="未启用"
        />
      </div>
    </UtilityDialog>
  );
}

function MobileDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;

  return (
    <UtilityDialog icon={<Smartphone size={16} />} title="Alpha 移动版" onClose={onClose}>
      <div className="utility-list">
        <UtilityRow
          icon={<MessageCircle size={15} />}
          title="移动会话"
          description="延续桌面线程和项目上下文"
          badge="计划中"
        />
        <UtilityRow
          icon={<ShieldCheck size={15} />}
          title="只读投研"
          description="移动端保留合规边界，不接交易执行"
          badge="本地"
        />
      </div>
    </UtilityDialog>
  );
}

const SETTINGS_SECTIONS = [
  { id: 'general', label: '常规', icon: <SlidersHorizontal size={15} /> },
  { id: 'model', label: '模型与推理', icon: <Cpu size={15} /> },
  { id: 'appearance', label: '外观', icon: <Sun size={15} /> },
  { id: 'about', label: '关于', icon: <Info size={15} /> },
] as const;

type SettingsSection = (typeof SETTINGS_SECTIONS)[number]['id'];

function SettingsPage({
  open,
  onClose,
  theme,
  onToggleTheme,
}: {
  open: boolean;
  onClose: () => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
}) {
  const model = useChatStore((state) => state.model);
  const reasoningEffort = useChatStore((state) => state.reasoningEffort);
  const speed = useChatStore((state) => state.speed);
  const sandboxMode = useChatStore((state) => state.sandboxMode);
  const setModel = useChatStore((state) => state.setModel);
  const setReasoningEffort = useChatStore((state) => state.setReasoningEffort);
  const setSpeed = useChatStore((state) => state.setSpeed);
  const setSandboxMode = useChatStore((state) => state.setSandboxMode);
  const codexStatus = useChatStore((state) => state.codexStatus);
  const isCheckingCodex = useChatStore((state) => state.isCheckingCodex);
  const refreshCodexStatus = useChatStore((state) => state.refreshCodexStatus);

  const [section, setSection] = useState<SettingsSection>('general');

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: WindowEventMap['keydown']) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const activeLabel = SETTINGS_SECTIONS.find((item) => item.id === section)?.label ?? '设置';
  const codexReady = Boolean(codexStatus?.installed && codexStatus.loggedIn);

  return (
    <div className="settings-page" role="dialog" aria-modal="true" aria-label="设置">
      <nav className="settings-page-nav">
        <div className="settings-page-traffic" data-tauri-drag-region />
        <button className="settings-back" type="button" onClick={onClose}>
          <ChevronLeft size={16} />
          <span>返回应用</span>
        </button>
        <div className="settings-nav-list">
          <div className="settings-nav-grouplabel">个人</div>
          {SETTINGS_SECTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`settings-nav-item ${section === item.id ? 'active' : ''}`}
              onClick={() => setSection(item.id)}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      </nav>

      <div className="settings-page-main">
        <div className="settings-page-head" data-tauri-drag-region />

        <div className="settings-page-scroll">
          <div className="settings-content">
            <h1 className="settings-content-title">{activeLabel}</h1>
            {section === 'general' && (
              <SettingsGroup>
                <SettingsRow
                  title="默认访问权限"
                  description="新对话的默认沙箱级别，发送前仍可在输入框左侧临时调整。"
                >
                  <select
                    className="settings-select"
                    value={sandboxMode}
                    onChange={(event) => setSandboxMode(event.target.value as SandboxMode)}
                  >
                    <option value="read-only">{sandboxLabels['read-only']}</option>
                    <option value="workspace-write">{sandboxLabels['workspace-write']}</option>
                    <option value="danger-full-access">{sandboxLabels['danger-full-access']}</option>
                  </select>
                </SettingsRow>
                <SettingsRow
                  title="工作目录"
                  description="项目可绑定本地目录，新对话默认使用当前项目的工作区。"
                >
                  <span className="settings-static">按项目管理</span>
                </SettingsRow>
                <SettingsRow
                  title="合规边界"
                  description="首版只做投研对话，不接交易、不写审计归档。"
                >
                  <span className="settings-static">只读投研</span>
                </SettingsRow>
              </SettingsGroup>
            )}

            {section === 'model' && (
              <SettingsGroup>
                <SettingsRow title="模型" description="对话使用的基础模型，可随时切换。">
                  <select
                    className="settings-select"
                    value={model}
                    onChange={(event) => setModel(event.target.value)}
                  >
                    {MODEL_OPTIONS.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </SettingsRow>
                <SettingsRow title="推理强度" description="更高的强度更细致，但响应更慢。">
                  <SettingsSegment
                    options={EFFORT_OPTIONS.map((option) => ({ id: option.id, label: option.label }))}
                    value={reasoningEffort}
                    onChange={(id) => setReasoningEffort(id as ReasoningEffort)}
                  />
                </SettingsRow>
                <SettingsRow title="速度" description="快速模式约 1.5 倍速度，用量也会相应增加。">
                  <SettingsSegment
                    options={SPEED_OPTIONS.map((option) => ({
                      id: option.id,
                      label: option.label,
                      icon: option.fast ? <Zap size={13} /> : undefined,
                    }))}
                    value={speed}
                    onChange={(id) => setSpeed(id as Speed)}
                  />
                </SettingsRow>
              </SettingsGroup>
            )}

            {section === 'appearance' && (
              <SettingsGroup>
                <SettingsRow title="主题" description="选择界面的明暗外观。">
                  <SettingsSegment
                    options={[
                      { id: 'dark', label: '深色', icon: <Moon size={13} /> },
                      { id: 'light', label: '浅色', icon: <Sun size={13} /> },
                    ]}
                    value={theme}
                    onChange={(id) => {
                      if (id !== theme) onToggleTheme();
                    }}
                  />
                </SettingsRow>
              </SettingsGroup>
            )}

            {section === 'about' && (
              <SettingsGroup>
                <div className={`settings-status ${codexReady ? 'ready' : 'attention'}`}>
                  <span className="settings-status-icon">
                    {isCheckingCodex ? <Loader2 size={16} className="spin" /> : <Terminal size={16} />}
                  </span>
                  <div className="settings-status-main">
                    <strong>
                      {isCheckingCodex
                        ? '正在检查 Codex CLI…'
                        : codexReady
                          ? `Codex CLI 已就绪${codexStatus?.version ? ` · ${codexStatus.version}` : ''}`
                          : 'Codex CLI 未就绪'}
                    </strong>
                    <span>
                      {codexReady
                        ? codexStatus?.path || '已检测到本地 Codex CLI'
                        : codexStatus?.error || '请确认 Codex 已安装并登录。'}
                    </span>
                  </div>
                  <button
                    className="settings-btn"
                    type="button"
                    onClick={() => void refreshCodexStatus()}
                    disabled={isCheckingCodex}
                  >
                    重新检测
                  </button>
                </div>
                <SettingsRow title="登录状态" description="Codex CLI 的本地登录态。">
                  <span className="settings-static">{codexStatus?.loggedIn ? '已登录' : '未登录'}</span>
                </SettingsRow>
                <SettingsRow title="应用" description="Alpha Studio · 本地投研工作台">
                  <span className="settings-static">预览版</span>
                </SettingsRow>
              </SettingsGroup>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SettingsGroup({ children }: { children: ReactNode }) {
  return <div className="settings-group">{children}</div>;
}

function SettingsRow({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="settings-row">
      <div className="settings-row-main">
        <strong>{title}</strong>
        {description && <span>{description}</span>}
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  );
}

function SettingsSegment<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string; icon?: ReactNode }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="settings-segment" role="group">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          className={`settings-segment-btn ${option.id === value ? 'active' : ''}`}
          aria-pressed={option.id === value}
          onClick={() => onChange(option.id)}
        >
          {option.icon}
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
}

function UtilityDialog({
  icon,
  title,
  onClose,
  children,
}: {
  icon: ReactNode;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const handleKeyDown = (event: WindowEventMap['keydown']) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="dialog-layer" role="presentation">
      <button className="dialog-backdrop" type="button" aria-label={`关闭${title}`} onClick={onClose} />
      <section className="utility-dialog" role="dialog" aria-modal="true" aria-label={title}>
        <header className="utility-header">
          <span className="utility-title">
            {icon}
            <strong>{title}</strong>
          </span>
          <button className="icon-btn" type="button" onClick={onClose} aria-label={`关闭${title}`}>
            <X size={15} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

function UtilityRow({
  icon,
  title,
  description,
  badge,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  badge: string;
}) {
  return (
    <div className="utility-row">
      <span className="utility-row-icon">{icon}</span>
      <span className="utility-row-main">
        <strong>{title}</strong>
        <em>{description}</em>
      </span>
      <span className="utility-badge">{badge}</span>
    </div>
  );
}

function ConversationRow({
  conversation,
  active,
  nested,
  menuOpen,
  editing,
  showPinIndicator = true,
  onSelect,
  onOpenMenu,
  onCommitRename,
  onCancelRename,
}: {
  conversation: Conversation;
  active: boolean;
  nested?: boolean;
  menuOpen: boolean;
  editing: boolean;
  showPinIndicator?: boolean;
  onSelect: () => void;
  onOpenMenu: (anchor: MenuAnchor) => void;
  onCommitRename: (name: string) => void;
  onCancelRename: () => void;
}) {
  const streaming = conversation.status === 'streaming';
  return (
    <div
      className={`conv-row ${active ? 'active' : ''} ${nested ? 'nested' : ''} ${menuOpen ? 'menu-open' : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => {
        if (!editing) onSelect();
      }}
      onKeyDown={(event) => {
        if (!editing && event.key === 'Enter') onSelect();
      }}
      onContextMenu={(event) => {
        if (editing) return;
        event.preventDefault();
        onOpenMenu(anchorFromCursor(event));
      }}
    >
      {editing ? (
        <ProjectNameInput
          defaultValue={conversation.title}
          onCommit={onCommitRename}
          onCancel={onCancelRename}
        />
      ) : (
        <span className="conv-title">{conversation.title}</span>
      )}
      {showPinIndicator && conversation.pinned && !editing && <Pin size={10} className="conv-pin" aria-label="已置顶" />}
      {!editing && (
        <span className={`conv-time ${streaming ? 'streaming' : ''}`}>
          {streaming ? <Loader2 size={12} className="spin" /> : formatRelative(conversation.updatedAt)}
        </span>
      )}
      {!editing && (
        <span className="conv-actions" onClick={(event) => event.stopPropagation()}>
          <button
            className={`row-icon-btn ${menuOpen ? 'active' : ''}`}
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onOpenMenu(anchorFromButton(event));
            }}
            aria-label="对话操作"
            title="更多"
          >
            <MoreHorizontal size={15} />
          </button>
        </span>
      )}
    </div>
  );
}

const PROJECT_VISIBLE_LIMIT = 5;

function ProjectItem({
  project,
  expanded,
  editing,
  menuOpen,
  conversations,
  currentConversationId,
  activeMenuId,
  editingConversationId,
  onToggle,
  onSelectConversation,
  onNewConversation,
  onOpenConversationMenu,
  onCommitConversationRename,
  onCancelConversationRename,
  onCommitRename,
  onCancelRename,
  onOpenMenu,
}: {
  project: Project;
  expanded: boolean;
  editing: boolean;
  menuOpen: boolean;
  conversations: Conversation[];
  currentConversationId: string | null;
  activeMenuId: string | null;
  editingConversationId: string | null;
  onToggle: () => void;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
  onOpenConversationMenu: (conversation: Conversation, anchor: MenuAnchor) => void;
  onCommitConversationRename: (id: string, name: string) => void;
  onCancelConversationRename: () => void;
  onCommitRename: (name: string) => void;
  onCancelRename: () => void;
  onOpenMenu: (anchor: MenuAnchor) => void;
}) {
  const sorted = useMemo(
    () =>
      [...conversations].sort((a, b) => {
        const pinnedA = a.pinned ? 1 : 0;
        const pinnedB = b.pinned ? 1 : 0;
        if (pinnedA !== pinnedB) return pinnedB - pinnedA;
        return b.updatedAt - a.updatedAt;
      }),
    [conversations],
  );
  const [showAll, setShowAll] = useState(false);
  const hasMore = sorted.length > PROJECT_VISIBLE_LIMIT;
  const visible = showAll ? sorted : sorted.slice(0, PROJECT_VISIBLE_LIMIT);

  return (
    <div className="project-item">
      <div
        className={`project-row ${expanded ? 'open' : ''} ${menuOpen ? 'menu-open' : ''}`}
        role="button"
        tabIndex={0}
        onClick={() => {
          if (!editing) onToggle();
        }}
        onKeyDown={(event) => {
          if (!editing && event.key === 'Enter') onToggle();
        }}
        onContextMenu={(event) => {
          if (editing) return;
          event.preventDefault();
          onOpenMenu(anchorFromCursor(event));
        }}
      >
        {expanded ? (
          <FolderOpen size={15} className={`project-folder ${project.pinned ? 'pinned' : ''}`} />
        ) : (
          <Folder size={15} className={`project-folder ${project.pinned ? 'pinned' : ''}`} />
        )}
        {editing ? (
          <ProjectNameInput
            defaultValue={project.name}
            onCommit={onCommitRename}
            onCancel={onCancelRename}
          />
        ) : (
          <span className="project-name" title={project.cwd || '未指定工作目录'}>
            {project.name}
          </span>
        )}
        {!editing && project.pinned && <Pin size={11} className="project-pin" aria-label="已置顶" />}
        {!editing && (
          <span className="project-actions" onClick={(event) => event.stopPropagation()}>
            <button
              className="row-icon-btn"
              type="button"
              onClick={onNewConversation}
              aria-label="在项目中新建对话"
              title="新建对话"
            >
              <SquarePen size={13} />
            </button>
            <button
              className={`row-icon-btn ${menuOpen ? 'active' : ''}`}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onOpenMenu(anchorFromButton(event));
              }}
              aria-label="项目操作"
              title="更多"
            >
              <MoreHorizontal size={15} />
            </button>
          </span>
        )}
      </div>
      {expanded && (
        <div className="project-children">
          {sorted.length === 0 ? (
            <div className="project-empty">暂无对话</div>
          ) : (
            visible.map((conversation) => (
              <ConversationRow
                key={conversation.id}
                conversation={conversation}
                active={conversation.id === currentConversationId}
                nested
                menuOpen={activeMenuId === conversation.id}
                editing={editingConversationId === conversation.id}
                onSelect={() => onSelectConversation(conversation.id)}
                onOpenMenu={(anchor) => onOpenConversationMenu(conversation, anchor)}
                onCommitRename={(name) => onCommitConversationRename(conversation.id, name)}
                onCancelRename={onCancelConversationRename}
              />
            ))
          )}
          {hasMore && (
            <button
              className="project-toggle"
              type="button"
              onClick={() => setShowAll((value) => !value)}
            >
              <ChevronDown size={13} className={`project-toggle-caret ${showAll ? 'open' : ''}`} />
              <span>{showAll ? '折叠显示' : `展开显示 · ${sorted.length - PROJECT_VISIBLE_LIMIT}`}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ProjectNameInput({
  defaultValue,
  onCommit,
  onCancel,
}: {
  defaultValue: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const commit = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    onCommit(value);
  };
  const cancel = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    onCancel();
  };

  return (
    <input
      ref={inputRef}
      className="project-name-input"
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          cancel();
        }
      }}
      onBlur={commit}
    />
  );
}

/* ------------------------------------------------------------------ context menu */

interface MenuAnchor {
  x: number;
  y: number;
}

type MenuNode =
  | { kind: 'item'; icon?: ReactNode; label: string; shortcut?: string; danger?: boolean; disabled?: boolean; onSelect: () => void }
  | { kind: 'radio'; icon?: ReactNode; label: string; checked: boolean; onSelect: () => void }
  | { kind: 'submenu'; icon?: ReactNode; label: string; children: MenuNode[] }
  | { kind: 'separator' };

interface SidebarMenu extends MenuAnchor {
  owner: string;
  items: MenuNode[];
}

function anchorFromButton(event: ReactMouseEvent): MenuAnchor {
  const rect = event.currentTarget.getBoundingClientRect();
  return { x: rect.left, y: rect.bottom + 6 };
}

function anchorFromCursor(event: ReactMouseEvent): MenuAnchor {
  return { x: event.clientX, y: event.clientY };
}

function ContextMenu({ menu, onClose }: { menu: SidebarMenu; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: menu.x, top: menu.y });

  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pad = 10;
    let left = menu.x;
    let top = menu.y;
    if (left + rect.width > window.innerWidth - pad) {
      left = Math.max(pad, window.innerWidth - pad - rect.width);
    }
    if (top + rect.height > window.innerHeight - pad) {
      top = Math.max(pad, menu.y - rect.height - 12);
    }
    setPos({ left, top });
  }, [menu.x, menu.y, menu.items]);

  useEffect(() => {
    const handleKeyDown = (event: WindowEventMap['keydown']) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const runItem = (action: () => void) => {
    onClose();
    action();
  };

  return (
    <>
      <button
        className="menu-backdrop"
        type="button"
        aria-label="关闭菜单"
        onClick={onClose}
        onContextMenu={(event) => {
          event.preventDefault();
          onClose();
        }}
      />
      <div
        ref={panelRef}
        className="cmenu"
        role="menu"
        style={{ left: pos.left, top: pos.top }}
      >
        {menu.items.map((node, index) => (
          <MenuRow key={index} node={node} onRun={runItem} />
        ))}
      </div>
    </>
  );
}

function MenuRow({ node, onRun }: { node: MenuNode; onRun: (action: () => void) => void }) {
  const [subOpen, setSubOpen] = useState(false);

  if (node.kind === 'separator') {
    return <div className="cmenu-sep" role="separator" />;
  }

  if (node.kind === 'submenu') {
    return (
      <div
        className="cmenu-subwrap"
        onMouseEnter={() => setSubOpen(true)}
        onMouseLeave={() => setSubOpen(false)}
      >
        <button
          type="button"
          className={`cmenu-item ${subOpen ? 'active' : ''}`}
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={subOpen}
        >
          <span className="cmenu-icon">{node.icon}</span>
          <span className="cmenu-label">{node.label}</span>
          <ChevronRight size={14} className="cmenu-chevron" />
        </button>
        {subOpen && (
          <div className="cmenu-flyout">
            <div className="cmenu" role="menu">
              {node.children.map((child, index) => (
                <MenuRow key={index} node={child} onRun={onRun} />
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (node.kind === 'radio') {
    return (
      <button
        type="button"
        className="cmenu-item"
        role="menuitemradio"
        aria-checked={node.checked}
        onClick={() => onRun(node.onSelect)}
      >
        <span className="cmenu-icon">{node.icon}</span>
        <span className="cmenu-label">{node.label}</span>
        {node.checked && <Check size={15} className="cmenu-check" />}
      </button>
    );
  }

  return (
    <button
      type="button"
      className={`cmenu-item ${node.danger ? 'danger' : ''}`}
      role="menuitem"
      disabled={node.disabled}
      onClick={() => onRun(node.onSelect)}
    >
      <span className="cmenu-icon">{node.icon}</span>
      <span className="cmenu-label">{node.label}</span>
      {node.shortcut && <span className="cmenu-shortcut">{node.shortcut}</span>}
    </button>
  );
}

function sortProjects(projects: Project[], sort: 'updated' | 'created' | 'name'): Project[] {
  const compare = (a: Project, b: Project) => {
    if (sort === 'name') return a.name.localeCompare(b.name, 'zh-CN');
    if (sort === 'created') return b.createdAt - a.createdAt;
    return b.updatedAt - a.updatedAt;
  };
  return [...projects].sort((a, b) => {
    const pinnedA = a.pinned ? 1 : 0;
    const pinnedB = b.pinned ? 1 : 0;
    if (pinnedA !== pinnedB) return pinnedB - pinnedA;
    return compare(a, b);
  });
}

/* ------------------------------------------------------------------ top bar */

function TopBar({
  sidebarCollapsed,
  onToggleSidebar,
  coworkerOpen,
  onToggleCoworker,
  portfolioOpen,
  onTogglePortfolio,
}: {
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  coworkerOpen: boolean;
  onToggleCoworker: () => void;
  portfolioOpen: boolean;
  onTogglePortfolio: () => void;
}) {
  const codexStatus = useChatStore((state) => state.codexStatus);
  const isCheckingCodex = useChatStore((state) => state.isCheckingCodex);
  const refreshCodexStatus = useChatStore((state) => state.refreshCodexStatus);
  const renameConversation = useChatStore((state) => state.renameConversation);
  const toggleConversationPin = useChatStore((state) => state.toggleConversationPin);
  const deleteConversation = useChatStore((state) => state.deleteConversation);
  const createConversation = useChatStore((state) => state.createConversation);
  const conversation = useCurrentConversation();

  const [menuAnchor, setMenuAnchor] = useState<MenuAnchor | null>(null);
  const [editing, setEditing] = useState(false);

  const conversationId = conversation?.id;
  useEffect(() => {
    setEditing(false);
    setMenuAnchor(null);
  }, [conversationId]);

  useEffect(() => {
    if (!conversation) return;
    const handleKeyDown = (event: WindowEventMap['keydown']) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.altKey && event.code === 'KeyP') {
        event.preventDefault();
        toggleConversationPin(conversation.id);
      } else if (event.altKey && event.code === 'KeyR') {
        event.preventDefault();
        setMenuAnchor(null);
        setEditing(true);
      } else if (!event.altKey && !event.shiftKey && event.code === 'Backspace') {
        event.preventDefault();
        deleteConversation(conversation.id);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [conversation, toggleConversationPin, deleteConversation]);

  const status = codexStatus?.installed && codexStatus.loggedIn ? 'ready' : 'needs-attention';
  const statusLabel = isCheckingCodex
    ? '检查中…'
    : codexStatus?.installed && codexStatus.loggedIn
      ? `Codex ${codexStatus.version || ''}`.trim()
      : 'Codex 未就绪';

  const titleMenu: SidebarMenu | null =
    conversation && menuAnchor
      ? {
          owner: 'top-title',
          ...menuAnchor,
          items: [
            {
              kind: 'item',
              icon: conversation.pinned ? <PinOff size={15} /> : <Pin size={15} />,
              label: conversation.pinned ? '取消置顶' : '置顶对话',
              shortcut: '⌥⌘P',
              onSelect: () => toggleConversationPin(conversation.id),
            },
            {
              kind: 'item',
              icon: <Pencil size={15} />,
              label: '重命名对话',
              shortcut: '⌥⌘R',
              onSelect: () => setEditing(true),
            },
            {
              kind: 'submenu',
              icon: <Copy size={15} />,
              label: '复制',
              children: [
                {
                  kind: 'item',
                  icon: <FileText size={15} />,
                  label: '复制标题',
                  onSelect: () => void copyToClipboard(conversation.title),
                },
                {
                  kind: 'item',
                  icon: <MessageSquare size={15} />,
                  label: '复制线程 ID',
                  disabled: !conversation.codexThreadId,
                  onSelect: () => void copyToClipboard(conversation.codexThreadId || ''),
                },
              ],
            },
            { kind: 'separator' },
            {
              kind: 'item',
              icon: <FolderOpen size={15} />,
              label: '在访达中打开',
              disabled: !conversation.cwd,
              onSelect: () => void revealPath(conversation.cwd),
            },
            {
              kind: 'item',
              icon: <SquarePen size={15} />,
              label: '新建对话',
              shortcut: '⌘N',
              onSelect: () => createConversation(conversation.projectId),
            },
            { kind: 'separator' },
            {
              kind: 'item',
              icon: <Trash2 size={15} />,
              label: '删除对话',
              danger: true,
              shortcut: '⌘⌫',
              onSelect: () => deleteConversation(conversation.id),
            },
          ],
        }
      : null;

  return (
    <header className="top-bar" data-tauri-drag-region>
      {sidebarCollapsed && (
        <button
          className="icon-btn"
          type="button"
          onClick={onToggleSidebar}
          aria-label="展开侧栏"
          title="展开侧栏"
        >
          <PanelLeftOpen size={16} />
        </button>
      )}
      {conversation ? (
        <div className={`top-bar-title ${editing ? 'editing' : ''}`} data-tauri-drag-region>
          {editing ? (
            <div className="top-bar-title-edit">
              <ProjectNameInput
                defaultValue={conversation.title}
                onCommit={(name) => {
                  renameConversation(conversation.id, name);
                  setEditing(false);
                }}
                onCancel={() => setEditing(false)}
              />
            </div>
          ) : (
            <div className="top-bar-title-group">
              <button
                type="button"
                className={`top-bar-title-btn ${menuAnchor ? 'active' : ''}`}
                onClick={(event) => setMenuAnchor(anchorFromButton(event))}
                onDoubleClick={() => setEditing(true)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setMenuAnchor(anchorFromCursor(event));
                }}
                title="对话操作"
              >
                {conversation.pinned && <Pin size={12} className="top-bar-title-pin" aria-label="已置顶" />}
                <span className="top-bar-title-text">{conversation.title}</span>
              </button>
              <button
                type="button"
                className={`top-bar-title-more ${menuAnchor ? 'active' : ''}`}
                onClick={(event) => setMenuAnchor(anchorFromButton(event))}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setMenuAnchor(anchorFromCursor(event));
                }}
                aria-label="对话操作"
                title="更多"
              >
                <MoreHorizontal size={16} />
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="top-bar-title" data-tauri-drag-region>Alpha Studio</div>
      )}
      <div className="top-bar-actions">
        <button
          className={`codex-chip ${status}`}
          type="button"
          onClick={() => void refreshCodexStatus()}
          aria-label={statusLabel}
          title={codexStatus?.path ? `${statusLabel} · ${codexStatus.path}` : statusLabel}
        >
          {isCheckingCodex ? <Loader2 size={13} className="spin" /> : <Terminal size={13} />}
          <ChevronDown size={12} />
        </button>
        <button
          className={`icon-btn ${portfolioOpen ? 'active' : ''}`}
          type="button"
          onClick={onTogglePortfolio}
          aria-label="持仓 / 自选"
          title="持仓 / 自选"
        >
          <Briefcase size={16} />
        </button>
        <button
          className={`icon-btn ${coworkerOpen ? 'active' : ''}`}
          type="button"
          onClick={onToggleCoworker}
          aria-label="AI 同事面板"
          title="AI 同事面板"
        >
          <Users size={16} />
        </button>
      </div>
      {titleMenu && <ContextMenu menu={titleMenu} onClose={() => setMenuAnchor(null)} />}
    </header>
  );
}

/* ------------------------------------------------------------------ chat area */

function ChatArea() {
  const conversation = useCurrentConversation();
  const codexStatus = useChatStore((state) => state.codexStatus);

  if (!conversation) return null;

  const previewRuntime = !isTauriRuntime();
  const codexReady = previewRuntime || Boolean(codexStatus?.installed && codexStatus.loggedIn);
  const isEmpty = conversation.messages.length === 0;

  return (
    <div className="chat-area">
      {(!codexReady || previewRuntime) && (
        <div className="codex-warning">
          <AlertCircle size={16} />
          <div>
            <strong>{previewRuntime ? '浏览器预览模式' : 'Codex CLI 暂不可用'}</strong>
            <span>
              {previewRuntime
                ? '这里会模拟 Codex 事件流；桌面应用会直连本地 Codex CLI。'
                : codexStatus?.error || '请确认 Codex 已安装并登录。'}
            </span>
            {codexStatus?.path && <code>{codexStatus.path}</code>}
          </div>
        </div>
      )}

      {isEmpty ? (
        <EmptyState conversation={conversation} disabled={!codexReady} />
      ) : (
        <>
          <div className="message-scroll">
            <MessageList conversation={conversation} />
          </div>
          <Composer conversation={conversation} disabled={!codexReady} bottom />
        </>
      )}
    </div>
  );
}

function EmptyState({ conversation, disabled }: { conversation: Conversation; disabled: boolean }) {
  const sendMessage = useChatStore((state) => state.sendMessage);

  const handleSuggestion = (prompt: string) => {
    void sendMessage(prompt);
  };

  return (
    <div className="empty-state">
      <h1 className="empty-heading">把投研问题交给 Alpha Studio</h1>
      <Composer conversation={conversation} disabled={disabled} />
      <div className="suggestion-row">
        <button
          type="button"
          className="suggestion-card"
          onClick={() =>
            handleSuggestion(
              '帮我盘点今天 A 股的主要主线和情绪信号，给出三条可执行的早盘观察。',
            )
          }
        >
          <MessageCircle size={16} className="icon" />
          <strong>每日早盘观察</strong>
          <span>主线、情绪和资金信号扫描</span>
        </button>
        <button
          type="button"
          className="suggestion-card"
          onClick={() =>
            handleSuggestion(
              '帮我对持仓中的白酒板块做一次基本面 + 估值复盘，输出减仓/加仓/观望建议。',
            )
          }
        >
          <FileText size={16} className="icon" />
          <strong>板块复盘</strong>
          <span>基本面、估值、风险三视角输出</span>
        </button>
        <button
          type="button"
          className="suggestion-card"
          onClick={() =>
            handleSuggestion(
              '帮我准备明天的晨会脚本：主线、风险、需要决策的三个问题各一段。',
            )
          }
        >
          <Mail size={16} className="icon" />
          <strong>晨会脚本</strong>
          <span>把多同事观点压缩成三段</span>
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ messages */

function MessageList({ conversation }: { conversation: Conversation }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversation.messages.length, conversation.messages[conversation.messages.length - 1]]);

  return (
    <div className="message-list">
      {conversation.messages.map((message) => (
        <MessageBubble key={message.id} message={message} conversation={conversation} />
      ))}
      <div ref={scrollRef} />
    </div>
  );
}

function MessageBubble({ message, conversation }: { message: ChatMessage; conversation: Conversation }) {
  const editUserMessageAndResend = useChatStore((state) => state.editUserMessageAndResend);
  const [editing, setEditing] = useState(false);
  const lastTextIndex = message.blocks.reduce(
    (lastIndex, block, index) => (block.type === 'text' ? index : lastIndex),
    -1,
  );
  const plainText = messageToPlainText(message);
  const canCopy = plainText.length > 0;
  const canEdit = message.role === 'user' && conversation.status !== 'streaming';
  const isEditing = editing && canEdit;

  const submitEdit = (next: string) => {
    const trimmed = next.trim();
    if (!trimmed) return;
    setEditing(false);
    void editUserMessageAndResend(conversation.id, message.id, trimmed);
  };

  return (
    <article className={`message ${message.role} ${isEditing ? 'editing' : ''}`}>
      {isEditing ? (
        <MessageEditBubble
          initialValue={plainText}
          onCancel={() => setEditing(false)}
          onSubmit={submitEdit}
        />
      ) : (
        <div className="bubble">
        {message.blocks.length === 0 && message.isStreaming ? (
          <div className="thinking-inline">
            <Loader2 size={14} className="spin" />
            <span>Alpha Studio 正在准备回复</span>
          </div>
        ) : message.role === 'user' ? (
          message.blocks.map((block, index) =>
            block.type === 'text' ? (
              <span key={index}>{block.content}</span>
            ) : (
              <BlockRenderer key={index} block={block} />
            ),
          )
        ) : (
          message.blocks.map((block, index) => (
            <BlockRenderer
              block={block}
              streaming={message.isStreaming && block.type === 'text' && index === lastTextIndex}
              key={`${block.type}-${index}`}
            />
          ))
        )}
        </div>
      )}
      {!isEditing && (canCopy || canEdit) && (
        <div className="message-meta">
          <span className="message-time">{formatClock(message.timestamp)}</span>
          <span className="message-actions">
            {canCopy && (
              <button
                type="button"
                className="message-action"
                onClick={() => void copyMessageText(message)}
                aria-label={message.role === 'user' ? '复制消息' : '复制回复'}
                title={message.role === 'user' ? '复制消息' : '复制回复'}
              >
                <Copy size={13} />
              </button>
            )}
            {canEdit && (
              <button
                type="button"
                className="message-action"
                onClick={() => setEditing(true)}
                aria-label="编辑并重新发送"
                title="编辑并重新发送"
              >
                <Pencil size={13} />
              </button>
            )}
          </span>
        </div>
      )}
    </article>
  );
}

function MessageEditBubble({
  initialValue,
  onCancel,
  onSubmit,
}: {
  initialValue: string;
  onCancel: () => void;
  onSubmit: (value: string) => void;
}) {
  const [value, setValue] = useState(initialValue);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(el.scrollHeight, 260)}px`;
  }, [value]);

  useEffect(() => {
    textareaRef.current?.focus();
    textareaRef.current?.select();
  }, []);

  const submit = () => {
    if (!value.trim()) return;
    onSubmit(value);
  };

  return (
    <div className="message-edit-card">
      <textarea
        ref={textareaRef}
        className="message-edit-textarea"
        value={value}
        rows={1}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
          } else if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            submit();
          }
        }}
      />
      <div className="message-edit-actions">
        <button type="button" className="message-edit-btn ghost" onClick={onCancel}>
          取消
        </button>
        <button
          type="button"
          className="message-edit-btn primary"
          onClick={submit}
          disabled={!value.trim() || value.trim() === initialValue.trim()}
        >
          发送
        </button>
      </div>
    </div>
  );
}

function BlockRenderer({ block, streaming }: { block: MessageBlock; streaming?: boolean }) {
  if (block.type === 'text') {
    return (
      <div className={`markdown-content ${streaming ? 'streaming' : ''}`}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{block.content}</ReactMarkdown>
        {streaming && <span className="stream-cursor" aria-hidden="true" />}
      </div>
    );
  }

  if (block.type === 'thinking') {
    return (
      <details className={`thinking-block ${streaming ? 'streaming' : ''}`} open={streaming}>
        <summary>
          {streaming ? <Loader2 size={13} className="spin" /> : <CheckCircle2 size={13} />}
          <span>{streaming ? '正在推理' : '推理过程'}</span>
          <ChevronDown size={13} />
        </summary>
        <pre>{block.content}</pre>
      </details>
    );
  }

  if (block.type === 'tool') {
    const tool = toolPresentation(block.title);
    const status = toolStatusLabel(block.status);

    return (
      <details className={`tool-block ${block.status}`} open={block.status !== 'completed'}>
        <summary className="tool-summary">
          <span className="tool-title-main">
            {tool.icon}
            <span>{tool.label}</span>
          </span>
          <span className="tool-status">
            {block.status === 'failed' ? (
              <AlertCircle size={13} />
            ) : block.status === 'completed' ? (
              <CheckCircle2 size={13} />
            ) : (
              <Loader2 size={13} className="spin" />
            )}
            <em>{status}</em>
          </span>
          <ChevronDown size={13} className="tool-chevron" />
        </summary>
        {(block.input || block.output) && (
          <div className="tool-detail">
            {block.input && (
              <div className="tool-io">
                <span>输入</span>
                <code>{block.input}</code>
              </div>
            )}
            {block.output && (
              <div className="tool-io">
                <span>输出</span>
                <pre>{block.output}</pre>
              </div>
            )}
          </div>
        )}
      </details>
    );
  }

  return (
    <div className="error-block">
      <AlertCircle size={16} />
      <span>{block.content}</span>
    </div>
  );
}

function toolPresentation(title: string): { label: string; icon: ReactNode } {
  const normalized = title.trim().toLowerCase();
  if (normalized.includes('exec') || normalized.includes('shell') || normalized.includes('command')) {
    return { label: '运行命令', icon: <Terminal size={14} /> };
  }
  if (normalized.includes('stderr')) {
    return { label: 'Codex 日志', icon: <AlertCircle size={14} /> };
  }
  if (normalized.includes('file')) {
    return { label: '读取文件', icon: <FileText size={14} /> };
  }
  return { label: title || '使用工具', icon: <Workflow size={14} /> };
}

function toolStatusLabel(status: ToolBlockStatus): string {
  if (status === 'completed') return '完成';
  if (status === 'failed') return '失败';
  return '运行中';
}

type ToolBlockStatus = Extract<MessageBlock, { type: 'tool' }>['status'];

async function copyMessageText(message: ChatMessage): Promise<void> {
  const text = messageToPlainText(message);
  try {
    await navigator.clipboard?.writeText(text);
  } catch {
    // Clipboard access is best-effort in browser preview and older webviews.
  }
}

function messageToPlainText(message: ChatMessage): string {
  return message.blocks
    .map((block) => {
      if (block.type === 'text' || block.type === 'thinking' || block.type === 'error') return block.content;
      if (block.type === 'tool') return [block.title, block.input, block.output].filter(Boolean).join('\n');
      return '';
    })
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

async function copyToClipboard(text: string): Promise<void> {
  if (!text) return;
  try {
    await navigator.clipboard?.writeText(text);
  } catch {
    // Clipboard access is best-effort in browser preview and older webviews.
  }
}

/* ------------------------------------------------------------------ composer */

function Composer({
  conversation,
  disabled,
  bottom,
}: {
  conversation: Conversation;
  disabled?: boolean;
  bottom?: boolean;
}) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sendMessage = useChatStore((state) => state.sendMessage);
  const stopCurrentConversation = useChatStore((state) => state.stopCurrentConversation);
  const sandboxMode = useChatStore((state) => state.sandboxMode);
  const setSandboxMode = useChatStore((state) => state.setSandboxMode);
  const isStreaming = conversation.status === 'streaming';

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [value]);

  useEffect(() => {
    if (!bottom && !disabled && !isStreaming) {
      textareaRef.current?.focus();
    }
  }, [bottom, disabled, isStreaming]);

  const submit = () => {
    const next = value.trim();
    if (!next || isStreaming || disabled) return;
    setValue('');
    void sendMessage(next);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div className={`composer-wrap ${bottom ? 'bottom' : ''}`}>
      <div className="composer-card">
        <textarea
          ref={textareaRef}
          className="composer-textarea"
          value={value}
          disabled={disabled || isStreaming}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setValue(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            disabled
              ? '请先修复 Codex CLI 状态'
              : bottom
                ? '要求后续变更'
                : '要求 Codex 执行任务'
          }
          rows={1}
        />

        <div className="composer-toolbar">
          <button className="composer-icon-btn" type="button" disabled aria-label="附件">
            <Plus size={16} />
          </button>
          <label className={`composer-pill accent`}>
            <ShieldCheck size={12} />
            <select
              value={sandboxMode}
              onChange={(event) => setSandboxMode(event.target.value as SandboxMode)}
            >
              <option value="read-only">{sandboxLabels['read-only']}</option>
              <option value="workspace-write">{sandboxLabels['workspace-write']}</option>
              <option value="danger-full-access">{sandboxLabels['danger-full-access']}</option>
            </select>
          </label>
          <span className="spacer" />
          <ModelPicker />
          <button className="composer-icon-btn" type="button" disabled aria-label="语音">
            <Mic size={15} />
          </button>
          {isStreaming ? (
            <button
              className="send-button stop"
              type="button"
              onClick={() => void stopCurrentConversation()}
              aria-label="停止生成"
            >
              <Square size={13} />
            </button>
          ) : (
            <button
              className="send-button"
              type="button"
              onClick={submit}
              disabled={!value.trim() || disabled}
              aria-label="发送"
            >
              <ArrowUp size={15} />
            </button>
          )}
        </div>
      </div>

      <div className="composer-meta">
        <span className="composer-meta-pill">
          <FolderOpen size={11} />
          <span>{shortenPath(conversation.cwd)}</span>
        </span>
        <span className="composer-meta-pill" title="本地直连 Codex CLI">
          <Bot size={11} />
          <span>本地模式</span>
        </span>
        <span className="composer-meta-pill">
          <MessageSquare size={11} />
          <span>{conversation.codexThreadId ? `线程 ${shortId(conversation.codexThreadId)}` : '新线程'}</span>
        </span>
      </div>
    </div>
  );
}

const sandboxLabels: Record<SandboxMode, string> = {
  'read-only': '只读',
  'workspace-write': '工作区写入',
  'danger-full-access': '完全访问',
};

function ModelPicker() {
  const model = useChatStore((state) => state.model);
  const reasoningEffort = useChatStore((state) => state.reasoningEffort);
  const speed = useChatStore((state) => state.speed);
  const setModel = useChatStore((state) => state.setModel);
  const setReasoningEffort = useChatStore((state) => state.setReasoningEffort);
  const setSpeed = useChatStore((state) => state.setSpeed);
  const [open, setOpen] = useState(false);
  const [submenu, setSubmenu] = useState<'model' | 'speed' | null>(null);

  const close = () => {
    setOpen(false);
    setSubmenu(null);
  };

  return (
    <div className="model-picker">
      <button
        type="button"
        className={`composer-pill model-pill ${open ? 'active' : ''}`}
        onClick={() => setOpen((value) => !value)}
        title="选择模型与推理强度"
      >
        {speed === 'fast' && <Zap size={12} className="model-pill-fast" />}
        <span>{shortModelLabel(model)}</span>
        <span className="model-pill-effort">{effortLabel(reasoningEffort)}</span>
        <ChevronDown size={12} />
      </button>
      {open && (
        <>
          <button
            className="menu-backdrop"
            type="button"
            aria-label="关闭模型菜单"
            onClick={close}
          />
          <div className="model-menu" role="menu" onMouseLeave={() => setSubmenu(null)}>
            <div className="model-menu-label">智能</div>
            {EFFORT_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                role="menuitemradio"
                aria-checked={option.id === reasoningEffort}
                className="model-menu-item"
                onMouseEnter={() => setSubmenu(null)}
                onClick={() => {
                  setReasoningEffort(option.id as ReasoningEffort);
                  close();
                }}
              >
                <span>{option.label}</span>
                {option.id === reasoningEffort && <Check size={14} className="model-menu-check" />}
              </button>
            ))}

            <div className="model-menu-divider" />

            <div className="model-flyout-row" onMouseEnter={() => setSubmenu('model')}>
              <button type="button" className="model-menu-item submenu-trigger">
                <span>{modelLabel(model)}</span>
                <ChevronRight size={14} className="model-menu-chevron" />
              </button>
              {submenu === 'model' && (
                <div className="model-flyout">
                  <div className="model-flyout-panel" role="menu">
                    <div className="model-menu-label">模型</div>
                    {MODEL_OPTIONS.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        role="menuitemradio"
                        aria-checked={option.id === model}
                        className="model-menu-item"
                        onClick={() => {
                          setModel(option.id);
                          close();
                        }}
                      >
                        <span>{option.label}</span>
                        {option.id === model && <Check size={14} className="model-menu-check" />}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="model-flyout-row" onMouseEnter={() => setSubmenu('speed')}>
              <button type="button" className="model-menu-item submenu-trigger">
                <span>速度</span>
                <ChevronRight size={14} className="model-menu-chevron" />
              </button>
              {submenu === 'speed' && (
                <div className="model-flyout">
                  <div className="model-flyout-panel" role="menu">
                    <div className="model-menu-label">速度</div>
                    {SPEED_OPTIONS.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        role="menuitemradio"
                        aria-checked={option.id === speed}
                        className="model-menu-item speed-item"
                        onClick={() => {
                          setSpeed(option.id as Speed);
                          close();
                        }}
                      >
                        <span className="speed-main">
                          {option.fast && <Zap size={13} className="speed-icon" />}
                          <span className="speed-text">
                            <span className="speed-title">{option.label}</span>
                            <span className="speed-sub">{option.description}</span>
                          </span>
                        </span>
                        {option.id === speed && <Check size={14} className="model-menu-check" />}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ coworker panel */

function FinanceCoworkerPanel({ onClose }: { onClose: () => void }) {
  const activeCoworkerId = useChatStore((state) => state.activeCoworkerId);
  const setActiveCoworker = useChatStore((state) => state.setActiveCoworker);
  const conversation = useCurrentConversation();

  return (
    <aside className="coworker-panel">
      <header className="coworker-header">
        <div>
          <h2>AI 同事面板</h2>
          <span>9 位同事在线</span>
        </div>
        <button className="icon-btn" type="button" onClick={onClose} aria-label="关闭面板">
          <PanelLeftOpen size={15} />
        </button>
      </header>

      <div className="coworker-scroll">
        {coworkers.map((coworker) => (
          <button
            key={coworker.id}
            className={`coworker-card ${coworker.id === activeCoworkerId ? 'active' : ''}`}
            type="button"
            onClick={() => setActiveCoworker(coworker.id)}
          >
            <span className="coworker-code">{coworker.code}</span>
            <span className="coworker-main">
              <strong>{coworker.name}</strong>
              <em>{coworker.role}</em>
            </span>
            <span className="coworker-status">{coworker.status}</span>
          </button>
        ))}
      </div>

      {conversation?.codexThreadId && (
        <div className="thread-chip">
          <span>Codex Thread</span>
          <code>{shortId(conversation.codexThreadId)}</code>
        </div>
      )}

      <div className="meeting-card">
        <strong>召集会议</strong>
        首版先把选中的同事写入提示词。多同事会议、工单审批和归档会在后续里程碑接入。
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ portfolio panel */

function PortfolioPanel({ onClose }: { onClose: () => void }) {
  const holdings = useChatStore((state) => state.holdings);
  const watchlist = useChatStore((state) => state.watchlist);
  const addHolding = useChatStore((state) => state.addHolding);
  const updateHolding = useChatStore((state) => state.updateHolding);
  const removeHolding = useChatStore((state) => state.removeHolding);
  const addWatchItem = useChatStore((state) => state.addWatchItem);
  const removeWatchItem = useChatStore((state) => state.removeWatchItem);

  const [tab, setTab] = useState<'holdings' | 'watchlist'>('holdings');

  return (
    <aside className="portfolio-panel">
      <header className="coworker-header">
        <div>
          <h2>持仓 / 自选</h2>
          <span>本地维护 · 仅作投研参考</span>
        </div>
        <button className="icon-btn" type="button" onClick={onClose} aria-label="关闭面板">
          <X size={15} />
        </button>
      </header>

      <div className="portfolio-tabs">
        <button
          type="button"
          className={tab === 'holdings' ? 'active' : ''}
          onClick={() => setTab('holdings')}
        >
          <Briefcase size={13} />
          <span>持仓{holdings.length ? ` · ${holdings.length}` : ''}</span>
        </button>
        <button
          type="button"
          className={tab === 'watchlist' ? 'active' : ''}
          onClick={() => setTab('watchlist')}
        >
          <Star size={13} />
          <span>自选{watchlist.length ? ` · ${watchlist.length}` : ''}</span>
        </button>
      </div>

      {tab === 'holdings' ? (
        <HoldingsTab
          holdings={holdings}
          onAdd={addHolding}
          onUpdate={updateHolding}
          onRemove={removeHolding}
        />
      ) : (
        <WatchlistTab watchlist={watchlist} onAdd={addWatchItem} onRemove={removeWatchItem} />
      )}

      <div className="portfolio-footer">
        <ShieldCheck size={12} />
        <span>仅本地记录，不接交易、不构成投资建议。</span>
      </div>
    </aside>
  );
}

function HoldingsTab({
  holdings,
  onAdd,
  onUpdate,
  onRemove,
}: {
  holdings: Holding[];
  onAdd: (input: Omit<Holding, 'id' | 'createdAt'>) => void;
  onUpdate: (id: string, patch: Partial<Omit<Holding, 'id' | 'createdAt'>>) => void;
  onRemove: (id: string) => void;
}) {
  const [adding, setAdding] = useState(false);

  const totals = useMemo(() => {
    const marketValue = holdings.reduce((sum, h) => sum + h.shares * h.price, 0);
    const cost = holdings.reduce((sum, h) => sum + h.shares * h.cost, 0);
    const pnl = marketValue - cost;
    const pnlPct = cost > 0 ? pnl / cost : 0;
    return { marketValue, cost, pnl, pnlPct };
  }, [holdings]);

  return (
    <div className="portfolio-scroll">
      <div className="pf-summary">
        <div className="pf-summary-main">
          <span className="pf-summary-label">总市值</span>
          <strong>{formatMoney(totals.marketValue)}</strong>
        </div>
        <div className="pf-summary-pnl">
          <span className="pf-summary-label">浮动盈亏</span>
          <strong className={pnlClass(totals.pnl)}>
            {formatSignedMoney(totals.pnl)}
            <em>{formatPct(totals.pnlPct)}</em>
          </strong>
        </div>
      </div>

      {adding ? (
        <HoldingForm
          onCancel={() => setAdding(false)}
          onSubmit={(input) => {
            onAdd(input);
            setAdding(false);
          }}
        />
      ) : (
        <button type="button" className="pf-add-btn" onClick={() => setAdding(true)}>
          <Plus size={14} />
          <span>添加持仓</span>
        </button>
      )}

      {holdings.length === 0 ? (
        <div className="pf-empty">还没有持仓记录，点击上方按钮添加。</div>
      ) : (
        <div className="pf-list">
          {holdings.map((holding) => (
            <HoldingRow
              key={holding.id}
              holding={holding}
              onUpdate={(patch) => onUpdate(holding.id, patch)}
              onRemove={() => onRemove(holding.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function HoldingRow({
  holding,
  onUpdate,
  onRemove,
}: {
  holding: Holding;
  onUpdate: (patch: Partial<Omit<Holding, 'id' | 'createdAt'>>) => void;
  onRemove: () => void;
}) {
  const marketValue = holding.shares * holding.price;
  const pnl = (holding.price - holding.cost) * holding.shares;
  const pnlPct = holding.cost > 0 ? (holding.price - holding.cost) / holding.cost : 0;

  return (
    <div className="pf-card">
      <div className="pf-card-head">
        <div className="pf-name">
          <strong>{holding.name || holding.code}</strong>
          {holding.name && <span className="pf-code">{holding.code}</span>}
        </div>
        <button
          type="button"
          className="pf-remove"
          onClick={onRemove}
          aria-label="删除持仓"
          title="删除"
        >
          <Trash2 size={13} />
        </button>
      </div>

      <div className="pf-fields">
        <label className="pf-field">
          <span>股数</span>
          <EditableNumber value={holding.shares} onCommit={(shares) => onUpdate({ shares })} />
        </label>
        <label className="pf-field">
          <span>成本</span>
          <EditableNumber value={holding.cost} onCommit={(cost) => onUpdate({ cost })} />
        </label>
        <label className="pf-field">
          <span>现价</span>
          <EditableNumber value={holding.price} onCommit={(price) => onUpdate({ price })} />
        </label>
      </div>

      <div className="pf-card-foot">
        <span className="pf-mv">市值 {formatMoney(marketValue)}</span>
        <span className={`pf-pnl ${pnlClass(pnl)}`}>
          {formatSignedMoney(pnl)} · {formatPct(pnlPct)}
        </span>
      </div>
    </div>
  );
}

function HoldingForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (input: Omit<Holding, 'id' | 'createdAt'>) => void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [shares, setShares] = useState('');
  const [cost, setCost] = useState('');
  const [price, setPrice] = useState('');

  const submit = () => {
    if (!code.trim()) return;
    onSubmit({
      code,
      name,
      shares: Number(shares) || 0,
      cost: Number(cost) || 0,
      price: Number(price) || Number(cost) || 0,
    });
  };

  return (
    <div className="pf-form">
      <div className="pf-form-row">
        <input
          className="pf-input"
          placeholder="代码 (如 600519)"
          value={code}
          autoFocus
          onChange={(e) => setCode(e.target.value)}
        />
        <input
          className="pf-input"
          placeholder="名称"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="pf-form-row">
        <input
          className="pf-input"
          inputMode="decimal"
          placeholder="股数"
          value={shares}
          onChange={(e) => setShares(e.target.value)}
        />
        <input
          className="pf-input"
          inputMode="decimal"
          placeholder="成本价"
          value={cost}
          onChange={(e) => setCost(e.target.value)}
        />
        <input
          className="pf-input"
          inputMode="decimal"
          placeholder="现价"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
      </div>
      <div className="pf-form-actions">
        <button type="button" className="pf-btn ghost" onClick={onCancel}>
          取消
        </button>
        <button type="button" className="pf-btn primary" onClick={submit} disabled={!code.trim()}>
          添加
        </button>
      </div>
    </div>
  );
}

function WatchlistTab({
  watchlist,
  onAdd,
  onRemove,
}: {
  watchlist: WatchItem[];
  onAdd: (input: Omit<WatchItem, 'id' | 'createdAt'>) => void;
  onRemove: (id: string) => void;
}) {
  const [adding, setAdding] = useState(false);

  return (
    <div className="portfolio-scroll">
      {adding ? (
        <WatchForm
          onCancel={() => setAdding(false)}
          onSubmit={(input) => {
            onAdd(input);
            setAdding(false);
          }}
        />
      ) : (
        <button type="button" className="pf-add-btn" onClick={() => setAdding(true)}>
          <Plus size={14} />
          <span>添加自选</span>
        </button>
      )}

      {watchlist.length === 0 ? (
        <div className="pf-empty">还没有自选标的，点击上方按钮添加。</div>
      ) : (
        <div className="pf-list">
          {watchlist.map((item) => (
            <div key={item.id} className="pf-watch">
              <div className="pf-name">
                <strong>{item.name || item.code}</strong>
                {item.name && <span className="pf-code">{item.code}</span>}
              </div>
              {item.note && <span className="pf-watch-note">{item.note}</span>}
              <button
                type="button"
                className="pf-remove"
                onClick={() => onRemove(item.id)}
                aria-label="删除自选"
                title="删除"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WatchForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (input: Omit<WatchItem, 'id' | 'createdAt'>) => void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [note, setNote] = useState('');

  const submit = () => {
    if (!code.trim()) return;
    onSubmit({ code, name, note: note.trim() || undefined });
  };

  return (
    <div className="pf-form">
      <div className="pf-form-row">
        <input
          className="pf-input"
          placeholder="代码 (如 600519)"
          value={code}
          autoFocus
          onChange={(e) => setCode(e.target.value)}
        />
        <input
          className="pf-input"
          placeholder="名称"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="pf-form-row">
        <input
          className="pf-input"
          placeholder="关注理由 / 备注 (可选)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      <div className="pf-form-actions">
        <button type="button" className="pf-btn ghost" onClick={onCancel}>
          取消
        </button>
        <button type="button" className="pf-btn primary" onClick={submit} disabled={!code.trim()}>
          添加
        </button>
      </div>
    </div>
  );
}

function EditableNumber({
  value,
  onCommit,
}: {
  value: number;
  onCommit: (value: number) => void;
}) {
  const [text, setText] = useState(() => formatNumberInput(value));

  useEffect(() => {
    setText(formatNumberInput(value));
  }, [value]);

  const commit = () => {
    const next = Number(text);
    onCommit(Number.isFinite(next) ? next : 0);
  };

  return (
    <input
      className="pf-input"
      inputMode="decimal"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

/* ------------------------------------------------------------------ helpers */

interface ConversationGroup {
  label: string;
  items: Conversation[];
}

function groupStandaloneConversations(
  conversations: Conversation[],
  sort: ProjectSort,
): ConversationGroup[] {
  const rest = conversations.filter((conversation) => !conversation.pinned);
  const groups: ConversationGroup[] = [];

  if (sort === 'name') {
    if (rest.length > 0) groups.push({ label: '', items: sortConversations(rest, sort) });
  } else {
    groups.push(...groupConversationsByDate(rest, sort === 'created' ? 'createdAt' : 'updatedAt'));
  }

  return groups;
}

function sortConversations(conversations: Conversation[], sort: ProjectSort): Conversation[] {
  return [...conversations].sort((a, b) => {
    if (sort === 'name') return a.title.localeCompare(b.title, 'zh-CN');
    if (sort === 'created') return b.createdAt - a.createdAt;
    return b.updatedAt - a.updatedAt;
  });
}

function groupConversationsByDate(
  conversations: Conversation[],
  key: 'updatedAt' | 'createdAt' = 'updatedAt',
): ConversationGroup[] {
  const sorted = [...conversations].sort((a, b) => b[key] - a[key]);
  const now = Date.now();
  const dayMs = 86_400_000;
  const buckets: ConversationGroup[] = [
    { label: '今天', items: [] },
    { label: '昨天', items: [] },
    { label: '过去 7 天', items: [] },
    { label: '更早', items: [] },
  ];
  for (const item of sorted) {
    const stamp = item[key];
    const diff = now - stamp;
    if (diff < dayMs && new Date(stamp).getDate() === new Date(now).getDate()) {
      buckets[0].items.push(item);
    } else if (diff < dayMs * 2) {
      buckets[1].items.push(item);
    } else if (diff < dayMs * 7) {
      buckets[2].items.push(item);
    } else {
      buckets[3].items.push(item);
    }
  }
  return buckets.filter((bucket) => bucket.items.length > 0);
}

function formatRelative(value: number): string {
  const diff = Date.now() - value;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}小时`;
  if (diff < 86_400_000 * 7) return `${Math.floor(diff / 86_400_000)}天`;
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(value);
}

function formatClock(value: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(value);
}

function shortenPath(value: string): string {
  if (!value) return '未指定目录';
  const parts = value.split('/').filter(Boolean);
  if (parts.length <= 2) return value;
  return `…/${parts.slice(-2).join('/')}`;
}

function shortId(value: string): string {
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || path;
}

function formatMoney(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return value.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}

function formatSignedMoney(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${formatMoney(value)}`;
}

function formatPct(value: number): string {
  if (!Number.isFinite(value)) return '0.00%';
  const sign = value > 0 ? '+' : '';
  return `${sign}${(value * 100).toFixed(2)}%`;
}

function pnlClass(value: number): string {
  if (value > 0) return 'up';
  if (value < 0) return 'down';
  return 'flat';
}

function formatNumberInput(value: number): string {
  if (!Number.isFinite(value) || value === 0) return value === 0 ? '0' : '';
  return String(value);
}

async function pickFolder(): Promise<string | null> {
  if (isTauriRuntime()) {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({ directory: true, multiple: false, title: '选择工作目录' });
      return typeof selected === 'string' ? selected : null;
    } catch {
      return null;
    }
  }
  const manual = window.prompt('输入工作目录的绝对路径（浏览器预览模式）');
  return manual && manual.trim() ? manual.trim() : null;
}
