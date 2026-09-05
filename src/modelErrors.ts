export function modelErrorPresentation(message: string): { message: string; detail?: string } {
  if (/stream disconnected before completion|error decoding response body|upstream_stream_error|connection (?:reset|closed)|unexpected (?:eof|end of file)/i.test(message)) {
    return {
      message: '模型连接在响应完成前中断，已保留收到的内容。可以继续当前任务。',
      detail: message,
    };
  }
  return { message };
}
