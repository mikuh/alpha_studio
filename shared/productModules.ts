import catalog from './productModules.json';

export const PRODUCT_MODULES = catalog;
export const PRODUCT_MODULE_IDS = catalog.map((item) => item.id);
const knownIds = new Set(PRODUCT_MODULE_IDS);

export function normalizeEnabledModules(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((id): id is string => typeof id === 'string' && knownIds.has(id)))]
    : [];
}

export function hasModule(session: { tenant: { enabledModules?: string[] } } | null | undefined, id: string): boolean {
  return knownIds.has(id) && Array.isArray(session?.tenant.enabledModules) && session.tenant.enabledModules.includes(id);
}

export function moduleForPanel(kind: string): string | undefined {
  return kind === 'daily-decision' ? 'daily-report' : catalog.find((item) => item.group === 'sidebar' && item.id === kind)?.id;
}

export function moduleForSkill(skillId: string): string | undefined {
  return catalog.find((item) => item.skillId === skillId)?.id;
}

export function requiredModulesForTask(text: string, skillId?: string, hasCoworkers = false): string[] {
  return catalog.filter((item) => (item.id === 'coworkers' && hasCoworkers)
    || (item.skillId && (item.skillId === skillId || text.includes(item.skillId)))).map((item) => item.id);
}

export function moduleDeniedMessage(id: string): string {
  return `当前客户未开通「${catalog.find((item) => item.id === id)?.title ?? id}」，请联系管理员配置模块权限。`;
}
