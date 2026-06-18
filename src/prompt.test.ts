import { describe, expect, it } from 'vitest';
import { activeDomain } from './domain';
import { buildCodingInstructions, buildCodingPrompt } from './prompt';

describe('core coding domain', () => {
  it('uses the source-available coding domain by default', () => {
    const domain = activeDomain();

    expect(domain.id).toBe('core-coding');
    expect(domain.navigation.coding.some((item) => item.id === 'git')).toBe(true);
    expect(domain.navigation.archived.some((item) => item.id === 'archived')).toBe(true);
  });

  it('builds a coding prompt without finance domain language', () => {
    const prompt = buildCodingPrompt('Read the codebase and fix the failing test.');
    const forbiddenDomainWords = [
      '\u91d1\u878d',
      '\u6295\u7814',
      '\u4ea4\u6613',
      '\u884c\u60c5',
      '\u6301\u4ed3',
      '\u6536\u76ca',
      '\u57fa\u91d1',
    ];

    expect(prompt).toContain('本地编码工作台助手');
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

  it('keeps Alpha Studio instructions separate from the user task for app-server turns', () => {
    const instructions = buildCodingInstructions(
      { selectedSkill: { id: 'chrome', title: 'Chrome' } },
    );

    expect(instructions).toContain('本地编码工作台助手');
    expect(instructions).toContain('当前指定 Skill：Chrome (chrome)');
    expect(instructions).not.toContain('用户任务');
    expect(instructions).not.toContain('Open the page and debug the issue.');
  });
});
