import type { OnlyPreviewResult } from './onlyPreview.types';
import type { OnlyPreviewSearchBootstrap } from './onlyPreviewSearchBootstrap.types';
import type {
  OnlyPreviewBrowseDirectoryRequest,
  OnlyPreviewBrowseListing,
  OnlyPreviewGlobalSearchPreview,
  OnlyPreviewGlobalSearchPreviewRequest,
  OnlyPreviewSearchCancelRequest,
  OnlyPreviewSearchInitializeRequest,
  OnlyPreviewSearchPrioritizeFileRequest,
  OnlyPreviewSearchRequest,
  OnlyPreviewSearchResponse,
  OnlyPreviewSearchShutdownRequest,
  OnlyPreviewSearchSnapshot
} from './onlyPreviewSearch.type';

export const fileSearchRuntimeHandlerName = (capability: string): string =>
  `FileSearchRuntime_${capability}`;

export const fileSearchRuntimeEventHandlerName = (capability: string): string =>
  `FileSearchRuntimeEventHandler_${capability}`;

export type FileSearchRuntimeMethod =
  | 'initialize'
  | 'refresh'
  | 'prioritizeFile'
  | 'browseDirectory'
  | 'search'
  | 'preview'
  | 'cancel'
  | 'shutdown';

export interface FileSearchRuntimeReadyRequest {
  capability: string;
  instanceId: string;
}

export type FileSearchRuntimeReadyResult = { ok: true } | { ok: false; error: string };

export interface FileSearchRuntimeInitializeRequest {
  capability: string;
  request: OnlyPreviewSearchInitializeRequest;
  bootstrap: OnlyPreviewSearchBootstrap;
}

export interface FileSearchRuntimeRequest<T> {
  capability: string;
  request: T;
}

export interface FileSearchRuntimeEventRequest {
  capability: string;
  eventName: string;
  value: unknown;
}

export interface FileSearchRuntimePrivateApi {
  ready(params: FileSearchRuntimeReadyRequest): Promise<FileSearchRuntimeReadyResult>;
  initialize(
    params: FileSearchRuntimeInitializeRequest
  ): Promise<OnlyPreviewResult<OnlyPreviewSearchSnapshot>>;
  refresh(
    params: FileSearchRuntimeRequest<OnlyPreviewSearchInitializeRequest>
  ): Promise<OnlyPreviewResult<OnlyPreviewSearchSnapshot>>;
  prioritizeFile(
    params: FileSearchRuntimeRequest<OnlyPreviewSearchPrioritizeFileRequest>
  ): Promise<OnlyPreviewResult<void>>;
  browseDirectory(
    params: FileSearchRuntimeRequest<OnlyPreviewBrowseDirectoryRequest>
  ): Promise<OnlyPreviewResult<OnlyPreviewBrowseListing>>;
  search(
    params: FileSearchRuntimeRequest<OnlyPreviewSearchRequest>
  ): Promise<OnlyPreviewResult<OnlyPreviewSearchResponse>>;
  preview(
    params: FileSearchRuntimeRequest<OnlyPreviewGlobalSearchPreviewRequest>
  ): Promise<OnlyPreviewResult<OnlyPreviewGlobalSearchPreview>>;
  cancel(
    params: FileSearchRuntimeRequest<OnlyPreviewSearchCancelRequest>
  ): Promise<OnlyPreviewResult<void>>;
  shutdown(
    params: FileSearchRuntimeRequest<OnlyPreviewSearchShutdownRequest>
  ): Promise<OnlyPreviewResult<void>>;
}

export interface FileSearchRuntimeEventApi {
  publish(params: FileSearchRuntimeEventRequest): Promise<{ ok: true }>;
}
