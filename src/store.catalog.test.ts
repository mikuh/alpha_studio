import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CodexModelCatalogItem, CodexStatus } from './types';
const bridge = vi.hoisted(() => ({ checkCodex: vi.fn<() => Promise<CodexStatus>>(), listCodexModels: vi.fn<(force: boolean) => Promise<CodexModelCatalogItem[]>>() }));
vi.mock('./codexBridge', () => ({ ...bridge, isTauriRuntime: () => false, loadModelConfig: vi.fn().mockResolvedValue(null), saveModelConfig: vi.fn().mockResolvedValue(null), startCodexChat: vi.fn(), stopCodexChat: vi.fn(), subscribeCodexEvents: vi.fn().mockResolvedValue(() => undefined) }));
import { useChatStore } from './store';
const catalog: CodexModelCatalogItem[] = [{ id:'gpt-dynamic', displayName:'Dynamic', isDefault:true, hidden:false, defaultReasoningEffort:'max', supportedReasoningEfforts:[{ reasoningEffort:'high', description:'' },{ reasoningEffort:'max', description:'' }] }];
const auth: CodexStatus = { installed:true, version:'t', path:'/x', loggedIn:true };
describe('catalog lifecycle', () => {
 beforeEach(() => { window.localStorage.clear(); bridge.checkCodex.mockReset(); bridge.listCodexModels.mockReset(); useChatStore.setState({ codexStatus:null, codexModelCatalog:null, codexModelCatalogError:null, isRefreshingCodexModels:false }); });
 it('startup refreshes false and auth transition/explicit refresh true', async () => { bridge.checkCodex.mockResolvedValue(auth); bridge.listCodexModels.mockResolvedValue(catalog); await useChatStore.getState().refreshCodexStatus(); await useChatStore.getState().refreshCodexStatus({forceModelRefetch:true}); expect(bridge.listCodexModels).toHaveBeenNthCalledWith(1,false); expect(bridge.listCodexModels).toHaveBeenNthCalledWith(2,true); });
 it('guards duplicate requests and retains catalog on failure', async () => { let resolve!: (v: CodexModelCatalogItem[])=>void; bridge.listCodexModels.mockReturnValue(new Promise(r=>{resolve=r;})); const a=useChatStore.getState().refreshCodexModels(false); const b=useChatStore.getState().refreshCodexModels(false); expect(bridge.listCodexModels).toHaveBeenCalledTimes(1); resolve(catalog); await Promise.all([a,b]); bridge.listCodexModels.mockRejectedValue(new Error('offline')); await useChatStore.getState().refreshCodexModels(true); expect(useChatStore.getState().codexModelCatalog).toEqual(catalog); });
 it('clamps unsupported effort atomically', () => { useChatStore.getState().setModelSelection('gpt-5.5','ultra'); expect(useChatStore.getState().reasoningEffort).toBe('max'); });
});
