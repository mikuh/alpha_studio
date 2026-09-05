import { Children, Fragment, Suspense, createContext, isValidElement, lazy, memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type {
  AnchorHTMLAttributes,
  ChangeEvent,
  ClipboardEvent as ReactClipboardEvent,
  CSSProperties,
  DragEvent as ReactDragEvent,
  FormEvent,
  HTMLAttributes,
  ImgHTMLAttributes,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
  RefObject,
} from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import { createPortal } from 'react-dom';
import remarkGfm from 'remark-gfm';
import { invoke } from '@tauri-apps/api/core';
import { Terminal as XTerm, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import officialSkillCatalog from '../skills/catalog.json';
import { ReportBrandingSettings } from './ReportBrandingSettings';
import { TurnDuration, formatTurnDuration as formatThinkingDuration } from './TurnDuration';
import { fileChangeKind, isFileWriteCommand } from './toolActivity';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  AppWindow,
  Archive,
  ArrowDownAZ,
  ArrowDownUp,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUp,
  Box,
  Braces,
  CalendarDays,
  Check,
  CheckCheck,
  ChartCandlestick,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Clock3,
  Code2,
  Columns2,
  Compass,
  Copy,
  CornerDownRight,
  Database,
  Download,
  Eye,
  EyeOff,
  ExternalLink,
  File,
  FileChartColumn,
  FileCheck2,
  FileCode2,
  FileDiff,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderSearch,
  FolderGit2,
  FolderInput,
  FolderOpen,
  FolderPlus,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  Github,
  Globe,
  GripVertical,
  HardDrive,
  History,
  Image as ImageIcon,
  Info,
  Keyboard,
  Layers,
  LineChart,
  ListChecks,
  Loader2,
  Lock,
  LockKeyholeOpen,
  LogOut,
  MessageCircle,
  MessageCircleQuestionMark,
  MessageSquare,
  MessageSquarePlus,
  Maximize2,
  Minimize2,
  Minus,
  Monitor,
  Moon,
  MoonStar,
  MoreHorizontal,
  Network,
  PanelBottom,
  PanelBottomClose,
  PanelRight,
  Paperclip,
  Pause,
  Pencil,
  Pin,
  PinOff,
  Plug,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  ScanSearch,
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
  Users,
  UsersRound,
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
  createProjectFolder,
  browserWebviewAction,
  copyLocalFileToClipboard,
  isTauriRuntime,
  listOpenApps,
  localDirectoryList,
  localFileExists,
  localImageDataUrl,
  localTextFileRead,
  loginCodex,
  openInApp,
  openLocalPath,
  renameProjectFolder,
  revealPath,
  revokeCodexAuthorization,
  fetchCodexSubscriptionUsage,
  subscribeTerminalEvents,
  syncCoworkerAgents,
  syncManagedSkills,
  terminalResize,
  terminalStart,
  terminalStop,
  terminalWrite,
  updateCodexCli,
  type CodexRateLimitSnapshot,
  type CodexRateLimitWindow,
  type CodexSubscriptionUsage,
  type BrowserWebviewEvent,
  type LocalDirectoryEntry,
} from './codexBridge';
import { FirstUseGuide, OPEN_FIRST_USE_GUIDE_EVENT } from './FirstUseGuide';
import {
  COWORKER_CATALOG,
  COWORKER_GROUP_LABELS,
  COWORKER_WORKFLOW_PRESETS,
  coworkerById,
  coworkerSelectionsByIds,
  coworkerAgentDefinitions,
  toCoworkerSelection,
  type CoworkerGroup,
  type CoworkerProfile,
} from './coworkers';
import {
  AUTOMATION_ENVIRONMENT_OPTIONS,
  AUTOMATION_TASKS_CHANGED_EVENT,
  CUSTOM_AUTOMATION_SCHEDULE_VALUE,
  automationTitleFromPrompt,
  blankAutomationForm,
  createScheduledAutomationId,
  loadScheduledAutomationTasks,
  saveScheduledAutomationTasks,
  type AutomationFormState,
  type ScheduledAutomationTask,
} from './automation';
import { useAutomationScheduler } from './automationScheduler';
import { useThemeTrackingEngine } from './themeTrackingEngine';
import { loadLocalStoreSnapshot } from './localStore';
import { activeDomain, type DomainConfig, type DomainSuggestion } from './domain';
import {
  activateClient,
  ALPHA_GATEWAY_PROVIDER_ID,
  CLIENT_MODEL_CATALOG_SYNC_INTERVAL_MS,
  clearClientLicenseSession,
  defaultAlphaApiBaseUrl,
  fetchClientBillingSummary,
  fetchClientDevices,
  getOrCreateDeviceFingerprint,
  isClientAuthorizationError,
  isEnterpriseAuthorizationFresh,
  loadClientLicenseSession,
  revokeClientDevice,
  validateCodexAuthorization,
  type BillingLedgerEntry,
  type BillingLedgerPagination,
  type BillingModelUsage,
  type BillingPeriodKind,
  type BillingUsageTotals,
  type ClientBillingSummary,
  type ClientDeviceSummary,
  type ClientLicenseSession,
  type ClientManagedDevice,
} from './license';
import {
  EMPTY_LEGAL_ACCEPTANCE,
  LEGAL_DOCUMENTS,
  allLegalDocumentsAccepted,
  currentClientAgreementAcceptance,
  type LegalAcceptanceState,
  type LegalDocumentDefinition,
} from './legal';
import {
  APPROVAL_OPTIONS,
  EFFORT_OPTIONS,
  reasoningEffortOptionsForProfile,
  SPEED_OPTIONS,
  approvalDescription,
  approvalLabel,
  effortLabel,
  normalizeModelProfileDraft,
  resolveModelProfile,
  resolveReasoningEffortForProfile,
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
  useCurrentConversationCwd,
  useCurrentConversationStatus,
  useImageViewer,
  visibleConversations,
} from './store';
import {
  OPEN_RESEARCH_SECURITY_EVENT,
  RESEARCH_DRAG_MIME,
  findResearchSecurityMentionRanges,
  findResearchSecurityMentions,
  openResearchSecurity,
  shortCode,
  type ResearchSecurityMention,
} from './research';
import { registerComposerInsertHandler } from './composerBridge';
import {
  DAILY_DECISION_CHANGED_EVENT,
  OPEN_DAILY_DECISION_EVENT,
  loadDailyDecisionState,
} from './dailyDecision';
import {
  ALPHA_STUDIO_DAILY_THEME_SKILL_ID,
  PREMARKET_THEME_RUNS_CHANGED_EVENT,
  loadPremarketThemeRuns,
} from './themeResearch';
import {
  ALPHA_STUDIO_INTRADAY_MONITOR_SKILL_ID,
  ALPHA_STUDIO_REPORT_REVIEW_SKILL_ID,
} from './themeAbilities';
import type {
  ChatMessage,
  Conversation,
  CoworkerSelection,
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
  QueuedChatMessage,
  ReviewFinding,
  ReviewReport,
  ReviewRequest,
  SelectedTextContext,
  SkillSelection,
  SubscriptionModelUsage,
} from './types';

const BrowserPdfViewer = lazy(() => import('./BrowserPdfViewer').then((module) => ({ default: module.BrowserPdfViewer })));
const NativeBrowserSurface = lazy(() => import('./NativeBrowserSurface').then((module) => ({ default: module.NativeBrowserSurface })));
const ResearchWorkbenchPanel = lazy(() => import('./ResearchWorkbench').then((module) => ({ default: module.ResearchWorkbenchPanel })));
const DailyDecisionPanel = lazy(() => import('./DailyDecisionPanel').then((module) => ({ default: module.DailyDecisionPanel })));

type RightPanel = 'none' | 'git' | 'features' | 'coworkers' | 'review' | 'terminal' | 'browser' | 'files' | 'side-chat' | 'research-workbench' | 'daily-decision';
type RightDockKind = 'review' | 'terminal' | 'browser' | 'files' | 'side-chat' | 'research-workbench' | 'daily-decision';
type MainView = 'chat' | 'skills' | 'automations';
interface RightDockTab {
  id: string;
  kind: RightDockKind;
  url?: string;
  title?: string;
  requestKey?: number;
  sourceConversationId?: string;
  selectedTextContexts?: SelectedTextContext[];
  stockCode?: string;
}
type Theme = 'light' | 'dark';
type SettingsSection =
  | 'general'
  | 'report-branding'
  | 'profile'
  | 'runtime'
  | 'usage'
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
const SIDEBAR_CONVERSATION_PREVIEW_LIMIT = 8;
const RIGHT_SIDEBAR_MIN_WIDTH = 320;
// The dock may take over most of a wide window (for example when reading a
// browser page). RightPanelResizer still preserves RIGHT_PANEL_MIN_MAIN_WIDTH
// for the conversation column, so this is only a generous absolute ceiling.
const RIGHT_SIDEBAR_MAX_WIDTH = 2400;
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
  'research-workbench': { label: '投研工作台' },
  'daily-decision': { label: '日报决策' },
};
const RIGHT_DOCK_ADD_MENU_KINDS: readonly RightDockKind[] = ['research-workbench', 'files', 'browser'];

const dailyThemeTurnByLatestUser = new WeakMap<ChatMessage, boolean>();

function latestUserMessageIn(messages: ChatMessage[]): ChatMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user') return messages[index];
  }
  return undefined;
}

function conversationHasDailyThemeTurn(conversation: Conversation | null | undefined): boolean {
  if (!conversation) return false;
  const latestUser = latestUserMessageIn(conversation.messages);
  if (!latestUser) return false;
  const cached = dailyThemeTurnByLatestUser.get(latestUser);
  if (cached !== undefined) return cached;
  const result = conversation.messages.some((message) => message.role === 'user' && (
    message.selectedSkill?.id === ALPHA_STUDIO_DAILY_THEME_SKILL_ID
    || message.blocks.some((block) => block.type === 'text' && block.content.includes(ALPHA_STUDIO_DAILY_THEME_SKILL_ID))
  ));
  dailyThemeTurnByLatestUser.set(latestUser, result);
  return result;
}

function sidebarConversationRevision(conversations: Conversation[]): string {
  return conversations.map((conversation) => [
    conversation.id,
    conversation.title,
    conversation.cwd,
    conversation.projectId ?? '',
    conversation.pinned ? '1' : '0',
    conversation.archivedAt ?? '',
    conversation.ephemeral ? '1' : '0',
    conversation.status,
    // Streaming deltas update updatedAt continuously, but the sidebar only
    // needs to refresh when the turn starts or finishes.
    conversation.status === 'streaming' ? 'active' : conversation.updatedAt,
    conversation.unread ? '1' : '0',
    conversation.messages.length,
  ].join('\u0000')).join('\u0001');
}

type SkillCategory = 'official' | 'personal' | 'system' | 'recommended';
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
  | 'github'
  | 'calendar'
  | 'drive'
  | 'slack'
  | 'database'
  | 'cloud'
  | 'chart'
  | 'monitor'
  | 'review';

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

interface OfficialSkillDefinition {
  id: string;
  category: 'official' | 'system';
  title: string;
  description: string;
  icon: SkillIcon;
  overview: string;
  workflow?: string;
}

interface OfficialSkillCatalogFile {
  schemaVersion: number;
  skills: OfficialSkillDefinition[];
}

const detail = (overview: string, workflow?: string): SkillDetailSection[] => [
  { paragraphs: [overview] },
  ...(workflow ? [{ title: 'Workflow Configuration', paragraphs: [workflow] }] : []),
];

const OFFICIAL_SKILL_PREFIX = 'alpha-studio-';
const OFFICIAL_SKILL_SOURCE = 'Alpha Studio 官方';
const OFFICIAL_SKILL_IDS_KEY = 'alpha:official-skill-ids-v1';
const OFFICIAL_SKILLS_CHANGED_EVENT = 'alpha-studio:official-skills-changed';
const OFFICIAL_SKILL_DEFINITIONS = (officialSkillCatalog as OfficialSkillCatalogFile).skills
  .filter((skill) => skill.category === 'official');
const DEFAULT_OFFICIAL_SKILL_IDS = OFFICIAL_SKILL_DEFINITIONS.map((skill) => skill.id);

function officialSkillItem(skill: OfficialSkillDefinition): SkillCatalogItem {
  return {
    id: skill.id,
    title: skill.title,
    description: skill.description,
    category: 'official',
    source: OFFICIAL_SKILL_SOURCE,
    installed: true,
    icon: skill.icon,
    detail: detail(skill.overview, skill.workflow),
  };
}

function fallbackOfficialSkillItem(id: string): SkillCatalogItem {
  const name = id.slice(OFFICIAL_SKILL_PREFIX.length).replace(/-/g, ' ');
  return {
    id,
    title: `Alpha Studio ${name}`,
    description: '由 Alpha Studio 官方发布并通过受保护的 Skill 清单安装。',
    category: 'official',
    source: OFFICIAL_SKILL_SOURCE,
    installed: true,
    icon: 'skill',
    detail: detail('该 Skill 来自当前已认证的 Alpha Studio 官方发布清单。'),
  };
}

const NON_OFFICIAL_SKILL_CATALOG: readonly SkillCatalogItem[] = [
  {
    id: 'browser',
    title: 'Browser',
    description: 'Browser lets GPT open and control the in-app browser, mainly for local development pages and web QA.',
    category: 'system',
    source: '系统',
    installed: true,
    icon: 'browser',
    detail: detail(
      'Open and control the in-app browser for local development pages, web QA, screenshots, DOM snapshots, and interaction checks.',
      'Use this when a task needs a rendered web surface inside Alpha Studio instead of an external browser session.',
    ),
  },
  {
    id: 'chrome',
    title: 'Chrome',
    description: 'Control the user Chrome browser when a task needs an existing signed-in browser session.',
    category: 'system',
    source: '系统',
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
    category: 'system',
    source: '系统',
    installed: true,
    icon: 'computer',
    detail: detail('Operate local macOS GUI apps through the installed computer-use runtime. Use it for native app workflows that cannot be reached through code or browser automation.'),
  },
  {
    id: 'pdf',
    title: 'PDF',
    description: 'Read, create, inspect, render, and verify PDF files.',
    category: 'system',
    source: '系统',
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
    description: 'Reference OpenAI docs, GPT self-knowledge, and model migration guidance.',
    category: 'system',
    source: '系统',
    installed: true,
    icon: 'docs',
    detail: [
      {
        paragraphs: [
          'Provide authoritative, current guidance from OpenAI developer docs using the developers.openai.com MCP server. "Docs MCP" means `mcp__openaiDeveloperDocs__search_openai_docs` and `mcp__openaiDeveloperDocs__fetch_openai_doc`; for API reference, schema, parameter, or required-field questions, also use `mcp__openaiDeveloperDocs__get_openapi_spec` when available. Official-domain web search is fallback after those tools are unavailable or unhelpful.',
          'Broad GPT questions use the manual helper before Docs MCP. This skill also owns model selection, API model migration, and prompt-upgrade guidance.',
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
    detail: detail('Scaffold GPT plugins, marketplace metadata, and plugin directories using the local plugin authoring conventions.'),
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

function normalizeOfficialSkillIds(skillIds: readonly string[]): string[] {
  return [...new Set(skillIds.filter((id) => id.startsWith(OFFICIAL_SKILL_PREFIX)))].sort();
}

function createSkillCatalog(skillIds: readonly string[] = DEFAULT_OFFICIAL_SKILL_IDS): readonly SkillCatalogItem[] {
  const definitions = new Map(OFFICIAL_SKILL_DEFINITIONS.map((skill) => [skill.id, skill]));
  const official = normalizeOfficialSkillIds(skillIds).map((id) => {
    const definition = definitions.get(id);
    return definition ? officialSkillItem(definition) : fallbackOfficialSkillItem(id);
  });
  return [...official, ...NON_OFFICIAL_SKILL_CATALOG];
}

function readOfficialSkillIds(): string[] {
  if (typeof window === 'undefined') return DEFAULT_OFFICIAL_SKILL_IDS;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(OFFICIAL_SKILL_IDS_KEY) || '[]');
    if (Array.isArray(parsed)) {
      const ids = normalizeOfficialSkillIds(parsed.filter((id): id is string => typeof id === 'string'));
      if (ids.length) return ids;
    }
  } catch {
    // A corrupt cached release summary must not hide the protected built-in catalog.
  }
  return DEFAULT_OFFICIAL_SKILL_IDS;
}

function publishOfficialSkillIds(skillIds: readonly string[]): void {
  if (typeof window === 'undefined') return;
  const ids = normalizeOfficialSkillIds(skillIds);
  const next = ids.length ? ids : DEFAULT_OFFICIAL_SKILL_IDS;
  window.localStorage.setItem(OFFICIAL_SKILL_IDS_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent<string[]>(OFFICIAL_SKILLS_CHANGED_EVENT, { detail: next }));
}

const DEFAULT_SKILL_CATALOG = createSkillCatalog();

const SKILL_CATEGORY_OPTIONS: Array<{ id: SkillCategoryFilter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'official', label: '官方' },
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
type AutomationTaskFilter = 'all' | 'enabled' | 'paused';
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

interface AutomationSelectOption {
  value: string;
  label: string;
}

interface AutomationSelectGroup {
  label: string;
  options: readonly AutomationSelectOption[];
}

type AutomationSelectEntry = string | AutomationSelectOption | AutomationSelectGroup;

const CUSTOM_AUTOMATION_SCHEDULE_DEFAULT = 'Cron: 0 9 * * *';
type AutomationRepeatMode = 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'interval' | 'custom';
type AutomationIntervalUnit = '分钟' | '小时' | '天' | '周' | '个月';

interface AutomationScheduleParts {
  repeat: AutomationRepeatMode;
  time: string;
  weekday: string;
  monthDay: string;
  intervalCount: string;
  intervalUnit: AutomationIntervalUnit;
  customValue: string;
}

const AUTOMATION_REPEAT_OPTIONS: readonly AutomationSelectOption[] = [
  { value: 'daily', label: '每天' },
  { value: 'weekdays', label: '工作日' },
  { value: 'weekly', label: '每周' },
  { value: 'monthly', label: '每月' },
  { value: 'interval', label: '按间隔' },
  { value: 'custom', label: '自定义' },
];
const AUTOMATION_WEEKDAY_OPTIONS: readonly AutomationSelectOption[] = [
  { value: '一', label: '星期一' },
  { value: '二', label: '星期二' },
  { value: '三', label: '星期三' },
  { value: '四', label: '星期四' },
  { value: '五', label: '星期五' },
  { value: '六', label: '星期六' },
  { value: '日', label: '星期日' },
];
const AUTOMATION_MONTH_DAY_OPTIONS: readonly AutomationSelectOption[] = [
  ...Array.from({ length: 31 }, (_, index) => ({ value: String(index + 1), label: `${index + 1} 日` })),
  { value: 'last', label: '最后一天' },
];
const AUTOMATION_INTERVAL_UNIT_OPTIONS: readonly AutomationSelectOption[] = [
  { value: '分钟', label: '分钟' },
  { value: '小时', label: '小时' },
  { value: '天', label: '天' },
  { value: '周', label: '周' },
  { value: '个月', label: '个月' },
];
const AUTOMATION_ENVIRONMENT_SELECT_OPTIONS: readonly AutomationSelectOption[] = [
  { value: '工作树', label: '新任务' },
  { value: '当前对话', label: '当前对话' },
  { value: '无代码环境', label: '无代码环境' },
];

const AUTOMATION_TEMPLATES: readonly AutomationTemplate[] = [
  {
    id: 'premarket-brief',
    title: '盘前市场简报',
    description: '汇总隔夜全球市场、宏观数据、政策与财经要闻，提炼当日重点方向和风险。',
    schedule: '每个工作日 08:30',
    source: '系统模板',
    icon: 'daily',
    prompt: '生成盘前市场简报：汇总隔夜全球市场表现、宏观数据、政策变化和重要财经新闻，梳理对 A 股的潜在映射，列出今日重点主题、关键观察指标与主要风险。',
  },
  {
    id: 'auction-confirmation',
    title: '集合竞价确认',
    description: '结合 9:25 竞价强弱、封单与高开结构，确认题材攻击方向和核心标的。',
    schedule: '每个工作日 09:25',
    source: '系统模板',
    icon: 'project',
    prompt: '分析 9:25 集合竞价结果：比较重点题材和核心标的的竞价涨幅、成交额、封单质量与高开结构，判断资金攻击方向，给出确认项、证伪项和开盘后的观察计划。',
  },
  {
    id: 'intraday-move-monitor',
    title: '盘中异动监控',
    description: '跟踪板块强度、量价异动与资金扩散，及时提示主线强化、分歧或退潮信号。',
    schedule: '每 30 分钟',
    source: '投研自动化',
    icon: 'commit',
    prompt: '仅在 A 股交易时段执行盘中异动监控：跟踪板块涨速、成交额、资金扩散、核心股表现和指数环境，识别主线强化、分歧转一致、冲高回落或退潮信号，并给出需要继续观察的触发条件。',
  },
  {
    id: 'postmarket-review',
    title: '盘后市场复盘',
    description: '复盘指数、情绪、题材梯队与资金风格，沉淀当日结论和下一交易日预案。',
    schedule: '每个工作日 15:30',
    source: '系统模板',
    icon: 'release',
    prompt: '生成盘后市场复盘：总结指数与成交、市场情绪、领涨题材、核心个股梯队和资金风格，区分机构与短线资金线索，评估主题生命周期，并形成下一交易日的观察重点、触发条件和风险预案。',
  },
  {
    id: 'weekly-strategy-review',
    title: '周度策略回顾',
    description: '回顾本周行情与研究判断，更新主题优先级、组合风险和下周策略。',
    schedule: '星期五 17:30',
    source: '系统模板',
    icon: 'weekly',
    prompt: '生成周度投研策略回顾：复盘本周指数、风格、主题轮动和关键判断的验证情况，评估组合暴露与主要风险，更新下周主题优先级、关键事件日历、观察标的和交易触发条件。',
  },
  {
    id: 'announcement-risk-scan',
    title: '公告与风险扫描',
    description: '扫描重要公告、监管动态与事件风险，识别可能影响持仓和关注标的的变化。',
    schedule: '每个工作日 20:30',
    source: '投研自动化',
    icon: 'ci',
    prompt: '扫描当日上市公司公告、监管动态、产业事件和重大财经新闻，筛选可能影响持仓及重点观察标的的信息，区分事实与推断，标注影响方向、紧迫程度、待验证问题和下一步研究动作。',
  },
] as const;

// Drag payload MIME for coworker cards dropped onto the composer.
const COWORKER_DRAG_MIME = 'application/x-alpha-coworker';
// Absolute file or directory paths dragged from the research tree into the composer.
const LOCAL_PATH_DRAG_MIME = 'application/x-alpha-local-path';

// One or more coworkers (optionally with a preset task prompt) queued from the
// coworkers panel, waiting for the composer to pick them up.
interface QueuedCoworkerTask {
  coworkers: CoworkerSelection[];
  taskPrompt?: string;
}

interface SkillRuntimeContextValue {
  catalog: readonly SkillCatalogItem[];
  status: SkillStatusMap;
  queuedSkill: SkillCatalogItem | null;
  queuedSkillPrompt: string | null;
  queuedCoworkerTask: QueuedCoworkerTask | null;
  setSkillInstalled: (id: string, installed: boolean) => void;
  setSkillEnabled: (id: string, enabled: boolean) => void;
  resetSkillStatus: (id: string) => void;
  queueSkillForComposer: (skill: SkillCatalogItem, prompt?: string) => void;
  consumeQueuedSkill: () => void;
  queueCoworkerTask: (coworker: CoworkerSelection | CoworkerSelection[], taskPrompt?: string) => void;
  consumeQueuedCoworkerTask: () => void;
}

const SkillRuntimeContext = createContext<SkillRuntimeContextValue | null>(null);
const BrowserDockContext = createContext<((url: string) => void) | null>(null);
const FileDockContext = createContext<((path: string) => void) | null>(null);
const MessageWorkspaceContext = createContext('');

function defaultSkillStatus(catalog: readonly SkillCatalogItem[] = DEFAULT_SKILL_CATALOG): SkillStatusMap {
  return Object.fromEntries(
    catalog.map((skill) => [skill.id, { installed: skill.installed, enabled: skill.installed }]),
  );
}

function readSkillStatus(catalog: readonly SkillCatalogItem[] = DEFAULT_SKILL_CATALOG): SkillStatusMap {
  const defaults = defaultSkillStatus(catalog);
  if (typeof window === 'undefined') return defaults;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SKILL_STATUS_KEY) || '{}') as Partial<SkillStatusMap>;
    return Object.fromEntries(
      catalog.map((skill) => {
        const saved = parsed[skill.id];
        const fallback = defaults[skill.id];
        const protectedSkill = skill.category === 'official' || skill.category === 'system';
        const installed = protectedSkill
          ? true
          : typeof saved?.installed === 'boolean' ? saved.installed : fallback.installed;
        return [
          skill.id,
          {
            installed,
            enabled: installed && (typeof saved?.enabled === 'boolean' ? saved.enabled : fallback.enabled),
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

function useBrowserDockOpener() {
  return useContext(BrowserDockContext);
}

function useFileDockOpener() {
  return useContext(FileDockContext);
}

const CODEX_SKILLS_CAPABILITY: SkillSelection = {
  id: 'skills',
  title: 'GPT Skills',
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
  const session = useChatStore((state) => state.clientLicenseSession);
  const setClientLicenseSession = useChatStore((state) => state.setClientLicenseSession);
  const refreshClientLicenseSession = useChatStore((state) => state.refreshClientLicenseSession);
  const [status, setStatus] = useState<'checking' | 'inactive' | 'active'>(() => {
    const stored = loadClientLicenseSession();
    if (!stored) return 'inactive';
    return isEnterpriseAuthorizationFresh(stored) ? 'active' : 'checking';
  });
  const [error, setError] = useState('');

  const activateSession = useCallback((next: ClientLicenseSession) => {
    setClientLicenseSession(next);
    setStatus('active');
    setError('');
  }, [setClientLicenseSession]);

  const deactivateSession = useCallback((message: string) => {
    clearClientLicenseSession();
    setClientLicenseSession(null);
    setStatus('inactive');
    setError(message);
  }, [setClientLicenseSession]);

  useEffect(() => {
    if (status !== 'active' || hasClientLicenseSession || loadClientLicenseSession()) return;
    setStatus('inactive');
    setError('');
  }, [hasClientLicenseSession, status]);

  useEffect(() => {
    let disposed = false;
    // Read the durable session for every lifecycle reconciliation. React Fast
    // Refresh deliberately re-runs effects while preserving refs and state, so
    // an initial snapshot would become stale after an in-app activation.
    const stored = loadClientLicenseSession();
    if (!stored) {
      setStatus('inactive');
      setClientLicenseSession(null);
      return;
    }
    if (isEnterpriseAuthorizationFresh(stored)) {
      activateSession(stored);
      void refreshClientLicenseSession()
        .then((renewed) => {
          if (!disposed && renewed) activateSession(renewed);
        })
        .catch((leaseError) => {
          if (!disposed && isClientAuthorizationError(leaseError)) {
            deactivateSession(`设备授权已被解除，请重新激活：${stringifyUnknownError(leaseError)}`);
          }
          // A still-valid five-day authorization survives transient startup/network failures.
        });
      return () => {
        disposed = true;
      };
    }
    // Keep the expired snapshot in the store only as the identity used for the
    // blocking renewal request; the workspace remains behind the checking gate.
    setClientLicenseSession(stored);
    void refreshClientLicenseSession()
      .then((renewed) => {
        if (!disposed && renewed) activateSession(renewed);
      })
      .catch((leaseError) => {
        if (disposed) return;
        deactivateSession(`设备授权已失效，请重新激活：${stringifyUnknownError(leaseError)}`);
      });
    return () => {
      disposed = true;
    };
  }, [activateSession, deactivateSession, refreshClientLicenseSession, setClientLicenseSession]);

  useEffect(() => {
    if (status !== 'active' || !session) return;
    void syncManagedSkills(session)
      .then((result) => {
        if (result) publishOfficialSkillIds(result.skillNames);
      })
      .catch((syncError) => {
        // Skill sync is fail-safe: the native layer keeps the last authenticated
        // managed release, then falls back to the protected bundle shipped with the app.
        console.warn('[Alpha Studio] Managed Skill sync failed:', syncError);
      });
    const refresh = () => {
      void refreshClientLicenseSession()
        .catch((leaseError) => {
          if (isClientAuthorizationError(leaseError) || !isEnterpriseAuthorizationFresh(session)) {
            deactivateSession(`设备续租失败，请重新激活：${stringifyUnknownError(leaseError)}`);
          }
        });
    };
    const interval = window.setInterval(refresh, CLIENT_MODEL_CATALOG_SYNC_INTERVAL_MS);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
    };
  }, [deactivateSession, refreshClientLicenseSession, session, status]);

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
  const [legalAcceptance, setLegalAcceptance] = useState<LegalAcceptanceState>(
    () => ({ ...EMPTY_LEGAL_ACCEPTANCE }),
  );
  const [openLegalDocument, setOpenLegalDocument] = useState<LegalDocumentDefinition | null>(null);
  const [error, setError] = useState(initialError);
  const [loading, setLoading] = useState(false);
  const agreementsAccepted = allLegalDocumentsAccepted(legalAcceptance);

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
        agreementAcceptance: currentClientAgreementAcceptance(legalAcceptance),
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
        <div className="license-eyebrow"><span aria-hidden="true" /> Institutional AI Terminal</div>
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
        <fieldset className="license-consents">
          <legend>激活前确认</legend>
          {LEGAL_DOCUMENTS.map((document) => {
            const checkboxId = `legal-acceptance-${document.id}`;
            return (
              <div className="license-consent-row" key={document.id}>
                <input
                  id={checkboxId}
                  type="checkbox"
                  checked={legalAcceptance[document.id]}
                  onChange={(event) => setLegalAcceptance((current) => ({
                    ...current,
                    [document.id]: event.target.checked,
                  }))}
                />
                <label htmlFor={checkboxId}>
                  <span>我已阅读并同意《{document.shortTitle}》</span>
                  <small>{document.summary}</small>
                </label>
                <button type="button" onClick={() => setOpenLegalDocument(document)}>查看</button>
              </div>
            );
          })}
        </fieldset>
        <div className="license-local-data-note">
          <HardDrive size={15} aria-hidden="true" />
          <span>项目、持仓、研究记录和会话历史默认仅保存在本机；只有发起模型调用时，必要会话内容才发送给所选大模型服务方。</span>
        </div>
        {error && <div className="license-error">{error}</div>}
        <button type="submit" disabled={loading || !agreementsAccepted}>
          {loading ? '正在激活...' : '激活并进入'}
        </button>
      </form>
      {openLegalDocument ? (
        <LegalDocumentDialog
          legalDocument={openLegalDocument}
          onClose={() => setOpenLegalDocument(null)}
        />
      ) : null}
    </main>
  );
}

function LegalDocumentDialog({
  legalDocument,
  onClose,
}: {
  legalDocument: LegalDocumentDefinition;
  onClose: () => void;
}) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  return createPortal(
    <div className="legal-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="legal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="legal-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span>协议版本 {legalDocument.version}</span>
            <h2 id="legal-dialog-title">{legalDocument.title}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭协议">
            <X size={18} />
          </button>
        </header>
        <article className="legal-dialog-content">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{legalDocument.content}</ReactMarkdown>
        </article>
        <footer>
          <button type="button" onClick={onClose}>我已阅读</button>
        </footer>
      </section>
    </div>,
    document.body,
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

function stringifyUnknownError(error: unknown): string {
  return stringifyError(error);
}

function activatedTenantDisplayName(session: ClientLicenseSession | null): string {
  const tenant = session?.tenant.name.trim();
  if (tenant) return tenant;
  const name = session?.user.name.trim();
  if (name) return name;
  const email = session?.user.email.trim();
  if (email) return email.split('@')[0] || email;
  return 'Alpha Studio';
}

function isDocumentFullscreen(): boolean {
  return typeof document !== 'undefined' && Boolean(document.fullscreenElement);
}

export function App() {
  const workspacePreview = !isTauriRuntime()
    && import.meta.env.DEV
    && new URLSearchParams(window.location.search).has('workspace-preview');
  if (workspacePreview) return <AppWorkspace />;
  return (
    <ClientLicenseBoundary>
      <FirstUseGuide><AppWorkspace /></FirstUseGuide>
    </ClientLicenseBoundary>
  );
}

function AppWorkspace() {
  const refreshCodexStatus = useChatStore((state) => state.refreshCodexStatus);
  const loadModelConfig = useChatStore((state) => state.loadModelConfig);
  const currentConversationId = useChatStore((state) => state.currentConversationId);
  const setCurrentConversation = useChatStore((state) => state.setCurrentConversation);
  const workModeId = useChatStore((state) => state.workModeId);
  const currentConversationExists = useChatStore((state) => Boolean(
    state.currentConversationId
    && state.conversations.some((conversation) => conversation.id === state.currentConversationId && !conversation.archivedAt && !conversation.ephemeral),
  ));
  const firstActiveConversationId = useChatStore((state) => (
    state.conversations.find((conversation) => !conversation.archivedAt && !conversation.ephemeral)?.id ?? null
  ));
  const dailyThemeTurnAvailable = useChatStore((state) => {
    const current = state.conversations.find((conversation) => conversation.id === state.currentConversationId);
    return conversationHasDailyThemeTurn(current);
  });
  const domain = activeDomain(workModeId);
  useAutomationScheduler();
  useThemeTrackingEngine();

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
  const [rightDockExpanded, setRightDockExpanded] = useState(false);
  const [rightDockTabs, setRightDockTabs] = useState<RightDockTab[]>([]);
  const [activeRightDockTabId, setActiveRightDockTabId] = useState<string | null>(null);
  const [mainComposerContexts, setMainComposerContexts] = useState<Record<string, SelectedTextContext[]>>({});
  const [dailyReportsForShell, setDailyReportsForShell] = useState(() => loadPremarketThemeRuns());
  const lastRegularRightPanelRef = useRef<{
    panel: Exclude<RightPanel, 'none' | 'coworkers'>;
    activeTabId: string | null;
  }>({ panel: 'features', activeTabId: null });
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
  const [windowFullscreen, setWindowFullscreen] = useState(() => isDocumentFullscreen());
  const wasWindowFocusedRef = useRef(true);
  const [skillCatalog, setSkillCatalog] = useState<readonly SkillCatalogItem[]>(() => createSkillCatalog(readOfficialSkillIds()));
  const [skillStatus, setSkillStatus] = useState<SkillStatusMap>(() => readSkillStatus(createSkillCatalog(readOfficialSkillIds())));
  const [queuedSkill, setQueuedSkill] = useState<SkillCatalogItem | null>(null);
  const [queuedSkillPrompt, setQueuedSkillPrompt] = useState<string | null>(null);
  const [queuedCoworkerTask, setQueuedCoworkerTask] = useState<QueuedCoworkerTask | null>(null);

  useEffect(() => {
    const syncReports = () => setDailyReportsForShell(loadPremarketThemeRuns());
    window.addEventListener(PREMARKET_THEME_RUNS_CHANGED_EVENT, syncReports);
    return () => window.removeEventListener(PREMARKET_THEME_RUNS_CHANGED_EVENT, syncReports);
  }, []);

  useEffect(() => {
    const syncOfficialSkills = (event: Event) => {
      const announced = event instanceof CustomEvent && Array.isArray(event.detail)
        ? event.detail.filter((id): id is string => typeof id === 'string')
        : readOfficialSkillIds();
      setSkillCatalog(createSkillCatalog(announced));
    };
    window.addEventListener(OFFICIAL_SKILLS_CHANGED_EVENT, syncOfficialSkills);
    return () => window.removeEventListener(OFFICIAL_SKILLS_CHANGED_EVENT, syncOfficialSkills);
  }, []);

  useEffect(() => {
    setSkillStatus((current) => {
      const defaults = defaultSkillStatus(skillCatalog);
      return Object.fromEntries(skillCatalog.map((skill) => {
        const saved = current[skill.id];
        if (skill.category === 'official' || skill.category === 'system') {
          return [skill.id, {
            installed: true,
            enabled: saved?.enabled ?? defaults[skill.id].enabled,
          }];
        }
        return [skill.id, saved ?? defaults[skill.id]];
      }));
    });
  }, [skillCatalog]);

  const dailyDecisionAvailable = dailyThemeTurnAvailable
    || dailyReportsForShell.some((report) => report.sourceConversationId === currentConversationId);

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
    const cleanups: Array<() => void> = [];
    if (isTauriRuntime()) {
      void import('@tauri-apps/api/window')
        .then(({ getCurrentWindow }) => {
          if (disposed) return;
          const appWindow = getCurrentWindow();
          const syncFullscreen = () => {
            void appWindow.isFullscreen()
              .then((fullscreen) => {
                if (!disposed) setWindowFullscreen(fullscreen);
              })
              .catch(() => undefined);
          };
          syncFullscreen();
          void appWindow
            .onFocusChanged(({ payload }) => setWindowFocused(payload))
            .then((unlisten) => {
              if (disposed) unlisten();
              else cleanups.push(unlisten);
            });
          void appWindow
            .onResized(syncFullscreen)
            .then((unlisten) => {
              if (disposed) unlisten();
              else cleanups.push(unlisten);
            });
        })
        .catch(() => undefined);
    } else {
      const onFocus = () => setWindowFocused(true);
      const onBlur = () => setWindowFocused(false);
      const onFullscreenChange = () => setWindowFullscreen(isDocumentFullscreen());
      setWindowFocused(document.hasFocus());
      setWindowFullscreen(isDocumentFullscreen());
      window.addEventListener('focus', onFocus);
      window.addEventListener('blur', onBlur);
      document.addEventListener('fullscreenchange', onFullscreenChange);
      cleanups.push(() => {
        window.removeEventListener('focus', onFocus);
        window.removeEventListener('blur', onBlur);
        document.removeEventListener('fullscreenchange', onFullscreenChange);
      });
    }
    return () => {
      disposed = true;
      cleanups.forEach((cleanup) => cleanup());
    };
  }, []);

  useEffect(() => {
    if ((!currentConversationId || !currentConversationExists) && firstActiveConversationId) {
      setCurrentConversation(firstActiveConversationId);
    }
  }, [currentConversationExists, currentConversationId, firstActiveConversationId, setCurrentConversation]);

  useEffect(() => {
    void refreshCodexStatus();
    void loadModelConfig();
  }, [refreshCodexStatus, loadModelConfig]);

  // Materialize the coworker catalog into Codex sub-agent definitions
  // (CODEX_HOME/agents/<id>.toml) so the main agent can spawn them.
  useEffect(() => {
    void syncCoworkerAgents(coworkerAgentDefinitions()).catch(() => undefined);
  }, []);

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
    setRightDockExpanded(false);
    setRightPanelVisible(false);
    setSettingsSection(section);
    setSettingsOpen(true);
  };

  const openSkills = () => {
    setRightDockExpanded(false);
    setRightPanelVisible(false);
    setSettingsOpen(false);
    setMainView('skills');
  };

  const openAutomations = () => {
    setRightDockExpanded(false);
    setRightPanelVisible(false);
    setSettingsOpen(false);
    setMainView('automations');
  };

  const setSkillInstalled = useCallback((id: string, installed: boolean) => {
    const skill = skillCatalog.find((candidate) => candidate.id === id);
    const protectedSkill = skill?.category === 'official' || skill?.category === 'system';
    const nextInstalled = protectedSkill ? true : installed;
    setSkillStatus((prev) => ({
      ...prev,
      [id]: { installed: nextInstalled, enabled: nextInstalled },
    }));
  }, [skillCatalog]);

  const setSkillEnabled = useCallback((id: string, enabled: boolean) => {
    setSkillStatus((prev) => {
      const fallback = defaultSkillStatus(skillCatalog)[id] ?? { installed: false, enabled: false };
      const current = prev[id] ?? fallback;
      return {
        ...prev,
        [id]: {
          installed: current.installed || enabled,
          enabled,
        },
      };
    });
  }, [skillCatalog]);

  const resetSkillStatus = useCallback((id: string) => {
    const fallback = defaultSkillStatus(skillCatalog)[id];
    if (!fallback) return;
    setSkillStatus((prev) => ({ ...prev, [id]: fallback }));
  }, [skillCatalog]);

  const queueSkillForComposer = useCallback((skill: SkillCatalogItem, prompt?: string) => {
    setSkillStatus((prev) => ({
      ...prev,
      [skill.id]: { installed: true, enabled: true },
    }));
    setQueuedSkill(skill);
    setQueuedSkillPrompt(prompt?.trim() || null);
    setSettingsOpen(false);
    setMainView('chat');
  }, []);

  const consumeQueuedSkill = useCallback(() => {
    setQueuedSkill(null);
    setQueuedSkillPrompt(null);
  }, []);

  const queueCoworkerTask = useCallback((coworker: CoworkerSelection | CoworkerSelection[], taskPrompt?: string) => {
    const coworkers = Array.isArray(coworker) ? coworker : [coworker];
    setQueuedCoworkerTask({ coworkers, taskPrompt });
    setSettingsOpen(false);
    setMainView('chat');
  }, []);

  const consumeQueuedCoworkerTask = useCallback(() => setQueuedCoworkerTask(null), []);

  const activeRightDockTab = useMemo(
    () => rightDockTabs.find((tab) => tab.id === activeRightDockTabId) ?? null,
    [rightDockTabs, activeRightDockTabId],
  );
  const currentRightPanel: RightPanel = activeRightDockTab?.kind ?? rightPanel;

  useEffect(() => {
    if (currentRightPanel === 'none' || currentRightPanel === 'coworkers') return;
    lastRegularRightPanelRef.current = {
      panel: currentRightPanel,
      activeTabId: activeRightDockTabId,
    };
  }, [activeRightDockTabId, currentRightPanel]);

  const activateRightDockTab = useCallback((tab: RightDockTab) => {
    setActiveRightDockTabId(tab.id);
    setRightPanel(tab.kind);
    setRightDockMounted(true);
    setRightPanelVisible(true);
  }, []);

  const addRightDockTab = useCallback((kind: RightDockKind, url?: string, selectedTextContexts?: SelectedTextContext[], stockCode?: string) => {
    if (kind === 'daily-decision') {
      const existing = rightDockTabs.find((tab) => tab.kind === kind);
      if (existing) {
        activateRightDockTab(existing);
        return;
      }
    }
    nextRightDockTabRef.current += 1;
    const tab: RightDockTab = {
      id: `${kind}-${Date.now()}-${nextRightDockTabRef.current}`,
      kind,
      url,
      requestKey: url || stockCode ? 1 : undefined,
      sourceConversationId: currentConversationId ?? undefined,
      selectedTextContexts,
      stockCode,
    };
    setRightDockTabs((prev) => [...prev, tab]);
    setActiveRightDockTabId(tab.id);
    setRightPanel(kind);
    setRightDockMounted(true);
    setRightPanelVisible(true);
  }, [activateRightDockTab, currentConversationId, rightDockTabs]);

  const addSelectionToMainChat = useCallback((context: SelectedTextContext) => {
    const conversationId = currentConversationId;
    if (!conversationId) return;
    setMainComposerContexts((current) => {
      const existing = current[conversationId] ?? [];
      if (existing.some((item) => item.id === context.id || item.text === context.text)) return current;
      return { ...current, [conversationId]: [...existing, context] };
    });
  }, [currentConversationId]);

  const removeMainComposerContext = useCallback((contextId: string) => {
    const conversationId = currentConversationId;
    if (!conversationId) return;
    setMainComposerContexts((current) => ({
      ...current,
      [conversationId]: (current[conversationId] ?? []).filter((item) => item.id !== contextId),
    }));
  }, [currentConversationId]);

  const consumeMainComposerContexts = useCallback(() => {
    const conversationId = currentConversationId;
    if (!conversationId) return;
    setMainComposerContexts((current) => ({ ...current, [conversationId]: [] }));
  }, [currentConversationId]);

  const askSelectionInSideChat = useCallback((context: SelectedTextContext) => {
    const existing = rightDockTabs.find((tab) => tab.id === activeRightDockTabId && tab.kind === 'side-chat')
      ?? [...rightDockTabs].reverse().find((tab) => tab.kind === 'side-chat');
    if (existing) {
      setRightDockTabs((tabs) => tabs.map((tab) => {
        if (tab.id !== existing.id) return tab;
        const contexts = tab.selectedTextContexts ?? [];
        if (contexts.some((item) => item.id === context.id || item.text === context.text)) return tab;
        return { ...tab, selectedTextContexts: [...contexts, context] };
      }));
      activateRightDockTab(existing);
      return;
    }
    addRightDockTab('side-chat', undefined, [context]);
  }, [activateRightDockTab, activeRightDockTabId, addRightDockTab, rightDockTabs]);

  const removeRightDockTextContext = useCallback((tabId: string, contextId: string) => {
    setRightDockTabs((tabs) => tabs.map((tab) => (
      tab.id === tabId
        ? { ...tab, selectedTextContexts: (tab.selectedTextContexts ?? []).filter((item) => item.id !== contextId) }
        : tab
    )));
  }, []);

  const consumeRightDockTextContexts = useCallback((tabId: string) => {
    setRightDockTabs((tabs) => tabs.map((tab) => (
      tab.id === tabId ? { ...tab, selectedTextContexts: [] } : tab
    )));
  }, []);

  const openBrowserUrl = useCallback((rawUrl: string) => {
    const displayUrl = browserDockDisplayUrl(rawUrl);
    if (!normalizeBrowserDockUrl(displayUrl)) return;
    const localPath = localFilePath(displayUrl);
    const existingTab = localPath
      ? rightDockTabs.find((tab) => tab.kind === 'browser' && localFilePath(tab.url || '') === localPath)
      : null;
    if (existingTab) {
      activateRightDockTab(existingTab);
      return;
    }
    addRightDockTab('browser', displayUrl);
  }, [activateRightDockTab, addRightDockTab, rightDockTabs]);

  const openFileInDock = useCallback((rawPath: string) => {
    const path = localFilePath(rawPath) || rawPath.trim();
    if (!path) return;
    const existingTab = rightDockTabs.find((tab) => tab.kind === 'files' && localFilePath(tab.url || '') === path);
    if (existingTab) {
      activateRightDockTab(existingTab);
      return;
    }
    addRightDockTab('files', path);
  }, [activateRightDockTab, addRightDockTab, rightDockTabs]);

  const selectRightDockTab = useCallback((id: string) => {
    const tab = rightDockTabs.find((item) => item.id === id);
    if (!tab) return;
    activateRightDockTab(tab);
  }, [activateRightDockTab, rightDockTabs]);

  const toggleRightDockKind = useCallback((kind: 'browser' | 'files' | 'research-workbench' | 'daily-decision') => {
    if (rightPanelVisible && currentRightPanel === kind) {
      setRightDockExpanded(false);
      setRightPanelVisible(false);
      return;
    }

    const existingTab = [...rightDockTabs].reverse().find((tab) => (
      tab.kind === kind && (kind !== 'files' || !tab.url)
    ));
    if (existingTab) {
      selectRightDockTab(existingTab.id);
      setRightDockExpanded(false);
      return;
    }

    addRightDockTab(kind);
  }, [addRightDockTab, currentRightPanel, rightPanelVisible, rightDockTabs, selectRightDockTab]);

  useEffect(() => {
    const openResearchStock = (event: Event) => {
      const code = (event as CustomEvent<{ code?: string }>).detail?.code;
      if (!code) return;
      setMainView('chat');
      setSettingsOpen(false);
      const existingTab = [...rightDockTabs].reverse().find((tab) => tab.kind === 'research-workbench');
      if (existingTab) {
        setRightDockTabs((tabs) => tabs.map((tab) => tab.id === existingTab.id
          ? { ...tab, stockCode: code, requestKey: (tab.requestKey ?? 0) + 1 }
          : tab));
        activateRightDockTab(existingTab);
        return;
      }
      addRightDockTab('research-workbench', undefined, undefined, code);
    };
    window.addEventListener(OPEN_RESEARCH_SECURITY_EVENT, openResearchStock);
    return () => window.removeEventListener(OPEN_RESEARCH_SECURITY_EVENT, openResearchStock);
  }, [activateRightDockTab, addRightDockTab, rightDockTabs]);

  useEffect(() => {
    const openDailyDecision = (event: Event) => {
      const conversationId = (event as CustomEvent<{ conversationId?: string }>).detail?.conversationId;
      if (conversationId && useChatStore.getState().conversations.some((conversation) => conversation.id === conversationId)) {
        setCurrentConversation(conversationId);
      }
      setMainView('chat');
      const existingTab = [...rightDockTabs].reverse().find((tab) => tab.kind === 'daily-decision');
      if (existingTab) activateRightDockTab(existingTab);
      else addRightDockTab('daily-decision');
    };
    window.addEventListener(OPEN_DAILY_DECISION_EVENT, openDailyDecision);
    return () => window.removeEventListener(OPEN_DAILY_DECISION_EVENT, openDailyDecision);
  }, [activateRightDockTab, addRightDockTab, rightDockTabs, setCurrentConversation]);

  const closeRightDockTab = useCallback((id: string) => {
    const index = rightDockTabs.findIndex((tab) => tab.id === id);
    if (index === -1) return;
    const next = rightDockTabs.filter((tab) => tab.id !== id);
    setRightDockTabs(next);
    if (activeRightDockTabId === id || !next.some((tab) => tab.id === activeRightDockTabId)) {
      const nextActive = next[Math.min(index, next.length - 1)] ?? null;
      setActiveRightDockTabId(nextActive?.id ?? null);
      setRightPanel(nextActive?.kind ?? 'features');
      if (!nextActive) {
        setRightDockExpanded(false);
        setRightPanelVisible(false);
      }
    }
  }, [activeRightDockTabId, rightDockTabs]);

  const updateRightDockTabTitle = useCallback((id: string, title: string) => {
    setRightDockTabs((tabs) => {
      const current = tabs.find((tab) => tab.id === id);
      if (!current || current.title === title) return tabs;
      return tabs.map((tab) => tab.id === id ? { ...tab, title } : tab);
    });
  }, []);

  useEffect(() => {
    if (dailyDecisionAvailable || !rightDockTabs.some((tab) => tab.kind === 'daily-decision')) return;
    const nextTabs = rightDockTabs.filter((tab) => tab.kind !== 'daily-decision');
    const activeWasDaily = rightDockTabs.find((tab) => tab.id === activeRightDockTabId)?.kind === 'daily-decision';
    setRightDockTabs(nextTabs);
    if (!activeWasDaily) return;
    const nextActive = nextTabs[nextTabs.length - 1] ?? null;
    setActiveRightDockTabId(nextActive?.id ?? null);
    setRightPanel(nextActive?.kind ?? 'features');
    if (!nextActive) {
      setRightDockExpanded(false);
      setRightPanelVisible(false);
    }
  }, [activeRightDockTabId, dailyDecisionAvailable, rightDockTabs]);

  const coworkersPanelOpen = rightPanelVisible && currentRightPanel === 'coworkers';
  const researchWorkbenchOpen = rightPanelVisible && currentRightPanel === 'research-workbench';
  const dailyDecisionOpen = rightPanelVisible && currentRightPanel === 'daily-decision';
  const filesPanelOpen = rightPanelVisible
    && currentRightPanel === 'files'
    && !activeRightDockTab?.url;
  const browserOpen = rightPanelVisible && currentRightPanel === 'browser';

  const toggleCoworkersPanel = useCallback(() => {
    if (coworkersPanelOpen) {
      setRightDockExpanded(false);
      setRightPanelVisible(false);
      return;
    }
    if (currentRightPanel !== 'coworkers') {
      lastRegularRightPanelRef.current = {
        panel: currentRightPanel === 'none' ? 'features' : currentRightPanel,
        activeTabId: activeRightDockTabId,
      };
      setRightPanel('coworkers');
      setActiveRightDockTabId(null);
    }
    setRightDockExpanded(false);
    setRightDockMounted(true);
    setRightPanelVisible(true);
  }, [activeRightDockTabId, coworkersPanelOpen, currentRightPanel]);

  const compactRightPanel =
    currentRightPanel === 'coworkers' ||
    currentRightPanel === 'terminal' ||
    currentRightPanel === 'browser' ||
    currentRightPanel === 'files' ||
    currentRightPanel === 'side-chat' ||
    currentRightPanel === 'research-workbench' ||
    currentRightPanel === 'daily-decision';

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
    !rightPanelVisible || rightDockExpanded
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
    catalog: skillCatalog,
    status: skillStatus,
    queuedSkill,
    queuedSkillPrompt,
    queuedCoworkerTask,
    setSkillInstalled,
    setSkillEnabled,
    resetSkillStatus,
    queueSkillForComposer,
    consumeQueuedSkill,
    queueCoworkerTask,
    consumeQueuedCoworkerTask,
  }), [
    skillCatalog,
    skillStatus,
    queuedSkill,
    queuedSkillPrompt,
    queuedCoworkerTask,
    setSkillInstalled,
    setSkillEnabled,
    resetSkillStatus,
    queueSkillForComposer,
    consumeQueuedSkill,
    queueCoworkerTask,
    consumeQueuedCoworkerTask,
  ]);

  return (
    <SkillRuntimeContext.Provider value={skillRuntime}>
      <BrowserDockContext.Provider value={openBrowserUrl}>
        <FileDockContext.Provider value={openFileInDock}>
          <div
            className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''} ${rightPanelVisible ? 'right-panel-open' : ''} ${rightPanelVisible && rightDockExpanded ? 'right-dock-expanded' : ''} ${coworkersPanelOpen ? 'coworkers-panel-open' : ''} ${dailyDecisionAvailable ? 'daily-decision-available' : ''} ${rightPanelVisible && currentRightPanel === 'git' ? 'git-panel-open' : ''} ${rightPanelVisible && currentRightPanel === 'review' ? 'review-panel-open' : ''} ${windowFocused ? '' : 'window-inactive'} ${windowFullscreen ? 'window-fullscreen' : ''}`}
            data-work-mode={domain.id}
            style={
              {
                ['--sidebar-width']: `${sidebarWidth}px`,
                ['--right-sidebar-width']: `${rightSidebarWidth}px`,
                ['--right-panel-main-min-width']: `${RIGHT_PANEL_MIN_MAIN_WIDTH}px`,
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
        {sidebarCollapsed && <CollapsedSidebarIdentity />}
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
                  coworkersPanelOpen={coworkersPanelOpen}
                  researchWorkbenchOpen={researchWorkbenchOpen}
                  dailyDecisionOpen={dailyDecisionOpen}
                  filesPanelOpen={filesPanelOpen}
                  browserOpen={browserOpen}
                  hidePanelActions={settingsOpen}
                  onToggleSidebar={() => setSidebarCollapsed((value) => !value)}
                  onToggleCoworkersPanel={toggleCoworkersPanel}
                  onToggleResearchWorkbench={() => toggleRightDockKind('research-workbench')}
                  onToggleDailyDecision={() => toggleRightDockKind('daily-decision')}
                  onToggleFilesPanel={() => toggleRightDockKind('files')}
                  onToggleBrowser={() => toggleRightDockKind('browser')}
                  onOpenSideChat={() => addRightDockTab('side-chat')}
                />
              )}
              {mainView === 'skills' ? (
                <SkillsPage
                  sidebarCollapsed={sidebarCollapsed}
                  onToggleSidebar={() => setSidebarCollapsed((value) => !value)}
                />
              ) : mainView === 'automations' ? (
                <AutomationsPage
                  sidebarCollapsed={sidebarCollapsed}
                  onToggleSidebar={() => setSidebarCollapsed((value) => !value)}
                  onOpenChat={() => setMainView('chat')}
                />
              ) : (
                <ChatArea
                  domain={domain}
                  selectedTextContexts={currentConversationId ? mainComposerContexts[currentConversationId] ?? [] : []}
                  onRemoveSelectedTextContext={removeMainComposerContext}
                  onConsumeSelectedTextContexts={consumeMainComposerContexts}
                  onAddSelectionToChat={addSelectionToMainChat}
                  onAskSelectionInSideChat={askSelectionInSideChat}
                />
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
                onUpdateTabTitle={updateRightDockTabTitle}
                onRemoveTextContext={removeRightDockTextContext}
                onConsumeTextContexts={consumeRightDockTextContexts}
                expanded={rightDockExpanded}
                onToggleExpanded={() => setRightDockExpanded((expanded) => !expanded)}
                onCloseGit={() => {
                  setRightDockExpanded(false);
                  setRightPanelVisible(false);
                }}
              />
            )}
          </div>
          {rightPanelVisible && rightDockExpanded && currentRightPanel !== 'side-chat' && (
            <DockOverlayComposer
              domain={domain}
              selectedTextContexts={currentConversationId ? mainComposerContexts[currentConversationId] ?? [] : []}
              onRemoveSelectedTextContext={removeMainComposerContext}
              onConsumeSelectedTextContexts={consumeMainComposerContexts}
            />
          )}
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
        </FileDockContext.Provider>
      </BrowserDockContext.Provider>
    </SkillRuntimeContext.Provider>
  );
}

function CollapsedSidebarToggle({
  collapsed,
  onToggle,
  className = '',
}: {
  collapsed: boolean;
  onToggle: () => void;
  className?: string;
}) {
  if (!collapsed) return null;
  const classes = ['icon-btn', 'chrome-tool-button', className].filter(Boolean).join(' ');
  return (
    <button className={classes} type="button" onClick={onToggle} aria-label="展开侧栏" title="展开侧栏">
      <ArrowRightToLine size={16} />
    </button>
  );
}

function CollapsedSidebarIdentity() {
  const clientLicenseSession = useChatStore((state) => state.clientLicenseSession);
  const activatedTenantName = activatedTenantDisplayName(clientLicenseSession);
  const activatedUserTitle = clientLicenseSession
    ? [clientLicenseSession.tenant.name, clientLicenseSession.user.name, clientLicenseSession.user.email]
        .map((part) => part.trim())
        .filter(Boolean)
        .join(' · ')
    : 'Alpha Studio';

  return (
    <div
      className="collapsed-sidebar-identity"
      title={activatedUserTitle}
      aria-label={`Alpha Studio · ${activatedTenantName}`}
      data-tauri-drag-region
    >
      <span className="collapsed-sidebar-brand" data-tauri-drag-region>
        <strong>ALPHA</strong><em>STUDIO</em>
      </span>
      <span className="collapsed-sidebar-account" data-tauri-drag-region>
        <i className="sidebar-account-status" aria-hidden="true" />
        <span>{activatedTenantName}</span>
      </span>
    </div>
  );
}

function CoworkersToggleButton({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      className={`icon-btn chrome-tool-button topbar-tool-button ${open ? 'active' : ''}`}
      type="button"
      onClick={onToggle}
      aria-label={open ? '关闭 AI 同事面板' : '打开 AI 同事面板'}
      aria-pressed={open}
      title="AI 同事"
    >
      <UsersRound size={16} />
    </button>
  );
}

function RightDockToggleButton({
  kind,
  open,
  onToggle,
}: {
  kind: 'browser' | 'files' | 'research-workbench';
  open: boolean;
  onToggle: () => void;
}) {
  const label = RIGHT_DOCK_META[kind].label;
  return (
    <button
      className={`icon-btn chrome-tool-button topbar-tool-button ${open ? 'active' : ''}`}
      type="button"
      onClick={onToggle}
      aria-label={`${open ? '关闭' : '打开'}${label}`}
      aria-pressed={open}
      title={label}
    >
      {rightDockIcon(kind, 16)}
    </button>
  );
}

function DailyDecisionToggleButton({
  open,
  loading,
  warning,
  badge,
  onToggle,
}: {
  open: boolean;
  loading: boolean;
  warning: boolean;
  badge: number;
  onToggle: () => void;
}) {
  const title = loading
    ? '日报正在生成'
    : warning
      ? '日报结构化失败，打开后可由 AI 补全'
      : '日报决策';
  return (
    <button
      className={`icon-btn chrome-tool-button topbar-tool-button daily-decision-toggle ${open ? 'active' : ''} ${warning ? 'warning' : ''}`}
      type="button"
      onClick={onToggle}
      aria-label={title}
      aria-pressed={open}
      title={title}
    >
      {loading ? <Loader2 size={16} className="spin" /> : warning ? <AlertTriangle size={16} /> : <FileCheck2 size={16} />}
      {badge > 0 && <span className="daily-decision-badge">{badge > 99 ? '99+' : badge}</span>}
    </button>
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
    const panel = row?.querySelector('.right-dock-workspace') as HTMLElement | null;
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
  const conversationsRevision = useChatStore((state) => sidebarConversationRevision(state.conversations));
  const conversations = useMemo(
    () => useChatStore.getState().conversations,
    [conversationsRevision],
  );
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
  const clientLicenseSession = useChatStore((state) => state.clientLicenseSession);

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
  const activatedTenantName = activatedTenantDisplayName(clientLicenseSession);
  const activatedUserTitle = clientLicenseSession
    ? [clientLicenseSession.tenant.name, clientLicenseSession.user.name, clientLicenseSession.user.email]
        .map((part) => part.trim())
        .filter(Boolean)
        .join(' · ')
    : 'Alpha Studio';

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
          onSelect: () => void handleCreateBlankProject(),
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

  const handleCreateBlankProject = async () => {
    const name = `新研究主题 ${liveProjects.length + 1}`;
    let cwd = '';
    try {
      cwd = (await createProjectFolder(name)) || '';
    } catch (error) {
      console.warn('Failed to create project folder', error);
    }
    const id = createProject({ name, cwd });
    setExpanded((prev) => ({ ...prev, [id]: true }));
    setEditingProjectId(id);
  };

  const handleCommitProjectRename = (project: Project, name: string) => {
    const trimmed = name.trim();
    renameProject(project.id, trimmed);
    setEditingProjectId(null);
    if (!trimmed || !project.cwd) return;
    void renameProjectFolder(project.cwd, trimmed)
      .then((cwd) => {
        if (cwd && cwd !== project.cwd) setProjectCwd(project.id, cwd);
      })
      .catch((error) => {
        console.warn('Failed to rename project folder', error);
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
          <div className="sidebar-brand" data-tauri-drag-region aria-label="Alpha Studio">
            <span className="sidebar-brand-copy" data-tauri-drag-region><strong>ALPHA</strong><em>STUDIO</em></span>
          </div>
          <button className="sidebar-collapse-btn chrome-tool-button" type="button" onClick={onCollapse} aria-label="收起侧栏" title="收起侧栏">
            <ArrowLeftToLine size={16} />
          </button>
          <div className="sidebar-account" title={activatedUserTitle} data-tauri-drag-region>
            <i className="sidebar-account-status" aria-hidden="true" />
            <span>{activatedTenantName}</span>
          </div>
        </div>
        <div className="sidebar-scroll">
          <div className="sidebar-menu-panel nav-menu">
            <div className="sidebar-index-label" aria-hidden="true"><span>WORKSPACE MENU</span><em>04</em></div>
            <button className="nav-item primary" data-index="01" type="button" onClick={() => { createConversationInContext(); onOpenChat(); }}>
              <SquarePen size={15} />
              <span className="nav-label">{sidebarCopy.newConversationLabel}</span>
            </button>
            <button className={`nav-item ${searchOpen ? 'active' : ''}`} data-index="02" type="button" onClick={() => setSearchOpen(true)}>
              <Search size={15} />
              <span className="nav-label">搜索</span>
              <span className="nav-shortcut">⌘K</span>
            </button>
            <button className={`nav-item ${activeView === 'skills' ? 'active' : ''}`} data-index="03" type="button" onClick={onOpenSkills}>
              <Plug size={15} />
              <span className="nav-label">{sidebarCopy.pluginsLabel}</span>
            </button>
            <button className={`nav-item ${activeView === 'automations' ? 'active' : ''}`} data-index="04" type="button" onClick={onOpenAutomations}>
              <Clock3 size={15} />
              <span className="nav-label">{sidebarCopy.automationLabel}</span>
            </button>
          </div>

          {pinnedConversations.length > 0 && (
            <>
              <SectionLabel meta={String(pinnedConversations.length).padStart(2, '0')}>置顶</SectionLabel>
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

          <SidebarHead label={sidebarCopy.projectSectionLabel} meta={String(sortedProjects.length).padStart(2, '0')} menuOpen={menu?.owner === 'project-section' || menu?.owner === 'add'}>
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
                    handleCommitProjectRename(project, name);
                  }}
                  onCancelRename={() => setEditingProjectId(null)}
                  onOpenMenu={(anchor) => openProjectMenu(project, anchor)}
                />
              ))
            )}
          </div>

          <SidebarHead
            label={sidebarCopy.conversationSectionLabel}
            meta={String(sortedStandalone.length).padStart(2, '0')}
            menuOpen={menu?.owner === 'conversation-section'}
            expanded={!conversationsCollapsed}
            onToggle={() => setConversationsCollapsed((value) => !value)}
          >
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
                <ConversationList
                  conversations={sortedStandalone}
                  currentConversationId={currentConversationId}
                  activeMenuId={menu?.owner ?? null}
                  editingConversationId={editingConversationId}
                  onSelectConversation={(id) => { setCurrentConversation(id); onOpenChat(); }}
                  onOpenConversationMenu={openConversationMenu}
                  onCommitConversationRename={(id, name) => {
                    renameConversation(id, name);
                    setEditingConversationId(null);
                  }}
                  onCancelConversationRename={() => setEditingConversationId(null)}
                />
              )}
            </div>
          )}
        </div>
        <div className="sidebar-footer">
          <button className="nav-item settings-entry" type="button" onClick={() => onOpenSettings('general')}>
            <Settings size={15} />
            <span className="nav-label">{sidebarCopy.settingsLabel}</span>
            <span className="sidebar-footer-code" aria-hidden="true">SYS.CONFIG</span>
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

function SidebarHead({
  label,
  meta,
  menuOpen,
  expanded,
  onToggle,
  children,
}: {
  label: string;
  meta?: string;
  menuOpen?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  children: ReactNode;
}) {
  const collapsible = Boolean(onToggle);
  return (
    <div className={`sidebar-group-head ${menuOpen ? 'menu-open' : ''} ${collapsible ? 'collapsible' : ''}`}>
      {collapsible ? (
        <button
          className="sidebar-group-toggle"
          type="button"
          aria-expanded={expanded}
          aria-label={`${label}，${expanded ? '收起列表' : '展开列表'}`}
          onClick={onToggle}
        >
          <span className="sidebar-group-label">{label}</span>
          {meta && <span className="sidebar-group-meta" aria-hidden="true">{meta}</span>}
        </button>
      ) : (
        <>
          <span className="sidebar-group-label">{label}</span>
          {meta && <span className="sidebar-group-meta" aria-hidden="true">{meta}</span>}
        </>
      )}
      <span className="sidebar-group-actions">{children}</span>
    </div>
  );
}

function SectionLabel({ children, meta }: { children: ReactNode; meta?: string }) {
  return <div className="sidebar-section-label"><span>{children}</span>{meta && <em aria-hidden="true">{meta}</em>}</div>;
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
      {!editing && !streaming && conversation.unread && <span className="conv-unread-dot" aria-label="未读" />}
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

function ConversationList({
  conversations,
  currentConversationId,
  activeMenuId,
  editingConversationId,
  nested = false,
  onSelectConversation,
  onOpenConversationMenu,
  onCommitConversationRename,
  onCancelConversationRename,
}: {
  conversations: Conversation[];
  currentConversationId: string | null;
  activeMenuId: string | null;
  editingConversationId: string | null;
  nested?: boolean;
  onSelectConversation: (id: string) => void;
  onOpenConversationMenu: (conversation: Conversation, anchor: MenuAnchor) => void;
  onCommitConversationRename: (id: string, name: string) => void;
  onCancelConversationRename: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const hasMore = conversations.length > SIDEBAR_CONVERSATION_PREVIEW_LIMIT;
  const hiddenCount = Math.max(0, conversations.length - SIDEBAR_CONVERSATION_PREVIEW_LIMIT);
  const displayedConversations = showAll
    ? conversations
    : conversations.slice(0, SIDEBAR_CONVERSATION_PREVIEW_LIMIT);

  return (
    <>
      {displayedConversations.map((conversation) => (
        <ConversationRow
          key={conversation.id}
          conversation={conversation}
          active={conversation.id === currentConversationId}
          nested={nested}
          menuOpen={activeMenuId === conversation.id}
          editing={editingConversationId === conversation.id}
          onSelect={() => onSelectConversation(conversation.id)}
          onOpenMenu={(anchor) => onOpenConversationMenu(conversation, anchor)}
          onCommitRename={(name) => onCommitConversationRename(conversation.id, name)}
          onCancelRename={onCancelConversationRename}
        />
      ))}
      {hasMore && (
        <button
          className={`conversation-list-toggle ${nested ? 'nested' : ''} ${showAll ? 'expanded' : ''}`}
          type="button"
          aria-expanded={showAll}
          aria-label={showAll ? '收起显示' : `展开显示，另有 ${hiddenCount} 个对话`}
          onClick={() => setShowAll((value) => !value)}
        >
          <span>{showAll ? '收起显示' : '展开显示'}</span>
          <em>{showAll ? `${conversations.length} 条` : `+${hiddenCount}`}</em>
          {showAll ? <ChevronsDownUp size={13} /> : <ChevronsUpDown size={13} />}
        </button>
      )}
    </>
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
            <ConversationList
              conversations={conversations}
              currentConversationId={currentConversationId}
              activeMenuId={activeMenuId}
              editingConversationId={editingConversationId}
              nested
              onSelectConversation={onSelectConversation}
              onOpenConversationMenu={onOpenConversationMenu}
              onCommitConversationRename={onCommitConversationRename}
              onCancelConversationRename={onCancelConversationRename}
            />
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
  const updatePosition = useCallback(() => {
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pad = 10;
    setPos({
      left: Math.max(pad, Math.min(menu.x, window.innerWidth - rect.width - pad)),
      top: Math.max(pad, Math.min(menu.y, window.innerHeight - rect.height - pad)),
    });
  }, [menu.x, menu.y]);
  useLayoutEffect(() => {
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [menu.items.length, updatePosition]);
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
  return createPortal(
    <>
      <button className="menu-backdrop" type="button" aria-label="关闭菜单" onClick={onClose} />
      <div ref={panelRef} className="cmenu" role="menu" style={{ left: pos.left, top: pos.top }}>
        {menu.items.map((node, index) => <MenuRow key={index} node={node} onRun={run} />)}
      </div>
    </>,
    document.body,
  );
}

function MenuRow({ node, onRun }: { node: MenuNode; onRun: (action: () => void) => void }) {
  const [subOpen, setSubOpen] = useState(false);
  const flyoutRef = useRef<HTMLDivElement>(null);
  const [flyoutPlacement, setFlyoutPlacement] = useState<{ left: boolean; top: number }>({ left: false, top: 0 });
  useLayoutEffect(() => {
    if (!subOpen || node.kind !== 'submenu') return;
    const updateFlyoutPlacement = () => {
      const flyout = flyoutRef.current;
      const row = flyout?.parentElement;
      if (!flyout || !row) return;
      const flyoutRect = flyout.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      const pad = 10;
      const openLeft = flyoutRect.right > window.innerWidth - pad && rowRect.left >= flyoutRect.width + pad;
      const desiredTop = rowRect.top + flyoutRect.height > window.innerHeight - pad
        ? window.innerHeight - pad - rowRect.top - flyoutRect.height
        : 0;
      setFlyoutPlacement({ left: openLeft, top: Math.max(pad - rowRect.top, desiredTop) });
    };
    updateFlyoutPlacement();
    window.addEventListener('resize', updateFlyoutPlacement);
    return () => window.removeEventListener('resize', updateFlyoutPlacement);
  }, [node.kind, subOpen]);
  if (node.kind === 'separator') return <div className="cmenu-sep" role="separator" />;
  if (node.kind === 'submenu') {
    return (
      <div className="cmenu-subwrap" onMouseEnter={() => setSubOpen(true)} onMouseLeave={() => setSubOpen(false)}>
        <button type="button" className={`cmenu-item ${subOpen ? 'active' : ''}`} role="menuitem">
          <span className="cmenu-icon">{node.icon}</span><span className="cmenu-label">{node.label}</span><ChevronRight size={14} className="cmenu-chevron" />
        </button>
        {subOpen && (
          <div
            ref={flyoutRef}
            className={`cmenu-flyout ${flyoutPlacement.left ? 'open-left' : ''}`}
            style={{ top: flyoutPlacement.top }}
          >
            <div className="cmenu" role="menu">{node.children.map((child, index) => <MenuRow key={index} node={child} onRun={onRun} />)}</div>
          </div>
        )}
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
  coworkersPanelOpen,
  researchWorkbenchOpen,
  dailyDecisionOpen,
  filesPanelOpen,
  browserOpen,
  hidePanelActions = false,
  onToggleSidebar,
  onToggleCoworkersPanel,
  onToggleResearchWorkbench,
  onToggleDailyDecision,
  onToggleFilesPanel,
  onToggleBrowser,
  onOpenSideChat,
}: {
  domain: DomainConfig;
  sidebarCollapsed: boolean;
  coworkersPanelOpen: boolean;
  researchWorkbenchOpen: boolean;
  dailyDecisionOpen: boolean;
  filesPanelOpen: boolean;
  browserOpen: boolean;
  hidePanelActions?: boolean;
  onToggleSidebar: () => void;
  onToggleCoworkersPanel: () => void;
  onToggleResearchWorkbench: () => void;
  onToggleDailyDecision: () => void;
  onToggleFilesPanel: () => void;
  onToggleBrowser: () => void;
  onOpenSideChat: () => void;
}) {
  const conversationRevision = useChatStore((state) => {
    const conversation = state.conversations.find((item) => (
      item.id === state.currentConversationId && !item.archivedAt && !item.ephemeral
    )) ?? state.conversations.find((item) => !item.archivedAt && !item.ephemeral);
    if (!conversation) return '';
    const latestUser = latestUserMessageIn(conversation.messages);
    let latestAssistantId = '';
    for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
      const message = conversation.messages[index];
      if (message.role === 'assistant' && message.timestamp >= (latestUser?.timestamp ?? 0)) {
        latestAssistantId = message.id;
        break;
      }
    }
    return [
      conversation.id,
      conversation.title,
      conversation.cwd,
      conversation.pinned ? '1' : '0',
      conversation.status,
      conversation.messages.length,
      latestUser?.id ?? '',
      latestUser?.timestamp ?? '',
      conversationHasDailyThemeTurn(conversation) ? 'daily' : '',
      latestAssistantId,
    ].join('\u0000');
  });
  const conversation = useMemo(() => {
    const state = useChatStore.getState();
    return state.conversations.find((item) => (
      item.id === state.currentConversationId && !item.archivedAt && !item.ephemeral
    )) ?? state.conversations.find((item) => !item.archivedAt && !item.ephemeral) ?? null;
  }, [conversationRevision]);
  const renameConversation = useChatStore((state) => state.renameConversation);
  const toggleConversationPin = useChatStore((state) => state.toggleConversationPin);
  const archiveConversation = useChatStore((state) => state.archiveConversation);
  const [editing, setEditing] = useState(false);
  const [menu, setMenu] = useState<SidebarMenu | null>(null);
  const [dailyReports, setDailyReports] = useState(() => loadPremarketThemeRuns());
  const [dailyDecisionState, setDailyDecisionState] = useState(() => loadDailyDecisionState());
  const cwd = conversation?.cwd || '';

  useEffect(() => {
    const syncReports = () => setDailyReports(loadPremarketThemeRuns());
    const syncDecisions = () => setDailyDecisionState(loadDailyDecisionState());
    window.addEventListener(PREMARKET_THEME_RUNS_CHANGED_EVENT, syncReports);
    window.addEventListener(DAILY_DECISION_CHANGED_EVENT, syncDecisions);
    return () => {
      window.removeEventListener(PREMARKET_THEME_RUNS_CHANGED_EVENT, syncReports);
      window.removeEventListener(DAILY_DECISION_CHANGED_EVENT, syncDecisions);
    };
  }, []);

  const conversationReports = dailyReports.filter((report) => report.sourceConversationId === conversation?.id);
  const hasDailyThemeTurn = conversationHasDailyThemeTurn(conversation);
  const dailyDecisionAvailable = hasDailyThemeTurn || conversationReports.length > 0;
  const latestUserMessage = latestUserMessageIn(conversation?.messages ?? []);
  const latestTurnIsDailyTheme = Boolean(latestUserMessage && (
    latestUserMessage.selectedSkill?.id === ALPHA_STUDIO_DAILY_THEME_SKILL_ID
    || latestUserMessage.blocks.some((block) => block.type === 'text' && block.content.includes(ALPHA_STUDIO_DAILY_THEME_SKILL_ID))
  ));
  let latestAssistantMessage: ChatMessage | undefined;
  for (let index = (conversation?.messages.length ?? 0) - 1; index >= 0; index -= 1) {
    const message = conversation?.messages[index];
    if (message?.role === 'assistant' && message.timestamp >= (latestUserMessage?.timestamp ?? 0)) {
      latestAssistantMessage = message;
      break;
    }
  }
  const boundMessageIds = new Set(conversationReports.map((report) => report.sourceMessageId).filter(Boolean));
  const dailyDecisionLoading = latestTurnIsDailyTheme && conversation?.status === 'streaming';
  const dailyDecisionWarning = latestTurnIsDailyTheme
    && conversation?.status !== 'streaming'
    && Boolean(latestAssistantMessage)
    && !boundMessageIds.has(latestAssistantMessage?.id);
  const dailyReportIds = new Set(conversationReports.map((report) => report.id));
  const dailyDecisionBadge = dailyDecisionState.recommendations.filter((recommendation) => (
    dailyReportIds.has(recommendation.reportId)
    && !['confirmed', 'deferred', 'rejected'].includes(recommendation.status)
  )).length;

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
      } else if (!event.altKey && !event.shiftKey && event.code === 'Backspace') {
        event.preventDefault();
        archiveConversation(conversation.id);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [conversation?.id, toggleConversationPin, archiveConversation]);

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
        { kind: 'item', icon: <Archive size={15} />, label: '归档对话', onSelect: () => archiveConversation(conversation.id) },
        { kind: 'separator' },
        { kind: 'item', icon: <MessageSquarePlus size={15} />, label: '打开侧边聊天', onSelect: openSideChat },
        {
          kind: 'submenu',
          icon: <Copy size={15} />,
          label: '复制',
          children: [
            { kind: 'item', icon: <Pencil size={15} />, label: '复制对话标题', onSelect: () => void copyToClipboard(conversation.title) },
            {
              kind: 'item',
              icon: <FileText size={15} />,
              label: '复制对话内容',
              disabled: !hasMessages,
              onSelect: () => {
                const latest = useChatStore.getState().conversations.find((item) => item.id === conversation.id);
                void copyToClipboard(conversationToPlainText(latest ?? conversation));
              },
            },
          ],
        },
      ],
    });
  };

  return (
    <header className="top-bar" data-tauri-drag-region>
      {sidebarCollapsed && <button className="icon-btn chrome-tool-button" type="button" onClick={onToggleSidebar} aria-label="展开侧栏"><ArrowRightToLine size={16} /></button>}
      {conversation ? (
        <div className={`top-bar-title ${editing ? 'editing' : ''}`} data-tauri-drag-region>
          <span className="top-bar-context">WORKSPACE</span>
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
      {!hidePanelActions && createPortal(
        <div className="top-bar-actions">
          <div className="top-bar-panel-actions">
            <CoworkersToggleButton open={coworkersPanelOpen} onToggle={onToggleCoworkersPanel} />
            {dailyDecisionAvailable && (
              <DailyDecisionToggleButton
                open={dailyDecisionOpen}
                loading={dailyDecisionLoading}
                warning={dailyDecisionWarning}
                badge={dailyDecisionBadge}
                onToggle={onToggleDailyDecision}
              />
            )}
            <RightDockToggleButton kind="files" open={filesPanelOpen} onToggle={onToggleFilesPanel} />
            <RightDockToggleButton
              kind="research-workbench"
              open={researchWorkbenchOpen}
              onToggle={onToggleResearchWorkbench}
            />
            <RightDockToggleButton kind="browser" open={browserOpen} onToggle={onToggleBrowser} />
          </div>
        </div>,
        document.body,
      )}
      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
    </header>
  );
}

const OPEN_APP_META: Record<OpenAppId, { label: string; color: string; glyph: string }> = {
  vscode: { label: 'VS Code', color: '#2f93e0', glyph: '〈〉' },
  cursor: { label: 'Cursor', color: '#111317', glyph: '▮' },
  finder: { label: 'Finder', color: '#1f9bff', glyph: '☺' },
  preview: { label: 'Preview', color: '#287bd1', glyph: '⌕' },
  terminal: { label: 'Terminal', color: '#3a3a3a', glyph: '>_' },
  pycharm: { label: 'PyCharm', color: '#21d789', glyph: 'PC' },
  xcode: { label: 'Xcode', color: '#1688f0', glyph: '⌘' },
};

const OPEN_APP_ORDER: OpenAppId[] = ['vscode', 'cursor', 'finder', 'terminal', 'pycharm'];
const FILE_OPEN_APP_ORDER: OpenAppId[] = ['preview', 'cursor', 'vscode', 'xcode', 'pycharm'];

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
  const cwd = useCurrentConversationCwd();
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
  return ['web_search', 'websearch', 'web.search', 'browse_search', 'search_query', 'image_query'].some((key) => normalized.includes(key));
}

function isWebPageToolTitle(title: string): boolean {
  const normalized = title.trim().toLowerCase();
  return ['webfetch', 'web_fetch', 'webopen', 'web_open', 'openpage', 'open_page', 'webfind', 'web_find', 'findinpage', 'find_in_page']
    .some((key) => normalized.includes(key));
}

function isSpawnAgentToolTitle(title: string): boolean {
  return /spawn[\s._-]*agent/i.test(title);
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

function normalizeBrowserDockUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const filePath = localFilePath(trimmed);
  if (filePath) return localFileBrowserUrl(filePath);
  if (/^asset:\/\//i.test(trimmed)) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^\/\//.test(trimmed)) {
    const protocol = typeof window !== 'undefined' ? window.location.protocol : 'https:';
    return `${protocol}${trimmed}`;
  }
  if (/^(localhost|\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?(?:[/?#]|$)/i.test(trimmed)) {
    return `http://${trimmed}`;
  }
  if (/^[\w.-]+\.[a-z]{2,}(?::\d+)?(?:[/?#]|$)/i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  if (/^\.{0,2}\//.test(trimmed)) {
    try {
      return new URL(trimmed, typeof window !== 'undefined' ? window.location.href : 'http://localhost/').href;
    } catch {
      return null;
    }
  }
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

function browserDockDisplayUrl(value: string): string {
  const trimmed = value.trim();
  return localFilePath(trimmed) || trimmed;
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
  const cwd = useCurrentConversationCwd();
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
      return <Compass size={size} />;
    case 'files':
      return <Folder size={size} />;
    case 'side-chat':
      return <MessageSquare size={size} />;
    case 'research-workbench':
      return <ChartCandlestick size={size} />;
    case 'daily-decision':
      return <FileCheck2 size={size} />;
  }
}

function compactDockTabTitle(value: string): string {
  const title = value.replace(/\s+/g, ' ').trim();
  return title.length > 80 ? `${title.slice(0, 79)}…` : title;
}

function browserDockTabTitle(pageTitle = '', rawUrl = ''): string {
  const title = compactDockTabTitle(pageTitle);
  if (title) return title;

  const localPath = localFilePath(rawUrl);
  if (localPath) return compactDockTabTitle(basename(localPath).replace(/\.[^.]+$/, '')) || '新标签';

  const normalizedUrl = normalizeBrowserDockUrl(rawUrl);
  if (!normalizedUrl) return '新标签';
  try {
    const parsed = new URL(normalizedUrl);
    const host = parsed.hostname.replace(/^www\./i, '');
    const pathParts = parsed.pathname.split('/').filter(Boolean);
    const rawLeaf = pathParts[pathParts.length - 1] || '';
    let leaf = rawLeaf;
    try {
      leaf = decodeURIComponent(rawLeaf);
    } catch {
      // Keep the encoded path segment if it cannot be decoded safely.
    }
    const readableLeaf = compactDockTabTitle(leaf.replace(/\.[a-z0-9]{1,8}$/i, '').replace(/[-_]+/g, ' '));
    return readableLeaf ? `${readableLeaf} · ${host}` : host || '新标签';
  } catch {
    return compactDockTabTitle(rawUrl) || '新标签';
  }
}

function rightDockTabTitle(tab: RightDockTab): string {
  if (tab.kind === 'browser') return browserDockTabTitle(tab.title, tab.url);
  if (tab.kind === 'files' && tab.url) return compactDockTabTitle(basename(tab.url)) || RIGHT_DOCK_META.files.label;
  return RIGHT_DOCK_META[tab.kind].label;
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
  onUpdateTabTitle,
  onRemoveTextContext,
  onConsumeTextContexts,
  expanded,
  onToggleExpanded,
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
  onUpdateTabTitle: (id: string, title: string) => void;
  onRemoveTextContext: (tabId: string, contextId: string) => void;
  onConsumeTextContexts: (tabId: string) => void;
  expanded: boolean;
  onToggleExpanded: () => void;
  onCloseGit: () => void;
}) {
  const activeTab = tabs.find((tab) => tab.id === activeId) ?? null;
  const showTabs = Boolean(activeTab);
  const dockMode = activeTab?.kind ?? mode;

  return (
    <aside className={`right-dock-workspace right-dock-${dockMode} ${visible ? '' : 'collapsed'}`} aria-label="侧边栏">
      {showTabs ? (
        <>
          <RightDockTabBar
            tabs={tabs}
            activeId={activeId}
            expanded={expanded}
            onSelectTab={onSelectTab}
            onCloseTab={onCloseTab}
            onAddTab={onAddTab}
            onToggleExpanded={onToggleExpanded}
          />
          <div className="right-dock-tab-content">
            {tabs.map((tab) => (
              <div key={tab.id} className={`right-dock-pane ${tab.id === activeId ? 'active' : ''}`} aria-hidden={tab.id !== activeId}>
                {tab.kind === 'review' && <ReviewChangesPanel />}
                {tab.kind === 'terminal' && <TerminalPanel theme={theme} dock visible={visible && tab.id === activeId} onClose={() => undefined} />}
                {tab.kind === 'browser' && (
                  <BrowserDockPanel
                    requestedUrl={tab.url}
                    requestKey={tab.requestKey}
                    active={visible && tab.id === activeId}
                    onTabTitleChange={(title) => onUpdateTabTitle(tab.id, title)}
                  />
                )}
                {tab.kind === 'files' && <FilesDockPanel filePath={tab.url} />}
                {tab.kind === 'side-chat' && (
                  <SideChatPanel
                    domain={domain}
                    tabId={tab.id}
                    sourceConversationId={tab.sourceConversationId}
                    selectedTextContexts={tab.selectedTextContexts ?? []}
                    onRemoveSelectedTextContext={(contextId) => onRemoveTextContext(tab.id, contextId)}
                    onConsumeSelectedTextContexts={() => onConsumeTextContexts(tab.id)}
                  />
                )}
                {tab.kind === 'research-workbench' && (
                  <Suspense fallback={<LazyPanelFallback label="正在加载个股研究" />}>
                    <ResearchWorkbenchPanel requestedStockCode={tab.stockCode} requestKey={tab.requestKey} />
                  </Suspense>
                )}
                {tab.kind === 'daily-decision' && (
                  <Suspense fallback={<LazyPanelFallback label="正在加载每日决策" />}>
                    <DailyDecisionPanel />
                  </Suspense>
                )}
              </div>
            ))}
          </div>
        </>
      ) : mode === 'git' ? (
        <GitPanel onClose={onCloseGit} />
      ) : mode === 'coworkers' ? (
        <CoworkersPanel />
      ) : (
        null
      )}
    </aside>
  );
}

function RightDockTabBar({
  tabs,
  activeId,
  expanded,
  onSelectTab,
  onCloseTab,
  onAddTab,
  onToggleExpanded,
}: {
  tabs: RightDockTab[];
  activeId: string | null;
  expanded: boolean;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onAddTab: (kind: RightDockKind) => void;
  onToggleExpanded: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const tabScrollRef = useRef<HTMLDivElement>(null);
  const add = (kind: RightDockKind) => {
    setMenuOpen(false);
    onAddTab(kind);
  };

  useLayoutEffect(() => {
    const scroller = tabScrollRef.current;
    if (!scroller || !activeId) return;
    const activeTab = Array.from(scroller.children).find((element) => (
      element instanceof HTMLElement && element.dataset.tabId === activeId
    ));
    if (!(activeTab instanceof HTMLElement)) return;
    const left = activeTab.offsetLeft;
    const right = left + activeTab.offsetWidth;
    if (left < scroller.scrollLeft) scroller.scrollLeft = Math.max(0, left - 6);
    else if (right > scroller.scrollLeft + scroller.clientWidth) scroller.scrollLeft = right - scroller.clientWidth + 6;
  }, [activeId, tabs]);

  return (
    <header className="right-dock-tabbar" data-tauri-drag-region>
      <div className="right-dock-tabs" data-tauri-drag-region>
        <div
          ref={tabScrollRef}
          className="right-dock-tab-scroll"
          role="tablist"
          aria-label="侧边栏标签"
          onWheel={(event) => {
            const scroller = event.currentTarget;
            if (scroller.scrollWidth <= scroller.clientWidth) return;
            const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
            if (!delta) return;
            scroller.scrollLeft += delta;
            event.preventDefault();
          }}
        >
          {tabs.map((tab) => {
            const label = rightDockTabTitle(tab);
            return (
              <div
                key={tab.id}
                data-tab-id={tab.id}
                role="tab"
                tabIndex={0}
                aria-selected={tab.id === activeId}
                title={tab.kind === 'browser' && tab.url ? `${label}\n${tab.url}` : label}
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
                <span className="right-dock-tab-label">{label}</span>
                <button
                  type="button"
                  className="right-dock-tab-close"
                  aria-label={`关闭${label}标签`}
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
        </div>
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
      <div className="right-dock-tabbar-actions">
        <button
          type="button"
          className={`right-dock-expand-btn chrome-tool-button ${expanded ? 'active' : ''}`}
          aria-label={expanded ? '还原侧边栏' : '展开侧边栏'}
          title={expanded ? '还原侧边栏' : '展开侧边栏'}
          aria-pressed={expanded}
          onClick={onToggleExpanded}
        >
          {expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </button>
      </div>
    </header>
  );
}

// Each coworker gets a stable icon so the roster reads like a real team of
// specialist seats instead of a numbered list.
const COWORKER_ICONS: Record<string, ReactNode> = {
  mainline: <Target size={15} />,
  theme: <Network size={15} />,
  sentiment: <Activity size={15} />,
  value_a: <FileChartColumn size={15} />,
  value_b: <LineChart size={15} />,
  value_c: <Layers size={15} />,
  risk: <ShieldCheck size={15} />,
  pm_deputy: <ListChecks size={15} />,
  compliance: <Archive size={15} />,
};

const COWORKER_GROUP_ORDER: CoworkerGroup[] = ['strategy', 'research', 'portfolio', 'guard', 'decision', 'audit'];

function CoworkerAvatar({ coworker, size = 'md' }: { coworker: CoworkerProfile; size?: 'sm' | 'md' }) {
  return (
    <span className={`coworker-avatar coworker-avatar-${size}`} data-group={coworker.group} aria-hidden>
      {COWORKER_ICONS[coworker.id] ?? <Users size={15} />}
      <span className="coworker-avatar-dot" />
    </span>
  );
}

// Right-side panel: the nine-seat AI research team plus committee-style
// collaboration playbooks. Cards drag into the composer; playbooks import a
// full multi-coworker prompt with one click.
function CoworkersPanel() {
  const { queueCoworkerTask } = useSkillRuntime();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [view, setView] = useState<'team' | 'workflows'>('team');

  const startDrag = (event: ReactDragEvent<HTMLElement>, coworker: CoworkerProfile) => {
    const selection = toCoworkerSelection(coworker);
    event.dataTransfer.setData(COWORKER_DRAG_MIME, JSON.stringify(selection));
    event.dataTransfer.setData('text/plain', `${coworker.no} ${coworker.name}`);
    event.dataTransfer.effectAllowed = 'copy';
  };

  const groupedCatalog = COWORKER_GROUP_ORDER
    .map((group) => ({ group, coworkers: COWORKER_CATALOG.filter((coworker) => coworker.group === group) }))
    .filter((entry) => entry.coworkers.length > 0);

  return (
    <div className="coworkers-panel" aria-label="AI 同事">
      <header className="coworkers-panel-head" data-tauri-drag-region>
        <div className="coworkers-panel-title" data-tauri-drag-region>
          <span className="coworkers-panel-title-icon"><Users size={14} /></span>
          <span>AI 投研团队</span>
        </div>
        <span className="coworkers-panel-presence">
          <span className="coworkers-panel-presence-dot" />
          {COWORKER_CATALOG.length} 位在线
        </span>
      </header>
      <div className="coworkers-panel-switch" role="tablist" aria-label="AI 同事视图">
        <button
          type="button"
          role="tab"
          aria-selected={view === 'team'}
          className={`coworkers-switch-btn ${view === 'team' ? 'active' : ''}`}
          onClick={() => setView('team')}
        >
          <Users size={13} />
          团队席位
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'workflows'}
          className={`coworkers-switch-btn ${view === 'workflows' ? 'active' : ''}`}
          onClick={() => setView('workflows')}
        >
          <Workflow size={13} />
          协作模板
          <span className="coworkers-switch-count">{COWORKER_WORKFLOW_PRESETS.length}</span>
        </button>
      </div>
      {view === 'team' ? (
        <div className="coworkers-list" key="team">
          <p className="coworkers-panel-hint">拖动同事进对话框指派任务,点击查看预设任务。</p>
          {groupedCatalog.map(({ group, coworkers }) => (
            <section key={group} className="coworker-group-section" aria-label={COWORKER_GROUP_LABELS[group]}>
              <h3 className="coworker-group-title" data-group={group}>
                <span className="coworker-group-title-dot" />
                {COWORKER_GROUP_LABELS[group]}
                <span className="coworker-group-title-count">{coworkers.length}</span>
              </h3>
              {coworkers.map((coworker) => {
                const expanded = expandedId === coworker.id;
                return (
                  <article
                    key={coworker.id}
                    className={`coworker-card ${expanded ? 'expanded' : ''}`}
                    data-group={coworker.group}
                    draggable
                    onDragStart={(event) => startDrag(event, coworker)}
                  >
                    <button
                      type="button"
                      className="coworker-card-head"
                      onClick={() => setExpandedId(expanded ? null : coworker.id)}
                      aria-expanded={expanded}
                    >
                      <CoworkerAvatar coworker={coworker} />
                      <span className="coworker-card-main">
                        <span className="coworker-card-name">
                          <span className="coworker-card-no">{coworker.no}</span>
                          {coworker.name}
                        </span>
                        <span className="coworker-card-desc">{coworker.description}</span>
                      </span>
                      <span className="coworker-card-side">
                        <span
                          role="button"
                          tabIndex={0}
                          className="coworker-summon-mini"
                          title="召集到对话框"
                          aria-label={`召集 ${coworker.name} 到对话框`}
                          onClick={(event) => {
                            event.stopPropagation();
                            queueCoworkerTask(toCoworkerSelection(coworker));
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              event.stopPropagation();
                              queueCoworkerTask(toCoworkerSelection(coworker));
                            }
                          }}
                        >
                          <MessageSquarePlus size={14} />
                        </span>
                        <ChevronDown size={13} className={`coworker-card-chevron ${expanded ? 'open' : ''}`} />
                      </span>
                    </button>
                    {expanded && (
                      <div className="coworker-card-body">
                        {coworker.presetTasks.map((task) => (
                          <button
                            key={task.id}
                            type="button"
                            className="coworker-task"
                            onClick={() => queueCoworkerTask(toCoworkerSelection(coworker), task.prompt)}
                            title="导入任务到对话框"
                          >
                            <span className="coworker-task-copy">
                              <span className="coworker-task-title">{task.title}</span>
                              <span className="coworker-task-prompt">{task.prompt}</span>
                            </span>
                            <span className="coworker-task-go"><CornerDownRight size={13} /></span>
                          </button>
                        ))}
                      </div>
                    )}
                  </article>
                );
              })}
            </section>
          ))}
        </div>
      ) : (
        <div className="coworkers-list" key="workflows">
          <p className="coworkers-panel-hint">按投研场景一键召集多位同事,自动带入协作提示词。</p>
          {COWORKER_WORKFLOW_PRESETS.map((workflow) => {
            const workflowCoworkers = coworkerSelectionsByIds(workflow.coworkerIds);
            const roster = workflow.coworkerIds
              .map((id) => coworkerById(id))
              .filter((coworker): coworker is CoworkerProfile => Boolean(coworker));
            return (
              <article key={workflow.id} className="coworker-workflow">
                <div className="coworker-workflow-top">
                  <span className="coworker-workflow-title">{workflow.title}</span>
                  <button
                    type="button"
                    className="coworker-workflow-import"
                    onClick={() => queueCoworkerTask(workflowCoworkers, workflow.prompt)}
                    title="导入协作模板到对话框"
                  >
                    <Zap size={12} />
                    召集
                  </button>
                </div>
                <span className="coworker-workflow-desc">{workflow.description}</span>
                <span className="coworker-workflow-roster" aria-label={`${workflow.title} 参与同事`}>
                  {roster.map((coworker) => (
                    <span key={coworker.id} className="coworker-workflow-chip" data-group={coworker.group} title={`${coworker.no} ${coworker.name}`}>
                      {COWORKER_ICONS[coworker.id] ?? coworker.no}
                    </span>
                  ))}
                  <span className="coworker-workflow-roster-count">{roster.length} 位同事</span>
                </span>
              </article>
            );
          })}
        </div>
      )}
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

type LocalHtmlPreview = {
  path: string;
  status: 'loading' | 'ready' | 'error';
  srcDoc?: string;
  error?: string;
};

let browserWebviewSequence = 0;
const YUANLIU_OFFICIAL_URL = 'https://yuanliu.ai';

type BrowserDownloadStatus = {
  message: string;
  path?: string;
  success?: boolean;
};

function BrowserDockPanel({
  requestedUrl,
  requestKey,
  active,
  onTabTitleChange,
}: {
  requestedUrl?: string;
  requestKey?: number;
  active: boolean;
  onTabTitleChange?: (title: string) => void;
}) {
  const [nativeBrowserId] = useState(() => `dock-${++browserWebviewSequence}`);
  const openBrowserTab = useBrowserDockOpener();
  const [draft, setDraft] = useState('');
  const [url, setUrl] = useState('');
  const [activeDisplay, setActiveDisplay] = useState('');
  const [htmlPreview, setHtmlPreview] = useState<LocalHtmlPreview | null>(null);
  const [frameKey, setFrameKey] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [frameError, setFrameError] = useState('');
  const [pageTitle, setPageTitle] = useState('');
  const [downloadStatus, setDownloadStatus] = useState<BrowserDownloadStatus | null>(null);
  const [, setHistoryVersion] = useState(0);
  const addressRef = useRef<HTMLInputElement>(null);
  const browserFrameRef = useRef<HTMLIFrameElement>(null);
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const pendingHistoryIndexRef = useRef<number | null>(null);
  const htmlPreviewRequestRef = useRef(0);
  const onTabTitleChangeRef = useRef(onTabTitleChange);

  useEffect(() => {
    onTabTitleChangeRef.current = onTabTitleChange;
  }, [onTabTitleChange]);

  const loadUrl = useCallback((value: string) => {
    const displayUrl = browserDockDisplayUrl(value);
    const frameUrl = normalizeBrowserDockUrl(displayUrl);
    if (!frameUrl) return;
    const localHtmlPath = localFilePath(displayUrl);
    const shouldRenderLocalHtml = Boolean(localHtmlPath && isHtmlExt(extOf(localHtmlPath)) && isTauriRuntime());
    setUrl(frameUrl);
    setDraft(displayUrl);
    setActiveDisplay(displayUrl);
    setFrameError('');
    setPageTitle('');
    setIsLoading(true);
    setFrameKey((key) => key + 1);
    if (!localHtmlPath || !shouldRenderLocalHtml) {
      htmlPreviewRequestRef.current += 1;
      setHtmlPreview(null);
      if (localHtmlPath && extOf(localHtmlPath) === 'pdf') setIsLoading(false);
      return;
    }
    const requestId = htmlPreviewRequestRef.current + 1;
    htmlPreviewRequestRef.current = requestId;
    setHtmlPreview({ path: localHtmlPath, status: 'loading' });
    void buildLocalHtmlPreviewDocument(localHtmlPath)
      .then((srcDoc) => {
        if (htmlPreviewRequestRef.current === requestId) {
          setHtmlPreview({ path: localHtmlPath, status: 'ready', srcDoc });
          setIsLoading(false);
        }
      })
      .catch((error) => {
        if (htmlPreviewRequestRef.current === requestId) {
          setHtmlPreview({ path: localHtmlPath, status: 'error', error: stringifyError(error) });
          setIsLoading(false);
        }
      });
  }, []);

  const openUrl = useCallback((value: string) => {
    const displayUrl = browserDockDisplayUrl(value);
    const normalizedUrl = normalizeBrowserDockUrl(displayUrl);
    if (!normalizedUrl) return;
    let historyUrl = displayUrl;
    if (/^https?:\/\//i.test(normalizedUrl)) {
      try {
        historyUrl = new URL(normalizedUrl).href;
      } catch {
        historyUrl = normalizedUrl;
      }
    }
    const current = historyRef.current[historyIndexRef.current];
    if (current !== historyUrl) {
      const nextHistory = historyRef.current.slice(0, historyIndexRef.current + 1);
      nextHistory.push(historyUrl);
      historyRef.current = nextHistory.slice(-100);
      historyIndexRef.current = historyRef.current.length - 1;
      setHistoryVersion((version) => version + 1);
    }
    loadUrl(displayUrl);
  }, [loadUrl]);

  const moveHistory = useCallback((offset: number) => {
    const nextIndex = historyIndexRef.current + offset;
    const nextUrl = historyRef.current[nextIndex];
    if (!nextUrl || nextIndex < 0 || nextIndex >= historyRef.current.length) return;
    historyIndexRef.current = nextIndex;
    setHistoryVersion((version) => version + 1);
    if (isTauriRuntime() && /^https?:\/\//i.test(url)) {
      pendingHistoryIndexRef.current = nextIndex;
      setIsLoading(true);
      void browserWebviewAction(nativeBrowserId, offset < 0 ? 'back' : 'forward').catch(() => {
        pendingHistoryIndexRef.current = null;
        loadUrl(nextUrl);
      });
    } else {
      loadUrl(nextUrl);
    }
  }, [loadUrl, nativeBrowserId, url]);

  const externalTarget = useMemo(() => {
    const candidate = htmlPreview?.path || activeDisplay || url;
    if (!candidate) return null;
    const displayUrl = browserDockDisplayUrl(candidate);
    const localPath = localFilePath(displayUrl);
    return localPath || normalizeBrowserDockUrl(displayUrl);
  }, [activeDisplay, htmlPreview?.path, url]);

  const localPdfPath = useMemo(() => {
    const path = localFilePath(activeDisplay);
    return path && extOf(path) === 'pdf' && isTauriRuntime() ? path : null;
  }, [activeDisplay]);

  const nativeHttpUrl = Boolean(
    isTauriRuntime()
    && /^https?:\/\//i.test(url)
    && !htmlPreview
    && !localPdfPath,
  );

  const refreshFrame = useCallback(() => {
    if (nativeHttpUrl) {
      setFrameError('');
      setIsLoading(true);
      void browserWebviewAction(nativeBrowserId, 'reload').catch(() => {
        if (activeDisplay) loadUrl(activeDisplay);
      });
      return;
    }
    if (activeDisplay) {
      loadUrl(activeDisplay);
      return;
    }
    setFrameKey((key) => key + 1);
  }, [activeDisplay, loadUrl, nativeBrowserId, nativeHttpUrl]);

  const handleNativeBrowserEvent = useCallback((event: BrowserWebviewEvent) => {
    if (event.type === 'title-changed') {
      setPageTitle(event.title?.trim() || '');
      return;
    }
    if (event.type === 'new-window') {
      if (/^https?:\/\//i.test(event.url || '')) openBrowserTab?.(event.url as string);
      else if (event.url && event.url !== 'about:blank') void openExternal(event.url);
      return;
    }
    if (event.type === 'download-started') {
      setDownloadStatus({
        message: event.path ? `正在下载 ${basename(event.path)}` : '正在下载文件',
        path: event.path,
      });
      return;
    }
    if (event.type === 'download-finished') {
      setDownloadStatus({
        message: event.success === false
          ? '下载失败'
          : event.path ? `${basename(event.path)} 下载完成` : '下载完成',
        path: event.path,
        success: event.success,
      });
      return;
    }
    if (!event.url) return;

    const displayUrl = browserDockDisplayUrl(event.url);
    setUrl(event.url);
    setDraft(displayUrl);
    setActiveDisplay(displayUrl);
    setFrameError('');
    if (event.type === 'load-started') {
      setIsLoading(true);
      const pendingIndex = pendingHistoryIndexRef.current;
      if (pendingIndex !== null) {
        pendingHistoryIndexRef.current = null;
        historyRef.current[pendingIndex] = displayUrl;
      } else if (historyRef.current[historyIndexRef.current] !== displayUrl) {
        const nextHistory = historyRef.current.slice(0, historyIndexRef.current + 1);
        nextHistory.push(displayUrl);
        historyRef.current = nextHistory.slice(-100);
        historyIndexRef.current = historyRef.current.length - 1;
      }
      setHistoryVersion((version) => version + 1);
    } else if (event.type === 'load-finished') {
      setIsLoading(false);
    }
  }, [openBrowserTab]);

  const handleNativeBrowserError = useCallback((error: unknown) => {
    if (!active) return;
    setIsLoading(false);
    setFrameError(stringifyError(error));
  }, [active]);

  const canGoBack = historyIndexRef.current > 0;
  const canGoForward = historyIndexRef.current >= 0 && historyIndexRef.current < historyRef.current.length - 1;

  useEffect(() => {
    if (!requestedUrl) return;
    openUrl(requestedUrl);
  }, [openUrl, requestedUrl, requestKey]);

  useEffect(() => {
    onTabTitleChangeRef.current?.(browserDockTabTitle(pageTitle, activeDisplay || requestedUrl));
  }, [activeDisplay, pageTitle, requestedUrl]);

  useEffect(() => {
    if (!downloadStatus || downloadStatus.success === undefined) return;
    const timer = window.setTimeout(() => setDownloadStatus(null), 6000);
    return () => window.clearTimeout(timer);
  }, [downloadStatus]);

  return (
    <section
      className="browser-dock-panel"
      aria-label="浏览器"
      title={pageTitle || undefined}
      onKeyDown={(event) => {
        const key = event.key.toLowerCase();
        if (event.metaKey && key === 'l') {
          event.preventDefault();
          addressRef.current?.focus();
          addressRef.current?.select();
        } else if (event.metaKey && key === 'r') {
          event.preventDefault();
          refreshFrame();
        } else if ((event.altKey && event.key === 'ArrowLeft') || (event.metaKey && event.key === '[')) {
          event.preventDefault();
          moveHistory(-1);
        } else if ((event.altKey && event.key === 'ArrowRight') || (event.metaKey && event.key === ']')) {
          event.preventDefault();
          moveHistory(1);
        } else if (event.metaKey && key === 'p' && nativeHttpUrl) {
          event.preventDefault();
          void browserWebviewAction(nativeBrowserId, 'print');
        }
      }}
    >
      <form className="browser-url-row" onSubmit={(event) => { event.preventDefault(); openUrl(draft); }}>
        <button type="button" className="icon-mini" disabled={!canGoBack} onClick={() => moveHistory(-1)} aria-label="后退" title="后退"><ChevronLeft size={14} /></button>
        <button type="button" className="icon-mini" disabled={!canGoForward} onClick={() => moveHistory(1)} aria-label="前进" title="前进"><ChevronRight size={14} /></button>
        <div className="browser-address-field">
          <Globe className="browser-address-icon" size={13} aria-hidden="true" />
          <input
            ref={addressRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onClick={(event) => event.currentTarget.select()}
            placeholder="搜索或输入网址"
            spellCheck={false}
            autoCapitalize="none"
          />
          <button
            type="button"
            className="browser-external-open"
            disabled={!externalTarget}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (externalTarget) void openExternal(externalTarget);
            }}
            aria-label="在外部浏览器打开"
            title="在外部浏览器打开"
          >
            <ExternalLink size={14} />
          </button>
        </div>
        <button type="button" className="icon-mini" disabled={!url} onClick={() => {
          if (isLoading && !localPdfPath && !htmlPreview) {
            if (nativeHttpUrl) void browserWebviewAction(nativeBrowserId, 'stop');
            else browserFrameRef.current?.contentWindow?.stop();
            setIsLoading(false);
          } else {
            refreshFrame();
          }
        }} aria-label={isLoading ? '停止加载' : '刷新浏览器'} title={isLoading ? '停止' : '刷新'}>
          {isLoading ? <X size={14} /> : <RefreshCw size={14} />}
        </button>
        <button type="submit" className="icon-mini" aria-label="打开 URL" title="打开"><ArrowUp size={14} /></button>
      </form>
      {isLoading && !localPdfPath ? <div className="browser-load-progress" aria-hidden="true" /> : null}
      {downloadStatus ? (
        <div className={`browser-download-status ${downloadStatus.success === false ? 'error' : ''}`} role="status">
          <Download size={13} />
          <button
            type="button"
            disabled={!downloadStatus.path}
            title={downloadStatus.path}
            onClick={() => { if (downloadStatus.path) void revealPath(downloadStatus.path); }}
          >
            {downloadStatus.message}
          </button>
          <span className="spacer" />
          <button type="button" className="icon-mini" onClick={() => setDownloadStatus(null)} aria-label="关闭下载提示">
            <X size={12} />
          </button>
        </div>
      ) : null}
      {htmlPreview?.status === 'loading' ? (
        <div className="browser-frame-status" role="status">
          <Loader2 size={18} className="spin" />
          <strong>正在渲染本地 HTML</strong>
          <span>{shortenPath(htmlPreview.path)}</span>
        </div>
      ) : htmlPreview?.status === 'error' ? (
        <div className="browser-frame-status error" role="alert">
          <AlertCircle size={18} />
          <strong>HTML 预览失败</strong>
          <span>{htmlPreview.error}</span>
          <button type="button" className="generated-file-open" onClick={() => void openExternal(htmlPreview.path)}>
            <span>系统打开</span>
            <Globe size={13} />
          </button>
        </div>
      ) : htmlPreview?.status === 'ready' ? (
        <iframe
          key={`${htmlPreview.path}-${frameKey}`}
          className="browser-frame"
          srcDoc={htmlPreview.srcDoc}
          title={activeDisplay || htmlPreview.path}
          sandbox=""
          referrerPolicy="no-referrer"
          onLoad={(event) => {
            setIsLoading(false);
            const title = event.currentTarget.contentDocument?.title.trim();
            if (title) setPageTitle(title);
          }}
        />
      ) : localPdfPath ? (
        <Suspense fallback={<LazyPanelFallback label="正在加载 PDF 阅读器" />}>
          <BrowserPdfViewer path={localPdfPath} revision={frameKey} onOpenExternal={() => void openExternal(localPdfPath)} />
        </Suspense>
      ) : frameError ? (
        <div className="browser-frame-status error" role="alert">
          <AlertCircle size={18} />
          <strong>网页无法打开</strong>
          <span>{frameError}</span>
          <button type="button" className="generated-file-open" onClick={refreshFrame}><span>重试</span><RefreshCw size={13} /></button>
        </div>
      ) : nativeHttpUrl ? (
        <Suspense fallback={<LazyPanelFallback label="正在加载浏览器" />}>
          <NativeBrowserSurface
            id={nativeBrowserId}
            url={url}
            visible={active}
            onEvent={handleNativeBrowserEvent}
            onError={handleNativeBrowserError}
          />
        </Suspense>
      ) : url ? (
        <iframe
          ref={browserFrameRef}
          key={`${url}-${frameKey}`}
          className="browser-frame"
          src={url}
          title={activeDisplay || url}
          onLoad={(event) => {
            setIsLoading(false);
            try {
              const title = event.currentTarget.contentDocument?.title.trim();
              if (title) setPageTitle(title);
            } catch {
              // Cross-origin frames expose their title through the native browser event instead.
            }
          }}
          onError={() => { setIsLoading(false); setFrameError('目标网页拒绝连接或当前网络不可用。'); }}
          allow="clipboard-read; clipboard-write; fullscreen; geolocation"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      ) : (
        <div className="browser-start">
          <div className="dock-section-label">官网</div>
          <button
            type="button"
            className="browser-local-card"
            onClick={() => openUrl(YUANLIU_OFFICIAL_URL)}
            aria-label="打开元流涌现官网"
          >
            <span className="browser-local-thumb">YL</span>
            <span>
              <strong>元流涌现</strong>
              <em>yuanliu.ai</em>
            </span>
            <span className="browser-local-dot" />
          </button>
        </div>
      )}
    </section>
  );
}

async function buildLocalHtmlPreviewDocument(path: string): Promise<string> {
  const html = await localTextFileRead(path);
  if (!html.content.trim()) throw new Error('HTML 文件为空。');
  if (html.truncated) throw new Error('HTML 文件过大，无法在侧边浏览器完整预览。');

  const parser = new DOMParser();
  const doc = parser.parseFromString(html.content, 'text/html');
  doc.querySelectorAll('script, iframe, object, embed, form, base, meta[http-equiv="refresh" i]')
    .forEach((element) => element.remove());
  doc.querySelectorAll<HTMLElement>('*').forEach((element) => {
    Array.from(element.attributes).forEach((attribute) => {
      if (attribute.name.toLowerCase().startsWith('on')) element.removeAttribute(attribute.name);
    });
  });

  const stylesheets = Array.from(doc.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"][href]'));
  await Promise.all(stylesheets.map(async (link) => {
    const stylesheetPath = localAssetPath(path, link.getAttribute('href') || '');
    if (!stylesheetPath || extOf(stylesheetPath) !== 'css') return;
    const css = await localTextFileRead(stylesheetPath);
    if (!css.content.trim() || css.truncated) return;
    const style = doc.createElement('style');
    const media = link.getAttribute('media');
    if (media) style.setAttribute('media', media);
    style.textContent = css.content;
    link.replaceWith(style);
  }));

  const images = Array.from(doc.querySelectorAll<HTMLImageElement>('img[src]'));
  await Promise.all(images.map(async (image) => {
    const imagePath = localAssetPath(path, image.getAttribute('src') || '');
    if (!imagePath) return;
    const dataUrl = await localImageDataUrl(imagePath);
    if (dataUrl) image.setAttribute('src', dataUrl);
  }));

  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}

function localAssetPath(baseFilePath: string, rawReference: string): string | null {
  const reference = rawReference.trim();
  if (!reference || reference.startsWith('#')) return null;
  if (/^(?:data|blob|https?|mailto|tel):/i.test(reference)) return null;
  const localPath = localFilePath(reference);
  if (localPath) return localPath;
  try {
    const resolved = new URL(reference, pathToFileUrl(ensureTrailingSlash(directoryName(baseFilePath))));
    if (resolved.protocol !== 'file:') return null;
    return decodeURIComponent(resolved.pathname);
  } catch {
    return null;
  }
}

function directoryName(path: string): string {
  const normalized = path.replace(/\/+$/g, '');
  const index = normalized.lastIndexOf('/');
  return index > 0 ? normalized.slice(0, index) : '/';
}

function ensureTrailingSlash(path: string): string {
  return path.endsWith('/') ? path : `${path}/`;
}

function FilesDockPanel({ filePath }: { filePath?: string }) {
  const cwd = useCurrentConversationCwd();
  if (filePath) return <FilePreviewDockPanel path={filePath} />;
  return <WorkspaceFilesDockPanel cwd={cwd} />;
}

interface DirectoryLoadState {
  entries: LocalDirectoryEntry[];
  loading: boolean;
  error: string;
}

function WorkspaceFilesDockPanel({ cwd }: { cwd: string }) {
  const openFileInDock = useFileDockOpener();
  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [directories, setDirectories] = useState<Record<string, DirectoryLoadState>>({});
  const [selectedPath, setSelectedPath] = useState('');
  const cwdRef = useRef(cwd);
  cwdRef.current = cwd;

  const loadDirectory = useCallback(async (path: string) => {
    if (!path) return;
    setDirectories((current) => ({
      ...current,
      [path]: {
        entries: current[path]?.entries ?? [],
        loading: true,
        error: '',
      },
    }));
    try {
      const entries = await localDirectoryList(path);
      if (cwdRef.current !== cwd) return;
      setDirectories((current) => ({
        ...current,
        [path]: { entries, loading: false, error: '' },
      }));
    } catch (error) {
      if (cwdRef.current !== cwd) return;
      setDirectories((current) => ({
        ...current,
        [path]: {
          entries: current[path]?.entries ?? [],
          loading: false,
          error: stringifyError(error),
        },
      }));
    }
  }, [cwd]);

  useEffect(() => {
    setFilter('');
    setSelectedPath('');
    setDirectories({});
    if (!cwd) {
      setExpanded(new Set());
      return;
    }
    setExpanded(new Set([cwd]));
    void loadDirectory(cwd);
  }, [cwd, loadDirectory]);

  const toggleDirectory = (path: string) => {
    if (expanded.has(path) && directories[path]?.error) {
      void loadDirectory(path);
      return;
    }
    const willExpand = !expanded.has(path);
    setExpanded((current) => {
      const next = new Set(current);
      if (willExpand) next.add(path);
      else next.delete(path);
      return next;
    });
    if (willExpand && !directories[path]?.entries.length && !directories[path]?.loading) {
      void loadDirectory(path);
    }
  };

  const refresh = () => {
    if (!cwd) return;
    setDirectories({});
    setExpanded(new Set([cwd]));
    setSelectedPath('');
    void loadDirectory(cwd);
  };

  const normalizedFilter = filter.trim().toLowerCase();
  const rootState = directories[cwd];

  return (
    <section className="files-dock-panel workspace-files-panel" aria-label="研究主题文件">
      <div
        className="workspace-files-head"
        draggable={Boolean(cwd)}
        title={cwd ? '拖到对话框可引入整个研究主题目录' : undefined}
        onDragStart={(event) => {
          if (!cwd) return;
          event.dataTransfer.effectAllowed = 'copy';
          event.dataTransfer.setData(LOCAL_PATH_DRAG_MIME, JSON.stringify({
            path: cwd,
            name: basename(cwd),
            isDirectory: true,
          }));
          event.dataTransfer.setData('text/plain', cwd);
        }}
      >
        <span className="workspace-files-root-icon"><FolderOpen size={17} /></span>
        <span className="workspace-files-root">
          <strong>{cwd ? basename(cwd) : '打开文件'}</strong>
          <span title={cwd}>{cwd ? shortenPath(cwd) : '未指定研究主题目录'}</span>
        </span>
        {cwd && (
          <>
            <button type="button" className="icon-mini" onClick={refresh} aria-label="刷新目录" title="刷新目录">
              <RefreshCw size={13} />
            </button>
            <button type="button" className="icon-mini" onClick={() => void revealPath(cwd)} aria-label="在 Finder 中显示目录" title="在 Finder 中显示">
              <ExternalLink size={13} />
            </button>
          </>
        )}
      </div>
      <label className="files-filter">
        <Search size={13} />
        <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="筛选文件…" spellCheck={false} disabled={!cwd} />
      </label>
      {cwd && (
        <div className="workspace-files-drag-hint">
          <Upload size={13} />
          <span>将文件或文件夹拖到对话框即可引入路径</span>
        </div>
      )}
      <div className="files-dock-body">
        {!cwd ? (
          <div className="dock-empty">
            <Folder size={24} />
            <strong>打开文件</strong>
            <span>先在对话框下方为当前研究主题选择资料目录。</span>
          </div>
        ) : rootState?.loading && !rootState.entries.length ? (
          <div className="dock-empty compact">
            <Loader2 size={22} className="spin" />
            <strong>正在读取目录</strong>
            <span>{shortenPath(cwd)}</span>
          </div>
        ) : rootState?.error && !rootState.entries.length ? (
          <div className="dock-empty compact">
            <AlertCircle size={22} />
            <strong>目录读取失败</strong>
            <span>{rootState.error}</span>
            <button type="button" className="generated-file-open" onClick={refresh}>重试</button>
          </div>
        ) : rootState?.entries.length ? (
          <div className="workspace-file-tree" role="tree" aria-label={`${basename(cwd)} 文件目录`}>
            <WorkspaceFileTreeBranch
              directory={cwd}
              depth={0}
              directories={directories}
              expanded={expanded}
              filter={normalizedFilter}
              selectedPath={selectedPath}
              onSelect={setSelectedPath}
              onToggle={toggleDirectory}
              onOpenFile={(path) => openFileInDock?.(path)}
            />
          </div>
        ) : (
          <div className="dock-empty compact">
            <FolderOpen size={24} />
            <strong>目录为空</strong>
            <span>这个研究主题目录里暂时没有文件。</span>
          </div>
        )}
      </div>
    </section>
  );
}

function WorkspaceFileTreeBranch({
  directory,
  depth,
  directories,
  expanded,
  filter,
  selectedPath,
  onSelect,
  onToggle,
  onOpenFile,
}: {
  directory: string;
  depth: number;
  directories: Record<string, DirectoryLoadState>;
  expanded: Set<string>;
  filter: string;
  selectedPath: string;
  onSelect: (path: string) => void;
  onToggle: (path: string) => void;
  onOpenFile: (path: string) => void;
}) {
  const state = directories[directory];
  const entries = (state?.entries ?? []).filter((entry) => (
    !filter || entry.isDirectory || entry.name.toLowerCase().includes(filter)
  ));

  return (
    <>
      {entries.map((entry) => {
        const isOpen = entry.isDirectory && expanded.has(entry.path);
        const childState = directories[entry.path];
        return (
          <Fragment key={entry.path}>
            <div
              className={`workspace-file-row ${entry.isDirectory ? 'directory' : 'file'} ${selectedPath === entry.path ? 'selected' : ''}`}
              role="treeitem"
              aria-expanded={entry.isDirectory ? isOpen : undefined}
              aria-selected={selectedPath === entry.path}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'copy';
                event.dataTransfer.setData(LOCAL_PATH_DRAG_MIME, JSON.stringify({
                  path: entry.path,
                  name: entry.name,
                  isDirectory: entry.isDirectory,
                }));
                event.dataTransfer.setData('text/plain', entry.path);
              }}
              onDoubleClick={() => {
                if (!entry.isDirectory) onOpenFile(entry.path);
              }}
            >
              <button
                type="button"
                className="workspace-file-row-main"
                style={{ paddingLeft: `${8 + depth * 18}px` }}
                title={entry.path}
                onClick={() => {
                  onSelect(entry.path);
                  if (entry.isDirectory) onToggle(entry.path);
                }}
              >
                <span className="workspace-file-chevron">
                  {entry.isDirectory ? (isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : null}
                </span>
                <span className="workspace-file-icon">
                  {entry.isDirectory ? <Folder size={15} /> : fileGlyph(extOf(entry.name), 15)}
                </span>
                <span className="workspace-file-name">{entry.name}</span>
                {!entry.isDirectory && entry.bytes > 0 && <span className="workspace-file-size">{formatCompactBytes(entry.bytes)}</span>}
              </button>
              {!entry.isDirectory && (
                <button
                  type="button"
                  className="workspace-file-open"
                  onClick={() => onOpenFile(entry.path)}
                  aria-label={`预览 ${entry.name}`}
                  title="预览文件"
                >
                  <Eye size={13} />
                </button>
              )}
            </div>
            {entry.isDirectory && isOpen && (
              <div role="group">
                {childState?.loading && !childState.entries.length ? (
                  <div className="workspace-file-tree-state" style={{ paddingLeft: `${30 + depth * 18}px` }}>
                    <Loader2 size={12} className="spin" />正在读取…
                  </div>
                ) : childState?.error && !childState.entries.length ? (
                  <button type="button" className="workspace-file-tree-state error" style={{ paddingLeft: `${30 + depth * 18}px` }} onClick={() => onToggle(entry.path)}>
                    <AlertCircle size={12} />读取失败，点击重试
                  </button>
                ) : childState?.entries.length ? (
                  <WorkspaceFileTreeBranch
                    directory={entry.path}
                    depth={depth + 1}
                    directories={directories}
                    expanded={expanded}
                    filter={filter}
                    selectedPath={selectedPath}
                    onSelect={onSelect}
                    onToggle={onToggle}
                    onOpenFile={onOpenFile}
                  />
                ) : (
                  <div className="workspace-file-tree-state" style={{ paddingLeft: `${30 + depth * 18}px` }}>空文件夹</div>
                )}
              </div>
            )}
          </Fragment>
        );
      })}
      {filter && entries.every((entry) => entry.isDirectory) && (
        <div className="workspace-file-tree-state filter-note" style={{ paddingLeft: `${12 + depth * 18}px` }}>当前层没有匹配文件</div>
      )}
    </>
  );
}

function formatCompactBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function FilePreviewDockPanel({ path }: { path: string }) {
  const normalizedPath = localFilePath(path) || path;
  const ext = extOf(normalizedPath);
  const name = basename(normalizedPath);
  const image = isImageExt(ext);
  const browserDocument = isBrowserPreviewExt(ext);
  const markdown = ['md', 'markdown'].includes(ext);
  const textPreview = markdown || (!browserDocument && isTextPreviewExt(ext));
  const openBrowserUrl = useBrowserDockOpener();
  const [content, setContent] = useState('');
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(textPreview);
  const [error, setError] = useState('');
  const [imageSrc, setImageSrc] = useState(renderableImageSrc(normalizedPath));

  useEffect(() => {
    setImageSrc(renderableImageSrc(normalizedPath));
  }, [normalizedPath]);

  useEffect(() => {
    let cancelled = false;
    setContent('');
    setTruncated(false);
    setError('');
    if (!textPreview) {
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }
    setLoading(true);
    void localTextFileRead(normalizedPath)
      .then((result) => {
        if (cancelled) return;
        setContent(result.content);
        setTruncated(result.truncated);
      })
      .catch((err) => {
        if (!cancelled) setError(stringifyError(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [normalizedPath, textPreview]);

  const handleImageError = () => {
    void localImageDataUrl(normalizedPath).then((dataUrl) => {
      if (dataUrl) setImageSrc(dataUrl);
      else setError('图片预览不可用');
    });
  };

  return (
    <section className="files-dock-panel file-preview-panel" aria-label={`文件预览 ${name}`}>
      <div className="file-preview-head">
        <span className={`generated-file-icon tone-${fileTone(ext)}`}>
          {image ? <ImageIcon size={18} /> : fileGlyph(ext, 18)}
        </span>
        <span className="file-preview-title">
          <strong>{name}</strong>
          <span title={normalizedPath}>{shortenPath(normalizedPath)}</span>
        </span>
        <span className="spacer" />
        <button type="button" className="icon-mini" onClick={() => void copyToClipboard(normalizedPath)} aria-label="复制文件路径" title="复制路径">
          <Copy size={13} />
        </button>
        <button type="button" className="icon-mini" onClick={() => void revealPath(normalizedPath)} aria-label="在 Finder 中显示" title="在 Finder 中显示">
          <FolderOpen size={13} />
        </button>
      </div>
      <div className="file-preview-body">
        {image ? (
          <div className="file-preview-image">
            <img src={imageSrc} alt={name} onError={handleImageError} />
            {error && <span>{error}</span>}
          </div>
        ) : browserDocument ? (
          <div className="dock-empty">
            <Globe size={24} />
            <strong>{isHtmlExt(ext) ? 'HTML 需要浏览器渲染' : 'PDF 需要浏览器渲染'}</strong>
            <span>这个文件会通过浏览器路径打开，确保同目录 CSS、图片和脚本正常加载。</span>
            <div className="dock-empty-actions">
              <button type="button" className="generated-file-open" onClick={() => openBrowserUrl?.(normalizedPath)}>
                <span>浏览器预览</span>
                <PanelRight size={13} />
              </button>
              <button type="button" className="generated-file-open" onClick={() => void openExternal(normalizedPath)}>
                <span>系统打开</span>
                <Globe size={13} />
              </button>
            </div>
          </div>
        ) : !textPreview ? (
          <div className="dock-empty">
            {fileGlyph(ext, 24)}
            <strong>暂不支持侧栏预览</strong>
            <span>可以在 Finder 中打开这个文件。</span>
          </div>
        ) : loading ? (
          <div className="dock-empty">
            <Loader2 size={24} className="spin" />
            <strong>正在读取文件</strong>
            <span>{shortenPath(normalizedPath)}</span>
          </div>
        ) : error ? (
          <div className="dock-empty">
            <AlertCircle size={24} />
            <strong>文件读取失败</strong>
            <span>{error}</span>
          </div>
        ) : markdown ? (
          <div className="file-preview-markdown">
            <MarkdownText content={content} />
            {truncated && <div className="file-preview-notice">文件较大，已只显示前 2MB。</div>}
          </div>
        ) : (
          <>
            <pre className="file-preview-pre">{content}</pre>
            {truncated && <div className="file-preview-notice">文件较大，已只显示前 2MB。</div>}
          </>
        )}
      </div>
    </section>
  );
}

function SideChatPanel({
  domain,
  tabId,
  sourceConversationId,
  selectedTextContexts,
  onRemoveSelectedTextContext,
  onConsumeSelectedTextContexts,
}: {
  domain: DomainConfig;
  tabId: string;
  sourceConversationId?: string;
  selectedTextContexts: SelectedTextContext[];
  onRemoveSelectedTextContext: (id: string) => void;
  onConsumeSelectedTextContexts: () => void;
}) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const conversation = useChatStore((state) => (
    conversationId ? state.conversations.find((item) => item.id === conversationId) ?? null : null
  ));
  const createEphemeralConversation = useChatStore((state) => state.createEphemeralConversation);
  const discardEphemeralConversation = useChatStore((state) => state.discardEphemeralConversation);
  const sendMessageToConversation = useChatStore((state) => state.sendMessageToConversation);
  const stopConversation = useChatStore((state) => state.stopConversation);
  const { codexReady } = useComposerRuntimeState();
  const sendSideChatMessage = useCallback<NonNullable<ComposerProps['onSendMessage']>>((
    message,
    attachments,
    selectedSkill,
    coworkers,
    contexts,
  ) => {
    if (!conversationId) return;
    return sendMessageToConversation(
      conversationId,
      message,
      attachments,
      selectedSkill,
      coworkers,
      false,
      contexts,
    );
  }, [conversationId, sendMessageToConversation]);
  const stopSideChat = useCallback(() => {
    if (!conversationId) return;
    return stopConversation(conversationId);
  }, [conversationId, stopConversation]);

  useEffect(() => {
    const id = createEphemeralConversation(sourceConversationId);
    setConversationId(id);
    return () => discardEphemeralConversation(id);
  }, [createEphemeralConversation, discardEphemeralConversation, sourceConversationId, tabId]);

  return (
    <section className="side-chat-panel" aria-label="侧边聊天">
      {conversation ? (
        <>
          <div className={`side-chat-body ${conversation.messages.length === 0 ? 'empty' : ''}`}>
            {conversation.messages.length > 0 ? (
              <MessageList key={conversation.id} conversation={conversation} />
            ) : (
              <div className="side-chat-empty">
                <MessageCircleQuestionMark size={24} />
                <strong>临时侧边聊天</strong>
                <span>这段对话只保留在当前标签中，关闭标签后即会消失。</span>
              </div>
            )}
          </div>
          <div className="side-chat-composer">
            <Composer
              domain={domain}
              conversation={conversation}
              disabled={!codexReady}
              selectedTextContexts={selectedTextContexts}
              onRemoveSelectedTextContext={onRemoveSelectedTextContext}
              onConsumeSelectedTextContexts={onConsumeSelectedTextContexts}
              onSendMessage={sendSideChatMessage}
              onStop={stopSideChat}
            />
          </div>
        </>
      ) : (
        <div className="dock-empty">
          <Loader2 size={24} className="spin" />
          <strong>正在开启临时会话</strong>
        </div>
      )}
    </section>
  );
}

function AutomationsPage({
  sidebarCollapsed,
  onToggleSidebar,
  onOpenChat,
}: {
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  onOpenChat: () => void;
}) {
  const [tab, setTab] = useState<AutomationTab>('tasks');
  const [query, setQuery] = useState('');
  const [taskFilter, setTaskFilter] = useState<AutomationTaskFilter>('all');
  const [editorOpen, setEditorOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<ScheduledAutomationTask[]>(() => loadScheduledAutomationTasks());
  const [form, setForm] = useState<AutomationFormState>(() => blankAutomationForm());
  const allProjects = useChatStore((state) => state.projects);
  const createConversation = useChatStore((state) => state.createConversation);
  const setCurrentConversation = useChatStore((state) => state.setCurrentConversation);
  const unarchiveConversation = useChatStore((state) => state.unarchiveConversation);
  const sendMessage = useChatStore((state) => state.sendMessage);
  const modelProfiles = useChatStore((state) => state.modelProfiles);
  const selectedModelProfileId = useChatStore((state) => state.selectedModelProfileId);
  const currentReasoningEffort = useChatStore((state) => state.reasoningEffort);
  const codexStatus = useChatStore((state) => state.codexStatus);
  const clientLicenseSession = useChatStore((state) => state.clientLicenseSession);
  const projects = useMemo(() => activeProjects(allProjects), [allProjects]);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const projectOptions = useMemo(() => {
    const names = projects.map((project) => project.name).filter(Boolean);
    return ['选择项目', ...Array.from(new Set(names))];
  }, [projects]);
  const visibleAutomationProfiles = useMemo(() => visibleModelProfilesForCodexStatus(modelProfiles.filter((profile) => profile.enabled), codexStatus, clientLicenseSession), [clientLicenseSession, codexStatus, modelProfiles]);
  const automationSelection = useMemo(() => resolveAutomationSelection(form, visibleAutomationProfiles, selectedModelProfileId, currentReasoningEffort), [currentReasoningEffort, form, selectedModelProfileId, visibleAutomationProfiles]);
  const modelOptions = useMemo(() => automationModelOptionGroups(modelProfiles, codexStatus, clientLicenseSession), [clientLicenseSession, codexStatus, modelProfiles]);
  const effortOptions = useMemo(() => reasoningEffortOptionsForProfile(automationSelection.profile), [automationSelection.profile]);
  useEffect(() => {
    let cancelled = false;
    void loadLocalStoreSnapshot()
      .then((snapshot) => {
        if (cancelled || !snapshot?.automationTasks?.length) return;
        setTasks(snapshot.automationTasks as ScheduledAutomationTask[]);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (!editorOpen || automationSelectGroupsContain(modelOptions, automationSelection.profile.id)) return;
    const fallbackModel = firstAutomationSelectValue(modelOptions);
    if (!fallbackModel) return;
    setForm((current) => (
      automationSelectGroupsContain(modelOptions, current.modelProfileId ?? '')
        ? current
        : { ...current, model: visibleAutomationProfiles.find((profile) => profile.id === fallbackModel)?.label ?? fallbackModel, modelProfileId: fallbackModel }
    ));
  }, [editorOpen, form.model, modelOptions]);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleTemplates = AUTOMATION_TEMPLATES.filter((template) => {
    if (!normalizedQuery) return true;
    return `${template.title} ${template.description} ${template.schedule} ${template.source} ${template.prompt}`.toLowerCase().includes(normalizedQuery);
  });
  const filteredTasks = tasks.filter((task) => {
    if (taskFilter === 'enabled' && task.paused) return false;
    if (taskFilter === 'paused' && !task.paused) return false;
    if (!normalizedQuery) return true;
    return `${task.title} ${task.prompt} ${task.schedule} ${task.project}`.toLowerCase().includes(normalizedQuery);
  });

  useEffect(() => {
    if (editorOpen && !selectedTaskId) {
      titleInputRef.current?.focus();
    }
  }, [editorOpen, selectedTaskId]);

  useEffect(() => {
    const refreshTasks = () => setTasks(loadScheduledAutomationTasks());
    window.addEventListener(AUTOMATION_TASKS_CHANGED_EVENT, refreshTasks);
    window.addEventListener('storage', refreshTasks);
    return () => {
      window.removeEventListener(AUTOMATION_TASKS_CHANGED_EVENT, refreshTasks);
      window.removeEventListener('storage', refreshTasks);
    };
  }, []);

  const commitTasks = (updater: ScheduledAutomationTask[] | ((current: ScheduledAutomationTask[]) => ScheduledAutomationTask[])) => {
    const nextTasks = typeof updater === 'function' ? updater(tasks) : updater;
    setTasks(nextTasks);
    saveScheduledAutomationTasks(nextTasks);
  };

  const updateForm = <Field extends keyof AutomationFormState>(field: Field, value: AutomationFormState[Field]) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const openManualEditor = (template?: AutomationTemplate) => {
    setSelectedTaskId(null);
    setForm(template ? automationFormFromTemplate(template) : blankAutomationForm());
    setEditorOpen(true);
  };

  const inspectTask = (task: ScheduledAutomationTask) => {
    setSelectedTaskId(task.id);
    setForm({
      title: task.title,
      prompt: task.prompt,
      environment: task.environment,
      project: task.project,
      schedule: task.schedule,
      model: task.model,
      modelProfileId: task.modelProfileId,
      reasoningEffort: task.reasoningEffort,
      kind: task.kind,
      skillId: task.skillId,
      skillTitle: task.skillTitle,
      activeWindow: task.activeWindow,
      lastRunAt: task.lastRunAt,
    });
    setEditorOpen(true);
  };

  const runTaskNow = (task: ScheduledAutomationTask) => {
    const state = useChatStore.getState();
    const currentConversation = state.conversations.find(
      (conversation) => conversation.id === state.currentConversationId && !conversation.archivedAt,
    );
    const linkedConversation = task.conversationId
      ? state.conversations.find((conversation) => conversation.id === task.conversationId)
      : undefined;
    const selectedProjectId =
      task.project === '选择项目'
        ? undefined
        : projects.find((project) => project.name === task.project)?.id;

    if (linkedConversation) {
      if (linkedConversation.archivedAt) {
        unarchiveConversation(linkedConversation.id);
      } else {
        setCurrentConversation(linkedConversation.id);
      }
    } else if (task.environment === '当前对话' && currentConversation?.status === 'idle') {
      setCurrentConversation(currentConversation.id);
    } else {
      createConversation(task.environment === '无代码环境' ? undefined : selectedProjectId);
    }

    setSelectedTaskId(task.id);
    setEditorOpen(false);
    setTab('tasks');
    onOpenChat();
    const availableProfiles = visibleModelProfilesForCodexStatus(state.modelProfiles.filter((profile) => profile.enabled), state.codexStatus, state.clientLicenseSession);
    const selection = resolveAutomationSelection(task, availableProfiles, state.selectedModelProfileId, state.reasoningEffort);
    state.setModelSelection(selection.profile.id, selection.reasoningEffort);
    const runPrompt = automationRunPrompt(
      task,
      selection.profile.label,
      selection.profile.supportsReasoningEffort ? selection.reasoningEffort : undefined,
    );
    if (task.skillId) {
      void sendMessage(runPrompt, undefined, { id: task.skillId, title: task.skillTitle || task.skillId });
    } else {
      void sendMessage(runPrompt);
    }
  };

  const deleteTask = (taskId: string) => {
    commitTasks((current) => current.filter((task) => task.id !== taskId));
    if (selectedTaskId === taskId) {
      setSelectedTaskId(null);
      setEditorOpen(false);
      setForm(blankAutomationForm());
    }
  };

  const toggleTaskPaused = (taskId: string) => {
    commitTasks((current) => current.map((task) => (
      task.id === taskId ? { ...task, paused: !task.paused } : task
    )));
  };

  const submitManualTask = (event: FormEvent) => {
    event.preventDefault();
    const prompt = form.prompt.trim();
    if (!prompt) return;

    const selection = resolveAutomationSelection(form, visibleAutomationProfiles, selectedModelProfileId, currentReasoningEffort);
    const task: ScheduledAutomationTask = {
      ...form,
      model: selection.profile.label,
      modelProfileId: selection.profile.id,
      reasoningEffort: selection.reasoningEffort,
      id: selectedTaskId ?? createScheduledAutomationId(),
      title: form.title.trim() || automationTitleFromPrompt(prompt),
      prompt,
      createdAt: tasks.find((item) => item.id === selectedTaskId)?.createdAt ?? Date.now(),
      conversationId: tasks.find((item) => item.id === selectedTaskId)?.conversationId ?? useChatStore.getState().currentConversationId ?? undefined,
      paused: tasks.find((item) => item.id === selectedTaskId)?.paused ?? false,
    };

    commitTasks((current) => {
      if (selectedTaskId) {
        return current.map((item) => (item.id === selectedTaskId ? task : item));
      }
      return [task, ...current];
    });
    setSelectedTaskId(task.id);
    setForm(task);
    setTab('tasks');
  };

  return (
    <section className={`automation-page ${editorOpen ? 'manual-editor-open' : ''}`} aria-label="自动化">
      <div className="automation-topbar" data-tauri-drag-region="deep">
        <div className="automation-topbar-start">
          <CollapsedSidebarToggle collapsed={sidebarCollapsed} onToggle={onToggleSidebar} />
          <div className="automation-tabs" role="tablist" aria-label="自动化">
            <button type="button" role="tab" aria-selected={tab === 'tasks'} className={tab === 'tasks' ? 'active' : ''} onClick={() => { setTab('tasks'); setQuery(''); }}>已安排</button>
            <button type="button" role="tab" aria-selected={tab === 'templates'} className={tab === 'templates' ? 'active' : ''} onClick={() => { setTab('templates'); setQuery(''); }}>模板</button>
          </div>
        </div>
        <div className="automation-topbar-end">
          <button
            type={editorOpen ? 'submit' : 'button'}
            form={editorOpen ? 'automation-editor-form' : undefined}
            className={`automation-create-btn ${editorOpen && !selectedTaskId ? 'active' : ''}`}
            disabled={editorOpen && !form.prompt.trim()}
            onClick={editorOpen ? undefined : () => openManualEditor()}
          >
            <span>{selectedTaskId ? '保存任务' : '创建计划任务'}</span>
            <ChevronDown size={14} />
          </button>
          {editorOpen && (
            <button type="button" className="automation-editor-close" aria-label="关闭创建任务" onClick={() => setEditorOpen(false)}>
              <X size={15} />
            </button>
          )}
        </div>
      </div>
      <div className="automation-layout">
        <div className="automation-shell">
          {tab === 'tasks' ? (
            <div className="automation-view">
              <header className="automation-head">
                <div>
                  <h1>已安排的任务</h1>
                  <div className="automation-subtitle">
                    <span>管理周期性任务、提醒和监控</span>
                    <button type="button" onClick={() => { setTab('templates'); setQuery(''); }}>了解更多</button>
                  </div>
                </div>
                <label className="automation-search">
                  <Search size={15} />
                  <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索已安排任务" aria-label="搜索已安排任务" />
                </label>
              </header>

              {tasks.length > 0 ? (
                <section className="automation-task-section" aria-label="当前自动化任务">
                  <div className="automation-task-toolbar">
                    <div className="automation-task-filters" role="group" aria-label="任务状态筛选">
                      <button type="button" className={taskFilter === 'all' ? 'active' : ''} aria-pressed={taskFilter === 'all'} onClick={() => setTaskFilter('all')}>全部</button>
                      <button type="button" className={taskFilter === 'enabled' ? 'active' : ''} aria-pressed={taskFilter === 'enabled'} onClick={() => setTaskFilter('enabled')}>已开启</button>
                      <button type="button" className={taskFilter === 'paused' ? 'active' : ''} aria-pressed={taskFilter === 'paused'} onClick={() => setTaskFilter('paused')}>已暂停</button>
                    </div>
                    <span className="automation-task-count">
                      {filteredTasks.length} / {tasks.length}
                    </span>
                  </div>
                  <div className="automation-task-list">
                    {filteredTasks.map((task) => (
                      <div
                        key={task.id}
                        className={`automation-task-row ${task.paused ? 'paused' : ''} ${task.id === selectedTaskId ? 'active' : ''}`}
                      >
                        <button type="button" className="automation-task-main" onClick={() => inspectTask(task)}>
                          <span className="automation-task-status" aria-hidden="true" />
                          <span className="automation-task-copy">
                            <strong>{task.title}</strong>
                            <span>{task.paused ? '已暂停' : task.kind === 'intraday-monitor' ? '交易时段自动运行' : 'Next run 待安排'} · {task.schedule}</span>
                          </span>
                        </button>
                        <span className="automation-task-meta">{task.kind === 'intraday-monitor' ? '盘中监控' : task.project === '选择项目' ? '手动创建' : task.project}</span>
                        <span className="automation-task-actions" aria-label="任务操作">
                          <button type="button" className="automation-task-action" aria-label="立即执行" title="立即执行" onClick={() => runTaskNow(task)}>
                            <Play size={14} />
                          </button>
                          <button
                            type="button"
                            className="automation-task-action"
                            aria-label={task.paused ? '恢复任务' : '暂停任务'}
                            title={task.paused ? '恢复任务' : '暂停任务'}
                            onClick={() => toggleTaskPaused(task.id)}
                          >
                            {task.paused ? <Play size={14} /> : <Pause size={14} />}
                          </button>
                          <button type="button" className="automation-task-action" aria-label="编辑" title="编辑" onClick={() => inspectTask(task)}>
                            <Pencil size={14} />
                          </button>
                          <button type="button" className="automation-task-action danger" aria-label="删除" title="删除" onClick={() => deleteTask(task.id)}>
                            <Trash2 size={14} />
                          </button>
                        </span>
                      </div>
                    ))}
                    {filteredTasks.length === 0 && (
                      <div className="automation-filter-empty">
                        <strong>{normalizedQuery ? '没有匹配的任务' : taskFilter === 'paused' ? '没有已暂停的任务' : '没有已开启的任务'}</strong>
                        <span>{normalizedQuery ? '请尝试其他关键词或状态筛选。' : '切换上方筛选可以查看其他任务。'}</span>
                      </div>
                    )}
                  </div>
                </section>
              ) : (
                <div className="automation-empty">
                  <strong>创建首个已安排任务</strong>
                  <div className="automation-empty-actions">
                    {AUTOMATION_TEMPLATES.slice(0, 3).map((template) => (
                      <button key={template.id} type="button" onClick={() => openManualEditor(template)}>
                        {automationTemplateIcon(template.icon, 15)}
                        <span>{template.title}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="automation-view">
              <header className="automation-head templates">
                <div>
                  <h1>任务模板</h1>
                  <p>从金融投研预设开始创建计划任务</p>
                </div>
                <label className="automation-search">
                  <Search size={15} />
                  <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索投研模板" aria-label="搜索投研模板" />
                </label>
              </header>
              <section className="automation-template-section" aria-label="自动化模板">
                <h2>金融投研</h2>
                {visibleTemplates.length > 0 ? (
                  <div className="automation-template-grid">
                    {visibleTemplates.map((template) => (
                      <button key={template.id} type="button" className="automation-template-card" onClick={() => openManualEditor(template)}>
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
        {editorOpen && (
          <AutomationManualEditor
            form={form}
            modelOptions={modelOptions}
            modelValue={automationSelection.profile.id}
            effortValue={automationSelection.reasoningEffort}
            effortOptions={effortOptions}
            projectOptions={projectOptions}
            selectedTaskId={selectedTaskId}
            titleInputRef={titleInputRef}
            onChange={updateForm}
            onModelChange={(id) => { const profile = visibleAutomationProfiles.find((item) => item.id === id); if (profile) setForm((current) => ({ ...current, model: profile.label, modelProfileId: profile.id, reasoningEffort: resolveReasoningEffortForProfile(profile, current.reasoningEffort ?? currentReasoningEffort) })); }}
            onEffortChange={(effort) => updateForm('reasoningEffort', effort)}
            onSubmit={submitManualTask}
          />
        )}
      </div>
    </section>
  );
}

function automationFormFromTemplate(template: AutomationTemplate): AutomationFormState {
  return {
    title: template.title,
    prompt: template.prompt,
    environment: AUTOMATION_ENVIRONMENT_OPTIONS[0],
    project: '选择项目',
    schedule: normalizeAutomationSchedule(template.schedule),
    model: blankAutomationForm().model,
    modelProfileId: blankAutomationForm().modelProfileId,
    reasoningEffort: blankAutomationForm().reasoningEffort,
  };
}

function normalizeAutomationSchedule(schedule: string): string {
  return schedule.replace('星期五', '每周五').replace('09:00', '9:00');
}

function isAutomationSelectGroup(option: AutomationSelectEntry): option is AutomationSelectGroup {
  return typeof option === 'object' && 'options' in option;
}

function renderAutomationSelectOption(option: string | AutomationSelectOption): ReactNode {
  const value = typeof option === 'string' ? option : option.value;
  const label = typeof option === 'string' ? option : option.label;
  return <option key={value} value={value}>{label}</option>;
}

function normalizeAutomationTime(time: string | undefined): string {
  const match = time?.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return '9:00';
  return `${Number.parseInt(match[1], 10)}:${match[2]}`;
}

function parseAutomationSchedule(schedule: string): AutomationScheduleParts {
  const value = schedule.trim();
  const defaults: AutomationScheduleParts = {
    repeat: 'daily',
    time: '9:00',
    weekday: '五',
    monthDay: '1',
    intervalCount: '30',
    intervalUnit: '分钟',
    customValue: CUSTOM_AUTOMATION_SCHEDULE_DEFAULT,
  };

  if (!value) return { ...defaults, repeat: 'custom', customValue: '' };

  let match = value.match(/^每天\s+(\d{1,2}:\d{2})$/);
  if (match) return { ...defaults, repeat: 'daily', time: normalizeAutomationTime(match[1]) };

  match = value.match(/^每个工作日\s+(\d{1,2}:\d{2})$/);
  if (match) return { ...defaults, repeat: 'weekdays', time: normalizeAutomationTime(match[1]) };

  match = value.match(/^每周([一二三四五六日天])\s+(\d{1,2}:\d{2})$/);
  if (match) return { ...defaults, repeat: 'weekly', weekday: match[1] === '天' ? '日' : match[1], time: normalizeAutomationTime(match[2]) };

  match = value.match(/^每月\s+(最后一天|\d+\s*日)\s+(\d{1,2}:\d{2})$/);
  if (match) {
    return {
      ...defaults,
      repeat: 'monthly',
      monthDay: match[1] === '最后一天' ? 'last' : match[1].replace(/\s*日$/, ''),
      time: normalizeAutomationTime(match[2]),
    };
  }

  if (value === '每小时') return { ...defaults, repeat: 'interval', intervalCount: '1', intervalUnit: '小时' };
  match = value.match(/^每\s*(\d+)\s*(分钟|小时|天|周|个月)(?:\s+(\d{1,2}:\d{2}))?$/);
  if (match) {
    return {
      ...defaults,
      repeat: 'interval',
      intervalCount: match[1],
      intervalUnit: match[2] as AutomationIntervalUnit,
      time: normalizeAutomationTime(match[3]),
    };
  }

  return { ...defaults, repeat: 'custom', customValue: value === CUSTOM_AUTOMATION_SCHEDULE_VALUE ? CUSTOM_AUTOMATION_SCHEDULE_DEFAULT : value || CUSTOM_AUTOMATION_SCHEDULE_DEFAULT };
}

function formatAutomationSchedule(parts: AutomationScheduleParts): string {
  if (parts.repeat === 'daily') return `每天 ${normalizeAutomationTime(parts.time)}`;
  if (parts.repeat === 'weekdays') return `每个工作日 ${normalizeAutomationTime(parts.time)}`;
  if (parts.repeat === 'weekly') return `每周${parts.weekday} ${normalizeAutomationTime(parts.time)}`;
  if (parts.repeat === 'monthly') {
    const day = parts.monthDay === 'last' ? '最后一天' : `${parts.monthDay} 日`;
    return `每月 ${day} ${normalizeAutomationTime(parts.time)}`;
  }
  if (parts.repeat === 'interval') {
    const count = Math.max(1, Number.parseInt(parts.intervalCount, 10) || 1);
    const base = count === 1 && parts.intervalUnit === '小时' ? '每小时' : `每 ${count} ${parts.intervalUnit}`;
    return parts.intervalUnit === '分钟' || parts.intervalUnit === '小时'
      ? base
      : `${base} ${normalizeAutomationTime(parts.time)}`;
  }
  return parts.customValue;
}

function automationModelOptionGroups(
  modelProfiles: ModelProfile[],
  codexStatus: { loggedIn: boolean } | null,
  session: ClientLicenseSession | null,
): AutomationSelectGroup[] {
  const enabledProfiles = modelProfiles.filter((profile) => profile.enabled);
  const visibleProfiles = visibleModelProfilesForCodexStatus(enabledProfiles, codexStatus, session);
  const subscriptionOptions = uniqueAutomationSelectOptions(visibleProfiles.filter((profile) => profile.builtIn).map((profile) => ({ value: profile.id, label: profile.label })));
  const usageBasedOptions = uniqueAutomationSelectOptions(
    visibleProfiles
      .filter((profile) => !profile.builtIn)
      .map((profile) => ({ value: profile.id, label: profile.label })),
  );
  const groups: AutomationSelectGroup[] = [];

  if (subscriptionOptions.length > 0) {
    groups.push({ label: '订阅模型', options: subscriptionOptions });
  }

  if (usageBasedOptions.length > 0) {
    groups.push({ label: '按量付费模型', options: usageBasedOptions });
  }

  return groups;
}

function resolveAutomationSelection(form: Pick<AutomationFormState, 'model' | 'modelProfileId' | 'reasoningEffort'>, profiles: ModelProfile[], fallbackProfileId: string, fallbackEffort: ReasoningEffort) {
  const legacyEffort: ReasoningEffort | undefined = form.model.endsWith(' 超高') ? 'xhigh' : form.model.endsWith(' 高') ? 'high' : form.model.endsWith(' 标准') ? 'medium' : undefined;
  const legacyLabel = form.model.replace(/\s+(超高|高|标准)$/, '');
  const profile = profiles.find((item) => item.id === form.modelProfileId) ?? profiles.find((item) => item.label === legacyLabel) ?? resolveModelProfile(profiles, fallbackProfileId);
  return { profile, reasoningEffort: resolveReasoningEffortForProfile(profile, form.reasoningEffort ?? legacyEffort ?? fallbackEffort) };
}

function uniqueAutomationSelectOptions(options: AutomationSelectOption[]): AutomationSelectOption[] {
  const seen = new Set<string>();
  const result: AutomationSelectOption[] = [];
  for (const option of options) {
    if (seen.has(option.value)) continue;
    seen.add(option.value);
    result.push(option);
  }
  return result;
}

function automationSelectGroupsContain(groups: readonly AutomationSelectGroup[], value: string): boolean {
  return groups.some((group) => group.options.some((option) => option.value === value));
}

function firstAutomationSelectValue(groups: readonly AutomationSelectGroup[]): string {
  return groups[0]?.options[0]?.value ?? '';
}

function automationRunPrompt(task: ScheduledAutomationTask, modelLabel = task.model, reasoningEffort?: ReasoningEffort): string {
  const lines = [
    `请立即执行已安排任务「${task.title}」。`,
    `运行环境：${task.environment}`,
    task.project === '选择项目' ? null : `项目：${task.project}`,
    `原计划：${task.schedule}`,
    `模型：${modelLabel}`,
    reasoningEffort ? `推理强度：${effortLabel(reasoningEffort)}` : null,
    '',
    task.prompt,
  ];
  return lines.filter((line): line is string => line !== null).join('\n');
}

function AutomationManualEditor({
  form,
  modelOptions,
  modelValue,
  effortValue,
  effortOptions,
  projectOptions,
  selectedTaskId,
  titleInputRef,
  onChange,
  onModelChange,
  onEffortChange,
  onSubmit,
}: {
  form: AutomationFormState;
  modelOptions: readonly AutomationSelectGroup[];
  modelValue: string;
  effortValue: ReasoningEffort;
  effortOptions: ReturnType<typeof reasoningEffortOptionsForProfile>;
  projectOptions: string[];
  selectedTaskId: string | null;
  titleInputRef: RefObject<HTMLInputElement | null>;
  onChange: <Field extends keyof AutomationFormState>(field: Field, value: AutomationFormState[Field]) => void;
  onModelChange: (value: string) => void;
  onEffortChange: (value: ReasoningEffort) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  const parsedScheduleParts = parseAutomationSchedule(form.schedule);
  const [scheduleModeOverride, setScheduleModeOverride] = useState<AutomationRepeatMode | null>(null);
  const scheduleParts = scheduleModeOverride === 'custom'
    ? { ...parsedScheduleParts, repeat: 'custom' as const, customValue: form.schedule }
    : parsedScheduleParts;

  useEffect(() => setScheduleModeOverride(null), [selectedTaskId]);

  const changeSchedulePart = (patch: Partial<AutomationScheduleParts>) => {
    const next = { ...scheduleParts, ...patch };
    if (patch.repeat) setScheduleModeOverride(patch.repeat === 'custom' ? 'custom' : null);
    if (patch.repeat === 'custom' && scheduleParts.repeat !== 'custom') {
      next.customValue = CUSTOM_AUTOMATION_SCHEDULE_DEFAULT;
    }
    onChange('schedule', formatAutomationSchedule(next));
  };
  const intervalNeedsTime = scheduleParts.intervalUnit !== '分钟' && scheduleParts.intervalUnit !== '小时';

  return (
    <aside className="automation-editor" aria-label="手动创建自动化任务">
      <form id="automation-editor-form" className="automation-editor-form" onSubmit={onSubmit}>
        <div className="automation-editor-main">
          <input
            ref={titleInputRef}
            className="automation-editor-title"
            value={form.title}
            onChange={(event) => onChange('title', event.target.value)}
            placeholder="已安排任务标题"
            aria-label="已安排任务标题"
          />
          <textarea
            className="automation-editor-prompt"
            value={form.prompt}
            onChange={(event) => onChange('prompt', event.target.value)}
            placeholder="描述 GPT 应该做什么"
            aria-label="提示词"
          />
        </div>
        <div className="automation-editor-settings">
          <section className="automation-editor-section" aria-label="任务详情">
            <div className="automation-editor-section-heading">
              <span>详情</span>
              <Info size={13} aria-hidden="true" />
            </div>
            <div className="automation-editor-card">
              <AutomationEditorSelect
                label="运行于"
                value={form.environment}
                options={AUTOMATION_ENVIRONMENT_SELECT_OPTIONS}
                onChange={(value) => onChange('environment', value)}
              />
              <AutomationEditorSelect
                label="项目"
                value={form.project}
                options={[{ value: '选择项目', label: '无' }, ...projectOptions.filter((option) => option !== '选择项目')]}
                onChange={(value) => onChange('project', value)}
              />
              <AutomationEditorSelect
                label="模型"
                value={modelValue}
                options={modelOptions}
                onChange={onModelChange}
              />
              {effortOptions.length > 0 && (
                <AutomationEditorSelect
                  label="推理"
                  value={effortValue}
                  options={effortOptions.map((option) => ({ value: option.id, label: option.label }))}
                  onChange={(value) => onEffortChange(value as ReasoningEffort)}
                />
              )}
            </div>
          </section>

          <section className="automation-editor-section automation-frequency-section" aria-label="运行频率">
            <div className="automation-editor-section-heading"><span>频率</span></div>
            <div className="automation-editor-card">
              <AutomationEditorSelect
                label="重复"
                value={scheduleParts.repeat}
                options={AUTOMATION_REPEAT_OPTIONS}
                onChange={(value) => changeSchedulePart({ repeat: value as AutomationRepeatMode })}
              />
              {scheduleParts.repeat === 'weekly' && (
                <AutomationEditorSelect
                  label="星期"
                  value={scheduleParts.weekday}
                  options={AUTOMATION_WEEKDAY_OPTIONS}
                  onChange={(value) => changeSchedulePart({ weekday: value })}
                />
              )}
              {scheduleParts.repeat === 'monthly' && (
                <AutomationEditorSelect
                  label="日期"
                  value={scheduleParts.monthDay}
                  options={AUTOMATION_MONTH_DAY_OPTIONS}
                  onChange={(value) => changeSchedulePart({ monthDay: value })}
                />
              )}
              {scheduleParts.repeat === 'interval' && (
                <>
                  <AutomationEditorSelect
                    label="间隔"
                    value={scheduleParts.intervalCount}
                    options={Array.from({ length: 60 }, (_, index) => String(index + 1))}
                    onChange={(value) => changeSchedulePart({ intervalCount: value })}
                  />
                  <AutomationEditorSelect
                    label="单位"
                    value={scheduleParts.intervalUnit}
                    options={AUTOMATION_INTERVAL_UNIT_OPTIONS}
                    onChange={(value) => changeSchedulePart({ intervalUnit: value as AutomationIntervalUnit })}
                  />
                </>
              )}
              {scheduleParts.repeat !== 'custom' && (scheduleParts.repeat !== 'interval' || intervalNeedsTime) && (
                <AutomationEditorTime
                  value={scheduleParts.time}
                  onChange={(value) => changeSchedulePart({ time: value })}
                />
              )}
              {scheduleParts.repeat === 'custom' && (
                <label className="automation-editor-custom-rule">
                  <span>规则</span>
                  <input
                    value={scheduleParts.customValue}
                    onChange={(event) => changeSchedulePart({ customValue: event.target.value })}
                    placeholder="Cron: 0 9 * * *"
                    aria-label="自定义重复规则"
                  />
                </label>
              )}
            </div>
          </section>
        </div>
      </form>
    </aside>
  );
}

function AutomationEditorTime({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const normalizedValue = normalizeAutomationTime(value);
  const [hourText, minuteText] = normalizedValue.split(':');
  const selectedHour = Number.parseInt(hourText, 10);
  const selectedMinute = minuteText.padStart(2, '0');
  const [open, setOpen] = useState(false);
  const [openAbove, setOpenAbove] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const selectedHourRef = useRef<HTMLButtonElement>(null);
  const minuteOptions = ['00', '15', '30', '45'];
  if (!minuteOptions.includes(selectedMinute)) minuteOptions.push(selectedMinute);
  minuteOptions.sort((left, right) => Number(left) - Number(right));

  const closePicker = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  useCloseOnOutsidePointer(open, rootRef, () => setOpen(false));
  useEffect(() => {
    if (open) selectedHourRef.current?.focus();
  }, [open]);
  useLayoutEffect(() => {
    if (!open) {
      setOpenAbove(false);
      return;
    }
    const updatePlacement = () => {
      const triggerRect = triggerRef.current?.getBoundingClientRect();
      const popoverRect = popoverRef.current?.getBoundingClientRect();
      if (!triggerRect || !popoverRect) return;
      const gap = 8;
      const roomBelow = window.innerHeight - triggerRect.bottom - gap;
      const roomAbove = triggerRect.top - gap;
      setOpenAbove(popoverRect.height > roomBelow && roomAbove > roomBelow);
    };
    updatePlacement();
    window.addEventListener('resize', updatePlacement);
    window.addEventListener('scroll', updatePlacement, true);
    return () => {
      window.removeEventListener('resize', updatePlacement);
      window.removeEventListener('scroll', updatePlacement, true);
    };
  }, [open]);

  const selectTime = (hour: number, minute: string, close = false) => {
    onChange(`${hour}:${minute.padStart(2, '0')}`);
    if (close) closePicker();
  };

  const nudgeTime = (direction: 1 | -1) => {
    const currentMinutes = selectedHour * 60 + Number(selectedMinute);
    const nextMinutes = (currentMinutes + direction * 15 + 24 * 60) % (24 * 60);
    selectTime(Math.floor(nextMinutes / 60), String(nextMinutes % 60).padStart(2, '0'));
  };

  const handleTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      nudgeTime(event.key === 'ArrowUp' ? 1 : -1);
    }
  };

  return (
    <div className="automation-editor-row automation-editor-time-row">
      <span className="automation-editor-label">时间</span>
      <div
        ref={rootRef}
        className={`automation-time-picker-root ${open ? 'open' : ''}`}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && open) {
            event.preventDefault();
            closePicker();
          }
        }}
      >
        <button
          ref={triggerRef}
          type="button"
          className="automation-time-trigger"
          aria-label="时间"
          aria-haspopup="dialog"
          aria-expanded={open}
          title="选择时间；上下方向键可按 15 分钟调整"
          onClick={() => setOpen((current) => !current)}
          onKeyDown={handleTriggerKeyDown}
        >
          <span>{normalizedValue}</span>
          <ChevronDown size={14} aria-hidden="true" />
        </button>

        {open && (
          <div
            ref={popoverRef}
            className={`automation-time-popover ${openAbove ? 'open-above' : ''}`}
            role="dialog"
            aria-label="选择时间"
          >
            <div className="automation-time-popover-head">
              <span className="automation-time-popover-title"><Clock3 size={14} />选择时间</span>
              <strong>{normalizedValue}</strong>
            </div>

            <div className="automation-time-quick" aria-label="常用时间">
              {['9:00', '12:00', '18:00', '21:00'].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className={preset === normalizedValue ? 'active' : ''}
                  aria-label={`快速选择 ${preset}`}
                  onClick={() => {
                    const [hour, minute] = preset.split(':');
                    selectTime(Number(hour), minute, true);
                  }}
                >
                  {preset}
                </button>
              ))}
            </div>

            <div className="automation-time-group">
              <span className="automation-time-group-label">小时</span>
              <div className="automation-hour-grid">
                {Array.from({ length: 24 }, (_, hour) => (
                  <button
                    key={hour}
                    ref={hour === selectedHour ? selectedHourRef : undefined}
                    type="button"
                    className={hour === selectedHour ? 'active' : ''}
                    aria-label={`${hour} 时`}
                    aria-pressed={hour === selectedHour}
                    onClick={() => selectTime(hour, selectedMinute)}
                  >
                    {hour}
                  </button>
                ))}
              </div>
            </div>

            <div className="automation-time-group minute-group">
              <span className="automation-time-group-label">分钟</span>
              <div className="automation-minute-grid">
                {minuteOptions.map((minute) => (
                  <button
                    key={minute}
                    type="button"
                    className={minute === selectedMinute ? 'active' : ''}
                    aria-label={`${minute} 分`}
                    aria-pressed={minute === selectedMinute}
                    onClick={() => selectTime(selectedHour, minute, true)}
                  >
                    :{minute}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AutomationEditorSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly AutomationSelectEntry[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="automation-editor-row">
      <span className="automation-editor-label">
        <span>{label}</span>
      </span>
      <span className="automation-editor-select">
        <select value={value} aria-label={label} onChange={(event) => onChange(event.target.value)}>
          {options.map((option) => (
            isAutomationSelectGroup(option)
              ? (
                <optgroup key={option.label} label={option.label}>
                  {option.options.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </optgroup>
              )
              : renderAutomationSelectOption(option)
          ))}
        </select>
        <ChevronDown size={14} aria-hidden="true" />
      </span>
    </label>
  );
}

function automationTemplateIcon(icon: AutomationTemplateIcon, size: number): ReactNode {
  const icons: Record<AutomationTemplateIcon, ReactNode> = {
    daily: <Clock3 size={size} />,
    weekly: <ListChecks size={size} />,
    project: <Target size={size} />,
    commit: <LineChart size={size} />,
    release: <FileChartColumn size={size} />,
    ci: <AlertTriangle size={size} />,
  };
  return icons[icon];
}

function SkillsPage({
  sidebarCollapsed,
  onToggleSidebar,
}: {
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}) {
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<SkillCategoryFilter>('all');
  const [filterOpen, setFilterOpen] = useState(false);
  const [expanded, setExpanded] = useState<Partial<Record<SkillCategory, boolean>>>({});
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  const closeFilter = useCallback(() => setFilterOpen(false), []);
  const { catalog, status, setSkillInstalled, setSkillEnabled, resetSkillStatus, queueSkillForComposer } = useSkillRuntime();
  useCloseOnOutsidePointer(filterOpen, filterRef, closeFilter);

  const normalizedQuery = query.trim().toLowerCase();
  const visibleSkills = catalog.filter((skill) => {
    if (categoryFilter !== 'all' && skill.category !== categoryFilter) return false;
    if (!normalizedQuery) return true;
    return `${skill.title} ${skill.description} ${skill.source}`.toLowerCase().includes(normalizedQuery);
  });
  const grouped: Record<SkillCategory, SkillCatalogItem[]> = {
    official: visibleSkills.filter((skill) => skill.category === 'official'),
    personal: visibleSkills.filter((skill) => skill.category === 'personal'),
    system: visibleSkills.filter((skill) => skill.category === 'system'),
    recommended: visibleSkills.filter((skill) => skill.category === 'recommended'),
  };
  const selectedSkill = catalog.find((skill) => skill.id === selectedSkillId) ?? null;
  const sectionOrder: SkillCategory[] = categoryFilter === 'all' ? ['official', 'personal', 'system', 'recommended'] : [categoryFilter];

  return (
    <section className="skills-page" aria-label="技能">
      <div className="skills-drag-strip" data-tauri-drag-region aria-hidden="true" />
      <CollapsedSidebarToggle collapsed={sidebarCollapsed} onToggle={onToggleSidebar} className="skills-sidebar-open-btn" />
      <div className="skills-page-shell">
        <header className="skills-page-head">
          <div className="skills-page-title-row">
            <div>
              <h1>技能</h1>
              <p>通过任务专用技能扩展投研工作流</p>
            </div>
          </div>
          <div className="skills-search-row">
            <label className="skills-search">
              <Search size={15} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索技能" />
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
            {installed && skill.category === 'official' ? (
              <span className="skill-detail-notice">官方 · 随客户端自动安装</span>
            ) : installed && skill.category === 'system' ? (
              <span className="skill-detail-notice">系统 · 由 Harness 运行时提供</span>
            ) : installed ? (
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
    case 'official':
      return '官方';
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
    case 'monitor':
      return <Activity size={size} />;
    case 'review':
      return <MoonStar size={size} />;
    case 'browser':
    default:
      return <Globe size={size} />;
  }
}

function ChatArea({
  domain,
  selectedTextContexts,
  onRemoveSelectedTextContext,
  onConsumeSelectedTextContexts,
  onAddSelectionToChat,
  onAskSelectionInSideChat,
}: {
  domain: DomainConfig;
  selectedTextContexts: SelectedTextContext[];
  onRemoveSelectedTextContext: (id: string) => void;
  onConsumeSelectedTextContexts: () => void;
  onAddSelectionToChat: (context: SelectedTextContext) => void;
  onAskSelectionInSideChat: (context: SelectedTextContext) => void;
}) {
  const conversation = useCurrentConversation();
  const { codexStatus, previewRuntime, codexReady } = useComposerRuntimeState();
  if (!conversation) return null;
  const isEmpty = conversation.messages.length === 0;
  return (
    <div className="chat-area">
      {(!codexReady || previewRuntime) && (
        <div className="codex-warning">
          <AlertCircle size={16} />
          <div>
            <strong>{previewRuntime ? '浏览器预览模式' : 'AI 引擎暂不可用'}</strong>
            <span>{previewRuntime ? '这里会模拟分析事件流；桌面应用会连接本地 AI 运行环境。' : codexStatus?.error || '请确认本地 AI 运行环境已安装并完成设备授权。'}</span>
          </div>
        </div>
      )}
      {isEmpty ? (
        <EmptyState
          domain={domain}
          conversation={conversation}
          disabled={!codexReady}
          selectedTextContexts={selectedTextContexts}
          onRemoveSelectedTextContext={onRemoveSelectedTextContext}
          onConsumeSelectedTextContexts={onConsumeSelectedTextContexts}
        />
      ) : (
        <>
          <MessageList
            key={conversation.id}
            conversation={conversation}
            onAddSelectionToChat={onAddSelectionToChat}
            onAskSelectionInSideChat={onAskSelectionInSideChat}
          />
          <Composer
            domain={domain}
            conversation={conversation}
            disabled={!codexReady}
            bottom
            selectedTextContexts={selectedTextContexts}
            onRemoveSelectedTextContext={onRemoveSelectedTextContext}
            onConsumeSelectedTextContexts={onConsumeSelectedTextContexts}
          />
        </>
      )}
    </div>
  );
}

function DockOverlayComposer({
  domain,
  selectedTextContexts,
  onRemoveSelectedTextContext,
  onConsumeSelectedTextContexts,
}: {
  domain: DomainConfig;
  selectedTextContexts: SelectedTextContext[];
  onRemoveSelectedTextContext: (id: string) => void;
  onConsumeSelectedTextContexts: () => void;
}) {
  const conversation = useCurrentConversation();
  const { codexReady } = useComposerRuntimeState();
  if (!conversation) return null;
  return (
    <div className="dock-composer-overlay">
      <Composer
        domain={domain}
        conversation={conversation}
        disabled={!codexReady}
        bottom
        selectedTextContexts={selectedTextContexts}
        onRemoveSelectedTextContext={onRemoveSelectedTextContext}
        onConsumeSelectedTextContexts={onConsumeSelectedTextContexts}
      />
    </div>
  );
}

function useComposerRuntimeState() {
  const codexStatus = useChatStore((state) => state.codexStatus);
  const clientLicenseSession = useChatStore((state) => state.clientLicenseSession);
  const modelProfiles = useChatStore((state) => state.modelProfiles);
  const selectedModelProfileId = useChatStore((state) => state.selectedModelProfileId);
  const selectedModelProfile = resolveVisibleModelProfile(modelProfiles, selectedModelProfileId, codexStatus, clientLicenseSession);
  const previewRuntime = !isTauriRuntime();
  const gatewayMode = selectedModelProfile.providerId === ALPHA_GATEWAY_PROVIDER_ID;
  const codexReady = previewRuntime || Boolean(codexStatus?.installed && (codexStatus.loggedIn || gatewayMode));
  return { codexStatus, previewRuntime, codexReady };
}

interface ComposerPrefillRequest {
  id: number;
  text: string;
}

function EmptyState({
  domain,
  conversation,
  disabled,
  selectedTextContexts,
  onRemoveSelectedTextContext,
  onConsumeSelectedTextContexts,
}: {
  domain: DomainConfig;
  conversation: Conversation;
  disabled: boolean;
  selectedTextContexts: SelectedTextContext[];
  onRemoveSelectedTextContext: (id: string) => void;
  onConsumeSelectedTextContexts: () => void;
}) {
  const [prefillRequest, setPrefillRequest] = useState<ComposerPrefillRequest | null>(null);
  const prefillComposer = (text: string) => {
    setPrefillRequest((prev) => ({ id: (prev?.id ?? 0) + 1, text }));
  };
  return (
    <div className="empty-state">
      <div className="empty-intro">
        <span className="empty-kicker"><i aria-hidden="true" /> Research workspace</span>
        <h1 className="empty-heading">{domain.ui.emptyHeading}</h1>
        <p>把市场线索、资料和想法放进来，我们一起梳理。</p>
      </div>
      <Composer
        domain={domain}
        conversation={conversation}
        disabled={disabled}
        prefillRequest={prefillRequest}
        selectedTextContexts={selectedTextContexts}
        onRemoveSelectedTextContext={onRemoveSelectedTextContext}
        onConsumeSelectedTextContexts={onConsumeSelectedTextContexts}
      />
      <div className="suggestion-row">
        {domain.ui.suggestions.map((suggestion, index) => (
          <button
            key={suggestion.id}
            type="button"
            className="suggestion-card"
            data-index={String(index + 1).padStart(2, '0')}
            onClick={() => prefillComposer(suggestion.prompt)}
          >
            {domainSuggestionIcon(suggestion)}
            <strong>{suggestion.title}</strong>
            <span>{suggestion.prompt}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

const MESSAGE_SCROLL_BOTTOM_TOLERANCE_PX = 80;
const INITIAL_RENDERED_MESSAGE_COUNT = 48;
const MESSAGE_HISTORY_BATCH_SIZE = 48;

function MessageList({
  conversation,
  onAddSelectionToChat,
  onAskSelectionInSideChat,
}: {
  conversation: Conversation;
  onAddSelectionToChat?: (context: SelectedTextContext) => void;
  onAskSelectionInSideChat?: (context: SelectedTextContext) => void;
}) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const followLatestRef = useRef(true);
  const activeConversationIdRef = useRef(conversation.id);
  const prependedHistoryAnchorRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);
  const [visibleStart, setVisibleStart] = useState(() => (
    Math.max(0, conversation.messages.length - INITIAL_RENDERED_MESSAGE_COUNT)
  ));
  const streaming = conversation.status === 'streaming';
  const latestMessage = conversation.messages[conversation.messages.length - 1];
  const effectiveVisibleStart = Math.min(
    visibleStart,
    Math.max(0, conversation.messages.length - INITIAL_RENDERED_MESSAGE_COUNT),
  );
  const hiddenMessageCount = effectiveVisibleStart;
  const visibleMessages = useMemo(
    () => conversation.messages.slice(effectiveVisibleStart),
    [conversation.messages, effectiveVisibleStart],
  );
  const [selectionMenu, setSelectionMenu] = useState<{
    context: SelectedTextContext;
    left: number;
    top: number;
  } | null>(null);
  useLayoutEffect(() => {
    if (activeConversationIdRef.current !== conversation.id) {
      activeConversationIdRef.current = conversation.id;
      followLatestRef.current = true;
    }
    const container = scrollContainerRef.current;
    if (!container) return;
    const prependedAnchor = prependedHistoryAnchorRef.current;
    if (prependedAnchor) {
      prependedHistoryAnchorRef.current = null;
      container.scrollTop = prependedAnchor.scrollTop + (container.scrollHeight - prependedAnchor.scrollHeight);
      return;
    }
    if (followLatestRef.current) container.scrollTop = container.scrollHeight;
  }, [conversation.id, conversation.messages.length, effectiveVisibleStart, latestMessage, streaming]);
  useEffect(() => {
    if (!selectionMenu) return;
    const dismiss = (event: MouseEvent) => {
      if ((event.target as Element | null)?.closest('.text-selection-actions')) return;
      setSelectionMenu(null);
    };
    window.addEventListener('mousedown', dismiss);
    return () => window.removeEventListener('mousedown', dismiss);
  }, [selectionMenu]);
  const captureSelection = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!onAddSelectionToChat || !onAskSelectionInSideChat) return;
    const selection = window.getSelection();
    const text = selection?.toString().trim();
    if (!selection || selection.isCollapsed || !text || selection.rangeCount === 0) {
      setSelectionMenu(null);
      return;
    }
    const range = selection.getRangeAt(0);
    const startElement = range.startContainer instanceof Element
      ? range.startContainer
      : range.startContainer.parentElement;
    const messageElement = startElement?.closest<HTMLElement>('[data-message-id]');
    if (!messageElement || !event.currentTarget.contains(messageElement)) {
      setSelectionMenu(null);
      return;
    }
    const rect = typeof range.getBoundingClientRect === 'function'
      ? range.getBoundingClientRect()
      : ({ left: event.clientX, right: event.clientX, top: event.clientY } as DOMRect);
    const center = rect.left + Math.max(0, rect.right - rect.left) / 2;
    setSelectionMenu({
      context: {
        id: `selected-text-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        text: text.slice(0, 12_000),
        sourceConversationId: conversation.id,
        sourceMessageId: messageElement.dataset.messageId,
        sourceRole: messageElement.dataset.messageRole === 'user' ? 'user' : 'assistant',
      },
      left: Math.min(Math.max(center, 180), Math.max(180, window.innerWidth - 180)),
      top: Math.max(10, rect.top - 52),
    });
  };
  const loadEarlierMessages = () => {
    const container = scrollContainerRef.current;
    if (container) {
      prependedHistoryAnchorRef.current = {
        scrollHeight: container.scrollHeight,
        scrollTop: container.scrollTop,
      };
    }
    followLatestRef.current = false;
    setVisibleStart(Math.max(0, effectiveVisibleStart - MESSAGE_HISTORY_BATCH_SIZE));
  };
  return (
    <div
      className="message-scroll"
      ref={scrollContainerRef}
      onMouseUp={captureSelection}
      onScroll={(event) => {
        const container = event.currentTarget;
        const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
        followLatestRef.current = distanceFromBottom <= MESSAGE_SCROLL_BOTTOM_TOLERANCE_PX;
      }}
    >
      <div className="message-list">
        {hiddenMessageCount > 0 && (
          <div className="message-history-loader">
            <button type="button" onClick={loadEarlierMessages}>
              加载更早的 {Math.min(MESSAGE_HISTORY_BATCH_SIZE, hiddenMessageCount)} 条消息
            </button>
            <span>还有 {hiddenMessageCount} 条较早记录</span>
          </div>
        )}
        {visibleMessages.map((message, index) => (
          <MessageBubble
            key={message.id}
            message={message}
            conversationId={conversation.id}
            conversationCwd={conversation.cwd}
            conversationStatus={conversation.status}
            index={effectiveVisibleStart + index}
          />
        ))}
        {streaming && (
          <ThinkingIndicator
            lastActivityAt={conversation.updatedAt}
            activity={visibleRunActivity(conversation.runActivity, conversation.messages, conversation.gatewayActivity)}
            gateway={conversation.gatewayActivity}
            onStop={() => useChatStore.getState().stopConversation(conversation.id)}
          />
        )}
      </div>
      {selectionMenu && createPortal(
        <div
          className="text-selection-actions"
          role="toolbar"
          aria-label="选中文本操作"
          style={{ left: selectionMenu.left, top: selectionMenu.top }}
          onMouseDown={(event) => event.preventDefault()}
        >
          <button type="button" onClick={() => {
            onAddSelectionToChat?.(selectionMenu.context);
            setSelectionMenu(null);
          }}>添加到对话</button>
          <span aria-hidden />
          <button type="button" onClick={() => {
            onAskSelectionInSideChat?.(selectionMenu.context);
            setSelectionMenu(null);
          }}>在侧边聊天中提问</button>
        </div>,
        document.body,
      )}
    </div>
  );
}

function visibleRunActivity(activity: Conversation['runActivity'], messages: ChatMessage[], gateway?: Conversation['gatewayActivity']): Conversation['runActivity'] {
  if (activity?.kind === 'retrying') return activity;
  // Include tools that began before an in-flight steering message.
  const running = messages.flatMap(message => message.role === 'assistant' ? message.blocks : [])
    .filter((block): block is Extract<MessageBlock, { type: 'tool' }> => block.type === 'tool' && block.status === 'in_progress');
  const current = [...running].reverse().find(block => toolPresentation(block.title).kind === 'file-edit' || block.title === 'fileWrite') ?? running[running.length - 1];
  if (current) {
    const tool = toolPresentation(current.title);
    const target = current.target || (tool.kind === 'file-edit' ? fileEditTarget(fileEditDetails(current)) : toolActivityTarget(current, tool.kind));
    return { kind: 'working', label: `${tool.running}${target ? ` ${target}` : ''}${running.length > 1 ? ` · 另有 ${running.length - 1} 项操作进行中` : ''}` };
  }
  const progress = gateway && Date.now() - gateway.observedAt < 20_000 ? gateway.requestProgress?.find(item => !item.subagent) : undefined;
  if (progress?.kind === 'tool_input') return { kind: 'working', label: preparingToolLabel(progress.toolName) };
  if (progress?.kind === 'reasoning') return { kind: 'reasoning', label: '模型正在推理' };
  if (activity && activity.label !== '正在执行工具' && activity.label !== '等待模型继续处理') return activity;
  if (gateway?.active) return { kind: 'working', label: gateway.lastOutputAt > 0 ? '模型服务已响应' : '等待模型响应' };
  return activity;
}

function preparingToolLabel(name?: string): string {
  if (/apply_patch|file.?write|write_file|edit_file/i.test(name ?? '')) return '正在准备文件修改';
  if (/exec|shell|terminal|python/i.test(name ?? '')) return '正在生成执行脚本';
  if (/search|browse/i.test(name ?? '')) return '正在准备检索';
  return '正在准备工具调用';
}

function LiveModelOutput({ progress }: { progress: NonNullable<NonNullable<Conversation['gatewayActivity']>['requestProgress']>[number] }) {
  const [expanded, setExpanded] = useState(false);
  const characters = Array.from(progress.preview);
  const preview = expanded ? progress.preview : characters.slice(-220).join('');
  const label = progress.kind === 'tool_input' ? preparingToolLabel(progress.toolName)
    : progress.kind === 'reply' ? '正在输出阶段性内容'
    : progress.kind === 'search' ? '正在检索资料' : '正在推理';
  return (
    <section className="live-model-output" aria-label={progress.subagent ? '子任务实时进展' : '工具准备进度'} aria-live="off">
      <div className="live-model-output-head">
        <span>{progress.subagent ? <Users size={13} /> : <Code2 size={13} />}{progress.subagent ? '子任务' : '下一步'} · {label}</span>
        {progress.characters > 0 && <span>已生成 {progress.characters.toLocaleString('zh-CN')} 字符</span>}
      </div>
      {preview && <p className="live-model-output-preview">{!expanded && characters.length > 220 ? '…' : ''}{preview}</p>}
      {characters.length > 220 && <button type="button" className="live-model-output-expand" onClick={() => setExpanded(value => !value)}>{expanded ? '收起' : '展开最近内容'}</button>}
      <span className="live-model-output-note">{progress.kind === 'tool_input'
        ? '模型正在生成工具参数，准备完成后才会执行。'
        : progress.kind === 'reply' ? '子任务的阶段性输出，主任务随后汇总。' : '有可展示的内容时会在这里更新。'}</span>
    </section>
  );
}

const LONG_WAIT_SECONDS = 60;
const POSSIBLY_STALLED_SECONDS = 180;

function ThinkingIndicator({
  lastActivityAt,
  activity,
  gateway,
  onStop,
}: {
  lastActivityAt: number;
  activity?: Conversation['runActivity'];
  gateway?: Conversation['gatewayActivity'];
  onStop: () => void | Promise<void>;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const inactiveSeconds = Math.max(0, Math.floor((now - lastActivityAt) / 1000));
  const gatewayFresh = gateway && now - gateway.observedAt < 20_000;
  const waitingRequests = gatewayFresh ? gateway.waitingRequests : 0;
  const cooldownSeconds = gatewayFresh ? Math.max(0, Math.ceil(((gateway.cooldownUntil ?? 0) - now) / 1000)) : 0;
  const localOperation = activity?.label.startsWith('正在') && /文件|编辑|脚本|运行|工具|搜索|读取/.test(activity.label);
  const cooling = cooldownSeconds > 0 && gateway?.activeRequests === 0 && !localOperation;
  const state = inactiveSeconds >= POSSIBLY_STALLED_SECONDS
    ? 'stalled'
    : inactiveSeconds >= LONG_WAIT_SECONDS
      ? 'waiting'
      : 'active';
  const label = activity?.kind === 'retrying'
    ? activity.label
    : cooling ? '等待模型服务恢复'
    : state === 'stalled'
    ? localOperation ? '操作仍在进行，暂未收到新进展' : '等待模型响应较久'
    : state === 'waiting'
      ? '任务仍在运行'
      : activity?.label || '正在处理';
  const detail = cooling ? null : state === 'stalled'
    ? `${formatThinkingDuration(inactiveSeconds)}没有新进展，${localOperation ? '工具尚未返回新的执行结果。' : '可能正在长推理或等待连接。'}`
    : state === 'waiting'
      ? `${formatThinkingDuration(inactiveSeconds)}没有新进展，复杂任务可能仍在处理。`
      : activity?.kind === 'retrying' ? '连接暂时中断，正在等待重试结果。' : null;

  return (
    <>
      {gatewayFresh && gateway.requestProgress?.filter(progress => progress.subagent || progress.kind === 'tool_input')
        .map(progress => <LiveModelOutput key={progress.id} progress={progress} />)}
    <div
      className={`thinking-indicator ${state}`}
      role="status"
      aria-live="polite"
      aria-label={label}
      data-state={state}
    >
      <div className="thinking-copy">
        <div className="thinking-primary">
          <span className="thinking-shimmer">{label}</span>
        </div>
        {detail && <span className="thinking-detail">{detail}</span>}
        {!cooling && state !== 'active' && activity && activity.kind !== 'retrying' && (
          <span className="thinking-detail">最近状态：{activity.label}</span>
        )}
        {waitingRequests > 0 && (
          <details className="gateway-queue-details">
            <summary><Clock3 size={12} aria-hidden="true" />任务内有 {waitingRequests} 个模型请求等待<ChevronDown size={12} aria-hidden="true" /></summary>
            <p>同一 agent 的请求按顺序处理，独立子任务最多 {gateway?.maxParallelSubagents ?? 2} 个并行。当前有 {waitingRequests} 个请求等待名额、预算结算或限流冷却，不是你追加的消息；无需重复发送。</p>
          </details>
        )}
        {gatewayFresh && (gateway.activeSubagents ?? 0) > 0 && <span className="thinking-detail">{gateway.activeSubagents} 个子任务请求正在处理</span>}
        {cooldownSeconds > 0 && <span className="thinking-detail">模型服务限流，统一等待 {formatThinkingDuration(cooldownSeconds)}后再尝试。</span>}
        {gateway && !gatewayFresh && gateway.waitingRequests > 0 && <span className="thinking-detail">连接状态暂未更新，等待下一次确认。</span>}
      </div>
      {state === 'stalled' && (
        <button type="button" className="thinking-stop" onClick={() => void onStop()} aria-label="停止当前任务">
          停止任务
        </button>
      )}
    </div>
    </>
  );
}

const MessageBubble = memo(function MessageBubble({
  message,
  conversationId,
  conversationCwd,
  conversationStatus,
  index,
}: {
  message: ChatMessage;
  conversationId: string;
  conversationCwd: string;
  conversationStatus: Conversation['status'];
  index: number;
}) {
  const editUserMessageAndResend = useChatStore((state) => state.editUserMessageAndResend);
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyResetTimer = useRef<number | null>(null);
  const isReviewRequest = message.role === 'user' && Boolean(message.reviewRequest);
  const plainText = useMemo(
    () => message.isStreaming ? '' : messageToPlainText(message),
    [message],
  );
  const generatedFiles = useMemo(
    () => message.role === 'assistant'
      ? generatedFilesFromMessageBlocks(message.blocks, !message.isStreaming)
      : [],
    [message.blocks, message.isStreaming, message.role],
  );
  const securityMentions = useMemo(() => message.role === 'assistant' && !message.isStreaming
    ? findResearchSecurityMentions(message.blocks.flatMap((block) => block.type === 'text' ? [block.content] : []).join('\n'))
    : [], [message.blocks, message.isStreaming, message.role]);
  const canCopy = plainText.length > 0 && !isReviewRequest;
  const canEdit = message.role === 'user' && !isReviewRequest && conversationStatus !== 'streaming';
  const lastBlockIndex = message.blocks.length - 1;
  useEffect(() => () => {
    if (copyResetTimer.current !== null) window.clearTimeout(copyResetTimer.current);
  }, []);
  const handleCopy = async () => {
    if (!await tryCopyToClipboard(plainText)) return;
    setCopied(true);
    if (copyResetTimer.current !== null) window.clearTimeout(copyResetTimer.current);
    copyResetTimer.current = window.setTimeout(() => {
      setCopied(false);
      copyResetTimer.current = null;
    }, 1800);
  };
  const submitEdit = (next: string, attachments: MessageAttachment[]) => {
    const trimmed = next.trim();
    if (!trimmed && attachments.length === 0) return;
    setEditing(false);
    void editUserMessageAndResend(conversationId, message.id, trimmed, attachments);
  };
  return (
    <MessageWorkspaceContext.Provider value={conversationCwd}>
    <article
      className={`message ${message.role} ${message.isStreaming ? 'streaming' : ''} ${editing ? 'editing' : ''}`}
      data-message-id={message.id}
      data-message-role={message.role}
      aria-busy={message.isStreaming || undefined}
    >
      <header className="message-record-head">
        <span className="message-record-index">{String(index + 1).padStart(2, '0')}</span>
        <span className="message-record-role"><i aria-hidden="true" />{message.role === 'user' ? 'USER / 用户指令' : message.review ? 'ALPHA / 审查结论' : 'ALPHA / 研究回应'}</span>
        <time dateTime={new Date(message.timestamp).toISOString()}>{formatMessageRecordTime(message.timestamp)}</time>
      </header>
      {editing && canEdit ? (
        <MessageEditBubble initialValue={plainText} initialAttachments={message.attachments ?? []} onCancel={() => setEditing(false)} onSubmit={submitEdit} />
      ) : isReviewRequest && message.reviewRequest ? (
        <ReviewRequestChip request={message.reviewRequest} />
      ) : (
        <>
          {message.role === 'user' && message.attachments?.length ? (
            <MessageAttachments attachments={message.attachments} />
          ) : null}
          {(message.role !== 'user' || message.blocks.length > 0 || message.selectedSkill || message.coworkers?.length) && (
            <div className="bubble">
              {message.role === 'assistant' && <TurnDuration message={message} />}
              {message.role === 'user'
                ? (
                    <>
                      {message.coworkers && message.coworkers.length > 0 && <MessageCoworkersLabel coworkers={message.coworkers} />}
                      {message.selectedSkill && <MessageSkillLabel skill={message.selectedSkill} />}
                      {message.selectedTextContexts && message.selectedTextContexts.length > 0 && (
                        <MessageSelectedTextContexts contexts={message.selectedTextContexts} />
                      )}
                      {message.blocks.map((block, index) => block.type === 'text' ? <MarkdownText key={index} content={block.content} variant="user" /> : <BlockRenderer key={index} block={block} />)}
                    </>
                  )
                : message.review
                  ? <ReviewBody message={message} cwd={conversationCwd} />
	                  : buildRenderUnits(message.blocks).map((unit) =>
	                      unit.type === 'command-group'
	                        ? (unit.blocks.length === 1
	                            ? <BlockRenderer key={`tool-${unit.startIndex}`} block={unit.blocks[0]} />
	                            : <CommandGroup key={`cmd-group-${unit.startIndex}`} blocks={unit.blocks} />)
	                        : unit.type === 'web-search-group'
	                          ? (unit.blocks.length === 1
	                              ? <BlockRenderer key={`tool-${unit.startIndex}`} block={unit.blocks[0]} />
	                              : <WebSearchGroup key={`web-group-${unit.startIndex}`} blocks={unit.blocks} />)
	                        : unit.type === 'activity-group'
	                          ? (unit.blocks.length === 1
	                              ? <BlockRenderer key={`tool-${unit.startIndex}`} block={unit.blocks[0]} />
	                              : <ActivityGroup key={`activity-group-${unit.startIndex}`} blocks={unit.blocks} kind={unit.kind} />)
	                        : unit.block.type === 'file_result'
	                          ? null
	                          : unit.block.type === 'image_result' && !shouldRenderPersistedImageResult(unit.block, message.blocks)
	                            ? null
	                          : <BlockRenderer key={`${unit.block.type}-${unit.index}`} block={unit.block} streaming={Boolean(message.isStreaming) && unit.index === lastBlockIndex} />,
	                    )}
              {generatedFiles.length > 0 && (
                <GeneratedFileResultView
                  grouped
                  block={{
                    type: 'file_result',
                    id: `message-files-${message.id}`,
                    title: '交付文件',
                    files: generatedFiles,
                  }}
                />
              )}
              {message.role === 'assistant' && !message.isStreaming && securityMentions.length > 0 && (
                <StockMentionCards mentions={securityMentions} />
              )}
            </div>
          )}
        </>
      )}
      {!editing && !message.isStreaming && (canCopy || canEdit) && (
        <div className="message-meta">
          <span className="message-actions">
            {canCopy && (
              <button
                type="button"
                className={`message-action${copied ? ' copied' : ''}`}
                onClick={() => void handleCopy()}
                aria-label={copied ? '已复制' : '复制'}
                aria-live="polite"
              >
                {copied ? <Check size={13} strokeWidth={2.5} /> : <Copy size={13} />}
              </button>
            )}
            {canEdit && <button type="button" className="message-action" onClick={() => setEditing(true)} aria-label="编辑并重新发送"><Pencil size={13} /></button>}
          </span>
        </div>
      )}
    </article>
    </MessageWorkspaceContext.Provider>
  );
});

const MAX_VISIBLE_STOCK_MENTIONS = 8;

function StockMentionCards({ mentions }: { mentions: ResearchSecurityMention[] }) {
  const visible = mentions.slice(0, MAX_VISIBLE_STOCK_MENTIONS);
  const remaining = Math.max(0, mentions.length - visible.length);
  return (
    <section className="stock-mention-strip" aria-label="对话相关股票">
      <header className="stock-mention-head">
        <span><ChartCandlestick size={14} /><strong>相关股票</strong></span>
        <em>{mentions.length} 只 · 点击进入投研详情</em>
      </header>
      <div className="stock-mention-grid">
        {visible.map((mention) => (
          <button
            key={mention.code}
            type="button"
            className="stock-mention-card"
            onClick={() => openResearchSecurity(mention.code)}
            aria-label={`查看${mention.name}投研详情`}
            title={`在投研工作台查看 ${mention.name}（${shortCode(mention.code)}）`}
          >
            <span className="stock-mention-avatar" aria-hidden="true">{mention.name.slice(0, 1)}</span>
            <span className="stock-mention-identity">
              <strong>{mention.name}</strong>
              <em>{shortCode(mention.code)}</em>
            </span>
            <span className="stock-mention-meta">
              <em>{mention.sector}</em>
              <span>{mention.tags[0] || mention.board}</span>
            </span>
            <span className="stock-mention-open" aria-hidden="true"><ChevronRight size={14} /></span>
          </button>
        ))}
      </div>
      {remaining > 0 && <p className="stock-mention-more">另有 {remaining} 只股票已在正文中提及</p>}
    </section>
  );
}

function renderInlineStockMentions(text: string): ReactNode {
  const ranges = findResearchSecurityMentionRanges(text);
  if (ranges.length === 0) return text;
  const nodes: ReactNode[] = [];
  let cursor = 0;
  ranges.forEach((range, index) => {
    if (range.start > cursor) nodes.push(text.slice(cursor, range.start));
    const code = shortCode(range.mention.code);
    nodes.push(
      <button
        key={`${range.mention.code}-${range.start}-${index}`}
        type="button"
        className="stock-inline-mention"
        onClick={() => openResearchSecurity(range.mention.code)}
        aria-label={`打开${range.mention.name}投研详情`}
        title={`${range.mention.sector} · 在投研工作台查看 ${range.mention.name}`}
      >
        <ChartCandlestick size={11} aria-hidden="true" />
        <strong>{range.mention.name}</strong>
        {range.mention.name !== code && <em>{code}</em>}
      </button>,
    );
    cursor = range.end;
  });
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

function inlineStockChildren(children: ReactNode): ReactNode {
  return Children.map(children, (child) => typeof child === 'string' ? renderInlineStockMentions(child) : child);
}

function formatMessageRecordTime(timestamp: number): string {
  if (!Number.isFinite(timestamp)) return '--:--';
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function MessageSkillLabel({ skill }: { skill: SkillSelection }) {
  const invocation = skillInvocationLabel(skill);
  const title = skill.title.trim() || skill.id;
  return (
    <span className="message-skill-label" title={`指定 Skill：${invocation}（${title}）`}>
      {invocation}
    </span>
  );
}

function skillInvocationLabel(skill: Pick<SkillSelection, 'id'>): string {
  return `$${skill.id}`;
}

function MessageSelectedTextContexts({ contexts }: { contexts: SelectedTextContext[] }) {
  return (
    <div className="message-selected-contexts" aria-label={`${contexts.length} 个引用文本片段`}>
      {contexts.map((context, index) => (
        <blockquote key={context.id}>
          <span>选中文本片段 {index + 1}</span>
          {context.text}
        </blockquote>
      ))}
    </div>
  );
}

function isImeComposingKeyEvent(
  event: ReactKeyboardEvent<HTMLElement>,
  trackedComposition = false,
): boolean {
  // WKWebView can report `isComposing=false` for the Enter key that confirms
  // an IME candidate while still exposing the legacy process key code 229.
  // Keep both signals so confirming Chinese/Japanese/Korean input never sends.
  return trackedComposition
    || event.nativeEvent.isComposing
    || event.nativeEvent.keyCode === 229;
}

// Chips on a user message showing which coworkers were summoned for the turn.
function MessageCoworkersLabel({ coworkers }: { coworkers: CoworkerSelection[] }) {
  return (
    <span className="message-coworkers-label" title={`召集同事：${coworkers.map((item) => `${item.no} ${item.name}`).join('、')}`}>
      <Users size={12} />
      {coworkers.map((coworker) => (
        <span key={coworker.id} className="message-coworker-chip" data-group={coworkerById(coworker.id)?.group}>
          {coworker.no} {coworker.name}
        </span>
      ))}
    </span>
  );
}

function MessageEditBubble({ initialValue, initialAttachments, onCancel, onSubmit }: { initialValue: string; initialAttachments: MessageAttachment[]; onCancel: () => void; onSubmit: (value: string, attachments: MessageAttachment[]) => void }) {
  const [value, setValue] = useState(initialValue);
  const [attachments, setAttachments] = useState<MessageAttachment[]>(initialAttachments);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imeCompositionRef = useRef(false);
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
      <textarea ref={textareaRef} className="message-edit-textarea" value={value} rows={1} onChange={(event) => setValue(event.target.value)} onCompositionStart={() => { imeCompositionRef.current = true; }} onCompositionEnd={() => { imeCompositionRef.current = false; }} onKeyDown={(event) => {
        if (event.key === 'Escape') onCancel();
        if (event.key === 'Enter' && !event.shiftKey && !isImeComposingKeyEvent(event, imeCompositionRef.current)) {
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
// the DOM when collapsed avoids a WKWebView bug where output updated inside a
// closed <details> renders blank until the row is toggled again. A user's
// disclosure choice stays in control as output and tool status change.
function EventDetails({
  className,
  defaultOpen = false,
  summary,
  children,
}: {
  className: string;
  defaultOpen?: boolean;
  summary: ReactNode;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details
      className={className}
      open={open}
      onToggle={(event) => {
        const next = event.currentTarget.open;
        if (next !== open) setOpen(next);
      }}
    >
      <summary
        className={`event-summary${children ? '' : ' event-summary-static'}`}
        aria-expanded={children ? open : undefined}
        tabIndex={children ? undefined : -1}
        onClick={(event) => { if (!children) event.preventDefault(); }}
      >
        {summary}
        {children && <ChevronDown size={13} className="event-chevron" aria-hidden="true" />}
      </summary>
      {open && children}
    </details>
  );
}

function BlockRenderer({ block, streaming }: { block: MessageBlock; streaming?: boolean }) {
  if (block.type === 'text') {
    return <MarkdownText content={block.content} streaming={streaming} />;
  }
  if (block.type === 'thinking') {
    return (
      <EventDetails
        className={`thinking-block ${streaming ? 'is-active' : ''}`}
        summary={(
          <>
            <span className="event-icon">{streaming ? <Loader2 size={13} className="spin" /> : <Sparkles size={13} />}</span>
            <span className="event-verb">{streaming ? '正在推理' : '推理过程'}</span>
            <span className="event-target">{firstLine(block.content).replace(/[*#`]/g, '')}</span>
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

const MARKDOWN_REMARK_PLUGINS = [remarkGfm];
const STREAMING_MARKDOWN_CHUNK_MIN_CHARS = 4_000;
const STREAMING_MARKDOWN_PLAIN_TAIL_CHARS = 12_000;

const MarkdownFragment = memo(function MarkdownFragment({ content }: { content: string }) {
  return <ReactMarkdown remarkPlugins={MARKDOWN_REMARK_PLUGINS} components={MARKDOWN_COMPONENTS}>{content}</ReactMarkdown>;
});

const StreamingPlainText = memo(function StreamingPlainText({ content }: { content: string }) {
  return <div className="streaming-plain-text">{content}</div>;
});

// Keep completed chunks referentially stable while the tail is streaming. This
// prevents ReactMarkdown from reparsing the full answer on every token. The
// scan is linear and only cuts at blank lines outside fenced code blocks.
export function splitStreamingMarkdown(content: string): { settled: string[]; active: string } {
  const settled: string[] = [];
  let chunkStart = 0;
  let lineStart = 0;
  let fence: { marker: '`' | '~'; length: number } | null = null;

  while (lineStart < content.length) {
    const newline = content.indexOf('\n', lineStart);
    if (newline < 0) break;
    const line = content.slice(lineStart, newline).trimStart().replace(/\r$/, '');
    const fenceMatch = /^(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const token = fenceMatch[1];
      const marker = token[0] as '`' | '~';
      if (!fence) {
        fence = { marker, length: token.length };
      } else if (
        marker === fence.marker
        && token.length >= fence.length
        && line.slice(token.length).trim().length === 0
      ) {
        fence = null;
      }
    } else if (
      !fence
      && line.trim().length === 0
      && newline + 1 - chunkStart >= STREAMING_MARKDOWN_CHUNK_MIN_CHARS
    ) {
      settled.push(content.slice(chunkStart, newline + 1));
      chunkStart = newline + 1;
    }
    lineStart = newline + 1;
  }

  return { settled, active: content.slice(chunkStart) };
}

function MarkdownText({ content, streaming, variant = 'assistant' }: { content: string; streaming?: boolean; variant?: 'assistant' | 'user' }) {
  const streamed = useMemo(
    () => streaming ? splitStreamingMarkdown(content) : { settled: [content], active: '' },
    [content, streaming],
  );
  return (
    <div className={`markdown-content markdown-${variant} ${streaming ? 'streaming' : ''}`}>
      {streamed.settled.map((fragment, index) => (
        <MarkdownFragment key={`settled-${index}`} content={fragment} />
      ))}
      {streamed.active && (
        streaming && streamed.active.length > STREAMING_MARKDOWN_PLAIN_TAIL_CHARS
          ? <StreamingPlainText content={streamed.active} />
          : <MarkdownFragment content={streamed.active} />
      )}
    </div>
  );
}

function ToolBlockView({ block, groupedIndex }: { block: Extract<MessageBlock, { type: 'tool' }>; groupedIndex?: number }) {
  const writeCommand = block.command || (/command|exec|shell|fileRead/i.test(block.title) ? block.input : '') || '';
  const tool = toolPresentation(isFileWriteCommand(writeCommand) ? 'fileWrite' : block.title);
  const running = block.status === 'in_progress';
  const failed = block.status === 'failed';
  const verb = block.completionUnconfirmed ? '写入结果未确认' : running ? tool.running : failed ? tool.failed : tool.done;
  const inferredTarget = inferredSpawnAgentToolTarget(block);
  const editDetails = tool.kind === 'file-edit' ? fileEditDetails(block) : null;
  const editTarget = editDetails ? fileEditTarget(editDetails) : '';
  const activityTarget = toolActivityTarget(block, tool.kind);
  const target = block.target || inferredTarget || editTarget || activityTarget || (tool.kind === 'file-write' ? '' : firstLine(block.input));
  const rawInput = block.input?.trim() || '';
  const targetTitle = rawInput && !rawInput.startsWith('{') && !rawInput.startsWith('[') ? firstLine(rawInput) : target;
  const targetIsRawInput = Boolean(!block.target && !inferredTarget && !editTarget && !activityTarget && target);
  const isCommand = tool.kind === 'command' || tool.kind === 'file-write';
  const plainBody = isCommand ? '' : cleanCommandOutput(block.output || (!running ? block.input || '' : ''));
  const fileEditHasDetails = Boolean(editDetails && (
    editDetails.files.length > 0
    || editDetails.additions > 0
    || editDetails.deletions > 0
    || editDetails.diff
    || editDetails.raw
  ));
  const hasBody = tool.kind === 'file-edit'
    ? !running || fileEditHasDetails
    : isCommand
      ? Boolean(block.command || block.input || block.output)
      : Boolean(plainBody) && plainBody !== target;
  return (
    <EventDetails
      className={`tool-block event-block ${block.status} kind-${tool.kind} ${groupedIndex === undefined ? '' : 'grouped-item'}`}
      defaultOpen={tool.kind === 'image'}
      summary={(
        <>
          <span className="event-icon">{tool.icon}</span>
          {tool.kind === 'command'
            ? <CommandStatus status={block.status} />
            : <span className="event-verb">{groupedIndex === undefined ? verb : `搜索 ${String(groupedIndex + 1).padStart(2, '0')}`}</span>}
          <span className={`event-target ${targetIsRawInput ? 'mono' : ''}`} title={targetTitle || undefined}>{target}</span>
          {block.finishedAt && block.startedAt && <span className="event-duration">{formatThinkingDuration(Math.max(0, Math.floor((block.finishedAt - block.startedAt) / 1000)))}</span>}
          {(running || failed) && <span className="event-trailing">
            {running ? <Loader2 size={12} className="spin" /> : failed ? <AlertCircle size={12} className="event-fail" /> : null}
          </span>}
        </>
      )}
    >
      {hasBody && (
        <div className="event-body">
          {isCommand ? (
            <>
              {tool.kind === 'file-write' && <p className="file-write-note">{block.completionUnconfirmed ? '未收到脚本的完成事件，请查看输出文件确认结果。' : running ? '正在执行包含文件写入的命令，完成后可检查输出文件。' : failed ? '写入命令未成功完成，文件可能只写入了部分内容。' : '写入命令已执行完毕，实际文件内容可在文件面板查看。'}</p>}
              <CommandCard command={block.command || block.input} output={block.output} status={block.status} unconfirmed={block.completionUnconfirmed} />
            </>
          ) : editDetails ? (
            <FileEditCard details={editDetails} canOpen={!running && !failed && !block.completionUnconfirmed} cwd={block.cwd} unconfirmed={block.completionUnconfirmed} />
          ) : (
            <pre className="event-output">{plainBody}</pre>
          )}
        </div>
      )}
    </EventDetails>
  );
}

interface ToolActivityHints {
  queries: string[];
  paths: string[];
  urls: string[];
  references: string[];
}

function toolActivityTarget(
  block: Extract<MessageBlock, { type: 'tool' }>,
  kind: ToolKind,
): string {
  const input = cleanCommandOutput(block.input || '').trim();
  if (!input) return '';
  const parsed = parseJsonValue(input);
  const hints = parsed === null ? { queries: [], paths: [], urls: [], references: [] } : collectToolActivityHints(parsed);
  const plainUrl = input.match(/https?:\/\/[^\s<>'"`\])}]+/i)?.[0] || '';
  const hintedUrls = uniqueActivityValues([...(hints.urls || []), plainUrl]);
  const urls = hintedUrls.filter((value) => /^https?:\/\//i.test(value));
  const resourceUris = hintedUrls.filter((value) => !/^https?:\/\//i.test(value));
  const queries = uniqueActivityValues(hints.queries).map((value) => compactActivityText(value));
  const paths = uniqueActivityValues(hints.paths).map((value) => shortenPath(value));
  const references = uniqueActivityValues(hints.references).map((value) => compactActivityText(value));

  if (isWebSearchToolTitle(block.title)) {
    return summarizeActivityValues(queries) || (urls[0] ? shortWebUrl(urls[0]) : compactPlainActivityInput(input));
  }
  if (isWebPageToolTitle(block.title) || kind === 'web') {
    const webTarget = urls[0] ? shortWebUrl(urls[0]) : '';
    if (queries[0] && webTarget) return `${queries[0]} · ${webTarget}`;
    return webTarget
      || summarizeActivityValues(queries)
      || (references[0] ? `页面 ${summarizeActivityValues(references)}` : '')
      || compactPlainActivityInput(input);
  }
  if (kind === 'search') {
    const queryTarget = summarizeActivityValues(queries);
    const pathTarget = summarizeActivityValues(paths);
    if (queryTarget && pathTarget) return `${queryTarget} · ${pathTarget}`;
    return queryTarget || pathTarget || compactPlainActivityInput(input);
  }
  if (kind === 'file-read') {
    return summarizeActivityValues(paths)
      || summarizeActivityValues(resourceUris.map((value) => compactActivityText(value)))
      || compactPlainActivityInput(input, true);
  }
  return '';
}

function collectToolActivityHints(value: unknown): ToolActivityHints {
  const hints: ToolActivityHints = { queries: [], paths: [], urls: [], references: [] };
  const visit = (entry: unknown, key = '') => {
    if (Array.isArray(entry)) {
      entry.forEach((item) => visit(item, key));
      return;
    }
    if (entry && typeof entry === 'object') {
      Object.entries(entry as Record<string, unknown>).forEach(([childKey, child]) => visit(child, childKey));
      return;
    }
    if (typeof entry !== 'string') return;
    const text = entry.trim();
    if (!text) return;
    const normalizedKey = key.replace(/[_.-]/g, '').toLowerCase();
    if (/^(?:q|query|queries|searchquery|pattern)$/.test(normalizedKey)) hints.queries.push(text);
    if (/^(?:path|paths|filepath|filename|files)$/.test(normalizedKey)) hints.paths.push(text);
    if (/^(?:url|urls|uri|href)$/.test(normalizedKey)) hints.urls.push(text);
    if (/^(?:ref|refid|reference)$/.test(normalizedKey)) hints.references.push(text);
    const nested = parseJsonValue(text);
    if (nested !== null) visit(nested, key);
  };
  visit(value);
  return hints;
}

function compactActivityText(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > 72 ? `${compact.slice(0, 71)}…` : compact;
}

function compactPlainActivityInput(value: string, preferPath = false): string {
  const compact = firstLine(value);
  if (!compact || compact.startsWith('{') || compact.startsWith('[')) return '';
  if (/^https?:\/\//i.test(compact)) return shortWebUrl(compact);
  if (preferPath && (/^(?:\/|~\/|[A-Za-z]:[\\/])/.test(compact))) return shortenPath(compact);
  return compactActivityText(compact);
}

function summarizeActivityValues(values: string[]): string {
  if (values.length === 0) return '';
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]}；${values[1]}`;
  return `${values[0]}；${values[1]} 等 ${values.length} 项`;
}

function uniqueActivityValues(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

type FileEditKind = 'add' | 'update' | 'delete' | 'rename' | 'unknown';

interface FileEditEntry {
  path: string;
  kind: FileEditKind;
}

interface FileEditDetails {
  files: FileEditEntry[];
  additions: number;
  deletions: number;
  diff: string;
  raw: string;
}

function fileEditDetails(block: Extract<MessageBlock, { type: 'tool' }>): FileEditDetails {
  if (block.fileChanges) {
    return {
      files: block.fileChanges.map(({ path, kind }) => ({ path, kind })),
      additions: block.fileChanges.reduce((sum, file) => sum + file.additions, 0),
      deletions: block.fileChanges.reduce((sum, file) => sum + file.deletions, 0),
      diff: block.fileChanges.filter(file => file.diff).map(file => `${file.path}\n${file.diff}`).join('\n\n'),
      raw: '',
    };
  }
  const sources = [...new Set([block.output, block.input].map(cleanCommandOutput).filter(Boolean))];
  const files = new Map<string, FileEditKind>();
  let additions = 0;
  let deletions = 0;
  let diff = '';

  const rememberFile = (pathValue: unknown, kindValue?: unknown) => {
    if (typeof pathValue !== 'string') return;
    const path = pathValue.trim().replace(/^['"`]|['"`]$/g, '');
    if (!path || path === '/dev/null' || /^https?:\/\//i.test(path)) return;
    const kind = normalizeFileEditKind(kindValue);
    const previous = files.get(path);
    files.set(path, previous && previous !== 'unknown' ? previous : kind);
  };

  const inspect = (value: unknown, key = '') => {
    if (Array.isArray(value)) {
      value.forEach((entry) => inspect(entry, key));
      return;
    }
    if (!value || typeof value !== 'object') {
      if (typeof value === 'string' && /^(?:diff|patch|changes?|input|output|result)$/i.test(key)) {
        const nested = parseJsonValue(value);
        if (nested !== null) inspect(nested, key);
        if (/^(?:diff|patch)$/i.test(key) && looksLikeDiff(value)) diff ||= value.trim();
      }
      return;
    }
    const record = value as Record<string, unknown>;
    const path = record.path ?? record.filePath ?? record.file_path ?? record.filename;
    const kind = record.kind ?? record.changeType ?? record.change_type ?? record.operation;
    if (path) rememberFile(path, kind);
    const added = numberValue(record.additions ?? record.linesAdded ?? record.lines_added);
    const removed = numberValue(record.deletions ?? record.linesDeleted ?? record.lines_deleted);
    if (added !== null) additions += added;
    if (removed !== null) deletions += removed;
    Object.entries(record).forEach(([childKey, child]) => inspect(child, childKey));
  };

  // The completed output replaces the proposal; don't count both copies.
  const structured = sources.map(parseJsonValue).find(value => value !== null);
  if (structured) inspect(structured);
  sources.forEach((source) => {
    for (const match of source.matchAll(/^\*\*\*\s+(Add|Update|Delete) File:\s*(.+)$/gm)) {
      rememberFile(match[2], match[1]);
    }
    for (const match of source.matchAll(/^diff --git\s+a\/(.+?)\s+b\/(.+)$/gm)) {
      rememberFile(match[2], 'update');
    }
    for (const match of source.matchAll(/^(?:File|Path|文件|路径)\s*:\s*(.+)$/gim)) {
      rememberFile(match[1]);
    }
    if (!diff && looksLikeDiff(source)) diff = source;
  });

  if (diff) {
    const stats = diffLineStats(diff);
    if (additions === 0) additions = stats.additions;
    if (deletions === 0) deletions = stats.deletions;
  }

  return { files: [...files.entries()].map(([path, kind]) => ({ path, kind })), additions, deletions, diff, raw: sources[0] || '' };
}

function parseJsonValue(value: string): unknown | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function numberValue(value: unknown): number | null {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : null;
}

function normalizeFileEditKind(value: unknown): FileEditKind {
  return fileChangeKind(value);
}

function looksLikeDiff(value: string): boolean {
  return /^diff --git\s/m.test(value) || /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/m.test(value) || /^\*\*\*\s+(?:Begin Patch|Add File:|Update File:|Delete File:)/m.test(value);
}

function diffLineStats(value: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  value.split('\n').forEach((line) => {
    if (line.startsWith('+') && !line.startsWith('+++')) additions += 1;
    if (line.startsWith('-') && !line.startsWith('---')) deletions += 1;
  });
  return { additions, deletions };
}

function fileEditTarget(details: FileEditDetails): string {
  const stats = fileEditStatsLabel(details);
  if (details.files.length === 1) return `${shortenPath(details.files[0].path)}${stats ? ` · ${stats}` : ''}`;
  if (details.files.length > 1) return `${details.files.length} 个文件${stats ? ` · ${stats}` : ''}`;
  return stats;
}

function fileEditStatsLabel(details: Pick<FileEditDetails, 'additions' | 'deletions'>): string {
  return [details.additions > 0 ? `+${details.additions}` : '', details.deletions > 0 ? `−${details.deletions}` : ''].filter(Boolean).join(' ');
}

function fileEditKindLabel(kind: FileEditKind): string {
  if (kind === 'add') return '新增';
  if (kind === 'delete') return '删除';
  if (kind === 'rename') return '重命名';
  if (kind === 'update') return '修改';
  return '变更';
}

function FileEditCard({ details, canOpen, cwd, unconfirmed }: { details: FileEditDetails; canOpen: boolean; cwd?: string; unconfirmed?: boolean }) {
  const openFile = useFileDockOpener();
  const messageCwd = useContext(MessageWorkspaceContext);
  const stats = fileEditStatsLabel(details);
  const showRaw = !details.diff && details.files.length === 0 && details.raw;
  return (
    <div className="file-edit-card">
      {unconfirmed && <div className="file-edit-empty"><Info size={14} /><span>未收到写入完成事件。以下为计划变更，请在文件面板确认实际结果。</span></div>}
      <div className="file-edit-card-head">
        <span><FileDiff size={13} />变更明细</span>
        <span className="file-edit-card-stats">
          {details.files.length > 0 && `${details.files.length} 个文件`}
          {stats && <>
            {details.additions > 0 && <em className="added">+{details.additions}</em>}
            {details.deletions > 0 && <em className="deleted">−{details.deletions}</em>}
          </>}
        </span>
      </div>
      {details.files.length > 0 && (
        <div className="file-edit-files">
          {details.files.map((file) => (
            <div className="file-edit-file" key={file.path} title={file.path}>
              <FileCode2 size={13} />
              {canOpen && file.kind !== 'delete' && openFile ? (
                <button type="button" className="file-edit-file-path file-edit-open" aria-label={`预览 ${file.path}`} onClick={() => openFile(/^(?:\/|[A-Za-z]:[\\/])/.test(file.path) ? file.path : `${cwd || messageCwd}/${file.path}`)}>{shortenPath(file.path)}</button>
              ) : <span className="file-edit-file-path">{shortenPath(file.path)}</span>}
              <span className={`file-edit-kind ${file.kind}`}>{fileEditKindLabel(file.kind)}</span>
            </div>
          ))}
        </div>
      )}
      {details.diff ? (
        <pre className="file-edit-diff">{details.diff}</pre>
      ) : showRaw ? (
        <pre className="file-edit-raw">{details.raw}</pre>
      ) : details.files.length === 0 ? (
        <div className="file-edit-empty"><Info size={14} /><span>编辑工具未返回变更明细，可在右侧 Git 面板查看工作区差异。</span></div>
      ) : null}
    </div>
  );
}

function inferredSpawnAgentToolTarget(block: Extract<MessageBlock, { type: 'tool' }>): string {
  if (!isSpawnAgentToolTitle(block.title)) return '';
  const source = [block.input, block.output].filter(Boolean).join('\n');
  const agentId = spawnAgentIdFromToolText(source);
  if (!agentId) return '';
  const coworker = COWORKER_CATALOG.find((item) => item.id === agentId);
  return coworker ? `${coworker.id} · ${coworker.no} ${coworker.name}` : agentId;
}

function spawnAgentIdFromToolText(text: string): string {
  const keyPattern = /["']?(?:agent_type|agentType|agent_id|agentId|agent|target_agent|targetAgent)["']?\s*[:=]\s*["']?([A-Za-z0-9_-]+)["']?/g;
  for (const match of text.matchAll(keyPattern)) {
    const normalized = normalizeSpawnAgentDisplayId(match[1]);
    if (normalized) return normalized;
  }
  for (const coworker of COWORKER_CATALOG) {
    const escaped = escapeRegExp(coworker.id);
    const filePattern = new RegExp(`(?:^|[/\\\\])${escaped}\\.(?:md|markdown|txt|json)(?=$|[\\s"'<>),.;:])`, 'i');
    if (filePattern.test(text)) return coworker.id;
  }
  return '';
}

function normalizeSpawnAgentDisplayId(value: string | undefined): string {
  const trimmed = (value || '').trim().replace(/^["'`]+|["'`]+$/g, '');
  if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) return '';
  const lower = trimmed.toLowerCase();
  const coworker = COWORKER_CATALOG.find((item) => item.id.toLowerCase() === lower);
  if (coworker) return coworker.id;
  if (['default', 'explorer', 'worker'].includes(lower)) return lower;
  return trimmed;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function CommandCard({ command, output, status, unconfirmed }: { command?: string; output?: string; status: 'in_progress' | 'completed' | 'failed'; unconfirmed?: boolean }) {
  const cleaned = cleanCommandOutput(output);
  const copyText = [command ? `$ ${command}` : '', cleaned].filter(Boolean).join('\n');
  const statusBadge = unconfirmed ? <span className="cc-status"><Info size={12} />未确认</span> : status === 'failed'
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

function CommandStatus({
  status,
  suffix = '',
}: {
  status: Extract<MessageBlock, { type: 'tool' }>['status'];
  suffix?: string;
}) {
  const label = status === 'in_progress' ? '正在运行' : status === 'failed' ? '运行失败' : '已运行';
  return (
    <span
      className={`event-verb command-status ${status}`}
      role="status"
      aria-label={`${label}${suffix}`}
      aria-live="polite"
    >
      {label}{suffix}
    </span>
  );
}

function CommandGroupStatus({ blocks }: { blocks: Array<Extract<MessageBlock, { type: 'tool' }>> }) {
  if (blocks.length === 1) return <CommandStatus status={blocks[0].status} />;
  const counts = {
    in_progress: blocks.filter((block) => block.status === 'in_progress').length,
    completed: blocks.filter((block) => block.status === 'completed').length,
    failed: blocks.filter((block) => block.status === 'failed').length,
  };
  const segments = [
    { status: 'in_progress' as const, label: '正在运行', count: counts.in_progress },
    { status: 'completed' as const, label: '已运行', count: counts.completed },
    { status: 'failed' as const, label: '失败', count: counts.failed },
  ].filter((segment) => segment.count > 0);
  const announcement = segments.map((segment) => `${segment.label} ${segment.count} 条`).join('，');
  return (
    <span className="event-verb command-group-status" role="status" aria-label={announcement} aria-live="polite">
      {segments.map((segment, index) => (
        <Fragment key={segment.status}>
          {index > 0 && <span className="command-status-separator" aria-hidden="true">·</span>}
          <span className={`command-status ${segment.status}`} aria-hidden="true">
            <span>{segment.label} {segment.count} 条</span>
          </span>
        </Fragment>
      ))}
    </span>
  );
}

function CommandGroup({ blocks }: { blocks: Array<Extract<MessageBlock, { type: 'tool' }>> }) {
  const anyRunning = blocks.some((block) => block.status === 'in_progress');
  const anyFailed = blocks.some((block) => block.status === 'failed');
  const state = anyRunning ? 'in_progress' : anyFailed ? 'failed' : 'completed';
  return (
    <EventDetails
      className={`tool-block event-block command-group ${state}`}
      summary={(
        <>
          <span className="event-icon command-group-icon"><SquareTerminal size={15} /></span>
          <CommandGroupStatus blocks={blocks} />
          <span className="event-target" />
          {(anyRunning || anyFailed) && <span className="event-trailing">
            {anyRunning ? <Loader2 size={12} className="spin" /> : <AlertCircle size={12} className="event-fail" />}
          </span>}
        </>
      )}
    >
      <div className="command-group-items">
        {blocks.map((block) => <ToolBlockView key={block.id} block={block} />)}
      </div>
    </EventDetails>
  );
}

function WebSearchGroup({ blocks }: { blocks: Array<Extract<MessageBlock, { type: 'tool' }>> }) {
  const anyRunning = blocks.some((block) => block.status === 'in_progress');
  const anyFailed = blocks.some((block) => block.status === 'failed');
  const state = anyRunning ? 'in_progress' : anyFailed ? 'failed' : 'completed';
  const targets = uniqueActivityValues(blocks.map((block) => toolActivityTarget(block, 'web')).filter(Boolean));
  const target = summarizeActivityValues(targets);
  return (
    <EventDetails
      className={`tool-block event-block web-search-group ${state}`}
      summary={(
        <>
          <span className="event-icon web-search-group-icon"><Globe size={15} /></span>
          <WebSearchGroupStatus blocks={blocks} />
          <span className="event-target" title={target || undefined}>{target}</span>
          {(anyRunning || anyFailed) && <span className="event-trailing">
            {anyRunning ? <Loader2 size={12} className="spin" /> : <AlertCircle size={12} className="event-fail" />}
          </span>}
        </>
      )}
    >
      <div className="tool-group-items">
        {blocks.map((block, index) => <ToolBlockView key={block.id} block={block} groupedIndex={index} />)}
      </div>
    </EventDetails>
  );
}

function WebSearchGroupStatus({ blocks }: { blocks: Array<Extract<MessageBlock, { type: 'tool' }>> }) {
  const segments = [
    { status: 'in_progress' as const, label: '正在搜索网页', count: blocks.filter((block) => block.status === 'in_progress').length },
    { status: 'completed' as const, label: '已搜索网页', count: blocks.filter((block) => block.status === 'completed').length },
    { status: 'failed' as const, label: '搜索失败', count: blocks.filter((block) => block.status === 'failed').length },
  ].filter((segment) => segment.count > 0);
  const announcement = segments.map((segment) => `${segment.label} ${segment.count} 次`).join('，');
  return (
    <span className="event-verb command-group-status web-search-group-status" role="status" aria-label={announcement} aria-live="polite">
      {segments.map((segment, index) => (
        <Fragment key={segment.status}>
          {index > 0 && <span className="command-status-separator" aria-hidden="true">·</span>}
          <span className={`command-status ${segment.status}`} aria-hidden="true">
            <span>{segment.label} {segment.count} 次</span>
          </span>
        </Fragment>
      ))}
    </span>
  );
}

type ActivityGroupKind = 'file-read' | 'search' | 'web-read';

const ACTIVITY_GROUP_LABELS = {
  'file-read': { running: '正在读取文件', completed: '已读取文件', failed: '读取失败' },
  search: { running: '正在搜索文件', completed: '已搜索文件', failed: '搜索失败' },
  'web-read': { running: '正在读取网页', completed: '已读取网页', failed: '读取失败' },
};

function ActivityGroup({ blocks, kind }: { blocks: Array<Extract<MessageBlock, { type: 'tool' }>>; kind: ActivityGroupKind }) {
  const labels = ACTIVITY_GROUP_LABELS[kind];
  const segments = [
    { status: 'in_progress', label: labels.running, count: blocks.filter((block) => block.status === 'in_progress').length },
    { status: 'completed', label: labels.completed, count: blocks.filter((block) => block.status === 'completed').length },
    { status: 'failed', label: labels.failed, count: blocks.filter((block) => block.status === 'failed').length },
  ].filter((segment) => segment.count > 0);
  const running = blocks.some((block) => block.status === 'in_progress');
  const failed = blocks.some((block) => block.status === 'failed');
  const announcement = segments.map((segment) => `${segment.label} ${segment.count} 次`).join('，');
  const state = running ? 'in_progress' : failed ? 'failed' : 'completed';
  return (
    <EventDetails
      className={`tool-block event-block activity-group ${state}`}
      summary={(
        <>
          <span className="event-icon">{toolPresentation(blocks[0].title).icon}</span>
          <span className="event-verb command-group-status" role="status" aria-label={announcement} aria-live="polite">
            {segments.map((segment, index) => (
              <Fragment key={segment.status}>
                {index > 0 && <span className="command-status-separator" aria-hidden="true">·</span>}
                <span className={`command-status ${segment.status}`} aria-hidden="true">{segment.label} {segment.count} 次</span>
              </Fragment>
            ))}
          </span>
          <span className="event-target" />
          {(running || failed) && <span className="event-trailing">
            {running && <Loader2 size={12} className="spin" />}
            {failed && <AlertCircle size={12} className="event-fail" />}
          </span>}
        </>
      )}
    >
      <div className="tool-group-items" role="region" aria-label="活动明细" tabIndex={0}>
        {blocks.map((block) => <ToolBlockView key={block.id} block={block} />)}
      </div>
    </EventDetails>
  );
}

function activityGroupKind(block: MessageBlock): ActivityGroupKind | null {
  if (block.type !== 'tool') return null;
  const tool = toolPresentation(block.title);
  if (tool.kind === 'file-read' || tool.kind === 'search') return tool.kind;
  return tool.kind === 'web' && tool.done === '已读取网页' ? 'web-read' : null;
}

type RenderUnit =
  | { type: 'block'; block: MessageBlock; index: number }
  | { type: 'command-group'; blocks: Array<Extract<MessageBlock, { type: 'tool' }>>; startIndex: number }
  | { type: 'web-search-group'; blocks: Array<Extract<MessageBlock, { type: 'tool' }>>; startIndex: number }
  | { type: 'activity-group'; kind: ActivityGroupKind; blocks: Array<Extract<MessageBlock, { type: 'tool' }>>; startIndex: number };

function buildRenderUnits(blocks: MessageBlock[]): RenderUnit[] {
  const units: RenderUnit[] = [];
  const hideReconnectStatus = blocks.some((block) => !isReconnectStatusBlock(block));
  let index = 0;
  while (index < blocks.length) {
    if (hideReconnectStatus && isReconnectStatusBlock(blocks[index])) {
      index += 1;
      continue;
    }
    const activityKind = activityGroupKind(blocks[index]);
    if (isCommandBlock(blocks[index])) {
      const group: Array<Extract<MessageBlock, { type: 'tool' }>> = [];
      const startIndex = index;
      while (index < blocks.length && isCommandBlock(blocks[index])) {
        group.push(blocks[index] as Extract<MessageBlock, { type: 'tool' }>);
        index += 1;
      }
      units.push({ type: 'command-group', blocks: group, startIndex });
    } else if (isWebSearchBlock(blocks[index])) {
      const group: Array<Extract<MessageBlock, { type: 'tool' }>> = [];
      const startIndex = index;
      while (index < blocks.length && isWebSearchBlock(blocks[index])) {
        group.push(blocks[index] as Extract<MessageBlock, { type: 'tool' }>);
        index += 1;
      }
      units.push({ type: 'web-search-group', blocks: group, startIndex });
    } else if (activityKind) {
      const group: Array<Extract<MessageBlock, { type: 'tool' }>> = [];
      const startIndex = index;
      while (index < blocks.length && activityGroupKind(blocks[index]) === activityKind) {
        group.push(blocks[index] as Extract<MessageBlock, { type: 'tool' }>);
        index += 1;
      }
      units.push({ type: 'activity-group', kind: activityKind, blocks: group, startIndex });
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

function isWebSearchBlock(block: MessageBlock): boolean {
  return block.type === 'tool' && isWebSearchToolTitle(block.title);
}

// Conversations created before the event-parser fix may already contain an
// image_result synthesized from raw shell/web output. Hide those stale cards
// when their source block is a command or web search. Standalone image blocks,
// Image Gen, view-image, screenshot, and generic wait payloads remain visible.
function shouldRenderPersistedImageResult(
  block: Extract<MessageBlock, { type: 'image_result' }>,
  blocks: MessageBlock[],
): boolean {
  const sourceToolId = block.id.replace(/-result$/, '');
  if (sourceToolId === block.id) return true;
  const source = blocks.find((candidate): candidate is Extract<MessageBlock, { type: 'tool' }> => (
    candidate.type === 'tool' && candidate.id === sourceToolId
  ));
  if (!source) return true;
  return !isCommandBlock(source) && !isWebSearchBlock(source);
}

function isReconnectStatusBlock(block: MessageBlock): boolean {
  return block.type === 'error' && /^Reconnecting\.\.\.\s+\d+\/\d+$/i.test(block.content.trim());
}

interface ComposerProps {
  domain: DomainConfig;
  conversation: Conversation;
  disabled?: boolean;
  bottom?: boolean;
  prefillRequest?: ComposerPrefillRequest | null;
  selectedTextContexts?: SelectedTextContext[];
  onRemoveSelectedTextContext?: (id: string) => void;
  onConsumeSelectedTextContexts?: () => void;
  onSendMessage?: (
    message: string,
    attachments?: MessageAttachment[],
    selectedSkill?: SkillSelection | null,
    coworkers?: CoworkerSelection[] | null,
    selectedContexts?: SelectedTextContext[] | null,
  ) => void | Promise<void>;
  onStop?: () => void | Promise<void>;
}

function ComposerImpl({
  domain,
  conversation,
  disabled,
  bottom,
  prefillRequest,
  selectedTextContexts = [],
  onRemoveSelectedTextContext,
  onConsumeSelectedTextContexts,
  onSendMessage,
  onStop,
}: ComposerProps) {
  const [value, setValue] = useState('');
  const [attachments, setAttachments] = useState<MessageAttachment[]>([]);
  const [pendingAttachmentBatches, setPendingAttachmentBatches] = useState(0);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<SkillCatalogItem | null>(null);
  const [selectedCoworkers, setSelectedCoworkers] = useState<CoworkerSelection[]>([]);
  const [composerDragKind, setComposerDragKind] = useState<'context' | 'path' | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imeCompositionRef = useRef(false);
  const { queuedSkill, queuedSkillPrompt, consumeQueuedSkill, queuedCoworkerTask, consumeQueuedCoworkerTask } = useSkillRuntime();
  const sendMessage = useChatStore((state) => state.sendMessage);
  const removeQueuedMessage = useChatStore((state) => state.removeQueuedMessage);
  const updateQueuedMessage = useChatStore((state) => state.updateQueuedMessage);
  const reorderQueuedMessage = useChatStore((state) => state.reorderQueuedMessage);
  const sendQueuedMessageNow = useChatStore((state) => state.sendQueuedMessageNow);
  const stopCurrentConversation = useChatStore((state) => state.stopCurrentConversation);
  const isStreaming = conversation.status === 'streaming';
  const queuedMessages = conversation.queuedMessages ?? [];
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [value]);
  useEffect(() => {
    if (!queuedSkill) return;
    setSelectedSkill(queuedSkill);
    if (queuedSkillPrompt?.trim()) {
      setValue((prev) => (prev.trim() ? `${prev.trimEnd()}\n\n${queuedSkillPrompt.trim()}` : queuedSkillPrompt.trim()));
    }
    consumeQueuedSkill();
    textareaRef.current?.focus();
  }, [queuedSkill, queuedSkillPrompt, consumeQueuedSkill]);
  useEffect(() => {
    const text = prefillRequest?.text.trim();
    if (!text) return;
    setValue(text);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(text.length, text.length);
    });
  }, [prefillRequest]);
  useEffect(() => {
    if (selectedTextContexts.length === 0) return;
    textareaRef.current?.focus();
  }, [selectedTextContexts]);
  const addCoworker = useCallback((coworker: CoworkerSelection) => {
    setSelectedCoworkers((prev) => (prev.some((item) => item.id === coworker.id) ? prev : [...prev, coworker]));
  }, []);
  const addCoworkers = useCallback((coworkers: CoworkerSelection[]) => {
    setSelectedCoworkers((prev) => {
      const seen = new Set(prev.map((item) => item.id));
      const next = [...prev];
      for (const coworker of coworkers) {
        if (seen.has(coworker.id)) continue;
        seen.add(coworker.id);
        next.push(coworker);
      }
      return next;
    });
  }, []);
  const appendComposerText = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setValue((prev) => (prev.trim() ? `${prev.trimEnd()}\n\n${trimmed}` : trimmed));
  }, []);
  // Let panels (research workbench quick tasks, etc.) push prompts into this
  // composer with one click instead of drag-only.
  useEffect(() => registerComposerInsertHandler((text) => {
    appendComposerText(text);
    textareaRef.current?.focus();
  }), [appendComposerText]);
  useEffect(() => {
    if (!queuedCoworkerTask) return;
    addCoworkers(queuedCoworkerTask.coworkers);
    if (queuedCoworkerTask.taskPrompt) {
      appendComposerText(queuedCoworkerTask.taskPrompt);
    }
    consumeQueuedCoworkerTask();
    textareaRef.current?.focus();
  }, [queuedCoworkerTask, consumeQueuedCoworkerTask, addCoworkers, appendComposerText]);
  const removeCoworker = (id: string) => setSelectedCoworkers((prev) => prev.filter((item) => item.id !== id));
  const readCoworkerDrag = (event: ReactDragEvent<HTMLElement>): CoworkerSelection | null => {
    const raw = event.dataTransfer.getData(COWORKER_DRAG_MIME);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<CoworkerSelection>;
      if (typeof parsed.id !== 'string' || typeof parsed.name !== 'string') return null;
      return { id: parsed.id, no: typeof parsed.no === 'string' ? parsed.no : '', name: parsed.name };
    } catch {
      return null;
    }
  };
  const readResearchDrag = (event: ReactDragEvent<HTMLElement>): string => {
    return event.dataTransfer.getData(RESEARCH_DRAG_MIME) || event.dataTransfer.getData('text/plain') || '';
  };
  const readLocalPathDrag = (event: ReactDragEvent<HTMLElement>): { path: string; isDirectory: boolean } | null => {
    const raw = event.dataTransfer.getData(LOCAL_PATH_DRAG_MIME);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as { path?: unknown; isDirectory?: unknown };
      const path = typeof parsed.path === 'string' ? parsed.path.trim() : '';
      return path ? { path, isDirectory: parsed.isDirectory === true } : null;
    } catch {
      return null;
    }
  };
  const handleComposerDragOver = (event: ReactDragEvent<HTMLElement>) => {
    const types = event.dataTransfer.types;
    const draggingPath = types.includes(LOCAL_PATH_DRAG_MIME);
    if (!draggingPath && !types.includes(COWORKER_DRAG_MIME) && !types.includes(RESEARCH_DRAG_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setComposerDragKind(draggingPath ? 'path' : 'context');
  };
  const handleComposerDrop = async (event: ReactDragEvent<HTMLElement>) => {
    const localPath = readLocalPathDrag(event);
    setComposerDragKind(null);
    if (localPath) {
      event.preventDefault();
      setAttachmentError(null);
      setPendingAttachmentBatches((count) => count + 1);
      try {
        addAttachments([await buildAttachmentFromPath(localPath.path, localPath.isDirectory)]);
      } catch (error) {
        setAttachmentError(`路径引入失败：${stringifyError(error)}`);
      } finally {
        setPendingAttachmentBatches((count) => Math.max(0, count - 1));
        textareaRef.current?.focus();
      }
      return;
    }
    const coworker = readCoworkerDrag(event);
    const researchPrompt = coworker ? '' : readResearchDrag(event);
    if (!coworker && !researchPrompt.trim()) return;
    event.preventDefault();
    if (coworker) {
      addCoworker(coworker);
    } else {
      appendComposerText(researchPrompt);
    }
    textareaRef.current?.focus();
  };
  const addAttachments = (items: MessageAttachment[]) => {
    setAttachments((prev) => mergeAttachments(prev, items));
  };
  const handlePaste = async (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const files = filesFromClipboard(event.clipboardData);
    if (files.length === 0) return;
    event.preventDefault();
    setAttachmentError(null);
    setPendingAttachmentBatches((count) => count + 1);
    try {
      const results = await Promise.allSettled(files.map((file, index) => buildAttachmentFromPastedFile(file, index)));
      const added = results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
      if (added.length > 0) addAttachments(added);
      const failedCount = results.length - added.length;
      if (failedCount > 0) {
        setAttachmentError(`${failedCount} 个附件粘贴失败，请重试或使用“添加照片和文件”`);
      }
    } finally {
      setPendingAttachmentBatches((count) => Math.max(0, count - 1));
      textareaRef.current?.focus();
    }
  };
  const removeAttachment = (id: string) => setAttachments((prev) => prev.filter((item) => item.id !== id));
  const isAddingAttachments = pendingAttachmentBatches > 0;
  const canSend = !isAddingAttachments && Boolean(value.trim() || attachments.length);
  const submit = () => {
    if (!canSend || disabled) return;
    const outgoing = attachments;
    const outgoingSkill = selectedSkill;
    const outgoingCoworkers = selectedCoworkers;
    const outgoingContexts = selectedTextContexts;
    setValue('');
    setAttachments([]);
    setSelectedSkill(null);
    setSelectedCoworkers([]);
    onConsumeSelectedTextContexts?.();
    if (onSendMessage) {
      void onSendMessage(value.trim(), outgoing, outgoingSkill, outgoingCoworkers, outgoingContexts.length ? outgoingContexts : undefined);
    } else if (outgoingContexts.length) {
      void sendMessage(value.trim(), outgoing, outgoingSkill, outgoingCoworkers, outgoingContexts);
    } else {
      void sendMessage(value.trim(), outgoing, outgoingSkill, outgoingCoworkers);
    }
  };
  return (
    <div className={`composer-wrap ${bottom ? 'bottom' : ''} ${queuedMessages.length > 0 ? 'has-queue' : ''}`}>
      {queuedMessages.length > 0 && (
        <ComposerQueue
          key={conversation.id}
          queuedMessages={queuedMessages}
          onRemove={(id) => removeQueuedMessage(conversation.id, id)}
          onUpdate={(id, text) => updateQueuedMessage(conversation.id, id, { text })}
          onReorder={(id, beforeId) => reorderQueuedMessage(conversation.id, id, beforeId)}
          onGuide={(id) => sendQueuedMessageNow(conversation.id, id)}
        />
      )}
      <div
        className={`composer-card ${composerDragKind ? 'coworker-drag-over' : ''} ${composerDragKind === 'path' ? 'path-drag-over' : ''}`}
        onDragOver={handleComposerDragOver}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
          setComposerDragKind(null);
        }}
        onDrop={(event) => void handleComposerDrop(event)}
      >
        {selectedTextContexts.length > 0 && (
          <ComposerSelectedTextContexts
            contexts={selectedTextContexts}
            onRemove={onRemoveSelectedTextContext}
          />
        )}
        {selectedCoworkers.length > 0 && (
          <div className="composer-coworkers">
            <span className="composer-coworkers-label">
              <Users size={13} />
              {selectedCoworkers.length > 1 ? '召集同事协同' : '召集同事'}
            </span>
            {selectedCoworkers.map((coworker) => (
              <span key={coworker.id} className="composer-coworker-chip" data-group={coworkerById(coworker.id)?.group}>
                <span className="composer-coworker-no">{coworker.no}</span>
                {coworker.name}
                <button
                  type="button"
                  className="composer-coworker-remove"
                  onClick={() => removeCoworker(coworker.id)}
                  aria-label={`移除 ${coworker.name}`}
                >
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        )}
        {selectedSkill && (
          <div className="composer-skill-selection">
            <span className={`composer-skill-icon skill-icon-${selectedSkill.icon}`}>{skillIcon(selectedSkill, 16)}</span>
            <span className="composer-skill-copy">
              <strong>{skillInvocationLabel(selectedSkill)}</strong>
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
        {(isAddingAttachments || attachmentError) && (
          <div className={`composer-attachment-status ${attachmentError ? 'error' : ''}`} role="status" aria-live="polite">
            {isAddingAttachments ? <><Loader2 size={13} className="spin" />正在引入本地路径…</> : <><AlertCircle size={13} />{attachmentError}</>}
          </div>
        )}
        <textarea
          ref={textareaRef}
          className="composer-textarea"
          value={value}
          disabled={disabled}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setValue(event.target.value)}
          onCompositionStart={() => { imeCompositionRef.current = true; }}
          onCompositionEnd={() => { imeCompositionRef.current = false; }}
          onPaste={(event) => void handlePaste(event)}
          onKeyDown={(event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
            if (event.key === 'Enter' && !event.shiftKey && !isImeComposingKeyEvent(event, imeCompositionRef.current)) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder={disabled ? '请先修复本地 AI 运行环境状态' : bottom ? domain.ui.followupPlaceholder : domain.ui.composerPlaceholder}
          rows={1}
        />
        <div className="composer-toolbar">
          <ComposerPlusMenu domain={domain} onAttach={addAttachments} onSelectSkill={setSelectedSkill} disabled={disabled} />
          <ApprovalPicker />
          <ComposerMeta conversation={conversation} />
          <span className="spacer" />
          <ModelPicker />
          {isStreaming && canSend && (
            <button className="send-button queue" type="button" onClick={submit} disabled={disabled} aria-label="加入队列">
              <CornerDownRight size={17} />
            </button>
          )}
          {isStreaming ? (
            <button className="send-button stop" type="button" onClick={() => void (onStop ? onStop() : stopCurrentConversation())} aria-label="停止">
              <Square size={12} fill="currentColor" strokeWidth={0} />
            </button>
          ) : (
            <button className="send-button" type="button" onClick={submit} disabled={!canSend || disabled} aria-label="发送">
              <ArrowUp size={18} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function composerPropsEqual(previous: ComposerProps, next: ComposerProps): boolean {
  const previousConversation = previous.conversation;
  const nextConversation = next.conversation;
  return previous.domain === next.domain
    && previous.disabled === next.disabled
    && previous.bottom === next.bottom
    && previous.prefillRequest === next.prefillRequest
    && previous.selectedTextContexts === next.selectedTextContexts
    && previous.onRemoveSelectedTextContext === next.onRemoveSelectedTextContext
    && previous.onConsumeSelectedTextContexts === next.onConsumeSelectedTextContexts
    && previous.onSendMessage === next.onSendMessage
    && previous.onStop === next.onStop
    && previousConversation.id === nextConversation.id
    && previousConversation.status === nextConversation.status
    && previousConversation.cwd === nextConversation.cwd
    && previousConversation.projectId === nextConversation.projectId
    && previousConversation.queuedMessages === nextConversation.queuedMessages;
}

const Composer = memo(ComposerImpl, composerPropsEqual);

function ComposerSelectedTextContexts({
  contexts,
  onRemove,
}: {
  contexts: SelectedTextContext[];
  onRemove?: (id: string) => void;
}) {
  return (
    <details className="composer-selected-contexts">
      <summary>
        <MessageSquare size={13} />
        <span>{contexts.length} 个已选文本片段</span>
        <ChevronDown size={12} className="composer-context-chevron" />
      </summary>
      <div className="composer-selected-context-list">
        {contexts.map((context, index) => (
          <div key={context.id} className="composer-selected-context-item">
            <span className="composer-selected-context-index">{index + 1}</span>
            <span className="composer-selected-context-text">{context.text}</span>
            {onRemove && (
              <button
                type="button"
                onClick={() => onRemove(context.id)}
                aria-label={`移除选中文本片段 ${index + 1}`}
              >
                <X size={12} />
              </button>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}

function ComposerQueue({
  queuedMessages,
  onRemove,
  onUpdate,
  onReorder,
  onGuide,
}: {
  queuedMessages: QueuedChatMessage[];
  onRemove: (id: string) => void;
  onUpdate: (id: string, text: string) => void;
  onReorder: (id: string, beforeId: string | null) => void;
  onGuide: (id: string) => Promise<void>;
}) {
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const imeCompositionRef = useRef(false);

  const startEdit = (message: QueuedChatMessage) => {
    setEditingId(message.id);
    setEditingValue(message.text);
    setMenuOpenId(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingValue('');
  };

  const saveEdit = (message: QueuedChatMessage) => {
    const hasAttachments = Boolean(message.attachments?.length);
    if (!editingValue.trim() && !hasAttachments) return;
    onUpdate(message.id, editingValue);
    cancelEdit();
  };

  const dragIdFromEvent = (event: ReactDragEvent<HTMLElement>) =>
    event.dataTransfer.getData('application/x-alpha-queued-message') ||
    event.dataTransfer.getData('text/plain') ||
    draggingId;

  const dropQueuedMessage = (event: ReactDragEvent<HTMLElement>, targetId: string, targetIndex: number) => {
    event.preventDefault();
    const sourceId = dragIdFromEvent(event);
    setDragOverId(null);
    setDraggingId(null);
    if (!sourceId || sourceId === targetId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const insertAfterTarget = event.clientY > rect.top + rect.height / 2;
    const beforeId = insertAfterTarget ? queuedMessages[targetIndex + 1]?.id ?? null : targetId;
    if (sourceId === beforeId) return;
    onReorder(sourceId, beforeId);
  };

  return (
    <div className="composer-queue" aria-label="待发送队列">
      <div className="composer-queue-items">
        {queuedMessages.map((message, index) => {
          const preview = queuedMessagePreview(message);
          const meta = queuedMessageMeta(message);
          const isEditing = editingId === message.id;
          return (
            <div
              key={message.id}
              className={`composer-queue-item ${draggingId === message.id ? 'dragging' : ''} ${dragOverId === message.id ? 'drag-over' : ''} ${isEditing ? 'editing' : ''}`}
              draggable={!isEditing && sendingId === null}
              onDragStart={(event) => {
                setDraggingId(message.id);
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('application/x-alpha-queued-message', message.id);
                event.dataTransfer.setData('text/plain', message.id);
              }}
              onDragEnd={() => {
                setDraggingId(null);
                setDragOverId(null);
              }}
              onDragOver={(event) => {
                if (!draggingId || draggingId === message.id) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                setDragOverId(message.id);
              }}
              onDragLeave={() => setDragOverId((id) => (id === message.id ? null : id))}
              onDrop={(event) => dropQueuedMessage(event, message.id, index)}
            >
              <span className="composer-queue-grip" aria-hidden="true"><GripVertical size={15} /></span>
              <span className="composer-queue-icon"><CornerDownRight size={15} /></span>
              {isEditing ? (
                <>
                  <textarea
                    className="composer-queue-edit"
                    value={editingValue}
                    rows={1}
                    autoFocus
                    onChange={(event) => setEditingValue(event.target.value)}
                    onCompositionStart={() => { imeCompositionRef.current = true; }}
                    onCompositionEnd={() => { imeCompositionRef.current = false; }}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        event.preventDefault();
                        cancelEdit();
                      }
                      if (event.key === 'Enter' && !event.shiftKey && !isImeComposingKeyEvent(event, imeCompositionRef.current)) {
                        event.preventDefault();
                        saveEdit(message);
                      }
                    }}
                  />
                  <div className="composer-queue-edit-actions">
                    <button
                      type="button"
                      onClick={() => saveEdit(message)}
                      disabled={!editingValue.trim() && !message.attachments?.length}
                      aria-label="保存队列消息"
                      title="保存"
                    >
                      <Check size={14} />
                    </button>
                    <button type="button" onClick={cancelEdit} aria-label="取消编辑队列消息" title="取消">
                      <X size={14} />
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <span className="composer-queue-copy">
                    <span className="composer-queue-text" title={preview}>{preview}</span>
                    {meta && <span className="composer-queue-meta">{meta}</span>}
                  </span>
                  <div className="composer-queue-actions">
                    <button
                      type="button"
                      className="composer-queue-guide"
                      disabled={sendingId !== null}
                      onClick={async () => {
                        setSendingId(message.id);
                        setMenuOpenId(null);
                        try { await onGuide(message.id); }
                        finally { setSendingId(null); }
                      }}
                      aria-label={`引导发送队列消息 ${preview}`}
                      title="立即发送到当前对话"
                    >
                      <CornerDownRight size={15} />
                      {sendingId === message.id ? '发送中…' : '引导'}
                    </button>
                    <button
                      type="button"
                      className="composer-queue-remove"
                      disabled={sendingId !== null}
                      onClick={() => onRemove(message.id)}
                      aria-label={`删除队列消息 ${preview}`}
                      title="删除"
                    >
                      <Trash2 size={15} />
                    </button>
                    <span className="composer-queue-more-wrap">
                      <button
                        type="button"
                        className="composer-queue-more"
                        disabled={sendingId !== null}
                        onClick={() => setMenuOpenId((id) => (id === message.id ? null : message.id))}
                        aria-label={`更多队列操作 ${preview}`}
                        aria-haspopup="menu"
                        aria-expanded={menuOpenId === message.id}
                        title="更多"
                      >
                        <MoreHorizontal size={16} />
                      </button>
                      {menuOpenId === message.id && (
                        <span className="composer-queue-menu" role="menu">
                          <button type="button" role="menuitem" onClick={() => startEdit(message)}>
                            <Pencil size={15} />
                            编辑消息
                          </button>
                          <button type="button" role="menuitem" onClick={() => { setMenuOpenId(null); onRemove(message.id); }}>
                            <CornerDownRight size={15} />
                            关闭排队
                          </button>
                        </span>
                      )}
                    </span>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function queuedMessagePreview(message: QueuedChatMessage): string {
  const text = message.text.trim();
  if (text) return text;
  const attachments = message.attachments ?? [];
  if (attachments.length === 1) return attachments[0].name;
  if (attachments.length > 1) return `${attachments.length} 个附件`;
  return '待发送消息';
}

function queuedMessageMeta(message: QueuedChatMessage): string {
  const parts: string[] = [];
  if (message.attachments?.length) parts.push(`${message.attachments.length} 附件`);
  if (message.selectedSkill) parts.push(skillInvocationLabel(message.selectedSkill));
  if (message.coworkers?.length) parts.push(`${message.coworkers.length} 同事`);
  return parts.join(' · ');
}

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic', 'avif'];
const TEXT_PREVIEW_EXTENSIONS = [
  'txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'jsonl', 'yaml', 'yml', 'toml', 'xml',
  'html', 'htm', 'css', 'scss', 'js', 'jsx', 'ts', 'tsx', 'py', 'rs', 'go', 'java',
  'kt', 'swift', 'sql', 'sh', 'zsh', 'bash', 'log',
];

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

function isHtmlExt(ext: string): boolean {
  return ext === 'html' || ext === 'htm';
}

function isBrowserPreviewExt(ext: string): boolean {
  return isHtmlExt(ext) || ext === 'pdf';
}

function isTextPreviewExt(ext: string): boolean {
  return TEXT_PREVIEW_EXTENSIONS.includes(ext);
}

function fileTone(ext: string): string {
  return FILE_TONES[ext] ?? 'gray';
}

function fileTypeLabel(ext: string): string {
  return ext ? ext.toUpperCase() : '文件';
}

function fileGlyph(ext: string, size: number): ReactNode {
  if (fileTone(ext) === 'green') return <FileSpreadsheet size={size} />;
  if (['html', 'htm', 'css', 'js', 'jsx', 'ts', 'tsx', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'sh'].includes(ext)) return <FileCode2 size={size} />;
  if (['json', 'jsonl', 'yaml', 'yml', 'toml'].includes(ext)) return <Braces size={size} />;
  if (['md', 'markdown', 'txt'].includes(ext)) return <FileText size={size} />;
  if (FILE_TONES[ext]) return <FileText size={size} />;
  return <File size={size} />;
}

function createAttachmentId(): string {
  return `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// Browser-preview fallback: the file picker yields File objects, so we can build
// an object URL for instant image thumbnails.
function buildAttachmentFromFile(file: File, displayName = file.name): MessageAttachment {
  const name = displayName;
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

const PASTED_MIME_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/csv': 'csv',
};

function filesFromClipboard(clipboardData: DataTransfer): File[] {
  const files = Array.from(clipboardData.files ?? []);
  if (files.length > 0) return files;
  return Array.from(clipboardData.items ?? [])
    .filter((item) => item.kind === 'file')
    .flatMap((item) => {
      const file = item.getAsFile();
      return file ? [file] : [];
    });
}

function pastedFileName(file: File, index: number): string {
  const existing = file.name.trim();
  if (existing) return existing;
  const ext = PASTED_MIME_EXTENSIONS[file.type.toLowerCase()] || 'bin';
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
  const prefix = file.type.startsWith('image/') ? 'pasted-image' : 'pasted-file';
  return `${prefix}-${timestamp}${index > 0 ? `-${index + 1}` : ''}.${ext}`;
}

function fileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('无法读取剪贴板附件'));
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const separator = result.indexOf(',');
      if (separator < 0) {
        reject(new Error('无法编码剪贴板附件'));
        return;
      }
      resolve(result.slice(separator + 1));
    };
    reader.readAsDataURL(file);
  });
}

// Clipboard File objects do not expose a usable absolute path. On desktop we
// persist their bytes first so Codex receives a real local image/file path.
async function buildAttachmentFromPastedFile(file: File, index: number): Promise<MessageAttachment> {
  const name = pastedFileName(file, index);
  if (!isTauriRuntime()) return buildAttachmentFromFile(file, name);
  const data = await fileAsBase64(file);
  const path = await invoke<string>('clipboard_attachment_save', { request: { name, data } });
  return buildAttachmentFromPath(path);
}

// Desktop: the dialog returns absolute paths; image previews are copied into a
// bounded data URL so the webview never receives broad filesystem protocol access.
async function buildAttachmentFromPath(path: string, isDirectory = false): Promise<MessageAttachment> {
  const name = basename(path);
  if (isDirectory) {
    return { id: createAttachmentId(), name, kind: 'directory', ext: '', path };
  }
  const ext = extOf(name);
  const kind: MessageAttachment['kind'] = isImageExt(ext) ? 'image' : 'file';
  let previewUrl: string | undefined;
  if (kind === 'image') {
    previewUrl = await localImageDataUrl(path) || undefined;
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
      <div className="att-thumb">
        <button
          type="button"
          className="att-thumb-preview"
          title={`查看原图 · ${attachment.name}`}
          aria-label={`查看图片 ${attachment.name}`}
          onClick={() => attachment.previewUrl && openViewer(attachment.previewUrl, attachment.name)}
        >
          <img src={attachment.previewUrl} alt={attachment.name} onError={() => setPreviewFailed(true)} />
        </button>
        <button type="button" className="att-remove" onClick={onRemove} aria-label={`移除 ${attachment.name}`}><X size={12} /></button>
      </div>
    );
  }
  return (
    <div className={`att-card tone-${fileTone(attachment.ext)}`} title={attachment.path || attachment.name}>
      <span className="att-icon">{attachment.kind === 'directory' ? <Folder size={18} /> : attachment.kind === 'image' ? <ImageIcon size={18} /> : fileGlyph(attachment.ext, 18)}</span>
      <span className="att-info">
        <span className="att-name">{attachment.name}</span>
        <span className="att-type">{attachment.kind === 'directory' ? '文件夹路径' : attachment.kind === 'image' ? '图片文件' : `${fileTypeLabel(attachment.ext)}路径`}</span>
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
        <span key={attachment.id} className={`att-pill tone-${fileTone(attachment.ext)}`} title={attachment.path || attachment.name}>
          <span className="att-pill-icon">{attachment.kind === 'directory' ? <Folder size={13} /> : fileGlyph(attachment.ext, 13)}</span>
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
      aria-label={`查看图片 ${attachment.name}`}
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

function MarkdownLink({
  href,
  children,
  node: _node,
  className,
  onClick,
  onContextMenu,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { node?: unknown }) {
  const openBrowserUrl = useBrowserDockOpener();
  const openFileInDock = useFileDockOpener();
  const [contextMenuAnchor, setContextMenuAnchor] = useState<MenuAnchor | null>(null);
  const target = typeof href === 'string' ? href : '';
  const fileExt = markdownLinkFileExt(target);
  const localPath = target ? localFilePath(target) || (target.startsWith('/') ? target : null) : null;
  const fileLink = Boolean(fileExt && isRenderableFileLink(target, fileExt));
  const browserFileLink = isBrowserPreviewExt(fileExt);
  const canOpenInDock = Boolean(!localPath && openBrowserUrl && normalizeBrowserDockUrl(target));
  const linkClassName = [className, fileLink ? 'markdown-file-link' : null].filter(Boolean).join(' ') || undefined;
  const handleClick = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (localPath) {
      event.preventDefault();
      if (browserFileLink && openBrowserUrl) openBrowserUrl(localPath);
      else if (openFileInDock) openFileInDock(localPath);
      else void revealPath(localPath);
      return;
    }
    if (!canOpenInDock || !openBrowserUrl) return;
    event.preventDefault();
    openBrowserUrl(target);
  };
  const handleContextMenu = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    onContextMenu?.(event);
    if (event.defaultPrevented || !localPath) return;
    event.preventDefault();
    event.stopPropagation();
    setContextMenuAnchor(anchorFromCursor(event));
  };

  return (
    <>
      <a {...props} href={href} className={linkClassName} onClick={handleClick} onContextMenu={handleContextMenu}>
        {fileLink && fileExt ? <span className={`markdown-file-icon tone-${fileTone(fileExt)}`}>{fileGlyph(fileExt, 15)}</span> : null}
        {fileLink ? <span className="markdown-link-text">{children}</span> : children}
      </a>
      {contextMenuAnchor && localPath ? (
        <FileContextMenu
          anchor={contextMenuAnchor}
          path={localPath}
          name={basename(localPath)}
          ext={fileExt}
          openFileInDock={openFileInDock}
          openBrowserUrl={openBrowserUrl}
          onClose={() => setContextMenuAnchor(null)}
        />
      ) : null}
    </>
  );
}

function markdownLinkFileExt(href: string): string {
  if (!href) return '';
  const localPath = localFilePath(href);
  if (localPath) return extOf(localPath);
  try {
    const baseUrl = typeof window !== 'undefined' ? window.location.href : 'http://localhost/';
    return extOf(decodeURIComponent(new URL(href, baseUrl).pathname));
  } catch {
    return extOf(decodeURIComponent(href.split(/[?#]/)[0]));
  }
}

function isRenderableFileLink(href: string, ext: string): boolean {
  if (!ext) return false;
  const localish = href.startsWith('/') || href.startsWith('file://') || /^\.{1,2}\//.test(href);
  if (localish) return true;
  if (/^https?:\/\//i.test(href)) {
    return ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'ppt', 'pptx', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'zip'].includes(ext);
  }
  return ['pdf', 'md', 'markdown', 'html', 'htm', 'json', 'csv', 'xlsx', 'docx', 'png', 'jpg', 'jpeg'].includes(ext);
}

const LOCAL_FILE_REFERENCE_PATTERN = /(?:^|[\s"'(=：|])((?:file:\/\/\/|~\/|\/)[^\s"'<>`|]+?\.[A-Za-z0-9]{1,10})(?=$|[\s"'<>`|),.;，。])/g;

function generatedFilesFromPlainText(text: string): GeneratedFile[] {
  const seen = new Set<string>();
  const files: GeneratedFile[] = [];
  for (const match of text.matchAll(LOCAL_FILE_REFERENCE_PATTERN)) {
    const raw = stripTrailingFilePunctuation(match[1] || '');
    const path = localFilePath(raw) || raw;
    const ext = extOf(path);
    if (!path || !isRenderableFileLink(path, ext) || seen.has(path)) continue;
    seen.add(path);
    const name = basename(path);
    files.push({
      id: `inline-file-${files.length}-${path}`,
      path,
      name,
      ext,
      kind: isImageExt(ext) ? 'image' : 'file',
    });
  }
  return files;
}

// The runtime may emit a file_result block and then mention the same path in
// prose. Collect both sources in transcript order so each response can finish
// with one deduplicated artifact handoff instead of repeated inline cards.
function generatedFilesFromMessageBlocks(blocks: MessageBlock[], includeTextReferences = true): GeneratedFile[] {
  const files = new Map<string, GeneratedFile>();
  const remember = (file: GeneratedFile) => {
    if (isRemoteHtmlPage(file)) return;
    const path = localFilePath(file.path) || file.path;
    const key = path.trim();
    if (!key || files.has(key)) return;
    files.set(key, { ...file, path });
  };

  for (const block of blocks) {
    if (block.type === 'text' && includeTextReferences) {
      generatedFilesFromPlainText(block.content).forEach(remember);
    } else if (block.type === 'file_result') {
      block.files.forEach(remember);
    }
  }

  return [...files.values()];
}

function stripTrailingFilePunctuation(path: string): string {
  return path.trim().replace(/[),.;，。]+$/g, '');
}

const MARKDOWN_CODE_COLLAPSE_LINES = 12;
const MARKDOWN_CODE_COLLAPSE_CHARACTERS = 1_200;

function markdownCodeText(children: ReactNode): string {
  return Children.toArray(children).map((child) => {
    if (typeof child === 'string' || typeof child === 'number') return String(child);
    if (isValidElement<{ children?: ReactNode }>(child)) return markdownCodeText(child.props.children);
    return '';
  }).join('').replace(/\n$/, '');
}

function markdownCodeLanguage(children: ReactNode): string {
  for (const child of Children.toArray(children)) {
    if (!isValidElement<{ className?: string }>(child)) continue;
    const language = child.props.className?.match(/(?:^|\s)language-([^\s]+)/)?.[1];
    if (language) return language;
  }
  return '';
}

function MarkdownCodeBlock({ node: _node, children, ...props }: HTMLAttributes<HTMLPreElement> & { node?: unknown }) {
  const code = markdownCodeText(children);
  const language = markdownCodeLanguage(children);
  const lineCount = code ? code.split('\n').length : 0;
  const collapsible = lineCount > MARKDOWN_CODE_COLLAPSE_LINES || code.length > MARKDOWN_CODE_COLLAPSE_CHARACTERS;
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyResetTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (copyResetTimer.current !== null) window.clearTimeout(copyResetTimer.current);
  }, []);
  const handleCopy = async () => {
    if (!await tryCopyToClipboard(code)) return;
    setCopied(true);
    if (copyResetTimer.current !== null) window.clearTimeout(copyResetTimer.current);
    copyResetTimer.current = window.setTimeout(() => {
      setCopied(false);
      copyResetTimer.current = null;
    }, 1_800);
  };
  const stateClass = collapsible ? (expanded ? 'is-expanded' : 'is-collapsed') : 'is-static';

  return (
    <div className={`markdown-code-block ${stateClass}`} role="group" aria-label={`代码块，共 ${lineCount} 行`}>
      <div className="markdown-code-head">
        <span className="markdown-code-kind"><Code2 size={12} />{language ? language.toUpperCase() : 'CODE / DATA'}</span>
        <span className="markdown-code-lines">{lineCount} 行</span>
        <span className="markdown-code-actions">
          <button
            type="button"
            className={`markdown-code-action${copied ? ' copied' : ''}`}
            onClick={() => void handleCopy()}
            aria-label={copied ? '代码已复制' : '复制代码'}
            title={copied ? '已复制' : '复制代码'}
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
          </button>
          {collapsible && (
            <button
              type="button"
              className="markdown-code-toggle"
              onClick={() => setExpanded((current) => !current)}
              aria-expanded={expanded}
              aria-label={expanded ? '收起代码' : '展开代码'}
            >
              {expanded ? <ChevronsDownUp size={12} /> : <ChevronsUpDown size={12} />}
              {expanded ? '收起' : '展开'}
            </button>
          )}
        </span>
      </div>
      <div className="markdown-code-body">
        <pre {...props}>{children}</pre>
      </div>
    </div>
  );
}

const MARKDOWN_COMPONENTS: Components = {
  img: MarkdownImage,
  a: MarkdownLink,
  pre: MarkdownCodeBlock,
  p: ({ node: _node, children, ...props }) => <p {...props}>{inlineStockChildren(children)}</p>,
  li: ({ node: _node, children, ...props }) => <li {...props}>{inlineStockChildren(children)}</li>,
  td: ({ node: _node, children, ...props }) => <td {...props}>{inlineStockChildren(children)}</td>,
  th: ({ node: _node, children, ...props }) => <th {...props}>{inlineStockChildren(children)}</th>,
  strong: ({ node: _node, children, ...props }) => <strong {...props}>{inlineStockChildren(children)}</strong>,
  em: ({ node: _node, children, ...props }) => <em {...props}>{inlineStockChildren(children)}</em>,
};

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

function GeneratedFileResultView({ block, grouped = false }: { block: Extract<MessageBlock, { type: 'file_result' }>; grouped?: boolean }) {
  // Remote HTML pages are web links, not generated local artifacts. Older
  // persisted conversations may already contain false-positive file blocks for
  // source pages whose titles included words such as “文件”. Hide them here as
  // well as preventing new ones in codexEvents.ts.
  const candidates = useMemo(
    () => block.files.filter((file) => !isRemoteHtmlPage(file)),
    [block.files],
  );
  const [files, setFiles] = useState(candidates);
  useEffect(() => {
    setFiles(candidates);
    if (!isTauriRuntime()) return;
    let cancelled = false;
    void Promise.all(candidates.map(async (file) => {
      if (/^https?:\/\//i.test(file.path)) return file;
      const path = localFilePath(file.path) || file.path;
      return await localFileExists(path) ? file : null;
    })).then((checked) => {
      if (!cancelled) setFiles(checked.filter((file): file is GeneratedFile => Boolean(file)));
    });
    return () => {
      cancelled = true;
    };
  }, [candidates]);
  if (files.length === 0) return null;
  return (
    <section className={`generated-file-result ${grouped ? 'message-deliverables' : ''}`} aria-label={block.title}>
      {grouped && (
        <header className="message-deliverables-head">
          <span className="message-deliverables-title"><Paperclip size={12} />交付文件</span>
          <span className="message-deliverables-count">{String(files.length).padStart(2, '0')}</span>
        </header>
      )}
      <div className="generated-file-list">
        {files.map((file) => <GeneratedFileCard key={file.id} file={file} />)}
      </div>
    </section>
  );
}

function isRemoteHtmlPage(file: GeneratedFile): boolean {
  return /^https?:\/\//i.test(file.path) && ['html', 'htm'].includes(file.ext.toLowerCase());
}

const PREVIEW_APP_EXTENSIONS = new Set(['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'heic']);
const TEXT_CLIPBOARD_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'json', 'jsonl', 'csv', 'tsv', 'html', 'htm', 'css', 'js', 'jsx', 'ts', 'tsx',
  'py', 'rs', 'go', 'java', 'kt', 'swift', 'sh', 'zsh', 'bash', 'yaml', 'yml', 'toml', 'xml', 'sql', 'log',
]);

function FileContextMenu({
  anchor,
  path,
  name,
  ext,
  openFileInDock,
  openBrowserUrl,
  onClose,
}: {
  anchor: MenuAnchor;
  path: string;
  name: string;
  ext: string;
  openFileInDock?: ((path: string) => void) | null;
  openBrowserUrl?: ((url: string) => void) | null;
  onClose: () => void;
}) {
  const [apps, setApps] = useState<OpenAppId[]>([]);
  const remote = /^https?:\/\//i.test(path);

  useEffect(() => {
    if (remote) return;
    let cancelled = false;
    void listOpenApps()
      .then((list) => {
        if (!cancelled) setApps(list);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [remote]);

  const runAsync = (action: () => void | Promise<void>) => () => {
    void Promise.resolve(action()).catch((error) => {
      console.warn(`File action failed for ${name}:`, error);
    });
  };
  const openFile = async () => {
    if (remote) {
      await openExternal(path);
      return;
    }
    if (isBrowserPreviewExt(ext) && openBrowserUrl) {
      openBrowserUrl(path);
      return;
    }
    if (openFileInDock) {
      openFileInDock(path);
      return;
    }
    if (!(await openLocalPath(path))) await openExternal(path);
  };
  const copyContents = async () => {
    if (remote) {
      await copyToClipboard(path);
      return;
    }
    if (TEXT_CLIPBOARD_EXTENSIONS.has(ext.toLowerCase())) {
      const file = await localTextFileRead(path);
      if (file.truncated) throw new Error('文件超过 2 MB，无法完整复制内容。');
      await copyToClipboard(file.content);
      return;
    }
    await copyLocalFileToClipboard(path);
  };

  const previewAvailable = !remote && PREVIEW_APP_EXTENSIONS.has(ext.toLowerCase());
  const appTargets = FILE_OPEN_APP_ORDER.filter((id) => apps.includes(id) || (id === 'preview' && previewAvailable));
  const items: MenuNode[] = [
    { kind: 'item', icon: <File size={15} />, label: '打开文件', onSelect: runAsync(openFile) },
  ];
  if (previewAvailable) {
    items.push({
      kind: 'item',
      icon: <span className="open-app-icon compact" style={{ background: OPEN_APP_META.preview.color }} aria-hidden="true">{OPEN_APP_META.preview.glyph}</span>,
      label: '在 Preview 中打开',
      onSelect: runAsync(() => openInApp('preview', path)),
    });
  }
  if (!remote && appTargets.length > 0) {
    items.push({
      kind: 'submenu',
      icon: <AppWindow size={15} />,
      label: '打开方式',
      children: appTargets.map((id) => ({
        kind: 'item',
        icon: <span className="open-app-icon compact" style={{ background: OPEN_APP_META[id].color }} aria-hidden="true">{OPEN_APP_META[id].glyph}</span>,
        label: OPEN_APP_META[id].label,
        onSelect: runAsync(() => openInApp(id, path)),
      })),
    });
  }
  items.push(
    { kind: 'separator' },
    { kind: 'item', icon: <Copy size={15} />, label: remote ? '复制链接' : '复制路径', onSelect: runAsync(() => copyToClipboard(path)) },
    { kind: 'item', icon: <FileText size={15} />, label: '复制文件内容', onSelect: runAsync(copyContents) },
  );
  if (!remote) {
    items.push({
      kind: 'item',
      icon: <FolderOpen size={15} />,
      label: '在 Finder 中显示',
      onSelect: runAsync(async () => { await revealPath(path); }),
    });
  }

  return (
    <ContextMenu
      menu={{ owner: `file-context:${path}`, x: anchor.x, y: anchor.y, items }}
      onClose={onClose}
    />
  );
}

function GeneratedFileCard({ file }: { file: GeneratedFile }) {
  const openFileInDock = useFileDockOpener();
  const openBrowserUrl = useBrowserDockOpener();
  const [contextMenuAnchor, setContextMenuAnchor] = useState<MenuAnchor | null>(null);
  const openDefault = () => {
    void openGeneratedFileDefault(file, openFileInDock, openBrowserUrl);
  };
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openDefault();
  };
  return (
    <div
      className="generated-file-card clickable"
      role="button"
      tabIndex={0}
      aria-label={`打开 ${file.name}`}
      onClick={openDefault}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setContextMenuAnchor(anchorFromCursor(event));
      }}
      onKeyDown={handleKeyDown}
    >
      <span className={`generated-file-icon tone-${fileTone(file.ext)}`}>
        {file.kind === 'image' ? <ImageIcon size={18} /> : fileGlyph(file.ext, 18)}
      </span>
      <span className="generated-file-main">
        <strong>{file.name}</strong>
        <span>{generatedFileTypeLabel(file)}</span>
      </span>
      <GeneratedFileOpenMenu file={file} openFileInDock={openFileInDock} openBrowserUrl={openBrowserUrl} />
      {contextMenuAnchor ? (
        <FileContextMenu
          anchor={contextMenuAnchor}
          path={localFilePath(file.path) || file.path}
          name={file.name}
          ext={file.ext}
          openFileInDock={openFileInDock}
          openBrowserUrl={openBrowserUrl}
          onClose={() => setContextMenuAnchor(null)}
        />
      ) : null}
    </div>
  );
}

function generatedFileTypeLabel(file: GeneratedFile): string {
  const type = fileTypeLabel(file.ext);
  return file.kind === 'image' ? `图像 · ${type}` : `文档 · ${type}`;
}

async function openGeneratedFileDefault(
  file: GeneratedFile,
  openFileInDock?: ((path: string) => void) | null,
  openBrowserUrl?: ((url: string) => void) | null,
): Promise<void> {
  const remote = /^https?:\/\//i.test(file.path);
  const path = localFilePath(file.path) || file.path;
  if (isBrowserPreviewExt(file.ext) && openBrowserUrl) {
    openBrowserUrl(path);
    return;
  }
  if (remote) {
    await openExternal(file.path);
    return;
  }
  if (openFileInDock) {
    openFileInDock(path);
    return;
  }
  await revealPath(path);
}

function GeneratedFileOpenMenu({
  file,
  openFileInDock,
  openBrowserUrl,
}: {
  file: GeneratedFile;
  openFileInDock?: ((path: string) => void) | null;
  openBrowserUrl?: ((url: string) => void) | null;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<CSSProperties>({ top: 0, left: 0 });
  const [apps, setApps] = useState<OpenAppId[]>([]);
  const [error, setError] = useState<string | null>(null);
  const path = localFilePath(file.path) || file.path;
  const remote = /^https?:\/\//i.test(file.path);
  const browserPreview = isBrowserPreviewExt(file.ext);

  useEffect(() => {
    if (!open) return;
    const handleClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [open]);

  const updateMenuPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const menu = menuRef.current;
    const viewportPadding = 12;
    const gap = 6;
    const menuWidth = menu?.offsetWidth || 224;
    const menuHeight = menu?.offsetHeight || 280;
    const maxLeft = Math.max(viewportPadding, window.innerWidth - menuWidth - viewportPadding);
    const left = Math.min(maxLeft, Math.max(viewportPadding, rect.right - menuWidth));
    const belowTop = rect.bottom + gap;
    const aboveTop = rect.top - menuHeight - gap;
    const preferredTop = belowTop + menuHeight <= window.innerHeight - viewportPadding || aboveTop < viewportPadding
      ? belowTop
      : aboveTop;
    const maxTop = Math.max(viewportPadding, window.innerHeight - menuHeight - viewportPadding);
    const top = Math.min(maxTop, Math.max(viewportPadding, preferredTop));
    setMenuPosition({ left, top });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updateMenuPosition();
    const handleUpdate = () => updateMenuPosition();
    window.addEventListener('resize', handleUpdate);
    window.addEventListener('scroll', handleUpdate, true);
    return () => {
      window.removeEventListener('resize', handleUpdate);
      window.removeEventListener('scroll', handleUpdate, true);
    };
  }, [open, updateMenuPosition]);

  useEffect(() => {
    if (!open || remote) return;
    let cancelled = false;
    void listOpenApps()
      .then((list) => {
        if (!cancelled) setApps(list);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, remote]);

  const choose = (action: () => void | Promise<void>) => {
    setOpen(false);
    void Promise.resolve(action()).catch((err) => {
      setError(stringifyError(err));
      window.setTimeout(() => setError(null), 4000);
    });
  };

  const appTargets = FILE_OPEN_APP_ORDER.filter((id) => apps.includes(id));

  useLayoutEffect(() => {
    if (open) updateMenuPosition();
  }, [open, appTargets.length, error, updateMenuPosition]);

  const menu = open ? createPortal(
    <div
      ref={menuRef}
      className="generated-file-menu"
      role="menu"
      style={menuPosition}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {browserPreview && openBrowserUrl ? (
        <button type="button" role="menuitem" onClick={() => choose(() => openBrowserUrl(path))}>
          <span className="generated-file-menu-icon"><Globe size={15} /></span>
          <span>侧边浏览器</span>
        </button>
      ) : !remote && openFileInDock ? (
        <button type="button" role="menuitem" onClick={() => choose(() => openFileInDock(path))}>
          <span className="generated-file-menu-icon"><PanelRight size={15} /></span>
          <span>侧边栏预览</span>
        </button>
      ) : null}
      {!remote && (
        <>
          <button type="button" role="menuitem" onClick={() => choose(async () => { if (!(await openLocalPath(path))) await openExternal(path); })}>
            <span className="generated-file-menu-icon"><AppWindow size={15} /></span>
            <span>Default app</span>
          </button>
          {appTargets.map((id) => (
            <button key={id} type="button" role="menuitem" aria-label={OPEN_APP_META[id].label} onClick={() => choose(() => openInApp(id, path))}>
              <span className="open-app-icon" style={{ background: OPEN_APP_META[id].color }}>{OPEN_APP_META[id].glyph}</span>
              <span>{OPEN_APP_META[id].label}</span>
            </button>
          ))}
          <button type="button" role="menuitem" aria-label="Terminal" onClick={() => choose(() => openInApp('terminal', path))}>
            <span className="open-app-icon" style={{ background: OPEN_APP_META.terminal.color }}>{OPEN_APP_META.terminal.glyph}</span>
            <span>Terminal</span>
          </button>
          <div className="generated-file-menu-divider" />
          <button type="button" role="menuitem" aria-label="在 Finder 中显示" onClick={() => choose(async () => { await revealPath(path); })}>
            <span className="open-app-icon" style={{ background: OPEN_APP_META.finder.color }}>{OPEN_APP_META.finder.glyph}</span>
            <span>在 Finder 中显示</span>
          </button>
        </>
      )}
      {remote && (
        <button type="button" role="menuitem" onClick={() => choose(() => openExternal(file.path))}>
          <span className="generated-file-menu-icon"><Globe size={15} /></span>
          <span>浏览器打开</span>
        </button>
      )}
      {error && <div className="generated-file-menu-error"><AlertCircle size={13} />{error}</div>}
    </div>,
    document.body,
  ) : null;

  return (
    <div
      ref={rootRef}
      className="generated-file-actions"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <button
        ref={triggerRef}
        type="button"
        className={`generated-file-open ${open ? 'active' : ''}`}
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${file.name} 打开方式`}
        title="打开方式"
      >
        <span>打开</span>
        <ChevronDown size={13} />
      </button>
      {menu}
    </div>
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

// The "+" composer menu: attach files and browse plugins.
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
  const { catalog, status } = useSkillRuntime();
  const [open, setOpen] = useState(false);
  const [submenu, setSubmenu] = useState<'plugins' | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ left: number; bottom: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    setSubmenu(null);
  };

  useLayoutEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const triggerRect = trigger.getBoundingClientRect();
      const menuWidth = 244;
      const viewportGap = 12;
      const triggerGap = 8;
      setMenuPosition({
        left: Math.min(Math.max(viewportGap, triggerRect.left), window.innerWidth - menuWidth - viewportGap),
        bottom: Math.max(viewportGap, window.innerHeight - triggerRect.top + triggerGap),
      });
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open]);

  const pickFiles = async () => {
    close();
    const items = await pickAttachments();
    if (items.length) onAttach(items);
  };
  const chooseSkill = (skill: SkillCatalogItem) => {
    onSelectSkill(skill);
    close();
  };
  const installedSkills = catalog.filter((skill) => {
    const current = status[skill.id] ?? { installed: skill.installed, enabled: skill.installed };
    return current.installed && current.enabled;
  });

  return (
    <div className="plus-picker">
      <button
        ref={triggerRef}
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
      {open && createPortal(
        <>
          <button className="menu-backdrop" type="button" aria-label="关闭菜单" onClick={close} />
          <div
            className="plus-menu fixed"
            role="menu"
            style={menuPosition ? { left: menuPosition.left, bottom: menuPosition.bottom } : undefined}
            onMouseLeave={() => setSubmenu(null)}
          >
            <button type="button" className="plus-menu-item" role="menuitem" onMouseEnter={() => setSubmenu(null)} onClick={() => void pickFiles()}>
              <Paperclip size={15} />
              <span>添加照片和文件</span>
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
                <span>技能</span>
                <ChevronRight size={14} className="model-menu-chevron" />
              </button>
              {submenu === 'plugins' && (
                <div className="plus-flyout">
                  <div className="model-flyout-panel" role="menu">
                    <div className="model-menu-label">{installedSkills.length} 个已安装 Skill</div>
                    {installedSkills.map((skill) => (
                      <button key={skill.id} type="button" className="plus-plugin-row selectable" role="menuitem" onClick={() => chooseSkill(skill)}>
                        <span className={`plus-plugin-icon skill-icon-${skill.icon}`}>{skillIcon(skill, 14)}</span>
                        <span>{`$${skill.id}`}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      , document.body)}
    </div>
  );
}

// The data-directory control in the composer toolbar doubles as a switcher: it
// lists existing research folders and lets a conversation bind local materials.
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
  return (
    <div className="composer-meta">
      <DirectoryPicker conversation={conversation} />
    </div>
  );
}

const FLOATING_MENU_MARGIN = 8;
const FLOATING_MENU_GAP = 6;
const HIDDEN_FLOATING_STYLE: CSSProperties = { visibility: 'hidden' };

function clampFloatingPosition(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, Math.max(min, max)));
}

function codexSubscriptionModelsVisible(codexStatus: { loggedIn: boolean } | null, session: ClientLicenseSession | null): boolean {
  if (session && (!session.tenant.codexSubscriptionEnabled || session.codexAccounts.length === 0)) return false;
  return !isTauriRuntime() || codexStatus?.loggedIn !== false;
}

function visibleModelProfilesForCodexStatus(profiles: ModelProfile[], codexStatus: { loggedIn: boolean } | null, session: ClientLicenseSession | null): ModelProfile[] {
  if (codexSubscriptionModelsVisible(codexStatus, session)) return profiles;
  return profiles.filter((profile) => !profile.builtIn);
}

function resolveVisibleModelProfile(profiles: ModelProfile[], selectedId: string, codexStatus: { loggedIn: boolean } | null, session: ClientLicenseSession | null): ModelProfile {
  const visibleProfiles = visibleModelProfilesForCodexStatus(profiles, codexStatus, session).filter((profile) => profile.enabled);
  return visibleProfiles.find((profile) => profile.id === selectedId) ?? visibleProfiles[0] ?? resolveModelProfile(profiles, selectedId);
}

function ModelPicker() {
  const selectedModelProfileId = useChatStore((state) => state.selectedModelProfileId);
  const modelProfiles = useChatStore((state) => state.modelProfiles);
  const codexStatus = useChatStore((state) => state.codexStatus);
  const clientLicenseSession = useChatStore((state) => state.clientLicenseSession);
  const refreshClientLicenseSession = useChatStore((state) => state.refreshClientLicenseSession);
  const isRefreshingClientLicense = useChatStore((state) => state.isRefreshingClientLicense);
  const refreshCodexModels = useChatStore((state) => state.refreshCodexModels);
  const isRefreshingCodexModels = useChatStore((state) => state.isRefreshingCodexModels);
  const reasoningEffort = useChatStore((state) => state.reasoningEffort);
  const speed = useChatStore((state) => state.speed);
  const setModelProfile = useChatStore((state) => state.setModelProfile);
  const setReasoningEffort = useChatStore((state) => state.setReasoningEffort);
  const setSpeed = useChatStore((state) => state.setSpeed);
  const [open, setOpen] = useState(false);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const optionsAnchorRef = useRef<HTMLButtonElement | null>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>(HIDDEN_FLOATING_STYLE);
  const [flyoutStyle, setFlyoutStyle] = useState<CSSProperties>(HIDDEN_FLOATING_STYLE);
  const enabledProfiles = modelProfiles.filter((profile) => profile.enabled);
  const visibleEnabledProfiles = visibleModelProfilesForCodexStatus(enabledProfiles, codexStatus, clientLicenseSession);
  const selectedModelProfile = visibleEnabledProfiles.find((profile) => profile.id === selectedModelProfileId) ?? visibleEnabledProfiles[0] ?? resolveModelProfile(modelProfiles, selectedModelProfileId);
  const builtInProfiles = visibleEnabledProfiles.filter((profile) => profile.builtIn);
  const customProfiles = visibleEnabledProfiles.filter((profile) => !profile.builtIn);
  const editingProfile = visibleEnabledProfiles.find((profile) => profile.id === editingProfileId) ?? null;
  const effortOptions = useMemo(
    () => reasoningEffortOptionsForProfile(editingProfile ?? selectedModelProfile),
    [editingProfile, selectedModelProfile],
  );
  const speedOptions = editingProfile?.supportsFastMode
    ? SPEED_OPTIONS
    : SPEED_OPTIONS.filter((option) => option.id === 'standard');
  const selectedEffortOptions = useMemo(
    () => reasoningEffortOptionsForProfile(selectedModelProfile),
    [selectedModelProfile],
  );
  const refreshManagedModels = useCallback(async (includeSubscriptionModels = false) => {
    const requests: Promise<unknown>[] = [];
    if (clientLicenseSession) requests.push(refreshClientLicenseSession());
    if (includeSubscriptionModels && codexStatus?.loggedIn) requests.push(refreshCodexModels(true));
    await Promise.allSettled(requests);
  }, [clientLicenseSession, codexStatus?.loggedIn, refreshClientLicenseSession, refreshCodexModels]);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) void refreshManagedModels();
  };
  const close = () => {
    setOpen(false);
    setEditingProfileId(null);
    optionsAnchorRef.current = null;
  };
  const openOptions = (event: ReactMouseEvent<HTMLButtonElement>, profile: ModelProfile) => {
    event.stopPropagation();
    optionsAnchorRef.current = event.currentTarget;
    setModelProfile(profile.id);
    setEditingProfileId(profile.id);
  };
  const profileSettingSummary = (profile: ModelProfile) => {
    const supportedEfforts = reasoningEffortOptionsForProfile(profile);
    const parts = supportedEfforts.length > 0
      ? [effortLabel(resolveReasoningEffortForProfile(profile, reasoningEffort))]
      : [];
    if (profile.supportsFastMode && speed === 'fast') parts.push('快速');
    return parts.join(' · ');
  };
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
    if (!open || !editingProfile) {
      setFlyoutStyle(HIDDEN_FLOATING_STYLE);
      return;
    }

    const updateFlyoutPosition = () => {
      const rowRect = optionsAnchorRef.current?.closest('.model-choice-row')?.getBoundingClientRect();
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
  }, [open, editingProfile, effortOptions.length, speed]);

  const renderProfile = (profile: ModelProfile) => {
    const selected = profile.id === selectedModelProfile.id;
    const editing = profile.id === editingProfile?.id;
    const summary = profileSettingSummary(profile);
    return (
      <div key={profile.id} className={`model-choice-row ${selected ? 'selected' : ''} ${editing ? 'editing' : ''}`}>
        <button
          type="button"
          role="menuitemradio"
          aria-checked={selected}
          className="model-menu-item model-choice-select"
          onClick={() => { setModelProfile(profile.id); close(); }}
        >
          <span className="model-choice-copy">
            <strong>{profile.label}</strong>
            {summary && <em>{summary}</em>}
          </span>
          {selected && <Check size={14} className="model-menu-check" />}
        </button>
        <button
          type="button"
          className="model-choice-edit"
          aria-label={`编辑 ${profile.label} 的模型选项`}
          aria-haspopup="menu"
          aria-expanded={editing}
          onClick={(event) => openOptions(event, profile)}
        >
          <Pencil size={12} />
          <span>Edit</span>
        </button>
      </div>
    );
  };

  const menuLayer = open ? createPortal(
    <>
      <button className="menu-backdrop" type="button" aria-label="关闭模型菜单" onClick={close} />
      <div ref={menuRef} className="model-menu model-choice-menu model-list-menu" role="menu" aria-label="选择模型" style={menuStyle}>
        <div className="model-list-toolbar">
          <span>模型列表</span>
          <button
            type="button"
            aria-label="刷新模型列表"
            title="从管理后台刷新模型列表"
            disabled={isRefreshingClientLicense || isRefreshingCodexModels}
            onClick={() => void refreshManagedModels(true)}
          >
            <RefreshCw size={13} className={isRefreshingClientLicense || isRefreshingCodexModels ? 'spin' : ''} />
          </button>
        </div>
        <div className="model-menu-divider" />
        {builtInProfiles.length > 0 && <div className="model-menu-label">订阅模型</div>}
        {builtInProfiles.map(renderProfile)}
        {builtInProfiles.length > 0 && customProfiles.length > 0 && <div className="model-menu-divider" />}
        {customProfiles.length > 0 && <div className="model-menu-label">按量模型</div>}
        {customProfiles.map(renderProfile)}
      </div>
      {editingProfile && (
        <div ref={flyoutRef} className="model-flyout model-choice-flyout model-options-flyout" style={flyoutStyle}>
          <div className="model-flyout-panel" role="menu" aria-label={`${editingProfile.label} 模型选项`}>
            <div className="model-options-heading">
              <span>模型选项</span>
              <strong>{editingProfile.label}</strong>
            </div>
            <div className="model-menu-divider" />
            <div className="model-menu-label">思考强度</div>
            {effortOptions.length > 0 ? effortOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                role="menuitemradio"
                aria-checked={option.id === reasoningEffort}
                className="model-menu-item"
                onClick={() => setReasoningEffort(option.id)}
              >
                <span>{option.label}</span>
                {option.id === reasoningEffort && <Check size={14} className="model-menu-check" />}
              </button>
            )) : <div className="model-options-empty">此模型不提供思考强度设置</div>}
            <div className="model-menu-divider" />
            <div className="model-menu-label">速度</div>
            {speedOptions.map((option) => (
              <button key={option.id} type="button" role="menuitemradio" aria-checked={option.id === speed} className="model-menu-item speed-item" onClick={() => setSpeed(option.id as Speed)}>
                <span className="speed-main">
                  {option.fast && <Zap size={13} className="speed-icon" />}
                  <span className="speed-text"><span className="speed-title">{option.label}</span><span className="speed-sub">{option.description}</span></span>
                </span>
                {option.id === speed && <Check size={14} className="model-menu-check" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </>,
    document.body,
  ) : null;
  return (
    <div className="model-picker">
      <button
        ref={triggerRef}
        type="button"
        className={`composer-pill model-pill ${open ? 'active' : ''}`}
        onClick={toggle}
        aria-label={`选择模型，当前为 ${selectedModelProfile.label}`}
        title="选择模型与推理强度"
      >
        {selectedModelProfile.supportsFastMode && speed === 'fast' && <Zap size={12} className="model-pill-fast" />}
        <span className="model-pill-label">{shortModelProfileLabel([selectedModelProfile], selectedModelProfile.id)}</span>
        {selectedEffortOptions.length > 0 && <span className="model-pill-effort">{effortLabel(reasoningEffort)}</span>}
        <ChevronDown size={12} />
      </button>
      {menuLayer}
    </div>
  );
}

function approvalIcon(mode: ApprovalMode, size = 13): ReactNode {
  if (mode === 'request') return <MessageCircleQuestionMark size={size} />;
  if (mode === 'auto') return <ShieldCheck size={size} />;
  return <LockKeyholeOpen size={size} />;
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
  const cwd = useCurrentConversationCwd();
  const conversationStatus = useCurrentConversationStatus();
  const startReview = useChatStore((state) => state.startReview);
  const busy = conversationStatus === 'streaming';
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
    (unit) => unit.type !== 'block' || (unit.block.type !== 'text' && unit.block.type !== 'file_result'),
  );
  return (
    <div className="review-body">
      {units.map((unit) =>
        unit.type === 'command-group'
          ? (unit.blocks.length === 1
              ? <BlockRenderer key={`tool-${unit.startIndex}`} block={unit.blocks[0]} />
              : <CommandGroup key={`cmd-group-${unit.startIndex}`} blocks={unit.blocks} />)
          : unit.type === 'web-search-group'
            ? (unit.blocks.length === 1
                ? <BlockRenderer key={`tool-${unit.startIndex}`} block={unit.blocks[0]} />
                : <WebSearchGroup key={`web-group-${unit.startIndex}`} blocks={unit.blocks} />)
          : unit.type === 'activity-group'
            ? (unit.blocks.length === 1
                ? <BlockRenderer key={`tool-${unit.startIndex}`} block={unit.blocks[0]} />
                : <ActivityGroup key={`activity-group-${unit.startIndex}`} blocks={unit.blocks} kind={unit.kind} />)
          : <BlockRenderer key={`${unit.block.type}-${unit.index}`} block={unit.block} streaming={streaming && unit.index === lastBlockIndex} />,
      )}
      {parsed.prose && (
        <div className={`markdown-content ${streaming && !parsed.report ? 'streaming' : ''}`}>
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>{parsed.prose}</ReactMarkdown>
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
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>{finding.body}</ReactMarkdown>
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
  const cwd = useCurrentConversationCwd();
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
  const cwd = useCurrentConversationCwd();
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
        <SettingsNavGroup label="基础与账户" items={domain.navigation.personal} section={section} onSectionChange={onSectionChange} />
        <SettingsNavGroup label="金融数据" items={domain.navigation.integrations} section={section} onSectionChange={onSectionChange} />
        <SettingsNavGroup label="数据管理" items={domain.navigation.archived} section={section} onSectionChange={onSectionChange} />
      </nav>
      <div className="settings-page-main">
        <div className="settings-page-head" data-tauri-drag-region />
        <div className="settings-page-scroll">
          <div className="settings-content">
            <header className="settings-content-header">
              <h1 className="settings-content-title">{activeLabel}</h1>
            </header>
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
  if (section === 'report-branding') return <ReportBrandingSettings />;
  if (section === 'archived') return <ArchivedSettings />;
  if (section === 'usage') return <UsageSettings />;
  if (section === 'profile') return <ProfileSettings />;
  if (section === 'runtime') return <CodexRuntimeSettings />;
  if (section === 'general') {
    return (
      <SettingsGroup>
        <SettingsRow title="界面主题" description="选择适合阅读研究报告和行情信息的显示方式。">
          <SettingsSegment value={theme} onChange={onThemeChange} options={[{ id: 'light', label: '浅色', icon: <Sun size={13} /> }, { id: 'dark', label: '深色', icon: <Moon size={13} /> }]} />
        </SettingsRow>
        <SettingsRow title="界面语言" description="Alpha Studio 金融版默认使用简体中文。"><span className="settings-static">简体中文</span></SettingsRow>
        <SettingsRow title="首次使用引导" description="重新查看本地数据、大模型服务方、账号安全、备份和费用说明。">
          <button className="settings-btn" type="button" onClick={() => window.dispatchEvent(new Event(OPEN_FIRST_USE_GUIDE_EVENT))}>打开引导</button>
        </SettingsRow>
      </SettingsGroup>
    );
  }
	return null;
}

function CodexRuntimeSettings() {
  const codexStatus = useChatStore((state) => state.codexStatus);
  const isCheckingCodex = useChatStore((state) => state.isCheckingCodex);
  const refreshCodexStatus = useChatStore((state) => state.refreshCodexStatus);
  const hasActiveTask = useChatStore((state) => state.conversations.some((conversation) => conversation.status === 'streaming'));
  const [isUpdating, setIsUpdating] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const handleUpdate = async () => {
    setIsUpdating(true);
    setNotice('');
    setError('');
    try {
      const result = await updateCodexCli();
      await refreshCodexStatus({ forceModelRefetch: true });
      setNotice(result.updated
        ? `已从 ${formatHarnessVersion(result.previousVersion) || '旧版本'} 更新到 ${formatHarnessVersion(result.version)}。`
        : `当前已是最新版本 ${formatHarnessVersion(result.version)}。`);
    } catch (updateError) {
      setError(stringifyError(updateError));
    } finally {
      setIsUpdating(false);
    }
  };

  const version = isCheckingCodex && !codexStatus
    ? '正在检测…'
    : formatHarnessVersion(codexStatus?.version) || '未检测到 Harness';
  const updateDisabled = isUpdating || isCheckingCodex || hasActiveTask || !isTauriRuntime();
  const updateDescription = hasActiveTask
    ? '当前有任务正在运行；任务结束后即可更新，避免中断正在使用的 Harness。'
    : '从官方发布源检查并安装最新版。更新将用于之后启动的任务，内置版本仍作为兜底。';

  return (
    <SettingsGroup>
      <SettingsRow title="当前版本" description="Alpha Studio 目前使用的 Harness 版本。">
        <span className="settings-static codex-runtime-version">{version}</span>
      </SettingsRow>
      <SettingsRow title="手动更新" description={updateDescription}>
        <div className="codex-runtime-update">
          <button className="settings-btn primary" type="button" onClick={() => void handleUpdate()} disabled={updateDisabled}>
            {isUpdating ? <><Loader2 size={13} className="spin" />正在更新…</> : <><Download size={13} />检查并更新</>}
          </button>
          {notice && <span className="codex-runtime-notice" role="status">{notice}</span>}
          {error && <span className="settings-inline-error" role="alert" title={error}>{error}</span>}
        </div>
      </SettingsRow>
    </SettingsGroup>
  );
}

function formatHarnessVersion(version: string | null | undefined): string {
  return version?.trim().replace(/^codex(?:-cli)?\s*/i, '').trim() || '';
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
  const clientLicenseSession = useChatStore((state) => state.clientLicenseSession);
  const refreshCodexStatus = useChatStore((state) => state.refreshCodexStatus);
  const isCheckingCodex = useChatStore((state) => state.isCheckingCodex);
  const modelConfigPath = useChatStore((state) => state.modelConfigPath);
  const isLoadingModelConfig = useChatStore((state) => state.isLoadingModelConfig);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ModelProfileDraft>(EMPTY_MODEL_DRAFT);

  const enabledProfiles = modelProfiles.filter((profile) => profile.enabled);
  const visibleEnabledProfiles = visibleModelProfilesForCodexStatus(enabledProfiles, codexStatus, clientLicenseSession);
  const customProfiles = modelProfiles.filter((profile) => !profile.builtIn && profile.providerId !== ALPHA_GATEWAY_PROVIDER_ID);
  const editingProfile = editingId ? customProfiles.find((profile) => profile.id === editingId) : null;
  const selectedProfile =
    visibleEnabledProfiles.find((profile) => profile.id === selectedModelProfileId) ??
    visibleEnabledProfiles[0] ??
    modelProfiles.find((profile) => profile.id === selectedModelProfileId);
  const selectedProfileId = selectedProfile?.id ?? '';
  const effortOptions = selectedProfile ? reasoningEffortOptionsForProfile(selectedProfile) : [];
  const selectedUsesGateway = selectedProfile?.providerId === ALPHA_GATEWAY_PROVIDER_ID;
  const codexRuntimeReady = Boolean(codexStatus?.installed && (codexStatus.loggedIn || selectedUsesGateway));
  const normalizedDraft = normalizeModelProfileDraft(draft);
  const requiresBaseUrl = normalizedDraft.providerId !== 'openai';
  const canSave = Boolean(normalizedDraft.label && normalizedDraft.model && (!requiresBaseUrl || normalizedDraft.baseUrl));
  const codexRuntimeTitle = codexRuntimeReady
    ? `${selectedUsesGateway && !codexStatus?.loggedIn ? '本地 AI 运行环境可用于按量模型' : '本地 AI 运行环境已就绪'}${codexStatus?.version ? ` · ${formatHarnessVersion(codexStatus.version)}` : ''}`
    : '本地 AI 运行环境未就绪';
  const codexRuntimeDescription = codexStatus?.installed && selectedUsesGateway && !codexStatus.loggedIn
    ? '按量模型无需 GPT 订阅设备授权。'
    : codexStatus?.loggedIn
      ? 'Harness 已连接，可以使用订阅模型。'
      : (codexStatus?.error || '请确认本地 AI 运行环境已安装并完成设备授权。');

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
          <select className="settings-select model-settings-select" value={selectedProfileId} onChange={(event) => setModelProfile(event.target.value)} disabled={visibleEnabledProfiles.length === 0}>
            {visibleEnabledProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}
          </select>
        </SettingsRow>
        {effortOptions.length > 0 && <SettingsRow title="推理强度" description="更高的强度更细致，但响应更慢；这里只显示当前模型支持的档位。">
          <SettingsSegment value={reasoningEffort} onChange={(id) => setReasoningEffort(id as ReasoningEffort)} options={effortOptions} />
        </SettingsRow>}
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
        <div className={`settings-status ${codexRuntimeReady ? 'ready' : 'attention'}`}>
          <span className="settings-status-icon">{isCheckingCodex ? <Loader2 size={16} className="spin" /> : <Terminal size={16} />}</span>
          <div className="settings-status-main">
            <strong>{codexRuntimeTitle}</strong>
            <span>{codexRuntimeDescription}</span>
          </div>
          <span className="settings-status-actions">
            {codexStatus?.installed && !codexStatus.loggedIn && codexSubscriptionModelsVisible(codexStatus, clientLicenseSession) && <CodexLoginButton compact />}
            {codexStatus?.installed && codexStatus.loggedIn && <CodexRevokeButton compact />}
            <button className="settings-btn" type="button" onClick={() => void refreshCodexStatus({ forceModelRefetch: true })} disabled={isCheckingCodex}>重新检测</button>
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
            <span>Chat Completions 会通过 Alpha Studio 本地 adapter 接入 GPT；勾选“启用思考模式”会发送 thinking.enabled，取消勾选会发送 thinking.disabled。</span>
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
  const session = useChatStore((state) => state.clientLicenseSession);
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
      const status = useChatStore.getState().codexStatus;
      if (status?.loggedIn) {
        try {
          if (!session || !status.accountEmail) {
            throw new Error('无法识别 GPT 登录账号，请重新授权。');
          }
          await validateCodexAuthorization(session, status.accountEmail);
          break;
        } catch (authorizationError) {
          await revokeCodexAuthorization();
          await refreshCodexStatus();
          setError(`GPT 授权失败：${stringifyUnknownError(authorizationError)}`);
          setIsWaitingForLogin(false);
          return;
        }
      }
      if (status?.accountEmail && status.error) {
        await revokeCodexAuthorization();
        await refreshCodexStatus();
        setError(status.error);
        setIsWaitingForLogin(false);
        return;
      }
      const shouldContinue = await waitForNextPoll(runId);
      if (!shouldContinue) return;
    }
    if (pollRunRef.current === runId) {
      await refreshCodexStatus();
      const status = useChatStore.getState().codexStatus;
      if (!status?.loggedIn && status?.error) setError(status.error);
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
  const label = isLaunching ? '正在打开授权' : isWaitingForLogin ? '等待授权完成' : '授权 GPT';
  const buttonClassName = stateButton
    ? `settings-state-pill settings-state-button attention ${busy ? 'authorizing' : ''}`
    : 'settings-btn';

  return (
    <span className={`codex-login-action ${compact ? 'compact' : ''}`}>
      <button
        className={buttonClassName}
        type="button"
        aria-label={label}
        title="授权 GPT"
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
            {!busy && <span className="state-hover-label" aria-hidden="true">授权 GPT</span>}
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
        title="撤销 GPT 授权"
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

function DeviceManagement({
  session,
  summary,
  loading,
  error,
  revokingId,
  onRefresh,
  onRevoke,
}: {
  session: ClientLicenseSession;
  summary: ClientDeviceSummary | null;
  loading: boolean;
  error: string;
  revokingId: string | null;
  onRefresh: () => void;
  onRevoke: (device: ClientManagedDevice) => void;
}) {
  const devices = summary?.devices ?? [];
  return (
    <section className="device-management" aria-label="设备管理">
      <div className="device-management-head">
        <div>
          <strong>设备管理</strong>
          <span>
            已安装 {summary?.activeDevices ?? (loading ? '—' : 1)} 台，共可安装 {summary?.maxDevices ?? session.tenant.maxDevices} 台。
            首台安装设备拥有管理员权限。
          </span>
        </div>
        <button
          className="icon-mini"
          type="button"
          onClick={onRefresh}
          disabled={loading}
          aria-label="刷新设备列表"
          title="刷新设备列表"
        >
          <RefreshCw size={14} className={loading ? 'spin' : ''} />
        </button>
      </div>
      {error && <div className="device-management-error"><AlertCircle size={14} />{error}</div>}
      <div className="device-list">
        {devices.map((device) => {
          const active = device.status === 'active';
          const canRevoke = Boolean(summary?.isAdministrator && active && !device.isCurrent);
          return (
            <div className={`device-row ${active ? '' : 'revoked'}`} key={device.id}>
              <span className="device-icon"><Monitor size={17} /></span>
              <span className="device-main">
                <span className="device-name">
                  <strong>{device.name || 'Alpha Studio 设备'}</strong>
                  {device.isCurrent && <em>本机</em>}
                  {device.isAdministrator && <em className="administrator"><ShieldCheck size={11} />管理员</em>}
                  {!active && <em className="revoked">已解除授权</em>}
                </span>
                <span className="device-meta">
                  {device.id} · 安装于 {formatLicenseDate(device.createdAt)}
                  {device.lastSeenAt ? ` · 最近在线 ${formatLicenseDate(device.lastSeenAt)}` : ''}
                </span>
              </span>
              {canRevoke ? (
                <button
                  className="settings-btn danger device-revoke"
                  type="button"
                  onClick={() => onRevoke(device)}
                  disabled={revokingId === device.id}
                  aria-label={`解除 ${device.name || device.id} 的授权`}
                >
                  {revokingId === device.id ? <Loader2 size={13} className="spin" /> : <LogOut size={13} />}
                  <span>{revokingId === device.id ? '正在解除' : '解除授权'}</span>
                </button>
              ) : (
                <span className={`device-status ${active ? 'active' : 'revoked'}`}>
                  {active ? '已授权' : '不可使用'}
                </span>
              )}
            </div>
          );
        })}
        {!loading && devices.length === 0 && !error && (
          <div className="device-list-empty">暂无设备信息。</div>
        )}
      </div>
    </section>
  );
}

function ProfileSettings() {
  const session = useChatStore((state) => state.clientLicenseSession);
  const setClientLicenseSession = useChatStore((state) => state.setClientLicenseSession);
  const codexStatus = useChatStore((state) => state.codexStatus);
  const isCheckingCodex = useChatStore((state) => state.isCheckingCodex);
  const [deviceSummary, setDeviceSummary] = useState<ClientDeviceSummary | null>(null);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [devicesError, setDevicesError] = useState('');
  const [revokingDeviceId, setRevokingDeviceId] = useState<string | null>(null);
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
  const showCodexLoginButton = codexSubscriptionEnabled && Boolean(codexAccount) && Boolean(codexStatus?.installed) && !codexCliAuthorized;
  const showCodexRevokeButton = codexSubscriptionEnabled && codexCliAuthorized;
  const profileTitle = session?.tenant.name || 'Alpha Studio';
  const internalUserEmail = isInternalLicenseEmail(session?.user.email);
  const profileUserName = isInternalLicenseUserName(session?.user.name)
    ? '本机用户'
    : session?.user.name || '本机用户';
  const profileSubtitle = session
    ? internalUserEmail
      ? '本机授权'
      : `${profileUserName} · ${session.user.email}`
    : '@local · Noncommercial';
  const codexAvailabilityLabel = codexSubscriptionEnabled ? '未分配账号' : '未启用';
  const codexPlanLabel = session?.tenant.codexSubscriptionPlan || codexAccount?.plan || '已启用';
  const codexDescription = codexSubscriptionEnabled
    ? codexCliAuthorized
      ? '本地 GPT 已完成设备授权。'
      : codexAccount?.loginHint || (codexAccount ? `订阅计划：${codexPlanLabel}` : '管理后台尚未为当前客户分配 GPT 账号。')
    : '当前客户使用 API 网关模式，用量会计入客户额度。';
  const refreshDevices = useCallback(async () => {
    if (!session) return;
    setDevicesLoading(true);
    setDevicesError('');
    try {
      const next = await fetchClientDevices(session);
      setDeviceSummary({
        ...next,
        activeDevices: Number.isFinite(next.activeDevices) ? next.activeDevices : 0,
        maxDevices: Number.isFinite(next.maxDevices) ? next.maxDevices : session.tenant.maxDevices,
        devices: Array.isArray(next.devices) ? next.devices : [],
      });
    } catch (refreshError) {
      setDevicesError(formatDeviceManagementError(refreshError));
    } finally {
      setDevicesLoading(false);
    }
  }, [session]);
  useEffect(() => {
    void refreshDevices();
  }, [refreshDevices]);
  const revokeDevice = useCallback(async (device: ClientManagedDevice) => {
    if (!session) return;
    const confirmed = await confirmDeviceRevocation(device.name || device.id);
    if (!confirmed) return;
    setRevokingDeviceId(device.id);
    setDevicesError('');
    try {
      const next = await revokeClientDevice(session, device.id);
      setDeviceSummary({
        ...next,
        devices: Array.isArray(next.devices) ? next.devices : [],
      });
    } catch (revokeError) {
      setDevicesError(formatDeviceManagementError(revokeError));
    } finally {
      setRevokingDeviceId(null);
    }
  }, [session]);
  const signOut = () => {
    clearClientLicenseSession();
    setClientLicenseSession(null);
  };

  return (
    <>
      <div className="profile-settings">
        <div className="profile-summary">
          <div className="avatar" aria-hidden="true">{profileAvatarLabel(profileTitle)}</div>
          <div className="profile-identity">
            <span>当前客户</span>
            <h2>{profileTitle}</h2>
            <p>{profileSubtitle}</p>
          </div>
        </div>
        <div className="profile-actions">
          <button className="settings-btn danger" type="button" onClick={signOut}>
            <LogOut size={14} />
            <span>退出登录</span>
          </button>
        </div>
        <div className="profile-metrics">
          <span>
            <strong>{deviceSummary?.activeDevices ?? (devicesLoading ? '—' : session ? 1 : 0)} / {deviceSummary?.maxDevices ?? session?.tenant.maxDevices ?? '-'}</strong>
            <em>已安装设备</em>
          </span>
          <span><strong>{codexSubscriptionEnabled ? 'GPT 订阅' : 'API 网关'}</strong><em>运行模式</em></span>
          <span><strong className={session ? 'profile-status-active' : 'profile-status-inactive'}>{session ? '已激活' : '未激活'}</strong><em>客户端状态</em></span>
        </div>
      </div>
      <SettingsGroup>
        <SettingsRow title="客户" description="当前激活的公司授权。">
          <span className="settings-static">{session?.tenant.name || '未激活'}</span>
        </SettingsRow>
        <SettingsRow
          title="授权身份"
          description={internalUserEmail ? '当前设备使用公司授权激活。' : session?.user.email || '当前设备使用公司授权激活。'}
        >
          <span className="settings-static">{profileUserName}</span>
        </SettingsRow>
        <SettingsRow title="GPT 订阅账号" description={codexDescription}>
          <span className="settings-action-stack">
            {(!codexSubscriptionEnabled || !codexAccount) && (
              <span className="settings-static">{codexAvailabilityLabel}</span>
            )}
            {codexSubscriptionEnabled && !showCodexRevokeButton && !showCodexLoginButton && <CodexAuthorizationBadge status={codexAuthorizationStatus} />}
            {showCodexLoginButton && <CodexLoginButton compact stateButton />}
            {showCodexRevokeButton && <CodexRevokeButton compact />}
          </span>
        </SettingsRow>
        <SettingsRow title="设备授权" description={session ? `设备 ${session.device.id}` : '无有效设备授权。'}>
          <span className="settings-static">{formatLicenseDate(session?.device.leaseExpiresAt)}</span>
        </SettingsRow>
      </SettingsGroup>
      {session && (
        <DeviceManagement
          session={session}
          summary={deviceSummary}
          loading={devicesLoading}
          error={devicesError}
          revokingId={revokingDeviceId}
          onRefresh={() => void refreshDevices()}
          onRevoke={(device) => void revokeDevice(device)}
        />
      )}
    </>
  );
}

function KeyboardSettings() {
  const rows = [
    ['归档聊天', 'Archive the current chat', ''],
    ['新对话', 'Start a new chat', '⌘N'],
    ['搜索', 'Search chats and projects', '⌘K'],
    ['置顶对话', 'Pin or unpin the current chat', '⌥⌘P'],
    ['投研侧栏', 'Open the research side panel', ''],
  ];
  return <SettingsGroup>{rows.map(([title, desc, key]) => <SettingsRow key={title} title={title} description={desc}><span className="shortcut-pill">{key || '未指定'}</span></SettingsRow>)}</SettingsGroup>;
}

function UsageSettings() {
  const session = useChatStore((state) => state.clientLicenseSession);
  const subscriptionUsage = useChatStore((state) => state.subscriptionUsage);
  const latestMonth = useMemo(() => billingMonthValue(new Date()), []);
  const latestYear = latestMonth.slice(0, 4);
  const [periodKind, setPeriodKind] = useState<BillingPeriodKind>('month');
  const [selectedMonth, setSelectedMonth] = useState(latestMonth);
  const [selectedYear, setSelectedYear] = useState(latestYear);
  const [summary, setSummary] = useState<ClientBillingSummary | null>(null);
  const [codexUsage, setCodexUsage] = useState<CodexSubscriptionUsage | null>(null);
  const [loading, setLoading] = useState(false);
  const [codexUsageLoading, setCodexUsageLoading] = useState(false);
  const [error, setError] = useState('');
  const [codexUsageError, setCodexUsageError] = useState('');
  const selectedPeriodValue = periodKind === 'month' ? selectedMonth : selectedYear;

  const refresh = useCallback(async (ledgerPage = 1, includeCodexUsage = true) => {
    if (!session) return;
    setLoading(true);
    setError('');
    if (includeCodexUsage) {
      setCodexUsageLoading(true);
      setCodexUsageError('');
    }

    const shouldLoadCodexUsage = Boolean(session.tenant.codexSubscriptionEnabled || session.codexAccounts.length > 0);
    const [billingResult, codexResult] = await Promise.allSettled([
      fetchClientBillingSummary(session, {
        page: ledgerPage,
        pageSize: 8,
        period: { kind: periodKind, value: selectedPeriodValue },
      }),
      includeCodexUsage
        ? shouldLoadCodexUsage ? fetchCodexSubscriptionUsage() : Promise.resolve(null)
        : Promise.resolve(undefined),
    ]);

    if (billingResult.status === 'fulfilled') {
      setSummary(billingResult.value);
    } else {
      setError(stringifyError(billingResult.reason));
    }

    if (codexResult.status === 'fulfilled' && codexResult.value !== undefined) {
      setCodexUsage(codexResult.value);
    } else if (codexResult.status === 'rejected') {
      setCodexUsageError(stringifyError(codexResult.reason));
    }

    setLoading(false);
    if (includeCodexUsage) setCodexUsageLoading(false);
  }, [periodKind, selectedPeriodValue, session]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const tenant = summary?.tenant ?? session?.tenant;
  const billingMode = tenant?.billingMode || defaultBillingModeForSession(session);
  const periodUsage = summary?.usage?.selectedPeriod ?? summary?.usage?.currentMonth ?? EMPTY_BILLING_USAGE;
  const allTime = summary?.usage?.allTime ?? EMPTY_BILLING_USAGE;
  const models = summary?.usage?.models ?? [];
  const recentLedger = summary?.usage?.recentLedger ?? [];
  const ledgerPagination = summary?.usage?.ledgerPagination;
  const generatedAt = summary?.period?.generatedAt ? formatLicenseDate(summary.period.generatedAt) : loading ? '同步中' : '尚未同步';
  const displayedPeriodKind = summary?.period?.kind ?? periodKind;
  const displayedPeriodValue = summary?.period?.value
    ?? (summary?.period?.currentMonthStart
      ? displayedPeriodKind === 'year'
        ? summary.period.currentMonthStart.slice(0, 4)
        : summary.period.currentMonthStart.slice(0, 7)
      : selectedPeriodValue);
  const periodLabel = formatBillingPeriodLabel(displayedPeriodKind, displayedPeriodValue);
  const codexSubscriptionEnabled = Boolean(tenant?.codexSubscriptionEnabled);
  const apiSubscriptionEnabled = Boolean(tenant?.subscriptionPlan);
  const canSelectNextPeriod = selectedPeriodValue < (periodKind === 'month' ? latestMonth : latestYear);
  const modelRows = useMemo<BillingModelTableRow[]>(() => [
    ...subscriptionModelsForPeriod(subscriptionUsage, displayedPeriodKind, displayedPeriodValue),
    ...models.map((model) => ({ ...model, billingKind: 'metered' as const })),
  ], [displayedPeriodKind, displayedPeriodValue, models, subscriptionUsage]);

  const changePeriodKind = (nextKind: BillingPeriodKind) => {
    if (nextKind === periodKind) return;
    if (nextKind === 'year') {
      setSelectedYear(selectedMonth.slice(0, 4));
    } else if (!selectedMonth.startsWith(`${selectedYear}-`)) {
      setSelectedMonth(`${selectedYear}-${selectedYear === latestYear ? latestMonth.slice(5, 7) : '01'}`);
    }
    setPeriodKind(nextKind);
  };

  const stepPeriod = (delta: number) => {
    const next = shiftBillingPeriod(periodKind, selectedPeriodValue, delta);
    if (periodKind === 'month') setSelectedMonth(next);
    else setSelectedYear(next);
  };

  return (
    <>
      <section className="billing-overview" aria-label="账单总览">
        <div className="billing-overview-head">
          <div className="billing-overview-copy">
            <strong>{periodLabel}账期</strong>
            <span>数据更新时间：{generatedAt}</span>
          </div>
          <div className="billing-overview-actions">
            <div className="settings-segment billing-period-kind" role="group" aria-label="统计周期">
              <button className={`settings-segment-btn ${periodKind === 'month' ? 'active' : ''}`} type="button" aria-pressed={periodKind === 'month'} onClick={() => changePeriodKind('month')}>月度</button>
              <button className={`settings-segment-btn ${periodKind === 'year' ? 'active' : ''}`} type="button" aria-pressed={periodKind === 'year'} onClick={() => changePeriodKind('year')}>年度</button>
            </div>
            <div className="billing-period-picker">
              <button className="settings-btn billing-period-step" type="button" onClick={() => stepPeriod(-1)} aria-label={`查看上一${periodKind === 'month' ? '月' : '年'}`} title={`上一${periodKind === 'month' ? '月' : '年'}`}>
                <ChevronLeft size={14} />
              </button>
              {periodKind === 'month' ? (
                <input
                  className="billing-period-input"
                  type="month"
                  value={selectedMonth}
                  max={latestMonth}
                  aria-label="选择月份"
                  onChange={(event) => {
                    if (/^\d{4}-\d{2}$/.test(event.target.value) && event.target.value <= latestMonth) setSelectedMonth(event.target.value);
                  }}
                />
              ) : (
                <input
                  className="billing-period-input year"
                  type="number"
                  value={selectedYear}
                  min="1"
                  max={latestYear}
                  step="1"
                  aria-label="选择年份"
                  onChange={(event) => {
                    if (/^\d{4}$/.test(event.target.value) && event.target.value <= latestYear) setSelectedYear(event.target.value);
                  }}
                />
              )}
              <button className="settings-btn billing-period-step" type="button" onClick={() => stepPeriod(1)} disabled={!canSelectNextPeriod} aria-label={`查看下一${periodKind === 'month' ? '月' : '年'}`} title={`下一${periodKind === 'month' ? '月' : '年'}`}>
                <ChevronRight size={14} />
              </button>
            </div>
            <button className="settings-btn billing-refresh" type="button" onClick={() => void refresh(ledgerPagination?.page ?? 1)} disabled={!session || loading} aria-label="刷新账单">
              <RefreshCw size={13} className={loading ? 'spin' : ''} />
              <span>刷新</span>
            </button>
          </div>
        </div>
        <div className="billing-metrics">
          <BillingMetric label={`${displayedPeriodKind === 'month' ? '月度' : '年度'}按量费用`} value={formatYuan(periodUsage.billableYuan)} meta={`${formatWholeNumber(periodUsage.runCount)} 次调用`} />
          <BillingMetric label="账户余额" value={formatYuan(tenant?.balanceYuan ?? 0)} meta="API 网关预付余额" tone={(tenant?.balanceYuan ?? 0) <= 0 ? 'warning' : 'default'} />
          <BillingMetric label={`${displayedPeriodKind === 'month' ? '月度' : '年度'}按量 Tokens`} value={formatWholeNumber(periodUsage.totalTokens)} meta={formatUsageBreakdown(periodUsage)} />
        </div>
        {error && <div className="billing-alert"><AlertCircle size={14} />{error}</div>}
      </section>

      <SettingsGroup>
        <SettingsRow title="计费模式" description="订阅模型按席位或套餐授权，API 网关按真实 token 用量结算。">
          <span className="settings-static">{formatBillingMode(billingMode)}</span>
        </SettingsRow>
        <SettingsRow title="组织" description="当前设备激活的计费主体。">
          <span className="settings-static">{tenant?.name || '未激活'}</span>
        </SettingsRow>
        <SettingsRow title="活跃设备" description="该组织当前处于激活状态的设备数量。">
          <span className="settings-static">{summary?.activeDevices ?? tenant?.maxDevices ?? 0} / {tenant?.maxDevices ?? '-'}</span>
        </SettingsRow>
      </SettingsGroup>

      <div className="settings-subtitle">订阅</div>
      <SettingsGroup>
        <SettingsRow title="GPT 订阅" description={codexSubscriptionEnabled ? `套餐 ${formatPlanLabel(tenant?.codexSubscriptionPlan)} · ${formatExpiryLabel(tenant?.codexSubscriptionExpiresAt)}` : '未启用 GPT 订阅模型。'}>
          <BillingStatusPill enabled={codexSubscriptionEnabled} label={codexSubscriptionEnabled ? '已启用' : '未启用'} />
        </SettingsRow>
        {codexSubscriptionEnabled && (
          <SettingsRow title="剩余用量" description={codexUsageDescription(codexUsage, codexUsageLoading, codexUsageError)}>
            <CodexSubscriptionUsageView usage={codexUsage} loading={codexUsageLoading} error={codexUsageError} />
          </SettingsRow>
        )}
        <SettingsRow title="API 套餐" description={apiSubscriptionEnabled ? `${formatPlanLabel(tenant?.subscriptionPlan)} · ${formatExpiryLabel(tenant?.subscriptionExpiresAt)}` : '未配置固定 API 套餐，API 网关按量扣费。'}>
          <BillingStatusPill enabled={apiSubscriptionEnabled} label={apiSubscriptionEnabled ? '已订阅' : '按量'} />
        </SettingsRow>
      </SettingsGroup>

      <div className="settings-subtitle">按量使用</div>
      <SettingsGroup>
        <SettingsRow title="账期费用" description={`${periodLabel} · ${formatUsageBreakdown(periodUsage)}`}>
          <span className="settings-static">{formatYuan(periodUsage.billableYuan)}</span>
        </SettingsRow>
        <SettingsRow title="累计费用" description={`累计 ${formatWholeNumber(allTime.runCount)} 次调用 · ${formatWholeNumber(allTime.totalTokens)} tokens`}>
          <span className="settings-static">{formatYuan(allTime.billableYuan)}</span>
        </SettingsRow>
        <SettingsRow title="账期内最近使用" description="所选账期内最近一笔按量调用产生的时间。">
          <span className="settings-static">{formatLicenseDate(periodUsage.lastUsedAt)}</span>
        </SettingsRow>
      </SettingsGroup>

      <BillingModelTable models={modelRows} periodLabel={periodLabel} />
      <BillingLedgerList
        entries={recentLedger}
        pagination={ledgerPagination}
        loading={loading}
        periodLabel={periodLabel}
        onPageChange={(page) => void refresh(page, false)}
      />
    </>
  );
}

const EMPTY_BILLING_USAGE: BillingUsageTotals = {
  runCount: 0,
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  cachedTokens: 0,
  totalTokens: 0,
  costYuan: 0,
  billableYuan: 0,
  lastUsedAt: null,
};

function BillingMetric({ label, value, meta, tone = 'default' }: { label: string; value: string; meta: string; tone?: 'default' | 'warning' }) {
  return (
    <span className={`billing-metric ${tone}`}>
      <strong>{value}</strong>
      <em>{label}</em>
      <small>{meta}</small>
    </span>
  );
}

function BillingStatusPill({ enabled, label }: { enabled: boolean; label: string }) {
  return <span className={`billing-status-pill ${enabled ? 'active' : 'muted'}`}>{label}</span>;
}

function CodexSubscriptionUsageView({ usage, loading, error }: { usage: CodexSubscriptionUsage | null; loading: boolean; error: string }) {
  const snapshot = codexRateLimitSnapshot(usage);
  const rows = codexUsageRows(snapshot);

  if (rows.length === 0) {
    if (loading) {
      return <span className="codex-usage-state"><Loader2 size={13} className="spin" />同步中</span>;
    }
    if (error) {
      return <span className="codex-usage-state error"><AlertCircle size={13} />读取失败</span>;
    }
    return <span className="codex-usage-state muted">暂无数据</span>;
  }

  return (
    <span className="codex-usage-windows">
      {rows.map((row) => (
        <span className="codex-usage-window" key={row.key}>
          <strong>{row.label}</strong>
          <em>{row.remainingPercent}%</em>
          <small>{row.resetsAtLabel}</small>
        </span>
      ))}
    </span>
  );
}

interface BillingModelTableRow extends BillingModelUsage {
  billingKind: 'included' | 'metered';
}

function subscriptionModelsForPeriod(
  usage: SubscriptionModelUsage[],
  kind: BillingPeriodKind,
  value: string,
): BillingModelTableRow[] {
  const matching = usage.filter((model) => kind === 'month' ? model.month === value : model.month.startsWith(`${value}-`));
  const totals = new Map<string, BillingModelTableRow>();
  for (const model of matching) {
    const existing = totals.get(model.modelId);
    if (existing) {
      existing.runCount += model.runCount;
      existing.inputTokens += model.inputTokens;
      existing.outputTokens += model.outputTokens;
      existing.reasoningTokens += model.reasoningTokens;
      existing.cachedTokens += model.cachedTokens;
      existing.totalTokens += model.totalTokens;
      if (Date.parse(existing.lastUsedAt || '') < model.lastUsedAt) {
        existing.lastUsedAt = new Date(model.lastUsedAt).toISOString();
        existing.label = model.label;
      }
      continue;
    }
    totals.set(model.modelId, {
      modelId: model.modelId,
      label: model.label,
      runCount: model.runCount,
      inputTokens: model.inputTokens,
      outputTokens: model.outputTokens,
      reasoningTokens: model.reasoningTokens,
      cachedTokens: model.cachedTokens,
      totalTokens: model.totalTokens,
      costYuan: 0,
      billableYuan: 0,
      lastUsedAt: new Date(model.lastUsedAt).toISOString(),
      billingKind: 'included',
    });
  }
  return [...totals.values()].sort((left, right) => Date.parse(right.lastUsedAt || '') - Date.parse(left.lastUsedAt || ''));
}

function BillingModelTable({ models, periodLabel }: { models: BillingModelTableRow[]; periodLabel: string }) {
  return (
    <section className="billing-table-section" aria-label="模型用量">
      <div className="billing-section-title">
        <strong>模型用量</strong>
      </div>
      {models.length === 0 ? (
        <div className="billing-empty">{periodLabel}还没有可显示的模型消耗。</div>
      ) : (
        <div className="billing-table-wrap">
          <table className="billing-table">
            <thead>
              <tr>
                <th>模型</th>
                <th>调用</th>
                <th>Tokens</th>
                <th>费用</th>
              </tr>
            </thead>
            <tbody>
              {models.map((model) => (
                <tr key={`${model.billingKind}:${model.modelId}`}>
                  <td>
                    <strong>{model.label || model.modelId}</strong>
                  </td>
                  <td>{formatWholeNumber(model.runCount)}</td>
                  <td title={formatUsageBreakdown(model)}>{formatWholeNumber(model.totalTokens)}</td>
                  <td>
                    {model.billingKind === 'included'
                      ? <span className="billing-cost-included" title="费用已包含在 GPT 订阅中">Included</span>
                      : formatYuan(model.billableYuan)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function codexUsageDescription(usage: CodexSubscriptionUsage | null, loading: boolean, error: string): string {
  if (loading && !usage) return '正在从 GPT 同步。';
  if (error && !usage) return `GPT 读取失败：${error}`;
  if (usage?.generatedAt) return `来自 GPT · 更新 ${formatLicenseDate(usage.generatedAt)}`;
  return '来自 GPT。';
}

function codexRateLimitSnapshot(usage: CodexSubscriptionUsage | null): CodexRateLimitSnapshot | null {
  if (!usage) return null;
  const byId = usage.rateLimitsByLimitId || {};
  return byId.codex
    || Object.values(byId).find((entry) => entry?.limitId === 'codex')
    || Object.values(byId).find((entry) => entry?.limitId?.startsWith('codex'))
    || usage.rateLimits
    || null;
}

function codexUsageRows(snapshot: CodexRateLimitSnapshot | null): Array<{ key: string; label: string; remainingPercent: number; resetsAtLabel: string }> {
  if (!snapshot) return [];
  return [
    ['primary', snapshot.primary],
    ['secondary', snapshot.secondary],
  ].flatMap(([key, window]) => {
    const row = codexUsageRow(key as string, window as CodexRateLimitWindow | null | undefined);
    return row ? [row] : [];
  });
}

function codexUsageRow(key: string, window: CodexRateLimitWindow | null | undefined): { key: string; label: string; remainingPercent: number; resetsAtLabel: string } | null {
  const usedPercent = Number(window?.usedPercent);
  if (!Number.isFinite(usedPercent)) return null;
  return {
    key,
    label: formatCodexWindowDuration(window?.windowDurationMins),
    remainingPercent: clampPercent(100 - usedPercent),
    resetsAtLabel: formatCodexRateLimitReset(window?.resetsAt),
  };
}

function formatCodexWindowDuration(minutes?: number | null): string {
  const raw = Number(minutes);
  const safe = Number.isFinite(raw) ? Math.max(0, Math.round(raw)) : 0;
  if (safe === 300) return '5 小时';
  if (safe === 10080) return '1 周';
  if (safe > 0 && safe % 10080 === 0) return `${safe / 10080} 周`;
  if (safe > 0 && safe % 1440 === 0) return `${safe / 1440} 天`;
  if (safe > 0 && safe % 60 === 0) return `${safe / 60} 小时`;
  return safe > 0 ? `${safe} 分钟` : '窗口';
}

function formatCodexRateLimitReset(value?: number | null): string {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return '待同步';
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return '待同步';
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  if (date.getFullYear() === now.getFullYear()) {
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  }
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function BillingLedgerList({ entries, pagination, loading, periodLabel, onPageChange }: {
  entries: BillingLedgerEntry[];
  pagination?: BillingLedgerPagination;
  loading: boolean;
  periodLabel: string;
  onPageChange: (page: number) => void;
}) {
  const total = pagination?.total ?? entries.length;
  return (
    <section className="billing-ledger" aria-label="账单流水">
      <div className="billing-section-title">
        <strong>账单流水</strong>
        <span>{periodLabel} · 同一运行已合并，金额为累计变动{total > 0 ? ` · 共 ${formatWholeNumber(total)} 条汇总` : ''}</span>
      </div>
      {entries.length === 0 ? (
        <div className="billing-empty">{periodLabel}暂无账单流水。</div>
      ) : (
        <div className="billing-ledger-list">
          {entries.map((entry) => (
            <div className="billing-ledger-row" key={entry.id}>
              <div>
                <strong title={entry.description || formatLedgerEntryType(entry.entryType)}>{entry.description || formatLedgerEntryType(entry.entryType)}</strong>
                <span title={entry.runId || undefined}>{formatLicenseDate(entry.createdAt)}{entry.runId ? ` · ${entry.runId}` : ''}{(entry.entryCount ?? 1) > 1 ? ` · ${entry.entryCount} 笔合计` : ''}</span>
              </div>
              <em className={entry.amountYuan < 0 ? 'charge' : 'credit'}>{formatSignedLedgerYuan(entry.amountYuan)}</em>
            </div>
          ))}
          {pagination && pagination.totalPages > 1 && (
            <div className="billing-pagination" aria-label="账单流水分页">
              <span>第 {pagination.page} / {pagination.totalPages} 页</span>
              <div>
                <button className="settings-btn" type="button" disabled={loading || !pagination.hasPrevious} onClick={() => onPageChange(pagination.page - 1)}>上一页</button>
                <button className="settings-btn" type="button" disabled={loading || !pagination.hasNext} onClick={() => onPageChange(pagination.page + 1)}>下一页</button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function defaultBillingModeForSession(session: ClientLicenseSession | null): string {
  const hasSubscription = Boolean(session?.tenant.codexSubscriptionEnabled || session?.tenant.subscriptionPlan);
  const hasGatewayModels = Boolean(session?.models.some((model) => model.mode === 'gateway_api' && model.enabled));
  if (hasSubscription && hasGatewayModels) return 'hybrid';
  if (hasSubscription) return 'subscription';
  return 'gateway_api';
}

function formatBillingMode(mode?: string | null): string {
  if (mode === 'hybrid') return '订阅 + 按量';
  if (mode === 'subscription') return '订阅';
  if (mode === 'gateway_api') return '按量付费';
  return mode || '未设置';
}

function formatPlanLabel(plan?: string | null): string {
  if (!plan) return '未设置';
  const labels: Record<string, string> = {
    monthly: '月付',
    yearly: '年付',
    pro: '专业版',
    team: '团队版',
    enterprise: '企业版',
  };
  return labels[plan] || plan;
}

function formatExpiryLabel(value?: string | null): string {
  return value ? `到期 ${formatLicenseDate(value)}` : '持续有效';
}

function formatUsageBreakdown(usage: BillingUsageTotals): string {
  return `输入 ${formatWholeNumber(usage.inputTokens)} · 输出 ${formatWholeNumber(usage.outputTokens)} · 推理 ${formatWholeNumber(usage.reasoningTokens)} · 缓存 ${formatWholeNumber(usage.cachedTokens)}`;
}

function LazyPanelFallback({ label }: { label: string }) {
  return (
    <div className="lazy-panel-fallback" role="status">
      <Loader2 size={17} className="spin" />
      <span>{label}…</span>
    </div>
  );
}

function formatLedgerEntryType(type: string): string {
  if (type === 'usage_charge') return '按量扣费';
  if (type === 'usage_settlement_credit') return '用量结算退回';
  if (type === 'offline_receipt') return '线下收款登记';
  if (type === 'offline_receipt_correction') return '线下登记更正';
  if (type === 'opening_balance') return '期初余额迁移';
  if (type === 'topup') return '历史余额登记';
  if (type === 'adjustment') return '历史账务调整';
  return type;
}

function formatWholeNumber(value: number | undefined): string {
  const safe = Number.isFinite(value) ? Math.max(0, Math.round(value ?? 0)) : 0;
  return new Intl.NumberFormat('zh-CN').format(safe);
}

function formatYuan(value: number | undefined): string {
  const safe = Number.isFinite(value) ? value ?? 0 : 0;
  const abs = Math.abs(safe);
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: 2,
    maximumFractionDigits: abs > 0 && abs < 1 ? 4 : 2,
  }).format(safe);
}

function formatSignedYuan(value: number): string {
  return `${value > 0 ? '+' : ''}${formatYuan(value)}`;
}

function formatSignedLedgerYuan(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  const formatted = new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(safe);
  return `${safe > 0 ? '+' : ''}${formatted}`;
}

function billingMonthValue(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function formatBillingPeriodLabel(kind: BillingPeriodKind, value: string): string {
  if (kind === 'year') return /^\d{4}$/.test(value) ? `${value}年` : value;
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return value;
  return `${match[1]}年${Number(match[2])}月`;
}

function shiftBillingPeriod(kind: BillingPeriodKind, value: string, delta: number): string {
  if (kind === 'year') {
    const year = Number(value);
    return String(Math.max(1, Math.min(9998, year + delta))).padStart(4, '0');
  }
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return value;
  const date = new Date(Number(match[1]), Number(match[2]) - 1 + delta, 1);
  return billingMonthValue(date);
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
        <SettingsRow title="技能目录" description="Alpha Studio 会从本地技能目录加载可用技能。">
          <span className="settings-static">~/.alpha-studio/codex-home/skills</span>
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
      <SettingsRow title="终端" description="命令通过 GPT 和本地后端运行。"><span className="settings-static">本地</span></SettingsRow>
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
    'report-branding': <FileChartColumn size={15} />,
    profile: <UserCircle size={15} />,
    runtime: <Terminal size={15} />,
    usage: <History size={15} />,
    archived: <Archive size={15} />,
  };
  return icons[section];
}

function domainSuggestionIcon(suggestion: DomainSuggestion): ReactNode {
  const icons: Record<DomainSuggestion['icon'], ReactNode> = {
    report: <FileChartColumn size={16} className="icon" />,
    mainline: <Network size={16} className="icon" />,
    monitor: <Activity size={16} className="icon" />,
    review: <MoonStar size={16} className="icon" />,
    evidence: <Database size={16} className="icon" />,
    thesis: <Target size={16} className="icon" />,
    calibration: <SlidersHorizontal size={16} className="icon" />,
    factor: <ChartCandlestick size={16} className="icon" />,
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

type ToolKind = 'command' | 'file-write' | 'file-read' | 'file-edit' | 'search' | 'web' | 'log' | 'image' | 'generic';

function toolPresentation(title: string): { kind: ToolKind; icon: ReactNode; running: string; done: string; failed: string } {
  const normalized = title.trim().toLowerCase();
  const has = (...keys: string[]) => keys.some((key) => normalized.includes(key));
  if (normalized === 'filewrite') return { kind: 'file-write', icon: <FileCode2 size={14} />, running: '正在运行写入脚本', done: '已运行写入脚本', failed: '写入脚本失败' };
  if (has('context_compaction', 'contextcompaction', 'context compaction')) {
    return { kind: 'generic', icon: <Workflow size={14} />, running: '正在自动压缩上下文', done: '已自动压缩上下文', failed: '自动压缩上下文失败' };
  }
  if (has('stderr')) return { kind: 'log', icon: <FileText size={14} />, running: 'GPT 日志', done: 'GPT 日志', failed: 'GPT 日志' };
  if (/image[\s._-]*gen|generate[\s._-]*image|image[\s._-]*generation|text[\s._-]*to[\s._-]*image/.test(normalized)) {
    return { kind: 'image', icon: <ImageIcon size={14} />, running: '正在生成图片', done: '已生成图片', failed: '图片生成失败' };
  }
  if (has('exec', 'shell', 'command', 'bash', 'execute', 'terminal')) return { kind: 'command', icon: <Terminal size={14} />, running: '正在运行', done: '已运行', failed: '运行失败' };
  if (isWebSearchToolTitle(title)) return { kind: 'web', icon: <Globe size={14} />, running: '正在搜索网页', done: '已搜索网页', failed: '网页搜索失败' };
  if (has('webfind', 'web_find', 'findinpage', 'find_in_page')) return { kind: 'web', icon: <ScanSearch size={14} />, running: '正在页内查找', done: '已完成页内查找', failed: '页内查找失败' };
  if (isWebPageToolTitle(title)) return { kind: 'web', icon: <Globe size={14} />, running: '正在读取网页', done: '已读取网页', failed: '网页读取失败' };
  if (isSpawnAgentToolTitle(title)) return { kind: 'generic', icon: <Users size={14} />, running: '正在调用同事', done: '已调用同事', failed: '同事调用失败' };
  if (has('search', 'grep', 'glob', 'ripgrep', 'find', 'query')) return { kind: 'search', icon: <Search size={14} />, running: '正在搜索', done: '已搜索', failed: '搜索失败' };
  if (has('filechange', 'file_change', 'apply_patch', 'applypatch', 'write_file', 'writefile', 'edit_file', 'editfile', 'file_edit') || /^(?:write|edit|patch|apply|diff)$/.test(normalized)) return { kind: 'file-edit', icon: <FileCode2 size={14} />, running: '正在编辑', done: '已编辑', failed: '编辑失败' };
  if (has('filelist', 'file_list', 'listfiles', 'list_files', 'readdirectory', 'read_directory')) return { kind: 'file-read', icon: <FolderSearch size={14} />, running: '正在查看文件', done: '已查看文件', failed: '查看文件失败' };
  if (has('read', 'open', 'cat', 'file', 'view')) return { kind: 'file-read', icon: <FileText size={14} />, running: '正在读取', done: '已读取', failed: '读取失败' };
  if (has('web', 'browser', 'fetch', 'http', 'url', 'navigate')) return { kind: 'web', icon: <Globe size={14} />, running: '正在读取网页', done: '已读取网页', failed: '网页读取失败' };
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
  return message.blocks.filter((block) => (
    !(hideReconnectStatus && isReconnectStatusBlock(block))
    && (block.type !== 'image_result' || shouldRenderPersistedImageResult(block, message.blocks))
  )).map((block) => {
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
      const who = message.role === 'user' ? '我' : 'GPT';
      const body = messageToPlainText(message);
      return body ? `${who}：${body}` : '';
    })
    .filter(Boolean)
    .join('\n\n');
}

async function tryCopyToClipboard(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard access is best-effort.
    return false;
  }
}

async function copyToClipboard(text: string): Promise<void> {
  await tryCopyToClipboard(text);
}

async function openExternal(url: string): Promise<void> {
  const localPath = localFilePath(url);
  if (isTauriRuntime()) {
    try {
      await invoke('open_external_target', { request: { target: localPath || url } });
      return;
    } catch {
      // Fall through to the browser behavior in degraded runtimes.
    }
  }
  window.open(localPath ? localFileBrowserUrl(localPath) : url, '_blank', 'noopener,noreferrer');
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

async function confirmDeviceRevocation(deviceName: string): Promise<boolean> {
  const message = `解除“${deviceName}”的设备授权后，该设备上的 Alpha Studio 将无法继续使用。`;
  if (isTauriRuntime()) {
    try {
      const { ask } = await import('@tauri-apps/plugin-dialog');
      return await ask(message, {
        title: '解除设备授权',
        kind: 'warning',
        okLabel: '解除授权',
        cancelLabel: '取消',
      });
    } catch {
      return false;
    }
  }
  return window.confirm(`解除设备授权\n\n${message}`);
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

function isInternalLicenseEmail(value?: string | null): boolean {
  return !value || /^local(?:[+._-][^@]+)?@alpha-studio\.local$/i.test(value.trim());
}

function isInternalLicenseUserName(value?: string | null): boolean {
  const normalized = value?.trim().toLowerCase() || '';
  return !normalized || normalized === 'alpha studio user' || normalized === '本机用户';
}

function profileAvatarLabel(value: string): string {
  const normalized = value.trim();
  if (!normalized) return 'AS';
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    return words.slice(0, 2).map((word) => word[0]).join('').toUpperCase();
  }
  return Array.from(normalized).slice(0, 2).join('').toUpperCase();
}

function formatDeviceManagementError(error: unknown): string {
  const message = stringifyError(error);
  if (message === 'Alpha Studio API 404' || /\b404\b/.test(message)) {
    return '设备管理服务尚未更新，请重启 Alpha Studio 后台服务后重试。';
  }
  return message;
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
  return pathToFileUrl(localPath);
}

function localFileBrowserUrl(path: string): string {
  return pathToFileUrl(path);
}

function pathToFileUrl(path: string): string {
  if (path.startsWith('file://')) return path;
  return `file://${path.split('/').map((part) => encodeURIComponent(part)).join('/')}`;
}

function localFilePath(src: string): string | null {
  if (src.startsWith('/')) return decodeLocalPath(src);
  if (!src.startsWith('file://')) return null;
  try {
    return decodeURIComponent(new URL(src).pathname);
  } catch {
    return null;
  }
}

function decodeLocalPath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
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
