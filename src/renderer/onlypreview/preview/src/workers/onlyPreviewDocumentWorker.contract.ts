import type { OnlyPreviewErrorCode } from '@shared/onlypreview/onlyPreview.types';

export interface OnlyPreviewDocumentWorkerIdentity {
  hostId: string;
  runtimeId: string;
  selectionRevision: number;
  workerGeneration: number;
}

export interface OnlyPreviewDocumentWorkerRequest extends OnlyPreviewDocumentWorkerIdentity {
  requestId: number;
  type: 'preflight';
  bytes: ArrayBuffer;
}

export type OnlyPreviewDocumentWorkerErrorCode = Extract<
  OnlyPreviewErrorCode,
  | 'OOXML_ARCHIVE_LIMIT'
  | 'OOXML_ENCRYPTED'
  | 'OOXML_ARCHIVE_INVALID'
  | 'DOCUMENT_PARSE_FAILED'
  | 'DOCUMENT_RENDER_TIMEOUT'
>;

export type OnlyPreviewDocumentWorkerResponse =
  | (OnlyPreviewDocumentWorkerIdentity & {
      requestId: number;
      type: 'preflight-ready';
      bytes: ArrayBuffer;
    })
  | (OnlyPreviewDocumentWorkerIdentity & {
      requestId: number;
      type: 'error';
      errorCode: OnlyPreviewDocumentWorkerErrorCode;
    });
