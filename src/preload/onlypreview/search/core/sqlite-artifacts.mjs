import { opendir, rm } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';

const escapedRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

export const reclaimInterruptedSqliteArtifacts = async (databasePath) => {
  const directoryPath = dirname(databasePath);
  const databaseName = basename(databasePath);
  const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  const artifactName = new RegExp(
    `^${escapedRegExp(databaseName)}\\.(?:candidate|previous)-${uuid}(?:-(?:wal|shm))?$`,
    'iu'
  );
  const directory = await opendir(directoryPath);
  for await (const entry of directory) {
    if (!(entry.isFile() || entry.isSymbolicLink()) || !artifactName.test(entry.name)) continue;
    await rm(resolve(directoryPath, entry.name), { force: true });
  }
};
