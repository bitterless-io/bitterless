import { constants as fsConstants } from 'node:fs';
import { lstat, open, opendir, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { CORE_EXCLUDED_DIRECTORY_NAMES, MAX_INDEX_DEPTH } from './constants.mjs';
import {
  classifySearchMediaType,
  mediaTypeToPreviewHint,
  readClassifiedSearchContent
} from './classification.mjs';
import { canOrderedGlobReincludeDescendant, isExcludedByOrderedGlobs } from './glob-config.mjs';
import { createBackgroundWorkSlicer } from './work-slicer.mjs';

const naturalCollator = new Intl.Collator('und', { numeric: true, sensitivity: 'base' });

const compareDirectoryEntries = (left, right) => {
  const leftDirectory = left.isDirectory();
  const rightDirectory = right.isDirectory();
  if (leftDirectory !== rightDirectory) return leftDirectory ? -1 : 1;
  const natural = naturalCollator.compare(left.name, right.name);
  return natural || left.name.localeCompare(right.name, 'und');
};

const normalizeRelative = (value) => value.replaceAll('\\', '/');

const isContainedPath = (rootPath, candidatePath) => {
  const relativePath = relative(rootPath, candidatePath);
  return (
    relativePath === '' ||
    (!relativePath.startsWith(`..${sep}`) && relativePath !== '..' && !isAbsolute(relativePath))
  );
};

const sameFileIdentity = (left, right) =>
  left.isFile() &&
  right.isFile() &&
  left.dev === right.dev &&
  left.ino === right.ino &&
  left.size === right.size &&
  Math.trunc(left.mtimeMs) === Math.trunc(right.mtimeMs);

const searchDirectorySegments = (relativePath, isDirectory) => {
  const segments = normalizeRelative(relativePath).split('/').filter(Boolean);
  if (!isDirectory) segments.pop();
  return segments;
};

export const createTraversalPolicy = ({ rules = [] } = {}) => {
  const isCoreExcluded = (relativePath, isDirectory) =>
    searchDirectorySegments(relativePath, isDirectory).some(
      (segment) => segment.startsWith('.') || CORE_EXCLUDED_DIRECTORY_NAMES.has(segment)
    );
  const isExcludedPath = (relativePath, isDirectory) =>
    isCoreExcluded(relativePath, isDirectory) || isExcludedByOrderedGlobs(relativePath, rules);
  const canTraverseExcludedDirectoryPath = (relativePath) =>
    !isCoreExcluded(relativePath, true) && canOrderedGlobReincludeDescendant(relativePath, rules);
  return {
    rules,
    isExcluded(relativePath, entry) {
      return isExcludedPath(relativePath, entry.isDirectory());
    },
    isExcludedFilePath(relativePath) {
      return isExcludedPath(relativePath, false);
    },
    isExcludedDirectoryPath(relativePath) {
      return isExcludedPath(relativePath, true);
    },
    canTraverseExcludedDirectoryPath,
    isPhysicallyExcludedPath(relativePath) {
      return (
        isExcludedPath(relativePath, false) ||
        (isExcludedPath(relativePath, true) && !canTraverseExcludedDirectoryPath(relativePath))
      );
    },
    canTraverseExcludedDirectory(relativePath, entry) {
      return entry.isDirectory() && canTraverseExcludedDirectoryPath(relativePath);
    }
  };
};

const createTreeEntry = ({ relativePath, stat, nodeKind, mediaType }) => ({
  relativePath,
  parentRelativePath:
    normalizeRelative(dirname(relativePath)) === '.'
      ? ''
      : normalizeRelative(dirname(relativePath)),
  name: basename(relativePath),
  nodeKind,
  size: nodeKind === 'file' ? stat.size : 0,
  modifiedAt: Math.trunc(stat.mtimeMs ?? 0),
  previewHint: nodeKind === 'file' ? mediaTypeToPreviewHint(mediaType) : 'unsupported',
  mediaType: nodeKind === 'file' ? mediaType : 'unknown',
  isText: nodeKind === 'file' && mediaType === 'text'
});

const openValidatedFile = async (rootRealPath, absolutePath, beforeStat) => {
  const canonicalPath = await realpath(absolutePath);
  if (!isContainedPath(rootRealPath, canonicalPath)) throw new TypeError('Path escaped workspace');
  const noFollow = fsConstants.O_NOFOLLOW ?? 0;
  const handle = await open(absolutePath, fsConstants.O_RDONLY | noFollow);
  try {
    const openedStat = await handle.stat();
    if (!sameFileIdentity(beforeStat, openedStat)) throw new TypeError('File identity changed');
    return { handle, canonicalPath, openedStat };
  } catch (error) {
    await handle.close();
    throw error;
  }
};

export const createWorkspaceTraversal = async ({
  rootPath,
  config,
  collectTreeEntries = true,
  metadataOnly = false,
  onTreeEntry,
  onProgress,
  shouldReadContent,
  scopeRelativePath = '',
  isCancelled = () => false,
  workSlicer = createBackgroundWorkSlicer()
}) => {
  const requestedRoot = resolve(rootPath);
  const rootStat = await lstat(requestedRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new TypeError('Search workspace root must be a real directory');
  }
  const rootRealPath = await realpath(requestedRoot);
  const scopePath = scopeRelativePath
    ? resolve(rootRealPath, ...scopeRelativePath.split('/'))
    : rootRealPath;
  const scopeRealPath = await realpath(scopePath);
  const scopeStat = await lstat(scopeRealPath);
  if (
    !scopeStat.isDirectory() ||
    scopeStat.isSymbolicLink() ||
    !isContainedPath(rootRealPath, scopeRealPath)
  ) {
    throw new TypeError('Search directory scope must be a contained real directory');
  }
  const policy = createTraversalPolicy(config);
  const treeEntries = [];
  const statistics = {
    fileCount: 0,
    directoryCount: 0,
    symlinkCount: 0,
    searchFileCount: 0,
    contentFileCount: 0,
    excludedEntryCount: 0,
    unreadableEntryCount: 0,
    maxDepthReached: false
  };

  const entries = (async function* streamWorkspace() {
    const visit = async function* visitDirectory(directoryPath, depth) {
      if (isCancelled()) return;
      let directory;
      try {
        directory = await opendir(directoryPath);
      } catch {
        statistics.unreadableEntryCount += 1;
        return;
      }
      const children = [];
      for await (const child of directory) children.push(child);
      children.sort(compareDirectoryEntries);
      const childDirectories = [];
      for (const child of children) {
        if (isCancelled()) return;
        await workSlicer.checkpoint();
        const absolutePath = join(directoryPath, child.name);
        const relativePath = normalizeRelative(relative(rootRealPath, absolutePath));
        if (!relativePath || relativePath.startsWith('../')) {
          statistics.excludedEntryCount += 1;
          continue;
        }
        const searchExcluded = policy.isExcluded(relativePath, child);
        const traverseExcludedDirectory =
          searchExcluded && policy.canTraverseExcludedDirectory(relativePath, child);
        if (searchExcluded && !traverseExcludedDirectory) {
          statistics.excludedEntryCount += 1;
          continue;
        }
        if (searchExcluded) statistics.excludedEntryCount += 1;
        if (child.isSymbolicLink()) {
          let linkStat;
          try {
            linkStat = await lstat(absolutePath);
          } catch {
            statistics.unreadableEntryCount += 1;
            continue;
          }
          const treeEntry = createTreeEntry({
            relativePath,
            stat: linkStat,
            nodeKind: 'symlink',
            mediaType: 'unknown'
          });
          if (collectTreeEntries) treeEntries.push(treeEntry);
          onTreeEntry?.(treeEntry);
          statistics.symlinkCount += 1;
          continue;
        }
        if (child.isDirectory()) {
          let directoryStat;
          let directoryRealPath;
          try {
            [directoryStat, directoryRealPath] = await Promise.all([
              lstat(absolutePath),
              realpath(absolutePath)
            ]);
          } catch {
            statistics.unreadableEntryCount += 1;
            continue;
          }
          if (!directoryStat.isDirectory() || !isContainedPath(rootRealPath, directoryRealPath)) {
            statistics.unreadableEntryCount += 1;
            continue;
          }
          if (!searchExcluded) {
            const treeEntry = createTreeEntry({
              relativePath,
              stat: directoryStat,
              nodeKind: 'directory',
              mediaType: 'unknown'
            });
            if (collectTreeEntries) treeEntries.push(treeEntry);
            onTreeEntry?.(treeEntry);
            statistics.directoryCount += 1;
          }
          if (depth >= MAX_INDEX_DEPTH) statistics.maxDepthReached = true;
          else childDirectories.push(directoryRealPath);
          continue;
        }
        if (!child.isFile()) continue;
        let beforeStat;
        let validated;
        try {
          beforeStat = await lstat(absolutePath);
          if (!beforeStat.isFile() || beforeStat.isSymbolicLink()) continue;
          if (metadataOnly) {
            const mediaType = classifySearchMediaType(relativePath);
            const treeEntry = createTreeEntry({
              relativePath,
              stat: beforeStat,
              nodeKind: 'file',
              mediaType
            });
            if (collectTreeEntries) treeEntries.push(treeEntry);
            onTreeEntry?.(treeEntry);
            statistics.fileCount += 1;
            statistics.searchFileCount += 1;
            yield {
              ...treeEntry,
              size: beforeStat.size,
              modifiedMs: Math.trunc(beforeStat.mtimeMs),
              contentIndexed: false,
              originalContent: ''
            };
            onProgress?.({ ...statistics });
            continue;
          }
          const cached = shouldReadContent?.({
            relativePath,
            size: beforeStat.size,
            modifiedMs: Math.trunc(beforeStat.mtimeMs)
          });
          if (cached?.unchanged === true) {
            const treeEntry = createTreeEntry({
              relativePath,
              stat: beforeStat,
              nodeKind: 'file',
              mediaType: cached.mediaType
            });
            if (collectTreeEntries) treeEntries.push(treeEntry);
            onTreeEntry?.(treeEntry);
            statistics.fileCount += 1;
            statistics.searchFileCount += 1;
            if (cached.contentIndexed) statistics.contentFileCount += 1;
            yield {
              ...treeEntry,
              size: beforeStat.size,
              modifiedMs: Math.trunc(beforeStat.mtimeMs),
              contentIndexed: cached.contentIndexed,
              originalContent: '',
              unchanged: true
            };
            continue;
          }
          validated = await openValidatedFile(rootRealPath, absolutePath, beforeStat);
          const classified = await readClassifiedSearchContent({
            handle: validated.handle,
            relativePath,
            size: validated.openedStat.size
          });
          const afterStat = await validated.handle.stat();
          if (!sameFileIdentity(validated.openedStat, afterStat)) {
            throw new TypeError('File changed while indexing');
          }
          const treeEntry = createTreeEntry({
            relativePath,
            stat: afterStat,
            nodeKind: 'file',
            mediaType: classified.mediaType
          });
          if (collectTreeEntries) treeEntries.push(treeEntry);
          onTreeEntry?.(treeEntry);
          statistics.fileCount += 1;
          statistics.searchFileCount += 1;
          if (classified.contentIndexed) statistics.contentFileCount += 1;
          yield {
            ...treeEntry,
            size: afterStat.size,
            modifiedMs: Math.trunc(afterStat.mtimeMs),
            contentIndexed: classified.contentIndexed,
            originalContent: classified.originalContent
          };
          onProgress?.({ ...statistics });
        } catch {
          statistics.unreadableEntryCount += 1;
        } finally {
          await validated?.handle.close().catch(() => undefined);
        }
      }
      for (const childDirectory of childDirectories) {
        if (isCancelled()) return;
        yield* visitDirectory(childDirectory, depth + 1);
      }
    };
    yield* visit(scopeRealPath, scopeRelativePath ? scopeRelativePath.split('/').length + 1 : 1);
  })();

  return { rootRealPath, entries, treeEntries, statistics };
};

export const countWorkspaceSearchEntries = async ({
  rootPath,
  config,
  isCancelled,
  workSlicer
}) => {
  const traversal = await createWorkspaceTraversal({
    rootPath,
    config,
    collectTreeEntries: false,
    metadataOnly: true,
    isCancelled,
    workSlicer
  });
  let count = 0;
  for await (const entry of traversal.entries) {
    if (entry !== undefined) count += 1;
  }
  return count;
};

export const readSingleWorkspaceFile = async ({ rootPath, relativePath }) => {
  const rootRealPath = await realpath(resolve(rootPath));
  const absolutePath = resolve(rootRealPath, ...relativePath.split('/'));
  if (!isContainedPath(rootRealPath, absolutePath)) throw new TypeError('Path escaped workspace');
  const beforeStat = await lstat(absolutePath);
  if (!beforeStat.isFile() || beforeStat.isSymbolicLink()) return undefined;
  const validated = await openValidatedFile(rootRealPath, absolutePath, beforeStat);
  try {
    const classified = await readClassifiedSearchContent({
      handle: validated.handle,
      relativePath,
      size: validated.openedStat.size
    });
    const afterStat = await validated.handle.stat();
    if (!sameFileIdentity(validated.openedStat, afterStat)) throw new TypeError('File changed');
    return {
      relativePath,
      size: afterStat.size,
      modifiedMs: Math.trunc(afterStat.mtimeMs),
      mediaType: classified.mediaType,
      contentIndexed: classified.contentIndexed,
      originalContent: classified.originalContent,
      previewHint: mediaTypeToPreviewHint(classified.mediaType)
    };
  } finally {
    await validated.handle.close();
  }
};

export const classifyTreePathWithoutIo = (relativePath) => {
  const mediaType = classifySearchMediaType(relativePath);
  return { mediaType, previewHint: mediaTypeToPreviewHint(mediaType) };
};
