import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);
const settle = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };
const mocks = {
  electron: `export const ipcRenderer = globalThis.runtime.ipc; export const contextBridge = { exposeInMainWorld: (name, value) => { globalThis[name] = value; } };
    export const WebContentsView = globalThis.runtime.View; export const webContents = { getFocusedWebContents: () => globalThis.runtime.focused };`,
  '@electron-toolkit/utils': 'export const is = { dev: false };',
  '@maestro-main/data/maestroDataRoot': "export const MAESTRO_PARTITION = 'persist:history-tabs-test';",
  'electron-xpc/main': 'export const xpcMain = { broadcast: (event, params) => globalThis.runtime.broadcast(event, params) };',
  vue: 'export const reactive = value => value; export const nextTick = () => Promise.resolve();',
};
const bundle = await build({
  stdin: { contents: `
    import 'electron-xpc/preload';
    export { menuBarStore } from './src/renderer/maestro/home/src/components/MenuBar/menuBar.store.ts';
    export { tabStore } from './src/renderer/maestro/home/src/components/MenuBar/tab.store.ts';
    export { browserHistoryStore } from './src/renderer/maestro/home/src/components/MenuBar/browserHistory.store.ts';
    export { MaestroHistoryViewService } from './src/main/maestro/windows/main/maestroHistoryView.service.ts';
  `, resolveDir: root },
  bundle: true, platform: 'node', format: 'cjs', target: 'node22', write: false,
  tsconfig: resolve(root, 'tsconfig.node.json'), define: { __dirname: JSON.stringify(resolve(root, 'out/main')) },
  plugins: [{ name: 'real-xpc-tabs-boundary', setup(context) {
    context.onResolve({ filter: /.*/ }, ({ path }) => Object.hasOwn(mocks, path) ? { path, namespace: 'mock' } : undefined);
    context.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({ contents: mocks[path], loader: 'js' }));
  } }],
});
const tab = (id, active = true, extra = {}) => ({ id, kind: 'browser', url: `https://${id}.invalid/`, title: id, active, pinned: false, favicon: '', debuggerEnabled: true, ...extra });
const home = (active = false) => tab('tab-1', active, { kind: 'home', pinned: true, url: 'bitterless://home', displayUrl: 'bitterless://home' });
const fixture = async (context, options = {}) => {
  const calls = [], logs = [], timers = new Map(), storage = new Map();
  let timerId = 0;
  if (options.lastActive) storage.set('coach.lastActiveTab', options.lastActive);
  class Contents extends EventEmitter {
    destroyed = false;
    isDestroyed() { return this.destroyed; }
    setWindowOpenHandler() {}
    loadFile() { return Promise.resolve(); }
    close() { this.destroyed = true; this.emit('destroyed'); }
    focus() { runtime.focused = this; }
  }
  class View {
    webContents = new Contents(); visible = false;
    setBackgroundColor() {} setBounds() {} setVisible(value) { this.visible = value; }
  }
  const win = new EventEmitter();
  Object.assign(win, { webContents: new Contents(), isDestroyed: () => false, isFocused: () => true, getContentSize: () => [1000, 700],
    children: [], contentView: { addChildView(view) { win.children = win.children.filter(item => item !== view); win.children.push(view); }, removeChildView(view) { win.children = win.children.filter(item => item !== view); } },
  });
  const runtime = { ipc: new EventEmitter(), View, focused: win.webContents, tabs: options.tabs || [tab('tab-1')], snapshots: [],
    broadcast: (event, params) => runtime.ipc.emit('__xpc_broadcast_dispatch__', {}, { handleName: event, params }),
  };
  const host = { browserWindow: win, activeTabId: runtime.tabs.find(item => item.active)?.id || null };
  const publishTabs = tabs => { runtime.tabs = tabs; host.activeTabId = tabs.find(item => item.active)?.id || null; runtime.broadcast('coach/tabs', tabs); };
  const handlers = {
    CoachXpcHandler: {
      getTabs: async () => runtime.tabs,
      restoreTabs: async ({ tabs }) => { runtime.tabs = [home(true), ...tabs.map((saved, i) => tab(`tab-${i + 2}`, false, { ...saved }))]; },
      activateTab: async ({ id }) => publishTabs(runtime.tabs.map(item => ({ ...item, active: item.id === id }))),
      newTab: async () => publishTabs([...runtime.tabs.map(item => ({ ...item, active: false })), tab('tab-new')]),
      setTabDebugger: async () => { runtime.tabs = [tab('tab-debugger')]; host.activeTabId = 'tab-debugger'; return runtime.tabs; },
    },
    TabsDao: { listAll: async () => options.saved || [], replaceAll: async () => ({ ok: true }) },
    BrowserHistoryDao: { search: async () => [{ url: 'https://history.invalid/', title: 'Saved', favicon: '', visitCount: 1, lastVisitedAt: 1 }] },
    BrowserHistoryPopupHandler: {
      update: async state => { runtime.snapshots.push(state); return runtime.service.update(state); },
      hide: async ({ session }) => runtime.service.hide(session),
      blur: async () => runtime.service.blur(),
    },
  };
  runtime.ipc.send = (channel, payload) => calls.push([channel, payload]);
  runtime.ipc.invoke = async (channel, payload) => {
    assert.equal(channel, '__xpc_exec__');
    calls.push([payload.handleName, payload.params]);
    const [name, method] = payload.handleName.split('/');
    assert.ok(handlers[name]?.[method], payload.handleName);
    return handlers[name][method](payload.params);
  };
  class Element { closest() { return null; } }
  const input = Object.assign(new Element(), { value: '', disabled: false, focus() {}, getBoundingClientRect: () => ({ x: 100, y: 40, width: 600, height: 32 }) });
  const module = { exports: {} };
  runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require, runtime, Element, URL,
    process: { contextIsolated: false }, navigator: { userAgent: 'Mac' }, console: { info: (...args) => logs.push(args), warn() {}, error() {} },
    document: { addEventListener() {}, removeEventListener() {} },
    window: { addEventListener() {}, removeEventListener() {}, location: { href: `http://127.0.0.1/maestro/home/index.html${options.forceHome ? '?maestroForcePinnedHome=1' : ''}` }, history: { state: null, replaceState() {} } },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    ResizeObserver: class { observe() {} disconnect() {} },
    setTimeout: (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; }, clearTimeout: id => timers.delete(id),
  });
  const { menuBarStore: menu, tabStore: tabs, browserHistoryStore: history, MaestroHistoryViewService } = module.exports;
  runtime.service = new MaestroHistoryViewService(host); runtime.service.create(win);
  menu.bindAddressInput(input);
  // Match MenuBar.vue's real order, including concurrent asynchronous initialization.
  const menuReady = menu.init(); const tabsReady = tabs.init();
  await Promise.all([menuReady, tabsReady]); await settle();
  const tick = async ms => { for (const [id, timer] of [...timers]) if (timer.ms === ms) { timers.delete(id); timer.fn(); } await settle(); };
  context.after(() => { history.dispose(); runtime.service.reset(); });
  return { calls, logs, input, menu, tabs, history, runtime, host, publishTabs, tick, win };
};

test('real XPC preload and real MenuBar/tab initialization update history identity after tab-1 → tab-2', async context => {
  const f = await fixture(context);
  f.publishTabs([tab('tab-1', false), tab('tab-2')]);
  assert.equal(f.tabs.activeTab.id, 'tab-2');
  f.input.value = 'query'; f.history.inputChanged(); await settle(); await f.tick(90);
  assert.equal(f.runtime.snapshots[0].tabId, 'tab-2');
  assert.equal(f.runtime.service.snapshot()?.tabId, 'tab-2');
  assert.equal(f.runtime.service.snapshot()?.entries.length, 1);
  assert.equal(f.win.children.at(-1)?.visible, true);
  assert.ok(f.calls.some(([name]) => name === 'BrowserHistoryDao/search'));
  assert.equal(f.calls.filter(([name, payload]) => name === '__xpc_subscribe__' && payload.handleName === 'coach/tabs').length, 1);
  assert.equal(f.calls.filter(([name]) => name === 'CoachXpcHandler/getTabs').length, 1);
  const state = f.runtime.service.snapshot();
  assert.equal(f.runtime.service.update({ ...state, revision: state.revision + 1, tabId: 'tab-1' }), false, 'real stale-tab requests must still be rejected');
});

test('authoritative initial, restore/last-active, force-home and debugger snapshots seed the same history identity', async context => {
  for (const options of [
    { tabs: [tab('tab-initial')] },
    { tabs: [home(true)], saved: [{ url: 'https://restored.invalid/', title: 'Restored', favicon: '', position: 0 }], lastActive: 'https://restored.invalid/' },
    { tabs: [home(false), tab('tab-2')], forceHome: true },
  ]) {
    const f = await fixture(context, options);
    f.history.toggle(); await settle();
    assert.equal(f.runtime.snapshots[0].tabId, f.host.activeTabId);
    assert.equal(f.runtime.service.snapshot()?.tabId, f.host.activeTabId);
    f.history.hide();
    await f.tabs.toggleActiveDebugger();
    f.history.toggle(); await settle();
    assert.equal(f.runtime.service.snapshot()?.tabId, 'tab-debugger');
  }
});

test('new-tab broadcast stays synchronized and metadata preserves draft/history while persistence remains active', async context => {
  const f = await fixture(context);
  await f.tabs.newTab(); f.input.value = 'typed draft'; f.menu.url = f.input.value; f.history.inputChanged(); await f.tick(90);
  assert.equal(f.runtime.service.snapshot()?.tabId, 'tab-new');
  const revision = f.runtime.service.snapshot().revision;
  f.publishTabs(f.runtime.tabs.map(item => ({ ...item, title: 'Late title', favicon: 'https://icon.invalid/favicon.png' })));
  assert.equal(f.menu.url, 'typed draft'); assert.equal(f.history.open, true);
  assert.equal(f.runtime.service.snapshot().revision, revision);
  await f.tick(500);
  assert.ok(f.calls.some(([name]) => name === 'TabsDao/replaceAll'));
});
