import { OnlyPreviewContractError } from '@shared/onlypreview/onlyPreview.contract';
import {
  ONLY_PREVIEW_MAX_DOCUMENT_BYTES,
  ONLY_PREVIEW_MAX_PRESENTATION_BYTES,
  ONLY_PREVIEW_MAX_SHEET_BYTES,
  type OnlyPreviewErrorCode,
  type OnlyPreviewFindCommand
} from '@shared/onlypreview/onlyPreview.types';
import type {
  OnlyPreviewContentFindAdapter,
  OnlyPreviewContentFindAdapterResult
} from './onlyPreviewFindAdapter.service';
import {
  ONLY_PREVIEW_OOXML_MAX_ENTRIES,
  ONLY_PREVIEW_OOXML_MAX_ENTRY_UNCOMPRESSED_BYTES,
  ONLY_PREVIEW_OOXML_MAX_TOTAL_UNCOMPRESSED_BYTES,
  ONLY_PREVIEW_OOXML_PREFLIGHT_TIMEOUT_MS
} from './onlyPreviewOoxmlPreflight.service';
import type { OnlyPreviewOoxmlPackageKind } from './onlyPreviewOoxmlPreflight.type';
import type {
  OnlyPreviewOfficePreflightRequest,
  OnlyPreviewOfficePreflightResponse
} from './workers/onlyPreviewOfficePreflight.contract';

type OoxmlFindMatch = { matchIndex: number };

interface OoxmlViewer {
  findText(query: string, options?: { caseSensitive?: boolean }): Promise<OoxmlFindMatch[]>;
  findNext(): Promise<OoxmlFindMatch | null>;
  findPrev(): Promise<OoxmlFindMatch | null>;
  clearFind(): void;
  destroy(): void;
}

interface XlsxViewerLike extends OoxmlViewer {
  load(source: ArrayBuffer): Promise<void>;
  readonly sheetNames: string[];
}

interface DocxViewerLike extends OoxmlViewer {
  load(source: ArrayBuffer): Promise<void>;
  waitUntilLayoutComplete(): Promise<void>;
  readonly pageCount: number;
}

interface PptxViewerLike extends OoxmlViewer {
  load(source: ArrayBuffer): Promise<void>;
  waitUntilLayoutComplete(): Promise<void>;
  readonly slideCount: number;
}

interface OfficePreflightWorkerLike {
  postMessage(message: OnlyPreviewOfficePreflightRequest, transfer?: Transferable[]): void;
  terminate(): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
  addEventListener(type: 'error' | 'messageerror', listener: () => void): void;
}

export interface OnlyPreviewOfficeSessionOptions {
  hostId: string;
  selectionRevision: number;
  kind: OnlyPreviewOoxmlPackageKind;
  assetUrl: string;
  expectedSize: number;
  fetchImpl?: typeof fetch;
  workerFactory?: () => OfficePreflightWorkerLike;
  onRuntimeError?: (errorCode: OnlyPreviewErrorCode) => void;
}

export interface OnlyPreviewOfficeSessionApi extends OnlyPreviewContentFindAdapter {
  readonly supportsTextSelection: boolean;
  mount(container: HTMLElement): Promise<void>;
  dispose(): void;
}

const COMPLETE_COVERAGE = Object.freeze({ kind: 'complete' as const });
const FIND_TIMEOUT_MS = 10_000;
const VIEWER_WORKER_TIMEOUT_MS = 25_000;
const OOXML_RESOURCE_LIMITS = Object.freeze({
  maxArchiveEntries: ONLY_PREVIEW_OOXML_MAX_ENTRIES,
  maxArchiveEntryBytes: ONLY_PREVIEW_OOXML_MAX_ENTRY_UNCOMPRESSED_BYTES,
  maxTotalInflatedBytes: ONLY_PREVIEW_OOXML_MAX_TOTAL_UNCOMPRESSED_BYTES
});
const FIND_HIGHLIGHT_COLORS = Object.freeze({
  match: 'rgb(250 204 21 / 32%)',
  active: 'rgb(249 115 22 / 48%)'
});

class StaleOfficeFindError extends Error {}

const maxBytesForKind = (kind: OnlyPreviewOoxmlPackageKind): number => {
  if (kind === 'xlsx') return ONLY_PREVIEW_MAX_SHEET_BYTES;
  if (kind === 'docx') return ONLY_PREVIEW_MAX_DOCUMENT_BYTES;
  return ONLY_PREVIEW_MAX_PRESENTATION_BYTES;
};

const parseErrorForKind = (kind: OnlyPreviewOoxmlPackageKind): OnlyPreviewErrorCode => {
  if (kind === 'xlsx') return 'SHEET_PARSE_FAILED';
  if (kind === 'docx') return 'DOCUMENT_PARSE_FAILED';
  return 'PRESENTATION_PARSE_FAILED';
};

const emptyErrorForKind = (kind: OnlyPreviewOoxmlPackageKind): OnlyPreviewErrorCode => {
  if (kind === 'xlsx') return 'SHEET_EMPTY';
  if (kind === 'docx') return 'DOCUMENT_EMPTY';
  return 'PRESENTATION_EMPTY';
};

const timeoutErrorForKind = (kind: OnlyPreviewOoxmlPackageKind): OnlyPreviewErrorCode => {
  if (kind === 'xlsx') return 'SHEET_RENDER_TIMEOUT';
  if (kind === 'docx') return 'DOCUMENT_RENDER_TIMEOUT';
  return 'PRESENTATION_RENDER_TIMEOUT';
};

const hasZipSignature = (bytes: ArrayBuffer): boolean => {
  const value = bytes.byteLength >= 4 ? new Uint8Array(bytes, 0, 4) : null;
  return Boolean(
    value && value[0] === 0x50 && value[1] === 0x4b && value[2] === 0x03 && value[3] === 0x04
  );
};

const defaultWorkerFactory = (): OfficePreflightWorkerLike =>
  new Worker(new URL('./workers/onlyPreviewOfficePreflight.worker.ts', import.meta.url), {
    type: 'module',
    name: 'onlypreview-office-preflight'
  });

const isPreflightResponse = (
  value: unknown,
  runtimeId: string,
  selectionRevision: number
): value is OnlyPreviewOfficePreflightResponse => {
  if (!value || typeof value !== 'object') return false;
  const response = value as Record<string, unknown>;
  return (
    response.runtimeId === runtimeId &&
    response.selectionRevision === selectionRevision &&
    response.requestId === 1 &&
    (response.type === 'ready' || response.type === 'error')
  );
};

export class OnlyPreviewOfficeSession implements OnlyPreviewOfficeSessionApi {
  private readonly runtimeId = crypto.randomUUID();
  private readonly abortController = new AbortController();
  private readonly fetchImpl: typeof fetch;
  private readonly workerFactory: () => OfficePreflightWorkerLike;
  private viewer: OoxmlViewer | null = null;
  private worker: OfficePreflightWorkerLike | null = null;
  private container: HTMLElement | null = null;
  private disposed = false;
  private mountStarted = false;
  private runtimeErrorReported = false;
  private findGeneration = 0;
  private findQueue: Promise<void> = Promise.resolve();
  private lastQuery = '';
  private lastCaseSensitive = false;
  private matchCount = 0;
  private cancelPreflight: (() => void) | null = null;

  constructor(private readonly options: OnlyPreviewOfficeSessionOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.workerFactory = options.workerFactory ?? defaultWorkerFactory;
  }

  get supportsTextSelection(): boolean {
    return this.options.kind === 'docx' || this.options.kind === 'pptx';
  }

  async mount(container: HTMLElement): Promise<void> {
    this.requireActive();
    if (this.mountStarted) {
      throw new OnlyPreviewContractError('INVALID_INPUT', 'Office session is single-use.');
    }
    this.mountStarted = true;
    this.container = container;
    const bytes = await this.fetchBytes();
    const acceptedBytes = await this.preflight(bytes);
    this.requireActive();
    try {
      if (this.options.kind === 'xlsx') await this.mountXlsx(container, acceptedBytes);
      else if (this.options.kind === 'docx') await this.mountDocx(container, acceptedBytes);
      else await this.mountPptx(container, acceptedBytes);
    } catch (error) {
      if (error instanceof OnlyPreviewContractError) throw error;
      this.requireActive();
      throw new OnlyPreviewContractError(
        parseErrorForKind(this.options.kind),
        'Office rendering failed.'
      );
    }
  }

  execute(command: OnlyPreviewFindCommand): Promise<OnlyPreviewContentFindAdapterResult> {
    this.requireActive();
    const generation = ++this.findGeneration;
    const queued = this.findQueue.then(() => this.executeQueuedFind(command, generation));
    this.findQueue = queued.then(
      () => undefined,
      () => undefined
    );
    return queued;
  }

  clear(): void {
    this.findGeneration += 1;
    this.lastQuery = '';
    this.lastCaseSensitive = false;
    this.matchCount = 0;
    try {
      this.viewer?.clearFind();
    } catch {
      // Viewer teardown can race a Find-clear broadcast; generation fencing already invalidated it.
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.clear();
    this.disposed = true;
    this.abortController.abort();
    this.cancelPreflight?.();
    this.cancelPreflight = null;
    this.worker?.terminate();
    this.worker = null;
    this.viewer?.destroy();
    this.viewer = null;
    this.container?.replaceChildren();
    this.container = null;
  }

  private async mountXlsx(container: HTMLElement, bytes: ArrayBuffer): Promise<void> {
    const { XlsxViewer } = await import('@silurus/ooxml/xlsx');
    this.requireActive();
    const viewer: XlsxViewerLike = new XlsxViewer(container, {
      mode: 'worker',
      useGoogleFonts: false,
      enableHyperlinks: false,
      enableElementSelection: false,
      comments: false,
      showZoomSlider: false,
      workerTimeoutMs: VIEWER_WORKER_TIMEOUT_MS,
      resourceLimits: OOXML_RESOURCE_LIMITS,
      findHighlightColors: FIND_HIGHLIGHT_COLORS
    });
    this.viewer = viewer;
    await viewer.load(bytes);
    this.requireActive();
    if (viewer.sheetNames.length === 0) {
      throw new OnlyPreviewContractError(emptyErrorForKind('xlsx'), 'Workbook has no sheets.');
    }
  }

  private async mountDocx(container: HTMLElement, bytes: ArrayBuffer): Promise<void> {
    const { DocxScrollViewer } = await import('@silurus/ooxml/docx');
    this.requireActive();
    const viewer: DocxViewerLike = new DocxScrollViewer(container, {
      mode: 'worker',
      useGoogleFonts: false,
      enableHyperlinks: false,
      enableTextSelection: true,
      enableElementSelection: false,
      comments: false,
      progressiveLayout: true,
      sliceLayout: true,
      workerTimeoutMs: VIEWER_WORKER_TIMEOUT_MS,
      resourceLimits: OOXML_RESOURCE_LIMITS,
      background: '#f2f3f7',
      pageShadow: '0 4px 18px rgb(30 36 58 / 14%)',
      findHighlightColors: FIND_HIGHLIGHT_COLORS
    });
    this.viewer = viewer;
    await viewer.load(bytes);
    await viewer.waitUntilLayoutComplete();
    this.requireActive();
    if (viewer.pageCount === 0) {
      throw new OnlyPreviewContractError(emptyErrorForKind('docx'), 'Document has no pages.');
    }
  }

  private async mountPptx(container: HTMLElement, bytes: ArrayBuffer): Promise<void> {
    const { PptxScrollViewer } = await import('@silurus/ooxml/pptx');
    this.requireActive();
    const viewer: PptxViewerLike = new PptxScrollViewer(container, {
      mode: 'worker',
      useGoogleFonts: false,
      enableHyperlinks: false,
      enableTextSelection: true,
      enableElementSelection: false,
      enableMediaPlayback: false,
      comments: false,
      progressiveLayout: true,
      workerTimeoutMs: VIEWER_WORKER_TIMEOUT_MS,
      resourceLimits: OOXML_RESOURCE_LIMITS,
      background: '#f2f3f7',
      pageShadow: '0 4px 18px rgb(30 36 58 / 14%)',
      findHighlightColors: FIND_HIGHLIGHT_COLORS
    });
    this.viewer = viewer;
    await viewer.load(bytes);
    await viewer.waitUntilLayoutComplete();
    this.requireActive();
    if (viewer.slideCount === 0) {
      throw new OnlyPreviewContractError(emptyErrorForKind('pptx'), 'Presentation has no slides.');
    }
  }

  private async executeQueuedFind(
    command: OnlyPreviewFindCommand,
    generation: number
  ): Promise<OnlyPreviewContentFindAdapterResult> {
    if (!this.isFindCurrent(generation)) throw new StaleOfficeFindError();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const operation = this.executeOoxmlFind(command, generation);
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            reject(
              new OnlyPreviewContractError(
                timeoutErrorForKind(this.options.kind),
                'Office Find exceeded its deadline.'
              )
            );
          }, FIND_TIMEOUT_MS);
        })
      ]);
    } catch (error) {
      if (error instanceof StaleOfficeFindError || !this.isFindCurrent(generation)) throw error;
      const failure =
        error instanceof OnlyPreviewContractError
          ? error
          : new OnlyPreviewContractError(
              parseErrorForKind(this.options.kind),
              'Office Find failed.'
            );
      this.clear();
      this.reportRuntimeError(failure.code);
      throw failure;
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  }

  private async executeOoxmlFind(
    command: OnlyPreviewFindCommand,
    generation: number
  ): Promise<OnlyPreviewContentFindAdapterResult> {
    const viewer = this.viewer;
    if (!viewer) {
      throw new OnlyPreviewContractError(
        parseErrorForKind(this.options.kind),
        'Office viewer is unavailable.'
      );
    }
    const queryChanged =
      command.query !== this.lastQuery || command.caseSensitive !== this.lastCaseSensitive;
    let active: OoxmlFindMatch | null;
    if (queryChanged || command.findNext) {
      viewer.clearFind();
      const matches = await viewer.findText(command.query, {
        caseSensitive: command.caseSensitive
      });
      this.requireCurrentFind(viewer, generation);
      this.lastQuery = command.query;
      this.lastCaseSensitive = command.caseSensitive;
      this.matchCount = matches.length;
      active =
        matches.length === 0
          ? null
          : command.direction === 'backward'
            ? await viewer.findPrev()
            : await viewer.findNext();
    } else {
      active = command.direction === 'backward' ? await viewer.findPrev() : await viewer.findNext();
    }
    this.requireCurrentFind(viewer, generation);
    return {
      activeMatchOrdinal: active ? active.matchIndex + 1 : 0,
      matches: this.matchCount,
      finalUpdate: true,
      coverage: COMPLETE_COVERAGE
    };
  }

  private async fetchBytes(): Promise<ArrayBuffer> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.options.assetUrl, {
        method: 'GET',
        cache: 'no-store',
        credentials: 'omit',
        signal: this.abortController.signal
      });
    } catch {
      this.requireActive();
      throw new OnlyPreviewContractError(
        parseErrorForKind(this.options.kind),
        'Office bytes could not be read.'
      );
    }
    if (response.status !== 200) {
      throw new OnlyPreviewContractError(
        parseErrorForKind(this.options.kind),
        'Office bytes could not be read.'
      );
    }
    const bytes = await response.arrayBuffer();
    this.requireActive();
    if (
      !Number.isSafeInteger(this.options.expectedSize) ||
      this.options.expectedSize < 0 ||
      bytes.byteLength !== this.options.expectedSize
    ) {
      throw new OnlyPreviewContractError(
        parseErrorForKind(this.options.kind),
        'Office file changed while loading.'
      );
    }
    if (bytes.byteLength > maxBytesForKind(this.options.kind)) {
      throw new OnlyPreviewContractError(
        'TEXT_TOO_LARGE',
        'Office file exceeds the preview limit.'
      );
    }
    if (!hasZipSignature(bytes)) {
      throw new OnlyPreviewContractError(
        'SIGNATURE_MISMATCH',
        'Office contents do not match the file extension.'
      );
    }
    return bytes;
  }

  private preflight(bytes: ArrayBuffer): Promise<ArrayBuffer> {
    const worker = this.workerFactory();
    this.worker = worker;
    return new Promise<ArrayBuffer>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout>;
      const finish = (value: { bytes?: ArrayBuffer; error?: OnlyPreviewContractError }): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        worker.terminate();
        if (this.worker === worker) this.worker = null;
        this.cancelPreflight = null;
        if (value.error) reject(value.error);
        else resolve(value.bytes!);
      };
      timer = setTimeout(() => {
        finish({
          error: new OnlyPreviewContractError(
            timeoutErrorForKind(this.options.kind),
            'Office archive preflight timed out.'
          )
        });
      }, ONLY_PREVIEW_OOXML_PREFLIGHT_TIMEOUT_MS);
      this.cancelPreflight = () =>
        finish({
          error: new OnlyPreviewContractError(
            timeoutErrorForKind(this.options.kind),
            'Office preview session ended during archive preflight.'
          )
        });
      worker.addEventListener('message', (event) => {
        if (!isPreflightResponse(event.data, this.runtimeId, this.options.selectionRevision))
          return;
        if (event.data.type === 'ready' && event.data.bytes instanceof ArrayBuffer) {
          finish({ bytes: event.data.bytes });
          return;
        }
        const code: OnlyPreviewErrorCode =
          event.data.type !== 'error'
            ? parseErrorForKind(this.options.kind)
            : event.data.errorCode === 'OOXML_PREFLIGHT_TIMEOUT'
              ? timeoutErrorForKind(this.options.kind)
              : event.data.errorCode;
        finish({ error: new OnlyPreviewContractError(code, 'Office archive preflight failed.') });
      });
      const fail = (): void =>
        finish({
          error: new OnlyPreviewContractError(
            parseErrorForKind(this.options.kind),
            'Office preflight Worker failed.'
          )
        });
      worker.addEventListener('error', fail);
      worker.addEventListener('messageerror', fail);
      const request: OnlyPreviewOfficePreflightRequest = {
        runtimeId: this.runtimeId,
        selectionRevision: this.options.selectionRevision,
        requestId: 1,
        type: 'preflight',
        kind: this.options.kind,
        bytes
      };
      try {
        worker.postMessage(request, [bytes]);
      } catch {
        fail();
      }
    });
  }

  private requireCurrentFind(viewer: OoxmlViewer, generation: number): void {
    if (this.isFindCurrent(generation)) return;
    try {
      viewer.clearFind();
    } catch {
      // A stale completion may arrive after its viewer has already been destroyed.
    }
    throw new StaleOfficeFindError();
  }

  private reportRuntimeError(errorCode: OnlyPreviewErrorCode): void {
    if (this.runtimeErrorReported || this.disposed) return;
    this.runtimeErrorReported = true;
    this.options.onRuntimeError?.(errorCode);
  }

  private isFindCurrent(generation: number): boolean {
    return !this.disposed && generation === this.findGeneration;
  }

  private requireActive(): void {
    if (this.disposed) {
      throw new OnlyPreviewContractError(
        timeoutErrorForKind(this.options.kind),
        'Office preview session ended.'
      );
    }
  }
}
