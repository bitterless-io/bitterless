import { reactive } from 'vue';
import { xpcRenderer } from 'electron-xpc/renderer';
import {
  SUBMODULES_SNAPSHOT_EVENT,
  createEmptySubmodulesSnapshot,
  type SubmoduleEntry,
  type SubmodulesSnapshot,
  type SubmodulesSortMode,
  type SubmodulesViewSettings
} from '@shared/submodules/submodules.type';
import { submodulesEmitter, submodulesSystemEmitter } from '../emitter/submodules.emitter';
import { describeOpenError, describeScanError } from '../services/submoduleMessage.service';
import {
  countEntries,
  countTreeRows,
  filterSubmoduleTree,
  searchTokens,
  type SubmoduleTreeRow
} from '../services/submoduleTree.service';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';

class SubmodulesState {
  snapshot: SubmodulesSnapshot = createEmptySubmodulesSnapshot();
  loading = false;
  choosing = false;
  openingPath: string | null = null;
  actionError: string | null = null;
  /** Live filter over the visible rows. Deliberately not persisted: it is a lookup, not a setting. */
  search = '';
  /** Absolute paths of the expanded parents. View state, so it survives snapshots but not restarts. */
  expandedPaths = new Set<string>();

  /** Main-ordered rows: mismatch-first when enabled, then by name or by newest change. */
  get entries(): SubmoduleEntry[] {
    return this.snapshot.entries;
  }

  get settings(): SubmodulesViewSettings {
    return this.snapshot.settings;
  }

  /**
   * The two-level list as rendered: search decides which rows survive, expansion decides which
   * children are shown. Ordering is Main's, so this only removes and nests — a 40-row list needs no
   * throttling.
   */
  get visibleTree(): SubmoduleTreeRow[] {
    return filterSubmoduleTree(this.entries, {
      query: this.search,
      expandedPaths: this.expandedPaths
    });
  }

  /** Rows on screen, parents and children alike. */
  get visibleCount(): number {
    return countTreeRows(this.visibleTree);
  }

  /** Every declared submodule, both levels. */
  get totalCount(): number {
    return countEntries(this.entries);
  }

  get isSearching(): boolean {
    return searchTokens(this.search).length > 0;
  }

  get scanError(): string | null {
    return this.snapshot.error ? describeScanError(this.snapshot.error) : null;
  }

  /**
   * electron-xpc resolves with `null` instead of rejecting when a handler throws or its target is
   * gone, so a reply is never trusted: the template dereferences `snapshot`, and storing a null
   * here would break every later render instead of showing the designed error state.
   */
  applySnapshot(snapshot: SubmodulesSnapshot | null): void {
    if (!snapshot || !Array.isArray(snapshot.entries)) {
      this.actionError = i18nHelper.submodules.error.scanFailed;
      return;
    }
    this.snapshot = snapshot;
  }

  async initialize(): Promise<void> {
    this.loading = true;
    try {
      this.applySnapshot(await submodulesEmitter.initialize());
    } catch (error) {
      console.error('[submodules] initialize failed:', error);
      this.actionError = i18nHelper.submodules.error.scanFailed;
    } finally {
      this.loading = false;
    }
  }

  async chooseRoot(): Promise<void> {
    if (this.choosing) return;
    this.choosing = true;
    this.actionError = null;
    try {
      const chosen = await submodulesSystemEmitter.chooseDirectory();
      if (!chosen) {
        this.actionError = i18nHelper.submodules.error.chooseFailed;
        return;
      }
      if (!chosen.path) return;
      this.loading = true;
      this.applySnapshot(await submodulesEmitter.setRoot({ rootPath: chosen.path }));
    } catch (error) {
      console.error('[submodules] choosing a directory failed:', error);
      this.actionError = i18nHelper.submodules.error.chooseFailed;
    } finally {
      this.choosing = false;
      this.loading = false;
    }
  }

  async refresh(): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    this.actionError = null;
    try {
      this.applySnapshot(await submodulesEmitter.refresh());
    } catch (error) {
      console.error('[submodules] refresh failed:', error);
      this.actionError = i18nHelper.submodules.error.scanFailed;
    } finally {
      this.loading = false;
    }
  }

  async openInWebStorm(entry: SubmoduleEntry): Promise<void> {
    // Main reveals the submodule inside the watched root instead of opening it as its own project,
    // so the root travels with the request; every entry comes from a scanned root, and the check is
    // what narrows it for the call.
    const { rootPath } = this.snapshot;
    if (this.openingPath || !rootPath) return;
    this.openingPath = entry.absolutePath;
    this.actionError = null;
    try {
      const result = await submodulesSystemEmitter.openInWebStorm({
        rootPath,
        path: entry.absolutePath
      });
      if (!result) {
        this.actionError = i18nHelper.submodules.error.ideNotFound;
        return;
      }
      if (!result.ok && result.errorCode) this.actionError = describeOpenError(result.errorCode);
    } catch (error) {
      console.error('[submodules] opening WebStorm failed:', error);
      this.actionError = i18nHelper.submodules.error.ideNotFound;
    } finally {
      this.openingPath = null;
    }
  }

  setSearch(value: string): void {
    this.search = value;
  }

  clearSearch(): void {
    this.search = '';
  }

  toggleExpanded(entry: SubmoduleEntry): void {
    if (this.expandedPaths.has(entry.absolutePath)) {
      this.expandedPaths.delete(entry.absolutePath);
      return;
    }
    this.expandedPaths.add(entry.absolutePath);
  }

  async setShowDiffOnTop(showDiffOnTop: boolean): Promise<void> {
    await this.updateViewSettings({ showDiffOnTop });
  }

  async setSortMode(sortMode: SubmodulesSortMode): Promise<void> {
    await this.updateViewSettings({ sortMode });
  }

  private async updateViewSettings(update: Partial<SubmodulesViewSettings>): Promise<void> {
    try {
      this.applySnapshot(await submodulesEmitter.updateViewSettings(update));
    } catch (error) {
      console.error('[submodules] updating the list controls failed:', error);
      this.actionError = i18nHelper.submodules.error.settingsFailed;
    }
  }

  dismissActionError(): void {
    this.actionError = null;
  }
}

export const submodulesStore = reactive<SubmodulesState>(new SubmodulesState());

// Main is the only writer of unsolicited state: it broadcasts a snapshot whenever the observed
// working copies changed, to this view and to every other Submodules view at the same time.
xpcRenderer.subscribe(SUBMODULES_SNAPSHOT_EVENT, (payload) => {
  submodulesStore.applySnapshot(payload.params as SubmodulesSnapshot | null);
});
