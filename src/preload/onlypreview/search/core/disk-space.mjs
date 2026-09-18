import { stat, statfs } from 'node:fs/promises';

const SQLITE_SUFFIXES = ['', '-wal', '-shm'];

// Room to finish on top of whatever the operation itself needs. A build does not stop at the last
// byte: SQLite still wants journal pages, FTS5 still spills merges to temp files on the same volume
// (`temp_store = FILE`), and a volume driven to literally zero is how the 2026-09-17 incident turned
// SQLITE_FULL into SQLITE_CORRUPT.
const HEADROOM_BYTES = 512 * 1024 * 1024;

export const onlyPreviewIndexBytes = async (databasePath) => {
  let total = 0;
  for (const suffix of SQLITE_SUFFIXES) {
    try {
      total += (await stat(`${databasePath}${suffix}`)).size;
    } catch {
      // A missing -wal/-shm, or no index yet at all, contributes nothing.
    }
  }
  return total;
};

export const onlyPreviewFreeBytes = async (path) => {
  const volume = await statfs(path);
  return volume.bavail * volume.bsize;
};

/**
 * Which build path fits on the volume right now.
 *
 * A reconcile copies the whole index first — `backup(seedIndex.database, candidatePath)` in
 * `search-engine.mjs` — so it transiently needs roughly **twice** the index size. A fresh build
 * writes one new database instead, so it needs about one. Nothing used to check either, so a
 * workspace whose index outgrew the free space retried the copy indefinitely, writing gigabytes per
 * attempt until the volume hit zero (eight attempts, 25-82s each, in the owner's log).
 *
 * Returns the most complete path that fits:
 *   'reconcile' — the copy fits, behave as before
 *   'fresh'     — only a single index fits, skip the copy and re-traverse
 *   'none'      — not even that fits; the caller must refuse rather than start
 */
export const planOnlyPreviewIndexBuild = async ({ databasePath, directoryPath, reconcile }) => {
  const [indexBytes, freeBytes] = await Promise.all([
    onlyPreviewIndexBytes(databasePath),
    onlyPreviewFreeBytes(directoryPath)
  ]);
  // A fresh build's output is bounded by the existing index only as an estimate; with no index yet
  // there is nothing to measure, so the headroom alone is the gate.
  const freshNeeds = indexBytes + HEADROOM_BYTES;
  const reconcileNeeds = indexBytes * 2 + HEADROOM_BYTES;
  if (reconcile && freeBytes >= reconcileNeeds) {
    return { mode: 'reconcile', indexBytes, freeBytes, requiredBytes: reconcileNeeds };
  }
  if (freeBytes >= freshNeeds) {
    return { mode: 'fresh', indexBytes, freeBytes, requiredBytes: freshNeeds };
  }
  return { mode: 'none', indexBytes, freeBytes, requiredBytes: freshNeeds };
};

const gib = (bytes) => `${(bytes / 1024 ** 3).toFixed(1)} GiB`;

// The message a full disk deserves: what it needed, what there is. The old path reported
// "the Project search index returned an invalid response", which named neither.
export const onlyPreviewDiskFullMessage = ({ requiredBytes, freeBytes }) =>
  `Not enough disk space to build the Project search index: ${gib(requiredBytes)} required, ${gib(freeBytes)} free.`;
