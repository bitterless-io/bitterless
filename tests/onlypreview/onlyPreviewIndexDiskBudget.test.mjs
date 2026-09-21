/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readdirSync, utimesSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  planOnlyPreviewIndexBuild,
  onlyPreviewIndexBytes,
  onlyPreviewDiskFullMessage
} from '../../src/preload/onlypreview/search/core/disk-space.mjs';
import { reclaimInterruptedSqliteArtifacts } from '../../src/preload/onlypreview/search/core/sqlite-artifacts.mjs';

const withTemp = async (run) => {
  const root = mkdtempSync(join(tmpdir(), 'onlypreview-index-budget-'));
  try {
    await run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

const UUID_A = '481bc86c-8f10-4a8f-9f61-2e1ee22d258e';
const UUID_B = '5a8b3d26-d4bf-42ec-956d-15ee9aa22ca2';
const HOUR_MS = 60 * 60 * 1000;

const age = (path, ms) => {
  const when = new Date(Date.now() - ms);
  utimesSync(path, when, when);
};

/**
 * The 2026-09-17 incident: a reconcile copies the whole index before rebuilding it
 * (`backup(seedIndex.database, candidatePath)`), so it needs ~2x on disk. Nothing checked, so the
 * copy was attempted regardless and retried until the volume hit zero.
 */
test('the build plan refuses rather than starting a copy that cannot fit', async () => {
  await withTemp(async (root) => {
    const databasePath = join(root, 'index.sqlite');
    writeFileSync(databasePath, Buffer.alloc(4096));
    assert.equal(await onlyPreviewIndexBytes(databasePath), 4096);

    // A real volume with real free space: the small fixture fits every way.
    const roomy = await planOnlyPreviewIndexBuild({
      databasePath,
      directoryPath: root,
      reconcile: true
    });
    assert.equal(roomy.mode, 'reconcile');
    assert.ok(roomy.requiredBytes > roomy.indexBytes * 2, 'headroom is counted on top of the copy');

    // `reconcile: false` never asks for the copy, so it needs only ~1x.
    const fresh = await planOnlyPreviewIndexBuild({
      databasePath,
      directoryPath: root,
      reconcile: false
    });
    assert.equal(fresh.mode, 'fresh');
    assert.ok(
      fresh.requiredBytes < roomy.requiredBytes,
      'a fresh build must ask for strictly less than a reconcile, or the fallback is pointless'
    );
  });
});

test('the disk-full message names both numbers and carries no path separator', () => {
  const message = onlyPreviewDiskFullMessage({
    requiredBytes: 11.7 * 1024 ** 3,
    freeBytes: 3 * 1024 ** 3
  });
  assert.match(message, /11\.7 GiB required/);
  assert.match(message, /3\.0 GiB free/);
  // The search wire's failure validator rejects any message containing `/` or `\`, which would
  // latch a protocol error instead of showing this sentence.
  assert.doesNotMatch(message, /[/\\]/);
});

test('reclaim removes journals, which it never used to match', async () => {
  await withTemp(async (root) => {
    const databasePath = join(root, 'index.sqlite');
    writeFileSync(databasePath, 'db');
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      writeFileSync(join(root, `index.sqlite.candidate-${UUID_A}${suffix}`), 'x');
    }
    await reclaimInterruptedSqliteArtifacts(databasePath);
    assert.deepEqual(readdirSync(root).sort(), ['index.sqlite']);
  });
});

test('reclaim clears an orphan whose database is gone, but only once it is old enough', async () => {
  await withTemp(async (root) => {
    const databasePath = join(root, 'index.sqlite');
    writeFileSync(databasePath, 'db');
    // Orphan: its owning database no longer exists. This is the class that accumulated 110 files
    // on the owner's disk, because reclaim only ever looked at the database being opened.
    const orphan = join(root, `gone.sqlite.candidate-${UUID_B}-journal`);
    writeFileSync(orphan, 'x');
    age(orphan, 2 * HOUR_MS);
    // A fresh orphan may belong to a build that started moments ago in another process.
    const recent = join(root, `alsogone.sqlite.candidate-${UUID_A}-journal`);
    writeFileSync(recent, 'x');

    await reclaimInterruptedSqliteArtifacts(databasePath);
    const left = readdirSync(root).sort();
    assert.ok(!left.includes(`gone.sqlite.candidate-${UUID_B}-journal`), 'the old orphan is gone');
    assert.ok(
      left.includes(`alsogone.sqlite.candidate-${UUID_A}-journal`),
      'a just-created orphan is left alone — it may be a live build'
    );
  });
});

test('reclaim never touches an artifact whose database is still present', async () => {
  await withTemp(async (root) => {
    const databasePath = join(root, 'index.sqlite');
    writeFileSync(databasePath, 'db');
    // Another live index in the same directory, mid-build.
    writeFileSync(join(root, 'other.sqlite'), 'db');
    const live = join(root, `other.sqlite.candidate-${UUID_B}`);
    writeFileSync(live, 'x');
    age(live, 2 * HOUR_MS);

    await reclaimInterruptedSqliteArtifacts(databasePath);
    assert.ok(
      readdirSync(root).includes(`other.sqlite.candidate-${UUID_B}`),
      'an artifact whose owner is on disk belongs to another index and must survive'
    );
  });
});

test('reclaim ignores directories and unrelated files', async () => {
  await withTemp(async (root) => {
    const databasePath = join(root, 'index.sqlite');
    writeFileSync(databasePath, 'db');
    writeFileSync(join(root, 'index.sqlite-wal'), 'x');
    writeFileSync(join(root, 'notes.txt'), 'x');
    mkdirSync(join(root, `index.sqlite.candidate-${UUID_A}.d`));
    await reclaimInterruptedSqliteArtifacts(databasePath);
    const left = readdirSync(root).sort();
    assert.deepEqual(left, [
      `index.sqlite.candidate-${UUID_A}.d`,
      'index.sqlite',
      'index.sqlite-wal',
      'notes.txt'
    ].sort(), 'the live -wal, an unrelated file and a directory all survive');
  });
});

/**
 * Task 187 item 3. A quarantine is a `mkdtemp` *directory* and `recovery` was deliberately excluded
 * from the candidate sweep, so both were immortal rather than durable — ~10 GB of stacked
 * quarantines of one 5.6 GB index on the reference machine, on the volume whose fullness had caused
 * the corruption they record.
 */
const DAY_MS = 24 * HOUR_MS;

test('reclaim ages out quarantine directories and recovery copies, and keeps the fresh ones', async () => {
  await withTemp(async (root) => {
    const databasePath = join(root, 'index.sqlite');
    writeFileSync(databasePath, 'db');
    const staleQuarantine = join(root, 'index.sqlite.quarantine-Ab3Xz9');
    const staleRecovery = join(root, `index.sqlite.recovery-${UUID_A}`);
    const staleRecoveryQuarantine = join(root, `index.sqlite.recovery-${UUID_B}.quarantine-Qw8Rt2`);
    const freshQuarantine = join(root, 'index.sqlite.quarantine-Zz0Yy1');
    const freshRecovery = join(root, `index.sqlite.recovery-${UUID_B}`);
    mkdirSync(staleQuarantine);
    writeFileSync(join(staleQuarantine, 'index.sqlite'), 'corrupt');
    writeFileSync(staleRecovery, 'corrupt');
    mkdirSync(staleRecoveryQuarantine);
    mkdirSync(freshQuarantine);
    writeFileSync(freshRecovery, 'corrupt');
    for (const path of [staleQuarantine, staleRecovery, staleRecoveryQuarantine]) age(path, 8 * DAY_MS);
    // 两份都还在保留窗口内,但同一个库只留最新的一份(RETAINED_MAX_PER_OWNER)。把较旧的那份
    // 明确推老一分钟,否则两者 mtime 相同、谁胜出不确定 —— 这条用例不该靠运气。
    age(freshQuarantine, 60_000);
    await reclaimInterruptedSqliteArtifacts(databasePath);
    assert.deepEqual(
      readdirSync(root).sort(),
      ['index.sqlite', `index.sqlite.recovery-${UUID_B}`].sort(),
      '超期的取证残留被回收;窗口内的也只留最新一份,旧的那份被挤掉'
    );
  });
});

test('reclaim drops a quarantine whose database is gone on the orphan clock, not the retention one', async () => {
  await withTemp(async (root) => {
    const databasePath = join(root, 'index.sqlite');
    writeFileSync(databasePath, 'db');
    const orphan = join(root, 'other.sqlite.quarantine-Ab3Xz9');
    const owned = join(root, 'index.sqlite.quarantine-Cd4Ww8');
    mkdirSync(orphan);
    mkdirSync(owned);
    for (const path of [orphan, owned]) age(path, 2 * HOUR_MS);
    await reclaimInterruptedSqliteArtifacts(databasePath);
    assert.deepEqual(
      readdirSync(root).sort(),
      ['index.sqlite', 'index.sqlite.quarantine-Cd4Ww8'].sort(),
      'forensics on an index that no longer exists answers nothing, so it goes on the orphan clock'
    );
  });
});
