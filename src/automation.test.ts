import { beforeEach, describe, expect, it } from 'vitest';
import {
  AUTOMATION_TASKS_KEY,
  addScheduledAutomationTask,
  detectAutomationIntent,
  loadScheduledAutomationTasks,
} from './automation';

describe('automation intent detection', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('parses simple Chinese reminder requests into scheduled tasks', () => {
    const intent = detectAutomationIntent('每隔5分钟提醒我喝水');

    expect(intent).toMatchObject({
      title: '提醒我喝水。',
      prompt: '提醒我喝水。',
      schedule: '每 5 分钟',
      environment: '当前对话',
      project: '选择项目',
    });
  });

  it('does not treat an existing task run prompt as a new automation', () => {
    expect(detectAutomationIntent('请立即执行已安排任务「喝水提醒」。\n原计划：每 5 分钟\n\n提醒我喝水。')).toBeNull();
  });

  it('stores scheduled automation tasks in the shared client storage', () => {
    const task = addScheduledAutomationTask({
      title: '',
      prompt: '提醒我喝水。',
      environment: '当前对话',
      project: '选择项目',
      schedule: '每 5 分钟',
      model: 'GPT-5.5 超高',
    });

    expect(task.title).toBe('提醒我喝水。');
    expect(JSON.parse(window.localStorage.getItem(AUTOMATION_TASKS_KEY) || '[]')).toHaveLength(1);
    expect(loadScheduledAutomationTasks()[0]).toMatchObject({
      prompt: '提醒我喝水。',
      schedule: '每 5 分钟',
    });
  });
});
