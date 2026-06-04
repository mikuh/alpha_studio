import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type {
  ChangeEvent,
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  AlertCircle,
  AppWindow,
  Archive,
  ArrowDownAZ,
  ArrowDownUp,
  ArrowUp,
  Bot,
  Box,
  Braces,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Clock3,
  Code2,
  Copy,
  Cpu,
  Download,
  FileCode2,
  FileText,
  Folder,
  FolderGit2,
  FolderInput,
  FolderOpen,
  FolderPlus,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  Github,
  Globe,
  HardDrive,
  History,
  Info,
  Keyboard,
  Layers,
  ListChecks,
  Loader2,
  Lock,
  MessageCircle,
  MessageSquare,
  MessageSquarePlus,
  Mic,
  Monitor,
  Moon,
  MoreHorizontal,
  Network,
  PanelBottom,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRight,
  Pencil,
  Pin,
  PinOff,
  Plug,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  ShieldCheck,
  ShieldQuestion,
  SlidersHorizontal,
  Sparkles,
  Square,
  SquarePen,
  SquareTerminal,
  Sun,
  Terminal,
  Trash2,
  Upload,
  UserCircle,
  Workflow,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import {
  ghAuthStatus,
  gitBranches,
  gitCheckoutBranch,
  gitCommit,
  gitCreateBranch,
  gitDiff,
  gitDiffStat,
  gitPull,
  gitPush,
  gitRemotes,
  gitStage,
  gitStatus,
  gitUnstage,
  isTauriRuntime,
  listOpenApps,
  openInApp,
  revealPath,
  subscribeCodexEvents,
  subscribeTerminalEvents,
  terminalStart,
  terminalStop,
  terminalWrite,
} from './codexBridge';
import { activeDomain } from './domain';
import {
  APPROVAL_OPTIONS,
  EFFORT_OPTIONS,
  MODEL_OPTIONS,
  SPEED_OPTIONS,
  approvalDescription,
  approvalLabel,
  effortLabel,
  modelLabel,
  shortModelLabel,
  type ApprovalMode,
  type ReasoningEffort,
  type Speed,
} from './models';
import {
  activeConversations,
  activeProjects,
  archivedConversations,
  archivedProjects,
  useChatStore,
  useCurrentConversation,
  visibleConversations,
} from './store';
import type {
  ChatMessage,
  Conversation,
  GhAuthStatus,
  GitBranch as GitBranchInfo,
  GitDiffStat,
  GitFileChange,
  GitRemote,
  GitStatus,
  MessageBlock,
  OpenAppId,
  Project,
  ProjectSort,
} from './types';

type RightPanel = 'none' | 'git' | 'features';
type Theme = 'light' | 'dark';
type SettingsSection =
  | 'general'
  | 'profile'
  | 'appearance'
  | 'config'
  | 'personalization'
  | 'keyboard'
  | 'usage'
  | 'snapshots'
  | 'mcp'
  | 'browser'
  | 'computer'
  | 'hooks'
  | 'connections'
  | 'git'
  | 'environment'
  | 'worktrees'
  | 'archived';

const domain = activeDomain();
const SIDEBAR_WIDTH_KEY = 'alpha:codex-sidebar-width';
const THEME_KEY = 'alpha:codex-theme';
const THEME_RESTORE_KEY = 'alpha:codex-theme-restored-main-ui-v2';
const SIDEBAR_MIN_WIDTH = 244;
const SIDEBAR_MAX_WIDTH = 420;
const SIDEBAR_DEFAULT_WIDTH = 300;

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
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('general');
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === 'undefined') return 'dark';
    const saved = window.localStorage.getItem(THEME_KEY);
    if (!window.localStorage.getItem(THEME_RESTORE_KEY)) {
      window.localStorage.setItem(THEME_RESTORE_KEY, '1');
      if (saved === 'light') return 'dark';
    }
    return saved === 'dark' || saved === 'light' ? saved : 'dark';
  });
  const [windowFocused, setWindowFocused] = useState(true);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(THEME_KEY, theme);
    if (isTauriRuntime()) {
      void import('@tauri-apps/api/window')
        .then(({ getCurrentWindow }) => getCurrentWindow().setTheme(theme))
        .catch(() => undefined);
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
          .onFocusChanged(({ payload }) => setWindowFocused(payload))
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
    const active = activeConversations(conversations);
    if ((!currentConversationId || !active.some((item) => item.id === currentConversationId)) && active[0]) {
      setCurrentConversation(active[0].id);
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
    return () => unlisten?.();
  }, [handleCodexEvent]);

  const openSettings = (section: SettingsSection = 'general') => {
    setSettingsSection(section);
    setSettingsOpen(true);
  };

  return (
    <div
      className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''} ${windowFocused ? '' : 'window-inactive'}`}
      style={{ ['--sidebar-width']: `${sidebarWidth}px` } as CSSProperties}
    >
      <Sidebar
        collapsed={sidebarCollapsed}
        onCollapse={() => setSidebarCollapsed(true)}
        onOpenSettings={openSettings}
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
          featuresOpen={rightPanel === 'features'}
          terminalOpen={terminalOpen}
          onToggleSidebar={() => setSidebarCollapsed((value) => !value)}
          onToggleFeatures={() => setRightPanel((value) => (value === 'features' ? 'none' : 'features'))}
          onToggleTerminal={() => setTerminalOpen((value) => !value)}
          onOpenGit={() => setRightPanel('git')}
          onOpenSettings={() => openSettings('config')}
        />
        <ChatArea />
        {terminalOpen && <BottomTerminal onClose={() => setTerminalOpen(false)} />}
      </main>
      {rightPanel === 'git' && <GitPanel onClose={() => setRightPanel('none')} />}
      {rightPanel === 'features' && (
        <FeaturesPanel
          onClose={() => setRightPanel('none')}
          onOpenGit={() => setRightPanel('git')}
          onOpenTerminal={() => setTerminalOpen(true)}
        />
      )}
      <SettingsPage
        open={settingsOpen}
        section={settingsSection}
        onSectionChange={setSettingsSection}
        onClose={() => setSettingsOpen(false)}
        theme={theme}
        onThemeChange={setTheme}
      />
      <AuthorizationDialog />
    </div>
  );
}

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
  const drag = useRef<{ x: number; w: number; shell: HTMLElement | null }>({ x: 0, w: 0, shell: null });
  const [active, setActive] = useState(false);

  const commitWidth = (next: number) => onCommit(Math.min(max, Math.max(min, next)));
  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const shell = event.currentTarget.closest('.app-shell') as HTMLElement | null;
    const sidebar = shell?.querySelector('.sidebar') as HTMLElement | null;
    drag.current = { x: event.clientX, w: sidebar?.getBoundingClientRect().width || defaultWidth, shell };
    setActive(true);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!active) return;
    const next = drag.current.w + event.clientX - drag.current.x;
    commitWidth(next);
  };
  const finish = () => {
    setActive(false);
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
  };

  return (
    <div
      className={`sidebar-resizer ${active ? 'active' : ''}`}
      role="separator"
      aria-orientation="vertical"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onDoubleClick={() => onCommit(defaultWidth)}
    />
  );
}

function Sidebar({
  collapsed,
  onCollapse,
  onOpenSettings,
}: {
  collapsed: boolean;
  onCollapse: () => void;
  onOpenSettings: (section?: SettingsSection) => void;
}) {
  const conversations = useChatStore((state) => state.conversations);
  const projects = useChatStore((state) => state.projects);
  const currentConversationId = useChatStore((state) => state.currentConversationId);
  const createConversation = useChatStore((state) => state.createConversation);
  const setCurrentConversation = useChatStore((state) => state.setCurrentConversation);
  const archiveConversation = useChatStore((state) => state.archiveConversation);
  const archiveStandaloneConversations = useChatStore((state) => state.archiveStandaloneConversations);
  const renameConversation = useChatStore((state) => state.renameConversation);
  const toggleConversationPin = useChatStore((state) => state.toggleConversationPin);
  const createProject = useChatStore((state) => state.createProject);
  const renameProject = useChatStore((state) => state.renameProject);
  const setProjectCwd = useChatStore((state) => state.setProjectCwd);
  const toggleProjectPin = useChatStore((state) => state.toggleProjectPin);
  const archiveProject = useChatStore((state) => state.archiveProject);
  const projectSort = useChatStore((state) => state.projectSort);
  const setProjectSort = useChatStore((state) => state.setProjectSort);
  const conversationSort = useChatStore((state) => state.conversationSort);
  const setConversationSort = useChatStore((state) => state.setConversationSort);

  // Only conversations with at least one message show up in the sidebar; unsent
  // drafts stay hidden (like Codex) until the user sends their first message.
  const liveConversations = useMemo(() => visibleConversations(conversations), [conversations]);
  const liveProjects = useMemo(() => activeProjects(projects), [projects]);
  const pinnedConversations = useMemo(
    () => sortConversations(liveConversations.filter((conversation) => conversation.pinned), conversationSort),
    [liveConversations, conversationSort],
  );
  const standalone = useMemo(
    () => liveConversations.filter((conversation) => !conversation.projectId && !conversation.pinned),
    [liveConversations],
  );
  const sortedStandalone = useMemo(() => sortConversations(standalone, conversationSort), [standalone, conversationSort]);
  const sortedProjects = useMemo(() => sortProjects(liveProjects, projectSort), [liveProjects, projectSort]);

  const [searchOpen, setSearchOpen] = useState(false);
  const [menu, setMenu] = useState<SidebarMenu | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingConversationId, setEditingConversationId] = useState<string | null>(null);
  const [conversationsCollapsed, setConversationsCollapsed] = useState(false);

  // "新对话" should land wherever the user currently is: if the active conversation
  // belongs to a project, create the new one inside that project; otherwise keep it
  // in the uncategorized "对话" list.
  const createConversationInContext = useCallback(() => {
    const state = useChatStore.getState();
    const current = state.conversations.find((item) => item.id === state.currentConversationId);
    const projectId = current && !current.archivedAt ? current.projectId : undefined;
    const id = createConversation(projectId);
    if (projectId) {
      setExpanded((prev) => ({ ...prev, [projectId]: true }));
    }
    return id;
  }, [createConversation]);

  useEffect(() => {
    const handleKeyDown = (event: WindowEventMap['keydown']) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      }
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        createConversationInContext();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [createConversationInContext]);

  const openNewProjectMenu = (event: ReactMouseEvent) => {
    setMenu({
      owner: 'add',
      ...anchorFromButton(event),
      items: [
        {
          kind: 'item',
          icon: <FolderPlus size={15} />,
          label: '新建空白项目',
          onSelect: () => {
            const id = createProject();
            setExpanded((prev) => ({ ...prev, [id]: true }));
            setEditingProjectId(id);
          },
        },
        {
          kind: 'item',
          icon: <FolderOpen size={15} />,
          label: '使用现有文件夹',
          onSelect: () => void handleUseExistingFolder(),
        },
      ],
    });
  };

  const handleUseExistingFolder = async () => {
    const dir = await pickFolder();
    if (!dir) return;
    const id = createProject({ name: basename(dir), cwd: dir });
    setExpanded((prev) => ({ ...prev, [id]: true }));
    createConversation(id);
  };

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
        { kind: 'item', icon: <FolderOpen size={15} />, label: '在访达中打开', onSelect: () => void revealOrPickProject(project) },
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
        { kind: 'item', icon: <Archive size={15} />, label: '归档项目', danger: true, onSelect: () => archiveProject(project.id) },
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
        { kind: 'item', icon: <FolderOpen size={15} />, label: '在访达中打开', disabled: !conversation.cwd, onSelect: () => void revealPath(conversation.cwd) },
        { kind: 'item', icon: <Pencil size={15} />, label: '重命名', onSelect: () => setEditingConversationId(conversation.id) },
        { kind: 'separator' },
        { kind: 'item', icon: <Archive size={15} />, label: '归档对话', danger: true, onSelect: () => archiveConversation(conversation.id) },
      ],
    });
  };

  const openProjectSectionMenu = (event: ReactMouseEvent) => {
    const anyExpanded = liveProjects.some((project) => expanded[project.id]);
    setMenu({
      owner: 'project-section',
      ...anchorFromButton(event),
      items: [
        { kind: 'item', icon: anyExpanded ? <ChevronsDownUp size={15} /> : <ChevronsUpDown size={15} />, label: anyExpanded ? '全部收起' : '全部展开', onSelect: () => setExpanded(anyExpanded ? {} : Object.fromEntries(liveProjects.map((project) => [project.id, true]))) },
        { kind: 'separator' },
        sortSubmenu(projectSort, setProjectSort),
      ],
    });
  };

  const openConversationSectionMenu = (event: ReactMouseEvent) => {
    setMenu({
      owner: 'conversation-section',
      ...anchorFromButton(event),
      items: [
        { kind: 'item', icon: <Archive size={15} />, label: '归档未归类对话', danger: true, disabled: standalone.length === 0, onSelect: archiveStandaloneConversations },
        { kind: 'item', icon: conversationsCollapsed ? <ChevronsUpDown size={15} /> : <ChevronsDownUp size={15} />, label: conversationsCollapsed ? '展开对话列表' : '收起对话列表', onSelect: () => setConversationsCollapsed((value) => !value) },
        { kind: 'separator' },
        sortSubmenu(conversationSort, setConversationSort),
      ],
    });
  };

  const chooseProjectFolder = async (project: Project) => {
    const dir = await pickFolder();
    if (dir) setProjectCwd(project.id, dir);
  };

  const revealOrPickProject = async (project: Project) => {
    if (project.cwd && (await revealPath(project.cwd))) return;
    await chooseProjectFolder(project);
  };

  return (
    <>
      <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`} aria-hidden={collapsed}>
        <div className="sidebar-traffic" data-tauri-drag-region>
          <button className="sidebar-collapse-btn" type="button" onClick={onCollapse} aria-label="收起侧栏" title="收起侧栏">
            <PanelLeftClose size={16} />
          </button>
        </div>
        <div className="sidebar-scroll">
          <div className="sidebar-menu-panel nav-menu">
            <button className="nav-item primary" type="button" onClick={() => createConversationInContext()}>
              <SquarePen size={15} />
              <span className="nav-label">新对话</span>
            </button>
            <button className={`nav-item ${searchOpen ? 'active' : ''}`} type="button" onClick={() => setSearchOpen(true)}>
              <Search size={15} />
              <span className="nav-label">搜索</span>
              <span className="nav-shortcut">⌘K</span>
            </button>
          </div>

          {pinnedConversations.length > 0 && (
            <>
              <SectionLabel>置顶</SectionLabel>
              <div className="sidebar-menu-panel conv-group">
                {pinnedConversations.map((conversation) => (
                  <ConversationRow
                    key={conversation.id}
                    conversation={conversation}
                    active={conversation.id === currentConversationId}
                    editing={editingConversationId === conversation.id}
                    menuOpen={menu?.owner === conversation.id}
                    onSelect={() => setCurrentConversation(conversation.id)}
                    onOpenMenu={(anchor) => openConversationMenu(conversation, anchor)}
                    onCommitRename={(name) => {
                      renameConversation(conversation.id, name);
                      setEditingConversationId(null);
                    }}
                    onCancelRename={() => setEditingConversationId(null)}
                  />
                ))}
              </div>
            </>
          )}

          <SidebarHead label="项目" menuOpen={menu?.owner === 'project-section' || menu?.owner === 'add'}>
            <button className="group-action" type="button" onClick={openProjectSectionMenu} aria-label="项目排序与整理" title="排序与整理">
              <MoreHorizontal size={15} />
            </button>
            <button className="group-action" type="button" onClick={openNewProjectMenu} aria-label="新建项目" title="新建项目">
              <FolderInput size={15} />
            </button>
          </SidebarHead>
          <div className="sidebar-menu-panel project-menu">
            {sortedProjects.length === 0 ? (
              <div className="sidebar-hint">用项目把对话绑定到本地工作目录</div>
            ) : (
              sortedProjects.map((project) => (
                <ProjectItem
                  key={project.id}
                  project={project}
                  expanded={Boolean(expanded[project.id])}
                  editing={editingProjectId === project.id}
                  menuOpen={menu?.owner === project.id}
                  conversations={sortConversations(liveConversations.filter((conversation) => conversation.projectId === project.id && !conversation.pinned), conversationSort)}
                  currentConversationId={currentConversationId}
                  editingConversationId={editingConversationId}
                  activeMenuId={menu?.owner ?? null}
                  onToggle={() => setExpanded((prev) => ({ ...prev, [project.id]: !prev[project.id] }))}
                  onNewConversation={() => {
                    setExpanded((prev) => ({ ...prev, [project.id]: true }));
                    createConversation(project.id);
                  }}
                  onSelectConversation={setCurrentConversation}
                  onOpenConversationMenu={openConversationMenu}
                  onCommitConversationRename={(id, name) => {
                    renameConversation(id, name);
                    setEditingConversationId(null);
                  }}
                  onCancelConversationRename={() => setEditingConversationId(null)}
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

          <SidebarHead label="对话" menuOpen={menu?.owner === 'conversation-section'}>
            <button className="group-action" type="button" onClick={() => setConversationsCollapsed((value) => !value)} aria-label="展开或收起对话">
              {conversationsCollapsed ? <ChevronsUpDown size={15} /> : <ChevronsDownUp size={15} />}
            </button>
            <button className="group-action" type="button" onClick={openConversationSectionMenu} aria-label="对话排序与整理">
              <MoreHorizontal size={15} />
            </button>
            <button className="group-action" type="button" onClick={() => createConversation()} aria-label="新建对话">
              <SquarePen size={15} />
            </button>
          </SidebarHead>
          {!conversationsCollapsed && (
            <div className="sidebar-menu-panel conv-group">
              {sortedStandalone.length === 0 ? (
                <div className="sidebar-hint">暂无未归类的对话</div>
              ) : (
                sortedStandalone.map((conversation) => (
                  <ConversationRow
                    key={conversation.id}
                    conversation={conversation}
                    active={conversation.id === currentConversationId}
                    editing={editingConversationId === conversation.id}
                    menuOpen={menu?.owner === conversation.id}
                    onSelect={() => setCurrentConversation(conversation.id)}
                    onOpenMenu={(anchor) => openConversationMenu(conversation, anchor)}
                    onCommitRename={(name) => {
                      renameConversation(conversation.id, name);
                      setEditingConversationId(null);
                    }}
                    onCancelRename={() => setEditingConversationId(null)}
                  />
                ))
              )}
            </div>
          )}
        </div>
        <div className="sidebar-footer">
          <button className="nav-item settings-entry" type="button" onClick={() => onOpenSettings('general')}>
            <Settings size={15} />
            <span className="nav-label">设置</span>
          </button>
        </div>
      </aside>
      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
      <SearchDialog
        open={searchOpen}
        conversations={liveConversations}
        projects={liveProjects}
        currentConversationId={currentConversationId}
        onClose={() => setSearchOpen(false)}
        onSelectConversation={(id) => {
          setCurrentConversation(id);
          setSearchOpen(false);
        }}
        onOpenProject={(id) => {
          const latest = liveConversations.filter((conversation) => conversation.projectId === id).sort((a, b) => b.updatedAt - a.updatedAt)[0];
          if (latest) setCurrentConversation(latest.id);
          else createConversation(id);
          setExpanded((prev) => ({ ...prev, [id]: true }));
          setSearchOpen(false);
        }}
        onNewConversation={() => {
          createConversation();
          setSearchOpen(false);
        }}
      />
    </>
  );
}

function SidebarHead({ label, menuOpen, children }: { label: string; menuOpen?: boolean; children: ReactNode }) {
  return (
    <div className={`sidebar-group-head ${menuOpen ? 'menu-open' : ''}`}>
      <span className="sidebar-group-label">{label}</span>
      <span className="sidebar-group-actions">{children}</span>
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="sidebar-section-label">{children}</div>;
}

function ConversationRow({
  conversation,
  active,
  nested,
  menuOpen,
  editing,
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
  onSelect: () => void;
  onOpenMenu: (anchor: MenuAnchor) => void;
  onCommitRename: (name: string) => void;
  onCancelRename: () => void;
}) {
  const archiveConversation = useChatStore((state) => state.archiveConversation);
  const toggleConversationPin = useChatStore((state) => state.toggleConversationPin);
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
        <NameInput defaultValue={conversation.title} onCommit={onCommitRename} onCancel={onCancelRename} />
      ) : (
        <span className="conv-title">{conversation.title}</span>
      )}
      {!editing && conversation.pinned && <Pin size={10} className="conv-pin" />}
      {!editing && (
        <span className={`conv-time ${streaming ? 'streaming' : ''}`}>
          {streaming ? <Loader2 size={12} className="spin" /> : formatRelative(conversation.updatedAt)}
        </span>
      )}
      {!editing && (
        <span className="conv-actions" onClick={(event) => event.stopPropagation()}>
          <button className="row-icon-btn" type="button" onClick={() => toggleConversationPin(conversation.id)} aria-label="置顶对话" title={conversation.pinned ? '取消置顶' : '置顶'}>
            {conversation.pinned ? <PinOff size={14} /> : <Pin size={14} />}
          </button>
          <button className="row-icon-btn" type="button" onClick={() => archiveConversation(conversation.id)} aria-label="归档对话" title="归档">
            <Archive size={14} />
          </button>
        </span>
      )}
    </div>
  );
}

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
        {expanded ? <FolderOpen size={15} /> : <Folder size={15} />}
        {editing ? (
          <NameInput defaultValue={project.name} onCommit={onCommitRename} onCancel={onCancelRename} />
        ) : (
          <span className="project-name" title={project.cwd || '未指定工作目录'}>{project.name}</span>
        )}
        {!editing && project.pinned && <Pin size={11} className="project-pin" />}
        {!editing && (
          <span className="project-actions" onClick={(event) => event.stopPropagation()}>
            <button className="row-icon-btn" type="button" onClick={onNewConversation} aria-label="在项目中新建对话" title="新建对话">
              <SquarePen size={13} />
            </button>
            <button className={`row-icon-btn ${menuOpen ? 'active' : ''}`} type="button" onClick={(event) => onOpenMenu(anchorFromButton(event))} aria-label="项目操作" title="更多">
              <MoreHorizontal size={15} />
            </button>
          </span>
        )}
      </div>
      {expanded && (
        <div className="project-children">
          {conversations.length === 0 ? (
            <div className="project-empty">暂无对话</div>
          ) : (
            conversations.map((conversation) => (
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
        </div>
      )}
    </div>
  );
}

function NameInput({
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
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit();
        if (event.key === 'Escape') cancel();
      }}
    />
  );
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
  const conversationResults = conversations
    .filter((conversation) => [conversation.title, conversation.cwd].some((value) => value?.toLowerCase().includes(normalized)))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 8);
  const projectResults = projects
    .filter((project) => [project.name, project.cwd].some((value) => value?.toLowerCase().includes(normalized)))
    .slice(0, 6);

  if (!open) return null;

  return (
    <div className="dialog-layer" role="presentation">
      <button className="dialog-backdrop" type="button" aria-label="关闭搜索" onClick={onClose} />
      <section className="command-dialog" role="dialog" aria-modal="true" aria-label="搜索">
        <div className="command-input-row">
          <Search size={16} />
          <input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索对话、项目或工作目录" />
          <button type="button" className="icon-mini" onClick={onClose} aria-label="关闭搜索"><X size={14} /></button>
        </div>
        <div className="command-content">
          <button type="button" className="command-result new" onClick={onNewConversation}>
            <Plus size={15} />
            <span><strong>新对话</strong><em>从空白上下文开始</em></span>
          </button>
          {projectResults.length > 0 && <CommandSection label="项目">{projectResults.map((project) => (
            <button key={project.id} type="button" className="command-result" onClick={() => onOpenProject(project.id)}>
              <Folder size={15} />
              <span><strong>{project.name}</strong><em>{project.cwd ? shortenPath(project.cwd) : '未指定目录'}</em></span>
            </button>
          ))}</CommandSection>}
          {conversationResults.length > 0 && <CommandSection label={normalized ? '匹配对话' : '最近对话'}>{conversationResults.map((conversation) => (
            <button key={conversation.id} type="button" className={`command-result ${conversation.id === currentConversationId ? 'active' : ''}`} onClick={() => onSelectConversation(conversation.id)}>
              {conversation.status === 'streaming' ? <Loader2 size={15} className="spin" /> : <MessageSquare size={15} />}
              <span><strong>{conversation.title}</strong><em>{conversation.cwd ? shortenPath(conversation.cwd) : '未指定目录'} · {formatRelative(conversation.updatedAt)}</em></span>
            </button>
          ))}</CommandSection>}
          {projectResults.length === 0 && conversationResults.length === 0 && <div className="command-empty"><Search size={16} /><span>没有匹配结果</span></div>}
        </div>
      </section>
    </div>
  );
}

function CommandSection({ label, children }: { label: string; children: ReactNode }) {
  return <div className="command-section"><div className="command-section-label">{label}</div>{children}</div>;
}

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
  event.stopPropagation();
  const rect = event.currentTarget.getBoundingClientRect();
  return { x: rect.left, y: rect.bottom + 6 };
}

function anchorFromCursor(event: ReactMouseEvent): MenuAnchor {
  return { x: event.clientX, y: event.clientY };
}

function ContextMenu({ menu, onClose }: { menu: SidebarMenu; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: menu.x, top: menu.y });
  useLayoutEffect(() => {
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pad = 10;
    setPos({
      left: Math.min(menu.x, window.innerWidth - rect.width - pad),
      top: Math.min(menu.y, window.innerHeight - rect.height - pad),
    });
  }, [menu]);
  useEffect(() => {
    const onKey = (event: WindowEventMap['keydown']) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const run = (action: () => void) => {
    onClose();
    action();
  };
  return (
    <>
      <button className="menu-backdrop" type="button" aria-label="关闭菜单" onClick={onClose} />
      <div ref={panelRef} className="cmenu" role="menu" style={{ left: pos.left, top: pos.top }}>
        {menu.items.map((node, index) => <MenuRow key={index} node={node} onRun={run} />)}
      </div>
    </>
  );
}

function MenuRow({ node, onRun }: { node: MenuNode; onRun: (action: () => void) => void }) {
  const [subOpen, setSubOpen] = useState(false);
  if (node.kind === 'separator') return <div className="cmenu-sep" role="separator" />;
  if (node.kind === 'submenu') {
    return (
      <div className="cmenu-subwrap" onMouseEnter={() => setSubOpen(true)} onMouseLeave={() => setSubOpen(false)}>
        <button type="button" className={`cmenu-item ${subOpen ? 'active' : ''}`} role="menuitem">
          <span className="cmenu-icon">{node.icon}</span><span className="cmenu-label">{node.label}</span><ChevronRight size={14} className="cmenu-chevron" />
        </button>
        {subOpen && <div className="cmenu-flyout"><div className="cmenu" role="menu">{node.children.map((child, index) => <MenuRow key={index} node={child} onRun={onRun} />)}</div></div>}
      </div>
    );
  }
  if (node.kind === 'radio') {
    return (
      <button type="button" className="cmenu-item" role="menuitemradio" aria-checked={node.checked} onClick={() => onRun(node.onSelect)}>
        <span className="cmenu-icon">{node.icon}</span><span className="cmenu-label">{node.label}</span>{node.checked && <Check size={15} className="cmenu-check" />}
      </button>
    );
  }
  return (
    <button type="button" className={`cmenu-item ${node.danger ? 'danger' : ''}`} role="menuitem" disabled={node.disabled} onClick={() => onRun(node.onSelect)}>
      <span className="cmenu-icon">{node.icon}</span><span className="cmenu-label">{node.label}</span>{node.shortcut && <span className="cmenu-shortcut">{node.shortcut}</span>}
    </button>
  );
}

function sortSubmenu(value: ProjectSort, onChange: (sort: ProjectSort) => void): MenuNode {
  return {
    kind: 'submenu',
    icon: <ArrowDownUp size={15} />,
    label: '排序条件',
    children: [
      { kind: 'radio', icon: <Clock3 size={15} />, label: '更新时间', checked: value === 'updated', onSelect: () => onChange('updated') },
      { kind: 'radio', icon: <CalendarDays size={15} />, label: '创建时间', checked: value === 'created', onSelect: () => onChange('created') },
      { kind: 'radio', icon: <ArrowDownAZ size={15} />, label: '名称', checked: value === 'name', onSelect: () => onChange('name') },
    ],
  };
}

function TopBar({
  sidebarCollapsed,
  featuresOpen,
  terminalOpen,
  onToggleSidebar,
  onToggleFeatures,
  onToggleTerminal,
  onOpenGit,
  onOpenSettings,
}: {
  sidebarCollapsed: boolean;
  featuresOpen: boolean;
  terminalOpen: boolean;
  onToggleSidebar: () => void;
  onToggleFeatures: () => void;
  onToggleTerminal: () => void;
  onOpenGit: () => void;
  onOpenSettings: () => void;
}) {
  const conversation = useCurrentConversation();
  const renameConversation = useChatStore((state) => state.renameConversation);
  const toggleConversationPin = useChatStore((state) => state.toggleConversationPin);
  const archiveConversation = useChatStore((state) => state.archiveConversation);
  const duplicateConversation = useChatStore((state) => state.duplicateConversation);
  const createConversation = useChatStore((state) => state.createConversation);
  const [editing, setEditing] = useState(false);
  const [menu, setMenu] = useState<SidebarMenu | null>(null);
  const cwd = conversation?.cwd || '';

  useEffect(() => {
    if (!conversation) return;
    const handleKeyDown = (event: WindowEventMap['keydown']) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.altKey && event.code === 'KeyP') {
        event.preventDefault();
        toggleConversationPin(conversation.id);
      } else if (event.altKey && event.code === 'KeyR') {
        event.preventDefault();
        setEditing(true);
      } else if (event.shiftKey && !event.altKey && event.code === 'KeyA') {
        event.preventDefault();
        archiveConversation(conversation.id);
      } else if (!event.altKey && !event.shiftKey && event.code === 'Backspace') {
        event.preventDefault();
        archiveConversation(conversation.id);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [conversation, toggleConversationPin, archiveConversation]);

  const openSideChat = () => {
    if (!featuresOpen) onToggleFeatures();
  };

  const openTitleMenu = (event: ReactMouseEvent) => {
    if (!conversation) return;
    const hasMessages = conversation.messages.length > 0;
    setMenu({
      owner: conversation.id,
      ...anchorFromButton(event),
      items: [
        {
          kind: 'item',
          icon: conversation.pinned ? <PinOff size={15} /> : <Pin size={15} />,
          label: conversation.pinned ? '取消置顶对话' : '置顶对话',
          shortcut: '⌥⌘P',
          onSelect: () => toggleConversationPin(conversation.id),
        },
        { kind: 'item', icon: <Pencil size={15} />, label: '重命名对话', shortcut: '⌥⌘R', onSelect: () => setEditing(true) },
        { kind: 'item', icon: <Archive size={15} />, label: '归档对话', shortcut: '⇧⌘A', onSelect: () => archiveConversation(conversation.id) },
        { kind: 'separator' },
        { kind: 'item', icon: <MessageSquarePlus size={15} />, label: '打开侧边聊天', onSelect: openSideChat },
        {
          kind: 'submenu',
          icon: <Copy size={15} />,
          label: '复制',
          children: [
            { kind: 'item', icon: <Pencil size={15} />, label: '复制对话标题', onSelect: () => void copyToClipboard(conversation.title) },
            { kind: 'item', icon: <FileText size={15} />, label: '复制对话内容', disabled: !hasMessages, onSelect: () => void copyToClipboard(conversationToPlainText(conversation)) },
          ],
        },
        {
          kind: 'submenu',
          icon: <GitBranch size={15} />,
          label: '分支',
          children: [
            { kind: 'item', icon: <GitBranch size={15} />, label: '从此对话创建分支', disabled: !hasMessages, onSelect: () => { duplicateConversation(conversation.id); } },
            { kind: 'item', icon: <SquarePen size={15} />, label: '新建空白分支', onSelect: () => { createConversation(conversation.projectId); } },
          ],
        },
        { kind: 'item', icon: <Workflow size={15} />, label: '添加自动化…', onSelect: onOpenSettings },
        { kind: 'separator' },
        { kind: 'item', icon: <AppWindow size={15} />, label: '在新窗口中打开', onSelect: () => void openInNewWindow() },
      ],
    });
  };

  return (
    <header className="top-bar" data-tauri-drag-region>
      {sidebarCollapsed && <button className="icon-btn" type="button" onClick={onToggleSidebar} aria-label="展开侧栏"><PanelLeftOpen size={16} /></button>}
      {conversation ? (
        <div className={`top-bar-title ${editing ? 'editing' : ''}`} data-tauri-drag-region>
          {editing ? (
            <NameInput defaultValue={conversation.title} onCommit={(name) => { renameConversation(conversation.id, name); setEditing(false); }} onCancel={() => setEditing(false)} />
          ) : (
            <div className="top-bar-title-group">
              <button type="button" className="top-bar-title-btn" onDoubleClick={() => setEditing(true)} title="双击重命名">
                {conversation.pinned && <Pin size={12} className="top-bar-title-pin" />}
                <span className="top-bar-title-text">{conversation.title}</span>
              </button>
              <button className={`top-bar-title-more ${menu ? 'active' : ''}`} type="button" onClick={openTitleMenu} aria-label="对话操作" title="更多操作"><MoreHorizontal size={16} /></button>
            </div>
          )}
        </div>
      ) : (
        <div className="top-bar-title" data-tauri-drag-region>{domain.name}</div>
      )}
      <div className="top-bar-actions">
        <OpenInAppMenu cwd={cwd} />
        <EnvironmentMenu cwd={cwd} onOpenGit={onOpenGit} onOpenSettings={onOpenSettings} />
        <button className={`icon-btn ${terminalOpen ? 'active' : ''}`} type="button" onClick={onToggleTerminal} aria-label="打开下方终端" title="终端"><PanelBottom size={16} /></button>
        <button className={`icon-btn ${featuresOpen ? 'active' : ''}`} type="button" onClick={onToggleFeatures} aria-label="打开侧边栏" title="侧边栏"><PanelRight size={16} /></button>
      </div>
      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
    </header>
  );
}

const OPEN_APP_META: Record<OpenAppId, { label: string; color: string; glyph: string }> = {
  vscode: { label: 'VS Code', color: '#2f93e0', glyph: '〈〉' },
  cursor: { label: 'Cursor', color: '#111317', glyph: '▮' },
  finder: { label: 'Finder', color: '#1f9bff', glyph: '☺' },
  terminal: { label: 'Terminal', color: '#3a3a3a', glyph: '>_' },
  pycharm: { label: 'PyCharm', color: '#21d789', glyph: 'PC' },
};

const OPEN_APP_ORDER: OpenAppId[] = ['vscode', 'cursor', 'finder', 'terminal', 'pycharm'];

function OpenInAppMenu({ cwd }: { cwd: string }) {
  const [open, setOpen] = useState(false);
  const [apps, setApps] = useState<OpenAppId[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listOpenApps()
      .then((list) => {
        if (!cancelled) setApps(list);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const ordered = OPEN_APP_ORDER.filter((id) => apps.includes(id));
  const launch = async (id: OpenAppId) => {
    setOpen(false);
    try {
      await openInApp(id, cwd);
    } catch (err) {
      setError(stringifyError(err));
      window.setTimeout(() => setError(null), 4000);
    }
  };

  return (
    <div className="topbar-menu open-in-app">
      <button
        type="button"
        className={`open-app-trigger ${open ? 'active' : ''}`}
        onClick={() => setOpen((value) => !value)}
        title={cwd ? '用其他软件打开工作目录' : '当前对话未绑定工作目录'}
        aria-label="用其他软件打开"
      >
        <AppWindow size={15} />
        <ChevronDown size={12} />
      </button>
      {open && (
        <>
          <button className="menu-backdrop" type="button" aria-label="关闭菜单" onClick={() => setOpen(false)} />
          <div className="topbar-dropdown open-app-menu" role="menu">
            {ordered.length === 0 && <div className="topbar-dropdown-empty">未检测到可用的应用</div>}
            {ordered.map((id) => (
              <button key={id} type="button" className="topbar-dropdown-item" role="menuitem" onClick={() => void launch(id)} disabled={!cwd}>
                <span className="open-app-icon" style={{ background: OPEN_APP_META[id].color }}>{OPEN_APP_META[id].glyph}</span>
                <span>{OPEN_APP_META[id].label}</span>
              </button>
            ))}
            {error && <div className="topbar-dropdown-error"><AlertCircle size={13} />{error}</div>}
          </div>
        </>
      )}
    </div>
  );
}

function EnvironmentMenu({ cwd, onOpenGit, onOpenSettings }: { cwd: string; onOpenGit: () => void; onOpenSettings: () => void }) {
  const conversation = useCurrentConversation();
  const [open, setOpen] = useState(false);
  const [stat, setStat] = useState<GitDiffStat | null>(null);
  const [branch, setBranch] = useState('');
  const [remotes, setRemotes] = useState<GitRemote[]>([]);
  const [gh, setGh] = useState<GhAuthStatus | null>(null);
  const [isRepo, setIsRepo] = useState(false);

  useEffect(() => {
    if (!open || !cwd) return;
    let cancelled = false;
    void (async () => {
      try {
        const status = await gitStatus(cwd);
        if (cancelled) return;
        setIsRepo(status.isRepository);
        setBranch(status.branch || '');
        if (status.isRepository) {
          const [diffStat, remoteList] = await Promise.all([gitDiffStat(cwd), gitRemotes(cwd)]);
          if (cancelled) return;
          setStat(diffStat);
          setRemotes(remoteList);
        }
      } catch {
        if (!cancelled) setIsRepo(false);
      }
      try {
        const auth = await ghAuthStatus();
        if (!cancelled) setGh(auth);
      } catch {
        if (!cancelled) setGh(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, cwd]);

  const ghLabel = !gh || !gh.installed
    ? '未安装 GitHub CLI'
    : gh.authenticated
      ? `GitHub CLI · ${gh.account || '已登录'}`
      : 'GitHub CLI 未通过身份验证';

  return (
    <div className="topbar-menu environment-menu-wrap">
      <button
        type="button"
        className={`icon-btn ${open ? 'active' : ''}`}
        onClick={() => setOpen((value) => !value)}
        title="会话环境信息"
        aria-label="环境信息"
      >
        <ListChecks size={16} />
      </button>
      {open && (
        <>
          <button className="menu-backdrop" type="button" aria-label="关闭菜单" onClick={() => setOpen(false)} />
          <div className="topbar-dropdown environment-menu" role="menu">
            <div className="environment-menu-head">
              <span>环境信息</span>
              <button type="button" className="icon-mini" onClick={() => { setOpen(false); onOpenSettings(); }} aria-label="环境设置"><Settings size={14} /></button>
            </div>
            {cwd && isRepo ? (
              <>
                <button type="button" className="environment-row" onClick={() => { setOpen(false); onOpenGit(); }}>
                  <FileCode2 size={15} />
                  <span className="environment-row-label">变更</span>
                  <span className="environment-row-stat">
                    {stat ? <><span className="stat-add">+{stat.additions.toLocaleString()}</span> <span className="stat-del">-{stat.deletions.toLocaleString()}</span></> : '—'}
                  </span>
                </button>
                <div className="environment-row static">
                  <HardDrive size={15} />
                  <span className="environment-row-label">本地</span>
                  <span className="environment-row-value">{basename(cwd) || '本地'}</span>
                </div>
                <div className="environment-row static">
                  <GitBranch size={15} />
                  <span className="environment-row-label">{branch || 'detached'}</span>
                </div>
                <button type="button" className="environment-row" onClick={() => { setOpen(false); onOpenGit(); }}>
                  <GitCommitHorizontal size={15} />
                  <span className="environment-row-label">提交或推送</span>
                </button>
                <div className="environment-row static muted">
                  <Github size={15} />
                  <span className="environment-row-label">{ghLabel}</span>
                </div>
                <div className="environment-menu-divider" />
                <div className="environment-menu-section">来源</div>
                {remotes.length === 0 ? (
                  <div className="environment-row static muted"><Globe size={15} /><span className="environment-row-label">无远端</span></div>
                ) : (
                  remotes.map((remote) => {
                    const url = remoteUrl(remote);
                    return (
                      <button key={remote.name} type="button" className="environment-row" onClick={() => { const httpUrl = httpFromRemote(url); if (httpUrl) { setOpen(false); void openExternal(httpUrl); } }}>
                        <Globe size={15} />
                        <span className="environment-row-label">{remote.name}</span>
                        <span className="environment-row-value">{shortenRemote(url)}</span>
                      </button>
                    );
                  })
                )}
              </>
            ) : (
              <div className="environment-empty">
                {cwd ? `${basename(cwd)} 不是 Git 仓库。` : conversation ? '当前对话未绑定工作目录。' : '请先选择一个对话。'}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function BottomTerminal({ onClose }: { onClose: () => void }) {
  const conversation = useCurrentConversation();
  const cwd = conversation?.cwd || '';
  const [lines, setLines] = useState('');
  const [input, setInput] = useState('');
  const sessionRef = useRef('');
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const promptLabel = `${basename(cwd) || '~'} %`;

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | null = null;
    void (async () => {
      const unsub = await subscribeTerminalEvents((event) => {
        if (event.sessionId !== sessionRef.current) return;
        if (event.type === 'output' && event.chunk) {
          setLines((prev) => clampTerminalBuffer(prev + stripAnsi(event.chunk ?? '')));
        } else if (event.type === 'exit') {
          setLines((prev) => `${prev}\n[shell 已结束]\n`);
          sessionRef.current = '';
        }
      });
      if (!active) {
        unsub?.();
        return;
      }
      unlisten = unsub;
      if (!isTauriRuntime()) {
        setLines('（浏览器预览模式下终端不可用，请在桌面应用中使用。）\n');
        return;
      }
      try {
        const id = await terminalStart(cwd);
        if (!active) {
          if (id) void terminalStop(id);
          return;
        }
        sessionRef.current = id;
        inputRef.current?.focus();
      } catch (err) {
        setLines((prev) => `${prev}${stringifyError(err)}\n`);
      }
    })();
    return () => {
      active = false;
      unlisten?.();
      const id = sessionRef.current;
      sessionRef.current = '';
      if (id) void terminalStop(id);
    };
  }, [cwd]);

  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const submit = () => {
    const command = input;
    setInput('');
    setLines((prev) => `${prev}${promptLabel} ${command}\n`);
    if (sessionRef.current) void terminalWrite(sessionRef.current, `${command}\n`);
  };

  return (
    <section className="bottom-terminal" aria-label="终端">
      <header className="bottom-terminal-head">
        <span className="bottom-terminal-tab"><SquareTerminal size={13} />{basename(cwd) || '终端'}</span>
        <span className="spacer" />
        <button type="button" className="icon-mini" onClick={() => setLines('')} title="清屏"><RotateCcw size={13} /></button>
        <button type="button" className="icon-mini" onClick={onClose} aria-label="关闭终端" title="关闭"><X size={14} /></button>
      </header>
      <div className="bottom-terminal-body" ref={bodyRef} onClick={() => inputRef.current?.focus()}>
        <pre className="bottom-terminal-output">{lines}</pre>
        <div className="bottom-terminal-input-row">
          <span className="bottom-terminal-prompt">{promptLabel}</span>
          <input
            ref={inputRef}
            className="bottom-terminal-input"
            value={input}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                event.preventDefault();
                submit();
              }
            }}
          />
        </div>
      </div>
    </section>
  );
}

function FeaturesPanel({
  onClose,
  onOpenGit,
  onOpenTerminal,
}: {
  onClose: () => void;
  onOpenGit: () => void;
  onOpenTerminal: () => void;
}) {
  const conversation = useCurrentConversation();
  const cwd = conversation?.cwd || '';
  const createConversation = useChatStore((state) => state.createConversation);

  const features: {
    id: string;
    icon: ReactNode;
    title: string;
    desc: string;
    shortcut?: string;
    disabled?: boolean;
    action: () => void;
  }[] = [
    { id: 'files', icon: <FolderOpen size={20} />, title: '文件', desc: '浏览项目文件', shortcut: '⌘P', disabled: !cwd, action: () => { if (cwd) void revealPath(cwd); } },
    { id: 'chat', icon: <MessageSquarePlus size={20} />, title: '侧边聊天', desc: '发起侧边对话', action: () => createConversation(conversation?.projectId) },
    { id: 'browser', icon: <Globe size={20} />, title: '浏览器', desc: '打开网站', shortcut: '⌘T', action: () => { const url = window.prompt('输入要打开的网址', 'https://'); if (url && url.trim()) void openExternal(url.trim()); } },
    { id: 'review', icon: <GitPullRequest size={20} />, title: '审查', desc: '查看代码更改', shortcut: '⌃⇧G', action: onOpenGit },
    { id: 'terminal', icon: <SquareTerminal size={20} />, title: '终端', desc: '启动交互式 shell', shortcut: '⌃`', action: onOpenTerminal },
  ];

  return (
    <aside className="features-panel">
      <header className="features-panel-head">
        <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭侧边栏" title="关闭"><PanelRight size={16} /></button>
      </header>
      <div className="features-list">
        {features.map((feature) => (
          <button
            key={feature.id}
            type="button"
            className="feature-card"
            disabled={feature.disabled}
            onClick={feature.action}
          >
            <span className="feature-card-icon">{feature.icon}</span>
            <span className="feature-card-title">{feature.title}</span>
            <span className="feature-card-desc">{feature.desc}</span>
            {feature.shortcut && <span className="feature-card-key">{feature.shortcut}</span>}
          </button>
        ))}
      </div>
    </aside>
  );
}

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
            <span>{previewRuntime ? '这里会模拟 Codex 事件流；桌面应用会直连本地 Codex CLI。' : codexStatus?.error || '请确认 Codex 已安装并登录。'}</span>
            {codexStatus?.path && <code>{codexStatus.path}</code>}
          </div>
        </div>
      )}
      {isEmpty ? <EmptyState conversation={conversation} disabled={!codexReady} /> : <><div className="message-scroll"><MessageList conversation={conversation} /></div><Composer conversation={conversation} disabled={!codexReady} bottom /></>}
    </div>
  );
}

function EmptyState({ conversation, disabled }: { conversation: Conversation; disabled: boolean }) {
  const sendMessage = useChatStore((state) => state.sendMessage);
  const suggestions = [
    ['理解代码库', '先扫描这个项目结构，告诉我主要模块、入口和运行方式。', <FileCode2 size={16} className="icon" />],
    ['实现功能', '帮我实现一个小功能：先读代码，再给出修改并运行必要验证。', <Code2 size={16} className="icon" />],
    ['修复测试', '检查当前失败测试或类型错误，定位原因并修复。', <Wrench size={16} className="icon" />],
  ] as const;
  return (
    <div className="empty-state">
      <h1 className="empty-heading">把编码任务交给 Alpha Studio</h1>
      <Composer conversation={conversation} disabled={disabled} />
      <div className="suggestion-row">
        {suggestions.map(([title, prompt, icon]) => (
          <button key={title} type="button" className="suggestion-card" onClick={() => void sendMessage(prompt)}>
            {icon}<strong>{title}</strong><span>{prompt}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageList({ conversation }: { conversation: Conversation }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const streaming = conversation.status === 'streaming';
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversation.messages.length, conversation.messages[conversation.messages.length - 1], streaming]);
  return (
    <div className="message-list">
      {conversation.messages.map((message) => <MessageBubble key={message.id} message={message} conversation={conversation} />)}
      {streaming && <ThinkingIndicator />}
      <div ref={scrollRef} />
    </div>
  );
}

function ThinkingIndicator() {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const timer = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <div className="thinking-indicator" role="status" aria-live="polite">
      <span className="thinking-shimmer">正在思考</span>
      {elapsed > 0 && <span className="thinking-elapsed">{elapsed}s</span>}
    </div>
  );
}

function MessageBubble({ message, conversation }: { message: ChatMessage; conversation: Conversation }) {
  const editUserMessageAndResend = useChatStore((state) => state.editUserMessageAndResend);
  const [editing, setEditing] = useState(false);
  const plainText = messageToPlainText(message);
  const canCopy = plainText.length > 0;
  const canEdit = message.role === 'user' && conversation.status !== 'streaming';
  const lastBlockIndex = message.blocks.length - 1;
  const submitEdit = (next: string) => {
    const trimmed = next.trim();
    if (!trimmed) return;
    setEditing(false);
    void editUserMessageAndResend(conversation.id, message.id, trimmed);
  };
  if (message.role === 'assistant' && message.blocks.length === 0 && message.isStreaming) {
    return null;
  }
  return (
    <article className={`message ${message.role} ${editing ? 'editing' : ''}`}>
      {editing && canEdit ? (
        <MessageEditBubble initialValue={plainText} onCancel={() => setEditing(false)} onSubmit={submitEdit} />
      ) : (
        <div className="bubble">
          {message.role === 'user'
            ? message.blocks.map((block, index) => block.type === 'text' ? <span key={index}>{block.content}</span> : <BlockRenderer key={index} block={block} />)
            : buildRenderUnits(message.blocks).map((unit) =>
                unit.type === 'command-group'
                  ? (unit.blocks.length === 1
                      ? <BlockRenderer key={`tool-${unit.startIndex}`} block={unit.blocks[0]} />
                      : <CommandGroup key={`cmd-group-${unit.startIndex}`} blocks={unit.blocks} />)
                  : <BlockRenderer key={`${unit.block.type}-${unit.index}`} block={unit.block} streaming={Boolean(message.isStreaming) && unit.index === lastBlockIndex} />,
              )}
        </div>
      )}
      {!editing && (canCopy || canEdit) && (
        <div className="message-meta">
          <span className="message-actions">
            {canCopy && <button type="button" className="message-action" onClick={() => void copyToClipboard(plainText)} aria-label="复制"><Copy size={13} /></button>}
            {canEdit && <button type="button" className="message-action" onClick={() => setEditing(true)} aria-label="编辑并重新发送"><Pencil size={13} /></button>}
          </span>
        </div>
      )}
    </article>
  );
}

function MessageEditBubble({ initialValue, onCancel, onSubmit }: { initialValue: string; onCancel: () => void; onSubmit: (value: string) => void }) {
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
  return (
    <div className="message-edit-card">
      <textarea ref={textareaRef} className="message-edit-textarea" value={value} rows={1} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => {
        if (event.key === 'Escape') onCancel();
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
          event.preventDefault();
          onSubmit(value);
        }
      }} />
      <div className="message-edit-actions">
        <button type="button" className="message-edit-btn ghost" onClick={onCancel}>取消</button>
        <button type="button" className="message-edit-btn primary" onClick={() => onSubmit(value)} disabled={!value.trim() || value.trim() === initialValue.trim()}>发送</button>
      </div>
    </div>
  );
}

function BlockRenderer({ block, streaming }: { block: MessageBlock; streaming?: boolean }) {
  if (block.type === 'text') {
    return <div className={`markdown-content ${streaming ? 'streaming' : ''}`}><ReactMarkdown remarkPlugins={[remarkGfm]}>{block.content}</ReactMarkdown></div>;
  }
  if (block.type === 'thinking') {
    return (
      <details className={`thinking-block ${streaming ? 'is-active' : ''}`} open={streaming}>
        <summary className="event-summary">
          <span className="event-icon">{streaming ? <Loader2 size={13} className="spin" /> : <Sparkles size={13} />}</span>
          <span className="event-verb">{streaming ? '正在推理' : '推理过程'}</span>
          <span className="event-target" />
          <ChevronDown size={13} className="event-chevron" />
        </summary>
        <div className="thinking-text">{block.content.trim()}</div>
      </details>
    );
  }
  if (block.type === 'tool') {
    return <ToolBlockView block={block} />;
  }
  return <div className="error-block"><AlertCircle size={16} /><span>{block.content}</span></div>;
}

function ToolBlockView({ block }: { block: Extract<MessageBlock, { type: 'tool' }> }) {
  const tool = toolPresentation(block.title);
  const running = block.status === 'in_progress';
  const failed = block.status === 'failed';
  const verb = running ? tool.running : failed ? tool.failed : tool.done;
  const target = firstLine(block.input);
  const isCommand = tool.kind === 'command';
  const plainBody = isCommand ? '' : (block.output || block.input || '').trim();
  const hasBody = isCommand ? Boolean(block.input || block.output) : Boolean(plainBody) && plainBody !== target;
  return (
    <details className={`tool-block event-block ${block.status} kind-${tool.kind}`} open={running}>
      <summary className="event-summary">
        <span className="event-icon">{tool.icon}</span>
        <span className="event-verb">{verb}</span>
        <span className={`event-target ${target ? 'mono' : ''}`}>{target}</span>
        <span className="event-trailing">
          {running ? <Loader2 size={12} className="spin" /> : failed ? <AlertCircle size={12} className="event-fail" /> : null}
          <ChevronDown size={13} className="event-chevron" />
        </span>
      </summary>
      {hasBody && (
        <div className="event-body">
          {isCommand ? (
            <CommandCard command={block.input} output={block.output} status={block.status} />
          ) : (
            <pre className="event-output">{plainBody}</pre>
          )}
        </div>
      )}
    </details>
  );
}

function CommandCard({ command, output, status }: { command?: string; output?: string; status: 'in_progress' | 'completed' | 'failed' }) {
  const copyText = [command ? `$ ${command}` : '', (output || '').trim()].filter(Boolean).join('\n');
  return (
    <div className={`command-card ${status}`}>
      <div className="command-card-head">
        <span className="command-card-label"><Terminal size={12} />Shell</span>
        <button type="button" className="command-card-copy" onClick={() => void copyToClipboard(copyText)} aria-label="复制命令">
          <Copy size={12} />
        </button>
      </div>
      <div className="command-card-body">
        {command && <div className="command-line"><span className="command-prompt">$</span><span className="command-text">{command}</span></div>}
        {output && <pre className="command-out">{output.trim()}</pre>}
      </div>
      <div className="command-card-foot">
        {status === 'failed'
          ? <span className="cc-status fail"><AlertCircle size={12} />失败</span>
          : status === 'completed'
            ? <span className="cc-status ok"><Check size={12} />成功</span>
            : <span className="cc-status run"><Loader2 size={12} className="spin" />运行中</span>}
      </div>
    </div>
  );
}

function CommandGroup({ blocks }: { blocks: Array<Extract<MessageBlock, { type: 'tool' }>> }) {
  const anyRunning = blocks.some((block) => block.status === 'in_progress');
  const anyFailed = blocks.some((block) => block.status === 'failed');
  const verb = anyRunning ? '正在运行' : '已运行';
  const state = anyRunning ? 'in_progress' : anyFailed ? 'failed' : 'completed';
  return (
    <details className={`tool-block event-block command-group ${state}`} open={anyRunning}>
      <summary className="event-summary">
        <span className="event-icon"><Terminal size={14} /></span>
        <span className="event-verb">{verb} {blocks.length} 条命令</span>
        <span className="event-target" />
        <span className="event-trailing">
          {anyRunning ? <Loader2 size={12} className="spin" /> : anyFailed ? <AlertCircle size={12} className="event-fail" /> : null}
          <ChevronDown size={13} className="event-chevron" />
        </span>
      </summary>
      <div className="command-group-items">
        {blocks.map((block) => <ToolBlockView key={block.id} block={block} />)}
      </div>
    </details>
  );
}

type RenderUnit =
  | { type: 'block'; block: MessageBlock; index: number }
  | { type: 'command-group'; blocks: Array<Extract<MessageBlock, { type: 'tool' }>>; startIndex: number };

function buildRenderUnits(blocks: MessageBlock[]): RenderUnit[] {
  const units: RenderUnit[] = [];
  let index = 0;
  while (index < blocks.length) {
    if (isCommandBlock(blocks[index])) {
      const group: Array<Extract<MessageBlock, { type: 'tool' }>> = [];
      const startIndex = index;
      while (index < blocks.length && isCommandBlock(blocks[index])) {
        group.push(blocks[index] as Extract<MessageBlock, { type: 'tool' }>);
        index += 1;
      }
      units.push({ type: 'command-group', blocks: group, startIndex });
    } else {
      units.push({ type: 'block', block: blocks[index], index });
      index += 1;
    }
  }
  return units;
}

function isCommandBlock(block: MessageBlock): boolean {
  return block.type === 'tool' && toolPresentation(block.title).kind === 'command';
}

function Composer({ conversation, disabled, bottom }: { conversation: Conversation; disabled?: boolean; bottom?: boolean }) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sendMessage = useChatStore((state) => state.sendMessage);
  const stopCurrentConversation = useChatStore((state) => state.stopCurrentConversation);
  const isStreaming = conversation.status === 'streaming';
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [value]);
  const submit = () => {
    const next = value.trim();
    if (!next || isStreaming || disabled) return;
    setValue('');
    void sendMessage(next);
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
          onKeyDown={(event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder={disabled ? '请先修复 Codex CLI 状态' : bottom ? '要求后续变更' : '要求 Codex 执行任务'}
          rows={1}
        />
        <div className="composer-toolbar">
          <button className="composer-icon-btn" type="button" disabled aria-label="附件"><Plus size={16} /></button>
          <ApprovalPicker />
          <span className="spacer" />
          <ModelPicker />
          <button className="composer-icon-btn" type="button" disabled aria-label="语音"><Mic size={15} /></button>
          {isStreaming ? <button className="send-button stop" type="button" onClick={() => void stopCurrentConversation()} aria-label="停止"><Square size={14} /></button> : <button className="send-button" type="button" onClick={submit} disabled={!value.trim() || disabled} aria-label="发送"><ArrowUp size={18} /></button>}
        </div>
      </div>
      <ComposerMeta conversation={conversation} />
    </div>
  );
}

// Directory + git context shown beneath the composer, mirroring Codex's footer.
function ComposerMeta({ conversation }: { conversation: Conversation }) {
  const cwd = conversation.cwd;
  const [branch, setBranch] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setBranch(null);
    if (!cwd) return;
    void (async () => {
      try {
        const status = await gitStatus(cwd);
        if (cancelled) return;
        setBranch(status.isRepository ? status.branch || 'detached' : null);
      } catch {
        if (!cancelled) setBranch(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cwd]);

  return (
    <div className="composer-meta">
      <span className="composer-meta-pill" title={cwd || '未指定工作目录'}>
        <FolderGit2 size={12} />
        <span>{cwd ? basename(cwd) : '未指定目录'}</span>
      </span>
      <span className="composer-meta-pill">
        <Bot size={12} />
        <span>本地模式</span>
      </span>
      {branch && (
        <span className="composer-meta-pill" title={`当前分支 ${branch}`}>
          <GitBranch size={12} />
          <span>{branch}</span>
        </span>
      )}
    </div>
  );
}

function ModelPicker() {
  const model = useChatStore((state) => state.model);
  const reasoningEffort = useChatStore((state) => state.reasoningEffort);
  const speed = useChatStore((state) => state.speed);
  const setModel = useChatStore((state) => state.setModel);
  const setReasoningEffort = useChatStore((state) => state.setReasoningEffort);
  const setSpeed = useChatStore((state) => state.setSpeed);
  const [open, setOpen] = useState(false);
  const [submenu, setSubmenu] = useState<'model' | 'speed' | null>(null);
  const close = () => { setOpen(false); setSubmenu(null); };
  return (
    <div className="model-picker">
      <button type="button" className={`composer-pill model-pill ${open ? 'active' : ''}`} onClick={() => setOpen((value) => !value)} title="选择模型与推理强度">
        {speed === 'fast' && <Zap size={12} className="model-pill-fast" />}<span>{shortModelLabel(model)}</span><span className="model-pill-effort">{effortLabel(reasoningEffort)}</span><ChevronDown size={12} />
      </button>
      {open && (
        <>
          <button className="menu-backdrop" type="button" aria-label="关闭模型菜单" onClick={close} />
          <div className="model-menu" role="menu" onMouseLeave={() => setSubmenu(null)}>
            <div className="model-menu-label">智能</div>
            {EFFORT_OPTIONS.map((option) => <button key={option.id} type="button" role="menuitemradio" aria-checked={option.id === reasoningEffort} className="model-menu-item" onMouseEnter={() => setSubmenu(null)} onClick={() => { setReasoningEffort(option.id as ReasoningEffort); close(); }}><span>{option.label}</span>{option.id === reasoningEffort && <Check size={14} className="model-menu-check" />}</button>)}
            <div className="model-menu-divider" />
            <div className="model-flyout-row" onMouseEnter={() => setSubmenu('model')}>
              <button type="button" className="model-menu-item submenu-trigger"><span>{modelLabel(model)}</span><ChevronRight size={14} className="model-menu-chevron" /></button>
              {submenu === 'model' && <div className="model-flyout"><div className="model-flyout-panel" role="menu"><div className="model-menu-label">模型</div>{MODEL_OPTIONS.map((option) => <button key={option.id} type="button" role="menuitemradio" aria-checked={option.id === model} className="model-menu-item" onClick={() => { setModel(option.id); close(); }}><span>{option.label}</span>{option.id === model && <Check size={14} className="model-menu-check" />}</button>)}</div></div>}
            </div>
            <div className="model-flyout-row" onMouseEnter={() => setSubmenu('speed')}>
              <button type="button" className="model-menu-item submenu-trigger"><span>速度</span><ChevronRight size={14} className="model-menu-chevron" /></button>
              {submenu === 'speed' && <div className="model-flyout"><div className="model-flyout-panel" role="menu"><div className="model-menu-label">速度</div>{SPEED_OPTIONS.map((option) => <button key={option.id} type="button" role="menuitemradio" aria-checked={option.id === speed} className="model-menu-item speed-item" onClick={() => { setSpeed(option.id as Speed); close(); }}><span className="speed-main">{option.fast && <Zap size={13} className="speed-icon" />}<span className="speed-text"><span className="speed-title">{option.label}</span><span className="speed-sub">{option.description}</span></span></span>{option.id === speed && <Check size={14} className="model-menu-check" />}</button>)}</div></div>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function approvalIcon(mode: ApprovalMode, size = 13): ReactNode {
  if (mode === 'request') return <ShieldQuestion size={size} />;
  if (mode === 'auto') return <ShieldCheck size={size} />;
  return <Globe size={size} />;
}

function ApprovalPicker() {
  const approvalMode = useChatStore((state) => state.approvalMode);
  const setApprovalMode = useChatStore((state) => state.setApprovalMode);
  const [open, setOpen] = useState(false);
  return (
    <div className="approval-picker">
      <button
        type="button"
        className={`composer-pill approval-pill ${approvalMode === 'full-access' ? 'accent' : ''} ${open ? 'active' : ''}`}
        onClick={() => setOpen((value) => !value)}
        title="选择 Codex 操作的批准方式"
      >
        {approvalIcon(approvalMode, 12)}
        <span>{approvalLabel(approvalMode)}</span>
        <ChevronDown size={12} />
      </button>
      {open && (
        <>
          <button className="menu-backdrop" type="button" aria-label="关闭批准菜单" onClick={() => setOpen(false)} />
          <div className="approval-menu" role="menu">
            <div className="approval-menu-head">
              <span>应如何批准 Codex 操作？</span>
              <button
                type="button"
                className="approval-menu-learn"
                onClick={() => void openExternal('https://developers.openai.com/codex')}
              >
                了解更多
              </button>
            </div>
            {APPROVAL_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                role="menuitemradio"
                aria-checked={option.id === approvalMode}
                className={`approval-menu-item ${option.id === approvalMode ? 'active' : ''} ${option.id === 'full-access' ? 'accent' : ''}`}
                onClick={() => {
                  setApprovalMode(option.id);
                  setOpen(false);
                }}
              >
                <span className="approval-menu-icon">{approvalIcon(option.id)}</span>
                <span className="approval-menu-text">
                  <span className="approval-menu-title">{option.title}</span>
                  <span className="approval-menu-desc">{option.description}</span>
                </span>
                {option.id === approvalMode && <Check size={15} className="approval-menu-check" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function AuthorizationDialog() {
  const pending = useChatStore((state) => state.pendingAuthorization);
  const resolveAuthorization = useChatStore((state) => state.resolveAuthorization);
  useEffect(() => {
    if (!pending) return;
    const handleKeyDown = (event: WindowEventMap['keydown']) => {
      if (event.key === 'Escape') resolveAuthorization(pending.id, 'deny');
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pending, resolveAuthorization]);
  if (!pending) return null;
  return (
    <div className="dialog-layer auth-layer" role="presentation">
      <div className="dialog-backdrop static" />
      <section className="auth-dialog" role="alertdialog" aria-modal="true" aria-label={pending.title}>
        <div className="auth-dialog-icon"><ShieldQuestion size={22} /></div>
        <h2 className="auth-dialog-title">{pending.title}</h2>
        <p className="auth-dialog-desc">{pending.description}</p>
        {pending.cwd && (
          <code className="auth-dialog-path"><FolderOpen size={12} />{shortenPath(pending.cwd)}</code>
        )}
        <div className="auth-dialog-actions">
          <button type="button" className="auth-btn ghost" onClick={() => resolveAuthorization(pending.id, 'deny')}>拒绝</button>
          <button type="button" className="auth-btn" onClick={() => resolveAuthorization(pending.id, 'full-access')}>完全访问</button>
          <button type="button" className="auth-btn primary" onClick={() => resolveAuthorization(pending.id, 'allow')}>允许（工作区）</button>
        </div>
        <span className="auth-dialog-hint">此设置仅用于本次操作，可在输入框上方随时调整批准方式。</span>
      </section>
    </div>
  );
}

function GitPanel({ onClose }: { onClose: () => void }) {
  const conversation = useCurrentConversation();
  const cwd = conversation?.cwd || '';
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [branches, setBranches] = useState<GitBranchInfo[]>([]);
  const [remotes, setRemotes] = useState<GitRemote[]>([]);
  const [selected, setSelected] = useState<GitFileChange | null>(null);
  const [diff, setDiff] = useState('');
  const [commitMessage, setCommitMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    if (!cwd) {
      setStatus({ cwd: '', isRepository: false, ahead: 0, behind: 0, clean: true, changes: [], error: '当前对话未绑定工作目录。' });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await gitStatus(cwd);
      setStatus(next);
      setSelected((current) => next.changes.find((change) => change.path === current?.path) || next.changes[0] || null);
      if (next.isRepository) {
        setBranches(await gitBranches(cwd));
        setRemotes(await gitRemotes(cwd));
      }
    } catch (err) {
      setError(stringifyError(err));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [cwd]);

  useEffect(() => {
    if (!cwd || !selected) {
      setDiff('');
      return;
    }
    void gitDiff(cwd, selected.path, selected.staged && !selected.unstaged)
      .then(setDiff)
      .catch((err) => setDiff(stringifyError(err)));
  }, [cwd, selected]);

  const runGit = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await refresh();
    } catch (err) {
      setError(stringifyError(err));
    } finally {
      setBusy(false);
    }
  };

  const currentBranch = branches.find((branch) => branch.current)?.name || status?.branch || '';

  return (
    <aside className="git-panel">
      <header className="panel-header">
        <div>
          <h2>Git</h2>
          <span>{cwd ? shortenPath(cwd) : '未指定工作目录'}</span>
        </div>
        <button className="icon-btn" type="button" onClick={onClose} aria-label="关闭 Git 面板"><X size={15} /></button>
      </header>
      <div className="git-toolbar">
        <button type="button" className="panel-btn" onClick={() => void refresh()} disabled={busy}><RefreshCw size={13} className={busy ? 'spin' : ''} />刷新</button>
        <button type="button" className="panel-btn" onClick={() => void runGit(() => gitPull(cwd))} disabled={!status?.isRepository || busy}><Download size={13} />Pull</button>
        <button type="button" className="panel-btn" onClick={() => void runGit(() => gitPush(cwd, !status?.upstream))} disabled={!status?.isRepository || busy}><Upload size={13} />Push</button>
      </div>
      {status?.isRepository ? (
        <>
          <div className="git-summary">
            <span><GitBranch size={13} />{currentBranch || 'detached'}</span>
            {status.upstream && <span>{status.upstream}</span>}
            {(status.ahead > 0 || status.behind > 0) && <span>ahead {status.ahead} · behind {status.behind}</span>}
          </div>
          <div className="git-branches">
            <button type="button" className="panel-btn" onClick={() => {
              const name = window.prompt('输入新分支名');
              if (name) void runGit(() => gitCreateBranch(cwd, name));
            }} disabled={busy}><Plus size={13} />新分支</button>
            <select value={currentBranch} onChange={(event) => void runGit(() => gitCheckoutBranch(cwd, event.target.value))} disabled={busy}>
              {branches.map((branch) => <option key={branch.name} value={branch.name}>{branch.name}{branch.upstream ? ` · ${branch.upstream}` : ''}</option>)}
            </select>
          </div>
          <div className="git-commit-box">
            <textarea value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} placeholder="Commit message" rows={3} />
            <button type="button" className="panel-btn primary" disabled={!commitMessage.trim() || busy} onClick={() => void runGit(async () => { await gitCommit(cwd, commitMessage); setCommitMessage(''); })}><GitCommitHorizontal size={13} />Commit</button>
          </div>
          {error && <div className="panel-error"><AlertCircle size={14} />{error}</div>}
          <div className="git-split">
            <div className="git-files">
              <div className="git-files-head">
                <strong>更改 {status.changes.length}</strong>
                <span>
                  <button type="button" className="icon-mini" onClick={() => void runGit(() => gitStage(cwd, status.changes.map((change) => change.path)))} disabled={status.changes.length === 0 || busy} title="全部暂存"><Plus size={13} /></button>
                  <button type="button" className="icon-mini" onClick={() => void runGit(() => gitUnstage(cwd, status.changes.filter((change) => change.staged).map((change) => change.path)))} disabled={!status.changes.some((change) => change.staged) || busy} title="全部取消暂存"><RotateCcw size={13} /></button>
                </span>
              </div>
              {status.changes.length === 0 ? <div className="git-empty">工作区干净。</div> : status.changes.map((change) => (
                <button key={`${change.path}-${change.indexStatus}-${change.workingTreeStatus}`} type="button" className={`git-file ${selected?.path === change.path ? 'active' : ''}`} onClick={() => setSelected(change)}>
                  <span className={`git-status-dot ${change.status}`}>{change.indexStatus}{change.workingTreeStatus}</span>
                  <span className="git-file-name">{change.path}</span>
                  <span className="git-file-actions" onClick={(event) => event.stopPropagation()}>
                    {change.staged ? <button type="button" className="icon-mini" onClick={() => void runGit(() => gitUnstage(cwd, [change.path]))} title="取消暂存"><RotateCcw size={12} /></button> : <button type="button" className="icon-mini" onClick={() => void runGit(() => gitStage(cwd, [change.path]))} title="暂存"><Plus size={12} /></button>}
                  </span>
                </button>
              ))}
            </div>
            <div className="git-diff">
              <div className="git-diff-head"><strong>{selected?.path || 'Diff'}</strong></div>
              <pre>{diff || '选择文件查看 diff。'}</pre>
            </div>
          </div>
          {remotes.length > 0 && <div className="git-remotes">{remotes.map((remote) => <span key={remote.name}><Network size={12} />{remote.name}</span>)}</div>}
        </>
      ) : (
        <div className="git-empty-state">
          <FolderGit2 size={22} />
          <strong>当前工作目录不是 Git 仓库</strong>
          <span>{status?.error || '请选择一个包含 .git 的项目目录。'}</span>
          {error && <em>{error}</em>}
        </div>
      )}
    </aside>
  );
}

function SettingsPage({
  open,
  section,
  onSectionChange,
  onClose,
  theme,
  onThemeChange,
}: {
  open: boolean;
  section: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  onClose: () => void;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
}) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: WindowEventMap['keydown']) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);
  if (!open) return null;
  const activeLabel = sectionLabel(section);
  return (
    <div className="settings-page" role="dialog" aria-modal="true" aria-label="设置">
      <nav className="settings-page-nav">
        <div className="settings-page-traffic" data-tauri-drag-region />
        <button className="settings-back" type="button" onClick={onClose}><ChevronLeft size={16} /><span>返回应用</span></button>
        <SettingsNavGroup label="个人" items={domain.navigation.personal} section={section} onSectionChange={onSectionChange} />
        <SettingsNavGroup label="集成" items={domain.navigation.integrations} section={section} onSectionChange={onSectionChange} />
        <SettingsNavGroup label="编码" items={domain.navigation.coding} section={section} onSectionChange={onSectionChange} />
        <SettingsNavGroup label="已归档" items={domain.navigation.archived} section={section} onSectionChange={onSectionChange} />
      </nav>
      <div className="settings-page-main">
        <div className="settings-page-head" data-tauri-drag-region />
        <div className="settings-page-scroll">
          <div className="settings-content">
            <h1 className="settings-content-title">{activeLabel}</h1>
            <SettingsContent section={section} theme={theme} onThemeChange={onThemeChange} />
          </div>
        </div>
      </div>
    </div>
  );
}

function SettingsNavGroup({
  label,
  items,
  section,
  onSectionChange,
}: {
  label: string;
  items: { id: string; label: string }[];
  section: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
}) {
  return (
    <div className="settings-nav-list">
      <div className="settings-nav-grouplabel">{label}</div>
      {items.map((item) => (
        <button key={item.id} type="button" className={`settings-nav-item ${section === item.id ? 'active' : ''}`} onClick={() => onSectionChange(item.id as SettingsSection)}>
          {settingsIcon(item.id as SettingsSection)}<span>{item.label}</span>
        </button>
      ))}
    </div>
  );
}

function SettingsContent({ section, theme, onThemeChange }: { section: SettingsSection; theme: Theme; onThemeChange: (theme: Theme) => void }) {
  const model = useChatStore((state) => state.model);
  const reasoningEffort = useChatStore((state) => state.reasoningEffort);
  const speed = useChatStore((state) => state.speed);
  const approvalMode = useChatStore((state) => state.approvalMode);
  const setModel = useChatStore((state) => state.setModel);
  const setReasoningEffort = useChatStore((state) => state.setReasoningEffort);
  const setSpeed = useChatStore((state) => state.setSpeed);
  const setApprovalMode = useChatStore((state) => state.setApprovalMode);
  const codexStatus = useChatStore((state) => state.codexStatus);
  const refreshCodexStatus = useChatStore((state) => state.refreshCodexStatus);
  const isCheckingCodex = useChatStore((state) => state.isCheckingCodex);

  if (section === 'archived') return <ArchivedSettings />;
  if (section === 'appearance') {
    return (
      <>
        <CodePreview />
        <SettingsGroup>
          <SettingsRow title="主题" description="使用浅色、深色或匹配系统设置。">
            <SettingsSegment value={theme} onChange={onThemeChange} options={[{ id: 'light', label: '浅色', icon: <Sun size={13} /> }, { id: 'dark', label: '深色', icon: <Moon size={13} /> }]} />
          </SettingsRow>
          <SettingsRow title="强调色" description="用于按钮、选中状态和 Git 状态。"><ColorSwatch value="#339CFF" /></SettingsRow>
          <SettingsRow title="UI 字号" description="调整工作台界面的基础字号。"><span className="settings-static">14 px</span></SettingsRow>
        </SettingsGroup>
      </>
    );
  }
  if (section === 'config') {
    return (
      <SettingsGroup>
        <SettingsRow title="批准方式" description="选择 Codex 执行操作前如何请求授权。">
          <select className="settings-select" value={approvalMode} onChange={(event) => setApprovalMode(event.target.value as ApprovalMode)}>
            {APPROVAL_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.title}</option>)}
          </select>
        </SettingsRow>
        <SettingsRow title="当前策略" description={approvalDescription(approvalMode)}>
          <span className="settings-static">{approvalMode === 'request' ? '执行前弹出授权' : '自动执行'}</span>
        </SettingsRow>
      </SettingsGroup>
    );
  }
  if (section === 'personalization') {
    return (
      <>
        <SettingsGroup>
          <SettingsRow title="个性" description="选择 Alpha Studio 回复的默认语气。"><span className="settings-static">亲和</span></SettingsRow>
        </SettingsGroup>
        <div className="settings-subtitle">自定义指令</div>
        <textarea className="settings-textarea" placeholder="添加自定义指令..." />
      </>
    );
  }
  if (section === 'keyboard') return <KeyboardSettings />;
  if (section === 'usage') return <UsageSettings />;
  if (section === 'git') return <GitSettings />;
  if (section === 'environment') return <EnvironmentSettings />;
  if (section === 'worktrees') return <WorktreeSettings />;
  if (section === 'profile') return <ProfileSettings />;
  if (section === 'general') {
    return (
      <>
        <SettingsGroup>
          <SettingsRow title="工作模式" description="选择 Alpha Studio 显示多少技术细节。"><ModeCard /></SettingsRow>
        </SettingsGroup>
        <SettingsGroup>
          <SettingsRow title="默认权限" description="默认情况下，Alpha Studio 可以读取工作区文件。"><Toggle checked /></SettingsRow>
          <SettingsRow title="自动审核" description="自动审核额外访问和权限请求。"><Toggle checked /></SettingsRow>
          <SettingsRow title="完全访问权限" description="允许编辑电脑上的文件并运行联网命令。"><Toggle checked /></SettingsRow>
        </SettingsGroup>
        <SettingsGroup>
          <SettingsRow title="默认打开目标" description="默认打开文件和文件夹的位置。"><span className="settings-static">按项目目录</span></SettingsRow>
          <SettingsRow title="语言" description="应用 UI 语言。"><span className="settings-static">自动检测</span></SettingsRow>
          <SettingsRow title="速度" description="选择用于聊天、子智能体和压缩的推理层级。">
            <SettingsSegment value={speed} onChange={(id) => setSpeed(id as Speed)} options={SPEED_OPTIONS.map((option) => ({ id: option.id, label: option.label, icon: option.fast ? <Zap size={13} /> : undefined }))} />
          </SettingsRow>
        </SettingsGroup>
      </>
    );
  }
  if (section === 'hooks' || section === 'connections' || section === 'snapshots' || section === 'mcp' || section === 'browser' || section === 'computer') {
    return <PlaceholderSettings section={section} />;
  }
  return (
    <SettingsGroup>
      <SettingsRow title="模型" description="对话使用的基础模型，可随时切换。">
        <select className="settings-select" value={model} onChange={(event) => setModel(event.target.value)}>
          {MODEL_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
      </SettingsRow>
      <SettingsRow title="推理强度" description="更高的强度更细致，但响应更慢。">
        <SettingsSegment value={reasoningEffort} onChange={(id) => setReasoningEffort(id as ReasoningEffort)} options={EFFORT_OPTIONS.map((option) => ({ id: option.id, label: option.label }))} />
      </SettingsRow>
      <div className={`settings-status ${codexStatus?.installed && codexStatus.loggedIn ? 'ready' : 'attention'}`}>
        <span className="settings-status-icon">{isCheckingCodex ? <Loader2 size={16} className="spin" /> : <Terminal size={16} />}</span>
        <div className="settings-status-main">
          <strong>{codexStatus?.installed && codexStatus.loggedIn ? `Codex CLI 已就绪${codexStatus.version ? ` · ${codexStatus.version}` : ''}` : 'Codex CLI 未就绪'}</strong>
          <span>{codexStatus?.path || codexStatus?.error || '请确认 Codex 已安装并登录。'}</span>
        </div>
        <button className="settings-btn" type="button" onClick={() => void refreshCodexStatus()} disabled={isCheckingCodex}>重新检测</button>
      </div>
    </SettingsGroup>
  );
}

function SettingsGroup({ children }: { children: ReactNode }) {
  return <div className="settings-group">{children}</div>;
}

function SettingsRow({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return <div className="settings-row"><div className="settings-row-main"><strong>{title}</strong>{description && <span>{description}</span>}</div><div className="settings-row-control">{children}</div></div>;
}

function SettingsSegment<T extends string>({ options, value, onChange }: { options: { id: T; label: string; icon?: ReactNode }[]; value: T; onChange: (id: T) => void }) {
  return <div className="settings-segment" role="group">{options.map((option) => <button key={option.id} type="button" className={`settings-segment-btn ${option.id === value ? 'active' : ''}`} onClick={() => onChange(option.id)}>{option.icon}<span>{option.label}</span></button>)}</div>;
}

function CodePreview() {
  return (
    <div className="theme-preview">
      <div className="code-pane before"><code><span>1&nbsp; const themePreview = &#123;</span><span>2&nbsp;&nbsp;&nbsp; surface: "sidebar",</span><span>3&nbsp;&nbsp;&nbsp; accent: "#2563eb",</span><span>4&nbsp;&nbsp;&nbsp; contrast: 42,</span><span>5&nbsp; &#125;;</span></code></div>
      <div className="code-pane after"><code><span>1&nbsp; const themePreview = &#123;</span><span>2&nbsp;&nbsp;&nbsp; surface: "sidebar-elevated",</span><span>3&nbsp;&nbsp;&nbsp; accent: "#0ea5e9",</span><span>4&nbsp;&nbsp;&nbsp; contrast: 68,</span><span>5&nbsp; &#125;;</span></code></div>
    </div>
  );
}

function ModeCard() {
  return <div className="mode-card"><Terminal size={14} /><span><strong>适用于编程</strong><em>更具技术性的回复和控制</em></span><span className="radio-dot active" /></div>;
}

function Toggle({ checked }: { checked?: boolean }) {
  return <span className={`toggle ${checked ? 'checked' : ''}`}><span /></span>;
}

function ColorSwatch({ value }: { value: string }) {
  return <span className="color-swatch" style={{ ['--swatch']: value } as CSSProperties}>{value}</span>;
}

function ProfileSettings() {
  return (
    <div className="profile-settings">
      <div className="avatar">AS</div>
      <h2>Alpha Studio</h2>
      <span>@local · Noncommercial</span>
      <div className="profile-metrics">
        <span><strong>公开源码</strong><em>非商业版</em></span>
        <span><strong>Core</strong><em>领域包</em></span>
        <span><strong>Codex CLI</strong><em>本地连接</em></span>
      </div>
    </div>
  );
}

function KeyboardSettings() {
  const rows = [
    ['归档聊天', 'Archive the current chat', '⇧⌘A'],
    ['新对话', 'Start a new chat', '⌘N'],
    ['搜索', 'Search chats and projects', '⌘K'],
    ['置顶对话', 'Pin or unpin the current chat', '⌥⌘P'],
    ['Git 面板', 'Open the Git side panel', ''],
  ];
  return <SettingsGroup>{rows.map(([title, desc, key]) => <SettingsRow key={title} title={title} description={desc}><span className="shortcut-pill">{key || '未指定'}</span></SettingsRow>)}</SettingsGroup>;
}

function UsageSettings() {
  return (
    <SettingsGroup>
      <SettingsRow title="当前版本" description="公开源码非商业版。"><span className="settings-static">0.1.0</span></SettingsRow>
      <SettingsRow title="许可证" description="PolyForm Noncommercial License 1.0.0。"><span className="settings-static">Noncommercial</span></SettingsRow>
      <SettingsRow title="商业授权" description="垂直领域商业包需要单独授权。"><span className="settings-static">未启用</span></SettingsRow>
    </SettingsGroup>
  );
}

function GitSettings() {
  return (
    <SettingsGroup>
      <SettingsRow title="状态和 Diff" description="在 Git 面板中查看工作区改动。"><Toggle checked /></SettingsRow>
      <SettingsRow title="提交" description="允许暂存、取消暂存和 commit。"><Toggle checked /></SettingsRow>
      <SettingsRow title="远端同步" description="支持 pull --ff-only 和 push。"><Toggle checked /></SettingsRow>
      <SettingsRow title="危险操作" description="force push、reset、rebase 不在公开版内置。"><span className="settings-static">禁用</span></SettingsRow>
    </SettingsGroup>
  );
}

function EnvironmentSettings() {
  return (
    <SettingsGroup>
      <SettingsRow title="Node.js" description="由工作区或系统环境提供。"><span className="settings-static">自动检测</span></SettingsRow>
      <SettingsRow title="Python" description="由工作区或系统环境提供。"><span className="settings-static">自动检测</span></SettingsRow>
      <SettingsRow title="终端" description="命令通过 Codex CLI 和 Tauri 后端运行。"><span className="settings-static">本地</span></SettingsRow>
    </SettingsGroup>
  );
}

function WorktreeSettings() {
  return (
    <SettingsGroup>
      <SettingsRow title="工作树" description="为未来多工作树编码流预留。"><span className="settings-static">计划中</span></SettingsRow>
      <SettingsRow title="默认目录" description="每个项目可以绑定自己的工作目录。"><span className="settings-static">按项目管理</span></SettingsRow>
    </SettingsGroup>
  );
}

function PlaceholderSettings({ section }: { section: SettingsSection }) {
  return (
    <SettingsGroup>
      <SettingsRow title={sectionLabel(section)} description="公开源码版保留入口，商业垂直包可通过领域插件扩展这里。"><span className="settings-static">可扩展</span></SettingsRow>
      <SettingsRow title="领域包" description="当前启用 core-coding。"><span className="settings-static">{domain.id}</span></SettingsRow>
    </SettingsGroup>
  );
}

function ArchivedSettings() {
  const conversations = useChatStore((state) => state.conversations);
  const projects = useChatStore((state) => state.projects);
  const unarchiveConversation = useChatStore((state) => state.unarchiveConversation);
  const permanentlyDeleteConversation = useChatStore((state) => state.permanentlyDeleteConversation);
  const unarchiveProject = useChatStore((state) => state.unarchiveProject);
  const permanentlyDeleteProject = useChatStore((state) => state.permanentlyDeleteProject);
  const [query, setQuery] = useState('');
  const archivedConv = archivedConversations(conversations).filter((conversation) => conversation.title.toLowerCase().includes(query.toLowerCase()));
  const archivedProj = archivedProjects(projects).filter((project) => project.name.toLowerCase().includes(query.toLowerCase()));
  const clearAll = async () => {
    if (!(await confirmDanger('永久删除所有已归档项目和对话？此操作无法恢复。', '清空归档'))) return;
    const projectIds = new Set(archivedProj.map((project) => project.id));
    archivedProj.forEach((project) => permanentlyDeleteProject(project.id));
    archivedConv.filter((conversation) => !conversation.projectId || !projectIds.has(conversation.projectId)).forEach((conversation) => permanentlyDeleteConversation(conversation.id));
  };
  return (
    <div className="archive-settings">
      <div className="archive-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索已归档聊天" /></div>
      <div className="archive-list">
        {archivedProj.map((project) => <ArchiveRow key={project.id} title={project.name} meta={`${formatDate(project.archivedAt)} · 项目`} onRestore={() => unarchiveProject(project.id)} onDelete={() => void confirmDanger(`永久删除项目「${project.name}」及其中对话？`, '永久删除项目').then((ok) => ok && permanentlyDeleteProject(project.id))} />)}
        {archivedConv.map((conversation) => <ArchiveRow key={conversation.id} title={conversation.title} meta={`${formatDate(conversation.archivedAt)} · ${conversation.cwd ? shortenPath(conversation.cwd) : '未指定目录'}`} onRestore={() => unarchiveConversation(conversation.id)} onDelete={() => void confirmDanger(`永久删除对话「${conversation.title}」？`, '永久删除对话').then((ok) => ok && permanentlyDeleteConversation(conversation.id))} />)}
        {archivedProj.length === 0 && archivedConv.length === 0 && <div className="archive-empty"><Archive size={20} /><span>没有已归档项目或对话。</span></div>}
      </div>
      {(archivedProj.length > 0 || archivedConv.length > 0) && <button className="archive-delete-all" type="button" onClick={() => void clearAll()}><Trash2 size={14} />全部永久删除</button>}
    </div>
  );
}

function ArchiveRow({ title, meta, onRestore, onDelete }: { title: string; meta: string; onRestore: () => void; onDelete: () => void }) {
  return (
    <div className="archive-row">
      <div><strong>{title}</strong><span>{meta}</span></div>
      <button className="settings-btn" type="button" onClick={onRestore}>取消归档</button>
      <button className="icon-mini danger" type="button" onClick={onDelete} aria-label="永久删除"><Trash2 size={13} /></button>
    </div>
  );
}

function settingsIcon(section: SettingsSection): ReactNode {
  const icons: Record<SettingsSection, ReactNode> = {
    general: <SlidersHorizontal size={15} />,
    profile: <UserCircle size={15} />,
    appearance: <Sun size={15} />,
    config: <Box size={15} />,
    personalization: <Sparkles size={15} />,
    keyboard: <Keyboard size={15} />,
    usage: <History size={15} />,
    snapshots: <Layers size={15} />,
    mcp: <Plug size={15} />,
    browser: <Globe size={15} />,
    computer: <Monitor size={15} />,
    hooks: <Workflow size={15} />,
    connections: <Network size={15} />,
    git: <GitBranch size={15} />,
    environment: <Terminal size={15} />,
    worktrees: <FolderGit2 size={15} />,
    archived: <Archive size={15} />,
  };
  return icons[section];
}

function sectionLabel(section: SettingsSection): string {
  return [...domain.navigation.personal, ...domain.navigation.integrations, ...domain.navigation.coding, ...domain.navigation.archived]
    .find((item) => item.id === section)?.label || '设置';
}

function sortProjects(projects: Project[], sort: ProjectSort): Project[] {
  const compare = (a: Project, b: Project) => {
    if (sort === 'name') return a.name.localeCompare(b.name, 'zh-CN');
    if (sort === 'created') return b.createdAt - a.createdAt;
    return b.updatedAt - a.updatedAt;
  };
  return [...projects].sort((a, b) => {
    if (Number(Boolean(a.pinned)) !== Number(Boolean(b.pinned))) return Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
    return compare(a, b);
  });
}

function sortConversations(conversations: Conversation[], sort: ProjectSort): Conversation[] {
  return [...conversations].sort((a, b) => {
    if (sort === 'name') return a.title.localeCompare(b.title, 'zh-CN');
    if (sort === 'created') return b.createdAt - a.createdAt;
    return b.updatedAt - a.updatedAt;
  });
}

type ToolKind = 'command' | 'file-read' | 'file-edit' | 'search' | 'web' | 'log' | 'generic';

function toolPresentation(title: string): { kind: ToolKind; icon: ReactNode; running: string; done: string; failed: string } {
  const normalized = title.trim().toLowerCase();
  const has = (...keys: string[]) => keys.some((key) => normalized.includes(key));
  if (has('stderr')) return { kind: 'log', icon: <FileText size={14} />, running: 'Codex 日志', done: 'Codex 日志', failed: 'Codex 日志' };
  if (has('exec', 'shell', 'command', 'bash', 'execute', 'terminal')) return { kind: 'command', icon: <Terminal size={14} />, running: '正在运行', done: '已运行', failed: '运行失败' };
  if (has('web_search', 'websearch', 'web.run', 'web.search', 'browse_search')) return { kind: 'web', icon: <Globe size={14} />, running: '正在搜索网页', done: '已搜索网页', failed: '网页搜索失败' };
  if (has('search', 'grep', 'glob', 'ripgrep', 'find', 'query')) return { kind: 'search', icon: <Search size={14} />, running: '正在搜索', done: '已搜索', failed: '搜索失败' };
  if (has('write', 'edit', 'patch', 'apply', 'filechange', 'file_change', 'diff', 'create', 'update')) return { kind: 'file-edit', icon: <FileCode2 size={14} />, running: '正在编辑', done: '已编辑', failed: '编辑失败' };
  if (has('read', 'open', 'cat', 'file', 'view')) return { kind: 'file-read', icon: <FileText size={14} />, running: '正在读取', done: '已读取', failed: '读取失败' };
  if (has('web', 'browser', 'fetch', 'http', 'url', 'navigate')) return { kind: 'web', icon: <Globe size={14} />, running: '正在访问网页', done: '已访问网页', failed: '访问失败' };
  if (has('mcp', 'tool')) return { kind: 'generic', icon: <Plug size={14} />, running: '正在调用工具', done: '已调用工具', failed: '调用失败' };
  return { kind: 'generic', icon: <Workflow size={14} />, running: '正在执行', done: title.trim() || '已完成', failed: '执行失败' };
}

function firstLine(value?: string): string {
  if (!value) return '';
  const line = value.split('\n').find((entry) => entry.trim().length > 0) ?? '';
  const trimmed = line.trim();
  return trimmed.length > 200 ? `${trimmed.slice(0, 200)}…` : trimmed;
}

function messageToPlainText(message: ChatMessage): string {
  return message.blocks.map((block) => {
    if (block.type === 'text' || block.type === 'thinking' || block.type === 'error') return block.content;
    if (block.type === 'tool') return [block.title, block.input, block.output].filter(Boolean).join('\n');
    return '';
  }).filter(Boolean).join('\n\n').trim();
}

function conversationToPlainText(conversation: Conversation): string {
  return conversation.messages
    .map((message) => {
      const who = message.role === 'user' ? '我' : 'Codex';
      const body = messageToPlainText(message);
      return body ? `${who}：${body}` : '';
    })
    .filter(Boolean)
    .join('\n\n');
}

async function openInNewWindow(): Promise<void> {
  const target = `${window.location.pathname}${window.location.search}`;
  if (isTauriRuntime()) {
    try {
      const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      const label = `chat-${Date.now().toString(36)}`;
      new WebviewWindow(label, {
        url: target || '/',
        title: 'Alpha Studio',
        width: 1100,
        height: 760,
      });
      return;
    } catch {
      // Fall back to a browser window if the webview cannot be spawned.
    }
  }
  window.open(target || window.location.href, '_blank', 'noopener,noreferrer');
}

async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard?.writeText(text);
  } catch {
    // Clipboard access is best-effort.
  }
}

async function openExternal(url: string): Promise<void> {
  if (isTauriRuntime()) {
    try {
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(url);
      return;
    } catch {
      // Fall back to the web behavior below.
    }
  }
  window.open(url, '_blank', 'noopener,noreferrer');
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
  return manual?.trim() || null;
}

async function confirmDanger(message: string, title: string): Promise<boolean> {
  if (isTauriRuntime()) {
    try {
      const { ask } = await import('@tauri-apps/plugin-dialog');
      return await ask(message, { title, kind: 'warning', okLabel: '永久删除', cancelLabel: '取消' });
    } catch {
      return false;
    }
  }
  return window.confirm(`${title}\n\n${message}`);
}

function formatRelative(value: number): string {
  const diff = Date.now() - value;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}小时`;
  if (diff < 86_400_000 * 7) return `${Math.floor(diff / 86_400_000)}天`;
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(value);
}

function formatDate(value?: number): string {
  if (!value) return '未知时间';
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(value);
}

function shortenPath(value: string): string {
  if (!value) return '未指定目录';
  const parts = value.split('/').filter(Boolean);
  if (parts.length <= 2) return value;
  return `…/${parts.slice(-2).join('/')}`;
}

function remoteUrl(remote: GitRemote): string {
  return remote.pushUrl || remote.fetchUrl || '';
}

function httpFromRemote(url: string): string | null {
  if (!url) return null;
  let cleaned = url.trim().replace(/\.git$/, '');
  const scpMatch = cleaned.match(/^[^@]+@([^:]+):(.+)$/);
  if (scpMatch) {
    return `https://${scpMatch[1]}/${scpMatch[2]}`;
  }
  cleaned = cleaned.replace(/^ssh:\/\/[^@]+@/, 'https://').replace(/^git:\/\//, 'https://');
  if (/^https?:\/\//.test(cleaned)) return cleaned;
  return null;
}

function shortenRemote(url: string): string {
  const http = httpFromRemote(url);
  if (http) {
    const without = http.replace(/^https?:\/\//, '');
    const parts = without.split('/').filter(Boolean);
    return parts.length <= 1 ? without : `${parts[0]}/${parts.slice(1).join('/')}`;
  }
  return url;
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || path;
}

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\u001b\[[0-9;?]*[A-Za-z]|\u001b\][^\u0007]*\u0007|\r/g;

function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, '');
}

function clampTerminalBuffer(value: string): string {
  const MAX = 120_000;
  return value.length > MAX ? value.slice(value.length - MAX) : value;
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error || 'Unknown error');
}
