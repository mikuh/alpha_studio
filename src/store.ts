import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { applyCodexEventToConversation } from './codexEvents';
import { buildCodingPrompt } from './prompt';
import { checkCodex, isTauriRuntime, startCodexChat, stopCodexChat } from './codexBridge';
import {
  DEFAULT_APPROVAL,
  DEFAULT_EFFORT,
  DEFAULT_MODEL,
  DEFAULT_SPEED,
  approvalRequiresPrompt,
  baseSandboxForApproval,
  isApprovalMode,
  sandboxToApproval,
  type ApprovalMode,
  type ReasoningEffort,
  type Speed,
} from './models';
import type {
  ApprovalDecision,
  AuthorizationRequest,
  ChatMessage,
  CodexChatEvent,
  CodexStatus,
  Conversation,
  Project,
  ProjectSort,
  SandboxMode,
} from './types';

const LEGACY_DEFAULT_CONVERSATION_TITLE = ['\u65b0\u7684', '\u5bf9\u8bdd'].join('\u6295\u7814');

// Holds the unresolved promise callbacks for in-flight authorization prompts.
// Kept outside the persisted store because functions are not serializable.
const authorizationResolvers = new Map<string, (decision: ApprovalDecision) => void>();

interface ChatState {
  conversations: Conversation[];
  projects: Project[];
  currentConversationId: string | null;
  model: string;
  reasoningEffort: ReasoningEffort;
  speed: Speed;
  codexStatus: CodexStatus | null;
  approvalMode: ApprovalMode;
  pendingAuthorization: AuthorizationRequest | null;
  isCheckingCodex: boolean;
  error: string | null;
  projectSort: ProjectSort;
  conversationSort: ProjectSort;
  createConversation: (projectId?: string) => string;
  setCurrentConversation: (id: string) => void;
  archiveConversation: (id: string) => void;
  unarchiveConversation: (id: string) => void;
  permanentlyDeleteConversation: (id: string) => void;
  archiveStandaloneConversations: () => void;
  renameConversation: (id: string, title: string) => void;
  toggleConversationPin: (id: string) => void;
  duplicateConversation: (id: string) => string | null;
  setConversationSort: (sort: ProjectSort) => void;
  createProject: (input?: { name?: string; cwd?: string }) => string;
  renameProject: (id: string, name: string) => void;
  setProjectCwd: (id: string, cwd: string) => void;
  toggleProjectPin: (id: string) => void;
  archiveProject: (id: string) => void;
  unarchiveProject: (id: string) => void;
  permanentlyDeleteProject: (id: string) => void;
  setProjectSort: (sort: ProjectSort) => void;
  setModel: (model: string) => void;
  setReasoningEffort: (effort: ReasoningEffort) => void;
  setSpeed: (speed: Speed) => void;
  setApprovalMode: (mode: ApprovalMode) => void;
  resolveAuthorization: (id: string, decision: ApprovalDecision) => void;
  refreshCodexStatus: () => Promise<void>;
  sendMessage: (message: string) => Promise<void>;
  editUserMessageAndResend: (conversationId: string, messageId: string, message: string) => Promise<void>;
  stopCurrentConversation: () => Promise<void>;
  handleCodexEvent: (event: CodexChatEvent) => void;
}

interface PersistedChatState {
  conversations: Conversation[];
  projects: Project[];
  currentConversationId: string | null;
  model: string;
  reasoningEffort: ReasoningEffort;
  speed: Speed;
  approvalMode: ApprovalMode;
  projectSort: ProjectSort;
  conversationSort: ProjectSort;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => {
      // Opens an authorization prompt and resolves once the user decides in the UI.
      const requestAuthorization = (
        request: Omit<AuthorizationRequest, 'id'>,
      ): Promise<ApprovalDecision> => {
        const id = createId('auth');
        return new Promise((resolve) => {
          authorizationResolvers.set(id, resolve);
          set({ pendingAuthorization: { ...request, id } });
        });
      };

      // Resolves the granted sandbox policy for a turn, pausing for the user when
      // the active approval mode requires it. Returns null when the user denies.
      const runApprovalGate = async (conversationId: string): Promise<SandboxMode | null> => {
        const mode = get().approvalMode;
        if (!approvalRequiresPrompt(mode)) {
          return baseSandboxForApproval(mode);
        }
        const latest = get().conversations.find((item) => item.id === conversationId);
        const decision = await requestAuthorization({
          conversationId,
          title: 'Codex 请求操作权限',
          description: latest?.cwd
            ? '允许 Codex 在当前工作目录读取、修改文件并运行命令吗？'
            : '允许 Codex 读取、修改文件并运行命令吗？',
          cwd: latest?.cwd || '',
        });
        if (decision === 'deny') {
          finishWithDenial(conversationId);
          return null;
        }
        return decision === 'full-access' ? 'danger-full-access' : 'workspace-write';
      };

      // Ends the current streaming turn with a note explaining authorization was denied.
      const finishWithDenial = (conversationId: string) => {
        set((state) => ({
          conversations: state.conversations.map((item) => {
            if (item.id !== conversationId) return item;
            const messages = [...item.messages];
            const lastIndex = messages.length - 1;
            const last = messages[lastIndex];
            if (last && last.role === 'assistant') {
              messages[lastIndex] = {
                ...last,
                isStreaming: false,
                blocks: [
                  { type: 'text', content: '已拒绝本次授权，未执行任何操作。如需继续，请重新发送消息并授予权限。' },
                ],
              };
            }
            return { ...item, messages, status: 'idle' as const, runId: undefined, updatedAt: Date.now() };
          }),
        }));
      };

      return {
      conversations: [createEmptyConversation()],
      projects: [],
      currentConversationId: null,
      model: DEFAULT_MODEL,
      reasoningEffort: DEFAULT_EFFORT,
      speed: DEFAULT_SPEED,
      codexStatus: null,
      approvalMode: DEFAULT_APPROVAL,
      pendingAuthorization: null,
      isCheckingCodex: false,
      error: null,
      projectSort: 'updated',
      conversationSort: 'updated',

      createConversation: (projectId?: string) => {
        const project = projectId
          ? get().projects.find((item) => item.id === projectId && !item.archivedAt)
          : undefined;
        const targetProjectId = project?.id;
        // A blank conversation is just a draft. Reuse the existing draft for this
        // context (and drop any other stray drafts) so unsent "新对话" never pile
        // up in the sidebar; a draft only becomes a real entry once a message is sent.
        const reused = get().conversations.find(
          (item) => isDraftConversation(item) && (item.projectId ?? undefined) === (targetProjectId ?? undefined),
        );
        const conversation = reused ?? createEmptyConversation(project);
        set((state) => ({
          conversations: [
            ...(reused ? [] : [conversation]),
            ...state.conversations.filter((item) => item.id === conversation.id || !isDraftConversation(item)),
          ],
          currentConversationId: conversation.id,
          error: null,
        }));
        return conversation.id;
      },

      setCurrentConversation: (id: string) => {
        set({ currentConversationId: id, error: null });
      },

      archiveConversation: (id: string) => {
        set((state) => {
          const now = Date.now();
          const conversations = state.conversations.map((conversation) =>
            conversation.id === id
              ? {
                  ...conversation,
                  archivedAt: conversation.archivedAt ?? now,
                  pinned: false,
                  status: conversation.status === 'streaming' ? 'idle' : conversation.status,
                  runId: undefined,
                }
              : conversation
          );
          return resolveActiveConversation(conversations, state.currentConversationId === id ? null : state.currentConversationId);
        });
      },

      unarchiveConversation: (id: string) => {
        set((state) => ({
          conversations: state.conversations.map((conversation) =>
            conversation.id === id
              ? { ...conversation, archivedAt: undefined, archiveBatchId: undefined }
              : conversation
          ),
          currentConversationId: id,
        }));
      },

      permanentlyDeleteConversation: (id: string) => {
        set((state) => {
          const conversations = state.conversations.filter((conversation) => conversation.id !== id);
          return resolveActiveConversation(conversations, state.currentConversationId === id ? null : state.currentConversationId);
        });
      },

      archiveStandaloneConversations: () => {
        set((state) => {
          const now = Date.now();
          const conversations = state.conversations.map((conversation) =>
            !conversation.archivedAt && !conversation.projectId && !conversation.pinned
              ? { ...conversation, archivedAt: now, status: 'idle' as const, runId: undefined }
              : conversation
          );
          return resolveActiveConversation(conversations, state.currentConversationId);
        });
      },

      renameConversation: (id: string, title: string) => {
        const trimmed = title.trim();
        if (!trimmed) return;
        set((state) => ({
          conversations: state.conversations.map((conversation) =>
            conversation.id === id ? { ...conversation, title: trimmed, updatedAt: Date.now() } : conversation
          ),
        }));
      },

      toggleConversationPin: (id: string) => {
        set((state) => ({
          conversations: state.conversations.map((conversation) =>
            conversation.id === id && !conversation.archivedAt
              ? { ...conversation, pinned: !conversation.pinned }
              : conversation
          ),
        }));
      },

      // Fork a conversation into a new, independent one (same project/cwd) that
      // carries over the existing transcript. New message ids keep the branch
      // from clobbering the source while editing.
      duplicateConversation: (id: string) => {
        const source = get().conversations.find((item) => item.id === id);
        if (!source) return null;
        const now = Date.now();
        const clone: Conversation = {
          ...source,
          id: createId('conv'),
          title: `${source.title} 分支`,
          messages: source.messages.map((message) => ({
            ...message,
            id: createId('msg'),
            blocks: message.blocks.map((block) => ({ ...block })),
            isStreaming: false,
          })),
          codexThreadId: undefined,
          status: 'idle',
          runId: undefined,
          pinned: false,
          archivedAt: undefined,
          archiveBatchId: undefined,
          createdAt: now,
          updatedAt: now,
        };
        set((state) => ({
          conversations: [clone, ...state.conversations],
          currentConversationId: clone.id,
          error: null,
        }));
        return clone.id;
      },

      setConversationSort: (sort) => set({ conversationSort: sort }),

      createProject: (input) => {
        const now = Date.now();
        const fallbackName = `新项目 ${activeProjects(get().projects).length + 1}`;
        const project: Project = {
          id: createId('proj'),
          name: input?.name?.trim() || fallbackName,
          cwd: input?.cwd?.trim() || '',
          createdAt: now,
          updatedAt: now,
        };
        set((state) => ({ projects: [project, ...state.projects] }));
        return project.id;
      },

      renameProject: (id: string, name: string) => {
        const trimmed = name.trim();
        if (!trimmed) return;
        set((state) => ({
          projects: state.projects.map((project) =>
            project.id === id ? { ...project, name: trimmed, updatedAt: Date.now() } : project
          ),
        }));
      },

      setProjectCwd: (id: string, cwd: string) => {
        const next = cwd.trim();
        set((state) => ({
          projects: state.projects.map((project) =>
            project.id === id ? { ...project, cwd: next, updatedAt: Date.now() } : project
          ),
          conversations: state.conversations.map((conversation) =>
            conversation.projectId === id ? { ...conversation, cwd: next } : conversation
          ),
        }));
      },

      toggleProjectPin: (id: string) => {
        set((state) => ({
          projects: state.projects.map((project) =>
            project.id === id && !project.archivedAt ? { ...project, pinned: !project.pinned } : project
          ),
        }));
      },

      archiveProject: (id: string) => {
        set((state) => {
          const now = Date.now();
          const batchId = createId('archive');
          const projects = state.projects.map((project) =>
            project.id === id
              ? { ...project, archivedAt: project.archivedAt ?? now, archiveBatchId: batchId, pinned: false }
              : project
          );
          const conversations = state.conversations.map((conversation) =>
            conversation.projectId === id && !conversation.archivedAt
              ? {
                  ...conversation,
                  archivedAt: now,
                  archiveBatchId: batchId,
                  pinned: false,
                  status: 'idle' as const,
                  runId: undefined,
                }
              : conversation
          );
          return { projects, ...resolveActiveConversation(conversations, state.currentConversationId) };
        });
      },

      unarchiveProject: (id: string) => {
        set((state) => {
          const project = state.projects.find((item) => item.id === id);
          const batchId = project?.archiveBatchId;
          return {
            projects: state.projects.map((item) =>
              item.id === id ? { ...item, archivedAt: undefined, archiveBatchId: undefined } : item
            ),
            conversations: state.conversations.map((conversation) =>
              batchId && conversation.archiveBatchId === batchId
                ? { ...conversation, archivedAt: undefined, archiveBatchId: undefined }
                : conversation
            ),
          };
        });
      },

      permanentlyDeleteProject: (id: string) => {
        set((state) => {
          const projects = state.projects.filter((project) => project.id !== id);
          const conversations = state.conversations.filter((conversation) => conversation.projectId !== id);
          return { projects, ...resolveActiveConversation(conversations, state.currentConversationId) };
        });
      },

      setProjectSort: (sort: ProjectSort) => set({ projectSort: sort }),

      setModel: (model: string) => set({ model }),

      setReasoningEffort: (effort: ReasoningEffort) => set({ reasoningEffort: effort }),

      setSpeed: (speed: Speed) => set({ speed }),

      setApprovalMode: (mode: ApprovalMode) => set({ approvalMode: mode }),

      resolveAuthorization: (id: string, decision: ApprovalDecision) => {
        const resolve = authorizationResolvers.get(id);
        if (resolve) {
          authorizationResolvers.delete(id);
          resolve(decision);
        }
        set((state) => (state.pendingAuthorization?.id === id ? { pendingAuthorization: null } : {}));
      },

      refreshCodexStatus: async () => {
        set({ isCheckingCodex: true, error: null });
        try {
          const status = await checkCodex();
          set({ codexStatus: status, isCheckingCodex: false });
        } catch (error) {
          set({
            codexStatus: {
              installed: false,
              version: '',
              path: '',
              loggedIn: false,
              error: stringifyError(error),
            },
            isCheckingCodex: false,
          });
        }
      },

      sendMessage: async (message: string) => {
        const trimmed = message.trim();
        if (!trimmed) return;

        let conversationId = get().currentConversationId;
        const activeIds = new Set(activeConversations(get().conversations).map((item) => item.id));
        if (!conversationId || !activeIds.has(conversationId)) {
          conversationId = get().createConversation();
        }
        const conversation = get().conversations.find((item) => item.id === conversationId);
        if (!conversation || conversation.status === 'streaming' || conversation.archivedAt) return;

        const userMessage: ChatMessage = {
          id: createId('user'),
          role: 'user',
          timestamp: Date.now(),
          blocks: [{ type: 'text', content: trimmed }],
        };
        const assistantMessage: ChatMessage = {
          id: createId('assistant'),
          role: 'assistant',
          timestamp: Date.now(),
          isStreaming: true,
          blocks: [],
        };
        const nextTitle = conversation.messages.length === 0
          ? buildConversationTitle(trimmed)
          : conversation.title;

        set((state) => ({
          conversations: state.conversations.map((item) =>
            item.id === conversationId
              ? {
                  ...item,
                  title: nextTitle,
                  messages: [...item.messages, userMessage, assistantMessage],
                  status: 'streaming',
                  updatedAt: Date.now(),
                  runId: undefined,
                }
              : item
          ),
          error: null,
        }));

        const sandboxMode = await runApprovalGate(conversationId);
        if (sandboxMode === null) return;

        if (!isTauriRuntime()) {
          simulateBrowserReply(conversationId, get().handleCodexEvent);
          return;
        }

        try {
          const latest = get().conversations.find((item) => item.id === conversationId);
          const prompt = buildCodingPrompt(trimmed);
          const result = await startCodexChat({
            conversationId,
            prompt,
            codexThreadId: latest?.codexThreadId,
            cwd: latest?.cwd || undefined,
            model: get().model,
            reasoningEffort: get().reasoningEffort,
            sandboxMode,
          });
          set((state) => ({
            conversations: state.conversations.map((item) =>
              item.id === conversationId ? { ...item, runId: result.runId } : item
            ),
          }));
        } catch (error) {
          get().handleCodexEvent({
            type: 'error',
            runId: '',
            conversationId,
            message: stringifyError(error),
          });
        }
      },

      editUserMessageAndResend: async (conversationId: string, messageId: string, message: string) => {
        const trimmed = message.trim();
        if (!trimmed) return;

        const conversation = get().conversations.find((item) => item.id === conversationId);
        if (!conversation || conversation.status === 'streaming' || conversation.archivedAt) return;

        const messageIndex = conversation.messages.findIndex(
          (item) => item.id === messageId && item.role === 'user',
        );
        if (messageIndex < 0) return;

        const now = Date.now();
        const previousMessages = conversation.messages.slice(0, messageIndex);
        const editedUserMessage: ChatMessage = {
          ...conversation.messages[messageIndex],
          timestamp: now,
          blocks: [{ type: 'text', content: trimmed }],
        };
        const assistantMessage: ChatMessage = {
          id: createId('assistant'),
          role: 'assistant',
          timestamp: now,
          isStreaming: true,
          blocks: [],
        };
        const nextTitle = messageIndex === 0 ? buildConversationTitle(trimmed) : conversation.title;

        set((state) => ({
          conversations: state.conversations.map((item) =>
            item.id === conversationId
              ? {
                  ...item,
                  title: nextTitle,
                  messages: [...previousMessages, editedUserMessage, assistantMessage],
                  status: 'streaming',
                  updatedAt: now,
                  runId: undefined,
                  codexThreadId: undefined,
                }
              : item
          ),
          currentConversationId: conversationId,
          error: null,
        }));

        const sandboxMode = await runApprovalGate(conversationId);
        if (sandboxMode === null) return;

        if (!isTauriRuntime()) {
          simulateBrowserReply(conversationId, get().handleCodexEvent);
          return;
        }

        try {
          const latest = get().conversations.find((item) => item.id === conversationId);
          const prompt = buildCodingPrompt(buildEditedPrompt(trimmed, previousMessages));
          const result = await startCodexChat({
            conversationId,
            prompt,
            cwd: latest?.cwd || undefined,
            model: get().model,
            reasoningEffort: get().reasoningEffort,
            sandboxMode,
          });
          set((state) => ({
            conversations: state.conversations.map((item) =>
              item.id === conversationId ? { ...item, runId: result.runId } : item
            ),
          }));
        } catch (error) {
          get().handleCodexEvent({
            type: 'error',
            runId: '',
            conversationId,
            message: stringifyError(error),
          });
        }
      },

      stopCurrentConversation: async () => {
        const conversation = get().conversations.find((item) => item.id === get().currentConversationId);
        if (!conversation?.runId) return;
        try {
          await stopCodexChat(conversation.runId);
        } catch (error) {
          set({ error: stringifyError(error) });
        }
      },

      handleCodexEvent: (event: CodexChatEvent) => {
        set((state) => ({
          conversations: state.conversations.map((conversation) =>
            applyCodexEventToConversation(conversation, event)
          ),
        }));
      },
      };
    },
    {
      name: 'alpha-studio.chat.v2',
      version: 3,
      partialize: (state) => ({
        conversations: state.conversations,
        projects: state.projects,
        currentConversationId: state.currentConversationId,
        model: state.model,
        reasoningEffort: state.reasoningEffort,
        speed: state.speed,
        approvalMode: state.approvalMode,
        projectSort: state.projectSort,
        conversationSort: state.conversationSort,
      }),
      migrate: (persistedState) => migratePersistedState(persistedState),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const active = activeConversations(state.conversations);
        if (!state.currentConversationId || !active.some((item) => item.id === state.currentConversationId)) {
          state.currentConversationId = active[0]?.id ?? null;
        }
      },
    },
  ),
);

export function useCurrentConversation(): Conversation | null {
  return useChatStore((state) => {
    const active = activeConversations(state.conversations);
    const id = state.currentConversationId || active[0]?.id;
    return active.find((conversation) => conversation.id === id) || active[0] || null;
  });
}

export function activeConversations(conversations: Conversation[]): Conversation[] {
  return conversations.filter((conversation) => !conversation.archivedAt);
}

// A draft is an unsent, blank conversation. It stays hidden from the sidebar
// (but remains the active conversation in the main view) until a message is sent.
export function isDraftConversation(conversation: Conversation): boolean {
  return conversation.messages.length === 0 && !conversation.archivedAt && !conversation.pinned;
}

// Conversations that should appear in the sidebar: active and not an unsent draft.
export function visibleConversations(conversations: Conversation[]): Conversation[] {
  return activeConversations(conversations).filter((conversation) => !isDraftConversation(conversation));
}

export function archivedConversations(conversations: Conversation[]): Conversation[] {
  return conversations.filter((conversation) => Boolean(conversation.archivedAt));
}

export function activeProjects(projects: Project[]): Project[] {
  return projects.filter((project) => !project.archivedAt);
}

export function archivedProjects(projects: Project[]): Project[] {
  return projects.filter((project) => Boolean(project.archivedAt));
}

function resolveActiveConversation(
  conversations: Conversation[],
  preferredId: string | null,
): Pick<ChatState, 'conversations' | 'currentConversationId'> {
  const active = activeConversations(conversations);
  if (active.length === 0) {
    const fresh = createEmptyConversation();
    return {
      conversations: [fresh, ...conversations],
      currentConversationId: fresh.id,
    };
  }
  const preferred = preferredId && active.some((conversation) => conversation.id === preferredId)
    ? preferredId
    : active[0].id;
  return { conversations, currentConversationId: preferred };
}

function createEmptyConversation(project?: Project): Conversation {
  const now = Date.now();
  return {
    id: createId('conv'),
    title: '新对话',
    messages: [],
    cwd: project?.cwd ?? '',
    projectId: project?.id,
    createdAt: now,
    updatedAt: now,
    status: 'idle',
  };
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function buildConversationTitle(message: string): string {
  const compact = message.replace(/\s+/g, ' ').trim();
  return compact.length > 24 ? `${compact.slice(0, 24)}...` : compact || '新对话';
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error || 'Unknown error');
}

function buildEditedPrompt(message: string, previousMessages: ChatMessage[]): string {
  const context = previousMessages
    .map((item) => {
      const content = messageBlocksToText(item.blocks);
      if (!content) return null;
      return `${item.role === 'user' ? '用户' : 'AI'}：\n${content}`;
    })
    .filter(Boolean)
    .join('\n\n');

  if (!context) return message;

  return [
    '以下是本地可见的历史上下文。用户刚刚编辑了后续的一条消息，旧回复已被截断。',
    '',
    context,
    '',
    '请基于以上上下文回答这条编辑后的用户消息：',
    message,
  ].join('\n');
}

function messageBlocksToText(blocks: ChatMessage['blocks']): string {
  return blocks
    .map((block) => {
      if (block.type === 'text' || block.type === 'thinking' || block.type === 'error') {
        return block.content;
      }
      if (block.type === 'tool') {
        return [block.title, block.input, block.output].filter(Boolean).join('\n');
      }
      return '';
    })
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

function simulateBrowserReply(conversationId: string, dispatch: (event: CodexChatEvent) => void): void {
  const runId = createId('preview');
  dispatch({ type: 'started', runId, conversationId });
  dispatch({ type: 'thread_started', runId, conversationId, threadId: 'browser-preview' });

  const events: Array<{ delay: number; event: CodexChatEvent }> = [];
  let delay = 160;
  const push = (event: CodexChatEvent) => events.push({ delay, event });

  push({ type: 'reasoning_delta', runId, conversationId, text: '先做一次只读体检：看工作区状态、目录结构和关键文件，再决定下一步。' });
  delay += 260;

  const commands = [
    { id: 'status', cmd: 'git status --short', out: ' M src/App.tsx\n M src/store.ts\n M src/styles.css\n' },
    { id: 'ls', cmd: 'ls -la src', out: 'total 96\n-rw-r--r--  1 user  staff   72K App.tsx\n-rw-r--r--  1 user  staff   18K store.ts\n-rw-r--r--  1 user  staff   54K styles.css\n' },
    { id: 'disk', cmd: 'du -sh node_modules 2>/dev/null || echo missing', out: 'missing\n' },
  ];
  for (const command of commands) {
    push({ type: 'tool_started', runId, conversationId, itemId: `${runId}-${command.id}`, title: 'command_execution', text: command.cmd });
    delay += 240;
    push({ type: 'tool_delta', runId, conversationId, itemId: `${runId}-${command.id}`, title: 'command_execution', text: command.out });
    delay += 220;
    push({ type: 'tool_completed', runId, conversationId, itemId: `${runId}-${command.id}`, title: 'command_execution' });
    delay += 200;
  }

  const chunks = [
    '预览模式已按 Codex 风格渲染事件流：',
    '\n\n1. 连续的命令会折叠成「已运行 N 条命令」，可展开查看每条命令与终端结果。',
    '\n2. 推理与文本会分段流式追加，任务进行时底部显示「正在思考」。',
    '\n3. 桌面模式会把这些预览事件替换为真实 Codex CLI 输出。',
  ];
  for (const text of chunks) {
    push({ type: 'text_delta', runId, conversationId, text });
    delay += 200;
  }
  push({ type: 'completed', runId, conversationId });

  for (const item of events) {
    window.setTimeout(() => dispatch(item.event), item.delay);
  }
}

export function migratePersistedState(persistedState: unknown): PersistedChatState {
  const source = (persistedState && typeof persistedState === 'object' ? persistedState : {}) as Record<string, unknown>;
  const conversations = Array.isArray(source.conversations)
    ? (source.conversations as Conversation[]).map((conversation) => ({
        ...conversation,
        title: conversation.title === LEGACY_DEFAULT_CONVERSATION_TITLE ? '新对话' : conversation.title,
      }))
    : [createEmptyConversation()];
  const projects = Array.isArray(source.projects) ? (source.projects as Project[]) : [];
  const currentConversationId = typeof source.currentConversationId === 'string'
    ? source.currentConversationId
    : activeConversations(conversations)[0]?.id ?? conversations[0]?.id ?? null;

  return {
    conversations,
    projects,
    currentConversationId,
    model: typeof source.model === 'string' ? source.model : DEFAULT_MODEL,
    reasoningEffort: isReasoningEffort(source.reasoningEffort) ? source.reasoningEffort : DEFAULT_EFFORT,
    speed: source.speed === 'fast' || source.speed === 'standard' ? source.speed : DEFAULT_SPEED,
    approvalMode: isApprovalMode(source.approvalMode)
      ? source.approvalMode
      : sandboxToApproval(source.sandboxMode),
    projectSort: isProjectSort(source.projectSort) ? source.projectSort : 'updated',
    conversationSort: isProjectSort(source.conversationSort) ? source.conversationSort : 'updated',
  };
}

function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh';
}

function isProjectSort(value: unknown): value is ProjectSort {
  return value === 'updated' || value === 'created' || value === 'name';
}
