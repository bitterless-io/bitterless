import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { EventEmitter } from 'node:events';
import { resolve } from 'node:path';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '../..');
const bundle = async (entry, mocks = {}) => (await build({
  entryPoints: [resolve(root, entry)], bundle: true, platform: 'node', format: 'cjs', target: 'node22',
  write: false, tsconfig: resolve(root, 'tsconfig.web.json'),
  plugins: [{ name: 'history-test', setup(context) {
    context.onResolve({ filter: /.*/ }, ({ path }) => Object.hasOwn(mocks, path) ? { path, namespace: 'mock' } : undefined);
    context.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({ contents: mocks[path], loader: 'js' }));
  } }],
})).outputFiles[0].text;
const inputCode = await bundle('src/renderer/maestro/home/src/components/MenuBar/browserHistory.store.ts', {
  vue: 'export const reactive = (value) => value; export const nextTick = () => Promise.resolve();',
  'electron-xpc/renderer': 'export const createXpcRendererEmitter = name => globalThis.emitters[name]; export const xpcRenderer = { subscribe: (name, callback) => globalThis.subscriptions.set(name, callback) };',
});
const recorderCode = await bundle('src/main/maestro/windows/main/browserHistoryRecorder.ts');
const addressCode = await bundle('src/shared/maestro/browserAddress.service.ts');
const menuCode = await bundle('src/renderer/maestro/home/src/components/MenuBar/menuBar.store.ts', {
  vue: 'export const reactive = (value) => value; export const nextTick = () => Promise.resolve();',
  './browserHistory.store': 'export const browserHistoryStore = globalThis.homeStore;',
  'electron-xpc/renderer': 'export const createXpcRendererEmitter = () => globalThis.coach; export const xpcRenderer = { subscribe: (name, callback) => globalThis.subscriptions.set(name, callback) };',
});
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const entry = (title = 'first') => ({ url: `https://example.invalid/${title}`, title, favicon: '', visitCount: 1, lastVisitedAt: 1 });
const fixture = () => {
  const calls = [], logs = [], timers = new Map(), subscriptions = new Map();
  let timerId = 0;
  const module = { exports: {} };
  class Element { closest() { return null; } }
  const input = Object.assign(new Element(), { value: '', disabled: false, getBoundingClientRect: () => ({ x: 90, y: 36, width: 600, height: 30 }), focus: () => calls.push(['focus']) });
  const popup = { update: async state => { calls.push(['update', state]); return true; }, hide: async state => { calls.push(['hide', state]); }, blur: async () => calls.push(['blur']) };
  const history = { search: async params => { calls.push(['search', params]); return [entry(), entry('second')]; }, remove: async params => { calls.push(['remove', params]); } };
  const coach = { backgroundWorkbenchTab: async () => calls.push(['background']), getTabs: async () => [{ active: true, kind: 'browser' }], navigate: async params => calls.push(['navigate', params]), openTab: async params => calls.push(['openTab', params]) };
  runInNewContext(inputCode, {
    module, exports: module.exports, emitters: { BrowserHistoryPopupHandler: popup, BrowserHistoryDao: history, CoachXpcHandler: coach }, subscriptions, Element,
    console: { info: (...args) => logs.push(args) },
    document: { addEventListener() {}, removeEventListener() {} }, window: { addEventListener() {}, removeEventListener() {} },
    setTimeout: (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; }, clearTimeout: id => timers.delete(id),
    ResizeObserver: class { observe() {} disconnect() {} },
  });
  const store = module.exports.browserHistoryStore;
  store.bind(input); store.setActiveTab('tab-1');
  const current = () => calls.filter(([name]) => name === 'update').at(-1)?.[1];
  const tick = async () => { for (const [id, timer] of [...timers]) { timers.delete(id); assert.equal(timer.ms, 90); timer.fn(); } await settle(); };
  const action = async (action, url) => { const { session, revision } = current(); await store.action({ session, revision, action, url }); await settle(); };
  return { store, calls, logs, input, popup, history, coach, current, tick, action, subscriptions };
};
const key = (value, options = {}) => ({ key: value, prevented: false, preventDefault() { this.prevented = true; }, ...options });

test('blank focus/input/IME and arrow keys stay closed; explicit toggle searches recents', async () => {
  for (const value of ['', ' \t\n', '\u3000']) {
    const f = fixture(); f.input.value = value; f.store.focus(); f.store.inputChanged(); f.store.compositionStart(); f.store.compositionEnd();
    for (const direction of ['ArrowDown', 'ArrowUp']) assert.equal(f.store.keydown(key(direction)), false);
    assert.equal(f.store.open, false); assert.equal(f.calls.length, 0);
    f.store.toggle(); await settle(); assert.equal(f.store.open, true); assert.equal(f.current().query, ''); assert.equal(f.store.entries.length, 2);
  }
});

test('typing debounces 90ms, immediately clears selection, and preserves original Google query', async () => {
  const f = fixture(); f.input.value = '  发现 & 100%  '; f.store.inputChanged();
  assert.equal(f.current().loading, true); assert.equal(f.calls.some(([name]) => name === 'search'), false);
  assert.equal(new URL(f.store.candidateUrls[0]).searchParams.get('q'), f.input.value);
  await f.tick(); assert.equal(f.store.entries.length, 2);
  f.store.keydown(key('ArrowDown')); f.input.value = 'new'; f.store.inputChanged();
  assert.equal(f.store.selectedIndex, -1); assert.equal(f.store.entries.length, 0);
});

test('old search cannot flash results during new debounce or reopen after clearing', async () => {
  const f = fixture(), old = deferred(); f.history.search = () => old.promise;
  f.input.value = 'old'; f.store.focus(); f.input.value = 'new'; f.store.inputChanged();
  old.resolve([entry('stale')]); await settle(); assert.equal(f.store.entries.length, 0);
  f.input.value = ''; f.store.inputChanged(); await f.tick(); assert.equal(f.store.open, false);
  assert.equal(f.current().entries.length, 0);
});

test('null IPC or thrown query errors become retryable state; retry and empty result remain visible', async () => {
  for (const result of [null, 'invalid', new Error('private-query-should-not-log')]) {
    const f = fixture(); f.history.search = async () => { if (result instanceof Error) throw result; return result; };
    f.store.toggle(); await settle(); assert.equal(f.store.open, true); assert.equal(f.store.error, true); assert.equal(f.current().error, true);
    f.history.search = async () => []; await f.action('retry'); assert.equal(f.store.error, false); assert.equal(f.store.open, true); assert.equal(f.current().entries.length, 0);
    assert.equal(JSON.stringify(f.logs).includes('private-query-should-not-log'), false);
  }
});

test('focus restoration never republishes unchanged open history; stale update rejection cannot close newer revision', async () => {
  const f = fixture(), pending = deferred(); const update = f.popup.update;
  f.popup.update = state => { void update(state); return pending.promise; };
  f.input.value = 'first'; f.store.focus(); await settle();
  f.popup.update = update; f.input.value = 'second'; f.store.inputChanged();
  const revision = f.current().revision; f.store.focus(); assert.equal(f.current().revision, revision);
  pending.reject(new Error('late')); await settle(); assert.equal(f.store.open, true);
});

test('keyboard/Google/history acceptance navigates once; plain Enter keeps original navigation route', async () => {
  const f = fixture(); f.input.value = ' 搜索 & cats#? '; f.store.focus(); await settle();
  f.store.keydown(key('ArrowDown')); f.store.keydown(key('Enter')); await settle();
  assert.equal(new URL(f.calls.find(([name]) => name === 'navigate')[1].url).searchParams.get('q'), f.input.value);
  f.store.toggle(); await settle(); f.store.keydown(key('ArrowDown')); f.store.keydown(key('Enter')); await settle();
  assert.equal(f.calls.filter(([name]) => name === 'navigate').at(-1)[1].url, entry().url);
  f.input.value = 'unselected'; f.store.focus(); assert.equal(f.store.keydown(key('Enter')), false);
});

test('arrow selection cycles through Google and saved history, and recents contain only history', async () => {
  const f = fixture(); f.input.value = 'query'; f.store.focus(); await settle();
  for (const expected of [0, 1, 2, 0]) { f.store.keydown(key('ArrowDown')); assert.equal(f.store.selectedIndex, expected); }
  f.store.keydown(key('ArrowUp')); assert.equal(f.store.selectedIndex, 2);
  f.store.hide(); f.store.toggle(); await settle();
  assert.equal(f.store.candidateUrls.length, 2);
  for (const expected of [0, 1, 0]) { f.store.keydown(key('ArrowDown')); assert.equal(f.store.selectedIndex, expected); }
  f.store.keydown(key('ArrowUp')); assert.equal(f.store.selectedIndex, 1);
});

test('one remove invalidates pending data and refreshes; stale session/revision actions do nothing', async () => {
  const f = fixture(); f.store.toggle(); await settle(); const old = f.current();
  await f.action('remove', entry().url); assert.equal(f.calls.filter(([name]) => name === 'remove').length, 1);
  await f.store.action({ session: old.session, revision: old.revision, action: 'accept', url: entry().url });
  assert.equal(f.calls.some(([name]) => name === 'navigate'), false);
  const removing = deferred(); f.history.remove = () => removing.promise;
  const action = f.action('remove', entry().url); f.store.hide(); f.store.toggle(); await settle(); const latest = f.current();
  removing.resolve(); await action; assert.equal(f.current().revision, latest.revision); assert.equal(f.current().session, latest.session);
});

test('IME clears popup and cannot navigate; Escape, Tab, native dismissal and tab switch invalidate sessions', async () => {
  const f = fixture(); f.store.toggle(); await settle(); f.store.compositionStart();
  assert.equal(f.store.open, false); assert.equal(f.store.keydown(key('Enter', { isComposing: true })), true);
  f.input.value = '发现'; f.store.compositionEnd(); await f.tick(); assert.equal(f.current().query, '发现');
  const old = f.current(); f.store.keydown(key('Escape')); assert.equal(f.store.open, false);
  f.store.toggle(); await settle(); const current = f.current(); assert.ok(current.session > old.session);
  f.subscriptions.get('coach/history-closed')({ params: { session: old.session } }); assert.equal(f.store.open, true);
  f.subscriptions.get('coach/history-closed')({ params: { session: current.session } }); assert.equal(f.store.open, false);
  f.store.toggle(); await settle(); const tab = key('Tab'); f.store.keydown(tab); assert.equal(tab.prevented, false);
  f.store.toggle(); f.store.setActiveTab('tab-2'); assert.equal(f.store.open, false);
});

test('locked addresses allow recents and open accepted history in a new tab', async () => {
  const f = fixture(); f.input.disabled = true; f.input.value = 'bitterless://only-preview'; f.store.focus(); assert.equal(f.store.open, false);
  f.coach.getTabs = async () => [{ active: true, kind: 'composite' }]; f.store.toggle(); await settle(); await f.action('accept', entry().url);
  assert.equal(f.calls.find(([name]) => name === 'openTab')[1].url, entry().url); assert.equal(f.input.value, 'bitterless://only-preview');
});

test('address diagnostic lines preserve phases without browsing values or session identities', async () => {
  const f = fixture(); const sentinel = 'private-sentinel-query'; f.input.value = sentinel; f.store.focus(); await settle();
  const session = String(f.current().session); f.store.hide();
  assert.ok(f.logs.some(([line]) => line.includes('address.query.result'))); assert.ok(f.logs.some(([line]) => line.includes('address.dispatch.begin')));
  for (const args of f.logs) { assert.equal(args.length, 1); assert.equal(typeof args[0], 'string'); }
  assert.equal(JSON.stringify(f.logs).includes(sentinel), false); assert.equal(JSON.stringify(f.logs).includes(session), false);
});

test('MenuBar metadata snapshots preserve typed query and revision; URL/tab navigation dismisses', async () => {
  const f = fixture();
  const active = { id: 'tab-1', active: true, kind: 'browser', url: 'https://initial.invalid', title: 'Initial' };
  f.coach.getTabs = async () => [active];
  const module = { exports: {} };
  runInNewContext(menuCode, { module, exports: module.exports, coach: f.coach, subscriptions: f.subscriptions, homeStore: f.store, navigator: { userAgent: 'Mac' } });
  const menu = module.exports.menuBarStore;
  await menu.init(); menu.applyTabs([active]);
  menu.url = 'draft query'; f.input.value = menu.url; f.store.focus(); await settle();
  const revision = f.current().revision;
  menu.applyTabs([{ ...active, title: 'Late title', favicon: 'https://icon.invalid' }]);
  assert.equal(menu.url, 'draft query'); assert.equal(f.store.open, true); assert.equal(f.current().revision, revision);
  menu.applyTabs([{ ...active, url: 'https://navigated.invalid' }]);
  assert.equal(menu.url, 'navigated.invalid'); assert.equal(f.store.open, false);
  f.store.toggle(); menu.applyTabs([{ ...active, id: 'tab-2' }]);
  assert.equal(f.store.open, false);
});

test('plain text submission encodes Google while explicit URLs and paths retain their route', () => {
  const module = { exports: {} }; runInNewContext(addressCode, { module, exports: module.exports });
  const { addressSubmissionTarget } = module.exports;
  assert.equal(new URL(addressSubmissionTarget('发现 Vue & 100% #指南')).searchParams.get('q'), '发现 Vue & 100% #指南');
  for (const value of ['https://example.invalid/a?q=中文', 'localhost:8080/app', '/Users/example/a.pdf', 'bitterless://workbench']) assert.equal(addressSubmissionTarget(value), value);
});
test('recording covers successful main-frame/hash navigations and updates late metadata without another visit', async () => {
  const module = { exports: {} };
  runInNewContext(recorderCode, { module, exports: module.exports, URL, console, Date });
  const wc = new EventEmitter();
  let url = 'https://example.invalid/#/first';
  let browser = true;
  const calls = [];
  Object.assign(wc, { isDestroyed: () => false, getURL: () => url, getTitle: () => 'Late title' });
  module.exports.bindBrowserHistoryRecorder(wc, { isBrowser: () => browser, dismiss: () => {}, history: {
    record: async (params) => calls.push(['record', params]),
    updateMetadata: async (params) => calls.push(['metadata', params]),
  } });
  wc.emit('did-start-navigation', {}, url, false, true);
  wc.emit('did-navigate', {}, url, 200);
  wc.emit('page-title-updated', {}, 'Late title');
  wc.emit('page-favicon-updated', {}, ['https://example.invalid/icon.png']);
  wc.emit('did-finish-load');
  wc.emit('did-navigate-in-page', {}, url, true);
  url = 'https://example.invalid/#/second';
  wc.emit('did-navigate-in-page', {}, url, false);
  wc.emit('did-navigate-in-page', {}, url, true);
  assert.equal(calls.filter(([kind]) => kind === 'record').length, 2);
  assert.equal(calls.filter(([kind]) => kind === 'metadata').length, 3);
  assert.equal(calls.at(-1)[1].url, url);
  wc.emit('did-start-navigation', {}, 'https://error.invalid/', false, true);
  url = 'https://error.invalid/';
  wc.emit('did-navigate', {}, url, 500);
  wc.emit('did-finish-load');
  wc.emit('did-navigate-in-page', {}, url + '#error', true);
  browser = false;
  wc.emit('did-navigate', {}, 'http://localhost/maestro/localHome/index.html', 200);
  assert.equal(calls.filter(([kind]) => kind === 'record').length, 2);
});
