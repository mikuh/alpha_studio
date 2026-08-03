import { beforeEach, describe, expect, it, vi } from 'vitest';

const localStoreMock = vi.hoisted(() => ({
  revision: 1,
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: localStoreMock.invoke,
}));

vi.mock('./codexBridge', () => ({
  isTauriRuntime: () => true,
}));

import { loadLocalStoreSnapshot, reloadLocalStoreSnapshot } from './localStore';

describe('local store snapshot reload', () => {
  beforeEach(() => {
    localStoreMock.revision = 1;
    localStoreMock.invoke.mockReset();
    localStoreMock.invoke.mockImplementation(async (command: string) => {
      if (command === 'local_store_info') {
        return {
          dbPath: '/tmp/alpha-studio.sqlite3',
          backupDir: '/tmp/backups',
          schemaVersion: 3,
          hasData: true,
        };
      }
      if (command === 'local_store_load') {
        return {
          dbPath: '/tmp/alpha-studio.sqlite3',
          backupDir: '/tmp/backups',
          schemaVersion: 3,
          chat: { revision: localStoreMock.revision },
          premarketThemeRuns: [],
          themeTrackingEvents: [],
          themeReviews: [],
          themeBacktestRuns: [],
          automationTasks: [],
          jointResearchRuns: [],
          researchRecommendations: [],
          aiRiskAssessments: [],
          recommendationEvents: [],
        };
      }
      return undefined;
    });
  });

  it('bypasses the cached bootstrap snapshot when an HMR store reload asks for fresh data', async () => {
    const initial = await loadLocalStoreSnapshot();
    localStoreMock.revision = 2;

    const cached = await loadLocalStoreSnapshot();
    const fresh = await reloadLocalStoreSnapshot();

    expect(initial?.chat).toEqual({ revision: 1 });
    expect(cached?.chat).toEqual({ revision: 1 });
    expect(fresh?.chat).toEqual({ revision: 2 });
    expect(localStoreMock.invoke).toHaveBeenCalledWith('local_store_load');
    expect(localStoreMock.invoke.mock.calls.filter(([command]) => command === 'local_store_load')).toHaveLength(2);
  });
});
