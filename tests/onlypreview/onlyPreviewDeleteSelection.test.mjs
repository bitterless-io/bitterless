/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(new URL(import.meta.url).pathname), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-onlypreview-delete-selection-'));
const bundlePath = join(buildRoot, 'deleteSelection.mjs');

await build({
  entryPoints: [join(projectRoot, 'src/shared/onlypreview/onlyPreviewDeleteSelection.shared.ts')],
  outfile: bundlePath,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  tsconfig: join(projectRoot, 'tsconfig.node.json')
});

const { collapseOnlyPreviewDeleteSelection, isOnlyPreviewPathRemoved } = await import(
  pathToFileURL(bundlePath).href
);

after(() => rmSync(buildRoot, { recursive: true, force: true }));

const dir = (relativePath) => ({ relativePath, nodeKind: 'directory' });
const file = (relativePath) => ({ relativePath, nodeKind: 'file' });
const paths = (plan) => plan.entries.map((entry) => entry.relativePath);

test('the owner example collapses to the two highest entries', () => {
  const plan = collapseOnlyPreviewDeleteSelection([dir('a1/b1/c1'), dir('a1/b1'), dir('a2')]);
  assert.equal(plan.ok, true);
  assert.deepEqual(paths(plan), ['a1/b1', 'a2']);
  assert.equal(plan.selectedCount, 3);
});

test('a file inside a selected folder is dropped', () => {
  const plan = collapseOnlyPreviewDeleteSelection([
    dir('a'),
    file('a/one.txt'),
    file('a/deep/two.txt'),
    file('b/three.txt')
  ]);
  assert.deepEqual(paths(plan), ['a', 'b/three.txt']);
});

test('containment is tested per segment, not per character', () => {
  // `a1/b10` is a sibling of `a1/b1`, not a child. A raw startsWith would delete it by accident.
  const plan = collapseOnlyPreviewDeleteSelection([dir('a1/b1'), dir('a1/b10'), file('a1/b1x')]);
  assert.deepEqual(paths(plan), ['a1/b1', 'a1/b10', 'a1/b1x']);
});

test('a file never swallows a path that merely starts with it', () => {
  // Not reachable on a real filesystem, but a stale row can carry the wrong kind, and a file acting
  // as an ancestor would silently drop a real entry from the plan.
  const plan = collapseOnlyPreviewDeleteSelection([file('a/b'), file('a/b/c')]);
  assert.deepEqual(paths(plan), ['a/b', 'a/b/c']);
});

test('the caller order and the first occurrence of a repeat survive', () => {
  const plan = collapseOnlyPreviewDeleteSelection([
    file('z/last.txt'),
    dir('m'),
    file('z/last.txt'),
    file('a/first.txt')
  ]);
  assert.deepEqual(paths(plan), ['z/last.txt', 'm', 'a/first.txt']);
  assert.equal(plan.selectedCount, 3);
});

test('a nested chain collapses to its root in one pass', () => {
  const plan = collapseOnlyPreviewDeleteSelection([
    dir('a/b/c/d'),
    dir('a/b/c'),
    dir('a/b'),
    dir('a')
  ]);
  assert.deepEqual(paths(plan), ['a']);
  assert.equal(plan.selectedCount, 4);
});

test('the workspace root is refused instead of collapsing to the whole project', () => {
  assert.deepEqual(collapseOnlyPreviewDeleteSelection([dir(''), file('a.txt')]), {
    ok: false,
    reason: 'root-selected'
  });
});

test('an empty selection is refused', () => {
  assert.deepEqual(collapseOnlyPreviewDeleteSelection([]), { ok: false, reason: 'empty' });
});

test('every unusable path shape is refused rather than normalized', () => {
  const unusable = ['/a', 'a/', 'a//b', './a', 'a/./b', 'a/../b', '..', 'a\\b'];
  for (const relativePath of unusable) {
    assert.deepEqual(
      collapseOnlyPreviewDeleteSelection([file(relativePath)]),
      { ok: false, reason: 'invalid-path' },
      `${JSON.stringify(relativePath)} must be refused`
    );
  }
  assert.deepEqual(collapseOnlyPreviewDeleteSelection([{ relativePath: 'a', nodeKind: 'link' }]), {
    ok: false,
    reason: 'invalid-path'
  });
});

test('a removed folder takes its whole subtree with it, by segment and not by prefix', () => {
  const removed = ['a1/b1', 'a2'];
  assert.equal(isOnlyPreviewPathRemoved(removed, 'a1/b1'), true, 'the folder itself');
  assert.equal(isOnlyPreviewPathRemoved(removed, 'a1/b1/c1'), true, 'a child');
  assert.equal(isOnlyPreviewPathRemoved(removed, 'a1/b1/c1/d.txt'), true, 'a deep descendant');
  assert.equal(isOnlyPreviewPathRemoved(removed, 'a2'), true);
  // The whole point of walking segments: a string prefix is not containment, so a sibling whose
  // name merely starts with a removed one must survive.
  assert.equal(isOnlyPreviewPathRemoved(removed, 'a1/b10'), false);
  assert.equal(isOnlyPreviewPathRemoved(removed, 'a1/b10/c.txt'), false);
  assert.equal(isOnlyPreviewPathRemoved(removed, 'a1'), false, 'the parent stays');
  assert.equal(isOnlyPreviewPathRemoved(removed, 'a20'), false);
});

test('the removal test refuses the root and an empty run rather than matching everything', () => {
  // `''` is the workspace root. Reading it as "removed" would clear the tree selection on every
  // delete, and reading an empty run as a match would clear it when nothing was deleted at all.
  assert.equal(isOnlyPreviewPathRemoved(['a1'], ''), false);
  assert.equal(isOnlyPreviewPathRemoved([], 'a1'), false);
  assert.equal(isOnlyPreviewPathRemoved([''], 'a1'), false);
  assert.equal(isOnlyPreviewPathRemoved(['a1'], undefined), false);
});
