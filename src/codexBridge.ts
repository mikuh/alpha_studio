import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { ModelProfile } from './models';
import type {
  CodexChatEvent,
  CodexStatus,
  GhAuthStatus,
  GitBranch,
  GitCommandResult,
  GitCommit,
  GitDiffStat,
  GitRemote,
  GitStatus,
  OpenAppId,
  SandboxMode,
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
  providerThinkingEnabled?: boolean;
  reasoningEffort?: string;
  sandboxMode?: SandboxMode;
}

export interface CodexChatStartResult {
  runId: string;
}

export interface ModelConfigFile {
  selectedModelProfileId?: string;
  modelProfiles: ModelProfile[];
  path?: string;
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
      error: '浏览器预览模式不会启动 Codex CLI。请使用 npm run tauri:dev。',
    };
  }
  return invoke<CodexStatus>('codex_check');
}

export async function startCodexChat(request: CodexChatStartRequest): Promise<CodexChatStartResult> {
  return invoke<CodexChatStartResult>('codex_chat_start', { request });
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
    const { revealItemInDir } = await import('@tauri-apps/plugin-opener');
    await revealItemInDir(path);
    return true;
  } catch {
    return false;
  }
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
  if (!isTauriRuntime()) return ['finder', 'terminal', 'vscode', 'cursor'];
  return invoke<OpenAppId[]>('list_open_apps');
}

export async function openInApp(app: OpenAppId, path: string): Promise<void> {
  if (!path) throw new Error('当前对话还没有绑定工作目录。');
  if (!isTauriRuntime()) return;
  await invoke('open_in_app', { request: { app, path } });
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
