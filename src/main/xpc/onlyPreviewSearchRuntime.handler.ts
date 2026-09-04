import { app } from 'electron';
import { XpcMainHandler } from 'electron-xpc/main';
import {
  OnlyPreviewContractError,
  onlyPreviewFailure
} from '@shared/onlypreview/onlyPreview.contract';
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
import type { OnlyPreviewResult } from '@shared/onlypreview/onlyPreview.types';
import type { OnlyPreviewSearchBootstrap } from '@shared/onlypreview/onlyPreviewSearchBootstrap.types';
import type {
  OnlyPreviewBrowseDirectoryRequest,
  OnlyPreviewBrowseListing,
  OnlyPreviewGlobalSearchOfficeReadChunkRequest,
  OnlyPreviewGlobalSearchOfficeReadChunkResult,
  OnlyPreviewGlobalSearchOfficeReadOpenResult,
  OnlyPreviewGlobalSearchOfficeReadRequest,
  OnlyPreviewGlobalSearchPreview,
  OnlyPreviewGlobalSearchPreviewRequest,
  OnlyPreviewSearchCancelRequest,
  OnlyPreviewSearchInitializeRequest,
  OnlyPreviewSearchPrioritizeFileRequest,
  OnlyPreviewSearchRequest,
  OnlyPreviewSearchResponse,
  OnlyPreviewSearchRuntimeApi,
  OnlyPreviewSearchShutdownRequest,
  OnlyPreviewSearchSnapshot
} from '@shared/onlypreview/onlyPreviewSearch.type';
import { fileSearchRuntimeRelayService } from '@main/fileSearch/fileSearchRuntimeRelay.service';
import { onlyPreviewHostRegistry } from '@main/onlypreview/onlyPreviewHost.registry';
import { onlyPreviewProjectIndexStateService } from '@main/onlypreview/onlyPreviewProjectIndexState.service';
import { onlyPreviewSearchBootstrapRegistry } from '@main/onlypreview/onlyPreviewSearchBootstrap.registry';

/**
 * Record the index state of a snapshot that is *returned* rather than broadcast.
 *
 * `initialize` and `refresh` hand their snapshot back through the RPC result, so it never passes the
 * relay's `broadcast` callback — the only other place the index state is observed
 * (`onlyPreviewWindow.helper.ts`). A Project whose index is already usable by the time `initialize`
 * answers therefore rendered its whole tree while Main still reported the `building` it set at bind
 * time, and the preview pane sat on "Loading project" for the rest of the session
 * ([`onlypreview-index-never-latches-ready`](../../../docs/issues/onlypreview-index-never-latches-ready.md)).
 *
 * Best effort by design: this is diagnostics-grade bookkeeping about a search call that already
 * succeeded, so it must never turn a good result into a failure.
 */
const observeReturnedSnapshot = (
  hostToken: string,
  result: OnlyPreviewResult<OnlyPreviewSearchSnapshot>
): OnlyPreviewResult<OnlyPreviewSearchSnapshot> => {
  if (!result.ok) return result;
  try {
    const host = onlyPreviewHostRegistry.require(hostToken, ['content']);
    onlyPreviewProjectIndexStateService.markObserved(
      host.hostId,
      result.value.workspaceId,
      result.value.state
    );
  } catch {
    // The search result stands on its own; the index-state trace records the miss.
  }
  return result;
};

const CONTROL_TIMEOUT_MS = 10 * 60_000;
const SEARCH_TIMEOUT_MS = 60_000;
const CANCEL_TIMEOUT_MS = 5_000;
const PRIORITY_TIMEOUT_MS = 60_000;
const PREVIEW_TIMEOUT_MS = 30_000;
const OFFICE_CONTROL_TIMEOUT_MS = 10_000;
const OFFICE_CHUNK_TIMEOUT_MS = 5_000;

const failedRuntimeResult = (error: unknown): OnlyPreviewResult<never> =>
  onlyPreviewFailure(
    error instanceof OnlyPreviewContractError
      ? error
      : new OnlyPreviewContractError(
          'OPERATION_FAILED',
          error instanceof Error ? error.message : 'OnlyPreview file-search runtime failed.'
        )
  );

export class OnlyPreviewSearchRuntimeHandler
  extends XpcMainHandler
  implements OnlyPreviewSearchRuntimeApi
{
  async initialize(
    params: OnlyPreviewSearchInitializeRequest
  ): Promise<OnlyPreviewResult<OnlyPreviewSearchSnapshot>> {
    try {
      const request = parseOnlyPreviewSearchInitializeRequest(params);
      const searchToken = fileSearchRuntimeRelayService.bootstrapTokenForHost(request.hostToken);
      const bootstrap = onlyPreviewSearchBootstrapRegistry.resolve(
        searchToken,
        request.workspaceId,
        app.getPath('userData')
      );
      return observeReturnedSnapshot(
        request.hostToken,
        await this._call(request.hostToken, 'initialize', request, CONTROL_TIMEOUT_MS, bootstrap)
      );
    } catch (error) {
      return failedRuntimeResult(error);
    }
  }

  async refresh(
    params: OnlyPreviewSearchInitializeRequest
  ): Promise<OnlyPreviewResult<OnlyPreviewSearchSnapshot>> {
    try {
      const request = parseOnlyPreviewSearchInitializeRequest(params);
      return observeReturnedSnapshot(
        request.hostToken,
        await this._call(request.hostToken, 'refresh', request, CONTROL_TIMEOUT_MS)
      );
    } catch (error) {
      return failedRuntimeResult(error);
    }
  }

  async prioritizeFile(
    params: OnlyPreviewSearchPrioritizeFileRequest
  ): Promise<OnlyPreviewResult<void>> {
    try {
      const request = parseOnlyPreviewSearchPrioritizeFileRequest(params);
      return await this._call(request.hostToken, 'prioritizeFile', request, PRIORITY_TIMEOUT_MS);
    } catch (error) {
      return failedRuntimeResult(error);
    }
  }

  async browseDirectory(
    params: OnlyPreviewBrowseDirectoryRequest
  ): Promise<OnlyPreviewResult<OnlyPreviewBrowseListing>> {
    try {
      const request = parseOnlyPreviewBrowseDirectoryRequest(params);
      return await this._call(request.hostToken, 'browseDirectory', request, CONTROL_TIMEOUT_MS);
    } catch (error) {
      return failedRuntimeResult(error);
    }
  }

  async search(
    params: OnlyPreviewSearchRequest
  ): Promise<OnlyPreviewResult<OnlyPreviewSearchResponse>> {
    try {
      const request = parseOnlyPreviewSearchRequest(params);
      return await this._call(request.hostToken, 'search', request, SEARCH_TIMEOUT_MS);
    } catch (error) {
      return failedRuntimeResult(error);
    }
  }

  async preview(
    params: OnlyPreviewGlobalSearchPreviewRequest
  ): Promise<OnlyPreviewResult<OnlyPreviewGlobalSearchPreview>> {
    try {
      const request = parseOnlyPreviewGlobalSearchPreviewRequest(params);
      return await this._call(request.hostToken, 'preview', request, PREVIEW_TIMEOUT_MS);
    } catch (error) {
      return failedRuntimeResult(error);
    }
  }

  async openOfficeRead(
    params: OnlyPreviewGlobalSearchOfficeReadRequest
  ): Promise<OnlyPreviewResult<OnlyPreviewGlobalSearchOfficeReadOpenResult>> {
    try {
      const request = parseOnlyPreviewGlobalSearchOfficeReadRequest(params);
      return await this._call(
        request.hostToken,
        'openOfficeRead',
        request,
        OFFICE_CONTROL_TIMEOUT_MS
      );
    } catch (error) {
      return failedRuntimeResult(error);
    }
  }

  async readOfficeChunk(
    params: OnlyPreviewGlobalSearchOfficeReadChunkRequest
  ): Promise<OnlyPreviewResult<OnlyPreviewGlobalSearchOfficeReadChunkResult>> {
    try {
      const request = parseOnlyPreviewGlobalSearchOfficeReadChunkRequest(params);
      return await this._call(
        request.hostToken,
        'readOfficeChunk',
        request,
        OFFICE_CHUNK_TIMEOUT_MS
      );
    } catch (error) {
      return failedRuntimeResult(error);
    }
  }

  async cancelOfficeRead(
    params: OnlyPreviewGlobalSearchOfficeReadRequest
  ): Promise<OnlyPreviewResult<void>> {
    try {
      const request = parseOnlyPreviewGlobalSearchOfficeReadRequest(params);
      return await this._call(
        request.hostToken,
        'cancelOfficeRead',
        request,
        OFFICE_CONTROL_TIMEOUT_MS
      );
    } catch (error) {
      return failedRuntimeResult(error);
    }
  }

  async cancel(params: OnlyPreviewSearchCancelRequest): Promise<OnlyPreviewResult<void>> {
    try {
      const request = parseOnlyPreviewSearchCancelRequest(params);
      return await this._call(request.hostToken, 'cancel', request, CANCEL_TIMEOUT_MS);
    } catch (error) {
      return failedRuntimeResult(error);
    }
  }

  async shutdown(params: OnlyPreviewSearchShutdownRequest): Promise<OnlyPreviewResult<void>> {
    try {
      const request = parseOnlyPreviewSearchShutdownRequest(params);
      return await this._call(request.hostToken, 'shutdown', request, CONTROL_TIMEOUT_MS);
    } catch (error) {
      return failedRuntimeResult(error);
    }
  }

  private async _call<T>(
    hostToken: string,
    method:
      | 'initialize'
      | 'refresh'
      | 'prioritizeFile'
      | 'browseDirectory'
      | 'search'
      | 'preview'
      | 'openOfficeRead'
      | 'readOfficeChunk'
      | 'cancelOfficeRead'
      | 'cancel'
      | 'shutdown',
    params: unknown,
    timeoutMs: number,
    bootstrap?: OnlyPreviewSearchBootstrap
  ): Promise<OnlyPreviewResult<T>> {
    try {
      return (await fileSearchRuntimeRelayService.call(
        hostToken,
        method,
        params,
        timeoutMs,
        bootstrap
      )) as OnlyPreviewResult<T>;
    } catch (error) {
      return failedRuntimeResult(error);
    }
  }
}

export const onlyPreviewSearchRuntimeHandler = new OnlyPreviewSearchRuntimeHandler();
