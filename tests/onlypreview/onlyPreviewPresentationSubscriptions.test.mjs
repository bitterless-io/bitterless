/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { build } from 'esbuild';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '../..');
const require = createRequire(resolve(root, 'package.json'));
const readSource = (path) => readFileSync(resolve(root, path), 'utf8');
const shellPath = 'src/renderer/onlypreview/shell/src';
const parse = (text) => ts.createSourceFile('fixture.ts', text, ts.ScriptTarget.Latest, true);
const script = (path) => readSource(path).match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1];
const shellSource = parse(readSource(`${shellPath}/onlyPreviewShell.store.ts`));
const shellClass = shellSource.statements.find((node) => ts.isClassDeclaration(node) && node.name.text === 'OnlyPreviewShellStore');
const memberNames = [
  'initialize', 'subscribe', 'syncPreviewPresentation', 'applyPreviewPresentation',
  'nativeFindSuppressesCharacterCount', 'clearNativeFindSelectionCount',
  'previewFileRef', 'selectedTextAvailable', 'selectedEntry', 'locateSelectedFile',
  'projectionReady', 'visibleRows', 'browseProjectionContext', 'applyBrowseListing',
  'commitBrowseProjectionResult'
];
const members = memberNames.map((name) => {
  const member = shellClass.members.find((node) => node.name?.getText(shellSource) === name);
  assert.ok(member, `Missing actual Shell member: ${name}`);
  return member.getText(shellSource);
}).join('\n');
const app = parse(script(`${shellPath}/App.vue`));
const mountCall = app.statements.find((node) => ts.isExpressionStatement(node) &&
  ts.isCallExpression(node.expression) && node.expression.expression.getText(app) === 'onMounted');
const mountStatements = mountCall.expression.arguments[0].body.statements.filter((node) =>
  /onlyPreview(?:Shell|Recents)Store\.initialize\(\)/.test(node.getText(app)));
assert.equal(mountStatements.length, 2);
const declarations = (source, names) => names.map((name) => {
  const node = source.statements.find((statement) => ts.isVariableStatement(statement) &&
    statement.declarationList.declarations.some((declaration) => declaration.name.getText(source) === name));
  assert.ok(node, `Missing actual UI declaration: ${name}`);
  return node.getText(source);
}).join('\n');
const toolbar = parse(script(`${shellPath}/components/PreviewToolbar/PreviewToolbar.vue`));

// Keep the real startup, subscription, fetch/apply and UI derivations. Unrelated index and window
// initialization are no-ops; no Electron renderer or native view is launched by this fixture.
const bundled = await build({
  stdin: {
    contents: `
      import { reactive, computed } from 'vue';
      import { unwrapOnlyPreviewResult } from '@shared/onlypreview/onlyPreview.contract';
      import { onlyPreviewClient } from './src/renderer/onlypreview/common/onlyPreviewClient';
      import { onlyPreviewEnv } from './src/renderer/onlypreview/common/contextBridge/onlyPreviewEnv.bridge';
      import { sameOnlyPreviewSelection } from './src/renderer/onlypreview/common/onlyPreviewPresentation.service';
      import { OnlyPreviewCharacterCountHostGate } from './src/renderer/onlypreview/common/onlyPreviewCharacterCountGate.service';
      import { subscribeOnlyPreviewShellEvents } from './${shellPath}/onlyPreviewShellEvents.service';
      import { OnlyPreviewTreeExpansionStore } from './${shellPath}/onlyPreviewTreeExpansion.store';
      import { OnlyPreviewBrowseProjectionService } from './${shellPath}/onlyPreviewBrowseProjection.service';
      import { resolveOnlyPreviewProjectionCommit } from './${shellPath}/onlyPreviewProjectionCommit.service';
      import { buildOnlyPreviewRootedTreeRows } from './${shellPath}/onlyPreviewTree.service';
      import { onlyPreviewRecentsStore } from './${shellPath}/onlyPreviewRecents.store';
      import { describeOnlyPreviewError } from './${shellPath}/onlyPreviewErrorDetail.store';
      export { onlyPreviewRecentsStore as recents };
      export { ONLY_PREVIEW_PREVIEW_PRESENTATION_EVENT as presentationEvent } from '@shared/onlypreview/onlyPreview.types';
      export { ONLY_PREVIEW_BROWSE_LISTING_EVENT as listingEvent } from '@shared/onlypreview/onlyPreviewSearch.type';
      const onlyPreviewFindStore = { open: false, state: null, initialize: async () => {} };
      const onlyPreviewI18n = { errors: { HOST_NOT_FOUND: 'Missing host' } };
      class ShellHarness {
        initialized = false;
        previewPresentation = null;
        previewPresentationFetchGeneration = 0;
        characterCountGate = new OnlyPreviewCharacterCountHostGate();
        workspace = { workspaceId: 'project-workspace', rootName: 'project' };
        index = null;
        browseProjection = new OnlyPreviewBrowseProjectionService();
        searchWorkspaceGeneration = 0;
        projectListingFailed = false;
        selectedRelativePath = 'tree/old.md';
        treeSelectedRelativePath = 'tree';
        expandedPaths = new Set(['']);
        treeExpansion = new OnlyPreviewTreeExpansionStore();
        parentListingReads = 0;
        selectionCollapses = 0;
        collapseTreeSelection() { this.selectionCollapses += 1; }
        async loadSelectedParentListings() {
          this.parentListingReads += 1;
          this.index.entries.push({ relativePath: this.selectedRelativePath });
        }
        diagnostics = { nextTag: () => 'test', now: () => 0, elapsed: () => 0, emit: () => {} };
        reportGlobalSearchContext() {}
        async refreshSettings() {}
        async refreshHostToggleState() {}
        async restoreWorkspace() {}
        ${members}
      }
      export const shell = reactive(new ShellHarness());
      export function mount() {
        const onlyPreviewShellStore = shell;
        ${mountStatements.map((node) => node.getText(app)).join('\n')}
      }
      export function uiState() {
        const onlyPreviewShellStore = shell;
        const focusRequests = [];
        const focusTreePath = async (...args) => { focusRequests.push(args); };
        ${declarations(app, ['canLocateCurrentPreview', 'locateCurrentFile'])}
        ${declarations(toolbar, ['presentation', 'relativePath', 'fileName', 'descriptorType'])}
        return { canLocateCurrentPreview, locateCurrentFile, focusRequests, relativePath, fileName, descriptorType };
      }
    `,
    resolveDir: root,
    loader: 'ts'
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['vue'],
  tsconfig: resolve(root, 'tsconfig.web.json'),
  plugins: [{
    name: 'presentation-subscription-boundaries',
    setup(context) {
      context.onResolve({ filter: /electron-xpc\/renderer|onlyPreviewClient$|onlyPreviewEnv\.bridge$|onlyPreviewErrorDetail\.store$|onlyPreviewSearch\.client$|onlyPreviewI18n$/ },
        ({ path }) => ({ path, namespace: 'boundary' }));
      context.onLoad({ filter: /.*/, namespace: 'boundary' }, ({ path }) => ({
        contents: path === 'electron-xpc/renderer'
          ? 'export const xpcRenderer = globalThis.runtime.xpc;'
          : path.endsWith('onlyPreviewClient')
            ? 'export const onlyPreviewClient = globalThis.runtime.client;'
            : path.endsWith('onlyPreviewEnv.bridge')
              ? 'export const onlyPreviewEnv = globalThis.runtime.env;'
              : path.endsWith('onlyPreviewSearch.client')
                ? 'export const onlyPreviewSearchClient = {};'
                : path.endsWith('onlyPreviewI18n')
                  ? 'export const onlyPreviewI18n = { errors: {} }; export const getOnlyPreviewErrorMessage = (code) => code;'
                  : 'export const describeOnlyPreviewError = (error) => error.message;'
      }));
      context.onLoad({ filter: /onlyPreviewRecents\.store\.ts$/ }, () => ({
        contents: readSource(`${shellPath}/onlyPreviewRecents.store.ts`),
        resolveDir: resolve(root, shellPath),
        loader: 'ts'
      }));
    }
  }]
});

const env = { hostId: 'host', hostToken: 'host-token' };
const tick = () => new Promise((done) => setImmediate(done));
const deferred = () => {
  let resolvePromise;
  const promise = new Promise((done) => { resolvePromise = done; });
  return { promise, resolve: resolvePromise };
};
const presentation = (selectionRevision = 0, relativePath = null, status = 'empty', workspaceId = 'project-workspace') => ({
  hostId: env.hostId, workspaceId, selectionRevision, status,
  surface: 'vue', adapterId: 'markdown-dom', selectedTextAvailable: status === 'ready',
  fileRef: relativePath ? { workspaceId, relativePath } : null,
  descriptor: status === 'ready' ? {
    workspaceId, relativePath, name: relativePath.split('/').at(-1), extension: '.md', language: 'markdown'
  } : null,
  error: null
});
const recentSnapshot = (revision = 0) => ({
  hostId: env.hostId, revision, activeEntryId: 'new',
  entries: [{ id: 'new' }, { id: 'keyboard-selected' }],
  canBack: revision > 0, canForward: false, canReload: revision > 0
});
const createHarness = () => {
  const listeners = new Map();
  const preload = { exports: {}, console, process: { contextIsolated: false }, require(name) {
    assert.equal(name, 'electron');
    return { ipcRenderer: {
      send() {}, on(name, callback) { listeners.set(name, callback); },
      removeAllListeners() {}, invoke() { throw new Error('Unexpected native IPC'); }
    } };
  } };
  vm.runInNewContext(readFileSync(require.resolve('electron-xpc/preload'), 'utf8'), preload);
  const state = {
    presentation: presentation(), recents: recentSnapshot(),
    presentationReads: 0, recentsReads: 0,
    nextPresentation: null, nextRecents: null
  };
  const client = {
    async getPreviewPresentation() {
      state.presentationReads += 1;
      const response = state.nextPresentation;
      state.nextPresentation = null;
      return { ok: true, value: response ? await response : state.presentation };
    },
    async getRecents() {
      state.recentsReads += 1;
      const response = state.nextRecents;
      state.nextRecents = null;
      return { ok: true, value: response ? await response : state.recents };
    }
  };
  const module = { exports: {} };
  vm.runInNewContext(bundled.outputFiles[0].text, {
    module, exports: module.exports, require, console,
    runtime: { env, client, xpc: preload.xpcRenderer }
  });
  const api = module.exports;
  return { ...api, state, ui: api.uiState(),
    emit(params = { hostId: env.hostId }) {
      listeners.get('__xpc_broadcast_dispatch__')({}, { handleName: api.presentationEvent, params });
    },
    publishRoot() {
      const entries = ['tree', 'skills'].map((relativePath) => ({
        relativePath, parentRelativePath: '', name: relativePath, nodeKind: 'directory',
        size: 0, modifiedAt: 0, previewHint: 'unsupported', mediaType: 'unknown',
        isText: false, directoryToken: `directory-${relativePath}`, searchExcluded: false
      }));
      listeners.get('__xpc_broadcast_dispatch__')({}, {
        handleName: api.listingEvent,
        params: { hostId: env.hostId, listing: {
          workspaceId: 'project-workspace', generation: 0, relativePath: '',
          directoryToken: 'root-directory', entries
        } }
      });
    }
  };
};

test('App startup shares real preload nudges between Shell identity/Locate and Recents', async () => {
  const h = createHarness();
  h.mount();
  await tick();
  assert.equal(h.shell.previewPresentation.status, 'empty');
  assert.equal(h.ui.fileName.value, '');
  assert.equal(h.ui.canLocateCurrentPreview.value, false);
  h.recents.select('keyboard-selected');

  h.state.presentation = presentation(1, 'skills/long/path/SKILL.md', 'loading');
  h.state.recents = recentSnapshot(1);
  h.emit();
  await tick();
  assert.equal(h.shell.previewPresentation.status, 'loading');
  assert.equal(h.ui.fileName.value, 'SKILL.md');
  assert.equal(h.ui.relativePath.value, 'skills/long/path/SKILL.md');
  assert.equal(h.ui.canLocateCurrentPreview.value, false, 'preview identity does not establish listing readiness');
  assert.equal(h.recents.snapshot.revision, 1);
  assert.equal(h.recents.canReload, true);
  assert.equal(h.recents.selectedEntryId, 'keyboard-selected');
  h.publishRoot();
  await tick();
  assert.equal(h.shell.projectionReady, true);
  assert.equal(h.ui.canLocateCurrentPreview.value, true);
  const listingReads = h.shell.parentListingReads;

  h.state.presentation = presentation(1, 'skills/long/path/SKILL.md', 'ready');
  h.emit();
  await tick();
  assert.equal(h.shell.previewPresentation.status, 'ready');
  assert.equal(h.ui.descriptorType.value.toUpperCase(), 'MARKDOWN');
  assert.equal(h.shell.selectedRelativePath, 'tree/old.md');
  assert.equal(h.shell.treeSelectedRelativePath, 'tree');
  assert.equal(h.shell.parentListingReads, listingReads);
  h.recents.activePanel = 'recents';
  await h.ui.locateCurrentFile();
  assert.equal(h.recents.activePanel, 'project');
  assert.equal(h.shell.parentListingReads, listingReads + 1);
  assert.equal(h.shell.selectionCollapses, 1);
  assert.equal(h.shell.selectedRelativePath, 'skills/long/path/SKILL.md');
  assert.equal(h.shell.treeSelectedRelativePath, 'skills/long/path/SKILL.md');
  assert.equal(h.shell.focusedRelativePath, 'skills/long/path/SKILL.md');
  assert.deepEqual([...h.shell.expandedPaths].sort(), ['', 'skills', 'skills/long', 'skills/long/path']);
  assert.equal(h.ui.focusRequests[0][0], 'skills/long/path/SKILL.md');
  assert.equal(h.ui.focusRequests[0][1], true);

  h.state.presentation = presentation(2, 'outside.md', 'ready', 'external-workspace');
  h.emit();
  await tick();
  assert.equal(h.ui.fileName.value, 'outside.md');
  assert.equal(h.ui.canLocateCurrentPreview.value, false);
  await h.ui.locateCurrentFile();
  assert.equal(h.shell.parentListingReads, listingReads + 1);
  assert.equal(h.shell.selectionCollapses, 1);
});

test('wrong-host nudges are ignored and disposed Recents resumes without stealing Shell updates', async () => {
  const h = createHarness();
  h.mount();
  await tick();
  const before = [h.state.presentationReads, h.state.recentsReads];
  h.emit({ hostId: 'other-host' });
  h.emit({ hostId: env.hostId, selectionRevision: 999 });
  await tick();
  assert.deepEqual([h.state.presentationReads, h.state.recentsReads], before);

  h.recents.dispose();
  h.state.presentation = presentation(1, 'while-disposed.md', 'ready');
  h.emit();
  await tick();
  assert.equal(h.ui.fileName.value, 'while-disposed.md');
  assert.equal(h.state.recentsReads, before[1]);

  h.mount();
  await tick();
  h.state.presentation = presentation(2, 'after-remount.md', 'ready');
  h.state.recents = recentSnapshot(2);
  h.emit();
  await tick();
  assert.equal(h.ui.fileName.value, 'after-remount.md');
  assert.equal(h.recents.snapshot.revision, 2);
  assert.equal(h.state.recentsReads, before[1] + 2);
});

test('late Shell and Recents responses cannot replace the newer shared presentation update', async () => {
  const h = createHarness();
  h.mount();
  await tick();
  const oldPresentation = deferred();
  const oldRecents = deferred();
  h.state.nextPresentation = oldPresentation.promise;
  h.state.nextRecents = oldRecents.promise;
  h.emit();
  h.state.presentation = presentation(2, 'newest.md', 'ready');
  h.state.recents = recentSnapshot(2);
  h.emit();
  await tick();
  assert.equal(h.ui.fileName.value, 'newest.md');
  assert.equal(h.recents.snapshot.revision, 2);
  oldPresentation.resolve(presentation(1, 'late.md', 'ready'));
  oldRecents.resolve(recentSnapshot(1));
  await tick();
  assert.equal(h.ui.fileName.value, 'newest.md');
  assert.equal(h.shell.previewPresentation.selectionRevision, 2);
  assert.equal(h.recents.snapshot.revision, 2);
});
