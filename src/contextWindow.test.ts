import { describe, expect, it } from 'vitest';
import {
  addBackgroundContextToPrompt,
  contextWindowUsage,
  formatTokenCount,
  prepareConversationForOutgoingTurn,
} from './contextWindow';
import type { ChatMessage, Conversation } from './types';

function message(id: number, role: ChatMessage['role'], content: string): ChatMessage {
  return {
    id: `msg-${id}`,
    role,
    timestamp: id,
    blocks: [{ type: 'text', content }],
  };
}

function conversation(messages: ChatMessage[], patch: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conv-context',
    title: 'Context test',
    messages,
    cwd: '/tmp',
    createdAt: 1,
    updatedAt: 1,
    status: 'idle',
    ...patch,
  };
}

describe('context window management', () => {
  it('keeps a normal resumed thread untouched below the compact threshold', () => {
    const current = conversation(
      [message(1, 'user', '分析一下今天的市场主线。')],
      { codexThreadId: 'thread-current' },
    );

    const prepared = prepareConversationForOutgoingTurn(current);

    expect(prepared.compacted).toBe(false);
    expect(prepared.promptContext).toBeUndefined();
    expect(prepared.conversation.codexThreadId).toBe('thread-current');
    expect(contextWindowUsage(current).usedPercent).toBeGreaterThanOrEqual(0);
  });

  it('adds local visible history when a conversation has no resumable thread', () => {
    const current = conversation([
      message(1, 'user', '先记住我的组合包含半导体和机器人。'),
      message(2, 'assistant', '已记录：组合关注半导体、机器人。'),
    ]);

    const prepared = prepareConversationForOutgoingTurn(current);
    const prompt = addBackgroundContextToPrompt('继续给出观察指标。', prepared.promptContext);

    expect(prepared.compacted).toBe(false);
    expect(prompt).toContain('最近仍按原文保留的历史');
    expect(prompt).toContain('半导体、机器人');
    expect(prompt).toContain('当前用户消息：');
  });

  it('compacts old visible messages, clears the thread, and keeps recent history in the prompt context', () => {
    const longText = '主题延续、成交放量、风险提示。'.repeat(9_000);
    const messages = Array.from({ length: 12 }, (_, index) =>
      message(index + 1, index % 2 === 0 ? 'user' : 'assistant', `消息-${index + 1} ${longText}`),
    );
    const current = conversation(messages, { codexThreadId: 'thread-too-large' });

    const prepared = prepareConversationForOutgoingTurn(current);

    expect(prepared.compacted).toBe(true);
    expect(prepared.conversation.codexThreadId).toBeUndefined();
    expect(prepared.conversation.backgroundContext?.sourceMessageCount).toBe(4);
    expect(prepared.conversation.backgroundContext?.summary).toContain('消息-1');
    expect(prepared.promptContext).toContain('压缩背景摘要');
    expect(prepared.promptContext).toContain('最近仍按原文保留的历史');
    expect(prepared.promptContext).toContain('消息-5');
  });

  it('formats token counts like the Codex context tooltip', () => {
    expect(formatTokenCount(16_200)).toBe('16k');
    expect(formatTokenCount(258_000)).toBe('258k');
  });
});
