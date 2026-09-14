/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { resolve } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '../..');
const runtime = { current: null };
globalThis.__browserHistoryPopupRuntime = runtime;
test.after(() => delete globalThis.__browserHistoryPopupRuntime);

class MockWebContents extends EventEmitter {
  destroyed = false;
  focusCalls = 0;
  loads = [];
  isDestroyed() { return this.destroyed; }
  focus() { this.focusCalls++; runtime.current.focused = this; }
  setWindowOpenHandler(handler) { this.windowOpenHandler = handler; }
  async loadFile(...args) { this.loads.push({ type: 'file', args }); }
  async loadURL(...args) { this.loads.push({ type: 'url', args }); }
  close() { this.destroyed = true; this.emit('destroyed'); }
}

class MockWebContentsView {
  webContents = new MockWebContents();
  bounds = null;
  constructor(options) { this.options = options; runtime.current.views.push(this); }
  setBounds(bounds) { this.bounds = { ...bounds }; }
  setBackgroundColor(color) { this.backgroundColor = color; }
}

class MockBrowserWindow extends EventEmitter {
  destroyed = false;
  focused = true;
  size = [1000, 700];
  webContents = new MockWebContents();
  children = [{ name: 'page' }, { name: 'chat' }];
  contentView = {
    addChildView: (view) => {
      this.children = this.children.filter((item) => item !== view);
      this.children.push(view);
    },
    removeChildView: (view) => { this.children = this.children.filter((item) => item !== view); }
  };
  isDestroyed() { return this.destroyed; }
  isFocused() { return this.focused; }
  getContentSize() { return this.size; }
}

runtime.WebContentsView = MockWebContentsView;
const mocks = {
  electron: `
    const runtime = globalThis.__browserHistoryPopupRuntime;
    export const WebContentsView = runtime.WebContentsView;
    export const webContents = { getFocusedWebContents: () => runtime.current.focused };
  `,
  '@electron-toolkit/utils': 'export const is = { dev: false };',
  '@maestro-main/data/maestroDataRoot': "export const MAESTRO_PARTITION = 'persist:browser-history-test';",
  'electron-xpc/main': `
    const runtime = globalThis.__browserHistoryPopupRuntime;
    export const createXpcMainEmitter = () => ({
      search: (params) => runtime.current.history.search(params),
      remove: (params) => runtime.current.history.remove(params)
    });
    export const xpcMain = { broadcast: (event, params) => runtime.current.broadcasts.push({ event, params }) };
  `
};
const bundle = await build({
  entryPoints: [resolve(root, 'src/main/maestro/windows/main/maestroHistoryView.service.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  write: false,
  define: { __dirname: JSON.stringify(resolve(root, 'out/main')) },
  tsconfig: resolve(root, 'tsconfig.node.json'),
  plugins: [{
    name: 'history-popup-boundary',
    setup(context) {
      context.onResolve({ filter: /.*/ }, ({ path }) =>
        Object.hasOwn(mocks, path) ? { path, namespace: 'history-popup' } : undefined
      );
      context.onLoad({ filter: /.*/, namespace: 'history-popup' }, ({ path }) => ({
        contents: mocks[path], loader: 'js'
      }));
    }
  }]
});
const { MaestroHistoryViewService } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);

const entry = (name) => ({ url: `https://history.invalid/${name}`, title: name, favicon: '', visitCount: 1, lastVisitedAt: 1 });
const deferred = () => {
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolve, reject) => { resolvePromise = resolve; rejectPromise = reject; });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
};
const fixture = (context) => {
  const win = new MockBrowserWindow();
  const state = {
    views: [], broadcasts: [], focused: win.webContents, searches: [], removes: [],
    history: {
      search: async (params) => { state.searches.push(params); return [entry('first'), entry('second')]; },
      remove: async (params) => { state.removes.push(params); }
    }
  };
  runtime.current = state;
  const host = { browserWindow: win, activeTabId: 'tab-one', navigations: [], async navigateHistory(url) { this.navigations.push(url); } };
  const service = new MaestroHistoryViewService(host);
  const request = (overrides = {}) => ({
    sessionId: 'session-one', requestId: 1, tabId: 'tab-one', query: 'first',
    anchor: { x: 160, y: 50, width: 500, height: 32 }, ...overrides
  });
  const mounted = () => { service.mounted(service.rendererToken); return state.views.at(-1); };
  context.after(() => service.reset());
  return { state, win, host, service, request, mounted };
};
const assertClipped = (view, win) => {
  const { x, y, width, height } = view.bounds;
  assert.ok(x >= 0 && y >= 0);
  assert.ok(width > 0 && height > 0);
  assert.ok(x + width <= win.size[0]);
  assert.ok(y + height <= win.size[1]);
};

test('show waits for its renderer token, keeps address focus and raises one native child above page/chat', async (context) => {
  const { state, win, service, request, mounted } = fixture(context);
  const pending = deferred();
  state.history.search = () => pending.promise;
  const showing = service.show(request());
  assert.equal(service.snapshot().loading, true);
  const [view] = state.views;
  assert.ok(view);
  assert.equal(win.children.includes(view), false);
  service.mounted('wrong-token');
  assert.equal(win.children.includes(view), false);
  mounted();
  assert.equal(win.children.at(-1), view);
  pending.resolve([entry('first')]);
  await showing;
  assert.equal(service.snapshot().loading, false);
  assert.equal(win.webContents.focusCalls, 0);
  assert.equal(view.webContents.focusCalls, 0);
  assert.equal(state.focused, win.webContents);
  assert.ok(view.webContents.loads[0].args[1].query.historyToken);
  assertClipped(view, win);
  win.contentView.addChildView({ name: 'new-control-pane' });
  await service.show(request({ requestId: 2 }));
  assert.equal(win.children.at(-1), view);
  assert.equal(win.children.filter((item) => item === view).length, 1);
  assert.equal(state.views.length, 1);
});

test('an older delayed search cannot replace newer suggestions', async (context) => {
  const { state, service, request, mounted } = fixture(context);
  const first = deferred();
  const second = deferred();
  state.history.search = ({ query }) => query === 'first' ? first.promise : second.promise;
  const oldSearch = service.show(request());
  mounted();
  const newSearch = service.show(request({ requestId: 2, query: 'second' }));
  second.resolve([entry('new')]);
  await newSearch;
  const accepted = service.snapshot();
  first.resolve([entry('stale')]);
  await oldSearch;
  assert.deepEqual(service.snapshot(), accepted);
  assert.equal(service.snapshot().entries[0].title, 'new');
});

test('hiding invalidates an in-flight query and blocks delayed reopen of the same address session', async (context) => {
  const { state, win, service, request, mounted } = fixture(context);
  const pending = deferred();
  let searches = 0;
  state.history.search = () => { searches++; return pending.promise; };
  const showing = service.show(request());
  const view = mounted();
  service.hide('session-one');
  const hidden = service.snapshot();
  pending.resolve([entry('late')]);
  await showing;
  await service.show(request({ requestId: 2 }));
  assert.deepEqual(service.snapshot(), hidden);
  assert.equal(searches, 1);
  assert.equal(win.children.includes(view), false);
  assert.equal(service.snapshot().dismissedSessionId, 'session-one');
  await service.show(request({ sessionId: 'session-two', requestId: 3 }));
  assert.equal(service.snapshot().sessionId, 'session-two');
  service.hide('session-one');
  assert.equal(service.snapshot().sessionId, 'session-two');
});

test('a delayed removal cannot issue a refresh or change newer address results', async (context) => {
  const { state, win, service, request, mounted } = fixture(context);
  await service.show(request());
  mounted();
  const removing = deferred();
  state.history.remove = () => removing.promise;
  const removal = service.action({ sessionId: 'session-one', action: 'remove', url: entry('first').url });
  state.history.search = async ({ query }) => { state.searches.push({ query }); return [entry('new')]; };
  await service.show(request({ requestId: 2, query: 'new' }));
  const accepted = service.snapshot();
  removing.resolve();
  await removal;
  assert.deepEqual(service.snapshot(), accepted);
  assert.equal(state.searches.length, 2);
  assert.equal(win.webContents.focusCalls, 0);
});

test('removal refresh remains hidden if dismissal arrives while its query is pending', async (context) => {
  const { state, win, service, request, mounted } = fixture(context);
  await service.show(request());
  const view = mounted();
  const refresh = deferred();
  state.history.search = () => refresh.promise;
  const removal = service.action({ sessionId: 'session-one', action: 'remove', url: entry('first').url });
  await Promise.resolve();
  service.hide('session-one');
  const dismissed = service.snapshot();
  refresh.resolve([entry('second')]);
  await removal;
  assert.deepEqual(service.snapshot(), dismissed);
  assert.equal(win.children.includes(view), false);
  assert.equal(win.webContents.focusCalls, 0);
});

test('successful removal refreshes the visible list and focuses the address without navigating', async (context) => {
  const { state, win, host, service, request, mounted } = fixture(context);
  await service.show(request());
  mounted();
  await service.action({ sessionId: 'session-one', action: 'next' });
  state.history.search = async () => [entry('second')];
  await service.action({ sessionId: 'session-one', action: 'remove', url: entry('first').url });
  assert.deepEqual(state.removes, [{ url: entry('first').url }]);
  assert.equal(service.snapshot().entries[0].title, 'second');
  assert.equal(service.snapshot().selectedIndex, 0);
  assert.equal(win.webContents.focusCalls, 1);
  assert.equal(host.navigations.length, 0);
  assert.ok(state.broadcasts.some(({ event }) => event === 'coach/history-focus-address'));
});

test('the first keyboard candidate performs Google search with the complete encoded input', async (context) => {
  const { host, service, request, mounted } = fixture(context);
  const query = ' 搜索 & cats#? ';
  await service.show(request({ query }));
  mounted();
  await service.action({ sessionId: 'session-one', action: 'next' });
  assert.equal(service.snapshot().selectedIndex, 0);
  await service.action({ sessionId: 'session-one', action: 'accept' });
  assert.deepEqual(host.navigations, [`https://www.google.com/search?q=${encodeURIComponent(query)}`]);
  assert.equal(service.snapshot().sessionId, null);
});

test('keyboard selection traverses Google plus history, and empty history mode contains only saved pages', async (context) => {
  const { host, service, request, mounted } = fixture(context);
  await service.show(request());
  mounted();
  for (const expected of [0, 1, 2, 0]) {
    await service.action({ sessionId: 'session-one', action: 'next' });
    assert.equal(service.snapshot().selectedIndex, expected);
  }
  await service.action({ sessionId: 'session-one', action: 'previous' });
  assert.equal(service.snapshot().selectedIndex, 2);
  await service.action({ sessionId: 'session-one', action: 'accept' });
  assert.deepEqual(host.navigations, [entry('second').url]);
  await service.show(request({ sessionId: 'session-two', requestId: 2, query: '' }));
  await service.action({ sessionId: 'session-two', action: 'next' });
  assert.equal(service.snapshot().selectedIndex, 0);
  await service.action({ sessionId: 'session-two', action: 'accept' });
  assert.deepEqual(host.navigations, [entry('second').url, entry('first').url]);
});

test('Google can be clicked but cannot be removed, and candidate acceptance rejects unrelated URLs', async (context) => {
  const { state, host, service, request, mounted } = fixture(context);
  await service.show(request({ query: 'https://example.invalid/path' }));
  mounted();
  const google = 'https://www.google.com/search?q=https%3A%2F%2Fexample.invalid%2Fpath';
  await service.action({ sessionId: 'session-one', action: 'remove', url: google });
  await service.action({ sessionId: 'session-one', action: 'accept', url: 'https://unrelated.invalid/' });
  assert.equal(state.removes.length, 0);
  assert.equal(host.navigations.length, 0);
  await service.action({ sessionId: 'session-one', action: 'accept', url: google });
  assert.deepEqual(host.navigations, [google]);
  await service.show(request({ sessionId: 'session-two', requestId: 2, query: '   ' }));
  await service.action({ sessionId: 'session-two', action: 'accept', url: google });
  assert.deepEqual(host.navigations, [google]);
});

test('popup bounds stay within small windows and resize dismisses when no vertical space remains', async (context) => {
  const { win, service, request, mounted } = fixture(context);
  await service.show(request({ anchor: { x: -25, y: -10, width: 100, height: 32 } }));
  const view = mounted();
  assertClipped(view, win);
  win.size = [180, 90];
  win.emit('resize');
  assertClipped(view, win);
  await service.show(request({ requestId: 2, anchor: { x: 999, y: 25, width: 1000, height: 32 } }));
  assertClipped(view, win);
  win.size = [180, 20];
  win.emit('resize');
  assert.equal(service.snapshot().sessionId, null);
  assert.equal(win.children.includes(view), false);
});

test('address blur retains popup mouse targets, while focus moving outside dismisses', async (context) => {
  const { state, win, service, request, mounted } = fixture(context);
  context.mock.timers.enable({ apis: ['setTimeout'] });
  await service.show(request());
  const view = mounted();
  service.addressBlur('session-one');
  state.focused = view.webContents;
  context.mock.timers.tick(0);
  assert.equal(service.snapshot().sessionId, 'session-one');
  state.focused = win.webContents;
  view.webContents.emit('blur');
  context.mock.timers.tick(0);
  assert.equal(service.snapshot().sessionId, 'session-one');
  state.focused = new MockWebContents();
  view.webContents.emit('blur');
  context.mock.timers.tick(0);
  assert.equal(service.snapshot().sessionId, null);
  await service.show(request({ sessionId: 'session-two', requestId: 2 }));
  service.addressBlur('session-one');
  context.mock.timers.tick(0);
  assert.equal(service.snapshot().sessionId, 'session-two');
  service.addressBlur('session-two');
  context.mock.timers.tick(0);
  assert.equal(service.snapshot().sessionId, null);
});

test('window blur and main-frame navigation dismiss; invalid tab/unfocused requests do not attach', async (context) => {
  const { state, win, host, service, request, mounted } = fixture(context);
  await service.show(request({ tabId: 'other-tab' }));
  win.focused = false;
  await service.show(request());
  assert.equal(state.views.length, 0);
  win.focused = true;
  await service.show(request());
  mounted();
  win.webContents.emit('did-start-navigation', {}, 'https://elsewhere.invalid', false, false);
  assert.equal(service.snapshot().sessionId, 'session-one');
  win.webContents.emit('did-start-navigation', {}, 'https://elsewhere.invalid', false, true);
  assert.equal(service.snapshot().sessionId, null);
  await service.show(request({ sessionId: 'session-two', requestId: 2 }));
  win.emit('blur');
  assert.equal(service.snapshot().sessionId, null);
  await service.show(request({ sessionId: 'session-three', requestId: 3 }));
  host.activeTabId = 'changed-tab';
  await service.action({ sessionId: 'session-three', action: 'accept', url: entry('first').url });
  assert.equal(host.navigations.length, 0);
});

test('renderer/window teardown releases native view, listeners and pending requests; stale tokens cannot mount replacements', async (context) => {
  const { state, win, service, request, mounted } = fixture(context);
  const pending = deferred();
  state.history.search = () => pending.promise;
  const showing = service.show(request());
  const oldToken = service.rendererToken;
  const oldView = mounted();
  assert.ok(win.listenerCount('resize') > 0);
  oldView.webContents.emit('render-process-gone');
  assert.equal(oldView.webContents.isDestroyed(), true);
  assert.equal(win.children.includes(oldView), false);
  assert.equal(win.listenerCount('resize'), 0);
  assert.equal(win.listenerCount('blur'), 0);
  assert.equal(win.listenerCount('closed'), 0);
  assert.equal(win.webContents.listenerCount('did-start-navigation'), 0);
  pending.resolve([entry('late')]);
  await showing;
  assert.equal(service.snapshot().sessionId, null);
  state.history.search = async () => [entry('new')];
  await service.show(request({ sessionId: 'session-two', requestId: 2 }));
  const newView = state.views.at(-1);
  service.mounted(oldToken);
  assert.equal(win.children.includes(newView), false);
  mounted();
  assert.equal(win.children.at(-1), newView);
  win.emit('closed');
  assert.equal(newView.webContents.isDestroyed(), true);
  assert.equal(win.listenerCount('resize'), 0);
  assert.equal(service.snapshot().sessionId, null);
});

test('popup crash rejects delayed shows from the old address session while a fresh session can reopen', async (context) => {
  const { state, win, service, request, mounted } = fixture(context);
  await service.show(request());
  const crashed = mounted();
  crashed.webContents.emit('render-process-gone');
  const afterCrash = service.snapshot();
  assert.equal(afterCrash.sessionId, null);
  assert.equal(afterCrash.dismissedSessionId, 'session-one');
  await service.show(request({ requestId: 2, query: 'delayed input' }));
  assert.deepEqual(service.snapshot(), afterCrash);
  assert.equal(state.views.length, 1);
  assert.equal(win.children.includes(crashed), false);
  await service.show(request({ sessionId: 'session-two', requestId: 3, query: 'fresh input' }));
  assert.equal(service.snapshot().sessionId, 'session-two');
  assert.equal(state.views.length, 2);
  const replacement = mounted();
  assert.notEqual(replacement, crashed);
  assert.equal(win.children.at(-1), replacement);
});
