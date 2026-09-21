/* eslint-disable @typescript-eslint/explicit-function-return-type */
//
// 同一个库上只允许一个构建,以及提升时主库与 sidecar 必须整组移动。
//
// 背景见 `docs/issues/onlypreview-concurrent-index-builds-corrupt-the-database.md`:
// 2026-09-21 参考机上同一个库同时活着三个引擎,各拷一份 2.6 GB 候选,两小时把磁盘吃掉 14 GB,
// 并且产生了两份真损坏的库和两份被冤枉隔离的健康库。
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import {
  OnlyPreviewSearchEngine,
  createOnlyPreviewSearchEngine
} from '../../src/preload/onlypreview/search/core/search-engine.mjs';

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

// 原型层面调用:锁挂在 `buildAndPromoteCandidate` 这一层,真正的构建体是
// `buildAndPromoteCandidateExclusive`。用替身当 `this`,就能只测串行语义,不必真的建一次索引。
const runBuild = (host, params = {}) =>
  OnlyPreviewSearchEngine.prototype.buildAndPromoteCandidate.call(host, params);

const tracker = () => {
  const state = { live: 0, peak: 0, order: [] };
  const make = (name, gate) => ({
    databasePath: undefined,
    async buildAndPromoteCandidateExclusive() {
      state.live += 1;
      state.peak = Math.max(state.peak, state.live);
      state.order.push(name);
      await gate.promise;
      state.live -= 1;
      return name;
    }
  });
  return { state, make };
};

test('two engines sharing one database path never build at the same time', async () => {
  const { state, make } = tracker();
  const first = deferred();
  const second = deferred();
  const path = '/tmp/does-not-need-to-exist/index.sqlite';

  const engineA = make('a', first);
  const engineB = make('b', second);
  engineA.databasePath = path;
  engineB.databasePath = path;

  const runA = runBuild(engineA);
  const runB = runBuild(engineB);

  // 让两边都有机会进入各自的构建体;有锁时 B 进不去。
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.peak, 1, 'a second build entered while the first still held the database');
  assert.deepEqual(state.order, ['a'], 'the second build must not start before the first releases');

  first.resolve();
  second.resolve();
  assert.deepEqual(await Promise.all([runA, runB]), ['a', 'b']);
  assert.equal(state.peak, 1);
  assert.deepEqual(state.order, ['a', 'b'], 'the lock must be FIFO');
});

test('engines on different database paths still build concurrently', async () => {
  // 闸是按库设的,不是全局串行。两个工作区各建各的索引不该互相排队。
  const { state, make } = tracker();
  const gate = deferred();

  const engineA = make('a', gate);
  const engineB = make('b', gate);
  engineA.databasePath = '/tmp/workspace-a/index.sqlite';
  engineB.databasePath = '/tmp/workspace-b/index.sqlite';

  const runA = runBuild(engineA);
  const runB = runBuild(engineB);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.peak, 2, 'different databases must not serialize against each other');

  gate.resolve();
  await Promise.all([runA, runB]);
});

test('a failed build releases the database for the next one', async () => {
  const { state, make } = tracker();
  const gate = deferred();
  const path = '/tmp/failing/index.sqlite';

  const failing = {
    databasePath: path,
    async buildAndPromoteCandidateExclusive() {
      state.live += 1;
      state.peak = Math.max(state.peak, state.live);
      state.live -= 1;
      throw new Error('build failed');
    }
  };
  const next = make('next', gate);
  next.databasePath = path;

  const runFailing = runBuild(failing);
  const runNext = runBuild(next);
  await assert.rejects(runFailing, /build failed/u);

  gate.resolve();
  assert.equal(await runNext, 'next');
  assert.equal(state.peak, 1);
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
