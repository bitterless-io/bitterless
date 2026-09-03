import { isAbsolute } from 'node:path';
import type { SettingDao, SettingStoredValue } from '@preload/sqlite/dao/setting.dao';
import type { OnlyPreviewWorkspace } from '@shared/onlypreview/onlyPreview.types';
import type { OnlyPreviewValidatedTarget } from '@shared/onlypreview/onlyPreviewFileAuthorityRuntime.types';
import { onlyPreviewHostRegistry, type OnlyPreviewHostRegistry } from './onlyPreviewHost.registry';
import {
  onlyPreviewWorkspaceRegistry,
  type OnlyPreviewWorkspaceRegistry
} from './onlyPreviewWorkspace.registry';

const RECENT_DIRECTORY_KEY = 'onlypreview_workspace';
const RECENT_DIRECTORY_SUB_KEY = 'last_directory';
// A second sub-key rather than a field on the directory record: the directory record's shape is
// validated exactly (two keys, version 1), so widening it would need a migration for a value that
// is only a convenience.
const RECENT_FILE_SUB_KEY = 'last_file';

export type OnlyPreviewRecentDirectoryStorage = Pick<
  SettingDao,
  'getStored' | 'insertIfAbsent' | 'compareAndSet'
>;

interface RecentDirectoryValue {
  version: 1;
  directoryPath: string;
}

interface RecentFileValue {
  version: 1;
  directoryPath: string;
  relativePath: string;
}

interface RememberedDirectory {
  generation: number;
  directoryPath: string;
}

type StorageState = 'pending' | 'ready' | 'failed';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// The directory is part of the record so a file remembered in one Project can never be applied to
// another: a restore that opened a different folder simply finds no match.
export const parseOnlyPreviewRecentFile = (
  value: unknown
): { directoryPath: string; relativePath: string } | null => {
  if (!isRecord(value)) return null;
  if (Object.keys(value).length !== 3) return null;
  if (value.version !== 1) return null;
  if (typeof value.directoryPath !== 'string' || typeof value.relativePath !== 'string') return null;
  if (!isAbsolute(value.directoryPath) || value.directoryPath.includes('\0')) return null;
  if (!value.relativePath || value.relativePath.includes('\0')) return null;
  return { directoryPath: value.directoryPath, relativePath: value.relativePath };
};

export const parseOnlyPreviewRecentDirectory = (value: unknown): string | null => {
  if (!isRecord(value)) return null;
  if (Object.keys(value).length !== 2) return null;
  if (value.version !== 1) return null;
  if (typeof value.directoryPath !== 'string') return null;
  if (!isAbsolute(value.directoryPath) || value.directoryPath.includes('\0')) return null;
  return value.directoryPath;
};

export class OnlyPreviewRecentDirectoryService {
  private storage: OnlyPreviewRecentDirectoryStorage | null;
  private storageState: StorageState = 'pending';
  private resolveStorageLatch: ((ready: boolean) => void) | null = null;
  private readonly storageLatch: Promise<boolean>;
  private pendingDirectory: RememberedDirectory | null = null;
  private storageWriteChain: Promise<void> = Promise.resolve();
  private mutationGeneration = 0;
  private activeExplicitGeneration: number | null = null;
  private readonly hostGeneration = new Map<string, number>();
  private readonly hostMutationChain = new Map<string, Promise<void>>();
  private readonly restoreFlights = new Map<string, Promise<OnlyPreviewWorkspace | null>>();
  private inspectTarget: ((absoluteTarget: string) => Promise<OnlyPreviewValidatedTarget>) | null;
  private bindWorkspace:
    | ((hostToken: string, workspace: OnlyPreviewWorkspace) => Promise<void>)
    | null;
  // A restored selection has to be presented by Main, exactly as an explicitly opened file is. The
  // renderer cannot do it: it only learns the path, and the preview surface is Main's to attach.
  private presentSelection:
    | ((hostToken: string, workspace: OnlyPreviewWorkspace) => Promise<void>)
    | null = null;

  constructor(
    private readonly hosts: OnlyPreviewHostRegistry,
    private readonly workspaces: OnlyPreviewWorkspaceRegistry,
    storage: OnlyPreviewRecentDirectoryStorage | null = null,
    inspectTarget: ((absoluteTarget: string) => Promise<OnlyPreviewValidatedTarget>) | null = null,
    bindWorkspace:
      | ((hostToken: string, workspace: OnlyPreviewWorkspace) => Promise<void>)
      | null = null
  ) {
    this.storage = storage;
    this.inspectTarget = inspectTarget;
    this.bindWorkspace = bindWorkspace;
    this.storageLatch = new Promise<boolean>((resolve) => {
      this.resolveStorageLatch = resolve;
    });
    hosts.onRevoke((host) => this.revokeHost(host.hostToken));
  }

  configureStorage(storage: OnlyPreviewRecentDirectoryStorage): void {
    if (this.storage && this.storage !== storage) {
      throw new Error('OnlyPreview recent-directory storage is already configured.');
    }
    this.storage = storage;
  }

  configureTargetRuntime(params: {
    inspectTarget: (absoluteTarget: string) => Promise<OnlyPreviewValidatedTarget>;
    bindWorkspace: (hostToken: string, workspace: OnlyPreviewWorkspace) => Promise<void>;
    presentSelection?: (hostToken: string, workspace: OnlyPreviewWorkspace) => Promise<void>;
  }): void {
    if (this.inspectTarget || this.bindWorkspace) {
      throw new Error('OnlyPreview target runtime is already configured.');
    }
    this.inspectTarget = params.inspectTarget;
    this.bindWorkspace = params.bindWorkspace;
    this.presentSelection = params.presentSelection ?? null;
  }

  markStorageReady(): void {
    if (this.storageState !== 'pending') return;
    this.storageState = 'ready';
    this.resolveStorageLatch?.(true);
    this.resolveStorageLatch = null;
    this.scheduleStorageFlush();
  }

  markStorageFailed(): void {
    if (this.storageState !== 'pending') return;
    this.storageState = 'failed';
    this.pendingDirectory = null;
    this.resolveStorageLatch?.(false);
    this.resolveStorageLatch = null;
  }

  beginExplicitTarget(hostToken?: string): number {
    const generation = ++this.mutationGeneration;
    this.activeExplicitGeneration = generation;
    if (hostToken) this.hostGeneration.set(hostToken, generation);
    return generation;
  }

  bindExplicitTarget(hostToken: string, generation: number): void {
    if (generation === this.mutationGeneration) {
      this.hostGeneration.set(hostToken, generation);
    }
  }

  finishExplicitTarget(generation: number): void {
    if (this.activeExplicitGeneration === generation) {
      this.activeExplicitGeneration = null;
    }
  }

  async openExplicitTarget(
    hostToken: string,
    absoluteTarget: string,
    generation: number
  ): Promise<OnlyPreviewWorkspace | null> {
    this.bindExplicitTarget(hostToken, generation);
    return await this.runHostMutation(hostToken, async () => {
      if (!this.isCurrentExplicit(hostToken, generation)) return null;
      const workspace = await this.createWorkspaceForTarget(hostToken, absoluteTarget);
      if (!this.isCurrentExplicit(hostToken, generation)) {
        this.revokeWorkspaceIfCurrent(hostToken, workspace.workspaceId);
        return null;
      }
      this.rememberDirectory(workspace.displayPath, generation);
      return workspace;
    });
  }

  async restoreWorkspace(hostToken: unknown): Promise<OnlyPreviewWorkspace | null> {
    const host = this.hosts.require(hostToken, ['content']);
    const current = this.workspaces.restore(host.hostToken);
    if (current) return current;
    if (this.activeExplicitGeneration !== null) return null;

    const existingFlight = this.restoreFlights.get(host.hostToken);
    if (existingFlight) return await existingFlight;

    const generation = this.mutationGeneration;
    const hostGeneration = this.hostGeneration.get(host.hostToken) ?? 0;
    const flight = this.restoreFromStorage(host.hostToken, generation, hostGeneration);
    this.restoreFlights.set(host.hostToken, flight);
    try {
      return await flight;
    } finally {
      if (this.restoreFlights.get(host.hostToken) === flight) {
        this.restoreFlights.delete(host.hostToken);
      }
    }
  }

  /**
   * Remember the file the owner is previewing, so the next launch reopens it.
   *
   * Last write wins, deliberately: unlike the directory record — which gates whether a Project is
   * restored at all — this is a convenience, and a lost write costs the owner one click. The
   * directory is stored alongside so a stale selection cannot be applied to a different Project.
   */
  rememberSelectedFile(directoryPath: string, relativePath: string): void {
    const storage = this.storage;
    if (!storage || this.storageState !== 'ready') return;
    if (!isAbsolute(directoryPath) || !relativePath) return;
    const value: RecentFileValue = { version: 1, directoryPath, relativePath };
    this.storageWriteChain = this.storageWriteChain
      .then(async () => {
        const stored = await storage.getStored({
          key: RECENT_DIRECTORY_KEY,
          sub_key: RECENT_FILE_SUB_KEY
        });
        if (!stored) return;
        if (stored.exists && stored.serializedValue !== null) {
          await storage.compareAndSet({
            key: RECENT_DIRECTORY_KEY,
            sub_key: RECENT_FILE_SUB_KEY,
            expectedSerializedValue: stored.serializedValue,
            value
          });
          return;
        }
        await storage.insertIfAbsent({
          key: RECENT_DIRECTORY_KEY,
          sub_key: RECENT_FILE_SUB_KEY,
          value
        });
      })
      .catch(() => undefined);
  }

  clearTransientState(): void {
    this.mutationGeneration += 1;
    this.activeExplicitGeneration = null;
    this.pendingDirectory = null;
    this.hostGeneration.clear();
    this.hostMutationChain.clear();
    this.restoreFlights.clear();
  }

  private async restoreFromStorage(
    hostToken: string,
    generation: number,
    hostGeneration: number
  ): Promise<OnlyPreviewWorkspace | null> {
    if (!(await this.storageLatch)) return null;
    if (!this.canRestore(hostToken, generation, hostGeneration)) return null;
    const current = this.workspaces.restore(hostToken);
    if (current) return current;

    const stored = await this.safeGetStored();
    if (!stored) return null;
    if (!this.canRestore(hostToken, generation, hostGeneration)) return null;
    const candidate = stored.valid ? parseOnlyPreviewRecentDirectory(stored.value) : null;
    if (!stored.exists) return null;
    if (!candidate) {
      void this.clearObservedValue(stored);
      return null;
    }

    return await this.runHostMutation(hostToken, async () => {
      if (!this.canRestore(hostToken, generation, hostGeneration)) return null;
      const existing = this.workspaces.restore(hostToken);
      if (existing) return existing;

      let workspace: OnlyPreviewWorkspace;
      try {
        workspace = await this.createWorkspaceForTarget(hostToken, candidate);
      } catch {
        if (this.canRestore(hostToken, generation, hostGeneration)) {
          void this.clearObservedValue(stored);
        }
        return null;
      }

      const isCanonicalDirectory =
        !workspace.selectedRelativePath && workspace.displayPath === candidate;
      if (!isCanonicalDirectory) {
        this.revokeWorkspaceIfCurrent(hostToken, workspace.workspaceId);
        void this.clearObservedValue(stored);
        return null;
      }
      if (!this.canRestore(hostToken, generation, hostGeneration)) {
        this.revokeWorkspaceIfCurrent(hostToken, workspace.workspaceId);
        return null;
      }
      // The remembered file rides back on the workspace, which is the same channel an explicitly
      // opened file already uses. A file that has since been deleted or renamed simply never
      // appears in the index, and the tree opens with nothing selected.
      const selectedRelativePath = await this.readSelectedFile(workspace.displayPath);
      if (!this.canRestore(hostToken, generation, hostGeneration)) {
        this.revokeWorkspaceIfCurrent(hostToken, workspace.workspaceId);
        return null;
      }
      if (!selectedRelativePath) return workspace;
      const restored = { ...workspace, selectedRelativePath };
      // Best effort: a file that has been deleted or replaced by a directory since the last session
      // leaves the Project open with nothing previewed, which is the right outcome.
      await this.presentSelection?.(hostToken, restored).catch(() => undefined);
      if (!this.canRestore(hostToken, generation, hostGeneration)) {
        this.revokeWorkspaceIfCurrent(hostToken, workspace.workspaceId);
        return null;
      }
      return restored;
    });
  }

  private async readSelectedFile(directoryPath: string): Promise<string | null> {
    const storage = this.storage;
    if (!storage || this.storageState !== 'ready') return null;
    let stored: SettingStoredValue | null;
    try {
      stored =
        (await storage.getStored({ key: RECENT_DIRECTORY_KEY, sub_key: RECENT_FILE_SUB_KEY })) ??
        null;
    } catch {
      return null;
    }
    if (!stored?.exists || !stored.valid) return null;
    const candidate = parseOnlyPreviewRecentFile(stored.value);
    return candidate?.directoryPath === directoryPath ? candidate.relativePath : null;
  }

  private canRestore(hostToken: string, generation: number, hostGeneration: number): boolean {
    return (
      this.activeExplicitGeneration === null &&
      this.mutationGeneration === generation &&
      (this.hostGeneration.get(hostToken) ?? 0) === hostGeneration &&
      this.hosts.isLive(hostToken)
    );
  }

  private isCurrentExplicit(hostToken: string, generation: number): boolean {
    return (
      this.mutationGeneration === generation &&
      this.hostGeneration.get(hostToken) === generation &&
      this.hosts.isLive(hostToken)
    );
  }

  private revokeWorkspaceIfCurrent(hostToken: string, workspaceId: string): void {
    if (!this.hosts.isLive(hostToken)) return;
    this.workspaces.revokeWorkspace(workspaceId);
  }

  private rememberDirectory(directoryPath: string, generation: number): void {
    if (generation !== this.mutationGeneration || !isAbsolute(directoryPath)) return;
    this.pendingDirectory = { generation, directoryPath };
    if (this.storageState === 'ready') this.scheduleStorageFlush();
  }

  private scheduleStorageFlush(): void {
    this.storageWriteChain = this.storageWriteChain
      .then(async () => {
        await this.flushPendingDirectory();
      })
      .catch(() => undefined);
  }

  private async flushPendingDirectory(): Promise<void> {
    const pending = this.pendingDirectory;
    const storage = this.storage;
    if (!pending || !storage || this.storageState !== 'ready') return;
    if (pending.generation !== this.mutationGeneration) return;
    const value: RecentDirectoryValue = {
      version: 1,
      directoryPath: pending.directoryPath
    };

    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (!this.isPendingDirectoryCurrent(pending)) return;
      let stored: SettingStoredValue | null;
      try {
        stored =
          (await storage.getStored({
            key: RECENT_DIRECTORY_KEY,
            sub_key: RECENT_DIRECTORY_SUB_KEY
          })) ?? null;
      } catch {
        return;
      }
      if (!stored || !this.isPendingDirectoryCurrent(pending)) return;

      try {
        const written =
          stored.exists && stored.serializedValue !== null
            ? await storage.compareAndSet({
                key: RECENT_DIRECTORY_KEY,
                sub_key: RECENT_DIRECTORY_SUB_KEY,
                expectedSerializedValue: stored.serializedValue,
                value
              })
            : await storage.insertIfAbsent({
                key: RECENT_DIRECTORY_KEY,
                sub_key: RECENT_DIRECTORY_SUB_KEY,
                value
              });
        if (written) {
          if (this.isPendingDirectoryCurrent(pending)) this.pendingDirectory = null;
          return;
        }
      } catch {
        return;
      }
    }
  }

  private isPendingDirectoryCurrent(pending: RememberedDirectory): boolean {
    return this.pendingDirectory === pending && pending.generation === this.mutationGeneration;
  }

  private async safeGetStored(): Promise<SettingStoredValue | null> {
    const storage = this.storage;
    if (!storage || this.storageState !== 'ready') return null;
    try {
      return (
        (await storage.getStored({
          key: RECENT_DIRECTORY_KEY,
          sub_key: RECENT_DIRECTORY_SUB_KEY
        })) ?? null
      );
    } catch {
      return null;
    }
  }

  private async clearObservedValue(stored: SettingStoredValue): Promise<void> {
    const storage = this.storage;
    if (!storage || stored.serializedValue === null || this.storageState !== 'ready') return;
    try {
      await storage.compareAndSet({
        key: RECENT_DIRECTORY_KEY,
        sub_key: RECENT_DIRECTORY_SUB_KEY,
        expectedSerializedValue: stored.serializedValue,
        value: null
      });
    } catch {
      // Invalid history is optional; cleanup must never block OnlyPreview.
    }
  }

  private async runHostMutation<T>(hostToken: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.hostMutationChain.get(hostToken) ?? Promise.resolve();
    let resolveCurrent: (() => void) | null = null;
    const current = new Promise<void>((resolve) => {
      resolveCurrent = resolve;
    });
    this.hostMutationChain.set(hostToken, current);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      resolveCurrent?.();
      if (this.hostMutationChain.get(hostToken) === current) {
        this.hostMutationChain.delete(hostToken);
      }
    }
  }

  private async createWorkspaceForTarget(
    hostToken: string,
    absoluteTarget: string
  ): Promise<OnlyPreviewWorkspace> {
    if (!this.inspectTarget || !this.bindWorkspace) {
      throw new Error('OnlyPreview target runtime is unavailable.');
    }
    const target = await this.inspectTarget(absoluteTarget);
    const workspace = this.workspaces.registerValidatedTarget(hostToken, target);
    try {
      await this.bindWorkspace(hostToken, workspace);
    } catch (error) {
      this.revokeWorkspaceIfCurrent(hostToken, workspace.workspaceId);
      throw error;
    }
    return workspace;
  }

  private revokeHost(hostToken: string): void {
    this.hostGeneration.delete(hostToken);
    this.hostMutationChain.delete(hostToken);
    this.restoreFlights.delete(hostToken);
  }
}

export const onlyPreviewRecentDirectoryService = new OnlyPreviewRecentDirectoryService(
  onlyPreviewHostRegistry,
  onlyPreviewWorkspaceRegistry
);
