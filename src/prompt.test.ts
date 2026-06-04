import { describe, expect, it } from 'vitest';
import { activeDomain } from './domain';
import { buildCodingPrompt } from './prompt';

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
});
