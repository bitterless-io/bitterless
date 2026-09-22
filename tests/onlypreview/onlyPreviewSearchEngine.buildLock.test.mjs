/* eslint-disable @typescript-eslint/explicit-function-return-type */
//
// 同一个库上只允许一个构建,以及提升时主库与 sidecar 必须整组移动。
//
// 背景见 `docs/issues/onlypreview-concurrent-index-builds-corrupt-the-database.md`:
// 2026-09-21 参考机上同一个库同时活着三个引擎,各拷一份 2.6 GB 候选,两小时把磁盘吃掉 14 GB,
// 并且产生了两份真损坏的库和两份被冤枉隔离的健康库。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createOnlyPreviewSearchEngine } from '../../src/preload/onlypreview/search/core/search-engine.mjs';
import {
  indexQueueState,
  submitIndexTask
} from '../../src/preload/onlypreview/search/core/index-queue.mjs';

const withTempDirectory = async (callback) => {
  const path = await mkdtemp(join(tmpdir(), 'onlypreview-build-lock-'));
  try {
    return await callback(path);
  } finally {
    await rm(path, { recursive: true, force: true });
  }
};

const deferred = () => {
  let resolve;
  const promise = new Promise((resolveValue) => {
    resolve = resolveValue;
  });
  return { promise, resolve };
};

const tracker = () => {
  const state = { live: 0, peak: 0, order: [] };
  const task = (name, gate) => async () => {
    state.live += 1;
    state.peak = Math.max(state.peak, state.live);
    state.order.push(name);
    await gate.promise;
    state.live -= 1;
    return name;
  };
  return { state, task };
};

test('index tasks on one database path never overlap', async () => {
  const { state, task } = tracker();
  const first = deferred();
  const second = deferred();
  const path = '/tmp/does-not-need-to-exist/index.sqlite';

  const runA = submitIndexTask(path, 'build', task('a', first));
  const runB = submitIndexTask(path, 'forget-paths', task('b', second));

  // 给两边都排一次机会;串行时 B 进不去。
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.peak, 1, 'a second index task entered while the first still held the database');
  assert.deepEqual(state.order, ['a'], 'the second task must not start before the first finishes');
  assert.equal(indexQueueState(path).running, 'build');

  first.resolve();
  second.resolve();
  assert.deepEqual(await Promise.all([runA, runB]), ['a', 'b']);
  assert.equal(state.peak, 1);
  assert.deepEqual(state.order, ['a', 'b'], 'the queue must be FIFO');
  assert.deepEqual(indexQueueState(path), { depth: 0, running: '' }, 'the queue must be reclaimed');
});

test('index tasks on different database paths still run concurrently', async () => {
  // 队列按库分,不是全局串行。两个工作区各建各的索引不该互相排队。
  const { state, task } = tracker();
  const gate = deferred();

  const runA = submitIndexTask('/tmp/workspace-a/index.sqlite', 'build', task('a', gate));
  const runB = submitIndexTask('/tmp/workspace-b/index.sqlite', 'build', task('b', gate));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.peak, 2, 'different databases must not serialize against each other');

  gate.resolve();
  await Promise.all([runA, runB]);
});

test('a failed index task releases the queue for the next one', async () => {
  // 一次失败的重建不能让后面所有任务连锁失败 —— 那会让偶发错误变成索引永久不再更新。
  const { state, task } = tracker();
  const gate = deferred();
  const path = '/tmp/failing/index.sqlite';

  const runFailing = submitIndexTask(path, 'build', async () => {
    state.live += 1;
    state.peak = Math.max(state.peak, state.live);
    state.live -= 1;
    throw new Error('build failed');
  });
  const runNext = submitIndexTask(path, 'forget-paths', task('next', gate));
  await assert.rejects(runFailing, /build failed/u);

  gate.resolve();
  assert.equal(await runNext, 'next');
  assert.equal(state.peak, 1);
});

// ── 源码断言:索引写入的队列提交只许出现在公共入口 ────────────────────────────────────────
//
// 队列并发度是 1,而且**不可重入** —— 早先那个 `indexTaskDepth` 计数被删掉了:它在任务刚排进队、
// 还没轮到的时候就已经置位,于是本引擎排队期间发起的任何别的写入都会以为自己是嵌套的,直接绕过
// 队列,恰好和另一个引擎正在跑的任务并发。实例级计数器从原理上分不清"嵌套"和"并发且独立"。
//
// 代价是任何一处嵌套提交都会**死锁**(外层占着队,内层等外层),而死锁在测试里表现为**挂住**
// 而不是失败 —— 2026-09-22 我自己就留下过 9 个挂死的测试进程。所以这条不变量必须由断言守住:
// 内部调用点一律走无锁体(`buildAndPromoteCandidateExclusive` / `forgetPathsIndexed` /
// `refreshInternal`),提交只发生在 `initialize` / `refresh` / `config-refresh` / `reconcile` /
// `forget-paths` / `begin-delete-task` / `finish-delete-task` 这几个公共入口。
//
// 读源码而不是跑运行时:死锁没法用超时以外的方式观测,而超时断言既慢又脆。
test('index-queue submissions only ever happen at public entry points', () => {
  const source = readFileSync(
    new URL('../../src/preload/onlypreview/search/core/search-engine.mjs', import.meta.url),
    'utf8'
  );
  const code = source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/(^|[^:])\/\/.*$/gmu, '$1');

  assert.equal(
    /indexTaskDepth/u.test(code),
    false,
    'the reentrancy counter must stay gone — it cannot tell nesting from independent concurrency'
  );

  const submitted = [...code.matchAll(/runIndexTask\(\s*'([a-z-]+)'/gu)].map((match) => match[1]);
  assert.deepEqual(
    [...new Set(submitted)].sort(),
    [
      'begin-delete-task',
      'config-refresh',
      'finish-delete-task',
      'forget-paths',
      'initialize',
      'reconcile',
      'refresh'
    ],
    'a new queue submission appeared (or one vanished) — check it cannot nest inside another'
  );

  // 嵌套路径上的三处调用必须是无锁体。写成正向断言,而不是"不许出现某个名字":
  // 后者挡不住新增一条嵌套调用。
  for (const required of [
    'this.buildAndPromoteCandidateExclusive({',
    'this.forgetPathsIndexed({',
    'this.refreshInternal('
  ]) {
    assert.ok(code.includes(required), `nested call sites must bypass the queue: ${required}`);
  }
  assert.equal(
    /this\.buildAndPromoteCandidate\(/u.test(code),
    false,
    'the queued build wrapper is gone; every caller is already inside a task'
  );
});

test('promotion moves the live database together with its -wal and -shm', async () => {
  // 裸 `rename` 只搬主库,把上一个库的 WAL 留在新库旁边 —— 下次打开就把 A 的帧回放到 B 上,
  // 正是取证副本里 `2nd reference to page …` 的形态。
  //
  // 关键在于**必须有第二个连接开着同一个库**,否则这个 bug 根本不会显形:引擎关掉自己最后一个
  // 连接时 SQLite 会顺手 unlink WAL,埋进去的 sidecar 在 promote 之前就没了(第一版测试就是这么
  // 误判成通过的)。事故现场之所以留下 WAL,正是因为同一个库上还活着另一个引擎 —— 这里用一个
  // 占位连接把那个条件复现出来。
  await withTempDirectory(async (temp) => {
    const workspace = join(temp, 'workspace');
    await mkdir(workspace, { recursive: true });
    await writeFile(join(workspace, 'alpha.txt'), 'alpha contents');
    await writeFile(join(workspace, 'beta.txt'), 'beta contents');

    const indexDirectory = join(temp, 'index');
    await mkdir(indexDirectory, { recursive: true });
    const databasePath = join(indexDirectory, 'index.sqlite');

    const engine = createOnlyPreviewSearchEngine();
    await engine.initialize({
      workspaceId: 'workspace',
      generation: 1,
      rootPath: workspace,
      databasePath
    });
    const before = await stat(databasePath);

    // 第二个引擎的替身:开着同一个库,并写出一段 WAL,让它在本次提升期间存活。
    const squatter = new DatabaseSync(databasePath);
    squatter.exec('PRAGMA journal_mode=WAL;');
    squatter.exec('CREATE TABLE IF NOT EXISTS squatter_marker (value INTEGER);');
    squatter.exec('INSERT INTO squatter_marker(value) VALUES (1);');
    const plantedWal = await stat(`${databasePath}-wal`);
    assert.ok(plantedWal.size > 0, 'the fixture must leave a non-empty WAL beside the live database');

    try {
      await writeFile(join(workspace, 'gamma.txt'), 'gamma contents');
      await engine.refresh({ workspaceId: 'workspace', generation: 1 });

      const after = await stat(databasePath);
      assert.notEqual(after.ino, before.ino, 'the fixture must actually promote a new database');

      // 提升之后活库旁边**本来就该**有 WAL —— 引擎重新打开了新库,WAL 模式会再建一个。要断的是
      // 它不能是**旧库那一个**:同一个 inode 就意味着上一个数据库的帧留在了新数据库旁边。
      let survived = false;
      try {
        survived = (await stat(`${databasePath}-wal`)).ino === plantedWal.ino;
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
      assert.equal(
        survived,
        false,
        "the previous database's -wal survived promotion at the live path"
      );
      // 提升成功后上一个库会在 `finally` 里被回收,所以这里不该再去断言 `.previous-` 还在 ——
      // "确实发生了一次提升"已经由上面主库 inode 变化那条守住。
    } finally {
      squatter.close();
      await engine.shutdown();
    }
  });
});
