import quarantineIo from 'node:fs/promises';
import { basename, join } from 'node:path';

import { OnlyPreviewSqliteIndex } from './sqlite-index.mjs';

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

// Same-volume rename only: a multi-GB cache must never be copied or deleted during startup.
export const quarantineSqliteIndex = async (databasePath, io = quarantineIo) => {
  const sources = await readSqliteArtifacts(databasePath, io);
  const quarantinePath = await io.mkdtemp(`${databasePath}.quarantine-`);
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
    await quarantineSqliteIndex(databasePath);
    onRecovery({ sqliteCode: sqlitePrimaryErrorCode(error) });
    // No loop: a failed clean open/build is reported normally, with the original cache preserved.
    return open();
  }
};
