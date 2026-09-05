import type { ChatMessage, CodexChatEvent, CodexTokenUsage, CodexTokenUsageBreakdown, Conversation, FileResultBlock, ImageResultBlock, MessageBlock, ModelRequestProgress, ToolBlock } from './types';
import { COWORKER_CATALOG, coworkerById } from './coworkers';
import { isFileWriteCommand, toolEventMetadata } from './toolActivity';

export const CONTEXT_COMPACTION_TOOL_TITLE = 'context_compaction';
export const CODEX_CONTEXT_COMPACTION_TARGET = 'GPT 已压缩历史上下文';
export const CODEX_CONTEXT_COMPACTION_OUTPUT = '已收到 GPT 原生上下文压缩事件，后续回复会基于压缩后的线程继续。';

export function applyCodexEventToConversation(conversation: Conversation, event: CodexChatEvent): Conversation {
  if (event.conversationId && event.conversationId !== conversation.id) {
    return conversation;
  }
  if (event.type !== 'started' && conversation.runId && event.runId && event.runId !== conversation.runId) {
    return conversation;
  }

  const now = Date.now();

  if (event.type === 'started') {
    return {
      ...conversation,
      runId: event.runId,
      status: 'streaming',
      runActivity: undefined,
      gatewayActivity: undefined,
      updatedAt: now,
    };
  }

  // Gateway telemetry describes this run's internal HTTP requests. It must not
  // replace native tool/reasoning activity or become a transcript message.
  if (event.type === 'activity' && event.title === 'gateway') {
    if (conversation.status !== 'streaming') return conversation;
    const raw = asRecord(event.raw);
    const incoming = asRecord(raw?.status) ?? (raw && !('status' in raw) ? raw : null);
    const status = raw?.progressOnly === true && incoming
      ? { ...conversation.gatewayActivity, ...incoming } : incoming;
    const legacyWaiting = /(?:另有\s*)?(\d+)\s*个请求排队/.exec(event.message ?? '');
    const active = status ? status.active === true : Boolean(event.message);
    const lastOutputAt = numericValue(status?.lastOutputAt) ?? 0;
    const waitingRequests = numericValue(status?.waitingRequests) ?? Number(legacyWaiting?.[1] ?? 0);
    const hasNewOutput = lastOutputAt > (conversation.gatewayActivity?.lastOutputAt ?? 0);
    return {
      ...conversation,
      gatewayActivity: active || waitingRequests > 0 ? {
        active, waitingRequests, lastOutputAt, observedAt: now,
        activeRequests: numericValue(status?.activeRequests) ?? undefined,
        activeSubagents: numericValue(status?.activeSubagents) ?? undefined,
        cooldownUntil: numericValue(status?.cooldownUntil) ?? undefined,
        maxParallelSubagents: numericValue(status?.maxParallelSubagents) ?? undefined,
        requestProgress: modelRequestProgress(status?.requestProgress),
      } : undefined,
      // Queue changes and connection heartbeats aren't evidence of model progress.
      updatedAt: hasNewOutput ? now : conversation.updatedAt,
    };
  }

  if (event.type.startsWith('tool_')) {
    const command = toolEventMetadata(event).command;
    if (command && isFileWriteCommand(command)) event = { ...event, title: 'fileWrite', text: event.type === 'tool_started' ? command : event.text };
  }
  const activity = activityFromEvent(event);
  if (activity && conversation.status === 'streaming') {
    conversation = { ...conversation, runActivity: activity };
  }
  if (event.type === 'activity') {
    return conversation.status === 'streaming' ? { ...conversation, updatedAt: now } : conversation;
  }

  if (event.type === 'thread_started' && event.threadId) {
    return {
      ...conversation,
      codexThreadId: event.threadId,
      updatedAt: now,
    };
  }

  if (event.type === 'message_steered' && event.itemId) {
    const queued = conversation.queuedMessages?.find((message) => message.id === event.itemId);
    if (!queued) return conversation;
    return {
      ...conversation,
      queuedMessages: conversation.queuedMessages?.filter((message) => message.id !== queued.id),
      messages: [
        ...conversation.messages.map((message) => message.isStreaming
          ? { ...message, isStreaming: false, finishedAt: now }
          : message),
        {
          id: `user-${queued.id}`,
          role: 'user',
          timestamp: now,
          blocks: queued.text.trim() ? [{ type: 'text', content: queued.text.trim() }] : [],
          attachments: queued.attachments,
          selectedSkill: queued.selectedSkill,
          selectedTextContexts: queued.selectedTextContexts,
          coworkers: queued.coworkers,
        },
        ...(conversation.status === 'streaming' ? [{
          id: `assistant-${queued.id}`,
          role: 'assistant' as const,
          timestamp: now,
          isStreaming: true,
          blocks: [],
        }] : []),
      ],
      updatedAt: now,
    };
  }

  // A tool started before a steering message still belongs to its original
  // assistant segment. Keep its later progress and result on that segment.
  if (event.type.startsWith('tool_') && event.itemId) {
    const ownerIndex = conversation.messages.findIndex((message) => message.role === 'assistant'
      && !message.isStreaming
      && message.blocks.some((block) => block.type === 'tool' && block.id === event.itemId));
    if (ownerIndex >= 0) {
      const owner = conversation.messages[ownerIndex];
      const updated = applyCodexEventToConversation({ ...conversation, messages: [{ ...owner, isStreaming: true }] }, event);
      const messages = conversation.messages.slice();
      messages[ownerIndex] = { ...updated.messages[0], isStreaming: false };
      return { ...conversation, messages, updatedAt: now };
    }
  }

  if (event.type === 'token_usage') {
    const tokenUsage = tokenUsageFromEvent(event, now);
    if (!tokenUsage) return conversation;
    return {
      ...conversation,
      codexTokenUsage: tokenUsage,
      updatedAt: now,
    };
  }

  if (event.type === 'context_compacted') {
    const compacted = completeContextCompactionBlock(conversation, now, event);
    return {
      ...compacted,
      codexCompactedAt: now,
      updatedAt: now,
    };
  }

  // Terminal events (stopped/completed/error) are idempotent: the first one to
  // arrive finalizes the turn, and any later ones are ignored. This keeps a
  // user-initiated stop (which finalizes locally) from being clobbered by the
  // backend's own follow-up `error`/`completed` once the killed process tears
  // down its stdio, and prevents a stray `stopped` (which carries no
  // conversationId) from finalizing other conversations that are still running.
  if (conversation.status === 'streaming' && ['stopped', 'completed', 'error'].includes(event.type)) {
    conversation = {
      ...conversation,
      messages: conversation.messages.map((message) => {
        if (message.role !== 'assistant') return message;
        const blocks = finalizePendingToolBlocks(message.blocks, event.type === 'completed' ? 'completed' : 'failed');
        return blocks === message.blocks ? message : { ...message, blocks };
      }),
    };
  }
  if (event.type === 'stopped') {
    if (conversation.status !== 'streaming') return conversation;
    return finishStreaming(conversation, now, 'failed');
  }

  if (event.type === 'completed') {
    if (conversation.status !== 'streaming') return conversation;
    return finishStreaming(conversation, now, 'completed');
  }

  if (event.type === 'error') {
    if (conversation.status !== 'streaming') return conversation;
    return appendToStreamingAssistant(conversation, now, {
      type: 'error',
      content: codexErrorMessage(event),
    }, { status: 'error', runId: undefined, done: true });
  }

  if (event.type === 'status') {
    if (conversation.status !== 'streaming') return conversation;
    return appendStatusBlock(conversation, now, event.message || event.text || 'GPT 正在重试连接。');
  }

  if (event.type === 'text_delta' && event.text) {
    if (conversation.status !== 'streaming') return conversation;
    return appendStreamText(conversation, now, event, 'text');
  }

  if (event.type === 'reasoning_delta' && event.text) {
    if (conversation.status !== 'streaming') return conversation;
    return appendStreamText(conversation, now, event, 'thinking');
  }

  if (event.type === 'tool_started') {
    if (conversation.status !== 'streaming') return conversation;
    return appendToolStart(conversation, now, event);
  }

  if (event.type === 'tool_delta' && event.text) {
    if (conversation.status !== 'streaming') return conversation;
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

function modelRequestProgress(value: unknown): ModelRequestProgress[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 32).flatMap(entry => {
    const row = asRecord(entry);
    if (!row || typeof row.id !== 'string' || !['reply', 'tool_input', 'reasoning', 'search'].includes(String(row.kind))) return [];
    const subagent = row.subagent === true;
    return [{
      id: row.id, subagent, kind: row.kind as ModelRequestProgress['kind'],
      characters: Math.max(0, numericValue(row.characters) ?? 0),
      preview: (row.kind === 'tool_input' || (subagent && row.kind === 'reply')) && typeof row.preview === 'string' ? Array.from(row.preview).slice(-900).join('') : '',
      itemId: typeof row.itemId === 'string' ? row.itemId : undefined,
      callId: typeof row.callId === 'string' ? row.callId : undefined,
      toolName: typeof row.toolName === 'string' ? row.toolName.slice(0, 100) : undefined,
      updatedAt: numericValue(row.updatedAt) ?? 0,
    }];
  });
}

function activityFromEvent(event: CodexChatEvent): Conversation['runActivity'] {
  if (event.type === 'status') {
    const message = event.message || event.text || '正在重试模型连接';
    const reconnect = /^Reconnecting\.\.\.\s+(\d+)\/(\d+)$/i.exec(message.trim());
    return { kind: 'retrying', label: reconnect ? `正在重连模型（${reconnect[1]}/${reconnect[2]}）` : message };
  }
  if (event.type === 'activity') return {
    kind: event.title === 'reasoning' ? 'reasoning' : 'working',
    label: event.message || '正在处理',
  };
  if (event.type === 'reasoning_delta') return { kind: 'reasoning', label: '正在推理' };
  if (event.type === 'text_delta') return { kind: 'working', label: '正在生成回复' };
  if (event.type === 'tool_started' || event.type === 'tool_delta') return { kind: 'working', label: '正在执行工具' };
  if (event.type === 'tool_completed' || event.type === 'tool_failed' || event.type === 'context_compacted') return { kind: 'working', label: '等待模型继续处理' };
  return undefined;
}

function codexErrorMessage(event: CodexChatEvent): string {
  const message = event.message || event.text || 'GPT 返回了未知错误。';
  const raw = asRecord(event.raw);
  const error = asRecord(raw?.error) ?? raw;
  const details = typeof error?.additionalDetails === 'string' ? error.additionalDetails.trim() : '';
  const diagnostic = details && !message.includes(details) ? `${message}\n${details}` : message;
  if (/\b(?:status[:\s]*|http\s+)413\b|\b413\s+payload\b|payload too large|request body too large|request_body_too_large/i.test(diagnostic)) {
    return `模型请求过大（HTTP 413），服务端拒绝继续处理。可以减少附加图片，或在新对话中引用已有文件继续。已生成的本地文件仍可打开或打印。\n${diagnostic}`;
  }
  return diagnostic;
}

function tokenUsageFromEvent(event: CodexChatEvent, updatedAt: number): CodexTokenUsage | null {
  const raw = asRecord(event.raw);
  if (!raw) return null;
  const payload = asRecord(raw.tokenUsage) ?? asRecord(raw.info) ?? raw;
  const totalRaw = asRecord(payload.total) ?? asRecord(payload.totalTokenUsage) ?? asRecord(payload.total_token_usage);
  const lastRaw = asRecord(payload.last) ?? asRecord(payload.lastTokenUsage) ?? asRecord(payload.last_token_usage) ?? totalRaw;
  if (!totalRaw || !lastRaw) return null;
  const total = tokenUsageBreakdown(totalRaw);
  const last = tokenUsageBreakdown(lastRaw);
  if (!total || !last) return null;
  return {
    total,
    last,
    modelContextWindow: numericValue(payload.modelContextWindow ?? payload.model_context_window),
    updatedAt,
  };
}

function tokenUsageBreakdown(raw: Record<string, unknown>): CodexTokenUsageBreakdown | null {
  const totalTokens = numericValue(raw.totalTokens ?? raw.total_tokens);
  if (totalTokens === null) return null;
  return {
    totalTokens,
    inputTokens: numericValue(raw.inputTokens ?? raw.input_tokens) ?? 0,
    cachedInputTokens: numericValue(raw.cachedInputTokens ?? raw.cached_input_tokens) ?? 0,
    outputTokens: numericValue(raw.outputTokens ?? raw.output_tokens) ?? 0,
    reasoningOutputTokens: numericValue(raw.reasoningOutputTokens ?? raw.reasoning_output_tokens) ?? 0,
  };
}

function numericValue(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(0, Math.round(value));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

// Deltas append verbatim, including repeated tokens. Only an explicit native
// completion snapshot replaces its own item; other messages are independent.
function appendStreamText(conversation: Conversation, now: number, event: CodexChatEvent, type: 'text' | 'thinking'): Conversation {
  const text = event.text ?? '';
  const matches = (block: MessageBlock) => block.type === type && event.itemId
    && block.itemId === event.itemId && block.runId === event.runId;
  const owner = event.itemId ? conversation.messages.findIndex(message => message.role === 'assistant' && message.blocks.some(matches)) : -1;
  const update = (message: ChatMessage): ChatMessage => {
    const blocks = [...message.blocks];
    const last = blocks[blocks.length - 1];
    const index = event.itemId ? blocks.findIndex(matches) : last?.type === type && !last.itemId ? blocks.length - 1 : -1;
    const previous = blocks[index];
    if (previous && (previous.type === 'text' || previous.type === 'thinking')) {
      const replace = event.message === 'replace' && (Boolean(event.itemId) || text.startsWith(previous.content));
      blocks[index] = { ...previous, content: replace ? text : previous.content + text };
    } else {
      blocks.push({ type, content: text, ...(event.itemId ? { itemId: event.itemId, runId: event.runId } : {}) });
    }
    return { ...message, blocks };
  };
  if (owner >= 0) return { ...conversation, updatedAt: now,
    messages: conversation.messages.map((message, index) => index === owner ? update(message) : message) };
  return updateStreamingAssistant(conversation, now, update);
}

function completeContextCompactionBlock(conversation: Conversation, now: number, event: CodexChatEvent): Conversation {
  const blockId = event.itemId || `context-compaction-${event.runId}`;
  return updateStreamingAssistant(conversation, now, (message) => {
    const blocks = [...message.blocks];
    let existingIndex = -1;
    for (let index = blocks.length - 1; index >= 0; index -= 1) {
      const block = blocks[index];
      if (block.type !== 'tool') continue;
      if (block.id === blockId || block.title === CONTEXT_COMPACTION_TOOL_TITLE) {
        existingIndex = index;
        break;
      }
    }
    const nextBlock: ToolBlock = {
      type: 'tool',
      id: existingIndex >= 0 && blocks[existingIndex]?.type === 'tool'
        ? (blocks[existingIndex] as ToolBlock).id
        : blockId,
      title: CONTEXT_COMPACTION_TOOL_TITLE,
      status: 'completed',
      target: CODEX_CONTEXT_COMPACTION_TARGET,
      output: CODEX_CONTEXT_COMPACTION_OUTPUT,
    };
    if (existingIndex >= 0) {
      blocks[existingIndex] = nextBlock;
    } else {
      blocks.push(nextBlock);
    }
    return { ...message, blocks };
  });
}

function appendToolStart(conversation: Conversation, now: number, event: CodexChatEvent): Conversation {
  const toolId = event.itemId || `tool-${event.runId}`;
  const target = toolTargetFromEvent(event);
  return updateStreamingAssistant(conversation, now, (message) => {
    const existingIndex = message.blocks.findIndex((block) => block.type === 'tool' && block.id === toolId);
    if (existingIndex >= 0) {
      const existing = message.blocks[existingIndex];
      if (existing.type !== 'tool' || existing.status !== 'in_progress') return message;
      const nextTitle = event.title || existing.title;
      const titleBecameMoreSpecific = Boolean(event.title && event.title !== existing.title);
      const blocks = [...message.blocks];
      blocks[existingIndex] = {
        ...existing,
        title: nextTitle,
        target: existing.target || target,
        input: titleBecameMoreSpecific && event.text
          ? clampToolLog(event.text)
          : existing.input || clampToolLog(event.text),
        ...toolEventMetadata(event),
      };
      return { ...message, blocks };
    }
    return {
      ...message,
      blocks: [
        ...message.blocks,
        {
          type: 'tool',
          id: toolId,
          title: event.title || 'tool',
          status: 'in_progress',
          ...(target ? { target } : {}),
          input: clampToolLog(event.text),
          startedAt: now,
          ...toolEventMetadata(event),
        },
      ],
    };
  });
}

function appendToolDelta(conversation: Conversation, now: number, event: CodexChatEvent): Conversation {
  const toolId = event.itemId || `tool-${event.runId}`;
  const target = toolTargetFromEvent(event);
  return updateStreamingAssistant(conversation, now, (message) => {
    const blocks = ensureToolBlock(message.blocks, toolId, event.title || 'tool', target);
    return {
      ...message,
      blocks: blocks.map((block) => {
        if (block.type !== 'tool' || block.id !== toolId) return block;
        return {
          ...block,
          target: block.target || target,
          ...toolEventMetadata(event),
          output: event.message === 'replace'
            ? clampToolLog(event.text)
            : clampToolLog(`${block.output || ''}${event.text || ''}`),
        };
      }),
    };
  });
}

function completeTool(conversation: Conversation, now: number, event: CodexChatEvent): Conversation {
  const toolId = event.itemId || `tool-${event.runId}`;
  const target = toolTargetFromEvent(event);
  return updateStreamingAssistant(conversation, now, (message) => {
    const blocks = ensureToolBlock(message.blocks, toolId, event.title || 'tool', target);
    const imageResult = imageResultFromToolEvent(event, toolId);
    const fileResult = fileResultFromToolEvent(event, toolId);
    const hasImageResult = Boolean(imageResult?.images.length);
    const completedBlocks = blocks.map((block) => {
      if (block.type !== 'tool' || block.id !== toolId) return block;
      return {
        ...block,
        status: 'completed' as const,
        ...(block.startedAt !== undefined ? { finishedAt: now } : {}),
        completionUnconfirmed: undefined,
        ...toolEventMetadata(event),
        target: block.target || target,
        // Image generation can return a multi-megabyte data URL nested inside a
        // generic `wait` result. Keep the image in a dedicated renderable block
        // instead of duplicating that payload inside the collapsed tool log.
        output: hasImageResult ? '图片已生成，结果见下方。' : clampToolLog(event.text || block.output),
      };
    });
    const resultBlocks: MessageBlock[] = [...completedBlocks];
    if (imageResult && !resultBlocks.some((block) => block.type === 'image_result' && block.id === imageResult.id)) {
      resultBlocks.push(imageResult);
    }
    if (fileResult && !resultBlocks.some((block) => block.type === 'file_result' && block.id === fileResult.id)) {
      resultBlocks.push(fileResult);
    }
    return {
      ...message,
      blocks: resultBlocks,
    };
  });
}

function failTool(conversation: Conversation, now: number, event: CodexChatEvent): Conversation {
  const toolId = event.itemId || `tool-${event.runId}`;
  const target = toolTargetFromEvent(event);
  return updateStreamingAssistant(conversation, now, (message) => {
    const blocks = ensureToolBlock(message.blocks, toolId, event.title || 'tool', target);
    return {
      ...message,
      blocks: blocks.map((block) => {
        if (block.type !== 'tool' || block.id !== toolId) return block;
        return {
          ...block,
          status: 'failed',
          ...(block.startedAt !== undefined ? { finishedAt: now } : {}),
          completionUnconfirmed: undefined,
          ...toolEventMetadata(event),
          target: block.target || target,
          output: clampToolLog(event.message || event.text || block.output),
        };
      }),
    };
  });
}

function ensureToolBlock(blocks: MessageBlock[], id: string, title: string, target?: string): MessageBlock[] {
  if (blocks.some((block) => block.type === 'tool' && block.id === id)) {
    return blocks;
  }
  const tool: ToolBlock = { type: 'tool', id, title, status: 'in_progress', ...(target ? { target } : {}) };
  return [...blocks, tool];
}

function toolTargetFromEvent(event: CodexChatEvent): string | undefined {
  if (!isSpawnAgentToolEvent(event)) return undefined;
  const agentId = spawnAgentIdFromEvent(event);
  if (!agentId) return undefined;
  const coworker = coworkerById(agentId);
  if (!coworker) return agentId;
  return `${agentId} · ${coworker.no} ${coworker.name}`;
}

function isSpawnAgentToolEvent(event: CodexChatEvent): boolean {
  const identity = [
    event.title,
    ...collectToolIdentityStrings(event.raw),
  ].filter(Boolean).join(' ');
  return /spawn[\s._-]*agent|multi[\s._-]*agent.*spawn[\s._-]*agent/i.test(identity);
}

function spawnAgentIdFromEvent(event: CodexChatEvent): string | undefined {
  const candidates = uniqueStrings([
    ...extractSpawnAgentIdCandidates(event.text),
    ...extractSpawnAgentIdCandidates(event.raw),
  ]);
  for (const candidate of candidates) {
    const normalized = normalizeSpawnAgentId(candidate);
    if (normalized) return normalized;
  }
  return undefined;
}

function extractSpawnAgentIdCandidates(value: unknown): string[] {
  const candidates: string[] = [];
  visitUnknown(value, (entry, key) => {
    if (typeof entry !== 'string') return;
    if (key && /^(agent_type|agentType|agent_id|agentId|agent|target_agent|targetAgent)$/i.test(key)) {
      candidates.push(entry);
    }
    candidates.push(...extractSpawnAgentIdCandidatesFromText(entry));
    const parsed = parseJsonUnknown(entry);
    if (parsed !== undefined && parsed !== entry) {
      candidates.push(...extractSpawnAgentIdCandidates(parsed));
    }
  });
  return candidates;
}

function extractSpawnAgentIdCandidatesFromText(text: string): string[] {
  const candidates: string[] = [];
  const keyPattern = /["']?(?:agent_type|agentType|agent_id|agentId|agent|target_agent|targetAgent)["']?\s*[:=]\s*["']?([A-Za-z0-9_-]+)["']?/g;
  for (const match of text.matchAll(keyPattern)) {
    candidates.push(match[1]);
  }
  for (const coworker of COWORKER_CATALOG) {
    const escaped = escapeRegExp(coworker.id);
    const filePattern = new RegExp(`(?:^|[/\\\\])${escaped}\\.(?:md|markdown|txt|json)(?=$|[\\s"'<>),.;:])`, 'i');
    if (filePattern.test(text)) {
      candidates.push(coworker.id);
    }
  }
  return candidates;
}

function normalizeSpawnAgentId(value: string | undefined): string | undefined {
  const trimmed = (value || '').trim().replace(/^["'`]+|["'`]+$/g, '');
  if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) return undefined;
  const lower = trimmed.toLowerCase();
  const coworker = COWORKER_CATALOG.find((item) => item.id.toLowerCase() === lower);
  if (coworker) return coworker.id;
  if (['default', 'explorer', 'worker'].includes(lower)) return lower;
  return trimmed;
}

function parseJsonUnknown(value: string): unknown | undefined {
  const trimmed = value.trim();
  if (!trimmed || !/^[\[{"]/.test(trimmed)) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
      runActivity: options?.done ? undefined : conversation.runActivity,
      gatewayActivity: options?.done ? undefined : conversation.gatewayActivity,
    },
    now,
    (message) => {
      const blocks = options?.done
        ? finalizePendingToolBlocks(message.blocks, 'failed')
        : message.blocks;
      return {
        ...message,
        blocks: [...blocks, block],
        isStreaming: options?.done ? false : message.isStreaming,
        ...(options?.done ? { finishedAt: now, finishReason: 'error' as const } : {}),
      };
    },
  );
}

function appendStatusBlock(conversation: Conversation, now: number, content: string): Conversation {
  return updateStreamingAssistant(conversation, now, (message) => {
    const last = message.blocks[message.blocks.length - 1];
    if (last?.type === 'error' && last.content === content) {
      return message;
    }
    if (isReconnectStatusContent(content)) {
      const firstReconnectIndex = message.blocks.findIndex(
        (block) => block.type === 'error' && isReconnectStatusContent(block.content),
      );
      if (firstReconnectIndex >= 0) {
        const blocks = message.blocks.filter(
          (block, index) => index === firstReconnectIndex
            || block.type !== 'error'
            || !isReconnectStatusContent(block.content),
        );
        blocks[firstReconnectIndex] = { type: 'error', content };
        return { ...message, blocks };
      }
    }
    return {
      ...message,
      blocks: [...message.blocks, { type: 'error', content }],
    };
  });
}

function isReconnectStatusContent(content: string): boolean {
  return /^Reconnecting\.\.\.\s+\d+\/\d+$/i.test(content.trim());
}

function finishStreaming(
  conversation: Conversation,
  now: number,
  pendingToolStatus: Extract<ToolBlock['status'], 'completed' | 'failed'>,
): Conversation {
  const imageGenerationTurn = isImageGenerationTurn(conversation);
  return updateStreamingAssistant(
    {
      ...conversation,
      status: 'idle',
      runId: undefined,
      runActivity: undefined,
      gatewayActivity: undefined,
    },
    now,
    (message) => {
      const hasImageResult = message.blocks.some((block) => {
        if (block.type === 'image_result') return block.images.length > 0;
        if (block.type === 'file_result') return block.files.some((file) => file.kind === 'image');
        if (block.type === 'text') return extractImageCandidatesFromText(block.content).length > 0;
        return false;
      });
      const hasMissingResultNotice = message.blocks.some(
        (block) => block.type === 'error' && block.content.includes('未收到可展示的图片结果'),
      );
      const blocks = finalizePendingToolBlocks(message.blocks, pendingToolStatus);
      return {
        ...message,
        isStreaming: false,
        finishedAt: now,
        finishReason: pendingToolStatus === 'completed' ? 'completed' : 'stopped',
        blocks: imageGenerationTurn && !hasImageResult && !hasMissingResultNotice
          ? [...blocks, { type: 'error', content: '图片生成已结束，但未收到可展示的图片结果。请重试。' }]
          : blocks,
      };
    },
  );
}

// A terminal turn is authoritative: no tool in its assistant message can
// still be running. Codex normally emits a matching tool completion first,
// but a killed child process or a missing lifecycle notification can leave an
// orphaned in-progress block behind. Settle it here so grouped events cannot
// keep spinning after the conversation has ended.
export function finalizePendingToolBlocks(
  blocks: MessageBlock[],
  status: Extract<ToolBlock['status'], 'completed' | 'failed'>,
): MessageBlock[] {
  let changed = false;
  const next = blocks.map((block) => {
    if (block.type !== 'tool' || block.status !== 'in_progress') return block;
    changed = true;
    // A completed turn alone cannot confirm that a pending file write succeeded.
    const unconfirmedWrite = status === 'completed' && /file.?change|file.?write|apply.?patch|write.?file/i.test(block.title);
    return { ...block, status, ...(unconfirmedWrite ? { completionUnconfirmed: true } : {}) };
  });
  return changed ? next : blocks;
}

function isImageGenerationTurn(conversation: Conversation): boolean {
  for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
    const message = conversation.messages[index];
    if (message.role === 'user') return message.selectedSkill?.id === 'imagegen';
  }
  return false;
}

function updateStreamingAssistant(
  conversation: Conversation,
  now: number,
  updater: (message: ChatMessage) => ChatMessage,
): Conversation {
  let assistantIndex = -1;
  for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
    const message = conversation.messages[index];
    if (message.role === 'assistant' && message.isStreaming) {
      assistantIndex = index;
      break;
    }
  }
  const lastIndex = conversation.messages.length - 1;
  if (assistantIndex < 0 && conversation.messages[lastIndex]?.role === 'assistant') {
    assistantIndex = lastIndex;
  }
  if (assistantIndex < 0) return conversation;

  // A conversation owns a single live assistant turn. Clone the array in
  // native code and replace only that tail entry instead of invoking a map
  // callback for every historical message on every streamed frame.
  const messages = conversation.messages.slice();
  messages[assistantIndex] = updater(messages[assistantIndex]);

  return {
    ...conversation,
    messages,
    updatedAt: now,
  };
}

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic', 'avif'];
const IMAGE_EXT_PATTERN = `(?:${IMAGE_EXTENSIONS.join('|')})`;
const FILE_EXTENSIONS = [
  ...IMAGE_EXTENSIONS,
  'pdf', 'txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'jsonl', 'yaml', 'yml', 'xml', 'html', 'htm',
  'doc', 'docx', 'rtf', 'pages', 'xls', 'xlsx', 'numbers', 'ppt', 'pptx', 'key',
  'zip', 'tar', 'gz', 'tgz', 'mp3', 'wav', 'm4a', 'mp4', 'mov', 'webm',
  'py', 'js', 'jsx', 'ts', 'tsx', 'css', 'scss', 'rs', 'go', 'java', 'kt', 'swift', 'sql',
];
const FILE_EXT_PATTERN = `(?:${FILE_EXTENSIONS.join('|')})`;
const MARKDOWN_IMAGE_PATTERN = /!\[([^\]\n]*)\]\((<[^>]+>|[^)\s]+)(?:\s+["'][^"']*["'])?\)/gi;
const URL_IMAGE_PATTERN = /\b(?:https?:\/\/|file:\/\/\/)[^\s"'<>`|]+?\.(?:png|jpe?g|gif|webp|bmp|svg|heic|avif)(?:[?#][^\s"'<>`|)]*)?/gi;
const ABSOLUTE_IMAGE_PATH_PATTERN = /(?:^|[\s"'(])((?:~|\/)[^\s"'<>`|]+?\.(?:png|jpe?g|gif|webp|bmp|svg|heic|avif)(?:[?#][^\s"'<>`|)]*)?)/gi;
const DATA_IMAGE_PATTERN = /\bdata:image\/(?:png|jpe?g|gif|webp|bmp|svg\+xml|avif);base64,[A-Za-z0-9+/=]+/gi;
const MARKDOWN_FILE_LINK_PATTERN = /\[[^\]\n]+\]\((<[^>]+>|[^)\s]+)(?:\s+["'][^"']*["'])?\)/gi;
const URL_FILE_PATTERN = new RegExp('\\b(?:https?:\\/\\/|file:\\/\\/\\/)[^\\s"\'<>`|]+?\\.' + FILE_EXT_PATTERN + '(?:[?#][^\\s"\'<>`|)]*)?(?=$|[\\s"\'<>`|)])', 'gi');
const ABSOLUTE_FILE_PATH_PATTERN = new RegExp('(?:^|[\\s"\'(])((?:~|\\/)[^\\s"\'<>`|]+?\\.' + FILE_EXT_PATTERN + '(?:[?#][^\\s"\'<>`|)]*)?)(?=$|[\\s"\'<>`|)])', 'gi');
// Only treat a path as an artifact when the surrounding line says that a
// write/export actually happened. Bare labels such as `FILE /tmp/input.pdf`
// are commonly emitted while reading temporary inputs and must not become
// deliverables (the temporary directory may be removed before the turn ends).
const GENERATED_FILE_HINT_PATTERN = /\b(?:generated|created|saved|wrote|written|exported|downloaded)\b|\boutput\s*(?:(?:file|document|report|artifact|path)\s*)?[:=]|(?:已生成|已创建|已保存|已导出|已下载|生成文件|创建文件|保存文件|导出文件|下载文件|交付文件|文件已生成|文件已保存|保存位置|输出(?:文件|路径)?\s*[:：=])/i;
const GENERATED_REMOTE_FILE_HINT_PATTERN = /\b(?:(?:generated|created|saved|exported|downloaded)\s+(?:file|document|report|artifact|output)|(?:file|document|report|artifact|output)\s+(?:generated|created|saved|exported))\b|(?:已生成|已创建|已保存|已导出|生成文件|创建文件|保存文件|导出文件|交付文件|下载文件|文件已生成|文件已保存|保存位置)/i;

// Tool logs are useful for diagnosis, but raw HTML and quote payloads can be
// hundreds of kilobytes. Keeping them unbounded makes the transcript sluggish,
// bloats copied conversations, and amplifies the next context-window estimate.
// Preserve enough of the beginning and the latest tail to diagnose failures.
export const TOOL_LOG_MAX_CHARACTERS = 48_000;
const TOOL_LOG_HEAD_CHARACTERS = 36_000;
const TOOL_LOG_TRUNCATION_MARKER = '\n\n…… Alpha Studio 已折叠过长的工具日志 ……\n\n';

function clampToolLog(value: string | undefined): string | undefined {
  if (!value || value.length <= TOOL_LOG_MAX_CHARACTERS) return value;
  const tailCharacters = TOOL_LOG_MAX_CHARACTERS - TOOL_LOG_HEAD_CHARACTERS - TOOL_LOG_TRUNCATION_MARKER.length;
  return `${value.slice(0, TOOL_LOG_HEAD_CHARACTERS)}${TOOL_LOG_TRUNCATION_MARKER}${value.slice(-tailCharacters)}`;
}

function imageResultFromToolEvent(event: CodexChatEvent, toolId: string): ImageResultBlock | null {
  const imageGenerationTool = isImageGenerationTool(event);
  const candidates = imageGenerationTool
    ? [
        ...extractImageCandidatesFromText(event.text || ''),
        ...extractImageGenerationCandidates(event.raw),
        ...extractImageCandidatesFromUnknown(event.raw),
      ]
    : extractExplicitInlineImageCandidatesFromEvent(event);
  const unique = uniqueImageCandidates(candidates);
  if (unique.length === 0) return null;
  return {
    type: 'image_result',
    id: `${toolId}-result`,
    title: '生成结果',
    images: unique.map((candidate, index) => {
      const name = imageNameFromSrc(candidate.src);
      return {
        id: `${toolId}-result-${index}`,
        src: candidate.src,
        alt: candidate.alt || name,
        name,
      };
    }),
  };
}

// Long-running image generation may finish through a generic `wait` tool. Only
// accept its explicitly typed input_image/output_image payload. A data URL or
// .png URL appearing inside shell/web output is source content, not a generated
// artifact, and must never create an image card by itself.
function extractExplicitInlineImageCandidatesFromEvent(event: CodexChatEvent): ImageCandidate[] {
  const candidates = extractTypedInlineImageCandidates(event.raw);
  const parsedText = parseJsonUnknown(event.text || '');
  if (parsedText !== undefined) {
    candidates.push(...extractTypedInlineImageCandidates(parsedText));
  }
  return candidates;
}

function extractTypedInlineImageCandidates(value: unknown): ImageCandidate[] {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => extractTypedInlineImageCandidates(item));
  }

  const record = value as Record<string, unknown>;
  const type = typeof record.type === 'string'
    ? record.type.replace(/[\s_-]/g, '').toLowerCase()
    : '';
  const candidates: ImageCandidate[] = [];
  if (type === 'inputimage' || type === 'outputimage') {
    for (const key of ['image_url', 'imageUrl', 'url', 'src', 'path']) {
      const source = record[key];
      if (typeof source === 'string' && isImageSrc(source)) {
        candidates.push({ src: source });
      }
    }
  }
  for (const entry of Object.values(record)) {
    if (entry && typeof entry === 'object') {
      candidates.push(...extractTypedInlineImageCandidates(entry));
    }
  }
  return candidates;
}

function extractImageGenerationCandidates(value: unknown): ImageCandidate[] {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => extractImageGenerationCandidates(item));
  }

  const record = value as Record<string, unknown>;
  const type = typeof record.type === 'string'
    ? record.type.replace(/[\s_-]/g, '').toLowerCase()
    : '';
  const candidates: ImageCandidate[] = [];
  if (type.includes('imagegeneration')) {
    const savedPath = record.savedPath ?? record.saved_path;
    const hasSavedImage = typeof savedPath === 'string' && isImageSrc(savedPath);
    if (hasSavedImage) {
      candidates.push({ src: savedPath });
    } else if (typeof record.result === 'string') {
      const src = imageGenerationResultSrc(record.result);
      if (src) candidates.push({ src });
    }
  }

  for (const entry of Object.values(record)) {
    if (entry && typeof entry === 'object') {
      candidates.push(...extractImageGenerationCandidates(entry));
    }
  }
  return candidates;
}

function imageGenerationResultSrc(result: string): string | null {
  const trimmed = result.trim();
  if (!trimmed) return null;
  if (isImageSrc(trimmed)) return trimmed;
  if (trimmed.startsWith('iVBORw0KGgo')) return `data:image/png;base64,${trimmed}`;
  if (trimmed.startsWith('/9j/')) return `data:image/jpeg;base64,${trimmed}`;
  if (trimmed.startsWith('UklGR')) return `data:image/webp;base64,${trimmed}`;
  if (trimmed.startsWith('R0lGOD')) return `data:image/gif;base64,${trimmed}`;
  return null;
}

function fileResultFromToolEvent(event: CodexChatEvent, toolId: string): FileResultBlock | null {
  const candidates = [
    ...extractGeneratedFileCandidatesFromText(event.text || ''),
    ...extractGeneratedFileCandidatesFromUnknown(event.raw),
  ];
  const unique = uniqueFileCandidates(candidates)
    .filter((candidate) => !/(?:^|\/)\.alpha-studio-tracking\.json$/i.test(candidate.path));
  if (unique.length === 0) return null;
  return {
    type: 'file_result',
    id: `${toolId}-files`,
    title: '生成文件',
    files: unique.map((candidate, index) => {
      const name = imageNameFromSrc(candidate.path);
      const ext = extOf(name);
      return {
        id: `${toolId}-files-${index}`,
        path: candidate.path,
        name,
        ext,
        kind: isImageExtension(ext) ? 'image' : 'file',
      };
    }),
  };
}

function isImageGenerationTool(event: CodexChatEvent): boolean {
  const identity = [
    event.title,
    ...collectToolIdentityStrings(event.raw),
  ].filter(Boolean).join(' ').toLowerCase();
  return /image[\s._-]*gen|generate[\s._-]*image|image[\s._-]*generation|text[\s._-]*to[\s._-]*image/.test(identity);
}

interface ImageCandidate {
  src: string;
  alt?: string;
}

interface FileCandidate {
  path: string;
}

function uniqueImageCandidates(candidates: ImageCandidate[]): ImageCandidate[] {
  const seen = new Set<string>();
  const unique: ImageCandidate[] = [];
  for (const candidate of candidates) {
    const src = normalizeImageSrc(candidate.src);
    if (!src || seen.has(src) || !isImageSrc(src)) continue;
    seen.add(src);
    unique.push({ ...candidate, src });
  }
  return unique;
}

function uniqueFileCandidates(candidates: FileCandidate[]): FileCandidate[] {
  const seen = new Set<string>();
  const unique: FileCandidate[] = [];
  for (const candidate of candidates) {
    const path = normalizeImageSrc(candidate.path);
    if (!path || seen.has(path) || !isFileSrc(path)) continue;
    seen.add(path);
    unique.push({ path });
  }
  return unique;
}

function extractImageCandidatesFromUnknown(value: unknown): ImageCandidate[] {
  const out: ImageCandidate[] = [];
  visitUnknown(value, (entry, key) => {
    if (typeof entry !== 'string') return;
    const textCandidates = extractImageCandidatesFromText(entry);
    if (textCandidates.length > 0) {
      out.push(...textCandidates);
      return;
    }
    if (key && isImageSourceKey(key) && isImageSrc(entry)) {
      out.push({ src: entry });
    }
  });
  return out;
}

function extractGeneratedFileCandidatesFromUnknown(value: unknown): FileCandidate[] {
  const out: FileCandidate[] = [];
  visitUnknown(value, (entry) => {
    if (typeof entry !== 'string') return;
    const textCandidates = extractGeneratedFileCandidatesFromText(entry);
    if (textCandidates.length > 0) {
      out.push(...textCandidates);
    }
  });
  return out;
}

function extractImageCandidatesFromText(text: string): ImageCandidate[] {
  if (!text) return [];
  const candidates: ImageCandidate[] = [];
  for (const match of text.matchAll(MARKDOWN_IMAGE_PATTERN)) {
    candidates.push({ alt: match[1]?.trim() || undefined, src: unwrapMarkdownUrl(match[2] || '') });
  }
  for (const match of text.matchAll(DATA_IMAGE_PATTERN)) {
    candidates.push({ src: match[0] });
  }
  for (const match of text.matchAll(URL_IMAGE_PATTERN)) {
    candidates.push({ src: match[0] });
  }
  for (const match of text.matchAll(ABSOLUTE_IMAGE_PATH_PATTERN)) {
    candidates.push({ src: match[1] });
  }
  return candidates;
}

function extractGeneratedFileCandidatesFromText(text: string): FileCandidate[] {
  if (!text) return [];
  const candidates: FileCandidate[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!GENERATED_FILE_HINT_PATTERN.test(line)) continue;
    const lineCandidates = extractFileCandidatesFromText(line);
    const explicitlyGeneratedRemote = GENERATED_REMOTE_FILE_HINT_PATTERN.test(line);
    candidates.push(...lineCandidates.filter((candidate) => (
      !/^https?:\/\//i.test(candidate.path) || explicitlyGeneratedRemote
    )));
  }
  return candidates;
}

function extractFileCandidatesFromText(text: string): FileCandidate[] {
  const candidates: FileCandidate[] = [];
  for (const match of text.matchAll(MARKDOWN_IMAGE_PATTERN)) {
    candidates.push({ path: unwrapMarkdownUrl(match[2] || '') });
  }
  for (const match of text.matchAll(MARKDOWN_FILE_LINK_PATTERN)) {
    candidates.push({ path: unwrapMarkdownUrl(match[1] || '') });
  }
  for (const match of text.matchAll(URL_FILE_PATTERN)) {
    candidates.push({ path: match[0] });
  }
  for (const match of text.matchAll(ABSOLUTE_FILE_PATH_PATTERN)) {
    candidates.push({ path: match[1] });
  }
  return candidates;
}

function collectToolIdentityStrings(value: unknown): string[] {
  const out: string[] = [];
  visitUnknown(value, (entry, key) => {
    if (typeof entry === 'string' && key && /^(type|title|name|tool|toolName|function|id)$/i.test(key)) {
      out.push(entry);
    }
  });
  return out;
}

function visitUnknown(value: unknown, visitor: (entry: unknown, key?: string) => void): void {
  visitor(value);
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item) => visitUnknown(item, visitor));
    return;
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    visitor(entry, key);
    if (entry && typeof entry === 'object') visitUnknown(entry, visitor);
  }
}

function isImageSourceKey(key: string): boolean {
  return /^(url|uri|src|path|file|filePath|file_path|image|imageUrl|image_url|output|result)$/i.test(key);
}

function unwrapMarkdownUrl(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function normalizeImageSrc(src: string): string {
  return stripTrailingImagePunctuation(unwrapMarkdownUrl(src.trim()));
}

function stripTrailingImagePunctuation(src: string): string {
  return src.replace(/[),.;:]+$/g, '');
}

function isImageSrc(src: string): boolean {
  if (!src) return false;
  if (/^data:image\//i.test(src)) return true;
  const withoutQuery = src.split(/[?#]/)[0].toLowerCase();
  return new RegExp(`\\.${IMAGE_EXT_PATTERN}$`, 'i').test(withoutQuery);
}

function isFileSrc(src: string): boolean {
  if (!src || /^data:/i.test(src)) return false;
  if (!/^(?:https?:\/\/|file:\/\/\/|\/|~(?:\/|$))/i.test(src)) return false;
  const withoutQuery = src.split(/[?#]/)[0].toLowerCase();
  return new RegExp(`\\.${FILE_EXT_PATTERN}$`, 'i').test(withoutQuery);
}

function isImageExtension(ext: string): boolean {
  return IMAGE_EXTENSIONS.includes(ext.toLowerCase());
}

function extOf(name: string): string {
  const match = /\.([^.\\/]+)$/.exec(name);
  return match ? match[1].toLowerCase() : '';
}

function imageNameFromSrc(src: string): string {
  if (/^data:image\//i.test(src)) return '生成图片';
  try {
    const url = new URL(src);
    const name = basename(url.pathname);
    return decodeURIComponent(name || '生成图片');
  } catch {
    return decodeURIComponent(basename(src.split(/[?#]/)[0]) || '生成图片');
  }
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || path;
}
