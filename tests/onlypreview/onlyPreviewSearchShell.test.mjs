import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
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
  const rows = tree.buildOnlyPreviewRootedTreeRows(index, 'bitterless', new Set(['', 'docs']));

  assert.deepEqual(
    rows.map((row) => [row.entry.relativePath, row.depth, row.expanded]),
    [
      ['', 0, true],
      ['README.md', 1, false],
      ['docs', 1, true],
      ['docs/guide.md', 2, false]
    ]
  );
  assert.equal(rows[0].entry.name, 'bitterless');
  assert.deepEqual(tree.moveOnlyPreviewTreeFocus(rows, 'README.md', 'ArrowUp'), {
    relativePath: ''
  });
  assert.deepEqual(tree.moveOnlyPreviewTreeFocus(rows, '', 'ArrowRight'), {
    relativePath: 'README.md'
  });

  const treeSource = source('src/renderer/onlypreview/shell/src/onlyPreviewTree.service.ts');
  assert.doesNotMatch(treeSource, /OnlyPreviewTreeFilter|searchQuery|revealRoots/);
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
