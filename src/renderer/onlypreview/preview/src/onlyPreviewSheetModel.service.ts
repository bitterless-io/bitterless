import {
  ONLY_PREVIEW_SHEET_MAX_CELLS,
  ONLY_PREVIEW_SHEET_MAX_CELL_TEXT_CHARS,
  ONLY_PREVIEW_SHEET_MAX_COLUMNS,
  ONLY_PREVIEW_SHEET_MAX_DIMENSIONS,
  ONLY_PREVIEW_SHEET_MAX_MERGES,
  ONLY_PREVIEW_SHEET_MAX_ROWS,
  ONLY_PREVIEW_SHEET_MAX_SHEETS,
  ONLY_PREVIEW_SHEET_MAX_TOTAL_TEXT_CHARS,
  type OnlyPreviewSheetCell,
  type OnlyPreviewSheetCoverage,
  type OnlyPreviewSheetDimension,
  type OnlyPreviewSheetLayout,
  type OnlyPreviewSheetManifest,
  type OnlyPreviewSheetMerge,
  type OnlyPreviewSheetSearchResult,
  type OnlyPreviewSheetViewport
} from './workers/onlyPreviewSheetWorker.contract';
import {
  extractOnlyPreviewSheetStyle,
  formatOnlyPreviewSheetValue
} from './onlyPreviewSheetFormat.service';

interface SheetCellLike extends Record<string, unknown> {
  row?: unknown;
  col?: unknown;
  value?: unknown;
  numFmt?: unknown;
}

interface SheetRowLike extends Record<string, unknown> {
  number?: unknown;
  height?: unknown;
  _cells?: unknown;
}

interface SheetLike extends Record<string, unknown> {
  name?: unknown;
  rowCount?: unknown;
  actualRowCount?: unknown;
  columnCount?: unknown;
  _rows?: unknown;
  _merges?: unknown;
  columns?: unknown;
}

interface SheetMergeLike extends Record<string, unknown> {
  range?: unknown;
}

interface WorkbookLike extends Record<string, unknown> {
  worksheets?: unknown;
  properties?: unknown;
}

interface ModelSheet {
  id: number;
  name: string;
  rowCount: number;
  columnCount: number;
  defaultRowHeight: number;
  defaultColumnWidth: number;
  rowHeights: OnlyPreviewSheetDimension[];
  columnWidths: OnlyPreviewSheetDimension[];
  merges: OnlyPreviewSheetMerge[];
  cells: OnlyPreviewSheetCell[];
  cellsByRow: Map<number, OnlyPreviewSheetCell[]>;
  cellByCoordinate: Map<string, OnlyPreviewSheetCell>;
  mergeIndex: MergeIntervalNode | null;
}

interface MergeIntervalNode {
  center: number;
  crossing: OnlyPreviewSheetMerge[];
  left: MergeIntervalNode | null;
  right: MergeIntervalNode | null;
}

const DEFAULT_ROW_HEIGHT = 24;
const DEFAULT_COLUMN_WIDTH = 88;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const finiteInteger = (value: unknown): number | null =>
  Number.isSafeInteger(value) && (value as number) > 0 ? (value as number) : null;

const finiteNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;

const sparseValues = function* <T>(value: unknown): Generator<T> {
  if (!value || typeof value !== 'object') return;
  for (const key in value) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    const item = (value as Record<string, T>)[key];
    if (item) yield item;
  }
};

const columnLettersToNumber = (letters: string): number => {
  let result = 0;
  for (const character of letters.toUpperCase()) {
    result = result * 26 + character.charCodeAt(0) - 64;
  }
  return result;
};

const parseCellReference = (value: string): { row: number; column: number } | null => {
  const match = /^\$?([A-Z]{1,4})\$?(\d{1,9})$/i.exec(value);
  if (!match) return null;
  const row = Number(match[2]);
  const column = columnLettersToNumber(match[1]);
  return row > 0 && column > 0 ? { row, column } : null;
};

export const parseOnlyPreviewSheetMerge = (value: unknown): OnlyPreviewSheetMerge | null => {
  if (typeof value !== 'string') return null;
  const [start, end, extra] = value.split(':');
  if (!start || !end || extra) return null;
  const first = parseCellReference(start);
  const last = parseCellReference(end);
  if (!first || !last || first.row > last.row || first.column > last.column) return null;
  if (first.row === last.row && first.column === last.column) return null;
  return {
    top: first.row,
    left: first.column,
    bottom: last.row,
    right: last.column
  };
};

const valueIsPresent = (value: unknown): boolean => value !== null && value !== undefined;

const convertRowHeight = (height: number): number =>
  Math.min(240, Math.max(18, height * (96 / 72)));
const convertColumnWidth = (width: number): number => Math.min(640, Math.max(32, width * 7 + 5));
const coordinateKey = (row: number, column: number): string => `${row}:${column}`;

const intersects = (
  merge: OnlyPreviewSheetMerge,
  rowStart: number,
  rowEnd: number,
  columnStart: number,
  columnEnd: number
): boolean =>
  merge.bottom >= rowStart &&
  merge.top <= rowEnd &&
  merge.right >= columnStart &&
  merge.left <= columnEnd;

const buildMergeIntervalIndex = (merges: OnlyPreviewSheetMerge[]): MergeIntervalNode | null => {
  if (!merges.length) return null;
  const centers = merges
    .map((merge) => Math.floor((merge.top + merge.bottom) / 2))
    .sort((a, b) => a - b);
  const center = centers[Math.floor(centers.length / 2)];
  const left: OnlyPreviewSheetMerge[] = [];
  const right: OnlyPreviewSheetMerge[] = [];
  const crossing: OnlyPreviewSheetMerge[] = [];
  for (const merge of merges) {
    if (merge.bottom < center) left.push(merge);
    else if (merge.top > center) right.push(merge);
    else crossing.push(merge);
  }
  return {
    center,
    crossing,
    left: buildMergeIntervalIndex(left),
    right: buildMergeIntervalIndex(right)
  };
};

const queryMergeIntervalIndex = (
  node: MergeIntervalNode | null,
  rowStart: number,
  rowEnd: number,
  output: OnlyPreviewSheetMerge[]
): void => {
  if (!node) return;
  for (const merge of node.crossing) {
    if (merge.bottom >= rowStart && merge.top <= rowEnd) output.push(merge);
  }
  if (rowStart <= node.center) queryMergeIntervalIndex(node.left, rowStart, rowEnd, output);
  if (rowEnd >= node.center) queryMergeIntervalIndex(node.right, rowStart, rowEnd, output);
};

export class OnlyPreviewSheetModel {
  private searchMatches: OnlyPreviewSheetCell[] = [];
  private searchOrdinal = -1;
  private query = '';
  private caseSensitive = false;

  constructor(
    private readonly sheets: ModelSheet[],
    readonly manifest: OnlyPreviewSheetManifest
  ) {}

  getLayout(sheetId: number): OnlyPreviewSheetLayout {
    const sheet = this.requireSheet(sheetId);
    return {
      sheetId,
      rowCount: sheet.rowCount,
      columnCount: sheet.columnCount,
      defaultRowHeight: sheet.defaultRowHeight,
      defaultColumnWidth: sheet.defaultColumnWidth,
      rowHeights: sheet.rowHeights.map((entry) => ({ ...entry })),
      columnWidths: sheet.columnWidths.map((entry) => ({ ...entry }))
    };
  }

  getViewport(
    sheetId: number,
    rowStart: number,
    rowEnd: number,
    columnStart: number,
    columnEnd: number
  ): OnlyPreviewSheetViewport {
    const sheet = this.requireSheet(sheetId);
    const firstRow = Math.max(1, Math.min(sheet.rowCount, Math.floor(rowStart)));
    const lastRow = Math.max(firstRow, Math.min(sheet.rowCount, Math.floor(rowEnd)));
    const firstColumn = Math.max(1, Math.min(sheet.columnCount, Math.floor(columnStart)));
    const lastColumn = Math.max(firstColumn, Math.min(sheet.columnCount, Math.floor(columnEnd)));
    const cellMap = new Map<string, OnlyPreviewSheetCell>();
    for (let row = firstRow; row <= lastRow; row += 1) {
      for (const cell of sheet.cellsByRow.get(row) ?? []) {
        if (cell.column >= firstColumn && cell.column <= lastColumn) {
          cellMap.set(coordinateKey(cell.row, cell.column), cell);
        }
      }
    }
    const rowMerges: OnlyPreviewSheetMerge[] = [];
    queryMergeIntervalIndex(sheet.mergeIndex, firstRow, lastRow, rowMerges);
    const merges = rowMerges.filter((merge) =>
      intersects(merge, firstRow, lastRow, firstColumn, lastColumn)
    );
    for (const merge of merges) {
      const master = sheet.cellByCoordinate.get(coordinateKey(merge.top, merge.left));
      if (master) cellMap.set(coordinateKey(master.row, master.column), master);
    }
    return {
      sheetId,
      rowStart: firstRow,
      rowEnd: lastRow,
      columnStart: firstColumn,
      columnEnd: lastColumn,
      cells: [...cellMap.values()].map((cell) => ({
        ...cell,
        style: cell.style && { ...cell.style }
      })),
      merges: merges.map((entry) => ({ ...entry }))
    };
  }

  search(
    operation: 'query' | 'next' | 'previous' | 'clear' | 'reveal',
    options: { query?: string; caseSensitive?: boolean; ordinal?: number } = {}
  ): OnlyPreviewSheetSearchResult {
    if (operation === 'clear') {
      this.query = '';
      this.searchMatches = [];
      this.searchOrdinal = -1;
      return this.searchResult();
    }
    if (operation === 'query') {
      this.query = options.query ?? '';
      this.caseSensitive = options.caseSensitive === true;
      const needle = this.caseSensitive ? this.query : this.query.toLowerCase();
      this.searchMatches = needle
        ? this.sheets.flatMap((sheet) =>
            sheet.cells.filter((cell) => {
              const haystack = this.caseSensitive ? cell.text : cell.text.toLowerCase();
              return haystack.includes(needle);
            })
          )
        : [];
      this.searchOrdinal = this.searchMatches.length ? 0 : -1;
      return this.searchResult();
    }
    if (!this.searchMatches.length) return this.searchResult();
    if (operation === 'next') {
      this.searchOrdinal = (this.searchOrdinal + 1) % this.searchMatches.length;
    } else if (operation === 'previous') {
      this.searchOrdinal =
        (this.searchOrdinal - 1 + this.searchMatches.length) % this.searchMatches.length;
    } else if (operation === 'reveal') {
      const ordinal = options.ordinal ?? 1;
      if (!Number.isSafeInteger(ordinal) || ordinal < 1 || ordinal > this.searchMatches.length) {
        throw new Error('Sheet search ordinal is invalid.');
      }
      this.searchOrdinal = ordinal - 1;
    }
    return this.searchResult();
  }

  private searchResult(): OnlyPreviewSheetSearchResult {
    const cell = this.searchOrdinal >= 0 ? this.searchMatches[this.searchOrdinal] : null;
    const sheetId = cell
      ? this.sheets.find(
          (sheet) => sheet.cellByCoordinate.get(coordinateKey(cell.row, cell.column)) === cell
        )?.id
      : undefined;
    return {
      total: this.searchMatches.length,
      active: this.searchOrdinal >= 0 ? this.searchOrdinal + 1 : 0,
      coverage: this.manifest.coverage,
      target: cell && sheetId !== undefined ? { sheetId, row: cell.row, column: cell.column } : null
    };
  }

  private requireSheet(sheetId: number): ModelSheet {
    const sheet = this.sheets.find((entry) => entry.id === sheetId);
    if (!sheet) throw new Error('Sheet does not belong to the current workbook.');
    return sheet;
  }
}

export const buildOnlyPreviewSheetModel = (workbook: WorkbookLike): OnlyPreviewSheetModel => {
  const workbookSheets = Array.isArray(workbook.worksheets)
    ? (workbook.worksheets as SheetLike[])
    : [];
  if (!workbookSheets.length) throw new Error('SHEET_EMPTY');
  const properties = isRecord(workbook.properties) ? workbook.properties : {};
  const date1904 = properties.date1904 === true;
  let partial = workbookSheets.length > ONLY_PREVIEW_SHEET_MAX_SHEETS;
  let acceptedCells = 0;
  let inspectedMerges = 0;
  let acceptedDimensions = 0;
  let acceptedTextChars = 0;
  let sawNonEmptyCell = false;
  let stoppedByModelCap = false;
  const sheets: ModelSheet[] = [];

  for (const [sheetIndex, worksheet] of workbookSheets
    .slice(0, ONLY_PREVIEW_SHEET_MAX_SHEETS)
    .entries()) {
    const cells: OnlyPreviewSheetCell[] = [];
    const cellByCoordinate = new Map<string, OnlyPreviewSheetCell>();
    let maxAcceptedRow = 1;
    let maxAcceptedColumn = 1;
    const rowHeights: OnlyPreviewSheetDimension[] = [];

    for (const row of sparseValues<SheetRowLike>(worksheet._rows)) {
      const rowNumber = finiteInteger(row.number);
      if (!rowNumber) continue;
      if (rowNumber > ONLY_PREVIEW_SHEET_MAX_ROWS) {
        partial = true;
        break;
      }
      const height = finiteNumber(row.height);
      if (height) {
        if (acceptedDimensions >= ONLY_PREVIEW_SHEET_MAX_DIMENSIONS) partial = true;
        else if (rowNumber <= ONLY_PREVIEW_SHEET_MAX_ROWS) {
          rowHeights.push({ index: rowNumber, size: convertRowHeight(height) });
          acceptedDimensions += 1;
        } else partial = true;
      }
      for (const cell of sparseValues<SheetCellLike>(row._cells)) {
        if (!valueIsPresent(cell.value)) continue;
        const cellRow = finiteInteger(cell.row) ?? rowNumber;
        const column = finiteInteger(cell.col);
        if (!column) continue;
        if (cell.isMerged === true && isRecord(cell.master)) {
          const masterRow = finiteInteger(cell.master.row);
          const masterColumn = finiteInteger(cell.master.col);
          if (masterRow !== cellRow || masterColumn !== column) continue;
        }
        sawNonEmptyCell = true;
        if (cellRow > ONLY_PREVIEW_SHEET_MAX_ROWS) {
          partial = true;
          continue;
        }
        if (column > ONLY_PREVIEW_SHEET_MAX_COLUMNS) {
          partial = true;
          break;
        }
        if (acceptedCells >= ONLY_PREVIEW_SHEET_MAX_CELLS) {
          partial = true;
          stoppedByModelCap = true;
          break;
        }
        const numFmt = typeof cell.numFmt === 'string' ? cell.numFmt : 'General';
        const text = formatOnlyPreviewSheetValue(cell.value, numFmt, date1904);
        if (text.length > ONLY_PREVIEW_SHEET_MAX_CELL_TEXT_CHARS) {
          partial = true;
          continue;
        }
        if (acceptedTextChars + text.length > ONLY_PREVIEW_SHEET_MAX_TOTAL_TEXT_CHARS) {
          partial = true;
          stoppedByModelCap = true;
          break;
        }
        const accepted: OnlyPreviewSheetCell = {
          row: cellRow,
          column,
          text,
          style: extractOnlyPreviewSheetStyle(cell)
        };
        cells.push(accepted);
        cellByCoordinate.set(coordinateKey(cellRow, column), accepted);
        acceptedCells += 1;
        acceptedTextChars += text.length;
        maxAcceptedRow = Math.max(maxAcceptedRow, cellRow);
        maxAcceptedColumn = Math.max(maxAcceptedColumn, column);
      }
      if (stoppedByModelCap) break;
    }

    const columns = Array.isArray(worksheet.columns)
      ? (worksheet.columns as Array<Record<string, unknown>>)
      : [];
    const columnWidths: OnlyPreviewSheetDimension[] = [];
    for (const [columnOffset, column] of columns.entries()) {
      if (columnOffset >= ONLY_PREVIEW_SHEET_MAX_COLUMNS) {
        partial = true;
        break;
      }
      const width = finiteNumber(column.width);
      if (!width) continue;
      const index = columnOffset + 1;
      if (index > ONLY_PREVIEW_SHEET_MAX_COLUMNS) {
        partial = true;
        continue;
      }
      if (acceptedDimensions >= ONLY_PREVIEW_SHEET_MAX_DIMENSIONS) partial = true;
      else {
        columnWidths.push({ index, size: convertColumnWidth(width) });
        acceptedDimensions += 1;
      }
    }

    const sheetProperties = isRecord(worksheet.properties) ? worksheet.properties : {};
    const defaultRowHeight = finiteNumber(sheetProperties.defaultRowHeight);
    const defaultColumnWidth = finiteNumber(sheetProperties.defaultColWidth);
    const merges: OnlyPreviewSheetMerge[] = [];
    for (const rawMerge of sparseValues<SheetMergeLike>(worksheet._merges)) {
      if (inspectedMerges >= ONLY_PREVIEW_SHEET_MAX_MERGES) {
        partial = true;
        break;
      }
      inspectedMerges += 1;
      const merge = parseOnlyPreviewSheetMerge(rawMerge.range);
      if (!merge) continue;
      if (merge.top > ONLY_PREVIEW_SHEET_MAX_ROWS || merge.left > ONLY_PREVIEW_SHEET_MAX_COLUMNS) {
        partial = true;
        continue;
      }
      if (
        merge.bottom > ONLY_PREVIEW_SHEET_MAX_ROWS ||
        merge.right > ONLY_PREVIEW_SHEET_MAX_COLUMNS
      ) {
        partial = true;
        continue;
      }
      merges.push(merge);
      maxAcceptedRow = Math.max(maxAcceptedRow, merge.bottom);
      maxAcceptedColumn = Math.max(maxAcceptedColumn, merge.right);
    }

    const declaredRows = finiteInteger(worksheet.rowCount) ?? maxAcceptedRow;
    const declaredColumns = finiteInteger(worksheet.columnCount) ?? maxAcceptedColumn;
    if (
      declaredRows > ONLY_PREVIEW_SHEET_MAX_ROWS ||
      declaredColumns > ONLY_PREVIEW_SHEET_MAX_COLUMNS
    ) {
      partial = true;
    }
    const cellsByRow = new Map<number, OnlyPreviewSheetCell[]>();
    for (const cell of cells) {
      const rowCells = cellsByRow.get(cell.row) ?? [];
      rowCells.push(cell);
      cellsByRow.set(cell.row, rowCells);
    }
    sheets.push({
      id: sheetIndex,
      name:
        typeof worksheet.name === 'string' && worksheet.name
          ? worksheet.name
          : `Sheet ${sheetIndex + 1}`,
      rowCount: Math.max(
        1,
        Math.min(ONLY_PREVIEW_SHEET_MAX_ROWS, Math.max(declaredRows, maxAcceptedRow))
      ),
      columnCount: Math.max(
        1,
        Math.min(ONLY_PREVIEW_SHEET_MAX_COLUMNS, Math.max(declaredColumns, maxAcceptedColumn))
      ),
      defaultRowHeight: defaultRowHeight ? convertRowHeight(defaultRowHeight) : DEFAULT_ROW_HEIGHT,
      defaultColumnWidth: defaultColumnWidth
        ? convertColumnWidth(defaultColumnWidth)
        : DEFAULT_COLUMN_WIDTH,
      rowHeights,
      columnWidths,
      merges,
      cells,
      cellsByRow,
      cellByCoordinate,
      mergeIndex: buildMergeIntervalIndex(merges)
    });
    if (stoppedByModelCap) break;
  }

  const workbookHasContent =
    sawNonEmptyCell ||
    workbookSheets.some((worksheet) => (finiteInteger(worksheet.actualRowCount) ?? 0) > 0);
  if (!workbookHasContent) throw new Error('SHEET_EMPTY');
  const coverage: OnlyPreviewSheetCoverage = partial
    ? {
        kind: 'partial',
        reason: 'sheet-model-cap',
        acceptedSheets: sheets.length,
        acceptedCells
      }
    : { kind: 'complete' };
  const manifest: OnlyPreviewSheetManifest = {
    sheets: sheets.map(({ id, name, rowCount, columnCount }) => ({
      id,
      name,
      rowCount,
      columnCount
    })),
    acceptedCells,
    coverage
  };
  return new OnlyPreviewSheetModel(sheets, manifest);
};
