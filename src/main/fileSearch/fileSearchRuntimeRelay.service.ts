import {
  normalizeOnlyPreviewRelativePath,
  OnlyPreviewContractError
} from '@shared/onlypreview/onlyPreview.contract';
import type { OnlyPreviewSearchBootstrap } from '@shared/onlypreview/onlyPreviewSearchBootstrap.types';
import {
  isOnlyPreviewSearchErrorPayload,
  isOnlyPreviewSearchFailure
} from '@shared/onlypreview/onlyPreviewSearchFailure.contract';
import type {
  FileSearchRuntimeEventRequest,
  FileSearchRuntimeMethod,
  FileSearchRuntimePrivateApi
} from '@shared/onlypreview/fileSearchRuntime.types';
import {
  createOnlyPreviewSearchDiagnostics,
  type OnlyPreviewSearchDiagnostics
} from '@shared/onlypreview/onlyPreviewSearchDiagnostics.mjs';
import {
  ONLY_PREVIEW_BROWSE_LISTING_EVENT,
  ONLY_PREVIEW_SEARCH_BATCH_EVENT,
  ONLY_PREVIEW_SEARCH_FAILURE_EVENT,
  ONLY_PREVIEW_SEARCH_MAX_BATCH_RESULTS,
  ONLY_PREVIEW_SEARCH_MAX_RESULTS,
  ONLY_PREVIEW_SEARCH_MAX_WATCH_PATHS,
  ONLY_PREVIEW_SEARCH_PROGRESS_EVENT,
  ONLY_PREVIEW_SEARCH_SNAPSHOT_EVENT,
  ONLY_PREVIEW_SEARCH_WATCH_COMMIT_EVENT,
  type OnlyPreviewSearchBuildProgress
} from '@shared/onlypreview/onlyPreviewSearch.type';
import {
  describeOnlyPreviewGlobalSearchBatchRejection,
  isOnlyPreviewGlobalSearchBatch,
  isOnlyPreviewGlobalSearchOfficeReadChunkResult,
  isOnlyPreviewGlobalSearchOfficeReadOpenResult,
  isOnlyPreviewGlobalSearchPreview,
  isOnlyPreviewGlobalSearchResponse
} from './fileSearchGlobalResult.validator';
import {
  FileSearchRetiredRequestRegistry,
  type FileSearchPendingCall,
  type FileSearchPendingExpectation as PendingExpectation
} from './fileSearchRetiredRequest.registry';
export type FileSearchRuntimeClient = FileSearchRuntimePrivateApi;

interface PendingCall extends FileSearchPendingCall {
  renewSearchTimeout?(): void;
}

interface ActiveRuntime {
  hostToken: string;
  hostId: string;
  bootstrapToken: string;
  capability: string;
  client: FileSearchRuntimeClient;
  pending: Set<PendingCall>;
  retiredSearchRequests: FileSearchRetiredRequestRegistry;
  workspaceId: string | null;
  generation: number | null;
  latestSnapshot: unknown;
  buildProgress: OnlyPreviewSearchBuildProgress | null;
  broadcast(eventName: string, params: unknown): void;
  protocolFailure: OnlyPreviewContractError | null;
  onProtocolFailure?: (rule: string) => void;
  protocolFailureSignal: Promise<OnlyPreviewContractError>;
  resolveProtocolFailure(error: OnlyPreviewContractError): void;
  stopped: Promise<void>;
  resolveStopped(): void;
}

const runtimeStoppedError = (): Error =>
  new Error('OnlyPreview file-search runtime stopped unexpectedly.');

const indexProtocolError = (): OnlyPreviewContractError =>
  new OnlyPreviewContractError(
    'INDEX_PROTOCOL_ERROR',
    'OnlyPreview Project search index returned an invalid response.'
  );

const MAX_SEARCH_SNIPPET_CODE_UNITS = 65_536;
const INDEX_STATES = new Set(['building', 'reconciling', 'ready']);
const NODE_KINDS = new Set(['file', 'directory', 'symlink']);
const PREVIEW_HINTS = new Set([
  'text',
  'pdf',
  'image',
  'audio',
  'video',
  'sheet',
  'document',
  'presentation',
  'diagram',
  'unsupported'
]);
const SEARCH_MEDIA_TYPES = new Set(['text', 'image', 'audio', 'video', 'pdf', 'unknown']);
const MEMORY_NUMBER_KEYS = [
  'processRssBytes',
  'workerHeapUsedBytes',
  'workerExternalBytes',
  'treeMetadataEntryCount',
  'treeMetadataEstimatedBytes',
  'filenameTierEstimatedBytes',
  'diskIndexBytes'
] as const;
const searchSnippetSegmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });

export class FileSearchRuntimeRelayService {
  private active: ActiveRuntime | null = null;
  // Set by the batch path just before it rejects, read once by the latch. A field rather than a
  // return value because `_handleEvent` funnels a dozen unrelated rejections into one throw, and
  // threading a reason through all of them would touch every branch to serve one.
  private lastBatchRejection: string | null = null;
  private readonly diagnostics: OnlyPreviewSearchDiagnostics;

  constructor(diagnostics = createOnlyPreviewSearchDiagnostics()) {
    this.diagnostics = diagnostics;
  }

  attach(params: {
    hostToken: string;
    hostId: string;
    bootstrapToken: string;
    capability: string;
    client: FileSearchRuntimeClient;
    broadcast(eventName: string, params: unknown): void;
    /**
     * 协议 latch 触发时叫一次。latch 仍然 fail-closed —— 这个运行时之后确实不该再被信任 ——
     * 但"作废这个运行时"不该等于"整个会话都不能再搜索"。调用方把它接到和渲染进程死亡同一条
     * 恢复路径上,于是坏掉的那个被换掉,而不是让用户只能重启应用。
     */
    onProtocolFailure?: (rule: string) => void;
    /**
     * The runtime is being handed to a NEW host without being restarted, so its workspace binding
     * is still live and must be carried over.
     *
     * Without this the event path below fails closed on `active.workspaceId === null` and latches
     * INDEX_PROTOCOL_ERROR: the surviving runtime keeps emitting index events for the workspace it
     * is still building, and a fresh `active` claims to know nothing about any workspace. Those
     * two fields are only otherwise set by an `initialize` call, which a re-attach deliberately
     * does not make — re-initializing is exactly the restart this whole path exists to avoid.
     */
    preserveWorkspace?: boolean;
  }): void {
    const carried =
      params.preserveWorkspace && this.active
        ? {
            workspaceId: this.active.workspaceId,
            generation: this.active.generation,
            buildProgress: this.active.buildProgress
          }
        : { workspaceId: null, generation: null, buildProgress: null };
    this.detach();
    let resolveStopped = (): void => undefined;
    const stopped = new Promise<void>((resolve) => {
      resolveStopped = resolve;
    });
    let resolveProtocolFailure: (error: OnlyPreviewContractError) => void = () => undefined;
    const protocolFailureSignal = new Promise<OnlyPreviewContractError>((resolve) => {
      resolveProtocolFailure = resolve;
    });
    const active: ActiveRuntime = {
      hostToken: params.hostToken,
      hostId: params.hostId,
      bootstrapToken: params.bootstrapToken,
      capability: params.capability,
      client: params.client,
      pending: new Set(),
      retiredSearchRequests: new FileSearchRetiredRequestRegistry(),
      workspaceId: carried.workspaceId,
      generation: carried.generation,
      latestSnapshot: null,
      buildProgress: carried.buildProgress,
      broadcast: params.broadcast,
      protocolFailure: null,
      onProtocolFailure: params.onProtocolFailure,
      protocolFailureSignal,
      resolveProtocolFailure,
      stopped,
      resolveStopped
    };
    this.active = active;
  }

  async call(
    hostToken: string,
    method: FileSearchRuntimeMethod,
    params: unknown,
    timeoutMs: number,
    bootstrap?: OnlyPreviewSearchBootstrap
  ): Promise<unknown> {
    const diagnosticMethod = method === 'initialize' || method === 'search' ? method : null;
    const diagnostic = diagnosticMethod
      ? { tag: this.diagnostics.nextTag('x'), startedAt: this.diagnostics.now() }
      : null;
    if (diagnostic && diagnosticMethod) {
      this.diagnostics.emit('xpc-start', { tag: diagnostic.tag, method: diagnosticMethod });
    }
    let active: ActiveRuntime | null = null;
    let pending: PendingCall | null = null;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let outcome: 'success' | 'failure' = 'failure';
    try {
      active = this.active;
      if (!active) throw runtimeStoppedError();
      if (active.hostToken !== hostToken) {
        throw new OnlyPreviewContractError(
          'HOST_ROLE_DENIED',
          'OnlyPreview search request does not belong to the active file-search runtime.'
        );
      }
      if (active.protocolFailure) throw active.protocolFailure;
      const expectation = this._createPendingExpectation(method, params);
      if (method === 'initialize') {
        active.workspaceId = expectation.workspaceId;
        active.generation = expectation.generation;
        active.latestSnapshot = null;
        active.buildProgress = null;
        active.retiredSearchRequests.clear();
      } else if (method === 'search' && expectation.requestId !== null) {
        active.retiredSearchRequests.retireSuperseded(
          active.pending,
          expectation.workspaceId,
          expectation.generation,
          expectation.requestId
        );
        active.retiredSearchRequests.forget(expectation.requestId);
      }
      pending = { expectation };
      active.pending.add(pending);
      const runtimeParams =
        method === 'initialize'
          ? { capability: active.capability, request: params, bootstrap }
          : { capability: active.capability, request: params };
      const operation = active.client[method](runtimeParams as never);
      const result = await Promise.race([
        operation,
        new Promise<never>((_resolve, reject) => {
          const renewTimeout = (): void => {
            if (timeout) clearTimeout(timeout);
            timeout = setTimeout(
              () => reject(new Error('OnlyPreview file-search runtime request timed out.')),
              timeoutMs
            );
          };
          if (pending && method === 'search') pending.renewSearchTimeout = renewTimeout;
          renewTimeout();
        }),
        active.stopped.then(() => {
          throw runtimeStoppedError();
        }),
        active.protocolFailureSignal.then((error) => {
          throw error;
        })
      ]);
      if (!this._isResponseResult(result, expectation)) {
        throw this._latchProtocolFailure(active, 'search-response-shape');
      }
      if (expectation.method === 'cancel' && this._isRecord(result) && result.ok === true) {
        active.retiredSearchRequests.retireCancelled(
          active.pending,
          active.workspaceId,
          active.generation,
          expectation.requestId
        );
      }
      outcome = 'success';
      // The first-snapshot acknowledgement can arrive after a newer broadcast. Never let that
      // delayed building response regress Main's or the renderer's already-ready state.
      if (
        (method === 'initialize' || method === 'refresh') &&
        this._isRecord(result) && result.ok === true &&
        this._isRecord(active.latestSnapshot) &&
        active.latestSnapshot.workspaceId === expectation.workspaceId &&
        active.latestSnapshot.generation === expectation.generation
      ) {
        return { ok: true, value: active.latestSnapshot };
      }
      return result;
    } finally {
      if (timeout) clearTimeout(timeout);
      if (active && pending) {
        active.pending.delete(pending);
        if (
          pending.expectation.method === 'search' &&
          pending.expectation.workspaceId === active.workspaceId &&
          pending.expectation.generation === active.generation
        ) {
          active.retiredSearchRequests.retireSettled(pending.expectation, active.pending);
        }
      }
      if (diagnostic && diagnosticMethod) {
        this.diagnostics.emit('xpc-terminal', {
          tag: diagnostic.tag,
          method: diagnosticMethod,
          outcome,
          elapsedMs: this.diagnostics.elapsed(diagnostic.startedAt)
        });
      }
    }
  }

  detach(): void {
    const active = this.active;
    if (!active) return;
    this.active = null;
    active.resolveStopped();
    active.pending.clear();
  }

  bootstrapTokenForHost(hostToken: string): string {
    const active = this.active;
    if (!active) throw runtimeStoppedError();
    if (active.hostToken !== hostToken) {
      throw new OnlyPreviewContractError(
        'HOST_ROLE_DENIED',
        'OnlyPreview search request does not belong to the active file-search runtime.'
      );
    }
    return active.bootstrapToken;
  }

  publish(message: FileSearchRuntimeEventRequest): { ok: true } {
    const active = this.active;
    if (!active) throw runtimeStoppedError();
    if (!this._isRecord(message)) throw indexProtocolError();
    if (message.capability !== active.capability) {
      throw new OnlyPreviewContractError(
        'HOST_ROLE_DENIED',
        'File-search runtime event capability is invalid.'
      );
    }
    if (active.protocolFailure) throw active.protocolFailure;
    if (!this._hasExactKeys(message, ['capability', 'eventName', 'value'])) {
      throw this._latchProtocolFailure(active, 'message-keys');
    }
    if (typeof message.eventName === 'string') this._handleEvent(active, message);
    return { ok: true };
  }

  private _handleEvent(active: ActiveRuntime, message: FileSearchRuntimeEventRequest): void {
    const eventShape = {
      [ONLY_PREVIEW_BROWSE_LISTING_EVENT]: 'listing',
      [ONLY_PREVIEW_SEARCH_BATCH_EVENT]: 'batch',
      [ONLY_PREVIEW_SEARCH_FAILURE_EVENT]: 'failure',
      [ONLY_PREVIEW_SEARCH_PROGRESS_EVENT]: 'progress',
      [ONLY_PREVIEW_SEARCH_SNAPSHOT_EVENT]: 'snapshot',
      [ONLY_PREVIEW_SEARCH_WATCH_COMMIT_EVENT]: 'commit'
    } as const;
    const property = eventShape[message.eventName as keyof typeof eventShape];
    if (!property) return;
    if (!this._isRecord(message.value)) {
      throw this._latchProtocolFailure(active, `${property}:value-not-record`);
    }
    const envelope = message.value;
    if (!this._hasExactKeys(envelope, [property])) {
      throw this._latchProtocolFailure(active, `${property}:envelope-keys`);
    }
    const value = envelope[property];
    if (
      !this._isRecord(value) ||
      active.workspaceId === null ||
      active.generation === null ||
      !this._isBoundedToken(value.workspaceId) ||
      !this._isGeneration(value.generation)
    ) {
      throw this._latchProtocolFailure(active, `${property}:workspace-identity`);
    }
    if (value.workspaceId !== active.workspaceId || value.generation !== active.generation) return;
    if (property === 'batch') {
      const disposition = this._searchBatchDisposition(active, value);
      if (disposition === 'ignore') return;
      if (disposition === 'invalid') throw this._latchProtocolFailure(active, 'batch');
    }
    const progress = property === 'progress' && this._isBuildProgress(value) ? value : null;
    const valid =
      (property === 'snapshot' &&
        this._isSearchSnapshot(value, active.workspaceId, active.generation)) ||
      (property === 'listing' &&
        this._isBrowseListing(value, active.workspaceId, active.generation)) ||
      progress !== null ||
      (property === 'failure' && isOnlyPreviewSearchFailure(value)) ||
      property === 'batch' ||
      (property === 'commit' && this._isWatchCommit(value));
    if (!valid) throw this._latchProtocolFailure(active, `${property}:payload-rule`);
    if (property === 'snapshot') active.latestSnapshot = value;
    if (progress) this._renewProgressingSearches(active, progress);
    active.broadcast(message.eventName, {
      hostId: active.hostId,
      [property]: value
    });
  }

  private _renewProgressingSearches(
    active: ActiveRuntime,
    progress: OnlyPreviewSearchBuildProgress
  ): void {
    const previous = active.buildProgress;
    if (previous) {
      if (progress.buildRevision < previous.buildRevision) return;
      if (progress.buildRevision === previous.buildRevision) {
        if (progress.phase === 'counting') return;
        if (previous.phase === 'indexing' && progress.completed <= previous.completed) return;
      }
    }
    // A late event from the completed build cannot extend a query after its ready snapshot.
    if (
      this._isRecord(active.latestSnapshot) && active.latestSnapshot.state === 'ready' &&
      (!previous || progress.buildRevision <= previous.buildRevision)
    ) return;
    active.buildProgress = progress;
    for (const pending of active.pending) {
      const expected = pending.expectation;
      if (
        expected.method === 'search' &&
        expected.workspaceId === progress.workspaceId &&
        expected.generation === progress.generation &&
        expected.requestId !== null &&
        !active.retiredSearchRequests.find(progress.workspaceId, progress.generation, expected.requestId)
      ) pending.renewSearchTimeout?.();
    }
  }

  private _createPendingExpectation(
    method: FileSearchRuntimeMethod,
    params: unknown
  ): PendingExpectation {
    const record = this._isRecord(params) ? params : {};
    return {
      method,
      workspaceId: this._isBoundedToken(record.workspaceId) ? record.workspaceId : null,
      generation: this._isGeneration(record.generation) ? record.generation : null,
      requestId: this._isBoundedToken(record.requestId) ? record.requestId : null,
      directoryToken: this._isBoundedToken(record.directoryToken) ? record.directoryToken : null,
      resultToken: this._isBoundedToken(record.resultToken) ? record.resultToken : null,
      readGrant: this._isBoundedToken(record.readGrant) ? record.readGrant : null,
      offset:
        Number.isSafeInteger(record.offset) && (record.offset as number) >= 0
          ? (record.offset as number)
          : null,
      maxResults:
        Number.isSafeInteger(record.maxResults) &&
        (record.maxResults as number) >= 0 &&
        (record.maxResults as number) <= ONLY_PREVIEW_SEARCH_MAX_RESULTS
          ? (record.maxResults as number)
          : null
    };
  }

  private _isResponseResult(value: unknown, expectation: PendingExpectation): boolean {
    if (!this._isRecord(value)) return false;
    if (value.ok === false) return this._isFailureResult(value);
    if (value.ok !== true || !this._hasExactKeys(value, ['ok', 'value'])) return false;
    if (
      expectation.method === 'prioritizeFile' ||
      expectation.method === 'cancel' ||
      expectation.method === 'cancelOfficeRead' ||
      expectation.method === 'shutdown'
    ) {
      return value.value === undefined;
    }
    if (expectation.workspaceId === null || expectation.generation === null) return false;
    if (expectation.method === 'initialize' || expectation.method === 'refresh') {
      return this._isSearchSnapshot(value.value, expectation.workspaceId, expectation.generation);
    }
    if (expectation.method === 'browseDirectory') {
      return (
        expectation.directoryToken !== null &&
        this._isBrowseListing(
          value.value,
          expectation.workspaceId,
          expectation.generation,
          expectation.directoryToken
        )
      );
    }
    if (expectation.method === 'preview') {
      return (
        expectation.resultToken !== null &&
        isOnlyPreviewGlobalSearchPreview(value.value, expectation)
      );
    }
    if (expectation.method === 'openOfficeRead') {
      return (
        expectation.resultToken !== null &&
        expectation.readGrant !== null &&
        isOnlyPreviewGlobalSearchOfficeReadOpenResult(value.value, expectation)
      );
    }
    if (expectation.method === 'readOfficeChunk') {
      return (
        expectation.resultToken !== null &&
        expectation.readGrant !== null &&
        expectation.offset !== null &&
        isOnlyPreviewGlobalSearchOfficeReadChunkResult(value.value, expectation)
      );
    }
    return (
      expectation.requestId !== null &&
      expectation.maxResults !== null &&
      this._isSearchResponse(value.value, expectation)
    );
  }

  private _isFailureResult(value: Record<string, unknown>): boolean {
    return this._hasExactKeys(value, ['error', 'ok']) && isOnlyPreviewSearchErrorPayload(value.error);
  }

  private _isSearchResponse(value: unknown, expectation: PendingExpectation): boolean {
    return isOnlyPreviewGlobalSearchResponse(value, expectation);
  }

  private _searchBatchDisposition(
    active: ActiveRuntime,
    value: Record<string, unknown>
  ): 'broadcast' | 'ignore' | 'invalid' {
    if (!this._isBoundedToken(value.requestId)) return 'invalid';
    const retiredSearch = active.retiredSearchRequests.find(
      value.workspaceId as string,
      value.generation as number,
      value.requestId
    );
    if (retiredSearch) {
      const retiredCap = Math.min(
        ONLY_PREVIEW_SEARCH_MAX_BATCH_RESULTS,
        retiredSearch.maxResults
      );
      if (isOnlyPreviewGlobalSearchBatch(value, retiredSearch, retiredCap)) return 'ignore';
      this.lastBatchRejection = describeOnlyPreviewGlobalSearchBatchRejection(
        value,
        retiredSearch,
        retiredCap
      );
      return 'invalid';
    }
    const matchingSearch = active.retiredSearchRequests.findPending(
      active.pending,
      value.workspaceId as string,
      value.generation as number,
      value.requestId
    );
    if (!matchingSearch) {
      this.lastBatchRejection = 'no-matching-pending-search';
      return 'invalid';
    }
    // `?? 0` here used to mean "a search that never recorded its cap rejects every non-empty batch
    // and latches the runtime" — a missing number silently became the strictest possible bound. The
    // retired branch above never had it. Fall back to the wire's own cap instead: an unknown
    // per-search cap is not evidence that zero results are allowed.
    const cap = Math.min(
      ONLY_PREVIEW_SEARCH_MAX_BATCH_RESULTS,
      matchingSearch.maxResults ?? ONLY_PREVIEW_SEARCH_MAX_BATCH_RESULTS
    );
    if (isOnlyPreviewGlobalSearchBatch(value, matchingSearch, cap)) return 'broadcast';
    this.lastBatchRejection = describeOnlyPreviewGlobalSearchBatchRejection(
      value,
      matchingSearch,
      cap
    );
    return 'invalid';
  }

  private _latchProtocolFailure(
    active: ActiveRuntime,
    rule = 'unspecified'
  ): OnlyPreviewContractError {
    if (active.protocolFailure) return active.protocolFailure;
    // The one line that makes this diagnosable. Everything after the first rejection is an echo of
    // it — `publish` rethrows the latched error — so the reason is only worth recording here, once.
    // Rule names, indexes and lengths only: no path, no name, no snippet text, so it is safe to log
    // and cannot carry a path separator into the failure wire.
    //
    // `rule` 是 2026-09-22 补的。在那之前这里只写 `non-batch-event`,把七个互不相干的拒绝点
    // 压成同一个词 —— 09-21 那次 latch 因此完全无法定位:看不出是快照、进度、目录列表还是
    // watch commit,也看不出挂在形状校验还是内容校验上。而 latch 是粘性的,一次拒绝就让整个
    // 会话的搜索永久失效,所以"下次能不能查出来"全押在这一行上。
    console.info(
      `[onlypreview-search] event=protocol-latched rule=${rule} ` +
        `reason=${this.lastBatchRejection ?? 'non-batch-event'}`
    );
    this.lastBatchRejection = null;
    const error = indexProtocolError();
    active.protocolFailure = error;
    active.resolveProtocolFailure(error);
    // 先把 latch 落定再通知:处理函数多半会去停运行时,而停运行时会绕回这里。
    // 通知失败不能反过来毁掉 latch —— 那会让一个坏运行时继续被当成好的。
    try {
      active.onProtocolFailure?.(rule);
    } catch {
      // 恢复是尽力而为;latch 本身已经生效,搜索照样是安全地关着的。
    }
    return error;
  }

  private _isSearchResultArray(value: unknown, maxLength: number): boolean {
    if (!this._isDenseArray(value, maxLength)) return false;
    const seen = new Set<string>();
    return value.every((result) => {
      if (!this._isSearchResult(result) || seen.has(result.relativePath)) return false;
      seen.add(result.relativePath);
      return true;
    });
  }

  private _isSearchResult(value: unknown): value is Record<string, unknown> & {
    relativePath: string;
  } {
    if (
      !this._isRecord(value) ||
      !this._hasExactKeys(value, ['contentMatch', 'fileName', 'mediaType', 'relativePath']) ||
      !this._isNormalizedRelativePath(value.relativePath) ||
      typeof value.fileName !== 'string' ||
      value.fileName !== value.relativePath.slice(value.relativePath.lastIndexOf('/') + 1) ||
      typeof value.mediaType !== 'string' ||
      !SEARCH_MEDIA_TYPES.has(value.mediaType)
    ) {
      return false;
    }
    return (
      value.contentMatch === null ||
      (value.mediaType === 'text' && this._isSearchContentMatch(value.contentMatch))
    );
  }

  private _isSearchContentMatch(value: unknown): boolean {
    if (
      !this._isRecord(value) ||
      !this._hasExactKeys(value, ['highlightLength', 'highlightStart', 'snippetText']) ||
      typeof value.snippetText !== 'string' ||
      value.snippetText.length > MAX_SEARCH_SNIPPET_CODE_UNITS ||
      !Number.isSafeInteger(value.highlightStart) ||
      (value.highlightStart as number) < 0 ||
      !Number.isSafeInteger(value.highlightLength) ||
      (value.highlightLength as number) < 1
    ) {
      return false;
    }
    const graphemeCount = [...searchSnippetSegmenter.segment(value.snippetText)].length;
    return (value.highlightStart as number) + (value.highlightLength as number) <= graphemeCount;
  }

  private _isBuildProgress(
    value: Record<string, unknown>
  ): value is Record<string, unknown> & OnlyPreviewSearchBuildProgress {
    const commonValid =
      Number.isSafeInteger(value.buildRevision) && (value.buildRevision as number) > 0;
    if (!commonValid) return false;
    if (value.phase === 'counting') {
      return this._hasExactKeys(value, ['buildRevision', 'generation', 'phase', 'workspaceId']);
    }
    return (
      value.phase === 'indexing' &&
      this._hasExactKeys(value, [
        'buildRevision',
        'completed',
        'generation',
        'phase',
        'total',
        'workspaceId'
      ]) &&
      Number.isSafeInteger(value.completed) &&
      Number.isSafeInteger(value.total) &&
      (value.completed as number) >= 0 &&
      (value.total as number) >= 0 &&
      (value.completed as number) <= (value.total as number)
    );
  }

  private _isBrowseListing(
    value: unknown,
    workspaceId: string,
    generation: number,
    expectedDirectoryToken?: string
  ): boolean {
    if (
      !this._isRecord(value) ||
      !this._hasExactKeys(value, [
        'directoryToken',
        'entries',
        'generation',
        'relativePath',
        'workspaceId'
      ]) ||
      value.workspaceId !== workspaceId ||
      value.generation !== generation ||
      !this._isBoundedToken(value.directoryToken) ||
      (expectedDirectoryToken !== undefined && value.directoryToken !== expectedDirectoryToken) ||
      !this._isDenseArray(value.entries)
    ) {
      return false;
    }
    if (!this._isNormalizedRelativePath(value.relativePath, true)) return false;
    const listingPath = value.relativePath;
    const seen = new Set<string>();
    const directoryTokens = new Set<string>([value.directoryToken]);
    return value.entries.every((entry) => {
      if (!this._isIndexEntry(entry, true)) return false;
      const candidate = entry;
      if (candidate.parentRelativePath !== listingPath || seen.has(candidate.relativePath)) {
        return false;
      }
      seen.add(candidate.relativePath);
      if (candidate.nodeKind === 'directory') {
        if (!this._isBoundedToken(candidate.directoryToken)) return false;
        if (directoryTokens.has(candidate.directoryToken)) return false;
        directoryTokens.add(candidate.directoryToken);
        return true;
      }
      return candidate.directoryToken === null;
    });
  }

  private _isSearchSnapshot(value: unknown, workspaceId: string, generation: number): boolean {
    if (
      !this._isRecord(value) ||
      !this._hasExactKeys(value, ['generation', 'index', 'memory', 'state', 'workspaceId']) ||
      value.workspaceId !== workspaceId ||
      value.generation !== generation ||
      typeof value.state !== 'string' ||
      !INDEX_STATES.has(value.state) ||
      !this._isIndexSnapshot(value.index, workspaceId)
    ) {
      return false;
    }
    return this._isSearchMemory(value.memory);
  }

  private _isIndexSnapshot(value: unknown, workspaceId: string): boolean {
    if (
      !this._isRecord(value) ||
      !this._hasExactKeys(value, ['entries', 'limit', 'truncated', 'workspaceId']) ||
      value.workspaceId !== workspaceId ||
      typeof value.truncated !== 'boolean' ||
      !Number.isSafeInteger(value.limit) ||
      (value.limit as number) < 0 ||
      !this._isDenseArray(value.entries, value.limit as number)
    ) {
      return false;
    }
    const seen = new Set<string>();
    return value.entries.every((entry) => {
      if (!this._isIndexEntry(entry) || seen.has(entry.relativePath)) return false;
      seen.add(entry.relativePath);
      return true;
    });
  }

  private _isSearchMemory(value: unknown): boolean {
    if (
      !this._isRecord(value) ||
      !this._hasExactKeys(value, [
        'diskIndexBytes',
        'filenameTierEstimatedBytes',
        'measurementComplete',
        'processRssBytes',
        'runtimeOneGiBWarning',
        'runtimeTwoGiBLimitExceeded',
        'treeMetadataEntryCount',
        'treeMetadataEstimatedBytes',
        'workerExternalBytes',
        'workerHeapUsedBytes'
      ]) ||
      typeof value.measurementComplete !== 'boolean' ||
      typeof value.runtimeOneGiBWarning !== 'boolean' ||
      typeof value.runtimeTwoGiBLimitExceeded !== 'boolean'
    ) {
      return false;
    }
    return MEMORY_NUMBER_KEYS.every(
      (key) =>
        value[key] === null ||
        (typeof value[key] === 'number' && Number.isFinite(value[key]) && value[key] >= 0)
    );
  }

  private _isWatchCommit(value: Record<string, unknown>): boolean {
    if (
      !this._hasExactKeys(value, [
        'changedRelativePaths',
        'full',
        'generation',
        'revision',
        'workspaceId'
      ]) ||
      !Number.isSafeInteger(value.revision) ||
      (value.revision as number) < 1 ||
      typeof value.full !== 'boolean' ||
      !this._isDenseArray(value.changedRelativePaths, ONLY_PREVIEW_SEARCH_MAX_WATCH_PATHS) ||
      (value.full && value.changedRelativePaths.length !== 0)
    ) {
      return false;
    }
    const seen = new Set<string>();
    return value.changedRelativePaths.every((relativePath) => {
      if (!this._isNormalizedRelativePath(relativePath) || seen.has(relativePath)) return false;
      seen.add(relativePath);
      return true;
    });
  }

  private _isIndexEntry(
    value: unknown,
    withDirectoryToken = false
  ): value is Record<string, unknown> & {
    relativePath: string;
    parentRelativePath: string;
    name: string;
  } {
    if (!this._isRecord(value)) return false;
    const keys = [
      ...(withDirectoryToken ? ['directoryToken', 'searchExcluded'] : []),
      'isText',
      'mediaType',
      'modifiedAt',
      'name',
      'nodeKind',
      'parentRelativePath',
      'previewHint',
      'relativePath',
      'size'
    ];
    if (
      !this._hasExactKeys(value, keys) ||
      !this._isNormalizedRelativePath(value.relativePath) ||
      !this._isNormalizedRelativePath(value.parentRelativePath, true) ||
      typeof value.name !== 'string' ||
      typeof value.nodeKind !== 'string' ||
      !NODE_KINDS.has(value.nodeKind) ||
      !Number.isSafeInteger(value.size) ||
      (value.size as number) < 0 ||
      !Number.isSafeInteger(value.modifiedAt) ||
      (value.modifiedAt as number) < 0 ||
      typeof value.previewHint !== 'string' ||
      !PREVIEW_HINTS.has(value.previewHint) ||
      typeof value.mediaType !== 'string' ||
      !SEARCH_MEDIA_TYPES.has(value.mediaType) ||
      typeof value.isText !== 'boolean' ||
      (withDirectoryToken && typeof value.searchExcluded !== 'boolean')
    ) {
      return false;
    }
    const separator = value.relativePath.lastIndexOf('/');
    const expectedParent = separator < 0 ? '' : value.relativePath.slice(0, separator);
    const expectedName = value.relativePath.slice(separator + 1);
    if (value.parentRelativePath !== expectedParent || value.name !== expectedName) return false;
    if (value.nodeKind !== 'file') {
      return (
        value.size === 0 &&
        value.previewHint === 'unsupported' &&
        value.mediaType === 'unknown' &&
        value.isText === false &&
        (!withDirectoryToken || value.nodeKind !== 'symlink' || value.searchExcluded === false)
      );
    }
    const expectedMediaType =
      value.previewHint === 'text' ||
      value.previewHint === 'pdf' ||
      value.previewHint === 'image' ||
      value.previewHint === 'audio' ||
      value.previewHint === 'video'
        ? value.previewHint
        : 'unknown';
    return value.mediaType === expectedMediaType && value.isText === (value.mediaType === 'text');
  }

  private _isBoundedToken(value: unknown): value is string {
    return (
      typeof value === 'string' && value.length >= 1 && value.length <= 256 && !value.includes('\0')
    );
  }

  private _hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
    const keys = Reflect.ownKeys(value);
    return (
      keys.length === expected.length &&
      keys.every((key) => typeof key === 'string' && expected.includes(key))
    );
  }

  private _isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  private _isGeneration(value: unknown): value is number {
    return Number.isSafeInteger(value) && (value as number) >= 0;
  }

  private _isNormalizedRelativePath(value: unknown, allowEmpty = false): value is string {
    try {
      return normalizeOnlyPreviewRelativePath(value, { allowEmpty }) === value;
    } catch {
      return false;
    }
  }

  private _isDenseArray(value: unknown, maxLength = Number.MAX_SAFE_INTEGER): value is unknown[] {
    if (!Array.isArray(value) || value.length > maxLength) return false;
    const keys = Reflect.ownKeys(value);
    return (
      keys.length === value.length + 1 &&
      keys.every((key) => {
        if (key === 'length') return true;
        if (typeof key !== 'string') return false;
        const index = Number(key);
        return (
          Number.isSafeInteger(index) && index >= 0 && index < value.length && String(index) === key
        );
      })
    );
  }
}

export const fileSearchRuntimeRelayService = new FileSearchRuntimeRelayService();
