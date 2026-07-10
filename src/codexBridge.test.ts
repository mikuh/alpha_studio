import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { listCodexModels } from './codexBridge';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
describe('Codex model catalog bridge', () => {
  beforeEach(() => { Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true }); vi.mocked(invoke).mockResolvedValue([]); });
  afterEach(() => { delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__; vi.clearAllMocks(); });
  it('invokes codex_models with forceRefetch', async () => { await listCodexModels(true); expect(invoke).toHaveBeenCalledWith('codex_models', { request: { forceRefetch: true } }); });
  it('returns empty catalog outside Tauri', async () => { delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__; await expect(listCodexModels(false)).resolves.toEqual([]); expect(invoke).not.toHaveBeenCalled(); });
});
