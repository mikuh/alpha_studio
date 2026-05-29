import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { CodexChatEvent, CodexStatus, SandboxMode } from './types';

export const CODEX_CHAT_EVENT = 'codex-chat-event';

export interface CodexChatStartRequest {
  conversationId: string;
  prompt: string;
  codexThreadId?: string;
  cwd?: string;
  model?: string;
  reasoningEffort?: string;
  sandboxMode?: SandboxMode;
}

export interface CodexChatStartResult {
  runId: string;
}

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function checkCodex(): Promise<CodexStatus> {
  if (!isTauriRuntime()) {
    return {
      installed: false,
      version: 'browser preview',
      path: '',
      loggedIn: false,
      error: '浏览器预览模式不会启动 Codex CLI。请使用 npm run tauri:dev。',
    };
  }
  return invoke<CodexStatus>('codex_check');
}

export async function startCodexChat(request: CodexChatStartRequest): Promise<CodexChatStartResult> {
  return invoke<CodexChatStartResult>('codex_chat_start', { request });
}

export async function stopCodexChat(runId: string): Promise<boolean> {
  const result = await invoke<{ stopped: boolean }>('codex_chat_stop', { request: { runId } });
  return result.stopped;
}

export async function subscribeCodexEvents(
  handler: (event: CodexChatEvent) => void,
): Promise<UnlistenFn | null> {
  if (!isTauriRuntime()) return null;
  return listen<CodexChatEvent>(CODEX_CHAT_EVENT, (event) => {
    handler(event.payload);
  });
}
