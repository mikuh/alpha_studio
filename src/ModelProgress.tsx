import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Code2, FileCode2, Globe, Search, Terminal, Users } from 'lucide-react';
import type { GatewayActivity, ModelRequestProgress } from './types';

export function preparingToolLabel(name = ''): string {
  if (/apply_patch|file.?write|write_file|edit_file/i.test(name)) return '准备修改文件';
  if (/exec|shell|terminal|python|command/i.test(name)) return '准备运行命令';
  if (/search|browse|web|fetch/i.test(name)) return '准备搜索网页';
  if (/read|open|view/i.test(name)) return '准备读取文件';
  return '正在准备操作';
}

// Tool identifiers are routing details, including when a generated script
// contains a call to another tool. Keep them out of the compact activity row.
function displayPreview(value: string): string {
  return value.replace(/\b(?:(?:functions|tools)\.)?[\w]*\b(?:exec_command|apply_patch|web__run|write_stdin)\b/g,
    name => preparingToolLabel(name).replace(/^准备/, ''))
    .replace(/\s+/g, ' ');
}

export function ModelProgressRow({ progress }: { progress: ModelRequestProgress }) {
  const viewport = useRef<HTMLSpanElement>(null);
  const preview = displayPreview(progress.preview);
  useLayoutEffect(() => {
    const element = viewport.current;
    if (element) element.scrollLeft = element.scrollWidth;
  }, [preview]);
  const label = progress.kind === 'tool_input' ? preparingToolLabel(progress.toolName)
    : progress.kind === 'reply' ? '正在整理内容'
    : progress.kind === 'search' ? '正在搜索网页' : '正在推理';
  const Icon = progress.subagent ? Users : /命令/.test(label) ? Terminal
    : /修改/.test(label) ? FileCode2 : /网页/.test(label) ? Globe : /读取/.test(label) ? Search : Code2;
  return (
    <div className="model-progress-row event-summary" aria-label={progress.subagent ? '子任务实时进展' : '工具准备进度'} aria-live="off"
      title={progress.kind === 'tool_input' ? '正在生成参数，尚未执行' : undefined}>
      <span className="event-icon"><Icon size={14} /></span>
      <span className="event-verb">{progress.subagent ? '子任务 · ' : ''}{label}</span>
      <span className="model-progress-viewport" ref={viewport}>
        <span className="model-progress-text">{preview}<span className="model-progress-caret" aria-hidden="true" /></span>
      </span>
      {progress.characters > 0 && <span className="model-progress-count" title={`已生成 ${progress.characters.toLocaleString('zh-CN')} 字符`}>
        {progress.characters.toLocaleString('zh-CN')} 字符
      </span>}
    </div>
  );
}

export function ModelProgressRows({ gateway }: { gateway?: GatewayActivity }) {
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    setExpired(false);
    if (!gateway) return;
    const timer = window.setTimeout(() => setExpired(true), Math.max(0, gateway.observedAt + 20_000 - Date.now()));
    return () => window.clearTimeout(timer);
  }, [gateway?.observedAt]);
  if (!gateway || expired || Date.now() - gateway.observedAt >= 20_000) return null;
  return gateway.requestProgress?.filter(progress => progress.subagent || progress.kind === 'tool_input')
    .map(progress => <ModelProgressRow key={progress.id} progress={progress} />);
}
