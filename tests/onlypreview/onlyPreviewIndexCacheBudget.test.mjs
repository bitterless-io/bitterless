/* eslint-disable @typescript-eslint/explicit-function-return-type */
/**
 * 任务 185:给 `search-index-v6/` 一个总量上限。
 *
 * 每开过一个 workspace 就永久留一个库,既没有预算也没有淘汰 —— 三个 edition 曾经堆到 24.5 GB
 * 把一块 926 GB 的盘塞满。上限取 10 GB(Ral 2026-09-22 采纳)。
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  ONLY_PREVIEW_INDEX_CACHE_CAP_BYTES,
  evictOnlyPreviewIndexCache,
  recordOnlyPreviewIndexUse
} from '../../src/preload/onlypreview/search/core/index-cache-budget.mjs';

const withDirectory = async (run) => {
  const directory = await mkdtemp(join(tmpdir(), 'onlypreview-cache-budget-'));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

const writeDatabase = async (directory, name, bytes, artifacts = []) => {
  await writeFile(join(directory, name), Buffer.alloc(bytes));
  for (const suffix of artifacts) await writeFile(join(directory, `${name}${suffix}`), Buffer.alloc(bytes));
};

test('the cap is the value that was chosen, not an arbitrary constant', () => {
  assert.equal(ONLY_PREVIEW_INDEX_CACHE_CAP_BYTES, 10 * 1024 * 1024 * 1024);
});

test('nothing is evicted while the directory fits', async () => {
  await withDirectory(async (directory) => {
    await writeDatabase(directory, 'a.sqlite', 1_000);
    await writeDatabase(directory, 'b.sqlite', 1_000);
    const result = await evictOnlyPreviewIndexCache({
      activeDatabasePath: join(directory, 'a.sqlite'),
      capBytes: 10_000
    });
    assert.deepEqual(result.evicted, []);
    assert.equal((await readdir(directory)).length, 2);
  });
});

test('the least recently opened goes first, and the active one never goes', async () => {
  await withDirectory(async (directory) => {
    await writeDatabase(directory, 'active.sqlite', 1_000);
    await writeDatabase(directory, 'old.sqlite', 1_000);
    await writeDatabase(directory, 'recent.sqlite', 1_000);
    await recordOnlyPreviewIndexUse(join(directory, 'old.sqlite'), 1_000);
    await recordOnlyPreviewIndexUse(join(directory, 'recent.sqlite'), 9_000);
    await recordOnlyPreviewIndexUse(join(directory, 'active.sqlite'), 5_000);

    const result = await evictOnlyPreviewIndexCache({
      activeDatabasePath: join(directory, 'active.sqlite'),
      // 只够放两个,必须淘汰一个。
      capBytes: 2_500
    });
    assert.deepEqual(result.evicted.map(({ name }) => name), ['old.sqlite']);
    const left = await readdir(directory);
    assert.ok(left.includes('active.sqlite'));
    assert.ok(left.includes('recent.sqlite'));
    assert.ok(!left.includes('old.sqlite'));
  });
});

test('a database is evicted together with its wal, shm and build artifacts', async () => {
  await withDirectory(async (directory) => {
    await writeDatabase(directory, 'active.sqlite', 100);
    await writeDatabase(directory, 'stale.sqlite', 1_000, [
      '-wal',
      '-shm',
      '.candidate-11111111-1111-1111-1111-111111111111',
      '.previous-22222222-2222-2222-2222-222222222222'
    ]);
    await recordOnlyPreviewIndexUse(join(directory, 'stale.sqlite'), 1);
    await evictOnlyPreviewIndexCache({
      activeDatabasePath: join(directory, 'active.sqlite'),
      capBytes: 500
    });
    const left = await readdir(directory);
    assert.deepEqual(left.filter((name) => name.startsWith('stale')), []);
    assert.ok(left.includes('active.sqlite'));
  });
});

test('nothing outside a database group is ever removed', async () => {
  await withDirectory(async (directory) => {
    await writeDatabase(directory, 'active.sqlite', 100);
    await writeDatabase(directory, 'stale.sqlite', 5_000);
    await writeFile(join(directory, 'unrelated.txt'), 'keep me');
    await recordOnlyPreviewIndexUse(join(directory, 'stale.sqlite'), 1);
    await evictOnlyPreviewIndexCache({
      activeDatabasePath: join(directory, 'active.sqlite'),
      capBytes: 500
    });
    const left = await readdir(directory);
    assert.ok(left.includes('unrelated.txt'));
    // 账本自己也不是某个库的伴生文件,同样不该被当成可淘汰对象。
    assert.ok(left.includes('usage.json'));
    const ledger = JSON.parse(await readFile(join(directory, 'usage.json'), 'utf8'));
    assert.ok(!Object.hasOwn(ledger, 'stale.sqlite'), '淘汰后账本要把它的条目一并清掉');
  });
});

test('an index nobody ever recorded falls back to its mtime rather than being undeletable', async () => {
  await withDirectory(async (directory) => {
    await writeDatabase(directory, 'active.sqlite', 100);
    await writeDatabase(directory, 'orphan.sqlite', 5_000);
    // 没有任何 recordOnlyPreviewIndexUse —— 升级前留下的老库就是这个样子。
    const result = await evictOnlyPreviewIndexCache({
      activeDatabasePath: join(directory, 'active.sqlite'),
      capBytes: 500
    });
    assert.deepEqual(result.evicted.map(({ name }) => name), ['orphan.sqlite']);
  });
});
