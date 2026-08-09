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

  it('prefers Codex CLI token usage over the local text estimate', () => {
    const current = conversation(
      [message(1, 'user', '短消息')],
      {
        codexTokenUsage: {
          total: {
            totalTokens: 34498,
            inputTokens: 34000,
            cachedInputTokens: 14720,
            outputTokens: 498,
            reasoningOutputTokens: 120,
          },
          last: {
            totalTokens: 20429,
            inputTokens: 19770,
            cachedInputTokens: 14720,
            outputTokens: 659,
            reasoningOutputTokens: 288,
          },
          modelContextWindow: 258400,
          updatedAt: 1,
        },
      },
    );

    const usage = contextWindowUsage(current);

    expect(usage.source).toBe('codex');
    expect(usage.usedTokens).toBe(20429);
    expect(usage.totalTokens).toBe(258400);
    expect(usage.usedPercent).toBe(8);
  });

  it('warns from Codex token usage at the compact threshold', () => {
    const current = conversation(
      [message(1, 'user', '短消息')],
      {
        codexTokenUsage: {
          total: {
            totalTokens: 220000,
            inputTokens: 219000,
            cachedInputTokens: 0,
            outputTokens: 1000,
            reasoningOutputTokens: 0,
          },
          last: {
            totalTokens: 212000,
            inputTokens: 211000,
            cachedInputTokens: 0,
            outputTokens: 1000,
            reasoningOutputTokens: 0,
          },
          modelContextWindow: 258000,
          updatedAt: 1,
        },
      },
    );

    expect(contextWindowUsage(current).shouldCompact).toBe(true);
  });

  it('compacts old visible messages without a Codex thread and keeps recent history in the prompt context', () => {
    const longText = '主题延续、成交放量、风险提示。'.repeat(9_000);
    const messages = Array.from({ length: 12 }, (_, index) =>
      message(index + 1, index % 2 === 0 ? 'user' : 'assistant', `消息-${index + 1} ${longText}`),
    );
    const current = conversation(messages);

    const prepared = prepareConversationForOutgoingTurn(current);

    expect(prepared.compacted).toBe(true);
    expect(prepared.conversation.codexThreadId).toBeUndefined();
    expect(prepared.conversation.backgroundContext?.sourceMessageCount).toBe(4);
    expect(prepared.conversation.backgroundContext?.summary).toContain('消息-1');
    expect(prepared.promptContext).toContain('压缩背景摘要');
    expect(prepared.promptContext).toContain('最近仍按原文保留的历史');
    expect(prepared.promptContext).toContain('消息-5');
  });

  it('leaves large resumable Codex threads to Codex native compaction', () => {
    const longText = '主题延续、成交放量、风险提示。'.repeat(9_000);
    const messages = Array.from({ length: 12 }, (_, index) =>
      message(index + 1, index % 2 === 0 ? 'user' : 'assistant', `消息-${index + 1} ${longText}`),
    );
    const current = conversation(messages, { codexThreadId: 'thread-too-large' });

    const prepared = prepareConversationForOutgoingTurn(current);

    expect(prepared.compacted).toBe(false);
    expect(prepared.conversation.codexThreadId).toBe('thread-too-large');
    expect(prepared.promptContext).toBeUndefined();
  });

  it('compacts a resumable custom-model thread against its smaller configured window', () => {
    const messages = Array.from({ length: 12 }, (_, index) =>
      message(index + 1, index % 2 === 0 ? 'user' : 'assistant', `消息-${index + 1} ${'较长上下文。'.repeat(400)}`),
    );
    const current = conversation(messages, {
      codexThreadId: 'thread-created-with-a-larger-model',
      codexTokenUsage: {
        total: {
          totalTokens: 58_000,
          inputTokens: 56_000,
          cachedInputTokens: 0,
          outputTokens: 2_000,
          reasoningOutputTokens: 0,
        },
        last: {
          totalTokens: 60_000,
          inputTokens: 59_000,
          cachedInputTokens: 0,
          outputTokens: 1_000,
          reasoningOutputTokens: 0,
        },
        modelContextWindow: 258_000,
        updatedAt: 1,
      },
    });

    const prepared = prepareConversationForOutgoingTurn(current, {
      contextWindowTokens: 64_000,
      compactResumableThread: true,
    });

    expect(prepared.compacted).toBe(true);
    expect(prepared.conversation.codexThreadId).toBeUndefined();
    expect(prepared.conversation.codexTokenUsage).toBeUndefined();
    expect(prepared.promptContext).toContain('压缩背景摘要');
  });

  it('can roll over a custom-model thread after one oversized exchange', () => {
    const current = conversation([
      message(1, 'user', '分析这个超长资料。'),
      message(2, 'assistant', '已完成第一轮分析。'),
    ], {
      codexThreadId: 'thread-with-one-large-exchange',
      codexTokenUsage: {
        total: { totalTokens: 60_000, inputTokens: 59_000, cachedInputTokens: 0, outputTokens: 1_000, reasoningOutputTokens: 0 },
        last: { totalTokens: 60_000, inputTokens: 59_000, cachedInputTokens: 0, outputTokens: 1_000, reasoningOutputTokens: 0 },
        modelContextWindow: 258_000,
        updatedAt: 1,
      },
    });

    const prepared = prepareConversationForOutgoingTurn(current, {
      contextWindowTokens: 64_000,
      compactResumableThread: true,
    });

    expect(prepared.compacted).toBe(true);
    expect(prepared.conversation.backgroundContext?.sourceMessageCount).toBe(1);
    expect(prepared.conversation.codexThreadId).toBeUndefined();
  });

  it('does not compact a verified 1024k model at the old 64k fallback boundary', () => {
    const current = conversation([
      message(1, 'user', '分析长资料。'),
      message(2, 'assistant', '正在分析。'),
      message(3, 'user', '继续。'),
    ], {
      codexThreadId: 'deepseek-v4-flash-thread',
      codexTokenUsage: {
        total: { totalTokens: 60_000, inputTokens: 59_000, cachedInputTokens: 0, outputTokens: 1_000, reasoningOutputTokens: 0 },
        last: { totalTokens: 60_000, inputTokens: 59_000, cachedInputTokens: 0, outputTokens: 1_000, reasoningOutputTokens: 0 },
        modelContextWindow: 1_048_576,
        updatedAt: 1,
      },
    });

    const prepared = prepareConversationForOutgoingTurn(current, {
      contextWindowTokens: 1_048_576,
      compactResumableThread: true,
    });

    expect(prepared.compacted).toBe(false);
    expect(prepared.conversation.codexThreadId).toBe('deepseek-v4-flash-thread');
  });

  it('formats token counts like the Codex context tooltip', () => {
    expect(formatTokenCount(16_200)).toBe('16k');
    expect(formatTokenCount(258_000)).toBe('258k');
  });
});
