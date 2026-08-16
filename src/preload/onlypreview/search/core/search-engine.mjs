import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, realpath, rename, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { backup } from 'node:sqlite';

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

const removeSqliteArtifacts = async (databasePath) => {
  await Promise.all(
    ['', '-shm', '-wal'].map((suffix) => rm(`${databasePath}${suffix}`, { force: true }))
  );
};

const cancelledError = () => Object.assign(new Error('Search cancelled'), { code: 'CANCELLED' });

const nextTurn = async () => await new Promise((resolveTurn) => setImmediate(resolveTurn));

const closeIndex = (index) => {
  try {
    index?.close();
  } catch {
    // Closing is idempotent at the engine boundary even though node:sqlite close is not.
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
    this.buildEpoch = 0;
    this.activeQueryCount = 0;
  }

  enqueue(operation) {
    const result = this.operationTail.then(operation);
    this.operationTail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  cancelBuild() {
    this.buildEpoch += 1;
  }

  requireWorkspace(workspaceId, generation) {
    if (!this.browseIndex || workspaceId !== this.workspaceId || generation !== this.generation) {
      throw new TypeError('Search workspace generation is stale');
    }
  }

  async initialize({ workspaceId, generation, rootPath, databasePath }) {
    const build = this.enqueue(
      async () =>
        await this.initializeInternal({
          workspaceId,
          generation,
          rootPath,
          databasePath
        })
    );
    this.currentBuildPromise = build;
    try {
      return await build;
    } finally {
      if (this.currentBuildPromise === build) this.currentBuildPromise = undefined;
    }
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
    this.browseIndex = createOnlyPreviewBrowseIndex(this.rootPath);
    this.identity = {
      workspaceHash: createHash('sha256').update(rootRealPath).digest('hex'),
      configHash: this.config.hash,
      engineHash
    };
    const seedIndex = new OnlyPreviewSqliteIndex(this.databasePath);
    const hasActiveIndex = seedIndex.isReusable(this.identity);
    const canReconcile = seedIndex.canReconcile(this.identity);
    this.index = hasActiveIndex ? seedIndex : undefined;
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
    try {
      await this.emitRootBrowseListing();
      const buildRevision = ++this.buildRevision;
      const buildEpoch = ++this.buildEpoch;
      this.emitBuildProgress({ buildRevision, phase: 'counting' });
      await this.emitSnapshot();
      const total = await countWorkspaceSearchEntries({
        rootPath: this.rootPath,
        config: this.config,
        isCancelled: () => buildEpoch !== this.buildEpoch
      });
      this.emitBuildProgress({ buildRevision, phase: 'indexing', completed: 0, total });
      await this.buildAndPromoteCandidate({
        seedIndex,
        reconcileExisting: canReconcile,
        buildRevision,
        total,
        buildEpoch
      });
      this.state = 'ready';
      await this.emitSnapshot();
      if (this.watchNeedsFullReconcile) {
        this.watchNeedsFullReconcile = false;
        this.watchController.requestFullReconcile();
      }
      return await this.snapshot();
    } catch (error) {
      if (this.index) {
        this.state = 'ready';
        await this.emitSnapshot().catch(() => undefined);
      }
      throw error;
    } finally {
      if (seedIndex !== this.index) closeIndex(seedIndex);
    }
  }

  async buildAndPromoteCandidate({
    seedIndex,
    reconcileExisting,
    buildRevision,
    total,
    buildEpoch
  }) {
    const candidatePath = `${this.databasePath}.candidate-${randomUUID()}`;
    let candidate;
    try {
      await removeSqliteArtifacts(candidatePath);
      if (reconcileExisting) await backup(seedIndex.database, candidatePath);
      candidate = new OnlyPreviewSqliteIndex(candidatePath);
      const candidateTreeEntries = await this.runTraversal({
        targetIndex: candidate,
        reconcileExisting,
        buildRevision,
        total,
        buildEpoch
      });
      if (buildEpoch !== this.buildEpoch) throw cancelledError();
      const promotedCandidate = candidate;
      candidate = undefined;
      await this.promoteCandidate(promotedCandidate, candidatePath, seedIndex);
      this.treeEntries = sortTreeEntries(candidateTreeEntries.entries);
      this.maxDepthReached = candidateTreeEntries.maxDepthReached;
    } finally {
      closeIndex(candidate);
      await removeSqliteArtifacts(candidatePath);
    }
  }

  async runTraversal({ targetIndex, reconcileExisting, buildRevision, total, buildEpoch }) {
    const candidateTreeEntries = [];
    const isCancelled = () => buildEpoch !== this.buildEpoch;
    const traversal = await createWorkspaceTraversal({
      rootPath: this.rootPath,
      config: this.config,
      onTreeEntry: (entry) => candidateTreeEntries.push(entry),
      isCancelled,
      shouldReadContent: reconcileExisting
        ? (metadata) => targetIndex.metadataForTraversal(metadata)
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
      ? await targetIndex.reconcile(traversal.entries, this.identity, { onBatch })
      : await targetIndex.rebuild(traversal.entries, this.identity, { onBatch });
    const completed = Math.min(total, outcome.fileCount);
    if (completed !== lastReportedCompleted) {
      this.emitBuildProgress({
        buildRevision,
        phase: 'indexing',
        completed,
        total
      });
    }
    if (isCancelled()) throw cancelledError();
    return {
      entries: candidateTreeEntries,
      maxDepthReached: traversal.statistics.maxDepthReached
    };
  }

  async promoteCandidate(candidate, candidatePath, seedIndex) {
    let resolvePromotion = () => undefined;
    this.promotionPromise = new Promise((resolvePromotionValue) => {
      resolvePromotion = resolvePromotionValue;
    });
    const previousPath = `${this.databasePath}.previous-${randomUUID()}`;
    let movedPrevious = false;
    try {
      while (this.activeQueryCount > 0) await nextTurn();
      closeIndex(candidate);
      closeIndex(this.index);
      if (seedIndex !== this.index) closeIndex(seedIndex);
      this.index = undefined;
      try {
        await rename(this.databasePath, previousPath);
        movedPrevious = true;
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
      await rename(candidatePath, this.databasePath);
      this.index = new OnlyPreviewSqliteIndex(this.databasePath);
      await removeSqliteArtifacts(previousPath);
    } catch (error) {
      if (movedPrevious) {
        await removeSqliteArtifacts(this.databasePath);
        await rename(previousPath, this.databasePath).catch(() => undefined);
      }
      try {
        this.index = new OnlyPreviewSqliteIndex(this.databasePath);
      } catch {
        this.index = undefined;
      }
      throw error;
    } finally {
      resolvePromotion();
      this.promotionPromise = undefined;
    }
  }

  async refresh({ workspaceId, generation }) {
    this.requireWorkspace(workspaceId, generation);
    if (this.refreshPromise) return await this.refreshPromise;
    const build = this.enqueue(async () => await this.refreshInternal());
    this.currentBuildPromise = build;
    this.refreshPromise = build.finally(() => {
      this.refreshPromise = undefined;
      if (this.currentBuildPromise === build) this.currentBuildPromise = undefined;
    });
    return await this.refreshPromise;
  }

  async refreshInternal() {
    const previousConfig = this.config;
    const previousSearchPolicy = this.searchPolicy;
    const previousIdentity = this.identity;
    const nextConfig = await loadOnlyPreviewWorkspaceConfig(this.rootPath);
    const configChanged = nextConfig.hash !== this.config.hash;
    this.config = nextConfig;
    this.searchPolicy = createTraversalPolicy(nextConfig);
    this.identity = { ...this.identity, configHash: nextConfig.hash };
    try {
      this.state = configChanged ? 'building' : 'reconciling';
      this.browseIndex.reset();
      await this.emitRootBrowseListing();
      const buildRevision = ++this.buildRevision;
      const buildEpoch = ++this.buildEpoch;
      this.emitBuildProgress({ buildRevision, phase: 'counting' });
      await this.emitSnapshot();
      const total = await countWorkspaceSearchEntries({
        rootPath: this.rootPath,
        config: this.config,
        isCancelled: () => buildEpoch !== this.buildEpoch
      });
      this.emitBuildProgress({ buildRevision, phase: 'indexing', completed: 0, total });
      const seedIndex = this.index;
      if (!seedIndex) throw new TypeError('Search index is not initialized');
      await this.buildAndPromoteCandidate({
        seedIndex,
        reconcileExisting: !configChanged && seedIndex.canReconcile(this.identity),
        buildRevision,
        total,
        buildEpoch
      });
      this.state = 'ready';
      await this.emitSnapshot();
      if (this.watchNeedsFullReconcile) {
        this.watchNeedsFullReconcile = false;
        this.watchController?.requestFullReconcile();
      }
      return await this.snapshot();
    } catch (error) {
      this.config = previousConfig;
      this.searchPolicy = previousSearchPolicy;
      this.identity = previousIdentity;
      this.state = 'ready';
      await this.emitSnapshot().catch(() => undefined);
      throw error;
    }
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
    isCancelled,
    onResult
  }) {
    this.requireWorkspace(workspaceId, generation);
    return await this.searchInternal({
      workspaceId,
      generation,
      requestId,
      query,
      maxResults,
      scope,
      cancelBuffer,
      isCancelled,
      onResult
    });
  }

  async searchInternal({
    workspaceId,
    generation,
    requestId,
    query,
    maxResults,
    scope,
    cancelBuffer,
    isCancelled: cancellationRequested,
    onResult
  }) {
    this.requireWorkspace(workspaceId, generation);
    const isCancelled =
      typeof cancellationRequested === 'function'
        ? cancellationRequested
        : () =>
            typeof SharedArrayBuffer !== 'undefined' &&
            cancelBuffer instanceof SharedArrayBuffer &&
            Atomics.load(new Int32Array(cancelBuffer), 0) !== 0;
    const validatedScope = requireSearchScope(
      scope,
      this.treeEntries,
      (relativePath) => this.browseIndex?.hasDirectory(relativePath) === true
    );
    if (this.promotionPromise) await this.promotionPromise;
    let targetIndex = this.index;
    if (!targetIndex && validatedScope.kind === 'directory') {
      return await this.searchDirectoryWithoutActiveIndex({
        workspaceId,
        generation,
        requestId,
        query,
        maxResults,
        scope: validatedScope,
        isCancelled,
        onResult
      });
    }
    if (!targetIndex) {
      const build = this.currentBuildPromise;
      if (!build) throw new TypeError('Search index is not ready');
      while (this.currentBuildPromise === build) {
        if (isCancelled()) throw cancelledError();
        await nextTurn();
      }
      await build;
      if (this.promotionPromise) await this.promotionPromise;
      targetIndex = this.index;
    }
    if (!targetIndex) throw new TypeError('Search index is not ready');
    this.activeQueryCount += 1;
    let outcome;
    try {
      outcome = await targetIndex.search(query, {
        maxResults,
        scope: validatedScope,
        isCancelled,
        onResult
      });
    } finally {
      this.activeQueryCount -= 1;
    }
    if (outcome.cancelled) throw cancelledError();
    return {
      workspaceId,
      generation,
      requestId,
      results: outcome.results,
      truncated: outcome.truncated
    };
  }

  async searchDirectoryWithoutActiveIndex({
    workspaceId,
    generation,
    requestId,
    query,
    maxResults,
    scope,
    isCancelled,
    onResult
  }) {
    const scopedIndex = new OnlyPreviewSqliteIndex(':memory:');
    try {
      const traversal = await createWorkspaceTraversal({
        rootPath: this.rootPath,
        config: this.config,
        collectTreeEntries: false,
        scopeRelativePath: scope.relativePath,
        isCancelled
      });
      await scopedIndex.rebuild(traversal.entries, this.identity);
      if (isCancelled()) throw cancelledError();
      const outcome = await scopedIndex.search(query, {
        maxResults,
        scope,
        isCancelled,
        onResult
      });
      if (outcome.cancelled) throw cancelledError();
      return {
        workspaceId,
        generation,
        requestId,
        results: outcome.results,
        truncated: outcome.truncated
      };
    } finally {
      closeIndex(scopedIndex);
    }
  }

  async applyWatchChangesInternal({ full, paths, renamePaths = [] }) {
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
        ? this.treeEntries.find((entry) => entry.relativePath === relativePath)
        : undefined;
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
          if (renameHint && previousTreeEntry?.nodeKind !== 'file') {
            requiresFullReconcile = true;
            continue;
          }
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
          if (renameHint) requiresFullReconcile = true;
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

  hasActiveSearchIndex({ workspaceId, generation }) {
    return (
      this.workspaceId === workspaceId &&
      this.generation === generation &&
      this.state === 'ready' &&
      this.index !== undefined
    );
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
    this.cancelBuild();
    return await this.enqueue(async () => await this.shutdownInternal());
  }

  async shutdownInternal() {
    this.buildEpoch += 1;
    this.watchRevision += 1;
    const watchController = this.watchController;
    this.watchController = undefined;
    await watchController?.close({ drain: false });
    closeIndex(this.index);
    this.index = undefined;
    this.browseIndex = undefined;
    this.workspaceId = undefined;
    this.rootPath = undefined;
    this.databasePath = undefined;
    this.searchPolicy = undefined;
    this.identity = undefined;
    this.treeEntries = [];
  }
}

export const createOnlyPreviewSearchEngine = (options) => new OnlyPreviewSearchEngine(options);
