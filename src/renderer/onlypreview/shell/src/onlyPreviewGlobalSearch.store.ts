import { reactive } from 'vue';
import { useDebounceFn } from '@vueuse/core';
import { xpcRenderer } from 'electron-xpc/renderer';
import {
  OnlyPreviewContractError,
  unwrapOnlyPreviewResult
} from '@shared/onlypreview/onlyPreview.contract';
import {
  ONLY_PREVIEW_GLOBAL_SEARCH_SECTION_MAX_RESULTS,
  ONLY_PREVIEW_SEARCH_BATCH_EVENT,
  ONLY_PREVIEW_SEARCH_WATCH_COMMIT_EVENT,
  type OnlyPreviewGlobalSearchPreview,
  type OnlyPreviewGlobalSearchResult,
  type OnlyPreviewSearchBatchEvent,
  type OnlyPreviewSearchScope,
  type OnlyPreviewSearchWatchCommitEvent
} from '@shared/onlypreview/onlyPreviewSearch.type';
import { onlyPreviewEnv } from '../../common/contextBridge/onlyPreviewEnv.bridge';
import { getOnlyPreviewErrorMessage, onlyPreviewI18n } from '../../common/onlyPreviewI18n';
import { onlyPreviewSearchClient } from './onlyPreviewSearch.client';
import {
  isOnlyPreviewGlobalSearchBatchEvent,
  replaceGlobalSearchResult,
  sameGlobalSearchPath,
  sameGlobalSearchResult
} from './onlyPreviewGlobalSearchResult.service';
import { getOnlyPreviewParentPath } from './onlyPreviewTree.service';
import type { OnlyPreviewGlobalSearchFocusOrigin } from '@shared/onlypreview/onlyPreview.types';

export interface OnlyPreviewGlobalSearchContext {
  workspaceId: string;
  generation: number;
  ready: boolean;
  rootName: string;
  focusedRelativePath: string;
  focusedNodeKind: 'file' | 'directory' | 'symlink' | null;
  selectedRelativePath: string;
}

type OpenResult = (result: OnlyPreviewGlobalSearchResult) => Promise<boolean>;

const errorMessage = (error: unknown): string =>
  error instanceof OnlyPreviewContractError
    ? getOnlyPreviewErrorMessage(error.code)
    : onlyPreviewI18n.globalSearch.failed;

const isWatchEvent = (value: unknown): value is OnlyPreviewSearchWatchCommitEvent => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const event = value as Partial<OnlyPreviewSearchWatchCommitEvent>;
  const commit = event.commit;
  return (
    typeof event.hostId === 'string' &&
    !!commit &&
    typeof commit.workspaceId === 'string' &&
    Number.isSafeInteger(commit.generation) &&
    Number.isSafeInteger(commit.revision) &&
    typeof commit.full === 'boolean' &&
    Array.isArray(commit.changedRelativePaths) &&
    commit.changedRelativePaths.every((path) => typeof path === 'string')
  );
};

class OnlyPreviewGlobalSearchStore {
  active = false;
  query = '';
  scopeKind: OnlyPreviewSearchScope['kind'] = 'directory';
  directoryRelativePath = '';
  directoryLabel = '';
  files: Extract<OnlyPreviewGlobalSearchResult, { section: 'files' }>[] = [];
  contents: Extract<OnlyPreviewGlobalSearchResult, { section: 'contents' }>[] = [];
  filesCollapsed = false;
  contentsCollapsed = false;
  filesTruncated = false;
  contentsTruncated = false;
  pending = false;
  error = '';
  selectedResult: OnlyPreviewGlobalSearchResult | null = null;
  preview: OnlyPreviewGlobalSearchPreview | null = null;
  previewPending = false;
  previewError = '';
  previewPercent = 38;
  focusRevision = 0;
  openerOrigin: OnlyPreviewGlobalSearchFocusOrigin = 'shell';
  restoreFocusOnExit = true;
  private inputRevision = 0;
  private dispatchedRevision = -1;
  private previewRevision = 0;
  private requestId: string | null = null;
  private composing = false;
  private subscribed = false;
  private resolveContext: (() => OnlyPreviewGlobalSearchContext | null) | null = null;
  private openResult: OpenResult | null = null;
  private scheduleSearch: (() => void) | null = null;

  get visibleResults(): OnlyPreviewGlobalSearchResult[] {
    return [
      ...(this.filesCollapsed ? [] : this.files),
      ...(this.contentsCollapsed ? [] : this.contents)
    ];
  }

  configure(resolveContext: () => OnlyPreviewGlobalSearchContext | null, open: OpenResult): void {
    this.resolveContext = resolveContext;
    this.openResult = open;
  }

  configureScheduler(schedule: () => void): void {
    this.scheduleSearch = schedule;
  }

  subscribe(): void {
    if (this.subscribed) return;
    this.subscribed = true;
    xpcRenderer.subscribe(ONLY_PREVIEW_SEARCH_BATCH_EVENT, (payload) => {
      if (
        isOnlyPreviewGlobalSearchBatchEvent(payload.params) &&
        payload.params.hostId === onlyPreviewEnv.hostId
      ) {
        this.acceptBatch(payload.params.batch);
      }
    });
    xpcRenderer.subscribe(ONLY_PREVIEW_SEARCH_WATCH_COMMIT_EVENT, (payload) => {
      if (isWatchEvent(payload.params) && payload.params.hostId === onlyPreviewEnv.hostId) {
        this.acceptWatchCommit(payload.params.commit);
      }
    });
  }

  enter(origin: OnlyPreviewGlobalSearchFocusOrigin = 'shell'): void {
    const context = this.resolveContext?.() ?? null;
    if (!this.active) {
      this.captureDirectoryScope(context);
      this.filesCollapsed = false;
      this.contentsCollapsed = false;
      this.openerOrigin = origin;
      this.restoreFocusOnExit = true;
    }
    this.active = true;
    this.focusRevision += 1;
  }

  exit(restoreFocus = true): void {
    if (this.active) this.restoreFocusOnExit = restoreFocus;
    this.active = false;
    this.query = '';
    this.inputRevision += 1;
    this.composing = false;
    this.cancelRequest();
    this.clearResults();
  }

  resetForWorkspace(): void {
    this.exit();
    this.dispatchedRevision = -1;
  }

  setQuery(value: string): void {
    if (value === this.query) return;
    this.query = value;
    this.inputRevision += 1;
    this.error = '';
    this.cancelRequest(false);
    if (!value.trim()) {
      this.clearResults();
      return;
    }
    this.pending = true;
    if (!this.composing) this.scheduleSearch?.();
  }

  clear(): void {
    this.setQuery('');
  }

  handleEscape(): void {
    if (this.query) this.clear();
    else this.exit();
  }

  beginComposition(): void {
    if (!this.active) return;
    this.composing = true;
    this.inputRevision += 1;
    this.cancelRequest(false);
  }

  endComposition(value: string): void {
    if (!this.active) return;
    this.composing = false;
    if (value !== this.query) {
      this.query = value;
      this.inputRevision += 1;
    }
    this.cancelRequest(false);
    if (!value.trim()) {
      this.clearResults();
      return;
    }
    this.pending = true;
    this.scheduleSearch?.();
  }

  setScopeKind(kind: OnlyPreviewSearchScope['kind']): void {
    if (!this.active || kind === this.scopeKind) return;
    this.scopeKind = kind;
    this.inputRevision += 1;
    this.cancelRequest(false);
    if (this.query.trim()) {
      this.pending = true;
      this.scheduleSearch?.();
    }
  }

  toggleGroup(section: 'files' | 'contents', expanded?: boolean): void {
    const collapsed = expanded === undefined ? undefined : !expanded;
    if (section === 'files') {
      this.filesCollapsed = collapsed ?? !this.filesCollapsed;
    } else {
      this.contentsCollapsed = collapsed ?? !this.contentsCollapsed;
    }
    if (
      this.selectedResult &&
      !this.visibleResults.some((result) => sameGlobalSearchResult(result, this.selectedResult!))
    ) {
      this.selectResult(this.visibleResults[0] ?? null);
    }
  }

  moveSelection(offset: -1 | 1): void {
    const rows = this.visibleResults;
    if (!rows.length) return;
    const current = this.selectedResult
      ? rows.findIndex((result) => sameGlobalSearchResult(result, this.selectedResult!))
      : -1;
    const next = current < 0 ? (offset > 0 ? 0 : rows.length - 1) : current + offset;
    this.selectResult(rows[Math.max(0, Math.min(rows.length - 1, next))]);
  }

  selectResult(result: OnlyPreviewGlobalSearchResult | null): void {
    if (
      !this.active ||
      (result && this.selectedResult && sameGlobalSearchResult(result, this.selectedResult))
    ) {
      return;
    }
    this.selectedResult = result;
    this.preview = null;
    this.previewError = '';
    this.previewRevision += 1;
    if (result) void this.fetchPreview(result, this.previewRevision);
  }

  async openSelected(): Promise<void> {
    const result = this.selectedResult;
    if (!result || !this.openResult) return;
    if (await this.openResult(result)) this.exit();
  }

  setPreviewPercent(value: number): void {
    this.previewPercent = Math.round(Math.min(70, Math.max(25, value)));
  }

  async dispatchLatest(): Promise<void> {
    const context = this.resolveContext?.() ?? null;
    const hostToken = onlyPreviewEnv.hostToken;
    const query = this.query.trim();
    const revision = this.inputRevision;
    if (
      !this.active ||
      this.composing ||
      !hostToken ||
      !context ||
      !context.ready ||
      !query ||
      revision === this.dispatchedRevision
    ) {
      return;
    }
    this.dispatchedRevision = revision;
    this.cancelRequest(false);
    const requestId = crypto.randomUUID();
    this.requestId = requestId;
    this.pending = true;
    this.error = '';
    const scope: OnlyPreviewSearchScope =
      this.scopeKind === 'project'
        ? { kind: 'project' }
        : { kind: 'directory', relativePath: this.directoryRelativePath };
    try {
      const response = unwrapOnlyPreviewResult(
        await onlyPreviewSearchClient.search({
          hostToken,
          workspaceId: context.workspaceId,
          generation: context.generation,
          requestId,
          query,
          maxResults: ONLY_PREVIEW_GLOBAL_SEARCH_SECTION_MAX_RESULTS,
          scope
        })
      );
      if (!this.isCurrent(context, requestId, revision)) return;
      this.files = response.files.slice(0, ONLY_PREVIEW_GLOBAL_SEARCH_SECTION_MAX_RESULTS);
      this.contents = response.contents.slice(0, ONLY_PREVIEW_GLOBAL_SEARCH_SECTION_MAX_RESULTS);
      this.filesTruncated = response.filesTruncated;
      this.contentsTruncated = response.contentsTruncated;
      this.reconcileSelection();
    } catch (error) {
      if (this.isCurrent(context, requestId, revision)) this.error = errorMessage(error);
    } finally {
      if (this.isCurrent(context, requestId, revision)) this.pending = false;
    }
  }

  resumeForAvailableRuntime(): void {
    if (
      this.active &&
      !this.composing &&
      this.query.trim() &&
      this.inputRevision !== this.dispatchedRevision
    ) {
      this.pending = true;
      this.scheduleSearch?.();
    }
  }

  shutdown(): void {
    const hostToken = onlyPreviewEnv.hostToken;
    this.exit();
    if (hostToken) void onlyPreviewSearchClient.shutdown({ hostToken }).catch(() => undefined);
  }

  private async fetchPreview(
    result: OnlyPreviewGlobalSearchResult,
    previewRevision: number
  ): Promise<void> {
    const hostToken = onlyPreviewEnv.hostToken;
    const context = this.resolveContext?.() ?? null;
    const requestId = this.requestId;
    if (!hostToken || !context || !requestId) return;
    this.previewPending = true;
    try {
      const preview = unwrapOnlyPreviewResult(
        await onlyPreviewSearchClient.preview({
          hostToken,
          workspaceId: context.workspaceId,
          generation: context.generation,
          requestId,
          resultToken: result.resultToken
        })
      );
      if (
        previewRevision === this.previewRevision &&
        this.requestId === requestId &&
        this.selectedResult &&
        sameGlobalSearchResult(this.selectedResult, result)
      ) {
        this.preview = preview;
      }
    } catch (error) {
      if (previewRevision === this.previewRevision && this.requestId === requestId) {
        this.previewError = errorMessage(error);
      }
    } finally {
      if (previewRevision === this.previewRevision) this.previewPending = false;
    }
  }

  private acceptBatch(batch: OnlyPreviewSearchBatchEvent['batch']): void {
    const context = this.resolveContext?.() ?? null;
    if (
      !context ||
      batch.requestId !== this.requestId ||
      batch.workspaceId !== context.workspaceId ||
      batch.generation !== context.generation
    ) {
      return;
    }
    for (const result of batch.files) replaceGlobalSearchResult(this.files, result);
    for (const result of batch.contents) replaceGlobalSearchResult(this.contents, result);
    this.files = this.files.slice(0, ONLY_PREVIEW_GLOBAL_SEARCH_SECTION_MAX_RESULTS);
    this.contents = this.contents.slice(0, ONLY_PREVIEW_GLOBAL_SEARCH_SECTION_MAX_RESULTS);
    this.reconcileSelection();
  }

  private acceptWatchCommit(commit: OnlyPreviewSearchWatchCommitEvent['commit']): void {
    const context = this.resolveContext?.() ?? null;
    if (
      !this.active ||
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
        (path) =>
          path === this.directoryRelativePath ||
          path.startsWith(`${this.directoryRelativePath}/`)
      )
    ) {
      return;
    }
    this.inputRevision += 1;
    this.cancelRequest(false);
    this.pending = true;
    this.scheduleSearch?.();
  }

  private reconcileSelection(): void {
    const rows = this.visibleResults;
    const selected = this.selectedResult;
    if (selected) {
      const accepted = rows.find((result) => sameGlobalSearchResult(result, selected));
      if (accepted) {
        this.selectedResult = accepted;
        return;
      }
      const replacement = rows.find((result) => sameGlobalSearchPath(result, selected));
      if (replacement) {
        this.selectedResult = null;
        this.selectResult(replacement);
        return;
      }
    }
    this.selectResult(rows[0] ?? null);
  }

  private isCurrent(
    context: OnlyPreviewGlobalSearchContext,
    requestId: string,
    revision: number
  ): boolean {
    const current = this.resolveContext?.() ?? null;
    return (
      this.active &&
      this.requestId === requestId &&
      this.inputRevision === revision &&
      current?.workspaceId === context.workspaceId &&
      current.generation === context.generation
    );
  }

  private cancelRequest(clearPending = true): void {
    const requestId = this.requestId;
    this.requestId = null;
    this.previewRevision += 1;
    this.previewPending = false;
    if (clearPending) this.pending = false;
    const hostToken = onlyPreviewEnv.hostToken;
    if (requestId && hostToken) {
      void onlyPreviewSearchClient.cancel({ hostToken, requestId }).catch(() => undefined);
    }
  }

  private clearResults(): void {
    this.files = [];
    this.contents = [];
    this.filesTruncated = false;
    this.contentsTruncated = false;
    this.error = '';
    this.selectedResult = null;
    this.preview = null;
    this.previewError = '';
    this.previewPending = false;
    this.pending = false;
  }

  private captureDirectoryScope(context: OnlyPreviewGlobalSearchContext | null): void {
    let relativePath = '';
    if (context?.focusedNodeKind === 'directory') relativePath = context.focusedRelativePath;
    else if (context?.focusedNodeKind === 'file') {
      relativePath = getOnlyPreviewParentPath(context.focusedRelativePath);
    } else if (context?.selectedRelativePath) {
      relativePath = getOnlyPreviewParentPath(context.selectedRelativePath);
    }
    this.scopeKind = 'directory';
    this.directoryRelativePath = relativePath;
    this.directoryLabel = relativePath || context?.rootName || '';
  }
}

export const onlyPreviewGlobalSearchStore = reactive<OnlyPreviewGlobalSearchStore>(
  new OnlyPreviewGlobalSearchStore()
);

export const createOnlyPreviewGlobalSearchScheduler = (run: () => void): (() => void) =>
  useDebounceFn(run, 120, { maxWait: 120 });

onlyPreviewGlobalSearchStore.configureScheduler(
  createOnlyPreviewGlobalSearchScheduler(() => void onlyPreviewGlobalSearchStore.dispatchLatest())
);
