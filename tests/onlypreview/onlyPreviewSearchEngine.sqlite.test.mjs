import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, realpath, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createOnlyPreviewSearchEngine } from '../../src/preload/onlypreview/search/core/search-engine.mjs';
import { createSearchResultBatcher } from '../../src/preload/onlypreview/search/core/result-batcher.mjs';
import {
  OnlyPreviewSqliteIndex,
  SEARCH_ENGINE_IDENTITY
} from '../../src/preload/onlypreview/search/core/sqlite-index.mjs';
import { createWorkspaceWatchController } from '../../src/preload/onlypreview/search/core/watch-controller.mjs';
import { createBackgroundWorkSlicer } from '../../src/preload/onlypreview/search/core/work-slicer.mjs';
import { loadOnlyPreviewWorkspaceConfig } from '../../src/preload/onlypreview/search/core/workspace-config.mjs';

const withTempDirectory = async (callback) => {
  const path = await mkdtemp(join(tmpdir(), 'onlypreview-search-sqlite-'));
  try {
    return await callback(path);
  } finally {
    await rm(path, { recursive: true, force: true });
  }
};

const write = async (path, content) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
};

const search = async (
  engine,
  generation,
  requestId,
  query,
  maxResults = 500,
  scope = { kind: 'project' }
) =>
  await engine.search({
    workspaceId: 'workspace',
    generation,
    requestId,
    query,
    maxResults,
    scope,
    cancelBuffer: new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)
  });

const delay = async (milliseconds) =>
  await new Promise((resolve) => setTimeout(resolve, milliseconds));

const nextTurn = async () => await new Promise((resolve) => setImmediate(resolve));

test('SQLite v7 vertical covers all query paths, exact rows, batches, and title-only files', async () => {
  await withTempDirectory(async (temp) => {
    const root = join(temp, 'workspace');
    const databasePath = join(temp, 'cache', 'search.sqlite');
    await mkdir(root);
    await write(join(root, 'content.txt'), 'prefix ＡＢＣ café 世界 suffix');
    await write(join(root, 'boundary.txt'), `${'x'.repeat(4090)}boundarymatch`);
    await write(join(root, 'long.txt'), `before ${'q'.repeat(70)} after`);
    await write(join(root, 'folder-match/neutral.txt'), 'nothing useful');
    await write(join(root, 'titleonly.pdf'), Buffer.from('%PDF-1.7'));
    await write(join(root, '.env.secret'), 'TOP_SECRET_CONTENT');
    for (let index = 0; index < 60; index += 1) {
      await write(join(root, `batchhit-${String(index).padStart(2, '0')}.txt`), 'plain');
    }

    const engine = createOnlyPreviewSearchEngine();
    const snapshot = await engine.initialize({
      workspaceId: 'workspace',
      generation: 1,
      rootPath: root,
      databasePath
    });
    assert.equal(snapshot.state, 'ready');
    assert.equal(snapshot.memory.measurementComplete, true);
    assert.deepEqual(Object.keys(snapshot.memory).sort(), [
      'diskIndexBytes',
      'filenameTierEstimatedBytes',
      'measurementComplete',
      'processRssBytes',
      'runtimeOneGiBWarning',
      'runtimeTwoGiBLimitExceeded',
      'treeMetadataEntryCount',
      'treeMetadataEstimatedBytes',
      'workerExternalBytes',
      'workerHeapUsedBytes'
    ]);

    for (const [requestId, query] of [
      ['ascii-one', 'x'],
      ['ascii-two', 'ca'],
      ['nfkc', 'abc'],
      ['cjk', '世界'],
      ['trigram', 'café'],
      ['boundary', 'boundarymatch'],
      ['long', 'q'.repeat(70)]
    ]) {
      const response = await search(engine, 1, requestId, query);
      assert.equal(response.results.length > 0, true, query);
      assert.equal(
        response.results.some(({ contentMatch }) => contentMatch !== null),
        true,
        query
      );
    }

    assert.equal((await search(engine, 1, 'folder', 'folder-match')).results.length, 0);
    const pdf = await search(engine, 1, 'pdf', 'titleonly');
    assert.equal(pdf.results[0].mediaType, 'pdf');
    assert.equal(pdf.results[0].contentMatch, null);
    assert.equal((await search(engine, 1, 'secret-body', 'TOP_SECRET_CONTENT')).results.length, 0);
    const sensitiveTitle = await search(engine, 1, 'secret-title', '.env.secret');
    assert.equal(sensitiveTitle.results[0].mediaType, 'text');
    assert.equal(sensitiveTitle.results[0].contentMatch, null);

    const limited = await search(engine, 1, 'limited', 'batchhit', 2);
    assert.equal(limited.results.length, 2);
    assert.equal(limited.truncated, true);

    let terminal = false;
    let firstBatchBeforeTerminal = false;
    const batches = [];
    const batcher = createSearchResultBatcher({
      onBatch: (batch) => {
        batches.push(batch);
        if (!terminal) firstBatchBeforeTerminal = true;
      }
    });
    const streamed = await engine.search({
      workspaceId: 'workspace',
      generation: 1,
      requestId: 'streamed',
      query: 'batchhit',
      maxResults: 500,
      scope: { kind: 'project' },
      cancelBuffer: new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT),
      onResult: batcher.push
    });
    batcher.finish();
    terminal = true;
    assert.equal(firstBatchBeforeTerminal, true);
    assert.equal(
      batches.every((batch) => batch.length <= 50),
      true
    );
    assert.equal(batches.flat().length, streamed.results.length);
    assert.deepEqual(
      batches.flat().map(({ relativePath }) => relativePath),
      streamed.results.map(({ relativePath }) => relativePath)
    );

    assert.equal(engine.index.database.prepare('PRAGMA user_version').get().user_version, 7);
    assert.notEqual(engine.index.database.prepare('PRAGMA synchronous').get().synchronous, 0);
    assert.equal(engine.index.database.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
    await engine.shutdown();
  });
});

test('reopen reconciles changes and an incomplete build state is never treated as ready', async () => {
  await withTempDirectory(async (temp) => {
    const root = join(temp, 'workspace');
    const databasePath = join(temp, 'cache', 'search.sqlite');
    await mkdir(root);
    await write(join(root, 'mutable.txt'), 'old content');
    let engine = createOnlyPreviewSearchEngine();
    await engine.initialize({
      workspaceId: 'workspace',
      generation: 1,
      rootPath: root,
      databasePath
    });
    await engine.shutdown();

    engine = createOnlyPreviewSearchEngine();
    await engine.initialize({
      workspaceId: 'workspace',
      generation: 2,
      rootPath: root,
      databasePath
    });
    await write(join(root, 'mutable.txt'), 'new searchable content');
    await engine.refresh({ workspaceId: 'workspace', generation: 2 });
    assert.equal((await search(engine, 2, 'changed', 'searchable')).results.length, 1);
    await unlink(join(root, 'mutable.txt'));
    await engine.refresh({ workspaceId: 'workspace', generation: 2 });
    assert.equal((await search(engine, 2, 'deleted', 'mutable')).results.length, 0);
    await engine.shutdown();

    const database = new DatabaseSync(databasePath);
    database.prepare("UPDATE index_meta SET value = 'building' WHERE key = 'state'").run();
    database
      .prepare(
        `
      INSERT INTO files(relative_path, file_name, normalized_path, normalized_title,
        media_type, content_indexed, in_project, size, modified_ms)
      VALUES ('partial.txt', 'partial.txt', 'partial.txt', 'partial.txt', 'text', 0, 1, 0, 0)
    `
      )
      .run();
    database.close();

    await write(join(root, 'actual.txt'), 'actual rebuild');
    engine = createOnlyPreviewSearchEngine();
    const recovered = await engine.initialize({
      workspaceId: 'workspace',
      generation: 3,
      rootPath: root,
      databasePath
    });
    assert.equal(recovered.state, 'ready');
    assert.equal(
      recovered.index.entries.some(({ relativePath }) => relativePath === 'partial.txt'),
      false
    );
    assert.equal((await search(engine, 3, 'actual', 'actual rebuild')).results.length, 1);
    assert.equal((await search(engine, 3, 'partial', 'partial')).results.length, 0);
    await engine.shutdown();
  });
});

test('CDC updates retain unchanged chunks and Atomics cancellation does not wait for a message', async () => {
  const index = new OnlyPreviewSqliteIndex(':memory:');
  const identity = {
    workspaceHash: 'workspace',
    configHash: 'config',
    engineHash: SEARCH_ENGINE_IDENTITY
  };
  const original = `${'a'.repeat(5000)}${'b'.repeat(5000)}${'c'.repeat(5000)}`;
  await index.rebuild(
    [
      {
        relativePath: 'large.txt',
        mediaType: 'text',
        contentIndexed: true,
        originalContent: original,
        size: original.length,
        modifiedMs: 1
      }
    ],
    identity
  );
  const changed = `${'a'.repeat(5000)}${'d'.repeat(5000)}${'c'.repeat(5000)}`;
  const update = index.upsert({
    relativePath: 'large.txt',
    mediaType: 'text',
    contentIndexed: true,
    originalContent: changed,
    size: changed.length,
    modifiedMs: 2
  });
  assert.equal(update.retainedChunkCount > 0, true);
  assert.equal(update.insertedChunkCount < update.nextChunkCount, true);

  const many = [];
  for (let item = 0; item < 400; item += 1) {
    many.push({
      relativePath: `file-${String(item).padStart(3, '0')}.bin`,
      mediaType: 'unknown',
      contentIndexed: false,
      originalContent: '',
      size: 0,
      modifiedMs: item
    });
  }
  await index.rebuild(many, identity);
  const cancelState = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
  setImmediate(() => Atomics.store(cancelState, 0, 1));
  const cancelled = await index.search('never-present', {
    scope: { kind: 'project' },
    isCancelled: () => Atomics.load(cancelState, 0) !== 0
  });
  assert.equal(cancelled.cancelled, true);
  index.close();
});

test('SQLite build honors elapsed slicing even when the batch has only one slow file', async () => {
  const index = new OnlyPreviewSqliteIndex(':memory:');
  let now = 0;
  const pauses = [];
  const workSlicer = createBackgroundWorkSlicer({
    sliceMs: 8,
    pauseMs: 4,
    timers: {
      now: () => now,
      pause: async (delayMs) => {
        pauses.push(delayMs);
        now += delayMs;
      }
    }
  });
  const entries = (async function* oneSlowFile() {
    yield {
      relativePath: 'slow.txt',
      mediaType: 'text',
      contentIndexed: true,
      originalContent: 'slow file',
      size: 9,
      modifiedMs: 1
    };
    now = 12;
  })();
  await index.rebuild(
    entries,
    {
      workspaceHash: 'workspace',
      configHash: 'config',
      engineHash: SEARCH_ENGINE_IDENTITY
    },
    { workSlicer }
  );
  assert.deepEqual(pauses, [4]);
  index.close();
});

test('initial rebuild bulk-finalizes the filename tier once and keeps incremental edits sorted', async () => {
  const index = new OnlyPreviewSqliteIndex(':memory:');
  const originalRebuild = index.filenameTier.rebuild.bind(index.filenameTier);
  let rebuildCount = 0;
  index.filenameTier.rebuild = () => {
    rebuildCount += 1;
    originalRebuild();
  };
  const entries = Array.from({ length: 73 }, (_, offset) => {
    const item = 72 - offset;
    return {
      relativePath: `item-${String(item).padStart(3, '0')}.bin`,
      mediaType: 'unknown',
      contentIndexed: false,
      originalContent: '',
      size: 0,
      modifiedMs: item
    };
  });
  await index.rebuild(entries, {
    workspaceHash: 'workspace',
    configHash: 'config',
    engineHash: SEARCH_ENGINE_IDENTITY
  });
  assert.equal(rebuildCount, 1);
  assert.deepEqual(
    index.filenameTier.visible().map(({ relativePath }) => relativePath),
    [...entries].map(({ relativePath }) => relativePath).sort()
  );

  index.upsert({
    relativePath: 'aaa-first.bin',
    mediaType: 'unknown',
    contentIndexed: false,
    originalContent: '',
    size: 0,
    modifiedMs: 100
  });
  assert.equal(rebuildCount, 2);
  assert.equal(index.filenameTier.visible()[0].relativePath, 'aaa-first.bin');
  assert.equal(index.delete('aaa-first.bin'), true);
  assert.equal(rebuildCount, 3);
  assert.equal(index.filenameTier.get('aaa-first.bin'), undefined);
  index.close();
});

test('bulk reconcile finalizes the filename tier once across changed, missing, and stale rows', async () => {
  const index = new OnlyPreviewSqliteIndex(':memory:');
  const identity = {
    workspaceHash: 'workspace',
    configHash: 'config',
    engineHash: SEARCH_ENGINE_IDENTITY
  };
  const initial = Array.from({ length: 60 }, (_, item) => ({
    relativePath: `existing-${String(item).padStart(2, '0')}.bin`,
    mediaType: 'unknown',
    contentIndexed: false,
    originalContent: '',
    size: item,
    modifiedMs: item
  }));
  await index.rebuild(initial, identity);
  const originalRebuild = index.filenameTier.rebuild.bind(index.filenameTier);
  let rebuildCount = 0;
  index.filenameTier.rebuild = () => {
    rebuildCount += 1;
    originalRebuild();
  };
  const stable = initial.slice(0, 20).map((entry) => ({ ...entry, unchanged: true }));
  const changed = initial.slice(20, 40).map((entry) => ({
    ...entry,
    modifiedMs: entry.modifiedMs + 100
  }));
  const missing = Array.from({ length: 20 }, (_, item) => ({
    relativePath: `missing-${String(item).padStart(2, '0')}.bin`,
    mediaType: 'unknown',
    contentIndexed: false,
    originalContent: '',
    size: item,
    modifiedMs: item
  }));
  const outcome = await index.reconcile([...stable, ...changed, ...missing], identity);

  const expectedPaths = [...stable, ...changed, ...missing]
    .map(({ relativePath }) => relativePath)
    .sort();
  const estimatedBytes = expectedPaths.reduce(
    (total, relativePath) => total + 64 + 2 * (relativePath.length * 4 + 'unknown'.length),
    0
  );
  assert.equal(rebuildCount, 1);
  assert.deepEqual(
    index.filenameTier.visible().map(({ relativePath }) => relativePath),
    expectedPaths
  );
  assert.deepEqual(index.filenameTier.statistics(), {
    recordCount: 60,
    visibleRecordCount: 60,
    estimatedBytes
  });
  assert.equal(index.filenameTier.get('existing-20.bin').modifiedMs, 120);
  assert.equal(index.filenameTier.get('existing-40.bin'), undefined);
  assert.equal(index.filenameTier.get('missing-00.bin').modifiedMs, 0);
  assert.equal(outcome.changedFileCount, 40);
  assert.equal(outcome.deletedFileCount, 20);
  assert.equal(index.statistics().buildState.state, 'ready');
  index.close();
});

test('initial traversal emits only empty building and one full ready snapshot', async () => {
  await withTempDirectory(async (temp) => {
    const root = join(temp, 'workspace');
    await mkdir(root);
    const fileCount = 501;
    await Promise.all(
      Array.from({ length: fileCount }, async (_, index) => {
        await writeFile(join(root, `bulk-${String(index).padStart(3, '0')}.bin`), '');
      })
    );
    const snapshots = [];
    const engine = createOnlyPreviewSearchEngine({
      onSnapshot: (snapshot) => snapshots.push(snapshot)
    });
    await engine.initialize({
      workspaceId: 'workspace',
      generation: 1,
      rootPath: root,
      databasePath: join(temp, 'cache', 'search.sqlite')
    });
    assert.deepEqual(
      snapshots.map(({ state }) => state),
      ['building', 'ready']
    );
    assert.deepEqual(
      snapshots.map(({ index }) => index.entries.length),
      [0, fileCount]
    );
    await engine.shutdown();
  });
});

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
    assert.equal(
      (await search(engine, 1, 'stable', 'original committed content 0')).results.length,
      1
    );
    assert.equal(
      (await search(engine, 1, 'changed', 'changed content recovered exactly')).results.length,
      1
    );
    assert.equal(
      (await search(engine, 1, 'pending', 'original committed content 11')).results.length,
      1
    );
    assert.equal(
      (await search(engine, 1, 'new', 'new content recovered exactly')).results.length,
      1
    );
    assert.equal(
      (await search(engine, 1, 'stale', 'original committed content 8')).results.length,
      0
    );
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
    assert.equal((await search(engine, 3, 'watch-new', 'new value')).results.length, 1);

    await unlink(join(root, 'selected.txt'));
    await engine.enqueue(
      async () =>
        await engine.applyWatchChangesInternal({
          full: false,
          paths: ['selected.txt']
        })
    );
    assert.equal((await search(engine, 3, 'watch-deleted', 'selected')).results.length, 0);

    await write(join(root, 'selected.txt'), 'recreated value');
    await engine.enqueue(
      async () =>
        await engine.applyWatchChangesInternal({
          full: false,
          paths: ['selected.txt']
        })
    );
    assert.equal((await search(engine, 3, 'watch-recreated', 'recreated value')).results.length, 1);

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

    assert.equal((await search(engine, 1, 'active-during-build', 'base query')).results.length, 1);
    assert.equal(
      (await search(engine, 1, 'candidate-hidden', 'candidate-only searchable value')).results
        .length,
      0,
      'completed candidate rows remain invisible before atomic promotion'
    );
    assert.deepEqual(
      [...new Set(progress.map(({ phase }) => phase))],
      ['counting', 'indexing']
    );

    releasePromotion();
    await refresh;
    assert.equal(
      (await search(engine, 1, 'candidate-promoted', 'candidate-only searchable value')).results
        .length,
      1
    );
    await engine.shutdown();
  });
});
