import { describe, expect, it } from 'vitest';
import { activeDomain } from './domain';
import { buildCodingInstructions, buildCodingPrompt } from './prompt';

describe('finance research domain', () => {
  it('uses the finance research domain by default', () => {
    const domain = activeDomain();

    expect(domain.id).toBe('finance-research');
    expect(domain.navigation.coding).toEqual([]);
    expect(domain.navigation.archived.some((item) => item.id === 'archived')).toBe(true);
  });

  it('builds a finance prompt without coding domain language', () => {
    const prompt = buildCodingPrompt('分析今天新能源板块的异动。');
    const forbiddenDomainWords = [
      '\u672c\u5730\u7f16\u7801\u5de5\u4f5c\u53f0\u52a9\u624b',
      '\u7406\u89e3\u4ee3\u7801',
      '\u4fee\u6539\u9879\u76ee',
      'Git',
      'CLI',
    ];

    expect(prompt).toContain('金融投研工作台助手');
    expect(prompt).toContain('投研');
    expect(prompt).toContain('用户任务');
    for (const word of forbiddenDomainWords) {
      expect(prompt).not.toContain(word);
    }
  });

  it('emphasizes the selected skill in coding prompts', () => {
    const prompt = buildCodingPrompt(
      'Open the page and debug the issue.',
      { selectedSkill: { id: 'chrome', title: 'Chrome' } },
    );

    expect(prompt).toContain('当前指定 Skill：Chrome (chrome)');
    expect(prompt).toContain('必须优先使用这个 Skill');
  });

  it('tells Image Gen turns to expose progress and renderable outputs', () => {
    const instructions = buildCodingInstructions(
      { selectedSkill: { id: 'imagegen', title: 'Image Gen' } },
    );

    expect(instructions).toContain('图片生成展示要求');
    expect(instructions).toContain('Markdown 图片');
    expect(instructions).toContain('不要只回复“已生成”');
  });

  it('keeps Alpha Studio instructions separate from the user task for app-server turns', () => {
    const instructions = buildCodingInstructions(
      { selectedSkill: { id: 'chrome', title: 'Chrome' } },
    );

    expect(instructions).toContain('金融投研工作台助手');
    expect(instructions).toContain('当前指定 Skill：Chrome (chrome)');
    expect(instructions).not.toContain('用户任务');
    expect(instructions).not.toContain('Open the page and debug the issue.');
  });
});
