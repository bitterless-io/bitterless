import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, realpath, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createOnlyPreviewSearchEngine } from '../../src/preload/onlypreview/search/core/search-engine.mjs';
import { FilenameTier } from '../../src/preload/onlypreview/search/core/filename-tier.mjs';
import {
  mergeOnlyPreviewTreeEntries,
  selectOnlyPreviewTreeEntries
} from '../../src/preload/onlypreview/search/core/watch-reconciler.mjs';
import { createSearchResultBatcher } from '../../src/preload/onlypreview/search/core/result-batcher.mjs';
import {
  OnlyPreviewSqliteIndex,
  SEARCH_ENGINE_IDENTITY
} from '../../src/preload/onlypreview/search/core/sqlite-index.mjs';
import { createBackgroundWorkSlicer } from '../../src/preload/onlypreview/search/core/work-slicer.mjs';
import { loadOnlyPreviewWorkspaceConfig } from '../../src/preload/onlypreview/search/core/workspace-config.mjs';
import { search, withTempDirectory, write } from './onlyPreviewSearchEngineSqliteTest.helper.mjs';

test('large incremental filename and tree merges retain every row without argument overflow', () => {
  const count = 130_000;
  const records = Array.from({ length: count }, (_, index) => {
    const relativePath = `files/${String(index).padStart(6, '0')}.txt`;
    return {
      id: index + 1,
      relativePath,
      fileName: relativePath.slice(6),
      normalizedPath: relativePath,
      normalizedTitle: relativePath.slice(6),
      mediaType: 'text',
      contentIndexed: true,
      inProject: true,
      size: 1,
      modifiedMs: 1
    };
  });
  const tier = new FilenameTier();
  tier.replace(records);
  const earlyRecord = {
    ...records[0],
    id: count + 1,
    relativePath: '000-first.txt',
    fileName: '000-first.txt',
    normalizedPath: '000-first.txt',
    normalizedTitle: '000-first.txt',
    size: 2
  };
  tier.applyBatch({
    upserts: [earlyRecord],
    deletePaths: []
  });
  assert.equal(tier.visible().length, count + 1);
  assert.equal(tier.visible()[0].relativePath, earlyRecord.relativePath);
  assert.equal(tier.get(earlyRecord.relativePath), tier.visible()[0]);
  assert.equal(tier.records.size, count + 1);

  const treeEntries = records.map((record) => ({
    relativePath: record.relativePath,
    nodeKind: 'file'
  }));
  const merged = mergeOnlyPreviewTreeEntries(treeEntries, [
    { relativePath: '000-first', nodeKind: 'directory' }
  ]);
  assert.equal(merged.length, count + 1);
  assert.equal(merged[0].relativePath, '000-first');
  assert.equal(merged.filter(({ relativePath }) => relativePath.startsWith('files/')).length, count);
  const selected = selectOnlyPreviewTreeEntries(treeEntries, new Set(['files/000001.txt']));
  assert.equal(selected.size, 1);
  assert.equal(selected.get('files/000001.txt'), treeEntries[1]);
});

test('SQLite v8 vertical covers all query paths, exact rows, batches, and title-only files', async () => {
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
      assert.equal(response.contents.length > 0, true, query);
      assert.equal(
        response.contents.some(({ contentMatch }) => contentMatch !== null),
        true,
        query
      );
    }

    const folder = await search(engine, 1, 'folder', 'folder-match');
    assert.equal(folder.contents.length, 0);
    assert.deepEqual(folder.files.map(({ relativePath }) => relativePath), ['folder-match']);
    const pdf = await search(engine, 1, 'pdf', 'titleonly');
    assert.equal(pdf.files[0].mediaType, 'pdf');
    assert.equal((await search(engine, 1, 'secret-body', 'TOP_SECRET_CONTENT')).contents.length, 0);
    const sensitiveTitle = await search(engine, 1, 'secret-title', '.env.secret');
    assert.equal(sensitiveTitle.files[0].mediaType, 'text');

    const limited = await search(engine, 1, 'limited', 'batchhit', 2);
    assert.equal(limited.files.length, 2);
    assert.equal(limited.filesTruncated, true);

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
    assert.equal(batches.flat().length, streamed.files.length);
    assert.deepEqual(
      batches.flat().map(({ relativePath }) => relativePath),
      streamed.files.map(({ relativePath }) => relativePath)
    );

    assert.equal(engine.index.database.prepare('PRAGMA user_version').get().user_version, 8);
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
    assert.equal((await search(engine, 2, 'changed', 'searchable')).contents.length, 1);
    await unlink(join(root, 'mutable.txt'));
    await engine.refresh({ workspaceId: 'workspace', generation: 2 });
    const deleted = await search(engine, 2, 'deleted', 'mutable');
    assert.equal(deleted.files.length + deleted.contents.length, 0);
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
    assert.equal((await search(engine, 3, 'actual', 'actual rebuild')).contents.length, 1);
    const partial = await search(engine, 3, 'partial', 'partial');
    assert.equal(partial.files.length + partial.contents.length, 0);
    await engine.shutdown();
  });
});

test('the tolerant extension classifier identity invalidates and rebuilds an older ready index', async () => {
  await withTempDirectory(async (temp) => {
    const root = join(temp, 'workspace');
    const databasePath = join(temp, 'cache', 'search.sqlite');
    await mkdir(root);
    await mkdir(dirname(databasePath), { recursive: true });
    await write(join(root, 'current.markdown'), 'current tolerant body');
    const rootRealPath = await realpath(root);
    const config = await loadOnlyPreviewWorkspaceConfig(rootRealPath);
    const previous = new OnlyPreviewSqliteIndex(databasePath);
    await previous.rebuild(
      [
        {
          relativePath: 'stale.txt',
          mediaType: 'text',
          contentIndexed: true,
          originalContent: 'retired classifier row',
          size: 22,
          modifiedMs: 1
        }
      ],
      {
        workspaceHash: createHash('sha256').update(rootRealPath).digest('hex'),
        configHash: config.hash,
        engineHash: createHash('sha256').update('retired-search-classifier').digest('hex')
      }
    );
    previous.close();

    const snapshots = [];
    const engine = createOnlyPreviewSearchEngine({
      onSnapshot: (snapshot) => snapshots.push(snapshot)
    });
    const ready = await engine.initialize({
      workspaceId: 'workspace',
      generation: 1,
      rootPath: root,
      databasePath
    });
    assert.deepEqual(
      snapshots.map(({ state }) => state),
      ['building', 'ready']
    );
    assert.equal(
      ready.index.entries.some(({ relativePath }) => relativePath === 'stale.txt'),
      false
    );
    assert.equal(
      ready.index.entries.some(({ relativePath }) => relativePath === 'current.markdown'),
      true
    );
    assert.equal((await search(engine, 1, 'new-classifier', 'tolerant body')).contents.length, 1);
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

test('initial rebuild finalizes once and incremental filename batches stay sorted', async () => {
  const index = new OnlyPreviewSqliteIndex(':memory:');
  const originalRebuild = index.filenameTier.rebuild.bind(index.filenameTier);
  const originalApplyBatch = index.filenameTier.applyBatch.bind(index.filenameTier);
  let rebuildCount = 0;
  let batchCount = 0;
  index.filenameTier.rebuild = () => {
    rebuildCount += 1;
    originalRebuild();
  };
  index.filenameTier.applyBatch = (...args) => {
    batchCount += 1;
    return originalApplyBatch(...args);
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
  assert.equal(rebuildCount, 1);
  assert.equal(batchCount, 1);
  assert.equal(index.filenameTier.visible()[0].relativePath, 'aaa-first.bin');
  assert.equal(index.delete('aaa-first.bin'), true);
  assert.equal(rebuildCount, 1);
  assert.equal(batchCount, 2);
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
  const initial = Array.from({ length: 240 }, (_, item) => ({
    relativePath: `existing-${String(item).padStart(3, '0')}.bin`,
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
  const runMutation = index.runMutation.bind(index);
  let transactionCount = 0;
  index.runMutation = (operation, withinTransaction) => {
    if (!withinTransaction) transactionCount += 1;
    return runMutation(operation, withinTransaction);
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
  assert.equal(index.filenameTier.get('existing-020.bin').modifiedMs, 120);
  assert.equal(index.filenameTier.get('existing-040.bin'), undefined);
  assert.equal(index.filenameTier.get('missing-00.bin').modifiedMs, 0);
  assert.equal(transactionCount, 24, '40 upserts and 200 stale deletes use 24 batch transactions');
  assert.equal(outcome.changedFileCount, 40);
  assert.equal(outcome.deletedFileCount, 200);
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
