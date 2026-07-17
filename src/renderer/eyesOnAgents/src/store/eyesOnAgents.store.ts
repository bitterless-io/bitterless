import { computed, reactive } from 'vue';
import type {
  EyesOnAgentsDomain,
  EyesOnAgentsSnapshot,
  EyesOnAgentsThread,
} from '@shared/eyesOnAgents/eyesOnAgents.type';
import {
  eyesOnAgentsEmitter,
  subscribeEyesOnAgentsChanges,
} from '../emitter/eyesOnAgents.emitter';
import {
  ALL_PROJECT_FILTER_VALUE,
  NO_PROJECT_FILTER_VALUE,
  buildEyesOnAgentsProjectFilterOptions,
  filterEyesOnAgentsThreadsByProject,
  type EyesOnAgentsProjectFilterOption,
  type EyesOnAgentsProjectFilterSelection,
} from '../services/projectFilter.service';

const attentionRank = (thread: EyesOnAgentsThread): number => {
  if (thread.runtimeState === 'waiting_approval') return 0;
  if (thread.runtimeState === 'waiting_input') return 1;
  if (thread.runtimeState === 'working') return 2;
  if (thread.isUnread) return 3;
  return 4;
};

const activityTimestamp = (thread: EyesOnAgentsThread): number => {
  const value = thread.lastActivityAt ?? thread.lastCompletedAt;
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const sortThreads = (threads: EyesOnAgentsThread[]): EyesOnAgentsThread[] =>
  [...threads].sort((left, right) => {
    const attention = attentionRank(left) - attentionRank(right);
    if (attention !== 0) return attention;
    return activityTimestamp(right) - activityTimestamp(left);
  });

class EyesOnAgentsState {
  snapshot: EyesOnAgentsSnapshot | null = null;
  loading = true;
  loadError: string | null = null;
  actionError: string | null = null;
  busyAction: string | null = null;
  openingThreadIds = new Set<string>();
  uncategorizedProjectFilter: EyesOnAgentsProjectFilterSelection = { type: 'all' };
  private reloadRequested = false;
  private snapshotPromise: Promise<void> | null = null;
  private activationPromise: Promise<void> | null = null;
  private subscribed = false;

  get domains(): EyesOnAgentsDomain[] {
    return [...(this.snapshot?.domains ?? [])].sort((left, right) => {
      if (left.domainKey === 'uncategorized') return -1;
      if (right.domainKey === 'uncategorized') return 1;
      return left.sortIndex - right.sortIndex;
    });
  }

  get uncategorizedDomain(): EyesOnAgentsDomain | null {
    return this.domains.find((domain) => domain.domainKey === 'uncategorized') ?? null;
  }

  get customDomains(): EyesOnAgentsDomain[] {
    return this.domains.filter((domain) => domain.domainKey !== 'uncategorized');
  }

  get threads(): EyesOnAgentsThread[] {
    return this.snapshot?.threads ?? [];
  }

  get focusThreads(): EyesOnAgentsThread[] {
    return sortThreads(this.threads.filter((thread) => thread.isFocused));
  }

  get uncategorizedThreads(): EyesOnAgentsThread[] {
    if (!this.uncategorizedDomain) return [];
    return this.threadsForDomain(this.uncategorizedDomain.id);
  }

  get uncategorizedProjectOptions(): EyesOnAgentsProjectFilterOption[] {
    return buildEyesOnAgentsProjectFilterOptions(
      this.uncategorizedThreads,
      this.uncategorizedProjectFilter,
    );
  }

  get filteredUncategorizedThreads(): EyesOnAgentsThread[] {
    return filterEyesOnAgentsThreadsByProject(
      this.uncategorizedThreads,
      this.uncategorizedProjectFilter,
    );
  }

  get uncategorizedProjectFilterValue(): string {
    if (this.uncategorizedProjectFilter.type === 'all') return ALL_PROJECT_FILTER_VALUE;
    if (this.uncategorizedProjectFilter.type === 'none') return NO_PROJECT_FILTER_VALUE;
    return `project:${encodeURIComponent(this.uncategorizedProjectFilter.projectKey)}`;
  }

  get isUncategorizedProjectFiltered(): boolean {
    return this.uncategorizedProjectFilter.type !== 'all';
  }

  initialize(): void {
    if (this.subscribed) return;
    this.subscribed = true;
    subscribeEyesOnAgentsChanges(() => {
      void this.loadSnapshot(true);
    });
  }

  threadsForDomain(domainId: number): EyesOnAgentsThread[] {
    return sortThreads(this.threads.filter((thread) => thread.domainId === domainId));
  }

  selectUncategorizedProjectFilter(value: string): void {
    const option = this.uncategorizedProjectOptions.find((item) => item.value === value);
    if (!option) return;
    if (option.type === 'all') {
      this.uncategorizedProjectFilter = { type: 'all' };
      return;
    }
    if (option.type === 'none') {
      this.uncategorizedProjectFilter = { type: 'none' };
      return;
    }
    if (!option.projectKey || !option.projectRoot || !option.projectName) return;
    this.uncategorizedProjectFilter = {
      type: 'project',
      projectKey: option.projectKey,
      projectRoot: option.projectRoot,
      projectName: option.projectName,
    };
  }

  async loadSnapshot(quiet = false): Promise<void> {
    if (this.snapshotPromise) {
      this.reloadRequested = true;
      return await this.snapshotPromise;
    }

    if (!quiet || !this.snapshot) this.loading = true;
    this.loadError = null;
    const request = (async () => {
      try {
        this.applySnapshot(await eyesOnAgentsEmitter.getSnapshot());
      } catch (error) {
        this.loadError = this.errorMessage(error);
      } finally {
        this.loading = false;
      }
    })();
    this.snapshotPromise = request.finally(() => {
      this.snapshotPromise = null;
    });
    await this.snapshotPromise;

    if (this.reloadRequested) {
      this.reloadRequested = false;
      await this.loadSnapshot(true);
    }
  }

  async connectAppServer(): Promise<void> {
    await this.runSnapshotAction('connect', () => eyesOnAgentsEmitter.connectAppServer());
  }

  async disconnectAppServer(): Promise<void> {
    await this.runSnapshotAction('disconnect', () => eyesOnAgentsEmitter.disconnectAppServer());
  }

  async syncThreads(): Promise<void> {
    await this.runSnapshotAction('sync', () => eyesOnAgentsEmitter.syncThreads());
  }

  async refreshOnWindowActivation(): Promise<void> {
    if (this.activationPromise) return await this.activationPromise;

    const request = this.performWindowActivationRefresh();
    this.activationPromise = request.finally(() => {
      this.activationPromise = null;
    });
    await this.activationPromise;
  }

  async installCodexBridge(): Promise<void> {
    await this.runSnapshotAction('bridge-install', () => eyesOnAgentsEmitter.installCodexBridge());
  }

  async reviewCodexBridge(): Promise<void> {
    await this.runSnapshotAction('bridge-review', () => eyesOnAgentsEmitter.reviewCodexBridge());
  }

  async refreshCodexBridgeStatus(): Promise<void> {
    await this.runSnapshotAction('bridge-refresh', () =>
      eyesOnAgentsEmitter.refreshCodexBridgeStatus(),
    );
  }

  async removeCodexBridge(): Promise<void> {
    await this.runSnapshotAction('bridge-remove', () => eyesOnAgentsEmitter.removeCodexBridge());
  }

  async openThread(threadId: string): Promise<void> {
    if (this.openingThreadIds.has(threadId)) return;
    this.openingThreadIds = new Set(this.openingThreadIds).add(threadId);
    this.actionError = null;
    try {
      const result = await eyesOnAgentsEmitter.openThread({ threadId });
      this.applySnapshot(result.snapshot);
    } catch (error) {
      this.actionError = this.errorMessage(error);
      throw error;
    } finally {
      const next = new Set(this.openingThreadIds);
      next.delete(threadId);
      this.openingThreadIds = next;
    }
  }

  async createDomain(title: string): Promise<void> {
    await this.runSnapshotAction('domain-create', () =>
      eyesOnAgentsEmitter.createDomain({ title }),
    );
  }

  async renameDomain(domainId: number, title: string): Promise<void> {
    await this.runSnapshotAction(`domain-rename:${domainId}`, () =>
      eyesOnAgentsEmitter.renameDomain({ domainId, title }),
    );
  }

  async deleteDomain(domainId: number): Promise<void> {
    await this.runSnapshotAction(`domain-delete:${domainId}`, () =>
      eyesOnAgentsEmitter.deleteDomain({ domainId }),
    );
  }

  async reorderCustomDomains(oldIndex: number, newIndex: number): Promise<void> {
    if (oldIndex === newIndex || oldIndex < 0 || newIndex < 0) return;
    const domains = [...this.customDomains];
    const [moved] = domains.splice(oldIndex, 1);
    if (!moved) return;
    domains.splice(newIndex, 0, moved);
    await this.runSnapshotAction('domain-reorder', () =>
      eyesOnAgentsEmitter.reorderDomains({
        domainIds: [
          ...(this.uncategorizedDomain ? [this.uncategorizedDomain.id] : []),
          ...domains.map((domain) => domain.id),
        ],
      }),
    );
  }

  async moveThread(threadId: string, domainId: number): Promise<void> {
    const current = this.threads.find((thread) => thread.threadId === threadId);
    if (!current || current.domainId === domainId) return;
    await this.runSnapshotAction(`thread-move:${threadId}`, () =>
      eyesOnAgentsEmitter.moveThread({ threadId, domainId }),
    );
  }

  clearActionError(): void {
    this.actionError = null;
  }

  private async performWindowActivationRefresh(): Promise<void> {
    const connection = this.snapshot?.connection;
    const shouldSync = connection?.state === 'connected'
      || Boolean(
        connection?.autoConnectEnabled
        && (connection.state === 'disconnected' || connection.state === 'error'),
      );
    if (shouldSync) {
      await this.syncThreads();
    } else {
      await this.loadSnapshot(true);
    }

    if (this.snapshot?.bridge.state !== 'not_installed') {
      await this.refreshCodexBridgeStatus();
    }
  }

  private async runSnapshotAction(
    action: string,
    callback: () => Promise<EyesOnAgentsSnapshot>,
  ): Promise<void> {
    if (this.busyAction) return;
    this.busyAction = action;
    this.actionError = null;
    try {
      this.applySnapshot(await callback());
    } catch (error) {
      this.actionError = this.errorMessage(error);
      throw error;
    } finally {
      this.busyAction = null;
    }
  }

  private applySnapshot(snapshot: EyesOnAgentsSnapshot): void {
    this.snapshot = snapshot;
    this.loadError = null;
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error && error.message) return error.message;
    return String(error || 'Unknown EyesOnAgents error');
  }
}

export const eyesOnAgentsStore = reactive(new EyesOnAgentsState());

export const eyesOnAgentsView = {
  domains: computed(() => eyesOnAgentsStore.domains),
  focusThreads: computed(() => eyesOnAgentsStore.focusThreads),
};
