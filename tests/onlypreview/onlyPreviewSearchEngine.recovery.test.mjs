/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createOnlyPreviewSearchEngine } from '../../src/preload/onlypreview/search/core/search-engine.mjs';
import { OnlyPreviewSqliteIndex } from '../../src/preload/onlypreview/search/core/sqlite-index.mjs';

const withTempDirectory = async (callback) => {
  const path = await mkdtemp(join(tmpdir(), 'onlypreview-search-recovery-'));
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

const deferred = () => {
  let resolve;
  const promise = new Promise((resolveValue) => {
    resolve = resolveValue;
  });
  return { promise, resolve };
};

test('opening an unsupported legacy schema rebuilds it transactionally as empty v8 state', async () => {
  await withTempDirectory(async (temp) => {
    const databasePath = join(temp, 'legacy.sqlite');
    const legacy = new DatabaseSync(databasePath);
    legacy.exec(`
      CREATE TABLE files (
        id INTEGER PRIMARY KEY,
        relative_path TEXT NOT NULL UNIQUE,
        legacy_payload TEXT NOT NULL
      );
      INSERT INTO files(relative_path, legacy_payload) VALUES ('legacy.txt', 'legacy');
      PRAGMA user_version = 6;
    `);
    legacy.close();

    const index = new OnlyPreviewSqliteIndex(databasePath);
    assert.deepEqual(index.schema, {
      previousVersion: 6,
      schemaVersion: 8,
      rebuilt: true
    });
    assert.equal(index.database.prepare('PRAGMA user_version').get().user_version, 8);
    assert.equal(index.database.prepare('SELECT COUNT(*) AS count FROM files').get().count, 0);
    assert.equal(index.statistics().buildState.state, 'missing');
    assert.equal(
      index.database
        .prepare(
          `
      SELECT COUNT(*) AS count FROM pragma_table_info('files') WHERE name = 'in_project'
    `
        )
        .get().count,
      1
    );
    index.close();
  });
});

test('opening malformed schema-8 search_tree rebuilds an exact usable tree schema', async () => {
  await withTempDirectory(async (temp) => {
    const databasePath = join(temp, 'malformed-tree.sqlite');
    const seeded = new OnlyPreviewSqliteIndex(databasePath);
    seeded.close();
    const malformed = new DatabaseSync(databasePath);
    malformed.exec(`
      DROP TABLE search_tree;
      CREATE TABLE search_tree(relative_path TEXT PRIMARY KEY, wrong_column TEXT);
    `);
    malformed.close();

    const recovered = new OnlyPreviewSqliteIndex(databasePath);
    assert.equal(recovered.schema.rebuilt, true);
    assert.deepEqual(
      recovered.database
        .prepare("PRAGMA table_info('search_tree')")
        .all()
        .map(({ name }) => name),
      [
        'relative_path',
        'parent_relative_path',
        'name',
        'node_kind',
        'size',
        'modified_ms',
        'preview_hint',
        'media_type',
        'is_text'
      ]
    );
    recovered.close();
  });
});

test('schema configuration failure closes its DatabaseSync handle', async () => {
  await withTempDirectory(async (temp) => {
    const databasePath = join(temp, 'tree-view.sqlite');
    const seeded = new OnlyPreviewSqliteIndex(databasePath);
    seeded.close();
    const malformed = new DatabaseSync(databasePath);
    malformed.exec(`
      DROP TABLE search_tree;
      CREATE VIEW search_tree AS SELECT relative_path FROM files;
    `);
    malformed.close();
    const descriptorsBefore = (await readdir('/dev/fd')).length;
    for (let attempt = 0; attempt < 64; attempt += 1) {
      assert.throws(() => new OnlyPreviewSqliteIndex(databasePath), /search_tree|view/u);
    }
    const descriptorsAfter = (await readdir('/dev/fd')).length;
    assert.equal(
      descriptorsAfter <= descriptorsBefore + 3,
      true,
      `failed SQLite opens leaked descriptors: ${descriptorsBefore} -> ${descriptorsAfter}`
    );
    const exclusive = new DatabaseSync(databasePath);
    exclusive.exec('BEGIN EXCLUSIVE; ROLLBACK;');
    exclusive.close();
  });
});

test('schema 7 upgrades additively and warms files and Contents before rebuilding its tree tier', async () => {
  await withTempDirectory(async (temp) => {
    const rootPath = join(temp, 'workspace');
    const databasePath = join(temp, 'cache', 'search.sqlite');
    await write(
      join(rootPath, '.bitterless', 'preview-config.yml'),
      "version: 1\nexclude:\n  - legacy/**\n  - '!legacy/legacy-folder/**'\n"
    );
    await write(
      join(rootPath, 'legacy', 'legacy-folder', 'legacy-file.txt'),
      'legacy searchable body'
    );
    await write(
      join(rootPath, 'legacy', 'legacy-folder', 'legacy-deleted', 'legacy-deleted.txt'),
      'legacy deleted searchable body'
    );
    await mkdir(join(rootPath, 'empty-folder-only'));
    await symlink('legacy/legacy-folder/legacy-file.txt', join(rootPath, 'legacy-link'));
    const seededEngine = createOnlyPreviewSearchEngine();
    await seededEngine.initialize({
      workspaceId: 'seed-workspace',
      generation: 1,
      rootPath,
      databasePath
    });
    await seededEngine.shutdown();
    await rm(join(rootPath, 'legacy', 'legacy-folder', 'legacy-deleted'), {
      recursive: true,
      force: true
    });

    const legacy = new DatabaseSync(databasePath);
    const beforeCounts = {
      files: legacy.prepare('SELECT COUNT(*) AS count FROM files').get().count,
      chunks: legacy.prepare('SELECT COUNT(*) AS count FROM chunks').get().count,
      fts: legacy.prepare('SELECT COUNT(*) AS count FROM chunk_fts').get().count
    };
    legacy.exec(`
      INSERT OR REPLACE INTO search_tree(
        relative_path, parent_relative_path, name, node_kind, size, modified_ms,
        preview_hint, media_type, is_text
      ) VALUES ('stale-folder', '', 'stale-folder', 'directory', 0, 0,
        'unsupported', 'unknown', 0);
      INSERT OR REPLACE INTO index_meta(key, value) VALUES ('tree_stale_marker', 'stale');
      PRAGMA user_version = 7;
    `);
    legacy.close();

    const migrated = new OnlyPreviewSqliteIndex(databasePath);
    assert.deepEqual(migrated.schema, {
      previousVersion: 7,
      schemaVersion: 8,
      rebuilt: false
    });
    assert.deepEqual(
      {
        files: migrated.database.prepare('SELECT COUNT(*) AS count FROM files').get().count,
        chunks: migrated.database.prepare('SELECT COUNT(*) AS count FROM chunks').get().count,
        fts: migrated.database.prepare('SELECT COUNT(*) AS count FROM chunk_fts').get().count
      },
      beforeCounts
    );
    assert.equal(
      migrated.database.prepare('SELECT COUNT(*) AS count FROM search_tree').get().count,
      0
    );
    assert.equal(
      migrated.database
        .prepare("SELECT COUNT(*) AS count FROM index_meta WHERE key LIKE 'tree_%'")
        .get().count,
      0
    );
    const migratedTree = migrated.readTreeSnapshot();
    assert.equal(migratedTree.treeMetadataReady, false);
    assert.deepEqual(
      migratedTree.entries.map(({ relativePath, nodeKind }) => [relativePath, nodeKind]),
      [
        ['legacy', 'directory'],
        ['legacy/legacy-folder', 'directory'],
        ['legacy/legacy-folder/legacy-deleted', 'directory'],
        ['legacy/legacy-folder/legacy-deleted/legacy-deleted.txt', 'file'],
        ['legacy/legacy-folder/legacy-file.txt', 'file']
      ]
    );
    assert.equal(
      migratedTree.entries.some(({ relativePath }) => relativePath === 'empty-folder-only'),
      false
    );
    assert.equal(
      migratedTree.entries.some(({ relativePath }) => relativePath === 'legacy-link'),
      false
    );
    assert.equal(
      (
        await migrated.searchContents('legacy searchable', {
          maxResults: 10,
          scope: { kind: 'project' }
        })
      ).results.length,
      1
    );
    migrated.close();

    const engine = createOnlyPreviewSearchEngine();
    const candidateReady = deferred();
    const allowPromotion = deferred();
    const promote = engine.promoteCandidate.bind(engine);
    engine.promoteCandidate = async (...args) => {
      candidateReady.resolve();
      await allowPromotion.promise;
      return await promote(...args);
    };
    let initialize;
    let searching;
    try {
      initialize = engine.initialize({
        workspaceId: 'workspace',
        generation: 2,
        rootPath,
        databasePath
      });
      await candidateReady.promise;
      assert.equal(engine.treeMetadataReady, false);
      assert.equal(
        engine.treeEntries.some(({ nodeKind }) => nodeKind === 'directory'),
        true
      );
      assert.equal(
        engine.treeEntries.some(({ relativePath }) => relativePath === 'legacy'),
        false
      );
      assert.equal(
        engine.treeEntries.some(({ relativePath }) => relativePath === 'legacy/legacy-folder'),
        true
      );
      const firstWarmFiles = deferred();
      const firstWarmContents = deferred();
      let settled = false;
      const warmResults = [];
      searching = engine
        .search({
          workspaceId: 'workspace',
          generation: 2,
          requestId: 'migrated-warm-search',
          query: 'legacy',
          maxResults: 10,
          scope: { kind: 'project' },
          isCancelled: () => false,
          onResult: (result) => {
            warmResults.push(result);
            if (result.section === 'files') firstWarmFiles.resolve();
            if (result.section === 'contents') firstWarmContents.resolve();
          }
        })
        .finally(() => {
          settled = true;
        });
      await Promise.all([firstWarmFiles.promise, firstWarmContents.promise]);
      assert.equal(settled, false);
      assert.equal(
        warmResults.some(
          ({ section, relativePath }) =>
            section === 'files' && relativePath === 'legacy/legacy-folder'
        ),
        true
      );
      assert.equal(
        warmResults.some(
          ({ section, relativePath }) =>
            section === 'files' && relativePath === 'legacy'
        ),
        false
      );
      assert.equal(
        warmResults.some(
          ({ section, relativePath }) =>
            section === 'contents' && relativePath === 'legacy/legacy-folder/legacy-file.txt'
        ),
        true
      );
      const deletedDirectoryToken = warmResults.find(
        ({ section, relativePath }) =>
          section === 'files' && relativePath === 'legacy/legacy-folder/legacy-deleted'
      )?.resultToken;
      assert.equal(typeof deletedDirectoryToken, 'string');
      allowPromotion.resolve();
      await initialize;
      const terminal = await searching;
      assert.deepEqual(terminal.files.map(({ relativePath }) => relativePath), [
        'legacy/legacy-folder',
        'legacy/legacy-folder/legacy-file.txt'
      ]);
      await assert.rejects(() =>
        engine.preview({
          workspaceId: 'workspace',
          generation: 2,
          requestId: 'migrated-warm-search',
          resultToken: deletedDirectoryToken,
          isCancelled: () => false
        })
      );
    } finally {
      allowPromotion.resolve();
      await Promise.allSettled([initialize, searching].filter(Boolean));
      await engine.shutdown();
    }

    const restored = new OnlyPreviewSqliteIndex(databasePath);
    assert.equal(restored.readTreeSnapshot().treeMetadataReady, true);
    assert.equal(
      restored
        .readTreeSnapshot()
        .entries.some(
          ({ relativePath, nodeKind }) =>
            relativePath === 'legacy/legacy-folder' && nodeKind === 'directory'
        ),
      true
    );
    restored.database
      .prepare("UPDATE index_meta SET value = 'mismatched-build' WHERE key = 'tree_build_id'")
      .run();
    restored.close();
    const mismatched = new OnlyPreviewSqliteIndex(databasePath);
    const failedClosedTree = mismatched.readTreeSnapshot();
    assert.equal(failedClosedTree.treeMetadataReady, false);
    assert.equal(
      failedClosedTree.entries.some(
        ({ relativePath, nodeKind }) =>
          relativePath === 'legacy/legacy-folder' && nodeKind === 'directory'
      ),
      true
    );
    const buildId = mismatched.buildState.read().buildId;
    mismatched.database
      .prepare("UPDATE index_meta SET value = ? WHERE key = 'tree_build_id'")
      .run(buildId);
    mismatched.database
      .prepare("DELETE FROM index_meta WHERE key = 'tree_max_depth_reached'")
      .run();
    assert.equal(mismatched.readTreeSnapshot().treeMetadataReady, false);
    mismatched.database
      .prepare("INSERT INTO index_meta(key, value) VALUES ('tree_max_depth_reached', 'invalid')")
      .run();
    assert.equal(mismatched.readTreeSnapshot().treeMetadataReady, false);
    mismatched.close();
  });
});

test('a file-to-directory race promotes the watch hint to a full reconcile', async () => {
  await withTempDirectory(async (temp) => {
    const rootPath = join(temp, 'workspace');
    await write(join(rootPath, 'selected.txt'), 'retained searchable value');
    const commits = [];
    const engine = createOnlyPreviewSearchEngine({
      onWatchCommit: (commit) => commits.push(commit),
      readWorkspaceFile: async () => undefined
    });
    await engine.initialize({
      workspaceId: 'workspace',
      generation: 1,
      rootPath,
      databasePath: join(temp, 'cache', 'search.sqlite')
    });
    await engine.watchController.close({ drain: false });
    engine.watchController = undefined;
    engine.watchRevision += 1;

    await engine.enqueue(
      async () =>
        await engine.applyWatchChangesInternal({
          full: false,
          paths: ['selected.txt']
        })
    );
    assert.deepEqual(commits, [
      {
        workspaceId: 'workspace',
        generation: 1,
        revision: 1,
        full: true,
        changedRelativePaths: []
      }
    ]);
    const result = await engine.search({
      workspaceId: 'workspace',
      generation: 1,
      requestId: 'after-race-reconcile',
      query: 'retained searchable value',
      maxResults: 10,
      scope: { kind: 'project' }
    });
    assert.equal(result.contents.length, 1);
    await engine.shutdown();
  });
});

test('candidate failure and cancellation preserve the active index and remove artifacts', async () => {
  await withTempDirectory(async (temp) => {
    const rootPath = join(temp, 'workspace');
    const cachePath = join(temp, 'cache');
    const databasePath = join(cachePath, 'search.sqlite');
    await write(join(rootPath, 'active.txt'), 'stable active value');
    const engine = createOnlyPreviewSearchEngine();
    await engine.initialize({
      workspaceId: 'workspace',
      generation: 1,
      rootPath,
      databasePath
    });
    const activeConfigHash = engine.config.hash;
    const activeIdentity = engine.identity;
    await write(
      join(rootPath, '.bitterless', 'preview-config.yml'),
      'version: 1\nexclude:\n  - active.txt\n'
    );

    const originalRunTraversal = engine.runTraversal.bind(engine);
    engine.runTraversal = async () => {
      throw new Error('candidate build failed');
    };
    await assert.rejects(
      engine.refresh({ workspaceId: 'workspace', generation: 1 }),
      /candidate build failed/u
    );
    assert.equal(engine.config.hash, activeConfigHash);
    assert.equal(engine.identity, activeIdentity);
    assert.equal(engine.searchPolicy.isExcludedFilePath('active.txt'), false);
    assert.equal(
      (
        await engine.search({
          workspaceId: 'workspace',
          generation: 1,
          requestId: 'after-failure',
          query: 'stable active value',
          maxResults: 10,
          scope: { kind: 'project' }
        })
      ).contents.length,
      1
    );
    assert.equal((await readdir(cachePath)).some((name) => name.includes('.candidate-')), false);

    engine.runTraversal = async (...args) => {
      engine.cancelBuild();
      return await originalRunTraversal(...args);
    };
    await assert.rejects(
      engine.refresh({ workspaceId: 'workspace', generation: 1 }),
      (error) => error?.code === 'CANCELLED'
    );
    assert.equal(
      (
        await engine.search({
          workspaceId: 'workspace',
          generation: 1,
          requestId: 'after-cancel',
          query: 'stable active value',
          maxResults: 10,
          scope: { kind: 'project' }
        })
      ).contents.length,
      1
    );
    assert.equal((await readdir(cachePath)).some((name) => name.includes('.candidate-')), false);

    engine.runTraversal = originalRunTraversal;
    const originalPromoteCandidate = engine.promoteCandidate.bind(engine);
    engine.promoteCandidate = async (candidate, ...args) => {
      candidate.invalidateTreeSnapshot();
      return await originalPromoteCandidate(candidate, ...args);
    };
    await assert.rejects(
      engine.refresh({ workspaceId: 'workspace', generation: 1 }),
      /Promoted Search tree snapshot is not ready/u
    );
    assert.equal(engine.searchPolicy.isExcludedFilePath('active.txt'), false);
    assert.equal(
      (
        await engine.search({
          workspaceId: 'workspace',
          generation: 1,
          requestId: 'after-promotion-validation-failure',
          query: 'stable active value',
          maxResults: 10,
          scope: { kind: 'project' }
        })
      ).contents.length,
      1
    );
    assert.equal((await readdir(cachePath)).some((name) => name.includes('.previous-')), false);
    await engine.shutdown();
  });
});

test('initialization reclaims only exact interrupted artifacts for its database basename', async () => {
  await withTempDirectory(async (temp) => {
    const rootPath = join(temp, 'workspace');
    const cachePath = join(temp, 'cache');
    const databasePath = join(cachePath, 'search.sqlite');
    await write(join(rootPath, 'active.txt'), 'preserved active search value');
    const seededEngine = createOnlyPreviewSearchEngine();
    await seededEngine.initialize({
      workspaceId: 'seed-workspace',
      generation: 1,
      rootPath,
      databasePath
    });
    await seededEngine.shutdown();

    const candidateId = '11111111-2222-4333-8444-555555555555';
    const previousId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const reclaimed = [
      `search.sqlite.candidate-${candidateId}`,
      `search.sqlite.candidate-${candidateId}-wal`,
      `search.sqlite.candidate-${candidateId}-shm`,
      `search.sqlite.previous-${previousId}`,
      `search.sqlite.previous-${previousId}-wal`,
      `search.sqlite.previous-${previousId}-shm`
    ];
    const preserved = [
      `other.sqlite.candidate-${candidateId}`,
      `other.sqlite.candidate-${candidateId}-wal`,
      `search.sqlite.candidate-not-a-uuid`,
      `search.sqlite.previous-${previousId}.extra`
    ];
    for (const name of [...reclaimed, ...preserved]) {
      await write(join(cachePath, name), 'artifact sentinel');
    }

    const engine = createOnlyPreviewSearchEngine();
    await engine.initialize({
      workspaceId: 'workspace',
      generation: 2,
      rootPath,
      databasePath
    });
    const remaining = new Set(await readdir(cachePath));
    for (const name of reclaimed) assert.equal(remaining.has(name), false, name);
    for (const name of preserved) assert.equal(remaining.has(name), true, name);
    assert.equal(
      (
        await engine.search({
          workspaceId: 'workspace',
          generation: 2,
          requestId: 'artifact-active-index',
          query: 'preserved active search value',
          maxResults: 10,
          scope: { kind: 'project' }
        })
      ).contents.length,
      1
    );
    await engine.shutdown();
  });
});

test('bounded watch invalidates before mutation failure and restores a matching tree marker on success', async () => {
  await withTempDirectory(async (temp) => {
    const rootPath = join(temp, 'workspace');
    const databasePath = join(temp, 'cache', 'search.sqlite');
    await write(join(rootPath, 'folder', 'watched.txt'), 'watch value one');
    let engine = createOnlyPreviewSearchEngine();
    await engine.initialize({
      workspaceId: 'workspace',
      generation: 1,
      rootPath,
      databasePath
    });
    await engine.watchController.close({ drain: false });
    engine.watchController = undefined;
    engine.watchRevision += 1;
    await write(join(rootPath, 'folder', 'watched.txt'), 'watch value two');
    const applyTreeSnapshotMutations = engine.index.applyTreeSnapshotMutations.bind(engine.index);
    engine.index.applyTreeSnapshotMutations = () => {
      throw new Error('interrupted tree commit');
    };
    await assert.rejects(
      engine.enqueue(
        async () =>
          await engine.applyWatchChangesInternal({
            full: false,
            paths: ['folder/watched.txt']
          })
      ),
      /interrupted tree commit/u
    );
    assert.equal(engine.index.readTreeSnapshot().treeMetadataReady, false);
    assert.equal(engine.treeMetadataReady, false);
    assert.equal(
      engine.treeEntries.some(
        ({ relativePath, nodeKind }) => relativePath === 'folder' && nodeKind === 'directory'
      ),
      true
    );
    assert.equal(
      (
        await engine.search({
          workspaceId: 'workspace',
          generation: 1,
          requestId: 'after-interrupted-watch',
          query: 'watch value two',
          maxResults: 10,
          scope: { kind: 'project' }
        })
      ).contents.length,
      1
    );
    await write(join(rootPath, 'folder', 'watched.txt'), 'watch value three');
    let fullReconcileCount = 0;
    const refreshFromWatchInternal = engine.refreshFromWatchInternal.bind(engine);
    engine.refreshFromWatchInternal = async () => {
      fullReconcileCount += 1;
      return await refreshFromWatchInternal();
    };
    await engine.enqueue(
      async () =>
        await engine.applyWatchChangesInternal({
          full: false,
          paths: ['folder/watched.txt']
        })
    );
    assert.equal(fullReconcileCount, 1);
    assert.notEqual(
      engine.index.applyTreeSnapshotMutations,
      applyTreeSnapshotMutations,
      'full promotion must replace the interrupted active index'
    );
    assert.equal(engine.index.filenameTier.get('folder/watched.txt')?.contentIndexed, true);
    const successfulTree = engine.index.readTreeSnapshot();
    assert.equal(successfulTree.treeMetadataReady, true);
    assert.equal(successfulTree.buildId, engine.index.buildState.read().buildId);
    await engine.shutdown();

    const reopened = new OnlyPreviewSqliteIndex(databasePath);
    assert.equal(reopened.readTreeSnapshot().treeMetadataReady, true);
    reopened.close();
  });
});
