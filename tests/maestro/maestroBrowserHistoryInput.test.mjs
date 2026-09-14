import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
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
  'electron-xpc/renderer': 'export const createXpcRendererEmitter = () => globalThis.popup; export const xpcRenderer = { subscribe: (name, callback) => globalThis.subscriptions.set(name, callback) };',
});
const recorderCode = await bundle('src/main/maestro/windows/main/browserHistoryRecorder.ts');
const addressCode = await bundle('src/shared/maestro/browserAddress.service.ts');

const fixture = () => {
  const calls = [];
  const subscriptions = new Map();
  const module = { exports: {} };
  class Element { closest() { return null; } }
  const input = new Element();
  Object.assign(input, { value: '', disabled: false, getBoundingClientRect: () => ({ x: 90, y: 36, width: 600, height: 30 }), focus: () => calls.push(['focus']) });
  const popup = Object.fromEntries(['show', 'hide', 'action', 'addressBlur'].map((name) => [name, async (params) => { calls.push([name, params]); }]));
  runInNewContext(inputCode, {
    module, exports: module.exports, popup, subscriptions, crypto: { randomUUID }, Element,
    document: { addEventListener() {}, removeEventListener() {} },
    window: { addEventListener() {}, removeEventListener() {} },
    ResizeObserver: class { observe() {} disconnect() {} },
  });
  const store = module.exports.browserHistoryStore;
  store.bind(input);
  store.setActiveTab('tab-1');
  const currentRequest = () => calls.filter(([name]) => name === 'show').at(-1)?.[1];
  const receive = (patch = {}) => store.receive({ revision: 1, sessionId: currentRequest().sessionId, query: currentRequest().query, entries: [{ url: 'https://example.invalid/a', title: 'A', favicon: '', visitCount: 1, lastVisitedAt: 1 }, { url: 'https://example.invalid/b', title: 'B', favicon: '', visitCount: 1, lastVisitedAt: 1 }], selectedIndex: -1, loading: false, error: false, ...patch });
  return { store, calls, input, currentRequest, receive };
};
const key = (value, options = {}) => ({ key: value, prevented: false, preventDefault() { this.prevented = true; }, ...options });

test('focus shows matches; arrows select and Enter uses the exact selected URL without waiting on XPC', () => {
  const f = fixture();
  f.input.value = 'example';
  f.store.focus();
  assert.equal(f.currentRequest().query, 'example');
  f.receive();
  f.store.keydown(key('ArrowDown'));
  assert.equal(f.store.selectedIndex, 0);
  assert.equal(f.store.candidateUrls[0], 'https://www.google.com/search?q=example');
  f.store.keydown(key('ArrowDown'));
  f.store.keydown(key('Enter'));
  assert.equal(f.calls.at(-1)[1].url, 'https://example.invalid/a');
  assert.equal(f.calls.at(-1)[1].action, 'accept');
});

test('fresh typing clears stale selection; ordinary Enter stays on the existing URL/path navigation path', () => {
  const f = fixture();
  f.store.focus(); f.receive(); f.store.keydown(key('ArrowUp'));
  assert.equal(f.store.selectedIndex, 1);
  f.input.value = '/Users/example/document.pdf';
  f.store.inputChanged();
  assert.equal(f.store.selectedIndex, -1);
  assert.equal(f.store.keydown(key('Enter')), false);
  f.receive({ revision: 2, query: 'stale query' });
  assert.equal(f.store.entries.length, 0);
});

test('Escape closes, Tab keeps normal focus traversal, dismissed queries never reopen the UI', () => {
  const f = fixture();
  f.store.focus();
  const request = f.currentRequest();
  const escape = key('Escape');
  f.store.keydown(escape);
  assert.equal(escape.prevented, true);
  f.receive();
  assert.equal(f.store.open, false);
  f.store.toggle();
  assert.notEqual(f.currentRequest().sessionId, request.sessionId);
  const tab = key('Tab');
  f.store.keydown(tab);
  assert.equal(tab.prevented, false);
  assert.equal(f.store.open, false);
});

test('stale dismissal from an earlier session cannot close a reopened history list', () => {
  const f = fixture();
  f.store.focus(); const old = f.currentRequest().sessionId;
  f.store.hide(); f.store.toggle();
  f.receive({ revision: 10, sessionId: null, dismissedSessionId: old });
  assert.equal(f.store.open, true);
  f.receive({ revision: 11, sessionId: null, dismissedSessionId: f.currentRequest().sessionId });
  assert.equal(f.store.open, false);
});

test('IME keys do not navigate or select and composition completion queries the committed text', () => {
  const f = fixture();
  f.store.focus(); f.receive();
  f.store.compositionStart();
  const before = f.calls.length;
  assert.equal(f.store.keydown(key('Enter', { isComposing: true })), true);
  f.store.keydown(key('ArrowDown', { keyCode: 229 }));
  assert.equal(f.calls.length, before);
  f.input.value = '发现';
  f.store.compositionEnd();
  assert.equal(f.currentRequest().query, '发现');
  assert.equal(f.store.selectedIndex, -1);
});

test('history toggle supports locked non-web addresses and active-tab changes dismiss', () => {
  const f = fixture();
  f.input.disabled = true;
  f.input.value = 'bitterless://only-preview';
  f.store.focus(); assert.equal(f.store.open, false);
  f.store.toggle(); assert.equal(f.store.open, true); assert.equal(f.currentRequest().query, '');
  assert.equal(f.input.value, 'bitterless://only-preview');
  f.store.setActiveTab('tab-2'); assert.equal(f.store.open, false);
});

test('plain text Enter resolves to Google while explicit URLs and local paths retain their navigation route', () => {
  const module = { exports: {} };
  runInNewContext(addressCode, { module, exports: module.exports });
  const { addressSubmissionTarget, googleSearchUrl } = module.exports;
  const query = '发现 Vue & 中文 100% #指南';
  assert.equal(new URL(addressSubmissionTarget(query)).searchParams.get('q'), query);
  assert.equal(googleSearchUrl('  '), '');
  for (const value of ['https://example.invalid/a?q=中文', 'example.invalid/a b', 'localhost:8080/app', '192.168.1.1', '[::1]:8080', '/Users/example/a b.pdf', 'C:\\Users\\example\\a b.pdf', '\\\\server\\shared\\file.pdf', 'file:///Users/example/test.pdf', 'bitterless://workbench']) {
    assert.equal(addressSubmissionTarget(value), value);
  }
});

test('Google is keyboard selectable for nonempty text even before history has loaded', () => {
  const f = fixture();
  f.input.value = '发现 & 100%';
  f.store.inputChanged();
  f.store.keydown(key('ArrowDown'));
  f.store.keydown(key('Enter'));
  assert.equal(new URL(f.calls.at(-1)[1].url).searchParams.get('q'), f.input.value);
  assert.equal(f.calls.at(-1)[1].action, 'accept');
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
