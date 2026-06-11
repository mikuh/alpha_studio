import { describe, expect, it } from 'vitest';
import { activeDomain } from './domain';
import { buildCodingPrompt } from './prompt';

describe('brand system domain', () => {
  it('uses the brand system domain by default', () => {
    const domain = activeDomain();

    expect(domain.id).toBe('brand-system');
    expect(domain.navigation.integrations).toEqual([]);
    expect(domain.navigation.coding).toEqual([]);
    expect(domain.navigation.archived.some((item) => item.id === 'archived')).toBe(true);
  });

  it('builds a brand prompt without finance or coding domain language', () => {
    const prompt = buildCodingPrompt('整理这个品牌目录里的定位和素材。');
    const forbiddenDomainWords = [
      '\u91d1\u878d',
      '\u6295\u7814',
      '\u4ea4\u6613',
      '\u884c\u60c5',
      '\u6301\u4ed3',
      '\u6536\u76ca',
      '\u57fa\u91d1',
      '本地编码工作台助手',
    ];

    expect(prompt).toContain('本地品牌工作台助手');
    expect(prompt).toContain('用户任务');
    for (const word of forbiddenDomainWords) {
      expect(prompt).not.toContain(word);
    }
  });
});
