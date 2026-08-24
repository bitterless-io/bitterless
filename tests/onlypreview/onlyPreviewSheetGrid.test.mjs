import assert from 'node:assert/strict';
import { test } from 'node:test';
import ExcelJS from 'exceljs';
import {
  makeWorkbookLike,
  sheetContract,
  sheetFormat,
  sheetModel,
  sheetViewport
} from './onlyPreviewSheetGridTest.helper.mjs';

test('formats dates in token order with minute-aware m tokens and stable numeric formats', () => {
  const value = new Date(Date.UTC(2024, 0, 2, 13, 5, 6));
  assert.equal(
    sheetFormat.formatOnlyPreviewSheetValue(value, 'dd/mm/yyyy hh:mm:ss'),
    '02/01/2024 13:05:06'
  );
  assert.equal(
    sheetFormat.formatOnlyPreviewSheetValue(value, 'm/d/yy h:mm AM/PM'),
    '1/2/24 1:05 PM'
  );
  assert.equal(sheetFormat.formatOnlyPreviewSheetValue(1_234.5, '#,##0.00'), '1,234.50');
  assert.equal(sheetFormat.formatOnlyPreviewSheetValue(0.125, '0.0%'), '12.5%');
  assert.equal(sheetFormat.formatOnlyPreviewSheetValue(-42, '$#,##0.00'), '-$42.00');
});

test('renders only cached formula results and never exposes formula source text', () => {
  assert.equal(
    sheetFormat.formatOnlyPreviewSheetValue(
      { formula: 'SUPER_SECRET_SOURCE()', result: 42 },
      '0.00'
    ),
    '42.00'
  );
  assert.equal(
    sheetFormat.formatOnlyPreviewSheetValue(
      { sharedFormula: 'A1', result: { error: '#DIV/0!' } },
      'General'
    ),
    '#DIV/0!'
  );
  assert.equal(
    sheetFormat.formatOnlyPreviewSheetValue(
      { formula: 'SUPER_SECRET_SOURCE()', result: null },
      'General'
    ),
    ''
  );
});

test('models a real ExcelJS workbook with sheets, merge masters, dimensions, styles, and full-model search', async () => {
  const source = new ExcelJS.Workbook();
  const first = source.addWorksheet('Summary', {
    properties: { defaultRowHeight: 18, defaultColWidth: 11 }
  });
  first.getRow(1).height = 30;
  first.getColumn(1).width = 20;
  first.mergeCells('A1:B2');
  const mergedMaster = first.getCell('A1');
  mergedMaster.value = 'Merged Needle';
  mergedMaster.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  mergedMaster.font = { bold: true, italic: true, color: { argb: 'FF123456' } };
  mergedMaster.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFCC00' } };
  const formula = first.getCell('C3');
  formula.value = { formula: 'SUPER_SECRET_SOURCE()', result: 2 };
  formula.numFmt = '0.00';
  const date = first.getCell('D4');
  date.value = new Date(Date.UTC(2024, 0, 2, 13, 5, 6));
  date.numFmt = 'dd/mm/yyyy hh:mm:ss';
  const percent = first.getCell('E5');
  percent.value = 0.125;
  percent.numFmt = '0.0%';
  const currency = first.getCell('F6');
  currency.value = -42;
  currency.numFmt = '$#,##0.00';

  const second = source.addWorksheet('Offscreen');
  second.getCell(1_000, 200).value = 'Far Needle';

  const bytes = await source.xlsx.writeBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  const model = sheetModel.buildOnlyPreviewSheetModel(workbook);

  assert.deepEqual(
    model.manifest.sheets.map(({ id, name }) => ({ id, name })),
    [
      { id: 0, name: 'Summary' },
      { id: 1, name: 'Offscreen' }
    ]
  );
  assert.deepEqual(model.manifest.coverage, { kind: 'complete' });

  const layout = model.getLayout(0);
  assert.equal(layout.rowCount, 6);
  assert.equal(layout.columnCount, 6);
  assert.equal(layout.defaultRowHeight, 24);
  assert.equal(layout.defaultColumnWidth, 82);
  assert.equal(layout.rowHeights.find(({ index }) => index === 1)?.size, 40);
  assert.equal(layout.columnWidths.find(({ index }) => index === 1)?.size, 145);

  const firstCellViewport = model.getViewport(0, 2, 2, 2, 2);
  assert.deepEqual(firstCellViewport.merges, [{ top: 1, left: 1, bottom: 2, right: 2 }]);
  assert.equal(firstCellViewport.cells.length, 1, 'a merged child must not duplicate the master');
  assert.deepEqual(firstCellViewport.cells[0], {
    row: 1,
    column: 1,
    text: 'Merged Needle',
    style: {
      horizontal: 'center',
      vertical: 'middle',
      wrap: true,
      bold: true,
      italic: true,
      color: '#123456',
      fill: '#ffcc00'
    }
  });

  const formulaViewport = model.getViewport(0, 3, 3, 3, 3);
  assert.equal(formulaViewport.cells[0]?.text, '2.00');
  assert.equal(
    model.search('query', { query: 'SUPER_SECRET_SOURCE', caseSensitive: false }).total,
    0
  );
  assert.deepEqual(model.search('query', { query: '2.00', caseSensitive: true }).target, {
    sheetId: 0,
    row: 3,
    column: 3
  });
  assert.equal(model.getViewport(0, 4, 4, 4, 4).cells[0]?.text, '02/01/2024 13:05:06');
  assert.equal(model.getViewport(0, 5, 5, 5, 5).cells[0]?.text, '12.5%');
  assert.equal(model.getViewport(0, 6, 6, 6, 6).cells[0]?.text, '-$42.00');

  const insensitive = model.search('query', { query: 'needle', caseSensitive: false });
  assert.equal(insensitive.total, 2);
  assert.deepEqual(insensitive.target, { sheetId: 0, row: 1, column: 1 });
  assert.deepEqual(model.search('next').target, { sheetId: 1, row: 1_000, column: 200 });
  assert.deepEqual(model.search('previous').target, { sheetId: 0, row: 1, column: 1 });
  assert.equal(model.search('query', { query: 'needle', caseSensitive: true }).total, 0);
  assert.equal(model.search('query', { query: 'Needle', caseSensitive: true }).total, 2);
  assert.deepEqual(model.search('reveal', { ordinal: 2 }).target, {
    sheetId: 1,
    row: 1_000,
    column: 200
  });
  assert.deepEqual(model.search('clear'), {
    total: 0,
    active: 0,
    coverage: { kind: 'complete' },
    target: null
  });
});

test('virtual axis math keeps a deep 100,000-row viewport bounded', () => {
  const axis = sheetViewport.createOnlyPreviewSheetAxis(100_000, 24, [{ index: 50_001, size: 48 }]);
  assert.equal(axis.offsets[100_000], 2_400_024);
  assert.equal(sheetViewport.getOnlyPreviewSheetAxisOffset(axis, 50_001), 1_200_000);
  assert.equal(sheetViewport.getOnlyPreviewSheetAxisSize(axis, 50_001), 48);
  assert.equal(sheetViewport.findOnlyPreviewSheetAxisIndex(axis, 1_200_000), 50_001);
  const range = sheetViewport.getOnlyPreviewSheetVirtualRange(axis, 1_200_000, 480, 2);
  assert.deepEqual(range, { start: 49_999, end: 50_022 });
  assert.equal(range.end - range.start + 1, 24);
  assert.equal(sheetViewport.getOnlyPreviewSheetSpanSize(axis, 50_000, 50_002), 96);
});

test('accepts the exact per-cell text cap and excludes cap + 1 without truncating', () => {
  const exact = 'x'.repeat(sheetContract.ONLY_PREVIEW_SHEET_MAX_CELL_TEXT_CHARS);
  const accepted = sheetModel.buildOnlyPreviewSheetModel(makeWorkbookLike([exact]));
  assert.equal(accepted.manifest.acceptedCells, 1);
  assert.deepEqual(accepted.manifest.coverage, { kind: 'complete' });
  assert.equal(accepted.getViewport(0, 1, 1, 1, 1).cells[0]?.text.length, exact.length);

  const excluded = sheetModel.buildOnlyPreviewSheetModel(makeWorkbookLike([`${exact}x`]));
  assert.equal(excluded.manifest.acceptedCells, 0);
  assert.deepEqual(excluded.manifest.coverage, {
    kind: 'partial',
    reason: 'sheet-model-cap',
    acceptedSheets: 1,
    acceptedCells: 0
  });
  assert.deepEqual(excluded.getViewport(0, 1, 1, 1, 1).cells, []);
});

test('accepts the exact aggregate text cap and stops before aggregate cap + 1', () => {
  const exactCell = 'x'.repeat(sheetContract.ONLY_PREVIEW_SHEET_MAX_CELL_TEXT_CHARS);
  const exactCellCount =
    sheetContract.ONLY_PREVIEW_SHEET_MAX_TOTAL_TEXT_CHARS /
    sheetContract.ONLY_PREVIEW_SHEET_MAX_CELL_TEXT_CHARS;
  assert.equal(Number.isInteger(exactCellCount), true);

  const exact = sheetModel.buildOnlyPreviewSheetModel(
    makeWorkbookLike(Array.from({ length: exactCellCount }, () => exactCell))
  );
  assert.equal(exact.manifest.acceptedCells, exactCellCount);
  assert.deepEqual(exact.manifest.coverage, { kind: 'complete' });

  const plusOne = sheetModel.buildOnlyPreviewSheetModel(
    makeWorkbookLike([...Array.from({ length: exactCellCount }, () => exactCell), 'x'])
  );
  assert.equal(plusOne.manifest.acceptedCells, exactCellCount);
  assert.deepEqual(plusOne.manifest.coverage, {
    kind: 'partial',
    reason: 'sheet-model-cap',
    acceptedSheets: 1,
    acceptedCells: exactCellCount
  });
  assert.equal(
    plusOne.getViewport(0, 1, 1, exactCellCount + 1, exactCellCount + 1).cells.length,
    0
  );
});

test('reports partial truth when only the non-indexed 65th sheet is nonempty', () => {
  const worksheets = Array.from(
    { length: sheetContract.ONLY_PREVIEW_SHEET_MAX_SHEETS + 1 },
    (_, index) => ({
      name: `Sheet ${index + 1}`,
      rowCount: index === sheetContract.ONLY_PREVIEW_SHEET_MAX_SHEETS ? 1 : 0,
      actualRowCount: index === sheetContract.ONLY_PREVIEW_SHEET_MAX_SHEETS ? 1 : 0,
      columnCount: index === sheetContract.ONLY_PREVIEW_SHEET_MAX_SHEETS ? 1 : 0,
      _rows:
        index === sheetContract.ONLY_PREVIEW_SHEET_MAX_SHEETS
          ? [
              undefined,
              { number: 1, _cells: [undefined, { row: 1, col: 1, value: 'outside cap' }] }
            ]
          : [],
      columns: [],
      _merges: {}
    })
  );
  const model = sheetModel.buildOnlyPreviewSheetModel({ worksheets, properties: {} });
  assert.equal(model.manifest.sheets.length, sheetContract.ONLY_PREVIEW_SHEET_MAX_SHEETS);
  assert.equal(model.manifest.acceptedCells, 0);
  assert.deepEqual(model.manifest.coverage, {
    kind: 'partial',
    reason: 'sheet-model-cap',
    acceptedSheets: sheetContract.ONLY_PREVIEW_SHEET_MAX_SHEETS,
    acceptedCells: 0
  });
  assert.equal(model.search('query', { query: 'outside cap' }).total, 0);
});

test('does not read the unbounded worksheet model getter and reports over-row content as partial', () => {
  let modelReads = 0;
  const worksheet = {
    name: 'Deep',
    rowCount: 100_001,
    actualRowCount: 1,
    columnCount: 1,
    _rows: {
      100000: {
        number: 100_001,
        _cells: { 0: { row: 100_001, col: 1, value: 'outside row cap' } }
      }
    },
    columns: [],
    _merges: {}
  };
  Object.defineProperty(worksheet, 'model', {
    get() {
      modelReads += 1;
      throw new Error('worksheet.model must not be materialized');
    }
  });

  const model = sheetModel.buildOnlyPreviewSheetModel({ worksheets: [worksheet], properties: {} });
  assert.equal(modelReads, 0);
  assert.equal(model.manifest.acceptedCells, 0);
  assert.deepEqual(model.manifest.coverage, {
    kind: 'partial',
    reason: 'sheet-model-cap',
    acceptedSheets: 1,
    acceptedCells: 0
  });
});

test('inspects at most the first 100,000 raw merge records even when every range is out of model bounds', () => {
  let rangeReads = 0;
  const outOfBoundsMerges = Array.from(
    { length: sheetContract.ONLY_PREVIEW_SHEET_MAX_MERGES + 1 },
    () => {
      const merge = {};
      Object.defineProperty(merge, 'range', {
        enumerable: true,
        get() {
          rangeReads += 1;
          return 'A100001:B100001';
        }
      });
      return merge;
    }
  );
  const model = sheetModel.buildOnlyPreviewSheetModel({
    worksheets: [
      {
        name: 'Hostile sparse merges',
        rowCount: 100_001,
        actualRowCount: 1,
        columnCount: 2,
        _rows: [],
        columns: [],
        _merges: outOfBoundsMerges
      }
    ],
    properties: {}
  });

  assert.equal(rangeReads, sheetContract.ONLY_PREVIEW_SHEET_MAX_MERGES);
  assert.deepEqual(model.manifest.coverage, {
    kind: 'partial',
    reason: 'sheet-model-cap',
    acceptedSheets: 1,
    acceptedCells: 0
  });
});
