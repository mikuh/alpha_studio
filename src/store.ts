import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { applyCodexEventToConversation } from './codexEvents';
import { buildFinancePrompt } from './prompt';
import { checkCodex, isTauriRuntime, startCodexChat, stopCodexChat } from './codexBridge';
import { DEFAULT_EFFORT, DEFAULT_MODEL, DEFAULT_SPEED, type ReasoningEffort, type Speed } from './models';
import type {
  ChatMessage,
  CodexChatEvent,
  CodexStatus,
  Conversation,
  Holding,
  Project,
  SandboxMode,
  WatchItem,
} from './types';

const DEFAULT_CWD = '/Users/geb/codes/alpha_studio';

interface ChatState {
  conversations: Conversation[];
  projects: Project[];
  currentConversationId: string | null;
  activeCoworkerId: string;
  model: string;
  reasoningEffort: ReasoningEffort;
  speed: Speed;
  codexStatus: CodexStatus | null;
  sandboxMode: SandboxMode;
  isCheckingCodex: boolean;
  error: string | null;
  holdings: Holding[];
  watchlist: WatchItem[];
  createConversation: (projectId?: string) => string;
  setCurrentConversation: (id: string) => void;
  deleteConversation: (id: string) => void;
  createProject: (input?: { name?: string; cwd?: string }) => string;
  renameProject: (id: string, name: string) => void;
  setProjectCwd: (id: string, cwd: string) => void;
  deleteProject: (id: string) => void;
  setActiveCoworker: (id: string) => void;
  setModel: (model: string) => void;
  setReasoningEffort: (effort: ReasoningEffort) => void;
  setSpeed: (speed: Speed) => void;
  setSandboxMode: (mode: SandboxMode) => void;
  refreshCodexStatus: () => Promise<void>;
  sendMessage: (message: string) => Promise<void>;
  stopCurrentConversation: () => Promise<void>;
  handleCodexEvent: (event: CodexChatEvent) => void;
  addHolding: (input: Omit<Holding, 'id' | 'createdAt'>) => void;
  updateHolding: (id: string, patch: Partial<Omit<Holding, 'id' | 'createdAt'>>) => void;
  removeHolding: (id: string) => void;
  addWatchItem: (input: Omit<WatchItem, 'id' | 'createdAt'>) => void;
  updateWatchItem: (id: string, patch: Partial<Omit<WatchItem, 'id' | 'createdAt'>>) => void;
  removeWatchItem: (id: string) => void;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      conversations: [createEmptyConversation()],
      projects: [],
      currentConversationId: null,
      activeCoworkerId: 'pm',
      model: DEFAULT_MODEL,
      reasoningEffort: DEFAULT_EFFORT,
      speed: DEFAULT_SPEED,
      codexStatus: null,
      sandboxMode: 'read-only',
      isCheckingCodex: false,
      error: null,
      holdings: [],
      watchlist: [],

      createConversation: (projectId?: string) => {
        const project = projectId
          ? get().projects.find((item) => item.id === projectId)
          : undefined;
        const conversation = createEmptyConversation(project);
        set((state) => ({
          conversations: [conversation, ...state.conversations],
          currentConversationId: conversation.id,
          error: null,
        }));
        return conversation.id;
      },

      setCurrentConversation: (id: string) => {
        set({ currentConversationId: id, error: null });
      },

      deleteConversation: (id: string) => {
        set((state) => {
          const conversations = state.conversations.filter((conversation) => conversation.id !== id);
          const fallbackId = conversations[0]?.id || null;
          return {
            conversations: conversations.length > 0 ? conversations : [createEmptyConversation()],
            currentConversationId: state.currentConversationId === id ? fallbackId : state.currentConversationId,
          };
        });
      },

      createProject: (input) => {
        const now = Date.now();
        const fallbackName = `新项目 ${get().projects.length + 1}`;
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

      deleteProject: (id: string) => {
        set((state) => ({
          projects: state.projects.filter((project) => project.id !== id),
          conversations: state.conversations.map((conversation) =>
            conversation.projectId === id
              ? { ...conversation, projectId: undefined, cwd: '' }
              : conversation
          ),
        }));
      },

      setActiveCoworker: (id: string) => set({ activeCoworkerId: id }),

      setModel: (model: string) => set({ model }),

      setReasoningEffort: (effort: ReasoningEffort) => set({ reasoningEffort: effort }),

      setSpeed: (speed: Speed) => set({ speed }),

      setSandboxMode: (mode: SandboxMode) => set({ sandboxMode: mode }),

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
        if (!conversationId) {
          conversationId = get().createConversation();
        }
        const conversation = get().conversations.find((item) => item.id === conversationId);
        if (!conversation || conversation.status === 'streaming') return;

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

        if (!isTauriRuntime()) {
          simulateBrowserReply(conversationId, get().handleCodexEvent);
          return;
        }

        try {
          const latest = get().conversations.find((item) => item.id === conversationId);
          const prompt = buildFinancePrompt(trimmed, get().activeCoworkerId);
          const result = await startCodexChat({
            conversationId,
            prompt,
            codexThreadId: latest?.codexThreadId,
            cwd: latest?.cwd || DEFAULT_CWD,
            model: get().model,
            reasoningEffort: get().reasoningEffort,
            sandboxMode: get().sandboxMode,
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

      addHolding: (input) => {
        const holding: Holding = {
          ...input,
          code: input.code.trim().toUpperCase(),
          name: input.name.trim(),
          id: createId('hold'),
          createdAt: Date.now(),
        };
        if (!holding.code) return;
        set((state) => ({ holdings: [holding, ...state.holdings] }));
      },

      updateHolding: (id, patch) => {
        set((state) => ({
          holdings: state.holdings.map((holding) =>
            holding.id === id ? { ...holding, ...patch } : holding
          ),
        }));
      },

      removeHolding: (id) => {
        set((state) => ({ holdings: state.holdings.filter((holding) => holding.id !== id) }));
      },

      addWatchItem: (input) => {
        const item: WatchItem = {
          ...input,
          code: input.code.trim().toUpperCase(),
          name: input.name.trim(),
          id: createId('watch'),
          createdAt: Date.now(),
        };
        if (!item.code) return;
        set((state) => ({ watchlist: [item, ...state.watchlist] }));
      },

      updateWatchItem: (id, patch) => {
        set((state) => ({
          watchlist: state.watchlist.map((item) =>
            item.id === id ? { ...item, ...patch } : item
          ),
        }));
      },

      removeWatchItem: (id) => {
        set((state) => ({ watchlist: state.watchlist.filter((item) => item.id !== id) }));
      },
    }),
    {
      name: 'alpha-studio.chat.v1',
      version: 1,
      partialize: (state) => ({
        conversations: state.conversations,
        projects: state.projects,
        currentConversationId: state.currentConversationId,
        activeCoworkerId: state.activeCoworkerId,
        model: state.model,
        reasoningEffort: state.reasoningEffort,
        speed: state.speed,
        sandboxMode: state.sandboxMode,
        holdings: state.holdings,
        watchlist: state.watchlist,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        if (!state.currentConversationId && state.conversations[0]) {
          state.currentConversationId = state.conversations[0].id;
        }
      },
    },
  ),
);

export function useCurrentConversation(): Conversation | null {
  return useChatStore((state) => {
    const id = state.currentConversationId || state.conversations[0]?.id;
    return state.conversations.find((conversation) => conversation.id === id) || null;
  });
}

function createEmptyConversation(project?: Project): Conversation {
  const now = Date.now();
  return {
    id: createId('conv'),
    title: '新的投研对话',
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
  return compact.length > 24 ? `${compact.slice(0, 24)}...` : compact || '新的投研对话';
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error || 'Unknown error');
}

function simulateBrowserReply(conversationId: string, dispatch: (event: CodexChatEvent) => void): void {
  const runId = createId('preview');
  dispatch({ type: 'started', runId, conversationId });
  dispatch({ type: 'thread_started', runId, conversationId, threadId: 'browser-preview' });
  setTimeout(() => {
    dispatch({
      type: 'text_delta',
      runId,
      conversationId,
      text: '这是浏览器预览模式。真实 Codex CLI 对话请使用 `npm run tauri:dev` 启动桌面应用。',
    });
    dispatch({ type: 'completed', runId, conversationId });
  }, 300);
}
