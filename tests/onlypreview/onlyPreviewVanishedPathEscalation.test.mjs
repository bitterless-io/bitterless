/* eslint-disable @typescript-eslint/explicit-function-return-type */
//
// 消失的路径:什么时候可以走增量 remove,什么时候必须交回整库重建。
//
// 背景:macOS 上 `fs.watch` 把每一个事件都报成 `rename`,所以「路径没了 + 带 rename 提示」曾经
// 无条件升级成整库重建 —— 每删一个文件都附赠一轮全量(真机 10–13 秒)。去掉那个条件之后,
// 判据变成「它名下还有没有索引行」,这份用例钉的就是这条判据的两端:
//
//   · 删除清理过的路径(树里查不到、索引里也没有)→ 增量,不重建。
//   · 排除 + 重新包含 的目录被整体移出工作区(树里查不到、但子孙**还在** `files` 里)→ 必须重建。
//     不重建就会留下「目录从树上没了、内容仍然搜得到」的半删状态 —— 这一条是复核时实测到的回归,
//     见 docs/issues/onlypreview-delete-waits-behind-index-rebuilds.md。
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { createOnlyPreviewSearchEngine } from '../../src/preload/onlypreview/search/core/search-engine.mjs';

const silentDiagnostics = () => {
  let tag = 0;
  return {
    emit: () => undefined,
    now: () => 0,
    elapsed: () => 0,
    nextTag: (prefix = 'v') => `${prefix}${(tag += 1)}`
  };
};

const withWorkspace = async (callback) => {
  const temp = await mkdtemp(join(tmpdir(), 'onlypreview-vanished-'));
  try {
    return await callback({
      temp,
      root: join(temp, 'workspace'),
      outside: join(temp, 'outside'),
      databasePath: join(temp, 'index', 'search.sqlite')
    });
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
};

// 自己驱动 reconciler,不依赖真 watcher 的时序 —— 与 `onlyPreviewSearchEngineWatchBoundary` 同形。
const detachWatcher = async (engine) => {
  await engine.watchController?.close({ drain: false });
  engine.watchController = undefined;
  engine.watchRevision += 1;
};

const searchPaths = async (engine, query) => {
  const found = [];
  await engine.search({
    workspaceId: 'workspace',
    generation: 1,
    requestId: `q-${query}-${Math.random()}`,
    query,
    maxResults: 100,
    scope: { kind: 'project' },
    cancelBuffer: new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT),
    onResult: (result) => found.push(result.relativePath)
  });
  return [...new Set(found)].sort();
};

const indexedPaths = (engine) => [...engine.index.filenameTier.records.keys()].sort();

test('a path the delete already purged stays incremental — no full rebuild', async () => {
  await withWorkspace(async ({ root, databasePath }) => {
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'keep.txt'), 'zebravanish keeps\n');
    await writeFile(join(root, 'gone.txt'), 'zebravanish goes\n');
    const commits = [];
    const engine = createOnlyPreviewSearchEngine({
      diagnostics: silentDiagnostics(),
      onWatchCommit: (commit) => commits.push(commit)
    });
    try {
      await engine.initialize({ workspaceId: 'workspace', generation: 1, rootPath: root, databasePath });
      await detachWatcher(engine);
      // 走完整的删除契约:开任务 → 删文件 → 清索引。
      const { taskId } = await engine.beginDeleteTask({
        workspaceId: 'workspace', generation: 1, relativePaths: ['gone.txt']
      });
      await rm(join(root, 'gone.txt'));
      await engine.finishDeleteTask({
        workspaceId: 'workspace', generation: 1, taskId, removedPaths: ['gone.txt']
      });
      const before = commits.length;
      const outcome = await engine.applyWatchChangesInternal(
        { full: false, paths: ['gone.txt'], renamePaths: ['gone.txt'] },
        { deferRebuild: true }
      );
      assert.notEqual(String(outcome), 'Symbol(onlypreview-watch-rebuild-required)',
        'a path the delete already cleaned must not ask for a rebuild');
      for (const commit of commits.slice(before)) {
        assert.equal(commit.full, false, 'no full watch commit may follow a cleaned delete');
      }
      assert.deepEqual(indexedPaths(engine), ['keep.txt']);
      assert.deepEqual(await searchPaths(engine, 'zebravanish'), ['keep.txt']);
    } finally {
      await engine.shutdown();
    }
  });
});

test('a vanished directory that still owns indexed rows escalates to a full rebuild', async () => {
  await withWorkspace(async ({ root, outside, databasePath }) => {
    // `artifacts` 被排除,所以它不进树;`artifacts/keep/**` 被重新包含,所以它照常进 `files`。
    await mkdir(join(root, '.bitterless'), { recursive: true });
    await mkdir(join(root, 'artifacts', 'keep'), { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(
      join(root, '.bitterless', 'preview-config.yml'),
      'version: 1\nexclude:\n  - "artifacts/**"\n  - "!artifacts/keep/**"\n'
    );
    await writeFile(join(root, 'top.txt'), 'zebravanish top\n');
    await writeFile(join(root, 'artifacts', 'keep', 'kept.txt'), 'zebravanish kept\n');
    const engine = createOnlyPreviewSearchEngine({ diagnostics: silentDiagnostics() });
    try {
      await engine.initialize({ workspaceId: 'workspace', generation: 1, rootPath: root, databasePath });
      await detachWatcher(engine);
      assert.deepEqual(indexedPaths(engine), ['artifacts/keep/kept.txt', 'top.txt']);
      assert.equal(
        engine.treeEntries.some((entry) => entry.relativePath === 'artifacts'),
        false,
        'the excluded parent is deliberately absent from the tree — that is what makes this case hard'
      );
      // 整个目录被移出工作区:macOS 只送来它自己那一条 rename 事件,子孙没有事件。
      await rename(join(root, 'artifacts'), join(outside, 'artifacts'));
      await engine.applyWatchChangesInternal(
        { full: false, paths: ['artifacts'], renamePaths: ['artifacts'] },
        { deferRebuild: false }
      );
      assert.deepEqual(indexedPaths(engine), ['top.txt'],
        'the descendants must not be stranded in the index');
      assert.deepEqual(await searchPaths(engine, 'zebravanish'), ['top.txt'],
        'a removed file must not stay searchable');
    } finally {
      await engine.shutdown();
    }
  });
});
