export const AUTOMATION_ENVIRONMENT_OPTIONS = ['工作树', '当前对话', '无代码环境'] as const;
export const AUTOMATION_SCHEDULE_OPTIONS = ['每 5 分钟', '每 15 分钟', '每 30 分钟', '每小时', '每天 9:00', '每天 21:00', '每个工作日 10:00', '每周五 17:30', '每周五 9:00'] as const;
export const AUTOMATION_MODEL_OPTIONS = ['GPT-5.5 超高', 'GPT-5.5 高', 'GPT-5.5 标准', 'GPT-5'] as const;
export const AUTOMATION_TASKS_KEY = 'alpha:automation-tasks-v1';
export const AUTOMATION_TASKS_CHANGED_EVENT = 'alpha:automation-tasks-changed';

export interface AutomationFormState {
  title: string;
  prompt: string;
  environment: string;
  project: string;
  schedule: string;
  model: string;
  conversationId?: string;
}

export interface ScheduledAutomationTask extends AutomationFormState {
  id: string;
  createdAt: number;
}

export function blankAutomationForm(): AutomationFormState {
  return {
    title: '',
    prompt: '',
    environment: AUTOMATION_ENVIRONMENT_OPTIONS[0],
    project: '选择项目',
    schedule: AUTOMATION_SCHEDULE_OPTIONS[4],
    model: AUTOMATION_MODEL_OPTIONS[0],
  };
}

export function createScheduledAutomationId(): string {
  return `automation-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function automationTitleFromPrompt(prompt: string): string {
  const compact = prompt.replace(/\s+/g, ' ').trim();
  return compact.length > 18 ? `${compact.slice(0, 18)}...` : compact || '未命名自动化任务';
}

export function loadScheduledAutomationTasks(): ScheduledAutomationTask[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(AUTOMATION_TASKS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<ScheduledAutomationTask>[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isScheduledAutomationTask);
  } catch {
    return [];
  }
}

export function saveScheduledAutomationTasks(tasks: ScheduledAutomationTask[]): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(AUTOMATION_TASKS_KEY, JSON.stringify(tasks));
  window.dispatchEvent(new CustomEvent(AUTOMATION_TASKS_CHANGED_EVENT, { detail: tasks }));
}

export function addScheduledAutomationTask(input: AutomationFormState): ScheduledAutomationTask {
  const prompt = input.prompt.trim();
  const task: ScheduledAutomationTask = {
    ...input,
    id: createScheduledAutomationId(),
    title: input.title.trim() || automationTitleFromPrompt(prompt),
    prompt,
    createdAt: Date.now(),
  };
  saveScheduledAutomationTasks([task, ...loadScheduledAutomationTasks()]);
  return task;
}

export function detectAutomationIntent(message: string): AutomationFormState | null {
  const source = normalizeText(message);
  if (/立即执行已安排任务|原计划[:：]/.test(source)) return null;
  if (!source || !/(提醒|叫我|通知|自动化|定时|每隔|每[0-9一二三四五六七八九十半两]+|每个|每天|每日|每周|每小时|每分钟)/.test(source)) {
    return null;
  }
  const schedule = extractSchedule(source);
  if (!schedule) return null;

  const taskText = extractReminderTask(source);
  if (!taskText) return null;

  const prompt = `提醒我${taskText}。`;
  return {
    title: automationTitleFromPrompt(prompt),
    prompt,
    environment: '当前对话',
    project: '选择项目',
    schedule,
    model: AUTOMATION_MODEL_OPTIONS[0],
  };
}

export function automationCreatedReply(task: ScheduledAutomationTask): string {
  return [
    `已在 Alpha Studio 自动化任务列表中创建「${task.title}」。`,
    '',
    `频率：${task.schedule}`,
    `内容：${task.prompt}`,
    '',
    '你可以在左侧「自动化」里查看、立即执行、编辑或删除。当前客户端会先保存任务配置；到点后台运行和系统通知需要接入调度/通知服务。',
  ].join('\n');
}

function isScheduledAutomationTask(task: Partial<ScheduledAutomationTask>): task is ScheduledAutomationTask {
  return Boolean(
    typeof task.id === 'string' &&
    typeof task.title === 'string' &&
    typeof task.prompt === 'string' &&
    typeof task.environment === 'string' &&
    typeof task.project === 'string' &&
    typeof task.schedule === 'string' &&
    typeof task.model === 'string' &&
    typeof task.createdAt === 'number' &&
    (task.conversationId === undefined || typeof task.conversationId === 'string'),
  );
}

function normalizeText(value: string): string {
  return value
    .replace(/\s+/g, '')
    .replace(/[，。！？!?；;]+$/g, '')
    .trim();
}

function extractSchedule(text: string): string | null {
  const interval = text.match(/每(?:隔)?([0-9０-９一二三四五六七八九十两半]+)(分钟|小时)/);
  if (interval) {
    const count = chineseNumberToInteger(interval[1]);
    if (!count) return null;
    return interval[2] === '小时'
      ? (count === 1 ? '每小时' : `每 ${count} 小时`)
      : `每 ${count} 分钟`;
  }
  if (/每小时/.test(text)) return '每小时';
  if (/每天|每日/.test(text)) return '每天 9:00';
  if (/每周五|每星期五/.test(text)) return '每周五 9:00';
  if (/每周|每星期/.test(text)) return '每周五 9:00';
  return null;
}

function extractReminderTask(text: string): string | null {
  let task = text
    .replace(/^请?(?:你)?(?:帮我|给我|替我)?/, '')
    .replace(/^(?:设置|创建|新增|加一个)?(?:自动化|定时任务|提醒|闹钟)?/, '')
    .replace(/每(?:隔)?[0-9０-９一二三四五六七八九十两半]+(?:分钟|小时)/, '')
    .replace(/(?:每天|每日|每周五|每星期五|每周|每星期)/, '')
    .replace(/^(?:提醒|叫|通知)(?:我)?/, '')
    .replace(/(?:提醒|叫|通知)(?:我)?$/, '')
    .replace(/^(?:我)?/, '')
    .trim();

  if (!task) {
    const match = text.match(/(?:提醒|叫|通知)(?:我)?(.+)$/);
    task = match?.[1] ?? '';
  }
  task = task.replace(/^(?:我)/, '').trim();
  return task || null;
}

function chineseNumberToInteger(value: string): number | null {
  const normalized = value.replace(/[０-９]/g, (char) => String(char.charCodeAt(0) - 0xff10));
  if (/^\d+$/.test(normalized)) return Number.parseInt(normalized, 10);
  if (normalized === '半') return null;
  const digits: Record<string, number> = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  if (normalized === '十') return 10;
  const tenIndex = normalized.indexOf('十');
  if (tenIndex >= 0) {
    const tens = tenIndex === 0 ? 1 : digits[normalized[0]];
    const ones = normalized[tenIndex + 1] ? digits[normalized[tenIndex + 1]] : 0;
    if (!tens && tens !== 0) return null;
    if (ones === undefined) return null;
    return tens * 10 + ones;
  }
  return digits[normalized] ?? null;
}
