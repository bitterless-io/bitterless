/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  countEntries,
  countTreeRows,
  filterSubmoduleTree,
  searchTokens
} from '../../src/renderer/submodules/src/services/submoduleTree.service.ts';
import { submoduleDisplayName } from '../../src/shared/submodules/submodules.type.ts';

const entry = (path, children = []) => ({
  name: path,
  path,
  absolutePath: `/root/${path}`,
  url: null,
  configuredBranch: 'main',
  branch: 'main',
  commit: 'abc1234',
  state: 'ok',
  errorCode: null,
  changedAt: null,
  children
});

const governance = entry('projects/micromeet-knowledge-governance', [
  entry('projects/gov-exec'),
  entry('projects/feishu-bot')
]);
const plain = entry('projects/bitterless');
const tree = [governance, plain];

const shown = (rows) => rows.map((row) => [row.entry.path, row.children.map((c) => c.path)]);

test('with no query a parent shows no children until it is expanded', () => {
  const collapsed = filterSubmoduleTree(tree, { query: '', expandedPaths: new Set() });
  assert.deepEqual(shown(collapsed), [
    ['projects/micromeet-knowledge-governance', []],
    ['projects/bitterless', []]
  ]);
  assert.deepEqual(
    collapsed.map((row) => [row.expandable, row.expanded]),
    [
      [true, false],
      [false, false]
    ]
  );

  const expanded = filterSubmoduleTree(tree, {
    query: '',
    expandedPaths: new Set([governance.absolutePath])
  });
  assert.deepEqual(shown(expanded), [
    ['projects/micromeet-knowledge-governance', ['projects/gov-exec', 'projects/feishu-bot']],
    ['projects/bitterless', []]
  ]);
  assert.equal(expanded[0].expanded, true);
});

test('a matching child brings its parent along and is shown even while collapsed', () => {
  const rows = filterSubmoduleTree(tree, { query: 'feishu', expandedPaths: new Set() });

  assert.deepEqual(shown(rows), [
    ['projects/micromeet-knowledge-governance', ['projects/feishu-bot']]
  ]);
  // Hiding a hit behind a chevron would make the search look broken.
  assert.equal(rows[0].expanded, true);
  assert.equal(rows[0].expandable, true);
});

test('a matching parent shows its whole subtree, collapsed state included', () => {
  const rows = filterSubmoduleTree(tree, { query: 'governance', expandedPaths: new Set() });
  assert.deepEqual(shown(rows), [
    ['projects/micromeet-knowledge-governance', ['projects/gov-exec', 'projects/feishu-bot']]
  ]);
});

test('a parent with no match anywhere in its subtree disappears', () => {
  const rows = filterSubmoduleTree(tree, { query: 'bitterless', expandedPaths: new Set() });
  assert.deepEqual(shown(rows), [['projects/bitterless', []]]);

  assert.deepEqual(
    filterSubmoduleTree(tree, { query: 'nothing-here', expandedPaths: new Set() }),
    []
  );
});

test('matching ignores case and takes several tokens, on either level', () => {
  // Each of these matches the child only: the parent has no `exec` token, so it comes along as
  // context. A bare `gov` would also match `…-governance` and is covered by the parent-match test.
  for (const query of ['EXEC', 'gov exec', 'GOV-EXEC', 'exec gov', '  gov   exec  ']) {
    const rows = filterSubmoduleTree(tree, { query, expandedPaths: new Set() });
    assert.deepEqual(
      shown(rows),
      [['projects/micromeet-knowledge-governance', ['projects/gov-exec']]],
      `query ${JSON.stringify(query)} must reach the nested row`
    );
  }
  assert.deepEqual(searchTokens('  Gov-Exec/x '), ['gov', 'exec', 'x']);
  assert.deepEqual(searchTokens('   '), []);
});

test('counts cover both levels: rendered rows and the whole inventory', () => {
  assert.equal(countEntries(tree), 4);

  const collapsed = filterSubmoduleTree(tree, { query: '', expandedPaths: new Set() });
  assert.equal(countTreeRows(collapsed), 2);

  const expanded = filterSubmoduleTree(tree, {
    query: '',
    expandedPaths: new Set([governance.absolutePath])
  });
  assert.equal(countTreeRows(expanded), 4);

  const searched = filterSubmoduleTree(tree, { query: 'feishu', expandedPaths: new Set() });
  assert.equal(countTreeRows(searched), 2);
});

test('the local label mirror agrees with the shared display name', () => {
  // The service inlines the leaf derivation to stay runtime-dependency-free; a row must still be
  // findable by exactly the text the row renders.
  for (const candidate of [
    entry('projects/nested/deep-leaf'),
    { ...entry('x'), path: '', name: 'section-only' }
  ]) {
    const label = submoduleDisplayName(candidate);
    const rows = filterSubmoduleTree([candidate], { query: label, expandedPaths: new Set() });
    assert.equal(rows.length, 1, `${label} must match its own display name`);
  }
});

test('an expanded path that no longer exists is simply ignored', () => {
  const rows = filterSubmoduleTree(tree, {
    query: '',
    expandedPaths: new Set(['/root/projects/removed'])
  });
  assert.deepEqual(shown(rows), [
    ['projects/micromeet-knowledge-governance', []],
    ['projects/bitterless', []]
  ]);
});
