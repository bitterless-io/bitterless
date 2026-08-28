import {
  OnlyPreviewContractError,
  onlyPreviewFailure,
  onlyPreviewSuccess
} from '@shared/onlypreview/onlyPreview.contract';
import type { OnlyPreviewResult } from '@shared/onlypreview/onlyPreview.types';
import type { OnlyPreviewSearchBootstrap } from '@shared/onlypreview/onlyPreviewSearchBootstrap.types';
import {
  parseOnlyPreviewBrowseDirectoryRequest,
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
  ONLY_PREVIEW_SEARCH_PROGRESS_EVENT,
  ONLY_PREVIEW_SEARCH_SNAPSHOT_EVENT,
  ONLY_PREVIEW_SEARCH_WATCH_COMMIT_EVENT,
  type OnlyPreviewBrowseDirectoryRequest,
  type OnlyPreviewBrowseListing,
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

interface ActiveRuntime {
  sessionId: number;
  workspaceId: string;
  generation: number;
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
      this._bindHost(request.hostToken);
      const sessionId = ++this.sessionId;
      const bootstrap = requireBootstrap(internalBootstrap, request.workspaceId);
      this._requireCurrentSession(sessionId);
      await this._shutdownActive();
      this._requireCurrentSession(sessionId);
      const coordinator = this._createCoordinator(sessionId);
      const active: ActiveRuntime = {
        sessionId,
        workspaceId: request.workspaceId,
        generation: request.generation,
        coordinator
      };
      this.active = active;
      try {
        const snapshot = await coordinator.initialize({
          workspaceId: bootstrap.workspaceId,
          generation: request.generation,
          rootPath: bootstrap.rootPath,
          databasePath: bootstrap.databasePath
        });
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
      return await active.coordinator.refresh({
        workspaceId: request.workspaceId,
        generation: request.generation
      });
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
    this.sessionId += 1;
    await this._shutdownActive();
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

  private _bindHost(hostToken: string): void {
    if (this.hostToken !== null && this.hostToken !== hostToken) {
      this._requireHost(hostToken);
    }
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
    await active?.coordinator.shutdown().catch(() => undefined);
  }
}
