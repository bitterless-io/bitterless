import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdir, realpath, stat, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createOnlyPreviewSearchEngine } from '../../src/preload/onlypreview/search/core/search-engine.mjs';
import {
  OnlyPreviewSqliteIndex,
  SEARCH_ENGINE_IDENTITY
} from '../../src/preload/onlypreview/search/core/sqlite-index.mjs';
import { createWorkspaceWatchController } from '../../src/preload/onlypreview/search/core/watch-controller.mjs';
import { loadOnlyPreviewWorkspaceConfig } from '../../src/preload/onlypreview/search/core/workspace-config.mjs';
import {
  delay,
  search,
  withTempDirectory,
  write
} from './onlyPreviewSearchEngineSqliteTest.helper.mjs';

const resultCount = (response) => response.files.length + response.contents.length;

test('reopen reconciles committed near-end build batches without rereading stable files', async () => {
  await withTempDirectory(async (temp) => {
    const root = join(temp, 'workspace');
    const databasePath = join(temp, 'cache', 'search.sqlite');
    await mkdir(root);
    await mkdir(dirname(databasePath), { recursive: true });
    const fixtures = Array.from({ length: 12 }, (_, index) => ({
      relativePath: `file-${String(index).padStart(2, '0')}.txt`,
      content: `original committed content ${index}`
    }));
    for (const fixture of fixtures) {
      await write(join(root, fixture.relativePath), fixture.content);
    }
    const rootRealPath = await realpath(root);
    const config = await loadOnlyPreviewWorkspaceConfig(rootRealPath);
    const identity = {
      workspaceHash: createHash('sha256').update(rootRealPath).digest('hex'),
      configHash: config.hash,
      engineHash: createHash('sha256').update(SEARCH_ENGINE_IDENTITY).digest('hex')
    };
    const partial = new OnlyPreviewSqliteIndex(databasePath);
    const interruptedEntries = (async function* buildNearEnd() {
      for (const fixture of fixtures) {
        const fileStat = await stat(join(root, fixture.relativePath));
        yield {
          relativePath: fixture.relativePath,
          mediaType: 'text',
          contentIndexed: true,
          originalContent: fixture.content,
          size: fileStat.size,
          modifiedMs: Math.trunc(fileStat.mtimeMs)
        };
      }
      throw new Error('simulated crash near end');
    })();
    await assert.rejects(
      partial.rebuild(interruptedEntries, identity),
      /simulated crash near end/u
    );
    assert.equal(partial.database.prepare('SELECT count(*) AS count FROM files').get().count, 10);
    partial.close();

    const persisted = new DatabaseSync(databasePath);
    const stableId = persisted
      .prepare("SELECT id FROM files WHERE relative_path = 'file-00.txt'")
      .get().id;
    persisted.exec(`
      CREATE TRIGGER stable_file_must_not_be_inserted
      BEFORE INSERT ON files WHEN NEW.relative_path = 'file-00.txt'
      BEGIN SELECT RAISE(ABORT, 'stable file was reinserted'); END;
      CREATE TRIGGER stable_file_must_not_be_updated
      BEFORE UPDATE ON files WHEN OLD.relative_path = 'file-00.txt'
      BEGIN SELECT RAISE(ABORT, 'stable file was reread'); END;
    `);
    persisted.close();

    await write(join(root, 'file-03.txt'), 'changed content recovered exactly');
    await unlink(join(root, 'file-08.txt'));
    await write(join(root, 'new.txt'), 'new content recovered exactly');

    const snapshots = [];
    const engine = createOnlyPreviewSearchEngine({
      onSnapshot: (snapshot) => snapshots.push(snapshot)
    });
    const recovered = await engine.initialize({
      workspaceId: 'workspace',
      generation: 1,
      rootPath: root,
      databasePath
    });
    assert.deepEqual(
      snapshots.map(({ state }) => state),
      ['reconciling', 'ready']
    );
    assert.equal(recovered.index.entries.length, 12);
    assert.equal(
      engine.index.database
        .prepare("SELECT id FROM files WHERE relative_path = 'file-00.txt'")
        .get().id,
      stableId
    );
    assert.equal(resultCount(await search(engine, 1, 'stable', 'original committed content 0')), 1);
    assert.equal(resultCount(await search(engine, 1, 'changed', 'changed content recovered exactly')), 1);
    assert.equal(resultCount(await search(engine, 1, 'pending', 'original committed content 11')), 1);
    assert.equal(resultCount(await search(engine, 1, 'new', 'new content recovered exactly')), 1);
    assert.equal(resultCount(await search(engine, 1, 'stale', 'original committed content 8')), 0);
    assert.equal(engine.index.statistics().buildState.state, 'ready');
    await engine.shutdown();
  });
});

test('committed watch revisions stay relative, monotonic, and cover delete, recreate, and full', async () => {
  await withTempDirectory(async (temp) => {
    const root = join(temp, 'workspace');
    await mkdir(root);
    await write(join(root, 'selected.txt'), 'old value');
    const commits = [];
    const engine = createOnlyPreviewSearchEngine({
      onWatchCommit: (commit) => commits.push(commit)
    });
    await engine.initialize({
      workspaceId: 'workspace',
      generation: 3,
      rootPath: root,
      databasePath: join(temp, 'cache', 'search.sqlite')
    });
    await engine.watchController.close({ drain: false });
    engine.watchController = undefined;
    engine.watchRevision += 1;

    await write(join(root, 'selected.txt'), 'new value');
    await engine.enqueue(
      async () =>
        await engine.applyWatchChangesInternal({
          full: false,
          paths: ['selected.txt']
        })
    );
    assert.equal(resultCount(await search(engine, 3, 'watch-new', 'new value')), 1);

    await unlink(join(root, 'selected.txt'));
    await engine.enqueue(
      async () =>
        await engine.applyWatchChangesInternal({
          full: false,
          paths: ['selected.txt']
        })
    );
    assert.equal(resultCount(await search(engine, 3, 'watch-deleted', 'selected')), 0);

    await write(join(root, 'selected.txt'), 'recreated value');
    await engine.enqueue(
      async () =>
        await engine.applyWatchChangesInternal({
          full: false,
          paths: ['selected.txt']
        })
    );
    assert.equal(resultCount(await search(engine, 3, 'watch-recreated', 'recreated value')), 1);

    await engine.enqueue(
      async () =>
        await engine.applyWatchChangesInternal({
          full: true,
          paths: []
        })
    );
    await engine.enqueue(
      async () =>
        await engine.applyWatchChangesInternal({
          full: false,
          paths: ['../outside.txt']
        })
    );

    assert.deepEqual(commits, [
      {
        workspaceId: 'workspace',
        generation: 3,
        revision: 1,
        full: false,
        changedRelativePaths: ['selected.txt']
      },
      {
        workspaceId: 'workspace',
        generation: 3,
        revision: 2,
        full: false,
        changedRelativePaths: ['selected.txt']
      },
      {
        workspaceId: 'workspace',
        generation: 3,
        revision: 3,
        full: false,
        changedRelativePaths: ['selected.txt']
      },
      {
        workspaceId: 'workspace',
        generation: 3,
        revision: 4,
        full: true,
        changedRelativePaths: []
      },
      {
        workspaceId: 'workspace',
        generation: 3,
        revision: 5,
        full: true,
        changedRelativePaths: []
      }
    ]);
    await engine.shutdown();
  });
});

test('watch retains one backoff full-reconcile retry until a transient rejection succeeds', async () => {
  const emitter = new EventEmitter();
  emitter.close = () => undefined;
  let watchListener;
  const attempts = [];
  const errors = [];
  const controller = createWorkspaceWatchController({
    rootPath: '/virtual/workspace',
    watchFactory: (_rootPath, _options, listener) => {
      watchListener = listener;
      return emitter;
    },
    retryBaseMs: 25,
    retryMaxMs: 50,
    onReconcile: async (change) => {
      attempts.push(change);
      if (attempts.length === 1) throw new Error('transient reconcile failure');
    },
    onError: (error) => errors.push(error)
  });

  controller.requestFullReconcile();
  await controller.flushNow();
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].full, true);
  assert.equal(errors.length, 1);

  watchListener('change', 'late-a.txt');
  watchListener('change', 'late-b.txt');
  controller.requestFullReconcile();
  controller.requestFullReconcile();
  await delay(5);
  assert.equal(attempts.length, 1, 'retry must honor its backoff delay');

  const deadline = Date.now() + 500;
  while (attempts.length < 2 && Date.now() < deadline) await delay(5);
  assert.equal(attempts.length, 2);
  assert.equal(attempts[1].full, true);
  assert.deepEqual(attempts[1].paths.sort(), ['late-a.txt', 'late-b.txt']);
  await delay(75);
  assert.equal(attempts.length, 2, 'a successful full reconcile must clear the retry latch');
  await controller.close();
});

test('refresh builds a private candidate while the complete active index remains searchable', async () => {
  await withTempDirectory(async (temp) => {
    const root = join(temp, 'workspace');
    await mkdir(root);
    await write(join(root, 'base.txt'), 'base query');
    const engine = createOnlyPreviewSearchEngine();
    await engine.initialize({
      workspaceId: 'workspace',
      generation: 1,
      rootPath: root,
      databasePath: join(temp, 'cache', 'search.sqlite')
    });
    await engine.watchController.close({ drain: false });
    engine.watchController = undefined;
    engine.watchRevision += 1;

    const progress = [];
    engine.onProgress = (value) => progress.push(value);
    await write(join(root, 'candidate-only.txt'), 'candidate-only searchable value');

    let releasePromotion;
    const promotionGate = new Promise((resolve) => {
      releasePromotion = resolve;
    });
    let candidateComplete;
    const candidateCompletePromise = new Promise((resolve) => {
      candidateComplete = resolve;
    });
    const originalPromote = engine.promoteCandidate.bind(engine);
    engine.promoteCandidate = async (...args) => {
      candidateComplete();
      await promotionGate;
      return await originalPromote(...args);
    };
    const refresh = engine.refresh({ workspaceId: 'workspace', generation: 1 });
    await candidateCompletePromise;

    const activeWarm = [];
    let resolveActiveWarm;
    const activeWarmResult = new Promise((resolve) => {
      resolveActiveWarm = resolve;
    });
    let activeSettled = false;
    const activeSearch = engine
      .search({
        workspaceId: 'workspace',
        generation: 1,
        requestId: 'active-during-build',
        query: 'base query',
        maxResults: 500,
        scope: { kind: 'project' },
        onResult: (result) => {
          activeWarm.push(result);
          resolveActiveWarm();
        }
      })
      .finally(() => {
        activeSettled = true;
      });
    await activeWarmResult;
    assert.equal(activeWarm.length, 1);
    assert.equal(activeSettled, false);

    assert.equal(
      engine.index.metadata('candidate-only.txt'),
      undefined,
      'candidate rows remain private before atomic promotion'
    );
    assert.deepEqual([...new Set(progress.map(({ phase }) => phase))], ['counting', 'indexing']);

    releasePromotion();
    await refresh;
    assert.equal(resultCount(await activeSearch), 1);
    assert.equal(
      resultCount(await search(engine, 1, 'candidate-promoted', 'candidate-only searchable value')),
      1
    );
    await engine.shutdown();
  });
});
