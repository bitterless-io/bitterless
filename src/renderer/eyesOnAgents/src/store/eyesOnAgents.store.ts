import { computed, reactive } from 'vue';
import type {
  EyesOnAgentsDomain,
  EyesOnAgentsSnapshot,
  EyesOnAgentsSessionKey,
  EyesOnAgentsThread,
} from '@shared/eyesOnAgents/eyesOnAgents.type';
import {
  isEyesOnAgentsFocused,
  isEyesOnAgentsTerminal,
} from '@shared/eyesOnAgents/eyesOnAgents.contract';
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

const parsedTimestamp = (value: string | null): number => {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const presentationTimestamp = (
  thread: EyesOnAgentsThread,
  rank: number,
): number => {
  if (rank <= 2) return parsedTimestamp(thread.statusObservedAt);
  return parsedTimestamp(thread.lastActivityAt ?? thread.lastCompletedAt);
};

const sortThreads = (threads: EyesOnAgentsThread[]): EyesOnAgentsThread[] =>
  [...threads].sort((left, right) => {
    const leftRank = attentionRank(left);
    const rightRank = attentionRank(right);
    const attention = leftRank - rightRank;
    if (attention !== 0) return attention;
    const timestamp = presentationTimestamp(right, rightRank)
      - presentationTimestamp(left, leftRank);
    if (timestamp !== 0) return timestamp;
    if (left.sessionKey === right.sessionKey) return 0;
    return left.sessionKey < right.sessionKey ? -1 : 1;
  });

const THREAD_SEARCH_SEPARATOR_PATTERN = /[\s\-_.\/\\:|]+/u;

const tokenizeThreadSearchText = (value: string): string[] =>
  value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .split(THREAD_SEARCH_SEPARATOR_PATTERN)
    .filter(Boolean);

class EyesOnAgentsState {
  snapshot: EyesOnAgentsSnapshot | null = null;
  loading = true;
  loadError: string | null = null;
  actionError: string | null = null;
  busyAction: string | null = null;
  openingSessionKeys = new Set<string>();
  previewingSessionKeys = new Set<string>();
  allProjectFilter: EyesOnAgentsProjectFilterSelection = { type: 'all' };
  allTitleQuery = '';
  threadSearchVisible = false;
  threadSearchQuery = '';
  threadSearchSelectedSessionKey: EyesOnAgentsSessionKey | null = null;
  private reloadRequested = false;
  private snapshotPromise: Promise<void> | null = null;
  private activationPromise: Promise<void> | null = null;
  private backgroundRefreshPromise: Promise<void> | null = null;
  private refreshTimer: number | null = null;
  private subscribed = false;
  private highestClaudeProviderRevision = -1;

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
    return sortThreads(
      this.threads.filter(
        (thread) => isEyesOnAgentsFocused(thread.runtimeState, thread.isUnread),
      ),
    );
  }

  get readableFocusThreads(): EyesOnAgentsThread[] {
    return this.focusThreads.filter(
      (thread) => thread.isUnread && isEyesOnAgentsTerminal(thread.runtimeState),
    );
  }

  get allThreads(): EyesOnAgentsThread[] {
    return sortThreads(this.threads);
  }

  get allProjectOptions(): EyesOnAgentsProjectFilterOption[] {
    return buildEyesOnAgentsProjectFilterOptions(
      this.allThreads,
      this.allProjectFilter,
    );
  }

  get filteredAllThreads(): EyesOnAgentsThread[] {
    const projectThreads = filterEyesOnAgentsThreadsByProject(
      this.allThreads,
      this.allProjectFilter,
    );
    const query = this.allTitleQuery.trim().toLocaleLowerCase();
    if (!query) return projectThreads;
    return projectThreads.filter(
      (thread) => thread.title !== null
        && thread.title.toLocaleLowerCase().includes(query),
    );
  }

  get threadSearchResults(): EyesOnAgentsThread[] {
    const queryTokens = tokenizeThreadSearchText(this.threadSearchQuery);
    if (queryTokens.length === 0) return [];
    return this.allThreads.filter((thread) => {
      if (thread.title === null) return false;
      const titleTokens = tokenizeThreadSearchText(thread.title);
      return queryTokens.every((queryToken) =>
        titleTokens.some((titleToken) => titleToken.includes(queryToken)));
    });
  }

  get hasThreadSearchQueryTokens(): boolean {
    return tokenizeThreadSearchText(this.threadSearchQuery).length > 0;
  }

  get allProjectFilterValue(): string {
    if (this.allProjectFilter.type === 'all') return ALL_PROJECT_FILTER_VALUE;
    if (this.allProjectFilter.type === 'none') return NO_PROJECT_FILTER_VALUE;
    return `project:${encodeURIComponent(this.allProjectFilter.projectKey)}`;
  }

  get isAllProjectFiltered(): boolean {
    return this.allProjectFilter.type !== 'all';
  }

  get isAllTitleFiltered(): boolean {
    return Boolean(this.allTitleQuery.trim());
  }

  initialize(): void {
    if (this.subscribed) return;
    this.subscribed = true;
    subscribeEyesOnAgentsChanges(() => {
      void this.loadSnapshot(true);
    });
  }

  startRefreshPolling(): void {
    if (this.refreshTimer !== null) return;
    this.refreshTimer = window.setInterval(() => {
      void this.performRefreshPollingTick().catch(() => undefined);
    }, 10_000);
  }

  stopRefreshPolling(): void {
    if (this.refreshTimer === null) return;
    window.clearInterval(this.refreshTimer);
    this.refreshTimer = null;
  }

  threadsForDomain(domainId: number): EyesOnAgentsThread[] {
    return sortThreads(this.threads.filter((thread) => thread.domainId === domainId));
  }

  customDomainTitle(domainId: number): string | null {
    const title = this.customDomains.find((domain) => domain.id === domainId)?.title.trim();
    return title || null;
  }

  selectAllProjectFilter(value: string): void {
    const option = this.allProjectOptions.find((item) => item.value === value);
    if (!option) return;
    if (option.type === 'all') {
      this.allProjectFilter = { type: 'all' };
      return;
    }
    if (option.type === 'none') {
      this.allProjectFilter = { type: 'none' };
      return;
    }
    if (!option.projectKey || !option.projectRoot || !option.projectName) return;
    this.allProjectFilter = {
      type: 'project',
      projectKey: option.projectKey,
      projectRoot: option.projectRoot,
      projectName: option.projectName,
    };
  }

  clearAllTitleQuery(): void {
    this.allTitleQuery = '';
  }

  openThreadSearch(): void {
    if (this.threadSearchVisible) return;
    this.threadSearchVisible = true;
    this.threadSearchSelectedSessionKey = this.threadSearchResults[0]?.sessionKey ?? null;
  }

  closeThreadSearch(): void {
    this.threadSearchVisible = false;
    this.threadSearchQuery = '';
    this.threadSearchSelectedSessionKey = null;
  }

  setThreadSearchQuery(query: string): void {
    if (this.threadSearchQuery === query) return;
    this.threadSearchQuery = query;
    this.threadSearchSelectedSessionKey = this.threadSearchResults[0]?.sessionKey ?? null;
  }

  selectThreadSearchResult(sessionKey: EyesOnAgentsSessionKey): void {
    if (!this.threadSearchResults.some((thread) => thread.sessionKey === sessionKey)) return;
    this.threadSearchSelectedSessionKey = sessionKey;
  }

  moveThreadSearchSelection(delta: -1 | 1): void {
    const results = this.threadSearchResults;
    if (results.length === 0) {
      this.threadSearchSelectedSessionKey = null;
      return;
    }

    const selectedIndex = results.findIndex(
      (thread) => thread.sessionKey === this.threadSearchSelectedSessionKey,
    );
    const currentIndex = selectedIndex < 0 ? 0 : selectedIndex;
    const nextIndex = Math.min(results.length - 1, Math.max(0, currentIndex + delta));
    this.threadSearchSelectedSessionKey = results[nextIndex]?.sessionKey ?? null;
  }

  async openSelectedThreadSearchResult(): Promise<void> {
    if (!this.threadSearchSelectedSessionKey) return;
    await this.openThreadSearchResult(this.threadSearchSelectedSessionKey);
  }

  async openThreadSearchResult(sessionKey: EyesOnAgentsSessionKey): Promise<void> {
    const thread = this.threadSearchResults.find((item) => item.sessionKey === sessionKey);
    if (!thread) return;
    this.threadSearchSelectedSessionKey = sessionKey;
    await this.openThread(sessionKey);
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

  async setLastUserPromptCaptureEnabled(enabled: boolean): Promise<void> {
    await this.runSnapshotAction('prompt-retention', () =>
      eyesOnAgentsEmitter.setLastUserPromptCaptureEnabled({ enabled }),
    );
  }

  async setClaudeProviderEnabled(enabled: boolean): Promise<void> {
    await this.runSnapshotAction('claude-provider-toggle', () =>
      eyesOnAgentsEmitter.setClaudeProviderEnabled({ enabled }),
    );
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

  async installClaudeBridge(): Promise<void> {
    await this.runSnapshotAction('claude-bridge-install', () =>
      eyesOnAgentsEmitter.installClaudeBridge(),
    );
  }

  async refreshClaudeBridgeStatus(): Promise<void> {
    await this.runSnapshotAction('claude-bridge-refresh', () =>
      eyesOnAgentsEmitter.refreshClaudeBridgeStatus(),
    );
  }

  async removeClaudeBridge(): Promise<void> {
    await this.runSnapshotAction('claude-bridge-remove', () =>
      eyesOnAgentsEmitter.removeClaudeBridge(),
    );
  }

  async openNewClaudeSession(): Promise<void> {
    await this.runCommandAction('claude-session-open', () =>
      eyesOnAgentsEmitter.openNewClaudeSession(),
    );
  }

  async copyClaudeReloadCommand(): Promise<void> {
    await this.runCommandAction('claude-reload-copy', () =>
      eyesOnAgentsEmitter.copyClaudeReloadCommand(),
    );
  }

  async changeClaudeDirectory(): Promise<void> {
    await this.runSnapshotAction('claude-directory-change', () =>
      eyesOnAgentsEmitter.changeClaudeDirectory(),
    );
  }

  async useAutomaticClaudeDirectory(): Promise<void> {
    await this.runSnapshotAction('claude-directory-automatic', () =>
      eyesOnAgentsEmitter.useAutomaticClaudeDirectory(),
    );
  }

  async retryClaudeDirectory(): Promise<void> {
    await this.runSnapshotAction('claude-directory-retry', () =>
      eyesOnAgentsEmitter.retryClaudeDirectory(),
    );
  }

  async openThread(sessionKey: EyesOnAgentsSessionKey): Promise<void> {
    const thread = this.threads.find((item) => item.sessionKey === sessionKey);
    if (!thread || (thread.provider === 'claude' && thread.desktopSessionId === null)) return;
    if (this.openingSessionKeys.has(sessionKey)) return;
    this.openingSessionKeys = new Set(this.openingSessionKeys).add(sessionKey);
    this.actionError = null;
    try {
      const result = await eyesOnAgentsEmitter.openThread({ sessionKey });
      this.applySnapshot(result.snapshot);
    } catch (error) {
      this.actionError = this.errorMessage(error);
      throw error;
    } finally {
      const next = new Set(this.openingSessionKeys);
      next.delete(sessionKey);
      this.openingSessionKeys = next;
    }
  }

  async previewThread(sessionKey: EyesOnAgentsSessionKey): Promise<void> {
    const thread = this.threads.find((item) => item.sessionKey === sessionKey);
    if (
      !thread
      || thread.provider !== 'claude'
      || !thread.canPreviewTranscript
      || this.previewingSessionKeys.has(sessionKey)
    ) return;
    this.previewingSessionKeys = new Set(this.previewingSessionKeys).add(sessionKey);
    this.actionError = null;
    try {
      await eyesOnAgentsEmitter.previewThread({ sessionKey });
    } catch (error) {
      this.actionError = this.errorMessage(error);
      throw error;
    } finally {
      const next = new Set(this.previewingSessionKeys);
      next.delete(sessionKey);
      this.previewingSessionKeys = next;
    }
  }

  async markAllRead(): Promise<void> {
    if (this.readableFocusThreads.length === 0) return;
    await this.runSnapshotAction('focus-read-all', () => eyesOnAgentsEmitter.markAllRead());
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

  async moveThread(sessionKey: EyesOnAgentsSessionKey, domainId: number): Promise<void> {
    const current = this.threads.find((thread) => thread.sessionKey === sessionKey);
    if (!current || current.domainId === domainId) return;
    await this.runSnapshotAction(`thread-move:${sessionKey}`, () =>
      eyesOnAgentsEmitter.moveThread({ sessionKey, domainId }),
    );
  }

  clearActionError(): void {
    this.actionError = null;
  }

  private async performRefreshPollingTick(): Promise<void> {
    if (this.snapshotPromise || this.busyAction || this.backgroundRefreshPromise) return;

    const request = this.performBackgroundThreadPagesRefresh();
    this.backgroundRefreshPromise = request.finally(() => {
      this.backgroundRefreshPromise = null;
    });
    await this.backgroundRefreshPromise;
  }

  private async performBackgroundThreadPagesRefresh(): Promise<void> {
    try {
      await eyesOnAgentsEmitter.refreshThreadPages();
      this.applySnapshot(await eyesOnAgentsEmitter.getSnapshot());
    } catch {
      // Background refresh keeps the last valid snapshot and stays silent.
    }
  }

  private async performWindowActivationRefresh(): Promise<void> {
    const connection = this.snapshot?.connection;
    const shouldSyncCodex = connection?.state === 'connected'
      || Boolean(
        connection?.autoConnectEnabled
        && (connection.state === 'disconnected' || connection.state === 'error'),
    );
    if (shouldSyncCodex) await this.syncThreads();
    else if (this.snapshot?.claudeProvider?.enabled) {
      try {
        this.applySnapshot(await eyesOnAgentsEmitter.refreshClaudeInventory());
      } catch {
        this.applySnapshot(await eyesOnAgentsEmitter.getSnapshot());
      }
    } else {
      this.applySnapshot(await eyesOnAgentsEmitter.getSnapshot());
    }

    if (this.snapshot?.bridge.state !== 'not_installed') {
      await this.refreshCodexBridgeStatus().catch(() => undefined);
    }
    if (
      this.snapshot?.claudeProvider?.enabled
      && this.snapshot?.claudeBridge
      && this.snapshot.claudeBridge.state !== 'not_installed'
    ) {
      await this.refreshClaudeBridgeStatus().catch(() => undefined);
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

  private async runCommandAction(
    action: string,
    callback: () => Promise<unknown>,
  ): Promise<void> {
    if (this.busyAction) return;
    this.busyAction = action;
    this.actionError = null;
    try {
      await callback();
    } catch (error) {
      this.actionError = this.errorMessage(error);
      throw error;
    } finally {
      this.busyAction = null;
    }
  }

  private applySnapshot(snapshot: EyesOnAgentsSnapshot): void {
    const claudeProviderRevision = snapshot.claudeProvider?.revision ?? 0;
    if (claudeProviderRevision < this.highestClaudeProviderRevision) return;
    this.highestClaudeProviderRevision = claudeProviderRevision;
    this.snapshot = snapshot;
    this.loadError = null;
    this.reconcileAllProjectFilter();
    this.reconcileThreadSearchSelection();
  }

  private reconcileAllProjectFilter(): void {
    if (this.allProjectFilter.type !== 'project') return;
    const projectKey = this.allProjectFilter.projectKey;
    if (this.threads.some((thread) => thread.projectKey === projectKey)) return;
    this.allProjectFilter = { type: 'all' };
  }

  private reconcileThreadSearchSelection(): void {
    if (!this.threadSearchVisible) return;
    const results = this.threadSearchResults;
    if (
      this.threadSearchSelectedSessionKey
      && results.some((thread) => thread.sessionKey === this.threadSearchSelectedSessionKey)
    ) return;
    this.threadSearchSelectedSessionKey = results[0]?.sessionKey ?? null;
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
