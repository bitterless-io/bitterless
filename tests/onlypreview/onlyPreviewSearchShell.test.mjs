import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  browseListing,
  characterCountGate,
  result,
  source,
  tree
} from './onlyPreviewSearchShellTest.helper.mjs';

const entry = (values) => ({
  size: 0,
  modifiedAt: 1,
  previewHint: values.nodeKind === 'file' ? 'text' : 'unsupported',
  mediaType: values.nodeKind === 'file' ? 'text' : 'unknown',
  isText: values.nodeKind === 'file',
  ...values
});

test('Project tree begins with the expanded synthetic workspace root without a local filter', () => {
  const index = {
    workspaceId: 'workspace-search-shell',
    truncated: false,
    limit: 4,
    entries: [
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
      })
    ]
  };
  const rows = tree.buildOnlyPreviewRootedTreeRows(
    index,
    'bitterless',
    new Set(['', 'docs']),
    new Set(['docs', 'docs/guide.md'])
  );

  assert.deepEqual(
    rows.map((row) => [row.entry.relativePath, row.depth, row.expanded, row.searchExcluded]),
    [
      ['', 0, true, false],
      ['README.md', 1, false, false],
      ['docs', 1, true, true],
      ['docs/guide.md', 2, false, true]
    ]
  );
  assert.equal(rows[0].entry.name, 'bitterless');
  assert.deepEqual(tree.moveOnlyPreviewTreeFocus(rows, 'README.md', 'ArrowUp'), {
    relativePath: ''
  });
  assert.deepEqual(tree.moveOnlyPreviewTreeFocus(rows, '', 'ArrowRight'), {
    relativePath: 'README.md'
  });
  assert.equal(tree.resolveOnlyPreviewCurrentDirectory(index, 'docs', 'README.md'), 'docs');
  assert.equal(
    tree.resolveOnlyPreviewCurrentDirectory(index, 'docs/guide.md', 'README.md'),
    'docs'
  );
  assert.equal(tree.resolveOnlyPreviewCurrentDirectory(index, null, 'README.md'), '');
  assert.equal(tree.resolveOnlyPreviewCurrentDirectory(index, '', 'docs/guide.md'), '');
  assert.equal(tree.resolveOnlyPreviewTreeFocusPath(rows, 'README.md', 'docs'), 'README.md');
  assert.equal(tree.resolveOnlyPreviewTreeFocusPath(rows, 'missing', 'docs'), 'docs');

  const treeSource = source('src/renderer/onlypreview/shell/src/onlyPreviewTree.service.ts');
  assert.doesNotMatch(treeSource, /OnlyPreviewTreeFilter|searchQuery|revealRoots/);
});

test('Renderer browse-listing validation requires the exact exclusion marker contract', () => {
  const browseEntry = {
    ...entry({
      relativePath: 'excluded',
      parentRelativePath: '',
      name: 'excluded',
      nodeKind: 'directory'
    }),
    directoryToken: 'directory-capability',
    searchExcluded: true
  };
  const listing = {
    workspaceId: 'workspace-search-shell',
    generation: 1,
    directoryToken: 'root-capability',
    relativePath: '',
    entries: [browseEntry]
  };
  assert.equal(browseListing.isOnlyPreviewBrowseListing(listing), true);
  const missingMarker = { ...browseEntry };
  delete missingMarker.searchExcluded;
  for (const invalidEntry of [
    missingMarker,
    { ...browseEntry, searchExcluded: 'true' },
    { ...browseEntry, unexpected: true },
    {
      ...browseEntry,
      nodeKind: 'symlink',
      directoryToken: null,
      searchExcluded: true
    }
  ]) {
    assert.equal(
      browseListing.isOnlyPreviewBrowseListing({ ...listing, entries: [invalidEntry] }),
      false
    );
  }
});

test('Global Search content snippets preserve grapheme offsets', () => {
  const match = {
    snippetText: 'A👨‍👩‍👧‍👦e\u0301中Z',
    highlightStart: 1,
    highlightLength: 2
  };
  assert.deepEqual(result.splitOnlyPreviewContentMatch(match), {
    before: 'A',
    highlight: '👨‍👩‍👧‍👦e\u0301',
    after: '中Z'
  });
});

test('same-path terminal replacement remains distinct from exact result-token identity', () => {
  const early = {
    section: 'files',
    resultToken: 'early-token',
    relativePath: 'docs/guide.md'
  };
  const terminal = { ...early, resultToken: 'terminal-token' };
  assert.equal(result.sameGlobalSearchPath(early, terminal), true);
  assert.equal(result.sameGlobalSearchResult(early, terminal), false);
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

test('a deleted selection is inherited by the next, previous, ancestor, then root row', () => {
  const index = {
    workspaceId: 'workspace-deleted-selection',
    truncated: false,
    limit: 5,
    entries: [
      entry({
        relativePath: 'README.md',
        parentRelativePath: '',
        name: 'README.md',
        nodeKind: 'file'
      }),
      entry({ relativePath: 'docs', parentRelativePath: '', name: 'docs', nodeKind: 'directory' }),
      entry({
        relativePath: 'docs/a.md',
        parentRelativePath: 'docs',
        name: 'a.md',
        nodeKind: 'file'
      }),
      entry({
        relativePath: 'docs/b.md',
        parentRelativePath: 'docs',
        name: 'b.md',
        nodeKind: 'file'
      }),
      entry({ relativePath: 'src', parentRelativePath: '', name: 'src', nodeKind: 'directory' })
    ]
  };
  const rows = tree.buildOnlyPreviewRootedTreeRows(index, 'bitterless', new Set(['', 'docs']));
  assert.deepEqual(
    rows.map((row) => row.entry.relativePath),
    ['', 'README.md', 'docs', 'docs/a.md', 'docs/b.md', 'src']
  );
  const survivorsWithout = (...removed) => {
    const gone = new Set(removed);
    const paths = new Set(
      index.entries
        .map(({ relativePath }) => relativePath)
        .filter(
          (relativePath) =>
            ![...gone].some(
              (path) => relativePath === path || relativePath.startsWith(`${path}/`)
            )
        )
    );
    return (candidate) => paths.has(candidate);
  };

  assert.equal(
    tree.resolveOnlyPreviewDeletedSelection(rows, 'docs/a.md', survivorsWithout('docs/a.md')),
    'docs/b.md'
  );
  assert.equal(
    tree.resolveOnlyPreviewDeletedSelection(rows, 'docs/b.md', survivorsWithout('docs/b.md')),
    'src'
  );
  assert.equal(
    tree.resolveOnlyPreviewDeletedSelection(rows, 'docs', survivorsWithout('docs')),
    'src'
  );
  assert.equal(
    tree.resolveOnlyPreviewDeletedSelection(rows, 'src', survivorsWithout('src')),
    'docs/b.md'
  );
  assert.equal(
    tree.resolveOnlyPreviewDeletedSelection(
      rows,
      'docs/b.md',
      survivorsWithout('README.md', 'docs/b.md', 'src')
    ),
    'docs/a.md'
  );
  assert.equal(
    tree.resolveOnlyPreviewDeletedSelection(
      rows,
      'docs/b.md',
      survivorsWithout('README.md', 'docs', 'src')
    ),
    ''
  );
});
