/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(new URL(import.meta.url).pathname), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-onlypreview-office-ooxml-'));
const bundlePath = join(buildRoot, 'office-session.mjs');
const source = (relativePath) => readFileSync(join(projectRoot, relativePath), 'utf8');

const viewerExports = {
  xlsx: 'XlsxViewer',
  docx: 'DocxScrollViewer',
  pptx: 'PptxScrollViewer'
};

await build({
  entryPoints: [
    join(projectRoot, 'src/renderer/onlypreview/preview/src/onlyPreviewOfficeSession.service.ts')
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
      name: 'onlypreview-ooxml-viewer-stubs',
      setup(pluginBuild) {
        pluginBuild.onResolve({ filter: /^@silurus\/ooxml\/(xlsx|docx|pptx)$/ }, (args) => ({
          path: args.path.slice(args.path.lastIndexOf('/') + 1),
          namespace: 'onlypreview-ooxml-stub'
        }));
        pluginBuild.onLoad({ filter: /.*/, namespace: 'onlypreview-ooxml-stub' }, (args) => {
          const exportName = viewerExports[args.path];
          assert.ok(exportName, `Unexpected OOXML test subpath: ${args.path}`);
          return {
            loader: 'js',
            contents: `
              export class ${exportName} {
                constructor(container, options) {
                  return globalThis.__onlyPreviewOfficeOoxmlHarness.createViewer(
                    '${args.path}',
                    container,
                    options
                  );
                }
              }
            `
          };
        });
      }
    }
  ]
});

const { OnlyPreviewOfficeSession } = await import(pathToFileURL(bundlePath).href);

after(() => {
  delete globalThis.__onlyPreviewOfficeOoxmlHarness;
  rmSync(buildRoot, { recursive: true, force: true });
});

const makeZipBytes = () => new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]);
const completeXlsxCompatibility = Object.freeze({
  macroEnabled: false,
  worksheetCount: 1,
  missingSheetDataCount: 0,
  requiresSheetDataNormalization: false
});
const missingSheetDataCompatibility = Object.freeze({
  macroEnabled: false,
  worksheetCount: 1,
  missingSheetDataCount: 1,
  requiresSheetDataNormalization: true
});

const tick = () => new Promise((resolveTick) => setImmediate(resolveTick));

const waitFor = async (predicate, message) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await tick();
  }
  assert.fail(message);
};

const withFakeTimers = async (operation) => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const timers = [];
  globalThis.setTimeout = (callback, delay, ...args) => {
    const timer = { active: true, args, callback, delay };
    timers.push(timer);
    return timer;
  };
  globalThis.clearTimeout = (timer) => {
    if (timer && typeof timer === 'object') timer.active = false;
  };
  try {
    return await operation(timers);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
};

const fireTimer = (timer) => {
  assert.equal(timer.active, true);
  timer.active = false;
  timer.callback(...timer.args);
};

const deferred = () => {
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolveDeferred, rejectDeferred) => {
    resolvePromise = resolveDeferred;
    rejectPromise = rejectDeferred;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
};

const command = (overrides = {}) => ({
  hostId: 'office-host',
  selectionRevision: 17,
  surface: 'vue',
  findRevision: 1,
  adapter: 'office',
  query: 'needle',
  caseSensitive: false,
  direction: 'forward',
  findNext: true,
  ...overrides
});

const createHarness = (kind, options = {}) => {
  const events = {
    clearFind: 0,
    destroy: 0,
    findNext: 0,
    findPrev: 0,
    findText: [],
    lifecycle: [],
    layoutWaits: 0,
    loads: [],
    compatibilityWorkerRequests: [],
    compatibilityWorkerTerminations: 0,
    replaceChildren: 0,
    viewerConstructions: [],
    workerRequests: [],
    workerTerminations: 0
  };
  let activeMatch = -1;
  const matches = [{ matchIndex: 0 }, { matchIndex: 1 }, { matchIndex: 2 }];
  // The real viewers publish their first laid-out unit before load() resolves and keep laying the
  // rest out afterwards. `publishOnLayout` models the opposite: nothing is published until the
  // full-document barrier resolves.
  const laidOutUnits = kind === 'pptx' ? 3 : 2;
  let publishedUnits = options.empty || options.publishOnLayout ? 0 : laidOutUnits;
  const viewer = {
    sheetNames: options.empty ? [] : ['Sheet 1'],
    get pageCount() {
      return publishedUnits;
    },
    get slideCount() {
      return publishedUnits;
    },
    async load(bytes) {
      events.loads.push(bytes.byteLength);
      events.lifecycle.push('viewer-load');
      if (options.loadGate) await options.loadGate.promise;
      if (options.loadError) {
        throw options.loadError instanceof Error
          ? options.loadError
          : new Error('viewer load failed');
      }
    },
    async waitUntilLayoutComplete() {
      events.layoutWaits += 1;
      if (options.layoutGate) await options.layoutGate.promise;
      if (options.layoutError) throw options.layoutError;
      if (options.publishOnLayout && !options.empty) publishedUnits = laidOutUnits;
    },
    async findText(query, findOptions) {
      events.findText.push({ query, options: findOptions });
      activeMatch = -1;
      if (options.findGate) return options.findGate.promise;
      if (options.findError) throw new Error('viewer find failed');
      return query ? matches : [];
    },
    async findNext() {
      events.findNext += 1;
      activeMatch = (activeMatch + 1) % matches.length;
      return matches[activeMatch];
    },
    async findPrev() {
      events.findPrev += 1;
      activeMatch = activeMatch <= 0 ? matches.length - 1 : activeMatch - 1;
      return matches[activeMatch];
    },
    clearFind() {
      events.clearFind += 1;
      activeMatch = -1;
    },
    destroy() {
      events.destroy += 1;
    }
  };
  const container = {
    replaceChildren() {
      events.replaceChildren += 1;
    }
  };

  let preflightRequestIndex = 0;
  class FakeWorker {
    listeners = new Map();

    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) ?? [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }

    postMessage(request, transfer) {
      events.workerRequests.push({ request, transfer });
      const response = options.preflightResponses?.[preflightRequestIndex] ?? {};
      preflightRequestIndex += 1;
      events.lifecycle.push(`preflight-${request.requestId}`);
      if (response.silent) return;
      const publish = () => {
        for (const listener of this.listeners.get('message') ?? []) {
          listener({
            data:
              response.type === 'error'
                ? { ...request, type: 'error', errorCode: response.errorCode }
                : {
                    ...request,
                    ...(response.identity ?? {}),
                    type: 'ready',
                    bytes: response.bytes ?? request.bytes,
                    totalUncompressedBytes:
                      response.totalUncompressedBytes ?? request.bytes.byteLength,
                    ...(request.kind === 'xlsx'
                      ? {
                          xlsxCompatibility: response.xlsxCompatibility ?? completeXlsxCompatibility
                        }
                      : {})
                  }
          });
        }
      };
      if (response.gate) void response.gate.promise.then(publish);
      else queueMicrotask(publish);
    }

    terminate() {
      events.workerTerminations += 1;
    }
  }

  class FakeCompatibilityWorker {
    listeners = new Map();

    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) ?? [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }

    postMessage(request, transfer) {
      events.compatibilityWorkerRequests.push({ request, transfer });
      events.lifecycle.push('compatibility-normalize');
      const response = options.compatibilityResponse ?? {};
      if (response.silent) return;
      const publish = () => {
        if (response.event) {
          for (const listener of this.listeners.get(response.event) ?? []) listener({});
          return;
        }
        const bytes = response.bytes ?? makeZipBytes().buffer;
        for (const listener of this.listeners.get('message') ?? []) {
          listener({
            data:
              response.type === 'error'
                ? { ...request, type: 'error', errorCode: response.errorCode }
                : {
                    ...request,
                    ...(response.identity ?? {}),
                    type: 'ready',
                    bytes
                  }
          });
        }
      };
      if (response.gate) void response.gate.promise.then(publish);
      else queueMicrotask(publish);
    }

    terminate() {
      events.compatibilityWorkerTerminations += 1;
    }
  }

  globalThis.__onlyPreviewOfficeOoxmlHarness = {
    createViewer(viewerKind, viewerContainer, viewerOptions) {
      events.lifecycle.push('viewer-construction');
      events.viewerConstructions.push({
        kind: viewerKind,
        container: viewerContainer,
        viewerOptions
      });
      if (options.constructorError) viewerOptions.onError(options.constructorError);
      return viewer;
    }
  };

  const bytes = options.sourceBytes ?? makeZipBytes();
  const runtimeErrors = [];
  const session = new OnlyPreviewOfficeSession({
    hostId: 'office-host',
    selectionRevision: 17,
    kind,
    sourceExtension: options.sourceExtension ?? `.${kind}`,
    expectedSize: bytes.byteLength,
    readBytes: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    workerFactory: () => new FakeWorker(),
    compatibilityWorkerFactory: () => new FakeCompatibilityWorker(),
    onRuntimeError: (errorCode) => runtimeErrors.push(errorCode)
  });
  return { container, events, runtimeErrors, session, viewer };
};

const assertDiagnosticContext = (diagnostic, events, expected = {}) => {
  assert.equal(diagnostic.runtimeId, events.workerRequests[0].request.runtimeId);
  assert.equal(diagnostic.selectionRevision, 17);
  assert.equal(Number.isSafeInteger(diagnostic.elapsedMs), true);
  assert.ok(diagnostic.elapsedMs >= 0);
  assert.deepEqual(
    {
      kind: diagnostic.kind,
      phase: diagnostic.phase,
      name: diagnostic.name,
      ...(diagnostic.code ? { code: diagnostic.code } : {}),
      message: diagnostic.message
    },
    expected
  );
};

for (const kind of ['xlsx', 'docx', 'pptx']) {
  test(`${kind} mounts its bounded host-2D OOXML viewer and delegates persistent Find`, async () => {
    const { container, events, runtimeErrors, session } = createHarness(kind);
    await session.mount(container);

    assert.equal(events.viewerConstructions.length, 1);
    const construction = events.viewerConstructions[0];
    assert.equal(construction.kind, kind);
    assert.equal(construction.container, container);
    assert.equal(construction.viewerOptions.mode, 'main');
    assert.equal(construction.viewerOptions.useGoogleFonts, false);
    assert.equal(construction.viewerOptions.enableHyperlinks, false);
    assert.deepEqual(construction.viewerOptions.resourceLimits, {
      maxArchiveEntries: 5_000,
      maxArchiveEntryBytes: 64 * 1024 * 1024,
      maxTotalInflatedBytes: 128 * 1024 * 1024
    });
    assert.notEqual(
      construction.viewerOptions.findHighlightColors.match,
      construction.viewerOptions.findHighlightColors.active
    );
    if (kind === 'xlsx') {
      assert.equal(construction.viewerOptions.showZoomSlider, false);
      assert.equal(session.supportsTextSelection, false);
      assert.equal(events.layoutWaits, 0);
    } else {
      assert.equal(construction.viewerOptions.enableTextSelection, true);
      assert.equal(construction.viewerOptions.progressiveLayout, true);
      assert.equal(session.supportsTextSelection, true);
      assert.equal(events.layoutWaits, 1);
    }
    if (kind === 'pptx') assert.equal(construction.viewerOptions.enableMediaPlayback, false);

    assert.equal(events.loads.length, 1);
    assert.equal(events.workerRequests.length, 1);
    assert.equal(events.workerRequests[0].request.kind, kind);
    assert.equal(events.workerRequests[0].transfer.length, 1);
    assert.equal(events.workerTerminations, 1);

    assert.deepEqual(await session.execute(command()), {
      activeMatchOrdinal: 1,
      matches: 3,
      finalUpdate: true,
      coverage: { kind: 'complete' }
    });
    assert.deepEqual(events.findText, [{ query: 'needle', options: { caseSensitive: false } }]);
    assert.equal(events.findNext, 1);

    assert.equal(
      (await session.execute(command({ findRevision: 2, findNext: false }))).activeMatchOrdinal,
      2
    );
    assert.equal(events.findText.length, 1, 'navigation must retain all-match highlights');
    assert.equal(events.findNext, 2);

    assert.equal(
      (await session.execute(command({ findRevision: 3, findNext: false, direction: 'backward' })))
        .activeMatchOrdinal,
      1
    );
    assert.equal(events.findPrev, 1);

    assert.equal(
      (
        await session.execute(
          command({ findRevision: 4, query: 'replacement', caseSensitive: true })
        )
      ).activeMatchOrdinal,
      1
    );
    assert.deepEqual(events.findText.at(-1), {
      query: 'replacement',
      options: { caseSensitive: true }
    });
    assert.ok(events.clearFind >= 2, 'new queries clear the previous viewer search state');

    session.clear();
    const clearsBeforeDispose = events.clearFind;
    session.dispose();
    session.dispose();
    assert.equal(events.clearFind, clearsBeforeDispose + 1);
    assert.equal(events.destroy, 1);
    assert.equal(events.replaceChildren, 1);
    assert.deepEqual(runtimeErrors, []);
  });
}

test('missing sheetData normalizes before any Viewer and retains OOXML Find', async () => {
  const { container, events, runtimeErrors, session } = createHarness('xlsx', {
    preflightResponses: [
      { xlsxCompatibility: missingSheetDataCompatibility },
      { xlsxCompatibility: completeXlsxCompatibility }
    ]
  });
  await session.mount(container);

  assert.deepEqual(events.lifecycle, [
    'preflight-1',
    'compatibility-normalize',
    'preflight-2',
    'viewer-construction',
    'viewer-load'
  ]);
  assert.equal(events.workerRequests.length, 2);
  assert.equal(events.compatibilityWorkerRequests.length, 1);
  assert.equal(events.compatibilityWorkerRequests[0].transfer.length, 1);
  assert.equal(
    events.compatibilityWorkerRequests[0].request.bytes,
    events.compatibilityWorkerRequests[0].transfer[0]
  );
  assert.equal(events.compatibilityWorkerTerminations, 1);
  assert.equal(events.viewerConstructions.length, 1);
  assert.equal(events.loads.length, 1);
  assert.deepEqual(await session.execute(command()), {
    activeMatchOrdinal: 1,
    matches: 3,
    finalUpdate: true,
    coverage: { kind: 'complete' }
  });
  assert.deepEqual(runtimeErrors, []);
  session.dispose();
});

test('ordinary XLSX never starts the compatibility Worker', async () => {
  const { container, events, session } = createHarness('xlsx');
  await session.mount(container);
  assert.equal(events.workerRequests.length, 1);
  assert.equal(events.compatibilityWorkerRequests.length, 0);
  assert.equal(events.viewerConstructions.length, 1);
  session.dispose();
});

test('an XLSM source without a compatibility marker still mounts the OOXML viewer', async () => {
  const { container, events, session } = createHarness('xlsx', {
    sourceExtension: '.xlsm'
  });
  await session.mount(container);
  assert.equal(events.compatibilityWorkerRequests.length, 0);
  assert.equal(events.viewerConstructions.length, 1);
  assert.equal(events.loads.length, 1);
  session.dispose();
});

test('malformed initial preflight error codes map to each Office format parse failure', async () => {
  const originalWarn = console.warn;
  console.warn = () => undefined;
  try {
    for (const [kind, expectedCode] of [
      ['xlsx', 'SHEET_PARSE_FAILED'],
      ['docx', 'DOCUMENT_PARSE_FAILED'],
      ['pptx', 'PRESENTATION_PARSE_FAILED']
    ]) {
      const { container, events, session } = createHarness(kind, {
        preflightResponses: [{ type: 'error', errorCode: 'UNTRUSTED_PREFLIGHT_CODE' }]
      });
      await assert.rejects(session.mount(container), (error) => error?.code === expectedCode);
      assert.equal(events.viewerConstructions.length, 0);
      session.dispose();
    }
  } finally {
    console.warn = originalWarn;
  }
});

test('macro and multi-sheet missing-sheetData workbooks fail closed without normalization', async () => {
  for (const compatibility of [
    { ...missingSheetDataCompatibility, macroEnabled: true },
    {
      ...missingSheetDataCompatibility,
      worksheetCount: 2,
      missingSheetDataCount: 1
    }
  ]) {
    const originalWarn = console.warn;
    console.warn = () => undefined;
    try {
      const { container, events, session } = createHarness('xlsx', {
        preflightResponses: [{ xlsxCompatibility: compatibility }]
      });
      await assert.rejects(
        session.mount(container),
        (error) => error?.code === 'SHEET_PARSE_FAILED'
      );
      assert.equal(events.compatibilityWorkerRequests.length, 0);
      assert.equal(events.viewerConstructions.length, 0);
      session.dispose();
    } finally {
      console.warn = originalWarn;
    }
  }
});

test('an explicit XLSM source never normalizes when content-type scanning misses an entity encoding', async () => {
  const originalWarn = console.warn;
  console.warn = () => undefined;
  try {
    const { container, events, session } = createHarness('xlsx', {
      sourceExtension: '.xlsm',
      preflightResponses: [
        {
          xlsxCompatibility: {
            ...missingSheetDataCompatibility,
            macroEnabled: false
          }
        }
      ]
    });
    await assert.rejects(session.mount(container), (error) => error?.code === 'SHEET_PARSE_FAILED');
    assert.equal(events.compatibilityWorkerRequests.length, 0);
    assert.equal(events.viewerConstructions.length, 0);
    session.dispose();
  } finally {
    console.warn = originalWarn;
  }
});

test('the compatibility path enforces compressed, inflated, and normalized memory gates', async () => {
  for (const [options, expectedWorkers] of [
    [
      {
        sourceBytes: new Uint8Array(4 * 1024 * 1024 + 1).fill(0x50),
        preflightResponses: [{ xlsxCompatibility: missingSheetDataCompatibility }]
      },
      0
    ],
    [
      {
        preflightResponses: [
          {
            xlsxCompatibility: missingSheetDataCompatibility,
            totalUncompressedBytes: 8 * 1024 * 1024 + 1
          }
        ]
      },
      0
    ],
    [
      {
        preflightResponses: [{ xlsxCompatibility: missingSheetDataCompatibility }],
        compatibilityResponse: { bytes: new ArrayBuffer(4 * 1024 * 1024 + 1) }
      },
      1
    ]
  ]) {
    options.sourceBytes?.set([0x50, 0x4b, 0x03, 0x04], 0);
    const originalWarn = console.warn;
    console.warn = () => undefined;
    try {
      const { container, events, session } = createHarness('xlsx', options);
      await assert.rejects(
        session.mount(container),
        (error) => error?.code === 'OOXML_ARCHIVE_LIMIT'
      );
      assert.equal(events.compatibilityWorkerRequests.length, expectedWorkers);
      assert.equal(events.viewerConstructions.length, 0);
      session.dispose();
    } finally {
      console.warn = originalWarn;
    }
  }
});

test('a normalized archive is preflighted once more and cannot recurse', async () => {
  const originalWarn = console.warn;
  console.warn = () => undefined;
  try {
    const { container, events, session } = createHarness('xlsx', {
      preflightResponses: [
        { xlsxCompatibility: missingSheetDataCompatibility },
        { xlsxCompatibility: missingSheetDataCompatibility }
      ]
    });
    await assert.rejects(session.mount(container), (error) => error?.code === 'SHEET_PARSE_FAILED');
    assert.equal(events.workerRequests.length, 2);
    assert.equal(events.compatibilityWorkerRequests.length, 1);
    assert.equal(events.viewerConstructions.length, 0);
    session.dispose();
  } finally {
    console.warn = originalWarn;
  }
});

test('a malformed second preflight error is fenced as a parse failure with a truthful phase', async () => {
  const originalWarn = console.warn;
  const diagnostics = [];
  console.warn = (...args) => diagnostics.push(args);
  try {
    const { container, events, session } = createHarness('xlsx', {
      preflightResponses: [
        { xlsxCompatibility: missingSheetDataCompatibility },
        { type: 'error', errorCode: 'UNTRUSTED_PREFLIGHT_CODE' }
      ]
    });
    await assert.rejects(session.mount(container), (error) => error?.code === 'SHEET_PARSE_FAILED');
    assert.equal(events.workerRequests.length, 2);
    assert.equal(events.compatibilityWorkerRequests.length, 1);
    assert.equal(events.viewerConstructions.length, 0);
    assert.equal(diagnostics.length, 1);
    assert.equal(JSON.parse(diagnostics[0][1]).phase, 'compatibility-preflight');
    session.dispose();
  } finally {
    console.warn = originalWarn;
  }
});

test('a malformed compatibility Worker error code fails closed as a sheet parse failure', async () => {
  const originalWarn = console.warn;
  console.warn = () => undefined;
  try {
    const { container, events, session } = createHarness('xlsx', {
      preflightResponses: [{ xlsxCompatibility: missingSheetDataCompatibility }],
      compatibilityResponse: { type: 'error', errorCode: 'UNTRUSTED_WORKER_CODE' }
    });
    await assert.rejects(session.mount(container), (error) => error?.code === 'SHEET_PARSE_FAILED');
    assert.equal(events.compatibilityWorkerTerminations, 1);
    assert.equal(events.workerRequests.length, 1);
    assert.equal(events.viewerConstructions.length, 0);
    session.dispose();
  } finally {
    console.warn = originalWarn;
  }
});

test('compatibility response identity is fenced and its ten-second deadline is non-renewing', async () => {
  const originalWarn = console.warn;
  console.warn = () => undefined;
  try {
    await withFakeTimers(async (timers) => {
      const { container, events, session } = createHarness('xlsx', {
        preflightResponses: [{ xlsxCompatibility: missingSheetDataCompatibility }],
        compatibilityResponse: { identity: { selectionRevision: 18 } }
      });
      const mounting = session.mount(container);
      await waitFor(
        () => events.compatibilityWorkerRequests.length === 1,
        'compatibility Worker did not start'
      );
      await tick();
      const deadline = timers.find((timer) => timer.active && timer.delay === 10_000);
      assert.ok(deadline, 'compatibility deadline must remain armed after a stale response');
      fireTimer(deadline);
      await assert.rejects(mounting, (error) => error?.code === 'SHEET_RENDER_TIMEOUT');
      assert.equal(events.compatibilityWorkerTerminations, 1);
      assert.equal(events.workerRequests.length, 1);
      assert.equal(events.viewerConstructions.length, 0);
      session.dispose();
    });
  } finally {
    console.warn = originalWarn;
  }
});

test('disposing a pending compatibility Worker terminates it and ignores late completion', async () => {
  const originalWarn = console.warn;
  const diagnostics = [];
  console.warn = (...args) => diagnostics.push(args);
  try {
    const gate = deferred();
    const { container, events, runtimeErrors, session } = createHarness('xlsx', {
      preflightResponses: [{ xlsxCompatibility: missingSheetDataCompatibility }],
      compatibilityResponse: { gate }
    });
    const mounting = session.mount(container);
    await waitFor(
      () => events.compatibilityWorkerRequests.length === 1,
      'compatibility Worker did not start'
    );
    session.dispose();
    const rejection = assert.rejects(mounting, (error) => error?.code === 'SHEET_RENDER_TIMEOUT');
    gate.resolve();
    await rejection;
    await tick();
    assert.equal(events.compatibilityWorkerTerminations, 1);
    assert.equal(events.workerRequests.length, 1);
    assert.equal(events.viewerConstructions.length, 0);
    assert.deepEqual(runtimeErrors, []);
    assert.deepEqual(diagnostics, []);
  } finally {
    console.warn = originalWarn;
  }
});

for (const event of ['error', 'messageerror']) {
  test(`a compatibility Worker ${event} fails closed once`, async () => {
    const originalWarn = console.warn;
    console.warn = () => undefined;
    try {
      const { container, events, session } = createHarness('xlsx', {
        preflightResponses: [{ xlsxCompatibility: missingSheetDataCompatibility }],
        compatibilityResponse: { event }
      });
      await assert.rejects(
        session.mount(container),
        (error) => error?.code === 'SHEET_PARSE_FAILED'
      );
      assert.equal(events.compatibilityWorkerTerminations, 1);
      assert.equal(events.viewerConstructions.length, 0);
      session.dispose();
    } finally {
      console.warn = originalWarn;
    }
  });
}

test('Office Find clears stale in-flight highlights and rejects the old generation', async () => {
  const findGate = deferred();
  const { container, events, session } = createHarness('pptx', { findGate });
  await session.mount(container);
  const stale = session.execute(command());
  await tick();
  session.clear();
  findGate.resolve([{ matchIndex: 0 }]);
  await assert.rejects(stale);
  assert.ok(events.clearFind >= 2);
  assert.equal(events.findNext, 0, 'a stale query cannot install an active highlight');
  session.dispose();
});

test('Office viewer failures are typed per format and notify Main at most once', async () => {
  for (const [kind, expectedCode] of [
    ['xlsx', 'SHEET_RENDER_FAILED'],
    ['docx', 'DOCUMENT_RENDER_FAILED'],
    ['pptx', 'PRESENTATION_RENDER_FAILED']
  ]) {
    const { container, events, runtimeErrors, session } = createHarness(kind, { findError: true });
    await session.mount(container);
    await assert.rejects(session.execute(command()), (error) => error?.code === expectedCode);
    await assert.rejects(async () => await session.execute(command({ findRevision: 2 })));
    assert.deepEqual(runtimeErrors, [expectedCode]);
    assert.ok(events.clearFind >= 2);
    session.dispose();
  }
});

for (const [kind, expectedCode] of [
  ['xlsx', 'SHEET_RENDER_FAILED'],
  ['docx', 'DOCUMENT_RENDER_FAILED'],
  ['pptx', 'PRESENTATION_RENDER_FAILED']
]) {
  test(`${kind} viewer onError terminates the mounted session exactly once`, async () => {
    const { container, events, runtimeErrors, session } = createHarness(kind);
    await session.mount(container);
    const onError = events.viewerConstructions[0].viewerOptions.onError;
    assert.equal(typeof onError, 'function');
    const clearsBeforeFailure = events.clearFind;

    onError(new Error('late viewer worker failure'));
    onError(new Error('duplicate late viewer worker failure'));
    await tick();

    assert.deepEqual(runtimeErrors, [expectedCode]);
    assert.ok(events.clearFind > clearsBeforeFailure);
    assert.equal(events.destroy, 1);
    assert.equal(events.replaceChildren, 1);
    await assert.rejects(async () => await session.execute(command()));

    onError(new Error('post-disposal viewer failure'));
    session.dispose();
    assert.deepEqual(runtimeErrors, [expectedCode]);
    assert.equal(events.destroy, 1);
    assert.equal(events.replaceChildren, 1);
  });
}

test('a constructor-time Viewer error is correlated, sanitized, and fails closed once', async () => {
  const originalWarn = console.warn;
  const diagnostics = [];
  console.warn = (...args) => diagnostics.push(args);
  try {
    const constructorError = Object.assign(
      new Error(
        'bitmaprenderer context not available for bitterless-preview://asset/private/workbook.xlsx query needle'
      ),
      { code: 'renderer-unavailable' }
    );
    const { container, events, runtimeErrors, session } = createHarness('xlsx', {
      constructorError
    });

    await assert.rejects(
      session.mount(container),
      (error) => error?.code === 'SHEET_RENDER_FAILED'
    );
    await tick();

    assert.deepEqual(runtimeErrors, ['SHEET_RENDER_FAILED']);
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0][0], '[OnlyPreview][office]');
    assertDiagnosticContext(JSON.parse(diagnostics[0][1]), events, {
      kind: 'xlsx',
      phase: 'render',
      name: 'Error',
      code: 'renderer-unavailable',
      message: 'The browser bitmap renderer is unavailable.'
    });
    assert.doesNotMatch(
      diagnostics[0][1],
      /bitterless-preview|private|workbook\.xlsx|query|needle/
    );
    assert.equal(events.workerTerminations, 1);
    assert.equal(events.destroy, 1);
    assert.equal(events.replaceChildren, 1);
    assert.throws(
      () => session.execute(command()),
      (error) => error?.code === 'SHEET_RENDER_FAILED'
    );

    await tick();
    assert.deepEqual(runtimeErrors, ['SHEET_RENDER_FAILED']);
    assert.equal(diagnostics.length, 1);
    assert.equal(events.destroy, 1);
  } finally {
    console.warn = originalWarn;
  }
});

test('disposing while an Office load is pending cannot publish a late ready or runtime error', async () => {
  const originalWarn = console.warn;
  const diagnostics = [];
  console.warn = (...args) => diagnostics.push(args);
  try {
    const loadGate = deferred();
    const { container, events, runtimeErrors, session } = createHarness('xlsx', { loadGate });
    const mounting = session.mount(container);
    await waitFor(() => events.loads.length === 1, 'Office load did not start');

    session.dispose();
    const rejection = assert.rejects(mounting, (error) => error?.code === 'SHEET_RENDER_TIMEOUT');
    loadGate.resolve();
    await rejection;
    await tick();

    assert.deepEqual(runtimeErrors, []);
    assert.deepEqual(diagnostics, []);
    assert.equal(events.workerTerminations, 1);
    assert.equal(events.destroy, 1);
    assert.equal(events.replaceChildren, 1);
  } finally {
    console.warn = originalWarn;
  }
});

for (const [kind, expectedCode] of [
  ['docx', 'DOCUMENT_RENDER_TIMEOUT'],
  ['pptx', 'PRESENTATION_RENDER_TIMEOUT']
]) {
  test(`disposing while ${kind} layout is pending cannot publish a late ready or runtime error`, async () => {
    const originalWarn = console.warn;
    const diagnostics = [];
    console.warn = (...args) => diagnostics.push(args);
    try {
      const layoutGate = deferred();
      const { container, events, runtimeErrors, session } = createHarness(kind, { layoutGate });
      const mounting = session.mount(container);
      await waitFor(() => events.layoutWaits === 1, `${kind} layout did not start`);

      session.dispose();
      const rejection = assert.rejects(mounting, (error) => error?.code === expectedCode);
      layoutGate.resolve();
      await rejection;
      await tick();

      assert.deepEqual(runtimeErrors, []);
      assert.deepEqual(diagnostics, []);
      assert.equal(events.workerTerminations, 1);
      assert.equal(events.destroy, 1);
      assert.equal(events.replaceChildren, 1);
    } finally {
      console.warn = originalWarn;
    }
  });
}

for (const [kind, expectedCode] of [
  ['xlsx', 'SHEET_RENDER_FAILED'],
  ['docx', 'DOCUMENT_RENDER_FAILED'],
  ['pptx', 'PRESENTATION_RENDER_FAILED']
]) {
  test(`${kind} load failures are render failures rather than parse failures`, async () => {
    const originalWarn = console.warn;
    const diagnostics = [];
    console.warn = (...args) => diagnostics.push(args);
    try {
      const { container, events, session } = createHarness(kind, { loadError: true });
      await assert.rejects(session.mount(container), (error) => error?.code === expectedCode);
      assert.equal(diagnostics.length, 1);
      assert.equal(diagnostics[0][0], '[OnlyPreview][office]');
      assertDiagnosticContext(JSON.parse(diagnostics[0][1]), events, {
        kind,
        phase: 'load',
        name: 'Error',
        message: 'The OOXML Viewer reported an unclassified failure.'
      });
      session.dispose();
    } finally {
      console.warn = originalWarn;
    }
  });
}

test('Office async viewer diagnostics forward the Error but never log its path-bearing message', async () => {
  const originalWarn = console.warn;
  const originalNow = globalThis.performance.now;
  const diagnostics = [];
  let monotonicNow = 100;
  console.warn = (...args) => diagnostics.push(args);
  globalThis.performance.now = () => monotonicNow;
  try {
    const { container, events, runtimeErrors, session } = createHarness('xlsx');
    await session.mount(container);
    monotonicNow = 137;
    const error = Object.assign(
      new Error('bitmaprenderer context not available at /private/secret/workbook.xlsx'),
      { code: 'renderer-unavailable' }
    );
    events.viewerConstructions[0].viewerOptions.onError(error);
    await tick();

    assert.deepEqual(runtimeErrors, ['SHEET_RENDER_FAILED']);
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0][0], '[OnlyPreview][office]');
    const diagnostic = JSON.parse(diagnostics[0][1]);
    assertDiagnosticContext(diagnostic, events, {
      kind: 'xlsx',
      phase: 'render',
      name: 'Error',
      code: 'renderer-unavailable',
      message: 'The browser bitmap renderer is unavailable.'
    });
    assert.equal(diagnostic.elapsedMs, 37);
    assert.doesNotMatch(diagnostics[0][1], /private|secret|workbook\.xlsx/);
    session.dispose();
  } finally {
    console.warn = originalWarn;
    globalThis.performance.now = originalNow;
  }
});

test('Office load preserves a typed OOXML resource-limit failure', async () => {
  const originalWarn = console.warn;
  console.warn = () => undefined;
  try {
    const loadError = Object.assign(new Error('decoded resource exceeded'), {
      code: 'ooxml-decoded-image-limit'
    });
    const { container, session } = createHarness('pptx', { loadError });
    await assert.rejects(
      session.mount(container),
      (error) => error?.code === 'OOXML_ARCHIVE_LIMIT'
    );
    session.dispose();
  } finally {
    console.warn = originalWarn;
  }
});

test('a superseded Find deadline terminates its session without clearing replacement highlights', async () => {
  const staleFindGate = deferred();
  const stale = createHarness('pptx', { findGate: staleFindGate });
  await stale.session.mount(stale.container);

  await withFakeTimers(async (timers) => {
    const staleFind = stale.session.execute(command({ query: 'A' }));
    await tick();
    const deadline = timers.find((timer) => timer.active && timer.delay === 10_000);
    assert.ok(deadline, 'the real Find deadline must be armed');

    const supersedingFind = stale.session.execute(command({ findRevision: 2, query: 'B' }));
    const staleFailure = assert.rejects(
      staleFind,
      (error) => error?.code === 'PRESENTATION_RENDER_TIMEOUT'
    );
    const supersedingFailure = assert.rejects(supersedingFind);
    fireTimer(deadline);

    await staleFailure;
    await supersedingFailure;
    assert.deepEqual(stale.runtimeErrors, ['PRESENTATION_RENDER_TIMEOUT']);
    assert.equal(stale.events.destroy, 1);
    assert.equal(stale.events.replaceChildren, 1);

    const replacement = createHarness('pptx');
    await replacement.session.mount(replacement.container);
    assert.deepEqual(await replacement.session.execute(command({ query: 'B' })), {
      activeMatchOrdinal: 1,
      matches: 3,
      finalUpdate: true,
      coverage: { kind: 'complete' }
    });
    const replacementClears = replacement.events.clearFind;

    staleFindGate.resolve([{ matchIndex: 0 }]);
    await tick();
    await tick();
    assert.equal(
      replacement.events.clearFind,
      replacementClears,
      'the late stale viewer must not clear the replacement viewer highlights'
    );
    assert.equal(stale.events.destroy, 1);
    replacement.session.dispose();
  });
});

test('Office admission rejects a mismatched signature before Worker or engine construction', async () => {
  const events = { viewers: 0, workers: 0 };
  globalThis.__onlyPreviewOfficeOoxmlHarness = {
    createViewer() {
      events.viewers += 1;
      throw new Error('engine must not load');
    }
  };
  const session = new OnlyPreviewOfficeSession({
    hostId: 'office-host',
    selectionRevision: 17,
    kind: 'pptx',
    sourceExtension: '.pptx',
    expectedSize: 4,
    readBytes: async () => new Uint8Array([1, 2, 3, 4]).buffer,
    workerFactory: () => {
      events.workers += 1;
      throw new Error('Worker must not start');
    }
  });
  await assert.rejects(
    session.mount({ replaceChildren: () => undefined }),
    (error) => error?.code === 'SIGNATURE_MISMATCH'
  );
  assert.deepEqual(events, { viewers: 0, workers: 0 });
  session.dispose();
});

test('the installed OOXML package exposes the three real viewer modules used by OnlyPreview', async () => {
  for (const [subpath, viewer] of Object.entries(viewerExports)) {
    const module = await import(`@silurus/ooxml/${subpath}`);
    assert.equal(typeof module[viewer], 'function');
    assert.equal(typeof module[viewer].prototype.load, 'function');
    assert.equal(typeof module[viewer].prototype.destroy, 'function');
  }
});

test('Office source contract pins one engine, three lazy subpaths, and the narrow WASM CSP', () => {
  const packageJson = JSON.parse(source('package.json'));
  assert.equal(packageJson.devDependencies['@silurus/ooxml'], '0.83.0');
  assert.equal(packageJson.dependencies?.['@silurus/ooxml'], undefined);
  assert.equal(packageJson.dependencies?.['@aiden0z/pptx-renderer'], undefined);
  assert.equal(packageJson.devDependencies?.['@aiden0z/pptx-renderer'], undefined);
  assert.equal(packageJson.dependencies?.['pptx-renderer'], undefined);
  assert.equal(packageJson.devDependencies?.['pptx-renderer'], undefined);

  const sessionSource = source(
    'src/renderer/onlypreview/preview/src/onlyPreviewOfficeSession.service.ts'
  );
  for (const [subpath, viewer] of [
    ['xlsx', 'XlsxViewer'],
    ['docx', 'DocxScrollViewer'],
    ['pptx', 'PptxScrollViewer']
  ]) {
    assert.match(sessionSource, new RegExp(`import\\('@silurus/ooxml/${subpath}'\\)`));
    assert.match(sessionSource, new RegExp(`new ${viewer}\\(container`));
  }
  assert.match(sessionSource, /const OOXML_RENDER_MODE = 'main' as const/);
  assert.equal(sessionSource.match(/mode: OOXML_RENDER_MODE/g)?.length, 3);
  assert.doesNotMatch(sessionSource, /mode: 'worker'/);
  assert.doesNotMatch(sessionSource, /@aiden0z\/pptx-renderer|from ['"]pptx-renderer/);
  assert.match(sessionSource, /findText\(command\.query/);
  assert.match(sessionSource, /viewer\.findNext\(\)/);
  assert.match(sessionSource, /viewer\.findPrev\(\)/);
  assert.match(sessionSource, /viewer\?\.clearFind\(\)/);
  assert.match(sessionSource, /FIND_TIMEOUT_MS = 10_000/);
  for (const phaseCall of [
    /runOfficePhase\('read'/,
    /runOfficePhase\('preflight'/,
    /'module-import'/,
    /'viewer-construction'/,
    /runOfficePhase\('load'/,
    /runOfficePhase\('layout'/,
    /reportOfficeFailure\('render'/,
    /reportOfficeFailure\('find'/
  ]) {
    assert.match(sessionSource, phaseCall);
  }
  assert.match(sessionSource, /runtimeId: this\.runtimeId/);
  assert.match(sessionSource, /selectionRevision: this\.options\.selectionRevision/);
  assert.match(sessionSource, /elapsedMs/);

  const types = source('src/shared/onlypreview/onlyPreview.types.ts');
  const registry = source('src/shared/onlypreview/onlyPreviewFind.registry.ts');
  for (const adapterId of ['ooxml-xlsx', 'ooxml-docx', 'ooxml-pptx']) {
    assert.match(types, new RegExp(`'${adapterId}'`));
    assert.match(
      registry,
      new RegExp(
        `'${adapterId}': \\{ surface: 'vue', find: \\{ mode: 'content-adapter', adapter: 'office' \\} \\}`
      )
    );
  }
  assert.doesNotMatch(types, /'pptx-renderer'/);
  assert.doesNotMatch(registry, /'pptx-renderer'/);

  const previewHtml = source('src/renderer/onlypreview/preview/index.html');
  assert.match(previewHtml, /script-src 'self' 'wasm-unsafe-eval'/);
  assert.match(previewHtml, /worker-src 'self' blob:/);

  const vite = source('electron.vite.config.ts');
  assert.match(vite, /exclude:\s*\['@silurus\/ooxml'\]/);
});
