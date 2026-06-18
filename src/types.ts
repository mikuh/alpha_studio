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

export interface SkillSelection {
  id: string;
  title: string;
  description?: string;
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
