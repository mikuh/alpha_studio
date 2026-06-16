export type MessageRole = 'user' | 'assistant';

export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';

export type ApprovalDecision = 'allow' | 'full-access' | 'deny';

export interface AuthorizationRequest {
  id: string;
  conversationId: string;
  title: string;
  description: string;
  cwd: string;
}

export interface TextBlock {
  type: 'text';
  content: string;
}

export interface ThinkingBlock {
  type: 'thinking';
  content: string;
}

export interface ToolBlock {
  type: 'tool';
  id: string;
  title: string;
  status: 'in_progress' | 'completed' | 'failed';
  input?: string;
  output?: string;
}

export interface ErrorBlock {
  type: 'error';
  content: string;
}

export type MessageBlock = TextBlock | ThinkingBlock | ToolBlock | ErrorBlock;

export interface MessageAttachment {
  id: string;
  name: string;
  kind: 'image' | 'file';
  ext: string;
  // Absolute path (desktop) or file name (browser preview); folded into the prompt.
  path?: string;
  // URL the webview can render for image thumbnails (asset URL or object URL).
  previewUrl?: string;
}

// What a review turn was asked to inspect, mirroring Codex's /review presets.
export type ReviewTargetKind = 'uncommitted' | 'base' | 'commit' | 'custom';

export interface ReviewRequest {
  kind: ReviewTargetKind;
  // Human-readable label shown on the request chip, e.g. "审查未提交的更改".
  label: string;
  // Branch name (base review) or commit SHA (commit review).
  target?: string;
  // First line of the reviewed commit, shown for context.
  commitSubject?: string;
  // Optional custom reviewer instructions the user typed.
  instructions?: string;
}

export type ReviewVerdict = 'correct' | 'incorrect' | 'unknown';

export type ReviewPriority = 'P0' | 'P1' | 'P2' | 'P3';

export interface ReviewFinding {
  priority: ReviewPriority;
  title: string;
  body: string;
  file?: string;
  lineStart?: number;
  lineEnd?: number;
  confidence?: number;
  suggestion?: string;
}

// Structured findings parsed from a review turn's final JSON block.
export interface ReviewReport {
  verdict: ReviewVerdict;
  summary: string;
  findings: ReviewFinding[];
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  blocks: MessageBlock[];
  timestamp: number;
  isStreaming?: boolean;
  attachments?: MessageAttachment[];
  // Marks an assistant turn that should render as a structured code review.
  review?: boolean;
  // Marks a user turn that kicked off a review (renders as a review chip).
  reviewRequest?: ReviewRequest;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  codexThreadId?: string;
  cwd: string;
  projectId?: string;
  createdAt: number;
  updatedAt: number;
  status: 'idle' | 'streaming' | 'error';
  runId?: string;
  pinned?: boolean;
  archivedAt?: number;
  archiveBatchId?: string;
}

export interface Project {
  id: string;
  name: string;
  cwd: string;
  createdAt: number;
  updatedAt: number;
  pinned?: boolean;
  archivedAt?: number;
  archiveBatchId?: string;
}

export type ProjectSort = 'updated' | 'created' | 'name';

export interface CodexStatus {
  installed: boolean;
  version: string;
  path: string;
  loggedIn: boolean;
  error?: string;
}

export interface CodexChatEvent {
  type:
    | 'started'
    | 'thread_started'
    | 'text_delta'
    | 'reasoning_delta'
    | 'tool_started'
    | 'tool_delta'
    | 'tool_completed'
    | 'tool_failed'
    | 'status'
    | 'completed'
    | 'error'
    | 'stopped';
  runId: string;
  conversationId?: string;
  threadId?: string;
  itemId?: string;
  title?: string;
  text?: string;
  message?: string;
  raw?: unknown;
}

export interface Coworker {
  id: string;
  code: string;
  name: string;
  role: string;
  status: string;
  promptHint: string;
}

export type GitChangeStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'conflicted'
  | 'typechange'
  | 'unknown';

export interface GitFileChange {
  path: string;
  originalPath?: string;
  staged: boolean;
  unstaged: boolean;
  indexStatus: string;
  workingTreeStatus: string;
  status: GitChangeStatus;
}

export interface GitStatus {
  cwd: string;
  isRepository: boolean;
  branch?: string;
  upstream?: string;
  ahead: number;
  behind: number;
  clean: boolean;
  changes: GitFileChange[];
  error?: string;
}

export interface GitBranch {
  name: string;
  current: boolean;
  upstream?: string;
}

export interface GitCommit {
  sha: string;
  shortSha: string;
  subject: string;
  author: string;
  relativeDate: string;
}

export interface GitRemote {
  name: string;
  fetchUrl?: string;
  pushUrl?: string;
}

export interface GitCommandResult {
  stdout: string;
  stderr: string;
}

export interface GitDiffStat {
  filesChanged: number;
  additions: number;
  deletions: number;
}

export interface GhAuthStatus {
  installed: boolean;
  authenticated: boolean;
  account?: string;
}

export type OpenAppId = 'finder' | 'terminal' | 'vscode' | 'cursor' | 'pycharm';

export interface TerminalEvent {
  type: 'output' | 'exit';
  sessionId: string;
  chunk?: string;
}

export type EmailCategory = 'influencer' | 'affiliate' | 'other';

export interface MarketingEmailAccountConfig {
  id: string;
  label: string;
  host: string;
  port: number;
  tls: boolean;
  username: string;
  mailbox: string;
  scanLimit: number;
  syncIntervalMinutes: number;
  enabled: boolean;
  password?: string;
}

export type MarketingEmailAccount = Omit<MarketingEmailAccountConfig, 'password'> & {
  lastSyncedAt?: number | null;
  createdAt: number;
  updatedAt: number;
};

export interface MarketingEmailLead {
  id: string;
  accountId: string;
  imapUid: string;
  messageId?: string | null;
  threadId?: string | null;
  fromName?: string | null;
  fromEmail: string;
  rawFrom: string;
  subject: string;
  snippet: string;
  receivedAt?: number | null;
  category: EmailCategory;
  hidden: boolean;
  confidence: number;
  kolId?: string | null;
  agentReviewedAt?: number | null;
  agentReviewNote: string;
  // Step 1 (初步分类): set to true once a human has confirmed / overridden the AI category.
  humanConfirmed: boolean;
  createdAt: number;
  updatedAt: number;
}

// Step 2 (网红评估) evaluation rubric. Two hard requirements must pass and at
// least two soft requirements must pass for a KOL to qualify.
export type EvalCriterionKey =
  | 'vertical'
  | 'language'
  | 'followers'
  | 'views'
  | 'engagement'
  | 'recency';

export type EvalCriterionStatus = 'pass' | 'fail' | 'unknown';

export type EvalCriterionKind = 'hard' | 'soft';

export interface EvalCriterion {
  key: EvalCriterionKey;
  label: string;
  kind: EvalCriterionKind;
  status: EvalCriterionStatus;
  detail: string;
}

export type EvalVerdict = 'pass' | 'fail' | 'pending';

export type EvalRecommendation = 'proposal' | 'reject' | 'hold';

export interface KolEvaluation {
  status: EvalVerdict;
  confirmed: boolean;
  by: string;
  at: number;
  score: number;
  summary: string;
  recommendation: EvalRecommendation;
  criteria: EvalCriterion[];
}

export type OutreachStatus = 'sent' | 'skipped';

// Step 3 评估后处理: records the post-evaluation outreach action taken for a KOL
// (proposal sent to a qualified KOL, rejection sent to a rejected one, or skipped).
export interface KolOutreach {
  status: OutreachStatus;
  // proposal | reject | koc | paid | custom ...
  kind: string;
  // Which 话术库 template was used, if any.
  scriptId?: string;
  // Medium the message was sent through (Email / IG DM / WhatsApp / 通用 ...).
  channel?: string;
  note?: string;
  by: string;
  at: number;
}

// Step 4 录入系统: structured intake record completing the KOL profile after the
// creator replies with interest. Marks the data-entry step done.
export interface KolIntake {
  status: string; // 'done' | 'draft'
  username?: string;
  owner?: string;
  // Communication channel chosen with the creator (Email / SMS / DM ...).
  channel?: string;
  // 'inbound' (创作者主动联系我们) | 'outbound' (我们主动建联).
  relationship?: string;
  phone?: string;
  // Free-text per-platform follower summary, e.g. "IG 45k / YT 12k".
  platforms?: string;
  links?: string;
  contentType?: string;
  language?: string;
  // Content data summary: avg views / likes / comments / cadence.
  metrics?: string;
  note?: string;
  by: string;
  at: number;
}

export type CollabStatus = 'sent' | 'signed' | 'declined';

// Step 5 合作推进: contract push / signing record.
export interface KolCollab {
  status: CollabStatus;
  scriptId?: string;
  contractUrl?: string;
  // Number of agreed video deliverables, if negotiated.
  videoCount?: number;
  note?: string;
  by: string;
  at: number;
}

export type ShipmentStatus = 'shipped' | 'delivered' | 'issue';

// Step 6 发货流程: fulfillment + content follow-up record.
export interface KolShipment {
  status: ShipmentStatus;
  carrier?: string;
  tracking?: string;
  trackingUrl?: string;
  address?: string;
  units?: string;
  expectedPostAt?: number | null;
  note?: string;
  by: string;
  at: number;
}

export interface KolProfile {
  id: string;
  name: string;
  email: string;
  country?: string | null;
  relationship: string;
  collaborationStatus: string;
  stage: string;
  owner?: string | null;
  priority: string;
  tags: string;
  source: string;
  archived: boolean;
  brandFitScore?: number | null;
  riskNote?: string | null;
  nextFollowUpAt?: number | null;
  lastContactedAt?: number | null;
  agentNotes?: string | null;
  humanNotes?: string | null;
  // Workflow position: classify | evaluate | qualified | rejected | onboarding | intake | signed | shipped | completed
  pipelineStage: string;
  // Raw JSON of the latest KolEvaluation (parse with parseKolEvaluation), or null.
  evaluation?: string | null;
  // Raw JSON of the latest KolOutreach (parse with parseKolOutreach), or null.
  outreach?: string | null;
  // Step 4 录入系统 record (parse with parseKolIntake), or null.
  intake?: string | null;
  // Step 5 合作推进 record (parse with parseKolCollab), or null.
  collaboration?: string | null;
  // Step 6 发货流程 record (parse with parseKolShipment), or null.
  shipment?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface KolPlatformAccount {
  id: string;
  kolId: string;
  platform: string;
  handle?: string | null;
  url?: string | null;
  followerCount?: number | null;
  avgViews?: number | null;
  avgLikes?: number | null;
  avgComments?: number | null;
  audienceGender?: string | null;
  audienceAge?: string | null;
  audienceInterests?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface KolCollaboration {
  id: string;
  kolId: string;
  status: string;
  goal?: string | null;
  method?: string | null;
  platform?: string | null;
  quotedPrice?: string | null;
  paymentStatus?: string | null;
  contractStatus?: string | null;
  shippingStatus?: string | null;
  productValue?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface KolPost {
  id: string;
  kolId: string;
  collaborationId?: string | null;
  platform?: string | null;
  url?: string | null;
  topic?: string | null;
  contentQuality?: string | null;
  publishedAt?: number | null;
  impressions?: number | null;
  views?: number | null;
  likes?: number | null;
  comments?: number | null;
  salesAmount?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface AutomationAuditLog {
  id: string;
  actor: string;
  targetTable: string;
  targetId: string;
  field: string;
  oldValue?: string | null;
  newValue?: string | null;
  reason: string;
  createdAt: number;
}

export interface MarketingSettings {
  agentAutoConfirm: boolean;
  // Step 3: when true, the agent may compose AND send replies autonomously
  // (one-click reply via SMTP). When false, the agent only drafts and a human
  // confirms by sending from the panel.
  agentAutoReply: boolean;
}

export interface MarketingDbSnapshot {
  path: string;
  accounts: MarketingEmailAccount[];
  leads: MarketingEmailLead[];
  kolProfiles: KolProfile[];
  platformAccounts: KolPlatformAccount[];
  collaborations: KolCollaboration[];
  posts: KolPost[];
  auditLogs: AutomationAuditLog[];
  settings: MarketingSettings;
}

export interface KolProfilePatch {
  name?: string;
  email?: string;
  country?: string | null;
  relationship?: string;
  collaborationStatus?: string;
  stage?: string;
  owner?: string | null;
  priority?: string;
  tags?: string;
  archived?: boolean;
  brandFitScore?: number | null;
  riskNote?: string | null;
  nextFollowUpAt?: number | null;
  agentNotes?: string | null;
  humanNotes?: string | null;
  pipelineStage?: string;
}

export interface MarketingEmailSyncResult {
  synced: number;
  inserted: number;
  updated: number;
  hidden: number;
  other: number;
  kolCreated: number;
  path: string;
}
