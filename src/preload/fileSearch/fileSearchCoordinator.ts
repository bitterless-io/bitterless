import type {
  OnlyPreviewBrowseDirectoryRequest,
  OnlyPreviewBrowseListing,
  OnlyPreviewSearchBuildProgress,
  OnlyPreviewSearchResponse,
  OnlyPreviewSearchResult,
  OnlyPreviewSearchScope,
  OnlyPreviewSearchSnapshot,
  OnlyPreviewSearchWatchCommit
} from '@shared/onlypreview/onlyPreviewSearch.type';
import { createOnlyPreviewSearchEngine } from '@preload/onlypreview/search/core/search-engine.mjs';
import { createSearchResultBatcher } from '@preload/onlypreview/search/core/result-batcher.mjs';
import { createLatestSingleFlight } from '@preload/onlypreview/search/core/single-flight.mjs';

interface SearchValue {
  workspaceId: string;
  generation: number;
  requestId: string;
  query: string;
  maxResults: number;
  scope: OnlyPreviewSearchScope;
}

interface SearchControl {
  cancelled: boolean;
}

export interface OnlyPreviewSearchCoordinator {
  initialize(params: {
    workspaceId: string;
    generation: number;
    rootPath: string;
    databasePath: string;
  }): Promise<OnlyPreviewSearchSnapshot>;
  refresh(params: { workspaceId: string; generation: number }): Promise<OnlyPreviewSearchSnapshot>;
  browseDirectory(params: OnlyPreviewBrowseDirectoryRequest): Promise<OnlyPreviewBrowseListing>;
  search(params: SearchValue): Promise<OnlyPreviewSearchResponse>;
  cancel(params: { requestId: string }): Promise<void>;
  hasActiveSearchIndex(params: { workspaceId: string; generation: number }): boolean;
  shutdown(): Promise<void>;
}

export interface CreateOnlyPreviewSearchCoordinatorOptions {
  onBrowseListing?(listing: OnlyPreviewBrowseListing): void;
  onProgress?(progress: OnlyPreviewSearchBuildProgress): void;
  onSnapshot?(snapshot: OnlyPreviewSearchSnapshot): void;
  onSearchBatch?(batch: {
    workspaceId: string;
    generation: number;
    requestId: string;
    results: OnlyPreviewSearchResult[];
  }): void;
  onWatchCommit?(commit: OnlyPreviewSearchWatchCommit): void;
}

export const createFileSearchCoordinator = (
  options: CreateOnlyPreviewSearchCoordinatorOptions
): OnlyPreviewSearchCoordinator => {
  const engine = createOnlyPreviewSearchEngine({
    onBrowseListing: options.onBrowseListing,
    onProgress: options.onProgress,
    onSnapshot: options.onSnapshot,
    onWatchCommit: options.onWatchCommit
  });
  let shuttingDown = false;

  const searchScheduler = createLatestSingleFlight({
    createControl: (): SearchControl => ({ cancelled: false }),
    execute: async (value: SearchValue, control: SearchControl) => {
      const batcher = createSearchResultBatcher({
        onBatch: (results: OnlyPreviewSearchResult[]) => {
          options.onSearchBatch?.({
            workspaceId: value.workspaceId,
            generation: value.generation,
            requestId: value.requestId,
            results
          });
        }
      });
      try {
        const response = await engine.search({
          ...value,
          isCancelled: () => control.cancelled,
          onResult: batcher.push
        });
        batcher.finish();
        return response;
      } catch (error) {
        batcher.cancel();
        throw error;
      }
    },
    cancelExecution: (_value: SearchValue, control: SearchControl) => {
      control.cancelled = true;
    }
  });

  return {
    initialize: async (value) => await engine.initialize(value),
    refresh: async (value) => await engine.refresh(value),
    browseDirectory: async (value) => await engine.browseDirectory(value),
    search: async (value) => {
      if (shuttingDown) throw new Error('OnlyPreview file-search runtime is closing.');
      return (await searchScheduler.submit(value)) as OnlyPreviewSearchResponse;
    },
    cancel: async (value) => {
      searchScheduler.cancelWhere((request: SearchValue) => request.requestId === value.requestId);
    },
    hasActiveSearchIndex: (value) => engine.hasActiveSearchIndex(value),
    shutdown: async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      await searchScheduler.close();
      await engine.shutdown();
    }
  };
};
