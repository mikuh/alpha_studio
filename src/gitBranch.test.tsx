import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gitStatus } from './codexBridge';
import { displayBranchFromStatus, useCurrentGitBranch } from './gitBranch';
import type { GitStatus } from './types';

vi.mock('./codexBridge', () => ({
  gitStatus: vi.fn(),
}));

function status(branch: string | undefined, isRepository = true): GitStatus {
  return {
    cwd: '/repo',
    isRepository,
    branch,
    ahead: 0,
    behind: 0,
    clean: true,
    changes: [],
  };
}

describe('displayBranchFromStatus', () => {
  it('formats repository branch labels', () => {
    expect(displayBranchFromStatus(status('feature/login'))).toBe('feature/login');
    expect(displayBranchFromStatus(status(undefined))).toBe('detached');
    expect(displayBranchFromStatus(status(undefined, false))).toBeNull();
  });
});

describe('useCurrentGitBranch', () => {
  beforeEach(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
  });

  it('refreshes the visible branch when the window regains focus', async () => {
    const gitStatusMock = vi.mocked(gitStatus);
    gitStatusMock
      .mockResolvedValueOnce(status('main'))
      .mockResolvedValueOnce(status('feature/switch'));

    const { result } = renderHook(() => useCurrentGitBranch('/repo'));

    await waitFor(() => expect(result.current.branch).toBe('main'));

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => expect(result.current.branch).toBe('feature/switch'));
    expect(gitStatusMock).toHaveBeenCalledTimes(2);
  });
});
