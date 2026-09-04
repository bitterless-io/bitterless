/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(new URL(import.meta.url).pathname), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'onlypreview-tree-selection-'));
const bundlePath = join(buildRoot, 'selection.mjs');
const source = (path) => readFileSync(join(projectRoot, path), 'utf8');

await build({
  entryPoints: [
    join(projectRoot, 'src/renderer/onlypreview/shell/src/onlyPreviewTreeSelection.service.ts')
  ],
  outfile: bundlePath,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  tsconfig: join(projectRoot, 'tsconfig.node.json')
});

const { resolveOnlyPreviewSelection, retainOnlyPreviewSelection } = await import(
  pathToFileURL(bundlePath).href
);

after(() => rmSync(buildRoot, { recursive: true, force: true }));

// The flattened visible rows, root row first, exactly as the tree renders them.
const ROWS = ['', 'a', 'a/one.md', 'a/two.md', 'b', 'b/three.md', 'c.md'];

const state = (paths, anchor) => ({ paths, anchor });

test('a plain click selects one row and is the only gesture that previews', () => {
  const result = resolveOnlyPreviewSelection('replace', state(['a', 'b'], 'a'), 'c.md', ROWS);
  assert.deepEqual(result.paths, ['c.md']);
  assert.equal(result.anchor, 'c.md');
  assert.equal(result.previews, true);
});

test('a toggle adds and removes without moving the preview', () => {
  const added = resolveOnlyPreviewSelection('toggle', state(['a'], 'a'), 'c.md', ROWS);
  assert.deepEqual(added.paths, ['a', 'c.md']);
  assert.equal(added.previews, false);
  const removed = resolveOnlyPreviewSelection('toggle', state(['a', 'c.md'], 'a'), 'a', ROWS);
  assert.deepEqual(removed.paths, ['c.md']);
  assert.equal(removed.previews, false);
});

test('toggling the last row off leaves nothing selected', () => {
  const result = resolveOnlyPreviewSelection('toggle', state(['a'], 'a'), 'a', ROWS);
  assert.deepEqual(result.paths, []);
  assert.equal(result.anchor, null);
});

test('a range runs over the visible rows and keeps the anchor', () => {
  const result = resolveOnlyPreviewSelection('extend', state(['a'], 'a'), 'b', ROWS);
  assert.deepEqual(result.paths, ['a', 'a/one.md', 'a/two.md', 'b']);
  assert.equal(result.anchor, 'a', 'the preview stays where it was');
  assert.equal(result.previews, false);
});

test('a range works upward as well as downward', () => {
  const result = resolveOnlyPreviewSelection('extend', state(['b'], 'b'), 'a/one.md', ROWS);
  assert.deepEqual(result.paths, ['a/one.md', 'a/two.md', 'b']);
});

test('a range replaces the selection rather than adding to it', () => {
  const result = resolveOnlyPreviewSelection('extend', state(['a', 'c.md'], 'a'), 'a/two.md', ROWS);
  assert.deepEqual(result.paths, ['a', 'a/one.md', 'a/two.md']);
});

test('the workspace root never joins a multi-selection', () => {
  // It cannot be deleted, and letting it in would turn every plan into "delete the project".
  assert.deepEqual(resolveOnlyPreviewSelection('extend', state(['a'], 'a'), '', ROWS).paths, [
    'a'
  ]);
  assert.deepEqual(resolveOnlyPreviewSelection('all', state([], null), null, ROWS).paths, [
    'a',
    'a/one.md',
    'a/two.md',
    'b',
    'b/three.md',
    'c.md'
  ]);
  // A modifier on the root row selects it alone instead of building a plan that would be refused.
  const toggled = resolveOnlyPreviewSelection('toggle', state(['a'], 'a'), '', ROWS);
  assert.deepEqual(toggled.paths, ['']);
  assert.equal(toggled.previews, false);
});

test('select all keeps the anchor so the preview does not move', () => {
  const result = resolveOnlyPreviewSelection('all', state(['a'], 'a'), null, ROWS);
  assert.equal(result.anchor, 'a');
  assert.equal(result.previews, false);
});

test('a range with no anchor starts at the clicked row', () => {
  const result = resolveOnlyPreviewSelection('extend', state([], null), 'b', ROWS);
  assert.deepEqual(result.paths, ['b']);
});

test('a range against a row that is gone selects only the target', () => {
  const result = resolveOnlyPreviewSelection('extend', state(['gone'], 'gone'), 'b', ROWS);
  assert.deepEqual(result.paths, ['b']);
});

test('rows that disappear drop out of the selection', () => {
  // A selection that outlives its rows would let an action target a path that is not there.
  const next = retainOnlyPreviewSelection(state(['a', 'gone', 'c.md'], 'gone'), ROWS);
  assert.deepEqual(next.paths, ['a', 'c.md']);
  assert.equal(next.anchor, null);
  const unchanged = state(['a'], 'a');
  assert.equal(retainOnlyPreviewSelection(unchanged, ROWS), unchanged, 'no churn when nothing left');
});

test('the tree renders the selection and marks which row the preview came from', () => {
  const app = source('src/renderer/onlypreview/shell/src/App.vue');
  assert.match(app, /aria-multiselectable="true"/);
  assert.match(app, /onlyPreviewTreeSelection\.isSelected\(row\.entry\.relativePath\)/);
  assert.match(app, /'onlypreview-shell__tree-row--anchor':\s*\n?\s*onlyPreviewTreeSelection\.isAnchor/);
  // A modified click must return before the activation that loads a document.
  assert.match(
    app,
    /apply\('extend', entry\.relativePath\);\s*return;[\s\S]*apply\('toggle', entry\.relativePath\);\s*return;[\s\S]*apply\('replace', entry\.relativePath\);\s*onlyPreviewShellStore\.handleTreeClick/
  );
  assert.match(app, /event\.shiftKey \? 'extend' : 'replace'/);
  assert.match(app, /apply\('all', null\)/);
  assert.match(source('src/renderer/onlypreview/shell/src/App.less'), /tree-row--anchor/);
});

test('the context menu carries the selection and the store stays inside its budget', () => {
  const store = source('src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts');
  assert.ok(
    store.split(/\r?\n/).length < 800,
    'the shell store has to stay under its 800-line budget'
  );
  const app = source('src/renderer/onlypreview/shell/src/App.vue');
  assert.match(app, /@contextmenu\.prevent\.stop="showOnlyPreviewTreeContextMenu\(row\.entry\)"/);
  const controller = source('src/renderer/onlypreview/shell/src/onlyPreviewTreeSelection.store.ts');
  // Reading the shell store at construction time would hit its temporal dead zone, because the shell
  // store imports this module back for `withTreeSelection`.
  assert.match(controller, /resolveHost: \(\) => OnlyPreviewTreeSelectionHost/);
  assert.match(controller, /new OnlyPreviewTreeSelectionController\(\(\) => onlyPreviewShellStore\)/);
  // A symlink is never a delete target.
  assert.match(controller, /nodeKind !== 'file' && nodeKind !== 'directory'/);
  assert.match(controller, /selection: onlyPreviewTreeSelection\.entries\(\)/);
  // The root row keeps the store's own menu; it has no selection to carry.
  assert.match(controller, /entry\.relativePath === ''[\s\S]*onlyPreviewShellStore\.showFileContextMenu/);
});
