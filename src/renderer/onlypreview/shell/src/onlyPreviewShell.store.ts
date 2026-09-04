import { reactive } from 'vue';
import { unwrapOnlyPreviewResult } from '@shared/onlypreview/onlyPreview.contract';
import {
  type OnlyPreviewBounds,
  type OnlyPreviewFileRef,
  type OnlyPreviewGlobalSearchDirectoryRevealAction,
  type OnlyPreviewGlobalSearchWorkspaceContext,
  type OnlyPreviewHostRequest,
  type OnlyPreviewIndex,
  type OnlyPreviewIndexEntry,
  type OnlyPreviewProjectItemCopyKind,
  type OnlyPreviewResult,
  type OnlyPreviewPreviewPresentation,
  type OnlyPreviewSettings,
  type OnlyPreviewWorkspace
} from '@shared/onlypreview/onlyPreview.types';
import {
  type OnlyPreviewBrowseListing,
  type OnlyPreviewSearchBuildProgress,
  type OnlyPreviewSearchSnapshot
} from '@shared/onlypreview/onlyPreviewSearch.type';
import { onlyPreviewClient } from '../../common/onlyPreviewClient';
import { describeOnlyPreviewError, onlyPreviewErrorDetail } from './onlyPreviewErrorDetail.store';
import { onlyPreviewEnv } from '../../common/contextBridge/onlyPreviewEnv.bridge';
import { onlyPreviewI18n } from '../../common/onlyPreviewI18n';
import { OnlyPreviewCharacterCountHostGate } from '../../common/onlyPreviewCharacterCountGate.service';
import { sameOnlyPreviewSelection } from '../../common/onlyPreviewPresentation.service';
import type { OnlyPreviewTreeRow } from './onlyPreviewShell.type';
import { onlyPreviewSearchClient } from './onlyPreviewSearch.client';
import { dispatchOnlyPreviewSelectedFilePriority } from './onlyPreviewSelectedFilePriority.service';
import { onlyPreviewGlobalSearchShellClient } from './onlyPreviewGlobalSearchShell.client';
import { handleOnlyPreviewGlobalSearchDirectoryReveal } from './onlyPreviewGlobalSearchShell.service';
import {
  copyOnlyPreviewProjectRoot,
  showOnlyPreviewProjectRootContextMenu
} from './onlyPreviewProjectRoot.client';
import {
  OnlyPreviewBrowseProjectionService,
  type OnlyPreviewBrowseProjectionContext,
  type OnlyPreviewBrowseProjectionResult
} from './onlyPreviewBrowseProjection.service';
import {
  createOnlyPreviewSearchProgressState,
  reduceOnlyPreviewSearchProgress,
  resetOnlyPreviewSearchProgress,
  settleOnlyPreviewSearchProgress,
  type OnlyPreviewSearchProgressState
} from './onlyPreviewSearchProgress.service';
import { resolveOnlyPreviewProjectionCommit } from './onlyPreviewProjectionCommit.service';
import { subscribeOnlyPreviewShellEvents } from './onlyPreviewShellEvents.service';
import { onlyPreviewFindStore } from './onlyPreviewFind.store';
import {
  createOnlyPreviewSearchDiagnostics,
  type OnlyPreviewSearchDiagnostics
} from '@shared/onlypreview/onlyPreviewSearchDiagnostics.mjs';
import {
  buildOnlyPreviewRootedTreeRows,
  getOnlyPreviewParentPath,
  moveOnlyPreviewTreeFocus,
  resolveOnlyPreviewCurrentDirectory,
  resolveOnlyPreviewTreeFocusPath,
  type OnlyPreviewTreeNavigationKey
} from './onlyPreviewTree.service';
import { onlyPreviewProjectWidthPersistence as projectWidthPersistence } from './onlyPreviewProjectWidthPersistence.service';
import { OnlyPreviewDeferredIndexService } from './onlyPreviewDeferredIndex.service';

export class OnlyPreviewShellStore {
  private readonly deferredIndex: OnlyPreviewDeferredIndexService;
  constructor(private readonly diagnostics: OnlyPreviewSearchDiagnostics = createOnlyPreviewSearchDiagnostics()) {
    this.deferredIndex = new OnlyPreviewDeferredIndexService(diagnostics);
  }
  workspace: OnlyPreviewWorkspace | null = null;
  index: OnlyPreviewIndex | null = null;
  settings: OnlyPreviewSettings | null = null;
  selectedRelativePath = '';
  treeSelectedRelativePath: string | null = null;
  /** Set by `onlyPreviewTreeSelection.store.ts`, which documents why. */
  collapseTreeSelection: () => void = () => {};
  selectedCharacterCount = 0;
  previewPresentation: OnlyPreviewPreviewPresentation | null = null;
  previewActionError = '';
  focusedRelativePath = '';
  expandedPaths = new Set<string>();
  projectWidth = projectWidthPersistence.restore(window.innerWidth);
  indexLoading = false;
  targetLoading = false;
  errorMessage = '';
  focusProjectRevision = 0;
  centerProjectRevision = 0;
  centerProjectRelativePath = '';
  private initialized = false;
  private restoreGeneration = 0;
  private workspaceGeneration = 0;
  private selectionGeneration = 0;
  private searchWorkspaceGeneration = 0;
  private previewPresentationFetchGeneration = 0;
  readonly browseProjection = new OnlyPreviewBrowseProjectionService();
  private indexProgressState: OnlyPreviewSearchProgressState = createOnlyPreviewSearchProgressState();
  private readonly characterCountGate = new OnlyPreviewCharacterCountHostGate();
  private pendingCharacterCount = 0;
  get visibleRows(): OnlyPreviewTreeRow[] {
    return buildOnlyPreviewRootedTreeRows(this.index, this.workspace?.rootName || '', this.expandedPaths, this.browseProjection.searchExcludedPaths);
  }
  get projectionReady(): boolean {
    return this.browseProjection.ready;
  }
  get indexProgress(): OnlyPreviewSearchBuildProgress | null {
    return this.indexProgressState.progress;
  }
  get indexProgressRatio(): number {
    const progress = this.indexProgress;
    if (progress?.phase !== 'indexing') return 0;
    if (progress.total === 0) return 1;
    return Math.min(1, Math.max(0, progress.completed / progress.total));
  }
  get selectedEntry(): OnlyPreviewIndexEntry | null {
    return this.index?.entries.find((entry) => entry.relativePath === this.selectedRelativePath) || null;
  }
  get currentDirectoryRelativePath(): string {
    return resolveOnlyPreviewCurrentDirectory(this.index, this.treeSelectedRelativePath, this.selectedRelativePath);
  }
  get previewFileRef(): OnlyPreviewPreviewPresentation['fileRef'] {
    return this.previewPresentation?.fileRef || null;
  }
  get selectedTextAvailable(): boolean {
    return this.previewPresentation?.selectedTextAvailable === true;
  }
  get treeFocusRelativePath(): string {
    return resolveOnlyPreviewTreeFocusPath(
      this.visibleRows,
      this.focusedRelativePath,
      this.treeSelectedRelativePath
    );
  }
  async initialize(): Promise<void> {
    if (this.initialized) return;
    const diagnostic = { tag: this.diagnostics.nextTag('h'), startedAt: this.diagnostics.now() };
    this.initialized = true;
    let outcome: 'success' | 'failure' = 'failure';
    try {
      this.subscribe();
      this.reportGlobalSearchContext();
      if (!onlyPreviewEnv.hostToken || !onlyPreviewEnv.hostId) {
        this.errorMessage = onlyPreviewI18n.errors.HOST_NOT_FOUND;
        return;
      }
      await Promise.all([
        this.refreshSettings(),
        this.restoreWorkspace(true),
        this.syncPreviewPresentation(),
        onlyPreviewFindStore.initialize()
      ]);
      outcome = 'success';
    } finally {
      this.diagnostics.emit('shell-initialized', {
        tag: diagnostic.tag,
        outcome,
        elapsedMs: this.diagnostics.elapsed(diagnostic.startedAt)
      });
    }
  }
  async chooseFolder(): Promise<void> {
    const hostToken = onlyPreviewEnv.hostToken;
    if (!hostToken || this.targetLoading) return;
    this.targetLoading = true;
    this.errorMessage = '';
    try {
      const workspace = unwrapOnlyPreviewResult(
        await onlyPreviewClient.chooseFolder({ hostToken })
      );
      if (!workspace) return;
      // The workspace-change event is the single authoritative update path for both views.
    } catch (error) {
      this.errorMessage = describeOnlyPreviewError(error);
    } finally {
      this.targetLoading = false;
    }
  }
  async refresh(): Promise<void> {
    if (!this.workspace) return;
    await (this.deferredIndex.cancel() ? this.initializeIndex() : this.refreshIndex());
  }
  dismissError(): void {
    this.errorMessage = '';
    onlyPreviewErrorDetail.clear();
  }
  async openSettings(): Promise<void> {
    const hostToken = onlyPreviewEnv.hostToken;
    if (!hostToken) return;
    try {
      unwrapOnlyPreviewResult(await onlyPreviewClient.openSettings({ hostToken }));
    } catch (error) {
      this.errorMessage = describeOnlyPreviewError(error);
    }
  }
  async openAgentSkillGuide(): Promise<void> {
    const hostToken = onlyPreviewEnv.hostToken;
    if (!hostToken) return;
    try {
      unwrapOnlyPreviewResult(await onlyPreviewClient.openAgentSkillGuide({ hostToken }));
    } catch (error) {
      this.errorMessage = describeOnlyPreviewError(error);
    }
  }
  async minimizeWindow(): Promise<void> {
    const hostToken = onlyPreviewEnv.hostToken;
    if (!hostToken) return;
    await this.runWindowCommand(() => onlyPreviewClient.minimizeWindow({ hostToken }));
  }
  async toggleMaximizeWindow(): Promise<void> {
    const hostToken = onlyPreviewEnv.hostToken;
    if (!hostToken) return;
    await this.runWindowCommand(() => onlyPreviewClient.toggleMaximizeWindow({ hostToken }));
  }
  async closeWindow(): Promise<void> {
    const hostToken = onlyPreviewEnv.hostToken;
    if (!hostToken) return;
    await this.runWindowCommand(() => onlyPreviewClient.closeWindow({ hostToken }));
  }
  getGlobalSearchContext(): OnlyPreviewGlobalSearchWorkspaceContext | null {
    const workspace = this.workspace;
    if (!workspace) return null;
    return { workspaceId: workspace.workspaceId, generation: this.searchWorkspaceGeneration,
      ready: this.projectionReady, rootName: workspace.rootName,
      currentDirectoryRelativePath: this.currentDirectoryRelativePath };
  }
  setFocusedPath(relativePath: string): void {
    this.focusedRelativePath = relativePath;
  }
  focusTree(): string {
    const relativePath = this.treeFocusRelativePath;
    this.focusedRelativePath = relativePath;
    return relativePath;
  }
  async locateSelectedFile(): Promise<string> {
    if (!this.selectedRelativePath) return '';
    this.collapseTreeSelection();
    this.treeSelectedRelativePath = this.selectedRelativePath;
    this.expandSelectedParents();
    await this.loadSelectedParentListings();
    if (!this.selectedEntry) return '';
    this.focusedRelativePath = this.selectedEntry.relativePath;
    return this.focusedRelativePath;
  }
  async showFileContextMenu(entry: OnlyPreviewIndexEntry | string): Promise<void> {
    if (typeof entry !== 'string' && entry.nodeKind === 'symlink') return;
    const relativePath = typeof entry === 'string' ? entry : entry.relativePath;
    if (relativePath === '') {
      await showOnlyPreviewProjectRootContextMenu(this.workspace, (command) =>
        this.runWindowCommand(command)
      );
      return;
    }
    const request = this.projectItemRequest(relativePath);
    if (!request) return;
    try {
      unwrapOnlyPreviewResult(await onlyPreviewClient.showFileContextMenu(request));
    } catch (error) {
      this.errorMessage = describeOnlyPreviewError(error);
    }
  }
  async copyProjectItem(
    relativePath: string,
    copyKind: OnlyPreviewProjectItemCopyKind
  ): Promise<void> {
    if (relativePath === '') {
      await copyOnlyPreviewProjectRoot(this.workspace, copyKind, (command) =>
        this.runWindowCommand(command)
      );
      return;
    }
    const request = this.projectItemRequest(relativePath);
    if (!request) return;
    await this.runWindowCommand(() =>
      onlyPreviewClient.copyProjectItem({ ...request, copyKind })
    );
  }
  async openPreviewExternally(): Promise<void> {
    await this.runPreviewFileAction('open');
  }
  async revealPreviewInFolder(): Promise<void> {
    await this.runPreviewFileAction('reveal');
  }
  moveTreeFocus(key: OnlyPreviewTreeNavigationKey): string {
    const rows = this.visibleRows;
    const movement = moveOnlyPreviewTreeFocus(rows, this.treeFocusRelativePath, key);
    if (movement.toggleDirectory !== undefined) this.toggleDirectory(movement.toggleDirectory);
    this.focusedRelativePath = movement.relativePath;
    return movement.relativePath;
  }
  handleTreeClick(entry: OnlyPreviewIndexEntry, clickCount: number, toggleDirectory = false): void {
    if (clickCount > 1) return;
    void this.activateEntry(entry, clickCount === 0 || toggleDirectory, toggleDirectory);
  }
  handleTreeDoubleClick(entry: OnlyPreviewIndexEntry): void {
    if (entry.nodeKind === 'file' && this.settings?.openFilesWithSingleClick) return;
    void this.activateEntry(entry, true, true);
  }
  activateFocusedEntry(): void {
    const entry = this.visibleRows.find(
      (candidate) => candidate.entry.relativePath === this.focusedRelativePath
    )?.entry;
    if (entry) void this.activateEntry(entry, true, true);
  }
  toggleDirectory(relativePath: string): void {
    if (this.expandedPaths.has(relativePath)) {
      this.expandedPaths.delete(relativePath);
      return;
    }
    this.expandedPaths.add(relativePath);
    void this.loadDirectory(relativePath);
  }
  setProjectWidth(value: number): void {
    this.projectWidth = projectWidthPersistence.update(value, window.innerWidth);
  }
  async reportPreviewBounds(bounds: OnlyPreviewBounds): Promise<void> {
    if (!onlyPreviewEnv.hostToken) return;
    try {
      unwrapOnlyPreviewResult(
        await onlyPreviewClient.updatePreviewBounds({
          hostToken: onlyPreviewEnv.hostToken,
          ...bounds
        })
      );
    } catch (error) {
      this.errorMessage = describeOnlyPreviewError(error);
    }
  }

  private subscribe(): void {
    subscribeOnlyPreviewShellEvents(onlyPreviewEnv.hostId, {
      workspaceChanged: () => {
        void this.restoreWorkspace();
      },
      selectionChanged: () => {
        void this.syncSelection();
      },
      characterCountChanged: (characterCount) => {
        if (this.nativeFindSuppressesCharacterCount()) {
          this.selectedCharacterCount = 0;
          this.pendingCharacterCount = 0;
          return;
        }
        if (characterCount === 0) {
          this.selectedCharacterCount = 0;
          this.pendingCharacterCount = 0;
        } else if (
          this.selectedTextAvailable &&
          this.previewFileRef &&
          this.characterCountGate.canAcceptCount(characterCount)
        ) {
          this.selectedCharacterCount = characterCount;
        } else if (this.characterCountGate.canBufferCount(characterCount)) {
          this.pendingCharacterCount = characterCount;
        }
      },
      characterCountReady: (revision) => this.characterCountGate.acceptReady(revision),
      previewPresentation: () => void this.syncPreviewPresentation(),
      refresh: () => void this.refresh(),
      browseListing: (listing) => this.applyBrowseListing(listing),
      searchProgress: (progress) => this.applySearchProgress(progress),
      searchSnapshot: (snapshot) => void this.applySearchSnapshot(snapshot),
      settingsChanged: () => void this.refreshSettings(),
      focusProject: () => {
        this.focusProjectRevision += 1;
      },
      revealGlobalSearchDirectory: (action) => {
        void this.handleGlobalSearchDirectoryReveal(action);
      },
      findState: () => void this.syncFindState(),
      focusFind: () => void this.handleFocusFind()
    });
  }
  private nativeFindSuppressesCharacterCount(): boolean {
    const presentation = this.previewPresentation;
    const state = onlyPreviewFindStore.state;
    return (
      onlyPreviewFindStore.open &&
      !!presentation &&
      !!state &&
      state.selectionRevision === presentation.selectionRevision &&
      state.surface === presentation.surface &&
      presentation.surface === 'vue' &&
      presentation.adapterId === 'markdown-dom'
    );
  }
  private clearNativeFindSelectionCount(): void {
    if (!this.nativeFindSuppressesCharacterCount()) return;
    this.selectedCharacterCount = 0;
    this.pendingCharacterCount = 0;
  }
  private async syncFindState(): Promise<void> {
    await onlyPreviewFindStore.sync();
    this.clearNativeFindSelectionCount();
  }
  private async handleFocusFind(): Promise<void> {
    await onlyPreviewFindStore.handleFocusRequest();
    this.clearNativeFindSelectionCount();
  }
  private applySearchProgress(progress: OnlyPreviewSearchBuildProgress): void {
    const workspace = this.workspace;
    if (!workspace) return;
    const next = reduceOnlyPreviewSearchProgress(this.indexProgressState, progress, {
      workspaceId: workspace.workspaceId,
      generation: this.searchWorkspaceGeneration
    });
    if (next === this.indexProgressState) return;
    this.indexProgressState = next;
    this.indexLoading = true;
  }

  private async runWindowCommand(command: () => Promise<OnlyPreviewResult<void>>): Promise<void> {
    try {
      unwrapOnlyPreviewResult(await command());
    } catch (error) {
      this.errorMessage = describeOnlyPreviewError(error);
    }
  }
  private projectItemRequest(relativePath: string): (OnlyPreviewHostRequest & OnlyPreviewFileRef) | null {
    const hostToken = onlyPreviewEnv.hostToken;
    const workspace = this.workspace;
    if (!hostToken || !workspace || !relativePath) return null;
    return { hostToken, workspaceId: workspace.workspaceId, relativePath };
  }
  private async restoreWorkspace(deferInitialIndex = false): Promise<void> {
    const hostToken = onlyPreviewEnv.hostToken;
    if (!hostToken) return;
    this.selectedCharacterCount = 0;
    const generation = ++this.restoreGeneration;
    try {
      const workspace = unwrapOnlyPreviewResult(
        await onlyPreviewClient.restoreWorkspace({ hostToken })
      );
      if (generation !== this.restoreGeneration) return;
      if (!workspace) {
        this.deferredIndex.cancel();
        this.workspaceGeneration += 1;
        this.selectionGeneration += 1;
        this.searchWorkspaceGeneration += 1;
        this.workspace = null;
        this.clearBrowseProjection();
        this.indexLoading = false;
        this.indexProgressState = resetOnlyPreviewSearchProgress();
        this.selectedRelativePath = '';
        this.treeSelectedRelativePath = null;
        this.focusedRelativePath = '';
        this.selectedCharacterCount = 0;
        this.reportGlobalSearchContext();
        return;
      }
      await this.applyWorkspace(workspace, deferInitialIndex);
    } catch (error) {
      if (generation === this.restoreGeneration) this.errorMessage = describeOnlyPreviewError(error);
    }
  }
  private async applyWorkspace(workspace: OnlyPreviewWorkspace, deferInitialIndex = false): Promise<void> {
    const generation = ++this.workspaceGeneration;
    this.selectionGeneration += 1;
    this.searchWorkspaceGeneration += 1;
    this.workspace = workspace;
    this.clearBrowseProjection();
    this.expandedPaths.add('');
    this.indexProgressState = resetOnlyPreviewSearchProgress();
    this.selectedCharacterCount = 0;
    this.selectedRelativePath = workspace.selectedRelativePath || '';
    this.treeSelectedRelativePath = this.selectedRelativePath || null;
    this.focusedRelativePath = this.selectedRelativePath;
    this.expandSelectedParents();
    this.reportGlobalSearchContext();
    await this.deferredIndex.run(deferInitialIndex, () => generation === this.workspaceGeneration, () => this.initializeIndex());
    if (
      generation !== this.workspaceGeneration ||
      workspace.workspaceId !== this.workspace?.workspaceId
    ) {
      return;
    }
  }

  private async syncSelection(): Promise<void> {
    const hostToken = onlyPreviewEnv.hostToken;
    if (!hostToken) return;
    this.selectedCharacterCount = 0;
    const generation = ++this.restoreGeneration;
    try {
      const workspace = unwrapOnlyPreviewResult(
        await onlyPreviewClient.restoreWorkspace({ hostToken })
      );
      if (generation !== this.restoreGeneration) return;
      if (!workspace || workspace.workspaceId !== this.workspace?.workspaceId) {
        if (workspace) await this.applyWorkspace(workspace);
        return;
      }
      this.workspace = workspace;
      this.selectedRelativePath = workspace.selectedRelativePath || '';
      this.treeSelectedRelativePath = this.selectedRelativePath || null;
      this.focusedRelativePath = this.selectedRelativePath;
      this.expandSelectedParents();
      await this.loadSelectedParentListings();
      this.reportGlobalSearchContext();
    } catch (error) {
      if (generation === this.restoreGeneration) this.errorMessage = describeOnlyPreviewError(error);
    }
  }

  private async initializeIndex(): Promise<void> {
    const hostToken = onlyPreviewEnv.hostToken;
    const workspace = this.workspace;
    if (!hostToken || !workspace) return;
    const workspaceId = workspace.workspaceId;
    const generation = this.searchWorkspaceGeneration;
    this.indexLoading = true;
    this.errorMessage = '';
    try {
      const snapshot = unwrapOnlyPreviewResult(
        await onlyPreviewSearchClient.initialize({
          hostToken,
          workspaceId,
          generation
        })
      );
      await this.applySearchSnapshot(snapshot);
    } catch (error) {
      if (
        generation === this.searchWorkspaceGeneration &&
        workspaceId === this.workspace?.workspaceId
      ) {
        this.failIndex(hostToken, workspaceId, error);
      }
    }
  }

  async refreshIndex(): Promise<void> {
    const hostToken = onlyPreviewEnv.hostToken;
    const workspace = this.workspace;
    if (!hostToken || !workspace) return;
    const workspaceId = workspace.workspaceId;
    const generation = this.searchWorkspaceGeneration;
    this.indexLoading = true;
    this.errorMessage = '';
    try {
      const snapshot = unwrapOnlyPreviewResult(
        await onlyPreviewSearchClient.refresh({ hostToken, workspaceId, generation })
      );
      await this.applySearchSnapshot(snapshot);
    } catch (error) {
      if (
        generation === this.searchWorkspaceGeneration &&
        workspaceId === this.workspace?.workspaceId
      ) {
        this.failIndex(hostToken, workspaceId, error);
      }
    }
  }
  private failIndex(hostToken: string, workspaceId: string, error: unknown): void {
    this.indexLoading = false;
    this.errorMessage = describeOnlyPreviewError(error);
    this.indexProgressState = settleOnlyPreviewSearchProgress(this.indexProgressState);
    void onlyPreviewClient.reportProjectIndexFailed({ hostToken, workspaceId });
  }
  private async applySearchSnapshot(snapshot: OnlyPreviewSearchSnapshot): Promise<void> {
    const workspace = this.workspace;
    if (
      !workspace ||
      snapshot.workspaceId !== workspace.workspaceId ||
      snapshot.generation !== this.searchWorkspaceGeneration ||
      snapshot.index.workspaceId !== workspace.workspaceId
    ) {
      return;
    }
    this.indexLoading = snapshot.state !== 'ready';
    if (snapshot.state !== 'ready') return;
    this.indexProgressState = settleOnlyPreviewSearchProgress(this.indexProgressState);
    this.reportGlobalSearchContext();
    this.expandSelectedParents();
    await this.loadSelectedParentListings();
  }

  private applyBrowseListing(listing: OnlyPreviewBrowseListing): boolean {
    const context = this.browseProjectionContext();
    if (!context) return false;
    const result = this.browseProjection.applyListing(listing, context, this.expandedPaths);
    this.commitBrowseProjectionResult(result, context);
    if (listing.relativePath !== '') return result.loaded;
    if (this.selectedRelativePath) void this.loadSelectedParentListings();
    this.reportGlobalSearchContext();
    return result.loaded;
  }

  private async loadDirectory(relativePath: string): Promise<boolean> {
    const context = this.browseProjectionContext();
    if (!context) return false;
    const result = await this.browseProjection.loadDirectory(
      relativePath,
      context,
      this.expandedPaths
    );
    return this.commitBrowseProjectionResult(result, context);
  }

  private async loadSelectedParentListings(): Promise<void> {
    const context = this.browseProjectionContext();
    if (!context) return;
    const result = await this.browseProjection.loadSelectedParentListings(
      this.selectedRelativePath,
      context,
      this.expandedPaths
    );
    this.commitBrowseProjectionResult(result, context);
  }

  private browseProjectionContext(): OnlyPreviewBrowseProjectionContext | null {
    const hostToken = onlyPreviewEnv.hostToken;
    const workspace = this.workspace;
    if (!hostToken || !workspace) return null;
    return {
      hostToken,
      workspaceId: workspace.workspaceId,
      generation: this.searchWorkspaceGeneration
    };
  }

  private commitBrowseProjectionResult(
    result: OnlyPreviewBrowseProjectionResult,
    context: OnlyPreviewBrowseProjectionContext
  ): boolean {
    const commit = resolveOnlyPreviewProjectionCommit({ result, index: this.index,
      current: context.workspaceId === this.workspace?.workspaceId &&
        context.generation === this.searchWorkspaceGeneration,
      treeSelectedRelativePath: this.treeSelectedRelativePath, readRows: () => this.visibleRows });
    if (commit.errorMessage) this.errorMessage = commit.errorMessage;
    if (!result.changed) return result.loaded;
    this.index = result.index;
    if (result.rootReplaced) {
      this.expandedPaths.add('');
      this.expandSelectedParents();
    }
    if (commit.inheritedSelection === null) this.reportGlobalSearchContext();
    else this.centerTreeRow(commit.inheritedSelection);
    return result.loaded;
  }

  private centerTreeRow(relativePath: string): void {
    this.collapseTreeSelection();
    this.treeSelectedRelativePath = relativePath;
    this.focusedRelativePath = relativePath;
    this.centerProjectRelativePath = relativePath;
    this.centerProjectRevision += 1;
    this.reportGlobalSearchContext();
  }

  private clearBrowseProjection(): void {
    this.browseProjection.clear(this.expandedPaths);
    this.index = null;
  }

  private async refreshSettings(): Promise<void> {
    const hostToken = onlyPreviewEnv.hostToken;
    if (!hostToken) return;
    try {
      this.settings = unwrapOnlyPreviewResult(await onlyPreviewClient.getSettings({ hostToken }));
    } catch (error) {
      this.errorMessage = describeOnlyPreviewError(error);
    }
  }

  private async activateEntry(entry: OnlyPreviewIndexEntry, force: boolean, toggleDirectory = false): Promise<void> {
    this.focusedRelativePath = entry.relativePath;
    this.treeSelectedRelativePath = entry.relativePath;
    this.reportGlobalSearchContext();
    if (entry.nodeKind === 'directory') {
      if (toggleDirectory) this.toggleDirectory(entry.relativePath);
      return;
    }
    if (entry.nodeKind !== 'file') return;
    if (!force && !this.settings?.openFilesWithSingleClick) return;
    await this.selectFile(entry.relativePath);
  }
  async handleGlobalSearchDirectoryReveal(
    action: OnlyPreviewGlobalSearchDirectoryRevealAction
  ): Promise<void> {
    const context = this.getGlobalSearchContext();
    const browseContext = this.browseProjectionContext();
    await handleOnlyPreviewGlobalSearchDirectoryReveal({
      action, workspaceId: context?.workspaceId ?? null, generation: context?.generation ?? null,
      projection: this.browseProjection, browseContext, expandedPaths: this.expandedPaths,
      applyResult: (result) => {
        if (browseContext) this.commitBrowseProjectionResult(result, browseContext);
      },
      onRevealed: (relativePath) => this.centerTreeRow(relativePath)
    });
  }

  private async selectFile(relativePath: string): Promise<void> {
    const hostToken = onlyPreviewEnv.hostToken;
    const workspace = this.workspace;
    if (!hostToken || !workspace) return;
    const generation = ++this.selectionGeneration;
    const searchGeneration = this.searchWorkspaceGeneration;
    this.restoreGeneration += 1;
    this.treeSelectedRelativePath = relativePath;
    this.focusedRelativePath = relativePath;
    this.selectedRelativePath = relativePath;
    this.expandSelectedParents();
    this.reportGlobalSearchContext();
    try {
      unwrapOnlyPreviewResult(
        await onlyPreviewClient.selectStandaloneFile({
          hostToken,
          workspaceId: workspace.workspaceId,
          relativePath
        })
      );
      if (generation !== this.selectionGeneration) return;
      dispatchOnlyPreviewSelectedFilePriority(
        hostToken, workspace.workspaceId, searchGeneration, relativePath
      );
    } catch (error) {
      if (generation !== this.selectionGeneration) return;
      await this.syncSelection();
      if (generation !== this.selectionGeneration) return;
      this.errorMessage = describeOnlyPreviewError(error);
    }
  }

  private expandSelectedParents(): void {
    let current = getOnlyPreviewParentPath(this.selectedRelativePath);
    while (current) {
      this.expandedPaths.add(current);
      current = getOnlyPreviewParentPath(current);
    }
  }

  private async syncPreviewPresentation(): Promise<void> {
    const hostToken = onlyPreviewEnv.hostToken;
    if (!hostToken) return;
    const generation = ++this.previewPresentationFetchGeneration;
    try {
      const presentation = unwrapOnlyPreviewResult(
        await onlyPreviewClient.getPreviewPresentation({ hostToken })
      );
      if (generation !== this.previewPresentationFetchGeneration) return;
      this.applyPreviewPresentation(presentation);
    } catch (error) {
      if (generation !== this.previewPresentationFetchGeneration) return;
      this.errorMessage = describeOnlyPreviewError(error);
    }
  }

  private applyPreviewPresentation(presentation: OnlyPreviewPreviewPresentation): void {
    const current = this.previewPresentation;
    if (presentation.hostId !== onlyPreviewEnv.hostId) return;
    if (current && presentation.selectionRevision < current.selectionRevision) return;
    if (
      current &&
      presentation.selectionRevision === current.selectionRevision &&
      !sameOnlyPreviewSelection(current, presentation)
    ) {
      return;
    }
    const revisionChanged = presentation.selectionRevision !== current?.selectionRevision;
    this.previewPresentation = presentation;
    this.clearNativeFindSelectionCount();
    if (revisionChanged) {
      const reportingRevision = String(presentation.selectionRevision);
      this.characterCountGate.beginTransition(reportingRevision);
      this.characterCountGate.resume(reportingRevision);
      this.selectedCharacterCount = 0;
      this.pendingCharacterCount = 0;
      this.previewActionError = '';
    }
    if (!presentation.selectedTextAvailable) {
      this.selectedCharacterCount = 0;
      this.pendingCharacterCount = 0;
    }
  }

  private async runPreviewFileAction(action: 'open' | 'reveal'): Promise<void> {
    const hostToken = onlyPreviewEnv.hostToken;
    const fileRef = this.previewFileRef;
    if (!hostToken || !fileRef) return;
    this.previewActionError = '';
    try {
      const result =
        action === 'open'
          ? await onlyPreviewClient.openExternally({ hostToken, ...fileRef })
          : await onlyPreviewClient.revealInFolder({ hostToken, ...fileRef });
      unwrapOnlyPreviewResult(result);
    } catch (error) {
      this.previewActionError = describeOnlyPreviewError(error);
    }
  }

  private reportGlobalSearchContext(): void {
    onlyPreviewGlobalSearchShellClient.report(this.getGlobalSearchContext());
  }
}
export const onlyPreviewShellStore = reactive<OnlyPreviewShellStore>(new OnlyPreviewShellStore());
