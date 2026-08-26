import { createHash, randomUUID } from 'node:crypto';
import { mkdir, realpath, rename, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { backup } from 'node:sqlite';

import { ONE_GIB_BYTES, TWO_GIB_BYTES } from './constants.mjs';
import { SEARCH_ENGINE_IDENTITY, OnlyPreviewSqliteIndex } from './sqlite-index.mjs';
import {
  countWorkspaceSearchEntries,
  createTraversalPolicy,
  createWorkspaceTraversal,
  readSingleWorkspaceFile
} from './traversal.mjs';
import { createOnlyPreviewBrowseIndex } from './browse-index.mjs';
import { createOnlyPreviewSelectedFilePriorityLane } from './selected-file-priority-lane.mjs';
import { createOnlyPreviewGlobalSearchSession } from './global-search-session.mjs';
import { executeOnlyPreviewGlobalSearch } from './global-search-executor.mjs';
import { previewOnlyPreviewGlobalSearchResult } from './global-search-preview.mjs';
import { loadOnlyPreviewWorkspaceConfig, pathIsWithin } from './workspace-config.mjs';
import { createWorkspaceWatchController } from './watch-controller.mjs';
import {
  createOnlyPreviewSearchWatchReconciler,
  sortOnlyPreviewTreeEntries
} from './watch-reconciler.mjs';

const engineHash = createHash('sha256').update(SEARCH_ENGINE_IDENTITY).digest('hex');

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
    this.selectedFilePriority = createOnlyPreviewSelectedFilePriorityLane({
      readWorkspaceFile,
      resolveContext: () => this
    });
    this.watchReconciler = createOnlyPreviewSearchWatchReconciler({
      readWorkspaceFile,
      resolveContext: () => this
    });
    this.globalSearchSession = createOnlyPreviewGlobalSearchSession();
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

  supersedePriority({ workspaceId, generation, relativePath }) {
    this.requireWorkspace(workspaceId, generation);
    this.globalSearchSession.revoke();
    return this.selectedFilePriority.supersede({ workspaceId, generation, relativePath });
  }

  async prioritizeFile(priority) {
    await this.selectedFilePriority.prioritizeFile(priority);
  }

  requireWorkspace(workspaceId, generation) {
    if (!this.browseIndex || workspaceId !== this.workspaceId || generation !== this.generation) {
      throw new TypeError('Search workspace generation is stale');
    }
  }

  async initialize({ workspaceId, generation, rootPath, databasePath }) {
    this.globalSearchSession.revoke();
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
      const buildRevision = ++this.buildRevision;
      const buildEpoch = ++this.buildEpoch;
      await this.emitRootBrowseListing();
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
      this.selectedFilePriority.revoke();
      this.state = 'ready';
      await this.emitSnapshot();
      if (this.watchNeedsFullReconcile) {
        this.watchNeedsFullReconcile = false;
        this.watchController.requestFullReconcile();
      }
      return await this.snapshot();
    } catch (error) {
      this.selectedFilePriority.revoke();
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
      this.treeEntries = sortOnlyPreviewTreeEntries(candidateTreeEntries.entries);
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
    this.selectedFilePriority.revoke();
    this.globalSearchSession.revoke();
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
    this.globalSearchSession.revoke();
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
      this.selectedFilePriority.revoke();
      this.state = configChanged ? 'building' : 'reconciling';
      this.browseIndex.reset();
      const buildRevision = ++this.buildRevision;
      const buildEpoch = ++this.buildEpoch;
      await this.emitRootBrowseListing();
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
      this.selectedFilePriority.revoke();
      this.state = 'ready';
      await this.emitSnapshot();
      if (this.watchNeedsFullReconcile) {
        this.watchNeedsFullReconcile = false;
        this.watchController?.requestFullReconcile();
      }
      return await this.snapshot();
    } catch (error) {
      this.selectedFilePriority.revoke();
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
    isCancelled,
    onResult
  }) {
    this.requireWorkspace(workspaceId, generation);
    return await executeOnlyPreviewGlobalSearch(this, {
      workspaceId,
      generation,
      requestId,
      query,
      maxResults,
      scope,
      isCancelled: typeof isCancelled === 'function' ? isCancelled : () => false,
      onResult
    });
  }

  revokeSearch(requestId) {
    this.globalSearchSession.revoke(requestId);
  }

  async preview({ workspaceId, generation, requestId, resultToken, isCancelled }) {
    this.requireWorkspace(workspaceId, generation);
    const authority = this.globalSearchSession.resolve({
      workspaceId,
      generation,
      requestId,
      resultToken
    });
    return await previewOnlyPreviewGlobalSearchResult({
      authority,
      rootPath: this.rootPath,
      searchPolicy: this.searchPolicy,
      isCancelled
    });
  }

  async applyWatchChangesInternal(change) {
    this.globalSearchSession.revoke();
    await this.watchReconciler.apply(change);
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

  async shutdown() {
    this.cancelBuild();
    return await this.enqueue(async () => await this.shutdownInternal());
  }

  async shutdownInternal() {
    this.buildEpoch += 1;
    this.selectedFilePriority.revoke();
    this.globalSearchSession.revoke();
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
