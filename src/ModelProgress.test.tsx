import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ModelProgressRow } from './ModelProgress';
import type { ModelRequestProgress } from './types';

afterEach(cleanup);

const progress: ModelRequestProgress = { id: 'call-a', subagent: false, kind: 'tool_input', toolName: 'exec_command', characters: 10, preview: 'python', updatedAt: 1 };

describe('model preparation row', () => {
  it('keeps the latest received characters in view without showing tool identifiers', () => {
    const { container, rerender } = render(<ModelProgressRow progress={progress} />);
    const viewport = container.querySelector('.model-progress-viewport')!;
    Object.defineProperty(viewport, 'scrollWidth', { configurable: true, value: 1400 });
    rerender(<ModelProgressRow progress={{ ...progress, characters: 100, preview: 'tools.exec_command({cmd: "python report.py"})' }} />);
    expect(viewport.scrollLeft).toBe(1400);
    expect(screen.getByLabelText('工具准备进度')).toHaveTextContent('准备运行命令');
    expect(screen.getByLabelText('工具准备进度')).toHaveTextContent('python report.py');
    expect(container).not.toHaveTextContent('exec_command');
  });

  it('uses a neutral action until the tool can be identified', () => {
    render(<ModelProgressRow progress={{ ...progress, toolName: 'mcp__unknown__action' }} />);
    expect(screen.getByLabelText('工具准备进度')).toHaveTextContent('正在准备操作');
    expect(screen.getByLabelText('工具准备进度')).not.toHaveTextContent('mcp__');
  });
});
