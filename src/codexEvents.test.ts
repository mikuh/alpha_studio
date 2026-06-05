import { describe, expect, it } from 'vitest';
import { applyCodexEventToConversation } from './codexEvents';
import type { Conversation } from './types';

function baseConversation(): Conversation {
  return {
    id: 'conv-1',
    title: '测试',
    messages: [
      {
        id: 'asst-1',
        role: 'assistant',
        timestamp: 1,
        isStreaming: true,
        blocks: [],
      },
    ],
    cwd: '/tmp',
    createdAt: 1,
    updatedAt: 1,
    status: 'streaming',
  };
}

describe('applyCodexEventToConversation', () => {
  it('stores the thread id for resume', () => {
    const next = applyCodexEventToConversation(baseConversation(), {
      type: 'thread_started',
      runId: 'run-1',
      conversationId: 'conv-1',
      threadId: 'thread-1',
    });

    expect(next.codexThreadId).toBe('thread-1');
  });

  it('appends streamed text to the active assistant message', () => {
    const first = applyCodexEventToConversation(baseConversation(), {
      type: 'text_delta',
      runId: 'run-1',
      conversationId: 'conv-1',
      text: '结论：',
    });
    const second = applyCodexEventToConversation(first, {
      type: 'text_delta',
      runId: 'run-1',
      conversationId: 'conv-1',
      text: '谨慎。',
    });

    expect(second.messages[0].blocks).toEqual([{ type: 'text', content: '结论：谨慎。' }]);
  });

  it('appends every text delta verbatim (dedup is the backend\'s job)', () => {
    // The app-server streams pure incremental tokens and suppresses the final
    // full-text snapshot when it already streamed deltas, so the frontend must
    // append each delta as-is — repeated tokens like "." or " the" are legit.
    const first = applyCodexEventToConversation(baseConversation(), {
      type: 'text_delta',
      runId: 'run-1',
      conversationId: 'conv-1',
      text: '结论：',
    });
    const second = applyCodexEventToConversation(first, {
      type: 'text_delta',
      runId: 'run-1',
      conversationId: 'conv-1',
      text: '谨慎。谨慎。',
    });

    expect(second.messages[0].blocks).toEqual([{ type: 'text', content: '结论：谨慎。谨慎。' }]);
  });

  it('ignores terminal events once the turn has already finished', () => {
    const conversation: Conversation = { ...baseConversation(), status: 'idle' };
    conversation.messages = [
      { id: 'asst-1', role: 'assistant', timestamp: 1, isStreaming: false, blocks: [{ type: 'text', content: '你好' }] },
    ];

    const afterStop = applyCodexEventToConversation(conversation, {
      type: 'stopped',
      runId: 'run-1',
      conversationId: 'conv-1',
    });
    // A late stop must not append a second "[已停止]" or otherwise mutate a
    // conversation that already left the streaming state.
    expect(afterStop).toBe(conversation);
  });

  it('tracks tool lifecycle', () => {
    const started = applyCodexEventToConversation(baseConversation(), {
      type: 'tool_started',
      runId: 'run-1',
      conversationId: 'conv-1',
      itemId: 'tool-1',
      title: 'execute',
      text: 'date',
    });
    const completed = applyCodexEventToConversation(started, {
      type: 'tool_completed',
      runId: 'run-1',
      conversationId: 'conv-1',
      itemId: 'tool-1',
      title: 'execute',
      text: 'done',
    });

    expect(completed.messages[0].blocks[0]).toMatchObject({
      type: 'tool',
      id: 'tool-1',
      status: 'completed',
      input: 'date',
      output: 'done',
    });
  });

  it('marks failed tools without losing their output', () => {
    const started = applyCodexEventToConversation(baseConversation(), {
      type: 'tool_started',
      runId: 'run-1',
      conversationId: 'conv-1',
      itemId: 'tool-1',
      title: 'execute',
      text: 'npm test',
    });
    const failed = applyCodexEventToConversation(started, {
      type: 'tool_failed',
      runId: 'run-1',
      conversationId: 'conv-1',
      itemId: 'tool-1',
      title: 'execute',
      text: '1 failed',
    });

    expect(failed.messages[0].blocks[0]).toMatchObject({
      type: 'tool',
      id: 'tool-1',
      status: 'failed',
      input: 'npm test',
      output: '1 failed',
    });
  });

  it('finishes and marks error states', () => {
    const errored = applyCodexEventToConversation(baseConversation(), {
      type: 'error',
      runId: 'run-1',
      conversationId: 'conv-1',
      message: 'bad',
    });

    expect(errored.status).toBe('error');
    expect(errored.messages[0].isStreaming).toBe(false);
    expect(errored.messages[0].blocks[0]).toEqual({ type: 'error', content: 'bad' });
  });
});
