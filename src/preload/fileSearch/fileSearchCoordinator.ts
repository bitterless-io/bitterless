import type {
  OnlyPreviewBrowseDirectoryRequest,
  OnlyPreviewBrowseListing,
  OnlyPreviewGlobalSearchPreview,
  OnlyPreviewGlobalSearchPreviewRequest,
  OnlyPreviewGlobalSearchResult,
  OnlyPreviewSearchBuildProgress,
  OnlyPreviewSearchPrioritizeFileRequest,
  OnlyPreviewSearchResponse,
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

interface PriorityControl {
  cancelled: boolean;
}

interface PreviewControl {
  cancelled: boolean;
}

interface PriorityValue extends OnlyPreviewSearchPrioritizeFileRequest {
  priorityRevision: number;
  buildEpoch: number;
}

export interface OnlyPreviewSearchCoordinator {
  initialize(params: {
    workspaceId: string;
    generation: number;
    rootPath: string;
    databasePath: string;
  }): Promise<OnlyPreviewSearchSnapshot>;
  refresh(params: { workspaceId: string; generation: number }): Promise<OnlyPreviewSearchSnapshot>;
  prioritizeFile(params: OnlyPreviewSearchPrioritizeFileRequest): Promise<void>;
  browseDirectory(params: OnlyPreviewBrowseDirectoryRequest): Promise<OnlyPreviewBrowseListing>;
  search(params: SearchValue): Promise<OnlyPreviewSearchResponse>;
  preview(params: OnlyPreviewGlobalSearchPreviewRequest): Promise<OnlyPreviewGlobalSearchPreview>;
  cancel(params: { requestId: string }): Promise<void>;
  hasActiveSearchIndex(params: { workspaceId: string; generation: number }): boolean;
  shutdown(): Promise<void>;
}

export interface CreateOnlyPreviewSearchCoordinatorOptions {
  createEngine?: typeof createOnlyPreviewSearchEngine;
  onBrowseListing?(listing: OnlyPreviewBrowseListing): void;
  onProgress?(progress: OnlyPreviewSearchBuildProgress): void;
  onSnapshot?(snapshot: OnlyPreviewSearchSnapshot): void;
  onSearchBatch?(batch: {
    workspaceId: string;
    generation: number;
    requestId: string;
    files: Extract<OnlyPreviewGlobalSearchResult, { section: 'files' }>[];
    contents: Extract<OnlyPreviewGlobalSearchResult, { section: 'contents' }>[];
  }): void;
  onWatchCommit?(commit: OnlyPreviewSearchWatchCommit): void;
}

export const createFileSearchCoordinator = (
  options: CreateOnlyPreviewSearchCoordinatorOptions
): OnlyPreviewSearchCoordinator => {
  const engine = (options.createEngine ?? createOnlyPreviewSearchEngine)({
    onBrowseListing: options.onBrowseListing,
    onProgress: options.onProgress,
    onSnapshot: options.onSnapshot,
    onWatchCommit: options.onWatchCommit
  });
  let shuttingDown = false;
  let latestPriority = Promise.resolve();

  const priorityScheduler = createLatestSingleFlight({
    createControl: (): PriorityControl => ({ cancelled: false }),
    execute: async (value: PriorityValue, control: PriorityControl) => {
      await engine.prioritizeFile({
        ...value,
        isCancelled: () => control.cancelled
      });
    },
    cancelExecution: (_value: PriorityValue, control: PriorityControl) => {
      control.cancelled = true;
    }
  });

  const waitForLatestPriority = async (): Promise<void> => {
    while (true) {
      const pending = latestPriority;
      await pending;
      if (pending === latestPriority) return;
    }
  };

  const previewScheduler = createLatestSingleFlight({
    createControl: (): PreviewControl => ({ cancelled: false }),
    execute: async (value: OnlyPreviewGlobalSearchPreviewRequest, control: PreviewControl) =>
      await engine.preview({ ...value, isCancelled: () => control.cancelled }),
    cancelExecution: (_value: OnlyPreviewGlobalSearchPreviewRequest, control: PreviewControl) => {
      control.cancelled = true;
    }
  });

  const searchScheduler = createLatestSingleFlight({
    createControl: (): SearchControl => ({ cancelled: false }),
    execute: async (value: SearchValue, control: SearchControl) => {
      const batcher = createSearchResultBatcher({
        onBatch: (results: OnlyPreviewGlobalSearchResult[]) => {
          options.onSearchBatch?.({
            workspaceId: value.workspaceId,
            generation: value.generation,
            requestId: value.requestId,
            files: results.filter(
              (result): result is Extract<OnlyPreviewGlobalSearchResult, { section: 'files' }> =>
                result.section === 'files'
            ),
            contents: results.filter(
              (result): result is Extract<OnlyPreviewGlobalSearchResult, { section: 'contents' }> =>
                result.section === 'contents'
            )
          });
        }
      });
      try {
        await waitForLatestPriority();
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
    refresh: async (value) => {
      searchScheduler.cancelWhere(() => true);
      previewScheduler.cancelWhere(() => true);
      return await engine.refresh(value);
    },
    prioritizeFile: async (value) => {
      if (shuttingDown) return;
      const priority = engine.supersedePriority(value);
      if (!priority) return;
      const operation = priorityScheduler.submit(priority);
      latestPriority = operation.catch(() => undefined);
      try {
        await operation;
      } catch (error) {
        if (error?.code !== 'CANCELLED') throw error;
      }
    },
    browseDirectory: async (value) => await engine.browseDirectory(value),
    search: async (value) => {
      if (shuttingDown) throw new Error('OnlyPreview file-search runtime is closing.');
      previewScheduler.cancelWhere(() => true);
      engine.revokeSearch();
      return (await searchScheduler.submit(value)) as OnlyPreviewSearchResponse;
    },
    preview: async (value) => {
      if (shuttingDown) throw new Error('OnlyPreview file-search runtime is closing.');
      return (await previewScheduler.submit(value)) as OnlyPreviewGlobalSearchPreview;
    },
    cancel: async (value) => {
      searchScheduler.cancelWhere((request: SearchValue) => request.requestId === value.requestId);
      previewScheduler.cancelWhere(
        (request: OnlyPreviewGlobalSearchPreviewRequest) => request.requestId === value.requestId
      );
      engine.revokeSearch(value.requestId);
    },
    hasActiveSearchIndex: (value) => engine.hasActiveSearchIndex(value),
    shutdown: async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      await Promise.all([
        searchScheduler.close(),
        previewScheduler.close(),
        priorityScheduler.close()
      ]);
      await engine.shutdown();
    }
  };
};
