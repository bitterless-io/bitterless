import type { OnlyPreviewOoxmlPackageKind } from '../onlyPreviewOoxmlPreflight.type';

export interface OnlyPreviewOfficePreflightIdentity {
  runtimeId: string;
  selectionRevision: number;
  requestId: number;
}

export interface OnlyPreviewOfficePreflightRequest extends OnlyPreviewOfficePreflightIdentity {
  type: 'preflight';
  kind: OnlyPreviewOoxmlPackageKind;
  bytes: ArrayBuffer;
}

export type OnlyPreviewOfficePreflightResponse =
  | (OnlyPreviewOfficePreflightIdentity & {
      type: 'ready';
      bytes: ArrayBuffer;
    })
  | (OnlyPreviewOfficePreflightIdentity & {
      type: 'error';
      errorCode:
        | 'OOXML_ARCHIVE_LIMIT'
        | 'OOXML_ENCRYPTED'
        | 'OOXML_ARCHIVE_INVALID'
        | 'OOXML_PREFLIGHT_TIMEOUT';
    });
