import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activeConversations,
  archivedConversations,
  isDraftConversation,
  migratePersistedState,
  useChatStore,
  visibleConversations,
} from './store';
import type { ChatMessage, Conversation } from './types';

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

  it('migrates old persisted legacy state into coding-era state', () => {
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
    expect(migrated.model).toBeTruthy();
  });
});
