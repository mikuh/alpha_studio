export const AUTOMATION_ENVIRONMENT_OPTIONS = ['工作树', '当前对话', '无代码环境'] as const;
export const CUSTOM_AUTOMATION_SCHEDULE_VALUE = '自定义';
export const AUTOMATION_SCHEDULE_OPTIONS = [
  '每 5 分钟',
  '每 10 分钟',
  '每 15 分钟',
  '每 30 分钟',
  '每小时',
  '每 2 小时',
  '每 3 小时',
  '每 6 小时',
  '每 12 小时',
  '每天 8:00',
  '每天 9:00',
  '每天 12:00',
  '每天 18:00',
  '每天 21:00',
  '每个工作日 9:00',
  '每个工作日 10:00',
  '每个工作日 18:00',
  '每周一 9:00',
  '每周三 14:00',
  '每周五 9:00',
  '每周五 17:30',
  '每周日 20:00',
  '每月 1 日 9:00',
  '每月 15 日 9:00',
  '每月最后一天 18:00',
  '每季度第一个工作日 9:00',
  '每年 1 月 1 日 9:00',
  CUSTOM_AUTOMATION_SCHEDULE_VALUE,
] as const;
export const DEFAULT_AUTOMATION_SCHEDULE = '每天 9:00';
export const AUTOMATION_MODEL_OPTIONS = ['GPT-5.5 超高', 'GPT-5.5 高', 'GPT-5.5 标准', 'GPT-5'] as const;
export const DEFAULT_AUTOMATION_MODEL = AUTOMATION_MODEL_OPTIONS[0];
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
    schedule: DEFAULT_AUTOMATION_SCHEDULE,
    model: DEFAULT_AUTOMATION_MODEL,
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
  if (
    !source ||
    !/(提醒|叫我|通知|自动化|定时|每隔|每[0-9一二三四五六七八九十半两]+|每个|每天|每日|每周|每星期|每月|每季度|每年|每小时|每分钟|工作日)/.test(source)
  ) {
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
    model: DEFAULT_AUTOMATION_MODEL,
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
  if (/每(?:隔)?半小时/.test(text)) return '每 30 分钟';

  const interval = text.match(/每(?:隔)?([0-9０-９一二三四五六七八九十两]+)(分钟|小时|天|周|星期|月)/);
  if (interval) {
    const count = chineseNumberToInteger(interval[1]);
    if (!count) return null;
    return formatIntervalSchedule(count, interval[2], extractTime(text));
  }

  if (/每分钟/.test(text)) return '每 1 分钟';
  if (/每小时/.test(text)) return '每小时';

  const time = extractTime(text);
  if (/每(?:个)?工作日|工作日/.test(text)) return `每个工作日 ${time ?? '9:00'}`;

  const weekday = extractWeekday(text);
  if (weekday) return `每周${weekday} ${time ?? '9:00'}`;
  if (/每周|每星期/.test(text)) return `每周五 ${time ?? '9:00'}`;

  if (/每月/.test(text)) {
    if (/月底|月末|最后(?:一天|一日|1天|1日)/.test(text)) return `每月最后一天 ${time ?? '18:00'}`;
    const day = extractMonthDay(text) ?? 1;
    return `每月 ${day} 日 ${time ?? '9:00'}`;
  }

  if (/每季度|每季/.test(text)) {
    const anchor = /工作日/.test(text) ? '第一个工作日' : '第一天';
    return `每季度${anchor} ${time ?? '9:00'}`;
  }

  if (/每年/.test(text)) {
    const date = extractYearDate(text);
    return `每年 ${date?.month ?? 1} 月 ${date?.day ?? 1} 日 ${time ?? '9:00'}`;
  }

  if (/每天|每日/.test(text)) return `每天 ${time ?? '9:00'}`;

  return null;
}

function extractReminderTask(text: string): string | null {
  let task = text
    .replace(/^请?(?:你)?(?:帮我|给我|替我)?/, '')
    .replace(/^(?:设置|创建|新增|加一个)?(?:自动化|定时任务|提醒|闹钟)?/, '')
    .replace(/每(?:隔)?(?:半小时|分钟|小时|[0-9０-９一二三四五六七八九十两]+(?:分钟|小时|天|周|星期|月))/, '')
    .replace(/每年[0-9０-９一二三四五六七八九十两]+月[0-9０-９一二三四五六七八九十两]+(?:日|号)?/, '')
    .replace(/每月(?:最后(?:一天|一日|1天|1日)|[0-9０-９一二三四五六七八九十两]+(?:日|号))?/, '')
    .replace(/每季度(?:第一个工作日|第一天)?/, '')
    .replace(/(?:每个工作日|工作日|每天|每日|每周[一二三四五六日天1-7]?|每星期[一二三四五六日天1-7]?)/, '')
    .replace(/(?:凌晨|早上|上午|中午|下午|晚上|傍晚)?[0-9０-９一二三四五六七八九十两]+点(?:半|[0-5]?\d分?|[一二三四五六七八九十]+分?)?/, '')
    .replace(/[0-2]?[0-9][:：][0-5][0-9]/, '')
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
    零: 0,
    〇: 0,
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

function formatIntervalSchedule(count: number, unit: string, time?: string | null): string {
  if (unit === '分钟') return `每 ${count} 分钟`;
  if (unit === '小时') return count === 1 ? '每小时' : `每 ${count} 小时`;
  if (unit === '天') return count === 1 ? `每天 ${time ?? '9:00'}` : `每 ${count} 天${time ? ` ${time}` : ''}`;
  if (unit === '月') return count === 1 ? `每月 1 日 ${time ?? '9:00'}` : `每 ${count} 个月${time ? ` ${time}` : ''}`;
  return count === 1 ? `每周五 ${time ?? '9:00'}` : `每 ${count} 周${time ? ` ${time}` : ''}`;
}

function extractTime(text: string): string | null {
  const digital = text.match(/([01]?\d|2[0-3])[:：]([0-5]\d)/);
  if (digital) return `${Number.parseInt(digital[1], 10)}:${digital[2]}`;

  const chinese = text.match(/(凌晨|早上|上午|中午|下午|晚上|傍晚)?([0-9０-９一二三四五六七八九十两]+)点(?:(半)|([0-5]?\d|[一二三四五六七八九十两]+)分?)?/);
  if (!chinese) return null;

  const hourValue = chineseNumberToInteger(chinese[2]);
  if (hourValue === null || hourValue > 24) return null;
  let hour = hourValue;
  const period = chinese[1] ?? '';
  if (/下午|晚上|傍晚/.test(period) && hour < 12) hour += 12;
  if (/中午/.test(period) && hour > 0 && hour < 11) hour += 12;
  if (/凌晨|上午|早上/.test(period) && hour === 12) hour = 0;
  if (hour === 24) hour = 0;

  let minute = 0;
  if (chinese[3]) {
    minute = 30;
  } else if (chinese[4]) {
    const minuteValue = chineseNumberToInteger(chinese[4]);
    if (minuteValue === null || minuteValue > 59) return null;
    minute = minuteValue;
  }

  return `${hour}:${minute.toString().padStart(2, '0')}`;
}

function extractWeekday(text: string): string | null {
  const match = text.match(/每(?:周|星期)([一二三四五六日天1-7])/);
  if (!match) return null;
  const weekdays: Record<string, string> = {
    '1': '一',
    '2': '二',
    '3': '三',
    '4': '四',
    '5': '五',
    '6': '六',
    '7': '日',
    一: '一',
    二: '二',
    三: '三',
    四: '四',
    五: '五',
    六: '六',
    日: '日',
    天: '日',
  };
  return weekdays[match[1]] ?? null;
}

function extractMonthDay(text: string): number | null {
  const match = text.match(/每月(?:第)?([0-9０-９一二三四五六七八九十两]+)(?:日|号)/);
  if (!match) return null;
  const day = chineseNumberToInteger(match[1]);
  return day && day >= 1 && day <= 31 ? day : null;
}

function extractYearDate(text: string): { month: number; day: number } | null {
  const match = text.match(/每年([0-9０-９一二三四五六七八九十两]+)月([0-9０-９一二三四五六七八九十两]+)(?:日|号)?/);
  if (!match) return null;
  const month = chineseNumberToInteger(match[1]);
  const day = chineseNumberToInteger(match[2]);
  if (!month || month < 1 || month > 12 || !day || day < 1 || day > 31) return null;
  return { month, day };
}
