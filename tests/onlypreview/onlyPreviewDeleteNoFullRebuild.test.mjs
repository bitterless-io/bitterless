/* eslint-disable @typescript-eslint/explicit-function-return-type */
//
// 删一个文件不该再附赠一轮全量重建。
//
// macOS 上 `fs.watch` 把删除报成 `rename`,而 reconciler 原来对「路径已不在盘上 + 带 rename
// 提示」的判定是直接升级成整库重建。于是每一批删除后面都跟着一轮完整的
// candidate-plan → traversal-index → promotion-commit —— 而那一轮拿不到任何新信息:
// `finishDeleteTask` 的 `forgetPaths` 已经把这些行连同子孙精确清掉了。它唯一的实际效果是把
// 索引写队列占住 10–13 秒,让下一次删除、下一次打开项目去等它。
// 见 docs/issues/onlypreview-delete-waits-behind-index-rebuilds.md。
//
// 这里交给引擎的,就是控制器对一个 rename 事件真正会派发的那份载荷
// (`{ full: false, paths: [x], renamePaths: [x] }` + 增量派发带的 `deferRebuild`)。
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { createOnlyPreviewSearchEngine } from '../../src/preload/onlypreview/search/core/search-engine.mjs';
import { REBUILD_REQUIRED } from '../../src/preload/onlypreview/search/core/watch-reconciler.mjs';

const withWorkspace = async (callback) => {
  const temp = await mkdtemp(join(tmpdir(), 'onlypreview-delete-no-rebuild-'));
  const workspace = join(temp, 'workspace');
  const indexDirectory = join(temp, 'index');
  await mkdir(join(workspace, 'nested'), { recursive: true });
  await mkdir(indexDirectory, { recursive: true });
  // 两个都含同一个词,便于用一次搜索同时观察"删了的"和"没删的"。
  await writeFile(join(workspace, 'keep.txt'), 'zebracode stays put');
  await writeFile(join(workspace, 'nested', 'doomed.txt'), 'zebracode is about to go');
  try {
    return await callback({
      workspace,
      databasePath: join(indexDirectory, 'index.sqlite')
    });
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
};

const searchPaths = async (engine, query) => {
  const found = [];
  await engine.search({
    workspaceId: 'workspace',
    generation: 1,
    requestId: `q-${query}-${found.length}`,
    query,
    maxResults: 100,
    scope: { kind: 'project' },
    cancelBuffer: new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT),
    onResult: (result) => found.push(result.relativePath)
  });
  return [...new Set(found)].sort();
};

// 控制器由测试自己扮演,所以把真的那个关掉 —— 否则它会在背后再派发一轮,断言就看不清是谁发的。
const detachWatchController = async (engine) => {
  await engine.watchController.close({ drain: false });
  engine.watchController = undefined;
  engine.watchRevision += 1;
};

// 控制器对一个 rename 事件派发的就是这一份:增量、带 rename 提示、允许交还重建。
const dispatchRenameHint = async (engine, relativePath) =>
  await engine.enqueue(
    async () =>
      await engine.applyWatchChangesInternal(
        { full: false, paths: [relativePath], renamePaths: [relativePath] },
        { deferRebuild: true }
      )
  );

test('a delete through the engine contract reconciles incrementally', async () => {
  await withWorkspace(async ({ workspace, databasePath }) => {
    const commits = [];
    const engine = createOnlyPreviewSearchEngine({
      onWatchCommit: (commit) => commits.push(commit)
    });
    try {
      await engine.initialize({
        workspaceId: 'workspace',
        generation: 1,
        rootPath: workspace,
        databasePath
      });
      await detachWatchController(engine);
      assert.deepEqual(
        await searchPaths(engine, 'zebracode'),
        ['keep.txt', 'nested/doomed.txt'],
        'the fixture must be fully indexed before the delete'
      );

      // 引擎层的删除契约:开任务 → 删文件 → 收尾清索引。
      const { taskId } = await engine.beginDeleteTask({
        workspaceId: 'workspace',
        generation: 1,
        relativePaths: ['nested/doomed.txt']
      });
      await rm(join(workspace, 'nested', 'doomed.txt'), { force: true });
      await engine.finishDeleteTask({
        workspaceId: 'workspace',
        generation: 1,
        taskId,
        removedPaths: ['nested/doomed.txt']
      });

      // 现在才轮到 watcher:它对这一次删除看到的是一个 rename 事件。
      assert.deepEqual(commits, [], 'nothing should have committed before the watcher dispatch');
      const outcome = await dispatchRenameHint(engine, 'nested/doomed.txt');

      assert.notEqual(
        outcome,
        REBUILD_REQUIRED,
        'a vanished regular file must not ask for a rebuild'
      );
      assert.equal(
        commits.some((commit) => commit.full === true),
        false,
        'a vanished regular file must not commit a full rebuild either'
      );
      assert.deepEqual(
        await searchPaths(engine, 'zebracode'),
        ['keep.txt'],
        'deleted content is still searchable'
      );
    } finally {
      await engine.shutdown();
    }
  });
});

test('an external delete without the delete contract also reconciles incrementally', async () => {
  // 这一格里树还认得这个路径(没人调用过 `forgetPaths`):终端里的 `rm`、`git checkout` 带走
  // 一个文件、编辑器保存时的临时文件,走的都是这条。它在树里是**普通文件**,所以照样走增量。
  await withWorkspace(async ({ workspace, databasePath }) => {
    const commits = [];
    const engine = createOnlyPreviewSearchEngine({
      onWatchCommit: (commit) => commits.push(commit)
    });
    try {
      await engine.initialize({
        workspaceId: 'workspace',
        generation: 1,
        rootPath: workspace,
        databasePath
      });
      await detachWatchController(engine);
      assert.deepEqual(await searchPaths(engine, 'zebracode'), ['keep.txt', 'nested/doomed.txt']);

      await rm(join(workspace, 'nested', 'doomed.txt'), { force: true });
      const outcome = await dispatchRenameHint(engine, 'nested/doomed.txt');

      assert.notEqual(outcome, REBUILD_REQUIRED, 'an external delete must not ask for a rebuild');
      assert.equal(
        commits.some((commit) => commit.full === true),
        false,
        'an external delete must not commit a full rebuild either'
      );
      assert.deepEqual(
        await searchPaths(engine, 'zebracode'),
        ['keep.txt'],
        'the externally deleted file is still searchable'
      );
    } finally {
      await engine.shutdown();
    }
  });
});
