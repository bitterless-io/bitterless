import {
  OnlyPreviewContractError,
  onlyPreviewFailure,
  onlyPreviewSuccess
} from '@shared/onlypreview/onlyPreview.contract';
import type { OnlyPreviewResult } from '@shared/onlypreview/onlyPreview.types';
import type { OnlyPreviewSearchBootstrap } from '@shared/onlypreview/onlyPreviewSearchBootstrap.types';
import {
  parseOnlyPreviewSearchCancelRequest,
  parseOnlyPreviewSearchInitializeRequest,
  parseOnlyPreviewSearchRequest,
  parseOnlyPreviewSearchShutdownRequest
} from '@shared/onlypreview/onlyPreviewSearch.contract';
import {
  ONLY_PREVIEW_SEARCH_BATCH_EVENT,
  ONLY_PREVIEW_SEARCH_SNAPSHOT_EVENT,
  ONLY_PREVIEW_SEARCH_WATCH_COMMIT_EVENT,
  type OnlyPreviewSearchCancelRequest,
  type OnlyPreviewSearchInitializeRequest,
  type OnlyPreviewSearchRequest,
  type OnlyPreviewSearchResponse,
  type OnlyPreviewSearchRuntimeApi,
  type OnlyPreviewSearchShutdownRequest,
  type OnlyPreviewSearchSnapshot,
  type OnlyPreviewSearchWatchCommit
} from '@shared/onlypreview/onlyPreviewSearch.type';
import { isOnlyPreviewSearchRuntimeEventCurrent } from '@preload/onlypreview/search/onlyPreviewSearchRuntimeFence.service';
import {
  createOnlyPreviewSearchUtilityCoordinator,
  type OnlyPreviewSearchCoordinator
} from './onlyPreviewSearchCoordinator.utility';

interface OnlyPreviewSearchUtilityRegistration {
  hostToken: string;
  emit(eventName: string, value: unknown): void;
}

interface ActiveRuntime {
  sessionId: number;
  workspaceId: string;
  generation: number;
  coordinator: OnlyPreviewSearchCoordinator;
}

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

export class OnlyPreviewSearchRuntimeUtility implements OnlyPreviewSearchRuntimeApi {
  private active: ActiveRuntime | null = null;
  private sessionId = 0;

  constructor(private readonly registration: OnlyPreviewSearchUtilityRegistration) {}

  async initialize(
    params: OnlyPreviewSearchInitializeRequest,
    internalBootstrap?: OnlyPreviewSearchBootstrap
  ): Promise<OnlyPreviewResult<OnlyPreviewSearchSnapshot>> {
    return await runOperation(async () => {
      const request = parseOnlyPreviewSearchInitializeRequest(params);
      this._requireHost(request.hostToken);
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
        if (this.active === active) this.active = null;
        await coordinator.shutdown().catch(() => undefined);
        throw error;
      }
    });
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

  async search(
    params: OnlyPreviewSearchRequest
  ): Promise<OnlyPreviewResult<OnlyPreviewSearchResponse>> {
    return await runOperation(async () => {
      const request = parseOnlyPreviewSearchRequest(params);
      const active = this._requireActiveRequest(request);
      return await active.coordinator.search(request);
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
    return createOnlyPreviewSearchUtilityCoordinator({
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
    if (hostToken !== this.registration.hostToken) {
      throw new OnlyPreviewContractError(
        'HOST_ROLE_DENIED',
        'OnlyPreview search request does not belong to this utility process.'
      );
    }
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
