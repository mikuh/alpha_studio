import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type {
  ChangeEvent,
  CSSProperties,
  Dispatch,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
  SetStateAction,
} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Terminal as XTerm, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import {
  AlertCircle,
  AlertTriangle,
  AppWindow,
  Archive,
  ArrowDownAZ,
  ArrowDownUp,
  ArrowUp,
  Box,
  Braces,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronsDownUp,
  ChevronsUpDown,
  Clock3,
  Code2,
  Columns2,
  Copy,
  Cpu,
  Database,
  Download,
  Eye,
  EyeOff,
  File,
  FileCode2,
  FileDiff,
  FileSpreadsheet,
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
  Image as ImageIcon,
  Inbox,
  Info,
  Keyboard,
  Languages,
  Layers,
  Link2,
  ListChecks,
  Loader2,
  Lock,
  Mail,
  Maximize2,
  MessageCircle,
  MessageSquare,
  MessageSquarePlus,
  Mic,
  Minus,
  Minimize2,
  Monitor,
  Moon,
  MoreHorizontal,
  Network,
  PanelBottom,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRight,
  Paperclip,
  Pencil,
  Pin,
  PinOff,
  Plug,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Send,
  Settings,
  ShieldCheck,
  ShieldQuestion,
  SlidersHorizontal,
  Sparkles,
  Square,
  SquarePen,
  SquareTerminal,
  Sun,
  Target,
  Terminal,
  Trash2,
  Truck,
  Undo2,
  Upload,
  UserCircle,
  Users,
  Workflow,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import {
  ghAuthStatus,
  createBrandDirectory,
  ghPrCreateWeb,
  gitApplyPatch,
  gitBranches,
  gitCheckoutBranch,
  gitCommit,
  gitCreateBranch,
  gitDiff,
  gitDiscard,
  gitRecentCommits,
  gitDiffStat,
  gitPull,
  gitPush,
  gitRemotes,
  gitStage,
  gitStatus,
  gitUnstage,
  isTauriRuntime,
  listOpenApps,
  marketingAgentApplyUpdate,
  marketingDbQuery,
  marketingDbUpdateKol,
  marketingKolEvaluate,
  marketingKolOutreach,
  marketingKolReply,
  marketingKolIntake,
  marketingKolCollaborate,
  marketingKolShip,
  marketingLeadClassify,
  marketingSettingsSet,
  marketingEmailSecretSave,
  marketingEmailSyncReadonly,
  marketingEmailTestConnection,
  openInApp,
  revealPath,
  subscribeTerminalEvents,
  terminalResize,
  terminalStart,
  translateText,
  terminalStop,
  terminalWrite,
} from './codexBridge';
import { WORK_MODE_OPTIONS, activeDomain, type DomainConfig, type DomainFeature, type DomainSuggestion, type WorkModeId } from './domain';
import {
  APPROVAL_OPTIONS,
  EFFORT_OPTIONS,
  SPEED_OPTIONS,
  approvalDescription,
  approvalLabel,
  effortLabel,
  modelProfileLabel,
  normalizeModelProfileDraft,
  shortModelProfileLabel,
  type ApprovalMode,
  type ModelProfile,
  type ModelProfileDraft,
  type ModelWireApi,
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
  useImageViewer,
  visibleConversations,
} from './store';
import type {
  ChatMessage,
  Conversation,
  EmailCategory,
  EvalCriterion,
  EvalCriterionKey,
  EvalCriterionStatus,
  EvalVerdict,
  GhAuthStatus,
  GitBranch as GitBranchInfo,
  GitCommit,
  GitDiffStat,
  GitFileChange,
  GitRemote,
  GitStatus,
  KolCollab,
  KolEvaluation,
  KolIntake,
  KolOutreach,
  KolProfile,
  KolProfilePatch,
  KolShipment,
  MarketingDbSnapshot,
  MarketingEmailAccountConfig,
  MarketingEmailLead,
  MessageAttachment,
  MessageBlock,
  OpenAppId,
  Project,
  ProjectSort,
  ReviewFinding,
  ReviewReport,
  ReviewRequest,
} from './types';

type RightPanel = 'none' | 'git' | 'features' | 'review';
type FeatureSidebarTabKind = 'partner-marketing';

interface FeatureSidebarTab {
  id: string;
  kind: FeatureSidebarTabKind;
  title: string;
}

interface FeatureSidebarTabState {
  tabs: FeatureSidebarTab[];
  activeId: string | null;
}

interface FeatureAgentContext {
  id: string;
  kind: FeatureSidebarTabKind | 'feature-hub';
  title: string;
  body: string;
}

interface ComposerContextToggle {
  enabled: boolean;
  available: boolean;
  label: string;
  title: string;
  onToggle: () => void;
}

interface AgentContextTrace {
  title: string;
  input?: string;
  output?: string;
  status?: 'completed' | 'failed';
}

interface ResolvedAgentContext {
  context: string;
  trace?: AgentContextTrace;
}

type AgentContextResolver = () => Promise<ResolvedAgentContext | undefined>;

type Theme = 'light' | 'dark';
type SettingsSection =
  | 'general'
  | 'profile'
  | 'appearance'
  | 'config'
  | 'marketing-email'
  | 'models'
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

const SIDEBAR_WIDTH_KEY = 'alpha:codex-sidebar-width';
const RIGHT_SIDEBAR_WIDTH_KEY = 'alpha:right-sidebar-width';
const GIT_PANEL_WIDTH_KEY = 'alpha:git-panel-width';
const REVIEW_PANEL_WIDTH_KEY = 'alpha:review-panel-width';
const THEME_KEY = 'alpha:codex-theme';
const THEME_RESTORE_KEY = 'alpha:codex-theme-restored-main-ui-v2';
const SIDEBAR_MIN_WIDTH = 244;
const SIDEBAR_DEFAULT_WIDTH = 300;
const SIDEBAR_FULLSCREEN_THRESHOLD = 4;
const RIGHT_SIDEBAR_MIN_WIDTH = 320;
const RIGHT_SIDEBAR_DEFAULT_WIDTH = 356;
const GIT_PANEL_MIN_WIDTH = 360;
const GIT_PANEL_MAX_WIDTH = 760;
const GIT_PANEL_DEFAULT_WIDTH = 430;
const REVIEW_PANEL_MIN_WIDTH = 520;
const REVIEW_PANEL_MAX_WIDTH = 1120;
const REVIEW_PANEL_DEFAULT_WIDTH = 704;
const RIGHT_PANEL_MIN_MAIN_WIDTH = 320;
const PARTNER_MARKETING_LABEL = '合作推广营销';

function getSidebarMaxWidth() {
  if (typeof window === 'undefined') return SIDEBAR_DEFAULT_WIDTH;
  return Math.max(SIDEBAR_MIN_WIDTH, Math.floor(window.innerWidth));
}

function clampSidebarWidth(width: number, max = getSidebarMaxWidth()) {
  return Math.min(max, Math.max(SIDEBAR_MIN_WIDTH, width));
}

export function App() {
  const refreshCodexStatus = useChatStore((state) => state.refreshCodexStatus);
  const loadModelConfig = useChatStore((state) => state.loadModelConfig);
  const conversations = useChatStore((state) => state.conversations);
  const currentConversationId = useChatStore((state) => state.currentConversationId);
  const setCurrentConversation = useChatStore((state) => state.setCurrentConversation);
  const workModeId = useChatStore((state) => state.workModeId);
  const domain = activeDomain(workModeId);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarMaxWidth, setSidebarMaxWidth] = useState(() => getSidebarMaxWidth());
  const sidebarMaxWidthRef = useRef(sidebarMaxWidth);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window === 'undefined') return SIDEBAR_DEFAULT_WIDTH;
    const saved = Number(window.localStorage.getItem(SIDEBAR_WIDTH_KEY));
    return Number.isFinite(saved) && saved >= SIDEBAR_MIN_WIDTH
      ? clampSidebarWidth(saved)
      : SIDEBAR_DEFAULT_WIDTH;
  });
  const sidebarRestoreWidth = useRef(
    sidebarWidth >= sidebarMaxWidth - SIDEBAR_FULLSCREEN_THRESHOLD ? SIDEBAR_DEFAULT_WIDTH : sidebarWidth,
  );
  const [rightSidebarWidth, setRightSidebarWidth] = useState(() => {
    if (typeof window === 'undefined') return RIGHT_SIDEBAR_DEFAULT_WIDTH;
    const saved = Number(window.localStorage.getItem(RIGHT_SIDEBAR_WIDTH_KEY));
    return Number.isFinite(saved) && saved >= RIGHT_SIDEBAR_MIN_WIDTH && saved <= getSidebarMaxWidth()
      ? saved
      : RIGHT_SIDEBAR_DEFAULT_WIDTH;
  });
  const [gitPanelWidth, setGitPanelWidth] = useState(() => {
    if (typeof window === 'undefined') return GIT_PANEL_DEFAULT_WIDTH;
    const saved = Number(window.localStorage.getItem(GIT_PANEL_WIDTH_KEY));
    return Number.isFinite(saved) && saved >= GIT_PANEL_MIN_WIDTH && saved <= GIT_PANEL_MAX_WIDTH
      ? saved
      : GIT_PANEL_DEFAULT_WIDTH;
  });
  const [reviewPanelWidth, setReviewPanelWidth] = useState(() => {
    if (typeof window === 'undefined') return REVIEW_PANEL_DEFAULT_WIDTH;
    const saved = Number(window.localStorage.getItem(REVIEW_PANEL_WIDTH_KEY));
    return Number.isFinite(saved) && saved >= REVIEW_PANEL_MIN_WIDTH && saved <= REVIEW_PANEL_MAX_WIDTH
      ? saved
      : REVIEW_PANEL_DEFAULT_WIDTH;
  });
  const [rightPanel, setRightPanel] = useState<RightPanel>('none');
  const [featuresPanelFullscreen, setFeaturesPanelFullscreen] = useState(false);
  const featuresPanelRestoreWidth = useRef(rightSidebarWidth);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [featureTabState, setFeatureTabState] = useState<FeatureSidebarTabState>({
    tabs: [],
    activeId: null,
  });
  const [featureAgentContext, setFeatureAgentContext] = useState<FeatureAgentContext | null>(null);
  const [mainComposerUsesFeatureContext, setMainComposerUsesFeatureContext] = useState(false);
  const nextFeatureTabId = useRef(1);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [quickGitOpen, setQuickGitOpen] = useState(false);
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
    const handleResize = () => {
      const previousMax = sidebarMaxWidthRef.current;
      const nextMax = getSidebarMaxWidth();
      sidebarMaxWidthRef.current = nextMax;
      setSidebarMaxWidth(nextMax);
      setSidebarWidth((current) => {
        const wasFullscreen = current >= previousMax - SIDEBAR_FULLSCREEN_THRESHOLD;
        if (wasFullscreen || current > nextMax) return nextMax;
        return current;
      });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(RIGHT_SIDEBAR_WIDTH_KEY, String(rightSidebarWidth));
  }, [rightSidebarWidth]);

  useEffect(() => {
    window.localStorage.setItem(GIT_PANEL_WIDTH_KEY, String(gitPanelWidth));
  }, [gitPanelWidth]);

  useEffect(() => {
    window.localStorage.setItem(REVIEW_PANEL_WIDTH_KEY, String(reviewPanelWidth));
  }, [reviewPanelWidth]);

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
    void loadModelConfig();
  }, [refreshCodexStatus, loadModelConfig]);

  useEffect(() => {
    if (!domainSectionIds(domain).includes(settingsSection)) {
      setSettingsSection('general');
    }
  }, [domain, settingsSection]);

  const openSettings = (section: SettingsSection = 'general') => {
    setSettingsSection(section);
    setSettingsOpen(true);
  };
  const nextFeatureTabNumber = useCallback(() => {
    const tabNumber = nextFeatureTabId.current;
    nextFeatureTabId.current += 1;
    return tabNumber;
  }, []);

  const featurePanelMaxWidth = Math.max(
    RIGHT_SIDEBAR_MIN_WIDTH,
    sidebarCollapsed ? sidebarMaxWidth : sidebarMaxWidth - sidebarWidth,
  );
  const clampFeaturePanelWidth = useCallback(
    (width: number) => Math.min(featurePanelMaxWidth, Math.max(RIGHT_SIDEBAR_MIN_WIDTH, width)),
    [featurePanelMaxWidth],
  );
  const toggleFeaturesPanelFullscreen = useCallback(() => {
    if (featuresPanelFullscreen) {
      setRightSidebarWidth(clampFeaturePanelWidth(featuresPanelRestoreWidth.current || RIGHT_SIDEBAR_DEFAULT_WIDTH));
      setFeaturesPanelFullscreen(false);
      return;
    }
    featuresPanelRestoreWidth.current = rightSidebarWidth;
    setRightSidebarWidth(featurePanelMaxWidth);
    setFeaturesPanelFullscreen(true);
  }, [clampFeaturePanelWidth, featurePanelMaxWidth, featuresPanelFullscreen, rightSidebarWidth]);

  useEffect(() => {
    if (rightPanel !== 'features' && featuresPanelFullscreen) {
      setRightSidebarWidth(clampFeaturePanelWidth(featuresPanelRestoreWidth.current || RIGHT_SIDEBAR_DEFAULT_WIDTH));
      setFeaturesPanelFullscreen(false);
    }
  }, [clampFeaturePanelWidth, featuresPanelFullscreen, rightPanel]);

  useEffect(() => {
    if (featuresPanelFullscreen) {
      setRightSidebarWidth(featurePanelMaxWidth);
      return;
    }
    if (rightPanel === 'features') {
      setRightSidebarWidth((current) => Math.min(current, featurePanelMaxWidth));
    }
  }, [featurePanelMaxWidth, featuresPanelFullscreen, rightPanel]);

  useEffect(() => {
    if (!featuresPanelFullscreen) {
      featuresPanelRestoreWidth.current = rightSidebarWidth;
    }
  }, [featuresPanelFullscreen, rightSidebarWidth]);

  useEffect(() => {
    if (rightPanel === 'features') return;
    setMainComposerUsesFeatureContext(false);
    setFeatureAgentContext(null);
  }, [rightPanel]);

  const rightPanelResizer =
    rightPanel === 'features'
      ? {
          min: RIGHT_SIDEBAR_MIN_WIDTH,
          max: featurePanelMaxWidth,
          defaultWidth: RIGHT_SIDEBAR_DEFAULT_WIDTH,
          minMainWidth: 0,
          onCommit: setRightSidebarWidth,
        }
      : rightPanel === 'git'
        ? {
            min: GIT_PANEL_MIN_WIDTH,
            max: GIT_PANEL_MAX_WIDTH,
            defaultWidth: GIT_PANEL_DEFAULT_WIDTH,
            minMainWidth: RIGHT_PANEL_MIN_MAIN_WIDTH,
            onCommit: setGitPanelWidth,
          }
        : rightPanel === 'review'
          ? {
              min: REVIEW_PANEL_MIN_WIDTH,
              max: REVIEW_PANEL_MAX_WIDTH,
              defaultWidth: REVIEW_PANEL_DEFAULT_WIDTH,
              minMainWidth: RIGHT_PANEL_MIN_MAIN_WIDTH,
              onCommit: setReviewPanelWidth,
            }
          : null;
  const sidebarFullscreen = !sidebarCollapsed && sidebarWidth >= sidebarMaxWidth - SIDEBAR_FULLSCREEN_THRESHOLD;
  const commitSidebarWidth = useCallback((width: number) => {
    setSidebarWidth(clampSidebarWidth(width, sidebarMaxWidthRef.current));
  }, []);
  const toggleSidebarFullscreen = useCallback(() => {
    setSidebarWidth((current) => {
      const max = sidebarMaxWidthRef.current;
      if (current >= max - SIDEBAR_FULLSCREEN_THRESHOLD) {
        return clampSidebarWidth(sidebarRestoreWidth.current || SIDEBAR_DEFAULT_WIDTH, max);
      }
      sidebarRestoreWidth.current = current;
      return max;
    });
  }, []);

  useEffect(() => {
    if (!sidebarFullscreen) {
      sidebarRestoreWidth.current = sidebarWidth;
    }
  }, [sidebarFullscreen, sidebarWidth]);

  const activeFeatureAgentContext = rightPanel === 'features' ? featureAgentContext : null;
  const mainComposerAgentContext =
    mainComposerUsesFeatureContext && activeFeatureAgentContext ? activeFeatureAgentContext.body : undefined;
  const mainComposerAgentContextResolver = useCallback(async () => {
    if (!mainComposerUsesFeatureContext || !activeFeatureAgentContext) return undefined;
    return resolveFeatureAgentContext(activeFeatureAgentContext);
  }, [activeFeatureAgentContext, mainComposerUsesFeatureContext]);
  const mainComposerContextToggle =
    rightPanel === 'features'
      ? {
          enabled: mainComposerUsesFeatureContext && Boolean(activeFeatureAgentContext),
          available: Boolean(activeFeatureAgentContext),
          label: activeFeatureAgentContext?.title || '侧栏上下文',
          title: activeFeatureAgentContext
            ? `将「${activeFeatureAgentContext.title}」上下文带入本次对话`
            : '侧栏上下文正在准备',
          onToggle: () => {
            if (!activeFeatureAgentContext) return;
            setMainComposerUsesFeatureContext((value) => !value);
          },
        }
      : undefined;

  return (
    <div
      className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''} ${sidebarFullscreen ? 'sidebar-fullscreen' : ''} ${rightPanel !== 'none' ? 'right-panel-open' : ''} ${rightPanel === 'features' ? 'features-panel-open' : ''} ${rightPanel === 'features' && featuresPanelFullscreen ? 'features-panel-fullscreen' : ''} ${rightPanel === 'git' ? 'git-panel-open' : ''} ${rightPanel === 'review' ? 'review-panel-open' : ''} ${windowFocused ? '' : 'window-inactive'}`}
      data-work-mode={domain.id}
      style={
        {
          ['--sidebar-width']: `${sidebarWidth}px`,
          ['--right-sidebar-width']: `${rightSidebarWidth}px`,
          ['--git-panel-width']: `${gitPanelWidth}px`,
          ['--review-panel-width']: `${reviewPanelWidth}px`,
        } as CSSProperties
      }
    >
      <Sidebar
        domain={domain}
        collapsed={sidebarCollapsed}
        fullscreen={sidebarFullscreen}
        onCollapse={() => setSidebarCollapsed(true)}
        onToggleFullscreen={toggleSidebarFullscreen}
        onOpenSettings={openSettings}
      />
      {!sidebarCollapsed && (
        <SidebarResizer
          min={SIDEBAR_MIN_WIDTH}
          max={sidebarMaxWidth}
          defaultWidth={SIDEBAR_DEFAULT_WIDTH}
          onCommit={commitSidebarWidth}
        />
      )}
      <div className="workspace">
        <div className="workspace-row">
          <main className="main-stage">
            <TopBar
              domain={domain}
              sidebarCollapsed={sidebarCollapsed}
              featuresOpen={rightPanel === 'features'}
              rightPanelOpen={rightPanel !== 'none'}
              onToggleSidebar={() => setSidebarCollapsed((value) => !value)}
              onToggleFeatures={() => setRightPanel((value) => (value === 'features' ? 'none' : 'features'))}
              onToggleRightPanel={() => setRightPanel((value) => (value === 'none' ? 'features' : 'none'))}
              onOpenSettings={() => openSettings('config')}
            />
            <ChatArea
              domain={domain}
              agentContext={mainComposerAgentContext}
              agentContextResolver={mainComposerAgentContextResolver}
              contextToggle={mainComposerContextToggle}
            />
          </main>
          {rightPanelResizer && (
            <RightPanelResizer
              min={rightPanelResizer.min}
              max={rightPanelResizer.max}
              defaultWidth={rightPanelResizer.defaultWidth}
              minMainWidth={rightPanelResizer.minMainWidth}
              onCommit={rightPanelResizer.onCommit}
            />
          )}
          {rightPanel === 'git' && <GitPanel onClose={() => setRightPanel('none')} />}
          {rightPanel === 'review' && <ReviewChangesPanel />}
          {rightPanel === 'features' && (
            <FeaturesPanel
              domain={domain}
              tabState={featureTabState}
              onTabStateChange={setFeatureTabState}
              onNextTabNumber={nextFeatureTabNumber}
              onOpenReviewChanges={() => setRightPanel('review')}
              onOpenTerminal={() => setTerminalOpen(true)}
              fullscreen={featuresPanelFullscreen}
              onToggleFullscreen={toggleFeaturesPanelFullscreen}
              onAgentContextChange={setFeatureAgentContext}
              onClose={() => setRightPanel('none')}
            />
          )}
        </div>
        {terminalOpen && <TerminalPanel theme={theme} onClose={() => setTerminalOpen(false)} />}
      </div>
      <SettingsPage
        domain={domain}
        open={settingsOpen}
        section={settingsSection}
        onSectionChange={setSettingsSection}
        onClose={() => setSettingsOpen(false)}
        theme={theme}
        onThemeChange={setTheme}
      />
      <QuickGitDialog open={quickGitOpen} onClose={() => setQuickGitOpen(false)} />
      <AuthorizationDialog />
      <ImageLightbox />
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

function RightPanelResizer({
  min,
  max,
  defaultWidth,
  minMainWidth = RIGHT_PANEL_MIN_MAIN_WIDTH,
  onCommit,
}: {
  min: number;
  max: number;
  defaultWidth: number;
  minMainWidth?: number;
  onCommit: (width: number) => void;
}) {
  const drag = useRef<{ x: number; w: number; rowWidth: number }>({ x: 0, w: 0, rowWidth: 0 });
  const [active, setActive] = useState(false);

  const commitWidth = (next: number) => {
    const rowLimitedMax = drag.current.rowWidth
      ? Math.max(min, Math.min(max, drag.current.rowWidth - minMainWidth))
      : max;
    onCommit(Math.min(rowLimitedMax, Math.max(min, next)));
  };

  useEffect(() => {
    if (!active) return;
    const handleMove = (event: PointerEvent) => {
      commitWidth(drag.current.w - (event.clientX - drag.current.x));
    };
    const finishDrag = () => {
      setActive(false);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', finishDrag);
    window.addEventListener('pointercancel', finishDrag);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', finishDrag);
      window.removeEventListener('pointercancel', finishDrag);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, [active, min, max, minMainWidth, onCommit]);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const row = event.currentTarget.closest('.workspace-row') as HTMLElement | null;
    const panel = row?.querySelector('.right-dock-panel') as HTMLElement | null;
    drag.current = {
      x: event.clientX,
      w: panel?.getBoundingClientRect().width || defaultWidth,
      rowWidth: row?.getBoundingClientRect().width || 0,
    };
    setActive(true);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!active) return;
    commitWidth(drag.current.w - (event.clientX - drag.current.x));
  };

  const finish = () => {
    setActive(false);
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
  };

  return (
    <div
      className={`right-panel-resizer ${active ? 'active' : ''}`}
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
  domain,
  collapsed,
  fullscreen,
  onCollapse,
  onToggleFullscreen,
  onOpenSettings,
}: {
  domain: DomainConfig;
  collapsed: boolean;
  fullscreen: boolean;
  onCollapse: () => void;
  onToggleFullscreen: () => void;
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
  const sidebarCopy = domain.ui.sidebar;

  const [searchOpen, setSearchOpen] = useState(false);
  const [menu, setMenu] = useState<SidebarMenu | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [blankBrandOpen, setBlankBrandOpen] = useState(false);

  // Keep the active conversation's project expanded so a chat that just got
  // pointed at a folder (e.g. via the composer directory switcher) is visible
  // under its project instead of hidden inside a collapsed group.
  const currentProjectId = conversations.find((conversation) => conversation.id === currentConversationId)?.projectId;
  useEffect(() => {
    if (!currentProjectId) return;
    setExpanded((prev) => (prev[currentProjectId] ? prev : { ...prev, [currentProjectId]: true }));
  }, [currentProjectId]);

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
          label: '新建空白品牌',
          onSelect: () => setBlankBrandOpen(true),
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
          label: project.pinned ? '取消置顶' : '置顶品牌',
          onSelect: () => toggleProjectPin(project.id),
        },
        { kind: 'item', icon: <FolderOpen size={15} />, label: '在访达中打开', onSelect: () => void revealOrPickProject(project) },
        { kind: 'item', icon: <FolderInput size={15} />, label: '设置品牌目录', onSelect: () => void chooseProjectFolder(project) },
        { kind: 'item', icon: <Pencil size={15} />, label: '重命名品牌', onSelect: () => setEditingProjectId(project.id) },
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
        { kind: 'item', icon: <Archive size={15} />, label: '归档品牌', danger: true, onSelect: () => archiveProject(project.id) },
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
          <button
            className="sidebar-collapse-btn"
            type="button"
            onClick={onToggleFullscreen}
            aria-label={fullscreen ? '退出侧栏全屏' : '侧栏全屏'}
            title={fullscreen ? '退出全屏' : '侧栏全屏'}
          >
            {fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
          <button className="sidebar-collapse-btn" type="button" onClick={onCollapse} aria-label="收起侧栏" title="收起侧栏">
            <PanelLeftClose size={16} />
          </button>
        </div>
        <div className="sidebar-scroll">
          <div className="sidebar-menu-panel nav-menu">
            <button className="nav-item primary" type="button" onClick={() => createConversationInContext()}>
              <SquarePen size={15} />
              <span className="nav-label">{sidebarCopy.newConversationLabel}</span>
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

          <SidebarHead label={sidebarCopy.projectSectionLabel} menuOpen={menu?.owner === 'project-section' || menu?.owner === 'add'}>
            <button className="group-action" type="button" onClick={openProjectSectionMenu} aria-label="品牌排序与整理" title="排序与整理">
              <MoreHorizontal size={15} />
            </button>
            <button className="group-action" type="button" onClick={openNewProjectMenu} aria-label="新建品牌" title="新建品牌">
              <FolderInput size={15} />
            </button>
          </SidebarHead>
          <div className="sidebar-menu-panel project-menu">
            {sortedProjects.length === 0 ? (
              <div className="sidebar-hint">{sidebarCopy.projectEmpty}</div>
            ) : (
              sortedProjects.map((project) => (
                <ProjectItem
                  key={project.id}
                  project={project}
                  expanded={Boolean(expanded[project.id])}
                  editing={editingProjectId === project.id}
                  menuOpen={menu?.owner === project.id}
                  conversations={sortConversations(liveConversations.filter((conversation) => conversation.projectId === project.id && !conversation.pinned), conversationSort)}
                  emptyLabel={sidebarCopy.projectConversationEmpty}
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

          <SidebarHead label={sidebarCopy.conversationSectionLabel} menuOpen={menu?.owner === 'conversation-section'}>
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
                <div className="sidebar-hint">{sidebarCopy.conversationEmpty}</div>
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
            <span className="nav-label">{sidebarCopy.settingsLabel}</span>
          </button>
        </div>
      </aside>
      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
      <BrandCreateDialog
        open={blankBrandOpen}
        defaultName={`新品牌 ${liveProjects.length + 1}`}
        onClose={() => setBlankBrandOpen(false)}
        onCreated={(name, cwd) => {
          const id = createProject({ name, cwd });
          setExpanded((prev) => ({ ...prev, [id]: true }));
          createConversation(id);
          setBlankBrandOpen(false);
        }}
      />
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
        copy={sidebarCopy}
      />
    </>
  );
}

function BrandCreateDialog({
  open,
  defaultName,
  onClose,
  onCreated,
}: {
  open: boolean;
  defaultName: string;
  onClose: () => void;
  onCreated: (name: string, cwd: string) => void;
}) {
  const [name, setName] = useState(defaultName);
  const [parent, setParent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const directoryName = brandDirectoryName(name);
  const canCreate = Boolean(name.trim() && directoryName && parent.trim() && !busy);

  useEffect(() => {
    if (!open) return;
    setName(defaultName);
    setParent('');
    setError(null);
    setBusy(false);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [open, defaultName]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: WindowEventMap['keydown']) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  if (!open) return null;

  const chooseParent = async (): Promise<string | null> => {
    setError(null);
    const selected = await pickFolder('选择品牌目录保存位置', '输入父目录的绝对路径（浏览器预览模式）');
    if (selected) setParent(selected);
    return selected;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const brandName = name.trim();
    const safeDirectoryName = brandDirectoryName(brandName);
    if (!brandName) {
      setError('请输入品牌名称。');
      return;
    }
    if (!safeDirectoryName) {
      setError('品牌名称无法转换为有效目录名，请换一个名称。');
      return;
    }
    let parentDir = parent.trim();
    if (!parentDir) {
      parentDir = (await chooseParent())?.trim() || '';
      if (!parentDir) return;
    }
    setBusy(true);
    setError(null);
    try {
      const cwd = await createBrandDirectory(parentDir, safeDirectoryName);
      onCreated(brandName, cwd);
    } catch (err) {
      setError(`创建品牌目录失败：${stringifyError(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dialog-layer brand-create-layer" role="presentation">
      <button className="dialog-backdrop" type="button" aria-label="关闭新建品牌" onClick={() => !busy && onClose()} />
      <form className="brand-create-dialog" role="dialog" aria-modal="true" aria-label="新建空白品牌" onSubmit={submit}>
        <header className="brand-create-head">
          <span className="brand-create-icon"><FolderPlus size={18} /></span>
          <div className="brand-create-title">
            <strong>新建空白品牌</strong>
            <span>创建后会生成一个同名品牌目录。</span>
          </div>
          <button type="button" className="icon-mini" onClick={onClose} aria-label="关闭" disabled={busy}>
            <X size={15} />
          </button>
        </header>

        <div className="brand-create-body">
          <label className="brand-create-field">
            <span>品牌名称</span>
            <input
              ref={inputRef}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setError(null);
              }}
              disabled={busy}
              placeholder="输入品牌名称"
            />
          </label>
          <div className="brand-create-field">
            <span>保存位置</span>
            <button type="button" className="brand-create-path" onClick={() => void chooseParent()} disabled={busy}>
              <FolderOpen size={15} />
              <span>{parent ? shortenPath(parent) : '选择父目录'}</span>
            </button>
          </div>
          {directoryName && (
            <div className="brand-create-preview">
              <Folder size={13} />
              <span>{directoryName}</span>
            </div>
          )}
          {error && <div className="brand-create-error"><AlertCircle size={13} />{error}</div>}
        </div>

        <div className="brand-create-actions">
          <button type="button" className="auth-btn ghost" onClick={onClose} disabled={busy}>取消</button>
          <button type="submit" className="auth-btn primary" disabled={!canCreate}>
            {busy ? <Loader2 size={13} className="spin" /> : <FolderPlus size={13} />}
            创建品牌
          </button>
        </div>
      </form>
    </div>
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
          {!conversation.pinned && (
            <button className="row-icon-btn" type="button" onClick={() => archiveConversation(conversation.id)} aria-label="归档对话" title="归档">
              <Archive size={14} />
            </button>
          )}
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
  emptyLabel,
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
  emptyLabel: string;
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
          <span className="project-name" title={project.cwd || '未指定品牌目录'}>{project.name}</span>
        )}
        {!editing && project.pinned && <Pin size={11} className="project-pin" />}
        {!editing && (
          <span className="project-actions" onClick={(event) => event.stopPropagation()}>
            <button className="row-icon-btn" type="button" onClick={onNewConversation} aria-label="在品牌中新建对话" title="新建对话">
              <SquarePen size={13} />
            </button>
            <button className={`row-icon-btn ${menuOpen ? 'active' : ''}`} type="button" onClick={(event) => onOpenMenu(anchorFromButton(event))} aria-label="品牌操作" title="更多">
              <MoreHorizontal size={15} />
            </button>
          </span>
        )}
      </div>
      {expanded && (
        <div className="project-children">
          {conversations.length === 0 ? (
            <div className="project-empty">{emptyLabel}</div>
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
  copy,
  onClose,
  onSelectConversation,
  onOpenProject,
  onNewConversation,
}: {
  open: boolean;
  conversations: Conversation[];
  projects: Project[];
  currentConversationId: string | null;
  copy: DomainConfig['ui']['sidebar'];
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
          <input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.searchPlaceholder} />
          <button type="button" className="icon-mini" onClick={onClose} aria-label="关闭搜索"><X size={14} /></button>
        </div>
        <div className="command-content">
          <button type="button" className="command-result new" onClick={onNewConversation}>
            <Plus size={15} />
            <span><strong>{copy.newConversationLabel}</strong><em>从空白上下文开始</em></span>
          </button>
          {projectResults.length > 0 && <CommandSection label="品牌">{projectResults.map((project) => (
            <button key={project.id} type="button" className="command-result" onClick={() => onOpenProject(project.id)}>
              <Folder size={15} />
              <span><strong>{project.name}</strong><em>{project.cwd ? shortenPath(project.cwd) : '未指定品牌目录'}</em></span>
            </button>
          ))}</CommandSection>}
          {conversationResults.length > 0 && <CommandSection label={normalized ? '匹配对话' : '最近对话'}>{conversationResults.map((conversation) => (
            <button key={conversation.id} type="button" className={`command-result ${conversation.id === currentConversationId ? 'active' : ''}`} onClick={() => onSelectConversation(conversation.id)}>
              {conversation.status === 'streaming' ? <Loader2 size={15} className="spin" /> : <MessageSquare size={15} />}
              <span><strong>{conversation.title}</strong><em>{conversation.cwd ? shortenPath(conversation.cwd) : '未指定品牌目录'} · {formatRelative(conversation.updatedAt)}</em></span>
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
  domain,
  sidebarCollapsed,
  featuresOpen,
  rightPanelOpen,
  onToggleSidebar,
  onToggleFeatures,
  onToggleRightPanel,
  onOpenSettings,
}: {
  domain: DomainConfig;
  sidebarCollapsed: boolean;
  featuresOpen: boolean;
  rightPanelOpen: boolean;
  onToggleSidebar: () => void;
  onToggleFeatures: () => void;
  onToggleRightPanel: () => void;
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
          icon: <MessageSquarePlus size={15} />,
          label: '对话副本',
          children: [
            { kind: 'item', icon: <Copy size={15} />, label: '复制为新对话', disabled: !hasMessages, onSelect: () => { duplicateConversation(conversation.id); } },
            { kind: 'item', icon: <SquarePen size={15} />, label: '新建空白对话', onSelect: () => { createConversation(conversation.projectId); } },
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
      {!featuresOpen && (
        <div className="top-bar-actions">
          <OpenInAppMenu cwd={cwd} />
          <button
            className={`icon-btn ${rightPanelOpen ? 'active' : ''}`}
            type="button"
            onClick={onToggleRightPanel}
            aria-label={rightPanelOpen ? '关闭侧边栏' : '打开侧边栏'}
            title={rightPanelOpen ? '关闭侧边栏' : '侧边栏'}
          >
            <PanelRight size={16} />
          </button>
        </div>
      )}
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

const OPEN_APP_ORDER: OpenAppId[] = ['finder'];

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
        title={cwd ? '打开品牌目录' : '当前对话未绑定品牌目录'}
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

function EnvironmentMenu({
  cwd,
  onOpenGit,
  onOpenQuickGit,
  onOpenSettings,
}: {
  cwd: string;
  onOpenGit: () => void;
  onOpenQuickGit: () => void;
  onOpenSettings: () => void;
}) {
  const conversation = useCurrentConversation();
  const [open, setOpen] = useState(false);
  const [stat, setStat] = useState<GitDiffStat | null>(null);
  const [branch, setBranch] = useState('');
  const [gh, setGh] = useState<GhAuthStatus | null>(null);
  const [isRepo, setIsRepo] = useState(false);
  const searchSources = useMemo(() => webSearchSources(conversation), [conversation]);

  useEffect(() => {
    if (!open || !cwd) {
      setIsRepo(false);
      setBranch('');
      setStat(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      setStat(null);
      try {
        const status = await gitStatus(cwd);
        if (cancelled) return;
        setIsRepo(status.isRepository);
        setBranch(status.branch || '');
        if (status.isRepository) {
          const diffStat = await gitDiffStat(cwd);
          if (cancelled) return;
          setStat(diffStat);
        } else {
          setStat(null);
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
                <button type="button" className="environment-row" onClick={() => { setOpen(false); onOpenQuickGit(); }}>
                  <GitCommitHorizontal size={15} />
                  <span className="environment-row-label">提交或推送</span>
                </button>
                <div className="environment-row static muted">
                  <Github size={15} />
                  <span className="environment-row-label">{ghLabel}</span>
                </div>
              </>
            ) : (
              <div className="environment-empty">
                {cwd ? `${basename(cwd)} 没有可用的版本记录。` : conversation ? '当前对话未绑定品牌目录。' : '请先选择一个对话。'}
              </div>
            )}
            {searchSources.length > 0 && (
              <>
                <div className="environment-menu-divider" />
                <div className="environment-menu-section">来源</div>
                {searchSources.map((source) => (
                  <button key={source.url} type="button" className="environment-row" onClick={() => { setOpen(false); void openExternal(source.url); }}>
                    <Globe size={15} />
                    <span className="environment-row-label">{source.title}</span>
                    <span className="environment-row-value">{source.displayUrl}</span>
                  </button>
                ))}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function QuickGitDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const conversation = useCurrentConversation();
  const cwd = conversation?.cwd || '';
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [stat, setStat] = useState<GitDiffStat | null>(null);
  const [commitMessage, setCommitMessage] = useState('');
  const [includeUnstaged, setIncludeUnstaged] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);

  const refresh = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      if (!cwd) {
        setStatus({ cwd: '', isRepository: false, ahead: 0, behind: 0, clean: true, changes: [], error: '当前对话未绑定品牌目录。' });
        setStat(null);
        return;
      }
      const next = await gitStatus(cwd);
      setStatus(next);
      setStat(next.isRepository ? await gitDiffStat(cwd) : null);
    } catch (err) {
      setError(stringifyError(err));
      setStatus(null);
      setStat(null);
    } finally {
      setBusy(false);
    }
  }, [cwd]);

  useEffect(() => {
    if (!open) return;
    setNotice(null);
    setError(null);
    setIncludeUnstaged(true);
    void refresh();
    requestAnimationFrame(() => messageRef.current?.focus());
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: WindowEventMap['keydown']) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  const runGit = useCallback(
    async (action: () => Promise<unknown>, done: string) => {
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        await action();
        await refresh();
        setNotice(done);
      } catch (err) {
        setError(stringifyError(err));
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const commitCurrent = useCallback(
    async (current: GitStatus) => {
      const paths = current.changes.map((change) => change.path);
      const staged = current.changes.filter((change) => change.staged);
      if (includeUnstaged && paths.length > 0) {
        await gitStage(cwd, paths);
      } else if (!includeUnstaged && staged.length === 0) {
        throw new Error('没有已暂存的更改。');
      }
      await gitCommit(cwd, commitMessage.trim() || quickGitCommitMessage(current));
      setCommitMessage('');
    },
    [commitMessage, cwd, includeUnstaged],
  );

  const changes = status?.changes ?? [];
  const branch = status?.branch || '';
  const isRepo = Boolean(status?.isRepository);
  const stagedCount = changes.filter((change) => change.staged).length;
  const unstagedCount = changes.filter((change) => change.unstaged || change.status === 'untracked').length;
  const committableCount = includeUnstaged ? changes.length : stagedCount;
  const hasBranch = Boolean(branch);
  const canCommit = isRepo && committableCount > 0 && !busy;
  const canCommitAndPush = canCommit && hasBranch;
  const canPush = isRepo && hasBranch && !busy && ((status?.ahead ?? 0) > 0 || !status?.upstream);
  const changeLabel = !status
    ? '读取中'
    : !status.isRepository
      ? '不可用'
      : changes.length === 0
        ? '无更改'
        : `${changes.length} 个更改`;

  const handleCommit = () => {
    if (!status || !canCommit) return;
    void runGit(() => commitCurrent(status), '已提交');
  };
  const handleCommitAndPush = () => {
    if (!status || !canCommitAndPush) return;
    void runGit(async () => {
      await commitCurrent(status);
      await gitPush(cwd, !status.upstream);
    }, '已提交并推送');
  };
  const handlePush = () => {
    if (!status || !canPush) return;
    void runGit(() => gitPush(cwd, !status.upstream), '已推送');
  };
  const handleMessageKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      handleCommit();
    }
  };

  if (!open) return null;

  return (
    <div className="dialog-layer quick-git-layer" role="presentation">
      <button className="dialog-backdrop" type="button" aria-label="关闭快速提交" onClick={onClose} />
      <section className="quick-git-dialog" role="dialog" aria-modal="true" aria-label="快速提交推送" aria-busy={busy}>
        <header className="quick-git-head">
          <div className="quick-git-branch" title={branch || undefined}>
            <GitBranch size={14} />
            <span>{branch || 'detached'}</span>
          </div>
          <div className="quick-git-state">
            <span>{changeLabel}</span>
            {stat && changes.length > 0 && (
              <span className="quick-git-stat">
                <span className="stat-add">+{stat.additions.toLocaleString()}</span>
                <span className="stat-del">-{stat.deletions.toLocaleString()}</span>
              </span>
            )}
          </div>
          <button type="button" className="icon-mini" onClick={onClose} aria-label="关闭快速提交"><X size={14} /></button>
        </header>

        <div className="quick-git-message">
          <textarea
            ref={messageRef}
            value={commitMessage}
            onChange={(event) => setCommitMessage(event.target.value)}
            onKeyDown={handleMessageKeyDown}
            placeholder="提交信息（留空将自动生成）..."
            rows={3}
            spellCheck={false}
            disabled={!isRepo || changes.length === 0 || busy}
          />
        </div>

        <label className="quick-git-check">
          <input
            type="checkbox"
            checked={includeUnstaged}
            onChange={(event) => setIncludeUnstaged(event.target.checked)}
            disabled={!isRepo || changes.length === 0 || busy}
          />
          <span>包含未暂存的更改</span>
          {unstagedCount > 0 && <em>{unstagedCount}</em>}
        </label>

        {(error || status?.error || notice) && (
          <div className={`quick-git-note ${error || status?.error ? 'error' : 'success'}`}>
            {error || status?.error ? <AlertCircle size={13} /> : <Check size={13} />}
            <span>{error || status?.error || notice}</span>
          </div>
        )}

        <div className="quick-git-actions" role="group" aria-label="Git 快速操作">
          <button type="button" className="quick-git-action primary" disabled={!canCommit} onClick={handleCommit}>
            <span>{busy ? <Loader2 size={14} className="spin" /> : <GitCommitHorizontal size={14} />}提交</span>
            <kbd>⌘↩</kbd>
          </button>
          <button type="button" className="quick-git-action" disabled={!canCommitAndPush} onClick={handleCommitAndPush}>
            <span><Upload size={14} />提交并推送</span>
          </button>
          <button type="button" className="quick-git-action" disabled={!canPush} onClick={handlePush}>
            <span><Upload size={14} />推送</span>
          </button>
        </div>
      </section>
    </div>
  );
}

function quickGitCommitMessage(status: GitStatus): string {
  if (status.changes.length === 0) return '更新工作区';
  if (status.changes.length === 1) {
    const change = status.changes[0];
    return `${quickGitChangeVerb(change)} ${change.path}`;
  }
  return `更新 ${status.changes.length} 个文件`;
}

function quickGitChangeVerb(change: GitFileChange): string {
  switch (change.status) {
    case 'added':
    case 'untracked':
      return '添加';
    case 'deleted':
      return '删除';
    case 'renamed':
      return '重命名';
    case 'copied':
      return '复制';
    default:
      return '更新';
  }
}

interface WebSearchSource {
  title: string;
  url: string;
  displayUrl: string;
}

function webSearchSources(conversation?: Conversation | null): WebSearchSource[] {
  if (!conversation) return [];
  const sources = new Map<string, WebSearchSource>();

  for (let messageIndex = conversation.messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const blocks = conversation.messages[messageIndex].blocks;
    for (let blockIndex = blocks.length - 1; blockIndex >= 0; blockIndex -= 1) {
      const block = blocks[blockIndex];
      if (block.type !== 'tool' || !isWebSearchToolTitle(block.title)) continue;
      const text = [block.output, block.input].filter(Boolean).join('\n');
      for (const source of extractWebSearchSources(text)) {
        if (!sources.has(source.url)) sources.set(source.url, source);
        if (sources.size >= 5) return Array.from(sources.values());
      }
    }
  }

  return Array.from(sources.values());
}

function isWebSearchToolTitle(title: string): boolean {
  const normalized = title.trim().toLowerCase();
  return ['web_search', 'websearch', 'web.run', 'web.search', 'browse_search'].some((key) => normalized.includes(key));
}

function extractWebSearchSources(text: string): WebSearchSource[] {
  const sources = new Map<string, WebSearchSource>();
  const add = (rawLabel: string, rawUrl: string) => {
    const url = normalizeHttpUrl(rawUrl);
    if (!url || sources.has(url)) return;
    sources.set(url, {
      title: webSourceTitle(rawLabel, url),
      url,
      displayUrl: shortWebUrl(url),
    });
  };

  const jsonTitleUrlPattern = /"title"\s*:\s*"([^"]{1,160})"[\s\S]{0,500}?"url"\s*:\s*"(https?:\/\/[^"]+)"/gi;
  for (const match of text.matchAll(jsonTitleUrlPattern)) {
    add(decodeJsonText(match[1]), decodeJsonText(match[2]));
  }

  const markdownPattern = /\[([^\]\n]{1,160})\]\((https?:\/\/[^\s)]+)\)/gi;
  for (const match of text.matchAll(markdownPattern)) {
    add(match[1], match[2]);
  }

  const urlPattern = /\bhttps?:\/\/[^\s<>"'`)\]}]+/gi;
  for (const match of text.matchAll(urlPattern)) {
    add('', match[0]);
  }

  return Array.from(sources.values());
}

function decodeJsonText(value: string): string {
  return value
    .replace(/\\"/g, '"')
    .replace(/\\\//g, '/')
    .replace(/\\n/g, ' ');
}

function normalizeHttpUrl(value: string): string | null {
  const cleaned = value.trim().replace(/[.,;:]+$/g, '');
  try {
    const url = new URL(cleaned);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.hash = '';
    return url.href.replace(/\/$/g, '');
  } catch {
    return null;
  }
}

function webSourceTitle(label: string, url: string): string {
  const cleaned = stripAnsi(label).replace(/\s+/g, ' ').trim();
  if (cleaned && !/^https?:\/\//i.test(cleaned)) {
    return cleaned.length > 34 ? `${cleaned.slice(0, 33)}…` : cleaned;
  }
  return hostFromUrl(url);
}

function shortWebUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');
    const path = parsed.pathname === '/' ? '' : parsed.pathname;
    const display = `${host}${path}`;
    return display.length > 38 ? `${display.slice(0, 37)}…` : display;
  } catch {
    return url.length > 38 ? `${url.slice(0, 37)}…` : url;
  }
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

type TerminalTab = { id: string; title: string };

function cssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function terminalTheme(): ITheme {
  const dark = document.documentElement.dataset.theme !== 'light';
  const foreground = cssVar('--text', dark ? '#f1f1f1' : '#1f1f1f');
  return {
    background: cssVar('--bg', dark ? '#151515' : '#ffffff'),
    foreground,
    cursor: foreground,
    cursorAccent: cssVar('--bg', dark ? '#151515' : '#ffffff'),
    selectionBackground: dark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.16)',
  };
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function TerminalInstance({
  cwd,
  active,
  theme,
}: {
  cwd: string;
  active: boolean;
  theme: Theme;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionRef = useRef('');

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new XTerm({
      fontFamily: cssVar('--mono', 'ui-monospace, Menlo, monospace'),
      fontSize: 12.5,
      lineHeight: 1.25,
      cursorBlink: true,
      allowProposedApi: true,
      theme: terminalTheme(),
      scrollback: 10_000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    try {
      fit.fit();
    } catch {
      /* container may not be measurable yet */
    }
    termRef.current = term;
    fitRef.current = fit;

    const dataDisposable = term.onData((data) => {
      if (sessionRef.current) void terminalWrite(sessionRef.current, data);
    });
    const resizeDisposable = term.onResize(({ rows, cols }) => {
      if (sessionRef.current) void terminalResize(sessionRef.current, rows, cols);
    });

    let mounted = true;
    let unlisten: (() => void) | null = null;
    void (async () => {
      const unsub = await subscribeTerminalEvents((event) => {
        if (event.sessionId !== sessionRef.current) return;
        if (event.type === 'output' && event.chunk) {
          term.write(base64ToBytes(event.chunk));
        } else if (event.type === 'exit') {
          sessionRef.current = '';
          term.write('\r\n\x1b[2m[shell 已结束]\x1b[0m\r\n');
        }
      });
      if (!mounted) {
        unsub?.();
        return;
      }
      unlisten = unsub;
      if (!isTauriRuntime()) {
        term.write('\x1b[2m（浏览器预览模式下终端不可用，请在桌面应用中使用。）\x1b[0m\r\n');
        return;
      }
      try {
        const id = await terminalStart(cwd, term.rows, term.cols);
        if (!mounted) {
          if (id) void terminalStop(id);
          return;
        }
        sessionRef.current = id;
        if (active) term.focus();
      } catch (err) {
        term.write(`\x1b[31m${stringifyError(err)}\x1b[0m\r\n`);
      }
    })();

    const observer = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        /* hidden tabs report 0x0; ignore */
      }
    });
    observer.observe(container);

    return () => {
      mounted = false;
      observer.disconnect();
      dataDisposable.dispose();
      resizeDisposable.dispose();
      unlisten?.();
      const id = sessionRef.current;
      sessionRef.current = '';
      if (id) void terminalStop(id);
      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // The app writes `data-theme` in a parent effect, which commits after this
    // child effect; defer one frame so the CSS variables reflect the new theme.
    const id = window.requestAnimationFrame(() => {
      if (termRef.current) termRef.current.options.theme = terminalTheme();
    });
    return () => window.cancelAnimationFrame(id);
  }, [theme]);

  useEffect(() => {
    if (!active) return;
    const id = window.requestAnimationFrame(() => {
      try {
        fitRef.current?.fit();
      } catch {
        /* ignore */
      }
      termRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, [active]);

  return <div className={`terminal-surface ${active ? '' : 'hidden'}`} ref={containerRef} />;
}

function TerminalPanel({ theme, onClose }: { theme: Theme; onClose: () => void }) {
  const conversation = useCurrentConversation();
  const cwd = conversation?.cwd || '';
  const baseName = basename(cwd) || '终端';
  const counterRef = useRef(0);

  const createTab = (): TerminalTab => {
    counterRef.current += 1;
    return {
      id: `term-${Date.now()}-${counterRef.current}`,
      title: `${baseName} ${counterRef.current}`,
    };
  };

  const [tabs, setTabs] = useState<TerminalTab[]>(() => [createTab()]);
  const [activeId, setActiveId] = useState<string>(() => tabs[0]?.id ?? '');
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  const addTab = () => {
    const tab = createTab();
    setTabs((prev) => [...prev, tab]);
    setActiveId(tab.id);
  };

  const closeTab = (id: string) => {
    const prev = tabsRef.current;
    const index = prev.findIndex((tab) => tab.id === id);
    if (index === -1) return;
    const next = prev.filter((tab) => tab.id !== id);
    if (next.length === 0) {
      onClose();
      return;
    }
    setTabs(next);
    setActiveId((current) =>
      current === id ? next[Math.min(index, next.length - 1)].id : current,
    );
  };

  return (
    <section className="terminal-panel" aria-label="终端">
      <header className="terminal-panel-head">
        <div className="terminal-tabs">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className={`terminal-tab ${tab.id === activeId ? 'active' : ''}`}
              onClick={() => setActiveId(tab.id)}
              role="tab"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') setActiveId(tab.id);
              }}
            >
              <SquareTerminal size={13} />
              <span className="terminal-tab-label">{tab.title}</span>
              <button
                type="button"
                className="terminal-tab-close"
                aria-label="关闭终端"
                title="关闭"
                onClick={(event) => {
                  event.stopPropagation();
                  closeTab(tab.id);
                }}
              >
                <X size={12} />
              </button>
            </div>
          ))}
          <button type="button" className="terminal-tab-add" onClick={addTab} title="新建终端">
            <Plus size={14} />
          </button>
        </div>
        <span className="spacer" />
        <button
          type="button"
          className="icon-mini"
          onClick={onClose}
          aria-label="收起终端面板"
          title="收起"
        >
          <ChevronDown size={16} />
        </button>
      </header>
      <div className="terminal-panel-bodies">
        {tabs.map((tab) => (
          <TerminalInstance key={tab.id} cwd={cwd} active={tab.id === activeId} theme={theme} />
        ))}
      </div>
    </section>
  );
}

function FeaturesPanel({
  domain,
  tabState,
  onTabStateChange,
  onNextTabNumber,
  onOpenReviewChanges,
  onOpenTerminal,
  fullscreen,
  onToggleFullscreen,
  onAgentContextChange,
  onClose,
}: {
  domain: DomainConfig;
  tabState: FeatureSidebarTabState;
  onTabStateChange: Dispatch<SetStateAction<FeatureSidebarTabState>>;
  onNextTabNumber: () => number;
  onOpenReviewChanges: () => void;
  onOpenTerminal: () => void;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  onAgentContextChange: Dispatch<SetStateAction<FeatureAgentContext | null>>;
  onClose: () => void;
}) {
  const conversation = useCurrentConversation();
  const cwd = conversation?.cwd || '';
  const codexStatus = useChatStore((state) => state.codexStatus);
  const previewRuntime = !isTauriRuntime();
  const codexReady = previewRuntime || Boolean(codexStatus?.installed && codexStatus.loggedIn);
  const [featureMenu, setFeatureMenu] = useState<SidebarMenu | null>(null);
  const featureByAction = useMemo(
    () => new Map(domain.ui.features.map((feature) => [feature.action, feature])),
    [domain.ui.features],
  );

  const runFeature = (feature: DomainFeature) => {
    if (feature.requiresCwd && !cwd) return;
    switch (feature.action) {
      case 'reveal-cwd':
        if (cwd) void revealPath(cwd);
        break;
      case 'open-url': {
        const url = window.prompt('输入要打开的网址', 'https://');
        if (url && url.trim()) void openExternal(url.trim());
        break;
      }
      case 'open-review':
        onOpenReviewChanges();
        break;
      case 'open-terminal':
        onOpenTerminal();
        break;
    }
  };

  const browserFeature = featureByAction.get('open-url');
  const filesFeature = featureByAction.get('reveal-cwd');
  const focusComposer = () => {
    document.querySelector<HTMLTextAreaElement>('.composer-textarea')?.focus();
  };
  const addPartnerMarketingTab = () => {
    const tabNumber = onNextTabNumber();
    const tab: FeatureSidebarTab = {
      id: `partner-marketing-${tabNumber}`,
      kind: 'partner-marketing',
      title: tabNumber === 1 ? PARTNER_MARKETING_LABEL : `${PARTNER_MARKETING_LABEL} ${tabNumber}`,
    };
    onTabStateChange((state) => ({
      tabs: [...state.tabs, tab],
      activeId: tab.id,
    }));
  };
  const selectFeatureTab = (id: string) => {
    onTabStateChange((state) => ({
      ...state,
      activeId: id,
    }));
  };
  const closeFeatureTab = (event: ReactMouseEvent, id: string) => {
    event.stopPropagation();
    onTabStateChange((state) => {
      const closingIndex = state.tabs.findIndex((tab) => tab.id === id);
      if (closingIndex < 0) return state;
      const tabs = state.tabs.filter((tab) => tab.id !== id);
      const activeId = state.activeId === id
        ? tabs[closingIndex]?.id || tabs[closingIndex - 1]?.id || null
        : tabs.some((tab) => tab.id === state.activeId)
          ? state.activeId
          : tabs[0]?.id || null;
      return { tabs, activeId };
    });
  };
  const activeTab = tabState.tabs.find((tab) => tab.id === tabState.activeId) || null;
  useEffect(() => {
    if (activeTab) return;
    onAgentContextChange({
      id: 'feature-hub',
      kind: 'feature-hub',
      title: '功能入口',
      body: buildFeatureHubAgentContext(),
    });
    return () => onAgentContextChange(null);
  }, [activeTab, onAgentContextChange]);
  const featureActions: Array<{
    id: string;
    label: string;
    icon: ReactNode;
    shortcut?: string;
    disabled?: boolean;
    active?: boolean;
    title?: string;
    onClick: () => void;
  }> = [
    {
      id: 'partner-marketing',
      label: PARTNER_MARKETING_LABEL,
      icon: <Target size={14} />,
      title: '打开合作推广营销标签',
      onClick: addPartnerMarketingTab,
    },
    {
      id: 'terminal',
      label: '终端',
      icon: <SquareTerminal size={14} />,
      shortcut: '⌃`',
      title: '打开底部终端',
      onClick: onOpenTerminal,
    },
    {
      id: 'browser',
      label: '浏览器',
      icon: <Globe size={14} />,
      shortcut: browserFeature?.shortcut || '⌘T',
      title: browserFeature?.desc || '打开网页',
      onClick: () => browserFeature ? runFeature(browserFeature) : void openExternal('https://'),
    },
    {
      id: 'files',
      label: '文件',
      icon: <FolderOpen size={14} />,
      shortcut: filesFeature?.shortcut || '⌘P',
      disabled: !cwd,
      title: cwd ? (filesFeature?.desc || '打开品牌文件夹') : '当前对话未绑定品牌目录',
      onClick: () => filesFeature ? runFeature(filesFeature) : void revealPath(cwd),
    },
    {
      id: 'side-chat',
      label: '侧边聊天',
      icon: <MessageSquare size={14} />,
      shortcut: '⌥⌘S',
      active: true,
      title: '聚焦当前对话输入框',
      onClick: focusComposer,
    },
  ];
  const openFeatureAddMenu = (event: ReactMouseEvent) => {
    const anchor = anchorFromButton(event);
    const menuItems = featureActions.map<MenuNode>((feature) => ({
      kind: 'item',
      icon: feature.icon,
      label: feature.label,
      shortcut: feature.shortcut,
      disabled: feature.disabled,
      onSelect: feature.onClick,
    }));
    setFeatureMenu({
      owner: 'feature-tab-add',
      ...anchor,
      items: menuItems,
    });
  };

  return (
    <aside className="features-panel right-dock-panel">
      <header className={`features-panel-head ${tabState.tabs.length > 0 ? 'with-tabs' : ''}`} data-tauri-drag-region>
        {tabState.tabs.length > 0 && (
          <div className="feature-tabs" role="tablist" aria-label="侧边栏标签">
            {tabState.tabs.map((tab) => (
              <div key={tab.id} className={`feature-tab ${tab.id === activeTab?.id ? 'active' : ''}`}>
                <button
                  type="button"
                  className="feature-tab-select"
                  role="tab"
                  aria-selected={tab.id === activeTab?.id}
                  onClick={() => selectFeatureTab(tab.id)}
                  title={tab.title}
                >
                  <Target size={13} />
                  <span className="feature-tab-title">{tab.title}</span>
                </button>
                <button
                  type="button"
                  className="feature-tab-close"
                  onClick={(event) => closeFeatureTab(event, tab.id)}
                  aria-label={`关闭 ${tab.title}`}
                  title="关闭标签"
                >
                  <X size={11} />
                </button>
              </div>
            ))}
            <button
              type="button"
              className={`feature-tab-add ${featureMenu ? 'active' : ''}`}
              onClick={openFeatureAddMenu}
              aria-label="新增功能页标签"
              aria-haspopup="menu"
              aria-expanded={Boolean(featureMenu)}
              title="新增功能页"
            >
              <Plus size={14} />
            </button>
          </div>
        )}
        <div className="features-panel-actions">
          <OpenInAppMenu cwd={cwd} />
          <button
            type="button"
            className={`icon-btn ${fullscreen ? 'active' : ''}`}
            onClick={onToggleFullscreen}
            aria-label={fullscreen ? '退出功能侧栏全屏' : '功能侧栏全屏'}
            title={fullscreen ? '退出全屏' : '功能侧栏全屏'}
          >
            {fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
          <button type="button" className="icon-btn active" onClick={onClose} aria-label="关闭侧边栏" title="关闭侧边栏">
            <PanelRight size={16} />
          </button>
        </div>
      </header>
      <div className={`features-panel-body ${activeTab ? 'with-tab-content' : ''}`}>
        {activeTab ? (
          <FeatureTabContent
            tab={activeTab}
            domain={domain}
            fullscreen={fullscreen}
            onAgentContextChange={onAgentContextChange}
          />
        ) : (
          <div className="features-list">
            {featureActions.map((feature) => (
              <button
                key={feature.id}
                type="button"
                className={`feature-card ${feature.active ? 'active' : ''}`}
                disabled={feature.disabled}
                onClick={feature.onClick}
                title={feature.title}
              >
                <span className="feature-card-main">
                  <span className="feature-card-icon">{feature.icon}</span>
                  <span className="feature-card-title">{feature.label}</span>
                </span>
                {feature.shortcut && <span className="feature-card-key">{feature.shortcut}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
      {fullscreen && !activeTab && conversation && (
        <FeatureAgentDock
          domain={domain}
          conversation={conversation}
          disabled={!codexReady}
          agentContext={buildFeatureHubAgentContext()}
          agentContextResolver={() => resolveFeatureAgentContext({
            id: 'feature-hub',
            kind: 'feature-hub',
            title: '功能入口',
            body: buildFeatureHubAgentContext(),
          })}
        />
      )}
      {featureMenu && <ContextMenu menu={featureMenu} onClose={() => setFeatureMenu(null)} />}
    </aside>
  );
}

function FeatureTabContent({
  tab,
  domain,
  fullscreen,
  onAgentContextChange,
}: {
  tab: FeatureSidebarTab;
  domain: DomainConfig;
  fullscreen: boolean;
  onAgentContextChange: Dispatch<SetStateAction<FeatureAgentContext | null>>;
}) {
  switch (tab.kind) {
    case 'partner-marketing':
      return (
        <PartnerMarketingTab
          title={tab.title}
          domain={domain}
          fullscreen={fullscreen}
          onAgentContextChange={onAgentContextChange}
        />
      );
  }
}

// ===== 合作推广营销：网红营销工作流 =====

type MarketingView = 'classify' | 'evaluate' | 'process' | 'intake' | 'collab' | 'ship' | 'kol' | 'other' | 'scripts' | 'logs';

interface WorkflowStepDef {
  id: number;
  key: MarketingView | null;
  short: string;
  title: string;
  desc: string;
}

const MARKETING_WORKFLOW_STEPS: WorkflowStepDef[] = [
  { id: 1, key: 'classify', short: 'Step 1', title: '初步分类', desc: 'AI 预分类达人 / 联盟 / 其他，人工一键确认；广告自动隐藏' },
  { id: 2, key: 'evaluate', short: 'Step 2', title: '网红评估', desc: '按硬性 + 软性指标评估达人，AI 出结论，人工确认' },
  { id: 3, key: 'process', short: 'Step 3', title: '评估后处理', desc: '通过发提案、不通过发拒绝话术，记录外联动作' },
  { id: 4, key: 'intake', short: 'Step 4', title: '录入系统', desc: '待回复意向后完善 KOL 档案、联系方式与账号数据' },
  { id: 5, key: 'collab', short: 'Step 5', title: '合作推进', desc: '发送合同、处理异议，推进到签约' },
  { id: 6, key: 'ship', short: 'Step 6', title: '发货流程', desc: '已签约后安排发货、回传物流并跟进内容' },
];

interface EvalCriterionMeta {
  key: EvalCriterionKey;
  label: string;
  kind: 'hard' | 'soft';
  hint: string;
}

const EVAL_CRITERIA_CATALOG: EvalCriterionMeta[] = [
  { key: 'vertical', label: '应用场景与 ZERO BREEZE 垂直', kind: 'hard', hint: '露营 / 房车 / 户外 / 极热环境等场景' },
  { key: 'language', label: '国家 / 语言合适（非西 / 德语）', kind: 'hard', hint: '暂不考虑西班牙语、德语受众' },
  { key: 'followers', label: '粉丝量 ≥ 10k', kind: 'soft', hint: '全网或主平台粉丝量' },
  { key: 'views', label: '播放量 ≥ 粉丝数 30%', kind: 'soft', hint: '平均播放量 / 粉丝数' },
  { key: 'engagement', label: '平均点赞 / 评论 ≥ 100', kind: 'soft', hint: '平均互动量' },
  { key: 'recency', label: '近 30 天持续更新', kind: 'soft', hint: '更新频率' },
];

const EVAL_STATUS_OPTIONS: Array<{ value: EvalCriterionStatus; label: string }> = [
  { value: 'pass', label: '通过' },
  { value: 'fail', label: '不符' },
  { value: 'unknown', label: '未知' },
];

function defaultEvalCriteria(existing?: EvalCriterion[]): EvalCriterion[] {
  return EVAL_CRITERIA_CATALOG.map((meta) => {
    const prior = existing?.find((item) => item.key === meta.key);
    return {
      key: meta.key,
      label: meta.label,
      kind: meta.kind,
      status: prior?.status ?? 'unknown',
      detail: prior?.detail ?? '',
    };
  });
}

function parseKolEvaluation(raw?: string | null): KolEvaluation | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as KolEvaluation;
    if (!parsed || !Array.isArray(parsed.criteria)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function computeVerdict(criteria: EvalCriterion[]): EvalVerdict {
  if (criteria.length === 0) return 'pending';
  const hard = criteria.filter((item) => item.kind === 'hard');
  const soft = criteria.filter((item) => item.kind === 'soft');
  // Hard requirements gate everything: any fail rejects; any unknown is undecidable.
  if (hard.some((item) => item.status === 'fail')) return 'fail';
  if (hard.some((item) => item.status === 'unknown')) return 'pending';
  // All hard criteria pass; need at least two soft passes.
  const softPass = soft.filter((item) => item.status === 'pass').length;
  const softUnknown = soft.filter((item) => item.status === 'unknown').length;
  if (softPass >= 2) return 'pass';
  if (softPass + softUnknown >= 2) return 'pending';
  return 'fail';
}

function verdictLabel(verdict: EvalVerdict): string {
  if (verdict === 'pass') return '评估通过';
  if (verdict === 'fail') return '评估不通过';
  return '待补充指标';
}

function verdictShort(verdict: EvalVerdict): string {
  if (verdict === 'pass') return '通过';
  if (verdict === 'fail') return '未通过';
  return '待定';
}

type EvalBucket = 'todo' | 'pass' | 'fail';

// Classify a KOL by its current evaluation outcome so the Step 2 list can be
// filtered by verdict. "todo" covers both un-evaluated and undecided (pending).
function kolEvalBucket(kol: KolProfile): EvalBucket {
  const evaluation = parseKolEvaluation(kol.evaluation);
  if (!evaluation || evaluation.status === 'pending') return 'todo';
  return evaluation.status === 'pass' ? 'pass' : 'fail';
}

function parseKolOutreach(raw?: string | null): KolOutreach | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as KolOutreach;
    if (!parsed || typeof parsed.status !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

type ProcessBucket = 'todo' | 'done' | 'none';

// Step 3 评估后处理 worklist membership. A KOL becomes a "todo" once its
// evaluation is confirmed (pipeline_stage qualified/rejected) and no outreach
// has been recorded; recording an outreach (or advancing to onboarding) marks
// it "done". KOLs still in classify/evaluate are "none" (not ready for Step 3).
function kolProcessBucket(kol: KolProfile): ProcessBucket {
  const hasOutreach = !!parseKolOutreach(kol.outreach);
  const stage = kol.pipelineStage;
  if (stage === 'qualified' || stage === 'rejected') {
    return hasOutreach ? 'done' : 'todo';
  }
  if (stage === 'onboarding') return 'done';
  return hasOutreach ? 'done' : 'none';
}

function outreachKindLabel(kind: string): string {
  switch (kind) {
    case 'proposal':
      return '已发提案';
    case 'reject':
      return '已发拒绝';
    case 'koc':
      return 'KOC 婉拒';
    case 'paid':
      return '付费置换';
    case 'skip':
      return '暂不联系';
    default:
      return kind || '已处理';
  }
}

function pipelineStageLabel(stage: string): string {
  switch (stage) {
    case 'classify':
      return '待分类';
    case 'evaluate':
      return '待评估';
    case 'qualified':
      return '评估通过';
    case 'rejected':
      return '评估不通过';
    case 'onboarding':
      return '待录入';
    case 'intake':
      return '推进合作';
    case 'signed':
      return '已签约';
    case 'shipped':
      return '已发货';
    case 'completed':
      return '已完成';
    default:
      return stage || '待评估';
  }
}

// Linear position of a KOL in the 6-step funnel. Mirrors the Rust `stage_rank` so
// the Step 4–6 worklists gate on completed earlier steps and only show ready KOLs.
const STAGE_RANK: Record<string, number> = {
  classify: 0,
  evaluate: 1,
  qualified: 2,
  rejected: 2,
  onboarding: 3,
  intake: 4,
  signed: 5,
  shipped: 6,
  completed: 7,
};

function stageRank(stage: string): number {
  return STAGE_RANK[stage] ?? 1;
}

// Worklist membership shared by Step 4–6: "none" = earlier step unfinished (not
// ready), "todo" = this step is the current action, "done" = already handled.
type StepBucket = 'todo' | 'done' | 'none';

function parseKolIntake(raw?: string | null): KolIntake | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as KolIntake;
    return parsed && typeof parsed.status === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

function parseKolCollab(raw?: string | null): KolCollab | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as KolCollab;
    return parsed && typeof parsed.status === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

function parseKolShipment(raw?: string | null): KolShipment | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as KolShipment;
    return parsed && typeof parsed.status === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

// Step 4 录入系统: a KOL is ready once a proposal was sent (stage onboarding) and
// becomes done once the intake form is saved (stage advances to intake+).
function kolIntakeBucket(kol: KolProfile): StepBucket {
  const rank = stageRank(kol.pipelineStage);
  if (rank < 3) return 'none';
  if (rank >= 4) return 'done';
  return parseKolIntake(kol.intake)?.status === 'done' ? 'done' : 'todo';
}

// Step 5 合作推进: ready after intake; done when signed (stage signed+) or 流失.
function kolCollabBucket(kol: KolProfile): StepBucket {
  const rank = stageRank(kol.pipelineStage);
  if (rank < 4) return 'none';
  if (rank >= 5) return 'done';
  const collab = parseKolCollab(kol.collaboration);
  return collab && (collab.status === 'signed' || collab.status === 'declined') ? 'done' : 'todo';
}

// Step 6 发货流程: ready after signed; done once shipped/delivered (stage shipped+).
function kolShipBucket(kol: KolProfile): StepBucket {
  const rank = stageRank(kol.pipelineStage);
  if (rank < 5) return 'none';
  if (rank >= 6) return 'done';
  const ship = parseKolShipment(kol.shipment);
  return ship && (ship.status === 'shipped' || ship.status === 'delivered') ? 'done' : 'todo';
}

function collabStatusLabel(status: string): string {
  switch (status) {
    case 'signed':
      return '已签约';
    case 'declined':
      return '已流失';
    case 'sent':
      return '已发合同';
    default:
      return status || '推进中';
  }
}

function shipmentStatusLabel(status: string): string {
  switch (status) {
    case 'delivered':
      return '已完成';
    case 'issue':
      return '物流异常';
    case 'shipped':
      return '已发货';
    default:
      return status || '待发货';
  }
}

// <input type="date"> works in local YYYY-MM-DD; convert to/from epoch millis.
function msToDateInput(ms?: number | null): string {
  if (!ms) return '';
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function dateInputToMs(value: string): number | null {
  if (!value.trim()) return null;
  const ms = new Date(`${value}T00:00:00`).getTime();
  return Number.isNaN(ms) ? null : ms;
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// Email snippets arrive with raw whitespace, tracking junk, and long URLs.
// Collapse whitespace and shorten bare URLs so the preview is readable.
function cleanEmailText(raw: string): string {
  return raw
    .replace(/\s+/g, ' ')
    .replace(/(https?:\/\/[^\s]{40})[^\s]+/g, '$1…')
    .trim();
}

// --- Editable script library persistence (localStorage) ---
const SCRIPT_OVERRIDES_KEY = 'alpha.marketing.scriptOverrides';
const SCRIPT_CUSTOM_KEY = 'alpha.marketing.scriptCustom';
type ScriptOverride = Pick<ScriptTemplate, 'title' | 'channel' | 'body'>;

function loadScriptOverrides(): Record<string, ScriptOverride> {
  try {
    const parsed = JSON.parse(localStorage.getItem(SCRIPT_OVERRIDES_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, ScriptOverride>) : {};
  } catch {
    return {};
  }
}

function loadCustomScripts(): ScriptTemplate[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(SCRIPT_CUSTOM_KEY) ?? '[]');
    return Array.isArray(parsed) ? (parsed as ScriptTemplate[]) : [];
  } catch {
    return [];
  }
}

// --- Reusable script variables (协议链接 / 联系方式 / 署名) ---
// Scripts reference these via {{key}} placeholders so links and contact details
// are edited once in the 话术库 config card instead of inside every template.
const SCRIPT_VARS_KEY = 'alpha.marketing.scriptVars';

interface ScriptVarDef {
  key: string;
  label: string;
  hint?: string;
  defaultValue: string;
}

const SCRIPT_VAR_DEFS: ScriptVarDef[] = [
  { key: 'signature', label: '落款 / 署名', hint: '话术结尾的发件人署名', defaultValue: 'Oliver' },
  { key: 'proposalUrl', label: '合作提案 / 协议链接', defaultValue: 'https://docs.google.com/document/d/1ttZpiAPcopBann_KbYHiRaoL0PVkyHM1_Z-91Wo8eGM/edit?tab=t.0' },
  { key: 'contentGuideUrl', label: '内容指南链接', defaultValue: 'https://drive.google.com/file/d/10c7YZlpfPGPny-Dyr92rA1FTZCkkY6Gz/view?usp=sharing' },
  { key: 'whatsapp', label: 'WhatsApp / 电话', defaultValue: '+1 (213) 801-2228' },
  { key: 'email', label: '联系邮箱', defaultValue: 'marketing@zerobreeze.com' },
  { key: 'website', label: '官网', defaultValue: 'https://www.zerobreeze.com/' },
  { key: 'instagram', label: 'Instagram', defaultValue: 'https://www.instagram.com/zerobreezeofficial/' },
];

function defaultScriptVars(): Record<string, string> {
  return Object.fromEntries(SCRIPT_VAR_DEFS.map((def) => [def.key, def.defaultValue]));
}

function loadScriptVars(): Record<string, string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(SCRIPT_VARS_KEY) ?? '{}');
    const stored = parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
    return { ...defaultScriptVars(), ...stored };
  } catch {
    return defaultScriptVars();
  }
}

// Substitute {{key}} placeholders; unknown/empty values keep the literal token.
function renderScript(body: string, vars: Record<string, string>): string {
  return body.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    const value = vars[key];
    return value !== undefined && value !== '' ? value : match;
  });
}

interface ScriptTemplate {
  id: string;
  group: string;
  title: string;
  channel: string;
  body: string;
}

const SCRIPT_LIBRARY: ScriptTemplate[] = [
  {
    id: 'proposal-inbound',
    group: '合作前 · 建联',
    title: '主动联系我们 · 评估通过发提案',
    channel: '通用',
    body: `Hi，
Thank you for reaching out to us! We're thrilled to hear about your interest in collaborating with Zerobreeze. Our team is always excited to partner with passionate influencers like you.
We're currently seeking product exchange partners. I've attached our Content Guide and included our proposal contract below:

Proposal Contract: {{proposalUrl}}

Content Guide: {{contentGuideUrl}}

If you have any concern regarding the dates and numbers for the videos, kindly note that this contract is a template. You do not need to sign the template. We will send you a new contract once we established our collaboration.

Let me know if you're interested or have any questions after reviewing.

We can continue the conversation here via DM, WhatsApp, or email. My contact info:
- WhatsApp: {{whatsapp}}
- Email: {{email}}

Stay cool,
{{signature}}`,
  },
  {
    id: 'outreach-ig',
    group: '合作前 · 建联',
    title: '主动建联 · IG 私信模版',
    channel: 'IG DM',
    body: `Hi there！Your setup and content look amazing!

We are ZERO BREEZE. We're currently seeking product exchange partners. I've attached our Content Guide and included our proposal contract below:

Proposal Contract: {{proposalUrl}}

Content Guide: {{contentGuideUrl}}

You do not need to sign the template. We will send you a new contract once we established our collaboration.

We can continue the conversation here via DM, WhatsApp, or email:
- WhatsApp: {{whatsapp}}
- Email: {{email}}

Stay cool,
ZERO BREEZE`,
  },
  {
    id: 'outreach-email',
    group: '合作前 · 建联',
    title: '主动建联 · 邮件（一般情况）',
    channel: 'Email',
    body: `Subject: Partner with us? Stay cool on your next adventure with Zero Breeze Portable AC

Hi,

We are reaching out from the Zero Breeze Marketing team. We built the world's first battery-powered, portable air conditioner. Unlike evaporative coolers that rely on water or ice, ours uses a real compressor system that keeps a tent or van cabin cold even when it's roasting outside.

How we'd love to work together:
- The Gear: We'll ship you a Zero Breeze Mark 3 kit to keep.
- The Goal: In exchange, you'd provide high-quality photo/video content and share a few posts.
- The Perk: We can set up a unique discount code/affiliate link for your followers.

Proposal Contract: {{proposalUrl}}
Content Guide: {{contentGuideUrl}}

Note: You do not need to sign the template. We will send a new contract once we establish our collaboration.

- WhatsApp: {{whatsapp}}
- Email: {{email}}

Best regards,
Zero Breeze Marketing Team`,
  },
  {
    id: 'reject-discount',
    group: '合作前 · 评估不通过',
    title: '评估不通过 · 拒绝 + 大折扣',
    channel: '通用',
    body: `Hi,

Thanks so much for reaching out and for sharing your work. We can feel your passion for outdoor adventure through your content. We really appreciate your interest in partnering with ZERO BREEZE.

At the moment, we're currently working with a few outdoor content creators on active campaigns, and sample units are quite limited. We'd love to keep you in mind for future opportunities when new projects or inventory open up.

However, we can offer you a $100 OFF KOL discount (Code: KOL100) for you to purchase a unit OR purchase a Demo Unit for 30% OFF.

Thanks again for thinking of us. Best of luck with your travels and content in the meantime. Let's stay in touch.

Stay cool,
Zero Breeze Team`,
  },
  {
    id: 'koc',
    group: '合作前 · 评估不通过',
    title: 'KOC · 婉拒 + Demo 30% OFF',
    channel: '通用',
    body: `Thank you so much for reaching out and for taking the time to share your work. We truly appreciate your interest in ZERO BREEZE.

At the moment, we're supporting a number of ongoing creator partnerships, so our available sample/demo units are quite limited for the time being.

That said, we're still very open to flexible collaboration. While we're not able to provide complimentary sample units at this time, we'd be happy to offer you a personal creator discount for a purchase unit. In some cases, we may also provide demo-unit pricing starting from 30% OFF based on the proposed collaboration scope.

Feel free to share any ideas you have in mind — we'd love to explore working together in the future.

Stay cool,`,
  },
  {
    id: 'paid',
    group: '合作中 · 异议',
    title: '付费合作 · 仅接受置换',
    channel: '通用',
    body: `Hey there,
We currently only accept exchange partnerships. I have attached a proposal contract with deliverable details and a content guide file.

Proposal contract: {{proposalUrl}}
Content Guide: {{contentGuideUrl}}

This contract is a template — you do not need to sign it. We will send you a new contract once we establish our collaboration.

- WhatsApp: {{whatsapp}}
- Email: {{email}}

Stay cool,
{{signature}}`,
  },
  {
    id: 'send-contract',
    group: '合作中 · 合同',
    title: '直接同意签约 · 发送合同（Mark 3）',
    channel: '通用',
    body: `Hi,

We're thrilled to move forward with our collaboration. We're ready to proceed and would like to get the contract in place.

As we move forward, a quick note on getting the best performance from Mark 3: many vehicles have large interiors that may exceed the MK3's total cooling capacity. We recommend using it as a 'spot cooler' rather than a whole-vehicle AC — e.g. partition curtains in the sleeping area help concentrate cooling. Please also ensure the exhaust hoses are connected to the window for maximum efficiency.

I've attached the contract for your review (插入做好的网红合同链接).

Quick notes:
- Name: Please fill in your name in the highlighted red sections.
- Posting Date: The date is a placeholder; the schedule is calculated from the effective date of the contract.
- Autonomous Creativity: Video descriptions are for reference only — feel free to tweak to your style.
- Terms & Usage: Term is one year; we're open to discussing likeness/portrait usage.
- Signature: Please e-sign the final page, or send a signed PDF.

Once signed, please send it back via email and we'll arrange shipping ASAP.

Stay cool,
{{signature}}`,
  },
  {
    id: 'objection-video-count',
    group: '合作中 · 异议',
    title: '视频数量异议',
    channel: '通用',
    body: `Hi,

We understand every creator has a different workflow and schedule, so we're happy to align on a content scope that works best for you. How would you feel about a mix of [] short-form and [] long-form video(s)? We can also reduce the photos to a minimum of 5. We're open to adjusting these numbers based on what's most comfortable for your workflow.

If this sounds good, I'd love to hear your thoughts and what type of content you'd feel most comfortable creating.

- Phone / WhatsApp: {{whatsapp}}
- Email: {{email}}

Best,
{{signature}}`,
  },
  {
    id: 'objection-portrait',
    group: '合作中 · 异议',
    title: '肖像权异议',
    channel: '通用',
    body: `Hi,

Thank you for sharing your thoughts on the image rights section. For this collaboration, we'd mainly like to repost your content on our own channels (website, social media, community pages) with proper credit.

If we ever want to use your content for paid advertising or broader commercial purposes, we would absolutely discuss and agree on that with you separately.

Our goal is to make this a fair and mutually beneficial collaboration. Let me know if you have any preferences regarding usage — happy to align!

Best,
Zero Breeze Team`,
  },
  {
    id: 'objection-term',
    group: '合作中 · 异议',
    title: '合同期限异议',
    channel: '通用',
    body: `Hi,

Great question — totally understand your concern. For this collaboration, the agreement term mainly covers the initial content delivery and basic usage period.

That said, we're very flexible and happy to adjust the duration to something that works comfortably for you. We're not looking to restrict your future collaborations — our goal is simply a smooth and fair partnership for this campaign.

Let me know what timeframe you'd feel most comfortable with, and we can align accordingly.

Best,
Zero Breeze Team`,
  },
  {
    id: 'objection-two-batteries',
    group: '合作中 · 异议',
    title: '想要两个电池',
    channel: '通用',
    body: `Hi,

Our standard collaboration package currently includes one AC unit and one battery, designed to provide a complete initial experience. We'd love to start with this setup.

That said, we see this as a long-term partnership. If everything goes smoothly, we'll be more than happy to arrange shipping for extra batteries and accessories as we move into the next phase.

Looking forward to your thoughts!`,
  },
  {
    id: 'reject-contract',
    group: '合作中 · 异议',
    title: '拒绝签合同',
    channel: '通用',
    body: `Hi,

Thank you for your message and for taking the time to share your thoughts. We truly appreciate your interest in working with ZERO BREEZE.

We fully understand your concerns regarding the contract. However, due to strict internal compliance, legal, and risk management policies, all brand collaborations must be governed by a formally executed written agreement without exception. This ensures:
- Clear definition of deliverables and expectations
- Legal protection for both parties
- Compliance with international partnership regulations
- Transparent handling of usage rights, payment terms, and liability

As such, we are unable to proceed unless a signed contract is in place prior to any work or delivery of assets.

Should you decide in the future to proceed under these standard terms, we'd be very happy to revisit working together.

Best regards,
ZERO BREEZE Team`,
  },
  {
    id: 'follow-up-precontract',
    group: '跟进 · 未回复',
    title: '未回复（签合同前）',
    channel: '通用',
    body: `Hi there, just following up to see if you've had a chance to look over the contract link. Any questions so far? Looking forward to hearing from you.`,
  },
  {
    id: 'follow-up-postcontract',
    group: '跟进 · 未回复',
    title: '未回复（已签合同）',
    channel: '通用',
    body: `Hi,

I wanted to touch base and see if you had any questions regarding the posting schedule in the contract.

We're excited to move forward with you! Please let us know if there's anything we can clarify or assist with to get the timeline finalized.`,
  },
  {
    id: 'shipping',
    group: '合作中 · 发货',
    title: '发货通知',
    channel: '通用',
    body: `Hi,
I'm excited to let you know that we've processed your order, and your Mark 3 is now ready to be shipped as part of our collaboration.
Tracking details: (地址 / 物流信息)
If you have any questions regarding the shipment or anything needs adjusting, please don't hesitate to reach out. Looking forward to seeing how our product fits into your content!
Stay cool,
{{signature}}`,
  },
  {
    id: 'festival-email',
    group: '品牌 / 音乐节联名',
    title: '音乐节联名 · 邮件版',
    channel: 'Email',
    body: `Subject: Potential Festival Collaboration with ZERO BREEZE

Hi there!

We've been following your festival and absolutely love the atmosphere, community, and outdoor experience you've created.

We are ZERO BREEZE — the world's first genuine battery-powered portable air conditioner designed for off-grid life, outdoor events, camping, RV setups, and extreme heat. We believe our products could be a great fit for backstage areas, VIP lounges, camping zones, artist spaces, and attendee comfort.

We'd love to explore a partnership, whether that's festival product integration, on-site cooling support, or giveaway/activation opportunities.

- Official Website: {{website}}
- Instagram: {{instagram}}
- WhatsApp / Phone: {{whatsapp}}
- Email: {{email}}

Stay cool,
{{signature}} — ZERO BREEZE Team`,
  },
  {
    id: 'brand-collab',
    group: '品牌 / 音乐节联名',
    title: '品牌联名',
    channel: '通用',
    body: `Hi there!

We've come across your content and really love the way you share your outdoor lifestyle and connect with your community.

We're ZERO BREEZE — a brand specializing in battery-powered portable air conditioners designed for camping, road trips, festivals, and off-grid adventures. We'd love to explore a collaboration or partnership for upcoming projects or content.

We're very open and flexible with collaboration ideas. Feel free to reach out anytime:
- Email: {{email}}
- WhatsApp: {{whatsapp}}

Looking forward to connecting!
— ZERO BREEZE`,
  },
  {
    id: 'product-fault-apology',
    group: '合作异常',
    title: '产品故障 · 道歉',
    channel: '通用',
    body: `Hi,

I'm really sorry to hear that you've encountered an issue with your (产品名). We understand how disappointing it can be when things don't work as expected, and we appreciate your patience.

If possible, please share any photos or videos of the problem. These will help us quickly diagnose and properly handle the situation.

Again, we sincerely apologize for any inconvenience, and we're here to make sure this gets sorted out as quickly as possible.

Best regards,
{{signature}}`,
  },
  {
    id: 'collab-end',
    group: '合作结束',
    title: '合作结束致谢',
    channel: '通用',
    body: `Hi,
I hope you're doing well! I just wanted to thank you for the amazing collaboration we've had. It's been a pleasure bringing Zero Breeze's portable air conditioners to your audience.

We'd love to keep the door open for future opportunities. If there's anything you'd like to discuss or any feedback to share, we're all ears!

Thank you again for your time, effort, and enthusiasm. We look forward to staying in touch and possibly working together again.

Best regards,
{{signature}}`,
  },
];

// Step 3 评估后处理: which 话术库 templates to surface per verdict.
const PROCESS_PROPOSAL_SCRIPT_IDS = ['proposal-inbound', 'outreach-email', 'outreach-ig', 'paid'];
const PROCESS_REJECT_SCRIPT_IDS = ['reject-discount', 'koc'];

// Resolve the relevant outreach templates for a verdict, applying any user edits
// saved in the 话术库 (localStorage overrides) so Step 3 mirrors the library.
function processScriptOptions(verdict: 'pass' | 'fail'): ScriptTemplate[] {
  const ids = verdict === 'pass' ? PROCESS_PROPOSAL_SCRIPT_IDS : PROCESS_REJECT_SCRIPT_IDS;
  return resolveScriptOptions(ids);
}

// Step 5 合作推进: contract / objection-handling templates surfaced in the panel.
const COLLAB_SCRIPT_IDS = [
  'send-contract',
  'objection-video-count',
  'objection-portrait',
  'objection-term',
  'objection-two-batteries',
  'reject-contract',
  'follow-up-precontract',
  'follow-up-postcontract',
];
// Step 6 发货流程: shipping / fulfillment templates.
const SHIP_SCRIPT_IDS = ['shipping', 'product-fault-apology', 'collab-end'];

function collabScriptOptions(): ScriptTemplate[] {
  return resolveScriptOptions(COLLAB_SCRIPT_IDS);
}

function shipScriptOptions(): ScriptTemplate[] {
  return resolveScriptOptions(SHIP_SCRIPT_IDS);
}

// Resolve template ids to their (user-edited) library entries, preserving order.
function resolveScriptOptions(ids: string[]): ScriptTemplate[] {
  const overrides = loadScriptOverrides();
  return ids
    .map((id) => SCRIPT_LIBRARY.find((script) => script.id === id))
    .filter((script): script is ScriptTemplate => Boolean(script))
    .map((script) => (overrides[script.id] ? { ...script, ...overrides[script.id] } : script));
}

function WorkflowRail({
  view,
  counts,
  onSelect,
}: {
  view: MarketingView;
  counts: { classify: number; evaluate: number; process: number; intake: number; collab: number; ship: number };
  onSelect: (view: MarketingView) => void;
}) {
  const pendingFor = (key: MarketingView | null): number => {
    switch (key) {
      case 'classify':
        return counts.classify;
      case 'evaluate':
        return counts.evaluate;
      case 'process':
        return counts.process;
      case 'intake':
        return counts.intake;
      case 'collab':
        return counts.collab;
      case 'ship':
        return counts.ship;
      default:
        return 0;
    }
  };
  return (
    <div className="marketing-rail" role="tablist" aria-label="网红营销流程">
      {MARKETING_WORKFLOW_STEPS.map((step, index) => {
        const enabled = step.key !== null;
        const active = enabled && step.key === view;
        const pending = pendingFor(step.key);
        return (
          <Fragment key={step.id}>
            {index > 0 && <span className="marketing-rail-link" aria-hidden />}
            <button
              type="button"
              className={`marketing-rail-step ${active ? 'active' : ''} ${enabled ? '' : 'locked'}`}
              onClick={() => enabled && step.key && onSelect(step.key)}
              disabled={!enabled}
              role="tab"
              aria-selected={active}
              title={enabled ? step.desc : `${step.title} · 敬请期待`}
            >
              <span className="marketing-rail-index">{enabled ? step.id : <Lock size={11} />}</span>
              <span className="marketing-rail-text">
                <em>{step.short}</em>
                <strong>{step.title}</strong>
              </span>
              {enabled && pending > 0 && <span className="marketing-rail-badge">{pending}</span>}
            </button>
          </Fragment>
        );
      })}
    </div>
  );
}

function MarketingEmptyState({
  tone = 'neutral',
  icon,
  title,
  description,
  children,
}: {
  tone?: 'neutral' | 'success';
  icon: ReactNode;
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className={`marketing-empty ${tone}`}>
      <span className="marketing-empty-icon">{icon}</span>
      <strong className="marketing-empty-title">{title}</strong>
      {description && <p className="marketing-empty-desc">{description}</p>}
      {children && <div className="marketing-empty-actions">{children}</div>}
    </div>
  );
}

function LeadCard({
  lead,
  kol,
  className,
  chips,
  openKolLabel,
  onOpenKol,
  actions,
  actionsClassName,
}: {
  lead: MarketingEmailLead;
  kol?: KolProfile | null;
  className?: string;
  chips?: ReactNode;
  openKolLabel?: string;
  onOpenKol?: (id: string) => void;
  actions?: ReactNode;
  actionsClassName?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showTranslation, setShowTranslation] = useState(false);
  const [translation, setTranslation] = useState<{ subject: string; body: string } | null>(null);
  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);

  const body = cleanEmailText(lead.snippet || '');
  const hasBody = body.length > 0;
  const displaySubject = showTranslation && translation ? translation.subject : lead.subject;
  const displayBody = showTranslation && translation ? translation.body || body : body;

  const handleTranslate = async () => {
    if (translation) {
      setShowTranslation((value) => !value);
      return;
    }
    setTranslating(true);
    setTranslateError(null);
    try {
      const [subjectRes, bodyRes] = await Promise.all([
        translateText(lead.subject),
        hasBody ? translateText(body) : Promise.resolve({ text: '', sourceLang: 'auto', targetLang: 'zh-CN' }),
      ]);
      setTranslation({ subject: subjectRes.text || lead.subject, body: bodyRes.text || '' });
      setShowTranslation(true);
    } catch (error) {
      setTranslateError(stringifyError(error));
    } finally {
      setTranslating(false);
    }
  };

  return (
    <article className={`marketing-lead-card ${className ?? ''}`}>
      <div className="marketing-lead-main">
        <div className="marketing-lead-top">
          <span className={`marketing-category ${lead.category}`}>{categoryLabel(lead.category)}</span>
          {chips}
          {showTranslation && translation && <span className="marketing-translated-tag"><Languages size={10} />译文</span>}
          <span className="spacer" />
          <span className="marketing-lead-time">{formatMaybeDate(lead.receivedAt)}</span>
        </div>
        <h4 className="marketing-lead-subject">{displaySubject}</h4>
        <span className="marketing-lead-from">{lead.rawFrom}</span>
        {hasBody && <p className={`marketing-lead-snippet ${expanded ? '' : 'clamped'}`}>{displayBody}</p>}
        {translateError && <span className="marketing-lead-translate-error"><AlertCircle size={12} />{translateError}</span>}
        {lead.agentReviewNote && <span className="marketing-review-note">{lead.agentReviewNote}</span>}
        <div className="marketing-lead-tools">
          <button type="button" className="marketing-text-btn" onClick={() => void handleTranslate()} disabled={translating}>
            {translating ? <Loader2 size={12} className="spin" /> : <Languages size={12} />}
            {translation ? (showTranslation ? '显示原文' : '显示译文') : translating ? '翻译中…' : '翻译'}
          </button>
          {hasBody && body.length > 140 && (
            <button type="button" className="marketing-text-btn" onClick={() => setExpanded((value) => !value)}>
              {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}{expanded ? '收起' : '展开全文'}
            </button>
          )}
          {kol && onOpenKol && (
            <button className="marketing-link-btn inline" type="button" onClick={() => onOpenKol(kol.id)}>
              <Users size={13} />{openKolLabel ?? `打开 ${kol.name}`}
            </button>
          )}
        </div>
      </div>
      {actions && <div className={`marketing-lead-actions ${actionsClassName ?? ''}`}>{actions}</div>}
    </article>
  );
}

function ClassifyWorkbench({
  leads,
  kols,
  busy,
  evaluatePending = 0,
  onClassify,
  onOpenKol,
  onCopyAgentPrompt,
  onGoEvaluate,
  copiedPrompt,
}: {
  leads: MarketingEmailLead[];
  kols: KolProfile[];
  busy: boolean;
  evaluatePending?: number;
  onClassify: (lead: MarketingEmailLead, category: EmailCategory, hidden?: boolean) => void;
  onOpenKol: (id: string) => void;
  onCopyAgentPrompt: () => void;
  onGoEvaluate?: () => void;
  copiedPrompt: boolean;
}) {
  const [filter, setFilter] = useState<'pending' | 'all'>('pending');
  const kolById = new Map(kols.map((kol) => [kol.id, kol]));
  const visible = leads.filter((lead) => (filter === 'all' ? true : !lead.humanConfirmed));
  const pendingCount = leads.filter((lead) => !lead.humanConfirmed).length;
  return (
    <div className="marketing-step">
      <div className="marketing-step-head">
        <div className="marketing-step-intro">
          <span className="marketing-step-tag"><ListChecks size={13} />Step 1 · 初步分类</span>
          <p>AI 已预读每封邮件并给出建议类别。请确认或修正为 <b>达人</b> / <b>联盟</b> / <b>其他</b>；广告点「隐藏」即从收件箱移除。确认后即使再次同步也不会被覆盖。</p>
        </div>
        <div className="marketing-step-actions">
          <div className="marketing-segment">
            <button type="button" className={filter === 'pending' ? 'active' : ''} onClick={() => setFilter('pending')}>待确认 {pendingCount}</button>
            <button type="button" className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>全部 {leads.length}</button>
          </div>
          <button type="button" className="settings-btn" onClick={onCopyAgentPrompt} title="复制让 Agent 批量分类的指令">
            {copiedPrompt ? <Check size={13} /> : <Sparkles size={13} />}{copiedPrompt ? '已复制' : '复制 Agent 指令'}
          </button>
        </div>
      </div>
      {visible.length === 0 ? (
        leads.length > 0 ? (
          <MarketingEmptyState
            tone="success"
            icon={<CheckCheck size={26} />}
            title="收件箱已清空"
            description={`全部 ${leads.length} 条线索均已人工确认，Step 1 初步分类完成，可以进入网红评估。`}
          >
            <button type="button" className="settings-btn" onClick={() => setFilter('all')}>查看全部分类</button>
            {onGoEvaluate && (
              <button type="button" className="settings-btn primary" onClick={onGoEvaluate}>
                前往网红评估{evaluatePending > 0 ? ` · ${evaluatePending}` : ''}<ChevronRight size={14} />
              </button>
            )}
          </MarketingEmptyState>
        ) : (
          <MarketingEmptyState
            icon={<Inbox size={26} />}
            title="暂无邮件线索"
            description="在设置中配置邮箱并点击右上角「同步邮件」后，AI 会自动预读新邮件并给出分类建议。"
          >
            <button type="button" className="settings-btn" onClick={onCopyAgentPrompt} title="复制让 Agent 同步并批量分类的指令">
              {copiedPrompt ? <Check size={13} /> : <Sparkles size={13} />}{copiedPrompt ? '已复制' : '复制 Agent 指令'}
            </button>
          </MarketingEmptyState>
        )
      ) : (
        <div className="marketing-lead-list">
          {visible.map((lead) => {
            const kol = lead.kolId ? kolById.get(lead.kolId) : null;
            return (
              <LeadCard
                key={lead.id}
                lead={lead}
                kol={kol}
                className={lead.humanConfirmed ? 'confirmed' : ''}
                chips={
                  <>
                    <span className="marketing-ai-chip"><Sparkles size={11} />AI {Math.round(lead.confidence * 100)}%</span>
                    {lead.humanConfirmed && <span className="marketing-confirm-chip"><Check size={11} />已确认</span>}
                  </>
                }
                onOpenKol={onOpenKol}
                openKolLabel={kol ? `打开 ${kol.name} 的评估` : undefined}
                actionsClassName="classify"
                actions={
                  <>
                    <span className="marketing-action-label">人工确认</span>
                    <div className="marketing-classify-buttons">
                      {(['influencer', 'affiliate', 'other'] as EmailCategory[]).map((category) => (
                        <button
                          key={category}
                          type="button"
                          className={`marketing-pill ${category} ${lead.humanConfirmed && lead.category === category ? 'on' : ''}`}
                          disabled={busy}
                          onClick={() => onClassify(lead, category)}
                        >
                          {categoryLabel(category)}
                        </button>
                      ))}
                      <button
                        type="button"
                        className="marketing-pill hide"
                        disabled={busy}
                        onClick={() => onClassify(lead, 'other', true)}
                        title="广告：归入其他并隐藏"
                      >
                        <EyeOff size={12} />隐藏
                      </button>
                    </div>
                  </>
                }
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function EvaluateWorkbench({
  kols,
  selectedId,
  busy,
  autoConfirm,
  onToggleAutoConfirm,
  onSelect,
  onSave,
  onOpenKol,
}: {
  kols: KolProfile[];
  selectedId: string | null;
  busy: boolean;
  autoConfirm: boolean;
  onToggleAutoConfirm: (next: boolean) => void;
  onSelect: (id: string) => void;
  onSave: (kol: KolProfile, payload: EvaluationSavePayload, confirmed: boolean) => void;
  onOpenKol: (id: string) => void;
}) {
  const [filter, setFilter] = useState<'todo' | 'pass' | 'fail' | 'all'>('todo');
  const [copiedBatch, setCopiedBatch] = useState(false);
  const buckets = useMemo(() => {
    const map: Record<EvalBucket, KolProfile[]> = { todo: [], pass: [], fail: [] };
    for (const kol of kols) map[kolEvalBucket(kol)].push(kol);
    return map;
  }, [kols]);
  const pending = buckets.todo;
  const list = filter === 'all' ? kols : buckets[filter];
  const selected = list.find((kol) => kol.id === selectedId) ?? list[0] ?? null;

  const emptyHint =
    filter === 'pass'
      ? '还没有评估通过的达人。'
      : filter === 'fail'
        ? '没有被判定为不通过的达人。'
        : filter === 'all'
          ? '暂无 KOL 档案。'
          : '没有待评估的达人。先在 Step 1 把达人邮件确认为「达人」。';

  const copyBatchPrompt = async () => {
    if (pending.length === 0) return;
    const roster = pending.map((kol, index) => `${index + 1}. id=${kol.id} | ${kol.name} <${kol.email}>`);
    const confirmFlag = autoConfirm ? ' --confirm true' : '';
    const tail = autoConfirm
      ? '已开启「Agent 自动确认」：CLI 默认直接定稿（通过→qualified，不通过→rejected），完成后按通过/不通过/待定分组汇总结论与依据告诉我即可，无需我再确认。'
      : '默认保存为草稿（pipeline_stage 留在 evaluate）；全部完成后，按「通过 / 不通过 / 待定」分组汇总每位的结论与关键依据，我再人工逐一确认。';
    const prompt = [
      `请用 $sidebar-control 技能批量执行 Step 2 网红评估，共 ${pending.length} 位待评估达人：`,
      ...roster,
      '',
      '对每一位：先调研其社媒数据，再按 6 项指标判断——硬性 vertical、language 必须全部通过；软性 followers、views、engagement、recency 至少 2 项通过才算评估通过。',
      `逐个执行：alpha-sidebar marketing kols evaluate --id <kolId> --criteria '[{"key":"vertical","status":"pass|fail|unknown","detail":"依据"}, ...]' --summary "<结论摘要>"${confirmFlag} --reason "Step 2 批量评估"`,
      'criteria 的 key 仅限 vertical/language/followers/views/engagement/recency，status 仅限 pass/fail/unknown；CLI 会自动判定 verdict 与流程阶段，无需手动设置 pipeline_stage。',
      tail,
    ].join('\n');
    if (await copyToClipboard(prompt)) {
      setCopiedBatch(true);
      window.setTimeout(() => setCopiedBatch(false), 1600);
    }
  };

  return (
    <div className="marketing-step evaluate">
      <div className="marketing-step-head">
        <div className="marketing-step-intro">
          <span className="marketing-step-tag"><ShieldQuestion size={13} />Step 2 · 网红评估</span>
          <p>硬性指标（红）必须全部通过，软性指标至少满足 2 项才算<b>评估通过</b>。让 Agent 调研填写指标，人工核对后确认结论。</p>
        </div>
        <div className="marketing-step-actions">
          <button
            type="button"
            className={`marketing-autoconfirm ${autoConfirm ? 'on' : ''}`}
            role="switch"
            aria-checked={autoConfirm}
            disabled={busy}
            onClick={() => onToggleAutoConfirm(!autoConfirm)}
            title={autoConfirm ? 'Agent 评估后直接定稿，无需人工确认。点击关闭。' : '开启后 Agent 评估将自动确认，跳过人工确认。'}
          >
            <ShieldCheck size={13} />
            <span>Agent 自动确认</span>
            <Toggle checked={autoConfirm} />
          </button>
          <button
            type="button"
            className="settings-btn ghost"
            disabled={pending.length === 0}
            onClick={copyBatchPrompt}
            title="复制让 Agent 一次性评估全部待评估达人的指令"
          >
            {copiedBatch ? <Check size={13} /> : <Sparkles size={13} />}
            {copiedBatch ? '已复制' : `批量 Agent 评估${pending.length ? ` · ${pending.length}` : ''}`}
          </button>
          <div className="marketing-segment verdicts">
            <button type="button" className={filter === 'todo' ? 'active' : ''} onClick={() => setFilter('todo')}>待评估 {buckets.todo.length}</button>
            <button type="button" className={`pass ${filter === 'pass' ? 'active' : ''}`} onClick={() => setFilter('pass')}>通过 {buckets.pass.length}</button>
            <button type="button" className={`fail ${filter === 'fail' ? 'active' : ''}`} onClick={() => setFilter('fail')}>未通过 {buckets.fail.length}</button>
            <button type="button" className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>全部 {kols.length}</button>
          </div>
        </div>
      </div>
      <div className="marketing-split">
        <div className="marketing-eval-list">
          {list.length === 0 ? (
            <div className="partner-marketing-placeholder"><Users size={18} /><span>{emptyHint}</span></div>
          ) : (
            list.map((kol) => {
              const evaluation = parseKolEvaluation(kol.evaluation);
              const verdict = evaluation?.status ?? 'pending';
              const bucket = kolEvalBucket(kol);
              const isDraft = !!evaluation && !evaluation.confirmed;
              return (
                <button
                  key={kol.id}
                  type="button"
                  className={`marketing-eval-row ${bucket} ${kol.id === selected?.id ? 'selected' : ''}`}
                  onClick={() => onSelect(kol.id)}
                >
                  <span className="marketing-avatar sm">{initials(kol.name)}</span>
                  <span className="marketing-eval-row-main">
                    <strong>{kol.name}</strong>
                    <span>{kol.country || '国家未知'} · {kol.tags || '无标签'}</span>
                  </span>
                  <span className="marketing-eval-row-meta">
                    {isDraft && <em className="marketing-eval-draft" title="评估草稿，待人工确认">草稿</em>}
                    <span className={`marketing-verdict ${verdict}`}>
                      {!evaluation ? <ShieldQuestion size={11} /> : verdict === 'pass' ? <ShieldCheck size={11} /> : verdict === 'fail' ? <AlertTriangle size={11} /> : <ShieldQuestion size={11} />}
                      {evaluation ? verdictShort(verdict) : '未评估'}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>
        <EvaluationPanel kol={selected} busy={busy} autoConfirm={autoConfirm} onSave={onSave} onOpenKol={onOpenKol} />
      </div>
    </div>
  );
}

interface EvaluationSavePayload {
  criteria: EvalCriterion[];
  summary: string;
  recommendation: string;
}

function EvaluationPanel({
  kol,
  busy,
  autoConfirm,
  onSave,
  onOpenKol,
}: {
  kol: KolProfile | null;
  busy: boolean;
  autoConfirm: boolean;
  onSave: (kol: KolProfile, payload: EvaluationSavePayload, confirmed: boolean) => void;
  onOpenKol: (id: string) => void;
}) {
  const [criteria, setCriteria] = useState<EvalCriterion[]>(() => defaultEvalCriteria());
  const [summary, setSummary] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const evaluation = parseKolEvaluation(kol?.evaluation);
    setCriteria(defaultEvalCriteria(evaluation?.criteria));
    setSummary(evaluation?.summary ?? '');
    setCopied(false);
  }, [kol?.id, kol?.evaluation]);

  if (!kol) {
    return (
      <aside className="marketing-detail-panel">
        <div className="partner-marketing-placeholder"><ShieldQuestion size={18} /><span>选择一个达人开始评估。</span></div>
      </aside>
    );
  }

  const evaluation = parseKolEvaluation(kol.evaluation);
  const verdict = computeVerdict(criteria);
  const setStatus = (key: EvalCriterionKey, status: EvalCriterionStatus) =>
    setCriteria((prev) => prev.map((item) => (item.key === key ? { ...item, status } : item)));
  const setDetail = (key: EvalCriterionKey, detail: string) =>
    setCriteria((prev) => prev.map((item) => (item.key === key ? { ...item, detail } : item)));

  const recommendation = verdict === 'pass' ? 'proposal' : verdict === 'fail' ? 'reject' : 'hold';
  const recommendedScript = SCRIPT_LIBRARY.find((item) =>
    recommendation === 'proposal' ? item.id === 'proposal-inbound' : recommendation === 'reject' ? item.id === 'reject-discount' : false,
  );

  const copyAgentPrompt = async () => {
    const confirmFlag = autoConfirm ? ' --confirm true' : '';
    const tail = autoConfirm
      ? '已开启「Agent 自动确认」：CLI 直接定稿（通过→qualified，不通过→rejected），完成后把结论与依据告诉我即可，无需我再确认。'
      : '每项 criteria 形如 {"key":"vertical","status":"pass|fail|unknown","detail":"依据"}。完成后告诉我结论，我会人工确认。';
    const prompt = [
      `请用 $sidebar-control 技能对 KOL「${kol.name}」<${kol.email}>（id=${kol.id}）执行 Step 2 网红评估。`,
      '请先调研其社媒数据，然后按 6 项指标判断（vertical、language 为硬性必须通过；followers、views、engagement、recency 为软性，至少 2 项通过）。',
      `执行：alpha-sidebar marketing kols evaluate --id ${kol.id} --criteria '<JSON 数组>' --summary "<结论摘要>"${confirmFlag} --reason "Step 2 网红评估"`,
      tail,
    ].join('\n');
    if (await copyToClipboard(prompt)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }
  };

  return (
    <aside className="marketing-detail-panel eval">
      <header>
        <span className="marketing-avatar">{initials(kol.name)}</span>
        <div>
          <strong>{kol.name}</strong>
          <span>{kol.email}</span>
        </div>
        <span className={`marketing-stage-chip ${kol.pipelineStage}`}>{pipelineStageLabel(kol.pipelineStage)}</span>
      </header>

      <div className={`marketing-verdict-banner ${verdict}`}>
        <span className="marketing-verdict-icon">
          {verdict === 'pass' ? <ShieldCheck size={18} /> : verdict === 'fail' ? <AlertTriangle size={18} /> : <ShieldQuestion size={18} />}
        </span>
        <div>
          <strong>{verdictLabel(verdict)}</strong>
          <span>硬性 {criteria.filter((c) => c.kind === 'hard' && c.status === 'pass').length}/2 · 软性 {criteria.filter((c) => c.kind === 'soft' && c.status === 'pass').length}/4 通过</span>
        </div>
        {evaluation?.confirmed && <span className="marketing-confirm-chip"><Check size={11} />已确认 · {evaluation.by === 'agent' ? 'Agent' : '人工'}</span>}
      </div>

      <div className="marketing-criteria">
        {(['hard', 'soft'] as const).map((kind) => (
          <div key={kind} className="marketing-criteria-group">
            <h4>{kind === 'hard' ? '硬性指标（必须全部通过）' : '软性指标（至少 2 项）'}</h4>
            {criteria.filter((item) => item.kind === kind).map((item) => {
              const meta = EVAL_CRITERIA_CATALOG.find((m) => m.key === item.key);
              return (
                <div key={item.key} className={`marketing-criterion ${item.kind} ${item.status}`}>
                  <div className="marketing-criterion-head">
                    <span className="marketing-criterion-label">{item.label}</span>
                    <div className="marketing-segment tri">
                      {EVAL_STATUS_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          className={`${option.value} ${item.status === option.value ? 'active' : ''}`}
                          onClick={() => setStatus(item.key, option.value)}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <input
                    className="settings-input"
                    value={item.detail}
                    onChange={(event) => setDetail(item.key, event.target.value)}
                    placeholder={meta?.hint || '填写依据，如 IG 45k / 平均播放 28k'}
                  />
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <label className="marketing-eval-summary">评估结论 / 推荐理由
        <textarea className="settings-textarea" value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="给下一个处理人的结论：场景适配、流量情况、推荐理由等" />
      </label>

      <div className="marketing-eval-buttons">
        <button type="button" className="settings-btn" disabled={busy} onClick={() => onSave(kol, { criteria, summary, recommendation }, false)}>保存草稿</button>
        <button type="button" className="settings-btn primary" disabled={busy || verdict === 'pending'} onClick={() => onSave(kol, { criteria, summary, recommendation }, true)} title={verdict === 'pending' ? '请先补全所有指标' : '人工确认结论'}>
          <Check size={13} />确认结论
        </button>
        <button type="button" className="settings-btn ghost" onClick={copyAgentPrompt} title="复制让 Agent 评估的指令">
          {copied ? <Check size={13} /> : <Sparkles size={13} />}{copied ? '已复制' : 'Agent 评估'}
        </button>
      </div>

      {recommendedScript && (
        <RecommendationCard
          verdict={verdict}
          script={recommendedScript}
          onOpenKol={() => onOpenKol(kol.id)}
        />
      )}
    </aside>
  );
}

function RecommendationCard({ verdict, script, onOpenKol }: { verdict: EvalVerdict; script: ScriptTemplate; onOpenKol: () => void }) {
  const [copied, setCopied] = useState(false);
  const vars = useMemo(() => loadScriptVars(), []);
  const rendered = useMemo(() => renderScript(script.body, vars), [script.body, vars]);
  const copy = async () => {
    if (await copyToClipboard(rendered)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }
  };
  return (
    <div className={`marketing-reco ${verdict}`}>
      <div className="marketing-reco-head">
        <span>{verdict === 'pass' ? '建议：发送合作提案' : '建议：发送拒绝 + 折扣话术'}</span>
        <button type="button" className="settings-btn" onClick={copy}>{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? '已复制' : '复制话术'}</button>
      </div>
      <p className="marketing-reco-title">{script.title}</p>
      <pre className="marketing-reco-body">{rendered}</pre>
      <button type="button" className="marketing-link-btn" onClick={onOpenKol}><UserCircle size={13} />在 KOL 库查看完整档案</button>
    </div>
  );
}

const OUTREACH_CHANNELS = ['Email', 'IG DM', 'WhatsApp', '通用'];

interface OutreachSavePayload {
  status: 'sent' | 'skipped';
  kind: string;
  scriptId?: string;
  channel?: string;
  note?: string;
}

interface ReplySavePayload {
  body: string;
  kind: string;
  scriptId?: string;
  channel?: string;
  note?: string;
}

// The Step 3 action a KOL needs follows its confirmed Step 2 verdict.
function processVerdict(kol: KolProfile): 'pass' | 'fail' {
  const evaluation = parseKolEvaluation(kol.evaluation);
  if (evaluation?.status === 'fail') return 'fail';
  if (evaluation?.status === 'pass') return 'pass';
  return kol.pipelineStage === 'rejected' ? 'fail' : 'pass';
}

function ProcessWorkbench({
  kols,
  selectedId,
  busy,
  autoReply,
  onToggleAutoReply,
  onSelect,
  onRecord,
  onReply,
  onOpenKol,
}: {
  kols: KolProfile[];
  selectedId: string | null;
  busy: boolean;
  autoReply: boolean;
  onToggleAutoReply: (next: boolean) => void;
  onSelect: (id: string) => void;
  onRecord: (kol: KolProfile, payload: OutreachSavePayload) => void;
  onReply: (kol: KolProfile, payload: ReplySavePayload) => void;
  onOpenKol: (id: string) => void;
}) {
  const [filter, setFilter] = useState<'todo' | 'done'>('todo');
  const [copiedBatch, setCopiedBatch] = useState(false);
  const buckets = useMemo(() => {
    const map: { todo: KolProfile[]; done: KolProfile[] } = { todo: [], done: [] };
    for (const kol of kols) {
      const bucket = kolProcessBucket(kol);
      if (bucket === 'todo') map.todo.push(kol);
      else if (bucket === 'done') map.done.push(kol);
    }
    return map;
  }, [kols]);
  const list = buckets[filter];
  const selected = list.find((kol) => kol.id === selectedId) ?? list[0] ?? null;
  const todo = buckets.todo;

  const emptyHint =
    filter === 'done'
      ? '还没有已处理的达人。完成发提案 / 拒绝后会出现在这里。'
      : '没有待处理的达人。先在 Step 2 确认评估结论（通过 / 不通过）。';

  const copyBatchPrompt = async () => {
    if (todo.length === 0) return;
    const roster = todo.map((kol, index) => {
      const verdict = processVerdict(kol);
      return `${index + 1}. id=${kol.id} | ${kol.name} <${kol.email}> | ${verdict === 'pass' ? '评估通过→发提案' : '评估不通过→发拒绝'}`;
    });
    const tail = autoReply
      ? '已开启「Agent 自主回复」：起草后可直接发送并记录——alpha-sidebar marketing kols reply --id <kolId> --body "<最终正文>" --kind proposal|reject --script-id <模板id> --reason "Step 3 评估后处理"（--send 默认跟随开关=on，即真实通过 SMTP 发出；通过会自动推进到 onboarding 推进合作）。逐位发送后，把每封的收件人与结果汇总告诉我。'
      : '未开启「Agent 自主回复」：请只把每位的草稿整理好给我审阅，不要发送。我会在面板逐个点「一键回复」发出，或确认后再让你执行 kols reply。';
    const prompt = [
      `请用 $sidebar-control 技能批量执行 Step 3 评估后处理，共 ${todo.length} 位待处理达人：`,
      ...roster,
      '',
      '评估通过的：基于话术库「合作提案」（proposal-inbound / outreach-email）结合该达人内容风格，起草一封可直接发送的个性化提案；评估不通过的：基于「拒绝 + 折扣」（reject-discount / koc）起草礼貌婉拒。',
      '话术中的协议链接、内容指南、联系方式、署名都来自话术库变量，请保留占位或沿用既有配置，不要编造链接。',
      tail,
    ].join('\n');
    if (await copyToClipboard(prompt)) {
      setCopiedBatch(true);
      window.setTimeout(() => setCopiedBatch(false), 1600);
    }
  };

  return (
    <div className="marketing-step process">
      <div className="marketing-step-head">
        <div className="marketing-step-intro">
          <span className="marketing-step-tag"><Mail size={13} />Step 3 · 评估后处理</span>
          <p>评估通过的达人<b>发送合作提案</b>，不通过的<b>发送拒绝 + 折扣话术</b>。选好话术、确认正文后<b>一键回复</b>即可经 SMTP 发出并自动推进；开启「Agent 自主回复」可让 Agent 起草后直接发送。</p>
        </div>
        <div className="marketing-step-actions">
          <button
            type="button"
            className={`marketing-autoconfirm ${autoReply ? 'on' : ''}`}
            role="switch"
            aria-checked={autoReply}
            disabled={busy}
            onClick={() => onToggleAutoReply(!autoReply)}
            title={autoReply ? 'Agent 起草后可直接通过 SMTP 发送并记录，无需人工确认。点击关闭改为需人工确认。' : '开启后 Agent 可自主发送回复；关闭时仅起草草稿，由人工在面板点「一键回复」确认发送。'}
          >
            <Send size={13} />
            <span>Agent 自主回复</span>
            <Toggle checked={autoReply} />
          </button>
          <button
            type="button"
            className="settings-btn ghost"
            disabled={todo.length === 0}
            onClick={copyBatchPrompt}
            title="复制让 Agent 为全部待处理达人起草个性化外联话术的指令"
          >
            {copiedBatch ? <Check size={13} /> : <Sparkles size={13} />}
            {copiedBatch ? '已复制' : `批量 Agent 起草${todo.length ? ` · ${todo.length}` : ''}`}
          </button>
          <div className="marketing-segment verdicts">
            <button type="button" className={filter === 'todo' ? 'active' : ''} onClick={() => setFilter('todo')}>待处理 {buckets.todo.length}</button>
            <button type="button" className={filter === 'done' ? 'active' : ''} onClick={() => setFilter('done')}>已处理 {buckets.done.length}</button>
          </div>
        </div>
      </div>
      <div className="marketing-split">
        <div className="marketing-eval-list">
          {list.length === 0 ? (
            <div className="partner-marketing-placeholder"><Mail size={18} /><span>{emptyHint}</span></div>
          ) : (
            list.map((kol) => {
              const verdict = processVerdict(kol);
              const outreach = parseKolOutreach(kol.outreach);
              return (
                <button
                  key={kol.id}
                  type="button"
                  className={`marketing-eval-row ${verdict} ${kol.id === selected?.id ? 'selected' : ''}`}
                  onClick={() => onSelect(kol.id)}
                >
                  <span className="marketing-avatar sm">{initials(kol.name)}</span>
                  <span className="marketing-eval-row-main">
                    <strong>{kol.name}</strong>
                    <span>{kol.country || '国家未知'} · {kol.tags || '无标签'}</span>
                  </span>
                  <span className="marketing-eval-row-meta">
                    {outreach ? (
                      <span className={`marketing-verdict ${outreach.status === 'skipped' ? 'pending' : verdict}`}>
                        {outreach.status === 'skipped' ? <ShieldQuestion size={11} /> : <Check size={11} />}
                        {outreachKindLabel(outreach.kind)}
                      </span>
                    ) : (
                      <span className={`marketing-verdict ${verdict}`}>
                        {verdict === 'pass' ? <ShieldCheck size={11} /> : <AlertTriangle size={11} />}
                        {verdict === 'pass' ? '待发提案' : '待发拒绝'}
                      </span>
                    )}
                  </span>
                </button>
              );
            })
          )}
        </div>
        <ProcessPanel kol={selected} busy={busy} autoReply={autoReply} onRecord={onRecord} onReply={onReply} onOpenKol={onOpenKol} />
      </div>
    </div>
  );
}

function ProcessPanel({
  kol,
  busy,
  autoReply,
  onRecord,
  onReply,
  onOpenKol,
}: {
  kol: KolProfile | null;
  busy: boolean;
  autoReply: boolean;
  onRecord: (kol: KolProfile, payload: OutreachSavePayload) => void;
  onReply: (kol: KolProfile, payload: ReplySavePayload) => void;
  onOpenKol: (id: string) => void;
}) {
  const verdict = kol ? processVerdict(kol) : 'pass';
  const options = useMemo(() => (kol ? processScriptOptions(verdict) : []), [kol?.id, verdict]);
  const vars = useMemo(() => loadScriptVars(), []);
  const existing = parseKolOutreach(kol?.outreach);

  const [scriptId, setScriptId] = useState<string>('');
  const [channel, setChannel] = useState<string>('通用');
  const [note, setNote] = useState<string>('');
  const [body, setBody] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [copiedAgent, setCopiedAgent] = useState(false);

  useEffect(() => {
    const opts = kol ? processScriptOptions(verdict) : [];
    const prior = parseKolOutreach(kol?.outreach);
    const initialScript = prior?.scriptId && opts.some((s) => s.id === prior.scriptId)
      ? prior.scriptId
      : opts[0]?.id ?? '';
    setScriptId(initialScript);
    const inferred = prior?.channel ?? opts.find((s) => s.id === initialScript)?.channel ?? 'Email';
    setChannel(OUTREACH_CHANNELS.includes(inferred) ? inferred : 'Email');
    setNote(prior?.note ?? '');
    const initialScriptObj = opts.find((s) => s.id === initialScript) ?? null;
    setBody(initialScriptObj ? renderScript(initialScriptObj.body, vars) : '');
    setCopied(false);
    setCopiedAgent(false);
  }, [kol?.id, kol?.outreach, verdict, vars]);

  if (!kol) {
    return (
      <aside className="marketing-detail-panel">
        <div className="partner-marketing-placeholder"><Mail size={18} /><span>选择一个达人开始处理。</span></div>
      </aside>
    );
  }

  const script = options.find((s) => s.id === scriptId) ?? options[0] ?? null;
  const rendered = script ? renderScript(script.body, vars) : '';
  const evaluation = parseKolEvaluation(kol.evaluation);
  const kindFor = (sid: string) =>
    verdict === 'fail' ? (sid === 'koc' ? 'koc' : 'reject') : sid === 'paid' ? 'paid' : 'proposal';

  const isEmail = channel === 'Email';
  const copyScript = async () => {
    if (body.trim() && (await copyToClipboard(body))) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }
  };
  const resetBody = () => setBody(rendered);
  const sendReply = () => onReply(kol, { body, kind: kindFor(scriptId), scriptId, channel, note });
  const markSent = () =>
    onRecord(kol, { status: 'sent', kind: kindFor(scriptId), scriptId, channel, note });
  const skip = () => onRecord(kol, { status: 'skipped', kind: 'skip', note });
  const copyAgentPrompt = async () => {
    const tail = autoReply
      ? `已开启「Agent 自主回复」，确认正文后可直接发送并记录：alpha-sidebar marketing kols reply --id ${kol.id} --body "<最终正文>" --kind ${kindFor(scriptId)} --script-id ${scriptId} --reason "Step 3 评估后处理"（--send 跟随开关=on，真实经 SMTP 发出）。`
      : `未开启「Agent 自主回复」：先输出草稿给我审阅，不要发送。我会在面板点「一键回复」发出，或确认后再让你执行：alpha-sidebar marketing kols reply --id ${kol.id} --body "<最终正文>" --send true。`;
    const prompt = [
      `请用 $sidebar-control 技能为 KOL「${kol.name}」<${kol.email}>（id=${kol.id}）起草 Step 3 ${verdict === 'pass' ? '合作提案' : '拒绝 + 折扣'}话术。`,
      `基础模板：话术库「${script?.title ?? ''}」。请结合该达人的内容方向做轻度个性化，保留协议链接 / 内容指南 / 联系方式 / 署名等话术库变量，不要编造链接。`,
      tail,
    ].join('\n');
    if (await copyToClipboard(prompt)) {
      setCopiedAgent(true);
      window.setTimeout(() => setCopiedAgent(false), 1600);
    }
  };

  return (
    <aside className="marketing-detail-panel process">
      <header>
        <span className="marketing-avatar">{initials(kol.name)}</span>
        <div>
          <strong>{kol.name}</strong>
          <span>{kol.email}</span>
        </div>
        <span className={`marketing-stage-chip ${kol.pipelineStage}`}>{pipelineStageLabel(kol.pipelineStage)}</span>
      </header>

      <div className={`marketing-verdict-banner ${verdict}`}>
        <span className="marketing-verdict-icon">
          {verdict === 'pass' ? <ShieldCheck size={18} /> : <AlertTriangle size={18} />}
        </span>
        <div>
          <strong>{verdict === 'pass' ? '评估通过 · 建议发送合作提案' : '评估不通过 · 建议发送拒绝 + 折扣'}</strong>
          <span>{evaluation?.summary || (verdict === 'pass' ? '场景匹配、数据达标，推进合作。' : '不符合硬性 / 软性指标，礼貌婉拒并提供折扣。')}</span>
        </div>
        {existing && <span className="marketing-confirm-chip"><Check size={11} />{outreachKindLabel(existing.kind)} · {existing.by === 'agent' ? 'Agent' : '人工'}</span>}
      </div>

      <div className="marketing-reply-to">
        <Send size={12} />
        <span>回复给 <b>{kol.name}</b> &lt;{kol.email}&gt;</span>
        <span className={`marketing-reply-channel ${isEmail ? 'email' : ''}`}>{isEmail ? '一键回复经 SMTP 发送' : `${channel} · 需在外部发送`}</span>
      </div>

      <div className="marketing-process-controls">
        <label className="marketing-process-field">话术模板
          <select
            className="settings-input"
            value={scriptId}
            onChange={(event) => {
              const nextId = event.target.value;
              setScriptId(nextId);
              const next = options.find((s) => s.id === nextId);
              const ch = next?.channel ?? 'Email';
              setChannel(OUTREACH_CHANNELS.includes(ch) ? ch : 'Email');
              setBody(next ? renderScript(next.body, vars) : '');
            }}
          >
            {options.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
          </select>
        </label>
        <label className="marketing-process-field">发送渠道
          <select className="settings-input" value={channel} onChange={(event) => setChannel(event.target.value)}>
            {OUTREACH_CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      </div>

      <div className={`marketing-reco bare ${verdict}`}>
        <div className="marketing-reco-head">
          <span>回复正文（可编辑）</span>
          <div className="marketing-reco-head-actions">
            <button type="button" className="settings-btn ghost" onClick={resetBody} disabled={!rendered || body === rendered} title="恢复为话术模板原文">重置</button>
            <button type="button" className="settings-btn" onClick={copyScript} disabled={!body.trim()}>{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? '已复制' : '复制'}</button>
          </div>
        </div>
        <textarea
          className="marketing-reply-editor"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="选择话术模板后会自动填入，可在此个性化修改后一键发送。"
          spellCheck={false}
        />
      </div>

      <label className="marketing-eval-summary">外联备注（可选）
        <textarea className="settings-textarea compact" value={note} onChange={(event) => setNote(event.target.value)} placeholder="记录个性化要点或后续跟进备注" />
      </label>

      <div className="marketing-eval-buttons">
        <button
          type="button"
          className="settings-btn primary"
          disabled={busy || !body.trim() || !isEmail}
          onClick={sendReply}
          title={isEmail ? (verdict === 'pass' ? '通过 SMTP 直接发送提案并推进到「推进合作」' : '通过 SMTP 直接发送拒绝话术') : '仅 Email 渠道支持一键发送，请在外部发送后点「标记已发送」'}
        >
          <Send size={13} />一键回复
        </button>
        <button type="button" className="settings-btn" disabled={busy || !body.trim()} onClick={markSent} title={isEmail ? '不发送，仅记录为已发送（用于已在外部发出的情况）' : `记录已通过 ${channel} 发送`}>
          <Check size={13} />{existing ? '更新为已发送' : '仅标记已发送'}
        </button>
        <button type="button" className="settings-btn" disabled={busy} onClick={skip}>暂不联系</button>
        <button type="button" className="settings-btn ghost" onClick={copyAgentPrompt} title="复制让 Agent 起草个性化话术的指令">
          {copiedAgent ? <Check size={13} /> : <Sparkles size={13} />}{copiedAgent ? '已复制' : 'Agent 起草'}
        </button>
        <span className="spacer" />
        <button type="button" className="marketing-link-btn" onClick={() => onOpenKol(kol.id)}><UserCircle size={13} />KOL 档案</button>
      </div>
    </aside>
  );
}

interface IntakeSavePayload {
  status: 'done' | 'draft';
  username?: string;
  owner?: string;
  channel?: string;
  relationship?: string;
  phone?: string;
  platforms?: string;
  links?: string;
  contentType?: string;
  language?: string;
  metrics?: string;
  note?: string;
}

interface CollabSavePayload {
  status: 'sent' | 'signed' | 'declined';
  scriptId?: string;
  contractUrl?: string;
  videoCount?: number;
  channel?: string;
  note?: string;
  body?: string;
  send?: boolean;
}

interface ShipSavePayload {
  status: 'shipped' | 'delivered' | 'issue';
  carrier?: string;
  tracking?: string;
  trackingUrl?: string;
  address?: string;
  units?: string;
  expectedPostAt?: number | null;
  channel?: string;
  note?: string;
  body?: string;
  send?: boolean;
}

const INTAKE_CHANNELS = ['Email', 'SMS', 'DM'];
const INTAKE_RELATIONSHIPS: Array<{ value: string; label: string }> = [
  { value: 'inbound', label: '对方主动联系 (Inbound)' },
  { value: 'outbound', label: '我们主动建联 (Outbound)' },
];

// ---- Step 4 录入系统 -------------------------------------------------------

function IntakeWorkbench({
  kols,
  selectedId,
  busy,
  onSelect,
  onSave,
  onOpenKol,
}: {
  kols: KolProfile[];
  selectedId: string | null;
  busy: boolean;
  onSelect: (id: string) => void;
  onSave: (kol: KolProfile, payload: IntakeSavePayload) => void;
  onOpenKol: (id: string) => void;
}) {
  const [filter, setFilter] = useState<'todo' | 'done'>('todo');
  const [copiedBatch, setCopiedBatch] = useState(false);
  const buckets = useMemo(() => {
    const map: { todo: KolProfile[]; done: KolProfile[] } = { todo: [], done: [] };
    for (const kol of kols) {
      const bucket = kolIntakeBucket(kol);
      if (bucket === 'todo') map.todo.push(kol);
      else if (bucket === 'done') map.done.push(kol);
    }
    return map;
  }, [kols]);
  const list = buckets[filter];
  const selected = list.find((kol) => kol.id === selectedId) ?? list[0] ?? null;
  const todo = buckets.todo;

  const emptyHint =
    filter === 'done'
      ? '还没有完成录入的达人。完成录入后会出现在这里。'
      : '没有待录入的达人。Step 3 发出提案、对方回复意向后会进入这里。';

  const copyBatchPrompt = async () => {
    if (todo.length === 0) return;
    const roster = todo.map((kol, index) => `${index + 1}. id=${kol.id} | ${kol.name} <${kol.email}> | ${kol.country || '国家未知'}`);
    const prompt = [
      `请用 $sidebar-control 技能批量执行 Step 4 录入系统，共 ${todo.length} 位待录入达人：`,
      ...roster,
      '',
      '对每位：结合往来邮件 / meta 资料补全档案，然后执行：',
      'alpha-sidebar marketing kols intake --id <kolId> --username <@handle> --owner <跟进人> --channel Email|SMS|DM --relationship inbound|outbound [--phone ...] [--platforms "IG 45k / YT 12k"] [--links "..."] [--content-type "..."] [--language EN] [--metrics "均播18k 均赞900 周更"] [--note "评估结论/推荐理由/场景适配"] --reason "Step 4 录入系统"。',
      '录入完成（status 默认 done）会把阶段从 onboarding 推进到 intake。信息务必真实，缺失项可留空但不要编造。完成后汇总每位的关键信息给我。',
    ].join('\n');
    if (await copyToClipboard(prompt)) {
      setCopiedBatch(true);
      window.setTimeout(() => setCopiedBatch(false), 1600);
    }
  };

  return (
    <div className="marketing-step process">
      <div className="marketing-step-head">
        <div className="marketing-step-intro">
          <span className="marketing-step-tag"><UserCircle size={13} />Step 4 · 录入系统</span>
          <p>提案发出、达人回复意向后，把<b>用户名、跟进人、沟通渠道、联系方式、账号与内容数据</b>录入档案，方便后续无缝交接。保存后阶段推进到「推进合作」。</p>
        </div>
        <div className="marketing-step-actions">
          <button
            type="button"
            className="settings-btn ghost"
            disabled={todo.length === 0}
            onClick={copyBatchPrompt}
            title="复制让 Agent 批量补全并录入达人档案的指令"
          >
            {copiedBatch ? <Check size={13} /> : <Sparkles size={13} />}
            {copiedBatch ? '已复制' : `批量 Agent 录入${todo.length ? ` · ${todo.length}` : ''}`}
          </button>
          <div className="marketing-segment verdicts">
            <button type="button" className={filter === 'todo' ? 'active' : ''} onClick={() => setFilter('todo')}>待录入 {buckets.todo.length}</button>
            <button type="button" className={filter === 'done' ? 'active' : ''} onClick={() => setFilter('done')}>已录入 {buckets.done.length}</button>
          </div>
        </div>
      </div>
      <div className="marketing-split">
        <div className="marketing-eval-list">
          {list.length === 0 ? (
            <div className="partner-marketing-placeholder"><UserCircle size={18} /><span>{emptyHint}</span></div>
          ) : (
            list.map((kol) => {
              const intake = parseKolIntake(kol.intake);
              return (
                <button
                  key={kol.id}
                  type="button"
                  className={`marketing-eval-row pass ${kol.id === selected?.id ? 'selected' : ''}`}
                  onClick={() => onSelect(kol.id)}
                >
                  <span className="marketing-avatar sm">{initials(kol.name)}</span>
                  <span className="marketing-eval-row-main">
                    <strong>{kol.name}</strong>
                    <span>{kol.country || '国家未知'} · {kol.owner || '未分配跟进人'}</span>
                  </span>
                  <span className="marketing-eval-row-meta">
                    <span className={`marketing-verdict ${intake?.status === 'done' ? 'pass' : 'pending'}`}>
                      {intake?.status === 'done' ? <Check size={11} /> : <UserCircle size={11} />}
                      {intake?.status === 'done' ? '已录入' : '待录入'}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>
        <IntakePanel kol={selected} busy={busy} onSave={onSave} onOpenKol={onOpenKol} />
      </div>
    </div>
  );
}

function IntakePanel({
  kol,
  busy,
  onSave,
  onOpenKol,
}: {
  kol: KolProfile | null;
  busy: boolean;
  onSave: (kol: KolProfile, payload: IntakeSavePayload) => void;
  onOpenKol: (id: string) => void;
}) {
  const [form, setForm] = useState<IntakeSavePayload>({ status: 'done' });
  const [copiedAgent, setCopiedAgent] = useState(false);

  useEffect(() => {
    const prior = parseKolIntake(kol?.intake);
    setForm({
      status: 'done',
      username: prior?.username ?? '',
      owner: prior?.owner ?? kol?.owner ?? '',
      channel: prior?.channel ?? 'Email',
      relationship: prior?.relationship ?? (kol?.relationship === 'inbound' || kol?.relationship === 'outbound' ? kol.relationship : 'inbound'),
      phone: prior?.phone ?? '',
      platforms: prior?.platforms ?? '',
      links: prior?.links ?? '',
      contentType: prior?.contentType ?? '',
      language: prior?.language ?? '',
      metrics: prior?.metrics ?? '',
      note: prior?.note ?? kol?.agentNotes ?? '',
    });
    setCopiedAgent(false);
  }, [kol?.id, kol?.intake, kol?.owner, kol?.relationship, kol?.agentNotes]);

  if (!kol) {
    return (
      <aside className="marketing-detail-panel">
        <div className="partner-marketing-placeholder"><UserCircle size={18} /><span>选择一个达人开始录入。</span></div>
      </aside>
    );
  }

  const set = <K extends keyof IntakeSavePayload>(key: K, value: IntakeSavePayload[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));
  const intake = parseKolIntake(kol.intake);
  const evaluation = parseKolEvaluation(kol.evaluation);

  const save = (status: 'done' | 'draft') => onSave(kol, { ...form, status });
  const copyAgentPrompt = async () => {
    const prompt = [
      `请用 $sidebar-control 技能为 KOL「${kol.name}」<${kol.email}>（id=${kol.id}）完成 Step 4 录入系统。`,
      '结合往来邮件与公开资料补全：用户名、跟进人、沟通渠道、建联关系、联系方式、全网粉丝、账号链接、内容类型、语言、内容数据、备注（评估结论/推荐理由/场景适配）。',
      `执行：alpha-sidebar marketing kols intake --id ${kol.id} --username <@handle> --owner <跟进人> --channel Email|SMS|DM --relationship inbound|outbound [--platforms "..."] [--metrics "..."] [--note "..."] --reason "Step 4 录入系统"。信息要真实，不要编造链接。`,
    ].join('\n');
    if (await copyToClipboard(prompt)) {
      setCopiedAgent(true);
      window.setTimeout(() => setCopiedAgent(false), 1600);
    }
  };

  return (
    <aside className="marketing-detail-panel process">
      <header>
        <span className="marketing-avatar">{initials(kol.name)}</span>
        <div>
          <strong>{kol.name}</strong>
          <span>{kol.email}</span>
        </div>
        <span className={`marketing-stage-chip ${kol.pipelineStage}`}>{pipelineStageLabel(kol.pipelineStage)}</span>
      </header>

      {evaluation?.summary && (
        <div className="marketing-verdict-banner pass">
          <span className="marketing-verdict-icon"><ShieldCheck size={18} /></span>
          <div>
            <strong>评估结论 · {verdictShort(evaluation.status)}（评分 {evaluation.score}/6）</strong>
            <span>{evaluation.summary}</span>
          </div>
          {intake?.status === 'done' && <span className="marketing-confirm-chip"><Check size={11} />已录入 · {intake.by === 'agent' ? 'Agent' : '人工'}</span>}
        </div>
      )}

      <div className="marketing-intake-grid">
        <label className="marketing-process-field">网红用户名
          <input className="settings-input" value={form.username ?? ''} onChange={(e) => set('username', e.target.value)} placeholder="@handle" />
        </label>
        <label className="marketing-process-field">跟进人
          <input className="settings-input" value={form.owner ?? ''} onChange={(e) => set('owner', e.target.value)} placeholder="DM / 邮箱 → wei；短信 / 电话 → 小A" />
        </label>
        <label className="marketing-process-field">沟通渠道
          <select className="settings-input" value={form.channel ?? 'Email'} onChange={(e) => set('channel', e.target.value)}>
            {INTAKE_CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="marketing-process-field">建联关系
          <select className="settings-input" value={form.relationship ?? 'inbound'} onChange={(e) => set('relationship', e.target.value)}>
            {INTAKE_RELATIONSHIPS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </label>
        <label className="marketing-process-field">电话 / WhatsApp
          <input className="settings-input" value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value)} placeholder="可选" />
        </label>
        <label className="marketing-process-field">语言
          <input className="settings-input" value={form.language ?? ''} onChange={(e) => set('language', e.target.value)} placeholder="EN / 多语言" />
        </label>
        <label className="marketing-process-field">全网粉丝
          <input className="settings-input" value={form.platforms ?? ''} onChange={(e) => set('platforms', e.target.value)} placeholder="IG 45k / YT 12k / TK 8k" />
        </label>
        <label className="marketing-process-field">内容类型
          <input className="settings-input" value={form.contentType ?? ''} onChange={(e) => set('contentType', e.target.value)} placeholder="露营 / 房车 / 测评" />
        </label>
      </div>

      <label className="marketing-eval-summary">账号链接
        <textarea className="settings-textarea compact" value={form.links ?? ''} onChange={(e) => set('links', e.target.value)} placeholder="各平台主页链接，一行一个" />
      </label>
      <label className="marketing-eval-summary">内容数据
        <textarea className="settings-textarea compact" value={form.metrics ?? ''} onChange={(e) => set('metrics', e.target.value)} placeholder="平均播放 / 点赞 / 评论 / 更新频率" />
      </label>
      <label className="marketing-eval-summary">备注（评估结论 / 推荐理由 / 场景适配 / 流量）
        <textarea className="settings-textarea compact" value={form.note ?? ''} onChange={(e) => set('note', e.target.value)} placeholder="让下一个处理人无需重看 meta 即可直接沟通" />
      </label>

      <div className="marketing-eval-buttons">
        <button type="button" className="settings-btn primary" disabled={busy} onClick={() => save('done')} title="保存档案并推进到「推进合作」">
          <Check size={13} />{intake?.status === 'done' ? '更新录入' : '保存录入并推进'}
        </button>
        <button type="button" className="settings-btn" disabled={busy} onClick={() => save('draft')} title="保存为草稿，暂不推进阶段">存草稿</button>
        <button type="button" className="settings-btn ghost" onClick={copyAgentPrompt} title="复制让 Agent 补全并录入档案的指令">
          {copiedAgent ? <Check size={13} /> : <Sparkles size={13} />}{copiedAgent ? '已复制' : 'Agent 录入'}
        </button>
        <span className="spacer" />
        <button type="button" className="marketing-link-btn" onClick={() => onOpenKol(kol.id)}><UserCircle size={13} />KOL 档案</button>
      </div>
    </aside>
  );
}

// ---- Step 5 合作推进 -------------------------------------------------------

function CollabWorkbench({
  kols,
  selectedId,
  busy,
  autoReply,
  onSelect,
  onSave,
  onOpenKol,
}: {
  kols: KolProfile[];
  selectedId: string | null;
  busy: boolean;
  autoReply: boolean;
  onSelect: (id: string) => void;
  onSave: (kol: KolProfile, payload: CollabSavePayload) => void;
  onOpenKol: (id: string) => void;
}) {
  const [filter, setFilter] = useState<'todo' | 'done'>('todo');
  const [copiedBatch, setCopiedBatch] = useState(false);
  const buckets = useMemo(() => {
    const map: { todo: KolProfile[]; done: KolProfile[] } = { todo: [], done: [] };
    for (const kol of kols) {
      const bucket = kolCollabBucket(kol);
      if (bucket === 'todo') map.todo.push(kol);
      else if (bucket === 'done') map.done.push(kol);
    }
    return map;
  }, [kols]);
  const list = buckets[filter];
  const selected = list.find((kol) => kol.id === selectedId) ?? list[0] ?? null;
  const todo = buckets.todo;

  const emptyHint =
    filter === 'done'
      ? '还没有签约 / 流失的达人。签约后会出现在这里。'
      : '没有待推进的达人。完成 Step 4 录入后会进入这里。';

  const copyBatchPrompt = async () => {
    if (todo.length === 0) return;
    const roster = todo.map((kol, index) => `${index + 1}. id=${kol.id} | ${kol.name} <${kol.email}>`);
    const tail = autoReply
      ? '已开启「Agent 自主回复」：可直接发送合同邮件并记录——alpha-sidebar marketing kols collaborate --id <kolId> --status sent --contract-url <已改名合同链接> --send true --body "<合同邮件正文>" --reason "Step 5 合作推进"。对方签字回传后再 --status signed 推进到签约。'
      : '未开启「Agent 自主回复」：只整理好每位的合同邮件草稿与改名后的合同链接给我审阅，不要发送。我会在面板逐个确认发送。';
    const prompt = [
      `请用 $sidebar-control 技能批量执行 Step 5 合作推进，共 ${todo.length} 位待推进达人：`,
      ...roster,
      '',
      '根据对方回复选择话术（直接同意签约→「直接同意签约·发送合同」；有异议→对应异议话术）。先复制合同模板改名（格式：网红用户名-姓名），把链接填进 contract-url 与正文。',
      tail,
    ].join('\n');
    if (await copyToClipboard(prompt)) {
      setCopiedBatch(true);
      window.setTimeout(() => setCopiedBatch(false), 1600);
    }
  };

  return (
    <div className="marketing-step process">
      <div className="marketing-step-head">
        <div className="marketing-step-intro">
          <span className="marketing-step-tag"><FileText size={13} />Step 5 · 合作推进</span>
          <p>按对方回复选话术，<b>发送合同</b>或处理异议。填入改名后的合同链接，<b>一键发送合同邮件</b>；对方签字回传后点<b>标记已签约</b>推进到下一步。</p>
        </div>
        <div className="marketing-step-actions">
          <button
            type="button"
            className="settings-btn ghost"
            disabled={todo.length === 0}
            onClick={copyBatchPrompt}
            title="复制让 Agent 批量起草合同 / 异议话术的指令"
          >
            {copiedBatch ? <Check size={13} /> : <Sparkles size={13} />}
            {copiedBatch ? '已复制' : `批量 Agent 推进${todo.length ? ` · ${todo.length}` : ''}`}
          </button>
          <div className="marketing-segment verdicts">
            <button type="button" className={filter === 'todo' ? 'active' : ''} onClick={() => setFilter('todo')}>待推进 {buckets.todo.length}</button>
            <button type="button" className={filter === 'done' ? 'active' : ''} onClick={() => setFilter('done')}>已签约 {buckets.done.length}</button>
          </div>
        </div>
      </div>
      <div className="marketing-split">
        <div className="marketing-eval-list">
          {list.length === 0 ? (
            <div className="partner-marketing-placeholder"><FileText size={18} /><span>{emptyHint}</span></div>
          ) : (
            list.map((kol) => {
              const collab = parseKolCollab(kol.collaboration);
              const tone = collab?.status === 'signed' ? 'pass' : collab?.status === 'declined' ? 'fail' : 'pending';
              return (
                <button
                  key={kol.id}
                  type="button"
                  className={`marketing-eval-row ${tone === 'fail' ? 'fail' : 'pass'} ${kol.id === selected?.id ? 'selected' : ''}`}
                  onClick={() => onSelect(kol.id)}
                >
                  <span className="marketing-avatar sm">{initials(kol.name)}</span>
                  <span className="marketing-eval-row-main">
                    <strong>{kol.name}</strong>
                    <span>{kol.country || '国家未知'} · {kol.owner || '未分配'}</span>
                  </span>
                  <span className="marketing-eval-row-meta">
                    <span className={`marketing-verdict ${tone}`}>
                      {collab?.status === 'signed' ? <Check size={11} /> : collab?.status === 'declined' ? <AlertTriangle size={11} /> : <FileText size={11} />}
                      {collab ? collabStatusLabel(collab.status) : '待发合同'}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>
        <CollabPanel kol={selected} busy={busy} onSave={onSave} onOpenKol={onOpenKol} />
      </div>
    </div>
  );
}

function CollabPanel({
  kol,
  busy,
  onSave,
  onOpenKol,
}: {
  kol: KolProfile | null;
  busy: boolean;
  onSave: (kol: KolProfile, payload: CollabSavePayload) => void;
  onOpenKol: (id: string) => void;
}) {
  const options = useMemo(() => collabScriptOptions(), []);
  const vars = useMemo(() => loadScriptVars(), []);

  const [scriptId, setScriptId] = useState<string>('');
  const [channel, setChannel] = useState<string>('Email');
  const [contractUrl, setContractUrl] = useState<string>('');
  const [videoCount, setVideoCount] = useState<string>('');
  const [note, setNote] = useState<string>('');
  const [body, setBody] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [copiedAgent, setCopiedAgent] = useState(false);

  useEffect(() => {
    const prior = parseKolCollab(kol?.collaboration);
    const opts = collabScriptOptions();
    const initialScript = prior?.scriptId && opts.some((s) => s.id === prior.scriptId)
      ? prior.scriptId
      : opts[0]?.id ?? '';
    setScriptId(initialScript);
    const initialObj = opts.find((s) => s.id === initialScript) ?? null;
    const ch = initialObj?.channel ?? 'Email';
    setChannel(OUTREACH_CHANNELS.includes(ch) ? ch : 'Email');
    setContractUrl(prior?.contractUrl ?? vars.proposalUrl ?? '');
    setVideoCount(prior?.videoCount != null ? String(prior.videoCount) : '');
    setNote(prior?.note ?? '');
    setBody(initialObj ? renderScript(initialObj.body, vars) : '');
    setCopied(false);
    setCopiedAgent(false);
  }, [kol?.id, kol?.collaboration, vars]);

  if (!kol) {
    return (
      <aside className="marketing-detail-panel">
        <div className="partner-marketing-placeholder"><FileText size={18} /><span>选择一个达人开始推进。</span></div>
      </aside>
    );
  }

  const existing = parseKolCollab(kol.collaboration);
  const isEmail = channel === 'Email';
  const copyScript = async () => {
    if (body.trim() && (await copyToClipboard(body))) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }
  };
  const parsedVideoCount = videoCount.trim() ? Number(videoCount) : undefined;
  const basePayload = (): CollabSavePayload => ({
    status: 'sent',
    scriptId,
    contractUrl: contractUrl.trim() || undefined,
    videoCount: parsedVideoCount != null && !Number.isNaN(parsedVideoCount) ? parsedVideoCount : undefined,
    channel,
    note,
    body,
  });
  const sendContract = () => onSave(kol, { ...basePayload(), status: 'sent', send: true });
  const recordSent = () => onSave(kol, { ...basePayload(), status: 'sent', send: false });
  const markSigned = () => onSave(kol, { ...basePayload(), status: 'signed', send: false });
  const markDeclined = () => onSave(kol, { ...basePayload(), status: 'declined', send: false });
  const copyAgentPrompt = async () => {
    const script = options.find((s) => s.id === scriptId) ?? null;
    const prompt = [
      `请用 $sidebar-control 技能为 KOL「${kol.name}」<${kol.email}>（id=${kol.id}）起草 Step 5 合作推进话术。`,
      `基础模板：话术库「${script?.title ?? ''}」。先复制合同模板改名（格式：网红用户名-姓名），把链接放入正文与 --contract-url，保留话术库变量，不要编造链接。`,
      `如需发送：alpha-sidebar marketing kols collaborate --id ${kol.id} --status sent --contract-url <链接> --send true --body "<正文>" --reason "Step 5 合作推进"；签字回传后 --status signed。`,
    ].join('\n');
    if (await copyToClipboard(prompt)) {
      setCopiedAgent(true);
      window.setTimeout(() => setCopiedAgent(false), 1600);
    }
  };

  return (
    <aside className="marketing-detail-panel process">
      <header>
        <span className="marketing-avatar">{initials(kol.name)}</span>
        <div>
          <strong>{kol.name}</strong>
          <span>{kol.email}</span>
        </div>
        <span className={`marketing-stage-chip ${kol.pipelineStage}`}>{pipelineStageLabel(kol.pipelineStage)}</span>
      </header>

      <div className="marketing-reply-to">
        <FileText size={12} />
        <span>发送给 <b>{kol.name}</b> &lt;{kol.email}&gt;</span>
        <span className={`marketing-reply-channel ${isEmail ? 'email' : ''}`}>{isEmail ? '一键发送经 SMTP' : `${channel} · 需在外部发送`}</span>
        {existing && <span className="marketing-confirm-chip"><Check size={11} />{collabStatusLabel(existing.status)} · {existing.by === 'agent' ? 'Agent' : '人工'}</span>}
      </div>

      <div className="marketing-process-controls">
        <label className="marketing-process-field">话术模板
          <select
            className="settings-input"
            value={scriptId}
            onChange={(event) => {
              const nextId = event.target.value;
              setScriptId(nextId);
              const next = options.find((s) => s.id === nextId);
              const ch = next?.channel ?? 'Email';
              setChannel(OUTREACH_CHANNELS.includes(ch) ? ch : 'Email');
              setBody(next ? renderScript(next.body, vars) : '');
            }}
          >
            {options.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
          </select>
        </label>
        <label className="marketing-process-field">发送渠道
          <select className="settings-input" value={channel} onChange={(event) => setChannel(event.target.value)}>
            {OUTREACH_CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      </div>
      <div className="marketing-process-controls">
        <label className="marketing-process-field">合同链接（改名后）
          <input className="settings-input" value={contractUrl} onChange={(e) => setContractUrl(e.target.value)} placeholder="https://drive.google.com/...（网红用户名-姓名）" />
        </label>
        <label className="marketing-process-field">视频数量
          <input className="settings-input" type="number" min={0} value={videoCount} onChange={(e) => setVideoCount(e.target.value)} placeholder="如 2" />
        </label>
      </div>

      <div className="marketing-reco bare pass">
        <div className="marketing-reco-head">
          <span>合同 / 推进正文（可编辑）</span>
          <div className="marketing-reco-head-actions">
            <button type="button" className="settings-btn" onClick={copyScript} disabled={!body.trim()}>{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? '已复制' : '复制'}</button>
          </div>
        </div>
        <textarea
          className="marketing-reply-editor"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="选择话术模板后会自动填入，记得把合同链接插入正文。"
          spellCheck={false}
        />
      </div>

      <label className="marketing-eval-summary">推进备注（可选）
        <textarea className="settings-textarea compact" value={note} onChange={(event) => setNote(event.target.value)} placeholder="记录异议处理、最新沟通情况" />
      </label>

      <div className="marketing-eval-buttons">
        <button type="button" className="settings-btn primary" disabled={busy || !body.trim() || !isEmail} onClick={sendContract} title={isEmail ? '通过 SMTP 直接发送合同邮件并记录' : '仅 Email 渠道支持一键发送'}>
          <Send size={13} />发送合同邮件
        </button>
        <button type="button" className="settings-btn" disabled={busy} onClick={recordSent} title="不发送，仅记录已发合同（外部已发出时）">
          <Check size={13} />记录已发合同
        </button>
        <button type="button" className="settings-btn success" disabled={busy} onClick={markSigned} title="对方已签字回传，推进到「已签约」">
          <ShieldCheck size={13} />标记已签约
        </button>
        <button type="button" className="settings-btn" disabled={busy} onClick={markDeclined} title="对方拒绝 / 流失">流失</button>
        <button type="button" className="settings-btn ghost" onClick={copyAgentPrompt} title="复制让 Agent 起草合同 / 异议话术的指令">
          {copiedAgent ? <Check size={13} /> : <Sparkles size={13} />}{copiedAgent ? '已复制' : 'Agent 起草'}
        </button>
        <span className="spacer" />
        <button type="button" className="marketing-link-btn" onClick={() => onOpenKol(kol.id)}><UserCircle size={13} />KOL 档案</button>
      </div>
    </aside>
  );
}

// ---- Step 6 发货流程 -------------------------------------------------------

function ShipWorkbench({
  kols,
  selectedId,
  busy,
  onSelect,
  onSave,
  onOpenKol,
}: {
  kols: KolProfile[];
  selectedId: string | null;
  busy: boolean;
  onSelect: (id: string) => void;
  onSave: (kol: KolProfile, payload: ShipSavePayload) => void;
  onOpenKol: (id: string) => void;
}) {
  const [filter, setFilter] = useState<'todo' | 'done'>('todo');
  const [copiedBatch, setCopiedBatch] = useState(false);
  const buckets = useMemo(() => {
    const map: { todo: KolProfile[]; done: KolProfile[] } = { todo: [], done: [] };
    for (const kol of kols) {
      const bucket = kolShipBucket(kol);
      if (bucket === 'todo') map.todo.push(kol);
      else if (bucket === 'done') map.done.push(kol);
    }
    return map;
  }, [kols]);
  const list = buckets[filter];
  const selected = list.find((kol) => kol.id === selectedId) ?? list[0] ?? null;
  const todo = buckets.todo;

  const emptyHint =
    filter === 'done'
      ? '还没有已发货的达人。安排发货后会出现在这里。'
      : '没有待发货的达人。完成 Step 5 签约后会进入这里。';

  const copyBatchPrompt = async () => {
    if (todo.length === 0) return;
    const roster = todo.map((kol, index) => `${index + 1}. id=${kol.id} | ${kol.name} <${kol.email}>`);
    const prompt = [
      `请用 $sidebar-control 技能批量执行 Step 6 发货流程，共 ${todo.length} 位待发货达人：`,
      ...roster,
      '',
      '安排发货后回传物流信息并发送发货通知：alpha-sidebar marketing kols ship --id <kolId> --status shipped --carrier <承运商> --tracking <运单号> --tracking-url https://parcelsapp.com/en/tracking/<单号> [--units "1x MK3"] [--expected-post-at <ms>] [--send true --body "<发货通知正文>"] --reason "Step 6 发货流程"。',
      '发货前先核对合同（最晚发布日期、视频数量、单元/配件数量、电子签名、附加条款）。内容发布后 --status delivered 标记完成。完成后汇总每位的物流单号给我。',
    ].join('\n');
    if (await copyToClipboard(prompt)) {
      setCopiedBatch(true);
      window.setTimeout(() => setCopiedBatch(false), 1600);
    }
  };

  return (
    <div className="marketing-step process">
      <div className="marketing-step-head">
        <div className="marketing-step-intro">
          <span className="marketing-step-tag"><Truck size={13} />Step 6 · 发货流程</span>
          <p>签约后<b>核对合同→安排发货→回传物流</b>，一键发送发货通知，并跟进内容发布。内容上线后标记<b>已完成</b>。</p>
        </div>
        <div className="marketing-step-actions">
          <button
            type="button"
            className="settings-btn ghost"
            disabled={todo.length === 0}
            onClick={copyBatchPrompt}
            title="复制让 Agent 批量安排发货并起草发货通知的指令"
          >
            {copiedBatch ? <Check size={13} /> : <Sparkles size={13} />}
            {copiedBatch ? '已复制' : `批量 Agent 发货${todo.length ? ` · ${todo.length}` : ''}`}
          </button>
          <div className="marketing-segment verdicts">
            <button type="button" className={filter === 'todo' ? 'active' : ''} onClick={() => setFilter('todo')}>待发货 {buckets.todo.length}</button>
            <button type="button" className={filter === 'done' ? 'active' : ''} onClick={() => setFilter('done')}>已发货 {buckets.done.length}</button>
          </div>
        </div>
      </div>
      <div className="marketing-split">
        <div className="marketing-eval-list">
          {list.length === 0 ? (
            <div className="partner-marketing-placeholder"><Truck size={18} /><span>{emptyHint}</span></div>
          ) : (
            list.map((kol) => {
              const ship = parseKolShipment(kol.shipment);
              const tone = ship?.status === 'issue' ? 'fail' : 'pass';
              return (
                <button
                  key={kol.id}
                  type="button"
                  className={`marketing-eval-row ${tone} ${kol.id === selected?.id ? 'selected' : ''}`}
                  onClick={() => onSelect(kol.id)}
                >
                  <span className="marketing-avatar sm">{initials(kol.name)}</span>
                  <span className="marketing-eval-row-main">
                    <strong>{kol.name}</strong>
                    <span>{ship?.tracking ? `单号 ${ship.tracking}` : kol.country || '国家未知'}</span>
                  </span>
                  <span className="marketing-eval-row-meta">
                    <span className={`marketing-verdict ${ship?.status === 'issue' ? 'fail' : ship ? 'pass' : 'pending'}`}>
                      {ship?.status === 'issue' ? <AlertTriangle size={11} /> : ship ? <Check size={11} /> : <Truck size={11} />}
                      {ship ? shipmentStatusLabel(ship.status) : '待发货'}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>
        <ShipPanel kol={selected} busy={busy} onSave={onSave} onOpenKol={onOpenKol} />
      </div>
    </div>
  );
}

function ShipPanel({
  kol,
  busy,
  onSave,
  onOpenKol,
}: {
  kol: KolProfile | null;
  busy: boolean;
  onSave: (kol: KolProfile, payload: ShipSavePayload) => void;
  onOpenKol: (id: string) => void;
}) {
  const options = useMemo(() => shipScriptOptions(), []);
  const vars = useMemo(() => loadScriptVars(), []);

  const [scriptId, setScriptId] = useState<string>('');
  const [channel, setChannel] = useState<string>('Email');
  const [carrier, setCarrier] = useState<string>('');
  const [tracking, setTracking] = useState<string>('');
  const [trackingUrl, setTrackingUrl] = useState<string>('');
  const [address, setAddress] = useState<string>('');
  const [units, setUnits] = useState<string>('');
  const [expectedPost, setExpectedPost] = useState<string>('');
  const [note, setNote] = useState<string>('');
  const [body, setBody] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [copiedAgent, setCopiedAgent] = useState(false);

  useEffect(() => {
    const prior = parseKolShipment(kol?.shipment);
    const opts = shipScriptOptions();
    const initialScript = opts[0]?.id ?? '';
    setScriptId(initialScript);
    const initialObj = opts.find((s) => s.id === initialScript) ?? null;
    const ch = initialObj?.channel ?? 'Email';
    setChannel(OUTREACH_CHANNELS.includes(ch) ? ch : 'Email');
    setCarrier(prior?.carrier ?? '');
    setTracking(prior?.tracking ?? '');
    setTrackingUrl(prior?.trackingUrl ?? 'https://parcelsapp.com/en/tracking/');
    setAddress(prior?.address ?? '');
    setUnits(prior?.units ?? '');
    setExpectedPost(msToDateInput(prior?.expectedPostAt));
    setNote(prior?.note ?? '');
    setBody(initialObj ? renderScript(initialObj.body, vars) : '');
    setCopied(false);
    setCopiedAgent(false);
  }, [kol?.id, kol?.shipment, vars]);

  if (!kol) {
    return (
      <aside className="marketing-detail-panel">
        <div className="partner-marketing-placeholder"><Truck size={18} /><span>选择一个达人开始发货。</span></div>
      </aside>
    );
  }

  const existing = parseKolShipment(kol.shipment);
  const isEmail = channel === 'Email';
  const copyScript = async () => {
    if (body.trim() && (await copyToClipboard(body))) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }
  };
  const basePayload = (): ShipSavePayload => ({
    status: 'shipped',
    carrier: carrier.trim() || undefined,
    tracking: tracking.trim() || undefined,
    trackingUrl: trackingUrl.trim() || undefined,
    address: address.trim() || undefined,
    units: units.trim() || undefined,
    expectedPostAt: dateInputToMs(expectedPost),
    channel,
    note,
    body,
  });
  const sendNotice = () => onSave(kol, { ...basePayload(), status: 'shipped', send: true });
  const markShipped = () => onSave(kol, { ...basePayload(), status: 'shipped', send: false });
  const markDelivered = () => onSave(kol, { ...basePayload(), status: 'delivered', send: false });
  const markIssue = () => onSave(kol, { ...basePayload(), status: 'issue', send: false });
  const copyAgentPrompt = async () => {
    const script = options.find((s) => s.id === scriptId) ?? null;
    const prompt = [
      `请用 $sidebar-control 技能为 KOL「${kol.name}」<${kol.email}>（id=${kol.id}）执行 Step 6 发货流程。`,
      `基础模板：话术库「${script?.title ?? ''}」。安排发货后填入承运商、运单号、物流查询链接。`,
      `执行：alpha-sidebar marketing kols ship --id ${kol.id} --status shipped --carrier <承运商> --tracking <单号> --tracking-url <链接> [--send true --body "<发货通知正文>"] --reason "Step 6 发货流程"；内容发布后 --status delivered。`,
    ].join('\n');
    if (await copyToClipboard(prompt)) {
      setCopiedAgent(true);
      window.setTimeout(() => setCopiedAgent(false), 1600);
    }
  };

  return (
    <aside className="marketing-detail-panel process">
      <header>
        <span className="marketing-avatar">{initials(kol.name)}</span>
        <div>
          <strong>{kol.name}</strong>
          <span>{kol.email}</span>
        </div>
        <span className={`marketing-stage-chip ${kol.pipelineStage}`}>{pipelineStageLabel(kol.pipelineStage)}</span>
      </header>

      <div className="marketing-reply-to">
        <Truck size={12} />
        <span>发货通知给 <b>{kol.name}</b> &lt;{kol.email}&gt;</span>
        <span className={`marketing-reply-channel ${isEmail ? 'email' : ''}`}>{isEmail ? '一键发送经 SMTP' : `${channel} · 需在外部发送`}</span>
        {existing && <span className="marketing-confirm-chip"><Check size={11} />{shipmentStatusLabel(existing.status)} · {existing.by === 'agent' ? 'Agent' : '人工'}</span>}
      </div>

      <div className="marketing-process-controls">
        <label className="marketing-process-field">承运商
          <input className="settings-input" value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder="UPS / FedEx / DHL" />
        </label>
        <label className="marketing-process-field">运单号
          <input className="settings-input" value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="Tracking #" />
        </label>
      </div>
      <div className="marketing-process-controls">
        <label className="marketing-process-field">物流查询链接
          <input className="settings-input" value={trackingUrl} onChange={(e) => setTrackingUrl(e.target.value)} placeholder="https://parcelsapp.com/en/tracking/..." />
        </label>
        <label className="marketing-process-field">单元 / 配件
          <input className="settings-input" value={units} onChange={(e) => setUnits(e.target.value)} placeholder="1x Mark 3 + 1 电池" />
        </label>
      </div>
      <div className="marketing-process-controls">
        <label className="marketing-process-field">收货地址
          <input className="settings-input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="发货地址" />
        </label>
        <label className="marketing-process-field">预计发布日期
          <input className="settings-input" type="date" value={expectedPost} onChange={(e) => setExpectedPost(e.target.value)} />
        </label>
      </div>

      <div className="marketing-reco bare pass">
        <div className="marketing-reco-head">
          <span>发货通知正文（可编辑）</span>
          <div className="marketing-reco-head-actions">
            <button type="button" className="settings-btn" onClick={copyScript} disabled={!body.trim()}>{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? '已复制' : '复制'}</button>
          </div>
        </div>
        <textarea
          className="marketing-reply-editor"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="选择话术模板后会自动填入，记得补充物流信息。"
          spellCheck={false}
        />
      </div>

      <label className="marketing-eval-summary">发货备注（可选）
        <textarea className="settings-textarea compact" value={note} onChange={(event) => setNote(event.target.value)} placeholder="合同核对、异常处理、内容跟进" />
      </label>

      <div className="marketing-eval-buttons">
        <button type="button" className="settings-btn primary" disabled={busy || !body.trim() || !isEmail} onClick={sendNotice} title={isEmail ? '通过 SMTP 直接发送发货通知并记录' : '仅 Email 渠道支持一键发送'}>
          <Send size={13} />发送发货通知
        </button>
        <button type="button" className="settings-btn" disabled={busy} onClick={markShipped} title="不发送，仅记录已发货">
          <Truck size={13} />标记已发货
        </button>
        <button type="button" className="settings-btn success" disabled={busy} onClick={markDelivered} title="内容已发布 / 合作完成">
          <Check size={13} />标记已完成
        </button>
        <button type="button" className="settings-btn" disabled={busy} onClick={markIssue} title="物流 / 产品异常，待处理">物流异常</button>
        <button type="button" className="settings-btn ghost" onClick={copyAgentPrompt} title="复制让 Agent 安排发货并起草通知的指令">
          {copiedAgent ? <Check size={13} /> : <Sparkles size={13} />}{copiedAgent ? '已复制' : 'Agent 发货'}
        </button>
        <span className="spacer" />
        <button type="button" className="marketing-link-btn" onClick={() => onOpenKol(kol.id)}><UserCircle size={13} />KOL 档案</button>
      </div>
    </aside>
  );
}

interface ScriptCardModel {
  script: ScriptTemplate;
  isCustom: boolean;
  isEdited: boolean;
}

function ScriptCard({
  model,
  vars,
  onSave,
  onReset,
  onDelete,
}: {
  model: ScriptCardModel;
  vars: Record<string, string>;
  onSave: (id: string, patch: ScriptOverride) => void;
  onReset: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const { script, isCustom, isEdited } = model;
  const emptyBody = script.body.trim().length === 0;
  const [open, setOpen] = useState(emptyBody);
  const [editing, setEditing] = useState(emptyBody);
  const [draft, setDraft] = useState<ScriptOverride>({ title: script.title, channel: script.channel, body: script.body });
  const [copied, setCopied] = useState(false);
  const rendered = renderScript(script.body, vars);

  useEffect(() => {
    if (!editing) {
      setDraft({ title: script.title, channel: script.channel, body: script.body });
    }
  }, [script.title, script.channel, script.body, editing]);

  const startEdit = () => {
    setDraft({ title: script.title, channel: script.channel, body: script.body });
    setOpen(true);
    setEditing(true);
  };
  const save = () => {
    onSave(script.id, {
      title: draft.title.trim() || script.title,
      channel: draft.channel.trim() || '通用',
      body: draft.body,
    });
    setEditing(false);
  };
  const cancel = () => {
    setDraft({ title: script.title, channel: script.channel, body: script.body });
    setEditing(false);
  };
  const copy = async () => {
    if (await copyToClipboard(rendered)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }
  };

  return (
    <div className={`marketing-script-card ${open ? 'open' : ''}`}>
      <div className="marketing-script-summary">
        <button type="button" className="marketing-script-toggle" onClick={() => setOpen((value) => !value)}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span className="marketing-script-title">{script.title}</span>
        </button>
        <span className="marketing-script-channel">{script.channel}</span>
        {isCustom ? (
          <span className="marketing-script-flag custom">自定义</span>
        ) : isEdited ? (
          <span className="marketing-script-flag">已修改</span>
        ) : null}
        <button type="button" className="marketing-icon-btn" title="复制话术" onClick={() => void copy()} disabled={!script.body.trim()}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
        <button type="button" className="marketing-icon-btn" title="编辑话术" onClick={startEdit}>
          <Pencil size={14} />
        </button>
      </div>
      {open && (
        editing ? (
          <div className="marketing-script-edit">
            <div className="marketing-script-edit-row">
              <label>标题
                <input className="settings-input" value={draft.title} onChange={(event) => setDraft((d) => ({ ...d, title: event.target.value }))} placeholder="话术标题" />
              </label>
              <label>渠道
                <input className="settings-input" value={draft.channel} onChange={(event) => setDraft((d) => ({ ...d, channel: event.target.value }))} placeholder="如 Email / IG DM / 通用" />
              </label>
            </div>
            <label>正文
              <textarea className="settings-textarea" value={draft.body} onChange={(event) => setDraft((d) => ({ ...d, body: event.target.value }))} placeholder="在此编辑话术内容…" />
            </label>
            <p className="marketing-script-hint">
              可使用变量占位：{SCRIPT_VAR_DEFS.map((def, index) => (
                <span key={def.key}>{index > 0 ? '、' : ''}<code>{`{{${def.key}}}`}</code></span>
              ))}，复制时自动替换为「协议链接与联系方式」里的配置。
            </p>
            <div className="marketing-script-edit-actions">
              <button type="button" className="settings-btn primary" onClick={save}><Check size={13} />保存</button>
              <button type="button" className="settings-btn" onClick={cancel}>取消</button>
              <span className="spacer" />
              {isCustom ? (
                <button type="button" className="settings-btn danger" onClick={() => onDelete(script.id)}><Trash2 size={13} />删除</button>
              ) : isEdited ? (
                <button type="button" className="settings-btn" onClick={() => { onReset(script.id); setEditing(false); }}><RotateCcw size={13} />恢复默认</button>
              ) : null}
            </div>
          </div>
        ) : (
          <pre className="marketing-script-body">{rendered || '（空白话术，点击编辑填写内容）'}</pre>
        )
      )}
    </div>
  );
}

function ScriptVarsCard({
  vars,
  onSave,
}: {
  vars: Record<string, string>;
  onSave: (next: Record<string, string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>(vars);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setDraft(vars);
  }, [vars]);

  const dirty = SCRIPT_VAR_DEFS.some((def) => (draft[def.key] ?? '') !== (vars[def.key] ?? ''));

  const save = () => {
    onSave({ ...vars, ...draft });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1600);
  };
  const reset = () => {
    const defaults = defaultScriptVars();
    setDraft(defaults);
    onSave(defaults);
  };

  return (
    <div className={`marketing-vars-card ${open ? 'open' : ''}`}>
      <button type="button" className="marketing-vars-summary" onClick={() => setOpen((value) => !value)}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <Link2 size={14} />
        <span className="marketing-vars-title">协议链接与联系方式</span>
        <span className="marketing-vars-sub">统一配置，所有话术自动读取</span>
      </button>
      {open && (
        <div className="marketing-vars-body">
          <div className="marketing-vars-grid">
            {SCRIPT_VAR_DEFS.map((def) => (
              <label key={def.key} className="marketing-vars-field">
                <span className="marketing-vars-label">
                  {def.label}
                  <code>{`{{${def.key}}}`}</code>
                </span>
                <input
                  className="settings-input"
                  value={draft[def.key] ?? ''}
                  onChange={(event) => setDraft((current) => ({ ...current, [def.key]: event.target.value }))}
                  placeholder={def.defaultValue}
                />
                {def.hint ? <span className="marketing-vars-hint">{def.hint}</span> : null}
              </label>
            ))}
          </div>
          <div className="marketing-vars-actions">
            <button type="button" className="settings-btn primary" onClick={save} disabled={!dirty}>
              {saved ? <Check size={13} /> : <Save size={13} />}{saved ? '已保存' : '保存'}
            </button>
            <button type="button" className="settings-btn" onClick={reset}><RotateCcw size={13} />恢复默认</button>
            <span className="marketing-vars-note">话术正文里用 <code>{'{{key}}'}</code> 占位，复制时会自动替换为上面的值。</span>
          </div>
        </div>
      )}
    </div>
  );
}

function ScriptLibrary({ query }: { query: string }) {
  const [overrides, setOverrides] = useState<Record<string, ScriptOverride>>(() => loadScriptOverrides());
  const [custom, setCustom] = useState<ScriptTemplate[]>(() => loadCustomScripts());
  const [vars, setVars] = useState<Record<string, string>>(() => loadScriptVars());

  const persistVars = (next: Record<string, string>) => {
    setVars(next);
    try { localStorage.setItem(SCRIPT_VARS_KEY, JSON.stringify(next)); } catch { /* best-effort */ }
  };

  const persistOverrides = (next: Record<string, ScriptOverride>) => {
    setOverrides(next);
    try { localStorage.setItem(SCRIPT_OVERRIDES_KEY, JSON.stringify(next)); } catch { /* best-effort */ }
  };
  const persistCustom = (next: ScriptTemplate[]) => {
    setCustom(next);
    try { localStorage.setItem(SCRIPT_CUSTOM_KEY, JSON.stringify(next)); } catch { /* best-effort */ }
  };

  const models: ScriptCardModel[] = [
    ...SCRIPT_LIBRARY.map((script) => {
      const override = overrides[script.id];
      return { script: override ? { ...script, ...override } : script, isCustom: false, isEdited: Boolean(override) };
    }),
    ...custom.map((script) => ({ script, isCustom: true, isEdited: false })),
  ];

  const normalized = query.trim().toLowerCase();
  const filtered = models.filter(({ script }) =>
    !normalized || [script.title, script.group, script.channel, script.body, renderScript(script.body, vars)].some((value) => value.toLowerCase().includes(normalized)),
  );
  const groups = Array.from(new Set(filtered.map(({ script }) => script.group)));

  const handleSave = (id: string, patch: ScriptOverride) => {
    if (custom.some((item) => item.id === id)) {
      persistCustom(custom.map((item) => (item.id === id ? { ...item, ...patch } : item)));
    } else {
      persistOverrides({ ...overrides, [id]: patch });
    }
  };
  const handleReset = (id: string) => {
    const next = { ...overrides };
    delete next[id];
    persistOverrides(next);
  };
  const handleDelete = (id: string) => {
    persistCustom(custom.filter((item) => item.id !== id));
  };
  const handleAdd = () => {
    const id = `custom-${Date.now()}`;
    persistCustom([...custom, { id, group: '自定义话术', title: '新话术', channel: '通用', body: '' }]);
  };

  return (
    <div className="marketing-step">
      <div className="marketing-step-head">
        <div className="marketing-step-intro">
          <span className="marketing-step-tag"><FileText size={13} />话术库</span>
          <p>所有话术均可人工编辑并保存（自动记忆），随时一键复制粘贴。内置话术修改后可「恢复默认」，也可「新建话术」收录团队自己的模板。</p>
        </div>
        <div className="marketing-step-actions">
          <button type="button" className="settings-btn primary" onClick={handleAdd}><Plus size={13} />新建话术</button>
        </div>
      </div>
      <ScriptVarsCard vars={vars} onSave={persistVars} />
      {filtered.length === 0 ? (
        <MarketingEmptyState
          icon={<FileText size={26} />}
          title="没有匹配的话术"
          description="换个关键词，或点击右上角「新建话术」收录你自己的模板。"
        />
      ) : (
        <div className="marketing-scripts">
          {groups.map((group) => {
            const items = filtered.filter(({ script }) => script.group === group);
            return (
              <section key={group} className="marketing-script-group">
                <h4>{group}<em>{items.length}</em></h4>
                {items.map((model) => (
                  <ScriptCard
                    key={model.script.id}
                    model={model}
                    vars={vars}
                    onSave={handleSave}
                    onReset={handleReset}
                    onDelete={handleDelete}
                  />
                ))}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PartnerMarketingTab({
  title,
  domain,
  fullscreen,
  onAgentContextChange,
}: {
  title: string;
  domain: DomainConfig;
  fullscreen: boolean;
  onAgentContextChange: Dispatch<SetStateAction<FeatureAgentContext | null>>;
}) {
  const conversation = useCurrentConversation();
  const codexStatus = useChatStore((state) => state.codexStatus);
  const [snapshot, setSnapshot] = useState<MarketingDbSnapshot | null>(null);
  const [view, setView] = useState<MarketingView>('classify');
  const [query, setQuery] = useState('');
  const [selectedKolId, setSelectedKolId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedPrompt, setCopiedPrompt] = useState(false);

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);
    try {
      setSnapshot(await marketingDbQuery(true));
    } catch (err) {
      if (!quiet) setError(stringifyError(err));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const wasStreaming = useRef(false);
  useEffect(() => {
    if (!conversation) return;
    if (conversation.status === 'streaming') {
      wasStreaming.current = true;
      return;
    }
    if (!wasStreaming.current) return;
    wasStreaming.current = false;
    void refresh(true);
  }, [conversation?.status, refresh]);

  const account = snapshot?.accounts[0] ?? null;
  useEffect(() => {
    if (!account?.enabled || account.syncIntervalMinutes <= 0) return;
    const timer = window.setInterval(() => {
      void syncEmails(false);
    }, account.syncIntervalMinutes * 60_000);
    return () => window.clearInterval(timer);
  }, [account?.id, account?.enabled, account?.syncIntervalMinutes]);

  const syncEmails = async (announce = true) => {
    if (!account) {
      setError('请先在设置 > 邮件营销中配置 IMAP 邮箱。');
      return;
    }
    setBusy(true);
    setError(null);
    if (announce) setMessage('正在只读同步邮箱...');
    try {
      const result = await marketingEmailSyncReadonly(account);
      setMessage(`同步完成：${result.synced} 封，新增 ${result.inserted}，其他 ${result.other}，新增 KOL ${result.kolCreated}`);
      setSnapshot(await marketingDbQuery(true));
    } catch (err) {
      setError(stringifyError(err));
    } finally {
      setBusy(false);
    }
  };

  const moveLeadToOther = async (lead: MarketingEmailLead) => {
    setBusy(true);
    setError(null);
    try {
      const next = await marketingAgentApplyUpdate({
        targetTable: 'marketing_email_leads',
        targetId: lead.id,
        field: 'category',
        oldValue: lead.category,
        newValue: 'other',
        reason: '手动归入其他邮件',
      });
      setSnapshot(next);
      setMessage('已归入其他邮件。');
    } catch (err) {
      setError(stringifyError(err));
    } finally {
      setBusy(false);
    }
  };

  const restoreLead = async (lead: MarketingEmailLead) => {
    setBusy(true);
    setError(null);
    try {
      const next = await marketingAgentApplyUpdate({
        targetTable: 'marketing_email_leads',
        targetId: lead.id,
        field: 'hidden',
        oldValue: lead.hidden ? '1' : '0',
        newValue: '0',
        reason: '从其他邮件恢复到收件箱',
      });
      setSnapshot(next);
      setMessage('已恢复到 Step 1 收件箱。');
    } catch (err) {
      setError(stringifyError(err));
    } finally {
      setBusy(false);
    }
  };

  const classifyLead = async (lead: MarketingEmailLead, category: EmailCategory, hidden?: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const next = await marketingLeadClassify({
        id: lead.id,
        category,
        hidden,
        confirmed: true,
        actor: 'user',
        reason: hidden ? 'Step 1：标记为广告并隐藏' : `Step 1：人工确认为${categoryLabel(category)}`,
      });
      setSnapshot(next);
      setMessage(hidden ? '已隐藏该广告邮件。' : `已确认为「${categoryLabel(category)}」。`);
    } catch (err) {
      setError(stringifyError(err));
    } finally {
      setBusy(false);
    }
  };

  const saveEvaluation = async (kol: KolProfile, payload: EvaluationSavePayload, confirmed: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const next = await marketingKolEvaluate({
        id: kol.id,
        criteria: payload.criteria,
        summary: payload.summary,
        recommendation: payload.recommendation,
        confirmed,
        actor: 'user',
        reason: confirmed ? 'Step 2：人工确认评估结论' : 'Step 2：保存评估草稿',
      });
      setSnapshot(next);
      setMessage(confirmed ? '评估结论已确认。' : '评估草稿已保存。');
    } catch (err) {
      setError(stringifyError(err));
    } finally {
      setBusy(false);
    }
  };

  const recordOutreach = async (kol: KolProfile, payload: OutreachSavePayload) => {
    setBusy(true);
    setError(null);
    try {
      const next = await marketingKolOutreach({
        id: kol.id,
        kind: payload.kind,
        scriptId: payload.scriptId,
        channel: payload.channel,
        note: payload.note,
        status: payload.status,
        actor: 'user',
        reason: payload.status === 'skipped' ? 'Step 3：标记暂不联系' : 'Step 3：记录已发送外联',
      });
      setSnapshot(next);
      setMessage(
        payload.status === 'skipped'
          ? '已记录「暂不联系」。'
          : kol.pipelineStage === 'qualified'
            ? '已记录发送提案，已推进到「推进合作」。'
            : '已记录发送外联话术。',
      );
    } catch (err) {
      setError(stringifyError(err));
    } finally {
      setBusy(false);
    }
  };

  const replyToKol = async (kol: KolProfile, payload: ReplySavePayload) => {
    if (!payload.body.trim()) {
      setError('回复内容为空，请先填写话术。');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await marketingKolReply({
        id: kol.id,
        body: payload.body,
        kind: payload.kind,
        scriptId: payload.scriptId,
        channel: payload.channel,
        note: payload.note,
        send: true,
        actor: 'user',
        reason: 'Step 3：一键回复（SMTP 发送）',
      });
      setSnapshot(next);
      setMessage(
        kol.pipelineStage === 'qualified'
          ? `已向 ${kol.name} 发送提案邮件，已推进到「推进合作」。`
          : `已向 ${kol.name} 发送回复邮件。`,
      );
    } catch (err) {
      setError(stringifyError(err));
    } finally {
      setBusy(false);
    }
  };

  const recordIntake = async (kol: KolProfile, payload: IntakeSavePayload) => {
    setBusy(true);
    setError(null);
    try {
      const next = await marketingKolIntake({
        id: kol.id,
        username: payload.username,
        owner: payload.owner,
        channel: payload.channel,
        relationship: payload.relationship,
        phone: payload.phone,
        platforms: payload.platforms,
        links: payload.links,
        contentType: payload.contentType,
        language: payload.language,
        metrics: payload.metrics,
        note: payload.note,
        status: payload.status,
        actor: 'user',
        reason: payload.status === 'draft' ? 'Step 4：保存录入草稿' : 'Step 4：录入系统并推进',
      });
      setSnapshot(next);
      setMessage(payload.status === 'draft' ? '已保存录入草稿。' : '已录入档案，已推进到「推进合作」。');
    } catch (err) {
      setError(stringifyError(err));
    } finally {
      setBusy(false);
    }
  };

  const recordCollab = async (kol: KolProfile, payload: CollabSavePayload) => {
    if (payload.send && !payload.body?.trim()) {
      setError('合同邮件正文为空，请先填写。');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await marketingKolCollaborate({
        id: kol.id,
        status: payload.status,
        scriptId: payload.scriptId,
        contractUrl: payload.contractUrl,
        videoCount: payload.videoCount,
        note: payload.note,
        body: payload.body,
        send: payload.send,
        actor: 'user',
        reason: payload.send ? 'Step 5：发送合同（SMTP）' : `Step 5：记录${collabStatusLabel(payload.status)}`,
      });
      setSnapshot(next);
      setMessage(
        payload.status === 'signed'
          ? `已记录 ${kol.name} 签约，已推进到「发货流程」。`
          : payload.status === 'declined'
            ? `已记录 ${kol.name} 流失。`
            : payload.send
              ? `已向 ${kol.name} 发送合同邮件。`
              : '已记录发出合同。',
      );
    } catch (err) {
      setError(stringifyError(err));
    } finally {
      setBusy(false);
    }
  };

  const recordShip = async (kol: KolProfile, payload: ShipSavePayload) => {
    if (payload.send && !payload.body?.trim()) {
      setError('发货通知正文为空，请先填写。');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await marketingKolShip({
        id: kol.id,
        status: payload.status,
        carrier: payload.carrier,
        tracking: payload.tracking,
        trackingUrl: payload.trackingUrl,
        address: payload.address,
        units: payload.units,
        expectedPostAt: payload.expectedPostAt,
        note: payload.note,
        body: payload.body,
        send: payload.send,
        actor: 'user',
        reason: payload.send ? 'Step 6：发送发货通知（SMTP）' : `Step 6：记录${shipmentStatusLabel(payload.status)}`,
      });
      setSnapshot(next);
      setMessage(
        payload.status === 'delivered'
          ? `已标记 ${kol.name} 合作完成。`
          : payload.status === 'issue'
            ? `已记录 ${kol.name} 物流异常。`
            : payload.send
              ? `已向 ${kol.name} 发送发货通知。`
              : '已记录发货。',
      );
    } catch (err) {
      setError(stringifyError(err));
    } finally {
      setBusy(false);
    }
  };

  const setAutoConfirm = async (next: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const snap = await marketingSettingsSet({ agentAutoConfirm: next });
      setSnapshot(snap);
      setMessage(next ? '已开启 Agent 自动确认：评估将直接定稿，无需人工确认。' : '已关闭 Agent 自动确认：评估保存为草稿，需人工确认。');
    } catch (err) {
      setError(stringifyError(err));
    } finally {
      setBusy(false);
    }
  };

  const setAutoReply = async (next: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const snap = await marketingSettingsSet({ agentAutoReply: next });
      setSnapshot(snap);
      setMessage(next ? '已开启 Agent 自主回复：Agent 可直接发送回复邮件，无需人工确认。' : '已关闭 Agent 自主回复：Agent 仅起草草稿，由人工确认后发送。');
    } catch (err) {
      setError(stringifyError(err));
    } finally {
      setBusy(false);
    }
  };

  const updateKol = async (kol: KolProfile, patch: KolProfilePatch) => {
    setBusy(true);
    setError(null);
    try {
      const next = await marketingDbUpdateKol(kol.id, patch, '工作区更新 KOL 档案');
      setSnapshot(next);
      setMessage('KOL 档案已更新。');
    } catch (err) {
      setError(stringifyError(err));
    } finally {
      setBusy(false);
    }
  };

  const copyClassifyPrompt = async () => {
    const prompt = [
      '请用 $sidebar-control 技能完成右侧合作推广营销 Step 1 初步分类。',
      '步骤：先 alpha-sidebar marketing leads list --hidden false 查看未隐藏线索，逐条判断类别（达人 influencer / 联盟 affiliate / 其他 other）。',
      '对每条执行：alpha-sidebar marketing leads classify --id <leadId> --category <influencer|affiliate|other> [--hide true] --reason "Step 1 初步分类"。广告类邮件加 --hide true 隐藏。',
      '只有内容明确支持达人身份时才归为 influencer（会自动创建/关联 KOL 档案）。完成后给我分类汇总。',
    ].join('\n');
    if (await copyToClipboard(prompt)) {
      setCopiedPrompt(true);
      window.setTimeout(() => setCopiedPrompt(false), 1600);
    }
  };

  const openKolInEvaluate = (id: string) => {
    setSelectedKolId(id);
    setView('evaluate');
  };
  const openKolInProcess = (id: string) => {
    setSelectedKolId(id);
    setView('process');
  };
  const openKolInDatabase = (id: string) => {
    setSelectedKolId(id);
    setView('kol');
  };

  const normalizedQuery = query.trim().toLowerCase();
  const matchLead = (lead: MarketingEmailLead) =>
    !normalizedQuery ||
    [lead.subject, lead.rawFrom, lead.fromEmail, lead.snippet, categoryLabel(lead.category)].some((value) =>
      value.toLowerCase().includes(normalizedQuery),
    );
  const matchKol = (kol: KolProfile) =>
    !normalizedQuery ||
    [kol.name, kol.email, kol.country ?? '', kol.owner ?? '', kol.tags, kol.collaborationStatus, kol.stage].some((value) =>
      value.toLowerCase().includes(normalizedQuery),
    );

  const allLeads = snapshot?.leads ?? [];
  const allKols = snapshot?.kolProfiles ?? [];
  const classifyLeads = allLeads.filter((lead) => !lead.hidden && matchLead(lead));
  const otherLeads = allLeads.filter((lead) => (lead.hidden || !isPrimaryEmailCategory(lead.category)) && matchLead(lead));
  const kols = allKols.filter(matchKol);
  const evaluateKols = allKols.filter((kol) => !kol.archived && matchKol(kol));
  const processKols = allKols.filter((kol) => !kol.archived && matchKol(kol) && kolProcessBucket(kol) !== 'none');
  const intakeKols = allKols.filter((kol) => !kol.archived && matchKol(kol) && kolIntakeBucket(kol) !== 'none');
  const collabKols = allKols.filter((kol) => !kol.archived && matchKol(kol) && kolCollabBucket(kol) !== 'none');
  const shipKols = allKols.filter((kol) => !kol.archived && matchKol(kol) && kolShipBucket(kol) !== 'none');
  const selectedKol = selectedKolId ? allKols.find((kol) => kol.id === selectedKolId) ?? null : null;

  const classifyPending = allLeads.filter((lead) => !lead.hidden && !lead.humanConfirmed).length;
  const evaluatePending = allKols.filter((kol) => !kol.archived && kol.pipelineStage === 'evaluate').length;
  const processPending = allKols.filter((kol) => !kol.archived && kolProcessBucket(kol) === 'todo').length;
  const intakePending = allKols.filter((kol) => !kol.archived && kolIntakeBucket(kol) === 'todo').length;
  const collabPending = allKols.filter((kol) => !kol.archived && kolCollabBucket(kol) === 'todo').length;
  const shipPending = allKols.filter((kol) => !kol.archived && kolShipBucket(kol) === 'todo').length;
  const autoConfirm = snapshot?.settings?.agentAutoConfirm ?? false;
  const autoReply = snapshot?.settings?.agentAutoReply ?? false;
  const activeLeads = allLeads.filter((lead) => !lead.hidden && isPrimaryEmailCategory(lead.category)).length;
  const otherEmails = allLeads.filter((lead) => lead.hidden || !isPrimaryEmailCategory(lead.category)).length;

  const previewRuntime = !isTauriRuntime();
  const codexReady = previewRuntime || Boolean(codexStatus?.installed && codexStatus.loggedIn);
  const agentContext = useMemo(
    () => buildPartnerMarketingAgentContext({
      title,
      dbPath: snapshot?.path,
      view,
      query,
      accountLabel: account?.label,
      activeLeads,
      otherEmails,
      classifyPending,
      evaluatePending,
      processPending,
      intakePending,
      collabPending,
      shipPending,
      autoReply,
      kolCount: allKols.length,
      selectedKol,
    }),
    [account?.label, activeLeads, otherEmails, classifyPending, evaluatePending, processPending, intakePending, collabPending, shipPending, autoReply, query, selectedKol, allKols.length, snapshot?.path, title, view],
  );
  useEffect(() => {
    onAgentContextChange({
      id: 'partner-marketing',
      kind: 'partner-marketing',
      title,
      body: agentContext,
    });
    return () => onAgentContextChange(null);
  }, [agentContext, onAgentContextChange, title]);

  const auxTabs: Array<[MarketingView, string, number]> = [
    ['kol', 'KOL 库', allKols.length],
    ['other', '其他邮件', otherEmails],
    ['scripts', '话术库', SCRIPT_LIBRARY.length],
    ['logs', '自动化日志', snapshot?.auditLogs.length ?? 0],
  ];

  return (
    <section className={`feature-tab-content partner-marketing-panel ${fullscreen ? 'with-agent-dock' : ''}`} role="tabpanel" aria-label={title}>
      <div className="partner-marketing-content">
        <div className="partner-marketing-head">
          <span className="partner-marketing-icon"><Target size={20} /></span>
          <div>
            <h2>{title}</h2>
            <p>{account ? `${account.label} · ${account.mailbox} · ${formatMaybeDate(account.lastSyncedAt)}` : '本地 KOL Database · 邮件只读同步 · AI + 人工确认'}</p>
          </div>
          <span className="spacer" />
          <button className="settings-btn" type="button" onClick={() => void refresh()} disabled={loading || busy}><RefreshCw size={13} />刷新</button>
          <button className="settings-btn primary" type="button" onClick={() => void syncEmails()} disabled={busy || !account}><Mail size={13} />同步邮件</button>
        </div>

        <WorkflowRail view={view} counts={{ classify: classifyPending, evaluate: evaluatePending, process: processPending, intake: intakePending, collab: collabPending, ship: shipPending }} onSelect={setView} />

        <div className="marketing-toolbar">
          <div className="marketing-tabs" role="tablist">
            {auxTabs.map(([id, label, count]) => (
              <button key={id} type="button" className={view === id ? 'active' : ''} onClick={() => setView(id)}>
                <span>{label}</span><em>{count}</em>
              </button>
            ))}
          </div>
          <label className="marketing-search">
            <Search size={14} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索邮件、KOL、话术、状态或标签" />
          </label>
        </div>

        {(message || error) && (
          <div className={`marketing-status ${error ? 'error' : ''}`}>
            <Info size={14} />
            <span>{error || message}</span>
          </div>
        )}

        {loading ? (
          <div className="partner-marketing-placeholder"><Loader2 size={18} className="spin" /><span>正在读取本地营销库...</span></div>
        ) : view === 'classify' ? (
          <ClassifyWorkbench
            leads={classifyLeads}
            kols={allKols}
            busy={busy}
            evaluatePending={evaluatePending}
            onClassify={(lead, category, hidden) => void classifyLead(lead, category, hidden)}
            onOpenKol={openKolInEvaluate}
            onCopyAgentPrompt={() => void copyClassifyPrompt()}
            onGoEvaluate={() => setView('evaluate')}
            copiedPrompt={copiedPrompt}
          />
        ) : view === 'evaluate' ? (
          <EvaluateWorkbench
            kols={evaluateKols}
            selectedId={selectedKolId}
            busy={busy}
            autoConfirm={autoConfirm}
            onToggleAutoConfirm={(next) => void setAutoConfirm(next)}
            onSelect={setSelectedKolId}
            onSave={(kol, payload, confirmed) => void saveEvaluation(kol, payload, confirmed)}
            onOpenKol={openKolInDatabase}
          />
        ) : view === 'process' ? (
          <ProcessWorkbench
            kols={processKols}
            selectedId={selectedKolId}
            busy={busy}
            autoReply={autoReply}
            onToggleAutoReply={(next) => void setAutoReply(next)}
            onSelect={setSelectedKolId}
            onRecord={(kol, payload) => void recordOutreach(kol, payload)}
            onReply={(kol, payload) => void replyToKol(kol, payload)}
            onOpenKol={openKolInDatabase}
          />
        ) : view === 'intake' ? (
          <IntakeWorkbench
            kols={intakeKols}
            selectedId={selectedKolId}
            busy={busy}
            onSelect={setSelectedKolId}
            onSave={(kol, payload) => void recordIntake(kol, payload)}
            onOpenKol={openKolInDatabase}
          />
        ) : view === 'collab' ? (
          <CollabWorkbench
            kols={collabKols}
            selectedId={selectedKolId}
            busy={busy}
            autoReply={autoReply}
            onSelect={setSelectedKolId}
            onSave={(kol, payload) => void recordCollab(kol, payload)}
            onOpenKol={openKolInDatabase}
          />
        ) : view === 'ship' ? (
          <ShipWorkbench
            kols={shipKols}
            selectedId={selectedKolId}
            busy={busy}
            onSelect={setSelectedKolId}
            onSave={(kol, payload) => void recordShip(kol, payload)}
            onOpenKol={openKolInDatabase}
          />
        ) : view === 'kol' ? (
          <div className="marketing-split">
            <div className="marketing-table-wrap">
              <KolTable kols={kols} selectedId={selectedKolId} onSelect={setSelectedKolId} />
            </div>
            <KolDetailPanel kol={selectedKol ?? kols[0] ?? null} busy={busy} onSave={updateKol} />
          </div>
        ) : view === 'scripts' ? (
          <ScriptLibrary query={query} />
        ) : view === 'logs' ? (
          <AutomationLogList logs={snapshot?.auditLogs ?? []} />
        ) : (
          <OtherMailView
            leads={otherLeads}
            kols={allKols}
            busy={busy}
            onMoveToOther={(lead) => void moveLeadToOther(lead)}
            onRestore={(lead) => void restoreLead(lead)}
            onOpenKol={openKolInEvaluate}
          />
        )}
      </div>
      {fullscreen && conversation && (
        <FeatureAgentDock
          domain={domain}
          conversation={conversation}
          disabled={!codexReady}
          agentContext={agentContext}
          agentContextResolver={() => resolveFeatureAgentContext({
            id: 'partner-marketing',
            kind: 'partner-marketing',
            title,
            body: agentContext,
          })}
        />
      )}
    </section>
  );
}

function FeatureAgentDock({
  domain,
  conversation,
  disabled,
  agentContext,
  agentContextResolver,
}: {
  domain: DomainConfig;
  conversation: Conversation;
  disabled: boolean;
  agentContext: string;
  agentContextResolver?: AgentContextResolver;
}) {
  return (
    <div className="features-agent-dock">
      <Composer
        domain={domain}
        conversation={conversation}
        disabled={disabled}
        bottom
        className="feature-agent-composer"
        agentContext={agentContext}
        agentContextResolver={agentContextResolver}
        placeholder="让 agent 分析邮件线索、整理 KOL、归类其他邮件或更新合作状态"
      />
    </div>
  );
}

async function resolveComposerAgentContext(agentContext?: string, resolver?: AgentContextResolver): Promise<ResolvedAgentContext | undefined> {
  const fallback = agentContext?.trim() || undefined;
  if (!resolver) return fallback ? { context: fallback } : undefined;
  try {
    const resolved = await resolver();
    if (resolved?.context.trim()) return { ...resolved, context: resolved.context.trim() };
    return fallback ? { context: fallback } : undefined;
  } catch (error) {
    const message = stringifyError(error);
    const context = [
      fallback,
      '',
      `注意：发送前实时读取侧栏上下文失败：${message}。请优先使用上方已提供的侧栏上下文；如需准确数据，请查询侧栏对应的本地数据库。`,
    ].filter(Boolean).join('\n');
    return context ? {
      context,
      trace: {
        title: 'tool: $sidebar-control',
        input: '预取右侧栏上下文；等价 CLI：alpha-sidebar marketing snapshot',
        output: `读取侧栏上下文失败：${message}`,
        status: 'failed',
      },
    } : undefined;
  }
}

async function resolveFeatureAgentContext(context: FeatureAgentContext): Promise<ResolvedAgentContext> {
  if (context.kind !== 'partner-marketing') {
    return {
      context: context.body,
      trace: {
        title: 'tool: $sidebar-control',
        input: '加载右侧功能入口上下文',
        output: '已启用 $sidebar-control。当前位于右侧功能入口，等待具体功能页或侧栏任务。',
        status: 'completed',
      },
    };
  }
  const snapshot = await marketingDbQuery(true);
  const liveContext = buildPartnerMarketingLiveSnapshotContext(snapshot);
  return {
    context: [
    context.body,
    '',
    liveContext,
    ].join('\n'),
    trace: buildPartnerMarketingTrace(snapshot),
  };
}

function buildFeatureHubAgentContext(): string {
  return [
    '你正在响应 Alpha Studio 右侧功能栏相关请求。',
    '必须使用 $sidebar-control 技能规则处理右侧栏请求。技能路径：~/.codex/skills/sidebar-control/SKILL.md；正式 CLI：/Users/geb/codes/alpha_studio/src-tauri/target/debug/alpha-sidebar；缺失时用 cargo run --manifest-path /Users/geb/codes/alpha_studio/src-tauri/Cargo.toml --quiet --bin alpha-sidebar -- <args>。',
    '当前还停留在功能入口列表；如果用户要求合作推广营销、邮件线索、KOL Database、其他邮件或自动化日志相关操作，请把它视为「合作推广营销」功能页任务。',
    '语义路由：在带入侧栏上下文开启时，用户说“线索”“多少线索”“客户线索”默认指右侧「合作推广营销」里的 marketing_email_leads 邮件线索，不是当前品牌目录中的文件。',
    '除非用户明确要求检查品牌目录、代码或本地文件，否则不要用 find/grep/rg 去 cwd 里搜索“线索”。',
    '优先帮助用户完成操作，而不是只解释界面。需要数据库操作时，使用本地营销 SQLite 数据库；如果路径未在当前上下文出现，可先从应用源码或默认数据目录定位 ~/.alpha-studio/marketing.sqlite。',
    '侧栏人工操作映射：打开文件夹=定位当前品牌目录；打开终端=在当前品牌目录运行命令；浏览器=打开用户指定 URL；审查改动=发起只读代码审查；合作推广营销=读取/更新本地营销库。',
    '不要读取、输出或要求展示邮箱密码、Keychain 密钥或其它秘密。',
  ].join('\n');
}

function buildPartnerMarketingAgentContext({
  title,
  dbPath,
  view,
  query,
  accountLabel,
  activeLeads,
  otherEmails,
  classifyPending,
  evaluatePending,
  processPending,
  intakePending,
  collabPending,
  shipPending,
  autoReply,
  kolCount,
  selectedKol,
}: {
  title: string;
  dbPath?: string;
  view: MarketingView;
  query: string;
  accountLabel?: string;
  activeLeads: number;
  otherEmails: number;
  classifyPending: number;
  evaluatePending: number;
  processPending: number;
  intakePending: number;
  collabPending: number;
  shipPending: number;
  autoReply: boolean;
  kolCount: number;
  selectedKol: KolProfile | null;
}): string {
  const selectedKolLine = selectedKol
    ? `当前选中的 KOL：${selectedKol.name} <${selectedKol.email}>，id=${selectedKol.id}，关系=${selectedKol.relationship}，状态=${selectedKol.collaborationStatus}，阶段=${selectedKol.stage}，流程阶段=${selectedKol.pipelineStage}，负责人=${selectedKol.owner || '未分配'}，优先级=${selectedKol.priority}，标签=${selectedKol.tags || '无'}。`
    : '当前未显式选中 KOL；如果用户提到某个达人，请先在数据库中查找匹配记录。';
  return [
    '你正在响应 Alpha Studio 右侧「合作推广营销」功能页相关请求。',
    '必须使用 $sidebar-control 技能规则处理本请求。技能路径：~/.codex/skills/sidebar-control/SKILL.md；正式 CLI：/Users/geb/codes/alpha_studio/src-tauri/target/debug/alpha-sidebar；缺失时用 cargo run --manifest-path /Users/geb/codes/alpha_studio/src-tauri/Cargo.toml --quiet --bin alpha-sidebar -- <args>。',
    '用户希望通过这次对话完成当前面板里的营销操作，而不仅是解释页面。',
    '',
    '面板工作流（与界面 6 步一致，Step 1-6 均已开放）：',
    '- Step 1 初步分类：把每封未隐藏邮件确认为 达人 influencer / 联盟 affiliate / 其他 other；广告类邮件隐藏（hidden=1）。确认达人后会自动创建/关联 KOL 档案，并把其流程阶段(pipeline_stage)置为 evaluate。',
    '- Step 2 网红评估：对 pipeline_stage=evaluate 的达人按 6 项指标评估。硬性指标 vertical、language 必须全部通过；软性指标 followers、views、engagement、recency 至少 2 项通过才算评估通过。通过→qualified，不通过→rejected。',
    '- Step 3 评估后处理：对已确认评估的达人（pipeline_stage=qualified/rejected 且尚无 outreach 记录）执行外联——通过的基于话术库「合作提案」起草并发送提案，不通过的基于「拒绝 + 折扣」婉拒。话术中的链接/联系方式来自话术库变量，不要编造。',
    `- Step 3 发送方式：「一键回复」会经 SMTP 真实发出邮件并记录（kols reply）。当前「Agent 自主回复」开关：${autoReply ? '已开启——你可以在确认正文后直接用 kols reply 发送' : '已关闭——你只起草草稿给人工审阅，不要发送；由人工在面板点「一键回复」或显式批准后再发'}。仅记录（不发送、或在其它渠道已发）用 kols outreach。通过→onboarding 推进合作，不通过保持 rejected。`,
    '- Step 4 录入系统：对已发提案（pipeline_stage=onboarding）的达人，待其回复意向后补全档案（用户名、跟进人、沟通渠道、建联关系、联系方式、全网粉丝、账号链接、内容类型、语言、内容数据、备注），用 kols intake 录入。完成（status=done）→ pipeline_stage=intake。',
    '- Step 5 合作推进：对 pipeline_stage=intake 的达人，按对方回复选话术（同意签约→发合同；异议→对应异议话术），先复制合同模板改名（网红用户名-姓名）再填链接。用 kols collaborate 记录；--send true 可经 SMTP 真实发合同邮件（受「Agent 自主回复」开关约束，同 reply）。对方签字回传后 --status signed → pipeline_stage=signed；流失用 --status declined。',
    '- Step 6 发货流程：对 pipeline_stage=signed 的达人，先核对合同（最晚发布日期、视频数量、单元/配件、电子签名、附加条款），安排发货后回传物流，用 kols ship 记录；--send true 可经 SMTP 真实发发货通知。--status shipped → pipeline_stage=shipped；内容发布/合作完成后 --status delivered → completed。',
    `- Step 4-6 的真实发信同样受「Agent 自主回复」开关约束（当前：${autoReply ? '开启，可直接发送' : '关闭，仅起草草稿，勿发送'}）；只记录不发送时用 --send false（默认）。`,
    '',
    '语义路由：用户说“线索”“多少线索”“现在有多少线索”“客户线索”时，默认指当前侧栏的邮件线索数量，也就是 marketing_email_leads 中非隐藏且分类为达人或联盟的记录数。',
    '语义路由：用户说“分类/标签/初步分类/这封是达人还是联盟/隐藏广告”时，指 Step 1，用 leads classify。',
    '语义路由：用户说“评估/评估一下这个网红/能不能合作/达标吗”时，指 Step 2，用 kols evaluate。',
    '语义路由：用户说“发提案/发拒绝/起草外联/给通过的网红发邮件/一键回复/处理评估结果”时，指 Step 3：要真实发邮件用 kols reply（经 SMTP，受「Agent 自主回复」开关约束），仅记录已在外部发送用 kols outreach；话术取自话术库。',
    '语义路由：用户说“录入/完善档案/填资料/录入系统/补全联系方式”时，指 Step 4，用 kols intake。',
    '语义路由：用户说“发合同/签约/推进合作/处理异议/视频数量异议”时，指 Step 5，用 kols collaborate。',
    '语义路由：用户说“发货/物流/运单号/发货通知/已签收/内容发布”时，指 Step 6，用 kols ship。',
    '语义路由：用户说“Google 改为已合作”“把某人状态改成…”时，默认指 kol_profiles 里的 KOL 档案字段更新，不是项目文件修改。',
    '除非用户明确要求检查品牌目录、代码或本地文件，否则不要用 find/grep/rg 去 cwd 里搜索“线索”、KOL 名称或合作状态；应直接使用下方实时快照，或通过 alpha-sidebar CLI 查询/更新 SQLite 营销库。',
    '',
    `当前功能页：${title}`,
    `当前视图：${view}；搜索词：${query.trim() || '无'}；邮箱账号：${accountLabel || '未配置或未载入'}`,
    `当前统计：邮件线索 ${activeLeads}，KOL ${kolCount}，其他邮件 ${otherEmails}；待分类(未人工确认) ${classifyPending}，待评估 ${evaluatePending}，待处理(评估后外联) ${processPending}，待录入 ${intakePending}，待推进 ${collabPending}，待发货 ${shipPending}。`,
    selectedKolLine,
    '',
    '本地营销数据库：',
    `- SQLite 路径：${dbPath || '~/.alpha-studio/marketing.sqlite'}`,
    '- 主要表：marketing_email_leads、kol_profiles、kol_platform_accounts、kol_collaborations、kol_posts、automation_audit_logs。',
    '- marketing_email_leads 新增字段 human_confirmed（0/1，是否人工/确认分类）；kol_profiles 新增 pipeline_stage（classify/evaluate/qualified/rejected/onboarding/intake/signed/shipped/completed）、evaluation（评估 JSON）、outreach（Step 3 外联 JSON）、intake（Step 4 录入 JSON）、collaboration（Step 5 合作 JSON：status sent/signed/declined、scriptId、contractUrl、videoCount、note）、shipment（Step 6 发货 JSON：status shipped/delivered/issue、carrier、tracking、trackingUrl、address、units、expectedPostAt、note）。',
    '',
    '侧栏开放接口和等价操作：',
    '- 推荐给 agent 的确定性入口：alpha-sidebar marketing snapshot；accounts list|get；email test|sync；leads count|get|list|classify|confirm|update；kols get|list|find|evaluate|update；logs list。',
    '- Step 1 分类：alpha-sidebar marketing leads classify --id <leadId> --category <influencer|affiliate|other> [--hide true|false] [--confirm true|false] --reason "..."。广告邮件加 --hide true。仅确认现有分类用 leads confirm --id <leadId>。',
    '- Step 2 评估：alpha-sidebar marketing kols evaluate --id <kolId> --criteria \'[{"key":"vertical","status":"pass","detail":"露营场景"},...]\' --summary "结论" [--recommendation proposal|reject|hold] [--confirm true|false] --reason "..."。criteria 的 key 仅限 vertical/language/followers/views/engagement/recency，status 仅限 pass/fail/unknown。CLI 会按硬性+软性规则自动判定 verdict 与流程阶段。',
    '- Step 2 批量评估：先 marketing kols list 取 pipeline_stage=evaluate 的全部 KOL，再对每个逐一 kols evaluate（默认 --confirm false 存草稿），最后按通过/不通过/待定分组汇总，交人工确认。',
    '- Step 3 真实回复：alpha-sidebar marketing kols reply --id <kolId> --body "<最终正文>" [--subject "..."] [--kind proposal|reject] [--script-id <模板id>] [--channel Email] [--send true|false] --reason "..."。会经 SMTP（复用 Keychain 里的 Gmail 应用专用密码、Re:+In-Reply-To 串到原邮件）真实发出并记录外联。--send 默认跟随 agent_auto_reply 开关；开关关闭时不要发送，先把草稿给人工。',
    '- Step 3 仅记录：alpha-sidebar marketing kols outreach --id <kolId> [--kind proposal|reject|koc|paid] [--script-id <模板id>] [--channel <Email|IG DM|WhatsApp>] [--note "..."] [--skip] --reason "..."。用于在其它渠道已发送、或人工已手动发出后补记（不发邮件）。通过→onboarding，不通过保持 rejected，--skip 记录暂不联系。',
    '- Step 3 开关：alpha-sidebar marketing settings set --agent-auto-reply true|false（控制 kols reply / kols collaborate / kols ship 的真实发送默认）。',
    '- 前端 Step 3：marketingKolReply({ id, body, subject?, kind, scriptId?, channel?, note?, send?, actor, reason }) 真实发送；marketingKolOutreach({ id, kind, scriptId?, channel?, note?, status?, actor, reason }) 仅记录。',
    '- Step 4 录入：alpha-sidebar marketing kols intake --id <kolId> [--username ...] [--owner ...] [--channel Email|SMS|DM] [--relationship inbound|outbound] [--phone ...] [--platforms ...] [--links ...] [--content-type ...] [--language ...] [--metrics ...] [--note ...] [--status done|draft] --reason "..."。status=done（默认）会把 onboarding 推进到 intake，并把 owner/relationship 同步写入档案列。',
    '- Step 5 推进：alpha-sidebar marketing kols collaborate --id <kolId> [--status sent|signed|declined] [--script-id ID] [--contract-url URL] [--video-count N] [--note ...] [--send true --body "<合同邮件正文>" [--subject ...] [--to ...]] --reason "..."。--send true 才会经 SMTP 发信（受 agent_auto_reply 约束）；signed→pipeline_stage=signed。',
    '- Step 6 发货：alpha-sidebar marketing kols ship --id <kolId> [--status shipped|delivered|issue] [--carrier ...] [--tracking ...] [--tracking-url URL] [--address ...] [--units ...] [--expected-post-at MS] [--note ...] [--send true --body "<发货通知正文>"] --reason "..."。shipped→pipeline_stage=shipped，delivered→completed。',
    '- 前端 Step 4-6：marketingKolIntake / marketingKolCollaborate / marketingKolShip（参数同上，camelCase；collaborate/ship 传 send=true 才真实发信）。',
    '- 仅调整流程阶段：alpha-sidebar marketing kols update --id <kolId> --field pipeline_stage --value <classify|evaluate|qualified|rejected|onboarding|intake|signed|shipped|completed> --reason "..."。',
    '- 前端读取快照：marketingDbQuery(true) / Tauri command marketing_db_query；agent 等价操作是查询上述 SQLite 表。',
    '- 前端 Step 1：marketingLeadClassify({ id, category, hidden?, confirmed, actor, reason })。',
    '- 前端 Step 2：marketingKolEvaluate({ id, criteria, summary, recommendation?, confirmed, actor, reason })。',
    '- 前端保存 KOL 档案：marketingDbUpdateKol(id, patch, reason)；agent 写入时使用同一字段白名单。',
    '- 邮件同步=alpha-sidebar marketing email sync [--account-id ID|--all]，内部复用只读 IMAP 同步并从 Keychain 读取密码；agent 不应读取、输出或请求秘密。',
    '',
    '可写字段白名单：',
    '- marketing_email_leads：hidden、category、human_confirmed。',
    '- kol_profiles：name、email、country、relationship、collaboration_status、stage、pipeline_stage、owner、priority、tags、archived、brand_fit_score、risk_note、next_follow_up_at、agent_notes、human_notes、evaluation、outreach、intake、collaboration、shipment。',
    '- 写入时必须先读取当前值，更新目标行 updated_at，并向 automation_audit_logs 写入 actor、target_table、target_id、field、old_value、new_value、reason、created_at。优先使用上面的 classify/evaluate 高层命令，它们会自动写审计与联动字段。',
    '- hidden/archived/human_confirmed 使用 0/1；priority 使用 high/normal/low；category 使用 influencer/affiliate/other。',
    '- 只有邮件内容明确支持达人身份或内容合作时，才把邮件设为 influencer 并创建/关联 KOL；相关 KOL 信息必须来自邮件主题、发件人和正文摘要。',
    '',
    '操作原则：',
    '- 需要分析时先查询数据库，再给结论和下一步。',
    '- Step 1/2 属于“AI 出建议、人工确认”：agent 可以直接写入分类/评估结果（actor=agent，confirmed 由人工最终在面板确认），但要在回复里清楚说明改了哪些记录、依据是什么，方便人工核对。',
    '- 不要读取、输出或要求展示邮箱密码、Keychain 密钥或其它秘密。',
    '- 邮箱同步优先通过 CLI 触发；仅当 CLI 返回 secret_unavailable 或 external_error 时，说明需要先在设置中保存密码或处理邮箱连接问题。',
    '- 完成数据库修改后，面板会在回合结束时自动刷新。',
  ].join('\n');
}

function buildPartnerMarketingLiveSnapshotContext(snapshot: MarketingDbSnapshot): string {
  const visibleLeads = snapshot.leads.filter((lead) => !lead.hidden);
  const panelLeads = visibleLeads.filter((lead) => isPrimaryEmailCategory(lead.category));
  const hiddenLeads = snapshot.leads.filter((lead) => lead.hidden);
  const visibleOther = visibleLeads.filter((lead) => !isPrimaryEmailCategory(lead.category));
  const categoryCounts = (['influencer', 'affiliate', 'other'] as const)
    .map((category) => {
      const count = visibleLeads.filter((lead) => lead.category === category).length;
      return `${categoryLabel(category)} ${count}`;
    })
    .join('，');
  const latestLeads = panelLeads.slice(0, 5).map((lead) => (
    `- id=${lead.id}；${categoryLabel(lead.category)}；${lead.subject}；${lead.rawFrom}；${formatMaybeDate(lead.receivedAt)}`
  ));
  return [
    '发送瞬间实时侧栏快照：',
    `- 当前侧栏「邮件线索」数量：${panelLeads.length}。这是用户问“现在有多少线索”时应直接回答的数字。`,
    `- 全部邮件记录：${snapshot.leads.length}；非隐藏记录：${visibleLeads.length}；隐藏记录：${hiddenLeads.length}；其他邮件：${visibleOther.length}；KOL Database：${snapshot.kolProfiles.length}。`,
    `- 非隐藏分类统计：${categoryCounts}。`,
    `- 数据库路径：${snapshot.path || '~/.alpha-studio/marketing.sqlite'}。`,
    '最近邮件线索样例：',
    ...(latestLeads.length ? latestLeads : ['- 无']),
    '',
    '回答规则：',
    '- 如果用户只问数量，直接用“当前侧栏邮件线索数量”回答，不需要再检索品牌目录。',
    '- 如果用户要求进一步分析、筛选或修改，使用 alpha-sidebar CLI 查询 SQLite 营销库或执行白名单更新。',
    '- 如果 KOL 名称匹配多条记录，列出候选 id/name/email/status 并询问用户选哪条；只有用户明确说“全部”才批量更新。',
  ].join('\n');
}

function buildPartnerMarketingTrace(snapshot: MarketingDbSnapshot): AgentContextTrace {
  const visibleLeads = snapshot.leads.filter((lead) => !lead.hidden);
  const panelLeads = visibleLeads.filter((lead) => isPrimaryEmailCategory(lead.category));
  const hiddenLeads = snapshot.leads.filter((lead) => lead.hidden);
  const otherEmails = snapshot.leads.filter((lead) => lead.hidden || !isPrimaryEmailCategory(lead.category)).length;
  const kolCount = snapshot.kolProfiles.length;
  const output = [
    '使用 $sidebar-control 读取右侧「合作推广营销」实时快照。',
    '',
    JSON.stringify({
      emailLeads: panelLeads.length,
      allEmailRecords: snapshot.leads.length,
      hidden: hiddenLeads.length,
      otherEmails,
      kolProfiles: kolCount,
      dbPath: snapshot.path || '~/.alpha-studio/marketing.sqlite',
    }, null, 2),
  ].join('\n');
  return {
    title: 'tool: $sidebar-control',
    input: '预取右侧「合作推广营销」实时快照；等价 CLI：alpha-sidebar marketing snapshot',
    output,
    status: 'completed',
  };
}

function OtherMailView({
  leads,
  kols,
  busy,
  onMoveToOther,
  onRestore,
  onOpenKol,
}: {
  leads: MarketingEmailLead[];
  kols: KolProfile[];
  busy: boolean;
  onMoveToOther: (lead: MarketingEmailLead) => void;
  onRestore: (lead: MarketingEmailLead) => void;
  onOpenKol: (id: string) => void;
}) {
  const [filter, setFilter] = useState<'all' | 'hidden' | 'other'>('all');
  const hiddenCount = leads.filter((lead) => lead.hidden).length;
  const otherCount = leads.length - hiddenCount;
  const visible = leads.filter((lead) =>
    filter === 'all' ? true : filter === 'hidden' ? lead.hidden : !lead.hidden,
  );
  return (
    <div className="marketing-step">
      <div className="marketing-step-head">
        <div className="marketing-step-intro">
          <span className="marketing-step-tag"><EyeOff size={13} />其他 / 已隐藏邮件</span>
          <p>广告及非达人/联盟邮件会归到这里。<b>隐藏的广告邮件</b>也可在此查看，并随时「恢复」回 Step 1 收件箱。</p>
        </div>
        <div className="marketing-step-actions">
          <div className="marketing-segment">
            <button type="button" className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>全部 {leads.length}</button>
            <button type="button" className={filter === 'hidden' ? 'active' : ''} onClick={() => setFilter('hidden')}>已隐藏广告 {hiddenCount}</button>
            <button type="button" className={filter === 'other' ? 'active' : ''} onClick={() => setFilter('other')}>其他类别 {otherCount}</button>
          </div>
        </div>
      </div>
      {visible.length === 0 ? (
        <MarketingEmptyState
          icon={<EyeOff size={26} />}
          title={filter === 'hidden' ? '没有已隐藏的广告邮件' : '暂无其他邮件'}
          description={filter === 'hidden' ? '被隐藏的广告邮件会出现在这里，可随时恢复。' : '广告或非达人/联盟邮件会归类到这里。'}
        />
      ) : (
        <EmailLeadList
          leads={visible}
          kols={kols}
          otherView
          busy={busy}
          onMoveToOther={onMoveToOther}
          onRestore={onRestore}
          onOpenKol={onOpenKol}
        />
      )}
    </div>
  );
}

function EmailLeadList({
  leads,
  kols,
  otherView,
  busy,
  onMoveToOther,
  onRestore,
  onOpenKol,
}: {
  leads: MarketingEmailLead[];
  kols: KolProfile[];
  otherView: boolean;
  busy: boolean;
  onMoveToOther: (lead: MarketingEmailLead) => void;
  onRestore?: (lead: MarketingEmailLead) => void;
  onOpenKol: (id: string) => void;
}) {
  if (leads.length === 0) {
    return <div className="partner-marketing-placeholder"><Mail size={18} /><span>{otherView ? '暂无其他邮件。' : '暂无达人或联盟邮件线索，请先在设置中配置邮箱并同步。'}</span></div>;
  }
  const kolById = new Map(kols.map((kol) => [kol.id, kol]));
  return (
    <div className="marketing-lead-list">
      {leads.map((lead) => {
        const kol = lead.kolId ? kolById.get(lead.kolId) : null;
        return (
          <LeadCard
            key={lead.id}
            lead={lead}
            kol={kol}
            className={lead.hidden ? 'hidden-lead' : ''}
            chips={lead.hidden ? <span className="marketing-hidden-chip"><EyeOff size={11} />已隐藏</span> : undefined}
            onOpenKol={onOpenKol}
            actions={
              otherView ? (
                onRestore && <button className="settings-btn" type="button" onClick={() => onRestore(lead)} disabled={busy}><Undo2 size={13} />恢复</button>
              ) : (
                <button className="settings-btn" type="button" onClick={() => onMoveToOther(lead)} disabled={busy}>归到其他</button>
              )
            }
          />
        );
      })}
    </div>
  );
}

function KolTable({ kols, selectedId, onSelect }: { kols: KolProfile[]; selectedId: string | null; onSelect: (id: string) => void }) {
  if (kols.length === 0) {
    return <div className="partner-marketing-placeholder"><Database size={18} /><span>暂无 KOL 档案。达人邮件同步后会自动生成记录。</span></div>;
  }
  return (
    <table className="marketing-kol-table">
      <thead>
        <tr>
          <th>用户名</th>
          <th>关系</th>
          <th>合作状态</th>
          <th>负责人</th>
          <th>优先级</th>
          <th>最近联系</th>
        </tr>
      </thead>
      <tbody>
        {kols.map((kol) => (
          <tr key={kol.id} className={kol.id === selectedId ? 'selected' : ''} onClick={() => onSelect(kol.id)}>
            <td><strong>{kol.name}</strong><span>{kol.email}</span></td>
            <td>{kol.relationship}</td>
            <td><span className="marketing-stage">{kol.collaborationStatus}</span></td>
            <td>{kol.owner || '未分配'}</td>
            <td>{priorityLabel(kol.priority)}</td>
            <td>{formatMaybeDate(kol.lastContactedAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function KolDetailPanel({ kol, busy, onSave }: { kol: KolProfile | null; busy: boolean; onSave: (kol: KolProfile, patch: KolProfilePatch) => void }) {
  const [draft, setDraft] = useState<KolProfilePatch>({});
  useEffect(() => {
    setDraft(kol ? {
      name: kol.name,
      email: kol.email,
      country: kol.country ?? '',
      relationship: kol.relationship,
      collaborationStatus: kol.collaborationStatus,
      stage: kol.stage,
      owner: kol.owner ?? '',
      priority: kol.priority,
      tags: kol.tags,
      brandFitScore: kol.brandFitScore ?? null,
      riskNote: kol.riskNote ?? '',
      nextFollowUpAt: kol.nextFollowUpAt ?? null,
      agentNotes: kol.agentNotes ?? '',
      humanNotes: kol.humanNotes ?? '',
    } : {});
  }, [kol?.id]);

  if (!kol) {
    return <aside className="marketing-detail-panel"><div className="partner-marketing-placeholder"><Users size={18} /><span>选择一个 KOL 查看详情。</span></div></aside>;
  }
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave(kol, {
      ...draft,
      country: emptyToNull(draft.country),
      owner: emptyToNull(draft.owner),
      riskNote: emptyToNull(draft.riskNote),
      agentNotes: emptyToNull(draft.agentNotes),
      humanNotes: emptyToNull(draft.humanNotes),
      brandFitScore: normalizeOptionalNumber(draft.brandFitScore),
      nextFollowUpAt: normalizeOptionalNumber(draft.nextFollowUpAt),
    });
  };
  return (
    <aside className="marketing-detail-panel">
      <header>
        <span className="marketing-avatar">{initials(kol.name)}</span>
        <div><strong>{kol.name}</strong><span>{kol.email}</span></div>
      </header>
      <form className="marketing-detail-form" onSubmit={submit}>
        <label>用户名<input className="settings-input" value={draft.name ?? ''} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
        <label>邮箱<input className="settings-input" value={draft.email ?? ''} onChange={(event) => setDraft({ ...draft, email: event.target.value })} /></label>
        <label>国家<input className="settings-input" value={draft.country ?? ''} onChange={(event) => setDraft({ ...draft, country: event.target.value })} /></label>
        <label>合作状态
          <select className="settings-select" value={draft.collaborationStatus ?? '待分配'} onChange={(event) => setDraft({ ...draft, collaborationStatus: event.target.value })}>
            {['待分配', '跟进中', '已合作', '不适合'].map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label>阶段<input className="settings-input" value={draft.stage ?? ''} onChange={(event) => setDraft({ ...draft, stage: event.target.value })} /></label>
        <label>负责人<input className="settings-input" value={draft.owner ?? ''} onChange={(event) => setDraft({ ...draft, owner: event.target.value })} /></label>
        <label>优先级
          <select className="settings-select" value={draft.priority ?? 'normal'} onChange={(event) => setDraft({ ...draft, priority: event.target.value })}>
            <option value="high">高</option>
            <option value="normal">普通</option>
            <option value="low">低</option>
          </select>
        </label>
        <label>品牌适配分<input className="settings-input" type="number" min={0} max={100} value={draft.brandFitScore ?? ''} onChange={(event) => setDraft({ ...draft, brandFitScore: event.target.value ? Number(event.target.value) : null })} /></label>
        <label>标签<input className="settings-input" value={draft.tags ?? ''} onChange={(event) => setDraft({ ...draft, tags: event.target.value })} placeholder="beauty,tiktok" /></label>
        <label>风险备注<textarea className="settings-textarea" value={draft.riskNote ?? ''} onChange={(event) => setDraft({ ...draft, riskNote: event.target.value })} /></label>
        <label>人工备注<textarea className="settings-textarea" value={draft.humanNotes ?? ''} onChange={(event) => setDraft({ ...draft, humanNotes: event.target.value })} /></label>
        <button className="settings-btn primary" type="submit" disabled={busy}>保存档案</button>
      </form>
    </aside>
  );
}

function AutomationLogList({ logs }: { logs: MarketingDbSnapshot['auditLogs'] }) {
  if (logs.length === 0) {
    return <div className="partner-marketing-placeholder"><Database size={18} /><span>暂无自动化日志。</span></div>;
  }
  return (
    <div className="marketing-log-list">
      {logs.map((log) => (
        <article key={log.id}>
          <strong>{log.actor === 'agent' ? 'Agent' : '用户'} 更新 {log.targetTable}.{log.field}</strong>
          <span>{formatMaybeDate(log.createdAt)} · {log.reason}</span>
          <code>{log.oldValue ?? '空'} → {log.newValue ?? '空'}</code>
        </article>
      ))}
    </div>
  );
}

function ChatArea({
  domain,
  agentContext,
  agentContextResolver,
  contextToggle,
}: {
  domain: DomainConfig;
  agentContext?: string;
  agentContextResolver?: AgentContextResolver;
  contextToggle?: ComposerContextToggle;
}) {
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
            <strong>{previewRuntime ? '浏览器预览模式' : '本地智能引擎暂不可用'}</strong>
            <span>{previewRuntime ? '这里会模拟品牌工作台事件流；桌面应用会直连本地智能引擎。' : codexStatus?.error || '请确认本地智能引擎已安装并登录。'}</span>
            {codexStatus?.path && <code>{codexStatus.path}</code>}
          </div>
        </div>
      )}
      {isEmpty ? (
        <EmptyState
          domain={domain}
          conversation={conversation}
          disabled={!codexReady}
          agentContext={agentContext}
          agentContextResolver={agentContextResolver}
          contextToggle={contextToggle}
        />
      ) : (
        <>
          <div className="message-scroll"><MessageList conversation={conversation} /></div>
          <Composer
            domain={domain}
            conversation={conversation}
            disabled={!codexReady}
            bottom
            agentContext={agentContext}
            agentContextResolver={agentContextResolver}
            contextToggle={contextToggle}
          />
        </>
      )}
    </div>
  );
}

function EmptyState({
  domain,
  conversation,
  disabled,
  agentContext,
  agentContextResolver,
  contextToggle,
}: {
  domain: DomainConfig;
  conversation: Conversation;
  disabled: boolean;
  agentContext?: string;
  agentContextResolver?: AgentContextResolver;
  contextToggle?: ComposerContextToggle;
}) {
  const sendMessage = useChatStore((state) => state.sendMessage);
  const sendSuggestion = async (suggestion: DomainSuggestion) => {
    const resolvedAgentContext = await resolveComposerAgentContext(agentContext, agentContextResolver);
    void sendMessage(suggestion.prompt, undefined, resolvedAgentContext ? {
      agentContext: resolvedAgentContext.context,
      agentContextTrace: resolvedAgentContext.trace,
    } : undefined);
  };
  return (
    <div className="empty-state">
      <h1 className="empty-heading">{domain.ui.emptyHeading}</h1>
      <Composer
        domain={domain}
        conversation={conversation}
        disabled={disabled}
        agentContext={agentContext}
        agentContextResolver={agentContextResolver}
        contextToggle={contextToggle}
      />
      <div className="suggestion-row">
        {domain.ui.suggestions.map((suggestion) => (
          <button key={suggestion.id} type="button" className="suggestion-card" onClick={() => void sendSuggestion(suggestion)}>
            {domainSuggestionIcon(suggestion)}
            <strong>{suggestion.title}</strong>
            <span>{suggestion.prompt}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageList({ conversation }: { conversation: Conversation }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const streaming = conversation.status === 'streaming';
  const answerLength = streaming ? streamingAnswerLength(conversation) : 0;
  const typing = useActiveTyping(answerLength, streaming);
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversation.messages.length, conversation.messages[conversation.messages.length - 1], streaming]);
  return (
    <div className="message-list">
      {conversation.messages.map((message) => <MessageBubble key={message.id} message={message} conversation={conversation} />)}
      {streaming && !typing && <ThinkingIndicator />}
      <div ref={scrollRef} />
    </div>
  );
}

// Total characters of answer text in the last (streaming) assistant message.
function streamingAnswerLength(conversation: Conversation): number {
  const last = conversation.messages[conversation.messages.length - 1];
  if (!last || last.role !== 'assistant') return 0;
  let length = 0;
  for (const block of last.blocks) {
    if (block.type === 'text') length += block.content.length;
  }
  return length;
}

// True while answer tokens are actively streaming in. We hide the "正在思考"
// indicator during active typing and only bring it back once the text output
// pauses for a beat (e.g. the model resumes reasoning or runs a tool) while the
// turn is still in progress.
function useActiveTyping(answerLength: number, streaming: boolean): boolean {
  const [typing, setTyping] = useState(false);
  const previousLength = useRef(answerLength);
  useEffect(() => {
    if (!streaming) {
      previousLength.current = answerLength;
      setTyping(false);
      return;
    }
    const grew = answerLength > previousLength.current;
    previousLength.current = answerLength;
    if (!grew) return;
    setTyping(true);
    const timer = window.setTimeout(() => setTyping(false), 700);
    return () => window.clearTimeout(timer);
  }, [answerLength, streaming]);
  return typing;
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
  const isReviewRequest = message.role === 'user' && Boolean(message.reviewRequest);
  const plainText = messageToPlainText(message);
  const canCopy = plainText.length > 0 && !isReviewRequest;
  const canEdit = message.role === 'user' && !isReviewRequest && conversation.status !== 'streaming';
  const lastBlockIndex = message.blocks.length - 1;
  const submitEdit = (next: string, attachments: MessageAttachment[]) => {
    const trimmed = next.trim();
    if (!trimmed && attachments.length === 0) return;
    setEditing(false);
    void editUserMessageAndResend(conversation.id, message.id, trimmed, attachments);
  };
  if (message.role === 'assistant' && message.blocks.length === 0 && message.isStreaming) {
    return null;
  }
  return (
    <article className={`message ${message.role} ${editing ? 'editing' : ''}`}>
      {editing && canEdit ? (
        <MessageEditBubble initialValue={plainText} initialAttachments={message.attachments ?? []} onCancel={() => setEditing(false)} onSubmit={submitEdit} />
      ) : isReviewRequest && message.reviewRequest ? (
        <ReviewRequestChip request={message.reviewRequest} />
      ) : (
        <>
          {message.role === 'user' && message.attachments?.length ? (
            <MessageAttachments attachments={message.attachments} />
          ) : null}
          {(message.role !== 'user' || message.blocks.length > 0) && (
            <div className="bubble">
              {message.role === 'user'
                ? message.blocks.map((block, index) => block.type === 'text' ? <span key={index}>{block.content}</span> : <BlockRenderer key={index} block={block} />)
                : message.review
                  ? <ReviewBody message={message} cwd={conversation.cwd} />
                  : buildRenderUnits(message.blocks).map((unit) =>
                      unit.type === 'command-group'
                        ? (unit.blocks.length === 1
                            ? <BlockRenderer key={`tool-${unit.startIndex}`} block={unit.blocks[0]} />
                            : <CommandGroup key={`cmd-group-${unit.startIndex}`} blocks={unit.blocks} />)
                        : <BlockRenderer key={`${unit.block.type}-${unit.index}`} block={unit.block} streaming={Boolean(message.isStreaming) && unit.index === lastBlockIndex} />,
                    )}
            </div>
          )}
        </>
      )}
      {!editing && !message.isStreaming && (canCopy || canEdit) && (
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

function MessageEditBubble({ initialValue, initialAttachments, onCancel, onSubmit }: { initialValue: string; initialAttachments: MessageAttachment[]; onCancel: () => void; onSubmit: (value: string, attachments: MessageAttachment[]) => void }) {
  const [value, setValue] = useState(initialValue);
  const [attachments, setAttachments] = useState<MessageAttachment[]>(initialAttachments);
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
  const addFiles = async () => {
    const items = await pickAttachments();
    if (items.length) setAttachments((prev) => mergeAttachments(prev, items));
  };
  const removeAttachment = (id: string) => setAttachments((prev) => prev.filter((item) => item.id !== id));
  const canSubmit = Boolean(value.trim() || attachments.length);
  const submit = () => {
    if (!canSubmit) return;
    onSubmit(value, attachments);
  };
  return (
    <div className="message-edit-card">
      {attachments.length > 0 && (
        <div className="composer-attachments">
          {attachments.map((attachment) => (
            <AttachmentCard key={attachment.id} attachment={attachment} onRemove={() => removeAttachment(attachment.id)} />
          ))}
        </div>
      )}
      <textarea ref={textareaRef} className="message-edit-textarea" value={value} rows={1} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => {
        if (event.key === 'Escape') onCancel();
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
          event.preventDefault();
          submit();
        }
      }} />
      <div className="message-edit-actions">
        <button type="button" className="message-edit-attach" onClick={() => void addFiles()} aria-label="添加照片和文件" title="添加照片和文件"><Paperclip size={15} /></button>
        <span className="spacer" />
        <button type="button" className="message-edit-btn ghost" onClick={onCancel}>取消</button>
        <button type="button" className="message-edit-btn primary" onClick={submit} disabled={!canSubmit}>发送</button>
      </div>
    </div>
  );
}

// A disclosure whose body is mounted only while open. Keeping the body out of
// the DOM when collapsed avoids a WKWebView bug where content updated inside a
// closed <details> (e.g. command output that lands exactly as the row
// auto-collapses on completion) renders blank until the row is toggled again.
function EventDetails({
  className,
  forceOpen = false,
  defaultOpen = false,
  summary,
  children,
}: {
  className: string;
  forceOpen?: boolean;
  defaultOpen?: boolean;
  summary: ReactNode;
  children?: ReactNode;
}) {
  const [userOpen, setUserOpen] = useState(defaultOpen);
  const open = forceOpen || userOpen;
  return (
    <details
      className={className}
      open={open}
      onToggle={(event) => {
        // While forced open (in progress) ignore collapse attempts; the next
        // render restores the open state.
        if (forceOpen) return;
        const next = event.currentTarget.open;
        if (next !== userOpen) setUserOpen(next);
      }}
    >
      <summary className="event-summary">{summary}</summary>
      {open && children}
    </details>
  );
}

function BlockRenderer({ block, streaming }: { block: MessageBlock; streaming?: boolean }) {
  if (block.type === 'text') {
    return <div className={`markdown-content ${streaming ? 'streaming' : ''}`}><ReactMarkdown remarkPlugins={[remarkGfm]}>{block.content}</ReactMarkdown></div>;
  }
  if (block.type === 'thinking') {
    return (
      <EventDetails
        className={`thinking-block ${streaming ? 'is-active' : ''}`}
        forceOpen={streaming}
        summary={(
          <>
            <span className="event-icon">{streaming ? <Loader2 size={13} className="spin" /> : <Sparkles size={13} />}</span>
            <span className="event-verb">{streaming ? '正在推理' : '推理过程'}</span>
            <span className="event-target" />
            <ChevronDown size={13} className="event-chevron" />
          </>
        )}
      >
        <div className="thinking-text">{block.content.trim()}</div>
      </EventDetails>
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
  const plainBody = isCommand ? '' : cleanCommandOutput(block.output || block.input || '');
  const hasBody = isCommand ? Boolean(block.input || block.output) : Boolean(plainBody) && plainBody !== target;
  return (
    <EventDetails
      className={`tool-block event-block ${block.status} kind-${tool.kind}`}
      forceOpen={running}
      summary={(
        <>
          <span className="event-icon">{tool.icon}</span>
          <span className="event-verb">{verb}</span>
          <span className={`event-target ${target ? 'mono' : ''}`}>{target}</span>
          <span className="event-trailing">
            {running ? <Loader2 size={12} className="spin" /> : failed ? <AlertCircle size={12} className="event-fail" /> : null}
            <ChevronDown size={13} className="event-chevron" />
          </span>
        </>
      )}
    >
      {hasBody && (
        <div className="event-body">
          {isCommand ? (
            <CommandCard command={block.input} output={block.output} status={block.status} />
          ) : (
            <pre className="event-output">{plainBody}</pre>
          )}
        </div>
      )}
    </EventDetails>
  );
}

function CommandCard({ command, output, status }: { command?: string; output?: string; status: 'in_progress' | 'completed' | 'failed' }) {
  const cleaned = cleanCommandOutput(output);
  const copyText = [command ? `$ ${command}` : '', cleaned].filter(Boolean).join('\n');
  const statusBadge = status === 'failed'
    ? <span className="cc-status fail"><AlertCircle size={12} />失败</span>
    : status === 'completed'
      ? <span className="cc-status ok"><Check size={12} />成功</span>
      : <span className="cc-status run"><Loader2 size={12} className="spin" />运行中</span>;
  return (
    <div className={`command-card ${status}`}>
      <div className="command-card-bar">
        <span className="command-card-label"><Terminal size={12} />Shell</span>
        {statusBadge}
        <button type="button" className="command-card-copy" onClick={() => void copyToClipboard(copyText)} aria-label="复制命令">
          <Copy size={12} />
        </button>
      </div>
      <div className="command-card-body">
        {command && <div className="command-line"><span className="command-prompt">$</span><span className="command-text">{command}</span></div>}
        {cleaned && <pre className="command-out">{cleaned}</pre>}
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
    <EventDetails
      className={`tool-block event-block command-group ${state}`}
      forceOpen={anyRunning}
      summary={(
        <>
          <span className="event-icon command-group-icon"><SquareTerminal size={15} /></span>
          <span className="event-verb">{verb} {blocks.length} 条命令</span>
          <span className="event-target" />
          <span className="event-trailing">
            {anyRunning ? <Loader2 size={12} className="spin" /> : anyFailed ? <AlertCircle size={12} className="event-fail" /> : null}
            <ChevronDown size={13} className="event-chevron" />
          </span>
        </>
      )}
    >
      <div className="command-group-items">
        {blocks.map((block) => <ToolBlockView key={block.id} block={block} />)}
      </div>
    </EventDetails>
  );
}

type RenderUnit =
  | { type: 'block'; block: MessageBlock; index: number }
  | { type: 'command-group'; blocks: Array<Extract<MessageBlock, { type: 'tool' }>>; startIndex: number };

function buildRenderUnits(blocks: MessageBlock[]): RenderUnit[] {
  const units: RenderUnit[] = [];
  const hideReconnectStatus = blocks.some((block) => !isReconnectStatusBlock(block));
  let index = 0;
  while (index < blocks.length) {
    if (hideReconnectStatus && isReconnectStatusBlock(blocks[index])) {
      index += 1;
      continue;
    }
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

function isReconnectStatusBlock(block: MessageBlock): boolean {
  return block.type === 'error' && /^Reconnecting\.\.\.\s+\d+\/\d+$/i.test(block.content.trim());
}

function Composer({
  domain,
  conversation,
  disabled,
  bottom,
  className,
  placeholder,
  agentContext,
  agentContextResolver,
  contextToggle,
}: {
  domain: DomainConfig;
  conversation: Conversation;
  disabled?: boolean;
  bottom?: boolean;
  className?: string;
  placeholder?: string;
  agentContext?: string;
  agentContextResolver?: AgentContextResolver;
  contextToggle?: ComposerContextToggle;
}) {
  const [value, setValue] = useState('');
  const [attachments, setAttachments] = useState<MessageAttachment[]>([]);
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
  const addAttachments = (items: MessageAttachment[]) => {
    setAttachments((prev) => mergeAttachments(prev, items));
  };
  const removeAttachment = (id: string) => setAttachments((prev) => prev.filter((item) => item.id !== id));
  const canSend = Boolean(value.trim() || attachments.length);
  const submit = async () => {
    if (!canSend || isStreaming || disabled) return;
    const outgoing = attachments;
    const outgoingValue = value.trim();
    setValue('');
    setAttachments([]);
    const resolvedAgentContext = await resolveComposerAgentContext(agentContext, agentContextResolver);
    void sendMessage(outgoingValue, outgoing, resolvedAgentContext ? {
      agentContext: resolvedAgentContext.context,
      agentContextTrace: resolvedAgentContext.trace,
    } : undefined);
  };
  return (
    <div className={`composer-wrap ${bottom ? 'bottom' : ''} ${className ?? ''}`}>
      <div className="composer-card">
        {attachments.length > 0 && (
          <div className="composer-attachments">
            {attachments.map((attachment) => (
              <AttachmentCard key={attachment.id} attachment={attachment} onRemove={() => removeAttachment(attachment.id)} />
            ))}
          </div>
        )}
        <textarea
          ref={textareaRef}
          className="composer-textarea"
          value={value}
          disabled={disabled || isStreaming}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setValue(event.target.value)}
          onKeyDown={(event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void submit();
            }
          }}
          placeholder={disabled ? '请先修复本地智能引擎状态' : placeholder || (bottom ? domain.ui.followupPlaceholder : domain.ui.composerPlaceholder)}
          rows={1}
        />
        <div className="composer-toolbar">
          <ComposerPlusMenu domain={domain} onAttach={addAttachments} disabled={disabled || isStreaming} />
          <ApprovalPicker />
          {contextToggle && (
            <button
              type="button"
              className={`composer-pill side-context-pill ${contextToggle.enabled ? 'active accent' : ''}`}
              onClick={contextToggle.onToggle}
              disabled={!contextToggle.available || disabled || isStreaming}
              aria-pressed={contextToggle.enabled}
              title={contextToggle.title}
            >
              <PanelRight size={14} />
              <span>{contextToggle.enabled ? contextToggle.label : '带入侧栏'}</span>
            </button>
          )}
          <span className="spacer" />
          <ModelPicker />
          <button className="composer-icon-btn" type="button" disabled aria-label="语音"><Mic size={15} /></button>
          {isStreaming ? <button className="send-button stop" type="button" onClick={() => void stopCurrentConversation()} aria-label="停止"><Square size={12} fill="currentColor" strokeWidth={0} /></button> : <button className="send-button" type="button" onClick={() => void submit()} disabled={!canSend || disabled} aria-label="发送"><ArrowUp size={18} /></button>}
        </div>
      </div>
      <ComposerMeta conversation={conversation} />
    </div>
  );
}

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic', 'avif'];

// Maps a file extension to the badge tone used for its icon (Excel green, Word
// blue, etc.), echoing the colored file chips in the reference design.
const FILE_TONES: Record<string, 'green' | 'blue' | 'red' | 'orange'> = {
  csv: 'green', tsv: 'green', xls: 'green', xlsx: 'green', numbers: 'green',
  doc: 'blue', docx: 'blue', pages: 'blue', rtf: 'blue',
  pdf: 'red',
  ppt: 'orange', pptx: 'orange', key: 'orange',
};

function extOf(name: string): string {
  const match = /\.([^.\\/]+)$/.exec(name);
  return match ? match[1].toLowerCase() : '';
}

function isImageExt(ext: string): boolean {
  return IMAGE_EXTENSIONS.includes(ext);
}

function fileTone(ext: string): string {
  return FILE_TONES[ext] ?? 'gray';
}

function fileTypeLabel(ext: string): string {
  return ext ? ext.toUpperCase() : '文件';
}

function fileGlyph(ext: string, size: number): ReactNode {
  if (fileTone(ext) === 'green') return <FileSpreadsheet size={size} />;
  if (FILE_TONES[ext]) return <FileText size={size} />;
  return <File size={size} />;
}

function createAttachmentId(): string {
  return `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// Browser-preview fallback: the file picker yields File objects, so we can build
// an object URL for instant image thumbnails.
function buildAttachmentFromFile(file: File): MessageAttachment {
  const name = file.name;
  const ext = extOf(name);
  const kind: MessageAttachment['kind'] = file.type.startsWith('image/') || isImageExt(ext) ? 'image' : 'file';
  return {
    id: createAttachmentId(),
    name,
    kind,
    ext,
    path: name,
    previewUrl: kind === 'image' ? URL.createObjectURL(file) : undefined,
  };
}

// Desktop: the dialog returns absolute paths; images get an asset URL the
// webview can render via the Tauri asset protocol.
async function buildAttachmentFromPath(path: string): Promise<MessageAttachment> {
  const name = basename(path);
  const ext = extOf(name);
  const kind: MessageAttachment['kind'] = isImageExt(ext) ? 'image' : 'file';
  let previewUrl: string | undefined;
  if (kind === 'image') {
    try {
      const { convertFileSrc } = await import('@tauri-apps/api/core');
      previewUrl = convertFileSrc(path);
    } catch {
      previewUrl = undefined;
    }
  }
  return { id: createAttachmentId(), name, kind, ext, path, previewUrl };
}

// Opens the OS file picker (desktop) or a transient <input> (browser preview) and
// resolves the chosen files as attachments. Shared by the composer and the edit UI.
async function pickAttachments(): Promise<MessageAttachment[]> {
  if (isTauriRuntime()) {
    try {
      const { open: openDialog } = await import('@tauri-apps/plugin-dialog');
      const selected = await openDialog({ multiple: true, title: '添加照片和文件' });
      if (!selected) return [];
      const paths = Array.isArray(selected) ? selected : [selected];
      return Promise.all(paths.map((path) => buildAttachmentFromPath(path)));
    } catch {
      return [];
    }
  }
  return new Promise<MessageAttachment[]>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    let settled = false;
    const finish = (items: MessageAttachment[]) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(items);
    };
    input.addEventListener('change', () => {
      finish(Array.from(input.files ?? []).map((file) => buildAttachmentFromFile(file)));
    });
    // A dismissed dialog refocuses the window without firing `change`.
    window.addEventListener('focus', () => window.setTimeout(() => finish([]), 400), { once: true });
    document.body.appendChild(input);
    input.click();
  });
}

function mergeAttachments(prev: MessageAttachment[], items: MessageAttachment[]): MessageAttachment[] {
  const next = [...prev];
  for (const item of items) {
    const key = item.path || item.name;
    if (!next.some((existing) => (existing.path || existing.name) === key)) next.push(item);
  }
  return next;
}

// A single attachment shown inside the composer: image thumbnail or file card.
function AttachmentCard({ attachment, onRemove }: { attachment: MessageAttachment; onRemove: () => void }) {
  const [previewFailed, setPreviewFailed] = useState(false);
  const openViewer = useImageViewer((state) => state.open);
  if (attachment.kind === 'image' && attachment.previewUrl && !previewFailed) {
    return (
      <div className="att-thumb" title={`查看原图 · ${attachment.name}`}>
        <img
          src={attachment.previewUrl}
          alt={attachment.name}
          onError={() => setPreviewFailed(true)}
          onClick={() => attachment.previewUrl && openViewer(attachment.previewUrl, attachment.name)}
        />
        <button type="button" className="att-remove" onClick={onRemove} aria-label={`移除 ${attachment.name}`}><X size={12} /></button>
      </div>
    );
  }
  return (
    <div className={`att-card tone-${fileTone(attachment.ext)}`} title={attachment.name}>
      <span className="att-icon">{attachment.kind === 'image' ? <ImageIcon size={18} /> : fileGlyph(attachment.ext, 18)}</span>
      <span className="att-info">
        <span className="att-name">{attachment.name}</span>
        <span className="att-type">{attachment.kind === 'image' ? '图片' : fileTypeLabel(attachment.ext)}</span>
      </span>
      <button type="button" className="att-remove" onClick={onRemove} aria-label={`移除 ${attachment.name}`}><X size={12} /></button>
    </div>
  );
}

// Attachments rendered inside a sent user message: image thumbnails + file pills.
function MessageAttachments({ attachments }: { attachments: MessageAttachment[] }) {
  return (
    <div className="message-attachments">
      {attachments.filter((item) => item.kind === 'image').map((attachment) => (
        <MessageImageAttachment key={attachment.id} attachment={attachment} />
      ))}
      {attachments.filter((item) => item.kind !== 'image').map((attachment) => (
        <span key={attachment.id} className={`att-pill tone-${fileTone(attachment.ext)}`} title={attachment.name}>
          <span className="att-pill-icon">{fileGlyph(attachment.ext, 13)}</span>
          <span className="att-pill-name">{attachment.name}</span>
        </span>
      ))}
    </div>
  );
}

function MessageImageAttachment({ attachment }: { attachment: MessageAttachment }) {
  const [failed, setFailed] = useState(false);
  const openViewer = useImageViewer((state) => state.open);
  if (!attachment.previewUrl || failed) {
    return (
      <span className="att-pill tone-gray" title={attachment.name}>
        <span className="att-pill-icon"><ImageIcon size={13} /></span>
        <span className="att-pill-name">{attachment.name}</span>
      </span>
    );
  }
  return (
    <button
      type="button"
      className="message-image"
      title={`查看原图 · ${attachment.name}`}
      onClick={() => attachment.previewUrl && openViewer(attachment.previewUrl, attachment.name)}
    >
      <img src={attachment.previewUrl} alt={attachment.name} onError={() => setFailed(true)} />
    </button>
  );
}

// Full-size image preview overlay opened by clicking a thumbnail.
function ImageLightbox() {
  const src = useImageViewer((state) => state.src);
  const alt = useImageViewer((state) => state.alt);
  const close = useImageViewer((state) => state.close);
  useEffect(() => {
    if (!src) return;
    const onKey = (event: WindowEventMap['keydown']) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [src, close]);
  if (!src) return null;
  return (
    <div className="image-viewer" role="dialog" aria-modal="true" aria-label={alt || '图片预览'} onClick={close}>
      <button type="button" className="image-viewer-close" onClick={close} aria-label="关闭预览"><X size={18} /></button>
      <img className="image-viewer-img" src={src} alt={alt} onClick={(event) => event.stopPropagation()} />
      {alt && <span className="image-viewer-caption">{alt}</span>}
    </div>
  );
}

// The "+" composer menu: attach files, toggle plan/goal modes, browse plugins.
function ComposerPlusMenu({ domain, onAttach, disabled }: { domain: DomainConfig; onAttach: (items: MessageAttachment[]) => void; disabled?: boolean }) {
  const planMode = useChatStore((state) => state.planMode);
  const pursueGoal = useChatStore((state) => state.pursueGoal);
  const setPlanMode = useChatStore((state) => state.setPlanMode);
  const setPursueGoal = useChatStore((state) => state.setPursueGoal);
  const [open, setOpen] = useState(false);
  const [submenu, setSubmenu] = useState<'plugins' | null>(null);
  const close = () => {
    setOpen(false);
    setSubmenu(null);
  };

  const pickFiles = async () => {
    close();
    const items = await pickAttachments();
    if (items.length) onAttach(items);
  };

  return (
    <div className="plus-picker">
      <button
        type="button"
        className={`composer-icon-btn ${open ? 'active' : ''}`}
        onClick={() => setOpen((prev) => !prev)}
        disabled={disabled}
        aria-label="添加内容"
        aria-haspopup="menu"
        aria-expanded={open}
        title="添加内容"
      >
        <Plus size={16} />
      </button>
      {open && (
        <>
          <button className="menu-backdrop" type="button" aria-label="关闭菜单" onClick={close} />
          <div className="plus-menu" role="menu" onMouseLeave={() => setSubmenu(null)}>
            <button type="button" className="plus-menu-item" role="menuitem" onMouseEnter={() => setSubmenu(null)} onClick={() => void pickFiles()}>
              <Paperclip size={15} />
              <span>添加照片和文件</span>
            </button>
            <div className="plus-menu-divider" />
            <button
              type="button"
              className="plus-menu-item toggle-row"
              role="menuitemcheckbox"
              aria-checked={planMode}
              onMouseEnter={() => setSubmenu(null)}
              onClick={() => setPlanMode(!planMode)}
            >
              <ListChecks size={15} />
              <span>计划模式</span>
              <Toggle checked={planMode} />
            </button>
            <button
              type="button"
              className="plus-menu-item toggle-row"
              role="menuitemcheckbox"
              aria-checked={pursueGoal}
              onMouseEnter={() => setSubmenu(null)}
              onClick={() => setPursueGoal(!pursueGoal)}
            >
              <Target size={15} />
              <span>追求目标</span>
              <Toggle checked={pursueGoal} />
            </button>
            <div className="plus-menu-divider" />
            <div className="plus-flyout-row" onMouseEnter={() => setSubmenu('plugins')}>
              <button type="button" className="plus-menu-item submenu-trigger">
                <Plug size={15} />
                <span>插件</span>
                <ChevronRight size={14} className="model-menu-chevron" />
              </button>
              {submenu === 'plugins' && (
                <div className="plus-flyout">
                  <div className="model-flyout-panel" role="menu">
                    <div className="model-menu-label">插件入口</div>
                    {domain.navigation.integrations.map((item) => (
                      <div key={item.id} className="plus-plugin-row">
                        <span>{item.label}</span>
                        <span className="plus-plugin-tag">可扩展</span>
                      </div>
                    ))}
                    <div className="plus-menu-hint">垂直商用版保留插件入口，可在此扩展领域能力。</div>
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

// The brand-directory pill beneath the composer doubles as a switcher: it lists
// existing brand folders and lets a conversation bind to one brand directory.
function DirectoryPicker({ conversation }: { conversation: Conversation }) {
  const projects = useChatStore((state) => state.projects);
  const setConversationCwd = useChatStore((state) => state.setConversationCwd);
  const createProject = useChatStore((state) => state.createProject);
  const [open, setOpen] = useState(false);
  const cwd = conversation.cwd;
  const folderProjects = useMemo(
    () => activeProjects(projects).filter((project) => project.cwd),
    [projects],
  );
  const close = () => setOpen(false);

  const pickProject = (project: Project) => {
    setConversationCwd(conversation.id, project.cwd, project.id);
    close();
  };
  const pickCustomFolder = async () => {
    close();
    const dir = await pickFolder();
    if (!dir) return;
    // Group the conversation under a brand for that folder so it lands in the
    // sidebar's 品牌 section instead of as a stray standalone chat. Reuse a
    // matching brand when one already exists, otherwise spin up a new one.
    const existing = activeProjects(projects).find((project) => project.cwd === dir);
    const projectId = existing ? existing.id : createProject({ name: basename(dir), cwd: dir });
    setConversationCwd(conversation.id, dir, projectId);
  };
  const clearFolder = () => {
    setConversationCwd(conversation.id, '', null);
    close();
  };

  return (
    <div className="dir-picker">
      <button
        type="button"
        className={`composer-meta-pill dir-pill ${open ? 'active' : ''}`}
        title={cwd || '选择品牌目录'}
        onClick={() => setOpen((value) => !value)}
      >
        <FolderOpen size={12} />
        <span>{cwd ? basename(cwd) : '选择品牌目录'}</span>
        <ChevronDown size={11} className="dir-pill-chevron" />
      </button>
      {open && (
        <>
          <button className="menu-backdrop" type="button" aria-label="关闭目录菜单" onClick={close} />
          <div className="model-menu dir-menu" role="menu">
            {folderProjects.length > 0 && <div className="model-menu-label">品牌目录</div>}
            {folderProjects.map((project) => {
              const selected = conversation.projectId === project.id || (!!cwd && cwd === project.cwd);
              return (
                <button
                  key={project.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  className={`model-menu-item dir-menu-item ${selected ? 'active' : ''}`}
                  title={project.cwd}
                  onClick={() => pickProject(project)}
                >
                  <Folder size={14} />
                  <span className="dir-menu-text">
                    <span className="dir-menu-name">{project.name}</span>
                    <span className="dir-menu-path">{shortenPath(project.cwd)}</span>
                  </span>
                  {selected && <Check size={14} className="model-menu-check" />}
                </button>
              );
            })}
            {folderProjects.length > 0 && <div className="model-menu-divider" />}
            <button type="button" className="model-menu-item dir-menu-item" onClick={() => void pickCustomFolder()}>
              <FolderInput size={14} />
              <span>选择其他品牌目录…</span>
            </button>
            {cwd && (
              <button type="button" className="model-menu-item dir-menu-item" onClick={clearFolder}>
                <FolderOpen size={14} />
                <span>清除品牌目录</span>
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// The branch pill beneath the composer lists local branches and lets you switch
// to one or create-and-checkout a new branch without opening the full Git panel.
function BranchPicker({ cwd, currentBranch, onChanged }: { cwd: string; currentBranch: string; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<GitBranchInfo[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  const close = () => {
    setOpen(false);
    setQuery('');
    setError(null);
    setCreating(false);
    setNewName('');
  };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const list = await gitBranches(cwd);
        if (!cancelled) setBranches(list);
      } catch (err) {
        if (!cancelled) setError(stringifyError(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, cwd]);

  const runGit = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChanged();
      close();
    } catch (err) {
      setError(stringifyError(err));
    } finally {
      setBusy(false);
    }
  };

  const switchBranch = (name: string) => {
    if (name === currentBranch) {
      close();
      return;
    }
    void runGit(() => gitCheckoutBranch(cwd, name));
  };

  const submitCreate = () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    void runGit(() => gitCreateBranch(cwd, trimmed));
  };

  const normalized = query.trim().toLowerCase();
  const filtered = normalized
    ? branches.filter((item) => item.name.toLowerCase().includes(normalized))
    : branches;

  return (
    <div className="branch-picker">
      <button
        type="button"
        className={`composer-meta-pill branch-pill ${open ? 'active' : ''}`}
        title={`当前分支 ${currentBranch}`}
        onClick={() => setOpen((value) => !value)}
      >
        <GitBranch size={12} />
        <span>{currentBranch}</span>
        <ChevronDown size={11} className="dir-pill-chevron" />
      </button>
      {open && (
        <>
          <button className="menu-backdrop" type="button" aria-label="关闭分支菜单" onClick={close} />
          <div className="model-menu branch-menu" role="menu">
            <div className="branch-search">
              <Search size={13} />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索分支"
                spellCheck={false}
              />
            </div>
            <div className="model-menu-label">分支</div>
            <div className="branch-list">
              {filtered.length === 0 ? (
                <div className="branch-empty">{branches.length === 0 ? '没有可用分支' : '没有匹配的分支'}</div>
              ) : (
                filtered.map((item) => {
                  const active = item.current || item.name === currentBranch;
                  return (
                    <button
                      key={item.name}
                      type="button"
                      role="menuitemradio"
                      aria-checked={active}
                      className={`model-menu-item branch-menu-item ${active ? 'active' : ''}`}
                      title={item.upstream ? `${item.name} · ${item.upstream}` : item.name}
                      disabled={busy}
                      onClick={() => switchBranch(item.name)}
                    >
                      <GitBranch size={14} />
                      <span>{item.name}</span>
                      {active && <Check size={14} className="model-menu-check" />}
                    </button>
                  );
                })
              )}
            </div>
            <div className="model-menu-divider" />
            {creating ? (
              <form
                className="branch-create"
                onSubmit={(event) => {
                  event.preventDefault();
                  submitCreate();
                }}
              >
                <GitBranch size={13} />
                <input
                  autoFocus
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                  placeholder="新分支名"
                  spellCheck={false}
                  disabled={busy}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      setCreating(false);
                      setNewName('');
                    }
                  }}
                />
                <button type="submit" className="branch-create-confirm" disabled={!newName.trim() || busy} aria-label="创建并检出分支" title="创建并检出">
                  {busy ? <Loader2 size={13} className="spin" /> : <Check size={14} />}
                </button>
              </form>
            ) : (
              <button
                type="button"
                className="model-menu-item branch-menu-item"
                disabled={busy}
                onClick={() => {
                  setNewName(query.trim());
                  setCreating(true);
                }}
              >
                <Plus size={14} />
                <span>创建并检出新分支…</span>
              </button>
            )}
            {error && (
              <div className="branch-error">
                <AlertCircle size={12} />
                <span>{error}</span>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// Directory context shown beneath the composer.
function ComposerMeta({ conversation }: { conversation: Conversation }) {
  const planMode = useChatStore((state) => state.planMode);
  const pursueGoal = useChatStore((state) => state.pursueGoal);

  return (
    <div className="composer-meta">
      <DirectoryPicker conversation={conversation} />
      {planMode && (
        <span className="composer-meta-pill mode-on" title="计划模式已开启：Incuboot 会先给出可执行计划">
          <ListChecks size={12} />
          <span>计划模式</span>
        </span>
      )}
      {pursueGoal && (
        <span className="composer-meta-pill mode-on" title="追求目标已开启：Incuboot 会持续推进直到目标达成">
          <Target size={12} />
          <span>追求目标</span>
        </span>
      )}
    </div>
  );
}

function ModelPicker() {
  const selectedModelProfileId = useChatStore((state) => state.selectedModelProfileId);
  const modelProfiles = useChatStore((state) => state.modelProfiles);
  const reasoningEffort = useChatStore((state) => state.reasoningEffort);
  const speed = useChatStore((state) => state.speed);
  const setModelProfile = useChatStore((state) => state.setModelProfile);
  const setReasoningEffort = useChatStore((state) => state.setReasoningEffort);
  const setSpeed = useChatStore((state) => state.setSpeed);
  const [open, setOpen] = useState(false);
  const [submenu, setSubmenu] = useState<'model' | 'speed' | null>(null);
  const enabledProfiles = modelProfiles.filter((profile) => profile.enabled);
  const builtInProfiles = enabledProfiles.filter((profile) => profile.builtIn);
  const customProfiles = enabledProfiles.filter((profile) => !profile.builtIn);
  const close = () => { setOpen(false); setSubmenu(null); };
  return (
    <div className="model-picker">
      <button type="button" className={`composer-pill model-pill ${open ? 'active' : ''}`} onClick={() => setOpen((value) => !value)} title="选择模型与推理强度">
        {speed === 'fast' && <Zap size={12} className="model-pill-fast" />}<span>{shortModelProfileLabel(modelProfiles, selectedModelProfileId)}</span><span className="model-pill-effort">{effortLabel(reasoningEffort)}</span><ChevronDown size={12} />
      </button>
      {open && (
        <>
          <button className="menu-backdrop" type="button" aria-label="关闭模型菜单" onClick={close} />
          <div className="model-menu" role="menu" onMouseLeave={() => setSubmenu(null)}>
            <div className="model-menu-label">智能</div>
            {EFFORT_OPTIONS.map((option) => <button key={option.id} type="button" role="menuitemradio" aria-checked={option.id === reasoningEffort} className="model-menu-item" onMouseEnter={() => setSubmenu(null)} onClick={() => { setReasoningEffort(option.id as ReasoningEffort); close(); }}><span>{option.label}</span>{option.id === reasoningEffort && <Check size={14} className="model-menu-check" />}</button>)}
            <div className="model-menu-divider" />
            <div className="model-flyout-row" onMouseEnter={() => setSubmenu('model')}>
              <button type="button" className="model-menu-item submenu-trigger"><span>{modelProfileLabel(modelProfiles, selectedModelProfileId)}</span><ChevronRight size={14} className="model-menu-chevron" /></button>
              {submenu === 'model' && (
                <div className="model-flyout">
                  <div className="model-flyout-panel" role="menu">
                    <div className="model-menu-label">内置模型</div>
                    {builtInProfiles.map((option) => (
                      <button key={option.id} type="button" role="menuitemradio" aria-checked={option.id === selectedModelProfileId} className="model-menu-item" onClick={() => { setModelProfile(option.id); close(); }}>
                        <span>{option.label}</span>{option.id === selectedModelProfileId && <Check size={14} className="model-menu-check" />}
                      </button>
                    ))}
                    {customProfiles.length > 0 && <div className="model-menu-divider" />}
                    {customProfiles.length > 0 && <div className="model-menu-label">自定义模型</div>}
                    {customProfiles.map((option) => (
                      <button key={option.id} type="button" role="menuitemradio" aria-checked={option.id === selectedModelProfileId} className="model-menu-item model-profile-item" onClick={() => { setModelProfile(option.id); close(); }}>
                        <span><strong>{option.label}</strong><em>{option.providerId} · {option.model}</em></span>{option.id === selectedModelProfileId && <Check size={14} className="model-menu-check" />}
                      </button>
                    ))}
                  </div>
                </div>
              )}
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
        title="选择 Incuboot 操作的批准方式"
      >
        {approvalIcon(approvalMode, 12)}
        <span>{approvalLabel(approvalMode)}</span>
        <ChevronDown size={12} />
      </button>
      {open && (
        <>
          <button className="menu-backdrop" type="button" aria-label="关闭批准菜单" onClick={() => setOpen(false)} />
          <div className="approval-menu" role="menu">
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

type ReviewStep = 'menu' | 'base' | 'commit' | 'custom';

// The review launcher mirrors Codex's `/review` presets: review uncommitted
// changes, compare against a base branch, review a specific commit, or run the
// reviewer with custom instructions. Picking a target kicks off a read-only
// review turn in the current conversation and closes the dialog.
function ReviewDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const conversation = useCurrentConversation();
  const cwd = conversation?.cwd || '';
  const startReview = useChatStore((state) => state.startReview);
  const busy = conversation?.status === 'streaming';
  const [step, setStep] = useState<ReviewStep>('menu');
  const [branches, setBranches] = useState<GitBranchInfo[]>([]);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [instructions, setInstructions] = useState('');
  const [query, setQuery] = useState('');
  const [isRepo, setIsRepo] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep('menu');
    setInstructions('');
    setQuery('');
    setError(null);
    let cancelled = false;
    void (async () => {
      if (!cwd) {
        setIsRepo(false);
        return;
      }
      try {
        const status = await gitStatus(cwd);
        if (!cancelled) setIsRepo(status.isRepository);
      } catch {
        if (!cancelled) setIsRepo(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, cwd]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: WindowEventMap['keydown']) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const launch = (request: ReviewRequest) => {
    startReview(request).catch(() => undefined);
    onClose();
  };

  const openBase = async () => {
    setStep('base');
    setQuery('');
    setError(null);
    setLoading(true);
    try {
      setBranches(await gitBranches(cwd));
    } catch (err) {
      setError(stringifyError(err));
    } finally {
      setLoading(false);
    }
  };

  const openCommit = async () => {
    setStep('commit');
    setQuery('');
    setError(null);
    setLoading(true);
    try {
      setCommits(await gitRecentCommits(cwd, 30));
    } catch (err) {
      setError(stringifyError(err));
    } finally {
      setLoading(false);
    }
  };

  const normalizedQuery = query.trim().toLowerCase();
  const filteredBranches = normalizedQuery
    ? branches.filter((item) => item.name.toLowerCase().includes(normalizedQuery))
    : branches;
  const filteredCommits = normalizedQuery
    ? commits.filter((item) =>
        `${item.shortSha} ${item.subject} ${item.author}`.toLowerCase().includes(normalizedQuery),
      )
    : commits;

  const header = (
    <header className="review-dialog-head">
      {step === 'menu' ? (
        <span className="review-dialog-icon"><GitPullRequest size={18} /></span>
      ) : (
        <button type="button" className="icon-mini" onClick={() => setStep('menu')} aria-label="返回"><ChevronLeft size={16} /></button>
      )}
      <div className="review-dialog-title">
        <strong>变更审查</strong>
        <span>{cwd ? basename(cwd) || shortenPath(cwd) : '未绑定品牌目录'}</span>
      </div>
      <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭"><X size={15} /></button>
    </header>
  );

  let body: ReactNode;
  if (isRepo === false) {
    body = (
      <div className="review-dialog-empty">
        <AlertCircle size={20} />
        <p>{cwd ? `${basename(cwd)} 没有可用的版本记录，无法进行变更审查。` : '当前对话尚未绑定品牌目录。请先在输入框下方选择一个品牌目录。'}</p>
      </div>
    );
  } else if (step === 'menu') {
    body = (
      <div className="review-preset-list">
        <button type="button" className="review-preset" disabled={busy} onClick={() => launch({ kind: 'uncommitted', label: '审查未提交的更改' })}>
          <span className="review-preset-icon"><FileCode2 size={17} /></span>
          <span className="review-preset-text">
            <strong>审查未提交的更改</strong>
            <span>检查已暂存、未暂存以及未跟踪的新文件</span>
          </span>
          <ChevronRight size={15} className="review-preset-chevron" />
        </button>
        <button type="button" className="review-preset" disabled={busy} onClick={() => void openBase()}>
          <span className="review-preset-icon"><GitBranch size={17} /></span>
          <span className="review-preset-text">
            <strong>对比基础分支审查</strong>
            <span>选择一个分支，审查当前分支相对它的改动</span>
          </span>
          <ChevronRight size={15} className="review-preset-chevron" />
        </button>
        <button type="button" className="review-preset" disabled={busy} onClick={() => void openCommit()}>
          <span className="review-preset-icon"><GitCommitHorizontal size={17} /></span>
          <span className="review-preset-text">
            <strong>审查某次提交</strong>
            <span>从最近的提交中选择一个进行审查</span>
          </span>
          <ChevronRight size={15} className="review-preset-chevron" />
        </button>
        <button type="button" className="review-preset" disabled={busy} onClick={() => setStep('custom')}>
          <span className="review-preset-icon"><Sparkles size={17} /></span>
          <span className="review-preset-text">
            <strong>自定义审查指令</strong>
            <span>用你自己的话指定审查重点（如“关注安全性”）</span>
          </span>
          <ChevronRight size={15} className="review-preset-chevron" />
        </button>
      </div>
    );
  } else if (step === 'base') {
    body = (
      <div className="review-pick">
        <div className="branch-search">
          <Search size={13} />
          <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索分支" spellCheck={false} />
        </div>
        <div className="review-pick-list">
          {loading ? (
            <div className="review-pick-empty"><Loader2 size={14} className="spin" />加载分支…</div>
          ) : filteredBranches.length === 0 ? (
            <div className="review-pick-empty">{branches.length === 0 ? '没有可用分支' : '没有匹配的分支'}</div>
          ) : (
            filteredBranches.map((branch) => (
              <button key={branch.name} type="button" className="review-pick-row" disabled={busy} onClick={() => launch({ kind: 'base', target: branch.name, label: `审查：对比分支 ${branch.name}` })}>
                <GitBranch size={14} />
                <span className="review-pick-main">{branch.name}{branch.current ? ' （当前）' : ''}</span>
                {branch.upstream && <span className="review-pick-sub">{branch.upstream}</span>}
              </button>
            ))
          )}
        </div>
      </div>
    );
  } else if (step === 'commit') {
    body = (
      <div className="review-pick">
        <div className="branch-search">
          <Search size={13} />
          <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索提交" spellCheck={false} />
        </div>
        <div className="review-pick-list">
          {loading ? (
            <div className="review-pick-empty"><Loader2 size={14} className="spin" />加载提交…</div>
          ) : filteredCommits.length === 0 ? (
            <div className="review-pick-empty">{commits.length === 0 ? '没有提交记录' : '没有匹配的提交'}</div>
          ) : (
            filteredCommits.map((commit) => (
              <button key={commit.sha} type="button" className="review-pick-row commit" disabled={busy} onClick={() => launch({ kind: 'commit', target: commit.sha, commitSubject: commit.subject, label: `审查提交 ${commit.shortSha}` })}>
                <span className="review-commit-sha">{commit.shortSha}</span>
                <span className="review-pick-main">{commit.subject}</span>
                <span className="review-pick-sub">{commit.author} · {commit.relativeDate}</span>
              </button>
            ))
          )}
        </div>
      </div>
    );
  } else {
    const trimmed = instructions.trim();
    body = (
      <div className="review-custom">
        <textarea
          autoFocus
          value={instructions}
          onChange={(event) => setInstructions(event.target.value)}
          placeholder="例如：重点关注并发安全和错误处理；忽略样式问题。"
          rows={4}
        />
        <p className="review-custom-hint">将按你的指令审查未提交的更改。</p>
        <div className="review-custom-actions">
          <button type="button" className="auth-btn ghost" onClick={() => setStep('menu')}>返回</button>
          <button type="button" className="auth-btn primary" disabled={!trimmed || busy} onClick={() => launch({ kind: 'custom', label: '自定义审查', instructions: trimmed })}>开始审查</button>
        </div>
      </div>
    );
  }

  return (
    <div className="dialog-layer review-layer" role="presentation">
      <button className="dialog-backdrop" type="button" aria-label="关闭审查" onClick={onClose} />
      <section className="review-dialog" role="dialog" aria-modal="true" aria-label="变更审查">
        {header}
        {error && <div className="review-dialog-error"><AlertCircle size={13} />{error}</div>}
        {busy && <div className="review-dialog-note"><Loader2 size={13} className="spin" />当前对话正在运行，请等待完成后再发起审查。</div>}
        {body}
      </section>
    </div>
  );
}

const REVIEW_PRIORITY_META: Record<string, { short: string; label: string; tone: string }> = {
  P0: { short: 'P0', label: 'P0 严重', tone: 'p0' },
  P1: { short: 'P1', label: 'P1 重要', tone: 'p1' },
  P2: { short: 'P2', label: 'P2 一般', tone: 'p2' },
  P3: { short: 'P3', label: 'P3 优化', tone: 'p3' },
};

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text.trim());
  } catch {
    return null;
  }
}

function normalizeReviewFinding(value: unknown): ReviewFinding | null {
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  const title = typeof obj.title === 'string' ? obj.title.trim() : '';
  const body = typeof obj.body === 'string' ? obj.body.trim() : '';
  if (!title && !body) return null;
  const rawPriority = obj.priority;
  const priority = rawPriority === 'P0' || rawPriority === 'P1' || rawPriority === 'P3' ? rawPriority : 'P2';
  const num = (input: unknown) => (typeof input === 'number' && Number.isFinite(input) ? input : undefined);
  return {
    priority,
    title: title || '（无标题）',
    body,
    file: typeof obj.file === 'string' && obj.file.trim() ? obj.file.trim() : undefined,
    lineStart: num(obj.lineStart),
    lineEnd: num(obj.lineEnd),
    confidence: num(obj.confidence),
    suggestion: typeof obj.suggestion === 'string' && obj.suggestion.trim() ? obj.suggestion : undefined,
  };
}

function normalizeReviewReport(value: unknown): ReviewReport | null {
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  const hasFindings = Array.isArray(obj.findings);
  const hasVerdict = obj.verdict === 'correct' || obj.verdict === 'incorrect';
  if (!hasFindings && !hasVerdict) return null;
  const findings = (hasFindings ? (obj.findings as unknown[]) : [])
    .map(normalizeReviewFinding)
    .filter((item): item is ReviewFinding => item !== null);
  return {
    verdict: obj.verdict === 'correct' ? 'correct' : obj.verdict === 'incorrect' ? 'incorrect' : 'unknown',
    summary: typeof obj.summary === 'string' ? obj.summary.trim() : '',
    findings,
  };
}

// Splits a review turn's streamed text into human prose and the structured
// findings JSON the prompt asks for. While the JSON fence is still streaming
// (no closing ```), we hide it so the user never sees raw JSON.
function parseReviewOutput(text: string): { prose: string; report: ReviewReport | null } {
  const fenceRe = /```json\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  let lastJson: string | null = null;
  let lastStart = -1;
  let lastEnd = -1;
  while ((match = fenceRe.exec(text)) !== null) {
    lastJson = match[1];
    lastStart = match.index;
    lastEnd = fenceRe.lastIndex;
  }
  if (lastJson !== null) {
    const report = normalizeReviewReport(safeJsonParse(lastJson));
    if (report) {
      return { prose: `${text.slice(0, lastStart)}${text.slice(lastEnd)}`.trim(), report };
    }
    return { prose: text, report: null };
  }
  const openIdx = text.search(/```json/i);
  if (openIdx >= 0) {
    return { prose: text.slice(0, openIdx).trim(), report: null };
  }
  // Fallback for a bare JSON object emitted without a fence.
  if (!text.includes('```') && text.includes('"findings"')) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      const report = normalizeReviewReport(safeJsonParse(text.slice(start, end + 1)));
      if (report) return { prose: text.slice(0, start).trim(), report };
    }
  }
  return { prose: text, report: null };
}

function joinPath(base: string, rel: string): string {
  return `${base.replace(/[\\/]+$/, '')}/${rel.replace(/^[\\/]+/, '')}`;
}

function ReviewRequestChip({ request }: { request: ReviewRequest }) {
  const icon = request.kind === 'base'
    ? <GitBranch size={13} />
    : request.kind === 'commit'
      ? <GitCommitHorizontal size={13} />
      : request.kind === 'custom'
        ? <Sparkles size={13} />
        : <GitPullRequest size={13} />;
  return (
    <div className="review-request-chip" title={request.instructions || request.label}>
      <span className="review-request-icon">{icon}</span>
      <span className="review-request-text">
        <span className="review-request-title">{request.label}</span>
        {request.instructions && <span className="review-request-sub">{request.instructions}</span>}
      </span>
    </div>
  );
}

function ReviewBody({ message, cwd }: { message: ChatMessage; cwd: string }) {
  const streaming = Boolean(message.isStreaming);
  const textContent = message.blocks
    .filter((block): block is Extract<MessageBlock, { type: 'text' }> => block.type === 'text')
    .map((block) => block.content)
    .join('');
  const parsed = useMemo(() => parseReviewOutput(textContent), [textContent]);
  const lastBlockIndex = message.blocks.length - 1;
  const units = buildRenderUnits(message.blocks).filter(
    (unit) => unit.type === 'command-group' || unit.block.type !== 'text',
  );
  return (
    <div className="review-body">
      {units.map((unit) =>
        unit.type === 'command-group'
          ? (unit.blocks.length === 1
              ? <BlockRenderer key={`tool-${unit.startIndex}`} block={unit.blocks[0]} />
              : <CommandGroup key={`cmd-group-${unit.startIndex}`} blocks={unit.blocks} />)
          : <BlockRenderer key={`${unit.block.type}-${unit.index}`} block={unit.block} streaming={streaming && unit.index === lastBlockIndex} />,
      )}
      {parsed.prose && (
        <div className={`markdown-content ${streaming && !parsed.report ? 'streaming' : ''}`}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{parsed.prose}</ReactMarkdown>
        </div>
      )}
      {parsed.report && <ReviewReportCard report={parsed.report} cwd={cwd} />}
    </div>
  );
}

function ReviewReportCard({ report, cwd }: { report: ReviewReport; cwd: string }) {
  const counts: Record<string, number> = { P0: 0, P1: 0, P2: 0, P3: 0 };
  for (const finding of report.findings) counts[finding.priority] = (counts[finding.priority] || 0) + 1;
  const ok = report.verdict === 'correct';
  const bad = report.verdict === 'incorrect';
  return (
    <section className="review-report">
      <header className={`review-verdict ${ok ? 'ok' : bad ? 'bad' : 'unknown'}`}>
        <span className="review-verdict-icon">{ok ? <ShieldCheck size={18} /> : bad ? <AlertTriangle size={18} /> : <Info size={18} />}</span>
        <div className="review-verdict-text">
          <strong>{ok ? '可以合入（Patch is correct）' : bad ? '存在需要解决的问题（Patch is incorrect）' : '审查完成'}</strong>
          {report.summary && <span>{report.summary}</span>}
        </div>
      </header>
      {report.findings.length > 0 ? (
        <>
          <div className="review-finding-stats">
            {(['P0', 'P1', 'P2', 'P3']).map((priority) =>
              counts[priority] ? (
                <span key={priority} className={`review-badge ${REVIEW_PRIORITY_META[priority].tone}`}>
                  {priority} · {counts[priority]}
                </span>
              ) : null,
            )}
          </div>
          <div className="review-finding-list">
            {report.findings.map((finding, index) => (
              <ReviewFindingCard key={`${finding.title}-${index}`} finding={finding} cwd={cwd} />
            ))}
          </div>
        </>
      ) : (
        <div className="review-clean"><Check size={15} />未发现需要修复的问题。</div>
      )}
    </section>
  );
}

function ReviewFindingCard({ finding, cwd }: { finding: ReviewFinding; cwd: string }) {
  const meta = REVIEW_PRIORITY_META[finding.priority] || REVIEW_PRIORITY_META.P2;
  const location = finding.file
    ? `${finding.file}${finding.lineStart ? `:${finding.lineStart}${finding.lineEnd && finding.lineEnd !== finding.lineStart ? `-${finding.lineEnd}` : ''}` : ''}`
    : '';
  const canOpen = Boolean(finding.file && cwd);
  return (
    <article className={`review-finding ${meta.tone}`}>
      <div className="review-finding-head">
        <span className={`review-badge ${meta.tone}`} title={meta.label}>{finding.priority}</span>
        <span className="review-finding-title">{finding.title}</span>
        {typeof finding.confidence === 'number' && (
          <span className="review-confidence" title="审查器置信度">{Math.round(finding.confidence * 100)}%</span>
        )}
      </div>
      {location && (
        <button
          type="button"
          className="review-finding-loc"
          disabled={!canOpen}
          title={canOpen ? '在文件管理器中显示' : undefined}
          onClick={() => { if (finding.file && cwd) void revealPath(joinPath(cwd, finding.file)); }}
        >
          <FileCode2 size={12} />{location}
        </button>
      )}
      {finding.body && (
        <div className="review-finding-body markdown-content">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{finding.body}</ReactMarkdown>
        </div>
      )}
      {finding.suggestion && (
        <div className="review-suggestion">
          <div className="review-suggestion-head"><Sparkles size={12} />建议修改</div>
          <pre>{finding.suggestion}</pre>
        </div>
      )}
    </article>
  );
}

type DiffLineType = 'add' | 'del' | 'context';

interface DiffSegment {
  text: string;
  changed: boolean;
}

interface DiffLine {
  type: DiffLineType;
  oldNo: number | null;
  newNo: number | null;
  text: string;
  // Word-level pieces, set on paired del/add lines so we can highlight only the
  // characters that actually changed instead of the whole line.
  segments?: DiffSegment[];
}

interface DiffHunk {
  header: string;
  // Verbatim hunk text (the `@@` line plus its body) used to build a patch that
  // `git apply --cached` can stage or unstage on its own.
  rawText: string;
  oldStart: number;
  newStart: number;
  oldEnd: number;
  newEnd: number;
  lines: DiffLine[];
}

interface ParsedDiff {
  // Verbatim file header (diff --git / index / --- / +++) for patch building.
  fileHeader: string;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
  binary: boolean;
}

const WORD_TOKEN_RE = /(\s+|[A-Za-z0-9_]+|[^\sA-Za-z0-9_])/g;

function tokenizeLine(value: string): string[] {
  return value.match(WORD_TOKEN_RE) ?? [];
}

// Token-level diff (LCS) between a removed and an added line so the UI can
// underline just the changed words, the way Codex/Cursor inline diffs do.
function diffTokens(a: string, b: string): { left: DiffSegment[]; right: DiffSegment[] } {
  const at = tokenizeLine(a);
  const bt = tokenizeLine(b);
  if (at.length > 400 || bt.length > 400) {
    return { left: [{ text: a, changed: true }], right: [{ text: b, changed: true }] };
  }
  const n = at.length;
  const m = bt.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let x = n - 1; x >= 0; x--) {
    for (let y = m - 1; y >= 0; y--) {
      dp[x][y] = at[x] === bt[y] ? dp[x + 1][y + 1] + 1 : Math.max(dp[x + 1][y], dp[x][y + 1]);
    }
  }
  const left: DiffSegment[] = [];
  const right: DiffSegment[] = [];
  const push = (arr: DiffSegment[], text: string, changed: boolean) => {
    const last = arr[arr.length - 1];
    if (last && last.changed === changed) last.text += text;
    else arr.push({ text, changed });
  };
  let x = 0;
  let y = 0;
  while (x < n && y < m) {
    if (at[x] === bt[y]) {
      push(left, at[x], false);
      push(right, bt[y], false);
      x += 1;
      y += 1;
    } else if (dp[x + 1][y] >= dp[x][y + 1]) {
      push(left, at[x], true);
      x += 1;
    } else {
      push(right, bt[y], true);
      y += 1;
    }
  }
  while (x < n) push(left, at[x++], true);
  while (y < m) push(right, bt[y++], true);
  return { left, right };
}

// Annotate consecutive del→add runs with word-level segments in place.
function annotateWordDiff(lines: DiffLine[]) {
  let i = 0;
  while (i < lines.length) {
    if (lines[i].type !== 'del') {
      i += 1;
      continue;
    }
    let j = i;
    while (j < lines.length && lines[j].type === 'del') j += 1;
    let k = j;
    while (k < lines.length && lines[k].type === 'add') k += 1;
    const pairs = Math.min(j - i, k - j);
    for (let p = 0; p < pairs; p++) {
      const { left, right } = diffTokens(lines[i + p].text, lines[j + p].text);
      lines[i + p].segments = left;
      lines[j + p].segments = right;
    }
    i = k;
  }
}

interface SplitRow {
  left: DiffLine | null;
  right: DiffLine | null;
}

// Rearrange a hunk's lines into side-by-side rows: context spans both columns,
// while removed/added runs are paired left/right.
function buildSplitRows(lines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.type === 'context') {
      rows.push({ left: line, right: line });
      i += 1;
      continue;
    }
    if (line.type === 'del') {
      let j = i;
      while (j < lines.length && lines[j].type === 'del') j += 1;
      let k = j;
      while (k < lines.length && lines[k].type === 'add') k += 1;
      const dels = lines.slice(i, j);
      const adds = lines.slice(j, k);
      const max = Math.max(dels.length, adds.length);
      for (let p = 0; p < max; p++) rows.push({ left: dels[p] ?? null, right: adds[p] ?? null });
      i = k;
      continue;
    }
    rows.push({ left: null, right: line });
    i += 1;
  }
  return rows;
}

// Parse a single-file `git diff` payload into hunks with old/new line numbers so
// the review panel can render an inline, Cursor-style diff instead of raw text.
function parseUnifiedDiff(diff: string): ParsedDiff {
  const hunks: DiffHunk[] = [];
  const headerLines: string[] = [];
  let additions = 0;
  let deletions = 0;
  let binary = false;
  if (!diff) return { fileHeader: '', hunks, additions, deletions, binary };

  let current: DiffHunk | null = null;
  let rawLines: string[] = [];
  let seenHunk = false;
  let oldNo = 0;
  let newNo = 0;

  const flush = () => {
    if (current) {
      current.rawText = rawLines.join('\n');
      annotateWordDiff(current.lines);
    }
  };

  for (const raw of diff.split('\n')) {
    if (raw.startsWith('@@')) {
      flush();
      seenHunk = true;
      const match = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/.exec(raw);
      if (match) {
        oldNo = Number(match[1]);
        newNo = Number(match[2]);
        current = {
          header: match[3].trim(),
          rawText: '',
          oldStart: oldNo,
          newStart: newNo,
          oldEnd: oldNo,
          newEnd: newNo,
          lines: [],
        };
        rawLines = [raw];
        hunks.push(current);
      } else {
        current = null;
        rawLines = [];
      }
      continue;
    }
    if (!seenHunk) {
      // File header region (diff --git / index / --- / +++ / binary marker).
      if (raw.startsWith('Binary files') || raw.startsWith('GIT binary patch')) binary = true;
      headerLines.push(raw);
      continue;
    }
    if (!current) continue;
    rawLines.push(raw);
    if (raw.startsWith('Binary files') || raw.startsWith('GIT binary patch')) {
      binary = true;
      continue;
    }
    if (raw.startsWith('+')) {
      current.lines.push({ type: 'add', oldNo: null, newNo, text: raw.slice(1) });
      current.newEnd = newNo;
      newNo += 1;
      additions += 1;
    } else if (raw.startsWith('-')) {
      current.lines.push({ type: 'del', oldNo, newNo: null, text: raw.slice(1) });
      current.oldEnd = oldNo;
      oldNo += 1;
      deletions += 1;
    } else if (raw.startsWith('\\')) {
      // "\ No newline at end of file" — metadata, skip.
    } else {
      const text = raw.startsWith(' ') ? raw.slice(1) : raw;
      current.lines.push({ type: 'context', oldNo, newNo, text });
      current.oldEnd = oldNo;
      current.newEnd = newNo;
      oldNo += 1;
      newNo += 1;
    }
  }
  flush();
  return { fileHeader: headerLines.join('\n'), hunks, additions, deletions, binary };
}

// Builds a standalone patch (header + one hunk) so a single block can be staged
// or unstaged with `git apply --cached`.
function buildHunkPatch(parsed: ParsedDiff, hunk: DiffHunk): string {
  const header = parsed.fileHeader.trim();
  return `${header}\n${hunk.rawText}\n`;
}

type ContextRegion =
  | { kind: 'lines'; lines: DiffLine[] }
  | { kind: 'gap'; id: number; lines: DiffLine[] };

// Splits a full-context hunk into visible blocks (changes plus `pad` lines of
// surrounding context) and collapsible "unmodified" gaps the user can expand,
// matching GitHub/Codex-style review diffs.
function buildContextRegions(lines: DiffLine[], pad = 3): ContextRegion[] {
  const n = lines.length;
  const keep = new Array<boolean>(n).fill(false);
  for (let i = 0; i < n; i++) {
    if (lines[i].type !== 'context') {
      for (let j = Math.max(0, i - pad); j <= Math.min(n - 1, i + pad); j++) keep[j] = true;
    }
  }
  const regions: ContextRegion[] = [];
  let i = 0;
  while (i < n) {
    const start = i;
    if (keep[i]) {
      while (i < n && keep[i]) i += 1;
      regions.push({ kind: 'lines', lines: lines.slice(start, i) });
    } else {
      while (i < n && !keep[i]) i += 1;
      const slice = lines.slice(start, i);
      // Tiny gaps aren't worth a collapse affordance — just show them.
      if (slice.length <= 1) regions.push({ kind: 'lines', lines: slice });
      else regions.push({ kind: 'gap', id: start, lines: slice });
    }
  }
  return regions;
}

interface FileDiffState {
  change: GitFileChange;
  raw: string;
  parsed: ParsedDiff;
  // Whether the rendered diff reflects the staged (index) side. Determines
  // whether a per-hunk action stages (forward) or unstages (reverse) the block.
  showingStaged: boolean;
  error?: string;
}

type ReviewStatusFilter = 'all' | 'staged' | 'unstaged';
type ReviewViewMode = 'unified' | 'split';

const REVIEW_VIEW_KEY = 'alpha:review-view-mode';

const REVIEW_CONTEXT_LINES = 100000;
const DISCARD_ALL_KEY = '__all__';

// "审查 / 查看代码更改" — a two-pane review workspace (reference-style): a top
// toolbar with a status selector, totals, commit/push and create-PR actions; a
// left diff column with word-level highlights, per-hunk staging, discard,
// "mark viewed" and expandable unchanged-context; and a right file-tree.
function ReviewChangesPanel() {
  const conversation = useCurrentConversation();
  const cwd = conversation?.cwd || '';
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [diffs, setDiffs] = useState<Record<string, FileDiffState>>({});
  const [fullDiffs, setFullDiffs] = useState<Record<string, ParsedDiff | 'loading'>>({});
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [viewed, setViewed] = useState<Record<string, boolean>>({});
  const [expandedRegions, setExpandedRegions] = useState<Record<string, boolean>>({});
  const [folderCollapsed, setFolderCollapsed] = useState<Record<string, boolean>>({});
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<ReviewStatusFilter>('all');
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [commitOpen, setCommitOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ReviewViewMode>(() => {
    if (typeof window === 'undefined') return 'unified';
    return window.localStorage.getItem(REVIEW_VIEW_KEY) === 'split' ? 'split' : 'unified';
  });
  const [commitMessage, setCommitMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRefs = useRef<Record<string, HTMLElement | null>>({});
  const diffsRef = useRef(diffs);
  diffsRef.current = diffs;
  const fullDiffsRef = useRef(fullDiffs);
  fullDiffsRef.current = fullDiffs;

  useEffect(() => {
    window.localStorage.setItem(REVIEW_VIEW_KEY, viewMode);
  }, [viewMode]);

  const refresh = useCallback(async () => {
    if (!cwd) {
      setStatus({ cwd: '', isRepository: false, ahead: 0, behind: 0, clean: true, changes: [], error: '当前对话未绑定品牌目录。' });
      setDiffs({});
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await gitStatus(cwd);
      setStatus(next);
      setFullDiffs({});
      setExpandedRegions({});
      if (!next.isRepository) {
        setDiffs({});
        return;
      }
      const entries = await Promise.all(
        next.changes.map(async (change): Promise<readonly [string, FileDiffState]> => {
          const untracked = change.status === 'untracked';
          const showingStaged = !untracked && change.staged && !change.unstaged;
          try {
            const raw = untracked
              ? await gitDiff(cwd, change.path, false, true)
              : await gitDiff(cwd, change.path, showingStaged);
            return [change.path, { change, raw, parsed: parseUnifiedDiff(raw), showingStaged }] as const;
          } catch (err) {
            return [change.path, { change, raw: '', parsed: parseUnifiedDiff(''), showingStaged, error: stringifyError(err) }] as const;
          }
        }),
      );
      const present = new Set(entries.map(([path]) => path));
      setDiffs(Object.fromEntries(entries));
      setCollapsed((prev) => {
        const merged: Record<string, boolean> = {};
        for (const [path, state] of entries) {
          // Auto-collapse very large diffs (e.g. lockfiles) so the panel stays snappy.
          merged[path] = path in prev ? prev[path] : state.parsed.additions + state.parsed.deletions > 600;
        }
        return merged;
      });
      // Drop transient marks for files that no longer have pending changes.
      setViewed((prev) => {
        const merged: Record<string, boolean> = {};
        for (const path of Object.keys(prev)) if (present.has(path)) merged[path] = prev[path];
        return merged;
      });
      setSelectedFile((prev) => (prev && present.has(prev) ? prev : null));
    } catch (err) {
      setError(stringifyError(err));
    } finally {
      setBusy(false);
    }
  }, [cwd]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const runGit = useCallback(
    async (action: () => Promise<unknown>) => {
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
    },
    [refresh],
  );

  // Lazily fetch a file's full-context diff so unchanged regions can be expanded.
  const requestFullContext = useCallback(
    (path: string) => {
      if (fullDiffsRef.current[path]) return;
      const state = diffsRef.current[path];
      if (!state || state.error || state.parsed.binary || state.change.status === 'untracked') return;
      setFullDiffs((prev) => ({ ...prev, [path]: 'loading' }));
      void (async () => {
        try {
          const raw = await gitDiff(cwd, path, state.showingStaged, false, REVIEW_CONTEXT_LINES);
          setFullDiffs((prev) => ({ ...prev, [path]: parseUnifiedDiff(raw) }));
        } catch {
          setFullDiffs((prev) => {
            const nextDiffs = { ...prev };
            delete nextDiffs[path];
            return nextDiffs;
          });
        }
      })();
    },
    [cwd],
  );

  const changes = status?.changes ?? [];
  const totals = useMemo(() => {
    let add = 0;
    let del = 0;
    for (const state of Object.values(diffs)) {
      add += state.parsed.additions;
      del += state.parsed.deletions;
    }
    return { add, del };
  }, [diffs]);
  const stagedCount = changes.filter((change) => change.staged).length;
  const unstagedCount = changes.filter((change) => change.unstaged || change.status === 'untracked').length;

  const normalizedFilter = filter.trim().toLowerCase();
  const visibleChanges = useMemo(
    () =>
      changes.filter((change) => {
        if (statusFilter === 'staged' && !change.staged) return false;
        if (statusFilter === 'unstaged' && !(change.unstaged || change.status === 'untracked')) return false;
        if (normalizedFilter && !change.path.toLowerCase().includes(normalizedFilter)) return false;
        return true;
      }),
    [changes, statusFilter, normalizedFilter],
  );
  const tree = useMemo(() => buildFileTree(visibleChanges), [visibleChanges]);

  const branch = status?.branch || '';
  const ahead = status?.ahead ?? 0;
  const behind = status?.behind ?? 0;
  const statusLabel = statusFilter === 'all' ? '全部' : statusFilter === 'staged' ? '已暂存' : '未暂存';
  const statusCount = statusFilter === 'all' ? changes.length : statusFilter === 'staged' ? stagedCount : unstagedCount;

  const toggleViewed = (path: string) => {
    setViewed((prev) => {
      const nowViewed = !prev[path];
      setCollapsed((c) => ({ ...c, [path]: nowViewed }));
      return { ...prev, [path]: nowViewed };
    });
  };

  const selectFile = (path: string) => {
    setSelectedFile(path);
    setCollapsed((prev) => ({ ...prev, [path]: false }));
    requestAnimationFrame(() => {
      fileRefs.current[path]?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
  };

  const stageAll = () => void runGit(() => gitStage(cwd, changes.map((change) => change.path)));
  const unstageAll = () => void runGit(() => gitUnstage(cwd, changes.filter((change) => change.staged).map((change) => change.path)));
  const discardAll = () => { setConfirmDiscard(null); void runGit(() => gitDiscard(cwd, changes.map((change) => change.path))); };
  const createPullRequest = () => void runGit(() => ghPrCreateWeb(cwd));

  return (
    <aside className="review-panel right-dock-panel wide">
      <header className="panel-header" data-tauri-drag-region>
        <div data-tauri-drag-region>
          <h2>审查更改</h2>
          <span>{cwd ? shortenPath(cwd) : '未指定品牌目录'}</span>
        </div>
      </header>

      {status?.isRepository ? (
        <>
          <div className="review-topbar">
            <div className="review-status">
              <button type="button" className="review-status-btn" onClick={() => setStatusMenuOpen((open) => !open)}>
                <span>{statusLabel}</span>
                <strong>{statusCount}</strong>
                <ChevronDown size={13} />
              </button>
              {statusMenuOpen && (
                <>
                  <div className="review-status-backdrop" onClick={() => setStatusMenuOpen(false)} />
                  <div className="review-status-menu">
                    <button type="button" className={statusFilter === 'all' ? 'active' : ''} onClick={() => { setStatusFilter('all'); setStatusMenuOpen(false); }}>全部<span>{changes.length}</span></button>
                    <button type="button" className={statusFilter === 'staged' ? 'active' : ''} onClick={() => { setStatusFilter('staged'); setStatusMenuOpen(false); }}>已暂存<span>{stagedCount}</span></button>
                    <button type="button" className={statusFilter === 'unstaged' ? 'active' : ''} onClick={() => { setStatusFilter('unstaged'); setStatusMenuOpen(false); }}>未暂存<span>{unstagedCount}</span></button>
                  </div>
                </>
              )}
            </div>
            <span className="review-totals"><span className="add">+{totals.add}</span><span className="del">-{totals.del}</span></span>
            {branch && <span className="review-branch" title={status.upstream || branch}><GitBranch size={12} />{branch}</span>}
            {behind > 0 && <span className="review-track" title={`落后远端 ${behind}`}><Download size={11} />{behind}</span>}
            {ahead > 0 && <span className="review-track" title={`领先远端 ${ahead}`}><Upload size={11} />{ahead}</span>}
            <span className="review-toolbar-spacer" />
            <div className="review-viewtoggle" role="group" aria-label="差异视图">
              <button type="button" className={viewMode === 'unified' ? 'active' : ''} onClick={() => setViewMode('unified')} title="单栏视图"><FileDiff size={13} /></button>
              <button type="button" className={viewMode === 'split' ? 'active' : ''} onClick={() => setViewMode('split')} title="分栏视图"><Columns2 size={13} /></button>
            </div>
            <button type="button" className="icon-mini" onClick={() => void refresh()} disabled={busy} title="刷新"><RefreshCw size={14} className={busy ? 'spin' : ''} /></button>
            <button type="button" className={`panel-btn ${commitOpen ? 'primary' : ''}`} onClick={() => setCommitOpen((open) => !open)} disabled={changes.length === 0}><GitCommitHorizontal size={13} />提交或推送</button>
            <button type="button" className="panel-btn" onClick={createPullRequest} disabled={busy} title="gh pr create --web"><GitPullRequest size={13} />创建拉取请求</button>
          </div>

          {error && <div className="panel-error"><AlertCircle size={14} />{error}</div>}

          <div className="review-split">
            <div className="review-pane">
              <div className="review-scroll" ref={scrollRef}>
                {commitOpen && (
                  <div className="review-commit">
                    <textarea
                      value={commitMessage}
                      onChange={(event) => setCommitMessage(event.target.value)}
                      placeholder={stagedCount > 0 ? '提交信息（描述这次改动）' : '先暂存文件，再填写提交信息'}
                      rows={2}
                      spellCheck={false}
                    />
                    <div className="review-commit-row">
                      <button
                        type="button"
                        className="panel-btn primary"
                        disabled={!commitMessage.trim() || stagedCount === 0 || busy}
                        onClick={() => void runGit(async () => { await gitCommit(cwd, commitMessage); setCommitMessage(''); })}
                        title={stagedCount === 0 ? '没有已暂存的更改' : undefined}
                      >
                        <GitCommitHorizontal size={13} />提交{stagedCount > 0 ? ` (${stagedCount})` : ''}
                      </button>
                      <button
                        type="button"
                        className="panel-btn"
                        disabled={!commitMessage.trim() || stagedCount === 0 || busy}
                        onClick={() => void runGit(async () => { await gitCommit(cwd, commitMessage); setCommitMessage(''); await gitPush(cwd, !status.upstream); })}
                      >
                        <Upload size={13} />提交并推送
                      </button>
                      <button type="button" className="icon-mini" disabled={busy} onClick={() => void runGit(() => gitPull(cwd))} title="拉取"><Download size={13} /></button>
                      <button type="button" className="icon-mini" disabled={busy} onClick={() => void runGit(() => gitPush(cwd, !status.upstream))} title="推送"><Upload size={13} /></button>
                    </div>
                  </div>
                )}

                <div className="review-files">
                  {changes.length === 0 ? (
                    <div className="review-clean-state"><CheckCheck size={20} /><strong>工作区干净</strong><span>没有需要审查的更改。</span></div>
                  ) : visibleChanges.length === 0 ? (
                    <div className="git-empty">没有匹配的文件。</div>
                  ) : (
                    visibleChanges.map((change) => {
                      const state = diffs[change.path];
                      return (
                        <ReviewFileDiff
                          key={`${change.path}-${change.indexStatus}-${change.workingTreeStatus}`}
                          change={change}
                          state={state}
                          fullState={fullDiffs[change.path]}
                          collapsed={collapsed[change.path] ?? false}
                          viewed={viewed[change.path] ?? false}
                          selected={selectedFile === change.path}
                          viewMode={viewMode}
                          busy={busy}
                          confirmDiscard={confirmDiscard === change.path}
                          expandedRegions={expandedRegions}
                          registerRef={(el) => { fileRefs.current[change.path] = el; }}
                          requestFullContext={requestFullContext}
                          onToggle={() => setCollapsed((prev) => ({ ...prev, [change.path]: !(prev[change.path] ?? false) }))}
                          onToggleViewed={() => toggleViewed(change.path)}
                          onToggleRegion={(key) => setExpandedRegions((prev) => ({ ...prev, [key]: !prev[key] }))}
                          onStage={() => void runGit(() => gitStage(cwd, [change.path]))}
                          onUnstage={() => void runGit(() => gitUnstage(cwd, [change.path]))}
                          onStageHunk={(hunk) => state && void runGit(() => gitApplyPatch(cwd, buildHunkPatch(state.parsed, hunk), false))}
                          onUnstageHunk={(hunk) => state && void runGit(() => gitApplyPatch(cwd, buildHunkPatch(state.parsed, hunk), true))}
                          onRequestDiscard={() => setConfirmDiscard(change.path)}
                          onCancelDiscard={() => setConfirmDiscard(null)}
                          onConfirmDiscard={() => { setConfirmDiscard(null); void runGit(() => gitDiscard(cwd, [change.path])); }}
                          onOpen={() => void revealPath(joinPath(cwd, change.path))}
                        />
                      );
                    })
                  )}
                </div>
              </div>

              {changes.length > 0 && (
                <div className="review-floating">
                  {confirmDiscard === DISCARD_ALL_KEY ? (
                    <>
                      <span className="review-floating-warn"><AlertTriangle size={13} />丢弃全部未提交更改？</span>
                      <button type="button" className="panel-btn danger" disabled={busy} onClick={discardAll}>确认丢弃</button>
                      <button type="button" className="panel-btn" onClick={() => setConfirmDiscard(null)}>取消</button>
                    </>
                  ) : (
                    <>
                      <button type="button" className="panel-btn" disabled={busy} onClick={() => setConfirmDiscard(DISCARD_ALL_KEY)}><Undo2 size={13} />还原全部</button>
                      {stagedCount === changes.length
                        ? <button type="button" className="panel-btn" disabled={busy || stagedCount === 0} onClick={unstageAll}><RotateCcw size={13} />取消暂存全部</button>
                        : <button type="button" className="panel-btn primary" disabled={busy} onClick={stageAll}><Plus size={13} />暂存全部</button>}
                    </>
                  )}
                </div>
              )}
            </div>

            <aside className="review-tree-pane">
              <div className="review-tree-head">
                <Search size={12} />
                <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="筛选文件…" spellCheck={false} />
                {filter && <button type="button" className="review-search-clear" onClick={() => setFilter('')} aria-label="清除筛选"><X size={12} /></button>}
              </div>
              <div className="review-tree-scroll">
                {visibleChanges.length === 0 ? (
                  <div className="review-tree-empty">没有文件</div>
                ) : (
                  <ReviewTree
                    entries={tree}
                    depth={0}
                    folderCollapsed={folderCollapsed}
                    selected={selectedFile}
                    viewed={viewed}
                    diffs={diffs}
                    onToggleFolder={(path) => setFolderCollapsed((prev) => ({ ...prev, [path]: !prev[path] }))}
                    onSelect={selectFile}
                  />
                )}
              </div>
            </aside>
          </div>
        </>
      ) : (
        <div className="git-empty-state">
          <FolderGit2 size={22} />
          <strong>当前品牌目录没有版本记录</strong>
          <span>{status?.error || '请选择一个包含版本记录的品牌目录。'}</span>
          {error && <em>{error}</em>}
        </div>
      )}
    </aside>
  );
}

// Renders one segment-aware diff line's text, underlining only changed words.
function DiffLineText({ line }: { line: DiffLine }) {
  if (line.segments && line.segments.length > 0) {
    return (
      <code className="review-line-text">
        {line.segments.map((seg, index) =>
          seg.changed ? <mark key={index} className="review-word">{seg.text}</mark> : <span key={index}>{seg.text}</span>,
        )}
      </code>
    );
  }
  return <code className="review-line-text">{line.text.length ? line.text : ' '}</code>;
}

function ReviewFileDiff({
  change,
  state,
  fullState,
  collapsed,
  viewed,
  selected,
  viewMode,
  busy,
  confirmDiscard,
  expandedRegions,
  registerRef,
  requestFullContext,
  onToggle,
  onToggleViewed,
  onToggleRegion,
  onStage,
  onUnstage,
  onStageHunk,
  onUnstageHunk,
  onRequestDiscard,
  onCancelDiscard,
  onConfirmDiscard,
  onOpen,
}: {
  change: GitFileChange;
  state: FileDiffState | undefined;
  fullState: ParsedDiff | 'loading' | undefined;
  collapsed: boolean;
  viewed: boolean;
  selected: boolean;
  viewMode: ReviewViewMode;
  busy: boolean;
  confirmDiscard: boolean;
  expandedRegions: Record<string, boolean>;
  registerRef: (el: HTMLElement | null) => void;
  requestFullContext: (path: string) => void;
  onToggle: () => void;
  onToggleViewed: () => void;
  onToggleRegion: (key: string) => void;
  onStage: () => void;
  onUnstage: () => void;
  onStageHunk: (hunk: DiffHunk) => void;
  onUnstageHunk: (hunk: DiffHunk) => void;
  onRequestDiscard: () => void;
  onCancelDiscard: () => void;
  onConfirmDiscard: () => void;
  onOpen: () => void;
}) {
  const parsed = state?.parsed;
  const adds = parsed?.additions ?? 0;
  const dels = parsed?.deletions ?? 0;
  const untracked = change.status === 'untracked';
  const lastSlash = change.path.lastIndexOf('/');
  const dir = lastSlash >= 0 ? change.path.slice(0, lastSlash + 1) : '';
  const name = lastSlash >= 0 ? change.path.slice(lastSlash + 1) : change.path;
  // Per-hunk staging needs a real file header to build a patch; untracked/binary
  // files only support whole-file staging.
  const hunkActionable = Boolean(parsed && parsed.fileHeader && !parsed.binary && !untracked);
  const canExpandContext = Boolean(parsed && !parsed.binary && parsed.hunks.length > 0 && !untracked && !state?.error);

  const full = fullState && fullState !== 'loading' ? fullState : null;
  const fullLines = useMemo(() => (full ? full.hunks.flatMap((hunk) => hunk.lines) : []), [full]);
  const totalOld = useMemo(
    () => fullLines.reduce((max, line) => (line.oldNo != null && line.oldNo > max ? line.oldNo : max), 0),
    [fullLines],
  );

  // Pull a file once it is expanded so unchanged gaps can be revealed.
  useEffect(() => {
    if (!collapsed && canExpandContext) requestFullContext(change.path);
  }, [collapsed, canExpandContext, change.path, requestFullContext]);

  const renderRows = (lines: DiffLine[], keyPrefix: string): ReactNode =>
    viewMode === 'split' ? (
      buildSplitRows(lines).map((row, rowIndex) => (
        <div className="review-srow" key={`${keyPrefix}-${rowIndex}`}>
          <div className={`review-scell ${row.left ? row.left.type : 'empty'}`}>
            <span className="review-ln">{row.left?.oldNo ?? ''}</span>
            {row.left ? <DiffLineText line={row.left} /> : <code className="review-line-text"> </code>}
          </div>
          <div className={`review-scell ${row.right ? row.right.type : 'empty'}`}>
            <span className="review-ln">{row.right?.newNo ?? ''}</span>
            {row.right ? <DiffLineText line={row.right} /> : <code className="review-line-text"> </code>}
          </div>
        </div>
      ))
    ) : (
      lines.map((line, lineIndex) => (
        <div className={`review-line ${line.type}`} key={`${keyPrefix}-${lineIndex}`}>
          <span className="review-ln">{(line.type === 'del' ? line.oldNo : line.newNo) ?? ''}</span>
          <span className="review-line-sign">{line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}</span>
          <DiffLineText line={line} />
        </div>
      ))
    );

  const renderGap = (key: string, count: number | null, fromOld: number, toOld: number | null): ReactNode => {
    const regionKey = `${change.path}|${key}`;
    const expanded = expandedRegions[regionKey];
    if (expanded) {
      if (!full) return <div className="review-gap-loading" key={regionKey}><Loader2 size={12} className="spin" />加载未更改内容…</div>;
      const lines = fullLines.filter(
        (line) => line.type === 'context' && line.oldNo != null && line.oldNo >= fromOld && (toOld == null || line.oldNo <= toOld),
      );
      return <Fragment key={regionKey}>{renderRows(lines, regionKey)}</Fragment>;
    }
    return (
      <button
        type="button"
        className="review-gap"
        key={regionKey}
        onClick={() => { if (!full) requestFullContext(change.path); onToggleRegion(regionKey); }}
      >
        <ChevronsUpDown size={12} />
        {count != null ? `展开 ${count} 行未更改` : '展开未更改内容'}
      </button>
    );
  };

  const renderHunk = (hunk: DiffHunk, index: number): ReactNode => (
    <div className="review-hunk" key={`hunk-${index}`}>
      <div className="review-hunk-bar">
        <span className="review-hunk-loc">@@ -{hunk.oldStart},{Math.max(hunk.oldEnd - hunk.oldStart, 0) + 1} +{hunk.newStart},{Math.max(hunk.newEnd - hunk.newStart, 0) + 1} @@{hunk.header ? ` ${hunk.header}` : ''}</span>
        {hunkActionable && (
          state?.showingStaged
            ? <button type="button" className="review-hunk-btn" disabled={busy} onClick={() => onUnstageHunk(hunk)}><Minus size={11} />取消暂存此块</button>
            : <button type="button" className="review-hunk-btn" disabled={busy} onClick={() => onStageHunk(hunk)}><Plus size={11} />暂存此块</button>
        )}
      </div>
      {renderRows(hunk.lines, `h${index}`)}
    </div>
  );

  const renderBody = (): ReactNode => {
    if (!state) return <div className="review-diff-note"><Loader2 size={13} className="spin" />读取差异…</div>;
    if (state.error) return <div className="review-diff-note error">{state.error}</div>;
    if (parsed?.binary) return <div className="review-diff-note">二进制文件已更改。</div>;
    if (!parsed || parsed.hunks.length === 0) {
      return <div className="review-diff-note">{untracked ? '新文件为空，无内容可显示。' : '没有可显示的文本差异。'}</div>;
    }
    const hunks = parsed.hunks;
    const body: ReactNode[] = [];
    const first = hunks[0];
    if (canExpandContext && first.oldStart > 1) body.push(renderGap('lead', first.oldStart - 1, 1, first.oldStart - 1));
    hunks.forEach((hunk, index) => {
      if (index > 0) {
        const prev = hunks[index - 1];
        const count = hunk.oldStart - prev.oldEnd - 1;
        if (canExpandContext && count > 0) body.push(renderGap(`mid-${index}`, count, prev.oldEnd + 1, hunk.oldStart - 1));
      }
      body.push(renderHunk(hunk, index));
    });
    const last = hunks[hunks.length - 1];
    if (canExpandContext && full && totalOld > last.oldEnd) body.push(renderGap('trail', totalOld - last.oldEnd, last.oldEnd + 1, null));
    return body;
  };

  return (
    <section className={`review-file ${viewed ? 'viewed' : ''} ${selected ? 'selected' : ''} ${collapsed ? 'collapsed' : ''}`} ref={registerRef}>
      <header className="review-file-head">
        <button type="button" className="review-file-toggle" onClick={onToggle} title={change.path}>
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          <span className={`git-status-dot ${change.status}`} title={change.status}>{(change.indexStatus + change.workingTreeStatus).trim() || '··'}</span>
          <span className="review-file-name">
            {dir && <span className="review-file-dir">{dir}</span>}
            <span className="review-file-base">{name}</span>
          </span>
        </button>
        <span className="review-file-stat">
          {adds > 0 && <span className="add">+{adds}</span>}
          {dels > 0 && <span className="del">-{dels}</span>}
        </span>
        <span className="review-file-actions">
          {confirmDiscard ? (
            <span className="review-confirm">
              <span className="review-confirm-text">丢弃?</span>
              <button type="button" className="icon-mini danger" onClick={onConfirmDiscard} disabled={busy} title="确认丢弃"><Check size={13} /></button>
              <button type="button" className="icon-mini" onClick={onCancelDiscard} title="取消"><X size={13} /></button>
            </span>
          ) : (
            <>
              <button
                type="button"
                className={`icon-mini ${viewed ? 'on' : ''}`}
                onClick={onToggleViewed}
                title={viewed ? '标记为未查看' : '标记为已查看'}
              >
                {viewed ? <Eye size={13} /> : <EyeOff size={13} />}
              </button>
              {change.staged
                ? <button type="button" className="icon-mini" onClick={onUnstage} disabled={busy} title="取消暂存整个文件"><Minus size={13} /></button>
                : <button type="button" className="icon-mini" onClick={onStage} disabled={busy} title="暂存整个文件"><Plus size={13} /></button>}
              <button type="button" className="icon-mini danger-hover" onClick={onRequestDiscard} disabled={busy} title="丢弃此文件的更改"><Undo2 size={13} /></button>
              <button type="button" className="icon-mini" onClick={onOpen} title="在文件管理器中显示"><FolderOpen size={13} /></button>
            </>
          )}
        </span>
      </header>
      {!collapsed && <div className={`review-diff ${viewMode === 'split' ? 'split' : ''}`}>{renderBody()}</div>}
    </section>
  );
}

// ---- Review file tree (right pane navigation) ----
interface ReviewTreeFolder {
  type: 'folder';
  name: string;
  path: string;
  children: ReviewTreeEntry[];
}
interface ReviewTreeFile {
  type: 'file';
  name: string;
  change: GitFileChange;
}
type ReviewTreeEntry = ReviewTreeFolder | ReviewTreeFile;

// Collapse single-child folder chains ("a" → "a/b") and sort folders-first.
function normalizeTree(entries: ReviewTreeEntry[]): ReviewTreeEntry[] {
  const collapsed = entries.map((entry) => {
    if (entry.type !== 'folder') return entry;
    let folder = entry;
    while (folder.children.length === 1 && folder.children[0].type === 'folder') {
      const child = folder.children[0] as ReviewTreeFolder;
      folder = { type: 'folder', name: `${folder.name}/${child.name}`, path: child.path, children: child.children };
    }
    return { ...folder, children: normalizeTree(folder.children) } as ReviewTreeFolder;
  });
  return collapsed.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function buildFileTree(changes: GitFileChange[]): ReviewTreeEntry[] {
  const root: ReviewTreeFolder = { type: 'folder', name: '', path: '', children: [] };
  const folders = new Map<string, ReviewTreeFolder>([['', root]]);
  for (const change of changes) {
    const parts = change.path.split('/');
    const fileName = parts.pop() ?? change.path;
    let parent = root;
    let acc = '';
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part;
      let folder = folders.get(acc);
      if (!folder) {
        folder = { type: 'folder', name: part, path: acc, children: [] };
        folders.set(acc, folder);
        parent.children.push(folder);
      }
      parent = folder;
    }
    parent.children.push({ type: 'file', name: fileName, change });
  }
  return normalizeTree(root.children);
}

function ReviewTree({
  entries,
  depth,
  folderCollapsed,
  selected,
  viewed,
  diffs,
  onToggleFolder,
  onSelect,
}: {
  entries: ReviewTreeEntry[];
  depth: number;
  folderCollapsed: Record<string, boolean>;
  selected: string | null;
  viewed: Record<string, boolean>;
  diffs: Record<string, FileDiffState>;
  onToggleFolder: (path: string) => void;
  onSelect: (path: string) => void;
}) {
  return (
    <>
      {entries.map((entry) => {
        if (entry.type === 'folder') {
          const open = !folderCollapsed[entry.path];
          return (
            <div key={`folder-${entry.path}`}>
              <button type="button" className="tree-folder" style={{ paddingLeft: depth * 12 + 8 }} onClick={() => onToggleFolder(entry.path)}>
                {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                {open ? <FolderOpen size={13} /> : <Folder size={13} />}
                <span className="tree-name">{entry.name}</span>
              </button>
              {open && (
                <ReviewTree
                  entries={entry.children}
                  depth={depth + 1}
                  folderCollapsed={folderCollapsed}
                  selected={selected}
                  viewed={viewed}
                  diffs={diffs}
                  onToggleFolder={onToggleFolder}
                  onSelect={onSelect}
                />
              )}
            </div>
          );
        }
        const path = entry.change.path;
        const stats = diffs[path]?.parsed;
        return (
          <button
            key={`file-${path}`}
            type="button"
            className={`tree-file ${selected === path ? 'active' : ''} ${viewed[path] ? 'viewed' : ''}`}
            style={{ paddingLeft: depth * 12 + 8 }}
            onClick={() => onSelect(path)}
            title={path}
          >
            <span className={`git-status-dot ${entry.change.status}`}>{(entry.change.indexStatus + entry.change.workingTreeStatus).trim() || '··'}</span>
            {reviewFileIcon(entry.name)}
            <span className="tree-name">{entry.name}</span>
            {stats && (stats.additions > 0 || stats.deletions > 0) && (
              <span className="tree-stat">
                {stats.additions > 0 && <span className="add">+{stats.additions}</span>}
                {stats.deletions > 0 && <span className="del">-{stats.deletions}</span>}
              </span>
            )}
          </button>
        );
      })}
    </>
  );
}

function reviewFileIcon(name: string): ReactNode {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico'].includes(ext)) return <ImageIcon size={13} className="tree-icon" />;
  if (['md', 'markdown', 'txt'].includes(ext)) return <FileText size={13} className="tree-icon" />;
  if (['csv', 'tsv', 'xlsx'].includes(ext)) return <FileSpreadsheet size={13} className="tree-icon" />;
  if (['ts', 'tsx', 'js', 'jsx', 'rs', 'py', 'go', 'java', 'c', 'cpp', 'json', 'css', 'html'].includes(ext)) return <FileCode2 size={13} className="tree-icon" />;
  return <File size={13} className="tree-icon" />;
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
  const [creatingBranch, setCreatingBranch] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');

  const refresh = async () => {
    if (!cwd) {
        setStatus({ cwd: '', isRepository: false, ahead: 0, behind: 0, clean: true, changes: [], error: '当前对话未绑定品牌目录。' });
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
    <aside className="git-panel right-dock-panel">
      <header className="panel-header" data-tauri-drag-region>
        <div data-tauri-drag-region>
          <h2>Git</h2>
          <span>{cwd ? shortenPath(cwd) : '未指定品牌目录'}</span>
        </div>
        <button className="icon-btn" type="button" onClick={onClose} aria-label="关闭版本面板"><X size={15} /></button>
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
            {creatingBranch ? (
              <form
                className="git-branch-create"
                onSubmit={(event) => {
                  event.preventDefault();
                  const name = newBranchName.trim();
                  if (!name) return;
                  void runGit(async () => {
                    await gitCreateBranch(cwd, name);
                    setCreatingBranch(false);
                    setNewBranchName('');
                  });
                }}
              >
                <input
                  autoFocus
                  value={newBranchName}
                  onChange={(event) => setNewBranchName(event.target.value)}
                  placeholder="新分支名（基于当前分支创建并检出）"
                  spellCheck={false}
                  disabled={busy}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      setCreatingBranch(false);
                      setNewBranchName('');
                    }
                  }}
                />
                <button type="submit" className="panel-btn primary" disabled={!newBranchName.trim() || busy}><Check size={13} />创建</button>
                <button type="button" className="panel-btn" disabled={busy} onClick={() => { setCreatingBranch(false); setNewBranchName(''); }}><X size={13} /></button>
              </form>
            ) : (
              <>
                <button type="button" className="panel-btn" onClick={() => { setNewBranchName(''); setCreatingBranch(true); }} disabled={busy}><Plus size={13} />新分支</button>
                <select value={currentBranch} onChange={(event) => void runGit(() => gitCheckoutBranch(cwd, event.target.value))} disabled={busy}>
                  {branches.map((branch) => <option key={branch.name} value={branch.name}>{branch.name}{branch.upstream ? ` · ${branch.upstream}` : ''}</option>)}
                </select>
              </>
            )}
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
          <strong>当前品牌目录没有版本记录</strong>
          <span>{status?.error || '请选择一个包含版本记录的品牌目录。'}</span>
          {error && <em>{error}</em>}
        </div>
      )}
    </aside>
  );
}

function SettingsPage({
  domain,
  open,
  section,
  onSectionChange,
  onClose,
  theme,
  onThemeChange,
}: {
  domain: DomainConfig;
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
  const activeLabel = sectionLabel(section, domain);
  return (
    <div className="settings-page" role="dialog" aria-modal="true" aria-label="设置">
      <nav className="settings-page-nav">
        <div className="settings-page-traffic" data-tauri-drag-region />
        <button className="settings-back" type="button" onClick={onClose}><ChevronLeft size={16} /><span>返回应用</span></button>
        <SettingsNavGroup label="个人" items={domain.navigation.personal} section={section} onSectionChange={onSectionChange} />
        <SettingsNavGroup label="已归档" items={domain.navigation.archived} section={section} onSectionChange={onSectionChange} />
      </nav>
      <div className="settings-page-main">
        <div className="settings-page-head" data-tauri-drag-region />
        <div className="settings-page-scroll">
          <div className="settings-content">
            <h1 className="settings-content-title">{activeLabel}</h1>
            <SettingsContent domain={domain} section={section} theme={theme} onThemeChange={onThemeChange} />
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
  if (items.length === 0) return null;

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

function SettingsContent({ domain, section, theme, onThemeChange }: { domain: DomainConfig; section: SettingsSection; theme: Theme; onThemeChange: (theme: Theme) => void }) {
  const speed = useChatStore((state) => state.speed);
  const workModeId = useChatStore((state) => state.workModeId);
  const approvalMode = useChatStore((state) => state.approvalMode);
  const setSpeed = useChatStore((state) => state.setSpeed);
  const setWorkModeId = useChatStore((state) => state.setWorkModeId);
  const setApprovalMode = useChatStore((state) => state.setApprovalMode);

  if (section === 'archived') return <ArchivedSettings />;
  if (section === 'models') return <ModelSettings />;
  if (section === 'marketing-email') return <MarketingEmailSettings />;
  if (section === 'appearance') {
    return (
      <>
        <CodePreview />
        <SettingsGroup>
          <SettingsRow title="主题" description="使用浅色、深色或匹配系统设置。">
            <SettingsSegment value={theme} onChange={onThemeChange} options={[{ id: 'light', label: '浅色', icon: <Sun size={13} /> }, { id: 'dark', label: '深色', icon: <Moon size={13} /> }]} />
          </SettingsRow>
          <SettingsRow title="强调色" description="用于按钮、选中状态和品牌重点信息。"><ColorSwatch value="#339CFF" /></SettingsRow>
          <SettingsRow title="UI 字号" description="调整工作台界面的基础字号。"><span className="settings-static">14 px</span></SettingsRow>
        </SettingsGroup>
      </>
    );
  }
  if (section === 'config') {
    return (
      <SettingsGroup>
        <SettingsRow title="批准方式" description="选择 Incuboot 执行操作前如何请求授权。">
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
          <SettingsRow title="个性" description="选择 Incuboot 回复的默认语气。"><span className="settings-static">亲和</span></SettingsRow>
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
        <WorkModePanel value={workModeId} onChange={setWorkModeId} />
        <SettingsGroup>
          <SettingsRow title="默认权限" description="默认情况下，Incuboot 可以读取品牌目录文件。"><Toggle checked /></SettingsRow>
          <SettingsRow title="自动审核" description="自动审核额外访问和权限请求。"><Toggle checked /></SettingsRow>
          <SettingsRow title="完全访问权限" description="允许编辑电脑上的文件并运行联网命令。"><Toggle checked /></SettingsRow>
        </SettingsGroup>
        <SettingsGroup>
          <SettingsRow title="默认打开目标" description="默认打开文件和文件夹的位置。"><span className="settings-static">按品牌目录</span></SettingsRow>
          <SettingsRow title="语言" description="应用 UI 语言。"><span className="settings-static">自动检测</span></SettingsRow>
          <SettingsRow title="速度" description="选择用于聊天、子智能体和压缩的推理层级。">
            <SettingsSegment value={speed} onChange={(id) => setSpeed(id as Speed)} options={SPEED_OPTIONS.map((option) => ({ id: option.id, label: option.label, icon: option.fast ? <Zap size={13} /> : undefined }))} />
          </SettingsRow>
        </SettingsGroup>
      </>
    );
  }
  if (section === 'hooks' || section === 'connections' || section === 'snapshots' || section === 'mcp' || section === 'browser' || section === 'computer') {
    return <PlaceholderSettings domain={domain} section={section} />;
	  }
	  return (
	    <SettingsGroup>
	      <SettingsRow title={sectionLabel(section, domain)} description="品牌系统保留扩展入口，可通过领域插件接入更多能力。"><span className="settings-static">可扩展</span></SettingsRow>
	    </SettingsGroup>
	  );
	}

const EMPTY_MODEL_DRAFT: ModelProfileDraft = {
  label: '',
  providerId: 'deepseek',
  model: '',
  wireApi: 'responses',
  baseUrl: '',
  apiKey: '',
  enabled: true,
  supportsReasoningEffort: false,
};

const DEFAULT_MARKETING_EMAIL_ACCOUNT: MarketingEmailAccountConfig = {
  id: 'email-primary',
  label: 'Marketing Inbox',
  host: '',
  port: 993,
  tls: true,
  username: '',
  mailbox: 'INBOX',
  scanLimit: 200,
  syncIntervalMinutes: 15,
  enabled: true,
  password: '',
};

function MarketingEmailSettings() {
  const [draft, setDraft] = useState<MarketingEmailAccountConfig>(DEFAULT_MARKETING_EMAIL_ACCOUNT);
  const [dbPath, setDbPath] = useState('~/.alpha-studio/marketing.sqlite');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let disposed = false;
    void marketingDbQuery(true)
      .then((snapshot) => {
        if (disposed) return;
        setDbPath(snapshot.path);
        const account = snapshot.accounts[0];
        if (account) {
          setDraft({ ...account, password: '' });
        }
      })
      .catch((err) => {
        if (!disposed) setError(stringifyError(err));
      });
    return () => {
      disposed = true;
    };
  }, []);

  const save = async (event?: FormEvent) => {
    event?.preventDefault();
    setBusy(true);
    setError(null);
    setStatus('正在保存邮箱配置...');
    try {
      const path = await marketingEmailSecretSave(draft);
      if (path) setDbPath(path);
      setStatus('邮箱配置已保存到本地数据库，密码已写入系统 Keychain。');
      setDraft((current) => ({ ...current, password: '' }));
    } catch (err) {
      setError(stringifyError(err));
    } finally {
      setBusy(false);
    }
  };
  const test = async () => {
    setBusy(true);
    setError(null);
    setStatus('正在测试 IMAP 连接...');
    try {
      const result = await marketingEmailTestConnection(draft);
      setStatus(result.message);
    } catch (err) {
      setError(stringifyError(err));
    } finally {
      setBusy(false);
    }
  };
  const sync = async () => {
    setBusy(true);
    setError(null);
    setStatus('正在只读同步最近邮件...');
    try {
      await marketingEmailSecretSave(draft);
      const result = await marketingEmailSyncReadonly(draft);
      setDbPath(result.path);
      setStatus(`同步完成：${result.synced} 封，新增 ${result.inserted}，更新 ${result.updated}，其他 ${result.other}。`);
      setDraft((current) => ({ ...current, password: '' }));
    } catch (err) {
      setError(stringifyError(err));
    } finally {
      setBusy(false);
    }
  };
  const canUse = Boolean(draft.host.trim() && draft.username.trim() && (draft.password?.trim() || isTauriRuntime()));

  return (
    <>
      <SettingsGroup>
        <SettingsRow title="本地数据库" description="邮件分类、KOL 档案和自动化日志都保存在本机 SQLite。">
          <span className="settings-static model-config-path">{dbPath}</span>
        </SettingsRow>
        <SettingsRow title="邮箱只读策略" description="同步使用 BODY.PEEK，不在邮箱系统内打标签、移动、删除或标记已读。">
          <span className="settings-static">只读同步</span>
        </SettingsRow>
      </SettingsGroup>

      <form className="marketing-settings-form" onSubmit={save}>
        <div className="settings-subtitle">IMAP 邮箱</div>
        <div className="model-form-grid">
          <label>显示名称<input className="settings-input" value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })} placeholder="Marketing Inbox" /></label>
          <label>IMAP 主机<input className="settings-input" value={draft.host} onChange={(event) => setDraft({ ...draft, host: event.target.value })} placeholder="imap.gmail.com" /></label>
          <label>端口<input className="settings-input" type="number" value={draft.port} onChange={(event) => setDraft({ ...draft, port: Number(event.target.value) || 993 })} /></label>
          <label>用户名<input className="settings-input" value={draft.username} onChange={(event) => setDraft({ ...draft, username: event.target.value })} placeholder="marketing@example.com" /></label>
          <label>应用密码<input className="settings-input" type="password" value={draft.password ?? ''} onChange={(event) => setDraft({ ...draft, password: event.target.value })} placeholder="留空表示继续使用已保存密码" /></label>
          <label>邮箱文件夹<input className="settings-input" value={draft.mailbox} onChange={(event) => setDraft({ ...draft, mailbox: event.target.value })} placeholder="INBOX" /></label>
          <label>单次扫描<input className="settings-input" type="number" min={1} max={1000} value={draft.scanLimit} onChange={(event) => setDraft({ ...draft, scanLimit: Number(event.target.value) || 200 })} /></label>
          <label>同步间隔（分钟）<input className="settings-input" type="number" min={1} max={1440} value={draft.syncIntervalMinutes} onChange={(event) => setDraft({ ...draft, syncIntervalMinutes: Number(event.target.value) || 15 })} /></label>
        </div>
        <div className="model-form-options">
          <label className="model-toggle"><input type="checkbox" checked={draft.tls} onChange={(event) => setDraft({ ...draft, tls: event.target.checked, port: event.target.checked ? 993 : draft.port })} /><span>TLS</span></label>
          <label className="model-toggle"><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} /><span>启用定时同步</span></label>
        </div>
        {(status || error) && (
          <div className={`settings-status ${error ? 'attention' : 'ready'}`}>
            <span className="settings-status-icon">{busy ? <Loader2 size={16} className="spin" /> : error ? <AlertTriangle size={16} /> : <Check size={16} />}</span>
            <div className="settings-status-main">
              <strong>{error ? '邮件营销设置需要处理' : '邮件营销设置'}</strong>
              <span>{error || status}</span>
            </div>
          </div>
        )}
        <div className="model-form-actions">
          <button className="settings-btn primary" type="submit" disabled={busy || !canUse}>保存配置</button>
          <button className="settings-btn" type="button" onClick={() => void test()} disabled={busy || !canUse}>测试连接</button>
          <button className="settings-btn" type="button" onClick={() => void sync()} disabled={busy || !canUse}>立即同步</button>
        </div>
      </form>
    </>
  );
}

function ModelSettings() {
  const selectedModelProfileId = useChatStore((state) => state.selectedModelProfileId);
  const modelProfiles = useChatStore((state) => state.modelProfiles);
  const reasoningEffort = useChatStore((state) => state.reasoningEffort);
  const setModelProfile = useChatStore((state) => state.setModelProfile);
  const setReasoningEffort = useChatStore((state) => state.setReasoningEffort);
  const addModelProfile = useChatStore((state) => state.addModelProfile);
  const updateModelProfile = useChatStore((state) => state.updateModelProfile);
  const deleteModelProfile = useChatStore((state) => state.deleteModelProfile);
  const toggleModelProfile = useChatStore((state) => state.toggleModelProfile);
  const codexStatus = useChatStore((state) => state.codexStatus);
  const refreshCodexStatus = useChatStore((state) => state.refreshCodexStatus);
  const isCheckingCodex = useChatStore((state) => state.isCheckingCodex);
  const modelConfigPath = useChatStore((state) => state.modelConfigPath);
  const isLoadingModelConfig = useChatStore((state) => state.isLoadingModelConfig);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ModelProfileDraft>(EMPTY_MODEL_DRAFT);

  const enabledProfiles = modelProfiles.filter((profile) => profile.enabled);
  const customProfiles = modelProfiles.filter((profile) => !profile.builtIn);
  const editingProfile = editingId ? customProfiles.find((profile) => profile.id === editingId) : null;
  const selectedProfile = modelProfiles.find((profile) => profile.id === selectedModelProfileId);
  const normalizedDraft = normalizeModelProfileDraft(draft);
  const requiresBaseUrl = normalizedDraft.providerId !== 'openai';
  const canSave = Boolean(normalizedDraft.label && normalizedDraft.model && (!requiresBaseUrl || normalizedDraft.baseUrl));

  const beginCreate = (template: 'blank' | 'deepseek' | 'claude') => {
    setEditingId(null);
    setDraft(modelTemplate(template));
  };
  const beginEdit = (profile: ModelProfile) => {
    if (profile.builtIn) return;
    setEditingId(profile.id);
    setDraft(modelProfileToDraft(profile));
  };
  const resetForm = () => {
    setEditingId(null);
    setDraft(EMPTY_MODEL_DRAFT);
  };
  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!canSave) return;
    if (editingProfile) {
      updateModelProfile(editingProfile.id, normalizedDraft);
    } else {
      addModelProfile(normalizedDraft);
    }
    resetForm();
  };
  const remove = (profile: ModelProfile) => {
    void confirmDanger(`删除自定义模型「${profile.label}」？`, '删除自定义模型').then((ok) => {
      if (ok) deleteModelProfile(profile.id);
    });
  };

  return (
    <>
      <SettingsGroup>
        <SettingsRow title="当前模型" description="对话使用的基础模型，可随时切换。">
          <select className="settings-select model-settings-select" value={selectedModelProfileId} onChange={(event) => setModelProfile(event.target.value)}>
            {enabledProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}
          </select>
        </SettingsRow>
        <SettingsRow title="推理强度" description="更高的强度更细致，但响应更慢；不支持的自定义模型会自动跳过。">
          <SettingsSegment value={reasoningEffort} onChange={(id) => setReasoningEffort(id as ReasoningEffort)} options={EFFORT_OPTIONS.map((option) => ({ id: option.id, label: option.label }))} />
        </SettingsRow>
        <SettingsRow title="配置文件" description="自定义模型和 API Key 会保存到本地 JSON 文件，其他工具可以直接修改。">
          <span className="settings-static model-config-path">{isLoadingModelConfig ? '正在加载...' : modelConfigPath || '~/.alpha-studio/model-providers.json'}</span>
        </SettingsRow>
        {selectedProfile && !selectedProfile.builtIn && selectedProfile.wireApi === 'chat' && (
          <div className="settings-status adapter model-compat-status">
            <span className="settings-status-icon"><Network size={16} /></span>
            <div className="settings-status-main">
              <strong>当前模型将通过本地 adapter 运行</strong>
              <span>Incuboot 会把本地执行请求翻译为上游 Chat Completions 请求。</span>
            </div>
          </div>
        )}
        <div className={`settings-status ${codexStatus?.installed && codexStatus.loggedIn ? 'ready' : 'attention'}`}>
          <span className="settings-status-icon">{isCheckingCodex ? <Loader2 size={16} className="spin" /> : <Terminal size={16} />}</span>
          <div className="settings-status-main">
            <strong>{codexStatus?.installed && codexStatus.loggedIn ? `本地智能引擎已就绪${codexStatus.version ? ` · ${codexStatus.version}` : ''}` : '本地智能引擎未就绪'}</strong>
            <span>{codexStatus?.path || codexStatus?.error || '请确认本地智能引擎已安装并登录。'}</span>
          </div>
          <button className="settings-btn" type="button" onClick={() => void refreshCodexStatus()} disabled={isCheckingCodex}>重新检测</button>
        </div>
      </SettingsGroup>

      <div className="settings-subtitle">自定义模型</div>
      <SettingsGroup>
        <div className="model-template-row">
          <button className="settings-btn" type="button" onClick={() => beginCreate('deepseek')}><Plus size={13} />DeepSeek</button>
          <button className="settings-btn" type="button" onClick={() => beginCreate('claude')}><Plus size={13} />Claude 网关</button>
          <button className="settings-btn" type="button" onClick={() => beginCreate('blank')}><Plus size={13} />空白</button>
        </div>
        {customProfiles.length === 0 ? (
          <div className="model-empty-row">暂无自定义模型。</div>
        ) : customProfiles.map((profile) => (
          <div className="model-profile-row" key={profile.id}>
            <div className="model-profile-main">
              <strong>{profile.label}</strong>
              <span>{profile.providerId} · {profile.model}</span>
              <code>{profile.apiKey ? 'API Key 已保存' : '未填写 API Key'} · {profile.wireApi === 'responses' ? 'Responses API' : `Chat Completions（本地 adapter，${profile.supportsReasoningEffort ? '思考开启' : '思考关闭'}）`} · {profile.baseUrl || 'built-in provider'}</code>
            </div>
            <div className="model-profile-actions">
              <label className="model-toggle"><input type="checkbox" checked={profile.enabled} onChange={(event) => toggleModelProfile(profile.id, event.target.checked)} /><span>启用</span></label>
              <button className="settings-btn" type="button" onClick={() => beginEdit(profile)}><Pencil size={13} />编辑</button>
              <button className="icon-mini danger" type="button" onClick={() => remove(profile)} aria-label="删除自定义模型"><Trash2 size={13} /></button>
            </div>
          </div>
        ))}
      </SettingsGroup>

      <form className="model-profile-form" onSubmit={save}>
        <div className="settings-subtitle">{editingProfile ? '编辑模型' : '新增模型'}</div>
        <div className="model-form-grid">
          <label>显示名称<input className="settings-input" value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })} placeholder="DeepSeek V4" /></label>
          <label>Provider ID<input className="settings-input" value={draft.providerId} onChange={(event) => setDraft({ ...draft, providerId: event.target.value })} placeholder="deepseek" /></label>
          <label>模型 ID<input className="settings-input" value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })} placeholder="deepseek-chat" /></label>
          <label>Base URL<input className="settings-input" value={draft.baseUrl ?? ''} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} placeholder="https://api.deepseek.com/v1" /></label>
          <label>API Key<input className="settings-input" type="password" value={draft.apiKey ?? ''} onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })} placeholder="sk-..." /></label>
          <label>协议
            <select className="settings-select" value={draft.wireApi} onChange={(event) => setDraft({ ...draft, wireApi: event.target.value as ModelWireApi })}>
              <option value="responses">Responses API（直连/网关）</option>
              <option value="chat">Chat Completions（本地 adapter）</option>
            </select>
          </label>
        </div>
        {draft.wireApi === 'chat' && (
          <div className="model-form-warning">
            <Network size={14} />
            <span>Chat Completions 会通过 Incuboot 本地 adapter 接入；勾选“启用思考模式”会发送 thinking.enabled，取消勾选会发送 thinking.disabled。</span>
          </div>
        )}
        <div className="model-form-options">
          <label className="model-toggle"><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} /><span>启用</span></label>
          <label className="model-toggle"><input type="checkbox" checked={draft.supportsReasoningEffort} onChange={(event) => setDraft({ ...draft, supportsReasoningEffort: event.target.checked })} /><span>{draft.wireApi === 'chat' ? '启用思考模式' : '支持推理强度'}</span></label>
        </div>
        <div className="model-form-actions">
          <button className="settings-btn primary" type="submit" disabled={!canSave}>{editingProfile ? '保存修改' : '添加模型'}</button>
          <button className="settings-btn" type="button" onClick={resetForm}>取消</button>
        </div>
      </form>
    </>
  );
}

function modelTemplate(template: 'blank' | 'deepseek' | 'claude'): ModelProfileDraft {
  if (template === 'deepseek') {
    return {
      label: 'DeepSeek V4',
      providerId: 'deepseek',
      model: 'deepseek-v4-flash',
      wireApi: 'chat',
      baseUrl: 'https://api.deepseek.com',
      apiKey: '',
      enabled: true,
      supportsReasoningEffort: true,
    };
  }
  if (template === 'claude') {
    return {
      label: 'Claude Opus 4.8',
      providerId: 'openrouter',
      model: 'anthropic/claude-opus-4.8',
      wireApi: 'responses',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: '',
      enabled: true,
      supportsReasoningEffort: false,
    };
  }
  return EMPTY_MODEL_DRAFT;
}

function modelProfileToDraft(profile: ModelProfile): ModelProfileDraft {
  return {
    label: profile.label,
    providerId: profile.providerId,
    model: profile.model,
    wireApi: profile.wireApi,
    baseUrl: profile.baseUrl ?? '',
    apiKey: profile.apiKey ?? '',
    enabled: profile.enabled,
    supportsReasoningEffort: profile.supportsReasoningEffort,
  };
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

function WorkModePanel({ value, onChange }: { value: WorkModeId; onChange: (id: WorkModeId) => void }) {
  const activeOption = WORK_MODE_OPTIONS.find((option) => option.id === value) ?? WORK_MODE_OPTIONS[0];
  if (!activeOption) return null;
  return (
    <section className="work-mode-panel" aria-labelledby="work-mode-title">
      <div className="work-mode-copy">
        <div>
          <span className="work-mode-kicker">工作模式</span>
          <h2 id="work-mode-title">品牌协作</h2>
          <p>选择 Incuboot 如何组织品牌目录与智能能力。</p>
        </div>
        <div className="work-mode-current" aria-label={`当前模式：${activeOption.title}`}>
          <span>当前</span>
          <strong>{activeOption.title}</strong>
          <em>{activeOption.tag}</em>
        </div>
      </div>
      <ModePicker value={value} onChange={onChange} />
    </section>
  );
}

function CodePreview() {
  return (
    <div className="theme-preview">
      <div className="code-pane before"><code><span>品牌定位：健康生活方式</span><span>受众：年轻家庭</span><span>语气：温暖、可信、清晰</span><span>资产：Logo / 色板 / 文案</span></code></div>
      <div className="code-pane after"><code><span>品牌定位：家庭健康顾问</span><span>受众：城市新家庭</span><span>语气：专业但有温度</span><span>下一步：补齐场景图与案例</span></code></div>
    </div>
  );
}

function ModePicker({ value, onChange }: { value: WorkModeId; onChange: (id: WorkModeId) => void }) {
  return (
    <div className="mode-card-list" role="radiogroup" aria-label="工作模式">
      {WORK_MODE_OPTIONS.map((option) => {
        const selected = option.id === value;
        const availableMode = option.available ? activeDomain(option.id) : null;
        return (
          <button
            key={option.id}
            type="button"
            className={`mode-card ${selected ? 'selected' : ''} ${option.available ? '' : 'disabled'}`}
            role="radio"
            aria-checked={selected}
            disabled={!option.available}
            onClick={() => availableMode && onChange(availableMode.id)}
          >
            <span className="mode-card-icon">{modeIcon(option.id)}</span>
            <span className="mode-card-main">
              <span className="mode-card-heading">
                <strong>{option.title}</strong>
                <span className={`mode-card-tag ${option.available ? '' : 'muted'}`}>{option.tag}</span>
              </span>
              <em>{option.description}</em>
            </span>
            <span className={`mode-card-radio ${selected ? 'active' : ''}`}>
              {selected && <Check size={12} strokeWidth={3} />}
            </span>
          </button>
        );
      })}
    </div>
  );
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
      <div className="avatar">IB</div>
      <h2>Incuboot</h2>
      <span>@local · 私有商用</span>
      <div className="profile-metrics">
        <span><strong>品牌系统</strong><em>工作模式</em></span>
        <span><strong>品牌目录</strong><em>资料组织</em></span>
        <span><strong>本地智能</strong><em>执行连接</em></span>
      </div>
    </div>
  );
}

function KeyboardSettings() {
  const rows = [
    ['归档聊天', 'Archive the current chat', '⇧⌘A'],
    ['新对话', 'Start a new chat', '⌘N'],
    ['搜索', 'Search chats and brands', '⌘K'],
    ['置顶对话', 'Pin or unpin the current chat', '⌥⌘P'],
    ['品牌目录', 'Open the current brand folder', ''],
  ];
  return <SettingsGroup>{rows.map(([title, desc, key]) => <SettingsRow key={title} title={title} description={desc}><span className="shortcut-pill">{key || '未指定'}</span></SettingsRow>)}</SettingsGroup>;
}

function UsageSettings() {
  return (
    <SettingsGroup>
      <SettingsRow title="当前版本" description="垂直商用版。"><span className="settings-static">0.1.0</span></SettingsRow>
      <SettingsRow title="许可证" description="私有商业授权，未开放源码分发。"><span className="settings-static">Proprietary</span></SettingsRow>
      <SettingsRow title="商业授权" description="当前构建已启用垂直领域商业授权。"><span className="settings-static">已启用</span></SettingsRow>
    </SettingsGroup>
  );
}

function GitSettings() {
  return (
    <SettingsGroup>
      <SettingsRow title="版本记录" description="为品牌目录保留可追溯的本地变更记录。"><Toggle checked /></SettingsRow>
      <SettingsRow title="保存节点" description="允许把一组品牌资料变更保存为一个节点。"><Toggle checked /></SettingsRow>
      <SettingsRow title="远端同步" description="可接入团队共享目录或版本服务。"><Toggle checked /></SettingsRow>
      <SettingsRow title="危险操作" description="破坏性覆盖操作默认禁用。"><span className="settings-static">禁用</span></SettingsRow>
    </SettingsGroup>
  );
}

function EnvironmentSettings() {
  return (
    <SettingsGroup>
      <SettingsRow title="品牌目录访问" description="由本机文件系统和桌面权限提供。"><span className="settings-static">自动检测</span></SettingsRow>
      <SettingsRow title="图片与文档" description="支持读取品牌素材、文档和参考文件。"><span className="settings-static">本地</span></SettingsRow>
      <SettingsRow title="联网能力" description="需要时可检索公开网页和品牌参考资料。"><span className="settings-static">按权限</span></SettingsRow>
    </SettingsGroup>
  );
}

function WorktreeSettings() {
  return (
    <SettingsGroup>
      <SettingsRow title="品牌目录" description="一个品牌对应一个本地目录。"><span className="settings-static">已启用</span></SettingsRow>
      <SettingsRow title="默认目录" description="每个品牌可以绑定自己的品牌目录。"><span className="settings-static">按品牌管理</span></SettingsRow>
    </SettingsGroup>
  );
}

function PlaceholderSettings({ domain, section }: { domain: DomainConfig; section: SettingsSection }) {
  return (
    <SettingsGroup>
      <SettingsRow title={sectionLabel(section, domain)} description="品牌系统保留扩展入口，可通过领域插件接入更多能力。"><span className="settings-static">可扩展</span></SettingsRow>
      <SettingsRow title="领域包" description={`当前启用 ${domain.id}。`}><span className="settings-static">{domain.id}</span></SettingsRow>
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
    if (!(await confirmDanger('永久删除所有已归档品牌和对话？此操作无法恢复。', '清空归档'))) return;
    const projectIds = new Set(archivedProj.map((project) => project.id));
    archivedProj.forEach((project) => permanentlyDeleteProject(project.id));
    archivedConv.filter((conversation) => !conversation.projectId || !projectIds.has(conversation.projectId)).forEach((conversation) => permanentlyDeleteConversation(conversation.id));
  };
  return (
    <div className="archive-settings">
      <div className="archive-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索已归档聊天" /></div>
      <div className="archive-list">
        {archivedProj.map((project) => <ArchiveRow key={project.id} title={project.name} meta={`${formatDate(project.archivedAt)} · 品牌`} onRestore={() => unarchiveProject(project.id)} onDelete={() => void confirmDanger(`永久删除品牌「${project.name}」及其中对话？`, '永久删除品牌').then((ok) => ok && permanentlyDeleteProject(project.id))} />)}
        {archivedConv.map((conversation) => <ArchiveRow key={conversation.id} title={conversation.title} meta={`${formatDate(conversation.archivedAt)} · ${conversation.cwd ? shortenPath(conversation.cwd) : '未指定目录'}`} onRestore={() => unarchiveConversation(conversation.id)} onDelete={() => void confirmDanger(`永久删除对话「${conversation.title}」？`, '永久删除对话').then((ok) => ok && permanentlyDeleteConversation(conversation.id))} />)}
        {archivedProj.length === 0 && archivedConv.length === 0 && <div className="archive-empty"><Archive size={20} /><span>没有已归档品牌或对话。</span></div>}
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
    'marketing-email': <Mail size={15} />,
	    models: <Cpu size={15} />,
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

function modeIcon(id: string): ReactNode {
  if (id === 'brand-system') return <Sparkles size={14} />;
  return <Layers size={14} />;
}

function domainSuggestionIcon(suggestion: DomainSuggestion): ReactNode {
  const icons: Record<DomainSuggestion['icon'], ReactNode> = {
    folder: <FolderOpen size={16} className="icon" />,
    sparkles: <Sparkles size={16} className="icon" />,
    wrench: <Wrench size={16} className="icon" />,
  };
  return icons[suggestion.icon];
}

function domainFeatureIcon(icon: DomainFeature['icon']): ReactNode {
  const icons: Record<DomainFeature['icon'], ReactNode> = {
    folder: <FolderOpen size={20} />,
    browser: <Globe size={20} />,
    review: <GitPullRequest size={20} />,
    terminal: <SquareTerminal size={20} />,
  };
  return icons[icon];
}

function domainSectionIds(domain: DomainConfig): SettingsSection[] {
  return [...domain.navigation.personal, ...domain.navigation.integrations, ...domain.navigation.coding, ...domain.navigation.archived]
    .map((item) => item.id as SettingsSection);
}

function sectionLabel(section: SettingsSection, domain: DomainConfig): string {
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
  if (has('stderr')) return { kind: 'log', icon: <FileText size={14} />, running: '系统日志', done: '系统日志', failed: '系统日志' };
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
  const hideReconnectStatus = message.blocks.some((block) => !isReconnectStatusBlock(block));
  return message.blocks.filter((block) => !(hideReconnectStatus && isReconnectStatusBlock(block))).map((block) => {
    if (block.type === 'text' || block.type === 'thinking' || block.type === 'error') return block.content;
    if (block.type === 'tool') return [block.title, block.input, block.output].filter(Boolean).join('\n');
    return '';
  }).filter(Boolean).join('\n\n').trim();
}

function conversationToPlainText(conversation: Conversation): string {
  return conversation.messages
    .map((message) => {
      const who = message.role === 'user' ? '我' : 'Incuboot';
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
        title: 'Incuboot',
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

async function pickFolder(
  title = '选择品牌目录',
  browserPrompt = '输入品牌目录的绝对路径（浏览器预览模式）',
): Promise<string | null> {
  if (isTauriRuntime()) {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({ directory: true, multiple: false, title });
      return typeof selected === 'string' ? selected : null;
    } catch {
      return null;
    }
  }
  const manual = window.prompt(browserPrompt);
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

function isPrimaryEmailCategory(category: MarketingEmailLead['category']): boolean {
  return category === 'influencer' || category === 'affiliate';
}

function categoryLabel(category: MarketingEmailLead['category'] | 'ad'): string {
  if (category === 'affiliate') return '联盟';
  if (category === 'other') return '其他';
  if (category === 'ad') return '其他';
  return '达人';
}

function priorityLabel(priority: string): string {
  if (priority === 'high') return '高';
  if (priority === 'low') return '低';
  return '普通';
}

function formatMaybeDate(value?: number | null): string {
  if (!value) return '未同步';
  return formatDate(value);
}

function initials(name: string): string {
  const cleaned = name.trim();
  if (!cleaned) return 'K';
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return cleaned.slice(0, 2).toUpperCase();
}

function emptyToNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeOptionalNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
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

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || path;
}

function brandDirectoryName(name: string): string {
  return name
    .trim()
    .replace(/[\\/:*?"<>|\u0000]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^\.+|\.+$/g, '')
    .trim();
}

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\u001b\[[0-9;?]*[A-Za-z]|\u001b\][^\u0007]*\u0007|\r/g;

function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, '');
}

function cleanCommandOutput(value?: string): string {
  if (!value) return '';
  return stripAnsi(value)
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error || 'Unknown error');
}
