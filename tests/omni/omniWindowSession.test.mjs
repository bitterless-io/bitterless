import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import { OmniWindowSessionService } from '../../src/main/windows/omniWindowSession.service.ts';
import { runSqliteFirstGuiStartup } from '../../src/main/startup/guiStartup.service.ts';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../../', import.meta.url));
const primary = { id: 1, workArea: { x: 0, y: 0, width: 1600, height: 1000 } };
const secondary = { id: 2, workArea: { x: -1920, y: 40, width: 1920, height: 1040 } };
const savedBounds = { x: -1820, y: 120, width: 1100, height: 700 };
const savedGeometry = {
  ...savedBounds, displayId: 2, displayWorkArea: secondary.workArea, relativeX: 100, relativeY: 80,
};
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const settle = () => new Promise((done) => setImmediate(done));
const temporaryDirectory = (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'bitterless-omni-session-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
};
const sessionAt = (directory) => new OmniWindowSessionService(
  () => join(directory, 'omni-window-session.json'),
);
const seed = (directory, open = true, geometry = savedGeometry) => {
  writeFileSync(join(directory, 'omni-window-session.json'), JSON.stringify({ open }));
  writeFileSync(join(directory, 'window-state.json'), JSON.stringify({ omni: geometry }));
};

// Execute the production helper, coordinator and geometry service. Only Electron, IPC and
// renderer loading are doubled; every harness gets a fresh module cache like an App restart.
const createHarness = (t, directory, displays = [primary, secondary]) => {
  const windows = [];
  const errors = [];
  class FakeWindow extends EventEmitter {
    destroyed = false;
    visible = false;
    minimized = false;
    maximized = false;
    fullScreen = false;
    showBounds = [];
    contentView = { addChildView() {}, removeChildView() {} };
    constructor(options) {
      super();
      this.bounds = { x: options.x ?? 30, y: options.y ?? 50, width: options.width, height: options.height };
      windows.push(this);
    }
    isDestroyed() { return this.destroyed; }
    getNormalBounds() { return { ...this.bounds }; }
    getBounds() { return this.getNormalBounds(); }
    getContentSize() { return [this.bounds.width, this.bounds.height]; }
    setBounds(bounds) { this.bounds = { ...bounds }; this.emit('move'); this.emit('resize'); }
    isMinimized() { return this.minimized; }
    restore() { this.minimized = false; }
    isMaximized() { return this.maximized; }
    maximize() { this.maximized = true; this.emit('maximize'); }
    isFullScreen() { return this.fullScreen; }
    setFullScreen(value) { this.fullScreen = value; this.emit(value ? 'enter-full-screen' : 'leave-full-screen'); }
    isVisible() { return this.visible; }
    isFocused() { return this.visible; }
    show() { this.visible = true; this.showBounds.push(this.getNormalBounds()); }
    focus() {}
    destroy() { if (!this.destroyed) { this.destroyed = true; this.emit('closed'); } }
    close() { this.emit('close'); this.destroy(); }
  }
  class FakeView {
    webContents = Object.assign(new EventEmitter(), {
      isDestroyed: () => false,
      isCrashed: () => false,
      getBackgroundThrottling: () => false,
      setBackgroundThrottling() {},
      close() {},
    });
    setBounds() {}
  }
  const electron = {
    app: Object.assign(new EventEmitter(), { getPath: () => directory }),
    BaseWindow: FakeWindow,
    WebContentsView: FakeView,
    screen: Object.assign(new EventEmitter(), {
      getAllDisplays: () => displays,
      getPrimaryDisplay: () => ({ ...displays[0], workAreaSize: displays[0].workArea }),
      getDisplayMatching: (bounds) => displays.find((display) =>
        bounds.x >= display.workArea.x && bounds.x < display.workArea.x + display.workArea.width,
      ) ?? displays[0],
    }),
    session: { fromPartition: () => ({
      clearStorageData: async () => {}, setPermissionRequestHandler() {},
    }) },
  };
  const mocks = {
    electron,
    '@electron-toolkit/utils': { is: { dev: false } },
    'electron-xpc/main': { createXpcMainEmitter: () => ({}), xpcMain: { broadcast() {} } },
    '@main/zellij/zellijRuntime.service': {},
    '@main/zellij/zellijProcess.service': {},
    '@maestro-main/common/shortcutsHelper/shortcuts.helper': {},
  };
  const cache = new Map();
  const load = (path) => {
    if (cache.has(path)) return cache.get(path).exports;
    const module = { exports: {} };
    cache.set(path, module);
    const source = readFileSync(path, 'utf8').replaceAll('import.meta.env.VITE_MODE', '"test"');
    const compiled = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    const moduleRequire = (id) => {
      if (Object.hasOwn(mocks, id)) return mocks[id];
      let file;
      if (id.startsWith('@shared/')) file = join(root, 'src/shared', id.slice('@shared/'.length));
      else if (id.startsWith('.')) file = resolve(dirname(path), id);
      else return require(id);
      return /\.mjs$/.test(file) ? require(file) : load(file.endsWith('.ts') ? file : `${file}.ts`);
    };
    new Function('require', 'exports', 'module', '__dirname', 'console', compiled)(
      moduleRequire, module.exports, module, dirname(path),
      { log() {}, warn() {}, error: (...args) => errors.push(args) },
    );
    return module.exports;
  };
  const { OmniWindowHelper } = load(join(root, 'src/main/windows/omniWindow.helper.ts'));
  const helper = new OmniWindowHelper();
  helper.loadWindowLayout = async () => null;
  helper.createRendererReadyFence = () => ({ promise: Promise.resolve() });
  helper.getRendererReadyArguments = () => [];
  helper.createWebContentsView = (_name, _arguments, _unthrottled, fence) => {
    const view = new FakeView();
    if (fence?.token) helper.bindRendererReadyFenceView(fence, view);
    return view;
  };
  helper.restoreSavedLayout = async () => {};
  helper.requireViewLoad = async () => {};
  helper.startDeferredInitialContent = () => {};
  t.after(() => helper.destroy());
  return { helper, windows, errors };
};

test('fresh, legacy geometry-only and malformed state never auto-open', async (t) => {
  const directory = temporaryDirectory(t);
  writeFileSync(join(directory, 'window-state.json'), JSON.stringify({ omni: savedGeometry }));
  for (const serialized of [null, '{', 'null', '[]', '{}', '{"open":"true"}', '{"open":1}', '{"open":false}']) {
    if (serialized !== null) writeFileSync(join(directory, 'omni-window-session.json'), serialized);
    const { helper, windows } = createHarness(t, directory);
    await helper.restoreSession();
    assert.equal(windows.length, 0, String(serialized));
  }
});

test('first presentation immediately persists geometry and open intent without a move', async (t) => {
  const directory = temporaryDirectory(t);
  const { helper } = createHarness(t, directory);
  const window = await helper.create();
  assert.equal(sessionAt(directory).isOpen(), true);
  const saved = JSON.parse(readFileSync(join(directory, 'window-state.json'), 'utf8')).omni;
  assert.deepEqual({ x: saved.x, y: saved.y, width: saved.width, height: saved.height }, window.bounds);
  window.minimized = true;
  window.visible = false;
  assert.equal(sessionAt(directory).isOpen(), true);
});

test('explicit close persists closed, startup respects it, and manual reopen restores open', async (t) => {
  const directory = temporaryDirectory(t);
  seed(directory);
  const first = createHarness(t, directory);
  const window = await first.helper.create();
  window.close();
  assert.equal(sessionAt(directory).isOpen(), false);
  // Core becoming ready later in the same launch must also respect that close.
  await first.helper.restoreSession();
  assert.equal(first.windows.length, 1);
  const restarted = createHarness(t, directory);
  await restarted.helper.restoreSession();
  assert.equal(restarted.windows.length, 0);
  await restarted.helper.create();
  assert.equal(sessionAt(directory).isOpen(), true);
});

test('host quit/update preserves open and flushes the final bounds before destroy', async (t) => {
  const directory = temporaryDirectory(t);
  seed(directory);
  const first = createHarness(t, directory);
  const window = await first.helper.create();
  const finalBounds = { ...savedBounds, x: -1750, width: 1200 };
  window.setBounds(finalBounds);
  first.helper.setHostQuitting(true);
  first.helper.destroy();
  assert.equal(sessionAt(directory).isOpen(), true);
  const restarted = createHarness(t, directory);
  await restarted.helper.restoreSession();
  assert.equal(restarted.windows.length, 1);
  assert.deepEqual(restarted.windows[0].showBounds[0], finalBounds);
  await restarted.helper.restoreSession();
  assert.equal(restarted.windows.length, 1);
});

test('failed/canceled host quit does not suppress a later ordinary close', async (t) => {
  const directory = temporaryDirectory(t);
  seed(directory);
  const { helper } = createHarness(t, directory);
  const window = await helper.create();
  helper.setHostQuitting(true);
  helper.setHostQuitting(false);
  window.close();
  assert.equal(sessionAt(directory).isOpen(), false);
  await helper.create();
  assert.equal(sessionAt(directory).isOpen(), true);
});

test('internal teardown such as logout leaves manual opening available', async (t) => {
  const directory = temporaryDirectory(t);
  const { helper, windows } = createHarness(t, directory);
  await helper.create();
  helper.destroy();
  assert.equal(sessionAt(directory).isOpen(), true);
  await helper.create();
  assert.equal(windows.length, 2);
  windows[1].close();
  assert.equal(sessionAt(directory).isOpen(), false);
});

test('a failed quit preserves real renderer readiness receipts while cleanup is pending', async (t) => {
  const directory = temporaryDirectory(t);
  seed(directory);
  const { helper, windows } = createHarness(t, directory);
  delete helper.createRendererReadyFence;
  const gate = deferred();
  helper.requireViewLoad = () => gate.promise;
  const restoring = helper.restoreSession();
  await settle();
  const [fence] = helper.rendererReadyFences.values();
  assert.ok(fence);
  assert.equal(windows[0].visible, true);
  helper.setHostQuitting(true);
  fence.view.webContents.emit('did-finish-load');
  assert.equal(fence.loadPending, false);
  assert.equal(helper.markRendererMountedReady({
    token: fence.token, generation: fence.generation, role: fence.role, cellId: fence.cellId,
  }).accepted, true);
  assert.equal(fence.settled, true);
  helper.setHostQuitting(false);
  gate.resolve();
  await restoring;
  assert.equal(windows[0].destroyed, false);
  windows[0].close();
  assert.equal(sessionAt(directory).isOpen(), false);
});

test('auto restore and concurrent manual open share the real coordinator flight', async (t) => {
  const directory = temporaryDirectory(t);
  seed(directory);
  const { helper, windows } = createHarness(t, directory);
  const gate = deferred();
  helper.restoreSavedLayout = () => gate.promise;
  const restoring = helper.restoreSession();
  const manual = helper.create();
  assert.equal(windows.length, 1);
  gate.resolve();
  await Promise.all([restoring, manual]);
  assert.equal(windows.length, 1);
});

test('failed auto-open retains intent, consumes its one attempt, and permits manual retry', async (t) => {
  const directory = temporaryDirectory(t);
  seed(directory);
  const { helper, windows, errors } = createHarness(t, directory);
  helper.restoreSavedLayout = async () => { throw new Error('layout load failed'); };
  await assert.rejects(helper.restoreSession(), /layout load failed/);
  assert.equal(windows[0].destroyed, true);
  assert.equal(sessionAt(directory).isOpen(), true);
  assert.equal(errors.length, 1);
  await helper.restoreSession();
  assert.equal(windows.length, 1);
  helper.restoreSavedLayout = async () => {};
  await helper.create();
  assert.equal(windows.length, 2);
});

test('renderer failure after first show preserves open intent for the next launch', async (t) => {
  const directory = temporaryDirectory(t);
  seed(directory);
  const { helper, windows } = createHarness(t, directory);
  helper.requireViewLoad = async () => { throw new Error('renderer failed'); };
  await assert.rejects(helper.restoreSession(), /renderer failed/);
  assert.equal(windows[0].showBounds.length, 1);
  assert.equal(windows[0].destroyed, true);
  assert.equal(sessionAt(directory).isOpen(), true);
  const restarted = createHarness(t, directory);
  await restarted.helper.restoreSession();
  assert.equal(restarted.windows[0].visible, true);
});

test('user close during renderer readiness is not overwritten by the stale open flight', async (t) => {
  const directory = temporaryDirectory(t);
  seed(directory);
  const { helper, windows } = createHarness(t, directory);
  const gate = deferred();
  helper.requireViewLoad = () => gate.promise;
  const restoring = helper.restoreSession();
  await settle();
  assert.equal(windows[0].visible, true);
  windows[0].close();
  gate.resolve();
  await assert.rejects(restoring, /cancelled/);
  assert.equal(sessionAt(directory).isOpen(), false);
});

test('shutdown while startup restore awaits layout prevents a late show and preserves intent', async (t) => {
  const directory = temporaryDirectory(t);
  seed(directory);
  const { helper, windows } = createHarness(t, directory);
  const gate = deferred();
  helper.restoreSavedLayout = () => gate.promise;
  const restoring = helper.restoreSession();
  helper.setHostQuitting(true);
  gate.resolve();
  await assert.rejects(restoring, /cancelled/);
  assert.deepEqual(windows[0].showBounds, []);
  assert.equal(windows[0].destroyed, true);
  assert.equal(sessionAt(directory).isOpen(), true);
  await helper.restoreSession();
  await assert.rejects(helper.create(), /shutdown/);
  assert.equal(windows.length, 1);
  helper.setHostQuitting(false);
  await helper.create();
  assert.equal(windows.length, 2);
});

test('shutdown before Core readiness never starts a restore', async (t) => {
  const directory = temporaryDirectory(t);
  seed(directory);
  const { helper, windows } = createHarness(t, directory);
  helper.setHostQuitting(true);
  await helper.restoreSession();
  assert.equal(windows.length, 0);
  assert.equal(sessionAt(directory).isOpen(), true);
});

test('shutdown during legacy geometry loading prevents creating a native window', async (t) => {
  const directory = temporaryDirectory(t);
  sessionAt(directory).setOpen(true);
  const { helper, windows } = createHarness(t, directory);
  const gate = deferred();
  helper.loadWindowLayout = () => gate.promise;
  const restoring = helper.restoreSession();
  helper.setHostQuitting(true);
  gate.resolve(savedGeometry);
  await assert.rejects(restoring, /cancelled/);
  assert.equal(windows.length, 0);
  assert.equal(sessionAt(directory).isOpen(), true);
});

test('real display resolver applies saved physical display geometry before first show', async (t) => {
  const cases = [
    { displays: [primary, secondary], expected: savedBounds },
    { displays: [primary, { ...secondary, workArea: { ...secondary.workArea, x: 1600, y: 100 } }],
      expected: { ...savedBounds, x: 1700, y: 180 } },
    { displays: [primary], expected: { ...savedBounds, x: 100, y: 80 } },
    { displays: [primary, { ...secondary, workArea: { x: -1000, y: 40, width: 1000, height: 650 } }],
      expected: { x: -1000, y: 40, width: 1000, height: 650 } },
  ];
  for (const scenario of cases) {
    const directory = temporaryDirectory(t);
    seed(directory);
    const { helper, windows } = createHarness(t, directory, scenario.displays);
    await helper.restoreSession();
    assert.deepEqual(windows[0].showBounds[0], scenario.expected);
  }
});

test('maximized and fullscreen restore keep their saved normal bounds', async (t) => {
  for (const mode of ['maximized', 'fullScreen']) {
    const directory = temporaryDirectory(t);
    seed(directory, true, { ...savedGeometry, [mode]: true });
    const { helper, windows } = createHarness(t, directory);
    await helper.restoreSession();
    assert.equal(windows[0][mode], true);
    assert.deepEqual(windows[0].bounds, savedBounds);
    const persisted = JSON.parse(readFileSync(join(directory, 'window-state.json'), 'utf8')).omni;
    assert.equal(persisted[mode], true);
  }
});

test('Core readiness starts background restore after Home without waiting for Omni', async (t) => {
  const directory = temporaryDirectory(t);
  seed(directory);
  const { helper, windows } = createHarness(t, directory);
  const core = deferred();
  const layout = deferred();
  const events = [];
  let restore;
  helper.restoreSavedLayout = () => layout.promise;
  await runSqliteFirstGuiStartup({
    initializeCorePrerequisites: async () => {},
    startCoreSqlite: () => core.promise,
    initializeLanguageFallback() {},
    initializeForegroundRuntime: async () => {},
    createHome: async () => { events.push('home'); },
    refreshMcpShim: async () => {},
    initializeTray: async () => {},
    handleCoreSqliteReady: () => { events.push('core-ready'); restore = helper.restoreSession(); },
    handleCoreSqliteFailure: async (error) => { throw error; },
    shouldStop: () => false,
  });
  assert.deepEqual(events, ['home']);
  assert.equal(windows.length, 0);
  core.resolve({ ok: true });
  await settle();
  assert.deepEqual(events, ['home', 'core-ready']);
  assert.equal(windows.length, 1);
  assert.equal(windows[0].visible, false);
  layout.resolve();
  await restore;
  assert.equal(windows[0].visible, true);
});

test('App integration fences cleanup, resets failed cleanup and logs background restore failures', () => {
  const source = readFileSync(join(root, 'src/main/app.main.ts'), 'utf8');
  assert.match(source, /isShutdownStarted = true;\s+omniWindowHelper\.setHostQuitting\(true\)/);
  assert.match(source, /isShutdownStarted = false;\s+omniWindowHelper\.setHostQuitting\(false\)/);
  assert.match(source, /handleCoreSqliteReady: \(\) => \{[\s\S]*?void omniWindowHelper\.restoreSession\(\)\.catch[\s\S]*?Failed to restore Omni Browser session/);
});
