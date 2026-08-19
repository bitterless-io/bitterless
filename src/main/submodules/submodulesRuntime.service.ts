// The one Submodules runtime for the whole application. It lives in Main because every view — the
// standalone window and each Omni cell — must observe the same working copies without duplicating
// filesystem watches: it reads the inventory, watches it, persists the watched root in Core SQLite,
// and broadcasts a snapshot whenever the observed state changes. The XPC handler is a thin facade
// over this service, so only the four API methods are exposed.
import { createXpcMainEmitter, xpcMain } from 'electron-xpc/main';
import type { SettingDao } from '@preload/sqlite/dao/setting.dao';
import {
  SUBMODULES_DEBOUNCE_MS,
  SUBMODULES_POLL_INTERVAL_MS,
  SUBMODULES_SETTING_KEY,
  SUBMODULES_SETTING_SUB_KEY,
  SUBMODULES_SNAPSHOT_EVENT,
  createEmptySubmodulesSnapshot,
  type SubmodulesSnapshot
} from '@shared/submodules/submodules.type';
import { omniWindowHelper } from '@main/windows/omniWindow.helper';
import { submodulesWindowHandler } from '@main/xpc/submodulesWindow.handler';
import { collectWatchTargets, scanSubmodules } from './submoduleScanner.service';
import { SubmoduleWatcher } from './submoduleWatcher.service';

interface PersistedWorkspace {
  rootPath: string;
}

const settingEmitter = createXpcMainEmitter<SettingDao>('SettingDao') as SettingDao;

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
  private restorePromise: Promise<SubmodulesSnapshot> | null = null;
  private restored = false;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private readonly watcher = new SubmoduleWatcher({ onChange: () => this.scheduleRescan() });

  /**
   * Every view calls this when it mounts. Only the first call reads SQLite; a second view joins the
   * running runtime instead of restoring and rescanning the same root again.
   */
  async initialize(): Promise<SubmodulesSnapshot> {
    if (this.restored) return this.rescan();
    if (!this.restorePromise) {
      this.restorePromise = this.restore().finally(() => {
        this.restorePromise = null;
      });
    }
    return await this.restorePromise;
  }

  async open(rootPath: string): Promise<SubmodulesSnapshot> {
    this.rootPath = rootPath;
    this.restored = true;
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
    this.restored = true;
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

  private async restore(): Promise<SubmodulesSnapshot> {
    const persisted = await this.loadPersistedRoot();
    this.restored = true;
    if (!persisted) return this.publish(createEmptySubmodulesSnapshot());
    this.rootPath = persisted;
    return this.rescan();
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

  /**
   * The runtime outlives any single view, so watching must follow the views: with no Submodules
   * surface left there is nobody to broadcast to, and a recursive watcher plus interval would keep
   * running for the rest of the session. The persisted root survives and the next view re-arms it.
   */
  private hasLiveSurface(): boolean {
    return (
      submodulesWindowHandler._hasLiveWindow() || omniWindowHelper.hasLiveMiniApp('submodules')
    );
  }

  private scheduleRescan(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      if (!this.hasLiveSurface()) {
        this.stopWatching();
        return;
      }
      this.rescan();
    }, SUBMODULES_DEBOUNCE_MS);
  }

  private startPolling(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      if (!this.rootPath) return;
      if (!this.hasLiveSurface()) {
        this.stopWatching();
        return;
      }
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

  /** Broadcast only when the observed state changed, so watcher bursts stay quiet. */
  private publish(snapshot: SubmodulesSnapshot): SubmodulesSnapshot {
    const fingerprint = snapshotFingerprint(snapshot);
    const changed = fingerprint !== this.fingerprint;
    this.fingerprint = fingerprint;
    if (changed) xpcMain.broadcast(SUBMODULES_SNAPSHOT_EVENT, snapshot);
    return snapshot;
  }
}

export const submodulesRuntime = new SubmodulesRuntime();
