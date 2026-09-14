/* eslint-disable @typescript-eslint/explicit-function-return-type -- Native Node test fixtures. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { parse, compileTemplate } from '@vue/compiler-sfc';
import { baseParse } from '@vue/compiler-dom';
import less from 'less';
import postcss from 'postcss';

const directory = mkdtempSync(join(tmpdir(), 'zellij-settings-test-'));
const output = join(directory, 'settings.cjs');
const modules = {
  vue: 'exports.reactive=value=>value;',
  '@arco-design/web-vue': `const successes=[];exports.successes=successes;exports.Message={success:text=>successes.push(text)};`,
  '@renderer/common/i18n/i18n.helper': `exports.i18nHelper={zellij:{saved:'Shortcuts saved',copied:'Directory copied',status:{idle:'Opening',starting:'Opening',ready:'Connected',error:'Error'},errors:{'operation-failed':'Operation failed','config-invalid':'Invalid config','config-drift':'Refresh settings','shortcut-conflict':'Shortcut conflict','directory-open-failed':'Directory failed'}}};`,
  'electron-xpc/renderer': `
    const calls=[];const responses={snapshot:null,saveShortcuts:null};
    const api={};
    for(const method of ['snapshot','saveShortcuts','openSettings','initialize','copyConfigDirectory','openConfigDirectory']){
      api[method]=async params=>{calls.push({method,params});return responses[method]??{ok:true,error:null};};
    }
    exports.calls=calls;exports.responses=responses;
    exports.createXpcRendererEmitter=()=>api;
    exports.xpcRenderer={subscribe:()=>()=>{}};`
};
await build({
  stdin: {
    contents: `export {terminalSettingStore} from '${process.cwd()}/src/renderer/home/src/views/setting/components/TerminalSetting/terminalSetting.store.ts';export {zellijStore} from '${process.cwd()}/src/renderer/zellij/src/zellij.store.ts';export {calls,responses} from 'electron-xpc/renderer';export {successes} from '@arco-design/web-vue';`,
    resolveDir: process.cwd(),
    loader: 'ts'
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: output,
  alias: { '@shared': join(process.cwd(), 'src/shared') },
  plugins: [
    {
      name: 'settings-boundaries',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, (args) =>
          args.path in modules ? { path: args.path, namespace: 'fixture' } : undefined
        );
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
          contents: modules[args.path],
          loader: 'js'
        }));
      }
    }
  ]
});
const previousWindow = globalThis.window;
globalThis.window = { location: { search: '?surface=fixture-terminal' } };
const {
  terminalSettingStore: settings,
  zellijStore,
  calls,
  responses,
  successes
} = createRequire(import.meta.url)(output);
if (previousWindow === undefined) delete globalThis.window;
else globalThis.window = previousWindow;
const shortcuts = { splitDown: 'Super d', splitRight: 'Super Shift d', closePane: 'Super w' };
const snapshot = (overrides = {}) => ({
  status: 'idle',
  error: null,
  configExists: true,
  configRevision: 'revision-1',
  configDirectory: '/fixture/zellij',
  configFile: '/fixture/zellij/config.kdl',
  shortcuts: { ...shortcuts },
  ...overrides
});
test.beforeEach(() => {
  calls.length = 0;
  successes.length = 0;
  for (const key of Object.keys(responses)) delete responses[key];
  responses.snapshot = snapshot();
  Object.assign(settings, {
    loading: false,
    saving: false,
    ready: false,
    error: null,
    configDirectory: '',
    revision: '',
    draft: { splitDown: '', splitRight: '', closePane: '' }
  });
  Object.assign(zellijStore, { snapshot: null, initializing: false, error: null });
});
test.after(() => rmSync(directory, { recursive: true, force: true }));

test('shared Terminal settings load configuration without initializing a session or choosing a surface', async () => {
  await settings.load();
  assert.deepEqual(calls, [{ method: 'snapshot', params: { surfaceId: '' } }]);
  assert.equal(settings.ready, true);
  assert.equal(settings.loading, false);
  assert.equal(settings.revision, 'revision-1');
  assert.equal(settings.configDirectory, '/fixture/zellij');
  assert.deepEqual(settings.draft, shortcuts);
});

test('successful saves use the loaded revision and adopt canonical shortcuts and the new revision', async () => {
  await settings.load();
  settings.draft.splitDown = 'Alt d';
  const updated = { ...shortcuts, splitDown: 'Alt d' };
  responses.saveShortcuts = snapshot({ configRevision: 'revision-2', shortcuts: updated });
  await settings.save();
  assert.deepEqual(calls.at(-1), {
    method: 'saveShortcuts',
    params: { revision: 'revision-1', shortcuts: updated }
  });
  assert.equal(settings.revision, 'revision-2');
  assert.deepEqual(settings.draft, updated);
  assert.equal(settings.saving, false);
  assert.equal(settings.error, null);
  assert.deepEqual(successes, ['Shortcuts saved']);
  await settings.save();
  assert.equal(calls.at(-1).params.revision, 'revision-2');
  assert.equal(
    calls.some((call) => call.method === 'initialize'),
    false
  );
});

test('runtime-only errors do not prevent editing valid shared configuration', async () => {
  for (const error of ['start-failed', 'authentication-failed', 'operation-failed']) {
    responses.snapshot = snapshot({ status: 'error', error });
    await settings.load();
    assert.equal(settings.ready, true);
    assert.equal(settings.errorMessage, null);
    settings.draft.closePane = 'Alt w';
    responses.saveShortcuts = snapshot({
      status: 'error',
      error: null,
      shortcuts: { ...shortcuts, closePane: 'Alt w' }
    });
    await settings.save();
    assert.equal(settings.errorMessage, null);
    assert.equal(calls.at(-1).method, 'saveShortcuts');
  }
  assert.equal(
    calls.some((call) => call.method === 'initialize'),
    false
  );
  assert.equal(successes.length, 3);
});

test('configuration failures preserve unsaved shortcuts until the user refreshes', async () => {
  await settings.load();
  settings.draft.splitDown = 'Alt d';
  responses.saveShortcuts = snapshot({
    error: 'config-drift',
    configRevision: 'external-revision'
  });
  await settings.save();
  assert.equal(settings.errorMessage, 'Refresh settings');
  assert.equal(settings.revision, 'revision-1');
  assert.equal(settings.draft.splitDown, 'Alt d');
  assert.deepEqual(successes, []);
  responses.snapshot = snapshot({ configRevision: 'external-revision' });
  await settings.load();
  assert.equal(settings.errorMessage, null);
  assert.equal(settings.revision, 'external-revision');
  assert.deepEqual(settings.draft, shortcuts);
  responses.snapshot = snapshot({ configRevision: '', error: 'config-invalid' });
  await settings.load();
  const before = calls.length;
  await settings.save();
  assert.equal(settings.ready, false);
  assert.equal(settings.errorMessage, 'Invalid config');
  assert.equal(
    calls.length,
    before,
    'malformed config cannot be overwritten through shortcut fields'
  );
});

test('directory actions and the gear use their dedicated APIs without initializing a terminal', async () => {
  await settings.copyDirectory();
  await settings.openDirectory();
  await zellijStore.openSettings();
  assert.deepEqual(
    calls.map((call) => call.method),
    ['copyConfigDirectory', 'openConfigDirectory', 'openSettings']
  );
  assert.deepEqual(successes, ['Directory copied']);
});

test('settings preparation failure shows its error and blocks editing when no revision was ensured', async () => {
  responses.snapshot = snapshot({ configRevision: '', error: 'operation-failed' });
  await settings.load();
  assert.equal(settings.ready, false);
  assert.equal(settings.errorMessage, 'Operation failed');
  const before = calls.length;
  await settings.save();
  assert.equal(calls.length, before);
  assert.equal(
    calls.some((call) => call.method === 'initialize'),
    false
  );
});

test('terminal chrome compiles with a 48px header and a gear route, while shared settings own the fields', async () => {
  const appFile = 'src/renderer/zellij/src/App.vue';
  const settingsFile =
    'src/renderer/home/src/views/setting/components/TerminalSetting/TerminalSetting.vue';
  const app = parse(readFileSync(appFile, 'utf8')).descriptor;
  const shared = parse(readFileSync(settingsFile, 'utf8')).descriptor;
  for (const [filename, descriptor] of [
    [appFile, app],
    [settingsFile, shared]
  ]) {
    assert.deepEqual(
      compileTemplate({ source: descriptor.template.content, filename, id: filename }).errors,
      []
    );
  }
  const elements = [];
  const visit = (node) => {
    if (node.type === 1) elements.push(node);
    for (const child of node.children ?? []) visit(child);
  };
  visit(baseParse(app.template.content));
  assert.ok(
    elements.some(
      (node) =>
        node.tag === 'IconBtn' &&
        node.props.some(
          (prop) =>
            prop.name === 'on' &&
            prop.arg?.content === 'click' &&
            prop.exp?.content === 'zellijStore.openSettings()'
        )
    )
  );
  assert.equal(
    elements.some((node) => ['a-input', 'a-switch'].includes(node.tag)),
    false
  );
  assert.doesNotMatch(
    app.template.content,
    /settingsOpen|zellij__shortcut-fields|Initialize and open/
  );
  const css = postcss.parse(
    (await less.render(readFileSync('src/renderer/zellij/src/App.less', 'utf8'))).css
  );
  const declarations = {};
  css.walkRules('.zellij__toolbar', (rule) =>
    rule.walkDecls((declaration) => {
      declarations[declaration.prop] = declaration.value;
    })
  );
  assert.equal(declarations.height, '48px');
  assert.equal(declarations['min-height'], '48px');
  assert.equal(declarations.flex, '0 0 48px');
  assert.equal(declarations['box-sizing'], 'border-box');
  assert.equal(declarations.padding, '0 16px');
  assert.match(shared.template.content, /terminalSettingStore\.draft\.splitDown/);
  assert.match(shared.template.content, /terminalSettingStore\.configDirectory/);
  assert.doesNotMatch(shared.template.content, /a-switch|terminalEnabled|\.initialize\(/);
});
