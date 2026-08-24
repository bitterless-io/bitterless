import { OnlyPreviewContractError } from '@shared/onlypreview/onlyPreview.contract';
import { ONLY_PREVIEW_MAX_SHEET_BYTES } from '@shared/onlypreview/onlyPreview.types';
import { ONLY_PREVIEW_OOXML_PREFLIGHT_TIMEOUT_MS } from './onlyPreviewOoxmlPreflight.service';
import {
  MAX_VIEWPORT_AREA,
  WORKER_ERROR_CODES,
  hasExactResponseKeys,
  hasTypedWorkerIdentity,
  isIntegerInRange,
  validateLayout,
  validateManifest,
  validateSearchResult,
  validateViewport,
  type SheetViewportBounds
} from './onlyPreviewSheetResponseValidator.service';
import {
  type OnlyPreviewSheetLayout,
  type OnlyPreviewSheetManifest,
  type OnlyPreviewSheetManifestSheet,
  type OnlyPreviewSheetSearchResult,
  type OnlyPreviewSheetViewport,
  type OnlyPreviewSheetWorkerIdentity,
  type OnlyPreviewSheetWorkerRequest,
  type OnlyPreviewSheetWorkerResponse
} from './workers/onlyPreviewSheetWorker.contract';

const PARSE_TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 10_000;
let nextWorkerGeneration = 0;

interface SheetWorkerLike {
  postMessage(message: OnlyPreviewSheetWorkerRequest, transfer?: Transferable[]): void;
  terminate(): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
  addEventListener(type: 'error' | 'messageerror', listener: () => void): void;
}

interface PendingRequest<T> {
  type: 'loaded' | 'layout' | 'viewport' | 'search';
  validate(response: Record<string, unknown>): T;
  resolve(value: T): void;
  reject(error: unknown): void;
  timer: ReturnType<typeof setTimeout>;
  preflightAcknowledged?: boolean;
}

type SheetWorkerRequestPayload<T = Exclude<OnlyPreviewSheetWorkerRequest, { type: 'load' }>> =
  T extends OnlyPreviewSheetWorkerRequest
    ? Omit<T, keyof OnlyPreviewSheetWorkerIdentity | 'requestId'>
    : never;

export interface OnlyPreviewSheetSessionOptions {
  hostId: string;
  selectionRevision: number;
  onUnexpectedTerminal?: (error: OnlyPreviewContractError) => void;
  fetchImpl?: typeof fetch;
  workerFactory?: () => SheetWorkerLike;
}

export interface OnlyPreviewSheetSessionApi {
  requestLayout(sheetId: number): Promise<OnlyPreviewSheetLayout>;
  requestViewport(
    sheetId: number,
    rowStart: number,
    rowEnd: number,
    columnStart: number,
    columnEnd: number
  ): Promise<OnlyPreviewSheetViewport>;
  query(query: string, caseSensitive: boolean): Promise<OnlyPreviewSheetSearchResult>;
  next(): Promise<OnlyPreviewSheetSearchResult>;
  previous(): Promise<OnlyPreviewSheetSearchResult>;
  clear(): Promise<OnlyPreviewSheetSearchResult>;
  reveal(ordinal: number): Promise<OnlyPreviewSheetSearchResult>;
  dispose(): void;
}

const defaultWorkerFactory = (): SheetWorkerLike =>
  new Worker(new URL('./workers/onlyPreviewSheet.worker.ts', import.meta.url), {
    type: 'module',
    name: 'onlypreview-sheet'
  });

const hasZipSignature = (bytes: ArrayBuffer): boolean => {
  if (bytes.byteLength < 4) return false;
  const signature = new Uint8Array(bytes, 0, 4);
  return (
    signature[0] === 0x50 && signature[1] === 0x4b && signature[2] === 0x03 && signature[3] === 0x04
  );
};

export class OnlyPreviewSheetSession implements OnlyPreviewSheetSessionApi {
  private readonly identity: OnlyPreviewSheetWorkerIdentity;
  private readonly abortController = new AbortController();
  private readonly pending = new Map<number, PendingRequest<unknown>>();
  private readonly fetchImpl: typeof fetch;
  private readonly workerFactory: () => SheetWorkerLike;
  private readonly onUnexpectedTerminal?: (error: OnlyPreviewContractError) => void;
  private worker: SheetWorkerLike | null = null;
  private requestId = 0;
  private disposed = false;
  private loadStarted = false;
  manifest: OnlyPreviewSheetManifest | null = null;

  constructor(options: OnlyPreviewSheetSessionOptions) {
    this.identity = {
      hostId: options.hostId,
      runtimeId: crypto.randomUUID(),
      selectionRevision: options.selectionRevision,
      workerGeneration: ++nextWorkerGeneration
    };
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.workerFactory = options.workerFactory ?? defaultWorkerFactory;
    this.onUnexpectedTerminal = options.onUnexpectedTerminal;
  }

  async load(assetUrl: string, expectedSize: number): Promise<OnlyPreviewSheetManifest> {
    this.requireActive();
    if (this.loadStarted) {
      throw new OnlyPreviewContractError('INVALID_INPUT', 'Workbook session load is single-use.');
    }
    this.loadStarted = true;
    let response: Response;
    try {
      response = await this.fetchImpl(assetUrl, {
        method: 'GET',
        cache: 'no-store',
        credentials: 'omit',
        signal: this.abortController.signal
      });
    } catch {
      this.requireActive();
      this.failLoad(
        new OnlyPreviewContractError('SHEET_PARSE_FAILED', 'Workbook bytes could not be read.')
      );
    }
    this.requireActive();
    if (response.status !== 200) {
      this.failLoad(
        new OnlyPreviewContractError('SHEET_PARSE_FAILED', 'Workbook bytes could not be read.')
      );
    }
    let bytes: ArrayBuffer;
    try {
      bytes = await response.arrayBuffer();
    } catch {
      this.requireActive();
      this.failLoad(
        new OnlyPreviewContractError('SHEET_PARSE_FAILED', 'Workbook stream could not be read.')
      );
    }
    this.requireActive();
    if (
      !Number.isSafeInteger(expectedSize) ||
      expectedSize < 0 ||
      bytes.byteLength !== expectedSize
    ) {
      this.failLoad(
        new OnlyPreviewContractError('SHEET_PARSE_FAILED', 'Workbook size changed while loading.')
      );
    }
    if (bytes.byteLength > ONLY_PREVIEW_MAX_SHEET_BYTES) {
      this.failLoad(
        new OnlyPreviewContractError('TEXT_TOO_LARGE', 'Workbook exceeds the preview limit.')
      );
    }
    if (!hasZipSignature(bytes)) {
      this.failLoad(
        new OnlyPreviewContractError(
          'SIGNATURE_MISMATCH',
          'Workbook contents do not match the file extension.'
        )
      );
    }
    let worker: SheetWorkerLike;
    try {
      worker = this.workerFactory();
      this.worker = worker;
      worker.addEventListener('message', (event) => this.handleMessage(event.data));
      worker.addEventListener('error', () => this.failWorker());
      worker.addEventListener('messageerror', () => this.failWorker());
    } catch {
      this.failLoad(
        new OnlyPreviewContractError('SHEET_PARSE_FAILED', 'Workbook worker could not be created.')
      );
    }
    const manifest = await this.loadWorker(bytes);
    this.requireActive();
    this.manifest = manifest;
    return manifest;
  }

  requestLayout(sheetId: number): Promise<OnlyPreviewSheetLayout> {
    const sheet = this.requireManifestSheet(sheetId);
    return this.request<OnlyPreviewSheetLayout>({ type: 'layout', sheetId }, 'layout', (response) =>
      validateLayout(response.layout, sheet)
    );
  }

  requestViewport(
    sheetId: number,
    rowStart: number,
    rowEnd: number,
    columnStart: number,
    columnEnd: number
  ): Promise<OnlyPreviewSheetViewport> {
    const sheet = this.requireManifestSheet(sheetId);
    if (
      !isIntegerInRange(rowStart, 1, sheet.rowCount) ||
      !isIntegerInRange(rowEnd, rowStart, sheet.rowCount) ||
      !isIntegerInRange(columnStart, 1, sheet.columnCount) ||
      !isIntegerInRange(columnEnd, columnStart, sheet.columnCount) ||
      (rowEnd - rowStart + 1) * (columnEnd - columnStart + 1) > MAX_VIEWPORT_AREA
    ) {
      throw new OnlyPreviewContractError('INVALID_INPUT', 'Workbook viewport bounds are invalid.');
    }
    const bounds: SheetViewportBounds = {
      sheet,
      rowStart,
      rowEnd,
      columnStart,
      columnEnd
    };
    return this.request<OnlyPreviewSheetViewport>(
      { type: 'viewport', sheetId, rowStart, rowEnd, columnStart, columnEnd },
      'viewport',
      (response) => validateViewport(response.viewport, bounds, this.requireManifest())
    );
  }

  query(query: string, caseSensitive: boolean): Promise<OnlyPreviewSheetSearchResult> {
    return this.search({ operation: 'query', query, caseSensitive });
  }

  next(): Promise<OnlyPreviewSheetSearchResult> {
    return this.search({ operation: 'next' });
  }

  previous(): Promise<OnlyPreviewSheetSearchResult> {
    return this.search({ operation: 'previous' });
  }

  clear(): Promise<OnlyPreviewSheetSearchResult> {
    return this.search({ operation: 'clear' });
  }

  reveal(ordinal: number): Promise<OnlyPreviewSheetSearchResult> {
    return this.search({ operation: 'reveal', ordinal });
  }

  dispose(): void {
    this.failTerminal(
      new OnlyPreviewContractError('SHEET_RENDER_TIMEOUT', 'Workbook preview session ended.'),
      false
    );
  }

  private loadWorker(bytes: ArrayBuffer): Promise<OnlyPreviewSheetManifest> {
    const worker = this.requireWorker();
    const requestId = ++this.requestId;
    const promise = new Promise<OnlyPreviewSheetManifest>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.failTerminal(
          new OnlyPreviewContractError(
            'SHEET_RENDER_TIMEOUT',
            'Workbook archive preflight timed out.'
          )
        );
      }, ONLY_PREVIEW_OOXML_PREFLIGHT_TIMEOUT_MS);
      this.pending.set(requestId, {
        type: 'loaded',
        validate: (response) => validateManifest(response.manifest),
        resolve,
        reject,
        timer,
        preflightAcknowledged: false
      });
    });
    const message: Extract<OnlyPreviewSheetWorkerRequest, { type: 'load' }> = {
      ...this.identity,
      requestId,
      type: 'load',
      bytes
    };
    try {
      worker.postMessage(message, [bytes]);
    } catch {
      this.failTerminal(
        new OnlyPreviewContractError('SHEET_PARSE_FAILED', 'Workbook worker could not start.')
      );
    }
    return promise;
  }

  private request<T>(
    payload: SheetWorkerRequestPayload,
    expectedType: PendingRequest<T>['type'],
    validate: (response: Record<string, unknown>) => T
  ): Promise<T> {
    const worker = this.requireWorker();
    this.requireActive();
    const requestId = ++this.requestId;
    const promise = new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.failTerminal(
          new OnlyPreviewContractError('SHEET_RENDER_TIMEOUT', 'Workbook view request timed out.')
        );
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(requestId, {
        type: expectedType,
        validate,
        resolve,
        reject,
        timer
      });
    });
    try {
      worker.postMessage({
        ...this.identity,
        requestId,
        ...payload
      } as OnlyPreviewSheetWorkerRequest);
    } catch {
      this.failTerminal(
        new OnlyPreviewContractError('SHEET_PARSE_FAILED', 'Workbook worker request failed.')
      );
    }
    return promise;
  }

  private search(
    payload: Omit<
      Extract<OnlyPreviewSheetWorkerRequest, { type: 'search' }>,
      keyof OnlyPreviewSheetWorkerIdentity | 'requestId' | 'type'
    >
  ): Promise<OnlyPreviewSheetSearchResult> {
    return this.request<OnlyPreviewSheetSearchResult>(
      { type: 'search', ...payload },
      'search',
      (response) => validateSearchResult(response.result, this.requireManifest())
    );
  }

  private handleMessage(response: unknown): void {
    if (this.disposed) return;
    if (!hasTypedWorkerIdentity(response)) {
      this.failMalformedResponse();
      return;
    }
    if (!this.matchesIdentity(response)) return;
    if (
      !isIntegerInRange(response.requestId, 1, Number.MAX_SAFE_INTEGER) ||
      typeof response.type !== 'string'
    ) {
      this.failMalformedResponse();
      return;
    }
    const pending = this.pending.get(response.requestId);
    if (!pending || !hasExactResponseKeys(response)) {
      this.failMalformedResponse();
      return;
    }
    if (response.type === 'preflight-ready' && pending.type === 'loaded') {
      if (pending.preflightAcknowledged) {
        this.failTerminal(
          new OnlyPreviewContractError('SHEET_PARSE_FAILED', 'Workbook worker repeated preflight.')
        );
        return;
      }
      clearTimeout(pending.timer);
      pending.preflightAcknowledged = true;
      pending.timer = setTimeout(() => {
        this.failTerminal(
          new OnlyPreviewContractError(
            'SHEET_RENDER_TIMEOUT',
            'Workbook parsing and model construction timed out.'
          )
        );
      }, PARSE_TIMEOUT_MS);
      return;
    }
    if (response.type === 'error') {
      if (typeof response.errorCode !== 'string' || !WORKER_ERROR_CODES.has(response.errorCode)) {
        this.failMalformedResponse();
        return;
      }
      this.failTerminal(
        new OnlyPreviewContractError(
          response.errorCode as Extract<
            OnlyPreviewSheetWorkerResponse,
            { type: 'error' }
          >['errorCode'],
          'Workbook preview could not be built.'
        )
      );
      return;
    }
    if (response.type !== pending.type) {
      this.failMalformedResponse();
      return;
    }
    if (response.type === 'loaded' && !pending.preflightAcknowledged) {
      this.failTerminal(
        new OnlyPreviewContractError('SHEET_PARSE_FAILED', 'Workbook preflight was not confirmed.')
      );
      return;
    }
    let result: unknown;
    try {
      result = pending.validate(response);
    } catch {
      this.failMalformedResponse();
      return;
    }
    this.pending.delete(response.requestId);
    clearTimeout(pending.timer);
    pending.resolve(result);
  }

  private failMalformedResponse(): void {
    this.failTerminal(
      new OnlyPreviewContractError('SHEET_PARSE_FAILED', 'Workbook worker response was invalid.')
    );
  }

  private failWorker(): void {
    if (this.disposed) return;
    this.failTerminal(
      new OnlyPreviewContractError('SHEET_PARSE_FAILED', 'Workbook worker failed.')
    );
  }

  private failTerminal(
    error: OnlyPreviewContractError,
    notifyUnexpected = this.manifest !== null
  ): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abortController.abort();
    this.worker?.terminate();
    this.worker = null;
    this.manifest = null;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    if (notifyUnexpected) this.onUnexpectedTerminal?.(error);
  }

  private failLoad(error: OnlyPreviewContractError): never {
    this.failTerminal(error, false);
    throw error;
  }

  private matchesIdentity(response: Record<string, unknown>): boolean {
    return (
      response.hostId === this.identity.hostId &&
      response.runtimeId === this.identity.runtimeId &&
      response.selectionRevision === this.identity.selectionRevision &&
      response.workerGeneration === this.identity.workerGeneration
    );
  }

  private requireManifest(): OnlyPreviewSheetManifest {
    this.requireActive();
    if (!this.manifest) {
      throw new OnlyPreviewContractError('INVALID_INPUT', 'Workbook manifest is unavailable.');
    }
    return this.manifest;
  }

  private requireManifestSheet(sheetId: number): OnlyPreviewSheetManifestSheet {
    const manifest = this.requireManifest();
    if (!Number.isSafeInteger(sheetId)) {
      throw new OnlyPreviewContractError('INVALID_INPUT', 'Workbook sheet is invalid.');
    }
    const sheet = manifest.sheets.find((candidate) => candidate.id === sheetId);
    if (!sheet) {
      throw new OnlyPreviewContractError('INVALID_INPUT', 'Workbook sheet is invalid.');
    }
    return sheet;
  }

  private requireWorker(): SheetWorkerLike {
    this.requireActive();
    if (!this.worker) {
      throw new OnlyPreviewContractError('SHEET_PARSE_FAILED', 'Workbook worker is unavailable.');
    }
    return this.worker;
  }

  private requireActive(): void {
    if (this.disposed) {
      throw new OnlyPreviewContractError(
        'SHEET_RENDER_TIMEOUT',
        'Workbook preview is no longer active.'
      );
    }
  }
}
