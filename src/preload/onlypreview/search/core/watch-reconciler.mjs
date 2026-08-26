import { lstat, realpath } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';

import { MAX_WATCH_CHANGE_PATHS } from './constants.mjs';
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

export const sortOnlyPreviewTreeEntries = (entries) => {
  const collator = new Intl.Collator('und', { numeric: true, sensitivity: 'base' });
  return [...entries].sort((left, right) => {
    const leftSegments = left.relativePath.split('/');
    const rightSegments = right.relativePath.split('/');
    const length = Math.min(leftSegments.length, rightSegments.length);
    for (let index = 0; index < length; index += 1) {
      if (leftSegments[index] === rightSegments[index]) continue;
      const leftIsParent = index === leftSegments.length - 1 && left.nodeKind === 'directory';
      const rightIsParent = index === rightSegments.length - 1 && right.nodeKind === 'directory';
      if (leftIsParent !== rightIsParent) return leftIsParent ? -1 : 1;
      return (
        collator.compare(leftSegments[index], rightSegments[index]) ||
        leftSegments[index].localeCompare(rightSegments[index], 'und')
      );
    }
    return leftSegments.length - rightSegments.length;
  });
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
    if (
      full ||
      paths.length > MAX_WATCH_CHANGE_PATHS ||
      paths.some((path) => normalizedRelativePath(path) === WORKSPACE_CONFIG_RELATIVE_PATH)
    ) {
      await context.refreshInternal();
      this.emitWatchCommit(context, { full: true, paths: [] });
      return;
    }
    let requiresFullReconcile = false;
    const committedPaths = new Set();
    const renamePathSet = new Set(renamePaths);
    for (const pathValue of paths) {
      const relativePath = normalizedWatchRelativePath(pathValue);
      if (!relativePath) {
        requiresFullReconcile = true;
        continue;
      }
      committedPaths.add(relativePath);
      const renameHint = renamePathSet.has(relativePath);
      const previousTreeEntry = renameHint
        ? context.treeEntries.find((entry) => entry.relativePath === relativePath)
        : undefined;
      const absolutePath = resolve(context.rootPath, ...relativePath.split('/'));
      if (!pathIsWithin(context.rootPath, absolutePath)) {
        requiresFullReconcile = true;
        continue;
      }
      try {
        const canonicalPath = await realpath(absolutePath);
        if (canonicalPath !== absolutePath || !pathIsWithin(context.rootPath, canonicalPath)) {
          requiresFullReconcile = true;
          continue;
        }
        const currentStat = await lstat(absolutePath);
        if ((await realpath(absolutePath)) !== canonicalPath) {
          requiresFullReconcile = true;
          continue;
        }
        if (currentStat.isDirectory()) {
          if (
            context.searchPolicy.isExcludedDirectoryPath(relativePath) &&
            !context.searchPolicy.canTraverseExcludedDirectoryPath(relativePath)
          ) {
            this.removeTreePath(context, relativePath);
            context.index.delete(relativePath);
          } else {
            requiresFullReconcile = true;
          }
        } else if (currentStat.isSymbolicLink()) {
          context.index.delete(relativePath);
          if (context.searchPolicy.isExcludedFilePath(relativePath)) {
            this.removeTreePath(context, relativePath);
          } else {
            requiresFullReconcile = true;
          }
        } else if (currentStat.isFile()) {
          if (renameHint && previousTreeEntry?.nodeKind !== 'file') {
            requiresFullReconcile = true;
            continue;
          }
          const searchExcluded = context.searchPolicy.isExcludedFilePath(relativePath);
          if (searchExcluded) {
            context.index.delete(relativePath);
            this.removeTreePath(context, relativePath);
          } else {
            const entry = await this.readWorkspaceFile({
              rootPath: context.rootPath,
              relativePath
            });
            if (entry) {
              context.index.upsert(entry);
              this.upsertTreeEntry(context, toTreeFileEntry(entry));
            } else requiresFullReconcile = true;
          }
          if (
            !searchExcluded &&
            !(await this.refreshParentDirectoryTreeEntry(context, relativePath))
          ) {
            requiresFullReconcile = true;
          }
        } else requiresFullReconcile = true;
      } catch (error) {
        if (error?.code === 'ENOENT') {
          if (renameHint) requiresFullReconcile = true;
          this.removeTreePath(context, relativePath);
          context.index.delete(relativePath);
          if (
            !context.searchPolicy.isPhysicallyExcludedPath(relativePath) &&
            !(await this.refreshParentDirectoryTreeEntry(context, relativePath))
          ) {
            requiresFullReconcile = true;
          }
        } else requiresFullReconcile = true;
      }
    }
    if (requiresFullReconcile) {
      await context.refreshInternal();
      this.emitWatchCommit(context, { full: true, paths: [] });
    } else {
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

  upsertTreeEntry(context, entry) {
    const index = context.treeEntries.findIndex(
      ({ relativePath }) => relativePath === entry.relativePath
    );
    if (index >= 0) context.treeEntries[index] = entry;
    else context.treeEntries.push(entry);
    context.treeEntries = sortOnlyPreviewTreeEntries(context.treeEntries);
  }

  async refreshParentDirectoryTreeEntry(context, relativePath) {
    const parentRelativePath = normalizedRelativePath(dirname(relativePath));
    if (!parentRelativePath || parentRelativePath === '.') return true;
    const existingParent = context.treeEntries.find(
      (entry) => entry.relativePath === parentRelativePath
    );
    if (existingParent?.nodeKind !== 'directory') return false;
    const absolutePath = resolve(context.rootPath, ...parentRelativePath.split('/'));
    if (!pathIsWithin(context.rootPath, absolutePath)) return false;
    try {
      const canonicalPath = await realpath(absolutePath);
      if (canonicalPath !== absolutePath || !pathIsWithin(context.rootPath, canonicalPath)) {
        return false;
      }
      const currentStat = await lstat(absolutePath);
      if (
        !currentStat.isDirectory() ||
        currentStat.isSymbolicLink() ||
        (await realpath(absolutePath)) !== canonicalPath
      ) {
        return false;
      }
      this.upsertTreeEntry(
        context,
        toTreeDirectoryEntry({
          relativePath: parentRelativePath,
          modifiedMs: Math.trunc(currentStat.mtimeMs)
        })
      );
      return true;
    } catch {
      return false;
    }
  }

  removeTreePath(context, relativePath) {
    context.treeEntries = context.treeEntries.filter(
      (entry) =>
        entry.relativePath !== relativePath && !entry.relativePath.startsWith(`${relativePath}/`)
    );
    for (const indexedPath of [...(context.index?.filenameTier.records.keys() ?? [])]) {
      if (indexedPath.startsWith(`${relativePath}/`)) context.index.delete(indexedPath);
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
