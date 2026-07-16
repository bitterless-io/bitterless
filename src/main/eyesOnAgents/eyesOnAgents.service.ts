import type { SettingDao } from '@preload/sqlite/dao/setting.dao';
import type {
  EyesOnAgentsApi,
  EyesOnAgentsBridgeStatus,
  EyesOnAgentsDiscoveredThread,
  EyesOnAgentsRepositoryApi,
  EyesOnAgentsRuntimeEvent,
  EyesOnAgentsSnapshot
} from '@shared/eyesOnAgents/eyesOnAgents.type';
import {
  buildEyesOnAgentsDeepLink,
  effectiveEyesOnAgentsRuntimeState,
  isEyesOnAgentsFocused,
  isEyesOnAgentsRecord,
  normalizeEyesOnAgentsThreadStatus,
  parseEyesOnAgentsPath,
  parseEyesOnAgentsText,
  parseEyesOnAgentsUuid
} from '@shared/eyesOnAgents/eyesOnAgents.contract';
import type { CodexHookEvent } from '@shared/eyesOnAgents/codexHookBridge.type';
import type { CodexAppServerSupervisor } from './codexAppServer.supervisor';

interface EyesOnAgentsServiceDependencies {
  repository: EyesOnAgentsRepositoryApi;
  settings: Pick<SettingDao, 'get' | 'upsert'>;
  appServer: CodexAppServerSupervisor;
  desktopBridge: {
    getStatus(): EyesOnAgentsBridgeStatus;
    install(): EyesOnAgentsBridgeStatus;
    remove(): EyesOnAgentsBridgeStatus;
    updateHookInspection(hooks: Awaited<ReturnType<CodexAppServerSupervisor['listHooks']>>): void;
    setHookInspectionError(error: unknown): void;
  };
  bridgeListener: {
    start(): Promise<void>;
    stop(): Promise<void>;
  };
  openExternal: (url: string) => Promise<void>;
  broadcastChanged?: () => void;
  now?: () => number;
}

const AUTO_CONNECT_SETTING_KEY = 'eyes_on_agents';
const AUTO_CONNECT_SETTING_SUB_KEY = 'app_server_auto_connect';

const parseProviderTimestamp = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  const milliseconds = value < 10_000_000_000 ? value * 1000 : value;
  return Number.isSafeInteger(milliseconds) ? milliseconds : Math.floor(milliseconds);
};

const turnIdFrom = (value: unknown): string | null => {
  if (!isEyesOnAgentsRecord(value)) return null;
  try {
    return parseEyesOnAgentsText(value.id, 'turn id', 200);
  } catch {
    return null;
  }
};

const threadIdFromNotification = (params: Record<string, unknown>): string => {
  return parseEyesOnAgentsUuid(params.threadId, 'notification threadId');
};

const completedOutcome = (turn: unknown): 'completed' | 'failed' | 'interrupted' => {
  if (!isEyesOnAgentsRecord(turn)) return 'completed';
  const status = turn.status;
  const type = isEyesOnAgentsRecord(status) ? status.type : status;
  if (type === 'failed') return 'failed';
  if (type === 'interrupted' || type === 'cancelled') return 'interrupted';
  return 'completed';
};

const parseThreadEntry = (
  value: unknown,
  observedAt: number
): EyesOnAgentsDiscoveredThread | null => {
  if (!isEyesOnAgentsRecord(value)) return null;
  try {
    const normalizedStatus = normalizeEyesOnAgentsThreadStatus(value.status);
    const providerActivity = parseProviderTimestamp(value.updatedAt) ??
      parseProviderTimestamp(value.createdAt);
    const name = parseEyesOnAgentsText(value.name, 'thread name', 300);
    const preview = parseEyesOnAgentsText(value.preview, 'thread preview', 300);
    return {
      threadId: parseEyesOnAgentsUuid(value.id, 'Codex thread id'),
      title: name ?? preview,
      cwd: parseEyesOnAgentsPath(value.cwd),
      runtimeState: normalizedStatus.runtimeState,
      activeFlags: normalizedStatus.activeFlags,
      statusSource: normalizedStatus.statusSource,
      statusObservedAt: observedAt,
      lastActivityAt: providerActivity
    };
  } catch {
    return null;
  }
};

export class EyesOnAgentsService implements EyesOnAgentsApi {
  private readonly now: () => number;
  private autoConnectEnabled = false;
  private desktopObservationPromise: Promise<void> | null = null;

  constructor(private readonly dependencies: EyesOnAgentsServiceDependencies) {
    this.now = dependencies.now ?? Date.now;
  }

  async initialize(): Promise<void> {
    this.autoConnectEnabled = (await this.dependencies.settings.get<boolean>({
      key: AUTO_CONNECT_SETTING_KEY,
      sub_key: AUTO_CONNECT_SETTING_SUB_KEY
    })) === true;
    if (!this.autoConnectEnabled) return;
    try {
      await this.ensureDesktopObservation();
      await this.ensureAppServerConnected();
      await this.performSync();
    } catch {
      // The connection status carries the truthful error for the renderer. Startup continues.
    }
  }

  async shutdown(): Promise<void> {
    try {
      await this.dependencies.appServer.disconnect();
    } finally {
      await this.dependencies.bridgeListener.stop();
    }
  }

  async getSnapshot(): Promise<EyesOnAgentsSnapshot> {
    const persisted = await this.dependencies.repository.getSnapshot();
    const connection = this.dependencies.appServer.getStatus(this.autoConnectEnabled);
    const connected = this.dependencies.appServer.isConnected();
    const bridge = this.bridgeStatus();
    const listeningSince = bridge.listeningSince === null
      ? null
      : Date.parse(bridge.listeningSince);
    const threads = persisted.threads.map((thread) => {
      const observedAt = thread.statusObservedAt === null
        ? null
        : Date.parse(thread.statusObservedAt);
      const runtimeState = effectiveEyesOnAgentsRuntimeState({
        runtimeState: thread.runtimeState,
        statusSource: thread.statusSource,
        statusObservedAt: Number.isFinite(observedAt) ? observedAt : null,
        managedServerConnected: connected,
        hookBridgeState: bridge.state,
        hookBridgeListening: bridge.listening,
        hookBridgeListeningSince: Number.isFinite(listeningSince) ? listeningSince : null
      });
      return {
        ...thread,
        runtimeState,
        isFocused: isEyesOnAgentsFocused(runtimeState, thread.isUnread)
      };
    });
    return {
      domains: persisted.domains,
      threads,
      connection,
      bridge,
      lastSyncedAt: connection.lastSyncedAt
    };
  }

  async connectAppServer(): Promise<EyesOnAgentsSnapshot> {
    await this.ensureDesktopObservation();
    await this.ensureAppServerConnected();
    this.autoConnectEnabled = true;
    await this.dependencies.settings.upsert({
      key: AUTO_CONNECT_SETTING_KEY,
      sub_key: AUTO_CONNECT_SETTING_SUB_KEY,
      value: true
    });
    await this.performSync();
    return await this.getSnapshot();
  }

  async disconnectAppServer(): Promise<EyesOnAgentsSnapshot> {
    this.autoConnectEnabled = false;
    await this.dependencies.settings.upsert({
      key: AUTO_CONNECT_SETTING_KEY,
      sub_key: AUTO_CONNECT_SETTING_SUB_KEY,
      value: false
    });
    try {
      await this.dependencies.appServer.disconnect();
    } finally {
      try {
        await this.dependencies.bridgeListener.stop();
      } finally {
        this.dependencies.desktopBridge.remove();
        await this.invalidateCodexHookStatuses();
      }
    }
    this.notify();
    return await this.getSnapshot();
  }

  async syncThreads(): Promise<EyesOnAgentsSnapshot> {
    await this.ensureDesktopObservation();
    await this.ensureAppServerConnected();
    await this.performSync();
    return await this.getSnapshot();
  }

  private async ensureAppServerConnected(): Promise<void> {
    if (this.dependencies.appServer.isConnected()) return;
    await this.dependencies.repository.invalidateAppServerStatuses({ observedAt: this.now() });
    await this.dependencies.appServer.connect();
  }

  private async ensureDesktopObservation(): Promise<void> {
    if (this.desktopObservationPromise) return await this.desktopObservationPromise;
    this.desktopObservationPromise = this.performEnsureDesktopObservation();
    try {
      await this.desktopObservationPromise;
    } finally {
      this.desktopObservationPromise = null;
    }
  }

  private async performEnsureDesktopObservation(): Promise<void> {
    const wasListening = this.bridgeStatus().listening;
    if (!wasListening) await this.invalidateCodexHookStatuses();
    await this.dependencies.bridgeListener.start();
    const current = this.bridgeStatus();
    const status = current.state === 'installed' || current.state === 'needs_trust'
      ? current
      : this.dependencies.desktopBridge.install();
    if (status.state !== 'installed') await this.invalidateCodexHookStatuses();
    if (status.state !== 'installed' && status.state !== 'needs_trust') {
      throw new Error(status.error ?? 'Unable to install the Codex Desktop bridge');
    }
  }

  private async invalidateCodexHookStatuses(): Promise<void> {
    await this.dependencies.repository.invalidateCodexHookStatuses({ observedAt: this.now() });
  }

  private async refreshBridgeInspection(): Promise<void> {
    try {
      this.dependencies.desktopBridge.updateHookInspection(
        await this.dependencies.appServer.listHooks()
      );
    } catch (error) {
      this.dependencies.desktopBridge.setHookInspectionError(error);
    }
    if (this.bridgeStatus().state !== 'installed') await this.invalidateCodexHookStatuses();
  }

  private async performSync(): Promise<void> {
    await this.refreshBridgeInspection();
    const entries = await this.dependencies.appServer.listThreads();
    const observedAt = this.now();
    const threads = entries.flatMap((entry) => {
      const parsed = parseThreadEntry(entry, observedAt);
      return parsed ? [parsed] : [];
    });
    await this.dependencies.repository.upsertDiscoveredThreads({ threads });
    this.notify();
  }

  async openThread(params: { threadId: string }): Promise<{
    url: string;
    snapshot: EyesOnAgentsSnapshot;
  }> {
    const threadId = parseEyesOnAgentsUuid(params?.threadId);
    const url = buildEyesOnAgentsDeepLink(threadId);
    await this.dependencies.openExternal(url);
    await this.dependencies.repository.markOpened({ threadId, openedAt: this.now() });
    this.notify();
    return { url, snapshot: await this.getSnapshot() };
  }

  async createDomain(params: { title: string }): Promise<EyesOnAgentsSnapshot> {
    await this.dependencies.repository.createDomain(params);
    return await this.changedSnapshot();
  }

  async renameDomain(params: { domainId: number; title: string }): Promise<EyesOnAgentsSnapshot> {
    await this.dependencies.repository.renameDomain(params);
    return await this.changedSnapshot();
  }

  async deleteDomain(params: { domainId: number }): Promise<EyesOnAgentsSnapshot> {
    await this.dependencies.repository.deleteDomain(params);
    return await this.changedSnapshot();
  }

  async reorderDomains(params: { domainIds: number[] }): Promise<EyesOnAgentsSnapshot> {
    await this.dependencies.repository.reorderDomains(params);
    return await this.changedSnapshot();
  }

  async moveThread(params: { threadId: string; domainId: number }): Promise<EyesOnAgentsSnapshot> {
    await this.dependencies.repository.moveThread(params);
    return await this.changedSnapshot();
  }

  private async changedSnapshot(): Promise<EyesOnAgentsSnapshot> {
    this.notify();
    return await this.getSnapshot();
  }

  async installCodexBridge(): Promise<EyesOnAgentsSnapshot> {
    await this.ensureDesktopObservation();
    if (this.dependencies.appServer.isConnected()) await this.refreshBridgeInspection();
    return await this.changedSnapshot();
  }

  async removeCodexBridge(): Promise<EyesOnAgentsSnapshot> {
    if (this.dependencies.appServer.isConnected() || this.autoConnectEnabled) {
      throw new Error('Disconnect EyesOnAgents before cleaning up the Codex Desktop bridge');
    }
    try {
      await this.dependencies.bridgeListener.stop();
    } finally {
      this.dependencies.desktopBridge.remove();
      await this.invalidateCodexHookStatuses();
    }
    return await this.changedSnapshot();
  }

  async getCodexBridgeStatus(): Promise<EyesOnAgentsBridgeStatus> {
    return this.bridgeStatus();
  }

  private bridgeStatus(): EyesOnAgentsBridgeStatus {
    return this.dependencies.desktopBridge.getStatus();
  }

  async handleAppServerNotification(method: string, paramsValue: unknown): Promise<void> {
    if (!isEyesOnAgentsRecord(paramsValue)) return;
    const observedAt = this.now();
    let event: EyesOnAgentsRuntimeEvent | null = null;
    try {
      const threadId = threadIdFromNotification(paramsValue);
      if (method === 'thread/status/changed') {
        const normalized = normalizeEyesOnAgentsThreadStatus(paramsValue.status);
        event = {
          type: 'thread_status',
          threadId,
          runtimeState: normalized.runtimeState,
          activeFlags: normalized.activeFlags,
          observedAt,
          source: 'app_server'
        };
      } else if (method === 'turn/started') {
        event = {
          type: 'turn_started',
          threadId,
          turnId: turnIdFrom(paramsValue.turn),
          observedAt,
          source: 'app_server'
        };
      } else if (method === 'turn/completed') {
        event = {
          type: 'turn_completed',
          threadId,
          turnId: turnIdFrom(paramsValue.turn),
          outcome: completedOutcome(paramsValue.turn),
          observedAt,
          source: 'app_server'
        };
      }
    } catch {
      return;
    }
    if (!event) return;
    await this.dependencies.repository.applyRuntimeEvent({ event });
    this.notify();
  }

  async applyCodexHookEvent(event: CodexHookEvent): Promise<void> {
    const bridge = this.bridgeStatus();
    const listeningSince = bridge.listeningSince === null
      ? Number.NaN
      : Date.parse(bridge.listeningSince);
    if (
      bridge.state !== 'installed' ||
      !bridge.listening ||
      !Number.isFinite(listeningSince) ||
      event.occurredAt < listeningSince
    ) {
      return;
    }
    const base = {
      threadId: event.payload.sessionId,
      turnId: event.payload.turnId,
      cwd: event.payload.cwd,
      observedAt: event.occurredAt,
      source: 'codex_hook' as const
    };
    let runtimeEvent: EyesOnAgentsRuntimeEvent;
    if (event.payload.hookEventName === 'UserPromptSubmit') {
      runtimeEvent = { type: 'turn_started', ...base };
    } else if (event.payload.hookEventName === 'PermissionRequest') {
      runtimeEvent = {
        type: 'thread_status',
        ...base,
        runtimeState: 'waiting_approval',
        activeFlags: ['waitingOnApproval']
      };
    } else if (event.payload.hookEventName === 'Stop') {
      runtimeEvent = { type: 'turn_completed', ...base, outcome: 'completed' };
    } else {
      runtimeEvent = {
        type: 'thread_status',
        ...base,
        runtimeState: 'idle',
        activeFlags: []
      };
    }
    await this.dependencies.repository.applyRuntimeEvent({ event: runtimeEvent });
    this.notify();
  }

  private notify(): void {
    this.dependencies.broadcastChanged?.();
  }
}
