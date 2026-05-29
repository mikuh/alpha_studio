export interface ModelOption {
  id: string;
  label: string;
}

export const MODEL_OPTIONS: ModelOption[] = [
  { id: 'gpt-5.5', label: 'GPT-5.5' },
  { id: 'gpt-5.4', label: 'GPT-5.4' },
  { id: 'gpt-5.4-mini', label: 'GPT-5.4-Mini' },
  { id: 'gpt-5.3-codex', label: 'GPT-5.3-Codex' },
  { id: 'gpt-5.3-codex-spark', label: 'GPT-5.3-Codex-Spark' },
  { id: 'gpt-5.2', label: 'GPT-5.2' },
];

export const DEFAULT_MODEL = 'gpt-5.5';

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
