import type { OnlyPreviewIndex, OnlyPreviewResult } from './onlyPreview.types';

export const ONLY_PREVIEW_SEARCH_MAX_RESULTS = 500;
export const ONLY_PREVIEW_SEARCH_MAX_BATCH_RESULTS = 50;
export const ONLY_PREVIEW_SEARCH_MAX_BATCH_DELAY_MS = 16;
export const ONLY_PREVIEW_SEARCH_SNAPSHOT_EVENT = 'onlypreview/search-snapshot' as const;
export const ONLY_PREVIEW_SEARCH_BATCH_EVENT = 'onlypreview/search-batch' as const;
export const ONLY_PREVIEW_SEARCH_WATCH_COMMIT_EVENT = 'onlypreview/search-watch-commit' as const;
export const ONLY_PREVIEW_SEARCH_MAX_WATCH_PATHS = 512;

export type OnlyPreviewSearchMediaType = 'text' | 'image' | 'audio' | 'video' | 'pdf' | 'unknown';

export type OnlyPreviewSearchIndexState = 'building' | 'reconciling' | 'ready';

export interface OnlyPreviewSearchContentMatch {
  snippetText: string;
  highlightStart: number;
  highlightLength: number;
}

export interface OnlyPreviewSearchResult {
  fileName: string;
  relativePath: string;
  mediaType: OnlyPreviewSearchMediaType;
  contentMatch: OnlyPreviewSearchContentMatch | null;
}

export interface OnlyPreviewSearchMemory {
  measurementComplete: boolean;
  processRssBytes: number | null;
  workerHeapUsedBytes: number | null;
  workerExternalBytes: number | null;
  treeMetadataEntryCount: number | null;
  treeMetadataEstimatedBytes: number | null;
  filenameTierEstimatedBytes: number | null;
  diskIndexBytes: number | null;
  runtimeOneGiBWarning: boolean;
  runtimeTwoGiBLimitExceeded: boolean;
}

export interface OnlyPreviewSearchSnapshot {
  workspaceId: string;
  generation: number;
  state: OnlyPreviewSearchIndexState;
  index: OnlyPreviewIndex;
  memory: OnlyPreviewSearchMemory;
}

export interface OnlyPreviewSearchSnapshotEvent {
  hostId: string;
  snapshot: OnlyPreviewSearchSnapshot;
}

export interface OnlyPreviewSearchInitializeRequest {
  hostToken: string;
  workspaceId: string;
  generation: number;
}

export type OnlyPreviewSearchRefreshRequest = OnlyPreviewSearchInitializeRequest;

export type OnlyPreviewSearchScope =
  | { kind: 'project' }
  | { kind: 'directory'; relativePath: string };

export interface OnlyPreviewSearchRequest {
  hostToken: string;
  workspaceId: string;
  generation: number;
  requestId: string;
  query: string;
  maxResults: number;
  scope: OnlyPreviewSearchScope;
}

export interface OnlyPreviewSearchResponse {
  workspaceId: string;
  generation: number;
  requestId: string;
  results: OnlyPreviewSearchResult[];
  truncated: boolean;
}

export interface OnlyPreviewSearchBatch {
  workspaceId: string;
  generation: number;
  requestId: string;
  results: OnlyPreviewSearchResult[];
}

export interface OnlyPreviewSearchBatchEvent {
  hostId: string;
  batch: OnlyPreviewSearchBatch;
}

export interface OnlyPreviewSearchWatchCommit {
  workspaceId: string;
  generation: number;
  revision: number;
  full: boolean;
  changedRelativePaths: string[];
}

export interface OnlyPreviewSearchWatchCommitEvent {
  hostId: string;
  commit: OnlyPreviewSearchWatchCommit;
}

export interface OnlyPreviewSearchCancelRequest {
  hostToken: string;
  requestId: string;
}

export interface OnlyPreviewSearchShutdownRequest {
  hostToken: string;
}

export interface OnlyPreviewSearchRuntimeHandler {
  initialize(
    params: OnlyPreviewSearchInitializeRequest
  ): Promise<OnlyPreviewResult<OnlyPreviewSearchSnapshot>>;
  refresh(
    params: OnlyPreviewSearchRefreshRequest
  ): Promise<OnlyPreviewResult<OnlyPreviewSearchSnapshot>>;
  search(params: OnlyPreviewSearchRequest): Promise<OnlyPreviewResult<OnlyPreviewSearchResponse>>;
  cancel(params: OnlyPreviewSearchCancelRequest): Promise<OnlyPreviewResult<void>>;
  shutdown(params: OnlyPreviewSearchShutdownRequest): Promise<OnlyPreviewResult<void>>;
}

export type OnlyPreviewSearchRuntimeApi = OnlyPreviewSearchRuntimeHandler;
