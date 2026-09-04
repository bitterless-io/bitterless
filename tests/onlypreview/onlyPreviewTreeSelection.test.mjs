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
  // The anchor stays where the click was: it is the last row the owner clicked, and a Shift click
  // after this should still range from there.
  assert.equal(result.anchor, 'a');
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
  // A modified click must return before the activation that loads a document.
  assert.match(
    app,
    /apply\('extend', entry\.relativePath\);\s*return;[\s\S]*apply\('toggle', entry\.relativePath\);\s*return;[\s\S]*apply\('replace', entry\.relativePath\);\s*onlyPreviewShellStore\.handleTreeClick/
  );
  assert.match(app, /event\.shiftKey \? 'extend' : 'replace'/);
  assert.match(app, /apply\('all', null\)/);
  assert.doesNotMatch(app, /tree-row--previewed/);
  assert.doesNotMatch(
    source('src/renderer/onlypreview/shell/src/App.less'),
    /tree-row--previewed/
  );
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

test('a Shift range runs from the last clicked row and re-aims instead of walking', () => {
  // Owner rule: 「shift 就是 选中和最后一次选中文件之间的可见文件」. Cmd-click 2 then 6, Shift on 1 gives
  // 1-6; Shift on 3 after that gives 3-6, because the Shift click does not move the anchor.
  const rows = ['1', '2', '3', '4', '5', '6'];
  const afterTwo = resolveOnlyPreviewSelection('toggle', state([], null), '2', rows);
  const afterSix = resolveOnlyPreviewSelection('toggle', afterTwo, '6', rows);
  assert.deepEqual(afterSix.paths, ['2', '6']);
  assert.equal(afterSix.anchor, '6', 'a Cmd click is the last selected row');

  const toOne = resolveOnlyPreviewSelection('extend', afterSix, '1', rows);
  assert.deepEqual(toOne.paths, ['1', '2', '3', '4', '5', '6']);
  assert.equal(toOne.anchor, '6');

  const toThree = resolveOnlyPreviewSelection('extend', toOne, '3', rows);
  assert.deepEqual(toThree.paths, ['3', '4', '5', '6']);
  assert.equal(toThree.anchor, '6');
});

test('a Cmd click that empties the selection still leaves the anchor where it clicked', () => {
  const rows = ['1', '2', '3'];
  const emptied = resolveOnlyPreviewSelection('toggle', state(['2'], '2'), '2', rows);
  assert.deepEqual(emptied.paths, []);
  assert.equal(emptied.anchor, '2');
  assert.deepEqual(resolveOnlyPreviewSelection('extend', emptied, '3', rows).paths, ['2', '3']);
});

test('the range follows the tree as folders open and close', () => {
  // The one-dimensional order is the flattened visible rows, so expanding a folder puts its children
  // into the next range without any state to keep in step.
  const collapsed = ['1', '2', '5'];
  const expanded = ['1', '2', '2/a', '2/b', '5'];
  const anchored = state(['1'], '1');
  assert.deepEqual(resolveOnlyPreviewSelection('extend', anchored, '5', collapsed).paths, [
    '1',
    '2',
    '5'
  ]);
  assert.deepEqual(resolveOnlyPreviewSelection('extend', anchored, '5', expanded).paths, [
    '1',
    '2',
    '2/a',
    '2/b',
    '5'
  ]);
});

test('the Shift anchor is the controller own state, not the tree highlight', () => {
  const controller = source('src/renderer/onlypreview/shell/src/onlyPreviewTreeSelection.store.ts');
  // `treeSelectedRelativePath` also decides where New Folder lands, so a Cmd click must not move it.
  assert.match(controller, /anchorPath: string \| null = null;/);
  assert.match(controller, /this\.anchorPath = result\.anchor;/);
  assert.doesNotMatch(controller, /host\.treeSelectedRelativePath =/);
  assert.match(controller, /this\.anchorPath \?\? this\.host\.treeSelectedRelativePath/);
});

test('actions that only make sense for one row are inert while several are selected', () => {
  const actions = source('src/main/onlypreview/onlyPreviewProjectNativeAction.service.ts');
  const menuBody = actions.slice(
    actions.indexOf('async showFileContextMenu('),
    actions.indexOf('async showProjectRootContextMenu(')
  );
  const newFolder = menuBody.slice(menuBody.indexOf("id: 'onlypreview-new-folder'"));
  assert.match(newFolder.slice(0, 400), /enabled: menuSelection\.length <= 1/);
  const rename = menuBody.slice(menuBody.indexOf("id: 'onlypreview-rename'"));
  assert.match(rename.slice(0, 400), /enabled: menuSelection\.length <= 1/);
});

test('the selection is dropped when its rows go away', () => {
  const app = source('src/renderer/onlypreview/shell/src/App.vue');
  // Opening another Project replaces every row; a delete or an external change removes some.
  assert.match(app, /workspace\?\.workspaceId[\s\S]*?onlyPreviewTreeSelection\.clear\(\)/);
  assert.match(app, /visibleRows\.length[\s\S]*?onlyPreviewTreeSelection\.retain\(\)/);
  const controller = source('src/renderer/onlypreview/shell/src/onlyPreviewTreeSelection.store.ts');
  // And once more before every gesture, so a range starts from what is actually on screen.
  assert.match(controller, /apply\(intent[\s\S]*?this\.retain\(\);/);
});

test('locating the previewed file collapses the tree selection onto it', () => {
  // Ral 2026-09-04: open a file from global search, click locate, and the row arrived without a
  // highlight. `isSelected` answers from `anchorPath` (or an explicit multi-selection) before it
  // falls back to `treeSelectedRelativePath`, and a file opened from search was never clicked in the
  // tree, so the stale anchor kept the highlight.
  const app = source('src/renderer/onlypreview/shell/src/App.vue');
  const locate = app.slice(
    app.indexOf('const locateCurrentFile'),
    app.indexOf('const handleTreeKeydown')
  );
  assert.match(locate, /onlyPreviewTreeSelection\.clear\(\)/);
  // Gated on the same precondition `locateSelectedFile` uses, so locating nothing cannot wipe a
  // real selection.
  assert.match(locate, /if \(onlyPreviewShellStore\.selectedRelativePath\)/);
  assert.ok(
    locate.indexOf('onlyPreviewTreeSelection.clear()') <
      locate.indexOf('locateSelectedFile()'),
    'the selection collapses before the anchor moves'
  );

  // The fallback the fix depends on: with no explicit anchor and no multi-selection, the tree
  // highlight follows `treeSelectedRelativePath`.
  const controller = source('src/renderer/onlypreview/shell/src/onlyPreviewTreeSelection.store.ts');
  assert.match(
    controller,
    /clear\(\): void \{\s*this\.paths = \[\];\s*this\.anchorPath = null;/
  );
  assert.match(
    controller,
    /get anchor\(\): string \| null \{\s*return this\.anchorPath \?\? this\.host\.treeSelectedRelativePath;/
  );
});
