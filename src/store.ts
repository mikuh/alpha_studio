import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { addScheduledAutomationTask, automationCreatedReply, detectAutomationIntent } from './automation';
import {
  addBackgroundContextToPrompt,
  messagesForActiveBackground,
  prepareConversationForOutgoingTurn,
} from './contextWindow';
import {
  applyCodexEventToConversation,
  CONTEXT_COMPACTION_TOOL_TITLE,
} from './codexEvents';
import { buildCodingInstructions, buildReviewPrompt } from './prompt';
import { checkCodex, isTauriRuntime, listCodexModels, localTextFileRead, loadModelConfig as loadModelConfigFile, saveModelConfig as saveModelConfigFile, startCodexChat, stopCodexChat, subscribeCodexEvents } from './codexBridge';
import { DEFAULT_WORK_MODE_ID, activeDomain, isWorkModeId, type WorkModeId } from './domain';
import { loadLocalStoreSnapshot, scheduleLocalStoreCommit } from './localStore';
import { addThemeAbilityContext, inferThemeAbilitySkill } from './themeAbilities';
import {
  ALPHA_STUDIO_DAILY_THEME_SKILL_ID,
  PREMARKET_THEME_IMPORT_EVENT,
  automaticPremarketThemeImportError,
  loadPremarketThemeRuns,
  parsePremarketThemeResult,
  savePremarketThemeRun,
} from './themeResearch';
import {
  THEME_MONITOR_EVENT_SCHEMA,
  THEME_REVIEW_SCHEMA,
  ingestThemeMonitorResult,
  ingestThemeReviewResult,
} from './themeValidation';
import {
  ALPHA_GATEWAY_PROVIDER_ID,
  createGatewayRun,
  loadClientLicenseSession,
  modelProfilesFromClientLicense,
  type ClientLicenseSession,
} from './license';
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
  modelProfilesFromCodexCatalog,
  reconcileModelSelection,
  resolveReasoningEffortForProfile,
  isReasoningEffort,
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
  CodexModelCatalogItem,
  Conversation,
  CoworkerSelection,
  MessageAttachment,
  MessageBlock,
  Project,
  ProjectSort,
  QueuedChatMessage,
  ReviewRequest,
  SandboxMode,
  SkillSelection,
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
  clientLicenseSession: ClientLicenseSession | null;
  codexStatus: CodexStatus | null;
  codexModelCatalog: CodexModelCatalogItem[] | null;
  codexModelCatalogError: string | null;
  isRefreshingCodexModels: boolean;
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
  setModelSelection: (id: string, requestedEffort?: ReasoningEffort) => void;
  addModelProfile: (profile: ModelProfileDraft) => string | null;
  updateModelProfile: (id: string, patch: Partial<ModelProfileDraft>) => void;
  deleteModelProfile: (id: string) => void;
  toggleModelProfile: (id: string, enabled: boolean) => void;
  loadModelConfig: () => Promise<void>;
  setReasoningEffort: (effort: ReasoningEffort) => void;
  setSpeed: (speed: Speed) => void;
  setWorkModeId: (modeId: WorkModeId) => void;
  setClientLicenseSession: (session: ClientLicenseSession | null) => void;
  setApprovalMode: (mode: ApprovalMode) => void;
  setPlanMode: (planMode: boolean) => void;
  setPursueGoal: (pursueGoal: boolean) => void;
  resolveAuthorization: (id: string, decision: ApprovalDecision) => void;
  refreshCodexStatus: (options?: { forceModelRefetch?: boolean }) => Promise<void>;
  refreshCodexModels: (forceRefetch: boolean) => Promise<void>;
  sendMessage: (message: string, attachments?: MessageAttachment[], selectedSkill?: SkillSelection | null, coworkers?: CoworkerSelection[] | null) => Promise<void>;
  sendMessageToConversation: (conversationId: string, message: string, attachments?: MessageAttachment[], selectedSkill?: SkillSelection | null, coworkers?: CoworkerSelection[] | null, automationRun?: boolean) => Promise<void>;
  removeQueuedMessage: (conversationId: string, queuedMessageId: string) => void;
  updateQueuedMessage: (conversationId: string, queuedMessageId: string, patch: Pick<QueuedChatMessage, 'text'>) => void;
  reorderQueuedMessage: (conversationId: string, queuedMessageId: string, beforeQueuedMessageId: string | null) => void;
  sendQueuedMessageNow: (conversationId: string, queuedMessageId: string) => Promise<void>;
  startReview: (request: ReviewRequest) => Promise<void>;
  editUserMessageAndResend: (conversationId: string, messageId: string, message: string, attachments?: MessageAttachment[]) => Promise<void>;
  stopCurrentConversation: () => Promise<void>;
  handleCodexEvent: (event: CodexChatEvent) => void;
}

export interface PersistedChatState {
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

const tauriNoopStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

function persistedChatState(state: ChatState): PersistedChatState {
  return {
    conversations: state.conversations,
    projects: state.projects,
    currentConversationId: state.currentConversationId,
    selectedModelProfileId: state.selectedModelProfileId,
    modelProfiles: stripModelProfileSecrets(state.modelProfiles.filter((profile) => !profile.builtIn)),
    reasoningEffort: state.reasoningEffort,
    speed: state.speed,
    workModeId: state.workModeId,
    approvalMode: state.approvalMode,
    planMode: state.planMode,
    pursueGoal: state.pursueGoal,
    projectSort: state.projectSort,
    conversationSort: state.conversationSort,
  };
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
          title: 'Alpha Studio 请求操作权限',
          description: latest?.cwd
            ? '允许 Alpha Studio 读取和整理当前资料目录，并在需要时访问联网资源吗？'
            : '允许 Alpha Studio 读取资料、整理内容并在需要时访问联网资源吗？',
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
          modelProfiles: state.modelProfiles.filter(isLocalModelProfile),
        })
          .then((path) => {
            if (path) set({ modelConfigPath: path });
          })
          .catch((error) => set({ error: stringifyError(error) }));
      };

      const enqueueMessage = (conversationId: string, queuedMessage: QueuedChatMessage) => {
        set((state) => ({
          conversations: state.conversations.map((conversation) =>
            conversation.id === conversationId
              ? {
                  ...conversation,
                  queuedMessages: [...(conversation.queuedMessages ?? []), queuedMessage],
                  updatedAt: Date.now(),
                }
              : conversation
          ),
          error: null,
        }));
      };

      const removeQueuedMessageFromConversation = (conversation: Conversation, queuedMessageId?: string): Conversation => {
        if (!queuedMessageId) return conversation;
        return {
          ...conversation,
          queuedMessages: (conversation.queuedMessages ?? []).filter((item) => item.id !== queuedMessageId),
          guidedQueuedMessages: (conversation.guidedQueuedMessages ?? []).filter((item) => item.id !== queuedMessageId),
        };
      };

      const reorderQueuedMessageInConversation = (
        conversation: Conversation,
        queuedMessageId: string,
        beforeQueuedMessageId: string | null,
      ): Conversation => {
        const queuedMessages = conversation.queuedMessages ?? [];
        const moving = queuedMessages.find((item) => item.id === queuedMessageId);
        if (!moving) return conversation;
        const rest = queuedMessages.filter((item) => item.id !== queuedMessageId);
        const beforeIndex = beforeQueuedMessageId ? rest.findIndex((item) => item.id === beforeQueuedMessageId) : -1;
        const insertIndex = beforeIndex >= 0 ? beforeIndex : rest.length;
        return {
          ...conversation,
          queuedMessages: [
            ...rest.slice(0, insertIndex),
            moving,
            ...rest.slice(insertIndex),
          ],
          updatedAt: Date.now(),
        };
      };

      const startNextQueuedMessage = (conversationId: string) => {
        const conversation = get().conversations.find((item) => item.id === conversationId);
        if (!conversation || conversation.archivedAt || conversation.status === 'streaming') return;
        const next = conversation.guidedQueuedMessages?.[0] ?? conversation.queuedMessages?.[0];
        if (!next) return;
        void startPreparedMessage(conversationId, next, next.id);
      };

      const startPreparedMessage = async (
        conversationId: string,
        queuedMessage: QueuedChatMessage,
        queuedMessageId?: string,
      ) => {
        const conversation = get().conversations.find((item) => item.id === conversationId);
        if (!conversation || conversation.status === 'streaming' || conversation.archivedAt) return;

        const trimmed = queuedMessage.text.trim();
        const attachmentList = queuedMessage.attachments && queuedMessage.attachments.length
          ? queuedMessage.attachments
          : undefined;
        const explicitSelectedSkill = queuedMessage.selectedSkill;
        const selectedSkill = explicitSelectedSkill ?? inferThemeAbilitySkill(trimmed) ?? undefined;
        const coworkerList = queuedMessage.coworkers && queuedMessage.coworkers.length
          ? queuedMessage.coworkers
          : undefined;
        if (!trimmed && !attachmentList) {
          if (queuedMessageId) {
            set((state) => ({
              conversations: state.conversations.map((item) =>
                item.id === conversationId ? removeQueuedMessageFromConversation(item, queuedMessageId) : item
              ),
            }));
            startNextQueuedMessage(conversationId);
          }
          return;
        }

        const userMessage: ChatMessage = {
          id: createId('user'),
          role: 'user',
          timestamp: Date.now(),
          blocks: trimmed ? [{ type: 'text', content: trimmed }] : [],
          attachments: attachmentList,
          selectedSkill,
          coworkers: coworkerList,
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
        const automationIntent = !attachmentList && !explicitSelectedSkill && !coworkerList ? detectAutomationIntent(trimmed) : null;

        if (automationIntent) {
          const profile = resolveModelProfile(get().modelProfiles, get().selectedModelProfileId);
          const task = addScheduledAutomationTask({
            ...automationIntent,
            model: profile.label,
            modelProfileId: profile.id,
            reasoningEffort: resolveReasoningEffortForProfile(profile, get().reasoningEffort),
            conversationId,
          });
          set((state) => ({
            conversations: state.conversations.map((item) =>
              item.id === conversationId
                ? {
                    ...removeQueuedMessageFromConversation(item, queuedMessageId),
                    title: nextTitle,
                    messages: [
                      ...item.messages,
                      userMessage,
                      {
                        ...assistantMessage,
                        isStreaming: false,
                        blocks: [{ type: 'text', content: automationCreatedReply(task) }],
                      },
                    ],
                    status: 'idle',
                    updatedAt: Date.now(),
                    runId: undefined,
                  }
                : item
            ),
            error: null,
          }));
          if (queuedMessageId) startNextQueuedMessage(conversationId);
          return;
        }

        const preparedContext = prepareConversationForOutgoingTurn(conversation);
        const baseConversation = removeQueuedMessageFromConversation(preparedContext.conversation, queuedMessageId);

        set((state) => ({
          conversations: state.conversations.map((item) =>
            item.id === conversationId
              ? {
                  ...baseConversation,
                  title: nextTitle,
                  messages: [
                    ...baseConversation.messages,
                    userMessage,
                    withLocalContextCompactionBlock(assistantMessage, preparedContext.conversation),
                  ],
                  status: 'streaming',
                  updatedAt: Date.now(),
                  runId: undefined,
                }
              : item
          ),
          error: null,
        }));

        const sandboxMode = queuedMessage.automationRun ? 'read-only' : await runApprovalGate(conversationId);
        if (sandboxMode === null) return;

        if (!isTauriRuntime()) {
          simulateBrowserReply(conversationId, get().handleCodexEvent);
          return;
        }

        try {
          const latest = get().conversations.find((item) => item.id === conversationId);
          const modelProfile = resolveModelProfile(get().modelProfiles, get().selectedModelProfileId);
          const domain = activeDomain(get().workModeId);
          const promptOptions = {
            planMode: get().planMode,
            pursueGoal: get().pursueGoal,
            selectedSkill: userMessage.selectedSkill,
            coworkers: userMessage.coworkers,
          };
          const result = await startCodexChat({
            conversationId,
            prompt: addBackgroundContextToPrompt(
              addThemeAbilityContext(trimmed, userMessage.selectedSkill?.id, get().conversations),
              preparedContext.promptContext,
            ),
            developerInstructions: buildCodingInstructions(
              { ...promptOptions, nativeSkillInput: Boolean(userMessage.selectedSkill) },
              domain,
            ),
            selectedSkill: userMessage.selectedSkill,
            attachments: attachmentList,
            codexThreadId: latest?.codexThreadId,
            cwd: latest?.cwd || undefined,
            ...(await codexModelRequest(modelProfile, get().reasoningEffort)),
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
      clientLicenseSession: loadClientLicenseSession(),
      codexStatus: null,
      codexModelCatalog: null,
      codexModelCatalogError: null,
      isRefreshingCodexModels: false,
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
        set((state) => ({
          currentConversationId: id,
          error: null,
          conversations: state.conversations.map((conversation) =>
            conversation.id === id && conversation.unread
              ? { ...conversation, unread: false }
              : conversation,
          ),
        }));
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
                  unread: false,
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
          codexTokenUsage: undefined,
          codexCompactedAt: undefined,
          queuedMessages: undefined,
          guidedQueuedMessages: undefined,
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

      // Point a single conversation at a working directory. Picking an existing
      // project carries its id so the conversation stays grouped; choosing a raw
      // folder passes projectId=null to detach it into a standalone chat. Passing
      // undefined leaves the current project association untouched.
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
        const fallbackName = `新研究主题 ${activeProjects(get().projects).length + 1}`;
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
        get().setModelSelection(id, get().reasoningEffort);
      },
      setModelSelection: (id, requestedEffort) => {
        set((state) => {
          const profile = state.modelProfiles.find((item) => item.id === id && item.enabled);
          if (!profile) return {};
          return { selectedModelProfileId: profile.id, reasoningEffort: resolveReasoningEffortForProfile(profile, requestedEffort ?? state.reasoningEffort) };
        });
        persistModelConfig();
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
          const modelProfiles = modelProfilesForCurrentLicense(
            get().clientLicenseSession,
            normalizeModelProfiles(config.modelProfiles),
            get().codexModelCatalog,
          );
          const selectedModelProfileId = config.selectedModelProfileId?.trim() || get().selectedModelProfileId;
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

      setReasoningEffort: (effort: ReasoningEffort) => set((state) => ({ reasoningEffort: resolveReasoningEffortForProfile(resolveModelProfile(state.modelProfiles, state.selectedModelProfileId), effort) })),

      setSpeed: (speed: Speed) => set({ speed }),

      setWorkModeId: (workModeId: WorkModeId) => set({ workModeId }),

      setClientLicenseSession: (session) => {
        const state = get();
        const modelProfiles = modelProfilesForCurrentLicense(session, state.modelProfiles, state.codexModelCatalog);
        const preserve = state.codexModelCatalog === null && session?.tenant.codexSubscriptionEnabled !== false && state.selectedModelProfileId.trim().length > 0 && !modelProfiles.some((p) => p.id === state.selectedModelProfileId);
        const selection = preserve ? { selectedModelProfileId: state.selectedModelProfileId, reasoningEffort: state.reasoningEffort } : reconcileModelSelection({ profiles: modelProfiles, selectedModelProfileId: state.selectedModelProfileId, reasoningEffort: state.reasoningEffort, previousSelectedProfile: state.modelProfiles.find((p) => p.id === state.selectedModelProfileId) });
        set({
          clientLicenseSession: session,
          modelProfiles,
          ...selection,
        });
      },

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

      refreshCodexModels: async (forceRefetch) => {
        if (get().isRefreshingCodexModels) return;
        set({ isRefreshingCodexModels: true, codexModelCatalogError: null });
        try {
          const catalog = await listCodexModels(forceRefetch);
          if (!catalog.length) throw new Error('Codex app-server returned no visible valid models.');
          set((state) => {
            const previous = state.modelProfiles.find((p) => p.id === state.selectedModelProfileId);
            const modelProfiles = modelProfilesForCurrentLicense(state.clientLicenseSession, state.modelProfiles, catalog);
            return { codexModelCatalog: catalog, codexModelCatalogError: null, isRefreshingCodexModels: false, modelProfiles, ...reconcileModelSelection({ profiles: modelProfiles, selectedModelProfileId: state.selectedModelProfileId, reasoningEffort: state.reasoningEffort, previousSelectedProfile: previous }) };
          });
        } catch (error) {
          set((state) => {
            if (state.codexModelCatalog) return { codexModelCatalogError: stringifyError(error), isRefreshingCodexModels: false };
            const profiles = modelProfilesForCurrentLicense(state.clientLicenseSession, state.modelProfiles, null);
            const selectable = profiles.some((p) => !p.builtIn) ? profiles.filter((p) => !p.builtIn) : profiles;
            return { codexModelCatalogError: stringifyError(error), isRefreshingCodexModels: false, modelProfiles: profiles, ...reconcileModelSelection({ profiles: selectable, selectedModelProfileId: state.selectedModelProfileId, reasoningEffort: state.reasoningEffort }) };
          });
        }
      },

      refreshCodexStatus: async (options = {}) => {
        const previous = get().codexStatus;
        set({ isCheckingCodex: true, error: null });
        try {
          const status = await checkCodex();
          if (!status.loggedIn) {
            set((state) => { const profiles = modelProfilesForCurrentLicense(state.clientLicenseSession, state.modelProfiles, null); const selectable = profiles.some(p => !p.builtIn) ? profiles.filter(p => !p.builtIn) : profiles; return { codexStatus: status, isCheckingCodex: false, codexModelCatalog: null, modelProfiles: profiles, ...reconcileModelSelection({ profiles: selectable, selectedModelProfileId: state.selectedModelProfileId, reasoningEffort: state.reasoningEffort }) }; });
            return;
          }
          set({ codexStatus: status, isCheckingCodex: false });
          if (previous === null || previous?.loggedIn === false || options.forceModelRefetch === true) await get().refreshCodexModels(previous?.loggedIn === false || options.forceModelRefetch === true);
        } catch (error) {
          set((state) => {
            const profiles = modelProfilesForCurrentLicense(state.clientLicenseSession, state.modelProfiles, null);
            const selectable = profiles.some((p) => !p.builtIn) ? profiles.filter((p) => !p.builtIn) : profiles;
            return {
            codexStatus: {
              installed: false,
              version: '',
              path: '',
              loggedIn: false,
              error: stringifyError(error),
            },
            isCheckingCodex: false,
            codexModelCatalog: null,
            codexModelCatalogError: null,
            modelProfiles: profiles,
            ...reconcileModelSelection({ profiles: selectable, selectedModelProfileId: state.selectedModelProfileId, reasoningEffort: state.reasoningEffort }),
          }; });
        }
      },

      sendMessage: async (message: string, attachments?: MessageAttachment[], selectedSkill?: SkillSelection | null, coworkers?: CoworkerSelection[] | null) => {
        const text = message.trim();
        const attachmentList = attachments && attachments.length ? attachments : undefined;
        if (!text && !attachmentList) return;

        let conversationId = get().currentConversationId;
        const activeIds = new Set(activeConversations(get().conversations).map((item) => item.id));
        if (!conversationId || !activeIds.has(conversationId)) {
          conversationId = get().createConversation();
        }
        await get().sendMessageToConversation(conversationId, text, attachmentList, selectedSkill, coworkers);
      },

      sendMessageToConversation: async (conversationId: string, message: string, attachments?: MessageAttachment[], selectedSkill?: SkillSelection | null, coworkers?: CoworkerSelection[] | null, automationRun = false) => {
        const text = message.trim();
        const attachmentList = attachments && attachments.length ? attachments : undefined;
        const coworkerList = coworkers && coworkers.length ? coworkers.map(normalizeCoworkerSelection) : undefined;
        if (!text && !attachmentList) return;
        const conversation = get().conversations.find((item) => item.id === conversationId);
        if (!conversation || conversation.archivedAt) return;

        const queuedMessage: QueuedChatMessage = {
          id: createId('queue'),
          text,
          createdAt: Date.now(),
          attachments: attachmentList,
          selectedSkill: selectedSkill ? normalizeSelectedSkill(selectedSkill) : undefined,
          coworkers: coworkerList,
          automationRun,
        };

        if (conversation.status === 'streaming') {
          enqueueMessage(conversationId, queuedMessage);
          return;
        }

        await startPreparedMessage(conversationId, queuedMessage);
      },

      removeQueuedMessage: (conversationId: string, queuedMessageId: string) => {
        set((state) => ({
          conversations: state.conversations.map((conversation) =>
            conversation.id === conversationId
              ? removeQueuedMessageFromConversation(conversation, queuedMessageId)
              : conversation
          ),
        }));
      },

      updateQueuedMessage: (conversationId: string, queuedMessageId: string, patch: Pick<QueuedChatMessage, 'text'>) => {
        const text = patch.text.trim();
        set((state) => ({
          conversations: state.conversations.map((conversation) => {
            if (conversation.id !== conversationId) return conversation;
            return {
              ...conversation,
              queuedMessages: (conversation.queuedMessages ?? []).map((item) => {
                if (item.id !== queuedMessageId) return item;
                const hasAttachments = Boolean(item.attachments?.length);
                return { ...item, text: text || hasAttachments ? text : item.text };
              }),
              updatedAt: Date.now(),
            };
          }),
        }));
      },

      reorderQueuedMessage: (conversationId: string, queuedMessageId: string, beforeQueuedMessageId: string | null) => {
        if (queuedMessageId === beforeQueuedMessageId) return;
        set((state) => ({
          conversations: state.conversations.map((conversation) =>
            conversation.id === conversationId
              ? reorderQueuedMessageInConversation(conversation, queuedMessageId, beforeQueuedMessageId)
              : conversation
          ),
        }));
      },

      sendQueuedMessageNow: async (conversationId: string, queuedMessageId: string) => {
        const conversation = get().conversations.find((item) => item.id === conversationId);
        if (!conversation || conversation.archivedAt) return;
        const queuedMessage = conversation.queuedMessages?.find((item) => item.id === queuedMessageId);
        if (!queuedMessage) return;
        if (conversation.status === 'streaming') {
          set((state) => ({
            conversations: state.conversations.map((item) => {
              if (item.id !== conversationId) return item;
              return {
                ...item,
                queuedMessages: (item.queuedMessages ?? []).filter((queued) => queued.id !== queuedMessageId),
                guidedQueuedMessages: [
                  ...(item.guidedQueuedMessages ?? []),
                  queuedMessage,
                ],
                updatedAt: Date.now(),
              };
            }),
          }));
          return;
        }
        await startPreparedMessage(conversationId, queuedMessage, queuedMessageId);
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

        const preparedContext = prepareConversationForOutgoingTurn(conversation);

        set((state) => ({
          conversations: state.conversations.map((item) =>
            item.id === conversationId
              ? {
                  ...preparedContext.conversation,
                  title: nextTitle,
                  messages: [...preparedContext.conversation.messages, userMessage, assistantMessage],
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
	            prompt: addBackgroundContextToPrompt(buildReviewPrompt(request), preparedContext.promptContext),
	            codexThreadId: latest?.codexThreadId,
	            cwd: latest?.cwd || undefined,
	            ...(await codexModelRequest(modelProfile, get().reasoningEffort)),
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
        const retainedBackgroundContext =
          conversation.backgroundContext && messageIndex >= conversation.backgroundContext.sourceMessageCount
            ? conversation.backgroundContext
            : undefined;
        const preparedContext = prepareConversationForOutgoingTurn({
          ...conversation,
          messages: previousMessages,
          status: 'idle',
          runId: undefined,
          codexThreadId: undefined,
          codexTokenUsage: undefined,
          codexCompactedAt: undefined,
          backgroundContext: retainedBackgroundContext,
        });
        const activePreviousMessages = messagesForActiveBackground(preparedContext.conversation);
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
                  ...preparedContext.conversation,
                  title: nextTitle,
                  messages: [
                    ...previousMessages,
                    editedUserMessage,
                    withLocalContextCompactionBlock(assistantMessage, preparedContext.conversation),
                  ],
                  status: 'streaming',
                  updatedAt: now,
                  runId: undefined,
                  codexThreadId: undefined,
                  codexTokenUsage: undefined,
                  codexCompactedAt: undefined,
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
          const domain = activeDomain(get().workModeId);
          const promptOptions = {
            planMode: get().planMode,
            pursueGoal: get().pursueGoal,
            selectedSkill: original.selectedSkill,
            coworkers: original.coworkers,
          };
          const result = await startCodexChat({
            conversationId,
            prompt: addBackgroundContextToPrompt(
              buildEditedPrompt(trimmed, activePreviousMessages),
              preparedContext.promptContext,
            ),
            developerInstructions: buildCodingInstructions(
              { ...promptOptions, nativeSkillInput: Boolean(original.selectedSkill) },
              domain,
            ),
            selectedSkill: original.selectedSkill,
            attachments: nextAttachments,
            cwd: latest?.cwd || undefined,
            ...(await codexModelRequest(modelProfile, get().reasoningEffort)),
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
        const shouldStartQueuedMessage = event.type === 'completed' || event.type === 'stopped';
        const readyConversationIds: string[] = [];
        set((state) => ({
          conversations: state.conversations.map((conversation) => {
            const wasStreaming = conversation.status === 'streaming';
            let next = applyCodexEventToConversation(conversation, event);
            if (
              shouldStartQueuedMessage &&
              wasStreaming &&
              next.status !== 'streaming' &&
              !next.archivedAt &&
              ((next.guidedQueuedMessages?.length ?? 0) > 0 || (next.queuedMessages?.length ?? 0) > 0)
            ) {
              readyConversationIds.push(next.id);
            }
            // A turn that finishes while the user is looking at another
            // conversation gets an unread dot until it is opened again.
            if (
              wasStreaming &&
              next.status !== 'streaming' &&
              next.id !== state.currentConversationId
            ) {
              next = { ...next, unread: true };
            }
            return next;
          }),
        }));
        const completedConversation = event.type === 'completed' && event.conversationId
          ? get().conversations.find((item) => item.id === event.conversationId)
          : undefined;
        for (const conversationId of Array.from(new Set(readyConversationIds))) {
          startNextQueuedMessage(conversationId);
        }
        if (completedConversation) {
          const conversation = completedConversation;
          const assistant = [...(conversation?.messages ?? [])].reverse().find((message) => message.role === 'assistant');
          const text = assistant ? messageBlocksToText(assistant.blocks) : '';
          const latestUser = [...conversation.messages].reverse().find((message) => message.role === 'user');
          const dailyThemeTurn = latestUser?.selectedSkill?.id === ALPHA_STUDIO_DAILY_THEME_SKILL_ID
            || Boolean(latestUser?.blocks.some((block) => block.type === 'text' && block.content.includes(ALPHA_STUDIO_DAILY_THEME_SKILL_ID)));
          if (dailyThemeTurn && assistant) {
            void parseDailyThemeReportCompletion(assistant.blocks).then((parsed) => {
              if (parsed.ok && parsed.run) savePremarketThemeRun(parsed.run);
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent(PREMARKET_THEME_IMPORT_EVENT, {
                  detail: parsed.ok
                    ? { ok: true, reportId: parsed.run?.id }
                    : { ok: false, error: parsed.error || '报告已生成，但结构化跟踪数据未进入工作台。' },
                }));
              }
            });
          } else if (text.includes('alpha.premarket_theme.v1') || text.includes('alpha.premarket_theme.v2')) {
            const parsed = parsePremarketThemeResult(text);
            if (parsed.ok && parsed.run) savePremarketThemeRun(parsed.run);
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent(PREMARKET_THEME_IMPORT_EVENT, {
                detail: parsed.ok
                  ? { ok: true, reportId: parsed.run?.id }
                  : { ok: false, error: parsed.error || '报告未进入跟踪库。' },
              }));
            }
          }
          if (text.includes(THEME_MONITOR_EVENT_SCHEMA)) {
            ingestThemeMonitorResult(text, loadPremarketThemeRuns());
          }
          if (text.includes(THEME_REVIEW_SCHEMA)) {
            ingestThemeReviewResult(text, loadPremarketThemeRuns());
          }
        }
      },
      };
    },
    {
      name: 'alpha-studio.chat.v2',
      version: 6,
      partialize: persistedChatState,
      storage: isTauriRuntime() ? createJSONStorage(() => tauriNoopStorage) : undefined,
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

let localStoreChatHydrated = !isTauriRuntime();

if (isTauriRuntime()) {
  void hydrateChatFromLocalStore();
  useChatStore.subscribe((state) => {
    if (!localStoreChatHydrated) return;
    scheduleLocalStoreCommit('chat', {
      chat: persistedChatState(state),
      audit: {
        domain: 'chat',
        action: 'state.persist',
        entityId: state.currentConversationId ?? undefined,
        payload: { conversationCount: state.conversations.length, projectCount: state.projects.length },
      },
    });
  });
}

async function hydrateChatFromLocalStore(): Promise<void> {
  try {
    const snapshot = await loadLocalStoreSnapshot();
    if (snapshot?.chat) {
      const migrated = migratePersistedState(snapshot.chat);
      const conversations = migrated.conversations.map(recoverInterruptedConversation);
      const active = activeConversations(conversations);
      useChatStore.setState({
        ...migrated,
        conversations,
        currentConversationId:
          migrated.currentConversationId && active.some((item) => item.id === migrated.currentConversationId)
            ? migrated.currentConversationId
            : active[0]?.id ?? null,
        error: null,
      });
      await reconcileDailyThemeTrackingFromConversations(conversations);
    }
  } catch (error) {
    useChatStore.setState({ error: stringifyError(error) });
  } finally {
    localStoreChatHydrated = true;
  }
}

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

  return {
    ...conversation,
    status: 'idle',
    runId: undefined,
    messages,
    queuedMessages: [
      ...(conversation.guidedQueuedMessages ?? []),
      ...(conversation.queuedMessages ?? []),
    ],
    guidedQueuedMessages: undefined,
  };
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeSelectedSkill(skill: SkillSelection): SkillSelection {
  return {
    id: skill.id,
    title: skill.title,
    description: skill.description,
  };
}

function normalizeCoworkerSelection(coworker: CoworkerSelection): CoworkerSelection {
  return {
    id: coworker.id,
    no: coworker.no,
    name: coworker.name,
  };
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

function isLocalModelProfile(profile: ModelProfile): boolean {
  return !profile.builtIn && profile.providerId !== ALPHA_GATEWAY_PROVIDER_ID;
}

export function modelProfilesForCurrentLicense(
  session: ClientLicenseSession | null,
  configuredProfiles: readonly ModelProfile[],
  catalog: readonly CodexModelCatalogItem[] | null = null,
): ModelProfile[] {
  const subscriptionProfiles = modelProfilesFromCodexCatalog(catalog);
  if (!session) return mergeUniqueModelProfiles(subscriptionProfiles, configuredProfiles.filter((profile) => !profile.builtIn));
  return mergeUniqueModelProfiles(
    modelProfilesFromClientLicense(session, subscriptionProfiles),
    configuredProfiles.filter(isLocalModelProfile),
  );
}

function mergeUniqueModelProfiles(baseProfiles: ModelProfile[], extraProfiles: ModelProfile[]): ModelProfile[] {
  const seen = new Set(baseProfiles.map((profile) => profile.id));
  const merged = [...baseProfiles];
  for (const profile of extraProfiles) {
    if (seen.has(profile.id)) continue;
    seen.add(profile.id);
    merged.push(profile);
  }
  return merged;
}

async function codexModelRequest(profile: ModelProfile, reasoningEffort: ReasoningEffort) {
  const validatedEffort = resolveReasoningEffortForProfile(profile, reasoningEffort);
  if (profile.providerId === ALPHA_GATEWAY_PROVIDER_ID) {
    const gateway = await createGatewayRun(profile.model);
    return {
      model: profile.model,
      providerId: gateway.providerId,
      providerBaseUrl: gateway.providerBaseUrl,
      providerApiKey: gateway.providerApiKey,
      providerWireApi: gateway.providerWireApi,
      reasoningEffort: profile.supportsReasoningEffort ? validatedEffort : undefined,
    };
  }
  return {
    model: profile.model,
    providerId: profile.providerId,
    providerBaseUrl: profile.baseUrl,
    providerApiKey: profile.apiKey,
    providerWireApi: profile.wireApi,
    providerThinkingEnabled: profile.wireApi === 'chat' ? profile.supportsReasoningEffort : undefined,
    reasoningEffort: profile.supportsReasoningEffort ? validatedEffort : undefined,
  };
}

// Folds attached file references into the prompt so Codex can locate them in the
// working directory (the visible transcript renders the chips separately).
function promptWithAttachments(text: string, attachments?: MessageAttachment[]): string {
  if (!attachments || attachments.length === 0) return text;
  const lines = attachments.map((item) => `- ${item.path || item.name}${item.kind === 'image' ? '（图片）' : ''}`);
  const section = ['附带文件：', ...lines].join('\n');
  return text ? `${text}\n\n${section}` : section;
}

function withLocalContextCompactionBlock(message: ChatMessage, conversation: Conversation): ChatMessage {
  const block = localContextCompactionBlock(conversation);
  if (!block) return message;
  return {
    ...message,
    blocks: [block, ...message.blocks],
  };
}

function localContextCompactionBlock(conversation: Conversation): MessageBlock | null {
  const background = conversation.backgroundContext;
  if (!background) return null;
  return {
    type: 'tool',
    id: `local-context-compaction-${background.compactedAt}`,
    title: CONTEXT_COMPACTION_TOOL_TITLE,
    status: 'completed',
    target: `已压缩前 ${background.sourceMessageCount} 条历史上下文`,
    output: 'Alpha Studio 已将较早的可见对话整理为背景摘要，并随本轮消息交给 Codex 继续使用。',
  };
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
      if (block.type === 'image_result') {
        return [block.title, ...block.images.map((image) => image.src)].filter(Boolean).join('\n');
      }
      if (block.type === 'file_result') {
        return [block.title, ...block.files.map((file) => file.path)].filter(Boolean).join('\n');
      }
      return '';
    })
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

type DailyThemeTextReader = (path: string) => Promise<{ content: string }>;

export async function parseDailyThemeReportCompletion(
  blocks: ChatMessage['blocks'],
  readText: DailyThemeTextReader = localTextFileRead,
) {
  const visibleText = blocks
    .filter((block) => block.type === 'text')
    .map((block) => block.content)
    .join('\n\n');
  const inline = parsePremarketThemeResult(visibleText);
  if (inline.ok && inline.run) {
    const incomplete = automaticPremarketThemeImportError(inline.run);
    if (!incomplete) return inline;
  }

  let lastError = inline.error;
  for (const path of dailyThemeTrackingCandidatePaths(blocks)) {
    try {
      const file = await readText(path);
      const parsed = parsePremarketThemeResult(file.content, { requireCompleteReport: false });
      if (!parsed.ok || !parsed.run) {
        lastError = parsed.error || lastError;
        continue;
      }
      const incomplete = automaticPremarketThemeImportError(parsed.run);
      if (incomplete) {
        lastError = incomplete;
        continue;
      }
      return parsed;
    } catch {
      // Generated-file discovery is best effort; try the next candidate.
    }
  }

  return {
    ok: false,
    error: lastError || '报告已生成，但没有找到完整的后台跟踪 JSON。',
  };
}

export async function reconcileDailyThemeTrackingFromConversations(
  conversations: Conversation[],
  readText: DailyThemeTextReader = localTextFileRead,
): Promise<number> {
  const completions: Array<{ timestamp: number; blocks: ChatMessage['blocks'] }> = [];
  for (const conversation of conversations) {
    let dailyThemeTurn = false;
    for (const message of conversation.messages) {
      if (message.role === 'user') {
        dailyThemeTurn = message.selectedSkill?.id === ALPHA_STUDIO_DAILY_THEME_SKILL_ID
          || message.blocks.some((block) => block.type === 'text' && block.content.includes(ALPHA_STUDIO_DAILY_THEME_SKILL_ID));
      } else if (message.role === 'assistant' && dailyThemeTurn) {
        completions.push({ timestamp: message.timestamp, blocks: message.blocks });
        dailyThemeTurn = false;
      }
    }
  }

  let imported = 0;
  for (const completion of completions.sort((left, right) => right.timestamp - left.timestamp)) {
    const parsed = await parseDailyThemeReportCompletion(completion.blocks, readText);
    if (!parsed.ok || !parsed.run) continue;
    const exists = loadPremarketThemeRuns().some((item) => (
      item.id === parsed.run?.id || item.contentHash === parsed.run?.contentHash
    ));
    if (exists) continue;
    savePremarketThemeRun(parsed.run);
    imported += 1;
  }
  return imported;
}

export function dailyThemeTrackingCandidatePaths(blocks: ChatMessage['blocks']): string[] {
  const directPaths = blocks
    .filter((block) => block.type === 'file_result')
    .flatMap((block) => block.files.map((file) => file.path));
  const markdownPaths = Array.from(messageBlocksToText(blocks).matchAll(/\]\(<?(\/[^)\n>]+)>?\)/g))
    .map((match) => match[1]);
  const paths = Array.from(new Set([...directPaths, ...markdownPaths].map((path) => {
    try {
      return decodeURIComponent(path);
    } catch {
      return path;
    }
  })));
  const reportDirectories = paths
    .filter((path) => /\.html?$/i.test(path))
    .map((path) => path.slice(0, path.lastIndexOf('/') + 1));
  const companionPaths = reportDirectories.flatMap((directory) => [
    `${directory}.alpha-studio-tracking.json`,
    `${directory}alpha-studio-tracking.json`,
  ]);
  const candidates = Array.from(new Set([...paths, ...companionPaths]));
  const priority = (path: string) => {
    if (/(?:^|\/)\.alpha-studio-tracking\.json$/i.test(path)) return 0;
    if (/alpha-studio-tracking\.json$/i.test(path)) return 1;
    if (/\.json$/i.test(path)) return 2;
    if (/\.(?:md|markdown)$/i.test(path)) return 3;
    if (/\.html?$/i.test(path)) return 4;
    return 5;
  };
  return candidates
    .filter((path) => /\.(?:json|md|markdown|html|htm)$/i.test(path))
    .sort((left, right) => priority(left) - priority(right));
}

function simulateBrowserReply(conversationId: string, dispatch: (event: CodexChatEvent) => void): void {
  const runId = createId('preview');
  dispatch({ type: 'started', runId, conversationId });
  dispatch({ type: 'thread_started', runId, conversationId, threadId: 'browser-preview' });

  const events: Array<{ delay: number; event: CodexChatEvent }> = [];
  let delay = 160;
  const push = (event: CodexChatEvent) => events.push({ delay, event });

  push({ type: 'reasoning_delta', runId, conversationId, text: '先做一次只读投研梳理：确认问题范围、资料来源和需要重点验证的假设。' });
  delay += 260;

  const commands = [
    { id: 'scope', cmd: '识别投研问题', out: '市场异动、行业驱动、风险提示\n' },
    { id: 'sources', cmd: '整理资料来源', out: '公告、行情、研报摘录、用户上传材料\n' },
    { id: 'checks', cmd: '生成跟踪清单', out: '价格、成交额、政策催化、业绩预期\n' },
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
    '预览模式已按投研工作流渲染事件流：',
    '\n\n1. 连续的资料处理步骤会折叠成「已运行 N 条任务」，可展开查看每步结果。',
    '\n2. 推理与文本会分段流式追加，任务进行时底部显示「正在分析」。',
    '\n3. 桌面模式会把这些预览事件替换为真实本地 AI 运行结果。',
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
        codexThreadId: undefined,
        codexTokenUsage: undefined,
        codexCompactedAt: undefined,
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
