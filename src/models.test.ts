import { describe, expect, it } from 'vitest';
import {
  EFFORT_OPTIONS,
  effortLabel,
  modelProfilesFromCodexCatalog,
  normalizeModelProfile,
  publicModelLabel,
  reasoningEffortOptionsForProfile,
  reconcileModelSelection,
  resolveReasoningEffortForProfile,
  type ModelProfile,
} from './models';
import type { CodexModelCatalogItem } from './types';

const catalog: CodexModelCatalogItem[] = [
  {
    id: 'gpt-5.6-sol',
    displayName: 'GPT-5.6 Sol',
    isDefault: true,
    hidden: false,
    defaultReasoningEffort: 'max',
    supportedReasoningEfforts: [
      { reasoningEffort: 'high', description: 'Thorough' },
      { reasoningEffort: 'max', description: 'Maximum' },
      { reasoningEffort: 'ultra', description: 'Ultra' },
    ],
  },
  {
    id: 'gpt-5.6-terra',
    displayName: 'GPT-5.6 Terra',
    isDefault: false,
    hidden: false,
    defaultReasoningEffort: 'high',
    supportedReasoningEfforts: [
      { reasoningEffort: 'low', description: 'Fast' },
      { reasoningEffort: 'high', description: 'Thorough' },
      { reasoningEffort: 'max', description: 'Maximum' },
    ],
  },
];

describe('Codex model catalog domain', () => {
  it('converts visible catalog items into built-in response profiles in server order', () => {
    const profiles = modelProfilesFromCodexCatalog(catalog);

    expect(profiles.map(({ id, label }) => ({ id, label }))).toEqual([
      { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },
      { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra' },
    ]);
    expect(profiles[0]).toMatchObject({
      providerId: 'openai',
      model: 'gpt-5.6-sol',
      wireApi: 'responses',
      builtIn: true,
      isDefault: true,
      defaultReasoningEffort: 'max',
    });
    expect(profiles[0].supportedReasoningEfforts).not.toBe(catalog[0].supportedReasoningEfforts);
  });

  it('filters hidden entries and falls back to static profiles when no visible entry remains', () => {
    const hidden = catalog.map((item) => ({ ...item, hidden: true }));
    const profiles = modelProfilesFromCodexCatalog(hidden);

    expect(profiles[0].id).toBe('gpt-5.5');
    expect(profiles.some((profile) => profile.id === 'gpt-5.6-sol')).toBe(false);
  });

  it('removes the underlying engine brand from customer-facing model labels', () => {
    expect(publicModelLabel('GPT-5.3-Codex-Spark')).toBe('GPT-5.3-Spark');
    expect(publicModelLabel('Codex GPT-5.3')).toBe('GPT-5.3');
  });

  it('preserves a valid selection and otherwise uses the Codex default', () => {
    const profiles = modelProfilesFromCodexCatalog(catalog);

    expect(reconcileModelSelection({
      profiles,
      selectedModelProfileId: 'gpt-5.6-terra',
      reasoningEffort: 'max',
    })).toEqual({ selectedModelProfileId: 'gpt-5.6-terra', reasoningEffort: 'max' });
    expect(reconcileModelSelection({
      profiles,
      selectedModelProfileId: 'missing',
      reasoningEffort: 'ultra',
    })).toEqual({ selectedModelProfileId: 'gpt-5.6-sol', reasoningEffort: 'ultra' });
  });

  it('preserves provider identity when a Gateway collision changes profile ids', () => {
    const previousGateway: ModelProfile = {
      id: 'gpt-5.6-sol',
      label: 'Sol API',
      providerId: 'alpha-gateway',
      model: 'gpt-5.6-sol',
      wireApi: 'responses',
      enabled: true,
      supportsReasoningEffort: true,
    };
    const profiles = [
      ...modelProfilesFromCodexCatalog(catalog),
      { ...previousGateway, id: 'gateway:gpt-5.6-sol' },
    ];

    expect(reconcileModelSelection({
      profiles,
      selectedModelProfileId: previousGateway.id,
      previousSelectedProfile: previousGateway,
      reasoningEffort: 'xhigh',
    }).selectedModelProfileId).toBe('gateway:gpt-5.6-sol');
  });

  it('clamps unsupported effort to the model default and then first supported effort', () => {
    const profiles = modelProfilesFromCodexCatalog(catalog);

    expect(resolveReasoningEffortForProfile(profiles[1], 'ultra')).toBe('high');
    expect(resolveReasoningEffortForProfile({
      ...profiles[1],
      defaultReasoningEffort: 'ultra',
    }, 'ultra')).toBe('low');
  });

  it('keeps low through xhigh for legacy profiles and labels none, max and ultra', () => {
    const legacy: ModelProfile = {
      id: 'gateway',
      label: 'Gateway',
      providerId: 'alpha-gateway',
      model: 'gateway',
      wireApi: 'responses',
      enabled: true,
      supportsReasoningEffort: true,
    };

    expect(reasoningEffortOptionsForProfile(legacy)).toEqual(EFFORT_OPTIONS);
    expect(reasoningEffortOptionsForProfile(legacy).map((item) => item.id)).toEqual([
      'low', 'medium', 'high', 'xhigh',
    ]);
    expect(effortLabel('max')).toBe('Max');
    expect(effortLabel('none')).toBe('无');
    expect(effortLabel('ultra')).toBe('Ultra');
  });

  it('gives existing custom providers a conservative context window default', () => {
    expect(normalizeModelProfile({
      id: 'deepseek',
      label: 'DeepSeek',
      providerId: 'deepseek',
      model: 'deepseek-chat',
      wireApi: 'chat',
      enabled: true,
      supportsReasoningEffort: false,
    })).toMatchObject({ contextWindowTokens: 64_000 });
  });
});
