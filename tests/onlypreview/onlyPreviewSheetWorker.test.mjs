/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { Worker } from 'node:worker_threads';
import { build } from 'esbuild';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-onlypreview-sheet-worker-'));
const sessionPath = join(buildRoot, 'session.mjs');
const workerBuildRoot = join(buildRoot, 'worker');
const probeWorkerBuildRoot = join(buildRoot, 'probe-worker');

await build({
  entryPoints: [
    join(projectRoot, 'src/renderer/onlypreview/preview/src/onlyPreviewSheet.service.ts')
  ],
  outfile: sessionPath,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: 'inline',
  tsconfig: join(projectRoot, 'tsconfig.web.json')
});

const workerBuild = await build({
  entryPoints: {
    worker: join(
      projectRoot,
      'src/renderer/onlypreview/preview/src/workers/onlyPreviewSheet.worker.ts'
    )
  },
  outdir: workerBuildRoot,
  entryNames: '[name]',
  chunkNames: 'chunks/[name]-[hash]',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  splitting: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  sourcemap: 'inline',
  metafile: true,
  tsconfig: join(projectRoot, 'tsconfig.web.json')
});

await build({
  entryPoints: {
    worker: join(
      projectRoot,
      'src/renderer/onlypreview/preview/src/workers/onlyPreviewSheet.worker.ts'
    )
  },
  outdir: probeWorkerBuildRoot,
  entryNames: '[name]',
  chunkNames: 'chunks/[name]-[hash]',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  splitting: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  tsconfig: join(projectRoot, 'tsconfig.web.json'),
  plugins: [
    {
      name: 'probe-exceljs-import',
      setup(buildContext) {
        buildContext.onResolve({ filter: /^exceljs$/ }, () => ({
          path: 'exceljs-probe',
          namespace: 'exceljs-probe'
        }));
        buildContext.onLoad({ filter: /.*/, namespace: 'exceljs-probe' }, () => ({
          loader: 'js',
          contents: `
            globalThis.postMessage({ type: 'exceljs-import-probe' });
            export class Workbook {
              xlsx = { load: async () => undefined };
              worksheets = [];
              properties = {};
            }
            export default { Workbook };
          `
        }));
      }
    }
  ]
});

const bootstrapPath = join(workerBuildRoot, 'node-worker-bootstrap.mjs');
writeFileSync(
  bootstrapPath,
  `
    import { parentPort } from 'node:worker_threads';
    const pending = [];
    const listeners = [];
    globalThis.self = globalThis;
    globalThis.postMessage = (message) => parentPort.postMessage(message);
    globalThis.addEventListener = (type, listener) => {
      if (type !== 'message') return;
      listeners.push(listener);
      while (pending.length) listener({ data: pending.shift() });
    };
    parentPort.on('message', (data) => {
      if (!listeners.length) pending.push(data);
      else for (const listener of listeners) listener({ data });
    });
    await import('./worker.mjs');
  `
);
const probeBootstrapPath = join(probeWorkerBuildRoot, 'node-worker-bootstrap.mjs');
writeFileSync(
  probeBootstrapPath,
  `
    import { parentPort } from 'node:worker_threads';
    const pending = [];
    const listeners = [];
    globalThis.self = globalThis;
    globalThis.postMessage = (message) => parentPort.postMessage(message);
    globalThis.addEventListener = (type, listener) => {
      if (type !== 'message') return;
      listeners.push(listener);
      while (pending.length) listener({ data: pending.shift() });
    };
    parentPort.on('message', (data) => {
      if (!listeners.length) pending.push(data);
      else for (const listener of listeners) listener({ data });
    });
    await import('./worker.mjs');
  `
);

const sessionRuntime = await import(pathToFileURL(sessionPath).href);

after(() => rmSync(buildRoot, { recursive: true, force: true }));

const manifest = {
  sheets: [{ id: 0, name: 'Sheet 1', rowCount: 1, columnCount: 1 }],
  acceptedCells: 1,
  coverage: { kind: 'complete' }
};

const responseFor = (request, response, identityOverride = {}) => ({
  hostId: request.hostId,
  runtimeId: request.runtimeId,
  selectionRevision: request.selectionRevision,
  workerGeneration: request.workerGeneration,
  requestId: request.requestId,
  ...response,
  ...identityOverride
});

class FakeWorker {
  listeners = new Map();
  messages = [];
  terminated = false;
  throwOnPost = false;
  onPost = null;

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  postMessage(message, transfer = []) {
    this.messages.push({ message, transfer });
    if (this.throwOnPost) throw new Error('synchronous postMessage failure');
    this.onPost?.(message, this);
  }

  terminate() {
    this.terminated = true;
  }

  emit(response) {
    for (const listener of this.listeners.get('message') ?? []) listener({ data: response });
  }

  fail(type = 'error') {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
}

const zipSignatureBytes = () => new Uint8Array([0x50, 0x4b, 0x03, 0x04]);

const makeFetch = (calls) => async (url, options) => {
  calls.push({ url, options });
  return new Response(zipSignatureBytes(), { status: 200 });
};

const errorHasCode = (code) => (error) => error?.code === code;
const nextTurn = () => new Promise((resolveTurn) => setImmediate(resolveTurn));

const waitUntil = async (predicate, label) => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await nextTurn();
  }
  assert.fail(`Timed out waiting for ${label}`);
};

const waitForWorkerMessage = (worker, predicate, timeoutMs = 15_000) =>
  new Promise((resolveMessage, rejectMessage) => {
    const timer = setTimeout(() => {
      cleanup();
      rejectMessage(new Error('Timed out waiting for sheet Worker response.'));
    }, timeoutMs);
    const onMessage = (message) => {
      if (!predicate(message)) return;
      cleanup();
      resolveMessage(message);
    };
    const onError = (error) => {
      cleanup();
      rejectMessage(error);
    };
    const cleanup = () => {
      clearTimeout(timer);
      worker.off('message', onMessage);
      worker.off('error', onError);
    };
    worker.on('message', onMessage);
    worker.on('error', onError);
  });

test('keeps ExcelJS in a dynamic Worker chunk and the real Worker preflights before loading a workbook', async () => {
  const outputs = Object.entries(workerBuild.metafile.outputs);
  const entry = outputs.find(([, output]) =>
    output.entryPoint?.endsWith('onlyPreviewSheet.worker.ts')
  );
  assert.ok(entry, 'sheet Worker entry must be present in the bundle graph');
  const dynamicImports = entry[1].imports.filter(({ kind }) => kind === 'dynamic-import');
  assert.ok(dynamicImports.length > 0, 'sheet Worker must keep ExcelJS behind a dynamic import');
  const dynamicOutputPaths = new Set(dynamicImports.map(({ path }) => path));
  assert.equal(
    outputs.some(
      ([outputPath, output]) =>
        dynamicOutputPaths.has(outputPath) &&
        Object.keys(output.inputs).some((input) => input.includes('node_modules/exceljs/'))
    ),
    true,
    'the dynamic chunk, not the Worker entry, must own ExcelJS'
  );
  assert.equal(
    Object.keys(entry[1].inputs).some((input) => input.includes('node_modules/exceljs/')),
    false
  );

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Worker Sheet');
  sheet.getCell('A1').value = 'Worker Needle';
  sheet.getCell('B2').value = { formula: 'PRIVATE_FORMULA_SOURCE()', result: 7 };
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const bytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const worker = new Worker(pathToFileURL(bootstrapPath), { type: 'module' });
  const responseOrder = [];
  worker.on('message', (response) => responseOrder.push(response.type));
  const identity = {
    hostId: 'worker-host',
    runtimeId: 'worker-runtime',
    selectionRevision: 19,
    workerGeneration: 3
  };

  try {
    const preflightPromise = waitForWorkerMessage(
      worker,
      (response) => response.requestId === 1 && response.type === 'preflight-ready'
    );
    const loadedPromise = waitForWorkerMessage(
      worker,
      (response) => response.requestId === 1 && response.type === 'loaded'
    );
    worker.postMessage({ ...identity, requestId: 1, type: 'load', bytes }, [bytes]);
    assert.equal(bytes.byteLength, 0, 'the exact workbook ArrayBuffer must be transferred');
    await preflightPromise;
    const loaded = await loadedPromise;
    assert.deepEqual(responseOrder.slice(0, 2), ['preflight-ready', 'loaded']);
    assert.deepEqual(loaded.manifest.coverage, { kind: 'complete' });

    const searchPromise = waitForWorkerMessage(
      worker,
      (response) => response.requestId === 2 && response.type === 'search'
    );
    worker.postMessage({
      ...identity,
      requestId: 2,
      type: 'search',
      operation: 'query',
      query: 'worker needle',
      caseSensitive: false
    });
    const search = await searchPromise;
    assert.deepEqual(search.result.target, { sheetId: 0, row: 1, column: 1 });

    const formulaSourcePromise = waitForWorkerMessage(
      worker,
      (response) => response.requestId === 3 && response.type === 'search'
    );
    worker.postMessage({
      ...identity,
      requestId: 3,
      type: 'search',
      operation: 'query',
      query: 'PRIVATE_FORMULA_SOURCE',
      caseSensitive: false
    });
    assert.equal((await formulaSourcePromise).result.total, 0);
  } finally {
    await worker.terminate();
  }
});

test('rejects hostile merge expansion before importing the workbook engine', async () => {
  const archive = new JSZip();
  archive.file('[Content_Types].xml', '<Types/>');
  archive.file('_rels/.rels', '<Relationships/>');
  archive.file('xl/workbook.xml', '<workbook/>');
  archive.file(
    'xl/worksheets/sheet1.xml',
    '<worksheet><mergeCells><mergeCell ref="A1:SH100000"/></mergeCells></worksheet>'
  );
  const buffer = await archive.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
  const worker = new Worker(pathToFileURL(probeBootstrapPath), { type: 'module' });
  let engineImported = false;
  worker.on('message', (response) => {
    if (response.type === 'exceljs-import-probe') engineImported = true;
  });
  const identity = {
    hostId: 'merge-limit-host',
    runtimeId: 'merge-limit-runtime',
    selectionRevision: 29,
    workerGeneration: 5
  };

  try {
    const failurePromise = waitForWorkerMessage(
      worker,
      (response) => response.requestId === 17 && response.type === 'error'
    );
    worker.postMessage({ ...identity, requestId: 17, type: 'load', bytes: buffer }, [buffer]);
    const failure = await failurePromise;
    assert.equal(failure.errorCode, 'OOXML_ARCHIVE_LIMIT');
    await nextTurn();
    assert.equal(engineImported, false, 'ExcelJS must remain unimported when preflight rejects');
  } finally {
    await worker.terminate();
  }
});

test('SheetSession fetches once, transfers the exact buffer, fences identity, and is single-use', async () => {
  const fetchCalls = [];
  const worker = new FakeWorker();
  const session = new sessionRuntime.OnlyPreviewSheetSession({
    hostId: 'session-host',
    selectionRevision: 41,
    fetchImpl: makeFetch(fetchCalls),
    workerFactory: () => worker
  });
  const loadPromise = session.load('onlypreview-asset://exact-revision', 4);
  await waitUntil(() => worker.messages.length === 1, 'session load request');
  const loadRecord = worker.messages[0];
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, 'onlypreview-asset://exact-revision');
  assert.equal(fetchCalls[0].options.method, 'GET');
  assert.equal(fetchCalls[0].options.cache, 'no-store');
  assert.equal(fetchCalls[0].options.credentials, 'omit');
  assert.equal(loadRecord.message.bytes.byteLength, 4);
  assert.deepEqual(loadRecord.transfer, [loadRecord.message.bytes]);

  worker.emit(
    responseFor(
      loadRecord.message,
      { type: 'preflight-ready' },
      {
        workerGeneration: loadRecord.message.workerGeneration + 1
      }
    )
  );
  worker.emit(
    responseFor(
      loadRecord.message,
      { type: 'loaded', manifest },
      {
        workerGeneration: loadRecord.message.workerGeneration + 1
      }
    )
  );
  let settled = false;
  void loadPromise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    }
  );
  await nextTurn();
  assert.equal(settled, false, 'stale generation responses must not settle the current request');

  worker.emit(responseFor(loadRecord.message, { type: 'preflight-ready' }));
  worker.emit(responseFor(loadRecord.message, { type: 'loaded', manifest }));
  assert.deepEqual(await loadPromise, manifest);
  assert.deepEqual(session.manifest, manifest);
  await assert.rejects(
    () => session.load('onlypreview-asset://second-load', 4),
    errorHasCode('INVALID_INPUT')
  );

  worker.onPost = (request, currentWorker) => {
    if (request.type !== 'search') return;
    currentWorker.emit(
      responseFor(request, {
        type: 'search',
        result: {
          total: 1,
          active: 1,
          coverage: { kind: 'complete' },
          target: { sheetId: 0, row: 1, column: 1 }
        }
      })
    );
  };
  assert.deepEqual((await session.query('needle', false)).target, {
    sheetId: 0,
    row: 1,
    column: 1
  });
  session.dispose();
  assert.equal(worker.terminated, true);
  assert.equal(session.manifest, null);
});

test('SheetSession rejects loaded-before-preflight as a terminal protocol failure', async () => {
  const worker = new FakeWorker();
  worker.onPost = (request, currentWorker) => {
    queueMicrotask(() => currentWorker.emit(responseFor(request, { type: 'loaded', manifest })));
  };
  const session = new sessionRuntime.OnlyPreviewSheetSession({
    hostId: 'loaded-too-early-host',
    selectionRevision: 2,
    fetchImpl: makeFetch([]),
    workerFactory: () => worker
  });
  await assert.rejects(
    () => session.load('onlypreview-asset://loaded-too-early', 4),
    errorHasCode('SHEET_PARSE_FAILED')
  );
  assert.equal(worker.terminated, true);
  assert.equal(session.manifest, null);
});

test('SheetSession contains synchronous Worker post failures and rejects every pending request on cleanup', async () => {
  const throwingWorker = new FakeWorker();
  throwingWorker.throwOnPost = true;
  const throwingSession = new sessionRuntime.OnlyPreviewSheetSession({
    hostId: 'throwing-host',
    selectionRevision: 3,
    fetchImpl: makeFetch([]),
    workerFactory: () => throwingWorker
  });
  await assert.rejects(
    () => throwingSession.load('onlypreview-asset://post-throws', 4),
    errorHasCode('SHEET_PARSE_FAILED')
  );
  assert.equal(throwingWorker.terminated, true);
  assert.throws(() => throwingSession.requestLayout(0), errorHasCode('SHEET_RENDER_TIMEOUT'));

  const worker = new FakeWorker();
  worker.onPost = (request, currentWorker) => {
    if (request.type !== 'load') return;
    queueMicrotask(() => {
      currentWorker.emit(responseFor(request, { type: 'preflight-ready' }));
      currentWorker.emit(responseFor(request, { type: 'loaded', manifest }));
    });
  };
  const session = new sessionRuntime.OnlyPreviewSheetSession({
    hostId: 'cleanup-host',
    selectionRevision: 4,
    fetchImpl: makeFetch([]),
    workerFactory: () => worker
  });
  await session.load('onlypreview-asset://cleanup', 4);
  worker.onPost = null;
  const layoutPromise = session.requestLayout(0);
  await waitUntil(
    () => worker.messages.some(({ message }) => message.type === 'layout'),
    'layout request'
  );
  session.dispose();
  await assert.rejects(layoutPromise, errorHasCode('SHEET_RENDER_TIMEOUT'));
  assert.equal(worker.terminated, true);
  assert.equal(session.manifest, null);
});

test(
  'SheetSession enforces the preflight deadline and terminates the disposable Worker',
  { concurrency: false },
  async () => {
    const worker = new FakeWorker();
    const session = new sessionRuntime.OnlyPreviewSheetSession({
      hostId: 'timeout-host',
      selectionRevision: 5,
      fetchImpl: makeFetch([]),
      workerFactory: () => worker
    });
    const originalSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = (callback, delay, ...arguments_) =>
      originalSetTimeout(callback, delay === 10_000 ? 0 : delay, ...arguments_);
    try {
      await assert.rejects(
        () => session.load('onlypreview-asset://timeout', 4),
        errorHasCode('SHEET_RENDER_TIMEOUT')
      );
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }
    assert.equal(worker.terminated, true);
    assert.equal(session.manifest, null);
  }
);

test('separate SheetSession instances use distinct Worker generations', async () => {
  const workers = [new FakeWorker(), new FakeWorker()];
  for (const worker of workers) {
    worker.onPost = (request, currentWorker) => {
      queueMicrotask(() => {
        currentWorker.emit(responseFor(request, { type: 'preflight-ready' }));
        currentWorker.emit(responseFor(request, { type: 'loaded', manifest }));
      });
    };
  }
  const sessions = workers.map(
    (worker) =>
      new sessionRuntime.OnlyPreviewSheetSession({
        hostId: 'generation-host',
        selectionRevision: 7,
        fetchImpl: makeFetch([]),
        workerFactory: () => worker
      })
  );
  await Promise.all(
    sessions.map((session, index) => session.load(`onlypreview-asset://generation-${index}`, 4))
  );
  assert.notEqual(
    workers[0].messages[0].message.workerGeneration,
    workers[1].messages[0].message.workerGeneration
  );
  for (const session of sessions) session.dispose();
});
