import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserPdfViewer } from './BrowserPdfViewer';
import { localPdfFileRead } from './codexBridge';

const pdfMocks = vi.hoisted(() => {
  const WorkerMessageHandler = {};
  const renderPage = vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() }));
  const page = {
    getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 840 * scale }),
    render: renderPage,
  };
  const document = {
    numPages: 10,
    getPage: vi.fn(() => Promise.resolve(page)),
    destroy: vi.fn(() => Promise.resolve()),
  };
  return { document, renderPage, WorkerMessageHandler };
});

vi.mock('./codexBridge', () => ({
  localPdfFileRead: vi.fn(),
}));

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: vi.fn(() => ({ promise: Promise.resolve(pdfMocks.document) })),
}));

vi.mock('pdfjs-dist/legacy/build/pdf.worker.min.mjs', () => ({
  WorkerMessageHandler: pdfMocks.WorkerMessageHandler,
}));

class TestResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: Element) {
    Object.defineProperty(target, 'clientWidth', { configurable: true, value: 720 });
    this.callback([], this as unknown as ResizeObserver);
  }

  disconnect() {}

  unobserve() {}
}

describe('BrowserPdfViewer', () => {
  beforeEach(() => {
    delete (globalThis as typeof globalThis & { pdfjsWorker?: unknown }).pdfjsWorker;
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
    vi.mocked(localPdfFileRead).mockResolvedValue({
      path: '/tmp/report.pdf',
      data: 'JVBERi0=',
      bytes: 5,
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('binds the page stage after loading and renders the first page into a sized canvas', async () => {
    const { getByLabelText } = render(
      <BrowserPdfViewer path="/tmp/report.pdf" revision={1} onOpenExternal={vi.fn()} />,
    );

    await waitFor(() => expect(pdfMocks.renderPage).toHaveBeenCalled());

    const canvas = getByLabelText('PDF 第 1 页') as HTMLCanvasElement;
    expect(canvas.width).toBeGreaterThan(300);
    expect(canvas.height).toBeGreaterThan(150);
    expect(canvas.style.width).toBe('672px');
    expect(canvas.style.height).toBe('940px');
    expect(document.querySelectorAll('[data-pdf-page]')).toHaveLength(10);
    expect((globalThis as typeof globalThis & {
      pdfjsWorker?: { WorkerMessageHandler: unknown };
    }).pdfjsWorker?.WorkerMessageHandler).toBe(pdfMocks.WorkerMessageHandler);
  });

  it('updates the toolbar page while scrolling through the continuous document', async () => {
    const { container, getByLabelText } = render(
      <BrowserPdfViewer path="/tmp/report.pdf" revision={1} onOpenExternal={vi.fn()} />,
    );
    await waitFor(() => expect(container.querySelectorAll('[data-pdf-page]')).toHaveLength(10));

    const stage = container.querySelector('.browser-pdf-stage') as HTMLDivElement;
    const pages = Array.from(container.querySelectorAll<HTMLElement>('[data-pdf-page]'));
    stage.getBoundingClientRect = () => ({ top: 0, bottom: 600 } as DOMRect);
    pages.forEach((page, index) => {
      page.getBoundingClientRect = () => index === 1
        ? ({ top: 10, bottom: 590 } as DOMRect)
        : ({ top: 700 + index * 900, bottom: 1500 + index * 900 } as DOMRect);
    });

    fireEvent.scroll(stage);

    await waitFor(() => expect(getByLabelText('当前页码')).toHaveValue('2'));
  });
});
