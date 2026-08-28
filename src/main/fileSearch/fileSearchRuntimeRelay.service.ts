import {
  normalizeOnlyPreviewRelativePath,
  OnlyPreviewContractError
} from '@shared/onlypreview/onlyPreview.contract';
import type { OnlyPreviewSearchBootstrap } from '@shared/onlypreview/onlyPreviewSearchBootstrap.types';
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
  ONLY_PREVIEW_SEARCH_MAX_BATCH_RESULTS,
  ONLY_PREVIEW_SEARCH_MAX_RESULTS,
  ONLY_PREVIEW_SEARCH_MAX_WATCH_PATHS,
  ONLY_PREVIEW_SEARCH_PROGRESS_EVENT,
  ONLY_PREVIEW_SEARCH_SNAPSHOT_EVENT,
  ONLY_PREVIEW_SEARCH_WATCH_COMMIT_EVENT
} from '@shared/onlypreview/onlyPreviewSearch.type';
import {
  isOnlyPreviewGlobalSearchBatch,
  isOnlyPreviewGlobalSearchPreview,
  isOnlyPreviewGlobalSearchResponse
} from './fileSearchGlobalResult.validator';
export type FileSearchRuntimeClient = FileSearchRuntimePrivateApi;

interface PendingCall {
  expectation: PendingExpectation;
}

interface PendingExpectation {
  method: FileSearchRuntimeMethod;
  workspaceId: string | null;
  generation: number | null;
  requestId: string | null;
  directoryToken: string | null;
  resultToken: string | null;
  maxResults: number | null;
}

interface ActiveRuntime {
  hostToken: string;
  hostId: string;
  bootstrapToken: string;
  capability: string;
  client: FileSearchRuntimeClient;
  pending: Set<PendingCall>;
  workspaceId: string | null;
  generation: number | null;
  broadcast(eventName: string, params: unknown): void;
  stopped: Promise<void>;
  resolveStopped(): void;
}

const runtimeStoppedError = (): Error =>
  new Error('OnlyPreview file-search runtime stopped unexpectedly.');

const invalidRuntimeResponseError = (): Error =>
  new OnlyPreviewContractError(
    'PROTOCOL_ERROR',
    'OnlyPreview file-search runtime returned an invalid response.'
  );

const MAX_RUNTIME_ERROR_MESSAGE_CODE_UNITS = 4_096;
const MAX_SEARCH_SNIPPET_CODE_UNITS = 65_536;
const ONLY_PREVIEW_ERROR_CODES = new Set([
  'INVALID_INPUT',
  'HOST_NOT_FOUND',
  'HOST_ROLE_DENIED',
  'WORKSPACE_NOT_FOUND',
  'WORKSPACE_ACCESS_DENIED',
  'PATH_NOT_FOUND',
  'PATH_PERMISSION_DENIED',
  'PATH_OUTSIDE_WORKSPACE',
  'PATH_NOT_REGULAR_FILE',
  'PATH_UNSUPPORTED_DEVICE',
  'TEXT_TOO_LARGE',
  'SIGNATURE_MISMATCH',
  'SETTINGS_INVALID',
  'INDEX_FAILED',
  'OPERATION_FAILED',
  'PROTOCOL_ERROR'
]);
const INDEX_STATES = new Set(['building', 'reconciling', 'ready']);
const NODE_KINDS = new Set(['file', 'directory', 'symlink']);
const PREVIEW_HINTS = new Set(['text', 'pdf', 'image', 'audio', 'video', 'unsupported']);
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
  }): void {
    this.detach();
    let resolveStopped = (): void => undefined;
    const stopped = new Promise<void>((resolve) => {
      resolveStopped = resolve;
    });
    const active: ActiveRuntime = {
      hostToken: params.hostToken,
      hostId: params.hostId,
      bootstrapToken: params.bootstrapToken,
      capability: params.capability,
      client: params.client,
      pending: new Set(),
      workspaceId: null,
      generation: null,
      broadcast: params.broadcast,
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
      const expectation = this._createPendingExpectation(method, params);
      if (method === 'initialize') {
        active.workspaceId = expectation.workspaceId;
        active.generation = expectation.generation;
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
          timeout = setTimeout(
            () => reject(new Error('OnlyPreview file-search runtime request timed out.')),
            timeoutMs
          );
        }),
        active.stopped.then(() => {
          throw runtimeStoppedError();
        })
      ]);
      if (!this._isResponseResult(result, expectation)) throw invalidRuntimeResponseError();
      outcome = 'success';
      return result;
    } finally {
      if (timeout) clearTimeout(timeout);
      if (active && pending) active.pending.delete(pending);
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
    if (
      !this._isRecord(message) ||
      !this._hasExactKeys(message, ['capability', 'eventName', 'value'])
    ) {
      throw invalidRuntimeResponseError();
    }
    if (message.capability !== active.capability) {
      throw new OnlyPreviewContractError(
        'HOST_ROLE_DENIED',
        'File-search runtime event capability is invalid.'
      );
    }
    if (typeof message.eventName === 'string') this._handleEvent(active, message);
    return { ok: true };
  }

  private _handleEvent(active: ActiveRuntime, message: FileSearchRuntimeEventRequest): void {
    const eventShape = {
      [ONLY_PREVIEW_BROWSE_LISTING_EVENT]: 'listing',
      [ONLY_PREVIEW_SEARCH_BATCH_EVENT]: 'batch',
      [ONLY_PREVIEW_SEARCH_PROGRESS_EVENT]: 'progress',
      [ONLY_PREVIEW_SEARCH_SNAPSHOT_EVENT]: 'snapshot',
      [ONLY_PREVIEW_SEARCH_WATCH_COMMIT_EVENT]: 'commit'
    } as const;
    const property = eventShape[message.eventName as keyof typeof eventShape];
    if (!property || !this._isRecord(message.value)) return;
    const envelope = message.value;
    if (!this._hasExactKeys(envelope, [property])) return;
    const value = envelope[property];
    if (
      !this._isRecord(value) ||
      active.workspaceId === null ||
      active.generation === null ||
      !this._isBoundedToken(value.workspaceId) ||
      !this._isGeneration(value.generation) ||
      value.workspaceId !== active.workspaceId ||
      value.generation !== active.generation
    ) {
      return;
    }
    const valid =
      (property === 'snapshot' &&
        this._isSearchSnapshot(value, active.workspaceId, active.generation)) ||
      (property === 'listing' &&
        this._isBrowseListing(value, active.workspaceId, active.generation)) ||
      (property === 'progress' && this._isBuildProgress(value)) ||
      (property === 'batch' && this._isSearchBatch(active, value)) ||
      (property === 'commit' && this._isWatchCommit(value));
    if (!valid) return;
    active.broadcast(message.eventName, {
      hostId: active.hostId,
      [property]: value
    });
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
      return expectation.resultToken !== null && isOnlyPreviewGlobalSearchPreview(value.value);
    }
    return (
      expectation.requestId !== null &&
      expectation.maxResults !== null &&
      this._isSearchResponse(value.value, expectation)
    );
  }

  private _isFailureResult(value: Record<string, unknown>): boolean {
    if (!this._hasExactKeys(value, ['error', 'ok']) || !this._isRecord(value.error)) return false;
    const error = value.error;
    return (
      this._hasExactKeys(error, ['code', 'message']) &&
      typeof error.code === 'string' &&
      ONLY_PREVIEW_ERROR_CODES.has(error.code) &&
      typeof error.message === 'string' &&
      error.message.length >= 1 &&
      error.message.length <= MAX_RUNTIME_ERROR_MESSAGE_CODE_UNITS &&
      !error.message.includes('\0') &&
      !error.message.includes('/') &&
      !error.message.includes('\\')
    );
  }

  private _isSearchResponse(value: unknown, expectation: PendingExpectation): boolean {
    return isOnlyPreviewGlobalSearchResponse(value, expectation);
  }

  private _isSearchBatch(active: ActiveRuntime, value: Record<string, unknown>): boolean {
    if (!this._isBoundedToken(value.requestId)) return false;
    const matchingSearch = [...active.pending.values()].find(
      ({ expectation }) =>
        expectation.method === 'search' &&
        expectation.workspaceId === value.workspaceId &&
        expectation.generation === value.generation &&
        expectation.requestId === value.requestId
    );
    if (!matchingSearch) return false;
    return isOnlyPreviewGlobalSearchBatch(
      value,
      matchingSearch.expectation,
      Math.min(ONLY_PREVIEW_SEARCH_MAX_BATCH_RESULTS, matchingSearch.expectation.maxResults ?? 0)
    );
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

  private _isBuildProgress(value: Record<string, unknown>): boolean {
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
    const expectedMediaType = value.previewHint === 'unsupported' ? 'unknown' : value.previewHint;
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
