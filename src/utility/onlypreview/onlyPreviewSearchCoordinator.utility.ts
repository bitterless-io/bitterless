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
  cancelBuffer: SharedArrayBuffer;
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
  shutdown(): Promise<void>;
}

interface CreateOnlyPreviewSearchCoordinatorOptions {
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

export const createOnlyPreviewSearchUtilityCoordinator = (
  options: CreateOnlyPreviewSearchCoordinatorOptions
): OnlyPreviewSearchCoordinator => {
  const engine = createOnlyPreviewSearchEngine({
    onBrowseListing: options.onBrowseListing,
    onProgress: options.onProgress,
    onSnapshot: options.onSnapshot,
    onWatchCommit: options.onWatchCommit
  });
  let shuttingDown = false;
  let controlTail = Promise.resolve();

  const searchScheduler = createLatestSingleFlight({
    createControl: (): SearchControl => ({
      cancelBuffer: new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)
    }),
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
          cancelBuffer: control.cancelBuffer,
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
      const state = new Int32Array(control.cancelBuffer);
      Atomics.store(state, 0, 1);
      Atomics.notify(state, 0);
    }
  });

  const runControl = <T>(operation: () => Promise<T>): Promise<T> => {
    const block = searchScheduler.beginBlock();
    const result = controlTail.then(async () => {
      await block.drained;
      return await operation();
    });
    controlTail = result.then(
      () => undefined,
      () => undefined
    );
    return result.finally(() => block.release());
  };

  return {
    initialize: async (value) => await runControl(async () => await engine.initialize(value)),
    refresh: async (value) => await runControl(async () => await engine.refresh(value)),
    browseDirectory: async (value) => await engine.browseDirectory(value),
    search: async (value) => {
      if (shuttingDown) throw new Error('OnlyPreview search utility is closing.');
      return (await searchScheduler.submit(value)) as OnlyPreviewSearchResponse;
    },
    cancel: async (value) => {
      searchScheduler.cancelWhere((request: SearchValue) => request.requestId === value.requestId);
    },
    shutdown: async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      await runControl(async () => await engine.shutdown());
      await searchScheduler.close();
    }
  };
};
