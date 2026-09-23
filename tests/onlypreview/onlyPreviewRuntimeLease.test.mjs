import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';

const root = process.cwd();
const nodeRequire = createRequire(import.meta.url);
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

const createHarness = () => {
  const state = { windows: [], calls: [], relays: [], load: null, ready: null, constructorError: null };
  class FakeWindow extends EventEmitter {
    constructor(options) {
      super();
      if (state.constructorError) throw state.constructorError;
      this.options = options;
      this.destroyed = false;
      this.webContents = new EventEmitter();
      this.webContents.setWindowOpenHandler = () => {};
      state.windows.push(this);
    }
    setMenuBarVisibility() {}
    loadFile() { return state.load?.() ?? Promise.resolve(); }
    loadURL() { return this.loadFile(); }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; this.emit('closed'); }
  }
  const relay = {
    attach(params) { state.relays.push(params); },
    detach() { state.calls.push({ kind: 'relay', method: 'detach' }); }
  };
  const createClient = (handler) => {
    const kind = handler.split('_')[0];
    return new Proxy({}, {
      get(_target, method) {
        return async (params) => {
          state.calls.push({ kind, method, params });
          if (method === 'ready') return await (state.ready?.(kind) ?? Promise.resolve({ ok: true }));
          if (method === 'inspectTarget') return {
            ok: true,
            value: { rootRealPath: '/outside', displayPath: '/outside', rootName: 'outside', selectedRelativePath: 'invoice.pdf' }
          };
          if (method === 'bindWorkspace' || method === 'cancel') return { ok: true, value: undefined };
          throw new Error(`Unexpected XPC method ${kind}.${String(method)}`);
        };
      }
    });
  };
  const diagnostics = { nextTag: () => 'test', now: () => 0, elapsed: () => 0, emit() {} };
  const modules = new Map();
  const load = (file) => {
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} };
    modules.set(file, module);
    const localRequire = (specifier) => {
      if (specifier === 'electron') return { BrowserWindow: FakeWindow };
      if (specifier === 'electron-xpc/main') return { createXpcMainEmitter: createClient };
      if (specifier === '@electron-toolkit/utils') return { is: { dev: false } };
      if (specifier === '@main/diagnostics/disableSwitches') return { skipDisabled: () => false };
      if (specifier.endsWith('/fileSearchRuntimeRelay.service') || specifier === './fileSearchRuntimeRelay.service') return { fileSearchRuntimeRelayService: relay };
      if (specifier.endsWith('/fileSearchRuntimeEvent.handler') || specifier === './fileSearchRuntimeEvent.handler') return { registerFileSearchRuntimeEventHandler() {} };
      if (specifier.endsWith('/onlyPreviewSearchDiagnostics.mjs')) return { createOnlyPreviewSearchDiagnostics: () => diagnostics };
      if (specifier.startsWith('node:')) return nodeRequire(specifier);
      const relative = specifier.startsWith('@shared/')
        ? join(root, 'src/shared', specifier.slice('@shared/'.length))
        : specifier.startsWith('@main/')
          ? join(root, 'src/main', specifier.slice('@main/'.length))
          : resolve(dirname(file), specifier);
      const target = existsSync(relative) ? relative : `${relative}.ts`;
      return load(target);
    };
    const result = ts.transpileModule(readFileSync(file, 'utf8'), {
      fileName: file,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
    });
    new Function('require', 'module', 'exports', '__dirname', result.outputText)(localRequire, module, module.exports, dirname(file));
    return module.exports;
  };
  const { FileSearchWindowService } = load(join(root, 'src/main/fileSearch/fileSearchWindow.service.ts'));
  return { state, service: new FileSearchWindowService(diagnostics) };
};

const workspace = (id = 'workspace', failures = []) => ({
  host: { hostId: id, hostToken: `${id}-token` },
  bootstrapToken: `${id}-bootstrap`,
  broadcast() {},
  onUnexpectedExit: reason => failures.push(reason)
});

test('cold read lease starts hidden authority and both readers without a Workspace/index', async () => {
  const { state, service } = createHarness();
  const release = await service.acquirePreviewRuntime();
  assert.equal(state.windows.length, 1);
  assert.equal(state.windows[0].options.show, false);
  assert.equal(state.relays.length, 0);
  assert.deepEqual(state.calls.filter(call => call.method === 'ready').map(call => call.kind), [
    'FileSearchRuntime', 'OnlyPreviewOfficeReadRuntime', 'OnlyPreviewFileAuthorityRuntime', 'OnlyPreviewPreviewReadRuntime'
  ]);
  assert.equal(state.calls.some(call => call.method === 'initialize' || call.method === 'bindWorkspace'), false);
  assert.equal((await service.inspectTarget('/outside/invoice.pdf')).selectedRelativePath, 'invoice.pdf');
  release();
  assert.equal(service.hasLiveRuntime(), false);
  assert.equal(state.windows[0].destroyed, true);
  release();
  assert.equal(service.previewRuntimeLeases, 0);
});

test('two concurrent read leases singleflight startup and keep readers until the last release', async () => {
  const { state, service } = createHarness();
  const loading = deferred();
  state.load = () => loading.promise;
  const first = service.acquirePreviewRuntime();
  const second = service.acquirePreviewRuntime();
  assert.equal(state.windows.length, 1);
  loading.resolve();
  const [releaseFirst, releaseSecond] = await Promise.all([first, second]);
  releaseFirst();
  releaseFirst();
  assert.equal(service.hasLiveRuntime(), true);
  assert.equal((await service.inspectTarget('/outside/invoice.pdf')).rootName, 'outside');
  releaseSecond();
  assert.equal(service.hasLiveRuntime(), false);
  assert.equal(state.calls.filter(call => call.method === 'cancel').length, 2);
  assert.equal(service.previewRuntimeLeases, 0);
});

test('Workspace start adopts existing readers and releasing Workspace leaves IndiPreview live', async () => {
  const { state, service } = createHarness();
  const failures = [];
  const release = await service.acquirePreviewRuntime();
  await service.start(workspace('first', failures));
  await service.start(workspace('next', failures));
  assert.equal(state.windows.length, 1);
  assert.equal(state.calls.filter(call => call.method === 'ready').length, 4);
  assert.equal(state.relays.at(-1).hostId, 'next');
  assert.equal(state.relays.at(-1).preserveWorkspace, true);
  service.releaseWorkspace();
  assert.equal(service.hasLiveRuntime(), true);
  assert.equal((await service.inspectTarget('/outside/invoice.pdf')).rootName, 'outside');
  release();
  assert.equal(state.windows[0].destroyed, true);
  assert.deepEqual(failures, []);
});

test('Workspace ownership outlives temporary read lease and closes without remaining owners', async () => {
  const { state, service } = createHarness();
  await service.start(workspace());
  const release = await service.acquirePreviewRuntime();
  release();
  assert.equal(service.hasLiveRuntime(), true);
  service.releaseWorkspace();
  assert.equal(state.windows[0].destroyed, true);
});

test('failed startup returns all waiting leases and can retry cleanly', async () => {
  const { state, service } = createHarness();
  state.load = () => Promise.reject(new Error('load failed'));
  const results = await Promise.allSettled([service.acquirePreviewRuntime(), service.acquirePreviewRuntime()]);
  assert.deepEqual(results.map(result => result.status), ['rejected', 'rejected']);
  assert.equal(service.previewRuntimeLeases, 0);
  assert.equal(state.windows[0].destroyed, true);
  state.load = null;
  const release = await service.acquirePreviewRuntime();
  assert.equal(state.windows.length, 2);
  release();
  assert.equal(state.windows[1].destroyed, true);
});

test('window construction failure clears started readers and does not leak the lease', async () => {
  const { state, service } = createHarness();
  state.constructorError = new Error('construction failed');
  await assert.rejects(service.acquirePreviewRuntime(), /construction failed/);
  assert.equal(service.previewRuntimeLeases, 0);
  assert.equal(state.calls.filter(call => call.method === 'cancel').length, 2);
  state.constructorError = null;
  const release = await service.acquirePreviewRuntime();
  release();
  assert.equal(state.windows[0].destroyed, true);
});

test('force stop interrupts hanging startup immediately and stale failure cannot stop its replacement', async () => {
  const { state, service } = createHarness();
  state.load = () => new Promise(() => {});
  const old = service.acquirePreviewRuntime();
  const rejected = assert.rejects(old, /superseded/);
  service.stop();
  state.load = null;
  const current = service.acquirePreviewRuntime();
  await rejected;
  const release = await current;
  assert.equal(service.hasLiveRuntime(), true);
  assert.equal(service.previewRuntimeLeases, 1);
  release();
  assert.equal(state.windows.length, 2);
  assert.ok(state.windows.every(window => window.destroyed));
});

test('closing Workspace during shared startup preserves the pending independent lease', async () => {
  const { state, service } = createHarness();
  const loading = deferred();
  state.load = () => loading.promise;
  const independent = service.acquirePreviewRuntime();
  const pendingWorkspace = service.start(workspace());
  const rejected = assert.rejects(pendingWorkspace, /superseded/);
  service.releaseWorkspace();
  loading.resolve();
  const release = await independent;
  await rejected;
  assert.equal(service.hasLiveRuntime(), true);
  assert.equal(state.relays.length, 0);
  release();
  assert.equal(state.windows[0].destroyed, true);
});

test('reader readiness remains pending until every authority is ready', async () => {
  const { state, service } = createHarness();
  const ready = deferred();
  state.ready = kind => kind === 'OnlyPreviewPreviewReadRuntime' ? ready.promise : Promise.resolve({ ok: true });
  let acquired = false;
  const acquiring = service.acquirePreviewRuntime().then(release => { acquired = true; return release; });
  await tick();
  assert.equal(acquired, false);
  assert.equal(service.hasLiveRuntime(), false);
  ready.resolve({ ok: true });
  const release = await acquiring;
  assert.equal(acquired, true);
  release();
});

test('runtime failure reaches the latest Workspace callback only', async () => {
  const { state, service } = createHarness();
  const oldFailures = [];
  const newFailures = [];
  await service.start(workspace('old', oldFailures));
  await service.start(workspace('new', newFailures));
  state.windows[0].webContents.emit('render-process-gone');
  assert.deepEqual(oldFailures, []);
  assert.deepEqual(newFailures, ['File-search renderer exited unexpectedly.']);
  assert.equal(service.hasLiveRuntime(), false);
});

test('a failed reader readiness rejects both leases, cleans readers, and permits retry', async () => {
  const { state, service } = createHarness();
  state.ready = kind => Promise.resolve(kind === 'OnlyPreviewOfficeReadRuntime' ? { ok: false, error: 'Not ready' } : { ok: true });
  const results = await Promise.allSettled([service.acquirePreviewRuntime(), service.acquirePreviewRuntime()]);
  assert.ok(results.every(result => result.status === 'rejected'));
  assert.equal(service.previewRuntimeLeases, 0);
  assert.equal(state.windows[0].destroyed, true);
  state.ready = null;
  const release = await service.acquirePreviewRuntime();
  release();
  assert.equal(state.windows[1].destroyed, true);
});

test('force stop never resets outstanding lease counts or lets an old release stop a new reader', async () => {
  const { state, service } = createHarness();
  const releaseOld = await service.acquirePreviewRuntime();
  service.stop();
  const releaseNew = await service.acquirePreviewRuntime();
  releaseOld();
  releaseOld();
  assert.equal(service.previewRuntimeLeases, 1);
  assert.equal(service.hasLiveRuntime(), true);
  releaseNew();
  assert.equal(service.previewRuntimeLeases, 0);
  assert.ok(state.windows.every(window => window.destroyed));
});

test('stalled hidden renderer has a bounded load wait and releases failed acquisition', async () => {
  const { state, service } = createHarness();
  state.load = () => new Promise(() => {});
  const actualSetTimeout = globalThis.setTimeout;
  const actualClearTimeout = globalThis.clearTimeout;
  const timeouts = [];
  globalThis.setTimeout = (callback, delay) => {
    const timeout = { callback, delay, cleared: false };
    timeouts.push(timeout);
    return timeout;
  };
  globalThis.clearTimeout = timeout => { if (timeout) timeout.cleared = true; };
  try {
    const pending = service.acquirePreviewRuntime();
    const rejected = assert.rejects(pending, /timed out|superseded/);
    const loadTimeout = timeouts.find(timeout => timeout.delay === 30_000);
    assert.ok(loadTimeout);
    loadTimeout.callback();
    await rejected;
    assert.equal(service.previewRuntimeLeases, 0);
    assert.equal(state.windows[0].destroyed, true);
    assert.equal(loadTimeout.cleared, true);
  } finally {
    globalThis.setTimeout = actualSetTimeout;
    globalThis.clearTimeout = actualClearTimeout;
  }
});
