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

  it('parses richer recurring schedules with times', () => {
    expect(detectAutomationIntent('每天下午6点提醒我吃饭')).toMatchObject({
      prompt: '提醒我吃饭。',
      schedule: '每天 18:00',
    });
    expect(detectAutomationIntent('每个工作日上午10点提醒我站会')).toMatchObject({
      prompt: '提醒我站会。',
      schedule: '每个工作日 10:00',
    });
    expect(detectAutomationIntent('每周三14:30提醒我复盘')).toMatchObject({
      prompt: '提醒我复盘。',
      schedule: '每周三 14:30',
    });
    expect(detectAutomationIntent('每月最后一天18:00提醒我结算')).toMatchObject({
      prompt: '提醒我结算。',
      schedule: '每月最后一天 18:00',
    });
    expect(detectAutomationIntent('每2天9点提醒我记录体重')).toMatchObject({
      prompt: '提醒我记录体重。',
      schedule: '每 2 天 9:00',
    });
    expect(detectAutomationIntent('每周提醒我复盘')).toMatchObject({
      prompt: '提醒我复盘。',
      schedule: '每周五 9:00',
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
