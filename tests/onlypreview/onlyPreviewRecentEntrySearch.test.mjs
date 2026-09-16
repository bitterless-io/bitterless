/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createOnlyPreviewSearchEngine } from '../../src/preload/onlypreview/search/core/search-engine.mjs';
import { createWorkspaceWatchController } from '../../src/preload/onlypreview/search/core/watch-controller.mjs';
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const fakeWatcher = () => Object.assign(new EventEmitter(), { close() { return undefined; } });
const fixture = async (run) => {
  const base = await mkdtemp(join(tmpdir(), 'onlypreview-recent-search-'));
  const rootPath = join(base, 'workspace');
  await mkdir(rootPath);
  const engine = createOnlyPreviewSearchEngine({ watchFactory: fakeWatcher });
  try {
    await run(engine, {
      workspaceId: 'workspace',
      generation: 1,
      rootPath,
      databasePath: join(base, 'index.sqlite')
    });
  } finally {
    await engine.shutdown();
    await rm(base, { recursive: true, force: true });
  }
};
const gatePromotion = (engine) => {
  const reached = deferred(),
    release = deferred();
  const original = engine.promoteCandidate.bind(engine);
  engine.promoteCandidate = async (...args) => {
    reached.resolve();
    await release.promise;
    return original(...args);
  };
  return { reached: reached.promise, release: release.resolve };
};
const search = (engine, requestId, onResult) =>
  engine.search({
    workspaceId: 'workspace',
    generation: 1,
    requestId,
    query: 'fresh',
    maxResults: 100,
    scope: { kind: 'project' },
    isCancelled: () => false,
    onResult
  });

for (const warm of [false, true])
  test(
    `${warm ? 'warm' : 'cold'} build cannot delay new names or erase them at promotion`,
    { timeout: 5000 },
    async () =>
      fixture(async (engine, context) => {
        if (warm) await engine.initialize(context);
        const gate = gatePromotion(engine);
        const building = warm
          ? engine.refresh({ workspaceId: context.workspaceId, generation: 1 })
          : engine.initialize(context);
        try {
          await gate.reached;
          await mkdir(join(context.rootPath, 'fresh-folder'));
          await writeFile(join(context.rootPath, 'fresh-file.txt'), 'new content');
          const listing = await engine.browseDirectory({
            workspaceId: context.workspaceId,
            generation: 1,
            directoryToken: engine.browseIndex.rootDirectoryToken
          });
          assert.equal(listing.entries.length, 2);
          const early = deferred();
          const paths = new Set();
          let completed = false;
          const searching = search(engine, 'during-build', (result) => {
            paths.add(result.relativePath);
            if (paths.size === 2) early.resolve();
          }).finally(() => {
            completed = true;
          });
          await early.promise;
          assert.deepEqual([...paths].sort(), ['fresh-file.txt', 'fresh-folder']);
          assert.equal(completed, false, 'names arrive while the content build is still blocked');
          gate.release();
          await building;
          const result = await searching;
          assert.deepEqual(result.files.map((item) => item.relativePath).sort(), [
            'fresh-file.txt',
            'fresh-folder'
          ]);
          assert.equal(
            new Set(result.files.map((item) => item.relativePath)).size,
            2,
            'no duplicate old and new names'
          );
          assert.deepEqual(
            (await search(engine, 'ready')).files.map((item) => item.relativePath).sort(),
            ['fresh-file.txt', 'fresh-folder']
          );
        } finally {
          gate.release();
          await building.catch(() => undefined);
        }
      })
  );

test('refreshed listings drop removed descendants and retain search exclusions', async () =>
  fixture(async (engine, context) => {
    await mkdir(join(context.rootPath, 'fresh-folder'));
    await writeFile(join(context.rootPath, 'fresh-folder', 'fresh-inside.txt'), 'text');
    await mkdir(join(context.rootPath, 'node_modules'));
    await writeFile(join(context.rootPath, 'node_modules', 'fresh-hidden.txt'), 'excluded');
    await engine.initialize(context);
    const root = await engine.browseIndex.rootListing(context);
    for (const entry of root.entries)
      if (entry.nodeKind === 'directory')
        await engine.browseDirectory({
          workspaceId: context.workspaceId,
          generation: 1,
          directoryToken: entry.directoryToken
        });
    assert.equal(
      [...engine.browseIndex.searchEntries()].some((entry) =>
        entry.relativePath.includes('hidden')
      ),
      false
    );
    await rm(join(context.rootPath, 'fresh-folder'), { recursive: true });
    await engine.browseIndex.rootListing(context);
    assert.equal(
      [...engine.browseIndex.searchEntries()].some((entry) =>
        entry.relativePath.startsWith('fresh-folder')
      ),
      false
    );
    engine.browseIndex.reset();
    assert.deepEqual([...engine.browseIndex.searchEntries()], []);
  }));

test(
  'watch metadata updates keep arriving while content reconciliation is blocked',
  { timeout: 5000 },
  async () => {
    const gate = deferred(),
      started = deferred(),
      first = deferred(),
      second = deferred();
    let listener;
    const changes = [];
    const controller = createWorkspaceWatchController({
      rootPath: '/virtual/workspace',
      watchFactory: (_root, _options, callback) => {
        listener = callback;
        return fakeWatcher();
      },
      onReconcile: async () => {
        started.resolve();
        await gate.promise;
      },
      onBrowseChange: async (change) => {
        changes.push(change);
        if (changes.length === 1) first.resolve();
        else second.resolve();
      }
    });
    try {
      listener('rename', 'fresh-one');
      const flushing = controller.flushNow();
      await started.promise;
      await first.promise;
      listener('rename', 'fresh-two');
      await second.promise;
      assert.deepEqual(
        changes.map((change) => change.paths),
        [['fresh-one'], ['fresh-two']]
      );
      gate.resolve();
      await flushing;
    } finally {
      gate.resolve();
      await controller.close();
    }
  }
);
