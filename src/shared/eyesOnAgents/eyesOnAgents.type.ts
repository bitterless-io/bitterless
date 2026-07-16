export type EyesOnAgentsRuntimeState =
  | 'working'
  | 'waiting_approval'
  | 'waiting_input'
  | 'idle'
  | 'failed'
  | 'ended'
  | 'unknown';

export type EyesOnAgentsStatusSource = 'app_server' | 'codex_hook' | 'discovery';

export type EyesOnAgentsConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'syncing'
  | 'error';

export type EyesOnAgentsBridgeState =
  | 'not_installed'
  | 'needs_trust'
  | 'installed'
  | 'drifted'
  | 'error';

export interface EyesOnAgentsDomain {
  id: number;
  domainKey: string;
  title: string;
  sortIndex: number;
  isSystem: boolean;
}

export interface EyesOnAgentsThread {
  threadId: string;
  domainId: number;
  title: string | null;
  cwd: string | null;
  runtimeState: EyesOnAgentsRuntimeState;
  activeFlags: string[];
  activeTurnId: string | null;
  lastCompletedTurnId: string | null;
  lastCompletedAt: string | null;
  lastOpenedTurnId: string | null;
  lastOpenedAt: string | null;
  statusSource: EyesOnAgentsStatusSource;
  statusObservedAt: string | null;
  lastActivityAt: string | null;
  isUnread: boolean;
  isFocused: boolean;
}

export interface EyesOnAgentsConnectionStatus {
  state: EyesOnAgentsConnectionState;
  lastSyncedAt: string | null;
  error: string | null;
  autoConnectEnabled: boolean;
}

export interface EyesOnAgentsBridgeStatus {
  state: EyesOnAgentsBridgeState;
  listening: boolean;
  listeningSince: string | null;
  lastEventAt: string | null;
  error: string | null;
}

export interface EyesOnAgentsSnapshot {
  domains: EyesOnAgentsDomain[];
  threads: EyesOnAgentsThread[];
  connection: EyesOnAgentsConnectionStatus;
  bridge: EyesOnAgentsBridgeStatus;
  lastSyncedAt: string | null;
}

export interface EyesOnAgentsDiscoveredThread {
  threadId: string;
  title: string | null;
  cwd: string | null;
  runtimeState: EyesOnAgentsRuntimeState;
  activeFlags: string[];
  statusSource: Extract<EyesOnAgentsStatusSource, 'app_server' | 'discovery'>;
  statusObservedAt: number | null;
  lastActivityAt: number | null;
}

export type EyesOnAgentsRuntimeEvent =
  | {
      type: 'thread_status';
      threadId: string;
      runtimeState: EyesOnAgentsRuntimeState;
      activeFlags: string[];
      observedAt: number;
      source: Extract<EyesOnAgentsStatusSource, 'app_server' | 'codex_hook'>;
      cwd?: string | null;
      turnId?: string | null;
    }
  | {
      type: 'turn_started';
      threadId: string;
      turnId: string | null;
      observedAt: number;
      source: Extract<EyesOnAgentsStatusSource, 'app_server' | 'codex_hook'>;
      cwd?: string | null;
    }
  | {
      type: 'turn_completed';
      threadId: string;
      turnId: string | null;
      outcome: 'completed' | 'failed' | 'interrupted';
      observedAt: number;
      source: Extract<EyesOnAgentsStatusSource, 'app_server' | 'codex_hook'>;
      cwd?: string | null;
    };

export interface EyesOnAgentsRepositoryApi {
  getSnapshot(): Promise<Pick<EyesOnAgentsSnapshot, 'domains' | 'threads'>>;
  invalidateAppServerStatuses(params: { observedAt: number }): Promise<void>;
  invalidateCodexHookStatuses(params: { observedAt: number }): Promise<void>;
  upsertDiscoveredThreads(params: {
    threads: EyesOnAgentsDiscoveredThread[];
  }): Promise<void>;
  applyRuntimeEvent(params: { event: EyesOnAgentsRuntimeEvent }): Promise<void>;
  markOpened(params: { threadId: string; openedAt: number }): Promise<void>;
  createDomain(params: { title: string }): Promise<void>;
  renameDomain(params: { domainId: number; title: string }): Promise<void>;
  deleteDomain(params: { domainId: number }): Promise<void>;
  reorderDomains(params: { domainIds: number[] }): Promise<void>;
  moveThread(params: { threadId: string; domainId: number }): Promise<void>;
}

export interface EyesOnAgentsApi {
  getSnapshot(): Promise<EyesOnAgentsSnapshot>;
  connectAppServer(): Promise<EyesOnAgentsSnapshot>;
  disconnectAppServer(): Promise<EyesOnAgentsSnapshot>;
  syncThreads(): Promise<EyesOnAgentsSnapshot>;
  openThread(params: { threadId: string }): Promise<{
    url: string;
    snapshot: EyesOnAgentsSnapshot;
  }>;
  installCodexBridge(): Promise<EyesOnAgentsSnapshot>;
  removeCodexBridge(): Promise<EyesOnAgentsSnapshot>;
  getCodexBridgeStatus(): Promise<EyesOnAgentsBridgeStatus>;
  createDomain(params: { title: string }): Promise<EyesOnAgentsSnapshot>;
  renameDomain(params: { domainId: number; title: string }): Promise<EyesOnAgentsSnapshot>;
  deleteDomain(params: { domainId: number }): Promise<EyesOnAgentsSnapshot>;
  reorderDomains(params: { domainIds: number[] }): Promise<EyesOnAgentsSnapshot>;
  moveThread(params: { threadId: string; domainId: number }): Promise<EyesOnAgentsSnapshot>;
}
