import type { CodexChatEvent, ToolBlock, ToolFileChange } from './types';

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export function fileChangeKind(value: unknown): ToolFileChange['kind'] {
  const kind = String(record(value)?.type ?? value ?? '').toLowerCase();
  if (/add|create|new/.test(kind)) return 'add';
  if (/delete|remove/.test(kind)) return 'delete';
  if (/rename|move/.test(kind) || record(value)?.move_path || record(value)?.movePath) return 'rename';
  if (/update|edit|modify|change|write/.test(kind)) return 'update';
  return 'unknown';
}

export function toolEventMetadata(event: CodexChatEvent): Partial<ToolBlock> {
  const raw = record(event.raw);
  const item = record(raw?.item) ?? raw;
  const command = typeof item?.command === 'string' ? item.command : undefined;
  const cwd = typeof item?.cwd === 'string' ? item.cwd : undefined;
  const durationMs = item?.durationMs;
  const hasDuration = (event.type === 'tool_completed' || event.type === 'tool_failed')
    && typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs >= 0;
  let changes = item?.changes;
  if (!Array.isArray(changes) && /file.?change|apply.?patch/i.test(event.title ?? '')) {
    try { changes = JSON.parse(event.text ?? ''); } catch { /* Legacy patch text is rendered separately. */ }
  }
  const fileChanges: ToolFileChange[] = [];
  if (Array.isArray(changes)) {
    for (const change of changes) {
      const entry = record(change);
      if (typeof entry?.path !== 'string') continue;
      const diff = typeof entry.diff === 'string' ? entry.diff : '';
      const lines = diff.split('\n');
      const movePath = record(entry.kind)?.move_path ?? record(entry.kind)?.movePath;
      fileChanges.push({
        path: typeof movePath === 'string' ? movePath : entry.path,
        kind: fileChangeKind(entry.kind),
        // Count before clipping so large diffs keep accurate summaries.
        additions: typeof entry.additions === 'number' ? Math.max(0, entry.additions) : lines.filter(line => line.startsWith('+') && !line.startsWith('+++')).length,
        deletions: typeof entry.deletions === 'number' ? Math.max(0, entry.deletions) : lines.filter(line => line.startsWith('-') && !line.startsWith('---')).length,
        ...(diff ? { diff: diff.length > 16_000 ? `${diff.slice(0, 16_000)}\n…差异过长，已截取预览` : diff } : {}),
      });
    }
  }
  return {
    ...(command ? { command } : {}),
    ...(cwd ? { cwd } : {}),
    ...(hasDuration ? { durationMs } : {}),
    ...(Array.isArray(changes) ? { fileChanges } : {}),
  };
}

// This identifies an explicit write *command*, never proof that a file exists.
// Do not infer writes from arbitrary tool names (e.g. create_thread/update_plan)
// or commands that merely search/read source containing write expressions.
export function isFileWriteCommand(command: string): boolean {
  const script = command.replace(/^\s*(?:\/\S+\/)?(?:ba|z)?sh\s+-\w*c\s+['"]?/, '').trim();
  if (/^(?:cat|printf|echo)\b/.test(script)) {
    let quote = '';
    for (let index = 0; index < script.length; index += 1) {
      const char = script[index];
      if (char === '\\' && quote !== "'") { index += 1; continue; }
      if (quote) { if (char === quote) quote = ''; continue; }
      if (char === '"' || char === "'") { quote = char; continue; }
      if (char === '\n') break; // Never inspect heredoc content as shell syntax.
      if (char !== '>') continue;
      const rest = script.slice(index + (script[index + 1] === '>' ? 2 : 1)).trimStart();
      const target = /^(["'])(.*?)\1/.exec(rest)?.[2] ?? /^([^\s;|&]+)/.exec(rest)?.[1] ?? '';
      if (target && !/^(?:[>&(]|\/(?:dev|proc|sys)\/)/.test(target)) return true;
    }
    return false;
  }
  if (/^(?:\S*\/)?python[\d.]*\s/.test(script)) {
    return /\.(?:write_text|write_bytes)\s*\(|\bopen\s*\([^,\n]+,\s*["'][wax][b+t]*["']|\.to_(?:csv|excel|html|parquet)\s*\(/.test(script);
  }
  if (/^(?:\S*\/)?node\s/.test(script)) return /\b(?:writeFileSync|writeFile|appendFileSync|appendFile)\s*\(/.test(script);
  return false;
}
