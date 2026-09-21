import { opendir, rm, stat } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
// The six characters `mkdtemp` substitutes for its template. Every implementation Node runs on —
// glibc, BSD, and libuv's own on Windows — draws them from the alphanumerics.
const MKDTEMP = '[A-Za-z0-9]{6}';

// `-journal` belongs here. Its absence is why 110 orphan journals were found on the owner's disk on
// 2026-09-18: every interrupted build left one, and nothing ever matched them again.
// `sqlite-recovery.mjs` already lists the same four suffixes for the same reason — these two lists
// describe one fact about SQLite and must not drift apart again.
const ARTIFACT_NAME = new RegExp(`^(.+)\\.(?:candidate|previous)-${UUID}(?:-(?:wal|shm|journal))?$`, 'iu');

/**
 * Forensic residue, which used to be permanent.
 *
 * `recovery` was deliberately kept out of `ARTIFACT_NAME` so that an interrupted-candidate sweep
 * after a crash could not destroy the copy a corruption recovery had moved aside. A quarantine was
 * missed for a second reason: it is a `mkdtemp` *directory*, and this sweep only ever looked at
 * files.
 *
 * Permanent is not the same as durable. The reference machine carried roughly 10 GB of stacked
 * quarantines of one 5.6 GB index, on the volume whose fullness had caused the corruption in the
 * first place. Retain them, but on a clock — and drop them as soon as the database they were taken
 * from is gone, because forensics on an index that no longer exists answers nothing.
 *
 * Ordered: the recovery-then-quarantine form must be tested before the bare quarantine form, which
 * would otherwise match it and report the wrong owner.
 */
const RETAINED_NAMES = [
  new RegExp(`^(.+)\\.recovery-${UUID}(?:-(?:wal|shm|journal))?$`, 'iu'),
  new RegExp(`^(.+)\\.recovery-${UUID}\\.quarantine-${MKDTEMP}$`, 'iu'),
  new RegExp(`^(.+)\\.quarantine-${MKDTEMP}$`, 'iu')
];

// An artifact whose owning database is gone can still belong to a build that started moments ago in
// another process, because a first build creates its candidate right after the database file. Only
// reclaim an orphan that has been sitting there long enough that no live build could own it.
const ORPHAN_MIN_AGE_MS = 60 * 60 * 1000;

// How long a forensic copy stays worth its gigabytes while the index it came from is still there.
const RETAINED_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 每个库最多留**一份**取证副本,新的挤掉旧的。
 *
 * 只按年龄收是不够的 —— 那条策略默认"产生得慢"。实测 2026-09-21 的参考机:
 * `Bitterless_PREVIEW` 的索引目录 24 GB,其中 **6 份 quarantine 共 18.7 GB**,而真正在用的索引
 * 只有 2.6 GB;光当天就堆了 5 份。7 天窗口配上"一天 5 份 × 2.6 GB"的产生率,上限是 80 GB 以上,
 * 而且堆在同一块卷上 —— 这正是上一轮注释记着的那个形态(「一个 5.6 GB 索引堆出约 10 GB 隔离副本,
 * 就堆在那块因为满了才导致损坏的卷上」),只是换了个数量级。
 *
 * 留最新的那一份:它们是同一条库血缘的连续副本,第二份几乎不增加可诊断的信息,却各要几个 GB。
 * 数量闸在年龄闸**之前**生效,所以被挤掉的那些不必等 7 天。
 */
const RETAINED_MAX_PER_OWNER = 1;

const artifactOwner = (name) => ARTIFACT_NAME.exec(name)?.[1];

const retainedOwner = (name) => {
  for (const pattern of RETAINED_NAMES) {
    const owner = pattern.exec(name)?.[1];
    if (owner) return owner;
  }
  return undefined;
};

const olderThan = async (path, minimumAgeMs, now) => {
  try {
    return now - (await stat(path)).mtimeMs >= minimumAgeMs;
  } catch {
    return false;
  }
};

/**
 * Remove interrupted and superseded index artifacts from the index directory.
 *
 * Reclaimed:
 *
 * 1. Candidate/previous artifacts of the database being opened — the historical behaviour, and the
 *    only one there was.
 * 2. Candidate/previous artifacts whose owning database is no longer on disk. Reclaim used to key
 *    off `basename(databasePath)` alone, so a workspace that was removed, or an edition whose index
 *    was deleted by hand, left its candidates and journals behind permanently.
 * 3. Recovery copies and quarantine directories, once aged out or once their database is gone.
 *
 * A candidate/previous artifact whose owner is still present belongs to another index and is left
 * alone: it may be a build in flight.
 */
export const reclaimInterruptedSqliteArtifacts = async (databasePath) => {
  const directoryPath = dirname(databasePath);
  const activeName = basename(databasePath);
  const present = new Set();
  const entries = [];
  const directory = await opendir(directoryPath);
  for await (const entry of directory) {
    present.add(entry.name);
    entries.push({ name: entry.name, isDirectory: entry.isDirectory() });
  }
  const now = Date.now();
  // 先把取证副本按 owner 分组、按 mtime 新→旧排好,算出"被新副本挤掉"的那一批。数量闸必须在
  // 年龄闸之前定:被挤掉的不该再等 RETAINED_MAX_AGE_MS。
  // **按副本分组,不是按文件。** 一份取证副本是 db ＋ `-wal`/`-shm`/`-journal` 这一组文件(或者
  // 一个 quarantine 目录),按文件名分组会把同一份副本的 sidecar 当成更旧的副本删掉,只留一个
  // 没有 sidecar 的残骸 —— 那比不收还糟。副本键 = 去掉尾部 sidecar 后缀之后的名字。
  const copies = new Map();
  for (const { name } of entries) {
    if (artifactOwner(name)) continue;
    const owner = retainedOwner(name);
    if (!owner) continue;
    const key = name.replace(/-(?:wal|shm|journal)$/iu, '');
    let mtimeMs = 0;
    try {
      mtimeMs = (await stat(resolve(directoryPath, name))).mtimeMs;
    } catch {
      continue;
    }
    const copy = copies.get(key) ?? { owner, names: [], mtimeMs: 0 };
    copy.names.push(name);
    // 一组里取最新的那个时间代表这份副本 —— sidecar 各自的时间可能相差几秒。
    copy.mtimeMs = Math.max(copy.mtimeMs, mtimeMs);
    copies.set(key, copy);
  }
  const byOwner = new Map();
  for (const copy of copies.values()) {
    const group = byOwner.get(copy.owner) ?? [];
    group.push(copy);
    byOwner.set(copy.owner, group);
  }
  const superseded = new Set();
  for (const group of byOwner.values()) {
    group.sort((left, right) => right.mtimeMs - left.mtimeMs);
    for (const copy of group.slice(RETAINED_MAX_PER_OWNER)) {
      for (const name of copy.names) superseded.add(name);
    }
  }

  for (const { name, isDirectory } of entries) {
    const path = resolve(directoryPath, name);
    const owner = artifactOwner(name);
    if (owner) {
      // A candidate is always a file; a directory that happens to be named like one is not ours.
      if (isDirectory) continue;
      if (owner !== activeName) {
        if (present.has(owner)) continue;
        if (!(await olderThan(path, ORPHAN_MIN_AGE_MS, now))) continue;
      }
      await rm(path, { force: true });
      continue;
    }
    const retained = retainedOwner(name);
    if (!retained) continue;
    // 被更新的副本挤掉的,直接收走 —— 不必等年龄。
    if (!superseded.has(name)) {
      const minimumAgeMs = present.has(retained) ? RETAINED_MAX_AGE_MS : ORPHAN_MIN_AGE_MS;
      if (!(await olderThan(path, minimumAgeMs, now))) continue;
    }
    await rm(path, { recursive: true, force: true });
  }
};
