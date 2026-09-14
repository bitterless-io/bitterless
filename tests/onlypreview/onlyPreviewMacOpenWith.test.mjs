import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';
import { parse as parseYaml } from 'yaml';

const root = resolve(import.meta.dirname, '../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const require = createRequire(import.meta.url);
const load = (path, stubs = {}, platform = process.platform) => {
  const code = ts.transpileModule(read(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
  }).outputText;
  const module = { exports: {} };
  const dependency = (name) => {
    if (name in stubs) return stubs[name];
    if (name.startsWith('node:')) return require(name);
    throw new Error('Unexpected dependency: ' + name);
  };
  new Function('require', 'module', 'exports', 'process', code)(
    dependency, module, module.exports, { platform }
  );
  return module.exports;
};
const gate = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = () => new Promise((done) => setImmediate(done));
const routerPath = 'src/main/miniapps/onlypreview/onlyPreviewOpenRouter.service.ts';
const nativePath = 'src/main/miniapps/onlypreview/onlyPreviewDefaultApp.service.ts';
const { OnlyPreviewOpenQueue } = load(routerPath);
const audit = require(resolve(root, 'scripts/package/onlyPreviewAssociations.audit.cjs'));
const template = parseYaml(read('electron-builder.tmp.yml'));
const plist = { CFBundleDocumentTypes: template.mac.extendInfo.CFBundleDocumentTypes };

test('builder template declares ordinary documents, Office and diagrams only as Viewer/Alternate', () => {
  audit.assertOnlyPreviewAssociations(plist);
  assert.notEqual(template.appId, undefined);
  const hook = read(template.afterPack);
  assert.match(hook, /auditOnlyPreviewAssociations/);
  assert.doesNotMatch(read(nativePath), /readFile|readFileSync|setAsDefaultProtocolClient|execSync/);
});

test('packaging audit rejects missing families, ownership claims and ineffective extension dictionaries', () => {
  const mutate = (edit) => {
    const copy = structuredClone(plist);
    edit(copy.CFBundleDocumentTypes);
    return copy;
  };
  assert.throws(() => audit.assertOnlyPreviewAssociations({}), /Missing CFBundle/);
  assert.throws(() => audit.assertOnlyPreviewAssociations(mutate((docs) => {
    docs[0].LSHandlerRank = 'Default';
  })), /Viewer\/Alternate/);
  assert.throws(() => audit.assertOnlyPreviewAssociations(mutate((docs) => {
    docs[0].LSItemContentTypes = docs[0].LSItemContentTypes.filter((type) => type !== 'public.data');
  })), /public.data/);
  assert.throws(() => audit.assertOnlyPreviewAssociations(mutate((docs) => {
    docs[1].LSItemContentTypes = ['public.data'];
  })), /Missing document extension/);
  assert.throws(() => audit.assertOnlyPreviewAssociations(mutate((docs) => {
    docs[0].LSItemContentTypes.push('com.apple.application-bundle');
  })), /Not a document/);
  assert.doesNotThrow(() => audit({ electronPlatformName: 'win32' }));
});

test('packaging hook reads the final plist without modifying it', { skip: process.platform !== 'darwin' }, () => {
  const directory = mkdtempSync(join(tmpdir(), 'onlypreview-associations-'));
  const xml = (value) => Array.isArray(value)
    ? '<array>' + value.map(xml).join('') + '</array>'
    : typeof value === 'object'
      ? '<dict>' + Object.entries(value).map(([key, item]) => '<key>' + key + '</key>' + xml(item)).join('') + '</dict>'
      : '<string>' + value + '</string>';
  const body = '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0">' + xml(plist) + '</plist>';
  // No app is built or launched; an isolated metadata fixture supplies the final plist.
  const context = { electronPlatformName: 'darwin', appOutDir: directory,
    packager: { appInfo: { productFilename: 'Fixture' } } };
  try {
    const { mkdirSync } = require('node:fs');
    const finalPath = join(directory, 'Fixture.app', 'Contents', 'Info.plist');
    mkdirSync(dirname(finalPath), { recursive: true });
    writeFileSync(finalPath, body);
    audit(context);
    assert.equal(readFileSync(finalPath, 'utf8'), body);
    writeFileSync(finalPath, body.replace('public.data', 'missing.data'));
    assert.throws(() => audit(context), /public.data/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('OS queue waits for readiness and deduplicates pending/in-flight paths while preserving FIFO', async () => {
  const first = gate();
  const calls = [];
  const queue = new OnlyPreviewOpenQueue(async (path) => {
    calls.push(path);
    if (calls.length === 1) await first.promise;
  });
  queue.enqueue('/outside/one.md');
  queue.enqueue('/outside/one.md');
  queue.enqueue('/outside/two.pdf');
  queue.enqueue('relative.md');
  await tick();
  assert.deepEqual(calls, []);
  queue.markReady();
  await tick();
  queue.enqueue('/outside/one.md');
  assert.deepEqual(calls, ['/outside/one.md']);
  first.resolve();
  await tick();
  assert.deepEqual(calls, ['/outside/one.md', '/outside/two.pdf']);
  queue.enqueue('/outside/one.md');
  await tick();
  assert.deepEqual(calls, ['/outside/one.md', '/outside/two.pdf', '/outside/one.md']);
});

test('failed OS request releases its duplicate guard and does not block the next file', async () => {
  const calls = [];
  const queue = new OnlyPreviewOpenQueue(async (path) => {
    calls.push(path);
    if (path.endsWith('bad.md')) throw new Error('fixture failure');
  });
  queue.markReady();
  queue.enqueue('/bad.md');
  queue.enqueue('/good.md');
  await tick();
  queue.enqueue('/bad.md');
  await tick();
  assert.deepEqual(calls, ['/bad.md', '/good.md', '/bad.md']);
});

const nativeHarness = (platform = 'darwin') => {
  const state = { queries: [], opens: [], dialogs: [], checks: 0, query: null,
    handler: { path: '/System/Applications/TextEdit.app' }, failure: '' };
  class ContractError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }
  const i18nHelper = { getMessages: () => ({ app: { onlyPreviewFileMenu: {
    defaultAppIsSelfTitle: 'Choose another app', defaultAppIsSelfDetail: 'Finder > Open With > Other',
    copyFailureOk: 'OK'
  } } }) };
  const api = load(nativePath, {
    electron: {
      app: {
        getPath: () => '/Applications/Fixture.app/Contents/MacOS/Fixture',
        getApplicationInfoForProtocol: async (url) => {
          state.queries.push(url);
          return state.query ? state.query.promise : state.handler;
        }
      },
      dialog: { showMessageBox: async (options) => { state.dialogs.push(options); } },
      shell: { openPath: async (path) => { state.opens.push(path); return state.failure; } }
    },
    '@main/i18n/i18n.helper': { i18nHelper },
    './host/onlyPreviewNativeLabels': { i18nHelper },
    '@shared/onlypreview/onlyPreview.contract': { OnlyPreviewContractError: ContractError }
  }, platform);
  state.open = (path = '/tmp/a file#费用.pdf', check = () => { state.checks++; }) =>
    api.openOnlyPreviewInDefaultApp(path, check);
  return state;
};

test('default lookup uses the exact escaped file URL and keeps OS opening behind authorization', async () => {
  const state = nativeHarness();
  await state.open();
  assert.equal(state.queries[0], 'file:///tmp/a%20file%23%E8%B4%B9%E7%94%A8.pdf');
  assert.deepEqual(state.opens, ['/tmp/a file#费用.pdf']);
  assert.ok(state.checks >= 1);
  const stale = nativeHarness();
  stale.query = gate();
  const pending = stale.open('/tmp/a.pdf', () => { throw new Error('Revoked'); });
  stale.query.resolve(stale.handler);
  await assert.rejects(pending, /Revoked/);
  assert.deepEqual(stale.opens, []);
  assert.deepEqual(stale.dialogs, []);
});

test('self-default handler shows guidance instead of reopening; unavailable handler fails closed', async () => {
  const state = nativeHarness();
  state.handler.path = '/Applications/Fixture.app';
  await state.open();
  assert.deepEqual(state.opens, []);
  assert.equal(state.dialogs.length, 1);
  assert.match(state.dialogs[0].detail, /Open With > Other/);
  for (const failure of ['missing', 'rejected']) {
    const absent = nativeHarness();
    if (failure === 'missing') absent.handler.path = '';
    else {
      absent.query = gate();
      absent.query.reject(new Error('No handler'));
    }
    await assert.rejects(absent.open(), { code: 'DEFAULT_APP_UNAVAILABLE' });
    assert.deepEqual(absent.opens, []);
  }
});

test('non-mac platforms preserve shell behavior and propagate OS failures', async () => {
  const state = nativeHarness('win32');
  await state.open('/tmp/ordinary.txt');
  assert.deepEqual(state.queries, []);
  assert.deepEqual(state.opens, ['/tmp/ordinary.txt']);
  state.failure = 'OS failed';
  await assert.rejects(state.open(), /could not open/);
});

test('both authorized action routes use the guard, and macOS input is registered before ready', () => {
  const handler = read('src/main/xpc/onlyPreview.handler.ts');
  assert.match(handler, /openOnlyPreviewInDefaultApp\(revalidatedPath,[\s\S]*revalidateExternalPreviewNativePath/);
  const actions = read('src/main/miniapps/onlypreview/onlyPreviewProjectNativeAction.service.ts');
  assert.match(actions, /openOnlyPreviewInDefaultApp\(file.canonicalPath, \(\) => this.requireCurrentItem\(authority\)\)/);
  const main = read('src/main/app.main.ts');
  const openAt = main.indexOf("app.on('open-file'");
  assert.ok(openAt >= 0 && openAt < main.indexOf('app.whenReady()'));
  assert.match(main, /event.preventDefault\(\)[\s\S]*onlyPreviewOpenQueue.enqueue\(target\)/);
  assert.match(main, /onlyPreviewOpenQueue.markReady\(\)/);
  if (template.appId === 'ai.micromeet.cowork') {
    const adapter = read('src/main/miniapps/onlypreview/host/onlyPreviewOpenTarget.ts');
    assert.match(adapter, /openOnlyPreviewOperatingSystemTarget[\s\S]*preserveTreeSelection: true/);
    assert.ok(main.indexOf('onlyPreviewOpenQueue.markReady()') > main.indexOf('windowManagerController.openMainWindow()'));
  } else {
    assert.match(main, /new OnlyPreviewOpenQueue\(openOnlyPreviewOsTarget\)/);
  }
});

test('guard imports resolve against each host configuration', () => {
  const config = ts.readConfigFile(resolve(root, 'tsconfig.node.json'), ts.sys.readFile);
  const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  const path = resolve(root, nativePath);
  const ast = ts.createSourceFile(path, read(nativePath), ts.ScriptTarget.Latest);
  for (const statement of ast.statements.filter(ts.isImportDeclaration)) {
    const name = statement.moduleSpecifier.text;
    if (name.startsWith('node:')) {
      assert.ok(require(name));
      continue;
    }
    assert.ok(ts.resolveModuleName(name, path, options, ts.sys).resolvedModule, name);
  }
});
