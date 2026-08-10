import { reactive } from 'vue';
import { xpcRenderer } from 'electron-xpc/renderer';
import {
  OnlyPreviewContractError,
  unwrapOnlyPreviewResult
} from '@shared/onlypreview/onlyPreview.contract';
import {
  ONLY_PREVIEW_CHARACTER_COUNT_TRANSITION_EVENT,
  type OnlyPreviewBounds,
  type OnlyPreviewIndex,
  type OnlyPreviewIndexEntry,
  type OnlyPreviewResult,
  type OnlyPreviewSettings,
  type OnlyPreviewWorkspace
} from '@shared/onlypreview/onlyPreview.types';
import {
  type OnlyPreviewBrowseListing,
  type OnlyPreviewSearchBuildProgress,
  type OnlyPreviewSearchMemory,
  type OnlyPreviewSearchSnapshot
} from '@shared/onlypreview/onlyPreviewSearch.type';
import { onlyPreviewClient } from '../../common/onlyPreviewClient';
import { onlyPreviewEnv } from '../../common/contextBridge/onlyPreviewEnv.bridge';
import { getOnlyPreviewErrorMessage, onlyPreviewI18n } from '../../common/onlyPreviewI18n';
import { OnlyPreviewCharacterCountHostGate } from '../../common/onlyPreviewCharacterCountGate.service';
import {
  onlyPreviewProjectSearchStore,
  type OnlyPreviewProjectSearchContext
} from './onlyPreviewProjectSearch.store';
import type { OnlyPreviewTreeRow } from './onlyPreviewShell.type';
import { onlyPreviewSearchClient } from './onlyPreviewSearch.client';
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
import { subscribeOnlyPreviewShellEvents } from './onlyPreviewShellEvents.service';
import { getOnlyPreviewParentPath, onlyPreviewTreeFilter } from './onlyPreviewTree.service';

const errorMessage = (error: unknown): string => {
  if (error instanceof OnlyPreviewContractError) {
    return getOnlyPreviewErrorMessage(error.code);
  }
  return onlyPreviewI18n.errors.OPERATION_FAILED;
};

class OnlyPreviewShellStore {
  workspace: OnlyPreviewWorkspace | null = null;
  index: OnlyPreviewIndex | null = null;
  settings: OnlyPreviewSettings | null = null;
  searchQuery = '';
  projectSearchMemory: OnlyPreviewSearchMemory | null = null;
  selectedRelativePath = '';
  selectedCharacterCount = 0;
  focusedRelativePath = '';
  expandedPaths = new Set<string>();
  projectWidth = 264;
  indexLoading = false;
  targetLoading = false;
  errorMessage = '';
  focusProjectRevision = 0;
  focusSearchRevision = 0;
  private initialized = false;
  private restoreGeneration = 0;
  private workspaceGeneration = 0;
  private selectionGeneration = 0;
  private searchWorkspaceGeneration = 0;
  private readonly browseProjection = new OnlyPreviewBrowseProjectionService();
  private indexProgressState: OnlyPreviewSearchProgressState =
    createOnlyPreviewSearchProgressState();
  private readonly characterCountGate = new OnlyPreviewCharacterCountHostGate();
  private pendingCharacterCount = 0;

  get visibleRows(): OnlyPreviewTreeRow[] {
    return onlyPreviewTreeFilter.rows(this.index, this.searchQuery, this.expandedPaths);
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
    return (
      this.index?.entries.find((entry) => entry.relativePath === this.selectedRelativePath) || null
    );
  }
  get treeFocusRelativePath(): string {
    const rows = this.visibleRows;
    if (rows.some((row) => row.entry.relativePath === this.focusedRelativePath)) {
      return this.focusedRelativePath;
    }
    if (rows.some((row) => row.entry.relativePath === this.selectedRelativePath)) {
      return this.selectedRelativePath;
    }
    return rows[0]?.entry.relativePath || '';
  }
  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    this.subscribe();
    if (!onlyPreviewEnv.hostToken || !onlyPreviewEnv.hostId) {
      this.errorMessage = onlyPreviewI18n.errors.HOST_NOT_FOUND;
      return;
    }

    const reportingRevision = this.beginCharacterCountTransition();
    try {
      await Promise.all([this.refreshSettings(), this.restoreWorkspace()]);
    } finally {
      this.resumeCharacterCountReporting(reportingRevision);
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
      this.errorMessage = errorMessage(error);
    } finally {
      this.targetLoading = false;
    }
  }
  async refresh(): Promise<void> {
    if (!this.workspace) return;
    const reportingRevision = this.beginCharacterCountTransition();
    try {
      await this.refreshIndex();
    } finally {
      this.resumeCharacterCountReporting(reportingRevision);
    }
  }
  async openSettings(): Promise<void> {
    const hostToken = onlyPreviewEnv.hostToken;
    if (!hostToken) return;
    try {
      unwrapOnlyPreviewResult(await onlyPreviewClient.openSettings({ hostToken }));
    } catch (error) {
      this.errorMessage = errorMessage(error);
    }
  }
  async openAgentSkillGuide(): Promise<void> {
    const hostToken = onlyPreviewEnv.hostToken;
    if (!hostToken) return;
    try {
      unwrapOnlyPreviewResult(await onlyPreviewClient.openAgentSkillGuide({ hostToken }));
    } catch (error) {
      this.errorMessage = errorMessage(error);
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
  setSearchQuery(value: string): void {
    if (!this.searchQuery.trim() && value.trim()) {
      onlyPreviewTreeFilter.begin(this.index, this.expandedPaths);
    } else if (!value.trim()) onlyPreviewTreeFilter.end(this.expandedPaths);
    this.searchQuery = value;
    this.focusedRelativePath = this.treeFocusRelativePath;
  }
  clearSearch(): void {
    this.setSearchQuery('');
  }
  getProjectSearchContext(): OnlyPreviewProjectSearchContext | null {
    const workspace = this.workspace;
    if (!workspace) return null;
    const focusedEntry = this.index?.entries.find(
      (entry) => entry.relativePath === this.focusedRelativePath
    );
    return {
      workspaceId: workspace.workspaceId,
      generation: this.searchWorkspaceGeneration,
      ready: this.projectionReady && !this.indexLoading,
      rootName: workspace.rootName,
      focusedRelativePath: focusedEntry?.relativePath || '',
      focusedNodeKind: focusedEntry?.nodeKind || null,
      selectedRelativePath: this.selectedRelativePath
    };
  }
  selectProjectSearchPath(relativePath: string): void {
    void this.selectFile(relativePath);
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
    onlyPreviewProjectSearchStore.exit();
    this.clearSearch();
    this.expandSelectedParents();
    await this.loadSelectedParentListings();
    if (!this.selectedEntry) return '';
    this.focusedRelativePath = this.selectedEntry.relativePath;
    return this.focusedRelativePath;
  }
  showFileContextMenu(entry: OnlyPreviewIndexEntry): Promise<void>;
  showFileContextMenu(relativePath: string): Promise<void>;
  async showFileContextMenu(entry: OnlyPreviewIndexEntry | string): Promise<void> {
    const hostToken = onlyPreviewEnv.hostToken;
    const workspace = this.workspace;
    if (typeof entry !== 'string' && entry.nodeKind !== 'file') return;
    const relativePath = typeof entry === 'string' ? entry : entry.relativePath;
    if (!hostToken || !workspace || !relativePath) return;
    try {
      unwrapOnlyPreviewResult(
        await onlyPreviewClient.showFileContextMenu({
          hostToken,
          workspaceId: workspace.workspaceId,
          relativePath
        })
      );
    } catch (error) {
      this.errorMessage = errorMessage(error);
    }
  }
  moveTreeFocus(
    key: 'ArrowDown' | 'ArrowUp' | 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End'
  ): string {
    const rows = this.visibleRows;
    if (!rows.length) return '';
    const currentPath = this.treeFocusRelativePath;
    const currentIndex = Math.max(
      0,
      rows.findIndex((row) => row.entry.relativePath === currentPath)
    );
    const current = rows[currentIndex];
    let nextPath = current.entry.relativePath;

    if (key === 'ArrowDown') {
      nextPath = rows[Math.min(rows.length - 1, currentIndex + 1)].entry.relativePath;
    } else if (key === 'ArrowUp') {
      nextPath = rows[Math.max(0, currentIndex - 1)].entry.relativePath;
    } else if (key === 'Home') {
      nextPath = rows[0].entry.relativePath;
    } else if (key === 'End') {
      nextPath = rows[rows.length - 1].entry.relativePath;
    } else if (key === 'ArrowRight' && current.entry.nodeKind === 'directory') {
      if (current.hasChildren && !current.expanded) {
        this.toggleDirectory(current.entry.relativePath);
      } else if (current.hasChildren) {
        const firstChild = rows[currentIndex + 1];
        if (firstChild && firstChild.depth > current.depth) {
          nextPath = firstChild.entry.relativePath;
        }
      }
    } else if (key === 'ArrowLeft') {
      if (current.entry.nodeKind === 'directory' && current.expanded) {
        this.expandedPaths.delete(current.entry.relativePath);
      } else if (current.entry.parentRelativePath) {
        const parent = rows.find(
          (row) => row.entry.relativePath === current.entry.parentRelativePath
        );
        if (parent) nextPath = parent.entry.relativePath;
      }
    }

    this.focusedRelativePath = nextPath;
    return nextPath;
  }

  handleTreeClick(entry: OnlyPreviewIndexEntry, clickCount: number): void {
    if (clickCount > 1) return;
    void this.activateEntry(entry, clickCount === 0);
  }

  handleTreeDoubleClick(entry: OnlyPreviewIndexEntry): void {
    if (entry.nodeKind !== 'file' || this.settings?.openFilesWithSingleClick) return;
    void this.activateEntry(entry, true);
  }

  activateFocusedEntry(): void {
    const entry = this.index?.entries.find(
      (candidate) => candidate.relativePath === this.focusedRelativePath
    );
    if (entry) void this.activateEntry(entry, true);
  }

  toggleDirectory(relativePath: string): void {
    if (this.expandedPaths.has(relativePath)) {
      this.expandedPaths.delete(relativePath);
    } else {
      this.expandedPaths.add(relativePath);
      void this.loadDirectory(relativePath);
    }
  }

  setProjectWidth(value: number): void {
    const maxWidth = Math.max(180, Math.min(480, window.innerWidth - 320));
    this.projectWidth = Math.round(Math.min(maxWidth, Math.max(180, value)));
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
      this.errorMessage = errorMessage(error);
    }
  }

  private subscribe(): void {
    onlyPreviewProjectSearchStore.subscribeToBatches();
    subscribeOnlyPreviewShellEvents(onlyPreviewEnv.hostId, {
      workspaceChanged: () => {
        const reportingRevision = this.beginCharacterCountTransition();
        void this.restoreWorkspace().finally(() => {
          this.resumeCharacterCountReporting(reportingRevision);
        });
      },
      selectionChanged: () => {
        const reportingRevision = this.beginCharacterCountTransition();
        void this.syncSelection().finally(() => {
          this.resumeCharacterCountReporting(reportingRevision);
        });
      },
      characterCountChanged: (characterCount) => {
        if (characterCount === 0) {
          this.selectedCharacterCount = 0;
          this.pendingCharacterCount = 0;
        } else if (
          this.selectedRelativePath &&
          this.characterCountGate.canAcceptCount(characterCount)
        ) {
          this.selectedCharacterCount = characterCount;
        } else if (this.characterCountGate.canBufferCount(characterCount)) {
          this.pendingCharacterCount = characterCount;
        }
      },
      characterCountReady: (revision) => this.characterCountGate.acceptReady(revision),
      previewControl: (revision) => {
        this.characterCountGate.beginTransition(revision);
        this.characterCountGate.resume(revision);
        this.selectedCharacterCount = 0;
        this.pendingCharacterCount = 0;
      },
      characterCountSyncRequested: () => this.syncCharacterCountTransition(),
      refresh: () => {
        const reportingRevision = this.beginCharacterCountTransition();
        void this.refreshIndex().finally(() => {
          this.resumeCharacterCountReporting(reportingRevision);
        });
      },
      browseListing: (listing) => this.applyBrowseListing(listing),
      searchProgress: (progress) => this.applySearchProgress(progress),
      searchSnapshot: (snapshot) => void this.applySearchSnapshot(snapshot),
      settingsChanged: () => void this.refreshSettings(),
      focusProject: () => {
        this.focusProjectRevision += 1;
      },
      focusSearch: () => {
        onlyPreviewProjectSearchStore.enter();
        this.focusSearchRevision += 1;
      }
    });
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
    onlyPreviewProjectSearchStore.suspendForIndex();
  }

  private async runWindowCommand(command: () => Promise<OnlyPreviewResult<void>>): Promise<void> {
    try {
      unwrapOnlyPreviewResult(await command());
    } catch (error) {
      this.errorMessage = errorMessage(error);
    }
  }

  private async restoreWorkspace(): Promise<void> {
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
        this.workspaceGeneration += 1;
        this.selectionGeneration += 1;
        this.searchWorkspaceGeneration += 1;
        onlyPreviewProjectSearchStore.resetForWorkspace();
        this.workspace = null;
        this.clearBrowseProjection();
        this.projectSearchMemory = null;
        this.indexLoading = false;
        this.indexProgressState = resetOnlyPreviewSearchProgress();
        this.selectedRelativePath = '';
        this.selectedCharacterCount = 0;
        return;
      }
      await this.applyWorkspace(workspace);
    } catch (error) {
      if (generation === this.restoreGeneration) this.errorMessage = errorMessage(error);
    }
  }

  private async applyWorkspace(workspace: OnlyPreviewWorkspace): Promise<void> {
    const generation = ++this.workspaceGeneration;
    this.selectionGeneration += 1;
    this.searchWorkspaceGeneration += 1;
    onlyPreviewProjectSearchStore.resetForWorkspace();
    this.workspace = workspace;
    this.clearBrowseProjection();
    this.projectSearchMemory = null;
    this.indexProgressState = resetOnlyPreviewSearchProgress();
    this.selectedCharacterCount = 0;
    this.selectedRelativePath = workspace.selectedRelativePath || '';
    this.focusedRelativePath = this.selectedRelativePath;
    this.expandSelectedParents();
    await this.initializeIndex();
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
      this.focusedRelativePath = this.selectedRelativePath;
      this.expandSelectedParents();
      await this.loadSelectedParentListings();
    } catch (error) {
      if (generation === this.restoreGeneration) this.errorMessage = errorMessage(error);
    }
  }

  private async initializeIndex(): Promise<void> {
    const hostToken = onlyPreviewEnv.hostToken;
    const workspace = this.workspace;
    if (!hostToken || !workspace) return;
    const workspaceId = workspace.workspaceId;
    const generation = this.searchWorkspaceGeneration;
    onlyPreviewProjectSearchStore.suspendForIndex();
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
        this.errorMessage = errorMessage(error);
        this.indexLoading = false;
        this.indexProgressState = settleOnlyPreviewSearchProgress(this.indexProgressState);
        onlyPreviewProjectSearchStore.stopWaitingForIndex();
      }
    }
  }

  private async refreshIndex(): Promise<void> {
    const hostToken = onlyPreviewEnv.hostToken;
    const workspace = this.workspace;
    if (!hostToken || !workspace) return;
    const workspaceId = workspace.workspaceId;
    const generation = this.searchWorkspaceGeneration;
    onlyPreviewProjectSearchStore.suspendForIndex();
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
        this.errorMessage = errorMessage(error);
        this.indexLoading = false;
        this.indexProgressState = settleOnlyPreviewSearchProgress(this.indexProgressState);
        onlyPreviewProjectSearchStore.stopWaitingForIndex();
      }
    }
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
    this.projectSearchMemory = snapshot.memory;
    this.indexLoading = snapshot.state !== 'ready';
    if (snapshot.state !== 'ready') {
      onlyPreviewProjectSearchStore.suspendForIndex();
      return;
    }
    this.indexProgressState = settleOnlyPreviewSearchProgress(this.indexProgressState);
    onlyPreviewProjectSearchStore.resumeForReadyIndex();
    this.expandSelectedParents();
    await this.loadSelectedParentListings();
  }

  private applyBrowseListing(listing: OnlyPreviewBrowseListing): boolean {
    const context = this.browseProjectionContext();
    if (!context) return false;
    const result = this.browseProjection.applyListing(listing, context, this.expandedPaths);
    this.commitBrowseProjectionResult(result, context);
    if (listing.relativePath === '' && this.selectedRelativePath) {
      void this.loadSelectedParentListings();
    }
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
    if (
      result.error &&
      context.workspaceId === this.workspace?.workspaceId &&
      context.generation === this.searchWorkspaceGeneration
    ) {
      this.errorMessage = errorMessage(result.error);
    }
    if (!result.changed) return result.loaded;
    this.index = result.index;
    if (result.rootReplaced) this.expandSelectedParents();
    return result.loaded;
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
      this.errorMessage = errorMessage(error);
    }
  }

  private async activateEntry(entry: OnlyPreviewIndexEntry, force: boolean): Promise<void> {
    this.focusedRelativePath = entry.relativePath;
    if (entry.nodeKind === 'directory') {
      this.toggleDirectory(entry.relativePath);
      return;
    }
    if (entry.nodeKind !== 'file') return;
    if (!force && !this.settings?.openFilesWithSingleClick) return;
    await this.selectFile(entry.relativePath);
  }

  private async selectFile(relativePath: string): Promise<void> {
    const hostToken = onlyPreviewEnv.hostToken;
    const workspace = this.workspace;
    if (!hostToken || !workspace) return;
    const generation = ++this.selectionGeneration;
    this.restoreGeneration += 1;
    this.rotateCharacterCountRevision();
    this.selectedRelativePath = relativePath;
    this.expandSelectedParents();
    try {
      unwrapOnlyPreviewResult(
        await onlyPreviewClient.selectStandaloneFile({
          hostToken,
          workspaceId: workspace.workspaceId,
          relativePath
        })
      );
    } catch (error) {
      if (generation !== this.selectionGeneration) return;
      await this.syncSelection();
      if (generation !== this.selectionGeneration) return;
      const recoveryRevision = this.beginCharacterCountTransition();
      this.resumeCharacterCountReporting(recoveryRevision);
      this.errorMessage = errorMessage(error);
    }
  }

  private expandSelectedParents(): void {
    let current = getOnlyPreviewParentPath(this.selectedRelativePath);
    while (current) {
      this.expandedPaths.add(current);
      current = getOnlyPreviewParentPath(current);
    }
  }

  private beginCharacterCountTransition(): string {
    const hostId = onlyPreviewEnv.hostId;
    if (!hostId) return '';
    const revision = this.rotateCharacterCountRevision();
    if (!revision) return '';
    xpcRenderer.broadcast(ONLY_PREVIEW_CHARACTER_COUNT_TRANSITION_EVENT, {
      hostId,
      revision
    });
    return revision;
  }

  private rotateCharacterCountRevision(): string {
    const revision = crypto.randomUUID();
    if (!this.characterCountGate.beginTransition(revision)) return '';
    this.selectedCharacterCount = 0;
    this.pendingCharacterCount = 0;
    return revision;
  }

  private resumeCharacterCountReporting(reportingRevision: string): void {
    if (!this.characterCountGate.resume(reportingRevision)) return;
    if (this.selectedRelativePath && this.pendingCharacterCount > 0) {
      this.selectedCharacterCount = this.pendingCharacterCount;
    }
    this.pendingCharacterCount = 0;
  }

  private syncCharacterCountTransition(): void {
    if (!this.characterCountGate.isSuspended()) {
      const reportingRevision = this.beginCharacterCountTransition();
      this.resumeCharacterCountReporting(reportingRevision);
      return;
    }
    const hostId = onlyPreviewEnv.hostId;
    const revision = this.characterCountGate.revisionForSync();
    if (!hostId || !revision) return;
    xpcRenderer.broadcast(ONLY_PREVIEW_CHARACTER_COUNT_TRANSITION_EVENT, {
      hostId,
      revision
    });
  }
}

export const onlyPreviewShellStore = reactive<OnlyPreviewShellStore>(new OnlyPreviewShellStore());

onlyPreviewProjectSearchStore.configure(
  () => onlyPreviewShellStore.getProjectSearchContext(),
  (relativePath) => onlyPreviewShellStore.selectProjectSearchPath(relativePath)
);
