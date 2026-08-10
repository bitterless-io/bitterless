/* eslint-disable @typescript-eslint/explicit-function-return-type */

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(new URL(import.meta.url).pathname), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-onlypreview-search-shell-'));
const source = (relativePath) => readFileSync(join(projectRoot, relativePath), 'utf8');

globalThis.window = {
  onlyPreviewEnv: {
    hostId: 'host-search-shell',
    hostToken: 'host-token-search-shell-000000000000',
    mode: 'standalone',
    platform: 'darwin'
  }
};

const searchCalls = [];
const cancelCalls = [];
const shutdownCalls = [];
const rendererSubscriptions = new Map();
let searchResponder = async () => {
  throw new Error('Search responder was not configured.');
};

globalThis.__onlyPreviewSearchRuntime = {
  initialize: async () => {
    throw new Error('Unexpected initialize call.');
  },
  refresh: async () => {
    throw new Error('Unexpected refresh call.');
  },
  search: async (request) => {
    searchCalls.push(request);
    return searchResponder(request);
  },
  cancel: async (request) => {
    cancelCalls.push(request);
    return { ok: true, value: undefined };
  },
  shutdown: async (request) => {
    shutdownCalls.push(request);
    return { ok: true, value: undefined };
  }
};
globalThis.__onlyPreviewRendererSubscriptions = rendererSubscriptions;

await build({
  entryPoints: {
    highlight: join(
      projectRoot,
      'src/renderer/onlypreview/shell/src/components/ProjectSearchResults/onlyPreviewSearchHighlight.service.ts'
    ),
    projectSearchStore: join(
      projectRoot,
      'src/renderer/onlypreview/shell/src/onlyPreviewProjectSearch.store.ts'
    ),
    snapshot: join(
      projectRoot,
      'src/renderer/onlypreview/shell/src/onlyPreviewSearchSnapshot.service.ts'
    ),
    tree: join(projectRoot, 'src/renderer/onlypreview/shell/src/onlyPreviewTree.service.ts'),
    characterCountGate: join(
      projectRoot,
      'src/renderer/onlypreview/common/onlyPreviewCharacterCountGate.service.ts'
    )
  },
  outdir: buildRoot,
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: 'inline',
  tsconfig: join(projectRoot, 'tsconfig.web.json'),
  plugins: [
    {
      name: 'onlypreview-search-xpc-stub',
      setup(buildContext) {
        buildContext.onResolve({ filter: /^electron-xpc\/renderer$/ }, () => ({
          path: 'electron-xpc-renderer',
          namespace: 'onlypreview-test'
        }));
        buildContext.onLoad(
          { filter: /^electron-xpc-renderer$/, namespace: 'onlypreview-test' },
          () => ({
            contents: `export const createXpcRendererEmitter = () => globalThis.__onlyPreviewSearchRuntime;
               export const xpcRenderer = {
                 subscribe(eventName, listener) {
                   globalThis.__onlyPreviewRendererSubscriptions.set(eventName, listener);
                 },
                 broadcast() {}
               };`
          })
        );
      }
    }
  ]
});

const highlight = await import(pathToFileURL(join(buildRoot, 'highlight.mjs')).href);
const projectSearchModule = await import(
  pathToFileURL(join(buildRoot, 'projectSearchStore.mjs')).href
);
const snapshot = await import(pathToFileURL(join(buildRoot, 'snapshot.mjs')).href);
const tree = await import(pathToFileURL(join(buildRoot, 'tree.mjs')).href);
const characterCountGate = await import(
  pathToFileURL(join(buildRoot, 'characterCountGate.mjs')).href
);
const projectSearchStore = projectSearchModule.onlyPreviewProjectSearchStore;

after(() => {
  projectSearchStore.exit();
  rmSync(buildRoot, { recursive: true, force: true });
  delete globalThis.__onlyPreviewSearchRuntime;
  delete globalThis.__onlyPreviewRendererSubscriptions;
  delete globalThis.window;
});

const deferred = () => {
  let resolvePromise;
  const promise = new Promise((resolveValue) => {
    resolvePromise = resolveValue;
  });
  return { promise, resolve: resolvePromise };
};

const responseFor = (request, results = []) => ({
  ok: true,
  value: {
    workspaceId: request.workspaceId,
    generation: request.generation,
    requestId: request.requestId,
    results,
    truncated: false
  }
});

const batchFor = (request, results = []) => ({
  workspaceId: request.workspaceId,
  generation: request.generation,
  requestId: request.requestId,
  results
});

const textResult = (relativePath, contentMatch = null) => ({
  fileName: relativePath.slice(relativePath.lastIndexOf('/') + 1),
  relativePath,
  mediaType: 'text',
  contentMatch
});

const searchSnapshotEntry = (overrides = {}) => ({
  relativePath: 'docs/readme.md',
  parentRelativePath: 'docs',
  name: 'readme.md',
  nodeKind: 'file',
  size: 128,
  modifiedAt: 1_725_000_000_000,
  previewHint: 'text',
  mediaType: 'text',
  isText: true,
  ...overrides
});

const searchSnapshotMemory = (overrides = {}) => ({
  measurementComplete: true,
  processRssBytes: 512_000_000,
  workerHeapUsedBytes: 64_000_000,
  workerExternalBytes: 8_000_000,
  treeMetadataEntryCount: 30_000,
  treeMetadataEstimatedBytes: 14_000_000,
  filenameTierEstimatedBytes: 12_000_000,
  diskIndexBytes: 1_400_000_000,
  runtimeOneGiBWarning: false,
  runtimeTwoGiBLimitExceeded: false,
  ...overrides
});

const searchSnapshotEvent = () => ({
  hostId: 'host-search-shell',
  snapshot: {
    workspaceId: 'workspace-search-shell',
    generation: 7,
    state: 'ready',
    index: {
      workspaceId: 'workspace-search-shell',
      entries: [searchSnapshotEntry()],
      truncated: false,
      limit: 1
    },
    memory: searchSnapshotMemory()
  }
});

const resetProjectSearch = (resolveContext) => {
  projectSearchStore.exit();
  searchCalls.length = 0;
  cancelCalls.length = 0;
  shutdownCalls.length = 0;
  let scheduled = 0;
  const selected = [];
  projectSearchStore.configure(resolveContext, (relativePath) => selected.push(relativePath));
  projectSearchStore.configureScheduler(() => {
    scheduled += 1;
  });
  projectSearchStore.enter();
  return { scheduled: () => scheduled, selected };
};

const projectSearchContext = (overrides = {}) => ({
  workspaceId: 'workspace-search-shell',
  generation: 7,
  ready: true,
  rootName: 'overmind',
  focusedRelativePath: '',
  focusedNodeKind: null,
  selectedRelativePath: '',
  ...overrides
});

test('highlight projection uses grapheme offsets and never summarizes non-text results', () => {
  const match = {
    snippetText: 'A👨‍👩‍👧‍👦e\u0301中Z',
    highlightStart: 1,
    highlightLength: 2
  };
  assert.deepEqual(highlight.splitOnlyPreviewSearchHighlight(match), {
    before: 'A',
    highlight: '👨‍👩‍👧‍👦e\u0301',
    after: '中Z'
  });
  assert.equal(
    highlight.splitOnlyPreviewSearchHighlight({
      ...match,
      highlightStart: 8,
      highlightLength: 1
    }),
    null
  );

  const rows = highlight.buildOnlyPreviewSearchDisplayRows([
    textResult('docs/guide.md', match),
    {
      fileName: 'diagram.png',
      relativePath: 'assets/diagram.png',
      mediaType: 'image',
      contentMatch: match
    },
    textResult('README.md')
  ]);
  assert.equal(rows[0].directory, 'docs');
  assert.equal(rows[0].snippet.highlight, '👨‍👩‍👧‍👦e\u0301');
  assert.equal(rows[1].directory, 'assets');
  assert.equal(rows[1].snippet, null);
  assert.equal(rows[2].directory, '');
  assert.equal(rows[2].snippet, null);
});

test('ordinary Project filter matches only pre-query visible entry names without expanding', () => {
  const entry = (values) => ({
    size: 0,
    modifiedAt: 1,
    previewHint: values.nodeKind === 'file' ? 'text' : 'unsupported',
    mediaType: values.nodeKind === 'file' ? 'text' : 'unknown',
    isText: values.nodeKind === 'file',
    ...values
  });
  const index = {
    workspaceId: 'workspace-search-shell',
    truncated: false,
    limit: 100,
    entries: [
      entry({
        relativePath: '.hidden',
        parentRelativePath: '',
        name: '.hidden',
        nodeKind: 'directory'
      }),
      entry({
        relativePath: '.env',
        parentRelativePath: '',
        name: '.env',
        nodeKind: 'file'
      }),
      entry({
        relativePath: 'README.md',
        parentRelativePath: '',
        name: 'README.md',
        nodeKind: 'file'
      }),
      entry({
        relativePath: 'docs',
        parentRelativePath: '',
        name: 'docs',
        nodeKind: 'directory'
      }),
      entry({
        relativePath: 'docs/guide.md',
        parentRelativePath: 'docs',
        name: 'guide.md',
        nodeKind: 'file'
      }),
      entry({
        relativePath: 'docs/path-only.md',
        parentRelativePath: 'docs',
        name: 'path-only.md',
        nodeKind: 'file'
      }),
      entry({
        relativePath: 'collapsed',
        parentRelativePath: '',
        name: 'collapsed',
        nodeKind: 'directory'
      }),
      entry({
        relativePath: 'collapsed/needle.md',
        parentRelativePath: 'collapsed',
        name: 'needle.md',
        nodeKind: 'file'
      }),
      entry({
        relativePath: 'root-note.txt',
        parentRelativePath: '',
        name: 'root-note.txt',
        nodeKind: 'file'
      }),
      entry({
        relativePath: 'Ｆｕｌｌ.txt',
        parentRelativePath: '',
        name: 'Ｆｕｌｌ.txt',
        nodeKind: 'file'
      })
    ]
  };
  const expandedPaths = new Set(['docs']);

  assert.deepEqual(
    tree.buildOnlyPreviewTreeRows(index, '', expandedPaths).map((row) => row.entry.relativePath),
    [
      '.hidden',
      '.env',
      'README.md',
      'docs',
      'docs/guide.md',
      'docs/path-only.md',
      'collapsed',
      'root-note.txt',
      'Ｆｕｌｌ.txt'
    ]
  );
  assert.deepEqual(
    tree
      .buildOnlyPreviewTreeRows(index, 'guide', expandedPaths)
      .map((row) => row.entry.relativePath),
    ['docs', 'docs/guide.md']
  );
  assert.deepEqual(
    tree.buildOnlyPreviewTreeRows(index, 'DOC', expandedPaths).map((row) => row.entry.relativePath),
    ['docs']
  );
  assert.deepEqual(
    tree
      .buildOnlyPreviewTreeRows(index, 'docs/guide', expandedPaths)
      .map((row) => row.entry.relativePath),
    []
  );
  assert.deepEqual(
    tree
      .buildOnlyPreviewTreeRows(index, 'needle', expandedPaths)
      .map((row) => row.entry.relativePath),
    []
  );
  assert.deepEqual(
    tree
      .buildOnlyPreviewTreeRows(index, '.env', expandedPaths)
      .map((row) => row.entry.relativePath),
    ['.env']
  );
  assert.deepEqual(
    tree
      .buildOnlyPreviewTreeRows(index, 'root-note', expandedPaths)
      .map((row) => row.entry.relativePath),
    ['root-note.txt']
  );
  assert.deepEqual(
    tree
      .buildOnlyPreviewTreeRows(index, 'full', expandedPaths)
      .map((row) => row.entry.relativePath),
    ['Ｆｕｌｌ.txt']
  );
  const collapsedRows = tree.buildOnlyPreviewTreeRows(index, 'collapsed', expandedPaths);
  assert.deepEqual(
    collapsedRows.map((row) => row.entry.relativePath),
    ['collapsed']
  );
  assert.equal(collapsedRows[0].expanded, false);
  assert.deepEqual(expandedPaths, new Set(['docs']));
});

test('ordinary Project filter freezes visible rows and restores expansion after the query', () => {
  const directory = (relativePath, parentRelativePath) => ({
    relativePath,
    parentRelativePath,
    name: relativePath.split('/').at(-1),
    nodeKind: 'directory',
    size: 0,
    modifiedAt: 1,
    previewHint: 'unsupported',
    mediaType: 'unknown',
    isText: false
  });
  const file = (relativePath, parentRelativePath) => ({
    relativePath,
    parentRelativePath,
    name: relativePath.split('/').at(-1),
    nodeKind: 'file',
    size: 1,
    modifiedAt: 1,
    previewHint: 'text',
    mediaType: 'text',
    isText: true
  });
  const index = {
    workspaceId: 'workspace-filter-snapshot',
    truncated: false,
    limit: 4,
    entries: [
      directory('docs', ''),
      file('docs/needle.md', 'docs'),
      directory('collapsed', ''),
      file('collapsed/needle.md', 'collapsed')
    ]
  };
  const expandedPaths = new Set(['docs']);
  tree.onlyPreviewTreeFilter.begin(index, expandedPaths);
  try {
    assert.deepEqual(
      tree.onlyPreviewTreeFilter
        .rows(index, 'needle', expandedPaths)
        .map((row) => row.entry.relativePath),
      ['docs', 'docs/needle.md']
    );
    expandedPaths.delete('docs');
    expandedPaths.add('collapsed');
    index.entries.push(file('new-needle.md', ''));
    assert.deepEqual(
      tree.onlyPreviewTreeFilter
        .rows(index, 'needle', expandedPaths)
        .map((row) => row.entry.relativePath),
      ['docs', 'docs/needle.md']
    );
  } finally {
    tree.onlyPreviewTreeFilter.end(expandedPaths);
  }
  assert.deepEqual(expandedPaths, new Set(['docs']));
});

test('Project Search captures focused directory, file parent, selected parent, then root', () => {
  for (const { context, relativePath, label } of [
    {
      context: projectSearchContext({
        focusedRelativePath: 'src/components',
        focusedNodeKind: 'directory',
        selectedRelativePath: 'docs/readme.md'
      }),
      relativePath: 'src/components',
      label: 'src/components'
    },
    {
      context: projectSearchContext({
        focusedRelativePath: 'src/App.vue',
        focusedNodeKind: 'file',
        selectedRelativePath: 'docs/readme.md'
      }),
      relativePath: 'src',
      label: 'src'
    },
    {
      context: projectSearchContext({
        focusedRelativePath: 'link',
        focusedNodeKind: 'symlink',
        selectedRelativePath: 'docs/readme.md'
      }),
      relativePath: 'docs',
      label: 'docs'
    },
    {
      context: projectSearchContext({
        focusedRelativePath: 'README.md',
        focusedNodeKind: 'file'
      }),
      relativePath: '',
      label: 'overmind'
    },
    {
      context: projectSearchContext(),
      relativePath: '',
      label: 'overmind'
    }
  ]) {
    resetProjectSearch(() => context);
    assert.equal(projectSearchStore.scopeKind, 'directory');
    assert.equal(projectSearchStore.directoryRelativePath, relativePath);
    assert.equal(projectSearchStore.directoryLabel, label);
  }
});

test('scope switching cancels stale work and dispatches the stable captured directory', async () => {
  const context = projectSearchContext({
    focusedRelativePath: 'src/components',
    focusedNodeKind: 'directory'
  });
  const scheduling = resetProjectSearch(() => context);
  const first = deferred();
  searchResponder = () => first.promise;
  projectSearchStore.setQuery('needle');
  const directoryDispatch = projectSearchStore.dispatchLatest();
  const directoryRequest = searchCalls.at(-1);
  assert.deepEqual(directoryRequest.scope, {
    kind: 'directory',
    relativePath: 'src/components'
  });

  projectSearchStore.setScopeKind('project');
  assert.equal(cancelCalls.at(-1).requestId, directoryRequest.requestId);
  assert.equal(scheduling.scheduled(), 2);
  first.resolve(responseFor(directoryRequest, [textResult('src/components/stale.ts')]));
  await directoryDispatch;
  assert.deepEqual(projectSearchStore.results, []);

  searchResponder = async (request) => responseFor(request, [textResult('src/project.ts')]);
  await projectSearchStore.dispatchLatest();
  assert.deepEqual(searchCalls.at(-1).scope, { kind: 'project' });
  assert.equal(searchCalls.at(-1).query, 'needle');

  projectSearchStore.setScopeKind('directory');
  assert.equal(scheduling.scheduled(), 3);
  searchResponder = async (request) => responseFor(request, []);
  await projectSearchStore.dispatchLatest();
  assert.deepEqual(searchCalls.at(-1).scope, {
    kind: 'directory',
    relativePath: 'src/components'
  });
});

test('a watch reload revision rejects old counts and accepts only the newly ready count', () => {
  const gate = new characterCountGate.OnlyPreviewCharacterCountHostGate();
  gate.beginTransition('selection-revision');
  gate.resume('selection-revision');
  gate.acceptReady('selection-revision');
  assert.equal(gate.canAcceptCount(7), true);

  gate.beginTransition('watch-revision');
  gate.resume('watch-revision');
  assert.equal(gate.acceptReady('selection-revision'), false);
  assert.equal(gate.canAcceptCount(7), false);
  assert.equal(gate.acceptReady('watch-revision'), true);
  assert.equal(gate.canAcceptCount(9), true);
});

test('IME start cancels the old request and composition end dispatches the final value once', async () => {
  const context = { workspaceId: 'workspace-search-shell', generation: 7 };
  const scheduling = resetProjectSearch(() => context);
  const first = deferred();
  searchResponder = () => first.promise;

  projectSearchStore.setQuery('alpha');
  const firstDispatch = projectSearchStore.dispatchLatest();
  assert.equal(searchCalls.length, 1);
  const firstRequestId = searchCalls[0].requestId;

  projectSearchStore.beginComposition();
  assert.deepEqual(
    cancelCalls.map((request) => request.requestId),
    [firstRequestId]
  );
  first.resolve(responseFor(searchCalls[0], [textResult('stale.md')]));
  await firstDispatch;
  assert.deepEqual(projectSearchStore.results, []);

  projectSearchStore.endComposition('alpha');
  assert.equal(scheduling.scheduled(), 2);
  searchResponder = async (request) => responseFor(request, [textResult('fresh.md')]);
  await projectSearchStore.dispatchLatest();
  assert.equal(searchCalls.length, 2);
  assert.deepEqual(
    projectSearchStore.results.map((result) => result.relativePath),
    ['fresh.md']
  );
});

test('Project Search scheduler is 120ms leading plus trailing', async () => {
  let dispatchCount = 0;
  const schedule = projectSearchModule.createOnlyPreviewProjectSearchScheduler(() => {
    dispatchCount += 1;
  });
  schedule();
  schedule();
  schedule();
  assert.equal(dispatchCount, 1);
  await new Promise((resolveValue) => setTimeout(resolveValue, 180));
  assert.equal(dispatchCount, 2);
});

test('rapid input cancels prior requests, clears old rows, and renders only the final request', async () => {
  const context = { workspaceId: 'workspace-search-shell', generation: 9 };
  resetProjectSearch(() => context);
  searchResponder = async (request) => responseFor(request, [textResult('first.md')]);
  projectSearchStore.setQuery('first');
  await projectSearchStore.dispatchLatest();
  assert.deepEqual(
    projectSearchStore.results.map((result) => result.relativePath),
    ['first.md']
  );

  const second = deferred();
  projectSearchStore.setQuery('second');
  assert.deepEqual(projectSearchStore.results, []);
  searchResponder = () => second.promise;
  const secondDispatch = projectSearchStore.dispatchLatest();
  const secondRequestId = searchCalls.at(-1).requestId;

  projectSearchStore.setQuery('final');
  assert.equal(cancelCalls.at(-1).requestId, secondRequestId);
  second.resolve(responseFor(searchCalls.at(-1), [textResult('second.md')]));
  await secondDispatch;
  assert.deepEqual(projectSearchStore.results, []);

  searchResponder = async (request) => responseFor(request, [textResult('final.md')]);
  await projectSearchStore.dispatchLatest();
  assert.deepEqual(
    projectSearchStore.results.map((result) => result.relativePath),
    ['final.md']
  );
});

test('host-scoped batches upsert in first-seen order and stale batches are rejected', async () => {
  let context = { workspaceId: 'workspace-search-shell', generation: 12 };
  resetProjectSearch(() => context);
  projectSearchStore.subscribeToBatches();
  const batchListener = rendererSubscriptions.get('onlypreview/search-batch');
  assert.equal(typeof batchListener, 'function');

  const pending = deferred();
  searchResponder = () => pending.promise;
  projectSearchStore.setQuery('needle');
  const dispatch = projectSearchStore.dispatchLatest();
  const request = searchCalls.at(-1);
  const first = textResult('docs/first.md');
  const second = textResult('docs/second.md');
  const enrichedFirst = textResult('docs/first.md', {
    snippetText: 'needle',
    highlightStart: 0,
    highlightLength: 6
  });
  const emitBatch = (hostId, batch, extra = {}) =>
    batchListener({ params: { hostId, batch, ...extra } });

  emitBatch('wrong-host', batchFor(request, [first]));
  emitBatch('host-search-shell', {
    ...batchFor(request, [first]),
    workspaceId: 'stale-workspace'
  });
  emitBatch('host-search-shell', { ...batchFor(request, [first]), generation: 11 });
  emitBatch('host-search-shell', {
    ...batchFor(request, [first]),
    requestId: 'stale-request'
  });
  emitBatch('host-search-shell', batchFor(request, [first]), { unexpected: true });
  emitBatch(
    'host-search-shell',
    batchFor(
      request,
      Array.from({ length: 51 }, (_, index) => textResult(`too-many/${index}.md`))
    )
  );
  emitBatch('host-search-shell', batchFor(request, [textResult('/absolute.md')]));
  emitBatch(
    'host-search-shell',
    batchFor(request, [
      {
        fileName: 'image.png',
        relativePath: 'image.png',
        mediaType: 'image',
        contentMatch: enrichedFirst.contentMatch
      }
    ])
  );
  assert.deepEqual(projectSearchStore.results, []);

  emitBatch('host-search-shell', batchFor(request, [first, second]));
  const aggregateReference = projectSearchStore.results;
  emitBatch('host-search-shell', batchFor(request, [enrichedFirst]));
  assert.deepEqual(
    projectSearchStore.results.map((result) => result.relativePath),
    ['docs/first.md', 'docs/second.md']
  );
  assert.deepEqual(projectSearchStore.results[0].contentMatch, enrichedFirst.contentMatch);

  pending.resolve(responseFor(request, [enrichedFirst, second]));
  await dispatch;
  assert.equal(projectSearchStore.results, aggregateReference);

  context = { workspaceId: 'replacement-workspace', generation: 13 };
  emitBatch('host-search-shell', batchFor(request, [textResult('stale.md')]));
  assert.deepEqual(
    projectSearchStore.results.map((result) => result.relativePath),
    ['docs/first.md', 'docs/second.md']
  );
});

test('query waits for the ready index and stale workspace responses never render', async () => {
  let context = null;
  const scheduling = resetProjectSearch(() => context);
  projectSearchStore.setQuery('needle');
  await projectSearchStore.dispatchLatest();
  assert.equal(searchCalls.length, 0);
  assert.equal(projectSearchStore.pending, true);

  context = { workspaceId: 'workspace-search-shell', generation: 3 };
  projectSearchStore.resumeForReadyIndex();
  assert.equal(scheduling.scheduled(), 1);
  const pending = deferred();
  searchResponder = () => pending.promise;
  const dispatch = projectSearchStore.dispatchLatest();
  assert.equal(searchCalls.length, 1);

  context = { workspaceId: 'replacement-workspace', generation: 4 };
  pending.resolve(responseFor(searchCalls[0], [textResult('stale.md')]));
  await dispatch;
  assert.deepEqual(projectSearchStore.results, []);
});

test('snapshot guard accepts only exact, internally consistent nested snapshots', () => {
  assert.equal(snapshot.isOnlyPreviewSearchSnapshotEvent(searchSnapshotEvent()), true);

  const rootEntry = searchSnapshotEvent();
  rootEntry.snapshot.state = 'building';
  rootEntry.snapshot.index.entries = [
    searchSnapshotEntry({
      relativePath: 'README.md',
      parentRelativePath: '',
      name: 'README.md'
    })
  ];
  for (const key of [
    'processRssBytes',
    'workerHeapUsedBytes',
    'workerExternalBytes',
    'treeMetadataEntryCount',
    'treeMetadataEstimatedBytes',
    'filenameTierEstimatedBytes',
    'diskIndexBytes'
  ]) {
    rootEntry.snapshot.memory[key] = null;
  }
  assert.equal(snapshot.isOnlyPreviewSearchSnapshotEvent(rootEntry), true);

  const directoryEntry = searchSnapshotEvent();
  directoryEntry.snapshot.state = 'reconciling';
  directoryEntry.snapshot.index.entries = [
    searchSnapshotEntry({
      relativePath: 'docs',
      parentRelativePath: '',
      name: 'docs',
      nodeKind: 'directory',
      size: 0,
      previewHint: 'unsupported',
      mediaType: 'unknown',
      isText: false
    })
  ];
  assert.equal(snapshot.isOnlyPreviewSearchSnapshotEvent(directoryEntry), true);

  for (const mutate of [
    (event) => Object.assign(event, { unexpected: true }),
    (event) => Object.assign(event.snapshot, { unexpected: true }),
    (event) => Object.assign(event.snapshot.index, { unexpected: true }),
    (event) => Object.assign(event.snapshot.index.entries[0], { unexpected: true }),
    (event) => Object.assign(event.snapshot.memory, { unexpected: true }),
    (event) => {
      event.snapshot.index.entries.unexpected = true;
    },
    (event) => {
      event.snapshot.index.entries = new Array(1);
    },
    (event) => {
      delete event.snapshot.memory.diskIndexBytes;
    }
  ]) {
    const event = searchSnapshotEvent();
    mutate(event);
    assert.equal(snapshot.isOnlyPreviewSearchSnapshotEvent(event), false);
  }
});

test('snapshot guard rejects hostile identifiers, index metadata, and entry values', () => {
  for (const mutate of [
    (event) => {
      event.hostId = 'short';
    },
    (event) => {
      event.snapshot.workspaceId = 'short';
    },
    (event) => {
      event.snapshot.index.workspaceId = 'different-workspace-id';
    },
    (event) => {
      event.snapshot.generation = -1;
    },
    (event) => {
      event.snapshot.generation = 1.5;
    },
    (event) => {
      event.snapshot.state = 'failed';
    },
    (event) => {
      event.snapshot.index.limit = -1;
    },
    (event) => {
      event.snapshot.index.limit = 0;
    },
    (event) => {
      event.snapshot.index.truncated = 'false';
    },
    (event) => {
      event.snapshot.index.entries[0].nodeKind = 'socket';
    },
    (event) => {
      event.snapshot.index.entries[0].size = -1;
    },
    (event) => {
      event.snapshot.index.entries[0].size = Number.POSITIVE_INFINITY;
    },
    (event) => {
      event.snapshot.index.entries[0].modifiedAt = Number.NaN;
    },
    (event) => {
      event.snapshot.index.entries[0].previewHint = 'html';
    },
    (event) => {
      event.snapshot.index.entries[0].mediaType = 'binary';
    },
    (event) => {
      event.snapshot.index.entries[0].isText = 1;
    },
    (event) => {
      event.snapshot.index.entries[0].mediaType = 'unknown';
    },
    (event) => {
      event.snapshot.index.entries[0].nodeKind = 'directory';
    }
  ]) {
    const event = searchSnapshotEvent();
    mutate(event);
    assert.equal(snapshot.isOnlyPreviewSearchSnapshotEvent(event), false);
  }
});

test('snapshot guard rejects absolute, traversing, unnormalized, and inconsistent paths', () => {
  for (const relativePath of [
    '',
    '/etc/passwd',
    '../secret.md',
    'docs/../secret.md',
    'docs/./secret.md',
    'docs//secret.md',
    'docs\\secret.md',
    'C:/secret.md'
  ]) {
    const event = searchSnapshotEvent();
    event.snapshot.index.entries[0].relativePath = relativePath;
    assert.equal(snapshot.isOnlyPreviewSearchSnapshotEvent(event), false);
  }

  for (const parentRelativePath of ['/docs', '..', 'docs/..', 'docs\\nested']) {
    const event = searchSnapshotEvent();
    event.snapshot.index.entries[0].parentRelativePath = parentRelativePath;
    assert.equal(snapshot.isOnlyPreviewSearchSnapshotEvent(event), false);
  }

  const wrongParent = searchSnapshotEvent();
  wrongParent.snapshot.index.entries[0].parentRelativePath = 'src';
  assert.equal(snapshot.isOnlyPreviewSearchSnapshotEvent(wrongParent), false);

  const wrongName = searchSnapshotEvent();
  wrongName.snapshot.index.entries[0].name = 'other.md';
  assert.equal(snapshot.isOnlyPreviewSearchSnapshotEvent(wrongName), false);
});

test('snapshot guard rejects malformed memory telemetry without coercion', () => {
  const numericKeys = [
    'processRssBytes',
    'workerHeapUsedBytes',
    'workerExternalBytes',
    'treeMetadataEntryCount',
    'treeMetadataEstimatedBytes',
    'filenameTierEstimatedBytes',
    'diskIndexBytes'
  ];
  for (const key of numericKeys) {
    for (const invalidValue of [-1, Number.NaN, Number.POSITIVE_INFINITY, '1']) {
      const event = searchSnapshotEvent();
      event.snapshot.memory[key] = invalidValue;
      assert.equal(snapshot.isOnlyPreviewSearchSnapshotEvent(event), false);
    }
  }

  for (const key of ['measurementComplete', 'runtimeOneGiBWarning', 'runtimeTwoGiBLimitExceeded']) {
    const event = searchSnapshotEvent();
    event.snapshot.memory[key] = 0;
    assert.equal(snapshot.isOnlyPreviewSearchSnapshotEvent(event), false);
  }
});

test('Shell Project Search source preserves exact narrow client, UI, and lifecycle boundaries', () => {
  const clientSource = source('src/renderer/onlypreview/shell/src/onlyPreviewSearch.client.ts');
  const storeSource = source(
    'src/renderer/onlypreview/shell/src/onlyPreviewProjectSearch.store.ts'
  );
  const shellSource = source('src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts');
  const snapshotSource = source(
    'src/renderer/onlypreview/shell/src/onlyPreviewSearchSnapshot.service.ts'
  );
  const batchSource = source(
    'src/renderer/onlypreview/shell/src/onlyPreviewSearchBatch.service.ts'
  );
  const appSource = source('src/renderer/onlypreview/shell/src/App.vue');
  const appStyle = source('src/renderer/onlypreview/shell/src/App.less');
  const i18nSource = source('src/renderer/onlypreview/common/onlyPreviewI18n.ts');
  const resultsSource = source(
    'src/renderer/onlypreview/shell/src/components/ProjectSearchResults/ProjectSearchResults.vue'
  );
  const resultsStyle = source(
    'src/renderer/onlypreview/shell/src/components/ProjectSearchResults/ProjectSearchResults.less'
  );

  assert.match(clientSource, /createXpcRendererEmitter<OnlyPreviewSearchRuntimeApi>/);
  assert.match(clientSource, /'OnlyPreviewSearchRuntimeHandler'/);
  assert.match(storeSource, /useThrottleFn\([\s\S]*?120,[\s\S]*?true,[\s\S]*?true/);
  assert.match(
    storeSource,
    /beginComposition\(\)[\s\S]*?inputGeneration \+= 1;[\s\S]*?cancelActive\(\)/
  );
  assert.match(storeSource, /maxResults: ONLY_PREVIEW_SEARCH_MAX_RESULTS/);
  assert.match(storeSource, /scopeKind: OnlyPreviewSearchScope\['kind'\] = 'directory'/);
  assert.match(storeSource, /scope[\s\S]*?kind: 'directory'[\s\S]*?directoryRelativePath/);
  assert.match(
    storeSource,
    /focusedNodeKind === 'directory'[\s\S]*?focusedNodeKind === 'file'[\s\S]*?selectedRelativePath/
  );
  assert.match(storeSource, /currentContext\?\.workspaceId !== context\.workspaceId/);
  assert.match(storeSource, /currentContext\.generation !== context\.generation/);
  assert.match(storeSource, /this\.activeRequestId !== requestId/);
  assert.match(storeSource, /ONLY_PREVIEW_SEARCH_BATCH_EVENT/);
  assert.match(storeSource, /this\.activeRequestInputGeneration !== this\.inputGeneration/);
  assert.match(storeSource, /this\.resultIndexByPath\.get\(result\.relativePath\)/);
  assert.match(storeSource, /areOnlyPreviewSearchResultsEqual\(this\.results, finalResults\)/);
  assert.match(batchSource, /Object\.keys\(value\)\.sort\(\)/);
  assert.match(batchSource, /ONLY_PREVIEW_SEARCH_MAX_BATCH_RESULTS/);
  assert.match(snapshotSource, /Reflect\.ownKeys\(value\)/);
  assert.match(snapshotSource, /normalizeOnlyPreviewRelativePath/);
  assert.match(snapshotSource, /isOnlyPreviewIndexEntryArray\(value\.index\.entries\)/);
  assert.match(snapshotSource, /MEMORY_NUMBER_KEYS\.every/);
  assert.match(shellSource, /payload\.params\.hostId === onlyPreviewEnv\.hostId/);
  assert.match(shellSource, /snapshot\.workspaceId !== workspace\.workspaceId/);
  assert.match(shellSource, /snapshot\.generation !== this\.searchWorkspaceGeneration/);
  assert.ok(
    shellSource.indexOf('const revision = ++this.searchSnapshotRevision') >
      shellSource.indexOf('snapshot.index.workspaceId !== workspace.workspaceId')
  );
  assert.match(shellSource, /onlyPreviewProjectSearchStore\.suspendForIndex\(\)/);
  assert.match(shellSource, /snapshot\.state !== 'ready' \|\| this\.index !== null/);
  assert.match(shellSource, /onlyPreviewProjectSearchStore\.resumeForReadyIndex\(\)/);
  assert.ok(shellSource.split('\n').length < 800);
  const refreshSettings = shellSource.slice(
    shellSource.indexOf('private async refreshSettings()'),
    shellSource.indexOf('private async activateEntry(')
  );
  assert.doesNotMatch(refreshSettings, /showHiddenFiles|refreshIndex/);
  assert.match(
    shellSource,
    /const isPreviewControlEvent[\s\S]*?Reflect\.ownKeys\(event\)\.length === 3[\s\S]*?event\.action === 'render'[\s\S]*?event\.action === 'reload'[\s\S]*?event\.action === 'clear'/
  );
  const previewControlSubscription = shellSource.slice(
    shellSource.indexOf('xpcRenderer.subscribe(ONLY_PREVIEW_PREVIEW_CONTROL_EVENT'),
    shellSource.indexOf('xpcRenderer.subscribe(ONLY_PREVIEW_CHARACTER_COUNT_SYNC_REQUEST_EVENT')
  );
  assert.match(
    previewControlSubscription,
    /characterCountGate\.beginTransition\(payload\.params\.revision\)/
  );
  assert.match(
    previewControlSubscription,
    /characterCountGate\.resume\(payload\.params\.revision\)/
  );
  assert.match(previewControlSubscription, /selectedCharacterCount = 0/);
  assert.match(previewControlSubscription, /pendingCharacterCount = 0/);
  assert.doesNotMatch(previewControlSubscription, /broadcast|refreshIndex|restoreSelection/);

  assert.match(appSource, /@compositionstart="handleSearchCompositionStart"/);
  assert.match(appSource, /@compositionend="handleSearchCompositionEnd"/);
  assert.match(appSource, /<ProjectSearchResults/);
  assert.match(
    appSource,
    /onlyPreviewProjectSearchStore\.exit\(\)[\s\S]*?searchInputRef\.value\?\.focus/
  );
  assert.match(appSource, /event\.altKey && event\.code === 'Digit1'/);
  const scopeMarkup = appSource.slice(
    appSource.indexOf('name="onlypreview__projectSearchScope"'),
    appSource.indexOf('name="onlypreview__indexError"')
  );
  assert.match(scopeMarkup, /<select/);
  assert.match(scopeMarkup, /name="onlypreview__projectSearchScopeSelect"/);
  assert.match(scopeMarkup, /<option value="directory">/);
  assert.match(scopeMarkup, /<option value="project">/);
  assert.match(scopeMarkup, /name="onlypreview__projectSearchScopeTarget"/);
  assert.doesNotMatch(scopeMarkup, /displayPath|absolutePath/);
  assert.match(appSource, /onlyPreviewProjectSearchStore\.directoryLabel/);
  assert.match(appSource, /onlyPreviewShellStore\.workspace\?\.rootName/);
  assert.match(i18nSource, /projectSearchInDirectory: 'In Directory'/);
  assert.match(i18nSource, /projectSearchInProject: 'In Project'/);
  assert.match(i18nSource, /projectSearchInDirectory: '当前目录'/);
  assert.match(i18nSource, /projectSearchInProject: '整个项目'/);
  assert.doesNotMatch(resultsSource, /v-html/);
  assert.match(resultsSource, /<mark/);
  assert.match(resultsSource, /row\.result\.fileName/);
  assert.match(resultsSource, /row\.result\.relativePath/);
  assert.match(resultsSource, /row\.result\.mediaType/);
  assert.match(
    resultsSource,
    /@contextmenu\.prevent\.stop="[\s\S]*?onlyPreviewShellStore\.showFileContextMenu/
  );
  assert.doesNotMatch(resultsSource, /summary|placeholder/i);

  assert.match(appStyle, /onlypreview-shell__tree::-webkit-scrollbar\s*\{[\s\S]*?width: 8px/);
  assert.match(
    appStyle,
    /\.onlypreview-shell__scope-select \{[\s\S]*?background: var\(--onlypreview-royal-soft\)/
  );
  assert.match(appStyle, /\.onlypreview-shell__scope-select:focus-visible/);
  assert.match(
    resultsStyle,
    /onlypreview-project-search__list::-webkit-scrollbar\s*\{[\s\S]*?width: 8px/
  );
  assert.match(appSource, /name="onlypreview__resizeHandle"/);
});
