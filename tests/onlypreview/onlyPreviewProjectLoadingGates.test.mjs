/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { build } from 'esbuild';
import ts from 'typescript';
import { baseParse, compile } from '@vue/compiler-dom';
import * as Vue from 'vue';

const root = resolve(import.meta.dirname, '../..');
const require = createRequire(resolve(root, 'package.json'));
const source = (path) => readFileSync(resolve(root, path), 'utf8');
const shellPath = 'src/renderer/onlypreview/shell/src';
const shellText = source(`${shellPath}/onlyPreviewShell.store.ts`);
const shell = ts.createSourceFile('shell.ts', shellText, ts.ScriptTarget.Latest, true);
const shellClass = shell.statements.find((node) => ts.isClassDeclaration(node) && node.name.text === 'OnlyPreviewShellStore');
const appText = source(`${shellPath}/App.vue`);
const app = ts.createSourceFile('app.ts', appText.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1], ts.ScriptTarget.Latest, true);
const uiDeclarations = ['canLocateCurrentPreview', 'locateCurrentFile'].map((name) => {
  const declaration = app.statements.find((node) => ts.isVariableStatement(node) &&
    node.declarationList.declarations.some((entry) => entry.name.getText(app) === name));
  assert.ok(declaration, `Missing actual App action: ${name}`);
  return declaration.getText(app);
}).join('\n');

// Exercise the complete current Shell class with real projection, deferred kickoff and expansion.
// Only IPC, window settings and unrelated UI services are replaced at their existing boundaries.
const bundle = await build({
  stdin: { resolveDir: root, loader: 'ts', contents: `
    import { reactive, computed } from 'vue';
    import { OnlyPreviewContractError, unwrapOnlyPreviewResult } from '@shared/onlypreview/onlyPreview.contract';
    import { OnlyPreviewBrowseProjectionService } from './${shellPath}/onlyPreviewBrowseProjection.service';
    import { OnlyPreviewDeferredIndexService } from './${shellPath}/onlyPreviewDeferredIndex.service';
    import { OnlyPreviewTreeExpansionStore } from './${shellPath}/onlyPreviewTreeExpansion.store';
    import { resolveOnlyPreviewProjectionCommit } from './${shellPath}/onlyPreviewProjectionCommit.service';
    import { buildOnlyPreviewRootedTreeRows, moveOnlyPreviewTreeFocus, resolveOnlyPreviewCurrentDirectory,
      resolveOnlyPreviewTreeFocusPath } from './${shellPath}/onlyPreviewTree.service';
    import { createOnlyPreviewSearchProgressState, reduceOnlyPreviewSearchProgress,
      resetOnlyPreviewSearchProgress, settleOnlyPreviewSearchProgress } from './${shellPath}/onlyPreviewSearchProgress.service';
    import { OnlyPreviewCharacterCountHostGate } from './src/renderer/onlypreview/common/onlyPreviewCharacterCountGate.service';
    const { env: onlyPreviewEnv, client: onlyPreviewClient, search: onlyPreviewSearchClient,
      diagnostic, errorDetail: onlyPreviewErrorDetail, recents: onlyPreviewRecentsStore } = globalThis.runtime;
    const onlyPreviewGlobalSearchShellClient = { report() {} };
    const projectWidthPersistence = { restore: () => 240 };
    const window = { innerWidth: 1200 };
    const OnlyPreviewHostToggleStore = class {};
    const describeOnlyPreviewError = (error) => {
      onlyPreviewErrorDetail.detail = { error };
      return error.message;
    };
    ${shellClass.getText(shell)}
    export const store = reactive(new OnlyPreviewShellStore(diagnostic));
    export function uiActions() {
      const onlyPreviewShellStore = store;
      const focusRequests = [];
      const focusTreePath = async (...args) => { focusRequests.push(args); };
      ${uiDeclarations}
      return { canLocateCurrentPreview, locateCurrentFile, focusRequests };
    }
  ` },
  bundle: true, write: false, platform: 'node', format: 'cjs', target: 'node22',
  external: ['vue'], tsconfig: resolve(root, 'tsconfig.web.json'),
  plugins: [{ name: 'project-loading-boundaries', setup(context) {
    context.onResolve({ filter: /onlyPreviewSearch\.client$|onlyPreviewI18n$/ }, ({ path }) => ({ path, namespace: 'stub' }));
    context.onLoad({ filter: /.*/, namespace: 'stub' }, ({ path }) => ({ contents:
      path.endsWith('onlyPreviewSearch.client')
        ? 'export const onlyPreviewSearchClient = globalThis.runtime.search;'
        : 'export const onlyPreviewI18n = { errors: { OPERATION_FAILED: "Operation failed" } }; export const getOnlyPreviewErrorMessage = (code) => code;'
    }));
  } }]
});

const template = (text) => text.slice(text.indexOf('<template>') + 10, text.lastIndexOf('</template>'));
const findElement = (node, predicate) => {
  if (node.type === 1 && predicate(node)) return node;
  for (const child of node.children || []) {
    const found = findElement(child, predicate);
    if (found) return found;
  }
};
const namedElement = (name) => findElement(baseParse(template(appText)), (node) =>
  node.props.some((prop) => prop.name === 'name' && prop.value?.content === name));
const vnodeVue = {
  ...Vue, resolveComponent: (name) => name, resolveDynamicComponent: (component) => component,
  withDirectives(node, directives) { node.testDirectives = directives; return node; }
};
const renderTemplate = (text) => {
  const compiled = compile(text, { mode: 'function', prefixIdentifiers: true, isTS: true });
  const javascript = ts.transpileModule(compiled.code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function('Vue', javascript)(vnodeVue);
};
const renderPanel = renderTemplate(namedElement('onlypreview__projectPanel').loc.source);
const renderLocate = renderTemplate(namedElement('onlypreview__locateCurrentFile').loc.source);
const renderBookmarks = renderTemplate(template(source(`${shellPath}/components/Bookmarks/BookmarkBar.vue`)));
const recentsElement = findElement(baseParse(template(appText)), (node) => node.tag === 'RecentsPanel');
const renderRecents = renderTemplate(recentsElement.loc.source);
const flatten = (node) => {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(flatten);
  const children = Array.isArray(node.children) ? node.children
    : typeof node.children?.default === 'function' ? node.children.default() : [];
  return [node, ...flatten(children)];
};
const tick = () => new Promise((done) => setImmediate(done));
const workspace = (workspaceId = 'project-a') => ({ workspaceId, rootName: workspaceId, displayPath: `/${workspaceId}` });
const entry = (relativePath, directory = false) => ({
  relativePath, parentRelativePath: relativePath.includes('/') ? relativePath.slice(0, relativePath.lastIndexOf('/')) : '',
  name: relativePath.split('/').at(-1), nodeKind: directory ? 'directory' : 'file',
  size: directory ? 0 : 8, modifiedAt: 1, previewHint: directory ? 'unsupported' : 'text',
  mediaType: directory ? 'unknown' : 'text', isText: !directory,
  directoryToken: directory ? `token-${relativePath}` : null, searchExcluded: false
});
const createHarness = () => {
  const scheduled = [];
  const state = { restore: null, initializeReads: 0, browseReads: 0 };
  const recents = { activePanel: 'project' };
  const snapshot = (status = 'building') => ({
    workspaceId: store.workspace.workspaceId, generation: store.searchWorkspaceGeneration,
    state: status, index: { workspaceId: store.workspace.workspaceId, entries: [] }
  });
  const search = {
    async initialize() { state.initializeReads += 1; return { ok: true, value: snapshot() }; },
    async refresh() { return { ok: true, value: snapshot() }; },
    async browseDirectory(request) {
      state.browseReads += 1;
      return { ok: true, value: listing([entry('docs/current.md')], 'docs', request.directoryToken) };
    }
  };
  const module = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require,
    queueMicrotask: (callback) => scheduled.push(callback),
    runtime: { env: { hostId: 'host', hostToken: 'token' }, recents, search,
      diagnostic: { nextTag: () => 'test', now: () => 0, elapsed: () => 0, emit() {} },
      errorDetail: { detail: null, clear() { this.detail = null; } },
      client: { restoreWorkspace: async () => ({ ok: true, value: state.restore }), reportProjectIndexFailed: async () => {} }
    }
  });
  const { store } = module.exports;
  const actions = module.exports.uiActions();
  const listing = (entries = [], relativePath = '', directoryToken = 'root-token') => ({
    workspaceId: store.workspace.workspaceId, generation: store.searchWorkspaceGeneration,
    relativePath, directoryToken, entries
  });
  const view = () => {
    const context = {
      onlyPreviewShellStore: store, onlyPreviewRecentsStore: recents,
      onlyPreviewBookmarksStore: { entries: [], errorMessage: '' },
      onlyPreviewI18n: { project: { treeLabel: 'Project tree', locateCurrentFile: 'Locate' },
        preview: { loadingProjectTitle: 'Loading project' }, bookmarks: { label: 'Bookmarks', empty: 'No bookmarks' } },
      onlyPreviewTreeSelection: { isSelected: () => false }, onlyPreviewProjectAuthoring: { editing: null },
      TREE_FILE_ICONS: { text: 'FileIcon' }, resolveOnlyPreviewFileIconKey: () => 'text',
      canLocateCurrentPreview: actions.canLocateCurrentPreview.value,
      locateCurrentFile: actions.locateCurrentFile
    };
    return {
      panel: flatten(renderPanel(context, [])),
      bookmarks: flatten(renderBookmarks(context, [])),
      locate: renderLocate(context, []), recents: renderRecents(context, [])
    };
  };
  return { store, state, actions, search, recents, listing, snapshot, view,
    async drain() { while (scheduled.length) scheduled.shift()(); await tick(); },
    preview(relativePath = 'docs/current.md', workspaceId = store.workspace.workspaceId) {
      store.previewPresentation = { fileRef: { workspaceId, relativePath } };
    },
    fail() { store.applySearchFailure({ workspaceId: store.workspace.workspaceId,
      generation: store.searchWorkspaceGeneration, error: { code: 'INDEX_FAILED', message: 'Root load failed' } }); }
  };
};
const hasName = (nodes, name) => nodes.some((node) => node.props?.name === name);
const assertGates = (h, { loading, ready, locate }) => {
  const rendered = h.view();
  assert.equal(hasName(rendered.panel, 'onlypreview__projectLoading'), loading);
  assert.equal(h.store.projectListingLoading, loading);
  assert.equal(hasName(rendered.bookmarks, 'onlypreview__bookmarks'), ready);
  assert.equal(hasName(rendered.panel, 'onlypreview__tree'), ready);
  assert.equal(rendered.panel.some((node) => node.type === 'BookmarkBar'), true, 'bookmark bookkeeping stays mounted');
  assert.equal(rendered.locate.props.disabled, !locate);
  if (loading) {
    const indicator = rendered.panel.find((node) => node.props?.name === 'onlypreview__projectLoading');
    assert.equal(indicator.props.role, 'status');
    assert.ok(indicator.props['aria-label']);
    assert.ok(rendered.panel.some((node) => node.type === 'a-spin'));
  }
};

test('deferred Project loading hides bookmarks and blocks Locate even with a current preview', async () => {
  const h = createHarness();
  await h.store.applyWorkspace(workspace(), true);
  h.preview();
  assert.equal(h.state.initializeReads, 0, 'initial dispatch is still deferred');
  assert.equal(h.store.indexLoading, false);
  assertGates(h, { loading: true, ready: false, locate: false });
  const before = h.store.selectedRelativePath;
  assert.equal(await h.store.locateSelectedFile(), '');
  await h.actions.locateCurrentFile();
  assert.equal(h.store.selectedRelativePath, before);
  assert.equal(h.state.browseReads, 0);
  assert.equal(h.actions.focusRequests.length, 0);
  h.recents.activePanel = 'recents';
  assert.equal(h.view().recents.testDirectives[0][1], true);
  assert.equal(h.view().panel[0].testDirectives[0][1], false);
  await h.drain();
  await h.store.applySearchSnapshot(h.snapshot('ready'));
  assertGates(h, { loading: true, ready: false, locate: false });
});

test('valid empty and nonempty root listings unlock the Project before background indexing finishes', async () => {
  for (const populated of [false, true]) {
    const h = createHarness();
    await h.store.applyWorkspace(workspace(), true);
    await h.drain();
    if (populated) h.preview();
    h.store.applyBrowseListing(h.listing(populated ? [entry('docs', true)] : []));
    assert.equal(h.store.indexLoading, true);
    assertGates(h, { loading: false, ready: true, locate: populated });
    await h.store.applySearchSnapshot(h.snapshot('reconciling'));
    h.fail();
    assertGates(h, { loading: false, ready: true, locate: populated });
    assert.equal(h.store.projectListingFailed, false);
    if (populated) {
      await h.actions.locateCurrentFile();
      assert.equal(h.store.treeSelectedRelativePath, 'docs/current.md');
      assert.equal(h.store.focusedRelativePath, 'docs/current.md');
      assert.equal(h.store.expandedPaths.has('docs'), true);
      assert.equal(h.state.browseReads, 1);
      assert.equal(h.actions.focusRequests[0][0], 'docs/current.md');
      h.preview('outside.md', 'outside-project');
      assertGates(h, { loading: false, ready: true, locate: false });
    }
  }
});

test('switch and clear reset readiness while stale roots cannot finish the new loading state', async () => {
  const h = createHarness();
  await h.store.applyWorkspace(workspace(), true);
  const oldRoot = h.listing([entry('docs', true)]);
  h.store.applyBrowseListing(oldRoot);
  await h.store.applyWorkspace(workspace('project-b'), true);
  h.store.applyBrowseListing(oldRoot);
  h.store.applyBrowseListing({ ...h.listing(), generation: h.store.searchWorkspaceGeneration - 1 });
  assertGates(h, { loading: true, ready: false, locate: false });
  await h.store.restoreWorkspace();
  assert.equal(h.store.workspace, null);
  assertGates(h, { loading: false, ready: false, locate: false });
  await h.drain();
  assert.equal(h.state.initializeReads, 0, 'cleared deferred work never starts');
});

test('initial failure stops loading and retry or a successful root recovers independently of unrelated errors', async () => {
  const h = createHarness();
  await h.store.applyWorkspace(workspace(), true);
  h.store.errorMessage = 'Unrelated preview error';
  assertGates(h, { loading: true, ready: false, locate: false });
  h.fail();
  assert.equal(h.store.errorMessage, 'Root load failed');
  assertGates(h, { loading: false, ready: false, locate: false });
  h.store.dismissError();
  assertGates(h, { loading: false, ready: false, locate: false });
  await h.store.refresh();
  assert.equal(h.store.projectListingFailed, false);
  assertGates(h, { loading: true, ready: false, locate: false });
  h.fail();
  await h.store.refresh();
  assertGates(h, { loading: true, ready: false, locate: false });
  h.fail();
  h.store.applyBrowseListing({ ...h.listing(), generation: h.store.searchWorkspaceGeneration - 1 });
  assertGates(h, { loading: false, ready: false, locate: false });
  h.store.applyBrowseListing(h.listing());
  assert.equal(h.store.projectListingFailed, false);
  assertGates(h, { loading: false, ready: true, locate: false });
  await h.store.applyWorkspace(workspace('project-b'), true);
  h.fail();
  await h.store.applyWorkspace(workspace('project-c'), true);
  assertGates(h, { loading: true, ready: false, locate: false });
});
