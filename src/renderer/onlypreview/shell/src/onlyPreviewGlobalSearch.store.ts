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
import {
  createOnlyPreviewGlobalSearchPreviewScheduler,
  type OnlyPreviewGlobalSearchPreviewScheduler
} from './onlyPreviewGlobalSearchPreviewScheduler.service';
import type { OnlyPreviewGlobalSearchFocusOrigin } from '@shared/onlypreview/onlyPreview.types';
import type { OnlyPreviewGlobalSearchWorkspaceContext } from '@shared/onlypreview/onlyPreview.types';
import {
  createOnlyPreviewSearchDiagnostics,
  type OnlyPreviewSearchDiagnostics
} from '@shared/onlypreview/onlyPreviewSearchDiagnostics.mjs';

export type OnlyPreviewGlobalSearchContext = OnlyPreviewGlobalSearchWorkspaceContext;

type OpenResult = (result: OnlyPreviewGlobalSearchResult) => Promise<boolean>;
type CloseSearch = (mode: 'opener' | 'project' | 'preview' | 'discard') => Promise<void>;

interface OnlyPreviewGlobalSearchPreviewCandidate {
  result: OnlyPreviewGlobalSearchResult;
  previewRevision: number;
  workspaceId: string;
  generation: number;
  requestId: string;
}

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
  context: OnlyPreviewGlobalSearchContext | null = null;
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
  previewComponentRevision = 0;
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
  private closeSearch: CloseSearch | null = null;
  private scheduleSearch: (() => void) | null = null;
  private previewScheduler: OnlyPreviewGlobalSearchPreviewScheduler<OnlyPreviewGlobalSearchPreviewCandidate> | null =
    null;
  private centeredProjectPathOnExit: string | null = null;
  private diagnostics = createOnlyPreviewSearchDiagnostics();
  private diagnosticSearch: {
    tag: string;
    startedAt: number;
    firstSections: Set<'files' | 'contents'>;
    terminal: boolean;
  } | null = null;

  get visibleResults(): OnlyPreviewGlobalSearchResult[] {
    return [
      ...(this.contentsCollapsed ? [] : this.contents),
      ...(this.filesCollapsed ? [] : this.files)
    ];
  }

  getContext(): OnlyPreviewGlobalSearchContext | null {
    return this.context ?? this.resolveContext?.() ?? null;
  }

  setContext(context: OnlyPreviewGlobalSearchContext | null): void {
    const previous = this.context;
    const workspaceChanged =
      previous?.workspaceId !== context?.workspaceId ||
      previous?.generation !== context?.generation;
    this.context = context ? { ...context } : null;
    if (workspaceChanged) {
      this.inputRevision += 1;
      this.dispatchedRevision = -1;
      this.cancelRequest();
      this.clearResults();
      this.captureDirectoryScope(this.context);
    } else {
      this.syncCurrentDirectory(this.context);
    }
    this.resumeForAvailableRuntime();
  }

  configure(
    resolveContext: () => OnlyPreviewGlobalSearchContext | null,
    open: OpenResult,
    close: CloseSearch = async () => undefined
  ): void {
    this.resolveContext = resolveContext;
    this.openResult = open;
    this.closeSearch = close;
  }

  configureScheduler(schedule: () => void): void {
    this.scheduleSearch = schedule;
  }

  configurePreviewScheduler(
    scheduler: OnlyPreviewGlobalSearchPreviewScheduler<OnlyPreviewGlobalSearchPreviewCandidate>
  ): void {
    this.previewScheduler?.cancel();
    this.previewScheduler = scheduler;
  }

  configureDiagnostics(diagnostics: OnlyPreviewSearchDiagnostics): void {
    this.diagnostics = diagnostics;
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
      this.centeredProjectPathOnExit = null;
      this.captureDirectoryScope(context);
      this.filesCollapsed = false;
      this.contentsCollapsed = false;
      this.openerOrigin = origin;
      this.restoreFocusOnExit = true;
    }
    this.active = true;
    this.focusRevision += 1;
  }

  exit(restoreFocus = true, centeredProjectPath: string | null = null): void {
    if (this.active) {
      this.restoreFocusOnExit = restoreFocus;
      this.centeredProjectPathOnExit = centeredProjectPath;
    }
    this.active = false;
    this.query = '';
    this.inputRevision += 1;
    this.composing = false;
    this.cancelRequest();
    this.clearResults();
  }

  resetForWorkspace(): void {
    this.exit();
    this.context = null;
    this.dispatchedRevision = -1;
  }

  setQuery(value: string): void {
    if (value === this.query) return;
    this.query = value;
    this.restartForSearchIdentityChange(false);
  }

  clear(): void {
    this.setQuery('');
  }

  async dismiss(): Promise<void> {
    await this.closeSearch?.('opener');
    this.exit(false);
  }

  async handleEscape(): Promise<void> {
    if (this.query) {
      this.clear();
      return;
    }
    await this.dismiss();
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
      this.restartForSearchIdentityChange(false);
      return;
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
    this.restartForSearchIdentityChange(true);
  }

  syncCurrentDirectory(context: OnlyPreviewGlobalSearchContext | null): void {
    if (!this.active || !context) return;
    const relativePath = context.currentDirectoryRelativePath;
    const pathChanged = relativePath !== this.directoryRelativePath;
    this.directoryRelativePath = relativePath;
    this.directoryLabel = relativePath || context.rootName;
    if (!pathChanged || this.scopeKind !== 'directory' || !this.query.trim()) return;
    this.restartForSearchIdentityChange(true);
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
    this.cancelAcceptedOfficeRead();
    this.selectedResult = result;
    this.preview = null;
    this.previewError = '';
    this.previewRevision += 1;
    this.previewComponentRevision = this.previewRevision;
    this.previewPending = Boolean(result);
    if (!result) {
      this.previewScheduler?.cancel();
      return;
    }
    const context = this.resolveContext?.() ?? null;
    const requestId = this.requestId;
    if (!context || !requestId) {
      this.previewPending = false;
      return;
    }
    this.previewScheduler?.schedule({
      result,
      previewRevision: this.previewRevision,
      workspaceId: context.workspaceId,
      generation: context.generation,
      requestId
    });
  }

  async openSelected(): Promise<void> {
    const result = this.selectedResult;
    if (!result || !this.openResult) return;
    if (!(await this.openResult(result))) return;
    if (result.section === 'files' && result.nodeKind === 'directory') {
      this.exit(false, result.relativePath);
      return;
    }
    this.exit();
  }

  consumeCenteredProjectPath(): string | null {
    const relativePath = this.centeredProjectPathOnExit;
    this.centeredProjectPathOnExit = null;
    return relativePath;
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
    this.diagnosticSearch = {
      tag: this.diagnostics.nextTag('s'),
      startedAt: this.diagnostics.now(),
      firstSections: new Set(),
      terminal: false
    };
    this.diagnostics.emit('shell-dispatch', {
      tag: this.diagnosticSearch.tag,
      generation: context.generation
    });
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
      this.emitDiagnosticTerminal('success');
    } catch (error) {
      if (this.isCurrent(context, requestId, revision)) {
        this.error = errorMessage(error);
        this.emitDiagnosticTerminal('failure');
      }
    } finally {
      if (this.isCurrent(context, requestId, revision)) this.pending = false;
    }
  }

  dispatchPreview(candidate: OnlyPreviewGlobalSearchPreviewCandidate): void {
    void this.fetchPreview(candidate);
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
    this.exit(false);
  }

  private async fetchPreview(candidate: OnlyPreviewGlobalSearchPreviewCandidate): Promise<void> {
    const { result, workspaceId, generation, requestId } = candidate;
    const hostToken = onlyPreviewEnv.hostToken;
    if (!hostToken || !this.isPreviewCurrent(candidate)) return;
    try {
      const preview = unwrapOnlyPreviewResult(
        await onlyPreviewSearchClient.preview({
          hostToken,
          workspaceId,
          generation,
          requestId,
          resultToken: result.resultToken
        })
      );
      if (!this.isPreviewCurrent(candidate)) {
        this.cancelOfficeRead(preview);
        return;
      }
      this.preview = preview;
    } catch (error) {
      if (this.isPreviewCurrent(candidate)) this.previewError = errorMessage(error);
    } finally {
      if (this.isPreviewCurrent(candidate)) this.previewPending = false;
    }
  }

  private isPreviewCurrent(candidate: OnlyPreviewGlobalSearchPreviewCandidate): boolean {
    const context = this.resolveContext?.() ?? null;
    return (
      this.active &&
      candidate.previewRevision === this.previewRevision &&
      candidate.workspaceId === context?.workspaceId &&
      candidate.generation === context?.generation &&
      candidate.requestId === this.requestId &&
      Boolean(this.selectedResult && sameGlobalSearchResult(this.selectedResult, candidate.result))
    );
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
    this.emitDiagnosticFirstBatch('files', batch.files.length);
    this.emitDiagnosticFirstBatch('contents', batch.contents.length);
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
    if (requestId) this.emitDiagnosticTerminal('cancelled');
    this.cancelPreviewLifecycle();
    this.requestId = null;
    if (clearPending) this.pending = false;
    const hostToken = onlyPreviewEnv.hostToken;
    if (requestId && hostToken) {
      void onlyPreviewSearchClient.cancel({ hostToken, requestId }).catch(() => undefined);
    }
  }

  private emitDiagnosticFirstBatch(section: 'files' | 'contents', count: number): void {
    const search = this.diagnosticSearch;
    if (!search || count === 0 || search.firstSections.has(section)) return;
    search.firstSections.add(section);
    this.diagnostics.emit('shell-first-batch', {
      tag: search.tag,
      section,
      count,
      elapsedMs: this.diagnostics.elapsed(search.startedAt)
    });
  }

  private emitDiagnosticTerminal(outcome: 'success' | 'failure' | 'cancelled'): void {
    const search = this.diagnosticSearch;
    if (!search || search.terminal) return;
    search.terminal = true;
    this.diagnostics.emit('shell-terminal', {
      tag: search.tag,
      outcome,
      filesCount: this.files.length,
      contentsCount: this.contents.length,
      elapsedMs: this.diagnostics.elapsed(search.startedAt)
    });
  }

  private clearResults(): void {
    this.cancelPreviewLifecycle();
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

  private cancelPreviewLifecycle(): void {
    this.previewScheduler?.cancel();
    this.cancelAcceptedOfficeRead();
    this.previewRevision += 1;
    this.previewComponentRevision = this.previewRevision;
    this.preview = null;
    this.previewError = '';
    this.previewPending = false;
  }

  private cancelAcceptedOfficeRead(): void {
    this.cancelOfficeRead(this.preview);
  }

  private cancelOfficeRead(preview: OnlyPreviewGlobalSearchPreview | null): void {
    const hostToken = onlyPreviewEnv.hostToken;
    if (!hostToken || preview?.kind !== 'office') return;
    void onlyPreviewSearchClient
      .cancelOfficeRead({
        hostToken,
        workspaceId: preview.workspaceId,
        generation: preview.generation,
        requestId: preview.requestId,
        resultToken: preview.resultToken,
        readGrant: preview.readGrant
      })
      .catch(() => undefined);
  }

  private restartForSearchIdentityChange(dispatchImmediately: boolean): void {
    this.inputRevision += 1;
    this.cancelRequest(false);
    this.clearResults();
    if (!this.query.trim()) return;
    this.pending = true;
    if (this.composing) return;
    if (dispatchImmediately) {
      void this.dispatchLatest();
    } else {
      this.scheduleSearch?.();
    }
  }

  private captureDirectoryScope(context: OnlyPreviewGlobalSearchContext | null): void {
    const relativePath = context?.currentDirectoryRelativePath || '';
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

onlyPreviewGlobalSearchStore.configurePreviewScheduler(
  createOnlyPreviewGlobalSearchPreviewScheduler((candidate) =>
    onlyPreviewGlobalSearchStore.dispatchPreview(candidate)
  )
);
