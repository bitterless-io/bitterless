import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { compileScript, parse } from '@vue/compiler-sfc';

const root = resolve(import.meta.dirname, '../..');
const dom = new JSDOM('<!doctype html><html><body></body></html>');
for (const key of ['window', 'document', 'Element', 'Node', 'HTMLElement', 'SVGElement']) globalThis[key] = dom.window[key];
// Vue runtime-dom captures document at import time, after the DOM above is installed.
const require = createRequire(import.meta.url);
const { createApp, nextTick } = require('vue');
const runtime = { popup: null };
globalThis.__historyClickRuntime = runtime;
test.after(() => { delete globalThis.__historyClickRuntime; dom.window.close(); });
const mocks = {
  'electron-xpc/renderer': `
    export const createXpcRendererEmitter = () => ({ action: params => globalThis.__historyClickRuntime.popup.action(params) });
    export const xpcRenderer = { subscribe() {} };
  `,
  '@renderer/common/i18n/i18n.helper': `export const i18nHelper = { browserHistory: {
    title: 'History', hide: 'Hide', remove: 'Remove', retry: 'Retry', error: 'Error', loading: 'Loading',
    empty: 'Empty', noMatches: 'No matches', searchGoogle: 'Search Google for {query}'
  } };`,
  '@tabler/icons-vue': `import { h } from 'vue'; const icon = { render: () => h('svg') }; export const IconHistory = icon, IconSearch = icon, IconX = icon;`,
  // Keep the actual IconBtn wrapper; substitute the library's native button boundary only.
  '@arco-design/web-vue': `import { h } from 'vue'; export const Button = { inheritAttrs: false,
    setup(_, { attrs, slots }) { return () => h('button', { ...attrs, type: attrs['html-type'] || 'button' }, slots.icon?.() || slots.default?.()); }
  };`,
};
const bundle = await build({
  stdin: { contents: `
    export { default as HistoryApp } from './src/renderer/maestro/history/src/HistoryApp.vue';
    export { historyStore } from './src/renderer/maestro/history/src/history.store';
    export { Button } from '@arco-design/web-vue';
  `, resolveDir: root },
  bundle: true, platform: 'node', format: 'cjs', target: 'node22', write: false, external: ['vue'],
  tsconfig: resolve(root, 'tsconfig.web.json'),
  plugins: [{ name: 'history-click-dom-boundaries', setup(context) {
    context.onResolve({ filter: /.*/ }, ({ path }) => Object.hasOwn(mocks, path) ? { path, namespace: 'mock' } : undefined);
    context.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({ contents: mocks[path], loader: 'js' }));
    context.onLoad({ filter: /\.vue$/ }, ({ path }) => {
      const descriptor = parse(readFileSync(path, 'utf8'), { filename: path }).descriptor;
      return { contents: compileScript(descriptor, { id: path, inlineTemplate: true }).content, loader: 'ts' };
    });
    context.onLoad({ filter: /\.less$/ }, () => ({ contents: '', loader: 'js' }));
  } }],
});
const entry = { url: 'https://history.invalid/page?q=中文#route', title: '中文页面', favicon: '', visitCount: 1, lastVisitedAt: 1 };
function fixture(context, snapshot = {}) {
  const calls = [];
  runtime.popup = { action: async params => { calls.push(params); } };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, module, module.exports);
  const { HistoryApp, historyStore, Button } = module.exports;
  historyStore.receive({ session: 1, revision: 1, query: '', entries: [entry], selectedIndex: -1, loading: false, error: false, ...snapshot });
  const container = document.createElement('div');
  document.body.append(container);
  const app = createApp(HistoryApp);
  app.component('a-button', Button);
  app.mount(container);
  context.after(() => { app.unmount(); container.remove(); });
  const find = name => {
    const node = container.querySelector(`[name="${name}"]`);
    assert.ok(node, name);
    return node;
  };
  const clickOnce = async target => {
    target.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    target.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    // An IPC action can run between mouseup and click. Nothing may restore address focus here.
    await nextTick();
    assert.equal(calls.length, 0, 'No action, particularly focus, may run before the click');
    target.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await nextTick();
    assert.equal(calls.length, 1, 'One completed click performs exactly one action');
  };
  return { calls, container, find, clickOnce, historyStore };
}

test('one history-row click accepts its exact URL without an earlier focus action', async context => {
  const f = fixture(context);
  await f.clickOnce(f.find('browser-history__visit').querySelector('.browser-history__title'));
  assert.deepEqual(f.calls, [{ session: 1, revision: 1, action: 'accept', url: entry.url }]);
});

test('one Google-row click accepts the correctly encoded original query', async context => {
  const query = '  发现 & 100% #指南  ';
  const f = fixture(context, { query });
  await f.clickOnce(f.find('browser-history__google-search').querySelector('svg'));
  assert.equal(f.calls[0].action, 'accept');
  assert.equal(new URL(f.calls[0].url).searchParams.get('q'), query);
});

test('one remove click only removes its history URL and never accepts the surrounding row', async context => {
  const f = fixture(context);
  await f.clickOnce(f.find('browser-history__remove').querySelector('svg'));
  assert.deepEqual(f.calls, [{ session: 1, revision: 1, action: 'remove', url: entry.url }]);
});

test('one close click sends close without a preceding focus action', async context => {
  const f = fixture(context);
  await f.clickOnce(f.find('browser-history__close'));
  assert.equal(f.calls[0].action, 'close');
});

test('one retry click sends retry without a preceding focus action', async context => {
  const f = fixture(context, { error: true });
  await f.clickOnce(f.container.querySelector('[role="alert"] button'));
  assert.equal(f.calls[0].action, 'retry');
});

test('pressing without releasing, and clicks on empty popup space, perform no action', async context => {
  const f = fixture(context);
  f.find('browser-history__visit').dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
  for (const type of ['mouseup', 'click']) f.find('browser-history__panel').dispatchEvent(new window.MouseEvent(type, { bubbles: true }));
  await nextTick();
  assert.equal(f.calls.length, 0);
});

test('Enter and Space on a button keep native activation and do not also accept through the root', async context => {
  for (const key of ['Enter', ' ']) {
    const f = fixture(context);
    const button = f.find('browser-history__visit');
    const down = new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    button.dispatchEvent(down);
    button.dispatchEvent(new window.KeyboardEvent('keyup', { key, bubbles: true }));
    assert.equal(down.defaultPrevented, false);
    assert.equal(f.calls.length, 0);
    // jsdom does not synthesize keyboard activation clicks; provide the native-button click here.
    button.click();
    await nextTick();
    assert.deepEqual(f.calls, [{ session: 1, revision: 1, action: 'accept', url: entry.url }]);
  }
});

test('root keyboard selection, acceptance, dismissal and IME guards remain intact', async context => {
  const f = fixture(context);
  const root = f.find('browser-history');
  for (const key of ['ArrowDown', 'Enter']) root.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, isComposing: true }));
  assert.equal(f.calls.length, 0);
  for (const [key, action] of [['ArrowDown', 'next'], ['ArrowUp', 'previous'], ['Enter', 'accept'], ['Escape', 'close'], ['Tab', 'close']]) {
    root.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    assert.equal(f.calls.at(-1).action, action);
  }
  assert.equal(f.calls.length, 5);
});
