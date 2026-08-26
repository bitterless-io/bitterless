import type { OnlyPreviewErrorCode } from '@shared/onlypreview/onlyPreview.types';

export const ONLY_PREVIEW_DRAWIO_MAX_EXPANDED_BYTES = 32 * 1024 * 1024;
export const ONLY_PREVIEW_DRAWIO_MAX_PAGES = 128;
export const ONLY_PREVIEW_DRAWIO_MAX_CELLS = 20_000;
export const ONLY_PREVIEW_DRAWIO_PREFLIGHT_TIMEOUT_MS = 10_000;

export interface OnlyPreviewDrawioWorkerIdentity {
  hostId: string;
  runtimeId: string;
  selectionRevision: number;
  workerGeneration: number;
}

export interface OnlyPreviewDrawioWorkerRequest extends OnlyPreviewDrawioWorkerIdentity {
  requestId: number;
  type: 'preflight';
  bytes: ArrayBuffer;
}

export type OnlyPreviewDrawioWorkerErrorCode = Extract<
  OnlyPreviewErrorCode,
  'DIAGRAM_PARSE_FAILED' | 'DIAGRAM_EMPTY' | 'DIAGRAM_LIMIT' | 'DIAGRAM_RENDER_TIMEOUT'
>;

export type OnlyPreviewDrawioWorkerResponse =
  | (OnlyPreviewDrawioWorkerIdentity & {
      requestId: number;
      type: 'preflight-ready';
      bytes: ArrayBuffer;
      pageCount: number;
      cellCount: number;
    })
  | (OnlyPreviewDrawioWorkerIdentity & {
      requestId: number;
      type: 'error';
      errorCode: OnlyPreviewDrawioWorkerErrorCode;
    });
