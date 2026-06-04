import type { SandboxMode } from './types';

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
// Codex CLI process. `request` always pauses for explicit user authorization, so
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
