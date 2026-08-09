import type { ChatMessage, Conversation, MessageAttachment, MessageBlock } from './types';

export const DEFAULT_CONTEXT_WINDOW_TOKENS = 258_000;
export const CONTEXT_COMPACT_THRESHOLD_RATIO = 0.82;
export const CUSTOM_MODEL_COMPACT_THRESHOLD_RATIO = 0.75;

const CONTEXT_RECENT_MESSAGE_KEEP_COUNT = 8;
const CONTEXT_MIN_RECENT_MESSAGE_KEEP_COUNT = 2;
const SUMMARY_TOKEN_TARGET = 12_000;
const SYSTEM_CONTEXT_OVERHEAD_TOKENS = 1_200;

export interface ContextWindowUsage {
  usedTokens: number;
  totalTokens: number;
  remainingTokens: number;
  usedPercent: number;
  remainingPercent: number;
  compactThresholdTokens: number;
  compactThresholdPercent: number;
  shouldCompact: boolean;
  compacted: boolean;
  compactedMessageCount: number;
  source: 'codex' | 'local-estimate';
}

export interface PreparedConversationContext {
  conversation: Conversation;
  promptContext?: string;
  compacted: boolean;
}

export interface PrepareConversationContextOptions {
  contextWindowTokens?: number;
  compactResumableThread?: boolean;
}

export function contextWindowUsage(conversation: Conversation): ContextWindowUsage {
  const codexUsage = codexContextWindowUsage(conversation);
  const source = codexUsage ? 'codex' : 'local-estimate';
  const totalTokens = codexUsage?.totalTokens ?? DEFAULT_CONTEXT_WINDOW_TOKENS;
  const usedTokens = Math.max(0, codexUsage?.usedTokens ?? estimateConversationBackgroundTokens(conversation));
  const remainingTokens = Math.max(0, totalTokens - usedTokens);
  const compactThresholdTokens = Math.floor(totalTokens * CONTEXT_COMPACT_THRESHOLD_RATIO);
  const usedPercent = percentOf(usedTokens, totalTokens);
  const compacted = Boolean(conversation.backgroundContext || conversation.codexCompactedAt);
  return {
    usedTokens,
    totalTokens,
    remainingTokens,
    usedPercent,
    remainingPercent: Math.max(0, 100 - usedPercent),
    compactThresholdTokens,
    compactThresholdPercent: Math.round(CONTEXT_COMPACT_THRESHOLD_RATIO * 100),
    shouldCompact: codexUsage ? usedTokens >= compactThresholdTokens : shouldCompactConversation(conversation),
    compacted,
    compactedMessageCount: conversation.backgroundContext?.sourceMessageCount ?? 0,
    source,
  };
}

export function prepareConversationForOutgoingTurn(
  conversation: Conversation,
  options: PrepareConversationContextOptions = {},
): PreparedConversationContext {
  const contextWindowTokens = finitePositiveNumber(options.contextWindowTokens) ?? DEFAULT_CONTEXT_WINDOW_TOKENS;
  const compactThresholdRatio = options.compactResumableThread
    ? CUSTOM_MODEL_COMPACT_THRESHOLD_RATIO
    : CONTEXT_COMPACT_THRESHOLD_RATIO;
  const minimumRecentMessageCount = options.compactResumableThread
    ? 1
    : CONTEXT_MIN_RECENT_MESSAGE_KEEP_COUNT;
  const canUseLocalCompaction = !conversation.codexThreadId || options.compactResumableThread === true;
  const shouldUseLocalCompaction = canUseLocalCompaction
    && shouldCompactConversation(
      conversation,
      contextWindowTokens,
      compactThresholdRatio,
      minimumRecentMessageCount,
    );
  const compactedConversation = shouldUseLocalCompaction
    ? compactConversation(conversation, contextWindowTokens, minimumRecentMessageCount)
    : conversation;
  const compacted = compactedConversation !== conversation;
  const needsPromptContext = compacted || !compactedConversation.codexThreadId;
  const promptContext = needsPromptContext
    ? buildBackgroundPromptContext(compactedConversation)
    : undefined;
  return {
    conversation: compactedConversation,
    promptContext,
    compacted,
  };
}

export function addBackgroundContextToPrompt(prompt: string, context?: string): string {
  const cleanPrompt = prompt.trim();
  const cleanContext = context?.trim();
  if (!cleanContext) return cleanPrompt;
  return [cleanContext, '', '当前用户消息：', cleanPrompt].join('\n');
}

export function messagesForActiveBackground(conversation: Conversation): ChatMessage[] {
  const start = conversation.backgroundContext?.sourceMessageCount ?? 0;
  return conversation.messages.slice(Math.min(start, conversation.messages.length));
}

export function estimateMessageTokens(message: ChatMessage): number {
  const roleOverhead = 6;
  const attachmentTokens = estimateAttachmentsTokens(message.attachments);
  return roleOverhead + attachmentTokens + estimateTextTokens(messageBlocksToContextText(message.blocks));
}

export function estimateTextTokens(text: string): number {
  if (!text) return 0;
  let asciiRun = 0;
  let nonAscii = 0;
  let whitespace = 0;
  for (const char of text) {
    if (/\s/.test(char)) {
      whitespace += 1;
    } else if (char.charCodeAt(0) <= 0x7f) {
      asciiRun += 1;
    } else {
      nonAscii += 1;
    }
  }
  const asciiTokens = Math.ceil(asciiRun / 4);
  const nonAsciiTokens = Math.ceil(nonAscii * 0.75);
  const whitespaceTokens = Math.ceil(whitespace / 16);
  return Math.max(1, asciiTokens + nonAsciiTokens + whitespaceTokens);
}

export function formatTokenCount(tokens: number): string {
  const value = Math.max(0, Math.round(tokens));
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return `${formatCompactNumber(millions)}m`;
  }
  if (value >= 1_000) {
    const thousands = value / 1_000;
    return `${formatCompactNumber(thousands)}k`;
  }
  return `${value}`;
}

export function buildBackgroundPromptContext(conversation: Conversation): string | undefined {
  const sections: string[] = [];
  const summary = conversation.backgroundContext?.summary.trim();
  if (summary) {
    sections.push([
      '压缩背景摘要（替代更早的原始历史）：',
      summary,
    ].join('\n'));
  }

  const activeMessages = messagesForActiveBackground(conversation);
  if (activeMessages.length) {
    sections.push([
      '最近仍按原文保留的历史：',
      ...activeMessages.map((message, index) => transcriptMessage(message, index + 1)).filter(Boolean),
    ].join('\n'));
  }

  if (sections.length === 0) return undefined;
  return [
    '以下是当前对话的背景上下文。它来自 Alpha Studio 的本地上下文窗口管理；请把它当作本次任务的长期背景，不要把它误认为用户刚刚提出的新要求。',
    ...sections,
  ].join('\n\n');
}

function shouldCompactConversation(
  conversation: Conversation,
  contextWindowTokens = DEFAULT_CONTEXT_WINDOW_TOKENS,
  compactThresholdRatio = CONTEXT_COMPACT_THRESHOLD_RATIO,
  minimumRecentMessageCount = CONTEXT_MIN_RECENT_MESSAGE_KEEP_COUNT,
): boolean {
  if (conversation.status === 'streaming') return false;
  const activeMessages = messagesForActiveBackground(conversation);
  if (activeMessages.length <= minimumRecentMessageCount) return false;
  const measuredTokens = finitePositiveNumber(conversation.codexTokenUsage?.last?.totalTokens) ?? 0;
  const usage = Math.max(measuredTokens, estimateConversationBackgroundTokens(conversation));
  return usage >= contextWindowTokens * compactThresholdRatio;
}

function compactConversation(
  conversation: Conversation,
  contextWindowTokens: number,
  minimumRecentMessageCount: number,
): Conversation {
  const cutIndex = compactCutIndex(conversation, minimumRecentMessageCount);
  if (cutIndex <= (conversation.backgroundContext?.sourceMessageCount ?? 0)) return conversation;
  const sourceMessages = conversation.messages.slice(
    conversation.backgroundContext?.sourceMessageCount ?? 0,
    cutIndex,
  );
  const summary = summarizeBackgroundContext(
    conversation.backgroundContext?.summary,
    sourceMessages,
    summaryTokenTarget(contextWindowTokens),
  );
  const now = Date.now();
  return {
    ...conversation,
    codexThreadId: undefined,
    codexTokenUsage: undefined,
    codexCompactedAt: undefined,
    backgroundContext: {
      summary,
      sourceMessageCount: cutIndex,
      sourceTokenEstimate: estimateMessagesTokens(sourceMessages),
      summaryTokenEstimate: estimateTextTokens(summary),
      compactedAt: now,
      updatedAt: now,
    },
    updatedAt: now,
  };
}

function compactCutIndex(
  conversation: Conversation,
  minimumRecentMessageCount = CONTEXT_MIN_RECENT_MESSAGE_KEEP_COUNT,
): number {
  const start = conversation.backgroundContext?.sourceMessageCount ?? 0;
  const activeCount = conversation.messages.length - start;
  if (activeCount <= minimumRecentMessageCount) return start;
  const keep = Math.min(
    CONTEXT_RECENT_MESSAGE_KEEP_COUNT,
    Math.max(minimumRecentMessageCount, activeCount - 1),
  );
  return Math.max(start + 1, conversation.messages.length - keep);
}

function estimateConversationBackgroundTokens(conversation: Conversation): number {
  const summaryTokens = conversation.backgroundContext?.summaryTokenEstimate
    ?? estimateTextTokens(conversation.backgroundContext?.summary ?? '');
  return SYSTEM_CONTEXT_OVERHEAD_TOKENS + summaryTokens + estimateMessagesTokens(messagesForActiveBackground(conversation));
}

function codexContextWindowUsage(conversation: Conversation): { usedTokens: number; totalTokens: number } | null {
  const usage = conversation.codexTokenUsage;
  if (!usage) return null;
  const usedTokens = finitePositiveNumber(usage.last?.totalTokens);
  const totalTokens = finitePositiveNumber(usage.modelContextWindow) ?? DEFAULT_CONTEXT_WINDOW_TOKENS;
  if (usedTokens === null) return null;
  return { usedTokens, totalTokens };
}

function finitePositiveNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return Math.round(value);
}

function estimateMessagesTokens(messages: ChatMessage[]): number {
  return messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0);
}

function estimateAttachmentsTokens(attachments?: MessageAttachment[]): number {
  if (!attachments?.length) return 0;
  return attachments.reduce((sum, attachment) => {
    const labelTokens = estimateTextTokens([attachment.name, attachment.path, attachment.ext].filter(Boolean).join(' '));
    return sum + labelTokens + (attachment.kind === 'image' ? 180 : 40);
  }, 0);
}

function summarizeBackgroundContext(
  existingSummary: string | undefined,
  messages: ChatMessage[],
  tokenTarget = SUMMARY_TOKEN_TARGET,
): string {
  const sections: string[] = [];
  if (existingSummary?.trim()) {
    sections.push(`既有压缩摘要：\n${clampText(existingSummary.trim(), 5_000)}`);
  }

  const messageLines = messages
    .map((message, index) => summarizeMessage(message, index + 1))
    .filter(Boolean);
  if (messageLines.length) {
    sections.push(['本次新增压缩的可见对话：', ...messageLines].join('\n'));
  }

  return clampSummary(sections.join('\n\n').trim(), tokenTarget);
}

function summarizeMessage(message: ChatMessage, index: number): string {
  const role = message.role === 'user' ? '用户' : 'Alpha Studio';
  const text = messageBlocksToContextText(message.blocks);
  const attachments = message.attachments?.length
    ? ` 附件：${message.attachments.map((item) => item.path || item.name).join('；')}`
    : '';
  const body = clampText(text || attachments.trim(), 1_200);
  if (!body && !attachments) return '';
  return `${index}. ${role}：${body}${attachments && !body.includes('附件：') ? attachments : ''}`;
}

function transcriptMessage(message: ChatMessage, index: number): string {
  const role = message.role === 'user' ? '用户' : 'Alpha Studio';
  const text = messageBlocksToContextText(message.blocks);
  const attachments = message.attachments?.length
    ? `\n附件：${message.attachments.map((item) => item.path || item.name).join('；')}`
    : '';
  const body = clampText(`${text}${attachments}`, 2_400);
  if (!body) return '';
  return `${index}. ${role}：${body}`;
}

function messageBlocksToContextText(blocks: MessageBlock[]): string {
  return blocks
    .map((block) => {
      if (block.type === 'text' || block.type === 'error') return block.content;
      if (block.type === 'thinking') return '';
      if (block.type === 'tool') {
        const parts = [
          block.title ? `工具：${block.title}` : '',
          block.target ? `目标：${block.target}` : '',
          block.input ? `输入：${firstLines(block.input, 4)}` : '',
          block.output ? `输出：${firstLines(block.output, 8)}` : '',
        ];
        return parts.filter(Boolean).join('\n');
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
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function firstLines(text: string, count: number): string {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, count)
    .join('\n');
}

function clampSummary(summary: string, tokenTarget = SUMMARY_TOKEN_TARGET): string {
  let next = summary;
  while (estimateTextTokens(next) > tokenTarget && next.length > 1_000) {
    next = next.slice(Math.floor(next.length * 0.12));
    const lineStart = next.indexOf('\n');
    if (lineStart > 0) next = next.slice(lineStart + 1);
    next = `（前序压缩摘要过长，已继续保留最近关键内容。）\n${next.trim()}`;
  }
  return next;
}

function summaryTokenTarget(contextWindowTokens: number): number {
  return Math.min(SUMMARY_TOKEN_TARGET, Math.max(2_000, Math.floor(contextWindowTokens * 0.08)));
}

function clampText(text: string, maxLength: number): string {
  const compact = text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength).trimEnd()}...`;
}

function percentOf(value: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((value / total) * 100)));
}

function formatCompactNumber(value: number): string {
  if (value >= 100) return `${Math.round(value)}`;
  if (value >= 10) return `${Math.round(value)}`;
  return value.toFixed(1).replace(/\.0$/, '');
}
