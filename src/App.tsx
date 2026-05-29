import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent, ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  AlertCircle,
  ArrowUp,
  Bot,
  Briefcase,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Loader2,
  Mail,
  MessageCircle,
  MessageSquare,
  Mic,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Smartphone,
  Square,
  Star,
  Sun,
  Trash2,
  Users,
  Workflow,
  X,
  Zap,
} from 'lucide-react';
import { isTauriRuntime, subscribeCodexEvents } from './codexBridge';
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
import type { ChatMessage, Conversation, Holding, MessageBlock, Project, SandboxMode, WatchItem } from './types';

type RightPanel = 'none' | 'coworker' | 'portfolio';

export function App() {
  const refreshCodexStatus = useChatStore((state) => state.refreshCodexStatus);
  const handleCodexEvent = useChatStore((state) => state.handleCodexEvent);
  const conversations = useChatStore((state) => state.conversations);
  const currentConversationId = useChatStore((state) => state.currentConversationId);
  const setCurrentConversation = useChatStore((state) => state.setCurrentConversation);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [rightPanel, setRightPanel] = useState<RightPanel>('none');
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  const toggleRightPanel = (panel: Exclude<RightPanel, 'none'>) =>
    setRightPanel((current) => (current === panel ? 'none' : panel));

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

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
    <div className="app-shell">
      <Sidebar
        collapsed={sidebarCollapsed}
        theme={theme}
        onToggleTheme={() => setTheme((value) => (value === 'dark' ? 'light' : 'dark'))}
        portfolioOpen={rightPanel === 'portfolio'}
        onOpenPortfolio={() => toggleRightPanel('portfolio')}
      />
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
    </div>
  );
}

/* ------------------------------------------------------------------ sidebar */

function Sidebar({
  collapsed,
  theme,
  onToggleTheme,
  portfolioOpen,
  onOpenPortfolio,
}: {
  collapsed: boolean;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  portfolioOpen: boolean;
  onOpenPortfolio: () => void;
}) {
  const conversations = useChatStore((state) => state.conversations);
  const projects = useChatStore((state) => state.projects);
  const currentConversationId = useChatStore((state) => state.currentConversationId);
  const createConversation = useChatStore((state) => state.createConversation);
  const setCurrentConversation = useChatStore((state) => state.setCurrentConversation);
  const deleteConversation = useChatStore((state) => state.deleteConversation);
  const createProject = useChatStore((state) => state.createProject);
  const renameProject = useChatStore((state) => state.renameProject);
  const setProjectCwd = useChatStore((state) => state.setProjectCwd);
  const deleteProject = useChatStore((state) => state.deleteProject);

  const standalone = useMemo(
    () => conversations.filter((conversation) => !conversation.projectId),
    [conversations],
  );
  const groups = useMemo(() => groupConversationsByDate(standalone), [standalone]);

  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);

  const toggleProject = (id: string) =>
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  const handleNewBlankProject = () => {
    setAddMenuOpen(false);
    const id = createProject();
    setExpanded((prev) => ({ ...prev, [id]: true }));
    setEditingProjectId(id);
  };

  const handleUseExistingFolder = async () => {
    setAddMenuOpen(false);
    const dir = await pickFolder();
    if (!dir) return;
    const id = createProject({ name: basename(dir), cwd: dir });
    setExpanded((prev) => ({ ...prev, [id]: true }));
    createConversation(id);
  };

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`} aria-hidden={collapsed}>
      <div className="sidebar-traffic" data-tauri-drag-region />
      <div className="sidebar-scroll">
        <button className="nav-item" type="button" onClick={() => createConversation()}>
          <Plus size={15} />
          <span className="nav-label">新对话</span>
        </button>
        <button className="nav-item" type="button" disabled>
          <Search size={15} />
          <span className="nav-label">搜索</span>
        </button>
        <button className="nav-item" type="button" disabled>
          <Workflow size={15} />
          <span className="nav-label">自动化</span>
        </button>
        <button className="nav-item" type="button" disabled>
          <Smartphone size={15} />
          <span className="nav-label">Alpha 移动版</span>
        </button>

        <SectionLabel>资产 · 视图</SectionLabel>
        <button className="nav-item" type="button" disabled>
          <FileText size={15} />
          <span className="nav-label">晨报</span>
          <span className="nav-badge">待接入</span>
        </button>
        <button className="nav-item" type="button" disabled>
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

        <div className="sidebar-section-head">
          <span className="sidebar-section-label">项目</span>
          <button
            className="section-add"
            type="button"
            onClick={() => setAddMenuOpen((value) => !value)}
            aria-label="新建项目"
            title="新建项目"
          >
            <FolderPlus size={14} />
          </button>
          {addMenuOpen && (
            <>
              <button
                className="menu-backdrop"
                type="button"
                aria-label="关闭菜单"
                onClick={() => setAddMenuOpen(false)}
              />
              <div className="add-menu" role="menu">
                <button type="button" role="menuitem" onClick={handleNewBlankProject}>
                  <FolderPlus size={14} />
                  <span>新建空白项目</span>
                </button>
                <button type="button" role="menuitem" onClick={() => void handleUseExistingFolder()}>
                  <FolderOpen size={14} />
                  <span>使用现有文件夹</span>
                </button>
              </div>
            </>
          )}
        </div>
        {projects.length === 0 ? (
          <div className="sidebar-hint">用项目把对话固定到一个工作目录</div>
        ) : (
          projects.map((project) => (
            <ProjectItem
              key={project.id}
              project={project}
              expanded={Boolean(expanded[project.id])}
              editing={editingProjectId === project.id}
              conversations={conversations.filter((conversation) => conversation.projectId === project.id)}
              currentConversationId={currentConversationId}
              onToggle={() => toggleProject(project.id)}
              onSelectConversation={setCurrentConversation}
              onNewConversation={() => {
                setExpanded((prev) => ({ ...prev, [project.id]: true }));
                createConversation(project.id);
              }}
              onDeleteConversation={deleteConversation}
              onStartRename={() => setEditingProjectId(project.id)}
              onCommitRename={(name) => {
                renameProject(project.id, name);
                setEditingProjectId(null);
              }}
              onCancelRename={() => setEditingProjectId(null)}
              onChooseFolder={async () => {
                const dir = await pickFolder();
                if (dir) setProjectCwd(project.id, dir);
              }}
              onDelete={() => deleteProject(project.id)}
            />
          ))
        )}

        <SectionLabel>对话</SectionLabel>
        {groups.length === 0 ? (
          <div className="sidebar-hint">暂无未归类的对话</div>
        ) : (
          groups.map((group) => (
            <div key={group.label} style={{ marginBottom: 6 }}>
              <div className="sidebar-section-label">{group.label}</div>
              {group.items.map((conversation) => (
                <ConversationRow
                  key={conversation.id}
                  conversation={conversation}
                  active={conversation.id === currentConversationId}
                  deletable={conversations.length > 1}
                  onSelect={() => setCurrentConversation(conversation.id)}
                  onDelete={() => deleteConversation(conversation.id)}
                />
              ))}
            </div>
          ))
        )}
      </div>
      <div className="sidebar-footer">
        <button className="nav-item" type="button" disabled title="首版只做投研对话，不接交易、不写审计归档。">
          <ShieldCheck size={15} />
          <span className="nav-label">合规边界</span>
        </button>
        <button
          className="icon-btn"
          type="button"
          onClick={onToggleTheme}
          aria-label="切换主题"
          title="切换主题"
        >
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </button>
        <button className="icon-btn" type="button" disabled aria-label="设置" title="设置">
          <Settings size={15} />
        </button>
      </div>
    </aside>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="sidebar-section-label" style={{ marginTop: 14 }}>{children}</div>;
}

function ConversationRow({
  conversation,
  active,
  deletable,
  nested,
  onSelect,
  onDelete,
}: {
  conversation: Conversation;
  active: boolean;
  deletable: boolean;
  nested?: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={`conversation-row ${active ? 'active' : ''} ${nested ? 'nested' : ''}`}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onSelect();
      }}
    >
      <span className="conversation-title">{conversation.title}</span>
      <span className="conversation-time">{formatRelative(conversation.updatedAt)}</span>
      {deletable && (
        <span
          className="delete-hit"
          role="button"
          tabIndex={0}
          aria-label="删除对话"
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              event.stopPropagation();
              onDelete();
            }
          }}
        >
          <Trash2 size={13} />
        </span>
      )}
    </div>
  );
}

function ProjectItem({
  project,
  expanded,
  editing,
  conversations,
  currentConversationId,
  onToggle,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onChooseFolder,
  onDelete,
}: {
  project: Project;
  expanded: boolean;
  editing: boolean;
  conversations: Conversation[];
  currentConversationId: string | null;
  onToggle: () => void;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
  onDeleteConversation: (id: string) => void;
  onStartRename: () => void;
  onCommitRename: (name: string) => void;
  onCancelRename: () => void;
  onChooseFolder: () => Promise<void>;
  onDelete: () => void;
}) {
  const sorted = useMemo(
    () => [...conversations].sort((a, b) => b.updatedAt - a.updatedAt),
    [conversations],
  );

  return (
    <div className="project-item">
      <div
        className={`project-header ${expanded ? 'open' : ''}`}
        role="button"
        tabIndex={0}
        onClick={() => {
          if (!editing) onToggle();
        }}
        onKeyDown={(event) => {
          if (!editing && event.key === 'Enter') onToggle();
        }}
      >
        <ChevronRight size={14} className={`project-chevron ${expanded ? 'open' : ''}`} />
        <Folder size={14} className="project-folder-icon" />
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
        {!editing && conversations.length > 0 && (
          <span className="project-count">{conversations.length}</span>
        )}
        {!editing && (
          <span className="project-actions" onClick={(event) => event.stopPropagation()}>
            <button
              className="icon-mini"
              type="button"
              onClick={onNewConversation}
              aria-label="在项目中新建对话"
              title="新建对话"
            >
              <Plus size={13} />
            </button>
            <button
              className="icon-mini"
              type="button"
              onClick={onStartRename}
              aria-label="重命名项目"
              title="重命名"
            >
              <Pencil size={12} />
            </button>
            <button
              className="icon-mini"
              type="button"
              onClick={() => void onChooseFolder()}
              aria-label="设置工作目录"
              title="设置工作目录"
            >
              <FolderOpen size={13} />
            </button>
            <button
              className="icon-mini danger"
              type="button"
              onClick={onDelete}
              aria-label="删除项目"
              title="删除项目"
            >
              <Trash2 size={13} />
            </button>
          </span>
        )}
      </div>
      {expanded && (
        <div className="project-children">
          <button
            className="project-cwd"
            type="button"
            onClick={() => void onChooseFolder()}
            title={project.cwd || '点击选择工作目录'}
          >
            <FolderOpen size={11} />
            <span>{project.cwd ? shortenPath(project.cwd) : '未指定目录 · 点击选择'}</span>
          </button>
          {sorted.map((conversation) => (
            <ConversationRow
              key={conversation.id}
              conversation={conversation}
              active={conversation.id === currentConversationId}
              deletable
              nested
              onSelect={() => onSelectConversation(conversation.id)}
              onDelete={() => onDeleteConversation(conversation.id)}
            />
          ))}
          <button className="project-new-conv" type="button" onClick={onNewConversation}>
            <Plus size={13} />
            <span>新对话</span>
          </button>
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
  const conversation = useCurrentConversation();

  const status = codexStatus?.installed && codexStatus.loggedIn ? 'ready' : 'needs-attention';
  const statusLabel = isCheckingCodex
    ? '检查中…'
    : codexStatus?.installed && codexStatus.loggedIn
      ? `Codex ${codexStatus.version || ''}`.trim()
      : 'Codex 未就绪';

  return (
    <header className="top-bar" data-tauri-drag-region>
      <button
        className="icon-btn"
        type="button"
        onClick={onToggleSidebar}
        aria-label={sidebarCollapsed ? '展开侧栏' : '收起侧栏'}
        title={sidebarCollapsed ? '展开侧栏' : '收起侧栏'}
      >
        {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
      </button>
      <div className="top-bar-title" data-tauri-drag-region>{conversation?.title || 'Alpha Studio'}</div>
      <div className="top-bar-actions">
        <button
          className={`codex-chip ${status}`}
          type="button"
          onClick={() => void refreshCodexStatus()}
          title={codexStatus?.path || '点击重新检查 Codex'}
        >
          {isCheckingCodex ? (
            <Loader2 size={11} className="spin" />
          ) : (
            <span className="dot" />
          )}
          <span>{statusLabel}</span>
          <RefreshCw size={11} />
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
    </header>
  );
}

/* ------------------------------------------------------------------ chat area */

function ChatArea() {
  const conversation = useCurrentConversation();
  const codexStatus = useChatStore((state) => state.codexStatus);

  if (!conversation) return null;

  const codexReady = Boolean(codexStatus?.installed && codexStatus.loggedIn);
  const isEmpty = conversation.messages.length === 0;

  return (
    <div className="chat-area">
      {!codexReady && (
        <div className="codex-warning">
          <AlertCircle size={16} />
          <div>
            <strong>Codex CLI 暂不可用</strong>
            <span>{codexStatus?.error || '请确认 Codex 已安装并登录。'}</span>
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
        <MessageBubble key={message.id} message={message} />
      ))}
      <div ref={scrollRef} />
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  return (
    <article className={`message ${message.role}`}>
      <div className="bubble">
        {message.blocks.length === 0 && message.isStreaming ? (
          <div className="thinking-inline">
            <Loader2 size={14} className="spin" />
            <span>Alpha Studio 正在思考</span>
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
            <BlockRenderer block={block} key={`${block.type}-${index}`} />
          ))
        )}
      </div>
    </article>
  );
}

function BlockRenderer({ block }: { block: MessageBlock }) {
  if (block.type === 'text') {
    return (
      <div className="markdown-content">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{block.content}</ReactMarkdown>
      </div>
    );
  }

  if (block.type === 'thinking') {
    return (
      <details className="thinking-block">
        <summary>推理过程</summary>
        <pre>{block.content}</pre>
      </details>
    );
  }

  if (block.type === 'tool') {
    return (
      <div className={`tool-block ${block.status}`}>
        <div className="tool-title">
          {block.status === 'completed' ? (
            <CheckCircle2 size={13} />
          ) : (
            <Loader2 size={13} className="spin" />
          )}
          <span>{block.title}</span>
        </div>
        {block.input && <code>{block.input}</code>}
        {block.output && <pre>{block.output}</pre>}
      </div>
    );
  }

  return (
    <div className="error-block">
      <AlertCircle size={16} />
      <span>{block.content}</span>
    </div>
  );
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

  const submit = () => {
    const next = value.trim();
    if (!next || isStreaming || disabled) return;
    setValue('');
    void sendMessage(next);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  const sandboxLabel = sandboxLabels[sandboxMode];

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
              : '描述你的投研问题，Enter 发送，Shift+Enter 换行'
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
  'read-only': '只读访问',
  'workspace-write': '工作区写入',
  'danger-full-access': '完全访问权限',
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

function groupConversationsByDate(conversations: Conversation[]): ConversationGroup[] {
  const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);
  const now = Date.now();
  const dayMs = 86_400_000;
  const buckets: ConversationGroup[] = [
    { label: '今天', items: [] },
    { label: '昨天', items: [] },
    { label: '过去 7 天', items: [] },
    { label: '更早', items: [] },
  ];
  for (const item of sorted) {
    const diff = now - item.updatedAt;
    if (diff < dayMs && new Date(item.updatedAt).getDate() === new Date(now).getDate()) {
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
