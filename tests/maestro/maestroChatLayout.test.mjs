/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '../..');
const viewRoot = join(root, 'src/main/maestro/windows/main');
const modules = [
  'maestroWindow.controller.ts',
  'maestroBrowserView.service.ts',
  'maestroControlView.service.ts',
  'maestroWorkbenchView.service.ts',
  'maestroTabAliasView.service.ts',
  'viewBounds.ts',
  'compositeTab.registry.ts'
].map((name) => join(viewRoot, name));
const api = join(root, 'src/shared/maestro/coach.api.ts');

// Keep the real controller and view services. Unrelated agent/IO dependencies are inert here;
// native views are represented only by their geometry, visibility, and lifecycle boundary.
const importedNames = new Map();
for (const file of modules) {
  const ast = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  for (const statement of ast.statements) {
    if (!ts.isImportDeclaration(statement) || statement.importClause?.isTypeOnly) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    const names = importedNames.get(statement.moduleSpecifier.text) ?? new Set();
    for (const binding of bindings.elements) {
      if (!binding.isTypeOnly) names.add((binding.propertyName ?? binding.name).text);
    }
    importedNames.set(statement.moduleSpecifier.text, names);
  }
}

const stubSources = {
  electron: `
    export class WebContentsView {
      bounds = { x: 0, y: 0, width: 0, height: 0 };
      visible = true;
      writes = 0;
      destroyed = false;
      focused = false;
      webContents = {
        isDestroyed: () => this.destroyed,
        close: () => { this.destroyed = true; },
        focus: () => { this.focused = true; },
        loadFile: async () => {},
        loadURL: async () => {},
        on: () => {},
        once: () => {},
        setIgnoreMenuShortcuts: () => {},
        navigationHistory: { canGoBack: () => false, canGoForward: () => false }
      };
      setBounds(bounds) { this.bounds = { ...bounds }; this.writes += 1; }
      getBounds() { return { ...this.bounds }; }
      setVisible(visible) { this.visible = visible; }
      setBackgroundColor() {}
    }
    export class BrowserWindow {}
    export const app = {}, shell = {}, Menu = {}, clipboard = {};
  `,
  inversify:
    'export const injectable = () => (target) => target; export const inject = () => () => {};',
  '@electron-toolkit/utils': 'export const is = { dev: false };',
  'electron-xpc/main':
    'export const xpcMain = { broadcast: () => {} }; export const createXpcMainEmitter = () => ({});',
  '@maestro-shared/iocHelper/ioc.helper': `
    export class CommonService { setState(state) { this._state = state; } }
    export const iocHelper = { bind: ({ controller }) => controller };
  `,
  '../window.helper': 'export class WindowHelper { browserWindow = null; }',
  './maestroControlLinkPolicy': 'export const installControlLinkPolicy = () => {};',
  // 日志是这里的边界,但**必须可调用**:两个 service 都在模块作用域就调了 `moduleLog('tab-alias')`,
  // 而默认桩是 `export class moduleLog {}` —— bundle 一 import 就抛
  // 「Class constructor cannot be invoked without 'new'」,整个文件一条测试都注册不上。
  '@main/logging/moduleLog': 'export const moduleLog = () => ({ info() {}, warn() {}, error() {} });'
};

const bundle = await build({
  stdin: {
    contents: `
      export { maestroWindowHelper as Controller } from './maestroWindow.controller';
      export { MaestroBrowserViewService as Browser } from './maestroBrowserView.service';
      export { MaestroControlViewService as Control } from './maestroControlView.service';
      export { MaestroWorkbenchViewService as Workbench } from './maestroWorkbenchView.service';
      export { MaestroTabAliasViewService as TabAlias } from './maestroTabAliasView.service';
      export { registerMaestroCompositeTab } from './compositeTab.registry';
      export { WebContentsView as NativeView } from 'electron';
    `,
    resolveDir: viewRoot
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  write: false,
  tsconfig: join(root, 'tsconfig.node.json'),
  define: { 'import.meta.env.VITE_MODE': '"release"', __dirname: '"/test-bundle"' },
  plugins: [
    {
      name: 'maestro-layout-boundary',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, (args) => {
          if (builtinModules.includes(args.path) || args.path.startsWith('node:'))
            return { path: args.path, external: true };
          if (args.path === '@maestro-shared/coach.api') return { path: api };
          const local = resolve(args.resolveDir || viewRoot, `${args.path}.ts`);
          if (modules.includes(local)) return { path: local };
          return { path: args.path, namespace: 'boundary' };
        });
        builder.onLoad({ filter: /.*/, namespace: 'boundary' }, ({ path }) => ({
          contents:
            stubSources[path] ??
            [...(importedNames.get(path) ?? [])]
              .map((name) => `export class ${name} {}`)
              .join('\n'),
          loader: 'js'
        }));
      }
    }
  ]
});
const { Controller, Browser, Control, Workbench, TabAlias, NativeView, registerMaestroCompositeTab } =
  await import(
    `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
  );

const closed = (width = 1360, height = 900) => ({
  operation: { x: 0, y: 78, width, height: height - 78 },
  control: { x: width, y: 78, width: 0, height: height - 78 }
});
const opened = (width = 1360, height = 900, sidebar = 480) => ({
  operation: { x: 0, y: 78, width: width - sidebar, height: height - 78 },
  control: { x: width - sidebar, y: 78, width: sidebar, height: height - 78 }
});

const fixture = async () => {
  const service = () => ({
    setState() {
      return undefined;
    },
    reset() {
      return undefined;
    },
    switchCaptureTarget: async () => undefined,
    emitTrace() {
      return undefined;
    }
  });
  const browser = new Browser();
  const control = new Control();
  const workbench = new Workbench();
  // The real alias overlay, not a stub: it is one of the services the two layout paths dispatch to,
  // so a stub here would let a missing `setBounds` wiring pass (the first dialog would be 0×0).
  const tabAlias = new TabAlias();
  const controller = new Controller(
    service(),
    browser,
    control,
    workbench,
    tabAlias,
    service(),
    service(),
    service(),
    service(),
    service(),
    service()
  );
  const children = [];
  const window = {
    isDestroyed: () => false,
    size: [1360, 900],
    getContentSize() {
      return this.size;
    },
    contentView: {
      removeChildView(view) {
        const index = children.indexOf(view);
        if (index >= 0) children.splice(index, 1);
      },
      addChildView(view) {
        const index = children.indexOf(view);
        if (index >= 0) children.splice(index, 1);
        children.push(view);
      }
    }
  };
  controller.browserWindow = window;
  controller.operationView = new NativeView();
  await control.create();
  const controlNative = children[0];
  return { controller, browser, control, workbench, tabAlias, children, window, controlNative };
};

const assertLayout = (fixture, expected) => {
  assert.deepEqual(fixture.controller.operationView.getBounds(), expected.operation);
  assert.deepEqual(fixture.controlNative.getBounds(), expected.control);
  assert.equal(
    fixture.controlNative.visible,
    expected.control.width > 0 && expected.control.height > 0
  );
};

test('closed Shell measurement survives deferred Workbench, repeated reports, and new browser activation', async () => {
  const f = await fixture();
  assert.equal(f.controlNative.visible, false, 'Control starts hidden before any layout');
  f.controller.layout();
  assertLayout(f, opened());
  f.controller.setViewBounds(closed());
  assertLayout(f, closed());

  // Workbench.create calls the actual controller.layout, reproducing the startup race.
  await f.workbench.create();
  assertLayout(f, closed());
  const workbenchNative = f.children[1];
  assert.deepEqual(workbenchNative.getBounds(), closed().operation);
  assert.equal(workbenchNative.visible, false);

  const native = new NativeView();
  f.browser.tabs.push({
    id: 'new-browser',
    kind: 'browser',
    view: native,
    url: 'https://example.com',
    title: 'New tab'
  });
  await f.browser.activateTab({ id: 'new-browser' });
  assert.equal(f.controller.operationView, native);
  assertLayout(f, closed());
  const writes = f.controlNative.writes;
  f.controller.setViewBounds(closed());
  f.controller.layout();
  assert.equal(f.controlNative.writes, writes, 'identical reports avoid redundant native writes');
  assertLayout(f, closed());
});

test('native resize preserves closed or measured custom-width Chat until the next Shell measurement', async () => {
  const f = await fixture();
  f.controller.setViewBounds(closed());
  await f.workbench.create();
  f.window.size = [1600, 1000];
  f.controller.layout();
  assertLayout(f, closed());
  f.controller.setViewBounds(closed(1600, 1000));
  assertLayout(f, closed(1600, 1000));
  f.controller.setViewBounds(opened(1600, 1000, 360));
  f.window.size = [1500, 950];
  f.controller.layout();
  assertLayout(f, opened(1600, 1000, 360));
  f.controller.setViewBounds(opened(1500, 950, 360));
  assertLayout(f, opened(1500, 950, 360));
  f.controller.setViewBounds(closed(1500, 950));
  assertLayout(f, closed(1500, 950));
  f.controller.setViewBounds(opened(1500, 950));
  assertLayout(f, opened(1500, 950));
});

test('an open initial measurement remains authoritative through deferred Workbench creation', async () => {
  const f = await fixture();
  f.controller.setViewBounds(opened(1360, 900, 325));
  await f.workbench.create();
  assertLayout(f, opened(1360, 900, 325));
  assert.deepEqual(f.children[1].getBounds(), opened(1360, 900, 325).operation);
});

test('composite Mini App receives the same measured content rect when Chat closes and reopens', async () => {
  const f = await fixture();
  let host;
  let latest;
  registerMaestroCompositeTab({
    id: 'test-layout-app',
    title: 'Test Mini App',
    favicon: '',
    open: async (value) => {
      host = value;
      latest = host.contentRect();
    },
    setActive: () => {
      latest = host.contentRect();
    },
    refresh: () => {
      latest = host.contentRect();
    },
    close: () => {}
  });
  f.controller.setViewBounds(closed());
  await f.browser.openCompositeTab({ id: 'test-layout-app' });
  assert.deepEqual(latest, closed().operation);
  await f.workbench.create();
  assert.deepEqual(latest, closed().operation);
  assert.equal(f.controlNative.visible, false);
  f.controller.setViewBounds(opened());
  assert.deepEqual(latest, opened().operation);
  assert.equal(f.controlNative.visible, true);
  f.controller.setViewBounds(closed());
  assert.deepEqual(latest, closed().operation);
  assert.equal(f.controlNative.visible, false);
});

test('window teardown clears retained geometry before another window receives first-frame layout', async () => {
  const f = await fixture();
  f.controller.setViewBounds(closed());
  await f.workbench.create();
  f.controller.resetWindowScopedViews();
  assert.equal(f.controller.opBounds, null);
  assert.equal(f.controller.controlBounds, null);
  assert.equal(f.controlNative.destroyed, true);
  f.controller.operationView = new NativeView();
  await f.control.create();
  f.controlNative = f.children.at(-1);
  assert.equal(f.controlNative.visible, false);
  f.controller.layout();
  assertLayout(f, opened());
});

test('Workbench tab opens once, backgrounds without closing, and reuses its renderer after close', async () => {
  const f = await fixture();
  f.controller.setViewBounds(closed());
  await f.workbench.create();
  const native = f.children.at(-1);
  const count = f.children.length;
  assert.deepEqual(await f.controller.getWorkbenchTab(), { open: false, visible: false });
  assert.equal(native.visible, false);
  for (let i = 0; i < 3; i += 1) {
    assert.deepEqual(await f.controller.openWorkbenchTab(), { open: true, visible: true });
  }
  assert.equal(f.children.length, count);
  assert.deepEqual(native.bounds, closed().operation);
  assert.equal(native.visible, true);
  assert.deepEqual(await f.controller.backgroundWorkbenchTab(), { open: true, visible: false });
  assert.equal(native.destroyed, false);
  await f.controller.openWorkbenchTab();
  assert.deepEqual(await f.controller.closeWorkbenchTab(), { open: false, visible: false });
  assert.equal(native.destroyed, false);
  assert.equal(f.controller.operationView.focused, true);
  await f.controller.openWorkbenchTab();
  assert.equal(f.children.length, count);
  assert.equal(native.visible, true);
});

test('Workbench covers active and late cold composite mounts and restores only the active tab', async () => {
  const f = await fixture(); await f.workbench.create();
  const workbench = f.children.at(-1); const mounts = new Map(); let finish;
  const wait = new Promise(resolve => { finish = resolve; });
  registerMaestroCompositeTab({
    id: 'test-workbench-cover', title: 'Terminal', favicon: '', displayUrl: 'test://terminal',
    async open(host) {
      if (host.instanceId === 'cold') await wait;
      const view = new NativeView(); mounts.set(host.instanceId, view); host.attach(view); view.setVisible(true);
    },
    setActive(host, active) { mounts.get(host.instanceId)?.setVisible(active); },
    refresh() {}, close() {}
  });
  const active = await f.browser.openCompositeTab({ id: 'test-workbench-cover', instanceId: 'active' });
  const pending = f.browser.openCompositeTab({ id: 'test-workbench-cover', instanceId: 'cold', activate: false });
  await f.controller.openWorkbenchTab(); assert.equal(mounts.get('active').visible, false);
  assert.equal(f.children.at(-1), workbench);
  finish(); await pending; assert.equal(mounts.get('cold').visible, false);
  assert.equal(mounts.get('active').visible, false);
  await f.controller.backgroundWorkbenchTab(); assert.equal(mounts.get('active').visible, true);
  assert.equal(mounts.get('cold').visible, false); assert.equal(f.browser.activeTabId, active.id);
});

test('Workbench open intent survives deferred creation and reset does not restore its tab', async () => {
  const f = await fixture();
  f.controller.setViewBounds(closed());
  await f.controller.openWorkbenchTab();
  await f.workbench.create();
  const native = f.children.at(-1);
  assert.equal(native.visible, true);
  assert.deepEqual(native.bounds, closed().operation);
  f.workbench.reset();
  assert.deepEqual(await f.controller.getWorkbenchTab(), { open: false, visible: false });
  assert.equal(native.destroyed, true);
});

test('Cmd+W closes the foreground Workbench only, and user New tab backgrounds it', async () => {
  const f = await fixture();
  const calls = [];
  f.browser.closeActiveTab = async () => calls.push('close-browser');
  f.browser.newTab = async () => {
    assert.equal(f.workbench.isVisible(), false);
    calls.push('new-browser');
  };
  await f.controller.openWorkbenchTab();
  await f.controller.closeActiveTab();
  assert.deepEqual(calls, []);
  await f.controller.closeActiveTab();
  assert.deepEqual(calls, ['close-browser']);
  await f.controller.openWorkbenchTab();
  await f.controller.newTab();
  assert.deepEqual(await f.controller.getWorkbenchTab(), { open: true, visible: false });
  assert.deepEqual(calls, ['close-browser', 'new-browser']);
});

test('both internal Workbench URL aliases converge on the same tab without creating browser tabs', async () => {
  const f = await fixture();
  const count = f.browser.tabs.length;
  for (const url of ['bitterless://workbench', 'micromeet://workbench/settings']) {
    await f.browser.navigate({ url });
    assert.deepEqual(await f.controller.getWorkbenchTab(), { open: true, visible: true });
    await f.controller.closeWorkbenchTab();
    await f.browser.openTab({ url });
    assert.deepEqual(await f.controller.getWorkbenchTab(), { open: true, visible: true });
  }
  assert.equal(f.browser.tabs.length, count);
});

test('agent tab activation leaves foreground Workbench and the agent target independent', async () => {
  const f = await fixture();
  const native = new NativeView();
  f.browser.tabs.push({ id: 'agent-tab', kind: 'browser', view: native, pinned: false, url: 'https://example.com' });
  await f.controller.openWorkbenchTab();
  await f.controller.activateTab({ id: 'agent-tab' });
  assert.equal(f.browser.activeTabId, 'agent-tab');
  assert.deepEqual(await f.controller.getWorkbenchTab(), { open: true, visible: true });
});
