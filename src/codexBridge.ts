import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { ModelProfile } from './models';
import type {
  CodexChatEvent,
  CodexStatus,
  EmailCategory,
  EvalCriterion,
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

// Step 1 (初步分类): confirm/override a lead's category, optionally hide it,
// mark it human-confirmed, and (for 达人) ensure a linked KOL profile exists.
export async function marketingLeadClassify(request: {
  id: string;
  category: EmailCategory;
  hidden?: boolean;
  confirmed?: boolean;
  actor?: 'agent' | 'user';
  reason?: string;
}): Promise<MarketingDbSnapshot> {
  if (!isTauriRuntime()) return browserMarketingSnapshot();
  return invoke<MarketingDbSnapshot>('marketing_lead_classify', { request });
}

// Step 2 (网红评估): persist a structured evaluation and advance the pipeline.
export async function marketingKolEvaluate(request: {
  id: string;
  criteria: EvalCriterion[];
  summary?: string;
  recommendation?: string;
  confirmed?: boolean;
  actor?: 'agent' | 'user';
  reason?: string;
}): Promise<MarketingDbSnapshot> {
  if (!isTauriRuntime()) return browserMarketingSnapshot();
  return invoke<MarketingDbSnapshot>('marketing_kol_evaluate', { request });
}

// Step 3 (评估后处理): send a real reply email via SMTP (one-click reply),
// then record the outreach and advance the pipeline. Set send=false to record
// without sending (e.g. message was delivered through another channel).
export async function marketingKolReply(request: {
  id: string;
  body: string;
  subject?: string;
  to?: string;
  kind?: string;
  scriptId?: string;
  channel?: string;
  note?: string;
  send?: boolean;
  actor?: 'agent' | 'user';
  reason?: string;
}): Promise<MarketingDbSnapshot> {
  if (!isTauriRuntime()) return browserMarketingSnapshot();
  return invoke<MarketingDbSnapshot>('marketing_kol_reply', { request });
}

// Step 4 (录入系统): store the structured intake record and advance onboarding → intake.
export async function marketingKolIntake(request: {
  id: string;
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
  status?: 'done' | 'draft';
  actor?: 'agent' | 'user';
  reason?: string;
}): Promise<MarketingDbSnapshot> {
  if (!isTauriRuntime()) return browserMarketingSnapshot();
  return invoke<MarketingDbSnapshot>('marketing_kol_intake', { request });
}

// Step 5 (合作推进): optionally send the contract email, then record the contract
// push / signing; status=signed advances the pipeline to `signed`.
export async function marketingKolCollaborate(request: {
  id: string;
  status?: 'sent' | 'signed' | 'declined';
  scriptId?: string;
  contractUrl?: string;
  videoCount?: number;
  note?: string;
  body?: string;
  subject?: string;
  to?: string;
  send?: boolean;
  actor?: 'agent' | 'user';
  reason?: string;
}): Promise<MarketingDbSnapshot> {
  if (!isTauriRuntime()) return browserMarketingSnapshot();
  return invoke<MarketingDbSnapshot>('marketing_kol_collaborate', { request });
}

// Step 6 (发货流程): optionally send the shipping notice, then record fulfillment;
// shipped → `shipped`, delivered → `completed`.
export async function marketingKolShip(request: {
  id: string;
  status?: 'shipped' | 'delivered' | 'issue';
  carrier?: string;
  tracking?: string;
  trackingUrl?: string;
  address?: string;
  units?: string;
  expectedPostAt?: number | null;
  note?: string;
  body?: string;
  subject?: string;
  to?: string;
  send?: boolean;
  actor?: 'agent' | 'user';
  reason?: string;
}): Promise<MarketingDbSnapshot> {
  if (!isTauriRuntime()) return browserMarketingSnapshot();
  return invoke<MarketingDbSnapshot>('marketing_kol_ship', { request });
}

// Step 3 (评估后处理): record the outreach action (proposal/reject/skip) and,
// for a qualified KOL, advance the pipeline to onboarding.
export async function marketingKolOutreach(request: {
  id: string;
  kind?: string;
  scriptId?: string;
  channel?: string;
  note?: string;
  status?: 'sent' | 'skipped';
  actor?: 'agent' | 'user';
  reason?: string;
}): Promise<MarketingDbSnapshot> {
  if (!isTauriRuntime()) return browserMarketingSnapshot();
  return invoke<MarketingDbSnapshot>('marketing_kol_outreach', { request });
}

// Persist workflow preferences, e.g. whether the agent may auto-confirm
// evaluations without a human review.
export async function marketingSettingsSet(request: {
  agentAutoConfirm?: boolean;
  agentAutoReply?: boolean;
}): Promise<MarketingDbSnapshot> {
  if (!isTauriRuntime()) {
    const snap = browserMarketingSnapshot();
    return {
      ...snap,
      settings: { ...snap.settings, ...request } as MarketingDbSnapshot['settings'],
    };
  }
  return invoke<MarketingDbSnapshot>('marketing_settings_set', { request });
}

export interface TranslateResult {
  text: string;
  sourceLang: string;
  targetLang: string;
}

// Key-less translation for email leads. Runs through the Rust backend in the
// desktop app (avoids CORS); falls back to a best-effort direct call in preview.
export async function translateText(text: string, target = 'zh-CN'): Promise<TranslateResult> {
  const trimmed = text.trim();
  if (!trimmed) return { text: '', sourceLang: 'auto', targetLang: target };
  if (isTauriRuntime()) {
    return invoke<TranslateResult>('translate_text', { request: { text: trimmed, target } });
  }
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(
    target,
  )}&dt=t&q=${encodeURIComponent(trimmed.slice(0, 4500))}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`翻译服务返回 ${response.status}`);
  const data = (await response.json()) as [Array<[string]>, unknown, string];
  const out = (data?.[0] ?? []).map((chunk) => chunk?.[0] ?? '').join('');
  if (!out.trim()) throw new Error('翻译结果为空');
  return { text: out, sourceLang: data?.[2] ?? 'auto', targetLang: target };
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
    hidden: 0,
    other: 1,
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
        humanConfirmed: false,
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
        humanConfirmed: false,
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
        category: 'other',
        hidden: false,
        confidence: 0.81,
        agentReviewedAt: now - 1000 * 60 * 72,
        agentReviewNote: '预览模式自动归入其他邮件。',
        humanConfirmed: true,
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
        pipelineStage: 'evaluate',
        evaluation: null,
        createdAt: now - 1000 * 60 * 24,
        updatedAt: now - 1000 * 60 * 12,
      },
      {
        id: 'kol-preview-2',
        name: 'Leo Overland',
        email: 'leo.overland@example.com',
        country: 'US',
        relationship: '达人',
        collaborationStatus: '跟进中',
        stage: '评估通过',
        owner: 'wei',
        priority: 'high',
        tags: 'overland,vanlife,youtube',
        source: 'Email',
        archived: false,
        brandFitScore: 91,
        riskNote: '',
        nextFollowUpAt: now + 1000 * 60 * 60 * 48,
        lastContactedAt: now - 1000 * 60 * 60 * 5,
        agentNotes: 'Vanlife / overlanding 频道，露营场景高度垂直。',
        humanNotes: '',
        pipelineStage: 'qualified',
        evaluation: JSON.stringify({
          status: 'pass',
          confirmed: true,
          by: 'user',
          at: now - 1000 * 60 * 60 * 4,
          score: 83,
          summary: 'Vanlife 创作者，露营/房车场景与 Mark 3 高度契合，互动稳定。',
          recommendation: 'proposal',
          criteria: [
            { key: 'vertical', label: '应用场景与 ZERO BREEZE 垂直', kind: 'hard', status: 'pass', detail: 'Vanlife / overlanding 户外场景' },
            { key: 'language', label: '国家/语言合适（非西/德语）', kind: 'hard', status: 'pass', detail: '美国 / 英语' },
            { key: 'followers', label: '粉丝量 ≥ 10k', kind: 'soft', status: 'pass', detail: 'YT 62k / IG 24k' },
            { key: 'views', label: '播放量 ≥ 粉丝数 30%', kind: 'soft', status: 'pass', detail: '平均播放 28k' },
            { key: 'engagement', label: '平均点赞/评论 ≥ 100', kind: 'soft', status: 'pass', detail: '平均点赞 1.2k' },
            { key: 'recency', label: '近 30 天持续更新', kind: 'soft', status: 'unknown', detail: '最近更新待确认' },
          ],
        }),
        createdAt: now - 1000 * 60 * 60 * 24 * 3,
        updatedAt: now - 1000 * 60 * 60 * 4,
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
    settings: { agentAutoConfirm: false, agentAutoReply: false },
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
