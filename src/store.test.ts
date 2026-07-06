import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTOMATION_TASKS_KEY } from './automation';
import { DEFAULT_MODEL_PROFILE_ID, defaultModelProfiles } from './models';
import {
  activeConversations,
  archivedConversations,
  buildConversationTitle,
  isDraftConversation,
  migratePersistedState,
  useChatStore,
  visibleConversations,
} from './store';
import type { ChatMessage, Conversation, CoworkerSelection, SkillSelection } from './types';

function textMessage(content = 'hi'): ChatMessage {
  return { id: `msg-${content}`, role: 'user', timestamp: 1, blocks: [{ type: 'text', content }] };
}

function conversation(id: string, patch: Partial<Conversation> = {}): Conversation {
  return {
    id,
    title: `Chat ${id}`,
    messages: [],
    cwd: '/repo',
    createdAt: 1,
    updatedAt: 1,
    status: 'idle',
    ...patch,
  };
}

describe('archive semantics', () => {
  beforeEach(() => {
    vi.useRealTimers();
    useChatStore.setState({
      conversations: [conversation('conv-1'), conversation('conv-2')],
      projects: [],
      currentConversationId: 'conv-1',
      selectedModelProfileId: DEFAULT_MODEL_PROFILE_ID,
      modelProfiles: defaultModelProfiles(),
      projectSort: 'updated',
      conversationSort: 'updated',
      error: null,
    });
  });

  it('archives a conversation instead of deleting it', () => {
    useChatStore.getState().archiveConversation('conv-1');

    const state = useChatStore.getState();
    expect(state.conversations).toHaveLength(2);
    expect(archivedConversations(state.conversations).map((item) => item.id)).toEqual(['conv-1']);
    expect(activeConversations(state.conversations).map((item) => item.id)).toEqual(['conv-2']);
    expect(state.currentConversationId).toBe('conv-2');
  });

  it('can restore and permanently remove archived conversations', () => {
    useChatStore.getState().archiveConversation('conv-1');
    useChatStore.getState().unarchiveConversation('conv-1');

    expect(activeConversations(useChatStore.getState().conversations).map((item) => item.id)).toEqual([
      'conv-1',
      'conv-2',
    ]);

    useChatStore.getState().archiveConversation('conv-1');
    useChatStore.getState().permanentlyDeleteConversation('conv-1');

    expect(useChatStore.getState().conversations.map((item) => item.id)).toEqual(['conv-2']);
  });

  it('keeps unsent drafts out of the sidebar but reuses them on createConversation', () => {
    useChatStore.setState({
      conversations: [conversation('conv-1', { messages: [textMessage()] })],
      projects: [],
      currentConversationId: 'conv-1',
      selectedModelProfileId: DEFAULT_MODEL_PROFILE_ID,
      modelProfiles: defaultModelProfiles(),
      projectSort: 'updated',
      conversationSort: 'updated',
      error: null,
    });

    const firstDraft = useChatStore.getState().createConversation();
    expect(useChatStore.getState().currentConversationId).toBe(firstDraft);
    // The draft exists and is active, but stays hidden from the sidebar list.
    expect(activeConversations(useChatStore.getState().conversations)).toHaveLength(2);
    expect(visibleConversations(useChatStore.getState().conversations).map((item) => item.id)).toEqual(['conv-1']);

    // Clicking "新对话" again reuses the existing draft instead of piling up empties.
    const secondDraft = useChatStore.getState().createConversation();
    expect(secondDraft).toBe(firstDraft);
    expect(useChatStore.getState().conversations.filter(isDraftConversation)).toHaveLength(1);
  });

  it('migrates old persisted legacy state into finance-era state', () => {
    const legacyTitle = ['\u65b0\u7684', '\u5bf9\u8bdd'].join('\u6295\u7814');
    const migrated = migratePersistedState({
      conversations: [conversation('old', { title: legacyTitle })],
      projects: [],
      activeCoworkerId: 'pm',
      holdings: [{ id: 'hold-1' }],
      watchlist: [{ id: 'watch-1' }],
    });

    expect(migrated.conversations[0].title).toBe('新对话');
    expect('holdings' in migrated).toBe(false);
    expect('watchlist' in migrated).toBe(false);
    expect(migrated.selectedModelProfileId).toBe(DEFAULT_MODEL_PROFILE_ID);
    expect(migrated.modelProfiles.some((profile) => profile.id === DEFAULT_MODEL_PROFILE_ID)).toBe(true);
    expect(migrated.workModeId).toBe('finance-research');
  });

  it('migrates an unknown legacy model into a custom OpenAI profile', () => {
    const migrated = migratePersistedState({
      conversations: [conversation('old')],
      model: 'custom-codex-model',
    });

    expect(migrated.selectedModelProfileId).toBe('legacy-custom-codex-model');
    expect(migrated.modelProfiles.find((profile) => profile.id === 'legacy-custom-codex-model')).toMatchObject({
      providerId: 'openai',
      model: 'custom-codex-model',
      enabled: true,
    });
  });

  it('adds, updates, disables, and deletes custom model profiles', () => {
    const id = useChatStore.getState().addModelProfile({
      label: 'DeepSeek V4',
      providerId: 'deepseek',
      model: 'deepseek-chat',
      wireApi: 'chat',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-test',
      enabled: true,
      supportsReasoningEffort: false,
    });

    expect(id).toBeTruthy();
    expect(useChatStore.getState().selectedModelProfileId).toBe(id);

    useChatStore.getState().updateModelProfile(id!, { label: 'DeepSeek Coding', model: 'deepseek-reasoner' });
    expect(useChatStore.getState().modelProfiles.find((profile) => profile.id === id)).toMatchObject({
      label: 'DeepSeek Coding',
      model: 'deepseek-reasoner',
    });

    useChatStore.getState().toggleModelProfile(id!, false);
    expect(useChatStore.getState().modelProfiles.find((profile) => profile.id === id)?.enabled).toBe(false);
    expect(useChatStore.getState().selectedModelProfileId).toBe(DEFAULT_MODEL_PROFILE_ID);

    useChatStore.getState().deleteModelProfile(id!);
    expect(useChatStore.getState().modelProfiles.some((profile) => profile.id === id)).toBe(false);
  });

  it('persists the active work mode in store state', () => {
    useChatStore.getState().setWorkModeId('finance-research');

    expect(useChatStore.getState().workModeId).toBe('finance-research');
  });
});

describe('conversation titles', () => {
  it('summarizes the first user message into a concise sidebar title', () => {
    expect(buildConversationTitle('你好，帮我分析一下这个文件 附带文件：report.pdf')).toBe('分析文件');
    expect(buildConversationTitle('给我写一篇5000字的关于西安旅游的文章，要求适合公众号')).toBe('写5000字西安旅游文章');
    expect(buildConversationTitle('杭州未来一周的天气怎么样')).toBe('杭州天气查询');
    expect(buildConversationTitle('这个图是什么')).toBe('识别图片内容');
  });

  it('uses a stable fallback for greeting-only messages', () => {
    expect(buildConversationTitle('你好')).toBe('问候');
    expect(buildConversationTitle('   ')).toBe('新对话');
  });
});

describe('skill selections on user messages', () => {
  beforeEach(() => {
    vi.useRealTimers();
    useChatStore.setState({
      conversations: [conversation('conv-skill')],
      projects: [],
      currentConversationId: 'conv-skill',
      selectedModelProfileId: DEFAULT_MODEL_PROFILE_ID,
      modelProfiles: defaultModelProfiles(),
      approvalMode: 'auto',
      projectSort: 'updated',
      conversationSort: 'updated',
      error: null,
    });
  });

  it('stores the selected skill on the user message that launched the turn', async () => {
    const skill: SkillSelection = { id: 'chrome', title: 'Chrome', description: 'Control Chrome' };

    await useChatStore.getState().sendMessage('检查页面控制台', [], skill);

    const userMessage = useChatStore.getState().conversations[0].messages[0];
    expect(userMessage.role).toBe('user');
    expect(userMessage.selectedSkill).toEqual(skill);
  });

  it('stores the summoned coworkers on the user message that launched the turn', async () => {
    const coworkers: CoworkerSelection[] = [
      { id: 'mainline', no: '①', name: '主线交易官' },
      { id: 'risk', no: '⑦', name: '风险控制官' },
    ];

    await useChatStore.getState().sendMessage('评估白酒板块减仓建议', [], null, coworkers);

    const userMessage = useChatStore.getState().conversations[0].messages[0];
    expect(userMessage.role).toBe('user');
    expect(userMessage.coworkers).toEqual(coworkers);
  });

  it('keeps coworker turns out of the client-side automation shortcut', async () => {
    await useChatStore.getState().sendMessage(
      '每天 9 点提醒我复盘',
      [],
      null,
      [{ id: 'risk', no: '⑦', name: '风险控制官' }],
    );

    const messages = useChatStore.getState().conversations[0].messages;
    expect(messages[0].coworkers).toHaveLength(1);
    // Automation intents short-circuit into an instant reply; coworker turns
    // must instead go through the normal (streaming) chat pipeline.
    expect(useChatStore.getState().conversations[0].status).not.toBe('idle');
  });
});

describe('automation turns', () => {
  beforeEach(() => {
    vi.useRealTimers();
    window.localStorage.clear();
    useChatStore.setState({
      conversations: [conversation('conv-automation')],
      projects: [],
      currentConversationId: 'conv-automation',
      selectedModelProfileId: DEFAULT_MODEL_PROFILE_ID,
      modelProfiles: defaultModelProfiles(),
      approvalMode: 'request',
      pendingAuthorization: null,
      projectSort: 'updated',
      conversationSort: 'updated',
      error: null,
    });
  });

  it('creates a local automation instead of sending simple reminder requests to Codex', async () => {
    await useChatStore.getState().sendMessage('每隔5分钟提醒我喝水');

    const state = useChatStore.getState();
    const current = state.conversations[0];
    const savedTasks = JSON.parse(window.localStorage.getItem(AUTOMATION_TASKS_KEY) || '[]');

    expect(current.status).toBe('idle');
    expect(state.pendingAuthorization).toBeNull();
    expect(current.messages).toHaveLength(2);
    expect(current.messages[1].blocks).toEqual([
      expect.objectContaining({
        type: 'text',
        content: expect.stringContaining('已在 Alpha Studio 自动化任务列表中创建'),
      }),
    ]);
    expect(savedTasks[0]).toMatchObject({
      title: '提醒我喝水。',
      prompt: '提醒我喝水。',
      schedule: '每 5 分钟',
      environment: '当前对话',
      conversationId: 'conv-automation',
    });
  });
});
