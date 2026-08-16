import { app } from 'electron';
import { XpcMainHandler } from 'electron-xpc/main';
import {
  OnlyPreviewContractError,
  onlyPreviewFailure
} from '@shared/onlypreview/onlyPreview.contract';
import type { OnlyPreviewResult } from '@shared/onlypreview/onlyPreview.types';
import type { OnlyPreviewSearchBootstrap } from '@shared/onlypreview/onlyPreviewSearchBootstrap.types';
import type {
  OnlyPreviewBrowseDirectoryRequest,
  OnlyPreviewBrowseListing,
  OnlyPreviewSearchCancelRequest,
  OnlyPreviewSearchInitializeRequest,
  OnlyPreviewSearchRequest,
  OnlyPreviewSearchResponse,
  OnlyPreviewSearchRuntimeApi,
  OnlyPreviewSearchShutdownRequest,
  OnlyPreviewSearchSnapshot
} from '@shared/onlypreview/onlyPreviewSearch.type';
import { fileSearchRuntimeRelayService } from '@main/fileSearch/fileSearchRuntimeRelay.service';
import { onlyPreviewSearchBootstrapRegistry } from '@main/onlypreview/onlyPreviewSearchBootstrap.registry';

const CONTROL_TIMEOUT_MS = 10 * 60_000;
const SEARCH_TIMEOUT_MS = 60_000;
const CANCEL_TIMEOUT_MS = 5_000;

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
    const hostToken = params?.hostToken ?? '';
    try {
      const searchToken = fileSearchRuntimeRelayService.bootstrapTokenForHost(hostToken);
      const bootstrap = onlyPreviewSearchBootstrapRegistry.resolve(
        searchToken,
        params?.workspaceId,
        app.getPath('userData')
      );
      return await this._call(hostToken, 'initialize', params, CONTROL_TIMEOUT_MS, bootstrap);
    } catch (error) {
      return failedRuntimeResult(error);
    }
  }

  async refresh(
    params: OnlyPreviewSearchInitializeRequest
  ): Promise<OnlyPreviewResult<OnlyPreviewSearchSnapshot>> {
    return await this._call(params?.hostToken ?? '', 'refresh', params, CONTROL_TIMEOUT_MS);
  }

  async browseDirectory(
    params: OnlyPreviewBrowseDirectoryRequest
  ): Promise<OnlyPreviewResult<OnlyPreviewBrowseListing>> {
    return await this._call(params?.hostToken ?? '', 'browseDirectory', params, CONTROL_TIMEOUT_MS);
  }

  async search(
    params: OnlyPreviewSearchRequest
  ): Promise<OnlyPreviewResult<OnlyPreviewSearchResponse>> {
    return await this._call(params?.hostToken ?? '', 'search', params, SEARCH_TIMEOUT_MS);
  }

  async cancel(params: OnlyPreviewSearchCancelRequest): Promise<OnlyPreviewResult<void>> {
    return await this._call(params?.hostToken ?? '', 'cancel', params, CANCEL_TIMEOUT_MS);
  }

  async shutdown(params: OnlyPreviewSearchShutdownRequest): Promise<OnlyPreviewResult<void>> {
    return await this._call(params?.hostToken ?? '', 'shutdown', params, CONTROL_TIMEOUT_MS);
  }

  private async _call<T>(
    hostToken: string,
    method: 'initialize' | 'refresh' | 'browseDirectory' | 'search' | 'cancel' | 'shutdown',
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
