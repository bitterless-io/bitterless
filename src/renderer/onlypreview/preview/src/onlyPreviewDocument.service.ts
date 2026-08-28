import { OnlyPreviewContractError } from '@shared/onlypreview/onlyPreview.contract';
import {
  ONLY_PREVIEW_MAX_DOCUMENT_BYTES,
  type OnlyPreviewErrorCode
} from '@shared/onlypreview/onlyPreview.types';
import {
  collectOnlyPreviewDocumentBlobUrls,
  OnlyPreviewDocumentSanitizerError,
  sanitizeOnlyPreviewDocument
} from './onlyPreviewDocumentSanitizer.service';
import { ONLY_PREVIEW_OOXML_PREFLIGHT_TIMEOUT_MS } from './onlyPreviewOoxmlPreflight.service';
import type {
  OnlyPreviewDocumentWorkerErrorCode,
  OnlyPreviewDocumentWorkerIdentity,
  OnlyPreviewDocumentWorkerRequest,
  OnlyPreviewDocumentWorkerResponse
} from './workers/onlyPreviewDocumentWorker.contract';

interface DocumentWorkerLike {
  postMessage(message: OnlyPreviewDocumentWorkerRequest, transfer?: Transferable[]): void;
  terminate(): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
  addEventListener(type: 'error' | 'messageerror', listener: () => void): void;
}

interface DocxPreviewModule {
  renderAsync(
    data: ArrayBuffer,
    bodyContainer: HTMLElement,
    styleContainer: HTMLElement,
    options: {
      className: string;
      ignoreFonts: boolean;
      renderHeaders: boolean;
      renderFooters: boolean;
      renderChanges: boolean;
      renderComments: boolean;
      renderAltChunks: boolean;
      useBase64URL: boolean;
      experimental: boolean;
      debug: boolean;
    }
  ): Promise<unknown>;
}

export interface OnlyPreviewDocumentRender {
  fragment: DocumentFragment;
  cssText: string;
  blobUrls: ReadonlySet<string>;
}

export interface OnlyPreviewDocumentSessionOptions {
  hostId: string;
  selectionRevision: number;
  fetchImpl?: typeof fetch;
  workerFactory?: () => DocumentWorkerLike;
  moduleLoader?: () => Promise<DocxPreviewModule>;
  revokeObjectUrl?: (url: string) => void;
}

const DOCUMENT_WORKER_ERROR_CODES: ReadonlySet<OnlyPreviewDocumentWorkerErrorCode> = new Set([
  'OOXML_ARCHIVE_LIMIT',
  'OOXML_ENCRYPTED',
  'OOXML_ARCHIVE_INVALID',
  'DOCUMENT_PARSE_FAILED',
  'DOCUMENT_RENDER_TIMEOUT'
]);

const RESPONSE_BASE_KEYS = [
  'hostId',
  'runtimeId',
  'selectionRevision',
  'workerGeneration',
  'requestId',
  'type'
] as const;

let nextWorkerGeneration = 0;

const defaultWorkerFactory = (): DocumentWorkerLike =>
  new Worker(new URL('./workers/onlyPreviewDocumentPreflight.worker.ts', import.meta.url), {
    type: 'module',
    name: 'onlypreview-document-preflight'
  });

const defaultModuleLoader = async (): Promise<DocxPreviewModule> => {
  throw new Error('The retired docx-preview renderer is unavailable.');
};

const hasZipSignature = (bytes: ArrayBuffer): boolean => {
  if (bytes.byteLength < 4) return false;
  const signature = new Uint8Array(bytes, 0, 4);
  return (
    signature[0] === 0x50 && signature[1] === 0x4b && signature[2] === 0x03 && signature[3] === 0x04
  );
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const ownKeys = Object.keys(value);
  return ownKeys.length === keys.length && keys.every((key) => ownKeys.includes(key));
};

const bestEffortBlobUrls = (body: HTMLElement, style: HTMLElement): Set<string> => {
  const urls = new Set<string>();
  const source = `${body.outerHTML}\n${style.textContent ?? ''}`;
  for (const match of source.matchAll(/blob:[^\s"'()<>]+/giu)) urls.add(match[0]);
  return urls;
};

const asDocumentError = (
  code: Extract<
    OnlyPreviewErrorCode,
    | 'DOCUMENT_PARSE_FAILED'
    | 'DOCUMENT_EMPTY'
    | 'DOCUMENT_SANITIZE_FAILED'
    | 'DOCUMENT_RENDER_TIMEOUT'
  >,
  message: string
): OnlyPreviewContractError => new OnlyPreviewContractError(code, message);

export class OnlyPreviewDocumentSession {
  private readonly identity: OnlyPreviewDocumentWorkerIdentity;
  private readonly abortController = new AbortController();
  private readonly fetchImpl: typeof fetch;
  private readonly workerFactory: () => DocumentWorkerLike;
  private readonly moduleLoader: () => Promise<DocxPreviewModule>;
  private readonly revokeObjectUrl: (url: string) => void;
  private readonly ownedBlobUrls = new Set<string>();
  private worker: DocumentWorkerLike | null = null;
  private cancelPendingPreflight: (() => void) | null = null;
  private disposed = false;
  private loadStarted = false;

  constructor(options: OnlyPreviewDocumentSessionOptions) {
    this.identity = {
      hostId: options.hostId,
      runtimeId: crypto.randomUUID(),
      selectionRevision: options.selectionRevision,
      workerGeneration: ++nextWorkerGeneration
    };
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.workerFactory = options.workerFactory ?? defaultWorkerFactory;
    this.moduleLoader = options.moduleLoader ?? defaultModuleLoader;
    this.revokeObjectUrl = options.revokeObjectUrl ?? ((url) => URL.revokeObjectURL(url));
  }

  async load(
    assetUrl: string,
    expectedSize: number,
    ownerDocument: Document
  ): Promise<OnlyPreviewDocumentRender> {
    this.requireActive();
    if (this.loadStarted) {
      throw new OnlyPreviewContractError('INVALID_INPUT', 'Document session load is single-use.');
    }
    this.loadStarted = true;
    const bytes = await this.fetchBytes(assetUrl, expectedSize);
    const preflightBytes = await this.preflight(bytes);
    this.requireActive();

    const bodyContainer = ownerDocument.createElement('div');
    const styleContainer = ownerDocument.createElement('div');
    try {
      const module = await this.moduleLoader();
      this.requireActive();
      if (!module || typeof module.renderAsync !== 'function') {
        throw asDocumentError('DOCUMENT_PARSE_FAILED', 'The document renderer is unavailable.');
      }
      await module.renderAsync(preflightBytes, bodyContainer, styleContainer, {
        className: 'onlypreview-docx',
        ignoreFonts: true,
        renderHeaders: true,
        renderFooters: true,
        renderChanges: false,
        renderComments: false,
        renderAltChunks: false,
        useBase64URL: false,
        experimental: false,
        debug: false
      });
    } catch (error) {
      this.revokeDetachedBlobUrls(bodyContainer, styleContainer);
      if (error instanceof OnlyPreviewContractError) throw error;
      throw asDocumentError('DOCUMENT_PARSE_FAILED', 'The document could not be parsed.');
    }

    let discoveredBlobUrls: Set<string>;
    try {
      discoveredBlobUrls = collectOnlyPreviewDocumentBlobUrls(bodyContainer, styleContainer);
    } catch {
      this.revokeDetachedBlobUrls(bodyContainer, styleContainer);
      throw asDocumentError(
        'DOCUMENT_SANITIZE_FAILED',
        'The document resources could not be verified.'
      );
    }
    if (this.disposed) {
      this.revokeBlobUrls(discoveredBlobUrls);
      throw asDocumentError('DOCUMENT_RENDER_TIMEOUT', 'The document preview session ended.');
    }

    try {
      const sanitized = sanitizeOnlyPreviewDocument(
        bodyContainer,
        styleContainer,
        discoveredBlobUrls
      );
      if (!sanitized.hasRenderableContent) {
        this.revokeBlobUrls(discoveredBlobUrls);
        throw asDocumentError('DOCUMENT_EMPTY', 'The document has no content to preview.');
      }
      for (const url of discoveredBlobUrls) {
        if (sanitized.usedBlobUrls.has(url)) this.ownedBlobUrls.add(url);
        else this.revokeBlobUrls([url]);
      }
      return {
        fragment: sanitized.fragment,
        cssText: sanitized.cssText,
        blobUrls: new Set(this.ownedBlobUrls)
      };
    } catch (error) {
      this.revokeBlobUrls(discoveredBlobUrls);
      if (error instanceof OnlyPreviewContractError) throw error;
      if (error instanceof OnlyPreviewDocumentSanitizerError) {
        throw asDocumentError('DOCUMENT_SANITIZE_FAILED', error.message);
      }
      throw asDocumentError(
        'DOCUMENT_SANITIZE_FAILED',
        'The document output did not pass the safety checks.'
      );
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abortController.abort();
    this.cancelPendingPreflight?.();
    this.worker?.terminate();
    this.worker = null;
    this.revokeBlobUrls(this.ownedBlobUrls);
    this.ownedBlobUrls.clear();
  }

  private async fetchBytes(assetUrl: string, expectedSize: number): Promise<ArrayBuffer> {
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
      throw asDocumentError('DOCUMENT_PARSE_FAILED', 'Document bytes could not be read.');
    }
    this.requireActive();
    if (response.status !== 200) {
      throw asDocumentError('DOCUMENT_PARSE_FAILED', 'Document bytes could not be read.');
    }
    let bytes: ArrayBuffer;
    try {
      bytes = await response.arrayBuffer();
    } catch {
      this.requireActive();
      throw asDocumentError('DOCUMENT_PARSE_FAILED', 'Document stream could not be read.');
    }
    this.requireActive();
    if (
      !Number.isSafeInteger(expectedSize) ||
      expectedSize < 0 ||
      bytes.byteLength !== expectedSize
    ) {
      throw asDocumentError('DOCUMENT_PARSE_FAILED', 'Document size changed while loading.');
    }
    if (bytes.byteLength > ONLY_PREVIEW_MAX_DOCUMENT_BYTES) {
      throw new OnlyPreviewContractError('TEXT_TOO_LARGE', 'Document exceeds the preview limit.');
    }
    if (!hasZipSignature(bytes)) {
      throw new OnlyPreviewContractError(
        'SIGNATURE_MISMATCH',
        'Document contents do not match the file extension.'
      );
    }
    return bytes;
  }

  private preflight(bytes: ArrayBuffer): Promise<ArrayBuffer> {
    this.requireActive();
    let worker: DocumentWorkerLike;
    try {
      worker = this.workerFactory();
      this.worker = worker;
    } catch {
      throw asDocumentError('DOCUMENT_PARSE_FAILED', 'Document Worker could not be created.');
    }
    const requestId = 1;
    return new Promise<ArrayBuffer>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let cancelOnDispose: (() => void) | null = null;
      const settle = (result: { bytes?: ArrayBuffer; error?: OnlyPreviewContractError }): void => {
        if (settled) return;
        settled = true;
        if (timer !== null) clearTimeout(timer);
        worker.terminate();
        if (this.worker === worker) this.worker = null;
        if (this.cancelPendingPreflight === cancelOnDispose) {
          this.cancelPendingPreflight = null;
        }
        if (result.error) reject(result.error);
        else resolve(result.bytes!);
      };
      cancelOnDispose = () => {
        settle({
          error: asDocumentError('DOCUMENT_RENDER_TIMEOUT', 'The document preview session ended.')
        });
      };
      this.cancelPendingPreflight = cancelOnDispose;
      timer = setTimeout(() => {
        settle({
          error: asDocumentError('DOCUMENT_RENDER_TIMEOUT', 'Document archive preflight timed out.')
        });
      }, ONLY_PREVIEW_OOXML_PREFLIGHT_TIMEOUT_MS);
      worker.addEventListener('message', (event) => {
        const response = event.data;
        if (!this.matchesResponseIdentity(response, requestId)) return;
        if (response.type === 'error') {
          if (
            !hasExactKeys(response, [...RESPONSE_BASE_KEYS, 'errorCode']) ||
            typeof response.errorCode !== 'string' ||
            !DOCUMENT_WORKER_ERROR_CODES.has(
              response.errorCode as OnlyPreviewDocumentWorkerErrorCode
            )
          ) {
            settle({
              error: asDocumentError(
                'DOCUMENT_PARSE_FAILED',
                'Document Worker response was invalid.'
              )
            });
            return;
          }
          settle({
            error: new OnlyPreviewContractError(
              response.errorCode as OnlyPreviewDocumentWorkerErrorCode,
              'Document archive preflight failed.'
            )
          });
          return;
        }
        if (
          response.type !== 'preflight-ready' ||
          !hasExactKeys(response, [...RESPONSE_BASE_KEYS, 'bytes']) ||
          !(response.bytes instanceof ArrayBuffer) ||
          response.bytes.byteLength === 0
        ) {
          settle({
            error: asDocumentError('DOCUMENT_PARSE_FAILED', 'Document Worker response was invalid.')
          });
          return;
        }
        settle({ bytes: response.bytes });
      });
      const failWorker = (): void =>
        settle({ error: asDocumentError('DOCUMENT_PARSE_FAILED', 'Document Worker failed.') });
      worker.addEventListener('error', failWorker);
      worker.addEventListener('messageerror', failWorker);
      const message: OnlyPreviewDocumentWorkerRequest = {
        ...this.identity,
        requestId,
        type: 'preflight',
        bytes
      };
      try {
        worker.postMessage(message, [bytes]);
      } catch {
        failWorker();
      }
    });
  }

  private matchesResponseIdentity(
    value: unknown,
    requestId: number
  ): value is OnlyPreviewDocumentWorkerResponse & Record<string, unknown> {
    return (
      isRecord(value) &&
      value.hostId === this.identity.hostId &&
      value.runtimeId === this.identity.runtimeId &&
      value.selectionRevision === this.identity.selectionRevision &&
      value.workerGeneration === this.identity.workerGeneration &&
      value.requestId === requestId &&
      (value.type === 'preflight-ready' || value.type === 'error')
    );
  }

  private revokeDetachedBlobUrls(body: HTMLElement, style: HTMLElement): void {
    let urls: Set<string>;
    try {
      urls = collectOnlyPreviewDocumentBlobUrls(body, style);
    } catch {
      urls = bestEffortBlobUrls(body, style);
    }
    this.revokeBlobUrls(urls);
  }

  private revokeBlobUrls(urls: Iterable<string>): void {
    for (const url of urls) {
      try {
        this.revokeObjectUrl(url);
      } catch {
        // Revocation is idempotent and best-effort during teardown.
      }
      this.ownedBlobUrls.delete(url);
    }
  }

  private requireActive(): void {
    if (this.disposed) {
      throw asDocumentError('DOCUMENT_RENDER_TIMEOUT', 'The document preview session ended.');
    }
  }
}
