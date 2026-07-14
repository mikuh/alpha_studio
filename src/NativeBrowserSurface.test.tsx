import { cleanup, render, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NativeBrowserSurface } from './NativeBrowserSurface';
import {
  browserWebviewAction,
  browserWebviewClose,
  browserWebviewCreate,
  browserWebviewNavigate,
  browserWebviewSetBounds,
  subscribeBrowserWebviewEvents,
  type BrowserWebviewEvent,
} from './codexBridge';

const eventMocks = vi.hoisted(() => ({
  handler: null as ((event: BrowserWebviewEvent) => void) | null,
  unlisten: vi.fn(),
}));

vi.mock('./codexBridge', () => ({
  browserWebviewAction: vi.fn(() => Promise.resolve()),
  browserWebviewClose: vi.fn(() => Promise.resolve()),
  browserWebviewCreate: vi.fn(() => Promise.resolve()),
  browserWebviewNavigate: vi.fn(() => Promise.resolve()),
  browserWebviewSetBounds: vi.fn(() => Promise.resolve()),
  subscribeBrowserWebviewEvents: vi.fn((handler: (event: BrowserWebviewEvent) => void) => {
    eventMocks.handler = handler;
    return Promise.resolve(eventMocks.unlisten);
  }),
}));

describe('NativeBrowserSurface', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 300,
      y: 120,
      top: 120,
      left: 300,
      right: 1020,
      bottom: 720,
      width: 720,
      height: 600,
      toJSON: () => ({}),
    });
  });

  afterEach(() => {
    cleanup();
    eventMocks.handler = null;
    eventMocks.unlisten.mockReset();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('creates, navigates, hides, and closes its native child webview', async () => {
    const onEvent = vi.fn();
    const onError = vi.fn();
    const view = render(
      <NativeBrowserSurface id="dock-test" url="https://example.com" visible onEvent={onEvent} onError={onError} />,
    );

    await waitFor(() => expect(browserWebviewCreate).toHaveBeenCalledWith(
      'dock-test',
      'https://example.com',
      { x: 300, y: 120, width: 720, height: 600 },
      true,
    ));
    expect(subscribeBrowserWebviewEvents).toHaveBeenCalledOnce();

    eventMocks.handler?.({ id: 'dock-test', type: 'load-finished', url: 'https://example.com/next' });
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'load-finished' }));

    view.rerender(
      <NativeBrowserSurface id="dock-test" url="https://openai.com" visible onEvent={onEvent} onError={onError} />,
    );
    await waitFor(() => expect(browserWebviewNavigate).toHaveBeenCalledWith('dock-test', 'https://openai.com'));

    view.rerender(
      <NativeBrowserSurface id="dock-test" url="https://openai.com" visible={false} onEvent={onEvent} onError={onError} />,
    );
    await waitFor(() => expect(browserWebviewAction).toHaveBeenCalledWith('dock-test', 'hide'));

    view.unmount();
    expect(browserWebviewClose).toHaveBeenCalledWith('dock-test');
    expect(eventMocks.unlisten).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
  });

  it('resizes an existing native webview when its host layout changes', async () => {
    render(
      <NativeBrowserSurface id="dock-resize" url="https://example.com" visible onEvent={vi.fn()} onError={vi.fn()} />,
    );
    await waitFor(() => expect(browserWebviewCreate).toHaveBeenCalledOnce());

    window.dispatchEvent(new Event('resize'));

    await waitFor(() => expect(browserWebviewSetBounds).toHaveBeenCalledWith(
      'dock-resize',
      { x: 300, y: 120, width: 720, height: 600 },
      true,
    ));
  });

  it('recreates the child webview after the development StrictMode lifecycle check', async () => {
    render(
      <StrictMode>
        <NativeBrowserSurface id="dock-strict" url="https://example.com" visible onEvent={vi.fn()} onError={vi.fn()} />
      </StrictMode>,
    );

    await waitFor(() => expect(browserWebviewCreate).toHaveBeenCalledTimes(2));
    expect(browserWebviewClose).toHaveBeenCalledWith('dock-strict');
  });
});
