import { reactive } from 'vue';
import { useThrottleFn } from '@vueuse/core';
import { xpcRenderer } from 'electron-xpc/renderer';
import {
  OnlyPreviewContractError,
  unwrapOnlyPreviewResult
} from '@shared/onlypreview/onlyPreview.contract';
import {
  ONLY_PREVIEW_SEARCH_BATCH_EVENT,
  ONLY_PREVIEW_SEARCH_MAX_WATCH_PATHS,
  ONLY_PREVIEW_SEARCH_MAX_RESULTS,
  ONLY_PREVIEW_SEARCH_WATCH_COMMIT_EVENT,
  type OnlyPreviewSearchBatch,
  type OnlyPreviewSearchResult,
  type OnlyPreviewSearchScope,
  type OnlyPreviewSearchWatchCommitEvent
} from '@shared/onlypreview/onlyPreviewSearch.type';
import { onlyPreviewEnv } from '../../common/contextBridge/onlyPreviewEnv.bridge';
import { getOnlyPreviewErrorMessage, onlyPreviewI18n } from '../../common/onlyPreviewI18n';
import { onlyPreviewSearchClient } from './onlyPreviewSearch.client';
import {
  areOnlyPreviewSearchResultsEqual,
  isOnlyPreviewSearchBatchEvent
} from './onlyPreviewSearchBatch.service';
import { getOnlyPreviewParentPath } from './onlyPreviewTree.service';

export interface OnlyPreviewProjectSearchContext {
  workspaceId: string;
  generation: number;
  ready: boolean;
  rootName: string;
  focusedRelativePath: string;
  focusedNodeKind: 'file' | 'directory' | 'symlink' | null;
  selectedRelativePath: string;
}

const errorMessage = (error: unknown): string => {
  if (error instanceof OnlyPreviewContractError) {
    return getOnlyPreviewErrorMessage(error.code);
  }
  return onlyPreviewI18n.project.projectSearchFailed;
};

const isWatchRelativePath = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 16_384 &&
  !value.includes('\0') &&
  !value.startsWith('/') &&
  !value.includes('\\') &&
  !/^[a-zA-Z]:/.test(value) &&
  !value.split('/').some((segment) => !segment || segment === '.' || segment === '..');

const hasExactKeys = (value: Record<string, unknown>, expected: readonly string[]): boolean => {
  const keys = Reflect.ownKeys(value);
  return (
    keys.length === expected.length &&
    keys.every((key) => typeof key === 'string' && expected.includes(key))
  );
};

const isWatchCommitEvent = (value: unknown): value is OnlyPreviewSearchWatchCommitEvent => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  if (
    !hasExactKeys(event, ['hostId', 'commit']) ||
    typeof event.hostId !== 'string' ||
    !event.commit ||
    typeof event.commit !== 'object' ||
    Array.isArray(event.commit)
  ) {
    return false;
  }
  const commit = event.commit as Record<string, unknown>;
  return (
    hasExactKeys(commit, [
      'workspaceId',
      'generation',
      'revision',
      'full',
      'changedRelativePaths'
    ]) &&
    typeof commit.workspaceId === 'string' &&
    commit.workspaceId.length > 0 &&
    commit.workspaceId.length <= 256 &&
    !commit.workspaceId.includes('\0') &&
    Number.isSafeInteger(commit.generation) &&
    (commit.generation as number) >= 0 &&
    Number.isSafeInteger(commit.revision) &&
    (commit.revision as number) > 0 &&
    typeof commit.full === 'boolean' &&
    Array.isArray(commit.changedRelativePaths) &&
    commit.changedRelativePaths.length <= ONLY_PREVIEW_SEARCH_MAX_WATCH_PATHS &&
    commit.changedRelativePaths.every(isWatchRelativePath) &&
    new Set(commit.changedRelativePaths).size === commit.changedRelativePaths.length &&
    (!commit.full || commit.changedRelativePaths.length === 0)
  );
};

class OnlyPreviewProjectSearchStore {
  active = false;
  query = '';
  scopeKind: OnlyPreviewSearchScope['kind'] = 'directory';
  directoryRelativePath = '';
  directoryLabel = '';
  results: OnlyPreviewSearchResult[] = [];
  pending = false;
  truncated = false;
  error = '';
  private inputGeneration = 0;
  private lastDispatchedInputGeneration = -1;
  private activeRequestId: string | null = null;
  private activeRequestInputGeneration: number | null = null;
  private readonly resultIndexByPath = new Map<string, number>();
  private batchSubscribed = false;
  private composing = false;
  private scheduleSearch: (() => void) | null = null;
  private resolveContext: (() => OnlyPreviewProjectSearchContext | null) | null = null;
  private selectRelativePath: ((relativePath: string) => void) | null = null;

  configure(
    resolveContext: () => OnlyPreviewProjectSearchContext | null,
    selectRelativePath: (relativePath: string) => void
  ): void {
    this.resolveContext = resolveContext;
    this.selectRelativePath = selectRelativePath;
  }

  configureScheduler(scheduleSearch: () => void): void {
    this.scheduleSearch = scheduleSearch;
  }

  subscribeToBatches(): void {
    if (this.batchSubscribed) return;
    this.batchSubscribed = true;
    xpcRenderer.subscribe(ONLY_PREVIEW_SEARCH_BATCH_EVENT, (payload) => {
      if (
        isOnlyPreviewSearchBatchEvent(payload.params) &&
        payload.params.hostId === onlyPreviewEnv.hostId
      ) {
        this.acceptBatch(payload.params.batch);
      }
    });
    xpcRenderer.subscribe(ONLY_PREVIEW_SEARCH_WATCH_COMMIT_EVENT, (payload) => {
      if (isWatchCommitEvent(payload.params) && payload.params.hostId === onlyPreviewEnv.hostId) {
        this.acceptWatchCommit(payload.params.commit);
      }
    });
  }

  enter(): void {
    if (this.active) return;
    this.captureDirectoryScope(this.resolveContext?.() ?? null);
    this.active = true;
    this.query = '';
    this.clearResults();
    this.error = '';
    this.pending = false;
    this.inputGeneration += 1;
    this.lastDispatchedInputGeneration = -1;
  }

  exit(): void {
    this.active = false;
    this.query = '';
    this.clearResults();
    this.error = '';
    this.pending = false;
    this.composing = false;
    this.inputGeneration += 1;
    this.cancelActive();
  }

  resetForWorkspace(): void {
    this.exit();
    this.lastDispatchedInputGeneration = -1;
  }

  setQuery(value: string): void {
    if (value === this.query) return;
    this.query = value;
    this.inputGeneration += 1;
    this.error = '';
    this.cancelActive();
    this.clearResults();
    if (!value.trim()) {
      this.pending = false;
      return;
    }
    if (this.composing) return;
    const context = this.resolveContext?.() ?? null;
    if (!context || context.ready === false) {
      this.pending = true;
      return;
    }
    this.pending = true;
    this.scheduleSearch?.();
  }

  clear(): void {
    this.setQuery('');
  }

  setScopeKind(scopeKind: OnlyPreviewSearchScope['kind']): void {
    if (!this.active || scopeKind === this.scopeKind) return;
    this.scopeKind = scopeKind;
    this.inputGeneration += 1;
    this.error = '';
    this.cancelActive();
    this.clearResults();
    if (!this.query.trim()) return;
    const context = this.resolveContext?.() ?? null;
    this.pending = true;
    if (!this.composing && context && context.ready !== false) this.scheduleSearch?.();
  }

  beginComposition(): void {
    if (!this.active) return;
    this.composing = true;
    this.inputGeneration += 1;
    this.cancelActive();
  }

  endComposition(value: string): void {
    if (!this.active) return;
    if (value !== this.query) {
      this.query = value;
      this.inputGeneration += 1;
      this.error = '';
      this.clearResults();
    }
    this.cancelActive();
    this.composing = false;
    if (!value.trim()) {
      this.clearResults();
      this.pending = false;
      return;
    }
    const context = this.resolveContext?.() ?? null;
    if (!context || context.ready === false) {
      this.pending = true;
      return;
    }
    this.pending = true;
    this.scheduleSearch?.();
  }

  resumeForAvailableRuntime(): void {
    const context = this.resolveContext?.() ?? null;
    if (
      !this.active ||
      this.composing ||
      !this.query.trim() ||
      !context ||
      context.ready === false ||
      this.inputGeneration === this.lastDispatchedInputGeneration
    )
      return;
    this.pending = true;
    this.scheduleSearch?.();
  }

  async dispatchLatest(): Promise<void> {
    const hostToken = onlyPreviewEnv.hostToken;
    const context = this.resolveContext?.() ?? null;
    const query = this.query.trim();
    const scope: OnlyPreviewSearchScope =
      this.scopeKind === 'project'
        ? { kind: 'project' }
        : { kind: 'directory', relativePath: this.directoryRelativePath };
    const inputGeneration = this.inputGeneration;
    if (
      !hostToken ||
      !context ||
      context.ready === false ||
      !this.active ||
      this.composing ||
      !query ||
      inputGeneration === this.lastDispatchedInputGeneration
    ) {
      return;
    }

    this.lastDispatchedInputGeneration = inputGeneration;
    const previousRequestId = this.activeRequestId;
    if (previousRequestId) this.cancelRequest(previousRequestId);
    const requestId = crypto.randomUUID();
    this.activeRequestId = requestId;
    this.activeRequestInputGeneration = inputGeneration;
    this.pending = true;
    this.error = '';
    try {
      const response = unwrapOnlyPreviewResult(
        await onlyPreviewSearchClient.search({
          hostToken,
          workspaceId: context.workspaceId,
          generation: context.generation,
          requestId,
          query,
          maxResults: ONLY_PREVIEW_SEARCH_MAX_RESULTS,
          scope
        })
      );
      const currentContext = this.resolveContext?.() ?? null;
      if (
        this.activeRequestId !== requestId ||
        this.inputGeneration !== inputGeneration ||
        currentContext?.workspaceId !== context.workspaceId ||
        currentContext.generation !== context.generation ||
        response.requestId !== requestId ||
        response.workspaceId !== context.workspaceId ||
        response.generation !== context.generation
      ) {
        return;
      }
      const finalResults = response.results.slice(0, ONLY_PREVIEW_SEARCH_MAX_RESULTS);
      if (!areOnlyPreviewSearchResultsEqual(this.results, finalResults)) {
        this.replaceResults(finalResults);
      }
      this.truncated = response.truncated;
    } catch (error) {
      const currentContext = this.resolveContext?.() ?? null;
      if (
        this.activeRequestId === requestId &&
        this.inputGeneration === inputGeneration &&
        currentContext?.workspaceId === context.workspaceId &&
        currentContext.generation === context.generation
      ) {
        this.clearResults();
        this.error = errorMessage(error);
      }
    } finally {
      if (this.activeRequestId === requestId) {
        this.activeRequestId = null;
        this.activeRequestInputGeneration = null;
        this.pending =
          this.active &&
          Boolean(this.query.trim()) &&
          this.inputGeneration !== this.lastDispatchedInputGeneration;
      }
    }
  }

  selectResult(result: OnlyPreviewSearchResult): void {
    if (!this.active) return;
    this.selectRelativePath?.(result.relativePath);
  }

  shutdown(): void {
    const hostToken = onlyPreviewEnv.hostToken;
    this.exit();
    if (!hostToken) return;
    void onlyPreviewSearchClient.shutdown({ hostToken }).catch(() => undefined);
  }

  private cancelActive(): void {
    const requestId = this.activeRequestId;
    this.activeRequestId = null;
    this.activeRequestInputGeneration = null;
    this.pending = false;
    if (requestId) this.cancelRequest(requestId);
  }

  private cancelRequest(requestId: string): void {
    const hostToken = onlyPreviewEnv.hostToken;
    if (!hostToken) return;
    void onlyPreviewSearchClient.cancel({ hostToken, requestId }).catch(() => undefined);
  }

  private acceptBatch(batch: OnlyPreviewSearchBatch): void {
    const context = this.resolveContext?.() ?? null;
    if (
      this.activeRequestId !== batch.requestId ||
      this.activeRequestInputGeneration !== this.inputGeneration ||
      context?.workspaceId !== batch.workspaceId ||
      context.generation !== batch.generation
    ) {
      return;
    }
    for (const result of batch.results) {
      const existingIndex = this.resultIndexByPath.get(result.relativePath);
      if (existingIndex === undefined) {
        if (this.results.length >= ONLY_PREVIEW_SEARCH_MAX_RESULTS) continue;
        this.resultIndexByPath.set(result.relativePath, this.results.length);
        this.results.push(result);
      } else {
        this.results[existingIndex] = result;
      }
    }
  }

  private acceptWatchCommit(commit: OnlyPreviewSearchWatchCommitEvent['commit']): void {
    const context = this.resolveContext?.() ?? null;
    if (
      !this.active ||
      this.composing ||
      !this.query.trim() ||
      !context ||
      context.workspaceId !== commit.workspaceId ||
      context.generation !== commit.generation
    ) {
      return;
    }
    if (
      !commit.full &&
      this.scopeKind === 'directory' &&
      this.directoryRelativePath &&
      !commit.changedRelativePaths.some(
        (relativePath) =>
          relativePath === this.directoryRelativePath ||
          relativePath.startsWith(`${this.directoryRelativePath}/`)
      )
    ) {
      return;
    }
    this.inputGeneration += 1;
    this.error = '';
    this.cancelActive();
    this.pending = true;
    if (context.ready !== false) this.scheduleSearch?.();
  }

  private clearResults(): void {
    this.results = [];
    this.resultIndexByPath.clear();
    this.truncated = false;
  }

  private replaceResults(results: OnlyPreviewSearchResult[]): void {
    this.results = results;
    this.resultIndexByPath.clear();
    results.forEach((result, index) => this.resultIndexByPath.set(result.relativePath, index));
  }

  private captureDirectoryScope(context: OnlyPreviewProjectSearchContext | null): void {
    let relativePath = '';
    if (context?.focusedNodeKind === 'directory') {
      relativePath = context.focusedRelativePath;
    } else if (context?.focusedNodeKind === 'file') {
      relativePath = getOnlyPreviewParentPath(context.focusedRelativePath);
    } else if (context?.selectedRelativePath) {
      relativePath = getOnlyPreviewParentPath(context.selectedRelativePath);
    }
    this.scopeKind = 'directory';
    this.directoryRelativePath = relativePath;
    this.directoryLabel = relativePath || context?.rootName || '';
  }
}

export const onlyPreviewProjectSearchStore = reactive<OnlyPreviewProjectSearchStore>(
  new OnlyPreviewProjectSearchStore()
);

export const createOnlyPreviewProjectSearchScheduler = (run: () => void): (() => void) =>
  useThrottleFn(run, 120, true, true);

onlyPreviewProjectSearchStore.configureScheduler(
  createOnlyPreviewProjectSearchScheduler(() => {
    void onlyPreviewProjectSearchStore.dispatchLatest();
  })
);
