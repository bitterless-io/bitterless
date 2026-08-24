/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { build } from 'esbuild';
import ExcelJS from 'exceljs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-onlypreview-sheet-date-'));

await build({
  entryPoints: {
    format: join(
      projectRoot,
      'src/renderer/onlypreview/preview/src/onlyPreviewSheetFormat.service.ts'
    ),
    model: join(
      projectRoot,
      'src/renderer/onlypreview/preview/src/onlyPreviewSheetModel.service.ts'
    )
  },
  outdir: buildRoot,
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: 'inline',
  tsconfig: join(projectRoot, 'tsconfig.web.json')
});

const sheetFormat = await import(pathToFileURL(join(buildRoot, 'format.mjs')).href);
const sheetModel = await import(pathToFileURL(join(buildRoot, 'model.mjs')).href);

after(() => rmSync(buildRoot, { recursive: true, force: true }));

const roundTripDateWorkbook = async ({ date1904, values, format }) => {
  const source = new ExcelJS.Workbook();
  source.properties.date1904 = date1904;
  const sheet = source.addWorksheet('Dates');
  values.forEach((value, index) => {
    const cell = sheet.getCell(1, index + 1);
    cell.value = value;
    cell.numFmt = format;
  });
  const bytes = await source.xlsx.writeBuffer();
  const loaded = new ExcelJS.Workbook();
  await loaded.xlsx.load(bytes);
  return loaded;
};

test('real ExcelJS 1900 serials 59, 60, and 61 keep formatter, model, and search parity', async () => {
  const workbook = await roundTripDateWorkbook({
    date1904: false,
    values: [59, 60, 61],
    format: 'm/d/yyyy'
  });
  const loadedValues = [1, 2, 3].map((column) => workbook.worksheets[0].getCell(1, column).value);
  assert.deepEqual(
    loadedValues.map((value) => value.toISOString()),
    ['1900-02-27T00:00:00.000Z', '1900-02-28T00:00:00.000Z', '1900-03-01T00:00:00.000Z']
  );

  const expectedTexts = ['2/28/1900', '2/29/1900', '3/1/1900'];
  assert.deepEqual(
    loadedValues.map((value) => sheetFormat.formatOnlyPreviewSheetValue(value, 'm/d/yyyy', false)),
    expectedTexts
  );
  const model = sheetModel.buildOnlyPreviewSheetModel(workbook);
  const texts = model.getViewport(0, 1, 1, 1, 3).cells.map((cell) => cell.text);
  assert.deepEqual(texts, expectedTexts);
  for (const [index, text] of texts.entries()) {
    const result = model.search('query', { query: text, caseSensitive: true });
    assert.equal(result.total, 1);
    assert.deepEqual(result.target, { sheetId: 0, row: 1, column: index + 1 });
  }
});

test('real ExcelJS 1900 serial 60 preserves its cached time fraction', async () => {
  const workbook = await roundTripDateWorkbook({
    date1904: false,
    values: [60.5],
    format: 'm/d/yyyy h:mm'
  });
  const model = sheetModel.buildOnlyPreviewSheetModel(workbook);
  const text = model.getViewport(0, 1, 1, 1, 1).cells[0]?.text;
  assert.equal(text, '2/29/1900 12:00');
  assert.equal(model.search('query', { query: text, caseSensitive: true }).total, 1);
});

test('real ExcelJS 1904 dates use the workbook epoch for display and search', async () => {
  const workbook = await roundTripDateWorkbook({
    date1904: true,
    values: [59],
    format: 'm/d/yyyy'
  });
  assert.equal(
    workbook.worksheets[0].getCell('A1').value.toISOString(),
    '1904-02-29T00:00:00.000Z'
  );
  assert.equal(
    sheetFormat.formatOnlyPreviewSheetValue(
      workbook.worksheets[0].getCell('A1').value,
      'm/d/yyyy',
      true
    ),
    '2/29/1904'
  );
  const model = sheetModel.buildOnlyPreviewSheetModel(workbook);
  const text = model.getViewport(0, 1, 1, 1, 1).cells[0]?.text;
  assert.equal(text, '2/29/1904');
  assert.deepEqual(model.search('query', { query: text, caseSensitive: true }).target, {
    sheetId: 0,
    row: 1,
    column: 1
  });
});

test('single-cell merges and unsupported horizontal modes fail closed', () => {
  assert.equal(sheetModel.parseOnlyPreviewSheetMerge('A1:A1'), null);
  assert.equal(
    sheetFormat.extractOnlyPreviewSheetStyle({ alignment: { horizontal: 'fill' } }),
    undefined
  );
  assert.equal(
    sheetFormat.extractOnlyPreviewSheetStyle({ alignment: { horizontal: 'justify' } }),
    undefined
  );
});
