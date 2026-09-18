/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { createOnlyPreviewSearchEngine } from '../../src/preload/onlypreview/search/core/search-engine.mjs';
import { OnlyPreviewSqliteIndex } from '../../src/preload/onlypreview/search/core/sqlite-index.mjs';
import { createOnlyPreviewSearchDiagnostics } from '../../src/shared/onlypreview/onlyPreviewSearchDiagnostics.mjs';

/**
 * Task 187 items 1 and 7.
 *
 * Task 183 refuses a rebuild that cannot fit — measured against the index already on disk. When the
 * traversal config changes, that index can never be read from and never be reconciled against, yet
 * its bytes are charged to the requirement *and* occupy the space the rebuild needs. The refusal
 * therefore blocks the one thing that would free the space, and the workspace can never index again
 * without a manual delete. That is the state the reference machine was in.
 *
 * Free space is what every case here turns on, and no fixture can arrange it, so the plan and the
 * `statfs` probe are injected.
 */

const withWorkspace = async (callback) => {
  const temp = await mkdtemp(join(tmpdir(), 'onlypreview-index-reclaim-'));
  const root = join(temp, 'workspace');
  const databasePath = join(temp, 'indexes', 'index.sqlite');
  await mkdir(root, { recursive: true });
  await mkdir(join(temp, 'indexes'), { recursive: true });
  await writeFile(join(root, 'note.txt'), 'hello');
  try {
    return await callback({ root, databasePath });
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
};

const exists = async (path) => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const GIB = 1024 ** 3;
const plan = (mode, indexBytes, freeBytes) => ({
  mode,
  indexBytes,
  freeBytes,
  requiredBytes: indexBytes + 512 * 1024 * 1024
});

test('a dead index is reclaimed so its own replacement can be built', async () => {
  await withWorkspace(async ({ root, databasePath }) => {
    await writeFile(databasePath, 'a dead index the open could not reuse');
    const plans = [];
    const engine = createOnlyPreviewSearchEngine({
      planIndexBuild: async ({ reconcile }) => {
        plans.push(reconcile);
        // Before the reclaim the 6 GiB corpse does not fit in 5.5 GiB free; afterwards there is
        // nothing left to measure and only the headroom is needed.
        return (await exists(databasePath))
          ? plan('none', 6 * GIB, 5.5 * GIB)
          : plan('fresh', 0, 11.5 * GIB);
      }
    });
    const snapshot = await engine.initialize({
      workspaceId: 'workspace',
      generation: 1,
      rootPath: root,
      databasePath
    });
    assert.equal(snapshot.state, 'ready');
    assert.deepEqual(plans, [false, false], 'the second plan can no longer claim a reconcile');
    const rebuilt = new OnlyPreviewSqliteIndex(databasePath);
    assert.equal(rebuilt.schema.schemaVersion, 8, 'the corpse was replaced, not reopened');
    rebuilt.close();
    await engine.shutdown();
  });
});

test('an index that is still serving is never deleted to make room', async () => {
  await withWorkspace(async ({ root, databasePath }) => {
    const engine = createOnlyPreviewSearchEngine();
    await engine.initialize({
      workspaceId: 'workspace',
      generation: 1,
      rootPath: root,
      databasePath
    });
    // The same shortfall, now with a live index behind it: `refreshInternal` always passes one.
    engine.planIndexBuild = async () => plan('none', 6 * GIB, 5.5 * GIB);
    await assert.rejects(engine.refreshInternal(), { code: 'INDEX_FAILED' });
    assert.equal(await exists(databasePath), true, 'the index that answers searches survives');
    await engine.shutdown();
  });
});

test('a refused build does not walk the workspace again until the volume recovers', async () => {
  await withWorkspace(async ({ root, databasePath }) => {
    let freeBytes = 0;
    const lines = [];
    const engine = createOnlyPreviewSearchEngine({
      // `none` with nothing on disk: the volume has no room even for the headroom, so the reclaim
      // branch has nothing to reclaim and the refusal stands.
      planIndexBuild: async () => plan(freeBytes > 8 * GIB ? 'fresh' : 'none', 0, freeBytes),
      measureFreeBytes: async () => freeBytes,
      diagnostics: createOnlyPreviewSearchDiagnostics({ write: (line) => lines.push(line) })
    });
    const counts = () => lines.filter((line) => line.includes('event=full-count')).length;
    const initialize = async () =>
      await engine.initialize({
        workspaceId: 'workspace',
        generation: 1,
        rootPath: root,
        databasePath
      });

    await assert.rejects(initialize(), { code: 'INDEX_FAILED' });
    assert.equal(counts(), 1, 'the first refusal is only reachable by counting the workspace');
    await assert.rejects(initialize(), { code: 'INDEX_FAILED' });
    assert.equal(counts(), 1, 'the second costs one statfs, not another traversal');

    freeBytes = 16 * GIB;
    const snapshot = await initialize();
    assert.equal(snapshot.state, 'ready', 'recovered space clears the latch');
    assert.equal(counts(), 2, 'and the build that follows counts normally');
    await engine.shutdown();
  });
});
