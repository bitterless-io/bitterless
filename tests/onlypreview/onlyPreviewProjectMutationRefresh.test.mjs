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
    'refreshIndex'
  ]) {
    assert.ok(contract.includes(field), `${field} belongs to the authoring host contract`);
  }
});
