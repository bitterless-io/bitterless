import { lstat, realpath } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';

import { BACKGROUND_BUILD_TRANSACTION_FILES, MAX_WATCH_CHANGE_PATHS } from './constants.mjs';
import {
  compareOnlyPreviewTreeEntries,
  sortOnlyPreviewTreeEntries
} from './tree-entries.mjs';
import { isWorkspaceSearchPathWithinDepth } from './traversal.mjs';
import {
  isWorkspaceConfigWatchPath,
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

// 导出给 `search-engine.mjs` 的 `forgetPaths` 用:删一个目录时,"哪些行属于它的子孙"这件事
// 两处必须用同一个判断,分叉了就会出现树里没了、`files` 表里还在的半删状态。
/**
 * `apply()` 的返回值:这批变更需要整库重建,但**没有就地重建**,请控制器按全量的规矩重排。
 *
 * 「要不要重建」是在这里才定的 —— 一个目录变更、一条超出深度上限的路径、一批超过
 * `MAX_WATCH_CHANGE_PATHS` 的改动,都会把一次自称增量的变更升级成重建。控制器的全量退避只看
 * 它自己派发时的 `full` 标志,于是最贵的那条路恰好整个绕开了冷却:参考机 5 小时 13 分跑了
 * 149 轮,每轮拷 2.75 GB、遍历 41,855 个条目,只为发现差 1 个文件(Ral 2026-09-22)。
 *
 * 把升级**交还**给控制器,而不是在这里就地跑完,既保住了「退避只挡全量、不挡真增量」那条既有
 * 契约(`onlyPreviewSearchEngineWatchBoundary` 钉着它),又让升级出来的重建走上和全量同一道闸。
 * 控制器派发 `full: true` 时不会再回到这条路:那时 `requiresFullReconcile` 本就为真,直接重建。
 *
 * **只有控制器会把 `deferRebuild` 打开。** 直接驱动引擎的调用方(测试、refresh)身后没有人替它
 * 重排,那里必须就地把重建做完 —— `onlyPreviewSearchEngineWatchBoundary` 的「超量突发」用例
 * 正是这样调的:它先关掉控制器,再直接 apply。
 */
export const REBUILD_REQUIRED = Symbol('onlypreview-watch-rebuild-required');

export const pathHasAncestorIn = (relativePath, ancestors) => {
  let candidate = relativePath;
  while (candidate) {
    if (ancestors.has(candidate)) return true;
    const separator = candidate.lastIndexOf('/');
    candidate = separator < 0 ? '' : candidate.slice(0, separator);
  }
  return false;
};

const pathIsDefinitelyPhysicallyExcluded = async (context, relativePath) => {
  const { searchPolicy, rootPath } = context;
  if (
    !searchPolicy.isPhysicallyExcludedPath(relativePath) ||
    searchPolicy.canTraverseExcludedDirectoryPath?.(relativePath) === true
  ) return false;
  if (searchPolicy.isExcludedFilePath(relativePath)) return true;
  // An excluded leaf name can also be a regular file; ancestors remain a metadata-free prune.
  const absolutePath = resolve(rootPath, ...relativePath.split('/'));
  if (!pathIsWithin(rootPath, absolutePath)) return false;
  try {
    if (await realpath(absolutePath) !== absolutePath) return false;
    return (await lstat(absolutePath)).isDirectory();
  } catch (error) {
    return error?.code === 'ENOENT';
  }
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

export { sortOnlyPreviewTreeEntries } from './tree-entries.mjs';

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

  async apply({ full, paths, renamePaths = [] }, { deferRebuild = false } = {}) {
    const context = this.resolveContext();
    if (full) await context.configReconciler?.probe();
    // Queries do not serialize against this reconcile: engine.search() holds a reader lease while
    // acquireSearchSnapshotWriter() below waits for readers to drain, so a query can begin, issue
    // its tokens and finish inside the window this commit is already open in. Mark the session we
    // observed on entry and revoke only that one, so a commit never destroys results a later query
    // produced. Authorities the commit invalidates still fail closed: every preview branch
    // re-verifies on-disk identity before returning bytes.
    const sessionMark = context.globalSearchSession.sessionMark();
    const normalizedPaths = [];
    const physicallyExcludedPaths = [];
    let requiresFullReconcile = full === true;
    for (const pathValue of paths) {
      const relativePath = normalizedWatchRelativePath(pathValue);
      if (!relativePath) {
        await context.configReconciler?.probe();
        requiresFullReconcile = true;
        continue;
      }
      if (isWorkspaceConfigWatchPath(relativePath)) {
        context.configReconciler?.markChanged();
        continue;
      }
      if (await pathIsDefinitelyPhysicallyExcluded(context, relativePath)) {
        physicallyExcludedPaths.push(relativePath);
        continue;
      }
      if (!isWorkspaceSearchPathWithinDepth(relativePath)) {
        requiresFullReconcile = true;
        continue;
      }
      normalizedPaths.push(relativePath);
    }
    if (physicallyExcludedPaths.length > 0) {
      await this.commitPhysicallyExcludedPaths(context, physicallyExcludedPaths);
    }
    if (!context.index) {
      if (requiresFullReconcile || normalizedPaths.length > 0) {
        context.watchNeedsFullReconcile = true;
      }
        return;
    }
    if (context.state !== 'ready') {
      if (requiresFullReconcile || normalizedPaths.length > 0) {
        context.watchNeedsFullReconcile = true;
      }
      return;
    }
    if (!context.treeMetadataReady) {
      if (deferRebuild) return REBUILD_REQUIRED;
      await context.refreshFromWatchInternal();
      this.emitWatchCommit(context, { full: true, paths: [] });
    return;
    }
    if (requiresFullReconcile || normalizedPaths.length > MAX_WATCH_CHANGE_PATHS) {
      if (deferRebuild) return REBUILD_REQUIRED;
      await context.refreshFromWatchInternal();
      this.emitWatchCommit(context, { full: true, paths: [] });
      return;
    }
    if (normalizedPaths.length === 0) return;
    const neededTreePaths = new Set();
    for (const relativePath of normalizedPaths) {
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
      if (deferRebuild) return REBUILD_REQUIRED;
      await context.refreshFromWatchInternal();
      this.emitWatchCommit(context, { full: true, paths: [] });
      return;
    }
    const committedPaths = new Set();
    const renamePathSet = new Set(renamePaths.map(normalizedWatchRelativePath).filter(Boolean));
    const mutations = [];
    requiresFullReconcile = false;
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
              ? { valid: true, entries: [] }
              : await this.readParentDirectoryTreeEntry(context, treeByPath, relativePath);
            if (!parent.valid) {
              requiresFullReconcile = true;
              break;
            }
            mutations.push({ kind: 'remove', relativePath, parentEntries: parent.entries });
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
              ? { valid: true, entries: [] }
              : await this.readParentDirectoryTreeEntry(context, treeByPath, relativePath);
            if (!parent.valid) {
              requiresFullReconcile = true;
              break;
            }
            mutations.push({ kind: 'remove', relativePath, parentEntries: parent.entries });
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
            mutations.push({ kind: 'upsert', relativePath, parentEntries: parent.entries });
          }
        } else requiresFullReconcile = true;
      } catch (error) {
        if (error?.code === 'ENOENT') {
          if (renameHint || replacesNonFile) {
            requiresFullReconcile = true;
            break;
          }
          const parent = context.searchPolicy.isPhysicallyExcludedPath(relativePath)
            ? { valid: true, entries: [] }
            : await this.readParentDirectoryTreeEntry(context, treeByPath, relativePath);
          if (!parent.valid) {
            requiresFullReconcile = true;
            break;
          }
          mutations.push({
            kind: 'remove',
            relativePath,
            parentEntries: parent.entries
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
        context.globalSearchSession.revokeSessionMark(sessionMark);
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
          // 一条变更可能带回整条新建的祖先链(见 readParentDirectoryTreeEntry),逐层落。
          for (const parentEntry of mutation.parentEntries ?? []) {
            if (pathHasAncestorIn(parentEntry.relativePath, treeReplacementPaths)) continue;
            replacementEntries.set(parentEntry.relativePath, parentEntry);
            treeUpserts.set(parentEntry.relativePath, parentEntry);
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
          const safeTree = context.index.readTreeSnapshot({
            searchPolicy: context.activeSearchPolicy ?? context.searchPolicy
          });
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

  async commitPhysicallyExcludedPaths(context, relativePaths) {
    const uniquePaths = [...new Set(relativePaths)];
    await this.emitBrowseListingsForChangedPaths(context, uniquePaths);
    for (let offset = 0; offset < uniquePaths.length; offset += MAX_WATCH_CHANGE_PATHS) {
      this.emitWatchCommit(context, {
        full: false,
        paths: uniquePaths.slice(offset, offset + MAX_WATCH_CHANGE_PATHS)
      });
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

  /**
   * 解析一个变更路径的父目录,必要时把**整条缺失的祖先链**一并补进树。
   *
   * 原来的规则是「父目录必须已经在索引树里」,否则判 `valid: false`,调用方据此升级成全量重建。
   * 于是「在一个新建的目录里建文件」这个每天都会做的动作 —— 新功能目录、git checkout 带出新目录、
   * 解压、脚手架生成 —— 每次都要克隆整库再遍历整棵树(参考机上 2.75 GB + 41,855 条目)。
   * 实测:往已在树里的目录加文件是 1.6–2.8 ms,往新目录加一个文件是一次完整重建(Ral 2026-09-22)。
   *
   * 「必须早就见过」从来不是安全所在。安全所在是每一层都要过的那套校验:在工作区根内、
   * `realpath` 与自身相等(这一条等于宣告整条路径上没有符号链接)、`lstat` 确实是目录。
   * 那套校验一层都没有放松,只是现在对缺失的每一层都跑一遍,而不是见到缺失就整棵重来。
   *
   * 仍然升级成全量的情形:任何一层过不了校验,或者树里存在同名但不是目录的条目 ——
   * 那时的分歧不止这一个文件,重建才是对的。
   */
  async readParentDirectoryTreeEntry(context, treeByPath, relativePath) {
    const parentRelativePath = normalizedRelativePath(dirname(relativePath));
    if (!parentRelativePath || parentRelativePath === '.') {
      return { valid: true, entries: [] };
    }
    // 从父目录向上收集树里还没有的层,直到碰到树里已有的目录为止。
    const missing = [];
    let current = parentRelativePath;
    while (current && current !== '.') {
      const existing = treeByPath.get(current);
      if (existing?.nodeKind === 'directory') break;
      // 树里有同名条目却不是目录:真的对不上,交给全量。
      if (existing !== undefined) return { valid: false, entries: [] };
      missing.push(current);
      current = normalizedRelativePath(dirname(current));
    }
    // 父目录即使已经在树里也要重新 stat 一次刷新 mtime —— 那是原来的行为,保持不变。
    if (missing.length === 0) missing.push(parentRelativePath);
    const entries = [];
    // 由外向内:先祖先后子目录,合并进树时顺序才是对的。
    for (const directoryRelativePath of missing.reverse()) {
      const entry = await this.readDirectoryTreeEntry(context, directoryRelativePath);
      if (!entry) return { valid: false, entries: [] };
      entries.push(entry);
    }
    return { valid: true, entries };
  }

  /** 单层目录的校验与取值 —— 与改动前逐字相同,只是现在可以对多层各跑一次。 */
  async readDirectoryTreeEntry(context, directoryRelativePath) {
    const absolutePath = resolve(context.rootPath, ...directoryRelativePath.split('/'));
    if (!pathIsWithin(context.rootPath, absolutePath)) return null;
    try {
      const canonicalPath = await realpath(absolutePath);
      if (canonicalPath !== absolutePath || !pathIsWithin(context.rootPath, canonicalPath)) {
        return null;
      }
      const currentStat = await lstat(absolutePath);
      if (
        !currentStat.isDirectory() ||
        currentStat.isSymbolicLink() ||
        (await realpath(absolutePath)) !== canonicalPath
      ) {
        return null;
      }
      return toTreeDirectoryEntry({
        relativePath: directoryRelativePath,
        modifiedMs: Math.trunc(currentStat.mtimeMs)
      });
    } catch {
      return null;
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
