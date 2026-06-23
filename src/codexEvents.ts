import type { ChatMessage, CodexChatEvent, Conversation, FileResultBlock, ImageResultBlock, MessageBlock, ToolBlock } from './types';

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
    const completedBlocks = blocks.map((block) => {
      if (block.type !== 'tool' || block.id !== toolId) return block;
      return {
        ...block,
        status: 'completed' as const,
        output: event.text || block.output,
      };
    });
    const imageResult = imageResultFromToolEvent(event, toolId);
    const fileResult = fileResultFromToolEvent(event, toolId);
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
const GENERATED_FILE_HINT_PATTERN = /\b(?:generated|created|saved|wrote|written|exported|output|file|path)\b|(?:生成|已生成|创建|已创建|保存|已保存|输出|文件|保存位置)/i;

function imageResultFromToolEvent(event: CodexChatEvent, toolId: string): ImageResultBlock | null {
  if (!isImageGenerationTool(event)) return null;
  const candidates = [
    ...extractImageCandidatesFromText(event.text || ''),
    ...extractImageCandidatesFromUnknown(event.raw),
  ];
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

function fileResultFromToolEvent(event: CodexChatEvent, toolId: string): FileResultBlock | null {
  const candidates = [
    ...extractGeneratedFileCandidatesFromText(event.text || ''),
    ...extractGeneratedFileCandidatesFromUnknown(event.raw),
  ];
  const unique = uniqueFileCandidates(candidates);
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
    candidates.push(...extractFileCandidatesFromText(line));
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
