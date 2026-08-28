import { lstat, realpath } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';

import { BACKGROUND_BUILD_TRANSACTION_FILES, MAX_WATCH_CHANGE_PATHS } from './constants.mjs';
import { isWorkspaceSearchPathWithinDepth } from './traversal.mjs';
import {
  WORKSPACE_CONFIG_RELATIVE_PATH,
  pathIsWithin
} from './workspace-config.mjs';

const normalizedRelativePath = (value) =>
  String(value ?? '')
    .replaceAll('\\', '/')
    .replace(/^\.\//u, '')
    .replace(/^\/+|\/+$/gu, '');

const normalizedWatchRelativePath = (value) => {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 16_384 ||
    value.includes('\0') ||
    value.startsWith('/') ||
    value.startsWith('\\') ||
    /^[a-zA-Z]:/u.test(value)
  )
    return undefined;
  const normalized = value.replaceAll('\\', '/');
  if (normalized.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
    return undefined;
  }
  return normalized;
};

const pathHasAncestorIn = (relativePath, ancestors) => {
  let candidate = relativePath;
  while (candidate) {
    if (ancestors.has(candidate)) return true;
    const separator = candidate.lastIndexOf('/');
    candidate = separator < 0 ? '' : candidate.slice(0, separator);
  }
  return false;
};

const toTreeFileEntry = (entry) => ({
  relativePath: entry.relativePath,
  parentRelativePath:
    normalizedRelativePath(dirname(entry.relativePath)) === '.'
      ? ''
      : normalizedRelativePath(dirname(entry.relativePath)),
  name: basename(entry.relativePath),
  nodeKind: 'file',
  size: entry.size,
  modifiedAt: entry.modifiedMs,
  previewHint: entry.previewHint,
  mediaType: entry.mediaType,
  isText: entry.mediaType === 'text'
});

const toTreeDirectoryEntry = ({ relativePath, modifiedMs }) => ({
  relativePath,
  parentRelativePath:
    normalizedRelativePath(dirname(relativePath)) === '.'
      ? ''
      : normalizedRelativePath(dirname(relativePath)),
  name: basename(relativePath),
  nodeKind: 'directory',
  size: 0,
  modifiedAt: modifiedMs,
  previewHint: 'unsupported',
  mediaType: 'unknown',
  isText: false
});

const treeEntryCollator = new Intl.Collator('und', { numeric: true, sensitivity: 'base' });

const compareOnlyPreviewTreeEntries = (left, right) => {
  const leftSegments = left.relativePath.split('/');
  const rightSegments = right.relativePath.split('/');
  const length = Math.min(leftSegments.length, rightSegments.length);
  for (let index = 0; index < length; index += 1) {
    if (leftSegments[index] === rightSegments[index]) continue;
    const leftIsParent = index === leftSegments.length - 1 && left.nodeKind === 'directory';
    const rightIsParent = index === rightSegments.length - 1 && right.nodeKind === 'directory';
    if (leftIsParent !== rightIsParent) return leftIsParent ? -1 : 1;
    return (
      treeEntryCollator.compare(leftSegments[index], rightSegments[index]) ||
      leftSegments[index].localeCompare(rightSegments[index], 'und')
    );
  }
  return leftSegments.length - rightSegments.length;
};

export const sortOnlyPreviewTreeEntries = (entries) =>
  [...entries].sort(compareOnlyPreviewTreeEntries);

export const mergeOnlyPreviewTreeEntries = (leftEntries, rightEntries) => {
  const merged = [];
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < leftEntries.length && rightIndex < rightEntries.length) {
    if (compareOnlyPreviewTreeEntries(leftEntries[leftIndex], rightEntries[rightIndex]) <= 0) {
      merged.push(leftEntries[leftIndex]);
      leftIndex += 1;
    } else {
      merged.push(rightEntries[rightIndex]);
      rightIndex += 1;
    }
  }
  while (leftIndex < leftEntries.length) {
    merged.push(leftEntries[leftIndex]);
    leftIndex += 1;
  }
  while (rightIndex < rightEntries.length) {
    merged.push(rightEntries[rightIndex]);
    rightIndex += 1;
  }
  return merged;
};

export const selectOnlyPreviewTreeEntries = (entries, neededPaths) => {
  const selected = new Map();
  for (const entry of entries) {
    if (!neededPaths.has(entry.relativePath)) continue;
    const previous = selected.get(entry.relativePath);
    if (!previous || entry.nodeKind !== 'file') selected.set(entry.relativePath, entry);
  }
  return selected;
};

class OnlyPreviewSearchWatchReconciler {
  constructor({ readWorkspaceFile, resolveContext }) {
    this.readWorkspaceFile = readWorkspaceFile;
    this.resolveContext = resolveContext;
  }

  async apply({ full, paths, renamePaths = [] }) {
    const context = this.resolveContext();
    if (!context.index) return;
    if (context.state !== 'ready') {
      context.watchNeedsFullReconcile = true;
      return;
    }
    if (!context.treeMetadataReady) {
      await context.refreshFromWatchInternal();
      this.emitWatchCommit(context, { full: true, paths: [] });
      return;
    }
    if (full || paths.length > MAX_WATCH_CHANGE_PATHS) {
      await context.refreshFromWatchInternal();
      this.emitWatchCommit(context, { full: true, paths: [] });
      return;
    }
    const normalizedPaths = [];
    const neededTreePaths = new Set();
    for (const pathValue of paths) {
      const relativePath = normalizedWatchRelativePath(pathValue);
      if (
        !relativePath ||
        relativePath === WORKSPACE_CONFIG_RELATIVE_PATH ||
        !isWorkspaceSearchPathWithinDepth(relativePath)
      ) {
        await context.refreshFromWatchInternal();
        this.emitWatchCommit(context, { full: true, paths: [] });
        return;
      }
      normalizedPaths.push(relativePath);
      neededTreePaths.add(relativePath);
      const parent = normalizedRelativePath(dirname(relativePath));
      if (parent && parent !== '.') neededTreePaths.add(parent);
    }
    const treeByPath = selectOnlyPreviewTreeEntries(context.treeEntries, neededTreePaths);
    if (
      normalizedPaths.some((relativePath) => {
        const entry = treeByPath.get(relativePath);
        return entry !== undefined && entry.nodeKind !== 'file';
      })
    ) {
      await context.refreshFromWatchInternal();
      this.emitWatchCommit(context, { full: true, paths: [] });
      return;
    }
    const committedPaths = new Set();
    const renamePathSet = new Set(renamePaths);
    const mutations = [];
    let requiresFullReconcile = false;
    for (const relativePath of normalizedPaths) {
      committedPaths.add(relativePath);
      const renameHint = renamePathSet.has(relativePath);
      const previousTreeEntry = treeByPath.get(relativePath);
      const replacesNonFile = previousTreeEntry?.nodeKind !== undefined &&
        previousTreeEntry.nodeKind !== 'file';
      const absolutePath = resolve(context.rootPath, ...relativePath.split('/'));
      if (!pathIsWithin(context.rootPath, absolutePath)) {
        requiresFullReconcile = true;
        break;
      }
      try {
        const canonicalPath = await realpath(absolutePath);
        if (canonicalPath !== absolutePath || !pathIsWithin(context.rootPath, canonicalPath)) {
          requiresFullReconcile = true;
          break;
        }
        const currentStat = await lstat(absolutePath);
        if ((await realpath(absolutePath)) !== canonicalPath) {
          requiresFullReconcile = true;
          break;
        }
        if (currentStat.isDirectory()) {
          requiresFullReconcile = true;
        } else if (currentStat.isSymbolicLink()) {
          if (context.searchPolicy.isExcludedFilePath(relativePath)) {
            const parent = context.searchPolicy.isPhysicallyExcludedPath(relativePath)
              ? { valid: true, entry: undefined }
              : await this.readParentDirectoryTreeEntry(context, treeByPath, relativePath);
            if (!parent.valid) {
              requiresFullReconcile = true;
              break;
            }
            mutations.push({ kind: 'remove', relativePath, parentEntry: parent.entry });
          } else {
            requiresFullReconcile = true;
          }
        } else if (currentStat.isFile()) {
          if (replacesNonFile) {
            requiresFullReconcile = true;
            break;
          }
          const searchExcluded = context.searchPolicy.isExcludedFilePath(relativePath);
          if (searchExcluded) {
            const parent = context.searchPolicy.isPhysicallyExcludedPath(relativePath)
              ? { valid: true, entry: undefined }
              : await this.readParentDirectoryTreeEntry(context, treeByPath, relativePath);
            if (!parent.valid) {
              requiresFullReconcile = true;
              break;
            }
            mutations.push({ kind: 'remove', relativePath, parentEntry: parent.entry });
          } else {
            const parent = await this.readParentDirectoryTreeEntry(
              context,
              treeByPath,
              relativePath
            );
            if (!parent.valid) {
              requiresFullReconcile = true;
              break;
            }
            mutations.push({ kind: 'upsert', relativePath, parentEntry: parent.entry });
          }
        } else requiresFullReconcile = true;
      } catch (error) {
        if (error?.code === 'ENOENT') {
          if (renameHint || replacesNonFile) {
            requiresFullReconcile = true;
            break;
          }
          const parent = context.searchPolicy.isPhysicallyExcludedPath(relativePath)
            ? { valid: true, entry: undefined }
            : await this.readParentDirectoryTreeEntry(context, treeByPath, relativePath);
          if (!parent.valid) {
            requiresFullReconcile = true;
            break;
          }
          mutations.push({
            kind: 'remove',
            relativePath,
            parentEntry: parent.entry
          });
        } else requiresFullReconcile = true;
      }
      if (requiresFullReconcile) break;
    }
    if (requiresFullReconcile) {
      await context.refreshFromWatchInternal();
      this.emitWatchCommit(context, { full: true, paths: [] });
    } else {
      const writer = await context.acquireSearchSnapshotWriter();
      let commitNeedsFullReconcile = false;
      try {
        context.globalSearchSession.revoke();
        context.index.invalidateTreeSnapshot();
        const removedPaths = new Set(
          mutations
            .filter(({ kind }) => kind === 'remove')
            .map(({ relativePath }) => relativePath)
        );
        const treeReplacementPaths = new Set([
          ...removedPaths,
          ...mutations
            .filter(({ kind }) => kind === 'upsert')
            .map(({ relativePath }) => relativePath)
        ]);
        const replacementEntries = new Map();
        const treeUpserts = new Map();
        for (
          let offset = 0;
          offset < mutations.length;
          offset += BACKGROUND_BUILD_TRANSACTION_FILES
        ) {
          const batch = mutations.slice(offset, offset + BACKGROUND_BUILD_TRANSACTION_FILES);
          const preparedUpserts = [];
          for (const mutation of batch) {
            if (mutation.kind !== 'upsert') continue;
            const entry = await this.readWorkspaceFile({
              rootPath: context.rootPath,
              relativePath: mutation.relativePath
            });
            if (!entry) {
              throw Object.assign(new TypeError('Watch file changed during incremental commit'), {
                code: 'WATCH_RECONCILE_REQUIRED'
              });
            }
            preparedUpserts.push({ mutation, entry, treeEntry: toTreeFileEntry(entry) });
          }
          const deletedIndexedPaths = [];
          context.index.runMutation(() => {
            for (const mutation of batch) {
              if (
                mutation.kind === 'remove' &&
                context.index.delete(mutation.relativePath, {
                  syncFilenameTier: false,
                  withinTransaction: true
                })
              ) {
                deletedIndexedPaths.push(mutation.relativePath);
              }
            }
            for (const prepared of preparedUpserts) {
              context.index.upsert(prepared.entry, {
                syncFilenameTier: false,
                withinTransaction: true
              });
            }
          });
          context.index.applyFilenameTierMutations({
            upsertPaths: preparedUpserts.map(({ mutation }) => mutation.relativePath),
            deletePaths: deletedIndexedPaths
          });
          for (const prepared of preparedUpserts) {
            replacementEntries.set(prepared.treeEntry.relativePath, prepared.treeEntry);
          }
        }
        for (const mutation of mutations) {
          if (
            mutation.parentEntry &&
            !pathHasAncestorIn(mutation.parentEntry.relativePath, treeReplacementPaths)
          ) {
            replacementEntries.set(mutation.parentEntry.relativePath, mutation.parentEntry);
            treeUpserts.set(mutation.parentEntry.relativePath, mutation.parentEntry);
          }
        }
        const replacementPaths = new Set(replacementEntries.keys());
        const retainedTreeEntries = context.treeEntries.filter(
          ({ relativePath }) =>
            !replacementPaths.has(relativePath) &&
            !pathHasAncestorIn(relativePath, removedPaths)
        );
        const nextTreeEntries = mergeOnlyPreviewTreeEntries(
          retainedTreeEntries,
          sortOnlyPreviewTreeEntries(replacementEntries.values())
        );
        const committedTree = context.index.applyTreeSnapshotMutations({
          upserts: [...treeUpserts.values()],
          removedPaths: treeReplacementPaths,
          maxDepthReached: context.maxDepthReached
        });
        context.treeEntries = nextTreeEntries;
        context.treeMetadataReady = committedTree.treeMetadataReady;
      } catch (error) {
        try {
          context.index.hydrateFilenameTier();
          const safeTree = context.index.readTreeSnapshot();
          context.treeEntries = sortOnlyPreviewTreeEntries(safeTree.entries);
          context.maxDepthReached = safeTree.maxDepthReached;
          context.treeMetadataReady = safeTree.treeMetadataReady;
        } catch {
          context.treeEntries = [];
          context.maxDepthReached = false;
          context.treeMetadataReady = false;
        }
        if (error?.code === 'WATCH_RECONCILE_REQUIRED') commitNeedsFullReconcile = true;
        else throw error;
      } finally {
        writer.release();
      }
      if (commitNeedsFullReconcile) {
        await context.refreshFromWatchInternal();
        this.emitWatchCommit(context, { full: true, paths: [] });
        return;
      }
      await context.emitSnapshot();
      await this.emitBrowseListingsForChangedPaths(context, [...committedPaths]);
      this.emitWatchCommit(context, { full: false, paths: [...committedPaths] });
    }
  }

  emitWatchCommit(context, { full, paths }) {
    if (!context.workspaceId || !Number.isSafeInteger(context.generation)) return;
    const uniquePaths = [...new Set(paths)];
    const boundedFull =
      full ||
      uniquePaths.length > MAX_WATCH_CHANGE_PATHS ||
      uniquePaths.some((path) => normalizedWatchRelativePath(path) !== path);
    const commit = {
      workspaceId: context.workspaceId,
      generation: context.generation,
      revision: ++context.watchCommitRevision,
      full: boundedFull,
      changedRelativePaths: boundedFull ? [] : uniquePaths
    };
    try {
      context.onWatchCommit?.(commit);
    } catch {
      // Delivery failure cannot roll back an already committed index transaction.
    }
  }

  async readParentDirectoryTreeEntry(context, treeByPath, relativePath) {
    const parentRelativePath = normalizedRelativePath(dirname(relativePath));
    if (!parentRelativePath || parentRelativePath === '.') {
      return { valid: true, entry: undefined };
    }
    const existingParent = treeByPath.get(parentRelativePath);
    if (existingParent?.nodeKind !== 'directory') return { valid: false, entry: undefined };
    const absolutePath = resolve(context.rootPath, ...parentRelativePath.split('/'));
    if (!pathIsWithin(context.rootPath, absolutePath)) return { valid: false, entry: undefined };
    try {
      const canonicalPath = await realpath(absolutePath);
      if (canonicalPath !== absolutePath || !pathIsWithin(context.rootPath, canonicalPath)) {
        return { valid: false, entry: undefined };
      }
      const currentStat = await lstat(absolutePath);
      if (
        !currentStat.isDirectory() ||
        currentStat.isSymbolicLink() ||
        (await realpath(absolutePath)) !== canonicalPath
      ) {
        return { valid: false, entry: undefined };
      }
      return {
        valid: true,
        entry: toTreeDirectoryEntry({
          relativePath: parentRelativePath,
          modifiedMs: Math.trunc(currentStat.mtimeMs)
        })
      };
    } catch {
      return { valid: false, entry: undefined };
    }
  }

  async emitBrowseListingsForChangedPaths(context, relativePaths) {
    if (!context.workspaceId || !Number.isSafeInteger(context.generation) || !context.browseIndex) {
      return;
    }
    const parentPaths = new Set(
      relativePaths.map((relativePath) => {
        const parent = normalizedRelativePath(dirname(relativePath));
        return parent === '.' ? '' : parent;
      })
    );
    for (const relativePath of parentPaths) {
      const directoryToken = context.browseIndex.directoryTokenForListedPath(relativePath);
      if (!directoryToken) continue;
      try {
        const listing = await context.browseIndex.list({
          workspaceId: context.workspaceId,
          generation: context.generation,
          directoryToken
        });
        context.onBrowseListing?.(listing);
      } catch {
        // A concurrent rename/delete will be represented by the next watch batch.
      }
    }
  }
}

export const createOnlyPreviewSearchWatchReconciler = (options) =>
  new OnlyPreviewSearchWatchReconciler(options);
