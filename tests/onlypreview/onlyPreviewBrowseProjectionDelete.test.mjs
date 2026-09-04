/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { runtime } from './onlyPreviewCoreTest.helper.mjs';

/**
 * `removeDeletedPaths` — the rows go the moment Main says they went.
 *
 * The projection is what draws the tree, and before this its only writer was a re-fetched listing.
 * Reaching one meant waiting for `refreshIndex()`, which is a full workspace re-index, so a deleted
 * folder kept its row for as long as that rescan took and every click on it failed with
 * PATH_NOT_FOUND. See docs/issues/onlypreview-delete-refreshes-the-wrong-index.md.
 */
const { OnlyPreviewBrowseProjectionService } = runtime;

const WORKSPACE = 'ws-1';
const context = { hostToken: 'tok', workspaceId: WORKSPACE, generation: 1 };

const dir = (relativePath, parentRelativePath) => ({
  relativePath,
  parentRelativePath,
  name: relativePath.split('/').at(-1),
  nodeKind: 'directory',
  directoryToken: `token:${relativePath}`,
  size: 0,
  modifiedAt: 0,
  previewHint: 'none',
  mediaType: '',
  isText: false
});

const file = (relativePath, parentRelativePath) => ({
  relativePath,
  parentRelativePath,
  name: relativePath.split('/').at(-1),
  nodeKind: 'file',
  size: 1,
  modifiedAt: 0,
  previewHint: 'text',
  mediaType: 'text/plain',
  isText: true
});

const listing = (relativePath, entries) => ({
  workspaceId: WORKSPACE,
  generation: 1,
  relativePath,
  directoryToken: `token:${relativePath}`,
  entries
});

/**
 * root
 * ├── a1
 * │   ├── b1        (folder, has a child)
 * │   │   └── c.txt
 * │   └── b10       (folder — the sibling that must survive a1/b1 dying)
 * ├── keep.txt
 * └── gone.txt
 */
const seeded = () => {
  const projection = new OnlyPreviewBrowseProjectionService();
  const expandedPaths = new Set();
  projection.applyListing(
    listing('', [dir('a1', ''), file('keep.txt', ''), file('gone.txt', '')]),
    context,
    expandedPaths
  );
  projection.applyListing(
    listing('a1', [dir('a1/b1', 'a1'), dir('a1/b10', 'a1')]),
    context,
    expandedPaths
  );
  projection.applyListing(listing('a1/b1', [file('a1/b1/c.txt', 'a1/b1')]), context, expandedPaths);
  expandedPaths.add('');
  expandedPaths.add('a1');
  expandedPaths.add('a1/b1');
  return { projection, expandedPaths };
};

const paths = (result) => result.index.entries.map((entry) => entry.relativePath).sort();

describe('removeDeletedPaths — a file', () => {
  test('the row leaves its parent listing immediately', () => {
    const { projection, expandedPaths } = seeded();
    const result = projection.removeDeletedPaths(['gone.txt'], WORKSPACE, expandedPaths);
    assert.equal(result.changed, true);
    assert.equal(paths(result).includes('gone.txt'), false);
    assert.equal(paths(result).includes('keep.txt'), true, 'a sibling file must survive');
  });
});

describe('removeDeletedPaths — a folder', () => {
  test('the folder row goes, and so does everything under it', () => {
    const { projection, expandedPaths } = seeded();
    const result = projection.removeDeletedPaths(['a1/b1'], WORKSPACE, expandedPaths);
    assert.equal(result.changed, true);
    const remaining = paths(result);
    assert.equal(remaining.includes('a1/b1'), false, 'the folder row itself — this is the bug');
    assert.equal(remaining.includes('a1/b1/c.txt'), false, 'its child came from a separate listing');
  });

  test('a1/b10 survives a1/b1 — containment is by segment, not by prefix', () => {
    const { projection, expandedPaths } = seeded();
    const result = projection.removeDeletedPaths(['a1/b1'], WORKSPACE, expandedPaths);
    assert.equal(paths(result).includes('a1/b10'), true);
  });

  test('the expanded set loses the removed folder, so no frame expands a row that is gone', () => {
    const { projection, expandedPaths } = seeded();
    projection.removeDeletedPaths(['a1/b1'], WORKSPACE, expandedPaths);
    assert.equal(expandedPaths.has('a1/b1'), false);
    assert.equal(expandedPaths.has('a1'), true, 'the surviving ancestor stays open');
  });

  test('the folder can be re-created afterwards — its stale directory token is dropped too', () => {
    const { projection, expandedPaths } = seeded();
    projection.removeDeletedPaths(['a1/b1'], WORKSPACE, expandedPaths);
    const result = projection.applyListing(
      listing('a1', [dir('a1/b1', 'a1'), dir('a1/b10', 'a1')]),
      context,
      expandedPaths
    );
    assert.equal(paths(result).includes('a1/b1'), true);
  });
});

describe('removeDeletedPaths — a whole selection at once', () => {
  test('a mixed run removes every member', () => {
    const { projection, expandedPaths } = seeded();
    const result = projection.removeDeletedPaths(['gone.txt', 'a1/b1'], WORKSPACE, expandedPaths);
    const remaining = paths(result);
    assert.deepEqual(remaining, ['a1', 'a1/b10', 'keep.txt']);
  });
});

describe('removeDeletedPaths — what must NOT happen', () => {
  test('the root is never a removable row', () => {
    const { projection, expandedPaths } = seeded();
    const before = projection.removeDeletedPaths([], WORKSPACE, expandedPaths).index;
    const result = projection.removeDeletedPaths([''], WORKSPACE, expandedPaths);
    assert.equal(result.changed, false, 'an empty path must not match everything');
    assert.equal(result.index, before);
  });

  test('an empty run changes nothing', () => {
    const { projection, expandedPaths } = seeded();
    assert.equal(projection.removeDeletedPaths([], WORKSPACE, expandedPaths).changed, false);
  });

  test('a path the projection never had is a no-op, not a rebuild', () => {
    const { projection, expandedPaths } = seeded();
    const result = projection.removeDeletedPaths(['nowhere/at/all'], WORKSPACE, expandedPaths);
    assert.equal(result.changed, false);
  });

  test('an unseeded projection refuses rather than inventing an empty index', () => {
    const projection = new OnlyPreviewBrowseProjectionService();
    const result = projection.removeDeletedPaths(['a.txt'], WORKSPACE, new Set());
    assert.equal(result.changed, false);
    assert.equal(result.index, null);
  });
});
