import quarantineIo, { readdir, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

import { OnlyPreviewSqliteIndex } from './sqlite-index.mjs';

// Matches `disk-space.mjs`'s build headroom: what the volume must still have free after the copy is
// kept, so that keeping it cannot be what tips the rebuild into failing.
const QUARANTINE_HEADROOM_BYTES = 512 * 1024 * 1024;

const CORRUPTION_CODES = new Map([
  ['SQLITE_CORRUPT', 11],
  ['SQLITE_CORRUPT_VTAB', 11],
  ['SQLITE_CORRUPT_SEQUENCE', 11],
  ['SQLITE_CORRUPT_INDEX', 11],
  ['SQLITE_NOTADB', 26]
]);
const SQLITE_SUFFIXES = ['', '-wal', '-shm', '-journal'];

export const sqlitePrimaryErrorCode = (error) => {
  if (Number.isSafeInteger(error?.errcode) && error.errcode > 0) return error.errcode & 0xff;
  return CORRUPTION_CODES.get(error?.code) ?? 0;
};

export const isSqliteCorruption = (error) => {
  const code = sqlitePrimaryErrorCode(error);
  return code === 11 || code === 26;
};

/**
 * `SQLITE_FULL` — the volume, not the database, is out of room.
 *
 * Deliberately NOT folded into `isSqliteCorruption`, even though the owner's log shows the two
 * arriving together (13 seven times, then 11 nine times, 2026-09-17). Corruption recovery
 * quarantines the database and rebuilds it. Doing that for a full disk is precisely backwards: it
 * throws away an index that is not damaged, and then tries to rebuild it in the space that was
 * already insufficient. The 11s in that log are the *consequence* of the 13s — writes torn off
 * mid-page once the volume hit zero — so treating 13 as corruption would destroy a good index on
 * the way down.
 *
 * A full disk is reported, never recovered from. The caller stops instead of retrying.
 */
export const isSqliteDiskFull = (error) => sqlitePrimaryErrorCode(error) === 13;

const readSqliteArtifacts = async (databasePath, io) => {
  const sources = [];
  for (const suffix of SQLITE_SUFFIXES) {
    const source = `${databasePath}${suffix}`;
    let stat;
    try {
      stat = await io.lstat(source);
    } catch (error) {
      if (suffix && error?.code === 'ENOENT') continue;
      throw error;
    }
    if (!stat.isFile() && !stat.isSymbolicLink()) {
      throw new TypeError('Search index artifact must be a file');
    }
    sources.push(source);
  }
  return sources;
};

const moveSqliteArtifacts = async (sources, destinationFor, io) => {
  const moved = [];
  try {
    for (const source of sources) {
      const destination = destinationFor(source);
      try {
        await io.lstat(destination);
        throw Object.assign(new Error('Search index destination is occupied'), { code: 'EEXIST' });
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
      await io.rename(source, destination);
      moved.push({ source, destination });
    }
  } catch (error) {
    const rollbackErrors = [];
    for (const { source, destination } of moved.reverse()) {
      try {
        try {
          await io.lstat(source);
          throw Object.assign(new Error('Search index rollback destination is occupied'), {
            code: 'EEXIST'
          });
        } catch (existingError) {
          if (existingError?.code !== 'ENOENT') throw existingError;
        }
        await io.rename(destination, source);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length) {
      // Leave every remaining artifact recoverable at its destination, never overwrite a new index.
      throw new AggregateError([error, ...rollbackErrors], 'Search index artifact rollback failed');
    }
    throw error;
  }
};

export const renameSqliteIndexArtifacts = async (
  databasePath,
  destinationPath,
  io = quarantineIo
) => {
  const sources = await readSqliteArtifacts(databasePath, io);
  await moveSqliteArtifacts(
    sources,
    (source) => `${destinationPath}${source.slice(databasePath.length)}`,
    io
  );
};

const QUARANTINE_PREFIX = '.quarantine-';

// Drop every earlier quarantine of this database before taking a new one. A superseded forensic copy
// carries nothing the newest one does not, and it is measured in gigabytes: the reference machine
// held ~10 GB of stacked quarantines of a single 5.6 GB index. Deliberately a behaviour change —
// the previous contract kept all of them.
//
// Reads the real filesystem rather than the injected `io`: `io` exists so a test can fail the
// rename dance below, and sweeping is not part of that dance.
const supersedeQuarantines = async (databasePath) => {
  const directoryPath = dirname(databasePath);
  const prefix = `${basename(databasePath)}${QUARANTINE_PREFIX}`;
  let names;
  try {
    names = await readdir(directoryPath);
  } catch {
    return;
  }
  for (const name of names) {
    if (!name.startsWith(prefix)) continue;
    await rm(resolve(directoryPath, name), { recursive: true, force: true }).catch(() => undefined);
  }
};

/**
 * Whether the volume can afford to keep the corrupt copy.
 *
 * Quarantine is forensic, not functional — nothing reads it, and the rebuild that follows does not
 * need it. Holding a multi-GB copy on the volume whose fullness caused the corruption is the
 * opposite of a repair: it is the same mistake the pre-`disk-space.mjs` reconcile made, one layer
 * down. Below the headroom the copy is dropped and the corrupt artifacts are simply removed.
 */
const canRetainQuarantine = async (databasePath, sources, io) => {
  try {
    let retainedBytes = 0;
    for (const source of sources) retainedBytes += (await io.lstat(source)).size;
    const volume = await io.statfs(dirname(databasePath));
    return volume.bavail * volume.bsize >= retainedBytes + QUARANTINE_HEADROOM_BYTES;
  } catch {
    // An unmeasurable volume is not a reason to throw away evidence. That also covers a partial
    // `io` — the tests inject one to fail the rename dance, and it carries no `statfs`.
    return true;
  }
};

/**
 * Move the database and its sidecars aside. Same-volume rename only: a multi-GB cache must never be
 * copied or deleted during startup.
 *
 * Returns the quarantine directory, or `undefined` when the volume could not spare it and the
 * artifacts were removed instead.
 */
export const quarantineSqliteIndex = async (databasePath, io = quarantineIo) => {
  const sources = await readSqliteArtifacts(databasePath, io);
  await supersedeQuarantines(databasePath);
  if (!(await canRetainQuarantine(databasePath, sources, io))) {
    for (const source of sources) await rm(source, { force: true });
    return undefined;
  }
  const quarantinePath = await io.mkdtemp(`${databasePath}${QUARANTINE_PREFIX}`);
  try {
    await moveSqliteArtifacts(sources, (source) => join(quarantinePath, basename(source)), io);
    return quarantinePath;
  } catch (error) {
    await io.rmdir(quarantinePath).catch(() => undefined);
    throw error;
  }
};

export const openRecoverableSqliteIndex = async ({
  databasePath,
  identity,
  searchPolicy,
  createIndex = (path) => new OnlyPreviewSqliteIndex(path),
  onPhase = () => undefined,
  onOpen = () => undefined,
  onRecovery = () => undefined
}) => {
  const open = () => {
    let seedIndex;
    try {
      onPhase('sqlite-open');
      seedIndex = createIndex(databasePath);
      const hasActiveIndex = seedIndex.isReusable(identity);
      const canReconcile = seedIndex.canReconcile(identity);
      onOpen({ hasActiveIndex, canReconcile });
      onPhase('tree-restore');
      const seedTree = hasActiveIndex
        ? seedIndex.readTreeSnapshot({ searchPolicy })
        : { entries: [], maxDepthReached: false, treeMetadataReady: false };
      return { seedIndex, hasActiveIndex, canReconcile, seedTree };
    } catch (error) {
      try {
        seedIndex?.close();
      } catch (closeError) {
        throw new AggregateError([error, closeError], 'Failed Search index handle could not be closed');
      }
      throw error;
    }
  };
  try {
    return open();
  } catch (error) {
    if (!isSqliteCorruption(error)) throw error;
    onPhase('quarantine');
    const quarantinePath = await quarantineSqliteIndex(databasePath);
    onRecovery({ sqliteCode: sqlitePrimaryErrorCode(error), retained: quarantinePath !== undefined });
    // No loop: a failed clean open/build is reported normally, with the original cache preserved.
    return open();
  }
};
