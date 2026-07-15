import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ChevronLeft, ChevronRight, ExternalLink, Loader2, Minus, Plus } from 'lucide-react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { localPdfFileRead } from './codexBridge';

type BrowserPdfViewerProps = {
  path: string;
  revision: number;
  onOpenExternal: () => void;
};

type PdfStatus = 'loading' | 'ready' | 'error';

type PdfJsWorkerGlobal = typeof globalThis & {
  pdfjsWorker?: {
    WorkerMessageHandler: unknown;
  };
};

type BrowserPdfPageProps = {
  document: PDFDocumentProxy;
  pageNumber: number;
  stageElement: HTMLDivElement | null;
  stageWidth: number;
  zoom: number;
  registerPage: (pageNumber: number, element: HTMLDivElement | null) => void;
  onError: (reason: unknown) => void;
};

function base64Bytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

const BrowserPdfPage = memo(function BrowserPdfPage({
  document,
  pageNumber,
  stageElement,
  stageWidth,
  zoom,
  registerPage,
  onError,
}: BrowserPdfPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const paperRef = useRef<HTMLDivElement | null>(null);
  const [nearViewport, setNearViewport] = useState(pageNumber === 1);
  const [aspectRatio, setAspectRatio] = useState(1.414);
  const [rendering, setRendering] = useState(pageNumber === 1);

  const setPaperRef = useCallback((element: HTMLDivElement | null) => {
    paperRef.current = element;
    registerPage(pageNumber, element);
  }, [pageNumber, registerPage]);

  useEffect(() => {
    const paper = paperRef.current;
    if (!paper || !stageElement || nearViewport) return;
    if (typeof IntersectionObserver === 'undefined') {
      setNearViewport(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setNearViewport(true);
        observer.disconnect();
      }
    }, { root: stageElement, rootMargin: '900px 0px' });
    observer.observe(paper);
    return () => observer.disconnect();
  }, [nearViewport, stageElement]);

  useEffect(() => {
    if (!nearViewport || !stageWidth || !canvasRef.current) return;
    let disposed = false;
    let renderTask: RenderTask | null = null;
    setRendering(true);
    void document.getPage(pageNumber).then((page) => {
      if (disposed || !canvasRef.current) return;
      const baseViewport = page.getViewport({ scale: 1 });
      setAspectRatio(baseViewport.height / baseViewport.width);
      const fitScale = Math.max(0.25, (stageWidth - 48) / baseViewport.width);
      const viewport = page.getViewport({ scale: fitScale * zoom });
      const outputScale = Math.min(window.devicePixelRatio || 1, 2);
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('无法创建 PDF 画布。');
      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      renderTask = page.render({
        canvas,
        canvasContext: context,
        viewport,
        transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
      });
      return renderTask.promise;
    }).then(() => {
      if (!disposed) setRendering(false);
    }).catch((reason: unknown) => {
      if (disposed || (reason instanceof Error && reason.name === 'RenderingCancelledException')) return;
      setRendering(false);
      onError(reason);
    });
    return () => {
      disposed = true;
      renderTask?.cancel();
    };
  }, [document, nearViewport, onError, pageNumber, stageWidth, zoom]);

  const placeholderWidth = Math.max(240, Math.floor((stageWidth - 48) * zoom));
  const placeholderHeight = Math.max(240, Math.floor(placeholderWidth * aspectRatio));

  return (
    <div
      ref={setPaperRef}
      className={`browser-pdf-paper${rendering ? ' loading' : ''}`}
      data-pdf-page={pageNumber}
      style={{ minWidth: `${placeholderWidth}px`, minHeight: `${placeholderHeight}px` }}
    >
      <canvas ref={canvasRef} aria-label={`PDF 第 ${pageNumber} 页`} />
      {!nearViewport ? <span className="browser-pdf-page-placeholder">第 {pageNumber} 页</span> : null}
    </div>
  );
});

export function BrowserPdfViewer({ path, revision, onOpenExternal }: BrowserPdfViewerProps) {
  const pageStageRef = useRef<HTMLDivElement>(null);
  const pageElementsRef = useRef(new Map<number, HTMLDivElement>());
  const scrollFrameRef = useRef<number | null>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [status, setStatus] = useState<PdfStatus>('loading');
  const [error, setError] = useState('');
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [stageWidth, setStageWidth] = useState(0);
  const [stageElement, setStageElement] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    let disposed = false;
    let loadedDocument: PDFDocumentProxy | null = null;
    setStatus('loading');
    setError('');
    setDocument(null);
    setPageNumber(1);

    void Promise.all([
      import('pdfjs-dist/legacy/build/pdf.mjs'),
      import('pdfjs-dist/legacy/build/pdf.worker.min.mjs'),
      localPdfFileRead(path),
    ])
      .then(async ([pdfjs, pdfWorker, file]) => {
        if (!file.data) throw new Error('无法读取 PDF 文件内容。');
        // WKWebView cannot reliably import PDF.js' emitted `.mjs` module as a
        // module Worker from Tauri's custom application protocol. Registering
        // the bundled handler lets PDF.js use its in-process transport instead
        // of attempting the unsupported external Worker/fallback import.
        (globalThis as PdfJsWorkerGlobal).pdfjsWorker = {
          WorkerMessageHandler: pdfWorker.WorkerMessageHandler,
        };
        const loadingTask = pdfjs.getDocument({ data: base64Bytes(file.data) });
        const pdf = await loadingTask.promise;
        if (disposed) {
          await pdf.destroy();
          return;
        }
        loadedDocument = pdf;
        setDocument(pdf);
        setStatus('ready');
      })
      .catch((reason: unknown) => {
        if (disposed) return;
        setStatus('error');
        setError(reason instanceof Error ? reason.message : String(reason || 'PDF 加载失败。'));
      });

    return () => {
      disposed = true;
      if (loadedDocument) void loadedDocument.destroy();
    };
  }, [path, revision]);

  useLayoutEffect(() => {
    if (status !== 'ready') return;
    const stage = pageStageRef.current;
    if (!stage) return;
    const updateWidth = () => setStageWidth(stage.clientWidth);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [status]);

  const registerPage = useCallback((number: number, element: HTMLDivElement | null) => {
    if (element) pageElementsRef.current.set(number, element);
    else pageElementsRef.current.delete(number);
  }, []);

  const handleRenderError = useCallback((reason: unknown) => {
    setStatus('error');
    setError(reason instanceof Error ? reason.message : 'PDF 页面渲染失败。');
  }, []);

  const updateVisiblePage = useCallback(() => {
    const stage = pageStageRef.current;
    if (!stage) return;
    const stageRect = stage.getBoundingClientRect();
    let visiblePage = 1;
    let greatestVisibleHeight = 0;
    for (const [number, element] of pageElementsRef.current) {
      const rect = element.getBoundingClientRect();
      const visibleHeight = Math.max(0, Math.min(rect.bottom, stageRect.bottom) - Math.max(rect.top, stageRect.top));
      if (visibleHeight > greatestVisibleHeight) {
        greatestVisibleHeight = visibleHeight;
        visiblePage = number;
      }
    }
    if (greatestVisibleHeight > 0) {
      setPageNumber((current) => current === visiblePage ? current : visiblePage);
    }
  }, []);

  const handleScroll = useCallback(() => {
    if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      updateVisiblePage();
    });
  }, [updateVisiblePage]);

  useEffect(() => () => {
    if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
  }, []);

  const scrollToPage = useCallback((nextPage: number, behavior: ScrollBehavior = 'smooth') => {
    if (!document) return;
    const normalizedPage = Math.min(document.numPages, Math.max(1, Math.round(nextPage)));
    setPageNumber(normalizedPage);
    const stage = pageStageRef.current;
    const page = pageElementsRef.current.get(normalizedPage);
    if (!stage || !page) return;
    const stageRect = stage.getBoundingClientRect();
    const pageRect = page.getBoundingClientRect();
    stage.scrollTo({ top: stage.scrollTop + pageRect.top - stageRect.top - 24, behavior });
  }, [document]);

  const changePage = useCallback((nextPage: number) => {
    scrollToPage(nextPage);
  }, [scrollToPage]);

  const changeZoom = useCallback((delta: number) => {
    setZoom((current) => Math.min(3, Math.max(0.5, Math.round((current + delta) * 10) / 10)));
  }, []);

  const pageNumbers = useMemo(
    () => document ? Array.from({ length: document.numPages }, (_, index) => index + 1) : [],
    [document],
  );

  const setPageStageRef = useCallback((element: HTMLDivElement | null) => {
    pageStageRef.current = element;
    setStageElement(element);
  }, []);

  if (status === 'loading') {
    return (
      <div className="browser-frame-status" role="status">
        <Loader2 size={20} className="spin" />
        <strong>正在打开 PDF</strong>
        <span>{path}</span>
      </div>
    );
  }

  if (status === 'error' || !document) {
    return (
      <div className="browser-frame-status error" role="alert">
        <AlertCircle size={20} />
        <strong>PDF 无法显示</strong>
        <span>{error || 'PDF 文档没有成功载入。'}</span>
        <button type="button" className="generated-file-open" onClick={onOpenExternal}>
          <span>使用系统应用打开</span>
          <ExternalLink size={13} />
        </button>
      </div>
    );
  }

  return (
    <div className="browser-pdf-viewer" onKeyDown={(event) => {
      if (event.key === 'PageUp') { event.preventDefault(); changePage(pageNumber - 1); }
      if (event.key === 'PageDown') { event.preventDefault(); changePage(pageNumber + 1); }
    }}>
      <div className="browser-pdf-toolbar" aria-label="PDF 工具栏">
        <button type="button" className="icon-mini" disabled={pageNumber <= 1} onClick={() => changePage(pageNumber - 1)} aria-label="上一页"><ChevronLeft size={14} /></button>
        <label className="browser-pdf-page">
          <span className="sr-only">页码</span>
          <input
            value={pageNumber}
            inputMode="numeric"
            onChange={(event) => changePage(Number(event.target.value) || 1)}
            aria-label="当前页码"
          />
          <span>/ {document.numPages}</span>
        </label>
        <button type="button" className="icon-mini" disabled={pageNumber >= document.numPages} onClick={() => changePage(pageNumber + 1)} aria-label="下一页"><ChevronRight size={14} /></button>
        <span className="browser-pdf-divider" />
        <button type="button" className="icon-mini" disabled={zoom <= 0.5} onClick={() => changeZoom(-0.1)} aria-label="缩小"><Minus size={14} /></button>
        <span className="browser-pdf-zoom">{Math.round(zoom * 100)}%</span>
        <button type="button" className="icon-mini" disabled={zoom >= 3} onClick={() => changeZoom(0.1)} aria-label="放大"><Plus size={14} /></button>
        <span className="spacer" />
        <button type="button" className="icon-mini" onClick={onOpenExternal} aria-label="使用系统应用打开" title="使用系统应用打开"><ExternalLink size={14} /></button>
      </div>
      <div ref={setPageStageRef} className="browser-pdf-stage" tabIndex={0} onScroll={handleScroll}>
        <div className="browser-pdf-pages">
          {pageNumbers.map((number) => (
            <BrowserPdfPage
              key={number}
              document={document}
              pageNumber={number}
              stageElement={stageElement}
              stageWidth={stageWidth}
              zoom={zoom}
              registerPage={registerPage}
              onError={handleRenderError}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
