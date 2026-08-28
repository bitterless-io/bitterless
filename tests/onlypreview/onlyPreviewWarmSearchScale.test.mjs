import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  BACKGROUND_BUILD_TRANSACTION_FILES,
  MAX_WATCH_CHANGE_PATHS
} from '../../src/preload/onlypreview/search/core/constants.mjs';
import { createOnlyPreviewSearchWatchReconciler } from '../../src/preload/onlypreview/search/core/watch-reconciler.mjs';
import { createOnlyPreviewSearchEngine } from '../../src/preload/onlypreview/search/core/search-engine.mjs';

const deferred = () => {
  let resolve;
  const promise = new Promise((resolveValue) => {
    resolve = resolveValue;
  });
  return { promise, resolve };
};

test('first-build directory search keeps reader ownership across priority and scoped Contents', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'onlypreview-first-build-reader-'));
  const priorityEntered = deferred();
  const releasePriority = deferred();
  const promotionEntered = deferred();
  const engine = createOnlyPreviewSearchEngine();
  try {
    await mkdir(join(temp, 'workspace', 'folder'), { recursive: true });
    await writeFile(join(temp, 'workspace', 'folder', 'needle.txt'), 'reader race needle');
    const searchPriority = engine.selectedFilePriority.searchGlobal.bind(engine.selectedFilePriority);
    engine.selectedFilePriority.searchGlobal = async (...args) => {
      priorityEntered.resolve();
      await releasePriority.promise;
      return await searchPriority(...args);
    };
    const promoteCandidate = engine.promoteCandidate.bind(engine);
    engine.promoteCandidate = async (...args) => {
      promotionEntered.resolve();
      return await promoteCandidate(...args);
    };
    const initialize = engine.initialize({
      workspaceId: 'workspace',
      generation: 1,
      rootPath: join(temp, 'workspace'),
      databasePath: join(temp, 'search.sqlite')
    });
    while (!engine.browseIndex?.hasDirectory('folder')) {
      await new Promise((resolveValue) => setImmediate(resolveValue));
    }
    const searching = engine.search({
      workspaceId: 'workspace',
      generation: 1,
      requestId: 'reader-race',
      query: 'reader race needle',
      maxResults: 10,
      scope: { kind: 'directory', relativePath: 'folder' },
      isCancelled: () => false
    });
    await priorityEntered.promise;
    await promotionEntered.promise;
    releasePriority.resolve();
    const [response] = await Promise.all([searching, initialize]);
    assert.deepEqual(response.contents.map(({ relativePath }) => relativePath), [
      'folder/needle.txt'
    ]);
  } finally {
    releasePriority.resolve();
    await engine.shutdown();
    await rm(temp, { recursive: true, force: true });
  }
});

test('maximum bounded watch reads and commits file bodies in bounded chunks', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'onlypreview-watch-scale-'));
  try {
    const rootPath = await realpath(temp);
    const retainedTreeEntries = Array.from({ length: 130_000 }, (_, index) => ({
      relativePath: `retained/${String(index).padStart(6, '0')}.txt`,
      nodeKind: 'file'
    }));
    const paths = Array.from(
      { length: MAX_WATCH_CHANGE_PATHS },
      (_, index) => `file-${String(index).padStart(3, '0')}.txt`
    );
    await mkdir(temp, { recursive: true });
    await Promise.all(paths.map((relativePath) => writeFile(join(rootPath, relativePath), 'x')));
    let readsSinceTransaction = 0;
    let peakRetainedReads = 0;
    let transactionCount = 0;
    const indexedPaths = new Set();
    const index = {
      invalidateTreeSnapshot: () => undefined,
      runMutation: (operation) => {
        transactionCount += 1;
        peakRetainedReads = Math.max(peakRetainedReads, readsSinceTransaction);
        readsSinceTransaction = 0;
        return operation();
      },
      upsert: (entry) => indexedPaths.add(entry.relativePath),
      delete: () => false,
      applyFilenameTierMutations: () => undefined,
      applyTreeSnapshotMutations: () => ({ treeMetadataReady: true }),
      hydrateFilenameTier: () => undefined,
      readTreeSnapshot: () => ({
        entries: [],
        maxDepthReached: false,
        treeMetadataReady: false
      })
    };
    const context = {
      index,
      state: 'ready',
      treeMetadataReady: true,
      treeEntries: retainedTreeEntries,
      maxDepthReached: false,
      rootPath,
      searchPolicy: {
        isExcludedFilePath: () => false,
        isPhysicallyExcludedPath: () => false
      },
      globalSearchSession: { revoke: () => undefined },
      acquireSearchSnapshotWriter: async () => ({ release: () => undefined }),
      emitSnapshot: async () => undefined,
      workspaceId: 'workspace',
      generation: 1,
      watchCommitRevision: 0
    };
    const reconciler = createOnlyPreviewSearchWatchReconciler({
      resolveContext: () => context,
      readWorkspaceFile: async ({ relativePath }) => {
        readsSinceTransaction += 1;
        return {
          relativePath,
          name: relativePath,
          size: 1,
          modifiedMs: 1,
          mediaType: 'text',
          previewHint: 'text',
          contentIndexed: true,
          originalContent: 'x'.repeat(1024 * 1024)
        };
      }
    });
    await reconciler.apply({ full: false, paths });
    const expectedTransactions = Math.ceil(paths.length / BACKGROUND_BUILD_TRANSACTION_FILES);
    assert.equal(transactionCount, expectedTransactions);
    assert.equal(peakRetainedReads <= BACKGROUND_BUILD_TRANSACTION_FILES, true);
    assert.equal(readsSinceTransaction, 0);
    assert.equal(indexedPaths.size, paths.length);
    assert.equal(context.treeEntries.length, retainedTreeEntries.length + paths.length);
    assert.equal(context.treeEntries[0].relativePath, paths[0]);
    assert.equal(context.treeEntries.at(-1).relativePath, retainedTreeEntries.at(-1).relativePath);
    assert.equal(context.treeMetadataReady, true);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
