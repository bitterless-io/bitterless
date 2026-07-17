import type { SettingDao } from '@preload/sqlite/dao/setting.dao';
import type {
  EyesOnAgentsApi,
  EyesOnAgentsBridgeStatus,
  EyesOnAgentsDiscoveredThread,
  EyesOnAgentsRepositoryApi,
  EyesOnAgentsRuntimeDeliveryResult,
  EyesOnAgentsRuntimeEvent,
  EyesOnAgentsSnapshot,
  EyesOnAgentsThreadSnapshot
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
import { parseCodexHookDelivery } from '@shared/eyesOnAgents/codexHookBridge.contract';
import type {
  CodexHookDelivery,
  CodexHookEvent
} from '@shared/eyesOnAgents/codexHookBridge.type';
import type { CodexAppServerSupervisor } from './codexAppServer.supervisor';
import {
  projectMetadataFromResolution,
  resolveEyesOnAgentsProject,
  type EyesOnAgentsProjectResolution
} from './projectResolver.service';

interface EyesOnAgentsServiceDependencies {
  repository: EyesOnAgentsRepositoryApi;
  settings: Pick<SettingDao, 'get' | 'upsert'>;
  appServer: CodexAppServerSupervisor;
  desktopBridge: {
    getStatus(): EyesOnAgentsBridgeStatus;
    hasInstallationIntent(): boolean;
    hasExactInstallation(): boolean;
    refreshInstalledArtifacts(): EyesOnAgentsBridgeStatus;
    getDisabledExactHookKeys(): string[];
    install(): EyesOnAgentsBridgeStatus;
    remove(): EyesOnAgentsBridgeStatus;
    updateHookInspection(hooks: Awaited<ReturnType<CodexAppServerSupervisor['listHooks']>>): void;
    setHookInspectionError(error: unknown): void;
    setOperationalError(error: unknown): void;
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
const MAX_PENDING_CODEX_HOOK_EVENTS = 256;

type HookInspectionState =
  | 'uninspected'
  | 'pending'
  | 'flushing'
  | 'trusted'
  | 'rejected';

interface HookListenerLifetime {
  listeningSince: number;
  admissionEpoch: number;
  inspectionState: HookInspectionState;
  pendingEvents: PendingCodexHookEvent[];
  overflowed: boolean;
}

interface HookDeliveryCompletion {
  resolve: (result: EyesOnAgentsRuntimeDeliveryResult) => void;
  reject: (error: unknown) => void;
}

interface PendingCodexHookEvent {
  event: CodexHookEvent;
  deliveryId: string | null;
  completion: HookDeliveryCompletion | null;
}

type HookWriteResult = EyesOnAgentsRuntimeDeliveryResult | undefined;

type CancellableResult<T> =
  | { state: 'resolved'; value: T }
  | { state: 'rejected'; error: unknown }
  | { state: 'cancelled' };

type HookFlushResult = 'trusted' | 'rejected' | 'replaced' | 'cancelled';

interface ObservationContext {
  intentVersion: number;
  controller: AbortController;
  hookWriteTail: Promise<void>;
}

interface AppServerContext {
  intentVersion: number;
  controller: AbortController;
}

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

const parseThreadSnapshot = (
  value: unknown,
  archived: boolean,
  syncedAt: number
): EyesOnAgentsThreadSnapshot | null => {
  if (!isEyesOnAgentsRecord(value)) return null;
  try {
    const payloadJson = JSON.stringify(value);
    if (typeof payloadJson !== 'string') return null;
    return {
      threadId: parseEyesOnAgentsUuid(value.id, 'Codex thread id'),
      payloadJson,
      archived,
      syncedAt
    };
  } catch {
    return null;
  }
};

export class EyesOnAgentsService implements EyesOnAgentsApi {
  private readonly now: () => number;
  private autoConnectEnabled = false;
  private appServerIntentVersion = 0;
  private appServerLifecycleVersion = 0;
  private appServerContext: AppServerContext | null = null;
  private appServerConnectPromise: Promise<void> | null = null;
  private appServerTeardownPromise: Promise<void> | null = null;
  private appServerTeardownDisableAutoConnectRequested = false;
  private observationIntentVersion = 0;
  private observationContext: ObservationContext | null = null;
  private desktopObservationPromise: Promise<void> | null = null;
  private desktopTeardownPromise: Promise<void> | null = null;
  private bridgeInspectionPromise: Promise<void> | null = null;
  private hookListenerLifetime: HookListenerLifetime | null = null;
  private hookIntakeEnabled = false;
  private hookCoverageGapDetected = false;
  private teardownRemoveBridgeRequested = false;
  private readonly activeObservationOperations = new Set<Promise<void>>();
  private readonly activeHookOperations = new Set<Promise<unknown>>();
  private readonly activeAppServerOperations = new Set<Promise<void>>();
  private readonly activeAppServerRuntimeOperations = new Set<Promise<void>>();

  constructor(private readonly dependencies: EyesOnAgentsServiceDependencies) {
    this.now = dependencies.now ?? Date.now;
  }

  async initialize(): Promise<void> {
    const appServerIntentVersion = this.appServerLifecycleVersion;
    const observationIntentVersion = this.observationIntentVersion;
    const autoConnectEnabled = (await this.dependencies.settings.get<boolean>({
      key: AUTO_CONNECT_SETTING_KEY,
      sub_key: AUTO_CONNECT_SETTING_SUB_KEY
    })) === true;
    if (
      appServerIntentVersion !== this.appServerLifecycleVersion ||
      observationIntentVersion !== this.observationIntentVersion
    ) {
      return;
    }
    this.autoConnectEnabled = autoConnectEnabled;
    try {
      if (this.dependencies.desktopBridge.hasInstallationIntent()) {
        await this.runObservationOperation(observationIntentVersion, async (context) => {
          await this.ensureDesktopObservation(context, false);
        });
      }
      if (autoConnectEnabled) {
        await this.runAppServerOperation(appServerIntentVersion, async (context) => {
          if (!await this.ensureAppServerConnected(context)) return;
          await this.performSync(context);
        });
      } else {
        const context = this.observationContext;
        if (context && this.isObservationActive(context)) {
          await this.refreshBridgeInspection(context);
        }
      }
    } catch {
      // The connection status carries the truthful error for the renderer. Startup continues.
    }
  }

  async shutdown(): Promise<void> {
    const observationTeardown = this.requestDesktopTeardown({ removeBridge: false });
    const appServerTeardown = this.requestAppServerTeardown({ disableAutoConnect: false });
    await observationTeardown;
    await appServerTeardown;
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
    if (this.appServerTeardownPromise) {
      await this.appServerTeardownPromise;
      return await this.getSnapshot();
    }
    this.appServerIntentVersion += 1;
    const intentVersion = this.appServerLifecycleVersion;
    await this.ensureInstalledObservationActive();
    await this.runAppServerOperation(intentVersion, async (context) => {
      if (!await this.ensureAppServerConnected(context)) return;
      await this.dependencies.settings.upsert({
        key: AUTO_CONNECT_SETTING_KEY,
        sub_key: AUTO_CONNECT_SETTING_SUB_KEY,
        value: true
      });
      if (!this.isAppServerActive(context)) return;
      this.autoConnectEnabled = true;
      await this.performSync(context);
    });
    return await this.getSnapshot();
  }

  async disconnectAppServer(): Promise<EyesOnAgentsSnapshot> {
    this.appServerIntentVersion += 1;
    await this.requestAppServerTeardown({ disableAutoConnect: true });
    this.notify();
    return await this.getSnapshot();
  }

  async syncThreads(): Promise<EyesOnAgentsSnapshot> {
    if (this.appServerTeardownPromise) {
      await this.appServerTeardownPromise;
      return await this.getSnapshot();
    }
    const intentVersion = this.appServerLifecycleVersion;
    await this.ensureInstalledObservationActive();
    await this.runAppServerOperation(intentVersion, async (context) => {
      if (!await this.ensureAppServerConnected(context)) return;
      await this.performSync(context);
    });
    return await this.getSnapshot();
  }

  private async ensureInstalledObservationActive(): Promise<void> {
    if (!this.dependencies.desktopBridge.hasInstallationIntent()) return;
    const intentVersion = this.observationIntentVersion;
    await this.runObservationOperation(intentVersion, async (context) => {
      await this.ensureDesktopObservation(context, false);
    });
  }

  private async runAppServerOperation(
    intentVersion: number,
    callback: (context: AppServerContext) => Promise<void>
  ): Promise<void> {
    if (this.appServerTeardownPromise) {
      await this.appServerTeardownPromise;
      return;
    }
    if (intentVersion !== this.appServerLifecycleVersion) return;
    let context = this.appServerContext;
    if (
      context === null ||
      context.intentVersion !== intentVersion ||
      context.controller.signal.aborted
    ) {
      context = {
        intentVersion,
        controller: new AbortController()
      };
      this.appServerContext = context;
    }
    const operation = callback(context);
    this.activeAppServerOperations.add(operation);
    try {
      await operation;
    } finally {
      this.activeAppServerOperations.delete(operation);
    }
  }

  private async runObservationOperation(
    intentVersion: number,
    callback: (context: ObservationContext) => Promise<void>
  ): Promise<void> {
    if (this.desktopTeardownPromise) {
      await this.desktopTeardownPromise;
      return;
    }
    if (intentVersion !== this.observationIntentVersion) return;
    let context = this.observationContext;
    if (
      context === null ||
      context.intentVersion !== intentVersion ||
      context.controller.signal.aborted
    ) {
      context = {
        intentVersion,
        controller: new AbortController(),
        hookWriteTail: Promise.resolve()
      };
      this.observationContext = context;
    }
    this.hookIntakeEnabled = true;
    const operation = callback(context);
    this.activeObservationOperations.add(operation);
    try {
      await operation;
    } finally {
      this.activeObservationOperations.delete(operation);
    }
  }

  private async ensureAppServerConnected(context: AppServerContext): Promise<boolean> {
    if (!this.isAppServerActive(context)) return false;
    if (this.dependencies.appServer.isConnected()) return true;
    await this.dependencies.repository.invalidateAppServerStatuses({ observedAt: this.now() });
    if (!this.isAppServerActive(context)) return false;
    if (!this.appServerConnectPromise) {
      const operation = this.dependencies.appServer.connect();
      this.appServerConnectPromise = operation;
      const clear = (): void => {
        if (this.appServerConnectPromise === operation) this.appServerConnectPromise = null;
      };
      void operation.then(clear, clear);
    }
    const connected = await this.awaitUnlessCancelled(
      this.appServerConnectPromise,
      context.controller.signal
    );
    if (connected.state === 'rejected') throw connected.error;
    return connected.state === 'resolved' && this.isAppServerActive(context);
  }

  private async ensureDesktopObservation(
    context: ObservationContext,
    installOrRepair: boolean
  ): Promise<void> {
    if (!this.isObservationActive(context)) return;
    if (this.desktopObservationPromise) {
      await this.desktopObservationPromise;
    } else {
      const operation = this.performEnsureDesktopObservation(context, installOrRepair);
      this.desktopObservationPromise = operation;
      try {
        await operation;
      } finally {
        if (this.desktopObservationPromise === operation) {
          this.desktopObservationPromise = null;
        }
      }
    }
  }

  private async performEnsureDesktopObservation(
    context: ObservationContext,
    installOrRepair: boolean
  ): Promise<void> {
    if (!this.isObservationActive(context)) return;
    const initial = this.bridgeStatus();
    const wasListening = initial.listening;
    let status = initial;
    if (installOrRepair) {
      status = this.dependencies.desktopBridge.install();
      if (status.state !== 'installed' && status.state !== 'needs_trust') {
        throw new Error(status.error ?? 'Unable to install the Codex Desktop bridge');
      }
    } else if (!this.dependencies.desktopBridge.hasInstallationIntent()) {
      return;
    } else {
      this.dependencies.desktopBridge.refreshInstalledArtifacts();
      if (!this.dependencies.desktopBridge.hasExactInstallation()) return;
    }
    if (!wasListening) {
      this.resetHookListenerLifetime();
    }
    if (wasListening) {
      this.currentHookListenerLifetime();
      return;
    }
    await this.invalidateCodexHookStatuses();
    if (!this.isObservationActive(context)) return;
    await this.dependencies.bridgeListener.start();
    if (!this.isObservationActive(context)) return;
    this.currentHookListenerLifetime();
  }

  private async invalidateCodexHookStatuses(): Promise<void> {
    await this.dependencies.repository.invalidateCodexHookStatuses({ observedAt: this.now() });
  }

  private resetHookListenerLifetime(): void {
    if (this.hookListenerLifetime) {
      this.rejectPendingCodexHookEvents(
        this.hookListenerLifetime,
        new Error('Codex hook listener lifetime ended before delivery committed')
      );
    }
    this.hookListenerLifetime = null;
  }

  private isObservationActive(context: ObservationContext): boolean {
    return this.hookIntakeEnabled &&
      !context.controller.signal.aborted &&
      this.observationContext === context &&
      this.observationIntentVersion === context.intentVersion;
  }

  private isAppServerActive(context: AppServerContext): boolean {
    return !context.controller.signal.aborted &&
      this.appServerContext === context &&
      this.appServerLifecycleVersion === context.intentVersion;
  }

  private async joinDesktopObservationWork(): Promise<void> {
    for (;;) {
      const pending = new Set<Promise<unknown>>([
        ...this.activeObservationOperations,
        ...this.activeHookOperations
      ]);
      if (this.desktopObservationPromise) pending.add(this.desktopObservationPromise);
      if (this.bridgeInspectionPromise) pending.add(this.bridgeInspectionPromise);
      if (pending.size === 0) return;
      await Promise.allSettled([...pending]);
    }
  }

  private async performDesktopTeardown(): Promise<void> {
    let teardownError: unknown = null;
    const settle = async (operation: Promise<unknown>): Promise<void> => {
      try {
        await operation;
      } catch (error) {
        teardownError ??= error;
      }
    };
    if (this.desktopObservationPromise) {
      await settle(this.desktopObservationPromise);
    }
    await settle(this.dependencies.bridgeListener.stop());
    await this.joinDesktopObservationWork();
    this.resetHookListenerLifetime();
    let removedBridge = false;
    for (;;) {
      if (this.teardownRemoveBridgeRequested && !removedBridge) {
        try {
          this.dependencies.desktopBridge.remove();
        } catch (error) {
          teardownError ??= error;
        }
        removedBridge = true;
      }
      await settle(this.invalidateCodexHookStatuses());
      if (removedBridge === this.teardownRemoveBridgeRequested) {
        break;
      }
    }
    if (this.observationContext?.controller.signal.aborted) {
      this.observationContext = null;
    }
    if (teardownError) throw teardownError;
  }

  private requestDesktopTeardown(params: {
    removeBridge: boolean;
  }): Promise<void> {
    this.observationIntentVersion += 1;
    this.teardownRemoveBridgeRequested ||= params.removeBridge;
    this.hookIntakeEnabled = false;
    this.observationContext?.controller.abort();
    this.resetHookListenerLifetime();
    if (this.desktopTeardownPromise) return this.desktopTeardownPromise;
    const operation = this.performDesktopTeardown();
    this.desktopTeardownPromise = operation;
    const clear = (): void => {
      if (this.desktopTeardownPromise !== operation) return;
      this.desktopTeardownPromise = null;
      this.teardownRemoveBridgeRequested = false;
    };
    void operation.then(clear, clear);
    return operation;
  }

  private async teardownDesktopObservation(removeBridge: boolean): Promise<void> {
    await this.requestDesktopTeardown({ removeBridge });
  }

  private async joinAppServerWork(): Promise<void> {
    for (;;) {
      const pending = new Set<Promise<unknown>>([
        ...this.activeAppServerOperations,
        ...this.activeAppServerRuntimeOperations
      ]);
      if (pending.size === 0) return;
      await Promise.allSettled([...pending]);
    }
  }

  private async performAppServerTeardown(): Promise<void> {
    let teardownError: unknown = null;
    const settle = async (operation: Promise<unknown>): Promise<void> => {
      try {
        await operation;
      } catch (error) {
        teardownError ??= error;
      }
    };
    if (this.bridgeInspectionPromise) {
      await settle(this.bridgeInspectionPromise);
    }
    const disconnectOperation = this.dependencies.appServer.disconnect();
    if (this.appServerConnectPromise) {
      await settle(this.appServerConnectPromise);
    }
    await this.joinAppServerWork();
    await settle(disconnectOperation);
    await settle(this.dependencies.appServer.disconnect());
    let disabledAutoConnect = false;
    for (;;) {
      if (this.appServerTeardownDisableAutoConnectRequested && !disabledAutoConnect) {
        await settle(this.dependencies.settings.upsert({
          key: AUTO_CONNECT_SETTING_KEY,
          sub_key: AUTO_CONNECT_SETTING_SUB_KEY,
          value: false
        }));
        disabledAutoConnect = true;
      }
      if (disabledAutoConnect === this.appServerTeardownDisableAutoConnectRequested) break;
    }
    if (this.appServerContext?.controller.signal.aborted) {
      this.appServerContext = null;
    }
    if (teardownError) throw teardownError;
  }

  private requestAppServerTeardown(params: {
    disableAutoConnect: boolean;
  }): Promise<void> {
    this.appServerLifecycleVersion += 1;
    this.appServerTeardownDisableAutoConnectRequested ||= params.disableAutoConnect;
    if (params.disableAutoConnect) this.autoConnectEnabled = false;
    this.appServerContext?.controller.abort();
    if (this.appServerTeardownPromise) return this.appServerTeardownPromise;
    const operation = this.performAppServerTeardown();
    this.appServerTeardownPromise = operation;
    const clear = (): void => {
      if (this.appServerTeardownPromise !== operation) return;
      this.appServerTeardownPromise = null;
      this.appServerTeardownDisableAutoConnectRequested = false;
    };
    void operation.then(clear, clear);
    return operation;
  }

  private currentHookListenerLifetime(
    status: EyesOnAgentsBridgeStatus = this.bridgeStatus()
  ): HookListenerLifetime | null {
    const listeningSince = status.listeningSince === null
      ? Number.NaN
      : Date.parse(status.listeningSince);
    if (!status.listening || !Number.isFinite(listeningSince)) {
      this.resetHookListenerLifetime();
      return null;
    }
    if (
      this.hookListenerLifetime === null ||
      this.hookListenerLifetime.listeningSince !== listeningSince
    ) {
      this.resetHookListenerLifetime();
      this.hookListenerLifetime = {
        listeningSince,
        admissionEpoch: 0,
        inspectionState: 'uninspected',
        pendingEvents: [],
        overflowed: false
      };
    }
    return this.hookListenerLifetime;
  }

  private isCurrentHookListenerLifetime(lifetime: HookListenerLifetime): boolean {
    const status = this.bridgeStatus();
    const listeningSince = status.listeningSince === null
      ? Number.NaN
      : Date.parse(status.listeningSince);
    return this.hookListenerLifetime === lifetime &&
      status.listening &&
      Number.isFinite(listeningSince) &&
      listeningSince === lifetime.listeningSince;
  }

  private rejectHookListenerLifetime(lifetime: HookListenerLifetime): void {
    lifetime.admissionEpoch += 1;
    lifetime.inspectionState = 'rejected';
    this.rejectPendingCodexHookEvents(
      lifetime,
      new Error('Codex hook delivery was rejected before commit')
    );
  }

  private rejectPendingCodexHookEvents(
    lifetime: HookListenerLifetime,
    error: Error
  ): void {
    const pending = lifetime.pendingEvents.splice(0);
    for (const admission of pending) admission.completion?.reject(error);
  }

  private bufferCodexHookEvent(
    lifetime: HookListenerLifetime,
    admission: PendingCodexHookEvent
  ): void {
    if (lifetime.overflowed) {
      admission.completion?.reject(new Error('Codex hook admission buffer overflowed'));
      return;
    }
    if (lifetime.pendingEvents.length >= MAX_PENDING_CODEX_HOOK_EVENTS) {
      lifetime.overflowed = true;
      this.rejectPendingCodexHookEvents(
        lifetime,
        new Error('Codex hook admission buffer overflowed')
      );
      admission.completion?.reject(new Error('Codex hook admission buffer overflowed'));
      return;
    }
    lifetime.pendingEvents.push(admission);
  }

  private async awaitUnlessCancelled<T>(
    operation: Promise<T>,
    signal: AbortSignal
  ): Promise<CancellableResult<T>> {
    if (signal.aborted) return { state: 'cancelled' };
    let onAbort: (() => void) | null = null;
    const cancellation = new Promise<CancellableResult<T>>((resolve) => {
      onAbort = () => resolve({ state: 'cancelled' });
      signal.addEventListener('abort', onAbort, { once: true });
    });
    const settled: Promise<CancellableResult<T>> = operation.then(
      (value): CancellableResult<T> => ({ state: 'resolved', value }),
      (error: unknown): CancellableResult<T> => ({ state: 'rejected', error })
    );
    try {
      return await Promise.race([settled, cancellation]);
    } finally {
      if (onAbort) signal.removeEventListener('abort', onAbort);
    }
  }

  private async flushCodexHookEvents(
    lifetime: HookListenerLifetime,
    context: ObservationContext
  ): Promise<HookFlushResult> {
    const admissionEpoch = lifetime.admissionEpoch;
    const pendingBatch = lifetime.pendingEvents.splice(0);
    lifetime.inspectionState = 'flushing';
    const writes = pendingBatch.map((admission) =>
      this.dispatchCodexHookWrite(admission, context, lifetime)
    );
    const settled = await Promise.allSettled(writes);
    const failed = settled.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    );
    if (failed) throw failed.reason;
    if (lifetime.admissionEpoch !== admissionEpoch) {
      return 'rejected';
    }
    if (!this.isObservationActive(context)) {
      this.rejectHookListenerLifetime(lifetime);
      return 'cancelled';
    }
    if (!this.isCurrentHookListenerLifetime(lifetime)) {
      this.rejectHookListenerLifetime(lifetime);
      return 'replaced';
    }
    if (this.bridgeStatus().state !== 'installed') {
      this.rejectHookListenerLifetime(lifetime);
      return 'rejected';
    }
    lifetime.inspectionState = 'trusted';
    return 'trusted';
  }

  private async performConnectedBridgeInspection(context: ObservationContext): Promise<void> {
    for (;;) {
      if (!this.isObservationActive(context)) return;
      const lifetime = this.currentHookListenerLifetime();
      if (!lifetime) return;
      if (lifetime.inspectionState === 'rejected') lifetime.overflowed = false;
      const drainEpoch = lifetime.admissionEpoch;
      lifetime.inspectionState = 'pending';
      const drained = await this.awaitUnlessCancelled(
        context.hookWriteTail,
        context.controller.signal
      );
      if (drained.state === 'cancelled') return;
      if (drained.state === 'rejected') throw drained.error;
      if (!this.isObservationActive(context)) return;
      if (!this.isCurrentHookListenerLifetime(lifetime)) {
        this.rejectHookListenerLifetime(lifetime);
        if (this.currentHookListenerLifetime()) continue;
        return;
      }
      if (
        lifetime.admissionEpoch !== drainEpoch ||
        lifetime.inspectionState !== 'pending'
      ) {
        return;
      }
      lifetime.admissionEpoch += 1;
      const admissionEpoch = lifetime.admissionEpoch;
      const inspection = await this.awaitUnlessCancelled(
        Promise.resolve().then(async () => await this.dependencies.appServer.listHooks()),
        context.controller.signal
      );
      if (inspection.state === 'cancelled') {
        this.rejectHookListenerLifetime(lifetime);
        return;
      }
      if (!this.isCurrentHookListenerLifetime(lifetime)) {
        this.rejectHookListenerLifetime(lifetime);
        if (this.currentHookListenerLifetime()) continue;
        return;
      }
      if (
        lifetime.admissionEpoch !== admissionEpoch ||
        lifetime.inspectionState !== 'pending'
      ) {
        return;
      }
      if (lifetime.overflowed) {
        this.dependencies.desktopBridge.setOperationalError(
          new Error('Codex hook event buffer overflow')
        );
        this.rejectHookListenerLifetime(lifetime);
        await this.invalidateCodexHookStatuses();
        return;
      }
      if (inspection.state === 'resolved') {
        this.dependencies.desktopBridge.updateHookInspection(inspection.value);
      } else {
        this.dependencies.desktopBridge.setHookInspectionError(inspection.error);
      }
      if (this.hookCoverageGapDetected) {
        this.dependencies.desktopBridge.setOperationalError(
          new Error('Codex hook delivery coverage is incomplete')
        );
      }
      if (this.bridgeStatus().state === 'installed') {
        const flushResult = await this.flushCodexHookEvents(lifetime, context);
        if (flushResult === 'trusted' || flushResult === 'cancelled') return;
        if (flushResult === 'replaced') {
          await this.invalidateCodexHookStatuses();
          if (this.isObservationActive(context) && this.currentHookListenerLifetime()) continue;
          return;
        }
      } else {
        this.rejectHookListenerLifetime(lifetime);
      }
      await this.invalidateCodexHookStatuses();
      return;
    }
  }

  private async withHookInspectionConnection<T>(
    callback: () => Promise<T>
  ): Promise<T> {
    const wasConnected = this.dependencies.appServer.isConnected();
    const intentVersion = this.appServerIntentVersion;
    if (!wasConnected) await this.dependencies.appServer.connect();
    try {
      return await callback();
    } finally {
      if (
        !wasConnected &&
        intentVersion === this.appServerIntentVersion &&
        !this.autoConnectEnabled
      ) {
        await this.dependencies.appServer.disconnect();
      }
    }
  }

  private async handleBridgeOperationalFailure(
    context: ObservationContext,
    error: unknown
  ): Promise<void> {
    if (!this.isObservationActive(context)) return;
    this.dependencies.desktopBridge.setOperationalError(error);
    const lifetime = this.currentHookListenerLifetime();
    if (lifetime) this.rejectHookListenerLifetime(lifetime);
    await this.invalidateCodexHookStatuses();
  }

  private async refreshBridgeInspection(context: ObservationContext): Promise<void> {
    if (!this.isObservationActive(context)) return;
    if (this.bridgeInspectionPromise) return await this.bridgeInspectionPromise;
    if (!this.dependencies.desktopBridge.hasExactInstallation()) {
      const lifetime = this.currentHookListenerLifetime();
      if (lifetime) this.rejectHookListenerLifetime(lifetime);
      await this.invalidateCodexHookStatuses();
      return;
    }
    const operation = this.withHookInspectionConnection(
      async () => await this.performConnectedBridgeInspection(context)
    ).catch(async (error: unknown) => {
      await this.handleBridgeOperationalFailure(context, error);
      this.notify();
      throw error;
    });
    this.bridgeInspectionPromise = operation;
    try {
      await operation;
    } finally {
      if (this.bridgeInspectionPromise === operation) {
        this.bridgeInspectionPromise = null;
      }
    }
  }

  private async reviewBridgeInspection(context: ObservationContext): Promise<void> {
    if (!this.isObservationActive(context)) return;
    if (this.bridgeInspectionPromise) {
      await Promise.allSettled([this.bridgeInspectionPromise]);
    }
    if (!this.dependencies.desktopBridge.hasExactInstallation()) {
      const lifetime = this.currentHookListenerLifetime();
      if (lifetime) this.rejectHookListenerLifetime(lifetime);
      await this.invalidateCodexHookStatuses();
      return;
    }
    const operation = this.withHookInspectionConnection(async () => {
      await this.performConnectedBridgeInspection(context);
      if (
        !this.isObservationActive(context) ||
        this.bridgeStatus().reviewReason !== 'disabled'
      ) {
        return;
      }
      if (!this.dependencies.desktopBridge.hasExactInstallation()) {
        throw new Error('Codex hook definitions changed during review');
      }
      const keys = this.dependencies.desktopBridge.getDisabledExactHookKeys();
      if (keys.length === 0) {
        throw new Error('Codex disabled hooks could not be safely matched');
      }
      await this.dependencies.appServer.enableHooks(keys);
      await this.performConnectedBridgeInspection(context);
    }).catch(async (error: unknown) => {
      await this.handleBridgeOperationalFailure(context, error);
    });
    this.bridgeInspectionPromise = operation;
    try {
      await operation;
    } finally {
      if (this.bridgeInspectionPromise === operation) {
        this.bridgeInspectionPromise = null;
      }
    }
  }

  private async performSync(context: AppServerContext): Promise<void> {
    const observationContext = this.observationContext;
    if (observationContext && this.isObservationActive(observationContext)) {
      const inspected = await this.awaitUnlessCancelled(
        this.refreshBridgeInspection(observationContext),
        context.controller.signal
      );
      if (inspected.state === 'rejected') throw inspected.error;
    }
    if (!this.isAppServerActive(context)) return;
    const listed = await this.awaitUnlessCancelled(
      Promise.resolve().then(async () => await this.dependencies.appServer.listThreads()),
      context.controller.signal
    );
    if (listed.state === 'cancelled') return;
    if (listed.state === 'rejected') throw listed.error;
    if (!this.isAppServerActive(context)) return;
    const archivedListed = await this.awaitUnlessCancelled(
      Promise.resolve().then(
        async () => await this.dependencies.appServer.listArchivedThreads()
      ),
      context.controller.signal
    );
    if (archivedListed.state === 'cancelled') return;
    if (archivedListed.state === 'rejected') throw archivedListed.error;
    if (!this.isAppServerActive(context)) return;
    const observedAt = this.now();
    const snapshots = [
      ...listed.value.flatMap((entry) => {
        const snapshot = parseThreadSnapshot(entry, false, observedAt);
        return snapshot ? [snapshot] : [];
      }),
      ...archivedListed.value.flatMap((entry) => {
        const snapshot = parseThreadSnapshot(entry, true, observedAt);
        return snapshot ? [snapshot] : [];
      })
    ];
    const projectCache = new Map<string, EyesOnAgentsProjectResolution>();
    const threads = listed.value.flatMap((entry) => {
      const parsed = parseThreadEntry(entry, observedAt);
      if (!parsed) return [];
      const cacheKey = parsed.cwd ?? '';
      let resolution = projectCache.get(cacheKey);
      if (!resolution) {
        resolution = resolveEyesOnAgentsProject(parsed.cwd);
        projectCache.set(cacheKey, resolution);
      }
      const project = projectMetadataFromResolution(resolution);
      return [{
        ...parsed,
        ...(project === undefined ? {} : { project })
      }];
    });
    const archivedThreadIds = [...new Set(archivedListed.value.flatMap((entry) => {
      if (!isEyesOnAgentsRecord(entry)) return [];
      try {
        return [parseEyesOnAgentsUuid(entry.id, 'archived Codex thread id')];
      } catch {
        return [];
      }
    }))];
    await this.dependencies.repository.upsertThreadSnapshots({ snapshots });
    await this.dependencies.repository.upsertDiscoveredThreads({ threads });
    await this.dependencies.repository.markThreadsArchived({
      threadIds: archivedThreadIds,
      observedAt
    });
    if (!this.isAppServerActive(context)) return;
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
    if (this.desktopTeardownPromise) await this.desktopTeardownPromise;
    const intentVersion = this.observationIntentVersion;
    await this.runObservationOperation(intentVersion, async (context) => {
      await this.ensureDesktopObservation(context, true);
      if (!this.isObservationActive(context)) return;
      await this.refreshBridgeInspection(context);
      if (this.isObservationActive(context)) this.notify();
    });
    return await this.getSnapshot();
  }

  async reviewCodexBridge(): Promise<EyesOnAgentsSnapshot> {
    if (this.desktopTeardownPromise) await this.desktopTeardownPromise;
    const intentVersion = this.observationIntentVersion;
    await this.runObservationOperation(intentVersion, async (context) => {
      await this.ensureDesktopObservation(context, false);
      if (!this.isObservationActive(context)) return;
      await this.reviewBridgeInspection(context);
    });
    await this.dependencies.openExternal('codex://settings');
    return await this.changedSnapshot();
  }

  async refreshCodexBridgeStatus(): Promise<EyesOnAgentsSnapshot> {
    if (!this.dependencies.desktopBridge.hasInstallationIntent()) {
      return await this.changedSnapshot();
    }
    if (this.desktopTeardownPromise) await this.desktopTeardownPromise;
    const intentVersion = this.observationIntentVersion;
    await this.runObservationOperation(intentVersion, async (context) => {
      await this.ensureDesktopObservation(context, false);
      if (!this.isObservationActive(context)) return;
      await this.refreshBridgeInspection(context);
    });
    return await this.changedSnapshot();
  }

  async removeCodexBridge(): Promise<EyesOnAgentsSnapshot> {
    await this.teardownDesktopObservation(true);
    this.hookCoverageGapDetected = false;
    return await this.changedSnapshot();
  }

  async getCodexBridgeStatus(): Promise<EyesOnAgentsBridgeStatus> {
    return this.bridgeStatus();
  }

  async reportCodexHookCoverageGap(): Promise<void> {
    this.hookCoverageGapDetected = true;
    this.dependencies.desktopBridge.setOperationalError(
      new Error('Codex hook delivery coverage is incomplete')
    );
    await this.invalidateCodexHookStatuses();
    this.notify();
  }

  private bridgeStatus(): EyesOnAgentsBridgeStatus {
    return this.dependencies.desktopBridge.getStatus();
  }

  async handleAppServerNotification(method: string, paramsValue: unknown): Promise<void> {
    const context = this.appServerContext;
    if (!context || !this.isAppServerActive(context)) return;
    const operation = this.performHandleAppServerNotification(context, method, paramsValue);
    this.activeAppServerRuntimeOperations.add(operation);
    try {
      await operation;
    } finally {
      this.activeAppServerRuntimeOperations.delete(operation);
    }
  }

  private async performHandleAppServerNotification(
    context: AppServerContext,
    method: string,
    paramsValue: unknown
  ): Promise<void> {
    if (!isEyesOnAgentsRecord(paramsValue)) return;
    const observedAt = this.now();
    let threadId: string;
    try {
      threadId = threadIdFromNotification(paramsValue);
    } catch {
      return;
    }
    if (method === 'thread/archived') {
      await this.dependencies.repository.setThreadArchived({
        threadId,
        archived: true,
        observedAt
      });
      if (this.isAppServerActive(context)) this.notify();
      return;
    }
    if (method === 'thread/unarchived') {
      await this.dependencies.repository.setThreadArchived({
        threadId,
        archived: false,
        observedAt
      });
      if (!this.isAppServerActive(context)) return;
      this.notify();
      await this.performSync(context);
      return;
    }
    let event: EyesOnAgentsRuntimeEvent | null = null;
    try {
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
    if (!event || !this.isAppServerActive(context)) return;
    await this.dependencies.repository.applyRuntimeEvent({ event });
    if (this.isAppServerActive(context)) this.notify();
  }

  async applyCodexHookEvent(event: CodexHookEvent): Promise<void> {
    const context = this.observationContext;
    if (!context || !this.isObservationActive(context)) return;
    const operation = this.performApplyCodexHookEvent(context, {
      event,
      deliveryId: null,
      completion: null
    });
    this.activeHookOperations.add(operation);
    try {
      await operation;
    } finally {
      this.activeHookOperations.delete(operation);
    }
  }

  async commitCodexHookDelivery(
    value: CodexHookDelivery
  ): Promise<EyesOnAgentsRuntimeDeliveryResult> {
    const delivery = parseCodexHookDelivery(value);
    const context = this.observationContext;
    if (!context || !this.isObservationActive(context)) {
      throw new Error('Codex hook observation is not accepting deliveries');
    }
    let resolveCommit: (result: EyesOnAgentsRuntimeDeliveryResult) => void = () => undefined;
    let rejectCommit: (error: unknown) => void = () => undefined;
    const committed = new Promise<EyesOnAgentsRuntimeDeliveryResult>((resolve, reject) => {
      resolveCommit = resolve;
      rejectCommit = reject;
    });
    const operation = this.performApplyCodexHookEvent(context, {
      event: delivery.event,
      deliveryId: delivery.deliveryId,
      completion: {
        resolve: resolveCommit,
        reject: rejectCommit
      }
    }).then(async () => await committed);
    this.activeHookOperations.add(operation);
    try {
      return await operation;
    } finally {
      this.activeHookOperations.delete(operation);
    }
  }

  private async performApplyCodexHookEvent(
    context: ObservationContext,
    admission: PendingCodexHookEvent
  ): Promise<void> {
    const bridge = this.bridgeStatus();
    const lifetime = this.currentHookListenerLifetime(bridge);
    const predatesListener = admission.event.occurredAt < (lifetime?.listeningSince ?? 0);
    if (!lifetime || (admission.deliveryId === null && predatesListener)) {
      admission.completion?.reject(
        new Error('Codex hook delivery predates the active listener lifetime')
      );
      return;
    }
    if (
      lifetime.inspectionState === 'uninspected' ||
      lifetime.inspectionState === 'pending'
    ) {
      this.bufferCodexHookEvent(lifetime, admission);
      return;
    }
    if (lifetime.inspectionState === 'flushing') {
      if (
        !this.isObservationActive(context) ||
        !this.isCurrentHookListenerLifetime(lifetime) ||
        this.bridgeStatus().state !== 'installed'
      ) {
        admission.completion?.reject(
          new Error('Codex hook delivery admission changed before commit')
        );
        return;
      }
      this.dispatchCodexHookWrite(admission, context, lifetime);
      return;
    }
    if (lifetime.inspectionState === 'rejected') {
      admission.completion?.reject(new Error('Codex hook delivery admission is closed'));
      return;
    }
    if (bridge.state !== 'installed') {
      this.rejectHookListenerLifetime(lifetime);
      admission.completion?.reject(new Error('Codex hook definitions are not trusted'));
      return;
    }
    this.dispatchCodexHookWrite(admission, context, lifetime);
  }

  private dispatchCodexHookWrite(
    admission: PendingCodexHookEvent,
    context: ObservationContext,
    lifetime: HookListenerLifetime
  ): Promise<HookWriteResult> {
    const operation = this.enqueueCodexHookWrite(admission, context, lifetime);
    if (admission.completion) {
      void operation.then(
        (result) => {
          if (result) admission.completion?.resolve(result);
          else admission.completion?.reject(new Error('Codex hook delivery did not commit'));
        },
        (error: unknown) => admission.completion?.reject(error)
      );
    }
    return operation;
  }

  private enqueueCodexHookWrite(
    admission: PendingCodexHookEvent,
    context: ObservationContext,
    lifetime: HookListenerLifetime
  ): Promise<HookWriteResult> {
    const admissionEpoch = lifetime.admissionEpoch;
    const operation = context.hookWriteTail.then(async () => {
      if (
        !this.isObservationActive(context) ||
        !this.isCurrentHookListenerLifetime(lifetime) ||
        lifetime.admissionEpoch !== admissionEpoch ||
        lifetime.inspectionState === 'rejected' ||
        this.bridgeStatus().state !== 'installed'
      ) {
        if (admission.deliveryId !== null) {
          throw new Error('Codex hook delivery admission changed before commit');
        }
        return;
      }
      try {
        return await this.performPersistCodexHookEvent(admission);
      } catch (error) {
        this.rejectHookListenerLifetime(lifetime);
        if (this.isObservationActive(context)) {
          this.dependencies.desktopBridge.setOperationalError(error);
          try {
            await this.invalidateCodexHookStatuses();
          } finally {
            if (this.isObservationActive(context)) this.notify();
          }
        }
        throw error;
      }
    });
    context.hookWriteTail = operation.then(() => undefined, () => undefined);
    this.activeHookOperations.add(operation);
    const clear = (): void => {
      this.activeHookOperations.delete(operation);
    };
    void operation.then(clear, clear);
    return operation;
  }

  private async performPersistCodexHookEvent(
    admission: PendingCodexHookEvent
  ): Promise<HookWriteResult> {
    const { event } = admission;
    const project = projectMetadataFromResolution(
      resolveEyesOnAgentsProject(event.payload.cwd)
    );
    const base = {
      threadId: event.payload.sessionId,
      turnId: event.payload.turnId,
      cwd: event.payload.cwd,
      ...(project === undefined ? {} : { project }),
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
    if (admission.deliveryId === null) {
      await this.dependencies.repository.applyRuntimeEvent({ event: runtimeEvent });
      this.notify();
      return undefined;
    }
    const result = await this.dependencies.repository.applyRuntimeEventDelivery({
      deliveryId: admission.deliveryId,
      event: runtimeEvent
    });
    this.notify();
    return result;
  }

  private notify(): void {
    this.dependencies.broadcastChanged?.();
  }
}
