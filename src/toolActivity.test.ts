import { describe, expect, it } from 'vitest';
import { isFileWriteCommand, toolEventMetadata } from './toolActivity';

describe('file activity metadata', () => {
  it('preserves all native file names and hunk statistics before truncating long diffs', () => {
    const diff = `@@ -1 +1 @@\n-old\n${'+new\n'.repeat(5000)}`;
    const result = toolEventMetadata({ type: 'tool_completed', runId: 'r', title: 'fileChange', raw: { item: { changes: [
      { path: '/tmp/report.html', kind: { type: 'add' }, diff },
      { path: '/tmp/old.md', kind: { type: 'update', move_path: '/tmp/new.md' }, diff: '@@ -1 +1 @@\n-a\n+b' },
    ] } } });
    expect(result.fileChanges).toHaveLength(2);
    expect(result.fileChanges?.[0]).toMatchObject({ path: '/tmp/report.html', kind: 'add', additions: 5000, deletions: 1 });
    expect(result.fileChanges?.[0].diff?.length).toBeLessThan(16_100);
    expect(result.fileChanges?.[1]).toMatchObject({ path: '/tmp/new.md', kind: 'rename', additions: 1, deletions: 1 });
  });

  it.each([
    'cat > report.html <<\'EOF\'\n<html>report</html>\nEOF',
    '/bin/zsh -lc "cat <<\'EOF\' > /tmp/report.html\nhello\nEOF"',
    'python3 - <<\'PY\'\nPath("report.html").write_text(html)\nPY',
    'node -e \'fs.writeFileSync("report.html", html)\'',
  ])('recognizes an explicit write command: %s', command => {
    expect(isFileWriteCommand(command)).toBe(true);
  });

  it.each([
    'cat /tmp/report.html',
    'rg "write_text" script.py',
    'python3 -c \'print(Path("report.html").read_text())\'',
    'cat report.html > /dev/null',
    'python3 render_report.py',
    'echo "example > report.html"',
    'cat <<\'EOF\'\nexample > report.html\nEOF',
  ])('does not invent write activity from a read or unknown script: %s', command => {
    expect(isFileWriteCommand(command)).toBe(false);
  });
});
