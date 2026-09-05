import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { listCodexModels, startCodexChat, steerCodexChat, updateCodexCli } from './codexBridge';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
describe('Codex model catalog bridge', () => {
  it('sends steering to the current native run and waits for acknowledgement', async () => {
    const request = { runId: 'run-1', conversationId: 'conv-1', messageId: 'queue-1', prompt: '立即调整方向' };
    vi.mocked(invoke).mockResolvedValueOnce({ accepted: true });
    await expect(steerCodexChat(request)).resolves.toEqual({ accepted: true });
    expect(invoke).toHaveBeenCalledWith('codex_chat_steer', { request });
  });
  beforeEach(() => { Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true }); vi.mocked(invoke).mockResolvedValue([]); });
  afterEach(() => { delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__; vi.clearAllMocks(); });
  it('invokes codex_models with forceRefetch', async () => { await listCodexModels(true); expect(invoke).toHaveBeenCalledWith('codex_models', { request: { forceRefetch: true } }); });
  it('invokes the Codex CLI updater', async () => {
    const result = { previousVersion: 'codex-cli 0.146.1', version: 'codex-cli 0.147.0', path: '/managed/bin/codex', updated: true };
    vi.mocked(invoke).mockResolvedValueOnce(result);

    await expect(updateCodexCli()).resolves.toEqual(result);
    expect(invoke).toHaveBeenCalledWith('codex_update');
  });
  it('returns empty catalog outside Tauri', async () => { delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__; await expect(listCodexModels(false)).resolves.toEqual([]); expect(invoke).not.toHaveBeenCalled(); });
  it('rejects CLI updates outside Tauri', async () => {
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    await expect(updateCodexCli()).rejects.toThrow('浏览器预览模式无法更新 Harness');
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe('Agent network credentials', () => {
  beforeEach(() => { window.localStorage.clear(); vi.mocked(invoke).mockResolvedValue({ runId: 'run' }); });
  afterEach(() => { window.localStorage.clear(); vi.clearAllMocks(); });
  it('passes device authorization only to native runtime, preserving prompt and tool instructions', async () => {
    window.localStorage.setItem('alpha:client-license-session', JSON.stringify({
      apiBaseUrl: 'https://service.example.com', activatedAt: Date.now(),
      tenant: { id: 'tenant' }, user: { id: 'user' },
      device: { id: 'device', accessToken: 'test-device-secret', leaseExpiresAt: '2099-01-01T00:00:00Z' },
    }));
    await startCodexChat({ conversationId: 'c', prompt: 'Read public data', developerInstructions: 'Original instructions' });
    expect(invoke).toHaveBeenCalledWith('codex_chat_start', { request: {
      conversationId: 'c', prompt: 'Read public data', developerInstructions: 'Original instructions',
      agentDataRelay: { apiBaseUrl: 'https://service.example.com', tenantId: 'tenant', deviceId: 'device', accessToken: 'test-device-secret' },
    } });
  });
  it('keeps unactivated sessions working without a relay', async () => {
    await startCodexChat({ conversationId: 'c', prompt: 'hello' });
    expect(invoke).toHaveBeenCalledWith('codex_chat_start', { request: {
      conversationId: 'c', prompt: 'hello', agentDataRelay: undefined,
    } });
  });
});
