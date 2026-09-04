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
  iterm2SessionId: string | null;
  // Raw CLAUDE_CONFIG_DIR path captured on SessionStart (schema V4), never a foreign key to an
  // EyesOnAgentsClaudeEnvironment id — environment-label resolution happens at snapshot-read time.
  claudeConfigDir: string | null;
  canCopySessionPath: boolean;
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

// A single configured Claude environment (one CLAUDE_CONFIG_DIR target). Only environments[0]
// may ever have mode: 'automatic' — see EyesOnAgentsClaudeDirectoryConfig.
export interface EyesOnAgentsClaudeEnvironment {
  id: string;
  label: string;
  mode: EyesOnAgentsClaudeDirectoryMode;
  configDirectory: string | null;
  enabled: boolean;
}

// schemaVersion 2: an array of independently-managed named Claude environments, replacing the
// former single-scalar schemaVersion 1 shape ({ mode, configDirectory }). Always at least one
// entry; environments[0] is the sole environment ever eligible for mode: 'automatic'.
export interface EyesOnAgentsClaudeDirectoryConfig {
  schemaVersion: 2;
  environments: EyesOnAgentsClaudeEnvironment[];
}

export type EyesOnAgentsClaudeDirectoryState =
  | 'starting'
  | 'watching'
  | 'waiting'
  | 'degraded'
  | 'retrying'
  | 'error'
  | 'stopped';

// Whether one Claude environment's own config directory has the Bitterless plugin (task 090).
// 'unknown' means the probe could not answer — never probed yet, the probe threw, or the `claude`
// executable is missing/unusable. It is deliberately NOT folded into 'not_installed': "we could not
// check" and "we checked and it is absent" call for different user action, and conflating them
// turns a broken PATH into a misleading "not installed" that invites a pointless reinstall.
export type EyesOnAgentsClaudePluginPresence =
  | 'installed'
  | 'disabled'
  | 'not_installed'
  | 'unknown';

// One configured Claude environment's watcher status (task 085: the singular
// EyesOnAgentsClaudeDirectoryStatus shape moved to a per-environment array — see
// EyesOnAgentsClaudeDirectoryStatus below). id/label/enabled mirror the environment this status
// belongs to; every other field is the pre-existing per-directory watcher status shape unchanged.
export interface EyesOnAgentsClaudeEnvironmentStatus {
  id: string;
  label: string;
  enabled: boolean;
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
  // Mirrors ClaudeDirectoryConfigService.removeEnvironment's own guard ("The last remaining Claude
  // environment cannot be removed") so the renderer disables Remove from the authoritative rule
  // instead of re-deriving it from the row count. Always false for the synthetic
  // invalid-hydration entry, which has no environment identity to remove.
  canRemove: boolean;
  // Whether THIS environment's own CLAUDE_CONFIG_DIR has the Bitterless plugin (task 090). Read
  // from a cached read-only probe, never computed during snapshot assembly — see
  // EyesOnAgentsClaudePluginPresence. Distinct from the profile-wide claudeBridge status, which
  // reports the single shared installation identity and listener.
  pluginPresence: EyesOnAgentsClaudePluginPresence;
  pluginProbedAt: string | null;
}

// The per-environment watcher status as the observation service tracks it internally: every field
// except the ones that are properties of the environment LIST or of a separate probe rather than of
// one environment's watcher, and are therefore stamped only when getDirectoryStatus() assembles the
// array.
export type EyesOnAgentsClaudeEnvironmentWatcherStatus =
  Omit<EyesOnAgentsClaudeEnvironmentStatus, 'canRemove' | 'pluginPresence' | 'pluginProbedAt'>;

// One entry per configured Claude environment (task 085). When the persisted directory
// configuration itself failed to hydrate, this is a single synthetic entry (id/label empty)
// carrying the same recovery-until-explicit-action contract the pre-085 singular status had.
export type EyesOnAgentsClaudeDirectoryStatus = EyesOnAgentsClaudeEnvironmentStatus[];

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
  // Optional: an omitted or null value never clears an already-stored iTerm2 identity, matching
  // (but independent from) the desktopSessionId COALESCE-preserve rule above.
  iterm2SessionId?: string | null;
  // Optional: an omitted or null value never clears an already-stored claudeConfigDir, independent
  // from both the desktopSessionId and iterm2SessionId COALESCE-preserve rules.
  claudeConfigDir?: string | null;
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
  iterm2SessionId: string | null;
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
  // Task 094: snapshot only — the iTerm2 route reveals the pane through AppleScript, so unlike
  // openThread there is no deep link to hand back. A rejection is the failure channel: the stored
  // pane being gone and macOS refusing the Apple Event are distinct, actionable errors.
  openThreadInIterm2(params: { sessionKey: EyesOnAgentsSessionKey }): Promise<{
    snapshot: EyesOnAgentsSnapshot;
  }>;
  archiveThread(params: {
    sessionKey: EyesOnAgentsSessionKey;
  }): Promise<EyesOnAgentsSnapshot>;
  previewThread(params: { sessionKey: EyesOnAgentsSessionKey }): Promise<void>;
  copySessionPath(params: { sessionKey: EyesOnAgentsSessionKey }): Promise<void>;
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
  // Task 086 widened these 4 pre-existing bridge methods to accept an optional { environmentId },
  // scoping which environment's CLAUDE_CONFIG_DIR the install/refresh/remove/status CLI work runs
  // against. Optional (task 088): an omitted environmentId resolves to environments[0], reproducing
  // every pre-088 zero-arg renderer call site's exact behavior.
  installClaudeBridge(params?: { environmentId?: string }): Promise<EyesOnAgentsSnapshot>;
  refreshClaudeBridgeStatus(params?: { environmentId?: string }): Promise<EyesOnAgentsSnapshot>;
  removeClaudeBridge(params?: { environmentId?: string }): Promise<EyesOnAgentsSnapshot>;
  getClaudeBridgeStatus(
    params?: { environmentId?: string }
  ): Promise<EyesOnAgentsClaudeBridgeStatus>;
  openNewClaudeSession(): Promise<void>;
  copyClaudeReloadCommand(): Promise<void>;
  changeClaudeDirectory(): Promise<EyesOnAgentsSnapshot>;
  useAutomaticClaudeDirectory(): Promise<EyesOnAgentsSnapshot>;
  // Task 088 (gap 1): widened the same way as the 4 bridge methods above — an omitted environmentId
  // retries environments[0], reproducing every pre-088 zero-arg call site's exact behavior; a
  // supplied environmentId retries that one environment's watcher only.
  retryClaudeDirectory(params?: { environmentId?: string }): Promise<EyesOnAgentsSnapshot>;
  // Environment CRUD (task 084 registered these on EyesOnAgentsHandler; task 088 closes the gap
  // left on this shared interface — see the multi-environment design doc's Renderer section).
  listClaudeEnvironments(): Promise<EyesOnAgentsClaudeEnvironment[]>;
  // Task 091: takes the pasted absolute CLAUDE_CONFIG_DIR; the label is derived from it.
  addClaudeEnvironment(params: { configDirectory: string }): Promise<EyesOnAgentsClaudeEnvironment[]>;
  renameClaudeEnvironment(params: {
    id: string;
    label: string;
  }): Promise<EyesOnAgentsClaudeEnvironment[]>;
  removeClaudeEnvironment(params: { id: string }): Promise<EyesOnAgentsClaudeEnvironment[]>;
  setClaudeEnvironmentEnabled(params: {
    id: string;
    enabled: boolean;
  }): Promise<EyesOnAgentsClaudeEnvironment[]>;
  // Task 092: repointing an existing environment takes the pasted absolute directory too, so the
  // card teaches one interaction for both adding and changing a CLAUDE_CONFIG_DIR.
  chooseClaudeEnvironmentDirectory(
    params: { id: string; configDirectory: string }
  ): Promise<EyesOnAgentsClaudeEnvironment[]>;
  useAutomaticClaudeEnvironment(params: { id: string }): Promise<EyesOnAgentsClaudeEnvironment[]>;
  // Task 089: writes that one environment's ready-to-paste CLAUDE_CONFIG_DIR shell wrapper to the
  // clipboard. Takes a required { id } like the environment-CRUD members above, not the bridge
  // methods' optional { environmentId } — a wrapper is always explicitly row-scoped, and silently
  // falling back to environments[0] would hand the user a snippet for the wrong environment.
  copyClaudeEnvironmentSetupCommand(params: { id: string }): Promise<void>;
  // Task 090: re-runs ONLY that environment's read-only plugin-presence probe. Deliberately not
  // routed through refreshClaudeBridgeStatus: that performs a full profile-wide bridge refresh
  // which can run a trusted automatic upgrade and rewrite the shared inspection state, which is
  // the opposite of what a per-row "check this directory" action should do.
  refreshClaudeEnvironmentPluginPresence(params: { id: string }): Promise<EyesOnAgentsSnapshot>;
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
