import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(new URL(import.meta.url).pathname), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-global-search-shell-'));
const subscriptions = new Map();
const searchCalls = [];
const previewCalls = [];
const cancelCalls = [];
const runtime = {
  search: async (request) => {
    searchCalls.push(request);
    return await globalThis.__globalSearchResponder(request);
  },
  preview: async (request) => {
    previewCalls.push(request);
    return await globalThis.__globalPreviewResponder(request);
  },
  cancel: async (request) => {
    cancelCalls.push(request);
    return { ok: true, value: undefined };
  },
  shutdown: async () => ({ ok: true, value: undefined })
};

globalThis.window = {
  onlyPreviewEnv: {
    hostId: 'host-global-search',
    hostToken: 'host-token-global-search-000000',
    mode: 'standalone',
    platform: 'darwin'
  }
};
globalThis.__onlyPreviewGlobalSearchRuntime = runtime;
globalThis.__onlyPreviewGlobalSearchSubscriptions = subscriptions;

await build({
  entryPoints: {
    store: join(
      projectRoot,
      'src/renderer/onlypreview/shell/src/onlyPreviewGlobalSearch.store.ts'
    ),
    shellStore: join(projectRoot, 'src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts')
  },
  outdir: buildRoot,
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  tsconfig: join(projectRoot, 'tsconfig.web.json'),
  plugins: [
    {
      name: 'global-search-xpc-stub',
      setup(context) {
        context.onResolve({ filter: /^electron-xpc\/renderer$/ }, () => ({
          path: 'renderer',
          namespace: 'global-search-test'
        }));
        context.onLoad(
          { filter: /^renderer$/, namespace: 'global-search-test' },
          () => ({
            contents: `
              export const createXpcRendererEmitter = () => globalThis.__onlyPreviewGlobalSearchRuntime;
              export const xpcRenderer = {
                subscribe(name, listener) {
                  if (globalThis.__throwOnlyPreviewSubscription) throw new Error('subscription failed');
                  globalThis.__onlyPreviewGlobalSearchSubscriptions.set(name, listener);
                }
              };
            `
          })
        );
      }
    }
  ]
});

await build({
  entryPoints: [
    join(
      projectRoot,
      'src/renderer/onlypreview/shell/src/onlyPreviewGlobalSearchTree.service.ts'
    )
  ],
  outfile: join(buildRoot, 'tree.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  tsconfig: join(projectRoot, 'tsconfig.web.json')
});

await build({
  entryPoints: [
    join(
      projectRoot,
      'src/renderer/onlypreview/shell/src/onlyPreviewGlobalSearchResult.service.ts'
    )
  ],
  outfile: join(buildRoot, 'result.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  tsconfig: join(projectRoot, 'tsconfig.web.json')
});

const { onlyPreviewGlobalSearchStore: store } = await import(
  pathToFileURL(join(buildRoot, 'store.mjs')).href
);
const { OnlyPreviewShellStore } = await import(
  pathToFileURL(join(buildRoot, 'shellStore.mjs')).href
);
const { revealOnlyPreviewGlobalSearchDirectory } = await import(
  pathToFileURL(join(buildRoot, 'tree.mjs')).href
);
const { getOnlyPreviewGlobalSearchDisplayType } = await import(
  pathToFileURL(join(buildRoot, 'result.mjs')).href
);

after(() => {
  store.exit();
  rmSync(buildRoot, { recursive: true, force: true });
  delete globalThis.__globalSearchResponder;
  delete globalThis.__globalPreviewResponder;
  delete globalThis.__onlyPreviewGlobalSearchRuntime;
  delete globalThis.__onlyPreviewGlobalSearchSubscriptions;
  delete globalThis.__throwOnlyPreviewSubscription;
  delete globalThis.window;
});

const deferred = () => {
  let resolvePromise;
  const promise = new Promise((resolveValue) => {
    resolvePromise = resolveValue;
  });
  return { promise, resolve: resolvePromise };
};

const createDiagnosticRecorder = () => {
  const events = [];
  let sequence = 0;
  return {
    events,
    diagnostics: {
      now: () => 0,
      elapsed: () => 0,
      nextTag: (prefix) => `${prefix}${++sequence}`,
      emit: (event, fields) => {
        events.push({ event, ...fields });
        return true;
      }
    }
  };
};

const fileResult = (resultToken) => ({
  section: 'files',
  resultToken,
  name: 'README.md',
  relativePath: 'docs/README.md',
  parentRelativePath: 'docs',
  nodeKind: 'file',
  previewHint: 'text',
  mediaType: 'text'
});

const directoryResult = {
  section: 'files',
  resultToken: 'directory-result-token',
  name: 'network',
  relativePath: 'areas/network',
  parentRelativePath: 'areas',
  nodeKind: 'directory',
  previewHint: 'unsupported',
  mediaType: 'unknown'
};

test('Shell subscription sync failure emits exactly one initialized failure', async () => {
  const recorded = createDiagnosticRecorder();
  globalThis.__throwOnlyPreviewSubscription = true;
  const shellStore = new OnlyPreviewShellStore(recorded.diagnostics);
  await assert.rejects(shellStore.initialize(), /subscription failed/);
  delete globalThis.__throwOnlyPreviewSubscription;
  assert.deepEqual(
    recorded.events
      .filter(({ event }) => event === 'shell-initialized')
      .map(({ outcome }) => outcome),
    ['failure']
  );
});

test('directory result display type is folder without changing protocol mediaType', () => {
  assert.equal(getOnlyPreviewGlobalSearchDisplayType(directoryResult), 'folder');
  assert.equal(directoryResult.mediaType, 'unknown');
  assert.equal(getOnlyPreviewGlobalSearchDisplayType(fileResult('file-display-token')), 'text');
});

test('terminal token replacement refetches preview and fences the revoked early preview', async () => {
  const diagnosticLines = [];
  const originalInfo = console.info;
  console.info = (line) => diagnosticLines.push(line);
  const terminal = deferred();
  const earlyPreview = deferred();
  globalThis.__globalSearchResponder = async () => await terminal.promise;
  globalThis.__globalPreviewResponder = async (request) => {
    if (request.resultToken === 'early-result-token') return await earlyPreview.promise;
    return {
      ok: true,
      value: {
        kind: 'text',
        adapter: 'markdown',
        name: 'README.md',
        text: '# authoritative',
        truncated: false
      }
    };
  };

  const context = {
    workspaceId: 'workspace-global-search',
    generation: 7,
    ready: true,
    rootName: 'bitterless',
    currentDirectoryRelativePath: 'docs'
  };
  store.exit();
  store.configure(() => context, async () => true);
  store.configureScheduler(() => undefined);
  store.subscribe();
  store.enter();
  store.setQuery('readme');
  const dispatch = store.dispatchLatest();
  await Promise.resolve();
  const request = searchCalls.at(-1);
  assert.ok(request);

  subscriptions.get('onlypreview/search-batch')({
    params: {
      hostId: 'host-global-search',
      batch: {
        workspaceId: context.workspaceId,
        generation: context.generation,
        requestId: request.requestId,
        files: [fileResult('early-result-token')],
        contents: []
      }
    }
  });
  await Promise.resolve();
  assert.equal(store.selectedResult.resultToken, 'early-result-token');
  assert.equal(previewCalls.at(-1).resultToken, 'early-result-token');

  terminal.resolve({
    ok: true,
    value: {
      workspaceId: context.workspaceId,
      generation: context.generation,
      requestId: request.requestId,
      files: [fileResult('terminal-result-token')],
      contents: [],
      filesTruncated: false,
      contentsTruncated: false
    }
  });
  await dispatch;
  await Promise.resolve();
  assert.equal(store.selectedResult.resultToken, 'terminal-result-token');
  assert.equal(previewCalls.at(-1).resultToken, 'terminal-result-token');
  assert.equal(store.preview.text, '# authoritative');

  earlyPreview.resolve({
    ok: true,
    value: {
      kind: 'text',
      adapter: 'plain',
      name: 'README.md',
      text: 'revoked early preview',
      truncated: false
    }
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(store.preview.text, '# authoritative');
  console.info = originalInfo;
  assert.equal(diagnosticLines.filter((line) => line.includes('event=shell-dispatch')).length, 1);
  assert.equal(diagnosticLines.filter((line) => line.includes('event=shell-first-batch')).length, 1);
  assert.equal(diagnosticLines.filter((line) => line.includes('event=shell-terminal')).length, 1);
  assert.doesNotMatch(diagnosticLines.join('\n'), /readme|README|docs\/|authoritative/);
});

test('explicit Project selection updates Current directory and only re-runs directory Contents', async () => {
  const context = {
    workspaceId: 'workspace-scope',
    generation: 8,
    ready: true,
    rootName: 'bitterless',
    currentDirectoryRelativePath: 'src/renderer'
  };
  globalThis.__globalSearchResponder = async (request) => ({
    ok: true,
    value: {
      workspaceId: context.workspaceId,
      generation: context.generation,
      requestId: request.requestId,
      files: [],
      contents: [],
      filesTruncated: false,
      contentsTruncated: false
    }
  });
  store.exit();
  store.configure(() => context, async () => true);
  store.configureScheduler(() => undefined);
  store.enter();
  assert.equal(store.directoryRelativePath, 'src/renderer');
  context.currentDirectoryRelativePath = 'areas/network';
  store.enter();
  assert.equal(
    store.directoryRelativePath,
    'src/renderer',
    'focus-only entry must not change the captured directory'
  );
  store.syncCurrentDirectory(context);
  assert.equal(store.directoryRelativePath, 'areas/network');
  assert.equal(store.directoryLabel, 'areas/network');

  store.setQuery('network');
  await store.dispatchLatest();
  assert.deepEqual(searchCalls.at(-1).scope, {
    kind: 'directory',
    relativePath: 'areas/network'
  });

  let scheduled = 0;
  store.configureScheduler(() => {
    scheduled += 1;
  });
  context.currentDirectoryRelativePath = 'projects/bitterless';
  store.syncCurrentDirectory(context);
  assert.equal(scheduled, 1);
  assert.equal(cancelCalls.at(-1).requestId, searchCalls.at(-1).requestId);
  await store.dispatchLatest();
  assert.deepEqual(searchCalls.at(-1).scope, {
    kind: 'directory',
    relativePath: 'projects/bitterless'
  });

  store.setScopeKind('project');
  await store.dispatchLatest();
  assert.deepEqual(searchCalls.at(-1).scope, { kind: 'project' });

  const projectScheduleCount = scheduled;
  const projectCancelCount = cancelCalls.length;
  context.currentDirectoryRelativePath = 'docs';
  store.syncCurrentDirectory(context);
  assert.equal(store.directoryRelativePath, 'docs');
  assert.equal(store.directoryLabel, 'docs');
  assert.equal(scheduled, projectScheduleCount);
  assert.equal(cancelCalls.length, projectCancelCount);

  store.setScopeKind('directory');
  await store.dispatchLatest();
  assert.deepEqual(searchCalls.at(-1).scope, {
    kind: 'directory',
    relativePath: 'docs'
  });

  const watchScheduleCount = scheduled;
  subscriptions.get('onlypreview/search-watch-commit')({
    params: {
      hostId: 'host-global-search',
      commit: {
        workspaceId: context.workspaceId,
        generation: context.generation,
        revision: 1,
        full: false,
        changedRelativePaths: ['areas/network/new-file.ts']
      }
    }
  });
  assert.equal(
    scheduled,
    watchScheduleCount + 1,
    'project-wide Files changes must refresh a directory-scoped query'
  );
  store.configureScheduler(() => undefined);
});

test('Shell search failure emits exactly one failure terminal', async () => {
  const recorded = createDiagnosticRecorder();
  store.configureDiagnostics(recorded.diagnostics);
  const context = {
    workspaceId: 'workspace-failure',
    generation: 9,
    ready: true,
    rootName: 'bitterless',
    currentDirectoryRelativePath: ''
  };
  globalThis.__globalSearchResponder = async () => ({
    ok: false,
    error: { code: 'OPERATION_FAILED', message: 'failed' }
  });
  store.exit();
  store.configure(() => context, async () => true);
  store.configureScheduler(() => undefined);
  store.enter();
  store.setQuery('failure');
  await store.dispatchLatest();
  assert.deepEqual(
    recorded.events.filter(({ event }) => event === 'shell-terminal').map(({ outcome }) => outcome),
    ['failure']
  );
});

test('superseded Shell search emits exactly one cancelled terminal', async () => {
  const recorded = createDiagnosticRecorder();
  store.configureDiagnostics(recorded.diagnostics);
  const pending = deferred();
  const context = {
    workspaceId: 'workspace-cancel',
    generation: 10,
    ready: true,
    rootName: 'bitterless',
    currentDirectoryRelativePath: ''
  };
  globalThis.__globalSearchResponder = async () => await pending.promise;
  store.exit();
  store.configure(() => context, async () => true);
  store.configureScheduler(() => undefined);
  store.enter();
  store.setQuery('first');
  const firstDispatch = store.dispatchLatest();
  await Promise.resolve();
  store.setQuery('second');
  pending.resolve({
    ok: true,
    value: {
      workspaceId: context.workspaceId,
      generation: context.generation,
      requestId: searchCalls.at(-1).requestId,
      files: [],
      contents: [],
      filesTruncated: false,
      contentsTruncated: false
    }
  });
  await firstDispatch;
  assert.deepEqual(
    recorded.events.filter(({ event }) => event === 'shell-terminal').map(({ outcome }) => outcome),
    ['cancelled']
  );
});

test('directory open publishes one centered Project focus intent only after reveal succeeds', async () => {
  const context = {
    workspaceId: 'workspace-folder-open',
    generation: 9,
    ready: true,
    rootName: 'bitterless',
    currentDirectoryRelativePath: ''
  };
  const folder = directoryResult;
  store.exit();
  store.configure(() => context, async () => true);
  store.enter();
  store.setQuery('network');
  store.files = [folder];
  store.selectResult(folder);
  await store.openSelected();
  assert.equal(store.active, false);
  assert.equal(store.restoreFocusOnExit, false);
  assert.equal(store.consumeCenteredProjectPath(), 'areas/network');
  assert.equal(store.consumeCenteredProjectPath(), null);

  store.configure(() => context, async () => false);
  store.enter();
  store.setQuery('network');
  store.files = [folder];
  store.selectResult(folder);
  await store.openSelected();
  assert.equal(store.active, true);
  assert.equal(store.query, 'network');
  assert.deepEqual(store.files, [folder]);
  assert.equal(store.consumeCenteredProjectPath(), null);
});

test('directory reveal loads every level before atomically expanding root, ancestors, and target', async () => {
  const relativePath = 'areas/network/private';
  const calls = [];
  const applied = [];
  const index = { entries: [{ relativePath }] };
  const projection = {
    async loadSelectedParentListings(selectedPath) {
      calls.push(['parents', selectedPath]);
      return { loaded: true, index };
    },
    async loadDirectory(selectedPath) {
      calls.push(['directory', selectedPath]);
      return { loaded: true, index };
    }
  };
  const expandedPaths = new Set();
  assert.equal(
    await revealOnlyPreviewGlobalSearchDirectory({
      relativePath,
      projection,
      context: { hostToken: 'host-token', workspaceId: 'workspace', generation: 1 },
      expandedPaths,
      applyResult: (projectionResult) => applied.push(projectionResult)
    }),
    true
  );
  assert.deepEqual(calls, [
    ['parents', 'areas/network/private/_scope'],
    ['directory', relativePath]
  ]);
  assert.deepEqual([...expandedPaths], ['', 'areas', 'areas/network', relativePath]);
  assert.equal(applied.length, 2);

  for (const failedStage of ['parents', 'directory']) {
    const failedExpandedPaths = new Set();
    let directoryCalls = 0;
    const failed = await revealOnlyPreviewGlobalSearchDirectory({
      relativePath,
      projection: {
        async loadSelectedParentListings() {
          return { loaded: failedStage !== 'parents', index };
        },
        async loadDirectory() {
          directoryCalls += 1;
          return { loaded: failedStage !== 'directory', index };
        }
      },
      context: { hostToken: 'host-token', workspaceId: 'workspace', generation: 1 },
      expandedPaths: failedExpandedPaths,
      applyResult: () => undefined
    });
    assert.equal(failed, false);
    assert.deepEqual([...failedExpandedPaths], []);
    assert.equal(directoryCalls, failedStage === 'parents' ? 0 : 1);
  }
});

test('every fresh Global Search entry expands Files and Contents and keeps the opener origin', () => {
  store.exit();
  store.enter('chrome');
  store.setPreviewPercent(61);
  store.toggleGroup('files', false);
  store.toggleGroup('contents', false);
  assert.equal(store.filesCollapsed, true);
  assert.equal(store.contentsCollapsed, true);
  assert.equal(store.openerOrigin, 'chrome');

  store.exit();
  store.enter('vue');
  assert.equal(store.filesCollapsed, false);
  assert.equal(store.contentsCollapsed, false);
  assert.equal(store.openerOrigin, 'vue');
  assert.equal(store.previewPercent, 61);
});

test('Shell, Vue, and Chrome entries keep the first Escape for clear and the second for close', () => {
  for (const origin of ['shell', 'vue', 'chrome']) {
    store.exit();
    store.enter(origin);
    store.setQuery('needle');
    store.handleEscape();
    assert.equal(store.active, true);
    assert.equal(store.query, '');
    store.handleEscape();
    assert.equal(store.active, false);
  }
});
