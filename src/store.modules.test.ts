import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { useChatStore } from './store';
import { moduleTestSession } from './test/moduleLicense';
import type { Conversation } from './types';
const request = '使用 $alpha-studio-daily-theme-research 生成报告';
const conversation: Conversation = { id: 'module-conversation', title: 'Test', cwd: '/tmp/module-test', messages: [], createdAt: 1, updatedAt: 1, status: 'idle' };
beforeEach(() => {
  useChatStore.setState({ clientLicenseSession: moduleTestSession(), conversations: [{ ...conversation }], currentConversationId: conversation.id, error: null });
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

describe('protected task entry points', () => {
  it('blocks a manually typed skill and an automation task without adding messages', async () => {
    await useChatStore.getState().sendMessageToConversation(conversation.id, request);
    expect(useChatStore.getState().error).toContain('未开通');
    await useChatStore.getState().sendMessageToConversation(conversation.id, '运行任务', undefined, { id: 'alpha-studio-daily-theme-research', title: '报告' }, undefined, true);
    expect(useChatStore.getState().conversations[0].messages).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('blocks editing and resending an old protected message after revocation', async () => {
    useChatStore.setState({ conversations: [{ ...conversation, messages: [{ id: 'old-message', role: 'user', timestamp: 1, blocks: [{ type: 'text', content: request }], selectedSkill: { id: 'alpha-studio-daily-theme-research', title: '报告' } }] }] });
    await useChatStore.getState().editUserMessageAndResend(conversation.id, 'old-message', '再做一次');
    expect(useChatStore.getState().error).toContain('未开通');
    expect(useChatStore.getState().conversations[0].messages).toHaveLength(1);
  });
  it('rejects a queued protected task against current server permissions', async () => {
    useChatStore.setState({ clientLicenseSession: moduleTestSession(['daily-report']), conversations: [{ ...conversation, queuedMessages: [{ id: 'old-queue', text: request, createdAt: 1 }] }] });
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ error: { message: 'module revoked' } }), { status: 403 }));
    await useChatStore.getState().sendQueuedMessageNow(conversation.id, 'old-queue');
    expect(useChatStore.getState().error).toContain('module revoked');
    expect(useChatStore.getState().conversations[0].messages).toHaveLength(0);
    expect(useChatStore.getState().conversations[0].status).toBe('idle');
  });
});
