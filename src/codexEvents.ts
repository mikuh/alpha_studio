import type { ChatMessage, CodexChatEvent, Conversation, MessageBlock, ToolBlock } from './types';

export function applyCodexEventToConversation(conversation: Conversation, event: CodexChatEvent): Conversation {
  if (event.conversationId && event.conversationId !== conversation.id) {
    return conversation;
  }

  const now = Date.now();

  if (event.type === 'started') {
    return {
      ...conversation,
      runId: event.runId,
      status: 'streaming',
      updatedAt: now,
    };
  }

  if (event.type === 'thread_started' && event.threadId) {
    return {
      ...conversation,
      codexThreadId: event.threadId,
      updatedAt: now,
    };
  }

  // Terminal events (stopped/completed/error) are idempotent: the first one to
  // arrive finalizes the turn, and any later ones are ignored. This keeps a
  // user-initiated stop (which finalizes locally) from being clobbered by the
  // backend's own follow-up `error`/`completed` once the killed process tears
  // down its stdio, and prevents a stray `stopped` (which carries no
  // conversationId) from finalizing other conversations that are still running.
  if (event.type === 'stopped') {
    if (conversation.status !== 'streaming') return conversation;
    return finishStreaming(conversation, now);
  }

  if (event.type === 'completed') {
    if (conversation.status !== 'streaming') return conversation;
    return finishStreaming(conversation, now);
  }

  if (event.type === 'error') {
    if (conversation.status !== 'streaming') return conversation;
    return appendToStreamingAssistant(conversation, now, {
      type: 'error',
      content: event.message || event.text || 'Codex 返回了未知错误。',
    }, { status: 'error', runId: undefined, done: true });
  }

  if (event.type === 'status') {
    if (conversation.status !== 'streaming') return conversation;
    return appendStatusBlock(conversation, now, event.message || event.text || 'Codex 正在重试连接。');
  }

  if (event.type === 'text_delta' && event.text) {
    return appendTextDelta(conversation, now, event.text);
  }

  if (event.type === 'reasoning_delta' && event.text) {
    return appendThinkingDelta(conversation, now, event.text);
  }

  if (event.type === 'tool_started') {
    return appendToolStart(conversation, now, event);
  }

  if (event.type === 'tool_delta' && event.text) {
    return appendToolDelta(conversation, now, event);
  }

  if (event.type === 'tool_completed') {
    return completeTool(conversation, now, event);
  }

  if (event.type === 'tool_failed') {
    return failTool(conversation, now, event);
  }

  return conversation;
}

// Codex app-server streams the assistant message as pure token deltas, so we
// append every chunk verbatim. (The old snapshot-style dedup would drop legit
// repeated tokens like "." or " the".)
function appendTextDelta(conversation: Conversation, now: number, text: string): Conversation {
  return updateStreamingAssistant(conversation, now, (message) => {
    const blocks = [...message.blocks];
    const last = blocks[blocks.length - 1];
    if (last?.type === 'text') {
      blocks[blocks.length - 1] = { ...last, content: last.content + text };
    } else {
      blocks.push({ type: 'text', content: text });
    }
    return { ...message, blocks };
  });
}

function appendThinkingDelta(conversation: Conversation, now: number, text: string): Conversation {
  return updateStreamingAssistant(conversation, now, (message) => {
    const blocks = [...message.blocks];
    const last = blocks[blocks.length - 1];
    if (last?.type === 'thinking') {
      blocks[blocks.length - 1] = { ...last, content: last.content + text };
    } else {
      blocks.push({ type: 'thinking', content: text });
    }
    return { ...message, blocks };
  });
}

function appendToolStart(conversation: Conversation, now: number, event: CodexChatEvent): Conversation {
  const toolId = event.itemId || `tool-${event.runId}`;
  return updateStreamingAssistant(conversation, now, (message) => {
    const existing = message.blocks.some((block) => block.type === 'tool' && block.id === toolId);
    if (existing) return message;
    return {
      ...message,
      blocks: [
        ...message.blocks,
        {
          type: 'tool',
          id: toolId,
          title: event.title || 'tool',
          status: 'in_progress',
          input: event.text,
        },
      ],
    };
  });
}

function appendToolDelta(conversation: Conversation, now: number, event: CodexChatEvent): Conversation {
  const toolId = event.itemId || `tool-${event.runId}`;
  return updateStreamingAssistant(conversation, now, (message) => {
    const blocks = ensureToolBlock(message.blocks, toolId, event.title || 'tool');
    return {
      ...message,
      blocks: blocks.map((block) => {
        if (block.type !== 'tool' || block.id !== toolId) return block;
        return { ...block, output: `${block.output || ''}${event.text || ''}` };
      }),
    };
  });
}

function completeTool(conversation: Conversation, now: number, event: CodexChatEvent): Conversation {
  const toolId = event.itemId || `tool-${event.runId}`;
  return updateStreamingAssistant(conversation, now, (message) => {
    const blocks = ensureToolBlock(message.blocks, toolId, event.title || 'tool');
    return {
      ...message,
      blocks: blocks.map((block) => {
        if (block.type !== 'tool' || block.id !== toolId) return block;
        return {
          ...block,
          status: 'completed',
          output: event.text || block.output,
        };
      }),
    };
  });
}

function failTool(conversation: Conversation, now: number, event: CodexChatEvent): Conversation {
  const toolId = event.itemId || `tool-${event.runId}`;
  return updateStreamingAssistant(conversation, now, (message) => {
    const blocks = ensureToolBlock(message.blocks, toolId, event.title || 'tool');
    return {
      ...message,
      blocks: blocks.map((block) => {
        if (block.type !== 'tool' || block.id !== toolId) return block;
        return {
          ...block,
          status: 'failed',
          output: event.message || event.text || block.output,
        };
      }),
    };
  });
}

function ensureToolBlock(blocks: MessageBlock[], id: string, title: string): MessageBlock[] {
  if (blocks.some((block) => block.type === 'tool' && block.id === id)) {
    return blocks;
  }
  const tool: ToolBlock = { type: 'tool', id, title, status: 'in_progress' };
  return [...blocks, tool];
}

function appendToStreamingAssistant(
  conversation: Conversation,
  now: number,
  block: MessageBlock,
  options?: { status?: Conversation['status']; runId?: string; done?: boolean },
): Conversation {
  return updateStreamingAssistant(
    {
      ...conversation,
      status: options?.status || conversation.status,
      runId: options && Object.prototype.hasOwnProperty.call(options, 'runId')
        ? options.runId
        : conversation.runId,
    },
    now,
    (message) => ({
      ...message,
      blocks: [...message.blocks, block],
      isStreaming: options?.done ? false : message.isStreaming,
    }),
  );
}

function appendStatusBlock(conversation: Conversation, now: number, content: string): Conversation {
  return updateStreamingAssistant(conversation, now, (message) => {
    const last = message.blocks[message.blocks.length - 1];
    if (last?.type === 'error' && last.content === content) {
      return message;
    }
    return {
      ...message,
      blocks: [...message.blocks, { type: 'error', content }],
    };
  });
}

function finishStreaming(conversation: Conversation, now: number): Conversation {
  return updateStreamingAssistant(
    {
      ...conversation,
      status: 'idle',
      runId: undefined,
    },
    now,
    (message) => ({
      ...message,
      isStreaming: false,
      blocks: message.blocks,
    }),
  );
}

function updateStreamingAssistant(
  conversation: Conversation,
  now: number,
  updater: (message: ChatMessage) => ChatMessage,
): Conversation {
  let updated = false;
  const messages = conversation.messages.map((message, index, all) => {
    const isLastAssistant = message.role === 'assistant'
      && (message.isStreaming || index === all.length - 1);
    if (!isLastAssistant) return message;
    updated = true;
    return updater(message);
  });

  if (!updated) {
    return conversation;
  }

  return {
    ...conversation,
    messages,
    updatedAt: now,
  };
}
