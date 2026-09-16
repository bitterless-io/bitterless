/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, resolve } from 'node:path';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '../..');
const appRequire = createRequire(resolve(root, 'package.json'));
const { build, transformSync } = appRequire('esbuild');
const ts = appRequire('typescript');
const { reactive } = appRequire('vue');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const shell = 'src/renderer/onlypreview/shell/src/';
const main = 'src/main/miniapps/onlypreview/';
const tick = () => new Promise((done) => setImmediate(done));
const deferred = () => {
  let finish;
  const promise = new Promise((done) => { finish = done; });
  return { promise, finish };
};
const sourceWithoutImports = (path) => {
  const ast = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true);
  return ast.statements.filter((node) => !ts.isImportDeclaration(node))
    .map((node) => node.getText(ast)).join('\n');
};
const methods = (path, names) => {
  const ast = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true);
  const owner = ast.statements.find(ts.isClassDeclaration);
  const selected = owner.members.filter((node) => names.includes(node.name?.getText(ast)));
  assert.equal(selected.length, names.length);
  return selected.map((node) => node.getText(ast)).join('\n');
};
const evaluate = (source, bindings = {}, transpile = true) => {
  const code = transpile
    ? transformSync(source, { loader: 'ts', format: 'cjs', target: 'es2022' }).code
    : source;
  const module = { exports: {} };
  new Function('module', 'exports', ...Object.keys(bindings), code)(
    module, module.exports, ...Object.values(bindings)
  );
  return module.exports;
};

// Actual authority registries, request parser and clipboard implementation, without importing
// Electron. All clipboard writes below go to the instance's injected text/command ports.
const bundle = await build({
  stdin: {
    contents: [
      'src/shared/onlypreview/onlyPreview.contract.ts',
      'src/shared/onlypreview/onlyPreview.types.ts',
      main + 'onlyPreviewHost.registry.ts',
      main + 'onlyPreviewWorkspace.registry.ts',
      main + 'onlyPreviewClipboard.service.ts',
      shell + 'onlyPreviewTreeSelection.service.ts'
    ].map((path) => `export * from './${path}';`).join('\n'),
    resolveDir: root,
    loader: 'ts'
  },
  tsconfig: resolve(root, 'tsconfig.node.json'),
  bundle: true, write: false, platform: 'node', format: 'cjs', target: 'node22',
  plugins: [{ name: 'no-system-clipboard', setup(builder) {
    builder.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'test' }));
    builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({
      contents: 'export const clipboard = { writeText() { throw new Error("System clipboard must not be used"); } };'
    }));
  } }]
});
const runtime = evaluate(bundle.outputFiles[0].text, { require: appRequire }, false);
const file = (relativePath) => ({ relativePath, nodeKind: 'file' });
const directory = (relativePath) => ({ relativePath, nodeKind: 'directory' });
const rows = [file('文档/第一 份.md'), directory('第二 个目录'), file('第三 份.txt')];

const createHarness = () => {
  const hosts = new runtime.OnlyPreviewHostRegistry();
  const workspaces = new runtime.OnlyPreviewWorkspaceRegistry(hosts);
  const host = hosts.issue('standalone', 'content');
  const env = { hostToken: host.hostToken, hostId: host.hostId };
  const state = {
    requests: [], rootRequests: [], writes: [], commands: [], authorizations: [], failures: [],
    deniedPath: null, beforeAuthorize: null, beforeItemRef: null
  };
  const itemRef = workspaces.getProjectAuthorityItemRef.bind(workspaces);
  workspaces.getProjectAuthorityItemRef = (token, request) => {
    state.beforeItemRef?.(request);
    return itemRef(token, request);
  };
  const clipboard = new runtime.OnlyPreviewClipboardService({
    platform: 'darwin',
    textClipboard: { writeText: (text) => state.writes.push(text) },
    executeCommand: async (command) => state.commands.push(command)
  });
  const fileSearchWindowService = {
    authorizeProjectItem: async (request) => {
      state.authorizations.push({ ...request });
      const authority = workspaces.getProjectAuthorityRootRef(host.hostToken, request.workspaceId);
      assert.equal(authority.workspaceGeneration, request.workspaceGeneration);
      const result = {
        canonicalPath: resolve(authority.workspace.rootRealPath, request.relativePath),
        relativePath: request.relativePath,
        name: basename(request.relativePath)
      };
      await state.beforeAuthorize?.(request);
      if (request.relativePath === state.deniedPath) {
        throw new runtime.OnlyPreviewContractError('PATH_PERMISSION_DENIED', 'Permission denied');
      }
      return result;
    },
    authorizeProjectRoot: async (request) => {
      const authority = workspaces.getProjectAuthorityRootRef(host.hostToken, request.workspaceId);
      return { canonicalPath: authority.workspace.rootRealPath, relativePath: '', name: authority.workspace.rootName };
    }
  };
  const { onlyPreviewProjectNativeActionService: native } = evaluate(
    sourceWithoutImports(main + 'onlyPreviewProjectNativeAction.service.ts'), {
      OnlyPreviewContractError: runtime.OnlyPreviewContractError,
      onlyPreviewWorkspaceRegistry: workspaces,
      onlyPreviewClipboardService: clipboard,
      fileSearchWindowService,
      console: { info: () => {} }
    }
  );
  native.showCopyFailure = async () => { state.failures.push('copy-failed'); };
  const Handler = evaluate('export class Handler { ' + methods('src/main/xpc/onlyPreview.handler.ts',
    ['copyProjectItem', 'copyProjectRoot']) + ' }', {
    ...runtime,
    runOperation: async (_name, operation) => ({ ok: true, value: await operation() }),
    onlyPreviewWindowHelper: { getStandaloneWindow: (token) => { hosts.require(token); return {}; } },
    onlyPreviewProjectNativeActionService: native
  }).Handler;
  const handler = new Handler();
  const pending = [];
  const client = {
    copyProjectItem: (request) => {
      state.requests.push(request);
      const promise = handler.copyProjectItem(request);
      pending.push(promise);
      return promise;
    },
    copyProjectRoot: (request) => {
      state.rootRequests.push(request);
      const promise = handler.copyProjectRoot(request);
      pending.push(promise);
      return promise;
    }
  };
  const common = { ...runtime, onlyPreviewEnv: env, onlyPreviewClient: client };
  const projectRoot = evaluate(sourceWithoutImports(shell + 'onlyPreviewProjectRoot.client.ts'), common);
  const Shell = evaluate('export class Shell { ' + methods(shell + 'onlyPreviewShell.store.ts',
    ['copyProjectItem', 'projectItemRequest', 'runWindowCommand']) + ' }', {
    ...common, ...projectRoot, describeOnlyPreviewError: (error) => error.message
  }).Shell;
  const store = new Shell();
  Object.assign(store, {
    visibleRows: [directory(''), ...rows].map((entry) => ({ entry })),
    treeSelectedRelativePath: rows[0].relativePath,
    selectedRelativePath: rows[0].relativePath,
    errorMessage: ''
  });
  const bindWorkspace = (path = '/Projects/中文 workspace') => {
    store.workspace = workspaces.registerValidatedTarget(host.hostToken, {
      rootRealPath: path, displayPath: path, rootName: basename(path)
    });
    workspaces.bindProjectAuthority(host.hostToken, store.workspace.workspaceId, 1);
    return store.workspace;
  };
  bindWorkspace();
  const selectionModule = evaluate(sourceWithoutImports(shell + 'onlyPreviewTreeSelection.store.ts'), {
    ...common, reactive, onlyPreviewShellStore: store,
    describeOnlyPreviewError: (error) => error.message
  });
  const subscriptions = new Map();
  const authoring = evaluate(sourceWithoutImports(shell + 'onlyPreviewProjectAuthoring.store.ts'), {
    ...common, ...selectionModule, reactive, onlyPreviewShellStore: store,
    xpcRenderer: { subscribe: (name, listener) => subscriptions.set(name, listener) }
  });
  authoring.subscribeOnlyPreviewProjectIntents();
  const emit = (copyKind = 'absolute-path', overrides = {}) => {
    subscriptions.get(runtime.ONLY_PREVIEW_COPY_PROJECT_ITEM_EVENT)({
      params: { hostId: host.hostId, copyKind, ...overrides }
    });
  };
  const settle = async () => { await Promise.all(pending); await tick(); };
  const select = (count = 3) => {
    selectionModule.onlyPreviewTreeSelection.apply('replace', rows[0].relativePath);
    selectionModule.onlyPreviewTreeSelection.apply('extend', rows[count - 1].relativePath);
  };
  return {
    state, store, env, host, hosts, workspaces, handler, emit, settle, select, bindWorkspace,
    selection: selectionModule.onlyPreviewTreeSelection,
    copySelection: selectionModule.copyOnlyPreviewTreeSelection
  };
};

test('native Copy Path intent copies all two or three selected Unicode/space paths in one clipboard write', async () => {
  for (const count of [2, 3]) {
    const h = createHarness();
    h.select(count);
    h.emit();
    await h.settle();
    assert.deepEqual(h.state.writes, [rows.slice(0, count)
      .map((entry) => resolve('/Projects/中文 workspace', entry.relativePath)).join('\n')]);
    assert.equal(h.state.requests.length, 1);
    assert.deepEqual(h.state.requests[0].selection, rows.slice(0, count));
    assert.equal(h.state.requests[0].relativePath, rows[0].relativePath);
    assert.deepEqual(h.state.authorizations.map((entry) => entry.relativePath), rows.slice(0, count).map((entry) => entry.relativePath));
    assert.deepEqual(h.state.commands, []);
  }
});

test('deselecting the old preview anchor never includes it in the remaining multi- or single-selection', async () => {
  for (const count of [2, 3]) {
    const h = createHarness();
    h.select(count);
    h.selection.apply('toggle', rows[0].relativePath);
    assert.equal(h.store.treeSelectedRelativePath, rows[0].relativePath);
    h.emit();
    await h.settle();
    assert.deepEqual(h.state.writes, [rows.slice(1, count)
      .map((entry) => resolve('/Projects/中文 workspace', entry.relativePath)).join('\n')]);
    assert.equal(h.state.requests[0].relativePath, rows[1].relativePath);
    assert.equal(Object.hasOwn(h.state.requests[0], 'selection'), count > 2);
  }
});

test('single-item, selected-file fallback and Project root retain their existing request contracts', async () => {
  for (const target of ['single', 'fallback', 'root']) {
    const h = createHarness();
    if (target === 'fallback') h.store.treeSelectedRelativePath = null;
    if (target === 'root') h.store.treeSelectedRelativePath = '';
    h.emit();
    await h.settle();
    if (target === 'root') {
      assert.deepEqual(h.state.writes, ['/Projects/中文 workspace']);
      assert.equal(h.state.requests.length, 0);
      assert.deepEqual(h.state.rootRequests, [{
        hostToken: h.host.hostToken, workspaceId: h.store.workspace.workspaceId, copyKind: 'absolute-path'
      }]);
    } else {
      assert.deepEqual(h.state.writes, [resolve('/Projects/中文 workspace', rows[0].relativePath)]);
      assert.equal(Object.hasOwn(h.state.requests[0], 'selection'), false);
      assert.equal(h.state.rootRequests.length, 0);
    }
  }
});

test('Copy Name and other selection projections keep every entry and filesystem copy runs once', async () => {
  for (const copyKind of ['name', 'relative-path', 'item']) {
    const h = createHarness();
    h.select();
    if (copyKind === 'name') { h.emit('name'); await h.settle(); }
    else await h.copySelection(copyKind);
    assert.equal(h.state.requests.length, 1);
    if (copyKind === 'item') {
      assert.deepEqual(h.state.writes, []);
      assert.equal(h.state.commands.length, 1);
      assert.deepEqual(h.state.commands[0].args.slice(-3), rows.map((entry) => resolve('/Projects/中文 workspace', entry.relativePath)));
    } else {
      assert.deepEqual(h.state.writes, [rows.map((entry) => copyKind === 'name'
        ? basename(entry.relativePath) : entry.relativePath).join('\n')]);
    }
  }
});

test('strict copy parser preserves old requests and rejects invalid selection before any authorization or write', async () => {
  const h = createHarness();
  const request = {
    hostToken: h.host.hostToken, workspaceId: h.store.workspace.workspaceId,
    relativePath: rows[0].relativePath, copyKind: 'absolute-path'
  };
  assert.deepEqual(runtime.parseOnlyPreviewProjectItemCopyRequest(request), request);
  for (const selection of [[rows[0]], [rows[0], ...Array.from({ length: 999 }, (_, index) => file(`${index}.txt`))]]) {
    assert.deepEqual(runtime.parseOnlyPreviewProjectItemCopyRequest({ ...request, selection }), { ...request, selection });
  }
  const invalid = [
    null, [], 'not-an-array', [null], [rows[1]], [{ ...rows[0], extra: true }],
    [{ relativePath: rows[0].relativePath }], [{ ...rows[0], nodeKind: 'symlink' }],
    [rows[0], directory('')], [rows[0], file('../outside')], [rows[0], file('/absolute')],
    [rows[0], file('a//b')], [rows[0], file('a/./b')], [rows[0], file('a\\b')],
    [rows[0], file('nul\0name')], Array.from({ length: 1001 }, () => rows[0])
  ];
  for (const selection of invalid) {
    await assert.rejects(h.handler.copyProjectItem({ ...request, selection }), { code: 'INVALID_INPUT' });
  }
  await assert.rejects(h.handler.copyProjectItem({ ...request, selection: rows, extra: true }), { code: 'INVALID_INPUT' });
  assert.deepEqual(h.state.authorizations, []);
  assert.deepEqual(h.state.writes, []);
});

test('one denied selected item aborts the whole clipboard write', async () => {
  const h = createHarness();
  h.select();
  h.state.deniedPath = rows[1].relativePath;
  h.emit();
  await h.settle();
  assert.deepEqual(h.state.writes, []);
  assert.deepEqual(h.state.commands, []);
  assert.equal(h.state.authorizations.length, 2);
  assert.deepEqual(h.state.failures, ['copy-failed']);
});

test('workspace replacement, host closure and authority rebuild while a batch waits cannot write old results', async () => {
  for (const change of ['workspace', 'host', 'generation']) {
    const h = createHarness(), gate = deferred(), entered = deferred();
    h.select();
    h.state.beforeAuthorize = async (request) => {
      if (request.relativePath === rows[1].relativePath) { entered.finish(); await gate.promise; }
    };
    h.emit();
    await entered.promise;
    if (change === 'workspace') h.bindWorkspace('/Projects/新 workspace');
    if (change === 'host') h.hosts.revoke(h.host.hostToken);
    if (change === 'generation') h.workspaces.bindProjectAuthority(h.host.hostToken, h.store.workspace.workspaceId, 2);
    gate.finish();
    await h.settle();
    assert.deepEqual(h.state.writes, []);
    assert.deepEqual(h.state.failures, ['copy-failed']);
    if (change === 'workspace') {
      h.state.beforeAuthorize = null;
      h.emit();
      await h.settle();
      assert.deepEqual(h.state.writes, [rows.map((entry) => resolve('/Projects/新 workspace', entry.relativePath)).join('\n')]);
    }
  }
});

test('final authority check rejects a batch whose independently authorized entries span generations', async () => {
  const h = createHarness();
  h.select(2);
  h.state.beforeItemRef = (request) => {
    if (request.relativePath !== rows[1].relativePath) return;
    h.state.beforeItemRef = null;
    h.workspaces.bindProjectAuthority(h.host.hostToken, h.store.workspace.workspaceId, 2);
  };
  h.emit();
  await h.settle();
  assert.deepEqual(h.state.authorizations.map((entry) => entry.workspaceGeneration), [1, 2]);
  assert.deepEqual(h.state.writes, []);
  assert.deepEqual(h.state.failures, ['copy-failed']);
});

test('wrong-host or unsupported native intents and absent workspace/capability do not copy', async () => {
  const h = createHarness();
  h.select();
  h.emit('absolute-path', { hostId: 'another-host' });
  h.emit('item');
  h.emit('relative-path');
  h.store.workspace = null;
  h.emit();
  h.bindWorkspace();
  h.env.hostToken = '';
  h.emit();
  await h.settle();
  assert.deepEqual(h.state.requests, []);
  assert.deepEqual(h.state.writes, []);
});
