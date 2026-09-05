import { useEffect, useState } from 'react';
import type { ChatMessage } from './types';

export function formatTurnDuration(seconds: number): string {
  const value = Math.max(0, Math.floor(seconds));
  if (value < 60) return `${value}秒`;
  const minutes = Math.floor(value / 60);
  const remainder = value % 60;
  if (minutes < 60) return `${minutes}分${remainder ? `${remainder}秒` : ''}`;
  return `${Math.floor(minutes / 60)}小时${minutes % 60 ? `${minutes % 60}分` : ''}`;
}

// Keep the clock local so ticking never reparses the transcript's Markdown.
export function TurnDuration({ message }: { message: ChatMessage }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!message.isStreaming) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [message.id, message.isStreaming]);

  // Older transcripts have no end timestamp; don't invent their duration.
  if (!message.isStreaming && message.finishedAt === undefined) return null;
  const elapsed = ((message.isStreaming ? now : message.finishedAt!) - message.timestamp) / 1000;
  return (
    <div className="turn-duration" aria-label={`处理耗时 ${formatTurnDuration(elapsed)}`}>
      <span>已处理 {formatTurnDuration(elapsed)}</span>
      {message.finishReason === 'stopped' && <span className="turn-outcome">已停止</span>}
      {message.finishReason === 'error' && <span className="turn-outcome failed">未完成</span>}
    </div>
  );
}
