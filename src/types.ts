export type MessageRole = 'user' | 'assistant';

export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';

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
}

export interface Project {
  id: string;
  name: string;
  cwd: string;
  createdAt: number;
  updatedAt: number;
}

export interface Holding {
  id: string;
  code: string;
  name: string;
  shares: number;
  cost: number;
  price: number;
  note?: string;
  createdAt: number;
}

export interface WatchItem {
  id: string;
  code: string;
  name: string;
  note?: string;
  createdAt: number;
}

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
