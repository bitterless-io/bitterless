import type { OnlyPreviewErrorCode } from '@shared/onlypreview/onlyPreview.types';

export const ONLY_PREVIEW_SHEET_MAX_SHEETS = 64;
export const ONLY_PREVIEW_SHEET_MAX_ROWS = 100_000;
export const ONLY_PREVIEW_SHEET_MAX_COLUMNS = 512;
export const ONLY_PREVIEW_SHEET_MAX_CELLS = 500_000;
export const ONLY_PREVIEW_SHEET_MAX_MERGES = 100_000;
export const ONLY_PREVIEW_SHEET_MAX_DIMENSIONS = 500_000;
export const ONLY_PREVIEW_SHEET_MAX_CELL_TEXT_CHARS = 1_048_576;
export const ONLY_PREVIEW_SHEET_MAX_TOTAL_TEXT_CHARS = 16_777_216;

export type OnlyPreviewSheetCoverage =
  | { kind: 'complete' }
  | {
      kind: 'partial';
      reason: 'sheet-model-cap';
      acceptedSheets: number;
      acceptedCells: number;
    };

export interface OnlyPreviewSheetWorkerIdentity {
  hostId: string;
  runtimeId: string;
  selectionRevision: number;
  workerGeneration: number;
}

export interface OnlyPreviewSheetManifestSheet {
  id: number;
  name: string;
  rowCount: number;
  columnCount: number;
}

export interface OnlyPreviewSheetManifest {
  sheets: OnlyPreviewSheetManifestSheet[];
  acceptedCells: number;
  coverage: OnlyPreviewSheetCoverage;
}

export interface OnlyPreviewSheetDimension {
  index: number;
  size: number;
}

export interface OnlyPreviewSheetMerge {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export interface OnlyPreviewSheetLayout {
  sheetId: number;
  rowCount: number;
  columnCount: number;
  defaultRowHeight: number;
  defaultColumnWidth: number;
  rowHeights: OnlyPreviewSheetDimension[];
  columnWidths: OnlyPreviewSheetDimension[];
}

export interface OnlyPreviewSheetCellStyle {
  horizontal?: 'left' | 'center' | 'right';
  vertical?: 'top' | 'middle' | 'bottom';
  wrap?: boolean;
  bold?: boolean;
  italic?: boolean;
  color?: string;
  fill?: string;
}

export interface OnlyPreviewSheetCell {
  row: number;
  column: number;
  text: string;
  style?: OnlyPreviewSheetCellStyle;
}

export interface OnlyPreviewSheetViewport {
  sheetId: number;
  rowStart: number;
  rowEnd: number;
  columnStart: number;
  columnEnd: number;
  cells: OnlyPreviewSheetCell[];
  merges: OnlyPreviewSheetMerge[];
}

export interface OnlyPreviewSheetSearchTarget {
  sheetId: number;
  row: number;
  column: number;
}

export interface OnlyPreviewSheetSearchResult {
  total: number;
  active: number;
  coverage: OnlyPreviewSheetCoverage;
  target: OnlyPreviewSheetSearchTarget | null;
}

interface OnlyPreviewSheetWorkerRequestBase extends OnlyPreviewSheetWorkerIdentity {
  requestId: number;
}

export type OnlyPreviewSheetWorkerRequest =
  | (OnlyPreviewSheetWorkerRequestBase & {
      type: 'load';
      bytes: ArrayBuffer;
    })
  | (OnlyPreviewSheetWorkerRequestBase & {
      type: 'layout';
      sheetId: number;
    })
  | (OnlyPreviewSheetWorkerRequestBase & {
      type: 'viewport';
      sheetId: number;
      rowStart: number;
      rowEnd: number;
      columnStart: number;
      columnEnd: number;
    })
  | (OnlyPreviewSheetWorkerRequestBase & {
      type: 'search';
      operation: 'query' | 'next' | 'previous' | 'clear' | 'reveal';
      query?: string;
      caseSensitive?: boolean;
      ordinal?: number;
    });

interface OnlyPreviewSheetWorkerResponseBase extends OnlyPreviewSheetWorkerIdentity {
  requestId: number;
}

export type OnlyPreviewSheetWorkerResponse =
  | (OnlyPreviewSheetWorkerResponseBase & { type: 'preflight-ready' })
  | (OnlyPreviewSheetWorkerResponseBase & {
      type: 'loaded';
      manifest: OnlyPreviewSheetManifest;
    })
  | (OnlyPreviewSheetWorkerResponseBase & {
      type: 'layout';
      layout: OnlyPreviewSheetLayout;
    })
  | (OnlyPreviewSheetWorkerResponseBase & {
      type: 'viewport';
      viewport: OnlyPreviewSheetViewport;
    })
  | (OnlyPreviewSheetWorkerResponseBase & {
      type: 'search';
      result: OnlyPreviewSheetSearchResult;
    })
  | (OnlyPreviewSheetWorkerResponseBase & {
      type: 'error';
      errorCode: Extract<
        OnlyPreviewErrorCode,
        | 'OOXML_ARCHIVE_LIMIT'
        | 'OOXML_ENCRYPTED'
        | 'OOXML_ARCHIVE_INVALID'
        | 'SHEET_PARSE_FAILED'
        | 'SHEET_EMPTY'
        | 'SHEET_RENDER_TIMEOUT'
      >;
    });
