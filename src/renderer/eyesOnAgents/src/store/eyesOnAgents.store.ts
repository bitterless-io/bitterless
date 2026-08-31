import { reactive } from 'vue';
import { useThrottleFn } from '@vueuse/core';
import type {
  EyesOnAgentsSnapshot,
  EyesOnAgentsSessionKey,
  EyesOnAgentsThread,
} from '@shared/eyesOnAgents/eyesOnAgents.type';
import {
  eyesOnAgentsEmitter,
  subscribeEyesOnAgentsChanges,
} from '../emitter/eyesOnAgents.emitter';

const isActiveRuntimeState = (thread: EyesOnAgentsThread): boolean =>
  thread.runtimeState === 'working'
  || thread.runtimeState === 'waiting_approval'
  || thread.runtimeState === 'waiting_input';

const attentionRank = (thread: EyesOnAgentsThread): number => {
  if (thread.runtimeState === 'waiting_approval') return 0;
  if (thread.runtimeState === 'waiting_input') return 1;
  if (thread.isUnread && !isActiveRuntimeState(thread)) return 2;
  if (thread.runtimeState === 'working') return 3;
  return 4;
};

const parsedTimestamp = (value: string | null): number => {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const presentationTimestamp = (thread: EyesOnAgentsThread): number => {
  if (isActiveRuntimeState(thread)) return parsedTimestamp(thread.statusObservedAt);
  return parsedTimestamp(thread.lastActivityAt ?? thread.lastCompletedAt);
};

const sortThreads = (threads: EyesOnAgentsThread[]): EyesOnAgentsThread[] =>
  [...threads].sort((left, right) => {
    const leftRank = attentionRank(left);
    const rightRank = attentionRank(right);
    const attention = leftRank - rightRank;
    if (attention !== 0) return attention;
    const timestamp = presentationTimestamp(right) - presentationTimestamp(left);
    if (timestamp !== 0) return timestamp;
    if (left.sessionKey === right.sessionKey) return 0;
    return left.sessionKey < right.sessionKey ? -1 : 1;
  });

const THREAD_TITLE_SEPARATOR_PATTERN = /[\s\-_.\/\\:|]+/u;
const MAX_ACTION_ERROR_LENGTH = 300;
const TITLE_QUERY_THROTTLE_MS = 120;

const tokenizeThreadTitle = (value: string): string[] =>
  value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .split(THREAD_TITLE_SEPARATOR_PATTERN)
    .filter(Boolean);

// Both caches live outside the reactive store so filling them cannot trigger a render.
const sortedThreadsBySnapshot = new WeakMap<EyesOnAgentsSnapshot, EyesOnAgentsThread[]>();
const titleTokensByThread = new WeakMap<
  EyesOnAgentsThread,
  { title: string; tokens: string[] }
>();

const sortedSnapshotThreads = (
  snapshot: EyesOnAgentsSnapshot | null,
  threads: EyesOnAgentsThread[],
): EyesOnAgentsThread[] => {
  if (snapshot === null) return sortThreads(threads);
  const cached = sortedThreadsBySnapshot.get(snapshot);
  if (cached) return cached;
  const sorted = sortThreads(threads);
  sortedThreadsBySnapshot.set(snapshot, sorted);
  return sorted;
};

const threadTitleTokens = (thread: EyesOnAgentsThread): string[] => {
  const title = thread.title;
  if (title === null) return [];
  const cached = titleTokensByThread.get(thread);
  if (cached && cached.title === title) return cached.tokens;
  const tokens = tokenizeThreadTitle(title);
  titleTokensByThread.set(thread, { title, tokens });
  return tokens;
};

class EyesOnAgentsState {
  snapshot: EyesOnAgentsSnapshot | null = null;
  loading = true;
  loadError: string | null = null;
  actionError: string | null = null;
  busyAction: string | null = null;
  openingSessionKeys = new Set<string>();
  titleDraft = '';
  titleQuery = '';
  threadSearchVisible = false;
  threadSearchSelectedSessionKey: EyesOnAgentsSessionKey | null = null;
  private titleQueryScheduler: (() => void) | null = null;
  private threadSearchLifecycleRevision = 0;
  private reloadRequested = false;
  private snapshotPromise: Promise<void> | null = null;
  private activationPromise: Promise<void> | null = null;
  private backgroundRefreshPromise: Promise<void> | null = null;
  private refreshTimer: number | null = null;
  private subscribed = false;
  private highestClaudeProviderRevision = -1;

  get threads(): EyesOnAgentsThread[] {
    return this.snapshot?.threads ?? [];
  }

  get focusThreads(): EyesOnAgentsThread[] {
    return sortedSnapshotThreads(this.snapshot, this.threads);
  }

  get threadSearchResults(): EyesOnAgentsThread[] {
    const threads = this.focusThreads;
    const queryTokens = tokenizeThreadTitle(this.titleQuery);
    if (queryTokens.length === 0) return [];
    return threads.filter((thread) => {
      if (thread.title === null) return false;
      const titleTokens = threadTitleTokens(thread);
      return queryTokens.every((queryToken) =>
        titleTokens.some((titleToken) => titleToken.includes(queryToken)));
    });
  }

  get hasThreadSearchQueryTokens(): boolean {
    return tokenizeThreadTitle(this.titleQuery).length > 0;
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

  configureTitleQueryScheduler(scheduler: (() => void) | null): void {
    this.titleQueryScheduler = scheduler;
  }

  setTitleDraft(value: string): void {
    if (this.titleDraft === value) return;
    this.titleDraft = value;
    if (this.titleQueryScheduler === null) {
      this.commitTitleQuery();
      return;
    }
    this.titleQueryScheduler();
  }

  // Reads the current draft instead of a captured value, so a trailing run always
  // publishes the newest input and no earlier keystroke can land after it.
  commitTitleQuery(): void {
    if (this.titleQuery !== this.titleDraft) this.titleQuery = this.titleDraft;
    this.reconcileThreadSearchSelection();
  }

  clearTitleQuery(): void {
    this.titleDraft = '';
    this.titleQuery = '';
    this.reconcileThreadSearchSelection();
  }

  openThreadSearch(): void {
    if (this.threadSearchVisible) return;
    this.threadSearchLifecycleRevision += 1;
    this.titleDraft = '';
    this.titleQuery = '';
    this.threadSearchSelectedSessionKey = null;
    this.threadSearchVisible = true;
  }

  closeThreadSearch(): void {
    this.threadSearchLifecycleRevision += 1;
    this.threadSearchVisible = false;
    this.titleDraft = '';
    this.titleQuery = '';
    this.threadSearchSelectedSessionKey = null;
  }

  toggleThreadSearch(): void {
    if (this.threadSearchVisible) {
      this.closeThreadSearch();
      return;
    }
    this.openThreadSearch();
  }

  selectThreadSearchResult(sessionKey: EyesOnAgentsSessionKey): void {
    this.commitTitleQuery();
    if (!this.threadSearchResults.some((thread) => thread.sessionKey === sessionKey)) return;
    this.threadSearchSelectedSessionKey = sessionKey;
  }

  moveThreadSearchSelection(delta: -1 | 1): void {
    this.commitTitleQuery();
    const results = this.threadSearchResults;
    if (results.length === 0) {
      this.threadSearchSelectedSessionKey = null;
      return;
    }

    const selectedIndex = results.findIndex(
      (thread) => thread.sessionKey === this.threadSearchSelectedSessionKey,
    );
    const currentIndex = selectedIndex < 0 ? 0 : selectedIndex;
    const nextIndex = (currentIndex + delta + results.length) % results.length;
    this.threadSearchSelectedSessionKey = results[nextIndex]?.sessionKey ?? null;
  }

  async openSelectedThreadSearchResult(): Promise<void> {
    this.commitTitleQuery();
    const sessionKey = this.threadSearchSelectedSessionKey;
    if (!sessionKey) return;
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

  async setClaudeLastUserPromptCaptureEnabled(enabled: boolean): Promise<void> {
    await this.runSnapshotAction('claude-prompt-retention', () =>
      eyesOnAgentsEmitter.setClaudeLastUserPromptCaptureEnabled({ enabled }),
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
    const threadSearchRevision = this.threadSearchVisible
      ? this.threadSearchLifecycleRevision
      : null;
    this.openingSessionKeys = new Set(this.openingSessionKeys).add(sessionKey);
    this.actionError = null;
    try {
      const result = await eyesOnAgentsEmitter.openThread({ sessionKey });
      this.applySnapshot(result.snapshot);
      if (
        threadSearchRevision !== null
        && this.threadSearchVisible
        && this.threadSearchLifecycleRevision === threadSearchRevision
      ) {
        this.closeThreadSearch();
      }
    } catch (error) {
      this.actionError = this.errorMessage(error);
      throw error;
    } finally {
      const next = new Set(this.openingSessionKeys);
      next.delete(sessionKey);
      this.openingSessionKeys = next;
    }
  }

  async copySessionPath(sessionKey: EyesOnAgentsSessionKey): Promise<void> {
    const thread = this.threads.find((item) => item.sessionKey === sessionKey);
    if (!thread?.canCopySessionPath) return;
    await this.runCommandAction('session-path-copy', () =>
      eyesOnAgentsEmitter.copySessionPath({ sessionKey }),
    );
  }

  async setThreadUnread(
    sessionKey: EyesOnAgentsSessionKey,
    isUnread: boolean,
  ): Promise<void> {
    const thread = this.threads.find((item) => item.sessionKey === sessionKey);
    if (!thread || thread.isUnread === isUnread) return;
    await this.runSnapshotAction(`thread-read-state:${sessionKey}`, () =>
      eyesOnAgentsEmitter.setThreadUnread({ sessionKey, isUnread }),
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
    callback: () => Promise<EyesOnAgentsSnapshot | null>,
  ): Promise<void> {
    if (this.busyAction) return;
    this.busyAction = action;
    this.actionError = null;
    try {
      const snapshot = await callback();
      if (snapshot === null) {
        let refreshError: unknown = null;
        try {
          const refreshed = await eyesOnAgentsEmitter.getSnapshot();
          if (refreshed !== null) this.applySnapshot(refreshed);
        } catch (error) {
          refreshError = error;
        }
        const refreshedError = action.startsWith('claude-')
          ? this.snapshot?.claudeBridge.error ?? this.snapshot?.claudeProvider.error
          : null;
        const message = refreshedError ?? (refreshError === null
          ? 'EyesOnAgents action returned no snapshot'
          : this.errorMessage(refreshError));
        throw new Error(message.slice(0, MAX_ACTION_ERROR_LENGTH));
      }
      this.applySnapshot(snapshot);
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
    this.reconcileThreadSearchSelection();
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

export const createEyesOnAgentsTitleQueryScheduler = (run: () => void): (() => void) =>
  useThrottleFn(run, TITLE_QUERY_THROTTLE_MS, true, true);

eyesOnAgentsStore.configureTitleQueryScheduler(
  createEyesOnAgentsTitleQueryScheduler(() => {
    eyesOnAgentsStore.commitTitleQuery();
  }),
);
