import { createHash } from 'node:crypto';
import { lstat, mkdir, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, resolve } from 'node:path';

import { MAX_WATCH_CHANGE_PATHS, ONE_GIB_BYTES, TWO_GIB_BYTES } from './constants.mjs';
import { SEARCH_ENGINE_IDENTITY, OnlyPreviewSqliteIndex } from './sqlite-index.mjs';
import {
  countWorkspaceSearchEntries,
  createTraversalPolicy,
  createWorkspaceTraversal,
  readSingleWorkspaceFile
} from './traversal.mjs';
import { createOnlyPreviewBrowseIndex } from './browse-index.mjs';
import {
  WORKSPACE_CONFIG_RELATIVE_PATH,
  loadOnlyPreviewWorkspaceConfig,
  pathIsWithin
} from './workspace-config.mjs';
import { createWorkspaceWatchController } from './watch-controller.mjs';

const engineHash = createHash('sha256').update(SEARCH_ENGINE_IDENTITY).digest('hex');

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

const prospectiveRealPath = async (candidatePath) => {
  const missingSegments = [];
  let existingPath = candidatePath;
  while (true) {
    try {
      return resolve(await realpath(existingPath), ...missingSegments.reverse());
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      const parentPath = dirname(existingPath);
      if (parentPath === existingPath) throw error;
      missingSegments.push(basename(existingPath));
      existingPath = parentPath;
    }
  }
};

const requireSearchScope = (scope, treeEntries, hasBrowseDirectory = () => false) => {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
    throw new TypeError('Invalid search scope');
  }
  if (scope.kind === 'project') {
    if (Object.keys(scope).length !== 1) throw new TypeError('Invalid search scope');
    return { kind: 'project' };
  }
  if (
    scope.kind !== 'directory' ||
    Object.keys(scope).sort().join(',') !== 'kind,relativePath' ||
    typeof scope.relativePath !== 'string' ||
    scope.relativePath.length > 16_384 ||
    scope.relativePath.includes('\0') ||
    scope.relativePath.startsWith('/') ||
    scope.relativePath.includes('\\') ||
    /^[a-zA-Z]:/u.test(scope.relativePath) ||
    scope.relativePath
      .split('/')
      .some(
        (segment) => (!segment && scope.relativePath !== '') || segment === '.' || segment === '..'
      )
  ) {
    throw new TypeError('Invalid search scope');
  }
  if (
    scope.relativePath &&
    !treeEntries.some(
      (entry) => entry.nodeKind === 'directory' && entry.relativePath === scope.relativePath
    ) &&
    !hasBrowseDirectory(scope.relativePath)
  ) {
    throw new TypeError('Search directory scope does not exist');
  }
  return { kind: 'directory', relativePath: scope.relativePath };
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

const sortTreeEntries = (entries) => {
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

const estimateTreeMetadataBytes = (entries) =>
  entries.reduce(
    (total, entry) =>
      total +
      96 +
      2 *
        (entry.relativePath.length +
          entry.parentRelativePath.length +
          entry.name.length +
          entry.previewHint.length +
          entry.mediaType.length),
    0
  );

export const assessOnlyPreviewSearchMemory = ({
  measurementComplete,
  processRssBytes,
  workerHeapUsedBytes,
  workerExternalBytes,
  filenameTierEstimatedBytes,
  treeMetadataEntryCount,
  treeMetadataEstimatedBytes,
  diskIndexBytes
}) => {
  const runtimeSignals = [
    processRssBytes,
    workerHeapUsedBytes,
    workerExternalBytes,
    filenameTierEstimatedBytes
  ].filter((value) => Number.isFinite(value));
  return {
    measurementComplete,
    processRssBytes,
    workerHeapUsedBytes,
    workerExternalBytes,
    filenameTierEstimatedBytes,
    treeMetadataEntryCount,
    treeMetadataEstimatedBytes,
    diskIndexBytes,
    runtimeOneGiBWarning: runtimeSignals.some((value) => value > ONE_GIB_BYTES),
    runtimeTwoGiBLimitExceeded: runtimeSignals.some((value) => value > TWO_GIB_BYTES)
  };
};

export class OnlyPreviewSearchEngine {
  constructor({
    onBrowseListing,
    onProgress,
    onSnapshot,
    onWatchCommit,
    readWorkspaceFile = readSingleWorkspaceFile
  } = {}) {
    this.onBrowseListing = onBrowseListing;
    this.onProgress = onProgress;
    this.onSnapshot = onSnapshot;
    this.onWatchCommit = onWatchCommit;
    this.readWorkspaceFile = readWorkspaceFile;
    this.state = 'building';
    this.treeEntries = [];
    this.maxDepthReached = false;
    this.operationTail = Promise.resolve();
    this.snapshotEmitTail = Promise.resolve();
    this.watchRevision = 0;
    this.watchCommitRevision = 0;
    this.buildRevision = 0;
  }

  enqueue(operation) {
    const result = this.operationTail.then(operation);
    this.operationTail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  requireWorkspace(workspaceId, generation) {
    if (!this.index || workspaceId !== this.workspaceId || generation !== this.generation) {
      throw new TypeError('Search workspace generation is stale');
    }
  }

  async initialize({ workspaceId, generation, rootPath, databasePath }) {
    return await this.enqueue(
      async () =>
        await this.initializeInternal({
          workspaceId,
          generation,
          rootPath,
          databasePath
        })
    );
  }

  async initializeInternal({ workspaceId, generation, rootPath, databasePath }) {
    await this.shutdownInternal();
    if (!isAbsolute(rootPath) || !isAbsolute(databasePath)) {
      throw new TypeError('Search authority paths must be absolute');
    }
    const rootRealPath = await realpath(resolve(rootPath));
    const databaseRealPath = await prospectiveRealPath(resolve(databasePath));
    if (pathIsWithin(rootRealPath, databaseRealPath)) {
      throw new TypeError('Search database must stay outside the workspace');
    }
    await mkdir(dirname(databaseRealPath), { recursive: true });
    this.workspaceId = workspaceId;
    this.generation = generation;
    this.watchCommitRevision = 0;
    this.rootPath = rootRealPath;
    this.databasePath = databaseRealPath;
    this.config = await loadOnlyPreviewWorkspaceConfig(rootRealPath);
    this.searchPolicy = createTraversalPolicy(this.config);
    this.index = new OnlyPreviewSqliteIndex(this.databasePath);
    this.browseIndex = createOnlyPreviewBrowseIndex(this.rootPath);
    this.identity = {
      workspaceHash: createHash('sha256').update(rootRealPath).digest('hex'),
      configHash: this.config.hash,
      engineHash
    };
    const canReconcile = this.index.canReconcile(this.identity);
    const watchRevision = ++this.watchRevision;
    this.watchController = createWorkspaceWatchController({
      rootPath: this.rootPath,
      onReconcile: (change) =>
        this.enqueue(async () => {
          if (this.watchRevision !== watchRevision) return;
          await this.applyWatchChangesInternal(change);
        }),
      onError: () => undefined
    });
    this.state = canReconcile ? 'reconciling' : 'building';
    this.treeEntries = [];
    await this.emitRootBrowseListing();
    const buildRevision = ++this.buildRevision;
    this.emitBuildProgress({ buildRevision, phase: 'counting' });
    await this.emitSnapshot();
    const total = await countWorkspaceSearchEntries({
      rootPath: this.rootPath,
      config: this.config
    });
    this.emitBuildProgress({ buildRevision, phase: 'indexing', completed: 0, total });
    await this.runTraversal({ reconcileExisting: canReconcile, buildRevision, total });
    this.state = 'ready';
    await this.emitSnapshot();
    if (this.watchNeedsFullReconcile) {
      this.watchNeedsFullReconcile = false;
      this.watchController.requestFullReconcile();
    }
    return await this.snapshot();
  }

  async runTraversal({ reconcileExisting, buildRevision, total }) {
    const traversal = await createWorkspaceTraversal({
      rootPath: this.rootPath,
      config: this.config,
      onTreeEntry: (entry) => this.treeEntries.push(entry),
      shouldReadContent: reconcileExisting
        ? (metadata) => this.index.metadataForTraversal(metadata)
        : undefined
    });
    let lastReportedCompleted = 0;
    const onBatch = ({ fileCount }) => {
      const completed = Math.min(total, fileCount);
      if (completed < total && completed - lastReportedCompleted < 256) return;
      lastReportedCompleted = completed;
      this.emitBuildProgress({
        buildRevision,
        phase: 'indexing',
        completed,
        total
      });
    };
    const outcome = reconcileExisting
      ? await this.index.reconcile(traversal.entries, this.identity, { onBatch })
      : await this.index.rebuild(traversal.entries, this.identity, { onBatch });
    const completed = Math.min(total, outcome.fileCount);
    if (completed !== lastReportedCompleted) {
      this.emitBuildProgress({
        buildRevision,
        phase: 'indexing',
        completed,
        total
      });
    }
    this.treeEntries = sortTreeEntries(traversal.treeEntries);
    this.maxDepthReached = traversal.statistics.maxDepthReached;
  }

  async refresh({ workspaceId, generation }) {
    this.requireWorkspace(workspaceId, generation);
    if (this.refreshPromise) return await this.refreshPromise;
    this.refreshPromise = this.enqueue(async () => await this.refreshInternal()).finally(() => {
      this.refreshPromise = undefined;
    });
    return await this.refreshPromise;
  }

  async refreshInternal() {
    const nextConfig = await loadOnlyPreviewWorkspaceConfig(this.rootPath);
    const configChanged = nextConfig.hash !== this.config.hash;
    this.config = nextConfig;
    this.searchPolicy = createTraversalPolicy(nextConfig);
    this.identity = { ...this.identity, configHash: nextConfig.hash };
    this.state = configChanged ? 'building' : 'reconciling';
    this.browseIndex.reset();
    await this.emitRootBrowseListing();
    const buildRevision = ++this.buildRevision;
    this.emitBuildProgress({ buildRevision, phase: 'counting' });
    await this.emitSnapshot();
    this.treeEntries = [];
    const total = await countWorkspaceSearchEntries({
      rootPath: this.rootPath,
      config: this.config
    });
    this.emitBuildProgress({ buildRevision, phase: 'indexing', completed: 0, total });
    await this.runTraversal({
      reconcileExisting: !configChanged && this.index.canReconcile(this.identity),
      buildRevision,
      total
    });
    this.state = 'ready';
    await this.emitSnapshot();
    if (this.watchNeedsFullReconcile) {
      this.watchNeedsFullReconcile = false;
      this.watchController?.requestFullReconcile();
    }
    return await this.snapshot();
  }

  async browseDirectory({ workspaceId, generation, directoryToken }) {
    this.requireWorkspace(workspaceId, generation);
    if (!this.browseIndex) throw new TypeError('Browse workspace is not initialized');
    return await this.browseIndex.list({ workspaceId, generation, directoryToken });
  }

  async search({
    workspaceId,
    generation,
    requestId,
    query,
    maxResults,
    scope,
    cancelBuffer,
    onResult
  }) {
    this.requireWorkspace(workspaceId, generation);
    return await this.enqueue(
      async () =>
        await this.searchInternal({
          workspaceId,
          generation,
          requestId,
          query,
          maxResults,
          scope,
          cancelBuffer,
          onResult
        })
    );
  }

  async searchInternal({
    workspaceId,
    generation,
    requestId,
    query,
    maxResults,
    scope,
    cancelBuffer,
    onResult
  }) {
    this.requireWorkspace(workspaceId, generation);
    if (this.state !== 'ready') throw new TypeError('Search index is not ready');
    const validatedScope = requireSearchScope(
      scope,
      this.treeEntries,
      (relativePath) => this.browseIndex?.hasDirectory(relativePath) === true
    );
    const outcome = await this.index.search(query, {
      maxResults,
      scope: validatedScope,
      isCancelled: () =>
        cancelBuffer instanceof SharedArrayBuffer &&
        Atomics.load(new Int32Array(cancelBuffer), 0) !== 0,
      onResult
    });
    if (outcome.cancelled)
      throw Object.assign(new Error('Search cancelled'), { code: 'CANCELLED' });
    return {
      workspaceId,
      generation,
      requestId,
      results: outcome.results,
      truncated: outcome.truncated
    };
  }

  async applyWatchChangesInternal({ full, paths }) {
    if (!this.index) return;
    if (this.state !== 'ready') {
      this.watchNeedsFullReconcile = true;
      return;
    }
    if (
      full ||
      paths.length > MAX_WATCH_CHANGE_PATHS ||
      paths.some((path) => normalizedRelativePath(path) === WORKSPACE_CONFIG_RELATIVE_PATH)
    ) {
      await this.refreshInternal();
      this.emitWatchCommit({ full: true, paths: [] });
      return;
    }
    let requiresFullReconcile = false;
    const committedPaths = new Set();
    for (const pathValue of paths) {
      const relativePath = normalizedWatchRelativePath(pathValue);
      if (!relativePath) {
        requiresFullReconcile = true;
        continue;
      }
      committedPaths.add(relativePath);
      const absolutePath = resolve(this.rootPath, ...relativePath.split('/'));
      if (!pathIsWithin(this.rootPath, absolutePath)) {
        requiresFullReconcile = true;
        continue;
      }
      try {
        const canonicalPath = await realpath(absolutePath);
        if (canonicalPath !== absolutePath || !pathIsWithin(this.rootPath, canonicalPath)) {
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
            this.searchPolicy.isExcludedDirectoryPath(relativePath) &&
            !this.searchPolicy.canTraverseExcludedDirectoryPath(relativePath)
          ) {
            this.removeTreePath(relativePath);
            this.index.delete(relativePath);
          } else {
            requiresFullReconcile = true;
          }
        } else if (currentStat.isSymbolicLink()) {
          this.index.delete(relativePath);
          if (this.searchPolicy.isExcludedFilePath(relativePath)) {
            this.removeTreePath(relativePath);
          } else {
            requiresFullReconcile = true;
          }
        } else if (currentStat.isFile()) {
          const searchExcluded = this.searchPolicy.isExcludedFilePath(relativePath);
          if (searchExcluded) {
            this.index.delete(relativePath);
            this.removeTreePath(relativePath);
          } else {
            const entry = await this.readWorkspaceFile({
              rootPath: this.rootPath,
              relativePath
            });
            if (entry) {
              this.index.upsert(entry);
              this.upsertTreeEntry(toTreeFileEntry(entry));
            } else requiresFullReconcile = true;
          }
          if (!searchExcluded && !(await this.refreshParentDirectoryTreeEntry(relativePath))) {
            requiresFullReconcile = true;
          }
        } else requiresFullReconcile = true;
      } catch (error) {
        if (error?.code === 'ENOENT') {
          this.removeTreePath(relativePath);
          this.index.delete(relativePath);
          if (
            !this.searchPolicy.isPhysicallyExcludedPath(relativePath) &&
            !(await this.refreshParentDirectoryTreeEntry(relativePath))
          ) {
            requiresFullReconcile = true;
          }
        } else requiresFullReconcile = true;
      }
    }
    if (requiresFullReconcile) {
      await this.refreshInternal();
      this.emitWatchCommit({ full: true, paths: [] });
    } else {
      await this.emitSnapshot();
      await this.emitBrowseListingsForChangedPaths([...committedPaths]);
      this.emitWatchCommit({ full: false, paths: [...committedPaths] });
    }
  }

  emitWatchCommit({ full, paths }) {
    if (!this.workspaceId || !Number.isSafeInteger(this.generation)) return;
    const uniquePaths = [...new Set(paths)];
    const boundedFull =
      full ||
      uniquePaths.length > MAX_WATCH_CHANGE_PATHS ||
      uniquePaths.some((path) => normalizedWatchRelativePath(path) !== path);
    const commit = {
      workspaceId: this.workspaceId,
      generation: this.generation,
      revision: ++this.watchCommitRevision,
      full: boundedFull,
      changedRelativePaths: boundedFull ? [] : uniquePaths
    };
    try {
      this.onWatchCommit?.(commit);
    } catch {
      // Delivery failure cannot roll back an already committed index transaction.
    }
  }

  upsertTreeEntry(entry) {
    const index = this.treeEntries.findIndex(
      ({ relativePath }) => relativePath === entry.relativePath
    );
    if (index >= 0) this.treeEntries[index] = entry;
    else this.treeEntries.push(entry);
    this.treeEntries = sortTreeEntries(this.treeEntries);
  }

  async refreshParentDirectoryTreeEntry(relativePath) {
    const parentRelativePath = normalizedRelativePath(dirname(relativePath));
    if (!parentRelativePath || parentRelativePath === '.') return true;
    const existingParent = this.treeEntries.find(
      (entry) => entry.relativePath === parentRelativePath
    );
    if (existingParent?.nodeKind !== 'directory') return false;
    const absolutePath = resolve(this.rootPath, ...parentRelativePath.split('/'));
    if (!pathIsWithin(this.rootPath, absolutePath)) return false;
    try {
      const canonicalPath = await realpath(absolutePath);
      if (canonicalPath !== absolutePath || !pathIsWithin(this.rootPath, canonicalPath)) {
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

  removeTreePath(relativePath) {
    this.treeEntries = this.treeEntries.filter(
      (entry) =>
        entry.relativePath !== relativePath && !entry.relativePath.startsWith(`${relativePath}/`)
    );
    for (const indexedPath of [...(this.index?.filenameTier.records.keys() ?? [])]) {
      if (indexedPath.startsWith(`${relativePath}/`)) this.index.delete(indexedPath);
    }
  }

  async memory() {
    const usage = process.memoryUsage();
    const filenameTierEstimatedBytes = this.index?.filenameTier.statistics().estimatedBytes ?? null;
    const treeMetadataEntryCount = this.index ? this.treeEntries.length : null;
    const treeMetadataEstimatedBytes = this.index
      ? estimateTreeMetadataBytes(this.treeEntries)
      : null;
    const diskIndexBytes = this.index ? await this.index.diskBytes() : null;
    return assessOnlyPreviewSearchMemory({
      measurementComplete: this.index !== undefined,
      processRssBytes: usage.rss,
      workerHeapUsedBytes: usage.heapUsed,
      workerExternalBytes: usage.external,
      filenameTierEstimatedBytes,
      treeMetadataEntryCount,
      treeMetadataEstimatedBytes,
      diskIndexBytes
    });
  }

  async snapshot() {
    if (!this.workspaceId) throw new TypeError('Search workspace is not initialized');
    return {
      workspaceId: this.workspaceId,
      generation: this.generation,
      state: this.state,
      index: {
        workspaceId: this.workspaceId,
        entries: [...this.treeEntries],
        truncated: this.maxDepthReached,
        limit: this.treeEntries.length
      },
      memory: await this.memory()
    };
  }

  async emitSnapshot() {
    if (!this.workspaceId) return;
    const snapshot = this.snapshot();
    const emitted = this.snapshotEmitTail.then(async () => {
      this.onSnapshot?.(await snapshot);
    });
    this.snapshotEmitTail = emitted.then(
      () => undefined,
      () => undefined
    );
    await emitted;
  }

  emitBuildProgress(progress) {
    if (!this.workspaceId || !Number.isSafeInteger(this.generation)) return;
    try {
      this.onProgress?.({
        workspaceId: this.workspaceId,
        generation: this.generation,
        ...progress
      });
    } catch {
      // Delivery failure cannot stop the active search-index transaction.
    }
  }

  async emitRootBrowseListing() {
    if (!this.workspaceId || !Number.isSafeInteger(this.generation) || !this.browseIndex) return;
    const listing = await this.browseIndex.rootListing({
      workspaceId: this.workspaceId,
      generation: this.generation
    });
    try {
      this.onBrowseListing?.(listing);
    } catch {
      // The matching initialize response can still establish the search workspace.
    }
  }

  async emitBrowseListingsForChangedPaths(relativePaths) {
    if (!this.workspaceId || !Number.isSafeInteger(this.generation) || !this.browseIndex) return;
    const parentPaths = new Set(
      relativePaths.map((relativePath) => {
        const parent = normalizedRelativePath(dirname(relativePath));
        return parent === '.' ? '' : parent;
      })
    );
    for (const relativePath of parentPaths) {
      const directoryToken = this.browseIndex.directoryTokenForListedPath(relativePath);
      if (!directoryToken) continue;
      try {
        const listing = await this.browseIndex.list({
          workspaceId: this.workspaceId,
          generation: this.generation,
          directoryToken
        });
        this.onBrowseListing?.(listing);
      } catch {
        // A concurrent rename/delete will be represented by the next watch batch.
      }
    }
  }

  async shutdown() {
    return await this.enqueue(async () => await this.shutdownInternal());
  }

  async shutdownInternal() {
    this.watchRevision += 1;
    const watchController = this.watchController;
    this.watchController = undefined;
    await watchController?.close({ drain: false });
    this.index?.close();
    this.index = undefined;
    this.browseIndex = undefined;
    this.workspaceId = undefined;
    this.rootPath = undefined;
    this.databasePath = undefined;
    this.searchPolicy = undefined;
    this.treeEntries = [];
  }
}

export const createOnlyPreviewSearchEngine = (options) => new OnlyPreviewSearchEngine(options);
