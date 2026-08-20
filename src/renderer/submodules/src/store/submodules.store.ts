import { reactive } from 'vue';
import { xpcRenderer } from 'electron-xpc/renderer';
import {
  SUBMODULES_SNAPSHOT_EVENT,
  createEmptySubmodulesSnapshot,
  submoduleDisplayName,
  type SubmoduleEntry,
  type SubmodulesSnapshot,
  type SubmodulesSortMode,
  type SubmodulesViewSettings
} from '@shared/submodules/submodules.type';
import { submodulesEmitter, submodulesSystemEmitter } from '../emitter/submodules.emitter';
import { describeOpenError, describeScanError } from '../services/submoduleMessage.service';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';

/** Same shape as the EyesOnAgents title filter: NFKC, case-folded, split on path/word separators. */
const SEARCH_SEPARATOR_PATTERN = /[\s\-_./\\:|]+/u;

const searchTokens = (value: string): string[] =>
  value.normalize('NFKC').toLocaleLowerCase().split(SEARCH_SEPARATOR_PATTERN).filter(Boolean);

class SubmodulesState {
  snapshot: SubmodulesSnapshot = createEmptySubmodulesSnapshot();
  loading = false;
  choosing = false;
  openingPath: string | null = null;
  actionError: string | null = null;
  /** Live filter over the visible rows. Deliberately not persisted: it is a lookup, not a setting. */
  search = '';

  /** Main-ordered rows: mismatch-first when enabled, then by name or by newest change. */
  get entries(): SubmoduleEntry[] {
    return this.snapshot.entries;
  }

  get settings(): SubmodulesViewSettings {
    return this.snapshot.settings;
  }

  /**
   * Every query token must appear in the row's name or declared path. Ordering is Main's, so the
   * filter only removes rows — a 30-row list needs no throttling.
   */
  get visibleEntries(): SubmoduleEntry[] {
    const tokens = searchTokens(this.search);
    if (!tokens.length) return this.entries;
    return this.entries.filter((entry) => {
      const haystack = searchTokens(`${submoduleDisplayName(entry)} ${entry.path}`);
      return tokens.every((token) => haystack.some((part) => part.includes(token)));
    });
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
