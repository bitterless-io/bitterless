/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { lstat, opendir, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { classifySearchMediaType } from '../../../src/preload/onlypreview/search/core/classification.mjs';
import { MAX_INDEX_DEPTH } from '../../../src/preload/onlypreview/search/core/constants.mjs';
import { createTraversalPolicy } from '../../../src/preload/onlypreview/search/core/traversal.mjs';

export { createTraversalPolicy };

const normalizeRelative = (value) => value.replaceAll('\\', '/');

/**
 * A deliberately lean walker for the alternative plans: one readdir per directory, one lstat per
 * file, parallel directory reads, and no per-file realpath or post-read re-verification.
 *
 * The shipped engine's traversal does 15.8 filesystem operations per file because it re-proves that
 * the bytes it read still belong to the path it read them from. This walker does not, so its numbers
 * measure the cost of that guarantee - they are not a recommendation to drop it.
 */
export const walkWorkspace = async ({
  rootPath,
  policy,
  concurrency = 16,
  onDirectory,
  onFile,
  isCancelled = () => false,
  counters = {}
}) => {
  counters.directories ??= 0;
  counters.files ??= 0;
  counters.symlinks ??= 0;
  counters.excluded ??= 0;
  counters.readdirCalls ??= 0;
  counters.lstatCalls ??= 0;
  counters.unreadable ??= 0;
  let frontier = [{ absolutePath: rootPath, relativePath: '', depth: 0 }];
  while (frontier.length > 0 && !isCancelled()) {
    const nextFrontier = [];
    for (let offset = 0; offset < frontier.length; offset += concurrency) {
      if (isCancelled()) break;
      const slice = frontier.slice(offset, offset + concurrency);
      const listings = await Promise.all(
        slice.map(async (directory) => {
          counters.readdirCalls += 1;
          const entries = await readdir(directory.absolutePath, { withFileTypes: true }).catch(
            () => undefined
          );
          if (!entries) {
            counters.unreadable += 1;
            return undefined;
          }
          return { directory, entries };
        })
      );
      const pendingFiles = [];
      for (const listing of listings) {
        if (!listing) continue;
        for (const entry of listing.entries) {
          const relativePath = listing.directory.relativePath
            ? `${listing.directory.relativePath}/${entry.name}`
            : entry.name;
          const absolutePath = join(listing.directory.absolutePath, entry.name);
          if (entry.isSymbolicLink()) {
            counters.symlinks += 1;
            continue;
          }
          if (entry.isDirectory()) {
            if (policy.isExcludedDirectoryPath(relativePath)) {
              counters.excluded += 1;
              if (!policy.canTraverseExcludedDirectoryPath(relativePath)) continue;
            } else {
              counters.directories += 1;
              onDirectory?.({
                relativePath: normalizeRelative(relativePath),
                parentRelativePath: normalizeRelative(listing.directory.relativePath),
                name: entry.name,
                depth: listing.directory.depth + 1
              });
            }
            if (listing.directory.depth + 1 < MAX_INDEX_DEPTH) {
              nextFrontier.push({
                absolutePath,
                relativePath,
                depth: listing.directory.depth + 1
              });
            }
            continue;
          }
          if (!entry.isFile()) continue;
          if (policy.isExcludedFilePath(relativePath)) {
            counters.excluded += 1;
            continue;
          }
          pendingFiles.push({ absolutePath, relativePath, name: entry.name });
        }
      }
      for (let index = 0; index < pendingFiles.length; index += concurrency) {
        if (isCancelled()) break;
        const batch = pendingFiles.slice(index, index + concurrency);
        const stats = await Promise.all(
          batch.map(async (file) => {
            counters.lstatCalls += 1;
            return await lstat(file.absolutePath).catch(() => undefined);
          })
        );
        for (const [position, file] of batch.entries()) {
          const fileStat = stats[position];
          if (!fileStat || !fileStat.isFile()) {
            counters.unreadable += 1;
            continue;
          }
          counters.files += 1;
          const relativePath = normalizeRelative(file.relativePath);
          const separator = relativePath.lastIndexOf('/');
          onFile?.({
            relativePath,
            parentRelativePath: separator < 0 ? '' : relativePath.slice(0, separator),
            name: file.name,
            size: Number(fileStat.size),
            modifiedMs: Math.trunc(Number(fileStat.mtimeMs)),
            mediaType: classifySearchMediaType(relativePath)
          });
        }
      }
    }
    frontier = nextFrontier;
  }
  return counters;
};

/** Directory listing used by `index status` and by directory-size sampling in the benchmarks. */
export const listWorkspaceDirectories = async ({ rootPath, policy }) => {
  const directories = [];
  await walkWorkspace({
    rootPath,
    policy,
    onDirectory: (entry) => directories.push(entry.relativePath)
  });
  return directories.sort();
};

export const openDirectorySafely = async (directoryPath) =>
  await opendir(directoryPath).catch(() => undefined);
