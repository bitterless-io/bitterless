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
import type { OnlyPreviewXlsxCompatibility } from './onlyPreviewOoxmlPreflight.type';
import type {
  OnlyPreviewOfficePreflightRequest,
  OnlyPreviewOfficePreflightResponse
} from './workers/onlyPreviewOfficePreflight.contract';
import {
  ONLY_PREVIEW_XLSX_COMPATIBILITY_MAX_INFLATED_BYTES,
  ONLY_PREVIEW_XLSX_COMPATIBILITY_MAX_INPUT_BYTES,
  ONLY_PREVIEW_XLSX_COMPATIBILITY_MAX_OUTPUT_BYTES,
  ONLY_PREVIEW_XLSX_COMPATIBILITY_TIMEOUT_MS,
  type OnlyPreviewXlsxCompatibilityRequest,
  type OnlyPreviewXlsxCompatibilityResponse
} from './workers/onlyPreviewXlsxCompatibility.contract';

type OoxmlFindMatch = { matchIndex: number };

type OfficeRuntimePhase =
  | 'read'
  | 'preflight'
  | 'compatibility-normalize'
  | 'compatibility-preflight'
  | 'module-import'
  | 'viewer-construction'
  | 'load'
  | 'layout'
  | 'render'
  | 'find';

interface OfficeRuntimeFailure {
  name: string;
  code?: string;
  message: string;
}

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

interface XlsxCompatibilityWorkerLike {
  postMessage(message: OnlyPreviewXlsxCompatibilityRequest, transfer?: Transferable[]): void;
  terminate(): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
  addEventListener(type: 'error' | 'messageerror', listener: () => void): void;
}

interface OfficePreflightResult {
  bytes: ArrayBuffer;
  totalUncompressedBytes: number;
  xlsxCompatibility?: OnlyPreviewXlsxCompatibility;
}

export interface OnlyPreviewOfficeSessionOptions {
  hostId: string;
  selectionRevision: number;
  kind: OnlyPreviewOoxmlPackageKind;
  sourceExtension: string;
  expectedSize: number;
  readBytes: () => Promise<ArrayBuffer>;
  workerFactory?: () => OfficePreflightWorkerLike;
  compatibilityWorkerFactory?: () => XlsxCompatibilityWorkerLike;
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
// @silurus/ooxml calls host 2D painting "main"; OOXML/WASM parsing still uses its parser Worker.
const OOXML_RENDER_MODE = 'main' as const;
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

const renderErrorForKind = (kind: OnlyPreviewOoxmlPackageKind): OnlyPreviewErrorCode => {
  if (kind === 'xlsx') return 'SHEET_RENDER_FAILED';
  if (kind === 'docx') return 'DOCUMENT_RENDER_FAILED';
  return 'PRESENTATION_RENDER_FAILED';
};

const boundedErrorToken = (value: unknown, fallback: string): string =>
  typeof value === 'string' && /^[a-z][a-z0-9._-]{0,63}$/iu.test(value) ? value : fallback;

const safeOfficeFailureMessage = (error: unknown): string => {
  const message = error instanceof Error ? error.message : '';
  if (/bitmaprenderer context not available/iu.test(message)) {
    return 'The browser bitmap renderer is unavailable.';
  }
  if (/requires Worker and OffscreenCanvas support/iu.test(message)) {
    return 'The browser does not provide the required Worker canvas support.';
  }
  if (/worker/iu.test(message) && /tim(?:e|ed) out/iu.test(message)) {
    return 'The OOXML Worker timed out.';
  }
  if (/webassembly|\bwasm\b/iu.test(message)) {
    return 'The OOXML WASM runtime could not be initialized.';
  }
  if (/fetch|network|load(?:ing)? .*asset/iu.test(message)) {
    return 'An OOXML runtime asset could not be loaded.';
  }
  if (/resource limit|decoded image limit/iu.test(message)) {
    return 'An OOXML resource limit was exceeded.';
  }
  if (/destroyed|closed|aborted/iu.test(message)) {
    return 'The OOXML Viewer closed before the operation completed.';
  }
  return 'The OOXML Viewer reported an unclassified failure.';
};

const describeOfficeFailure = (error: unknown): OfficeRuntimeFailure => {
  const candidate =
    error && (typeof error === 'object' || typeof error === 'function')
      ? (error as { name?: unknown; code?: unknown })
      : null;
  const code = boundedErrorToken(candidate?.code, '');
  return {
    name: boundedErrorToken(candidate?.name, 'Error'),
    ...(code ? { code } : {}),
    message: safeOfficeFailureMessage(error)
  };
};

const errorCodeForOfficeFailure = (
  kind: OnlyPreviewOoxmlPackageKind,
  error: unknown
): OnlyPreviewErrorCode => {
  const code = describeOfficeFailure(error).code;
  if (code === 'ooxml-resource-limit' || code === 'ooxml-decoded-image-limit') {
    return 'OOXML_ARCHIVE_LIMIT';
  }
  if (code === 'encrypted' || code === 'invalid-password' || code === 'unsupported-encryption') {
    return 'OOXML_ENCRYPTED';
  }
  if (code === 'not-ooxml' || code === 'legacy-binary-format') return 'SIGNATURE_MISMATCH';
  return renderErrorForKind(kind);
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

const defaultCompatibilityWorkerFactory = (): XlsxCompatibilityWorkerLike =>
  new Worker(new URL('./workers/onlyPreviewXlsxCompatibility.worker.ts', import.meta.url), {
    type: 'module',
    name: 'onlypreview-xlsx-compatibility'
  });

const isPreflightResponse = (
  value: unknown,
  runtimeId: string,
  selectionRevision: number,
  requestId: number
): value is OnlyPreviewOfficePreflightResponse => {
  if (!value || typeof value !== 'object') return false;
  const response = value as Record<string, unknown>;
  return (
    response.runtimeId === runtimeId &&
    response.selectionRevision === selectionRevision &&
    response.requestId === requestId &&
    (response.type === 'ready' || response.type === 'error')
  );
};

const isPreflightErrorCode = (
  value: unknown
): value is
  | 'OOXML_ARCHIVE_LIMIT'
  | 'OOXML_ENCRYPTED'
  | 'OOXML_ARCHIVE_INVALID'
  | 'OOXML_PREFLIGHT_TIMEOUT' =>
  value === 'OOXML_ARCHIVE_LIMIT' ||
  value === 'OOXML_ENCRYPTED' ||
  value === 'OOXML_ARCHIVE_INVALID' ||
  value === 'OOXML_PREFLIGHT_TIMEOUT';

const isCompatibilityResponse = (
  value: unknown,
  runtimeId: string,
  selectionRevision: number,
  requestId: number
): value is OnlyPreviewXlsxCompatibilityResponse => {
  if (!value || typeof value !== 'object') return false;
  const response = value as Record<string, unknown>;
  return (
    response.runtimeId === runtimeId &&
    response.selectionRevision === selectionRevision &&
    response.requestId === requestId &&
    (response.type === 'ready' || response.type === 'error')
  );
};

const isCompatibilityErrorCode = (
  value: unknown
): value is 'OOXML_ARCHIVE_LIMIT' | 'SHEET_PARSE_FAILED' =>
  value === 'OOXML_ARCHIVE_LIMIT' || value === 'SHEET_PARSE_FAILED';

const isXlsxCompatibility = (value: unknown): value is OnlyPreviewXlsxCompatibility => {
  if (!value || typeof value !== 'object') return false;
  const compatibility = value as Record<string, unknown>;
  return (
    typeof compatibility.macroEnabled === 'boolean' &&
    Number.isSafeInteger(compatibility.worksheetCount) &&
    Number(compatibility.worksheetCount) >= 0 &&
    Number.isSafeInteger(compatibility.missingSheetDataCount) &&
    Number(compatibility.missingSheetDataCount) >= 0 &&
    Number(compatibility.missingSheetDataCount) <= Number(compatibility.worksheetCount) &&
    typeof compatibility.requiresSheetDataNormalization === 'boolean' &&
    compatibility.requiresSheetDataNormalization === Number(compatibility.missingSheetDataCount) > 0
  );
};

export class OnlyPreviewOfficeSession implements OnlyPreviewOfficeSessionApi {
  private readonly runtimeId = crypto.randomUUID();
  private readonly workerFactory: () => OfficePreflightWorkerLike;
  private readonly compatibilityWorkerFactory: () => XlsxCompatibilityWorkerLike;
  private viewer: OoxmlViewer | null = null;
  private worker: OfficePreflightWorkerLike | null = null;
  private compatibilityWorker: XlsxCompatibilityWorkerLike | null = null;
  private container: HTMLElement | null = null;
  private disposed = false;
  private mountStarted = false;
  private mountStartedAt: number | null = null;
  private runtimeErrorReported = false;
  private runtimeFailureCode: OnlyPreviewErrorCode | null = null;
  private viewerErrorQueued = false;
  private queuedViewerError: unknown = null;
  private failureLogged = false;
  private findGeneration = 0;
  private findQueue: Promise<void> = Promise.resolve();
  private lastQuery = '';
  private lastCaseSensitive = false;
  private matchCount = 0;
  private cancelPreflight: (() => void) | null = null;
  private cancelCompatibilityNormalization: (() => void) | null = null;

  constructor(private readonly options: OnlyPreviewOfficeSessionOptions) {
    this.workerFactory = options.workerFactory ?? defaultWorkerFactory;
    this.compatibilityWorkerFactory =
      options.compatibilityWorkerFactory ?? defaultCompatibilityWorkerFactory;
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
    this.mountStartedAt = performance.now();
    this.container = container;
    const bytes = await this.runOfficePhase('read', () => this.readBytes());
    const initialPreflight = await this.runOfficePhase('preflight', () => this.preflight(bytes, 1));
    let acceptedBytes = initialPreflight.bytes;
    if (
      this.options.kind === 'xlsx' &&
      initialPreflight.xlsxCompatibility?.requiresSheetDataNormalization
    ) {
      acceptedBytes = await this.prepareXlsxCompatibility(initialPreflight);
    }
    this.requireActive();
    try {
      if (this.options.kind === 'xlsx') await this.mountXlsx(container, acceptedBytes);
      else if (this.options.kind === 'docx') await this.mountDocx(container, acceptedBytes);
      else await this.mountPptx(container, acceptedBytes);
    } catch (error) {
      if (error instanceof OnlyPreviewContractError) throw error;
      this.requireActive();
      throw new OnlyPreviewContractError(
        errorCodeForOfficeFailure(this.options.kind, error),
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
    this.cancelPreflight?.();
    this.cancelPreflight = null;
    this.worker?.terminate();
    this.worker = null;
    this.cancelCompatibilityNormalization?.();
    this.cancelCompatibilityNormalization = null;
    this.compatibilityWorker?.terminate();
    this.compatibilityWorker = null;
    this.viewer?.destroy();
    this.viewer = null;
    this.container?.replaceChildren();
    this.container = null;
  }

  private async mountXlsx(container: HTMLElement, bytes: ArrayBuffer): Promise<void> {
    const { XlsxViewer } = await this.runOfficePhase(
      'module-import',
      () => import('@silurus/ooxml/xlsx')
    );
    this.requireActive();
    const viewer: XlsxViewerLike = this.runOfficeSyncPhase(
      'viewer-construction',
      () =>
        new XlsxViewer(container, {
          mode: OOXML_RENDER_MODE,
          useGoogleFonts: false,
          enableHyperlinks: false,
          enableElementSelection: false,
          comments: false,
          showZoomSlider: false,
          workerTimeoutMs: VIEWER_WORKER_TIMEOUT_MS,
          resourceLimits: OOXML_RESOURCE_LIMITS,
          findHighlightColors: FIND_HIGHLIGHT_COLORS,
          onError: (error) => this.handleViewerRuntimeError(error)
        })
    );
    this.viewer = viewer;
    await this.runOfficePhase('load', () => viewer.load(bytes));
    this.requireActive();
    if (viewer.sheetNames.length === 0) {
      throw new OnlyPreviewContractError(emptyErrorForKind('xlsx'), 'Workbook has no sheets.');
    }
  }

  private async prepareXlsxCompatibility(initial: OfficePreflightResult): Promise<ArrayBuffer> {
    const compatibility = initial.xlsxCompatibility;
    const normalized = await this.runOfficePhase('compatibility-normalize', async () => {
      if (
        this.options.sourceExtension !== '.xlsx' ||
        !compatibility ||
        compatibility.macroEnabled ||
        compatibility.worksheetCount !== 1 ||
        compatibility.missingSheetDataCount !== 1
      ) {
        throw new OnlyPreviewContractError(
          'SHEET_PARSE_FAILED',
          'Workbook is outside the bounded XLSX compatibility path.'
        );
      }
      if (
        initial.bytes.byteLength > ONLY_PREVIEW_XLSX_COMPATIBILITY_MAX_INPUT_BYTES ||
        initial.totalUncompressedBytes > ONLY_PREVIEW_XLSX_COMPATIBILITY_MAX_INFLATED_BYTES
      ) {
        throw new OnlyPreviewContractError(
          'OOXML_ARCHIVE_LIMIT',
          'Workbook exceeds the XLSX compatibility memory limit.'
        );
      }
      return await this.normalizeXlsx(initial.bytes);
    });
    const retry = await this.runOfficePhase('compatibility-preflight', async () => {
      const result = await this.preflight(normalized, 2);
      if (
        !result.xlsxCompatibility ||
        result.xlsxCompatibility.macroEnabled ||
        result.xlsxCompatibility.worksheetCount !== 1 ||
        result.xlsxCompatibility.missingSheetDataCount !== 0 ||
        result.xlsxCompatibility.requiresSheetDataNormalization
      ) {
        throw new OnlyPreviewContractError(
          'SHEET_PARSE_FAILED',
          'Normalized workbook is outside the accepted XLSX shape.'
        );
      }
      return result;
    });
    return retry.bytes;
  }

  private async mountDocx(container: HTMLElement, bytes: ArrayBuffer): Promise<void> {
    const { DocxScrollViewer } = await this.runOfficePhase(
      'module-import',
      () => import('@silurus/ooxml/docx')
    );
    this.requireActive();
    const viewer: DocxViewerLike = this.runOfficeSyncPhase(
      'viewer-construction',
      () =>
        new DocxScrollViewer(container, {
          mode: OOXML_RENDER_MODE,
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
          findHighlightColors: FIND_HIGHLIGHT_COLORS,
          onError: (error) => this.handleViewerRuntimeError(error)
        })
    );
    this.viewer = viewer;
    await this.runOfficePhase('load', () => viewer.load(bytes));
    await this.runOfficePhase('layout', () => viewer.waitUntilLayoutComplete());
    this.requireActive();
    if (viewer.pageCount === 0) {
      throw new OnlyPreviewContractError(emptyErrorForKind('docx'), 'Document has no pages.');
    }
  }

  private async mountPptx(container: HTMLElement, bytes: ArrayBuffer): Promise<void> {
    const { PptxScrollViewer } = await this.runOfficePhase(
      'module-import',
      () => import('@silurus/ooxml/pptx')
    );
    this.requireActive();
    const viewer: PptxViewerLike = this.runOfficeSyncPhase(
      'viewer-construction',
      () =>
        new PptxScrollViewer(container, {
          mode: OOXML_RENDER_MODE,
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
          findHighlightColors: FIND_HIGHLIGHT_COLORS,
          onError: (error) => this.handleViewerRuntimeError(error)
        })
    );
    this.viewer = viewer;
    await this.runOfficePhase('load', () => viewer.load(bytes));
    await this.runOfficePhase('layout', () => viewer.waitUntilLayoutComplete());
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
    let timedOut = false;
    const operation = this.executeOoxmlFind(command, generation);
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            timedOut = true;
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
      if (error instanceof StaleOfficeFindError) throw error;
      if (!timedOut) this.reportOfficeFailure('find', error);
      const failure = timedOut
        ? new OnlyPreviewContractError(
            timeoutErrorForKind(this.options.kind),
            'Office Find exceeded its deadline.'
          )
        : error instanceof OnlyPreviewContractError
          ? error
          : new OnlyPreviewContractError(
              renderErrorForKind(this.options.kind),
              'Office Find failed.'
            );
      if (!this.disposed) this.failClosed(failure.code);
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
        renderErrorForKind(this.options.kind),
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

  private async readBytes(): Promise<ArrayBuffer> {
    let bytes: ArrayBuffer;
    try {
      bytes = await this.options.readBytes();
    } catch (error) {
      this.requireActive();
      if (error instanceof OnlyPreviewContractError) throw error;
      throw new OnlyPreviewContractError('OPERATION_FAILED', 'Office bytes could not be read.');
    }
    if (!(bytes instanceof ArrayBuffer)) {
      throw new OnlyPreviewContractError(
        parseErrorForKind(this.options.kind),
        'Office bytes could not be read.'
      );
    }
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
    const header = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 8));
    const isCfb =
      header.length === 8 &&
      [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every(
        (value, index) => header[index] === value
      );
    if (isCfb) {
      throw new OnlyPreviewContractError(
        'OOXML_ENCRYPTED',
        'Encrypted Office files cannot be previewed.'
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

  private preflight(bytes: ArrayBuffer, requestId: number): Promise<OfficePreflightResult> {
    const worker = this.workerFactory();
    this.worker = worker;
    return new Promise<OfficePreflightResult>((resolve, reject) => {
      let settled = false;
      const finish = (value: {
        result?: OfficePreflightResult;
        error?: OnlyPreviewContractError;
      }): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        worker.terminate();
        if (this.worker === worker) this.worker = null;
        this.cancelPreflight = null;
        if (value.error) reject(value.error);
        else resolve(value.result!);
      };
      const timer = setTimeout(() => {
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
        if (
          !isPreflightResponse(
            event.data,
            this.runtimeId,
            this.options.selectionRevision,
            requestId
          )
        )
          return;
        if (
          event.data.type === 'ready' &&
          event.data.bytes instanceof ArrayBuffer &&
          Number.isSafeInteger(event.data.totalUncompressedBytes) &&
          event.data.totalUncompressedBytes >= 0 &&
          (this.options.kind !== 'xlsx' || isXlsxCompatibility(event.data.xlsxCompatibility))
        ) {
          finish({
            result: {
              bytes: event.data.bytes,
              totalUncompressedBytes: event.data.totalUncompressedBytes,
              ...(event.data.xlsxCompatibility
                ? { xlsxCompatibility: event.data.xlsxCompatibility }
                : {})
            }
          });
          return;
        }
        const code: OnlyPreviewErrorCode =
          event.data.type !== 'error' || !isPreflightErrorCode(event.data.errorCode)
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
        requestId,
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

  private normalizeXlsx(bytes: ArrayBuffer): Promise<ArrayBuffer> {
    const worker = this.compatibilityWorkerFactory();
    this.compatibilityWorker = worker;
    const requestId = 1;
    return new Promise<ArrayBuffer>((resolve, reject) => {
      let settled = false;
      const finish = (value: { bytes?: ArrayBuffer; error?: OnlyPreviewContractError }): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        worker.terminate();
        if (this.compatibilityWorker === worker) this.compatibilityWorker = null;
        this.cancelCompatibilityNormalization = null;
        if (value.error) reject(value.error);
        else resolve(value.bytes!);
      };
      const timer = setTimeout(() => {
        finish({
          error: new OnlyPreviewContractError(
            'SHEET_RENDER_TIMEOUT',
            'XLSX compatibility normalization timed out.'
          )
        });
      }, ONLY_PREVIEW_XLSX_COMPATIBILITY_TIMEOUT_MS);
      this.cancelCompatibilityNormalization = () =>
        finish({
          error: new OnlyPreviewContractError(
            'SHEET_RENDER_TIMEOUT',
            'Office preview session ended during XLSX compatibility normalization.'
          )
        });
      worker.addEventListener('message', (event) => {
        if (
          !isCompatibilityResponse(
            event.data,
            this.runtimeId,
            this.options.selectionRevision,
            requestId
          )
        ) {
          return;
        }
        if (
          event.data.type === 'ready' &&
          event.data.bytes instanceof ArrayBuffer &&
          event.data.bytes.byteLength <= ONLY_PREVIEW_XLSX_COMPATIBILITY_MAX_OUTPUT_BYTES
        ) {
          finish({ bytes: event.data.bytes });
          return;
        }
        const code: OnlyPreviewErrorCode =
          event.data.type === 'error' && isCompatibilityErrorCode(event.data.errorCode)
            ? event.data.errorCode
            : event.data.type === 'ready' && event.data.bytes instanceof ArrayBuffer
              ? 'OOXML_ARCHIVE_LIMIT'
              : 'SHEET_PARSE_FAILED';
        finish({
          error: new OnlyPreviewContractError(code, 'XLSX compatibility normalization failed.')
        });
      });
      const fail = (): void =>
        finish({
          error: new OnlyPreviewContractError(
            'SHEET_PARSE_FAILED',
            'XLSX compatibility Worker failed.'
          )
        });
      worker.addEventListener('error', fail);
      worker.addEventListener('messageerror', fail);
      const request: OnlyPreviewXlsxCompatibilityRequest = {
        runtimeId: this.runtimeId,
        selectionRevision: this.options.selectionRevision,
        requestId,
        type: 'normalize',
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

  private handleViewerRuntimeError(error: unknown): void {
    if (this.runtimeErrorReported || this.disposed) return;
    if (!this.viewer) {
      if (this.viewerErrorQueued) return;
      this.viewerErrorQueued = true;
      this.queuedViewerError = error;
      queueMicrotask(() => {
        this.viewerErrorQueued = false;
        const queuedError = this.queuedViewerError;
        this.queuedViewerError = null;
        if (this.viewer && !this.disposed) {
          this.reportOfficeFailure('render', queuedError);
          this.failClosed(errorCodeForOfficeFailure(this.options.kind, queuedError));
        }
      });
      return;
    }
    this.reportOfficeFailure('render', error);
    this.failClosed(errorCodeForOfficeFailure(this.options.kind, error));
  }

  private async runOfficePhase<T>(
    phase: OfficeRuntimePhase,
    operation: () => Promise<T>
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (!this.disposed) this.reportOfficeFailure(phase, error);
      throw error;
    }
  }

  private runOfficeSyncPhase<T>(phase: OfficeRuntimePhase, operation: () => T): T {
    try {
      return operation();
    } catch (error) {
      if (!this.disposed) this.reportOfficeFailure(phase, error);
      throw error;
    }
  }

  private reportOfficeFailure(phase: OfficeRuntimePhase, error: unknown): void {
    if (this.failureLogged) return;
    this.failureLogged = true;
    const elapsedMs =
      this.mountStartedAt === null
        ? 0
        : Math.max(0, Math.round(performance.now() - this.mountStartedAt));
    console.warn(
      '[OnlyPreview][office]',
      JSON.stringify({
        runtimeId: this.runtimeId,
        selectionRevision: this.options.selectionRevision,
        elapsedMs,
        kind: this.options.kind,
        phase,
        ...describeOfficeFailure(error)
      })
    );
  }

  private failClosed(errorCode: OnlyPreviewErrorCode): void {
    if (this.runtimeErrorReported || this.disposed) return;
    this.runtimeErrorReported = true;
    this.runtimeFailureCode = errorCode;
    this.dispose();
    this.options.onRuntimeError?.(errorCode);
  }

  private isFindCurrent(generation: number): boolean {
    return !this.disposed && generation === this.findGeneration;
  }

  private requireActive(): void {
    if (this.disposed) {
      throw new OnlyPreviewContractError(
        this.runtimeFailureCode ?? timeoutErrorForKind(this.options.kind),
        'Office preview session ended.'
      );
    }
  }
}
