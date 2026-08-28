export const ONLY_PREVIEW_OOXML_MAX_ARCHIVE_BYTES = 25 * 1024 * 1024;
export const ONLY_PREVIEW_OOXML_MAX_ENTRIES = 5_000;
export const ONLY_PREVIEW_OOXML_MAX_TOTAL_UNCOMPRESSED_BYTES = 128 * 1024 * 1024;
export const ONLY_PREVIEW_OOXML_MAX_ENTRY_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;
export const ONLY_PREVIEW_OOXML_MAX_COMPRESSION_RATIO = 200;
export const ONLY_PREVIEW_OOXML_PREFLIGHT_TIMEOUT_MS = 10_000;
export const ONLY_PREVIEW_OOXML_MAX_MERGE_TAG_BYTES = 4 * 1024;
export const ONLY_PREVIEW_OOXML_MAX_MERGE_RANGES = 100_000;
export const ONLY_PREVIEW_OOXML_MAX_MERGED_CELLS = 500_000;

export type OnlyPreviewOoxmlPackageKind = 'xlsx' | 'docx' | 'pptx';

export type OnlyPreviewOoxmlPreflightErrorCode =
  | 'OOXML_ARCHIVE_LIMIT'
  | 'OOXML_ENCRYPTED'
  | 'OOXML_ARCHIVE_INVALID'
  | 'OOXML_PREFLIGHT_TIMEOUT';

export interface OnlyPreviewOoxmlPreflightOptions {
  now?: () => number;
}

export interface OnlyPreviewOoxmlEntry {
  name: string;
  compressionMethod: 0 | 8;
  compressedSize: number;
  uncompressedSize: number;
}

export interface OnlyPreviewOoxmlPreflightResult {
  kind: OnlyPreviewOoxmlPackageKind;
  entries: readonly OnlyPreviewOoxmlEntry[];
  totalCompressedBytes: number;
  totalUncompressedBytes: number;
}

export class OnlyPreviewOoxmlPreflightError extends Error {
  readonly code: OnlyPreviewOoxmlPreflightErrorCode;

  constructor(code: OnlyPreviewOoxmlPreflightErrorCode, message: string) {
    super(message);
    this.name = 'OnlyPreviewOoxmlPreflightError';
    this.code = code;
  }
}

export interface OnlyPreviewOoxmlCentralEntry extends OnlyPreviewOoxmlEntry {
  versionNeeded: number;
  flags: number;
  modificationTime: number;
  modificationDate: number;
  crc32: number;
  localHeaderOffset: number;
  rawName: Uint8Array;
  scanWorkbookXml: boolean;
}

export interface OnlyPreviewOoxmlValidatedEntry extends OnlyPreviewOoxmlCentralEntry {
  dataOffset: number;
}

export interface OnlyPreviewWorksheetMergeScanner {
  push(chunk: Uint8Array): void;
  finish(): void;
}

export interface OnlyPreviewWorksheetMergeBudget {
  ranges: number;
  expandedCells: number;
}
