import { describe, expect, it, vi } from 'vitest';
import { applyCodexEventToConversation, TOOL_LOG_MAX_CHARACTERS } from './codexEvents';
import type { Conversation } from './types';

function baseConversation(): Conversation {
  return {
    id: 'conv-1',
    title: '测试',
    messages: [
      {
        id: 'asst-1',
        role: 'assistant',
        timestamp: 1,
        isStreaming: true,
        blocks: [],
      },
    ],
    cwd: '/tmp',
    createdAt: 1,
    updatedAt: 1,
    status: 'streaming',
  };
}

describe('applyCodexEventToConversation', () => {
  it.each(['tool_completed', 'tool_failed'] as const)('preserves runtime duration on %s even when event delivery takes longer', type => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(10_000);
    const started = applyCodexEventToConversation(baseConversation(), {
      type: 'tool_started', runId: 'run-1', itemId: 'read', title: 'fileRead',
    });
    clock.mockReturnValue(15_000);
    const finished = applyCodexEventToConversation(started, {
      type, runId: 'run-1', itemId: 'read', raw: { item: { durationMs: 125 } },
    });
    const restored = JSON.parse(JSON.stringify(finished)) as Conversation;
    expect(restored.messages[0].blocks[0]).toMatchObject({
      startedAt: 10_000, finishedAt: 15_000, durationMs: 125,
      status: type === 'tool_completed' ? 'completed' : 'failed',
    });
  });

  it('merges streamed previews without losing admission metadata and clears them at idle', () => {
    const event = { type: 'activity' as const, title: 'gateway', runId: 'run-1' };
    const running = applyCodexEventToConversation(baseConversation(), { ...event, raw: { status: {
      active: true, activeRequests: 3, activeSubagents: 2, cooldownUntil: 12345, maxParallelSubagents: 2,
    } } });
    const progress = applyCodexEventToConversation(running, { ...event, raw: { progressOnly: true, status: {
      active: true, lastOutputAt: 123, requestProgress: [{ id: 'main:a', kind: 'tool_input',
        itemId: 'a', callId: 'call-a', toolName: 'exec_command', preview: '生成🚀'.repeat(400), characters: 1200 }],
    } } });
    expect(progress.gatewayActivity).toMatchObject({ activeRequests: 3, activeSubagents: 2, cooldownUntil: 12345 });
    expect(progress.gatewayActivity?.requestProgress?.[0]).toMatchObject({ itemId: 'a', callId: 'call-a', kind: 'tool_input' });
    expect(Array.from(progress.gatewayActivity?.requestProgress?.[0].preview ?? '')).toHaveLength(900);
    expect(progress.messages).toBe(running.messages);
    const idle = applyCodexEventToConversation(progress, { ...event, raw: { status: null, progressOnly: true } });
    expect(idle.gatewayActivity).toBeUndefined();
  });

  it('separates queue heartbeats from real progress and clears telemetry at idle and completion', () => {
    const running = applyCodexEventToConversation(baseConversation(), { type: 'tool_started', runId: 'run-1', itemId: 'edit', title: 'fileChange' });
    const heartbeat = { type: 'activity' as const, runId: 'run-1', title: 'gateway', raw: { status: { active: true, waitingRequests: 3, lastOutputAt: 0 } } };
    const queued = applyCodexEventToConversation(running, heartbeat);
    expect(queued.updatedAt).toBe(running.updatedAt);
    expect(queued.runActivity).toEqual(running.runActivity);
    expect(queued.messages).toBe(running.messages);
    const noQueue = applyCodexEventToConversation(queued, { ...heartbeat, raw: { status: null } });
    expect(noQueue.gatewayActivity).toBeUndefined();
    expect(noQueue.updatedAt).toBe(running.updatedAt);
    expect(applyCodexEventToConversation(queued, { type: 'completed', runId: 'run-1' }).gatewayActivity).toBeUndefined();
    expect(applyCodexEventToConversation(queued, { type: 'stopped', runId: 'run-1' }).gatewayActivity).toBeUndefined();
    expect(applyCodexEventToConversation(queued, { type: 'error', runId: 'run-1' }).gatewayActivity).toBeUndefined();
  });

  it('requires a native tool completion to confirm a file write', () => {
    const started = applyCodexEventToConversation(baseConversation(), {
      type: 'tool_started', runId: 'run-1', itemId: 'edit', title: 'fileChange',
      raw: { item: { changes: [{ path: '/tmp/report.html', kind: { type: 'add' }, diff: '@@ -0,0 +1 @@\n+hello' }] } },
    });
    const finished = applyCodexEventToConversation(started, { type: 'completed', runId: 'run-1' });
    expect(finished.messages[0].blocks[0]).toMatchObject({ completionUnconfirmed: true });
    const confirmed = applyCodexEventToConversation(started, { type: 'tool_completed', runId: 'run-1', itemId: 'edit', title: 'fileChange' });
    expect(confirmed.messages[0].blocks[0]).toMatchObject({ status: 'completed', fileChanges: [{ path: '/tmp/report.html', kind: 'add', additions: 1, deletions: 0 }] });
    expect(confirmed.messages[0].blocks[0]).not.toHaveProperty('completionUnconfirmed', true);
  });

  it('keeps a write script and its failure in one row with the original command', () => {
    const command = "cat > /tmp/report.html <<'EOF'\nhello\nEOF";
    const started = applyCodexEventToConversation(baseConversation(), {
      type: 'tool_started', runId: 'run-1', itemId: 'write', title: 'fileRead',
      raw: { item: { command, cwd: '/tmp' } },
    });
    expect(started.messages[0].blocks[0]).toMatchObject({ title: 'fileWrite', command, input: command, status: 'in_progress' });
    const failed = applyCodexEventToConversation(started, {
      type: 'tool_failed', runId: 'run-1', itemId: 'write', title: 'commandExecution', text: 'disk full',
    });
    expect(failed.messages[0].blocks).toHaveLength(1);
    expect(failed.messages[0].blocks[0]).toMatchObject({ title: 'fileWrite', command, status: 'failed', output: 'disk full' });
  });
  it('inserts an acknowledged steering message once and keeps subsequent output in the same run', () => {
    const current = { ...baseConversation(), runId: 'run-1', queuedMessages: [{ id: 'q-1', text: '换个方向', createdAt: 2 }] };
    const event = { type: 'message_steered' as const, runId: 'run-1', itemId: 'q-1' };
    const steered = applyCodexEventToConversation(current, event);
    expect(steered.messages[0].isStreaming).toBe(false);
    expect(steered.messages[1]).toMatchObject({ role: 'user', blocks: [{ type: 'text', content: '换个方向' }] });
    expect(steered.messages[2]).toMatchObject({ role: 'assistant', isStreaming: true });
    expect(steered).toMatchObject({ runId: 'run-1', status: 'streaming', queuedMessages: [] });
    expect(applyCodexEventToConversation(steered, event)).toBe(steered);
    const next = applyCodexEventToConversation(steered, { type: 'text_delta', runId: 'run-1', text: '收到，调整方向。' });
    expect(next.messages[2].blocks).toEqual([{ type: 'text', content: '收到，调整方向。' }]);
  });

  it('keeps tool results with the assistant that started them before steering', () => {
    let current: Conversation = { ...baseConversation(), runId: 'run-1', queuedMessages: [{ id: 'q-1', text: '继续', createdAt: 2 }] };
    current = applyCodexEventToConversation(current, { type: 'tool_started', runId: 'run-1', itemId: 'tool-1', title: 'exec' });
    current = applyCodexEventToConversation(current, { type: 'message_steered', runId: 'run-1', itemId: 'q-1' });
    current = applyCodexEventToConversation(current, { type: 'tool_delta', runId: 'run-1', itemId: 'tool-1', text: 'progress' });
    current = applyCodexEventToConversation(current, { type: 'tool_completed', runId: 'run-1', itemId: 'tool-1', text: 'done' });
    expect(current.messages[0].blocks[0]).toMatchObject({ type: 'tool', id: 'tool-1', status: 'completed', output: 'done' });
    expect(current.messages[2].blocks).toEqual([]);
    expect(current.status).toBe('streaming');
  });

  it('settles tools from earlier steering segments when the turn stops', () => {
    let current: Conversation = { ...baseConversation(), runId: 'run-1', queuedMessages: [{ id: 'q-1', text: '继续', createdAt: 2 }] };
    current = applyCodexEventToConversation(current, { type: 'tool_started', runId: 'run-1', itemId: 'tool-1', title: 'exec' });
    current = applyCodexEventToConversation(current, { type: 'message_steered', runId: 'run-1', itemId: 'q-1' });
    current = applyCodexEventToConversation(current, { type: 'stopped', runId: 'run-1' });
    expect(current.messages[0].blocks[0]).toMatchObject({ type: 'tool', status: 'failed' });
    expect(current.messages[2].isStreaming).toBe(false);
    expect(current.status).toBe('idle');
  });
  it('merges native snapshots into their own message while preserving other streamed replies', () => {
    let next: Conversation = { ...baseConversation(), runId: 'run-1' };
    next = applyCodexEventToConversation(next, { type: 'text_delta', runId: 'run-1', itemId: 'commentary', text: '第一段' });
    next = applyCodexEventToConversation(next, { type: 'text_delta', runId: 'run-1', itemId: 'final', text: '报告' });
    next = applyCodexEventToConversation(next, { type: 'text_delta', runId: 'run-1', itemId: 'commentary', text: '第一段完整', message: 'replace' });
    next = applyCodexEventToConversation(next, { type: 'text_delta', runId: 'run-1', itemId: 'final', text: '报告已完成', message: 'replace' });
    expect(next.messages[0].blocks).toMatchObject([
      { type: 'text', itemId: 'commentary', content: '第一段完整' },
      { type: 'text', itemId: 'final', content: '报告已完成' },
    ]);
    expect(next.status).toBe('streaming');
  });

  it('records real gateway progress without adding transcript noise', () => {
    const next = applyCodexEventToConversation({ ...baseConversation(), runId: 'run-1' }, {
      type: 'activity', runId: 'run-1', title: 'gateway',
      raw: { status: { active: true, waitingRequests: 2, lastOutputAt: 123 } },
    });
    expect(next.updatedAt).toBeGreaterThan(1);
    expect(next.gatewayActivity).toMatchObject({ waitingRequests: 2, lastOutputAt: 123 });
    expect(next.runActivity).toBeUndefined();
    expect(next.messages[0].blocks).toEqual([]);
    expect(next.status).toBe('streaming');
  });

  it('keeps reconnect status visible until substantive model progress resumes', () => {
    const retrying = applyCodexEventToConversation({ ...baseConversation(), runId: 'run-1' }, {
      type: 'status', runId: 'run-1', message: 'Reconnecting... 2/5',
    });
    const monitored = applyCodexEventToConversation(retrying, {
      type: 'activity', runId: 'run-1', title: 'gateway', message: '等待模型响应',
    });
    expect(monitored.runActivity).toEqual({ kind: 'retrying', label: '正在重连模型（2/5）' });
    const resumed = applyCodexEventToConversation(monitored, {
      type: 'text_delta', runId: 'run-1', text: '继续',
    });
    expect(resumed.runActivity?.kind).toBe('working');
    const done = applyCodexEventToConversation(resumed, { type: 'completed', runId: 'run-1' });
    expect(done.runActivity).toBeUndefined();
  });

  it('rejects late progress and terminal events from a previous run', () => {
    const conversation = { ...baseConversation(), runId: 'new-run' };
    for (const type of ['activity', 'error', 'completed'] as const) {
      expect(applyCodexEventToConversation(conversation, {
        type, runId: 'old-run', conversationId: 'conv-1', message: 'old status',
      })).toBe(conversation);
    }
  });

  it('preserves upstream error details while finalizing a failed turn', () => {
    const failed = applyCodexEventToConversation(baseConversation(), {
      type: 'error', runId: 'run-1', message: 'exceeded retry limit, last status: 429',
      raw: { error: { additionalDetails: 'Alpha Studio gateway queue timed out' } },
    });
    expect(failed.messages[0].blocks).toEqual([{
      type: 'error', content: 'exceeded retry limit, last status: 429\nAlpha Studio gateway queue timed out',
    }]);
    expect(failed.status).toBe('error');
    expect(failed.runActivity).toBeUndefined();
  });

  it.each([
    { message: 'unexpected status 413 Payload Too Large: Failed to buffer the request body: length limit exceeded, request id: test-request' },
    { message: '请求失败', raw: { error: { additionalDetails: '{"error":{"code":"request_body_too_large","limit_bytes":20971520}}' } } },
  ])('explains oversized model requests and keeps completed file work', (error) => {
    const written = applyCodexEventToConversation(baseConversation(), {
      type: 'tool_completed', runId: 'run-1', itemId: 'pdf', title: 'commandExecution',
      text: 'pages 10 bytes 1954411',
    });
    const failed = applyCodexEventToConversation(written, {
      type: 'error', runId: 'run-1', ...error,
    });
    const blocks = failed.messages[0].blocks;
    const errorBlock = blocks[blocks.length - 1];
    expect(failed.messages[0].blocks.slice(0, -1)).toEqual(written.messages[0].blocks);
    expect(errorBlock).toMatchObject({
      type: 'error',
      content: expect.stringContaining('模型请求过大（HTTP 413）'),
    });
    if (errorBlock.type !== 'error') throw new Error('Expected an error block');
    expect(errorBlock?.content).toContain('已生成的本地文件仍可打开或打印');
    expect(errorBlock?.content).toContain(error.message);
    if (error.raw) expect(errorBlock?.content).toContain(error.raw.error.additionalDetails);
    expect(failed.status).toBe('error');
    expect(failed.runActivity).toBeUndefined();
  });

  it('does not classify an unrelated error containing 413 as a body limit', () => {
    const failed = applyCodexEventToConversation(baseConversation(), {
      type: 'error', runId: 'run-1', message: 'Could not read page 413',
    });
    expect(failed.messages[0].blocks).toEqual([{ type: 'error', content: 'Could not read page 413' }]);
  });

  it('stores the thread id for resume', () => {
    const next = applyCodexEventToConversation(baseConversation(), {
      type: 'thread_started',
      runId: 'run-1',
      conversationId: 'conv-1',
      threadId: 'thread-1',
    });

    expect(next.codexThreadId).toBe('thread-1');
  });

  it('stores Codex app-server token usage for context window display', () => {
    const next = applyCodexEventToConversation(baseConversation(), {
      type: 'token_usage',
      runId: 'run-1',
      conversationId: 'conv-1',
      raw: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        tokenUsage: {
          total: {
            totalTokens: 34498,
            inputTokens: 34000,
            cachedInputTokens: 14720,
            outputTokens: 498,
            reasoningOutputTokens: 120,
          },
          last: {
            totalTokens: 20429,
            inputTokens: 19770,
            cachedInputTokens: 14720,
            outputTokens: 659,
            reasoningOutputTokens: 288,
          },
          modelContextWindow: 258400,
        },
      },
    });

    expect(next.codexTokenUsage?.last.totalTokens).toBe(20429);
    expect(next.codexTokenUsage?.modelContextWindow).toBe(258400);
  });

  it('renders Codex context compaction as a visible assistant event block', () => {
    const next = applyCodexEventToConversation(baseConversation(), {
      type: 'context_compacted',
      runId: 'run-1',
      conversationId: 'conv-1',
      threadId: 'thread-1',
      itemId: 'compact-1',
    });

    expect(next.codexCompactedAt).toBeTypeOf('number');
    expect(next.messages[0].blocks).toEqual([
      {
        type: 'tool',
        id: 'compact-1',
        title: 'context_compaction',
        status: 'completed',
        target: 'GPT 已压缩历史上下文',
        output: '已收到 GPT 原生上下文压缩事件，后续回复会基于压缩后的线程继续。',
      },
    ]);
  });

  it('appends streamed text to the active assistant message', () => {
    const first = applyCodexEventToConversation(baseConversation(), {
      type: 'text_delta',
      runId: 'run-1',
      conversationId: 'conv-1',
      text: '结论：',
    });
    const second = applyCodexEventToConversation(first, {
      type: 'text_delta',
      runId: 'run-1',
      conversationId: 'conv-1',
      text: '谨慎。',
    });

    expect(second.messages[0].blocks).toEqual([{ type: 'text', content: '结论：谨慎。' }]);
  });

  it('appends every text delta verbatim (dedup is the backend\'s job)', () => {
    // The app-server streams pure incremental tokens and suppresses the final
    // full-text snapshot when it already streamed deltas, so the frontend must
    // append each delta as-is — repeated tokens like "." or " the" are legit.
    const first = applyCodexEventToConversation(baseConversation(), {
      type: 'text_delta',
      runId: 'run-1',
      conversationId: 'conv-1',
      text: '结论：',
    });
    const second = applyCodexEventToConversation(first, {
      type: 'text_delta',
      runId: 'run-1',
      conversationId: 'conv-1',
      text: '谨慎。谨慎。',
    });

    expect(second.messages[0].blocks).toEqual([{ type: 'text', content: '结论：谨慎。谨慎。' }]);
  });

  it('ignores terminal events once the turn has already finished', () => {
    const conversation: Conversation = { ...baseConversation(), status: 'idle' };
    conversation.messages = [
      { id: 'asst-1', role: 'assistant', timestamp: 1, isStreaming: false, blocks: [{ type: 'text', content: '你好' }] },
    ];

    const afterStop = applyCodexEventToConversation(conversation, {
      type: 'stopped',
      runId: 'run-1',
      conversationId: 'conv-1',
    });
    expect(afterStop).toBe(conversation);
  });

  it('stops streaming without appending a visible stop marker', () => {
    const conversation = applyCodexEventToConversation(baseConversation(), {
      type: 'text_delta',
      runId: 'run-1',
      conversationId: 'conv-1',
      text: '处理中',
    });

    const stopped = applyCodexEventToConversation(conversation, {
      type: 'stopped',
      runId: 'run-1',
      conversationId: 'conv-1',
    });

    expect(stopped.status).toBe('idle');
    expect(stopped.messages[0].isStreaming).toBe(false);
    expect(stopped.messages[0].blocks).toEqual([{ type: 'text', content: '处理中' }]);
  });

  it('settles an orphaned running tool when the turn completes', () => {
    const conversation = baseConversation();
    conversation.messages[0].blocks = [
      { type: 'tool', id: 'cmd-complete', title: 'execute', status: 'completed', input: 'date' },
      { type: 'tool', id: 'cmd-orphan', title: 'execute', status: 'in_progress', input: 'render report' },
      { type: 'text', content: '报告已生成。' },
    ];

    const completed = applyCodexEventToConversation(conversation, {
      type: 'completed',
      runId: 'run-1',
      conversationId: 'conv-1',
    });

    expect(completed.status).toBe('idle');
    expect(completed.messages[0].isStreaming).toBe(false);
    expect(completed.messages[0].blocks).toEqual([
      { type: 'tool', id: 'cmd-complete', title: 'execute', status: 'completed', input: 'date' },
      { type: 'tool', id: 'cmd-orphan', title: 'execute', status: 'completed', input: 'render report' },
      { type: 'text', content: '报告已生成。' },
    ]);
  });

  it('marks an orphaned running tool failed when the turn stops', () => {
    const conversation = baseConversation();
    conversation.messages[0].blocks = [
      { type: 'tool', id: 'cmd-orphan', title: 'execute', status: 'in_progress', input: 'render report' },
    ];

    const stopped = applyCodexEventToConversation(conversation, {
      type: 'stopped',
      runId: 'run-1',
      conversationId: 'conv-1',
    });

    expect(stopped.messages[0].blocks[0]).toMatchObject({
      type: 'tool',
      id: 'cmd-orphan',
      status: 'failed',
    });
  });

  it('marks an orphaned running tool failed when the turn errors', () => {
    const conversation = baseConversation();
    conversation.messages[0].blocks = [
      { type: 'tool', id: 'cmd-orphan', title: 'execute', status: 'in_progress', input: 'render report' },
    ];

    const failed = applyCodexEventToConversation(conversation, {
      type: 'error',
      runId: 'run-1',
      conversationId: 'conv-1',
      message: '进程异常退出',
    });

    expect(failed.status).toBe('error');
    expect(failed.messages[0].blocks).toEqual([
      { type: 'tool', id: 'cmd-orphan', title: 'execute', status: 'failed', input: 'render report' },
      { type: 'error', content: '进程异常退出' },
    ]);
  });

  it('ignores a buffered text delta that arrives after the turn stopped', () => {
    const stopped = applyCodexEventToConversation(baseConversation(), {
      type: 'stopped',
      runId: 'run-1',
      conversationId: 'conv-1',
    });

    const afterLateDelta = applyCodexEventToConversation(stopped, {
      type: 'text_delta',
      runId: 'run-1',
      conversationId: 'conv-1',
      text: '不应追加',
    });

    expect(afterLateDelta).toBe(stopped);
    expect(afterLateDelta.messages[0].blocks).toEqual([]);
  });

  it('ignores late tool starts and deltas after the turn stopped', () => {
    const stopped = applyCodexEventToConversation(baseConversation(), {
      type: 'stopped',
      runId: 'run-1',
      conversationId: 'conv-1',
    });

    const afterLateStart = applyCodexEventToConversation(stopped, {
      type: 'tool_started',
      runId: 'run-1',
      conversationId: 'conv-1',
      itemId: 'late-tool',
      title: 'execute',
      text: 'should not start',
    });
    const afterLateDelta = applyCodexEventToConversation(afterLateStart, {
      type: 'tool_delta',
      runId: 'run-1',
      conversationId: 'conv-1',
      itemId: 'late-tool',
      title: 'execute',
      text: 'should not append',
    });

    expect(afterLateStart).toBe(stopped);
    expect(afterLateDelta).toBe(stopped);
    expect(afterLateDelta.messages[0].blocks).toEqual([]);
  });

  it('tracks tool lifecycle', () => {
    const started = applyCodexEventToConversation(baseConversation(), {
      type: 'tool_started',
      runId: 'run-1',
      conversationId: 'conv-1',
      itemId: 'tool-1',
      title: 'execute',
      text: 'date',
    });
    const completed = applyCodexEventToConversation(started, {
      type: 'tool_completed',
      runId: 'run-1',
      conversationId: 'conv-1',
      itemId: 'tool-1',
      title: 'execute',
      text: 'done',
    });

    expect(completed.messages[0].blocks[0]).toMatchObject({
      type: 'tool',
      id: 'tool-1',
      status: 'completed',
      input: 'date',
      output: 'done',
    });
  });

  it('keeps one live file-edit row from approval through completion', () => {
    const approvalStarted = applyCodexEventToConversation(baseConversation(), {
      type: 'tool_started',
      runId: 'run-1',
      conversationId: 'conv-1',
      itemId: 'edit-1',
      title: 'fileChange',
    });
    const itemStarted = applyCodexEventToConversation(approvalStarted, {
      type: 'tool_started',
      runId: 'run-1',
      conversationId: 'conv-1',
      itemId: 'edit-1',
      title: 'fileChange',
      text: JSON.stringify([{ path: '/tmp/report.md', kind: 'update' }]),
    });

    expect(itemStarted.messages[0].blocks).toHaveLength(1);
    expect(itemStarted.messages[0].blocks[0]).toMatchObject({
      type: 'tool',
      id: 'edit-1',
      title: 'fileChange',
      status: 'in_progress',
      input: '[{"path":"/tmp/report.md","kind":"update"}]',
    });

    const completed = applyCodexEventToConversation(itemStarted, {
      type: 'tool_completed',
      runId: 'run-1',
      conversationId: 'conv-1',
      itemId: 'edit-1',
      title: 'fileChange',
      text: JSON.stringify([{ path: '/tmp/report.md', kind: 'update' }]),
    });
    expect(completed.messages[0].blocks).toHaveLength(1);
    expect(completed.messages[0].blocks[0]).toMatchObject({ status: 'completed' });
  });

  it('upgrades an eager command row with the semantic activity reported at item start', () => {
    const approvalStarted = applyCodexEventToConversation(baseConversation(), {
      type: 'tool_started',
      runId: 'run-1',
      conversationId: 'conv-1',
      itemId: 'read-1',
      title: 'command_execution',
      text: "/bin/zsh -lc 'sed -n 1,120p /tmp/report.md'",
    });
    const itemStarted = applyCodexEventToConversation(approvalStarted, {
      type: 'tool_started',
      runId: 'run-1',
      conversationId: 'conv-1',
      itemId: 'read-1',
      title: 'fileRead',
      text: '/tmp/report.md',
    });

    expect(itemStarted.messages[0].blocks).toHaveLength(1);
    expect(itemStarted.messages[0].blocks[0]).toMatchObject({
      type: 'tool',
      id: 'read-1',
      title: 'fileRead',
      status: 'in_progress',
      input: '/tmp/report.md',
    });
  });

  it('replaces live file-change snapshots instead of concatenating invalid JSON', () => {
    const first = applyCodexEventToConversation(baseConversation(), {
      type: 'tool_delta',
      runId: 'run-1',
      conversationId: 'conv-1',
      itemId: 'edit-1',
      title: 'fileChange',
      text: JSON.stringify([{ path: '/tmp/one.md', kind: 'add' }]),
      message: 'replace',
    });
    const second = applyCodexEventToConversation(first, {
      type: 'tool_delta',
      runId: 'run-1',
      conversationId: 'conv-1',
      itemId: 'edit-1',
      title: 'fileChange',
      text: JSON.stringify([{ path: '/tmp/two.md', kind: 'update' }]),
      message: 'replace',
    });

    expect(second.messages[0].blocks[0]).toMatchObject({
      type: 'tool',
      status: 'in_progress',
      output: '[{"path":"/tmp/two.md","kind":"update"}]',
    });
  });

  it('labels spawned coworker tools with the concrete agent name', () => {
    const started = applyCodexEventToConversation(baseConversation(), {
      type: 'tool_started',
      runId: 'run-1',
      conversationId: 'conv-1',
      itemId: 'spawn-1',
      title: 'spawnAgent',
      text: '{"agent_type":"mainline","message":"请写入 mainline.md"}',
    });
    const completed = applyCodexEventToConversation(started, {
      type: 'tool_completed',
      runId: 'run-1',
      conversationId: 'conv-1',
      itemId: 'spawn-1',
      title: 'spawnAgent',
      text: 'Generated file: /tmp/mainline.md',
    });

    expect(completed.messages[0].blocks[0]).toMatchObject({
      type: 'tool',
      id: 'spawn-1',
      title: 'spawnAgent',
      status: 'completed',
      target: 'mainline · ① 市场策略官',
      input: '{"agent_type":"mainline","message":"请写入 mainline.md"}',
      output: 'Generated file: /tmp/mainline.md',
    });
  });

  it('labels spawned coworker tools from generated coworker file names', () => {
    const completed = applyCodexEventToConversation(baseConversation(), {
      type: 'tool_completed',
      runId: 'run-1',
      conversationId: 'conv-1',
      itemId: 'spawn-2',
      title: 'spawnAgent',
      text: 'Finished /tmp/theme.md',
    });

    expect(completed.messages[0].blocks[0]).toMatchObject({
      type: 'tool',
      id: 'spawn-2',
      status: 'completed',
      target: 'theme · ② 行业主题研究员',
    });
  });

  it('surfaces generated image paths from completed imagegen tools', () => {
    const completed = applyCodexEventToConversation(baseConversation(), {
      type: 'tool_completed',
      runId: 'run-1',
      conversationId: 'conv-1',
      itemId: 'img-1',
      title: 'imagegen.imagegen',
      text: 'Generated image: /Users/geb/.codex/generated_images/cat.png',
    });

    expect(completed.messages[0].blocks).toEqual([
      {
        type: 'tool',
        id: 'img-1',
        title: 'imagegen.imagegen',
        status: 'completed',
        output: '图片已生成，结果见下方。',
      },
      {
        type: 'image_result',
        id: 'img-1-result',
        title: '生成结果',
        images: [
          {
            id: 'img-1-result-0',
            src: '/Users/geb/.codex/generated_images/cat.png',
            alt: 'cat.png',
            name: 'cat.png',
          },
        ],
      },
      {
        type: 'file_result',
        id: 'img-1-files',
        title: '生成文件',
        files: [
          {
            id: 'img-1-files-0',
            path: '/Users/geb/.codex/generated_images/cat.png',
            name: 'cat.png',
            ext: 'png',
            kind: 'image',
          },
        ],
      },
    ]);
  });

  it('surfaces inline images returned by a generic wait tool', () => {
    const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';
    const completed = applyCodexEventToConversation(baseConversation(), {
      type: 'tool_completed',
      runId: 'run-1',
      conversationId: 'conv-1',
      itemId: 'wait-1',
      title: 'wait',
      text: JSON.stringify([
        { type: 'input_text', text: 'Script completed' },
        { type: 'input_image', image_url: dataUrl },
      ]),
    });

    expect(completed.messages[0].blocks).toEqual([
      {
        type: 'tool',
        id: 'wait-1',
        title: 'wait',
        status: 'completed',
        output: '图片已生成，结果见下方。',
      },
      {
        type: 'image_result',
        id: 'wait-1-result',
        title: '生成结果',
        images: [
          {
            id: 'wait-1-result-0',
            src: dataUrl,
            alt: '生成图片',
            name: '生成图片',
          },
        ],
      },
    ]);
  });

  it('does not mistake images embedded in command output for generated results', () => {
    const output = [
      '<html><body>search result</body></html>',
      'data:image/png;base64,iVBORw0KGgo=',
      'https://www.bing.com/sa/simg/facebook_sharing_5.png',
      '/rp/unrelated-page-asset.png',
    ].join('\n');
    const completed = applyCodexEventToConversation(baseConversation(), {
      type: 'tool_completed',
      runId: 'run-1',
      conversationId: 'conv-1',
      itemId: 'exec-web-1',
      title: 'command_execution',
      text: output,
      raw: {
        item: {
          type: 'commandExecution',
          aggregatedOutput: output,
        },
      },
    });

    expect(completed.messages[0].blocks).toEqual([{
      type: 'tool',
      id: 'exec-web-1',
      title: 'command_execution',
      status: 'completed',
      output,
    }]);
  });

  it('bounds oversized tool logs while preserving the beginning and latest tail', () => {
    const output = `BEGIN\n${'x'.repeat(80_000)}\nEND`;
    const completed = applyCodexEventToConversation(baseConversation(), {
      type: 'tool_completed',
      runId: 'run-1',
      conversationId: 'conv-1',
      itemId: 'large-tool-1',
      title: 'command_execution',
      text: output,
    });
    const tool = completed.messages[0].blocks[0];

    expect(tool.type).toBe('tool');
    if (tool.type !== 'tool') throw new Error('expected a tool block');
    expect(tool.output?.length).toBe(TOOL_LOG_MAX_CHARACTERS);
    expect(tool.output).toContain('BEGIN');
    expect(tool.output).toContain('Alpha Studio 已折叠过长的工具日志');
    expect(tool.output).toContain('END');
  });

  it('surfaces native app-server imageGeneration results', () => {
    const rawResult = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';
    const savedPath = '/Users/geb/.alpha-studio/codex-home/generated_images/thread/image-generation-1.png';
    const completed = applyCodexEventToConversation(baseConversation(), {
      type: 'tool_completed',
      runId: 'run-1',
      conversationId: 'conv-1',
      itemId: 'image-generation-1',
      title: 'imageGeneration',
      text: rawResult,
      raw: {
        threadId: 'thread-1',
        item: {
          id: 'image-generation-1',
          type: 'imageGeneration',
          status: 'completed',
          revisedPrompt: 'one orange cat',
          result: rawResult,
          savedPath,
        },
      },
    });

    expect(completed.messages[0].blocks).toEqual([
      {
        type: 'tool',
        id: 'image-generation-1',
        title: 'imageGeneration',
        status: 'completed',
        output: '图片已生成，结果见下方。',
      },
      {
        type: 'image_result',
        id: 'image-generation-1-result',
        title: '生成结果',
        images: [
          {
            id: 'image-generation-1-result-0',
            src: savedPath,
            alt: 'image-generation-1.png',
            name: 'image-generation-1.png',
          },
        ],
      },
    ]);
  });

  it('shows a visible failure notice when an Image Gen turn completes without an image', () => {
    const conversation = baseConversation();
    conversation.messages.unshift({
      id: 'user-1',
      role: 'user',
      timestamp: 0,
      blocks: [{ type: 'text', content: '画一只猫' }],
      selectedSkill: { id: 'imagegen', title: 'Image Gen' },
    });

    const completed = applyCodexEventToConversation(conversation, {
      type: 'completed',
      runId: 'run-1',
      conversationId: 'conv-1',
    });

    expect(completed.messages[1].blocks).toEqual([
      { type: 'error', content: '图片生成已结束，但未收到可展示的图片结果。请重试。' },
    ]);
  });

  it('surfaces generated file paths from completed tool output', () => {
    const completed = applyCodexEventToConversation(baseConversation(), {
      type: 'tool_completed',
      runId: 'run-1',
      conversationId: 'conv-1',
      itemId: 'report-1',
      title: 'command_execution',
      text: 'Generated file: /Users/geb/reports/cat-brief.pdf',
    });

    expect(completed.messages[0].blocks).toContainEqual({
      type: 'file_result',
      id: 'report-1-files',
      title: '生成文件',
      files: [
        {
          id: 'report-1-files-0',
          path: '/Users/geb/reports/cat-brief.pdf',
          name: 'cat-brief.pdf',
          ext: 'pdf',
          kind: 'file',
        },
      ],
    });
  });

  it('does not surface temporary PDF inputs that a tool only read', () => {
    const completed = applyCodexEventToConversation(baseConversation(), {
      type: 'tool_completed',
      runId: 'run-1',
      conversationId: 'conv-1',
      itemId: 'pdf-read-1',
      title: 'command_execution',
      text: [
        'Script completed',
        'Output:',
        'FILE /var/folders/demo/T/tmp.1gyXXKvaSo/abnormal.pdf',
        'FILE /var/folders/demo/T/tmp.1gyXXKvaSo/reduction.pdf',
      ].join('\n'),
      raw: {
        type: 'exec_command',
        command: 'python read_pdfs.py /var/folders/demo/T/tmp.1gyXXKvaSo/abnormal.pdf /var/folders/demo/T/tmp.1gyXXKvaSo/reduction.pdf',
      },
    });

    expect(completed.messages[0].blocks).toEqual([
      {
        type: 'tool',
        id: 'pdf-read-1',
        title: 'command_execution',
        status: 'completed',
        command: 'python read_pdfs.py /var/folders/demo/T/tmp.1gyXXKvaSo/abnormal.pdf /var/folders/demo/T/tmp.1gyXXKvaSo/reduction.pdf',
        output: [
          'Script completed',
          'Output:',
          'FILE /var/folders/demo/T/tmp.1gyXXKvaSo/abnormal.pdf',
          'FILE /var/folders/demo/T/tmp.1gyXXKvaSo/reduction.pdf',
        ].join('\n'),
      },
    ]);
  });

  it('does not mistake source web pages containing the word 文件 for generated files', () => {
    const completed = applyCodexEventToConversation(baseConversation(), {
      type: 'tool_completed',
      runId: 'run-1',
      conversationId: 'conv-1',
      itemId: 'report-edit-1',
      title: 'fileChange',
      text: '<a href="https://www.mofcom.gov.cn/art/2026/art_c9b4c4851de94b18809007ff90d9cce0.html">国务院文件</a>',
    });

    expect(completed.messages[0].blocks).toEqual([
      {
        type: 'tool',
        id: 'report-edit-1',
        title: 'fileChange',
        status: 'completed',
        output: '<a href="https://www.mofcom.gov.cn/art/2026/art_c9b4c4851de94b18809007ff90d9cce0.html">国务院文件</a>',
      },
    ]);
  });

  it('still surfaces a remote file when the tool explicitly says it generated it', () => {
    const completed = applyCodexEventToConversation(baseConversation(), {
      type: 'tool_completed',
      runId: 'run-1',
      conversationId: 'conv-1',
      itemId: 'remote-report-1',
      title: 'export_report',
      text: 'Generated file: https://cdn.example.com/research/report.pdf',
    });

    expect(completed.messages[0].blocks).toContainEqual({
      type: 'file_result',
      id: 'remote-report-1-files',
      title: '生成文件',
      files: [{
        id: 'remote-report-1-files-0',
        path: 'https://cdn.example.com/research/report.pdf',
        name: 'report.pdf',
        ext: 'pdf',
        kind: 'file',
      }],
    });
  });

  it('keeps the daily-theme tracking sidecar hidden from generated file cards', () => {
    const completed = applyCodexEventToConversation(baseConversation(), {
      type: 'tool_completed',
      runId: 'run-1',
      conversationId: 'conv-1',
      itemId: 'report-1',
      title: 'command_execution',
      text: [
        'Generated file: /Users/geb/reports/index.html',
        'Generated file: /Users/geb/reports/.alpha-studio-tracking.json',
      ].join('\n'),
    });

    const fileBlock = completed.messages[0].blocks.find((block) => block.type === 'file_result');
    expect(fileBlock).toMatchObject({
      files: [{ path: '/Users/geb/reports/index.html' }],
    });
  });

  it('does not surface existing files from read-only tool metadata', () => {
    const completed = applyCodexEventToConversation(baseConversation(), {
      type: 'tool_completed',
      runId: 'run-1',
      conversationId: 'conv-1',
      itemId: 'skill-read',
      title: 'command_execution',
      text: 'Read skill instructions.',
      raw: {
        type: 'exec_command',
        path: '/Users/geb/.codex/skills/.system/imagegen/SKILL.md',
        command: "sed -n '1,240p' /Users/geb/.codex/skills/.system/imagegen/SKILL.md",
      },
    });

    expect(completed.messages[0].blocks).toEqual([
      {
        type: 'tool',
        id: 'skill-read',
        title: 'command_execution',
        status: 'completed',
        command: "sed -n '1,240p' /Users/geb/.codex/skills/.system/imagegen/SKILL.md",
        output: 'Read skill instructions.',
      },
    ]);
  });

  it('marks failed tools without losing their output', () => {
    const started = applyCodexEventToConversation(baseConversation(), {
      type: 'tool_started',
      runId: 'run-1',
      conversationId: 'conv-1',
      itemId: 'tool-1',
      title: 'execute',
      text: 'npm test',
    });
    const failed = applyCodexEventToConversation(started, {
      type: 'tool_failed',
      runId: 'run-1',
      conversationId: 'conv-1',
      itemId: 'tool-1',
      title: 'execute',
      text: '1 failed',
    });

    expect(failed.messages[0].blocks[0]).toMatchObject({
      type: 'tool',
      id: 'tool-1',
      status: 'failed',
      input: 'npm test',
      output: '1 failed',
    });
  });

  it('finishes and marks error states', () => {
    const errored = applyCodexEventToConversation(baseConversation(), {
      type: 'error',
      runId: 'run-1',
      conversationId: 'conv-1',
      message: 'bad',
    });

    expect(errored.status).toBe('error');
    expect(errored.messages[0].isStreaming).toBe(false);
    expect(errored.messages[0].blocks[0]).toEqual({ type: 'error', content: 'bad' });
  });

  it('shows retry status without ending the turn', () => {
    const conversation = { ...baseConversation(), runId: 'run-1' };
    const next = applyCodexEventToConversation(conversation, {
      type: 'status',
      runId: 'run-1',
      conversationId: 'conv-1',
      message: 'Provider 正在重试',
    });

    expect(next.status).toBe('streaming');
    expect(next.runId).toBe('run-1');
    expect(next.messages[0].isStreaming).toBe(true);
    expect(next.messages[0].blocks[0]).toEqual({ type: 'error', content: 'Provider 正在重试' });
  });

  it('updates reconnect progress in place instead of appending another status', () => {
    const conversation = { ...baseConversation(), runId: 'run-1' };
    const first = applyCodexEventToConversation(conversation, {
      type: 'status',
      runId: 'run-1',
      conversationId: 'conv-1',
      message: 'Reconnecting... 1/5',
    });
    const second = applyCodexEventToConversation(first, {
      type: 'status',
      runId: 'run-1',
      conversationId: 'conv-1',
      message: 'Reconnecting... 2/5',
    });

    expect(second.messages[0].blocks).toEqual([
      { type: 'error', content: 'Reconnecting... 2/5' },
    ]);
  });
});
