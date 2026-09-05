import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TurnDuration } from './TurnDuration';
import { applyCodexEventToConversation } from './codexEvents';
import type { Conversation } from './types';

afterEach(() => { cleanup(); vi.useRealTimers(); });

it.each(['completed', 'stopped', 'error'] as const)('freezes elapsed time after %s and preserves it through persistence', (type) => {
  vi.useFakeTimers();
  vi.setSystemTime(100_000);
  const conversation: Conversation = {
    id: 'timed', title: 'Timed turn', cwd: '', createdAt: 1, updatedAt: 100_000, status: 'streaming', runId: 'run',
    messages: [{ id: 'answer', role: 'assistant', timestamp: 86_000, isStreaming: true, blocks: [] }],
  };
  const { rerender } = render(<TurnDuration message={conversation.messages[0]} />);
  expect(screen.getByText('已处理 14秒')).toBeInTheDocument();
  act(() => vi.advanceTimersByTime(5000));
  expect(screen.getByText('已处理 19秒')).toBeInTheDocument();

  const completed = applyCodexEventToConversation(conversation, { type, runId: 'run', message: 'Failed request' });
  const restored = JSON.parse(JSON.stringify(completed)) as Conversation;
  expect(restored.messages[0].finishedAt).toBe(105_000);
  expect(restored.messages[0].finishReason).toBe(type);
  rerender(<TurnDuration message={restored.messages[0]} />);
  act(() => vi.advanceTimersByTime(120_000));
  expect(screen.getByText('已处理 19秒')).toBeInTheDocument();
  if (type === 'stopped') expect(screen.getByText('已停止')).toBeInTheDocument();
  if (type === 'error') expect(screen.getByText('未完成')).toBeInTheDocument();
  expect(applyCodexEventToConversation(restored, { type: 'completed', runId: 'run' }).messages[0].finishedAt).toBe(105_000);
});

it('does not invent durations for historical messages without an end timestamp', () => {
  const { container } = render(<TurnDuration message={{ id: 'old', role: 'assistant', timestamp: 1, blocks: [] }} />);
  expect(container).toBeEmptyDOMElement();
});
