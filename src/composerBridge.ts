// Bridges side panels (e.g. the research workbench) to the chat composer
// without prop drilling: the most recently mounted composer receives inserts,
// so one-click "交给 Agent" works alongside drag & drop.
type ComposerInsertHandler = (text: string) => void;

const handlers: ComposerInsertHandler[] = [];

export function registerComposerInsertHandler(handler: ComposerInsertHandler): () => void {
  handlers.push(handler);
  return () => {
    const index = handlers.lastIndexOf(handler);
    if (index >= 0) handlers.splice(index, 1);
  };
}

export function insertIntoComposer(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const handler = handlers[handlers.length - 1];
  if (!handler) return false;
  handler(trimmed);
  return true;
}
