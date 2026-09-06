import { authorizeClientModules, type ClientLicenseSession } from './license';
import { hasModule, moduleDeniedMessage, requiredModulesForTask } from '../shared/productModules';

export async function authorizeModuleTask(
  session: ClientLicenseSession | null,
  text: string,
  skillId?: string,
  hasCoworkers = false,
): Promise<void> {
  const required = requiredModulesForTask(text, skillId, hasCoworkers);
  if (!required.length) return;
  for (const id of required) {
    if (!hasModule(session, id)) throw new Error(moduleDeniedMessage(id));
  }
  await authorizeClientModules(session!, required);
}
