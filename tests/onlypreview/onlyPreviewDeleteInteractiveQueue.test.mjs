/* eslint-disable @typescript-eslint/explicit-function-return-type */
//
// 删除的两跳要插到排队的后台任务前面。
//
// 删一个文件真正的活是 14 毫秒,但 `beginDeleteTask` / `finishDeleteTask` 各要穿一次索引写队列,
// 而那条队列每个库只允许一个写任务 —— 全量重建走的也是它。修复前删除的两跳都是后台优先级,
// 于是排在一轮 10–13 秒的 reconcile 后面,用户盯着一个没有关闭按钮的进度条干等。
// 见 docs/issues/onlypreview-delete-waits-behind-index-rebuilds.md。
//
// 断言不依赖任何 sleep:`submitIndexTask` 的入队是同步的(Promise executor 里就 push 了),
// 所以调用返回时队列形状已经定了;顺序则由任务自己往 `order` 里记。
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { readDeleteJournal } from '../../src/preload/onlypreview/search/core/delete-journal.mjs';
import {
  indexQueueState,
  submitIndexTask
} from '../../src/preload/onlypreview/search/core/index-queue.mjs';
import { createOnlyPreviewSearchEngine } from '../../src/preload/onlypreview/search/core/search-engine.mjs';

const deferred = () => {
  let resolve;
  const promise = new Promise((resolveValue) => {
    resolve = resolveValue;
  });
  return { promise, resolve };
};

const withWorkspace = async (callback) => {
  const temp = await mkdtemp(join(tmpdir(), 'onlypreview-delete-interactive-'));
  const workspace = join(temp, 'workspace');
  const indexDirectory = join(temp, 'index');
  await mkdir(join(workspace, 'nested'), { recursive: true });
  await mkdir(indexDirectory, { recursive: true });
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

// 控制器会在背后再往同一条队列里排 reconcile,那会把断言的队列形状搅乱 —— 关掉它。
const detachWatchController = async (engine) => {
  await engine.watchController.close({ drain: false });
  engine.watchController = undefined;
  engine.watchRevision += 1;
};

test('an interactive task jumps ahead of a background task that is already queued', async () => {
  const key = `/virtual/index-queue-${randomUUID()}.sqlite`;
  const order = [];
  const held = deferred();
  const runningTask = submitIndexTask(key, 'background-running', async () => {
    order.push('background-running');
    await held.promise;
  });
  const queuedTask = submitIndexTask(key, 'background-queued', async () => {
    order.push('background-queued');
  });
  const interactiveTask = submitIndexTask(
    key,
    'interactive',
    async () => {
      order.push('interactive');
    },
    { interactive: true }
  );

  assert.deepEqual(indexQueueState(key), { depth: 3, running: 'background-running' });
  held.resolve();
  await Promise.all([runningTask, queuedTask, interactiveTask]);

  // 不抢占:已经在跑的那一个照样跑完,交互式只是插到**还在排队**的后台任务前面。
  assert.deepEqual(order, ['background-running', 'interactive', 'background-queued']);
  assert.deepEqual(indexQueueState(key), { depth: 0, running: '' });
});

test("both of the engine's delete hops are submitted as interactive", async () => {
  await withWorkspace(async ({ workspace, databasePath }) => {
    const engine = createOnlyPreviewSearchEngine();
    try {
      await engine.initialize({
        workspaceId: 'workspace',
        generation: 1,
        rootPath: workspace,
        databasePath
      });
      await detachWatchController(engine);
      const key = engine.databasePath;
      assert.deepEqual(indexQueueState(key), { depth: 0, running: '' });

      // ---- 第一跳:begin-delete-task ----
      //
      // 后台任务先排队,删除后排。排在前面的那个后台任务开跑时去读删除日志:日志里已经有这笔
      // 任务,就说明后排的删除确实插到了它前面。这比比较两个 await 的返回顺序结实 ——
      // 它看的是任务体真正执行过的痕迹。
      const beginOrder = [];
      const beginHeld = deferred();
      const beginHold = submitIndexTask(key, 'background-hold', async () => {
        beginOrder.push('background-hold');
        await beginHeld.promise;
      });
      const beginQueued = submitIndexTask(key, 'background-queued', async () => {
        const journal = await readDeleteJournal(databasePath);
        beginOrder.push(journal.length === 1 ? 'delete-journaled' : 'delete-not-journaled');
        beginOrder.push('background-queued');
      });
      const beginPromise = engine.beginDeleteTask({
        workspaceId: 'workspace',
        generation: 1,
        relativePaths: ['nested/doomed.txt']
      });
      assert.deepEqual(indexQueueState(key), { depth: 3, running: 'background-hold' });
      beginHeld.resolve();
      const { taskId } = await beginPromise;
      await Promise.all([beginHold, beginQueued]);
      assert.deepEqual(beginOrder, ['background-hold', 'delete-journaled', 'background-queued']);

      await rm(join(workspace, 'nested', 'doomed.txt'), { force: true });

      // ---- 第三跳:finish-delete-task ----
      //
      // 同样的形状,痕迹换成「这笔任务已经销账」—— 收尾跑完日志才会空。
      const finishOrder = [];
      const finishHeld = deferred();
      const finishHold = submitIndexTask(key, 'background-hold', async () => {
        finishOrder.push('background-hold');
        await finishHeld.promise;
      });
      const finishQueued = submitIndexTask(key, 'background-queued', async () => {
        const journal = await readDeleteJournal(databasePath);
        finishOrder.push(journal.length === 0 ? 'delete-settled' : 'delete-unsettled');
        finishOrder.push('background-queued');
      });
      const finishPromise = engine.finishDeleteTask({
        workspaceId: 'workspace',
        generation: 1,
        taskId,
        removedPaths: ['nested/doomed.txt']
      });
      assert.deepEqual(indexQueueState(key), { depth: 3, running: 'background-hold' });
      finishHeld.resolve();
      await finishPromise;
      await Promise.all([finishHold, finishQueued]);
      assert.deepEqual(finishOrder, ['background-hold', 'delete-settled', 'background-queued']);
    } finally {
      await engine.shutdown();
    }
  });
});
