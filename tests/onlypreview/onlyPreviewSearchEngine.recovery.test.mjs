/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
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

test('opening a legacy schema rebuilds it transactionally as empty v7 state', async () => {
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
      schemaVersion: 7,
      rebuilt: true
    });
    assert.equal(index.database.prepare('PRAGMA user_version').get().user_version, 7);
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
    assert.equal(result.results.length, 1);
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
      ).results.length,
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
      ).results.length,
      1
    );
    assert.equal((await readdir(cachePath)).some((name) => name.includes('.candidate-')), false);
    await engine.shutdown();
  });
});
