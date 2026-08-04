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
  target?: string;
  input?: string;
  output?: string;
}

export interface ErrorBlock {
  type: 'error';
  content: string;
}

export interface GeneratedImage {
  id: string;
  src: string;
  alt: string;
  name?: string;
}

export interface GeneratedFile {
  id: string;
  path: string;
  name: string;
  ext: string;
  kind: 'image' | 'file';
}

export interface ImageResultBlock {
  type: 'image_result';
  id: string;
  title: string;
  images: GeneratedImage[];
}

export interface FileResultBlock {
  type: 'file_result';
  id: string;
  title: string;
  files: GeneratedFile[];
}

export type MessageBlock = TextBlock | ThinkingBlock | ToolBlock | ErrorBlock | ImageResultBlock | FileResultBlock;

export interface MessageAttachment {
  id: string;
  name: string;
  kind: 'image' | 'file' | 'directory';
  ext: string;
  // Absolute path (desktop) or file name (browser preview); folded into the prompt.
  path?: string;
  // URL the webview can render for image thumbnails (asset URL or object URL).
  previewUrl?: string;
}

export interface SkillSelection {
  id: string;
  title: string;
  description?: string;
}

// A quote captured from an existing chat turn and attached to a later prompt.
// Side-chat quotes remain in memory only because their owning Conversation is
// ephemeral; quotes sent in the main chat become part of that visible turn.
export interface SelectedTextContext {
  id: string;
  text: string;
  sourceConversationId: string;
  sourceMessageId?: string;
  sourceRole?: MessageRole;
}

// An AI coworker attached to a user turn. The main agent orchestrates the
// matching Codex sub-agent (CODEX_HOME/agents/<id>.toml) for each entry.
export interface CoworkerSelection {
  id: string;
  // Circled number badge, e.g. "①".
  no: string;
  name: string;
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
  selectedSkill?: SkillSelection;
  selectedTextContexts?: SelectedTextContext[];
  // Coworkers summoned for this turn; the main agent spawns their sub-agents.
  coworkers?: CoworkerSelection[];
  // Marks an assistant turn that should render as a structured code review.
  review?: boolean;
  // Marks a user turn that kicked off a review (renders as a review chip).
  reviewRequest?: ReviewRequest;
}

export interface QueuedChatMessage {
  id: string;
  text: string;
  createdAt: number;
  attachments?: MessageAttachment[];
  selectedSkill?: SkillSelection;
  selectedTextContexts?: SelectedTextContext[];
  coworkers?: CoworkerSelection[];
  automationRun?: boolean;
}

export interface BackgroundContextSummary {
  summary: string;
  sourceMessageCount: number;
  sourceTokenEstimate: number;
  summaryTokenEstimate: number;
  compactedAt: number;
  updatedAt: number;
}

export interface CodexTokenUsageBreakdown {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}

export interface CodexTokenUsage {
  total: CodexTokenUsageBreakdown;
  last: CodexTokenUsageBreakdown;
  modelContextWindow: number | null;
  updatedAt: number;
}

export interface SubscriptionModelUsage {
  month: string;
  modelId: string;
  label: string;
  runCount: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  totalTokens: number;
  lastUsedAt: number;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  queuedMessages?: QueuedChatMessage[];
  guidedQueuedMessages?: QueuedChatMessage[];
  codexThreadId?: string;
  backgroundContext?: BackgroundContextSummary;
  codexTokenUsage?: CodexTokenUsage;
  activeModelProfileId?: string;
  codexCompactedAt?: number;
  cwd: string;
  projectId?: string;
  createdAt: number;
  updatedAt: number;
  status: 'idle' | 'streaming' | 'error';
  runId?: string;
  /** Turn finished while the user was elsewhere and hasn't been opened since. */
  unread?: boolean;
  pinned?: boolean;
  archivedAt?: number;
  archiveBatchId?: string;
  /** In-memory side chat: omitted from persistence and the primary sidebar. */
  ephemeral?: boolean;
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
  accountEmail?: string;
  error?: string;
}

export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra';

export interface CodexModelReasoningEffort {
  reasoningEffort: ReasoningEffort;
  description: string;
}

export interface CodexModelCatalogItem {
  id: string;
  displayName: string;
  isDefault: boolean;
  hidden: boolean;
  defaultReasoningEffort?: ReasoningEffort;
  supportedReasoningEfforts: CodexModelReasoningEffort[];
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
    | 'token_usage'
    | 'context_compacted'
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

export type OpenAppId = 'finder' | 'preview' | 'terminal' | 'vscode' | 'cursor' | 'pycharm' | 'xcode';

export interface TerminalEvent {
  type: 'output' | 'exit';
  sessionId: string;
  chunk?: string;
}
