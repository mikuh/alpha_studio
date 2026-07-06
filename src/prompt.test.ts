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

  it('keeps automation guidance aligned with Alpha Studio client handling', () => {
    const instructions = buildCodingInstructions();

    expect(instructions).toContain('Alpha Studio 会在发送给模型前直接处理简单的提醒和周期任务');
    expect(instructions).toContain('不要声称可以调用 `automation_update`');
    expect(instructions).toContain('crontab');
    expect(instructions).toContain('launchd');
    expect(instructions).toContain('左侧「自动化」页');
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

describe('coworker orchestration protocol', () => {
  it('tells the main agent to spawn a single summoned coworker sub-agent', () => {
    const instructions = buildCodingInstructions({
      coworkers: [{ id: 'mainline', no: '①', name: '主线交易官' }],
    });

    expect(instructions).toContain('用户为本次任务召集了以下 AI 同事');
    expect(instructions).toContain('agent `mainline`');
    expect(instructions).toContain('① 主线交易官');
    expect(instructions).toContain('职责');
    expect(instructions).toContain('你是调度者(主 agent)');
    expect(instructions).toContain('spawn agent 工具');
    expect(instructions).toContain('转述其交付物');
    expect(instructions).not.toContain('并行 spawn');
  });

  it('asks for parallel spawns and a merged signed report for multiple coworkers', () => {
    const instructions = buildCodingInstructions({
      coworkers: [
        { id: 'mainline', no: '①', name: '主线交易官' },
        { id: 'risk', no: '⑦', name: '风险控制官' },
      ],
    });

    expect(instructions).toContain('agent `mainline`');
    expect(instructions).toContain('agent `risk`');
    expect(instructions).toContain('并行 spawn');
    expect(instructions).toContain('联合结论');
    expect(instructions).toContain('署名');
    expect(instructions).not.toContain('基金经理副官在场');
  });

  it('lets the PM deputy own the merged conclusion when summoned', () => {
    const instructions = buildCodingInstructions({
      coworkers: [
        { id: 'mainline', no: '①', name: '主线交易官' },
        { id: 'pm_deputy', no: '⑧', name: '基金经理副官' },
      ],
    });

    expect(instructions).toContain('⑧ 基金经理副官在场');
    expect(instructions).toContain('带立场的综合判断');
  });

  it('keeps a graceful fallback for runtimes without spawn support', () => {
    const instructions = buildCodingInstructions({
      coworkers: [{ id: 'theme', no: '②', name: '题材挖掘官' }],
    });

    expect(instructions).toContain('不支持 spawn agent 工具');
    expect(instructions).toContain('依次扮演每位同事');
  });

  it('omits the orchestration protocol when no coworkers are summoned', () => {
    const instructions = buildCodingInstructions();

    expect(instructions).not.toContain('召集了以下 AI 同事');
    expect(instructions).not.toContain('spawn agent 工具');
  });
});
