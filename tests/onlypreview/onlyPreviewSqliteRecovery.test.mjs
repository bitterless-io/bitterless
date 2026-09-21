/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rmdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test } from 'node:test';
import {
  isSqliteCorruption,
  openRecoverableSqliteIndex,
  quarantineSqliteIndex,
  renameSqliteIndexArtifacts,
  sqlitePrimaryErrorCode
} from '../../src/preload/onlypreview/search/core/sqlite-recovery.mjs';
import { createOnlyPreviewSearchDiagnostics } from '../../src/shared/onlypreview/onlyPreviewSearchDiagnostics.mjs';
import { reclaimInterruptedSqliteArtifacts } from '../../src/preload/onlypreview/search/core/sqlite-artifacts.mjs';

const io = { lstat, mkdtemp, rename, rmdir };
const suffixes = ['', '-wal', '-shm', '-journal'];
const fixture = async (t, sidecars = false) => {
  const directory = await mkdtemp(join(tmpdir(), 'onlypreview-sqlite-recovery-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const databasePath = join(directory, 'index.sqlite');
  for (const suffix of sidecars ? suffixes : [''])
    await writeFile(`${databasePath}${suffix}`, `original${suffix}`);
  return { directory, databasePath };
};
const sqliteError = (errcode) =>
  Object.assign(new Error('private SQLite diagnostic'), {
    code: 'ERR_SQLITE_ERROR',
    errcode
  });
const freshIndex = () => ({ isReusable: () => false, canReconcile: () => false });

test('only precise SQLite CORRUPT/NOTADB primary and extended codes authorize recovery', () => {
  for (const errcode of [11, 267, 523, 779, 26, 282]) {
    assert.equal(isSqliteCorruption(sqliteError(errcode)), true);
    assert.equal(sqlitePrimaryErrorCode(sqliteError(errcode)), errcode & 255);
  }
  for (const code of [
    'SQLITE_CORRUPT',
    'SQLITE_CORRUPT_VTAB',
    'SQLITE_CORRUPT_SEQUENCE',
    'SQLITE_CORRUPT_INDEX',
    'SQLITE_NOTADB'
  ]) {
    assert.equal(isSqliteCorruption({ code }), true);
  }
  for (const error of [
    sqliteError(5),
    sqliteError(10),
    sqliteError(14),
    sqliteError(21),
    { code: 'EACCES' },
    { code: 'SQLITE_CORRUPT_UNKNOWN' },
    new Error('database disk image is malformed'),
    { code: 'ERR_SQLITE_ERROR' },
    { errcode: '11' },
    { errcode: 11.5 },
    { errcode: -245 }
  ])
    assert.equal(isSqliteCorruption(error), false);
});

test('quarantine renames only the exact database and sidecars into a unique recoverable directory', async (t) => {
  const { directory, databasePath } = await fixture(t, true);
  const neighbor = join(directory, 'another.sqlite');
  await writeFile(neighbor, 'unrelated');
  const moved = [];
  const first = await quarantineSqliteIndex(databasePath, {
    ...io,
    rename: async (from, to) => {
      moved.push([from, to]);
      await rename(from, to);
    }
  });
  assert.equal(moved.length, 4);
  for (const suffix of suffixes) {
    assert.equal(await readFile(join(first, `index.sqlite${suffix}`), 'utf8'), `original${suffix}`);
    await assert.rejects(lstat(`${databasePath}${suffix}`), { code: 'ENOENT' });
  }
  assert.equal(await readFile(neighbor, 'utf8'), 'unrelated');
  await writeFile(databasePath, 'second generation');
  const second = await quarantineSqliteIndex(databasePath);
  assert.notEqual(first, second);
  // Task 187 item 2, a deliberate contract change: one quarantine per database. This used to assert
  // that `first` survived. A superseded forensic copy carries nothing the newest one does not, and
  // the reference machine was holding ~10 GB of them — of a 5.6 GB index, on the volume whose
  // fullness had caused the corruption they record.
  await assert.rejects(lstat(first), { code: 'ENOENT' });
  assert.equal(await readFile(join(second, 'index.sqlite'), 'utf8'), 'second generation');
  assert.deepEqual(
    (await readdir(directory)).filter((name) => name.includes('.quarantine-')),
    [basename(second)]
  );
});

test('a volume that cannot spare the copy gets the corrupt artifacts removed, not quarantined', async (t) => {
  const { directory, databasePath } = await fixture(t, true);
  const quarantinePath = await quarantineSqliteIndex(databasePath, {
    ...io,
    statfs: async () => ({ bavail: 16, bsize: 4096 })
  });
  assert.equal(quarantinePath, undefined, 'nothing is retained');
  for (const suffix of suffixes)
    await assert.rejects(lstat(`${databasePath}${suffix}`), { code: 'ENOENT' });
  assert.deepEqual(await readdir(directory), [], 'and nothing is left behind either');
});

test('a volume with room still retains the copy', async (t) => {
  const { databasePath } = await fixture(t, true);
  const quarantinePath = await quarantineSqliteIndex(databasePath, {
    ...io,
    statfs: async () => ({ bavail: 1024 * 1024, bsize: 4096 })
  });
  assert.equal(typeof quarantinePath, 'string');
  assert.equal(await readFile(join(quarantinePath, 'index.sqlite'), 'utf8'), 'original');
});

test('partial rename failure restores every moved original and surfaces the filesystem error', async (t) => {
  const { directory, databasePath } = await fixture(t, true);
  const failure = Object.assign(new Error('rename failed'), { code: 'EACCES' });
  await assert.rejects(
    quarantineSqliteIndex(databasePath, {
      ...io,
      rename: async (from, to) => {
        if (from === `${databasePath}-shm`) throw failure;
        await rename(from, to);
      }
    }),
    (error) => error === failure
  );
  for (const suffix of suffixes)
    assert.equal(await readFile(`${databasePath}${suffix}`, 'utf8'), `original${suffix}`);
  assert.deepEqual(
    (await readdir(directory)).sort(),
    suffixes.map((suffix) => `index.sqlite${suffix}`).sort()
  );
});

test('rollback never overwrites a replacement file and retains quarantined data when blocked', async (t) => {
  const { directory, databasePath } = await fixture(t, true);
  await assert.rejects(
    quarantineSqliteIndex(databasePath, {
      ...io,
      rename: async (from, to) => {
        if (from === `${databasePath}-wal`) {
          await writeFile(databasePath, 'replacement');
          throw Object.assign(new Error('rename failed'), { code: 'EIO' });
        }
        await rename(from, to);
      }
    }),
    AggregateError
  );
  const [quarantined] = (await readdir(directory)).filter((name) => name.includes('.quarantine-'));
  assert.equal(await readFile(join(directory, quarantined, 'index.sqlite'), 'utf8'), 'original');
  assert.equal(await readFile(databasePath, 'utf8'), 'replacement');
  assert.equal(await readFile(`${databasePath}-wal`, 'utf8'), 'original-wal');
});

test('recovery promotion renames and restores the database with every exact sidecar', async (t) => {
  const { directory, databasePath } = await fixture(t, true);
  const previousPath = `${databasePath}.recovery-11111111-2222-4333-8444-555555555555`;
  await renameSqliteIndexArtifacts(databasePath, previousPath);
  await reclaimInterruptedSqliteArtifacts(databasePath);
  for (const suffix of suffixes) {
    assert.equal(await readFile(`${previousPath}${suffix}`, 'utf8'), `original${suffix}`);
    await assert.rejects(lstat(`${databasePath}${suffix}`), { code: 'ENOENT' });
  }
  await renameSqliteIndexArtifacts(previousPath, databasePath);
  assert.deepEqual(
    (await readdir(directory)).sort(),
    suffixes.map((suffix) => `index.sqlite${suffix}`).sort()
  );
  for (const suffix of suffixes)
    assert.equal(await readFile(`${databasePath}${suffix}`, 'utf8'), `original${suffix}`);
});

test('recovery artifact rename rolls back partial moves and refuses an occupied destination', async (t) => {
  const { databasePath } = await fixture(t, true);
  const previousPath = `${databasePath}.previous-fixture`;
  await writeFile(`${previousPath}-shm`, 'occupied');
  await assert.rejects(renameSqliteIndexArtifacts(databasePath, previousPath), { code: 'EEXIST' });
  for (const suffix of suffixes)
    assert.equal(await readFile(`${databasePath}${suffix}`, 'utf8'), `original${suffix}`);
  await assert.rejects(lstat(previousPath), { code: 'ENOENT' });
  await assert.rejects(lstat(`${previousPath}-wal`), { code: 'ENOENT' });
  assert.equal(await readFile(`${previousPath}-shm`, 'utf8'), 'occupied');
});

test('warm tree restore failure closes its handle before one cold reopen, preserving open diagnostics', async (t) => {
  const { directory, databasePath } = await fixture(t);
  let opens = 0;
  let closes = 0;
  const phases = [];
  const opened = [];
  const recovered = [];
  const clean = freshIndex();
  const result = await openRecoverableSqliteIndex({
    databasePath,
    createIndex: () => {
      opens += 1;
      if (opens === 2) {
        assert.equal(closes, 1);
        return clean;
      }
      return {
        isReusable: () => true,
        canReconcile: () => true,
        readTreeSnapshot: () => {
          throw sqliteError(11);
        },
        close: () => {
          closes += 1;
        }
      };
    },
    onPhase: (phase) => phases.push(phase),
    onOpen: (value) => opened.push(value),
    onRecovery: (value) => recovered.push(value)
  });
  assert.equal(result.seedIndex, clean);
  assert.equal(result.hasActiveIndex, false);
  assert.equal(result.canReconcile, false);
  assert.equal(result.seedTree.treeMetadataReady, false);
  assert.deepEqual(phases, [
    'sqlite-open',
    'tree-restore',
    'quarantine',
    'sqlite-open',
    'tree-restore'
  ]);
  assert.deepEqual(opened, [
    { hasActiveIndex: true, canReconcile: true },
    { hasActiveIndex: false, canReconcile: false }
  ]);
  assert.deepEqual(recovered, [{ sqliteCode: 11, retained: true }]);
  assert.equal(
    (await readdir(directory)).filter((name) =>
      name.startsWith(`${basename(databasePath)}.quarantine-`)
    ).length,
    1
  );
});

test('non-corruption and failed handle close do not quarantine any files', async (t) => {
  for (const closeFails of [false, true]) {
    const { directory, databasePath } = await fixture(t);
    const original = sqliteError(closeFails ? 11 : 10);
    let closes = 0;
    await assert.rejects(
      openRecoverableSqliteIndex({
        databasePath,
        createIndex: () => ({
          isReusable: () => true,
          canReconcile: () => true,
          readTreeSnapshot: () => {
            throw original;
          },
          close: () => {
            closes += 1;
            if (closeFails) throw new Error('close failed');
          }
        })
      }),
      (error) => (closeFails ? error instanceof AggregateError : error === original)
    );
    assert.equal(closes, 1);
    assert.deepEqual(await readdir(directory), ['index.sqlite']);
    assert.equal(await readFile(databasePath, 'utf8'), 'original');
  }
});

test('a failed clean reopen is reported once, without a quarantine/rebuild loop', async (t) => {
  const { directory, databasePath } = await fixture(t);
  let opens = 0;
  const failure = sqliteError(26);
  await assert.rejects(
    openRecoverableSqliteIndex({
      databasePath,
      createIndex: () => {
        opens += 1;
        throw failure;
      }
    }),
    (error) => error === failure
  );
  assert.equal(opens, 2);
  assert.equal(
    (await readdir(directory)).filter((name) => name.includes('.quarantine-')).length,
    1
  );
});

test('initialization/recovery diagnostics emit only phase and bounded numeric code, never payloads', () => {
  const lines = [];
  const diagnostics = createOnlyPreviewSearchDiagnostics({ write: (line) => lines.push(line) });
  diagnostics.emit('initialize-failure', {
    tag: 'i1',
    phase: 'tree-restore',
    sqliteCode: 11,
    message: 'private content',
    path: '/private/file'
  });
  diagnostics.emit('sqlite-recovery', {
    tag: 'i1',
    sqliteCode: 26,
    quarantinePath: '/private/backup'
  });
  assert.deepEqual(lines, [
    '[onlypreview-search] event=initialize-failure tag=i1 phase=tree-restore sqliteCode=11',
    '[onlypreview-search] event=sqlite-recovery tag=i1 sqliteCode=26'
  ]);
});

/**
 * 取证副本按**数量**封顶,不只按年龄 —— 年龄闸默认"产生得慢",而实测不是。
 *
 * 参考机 2026-09-21:索引目录 24 GB,其中 6 份 quarantine 共 18.7 GB,在用的索引只有 2.6 GB,
 * 光当天就堆了 5 份。这个用例复刻那个形态:同一个库、多份副本、全部都还很新(年龄闸一份都收不走),
 * 断言只留最新的一份。
 */
test('only the newest forensic copy of a live database is retained, regardless of age', async (t) => {
  const { directory, databasePath } = await fixture(t, true);
  const made = [];
  for (const index of [0, 1, 2, 3, 4, 5]) {
    const uuid = `1111111${index}-2222-4333-8444-55555555555${index}`;
    const path = `${databasePath}.recovery-${uuid}.quarantine-aBcDe${index}`;
    await mkdir(path, { recursive: true });
    await writeFile(join(path, 'index.sqlite'), `forensic-${index}`);
    // 全部都在保留窗口之内:年龄闸一份都不该收走,收走它们的必须是数量闸。
    const when = new Date(Date.now() - index * 60_000);
    await utimes(path, when, when);
    made.push({ path, index });
  }

  await reclaimInterruptedSqliteArtifacts(databasePath);

  const left = (await readdir(directory)).filter((name) => name.includes('.quarantine-'));
  assert.equal(left.length, 1, '同一个库只留一份');
  assert.ok(left[0].endsWith('aBcDe0'), '留下的是最新的那一份');
  assert.equal(
    await readFile(join(directory, left[0], 'index.sqlite'), 'utf8'),
    'forensic-0'
  );
  // 在用的索引本体一个字节都不能碰。
  assert.equal(await readFile(databasePath, 'utf8'), 'original');
});
