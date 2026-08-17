import { reactive } from 'vue';
import { XpcRendererHandler } from 'electron-xpc/renderer';
import {
  createEmptySubmodulesSnapshot,
  type SubmoduleEntry,
  type SubmodulesSnapshot,
  type SubmodulesStoreApi
} from '@shared/submodules/submodules.type';
import { submodulesEmitter, submodulesSystemEmitter } from '../emitter/submodules.emitter';
import { describeOpenError, describeScanError } from '../services/submoduleMessage.service';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';

class SubmodulesState {
  snapshot: SubmodulesSnapshot = createEmptySubmodulesSnapshot();
  loading = false;
  choosing = false;
  openingPath: string | null = null;
  actionError: string | null = null;

  get entries(): SubmoduleEntry[] {
    return this.snapshot.entries;
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
    if (this.openingPath) return;
    this.openingPath = entry.absolutePath;
    this.actionError = null;
    try {
      const result = await submodulesSystemEmitter.openInWebStorm({ path: entry.absolutePath });
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

  dismissActionError(): void {
    this.actionError = null;
  }
}

export const submodulesStore = reactive<SubmodulesState>(new SubmodulesState());

export class SubmodulesStoreHandler extends XpcRendererHandler implements SubmodulesStoreApi {
  async onSnapshot(params: SubmodulesSnapshot): Promise<void> {
    submodulesStore.applySnapshot(params);
  }
}

new SubmodulesStoreHandler();
