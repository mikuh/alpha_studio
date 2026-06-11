import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { applyCodexEventToConversation } from './codexEvents';
import { buildCodingPrompt, buildReviewPrompt } from './prompt';
import { checkCodex, isTauriRuntime, loadModelConfig as loadModelConfigFile, saveModelConfig as saveModelConfigFile, startCodexChat, stopCodexChat, subscribeCodexEvents } from './codexBridge';
import { DEFAULT_WORK_MODE_ID, activeDomain, isWorkModeId, type WorkModeId } from './domain';
import {
  DEFAULT_APPROVAL,
  DEFAULT_EFFORT,
  DEFAULT_MODEL_PROFILE_ID,
  DEFAULT_SPEED,
  approvalRequiresPrompt,
  baseSandboxForApproval,
  defaultModelProfiles,
  isApprovalMode,
  normalizeModelProfileDraft,
  normalizeModelProfiles,
  resolveModelProfile,
  selectedModelProfileId as resolveSelectedModelProfileId,
  sandboxToApproval,
  stripModelProfileSecrets,
  type ApprovalMode,
  type ModelProfile,
  type ModelProfileDraft,
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
  MessageAttachment,
  MessageBlock,
  Project,
  ProjectSort,
  ReviewRequest,
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
  selectedModelProfileId: string;
  modelProfiles: ModelProfile[];
  modelConfigPath: string | null;
  isLoadingModelConfig: boolean;
  reasoningEffort: ReasoningEffort;
  speed: Speed;
  workModeId: WorkModeId;
  codexStatus: CodexStatus | null;
  approvalMode: ApprovalMode;
  planMode: boolean;
  pursueGoal: boolean;
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
  setConversationCwd: (id: string, cwd: string, projectId?: string | null) => void;
  setConversationSort: (sort: ProjectSort) => void;
  createProject: (input?: { name?: string; cwd?: string }) => string;
  renameProject: (id: string, name: string) => void;
  setProjectCwd: (id: string, cwd: string) => void;
  toggleProjectPin: (id: string) => void;
  archiveProject: (id: string) => void;
  unarchiveProject: (id: string) => void;
  permanentlyDeleteProject: (id: string) => void;
  setProjectSort: (sort: ProjectSort) => void;
  setModelProfile: (id: string) => void;
  addModelProfile: (profile: ModelProfileDraft) => string | null;
  updateModelProfile: (id: string, patch: Partial<ModelProfileDraft>) => void;
  deleteModelProfile: (id: string) => void;
  toggleModelProfile: (id: string, enabled: boolean) => void;
  loadModelConfig: () => Promise<void>;
  setReasoningEffort: (effort: ReasoningEffort) => void;
  setSpeed: (speed: Speed) => void;
  setWorkModeId: (modeId: WorkModeId) => void;
  setApprovalMode: (mode: ApprovalMode) => void;
  setPlanMode: (planMode: boolean) => void;
  setPursueGoal: (pursueGoal: boolean) => void;
  resolveAuthorization: (id: string, decision: ApprovalDecision) => void;
  refreshCodexStatus: () => Promise<void>;
  sendMessage: (message: string, attachments?: MessageAttachment[]) => Promise<void>;
  startReview: (request: ReviewRequest) => Promise<void>;
  editUserMessageAndResend: (conversationId: string, messageId: string, message: string, attachments?: MessageAttachment[]) => Promise<void>;
  stopCurrentConversation: () => Promise<void>;
  handleCodexEvent: (event: CodexChatEvent) => void;
}

interface PersistedChatState {
  conversations: Conversation[];
  projects: Project[];
  currentConversationId: string | null;
  selectedModelProfileId: string;
  modelProfiles: ModelProfile[];
  reasoningEffort: ReasoningEffort;
  speed: Speed;
  workModeId: WorkModeId;
  approvalMode: ApprovalMode;
  planMode: boolean;
  pursueGoal: boolean;
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
          title: 'Incuboot 请求操作权限',
          description: latest?.cwd
            ? '允许 Incuboot 在当前品牌目录读取、修改文件并运行命令吗？'
            : '允许 Incuboot 读取、修改文件并运行命令吗？',
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

      const persistModelConfig = () => {
        const state = get();
        void saveModelConfigFile({
          selectedModelProfileId: state.selectedModelProfileId,
          modelProfiles: state.modelProfiles.filter((profile) => !profile.builtIn),
        })
          .then((path) => {
            if (path) set({ modelConfigPath: path });
          })
          .catch((error) => set({ error: stringifyError(error) }));
      };

      return {
        conversations: [createEmptyConversation()],
        projects: [],
        currentConversationId: null,
        selectedModelProfileId: DEFAULT_MODEL_PROFILE_ID,
        modelProfiles: defaultModelProfiles(),
        modelConfigPath: null,
        isLoadingModelConfig: false,
        reasoningEffort: DEFAULT_EFFORT,
        speed: DEFAULT_SPEED,
      workModeId: DEFAULT_WORK_MODE_ID,
      codexStatus: null,
      approvalMode: DEFAULT_APPROVAL,
      planMode: false,
      pursueGoal: false,
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

      // Duplicate a conversation into a new, independent one (same brand/cwd) that
      // carries over the existing transcript. New message ids keep the copy
      // from clobbering the source while editing.
      duplicateConversation: (id: string) => {
        const source = get().conversations.find((item) => item.id === id);
        if (!source) return null;
        const now = Date.now();
        const clone: Conversation = {
          ...source,
          id: createId('conv'),
          title: `${source.title} 副本`,
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

      // Point a single conversation at a brand directory. Picking an existing
      // brand carries its id so the conversation stays grouped; choosing a raw
      // folder passes projectId=null to detach it into a standalone chat. Passing
      // undefined leaves the current brand association untouched.
      setConversationCwd: (id, cwd, projectId) => {
        const next = cwd.trim();
        set((state) => ({
          conversations: state.conversations.map((conversation) =>
            conversation.id === id
              ? {
                  ...conversation,
                  cwd: next,
                  projectId: projectId === undefined ? conversation.projectId : projectId ?? undefined,
                  updatedAt: Date.now(),
                }
              : conversation
          ),
        }));
      },

      setConversationSort: (sort) => set({ conversationSort: sort }),

      createProject: (input) => {
        const now = Date.now();
        const fallbackName = `新品牌 ${activeProjects(get().projects).length + 1}`;
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

      setModelProfile: (id: string) => {
        const selected = get().modelProfiles.find((profile) => profile.id === id && profile.enabled);
        if (selected) {
          set({ selectedModelProfileId: selected.id });
          persistModelConfig();
        }
      },

      addModelProfile: (profile) => {
        const normalized = normalizeModelProfileDraft(profile);
        if (!normalized.model || (normalized.providerId !== 'openai' && !normalized.baseUrl)) return null;
        const id = createId('model');
        set((state) => ({
          modelProfiles: [...state.modelProfiles, { ...normalized, id }],
          selectedModelProfileId: id,
        }));
        persistModelConfig();
        return id;
      },

      updateModelProfile: (id, patch) => {
        set((state) => {
          const target = state.modelProfiles.find((profile) => profile.id === id);
          if (!target || target.builtIn) return {};
          const next = normalizeModelProfileDraft({ ...target, ...patch });
          if (!next.model || (next.providerId !== 'openai' && !next.baseUrl)) return {};
          return {
            modelProfiles: state.modelProfiles.map((profile) =>
              profile.id === id ? { ...next, id } : profile
            ),
          };
        });
        persistModelConfig();
      },

      deleteModelProfile: (id) => {
        set((state) => {
          const target = state.modelProfiles.find((profile) => profile.id === id);
          if (!target || target.builtIn) return {};
          const modelProfiles = state.modelProfiles.filter((profile) => profile.id !== id);
          const selectedModelProfileId =
            state.selectedModelProfileId === id
              ? resolveModelProfile(modelProfiles, DEFAULT_MODEL_PROFILE_ID).id
              : state.selectedModelProfileId;
          return { modelProfiles, selectedModelProfileId };
        });
        persistModelConfig();
      },

      toggleModelProfile: (id, enabled) => {
        set((state) => {
          const modelProfiles = state.modelProfiles.map((profile) =>
            profile.id === id && !profile.builtIn ? { ...profile, enabled } : profile
          );
          const selectedModelProfileId =
            !enabled && state.selectedModelProfileId === id
              ? resolveModelProfile(modelProfiles, DEFAULT_MODEL_PROFILE_ID).id
              : state.selectedModelProfileId;
          return { modelProfiles, selectedModelProfileId };
        });
        persistModelConfig();
      },

      loadModelConfig: async () => {
        if (!isTauriRuntime()) return;
        set({ isLoadingModelConfig: true, error: null });
        try {
          const config = await loadModelConfigFile();
          if (!config) {
            set({ isLoadingModelConfig: false });
            return;
          }
          const modelProfiles = normalizeModelProfiles(config.modelProfiles);
          const selectedModelProfileId = resolveSelectedModelProfileId(
            config.selectedModelProfileId,
            modelProfiles,
          );
          set({
            modelProfiles,
            selectedModelProfileId,
            modelConfigPath: config.path ?? null,
            isLoadingModelConfig: false,
          });
        } catch (error) {
          set({ isLoadingModelConfig: false, error: stringifyError(error) });
        }
      },

      setReasoningEffort: (effort: ReasoningEffort) => set({ reasoningEffort: effort }),

      setSpeed: (speed: Speed) => set({ speed }),

      setWorkModeId: (workModeId: WorkModeId) => set({ workModeId }),

      setApprovalMode: (mode: ApprovalMode) => set({ approvalMode: mode }),

      setPlanMode: (planMode: boolean) => set({ planMode }),

      setPursueGoal: (pursueGoal: boolean) => set({ pursueGoal }),

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

      sendMessage: async (message: string, attachments?: MessageAttachment[]) => {
        const trimmed = message.trim();
        const attachmentList = attachments && attachments.length ? attachments : undefined;
        if (!trimmed && !attachmentList) return;

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
          blocks: trimmed ? [{ type: 'text', content: trimmed }] : [],
          attachments: attachmentList,
        };
        const assistantMessage: ChatMessage = {
          id: createId('assistant'),
          role: 'assistant',
          timestamp: Date.now(),
          isStreaming: true,
          blocks: [],
        };
        const nextTitle = conversation.messages.length === 0
          ? buildConversationTitle(trimmed || attachmentList?.[0]?.name || '')
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
	          const modelProfile = resolveModelProfile(get().modelProfiles, get().selectedModelProfileId);
	          const prompt = buildCodingPrompt(promptWithAttachments(trimmed, attachmentList), {
	            planMode: get().planMode,
	            pursueGoal: get().pursueGoal,
	          }, activeDomain(get().workModeId));
	          const result = await startCodexChat({
	            conversationId,
	            prompt,
	            codexThreadId: latest?.codexThreadId,
	            cwd: latest?.cwd || undefined,
	            ...codexModelRequest(modelProfile, get().reasoningEffort),
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

      startReview: async (request: ReviewRequest) => {
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
          blocks: [{ type: 'text', content: request.label }],
          reviewRequest: request,
        };
        const assistantMessage: ChatMessage = {
          id: createId('assistant'),
          role: 'assistant',
          timestamp: Date.now(),
          isStreaming: true,
          blocks: [],
          review: true,
        };
        const nextTitle = conversation.messages.length === 0 ? request.label : conversation.title;

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
          simulateBrowserReview(conversationId, request, get().handleCodexEvent);
          return;
        }

	        try {
	          const latest = get().conversations.find((item) => item.id === conversationId);
	          const modelProfile = resolveModelProfile(get().modelProfiles, get().selectedModelProfileId);
	          // Reviews always run read-only so they can never touch the working tree,
	          // matching Codex's dedicated reviewer (no approval prompt needed).
	          const result = await startCodexChat({
	            conversationId,
	            prompt: buildReviewPrompt(request),
	            codexThreadId: latest?.codexThreadId,
	            cwd: latest?.cwd || undefined,
	            ...codexModelRequest(modelProfile, get().reasoningEffort),
	            sandboxMode: 'read-only',
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

      editUserMessageAndResend: async (
        conversationId: string,
        messageId: string,
        message: string,
        attachments?: MessageAttachment[],
      ) => {
        const trimmed = message.trim();

        const conversation = get().conversations.find((item) => item.id === conversationId);
        if (!conversation || conversation.status === 'streaming' || conversation.archivedAt) return;

        const messageIndex = conversation.messages.findIndex(
          (item) => item.id === messageId && item.role === 'user',
        );
        if (messageIndex < 0) return;

        const original = conversation.messages[messageIndex];
        // When the caller passes an explicit list we honor it (including clearing
        // to none); otherwise we keep whatever the original message carried so the
        // attached file/image context survives the edit.
        const nextAttachments =
          attachments !== undefined
            ? (attachments.length ? attachments : undefined)
            : original.attachments;
        if (!trimmed && !nextAttachments) return;

        const now = Date.now();
        const previousMessages = conversation.messages.slice(0, messageIndex);
        const editedUserMessage: ChatMessage = {
          ...original,
          timestamp: now,
          blocks: trimmed ? [{ type: 'text', content: trimmed }] : [],
          attachments: nextAttachments,
        };
        const assistantMessage: ChatMessage = {
          id: createId('assistant'),
          role: 'assistant',
          timestamp: now,
          isStreaming: true,
          blocks: [],
        };
        const nextTitle = messageIndex === 0
          ? buildConversationTitle(trimmed || nextAttachments?.[0]?.name || '')
          : conversation.title;

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
	          const modelProfile = resolveModelProfile(get().modelProfiles, get().selectedModelProfileId);
	          const prompt = buildCodingPrompt(
	            promptWithAttachments(buildEditedPrompt(trimmed, previousMessages), nextAttachments),
	            {
              planMode: get().planMode,
              pursueGoal: get().pursueGoal,
            },
            activeDomain(get().workModeId),
          );
	          const result = await startCodexChat({
	            conversationId,
	            prompt,
	            cwd: latest?.cwd || undefined,
	            ...codexModelRequest(modelProfile, get().reasoningEffort),
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
        if (!conversation || conversation.status !== 'streaming') return;
        if (conversation.runId) {
          try {
            await stopCodexChat(conversation.runId);
          } catch (error) {
            set({ error: stringifyError(error) });
          }
        }
        // Always finalize locally so the stop button can never get stuck. When
        // the backend has a live process for this run it also emits its own
        // `stopped`, but that is now idempotent; when it doesn't (e.g. the run
        // is a stale one persisted from before an app/process restart, so there
        // is nothing left to kill) this local finalize is the only thing that
        // unsticks the conversation.
        get().handleCodexEvent({
          type: 'stopped',
          runId: conversation.runId ?? '',
          conversationId: conversation.id,
        });
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
      version: 5,
      partialize: (state) => ({
        conversations: state.conversations,
        projects: state.projects,
        currentConversationId: state.currentConversationId,
        selectedModelProfileId: state.selectedModelProfileId,
        modelProfiles: stripModelProfileSecrets(state.modelProfiles),
        reasoningEffort: state.reasoningEffort,
        speed: state.speed,
        workModeId: state.workModeId,
        approvalMode: state.approvalMode,
        planMode: state.planMode,
        pursueGoal: state.pursueGoal,
        projectSort: state.projectSort,
        conversationSort: state.conversationSort,
      }),
      migrate: (persistedState) => migratePersistedState(persistedState),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // A conversation persisted mid-turn comes back as `streaming` with a
        // `runId` that no longer maps to any live process (the Codex process
        // restarts on every `tauri dev` rebuild and on app relaunch). Finalize
        // those on load so they don't show "正在思考" forever and stay stuck.
        state.conversations = state.conversations.map(recoverInterruptedConversation);
        const active = activeConversations(state.conversations);
        if (!state.currentConversationId || !active.some((item) => item.id === state.currentConversationId)) {
          state.currentConversationId = active[0]?.id ?? null;
        }
      },
    },
  ),
);

interface ImageViewerState {
  src: string | null;
  alt: string;
  open: (src: string, alt?: string) => void;
  close: () => void;
}

// Ephemeral, non-persisted state for the full-size image lightbox.
export const useImageViewer = create<ImageViewerState>((set) => ({
  src: null,
  alt: '',
  open: (src, alt = '') => set({ src, alt }),
  close: () => set({ src: null, alt: '' }),
}));

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

// Closes out a conversation that was persisted while a turn was still in
// flight. The backing run is necessarily dead by the time we rehydrate, so we
// drop the status/runId back to idle and stop any half-streamed message from
// rendering as if it were still live (empty ones get a short interrupted note).
function recoverInterruptedConversation(conversation: Conversation): Conversation {
  const needsRecovery =
    conversation.status === 'streaming' ||
    conversation.runId !== undefined ||
    conversation.messages.some((message) => message.isStreaming);
  if (!needsRecovery) return conversation;

  const messages = conversation.messages.map((message) => {
    if (!message.isStreaming) return message;
    const interrupted: MessageBlock[] = [{ type: 'text', content: '[已中断]' }];
    return {
      ...message,
      isStreaming: false,
      blocks: message.blocks.length > 0 ? message.blocks : interrupted,
    };
  });

  return { ...conversation, status: 'idle', runId: undefined, messages };
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

const CONVERSATION_TITLE_MAX_LENGTH = 24;

export function buildConversationTitle(message: string): string {
  const source = normalizeTitleSource(message);
  if (!source) return '新对话';

  const withoutGreeting = stripLeadingGreeting(source);
  if (!withoutGreeting) return '问候';

  const cleaned = cleanTitlePhrase(withoutGreeting);
  const summarized = summarizeKnownTitleIntent(cleaned);
  return clampConversationTitle(summarized || cleaned || source);
}

function normalizeTitleSource(message: string): string {
  return message
    .replace(/```[\s\S]*?```/g, '代码片段')
    .replace(/(?:^|\s)(?:附带文件|附件|上传文件|已附加文件)[：:].*$/s, '')
    .replace(/\s+/g, ' ')
    .replace(/[“”"']/g, '')
    .trim();
}

function stripLeadingGreeting(message: string): string {
  let next = message.trim();
  while (true) {
    const stripped = next
      .replace(/^(?:你好|您好|嗨|哈喽|hello|hi|hey)(?:呀|啊|哈)?(?:[，,。.!！?？:：\s]+|$)/i, '')
      .trim();
    if (stripped === next) return next;
    next = stripped;
    if (!next) return '';
  }
}

function cleanTitlePhrase(message: string): string {
  let next = message.trim();
  const leadingFillers = [
    /^(?:请你?|麻烦你?|劳烦你?|拜托你?|可以的话|如果可以的话)[，,：:\s]*/,
    /^(?:能不能|能否|可以|可不可以)?(?:帮我|帮忙|替我|给我)[，,：:\s]*/,
    /^(?:我希望|我想要?|我需要|想让你|希望你)[，,：:\s]*/,
  ];

  while (true) {
    const before = next;
    for (const pattern of leadingFillers) {
      next = next.replace(pattern, '').trim();
    }
    if (next === before) break;
  }

  return next
    .replace(/[，,]\s*(?:请你?|麻烦你?|帮我|帮忙|替我|给我)[，,\s]*/g, '，')
    .replace(/(分析|检查|查看|审查|修改|改|写|生成|总结|解释|翻译|整理|搜索|查询|创建|实现|修复)一下/g, '$1')
    .replace(/(?:这个|这份|该)(文件|附件|文档|图片|截图|代码|项目)/g, '$1')
    .replace(/(?:怎么样|如何|可以吗|好吗|吗|呢)[？?]?$/i, '')
    .replace(/[。！？!?]+$/g, '')
    .trim();
}

function summarizeKnownTitleIntent(message: string): string | null {
  const imageQuestion = message.match(/^(?:这个|这张|这幅)?(?:图|图片|照片|截图)(?:是|是什么|里有什么|内容是什么|有什么)/);
  if (imageQuestion) return '识别图片内容';

  const fileQuestion = message.match(/^(分析|检查|查看|解读|总结|审查)(?:文件|附件|文档|图片|截图|代码|项目)/);
  if (fileQuestion) {
    const target = message.slice(fileQuestion[1].length).match(/^(文件|附件|文档|图片|截图|代码|项目)/)?.[1] ?? '内容';
    return `${fileQuestion[1]}${target}`;
  }

  const weather = message.match(/^(.{1,14}?)(?:未来|最近|本周|这周|下周|一周|周末).{0,12}?天气/);
  if (weather) return `${weather[1].replace(/[的在]$/, '')}天气查询`;

  const writing = message.match(/^(?:写|生成|起草)(?:一篇|一份)?(?:([0-9０-９]+字)的?)?(?:关于)?(.{2,18}?)(?:的)?(文章|作文|报告|文案|邮件|说明)/);
  if (writing) {
    const size = writing[1] ?? '';
    return `写${size}${writing[2]}${writing[3]}`;
  }

  return null;
}

function clampConversationTitle(title: string): string {
  const compact = title.replace(/\s+/g, ' ').trim();
  return compact.length > CONVERSATION_TITLE_MAX_LENGTH
    ? `${compact.slice(0, CONVERSATION_TITLE_MAX_LENGTH)}...`
    : compact || '新对话';
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error || 'Unknown error');
}

function codexModelRequest(profile: ModelProfile, reasoningEffort: ReasoningEffort) {
  return {
    model: profile.model,
    providerId: profile.providerId,
    providerBaseUrl: profile.baseUrl,
    providerApiKey: profile.apiKey,
    providerWireApi: profile.wireApi,
    providerThinkingEnabled: profile.wireApi === 'chat' ? profile.supportsReasoningEffort : undefined,
    reasoningEffort: profile.supportsReasoningEffort ? reasoningEffort : undefined,
  };
}

// Folds attached file references into the prompt so the assistant can locate
// them in the brand directory (the visible transcript renders the chips separately).
function promptWithAttachments(text: string, attachments?: MessageAttachment[]): string {
  if (!attachments || attachments.length === 0) return text;
  const lines = attachments.map((item) => `- ${item.path || item.name}${item.kind === 'image' ? '（图片）' : ''}`);
  const section = ['附带文件：', ...lines].join('\n');
  return text ? `${text}\n\n${section}` : section;
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

  push({ type: 'reasoning_delta', runId, conversationId, text: '先做一次只读体检：查看品牌目录结构、关键素材和说明文件，再决定下一步。' });
  delay += 260;

  const commands = [
    { id: 'ls', cmd: 'find . -maxdepth 2 -type f', out: './brand-guidelines.md\n./assets/logo-primary.png\n./assets/palette.json\n./content/about.md\n' },
    { id: 'brief', cmd: 'sed -n 1,80p brand-guidelines.md', out: '# Brand Guidelines\n\n定位：面向年轻家庭的健康生活方式品牌。\n语气：温暖、可信、清晰。\n' },
    { id: 'assets', cmd: 'ls assets', out: 'logo-primary.png\nlogo-mono.png\npalette.json\n' },
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
    '预览模式已按品牌工作台风格渲染事件流：',
    '\n\n1. 品牌目录中的资料、素材和内容会被整理成可追溯上下文。',
    '\n2. 推理与文本会分段流式追加，任务进行时底部显示「正在思考」。',
    '\n3. 桌面模式会把这些预览事件替换为真实本地执行结果。',
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

function simulateBrowserReview(
  conversationId: string,
  request: ReviewRequest,
  dispatch: (event: CodexChatEvent) => void,
): void {
  const runId = createId('preview');
  dispatch({ type: 'started', runId, conversationId });
  dispatch({ type: 'thread_started', runId, conversationId, threadId: 'browser-preview' });

  const events: Array<{ delay: number; event: CodexChatEvent }> = [];
  let delay = 160;
  const push = (event: CodexChatEvent) => events.push({ delay, event });

  push({ type: 'reasoning_delta', runId, conversationId, text: '先获取需要审查的改动，再逐文件评估风险。' });
  delay += 260;

  const diffCmd =
    request.kind === 'base'
      ? `git diff ${request.target}...HEAD`
      : request.kind === 'commit'
        ? `git show ${request.target}`
        : 'git diff';
  push({ type: 'tool_started', runId, conversationId, itemId: `${runId}-diff`, title: 'command_execution', text: diffCmd });
  delay += 240;
  push({ type: 'tool_delta', runId, conversationId, itemId: `${runId}-diff`, title: 'command_execution', text: ' src/store.ts | 18 ++++++++--\n 1 file changed\n' });
  delay += 220;
  push({ type: 'tool_completed', runId, conversationId, itemId: `${runId}-diff`, title: 'command_execution' });
  delay += 200;

  const report = {
    verdict: 'incorrect',
    summary: '改动整体方向正确，但有 1 个需要修复的问题与 1 个建议。',
    findings: [
      {
        priority: 'P1',
        title: '未处理空数组导致的潜在崩溃',
        body: '当 `changes` 为空时直接访问 `changes[0]` 会得到 undefined，后续解构会抛错。建议先判空。',
        file: 'src/store.ts',
        lineStart: 42,
        lineEnd: 48,
        confidence: 0.78,
        suggestion: 'const first = changes[0];\nif (!first) return;',
      },
      {
        priority: 'P3',
        title: '抽取重复的分支查找逻辑',
        body: '相同的查找在两处出现，可抽成一个小函数以便维护。',
        file: 'src/store.ts',
        lineStart: 120,
        lineEnd: 134,
        confidence: 0.5,
      },
    ],
  };

  const prose = '这是浏览器预览模式下的模拟审查结果。桌面应用会调用真实的 Codex 审查器来分析改动。\n\n';
  for (const chunk of [prose, '```json\n', `${JSON.stringify(report, null, 2)}\n`, '```']) {
    push({ type: 'text_delta', runId, conversationId, text: chunk });
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
	  const modelProfiles = normalizeModelProfiles(source.modelProfiles, source.model);
	  const selectedModelProfileId = resolveSelectedModelProfileId(
	    source.selectedModelProfileId,
	    modelProfiles,
	    source.model,
	  );

	  return {
	    conversations,
	    projects,
	    currentConversationId,
	    selectedModelProfileId,
	    modelProfiles,
	    reasoningEffort: isReasoningEffort(source.reasoningEffort) ? source.reasoningEffort : DEFAULT_EFFORT,
    speed: source.speed === 'fast' || source.speed === 'standard' ? source.speed : DEFAULT_SPEED,
    workModeId: isWorkModeId(source.workModeId) ? source.workModeId : DEFAULT_WORK_MODE_ID,
    approvalMode: isApprovalMode(source.approvalMode)
      ? source.approvalMode
      : sandboxToApproval(source.sandboxMode),
    planMode: source.planMode === true,
    pursueGoal: source.pursueGoal === true,
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

// Subscribe to Codex streaming events exactly once per page load. We do this at
// module scope rather than inside a React effect so it is immune to React
// StrictMode's mount→cleanup→mount cycle and to Vite HMR remounts — both of
// which previously leaked a second listener and replayed every streamed token
// twice (the "duplicated characters" bug). The window flag survives HMR, so only
// a full page reload ever re-subscribes.
const CODEX_SUBSCRIPTION_FLAG = '__alphaStudioCodexSubscribed__';
if (isTauriRuntime()) {
  const globalScope = window as unknown as Record<string, boolean>;
  if (!globalScope[CODEX_SUBSCRIPTION_FLAG]) {
    globalScope[CODEX_SUBSCRIPTION_FLAG] = true;
    void subscribeCodexEvents((event) => {
      useChatStore.getState().handleCodexEvent(event);
    });
  }
}
