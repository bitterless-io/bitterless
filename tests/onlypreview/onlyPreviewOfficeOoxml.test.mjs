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
    join(
      projectRoot,
      'src/renderer/onlypreview/preview/src/onlyPreviewOfficeSession.service.ts'
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

const tick = () => new Promise((resolveTick) => setImmediate(resolveTick));

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
    layoutWaits: 0,
    loads: [],
    replaceChildren: 0,
    viewerConstructions: [],
    workerRequests: [],
    workerTerminations: 0
  };
  let activeMatch = -1;
  const matches = [{ matchIndex: 0 }, { matchIndex: 1 }, { matchIndex: 2 }];
  const viewer = {
    sheetNames: options.empty ? [] : ['Sheet 1'],
    pageCount: options.empty ? 0 : 2,
    slideCount: options.empty ? 0 : 3,
    async load(bytes) {
      events.loads.push(bytes.byteLength);
      if (options.loadError) throw new Error('viewer load failed');
    },
    async waitUntilLayoutComplete() {
      events.layoutWaits += 1;
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

  class FakeWorker {
    listeners = new Map();

    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) ?? [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }

    postMessage(request, transfer) {
      events.workerRequests.push({ request, transfer });
      queueMicrotask(() => {
        for (const listener of this.listeners.get('message') ?? []) {
          listener({ data: { ...request, type: 'ready', bytes: request.bytes } });
        }
      });
    }

    terminate() {
      events.workerTerminations += 1;
    }
  }

  globalThis.__onlyPreviewOfficeOoxmlHarness = {
    createViewer(viewerKind, viewerContainer, viewerOptions) {
      events.viewerConstructions.push({ kind: viewerKind, container: viewerContainer, viewerOptions });
      return viewer;
    }
  };

  const bytes = makeZipBytes();
  const runtimeErrors = [];
  const session = new OnlyPreviewOfficeSession({
    hostId: 'office-host',
    selectionRevision: 17,
    kind,
    assetUrl: `bitterless-preview://asset/${'a'.repeat(64)}/${kind}`,
    expectedSize: bytes.byteLength,
    fetchImpl: async () => new Response(bytes, { status: 200 }),
    workerFactory: () => new FakeWorker(),
    onRuntimeError: (errorCode) => runtimeErrors.push(errorCode)
  });
  return { container, events, runtimeErrors, session, viewer };
};

for (const kind of ['xlsx', 'docx', 'pptx']) {
  test(`${kind} mounts only its bounded worker-mode OOXML viewer and delegates persistent Find`, async () => {
    const { container, events, runtimeErrors, session } = createHarness(kind);
    await session.mount(container);

    assert.equal(events.viewerConstructions.length, 1);
    const construction = events.viewerConstructions[0];
    assert.equal(construction.kind, kind);
    assert.equal(construction.container, container);
    assert.equal(construction.viewerOptions.mode, 'worker');
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
    assert.deepEqual(events.findText, [
      { query: 'needle', options: { caseSensitive: false } }
    ]);
    assert.equal(events.findNext, 1);

    assert.equal(
      (await session.execute(command({ findRevision: 2, findNext: false }))).activeMatchOrdinal,
      2
    );
    assert.equal(events.findText.length, 1, 'navigation must retain all-match highlights');
    assert.equal(events.findNext, 2);

    assert.equal(
      (
        await session.execute(
          command({ findRevision: 3, findNext: false, direction: 'backward' })
        )
      ).activeMatchOrdinal,
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
    ['xlsx', 'SHEET_PARSE_FAILED'],
    ['docx', 'DOCUMENT_PARSE_FAILED'],
    ['pptx', 'PRESENTATION_PARSE_FAILED']
  ]) {
    const { container, events, runtimeErrors, session } = createHarness(kind, { findError: true });
    await session.mount(container);
    await assert.rejects(
      session.execute(command()),
      (error) => error?.code === expectedCode
    );
    await assert.rejects(
      async () => await session.execute(command({ findRevision: 2 }))
    );
    assert.deepEqual(runtimeErrors, [expectedCode]);
    assert.ok(events.clearFind >= 2);
    session.dispose();
  }
});

for (const [kind, expectedCode] of [
  ['xlsx', 'SHEET_PARSE_FAILED'],
  ['docx', 'DOCUMENT_PARSE_FAILED'],
  ['pptx', 'PRESENTATION_PARSE_FAILED']
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

test('a superseded Find deadline terminates its session without clearing replacement highlights', async () => {
  const staleFindGate = deferred();
  const stale = createHarness('pptx', { findGate: staleFindGate });
  await stale.session.mount(stale.container);

  await withFakeTimers(async (timers) => {
    const staleFind = stale.session.execute(command({ query: 'A' }));
    await tick();
    const deadline = timers.find((timer) => timer.active && timer.delay === 10_000);
    assert.ok(deadline, 'the real Find deadline must be armed');

    const supersedingFind = stale.session.execute(
      command({ findRevision: 2, query: 'B' })
    );
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
    assetUrl: `bitterless-preview://asset/${'a'.repeat(64)}/pptx`,
    expectedSize: 4,
    fetchImpl: async () => new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 }),
    workerFactory: () => {
      events.workers += 1;
      throw new Error('Worker must not start');
    }
  });
  await assert.rejects(
    session.mount({ replaceChildren() {} }),
    (error) => error?.code === 'SIGNATURE_MISMATCH'
  );
  assert.deepEqual(events, { viewers: 0, workers: 0 });
  session.dispose();
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
  assert.doesNotMatch(sessionSource, /@aiden0z\/pptx-renderer|from ['"]pptx-renderer/);
  assert.match(sessionSource, /findText\(command\.query/);
  assert.match(sessionSource, /viewer\.findNext\(\)/);
  assert.match(sessionSource, /viewer\.findPrev\(\)/);
  assert.match(sessionSource, /viewer\?\.clearFind\(\)/);
  assert.match(sessionSource, /FIND_TIMEOUT_MS = 10_000/);

  const types = source('src/shared/onlypreview/onlyPreview.types.ts');
  const registry = source('src/shared/onlypreview/onlyPreviewFind.registry.ts');
  for (const adapterId of ['ooxml-xlsx', 'ooxml-docx', 'ooxml-pptx']) {
    assert.match(types, new RegExp(`'${adapterId}'`));
    assert.match(
      registry,
      new RegExp(`'${adapterId}': \\{ surface: 'vue', find: \\{ mode: 'content-adapter', adapter: 'office' \\} \\}`)
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
