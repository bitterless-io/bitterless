import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, realpath, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { backup } from 'node:sqlite';

import { BACKGROUND_BUILD_TRANSACTION_FILES } from './constants.mjs';
import { submitIndexTask } from './index-queue.mjs';
import {
  advanceDeleteTaskToIndex,
  beginDeleteTask,
  clearDeleteTask,
  readDeleteJournal
} from './delete-journal.mjs';
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
  pathHasAncestorIn,
  sortOnlyPreviewTreeEntries
} from './watch-reconciler.mjs';

const engineHash = createHash('sha256').update(SEARCH_ENGINE_IDENTITY).digest('hex');

// `lstat` 而不是 `stat`:一条指向已删目标的符号链接本身还在,不该被当成"已经删掉"。
const pathExists = async (absolutePath) => {
  try {
    await lstat(absolutePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return false;
    // 权限之类的错误说明它可能还在 —— 宁可不清索引,也不要凭一次读失败就抹掉用户的内容。
    return true;
  }
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

// The same four suffixes `sqlite-recovery.mjs` and `sqlite-artifacts.mjs` list. `-journal` was
// missing here, so a candidate's journal outlived the candidate and was only ever collected later by
// the reclaim sweep. Three lists describing one fact about SQLite must not disagree.
const removeSqliteArtifacts = async (databasePath) => {
  await Promise.all(
    ['', '-wal', '-shm', '-journal'].map((suffix) => rm(`${databasePath}${suffix}`, { force: true }))
  );
};

// 同样那组后缀,但**不含主库** —— 用于提升前清掉活库路径上不属于新库的 WAL 残留。
const removeSqliteSidecars = async (databasePath) => {
  await Promise.all(
    ['-wal', '-shm', '-journal'].map((suffix) => rm(`${databasePath}${suffix}`, { force: true }))
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

  /**
   * 浏览面的就绪判据 —— `openBrowseSurface` 一跑完就成立,不等索引写锁。
   */
  requireBrowseWorkspace(workspaceId, generation) {
    if (!this.browseIndex || workspaceId !== this.workspaceId || generation !== this.generation) {
      throw new TypeError('Search workspace generation is stale');
    }
  }

  /**
   * 读写索引的就绪判据。
   *
   * 比浏览面多一条:`databasePath` 必须已经落下。它只在队列里的 `initializeIndexed` 里赋值,
   * 所以它恰好标记了「索引侧的脚手架(initialTreePromise、构建 epoch、identity)已经存在」。
   * `openBrowseSurface` 把浏览面提前开了,这段窗口里索引还没轮到队列 —— 冷查询如果在这里放行,
   * 会在 `initialTreePromise` 还不存在时判「索引没就绪」而直接失败,而不是等构建。
   * 这一条把那段窗口还原成修复前的语义:浏览可用,索引调用照旧报 stale。
   */
  requireWorkspace(workspaceId, generation) {
    this.requireBrowseWorkspace(workspaceId, generation);
    if (this.databasePath === undefined) {
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

  /**
   * 初始化整段作为**一个**索引任务跑(index-solution.html #1 的 S1 → S8)。
   *
   * 路径解析提到这一层,是为了在提交任务之前就拿到队列键 —— 键必须和后续构建、删除清理用的
   * `this.databasePath` 完全一致,否则它们会排进两条不同的队,互斥就是假的。
   *
   * 分成两次提交同样不行:两次之间另一个引擎可以完成一次提升,把库文件改名换走,本引擎手里
   * 就只剩一个指向旧 inode 的句柄,后面的清理全部写进一个已经没人读的文件。
   */
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
    // 根目录列表先于队列发出去。它是一次 readdir —— 既不读库也不写库 —— 却本来排在
    // 「排队 → 开库 → 补删除日志」之后。Shell 结束 loading 的唯一判据就是这份列表
    // (`projectListingLoading` → `browseProjection.ready`),实测 16 ms;而它前面那段
    // 实测中位 1.9 秒、最坏 306.7 秒,因为 `initialize` 是写任务,和后台 reconcile 抢
    // 同一条 FIFO 队列,一次 reconcile 占 60–100 秒且还会连占五次。
    // 见 docs/issues/onlypreview-loading-project-waits-behind-index-rebuilds.md。
    //
    // 队列语义一个字节都没动:锁、串行化、崩溃恢复仍然全部在 `runIndexTask` 里。挪出来的
    // 只有「列一次根目录」,它从来不需要那把锁。
    diagnostic.phase = 'browse-open';
    await this.openBrowseSurface({ workspaceId, generation, rootRealPath, diagnostic });
    return await this.runIndexTask(
      'initialize',
      () =>
        this.initializeIndexed({
          workspaceId,
          generation,
          rootRealPath,
          databaseRealPath,
          diagnostic
        }),
      databaseRealPath
    );
  }

  /**
   * 在拿索引写锁**之前**把浏览面打开,并发出根目录列表。
   *
   * 只碰文件系统:读 workspace 配置、建遍历策略、建 browseIndex、列一次根目录。一个 SQLite
   * 调用都没有,所以它不需要、也不该排进 `index-queue.mjs`。
   *
   * **browseIndex 必须是同一个实例活下去。** 目录令牌是每实例的 `randomUUID()`;用一个临时
   * 实例发完就扔,Shell 拿到的令牌在真正的实例上不存在。队列内的 `initializeIndexed` 因此不再
   * 重建它,而它稍后那次 `emitRootBrowseListing()` 经 `issueDirectoryToken` 复用同一批令牌,
   * 是幂等的重发 —— 保留它是为了让「重建后重新广播」这条既有路径不变。
   *
   * 失败语义有一处刻意的变化:如果随后的索引初始化抛错,浏览面仍然是活的,Shell 会显示目录树
   * 加一条错误横幅,而不是一个永远转下去的圈。
   */
  async openBrowseSurface({ workspaceId, generation, rootRealPath, diagnostic }) {
    this.workspaceId = workspaceId;
    this.generation = generation;
    this.rootPath = rootRealPath;
    this.config = await this.readWorkspaceConfig(rootRealPath);
    this.searchPolicy = createTraversalPolicy(this.config);
    this.browseIndex = createOnlyPreviewBrowseIndex(rootRealPath, {
      searchPolicy: this.searchPolicy
    });
    const startedAt = this.diagnostics.now();
    const listing = await this.emitRootBrowseListing();
    this.diagnostics.emit('root-listing', {
      tag: diagnostic.tag,
      count: listing?.entries?.length ?? 0,
      elapsedMs: this.diagnostics.elapsed(startedAt),
      queued: false
    });
  }

  async initializeIndexed({ workspaceId, generation, rootRealPath, databaseRealPath, diagnostic }) {
    await mkdir(dirname(databaseRealPath), { recursive: true });
    await reclaimInterruptedSqliteArtifacts(databaseRealPath);
    this.workspaceId = workspaceId;
    this.generation = generation;
    this.watchCommitRevision = 0;
    this.rootPath = rootRealPath;
    this.databasePath = databaseRealPath;
    // 配置、遍历策略与 browseIndex 都由 `openBrowseSurface` 在入队之前建好了。
    // **这里绝不能重建 browseIndex**:目录令牌是 `randomUUID()`,按实例存在 `tokenByPath` 里,
    // 换一个实例就等于把 Shell 手里那批令牌全部作废,点开任何目录都会拿到无效 capability。
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
        if (config.hash === this.config.hash) return;
        await this.runIndexTask('config-refresh', () => this.refreshFromWatchInternal(config));
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
      onReconcile: (change, options) =>
        this.enqueue(async () => {
          if (this.watchRevision !== watchRevision) return;
          return await this.runIndexTask('reconcile', () =>
            this.applyWatchChangesInternal(change, options)
          );
        }),
      onError: () => undefined
    });
    this.state = canReconcile ? 'reconciling' : 'building';
    this.treeEntries = sortOnlyPreviewTreeEntries(seedTree.entries);
    this.maxDepthReached = seedTree.maxDepthReached;
    this.treeMetadataReady = seedTree.treeMetadataReady;
    // 补上一次没做完的删除 —— **必须在种子树落到 `this.treeEntries` 之后**,否则上面这三行会把
    // 刚清掉的条目按旧快照原样写回来。设计见 index-solution.html #1 的 S4–S6。
    diagnostic.phase = 'delete-journal';
    await this.recoverPendingDeletes(diagnostic);
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
      // 根列表已经由 `openBrowseSurface` 在入队之前发过了,这里不再重发:同一个 browseIndex、
      // 同一批令牌,重发一次只会让「一次 initialize 广播一次根列表」这个既有契约变成两次。
      // 重建后的重新广播另有其路(`emitOpenBrowseListings`),不经过这里。
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
      await this.buildAndPromoteCandidateExclusive({
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

  /**
   * 把一个索引写入操作排进该库的任务队列(`index-queue.mjs`,并发度 1)。
   *
   * **提交只发生在公共入口,内部一律走无锁体** —— `initialize` / `refresh` / `config-refresh` /
   * `reconcile` / `forget-paths` / `finish-delete-task` 各提交一次,它们内部调用的是
   * `buildAndPromoteCandidateExclusive`、`refreshInternal`、`forgetPathsIndexed` 这些不再提交的
   * 版本。所以这里不需要任何可重入机制。
   *
   * 早先版本用一个实例级的 `indexTaskDepth` 计数来判"已在任务里",那是错的:它在任务**刚排进
   * 队、还没轮到**的时候就已经置位,于是本引擎在排队期间发起的任何别的写入都会认为自己是嵌套的,
   * 直接绕过队列执行 —— 恰好和**另一个**引擎正在跑的任务并发。实例级计数器从原理上就分不清
   * "嵌套"和"并发且独立"。
   */
  async runIndexTask(name, operation, key = this.databasePath) {
    // 键必须和后续写入用的 `this.databasePath` 完全一致,否则会排进两条不同的队,互斥变成摆设。
    // 唯一会分叉的情形是索引目录在两次初始化之间被换成了符号链接 —— 静默失去互斥比报错糟得多。
    if (key !== undefined && this.databasePath !== undefined && key !== this.databasePath) {
      this.diagnostics.emit('index-queue-key-mismatch', { task: name });
    }
    return await submitIndexTask(key, name, operation);
  }

  async buildAndPromoteCandidateExclusive({
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
    /**
     * 建库过程中的**分阶段内存采样**。
     *
     * 为什么需要:2026-09-20 那次 8 分钟的全量重建(`elapsedMs=480771`,40,679 个文件)期间系统可用
     * 内存掉到 1%(`freeMem=241MB`),隐藏 renderer 被打死、运行时再没起来。但那 8 分钟里**没有任何
     * 内存记录** —— `measureOnlyPreviewSearchMemory` 只在特定时点被调用,所以"内存花在哪一段"至今
     * 是空白,而不知道这一点就只能靠猜去拧参数(FTS 行数?事务大小?树元数据?)。
     *
     * **按时间节流,不按批次**:批次数随工作区大小线性增长,按批采样会让大仓刷屏;按 5 秒一次,
     * 无论 4 万还是 40 万文件,一次重建的采样量都是个位数到几十条。
     *
     * **单独的事件,不往 `emitBuildProgress` 里加字段** —— 那个载荷要过 relay 的精确键校验
     * (`_isBuildProgress`),多一个键就是又一次 `INDEX_PROTOCOL_ERROR`(2026-09-17 的教训)。
     * 这里走 `diagnostics.emit`,那是纯日志通道,不上线。
     *
     * 只读 `process.memoryUsage()`:微秒级,且不像 `measureOnlyPreviewSearchMemory` 那样要去问
     * `index.diskBytes()`(那是一次 I/O,放在建库热路径上会自己变成开销)。
     */
    const MEMORY_SAMPLE_INTERVAL_MS = 5_000;
    let lastMemorySampleAt = 0;
    const sampleMemory = (completed, force = false) => {
      const now = this.diagnostics.now();
      if (!force && now - lastMemorySampleAt < MEMORY_SAMPLE_INTERVAL_MS) return;
      lastMemorySampleAt = now;
      const usage = process.memoryUsage();
      const mb = (bytes) => Math.round(bytes / (1024 * 1024));
      this.diagnostics.emit('build-memory', {
        tag: diagnostic?.tag,
        mode: reconcileExisting ? 'reconcile' : 'rebuild',
        completed,
        total,
        rssMiB: mb(usage.rss),
        heapUsedMiB: mb(usage.heapUsed),
        externalMiB: mb(usage.external),
        arrayBuffersMiB: mb(usage.arrayBuffers),
        treeEntries: candidateTreeEntries.length,
        elapsedMs: this.diagnostics.elapsed(traversalStartedAt)
      });
    };
    sampleMemory(0, true);
    const onBatch = ({ fileCount }) => {
      const completed = Math.min(total, fileCount);
      sampleMemory(completed);
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
    // 收尾强制采一次:峰值经常落在最后一批写入与索引收尾之间,按 5 秒节流可能正好错过。
    sampleMemory(completed, true);
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
        // **无条件连 sidecar 一起搬,不只在判定损坏时。**
        //
        // 裸 `rename` 只搬主库,把 `<db>-wal` / `<db>-shm` 留在原地。这本来是安全的 —— 上面刚关掉
        // 最后一个连接,SQLite 会顺手把 WAL 删掉。但"最后一个"这个前提不成立:同一个库上可能还有
        // 另一个引擎的 `this.index` 开着(队列只挡新构建入队,挡不住已经在跑的旧引擎),它让 WAL 活
        // 了下来。于是候选被改名过来之后,旁边躺着的是**上一个**数据库的 WAL。
        //
        // WAL 里没有任何指回所属数据库的信息 —— 只有 salt 和校验链 —— 而这两个文件页大小和 schema
        // 都一样,于是旧库的帧会干干净净地回放到新库上。2026-09-21 的取证副本就是这个形态:
        // 一段连续页被引用两次(`2nd reference to page 663714…`)、同树 rowid 乱序、FTS5 malformed。
        await renameSqliteIndexArtifacts(this.databasePath, previousPath);
        movedPrevious = true;
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
      // 把候选搬过来之前,先清掉活库路径上残留的 sidecar。
      //
      // 这是在**强制不变量**,不是在修一个已复现的缺陷 —— 说清楚以免后人误读。不变量是:活库路径
      // 旁边永远不能躺着不属于当前主库的 WAL,因为它会在下次打开时被回放到另一个镜像上,正是
      // 2026-09-21 那两份真损坏的库(`2nd reference to page …`)的成因。
      //
      // 顺带消掉一个由本次改动引入的脆弱点:裸 `rename` 静默覆盖已存在的目标,而换用的
      // `renameSqliteIndexArtifacts` 走 `moveSqliteArtifacts`,目标已存在会抛 `EEXIST`,提升随之
      // 整个失败。常规路径碰不到(候选干净关闭后没有 sidecar,所以它们不会成为改名目标 —— 试过
      // 构造孤儿 sidecar 复现,修复前后都通过,说明那条路走不通),但只要候选因为关闭失败而留下
      // 一个 `-wal`,目标就会被占。清一次的代价是三次 `rm`,不值得为省它保留这个脆弱点。
      //
      // **只清 sidecar,不碰主库。** 走到这里 `<db>` 必然已经不在了 —— 要么刚被搬走,要么本来就
      // 不存在(失败路径会在上面就抛出)。但那是三层推理换来的"必然",而赌错的代价是删掉用户的
      // 活索引。只清 sidecar 就不需要这个赌注:少一个前提,少一类事故。
      await removeSqliteSidecars(this.databasePath);
      // 候选那边同理:它的 `-wal` 若因关闭失败而留存,不跟着搬就等于把已提交的帧丢在原地。
      await renameSqliteIndexArtifacts(candidatePath, this.databasePath);
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
          // 回滚走和提升同一条路:主库和 sidecar 必须整组回去,否则恢复出来的库配的是别人的 WAL。
          await renameSqliteIndexArtifacts(previousPath, this.databasePath);
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
    const build = this.enqueue(
      async () => await this.runIndexTask('refresh', () => this.refreshInternal())
    );
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
      await this.buildAndPromoteCandidateExclusive({
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
    // 浏览判据,不是索引判据 —— 展开目录不需要等索引写锁,这正是本次修复的要点。
    this.requireBrowseWorkspace(workspaceId, generation);
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

  /**
   * 开一条删除任务。**必须先于第一个 unlink** —— 崩在这之前什么都没发生,崩在这之后有账可查。
   *
   * 日志写失败就抛,由调用方中止删除:没有账本的删除正是这次要消灭的状态,不能带病往下走。
   */
  async beginDeleteTask({ workspaceId, generation, relativePaths }) {
    this.requireWorkspace(workspaceId, generation);
    if (!this.databasePath) throw new TypeError('Search index is not initialized');
    // 日志的读-改-写必须和别的索引写入排同一条队:两次删除同时在飞(多选删除、或者手快点两下)
    // 就是两段交叠的读-改-写,后写的会把先写的那条任务整个吞掉。它很快,不会占住队列。
    const task = await this.runIndexTask('begin-delete-task', () =>
      beginDeleteTask(this.databasePath, {
        workspaceId,
        rootPath: this.rootPath,
        relativePaths
      })
    );
    return { taskId: task.taskId };
  }

  /**
   * 文件删完之后收尾:换挡到 `'index'` → 清索引 → 消任务。
   *
   * 这三步的顺序就是崩溃恢复的全部依据,见 index-solution.html #4。`removedPaths` 只含**真正
   * 删掉的**那些 —— 部分失败时剩下的文件还在盘上,清了它们的索引会让还存在的内容搜不到。
   */
  async finishDeleteTask({ workspaceId, generation, taskId, removedPaths }) {
    this.requireWorkspace(workspaceId, generation);
    if (!this.databasePath) throw new TypeError('Search index is not initialized');
    // 换挡、清索引、销账三步**在同一个队列任务里**。
    //
    // 拆开会有两个后果。一是日志的读-改-写不再是临界区:两次删除同时在飞(多选删除,或者手快
    // 点了两下)就是两段交叠的 RMW,后写的把先写的那条任务整个吞掉。二是中间那步清索引会和别的
    // 引擎的构建并发 —— 正是队列本身要消灭的东西。
    return await this.runIndexTask('finish-delete-task', async () => {
      await advanceDeleteTaskToIndex(this.databasePath, { taskId, removedPaths });
      const outcome = await this.forgetPathsIndexed({
        workspaceId,
        generation,
        relativePaths: removedPaths
      });
      await clearDeleteTask(this.databasePath, taskId);
      return outcome;
    });
  }

  /**
   * 启动时把上一次没做完的删除补完(index-solution.html #1 的 S4–S6)。
   *
   * **只补清索引,不替用户补删文件。** 任务里仍然存在的路径说明上次那一条没删成;删除是破坏性
   * 动作,重启之后无人确认就自己执行是不能接受的 —— 那些路径原样留下,照常被索引。
   *
   * 顺序固定为"先清索引、再消任务":反过来的话,在两步之间崩溃就会永久丢掉这条欠账。重复执行
   * 是安全的,删一行不存在的索引行是幂等的。
   *
   * 整段**不抛**:一条读不懂的日志、一次清理失败,都不该挡住应用启动 —— 那比丢掉这次恢复更糟,
   * 而丢掉恢复的后果会被下一次全量 reconcile 补上。
   */
  async recoverPendingDeletes(diagnostic) {
    if (!this.databasePath) return;
    let tasks;
    try {
      tasks = await readDeleteJournal(this.databasePath);
    } catch {
      return;
    }
    if (!tasks.length) return;
    for (const task of tasks) {
      try {
        // 只认属于本工作区的任务。日志现在跟着库文件走,同一份日志理应只有本工作区的任务;
        // 但一份来自旧版本、或被手工搬过的日志仍可能带着别人的条目,而下面是拿**本**工作区的
        // 根路径去解析相对路径的 —— 张冠李戴地判"文件已不存在",就会清掉本工作区里同名的索引行。
        if (task.workspaceId !== this.workspaceId || task.rootPath !== this.rootPath) continue;
        const settled = [];
        for (const relativePath of task.relativePaths) {
          // 还在盘上 = 上次没删成,跳过它。
          if (await pathExists(resolve(this.rootPath, relativePath))) continue;
          settled.push(relativePath);
        }
        if (settled.length) {
          // 没有活索引就没法清 —— `forgetPathsIndexed` 会在 `!this.index` 时直接返回。此时销账
          // 等于把一笔没还的债抹掉。留着不花任何代价:下次启动发现文件早就没了,再清一次,
          // 清一行不存在的索引行是幂等的。
          if (!this.index) continue;
          const outcome = await this.forgetPathsIndexed({
            workspaceId: this.workspaceId,
            generation: this.generation,
            relativePaths: settled
          });
          this.diagnostics.emit('delete-journal-recovered', {
            tag: diagnostic?.tag,
            paths: settled.length,
            removedFileCount: outcome.removedFileCount
          });
        }
        await clearDeleteTask(this.databasePath, task.taskId);
      } catch {
        // 这一条补不上就留着,下次启动再试。
      }
    }
  }

  /**
   * 删除落地之后,立刻把这些路径(及其子孙)从活索引里抹掉。
   *
   * 在此之前删除**完全不通知索引**:`commitDelete` 删完文件就返回,索引只能等 watcher 触发一次
   * reconcile,而一次 reconcile 要 80–120 秒 —— 这段时间里删掉的内容照样被搜得到。
   *
   * **必须连子孙一起删。** watcher 那条路径对删目录只产生一条 `remove`,树靠
   * `pathHasAncestorIn` 把子孙摘掉了,但 `files` 表里子孙的行没人删 —— 结果是目录从浏览里消失、
   * 内容却仍然可搜的半删状态。这里按 `filenameTier` 里已索引的全部路径逐条判归属,所以目录和
   * 文件走同一条逻辑。
   *
   * 走 `acquireSearchSnapshotWriter`,和 reconciler 的增量提交用同一道读写闸,读者被排空之后才动
   * 库;失败时让调用方看见,因为"文件删了、索引没删"正是这次要消灭的状态,不能静默吞掉。
   */
  async forgetPaths(params) {
    return await this.runIndexTask('forget-paths', () => this.forgetPathsIndexed(params));
  }

  async forgetPathsIndexed({ workspaceId, generation, relativePaths }) {
    this.requireWorkspace(workspaceId, generation);
    const roots = new Set(
      (Array.isArray(relativePaths) ? relativePaths : [])
        .filter((value) => typeof value === 'string' && value.length > 0)
    );
    if (roots.size === 0 || !this.index) return { removedFileCount: 0 };
    const owned = (relativePath) => roots.has(relativePath) || pathHasAncestorIn(relativePath, roots);
    const writer = await this.acquireSearchSnapshotWriter();
    try {
      const targets = [];
      for (const relativePath of this.index.filenameTier.records.keys()) {
        if (owned(relativePath)) targets.push(relativePath);
      }
      this.index.invalidateTreeSnapshot();
      const deletedIndexedPaths = [];
      for (let offset = 0; offset < targets.length; offset += BACKGROUND_BUILD_TRANSACTION_FILES) {
        const batch = targets.slice(offset, offset + BACKGROUND_BUILD_TRANSACTION_FILES);
        this.index.runMutation(() => {
          for (const relativePath of batch) {
            if (this.index.delete(relativePath, { syncFilenameTier: false, withinTransaction: true })) {
              deletedIndexedPaths.push(relativePath);
            }
          }
        });
      }
      this.index.applyFilenameTierMutations({ upsertPaths: [], deletePaths: deletedIndexedPaths });
      this.treeEntries = this.treeEntries.filter(({ relativePath }) => !owned(relativePath));
      // **树没就绪就只改内存,不碰持久化的树快照。**
      //
      // `applyTreeSnapshotMutations` 会无条件把 `tree_state` 置成 `'ready'` 并写下当前的
      // `tree_max_depth_reached`。树本来就不就绪时(上一次增量提交被打断会留下 `'invalid'`),
      // 这等于拿一份崩溃前的旧 `search_tree` 冒充就绪,还把"深度没有被截断"这个多半是假的结论
      // 一起固化。之后那次重建若失败或被取消,引擎会带着一棵假就绪的树进入 ready 状态,而
      // reconciler 的修复路径以 `treeMetadataReady` 为闸,永远不会再来碰它。
      //
      // 保持 `'invalid'` 则什么都不丢:内存里的条目已经剔干净,持久层留给正常的修复流程。
      // `watch-reconciler.mjs` 在同一个位置也是这么把关的。
      if (this.treeMetadataReady) {
        const committedTree = this.index.applyTreeSnapshotMutations({
          upserts: [],
          removedPaths: roots,
          maxDepthReached: this.maxDepthReached
        });
        this.treeMetadataReady = committedTree.treeMetadataReady;
      }
      return { removedFileCount: deletedIndexedPaths.length };
    } finally {
      writer.release();
    }
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

  async applyWatchChangesInternal(change, options) {
    // 返回值必须透传:控制器靠它知道这批变更被判定需要整库重建,从而重排成全量、走退避闸。
    // 见 watch-reconciler.mjs 的 REBUILD_REQUIRED。
    return await this.watchReconciler.apply(change, options);
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
