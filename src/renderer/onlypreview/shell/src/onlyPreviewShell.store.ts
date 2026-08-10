import { reactive } from 'vue';
import { xpcRenderer } from 'electron-xpc/renderer';
import {
  OnlyPreviewContractError,
  unwrapOnlyPreviewResult
} from '@shared/onlypreview/onlyPreview.contract';
import {
  ONLY_PREVIEW_CHARACTER_COUNT_CHANGED_EVENT,
  ONLY_PREVIEW_CHARACTER_COUNT_READY_EVENT,
  ONLY_PREVIEW_CHARACTER_COUNT_SYNC_REQUEST_EVENT,
  ONLY_PREVIEW_CHARACTER_COUNT_TRANSITION_EVENT,
  ONLY_PREVIEW_REFRESH_EVENT,
  ONLY_PREVIEW_FOCUS_PROJECT_EVENT,
  ONLY_PREVIEW_FOCUS_SEARCH_EVENT,
  ONLY_PREVIEW_INDEX_PROGRESS_EVENT,
  ONLY_PREVIEW_MAX_INDEX_ENTRIES,
  ONLY_PREVIEW_SELECTION_CHANGED_EVENT,
  ONLY_PREVIEW_SETTINGS_CHANGED_EVENT,
  ONLY_PREVIEW_WORKSPACE_CHANGED_EVENT,
  type OnlyPreviewBounds,
  type OnlyPreviewCharacterCountEvent,
  type OnlyPreviewCharacterCountRevisionEvent,
  type OnlyPreviewIndex,
  type OnlyPreviewIndexEntry,
  type OnlyPreviewIndexProgressEvent,
  type OnlyPreviewResult,
  type OnlyPreviewSettings,
  type OnlyPreviewWorkspace
} from '@shared/onlypreview/onlyPreview.types';
import { onlyPreviewClient } from '../../common/onlyPreviewClient';
import { onlyPreviewEnv } from '../../common/contextBridge/onlyPreviewEnv.bridge';
import { getOnlyPreviewErrorMessage, onlyPreviewI18n } from '../../common/onlyPreviewI18n';
import { OnlyPreviewCharacterCountHostGate } from '../../common/onlyPreviewCharacterCountGate.service';
import type { OnlyPreviewTreeRow } from './onlyPreviewShell.type';

const isHostEvent = (value: unknown): value is { hostId: string } =>
  !!value &&
  typeof value === 'object' &&
  typeof (value as Record<string, unknown>).hostId === 'string';

const isCharacterCountEvent = (value: unknown): value is OnlyPreviewCharacterCountEvent => {
  if (!value || typeof value !== 'object') return false;
  const event = value as Record<string, unknown>;
  const keys = Object.keys(event);
  return (
    keys.length === 2 &&
    keys.includes('hostId') &&
    keys.includes('characterCount') &&
    typeof event.hostId === 'string' &&
    Number.isSafeInteger(event.characterCount) &&
    (event.characterCount as number) >= 0
  );
};

const isCharacterCountRevisionEvent = (
  value: unknown
): value is OnlyPreviewCharacterCountRevisionEvent => {
  if (!value || typeof value !== 'object') return false;
  const event = value as Record<string, unknown>;
  return (
    Object.keys(event).length === 2 &&
    typeof event.hostId === 'string' &&
    typeof event.revision === 'string' &&
    event.revision.length > 0 &&
    event.revision.length <= 128
  );
};

const isExactHostEvent = (value: unknown): value is { hostId: string } => {
  if (!value || typeof value !== 'object') return false;
  const event = value as Record<string, unknown>;
  return Object.keys(event).length === 1 && typeof event.hostId === 'string';
};

const isIndexProgressEvent = (value: unknown): value is OnlyPreviewIndexProgressEvent => {
  if (!value || typeof value !== 'object') return false;
  const event = value as Record<string, unknown>;
  if (
    typeof event.hostId !== 'string' ||
    typeof event.indexRevision !== 'string' ||
    event.indexRevision.length === 0 ||
    event.indexRevision.length > 128
  ) {
    return false;
  }
  if (event.phase === 'counting') {
    return Object.keys(event).length === 3;
  }
  return (
    event.phase === 'indexing' &&
    Object.keys(event).length === 5 &&
    Number.isSafeInteger(event.completed) &&
    Number.isSafeInteger(event.total) &&
    (event.completed as number) >= 0 &&
    (event.total as number) >= 0 &&
    (event.completed as number) <= (event.total as number) &&
    (event.total as number) <= ONLY_PREVIEW_MAX_INDEX_ENTRIES
  );
};

type OnlyPreviewShellIndexProgress =
  | { phase: 'counting' }
  | { phase: 'indexing'; completed: number; total: number };

const errorMessage = (error: unknown): string => {
  if (error instanceof OnlyPreviewContractError) {
    return getOnlyPreviewErrorMessage(error.code);
  }
  return onlyPreviewI18n.errors.OPERATION_FAILED;
};

const parentPath = (relativePath: string): string => {
  const separator = relativePath.lastIndexOf('/');
  return separator < 0 ? '' : relativePath.slice(0, separator);
};

class OnlyPreviewShellStore {
  workspace: OnlyPreviewWorkspace | null = null;
  index: OnlyPreviewIndex | null = null;
  settings: OnlyPreviewSettings | null = null;
  searchQuery = '';
  selectedRelativePath = '';
  selectedCharacterCount = 0;
  focusedRelativePath = '';
  expandedPaths = new Set<string>();
  projectWidth = 264;
  indexLoading = false;
  indexProgress: OnlyPreviewShellIndexProgress | null = null;
  targetLoading = false;
  errorMessage = '';
  focusProjectRevision = 0;
  focusSearchRevision = 0;
  private initialized = false;
  private projectionGeneration = 0;
  private restoreGeneration = 0;
  private workspaceGeneration = 0;
  private selectionGeneration = 0;
  private currentIndexRevision = '';
  private readonly directoryListings = new Map<string, OnlyPreviewIndexEntry[]>();
  private readonly directoryLoadGenerationByPath = new Map<string, number>();
  private readonly characterCountGate = new OnlyPreviewCharacterCountHostGate();
  private pendingCharacterCount = 0;

  get visibleRows(): OnlyPreviewTreeRow[] {
    const query = this.searchQuery.trim().toLocaleLowerCase();
    if (!query) return this.browseRows;
    if (!this.index) return [];
    const entriesByParent = new Map<string, OnlyPreviewIndexEntry[]>();
    for (const entry of this.index.entries) {
      const siblings = entriesByParent.get(entry.parentRelativePath) || [];
      siblings.push(entry);
      entriesByParent.set(entry.parentRelativePath, siblings);
    }

    const included = new Set<string>();
    for (const entry of this.index.entries) {
      if (
        !entry.name.toLocaleLowerCase().includes(query) &&
        !entry.relativePath.toLocaleLowerCase().includes(query)
      ) {
        continue;
      }
      let current = entry.relativePath;
      while (current) {
        included.add(current);
        current = parentPath(current);
      }
    }

    const rows: OnlyPreviewTreeRow[] = [];
    const visit = (parent: string, depth: number): void => {
      const children = entriesByParent.get(parent) || [];
      for (const entry of children) {
        if (!included.has(entry.relativePath)) continue;
        const hasChildren =
          entry.nodeKind === 'directory' &&
          (entriesByParent.get(entry.relativePath) || []).some((child) =>
            included.has(child.relativePath)
          );
        const expanded = entry.nodeKind === 'directory' && hasChildren;
        rows.push({ entry, depth, expanded, hasChildren });
        if (entry.nodeKind === 'directory' && expanded) {
          visit(entry.relativePath, depth + 1);
        }
      }
    };
    visit('', 0);
    return rows;
  }

  private get browseRows(): OnlyPreviewTreeRow[] {
    const rows: OnlyPreviewTreeRow[] = [];
    const visit = (parentRelativePath: string, depth: number): void => {
      for (const entry of this.directoryListings.get(parentRelativePath) || []) {
        const loadedChildren = this.directoryListings.get(entry.relativePath);
        const hasChildren =
          entry.nodeKind === 'directory' &&
          (loadedChildren === undefined || loadedChildren.length > 0);
        const expanded =
          entry.nodeKind === 'directory' && this.expandedPaths.has(entry.relativePath);
        rows.push({ entry, depth, expanded, hasChildren });
        if (expanded && loadedChildren) visit(entry.relativePath, depth + 1);
      }
    };
    visit('', 0);
    return rows;
  }

  get projectionReady(): boolean {
    return this.searchQuery.trim() ? this.index !== null : this.directoryListings.has('');
  }

  get indexProgressRatio(): number {
    if (this.indexProgress?.phase !== 'indexing') return 0;
    if (this.indexProgress.total === 0) return 1;
    return Math.min(1, Math.max(0, this.indexProgress.completed / this.indexProgress.total));
  }

  get selectedEntry(): OnlyPreviewIndexEntry | null {
    return this.findEntry(this.selectedRelativePath);
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
      await this.reloadWorkspaceProjection();
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
    this.searchQuery = value;
    this.focusedRelativePath = this.treeFocusRelativePath;
  }

  clearSearch(): void {
    this.searchQuery = '';
    this.focusedRelativePath = this.treeFocusRelativePath;
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
    if (!this.selectedEntry) return '';
    this.searchQuery = '';
    this.expandSelectedParents();
    await this.loadSelectedParentListings();
    this.focusedRelativePath = this.selectedEntry.relativePath;
    return this.focusedRelativePath;
  }

  async showFileContextMenu(entry: OnlyPreviewIndexEntry): Promise<void> {
    const hostToken = onlyPreviewEnv.hostToken;
    const workspace = this.workspace;
    if (!hostToken || !workspace || entry.nodeKind !== 'file') return;
    try {
      unwrapOnlyPreviewResult(
        await onlyPreviewClient.showFileContextMenu({
          hostToken,
          workspaceId: workspace.workspaceId,
          relativePath: entry.relativePath
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
        this.expandedPaths.add(current.entry.relativePath);
        void this.loadDirectory(current.entry.relativePath);
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
    const entry = this.findEntry(this.focusedRelativePath);
    if (entry) void this.activateEntry(entry, true);
  }

  async toggleDirectory(relativePath: string): Promise<void> {
    if (this.expandedPaths.has(relativePath)) {
      this.expandedPaths.delete(relativePath);
    } else {
      this.expandedPaths.add(relativePath);
      await this.loadDirectory(relativePath);
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
    xpcRenderer.subscribe(ONLY_PREVIEW_WORKSPACE_CHANGED_EVENT, (payload) => {
      if (isHostEvent(payload.params) && payload.params.hostId === onlyPreviewEnv.hostId) {
        const reportingRevision = this.beginCharacterCountTransition();
        void this.restoreWorkspace().finally(() => {
          this.resumeCharacterCountReporting(reportingRevision);
        });
      }
    });
    xpcRenderer.subscribe(ONLY_PREVIEW_SELECTION_CHANGED_EVENT, (payload) => {
      if (isHostEvent(payload.params) && payload.params.hostId === onlyPreviewEnv.hostId) {
        const reportingRevision = this.beginCharacterCountTransition();
        void this.syncSelection().finally(() => {
          this.resumeCharacterCountReporting(reportingRevision);
        });
      }
    });
    xpcRenderer.subscribe(ONLY_PREVIEW_CHARACTER_COUNT_CHANGED_EVENT, (payload) => {
      if (
        isCharacterCountEvent(payload.params) &&
        payload.params.hostId === onlyPreviewEnv.hostId
      ) {
        if (payload.params.characterCount === 0) {
          this.selectedCharacterCount = 0;
          this.pendingCharacterCount = 0;
        } else if (
          this.selectedRelativePath &&
          this.characterCountGate.canAcceptCount(payload.params.characterCount)
        ) {
          this.selectedCharacterCount = payload.params.characterCount;
        } else if (this.characterCountGate.canBufferCount(payload.params.characterCount)) {
          this.pendingCharacterCount = payload.params.characterCount;
        }
      }
    });
    xpcRenderer.subscribe(ONLY_PREVIEW_CHARACTER_COUNT_READY_EVENT, (payload) => {
      if (
        isCharacterCountRevisionEvent(payload.params) &&
        payload.params.hostId === onlyPreviewEnv.hostId
      ) {
        this.characterCountGate.acceptReady(payload.params.revision);
      }
    });
    xpcRenderer.subscribe(ONLY_PREVIEW_CHARACTER_COUNT_SYNC_REQUEST_EVENT, (payload) => {
      if (isExactHostEvent(payload.params) && payload.params.hostId === onlyPreviewEnv.hostId) {
        this.syncCharacterCountTransition();
      }
    });
    xpcRenderer.subscribe(ONLY_PREVIEW_REFRESH_EVENT, (payload) => {
      if (isHostEvent(payload.params) && payload.params.hostId === onlyPreviewEnv.hostId) {
        const reportingRevision = this.beginCharacterCountTransition();
        void this.reloadWorkspaceProjection().finally(() => {
          this.resumeCharacterCountReporting(reportingRevision);
        });
      }
    });
    xpcRenderer.subscribe(ONLY_PREVIEW_SETTINGS_CHANGED_EVENT, () => {
      void this.refreshSettings();
    });
    xpcRenderer.subscribe(ONLY_PREVIEW_INDEX_PROGRESS_EVENT, (payload) => {
      if (
        !isIndexProgressEvent(payload.params) ||
        payload.params.hostId !== onlyPreviewEnv.hostId ||
        payload.params.indexRevision !== this.currentIndexRevision
      ) {
        return;
      }
      if (payload.params.phase === 'counting') {
        if (this.indexProgress?.phase === 'indexing') return;
        this.indexProgress = { phase: 'counting' };
        return;
      }
      const previous = this.indexProgress;
      if (
        previous?.phase === 'indexing' &&
        (payload.params.total !== previous.total ||
          payload.params.completed < previous.completed)
      ) {
        return;
      }
      this.indexProgress = {
        phase: 'indexing',
        completed: payload.params.completed,
        total: payload.params.total
      };
    });
    xpcRenderer.subscribe(ONLY_PREVIEW_FOCUS_PROJECT_EVENT, (payload) => {
      if (isHostEvent(payload.params) && payload.params.hostId === onlyPreviewEnv.hostId) {
        this.focusProjectRevision += 1;
      }
    });
    xpcRenderer.subscribe(ONLY_PREVIEW_FOCUS_SEARCH_EVENT, (payload) => {
      if (isHostEvent(payload.params) && payload.params.hostId === onlyPreviewEnv.hostId) {
        this.focusSearchRevision += 1;
      }
    });
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
        this.projectionGeneration += 1;
        this.selectionGeneration += 1;
        this.workspace = null;
        this.index = null;
        this.directoryListings.clear();
        this.directoryLoadGenerationByPath.clear();
        this.expandedPaths.clear();
        this.indexLoading = false;
        this.currentIndexRevision = '';
        this.indexProgress = null;
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
    this.workspace = workspace;
    this.index = null;
    this.expandedPaths.clear();
    this.selectedCharacterCount = 0;
    this.selectedRelativePath = workspace.selectedRelativePath || '';
    this.focusedRelativePath = this.selectedRelativePath;
    this.expandSelectedParents();
    await this.reloadWorkspaceProjection();
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

  private async reloadWorkspaceProjection(): Promise<void> {
    const hostToken = onlyPreviewEnv.hostToken;
    const workspace = this.workspace;
    if (!hostToken || !workspace) return;
    const workspaceId = workspace.workspaceId;
    const generation = ++this.projectionGeneration;
    const indexRevision = crypto.randomUUID();
    this.currentIndexRevision = indexRevision;
    this.indexProgress = null;
    this.directoryListings.clear();
    this.directoryLoadGenerationByPath.clear();
    this.expandedPaths.clear();
    this.indexLoading = true;
    this.errorMessage = '';
    try {
      const rootLoaded = await this.loadDirectory('', generation);
      if (
        !rootLoaded ||
        generation !== this.projectionGeneration ||
        workspaceId !== this.workspace?.workspaceId
      ) {
        return;
      }
      await this.loadSelectedParentListings(generation);
      if (
        generation !== this.projectionGeneration ||
        workspaceId !== this.workspace?.workspaceId
      ) {
        return;
      }
      const nextIndex = unwrapOnlyPreviewResult(
        await onlyPreviewClient.buildIndex({
          hostToken,
          workspaceId,
          indexRevision
        })
      );
      if (
        generation !== this.projectionGeneration ||
        workspaceId !== this.workspace?.workspaceId
      ) {
        return;
      }
      this.index = nextIndex;
      this.expandSelectedParents();
    } catch (error) {
      if (generation === this.projectionGeneration) this.errorMessage = errorMessage(error);
    } finally {
      if (
        generation === this.projectionGeneration &&
        indexRevision === this.currentIndexRevision
      ) {
        this.indexLoading = false;
        this.currentIndexRevision = '';
        this.indexProgress = null;
      }
    }
  }

  private async loadDirectory(
    relativePath: string,
    generation = this.projectionGeneration
  ): Promise<boolean> {
    const hostToken = onlyPreviewEnv.hostToken;
    const workspace = this.workspace;
    if (!hostToken || !workspace) return false;
    if (this.directoryListings.has(relativePath)) return true;
    if (this.directoryLoadGenerationByPath.get(relativePath) === generation) return false;
    const workspaceId = workspace.workspaceId;
    this.directoryLoadGenerationByPath.set(relativePath, generation);
    try {
      const listing = unwrapOnlyPreviewResult(
        await onlyPreviewClient.listDirectory({
          hostToken,
          workspaceId,
          relativePath
        })
      );
      if (
        generation !== this.projectionGeneration ||
        workspaceId !== this.workspace?.workspaceId ||
        listing.workspaceId !== workspaceId ||
        listing.relativePath !== relativePath
      ) {
        return false;
      }
      this.directoryListings.set(relativePath, listing.entries);
      return true;
    } catch (error) {
      if (
        generation === this.projectionGeneration &&
        workspaceId === this.workspace?.workspaceId
      ) {
        this.errorMessage = errorMessage(error);
      }
      return false;
    } finally {
      if (this.directoryLoadGenerationByPath.get(relativePath) === generation) {
        this.directoryLoadGenerationByPath.delete(relativePath);
      }
    }
  }

  private async refreshSettings(): Promise<void> {
    const hostToken = onlyPreviewEnv.hostToken;
    if (!hostToken) return;
    const previousShowHidden = this.settings?.showHiddenFiles;
    try {
      const settings = unwrapOnlyPreviewResult(await onlyPreviewClient.getSettings({ hostToken }));
      this.settings = settings;
      if (
        previousShowHidden !== undefined &&
        previousShowHidden !== settings.showHiddenFiles &&
        this.workspace
      ) {
        await this.reloadWorkspaceProjection();
      }
    } catch (error) {
      this.errorMessage = errorMessage(error);
    }
  }

  private async loadSelectedParentListings(
    generation = this.projectionGeneration
  ): Promise<void> {
    const parents: string[] = [];
    let current = parentPath(this.selectedRelativePath);
    while (current) {
      parents.unshift(current);
      current = parentPath(current);
    }
    for (const relativePath of parents) {
      if (
        generation !== this.projectionGeneration ||
        !this.workspace
      ) {
        return;
      }
      this.expandedPaths.add(relativePath);
      await this.loadDirectory(relativePath, generation);
    }
  }

  private async activateEntry(entry: OnlyPreviewIndexEntry, force: boolean): Promise<void> {
    this.focusedRelativePath = entry.relativePath;
    if (entry.nodeKind === 'directory') {
      await this.toggleDirectory(entry.relativePath);
      return;
    }
    if (entry.nodeKind !== 'file') return;
    if (!force && !this.settings?.openFilesWithSingleClick) return;
    await this.selectFile(entry.relativePath);
  }

  private findEntry(relativePath: string): OnlyPreviewIndexEntry | null {
    if (!relativePath) return null;
    for (const entries of this.directoryListings.values()) {
      const entry = entries.find((candidate) => candidate.relativePath === relativePath);
      if (entry) return entry;
    }
    return this.index?.entries.find((entry) => entry.relativePath === relativePath) || null;
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
    let current = parentPath(this.selectedRelativePath);
    while (current) {
      this.expandedPaths.add(current);
      current = parentPath(current);
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
