import { Fragment, createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type {
  ChangeEvent,
  CSSProperties,
  FormEvent,
  ImgHTMLAttributes,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
  RefObject,
} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { convertFileSrc } from '@tauri-apps/api/core';
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
  ChevronsDownUp,
  ChevronsUpDown,
  Clock3,
  Code2,
  Columns2,
  Copy,
  Cpu,
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
  Info,
  Keyboard,
  Layers,
  ListChecks,
  Loader2,
  Lock,
  LogOut,
  MessageCircle,
  MessageSquare,
  MessageSquarePlus,
  Mic,
  Minus,
  Monitor,
  Moon,
  MoreHorizontal,
  Network,
  PanelBottom,
  PanelBottomClose,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRight,
  PanelRightClose,
  Paperclip,
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
  Target,
  Terminal,
  Trash2,
  Undo2,
  Upload,
  UserCircle,
  Workflow,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import {
  ghAuthStatus,
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
  localImageDataUrl,
  loginCodex,
  openInApp,
  revealPath,
  revokeCodexAuthorization,
  subscribeTerminalEvents,
  terminalResize,
  terminalStart,
  terminalStop,
  terminalWrite,
} from './codexBridge';
import { activeDomain, type DomainConfig, type DomainSuggestion } from './domain';
import {
  activateClient,
  ALPHA_GATEWAY_PROVIDER_ID,
  clearClientLicenseSession,
  defaultAlphaApiBaseUrl,
  getOrCreateDeviceFingerprint,
  loadClientLicenseSession,
  renewClientLease,
  type ClientLicenseSession,
} from './license';
import {
  APPROVAL_OPTIONS,
  EFFORT_OPTIONS,
  SPEED_OPTIONS,
  approvalDescription,
  approvalLabel,
  effortLabel,
  normalizeModelProfileDraft,
  resolveModelProfile,
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
  GhAuthStatus,
  GitBranch as GitBranchInfo,
  GitCommit,
  GitDiffStat,
  GitFileChange,
  GitRemote,
  GitStatus,
  GeneratedFile,
  GeneratedImage,
  MessageAttachment,
  MessageBlock,
  OpenAppId,
  Project,
  ProjectSort,
  ReviewFinding,
  ReviewReport,
  ReviewRequest,
  SkillSelection,
} from './types';

type RightPanel = 'none' | 'git' | 'features' | 'review' | 'terminal' | 'browser' | 'files' | 'side-chat';
type RightDockKind = 'review' | 'terminal' | 'browser' | 'files' | 'side-chat';
type MainView = 'chat' | 'skills' | 'automations';
interface RightDockTab {
  id: string;
  kind: RightDockKind;
}
type Theme = 'light' | 'dark';
type SettingsSection =
  | 'general'
  | 'profile'
  | 'appearance'
  | 'config'
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
const CODEX_LOGIN_POLL_INTERVAL_MS = 2_000;
const CODEX_LOGIN_POLL_TIMEOUT_MS = 60_000;
const SIDEBAR_MIN_WIDTH = 244;
const SIDEBAR_MAX_WIDTH = 420;
const SIDEBAR_DEFAULT_WIDTH = 300;
const RIGHT_SIDEBAR_MIN_WIDTH = 320;
const RIGHT_SIDEBAR_MAX_WIDTH = 620;
const RIGHT_SIDEBAR_DEFAULT_WIDTH = 416;
const GIT_PANEL_MIN_WIDTH = 360;
const GIT_PANEL_MAX_WIDTH = 760;
const GIT_PANEL_DEFAULT_WIDTH = 430;
const REVIEW_PANEL_MIN_WIDTH = 520;
const REVIEW_PANEL_MAX_WIDTH = 1120;
const REVIEW_PANEL_DEFAULT_WIDTH = 704;
const RIGHT_PANEL_MIN_MAIN_WIDTH = 360;

const RIGHT_DOCK_META: Record<RightDockKind, { label: string; shortcut?: string }> = {
  review: { label: '审查', shortcut: '⌃⇧G' },
  terminal: { label: '终端' },
  browser: { label: '浏览器', shortcut: '⌘T' },
  files: { label: '文件', shortcut: '⌘P' },
  'side-chat': { label: '侧边聊天', shortcut: '⌥⌘S' },
};
const RIGHT_DOCK_ADD_MENU_KINDS: readonly RightDockKind[] = ['browser', 'side-chat'];

type SkillCategory = 'personal' | 'system' | 'recommended';
type SkillCategoryFilter = SkillCategory | 'all';
type SkillIcon =
  | 'browser'
  | 'chrome'
  | 'computer'
  | 'pdf'
  | 'image'
  | 'docs'
  | 'plugin'
  | 'skill'
  | 'playwright'
  | 'ios'
  | 'github'
  | 'calendar'
  | 'drive'
  | 'slack'
  | 'database'
  | 'cloud'
  | 'chart';

interface SkillDetailSection {
  title?: string;
  paragraphs: string[];
}

interface SkillCatalogItem extends SkillSelection {
  category: SkillCategory;
  source: string;
  installed: boolean;
  icon: SkillIcon;
  detail: SkillDetailSection[];
}

const detail = (overview: string, workflow?: string): SkillDetailSection[] => [
  { paragraphs: [overview] },
  ...(workflow ? [{ title: 'Workflow Configuration', paragraphs: [workflow] }] : []),
];

const SKILL_CATALOG: readonly SkillCatalogItem[] = [
  {
    id: 'browser',
    title: 'Browser',
    description: 'Browser lets Codex open and control the in-app browser, mainly for local development pages and web QA.',
    category: 'personal',
    source: '个人',
    installed: true,
    icon: 'browser',
    detail: detail(
      'Open and control the in-app browser for local development pages, web QA, screenshots, DOM snapshots, and interaction checks.',
      'Use this when a task needs a rendered web surface inside Alpha Studio instead of an external browser session.',
    ),
  },
  {
    id: 'ios-app-intents',
    title: 'iOS App Intents',
    description: 'Build and debug iOS App Intents integrations',
    category: 'personal',
    source: '个人',
    installed: true,
    icon: 'ios',
    detail: detail('Design App Intents, app entities, and App Shortcuts for iOS features that need system-level integration.'),
  },
  {
    id: 'ios-debugger-agent',
    title: 'iOS Debugger Agent',
    description: 'Debug iOS apps on Simulator',
    category: 'personal',
    source: '个人',
    installed: true,
    icon: 'ios',
    detail: detail('Build, run, and debug iOS apps on Simulator with XcodeBuildMCP-backed tooling.'),
  },
  {
    id: 'ios-ettrace-performance',
    title: 'iOS ETTrace Performance',
    description: 'Profile symbolicated iOS simulator flows with ETTrace',
    category: 'personal',
    source: '个人',
    installed: true,
    icon: 'ios',
    detail: detail('Capture and interpret ETTrace profiles for iOS Simulator performance investigations.'),
  },
  {
    id: 'ios-memgraph-leaks',
    title: 'iOS Memgraph Leaks',
    description: 'Capture and prove iOS simulator memory leaks',
    category: 'personal',
    source: '个人',
    installed: true,
    icon: 'ios',
    detail: detail('Capture and inspect iOS memgraphs when you need leak evidence instead of a guess.'),
  },
  {
    id: 'ios-simulator-browser',
    title: 'iOS Simulator Browser',
    description: 'Mirror an iOS Simulator into the in-app browser',
    category: 'personal',
    source: '个人',
    installed: true,
    icon: 'ios',
    detail: detail('Stream an iOS Simulator view into Alpha Studio for visual checks and app walkthroughs.'),
  },
  {
    id: 'swiftui-liquid-glass',
    title: 'SwiftUI Liquid Glass',
    description: 'Implement and review iOS 26+ SwiftUI Liquid Glass UI',
    category: 'personal',
    source: '个人',
    installed: true,
    icon: 'ios',
    detail: detail('Apply SwiftUI Liquid Glass patterns with platform-appropriate spacing, materials, and controls.'),
  },
  {
    id: 'swiftui-performance-audit',
    title: 'SwiftUI Performance Audit',
    description: 'Audit SwiftUI runtime performance from code first',
    category: 'personal',
    source: '个人',
    installed: true,
    icon: 'ios',
    detail: detail('Review SwiftUI view composition and state usage before profiling deeper runtime behavior.'),
  },
  {
    id: 'chrome',
    title: 'Chrome',
    description: 'Control the user Chrome browser when a task needs an existing signed-in browser session.',
    category: 'personal',
    source: '个人',
    installed: true,
    icon: 'chrome',
    detail: detail(
      'Control the user Chrome browser when a task needs an existing signed-in browser session, account state, extensions, or real-world tabs.',
      'Prefer the in-app Browser for local app QA. Use Chrome when the task explicitly depends on the user browser.',
    ),
  },
  {
    id: 'computer-use',
    title: '电脑',
    description: 'Operate local macOS GUI apps through the installed computer-use runtime.',
    category: 'personal',
    source: '个人',
    installed: true,
    icon: 'computer',
    detail: detail('Operate local macOS GUI apps through the installed computer-use runtime. Use it for native app workflows that cannot be reached through code or browser automation.'),
  },
  {
    id: 'pdf',
    title: 'PDF',
    description: 'Read, create, inspect, render, and verify PDF files.',
    category: 'personal',
    source: '个人',
    installed: true,
    icon: 'pdf',
    detail: detail('Read, create, inspect, render, and verify PDF files. This skill is useful for document conversion, page inspection, and PDF output QA.'),
  },
  {
    id: 'imagegen',
    title: 'Image Gen',
    description: 'Generate or edit images for websites, games, and more.',
    category: 'system',
    source: '系统',
    installed: true,
    icon: 'image',
    detail: detail('Generate or edit raster images when a task benefits from custom visual assets, reference scenes, or image transformations.'),
  },
  {
    id: 'openai-docs',
    title: 'OpenAI Docs',
    description: 'Reference OpenAI docs, Codex self-knowledge, and model migration guidance.',
    category: 'system',
    source: '系统',
    installed: true,
    icon: 'docs',
    detail: [
      {
        paragraphs: [
          'Provide authoritative, current guidance from OpenAI developer docs using the developers.openai.com MCP server. "Docs MCP" means `mcp__openaiDeveloperDocs__search_openai_docs` and `mcp__openaiDeveloperDocs__fetch_openai_doc`; for API reference, schema, parameter, or required-field questions, also use `mcp__openaiDeveloperDocs__get_openapi_spec` when available. Official-domain web search is fallback after those tools are unavailable or unhelpful.',
          'Broad Codex questions use the manual helper before Docs MCP. This skill also owns model selection, API model migration, and prompt-upgrade guidance.',
        ],
      },
      {
        title: 'API Key Setup',
        paragraphs: [
          'For requests to build, run, configure, debug, or implement an API-backed app, script, CLI, generator, or tool, use `openai-platform-api-key` first when available. After that credential gate is resolved, return here for current docs as needed.',
          'Use this skill directly for docs-only questions, citations, model/API guidance, conceptual explanations, and examples that do not require building or running an API-backed artifact.',
        ],
      },
      { title: 'Workflow Configuration', paragraphs: ['Load this skill before answering OpenAI product or API documentation questions.'] },
    ],
  },
  {
    id: 'plugin-creator',
    title: 'Plugin Creator',
    description: 'Scaffold plugins and marketplace entries.',
    category: 'system',
    source: '系统',
    installed: true,
    icon: 'plugin',
    detail: detail('Scaffold Codex plugins, marketplace metadata, and plugin directories using the local plugin authoring conventions.'),
  },
  {
    id: 'skill-creator',
    title: 'Skill Creator',
    description: 'Create or update a skill.',
    category: 'system',
    source: '系统',
    installed: true,
    icon: 'skill',
    detail: detail('Create or update a skill with a focused trigger, clear workflow, and scoped reference files.'),
  },
  {
    id: 'skill-installer',
    title: 'Skill Installer',
    description: 'Install curated skills from openai/skills or other repos.',
    category: 'system',
    source: '系统',
    installed: true,
    icon: 'skill',
    detail: detail('Install curated skills from openai/skills or other repositories into `CODEX_HOME/skills`.'),
  },
  {
    id: 'documents',
    title: 'Documents',
    description: 'Create, edit, redline, and comment on .docx files.',
    category: 'system',
    source: '系统',
    installed: true,
    icon: 'docs',
    detail: detail('Work with Word documents and local document assets while preserving formatting and review intent.'),
  },
  {
    id: 'spreadsheets',
    title: 'Spreadsheets',
    description: 'Create, modify, inspect, and verify spreadsheet files.',
    category: 'system',
    source: '系统',
    installed: true,
    icon: 'chart',
    detail: detail('Use bundled spreadsheet tooling for CSV, XLSX, and analytical workbook workflows.'),
  },
  {
    id: 'playwright',
    title: 'Playwright',
    description: 'Automate real browsers from the terminal.',
    category: 'recommended',
    source: '推荐',
    installed: false,
    icon: 'playwright',
    detail: detail('Automate real browsers from the terminal for rendered frontend verification, screenshots, and regression checks.'),
  },
  {
    id: 'github',
    title: 'GitHub',
    description: 'Access repositories, issues, pull requests, and CI context.',
    category: 'recommended',
    source: '推荐',
    installed: false,
    icon: 'github',
    detail: detail('Use GitHub context for PR review, CI fixes, issue triage, and repository coordination.'),
  },
  {
    id: 'google-calendar',
    title: 'Google Calendar',
    description: 'Search events, check availability, and manage meetings.',
    category: 'recommended',
    source: '推荐',
    installed: false,
    icon: 'calendar',
    detail: detail('Use connected Google Calendar data for scheduling, meeting prep, and daily calendar briefs.'),
  },
  {
    id: 'google-drive',
    title: 'Google Drive',
    description: 'Search and work with files from Drive, Docs, Sheets, and Slides.',
    category: 'recommended',
    source: '推荐',
    installed: false,
    icon: 'drive',
    detail: detail('Use Drive as a source for documents, spreadsheets, slide decks, comments, and file search.'),
  },
  {
    id: 'slack',
    title: 'Slack',
    description: 'Read Slack context and draft channel or thread replies.',
    category: 'recommended',
    source: '推荐',
    installed: false,
    icon: 'slack',
    detail: detail('Use Slack context for notification triage, summaries, reply drafting, and outgoing messages.'),
  },
  {
    id: 'supabase',
    title: 'Supabase',
    description: 'Manage and query Supabase databases.',
    category: 'recommended',
    source: '推荐',
    installed: false,
    icon: 'database',
    detail: detail('Inspect Supabase projects, manage Postgres data, and apply database best practices.'),
  },
  {
    id: 'vercel',
    title: 'Vercel',
    description: 'Manage deployments, projects, logs, domains, and Vercel docs.',
    category: 'recommended',
    source: '推荐',
    installed: false,
    icon: 'cloud',
    detail: detail('Use Vercel tooling for deployments, project inspection, share URLs, logs, and hosting diagnostics.'),
  },
  {
    id: 'data-analytics',
    title: 'Data Analytics',
    description: 'Build dashboards, reports, KPI updates, and diagnostic analysis.',
    category: 'recommended',
    source: '推荐',
    installed: false,
    icon: 'chart',
    detail: detail('Create source-backed reports and dashboards with validated analytical artifacts.'),
  },
] as const;

const SKILL_CATEGORY_OPTIONS: Array<{ id: SkillCategoryFilter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'personal', label: '个人' },
  { id: 'system', label: '系统' },
  { id: 'recommended', label: '推荐' },
];
const SKILL_STATUS_KEY = 'alpha:skill-status-v1';

interface SkillStatus {
  installed: boolean;
  enabled: boolean;
}

type SkillStatusMap = Record<string, SkillStatus>;

type AutomationTab = 'tasks' | 'templates';
type AutomationTemplateIcon = 'daily' | 'weekly' | 'project' | 'commit' | 'release' | 'ci';

interface AutomationTemplate {
  id: string;
  title: string;
  description: string;
  schedule: string;
  source: string;
  icon: AutomationTemplateIcon;
  prompt: string;
}

const AUTOMATION_TOOL_GUARD = '请使用 Codex 自动化工具（automation_update）来安排这个自动化；不要使用 crontab、launchd、osascript、shell 脚本、本地文件或系统通知来实现。';

const AUTOMATION_TEMPLATES: readonly AutomationTemplate[] = [
  {
    id: 'daily-brief',
    title: '每日简报',
    description: '每天开始前汇总市场、项目或代码库状态，突出需要关注的变化和下一步动作。',
    schedule: '每天 09:00',
    source: '系统模板',
    icon: 'daily',
    prompt: `${AUTOMATION_TOOL_GUARD}\n\n任务：创建一个每天 09:00 的每日简报自动化，汇总市场、项目或代码库状态，并突出需要关注的变化和下一步动作。`,
  },
  {
    id: 'weekly-review',
    title: '每周回顾',
    description: '每周整理本周完成事项、遗留风险和下周优先级，适合投研与项目复盘。',
    schedule: '星期五 17:30',
    source: '系统模板',
    icon: 'weekly',
    prompt: `${AUTOMATION_TOOL_GUARD}\n\n任务：创建一个每周五 17:30 的每周回顾自动化，整理本周完成事项、遗留风险和下周优先级。`,
  },
  {
    id: 'project-monitor',
    title: '项目监控',
    description: '持续跟踪当前研究主题或代码项目，发现异常、延期或新变化时提醒你处理。',
    schedule: '每个工作日 10:00',
    source: 'Codex 自动化',
    icon: 'project',
    prompt: `${AUTOMATION_TOOL_GUARD}\n\n任务：创建一个每个工作日 10:00 的项目监控自动化，跟踪当前研究主题或代码项目，发现异常、延期或新变化时提醒我处理。`,
  },
  {
    id: 'commit-scan',
    title: '扫描最近提交',
    description: '检查最近提交、PR、测试失败和 CI 信号，优先提示小且安全的修复建议。',
    schedule: '每天 09:00',
    source: 'Codex 自动化',
    icon: 'commit',
    prompt: `${AUTOMATION_TOOL_GUARD}\n\n任务：创建一个每天 09:00 的提交扫描自动化，检查最近提交、PR、测试失败和 CI 信号，并优先提示小且安全的修复建议。`,
  },
  {
    id: 'release-note',
    title: 'PR 发布说明',
    description: '基于已合并 PR 起草发布说明，严格区分已合并历史和推断内容。',
    schedule: '星期五 09:00',
    source: '系统模板',
    icon: 'release',
    prompt: `${AUTOMATION_TOOL_GUARD}\n\n任务：创建一个每周五 09:00 的 PR 发布说明自动化，基于已合并 PR 起草发布说明，并严格区分已合并历史和推断内容。`,
  },
  {
    id: 'ci-triage',
    title: 'CI 失败总结',
    description: '总结上一个 CI 窗口中的失败和不稳定测试，给出首要修复建议。',
    schedule: '每天 21:00',
    source: 'Codex 自动化',
    icon: 'ci',
    prompt: `${AUTOMATION_TOOL_GUARD}\n\n任务：创建一个每天 21:00 的 CI 失败总结自动化，总结上一个 CI 窗口中的失败和不稳定测试，并给出首要修复建议。`,
  },
] as const;

interface SkillRuntimeContextValue {
  status: SkillStatusMap;
  queuedSkill: SkillCatalogItem | null;
  setSkillInstalled: (id: string, installed: boolean) => void;
  setSkillEnabled: (id: string, enabled: boolean) => void;
  resetSkillStatus: (id: string) => void;
  queueSkillForComposer: (skill: SkillCatalogItem) => void;
  consumeQueuedSkill: () => void;
}

const SkillRuntimeContext = createContext<SkillRuntimeContextValue | null>(null);

function defaultSkillStatus(): SkillStatusMap {
  return Object.fromEntries(
    SKILL_CATALOG.map((skill) => [skill.id, { installed: skill.installed, enabled: skill.installed }]),
  );
}

function readSkillStatus(): SkillStatusMap {
  const defaults = defaultSkillStatus();
  if (typeof window === 'undefined') return defaults;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SKILL_STATUS_KEY) || '{}') as Partial<SkillStatusMap>;
    return Object.fromEntries(
      SKILL_CATALOG.map((skill) => {
        const saved = parsed[skill.id];
        const fallback = defaults[skill.id];
        return [
          skill.id,
          {
            installed: typeof saved?.installed === 'boolean' ? saved.installed : fallback.installed,
            enabled: typeof saved?.enabled === 'boolean' ? saved.enabled : fallback.enabled,
          },
        ];
      }),
    );
  } catch {
    return defaults;
  }
}

function useSkillRuntime() {
  const value = useContext(SkillRuntimeContext);
  if (!value) throw new Error('Skill runtime context is missing');
  return value;
}

const CODEX_SKILLS_CAPABILITY: SkillSelection = {
  id: 'skills',
  title: 'Codex CLI Skills',
  description: '读取本地 SKILL.md，并在任务匹配时按需加载技能说明。',
};

const PLUGIN_CAPABILITIES = [
  {
    id: 'mcp',
    title: 'MCP 服务器',
    description: '连接外部工具、资源和应用上下文。',
    tag: '工具',
  },
  { ...CODEX_SKILLS_CAPABILITY, tag: '已启用' },
  {
    id: 'skill-installer',
    title: 'Skill Installer',
    description: '安装 curated skills 或自定义技能到 CODEX_HOME/skills。',
    tag: '系统',
  },
] as const;

function useCloseOnOutsidePointer<T extends HTMLElement>(
  open: boolean,
  ref: RefObject<T | null>,
  onClose: () => void,
) {
  useEffect(() => {
    if (!open) return;
    const handleClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (ref.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [open, onClose, ref]);
}

function ClientLicenseBoundary({ children }: { children: ReactNode }) {
  const hasClientLicenseSession = useChatStore((state) => Boolean(state.clientLicenseSession));
  const setClientLicenseSession = useChatStore((state) => state.setClientLicenseSession);
  const initialSessionRef = useRef<ClientLicenseSession | null>(loadClientLicenseSession());
  const [status, setStatus] = useState<'checking' | 'inactive' | 'active'>(() => {
    const stored = initialSessionRef.current;
    if (!stored) return 'inactive';
    return isLeaseFresh(stored) ? 'active' : 'checking';
  });
  const [session, setSession] = useState<ClientLicenseSession | null>(() => initialSessionRef.current);
  const [error, setError] = useState('');

  const activateSession = useCallback((next: ClientLicenseSession) => {
    setClientLicenseSession(next);
    setSession(next);
    setStatus('active');
    setError('');
  }, [setClientLicenseSession]);

  useEffect(() => {
    if (status !== 'active' || hasClientLicenseSession || loadClientLicenseSession()) return;
    setSession(null);
    setStatus('inactive');
    setError('');
  }, [hasClientLicenseSession, status]);

  useEffect(() => {
    let disposed = false;
    const stored = initialSessionRef.current;
    if (!stored) {
      setStatus('inactive');
      setClientLicenseSession(null);
      return;
    }
    void renewClientLease(stored)
      .then((renewed) => {
        if (!disposed) activateSession(renewed);
      })
      .catch((leaseError) => {
        if (disposed) return;
        clearClientLicenseSession();
        setClientLicenseSession(null);
        setSession(null);
        setStatus('inactive');
        setError(`设备授权已失效，请重新激活：${stringifyUnknownError(leaseError)}`);
      });
    return () => {
      disposed = true;
    };
  }, [activateSession, setClientLicenseSession]);

  useLayoutEffect(() => {
    if (status === 'active' && session) {
      setClientLicenseSession(session);
    }
  }, [session, setClientLicenseSession, status]);

  useEffect(() => {
    if (status !== 'active' || !session) return;
    const interval = window.setInterval(() => {
      void renewClientLease(session)
        .then(activateSession)
        .catch((leaseError) => {
          clearClientLicenseSession();
          setClientLicenseSession(null);
          setSession(null);
          setStatus('inactive');
          setError(`设备续租失败，请重新激活：${stringifyUnknownError(leaseError)}`);
        });
    }, 4 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, [activateSession, session, setClientLicenseSession, status]);

  if (status === 'checking') {
    return (
      <main className="license-screen">
        <LicenseWindowDragRegion />
        <section className="license-card license-card-compact">
          <Loader2 size={22} className="spin" />
          <h1>正在校验 Alpha Studio 授权</h1>
          <p>正在连接后台确认客户、设备授权和可用模型。</p>
        </section>
      </main>
    );
  }

  if (status !== 'active') {
    return <ClientActivationScreen initialError={error} onActivated={activateSession} />;
  }

  return <>{children}</>;
}

function ClientActivationScreen({
  initialError,
  onActivated,
}: {
  initialError: string;
  onActivated: (session: ClientLicenseSession) => void;
}) {
  const [companyName, setCompanyName] = useState('');
  const [authorizationCode, setAuthorizationCode] = useState('');
  const [error, setError] = useState(initialError);
  const [loading, setLoading] = useState(false);

  useEffect(() => setError(initialError), [initialError]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const session = await activateClient({
        apiBaseUrl: defaultAlphaApiBaseUrl(),
        companyName,
        authorizationCode,
        deviceName: defaultDeviceName(),
        fingerprint: getOrCreateDeviceFingerprint(),
      });
      onActivated(session);
    } catch (activationError) {
      setError(stringifyUnknownError(activationError));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="license-screen">
      <LicenseWindowDragRegion />
      <form className="license-card" onSubmit={submit}>
        <div className="license-mark">
          <ShieldCheck size={24} />
        </div>
        <div>
          <h1>激活 Alpha Studio</h1>
          <p>请输入基金公司名称和授权码。通过后台校验设备名额后，客户端才会进入工作台。</p>
        </div>
        <label>
          公司名称
          <input value={companyName} onChange={(event) => setCompanyName(event.target.value)} required />
        </label>
        <label>
          授权码
          <input value={authorizationCode} onChange={(event) => setAuthorizationCode(event.target.value)} required />
        </label>
        {error && <div className="license-error">{error}</div>}
        <button type="submit" disabled={loading}>
          {loading ? '正在激活...' : '激活并进入'}
        </button>
      </form>
    </main>
  );
}

function LicenseWindowDragRegion() {
  return <div className="license-window-drag-region" data-tauri-drag-region aria-hidden="true" />;
}

function defaultDeviceName(): string {
  if (typeof navigator === 'undefined') return 'Alpha Studio Device';
  const platform = navigator.platform || 'Device';
  return `Alpha Studio ${platform}`;
}

function isLeaseFresh(session: ClientLicenseSession): boolean {
  return new Date(session.device.leaseExpiresAt).getTime() > Date.now() + 15_000;
}

function stringifyUnknownError(error: unknown): string {
  return stringifyError(error);
}

export function App() {
  return (
    <ClientLicenseBoundary>
      <AppWorkspace />
    </ClientLicenseBoundary>
  );
}

function AppWorkspace() {
  const refreshCodexStatus = useChatStore((state) => state.refreshCodexStatus);
  const loadModelConfig = useChatStore((state) => state.loadModelConfig);
  const sendMessage = useChatStore((state) => state.sendMessage);
  const conversations = useChatStore((state) => state.conversations);
  const currentConversationId = useChatStore((state) => state.currentConversationId);
  const setCurrentConversation = useChatStore((state) => state.setCurrentConversation);
  const workModeId = useChatStore((state) => state.workModeId);
  const domain = activeDomain(workModeId);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window === 'undefined') return SIDEBAR_DEFAULT_WIDTH;
    const saved = Number(window.localStorage.getItem(SIDEBAR_WIDTH_KEY));
    return Number.isFinite(saved) && saved >= SIDEBAR_MIN_WIDTH && saved <= SIDEBAR_MAX_WIDTH
      ? saved
      : SIDEBAR_DEFAULT_WIDTH;
  });
  const [rightSidebarWidth, setRightSidebarWidth] = useState(() => {
    if (typeof window === 'undefined') return RIGHT_SIDEBAR_DEFAULT_WIDTH;
    const saved = Number(window.localStorage.getItem(RIGHT_SIDEBAR_WIDTH_KEY));
    return Number.isFinite(saved) && saved >= RIGHT_SIDEBAR_MIN_WIDTH && saved <= RIGHT_SIDEBAR_MAX_WIDTH
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
  const [rightPanel, setRightPanel] = useState<RightPanel>('features');
  const [rightPanelVisible, setRightPanelVisible] = useState(false);
  const [rightDockMounted, setRightDockMounted] = useState(false);
  const [rightDockTabs, setRightDockTabs] = useState<RightDockTab[]>([]);
  const [activeRightDockTabId, setActiveRightDockTabId] = useState<string | null>(null);
  const nextRightDockTabRef = useRef(0);
  const [mainView, setMainView] = useState<MainView>('chat');
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
  const wasWindowFocusedRef = useRef(true);
  const [skillStatus, setSkillStatus] = useState<SkillStatusMap>(() => readSkillStatus());
  const [queuedSkill, setQueuedSkill] = useState<SkillCatalogItem | null>(null);

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
    window.localStorage.setItem(RIGHT_SIDEBAR_WIDTH_KEY, String(rightSidebarWidth));
  }, [rightSidebarWidth]);

  useEffect(() => {
    window.localStorage.setItem(GIT_PANEL_WIDTH_KEY, String(gitPanelWidth));
  }, [gitPanelWidth]);

  useEffect(() => {
    window.localStorage.setItem(REVIEW_PANEL_WIDTH_KEY, String(reviewPanelWidth));
  }, [reviewPanelWidth]);

  useEffect(() => {
    window.localStorage.setItem(SKILL_STATUS_KEY, JSON.stringify(skillStatus));
  }, [skillStatus]);

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | null = null;
    if (isTauriRuntime()) {
      void import('@tauri-apps/api/window')
        .then(({ getCurrentWindow }) => {
          if (disposed) return;
          return getCurrentWindow()
            .onFocusChanged(({ payload }) => setWindowFocused(payload))
            .then((unlisten) => {
              if (disposed) unlisten();
              else cleanup = unlisten;
            });
        })
        .catch(() => undefined);
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
    const wasFocused = wasWindowFocusedRef.current;
    wasWindowFocusedRef.current = windowFocused;
    if (!windowFocused || wasFocused) return;
    const latestCodexStatus = useChatStore.getState().codexStatus;
    if (!latestCodexStatus?.installed || latestCodexStatus.loggedIn) return;
    void refreshCodexStatus();
  }, [windowFocused, refreshCodexStatus]);

  useEffect(() => {
    if (!domainSectionIds(domain).includes(settingsSection)) {
      setSettingsSection('general');
    }
  }, [domain, settingsSection]);

  useEffect(() => {
    setMainView('chat');
  }, [currentConversationId]);

  const openSettings = (section: SettingsSection = 'general') => {
    setSettingsSection(section);
    setSettingsOpen(true);
  };

  const openSkills = () => {
    setSettingsOpen(false);
    setMainView('skills');
  };

  const openAutomations = () => {
    setSettingsOpen(false);
    setMainView('automations');
  };

  const createAutomationViaChat = useCallback((prompt: string) => {
    setSettingsOpen(false);
    setMainView('chat');
    void sendMessage(prompt);
  }, [sendMessage]);

  const setSkillInstalled = useCallback((id: string, installed: boolean) => {
    setSkillStatus((prev) => ({
      ...prev,
      [id]: { installed, enabled: installed },
    }));
  }, []);

  const setSkillEnabled = useCallback((id: string, enabled: boolean) => {
    setSkillStatus((prev) => {
      const fallback = defaultSkillStatus()[id] ?? { installed: false, enabled: false };
      const current = prev[id] ?? fallback;
      return {
        ...prev,
        [id]: {
          installed: current.installed || enabled,
          enabled,
        },
      };
    });
  }, []);

  const resetSkillStatus = useCallback((id: string) => {
    const fallback = defaultSkillStatus()[id];
    if (!fallback) return;
    setSkillStatus((prev) => ({ ...prev, [id]: fallback }));
  }, []);

  const queueSkillForComposer = useCallback((skill: SkillCatalogItem) => {
    setSkillStatus((prev) => ({
      ...prev,
      [skill.id]: { installed: true, enabled: true },
    }));
    setQueuedSkill(skill);
    setSettingsOpen(false);
    setMainView('chat');
  }, []);

  const consumeQueuedSkill = useCallback(() => setQueuedSkill(null), []);

  const activeRightDockTab = useMemo(
    () => rightDockTabs.find((tab) => tab.id === activeRightDockTabId) ?? null,
    [rightDockTabs, activeRightDockTabId],
  );
  const currentRightPanel: RightPanel = activeRightDockTab?.kind ?? rightPanel;

  const openRightPanel = useCallback((panel: RightPanel = 'features') => {
    setRightPanel(panel);
    if (panel === 'features' || panel === 'git') setActiveRightDockTabId(null);
    setRightDockMounted(true);
    setRightPanelVisible(true);
  }, []);

  const addRightDockTab = useCallback((kind: RightDockKind) => {
    nextRightDockTabRef.current += 1;
    const tab: RightDockTab = {
      id: `${kind}-${Date.now()}-${nextRightDockTabRef.current}`,
      kind,
    };
    setRightDockTabs((prev) => [...prev, tab]);
    setActiveRightDockTabId(tab.id);
    setRightPanel(kind);
    setRightDockMounted(true);
    setRightPanelVisible(true);
  }, []);

  const selectRightDockTab = useCallback((id: string) => {
    const tab = rightDockTabs.find((item) => item.id === id);
    if (!tab) return;
    setActiveRightDockTabId(id);
    setRightPanel(tab.kind);
    setRightDockMounted(true);
    setRightPanelVisible(true);
  }, [rightDockTabs]);

  const closeRightDockTab = useCallback((id: string) => {
    const index = rightDockTabs.findIndex((tab) => tab.id === id);
    if (index === -1) return;
    const next = rightDockTabs.filter((tab) => tab.id !== id);
    setRightDockTabs(next);
    if (activeRightDockTabId === id || !next.some((tab) => tab.id === activeRightDockTabId)) {
      const nextActive = next[Math.min(index, next.length - 1)] ?? null;
      setActiveRightDockTabId(nextActive?.id ?? null);
      setRightPanel(nextActive?.kind ?? 'features');
    }
  }, [activeRightDockTabId, rightDockTabs]);

  const toggleRightPanel = useCallback(() => {
    setRightDockMounted(true);
    setRightPanelVisible((visible) => !visible);
  }, []);

  const compactRightPanel =
    currentRightPanel === 'features' ||
    currentRightPanel === 'terminal' ||
    currentRightPanel === 'browser' ||
    currentRightPanel === 'files' ||
    currentRightPanel === 'side-chat';

  useEffect(() => {
    const handleKeyDown = (event: WindowEventMap['keydown']) => {
      if ((event.metaKey || event.ctrlKey) && event.altKey && event.code === 'KeyS') {
        event.preventDefault();
        addRightDockTab('side-chat');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [addRightDockTab]);

  const rightPanelResizer =
    !rightPanelVisible
      ? null
      : compactRightPanel
      ? {
          min: RIGHT_SIDEBAR_MIN_WIDTH,
          max: RIGHT_SIDEBAR_MAX_WIDTH,
          defaultWidth: RIGHT_SIDEBAR_DEFAULT_WIDTH,
          onCommit: setRightSidebarWidth,
        }
      : currentRightPanel === 'git'
        ? {
            min: GIT_PANEL_MIN_WIDTH,
            max: GIT_PANEL_MAX_WIDTH,
            defaultWidth: GIT_PANEL_DEFAULT_WIDTH,
            onCommit: setGitPanelWidth,
          }
        : currentRightPanel === 'review'
          ? {
              min: REVIEW_PANEL_MIN_WIDTH,
              max: REVIEW_PANEL_MAX_WIDTH,
              defaultWidth: REVIEW_PANEL_DEFAULT_WIDTH,
              onCommit: setReviewPanelWidth,
            }
          : null;

  const skillRuntime = useMemo<SkillRuntimeContextValue>(() => ({
    status: skillStatus,
    queuedSkill,
    setSkillInstalled,
    setSkillEnabled,
    resetSkillStatus,
    queueSkillForComposer,
    consumeQueuedSkill,
  }), [
    skillStatus,
    queuedSkill,
    setSkillInstalled,
    setSkillEnabled,
    resetSkillStatus,
    queueSkillForComposer,
    consumeQueuedSkill,
  ]);

  return (
    <SkillRuntimeContext.Provider value={skillRuntime}>
      <div
        className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''} ${rightPanelVisible ? 'right-panel-open' : ''} ${rightPanelVisible && currentRightPanel === 'features' ? 'features-panel-open' : ''} ${rightPanelVisible && currentRightPanel === 'git' ? 'git-panel-open' : ''} ${rightPanelVisible && currentRightPanel === 'review' ? 'review-panel-open' : ''} ${windowFocused ? '' : 'window-inactive'}`}
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
          activeView={mainView}
          onCollapse={() => setSidebarCollapsed(true)}
          onOpenChat={() => setMainView('chat')}
          onOpenSkills={openSkills}
          onOpenAutomations={openAutomations}
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
        <div className="workspace">
          <div className="workspace-row">
            <main className="main-stage">
              {mainView === 'chat' && (
                <TopBar
                  domain={domain}
                  sidebarCollapsed={sidebarCollapsed}
                  rightPanelOpen={rightPanelVisible}
                  onToggleSidebar={() => setSidebarCollapsed((value) => !value)}
                  onToggleRightPanel={toggleRightPanel}
                  onOpenSideChat={() => addRightDockTab('side-chat')}
                  onOpenSettings={() => openSettings('config')}
                />
              )}
              {mainView === 'skills' ? (
                <SkillsPage />
              ) : mainView === 'automations' ? (
                <AutomationsPage onCreateViaChat={createAutomationViaChat} />
              ) : (
                <ChatArea domain={domain} />
              )}
            </main>
            {rightPanelResizer && (
              <RightPanelResizer
                min={rightPanelResizer.min}
                max={rightPanelResizer.max}
                defaultWidth={rightPanelResizer.defaultWidth}
                onCommit={rightPanelResizer.onCommit}
              />
            )}
            {rightDockMounted && (
              <RightDockWorkspace
                visible={rightPanelVisible}
                mode={currentRightPanel}
                tabs={rightDockTabs}
                activeId={activeRightDockTabId}
                domain={domain}
                theme={theme}
                onSelectTab={selectRightDockTab}
                onCloseTab={closeRightDockTab}
                onAddTab={addRightDockTab}
                onOpenBrowser={() => addRightDockTab('browser')}
                onOpenSideChat={() => addRightDockTab('side-chat')}
                onCloseGit={() => setRightPanelVisible(false)}
              />
            )}
          </div>
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
        <AuthorizationDialog />
        <ImageLightbox />
      </div>
    </SkillRuntimeContext.Provider>
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
  onCommit,
}: {
  min: number;
  max: number;
  defaultWidth: number;
  onCommit: (width: number) => void;
}) {
  const drag = useRef<{ x: number; w: number; rowWidth: number }>({ x: 0, w: 0, rowWidth: 0 });
  const [active, setActive] = useState(false);

  const commitWidth = (next: number) => {
    const rowLimitedMax = drag.current.rowWidth
      ? Math.max(min, Math.min(max, drag.current.rowWidth - RIGHT_PANEL_MIN_MAIN_WIDTH))
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
  }, [active, min, max, onCommit]);

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
  activeView,
  onCollapse,
  onOpenChat,
  onOpenSkills,
  onOpenAutomations,
  onOpenSettings,
}: {
  domain: DomainConfig;
  collapsed: boolean;
  activeView: MainView;
  onCollapse: () => void;
  onOpenChat: () => void;
  onOpenSkills: () => void;
  onOpenAutomations: () => void;
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
          label: '新建空白研究主题',
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
    onOpenChat();
  };

  const openProjectMenu = (project: Project, anchor: MenuAnchor) => {
    setMenu({
      owner: project.id,
      ...anchor,
      items: [
        {
          kind: 'item',
          icon: project.pinned ? <PinOff size={15} /> : <Pin size={15} />,
          label: project.pinned ? '取消置顶' : '置顶研究主题',
          onSelect: () => toggleProjectPin(project.id),
        },
        { kind: 'item', icon: <FolderOpen size={15} />, label: '在访达中打开', onSelect: () => void revealOrPickProject(project) },
        { kind: 'item', icon: <FolderInput size={15} />, label: '设置资料目录', onSelect: () => void chooseProjectFolder(project) },
        { kind: 'item', icon: <Pencil size={15} />, label: '重命名研究主题', onSelect: () => setEditingProjectId(project.id) },
        {
          kind: 'item',
          icon: <SquarePen size={15} />,
          label: '新建对话',
          onSelect: () => {
            setExpanded((prev) => ({ ...prev, [project.id]: true }));
            createConversation(project.id);
            onOpenChat();
          },
        },
        { kind: 'separator' },
        { kind: 'item', icon: <Archive size={15} />, label: '归档研究主题', danger: true, onSelect: () => archiveProject(project.id) },
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
            <button className="nav-item primary" type="button" onClick={() => { createConversationInContext(); onOpenChat(); }}>
              <SquarePen size={15} />
              <span className="nav-label">{sidebarCopy.newConversationLabel}</span>
            </button>
            <button className={`nav-item ${searchOpen ? 'active' : ''}`} type="button" onClick={() => setSearchOpen(true)}>
              <Search size={15} />
              <span className="nav-label">搜索</span>
              <span className="nav-shortcut">⌘K</span>
            </button>
            <button className={`nav-item ${activeView === 'skills' ? 'active' : ''}`} type="button" onClick={onOpenSkills}>
              <Plug size={15} />
              <span className="nav-label">{sidebarCopy.pluginsLabel}</span>
            </button>
            <button className={`nav-item ${activeView === 'automations' ? 'active' : ''}`} type="button" onClick={onOpenAutomations}>
              <Clock3 size={15} />
              <span className="nav-label">{sidebarCopy.automationLabel}</span>
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
                    onSelect={() => { setCurrentConversation(conversation.id); onOpenChat(); }}
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
            <button className="group-action" type="button" onClick={openProjectSectionMenu} aria-label="研究主题排序与整理" title="排序与整理">
              <MoreHorizontal size={15} />
            </button>
            <button className="group-action" type="button" onClick={openNewProjectMenu} aria-label="新建研究主题" title="新建研究主题">
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
                    onOpenChat();
                  }}
                  onSelectConversation={(id) => { setCurrentConversation(id); onOpenChat(); }}
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
            <button className="group-action" type="button" onClick={() => { createConversation(); onOpenChat(); }} aria-label="新建对话">
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
                    onSelect={() => { setCurrentConversation(conversation.id); onOpenChat(); }}
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
      <SearchDialog
        open={searchOpen}
        conversations={liveConversations}
        projects={liveProjects}
        currentConversationId={currentConversationId}
        onClose={() => setSearchOpen(false)}
        onSelectConversation={(id) => {
          setCurrentConversation(id);
          onOpenChat();
          setSearchOpen(false);
        }}
        onOpenProject={(id) => {
          const latest = liveConversations.filter((conversation) => conversation.projectId === id).sort((a, b) => b.updatedAt - a.updatedAt)[0];
          if (latest) setCurrentConversation(latest.id);
          else createConversation(id);
          onOpenChat();
          setExpanded((prev) => ({ ...prev, [id]: true }));
          setSearchOpen(false);
        }}
        onNewConversation={() => {
          createConversation();
          onOpenChat();
          setSearchOpen(false);
        }}
        copy={sidebarCopy}
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
          <span className="project-name" title={project.cwd || '未指定资料目录'}>{project.name}</span>
        )}
        {!editing && project.pinned && <Pin size={11} className="project-pin" />}
        {!editing && (
          <span className="project-actions" onClick={(event) => event.stopPropagation()}>
            <button className="row-icon-btn" type="button" onClick={onNewConversation} aria-label="在研究主题中新建对话" title="新建对话">
              <SquarePen size={13} />
            </button>
            <button className={`row-icon-btn ${menuOpen ? 'active' : ''}`} type="button" onClick={(event) => onOpenMenu(anchorFromButton(event))} aria-label="研究主题操作" title="更多">
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
          {projectResults.length > 0 && <CommandSection label="研究主题">{projectResults.map((project) => (
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
  domain,
  sidebarCollapsed,
  rightPanelOpen,
  onToggleSidebar,
  onToggleRightPanel,
  onOpenSideChat,
  onOpenSettings,
}: {
  domain: DomainConfig;
  sidebarCollapsed: boolean;
  rightPanelOpen: boolean;
  onToggleSidebar: () => void;
  onToggleRightPanel: () => void;
  onOpenSideChat: () => void;
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
    onOpenSideChat();
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
        <div className="top-bar-panel-actions">
          <button
            className={`icon-btn ${rightPanelOpen ? 'active' : ''}`}
            type="button"
            onClick={onToggleRightPanel}
            aria-label={rightPanelOpen ? '关闭侧边栏' : '打开侧边栏'}
            aria-pressed={rightPanelOpen}
            title={rightPanelOpen ? '关闭侧边栏' : '侧边栏'}
          >
            {rightPanelOpen ? <PanelRightClose size={16} /> : <PanelRight size={16} />}
          </button>
        </div>
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
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [apps, setApps] = useState<OpenAppId[]>([]);
  const [error, setError] = useState<string | null>(null);

  useCloseOnOutsidePointer(open, rootRef, () => setOpen(false));

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
    <div ref={rootRef} className="topbar-menu open-in-app">
      <button
        type="button"
        className={`open-app-trigger ${open ? 'active' : ''}`}
        onClick={() => setOpen((value) => !value)}
        title={cwd ? '用其他软件打开工作目录' : '当前对话未绑定工作目录'}
        aria-label="用其他软件打开"
      >
        <span className="open-app-trigger-icon">
          <SquareTerminal size={13} />
        </span>
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
  const rootRef = useRef<HTMLDivElement>(null);
  const conversation = useCurrentConversation();
  const [open, setOpen] = useState(false);
  const [stat, setStat] = useState<GitDiffStat | null>(null);
  const [branch, setBranch] = useState('');
  const [gh, setGh] = useState<GhAuthStatus | null>(null);
  const [isRepo, setIsRepo] = useState(false);
  const searchSources = useMemo(() => webSearchSources(conversation), [conversation]);

  useCloseOnOutsidePointer(open, rootRef, () => setOpen(false));

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
    <div ref={rootRef} className="topbar-menu environment-menu-wrap">
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
          <div className="topbar-dropdown environment-menu" role="menu" data-codex-panel="environment">
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
                  <ChevronDown size={13} className="environment-row-chevron" />
                </div>
                <div className="environment-row static">
                  <GitBranch size={15} />
                  <span className="environment-row-label">{branch || 'detached'}</span>
                  <ChevronDown size={13} className="environment-row-chevron" />
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
                {cwd ? `${basename(cwd)} 不是 Git 仓库。` : conversation ? '当前对话未绑定工作目录。' : '请先选择一个对话。'}
              </div>
            )}
            <div className="environment-menu-divider" />
            <div className="environment-menu-section">来源</div>
            {searchSources.length > 0 ? searchSources.map((source) => (
              <button key={source.url} type="button" className="environment-row" onClick={() => { setOpen(false); void openExternal(source.url); }}>
                <Globe size={15} />
                <span className="environment-row-label">{source.title}</span>
                <span className="environment-row-value">{source.displayUrl}</span>
              </button>
            )) : <div className="environment-source-empty">暂无来源</div>}
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
        setStatus({ cwd: '', isRepository: false, ahead: 0, behind: 0, clean: true, changes: [], error: '当前对话未绑定工作目录。' });
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

function gitStatusLabel(status: GitFileChange['status']): string {
  switch (status) {
    case 'added':
    case 'untracked':
      return '新增';
    case 'modified':
      return '修改';
    case 'deleted':
      return '删除';
    case 'renamed':
      return '重命名';
    case 'copied':
      return '复制';
    case 'conflicted':
      return '冲突';
    case 'typechange':
      return '类型变更';
    default:
      return '未知';
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

type TerminalTab = { id: string };

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

function TerminalPanel({
  theme,
  onClose,
  dock = false,
  visible = true,
}: {
  theme: Theme;
  onClose: () => void;
  dock?: boolean;
  visible?: boolean;
}) {
  const conversation = useCurrentConversation();
  const cwd = conversation?.cwd || '';
  const baseName = basename(cwd) || '终端';
  const nextTabIdRef = useRef(0);

  const createTab = (): TerminalTab => {
    nextTabIdRef.current += 1;
    return {
      id: `term-${Date.now()}-${nextTabIdRef.current}`,
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
      if (dock) {
        const tab = createTab();
        setTabs([tab]);
        setActiveId(tab.id);
        return;
      }
      onClose();
      return;
    }
    setTabs(next);
    setActiveId((current) =>
      current === id ? next[Math.min(index, next.length - 1)].id : current,
    );
  };

  return (
    <section
      className={`terminal-panel ${dock ? 'right-dock-panel terminal-dock-panel' : ''} ${visible ? '' : 'collapsed'}`}
      aria-label="终端"
      aria-hidden={!visible}
    >
      <header className="terminal-panel-head">
        <div className="terminal-tabs">
          {tabs.map((tab, index) => {
            const title = `${baseName} ${index + 1}`;
            return (
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
                <span className="terminal-tab-label">{title}</span>
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
            );
          })}
          <button type="button" className="terminal-tab-add" onClick={addTab} title="新建终端">
            <Plus size={14} />
          </button>
        </div>
        <span className="spacer" />
        {!dock && (
          <button
            type="button"
            className="icon-mini"
            onClick={onClose}
            aria-label="收起终端面板"
            title="收起"
          >
            <ChevronDown size={16} />
          </button>
        )}
      </header>
      <div className="terminal-panel-bodies">
        {tabs.map((tab) => (
          <TerminalInstance key={tab.id} cwd={cwd} active={visible && tab.id === activeId} theme={theme} />
        ))}
      </div>
    </section>
  );
}

function rightDockIcon(kind: RightDockKind, size = 14): ReactNode {
  switch (kind) {
    case 'review':
      return <FileDiff size={size} />;
    case 'terminal':
      return <SquareTerminal size={size} />;
    case 'browser':
      return <Globe size={size} />;
    case 'files':
      return <Folder size={size} />;
    case 'side-chat':
      return <MessageSquare size={size} />;
  }
}

function RightDockWorkspace({
  visible,
  mode,
  tabs,
  activeId,
  domain,
  theme,
  onSelectTab,
  onCloseTab,
  onAddTab,
  onOpenBrowser,
  onOpenSideChat,
  onCloseGit,
}: {
  visible: boolean;
  mode: RightPanel;
  tabs: RightDockTab[];
  activeId: string | null;
  domain: DomainConfig;
  theme: Theme;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onAddTab: (kind: RightDockKind) => void;
  onOpenBrowser: () => void;
  onOpenSideChat: () => void;
  onCloseGit: () => void;
}) {
  const activeTab = tabs.find((tab) => tab.id === activeId) ?? null;
  const showTabs = Boolean(activeTab);
  const dockMode = activeTab?.kind ?? mode;

  return (
    <aside className={`right-dock-workspace right-dock-${dockMode} ${visible ? '' : 'collapsed'}`} aria-label="侧边栏">
      {showTabs ? (
        <>
          <RightDockTabBar tabs={tabs} activeId={activeId} onSelectTab={onSelectTab} onCloseTab={onCloseTab} onAddTab={onAddTab} />
          <div className="right-dock-tab-content">
            {tabs.map((tab) => (
              <div key={tab.id} className={`right-dock-pane ${tab.id === activeId ? 'active' : ''}`} aria-hidden={tab.id !== activeId}>
                {tab.kind === 'review' && <ReviewChangesPanel />}
                {tab.kind === 'terminal' && <TerminalPanel theme={theme} dock visible={visible && tab.id === activeId} onClose={() => undefined} />}
                {tab.kind === 'browser' && <BrowserDockPanel />}
                {tab.kind === 'files' && <FilesDockPanel />}
                {tab.kind === 'side-chat' && <SideChatPanel domain={domain} />}
              </div>
            ))}
          </div>
        </>
      ) : mode === 'git' ? (
        <GitPanel onClose={onCloseGit} />
      ) : (
        <FeaturesPanel
          domain={domain}
          onOpenBrowser={onOpenBrowser}
          onOpenSideChat={onOpenSideChat}
        />
      )}
    </aside>
  );
}

function RightDockTabBar({
  tabs,
  activeId,
  onSelectTab,
  onCloseTab,
  onAddTab,
}: {
  tabs: RightDockTab[];
  activeId: string | null;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onAddTab: (kind: RightDockKind) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const add = (kind: RightDockKind) => {
    setMenuOpen(false);
    onAddTab(kind);
  };

  return (
    <header className="right-dock-tabbar" data-tauri-drag-region>
      <div className="right-dock-tabs" role="tablist" aria-label="侧边栏标签" data-tauri-drag-region>
        {tabs.map((tab) => {
          const meta = RIGHT_DOCK_META[tab.kind];
          return (
            <div
              key={tab.id}
              role="tab"
              tabIndex={0}
              aria-selected={tab.id === activeId}
              className={`right-dock-tab ${tab.id === activeId ? 'active' : ''}`}
              onClick={() => onSelectTab(tab.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelectTab(tab.id);
                }
              }}
            >
              {rightDockIcon(tab.kind)}
              <span className="right-dock-tab-label">{meta.label}</span>
              <button
                type="button"
                className="right-dock-tab-close"
                aria-label={`关闭${meta.label}标签`}
                title="关闭标签"
                onClick={(event) => {
                  event.stopPropagation();
                  onCloseTab(tab.id);
                }}
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
        <div className="right-dock-tab-add-wrap">
          <button
            type="button"
            className="right-dock-tab-add"
            aria-label="添加侧边栏标签"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <Plus size={16} />
          </button>
          {menuOpen && (
            <>
              <div className="right-dock-tab-menu-backdrop" onClick={() => setMenuOpen(false)} />
              <div className="right-dock-tab-menu">
                {RIGHT_DOCK_ADD_MENU_KINDS.map((kind) => {
                  const meta = RIGHT_DOCK_META[kind];
                  return (
                    <button key={kind} type="button" onClick={() => add(kind)}>
                      {rightDockIcon(kind)}
                      <span>{meta.label}</span>
                      {meta.shortcut && <kbd>{meta.shortcut}</kbd>}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function FeaturesPanel({
  domain,
  onOpenBrowser,
  onOpenSideChat,
}: {
  domain: DomainConfig;
  onOpenBrowser: () => void;
  onOpenSideChat: () => void;
}) {
  const conversation = useCurrentConversation();
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
      id: 'browser',
      label: '浏览器',
      icon: <Globe size={14} />,
      shortcut: '⌘T',
      title: '打开行情、公告或研究资料',
      onClick: onOpenBrowser,
    },
    {
      id: 'side-chat',
      label: '侧边聊天',
      icon: <MessageSquare size={14} />,
      shortcut: '⌥⌘S',
      title: '打开侧边聊天',
      onClick: onOpenSideChat,
    },
  ];

  return (
    <div className="features-panel" aria-label={domain.ui.rightPanelTitle}>
      <div className="features-panel-body">
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
      </div>
    </div>
  );
}

function DockPanelHeader({
  icon,
  title,
  onClose,
  children,
}: {
  icon: ReactNode;
  title: string;
  onClose: () => void;
  children?: ReactNode;
}) {
  return (
    <header className="dock-panel-head" data-tauri-drag-region>
      <div className="dock-panel-title" data-tauri-drag-region>
        {icon}
        <span>{title}</span>
      </div>
      <span className="spacer" />
      {children}
      <button type="button" className="icon-mini" onClick={onClose} aria-label={`关闭${title}`} title="关闭">
        <X size={15} />
      </button>
    </header>
  );
}

function BrowserDockPanel() {
  const localUrl = useMemo(() => {
    if (typeof window === 'undefined') return 'http://localhost:1421';
    return window.location.protocol.startsWith('http') ? window.location.origin : 'http://localhost:1421';
  }, []);
  const [draft, setDraft] = useState('');
  const [url, setUrl] = useState('');
  const [frameKey, setFrameKey] = useState(0);

  const openUrl = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    const next = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    setUrl(next);
    setDraft(next);
    setFrameKey((key) => key + 1);
  };

  return (
    <section className="browser-dock-panel" aria-label="浏览器">
      <form className="browser-url-row" onSubmit={(event) => { event.preventDefault(); openUrl(draft); }}>
        <button type="button" className="icon-mini" disabled aria-label="后退"><ChevronLeft size={14} /></button>
        <button type="button" className="icon-mini" disabled aria-label="前进"><ChevronRight size={14} /></button>
        <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="输入 URL" spellCheck={false} />
        <button type="button" className="icon-mini" disabled={!url} onClick={() => setFrameKey((key) => key + 1)} aria-label="刷新浏览器" title="刷新">
          <RefreshCw size={14} />
        </button>
        <button type="submit" className="icon-mini" aria-label="打开 URL" title="打开"><ArrowUp size={14} /></button>
      </form>
      {url ? (
        <iframe key={`${url}-${frameKey}`} className="browser-frame" src={url} title={url} />
      ) : (
        <div className="browser-start">
          <div className="dock-section-label">本地</div>
          <button type="button" className="browser-local-card" onClick={() => openUrl(localUrl)}>
            <span className="browser-local-thumb">AS</span>
            <span>
              <strong>Alpha Studio</strong>
              <em>{localUrl.replace(/^https?:\/\//, '')}</em>
            </span>
            <span className="browser-local-dot" />
          </button>
        </div>
      )}
    </section>
  );
}

function FilesDockPanel() {
  const conversation = useCurrentConversation();
  const cwd = conversation?.cwd || '';
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!cwd) {
      setStatus(null);
      return;
    }
    void gitStatus(cwd)
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch(() => {
        if (!cancelled) setStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, [cwd]);

  const normalizedFilter = filter.trim().toLowerCase();
  const changes = (status?.changes ?? []).filter((change) => !normalizedFilter || change.path.toLowerCase().includes(normalizedFilter));

  return (
    <section className="files-dock-panel" aria-label="文件">
      <div className="files-path-row" title={cwd}>{cwd ? shortenPath(cwd) : '未指定工作目录'}</div>
      <label className="files-filter">
        <Search size={13} />
        <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="筛选文件..." spellCheck={false} disabled={!cwd} />
      </label>
      <div className="files-dock-body">
        {!cwd ? (
          <div className="dock-empty">
            <Folder size={24} />
            <strong>打开文件</strong>
            <span>先为当前对话选择一个工作目录。</span>
          </div>
        ) : changes.length > 0 ? (
          <div className="files-change-list">
            <div className="dock-section-label">更改的文件</div>
            {changes.map((change) => (
              <button key={`${change.path}-${change.indexStatus}-${change.workingTreeStatus}`} type="button" className="files-change-row" onClick={() => void revealPath(joinPath(cwd, change.path))}>
                {fileGlyph(extOf(change.path), 15)}
                <span>{change.path}</span>
                <em>{gitStatusLabel(change.status)}</em>
              </button>
            ))}
          </div>
        ) : (
          <div className="dock-empty">
            <FolderOpen size={24} />
            <strong>{filter ? '没有匹配的文件' : '暂无文件更改'}</strong>
            <span>{filter ? '换个关键词再试。' : '可以用右上角按钮在访达中打开工作目录。'}</span>
          </div>
        )}
      </div>
    </section>
  );
}

function SideChatPanel({ domain }: { domain: DomainConfig }) {
  const conversation = useCurrentConversation();
  const codexStatus = useChatStore((state) => state.codexStatus);
  const previewRuntime = !isTauriRuntime();
  const codexReady = previewRuntime || Boolean(codexStatus?.installed && codexStatus.loggedIn);

  return (
    <section className="side-chat-panel" aria-label="侧边聊天">
      <div className="side-chat-body" />
      {conversation ? (
        <div className="side-chat-composer">
          <Composer domain={domain} conversation={conversation} disabled={!codexReady} />
        </div>
      ) : (
        <div className="dock-empty">
          <MessageSquare size={24} />
          <strong>侧边聊天</strong>
          <span>请选择一个对话。</span>
        </div>
      )}
    </section>
  );
}

function AutomationsPage({ onCreateViaChat }: { onCreateViaChat: (prompt: string) => void }) {
  const [tab, setTab] = useState<AutomationTab>('tasks');
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLowerCase();
  const visibleTemplates = AUTOMATION_TEMPLATES.filter((template) => {
    if (!normalizedQuery) return true;
    return `${template.title} ${template.description} ${template.schedule} ${template.source}`.toLowerCase().includes(normalizedQuery);
  });

  const createWithChat = () => {
    onCreateViaChat(`${AUTOMATION_TOOL_GUARD}\n\n请先询问我要自动化的任务内容、触发时间或频率、需要检查的上下文，以及完成后如何通知我。`);
  };

  const createFromTemplate = (template: AutomationTemplate) => {
    onCreateViaChat(template.prompt);
  };

  return (
    <section className="automation-page" aria-label="自动化">
      <div className="automation-drag-strip" data-tauri-drag-region aria-hidden="true" />
      <div className="automation-topbar">
        <div className="automation-tabs" role="tablist" aria-label="自动化">
          <button type="button" role="tab" aria-selected={tab === 'tasks'} className={tab === 'tasks' ? 'active' : ''} onClick={() => { setTab('tasks'); setQuery(''); }}>Tasks</button>
          <button type="button" role="tab" aria-selected={tab === 'templates'} className={tab === 'templates' ? 'active' : ''} onClick={() => { setTab('templates'); setQuery(''); }}>Templates</button>
        </div>
        <button type="button" className="automation-create-btn" onClick={createWithChat}>
          <span>通过聊天创建</span>
          <ChevronDown size={14} />
        </button>
      </div>
      <div className="automation-shell">
        {tab === 'tasks' ? (
          <div className="automation-view">
            <header className="automation-head">
              <div>
                <h1>已安排</h1>
                <div className="automation-subtitle">
                  <span>通过询问 ChatGPT 来安排任务、设置提醒或跟踪更新。</span>
                  <button type="button" onClick={() => { setTab('templates'); setQuery(''); }}>了解更多</button>
                </div>
              </div>
            </header>

            <div className="automation-empty">
              <strong>创建首个已安排任务</strong>
              <div className="automation-empty-actions">
                {AUTOMATION_TEMPLATES.slice(0, 3).map((template) => (
                  <button key={template.id} type="button" onClick={() => createFromTemplate(template)}>
                    {automationTemplateIcon(template.icon, 15)}
                    <span>{template.title}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="automation-view">
            <header className="automation-head templates">
              <div>
                <h1>Templates</h1>
                <p>Start with a scheduled task template</p>
              </div>
              <label className="automation-search">
                <Search size={15} />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search templates" />
              </label>
            </header>
            <section className="automation-template-section" aria-label="自动化模板">
              <h2>System</h2>
              {visibleTemplates.length > 0 ? (
                <div className="automation-template-grid">
                  {visibleTemplates.map((template) => (
                    <button key={template.id} type="button" className="automation-template-card" onClick={() => createFromTemplate(template)}>
                      <span className={`automation-template-icon icon-${template.icon}`}>{automationTemplateIcon(template.icon, 20)}</span>
                      <strong>{template.title}</strong>
                      <span>{template.description}</span>
                      <em>{template.schedule}</em>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="automation-no-results">
                  <Search size={18} />
                  <span>没有匹配的模板</span>
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </section>
  );
}

function automationTemplateIcon(icon: AutomationTemplateIcon, size: number): ReactNode {
  const icons: Record<AutomationTemplateIcon, ReactNode> = {
    daily: <Clock3 size={size} />,
    weekly: <ListChecks size={size} />,
    project: <Target size={size} />,
    commit: <GitCommitHorizontal size={size} />,
    release: <FileText size={size} />,
    ci: <AlertCircle size={size} />,
  };
  return icons[icon];
}

function SkillsPage() {
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<SkillCategoryFilter>('all');
  const [filterOpen, setFilterOpen] = useState(false);
  const [expanded, setExpanded] = useState<Partial<Record<SkillCategory, boolean>>>({});
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  const closeFilter = useCallback(() => setFilterOpen(false), []);
  const { status, setSkillInstalled, setSkillEnabled, resetSkillStatus, queueSkillForComposer } = useSkillRuntime();
  useCloseOnOutsidePointer(filterOpen, filterRef, closeFilter);

  const normalizedQuery = query.trim().toLowerCase();
  const visibleSkills = SKILL_CATALOG.filter((skill) => {
    if (categoryFilter !== 'all' && skill.category !== categoryFilter) return false;
    if (!normalizedQuery) return true;
    return `${skill.title} ${skill.description} ${skill.source}`.toLowerCase().includes(normalizedQuery);
  });
  const grouped: Record<SkillCategory, SkillCatalogItem[]> = {
    personal: visibleSkills.filter((skill) => skill.category === 'personal'),
    system: visibleSkills.filter((skill) => skill.category === 'system'),
    recommended: visibleSkills.filter((skill) => skill.category === 'recommended'),
  };
  const selectedSkill = SKILL_CATALOG.find((skill) => skill.id === selectedSkillId) ?? null;
  const sectionOrder: SkillCategory[] = categoryFilter === 'all' ? ['personal', 'system', 'recommended'] : [categoryFilter];

  return (
    <section className="skills-page" aria-label="技能">
      <div className="skills-page-shell">
        <div className="skills-tabs" role="tablist" aria-label="能力与技能">
          <button type="button" role="tab" aria-selected="false">能力</button>
          <button type="button" role="tab" aria-selected="true" className="active">技能</button>
        </div>
        <header className="skills-page-head">
          <div>
            <h1>技能</h1>
            <p>通过任务专用技能扩展投研能力</p>
          </div>
          <div className="skills-search-row">
            <label className="skills-search">
              <Search size={15} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索能力和技能" />
            </label>
            <div className="skills-filter-wrap" ref={filterRef}>
              <button
                type="button"
                className={`skills-filter-btn ${filterOpen || categoryFilter !== 'all' ? 'active' : ''}`}
                aria-label="筛选技能"
                aria-haspopup="menu"
                aria-expanded={filterOpen}
                title="筛选"
                onClick={() => setFilterOpen((open) => !open)}
              >
                <SlidersHorizontal size={16} />
              </button>
              {filterOpen && (
                <div className="skills-filter-menu" role="menu" aria-label="技能分类">
                  {SKILL_CATEGORY_OPTIONS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={categoryFilter === option.id}
                      className={categoryFilter === option.id ? 'active' : ''}
                      onClick={() => {
                        setCategoryFilter(option.id);
                        setFilterOpen(false);
                      }}
                    >
                      <span>{option.label}</span>
                      {categoryFilter === option.id && <Check size={14} />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </header>
        <div className="skills-section-list">
          {sectionOrder.map((category) => (
            <SkillSection
              key={category}
              category={category}
              title={skillCategoryLabel(category)}
              skills={grouped[category]}
              empty={`没有匹配的${skillCategoryLabel(category)}技能。`}
              status={status}
              collapsible={category === 'personal' && categoryFilter === 'all' && !normalizedQuery}
              expanded={Boolean(expanded[category])}
              onToggleExpanded={() => setExpanded((prev) => ({ ...prev, [category]: !prev[category] }))}
              onOpenSkill={(skill) => setSelectedSkillId(skill.id)}
              onInstallSkill={(skill) => setSkillInstalled(skill.id, true)}
            />
          ))}
        </div>
      </div>
      {selectedSkill && (
        <SkillDetailDialog
          skill={selectedSkill}
          status={status[selectedSkill.id] ?? { installed: selectedSkill.installed, enabled: selectedSkill.installed }}
          onClose={() => setSelectedSkillId(null)}
          onInstall={(installed) => setSkillInstalled(selectedSkill.id, installed)}
          onToggleEnabled={(enabled) => setSkillEnabled(selectedSkill.id, enabled)}
          onReset={() => resetSkillStatus(selectedSkill.id)}
          onTry={() => {
            queueSkillForComposer(selectedSkill);
            setSelectedSkillId(null);
          }}
        />
      )}
    </section>
  );
}

function SkillSection({
  category,
  title,
  skills,
  empty,
  status,
  collapsible,
  expanded,
  onToggleExpanded,
  onOpenSkill,
  onInstallSkill,
}: {
  category: SkillCategory;
  title: string;
  skills: SkillCatalogItem[];
  empty: string;
  status: SkillStatusMap;
  collapsible: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  onOpenSkill: (skill: SkillCatalogItem) => void;
  onInstallSkill: (skill: SkillCatalogItem) => void;
}) {
  if (skills.length === 0) {
    return (
      <section className="skills-section" aria-label={title}>
        <h2>{title}</h2>
        <div className="skills-empty-row">{empty}</div>
      </section>
    );
  }
  const limit = collapsible && !expanded ? 5 : skills.length;
  const visibleSkills = skills.slice(0, limit);
  const hiddenSkills = skills.slice(limit);
  const hiddenLabel = hiddenSkills.slice(0, 2).map((skill) => skill.title).join('、');
  return (
    <section className="skills-section" aria-label={title}>
      <h2>{title}</h2>
      <div className="skill-list">
        {visibleSkills.map((skill) => {
          const current = status[skill.id] ?? { installed: skill.installed, enabled: skill.installed };
          return (
            <div
              key={skill.id}
              className={`skill-row ${current.installed ? 'installed' : ''} ${current.enabled ? 'enabled' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => onOpenSkill(skill)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onOpenSkill(skill);
                }
              }}
            >
              <span className={`skill-row-icon skill-icon-${skill.icon}`}>{skillIcon(skill, 20)}</span>
              <span className="skill-row-main">
                <strong>{skill.title}</strong>
                <span>{skill.description}</span>
              </span>
              {current.installed ? (
                current.enabled ? (
                  <Check size={16} className="skill-row-check" aria-label={`${skill.title} 已启用`} />
                ) : (
                  <span className="skill-row-muted">已停用</span>
                )
              ) : (
                <button
                  type="button"
                  className="skill-add-btn"
                  aria-label={`添加 ${skill.title}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onInstallSkill(skill);
                  }}
                >
                  添加技能
                </button>
              )}
            </div>
          );
        })}
        {hiddenSkills.length > 0 && (
          <button type="button" className="skill-more-row" onClick={onToggleExpanded}>
            查看 {hiddenLabel} 等另外 {hiddenSkills.length} 项
          </button>
        )}
        {expanded && collapsible && hiddenSkills.length === 0 && (
          <button type="button" className="skill-more-row" onClick={onToggleExpanded}>
            收起{skillCategoryLabel(category)}技能
          </button>
        )}
      </div>
    </section>
  );
}

function SkillDetailDialog({
  skill,
  status,
  onClose,
  onInstall,
  onToggleEnabled,
  onReset,
  onTry,
}: {
  skill: SkillCatalogItem;
  status: SkillStatus;
  onClose: () => void;
  onInstall: (installed: boolean) => void;
  onToggleEnabled: (enabled: boolean) => void;
  onReset: () => void;
  onTry: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const installed = status.installed;
  const enabled = installed && status.enabled;
  useEffect(() => {
    const handleKeyDown = (event: WindowEventMap['keydown']) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const copySkillId = async () => {
    try {
      await navigator.clipboard?.writeText(skill.id);
      setNotice('已复制 Skill ID');
    } catch {
      setNotice(`Skill ID: ${skill.id}`);
    }
    setMenuOpen(false);
  };

  return (
    <div className="skill-detail-layer" role="presentation">
      <button className="skill-detail-backdrop" type="button" aria-label="关闭技能详情" onClick={onClose} />
      <div className="skill-detail-dialog" role="dialog" aria-modal="true" aria-label={`${skill.title} Skill`}>
        <button type="button" className="skill-detail-close" aria-label="关闭技能详情" onClick={onClose}>
          <X size={16} />
        </button>
        <div className="skill-detail-head">
          <span className={`skill-detail-icon skill-icon-${skill.icon}`}>{skillIcon(skill, 24)}</span>
          <div className="skill-detail-title-row">
            <div>
              <h2>{skill.title} <span>Skill</span></h2>
              <p>{skill.description}</p>
            </div>
            <div className="skill-detail-actions">
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                aria-label={`${enabled ? '禁用' : '启用'} ${skill.title}`}
                className={`skill-switch ${enabled ? 'checked' : ''}`}
                onClick={() => {
                  if (!installed) onInstall(true);
                  else onToggleEnabled(!enabled);
                }}
              >
                <span />
              </button>
              <div className="skill-detail-more-wrap">
                <button type="button" className="icon-mini" aria-label={`${skill.title} 更多操作`} onClick={() => setMenuOpen((open) => !open)}>
                  <MoreHorizontal size={15} />
                </button>
                {menuOpen && (
                  <>
                    <button className="menu-backdrop" type="button" aria-label="关闭技能操作菜单" onClick={() => setMenuOpen(false)} />
                    <div className="skill-detail-menu" role="menu">
                      <button type="button" role="menuitem" onClick={() => void copySkillId()}>复制 Skill ID</button>
                      <button type="button" role="menuitem" onClick={() => { onReset(); setMenuOpen(false); setNotice('已恢复默认状态'); }}>恢复默认状态</button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="skill-detail-body">
          {skill.detail.map((section, index) => (
            <section key={`${skill.id}-${section.title || index}`}>
              {section.title && <h3>{section.title}</h3>}
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph}>{renderInlineCode(paragraph)}</p>
              ))}
            </section>
          ))}
        </div>
        <div className="skill-detail-footer">
          <div className="skill-detail-footer-left">
            {installed ? (
              <button type="button" className="skill-danger-btn" onClick={() => onInstall(false)}>卸载</button>
            ) : (
              <button type="button" className="skill-add-btn" onClick={() => onInstall(true)}>添加技能</button>
            )}
            {notice && <span className="skill-detail-notice">{notice}</span>}
          </div>
          <button type="button" className="skill-try-btn" onClick={onTry} disabled={!installed || !enabled}>
            <MessageCircle size={14} />
            <span>{installed && enabled ? '在对话中试用' : '启用后试用'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function renderInlineCode(text: string): ReactNode[] {
  return text.split(/(`[^`]+`)/g).map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={`${part}-${index}`}>{part.slice(1, -1)}</code>;
    }
    return <Fragment key={`${part}-${index}`}>{part}</Fragment>;
  });
}

function skillCategoryLabel(category: SkillCategory): string {
  switch (category) {
    case 'personal':
      return '个人';
    case 'system':
      return '系统';
    case 'recommended':
      return '推荐';
  }
}

function skillIcon(skill: SkillCatalogItem | SkillSelection, size = 16): ReactNode {
  const icon = 'icon' in skill ? skill.icon : undefined;
  switch (icon) {
    case 'ios':
      return <Box size={size} />;
    case 'chrome':
      return <Globe size={size} />;
    case 'computer':
      return <Monitor size={size} />;
    case 'pdf':
      return <FileText size={size} />;
    case 'image':
      return <ImageIcon size={size} />;
    case 'docs':
      return <FileText size={size} />;
    case 'plugin':
      return <Plug size={size} />;
    case 'skill':
      return <Pencil size={size} />;
    case 'playwright':
      return <Wrench size={size} />;
    case 'github':
      return <Github size={size} />;
    case 'calendar':
      return <CalendarDays size={size} />;
    case 'drive':
      return <FolderOpen size={size} />;
    case 'slack':
      return <MessageSquare size={size} />;
    case 'database':
      return <HardDrive size={size} />;
    case 'cloud':
      return <Network size={size} />;
    case 'chart':
      return <FileSpreadsheet size={size} />;
    case 'browser':
    default:
      return <Globe size={size} />;
  }
}

function ChatArea({ domain }: { domain: DomainConfig }) {
  const conversation = useCurrentConversation();
  const codexStatus = useChatStore((state) => state.codexStatus);
  const modelProfiles = useChatStore((state) => state.modelProfiles);
  const selectedModelProfileId = useChatStore((state) => state.selectedModelProfileId);
  const selectedModelProfile = resolveVisibleModelProfile(modelProfiles, selectedModelProfileId, codexStatus);
  if (!conversation) return null;
  const previewRuntime = !isTauriRuntime();
  const gatewayMode = selectedModelProfile.providerId === ALPHA_GATEWAY_PROVIDER_ID;
  const codexReady = previewRuntime || Boolean(codexStatus?.installed && (codexStatus.loggedIn || gatewayMode));
  const isEmpty = conversation.messages.length === 0;
  return (
    <div className="chat-area">
      {(!codexReady || previewRuntime) && (
        <div className="codex-warning">
          <AlertCircle size={16} />
          <div>
            <strong>{previewRuntime ? '浏览器预览模式' : 'AI 引擎暂不可用'}</strong>
            <span>{previewRuntime ? '这里会模拟分析事件流；桌面应用会连接本地 AI 运行环境。' : codexStatus?.error || '请确认本地 AI 运行环境已安装并完成设备授权。'}</span>
            {codexStatus?.path && <code>{codexStatus.path}</code>}
          </div>
        </div>
      )}
      {isEmpty ? <EmptyState domain={domain} conversation={conversation} disabled={!codexReady} /> : <><div className="message-scroll"><MessageList conversation={conversation} /></div><Composer domain={domain} conversation={conversation} disabled={!codexReady} bottom /></>}
    </div>
  );
}

function EmptyState({ domain, conversation, disabled }: { domain: DomainConfig; conversation: Conversation; disabled: boolean }) {
  const sendMessage = useChatStore((state) => state.sendMessage);
  return (
    <div className="empty-state">
      <h1 className="empty-heading">{domain.ui.emptyHeading}</h1>
      <Composer domain={domain} conversation={conversation} disabled={disabled} />
      <div className="suggestion-row">
        {domain.ui.suggestions.map((suggestion) => (
          <button key={suggestion.id} type="button" className="suggestion-card" onClick={() => void sendMessage(suggestion.prompt)}>
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
          {(message.role !== 'user' || message.blocks.length > 0 || message.selectedSkill) && (
            <div className="bubble">
              {message.role === 'user'
                ? (
                    <>
                      {message.selectedSkill && <MessageSkillLabel skill={message.selectedSkill} />}
                      {message.blocks.map((block, index) => block.type === 'text' ? <span key={index}>{block.content}</span> : <BlockRenderer key={index} block={block} />)}
                    </>
                  )
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

function MessageSkillLabel({ skill }: { skill: SkillSelection }) {
  const name = skill.title.trim() || skill.id;
  return (
    <span className="message-skill-label" title={`指定 Skill：${name}`}>
      {`$${name}`}
    </span>
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
    return <div className={`markdown-content ${streaming ? 'streaming' : ''}`}><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ img: MarkdownImage }}>{block.content}</ReactMarkdown></div>;
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
  if (block.type === 'image_result') {
    return <GeneratedImageResultView block={block} />;
  }
  if (block.type === 'file_result') {
    return <GeneratedFileResultView block={block} />;
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
      defaultOpen={tool.kind === 'image'}
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

function Composer({ domain, conversation, disabled, bottom }: { domain: DomainConfig; conversation: Conversation; disabled?: boolean; bottom?: boolean }) {
  const [value, setValue] = useState('');
  const [attachments, setAttachments] = useState<MessageAttachment[]>([]);
  const [selectedSkill, setSelectedSkill] = useState<SkillCatalogItem | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { queuedSkill, consumeQueuedSkill } = useSkillRuntime();
  const sendMessage = useChatStore((state) => state.sendMessage);
  const stopCurrentConversation = useChatStore((state) => state.stopCurrentConversation);
  const isStreaming = conversation.status === 'streaming';
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [value]);
  useEffect(() => {
    if (!queuedSkill) return;
    setSelectedSkill(queuedSkill);
    consumeQueuedSkill();
    textareaRef.current?.focus();
  }, [queuedSkill, consumeQueuedSkill]);
  const addAttachments = (items: MessageAttachment[]) => {
    setAttachments((prev) => mergeAttachments(prev, items));
  };
  const removeAttachment = (id: string) => setAttachments((prev) => prev.filter((item) => item.id !== id));
  const canSend = Boolean(value.trim() || attachments.length);
  const submit = () => {
    if (!canSend || isStreaming || disabled) return;
    const outgoing = attachments;
    const outgoingSkill = selectedSkill;
    setValue('');
    setAttachments([]);
    setSelectedSkill(null);
    void sendMessage(value.trim(), outgoing, outgoingSkill);
  };
  return (
    <div className={`composer-wrap ${bottom ? 'bottom' : ''}`}>
      <div className="composer-card">
        {selectedSkill && (
          <div className="composer-skill-selection">
            <span className={`composer-skill-icon skill-icon-${selectedSkill.icon}`}>{skillIcon(selectedSkill, 16)}</span>
            <span className="composer-skill-copy">
              <strong>{selectedSkill.title}</strong>
              <span>将优先使用这个 Skill</span>
            </span>
            <button type="button" className="composer-skill-remove" onClick={() => setSelectedSkill(null)} aria-label={`移除 ${selectedSkill.title} Skill`}>
              <X size={12} />
            </button>
          </div>
        )}
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
              submit();
            }
          }}
          placeholder={disabled ? '请先修复本地 AI 运行环境状态' : bottom ? domain.ui.followupPlaceholder : domain.ui.composerPlaceholder}
          rows={1}
        />
        <div className="composer-toolbar">
          <ComposerPlusMenu domain={domain} onAttach={addAttachments} onSelectSkill={setSelectedSkill} disabled={disabled || isStreaming} />
          <ApprovalPicker />
          <span className="spacer" />
          <ModelPicker />
          <button className="composer-icon-btn" type="button" disabled aria-label="语音"><Mic size={15} /></button>
          {isStreaming ? <button className="send-button stop" type="button" onClick={() => void stopCurrentConversation()} aria-label="停止"><Square size={12} fill="currentColor" strokeWidth={0} /></button> : <button className="send-button" type="button" onClick={submit} disabled={!canSend || disabled} aria-label="发送"><ArrowUp size={18} /></button>}
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

function GeneratedImageResultView({ block }: { block: Extract<MessageBlock, { type: 'image_result' }> }) {
  if (block.images.length === 0) return null;
  return (
    <section className="generated-image-result" aria-label={block.title}>
      <div className="generated-image-header">
        <span className="generated-image-icon"><ImageIcon size={14} /></span>
        <strong>{block.title}</strong>
        {block.images.length > 1 && <span>{block.images.length} 张</span>}
      </div>
      <div className={`generated-image-grid ${block.images.length > 1 ? 'multi' : ''}`}>
        {block.images.map((image) => <GeneratedImagePreview key={image.id} image={image} />)}
      </div>
    </section>
  );
}

function MarkdownImage({ src, alt, title }: ImgHTMLAttributes<HTMLImageElement>) {
  const imageSrc = typeof src === 'string' ? src : '';
  if (!imageSrc) return null;
  const name = imageNameFromSrc(imageSrc);
  return (
    <GeneratedImagePreview
      image={{
        id: `markdown-${imageSrc}`,
        src: imageSrc,
        alt: alt || title || name,
        name,
      }}
      markdown
    />
  );
}

const GENERATED_IMAGE_PREVIEW_RETRIES = 3;

function GeneratedImagePreview({ image, markdown }: { image: GeneratedImage; markdown?: boolean }) {
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [fallbackSrc, setFallbackSrc] = useState<string | null>(null);
  const retryTimer = useRef<number | null>(null);
  const fallbackLoading = useRef(false);
  const openViewer = useImageViewer((state) => state.open);
  const originalSrc = renderableImageSrc(image.src);
  const src = fallbackSrc || originalSrc;
  const label = image.alt || image.name || imageNameFromSrc(image.src);
  const source = imageSourceLabel(image);
  const localPath = localFilePath(image.src);
  useEffect(() => {
    setFailed(false);
    setRetry(0);
    setFallbackSrc(null);
    fallbackLoading.current = false;
    if (retryTimer.current) window.clearTimeout(retryTimer.current);
    retryTimer.current = null;
    return () => {
      if (retryTimer.current) window.clearTimeout(retryTimer.current);
    };
  }, [originalSrc]);
  const handleImageError = () => {
    if (localPath && !fallbackSrc && !fallbackLoading.current) {
      fallbackLoading.current = true;
      void localImageDataUrl(localPath).then((dataUrl) => {
        fallbackLoading.current = false;
        if (dataUrl) {
          setFailed(false);
          setFallbackSrc(dataUrl);
          return;
        }
        if (retry < GENERATED_IMAGE_PREVIEW_RETRIES) {
          setRetry((value) => value + 1);
        } else {
          setFailed(true);
        }
      });
      return;
    }
    if (localPath && !fallbackSrc && retry < GENERATED_IMAGE_PREVIEW_RETRIES) {
      if (retryTimer.current) window.clearTimeout(retryTimer.current);
      retryTimer.current = window.setTimeout(() => {
        retryTimer.current = null;
        setRetry((value) => value + 1);
      }, 450 + retry * 350);
      return;
    }
    setFailed(true);
  };
  return (
    <button
      type="button"
      className={`generated-image-card ${markdown ? 'from-markdown' : ''} ${failed ? 'failed' : ''}`}
      onClick={() => openViewer(src, label)}
      aria-label={`查看生成图片 ${label}`}
      title={`查看原图 · ${label}`}
    >
      {!failed ? (
        <img key={`${src}-${retry}`} src={src} alt={label} onError={handleImageError} />
      ) : (
        <span className="generated-image-fallback">
          <ImageIcon size={18} />
          <span>图片预览不可用</span>
        </span>
      )}
      <span className="generated-image-meta">
        <strong>{image.name || label}</strong>
        <span>{source}</span>
      </span>
    </button>
  );
}

function GeneratedFileResultView({ block }: { block: Extract<MessageBlock, { type: 'file_result' }> }) {
  if (block.files.length === 0) return null;
  return (
    <section className="generated-file-result" aria-label={block.title}>
      <div className="generated-file-list">
        {block.files.map((file) => <GeneratedFileCard key={file.id} file={file} />)}
      </div>
    </section>
  );
}

function GeneratedFileCard({ file }: { file: GeneratedFile }) {
  return (
    <div className="generated-file-card" role="group" aria-label={file.name}>
      <span className={`generated-file-icon tone-${fileTone(file.ext)}`}>
        {file.kind === 'image' ? <ImageIcon size={18} /> : fileGlyph(file.ext, 18)}
      </span>
      <span className="generated-file-main">
        <strong>{file.name}</strong>
        <span>{generatedFileTypeLabel(file)}</span>
      </span>
      <button
        type="button"
        className="generated-file-open"
        onClick={() => void openGeneratedFile(file)}
        title="在 Finder 中显示"
      >
        <span>打开方式</span>
        <ChevronDown size={13} />
      </button>
    </div>
  );
}

function generatedFileTypeLabel(file: GeneratedFile): string {
  const type = fileTypeLabel(file.ext);
  return file.kind === 'image' ? `图像 · ${type}` : type;
}

async function openGeneratedFile(file: GeneratedFile): Promise<void> {
  if (/^https?:\/\//i.test(file.path)) {
    await openExternal(file.path);
    return;
  }
  const path = localFilePath(file.path) || file.path;
  await revealPath(path);
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
function ComposerPlusMenu({
  domain,
  onAttach,
  onSelectSkill,
  disabled,
}: {
  domain: DomainConfig;
  onAttach: (items: MessageAttachment[]) => void;
  onSelectSkill: (skill: SkillCatalogItem) => void;
  disabled?: boolean;
}) {
  const planMode = useChatStore((state) => state.planMode);
  const pursueGoal = useChatStore((state) => state.pursueGoal);
  const setPlanMode = useChatStore((state) => state.setPlanMode);
  const setPursueGoal = useChatStore((state) => state.setPursueGoal);
  const { status } = useSkillRuntime();
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
  const chooseSkill = (skill: SkillCatalogItem) => {
    onSelectSkill(skill);
    close();
  };
  const installedSkills = SKILL_CATALOG.filter((skill) => {
    const current = status[skill.id] ?? { installed: skill.installed, enabled: skill.installed };
    return current.installed && current.enabled;
  });

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
              <button
                type="button"
                className="plus-menu-item submenu-trigger"
                aria-haspopup="menu"
                aria-expanded={submenu === 'plugins'}
                onClick={() => setSubmenu((current) => (current === 'plugins' ? null : 'plugins'))}
              >
                <Plug size={15} />
                <span>能力</span>
                <ChevronRight size={14} className="model-menu-chevron" />
              </button>
              {submenu === 'plugins' && (
                <div className="plus-flyout">
                  <div className="model-flyout-panel" role="menu">
                    <div className="model-menu-label">{installedSkills.length} 个已安装 Skill</div>
                    {installedSkills.map((skill) => (
                      <button key={skill.id} type="button" className="plus-plugin-row selectable" role="menuitem" onClick={() => chooseSkill(skill)}>
                        <span className={`plus-plugin-icon skill-icon-${skill.icon}`}>{skillIcon(skill, 14)}</span>
                        <span>{skill.title}</span>
                      </button>
                    ))}
                    <div className="plus-menu-hint">金融版会在这里扩展投研数据、资料处理和自动化能力。</div>
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

// The data-directory pill beneath the composer doubles as a switcher: it lists
// existing research folders and lets a conversation bind to local materials.
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
    // Group the conversation under a project for that folder so it lands in the
    // sidebar's 项目 section instead of as a stray standalone chat. Reuse a
    // matching project when one already exists, otherwise spin up a new one.
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
        title={cwd || '选择资料目录'}
        onClick={() => setOpen((value) => !value)}
      >
        <FolderGit2 size={12} />
        <span>{cwd ? basename(cwd) : '选择目录'}</span>
        <ChevronDown size={11} className="dir-pill-chevron" />
      </button>
      {open && (
        <>
          <button className="menu-backdrop" type="button" aria-label="关闭目录菜单" onClick={close} />
          <div className="model-menu dir-menu" role="menu">
            {folderProjects.length > 0 && <div className="model-menu-label">研究主题目录</div>}
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
              <span>选择其他文件夹…</span>
            </button>
            {cwd && (
              <button type="button" className="model-menu-item dir-menu-item" onClick={clearFolder}>
                <FolderOpen size={14} />
                <span>清除工作目录</span>
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

// Data-directory context shown beneath the composer.
function ComposerMeta({ conversation }: { conversation: Conversation }) {
  const planMode = useChatStore((state) => state.planMode);
  const pursueGoal = useChatStore((state) => state.pursueGoal);

  return (
    <div className="composer-meta">
      <DirectoryPicker conversation={conversation} />
      {planMode && (
        <span className="composer-meta-pill mode-on" title="计划模式已开启：Alpha Studio 会先给出可执行计划">
          <ListChecks size={12} />
          <span>计划模式</span>
        </span>
      )}
      {pursueGoal && (
        <span className="composer-meta-pill mode-on" title="追求目标已开启：Alpha Studio 会持续推进直到目标达成">
          <Target size={12} />
          <span>追求目标</span>
        </span>
      )}
    </div>
  );
}

const FLOATING_MENU_MARGIN = 8;
const FLOATING_MENU_GAP = 6;
const HIDDEN_FLOATING_STYLE: CSSProperties = { visibility: 'hidden' };

function clampFloatingPosition(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, Math.max(min, max)));
}

function codexSubscriptionModelsVisible(codexStatus: { loggedIn: boolean } | null): boolean {
  return !isTauriRuntime() || codexStatus?.loggedIn !== false;
}

function visibleModelProfilesForCodexStatus(profiles: ModelProfile[], codexStatus: { loggedIn: boolean } | null): ModelProfile[] {
  if (codexSubscriptionModelsVisible(codexStatus)) return profiles;
  return profiles.filter((profile) => !profile.builtIn);
}

function resolveVisibleModelProfile(profiles: ModelProfile[], selectedId: string, codexStatus: { loggedIn: boolean } | null): ModelProfile {
  const visibleProfiles = visibleModelProfilesForCodexStatus(profiles, codexStatus).filter((profile) => profile.enabled);
  return visibleProfiles.find((profile) => profile.id === selectedId) ?? visibleProfiles[0] ?? resolveModelProfile(profiles, selectedId);
}

function ModelPicker() {
  const selectedModelProfileId = useChatStore((state) => state.selectedModelProfileId);
  const modelProfiles = useChatStore((state) => state.modelProfiles);
  const codexStatus = useChatStore((state) => state.codexStatus);
  const reasoningEffort = useChatStore((state) => state.reasoningEffort);
  const speed = useChatStore((state) => state.speed);
  const setModelProfile = useChatStore((state) => state.setModelProfile);
  const setReasoningEffort = useChatStore((state) => state.setReasoningEffort);
  const setSpeed = useChatStore((state) => state.setSpeed);
  const [open, setOpen] = useState(false);
  const [submenu, setSubmenu] = useState<'model' | 'speed' | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const modelRowRef = useRef<HTMLDivElement>(null);
  const speedRowRef = useRef<HTMLDivElement>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>(HIDDEN_FLOATING_STYLE);
  const [flyoutStyle, setFlyoutStyle] = useState<CSSProperties>(HIDDEN_FLOATING_STYLE);
  const enabledProfiles = modelProfiles.filter((profile) => profile.enabled);
  const visibleEnabledProfiles = visibleModelProfilesForCodexStatus(enabledProfiles, codexStatus);
  const selectedModelProfile = visibleEnabledProfiles.find((profile) => profile.id === selectedModelProfileId) ?? visibleEnabledProfiles[0] ?? resolveModelProfile(modelProfiles, selectedModelProfileId);
  const builtInProfiles = visibleEnabledProfiles.filter((profile) => profile.builtIn);
  const customProfiles = visibleEnabledProfiles.filter((profile) => !profile.builtIn);
  const close = () => { setOpen(false); setSubmenu(null); };
  useEffect(() => {
    if (visibleEnabledProfiles.length === 0 || selectedModelProfile.id === selectedModelProfileId) return;
    setModelProfile(selectedModelProfile.id);
  }, [selectedModelProfile.id, selectedModelProfileId, setModelProfile, visibleEnabledProfiles.length]);
  useLayoutEffect(() => {
    if (!open) {
      setMenuStyle(HIDDEN_FLOATING_STYLE);
      return;
    }

    const updateMenuPosition = () => {
      const triggerRect = triggerRef.current?.getBoundingClientRect();
      const menuRect = menuRef.current?.getBoundingClientRect();
      if (!triggerRect || !menuRect) return;

      setMenuStyle({
        left: clampFloatingPosition(
          triggerRect.right - menuRect.width,
          FLOATING_MENU_MARGIN,
          window.innerWidth - menuRect.width - FLOATING_MENU_MARGIN,
        ),
        top: clampFloatingPosition(
          triggerRect.top - menuRect.height - FLOATING_MENU_GAP,
          FLOATING_MENU_MARGIN,
          window.innerHeight - menuRect.height - FLOATING_MENU_MARGIN,
        ),
      });
    };

    updateMenuPosition();
    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', updateMenuPosition, true);
    return () => {
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
    };
  }, [open, visibleEnabledProfiles.length, reasoningEffort, selectedModelProfile.id, speed]);
  useLayoutEffect(() => {
    if (!open || !submenu) {
      setFlyoutStyle(HIDDEN_FLOATING_STYLE);
      return;
    }

    const updateFlyoutPosition = () => {
      const rowRect = (submenu === 'model' ? modelRowRef.current : speedRowRef.current)?.getBoundingClientRect();
      const flyoutRect = flyoutRef.current?.getBoundingClientRect();
      if (!rowRect || !flyoutRect) return;

      const leftPreferred = rowRect.left - flyoutRect.width - FLOATING_MENU_GAP;
      const leftFallback = rowRect.right + FLOATING_MENU_GAP;
      const canOpenRight = leftFallback + flyoutRect.width <= window.innerWidth - FLOATING_MENU_MARGIN;
      const left = leftPreferred >= FLOATING_MENU_MARGIN || !canOpenRight
        ? leftPreferred
        : leftFallback;

      setFlyoutStyle({
        left: clampFloatingPosition(
          left,
          FLOATING_MENU_MARGIN,
          window.innerWidth - flyoutRect.width - FLOATING_MENU_MARGIN,
        ),
        top: clampFloatingPosition(
          rowRect.top,
          FLOATING_MENU_MARGIN,
          window.innerHeight - flyoutRect.height - FLOATING_MENU_MARGIN,
        ),
      });
    };

    updateFlyoutPosition();
    window.addEventListener('resize', updateFlyoutPosition);
    window.addEventListener('scroll', updateFlyoutPosition, true);
    return () => {
      window.removeEventListener('resize', updateFlyoutPosition);
      window.removeEventListener('scroll', updateFlyoutPosition, true);
    };
  }, [open, submenu, builtInProfiles.length, customProfiles.length, selectedModelProfile.id, speed]);
  return (
    <div className="model-picker">
      <button ref={triggerRef} type="button" className={`composer-pill model-pill ${open ? 'active' : ''}`} onClick={() => setOpen((value) => !value)} title="选择模型与推理强度">
        {speed === 'fast' && <Zap size={12} className="model-pill-fast" />}<span>{shortModelProfileLabel([selectedModelProfile], selectedModelProfile.id)}</span><span className="model-pill-effort">{effortLabel(reasoningEffort)}</span><ChevronDown size={12} />
      </button>
      {open && (
        <>
          <button className="menu-backdrop" type="button" aria-label="关闭模型菜单" onClick={close} />
          <div ref={menuRef} className="model-menu model-choice-menu" role="menu" style={menuStyle} onMouseLeave={() => setSubmenu(null)}>
            <div className="model-menu-label">智能</div>
            {EFFORT_OPTIONS.map((option) => <button key={option.id} type="button" role="menuitemradio" aria-checked={option.id === reasoningEffort} className="model-menu-item" onMouseEnter={() => setSubmenu(null)} onClick={() => { setReasoningEffort(option.id as ReasoningEffort); close(); }}><span>{option.label}</span>{option.id === reasoningEffort && <Check size={14} className="model-menu-check" />}</button>)}
            <div className="model-menu-divider" />
            <div ref={modelRowRef} className="model-flyout-row" onMouseEnter={() => setSubmenu('model')}>
              <button type="button" className="model-menu-item submenu-trigger" aria-haspopup="menu" aria-expanded={submenu === 'model'} onClick={() => setSubmenu((current) => (current === 'model' ? null : 'model'))}><span>{selectedModelProfile.label}</span><ChevronRight size={14} className="model-menu-chevron" /></button>
              {submenu === 'model' && (
                <div ref={flyoutRef} className="model-flyout model-choice-flyout" style={flyoutStyle}>
                  <div className="model-flyout-panel" role="menu">
                    {builtInProfiles.length > 0 && <div className="model-menu-label">订阅模型</div>}
                    {builtInProfiles.map((option) => (
                      <button key={option.id} type="button" role="menuitemradio" aria-checked={option.id === selectedModelProfile.id} className="model-menu-item" onClick={() => { setModelProfile(option.id); close(); }}>
                        <span>{option.label}</span>{option.id === selectedModelProfile.id && <Check size={14} className="model-menu-check" />}
                      </button>
                    ))}
                    {builtInProfiles.length > 0 && customProfiles.length > 0 && <div className="model-menu-divider" />}
                    {customProfiles.length > 0 && <div className="model-menu-label">按量模型</div>}
                    {customProfiles.map((option) => (
                      <button key={option.id} type="button" role="menuitemradio" aria-checked={option.id === selectedModelProfile.id} className="model-menu-item model-profile-item" onClick={() => { setModelProfile(option.id); close(); }}>
                        <span><strong>{option.label}</strong><em>{option.providerId} · {option.model}</em></span>{option.id === selectedModelProfile.id && <Check size={14} className="model-menu-check" />}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div ref={speedRowRef} className="model-flyout-row" onMouseEnter={() => setSubmenu('speed')}>
              <button type="button" className="model-menu-item submenu-trigger" aria-haspopup="menu" aria-expanded={submenu === 'speed'} onClick={() => setSubmenu((current) => (current === 'speed' ? null : 'speed'))}><span>速度</span><ChevronRight size={14} className="model-menu-chevron" /></button>
              {submenu === 'speed' && <div ref={flyoutRef} className="model-flyout model-choice-flyout" style={flyoutStyle}><div className="model-flyout-panel" role="menu"><div className="model-menu-label">速度</div>{SPEED_OPTIONS.map((option) => <button key={option.id} type="button" role="menuitemradio" aria-checked={option.id === speed} className="model-menu-item speed-item" onClick={() => { setSpeed(option.id as Speed); close(); }}><span className="speed-main">{option.fast && <Zap size={13} className="speed-icon" />}<span className="speed-text"><span className="speed-title">{option.label}</span><span className="speed-sub">{option.description}</span></span></span>{option.id === speed && <Check size={14} className="model-menu-check" />}</button>)}</div></div>}
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
        title="选择 Alpha Studio 操作的批准方式"
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
        <strong>代码审查</strong>
        <span>{cwd ? basename(cwd) || shortenPath(cwd) : '未绑定工作目录'}</span>
      </div>
      <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭"><X size={15} /></button>
    </header>
  );

  let body: ReactNode;
  if (isRepo === false) {
    body = (
      <div className="review-dialog-empty">
        <AlertCircle size={20} />
        <p>{cwd ? `${basename(cwd)} 不是 Git 仓库，无法进行代码审查。` : '当前对话尚未绑定工作目录。请先在输入框下方选择一个项目文件夹。'}</p>
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
      <section className="review-dialog" role="dialog" aria-modal="true" aria-label="代码审查">
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
  const [fileListVisible, setFileListVisible] = useState(true);
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
      setStatus({ cwd: '', isRepository: false, ahead: 0, behind: 0, clean: true, changes: [], error: '当前对话未绑定工作目录。' });
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
  const statusLabel = statusFilter === 'all' ? '上轮对话' : statusFilter === 'staged' ? '已暂存' : '未暂存';

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
      {status?.isRepository ? (
        <>
          <div className="review-topbar">
            <div className="review-status">
              <button type="button" className="review-status-btn" onClick={() => setStatusMenuOpen((open) => !open)}>
                <span>{statusLabel}</span>
                <ChevronDown size={13} />
              </button>
              {statusMenuOpen && (
                <>
                  <div className="review-status-backdrop" onClick={() => setStatusMenuOpen(false)} />
                  <div className="review-status-menu codex-filter-menu">
                    <button type="button" className={statusFilter === 'unstaged' ? 'active' : ''} onClick={() => { setStatusFilter('unstaged'); setStatusMenuOpen(false); }}>
                      <span>未暂存</span>
                      <span className="review-menu-count">{unstagedCount}</span>
                    </button>
                    <button type="button" className={statusFilter === 'staged' ? 'active' : ''} onClick={() => { setStatusFilter('staged'); setStatusMenuOpen(false); }}>
                      <span>已暂存</span>
                      <span className="review-menu-count">{stagedCount}</span>
                    </button>
                    <button type="button" className="has-submenu" onClick={() => setStatusMenuOpen(false)}>
                      <span>提交</span>
                      <ChevronRight size={14} />
                    </button>
                    <button type="button" onClick={() => setStatusMenuOpen(false)}>
                      <span>分支</span>
                    </button>
                    <button type="button" className={statusFilter === 'all' ? 'active' : ''} onClick={() => { setStatusFilter('all'); setStatusMenuOpen(false); }}>
                      <span>上轮对话</span>
                      {statusFilter === 'all' && <Check size={14} className="review-menu-check" />}
                    </button>
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
            <button
              type="button"
              className={`icon-mini review-file-list-toggle ${fileListVisible ? 'active' : ''}`}
              onClick={() => setFileListVisible((visible) => !visible)}
              aria-label={fileListVisible ? '隐藏文件' : '显示文件'}
              title={fileListVisible ? '隐藏文件' : '显示文件'}
            >
              <FolderOpen size={14} />
            </button>
            <button type="button" className="icon-mini" onClick={() => void refresh()} disabled={busy} title="刷新"><RefreshCw size={14} className={busy ? 'spin' : ''} /></button>
            <button type="button" className={`panel-btn ${commitOpen ? 'primary' : ''}`} onClick={() => setCommitOpen((open) => !open)} disabled={changes.length === 0}><GitCommitHorizontal size={13} />提交或推送</button>
            <button type="button" className="panel-btn" onClick={createPullRequest} disabled={busy} title="gh pr create --web"><GitPullRequest size={13} />创建拉取请求</button>
          </div>

          {error && <div className="panel-error"><AlertCircle size={14} />{error}</div>}

          <div className={`review-split ${fileListVisible ? '' : 'file-list-hidden'}`}>
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

            {fileListVisible && (
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
            )}
          </div>
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
    <aside className="git-panel right-dock-panel">
      <header className="panel-header" data-tauri-drag-region>
        <div data-tauri-drag-region>
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
          <strong>当前工作目录不是 Git 仓库</strong>
          <span>{status?.error || '请选择一个包含 .git 的项目目录。'}</span>
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
        <SettingsNavGroup label="集成" items={domain.navigation.integrations} section={section} onSectionChange={onSectionChange} />
        <SettingsNavGroup label="编码" items={domain.navigation.coding} section={section} onSectionChange={onSectionChange} />
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
  const approvalMode = useChatStore((state) => state.approvalMode);
  const setSpeed = useChatStore((state) => state.setSpeed);
  const setApprovalMode = useChatStore((state) => state.setApprovalMode);

  if (section === 'archived') return <ArchivedSettings />;
  if (section === 'models') return <ModelSettings />;
  if (section === 'appearance') {
    return (
      <>
        <ResearchPreview />
        <SettingsGroup>
          <SettingsRow title="主题" description="使用浅色、深色或匹配系统设置。">
            <SettingsSegment value={theme} onChange={onThemeChange} options={[{ id: 'light', label: '浅色', icon: <Sun size={13} /> }, { id: 'dark', label: '深色', icon: <Moon size={13} /> }]} />
          </SettingsRow>
          <SettingsRow title="强调色" description="用于按钮、选中状态和风险提示。"><ColorSwatch value="#339CFF" /></SettingsRow>
          <SettingsRow title="UI 字号" description="调整工作台界面的基础字号。"><span className="settings-static">14 px</span></SettingsRow>
        </SettingsGroup>
      </>
    );
  }
  if (section === 'config') {
    return (
      <SettingsGroup>
        <SettingsRow title="批准方式" description="选择 Alpha Studio 执行敏感操作前如何请求授权。">
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
          <SettingsRow title="默认权限" description="默认情况下，Alpha Studio 可以读取本地资料。"><Toggle checked /></SettingsRow>
          <SettingsRow title="自动审核" description="自动审核额外访问和权限请求。"><Toggle checked /></SettingsRow>
          <SettingsRow title="完全访问权限" description="允许处理资料目录并访问联网资源。"><Toggle checked /></SettingsRow>
        </SettingsGroup>
        <SettingsGroup>
          <SettingsRow title="默认打开目标" description="默认打开资料和文件夹的位置。"><span className="settings-static">按研究主题</span></SettingsRow>
          <SettingsRow title="语言" description="应用 UI 语言。"><span className="settings-static">自动检测</span></SettingsRow>
          <SettingsRow title="速度" description="选择用于聊天、子智能体和压缩的推理层级。">
            <SettingsSegment value={speed} onChange={(id) => setSpeed(id as Speed)} options={SPEED_OPTIONS.map((option) => ({ id: option.id, label: option.label, icon: option.fast ? <Zap size={13} /> : undefined }))} />
          </SettingsRow>
        </SettingsGroup>
      </>
    );
  }
  if (section === 'mcp') return <PluginSettings />;
  if (section === 'hooks' || section === 'connections' || section === 'snapshots' || section === 'browser' || section === 'computer') {
    return <PlaceholderSettings domain={domain} section={section} />;
	  }
	  return (
	    <SettingsGroup>
	      <SettingsRow title={sectionLabel(section, domain)} description="公开源码版保留入口，商业垂直包可通过领域插件扩展这里。"><span className="settings-static">可扩展</span></SettingsRow>
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
              <span>Alpha Studio 会把本地 Responses 请求翻译为上游 Chat Completions 请求。</span>
            </div>
          </div>
        )}
        <div className={`settings-status ${codexStatus?.installed && codexStatus.loggedIn ? 'ready' : 'attention'}`}>
          <span className="settings-status-icon">{isCheckingCodex ? <Loader2 size={16} className="spin" /> : <Terminal size={16} />}</span>
          <div className="settings-status-main">
            <strong>{codexStatus?.installed && codexStatus.loggedIn ? `本地 AI 运行环境已就绪${codexStatus.version ? ` · ${codexStatus.version}` : ''}` : '本地 AI 运行环境未就绪'}</strong>
            <span>{codexStatus?.loggedIn ? codexStatus.path : (codexStatus?.error || codexStatus?.path || '请确认本地 AI 运行环境已安装并完成设备授权。')}</span>
          </div>
          <span className="settings-status-actions">
            {codexStatus?.installed && !codexStatus.loggedIn && <CodexLoginButton compact />}
            {codexStatus?.installed && codexStatus.loggedIn && <CodexRevokeButton compact />}
            <button className="settings-btn" type="button" onClick={() => void refreshCodexStatus()} disabled={isCheckingCodex}>重新检测</button>
          </span>
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
            <span>Chat Completions 会通过 Alpha Studio 本地 adapter 接入 Codex；勾选“启用思考模式”会发送 thinking.enabled，取消勾选会发送 thinking.disabled。</span>
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

function ResearchPreview() {
  return (
    <div className="theme-preview">
      <div className="code-pane before"><code><span>市场异动</span><span>新能源链走强</span><span>成交额放大 18%</span><span>关注政策催化</span><span>风险：估值切换</span></code></div>
      <div className="code-pane after"><code><span>投研摘要</span><span>驱动：订单修复</span><span>验证：公告与排产</span><span>仓位：控制回撤</span><span>后续：跟踪价格</span></code></div>
    </div>
  );
}

function Toggle({ checked }: { checked?: boolean }) {
  return <span className={`toggle ${checked ? 'checked' : ''}`}><span /></span>;
}

function ColorSwatch({ value }: { value: string }) {
  return <span className="color-swatch" style={{ ['--swatch']: value } as CSSProperties}>{value}</span>;
}

function CodexLoginButton({ compact = false, stateButton = false }: { compact?: boolean; stateButton?: boolean }) {
  const refreshCodexStatus = useChatStore((state) => state.refreshCodexStatus);
  const [isLaunching, setIsLaunching] = useState(false);
  const [isWaitingForLogin, setIsWaitingForLogin] = useState(false);
  const [error, setError] = useState('');
  const pollRunRef = useRef(0);
  const pollTimeoutRef = useRef<number | null>(null);

  const clearPollTimeout = useCallback(() => {
    if (pollTimeoutRef.current !== null) {
      window.clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      pollRunRef.current += 1;
      clearPollTimeout();
    };
  }, [clearPollTimeout]);

  const waitForNextPoll = (runId: number) => new Promise<boolean>((resolve) => {
    clearPollTimeout();
    pollTimeoutRef.current = window.setTimeout(() => {
      pollTimeoutRef.current = null;
      resolve(pollRunRef.current === runId);
    }, CODEX_LOGIN_POLL_INTERVAL_MS);
  });

  const pollForAuthorization = async () => {
    const runId = pollRunRef.current + 1;
    pollRunRef.current = runId;
    const expiresAt = Date.now() + CODEX_LOGIN_POLL_TIMEOUT_MS;
    setIsWaitingForLogin(true);
    while (pollRunRef.current === runId && Date.now() < expiresAt) {
      await refreshCodexStatus();
      if (pollRunRef.current !== runId) return;
      if (useChatStore.getState().codexStatus?.loggedIn) break;
      const shouldContinue = await waitForNextPoll(runId);
      if (!shouldContinue) return;
    }
    if (pollRunRef.current === runId) {
      await refreshCodexStatus();
      setIsWaitingForLogin(false);
    }
  };

  const launchLogin = async () => {
    pollRunRef.current += 1;
    clearPollTimeout();
    setIsLaunching(true);
    setIsWaitingForLogin(false);
    setError('');
    try {
      await loginCodex();
      setIsLaunching(false);
      await pollForAuthorization();
    } catch (err) {
      setError(stringifyError(err));
      setIsWaitingForLogin(false);
    } finally {
      setIsLaunching(false);
    }
  };
  const busy = isLaunching || isWaitingForLogin;
  const label = isLaunching ? '正在打开授权' : isWaitingForLogin ? '等待授权完成' : '授权 Codex CLI';
  const buttonClassName = stateButton
    ? `settings-state-pill settings-state-button attention ${busy ? 'authorizing' : ''}`
    : 'settings-btn';

  return (
    <span className={`codex-login-action ${compact ? 'compact' : ''}`}>
      <button
        className={buttonClassName}
        type="button"
        aria-label={label}
        title="授权 Codex CLI"
        onClick={() => void launchLogin()}
        disabled={busy}
      >
        {busy ? (
          <Loader2 size={13} className="spin" />
        ) : stateButton ? (
          <>
            <ShieldQuestion size={13} className="state-idle-icon" aria-hidden="true" />
            <ShieldCheck size={13} className="state-hover-icon" aria-hidden="true" />
          </>
        ) : (
          <ShieldCheck size={13} />
        )}
        {stateButton ? (
          <>
            <span className="state-idle-label" aria-hidden="true">{busy ? label : '未授权'}</span>
            {!busy && <span className="state-hover-label" aria-hidden="true">授权 Codex CLI</span>}
          </>
        ) : (
          <span>{label}</span>
        )}
      </button>
      {error && <span className="settings-inline-error">{error}</span>}
    </span>
  );
}

function CodexAuthorizationBadge({ status }: { status: 'ready' | 'checking' | 'missing' | 'attention' }) {
  const icon = status === 'ready'
    ? <CheckCheck size={13} />
    : status === 'checking'
      ? <Loader2 size={13} className="spin" />
      : <ShieldQuestion size={13} />;
  const label = status === 'ready'
    ? '已授权'
    : status === 'checking'
      ? '检测中'
      : status === 'missing'
        ? '未安装'
        : '未授权';
  return <span className={`settings-state-pill ${status}`}>{icon}<span>{label}</span></span>;
}

function CodexRevokeButton({ compact = false }: { compact?: boolean }) {
  const refreshCodexStatus = useChatStore((state) => state.refreshCodexStatus);
  const [isRevoking, setIsRevoking] = useState(false);
  const [error, setError] = useState('');

  const revokeAuthorization = async () => {
    setIsRevoking(true);
    setError('');
    try {
      await revokeCodexAuthorization();
      await refreshCodexStatus();
    } catch (err) {
      setError(stringifyError(err));
    } finally {
      setIsRevoking(false);
    }
  };

  return (
    <span className={`codex-login-action ${compact ? 'compact' : ''}`}>
      <button
        className={`settings-state-pill settings-state-button ready ${isRevoking ? 'revoking' : ''}`}
        type="button"
        aria-label={isRevoking ? '正在撤销' : '撤销授权'}
        title="撤销 Codex CLI 授权"
        onClick={() => void revokeAuthorization()}
        disabled={isRevoking}
      >
        {isRevoking ? (
          <Loader2 size={13} className="spin" />
        ) : (
          <>
            <CheckCheck size={13} className="state-idle-icon" aria-hidden="true" />
            <LogOut size={13} className="state-hover-icon" aria-hidden="true" />
          </>
        )}
        <span className="state-idle-label" aria-hidden="true">{isRevoking ? '正在撤销' : '已授权'}</span>
        {!isRevoking && <span className="state-hover-label" aria-hidden="true">撤销授权</span>}
      </button>
      {error && <span className="settings-inline-error">{error}</span>}
    </span>
  );
}

function ProfileSettings() {
  const session = useChatStore((state) => state.clientLicenseSession);
  const setClientLicenseSession = useChatStore((state) => state.setClientLicenseSession);
  const codexStatus = useChatStore((state) => state.codexStatus);
  const isCheckingCodex = useChatStore((state) => state.isCheckingCodex);
  const codexAccount = session?.codexAccounts[0] ?? null;
  const codexSubscriptionEnabled = Boolean(session?.tenant.codexSubscriptionEnabled);
  const codexCliAuthorized = Boolean(codexStatus?.installed && codexStatus.loggedIn);
  const codexAuthorizationStatus = codexCliAuthorized
    ? 'ready'
    : isCheckingCodex || !codexStatus
      ? 'checking'
      : codexStatus.installed
        ? 'attention'
        : 'missing';
  const showCodexLoginButton = codexSubscriptionEnabled && Boolean(codexStatus?.installed) && !codexCliAuthorized;
  const showCodexRevokeButton = codexSubscriptionEnabled && codexCliAuthorized;
  const profileTitle = session?.tenant.name || 'Alpha Studio';
  const profileSubtitle = session
    ? `${session.user.name} · ${session.user.email}`
    : '@local · Noncommercial';
  const codexLabel = codexSubscriptionEnabled
    ? codexAccount?.email || '未分配账号'
    : '未启用';
  const codexPlanLabel = session?.tenant.codexSubscriptionPlan || codexAccount?.plan || '已启用';
  const codexDescription = codexSubscriptionEnabled
    ? codexCliAuthorized
      ? `本地 Codex CLI 已完成设备授权${codexStatus?.version ? ` · ${codexStatus.version}` : ''}。`
      : codexAccount?.loginHint || `订阅计划：${codexPlanLabel}`
    : '当前客户使用 API 网关模式，用量会计入客户额度。';
  const signOut = () => {
    clearClientLicenseSession();
    setClientLicenseSession(null);
  };

  return (
    <>
      <div className="profile-settings">
        <div className="avatar">AS</div>
        <h2>{profileTitle}</h2>
        <span>{profileSubtitle}</span>
        <div className="profile-actions">
          <button className="settings-btn danger" type="button" onClick={signOut}>
            <LogOut size={14} />
            <span>退出登录</span>
          </button>
        </div>
        <div className="profile-metrics">
          <span><strong>{session?.tenant.maxDevices ?? 'Core'}</strong><em>设备额度</em></span>
          <span><strong>{codexSubscriptionEnabled ? 'Codex 订阅' : 'API 网关'}</strong><em>运行模式</em></span>
          <span><strong>{session ? '已激活' : '未激活'}</strong><em>客户端状态</em></span>
        </div>
      </div>
      <SettingsGroup>
        <SettingsRow title="客户" description="当前激活的公司授权。">
          <span className="settings-static">{session?.tenant.name || '未激活'}</span>
        </SettingsRow>
        <SettingsRow title="用户" description={session?.user.email || '本地用户。'}>
          <span className="settings-static">{session?.user.name || 'Alpha Studio'}</span>
        </SettingsRow>
        <SettingsRow title="Codex 订阅账号" description={codexDescription}>
          <span className="settings-action-stack">
            <span className="settings-static">{codexLabel}</span>
            {codexSubscriptionEnabled && !showCodexRevokeButton && !showCodexLoginButton && <CodexAuthorizationBadge status={codexAuthorizationStatus} />}
            {showCodexLoginButton && <CodexLoginButton compact stateButton />}
            {showCodexRevokeButton && <CodexRevokeButton compact />}
          </span>
        </SettingsRow>
        <SettingsRow title="设备授权" description={session ? `设备 ${session.device.id}` : '无有效设备授权。'}>
          <span className="settings-static">{formatLicenseDate(session?.device.leaseExpiresAt)}</span>
        </SettingsRow>
      </SettingsGroup>
    </>
  );
}

function KeyboardSettings() {
  const rows = [
    ['归档聊天', 'Archive the current chat', '⇧⌘A'],
    ['新对话', 'Start a new chat', '⌘N'],
    ['搜索', 'Search chats and projects', '⌘K'],
    ['置顶对话', 'Pin or unpin the current chat', '⌥⌘P'],
    ['投研侧栏', 'Open the research side panel', ''],
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

function PluginSettings() {
  return (
    <>
      <SettingsGroup>
        {PLUGIN_CAPABILITIES.map((capability) => (
          <SettingsRow key={capability.id} title={capability.title} description={capability.description}>
            <span className="settings-static">{capability.tag}</span>
          </SettingsRow>
        ))}
      </SettingsGroup>
      <SettingsGroup>
        <SettingsRow title="技能目录" description="Alpha Studio 会从本地技能目录加载可用能力。">
          <span className="settings-static">~/.codex/skills</span>
        </SettingsRow>
      </SettingsGroup>
    </>
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

function PlaceholderSettings({ domain, section }: { domain: DomainConfig; section: SettingsSection }) {
  return (
    <SettingsGroup>
      <SettingsRow title={sectionLabel(section, domain)} description="公开源码版保留入口，商业垂直包可通过领域插件扩展这里。"><span className="settings-static">可扩展</span></SettingsRow>
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

function domainSuggestionIcon(suggestion: DomainSuggestion): ReactNode {
  const icons: Record<DomainSuggestion['icon'], ReactNode> = {
    market: <ArrowDownUp size={16} className="icon" />,
    research: <Search size={16} className="icon" />,
    risk: <ShieldQuestion size={16} className="icon" />,
  };
  return icons[suggestion.icon];
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

type ToolKind = 'command' | 'file-read' | 'file-edit' | 'search' | 'web' | 'log' | 'image' | 'generic';

function toolPresentation(title: string): { kind: ToolKind; icon: ReactNode; running: string; done: string; failed: string } {
  const normalized = title.trim().toLowerCase();
  const has = (...keys: string[]) => keys.some((key) => normalized.includes(key));
  if (has('stderr')) return { kind: 'log', icon: <FileText size={14} />, running: 'Codex 日志', done: 'Codex 日志', failed: 'Codex 日志' };
  if (/image[\s._-]*gen|generate[\s._-]*image|image[\s._-]*generation|text[\s._-]*to[\s._-]*image/.test(normalized)) {
    return { kind: 'image', icon: <ImageIcon size={14} />, running: '正在生成图片', done: '已生成图片', failed: '图片生成失败' };
  }
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
    if (block.type === 'image_result') return [block.title, ...block.images.map((image) => image.src)].filter(Boolean).join('\n');
    if (block.type === 'file_result') return [block.title, ...block.files.map((file) => file.path)].filter(Boolean).join('\n');
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
      const selected = await open({ directory: true, multiple: false, title: '选择资料目录' });
      return typeof selected === 'string' ? selected : null;
    } catch {
      return null;
    }
  }
  const manual = window.prompt('输入资料目录的绝对路径（浏览器预览模式）');
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
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时`;
  if (diff < 86_400_000 * 7) return `${Math.floor(diff / 86_400_000)} 天`;
  if (diff < 86_400_000 * 30) return `${Math.floor(diff / (86_400_000 * 7))} 周`;
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(value);
}

function formatDate(value?: number): string {
  if (!value) return '未知时间';
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(value);
}

function formatLicenseDate(value?: string | null): string {
  if (!value) return '未设置';
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return value;
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(time);
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

function imageNameFromSrc(src: string): string {
  if (/^data:image\//i.test(src)) return '生成图片';
  try {
    const url = new URL(src);
    return decodeURIComponent(basename(url.pathname) || '生成图片');
  } catch {
    return decodeURIComponent(basename(src.split(/[?#]/)[0]) || '生成图片');
  }
}

function imageSourceLabel(image: GeneratedImage): string {
  if (/^data:image\//i.test(image.src)) return '内联图片';
  if (/^https?:\/\//i.test(image.src)) {
    try {
      const url = new URL(image.src);
      return `${url.hostname}/${image.name || imageNameFromSrc(image.src)}`;
    } catch {
      return image.src;
    }
  }
  return shortenPath(image.src);
}

function renderableImageSrc(src: string): string {
  if (!isTauriRuntime()) return src;
  const localPath = localFilePath(src);
  if (!localPath) return src;
  try {
    return convertFileSrc(localPath);
  } catch {
    return src;
  }
}

function localFilePath(src: string): string | null {
  if (src.startsWith('/')) return src;
  if (!src.startsWith('file://')) return null;
  try {
    return decodeURIComponent(new URL(src).pathname);
  } catch {
    return null;
  }
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
