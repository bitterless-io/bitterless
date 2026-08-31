import type {
  OnlyPreviewBrowseDirectoryRequest,
  OnlyPreviewBrowseListing,
  OnlyPreviewGlobalSearchPreview,
  OnlyPreviewGlobalSearchPreviewRequest,
  OnlyPreviewGlobalSearchOfficeReadChunkRequest,
  OnlyPreviewGlobalSearchOfficeReadChunkResult,
  OnlyPreviewGlobalSearchOfficeReadOpenResult,
  OnlyPreviewGlobalSearchOfficeReadRequest,
  OnlyPreviewGlobalSearchResult,
  OnlyPreviewSearchBuildProgress,
  OnlyPreviewSearchPrioritizeFileRequest,
  OnlyPreviewSearchResponse,
  OnlyPreviewSearchScope,
  OnlyPreviewSearchSnapshot,
  OnlyPreviewSearchWatchCommit
} from '@shared/onlypreview/onlyPreviewSearch.type';
import {
  ONLY_PREVIEW_OFFICE_READ_MAX_BYTES,
  getOnlyPreviewOfficePackageKind,
  type OnlyPreviewOfficePackageKind
} from '@shared/onlypreview/onlyPreviewOfficeReadRuntime.types';
import { OnlyPreviewContractError } from '@shared/onlypreview/onlyPreview.contract';
import { randomUUID } from 'node:crypto';
import { createOnlyPreviewSearchEngine } from '@preload/onlypreview/search/core/search-engine.mjs';
import { createSearchResultBatcher } from '@preload/onlypreview/search/core/result-batcher.mjs';
import { createLatestSingleFlight } from '@preload/onlypreview/search/core/single-flight.mjs';
import type { OnlyPreviewSearchDiagnostics } from '@shared/onlypreview/onlyPreviewSearchDiagnostics.mjs';
import { FileSearchOfficeReader } from './fileSearchOfficeReader.service';

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
  openOfficeRead(
    params: OnlyPreviewGlobalSearchOfficeReadRequest
  ): Promise<OnlyPreviewGlobalSearchOfficeReadOpenResult>;
  readOfficeChunk(
    params: OnlyPreviewGlobalSearchOfficeReadChunkRequest
  ): Promise<OnlyPreviewGlobalSearchOfficeReadChunkResult>;
  cancelOfficeRead(params: OnlyPreviewGlobalSearchOfficeReadRequest): Promise<void>;
  cancel(params: { requestId: string }): Promise<void>;
  hasActiveSearchIndex(params: { workspaceId: string; generation: number }): boolean;
  shutdown(): Promise<void>;
}

export interface CreateOnlyPreviewSearchCoordinatorOptions {
  diagnostics?: OnlyPreviewSearchDiagnostics;
  createEngine?: typeof createOnlyPreviewSearchEngine;
  createOfficeReader?: () => FileSearchOfficeReader;
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
  const officeReader = options.createOfficeReader?.() ?? new FileSearchOfficeReader();
  const officeRuntimeId = randomUUID();
  let officeSelectionRevision = 0;
  let officeGrant: {
    workspaceId: string;
    generation: number;
    requestId: string;
    resultToken: string;
    readGrant: string;
    selectionRevision: number;
    opened: boolean;
  } | null = null;

  const officeExtension = (relativePath: string): '.xlsx' | '.xlsm' | '.docx' | '.pptx' | null => {
    const extension = relativePath.slice(relativePath.lastIndexOf('.')).toLowerCase();
    return extension === '.xlsx' ||
      extension === '.xlsm' ||
      extension === '.docx' ||
      extension === '.pptx'
      ? extension
      : null;
  };

  const sameOfficeGrant = (
    value: OnlyPreviewGlobalSearchOfficeReadRequest,
    active = officeGrant
  ): boolean =>
    !!active &&
    active.workspaceId === value.workspaceId &&
    active.generation === value.generation &&
    active.requestId === value.requestId &&
    active.resultToken === value.resultToken &&
    active.readGrant === value.readGrant;

  const revokeOfficeGrant = async (
    value?: OnlyPreviewGlobalSearchOfficeReadRequest
  ): Promise<void> => {
    const active = officeGrant;
    if (!active || (value && !sameOfficeGrant(value, active))) return;
    officeGrant = null;
    await officeReader.cancel(active.readGrant, officeRuntimeId, active.selectionRevision);
  };

  const prepareOfficePreview = async ({
    authority,
    preview,
    workspaceId,
    generation,
    requestId,
    resultToken,
    isCancelled
  }: {
    authority: {
      nodeKind: string;
      relativePath: string;
      name: string;
      size: number;
      modifiedAt: number;
    };
    preview: { kind: 'info'; size: number; modifiedAt: number };
    workspaceId: string;
    generation: number;
    requestId: string;
    resultToken: string;
    isCancelled(): boolean;
  }): Promise<OnlyPreviewGlobalSearchPreview | null> => {
    const sourceExtension = officeExtension(authority.relativePath);
    const kind = getOnlyPreviewOfficePackageKind(authority.relativePath);
    if (authority.nodeKind !== 'file' || !sourceExtension || !kind) return null;
    if (isCancelled()) {
      throw new OnlyPreviewContractError(
        'OPERATION_FAILED',
        'Search Office preview was cancelled.'
      );
    }
    await revokeOfficeGrant();
    const readGrant = randomUUID();
    const selectionRevision = ++officeSelectionRevision;
    const prepared = await officeReader.prepare({
      grantId: readGrant,
      runtimeId: officeRuntimeId,
      selectionRevision,
      kind: kind as OnlyPreviewOfficePackageKind,
      workspaceId,
      relativePath: authority.relativePath,
      maxBytes: ONLY_PREVIEW_OFFICE_READ_MAX_BYTES
    });
    if (
      isCancelled() ||
      prepared.size !== preview.size ||
      Math.trunc(prepared.modifiedAt) !== preview.modifiedAt
    ) {
      await officeReader.cancel(readGrant, officeRuntimeId, selectionRevision);
      if (isCancelled()) {
        throw new OnlyPreviewContractError(
          'OPERATION_FAILED',
          'Search Office preview was cancelled.'
        );
      }
      throw new OnlyPreviewContractError(
        'PATH_NOT_FOUND',
        'The selected Office file changed before it could be previewed.'
      );
    }
    officeGrant = {
      workspaceId,
      generation,
      requestId,
      resultToken,
      readGrant,
      selectionRevision,
      opened: false
    };
    return {
      kind: 'office',
      adapter: kind,
      name: authority.name,
      sourceExtension,
      size: prepared.size,
      modifiedAt: Math.trunc(prepared.modifiedAt),
      workspaceId,
      generation,
      requestId,
      resultToken,
      readGrant
    };
  };

  const engine = (options.createEngine ?? createOnlyPreviewSearchEngine)({
    onBrowseListing: options.onBrowseListing,
    onProgress: options.onProgress,
    onSnapshot: options.onSnapshot,
    onWatchCommit: options.onWatchCommit,
    diagnostics: options.diagnostics,
    prepareOfficePreview
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
    initialize: async (value) => {
      await officeReader.bindWorkspace(value.workspaceId, value.rootPath);
      return await engine.initialize(value);
    },
    refresh: async (value) => {
      previewScheduler.cancelWhere(() => true);
      await revokeOfficeGrant();
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
      const officeRevoked = revokeOfficeGrant();
      engine.revokeSearch();
      await officeRevoked;
      return (await searchScheduler.submit(value)) as OnlyPreviewSearchResponse;
    },
    preview: async (value) => {
      if (shuttingDown) throw new Error('OnlyPreview file-search runtime is closing.');
      await revokeOfficeGrant();
      return (await previewScheduler.submit(value)) as OnlyPreviewGlobalSearchPreview;
    },
    openOfficeRead: async (value) => {
      const active = officeGrant;
      if (!sameOfficeGrant(value, active) || !active || active.opened) {
        throw new OnlyPreviewContractError(
          'INVALID_INPUT',
          'Search Office read grant is unavailable.'
        );
      }
      active.opened = true;
      try {
        const opened = await officeReader.open(
          active.readGrant,
          officeRuntimeId,
          active.selectionRevision
        );
        if (officeGrant !== active) {
          throw new OnlyPreviewContractError(
            'OPERATION_FAILED',
            'Search Office read was superseded.'
          );
        }
        return {
          workspaceId: active.workspaceId,
          generation: active.generation,
          requestId: active.requestId,
          resultToken: active.resultToken,
          readGrant: active.readGrant,
          totalBytes: opened.totalBytes
        };
      } catch (error) {
        if (officeGrant === active) officeGrant = null;
        throw error;
      }
    },
    readOfficeChunk: async (value) => {
      const active = officeGrant;
      if (!sameOfficeGrant(value, active) || !active || !active.opened) {
        throw new OnlyPreviewContractError(
          'INVALID_INPUT',
          'Search Office read grant is unavailable.'
        );
      }
      try {
        const chunk = await officeReader.readNext(
          active.readGrant,
          officeRuntimeId,
          active.selectionRevision,
          value.offset
        );
        if (officeGrant !== active) {
          throw new OnlyPreviewContractError(
            'OPERATION_FAILED',
            'Search Office read was superseded.'
          );
        }
        if (chunk.eof) officeGrant = null;
        return {
          workspaceId: active.workspaceId,
          generation: active.generation,
          requestId: active.requestId,
          resultToken: active.resultToken,
          readGrant: active.readGrant,
          offset: chunk.offset,
          bytes: chunk.bytes,
          eof: chunk.eof
        };
      } catch (error) {
        if (officeGrant === active) {
          officeGrant = null;
          await officeReader
            .cancel(active.readGrant, officeRuntimeId, active.selectionRevision)
            .catch(() => undefined);
        }
        throw error;
      }
    },
    cancelOfficeRead: async (value) => await revokeOfficeGrant(value),
    cancel: async (value) => {
      searchScheduler.cancelWhere((request: SearchValue) => request.requestId === value.requestId);
      previewScheduler.cancelWhere(
        (request: OnlyPreviewGlobalSearchPreviewRequest) => request.requestId === value.requestId
      );
      engine.revokeSearch(value.requestId);
      if (officeGrant?.requestId === value.requestId) await revokeOfficeGrant();
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
      await revokeOfficeGrant();
      await officeReader.dispose();
      await engine.shutdown();
    }
  };
};
