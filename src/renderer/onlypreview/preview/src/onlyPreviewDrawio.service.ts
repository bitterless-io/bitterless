import { OnlyPreviewContractError } from '@shared/onlypreview/onlyPreview.contract';
import {
  getOnlyPreviewFileSizeLimit,
  type OnlyPreviewErrorCode
} from '@shared/onlypreview/onlyPreview.types';
import {
  ONLY_PREVIEW_DRAWIO_PREFLIGHT_TIMEOUT_MS,
  type OnlyPreviewDrawioWorkerErrorCode,
  type OnlyPreviewDrawioWorkerIdentity,
  type OnlyPreviewDrawioWorkerRequest,
  type OnlyPreviewDrawioWorkerResponse
} from './workers/onlyPreviewDrawioWorker.contract';

interface DrawioWorkerLike {
  postMessage(message: OnlyPreviewDrawioWorkerRequest, transfer?: Transferable[]): void;
  terminate(): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
  addEventListener(type: 'error' | 'messageerror', listener: () => void): void;
}

export interface OnlyPreviewDrawioContent {
  xml: string;
  pageCount: number;
  cellCount: number;
}

export interface OnlyPreviewDrawioSessionOptions {
  hostId: string;
  selectionRevision: number;
  fetchImpl?: typeof fetch;
  workerFactory?: () => DrawioWorkerLike;
  timeoutMs?: number;
}

const RESPONSE_BASE_KEYS = [
  'hostId',
  'runtimeId',
  'selectionRevision',
  'workerGeneration',
  'requestId',
  'type'
] as const;

const DRAWIO_ERRORS: ReadonlySet<OnlyPreviewDrawioWorkerErrorCode> = new Set([
  'DIAGRAM_PARSE_FAILED',
  'DIAGRAM_EMPTY',
  'DIAGRAM_LIMIT',
  'DIAGRAM_RENDER_TIMEOUT'
]);

let nextWorkerGeneration = 0;

const defaultWorkerFactory = (): DrawioWorkerLike =>
  new Worker(new URL('./workers/onlyPreviewDrawioPreflight.worker.ts', import.meta.url), {
    type: 'module',
    name: 'onlypreview-drawio-preflight'
  });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};

const diagramError = (code: OnlyPreviewErrorCode, message: string): OnlyPreviewContractError =>
  new OnlyPreviewContractError(code, message);

export class OnlyPreviewDrawioSession {
  private readonly identity: OnlyPreviewDrawioWorkerIdentity;
  private readonly fetchImpl: typeof fetch;
  private readonly workerFactory: () => DrawioWorkerLike;
  private readonly timeoutMs: number;
  private readonly abortController = new AbortController();
  private worker: DrawioWorkerLike | null = null;
  private cancelPendingPreflight: (() => void) | null = null;
  private disposed = false;
  private loadStarted = false;

  constructor(options: OnlyPreviewDrawioSessionOptions) {
    this.identity = {
      hostId: options.hostId,
      runtimeId: crypto.randomUUID(),
      selectionRevision: options.selectionRevision,
      workerGeneration: ++nextWorkerGeneration
    };
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.workerFactory = options.workerFactory ?? defaultWorkerFactory;
    this.timeoutMs = options.timeoutMs ?? ONLY_PREVIEW_DRAWIO_PREFLIGHT_TIMEOUT_MS;
  }

  async load(assetUrl: string, expectedSize: number): Promise<OnlyPreviewDrawioContent> {
    this.requireActive();
    if (this.loadStarted) {
      throw diagramError('INVALID_INPUT', 'Draw.io session load is single-use.');
    }
    const fileLimit = getOnlyPreviewFileSizeLimit('drawio-viewer');
    if (
      !assetUrl ||
      !Number.isSafeInteger(expectedSize) ||
      expectedSize <= 0 ||
      fileLimit === null ||
      expectedSize > fileLimit
    ) {
      throw diagramError('TEXT_TOO_LARGE', 'Draw.io preview input exceeds its file limit.');
    }
    this.loadStarted = true;
    const bytes = await this.fetchBytes(assetUrl, expectedSize);
    const result = await this.preflight(bytes);
    this.requireActive();
    let xml: string;
    try {
      xml = new TextDecoder('utf-8', { fatal: true }).decode(result.bytes);
    } catch {
      throw diagramError('DIAGRAM_PARSE_FAILED', 'The diagram is not valid UTF-8 XML.');
    }
    return { xml, pageCount: result.pageCount, cellCount: result.cellCount };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abortController.abort();
    this.cancelPendingPreflight?.();
    this.terminateWorker();
  }

  private async fetchBytes(assetUrl: string, expectedSize: number): Promise<ArrayBuffer> {
    let response: Response;
    try {
      response = await this.fetchImpl(assetUrl, { signal: this.abortController.signal });
    } catch {
      if (this.disposed) throw diagramError('DIAGRAM_RENDER_TIMEOUT', 'Diagram loading ended.');
      throw diagramError('DIAGRAM_PARSE_FAILED', 'The diagram stream could not be read.');
    }
    this.requireActive();
    const contentLength = Number(response.headers.get('content-length'));
    if (!response.ok || response.status !== 200 || contentLength !== expectedSize) {
      throw diagramError('DIAGRAM_PARSE_FAILED', 'The diagram stream did not match the file.');
    }
    let bytes: ArrayBuffer;
    try {
      bytes = await response.arrayBuffer();
    } catch {
      throw diagramError('DIAGRAM_PARSE_FAILED', 'The diagram stream ended early.');
    }
    this.requireActive();
    if (bytes.byteLength !== expectedSize) {
      throw diagramError('DIAGRAM_PARSE_FAILED', 'The diagram stream was incomplete.');
    }
    return bytes;
  }

  private async preflight(
    bytes: ArrayBuffer
  ): Promise<{ bytes: ArrayBuffer; pageCount: number; cellCount: number }> {
    const worker = this.workerFactory();
    this.worker = worker;
    const requestId = 1;
    return await new Promise((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const finish = (
        outcome:
          | { bytes: ArrayBuffer; pageCount: number; cellCount: number }
          | OnlyPreviewContractError
      ): void => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        this.cancelPendingPreflight = null;
        this.terminateWorker();
        if (outcome instanceof OnlyPreviewContractError) reject(outcome);
        else resolve(outcome);
      };
      this.cancelPendingPreflight = () =>
        finish(diagramError('DIAGRAM_RENDER_TIMEOUT', 'The Draw.io preview session ended.'));
      timer = setTimeout(
        () =>
          finish(diagramError('DIAGRAM_RENDER_TIMEOUT', 'Draw.io archive preflight timed out.')),
        this.timeoutMs
      );
      worker.addEventListener('error', () =>
        finish(diagramError('DIAGRAM_PARSE_FAILED', 'The diagram preflight Worker failed.'))
      );
      worker.addEventListener('messageerror', () =>
        finish(diagramError('DIAGRAM_PARSE_FAILED', 'The diagram Worker response was invalid.'))
      );
      worker.addEventListener('message', (event) => {
        const response = this.parseResponse(event.data, requestId);
        if (!response) {
          finish(diagramError('DIAGRAM_PARSE_FAILED', 'The diagram Worker response was invalid.'));
          return;
        }
        if (response.type === 'error') {
          finish(diagramError(response.errorCode, 'The diagram failed bounded preflight.'));
          return;
        }
        finish({
          bytes: response.bytes,
          pageCount: response.pageCount,
          cellCount: response.cellCount
        });
      });
      const request: OnlyPreviewDrawioWorkerRequest = {
        ...this.identity,
        requestId,
        type: 'preflight',
        bytes
      };
      worker.postMessage(request, [bytes]);
    });
  }

  private parseResponse(value: unknown, requestId: number): OnlyPreviewDrawioWorkerResponse | null {
    if (!isRecord(value)) return null;
    const expectedKeys =
      value.type === 'preflight-ready'
        ? [...RESPONSE_BASE_KEYS, 'bytes', 'pageCount', 'cellCount']
        : [...RESPONSE_BASE_KEYS, 'errorCode'];
    if (!hasExactKeys(value, expectedKeys)) return null;
    if (
      value.hostId !== this.identity.hostId ||
      value.runtimeId !== this.identity.runtimeId ||
      value.selectionRevision !== this.identity.selectionRevision ||
      value.workerGeneration !== this.identity.workerGeneration ||
      value.requestId !== requestId
    ) {
      return null;
    }
    if (value.type === 'error') {
      return typeof value.errorCode === 'string' &&
        DRAWIO_ERRORS.has(value.errorCode as OnlyPreviewDrawioWorkerErrorCode)
        ? (value as unknown as OnlyPreviewDrawioWorkerResponse)
        : null;
    }
    if (
      value.type !== 'preflight-ready' ||
      !(value.bytes instanceof ArrayBuffer) ||
      !Number.isSafeInteger(value.pageCount) ||
      (value.pageCount as number) < 1 ||
      !Number.isSafeInteger(value.cellCount) ||
      (value.cellCount as number) < 1
    ) {
      return null;
    }
    return value as unknown as OnlyPreviewDrawioWorkerResponse;
  }

  private requireActive(): void {
    if (this.disposed) {
      throw diagramError('DIAGRAM_RENDER_TIMEOUT', 'The Draw.io preview session ended.');
    }
  }

  private terminateWorker(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}

interface DrawioViewerInstance {
  graph?: { container?: Element; destroy?: () => void };
}

interface DrawioGraphViewerGlobal {
  processElements(className?: string): void;
  viewerInitialized: (viewer: DrawioViewerInstance) => void;
}

interface DrawioWindow extends Window {
  GraphViewer?: DrawioGraphViewerGlobal;
  onDrawioViewerLoad?: () => void;
  PROXY_URL?: string;
  STYLE_PATH?: string;
  SHAPES_PATH?: string;
  STENCIL_PATH?: string;
  DRAW_MATH_URL?: string;
  GRAPH_IMAGE_PATH?: string;
  mxImageBasePath?: string;
  mxBasePath?: string;
  mxLoadStylesheets?: boolean;
}

export interface OnlyPreviewDrawioViewerHandle {
  dispose(): void;
}

export interface OnlyPreviewDrawioViewerOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export const ONLY_PREVIEW_DRAWIO_VIEWER_TIMEOUT_MS = 15_000;

let viewerRuntimePromise: Promise<DrawioGraphViewerGlobal> | null = null;
let nextMountId = 0;

const loadDrawioViewerRuntime = async (
  ownerDocument: Document
): Promise<DrawioGraphViewerGlobal> => {
  const ownerWindow = ownerDocument.defaultView as DrawioWindow | null;
  if (!ownerWindow) {
    throw diagramError('DIAGRAM_PARSE_FAILED', 'The Draw.io viewer document is unavailable.');
  }
  if (ownerWindow.GraphViewer) return ownerWindow.GraphViewer;
  if (viewerRuntimePromise) return await viewerRuntimePromise;
  viewerRuntimePromise = new Promise<DrawioGraphViewerGlobal>((resolve, reject) => {
    const viewerAssetUrl = new URL('./vendor/drawio/viewer-static.min.js', import.meta.url).href;
    const assetRoot = new URL('.', viewerAssetUrl).href;
    ownerWindow.PROXY_URL = `${assetRoot}offline-proxy`;
    ownerWindow.STYLE_PATH = assetRoot;
    ownerWindow.SHAPES_PATH = assetRoot;
    ownerWindow.STENCIL_PATH = assetRoot;
    ownerWindow.DRAW_MATH_URL = assetRoot;
    ownerWindow.GRAPH_IMAGE_PATH = assetRoot;
    ownerWindow.mxImageBasePath = assetRoot;
    ownerWindow.mxBasePath = assetRoot;
    ownerWindow.mxLoadStylesheets = false;
    ownerWindow.onDrawioViewerLoad = () => {
      if (!ownerWindow.GraphViewer) {
        reject(diagramError('DIAGRAM_PARSE_FAILED', 'The Draw.io viewer did not initialize.'));
        return;
      }
      resolve(ownerWindow.GraphViewer);
    };
    const script = ownerDocument.createElement('script');
    script.src = viewerAssetUrl;
    script.async = true;
    script.dataset.onlypreviewDrawioViewer = 'true';
    script.addEventListener('error', () => {
      viewerRuntimePromise = null;
      reject(diagramError('DIAGRAM_PARSE_FAILED', 'The bundled Draw.io viewer could not load.'));
    });
    ownerDocument.head.append(script);
  });
  return await viewerRuntimePromise;
};

const waitForDrawioMountVisibility = async (
  mount: HTMLElement,
  signal: AbortSignal | undefined,
  timeoutMs: number
): Promise<void> => {
  if (mount.offsetWidth > 0) return;
  const ownerWindow = mount.ownerDocument.defaultView;
  if (!ownerWindow) {
    throw diagramError('DIAGRAM_PARSE_FAILED', 'The Draw.io viewer document is unavailable.');
  }
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let resizeObserver: ResizeObserver | null = null;
    let mutationObserver: MutationObserver | null = null;
    const cleanup = (): void => {
      clearTimeout(timer);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      ownerWindow.removeEventListener('resize', checkVisibility);
      signal?.removeEventListener('abort', handleAbort);
    };
    const finish = (error?: OnlyPreviewContractError): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const handleAbort = (): void =>
      finish(diagramError('DIAGRAM_RENDER_TIMEOUT', 'The Draw.io preview session ended.'));
    const checkVisibility = (): void => {
      if (signal?.aborted) {
        handleAbort();
        return;
      }
      if (!mount.isConnected) {
        finish(diagramError('DIAGRAM_RENDER_TIMEOUT', 'The Draw.io mount is no longer active.'));
        return;
      }
      if (mount.offsetWidth > 0) finish();
    };
    const timer = setTimeout(
      () =>
        finish(diagramError('DIAGRAM_RENDER_TIMEOUT', 'Draw.io viewer initialization timed out.')),
      timeoutMs
    );
    if (ownerWindow.ResizeObserver) {
      resizeObserver = new ownerWindow.ResizeObserver(checkVisibility);
      resizeObserver.observe(mount);
    } else if (ownerWindow.MutationObserver) {
      mutationObserver = new ownerWindow.MutationObserver(checkVisibility);
      mutationObserver.observe(mount.parentElement ?? mount.ownerDocument.documentElement, {
        attributes: true,
        childList: true,
        subtree: true
      });
    }
    ownerWindow.addEventListener('resize', checkVisibility);
    signal?.addEventListener('abort', handleAbort, { once: true });
    checkVisibility();
  });
};

export const renderOnlyPreviewDrawio = async (
  mount: HTMLElement,
  content: OnlyPreviewDrawioContent,
  options: OnlyPreviewDrawioViewerOptions = {}
): Promise<OnlyPreviewDrawioViewerHandle> => {
  const timeoutMs = options.timeoutMs ?? ONLY_PREVIEW_DRAWIO_VIEWER_TIMEOUT_MS;
  if (
    !mount.isConnected ||
    !content.xml ||
    content.pageCount < 1 ||
    content.cellCount < 1 ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0
  ) {
    throw diagramError('INVALID_INPUT', 'Draw.io viewer input is invalid.');
  }
  if (options.signal?.aborted) {
    throw diagramError('DIAGRAM_RENDER_TIMEOUT', 'The Draw.io preview session ended.');
  }
  await waitForDrawioMountVisibility(mount, options.signal, timeoutMs);
  const graphViewer = await loadDrawioViewerRuntime(mount.ownerDocument);
  if (!mount.isConnected || options.signal?.aborted) {
    throw diagramError('DIAGRAM_RENDER_TIMEOUT', 'The Draw.io mount is no longer active.');
  }
  const targetClass = `onlypreview-drawio-target-${++nextMountId}`;
  mount.classList.add('mxgraph', targetClass);
  mount.setAttribute(
    'data-mxgraph',
    JSON.stringify({
      xml: content.xml,
      highlight: 'none',
      lightbox: false,
      nav: false,
      toolbar: 'pages zoom layers',
      'auto-fit': true,
      'check-visible-state': false,
      resize: true,
      center: true
    })
  );

  const preventExternalAction = (event: Event): void => {
    const target = event.target;
    if (target instanceof Element && target.closest('a, [href]')) event.preventDefault();
  };
  mount.addEventListener('click', preventExternalAction, true);
  mount.addEventListener('auxclick', preventExternalAction, true);
  mount.addEventListener('dragstart', preventExternalAction, true);

  const cleanupMount = (): void => {
    mount.removeEventListener('click', preventExternalAction, true);
    mount.removeEventListener('auxclick', preventExternalAction, true);
    mount.removeEventListener('dragstart', preventExternalAction, true);
    mount.removeAttribute('data-mxgraph');
    mount.classList.remove('mxgraph', targetClass);
    mount.replaceChildren();
  };

  const previousViewerInitialized = graphViewer.viewerInitialized;
  let viewer: DrawioViewerInstance | null = null;
  graphViewer.viewerInitialized = (candidate) => {
    try {
      previousViewerInitialized?.(candidate);
    } catch {
      // The official viewer callback remains authoritative for this mount.
    }
    if (candidate.graph?.container === mount) viewer = candidate;
  };
  try {
    graphViewer.processElements(targetClass);
  } catch {
    cleanupMount();
    throw diagramError('DIAGRAM_PARSE_FAILED', 'The Draw.io viewer rejected this diagram.');
  } finally {
    graphViewer.viewerInitialized = previousViewerInitialized;
  }
  if (!viewer) {
    cleanupMount();
    throw diagramError('DIAGRAM_PARSE_FAILED', 'The Draw.io viewer rejected this diagram.');
  }

  let disposed = false;
  return {
    dispose: () => {
      if (disposed) return;
      disposed = true;
      mount.removeEventListener('click', preventExternalAction, true);
      mount.removeEventListener('auxclick', preventExternalAction, true);
      mount.removeEventListener('dragstart', preventExternalAction, true);
      try {
        viewer?.graph?.destroy?.();
      } catch {
        // Main destroys the full Vue Preview WebContents on Draw.io exit as the final cleanup fence.
      }
      cleanupMount();
    }
  };
};
