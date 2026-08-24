/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-sheet-session-validation-'));
const sessionPath = join(buildRoot, 'session.mjs');

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

const sessionRuntime = await import(pathToFileURL(sessionPath).href);

after(() => rmSync(buildRoot, { recursive: true, force: true }));

const validManifest = {
  sheets: [{ id: 0, name: 'Sheet 1', rowCount: 4, columnCount: 4 }],
  acceptedCells: 4,
  coverage: { kind: 'complete' }
};

const validLayout = {
  sheetId: 0,
  rowCount: 4,
  columnCount: 4,
  defaultRowHeight: 24,
  defaultColumnWidth: 88,
  rowHeights: [{ index: 2, size: 32 }],
  columnWidths: [{ index: 3, size: 120 }]
};

const validViewport = {
  sheetId: 0,
  rowStart: 2,
  rowEnd: 3,
  columnStart: 2,
  columnEnd: 3,
  cells: [
    { row: 2, column: 2, text: 'needle', style: { bold: true, color: '#123abc' } },
    { row: 1, column: 1, text: 'merge master' }
  ],
  merges: [{ top: 1, left: 1, bottom: 2, right: 2 }]
};

const validSearchResult = {
  total: 1,
  active: 1,
  coverage: { kind: 'complete' },
  target: { sheetId: 0, row: 2, column: 2 }
};

class FakeWorker {
  listeners = new Map();
  messages = [];
  terminated = false;
  onPost = null;

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  postMessage(message, transfer = []) {
    this.messages.push({ message, transfer });
    this.onPost?.(message, this);
  }

  terminate() {
    this.terminated = true;
  }

  emit(response) {
    for (const listener of this.listeners.get('message') ?? []) listener({ data: response });
  }

  emitEvent(type) {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
}

const zipSignatureBytes = () => new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
const makeFetch = () => async () => new Response(zipSignatureBytes(), { status: 200 });
const errorHasCode = (code) => (error) => error?.code === code;
const nextTurn = () => new Promise((resolveTurn) => setImmediate(resolveTurn));

const responseFor = (request, response, override = {}) => ({
  hostId: request.hostId,
  runtimeId: request.runtimeId,
  selectionRevision: request.selectionRevision,
  workerGeneration: request.workerGeneration,
  requestId: request.requestId,
  ...response,
  ...override
});

const waitForMessage = async (worker, type) => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const record = worker.messages.find(({ message }) => message.type === type);
    if (record) return record.message;
    await nextTurn();
  }
  assert.fail(`Timed out waiting for ${type} request.`);
};

const loadSession = async (manifest = validManifest, options = {}) => {
  const worker = new FakeWorker();
  worker.onPost = (request, currentWorker) => {
    if (request.type !== 'load') return;
    queueMicrotask(() => {
      currentWorker.emit(responseFor(request, { type: 'preflight-ready' }));
      currentWorker.emit(responseFor(request, { type: 'loaded', manifest }));
    });
  };
  const session = new sessionRuntime.OnlyPreviewSheetSession({
    hostId: 'validation-host',
    selectionRevision: 17,
    fetchImpl: makeFetch(),
    workerFactory: () => worker,
    ...options
  });
  await session.load('onlypreview-asset://validation', 4);
  worker.onPost = null;
  return { session, worker };
};

const rejectTerminal = async (promise, session, worker) => {
  await assert.rejects(promise, errorHasCode('SHEET_PARSE_FAILED'));
  assert.equal(worker.terminated, true);
  assert.equal(session.manifest, null);
  assert.throws(() => session.requestLayout(0), errorHasCode('SHEET_RENDER_TIMEOUT'));
};

test('accepts the exact manifest model limits and rejects every over-limit or inconsistent manifest', async () => {
  const maximumManifest = {
    sheets: Array.from({ length: 64 }, (_, id) => ({
      id,
      name: `Sheet ${id + 1}`,
      rowCount: 100_000,
      columnCount: 512
    })),
    acceptedCells: 500_000,
    coverage: {
      kind: 'partial',
      reason: 'sheet-model-cap',
      acceptedSheets: 64,
      acceptedCells: 500_000
    }
  };
  const accepted = await loadSession(maximumManifest);
  assert.deepEqual(accepted.session.manifest, maximumManifest);
  assert.throws(
    () => accepted.session.requestViewport(0, 1, 100_000, 1, 512),
    errorHasCode('INVALID_INPUT')
  );
  accepted.session.dispose();

  const invalidManifests = [
    {
      ...validManifest,
      sheets: Array.from({ length: 65 }, (_, id) => ({
        id,
        name: `Sheet ${id + 1}`,
        rowCount: 1,
        columnCount: 1
      }))
    },
    {
      ...validManifest,
      sheets: [{ ...validManifest.sheets[0], rowCount: 100_001 }]
    },
    {
      ...validManifest,
      sheets: [{ ...validManifest.sheets[0], columnCount: 513 }]
    },
    { ...validManifest, acceptedCells: 500_001 },
    {
      ...validManifest,
      coverage: {
        kind: 'partial',
        reason: 'sheet-model-cap',
        acceptedSheets: 1,
        acceptedCells: 3
      }
    },
    { ...validManifest, coverage: { kind: 'complete', acceptedCells: 4 } }
  ];

  for (const manifest of invalidManifests) {
    const worker = new FakeWorker();
    worker.onPost = (request, currentWorker) => {
      queueMicrotask(() => {
        currentWorker.emit(responseFor(request, { type: 'preflight-ready' }));
        currentWorker.emit(responseFor(request, { type: 'loaded', manifest }));
      });
    };
    const session = new sessionRuntime.OnlyPreviewSheetSession({
      hostId: 'invalid-manifest-host',
      selectionRevision: 18,
      fetchImpl: makeFetch(),
      workerFactory: () => worker
    });
    await rejectTerminal(session.load('onlypreview-asset://invalid-manifest', 4), session, worker);
  }
});

test('validates layout identity, dimensions, records, and rejects every pending request on failure', async () => {
  const { session, worker } = await loadSession();
  const layoutPromise = session.requestLayout(0);
  const viewportPromise = session.requestViewport(0, 1, 2, 1, 2);
  const layoutRequest = await waitForMessage(worker, 'layout');
  worker.emit(
    responseFor(layoutRequest, {
      type: 'layout',
      layout: { ...validLayout, rowHeights: [{ index: 5, size: 24 }] }
    })
  );
  const settled = await Promise.allSettled([layoutPromise, viewportPromise]);
  assert.deepEqual(
    settled.map((result) => (result.status === 'rejected' ? result.reason.code : 'resolved')),
    ['SHEET_PARSE_FAILED', 'SHEET_PARSE_FAILED']
  );
  assert.equal(worker.terminated, true);
  assert.equal(session.manifest, null);

  for (const layout of [
    { ...validLayout, sheetId: 1 },
    { ...validLayout, rowCount: 3 },
    { ...validLayout, defaultColumnWidth: Number.POSITIVE_INFINITY },
    {
      ...validLayout,
      columnWidths: [
        { index: 2, size: 64 },
        { index: 2, size: 96 }
      ]
    }
  ]) {
    const current = await loadSession();
    const promise = current.session.requestLayout(0);
    const request = await waitForMessage(current.worker, 'layout');
    current.worker.emit(responseFor(request, { type: 'layout', layout }));
    await rejectTerminal(promise, current.session, current.worker);
  }
});

test('rejects invalid viewport requests without sending them and validates returned ranges and models', async () => {
  const valid = await loadSession();
  const messageCount = valid.worker.messages.length;
  assert.throws(() => valid.session.requestViewport(0, 0, 2, 1, 2), errorHasCode('INVALID_INPUT'));
  assert.throws(() => valid.session.requestViewport(0, 3, 2, 1, 2), errorHasCode('INVALID_INPUT'));
  assert.throws(() => valid.session.requestLayout(1), errorHasCode('INVALID_INPUT'));
  assert.equal(valid.worker.messages.length, messageCount);
  assert.equal(valid.worker.terminated, false);
  valid.session.dispose();

  const invalidViewports = [
    { ...validViewport, rowEnd: 4 },
    {
      ...validViewport,
      cells: [
        ...validViewport.cells,
        { row: 3, column: 3, text: '3' },
        { row: 2, column: 3, text: '4' },
        { row: 3, column: 2, text: '5' }
      ]
    },
    { ...validViewport, cells: [{ row: 4, column: 4, text: 'outside' }] },
    { ...validViewport, cells: [{ row: 2, column: 2, text: 'x'.repeat(1_048_577) }] },
    {
      ...validViewport,
      cells: [{ row: 2, column: 2, text: 'unsafe', style: { fill: 'url(file:///secret)' } }]
    },
    {
      ...validViewport,
      cells: [{ row: 2, column: 2, text: 'unsupported', style: { horizontal: 'fill' } }],
      merges: []
    },
    {
      ...validViewport,
      cells: [{ row: 2, column: 2, text: 'unsupported', style: { horizontal: 'justify' } }],
      merges: []
    },
    {
      ...validViewport,
      merges: [{ top: 4, left: 4, bottom: 4, right: 4 }],
      cells: [{ row: 2, column: 2, text: 'needle' }]
    }
  ];

  for (const viewport of invalidViewports) {
    const current = await loadSession();
    const promise = current.session.requestViewport(0, 2, 3, 2, 3);
    const request = await waitForMessage(current.worker, 'viewport');
    current.worker.emit(responseFor(request, { type: 'viewport', viewport }));
    await rejectTerminal(promise, current.session, current.worker);
  }
});

test('bounds aggregate merge intersections and rejects overlap, duplicate masters, and single-cell merges', async () => {
  const exact = await loadSession();
  const exactPromise = exact.session.requestViewport(0, 1, 2, 1, 4);
  const exactRequest = await waitForMessage(exact.worker, 'viewport');
  const exactViewport = {
    sheetId: 0,
    rowStart: 1,
    rowEnd: 2,
    columnStart: 1,
    columnEnd: 4,
    cells: [],
    merges: [
      { top: 1, left: 1, bottom: 1, right: 2 },
      { top: 1, left: 3, bottom: 1, right: 4 },
      { top: 2, left: 1, bottom: 2, right: 2 },
      { top: 2, left: 3, bottom: 2, right: 4 }
    ]
  };
  exact.worker.emit(responseFor(exactRequest, { type: 'viewport', viewport: exactViewport }));
  assert.deepEqual(await exactPromise, exactViewport);
  exact.session.dispose();

  const invalidMergeSets = [
    [
      { top: 1, left: 1, bottom: 2, right: 2 },
      { top: 2, left: 2, bottom: 2, right: 3 }
    ],
    [
      { top: 1, left: 1, bottom: 1, right: 2 },
      { top: 1, left: 2, bottom: 2, right: 2 }
    ],
    [
      { top: 1, left: 1, bottom: 1, right: 2 },
      { top: 1, left: 1, bottom: 2, right: 1 }
    ],
    [{ top: 1, left: 1, bottom: 1, right: 1 }]
  ];

  for (const merges of invalidMergeSets) {
    const current = await loadSession();
    const promise = current.session.requestViewport(0, 1, 2, 1, 2);
    const request = await waitForMessage(current.worker, 'viewport');
    current.worker.emit(
      responseFor(request, {
        type: 'viewport',
        viewport: {
          sheetId: 0,
          rowStart: 1,
          rowEnd: 2,
          columnStart: 1,
          columnEnd: 2,
          cells: [],
          merges
        }
      })
    );
    await rejectTerminal(promise, current.session, current.worker);
  }
});

test('notifies one unexpected terminal after load while load failure and owner dispose stay silent', async () => {
  const idleErrors = [];
  const idle = await loadSession(validManifest, {
    onUnexpectedTerminal: (error) => idleErrors.push(error.code)
  });
  idle.worker.emitEvent('error');
  idle.worker.emitEvent('messageerror');
  assert.deepEqual(idleErrors, ['SHEET_PARSE_FAILED']);
  assert.equal(idle.worker.terminated, true);
  assert.equal(idle.session.manifest, null);

  const timeoutErrors = [];
  const timed = await loadSession(validManifest, {
    onUnexpectedTerminal: (error) => timeoutErrors.push(error.code)
  });
  const originalSetTimeout = globalThis.setTimeout;
  let searchPromise;
  try {
    globalThis.setTimeout = (callback, delay, ...arguments_) =>
      originalSetTimeout(callback, delay === 10_000 ? 0 : delay, ...arguments_);
    searchPromise = timed.session.query('never responds', false);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
  await assert.rejects(searchPromise, errorHasCode('SHEET_RENDER_TIMEOUT'));
  assert.deepEqual(timeoutErrors, ['SHEET_RENDER_TIMEOUT']);
  assert.equal(timed.worker.terminated, true);

  const disposedErrors = [];
  const disposed = await loadSession(validManifest, {
    onUnexpectedTerminal: (error) => disposedErrors.push(error.code)
  });
  const pendingSearch = disposed.session.query('pending during dispose', false);
  disposed.session.dispose();
  await assert.rejects(pendingSearch, errorHasCode('SHEET_RENDER_TIMEOUT'));
  assert.deepEqual(disposedErrors, []);

  const loadErrors = [];
  const loadFailure = new sessionRuntime.OnlyPreviewSheetSession({
    hostId: 'load-failure-host',
    selectionRevision: 19,
    fetchImpl: makeFetch(),
    workerFactory: () => new FakeWorker(),
    onUnexpectedTerminal: (error) => loadErrors.push(error.code)
  });
  await assert.rejects(
    loadFailure.load('onlypreview-asset://load-failure', 5),
    errorHasCode('SHEET_PARSE_FAILED')
  );
  assert.deepEqual(loadErrors, []);
});

test('enforces the aggregate viewport text cap and accepts an intersecting offscreen merge master', async () => {
  const manifest = {
    sheets: [{ id: 0, name: 'Sheet 1', rowCount: 20, columnCount: 4 }],
    acceptedCells: 17,
    coverage: { kind: 'complete' }
  };
  const accepted = await loadSession(manifest);
  const acceptedPromise = accepted.session.requestViewport(0, 2, 3, 2, 3);
  const acceptedRequest = await waitForMessage(accepted.worker, 'viewport');
  accepted.worker.emit(responseFor(acceptedRequest, { type: 'viewport', viewport: validViewport }));
  assert.deepEqual(await acceptedPromise, validViewport);
  accepted.session.dispose();

  const rejected = await loadSession(manifest);
  const rejectedPromise = rejected.session.requestViewport(0, 1, 20, 1, 1);
  const rejectedRequest = await waitForMessage(rejected.worker, 'viewport');
  const oversizedTextModel = {
    sheetId: 0,
    rowStart: 1,
    rowEnd: 20,
    columnStart: 1,
    columnEnd: 1,
    cells: Array.from({ length: 17 }, (_, index) => ({
      row: index + 1,
      column: 1,
      text: 'x'.repeat(1_048_576)
    })),
    merges: []
  };
  rejected.worker.emit(
    responseFor(rejectedRequest, { type: 'viewport', viewport: oversizedTextModel })
  );
  await rejectTerminal(rejectedPromise, rejected.session, rejected.worker);
});

test('validates search counts, target coordinates, and exact manifest coverage', async () => {
  const invalidResults = [
    { ...validSearchResult, total: 5 },
    { ...validSearchResult, active: 0 },
    { ...validSearchResult, target: null },
    { ...validSearchResult, target: { sheetId: 0, row: 5, column: 1 } },
    {
      ...validSearchResult,
      coverage: {
        kind: 'partial',
        reason: 'sheet-model-cap',
        acceptedSheets: 1,
        acceptedCells: 4
      }
    },
    {
      total: 0,
      active: 0,
      coverage: { kind: 'complete' },
      target: { sheetId: 0, row: 1, column: 1 }
    }
  ];

  for (const result of invalidResults) {
    const current = await loadSession();
    const promise = current.session.query('needle', false);
    const request = await waitForMessage(current.worker, 'search');
    current.worker.emit(responseFor(request, { type: 'search', result }));
    await rejectTerminal(promise, current.session, current.worker);
  }
});

test('ignores stale identities but terminally rejects wrong request ids and response types', async () => {
  for (const malformedResponse of [
    (request) => ({ requestId: request.requestId, type: 'layout', layout: validLayout }),
    (request) =>
      responseFor(request, { type: 'layout', layout: validLayout }, { selectionRevision: '17' })
  ]) {
    const malformedIdentity = await loadSession();
    const malformedPromise = malformedIdentity.session.requestLayout(0);
    const malformedRequest = await waitForMessage(malformedIdentity.worker, 'layout');
    malformedIdentity.worker.emit(malformedResponse(malformedRequest));
    await rejectTerminal(malformedPromise, malformedIdentity.session, malformedIdentity.worker);
  }

  const stale = await loadSession();
  const stalePromise = stale.session.requestLayout(0);
  const staleRequest = await waitForMessage(stale.worker, 'layout');
  stale.worker.emit(
    responseFor(
      staleRequest,
      { type: 'layout', layout: { ...validLayout, rowCount: 99 } },
      { workerGeneration: staleRequest.workerGeneration + 1 }
    )
  );
  let staleSettled = false;
  void stalePromise.finally(() => {
    staleSettled = true;
  });
  await nextTurn();
  assert.equal(staleSettled, false);
  stale.worker.emit(responseFor(staleRequest, { type: 'layout', layout: validLayout }));
  assert.deepEqual(await stalePromise, validLayout);
  stale.session.dispose();

  const wrongRequest = await loadSession();
  const wrongRequestPromise = wrongRequest.session.requestLayout(0);
  const request = await waitForMessage(wrongRequest.worker, 'layout');
  wrongRequest.worker.emit(
    responseFor(
      request,
      { type: 'layout', layout: validLayout },
      { requestId: request.requestId + 1 }
    )
  );
  await rejectTerminal(wrongRequestPromise, wrongRequest.session, wrongRequest.worker);

  const wrongType = await loadSession();
  const wrongTypePromise = wrongType.session.requestLayout(0);
  const typeRequest = await waitForMessage(wrongType.worker, 'layout');
  wrongType.worker.emit(responseFor(typeRequest, { type: 'search', result: validSearchResult }));
  await rejectTerminal(wrongTypePromise, wrongType.session, wrongType.worker);
});
