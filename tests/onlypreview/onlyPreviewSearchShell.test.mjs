/* eslint-disable @typescript-eslint/explicit-function-return-type */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  batchFor,
  cancelCalls,
  characterCountGate,
  deferred,
  highlight,
  projectSearchContext,
  projectSearchModule,
  projectSearchStore,
  rendererSubscriptions,
  resetProjectSearch,
  responseFor,
  searchCalls,
  searchResponderState,
  source,
  textResult,
  tree
} from './onlyPreviewSearchShellTest.helper.mjs';

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

test('ordinary filter reveal roots are query-scoped, lazy, nested, and segment-safe', () => {
  const entry = (relativePath, parentRelativePath, nodeKind) => ({
    relativePath,
    parentRelativePath,
    name: relativePath.split('/').at(-1),
    nodeKind,
    size: nodeKind === 'file' ? 1 : 0,
    modifiedAt: 1,
    previewHint: nodeKind === 'file' ? 'text' : 'unsupported',
    mediaType: nodeKind === 'file' ? 'text' : 'unknown',
    isText: nodeKind === 'file'
  });
  const index = {
    workspaceId: 'workspace-directory-reveal',
    truncated: false,
    limit: 7,
    entries: [
      entry('docs', '', 'directory'),
      entry('docs/other.txt', 'docs', 'file'),
      entry('docs/nested', 'docs', 'directory'),
      entry('docs/nested/deep.txt', 'docs/nested', 'file'),
      entry('docs-a', '', 'directory'),
      entry('docs-a/other.txt', 'docs-a', 'file')
    ]
  };
  const filter = new tree.OnlyPreviewTreeFilter();
  const expandedPaths = new Set(['docs', 'docs-a']);
  filter.transition(index, expandedPaths, '', 'docs');

  assert.deepEqual(
    filter.rows(index, 'docs', expandedPaths).map((row) => row.entry.relativePath),
    ['docs', 'docs-a']
  );
  assert.equal(filter.toggleDirectory('docs', 'docs', expandedPaths), true);
  assert.deepEqual(
    filter.rows(index, 'docs', expandedPaths).map((row) => row.entry.relativePath),
    ['docs', 'docs/other.txt', 'docs/nested', 'docs-a']
  );
  assert.equal(filter.toggleDirectory('docs', 'docs/nested', expandedPaths), true);
  assert.deepEqual(
    filter.rows(index, 'docs', expandedPaths).map((row) => row.entry.relativePath),
    ['docs', 'docs/other.txt', 'docs/nested', 'docs/nested/deep.txt', 'docs-a']
  );

  assert.equal(filter.toggleDirectory('docs', 'docs', expandedPaths), false);
  assert.equal(filter.toggleDirectory('docs', 'docs', expandedPaths), true);
  assert.equal(
    filter.toggleDirectory('docs', 'docs/nested', expandedPaths),
    true,
    'collapsing a reveal root must remove its nested reveal markers'
  );
  filter.transition(index, expandedPaths, 'docs', 'docs ');
  assert.deepEqual(
    filter.rows(index, 'docs ', expandedPaths).map((row) => row.entry.relativePath),
    ['docs', 'docs-a'],
    'an exact raw query change must clear reveal markers before normalized row recomputation'
  );
  filter.transition(index, expandedPaths, 'docs ', 'docs-a');
  assert.deepEqual(
    filter.rows(index, 'docs-a', expandedPaths).map((row) => row.entry.relativePath),
    ['docs-a']
  );
  filter.transition(index, expandedPaths, 'docs-a', '');
  assert.deepEqual(expandedPaths, new Set(['docs', 'docs-a']));

  filter.transition(index, expandedPaths, '', 'docs');
  assert.equal(filter.toggleDirectory('docs', 'docs', expandedPaths), true);
  const replacement = { ...index, workspaceId: 'workspace-directory-replacement' };
  assert.deepEqual(
    filter.rows(replacement, 'docs', expandedPaths).map((row) => row.entry.relativePath),
    ['docs', 'docs-a'],
    'capturing a replacement workspace must clear the prior workspace reveal roots'
  );
  filter.end(expandedPaths);

  assert.equal(tree.hasOnlyPreviewRevealAncestor('docs/child.txt', new Set(['docs'])), true);
  assert.equal(tree.hasOnlyPreviewRevealAncestor('docs/nested/child.txt', new Set(['docs'])), true);
  assert.equal(tree.hasOnlyPreviewRevealAncestor('docs-a/child.txt', new Set(['docs'])), false);
  const treeSource = source('src/renderer/onlypreview/shell/src/onlyPreviewTree.service.ts');
  const ancestorBody = treeSource.slice(
    treeSource.indexOf('const hasOnlyPreviewRevealAncestor'),
    treeSource.indexOf('export const buildOnlyPreviewTreeRows')
  );
  assert.match(ancestorBody, /while \(current\)[\s\S]*revealRoots\.has\(current\)/);
  assert.doesNotMatch(ancestorBody, /startsWith|for \(|\.some\(/);
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
  searchResponderState.current = () => first.promise;
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

  searchResponderState.current = async (request) =>
    responseFor(request, [textResult('src/project.ts')]);
  await projectSearchStore.dispatchLatest();
  assert.deepEqual(searchCalls.at(-1).scope, { kind: 'project' });
  assert.equal(searchCalls.at(-1).query, 'needle');

  projectSearchStore.setScopeKind('directory');
  assert.equal(scheduling.scheduled(), 3);
  searchResponderState.current = async (request) => responseFor(request, []);
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
  searchResponderState.current = () => first.promise;

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
  searchResponderState.current = async (request) => responseFor(request, [textResult('fresh.md')]);
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
  searchResponderState.current = async (request) => responseFor(request, [textResult('first.md')]);
  projectSearchStore.setQuery('first');
  await projectSearchStore.dispatchLatest();
  assert.deepEqual(
    projectSearchStore.results.map((result) => result.relativePath),
    ['first.md']
  );

  const second = deferred();
  projectSearchStore.setQuery('second');
  assert.deepEqual(projectSearchStore.results, []);
  searchResponderState.current = () => second.promise;
  const secondDispatch = projectSearchStore.dispatchLatest();
  const secondRequestId = searchCalls.at(-1).requestId;

  projectSearchStore.setQuery('final');
  assert.equal(cancelCalls.at(-1).requestId, secondRequestId);
  second.resolve(responseFor(searchCalls.at(-1), [textResult('second.md')]));
  await secondDispatch;
  assert.deepEqual(projectSearchStore.results, []);

  searchResponderState.current = async (request) => responseFor(request, [textResult('final.md')]);
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
  searchResponderState.current = () => pending.promise;
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

test('query waits for an available browse runtime and stale workspace responses never render', async () => {
  let context = null;
  const scheduling = resetProjectSearch(() => context);
  projectSearchStore.setQuery('needle');
  await projectSearchStore.dispatchLatest();
  assert.equal(searchCalls.length, 0);
  assert.equal(projectSearchStore.pending, true);

  context = { workspaceId: 'workspace-search-shell', generation: 3 };
  projectSearchStore.resumeForAvailableRuntime();
  assert.equal(scheduling.scheduled(), 1);
  const pending = deferred();
  searchResponderState.current = () => pending.promise;
  const dispatch = projectSearchStore.dispatchLatest();
  assert.equal(searchCalls.length, 1);

  context = { workspaceId: 'replacement-workspace', generation: 4 };
  pending.resolve(responseFor(searchCalls[0], [textResult('stale.md')]));
  await dispatch;
  assert.deepEqual(projectSearchStore.results, []);
});

test('completed directory query stays settled across later root and ready resumes', async () => {
  const context = projectSearchContext({
    focusedRelativePath: 'nested',
    focusedNodeKind: 'directory'
  });
  const scheduling = resetProjectSearch(() => context);
  const accepted = textResult('nested/accepted.md');
  searchResponderState.current = async (request) => responseFor(request, [accepted]);

  projectSearchStore.setQuery('needle');
  await projectSearchStore.dispatchLatest();
  assert.equal(searchCalls.length, 1);
  assert.deepEqual(searchCalls[0].scope, { kind: 'directory', relativePath: 'nested' });
  assert.equal(projectSearchStore.pending, false);
  assert.deepEqual(projectSearchStore.results, [accepted]);

  const scheduledBeforeResume = scheduling.scheduled();
  projectSearchStore.resumeForAvailableRuntime();
  projectSearchStore.resumeForAvailableRuntime();
  assert.equal(scheduling.scheduled(), scheduledBeforeResume);
  assert.equal(searchCalls.length, 1);
  assert.equal(projectSearchStore.pending, false);
  assert.deepEqual(projectSearchStore.results, [accepted]);

  projectSearchStore.subscribeToBatches();
  const watchCommitListener = rendererSubscriptions.get('onlypreview/search-watch-commit');
  assert.equal(typeof watchCommitListener, 'function');
  const emitWatchCommit = (hostId, commit, extra = {}) =>
    watchCommitListener({ params: { hostId, commit, ...extra } });
  const commit = {
    workspaceId: context.workspaceId,
    generation: context.generation,
    revision: 1,
    full: false,
    changedRelativePaths: ['nested/accepted.md']
  };
  emitWatchCommit('wrong-host', commit);
  emitWatchCommit('host-search-shell', { ...commit, workspaceId: 'stale-workspace' });
  emitWatchCommit('host-search-shell', { ...commit, generation: context.generation + 1 });
  emitWatchCommit('host-search-shell', {
    ...commit,
    changedRelativePaths: ['outside/ignored.md']
  });
  emitWatchCommit('host-search-shell', {
    ...commit,
    changedRelativePaths: ['nested/accepted.md', 'nested/accepted.md']
  });
  emitWatchCommit('host-search-shell', commit, { unexpected: true });
  assert.equal(scheduling.scheduled(), scheduledBeforeResume);
  assert.equal(projectSearchStore.pending, false);
  assert.deepEqual(projectSearchStore.results, [accepted]);

  emitWatchCommit('host-search-shell', commit);
  assert.equal(scheduling.scheduled(), scheduledBeforeResume + 1);
  assert.equal(projectSearchStore.pending, true);
  assert.deepEqual(projectSearchStore.results, [accepted]);

  const refreshed = textResult('nested/refreshed.md');
  searchResponderState.current = async (request) => responseFor(request, [refreshed]);
  await projectSearchStore.dispatchLatest();
  assert.equal(searchCalls.length, 2);
  assert.equal(projectSearchStore.pending, false);
  assert.deepEqual(projectSearchStore.results, [refreshed]);
});

test('a committed watch revision retries an accepted query after its initial search failed', async () => {
  const context = projectSearchContext({
    focusedRelativePath: 'nested',
    focusedNodeKind: 'directory'
  });
  const scheduling = resetProjectSearch(() => context);
  projectSearchStore.subscribeToBatches();
  const watchCommitListener = rendererSubscriptions.get('onlypreview/search-watch-commit');
  assert.equal(typeof watchCommitListener, 'function');
  searchResponderState.current = async () => ({
    ok: false,
    error: { code: 'OPERATION_FAILED', message: 'initial search unavailable' }
  });

  projectSearchStore.setQuery('created');
  await projectSearchStore.dispatchLatest();
  assert.equal(projectSearchStore.pending, false);
  assert.equal(projectSearchStore.error, 'OnlyPreview could not complete this action.');
  assert.deepEqual(projectSearchStore.results, []);

  const scheduledBeforeCommit = scheduling.scheduled();
  watchCommitListener({
    params: {
      hostId: 'host-search-shell',
      commit: {
        workspaceId: context.workspaceId,
        generation: context.generation,
        revision: 1,
        full: false,
        changedRelativePaths: ['nested/watch-created.txt']
      }
    }
  });
  assert.equal(scheduling.scheduled(), scheduledBeforeCommit + 1);
  assert.equal(projectSearchStore.pending, true);
  assert.equal(projectSearchStore.error, '');

  const created = textResult('nested/watch-created.txt');
  searchResponderState.current = async (request) => responseFor(request, [created]);
  await projectSearchStore.dispatchLatest();
  assert.equal(projectSearchStore.pending, false);
  assert.equal(projectSearchStore.error, '');
  assert.deepEqual(projectSearchStore.results, [created]);
});
