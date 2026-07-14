import { useLayoutEffect, useRef } from 'react';
import {
  browserWebviewAction,
  browserWebviewClose,
  browserWebviewCreate,
  browserWebviewNavigate,
  browserWebviewSetBounds,
  subscribeBrowserWebviewEvents,
  type BrowserWebviewBounds,
  type BrowserWebviewEvent,
} from './codexBridge';

type NativeBrowserSurfaceProps = {
  id: string;
  url: string;
  visible: boolean;
  onEvent: (event: BrowserWebviewEvent) => void;
  onError: (error: unknown) => void;
};

function elementBounds(element: HTMLElement): BrowserWebviewBounds | null {
  const rect = element.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return null;
  return {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

export function NativeBrowserSurface({ id, url, visible, onEvent, onError }: NativeBrowserSurfaceProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const createdRef = useRef(false);
  const creatingRef = useRef<Promise<void> | null>(null);
  const closingRef = useRef<Promise<void> | null>(null);
  const creationGenerationRef = useRef(0);
  const currentUrlRef = useRef('');
  const urlRef = useRef(url);
  const visibleRef = useRef(visible);
  const onEventRef = useRef(onEvent);
  const onErrorRef = useRef(onError);
  urlRef.current = url;
  visibleRef.current = visible;
  onEventRef.current = onEvent;
  onErrorRef.current = onError;

  useLayoutEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void subscribeBrowserWebviewEvents((event) => {
      if (disposed || event.id !== id) return;
      if (event.url && (event.type === 'load-started' || event.type === 'load-finished')) {
        currentUrlRef.current = event.url;
      }
      onEventRef.current(event);
    }).then((unsubscribe) => {
      if (disposed) unsubscribe();
      else unlisten = unsubscribe;
    }).catch((error) => {
      if (!disposed) onErrorRef.current(error);
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [id]);

  useLayoutEffect(() => () => {
    creationGenerationRef.current += 1;
    createdRef.current = false;
    creatingRef.current = null;
    currentUrlRef.current = '';
    const closing = browserWebviewClose(id).catch(() => undefined);
    closingRef.current = closing;
    void closing.then(() => {
      if (closingRef.current === closing) closingRef.current = null;
    });
  }, [id]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;

    const sync = async () => {
      if (disposed) return;
      if (closingRef.current) await closingRef.current;
      if (disposed) return;
      if (!visibleRef.current) {
        if (createdRef.current) await browserWebviewAction(id, 'hide');
        return;
      }
      const bounds = elementBounds(host);
      if (!bounds) return;
      if (!createdRef.current) {
        if (!creatingRef.current) {
          const generation = creationGenerationRef.current + 1;
          creationGenerationRef.current = generation;
          const creation = browserWebviewCreate(id, urlRef.current, bounds, true)
            .then(() => {
              if (creationGenerationRef.current !== generation) return;
              createdRef.current = true;
              currentUrlRef.current = urlRef.current;
            });
          creatingRef.current = creation;
          const clearCreation = () => {
            if (creatingRef.current === creation) creatingRef.current = null;
          };
          void creation.then(clearCreation, clearCreation);
        }
        await creatingRef.current;
        return;
      }
      await browserWebviewSetBounds(id, bounds, true);
      if (currentUrlRef.current !== urlRef.current) {
        currentUrlRef.current = urlRef.current;
        await browserWebviewNavigate(id, urlRef.current);
      }
    };

    const runSync = () => { void sync().catch(onErrorRef.current); };
    runSync();
    const observer = new ResizeObserver(runSync);
    observer.observe(host);
    window.addEventListener('resize', runSync);
    window.addEventListener('scroll', runSync, true);
    return () => {
      disposed = true;
      observer.disconnect();
      window.removeEventListener('resize', runSync);
      window.removeEventListener('scroll', runSync, true);
    };
  }, [id, url, visible]);

  return <div ref={hostRef} className="browser-native-host" aria-label="网页内容" />;
}
