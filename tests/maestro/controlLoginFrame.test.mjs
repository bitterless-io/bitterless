/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { compileScript, parse } from '@vue/compiler-sfc';
import less from 'less';

const root = resolve(import.meta.dirname, '../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const file = 'src/renderer/maestro/control/src/ControlAuthApp.vue';
const { descriptor, errors } = parse(read(file), { filename: file });
assert.deepEqual(errors, []);
const script = compileScript(descriptor, { id: file });
const bundle = await build({
  stdin: { contents: script.content, loader: 'ts', resolveDir: root },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  plugins: [
    {
      name: 'control-frame-boundary',
      setup(context) {
        context.onResolve({ filter: /.*/ }, ({ path }) => ({ path, namespace: 'frame-mock' }));
        context.onLoad({ filter: /.*/, namespace: 'frame-mock' }, ({ path }) => {
          let contents = 'export default {};';
          if (path === 'vue')
            contents = `
          export const defineComponent = value => value;
          export const ref = value => ({ value });
          export const computed = getter => ({ get value() { return getter(); } });
          export const defineAsyncComponent = () => ({});
          export const nextTick = callback => Promise.resolve().then(callback);
          export const watch = (source, callback) => globalThis.__controlFrame.watchers.push({ source, callback });
          export const onMounted = callback => globalThis.__controlFrame.mounted.push(callback);
          export const onBeforeUnmount = callback => globalThis.__controlFrame.unmounted.push(callback);
        `;
          else if (path === '@arco-design/web-vue')
            contents = 'export const Button = {}, Spin = {};';
          else if (path === '@tabler/icons-vue') contents = 'export const IconX = {};';
          else if (path === 'electron-xpc/renderer')
            contents = 'export const xpcRenderer = { broadcast() {} };';
          else if (path.endsWith('i18n.helper')) contents = 'export const i18nHelper = {};';
          else if (path.endsWith('localHomeAuth.store'))
            contents = 'export const localHomeAuthStore = globalThis.__controlFrame.auth;';
          else if (path.endsWith('controlSubscriptions.service'))
            contents = 'export class ControlSubscriptionScope { subscribe() {} dispose() {} }';
          else if (path.endsWith('.less')) contents = '';
          return { contents, loader: 'js' };
        });
      }
    }
  ]
});

test('login frame follows initial/window focus and disposes listeners when chat replaces it or app unmounts', async () => {
  const oldWindow = globalThis.window;
  const oldDocument = globalThis.document;
  const listeners = new Map();
  let focused = false;
  const state = {
    auth: { ready: false, loggingOut: false, authResolved: false, snapshot: null },
    watchers: [],
    mounted: [],
    unmounted: []
  };
  globalThis.__controlFrame = state;
  globalThis.document = { hasFocus: () => focused };
  globalThis.window = {
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name, callback) => {
      if (listeners.get(name) === callback) listeners.delete(name);
    }
  };
  try {
    const module = { exports: {} };
    new Function('module', 'exports', bundle.outputFiles[0].text)(module, module.exports);
    const exposed = module.exports.default.setup(
      {},
      {
        expose() {
          return undefined;
        }
      }
    );
    for (const mounted of state.mounted) mounted();
    assert.equal(exposed.panelFocused.value, false);
    assert.deepEqual([...listeners.keys()], ['focus', 'blur']);
    listeners.get('focus')();
    assert.equal(exposed.panelFocused.value, true);
    listeners.get('blur')();
    assert.equal(exposed.panelFocused.value, false);

    const focusWatcher = state.watchers.find(({ source }) => source === exposed.loginVisible);
    state.auth.ready = true;
    focusWatcher.callback(focusWatcher.source.value);
    assert.equal(listeners.size, 0);
    focused = true;
    state.auth.ready = false;
    focusWatcher.callback(focusWatcher.source.value);
    assert.equal(exposed.panelFocused.value, true);
    assert.equal(listeners.size, 2);
    for (const unmount of state.unmounted) unmount();
    assert.equal(listeners.size, 0);
    assert.equal(exposed.panelFocused.value, false);
    await Promise.resolve();
  } finally {
    globalThis.window = oldWindow;
    globalThis.document = oldDocument;
    delete globalThis.__controlFrame;
  }
});

test('login uses the exact existing warm rounded Control frame, keeps shadow clearance and scrollable transparent content', async () => {
  const source = read(file);
  assert.match(source, /class="control-app control-auth"/);
  assert.match(
    source,
    /class="control-app__card"\s+:class="\{ 'control-app__card--focused': panelFocused \}"/
  );
  assert.match(source, /name="control-auth__close"/);
  assert.match(source, /@pointerdown="beginResize"/);
  assert.match(source, /<Login v-else :auth="localHomeAuthStore" compact/);
  const compiled = compileScript(descriptor, { id: file, inlineTemplate: true });
  assert.ok(compiled.content.includes('control-app__card--focused'));
  const authCss = read('src/renderer/maestro/control/src/ControlAuthApp.less');
  assert.doesNotMatch(authCss, /background\s*:|border-radius\s*:|box-shadow\s*:/);
  const { css } = await less.render(
    [
      read('src/renderer/maestro/control/src/ControlApp.less'),
      authCss,
      read('src/renderer/home/src/views/login/Login.less')
    ].join('\n')
  );
  assert.match(css, /\.control-app\s*\{[^}]*--control-chat-surface: #fffcf7;[^}]*padding: 8px;/);
  assert.match(
    css,
    /\.control-app__card\s*\{[^}]*min-height: 0;[^}]*flex: 1;[^}]*border-radius: 16px;[^}]*background: var\(--control-chat-surface\)/
  );
  assert.match(
    css,
    /\.control-app__card--focused\s*\{\s*box-shadow: 0 0 0 2px rgba\(var\(--primary-6\), 0.35\)/
  );
  assert.match(css, /\.login-view\s*\{[^}]*min-height: 0;[^}]*overflow: auto;/);
  assert.match(css, /\.login-view--compact\s*\{[^}]*display: flex;[^}]*flex-direction: column;[^}]*flex: 1;[^}]*background: transparent;[^}]*align-items: stretch;/);
  assert.doesNotMatch(css, /\.login-view--compact\s*\{[^}]*align-items: start;/);
  assert.match(
    css,
    /\.login-view--compact \.login-view__panel\s*\{[^}]*flex: 0 0 auto;[^}]*margin-block: auto;[^}]*background: transparent;[^}]*box-shadow: none;/
  );
  assert.match(css, /\.control-auth__status\s*\{[^}]*min-height: 0;[^}]*overflow: auto;/);
});
