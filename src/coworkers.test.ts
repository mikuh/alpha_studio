import { describe, expect, it } from 'vitest';
import {
  COWORKER_CATALOG,
  COWORKER_GROUP_LABELS,
  COWORKER_WORKFLOW_PRESETS,
  coworkerAgentDefinitions,
  coworkerById,
  coworkerSelectionsByIds,
  toCoworkerSelection,
} from './coworkers';

describe('coworker catalog', () => {
  it('defines exactly nine coworkers with unique ids and badges', () => {
    expect(COWORKER_CATALOG).toHaveLength(9);
    expect(new Set(COWORKER_CATALOG.map((coworker) => coworker.id)).size).toBe(9);
    expect(COWORKER_CATALOG.map((coworker) => coworker.no)).toEqual([
      '①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨',
    ]);
  });

  it('uses agent-safe ids that map onto Codex custom agent names', () => {
    for (const coworker of COWORKER_CATALOG) {
      expect(coworker.id).toMatch(/^[a-z0-9_-]+$/);
    }
  });

  it('gives every coworker a group, persona, and at least one preset task', () => {
    for (const coworker of COWORKER_CATALOG) {
      expect(COWORKER_GROUP_LABELS[coworker.group]).toBeTruthy();
      expect(coworker.description.trim()).not.toBe('');
      expect(coworker.personaLines.length).toBeGreaterThan(0);
      expect(coworker.presetTasks).toHaveLength(2);
      for (const task of coworker.presetTasks) {
        expect(task.title.trim()).not.toBe('');
        expect(task.prompt.trim()).not.toBe('');
      }
    }
  });

  it('covers the active equity research team split', () => {
    const groups = COWORKER_CATALOG.map((coworker) => coworker.group);
    expect(groups.filter((group) => group === 'strategy')).toHaveLength(2);
    expect(groups.filter((group) => group === 'research')).toHaveLength(3);
    expect(groups.filter((group) => group === 'portfolio')).toHaveLength(1);
    expect(groups.filter((group) => group === 'guard')).toHaveLength(1);
    expect(groups.filter((group) => group === 'decision')).toHaveLength(1);
    expect(groups.filter((group) => group === 'audit')).toHaveLength(1);
  });

  it('turns the former valuation triplet into distinct investment seats', () => {
    expect(coworkerById('value_a')).toMatchObject({
      name: '公司基本面研究员',
      group: 'research',
    });
    expect(coworkerById('value_a')?.description).toContain('商业模式');

    expect(coworkerById('value_b')).toMatchObject({
      name: '估值与预期差研究员',
      group: 'research',
    });
    expect(coworkerById('value_b')?.description).toContain('预期差');

    expect(coworkerById('value_c')).toMatchObject({
      name: '组合构建与交易执行官',
      group: 'portfolio',
    });
    expect(coworkerById('value_c')?.description).toContain('交易节奏');
  });

  it('defines importable multi-coworker workflow presets', () => {
    expect(COWORKER_WORKFLOW_PRESETS).toHaveLength(9);
    expect(COWORKER_WORKFLOW_PRESETS.find((workflow) => workflow.id === 'theme-decision-meeting')?.coworkerIds)
      .toEqual(['mainline', 'risk', 'pm_deputy']);

    for (const workflow of COWORKER_WORKFLOW_PRESETS) {
      expect(workflow.title.trim()).not.toBe('');
      expect(workflow.description.trim()).not.toBe('');
      expect(workflow.prompt.trim()).not.toBe('');
      expect(workflow.prompt).toContain('固定输出结构');
      expect(workflow.prompt).toContain('本次 TODO');
      expect(workflow.prompt).toContain('完成核对');
      expect(workflow.prompt).toContain('只输出最终整合成稿');
      expect(workflow.prompt).toContain('不要自动扩展成多页正式报告');
      expect(workflow.prompt).toContain('落盘');
      expect(workflow.prompt).toContain('Markdown 文件');
      expect(workflow.coworkerIds.length).toBeGreaterThanOrEqual(2);
      expect(coworkerSelectionsByIds(workflow.coworkerIds)).toHaveLength(workflow.coworkerIds.length);
    }
  });

  it('keeps the premarket committee prompt focused on a clean memo', () => {
    const workflow = COWORKER_WORKFLOW_PRESETS.find((item) => item.id === 'premarket-committee');

    expect(workflow?.prompt).toContain('盘前投资委员会纪要');
    expect(workflow?.prompt).toContain('盘前投资委员会纪要-<目标盘前日期>.md');
    expect(workflow?.prompt).toContain('统一市场主线');
    expect(workflow?.prompt).toContain('题材机会');
    expect(workflow?.prompt).toContain('情绪与风险');
    expect(workflow?.prompt).toContain('行动清单');
    expect(workflow?.prompt).toContain('今日执行闸门');
    expect(workflow?.prompt).toContain('不得把 `compliance.md` 当作最终交付');
    expect(workflow?.prompt).toContain('不要输出调度过程');
    expect(workflow?.prompt).toContain('除非我明确要求正式报告');
  });

  it('looks up coworkers by id and builds message selections', () => {
    const risk = coworkerById('risk');
    expect(risk?.name).toBe('风险控制官');
    expect(coworkerById('missing')).toBeNull();

    expect(toCoworkerSelection(COWORKER_CATALOG[0])).toEqual({
      id: COWORKER_CATALOG[0].id,
      no: '①',
      name: COWORKER_CATALOG[0].name,
    });
  });

  it('materializes one Codex agent definition per coworker', () => {
    const definitions = coworkerAgentDefinitions();

    expect(definitions).toHaveLength(COWORKER_CATALOG.length);
    for (const [index, definition] of definitions.entries()) {
      const coworker = COWORKER_CATALOG[index];
      expect(definition.id).toBe(coworker.id);
      expect(definition.displayName).toBe(`${coworker.no} ${coworker.name}`);
      expect(definition.description).toContain(coworker.name);
      expect(definition.instructions).toContain(coworker.personaLines[coworker.personaLines.length - 1]);
      expect(definition.instructions).toContain('Alpha Studio');
    }
  });
});
