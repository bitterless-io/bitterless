/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { Worker } from 'node:worker_threads';
import AdmZip from 'adm-zip';
import { build } from 'esbuild';
import ExcelJS from 'exceljs';

const projectRoot = resolve(dirname(new URL(import.meta.url).pathname), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-xlsx-compatibility-worker-'));
const bundlePath = join(buildRoot, 'worker.mjs');

await build({
  entryPoints: [
    join(
      projectRoot,
      'src/renderer/onlypreview/preview/src/workers/onlyPreviewXlsxCompatibility.worker.ts'
    )
  ],
  outfile: bundlePath,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: 'inline',
  tsconfig: join(projectRoot, 'tsconfig.web.json'),
  plugins: [
    {
      name: 'exceljs-worker-stub',
      setup(buildContext) {
        buildContext.onResolve({ filter: /^exceljs$/ }, () => ({
          path: 'exceljs',
          namespace: 'xlsx-compatibility-test'
        }));
        buildContext.onLoad({ filter: /.*/, namespace: 'xlsx-compatibility-test' }, () => ({
          loader: 'js',
          contents: `
            export class Workbook {
              constructor() {
                globalThis.__onlyPreviewXlsxCompatibilityHarness.constructions += 1;
                this.xlsx = {
                  load: async (bytes) => {
                    globalThis.__onlyPreviewXlsxCompatibilityHarness.loads.push(bytes);
                    if (globalThis.__onlyPreviewXlsxCompatibilityHarness.loadError) {
                      throw new Error('load failed');
                    }
                  },
                  writeBuffer: async () =>
                    globalThis.__onlyPreviewXlsxCompatibilityHarness.output
                };
              }
            }
            export default { Workbook };
          `
        }));
      }
    }
  ]
});

const responses = [];
const workerScope = {
  onmessage: null,
  postMessage(message, transfer = []) {
    responses.push({ message, transfer });
  }
};
globalThis.self = workerScope;
globalThis.__onlyPreviewXlsxCompatibilityHarness = {
  constructions: 0,
  loadError: false,
  loads: [],
  output: new Uint8Array([1])
};
await import(pathToFileURL(bundlePath).href);

const realBuildRoot = join(buildRoot, 'real');
const realBuild = await build({
  entryPoints: {
    worker: join(
      projectRoot,
      'src/renderer/onlypreview/preview/src/workers/onlyPreviewXlsxCompatibility.worker.ts'
    )
  },
  outdir: realBuildRoot,
  entryNames: '[name]',
  chunkNames: 'chunks/[name]-[hash]',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  splitting: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  metafile: true,
  tsconfig: join(projectRoot, 'tsconfig.web.json')
});
const realEntry = Object.entries(realBuild.metafile.outputs).find(([, output]) =>
  output.entryPoint?.endsWith('onlyPreviewXlsxCompatibility.worker.ts')
);
assert.ok(realEntry, 'real XLSX compatibility Worker entry must exist');
const realEntryPath = resolve(projectRoot, realEntry[0]);
const bootstrapPath = join(realBuildRoot, 'node-worker-bootstrap.mjs');
writeFileSync(
  bootstrapPath,
  `
    import { parentPort } from 'node:worker_threads';
    globalThis.self = globalThis;
    globalThis.postMessage = (message, transfer = []) => parentPort.postMessage(message, transfer);
    parentPort.on('message', (data) => globalThis.onmessage?.({ data }));
    await import(${JSON.stringify(pathToFileURL(realEntryPath).href)});
    parentPort.postMessage({ type: 'bootstrap-ready' });
  `
);

after(() => {
  delete globalThis.self;
  delete globalThis.__onlyPreviewXlsxCompatibilityHarness;
  rmSync(buildRoot, { recursive: true, force: true });
});

const reset = (output = new Uint8Array([1])) => {
  responses.length = 0;
  Object.assign(globalThis.__onlyPreviewXlsxCompatibilityHarness, {
    constructions: 0,
    loadError: false,
    loads: [],
    output
  });
};

const request = (bytes) => ({
  runtimeId: 'runtime-1',
  selectionRevision: 17,
  requestId: 3,
  type: 'normalize',
  bytes
});

const runRealWorker = async (bytes) => {
  const worker = new Worker(pathToFileURL(bootstrapPath), { type: 'module' });
  try {
    await new Promise((resolveReady, rejectReady) => {
      worker.once('error', rejectReady);
      worker.on('message', (message) => {
        if (message?.type === 'bootstrap-ready') resolveReady();
      });
    });
    return await new Promise((resolveResponse, rejectResponse) => {
      worker.once('error', rejectResponse);
      worker.on('message', (message) => {
        if (message?.type !== 'bootstrap-ready') resolveResponse(message);
      });
      worker.postMessage(request(bytes), [bytes]);
    });
  } finally {
    await worker.terminate();
  }
};

test('normalization keeps identity, loads transferred bytes, and transfers an exact output', async () => {
  const backing = new Uint8Array([0, 7, 8, 0]);
  reset(backing.subarray(1, 3));
  const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer;
  await workerScope.onmessage({ data: request(bytes) });

  assert.equal(globalThis.__onlyPreviewXlsxCompatibilityHarness.constructions, 1);
  assert.equal(globalThis.__onlyPreviewXlsxCompatibilityHarness.loads.length, 1);
  assert.equal(globalThis.__onlyPreviewXlsxCompatibilityHarness.loads[0].buffer, bytes);
  assert.equal(responses.length, 1);
  assert.deepEqual(
    {
      runtimeId: responses[0].message.runtimeId,
      selectionRevision: responses[0].message.selectionRevision,
      requestId: responses[0].message.requestId,
      type: responses[0].message.type
    },
    { runtimeId: 'runtime-1', selectionRevision: 17, requestId: 3, type: 'ready' }
  );
  assert.deepEqual([...new Uint8Array(responses[0].message.bytes)], [7, 8]);
  assert.equal(responses[0].message.bytes.byteLength, 2);
  assert.deepEqual(responses[0].transfer, [responses[0].message.bytes]);
});

test('normalization rejects input and output beyond its four-MiB memory gate', async () => {
  reset();
  await workerScope.onmessage({ data: request(new ArrayBuffer(4 * 1024 * 1024 + 1)) });
  assert.equal(globalThis.__onlyPreviewXlsxCompatibilityHarness.constructions, 0);
  assert.deepEqual(responses[0].message, {
    runtimeId: 'runtime-1',
    selectionRevision: 17,
    requestId: 3,
    type: 'error',
    errorCode: 'OOXML_ARCHIVE_LIMIT'
  });

  reset(new Uint8Array(4 * 1024 * 1024 + 1));
  await workerScope.onmessage({ data: request(new ArrayBuffer(4)) });
  assert.equal(globalThis.__onlyPreviewXlsxCompatibilityHarness.constructions, 1);
  assert.equal(responses[0].message.errorCode, 'OOXML_ARCHIVE_LIMIT');
  assert.deepEqual(responses[0].transfer, []);
});

test('ExcelJS failures are content-free typed parse errors', async () => {
  reset();
  globalThis.__onlyPreviewXlsxCompatibilityHarness.loadError = true;
  await workerScope.onmessage({ data: request(new ArrayBuffer(4)) });
  assert.deepEqual(responses[0].message, {
    runtimeId: 'runtime-1',
    selectionRevision: 17,
    requestId: 3,
    type: 'error',
    errorCode: 'SHEET_PARSE_FAILED'
  });
  assert.deepEqual(responses[0].transfer, []);
});

test('the real Worker rewrites a missing-sheetData workbook for the OOXML parser', async () => {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('Sheet1');
  const archive = new AdmZip(Buffer.from(await workbook.xlsx.writeBuffer()));
  const sheetPath = 'xl/worksheets/sheet1.xml';
  const sheet = archive.getEntry(sheetPath);
  assert.ok(sheet);
  const originalXml = sheet.getData().toString('utf8');
  const missingSheetDataXml = originalXml.replace(/<sheetData\s*\/>/u, '');
  assert.notEqual(missingSheetDataXml, originalXml);
  archive.updateFile(sheetPath, Buffer.from(missingSheetDataXml));
  const source = archive.toBuffer();
  const bytes = source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);

  const response = await runRealWorker(bytes);
  assert.equal(response.type, 'ready');
  assert.equal(response.runtimeId, 'runtime-1');
  assert.ok(response.bytes instanceof ArrayBuffer);
  assert.ok(response.bytes.byteLength <= 4 * 1024 * 1024);
  const normalizedArchive = new AdmZip(Buffer.from(response.bytes));
  const normalizedXml = normalizedArchive.getEntry(sheetPath).getData().toString('utf8');
  assert.equal((normalizedXml.match(/<sheetData(?:\s|\/|>)/gu) ?? []).length, 1);

  const { openXlsxWorkbook } = await import('@silurus/ooxml/node');
  const session = await openXlsxWorkbook(response.bytes);
  try {
    assert.deepEqual(session.sheetNames, ['Sheet1']);
  } finally {
    await session.close();
  }
});
