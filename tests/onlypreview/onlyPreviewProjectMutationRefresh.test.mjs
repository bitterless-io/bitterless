/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';

const projectRoot = resolve(dirname(new URL(import.meta.url).pathname), '..', '..');
const source = (relativePath) => readFileSync(join(projectRoot, relativePath), 'utf8');

const TYPES = 'src/shared/onlypreview/onlyPreview.types.ts';
const NATIVE_ACTION = 'src/main/onlypreview/onlyPreviewProjectNativeAction.service.ts';
const NEW_FOLDER = 'src/main/onlypreview/onlyPreviewNewFolderDialog.service.ts';
const AUTHORING = 'src/renderer/onlypreview/shell/src/onlyPreviewProjectAuthoring.store.ts';

// New Folder and Rename hand their result back through a broadcast, because the native menu and the
// dialogs run entirely in Main and nothing returns to the renderer. Delete shipped without one, so
// its rows stayed on screen after the files were gone and the next right-click, delete or copy on
// one of them failed against a path that no longer existed (owner report, 2026-09-04).
test('every Project mutation Main performs is announced to the tree', () => {
  const types = source(TYPES);
  const nativeAction = source(NATIVE_ACTION);
  const newFolder = source(NEW_FOLDER);

  for (const event of [
    'ONLY_PREVIEW_PROJECT_NEW_FOLDER_EVENT',
    'ONLY_PREVIEW_PROJECT_RENAME_EVENT',
    'ONLY_PREVIEW_PROJECT_DELETE_EVENT'
  ]) {
    assert.match(types, new RegExp(`export const ${event} = 'onlypreview/`), `${event} is declared`);
  }
  assert.match(newFolder, /xpcMain\.broadcast\(ONLY_PREVIEW_PROJECT_NEW_FOLDER_EVENT/);
  assert.match(nativeAction, /xpcMain\.broadcast\(ONLY_PREVIEW_PROJECT_RENAME_EVENT/);
  assert.match(nativeAction, /xpcMain\.broadcast\(ONLY_PREVIEW_PROJECT_DELETE_EVENT/);
});

test('the delete broadcast carries what was actually removed, including a partial run', () => {
  const nativeAction = source(NATIVE_ACTION);
  // Driven by `outcome.removed`, never by "the run finished": a run that stopped at a failure still
  // removed everything before it, and those rows have to go.
  assert.match(nativeAction, /if \(outcome\?\.removed\.length\) \{/);
  assert.match(nativeAction, /relativePaths: removed\.map\(\(entry\) => entry\.relativePath\)/);
  // A cancelled or refused dialog removes nothing, so it must not announce anything either.
  assert.doesNotMatch(nativeAction, /announceDeletedEntries\(request, selection\)/);
});

test('the shell subscribes to the delete announcement and re-reads the index', () => {
  const authoring = source(AUTHORING);
  assert.match(authoring, /xpcRenderer\.subscribe\(ONLY_PREVIEW_PROJECT_DELETE_EVENT/);
  assert.match(authoring, /settleDeletedEntries\(event\.relativePaths\)/);
  // The tree is re-read rather than patched, so a delete cannot leave the index disagreeing with
  // what is on disk.
  assert.match(authoring, /await this\.host\.refreshIndex\(\);/);
  // Every pointer *into* a removed folder is dropped before the refresh, or the tree renders a
  // frame that still selects or expands a row that no longer exists.
  for (const pointer of [
    /this\.host\.expandedPaths\.delete\(expanded\)/,
    /this\.host\.selectedRelativePath = ''/,
    /this\.host\.focusedRelativePath = ''/,
    /this\.host\.treeSelectedRelativePath = null/
  ]) {
    assert.match(authoring, pointer);
  }
  // Containment comes from the shared segment walk, not a local `startsWith`, so `a1/b10` is never
  // read as living inside `a1/b1`.
  assert.match(authoring, /isOnlyPreviewPathRemoved\(removed, relativePath\)/);
  assert.doesNotMatch(authoring, /startsWith\(`\$\{entry\}\/`\)/);
});

test('the host contract names every field the delete settle writes', () => {
  const authoring = source(AUTHORING);
  const contract = authoring.slice(
    authoring.indexOf('export interface OnlyPreviewProjectAuthoringHost'),
    authoring.indexOf('export class OnlyPreviewProjectAuthoringController')
  );
  for (const field of [
    'expandedPaths',
    'selectedRelativePath',
    'focusedRelativePath',
    'treeSelectedRelativePath',
    'refreshIndex',
    'browseProjection'
  ]) {
    assert.ok(contract.includes(field), `${field} belongs to the authoring host contract`);
  }
});

/**
 * The ordering guard.
 *
 * `refreshIndex()` is a full workspace re-index (`search-engine.mjs` `refreshInternal` counts and
 * rebuilds the whole root), so a settle that only refreshed left a deleted FOLDER on screen for the
 * length of that rescan — the tree is drawn from the browse projection, which a search refresh does
 * not write. The rows must come off before that await, from the paths we were already handed.
 */
test('the delete settle drops the rows BEFORE it awaits the full re-index', () => {
  const authoring = source(AUTHORING);
  const settle = authoring.slice(
    authoring.indexOf('async settleDeletedEntries('),
    authoring.indexOf('beginRename(')
  );
  assert.ok(settle.length > 0, 'settleDeletedEntries is still where the guard expects it');
  const drop = settle.indexOf('dropDeletedRows(removed)');
  const refresh = settle.indexOf('await this.host.refreshIndex()');
  assert.ok(drop > 0, 'the settle hands the removed paths to the projection');
  assert.ok(refresh > 0, 'the settle still reconciles the search index afterwards');
  assert.ok(drop < refresh, 'the rows must go before the rescan is awaited, not after it');
});

test('the removal goes to the browse projection, not to the search index', () => {
  const authoring = source(AUTHORING);
  const method = authoring.slice(
    authoring.indexOf('private dropDeletedRows('),
    authoring.indexOf('beginRename(')
  );
  assert.ok(method.includes('this.host.browseProjection.removeDeletedPaths'), 'it reaches the projection');
  assert.ok(method.includes('this.host.index = dropped.index'), 'and it commits the new projection');
});

test('the projection is reachable from the store — a private field would strand the controller', () => {
  const shell = source('src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts');
  assert.match(shell, /^\s+readonly browseProjection = new OnlyPreviewBrowseProjectionService\(\);/m);
});

/**
 * A delete that already happened must not be reported as a failure.
 *
 * `followDeletedSelection` runs AFTER the unlink. It reaches `clearWorkspace` →
 * `requireRuntime`, which throws HOST_ROLE_DENIED when the preview window is gone. That throw used
 * to escape `removeProjectEntry`, where the delete loop reads it as "this entry was not removed":
 * failure alert, entry missing from `outcome.removed`, and the row it just deleted stays on the
 * tree. The old guard covered only `requireCurrentItem`.
 */
test('following the selection cannot turn a completed delete into a reported failure', () => {
  const source_ = source(NATIVE_ACTION);
  const method = source_.slice(
    source_.indexOf('private followDeletedSelection('),
    source_.indexOf('private requireCurrentItem(')
  );
  assert.ok(method.length > 0, 'followDeletedSelection is still where the guard expects it');
  for (const call of [
    'this.requireCurrentItem(authority)',
    'onlyPreviewWorkspaceRegistry.restore(hostToken)',
    'onlyPreviewWorkspaceRegistry.clearProjectSelection(hostToken)',
    'onlyPreviewPreviewRegionService.clearWorkspace(hostToken'
  ]) {
    const at = method.indexOf(call);
    assert.ok(at > 0, `${call} is still part of following the selection`);
    const guard = method.lastIndexOf('try {', at);
    const closes = method.indexOf('} catch', at);
    assert.ok(guard > 0 && closes > at, `${call} must sit inside the try, not after it`);
  }
});
