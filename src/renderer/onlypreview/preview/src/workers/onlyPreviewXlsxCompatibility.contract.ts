export interface OnlyPreviewXlsxCompatibilityIdentity {
  runtimeId: string;
  selectionRevision: number;
  requestId: number;
}

export const ONLY_PREVIEW_XLSX_COMPATIBILITY_MAX_INPUT_BYTES = 4 * 1024 * 1024;
export const ONLY_PREVIEW_XLSX_COMPATIBILITY_MAX_INFLATED_BYTES = 8 * 1024 * 1024;
export const ONLY_PREVIEW_XLSX_COMPATIBILITY_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
export const ONLY_PREVIEW_XLSX_COMPATIBILITY_TIMEOUT_MS = 10_000;

export interface OnlyPreviewXlsxCompatibilityRequest extends OnlyPreviewXlsxCompatibilityIdentity {
  type: 'normalize';
  bytes: ArrayBuffer;
}

export type OnlyPreviewXlsxCompatibilityResponse =
  | (OnlyPreviewXlsxCompatibilityIdentity & {
      type: 'ready';
      bytes: ArrayBuffer;
    })
  | (OnlyPreviewXlsxCompatibilityIdentity & {
      type: 'error';
      errorCode: 'OOXML_ARCHIVE_LIMIT' | 'SHEET_PARSE_FAILED';
    });
