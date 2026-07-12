import { describe, expect, it } from 'vitest';
import type { Conversation } from './types';
import {
  ALPHA_STUDIO_INTRADAY_MONITOR_SKILL_ID,
  ALPHA_STUDIO_REPORT_REVIEW_SKILL_ID,
  addThemeAbilityContext,
  inferThemeAbilitySkill,
} from './themeAbilities';

const now = new Date('2026-07-13T08:00:00.000Z').getTime();

function conversation(id: string, messages: Conversation['messages']): Conversation {
  return {
    id,
    title: id,
    messages,
    cwd: '/repo',
    createdAt: now,
    updatedAt: now,
    status: 'idle',
  };
}

describe('theme follow-up abilities', () => {
  it('infers the independent monitor and review skills from card prompts', () => {
    expect(inferThemeAbilitySkill(`使用 ${ALPHA_STUDIO_INTRADAY_MONITOR_SKILL_ID}`)?.id).toBe(ALPHA_STUDIO_INTRADAY_MONITOR_SKILL_ID);
    expect(inferThemeAbilitySkill(`使用 ${ALPHA_STUDIO_REPORT_REVIEW_SKILL_ID}`)?.id).toBe(ALPHA_STUDIO_REPORT_REVIEW_SKILL_ID);
  });

  it('injects the latest same-day report without modifying the report skill', () => {
    const conversations = [conversation('今日报告', [
      {
        id: 'report',
        role: 'assistant',
        timestamp: now - 60_000,
        blocks: [{ type: 'text', content: '# 今日报告\n今日执行闸门：只观察\n今日资金进攻路径：AI 硬件\n触发条件：10:00 放量' }],
      },
    ])];

    const prompt = addThemeAbilityContext('执行监控', ALPHA_STUDIO_INTRADAY_MONITOR_SKILL_ID, conversations, now);

    expect(prompt).toContain('[今日基线报告]');
    expect(prompt).toContain('触发条件：10:00 放量');
    expect(prompt).not.toContain('[今日盘中监控记录]');
  });

  it('adds monitor history when reviewing today\'s report', () => {
    const conversations = [
      conversation('今日报告', [
        {
          id: 'report',
          role: 'assistant',
          timestamp: now - 120_000,
          blocks: [{ type: 'text', content: '今日执行闸门：只观察\n今日资金进攻路径：机器人' }],
        },
      ]),
      conversation('盘中监控', [
        {
          id: 'monitor-user',
          role: 'user',
          timestamp: now - 90_000,
          blocks: [{ type: 'text', content: `使用 ${ALPHA_STUDIO_INTRADAY_MONITOR_SKILL_ID}` }],
        },
        {
          id: 'monitor-answer',
          role: 'assistant',
          timestamp: now - 30_000,
          blocks: [{ type: 'text', content: '机器人中军未放量，主线仍未触发。' }],
        },
      ]),
    ];

    const prompt = addThemeAbilityContext('执行复盘', ALPHA_STUDIO_REPORT_REVIEW_SKILL_ID, conversations, now);

    expect(prompt).toContain('[今日盘中监控记录]');
    expect(prompt).toContain('机器人中军未放量');
  });
});
