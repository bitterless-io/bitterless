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

export type EyesOnAgentsBridgeReviewReason =
  | 'untrusted'
  | 'modified'
  | 'disabled';

export interface EyesOnAgentsDomain {
  id: number;
  domainKey: string;
  title: string;
  sortIndex: number;
  isSystem: boolean;
}

export interface EyesOnAgentsProjectMetadata {
  projectKey: string;
  projectRoot: string;
  projectName: string;
}

export type EyesOnAgentsLastUserPromptState = 'available' | 'pending' | 'unavailable';

export interface EyesOnAgentsLastUserPrompt {
  state: EyesOnAgentsLastUserPromptState;
  preview: string | null;
  turnId: string | null;
  observedAt: string | null;
  checkedAt: string | null;
  truncated: boolean;
}

export interface EyesOnAgentsThread {
  threadId: string;
  domainId: number;
  title: string | null;
  cwd: string | null;
  projectKey: string | null;
  projectRoot: string | null;
  projectName: string | null;
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
  lastUserPrompt: EyesOnAgentsLastUserPrompt;
}

export interface EyesOnAgentsConnectionStatus {
  state: EyesOnAgentsConnectionState;
  lastSyncedAt: string | null;
  error: string | null;
  autoConnectEnabled: boolean;
}

export interface EyesOnAgentsBridgeStatus {
  state: EyesOnAgentsBridgeState;
  reviewReason: EyesOnAgentsBridgeReviewReason | null;
  listening: boolean;
  listeningSince: string | null;
  lastEventAt: string | null;
  lastInspectedAt: string | null;
  error: string | null;
}

export type EyesOnAgentsTitleEnrichmentDiagnosticState = 'skipped' | 'rejected';

export type EyesOnAgentsTitleEnrichmentDiagnosticReason =
  | 'app_server_unavailable'
  | 'thread_read_rejected'
  | 'unusable_response';

export interface EyesOnAgentsTitleEnrichmentDiagnostic {
  state: EyesOnAgentsTitleEnrichmentDiagnosticState;
  reason: EyesOnAgentsTitleEnrichmentDiagnosticReason;
  threadId: string;
  observedAt: string;
}

export interface EyesOnAgentsSnapshot {
  domains: EyesOnAgentsDomain[];
  threads: EyesOnAgentsThread[];
  connection: EyesOnAgentsConnectionStatus;
  bridge: EyesOnAgentsBridgeStatus;
  lastSyncedAt: string | null;
  lastUserPromptCaptureEnabled: boolean;
  titleEnrichmentDiagnostic: EyesOnAgentsTitleEnrichmentDiagnostic | null;
}

export interface EyesOnAgentsDiscoveredThread {
  threadId: string;
  title: string | null;
  cwd: string | null;
  project?: EyesOnAgentsProjectMetadata | null;
  runtimeState: EyesOnAgentsRuntimeState;
  activeFlags: string[];
  statusSource: Extract<EyesOnAgentsStatusSource, 'app_server' | 'discovery'>;
  statusObservedAt: number | null;
  lastActivityAt: number | null;
}

export interface EyesOnAgentsThreadSnapshot {
  threadId: string;
  payloadJson: string;
  archived: boolean;
  syncedAt: number;
}

export interface EyesOnAgentsThreadRefreshStatusPatch {
  runtimeState: EyesOnAgentsRuntimeState;
  activeFlags: string[];
  activeTurnId?: string | null;
  source: Extract<EyesOnAgentsStatusSource, 'app_server'>;
  observedAt: number;
}

export interface EyesOnAgentsThreadRefreshLastUserPromptPatch {
  preview: string | null;
  turnId: string | null;
  observedAt: number | null;
  checkedAt: number;
  truncated: boolean;
  source: 'app_server';
}

export interface EyesOnAgentsThreadRefreshPatch {
  threadId: string;
  title?: string | null;
  status?: EyesOnAgentsThreadRefreshStatusPatch;
  lastActivityAt?: number;
  lastUserPrompt?: EyesOnAgentsThreadRefreshLastUserPromptPatch;
}

export interface EyesOnAgentsThreadRefreshCandidate {
  threadId: string;
  lastUserPromptCheckedAt: number | null;
}

export interface EyesOnAgentsThreadRefreshPages {
  hot: EyesOnAgentsThreadRefreshCandidate[];
  cold: EyesOnAgentsThreadRefreshCandidate[];
  pageCount: number;
  coldPage: number | null;
}

export interface EyesOnAgentsHookLastUserPromptCandidate {
  preview: string | null;
  truncated: boolean;
}

export interface EyesOnAgentsRepositoryMutationResult {
  changed: boolean;
}

export interface EyesOnAgentsThreadPagesRefreshResult {
  changed: boolean;
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
      project?: EyesOnAgentsProjectMetadata | null;
      turnId?: string | null;
    }
  | {
      type: 'turn_started';
      threadId: string;
      turnId: string | null;
      observedAt: number;
      source: Extract<EyesOnAgentsStatusSource, 'app_server' | 'codex_hook'>;
      cwd?: string | null;
      project?: EyesOnAgentsProjectMetadata | null;
    }
  | {
      type: 'turn_completed';
      threadId: string;
      turnId: string | null;
      outcome: 'completed' | 'failed' | 'interrupted';
      observedAt: number;
      source: Extract<EyesOnAgentsStatusSource, 'app_server' | 'codex_hook'>;
      cwd?: string | null;
      project?: EyesOnAgentsProjectMetadata | null;
    };

export interface EyesOnAgentsRuntimeDeliveryResult {
  duplicate: boolean;
}

export interface EyesOnAgentsRuntimePersistenceResult {
  created: boolean;
  titleMissing: boolean;
}

export type EyesOnAgentsRuntimeDeliveryPersistenceResult =
  EyesOnAgentsRuntimeDeliveryResult & EyesOnAgentsRuntimePersistenceResult;

export interface EyesOnAgentsRepositoryApi {
  getSnapshot(): Promise<Pick<EyesOnAgentsSnapshot, 'domains' | 'threads'>>;
  getThreadRefreshPages(params: {
    coldPage: number;
    previousPageCount: number | null;
  }): Promise<EyesOnAgentsThreadRefreshPages>;
  refreshThreadPage(params: {
    threads: EyesOnAgentsThreadRefreshPatch[];
  }): Promise<EyesOnAgentsRepositoryMutationResult>;
  clearLastUserPrompts(): Promise<EyesOnAgentsRepositoryMutationResult>;
  invalidateAppServerStatuses(params: { observedAt: number }): Promise<void>;
  invalidateCodexHookStatuses(params: { observedAt: number }): Promise<void>;
  upsertDiscoveredThreads(params: {
    threads: EyesOnAgentsDiscoveredThread[];
  }): Promise<void>;
  upsertThreadSnapshots(params: {
    snapshots: EyesOnAgentsThreadSnapshot[];
  }): Promise<void>;
  setThreadArchived(params: {
    threadId: string;
    archived: boolean;
    observedAt: number;
  }): Promise<void>;
  markThreadsArchived(params: { threadIds: string[]; observedAt: number }): Promise<void>;
  applyRuntimeEvent(params: {
    event: EyesOnAgentsRuntimeEvent;
    hookLastUserPrompt?: EyesOnAgentsHookLastUserPromptCandidate;
  }): Promise<EyesOnAgentsRuntimePersistenceResult>;
  applyRuntimeEventDelivery(params: {
    deliveryId: string;
    event: EyesOnAgentsRuntimeEvent;
    hookLastUserPrompt?: EyesOnAgentsHookLastUserPromptCandidate;
  }): Promise<EyesOnAgentsRuntimeDeliveryPersistenceResult>;
  enrichMissingThreadTitle(params: {
    threadId: string;
    title: string;
  }): Promise<EyesOnAgentsRepositoryMutationResult>;
  markOpened(params: { threadId: string; openedAt: number }): Promise<void>;
  markAllRead(): Promise<EyesOnAgentsRepositoryMutationResult>;
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
  refreshThreadPages(): Promise<EyesOnAgentsThreadPagesRefreshResult>;
  openThread(params: { threadId: string }): Promise<{
    url: string;
    snapshot: EyesOnAgentsSnapshot;
  }>;
  markAllRead(): Promise<EyesOnAgentsSnapshot>;
  installCodexBridge(): Promise<EyesOnAgentsSnapshot>;
  reviewCodexBridge(): Promise<EyesOnAgentsSnapshot>;
  refreshCodexBridgeStatus(): Promise<EyesOnAgentsSnapshot>;
  removeCodexBridge(): Promise<EyesOnAgentsSnapshot>;
  getCodexBridgeStatus(): Promise<EyesOnAgentsBridgeStatus>;
  setLastUserPromptCaptureEnabled(params: {
    enabled: boolean;
  }): Promise<EyesOnAgentsSnapshot>;
  createDomain(params: { title: string }): Promise<EyesOnAgentsSnapshot>;
  renameDomain(params: { domainId: number; title: string }): Promise<EyesOnAgentsSnapshot>;
  deleteDomain(params: { domainId: number }): Promise<EyesOnAgentsSnapshot>;
  reorderDomains(params: { domainIds: number[] }): Promise<EyesOnAgentsSnapshot>;
  moveThread(params: { threadId: string; domainId: number }): Promise<EyesOnAgentsSnapshot>;
}
