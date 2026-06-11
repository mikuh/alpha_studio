import type { SandboxMode } from './types';

export interface ModelOption {
  id: string;
  label: string;
}

export type ModelWireApi = 'chat' | 'responses';

export interface ModelProfile {
  id: string;
  label: string;
  providerId: string;
  model: string;
  wireApi: ModelWireApi;
  baseUrl?: string;
  apiKey?: string;
  enabled: boolean;
  supportsReasoningEffort: boolean;
  builtIn?: boolean;
}

export type ModelProfileDraft = Omit<ModelProfile, 'id' | 'builtIn'>;

export const BUILTIN_MODEL_PROFILES: ModelProfile[] = [
  { id: 'gpt-5.5', label: 'GPT-5.5', providerId: 'openai', model: 'gpt-5.5', wireApi: 'responses', enabled: true, supportsReasoningEffort: true, builtIn: true },
  { id: 'gpt-5.4', label: 'GPT-5.4', providerId: 'openai', model: 'gpt-5.4', wireApi: 'responses', enabled: true, supportsReasoningEffort: true, builtIn: true },
  { id: 'gpt-5.4-mini', label: 'GPT-5.4-Mini', providerId: 'openai', model: 'gpt-5.4-mini', wireApi: 'responses', enabled: true, supportsReasoningEffort: true, builtIn: true },
  { id: 'gpt-5.3-codex', label: 'GPT-5.3-Codex', providerId: 'openai', model: 'gpt-5.3-codex', wireApi: 'responses', enabled: true, supportsReasoningEffort: true, builtIn: true },
  { id: 'gpt-5.3-codex-spark', label: 'GPT-5.3-Codex-Spark', providerId: 'openai', model: 'gpt-5.3-codex-spark', wireApi: 'responses', enabled: true, supportsReasoningEffort: true, builtIn: true },
  { id: 'gpt-5.2', label: 'GPT-5.2', providerId: 'openai', model: 'gpt-5.2', wireApi: 'responses', enabled: true, supportsReasoningEffort: true, builtIn: true },
];

export const MODEL_OPTIONS: ModelOption[] = BUILTIN_MODEL_PROFILES.map(({ id, label }) => ({ id, label }));

export const DEFAULT_MODEL_PROFILE_ID = 'gpt-5.5';
export const DEFAULT_MODEL = DEFAULT_MODEL_PROFILE_ID;

export function defaultModelProfiles(): ModelProfile[] {
  return BUILTIN_MODEL_PROFILES.map((profile) => ({ ...profile }));
}

export function normalizeModelProfiles(source: unknown, legacyModel?: unknown): ModelProfile[] {
  const builtIns = defaultModelProfiles();
  const custom = Array.isArray(source)
    ? source
        .map((item) => normalizeModelProfile(item))
        .filter((item): item is ModelProfile => Boolean(item && !item.builtIn))
    : [];
  const profiles = dedupeModelProfiles([...builtIns, ...custom]);
  const legacy = typeof legacyModel === 'string' ? legacyModel.trim() : '';
  if (legacy && !profiles.some((profile) => profile.id === legacy || profile.model === legacy)) {
    profiles.push({
      id: modelProfileIdFromLegacyModel(legacy),
      label: legacy,
      providerId: 'openai',
      model: legacy,
      wireApi: 'responses',
      enabled: true,
      supportsReasoningEffort: true,
    });
  }
  return profiles;
}

export function selectedModelProfileId(source: unknown, profiles: ModelProfile[], legacyModel?: unknown): string {
  const selected = typeof source === 'string' ? source.trim() : '';
  if (selected && profiles.some((profile) => profile.id === selected && profile.enabled)) return selected;
  const legacy = typeof legacyModel === 'string' ? legacyModel.trim() : '';
  if (legacy) {
    const match = profiles.find((profile) => (profile.id === legacy || profile.model === legacy) && profile.enabled);
    if (match) return match.id;
  }
  return profiles.find((profile) => profile.enabled)?.id ?? DEFAULT_MODEL_PROFILE_ID;
}

export function resolveModelProfile(profiles: ModelProfile[], id: string): ModelProfile {
  return (
    profiles.find((profile) => profile.id === id && profile.enabled) ??
    profiles.find((profile) => profile.enabled) ??
    BUILTIN_MODEL_PROFILES[0]
  );
}

export function modelProfileLabel(profiles: ModelProfile[], id: string): string {
  return resolveModelProfile(profiles, id).label;
}

export function shortModelProfileLabel(profiles: ModelProfile[], id: string): string {
  return modelProfileLabel(profiles, id).replace(/^GPT-/i, '');
}

export function normalizeModelProfile(value: unknown): ModelProfile | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const id = typeof source.id === 'string' ? source.id.trim() : '';
  const label = typeof source.label === 'string' ? source.label.trim() : '';
  const providerId = normalizeProviderId(source.providerId);
  const model = typeof source.model === 'string' ? source.model.trim() : '';
  if (!id || !label || !providerId || !model) return null;
  const wireApi = source.wireApi === 'chat' ? 'chat' : 'responses';
  const baseUrl = optionalTrimmedString(source.baseUrl);
  const apiKey = optionalTrimmedString(source.apiKey);
  const builtIn = Boolean(source.builtIn) && BUILTIN_MODEL_PROFILES.some((profile) => profile.id === id);
  return {
    id,
    label,
    providerId: builtIn ? 'openai' : providerId,
    model,
    wireApi: builtIn ? 'responses' : wireApi,
    baseUrl: builtIn ? undefined : baseUrl,
    apiKey: builtIn ? undefined : apiKey,
    enabled: source.enabled !== false,
    supportsReasoningEffort: source.supportsReasoningEffort === true,
    builtIn: builtIn || undefined,
  };
}

export function normalizeModelProfileDraft(value: ModelProfileDraft): ModelProfileDraft {
  const providerId = normalizeProviderId(value.providerId) || 'custom';
  return {
    label: value.label.trim() || value.model.trim() || providerId,
    providerId,
    model: value.model.trim(),
    wireApi: value.wireApi === 'chat' ? 'chat' : 'responses',
    baseUrl: optionalTrimmedString(value.baseUrl),
    apiKey: optionalTrimmedString(value.apiKey),
    enabled: value.enabled !== false,
    supportsReasoningEffort: value.supportsReasoningEffort === true,
  };
}

export function stripModelProfileSecrets(profiles: ModelProfile[]): ModelProfile[] {
  return profiles.map((profile) => ({ ...profile, apiKey: undefined }));
}

export function normalizeProviderId(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function optionalTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function dedupeModelProfiles(profiles: ModelProfile[]): ModelProfile[] {
  const seen = new Set<string>();
  const result: ModelProfile[] = [];
  for (const profile of profiles) {
    if (seen.has(profile.id)) continue;
    seen.add(profile.id);
    result.push(profile);
  }
  return result;
}

function modelProfileIdFromLegacyModel(model: string): string {
  const slug = model
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `legacy-${slug || 'model'}`;
}

export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh';

export interface EffortOption {
  id: ReasoningEffort;
  label: string;
}

export const EFFORT_OPTIONS: EffortOption[] = [
  { id: 'low', label: '低' },
  { id: 'medium', label: '中' },
  { id: 'high', label: '高' },
  { id: 'xhigh', label: '超高' },
];

export const DEFAULT_EFFORT: ReasoningEffort = 'xhigh';

export type Speed = 'standard' | 'fast';

export interface SpeedOption {
  id: Speed;
  label: string;
  description: string;
  fast?: boolean;
}

export const SPEED_OPTIONS: SpeedOption[] = [
  { id: 'standard', label: '标准', description: '默认速度' },
  { id: 'fast', label: '快速', description: '1.5x speed, increased usage', fast: true },
];

export const DEFAULT_SPEED: Speed = 'standard';

export function modelLabel(id: string): string {
  return MODEL_OPTIONS.find((model) => model.id === id)?.label ?? id;
}

export function shortModelLabel(id: string): string {
  return modelLabel(id).replace(/^GPT-/i, '');
}

export function effortLabel(id: string): string {
  return EFFORT_OPTIONS.find((effort) => effort.id === id)?.label ?? id;
}

export type ApprovalMode = 'request' | 'auto' | 'full-access';

export interface ApprovalOption {
  id: ApprovalMode;
  label: string;
  title: string;
  description: string;
}

export const APPROVAL_OPTIONS: ApprovalOption[] = [
  {
    id: 'request',
    label: '请求批准',
    title: '请求批准',
    description: '编辑外部文件和使用互联网时始终询问',
  },
  {
    id: 'auto',
    label: '替我审批',
    title: '替我审批',
    description: '仅对检测到的风险操作请求批准',
  },
  {
    id: 'full-access',
    label: '完全访问',
    title: '完全访问权限',
    description: '不受限制访问互联网和您电脑上的任何文件',
  },
];

export const DEFAULT_APPROVAL: ApprovalMode = 'request';

export function isApprovalMode(value: unknown): value is ApprovalMode {
  return value === 'request' || value === 'auto' || value === 'full-access';
}

export function approvalLabel(id: ApprovalMode): string {
  return APPROVAL_OPTIONS.find((option) => option.id === id)?.label ?? id;
}

export function approvalTitle(id: ApprovalMode): string {
  return APPROVAL_OPTIONS.find((option) => option.id === id)?.title ?? id;
}

export function approvalDescription(id: ApprovalMode): string {
  return APPROVAL_OPTIONS.find((option) => option.id === id)?.description ?? '';
}

// The selected approval mode determines the real `--sandbox` policy handed to the
// local execution process. `request` always pauses for explicit user authorization, so
// its base value is only a fallback; the granted scope comes from the dialog.
export function baseSandboxForApproval(mode: ApprovalMode): SandboxMode {
  switch (mode) {
    case 'full-access':
      return 'danger-full-access';
    case 'auto':
      return 'workspace-write';
    case 'request':
    default:
      return 'workspace-write';
  }
}

export function approvalRequiresPrompt(mode: ApprovalMode): boolean {
  return mode === 'request';
}

// Maps the legacy persisted sandbox mode onto the new approval model.
export function sandboxToApproval(value: unknown): ApprovalMode {
  switch (value) {
    case 'danger-full-access':
      return 'full-access';
    case 'workspace-write':
      return 'auto';
    case 'read-only':
      return 'request';
    default:
      return DEFAULT_APPROVAL;
  }
}
