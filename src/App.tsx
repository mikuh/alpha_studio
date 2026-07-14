import { Fragment, createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type {
  AnchorHTMLAttributes,
  ChangeEvent,
  CSSProperties,
  DragEvent as ReactDragEvent,
  FormEvent,
  ImgHTMLAttributes,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
  RefObject,
} from 'react';
import ReactMarkdown from 'react-markdown';
import { createPortal } from 'react-dom';
import remarkGfm from 'remark-gfm';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { Terminal as XTerm, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import {
  Activity,
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
  CornerDownRight,
  Cpu,
  Database,
  Download,
  Eye,
  EyeOff,
  ExternalLink,
  File,
  FileChartColumn,
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
  LogOut,
  MessageCircle,
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
  PanelLeftClose,
  PanelLeftOpen,
  PanelRight,
  PanelRightClose,
  Paperclip,
  Pencil,
  Pin,
  PinOff,
  Plug,
  Play,
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
  Users,
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
  isTauriRuntime,
  listOpenApps,
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
  terminalResize,
  terminalStart,
  terminalStop,
  terminalWrite,
  type CodexRateLimitSnapshot,
  type CodexRateLimitWindow,
  type CodexSubscriptionUsage,
  type BrowserWebviewEvent,
} from './codexBridge';
import { contextWindowUsage, formatTokenCount, type ContextWindowUsage } from './contextWindow';
import { BrowserPdfViewer } from './BrowserPdfViewer';
import { NativeBrowserSurface } from './NativeBrowserSurface';
import {
  COWORKER_CATALOG,
  COWORKER_GROUP_LABELS,
  COWORKER_WORKFLOW_PRESETS,
  coworkerSelectionsByIds,
  coworkerAgentDefinitions,
  toCoworkerSelection,
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
import { loadLocalStoreSnapshot } from './localStore';
import { activeDomain, type DomainConfig, type DomainSuggestion } from './domain';
import {
  activateClient,
  ALPHA_GATEWAY_PROVIDER_ID,
  clearClientLicenseSession,
  defaultAlphaApiBaseUrl,
  fetchClientBillingSummary,
  getOrCreateDeviceFingerprint,
  loadClientLicenseSession,
  renewClientLease,
  type BillingLedgerEntry,
  type BillingModelUsage,
  type BillingUsageTotals,
  type ClientBillingSummary,
  type ClientLicenseSession,
} from './license';
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
  emptyJqDataConfig,
  loadJqDataConfig,
  saveJqDataConfig,
  type JqDataConfig,
} from './jqdata';
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
import { RESEARCH_DRAG_MIME } from './research';
import { ResearchWorkbenchPanel } from './ResearchWorkbench';
import {
  ALPHA_STUDIO_DAILY_THEME_SKILL_ID,
  ALPHA_STUDIO_DAILY_THEME_SKILL_TITLE,
} from './themeResearch';
import {
  ALPHA_STUDIO_INTRADAY_MONITOR_SKILL_ID,
  ALPHA_STUDIO_INTRADAY_MONITOR_SKILL_TITLE,
  ALPHA_STUDIO_REPORT_REVIEW_SKILL_ID,
  ALPHA_STUDIO_REPORT_REVIEW_SKILL_TITLE,
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
  SkillSelection,
} from './types';

type RightPanel = 'none' | 'git' | 'features' | 'coworkers' | 'review' | 'terminal' | 'browser' | 'files' | 'side-chat' | 'research-workbench';
type RightDockKind = 'review' | 'terminal' | 'browser' | 'files' | 'side-chat' | 'research-workbench';
type MainView = 'chat' | 'skills' | 'automations';
interface RightDockTab {
  id: string;
  kind: RightDockKind;
  url?: string;
  requestKey?: number;
}
type Theme = 'light' | 'dark';
type SettingsSection =
  | 'general'
  | 'profile'
  | 'usage'
  | 'jqdata'
  | 'archived';

const SIDEBAR_WIDTH_KEY = 'alpha:codex-sidebar-width';
const RIGHT_SIDEBAR_WIDTH_KEY = 'alpha:right-sidebar-width';
const GIT_PANEL_WIDTH_KEY = 'alpha:git-panel-width';
const REVIEW_PANEL_WIDTH_KEY = 'alpha:review-panel-width';
const THEME_KEY = 'alpha:codex-theme';
const THEME_RESTORE_KEY = 'alpha:codex-theme-restored-main-ui-v2';
const CODEX_LOGIN_POLL_INTERVAL_MS = 2_000;
const CODEX_LOGIN_POLL_TIMEOUT_MS = 60_000;
const CLIENT_LICENSE_RENEW_INTERVAL_MS = 24 * 60 * 60 * 1000;
const SIDEBAR_MIN_WIDTH = 244;
const SIDEBAR_MAX_WIDTH = 420;
const SIDEBAR_DEFAULT_WIDTH = 300;
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
};
const RIGHT_DOCK_ADD_MENU_KINDS: readonly RightDockKind[] = ['research-workbench', 'browser'];

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
    id: ALPHA_STUDIO_DAILY_THEME_SKILL_ID,
    title: ALPHA_STUDIO_DAILY_THEME_SKILL_TITLE,
    description: '按 Neostream 同级规范生成 A 股盘前主题、资金进攻路径和连续跟踪研究。',
    category: 'personal',
    source: '个人',
    installed: true,
    icon: 'chart',
    detail: detail(
      '生成 Alpha Studio Research 风格的 A 股盘前主题跟踪、盘中更新和收盘复盘报告，规则与 neostream-daily-theme-research 保持一致。',
      '默认正式日报必须包含今日执行闸门、今日资金进攻路径、隔夜全球线索、连续跟踪、持有复核、角色矩阵、来源与风险提示；可从 Composer 的技能菜单发起结构化 JSON 和完整 Markdown/HTML 报告生成。',
    ),
  },
  {
    id: ALPHA_STUDIO_INTRADAY_MONITOR_SKILL_ID,
    title: ALPHA_STUDIO_INTRADAY_MONITOR_SKILL_TITLE,
    description: '基于今日研究报告持续检查盘中触发、升级、降级与失效条件。',
    category: 'personal',
    source: '个人',
    installed: true,
    icon: 'monitor',
    detail: detail(
      '将今日已生成的报告作为不可改写的基线，对照实时行情检查触发、升级、降级和失效条件。',
      '搭配 Alpha Studio 自动化任务可在 A 股交易时段每隔数分钟运行，输出只聚焦相对上一次监控的状态变化。',
    ),
  },
  {
    id: ALPHA_STUDIO_REPORT_REVIEW_SKILL_ID,
    title: ALPHA_STUDIO_REPORT_REVIEW_SKILL_TITLE,
    description: '将今日研究报告与实际行情、盘中监控结果对照，完成偏差归因与次日调整。',
    category: 'personal',
    source: '个人',
    installed: true,
    icon: 'review',
    detail: detail(
      '复盘当日报告的主路径、备选路径、题材概率、触发条件和标的角色判断，严格区分事前假设与事后信息。',
      '输出命中/误判审计、偏差归因、应保留或修改的规则，以及次一交易日交接条件。',
    ),
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
    id: 'daily-brief',
    title: '每日简报',
    description: '每天开始前汇总市场、项目或代码库状态，突出需要关注的变化和下一步动作。',
    schedule: '每天 09:00',
    source: '系统模板',
    icon: 'daily',
    prompt: '汇总市场、项目或代码库状态，并突出需要关注的变化和下一步动作。',
  },
  {
    id: 'weekly-review',
    title: '每周回顾',
    description: '每周整理本周完成事项、遗留风险和下周优先级，适合投研与项目复盘。',
    schedule: '星期五 17:30',
    source: '系统模板',
    icon: 'weekly',
    prompt: '整理本周完成事项、遗留风险和下周优先级。',
  },
  {
    id: 'project-monitor',
    title: '项目监控',
    description: '持续跟踪当前研究主题或代码项目，发现异常、延期或新变化时提醒你处理。',
    schedule: '每个工作日 10:00',
    source: 'Codex 自动化',
    icon: 'project',
    prompt: '跟踪当前研究主题或代码项目，发现异常、延期或新变化时提醒我处理。',
  },
  {
    id: 'commit-scan',
    title: '扫描最近提交',
    description: '检查最近提交、PR、测试失败和 CI 信号，优先提示小且安全的修复建议。',
    schedule: '每天 09:00',
    source: 'Codex 自动化',
    icon: 'commit',
    prompt: '检查最近提交、PR、测试失败和 CI 信号，并优先提示小且安全的修复建议。',
  },
  {
    id: 'release-note',
    title: 'PR 发布说明',
    description: '基于已合并 PR 起草发布说明，严格区分已合并历史和推断内容。',
    schedule: '星期五 09:00',
    source: '系统模板',
    icon: 'release',
    prompt: '基于已合并 PR 起草发布说明，并严格区分已合并历史和推断内容。',
  },
  {
    id: 'ci-triage',
    title: 'CI 失败总结',
    description: '总结上一个 CI 窗口中的失败和不稳定测试，给出首要修复建议。',
    schedule: '每天 21:00',
    source: 'Codex 自动化',
    icon: 'ci',
    prompt: '总结上一个 CI 窗口中的失败和不稳定测试，并给出首要修复建议。',
  },
] as const;

// Drag payload MIME for coworker cards dropped onto the composer.
const COWORKER_DRAG_MIME = 'application/x-alpha-coworker';

// One or more coworkers (optionally with a preset task prompt) queued from the
// coworkers panel, waiting for the composer to pick them up.
interface QueuedCoworkerTask {
  coworkers: CoworkerSelection[];
  taskPrompt?: string;
}

interface SkillRuntimeContextValue {
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

function useBrowserDockOpener() {
  return useContext(BrowserDockContext);
}

function useFileDockOpener() {
  return useContext(FileDockContext);
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

  const deactivateSession = useCallback((message: string) => {
    clearClientLicenseSession();
    setClientLicenseSession(null);
    setSession(null);
    setStatus('inactive');
    setError(message);
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
    if (isLeaseFresh(stored)) {
      activateSession(stored);
      void renewClientLease(stored)
        .then((renewed) => {
          if (!disposed) activateSession(renewed);
        })
        .catch(() => {
          // A still-valid three-year lease should survive transient startup/network failures.
        });
      return () => {
        disposed = true;
      };
    }
    void renewClientLease(stored)
      .then((renewed) => {
        if (!disposed) activateSession(renewed);
      })
      .catch((leaseError) => {
        if (disposed) return;
        deactivateSession(`设备授权已失效，请重新激活：${stringifyUnknownError(leaseError)}`);
      });
    return () => {
      disposed = true;
    };
  }, [activateSession, deactivateSession, setClientLicenseSession]);

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
          if (!isLeaseFresh(session)) {
            deactivateSession(`设备续租失败，请重新激活：${stringifyUnknownError(leaseError)}`);
          }
        });
    }, CLIENT_LICENSE_RENEW_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [activateSession, deactivateSession, session, status]);

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
  return (
    <ClientLicenseBoundary>
      <AppWorkspace />
    </ClientLicenseBoundary>
  );
}

function AppWorkspace() {
  const refreshCodexStatus = useChatStore((state) => state.refreshCodexStatus);
  const loadModelConfig = useChatStore((state) => state.loadModelConfig);
  const conversations = useChatStore((state) => state.conversations);
  const currentConversationId = useChatStore((state) => state.currentConversationId);
  const setCurrentConversation = useChatStore((state) => state.setCurrentConversation);
  const workModeId = useChatStore((state) => state.workModeId);
  const domain = activeDomain(workModeId);
  useAutomationScheduler();

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
  const [skillStatus, setSkillStatus] = useState<SkillStatusMap>(() => readSkillStatus());
  const [queuedSkill, setQueuedSkill] = useState<SkillCatalogItem | null>(null);
  const [queuedSkillPrompt, setQueuedSkillPrompt] = useState<string | null>(null);
  const [queuedCoworkerTask, setQueuedCoworkerTask] = useState<QueuedCoworkerTask | null>(null);

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
    const active = activeConversations(conversations);
    if ((!currentConversationId || !active.some((item) => item.id === currentConversationId)) && active[0]) {
      setCurrentConversation(active[0].id);
    }
  }, [conversations, currentConversationId, setCurrentConversation]);

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

  const showRegularRightPanel = useCallback(() => {
    const saved = lastRegularRightPanelRef.current;
    const savedTab = saved.activeTabId
      ? rightDockTabs.find((tab) => tab.id === saved.activeTabId) ?? null
      : null;
    setActiveRightDockTabId(savedTab?.id ?? null);
    setRightPanel(savedTab?.kind ?? (saved.panel === 'git' ? 'git' : 'features'));
    setRightDockExpanded(false);
    setRightDockMounted(true);
    setRightPanelVisible(true);
  }, [rightDockTabs]);

  const addRightDockTab = useCallback((kind: RightDockKind, url?: string) => {
    nextRightDockTabRef.current += 1;
    const tab: RightDockTab = {
      id: `${kind}-${Date.now()}-${nextRightDockTabRef.current}`,
      kind,
      url,
      requestKey: url ? 1 : undefined,
    };
    setRightDockTabs((prev) => [...prev, tab]);
    setActiveRightDockTabId(tab.id);
    setRightPanel(kind);
    setRightDockMounted(true);
    setRightPanelVisible(true);
  }, []);

  const openBrowserUrl = useCallback((rawUrl: string) => {
    const displayUrl = browserDockDisplayUrl(rawUrl);
    if (!normalizeBrowserDockUrl(displayUrl)) return;
    addRightDockTab('browser', displayUrl);
  }, [addRightDockTab]);

  const openFileInDock = useCallback((rawPath: string) => {
    const path = localFilePath(rawPath) || rawPath.trim();
    if (!path) return;
    addRightDockTab('files', path);
  }, [addRightDockTab]);

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
      if (!nextActive) setRightDockExpanded(false);
    }
  }, [activeRightDockTabId, rightDockTabs]);

  const coworkersPanelOpen = rightPanelVisible && currentRightPanel === 'coworkers';
  const rightPanelToggleOpen = rightPanelVisible && currentRightPanel !== 'coworkers';

  const toggleRightPanel = useCallback(() => {
    setRightDockMounted(true);
    if (rightPanelVisible) {
      if (currentRightPanel === 'coworkers') {
        showRegularRightPanel();
        return;
      }
      setRightDockExpanded(false);
      setRightPanelVisible(false);
      return;
    }
    if (currentRightPanel === 'coworkers') {
      showRegularRightPanel();
      return;
    }
    setRightPanelVisible(true);
  }, [currentRightPanel, rightPanelVisible, showRegularRightPanel]);

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
    currentRightPanel === 'features' ||
    currentRightPanel === 'coworkers' ||
    currentRightPanel === 'terminal' ||
    currentRightPanel === 'browser' ||
    currentRightPanel === 'files' ||
    currentRightPanel === 'side-chat' ||
    currentRightPanel === 'research-workbench';

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
            className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''} ${rightPanelVisible ? 'right-panel-open' : ''} ${rightPanelVisible && rightDockExpanded ? 'right-dock-expanded' : ''} ${rightPanelVisible && currentRightPanel === 'features' ? 'features-panel-open' : ''} ${coworkersPanelOpen ? 'coworkers-panel-open' : ''} ${rightPanelVisible && currentRightPanel === 'git' ? 'git-panel-open' : ''} ${rightPanelVisible && currentRightPanel === 'review' ? 'review-panel-open' : ''} ${windowFocused ? '' : 'window-inactive'} ${windowFullscreen ? 'window-fullscreen' : ''}`}
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
                  rightPanelOpen={rightPanelToggleOpen}
                  coworkersPanelOpen={coworkersPanelOpen}
                  hidePanelActions={settingsOpen}
                  onToggleSidebar={() => setSidebarCollapsed((value) => !value)}
                  onToggleRightPanel={toggleRightPanel}
                  onToggleCoworkersPanel={toggleCoworkersPanel}
                  onOpenSideChat={() => addRightDockTab('side-chat')}
                  onOpenSettings={() => openSettings('general')}
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
                expanded={rightDockExpanded}
                onToggleExpanded={() => setRightDockExpanded((expanded) => !expanded)}
                onOpenBrowser={() => addRightDockTab('browser')}
                onOpenResearchWorkbench={() => addRightDockTab('research-workbench')}
                onCloseGit={() => {
                  setRightDockExpanded(false);
                  setRightPanelVisible(false);
                }}
              />
            )}
          </div>
          {rightPanelVisible && rightDockExpanded && currentRightPanel !== 'side-chat' && <DockOverlayComposer domain={domain} />}
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
  const classes = ['icon-btn', className].filter(Boolean).join(' ');
  return (
    <button className={classes} type="button" onClick={onToggle} aria-label="展开侧栏" title="展开侧栏">
      <PanelLeftOpen size={16} />
    </button>
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
      className={`icon-btn ${open ? 'active' : ''}`}
      type="button"
      onClick={onToggle}
      aria-label={open ? '关闭 AI 同事面板' : '打开 AI 同事面板'}
      aria-pressed={open}
      title="AI 同事"
    >
      <Users size={16} />
    </button>
  );
}

function RightPanelToggleButton({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      className={`icon-btn ${open ? 'active' : ''}`}
      type="button"
      onClick={onToggle}
      aria-label={open ? '关闭侧边栏' : '打开侧边栏'}
      aria-pressed={open}
      title={open ? '关闭侧边栏' : '侧边栏'}
    >
      {open ? <PanelRightClose size={16} /> : <PanelRight size={16} />}
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
          <button className="sidebar-collapse-btn" type="button" onClick={onCollapse} aria-label="收起侧栏" title="收起侧栏">
            <PanelLeftClose size={16} />
          </button>
          <div className="sidebar-account" title={activatedUserTitle} data-tauri-drag-region>
            <span>{activatedTenantName}</span>
          </div>
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
                    handleCommitProjectRename(project, name);
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
  coworkersPanelOpen,
  hidePanelActions = false,
  onToggleSidebar,
  onToggleRightPanel,
  onToggleCoworkersPanel,
  onOpenSideChat,
  onOpenSettings,
}: {
  domain: DomainConfig;
  sidebarCollapsed: boolean;
  rightPanelOpen: boolean;
  coworkersPanelOpen: boolean;
  hidePanelActions?: boolean;
  onToggleSidebar: () => void;
  onToggleRightPanel: () => void;
  onToggleCoworkersPanel: () => void;
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
      {!hidePanelActions && (
        <div className="top-bar-actions">
          <div className="top-bar-panel-actions">
            <CoworkersToggleButton open={coworkersPanelOpen} onToggle={onToggleCoworkersPanel} />
            <RightPanelToggleButton open={rightPanelOpen} onToggle={onToggleRightPanel} />
          </div>
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
  xcode: { label: 'Xcode', color: '#1688f0', glyph: '⌘' },
};

const OPEN_APP_ORDER: OpenAppId[] = ['vscode', 'cursor', 'finder', 'terminal', 'pycharm'];
const FILE_OPEN_APP_ORDER: OpenAppId[] = ['cursor', 'vscode', 'xcode', 'pycharm'];

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
    case 'research-workbench':
      return <LineChart size={size} />;
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
  expanded,
  onToggleExpanded,
  onOpenBrowser,
  onOpenResearchWorkbench,
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
  expanded: boolean;
  onToggleExpanded: () => void;
  onOpenBrowser: () => void;
  onOpenResearchWorkbench: () => void;
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
                  />
                )}
                {tab.kind === 'files' && <FilesDockPanel filePath={tab.url} />}
                {tab.kind === 'side-chat' && <SideChatPanel domain={domain} sidebarExpanded={expanded} />}
                {tab.kind === 'research-workbench' && <ResearchWorkbenchPanel />}
              </div>
            ))}
          </div>
        </>
      ) : mode === 'git' ? (
        <GitPanel onClose={onCloseGit} />
      ) : mode === 'coworkers' ? (
        <CoworkersPanel />
      ) : (
        <FeaturesPanel
          domain={domain}
          onOpenBrowser={onOpenBrowser}
          onOpenResearchWorkbench={onOpenResearchWorkbench}
        />
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
      <div className="right-dock-tabbar-actions">
        <button
          type="button"
          className={`right-dock-expand-btn ${expanded ? 'active' : ''}`}
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

function FeaturesPanel({
  domain,
  onOpenBrowser,
  onOpenResearchWorkbench,
}: {
  domain: DomainConfig;
  onOpenBrowser: () => void;
  onOpenResearchWorkbench: () => void;
}) {
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
      id: 'research-workbench',
      label: '投研工作台',
      icon: <LineChart size={14} />,
      title: '打开基础投研面板',
      onClick: onOpenResearchWorkbench,
    },
    {
      id: 'browser',
      label: '浏览器',
      icon: <Globe size={14} />,
      shortcut: '⌘T',
      title: '打开行情、公告或研究资料',
      onClick: onOpenBrowser,
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

// Right-side panel listing workflow presets and the nine AI coworkers. Cards
// can be dragged into the composer and presets can be imported with one click.
function CoworkersPanel() {
  const { queueCoworkerTask } = useSkillRuntime();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [workflowsOpen, setWorkflowsOpen] = useState(false);

  const startDrag = (event: ReactDragEvent<HTMLElement>, coworker: CoworkerProfile) => {
    const selection = toCoworkerSelection(coworker);
    event.dataTransfer.setData(COWORKER_DRAG_MIME, JSON.stringify(selection));
    event.dataTransfer.setData('text/plain', `${coworker.no} ${coworker.name}`);
    event.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <div className="coworkers-panel" aria-label="AI 同事">
      <header className="coworkers-panel-head" data-tauri-drag-region>
        <div className="coworkers-panel-title" data-tauri-drag-region>
          <Users size={15} />
          <span>AI 同事</span>
        </div>
      </header>
      <p className="coworkers-panel-hint">拖动同事到对话框,或展开协作模板一键导入。</p>
      <div className="coworkers-list">
        <section className={`coworker-workflows ${workflowsOpen ? 'expanded' : ''}`} aria-label="协作模板">
          <button
            type="button"
            className="coworker-workflows-toggle"
            onClick={() => setWorkflowsOpen((open) => !open)}
            aria-expanded={workflowsOpen}
          >
            <span className="coworker-workflows-toggle-main">
              <Workflow size={13} />
              <span>协作模板</span>
            </span>
            <span className="coworker-workflows-toggle-meta">
              <span>{COWORKER_WORKFLOW_PRESETS.length} 个</span>
              {workflowsOpen ? <ChevronsDownUp size={13} /> : <ChevronsUpDown size={13} />}
            </span>
          </button>
          {workflowsOpen && (
            <div className="coworker-workflow-list">
              {COWORKER_WORKFLOW_PRESETS.map((workflow) => {
                const workflowCoworkers = coworkerSelectionsByIds(workflow.coworkerIds);
                return (
                  <article key={workflow.id} className="coworker-workflow">
                    <div className="coworker-workflow-copy">
                      <span className="coworker-workflow-title">{workflow.title}</span>
                      <span className="coworker-workflow-desc">{workflow.description}</span>
                      <span className="coworker-workflow-roster" aria-label={`${workflow.title} 参与同事`}>
                        {workflowCoworkers.map((coworker) => (
                          <span key={coworker.id} className="coworker-workflow-chip" title={coworker.name}>
                            {coworker.no}
                          </span>
                        ))}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="coworker-workflow-import"
                      onClick={() => queueCoworkerTask(workflowCoworkers, workflow.prompt)}
                      title="导入协作模板到对话框"
                    >
                      导入
                    </button>
                  </article>
                );
              })}
            </div>
          )}
        </section>
        {COWORKER_CATALOG.map((coworker) => {
          const expanded = expandedId === coworker.id;
          return (
            <article
              key={coworker.id}
              className={`coworker-card ${expanded ? 'expanded' : ''}`}
              draggable
              onDragStart={(event) => startDrag(event, coworker)}
            >
              <button
                type="button"
                className="coworker-card-head"
                onClick={() => setExpandedId(expanded ? null : coworker.id)}
                aria-expanded={expanded}
              >
                <span className="coworker-badge">{coworker.no}</span>
                <span className="coworker-card-main">
                  <span className="coworker-card-name">
                    {coworker.name}
                    <span className={`coworker-group coworker-group-${coworker.group}`}>
                      {COWORKER_GROUP_LABELS[coworker.group]}
                    </span>
                  </span>
                  <span className="coworker-card-desc">{coworker.description}</span>
                </span>
                <span className="coworker-card-side">
                  <span className="coworker-status" title="在线"><span className="coworker-status-dot" />在线</span>
                  {expanded ? <ChevronsDownUp size={13} /> : <ChevronsUpDown size={13} />}
                </span>
              </button>
              {expanded && (
                <div className="coworker-card-body">
                  <button
                    type="button"
                    className="coworker-summon"
                    onClick={() => queueCoworkerTask(toCoworkerSelection(coworker))}
                  >
                    <MessageSquarePlus size={13} />
                    召集到对话框
                  </button>
                  <div className="coworker-task-list">
                    {coworker.presetTasks.map((task) => (
                      <div key={task.id} className="coworker-task">
                        <div className="coworker-task-copy">
                          <span className="coworker-task-title">{task.title}</span>
                          <span className="coworker-task-prompt">{task.prompt}</span>
                        </div>
                        <button
                          type="button"
                          className="coworker-task-import"
                          onClick={() => queueCoworkerTask(toCoworkerSelection(coworker), task.prompt)}
                          title="导入任务到对话框"
                        >
                          导入
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </article>
          );
        })}
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

type LocalHtmlPreview = {
  path: string;
  status: 'loading' | 'ready' | 'error';
  srcDoc?: string;
  error?: string;
};

let browserWebviewSequence = 0;

type BrowserDownloadStatus = {
  message: string;
  path?: string;
  success?: boolean;
};

function BrowserDockPanel({
  requestedUrl,
  requestKey,
  active,
}: {
  requestedUrl?: string;
  requestKey?: number;
  active: boolean;
}) {
  const localUrl = useMemo(() => {
    if (typeof window === 'undefined') return 'http://localhost:1421';
    return window.location.protocol.startsWith('http') ? window.location.origin : 'http://localhost:1421';
  }, []);
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
        <iframe key={`${htmlPreview.path}-${frameKey}`} className="browser-frame" srcDoc={htmlPreview.srcDoc} title={activeDisplay || htmlPreview.path} onLoad={() => setIsLoading(false)} />
      ) : localPdfPath ? (
        <BrowserPdfViewer path={localPdfPath} revision={frameKey} onOpenExternal={() => void openExternal(localPdfPath)} />
      ) : frameError ? (
        <div className="browser-frame-status error" role="alert">
          <AlertCircle size={18} />
          <strong>网页无法打开</strong>
          <span>{frameError}</span>
          <button type="button" className="generated-file-open" onClick={refreshFrame}><span>重试</span><RefreshCw size={13} /></button>
        </div>
      ) : nativeHttpUrl ? (
        <NativeBrowserSurface
          id={nativeBrowserId}
          url={url}
          visible={active}
          onEvent={handleNativeBrowserEvent}
          onError={handleNativeBrowserError}
        />
      ) : url ? (
        <iframe
          ref={browserFrameRef}
          key={`${url}-${frameKey}`}
          className="browser-frame"
          src={url}
          title={activeDisplay || url}
          onLoad={() => setIsLoading(false)}
          onError={() => { setIsLoading(false); setFrameError('目标网页拒绝连接或当前网络不可用。'); }}
          allow="clipboard-read; clipboard-write; fullscreen; geolocation"
          referrerPolicy="strict-origin-when-cross-origin"
        />
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

async function buildLocalHtmlPreviewDocument(path: string): Promise<string> {
  const html = await localTextFileRead(path);
  if (!html.content.trim()) throw new Error('HTML 文件为空。');
  if (html.truncated) throw new Error('HTML 文件过大，无法在侧边浏览器完整预览。');

  const parser = new DOMParser();
  const doc = parser.parseFromString(html.content, 'text/html');
  const baseDir = ensureTrailingSlash(directoryName(path));

  const base = doc.createElement('base');
  base.href = localFileBrowserUrl(baseDir);
  doc.head.prepend(base);

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
  const conversation = useCurrentConversation();
  const cwd = conversation?.cwd || '';
  if (filePath) return <FilePreviewDockPanel path={filePath} />;
  return <FilesChangeListDockPanel cwd={cwd} />;
}

function FilesChangeListDockPanel({ cwd }: { cwd: string }) {
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

function SideChatPanel({ domain, sidebarExpanded }: { domain: DomainConfig; sidebarExpanded: boolean }) {
  const conversation = useCurrentConversation();
  const { codexReady } = useComposerRuntimeState();

  return (
    <section className="side-chat-panel" aria-label="侧边聊天">
      <div className="side-chat-body" />
      {conversation ? (
        <div className="side-chat-composer">
          <Composer domain={domain} conversation={conversation} disabled={!codexReady} allowCompact={sidebarExpanded} />
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
    return `${template.title} ${template.description} ${template.schedule} ${template.source}`.toLowerCase().includes(normalizedQuery);
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
      <div className="automation-drag-strip" data-tauri-drag-region aria-hidden="true" />
      <div className="automation-topbar">
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
              </header>

              {tasks.length > 0 ? (
                <section className="automation-task-section" aria-label="当前自动化任务">
                  <h2>当前</h2>
                  <div className="automation-task-list">
                    {tasks.map((task) => (
                      <div
                        key={task.id}
                        className={`automation-task-row ${task.id === selectedTaskId ? 'active' : ''}`}
                      >
                        <button type="button" className="automation-task-main" onClick={() => inspectTask(task)}>
                          <span className="automation-task-status" aria-hidden="true" />
                          <span className="automation-task-copy">
                            <strong>{task.title}</strong>
                            <span>{task.kind === 'intraday-monitor' ? '交易时段自动运行' : 'Next run 待安排'} · {task.schedule}</span>
                          </span>
                        </button>
                        <span className="automation-task-meta">{task.kind === 'intraday-monitor' ? '盘中监控' : task.project === '选择项目' ? '手动创建' : task.project}</span>
                        <span className="automation-task-actions" aria-label="任务操作">
                          <button type="button" className="automation-task-action" aria-label="立即执行" title="立即执行" onClick={() => runTaskNow(task)}>
                            <Play size={14} />
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
                  <p>从预设开始创建计划任务</p>
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
            placeholder="描述 Codex 应该做什么"
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
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
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
          <div className="automation-time-popover" role="dialog" aria-label="选择时间">
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
    commit: <GitCommitHorizontal size={size} />,
    release: <FileText size={size} />,
    ci: <AlertCircle size={size} />,
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

function ChatArea({ domain }: { domain: DomainConfig }) {
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
            {codexStatus?.path && <code>{codexStatus.path}</code>}
          </div>
        </div>
      )}
      {isEmpty ? <EmptyState domain={domain} conversation={conversation} disabled={!codexReady} /> : <><div className="message-scroll"><MessageList conversation={conversation} /></div><Composer domain={domain} conversation={conversation} disabled={!codexReady} bottom /></>}
    </div>
  );
}

function DockOverlayComposer({ domain }: { domain: DomainConfig }) {
  const conversation = useCurrentConversation();
  const { codexReady } = useComposerRuntimeState();
  if (!conversation) return null;
  return (
    <div className="dock-composer-overlay">
      <Composer domain={domain} conversation={conversation} disabled={!codexReady} bottom allowCompact />
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

function EmptyState({ domain, conversation, disabled }: { domain: DomainConfig; conversation: Conversation; disabled: boolean }) {
  const [prefillRequest, setPrefillRequest] = useState<ComposerPrefillRequest | null>(null);
  const prefillComposer = (text: string) => {
    setPrefillRequest((prev) => ({ id: (prev?.id ?? 0) + 1, text }));
  };
  return (
    <div className="empty-state">
      <h1 className="empty-heading">{domain.ui.emptyHeading}</h1>
      <Composer domain={domain} conversation={conversation} disabled={disabled} prefillRequest={prefillRequest} />
      <div className="suggestion-row">
        {domain.ui.suggestions.map((suggestion) => (
          <button key={suggestion.id} type="button" className="suggestion-card" onClick={() => prefillComposer(suggestion.prompt)}>
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
          {(message.role !== 'user' || message.blocks.length > 0 || message.selectedSkill || message.coworkers?.length) && (
            <div className="bubble">
              {message.role === 'user'
                ? (
                    <>
                      {message.coworkers && message.coworkers.length > 0 && <MessageCoworkersLabel coworkers={message.coworkers} />}
                      {message.selectedSkill && <MessageSkillLabel skill={message.selectedSkill} />}
                      {message.blocks.map((block, index) => block.type === 'text' ? <MarkdownText key={index} content={block.content} variant="user" /> : <BlockRenderer key={index} block={block} />)}
                    </>
                  )
                : message.review
                  ? <ReviewBody message={message} cwd={conversation.cwd} />
	                  : buildRenderUnits(message.blocks).map((unit) =>
	                      unit.type === 'command-group'
	                        ? (unit.blocks.length === 1
	                            ? <BlockRenderer key={`tool-${unit.startIndex}`} block={unit.blocks[0]} />
	                            : <CommandGroup key={`cmd-group-${unit.startIndex}`} blocks={unit.blocks} />)
	                        : unit.type === 'web-search-group'
	                          ? (unit.blocks.length === 1
	                              ? <BlockRenderer key={`tool-${unit.startIndex}`} block={unit.blocks[0]} />
	                              : <WebSearchGroup key={`web-group-${unit.startIndex}`} blocks={unit.blocks} />)
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

// Chips on a user message showing which coworkers were summoned for the turn.
function MessageCoworkersLabel({ coworkers }: { coworkers: CoworkerSelection[] }) {
  return (
    <span className="message-coworkers-label" title={`召集同事：${coworkers.map((item) => `${item.no} ${item.name}`).join('、')}`}>
      <Users size={12} />
      {coworkers.map((coworker) => (
        <span key={coworker.id} className="message-coworker-chip">
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
    return <MarkdownText content={block.content} streaming={streaming} />;
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

function MarkdownText({ content, streaming, variant = 'assistant' }: { content: string; streaming?: boolean; variant?: 'assistant' | 'user' }) {
  const fileRefs = useMemo(() => variant === 'assistant' ? generatedFilesFromPlainText(content) : [], [content, variant]);
  return (
    <div className={`markdown-content markdown-${variant} ${streaming ? 'streaming' : ''}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>{content}</ReactMarkdown>
      {fileRefs.length > 0 && (
        <GeneratedFileResultView
          block={{
            type: 'file_result',
            id: `inline-files-${fileRefs.map((file) => file.path).join('|')}`,
            title: '生成文件',
            files: fileRefs,
          }}
        />
      )}
    </div>
  );
}

function ToolBlockView({ block }: { block: Extract<MessageBlock, { type: 'tool' }> }) {
  const tool = toolPresentation(block.title);
  const running = block.status === 'in_progress';
  const failed = block.status === 'failed';
  const verb = running ? tool.running : failed ? tool.failed : tool.done;
  const inferredTarget = inferredSpawnAgentToolTarget(block);
  const target = block.target || inferredTarget || firstLine(block.input);
  const targetIsRawInput = Boolean(!block.target && !inferredTarget && target);
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
          <span className={`event-target ${targetIsRawInput ? 'mono' : ''}`}>{target}</span>
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

function WebSearchGroup({ blocks }: { blocks: Array<Extract<MessageBlock, { type: 'tool' }>> }) {
  const anyRunning = blocks.some((block) => block.status === 'in_progress');
  const anyFailed = blocks.some((block) => block.status === 'failed');
  const state = anyRunning ? 'in_progress' : anyFailed ? 'failed' : 'completed';
  const verb = anyRunning ? '正在搜索网页' : anyFailed ? '网页搜索失败' : '已搜索网页';
  return (
    <EventDetails
      className={`tool-block event-block web-search-group ${state}`}
      forceOpen={anyRunning}
      summary={(
        <>
          <span className="event-icon web-search-group-icon"><Globe size={15} /></span>
          <span className="event-verb">{verb} {blocks.length} 次</span>
          <span className="event-target" />
          <span className="event-trailing">
            {anyRunning ? <Loader2 size={12} className="spin" /> : anyFailed ? <AlertCircle size={12} className="event-fail" /> : null}
            <ChevronDown size={13} className="event-chevron" />
          </span>
        </>
      )}
    >
      <div className="tool-group-items">
        {blocks.map((block) => <ToolBlockView key={block.id} block={block} />)}
      </div>
    </EventDetails>
  );
}

type RenderUnit =
  | { type: 'block'; block: MessageBlock; index: number }
  | { type: 'command-group'; blocks: Array<Extract<MessageBlock, { type: 'tool' }>>; startIndex: number }
  | { type: 'web-search-group'; blocks: Array<Extract<MessageBlock, { type: 'tool' }>>; startIndex: number };

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
    } else if (isWebSearchBlock(blocks[index])) {
      const group: Array<Extract<MessageBlock, { type: 'tool' }>> = [];
      const startIndex = index;
      while (index < blocks.length && isWebSearchBlock(blocks[index])) {
        group.push(blocks[index] as Extract<MessageBlock, { type: 'tool' }>);
        index += 1;
      }
      units.push({ type: 'web-search-group', blocks: group, startIndex });
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

function isReconnectStatusBlock(block: MessageBlock): boolean {
  return block.type === 'error' && /^Reconnecting\.\.\.\s+\d+\/\d+$/i.test(block.content.trim());
}

function Composer({
  domain,
  conversation,
  disabled,
  bottom,
  prefillRequest,
  allowCompact,
}: {
  domain: DomainConfig;
  conversation: Conversation;
  disabled?: boolean;
  bottom?: boolean;
  prefillRequest?: ComposerPrefillRequest | null;
  allowCompact?: boolean;
}) {
  const [value, setValue] = useState('');
  const [attachments, setAttachments] = useState<MessageAttachment[]>([]);
  const [selectedSkill, setSelectedSkill] = useState<SkillCatalogItem | null>(null);
  const [selectedCoworkers, setSelectedCoworkers] = useState<CoworkerSelection[]>([]);
  const [coworkerDragOver, setCoworkerDragOver] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { queuedSkill, queuedSkillPrompt, consumeQueuedSkill, queuedCoworkerTask, consumeQueuedCoworkerTask } = useSkillRuntime();
  const sendMessage = useChatStore((state) => state.sendMessage);
  const removeQueuedMessage = useChatStore((state) => state.removeQueuedMessage);
  const updateQueuedMessage = useChatStore((state) => state.updateQueuedMessage);
  const reorderQueuedMessage = useChatStore((state) => state.reorderQueuedMessage);
  const sendQueuedMessageNow = useChatStore((state) => state.sendQueuedMessageNow);
  const stopCurrentConversation = useChatStore((state) => state.stopCurrentConversation);
  const isStreaming = conversation.status === 'streaming';
  const queuedMessages = conversation.queuedMessages ?? [];
  const contextUsage = useMemo(() => contextWindowUsage(conversation), [conversation]);
  const compact = Boolean(allowCompact) && !value && attachments.length === 0 && !selectedSkill && selectedCoworkers.length === 0;
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    if (compact) {
      el.style.height = '24px';
      return;
    }
    el.style.height = '0px';
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [compact, value]);
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
  const handleCoworkerDragOver = (event: ReactDragEvent<HTMLElement>) => {
    if (!event.dataTransfer.types.includes(COWORKER_DRAG_MIME) && !event.dataTransfer.types.includes(RESEARCH_DRAG_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setCoworkerDragOver(true);
  };
  const handleCoworkerDrop = (event: ReactDragEvent<HTMLElement>) => {
    const coworker = readCoworkerDrag(event);
    const researchPrompt = coworker ? '' : readResearchDrag(event);
    setCoworkerDragOver(false);
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
  const removeAttachment = (id: string) => setAttachments((prev) => prev.filter((item) => item.id !== id));
  const canSend = Boolean(value.trim() || attachments.length);
  const submit = () => {
    if (!canSend || disabled) return;
    const outgoing = attachments;
    const outgoingSkill = selectedSkill;
    const outgoingCoworkers = selectedCoworkers;
    setValue('');
    setAttachments([]);
    setSelectedSkill(null);
    setSelectedCoworkers([]);
    void sendMessage(value.trim(), outgoing, outgoingSkill, outgoingCoworkers);
  };
  return (
    <div className={`composer-wrap ${bottom ? 'bottom' : ''} ${queuedMessages.length > 0 ? 'has-queue' : ''}`}>
      {queuedMessages.length > 0 && (
        <ComposerQueue
          queuedMessages={queuedMessages}
          onRemove={(id) => removeQueuedMessage(conversation.id, id)}
          onUpdate={(id, text) => updateQueuedMessage(conversation.id, id, { text })}
          onReorder={(id, beforeId) => reorderQueuedMessage(conversation.id, id, beforeId)}
          onGuide={(id) => void sendQueuedMessageNow(conversation.id, id)}
        />
      )}
      <div
        className={`composer-card ${compact ? 'compact' : ''} ${coworkerDragOver ? 'coworker-drag-over' : ''}`}
        onDragOver={handleCoworkerDragOver}
        onDragLeave={() => setCoworkerDragOver(false)}
        onDrop={handleCoworkerDrop}
      >
        {selectedCoworkers.length > 0 && (
          <div className="composer-coworkers">
            <span className="composer-coworkers-label">
              <Users size={13} />
              {selectedCoworkers.length > 1 ? '召集同事协同' : '召集同事'}
            </span>
            {selectedCoworkers.map((coworker) => (
              <span key={coworker.id} className="composer-coworker-chip">
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
          disabled={disabled}
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
          <ComposerPlusMenu domain={domain} onAttach={addAttachments} onSelectSkill={setSelectedSkill} disabled={disabled} />
          <ApprovalPicker />
          <span className="spacer" />
          <ContextWindowIndicator usage={contextUsage} />
          <ModelPicker />
          {isStreaming && canSend && (
            <button className="send-button queue" type="button" onClick={submit} disabled={disabled} aria-label="加入队列">
              <CornerDownRight size={17} />
            </button>
          )}
          {isStreaming ? (
            <button className="send-button stop" type="button" onClick={() => void stopCurrentConversation()} aria-label="停止">
              <Square size={12} fill="currentColor" strokeWidth={0} />
            </button>
          ) : (
            <button className="send-button" type="button" onClick={submit} disabled={!canSend || disabled} aria-label="发送">
              <ArrowUp size={18} />
            </button>
          )}
        </div>
      </div>
      <ComposerMeta conversation={conversation} />
    </div>
  );
}

function ContextWindowIndicator({ usage }: { usage: ContextWindowUsage }) {
  const label = usage.source === 'codex' ? 'Codex 实际上下文窗口' : '本地估算背景信息窗口';
  const detail = [
    `${label}：${usage.usedPercent}% 已用（剩余 ${usage.remainingPercent}%）`,
    `已用 ${formatTokenCount(usage.usedTokens)} 标记，共 ${formatTokenCount(usage.totalTokens)}`,
    `压缩阈值 ${usage.compactThresholdPercent}%（${formatTokenCount(usage.compactThresholdTokens)} 标记）`,
    usage.source === 'codex'
      ? (usage.compacted ? 'Codex 已执行上下文压缩' : '尚未收到 Codex 压缩事件')
      : (usage.compacted ? `已压缩前 ${usage.compactedMessageCount} 条消息` : '尚未压缩'),
  ].join('\n');
  return (
    <span
      className={`context-window-indicator ${usage.shouldCompact ? 'warning' : ''} ${usage.compacted ? 'compacted' : ''}`}
      title={detail}
      aria-label={detail}
    >
      <Layers size={12} />
      <span>{usage.usedPercent}% 已用</span>
    </span>
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
  onGuide: (id: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

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
              draggable={!isEditing}
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
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        event.preventDefault();
                        cancelEdit();
                      }
                      if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
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
                      onClick={() => onGuide(message.id)}
                      aria-label={`引导发送队列消息 ${preview}`}
                      title="优先发送"
                    >
                      <CornerDownRight size={15} />
                      引导
                    </button>
                    <button
                      type="button"
                      className="composer-queue-remove"
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
  if (message.selectedSkill) parts.push(`$${message.selectedSkill.title}`);
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

function MarkdownLink({
  href,
  children,
  node: _node,
  className,
  onClick,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { node?: unknown }) {
  const openBrowserUrl = useBrowserDockOpener();
  const openFileInDock = useFileDockOpener();
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

  return (
    <a {...props} href={href} className={linkClassName} onClick={handleClick}>
      {fileLink && fileExt ? <span className={`markdown-file-icon tone-${fileTone(fileExt)}`}>{fileGlyph(fileExt, 15)}</span> : null}
      {fileLink ? <span className="markdown-link-text">{children}</span> : children}
    </a>
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

function stripTrailingFilePunctuation(path: string): string {
  return path.trim().replace(/[),.;，。]+$/g, '');
}

const MARKDOWN_COMPONENTS = {
  img: MarkdownImage,
  a: MarkdownLink,
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
  const openFileInDock = useFileDockOpener();
  const openBrowserUrl = useBrowserDockOpener();
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
        <span>打开方式</span>
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
                        <span>{skill.title}</span>
                      </button>
                    ))}
                    <div className="plus-menu-hint">金融版会在这里扩展投研数据、资料处理和自动化技能。</div>
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

function codexSubscriptionModelsVisible(codexStatus: { loggedIn: boolean } | null, session: ClientLicenseSession | null): boolean {
  if (session && !session.tenant.codexSubscriptionEnabled) return false;
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
  const visibleEnabledProfiles = visibleModelProfilesForCodexStatus(enabledProfiles, codexStatus, clientLicenseSession);
  const selectedModelProfile = visibleEnabledProfiles.find((profile) => profile.id === selectedModelProfileId) ?? visibleEnabledProfiles[0] ?? resolveModelProfile(modelProfiles, selectedModelProfileId);
  const builtInProfiles = visibleEnabledProfiles.filter((profile) => profile.builtIn);
  const customProfiles = visibleEnabledProfiles.filter((profile) => !profile.builtIn);
  const effortOptions = useMemo(
    () => reasoningEffortOptionsForProfile(selectedModelProfile),
    [selectedModelProfile],
  );
  const close = () => { setOpen(false); setSubmenu(null); };
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
  }, [open, visibleEnabledProfiles.length, reasoningEffort, selectedModelProfile.id, speed, effortOptions]);
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
        {speed === 'fast' && <Zap size={12} className="model-pill-fast" />}<span>{shortModelProfileLabel([selectedModelProfile], selectedModelProfile.id)}</span>{effortOptions.length > 0 && <span className="model-pill-effort">{effortLabel(reasoningEffort)}</span>}<ChevronDown size={12} />
      </button>
      {open && (
        <>
          <button className="menu-backdrop" type="button" aria-label="关闭模型菜单" onClick={close} />
          <div ref={menuRef} className="model-menu model-choice-menu" role="menu" style={menuStyle} onMouseLeave={() => setSubmenu(null)}>
            {effortOptions.length > 0 && <><div className="model-menu-label">智能</div>{effortOptions.map((option) => <button key={option.id} type="button" role="menuitemradio" aria-checked={option.id === reasoningEffort} className="model-menu-item" onMouseEnter={() => setSubmenu(null)} onClick={() => { setReasoningEffort(option.id); close(); }}><span>{option.label}</span>{option.id === reasoningEffort && <Check size={14} className="model-menu-check" />}</button>)}<div className="model-menu-divider" /></>}
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
    (unit) => unit.type !== 'block' || unit.block.type !== 'text',
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
        <SettingsNavGroup label="基础与账户" items={domain.navigation.personal} section={section} onSectionChange={onSectionChange} />
        <SettingsNavGroup label="金融数据" items={domain.navigation.integrations} section={section} onSectionChange={onSectionChange} />
        <SettingsNavGroup label="数据管理" items={domain.navigation.archived} section={section} onSectionChange={onSectionChange} />
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
  if (section === 'archived') return <ArchivedSettings />;
  if (section === 'jqdata') return <JqDataSettings />;
  if (section === 'usage') return <UsageSettings />;
  if (section === 'profile') return <ProfileSettings />;
  if (section === 'general') {
    return (
      <SettingsGroup>
        <SettingsRow title="界面主题" description="选择适合阅读研究报告和行情信息的显示方式。">
          <SettingsSegment value={theme} onChange={onThemeChange} options={[{ id: 'light', label: '浅色', icon: <Sun size={13} /> }, { id: 'dark', label: '深色', icon: <Moon size={13} /> }]} />
        </SettingsRow>
        <SettingsRow title="界面语言" description="Alpha Studio 金融版默认使用简体中文。"><span className="settings-static">简体中文</span></SettingsRow>
      </SettingsGroup>
    );
  }
	return null;
	}

function JqDataSettings() {
  const [config, setConfig] = useState<JqDataConfig>(() => emptyJqDataConfig());
  const [enabled, setEnabled] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [apiUrl, setApiUrl] = useState('https://dataapi.joinquant.com/v2/apis');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const hydrate = useCallback((next: JqDataConfig) => {
    setConfig(next);
    setEnabled(next.enabled);
    setUsername(next.username);
    setApiUrl(next.apiUrl || 'https://dataapi.joinquant.com/v2/apis');
    setPassword('');
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void loadJqDataConfig()
      .then((next) => {
        if (!cancelled) hydrate(next);
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
  }, [hydrate]);

  const canSave = !enabled || Boolean(username.trim());

  const save = async () => {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await saveJqDataConfig({
        enabled,
        username,
        password: password.trim() || undefined,
        apiUrl,
      });
      const next = await loadJqDataConfig();
      hydrate(next);
      setNotice('聚宽数据配置已保存');
      return true;
    } catch (err) {
      setError(stringifyError(err));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!canSave || saving) return;
    void save();
  };

  return (
    <>
      <form className="jqdata-settings-form" onSubmit={submit}>
        <div className="settings-subtitle">聚宽账号</div>
        <div className="jqdata-form-grid">
          <label>
            <span>启用数据源</span>
            <span className="jqdata-toggle-row">
              <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
              <em>{enabled ? '已启用' : '未启用'}</em>
            </span>
          </label>
          <label>
            <span>账号</span>
            <input className="settings-input" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="手机号或聚宽账号" />
          </label>
          <label>
            <span>密码</span>
            <input className="settings-input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={config.passwordConfigured ? '已保存，留空则不修改' : '聚宽登录密码'} />
          </label>
        </div>
        <div className="jqdata-form-actions">
          {notice && <span className="settings-state-pill ready">{notice}</span>}
          {error && <span className="settings-inline-error">{error}</span>}
          <button className="settings-btn primary" type="submit" disabled={!canSave || saving}>
            {saving ? <Loader2 size={13} className="spin" /> : <Check size={13} />}
            保存
          </button>
        </div>
      </form>

    </>
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
    ? `${selectedUsesGateway && !codexStatus?.loggedIn ? '本地 AI 运行环境可用于按量模型' : '本地 AI 运行环境已就绪'}${codexStatus?.version ? ` · ${codexStatus.version}` : ''}`
    : '本地 AI 运行环境未就绪';
  const codexRuntimeDescription = codexStatus?.installed && selectedUsesGateway && !codexStatus.loggedIn
    ? '按量模型无需 Codex 订阅设备授权。'
    : codexStatus?.loggedIn
      ? codexStatus.path
      : (codexStatus?.error || codexStatus?.path || '请确认本地 AI 运行环境已安装并完成设备授权。');

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
  const session = useChatStore((state) => state.clientLicenseSession);
  const [summary, setSummary] = useState<ClientBillingSummary | null>(null);
  const [codexUsage, setCodexUsage] = useState<CodexSubscriptionUsage | null>(null);
  const [loading, setLoading] = useState(false);
  const [codexUsageLoading, setCodexUsageLoading] = useState(false);
  const [error, setError] = useState('');
  const [codexUsageError, setCodexUsageError] = useState('');

  const refresh = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setCodexUsageLoading(true);
    setError('');
    setCodexUsageError('');

    const shouldLoadCodexUsage = Boolean(session.tenant.codexSubscriptionEnabled || session.codexAccounts.length > 0);
    const [billingResult, codexResult] = await Promise.allSettled([
      fetchClientBillingSummary(session),
      shouldLoadCodexUsage ? fetchCodexSubscriptionUsage() : Promise.resolve(null),
    ]);

    if (billingResult.status === 'fulfilled') {
      setSummary(billingResult.value);
    } else {
      setError(stringifyError(billingResult.reason));
    }

    if (codexResult.status === 'fulfilled') {
      setCodexUsage(codexResult.value);
    } else {
      setCodexUsageError(stringifyError(codexResult.reason));
    }

    setLoading(false);
    setCodexUsageLoading(false);
  }, [session]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const tenant = summary?.tenant ?? session?.tenant;
  const billingMode = tenant?.billingMode || defaultBillingModeForSession(session);
  const currentMonth = summary?.usage?.currentMonth ?? EMPTY_BILLING_USAGE;
  const allTime = summary?.usage?.allTime ?? EMPTY_BILLING_USAGE;
  const models = summary?.usage?.models ?? [];
  const recentLedger = summary?.usage?.recentLedger ?? [];
  const generatedAt = summary?.period?.generatedAt ? formatLicenseDate(summary.period.generatedAt) : loading ? '同步中' : '尚未同步';
  const monthLabel = summary?.period?.currentMonthStart
    ? `${formatMonthLabel(summary.period.currentMonthStart)}账期`
    : '当前账期';
  const codexSubscriptionEnabled = Boolean(tenant?.codexSubscriptionEnabled);
  const apiSubscriptionEnabled = Boolean(tenant?.subscriptionPlan);

  return (
    <>
      <section className="billing-overview" aria-label="账单总览">
        <div className="billing-overview-head">
          <div>
            <strong>{monthLabel}</strong>
            <span>数据更新时间：{generatedAt}</span>
          </div>
          <button className="settings-btn" type="button" onClick={() => void refresh()} disabled={!session || loading} aria-label="刷新账单">
            <RefreshCw size={13} className={loading ? 'spin' : ''} />
            <span>刷新</span>
          </button>
        </div>
        <div className="billing-metrics">
          <BillingMetric label="本月按量费用" value={formatYuan(currentMonth.billableYuan)} meta={`${formatWholeNumber(currentMonth.runCount)} 次调用`} />
          <BillingMetric label="账户余额" value={formatYuan(tenant?.balanceYuan ?? 0)} meta="API 网关预付余额" tone={(tenant?.balanceYuan ?? 0) <= 0 ? 'warning' : 'default'} />
          <BillingMetric label="本月 Tokens" value={formatWholeNumber(currentMonth.totalTokens)} meta={formatUsageBreakdown(currentMonth)} />
        </div>
        {error && <div className="billing-alert"><AlertCircle size={14} />{error}</div>}
      </section>

      <SettingsGroup>
        <SettingsRow title="计费模式" description="订阅模型按席位或套餐授权，API 网关按真实 token 用量结算。">
          <span className="settings-static">{formatBillingMode(billingMode)}</span>
        </SettingsRow>
        <SettingsRow title="客户" description="当前设备激活的计费主体。">
          <span className="settings-static">{tenant?.name || '未激活'}</span>
        </SettingsRow>
        <SettingsRow title="活跃设备" description="该客户当前处于激活状态的设备数量。">
          <span className="settings-static">{summary?.activeDevices ?? tenant?.maxDevices ?? 0} / {tenant?.maxDevices ?? '-'}</span>
        </SettingsRow>
      </SettingsGroup>

      <div className="settings-subtitle">订阅</div>
      <SettingsGroup>
        <SettingsRow title="Codex 订阅" description={codexSubscriptionEnabled ? `套餐 ${formatPlanLabel(tenant?.codexSubscriptionPlan)} · ${formatExpiryLabel(tenant?.codexSubscriptionExpiresAt)}` : '未启用 Codex 订阅模型。'}>
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
        <SettingsRow title="本月费用" description={formatUsageBreakdown(currentMonth)}>
          <span className="settings-static">{formatYuan(currentMonth.billableYuan)}</span>
        </SettingsRow>
        <SettingsRow title="累计费用" description={`累计 ${formatWholeNumber(allTime.runCount)} 次调用 · ${formatWholeNumber(allTime.totalTokens)} tokens`}>
          <span className="settings-static">{formatYuan(allTime.billableYuan)}</span>
        </SettingsRow>
        <SettingsRow title="最近使用" description="最近一笔按量调用产生的时间。">
          <span className="settings-static">{formatLicenseDate(currentMonth.lastUsedAt || allTime.lastUsedAt)}</span>
        </SettingsRow>
      </SettingsGroup>

      <BillingModelTable models={models} />
      <BillingLedgerList entries={recentLedger} />
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

function BillingModelTable({ models }: { models: BillingModelUsage[] }) {
  return (
    <section className="billing-table-section" aria-label="模型用量">
      <div className="billing-section-title">
        <strong>模型用量</strong>
        <span>按本月按量费用排序</span>
      </div>
      {models.length === 0 ? (
        <div className="billing-empty">本月还没有按量 API 消耗。</div>
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
                <tr key={model.modelId}>
                  <td>
                    <strong>{model.label || model.modelId}</strong>
                    <span>{model.provider || model.modelId}</span>
                  </td>
                  <td>{formatWholeNumber(model.runCount)}</td>
                  <td title={formatUsageBreakdown(model)}>{formatWholeNumber(model.totalTokens)}</td>
                  <td>{formatYuan(model.billableYuan)}</td>
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
  if (loading && !usage) return '正在从 Codex CLI 同步。';
  if (error && !usage) return `Codex CLI 读取失败：${error}`;
  if (usage?.generatedAt) return `来自 Codex CLI · 更新 ${formatLicenseDate(usage.generatedAt)}`;
  return '来自 Codex CLI。';
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

function BillingLedgerList({ entries }: { entries: BillingLedgerEntry[] }) {
  return (
    <section className="billing-ledger" aria-label="最近账单流水">
      <div className="billing-section-title">
        <strong>最近账单流水</strong>
        <span>网关扣费和余额变动</span>
      </div>
      {entries.length === 0 ? (
        <div className="billing-empty">暂无账单流水。</div>
      ) : (
        <div className="billing-ledger-list">
          {entries.map((entry) => (
            <div className="billing-ledger-row" key={entry.id}>
              <div>
                <strong>{entry.description || formatLedgerEntryType(entry.entryType)}</strong>
                <span>{formatLicenseDate(entry.createdAt)}{entry.runId ? ` · ${entry.runId}` : ''}</span>
              </div>
              <em className={entry.amountYuan < 0 ? 'charge' : 'credit'}>{formatSignedYuan(entry.amountYuan)}</em>
            </div>
          ))}
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

function formatLedgerEntryType(type: string): string {
  if (type === 'usage_charge') return '按量扣费';
  if (type === 'topup') return '余额充值';
  if (type === 'adjustment') return '账务调整';
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

function formatMonthLabel(value: string): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return value;
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long' }).format(time);
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
    usage: <History size={15} />,
    jqdata: <Database size={15} />,
    archived: <Archive size={15} />,
  };
  return icons[section];
}

function domainSuggestionIcon(suggestion: DomainSuggestion): ReactNode {
  const icons: Record<DomainSuggestion['icon'], ReactNode> = {
    report: <FileChartColumn size={16} className="icon" />,
    monitor: <Activity size={16} className="icon" />,
    review: <MoonStar size={16} className="icon" />,
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
  if (has('context_compaction', 'contextcompaction', 'context compaction')) {
    return { kind: 'generic', icon: <Workflow size={14} />, running: '正在压缩上下文', done: '已压缩上下文', failed: '上下文压缩失败' };
  }
  if (has('stderr')) return { kind: 'log', icon: <FileText size={14} />, running: 'Codex 日志', done: 'Codex 日志', failed: 'Codex 日志' };
  if (/image[\s._-]*gen|generate[\s._-]*image|image[\s._-]*generation|text[\s._-]*to[\s._-]*image/.test(normalized)) {
    return { kind: 'image', icon: <ImageIcon size={14} />, running: '正在生成图片', done: '已生成图片', failed: '图片生成失败' };
  }
  if (has('exec', 'shell', 'command', 'bash', 'execute', 'terminal')) return { kind: 'command', icon: <Terminal size={14} />, running: '正在运行', done: '已运行', failed: '运行失败' };
  if (isWebSearchToolTitle(title)) return { kind: 'web', icon: <Globe size={14} />, running: '正在搜索网页', done: '已搜索网页', failed: '网页搜索失败' };
  if (isSpawnAgentToolTitle(title)) return { kind: 'generic', icon: <Users size={14} />, running: '正在调用同事', done: '已调用同事', failed: '同事调用失败' };
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
  const localPath = localFilePath(url);
  if (isTauriRuntime()) {
    try {
      await invoke('open_external_target', { request: { target: localPath || url } });
      return;
    } catch {
      // Fall back to the plugin opener below for older desktop builds.
    }
    try {
      const { openPath, openUrl } = await import('@tauri-apps/plugin-opener');
      if (localPath) await openPath(localPath);
      else await openUrl(url);
      return;
    } catch {
      // Fall back to the web behavior below.
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

function localFileBrowserUrl(path: string): string {
  if (isTauriRuntime()) {
    try {
      return convertFileSrc(path);
    } catch {
      // Fall through to a file URL for degraded runtimes.
    }
  }
  return pathToFileUrl(path);
}

function pathToFileUrl(path: string): string {
  if (path.startsWith('file://')) return path;
  return `file://${path.split('/').map((part) => encodeURIComponent(part)).join('/')}`;
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
