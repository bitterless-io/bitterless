/* eslint-disable @typescript-eslint/explicit-function-return-type */
//
// 删除之后内容必须立刻搜不到,而且这件事要能跨重启续做。
//
// 修复前:`commitDelete` 删完文件就返回,**索引完全不知情** —— 删掉的内容要等一次 watcher
// reconcile(实测 80–120 秒)才消失;而如果在这中间关掉应用,那笔欠账就永远没人还,下次启动
// 搜出来的还是已经不存在的文件。设计见 `areas/agent-runtime/preview/index-solution.html` #1/#2。
//
// 这里测的是引擎层的契约(`beginDeleteTask` → 删文件 → `finishDeleteTask`),也就是 preload 的
// `commitDelete` 依赖的那一层。RPC 那几层需要 Electron,跑不进单测。
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { createOnlyPreviewSearchEngine } from '../../src/preload/onlypreview/search/core/search-engine.mjs';
import {
  deleteJournalPath,
  readDeleteJournal
} from '../../src/preload/onlypreview/search/core/delete-journal.mjs';

const withWorkspace = async (callback) => {
  const temp = await mkdtemp(join(tmpdir(), 'onlypreview-delete-purge-'));
  const workspace = join(temp, 'workspace');
  const indexDirectory = join(temp, 'index');
  await mkdir(workspace, { recursive: true });
  await mkdir(join(workspace, 'nested', 'deep'), { recursive: true });
  await mkdir(indexDirectory, { recursive: true });
  // 三个都含同一个词,便于用一次搜索同时观察"删了的"和"没删的"。
  await writeFile(join(workspace, 'keep.txt'), 'zebracode stays put');
  await writeFile(join(workspace, 'nested', 'child.txt'), 'zebracode inside the folder');
  await writeFile(join(workspace, 'nested', 'deep', 'grandchild.txt'), 'zebracode deeper still');
  try {
    return await callback({ workspace, indexDirectory, databasePath: join(indexDirectory, 'index.sqlite') });
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
};

// 只实现引擎真正调用的那四个成员;`emit` 把事件收下来供断言。
const recordingDiagnostics = () => {
  const events = [];
  let tag = 0;
  return {
    events,
    emit: (event, fields = {}) => events.push({ event, ...fields }),
    now: () => 0,
    elapsed: () => 0,
    nextTag: (prefix = "d") => `${prefix}${(tag += 1)}`
  };
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

test('deleting a folder purges it and every descendant from the index immediately', async () => {
  await withWorkspace(async ({ workspace, databasePath }) => {
    const engine = createOnlyPreviewSearchEngine();
    try {
      await engine.initialize({
        workspaceId: 'workspace',
        generation: 1,
        rootPath: workspace,
        databasePath
      });
      assert.deepEqual(
        await searchPaths(engine, 'zebracode'),
        ['keep.txt', 'nested/child.txt', 'nested/deep/grandchild.txt'],
        'the fixture must be fully indexed before the delete'
      );

      // 1) 先开任务 —— **必须先于第一个 unlink**。
      const { taskId } = await engine.beginDeleteTask({
        workspaceId: 'workspace',
        generation: 1,
        relativePaths: ['nested']
      });
      const [pending] = await readDeleteJournal(databasePath);
      assert.equal(pending.phase, 'files', 'the task must be journaled before any file is removed');
      assert.deepEqual(pending.relativePaths, ['nested']);

      // 2) 删文件(真实路径上由 `projectAuthority.commitDelete` 做这一步)。
      await rm(join(workspace, 'nested'), { recursive: true, force: true });

      // 3) 收尾:换挡 → 清索引 → 销账。
      const outcome = await engine.finishDeleteTask({
        workspaceId: 'workspace',
        generation: 1,
        taskId,
        removedPaths: ['nested']
      });
      assert.ok(outcome.removedFileCount >= 2, 'the folder and its descendants must leave the index');

      // **子孙也要没了。** watcher 那条路径对删目录只产生一条 `remove`,树靠 `pathHasAncestorIn`
      // 摘掉了子孙,`files` 表里子孙的行却没人删 —— 目录从浏览里消失、内容照样能搜到。
      assert.deepEqual(
        await searchPaths(engine, 'zebracode'),
        ['keep.txt'],
        'deleted content is still searchable'
      );
      assert.deepEqual(await readDeleteJournal(databasePath), [], 'a settled task must be cleared');
    } finally {
      await engine.shutdown();
    }
  });
});

test('a delete interrupted before the index purge is finished on the next start', async () => {
  // 这是「持久化任务」存在的唯一理由:文件已经删了、索引还欠着,此时关掉应用。
  // 修复前那笔欠账永远没人还;现在下一次启动读到任务,自己把索引补清干净。
  await withWorkspace(async ({ workspace, databasePath }) => {
    const first = createOnlyPreviewSearchEngine();
    await first.initialize({
      workspaceId: 'workspace',
      generation: 1,
      rootPath: workspace,
      databasePath
    });
    await first.beginDeleteTask({
      workspaceId: 'workspace',
      generation: 1,
      relativePaths: ['nested']
    });
    await rm(join(workspace, 'nested'), { recursive: true, force: true });
    // 故意不调用 `finishDeleteTask` —— 模拟在两步之间被关掉。
    await first.shutdown();

    await stat(deleteJournalPath(databasePath));

    const second = createOnlyPreviewSearchEngine();
    try {
      await second.initialize({
        workspaceId: 'workspace',
        generation: 1,
        rootPath: workspace,
        databasePath
      });
      assert.deepEqual(
        await searchPaths(second, 'zebracode'),
        ['keep.txt'],
        'the restart must finish the owed index purge'
      );
      assert.deepEqual(
        await readDeleteJournal(databasePath),
        [],
        'the task must be cleared once its purge actually ran'
      );
    } finally {
      await second.shutdown();
    }
  });
});

test('a folder deleted while the app was closed is gone from the index after the next start', async () => {
  // 这一格没有任何删除任务可依靠 —— 删除发生在 app 之外,日志是空的。能救它的只有启动时那次
  // reconcile:遍历磁盘拿到 `seen`,再把索引里没被看到的路径删掉(`sqlite-index.mjs` 的
  // `commitDeleteBatch`)。Ral 2026-09-22 问的正是这一格。
  await withWorkspace(async ({ workspace, databasePath }) => {
    const first = createOnlyPreviewSearchEngine();
    await first.initialize({
      workspaceId: 'workspace',
      generation: 1,
      rootPath: workspace,
      databasePath
    });
    assert.deepEqual(await searchPaths(first, 'zebracode'), [
      'keep.txt',
      'nested/child.txt',
      'nested/deep/grandchild.txt'
    ]);
    await first.shutdown();

    // app 关着的时候在 Finder / 终端里删掉整个目录。
    await rm(join(workspace, 'nested'), { recursive: true, force: true });
    assert.deepEqual(await readDeleteJournal(databasePath), [], 'there is no task to recover from');

    const second = createOnlyPreviewSearchEngine();
    try {
      const snapshot = await second.initialize({
        workspaceId: 'workspace',
        generation: 1,
        rootPath: workspace,
        databasePath
      });
      assert.equal(snapshot.state, 'ready');
      assert.deepEqual(
        await searchPaths(second, 'zebracode'),
        ['keep.txt'],
        'offline deletions must be reconciled away by the startup build'
      );
    } finally {
      await second.shutdown();
    }
  });
});

test('a journal path that escapes the workspace is ignored by recovery', async () => {
  // 日志里的相对路径来自磁盘上一个 JSON 文件,而 `delete-journal.mjs` 的 `isPath` 只管长度和
  // 非空 —— `../…` 能通过。拿它去 `resolve(rootPath, …)` 就指到工作区外面,那里的"文件不存在"
  // 根本不代表本工作区欠了账。恢复必须拒认这种路径。
  await withWorkspace(async ({ workspace, databasePath }) => {
    const engine = createOnlyPreviewSearchEngine();
    await engine.initialize({
      workspaceId: 'workspace',
      generation: 1,
      rootPath: workspace,
      databasePath
    });
    const before = await searchPaths(engine, 'zebracode');
    const rootRealPath = engine.rootPath;
    await engine.shutdown();

    // 手工写一条越界任务:路径指到工作区之外(那里当然"不存在")。
    await writeFile(
      deleteJournalPath(databasePath),
      JSON.stringify({
        version: 1,
        tasks: [
          {
            taskId: 'escaping-task',
            workspaceId: 'workspace',
            rootPath: rootRealPath,
            relativePaths: ['../outside-the-workspace'],
            phase: 'index',
            createdAt: 1
          }
        ]
      }),
      'utf8'
    );

    const diagnostics = recordingDiagnostics();
    const second = createOnlyPreviewSearchEngine({ diagnostics });
    try {
      await second.initialize({
        workspaceId: 'workspace',
        generation: 1,
        rootPath: workspace,
        databasePath
      });
      // **关键断言。** 没有工作区守卫时,这条越界路径会被当成"文件已不存在"从而进入 settled,
      // 于是 `forgetPathsIndexed` 被真的调用一次并发出 `delete-journal-recovered`。
      // 只断言"索引没变"是不够的:越界路径匹配不到任何索引行,不带守卫也照样不变。
      assert.equal(
        diagnostics.events.some((entry) => entry.event === 'delete-journal-recovered'),
        false,
        'recovery must not act on a journal path outside the workspace'
      );
      assert.deepEqual(
        await searchPaths(second, 'zebracode'),
        before,
        'an out-of-workspace journal path must not change the index'
      );
    } finally {
      await second.shutdown();
    }
  });
});

test('a task whose files still exist is left alone rather than re-deleted', async () => {
  // 重启后**不替用户补删文件**:删除是破坏性动作,无人确认就自己执行是不能接受的。
  // 那些路径原样留下,照常被索引。
  await withWorkspace(async ({ workspace, databasePath }) => {
    const first = createOnlyPreviewSearchEngine();
    await first.initialize({
      workspaceId: 'workspace',
      generation: 1,
      rootPath: workspace,
      databasePath
    });
    await first.beginDeleteTask({
      workspaceId: 'workspace',
      generation: 1,
      relativePaths: ['nested']
    });
    // 文件一个都没删 —— 上次的删除根本没成功。
    await first.shutdown();

    const second = createOnlyPreviewSearchEngine();
    try {
      await second.initialize({
        workspaceId: 'workspace',
        generation: 1,
        rootPath: workspace,
        databasePath
      });
      assert.deepEqual(
        await searchPaths(second, 'zebracode'),
        ['keep.txt', 'nested/child.txt', 'nested/deep/grandchild.txt'],
        'recovery must not purge paths whose files are still on disk'
      );
      await stat(join(workspace, 'nested', 'child.txt'));
    } finally {
      await second.shutdown();
    }
  });
});
