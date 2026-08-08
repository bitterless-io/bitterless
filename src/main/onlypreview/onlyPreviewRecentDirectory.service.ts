import { isAbsolute } from 'node:path';
import type { SettingDao, SettingStoredValue } from '@preload/sqlite/dao/setting.dao';
import type { OnlyPreviewWorkspace } from '@shared/onlypreview/onlyPreview.types';
import {
  onlyPreviewHostRegistry,
  type OnlyPreviewHostRegistry
} from './onlyPreviewHost.registry';
import {
  onlyPreviewWorkspaceRegistry,
  type OnlyPreviewWorkspaceRegistry
} from './onlyPreviewWorkspace.registry';

const RECENT_DIRECTORY_KEY = 'onlypreview_workspace';
const RECENT_DIRECTORY_SUB_KEY = 'last_directory';

export type OnlyPreviewRecentDirectoryStorage = Pick<
  SettingDao,
  'getStored' | 'insertIfAbsent' | 'compareAndSet'
>;

interface RecentDirectoryValue {
  version: 1;
  directoryPath: string;
}

interface RememberedDirectory {
  generation: number;
  directoryPath: string;
}

type StorageState = 'pending' | 'ready' | 'failed';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

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
  private readonly restoreFlights = new Map<
    string,
    Promise<OnlyPreviewWorkspace | null>
  >();

  constructor(
    private readonly hosts: OnlyPreviewHostRegistry,
    private readonly workspaces: OnlyPreviewWorkspaceRegistry,
    storage: OnlyPreviewRecentDirectoryStorage | null = null
  ) {
    this.storage = storage;
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

  markStorageReady(): void {
    if (this.storageState !== 'pending') return;
    this.storageState = 'ready';
    this.resolveStorageLatch?.(true);
    this.resolveStorageLatch = null;
    void this.scheduleStorageFlush();
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
      const workspace = await this.workspaces.createForTarget(hostToken, absoluteTarget);
      if (!this.isCurrentExplicit(hostToken, generation)) {
        this.revokeWorkspaceIfCurrent(hostToken, workspace.workspaceId);
        return null;
      }
      await this.rememberDirectory(workspace.displayPath, generation);
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

  clearTransientState(): void {
    this.activeExplicitGeneration = null;
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
    const candidate = stored.valid
      ? parseOnlyPreviewRecentDirectory(stored.value)
      : null;
    if (!stored.exists) return null;
    if (!candidate) {
      await this.clearObservedValue(stored);
      return null;
    }

    return await this.runHostMutation(hostToken, async () => {
      if (!this.canRestore(hostToken, generation, hostGeneration)) return null;
      const existing = this.workspaces.restore(hostToken);
      if (existing) return existing;

      let workspace: OnlyPreviewWorkspace;
      try {
        workspace = await this.workspaces.createForTarget(hostToken, candidate);
      } catch {
        if (this.canRestore(hostToken, generation, hostGeneration)) {
          await this.clearObservedValue(stored);
        }
        return null;
      }

      const isCanonicalDirectory =
        !workspace.selectedRelativePath && workspace.displayPath === candidate;
      if (!isCanonicalDirectory) {
        this.revokeWorkspaceIfCurrent(hostToken, workspace.workspaceId);
        await this.clearObservedValue(stored);
        return null;
      }
      if (!this.canRestore(hostToken, generation, hostGeneration)) {
        this.revokeWorkspaceIfCurrent(hostToken, workspace.workspaceId);
        return null;
      }
      return workspace;
    });
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
    if (this.workspaces.restore(hostToken)?.workspaceId === workspaceId) {
      this.workspaces.revokeHost(hostToken);
    }
  }

  private async rememberDirectory(directoryPath: string, generation: number): Promise<void> {
    if (generation !== this.mutationGeneration || !isAbsolute(directoryPath)) return;
    this.pendingDirectory = { generation, directoryPath };
    if (this.storageState === 'ready') await this.scheduleStorageFlush();
  }

  private async scheduleStorageFlush(): Promise<void> {
    this.storageWriteChain = this.storageWriteChain.then(async () => {
      await this.flushPendingDirectory();
    }).catch(() => undefined);
    await this.storageWriteChain;
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
        stored = (await storage.getStored({
          key: RECENT_DIRECTORY_KEY,
          sub_key: RECENT_DIRECTORY_SUB_KEY
        })) ?? null;
      } catch {
        return;
      }
      if (!stored || !this.isPendingDirectoryCurrent(pending)) return;

      try {
        const written = stored.exists && stored.serializedValue !== null
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
    return (
      this.pendingDirectory === pending &&
      pending.generation === this.mutationGeneration
    );
  }

  private async safeGetStored(): Promise<SettingStoredValue | null> {
    const storage = this.storage;
    if (!storage || this.storageState !== 'ready') return null;
    try {
      return (await storage.getStored({
        key: RECENT_DIRECTORY_KEY,
        sub_key: RECENT_DIRECTORY_SUB_KEY
      })) ?? null;
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
