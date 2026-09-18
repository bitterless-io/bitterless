import { createHash, randomUUID } from 'node:crypto';
import { mkdir, realpath, rename, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { backup } from 'node:sqlite';

import { SEARCH_ENGINE_IDENTITY, OnlyPreviewSqliteIndex } from './sqlite-index.mjs';
import { measureOnlyPreviewSearchMemory } from './search-memory.mjs';
export { assessOnlyPreviewSearchMemory } from './search-memory.mjs';
import {
  countWorkspaceSearchEntries,
  createTraversalPolicy,
  createWorkspaceTraversal,
  readSingleWorkspaceFile
} from './traversal.mjs';
import { createOnlyPreviewBrowseIndex } from './browse-index.mjs';
import { createOnlyPreviewSelectedFilePriorityLane } from './selected-file-priority-lane.mjs';
import { createOnlyPreviewGlobalSearchSession } from './global-search-session.mjs';
import { createOnlyPreviewSearchDiagnostics } from '../../../../shared/onlypreview/onlyPreviewSearchDiagnostics.mjs';
import { executeOnlyPreviewGlobalSearch } from './global-search-executor.mjs';
import { previewOnlyPreviewGlobalSearchResult } from './global-search-preview.mjs';
import { reclaimInterruptedSqliteArtifacts } from './sqlite-artifacts.mjs';
import {
  onlyPreviewDiskFullMessage,
  onlyPreviewFreeBytes,
  planOnlyPreviewIndexBuild
} from './disk-space.mjs';
import {
  isSqliteCorruption,
  isSqliteDiskFull,
  openRecoverableSqliteIndex,
  quarantineSqliteIndex,
  renameSqliteIndexArtifacts,
  sqlitePrimaryErrorCode
} from './sqlite-recovery.mjs';
import {
  loadOnlyPreviewWorkspaceConfig,
  readOnlyPreviewWorkspaceConfigSignature,
  pathIsWithin
} from './workspace-config.mjs';
import { createWorkspaceWatchController } from './watch-controller.mjs';
import { createWorkspaceConfigReconciler } from './config-reconciler.mjs';
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

// The same four suffixes `sqlite-recovery.mjs` and `sqlite-artifacts.mjs` list. `-journal` was
// missing here, so a candidate's journal outlived the candidate and was only ever collected later by
// the reclaim sweep. Three lists describing one fact about SQLite must not disagree.
const removeSqliteArtifacts = async (databasePath) => {
  await Promise.all(
    ['', '-wal', '-shm', '-journal'].map((suffix) => rm(`${databasePath}${suffix}`, { force: true }))
  );
};

const cancelledError = () => Object.assign(new Error('Search cancelled'), { code: 'CANCELLED' });

const waitForWriterGate = async (writerGate, isCancelled) =>
  await new Promise((resolveWait, rejectWait) => {
    let settled = false;
    let timer;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const checkCancellation = () => {
      if (isCancelled()) {
        finish(rejectWait, cancelledError());
        return;
      }
      timer = setTimeout(checkCancellation, 16);
    };
    writerGate.then(
      () => finish(resolveWait),
      (error) => finish(rejectWait, error)
    );
    checkCancellation();
  });

const closeIndex = (index, onFailure) => {
  try {
    index?.close();
  } catch (error) {
    // Closing is idempotent at the engine boundary even though node:sqlite close is not. The caller
    // still cannot act on a failure — but it must not be invisible either. The next line typically
    // unlinks the file, and a handle that stayed open holds a multi-GB index's blocks for the life
    // of the process, which looks exactly like a leak with no explanation anywhere.
    onFailure?.(error);
  }
};

const MIB = 1024 * 1024;
const mib = (bytes) => Math.round(bytes / MIB);

export class OnlyPreviewSearchEngine {
  constructor({
    onBrowseListing,
    onProgress,
    onSnapshot,
    onWatchCommit,
    prepareOfficePreview,
    readWorkspaceFile = readSingleWorkspaceFile,
    readWorkspaceConfig = loadOnlyPreviewWorkspaceConfig,
    configClock,
    watchFactory,
    // Injectable so a test can put the engine on a volume it does not have. Everything these two
    // decide is about free space, which no fixture can arrange.
    planIndexBuild = planOnlyPreviewIndexBuild,
    measureFreeBytes = onlyPreviewFreeBytes,
    onConfigError = () => console.warn(
      '[onlypreview-search] Workspace configuration could not be applied; keeping the previous policy.'
    ),
    diagnostics = createOnlyPreviewSearchDiagnostics()
  } = {}) {
    this.onBrowseListing = onBrowseListing;
    this.onProgress = onProgress;
    this.onSnapshot = onSnapshot;
    this.onWatchCommit = onWatchCommit;
    this.prepareOfficePreview = prepareOfficePreview;
    this.diagnostics = diagnostics;
    this.readWorkspaceConfig = readWorkspaceConfig;
    this.configClock = configClock;
    this.watchFactory = watchFactory;
    this.planIndexBuild = planIndexBuild;
    this.measureFreeBytes = measureFreeBytes;
    this.onConfigError = onConfigError;
    this.closeFailed = (error) => {
      this.diagnostics.emit('sqlite-close-failure', { sqliteCode: sqlitePrimaryErrorCode(error) });
    };
    // Set by a refused build: what it needed, so the next one can re-check the volume with a single
    // `statfs` instead of walking the workspace again to reach the same refusal.
    this.diskShortfall = undefined;
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
    this.treeMetadataReady = false;
    this.maxDepthReached = false;
    this.operationTail = Promise.resolve();
    this.snapshotEmitTail = Promise.resolve();
    this.watchRevision = 0;
    this.watchCommitRevision = 0;
    this.buildRevision = 0;
    this.buildEpoch = 0;
    this.activeQueryCount = 0;
    this.resolveReaderDrain = undefined;
  }

  releaseSearchSnapshotReader() {
    this.activeQueryCount = Math.max(0, this.activeQueryCount - 1);
    if (this.activeQueryCount === 0) this.resolveReaderDrain?.();
  }

  async acquireSearchSnapshot({ isCancelled = () => false } = {}) {
    while (true) {
      if (isCancelled()) throw cancelledError();
      const writerGate = this.promotionPromise;
      if (writerGate) {
        await waitForWriterGate(writerGate, isCancelled);
        continue;
      }
      const index = this.index;
      if (!index) throw new TypeError('Search index is not ready');
      const treeEntries = this.treeEntries;
      const maxDepthReached = this.maxDepthReached;
      const searchPolicy = this.activeSearchPolicy;
      const identity = this.activeIdentity;
      this.activeQueryCount += 1;
      if (
        this.promotionPromise ||
        index !== this.index ||
        treeEntries !== this.treeEntries ||
        searchPolicy !== this.activeSearchPolicy ||
        identity !== this.activeIdentity
      ) {
        this.releaseSearchSnapshotReader();
        continue;
      }
      let released = false;
      return {
        index,
        treeEntries,
        maxDepthReached,
        searchPolicy,
        identity,
        release: () => {
          if (released) return;
          released = true;
          this.releaseSearchSnapshotReader();
        }
      };
    }
  }

  async acquireSearchSnapshotWriter() {
    while (this.promotionPromise) await this.promotionPromise;
    let resolveWriterGate = () => undefined;
    const writerGate = new Promise((resolveWriter) => {
      resolveWriterGate = resolveWriter;
    });
    this.promotionPromise = writerGate;
    if (this.activeQueryCount > 0) {
      await new Promise((resolveDrain) => {
        this.resolveReaderDrain = resolveDrain;
        if (this.activeQueryCount === 0) resolveDrain();
      });
      this.resolveReaderDrain = undefined;
    }
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        if (this.promotionPromise === writerGate) this.promotionPromise = undefined;
        resolveWriterGate();
      }
    };
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
    this.configReconciler?.close();
    const diagnostic = { tag: this.diagnostics.nextTag('i'), startedAt: this.diagnostics.now() };
    this.diagnostics.emit('initialize-start', { tag: diagnostic.tag, generation });
    this.globalSearchSession.revoke();
    const build = this.enqueue(
      async () =>
        await this.initializeInternal({
          workspaceId,
          generation,
          rootPath,
          databasePath,
          diagnostic
        })
    );
    this.currentBuildPromise = build;
    try {
      const result = await build;
      this.diagnostics.emit('initialize-terminal', {
        tag: diagnostic.tag,
        outcome: 'success',
        elapsedMs: this.diagnostics.elapsed(diagnostic.startedAt)
      });
      return result;
    } catch (error) {
      if (error?.code !== 'CANCELLED') {
        this.diagnostics.emit('initialize-failure', {
          tag: diagnostic.tag,
          phase: diagnostic.phase,
          sqliteCode: sqlitePrimaryErrorCode(error)
        });
      }
      this.diagnostics.emit('initialize-terminal', {
        tag: diagnostic.tag,
        outcome: error?.code === 'CANCELLED' ? 'cancelled' : 'failure',
        elapsedMs: this.diagnostics.elapsed(diagnostic.startedAt)
      });
      throw error;
    } finally {
      if (this.currentBuildPromise === build) {
        this.currentBuildPromise = undefined;
        this.initialTreePromise = undefined;
        this.initialTreeSnapshot = undefined;
      }
    }
  }

  async initializeInternal({ workspaceId, generation, rootPath, databasePath, diagnostic }) {
    diagnostic.phase = 'shutdown';
    await this.shutdownInternal();
    diagnostic.phase = 'authority';
    if (!isAbsolute(rootPath) || !isAbsolute(databasePath)) {
      throw new TypeError('Search authority paths must be absolute');
    }
    const rootRealPath = await realpath(resolve(rootPath));
    const databaseRealPath = await prospectiveRealPath(resolve(databasePath));
    if (pathIsWithin(rootRealPath, databaseRealPath)) {
      throw new TypeError('Search database must stay outside the workspace');
    }
    await mkdir(dirname(databaseRealPath), { recursive: true });
    await reclaimInterruptedSqliteArtifacts(databaseRealPath);
    this.workspaceId = workspaceId;
    this.generation = generation;
    this.watchCommitRevision = 0;
    this.rootPath = rootRealPath;
    this.databasePath = databaseRealPath;
    diagnostic.phase = 'config';
    this.config = await this.readWorkspaceConfig(rootRealPath);
    this.searchPolicy = createTraversalPolicy(this.config);
    this.browseIndex = createOnlyPreviewBrowseIndex(this.rootPath, {
      searchPolicy: this.searchPolicy
    });
    this.identity = {
      workspaceHash: createHash('sha256').update(rootRealPath).digest('hex'),
      configHash: this.config.hash,
      engineHash
    };
    let sqliteStartedAt;
    const { seedIndex, hasActiveIndex, canReconcile, seedTree } = await openRecoverableSqliteIndex({
      databasePath: this.databasePath,
      identity: this.identity,
      searchPolicy: this.searchPolicy,
      onPhase: (phase) => {
        diagnostic.phase = phase;
        if (phase === 'sqlite-open') sqliteStartedAt = this.diagnostics.now();
      },
      onOpen: ({ hasActiveIndex, canReconcile }) => this.diagnostics.emit('sqlite-open', {
        tag: diagnostic.tag,
        reusable: hasActiveIndex,
        reconcile: canReconcile,
        elapsedMs: this.diagnostics.elapsed(sqliteStartedAt)
      }),
      onRecovery: ({ sqliteCode, retained }) => this.diagnostics.emit('sqlite-recovery', {
        tag: diagnostic.tag,
        sqliteCode,
        retained
      })
    });
    this.index = hasActiveIndex ? seedIndex : undefined;
    this.activeSearchPolicy = hasActiveIndex ? this.searchPolicy : undefined;
    this.activeIdentity = hasActiveIndex ? this.identity : undefined;
    diagnostic.phase = 'watch-start';
    const watchRevision = ++this.watchRevision;
    const configReconciler = createWorkspaceConfigReconciler({
      enqueue: (operation) => this.enqueue(operation),
      readConfig: () => this.readWorkspaceConfig(rootRealPath),
      readSignature: () => readOnlyPreviewWorkspaceConfigSignature(rootRealPath),
      initialSignature: await readOnlyPreviewWorkspaceConfigSignature(rootRealPath),
      applyConfig: async (config) => {
        if (config.hash !== this.config.hash) await this.refreshFromWatchInternal(config);
      },
      isCurrent: () => this.watchRevision === watchRevision,
      onError: this.onConfigError,
      clock: this.configClock
    });
    this.configReconciler = configReconciler;
    this.watchController = createWorkspaceWatchController({
      rootPath: this.rootPath,
      watchFactory: this.watchFactory,
      onConfigChange: () => configReconciler.markChanged(),
      onConfigProbe: () => configReconciler.probe(),
      onBrowseChange: async (change) => {
        if (this.watchRevision !== watchRevision) return;
        if (change.full) await this.emitOpenBrowseListings();
        else await this.watchReconciler.emitBrowseListingsForChangedPaths(this, change.paths);
      },
      onReconcile: (change) =>
        this.enqueue(async () => {
          if (this.watchRevision !== watchRevision) return;
          await this.applyWatchChangesInternal(change);
        }),
      onError: () => undefined
    });
    this.state = canReconcile ? 'reconciling' : 'building';
    this.treeEntries = sortOnlyPreviewTreeEntries(seedTree.entries);
    this.maxDepthReached = seedTree.maxDepthReached;
    this.treeMetadataReady = seedTree.treeMetadataReady;
    const initialTreeEntries = hasActiveIndex ? undefined : [];
    let resolveInitialTree;
    if (initialTreeEntries) {
      this.initialTreePromise = new Promise((resolveTree) => {
        resolveInitialTree = resolveTree;
      });
    }
    try {
      const buildRevision = ++this.buildRevision;
      const buildEpoch = ++this.buildEpoch;
      diagnostic.phase = 'root-listing';
      const rootListingStartedAt = this.diagnostics.now();
      const rootListing = await this.emitRootBrowseListing();
      this.diagnostics.emit('root-listing', {
        tag: diagnostic.tag,
        count: rootListing?.entries?.length ?? 0,
        elapsedMs: this.diagnostics.elapsed(rootListingStartedAt)
      });
      this.emitBuildProgress({ buildRevision, phase: 'counting' });
      diagnostic.phase = 'snapshot';
      await this.emitSnapshot();
      await this.rejectLatchedDiskShortfall();
      diagnostic.phase = 'count';
      const countStartedAt = this.diagnostics.now();
      const total = await countWorkspaceSearchEntries({
        rootPath: this.rootPath,
        config: this.config,
        onTreeEntry: initialTreeEntries ? (entry) => initialTreeEntries.push(entry) : undefined,
        isCancelled: () => buildEpoch !== this.buildEpoch
      });
      if (buildEpoch !== this.buildEpoch) throw cancelledError();
      if (initialTreeEntries) {
        this.initialTreeSnapshot = {
          treeEntries: sortOnlyPreviewTreeEntries(initialTreeEntries),
          searchPolicy: this.searchPolicy,
          identity: this.identity
        };
        resolveInitialTree(this.initialTreeSnapshot);
      }
      this.diagnostics.emit('full-count', {
        tag: diagnostic.tag,
        count: total,
        elapsedMs: this.diagnostics.elapsed(countStartedAt)
      });
      this.emitBuildProgress({ buildRevision, phase: 'indexing', completed: 0, total });
      diagnostic.phase = 'rebuild';
      await this.buildAndPromoteCandidate({
        seedIndex,
        reconcileExisting: canReconcile,
        buildRevision,
        total,
        buildEpoch,
        diagnostic
      });
      this.selectedFilePriority.revoke();
      this.state = 'ready';
      diagnostic.phase = 'snapshot';
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
      // A failed count has no metadata to publish; its build promise carries the actual error.
      resolveInitialTree?.(undefined);
      if (seedIndex !== this.index) closeIndex(seedIndex, this.closeFailed);
    }
  }

  async buildAndPromoteCandidate({
    seedIndex,
    reconcileExisting,
    buildRevision,
    total,
    buildEpoch,
    diagnostic
  }) {
    diagnostic ??= { tag: this.diagnostics.nextTag('i'), startedAt: this.diagnostics.now() };
    const candidatePath = `${this.databasePath}.candidate-${randomUUID()}`;
    let candidate;
    const buildCandidate = async (reconcileCandidate) => {
      const backupStartedAt = this.diagnostics.now();
      if (reconcileCandidate) await backup(seedIndex.database, candidatePath);
      this.diagnostics.emit('candidate-backup', {
        tag: diagnostic.tag,
        mode: reconcileCandidate ? 'backup' : 'fresh',
        elapsedMs: this.diagnostics.elapsed(backupStartedAt)
      });
      candidate = new OnlyPreviewSqliteIndex(candidatePath);
      await this.runTraversal({
        targetIndex: candidate,
        reconcileExisting: reconcileCandidate,
        buildRevision,
        total,
        buildEpoch,
        diagnostic
      });
    };
    const directoryPath = dirname(this.databasePath);
    const emitPlan = (plan) => this.diagnostics.emit('candidate-plan', {
      tag: diagnostic.tag,
      mode: plan.mode,
      indexMiB: mib(plan.indexBytes),
      freeMiB: mib(plan.freeBytes),
      requiredMiB: mib(plan.requiredBytes)
    });
    let reconcile = reconcileExisting;
    try {
      await removeSqliteArtifacts(candidatePath);
      // Decide what the volume can actually hold BEFORE writing anything. A reconcile copies the
      // whole index first, so it needs ~2x; a fresh build needs ~1x. Without this the copy was
      // attempted regardless, and a workspace whose index no longer fitted retried it forever,
      // writing gigabytes per attempt until the disk hit zero and the index corrupted.
      let plan = await this.planIndexBuild({
        databasePath: this.databasePath,
        directoryPath,
        reconcile
      });
      emitPlan(plan);
      if (plan.mode === 'none' && this.index === undefined) {
        // The database on disk is dead weight, and it is dead weight that blocks its own
        // replacement. Nothing reads it — `this.index` is unset, so the open found an identity it
        // could not reuse — yet its bytes are charged to `freshNeeds` *and* they occupy the space
        // the rebuild needs. The ordinary path does delete it, but only after promotion, which is a
        // moment this branch can never reach: a workspace in this state could never rebuild again,
        // on any later launch, without a manual delete.
        //
        // Close the handle first. An unlinked file whose descriptor is still open returns no blocks
        // to the volume, which would make the reclaim measure well and free nothing.
        //
        // Only reachable from `initialize`. `applyConfig` passes a live `this.index`, so an index
        // that is currently answering searches is never deleted to make room.
        const reclaimedBytes = plan.indexBytes;
        closeIndex(seedIndex, this.closeFailed);
        await removeSqliteArtifacts(this.databasePath);
        // Nothing left to reconcile against, and saying otherwise would hand `backup()` a closed
        // handle to a deleted file — `indexBytes` is now 0, so a `reconcile` plan would fit.
        reconcile = false;
        plan = await this.planIndexBuild({
          databasePath: this.databasePath,
          directoryPath,
          reconcile
        });
        this.diagnostics.emit('candidate-reclaim', {
          tag: diagnostic.tag,
          reclaimedMiB: mib(reclaimedBytes),
          freeMiB: mib(plan.freeBytes)
        });
        emitPlan(plan);
      }
      if (plan.mode === 'none') {
        // Refuse, do not start. The existing index stays exactly as it is and keeps serving.
        // `INDEX_FAILED` is in the search wire's admitted code set, and the message carries no path
        // separator, which that validator forbids.
        this.diskShortfall = { databasePath: this.databasePath, requiredBytes: plan.requiredBytes };
        throw Object.assign(new Error(onlyPreviewDiskFullMessage(plan)), { code: 'INDEX_FAILED' });
      }
      this.diskShortfall = undefined;
      let corruptionCode = 0;
      try {
        await buildCandidate(reconcile && plan.mode === 'reconcile');
      } catch (error) {
        if (buildEpoch !== this.buildEpoch) throw cancelledError();
        if (isSqliteDiskFull(error)) {
          // The precheck passed and the volume filled anyway — another writer, or an index larger
          // than the one it was measured against. Report the disk, not "the index returned an
          // invalid response", and never retry into the same space.
          const shortfall = await this.planIndexBuild({
            databasePath: this.databasePath,
            directoryPath,
            reconcile: false
          });
          this.diskShortfall = {
            databasePath: this.databasePath,
            requiredBytes: shortfall.requiredBytes
          };
          throw Object.assign(new Error(onlyPreviewDiskFullMessage(shortfall)), {
            code: 'INDEX_FAILED'
          });
        }
        if (!reconcile || !isSqliteCorruption(error)) throw error;
        candidate?.close();
        candidate = undefined;
        await removeSqliteArtifacts(candidatePath);
        corruptionCode = sqlitePrimaryErrorCode(error);
        // One fresh attempt only; the seed stays untouched until successful promotion.
        await buildCandidate(false);
      }
      if (buildEpoch !== this.buildEpoch) throw cancelledError();
      const promotedCandidate = candidate;
      candidate = undefined;
      await this.promoteCandidate(
        promotedCandidate,
        candidatePath,
        seedIndex,
        diagnostic,
        buildRevision,
        corruptionCode
      );
    } finally {
      closeIndex(candidate, this.closeFailed);
      await removeSqliteArtifacts(candidatePath);
    }
  }

  async runTraversal({ targetIndex, reconcileExisting, buildRevision, total, buildEpoch, diagnostic }) {
    const traversalStartedAt = this.diagnostics.now();
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
    const sortedTreeEntries = sortOnlyPreviewTreeEntries(candidateTreeEntries);
    targetIndex.replaceTreeSnapshot(sortedTreeEntries, traversal.statistics.maxDepthReached);
    this.diagnostics.emit('traversal-index', {
      tag: diagnostic.tag,
      mode: reconcileExisting ? 'reconcile' : 'rebuild',
      count: outcome.fileCount,
      elapsedMs: this.diagnostics.elapsed(traversalStartedAt)
    });
    return {
      entries: sortedTreeEntries,
      maxDepthReached: traversal.statistics.maxDepthReached
    };
  }

  /**
   * A build that was refused for disk space must not pay to reach the same refusal again.
   *
   * Counting the workspace runs before the precheck and walks every entry — 1.7M files, tens of
   * seconds, on the reference machine — only for the plan to refuse afterwards. The refusal is
   * latched instead, and re-tested with one `statfs`. Recovered space clears the latch and the build
   * proceeds normally; the latch is per database, because it says nothing about any other workspace.
   */
  async rejectLatchedDiskShortfall() {
    const latched = this.diskShortfall;
    if (!latched || latched.databasePath !== this.databasePath) return;
    const freeBytes = await this.measureFreeBytes(dirname(this.databasePath));
    if (freeBytes >= latched.requiredBytes) {
      this.diskShortfall = undefined;
      return;
    }
    throw Object.assign(
      new Error(onlyPreviewDiskFullMessage({ requiredBytes: latched.requiredBytes, freeBytes })),
      { code: 'INDEX_FAILED' }
    );
  }

  async promoteCandidate(
    candidate,
    candidatePath,
    seedIndex,
    diagnostic,
    buildRevision,
    corruptionCode = 0
  ) {
    const promotionWaitStartedAt = this.diagnostics.now();
    const writer = await this.acquireSearchSnapshotWriter();
    // Recovery artifacts must survive the ordinary interrupted-candidate cleanup after a crash.
    const previousPath = `${this.databasePath}.${corruptionCode ? 'recovery' : 'previous'}-${randomUUID()}`;
    const hadActiveIndex = this.index !== undefined;
    const previousActiveSearchPolicy = this.activeSearchPolicy;
    const previousActiveIdentity = this.activeIdentity;
    let movedPrevious = false;
    let installedCandidate = false;
    let promotedIndex;
    let promotionCommitted = false;
    let previousQuarantined = false;
    try {
      this.diagnostics.emit('promotion-wait', {
        tag: diagnostic.tag,
        elapsedMs: this.diagnostics.elapsed(promotionWaitStartedAt)
      });
      const promotionCommitStartedAt = this.diagnostics.now();
      this.selectedFilePriority.revoke();
      this.globalSearchSession.revoke();
      if (corruptionCode) {
        candidate.close();
        this.index?.close();
        if (seedIndex !== this.index) seedIndex?.close();
      } else {
        closeIndex(candidate, this.closeFailed);
        closeIndex(this.index, this.closeFailed);
        if (seedIndex !== this.index) closeIndex(seedIndex, this.closeFailed);
      }
      this.index = undefined;
      try {
        if (corruptionCode) await renameSqliteIndexArtifacts(this.databasePath, previousPath);
        else await rename(this.databasePath, previousPath);
        movedPrevious = true;
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
      await rename(candidatePath, this.databasePath);
      installedCandidate = true;
      promotedIndex = new OnlyPreviewSqliteIndex(this.databasePath);
      const promotedTree = promotedIndex.readTreeSnapshot({ searchPolicy: this.searchPolicy });
      if (!promotedTree.treeMetadataReady) {
        throw new TypeError('Promoted Search tree snapshot is not ready');
      }
      if (corruptionCode && movedPrevious) {
        // `undefined` means the volume could not spare the forensic copy, so the corrupt artifacts
        // were removed outright; the `finally` below then finds nothing left to remove.
        const quarantinePath = await quarantineSqliteIndex(previousPath);
        previousQuarantined = quarantinePath !== undefined;
        this.diagnostics.emit('sqlite-recovery', {
          tag: diagnostic.tag,
          sqliteCode: corruptionCode,
          retained: previousQuarantined
        });
      }
      this.index = promotedIndex;
      promotedIndex = undefined;
      this.treeEntries = sortOnlyPreviewTreeEntries(promotedTree.entries);
      this.maxDepthReached = promotedTree.maxDepthReached;
      this.treeMetadataReady = true;
      this.activeSearchPolicy = this.searchPolicy;
      this.activeIdentity = this.identity;
      this.diagnostics.emit('promotion-commit', {
        tag: diagnostic.tag,
        buildRevision,
        elapsedMs: this.diagnostics.elapsed(promotionCommitStartedAt)
      });
      promotionCommitted = true;
    } catch (error) {
      closeIndex(promotedIndex, this.closeFailed);
      closeIndex(this.index, this.closeFailed);
      this.index = undefined;
      if (installedCandidate) await removeSqliteArtifacts(this.databasePath).catch(() => undefined);
      let restoredPrevious = false;
      if (movedPrevious) {
        try {
          if (corruptionCode) await renameSqliteIndexArtifacts(previousPath, this.databasePath);
          else await rename(previousPath, this.databasePath);
          restoredPrevious = true;
        } catch {
          restoredPrevious = false;
        }
      }
      if (hadActiveIndex && restoredPrevious) {
        try {
          this.index = new OnlyPreviewSqliteIndex(this.databasePath);
          const recoveredTree = this.index.readTreeSnapshot({
            searchPolicy: previousActiveSearchPolicy ?? this.searchPolicy
          });
          this.treeEntries = sortOnlyPreviewTreeEntries(recoveredTree.entries);
          this.maxDepthReached = recoveredTree.maxDepthReached;
          this.treeMetadataReady = recoveredTree.treeMetadataReady;
        } catch {
          closeIndex(this.index, this.closeFailed);
          this.index = undefined;
        }
      }
      if (!this.index) {
        this.treeEntries = [];
        this.maxDepthReached = false;
        this.treeMetadataReady = false;
      }
      this.activeSearchPolicy = this.index ? previousActiveSearchPolicy : undefined;
      this.activeIdentity = this.index ? previousActiveIdentity : undefined;
      throw error;
    } finally {
      if (promotionCommitted && movedPrevious && !previousQuarantined) {
        await removeSqliteArtifacts(previousPath).catch(() => undefined);
      }
      writer.release();
    }
  }

  async refresh({ workspaceId, generation }) {
    this.requireWorkspace(workspaceId, generation);
    this.globalSearchSession.revokeResults();
    if (this.refreshPromise) return await this.refreshPromise;
    const build = this.enqueue(async () => await this.refreshInternal());
    this.currentBuildPromise = build;
    this.refreshPromise = build.finally(() => {
      this.refreshPromise = undefined;
      if (this.currentBuildPromise === build) this.currentBuildPromise = undefined;
    });
    return await this.refreshPromise;
  }

  async refreshInternal(nextConfig = this.config) {
    const previousConfig = this.config;
    const previousSearchPolicy = this.searchPolicy;
    const previousIdentity = this.identity;
    const configChanged = nextConfig.hash !== this.config.hash;
    this.config = nextConfig;
    this.searchPolicy = createTraversalPolicy(nextConfig);
    this.browseIndex.setSearchPolicy(this.searchPolicy);
    this.identity = { ...this.identity, configHash: nextConfig.hash };
    try {
      this.selectedFilePriority.revoke();
      this.state = configChanged ? 'building' : 'reconciling';
      const buildRevision = ++this.buildRevision;
      const buildEpoch = ++this.buildEpoch;
      await this.emitOpenBrowseListings();
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
      const promotedNextSnapshot = this.index !== undefined && this.activeIdentity === this.identity;
      if (!promotedNextSnapshot) {
        this.config = previousConfig;
        this.searchPolicy = previousSearchPolicy;
        this.browseIndex.setSearchPolicy(previousSearchPolicy);
        this.identity = previousIdentity;
        await this.emitOpenBrowseListings().catch(() => undefined);
      }
      this.state = 'ready';
      await this.emitSnapshot().catch(() => undefined);
      throw error;
    }
  }

  async refreshFromWatchInternal(nextConfig = this.config) {
    const build = this.refreshInternal(nextConfig);
    this.currentBuildPromise = build;
    try {
      return await build;
    } finally {
      if (this.currentBuildPromise === build) this.currentBuildPromise = undefined;
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
    const preview = await previewOnlyPreviewGlobalSearchResult({
      authority,
      rootPath: this.rootPath,
      searchPolicy: authority.searchPolicy ?? this.activeSearchPolicy ?? this.searchPolicy,
      isCancelled
    });
    if (preview.kind !== 'info' || typeof this.prepareOfficePreview !== 'function') return preview;
    return (
      (await this.prepareOfficePreview({
        authority,
        preview,
        workspaceId,
        generation,
        requestId,
        resultToken,
        isCancelled
      })) ?? preview
    );
  }

  async applyWatchChangesInternal(change) {
    await this.watchReconciler.apply(change);
  }

  async memory() {
    const initialTree = this.index ? undefined : this.initialTreeSnapshot;
    return await measureOnlyPreviewSearchMemory({
      index: this.index,
      treeEntries: initialTree?.treeEntries ?? this.treeEntries,
      treeMetadataReady: this.treeMetadataReady || initialTree !== undefined
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
    return listing;
  }

  async emitOpenBrowseListings() {
    const rootListing = await this.emitRootBrowseListing();
    if (!rootListing || !this.browseIndex) return rootListing;
    // A rebuild keeps every capability, so the directories the Shell already has open must be
    // republished here; otherwise they would keep their pre-rebuild entries until the next
    // bounded watch event named one of their children.
    const openPaths = this.browseIndex
      .listedDirectoryPaths()
      .filter((relativePath) => relativePath !== '')
      .sort(
        (left, right) =>
          left.split('/').length - right.split('/').length || left.localeCompare(right, 'und')
      );
    for (const relativePath of openPaths) {
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
        // A directory removed during the rebuild is already represented by its parent's listing.
      }
    }
    return rootListing;
  }

  async shutdown() {
    this.configReconciler?.close();
    this.cancelBuild();
    return await this.enqueue(async () => await this.shutdownInternal());
  }

  async shutdownInternal() {
    this.configReconciler?.close();
    this.configReconciler = undefined;
    this.buildEpoch += 1;
    this.selectedFilePriority.revoke();
    this.globalSearchSession.revoke();
    this.watchRevision += 1;
    const watchController = this.watchController;
    this.watchController = undefined;
    await watchController?.close({ drain: false });
    const writer = await this.acquireSearchSnapshotWriter();
    try {
      closeIndex(this.index, this.closeFailed);
      this.index = undefined;
      this.browseIndex = undefined;
      this.workspaceId = undefined;
      this.rootPath = undefined;
      this.databasePath = undefined;
      this.searchPolicy = undefined;
      this.identity = undefined;
      this.activeSearchPolicy = undefined;
      this.activeIdentity = undefined;
      this.treeEntries = [];
      this.treeMetadataReady = false;
      this.initialTreePromise = undefined;
      this.initialTreeSnapshot = undefined;
      this.maxDepthReached = false;
    } finally {
      writer.release();
    }
  }
}

export const createOnlyPreviewSearchEngine = (options) => new OnlyPreviewSearchEngine(options);
