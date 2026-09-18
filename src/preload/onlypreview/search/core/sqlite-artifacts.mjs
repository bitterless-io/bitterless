import { opendir, rm, stat } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

// `-journal` belongs here. Its absence is why 110 orphan journals were found on the owner's disk on
// 2026-09-18: every interrupted build left one, and nothing ever matched them again.
// `sqlite-recovery.mjs` already lists the same four suffixes for the same reason — these two lists
// describe one fact about SQLite and must not drift apart again.
const ARTIFACT_NAME = new RegExp(`^(.+)\\.(?:candidate|previous)-${UUID}(?:-(?:wal|shm|journal))?$`, 'iu');

// An artifact whose owning database is gone can still belong to a build that started moments ago in
// another process, because a first build creates its candidate right after the database file. Only
// reclaim an orphan that has been sitting there long enough that no live build could own it.
const ORPHAN_MIN_AGE_MS = 60 * 60 * 1000;

const artifactOwner = (name) => ARTIFACT_NAME.exec(name)?.[1];

/**
 * Remove interrupted candidate/previous artifacts from the index directory.
 *
 * Two classes are reclaimed:
 *
 * 1. Artifacts of the database being opened — the historical behaviour, and the only one there was.
 * 2. Artifacts whose owning database is no longer on disk. Reclaim used to key off
 *    `basename(databasePath)` alone, so a workspace that was removed, or an edition whose index was
 *    deleted by hand, left its candidates and journals behind permanently. Nothing else ever looked
 *    at them again.
 *
 * An artifact whose owner is still present belongs to another index and is left alone: it may be a
 * build in flight.
 */
export const reclaimInterruptedSqliteArtifacts = async (databasePath) => {
  const directoryPath = dirname(databasePath);
  const activeName = basename(databasePath);
  const present = new Set();
  const artifacts = [];
  const directory = await opendir(directoryPath);
  for await (const entry of directory) {
    present.add(entry.name);
    if (entry.isFile() || entry.isSymbolicLink()) artifacts.push(entry.name);
  }
  const now = Date.now();
  for (const name of artifacts) {
    const owner = artifactOwner(name);
    if (!owner) continue;
    if (owner !== activeName) {
      if (present.has(owner)) continue;
      let modifiedMs;
      try {
        modifiedMs = (await stat(resolve(directoryPath, name))).mtimeMs;
      } catch {
        continue;
      }
      if (now - modifiedMs < ORPHAN_MIN_AGE_MS) continue;
    }
    await rm(resolve(directoryPath, name), { force: true });
  }
};
