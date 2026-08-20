export type EyesOnAgentsRuntimeState =
  | 'working'
  | 'waiting_approval'
  | 'waiting_input'
  | 'idle'
  | 'failed'
  | 'ended'
  | 'unknown';

export type EyesOnAgentsProvider = 'codex' | 'claude';

export type EyesOnAgentsSessionKey = `${EyesOnAgentsProvider}:${string}`;

export type EyesOnAgentsDesktopSessionId = `local_${string}`;

export type EyesOnAgentsArchiveState = 'active' | 'archived' | 'unknown';

export interface EyesOnAgentsThreadIdentity {
  sessionKey: EyesOnAgentsSessionKey;
  provider: EyesOnAgentsProvider;
  threadId: string;
}

export type EyesOnAgentsStatusSource =
  | 'app_server'
  | 'app_server_turn'
  | 'codex_hook'
  | 'claude_hook'
  | 'claude_agent_view'
  | 'discovery';

export type EyesOnAgentsActiveTurnSource = Extract<
  EyesOnAgentsStatusSource,
  'codex_hook' | 'app_server_turn'
>;

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

export interface EyesOnAgentsThread extends EyesOnAgentsThreadIdentity {
  archiveState: EyesOnAgentsArchiveState;
  desktopSessionId: EyesOnAgentsDesktopSessionId | null;
  canPreviewTranscript: boolean;
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
  statusFreshUntil: string | null;
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

export type EyesOnAgentsClaudeBridgeState =
  | 'not_installed'
  | 'installed'
  | 'observing'
  | 'needs_review'
  | 'drifted'
  | 'error';

export type EyesOnAgentsClaudeObservationProof = 'none' | 'receipt';

export type EyesOnAgentsClaudeSetupAction =
  | 'enable'
  | 'finish'
  | 'reload'
  | 'retry'
  | 'repair'
  | 'none';

export interface EyesOnAgentsClaudeBridgeStatus {
  state: EyesOnAgentsClaudeBridgeState;
  setupAction: EyesOnAgentsClaudeSetupAction;
  configured: boolean;
  enabled: boolean;
  listening: boolean;
  listeningSince: string | null;
  firstReceiptAt: string | null;
  lastReceiptAt: string | null;
  lastInspectedAt: string | null;
  observationProof: EyesOnAgentsClaudeObservationProof;
  restartRequired: boolean;
  error: string | null;
}

export type EyesOnAgentsClaudeDirectoryMode = 'automatic' | 'custom';

export interface EyesOnAgentsClaudeDirectoryConfig {
  schemaVersion: 1;
  mode: EyesOnAgentsClaudeDirectoryMode;
  configDirectory: string | null;
}

export type EyesOnAgentsClaudeDirectoryState =
  | 'starting'
  | 'watching'
  | 'waiting'
  | 'degraded'
  | 'retrying'
  | 'error'
  | 'stopped';

export interface EyesOnAgentsClaudeDirectoryStatus {
  mode: EyesOnAgentsClaudeDirectoryMode;
  configuredDirectory: string | null;
  effectiveDirectory: string | null;
  projectsDirectory: string | null;
  desktopDirectoryCount: number;
  state: EyesOnAgentsClaudeDirectoryState;
  watching: boolean;
  lastScanAt: string | null;
  lastSuccessfulScanAt: string | null;
  nextRetryAt: string | null;
  error: string | null;
}

export interface EyesOnAgentsClaudeProviderStatus {
  enabled: boolean;
  error: string | null;
  revision: number;
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
  claudeBridge: EyesOnAgentsClaudeBridgeStatus;
  claudeDirectory: EyesOnAgentsClaudeDirectoryStatus;
  claudeProvider: EyesOnAgentsClaudeProviderStatus;
  lastSyncedAt: string | null;
  lastUserPromptCaptureEnabled: boolean;
  claudeLastUserPromptCaptureEnabled: boolean;
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

export interface EyesOnAgentsThreadRefreshLastUserPromptPatch {
  preview: string | null;
  turnId: string | null;
  observedAt: number | null;
  checkedAt: number;
  truncated: boolean;
  source: 'app_server';
}

export interface EyesOnAgentsThreadRefreshTerminalTurnPatch {
  turnId: string;
  outcome: 'completed' | 'failed' | 'interrupted';
  completedAt: number;
  expectedActiveTurnId: string;
  expectedStatusObservedAt: number;
  expectedStatusSource: EyesOnAgentsActiveTurnSource;
  source: 'app_server';
}

export interface EyesOnAgentsThreadRefreshSettledTurnPatch {
  turnId: string;
  outcome: 'completed' | 'failed' | 'interrupted';
  completedAt: number;
  expectedStatusObservedAt: number;
  source: 'app_server';
}

export interface EyesOnAgentsThreadRefreshRecoveredTurnPatch {
  turnId: string;
  startedAt: number;
  expectedStatusObservedAt: number;
  source: 'app_server_turn';
}

export interface EyesOnAgentsThreadRefreshReclaimedTurnPatch {
  turnId: string;
  startedAt: number;
  expectedActiveTurnId: string;
  expectedStatusObservedAt: number;
  expectedStatusSource: Extract<EyesOnAgentsStatusSource, 'codex_hook'>;
  source: 'app_server_turn';
}

export interface EyesOnAgentsThreadRefreshPatch {
  threadId: string;
  title?: string | null;
  lastActivityAt?: number;
  lastUserPrompt?: EyesOnAgentsThreadRefreshLastUserPromptPatch;
  terminalTurn?: EyesOnAgentsThreadRefreshTerminalTurnPatch;
  settledTurn?: EyesOnAgentsThreadRefreshSettledTurnPatch;
  recoveredTurn?: EyesOnAgentsThreadRefreshRecoveredTurnPatch;
  reclaimedTurn?: EyesOnAgentsThreadRefreshReclaimedTurnPatch;
}

export interface EyesOnAgentsThreadRefreshActiveTurn {
  turnId: string;
  statusObservedAt: number;
  statusSource: EyesOnAgentsActiveTurnSource;
  runtimeState: EyesOnAgentsRuntimeState;
}

export interface EyesOnAgentsThreadRefreshRecoveryCandidate {
  statusObservedAt: number;
}

export interface EyesOnAgentsThreadRefreshCandidate {
  sessionKey: EyesOnAgentsSessionKey;
  provider: EyesOnAgentsProvider;
  threadId: string;
  lastUserPromptCheckedAt: number | null;
  activeTurn: EyesOnAgentsThreadRefreshActiveTurn | null;
  recoveryCandidate: EyesOnAgentsThreadRefreshRecoveryCandidate | null;
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

export interface EyesOnAgentsCompletionAlertIntent {
  sessionKey: EyesOnAgentsSessionKey;
  provider: EyesOnAgentsProvider;
  threadId: string;
  turnId: string;
  title: string | null;
}

export interface EyesOnAgentsRepositoryMutationResult {
  changed: boolean;
}

export interface EyesOnAgentsClaudeInventoryThread {
  threadId: string;
  desktopSessionId: EyesOnAgentsDesktopSessionId | null;
  desktopMetadataMtime?: number | null;
  transcriptPath: string | null;
  clearDesktopSessionId?: boolean;
  clearTranscriptPath?: boolean;
  desktopEvidenceComplete?: boolean;
  transcriptEvidenceComplete?: boolean;
  title: string | null;
  cwd: string | null;
  project?: EyesOnAgentsProjectMetadata | null;
  archiveState: EyesOnAgentsArchiveState;
  transcriptActivityAt: number | null;
  lastActivityAt: number | null;
  observedAt: number;
}

export interface EyesOnAgentsClaudeDeletionTombstone {
  sourceKey: string;
  identityId: string;
  deletedAt: number;
  observedAt: number;
}

export interface EyesOnAgentsClaudeDeletionReconciliation {
  tombstones: EyesOnAgentsClaudeDeletionTombstone[];
  healthyScopeKeys: string[];
  completeSnapshot: boolean;
  observedAt: number;
}

export interface EyesOnAgentsClaudeAgentState {
  threadId: string;
  runtimeState: EyesOnAgentsRuntimeState;
  title: string | null;
  cwd: string | null;
  startedAt: number | null;
  observedAt: number;
}

export interface EyesOnAgentsClaudeOpenTarget {
  sessionKey: EyesOnAgentsSessionKey;
  desktopSessionId: EyesOnAgentsDesktopSessionId | null;
  transcriptPath: string | null;
  runtimeState: EyesOnAgentsRuntimeState;
}

export interface EyesOnAgentsThreadPagePersistenceResult
  extends EyesOnAgentsRepositoryMutationResult {
  completionAlerts?: EyesOnAgentsCompletionAlertIntent[];
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
      source: Extract<EyesOnAgentsStatusSource, 'app_server' | 'codex_hook' | 'claude_hook'>;
      cwd?: string | null;
      project?: EyesOnAgentsProjectMetadata | null;
      turnId?: string | null;
    }
  | {
      type: 'turn_started';
      threadId: string;
      turnId: string | null;
      observedAt: number;
      source: Extract<EyesOnAgentsStatusSource, 'app_server' | 'codex_hook' | 'claude_hook'>;
      cwd?: string | null;
      project?: EyesOnAgentsProjectMetadata | null;
    }
  | {
      type: 'turn_completed';
      threadId: string;
      turnId: string | null;
      outcome: 'completed' | 'failed' | 'interrupted';
      observedAt: number;
      source: Extract<EyesOnAgentsStatusSource, 'app_server' | 'codex_hook' | 'claude_hook'>;
      cwd?: string | null;
      project?: EyesOnAgentsProjectMetadata | null;
    };

export interface EyesOnAgentsRuntimeDeliveryResult {
  duplicate: boolean;
}

export interface EyesOnAgentsRuntimePersistenceResult {
  created: boolean;
  titleMissing: boolean;
  completionAlert: EyesOnAgentsCompletionAlertIntent | null;
}

export type EyesOnAgentsRuntimeDeliveryPersistenceResult =
  EyesOnAgentsRuntimeDeliveryResult & EyesOnAgentsRuntimePersistenceResult;

export interface EyesOnAgentsRepositoryApi {
  getSnapshot(): Promise<Pick<EyesOnAgentsSnapshot, 'domains' | 'threads'>>;
  getThreadRefreshPages(params: {
    coldPage: number;
    previousPageCount: number | null;
  }): Promise<EyesOnAgentsThreadRefreshPages>;
  getThreadRefreshCandidate(params: {
    threadId: string;
  }): Promise<EyesOnAgentsThreadRefreshCandidate | null>;
  refreshThreadPage(params: {
    threads: EyesOnAgentsThreadRefreshPatch[];
  }): Promise<EyesOnAgentsThreadPagePersistenceResult>;
  clearLastUserPrompts(params: {
    providers: EyesOnAgentsProvider[];
  }): Promise<EyesOnAgentsRepositoryMutationResult>;
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
    replayAuthority?: 'current_listener';
    hookLastUserPrompt?: EyesOnAgentsHookLastUserPromptCandidate;
  }): Promise<EyesOnAgentsRuntimeDeliveryPersistenceResult>;
  enrichMissingThreadTitle(params: {
    threadId: string;
    title: string;
  }): Promise<EyesOnAgentsRepositoryMutationResult>;
  markOpened(params: { sessionKey: EyesOnAgentsSessionKey; openedAt: number }): Promise<void>;
  markAllRead(params: {
    providers: EyesOnAgentsProvider[];
  }): Promise<EyesOnAgentsRepositoryMutationResult>;
  setThreadUnread(params: {
    sessionKey: EyesOnAgentsSessionKey;
    isUnread: boolean;
  }): Promise<EyesOnAgentsRepositoryMutationResult>;
  createDomain(params: { title: string }): Promise<void>;
  renameDomain(params: { domainId: number; title: string }): Promise<void>;
  deleteDomain(params: { domainId: number }): Promise<void>;
  reorderDomains(params: { domainIds: number[] }): Promise<void>;
  moveThread(params: { sessionKey: EyesOnAgentsSessionKey; domainId: number }): Promise<void>;
  upsertClaudeInventory(params: {
    threads: EyesOnAgentsClaudeInventoryThread[];
    deletion?: EyesOnAgentsClaudeDeletionReconciliation;
  }): Promise<EyesOnAgentsRepositoryMutationResult>;
  reconcileClaudeAgentStates(params: {
    agents: EyesOnAgentsClaudeAgentState[];
    completeSnapshot: boolean;
    observedAt: number;
  }): Promise<EyesOnAgentsRepositoryMutationResult>;
  expireClaudeAgentStates(params: {
    observedAt: number;
    statusSources?: Array<'claude_agent_view' | 'claude_hook'>;
    force?: boolean;
  }): Promise<EyesOnAgentsRepositoryMutationResult>;
  clearClaudeTranscriptCapabilities(): Promise<EyesOnAgentsRepositoryMutationResult>;
  getRuntimeReceiptSummary(params: {
    provider: EyesOnAgentsProvider;
  }): Promise<{ firstReceivedAt: number | null; lastReceivedAt: number | null }>;
  getClaudeOpenTarget(params: {
    sessionKey: EyesOnAgentsSessionKey;
  }): Promise<EyesOnAgentsClaudeOpenTarget | null>;
}

export interface EyesOnAgentsApi {
  getSnapshot(): Promise<EyesOnAgentsSnapshot>;
  connectAppServer(): Promise<EyesOnAgentsSnapshot>;
  disconnectAppServer(): Promise<EyesOnAgentsSnapshot>;
  syncThreads(): Promise<EyesOnAgentsSnapshot>;
  refreshClaudeInventory(): Promise<EyesOnAgentsSnapshot>;
  refreshThreadPages(): Promise<EyesOnAgentsThreadPagesRefreshResult>;
  openThread(params: { sessionKey: EyesOnAgentsSessionKey }): Promise<{
    url: string;
    snapshot: EyesOnAgentsSnapshot;
  }>;
  previewThread(params: { sessionKey: EyesOnAgentsSessionKey }): Promise<void>;
  markAllRead(): Promise<EyesOnAgentsSnapshot>;
  setThreadUnread(params: {
    sessionKey: EyesOnAgentsSessionKey;
    isUnread: boolean;
  }): Promise<EyesOnAgentsSnapshot>;
  installCodexBridge(): Promise<EyesOnAgentsSnapshot>;
  reviewCodexBridge(): Promise<EyesOnAgentsSnapshot>;
  refreshCodexBridgeStatus(): Promise<EyesOnAgentsSnapshot>;
  removeCodexBridge(): Promise<EyesOnAgentsSnapshot>;
  getCodexBridgeStatus(): Promise<EyesOnAgentsBridgeStatus>;
  installClaudeBridge(): Promise<EyesOnAgentsSnapshot>;
  refreshClaudeBridgeStatus(): Promise<EyesOnAgentsSnapshot>;
  removeClaudeBridge(): Promise<EyesOnAgentsSnapshot>;
  getClaudeBridgeStatus(): Promise<EyesOnAgentsClaudeBridgeStatus>;
  openNewClaudeSession(): Promise<void>;
  copyClaudeReloadCommand(): Promise<void>;
  changeClaudeDirectory(): Promise<EyesOnAgentsSnapshot>;
  useAutomaticClaudeDirectory(): Promise<EyesOnAgentsSnapshot>;
  retryClaudeDirectory(): Promise<EyesOnAgentsSnapshot>;
  setClaudeProviderEnabled(params: {
    enabled: boolean;
  }): Promise<EyesOnAgentsSnapshot>;
  setLastUserPromptCaptureEnabled(params: {
    enabled: boolean;
  }): Promise<EyesOnAgentsSnapshot>;
  setClaudeLastUserPromptCaptureEnabled(params: {
    enabled: boolean;
  }): Promise<EyesOnAgentsSnapshot>;
  createDomain(params: { title: string }): Promise<EyesOnAgentsSnapshot>;
  renameDomain(params: { domainId: number; title: string }): Promise<EyesOnAgentsSnapshot>;
  deleteDomain(params: { domainId: number }): Promise<EyesOnAgentsSnapshot>;
  reorderDomains(params: { domainIds: number[] }): Promise<EyesOnAgentsSnapshot>;
  moveThread(params: {
    sessionKey: EyesOnAgentsSessionKey;
    domainId: number;
  }): Promise<EyesOnAgentsSnapshot>;
}
