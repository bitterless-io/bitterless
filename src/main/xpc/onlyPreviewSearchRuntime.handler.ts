import { app } from 'electron';
import { XpcMainHandler } from 'electron-xpc/main';
import {
  OnlyPreviewContractError,
  onlyPreviewFailure
} from '@shared/onlypreview/onlyPreview.contract';
import type { OnlyPreviewResult } from '@shared/onlypreview/onlyPreview.types';
import type { OnlyPreviewSearchBootstrap } from '@shared/onlypreview/onlyPreviewSearchBootstrap.types';
import type {
  OnlyPreviewSearchCancelRequest,
  OnlyPreviewSearchInitializeRequest,
  OnlyPreviewSearchRequest,
  OnlyPreviewSearchResponse,
  OnlyPreviewSearchRuntimeApi,
  OnlyPreviewSearchShutdownRequest,
  OnlyPreviewSearchSnapshot
} from '@shared/onlypreview/onlyPreviewSearch.type';
import { onlyPreviewSearchUtilityRpcService } from '@main/onlypreview/onlyPreviewSearchUtilityRpc.service';
import { onlyPreviewSearchBootstrapRegistry } from '@main/onlypreview/onlyPreviewSearchBootstrap.registry';

const CONTROL_TIMEOUT_MS = 10 * 60_000;
const SEARCH_TIMEOUT_MS = 60_000;
const CANCEL_TIMEOUT_MS = 5_000;

const failedUtilityResult = (error: unknown): OnlyPreviewResult<never> =>
  onlyPreviewFailure(
    error instanceof OnlyPreviewContractError
      ? error
      : new OnlyPreviewContractError(
          'OPERATION_FAILED',
          error instanceof Error ? error.message : 'OnlyPreview search utility failed.'
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
      const searchToken = onlyPreviewSearchUtilityRpcService.searchTokenForHost(hostToken);
      const bootstrap = onlyPreviewSearchBootstrapRegistry.resolve(
        searchToken,
        params?.workspaceId,
        app.getPath('userData')
      );
      return await this._call(hostToken, 'initialize', params, CONTROL_TIMEOUT_MS, bootstrap);
    } catch (error) {
      return failedUtilityResult(error);
    }
  }

  async refresh(
    params: OnlyPreviewSearchInitializeRequest
  ): Promise<OnlyPreviewResult<OnlyPreviewSearchSnapshot>> {
    return await this._call(params?.hostToken ?? '', 'refresh', params, CONTROL_TIMEOUT_MS);
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
    method: 'initialize' | 'refresh' | 'search' | 'cancel' | 'shutdown',
    params: unknown,
    timeoutMs: number,
    bootstrap?: OnlyPreviewSearchBootstrap
  ): Promise<OnlyPreviewResult<T>> {
    try {
      return (await onlyPreviewSearchUtilityRpcService.call(
        hostToken,
        method,
        params,
        timeoutMs,
        bootstrap
      )) as OnlyPreviewResult<T>;
    } catch (error) {
      return failedUtilityResult(error);
    }
  }
}

export const onlyPreviewSearchRuntimeHandler = new OnlyPreviewSearchRuntimeHandler();
