/* eslint-disable @typescript-eslint/explicit-function-return-type */
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
const officeCancelCalls = [];
const runtime = {
  search: async (request) => {
    searchCalls.push(request);
    return await globalThis.__globalSearchResponder(request);
  },
  preview: async (request) => {
    previewCalls.push(request);
    return await globalThis.__globalPreviewResponder(request);
  },
  cancelOfficeRead: async (request) => {
    officeCancelCalls.push(request);
    return { ok: true, value: undefined };
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
    previewScheduler: join(
      projectRoot,
      'src/renderer/onlypreview/shell/src/onlyPreviewGlobalSearchPreviewScheduler.service.ts'
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
const { createOnlyPreviewGlobalSearchPreviewScheduler } = await import(
  pathToFileURL(join(buildRoot, 'previewScheduler.mjs')).href
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
  let rejectPromise;
  const promise = new Promise((resolveValue, rejectValue) => {
    resolvePromise = resolveValue;
    rejectPromise = rejectValue;
  });
  return { promise, reject: rejectPromise, resolve: resolvePromise };
};

const tick = () => new Promise((resolveTick) => setImmediate(resolveTick));

const createPreviewClock = () => {
  let now = 0;
  let sequence = 0;
  const timers = new Map();
  return {
    clock: {
      setTimeout(callback, delayMs) {
        const id = ++sequence;
        timers.set(id, { at: now + delayMs, callback });
        return id;
      },
      clearTimeout(id) {
        timers.delete(id);
      }
    },
    advance(delayMs) {
      const target = now + delayMs;
      while (true) {
        const next = [...timers.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort((left, right) => left[1].at - right[1].at || left[0] - right[0])[0];
        if (!next) break;
        timers.delete(next[0]);
        now = next[1].at;
        next[1].callback();
      }
      now = target;
    }
  };
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

const fileResultAt = (resultToken, relativePath) => ({
  ...fileResult(resultToken),
  name: relativePath.slice(relativePath.lastIndexOf('/') + 1),
  relativePath,
  parentRelativePath: relativePath.slice(0, relativePath.lastIndexOf('/'))
});

const contentResult = {
  section: 'contents',
  resultToken: 'content-visible-order',
  fileName: 'README.md',
  relativePath: 'docs/README.md',
  parentRelativePath: 'docs',
  mediaType: 'text',
  contentMatch: {
    snippetText: 'before needle after',
    highlightStart: 7,
    highlightLength: 6
  }
};

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
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 130));
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
  const directorySearchCount = searchCalls.length;
  context.currentDirectoryRelativePath = 'projects/bitterless';
  store.syncCurrentDirectory(context);
  assert.equal(scheduled, 0);
  assert.equal(searchCalls.length, directorySearchCount + 1);
  assert.equal(cancelCalls.at(-1).requestId, searchCalls.at(-2).requestId);
  assert.deepEqual(searchCalls.at(-1).scope, {
    kind: 'directory',
    relativePath: 'projects/bitterless'
  });

  store.setScopeKind('project');
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

test('query identity changes synchronously retire accepted prefix rows and fence stale replies', async () => {
  const firstResponse = deferred();
  const prefixContentResult = {
    ...contentResult,
    resultToken: 'ag-prefix-content',
    contentMatch: { snippetText: 'ag', highlightStart: 0, highlightLength: 2 }
  };
  const context = {
    workspaceId: 'workspace-query-identity',
    generation: 16,
    ready: true,
    rootName: 'bitterless',
    currentDirectoryRelativePath: 'docs'
  };
  globalThis.__globalSearchResponder = async () => await firstResponse.promise;
  globalThis.__globalPreviewResponder = async () => ({
    ok: true,
    value: {
      kind: 'text',
      adapter: 'plain',
      name: 'ag.txt',
      text: 'ag',
      truncated: false
    }
  });

  let scheduled = 0;
  store.exit();
  store.configure(
    () => context,
    async () => true
  );
  store.configureScheduler(() => {
    scheduled += 1;
  });
  store.enter();
  store.setQuery('ag');
  const firstDispatch = store.dispatchLatest();
  await Promise.resolve();
  const firstRequest = searchCalls.at(-1);
  subscriptions.get('onlypreview/search-batch')({
    params: {
      hostId: 'host-global-search',
      batch: {
        workspaceId: context.workspaceId,
        generation: context.generation,
        requestId: firstRequest.requestId,
        files: [fileResult('ag-prefix-result')],
        contents: [prefixContentResult]
      }
    }
  });
  await new Promise((resolveFlush) => setImmediate(resolveFlush));
  assert.equal(store.files.length, 1);
  assert.equal(store.contents.length, 1);
  assert.equal(store.selectedResult.resultToken, 'ag-prefix-content');
  assert.equal(store.preview.text, 'ag');

  const scheduledBeforeReplacement = scheduled;
  store.setQuery('agent-runtime');
  assert.equal(store.query, 'agent-runtime');
  assert.deepEqual(store.files, []);
  assert.deepEqual(store.contents, []);
  assert.equal(store.selectedResult, null);
  assert.equal(store.preview, null);
  assert.equal(store.filesTruncated, false);
  assert.equal(store.contentsTruncated, false);
  assert.equal(store.error, '');
  assert.equal(store.pending, true);
  assert.equal(scheduled, scheduledBeforeReplacement + 1);
  assert.equal(cancelCalls.at(-1).requestId, firstRequest.requestId);

  firstResponse.resolve({
    ok: true,
    value: {
      workspaceId: context.workspaceId,
      generation: context.generation,
      requestId: firstRequest.requestId,
      files: [fileResult('stale-ag-terminal')],
      contents: [{ ...prefixContentResult, resultToken: 'stale-ag-content' }],
      filesTruncated: true,
      contentsTruncated: true
    }
  });
  await firstDispatch;
  assert.deepEqual(store.files, []);
  assert.deepEqual(store.contents, []);
  assert.equal(store.selectedResult, null);
  assert.equal(store.preview, null);
  store.configureScheduler(() => undefined);
});

test('scope identity changes immediately dispatch both directions without the typing scheduler', async () => {
  const projectResponse = deferred();
  const directoryResponse = deferred();
  let directoryDispatchCount = 0;
  const context = {
    workspaceId: 'workspace-scope-identity',
    generation: 17,
    ready: true,
    rootName: 'bitterless',
    currentDirectoryRelativePath: 'docs'
  };
  globalThis.__globalSearchResponder = async (request) => {
    if (request.scope.kind === 'project') return await projectResponse.promise;
    directoryDispatchCount += 1;
    if (directoryDispatchCount > 1) return await directoryResponse.promise;
    return {
      ok: true,
      value: {
        workspaceId: context.workspaceId,
        generation: context.generation,
        requestId: request.requestId,
        files: [fileResult('initial-directory-result')],
        contents: [],
        filesTruncated: false,
        contentsTruncated: false
      }
    };
  };
  globalThis.__globalPreviewResponder = async () => ({
    ok: true,
    value: {
      kind: 'text',
      adapter: 'plain',
      name: 'README.md',
      text: 'needle',
      truncated: false
    }
  });

  store.exit();
  store.configure(
    () => context,
    async () => true
  );
  store.configureScheduler(() => undefined);
  store.enter();
  store.setQuery('needle');
  await store.dispatchLatest();
  assert.equal(store.files.length, 1);

  let scheduled = 0;
  store.configureScheduler(() => {
    scheduled += 1;
  });
  const callsBeforeScopeChanges = searchCalls.length;
  store.setScopeKind('project');
  assert.equal(searchCalls.length, callsBeforeScopeChanges + 1);
  assert.deepEqual(searchCalls.at(-1).scope, { kind: 'project' });
  assert.deepEqual(store.files, []);
  assert.equal(store.pending, true);

  store.setScopeKind('directory');
  assert.equal(searchCalls.length, callsBeforeScopeChanges + 2);
  assert.deepEqual(searchCalls.at(-1).scope, {
    kind: 'directory',
    relativePath: 'docs'
  });
  assert.equal(scheduled, 0);

  const projectRequest = searchCalls.at(-2);
  projectResponse.resolve({
    ok: true,
    value: {
      workspaceId: context.workspaceId,
      generation: context.generation,
      requestId: projectRequest.requestId,
      files: [fileResult('stale-project-result')],
      contents: [],
      filesTruncated: false,
      contentsTruncated: false
    }
  });
  await new Promise((resolveFlush) => setImmediate(resolveFlush));
  assert.deepEqual(store.files, []);

  const directoryRequest = searchCalls.at(-1);
  directoryResponse.resolve({
    ok: true,
    value: {
      workspaceId: context.workspaceId,
      generation: context.generation,
      requestId: directoryRequest.requestId,
      files: [fileResult('fresh-directory-result')],
      contents: [],
      filesTruncated: false,
      contentsTruncated: false
    }
  });
  await new Promise((resolveFlush) => setImmediate(resolveFlush));
  assert.equal(store.files[0].resultToken, 'fresh-directory-result');

  store.setQuery('');
  const callsBeforeEmptyScopeChanges = searchCalls.length;
  store.setScopeKind('project');
  store.setScopeKind('directory');
  assert.equal(searchCalls.length, callsBeforeEmptyScopeChanges);
  assert.equal(scheduled, 0);
  store.configureScheduler(() => undefined);
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

test('linear selection follows Contents then Files and each collapsed pane remains independent', async () => {
  const context = {
    workspaceId: 'workspace-visible-order',
    generation: 15,
    ready: true,
    rootName: 'bitterless',
    currentDirectoryRelativePath: 'docs'
  };
  globalThis.__globalSearchResponder = async (request) => ({
    ok: true,
    value: {
      workspaceId: context.workspaceId,
      generation: context.generation,
      requestId: request.requestId,
      files: [fileResult('file-visible-order')],
      contents: [contentResult],
      filesTruncated: false,
      contentsTruncated: false
    }
  });
  globalThis.__globalPreviewResponder = async () => ({
    ok: true,
    value: {
      kind: 'text',
      adapter: 'markdown',
      name: 'README.md',
      text: '# File head\nneedle after',
      truncated: false
    }
  });

  store.exit();
  store.configure(() => context, async () => true);
  store.configureScheduler(() => undefined);
  store.enter();
  store.setQuery('needle');
  await store.dispatchLatest();

  assert.deepEqual(
    store.visibleResults.map(({ resultToken }) => resultToken),
    ['content-visible-order', 'file-visible-order']
  );
  assert.equal(store.selectedResult.resultToken, 'content-visible-order');
  store.moveSelection(1);
  assert.equal(store.selectedResult.resultToken, 'file-visible-order');

  store.toggleGroup('contents', false);
  assert.deepEqual(
    store.visibleResults.map(({ resultToken }) => resultToken),
    ['file-visible-order']
  );
  assert.equal(store.filesCollapsed, false);

  store.toggleGroup('contents', true);
  store.toggleGroup('files', false);
  assert.deepEqual(
    store.visibleResults.map(({ resultToken }) => resultToken),
    ['content-visible-order']
  );
  assert.equal(store.contentsCollapsed, false);
});

test('Shell, Vue, and Chrome entries keep the first Escape for clear and the second for close', async () => {
  for (const origin of ['shell', 'vue', 'chrome']) {
    store.exit();
    store.enter(origin);
    store.setQuery('needle');
    await store.handleEscape();
    assert.equal(store.active, true);
    assert.equal(store.query, '');
    await store.handleEscape();
    assert.equal(store.active, false);
  }
});

test('body-gutter dismiss and empty-query Escape share the opener close path', async () => {
  const closeModes = [];
  store.exit();
  store.configure(
    () => null,
    async () => true,
    async (mode) => closeModes.push(mode)
  );

  store.enter('chrome');
  await store.dismiss();
  assert.deepEqual(closeModes, ['opener']);
  assert.equal(store.active, false);
  assert.equal(store.restoreFocusOnExit, false);

  store.enter('vue');
  await store.handleEscape();
  assert.deepEqual(closeModes, ['opener', 'opener']);
  assert.equal(store.active, false);
  assert.equal(store.restoreFocusOnExit, false);
});

const previewValue = (name, text) => ({
  ok: true,
  value: { kind: 'text', adapter: 'plain', name, text, truncated: false }
});

test('Store A to B to C dispatches only C trailing and stale A settlement cannot clear C pending', async () => {
  const clock = createPreviewClock();
  const oldA = deferred();
  const currentC = deferred();
  const resultA = fileResultAt('rapid-a', 'docs/a.txt');
  const resultB = fileResultAt('rapid-b', 'docs/b.txt');
  const resultC = fileResultAt('rapid-c', 'docs/c.txt');
  const context = {
    workspaceId: 'workspace-rapid-abc',
    generation: 21,
    ready: true,
    rootName: 'bitterless',
    currentDirectoryRelativePath: 'docs'
  };
  globalThis.__globalSearchResponder = async (request) => ({
    ok: true,
    value: {
      workspaceId: context.workspaceId,
      generation: context.generation,
      requestId: request.requestId,
      files: [resultA, resultB, resultC],
      contents: [],
      filesTruncated: false,
      contentsTruncated: false
    }
  });
  globalThis.__globalPreviewResponder = async ({ resultToken }) => {
    if (resultToken === resultA.resultToken) return await oldA.promise;
    if (resultToken === resultC.resultToken) return await currentC.promise;
    assert.fail('intermediate B preview must never dispatch');
  };

  store.resetForWorkspace();
  store.configure(() => context, async () => true);
  store.configureScheduler(() => undefined);
  store.configurePreviewScheduler(
    createOnlyPreviewGlobalSearchPreviewScheduler(
      (candidate) => store.dispatchPreview(candidate),
      120,
      clock.clock
    )
  );
  store.enter();
  store.setQuery('rapid');
  const firstCall = previewCalls.length;
  await store.dispatchLatest();
  await tick();
  assert.deepEqual(
    previewCalls.slice(firstCall).map(({ resultToken }) => resultToken),
    ['rapid-a']
  );

  store.selectResult(resultB);
  store.selectResult(resultC);
  assert.equal(store.previewPending, true);
  assert.equal(store.preview, null);
  clock.advance(120);
  await tick();
  assert.deepEqual(
    previewCalls.slice(firstCall).map(({ resultToken }) => resultToken),
    ['rapid-a', 'rapid-c']
  );

  oldA.resolve(previewValue('a.txt', 'stale A'));
  await tick();
  assert.equal(store.preview, null);
  assert.equal(store.previewError, '');
  assert.equal(store.previewPending, true, 'stale A finally must not clear current C pending');

  currentC.resolve(previewValue('c.txt', 'current C'));
  await tick();
  assert.equal(store.preview.text, 'current C');
  assert.equal(store.previewPending, false);
});

test('Store A to B to A uses the new epoch and stale A error/finally cannot clear new A pending', async () => {
  const clock = createPreviewClock();
  const oldA = deferred();
  const newA = deferred();
  const resultA = fileResultAt('aba-a', 'docs/a-again.txt');
  const resultB = fileResultAt('aba-b', 'docs/b-skipped.txt');
  const context = {
    workspaceId: 'workspace-rapid-aba',
    generation: 22,
    ready: true,
    rootName: 'bitterless',
    currentDirectoryRelativePath: 'docs'
  };
  let aCalls = 0;
  globalThis.__globalSearchResponder = async (request) => ({
    ok: true,
    value: {
      workspaceId: context.workspaceId,
      generation: context.generation,
      requestId: request.requestId,
      files: [resultA, resultB],
      contents: [],
      filesTruncated: false,
      contentsTruncated: false
    }
  });
  globalThis.__globalPreviewResponder = async ({ resultToken }) => {
    if (resultToken === resultB.resultToken) assert.fail('intermediate B must not dispatch');
    aCalls += 1;
    return await (aCalls === 1 ? oldA.promise : newA.promise);
  };

  store.resetForWorkspace();
  store.configure(() => context, async () => true);
  store.configureScheduler(() => undefined);
  store.configurePreviewScheduler(
    createOnlyPreviewGlobalSearchPreviewScheduler(
      (candidate) => store.dispatchPreview(candidate),
      120,
      clock.clock
    )
  );
  store.enter();
  store.setQuery('aba');
  const firstCall = previewCalls.length;
  await store.dispatchLatest();
  await tick();
  store.selectResult(resultB);
  store.selectResult(resultA);
  clock.advance(120);
  await tick();
  assert.deepEqual(
    previewCalls.slice(firstCall).map(({ resultToken }) => resultToken),
    ['aba-a', 'aba-a']
  );

  oldA.reject(new Error('stale A failed'));
  await tick();
  assert.equal(store.preview, null);
  assert.equal(store.previewError, '');
  assert.equal(store.previewPending, true, 'stale A finally must not clear new A pending');

  newA.resolve(previewValue('a-again.txt', 'new A'));
  await tick();
  assert.equal(store.preview.text, 'new A');
  assert.equal(store.previewPending, false);
});

test('query, scope, workspace, exit, and shutdown each cancel a queued trailing preview', async () => {
  const scenarios = [
    {
      name: 'query',
      act: ({ store: activeStore }) => activeStore.setQuery('replacement-query')
    },
    {
      name: 'scope',
      act: ({ store: activeStore }) => activeStore.setScopeKind('project')
    },
    {
      name: 'workspace',
      act: ({ setContext }) =>
        setContext({
          workspaceId: 'replacement-workspace',
          generation: 1,
          ready: true,
          rootName: 'replacement',
          currentDirectoryRelativePath: ''
        })
    },
    { name: 'exit', act: ({ store: activeStore }) => activeStore.exit(false) },
    { name: 'shutdown', act: ({ store: activeStore }) => activeStore.shutdown() }
  ];

  for (const scenario of scenarios) {
    const clock = createPreviewClock();
    const resultA = fileResultAt(`${scenario.name}-a`, `docs/${scenario.name}-a.txt`);
    const resultB = fileResultAt(`${scenario.name}-b`, `docs/${scenario.name}-b.txt`);
    let context = {
      workspaceId: `workspace-cancel-${scenario.name}`,
      generation: 31,
      ready: true,
      rootName: 'bitterless',
      currentDirectoryRelativePath: 'docs'
    };
    let searchCount = 0;
    globalThis.__globalSearchResponder = async (request) => {
      searchCount += 1;
      return {
        ok: true,
        value: {
          workspaceId: context.workspaceId,
          generation: context.generation,
          requestId: request.requestId,
          files: searchCount === 1 ? [resultA, resultB] : [],
          contents: [],
          filesTruncated: false,
          contentsTruncated: false
        }
      };
    };
    globalThis.__globalPreviewResponder = async ({ resultToken }) =>
      previewValue(`${resultToken}.txt`, resultToken);

    store.resetForWorkspace();
    store.configure(() => context, async () => true);
    store.configureScheduler(() => undefined);
    store.configurePreviewScheduler(
      createOnlyPreviewGlobalSearchPreviewScheduler(
        (candidate) => store.dispatchPreview(candidate),
        120,
        clock.clock
      )
    );
    store.setContext(context);
    store.enter();
    store.setQuery(`cancel-${scenario.name}`);
    const firstCall = previewCalls.length;
    await store.dispatchLatest();
    await tick();
    store.selectResult(resultB);
    const setContext = (nextContext) => {
      context = nextContext;
      store.setContext(nextContext);
    };
    scenario.act({ setContext, store });
    await tick();
    clock.advance(240);
    await tick();
    assert.equal(
      previewCalls.slice(firstCall).some(({ resultToken }) => resultToken === resultB.resultToken),
      false,
      `${scenario.name} must cancel its queued trailing preview`
    );
  }
});
