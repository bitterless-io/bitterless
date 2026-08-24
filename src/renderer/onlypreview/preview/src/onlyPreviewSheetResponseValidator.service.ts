import {
  ONLY_PREVIEW_SHEET_MAX_CELLS,
  ONLY_PREVIEW_SHEET_MAX_CELL_TEXT_CHARS,
  ONLY_PREVIEW_SHEET_MAX_COLUMNS,
  ONLY_PREVIEW_SHEET_MAX_DIMENSIONS,
  ONLY_PREVIEW_SHEET_MAX_MERGES,
  ONLY_PREVIEW_SHEET_MAX_ROWS,
  ONLY_PREVIEW_SHEET_MAX_SHEETS,
  ONLY_PREVIEW_SHEET_MAX_TOTAL_TEXT_CHARS,
  type OnlyPreviewSheetCellStyle,
  type OnlyPreviewSheetCoverage,
  type OnlyPreviewSheetLayout,
  type OnlyPreviewSheetManifest,
  type OnlyPreviewSheetManifestSheet,
  type OnlyPreviewSheetMerge,
  type OnlyPreviewSheetSearchResult,
  type OnlyPreviewSheetViewport
} from './workers/onlyPreviewSheetWorker.contract';

const SHEET_NAME_MAX_CHARS = 31;
const MIN_ROW_HEIGHT = 18;
const MAX_ROW_HEIGHT = 240;
const MIN_COLUMN_WIDTH = 32;
const MAX_COLUMN_WIDTH = 640;
export const MAX_VIEWPORT_AREA = 50_000;
export const WORKER_ERROR_CODES = new Set([
  'OOXML_ARCHIVE_LIMIT',
  'OOXML_ENCRYPTED',
  'OOXML_ARCHIVE_INVALID',
  'SHEET_PARSE_FAILED',
  'SHEET_EMPTY',
  'SHEET_RENDER_TIMEOUT'
]);
const STYLE_KEYS = ['horizontal', 'vertical', 'wrap', 'bold', 'italic', 'color', 'fill'] as const;
const RESPONSE_BASE_KEYS = [
  'hostId',
  'runtimeId',
  'selectionRevision',
  'workerGeneration',
  'requestId',
  'type'
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const hasTypedWorkerIdentity = (value: unknown): value is Record<string, unknown> =>
  isRecord(value) &&
  typeof value.hostId === 'string' &&
  value.hostId.length >= 1 &&
  value.hostId.length <= 256 &&
  typeof value.runtimeId === 'string' &&
  value.runtimeId.length >= 1 &&
  value.runtimeId.length <= 256 &&
  Number.isSafeInteger(value.selectionRevision) &&
  (value.selectionRevision as number) >= 0 &&
  Number.isSafeInteger(value.workerGeneration) &&
  (value.workerGeneration as number) >= 1;

const hasExactKeys = (
  value: Record<string, unknown>,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = []
): boolean => {
  const maximumKeys = requiredKeys.length + optionalKeys.length;
  let ownKeys = 0;
  for (const key in value) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    ownKeys += 1;
    if (ownKeys > maximumKeys || (!requiredKeys.includes(key) && !optionalKeys.includes(key))) {
      return false;
    }
  }
  return requiredKeys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
};

export const isIntegerInRange = (
  value: unknown,
  minimum: number,
  maximum: number
): value is number =>
  Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum;

const isFiniteInRange = (value: unknown, minimum: number, maximum: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;

const invalidWorkerResponse = (): never => {
  throw new Error('Workbook Worker response is invalid.');
};

export const hasExactResponseKeys = (response: Record<string, unknown>): boolean => {
  if (response.type === 'preflight-ready') return hasExactKeys(response, RESPONSE_BASE_KEYS);
  if (response.type === 'loaded') {
    return hasExactKeys(response, [...RESPONSE_BASE_KEYS, 'manifest']);
  }
  if (response.type === 'layout') {
    return hasExactKeys(response, [...RESPONSE_BASE_KEYS, 'layout']);
  }
  if (response.type === 'viewport') {
    return hasExactKeys(response, [...RESPONSE_BASE_KEYS, 'viewport']);
  }
  if (response.type === 'search') {
    return hasExactKeys(response, [...RESPONSE_BASE_KEYS, 'result']);
  }
  if (response.type === 'error') {
    return hasExactKeys(response, [...RESPONSE_BASE_KEYS, 'errorCode']);
  }
  return false;
};

const validateCoverage = (
  value: unknown,
  expected?: { acceptedSheets: number; acceptedCells: number }
): OnlyPreviewSheetCoverage => {
  if (!isRecord(value)) return invalidWorkerResponse();
  if (value.kind === 'complete') {
    if (!hasExactKeys(value, ['kind'])) return invalidWorkerResponse();
    return value as unknown as OnlyPreviewSheetCoverage;
  }
  if (
    !hasExactKeys(value, ['kind', 'reason', 'acceptedSheets', 'acceptedCells']) ||
    value.kind !== 'partial' ||
    value.reason !== 'sheet-model-cap' ||
    !isIntegerInRange(value.acceptedSheets, 1, ONLY_PREVIEW_SHEET_MAX_SHEETS) ||
    !isIntegerInRange(value.acceptedCells, 0, ONLY_PREVIEW_SHEET_MAX_CELLS)
  ) {
    return invalidWorkerResponse();
  }
  if (
    expected &&
    (value.acceptedSheets !== expected.acceptedSheets ||
      value.acceptedCells !== expected.acceptedCells)
  ) {
    return invalidWorkerResponse();
  }
  return value as unknown as OnlyPreviewSheetCoverage;
};

const coverageMatches = (
  actual: OnlyPreviewSheetCoverage,
  expected: OnlyPreviewSheetCoverage
): boolean =>
  actual.kind === expected.kind &&
  (actual.kind === 'complete' ||
    (expected.kind === 'partial' &&
      actual.reason === expected.reason &&
      actual.acceptedSheets === expected.acceptedSheets &&
      actual.acceptedCells === expected.acceptedCells));

export const validateManifest = (value: unknown): OnlyPreviewSheetManifest => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['sheets', 'acceptedCells', 'coverage']) ||
    !Array.isArray(value.sheets)
  ) {
    return invalidWorkerResponse();
  }
  if (value.sheets.length < 1 || value.sheets.length > ONLY_PREVIEW_SHEET_MAX_SHEETS) {
    return invalidWorkerResponse();
  }
  if (!isIntegerInRange(value.acceptedCells, 0, ONLY_PREVIEW_SHEET_MAX_CELLS)) {
    return invalidWorkerResponse();
  }
  const sheets: OnlyPreviewSheetManifestSheet[] = [];
  for (const [index, candidate] of value.sheets.entries()) {
    if (
      !isRecord(candidate) ||
      !hasExactKeys(candidate, ['id', 'name', 'rowCount', 'columnCount']) ||
      candidate.id !== index ||
      typeof candidate.name !== 'string' ||
      candidate.name.length < 1 ||
      candidate.name.length > SHEET_NAME_MAX_CHARS ||
      !isIntegerInRange(candidate.rowCount, 1, ONLY_PREVIEW_SHEET_MAX_ROWS) ||
      !isIntegerInRange(candidate.columnCount, 1, ONLY_PREVIEW_SHEET_MAX_COLUMNS)
    ) {
      return invalidWorkerResponse();
    }
    sheets.push(candidate as unknown as OnlyPreviewSheetManifestSheet);
  }
  const coverage = validateCoverage(value.coverage, {
    acceptedSheets: sheets.length,
    acceptedCells: value.acceptedCells
  });
  return { sheets, acceptedCells: value.acceptedCells, coverage };
};

const validateDimensions = (
  value: unknown,
  maximumIndex: number,
  minimumSize: number,
  maximumSize: number
): void => {
  if (
    !Array.isArray(value) ||
    value.length > Math.min(maximumIndex, ONLY_PREVIEW_SHEET_MAX_DIMENSIONS)
  ) {
    return invalidWorkerResponse();
  }
  const indexes = new Set<number>();
  for (const candidate of value) {
    if (
      !isRecord(candidate) ||
      !hasExactKeys(candidate, ['index', 'size']) ||
      !isIntegerInRange(candidate.index, 1, maximumIndex) ||
      !isFiniteInRange(candidate.size, minimumSize, maximumSize) ||
      indexes.has(candidate.index)
    ) {
      return invalidWorkerResponse();
    }
    indexes.add(candidate.index);
  }
};

export const validateLayout = (
  value: unknown,
  sheet: OnlyPreviewSheetManifestSheet
): OnlyPreviewSheetLayout => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'sheetId',
      'rowCount',
      'columnCount',
      'defaultRowHeight',
      'defaultColumnWidth',
      'rowHeights',
      'columnWidths'
    ]) ||
    value.sheetId !== sheet.id ||
    value.rowCount !== sheet.rowCount ||
    value.columnCount !== sheet.columnCount ||
    !isFiniteInRange(value.defaultRowHeight, MIN_ROW_HEIGHT, MAX_ROW_HEIGHT) ||
    !isFiniteInRange(value.defaultColumnWidth, MIN_COLUMN_WIDTH, MAX_COLUMN_WIDTH)
  ) {
    return invalidWorkerResponse();
  }
  validateDimensions(value.rowHeights, sheet.rowCount, MIN_ROW_HEIGHT, MAX_ROW_HEIGHT);
  validateDimensions(value.columnWidths, sheet.columnCount, MIN_COLUMN_WIDTH, MAX_COLUMN_WIDTH);
  if (
    (value.rowHeights as unknown[]).length + (value.columnWidths as unknown[]).length >
    ONLY_PREVIEW_SHEET_MAX_DIMENSIONS
  ) {
    return invalidWorkerResponse();
  }
  return value as unknown as OnlyPreviewSheetLayout;
};

const isSheetColor = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.length > 32) return false;
  if (/^#[0-9a-f]{6}$/i.test(value)) return true;
  const rgba = /^rgba\((\d{1,3}), (\d{1,3}), (\d{1,3}), (0|1|0\.\d{3})\)$/.exec(value);
  return Boolean(rgba && rgba.slice(1, 4).every((part) => Number(part) <= 255));
};

const validateCellStyle = (value: unknown): value is OnlyPreviewSheetCellStyle => {
  if (!isRecord(value) || !hasExactKeys(value, [], STYLE_KEYS)) return false;
  if (
    value.horizontal !== undefined &&
    value.horizontal !== 'left' &&
    value.horizontal !== 'center' &&
    value.horizontal !== 'right'
  ) {
    return false;
  }
  if (
    value.vertical !== undefined &&
    value.vertical !== 'top' &&
    value.vertical !== 'middle' &&
    value.vertical !== 'bottom'
  ) {
    return false;
  }
  if (value.wrap !== undefined && typeof value.wrap !== 'boolean') return false;
  if (value.bold !== undefined && typeof value.bold !== 'boolean') return false;
  if (value.italic !== undefined && typeof value.italic !== 'boolean') return false;
  if (value.color !== undefined && !isSheetColor(value.color)) return false;
  if (value.fill !== undefined && !isSheetColor(value.fill)) return false;
  return true;
};

export interface SheetViewportBounds {
  sheet: OnlyPreviewSheetManifestSheet;
  rowStart: number;
  rowEnd: number;
  columnStart: number;
  columnEnd: number;
}

const mergeIntersectsBounds = (
  merge: OnlyPreviewSheetMerge,
  bounds: SheetViewportBounds
): boolean =>
  merge.bottom >= bounds.rowStart &&
  merge.top <= bounds.rowEnd &&
  merge.right >= bounds.columnStart &&
  merge.left <= bounds.columnEnd;

export const validateViewport = (
  value: unknown,
  bounds: SheetViewportBounds,
  manifest: OnlyPreviewSheetManifest
): OnlyPreviewSheetViewport => {
  const rowSpan = bounds.rowEnd - bounds.rowStart + 1;
  const columnSpan = bounds.columnEnd - bounds.columnStart + 1;
  const viewportArea = rowSpan * columnSpan;
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'sheetId',
      'rowStart',
      'rowEnd',
      'columnStart',
      'columnEnd',
      'cells',
      'merges'
    ]) ||
    value.sheetId !== bounds.sheet.id ||
    value.rowStart !== bounds.rowStart ||
    value.rowEnd !== bounds.rowEnd ||
    value.columnStart !== bounds.columnStart ||
    value.columnEnd !== bounds.columnEnd ||
    !Array.isArray(value.cells) ||
    !Array.isArray(value.merges) ||
    value.merges.length > Math.min(ONLY_PREVIEW_SHEET_MAX_MERGES, viewportArea) ||
    value.cells.length >
      Math.min(
        manifest.acceptedCells,
        ONLY_PREVIEW_SHEET_MAX_CELLS,
        viewportArea + value.merges.length
      )
  ) {
    return invalidWorkerResponse();
  }
  const mergeKeys = new Set<string>();
  const mergeMasters = new Set<string>();
  const occupiedViewportCoordinates = new Set<number>();
  let mergeIntersectionArea = 0;
  for (const candidate of value.merges) {
    if (
      !isRecord(candidate) ||
      !hasExactKeys(candidate, ['top', 'left', 'bottom', 'right']) ||
      !isIntegerInRange(candidate.top, 1, bounds.sheet.rowCount) ||
      !isIntegerInRange(candidate.left, 1, bounds.sheet.columnCount) ||
      !isIntegerInRange(candidate.bottom, candidate.top, bounds.sheet.rowCount) ||
      !isIntegerInRange(candidate.right, candidate.left, bounds.sheet.columnCount)
    ) {
      return invalidWorkerResponse();
    }
    const merge = candidate as unknown as OnlyPreviewSheetMerge;
    const key = `${merge.top}:${merge.left}:${merge.bottom}:${merge.right}`;
    const masterKey = `${merge.top}:${merge.left}`;
    if (
      (merge.top === merge.bottom && merge.left === merge.right) ||
      mergeKeys.has(key) ||
      mergeMasters.has(masterKey) ||
      !mergeIntersectsBounds(merge, bounds)
    ) {
      return invalidWorkerResponse();
    }
    mergeKeys.add(key);
    mergeMasters.add(masterKey);

    const intersectionTop = Math.max(merge.top, bounds.rowStart);
    const intersectionBottom = Math.min(merge.bottom, bounds.rowEnd);
    const intersectionLeft = Math.max(merge.left, bounds.columnStart);
    const intersectionRight = Math.min(merge.right, bounds.columnEnd);
    const intersectionArea =
      (intersectionBottom - intersectionTop + 1) * (intersectionRight - intersectionLeft + 1);
    mergeIntersectionArea += intersectionArea;
    if (mergeIntersectionArea > viewportArea) return invalidWorkerResponse();

    for (let row = intersectionTop; row <= intersectionBottom; row += 1) {
      const rowOffset = (row - bounds.rowStart) * columnSpan;
      for (let column = intersectionLeft; column <= intersectionRight; column += 1) {
        const coordinate = rowOffset + column - bounds.columnStart;
        if (occupiedViewportCoordinates.has(coordinate)) return invalidWorkerResponse();
        occupiedViewportCoordinates.add(coordinate);
      }
    }
  }
  const cellKeys = new Set<string>();
  let textChars = 0;
  for (const candidate of value.cells) {
    if (
      !isRecord(candidate) ||
      !hasExactKeys(candidate, ['row', 'column', 'text'], ['style']) ||
      !isIntegerInRange(candidate.row, 1, bounds.sheet.rowCount) ||
      !isIntegerInRange(candidate.column, 1, bounds.sheet.columnCount) ||
      typeof candidate.text !== 'string' ||
      candidate.text.length > ONLY_PREVIEW_SHEET_MAX_CELL_TEXT_CHARS ||
      (candidate.style !== undefined && !validateCellStyle(candidate.style))
    ) {
      return invalidWorkerResponse();
    }
    const key = `${candidate.row}:${candidate.column}`;
    const insideViewport =
      candidate.row >= bounds.rowStart &&
      candidate.row <= bounds.rowEnd &&
      candidate.column >= bounds.columnStart &&
      candidate.column <= bounds.columnEnd;
    if (cellKeys.has(key) || (!insideViewport && !mergeMasters.has(key))) {
      return invalidWorkerResponse();
    }
    cellKeys.add(key);
    textChars += candidate.text.length;
    if (textChars > ONLY_PREVIEW_SHEET_MAX_TOTAL_TEXT_CHARS) {
      return invalidWorkerResponse();
    }
  }
  return value as unknown as OnlyPreviewSheetViewport;
};

export const validateSearchResult = (
  value: unknown,
  manifest: OnlyPreviewSheetManifest
): OnlyPreviewSheetSearchResult => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['total', 'active', 'coverage', 'target']) ||
    !isIntegerInRange(value.total, 0, manifest.acceptedCells) ||
    !isIntegerInRange(value.active, 0, value.total)
  ) {
    return invalidWorkerResponse();
  }
  const coverage = validateCoverage(value.coverage);
  if (!coverageMatches(coverage, manifest.coverage)) return invalidWorkerResponse();
  if (value.total === 0) {
    if (value.active !== 0 || value.target !== null) return invalidWorkerResponse();
  } else {
    if (value.active < 1 || !isRecord(value.target)) return invalidWorkerResponse();
    const target = value.target;
    if (!hasExactKeys(target, ['sheetId', 'row', 'column'])) return invalidWorkerResponse();
    const targetSheet = manifest.sheets.find((sheet) => sheet.id === target.sheetId);
    if (
      !targetSheet ||
      !isIntegerInRange(target.row, 1, targetSheet.rowCount) ||
      !isIntegerInRange(target.column, 1, targetSheet.columnCount)
    ) {
      return invalidWorkerResponse();
    }
  }
  return value as unknown as OnlyPreviewSheetSearchResult;
};
