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
  KolProfilePatch,
  MarketingDbSnapshot,
  MarketingEmailAccountConfig,
  MarketingEmailSyncResult,
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
      error: '浏览器预览模式不会启动本地智能引擎。请使用 npm run tauri:dev。',
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

export async function marketingDbQuery(includeHidden = true): Promise<MarketingDbSnapshot> {
  if (!isTauriRuntime()) return browserMarketingSnapshot();
  return invoke<MarketingDbSnapshot>('marketing_db_query', { request: { includeHidden } });
}

export async function marketingEmailSecretSave(account: MarketingEmailAccountConfig): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  const result = await invoke<{ saved: boolean; path: string }>('marketing_email_secret_save', { request: { account } });
  return result.path;
}

export async function marketingEmailTestConnection(account: MarketingEmailAccountConfig): Promise<{ ok: boolean; message: string }> {
  if (!isTauriRuntime()) return { ok: true, message: '浏览器预览模式不会连接真实邮箱。' };
  return invoke<{ ok: boolean; message: string }>('marketing_email_test_connection', { request: { account } });
}

export async function marketingEmailSyncReadonly(account: MarketingEmailAccountConfig): Promise<MarketingEmailSyncResult> {
  if (!isTauriRuntime()) return browserMarketingSyncResult();
  return invoke<MarketingEmailSyncResult>('marketing_email_sync_readonly', { request: { account } });
}

export async function marketingDbUpdateKol(id: string, patch: KolProfilePatch, reason?: string): Promise<MarketingDbSnapshot> {
  if (!isTauriRuntime()) return browserMarketingSnapshot();
  return invoke<MarketingDbSnapshot>('marketing_db_update_kol', { request: { id, patch, reason } });
}

export async function marketingAgentApplyUpdate(request: {
  targetTable: string;
  targetId: string;
  field: string;
  oldValue?: string | null;
  newValue?: string | null;
  reason: string;
}): Promise<MarketingDbSnapshot> {
  if (!isTauriRuntime()) return browserMarketingSnapshot();
  return invoke<MarketingDbSnapshot>('marketing_agent_apply_update', { request });
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

export async function createBrandDirectory(parent: string, name: string): Promise<string> {
  const fallback = joinPath(parent, name);
  if (!isTauriRuntime()) return fallback;
  const result = await invoke<{ path: string }>('brand_directory_create', { request: { parent, name } });
  return result.path;
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
  if (!path) throw new Error('当前对话还没有绑定品牌目录。');
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

function browserMarketingSyncResult(): MarketingEmailSyncResult {
  return {
    synced: 3,
    inserted: 0,
    updated: 3,
    hidden: 1,
    other: 0,
    kolCreated: 1,
    path: '~/.alpha-studio/marketing.sqlite',
  };
}

function browserMarketingSnapshot(): MarketingDbSnapshot {
  const now = Date.now();
  return {
    path: '~/.alpha-studio/marketing.sqlite',
    accounts: [
      {
        id: 'email-preview',
        label: 'Preview Inbox',
        host: 'imap.example.com',
        port: 993,
        tls: true,
        username: 'marketing@example.com',
        mailbox: 'INBOX',
        scanLimit: 200,
        syncIntervalMinutes: 15,
        enabled: true,
        lastSyncedAt: now - 1000 * 60 * 8,
        createdAt: now - 1000 * 60 * 60,
        updatedAt: now - 1000 * 60 * 8,
      },
    ],
    leads: [
      {
        id: 'lead-preview-1',
        accountId: 'email-preview',
        imapUid: '901',
        messageId: '<creator@example.com>',
        threadId: 'Collaboration with Incuboot',
        fromName: 'Mia Chen',
        fromEmail: 'mia.creator@example.com',
        rawFrom: 'Mia Chen <mia.creator@example.com>',
        subject: 'Collaboration with Incuboot',
        snippet: 'I love the product direction and would like to discuss a TikTok + IG Reel package for next month.',
        receivedAt: now - 1000 * 60 * 24,
        category: 'influencer',
        hidden: false,
        confidence: 0.86,
        kolId: 'kol-preview-1',
        agentReviewedAt: now - 1000 * 60 * 12,
        agentReviewNote: '预览模式自动识别为达人合作线索。',
        createdAt: now - 1000 * 60 * 24,
        updatedAt: now - 1000 * 60 * 12,
      },
      {
        id: 'lead-preview-2',
        accountId: 'email-preview',
        imapUid: '902',
        messageId: '<affiliate@example.com>',
        threadId: 'Affiliate partnership',
        fromName: 'Partner Desk',
        fromEmail: 'partner@example.com',
        rawFrom: 'Partner Desk <partner@example.com>',
        subject: 'Affiliate partnership proposal',
        snippet: 'We can promote your offer through a CPS affiliate program with weekly reporting.',
        receivedAt: now - 1000 * 60 * 48,
        category: 'affiliate',
        hidden: false,
        confidence: 0.78,
        agentReviewedAt: now - 1000 * 60 * 48,
        agentReviewNote: '预览模式自动识别为联盟合作线索。',
        createdAt: now - 1000 * 60 * 48,
        updatedAt: now - 1000 * 60 * 48,
      },
      {
        id: 'lead-preview-3',
        accountId: 'email-preview',
        imapUid: '903',
        messageId: '<seo@example.com>',
        threadId: 'SEO services',
        fromName: 'Growth SEO',
        fromEmail: 'sales@seo.example.com',
        rawFrom: 'Growth SEO <sales@seo.example.com>',
        subject: 'Limited offer for guest post backlinks',
        snippet: 'We provide guest post backlinks and lead generation packages at a discount.',
        receivedAt: now - 1000 * 60 * 72,
        category: 'ad',
        hidden: true,
        confidence: 0.81,
        agentReviewedAt: now - 1000 * 60 * 72,
        agentReviewNote: '预览模式自动隐藏广告邮件。',
        createdAt: now - 1000 * 60 * 72,
        updatedAt: now - 1000 * 60 * 72,
      },
    ],
    kolProfiles: [
      {
        id: 'kol-preview-1',
        name: 'Mia Chen',
        email: 'mia.creator@example.com',
        country: 'US',
        relationship: '达人',
        collaborationStatus: '待分配',
        stage: '线索',
        owner: 'Marketing',
        priority: 'high',
        tags: 'beauty,tiktok',
        source: 'Email',
        archived: false,
        brandFitScore: 82,
        riskNote: '',
        nextFollowUpAt: now + 1000 * 60 * 60 * 24,
        lastContactedAt: now - 1000 * 60 * 24,
        agentNotes: '由邮件线索自动创建。',
        humanNotes: '',
        createdAt: now - 1000 * 60 * 24,
        updatedAt: now - 1000 * 60 * 12,
      },
    ],
    platformAccounts: [],
    collaborations: [],
    posts: [],
    auditLogs: [
      {
        id: 'audit-preview-1',
        actor: 'agent',
        targetTable: 'marketing_email_leads',
        targetId: 'email-preview',
        field: 'sync',
        oldValue: null,
        newValue: '3 emails',
        reason: '只读同步邮件并写入本地营销库',
        createdAt: now - 1000 * 60 * 8,
      },
    ],
  };
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

function joinPath(parent: string, name: string): string {
  const base = parent.replace(/[\\/]+$/g, '');
  const child = name.replace(/^[\\/]+/g, '');
  return base ? `${base}/${child}` : child;
}
