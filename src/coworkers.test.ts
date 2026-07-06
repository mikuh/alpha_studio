import { describe, expect, it } from 'vitest';
import {
  COWORKER_CATALOG,
  COWORKER_GROUP_LABELS,
  coworkerAgentDefinitions,
  coworkerById,
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
      expect(coworker.presetTasks.length).toBeGreaterThan(0);
      for (const task of coworker.presetTasks) {
        expect(task.title.trim()).not.toBe('');
        expect(task.prompt.trim()).not.toBe('');
      }
    }
  });

  it('covers the full research / guard / decision / audit team split', () => {
    const groups = COWORKER_CATALOG.map((coworker) => coworker.group);
    expect(groups.filter((group) => group === 'research')).toHaveLength(6);
    expect(groups.filter((group) => group === 'guard')).toHaveLength(1);
    expect(groups.filter((group) => group === 'decision')).toHaveLength(1);
    expect(groups.filter((group) => group === 'audit')).toHaveLength(1);
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
