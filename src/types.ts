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

export interface ChatMessage {
  id: string;
  role: MessageRole;
  blocks: MessageBlock[];
  timestamp: number;
  isStreaming?: boolean;
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
