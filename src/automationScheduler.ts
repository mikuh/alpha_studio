import { hasModule, requiredModulesForTask } from '../shared/productModules';
import { useEffect } from 'react';
import {
  isScheduledAutomationTaskDue,
  loadScheduledAutomationTasks,
  scheduledAutomationRunPrompt,
  updateScheduledAutomationTask,
} from './automation';
import { isTauriRuntime } from './codexBridge';
import { useChatStore } from './store';

const AUTOMATION_TICK_MS = 30_000;

export function useAutomationScheduler(): void {
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let disposed = false;
    let checking = false;

    const tick = async () => {
      if (disposed || checking) return;
      checking = true;
      try {
        const now = new Date();
        const tasks = loadScheduledAutomationTasks();
        for (const task of tasks) {
          if (!isScheduledAutomationTaskDue(task, now) || !task.conversationId) continue;
          const state = useChatStore.getState();
          const conversation = state.conversations.find(
            (item) => item.id === task.conversationId && !item.archivedAt,
          );
          if (!conversation || conversation.status !== 'idle') continue;

          if (requiredModulesForTask(scheduledAutomationRunPrompt(task), task.skillId).some((id) => !hasModule(state.clientLicenseSession, id))) continue;
          updateScheduledAutomationTask(task.id, { lastRunAt: now.getTime() });
          const selectedSkill = task.skillId
            ? {
                id: task.skillId,
                title: task.skillTitle || task.skillId,
              }
            : null;
          await state.sendMessageToConversation(
            conversation.id,
            scheduledAutomationRunPrompt(task),
            undefined,
            selectedSkill,
            undefined,
            true,
          );
        }
      } finally {
        checking = false;
      }
    };

    void tick();
    const interval = window.setInterval(() => void tick(), AUTOMATION_TICK_MS);
    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, []);
}
