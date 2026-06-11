import { useCallback, useEffect, useRef, useState } from 'react';
import { gitStatus } from './codexBridge';

export const GIT_BRANCH_REFRESH_INTERVAL_MS = 5_000;

export function displayBranchFromStatus(status: Awaited<ReturnType<typeof gitStatus>>): string | null {
  if (!status.isRepository) return null;
  return status.branch || 'detached';
}

export function useCurrentGitBranch(cwd: string): { branch: string | null; refresh: () => Promise<void> } {
  const [branch, setBranch] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    if (!cwd) {
      setBranch(null);
      return;
    }

    try {
      const status = await gitStatus(cwd);
      if (requestId === requestIdRef.current) {
        setBranch(displayBranchFromStatus(status));
      }
    } catch {
      if (requestId === requestIdRef.current) {
        setBranch(null);
      }
    }
  }, [cwd]);

  useEffect(() => {
    setBranch(null);
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!cwd) return;

    const refreshWhenVisible = () => {
      if (document.visibilityState !== 'hidden') {
        void refresh();
      }
    };

    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    const interval = window.setInterval(refreshWhenVisible, GIT_BRANCH_REFRESH_INTERVAL_MS);

    return () => {
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      window.clearInterval(interval);
    };
  }, [cwd, refresh]);

  return { branch, refresh };
}
