/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const runCommand = promisify(execFile);

const REPOSITORY_ROOT = resolve(import.meta.dirname, '../..');

/**
 * Every file whose bytes can move a measurement: the search engine plan A wraps, and the leaf modules
 * the alternative plans reuse from it.
 */
const FINGERPRINTED_DIRECTORIES = Object.freeze([
  'src/preload/onlypreview/search/core',
  'src/shared/onlypreview'
]);

const collectFiles = async (directoryPath, collected = []) => {
  const entries = await readdir(directoryPath, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const entryPath = join(directoryPath, entry.name);
    if (entry.isDirectory()) await collectFiles(entryPath, collected);
    else if (/\.(mjs|ts)$/u.test(entry.name)) collected.push(entryPath);
  }
  return collected;
};

const gitDescribe = async () => {
  const head = await runCommand('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPOSITORY_ROOT })
    .then(({ stdout }) => stdout.trim())
    .catch(() => 'unknown');
  const changed = await runCommand(
    'git',
    ['status', '--porcelain', '--', ...FINGERPRINTED_DIRECTORIES],
    { cwd: REPOSITORY_ROOT }
  )
    .then(({ stdout }) =>
      stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
    )
    .catch(() => []);
  return { head, uncommittedFiles: changed.length };
};

let cached;

/**
 * A measurement of plan A is a measurement of whatever bytes the engine had at the time, and those
 * bytes are being edited in another session. Stamping the fingerprint into every report and into every
 * index's own metadata is what makes "re-measure A later" a comparison rather than a fresh guess.
 */
export const readEngineFingerprint = async () => {
  if (cached) return cached;
  const files = [];
  for (const directory of FINGERPRINTED_DIRECTORIES) {
    await collectFiles(join(REPOSITORY_ROOT, directory), files);
  }
  files.sort();
  const digest = createHash('sha256');
  for (const filePath of files) {
    digest.update(filePath.slice(REPOSITORY_ROOT.length + 1));
    digest.update(await readFile(filePath));
  }
  const git = await gitDescribe();
  cached = {
    hash: digest.digest('hex').slice(0, 12),
    fileCount: files.length,
    gitHead: git.head,
    uncommittedEngineFiles: git.uncommittedFiles
  };
  return cached;
};

export const formatEngineFingerprint = (fingerprint) =>
  `engine=${fingerprint.hash} files=${fingerprint.fileCount} git=${fingerprint.gitHead}` +
  (fingerprint.uncommittedEngineFiles > 0
    ? ` UNCOMMITTED=${fingerprint.uncommittedEngineFiles}`
    : '');
