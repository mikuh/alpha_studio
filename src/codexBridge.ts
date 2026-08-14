import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { CoworkerAgentDefinition } from './coworkers';
import type { ModelProfile } from './models';
import type { ClientLicenseSession } from './license';
import type {
  CodexChatEvent,
  CodexStatus,
  CodexModelCatalogItem,
  GhAuthStatus,
  GitBranch,
  GitCommandResult,
  GitCommit,
  GitDiffStat,
  GitRemote,
  GitStatus,
  MessageAttachment,
  OpenAppId,
  SandboxMode,
  SkillSelection,
  TerminalEvent,
} from './types';

export const CODEX_CHAT_EVENT = 'codex-chat-event';
export const TERMINAL_EVENT = 'terminal-event';

export interface CodexChatStartRequest {
  conversationId: string;
  prompt: string;
  codexThreadId?: string;
  cwd?: string;
  model?: string;
  providerId?: string;
  providerBaseUrl?: string;
  providerApiKey?: string;
  providerWireApi?: string;
  providerContextWindowTokens?: number;
  providerMaxOutputTokens?: number;
  providerThinkingEnabled?: boolean;
  reasoningEffort?: string;
  serviceTier?: 'fast';
  sandboxMode?: SandboxMode;
  developerInstructions?: string;
  selectedSkill?: SkillSelection;
  attachments?: MessageAttachment[];
}

export interface CodexChatStartResult {
  runId: string;
}

export interface CodexAuthorizationResult {
  codexHome: string;
}

export type CodexLoginResult = CodexAuthorizationResult;

export interface CodexRateLimitWindow {
  usedPercent: number;
  windowDurationMins?: number | null;
  resetsAt?: number | null;
}

export interface CodexRateLimitSnapshot {
  limitId?: string | null;
  limitName?: string | null;
  primary?: CodexRateLimitWindow | null;
  secondary?: CodexRateLimitWindow | null;
  credits?: {
    hasCredits?: boolean;
    unlimited?: boolean;
    balance?: string | number | null;
  } | null;
  planType?: string | null;
  rateLimitReachedType?: string | null;
}

export interface CodexSubscriptionUsage {
  source: 'codex-cli';
  generatedAt: string;
  rateLimits: CodexRateLimitSnapshot;
  rateLimitsByLimitId?: Record<string, CodexRateLimitSnapshot> | null;
  rateLimitResetCredits?: {
    availableCount?: number | string | null;
  } | null;
}

export interface ModelConfigFile {
  selectedModelProfileId?: string;
  modelProfiles: ModelProfile[];
  path?: string;
}

export interface ManagedSkillsSyncResult {
  status: 'installed' | 'current' | 'no-release' | 'incompatible' | string;
  version?: string | null;
  channel: string;
  skillNames: string[];
  message: string;
}

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function checkCodex(): Promise<CodexStatus> {
  if (!isTauriRuntime()) {
    return {
      installed: false,
      version: 'browser preview',
      path: '',
      loggedIn: false,
      error: '浏览器预览模式不会启动 GPT。请使用桌面客户端。',
    };
  }
  return invoke<CodexStatus>('codex_check');
}

export async function syncManagedSkills(
  session: ClientLicenseSession,
  channel = 'stable',
): Promise<ManagedSkillsSyncResult | null> {
  if (!isTauriRuntime()) return null;
  return invoke<ManagedSkillsSyncResult>('managed_skills_sync', {
    request: {
      apiBaseUrl: session.apiBaseUrl,
      tenantId: session.tenant.id,
      deviceId: session.device.id,
      accessToken: session.device.accessToken,
      channel,
    },
  });
}

export async function listCodexModels(forceRefetch: boolean): Promise<CodexModelCatalogItem[]> {
  if (!isTauriRuntime()) return [];
  return invoke<CodexModelCatalogItem[]>('codex_models', { request: { forceRefetch } });
}

export async function loginCodex(): Promise<CodexLoginResult | null> {
  if (!isTauriRuntime()) return null;
  return invoke<CodexLoginResult>('codex_login');
}

export async function revokeCodexAuthorization(): Promise<CodexAuthorizationResult | null> {
  if (!isTauriRuntime()) return null;
  return invoke<CodexAuthorizationResult>('codex_revoke_authorization');
}

export async function fetchCodexSubscriptionUsage(): Promise<CodexSubscriptionUsage | null> {
  if (!isTauriRuntime()) return null;
  return invoke<CodexSubscriptionUsage>('codex_subscription_usage');
}

export async function startCodexChat(request: CodexChatStartRequest): Promise<CodexChatStartResult> {
  return invoke<CodexChatStartResult>('codex_chat_start', { request });
}

export interface CoworkersSyncResult {
  agentsDir: string;
  written: number;
}

// Materializes the coworker catalog into Codex custom agent files
// (CODEX_HOME/agents/<id>.toml) so the main agent can spawn them.
export async function syncCoworkerAgents(
  definitions: CoworkerAgentDefinition[],
): Promise<CoworkersSyncResult | null> {
  if (!isTauriRuntime()) return null;
  return invoke<CoworkersSyncResult>('coworkers_sync', { request: { definitions } });
}

export async function stopCodexChat(runId: string): Promise<boolean> {
  const result = await invoke<{ stopped: boolean }>('codex_chat_stop', { request: { runId } });
  return result.stopped;
}

export async function loadModelConfig(): Promise<ModelConfigFile | null> {
  if (!isTauriRuntime()) return null;
  return invoke<ModelConfigFile>('model_config_load');
}

export async function saveModelConfig(config: ModelConfigFile): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  const result = await invoke<{ path: string }>('model_config_save', { request: config });
  return result.path;
}

export async function revealPath(path: string): Promise<boolean> {
  if (!path || !isTauriRuntime()) return false;
  try {
    await invoke('reveal_local_path', { request: { path } });
    return true;
  } catch {
    return false;
  }
}

export async function openLocalPath(path: string): Promise<boolean> {
  if (!path || !isTauriRuntime()) return false;
  try {
    await invoke('open_external_target', { request: { target: path } });
    return true;
  } catch {
    return false;
  }
}

export interface HtmlToPdfRequest {
  htmlPath: string;
  pdfPath?: string;
  openWhenDone?: boolean;
}

export interface HtmlToPdfResult {
  pdfPath: string;
  engine: string;
  attempts: string[];
  warnings: string[];
}

export async function htmlToPdf(request: HtmlToPdfRequest): Promise<HtmlToPdfResult | null> {
  if (!isTauriRuntime()) return null;
  return invoke<HtmlToPdfResult>('html_to_pdf', { request });
}

export async function createProjectFolder(name: string): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  const result = await invoke<{ path: string }>('project_folder_create', { request: { name } });
  return result.path;
}

export async function renameProjectFolder(currentPath: string, name: string): Promise<string | null> {
  if (!currentPath || !isTauriRuntime()) return null;
  const result = await invoke<{ path: string }>('project_folder_rename', { request: { currentPath, name } });
  return result.path;
}

export async function localImageDataUrl(path: string): Promise<string | null> {
  if (!path || !isTauriRuntime()) return null;
  try {
    return await invoke<string>('local_image_data_url', { request: { path } });
  } catch {
    return null;
  }
}

export async function localFileExists(path: string): Promise<boolean> {
  if (!path || !isTauriRuntime()) return true;
  try {
    const exists = await invoke<unknown>('local_file_exists', { request: { path } });
    // Fail open when paired with an older desktop backend that does not yet
    // expose this command, so a compatibility issue never hides real files.
    return typeof exists === 'boolean' ? exists : true;
  } catch {
    return true;
  }
}

export interface LocalTextFileResult {
  path: string;
  content: string;
  bytes: number;
  truncated: boolean;
}

export interface LocalDirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isSymlink: boolean;
  bytes: number;
}

export async function localTextFileRead(path: string): Promise<LocalTextFileResult> {
  if (!path || !isTauriRuntime()) {
    return { path, content: '', bytes: 0, truncated: false };
  }
  return invoke<LocalTextFileResult>('local_text_file_read', { request: { path } });
}

export async function localDirectoryList(path: string): Promise<LocalDirectoryEntry[]> {
  if (!path) return [];
  if (!isTauriRuntime()) {
    throw new Error('浏览器预览模式无法读取本地目录，请在桌面应用中使用。');
  }
  return invoke<LocalDirectoryEntry[]>('local_directory_list', { request: { path } });
}

export interface LocalPdfFileResult {
  path: string;
  data: string;
  bytes: number;
}

export async function localPdfFileRead(path: string): Promise<LocalPdfFileResult> {
  if (!path || !isTauriRuntime()) {
    return { path, data: '', bytes: 0 };
  }
  return invoke<LocalPdfFileResult>('local_pdf_file_read', { request: { path } });
}

export type BrowserWebviewEventType =
  | 'load-started'
  | 'load-finished'
  | 'title-changed'
  | 'new-window'
  | 'download-started'
  | 'download-finished';

export interface BrowserWebviewEvent {
  id: string;
  type: BrowserWebviewEventType;
  url?: string;
  title?: string;
  path?: string;
  success?: boolean;
}

export interface BrowserWebviewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type BrowserWebviewAction = 'back' | 'forward' | 'reload' | 'stop' | 'focus' | 'print' | 'show' | 'hide';

export async function browserWebviewCreate(id: string, url: string, bounds: BrowserWebviewBounds, visible: boolean): Promise<void> {
  await invoke('browser_webview_create', { request: { id, url, ...bounds, visible } });
}

export async function browserWebviewNavigate(id: string, url: string): Promise<void> {
  await invoke('browser_webview_navigate', { request: { id, url } });
}

export async function browserWebviewSetBounds(id: string, bounds: BrowserWebviewBounds, visible: boolean): Promise<void> {
  await invoke('browser_webview_set_bounds', { request: { id, ...bounds, visible } });
}

export async function browserWebviewAction(id: string, action: BrowserWebviewAction): Promise<void> {
  await invoke('browser_webview_action', { request: { id, action } });
}

export async function browserWebviewClose(id: string): Promise<void> {
  await invoke('browser_webview_close', { request: { id } });
}

export async function subscribeBrowserWebviewEvents(
  handler: (event: BrowserWebviewEvent) => void,
): Promise<UnlistenFn> {
  return listen<BrowserWebviewEvent>('browser-webview-event', (event) => handler(event.payload));
}

export async function subscribeCodexEvents(
  handler: (event: CodexChatEvent) => void,
): Promise<UnlistenFn | null> {
  if (!isTauriRuntime()) return null;
  return listen<CodexChatEvent>(CODEX_CHAT_EVENT, (event) => {
    handler(event.payload);
  });
}

export async function gitStatus(cwd: string): Promise<GitStatus> {
  if (!isTauriRuntime()) return browserGitStatus(cwd);
  return invoke<GitStatus>('git_status', { request: { cwd } });
}

export async function gitDiff(
  cwd: string,
  path?: string,
  staged = false,
  untracked = false,
  context?: number,
): Promise<string> {
  if (!isTauriRuntime()) return '';
  return invoke<string>('git_diff', { request: { cwd, path, staged, untracked, context } });
}

// Opens the GitHub "create pull request" page in the browser (gh pr create --web).
export async function ghPrCreateWeb(cwd: string): Promise<GitCommandResult> {
  if (!isTauriRuntime()) return { stdout: '', stderr: '浏览器预览模式无法创建拉取请求。' };
  return invoke<GitCommandResult>('gh_pr_create_web', { request: { cwd } });
}

export async function gitDiscard(cwd: string, paths: string[]): Promise<GitCommandResult> {
  if (!isTauriRuntime()) return { stdout: '', stderr: '' };
  return invoke<GitCommandResult>('git_discard', { request: { cwd, paths } });
}

// Stage (or, with reverse, unstage) a single hunk by applying its patch to the
// index. `patch` is a self-contained unified diff (file header + one hunk).
export async function gitApplyPatch(
  cwd: string,
  patch: string,
  reverse = false,
): Promise<GitCommandResult> {
  if (!isTauriRuntime()) return { stdout: '', stderr: '' };
  return invoke<GitCommandResult>('git_apply_patch', { request: { cwd, patch, reverse } });
}

export async function gitStage(cwd: string, paths: string[]): Promise<GitCommandResult> {
  if (!isTauriRuntime()) return { stdout: '', stderr: '' };
  return invoke<GitCommandResult>('git_stage', { request: { cwd, paths } });
}

export async function gitUnstage(cwd: string, paths: string[]): Promise<GitCommandResult> {
  if (!isTauriRuntime()) return { stdout: '', stderr: '' };
  return invoke<GitCommandResult>('git_unstage', { request: { cwd, paths } });
}

export async function gitCommit(cwd: string, message: string): Promise<GitCommandResult> {
  if (!isTauriRuntime()) return { stdout: '', stderr: '浏览器预览模式不会执行 Git commit。' };
  return invoke<GitCommandResult>('git_commit', { request: { cwd, message } });
}

export async function gitBranches(cwd: string): Promise<GitBranch[]> {
  if (!isTauriRuntime()) return [];
  return invoke<GitBranch[]>('git_branch_list', { request: { cwd } });
}

export async function gitRecentCommits(cwd: string, limit = 20): Promise<GitCommit[]> {
  if (!cwd || !isTauriRuntime()) return [];
  return invoke<GitCommit[]>('git_recent_commits', { request: { cwd, limit } });
}

export async function gitCreateBranch(cwd: string, name: string): Promise<GitCommandResult> {
  if (!isTauriRuntime()) return { stdout: '', stderr: '' };
  return invoke<GitCommandResult>('git_create_branch', { request: { cwd, name } });
}

export async function gitCheckoutBranch(cwd: string, name: string): Promise<GitCommandResult> {
  if (!isTauriRuntime()) return { stdout: '', stderr: '' };
  return invoke<GitCommandResult>('git_checkout_branch', { request: { cwd, name } });
}

export async function gitPull(cwd: string): Promise<GitCommandResult> {
  if (!isTauriRuntime()) return { stdout: '', stderr: '' };
  return invoke<GitCommandResult>('git_pull', { request: { cwd } });
}

export async function gitPush(cwd: string, setUpstream = false): Promise<GitCommandResult> {
  if (!isTauriRuntime()) return { stdout: '', stderr: '' };
  return invoke<GitCommandResult>('git_push', { request: { cwd, setUpstream } });
}

export async function gitRemotes(cwd: string): Promise<GitRemote[]> {
  if (!isTauriRuntime()) return [];
  return invoke<GitRemote[]>('git_remotes', { request: { cwd } });
}

export async function gitDiffStat(cwd: string): Promise<GitDiffStat> {
  if (!cwd || !isTauriRuntime()) return { filesChanged: 0, additions: 0, deletions: 0 };
  return invoke<GitDiffStat>('git_diff_stat', { request: { cwd } });
}

export async function ghAuthStatus(): Promise<GhAuthStatus> {
  if (!isTauriRuntime()) return { installed: false, authenticated: false };
  return invoke<GhAuthStatus>('gh_auth_status');
}

export async function listOpenApps(): Promise<OpenAppId[]> {
  if (!isTauriRuntime()) return ['finder', 'preview', 'terminal', 'vscode', 'cursor'];
  return invoke<OpenAppId[]>('list_open_apps');
}

export async function openInApp(app: OpenAppId, path: string): Promise<void> {
  if (!path) throw new Error('当前对话还没有绑定工作目录。');
  if (!isTauriRuntime()) return;
  await invoke('open_in_app', { request: { app, path } });
}

export async function copyLocalFileToClipboard(path: string): Promise<void> {
  if (!path) throw new Error('文件路径不能为空。');
  if (!isTauriRuntime()) {
    await navigator.clipboard?.writeText(path);
    return;
  }
  await invoke('copy_file_to_clipboard', { request: { path } });
}

export async function terminalStart(cwd?: string, rows?: number, cols?: number): Promise<string> {
  if (!isTauriRuntime()) return '';
  const result = await invoke<{ sessionId: string }>('terminal_start', {
    request: { cwd, rows, cols },
  });
  return result.sessionId;
}

export async function terminalWrite(sessionId: string, data: string): Promise<void> {
  if (!isTauriRuntime() || !sessionId) return;
  await invoke('terminal_write', { request: { sessionId, data } });
}

export async function terminalResize(sessionId: string, rows: number, cols: number): Promise<void> {
  if (!isTauriRuntime() || !sessionId) return;
  await invoke('terminal_resize', { request: { sessionId, rows, cols } });
}

export async function terminalStop(sessionId: string): Promise<void> {
  if (!isTauriRuntime() || !sessionId) return;
  await invoke('terminal_stop', { request: { sessionId } });
}

export async function subscribeTerminalEvents(
  handler: (event: TerminalEvent) => void,
): Promise<UnlistenFn | null> {
  if (!isTauriRuntime()) return null;
  return listen<TerminalEvent>(TERMINAL_EVENT, (event) => {
    handler(event.payload);
  });
}

function browserGitStatus(cwd: string): GitStatus {
  return {
    cwd,
    isRepository: false,
    ahead: 0,
    behind: 0,
    clean: true,
    changes: [],
    error: '浏览器预览模式不会读取本地 Git 仓库。请使用 npm run tauri:dev。',
  };
}
