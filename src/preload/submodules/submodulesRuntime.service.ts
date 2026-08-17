// The Submodules runtime: it reads the inventory, watches the working copies, persists the watched
// root in Core SQLite, and pushes a snapshot to the renderer whenever the observed state changes.
// The XPC handler is a thin facade over this service, so only the four API methods are exposed.
import { createXpcPreloadEmitter } from 'electron-xpc/preload';
import type { SettingDao } from '@preload/sqlite/dao/setting.dao';
import {
  SUBMODULES_DEBOUNCE_MS,
  SUBMODULES_POLL_INTERVAL_MS,
  SUBMODULES_SETTING_KEY,
  SUBMODULES_SETTING_SUB_KEY,
  SUBMODULES_STORE_HANDLER_NAME,
  createEmptySubmodulesSnapshot,
  type SubmodulesSnapshot,
  type SubmodulesStoreApi
} from '@shared/submodules/submodules.type';
import { collectWatchTargets, scanSubmodules } from './submoduleScanner.service';
import { SubmoduleWatcher } from './submoduleWatcher.service';

interface PersistedWorkspace {
  rootPath: string;
}

const settingEmitter = createXpcPreloadEmitter<SettingDao>('SettingDao') as SettingDao;
const storeEmitter = createXpcPreloadEmitter<SubmodulesStoreApi>(SUBMODULES_STORE_HANDLER_NAME);

/** Snapshot identity for change detection: the scan timestamp must not count as a change. */
const snapshotFingerprint = (snapshot: SubmodulesSnapshot): string =>
  JSON.stringify({
    rootPath: snapshot.rootPath,
    watching: snapshot.watching,
    error: snapshot.error,
    entries: snapshot.entries
  });

class SubmodulesRuntime {
  private rootPath: string | null = null;
  private fingerprint = snapshotFingerprint(createEmptySubmodulesSnapshot());
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private readonly watcher = new SubmoduleWatcher({ onChange: () => this.scheduleRescan() });

  async restore(): Promise<SubmodulesSnapshot> {
    const persisted = await this.loadPersistedRoot();
    if (!persisted) return this.publish(createEmptySubmodulesSnapshot());
    this.rootPath = persisted;
    return this.rescan();
  }

  async open(rootPath: string): Promise<SubmodulesSnapshot> {
    this.rootPath = rootPath;
    await settingEmitter
      .upsert({
        key: SUBMODULES_SETTING_KEY,
        sub_key: SUBMODULES_SETTING_SUB_KEY,
        value: { rootPath } satisfies PersistedWorkspace
      })
      .catch((error) => {
        console.error('[submodules] failed to persist the watched root:', error);
      });
    return this.rescan();
  }

  async forget(): Promise<SubmodulesSnapshot> {
    this.rootPath = null;
    this.stopWatching();
    await settingEmitter
      .upsert({
        key: SUBMODULES_SETTING_KEY,
        sub_key: SUBMODULES_SETTING_SUB_KEY,
        value: null
      })
      .catch((error) => {
        console.error('[submodules] failed to clear the watched root:', error);
      });
    return this.publish(createEmptySubmodulesSnapshot());
  }

  rescan(): SubmodulesSnapshot {
    if (!this.rootPath) return this.publish(createEmptySubmodulesSnapshot());

    const scanned = scanSubmodules(this.rootPath);
    this.watcher.retarget(scanned.error ? [] : collectWatchTargets(scanned));
    this.startPolling();
    return this.publish({ ...scanned, watching: this.watcher.active });
  }

  private async loadPersistedRoot(): Promise<string | null> {
    const stored = await settingEmitter
      .get<PersistedWorkspace | null>({
        key: SUBMODULES_SETTING_KEY,
        sub_key: SUBMODULES_SETTING_SUB_KEY
      })
      .catch((error) => {
        console.error('[submodules] failed to read the persisted root:', error);
        return null;
      });
    const rootPath = stored?.rootPath;
    return typeof rootPath === 'string' && rootPath.trim() ? rootPath.trim() : null;
  }

  private scheduleRescan(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.rescan();
    }, SUBMODULES_DEBOUNCE_MS);
  }

  private startPolling(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      if (!this.rootPath) return;
      this.rescan();
    }, SUBMODULES_POLL_INTERVAL_MS);
  }

  private stopWatching(): void {
    this.watcher.close();
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /** Push to the renderer only when the observed state changed, so watcher bursts stay quiet. */
  private publish(snapshot: SubmodulesSnapshot): SubmodulesSnapshot {
    const fingerprint = snapshotFingerprint(snapshot);
    const changed = fingerprint !== this.fingerprint;
    this.fingerprint = fingerprint;
    if (changed) {
      void storeEmitter.onSnapshot(snapshot).catch(() => {
        // The renderer is not listening yet; it receives this state from its own call instead.
      });
    }
    return snapshot;
  }
}

export const submodulesRuntime = new SubmodulesRuntime();
