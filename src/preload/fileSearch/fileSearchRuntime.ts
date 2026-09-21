import {
  OnlyPreviewContractError,
  onlyPreviewFailure,
  onlyPreviewSuccess
} from '@shared/onlypreview/onlyPreview.contract';
import type { OnlyPreviewResult } from '@shared/onlypreview/onlyPreview.types';
import type { OnlyPreviewSearchBootstrap } from '@shared/onlypreview/onlyPreviewSearchBootstrap.types';
import {
  parseOnlyPreviewBrowseDirectoryRequest,
  parseOnlyPreviewGlobalSearchOfficeReadChunkRequest,
  parseOnlyPreviewGlobalSearchOfficeReadRequest,
  parseOnlyPreviewGlobalSearchPreviewRequest,
  parseOnlyPreviewSearchCancelRequest,
  parseOnlyPreviewSearchInitializeRequest,
  parseOnlyPreviewSearchPrioritizeFileRequest,
  parseOnlyPreviewSearchRequest,
  parseOnlyPreviewSearchShutdownRequest
} from '@shared/onlypreview/onlyPreviewSearch.contract';
import {
  ONLY_PREVIEW_BROWSE_LISTING_EVENT,
  ONLY_PREVIEW_SEARCH_BATCH_EVENT,
  ONLY_PREVIEW_SEARCH_FAILURE_EVENT,
  ONLY_PREVIEW_SEARCH_PROGRESS_EVENT,
  ONLY_PREVIEW_SEARCH_SNAPSHOT_EVENT,
  ONLY_PREVIEW_SEARCH_WATCH_COMMIT_EVENT,
  type OnlyPreviewBrowseDirectoryRequest,
  type OnlyPreviewBrowseListing,
  type OnlyPreviewGlobalSearchOfficeReadChunkRequest,
  type OnlyPreviewGlobalSearchOfficeReadChunkResult,
  type OnlyPreviewGlobalSearchOfficeReadOpenResult,
  type OnlyPreviewGlobalSearchOfficeReadRequest,
  type OnlyPreviewGlobalSearchPreview,
  type OnlyPreviewGlobalSearchPreviewRequest,
  type OnlyPreviewSearchCancelRequest,
  type OnlyPreviewSearchInitializeRequest,
  type OnlyPreviewSearchPrioritizeFileRequest,
  type OnlyPreviewSearchRequest,
  type OnlyPreviewSearchResponse,
  type OnlyPreviewSearchRuntimeApi,
  type OnlyPreviewSearchShutdownRequest,
  type OnlyPreviewSearchSnapshot,
  type OnlyPreviewSearchWatchCommit
} from '@shared/onlypreview/onlyPreviewSearch.type';
import { isOnlyPreviewSearchRuntimeEventCurrent } from '@preload/onlypreview/search/onlyPreviewSearchRuntimeFence.service';
import {
  createOnlyPreviewSearchDiagnostics,
  type OnlyPreviewSearchDiagnostics
} from '@shared/onlypreview/onlyPreviewSearchDiagnostics.mjs';
import {
  createFileSearchCoordinator,
  type CreateOnlyPreviewSearchCoordinatorOptions,
  type OnlyPreviewSearchCoordinator
} from './fileSearchCoordinator';

interface FileSearchRuntimeRegistration {
  emit(eventName: string, value: unknown): void;
}

interface PendingBuild {
  response: Promise<OnlyPreviewSearchSnapshot>;
  resolve(snapshot: OnlyPreviewSearchSnapshot): void;
  reject(error: Error): void;
  acknowledged: boolean;
}

interface ActiveRuntime {
  sessionId: number;
  workspaceId: string;
  generation: number;
  bootstrap: OnlyPreviewSearchBootstrap;
  initialized: boolean;
  build: PendingBuild | null;
  coordinator: OnlyPreviewSearchCoordinator;
}

type FileSearchCoordinatorFactory = (
  options: CreateOnlyPreviewSearchCoordinatorOptions
) => OnlyPreviewSearchCoordinator;

const runOperation = async <T>(operation: () => Promise<T>): Promise<OnlyPreviewResult<T>> => {
  try {
    return onlyPreviewSuccess(await operation());
  } catch (error) {
    if (process.env.BITTERLESS_E2E === '1' && error instanceof Error) {
      return onlyPreviewFailure(new OnlyPreviewContractError('OPERATION_FAILED', error.message));
    }
    return onlyPreviewFailure(error);
  }
};

const requireBootstrap = (
  value: OnlyPreviewSearchBootstrap | undefined,
  workspaceId: string
): OnlyPreviewSearchBootstrap => {
  if (
    !value ||
    value.workspaceId !== workspaceId ||
    typeof value.rootPath !== 'string' ||
    !value.rootPath ||
    typeof value.databasePath !== 'string' ||
    !value.databasePath
  ) {
    throw new OnlyPreviewContractError(
      'WORKSPACE_ACCESS_DENIED',
      'OnlyPreview search bootstrap does not match the requested workspace.'
    );
  }
  return value;
};

export class FileSearchRuntime implements OnlyPreviewSearchRuntimeApi {
  private active: ActiveRuntime | null = null;
  private sessionId = 0;
  private hostToken: string | null = null;
  private targetWorkspaceId: string | null = null;

  constructor(
    private readonly registration: FileSearchRuntimeRegistration,
    private readonly createCoordinator: FileSearchCoordinatorFactory = createFileSearchCoordinator,
    private readonly diagnostics: OnlyPreviewSearchDiagnostics = createOnlyPreviewSearchDiagnostics()
  ) {}

  async initialize(
    params: OnlyPreviewSearchInitializeRequest,
    internalBootstrap?: OnlyPreviewSearchBootstrap
  ): Promise<OnlyPreviewResult<OnlyPreviewSearchSnapshot>> {
    const diagnostic = { tag: this.diagnostics.nextTag('r'), startedAt: this.diagnostics.now() };
    this.diagnostics.emit('runtime-accepted', {
      tag: diagnostic.tag,
      method: 'initialize',
      generation: params.generation
    });
    const result = await runOperation(async () => {
      const request = parseOnlyPreviewSearchInitializeRequest(params);
      // Authorization BEFORE any state change, then adopt the host the authorized call names.
      //
      // The old order ran `_bindHost` first, which made a surviving runtime reject the host that
      // replaced its original one — the `HOST_ROLE_DENIED · does not belong to this file-search
      // runtime` seen after an OnlyPreview host toggle. The toggle is exactly the case where the
      // host legitimately changes while the runtime, and the index build inside it, keep running.
      //
      // Rebinding here is safe because reaching this method at all is already gated on main: the
      // preload entry point requires a main-issued capability, and `internalBootstrap` is resolved
      // in main from a host-scoped bootstrap token. `fileSearchRuntimeRelayService` is the single
      // authority on which host owns the runtime, and it rejects a stale host itself. This field
      // was a duplicate of that decision that no one updated — a second source of truth, which is
      // why it went stale rather than wrong.
      const bootstrap = requireBootstrap(internalBootstrap, request.workspaceId);
      this._adoptHost(request.hostToken);
      this.targetWorkspaceId = request.workspaceId;
      const sessionId = ++this.sessionId;
      this._requireCurrentSession(sessionId);
      await this._shutdownActive();
      this._requireCurrentSession(sessionId);
      const coordinator = this._createCoordinator(sessionId);
      const active: ActiveRuntime = {
        sessionId,
        workspaceId: request.workspaceId,
        generation: request.generation,
        bootstrap,
        initialized: false,
        build: null,
        coordinator
      };
      this.active = active;
      try {
        const snapshot = await this._startBuild(active, () => this._initializeCoordinator(active));
        this._requireActive(active);
        return snapshot;
      } catch (error) {
        let hasActiveSearchIndex = false;
        try {
          hasActiveSearchIndex = coordinator.hasActiveSearchIndex({
            workspaceId: active.workspaceId,
            generation: active.generation
          });
        } catch {
          // A failed recovery probe is fatal and follows the normal cleanup path below.
        }
        if (this.active === active && this.sessionId === sessionId && hasActiveSearchIndex) {
          throw error;
        }
        if (this.active === active) this.active = null;
        await coordinator.shutdown().catch(() => undefined);
        throw error;
      }
    });
    this.diagnostics.emit('runtime-terminal', {
      tag: diagnostic.tag,
      method: 'initialize',
      outcome: result.ok ? 'success' : 'failure',
      elapsedMs: this.diagnostics.elapsed(diagnostic.startedAt)
    });
    return result;
  }

  async refresh(
    params: OnlyPreviewSearchInitializeRequest
  ): Promise<OnlyPreviewResult<OnlyPreviewSearchSnapshot>> {
    return await runOperation(async () => {
      const request = parseOnlyPreviewSearchInitializeRequest(params);
      const active = this._requireActiveRequest(request);
      return await this._startBuild(active, () =>
        active.initialized
          ? active.coordinator.refresh({
              workspaceId: request.workspaceId,
              generation: request.generation
            })
          : this._initializeCoordinator(active)
      );
    });
  }

  async prioritizeFile(
    params: OnlyPreviewSearchPrioritizeFileRequest
  ): Promise<OnlyPreviewResult<void>> {
    return await runOperation(async () => {
      const request = parseOnlyPreviewSearchPrioritizeFileRequest(params);
      const active = this._requireActiveRequest(request);
      await active.coordinator.prioritizeFile(request);
    });
  }

  async browseDirectory(
    params: OnlyPreviewBrowseDirectoryRequest
  ): Promise<OnlyPreviewResult<OnlyPreviewBrowseListing>> {
    return await runOperation(async () => {
      const request = parseOnlyPreviewBrowseDirectoryRequest(params);
      const active = this._requireActiveRequest(request);
      return await active.coordinator.browseDirectory(request);
    });
  }

  async search(
    params: OnlyPreviewSearchRequest
  ): Promise<OnlyPreviewResult<OnlyPreviewSearchResponse>> {
    const diagnostic = { tag: this.diagnostics.nextTag('r'), startedAt: this.diagnostics.now() };
    this.diagnostics.emit('runtime-accepted', {
      tag: diagnostic.tag,
      method: 'search',
      generation: params.generation
    });
    const result = await runOperation(async () => {
      const request = parseOnlyPreviewSearchRequest(params);
      const active = this._requireActiveRequest(request);
      return await active.coordinator.search(request);
    });
    this.diagnostics.emit('runtime-terminal', {
      tag: diagnostic.tag,
      method: 'search',
      outcome: result.ok ? 'success' : 'failure',
      elapsedMs: this.diagnostics.elapsed(diagnostic.startedAt)
    });
    return result;
  }

  async preview(
    params: OnlyPreviewGlobalSearchPreviewRequest
  ): Promise<OnlyPreviewResult<OnlyPreviewGlobalSearchPreview>> {
    return await runOperation(async () => {
      const request = parseOnlyPreviewGlobalSearchPreviewRequest(params);
      const active = this._requireActiveRequest(request);
      return await active.coordinator.preview(request);
    });
  }

  async openOfficeRead(
    params: OnlyPreviewGlobalSearchOfficeReadRequest
  ): Promise<OnlyPreviewResult<OnlyPreviewGlobalSearchOfficeReadOpenResult>> {
    return await runOperation(async () => {
      const request = parseOnlyPreviewGlobalSearchOfficeReadRequest(params);
      const active = this._requireActiveRequest(request);
      return await active.coordinator.openOfficeRead(request);
    });
  }

  async readOfficeChunk(
    params: OnlyPreviewGlobalSearchOfficeReadChunkRequest
  ): Promise<OnlyPreviewResult<OnlyPreviewGlobalSearchOfficeReadChunkResult>> {
    return await runOperation(async () => {
      const request = parseOnlyPreviewGlobalSearchOfficeReadChunkRequest(params);
      const active = this._requireActiveRequest(request);
      return await active.coordinator.readOfficeChunk(request);
    });
  }

  async cancelOfficeRead(
    params: OnlyPreviewGlobalSearchOfficeReadRequest
  ): Promise<OnlyPreviewResult<void>> {
    return await runOperation(async () => {
      const request = parseOnlyPreviewGlobalSearchOfficeReadRequest(params);
      const active = this._requireActiveRequest(request);
      await active.coordinator.cancelOfficeRead(request);
    });
  }

  async cancel(params: OnlyPreviewSearchCancelRequest): Promise<OnlyPreviewResult<void>> {
    return await runOperation(async () => {
      const request = parseOnlyPreviewSearchCancelRequest(params);
      this._requireHost(request.hostToken);
      await this.active?.coordinator.cancel({ requestId: request.requestId });
    });
  }

  async shutdown(params: OnlyPreviewSearchShutdownRequest): Promise<OnlyPreviewResult<void>> {
    return await runOperation(async () => {
      const request = parseOnlyPreviewSearchShutdownRequest(params);
      this._requireHost(request.hostToken);
      await this.dispose();
    });
  }

  async dispose(): Promise<void> {
    this.targetWorkspaceId = null;
    this.sessionId += 1;
    await this._shutdownActive();
  }

  /** Stop only this Project's search/build/watch, keeping the host runtime and external readers. */
  async revokeWorkspace(workspaceId: string): Promise<void> {
    if (this.targetWorkspaceId !== workspaceId) return;
    await this.dispose();
  }

  /**
   * 供 `fileSearch.preload.ts` 的 `commitDelete` 直接调用的进程内方法 —— **不经过 XPC**,
   * 两者本来就在同一个隐藏 renderer 进程里,`runtime` 是同一个模块作用域里的实例。
   *
   * 不从调用方接收 `workspaceId`/`generation`:那两个字段如果由 `commitDelete` 传入,传的会是
   * **Project authority** 自己的代次(`onlyPreviewWorkspace.registry.ts` 的
   * `requireProjectAuthorityGeneration`),和这里 `this.active` 记的搜索引擎代次是两个独立计数
   * 空间,传错会让 `engine.requireWorkspace()` 每次都拒绝。所以两个字段一律从 `this.active`
   * 自己取 —— 调用方只需要知道"删了哪些路径",不需要关心搜索引擎当前是第几代。
   *
   * `this.active` 为空(索引从未初始化,或已被关停)不是错误 —— 没有索引就没有"索引还欠着"这回事,
   * 返回 `null`,调用方据此跳过整套 begin/finish 流程,直接删文件。
   */
  async beginDeleteTask(
    relativePaths: string[]
  ): Promise<OnlyPreviewResult<{ taskId: string } | null>> {
    return await runOperation(async () => {
      const active = this.active;
      if (!active) return null;
      return await active.coordinator.beginDeleteTask({
        workspaceId: active.workspaceId,
        generation: active.generation,
        relativePaths
      });
    });
  }

  /**
   * `taskId` 必须来自同一次 `beginDeleteTask`。`removedPaths` 只放**真正删掉的**那些 ——
   * 部分失败(比如目录里有一个文件删不掉)时,还在盘上的那些不该被当成欠账去清索引。
   *
   * `removedPaths` 传空数组是合法的"取消"用法:`delete-journal.mjs` 的
   * `advanceDeleteTaskToIndex` 对空表直接销账、不动索引 —— `commitDelete` 失败时用这个把
   * 已经开的任务干净地收掉,而不是让它一直留在日志里等下次启动才被动清理。
   */
  async finishDeleteTask(
    taskId: string,
    removedPaths: string[]
  ): Promise<OnlyPreviewResult<{ removedFileCount: number } | null>> {
    return await runOperation(async () => {
      const active = this.active;
      if (!active) return null;
      return await active.coordinator.finishDeleteTask({
        workspaceId: active.workspaceId,
        generation: active.generation,
        taskId,
        removedPaths
      });
    });
  }

  private async _initializeCoordinator(active: ActiveRuntime): Promise<OnlyPreviewSearchSnapshot> {
    const snapshot = await active.coordinator.initialize({
      workspaceId: active.workspaceId,
      generation: active.generation,
      rootPath: active.bootstrap.rootPath,
      databasePath: active.bootstrap.databasePath
    });
    active.initialized = true;
    return snapshot;
  }

  /** The first snapshot acknowledges the RPC; the build keeps its own observed lifecycle. */
  private _startBuild(
    active: ActiveRuntime,
    operation: () => Promise<OnlyPreviewSearchSnapshot>
  ): Promise<OnlyPreviewSearchSnapshot> {
    if (active.build) return active.build.response;
    let resolve!: PendingBuild['resolve'];
    let reject!: PendingBuild['reject'];
    const response = new Promise<OnlyPreviewSearchSnapshot>((onResolve, onReject) => {
      resolve = onResolve;
      reject = onReject;
    });
    const build: PendingBuild = { response, resolve, reject, acknowledged: false };
    active.build = build;
    void runOperation(operation).then((result) => {
      if (this.active !== active || this.sessionId !== active.sessionId) return;
      if (active.build === build) active.build = null;
      if (result.ok === true) {
        build.resolve(result.value);
      } else if (!build.acknowledged) {
        build.reject(new OnlyPreviewContractError(result.error.code, result.error.message));
      } else {
        // The RPC already succeeded. Do not turn a failed background build into an unhandled
        // rejection or a permanently spinning UI; keep the root listing available for browsing.
        console.warn('[onlypreview-search] Background index build failed.', result.error.code);
        this.registration.emit(ONLY_PREVIEW_SEARCH_FAILURE_EVENT, {
          failure: {
            workspaceId: active.workspaceId,
            generation: active.generation,
            error: result.error
          }
        });
      }
    }).catch(() => {
      // Event delivery is best effort, but a transport failure must remain diagnosable.
      console.warn('[onlypreview-search] Background index failure could not be delivered.');
    });
    return response;
  }

  private _createCoordinator(sessionId: number): OnlyPreviewSearchCoordinator {
    return this.createCoordinator({
      diagnostics: this.diagnostics,
      onBrowseListing: (listing) => {
        const active = this.active;
        if (!isOnlyPreviewSearchRuntimeEventCurrent(active, sessionId, listing)) return;
        this.registration.emit(ONLY_PREVIEW_BROWSE_LISTING_EVENT, { listing });
      },
      onProgress: (progress) => {
        const active = this.active;
        if (!isOnlyPreviewSearchRuntimeEventCurrent(active, sessionId, progress)) return;
        this.registration.emit(ONLY_PREVIEW_SEARCH_PROGRESS_EVENT, { progress });
      },
      onSearchBatch: (batch) => {
        const active = this.active;
        if (!isOnlyPreviewSearchRuntimeEventCurrent(active, sessionId, batch)) return;
        this.registration.emit(ONLY_PREVIEW_SEARCH_BATCH_EVENT, { batch });
      },
      onSnapshot: (snapshot) => {
        const active = this.active;
        if (!isOnlyPreviewSearchRuntimeEventCurrent(active, sessionId, snapshot)) return;
        this.registration.emit(ONLY_PREVIEW_SEARCH_SNAPSHOT_EVENT, { snapshot });
        const build = active?.build;
        if (build && !build.acknowledged) {
          build.acknowledged = true;
          build.resolve(snapshot);
        }
      },
      onWatchCommit: (commit: OnlyPreviewSearchWatchCommit) => {
        const active = this.active;
        if (!isOnlyPreviewSearchRuntimeEventCurrent(active, sessionId, commit)) return;
        this.registration.emit(ONLY_PREVIEW_SEARCH_WATCH_COMMIT_EVENT, { commit });
      }
    });
  }

  private _requireHost(hostToken: string): void {
    if (hostToken !== this.hostToken) {
      throw new OnlyPreviewContractError(
        'HOST_ROLE_DENIED',
        'OnlyPreview search request does not belong to this file-search runtime.'
      );
    }
  }

  /**
   * Records the host named by an already-authorized `initialize`, replacing any earlier one.
   *
   * Unconditional on purpose. Every other method still goes through `_requireHost`, so a request
   * that arrives between two initializes is checked against the host in force at that moment; what
   * this drops is only the claim that the FIRST host to initialize owns the runtime forever, which
   * an OnlyPreview host toggle makes false. See the comment at the call site for why the caller is
   * already trusted.
   */
  private _adoptHost(hostToken: string): void {
    this.hostToken = hostToken;
  }

  private _requireActiveRequest(
    request: Pick<OnlyPreviewSearchInitializeRequest, 'hostToken' | 'workspaceId' | 'generation'>
  ): ActiveRuntime {
    this._requireHost(request.hostToken);
    const active = this.active;
    if (
      !active ||
      active.workspaceId !== request.workspaceId ||
      active.generation !== request.generation
    ) {
      throw new OnlyPreviewContractError(
        'WORKSPACE_ACCESS_DENIED',
        'OnlyPreview search request belongs to a stale workspace generation.'
      );
    }
    return active;
  }

  private _requireActive(active: ActiveRuntime): void {
    if (this.active !== active || this.sessionId !== active.sessionId) {
      throw new OnlyPreviewContractError(
        'OPERATION_FAILED',
        'OnlyPreview search initialization was superseded.'
      );
    }
  }

  private _requireCurrentSession(sessionId: number): void {
    if (this.sessionId !== sessionId) {
      throw new OnlyPreviewContractError(
        'OPERATION_FAILED',
        'OnlyPreview search initialization was superseded.'
      );
    }
  }

  private async _shutdownActive(): Promise<void> {
    const active = this.active;
    this.active = null;
    active?.build?.reject(new OnlyPreviewContractError(
      'OPERATION_FAILED', 'OnlyPreview search initialization was superseded.'
    ));
    await active?.coordinator.shutdown().catch(() => undefined);
  }
}
