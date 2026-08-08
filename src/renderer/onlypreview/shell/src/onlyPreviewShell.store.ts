import { reactive } from 'vue';
import { xpcRenderer } from 'electron-xpc/renderer';
import {
  OnlyPreviewContractError,
  unwrapOnlyPreviewResult
} from '@shared/onlypreview/onlyPreview.contract';
import {
  ONLY_PREVIEW_REFRESH_EVENT,
  ONLY_PREVIEW_FOCUS_PROJECT_EVENT,
  ONLY_PREVIEW_FOCUS_SEARCH_EVENT,
  ONLY_PREVIEW_SELECTION_CHANGED_EVENT,
  ONLY_PREVIEW_SETTINGS_CHANGED_EVENT,
  ONLY_PREVIEW_WORKSPACE_CHANGED_EVENT,
  type OnlyPreviewBounds,
  type OnlyPreviewIndex,
  type OnlyPreviewIndexEntry,
  type OnlyPreviewSettings,
  type OnlyPreviewWorkspace
} from '@shared/onlypreview/onlyPreview.types';
import { onlyPreviewClient } from '../../common/onlyPreviewClient';
import { onlyPreviewEnv } from '../../common/contextBridge/onlyPreviewEnv.bridge';
import { getOnlyPreviewErrorMessage, onlyPreviewI18n } from '../../common/onlyPreviewI18n';
import type { OnlyPreviewTreeRow } from './onlyPreviewShell.type';

const isHostEvent = (value: unknown): value is { hostId: string } =>
  !!value &&
  typeof value === 'object' &&
  typeof (value as Record<string, unknown>).hostId === 'string';

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
  focusedRelativePath = '';
  expandedPaths = new Set<string>();
  projectWidth = 264;
  indexLoading = false;
  targetLoading = false;
  errorMessage = '';
  focusProjectRevision = 0;
  focusSearchRevision = 0;
  private initialized = false;
  private generation = 0;
  private restoreGeneration = 0;
  private workspaceGeneration = 0;
  private selectionGeneration = 0;

  get visibleRows(): OnlyPreviewTreeRow[] {
    if (!this.index) return [];
    const entriesByParent = new Map<string, OnlyPreviewIndexEntry[]>();
    for (const entry of this.index.entries) {
      const siblings = entriesByParent.get(entry.parentRelativePath) || [];
      siblings.push(entry);
      entriesByParent.set(entry.parentRelativePath, siblings);
    }

    const query = this.searchQuery.trim().toLocaleLowerCase();
    const included = new Set<string>();
    if (query) {
      for (const entry of this.index.entries) {
        if (!entry.relativePath.toLocaleLowerCase().includes(query)) continue;
        let current = entry.relativePath;
        while (current) {
          included.add(current);
          current = parentPath(current);
        }
      }
    }

    const rows: OnlyPreviewTreeRow[] = [];
    const visit = (parent: string, depth: number): void => {
      const children = entriesByParent.get(parent) || [];
      for (const entry of children) {
        if (query && !included.has(entry.relativePath)) continue;
        const hasChildren =
          entry.nodeKind === 'directory' &&
          (entriesByParent.get(entry.relativePath)?.length || 0) > 0;
        const expanded = query ? true : this.expandedPaths.has(entry.relativePath);
        rows.push({ entry, depth, expanded, hasChildren });
        if (entry.nodeKind === 'directory' && expanded) {
          visit(entry.relativePath, depth + 1);
        }
      }
    };
    visit('', 0);
    return rows;
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

    await Promise.all([this.refreshSettings(), this.restoreWorkspace()]);
  }

  async chooseFile(): Promise<void> {
    await this.chooseTarget('file');
  }

  async chooseFolder(): Promise<void> {
    await this.chooseTarget('directory');
  }

  async refresh(): Promise<void> {
    if (!this.workspace) return;
    await this.buildIndex();
    if (onlyPreviewEnv.hostId) {
      xpcRenderer.broadcast(ONLY_PREVIEW_REFRESH_EVENT, { hostId: onlyPreviewEnv.hostId });
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
        void this.restoreWorkspace();
      }
    });
    xpcRenderer.subscribe(ONLY_PREVIEW_SELECTION_CHANGED_EVENT, (payload) => {
      if (isHostEvent(payload.params) && payload.params.hostId === onlyPreviewEnv.hostId) {
        void this.syncSelection();
      }
    });
    xpcRenderer.subscribe(ONLY_PREVIEW_REFRESH_EVENT, (payload) => {
      if (isHostEvent(payload.params) && payload.params.hostId === onlyPreviewEnv.hostId) {
        void this.buildIndex();
      }
    });
    xpcRenderer.subscribe(ONLY_PREVIEW_SETTINGS_CHANGED_EVENT, () => {
      void this.refreshSettings();
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

  private async chooseTarget(kind: 'file' | 'directory'): Promise<void> {
    const hostToken = onlyPreviewEnv.hostToken;
    if (!hostToken || this.targetLoading) return;
    this.targetLoading = true;
    this.errorMessage = '';
    try {
      const workspace = unwrapOnlyPreviewResult(
        await onlyPreviewClient.chooseTarget({ hostToken, kind })
      );
      if (!workspace) return;
      // The workspace-change event is the single authoritative update path for both views.
    } catch (error) {
      this.errorMessage = errorMessage(error);
    } finally {
      this.targetLoading = false;
    }
  }

  private async restoreWorkspace(): Promise<void> {
    const hostToken = onlyPreviewEnv.hostToken;
    if (!hostToken) return;
    const generation = ++this.restoreGeneration;
    try {
      const workspace = unwrapOnlyPreviewResult(
        await onlyPreviewClient.restoreWorkspace({ hostToken })
      );
      if (generation !== this.restoreGeneration) return;
      if (!workspace) {
        this.workspaceGeneration += 1;
        this.selectionGeneration += 1;
        this.workspace = null;
        this.index = null;
        this.selectedRelativePath = '';
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
    this.selectedRelativePath = workspace.selectedRelativePath || '';
    this.focusedRelativePath = this.selectedRelativePath;
    this.expandSelectedParents();
    await this.buildIndex();
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
    } catch (error) {
      if (generation === this.restoreGeneration) this.errorMessage = errorMessage(error);
    }
  }

  private async buildIndex(): Promise<void> {
    const hostToken = onlyPreviewEnv.hostToken;
    const workspace = this.workspace;
    if (!hostToken || !workspace) return;
    const workspaceId = workspace.workspaceId;
    const selectedRelativePath = workspace.selectedRelativePath || '';
    const generation = ++this.generation;
    this.indexLoading = true;
    this.errorMessage = '';
    try {
      const nextIndex = unwrapOnlyPreviewResult(
        await onlyPreviewClient.buildIndex({
          hostToken,
          workspaceId
        })
      );
      if (generation !== this.generation || workspaceId !== this.workspace?.workspaceId) {
        return;
      }
      await this.includeExplicitSelection({
        hostToken,
        index: nextIndex,
        selectedRelativePath,
        workspaceId
      });
      if (
        generation !== this.generation ||
        workspaceId !== this.workspace?.workspaceId ||
        selectedRelativePath !== (this.workspace?.selectedRelativePath || '')
      ) {
        return;
      }
      this.index = nextIndex;
      this.expandSelectedParents();
      if (!this.expandedPaths.size) {
        for (const entry of nextIndex.entries) {
          if (entry.parentRelativePath === '' && entry.nodeKind === 'directory') {
            this.expandedPaths.add(entry.relativePath);
          }
        }
      }
    } catch (error) {
      if (generation === this.generation) this.errorMessage = errorMessage(error);
    } finally {
      if (generation === this.generation) this.indexLoading = false;
    }
  }

  private async includeExplicitSelection(params: {
    hostToken: string;
    index: OnlyPreviewIndex;
    selectedRelativePath: string;
    workspaceId: string;
  }): Promise<void> {
    const { hostToken, index, selectedRelativePath, workspaceId } = params;
    if (
      !selectedRelativePath ||
      index.entries.some((entry) => entry.relativePath === selectedRelativePath)
    )
      return;
    try {
      const descriptor = unwrapOnlyPreviewResult(
        await onlyPreviewClient.describeFile({
          hostToken,
          workspaceId,
          relativePath: selectedRelativePath
        })
      );
      index.entries.push({
        relativePath: selectedRelativePath,
        parentRelativePath: parentPath(selectedRelativePath),
        name: descriptor.name,
        nodeKind: 'file',
        size: descriptor.size,
        modifiedAt: descriptor.modifiedAt,
        previewHint: descriptor.kind
      });
    } catch {
      // The Preview surface reports the typed selection error; the index remains usable.
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
        await this.buildIndex();
      }
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
}

export const onlyPreviewShellStore = reactive<OnlyPreviewShellStore>(new OnlyPreviewShellStore());
