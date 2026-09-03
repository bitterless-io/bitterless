import type { SettingDao } from '@preload/sqlite/dao/setting.dao';
import type {
  EyesOnAgentsActiveTurnSource,
  EyesOnAgentsApi,
  EyesOnAgentsBridgeStatus,
  EyesOnAgentsClaudeBridgeStatus,
  EyesOnAgentsClaudeEnvironment,
  EyesOnAgentsCompletionAlertIntent,
  EyesOnAgentsDiscoveredThread,
  EyesOnAgentsHookLastUserPromptCandidate,
  EyesOnAgentsRepositoryApi,
  EyesOnAgentsRepositoryMutationResult,
  EyesOnAgentsRuntimeDeliveryResult,
  EyesOnAgentsRuntimeEvent,
  EyesOnAgentsSessionKey,
  EyesOnAgentsSnapshot,
  EyesOnAgentsTitleEnrichmentDiagnostic,
  EyesOnAgentsThreadPagesRefreshResult,
  EyesOnAgentsThreadRefreshCandidate,
  EyesOnAgentsThreadRefreshLastUserPromptPatch,
  EyesOnAgentsThreadRefreshPatch,
  EyesOnAgentsThreadSnapshot
} from '@shared/eyesOnAgents/eyesOnAgents.type';
import {
  buildEyesOnAgentsDeepLink,
  buildEyesOnAgentsClaudeDesktopDeepLink,
  buildEyesOnAgentsClaudeEnvironmentSetupCommand,
  buildEyesOnAgentsIterm2DeepLink,
  effectiveEyesOnAgentsRuntimeState,
  isEyesOnAgentsFocused,
  isEyesOnAgentsRecord,
  normalizeEyesOnAgentsProviderThreadTitle,
  normalizeEyesOnAgentsThreadStatus,
  parseEyesOnAgentsPath,
  parseEyesOnAgentsSessionKey,
  parseEyesOnAgentsText,
  parseEyesOnAgentsUuid
} from '@shared/eyesOnAgents/eyesOnAgents.contract';
import { parseCodexHookDelivery } from '@shared/eyesOnAgents/codexHookBridge.contract';
import type {
  CodexHookDelivery,
  CodexHookEvent
} from '@shared/eyesOnAgents/codexHookBridge.type';
import { parseClaudeHookDelivery } from '@shared/eyesOnAgents/claudeHookBridge.contract';
import type { ClaudeHookDelivery } from '@shared/eyesOnAgents/claudeHookBridge.type';
import type { ClaudeHookOutboxCoverageGap } from './claudeHookOutbox.service';
import type { CodexHookOutboxCoverageGap } from './codexHookOutbox.service';
import type { CodexAppServerSupervisor } from './codexAppServer.supervisor';
import type { LastUserPromptPreferenceService } from './lastUserPromptPreference.service';
import type { ClaudeDirectoryConfigService } from './claudeDirectoryConfig.service';
import { resolveClaudeBridgeEnvironment } from './claudeBridgeEnvironment.resolver';
import type {
  ClaudeProviderPreferenceHydration,
  ClaudeProviderPreferenceService
} from './claudeProviderPreference.service';
import { CLAUDE_PROVIDER_PENDING_ADMISSION } from './claudeProviderPreference.service';
import {
  projectMetadataFromResolution,
  resolveEyesOnAgentsProject,
  type EyesOnAgentsProjectResolution
} from './projectResolver.service';

interface EyesOnAgentsServiceDependencies {
  repository: EyesOnAgentsRepositoryApi;
  settings: Pick<SettingDao, 'get' | 'upsert'>;
  appServer: CodexAppServerSupervisor;
  lastUserPromptPreference?: Pick<
    LastUserPromptPreferenceService,
    'isEnabled' | 'enable' | 'disable'
  >;
  claudeLastUserPromptPreference?: Pick<
    LastUserPromptPreferenceService,
    'isEnabled' | 'enable' | 'disable'
  >;
  claudeProviderPreference?: Pick<
    ClaudeProviderPreferenceService,
    'hydrate' | 'getStatus' | 'setEnabled'
  >;
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
    recoverOutboxCoverageGap(expectedGap: CodexHookOutboxCoverageGap): Promise<void>;
    replayOutbox(): Promise<void>;
  };
  openExternal: (url: string) => Promise<void>;
  writeClipboardText: (text: string) => void;
  previewAbsoluteTarget?: (path: string) => Promise<void>;
  validateClaudeTranscript?: (path: string, expectedThreadId: string) => string;
  claudeObservation?: {
    start(): Promise<void>;
    stop(): Promise<void>;
    refresh(mode: 'full' | 'poll'): Promise<EyesOnAgentsRepositoryMutationResult>;
    getDirectoryStatus?(): EyesOnAgentsSnapshot['claudeDirectory'];
    changeDirectory?(): Promise<void>;
    useAutomaticDirectory?(): Promise<void>;
    // Task 088 (gap 1): widened to accept the target environment id — an omitted id retries
    // environments[0] (ClaudeObservationService's own resolveDefaultEnvironmentId fallback),
    // reproducing every pre-088 zero-arg caller's exact ambient behavior unchanged.
    retryDirectory?(environmentId?: string): Promise<void>;
    // Task 088: reconciles the environment-CRUD map (task 085's applyEnvironments()) after a thin
    // delegating CRUD call below mutates the persisted environment list.
    applyEnvironments?(): Promise<void>;
    // Task 090: re-probes one environment's plugin presence (or all, when the id is omitted) after
    // an action that can change it. Never called while assembling a snapshot — it spawns two
    // `claude` child processes per environment.
    refreshPluginPresence?(environmentId?: string): Promise<void>;
  };
  // Task 088: the same ClaudeDirectoryConfigService singleton eyesOnAgents.handler.ts constructs,
  // injected here so this service can (a) satisfy EyesOnAgentsApi's 7 environment-CRUD members with
  // real delegation, and (b) resolve installClaudeBridge/refreshClaudeBridgeStatus/removeClaudeBridge's
  // { environmentId } to a configDirectory internally. Optional so every pre-088 test harness that
  // constructs this service without it keeps working unchanged (bridge methods fall back to the
  // ambient/ no-scoping behavior they already had).
  claudeDirectoryConfig?: Pick<
    ClaudeDirectoryConfigService,
    | 'listEnvironments'
    | 'addEnvironment'
    | 'renameEnvironment'
    | 'removeEnvironment'
    | 'setEnvironmentEnabled'
    | 'chooseCustomDirectory'
    | 'useAutomatic'
  >;
  // Task 088: reuses eyesOnAgents.handler.ts's existing pickClaudeConfigDirectory free function so
  // this service's own addClaudeEnvironment delegate can open the same native picker the handler's
  // real XPC-registered method already uses, rather than duplicating that logic.
  pickClaudeConfigDirectory?: () => Promise<string | null>;
  claudeBridge?: {
    getStatus(): EyesOnAgentsClaudeBridgeStatus;
    getInstallationId?(): string;
    hasInstallationIntent(): boolean;
    acceptsInstallation(installationId: string): boolean;
    revokeObservationProof(reason?: 'coverage_gap'): void;
    // configDirectory (task 086) scopes only which CLAUDE_CONFIG_DIR the underlying claude CLI
    // invocations run against; omitting it reproduces today's exact ambient-environment behavior.
    // It never introduces a second installationId/socket/outbox — the shared installation-identity
    // state machine below this dependency is unchanged.
    install(configDirectory?: string): Promise<EyesOnAgentsClaudeBridgeStatus>;
    refresh(configDirectory?: string): Promise<EyesOnAgentsClaudeBridgeStatus>;
    remove(configDirectory?: string): Promise<EyesOnAgentsClaudeBridgeStatus>;
  };
  claudeHookListener?: {
    start(): Promise<void>;
    stop(): Promise<void>;
    replayOutbox(): Promise<void>;
    clearOutbox?(): Promise<void>;
  };
  notifyThreadCompleted?: (
    intent: EyesOnAgentsCompletionAlertIntent
  ) => void | Promise<void>;
  broadcastChanged?: () => void;
  now?: () => number;
}

const AUTO_CONNECT_SETTING_KEY = 'eyes_on_agents';
const AUTO_CONNECT_SETTING_SUB_KEY = 'app_server_auto_connect';
const MAX_PENDING_CODEX_HOOK_EVENTS = 256;
const MAX_LAST_USER_PROMPT_BYTES = 8_192;
const THREAD_REFRESH_PAGE_SIZE = 40;
const THREAD_REFRESH_CONCURRENCY = 4;
const MAX_CLAUDE_PROVIDER_ERROR_LENGTH = 300;
const CLAUDE_NEW_SESSION_URL = 'claude://code/new';
const CLAUDE_RELOAD_PLUGINS_COMMAND = '/reload-plugins';
const DEFAULT_LAST_USER_PROMPT_PREFERENCE = {
  isEnabled: (): boolean => false,
  enable: (): boolean => false,
  disable: (): boolean => false
};
const DEFAULT_CLAUDE_PROVIDER_PREFERENCE = {
  hydrate: async (): Promise<ClaudeProviderPreferenceHydration> => ({
    state: 'valid',
    preference: { schemaVersion: 1, enabled: true, hookAdmissionAfter: null }
  }),
  getStatus: (): {
    enabled: boolean;
    hookAdmissionAfter: number | null;
    error: string | null;
  } => ({
    enabled: true,
    hookAdmissionAfter: null,
    error: null
  }),
  setEnabled: async (enabled: boolean, hookAdmissionAfter: number | null) => ({
    schemaVersion: 1 as const,
    enabled,
    hookAdmissionAfter
  })
};

const STOPPED_CLAUDE_BRIDGE_STATUS: EyesOnAgentsClaudeBridgeStatus = {
  state: 'not_installed',
  setupAction: 'enable',
  configured: false,
  enabled: false,
  listening: false,
  listeningSince: null,
  firstReceiptAt: null,
  lastReceiptAt: null,
  lastInspectedAt: null,
  observationProof: 'none',
  restartRequired: false,
  error: null
};

// Task 085: claudeDirectory moved from one status object to one entry per configured Claude
// environment — an unavailable/hidden claudeObservation has no known environments, so the fallback
// is an empty list rather than a single synthetic "stopped" object.
const STOPPED_CLAUDE_DIRECTORY_STATUS: EyesOnAgentsSnapshot['claudeDirectory'] = [];

const boundedClaudeProviderError = (error: unknown): string => {
  const message = error instanceof Error
    ? error.message
    : String(error || 'Claude support is unavailable');
  return message.replace(/[\r\n]+/g, ' ').slice(0, MAX_CLAUDE_PROVIDER_ERROR_LENGTH);
};

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
  lastUserPromptPreferenceEpoch: number;
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

interface ThreadRefreshBatchResult {
  changed: boolean;
  completed: boolean;
}

interface ThreadRefreshPromptAdmission {
  enabled: boolean;
  epoch: number;
}

interface PendingHookCoverageGap {
  generation: number;
  gap: CodexHookOutboxCoverageGap;
}

const providerThreadField = (
  value: Record<string, unknown>,
  key: string
): unknown => {
  try {
    return value[key];
  } catch {
    return undefined;
  }
};

const normalizeProviderThreadStatus = (
  value: unknown
): ReturnType<typeof normalizeEyesOnAgentsThreadStatus> => {
  try {
    return normalizeEyesOnAgentsThreadStatus(value);
  } catch {
    return { runtimeState: 'unknown', activeFlags: [], statusSource: 'discovery' };
  }
};

const parseProviderTimestamp = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  const milliseconds = value < 10_000_000_000 ? value * 1000 : value;
  const integerMilliseconds = Math.floor(milliseconds);
  return Number.isSafeInteger(integerMilliseconds) ? integerMilliseconds : null;
};

const parseProviderTurnTimestamp = (
  value: unknown,
  options: { notAfter: number }
): number | null => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) return null;
  const milliseconds = (value as number) * 1000;
  if (!Number.isSafeInteger(milliseconds) || milliseconds > options.notAfter) return null;
  return milliseconds;
};

const hasUnpairedSurrogate = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isFinite(next) || next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
};

const boundLastUserPrompt = (
  value: string
): Pick<EyesOnAgentsThreadRefreshLastUserPromptPatch, 'preview' | 'truncated'> => {
  const normalized = value.trim();
  if (!normalized || normalized.includes('\0') || hasUnpairedSurrogate(normalized)) {
    return { preview: null, truncated: false };
  }
  const characters: string[] = [];
  let byteLength = 0;
  let truncated = false;
  for (const character of normalized) {
    const characterBytes = Buffer.byteLength(character, 'utf8');
    if (byteLength + characterBytes > MAX_LAST_USER_PROMPT_BYTES) {
      truncated = true;
      break;
    }
    characters.push(character);
    byteLength += characterBytes;
  }
  return { preview: characters.join(''), truncated };
};

const parseThreadRefreshTitle = (
  value: Record<string, unknown>
): string | undefined => normalizeEyesOnAgentsProviderThreadTitle(value) ?? undefined;

const parseThreadRefreshRead = (
  value: unknown,
  options: { expectedThreadId: string }
): { patch: EyesOnAgentsThreadRefreshPatch; providerActivityAt: number | null } => {
  if (!isEyesOnAgentsRecord(value)) throw new Error('Codex thread/read thread is invalid');
  const threadId = parseEyesOnAgentsUuid(
    providerThreadField(value, 'id'),
    'Codex thread/read thread id'
  );
  if (threadId !== options.expectedThreadId) {
    throw new Error('Codex thread/read returned a different thread');
  }
  const title = parseThreadRefreshTitle(value);
  const providerActivityAt = parseProviderTimestamp(providerThreadField(value, 'updatedAt')) ??
    parseProviderTimestamp(providerThreadField(value, 'createdAt'));
  return {
    patch: {
      threadId,
      ...(title === undefined ? {} : { title }),
      ...(providerActivityAt === null ? {} : { lastActivityAt: providerActivityAt })
    },
    providerActivityAt
  };
};

const turnIdentity = (value: Record<string, unknown>): {
  turnId: string;
  observedAt: number | null;
} => {
  const turnId = parseEyesOnAgentsText(value.id, 'Codex turn id', 200, false) as string;
  return {
    turnId,
    observedAt: parseProviderTimestamp(value.completedAt) ??
      parseProviderTimestamp(value.startedAt)
  };
};

const lastUserPromptFromTurns = (
  turns: unknown[],
  options: { checkedAt: number; providerActivityAt: number | null }
): EyesOnAgentsThreadRefreshLastUserPromptPatch => {
  let pendingTurnId: string | null = null;
  let pendingObservedAt: number | null = options.providerActivityAt;
  for (const turnValue of turns) {
    if (!isEyesOnAgentsRecord(turnValue) || !Array.isArray(turnValue.items)) {
      throw new Error('Codex thread/turns/list turn is invalid');
    }
    if (
      Object.prototype.hasOwnProperty.call(turnValue, 'itemsView')
      && turnValue.itemsView !== 'full'
    ) {
      throw new Error('Codex thread/turns/list itemsView is not full');
    }
    const identity = turnIdentity(turnValue);
    pendingTurnId ??= identity.turnId;
    pendingObservedAt ??= identity.observedAt;
    for (let index = turnValue.items.length - 1; index >= 0; index -= 1) {
      const item = turnValue.items[index];
      if (!isEyesOnAgentsRecord(item) || item.type !== 'userMessage') continue;
      if (!Array.isArray(item.content)) {
        throw new Error('Codex userMessage content is invalid');
      }
      const textSegments: string[] = [];
      for (const segment of item.content) {
        if (!isEyesOnAgentsRecord(segment) || segment.type !== 'text') continue;
        if (typeof segment.text !== 'string') {
          throw new Error('Codex userMessage text is invalid');
        }
        textSegments.push(segment.text);
      }
      if (textSegments.length === 0) continue;
      const bounded = boundLastUserPrompt(textSegments.join(''));
      if (bounded.preview === null) continue;
      return {
        ...bounded,
        turnId: identity.turnId,
        observedAt: identity.observedAt ?? options.providerActivityAt,
        checkedAt: options.checkedAt,
        source: 'app_server'
      };
    }
  }
  return {
    preview: null,
    turnId: pendingTurnId,
    observedAt: pendingObservedAt,
    checkedAt: options.checkedAt,
    truncated: false,
    source: 'app_server'
  };
};

const terminalTurnFromLatest = (
  value: unknown,
  options: {
    activeTurnId: string;
    statusObservedAt: number;
    statusSource: EyesOnAgentsActiveTurnSource;
    polledAt: number;
  }
): NonNullable<EyesOnAgentsThreadRefreshPatch['terminalTurn']> | undefined => {
  if (!isEyesOnAgentsRecord(value)) return undefined;
  let turnId: string;
  try {
    turnId = parseEyesOnAgentsText(
      providerThreadField(value, 'id'),
      'Codex terminal turn id',
      200,
      false
    ) as string;
  } catch {
    return undefined;
  }
  if (turnId !== options.activeTurnId) return undefined;
  const status = providerThreadField(value, 'status');
  if (status === 'inProgress') return undefined;
  if (status !== 'completed' && status !== 'interrupted' && status !== 'failed') {
    return undefined;
  }
  const completedAt = parseProviderTurnTimestamp(
    providerThreadField(value, 'completedAt'),
    { notAfter: options.polledAt }
  );
  if (completedAt === null) return undefined;
  return {
    turnId,
    outcome: status,
    completedAt,
    expectedActiveTurnId: options.activeTurnId,
    expectedStatusObservedAt: options.statusObservedAt,
    expectedStatusSource: options.statusSource,
    source: 'app_server'
  };
};

const settledTurnFromLatest = (
  value: unknown,
  options: {
    statusObservedAt: number;
    polledAt: number;
  }
): NonNullable<EyesOnAgentsThreadRefreshPatch['settledTurn']> | undefined => {
  if (!isEyesOnAgentsRecord(value)) return undefined;
  const status = providerThreadField(value, 'status');
  if (status !== 'completed' && status !== 'interrupted' && status !== 'failed') {
    return undefined;
  }
  let turnId: string;
  try {
    turnId = parseEyesOnAgentsText(
      providerThreadField(value, 'id'),
      'Codex settled turn id',
      200,
      false
    ) as string;
  } catch {
    return undefined;
  }
  const completedAt = parseProviderTurnTimestamp(
    providerThreadField(value, 'completedAt'),
    { notAfter: options.polledAt }
  );
  if (completedAt === null) return undefined;
  return {
    turnId,
    outcome: status,
    completedAt,
    expectedStatusObservedAt: options.statusObservedAt,
    source: 'app_server'
  };
};

const recoveredTurnFromLatest = (
  value: unknown,
  options: {
    statusObservedAt: number;
    polledAt: number;
  }
): NonNullable<EyesOnAgentsThreadRefreshPatch['recoveredTurn']> | undefined => {
  if (!isEyesOnAgentsRecord(value)) return undefined;
  if (providerThreadField(value, 'status') !== 'inProgress') return undefined;
  let turnId: string;
  try {
    turnId = parseEyesOnAgentsText(
      providerThreadField(value, 'id'),
      'Codex recovered turn id',
      200,
      false
    ) as string;
  } catch {
    return undefined;
  }
  const startedAt = parseProviderTurnTimestamp(
    providerThreadField(value, 'startedAt'),
    { notAfter: options.polledAt }
  );
  if (startedAt === null) return undefined;
  return {
    turnId,
    startedAt,
    expectedStatusObservedAt: options.statusObservedAt,
    source: 'app_server_turn'
  };
};

const reclaimedTurnFromLatest = (
  value: unknown,
  options: {
    activeTurnId: string;
    statusObservedAt: number;
    polledAt: number;
  }
): NonNullable<EyesOnAgentsThreadRefreshPatch['reclaimedTurn']> | undefined => {
  if (!isEyesOnAgentsRecord(value)) return undefined;
  if (providerThreadField(value, 'status') !== 'inProgress') return undefined;
  let turnId: string;
  try {
    turnId = parseEyesOnAgentsText(
      providerThreadField(value, 'id'),
      'Codex reclaimed turn id',
      200,
      false
    ) as string;
  } catch {
    return undefined;
  }
  if (turnId !== options.activeTurnId) return undefined;
  const startedAt = parseProviderTurnTimestamp(
    providerThreadField(value, 'startedAt'),
    { notAfter: options.polledAt }
  );
  if (startedAt === null) return undefined;
  return {
    turnId,
    startedAt,
    expectedActiveTurnId: options.activeTurnId,
    expectedStatusObservedAt: options.statusObservedAt,
    expectedStatusSource: 'codex_hook',
    source: 'app_server_turn'
  };
};

const hasThreadRefreshPatch = (patch: EyesOnAgentsThreadRefreshPatch): boolean => {
  return patch.title !== undefined ||
    patch.lastActivityAt !== undefined ||
    patch.lastUserPrompt !== undefined ||
    patch.terminalTurn !== undefined ||
    patch.settledTurn !== undefined ||
    patch.recoveredTurn !== undefined ||
    patch.reclaimedTurn !== undefined;
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
  let threadId: string;
  try {
    threadId = parseEyesOnAgentsUuid(value.id, 'Codex thread id');
  } catch {
    return null;
  }
  let cwd: string | null = null;
  try {
    cwd = parseEyesOnAgentsPath(providerThreadField(value, 'cwd'));
  } catch {
    // Optional provider paths cannot reject an otherwise valid thread identity.
  }
  const normalizedStatus = normalizeProviderThreadStatus(
    providerThreadField(value, 'status')
  );
  const providerActivity = parseProviderTimestamp(providerThreadField(value, 'updatedAt')) ??
    parseProviderTimestamp(providerThreadField(value, 'createdAt'));
  return {
    threadId,
    title: normalizeEyesOnAgentsProviderThreadTitle(value),
    cwd,
    runtimeState: normalizedStatus.runtimeState,
    activeFlags: normalizedStatus.activeFlags,
    statusSource: normalizedStatus.statusSource,
    statusObservedAt: observedAt,
    lastActivityAt: providerActivity
  };
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
  private readonly lastUserPromptPreference: Pick<
    LastUserPromptPreferenceService,
    'isEnabled' | 'enable' | 'disable'
  >;
  private readonly claudeLastUserPromptPreference: Pick<
    LastUserPromptPreferenceService,
    'isEnabled' | 'enable' | 'disable'
  >;
  private readonly claudeProviderPreference: Pick<
    ClaudeProviderPreferenceService,
    'hydrate' | 'getStatus' | 'setEnabled'
  >;
  private autoConnectEnabled = false;
  private appServerIntentVersion = 0;
  private appServerLifecycleVersion = 0;
  private appServerContext: AppServerContext | null = null;
  private appServerConnectPromise: Promise<void> | null = null;
  private backgroundRefreshPromise: Promise<EyesOnAgentsThreadPagesRefreshResult> | null = null;
  private claudeBackgroundRefreshPromise: Promise<void> | null = null;
  private coldThreadRefreshPage = 2;
  private threadRefreshPageCount: number | null = null;
  private foregroundAppServerOperationPending = 0;
  private appServerTeardownPromise: Promise<void> | null = null;
  private appServerTeardownDisableAutoConnectRequested = false;
  private lastUserPromptPreferenceEpoch = 0;
  private claudeLastUserPromptPreferenceEpoch = 0;
  private observationIntentVersion = 0;
  private observationContext: ObservationContext | null = null;
  private desktopObservationPromise: Promise<void> | null = null;
  private desktopTeardownPromise: Promise<void> | null = null;
  private bridgeInspectionPromise: Promise<void> | null = null;
  private hookListenerLifetime: HookListenerLifetime | null = null;
  private hookIntakeEnabled = false;
  private hookCoverageGapGeneration = 0;
  private pendingHookCoverageGap: PendingHookCoverageGap | null = null;
  private teardownRemoveBridgeRequested = false;
  private readonly activeObservationOperations = new Set<Promise<void>>();
  private readonly activeHookOperations = new Set<Promise<unknown>>();
  private readonly activeClaudeHookOperations = new Set<Promise<unknown>>();
  private readonly activeAppServerOperations = new Set<Promise<void>>();
  private readonly activeAppServerRuntimeOperations = new Set<Promise<void>>();
  private readonly titleEnrichmentOperations = new Map<string, Promise<void>>();
  private titleEnrichmentGeneration = 0;
  private titleEnrichmentDiagnostic: EyesOnAgentsTitleEnrichmentDiagnostic | null = null;
  private claudeHookIntakeEnabled = false;
  private claudeHookListenerInstallationId: string | null = null;
  private claudeBridgeLifecycleTail: Promise<void> = Promise.resolve();
  private claudeProviderIntentTail: Promise<void> = Promise.resolve();
  private appRuntimeActive = false;
  private appRuntimeGeneration = 0;
  private claudeProviderRuntimeVersion = 0;
  private claudeProviderPreferenceEnabled = false;
  private claudeProviderProjectionEnabled = false;
  private claudeProviderError: string | null = null;
  private claudeProviderEnableCutoff: number | null = null;
  private claudeProviderRevision = 0;

  constructor(private readonly dependencies: EyesOnAgentsServiceDependencies) {
    this.now = dependencies.now ?? Date.now;
    this.lastUserPromptPreference = dependencies.lastUserPromptPreference ??
      DEFAULT_LAST_USER_PROMPT_PREFERENCE;
    this.claudeLastUserPromptPreference = dependencies.claudeLastUserPromptPreference ??
      DEFAULT_LAST_USER_PROMPT_PREFERENCE;
    this.claudeProviderPreference = dependencies.claudeProviderPreference ??
      DEFAULT_CLAUDE_PROVIDER_PREFERENCE;
  }

  async initialize(): Promise<void> {
    const appServerIntentVersion = this.appServerLifecycleVersion;
    const observationIntentVersion = this.observationIntentVersion;
    this.appRuntimeActive = true;
    this.appRuntimeGeneration += 1;
    const claudeProviderRuntimeVersion = ++this.claudeProviderRuntimeVersion;
    this.claudeProviderPreferenceEnabled = false;
    this.claudeProviderProjectionEnabled = false;
    this.claudeProviderError = null;
    this.claudeHookIntakeEnabled = false;
    this.bumpClaudeProviderRevision();
    void this.hydrateClaudeProvider(claudeProviderRuntimeVersion);
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
    if (this.dependencies.desktopBridge.hasInstallationIntent()) {
      await this.attemptInstalledObservationActive(observationIntentVersion);
    }
    try {
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
    this.appRuntimeActive = false;
    this.appRuntimeGeneration += 1;
    this.claudeProviderRuntimeVersion += 1;
    this.bumpClaudeProviderRevision();
    this.claudeHookIntakeEnabled = false;
    this.claudeHookListenerInstallationId = null;
    const claudeHookTeardown = this.runClaudeBridgeLifecycle(async () => {
      this.claudeHookIntakeEnabled = false;
      await this.dependencies.claudeHookListener?.stop();
    });
    const observationTeardown = this.requestDesktopTeardown({ removeBridge: false });
    const appServerTeardown = this.requestAppServerTeardown({ disableAutoConnect: false });
    const teardownResults = await Promise.allSettled([
      observationTeardown,
      appServerTeardown,
      this.dependencies.claudeObservation?.stop() ?? Promise.resolve(),
      this.joinClaudeBackgroundRefresh(),
      claudeHookTeardown
    ]);
    await this.joinAppServerWork();
    const failed = teardownResults.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    );
    if (failed) throw failed.reason;
  }

  async getSnapshot(): Promise<EyesOnAgentsSnapshot> {
    for (;;) {
      const claudeProviderRevision = this.claudeProviderRevision;
      const persisted = await this.dependencies.repository.getSnapshot();
      if (claudeProviderRevision !== this.claudeProviderRevision) continue;
      const claudeProviderProjectionEnabled = this.isClaudeProviderAvailable();
      const claudeProviderManagementVisible = this.isClaudeProviderManagementCurrent(
        this.claudeProviderRuntimeVersion
      );
      const claudeProviderEnabled = this.claudeProviderPreferenceEnabled;
      const claudeProviderError = this.claudeProviderError;
      const lastUserPromptCaptureEnabled = this.lastUserPromptPreference.isEnabled();
      const claudeLastUserPromptCaptureEnabled = this.claudeLastUserPromptPreference.isEnabled();
      const connection = this.dependencies.appServer.getStatus(this.autoConnectEnabled);
      const connected = this.dependencies.appServer.isConnected();
      const bridge = this.bridgeStatus();
      const claudeBridge = claudeProviderManagementVisible
        ? await this.readClaudeBridgeStatus()
        : { ...STOPPED_CLAUDE_BRIDGE_STATUS };
      const listeningSince = bridge.listeningSince === null
        ? null
        : Date.parse(bridge.listeningSince);
      const visibleThreads = persisted.threads.filter((thread) =>
        thread.provider !== 'claude' || (
          claudeProviderProjectionEnabled &&
          (thread.desktopSessionId !== null || thread.iterm2SessionId !== null)
        ));
      const threads = visibleThreads.map((thread) => {
        const observedAt = thread.statusObservedAt === null
          ? null
          : Date.parse(thread.statusObservedAt);
        const freshUntil = thread.statusFreshUntil === null
          ? null
          : Date.parse(thread.statusFreshUntil);
        const runtimeState = thread.provider === 'claude'
          ? thread.statusSource === 'claude_agent_view' &&
            ['working', 'waiting_approval', 'waiting_input'].includes(thread.runtimeState) &&
            (freshUntil === null || this.now() > freshUntil)
            ? 'unknown'
            : thread.runtimeState
          : effectiveEyesOnAgentsRuntimeState({
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
          isFocused: isEyesOnAgentsFocused(runtimeState, thread.isUnread),
          lastUserPrompt: (
            thread.provider === 'claude'
              ? claudeLastUserPromptCaptureEnabled
              : lastUserPromptCaptureEnabled
          )
            ? thread.lastUserPrompt
            : {
                state: 'unavailable' as const,
                preview: null,
                turnId: null,
                observedAt: null,
                checkedAt: null,
                truncated: false
              }
        };
      });
      const snapshot: EyesOnAgentsSnapshot = {
        domains: persisted.domains,
        threads,
        connection,
        bridge,
        claudeBridge,
        claudeDirectory: claudeProviderManagementVisible
          ? this.dependencies.claudeObservation?.getDirectoryStatus?.() ?? [...STOPPED_CLAUDE_DIRECTORY_STATUS]
          : [...STOPPED_CLAUDE_DIRECTORY_STATUS],
        claudeProvider: {
          enabled: claudeProviderEnabled,
          error: claudeProviderError,
          revision: claudeProviderRevision
        },
        lastSyncedAt: connection.lastSyncedAt,
        lastUserPromptCaptureEnabled,
        claudeLastUserPromptCaptureEnabled,
        titleEnrichmentDiagnostic: this.titleEnrichmentDiagnostic
      };
      if (claudeProviderRevision !== this.claudeProviderRevision) continue;
      return snapshot;
    }
  }

  async connectAppServer(): Promise<EyesOnAgentsSnapshot> {
    this.foregroundAppServerOperationPending += 1;
    try {
      if (this.appServerTeardownPromise) {
        await this.appServerTeardownPromise;
        return await this.getSnapshot();
      }
      await this.joinBackgroundRefresh();
      this.appServerIntentVersion += 1;
      const intentVersion = this.appServerLifecycleVersion;
      await this.attemptInstalledObservationActive();
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
    } finally {
      this.foregroundAppServerOperationPending -= 1;
    }
  }

  async disconnectAppServer(): Promise<EyesOnAgentsSnapshot> {
    this.appServerIntentVersion += 1;
    await this.requestAppServerTeardown({ disableAutoConnect: true });
    this.notify();
    return await this.getSnapshot();
  }

  async syncThreads(): Promise<EyesOnAgentsSnapshot> {
    this.foregroundAppServerOperationPending += 1;
    const claudeRefresh = this.isClaudeProviderAvailable()
      ? this.dependencies.claudeObservation?.refresh('full').catch(() => undefined) ?? Promise.resolve()
      : Promise.resolve();
    try {
      if (this.appServerTeardownPromise) {
        await this.appServerTeardownPromise;
        await claudeRefresh;
        return await this.getSnapshot();
      }
      await this.joinBackgroundRefresh();
      const intentVersion = this.appServerLifecycleVersion;
      await this.attemptInstalledObservationActive();
      await this.runAppServerOperation(intentVersion, async (context) => {
        if (!await this.ensureAppServerConnected(context)) return;
        await this.performSync(context);
        if (!this.isAppServerActive(context)) return;
        await this.performRefreshThreadPages(context);
      });
      await claudeRefresh;
      return await this.getSnapshot();
    } finally {
      this.foregroundAppServerOperationPending -= 1;
    }
  }

  async refreshClaudeInventory(): Promise<EyesOnAgentsSnapshot> {
    this.requireClaudeProviderEnabled();
    const runtimeVersion = this.claudeProviderRuntimeVersion;
    await this.dependencies.claudeObservation?.refresh('full').catch(() => undefined);
    if (!this.isClaudeProviderRuntimeCurrent(runtimeVersion)) return await this.getSnapshot();
    return await this.getSnapshot();
  }

  async refreshThreadPages(): Promise<EyesOnAgentsThreadPagesRefreshResult> {
    if (this.isClaudeProviderAvailable()) void this.refreshClaudeBackground();
    if (this.backgroundRefreshPromise) {
      return await this.backgroundRefreshPromise;
    }
    const intentVersion = this.appServerLifecycleVersion;
    const operation = (async (): Promise<EyesOnAgentsThreadPagesRefreshResult> => {
      const codexChanged = await (async (): Promise<boolean> => {
        if (this.foregroundAppServerOperationPending > 0) return false;
        if (
          this.appServerTeardownPromise ||
          this.activeAppServerOperations.size > 0 ||
          this.activeAppServerRuntimeOperations.size > 0
        ) return false;
        const status = this.dependencies.appServer.getStatus(this.autoConnectEnabled);
        if (status.state === 'connecting' || status.state === 'syncing') return false;
        if (!this.dependencies.appServer.isConnected() && !this.autoConnectEnabled) return false;
        let changed = false;
        try {
          await this.runAppServerOperation(intentVersion, async (context) => {
            if (!this.dependencies.appServer.isConnected() && !this.autoConnectEnabled) return;
            if (!await this.ensureAppServerConnected(context, { invalidateStatuses: false })) return;
            changed = await this.performRefreshThreadPages(context);
          });
        } catch {
          // Connection state remains authoritative; periodic refresh is intentionally silent.
        }
        return changed;
      })();
      return { changed: codexChanged };
    })();
    this.backgroundRefreshPromise = operation;
    try {
      return await operation;
    } finally {
      if (this.backgroundRefreshPromise === operation) {
        this.backgroundRefreshPromise = null;
      }
    }
  }

  private async joinBackgroundRefresh(): Promise<void> {
    if (!this.backgroundRefreshPromise) return;
    await Promise.allSettled([this.backgroundRefreshPromise]);
  }

  private refreshClaudeBackground(): Promise<void> {
    if (!this.isClaudeProviderAvailable()) return Promise.resolve();
    if (this.claudeBackgroundRefreshPromise) return this.claudeBackgroundRefreshPromise;
    const providerRuntimeVersion = this.claudeProviderRuntimeVersion;
    const operation = (async (): Promise<void> => {
      let observationChanged = false;
      try {
        const result = await this.dependencies.claudeObservation?.refresh('poll');
        observationChanged = result?.changed === true;
      } catch {
        // Lease expiry remains a fallback even when Claude discovery is unavailable.
      }
      if (!this.isClaudeProviderRuntimeCurrent(providerRuntimeVersion)) return;
      try {
        const result = await this.dependencies.repository.expireClaudeAgentStates?.({
          observedAt: this.now(),
          statusSources: ['claude_agent_view']
        });
        // ClaudeObservation broadcasts its own commits. Only emit here when expiry is the
        // mutation, so one reconciliation chain does not broadcast the same tick twice.
        if (this.isClaudeProviderRuntimeCurrent(providerRuntimeVersion) &&
          result?.changed && !observationChanged) this.notify();
      } catch {
        // Periodic Claude reconciliation is intentionally best effort.
      }
    })();
    this.claudeBackgroundRefreshPromise = operation;
    void operation.finally(() => {
      if (this.claudeBackgroundRefreshPromise === operation) {
        this.claudeBackgroundRefreshPromise = null;
      }
    });
    return operation;
  }

  private async joinClaudeBackgroundRefresh(): Promise<void> {
    if (!this.claudeBackgroundRefreshPromise) return;
    await Promise.allSettled([this.claudeBackgroundRefreshPromise]);
  }

  private async attemptInstalledObservationActive(
    intentVersion = this.observationIntentVersion
  ): Promise<void> {
    try {
      if (!this.dependencies.desktopBridge.hasInstallationIntent()) return;
      await this.runObservationOperation(intentVersion, async (context) => {
        await this.ensureDesktopObservation(context, false);
      });
    } catch (error) {
      const context = this.observationContext;
      if (!context || !this.isObservationActive(context)) return;
      try {
        await this.handleBridgeOperationalFailure(context, error);
      } catch {
        // The observation error is already recorded; inventory remains independent.
      }
      if (this.isObservationActive(context)) this.notify();
    }
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

  private async ensureAppServerConnected(
    context: AppServerContext,
    options: { invalidateStatuses?: boolean } = {}
  ): Promise<boolean> {
    if (!this.isAppServerActive(context)) return false;
    if (this.dependencies.appServer.isConnected()) return true;
    if (options.invalidateStatuses !== false) {
      await this.dependencies.repository.invalidateAppServerStatuses({ observedAt: this.now() });
      if (!this.isAppServerActive(context)) return false;
    }
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

  private recordTitleEnrichmentDiagnostic(
    generation: number,
    value: Omit<EyesOnAgentsTitleEnrichmentDiagnostic, 'observedAt'>
  ): void {
    if (generation !== this.titleEnrichmentGeneration) return;
    this.titleEnrichmentDiagnostic = {
      ...value,
      observedAt: new Date(this.now()).toISOString()
    };
    this.notify();
  }

  private completeTitleEnrichment(generation: number): boolean {
    if (generation !== this.titleEnrichmentGeneration) return false;
    const cleared = this.titleEnrichmentDiagnostic !== null;
    this.titleEnrichmentDiagnostic = null;
    this.titleEnrichmentGeneration += 1;
    return cleared;
  }

  private clearTitleEnrichmentDiagnosticForFullSync(): void {
    this.titleEnrichmentGeneration += 1;
    this.titleEnrichmentDiagnostic = null;
  }

  private clearTitleEnrichmentDiagnosticForThread(threadId: string): boolean {
    if (this.titleEnrichmentDiagnostic?.threadId !== threadId) return false;
    this.titleEnrichmentDiagnostic = null;
    return true;
  }

  private scheduleMissingThreadTitleEnrichment(threadId: string): void {
    if (this.titleEnrichmentOperations.has(threadId)) return;
    const generation = this.titleEnrichmentGeneration + 1;
    this.titleEnrichmentGeneration = generation;
    let operation: Promise<void>;
    operation = new Promise((resolve) => {
      setImmediate(() => {
        void this.performMissingThreadTitleEnrichment(threadId, generation).then(
          () => resolve(),
          () => resolve()
        );
      });
    });
    this.titleEnrichmentOperations.set(threadId, operation);
    this.activeAppServerRuntimeOperations.add(operation);
    const clear = (): void => {
      if (this.titleEnrichmentOperations.get(threadId) === operation) {
        this.titleEnrichmentOperations.delete(threadId);
      }
      this.activeAppServerRuntimeOperations.delete(operation);
    };
    void operation.then(clear, clear);
  }

  private async performMissingThreadTitleEnrichment(
    threadId: string,
    generation: number
  ): Promise<void> {
    const context = this.appServerContext;
    if (
      !context ||
      !this.isAppServerActive(context) ||
      !this.dependencies.appServer.isConnected()
    ) {
      this.recordTitleEnrichmentDiagnostic(generation, {
        state: 'skipped',
        reason: 'app_server_unavailable',
        threadId
      });
      return;
    }
    const read = await this.awaitUnlessCancelled(
      Promise.resolve().then(async () => await this.dependencies.appServer.readThread(threadId)),
      context.controller.signal
    );
    if (read.state === 'cancelled') {
      this.recordTitleEnrichmentDiagnostic(generation, {
        state: 'skipped',
        reason: 'app_server_unavailable',
        threadId
      });
      return;
    }
    if (read.state === 'rejected') {
      this.recordTitleEnrichmentDiagnostic(generation, {
        state: 'rejected',
        reason: 'thread_read_rejected',
        threadId
      });
      return;
    }
    let title: string | null = null;
    try {
      if (!isEyesOnAgentsRecord(read.value)) throw new Error('unusable response');
      const returnedThreadId = parseEyesOnAgentsUuid(
        providerThreadField(read.value, 'id'),
        'Codex thread/read thread id'
      );
      if (returnedThreadId !== threadId) throw new Error('unusable response');
      title = normalizeEyesOnAgentsProviderThreadTitle(read.value);
    } catch {
      title = null;
    }
    if (title === null) {
      this.recordTitleEnrichmentDiagnostic(generation, {
        state: 'rejected',
        reason: 'unusable_response',
        threadId
      });
      return;
    }
    if (!this.isAppServerActive(context) || !this.dependencies.appServer.isConnected()) {
      this.recordTitleEnrichmentDiagnostic(generation, {
        state: 'skipped',
        reason: 'app_server_unavailable',
        threadId
      });
      return;
    }
    let changed = false;
    try {
      const enriched = await this.dependencies.repository.enrichMissingThreadTitle({
        threadId,
        title
      });
      changed = enriched.changed;
    } catch {
      this.recordTitleEnrichmentDiagnostic(generation, {
        state: 'rejected',
        reason: 'thread_read_rejected',
        threadId
      });
      return;
    }
    const cleared = this.completeTitleEnrichment(generation);
    if (changed || cleared) this.notify();
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
      const recovery = this.pendingHookCoverageGap;
      if (
        this.bridgeStatus().state === 'installed' &&
        recovery !== null
      ) {
        const recovered = await this.awaitUnlessCancelled(
          this.dependencies.bridgeListener.recoverOutboxCoverageGap(recovery.gap),
          context.controller.signal
        );
        if (recovered.state === 'cancelled') {
          this.rejectHookListenerLifetime(lifetime);
          return;
        }
        if (recovered.state === 'rejected') throw recovered.error;
        if (this.pendingHookCoverageGap?.generation !== recovery.generation) {
          throw new Error('Codex hook delivery coverage changed during recovery');
        }
      } else if (recovery !== null) {
        this.dependencies.desktopBridge.setOperationalError(
          new Error('Codex hook delivery coverage is incomplete')
        );
      }
      if (this.bridgeStatus().state === 'installed') {
        const flushResult = await this.flushCodexHookEvents(lifetime, context);
        if (flushResult === 'cancelled') return;
        if (flushResult === 'trusted') {
          if (recovery !== null) {
            if (this.pendingHookCoverageGap?.generation !== recovery.generation) {
              throw new Error('Codex hook delivery coverage changed during recovery');
            }
            const replayed = await this.awaitUnlessCancelled(
              this.dependencies.bridgeListener.replayOutbox(),
              context.controller.signal
            );
            if (replayed.state === 'cancelled') {
              this.rejectHookListenerLifetime(lifetime);
              return;
            }
            if (replayed.state === 'rejected') throw replayed.error;
            if (this.pendingHookCoverageGap?.generation !== recovery.generation) {
              throw new Error('Codex hook delivery coverage changed during recovery');
            }
            this.pendingHookCoverageGap = null;
          }
          return;
        }
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
      await this.awaitUnlessCancelled(
        this.refreshBridgeInspection(observationContext),
        context.controller.signal
      );
      // Observation status records its own failure; managed inventory remains independent.
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
    this.clearTitleEnrichmentDiagnosticForFullSync();
    if (!this.isAppServerActive(context)) return;
    this.notify();
  }

  private async performRefreshThreadPages(context: AppServerContext): Promise<boolean> {
    if (!this.isAppServerActive(context)) return false;
    const selected = await this.awaitUnlessCancelled(
      this.dependencies.repository.getThreadRefreshPages({
        coldPage: this.coldThreadRefreshPage,
        previousPageCount: this.threadRefreshPageCount
      }),
      context.controller.signal
    );
    if (selected.state === 'cancelled') return false;
    if (selected.state === 'rejected') throw selected.error;
    if (!this.isAppServerActive(context)) return false;
    if (
      selected.value.hot.length > THREAD_REFRESH_PAGE_SIZE ||
      selected.value.cold.length > THREAD_REFRESH_PAGE_SIZE
    ) {
      throw new Error('Thread refresh repository returned an oversized page');
    }
    const selectedThreadIds = [
      ...selected.value.hot.map((candidate) => candidate.threadId),
      ...selected.value.cold.map((candidate) => candidate.threadId)
    ];
    if (new Set(selectedThreadIds).size !== selectedThreadIds.length) {
      throw new Error('Thread refresh pages contain duplicate thread ids');
    }
    const pageCount = selected.value.pageCount;
    const coldPage = selected.value.coldPage;
    if (
      !Number.isSafeInteger(pageCount) ||
      pageCount < 0 ||
      (pageCount <= 1 && coldPage !== null) ||
      (
        pageCount > 1 &&
        (coldPage === null || coldPage < 2 || coldPage > pageCount)
      )
    ) {
      throw new Error('Thread refresh repository returned invalid pagination');
    }
    this.threadRefreshPageCount = pageCount;

    const promptAdmission: ThreadRefreshPromptAdmission = {
      enabled: this.lastUserPromptPreference.isEnabled(),
      epoch: this.lastUserPromptPreferenceEpoch
    };
    if (coldPage === null) {
      this.coldThreadRefreshPage = 2;
    } else if (coldPage !== this.coldThreadRefreshPage) {
      this.coldThreadRefreshPage = coldPage;
    }

    const hot = await this.refreshThreadBatch(
      selected.value.hot,
      context,
      promptAdmission
    );
    if (!hot.completed) return hot.changed;
    let changed = hot.changed;
    if (coldPage === null) return changed;

    let cold: ThreadRefreshBatchResult;
    try {
      cold = await this.refreshThreadBatch(
        selected.value.cold,
        context,
        promptAdmission
      );
    } catch {
      return changed;
    }
    changed = changed || cold.changed;
    if (!cold.completed) return changed;
    this.coldThreadRefreshPage = coldPage >= pageCount
      ? 2
      : coldPage + 1;
    return changed;
  }

  private async refreshThreadBatch(
    candidates: EyesOnAgentsThreadRefreshCandidate[],
    context: AppServerContext,
    promptAdmission: ThreadRefreshPromptAdmission
  ): Promise<ThreadRefreshBatchResult> {
    if (!this.isAppServerActive(context)) return { changed: false, completed: false };
    if (new Set(candidates.map((candidate) => candidate.threadId)).size !== candidates.length) {
      throw new Error('Thread refresh page contains duplicate thread ids');
    }
    if (candidates.length === 0) return { changed: false, completed: true };

    const patches: Array<EyesOnAgentsThreadRefreshPatch | null> = new Array(
      candidates.length
    ).fill(null);
    let nextIndex = 0;
    let cancelled = false;
    const worker = async (): Promise<void> => {
      while (!cancelled) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= candidates.length) return;
        const candidate = candidates[index];
        if (!candidate || !this.isAppServerActive(context)) {
          cancelled = true;
          return;
        }
        const projected = await this.projectThreadRefreshCandidate(
          candidate,
          context,
          promptAdmission
        );
        if (projected.state === 'cancelled') {
          cancelled = true;
          return;
        }
        if (projected.state === 'resolved') patches[index] = projected.value;
      }
    };
    const workers: Promise<void>[] = [];
    const workerCount = Math.min(THREAD_REFRESH_CONCURRENCY, candidates.length);
    for (let index = 0; index < workerCount; index += 1) workers.push(worker());
    await Promise.all(workers);
    if (cancelled || !this.isAppServerActive(context)) {
      return { changed: false, completed: false };
    }

    const promptWriteAllowed = promptAdmission.enabled &&
      promptAdmission.epoch === this.lastUserPromptPreferenceEpoch &&
      this.lastUserPromptPreference.isEnabled();
    const semanticPatches: EyesOnAgentsThreadRefreshPatch[] = [];
    for (const patch of patches) {
      if (!patch) continue;
      if (!promptWriteAllowed) delete patch.lastUserPrompt;
      if (hasThreadRefreshPatch(patch)) semanticPatches.push(patch);
    }
    if (semanticPatches.length === 0) return { changed: false, completed: true };

    const refreshed = await this.dependencies.repository.refreshThreadPage({
      threads: semanticPatches
    });
    for (const intent of refreshed.completionAlerts ?? []) {
      this.notifyThreadCompleted(intent);
    }
    const repairedDiagnostic = semanticPatches.find((thread) => (
      thread.threadId === this.titleEnrichmentDiagnostic?.threadId &&
      thread.title !== undefined
    ));
    const clearedDiagnostic = repairedDiagnostic
      ? this.clearTitleEnrichmentDiagnosticForThread(repairedDiagnostic.threadId)
      : false;
    if (!this.isAppServerActive(context)) {
      return { changed: refreshed.changed, completed: false };
    }
    if (refreshed.changed || clearedDiagnostic) this.notify();
    return { changed: refreshed.changed, completed: true };
  }

  private isActiveTurnAuthorityAbsent(
    activeTurn: NonNullable<EyesOnAgentsThreadRefreshCandidate['activeTurn']>
  ): boolean {
    if (activeTurn.statusSource !== 'codex_hook') return false;
    const bridge = this.bridgeStatus();
    const listeningSince = bridge.listeningSince === null
      ? null
      : Date.parse(bridge.listeningSince);
    return effectiveEyesOnAgentsRuntimeState({
      runtimeState: activeTurn.runtimeState,
      statusSource: activeTurn.statusSource,
      statusObservedAt: activeTurn.statusObservedAt,
      managedServerConnected: this.dependencies.appServer.isConnected(),
      hookBridgeState: bridge.state,
      hookBridgeListening: bridge.listening,
      hookBridgeListeningSince: Number.isFinite(listeningSince) ? listeningSince : null
    }) === 'unknown';
  }

  private async projectThreadRefreshCandidate(
    candidate: EyesOnAgentsThreadRefreshCandidate,
    context: AppServerContext,
    promptAdmission: ThreadRefreshPromptAdmission
  ): Promise<CancellableResult<EyesOnAgentsThreadRefreshPatch | null>> {
    const observedAt = this.now();
    const activeTurn = candidate.activeTurn ?? null;
    const recoveryCandidate = activeTurn === null
      ? candidate.recoveryCandidate ?? null
      : null;
    const read = await this.awaitUnlessCancelled(
      Promise.resolve().then(
        async () => await this.dependencies.appServer.readThread(candidate.threadId)
      ),
      context.controller.signal
    );
    if (read.state === 'cancelled') return read;
    let metadataReadSucceeded = false;
    let projection: ReturnType<typeof parseThreadRefreshRead> = {
      patch: { threadId: candidate.threadId },
      providerActivityAt: null
    };
    if (read.state === 'resolved') {
      try {
        projection = parseThreadRefreshRead(read.value, {
          expectedThreadId: candidate.threadId
        });
        metadataReadSucceeded = true;
      } catch {
        // Terminal reconciliation is independent from optional thread metadata.
      }
    }
    const shouldReadPrompt = metadataReadSucceeded &&
      promptAdmission.enabled &&
      promptAdmission.epoch === this.lastUserPromptPreferenceEpoch &&
      this.lastUserPromptPreference.isEnabled() &&
      (
        candidate.lastUserPromptCheckedAt === null ||
        (
          projection.providerActivityAt !== null &&
          projection.providerActivityAt > candidate.lastUserPromptCheckedAt
        )
      );
    if (shouldReadPrompt) {
      const turns = await this.awaitUnlessCancelled(
        Promise.resolve().then(
          async () => await this.dependencies.appServer.listThreadTurns(candidate.threadId)
        ),
        context.controller.signal
      );
      if (turns.state === 'cancelled') return turns;
      if (turns.state === 'resolved') {
        try {
          projection.patch.lastUserPrompt = lastUserPromptFromTurns(
            turns.value,
            {
              checkedAt: projection.providerActivityAt ?? observedAt,
              providerActivityAt: projection.providerActivityAt
            }
          );
        } catch {
          // A malformed content page must not suppress the metadata patch.
        }
      }
    }
    if (activeTurn !== null || recoveryCandidate !== null) {
      const latestTurn = await this.awaitUnlessCancelled(
        Promise.resolve().then(
          async () => await this.dependencies.appServer.readLatestThreadTurn(
            candidate.threadId
          )
        ),
        context.controller.signal
      );
      if (latestTurn.state === 'cancelled') return latestTurn;
      if (latestTurn.state === 'resolved' && activeTurn !== null) {
        const terminalTurn = terminalTurnFromLatest(latestTurn.value, {
          activeTurnId: activeTurn.turnId,
          statusObservedAt: activeTurn.statusObservedAt,
          statusSource: activeTurn.statusSource,
          polledAt: observedAt
        });
        if (terminalTurn !== undefined) {
          projection.patch.terminalTurn = terminalTurn;
        } else if (this.isActiveTurnAuthorityAbsent(activeTurn)) {
          const reclaimedTurn = reclaimedTurnFromLatest(latestTurn.value, {
            activeTurnId: activeTurn.turnId,
            statusObservedAt: activeTurn.statusObservedAt,
            polledAt: observedAt
          });
          if (reclaimedTurn !== undefined) projection.patch.reclaimedTurn = reclaimedTurn;
        }
      }
      if (latestTurn.state === 'resolved' && recoveryCandidate !== null) {
        const settledTurn = settledTurnFromLatest(latestTurn.value, {
          statusObservedAt: recoveryCandidate.statusObservedAt,
          polledAt: observedAt
        });
        if (settledTurn !== undefined) {
          projection.patch.settledTurn = settledTurn;
        } else {
          const recoveredTurn = recoveredTurnFromLatest(latestTurn.value, {
            statusObservedAt: recoveryCandidate.statusObservedAt,
            polledAt: observedAt
          });
          if (recoveredTurn !== undefined) projection.patch.recoveredTurn = recoveredTurn;
        }
      }
    }
    return {
      state: 'resolved',
      value: hasThreadRefreshPatch(projection.patch) ? projection.patch : null
    };
  }

  async openThread(params: { sessionKey: EyesOnAgentsSessionKey }): Promise<{
    url: string;
    snapshot: EyesOnAgentsSnapshot;
  }> {
    const sessionKey = parseEyesOnAgentsSessionKey(params?.sessionKey);
    if (sessionKey.startsWith('claude:')) {
      return await this.runClaudeBridgeLifecycle(async () => {
        this.requireClaudeProviderEnabled();
        const stored = (await this.dependencies.repository.getSnapshot()).threads.find(
          (thread) => thread.sessionKey === sessionKey
        );
        if (!stored || stored.provider !== 'claude') throw new Error('Thread was not found');
        const target = await this.dependencies.repository.getClaudeOpenTarget({ sessionKey });
        if (!target?.desktopSessionId) {
          throw new Error('This Claude session is not matched to Claude Desktop');
        }
        const url = buildEyesOnAgentsClaudeDesktopDeepLink(target.desktopSessionId);
        await this.dependencies.openExternal(url);
        await this.dependencies.repository.markOpened({ sessionKey, openedAt: this.now() });
        this.notify();
        return { url, snapshot: await this.getSnapshot() };
      });
    }
    const stored = (await this.dependencies.repository.getSnapshot()).threads.find(
      (thread) => thread.sessionKey === sessionKey
    );
    if (!stored) throw new Error('Thread was not found');
    const threadId = parseEyesOnAgentsUuid(stored.threadId);
    const url = buildEyesOnAgentsDeepLink(threadId);
    await this.dependencies.openExternal(url);
    await this.syncOpenedThreadStatus(threadId);
    await this.dependencies.repository.markOpened({ sessionKey, openedAt: this.now() });
    this.notify();
    return { url, snapshot: await this.getSnapshot() };
  }

  async openThreadInIterm2(params: { sessionKey: EyesOnAgentsSessionKey }): Promise<{
    url: string;
    snapshot: EyesOnAgentsSnapshot;
  }> {
    const sessionKey = parseEyesOnAgentsSessionKey(params?.sessionKey);
    return await this.runClaudeBridgeLifecycle(async () => {
      this.requireClaudeProviderEnabled();
      const stored = (await this.dependencies.repository.getSnapshot()).threads.find(
        (thread) => thread.sessionKey === sessionKey
      );
      if (!stored || stored.provider !== 'claude') throw new Error('Thread was not found');
      const target = await this.dependencies.repository.getClaudeOpenTarget({ sessionKey });
      if (!target?.iterm2SessionId) {
        throw new Error('This Claude session is not matched to an iTerm2 session');
      }
      const url = buildEyesOnAgentsIterm2DeepLink(target.iterm2SessionId);
      await this.dependencies.openExternal(url);
      await this.dependencies.repository.markOpened({ sessionKey, openedAt: this.now() });
      this.notify();
      return { url, snapshot: await this.getSnapshot() };
    });
  }

  async archiveThread(params: {
    sessionKey: EyesOnAgentsSessionKey;
  }): Promise<EyesOnAgentsSnapshot> {
    const sessionKey = parseEyesOnAgentsSessionKey(params?.sessionKey);
    if (sessionKey.startsWith('claude:')) {
      throw new Error('Only Codex tasks can be archived');
    }
    const stored = (await this.dependencies.repository.getSnapshot()).threads.find(
      (thread) => thread.sessionKey === sessionKey && thread.provider === 'codex'
    );
    if (!stored) throw new Error('Thread was not found');
    const threadId = parseEyesOnAgentsUuid(stored.threadId);

    this.foregroundAppServerOperationPending += 1;
    try {
      if (this.appServerTeardownPromise) {
        await this.appServerTeardownPromise;
        throw new Error('Codex archive was cancelled by a connection change');
      }
      await this.joinBackgroundRefresh();
      const intentVersion = this.appServerLifecycleVersion;
      await this.attemptInstalledObservationActive();
      let providerArchived = false;
      await this.runAppServerOperation(intentVersion, async (context) => {
        if (!await this.ensureAppServerConnected(context)) {
          throw new Error('Codex archive was cancelled by a connection change');
        }
        if (!this.isAppServerActive(context)) {
          throw new Error('Codex archive was cancelled by a connection change');
        }
        await this.dependencies.appServer.archiveThread(threadId);
        providerArchived = true;
        await this.dependencies.repository.setThreadArchived({
          threadId,
          archived: true,
          observedAt: this.now()
        });
        this.notify();
      });
      if (!providerArchived) {
        throw new Error('Codex archive was cancelled by a connection change');
      }
      return await this.getSnapshot();
    } finally {
      this.foregroundAppServerOperationPending -= 1;
    }
  }

  async previewThread(params: { sessionKey: EyesOnAgentsSessionKey }): Promise<void> {
    const sessionKey = parseEyesOnAgentsSessionKey(params?.sessionKey);
    if (!sessionKey.startsWith('claude:')) throw new Error('Only Claude transcripts can be previewed');
    await this.runClaudeBridgeLifecycle(async () => {
      this.requireClaudeProviderEnabled();
      const target = await this.dependencies.repository.getClaudeOpenTarget({ sessionKey });
      if (!target?.transcriptPath) throw new Error('Claude transcript is unavailable');
      if (!this.dependencies.validateClaudeTranscript || !this.dependencies.previewAbsoluteTarget) {
        throw new Error('Claude transcript preview is unavailable');
      }
      await this.dependencies.previewAbsoluteTarget(
        this.dependencies.validateClaudeTranscript(
          target.transcriptPath,
          parseEyesOnAgentsUuid(sessionKey.slice('claude:'.length), 'Claude thread ID')
        )
      );
    });
  }

  async copySessionPath(params: { sessionKey: EyesOnAgentsSessionKey }): Promise<void> {
    const sessionKey = parseEyesOnAgentsSessionKey(params?.sessionKey);
    if (!sessionKey.startsWith('claude:')) {
      throw new Error('Only Claude sessions expose a session file path');
    }
    await this.runClaudeBridgeLifecycle(async () => {
      this.requireClaudeProviderEnabled();
      const target = await this.dependencies.repository.getClaudeOpenTarget({ sessionKey });
      if (!target?.transcriptPath) throw new Error('Claude session file is unavailable');
      if (!this.dependencies.validateClaudeTranscript) {
        throw new Error('Claude session file validation is unavailable');
      }
      this.dependencies.writeClipboardText(
        this.dependencies.validateClaudeTranscript(
          target.transcriptPath,
          parseEyesOnAgentsUuid(sessionKey.slice('claude:'.length), 'Claude thread ID')
        )
      );
    });
  }

  private async syncOpenedThreadStatus(threadId: string): Promise<void> {
    try {
      if (this.appServerTeardownPromise) return;
      if (!this.dependencies.appServer.isConnected()) return;
      const candidate = await this.dependencies.repository.getThreadRefreshCandidate({
        threadId
      });
      if (!candidate) return;
      if (candidate.activeTurn === null && candidate.recoveryCandidate === null) return;
      await this.joinBackgroundRefresh();
      const intentVersion = this.appServerLifecycleVersion;
      await this.runAppServerOperation(intentVersion, async (context) => {
        if (!this.dependencies.appServer.isConnected()) return;
        if (!this.isAppServerActive(context)) return;
        const projected = await this.projectThreadRefreshCandidate(
          candidate,
          context,
          { enabled: false, epoch: this.lastUserPromptPreferenceEpoch }
        );
        if (projected.state !== 'resolved' || projected.value === null) return;
        if (!this.isAppServerActive(context)) return;
        const refreshed = await this.dependencies.repository.refreshThreadPage({
          threads: [projected.value]
        });
        for (const intent of refreshed.completionAlerts ?? []) {
          this.notifyThreadCompleted(intent);
        }
        if (!this.isAppServerActive(context)) return;
      });
    } catch {
      // A successful deep link and its Open evidence must survive any status-sync failure.
    }
  }

  async markAllRead(): Promise<EyesOnAgentsSnapshot> {
    await this.runClaudeProviderIntent(async () => {
      const providers = this.isClaudeProviderAvailable()
        ? ['codex', 'claude'] as const
        : ['codex'] as const;
      const result = await this.dependencies.repository.markAllRead({ providers: [...providers] });
      if (result.changed) this.notify();
    });
    return await this.getSnapshot();
  }

  async setThreadUnread(params: {
    sessionKey: EyesOnAgentsSessionKey;
    isUnread: boolean;
  }): Promise<EyesOnAgentsSnapshot> {
    const sessionKey = parseEyesOnAgentsSessionKey(params?.sessionKey);
    if (typeof params?.isUnread !== 'boolean') {
      throw new Error('Thread read state is invalid');
    }
    const isUnread = params.isUnread;
    const apply = async (): Promise<void> => {
      const stored = (await this.dependencies.repository.getSnapshot()).threads.find(
        (thread) => thread.sessionKey === sessionKey
      );
      if (!stored) throw new Error('Thread was not found');
      const result = await this.dependencies.repository.setThreadUnread({ sessionKey, isUnread });
      if (result.changed) this.notify();
    };
    if (sessionKey.startsWith('claude:')) {
      await this.runClaudeProviderIntent(async () => {
        this.requireClaudeProviderEnabled();
        await apply();
      });
      return await this.getSnapshot();
    }
    await apply();
    return await this.getSnapshot();
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

  async moveThread(params: {
    sessionKey: EyesOnAgentsSessionKey;
    domainId: number;
  }): Promise<EyesOnAgentsSnapshot> {
    const sessionKey = parseEyesOnAgentsSessionKey(params?.sessionKey);
    if (sessionKey.startsWith('claude:')) {
      await this.runClaudeBridgeLifecycle(async () => {
        this.requireClaudeProviderEnabled();
        await this.dependencies.repository.moveThread({ ...params, sessionKey });
      });
      return await this.changedSnapshot();
    }
    await this.dependencies.repository.moveThread({ ...params, sessionKey });
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
    this.pendingHookCoverageGap = null;
    return await this.changedSnapshot();
  }

  async getCodexBridgeStatus(): Promise<EyesOnAgentsBridgeStatus> {
    return this.bridgeStatus();
  }

  private async hydrateClaudeProvider(runtimeVersion: number): Promise<void> {
    const hydration = await this.runClaudeProviderIntent(
      async (): Promise<ClaudeProviderPreferenceHydration | null> => {
        if (!this.isClaudeProviderVersionCurrent(runtimeVersion)) return null;
        try {
          return await this.claudeProviderPreference.hydrate();
        } catch (error) {
          return {
            state: 'invalid',
            error: boundedClaudeProviderError(error)
          };
        }
      }
    );
    if (hydration === null) return;
    if (!this.isClaudeProviderVersionCurrent(runtimeVersion)) return;
    await this.runClaudeBridgeLifecycle(async () => {
      if (!this.isClaudeProviderVersionCurrent(runtimeVersion)) return;
      if (hydration.state === 'invalid') {
        this.bumpClaudeProviderRevision();
        this.claudeProviderPreferenceEnabled = false;
        this.claudeProviderEnableCutoff = null;
        await this.deactivateClaudeProvider(runtimeVersion, hydration.error, true);
        return;
      }
      this.bumpClaudeProviderRevision();
      this.claudeProviderPreferenceEnabled = hydration.preference.enabled;
      this.claudeProviderEnableCutoff = hydration.preference.hookAdmissionAfter;
      this.claudeProviderError = null;
      if (hydration.preference.enabled) {
        await this.activateClaudeProvider(
          runtimeVersion,
          hydration.preference.hookAdmissionAfter === CLAUDE_PROVIDER_PENDING_ADMISSION
        );
      } else {
        await this.deactivateClaudeProvider(runtimeVersion, null, true);
      }
    });
  }

  private async activateClaudeProvider(
    runtimeVersion: number,
    clearOutbox: boolean
  ): Promise<void> {
    if (!this.isClaudeProviderRuntimeIntentCurrent(runtimeVersion)) return;
    if (clearOutbox) {
      try {
        await this.dependencies.claudeHookListener?.clearOutbox?.();
      } catch (error) {
        if (!this.isClaudeProviderVersionCurrent(runtimeVersion)) return;
        this.claudeProviderProjectionEnabled = false;
        this.claudeHookIntakeEnabled = false;
        this.claudeProviderError = boundedClaudeProviderError(error);
        this.bumpClaudeProviderRevision();
        this.notify();
        return;
      }
    }
    if (!this.isClaudeProviderRuntimeIntentCurrent(runtimeVersion)) return;
    if (this.claudeProviderEnableCutoff === CLAUDE_PROVIDER_PENDING_ADMISSION) {
      let finalized = false;
      try {
        await this.runClaudeProviderIntent(async () => {
          if (!this.isClaudeProviderRuntimeIntentCurrent(runtimeVersion) ||
            this.claudeProviderEnableCutoff !== CLAUDE_PROVIDER_PENDING_ADMISSION) return;
          const cutoff = this.now();
          await this.claudeProviderPreference.setEnabled(true, cutoff);
          if (!this.isClaudeProviderRuntimeIntentCurrent(runtimeVersion)) return;
          this.claudeProviderEnableCutoff = cutoff;
          this.bumpClaudeProviderRevision();
          finalized = true;
        });
      } catch (error) {
        if (!this.isClaudeProviderVersionCurrent(runtimeVersion)) return;
        this.claudeProviderProjectionEnabled = false;
        this.claudeHookIntakeEnabled = false;
        this.claudeProviderError = boundedClaudeProviderError(error);
        this.bumpClaudeProviderRevision();
        this.notify();
        return;
      }
      if (!finalized) return;
    }
    try {
      await this.invalidateClaudeHookActiveStates();
      if (!this.isClaudeProviderRuntimeIntentCurrent(runtimeVersion)) return;
      await this.dependencies.claudeObservation?.start();
    } catch (error) {
      if (!this.isClaudeProviderVersionCurrent(runtimeVersion)) return;
      this.claudeProviderProjectionEnabled = false;
      this.claudeHookIntakeEnabled = false;
      this.claudeProviderError = boundedClaudeProviderError(error);
      this.bumpClaudeProviderRevision();
      await this.dependencies.claudeObservation?.stop().catch(() => undefined);
      this.notify();
      return;
    }
    if (!this.isClaudeProviderRuntimeIntentCurrent(runtimeVersion)) {
      await this.dependencies.claudeObservation?.stop().catch(() => undefined);
      return;
    }
    this.claudeProviderProjectionEnabled = true;
    this.claudeProviderError = null;
    this.bumpClaudeProviderRevision();
    const bridge = this.dependencies.claudeBridge;
    if (bridge?.hasInstallationIntent()) {
      try {
        const status = await bridge.refresh();
        if (!this.isClaudeProviderRuntimeCurrent(runtimeVersion)) return;
        const canListen = status.configured && status.enabled &&
          !status.error && status.state !== 'drifted';
        if (canListen) {
          const listenerInstallationId = this.currentClaudeBridgeInstallationId();
          this.claudeHookIntakeEnabled = true;
          try {
            await this.dependencies.claudeHookListener?.start();
            if (!this.isClaudeProviderRuntimeCurrent(runtimeVersion)) {
              this.claudeHookIntakeEnabled = false;
              await this.dependencies.claudeHookListener?.stop().catch(() => undefined);
              return;
            }
            await this.dependencies.claudeHookListener?.replayOutbox();
            this.claudeHookListenerInstallationId = listenerInstallationId;
          } catch (error) {
            this.claudeHookIntakeEnabled = false;
            this.claudeHookListenerInstallationId = null;
            await this.dependencies.claudeHookListener?.stop().catch(() => undefined);
            await this.invalidateClaudeHookActiveStates().catch(() => undefined);
            if (this.isClaudeProviderRuntimeCurrent(runtimeVersion)) {
              this.claudeProviderError = boundedClaudeProviderError(error);
              this.bumpClaudeProviderRevision();
            }
          }
        } else {
          this.claudeHookIntakeEnabled = false;
          this.claudeHookListenerInstallationId = null;
          await this.dependencies.claudeHookListener?.stop().catch(() => undefined);
        }
      } catch (error) {
        this.claudeHookIntakeEnabled = false;
        this.claudeHookListenerInstallationId = null;
        await this.dependencies.claudeHookListener?.stop().catch(() => undefined);
        if (this.isClaudeProviderRuntimeCurrent(runtimeVersion)) {
          this.claudeProviderError = boundedClaudeProviderError(error);
          this.bumpClaudeProviderRevision();
        }
      }
    }
    if (this.isClaudeProviderRuntimeCurrent(runtimeVersion)) this.notify();
  }

  private async deactivateClaudeProvider(
    runtimeVersion: number,
    initialError: string | null,
    clearOutbox: boolean,
    preemptedTeardown: Promise<PromiseSettledResult<unknown>[]> | null = null
  ): Promise<void> {
    this.claudeHookIntakeEnabled = false;
    this.claudeHookListenerInstallationId = null;
    const failures: unknown[] = [];
    const listenerResult = preemptedTeardown === null
      ? await Promise.allSettled([
          this.startClaudeProviderStop(() => this.dependencies.claudeHookListener?.stop()),
          this.startClaudeProviderStop(() => this.dependencies.claudeObservation?.stop()),
          this.joinClaudeBackgroundRefresh()
        ])
      : await preemptedTeardown;
    for (const result of listenerResult) {
      if (result.status === 'rejected') failures.push(result.reason);
    }
    try {
      await this.dependencies.repository.expireClaudeAgentStates?.({
        observedAt: this.now(),
        statusSources: ['claude_agent_view', 'claude_hook'],
        force: true
      });
    } catch (error) {
      failures.push(error);
    }
    if (clearOutbox) {
      try {
        await this.dependencies.claudeHookListener?.clearOutbox?.();
      } catch (error) {
        failures.push(error);
      }
    }
    if (!this.isClaudeProviderVersionCurrent(runtimeVersion)) return;
    this.claudeProviderProjectionEnabled = false;
    this.claudeProviderError = initialError ?? (
      failures.length > 0 ? boundedClaudeProviderError(failures[0]) : null
    );
    this.bumpClaudeProviderRevision();
    this.notify();
  }

  private isClaudeProviderVersionCurrent(runtimeVersion: number): boolean {
    return this.appRuntimeActive && this.claudeProviderRuntimeVersion === runtimeVersion;
  }

  private isAppRuntimeGenerationCurrent(generation: number): boolean {
    return this.appRuntimeActive && this.appRuntimeGeneration === generation;
  }

  private bumpClaudeProviderRevision(): void {
    this.claudeProviderRevision += 1;
  }

  private isClaudeProviderRuntimeIntentCurrent(runtimeVersion: number): boolean {
    return this.isClaudeProviderVersionCurrent(runtimeVersion) &&
      this.claudeProviderPreferenceEnabled;
  }

  private isClaudeProviderRuntimeCurrent(runtimeVersion: number): boolean {
    return this.isClaudeProviderRuntimeIntentCurrent(runtimeVersion) &&
      this.claudeProviderProjectionEnabled;
  }

  private isClaudeProviderAvailable(): boolean {
    return this.appRuntimeActive && this.claudeProviderPreferenceEnabled &&
      this.claudeProviderProjectionEnabled;
  }

  private requireClaudeProviderEnabled(): void {
    if (this.isClaudeProviderAvailable()) return;
    throw new Error(this.claudeProviderError ?? 'Claude support is paused');
  }

  private requireClaudeProviderManagementEnabled(): void {
    if (this.isClaudeProviderManagementCurrent(this.claudeProviderRuntimeVersion)) return;
    throw new Error(this.claudeProviderError ?? 'Claude support is paused');
  }

  private isClaudeProviderManagementCurrent(runtimeVersion: number): boolean {
    return this.isClaudeProviderVersionCurrent(runtimeVersion) &&
      this.claudeProviderPreferenceEnabled &&
      this.claudeProviderEnableCutoff !== CLAUDE_PROVIDER_PENDING_ADMISSION;
  }

  private async captureClaudeProviderManagementAction(): Promise<number> {
    return await this.runClaudeBridgeLifecycle(async () => {
      this.requireClaudeProviderManagementEnabled();
      return this.claudeProviderRuntimeVersion;
    });
  }

  private async reactivateClaudeProviderAfterManagement(runtimeVersion: number): Promise<void> {
    await this.runClaudeBridgeLifecycle(async () => {
      if (!this.isClaudeProviderManagementCurrent(runtimeVersion) ||
        this.claudeProviderProjectionEnabled) return;
      await this.activateClaudeProvider(runtimeVersion, false);
    });
  }

  async setClaudeProviderEnabled(
    params: { enabled: boolean }
  ): Promise<EyesOnAgentsSnapshot> {
    if (typeof params?.enabled !== 'boolean') throw new Error('enabled must be a boolean');
    const admittedAppRuntimeGeneration = this.appRuntimeGeneration;
    let runtimeVersion = this.claudeProviderRuntimeVersion;
    let preemptedTeardown: Promise<PromiseSettledResult<unknown>[]> | null = null;
    let transitionRequired = true;
    await this.runClaudeProviderIntent(async () => {
      if (!this.isAppRuntimeGenerationCurrent(admittedAppRuntimeGeneration)) {
        throw new Error('EyesOnAgents runtime is not active');
      }
      const alreadyEnabled = this.claudeProviderPreferenceEnabled &&
        this.claudeProviderEnableCutoff !== CLAUDE_PROVIDER_PENDING_ADMISSION;
      if (params.enabled && alreadyEnabled) {
        transitionRequired = false;
        return;
      }
      const cutoff = params.enabled
        ? CLAUDE_PROVIDER_PENDING_ADMISSION
        : this.claudeProviderEnableCutoff;
      await this.claudeProviderPreference.setEnabled(params.enabled, cutoff);
      if (!this.isAppRuntimeGenerationCurrent(admittedAppRuntimeGeneration)) {
        transitionRequired = false;
        return;
      }
      runtimeVersion = ++this.claudeProviderRuntimeVersion;
      this.claudeProviderPreferenceEnabled = params.enabled;
      this.claudeProviderEnableCutoff = cutoff;
      this.claudeHookIntakeEnabled = false;
      this.claudeHookListenerInstallationId = null;
      this.claudeProviderProjectionEnabled = false;
      this.claudeProviderError = null;
      this.bumpClaudeProviderRevision();
      if (params.enabled) {
        return;
      } else {
        preemptedTeardown = Promise.allSettled([
          this.startClaudeProviderStop(() => this.dependencies.claudeHookListener?.stop()),
          this.startClaudeProviderStop(() => this.dependencies.claudeObservation?.stop()),
          this.joinClaudeBackgroundRefresh()
        ]);
      }
    });
    if (!transitionRequired) return await this.getSnapshot();
    if (params.enabled) {
      await this.runClaudeBridgeLifecycle(async () => {
        await this.activateClaudeProvider(runtimeVersion, true);
      });
    } else {
      await this.runClaudeBridgeLifecycle(async () => {
        await this.deactivateClaudeProvider(runtimeVersion, null, true, preemptedTeardown);
      });
    }
    return await this.getSnapshot();
  }

  async installClaudeBridge(params?: { environmentId?: string }): Promise<EyesOnAgentsSnapshot> {
    this.requireClaudeProviderManagementEnabled();
    if (!this.dependencies.claudeBridge || !this.dependencies.claudeHookListener) {
      throw new Error('Claude observation plugin is unavailable');
    }
    const configDirectory = this.resolveClaudeBridgeConfigDirectory(params);
    await this.runClaudeBridgeLifecycle(async () => {
      this.requireClaudeProviderManagementEnabled();
      const runtimeVersion = this.claudeProviderRuntimeVersion;
      this.claudeHookIntakeEnabled = false;
      this.claudeHookListenerInstallationId = null;
      await this.dependencies.claudeHookListener?.stop();
      await this.invalidateClaudeHookActiveStates();
      if (!this.isClaudeProviderManagementCurrent(runtimeVersion)) {
        throw new Error('Claude support changed while the listener was stopping');
      }
      const status = await this.dependencies.claudeBridge?.install(configDirectory);
      if (!this.isClaudeProviderManagementCurrent(runtimeVersion)) {
        throw new Error('Claude support changed while the plugin was being installed');
      }
      if (!status?.configured || !status.enabled || status.error || status.state === 'drifted') {
        throw new Error(status?.error ?? 'Claude observation plugin is not enabled');
      }
      if (!this.claudeProviderProjectionEnabled) {
        await this.activateClaudeProvider(runtimeVersion, false);
        return;
      }
      const listenerInstallationId = this.currentClaudeBridgeInstallationId();
      this.claudeHookIntakeEnabled = true;
      try {
        await this.dependencies.claudeHookListener?.start();
        if (!this.isClaudeProviderRuntimeCurrent(runtimeVersion)) {
          throw new Error('Claude support changed while the listener was starting');
        }
        await this.dependencies.claudeHookListener?.replayOutbox();
        this.claudeHookListenerInstallationId = listenerInstallationId;
      } catch (error) {
        this.claudeHookIntakeEnabled = false;
        this.claudeHookListenerInstallationId = null;
        await this.dependencies.claudeHookListener?.stop().catch(() => undefined);
        await this.invalidateClaudeHookActiveStates().catch(() => undefined);
        throw error;
      }
    });
    // Task 090: the install just changed this environment's plugin presence, so re-probe that one
    // environment before the snapshot the renderer will read. Failures inside the probe already
    // resolve to 'unknown'; a missing dependency makes this a no-op.
    await this.dependencies.claudeObservation?.refreshPluginPresence?.(params?.environmentId);
    return await this.changedSnapshot();
  }

  async refreshClaudeBridgeStatus(
    params?: { environmentId?: string }
  ): Promise<EyesOnAgentsSnapshot> {
    this.requireClaudeProviderManagementEnabled();
    if (!this.dependencies.claudeBridge) throw new Error('Claude observation plugin is unavailable');
    const configDirectory = this.resolveClaudeBridgeConfigDirectory(params);
    await this.runClaudeBridgeLifecycle(async () => {
      this.requireClaudeProviderManagementEnabled();
      const runtimeVersion = this.claudeProviderRuntimeVersion;
      const status = await this.dependencies.claudeBridge?.refresh(configDirectory);
      if (!this.isClaudeProviderManagementCurrent(runtimeVersion)) return;
      if (!this.claudeProviderProjectionEnabled) {
        await this.activateClaudeProvider(runtimeVersion, false);
        return;
      }
      const canListen = status?.configured === true && status.enabled &&
        !status.error && status.state !== 'drifted';
      const listenerInstallationId = this.currentClaudeBridgeInstallationId();
      const listenerIdentityChanged = status?.listening === true &&
        listenerInstallationId !== null &&
        this.claudeHookListenerInstallationId !== listenerInstallationId;
      const listenerHealthy = canListen && status?.listening === true &&
        this.claudeHookIntakeEnabled && !listenerIdentityChanged;
      if (listenerHealthy) return;

      const hadListenerGeneration = status?.listening === true ||
        this.claudeHookIntakeEnabled || this.claudeHookListenerInstallationId !== null;
      this.claudeHookIntakeEnabled = false;
      this.claudeHookListenerInstallationId = null;
      if (!canListen) {
        if (hadListenerGeneration) {
          await this.dependencies.claudeHookListener?.stop().catch(() => undefined);
          await this.invalidateClaudeHookActiveStates();
        }
        return;
      }

      await this.dependencies.claudeHookListener?.stop().catch(() => undefined);
      await this.invalidateClaudeHookActiveStates();
      this.claudeHookIntakeEnabled = true;
      try {
        await this.dependencies.claudeHookListener?.start();
        if (!this.isClaudeProviderRuntimeCurrent(runtimeVersion)) {
          throw new Error('Claude support changed while the listener was starting');
        }
        await this.dependencies.claudeHookListener?.replayOutbox();
        this.claudeHookListenerInstallationId = listenerInstallationId;
      } catch {
        this.claudeHookIntakeEnabled = false;
        this.claudeHookListenerInstallationId = null;
        await this.dependencies.claudeHookListener?.stop().catch(() => undefined);
        throw new Error('Claude listener retry failed');
      }
    });
    // Task 090: an explicit Retry/Refresh on a row is also the user asking "check this environment
    // again", so re-probe presence for it.
    await this.dependencies.claudeObservation?.refreshPluginPresence?.(params?.environmentId);
    return await this.changedSnapshot();
  }

  async removeClaudeBridge(params?: { environmentId?: string }): Promise<EyesOnAgentsSnapshot> {
    this.requireClaudeProviderManagementEnabled();
    if (!this.dependencies.claudeBridge) throw new Error('Claude observation plugin is unavailable');
    const configDirectory = this.resolveClaudeBridgeConfigDirectory(params);
    await this.runClaudeBridgeLifecycle(async () => {
      this.requireClaudeProviderManagementEnabled();
      const runtimeVersion = this.claudeProviderRuntimeVersion;
      this.claudeHookIntakeEnabled = false;
      this.claudeHookListenerInstallationId = null;
      await this.dependencies.claudeHookListener?.stop();
      await this.invalidateClaudeHookActiveStates();
      if (!this.isClaudeProviderVersionCurrent(runtimeVersion) ||
        !this.claudeProviderPreferenceEnabled) return;
      await this.dependencies.claudeBridge?.remove(configDirectory);
    });
    // Task 090: removal changes this environment's presence too, so re-probe it.
    await this.dependencies.claudeObservation?.refreshPluginPresence?.(params?.environmentId);
    return await this.changedSnapshot();
  }

  async getClaudeBridgeStatus(): Promise<EyesOnAgentsClaudeBridgeStatus> {
    return await this.runClaudeBridgeLifecycle(async () => {
      this.requireClaudeProviderManagementEnabled();
      const runtimeVersion = this.claudeProviderRuntimeVersion;
      if (!this.dependencies.claudeBridge) {
        throw new Error('Claude observation plugin is unavailable');
      }
      const status = await this.readClaudeBridgeStatus();
      if (!this.isClaudeProviderManagementCurrent(runtimeVersion)) {
        throw new Error('Claude support changed while status was being inspected');
      }
      return status;
    });
  }

  // Task 088: resolves { environmentId } to a configDirectory (or undefined for the automatic
  // environment) using the injected claudeDirectoryConfig singleton. Missing dependency or an empty
  // environment list reproduces the exact pre-088 ambient behavior (undefined = no CLAUDE_CONFIG_DIR
  // override) rather than throwing, so every existing zero-arg test harness that never wires this
  // dependency keeps working unchanged. An explicitly supplied, unknown environmentId still rejects
  // cleanly (via resolveClaudeBridgeEnvironment) once the dependency is present.
  private resolveClaudeBridgeConfigDirectory(params?: { environmentId?: string }): string | undefined {
    if (!this.dependencies.claudeDirectoryConfig) return undefined;
    const environments = this.dependencies.claudeDirectoryConfig.listEnvironments();
    if (environments.length === 0) return undefined;
    return resolveClaudeBridgeEnvironment(environments, params).configDirectory ?? undefined;
  }

  private requireClaudeDirectoryConfig(): NonNullable<
    EyesOnAgentsServiceDependencies['claudeDirectoryConfig']
  > {
    if (!this.dependencies.claudeDirectoryConfig) {
      throw new Error('Claude environment configuration is unavailable');
    }
    return this.dependencies.claudeDirectoryConfig;
  }

  // Task 088: thin delegating implementations of the 7 environment-CRUD EyesOnAgentsApi members
  // task 084 left off this interface. EyesOnAgentsHandler (electron-xpc's real, reflection-registered
  // target) owns the actual XPC-callable versions of these methods against the same
  // claudeDirectoryConfig singleton — these exist only so EyesOnAgentsService satisfies
  // `implements EyesOnAgentsApi`; no renderer or XPC call path reaches them.
  async listClaudeEnvironments(): Promise<EyesOnAgentsClaudeEnvironment[]> {
    return this.requireClaudeDirectoryConfig().listEnvironments();
  }

  async addClaudeEnvironment(params: { label: string }): Promise<EyesOnAgentsClaudeEnvironment[]> {
    const directoryConfig = this.requireClaudeDirectoryConfig();
    const configDirectory = (await this.dependencies.pickClaudeConfigDirectory?.()) ?? null;
    if (configDirectory !== null) {
      await directoryConfig.addEnvironment({ label: params.label, configDirectory });
    }
    await this.dependencies.claudeObservation?.applyEnvironments?.();
    return directoryConfig.listEnvironments();
  }

  async renameClaudeEnvironment(
    params: { id: string; label: string }
  ): Promise<EyesOnAgentsClaudeEnvironment[]> {
    const directoryConfig = this.requireClaudeDirectoryConfig();
    await directoryConfig.renameEnvironment(params);
    await this.dependencies.claudeObservation?.applyEnvironments?.();
    return directoryConfig.listEnvironments();
  }

  async removeClaudeEnvironment(params: { id: string }): Promise<EyesOnAgentsClaudeEnvironment[]> {
    const directoryConfig = this.requireClaudeDirectoryConfig();
    await directoryConfig.removeEnvironment(params);
    await this.dependencies.claudeObservation?.applyEnvironments?.();
    return directoryConfig.listEnvironments();
  }

  async setClaudeEnvironmentEnabled(
    params: { id: string; enabled: boolean }
  ): Promise<EyesOnAgentsClaudeEnvironment[]> {
    const directoryConfig = this.requireClaudeDirectoryConfig();
    await directoryConfig.setEnvironmentEnabled(params);
    await this.dependencies.claudeObservation?.applyEnvironments?.();
    return directoryConfig.listEnvironments();
  }

  async chooseClaudeEnvironmentDirectory(
    params: { id: string }
  ): Promise<EyesOnAgentsClaudeEnvironment[]> {
    const directoryConfig = this.requireClaudeDirectoryConfig();
    await directoryConfig.chooseCustomDirectory(params);
    await this.dependencies.claudeObservation?.applyEnvironments?.();
    return directoryConfig.listEnvironments();
  }

  async useAutomaticClaudeEnvironment(
    params: { id: string }
  ): Promise<EyesOnAgentsClaudeEnvironment[]> {
    const directoryConfig = this.requireClaudeDirectoryConfig();
    await directoryConfig.useAutomatic(params);
    await this.dependencies.claudeObservation?.applyEnvironments?.();
    return directoryConfig.listEnvironments();
  }

  async openNewClaudeSession(): Promise<void> {
    await this.runClaudeBridgeLifecycle(async () => {
      this.requireClaudeProviderManagementEnabled();
      const runtimeVersion = this.claudeProviderRuntimeVersion;
      await this.dependencies.openExternal(CLAUDE_NEW_SESSION_URL);
      if (!this.isClaudeProviderManagementCurrent(runtimeVersion)) {
        throw new Error('Claude support changed while the new session was opening');
      }
    });
  }

  async copyClaudeReloadCommand(): Promise<void> {
    await this.runClaudeBridgeLifecycle(async () => {
      this.requireClaudeProviderManagementEnabled();
      this.dependencies.writeClipboardText(CLAUDE_RELOAD_PLUGINS_COMMAND);
    });
  }

  // Task 089: resolves the row id through the same claudeDirectoryConfig/resolveClaudeBridgeEnvironment
  // path the bridge methods use (an unknown id throws 'Claude environment was not found'), then
  // writes the shared pure builder's snippet through the injected writeClipboardText dependency —
  // the same egress Copy /reload-plugins already uses, never electron's clipboard directly.
  // Nothing here logs: the snippet and configDirectory never reach a logger, and the only failure
  // this method raises identifies the environment by label alone.
  // Task 090: re-probe ONE environment's plugin presence and nothing else. Kept separate from
  // refreshClaudeBridgeStatus on purpose — that runs a full profile-wide bridge refresh, which can
  // trigger a trusted automatic upgrade and rewrite the shared inspection state. A per-row "check
  // this directory" action must not do either; it only answers whether that directory has the
  // plugin. Resolving the id first means an unknown id rejects before anything is spawned.
  async refreshClaudeEnvironmentPluginPresence(
    params: { id: string }
  ): Promise<EyesOnAgentsSnapshot> {
    this.requireClaudeProviderManagementEnabled();
    const directoryConfig = this.requireClaudeDirectoryConfig();
    const environment = resolveClaudeBridgeEnvironment(
      directoryConfig.listEnvironments(),
      { environmentId: params.id }
    );
    await this.dependencies.claudeObservation?.refreshPluginPresence?.(environment.id);
    return await this.changedSnapshot();
  }

  async copyClaudeEnvironmentSetupCommand(params: { id: string }): Promise<void> {
    const directoryConfig = this.requireClaudeDirectoryConfig();
    const environment = resolveClaudeBridgeEnvironment(
      directoryConfig.listEnvironments(),
      { environmentId: params.id }
    );
    if (environment.mode !== 'custom' || environment.configDirectory === null) {
      throw new Error(
        `Claude environment "${environment.label}" has no configured directory to wrap`
      );
    }
    this.dependencies.writeClipboardText(buildEyesOnAgentsClaudeEnvironmentSetupCommand({
      label: environment.label,
      configDirectory: environment.configDirectory
    }));
  }

  async changeClaudeDirectory(): Promise<EyesOnAgentsSnapshot> {
    if (!this.dependencies.claudeObservation?.changeDirectory) {
      throw new Error('Claude directory observation is unavailable');
    }
    const runtimeVersion = await this.captureClaudeProviderManagementAction();
    await this.dependencies.claudeObservation.changeDirectory();
    await this.reactivateClaudeProviderAfterManagement(runtimeVersion);
    return await this.getSnapshot();
  }

  async useAutomaticClaudeDirectory(): Promise<EyesOnAgentsSnapshot> {
    if (!this.dependencies.claudeObservation?.useAutomaticDirectory) {
      throw new Error('Claude directory observation is unavailable');
    }
    const runtimeVersion = await this.captureClaudeProviderManagementAction();
    await this.dependencies.claudeObservation.useAutomaticDirectory();
    await this.reactivateClaudeProviderAfterManagement(runtimeVersion);
    return await this.getSnapshot();
  }

  // Task 088 (gap 1): resolves { environmentId } to the target environment's id, mirroring
  // resolveClaudeBridgeConfigDirectory's fallback contract (missing dependency or empty
  // environment list => undefined, letting ClaudeObservationService.retryDirectory fall back to
  // its own resolveDefaultEnvironmentId()) but resolving to an id, not a configDirectory, since the
  // watcher retry entry point (ClaudeObservationService.retryEnvironmentEntry) is keyed by id.
  private resolveClaudeDirectoryRetryEnvironmentId(
    params?: { environmentId?: string }
  ): string | undefined {
    if (!this.dependencies.claudeDirectoryConfig) return undefined;
    const environments = this.dependencies.claudeDirectoryConfig.listEnvironments();
    if (environments.length === 0) return undefined;
    return resolveClaudeBridgeEnvironment(environments, params).id;
  }

  async retryClaudeDirectory(params?: { environmentId?: string }): Promise<EyesOnAgentsSnapshot> {
    if (!this.dependencies.claudeObservation?.retryDirectory) {
      throw new Error('Claude directory observation is unavailable');
    }
    const environmentId = this.resolveClaudeDirectoryRetryEnvironmentId(params);
    const runtimeVersion = await this.captureClaudeProviderManagementAction();
    await this.dependencies.claudeObservation.retryDirectory(environmentId);
    await this.reactivateClaudeProviderAfterManagement(runtimeVersion);
    return await this.getSnapshot();
  }

  commitClaudeHookDelivery(
    value: ClaudeHookDelivery
  ): Promise<EyesOnAgentsRuntimeDeliveryResult> {
    const delivery = parseClaudeHookDelivery(value);
    const operation = this.commitClaudeHookDeliveryInternal(
      delivery,
      this.claudeLastUserPromptPreferenceEpoch
    );
    this.activeClaudeHookOperations.add(operation);
    return operation.finally(() => {
      this.activeClaudeHookOperations.delete(operation);
    });
  }

  private async commitClaudeHookDeliveryInternal(
    delivery: ClaudeHookDelivery,
    lastUserPromptPreferenceEpoch: number
  ): Promise<EyesOnAgentsRuntimeDeliveryResult> {
    if (!this.claudeHookIntakeEnabled ||
      !this.dependencies.claudeBridge?.acceptsInstallation(delivery.installationId)) {
      throw new Error('Claude hook observation is not accepting deliveries');
    }
    const runtimeVersion = this.claudeProviderRuntimeVersion;
    if (this.claudeProviderEnableCutoff !== null &&
      delivery.event.occurredAt <= this.claudeProviderEnableCutoff) {
      return { duplicate: true };
    }
    if (!this.isClaudeProviderRuntimeCurrent(runtimeVersion)) {
      throw new Error('Claude hook observation changed before delivery commit');
    }
    const { payload } = delivery.event;
    const project = projectMetadataFromResolution(resolveEyesOnAgentsProject(payload.cwd));
    const base = {
      threadId: payload.sessionId,
      turnId: payload.hookEventName === 'Stop' ? delivery.deliveryId : null,
      cwd: payload.cwd,
      ...(project === undefined ? {} : { project }),
      observedAt: delivery.event.occurredAt,
      source: 'claude_hook' as const
    };
    let event: EyesOnAgentsRuntimeEvent;
    if (payload.hookEventName === 'UserPromptSubmit') {
      event = { type: 'turn_started', ...base };
    } else if (payload.hookEventName === 'PermissionRequest') {
      event = {
        type: 'thread_status', ...base,
        runtimeState: 'waiting_approval', activeFlags: ['waitingOnApproval']
      };
    } else if (payload.hookEventName === 'Stop') {
      event = { type: 'turn_completed', ...base, outcome: 'completed' };
    } else if (payload.hookEventName === 'StopFailure') {
      event = { type: 'turn_completed', ...base, outcome: 'failed' };
    } else {
      event = {
        type: 'thread_status', ...base,
        runtimeState: payload.hookEventName === 'SessionEnd' ? 'ended' : 'unknown',
        activeFlags: []
      };
    }
    if (payload.transcriptPath && this.dependencies.validateClaudeTranscript) {
      try {
        const transcriptPath = this.dependencies.validateClaudeTranscript(
          payload.transcriptPath,
          payload.sessionId
        );
        const iterm2SessionId = (delivery.event.schemaVersion === 3 ||
          delivery.event.schemaVersion === 4) &&
          delivery.event.payload.terminalApp === 'iterm2'
          ? delivery.event.payload.terminalSessionId
          : null;
        const claudeConfigDir = delivery.event.schemaVersion === 4
          ? delivery.event.payload.claudeConfigDir ?? null
          : null;
        if (payload.hookEventName === 'SessionStart') {
          console.info(
            `[claude-hook] event=SessionStart environmentAttribution=${claudeConfigDir !== null}`
          );
        }
        await this.dependencies.repository.upsertClaudeInventory({
          threads: [{
            threadId: payload.sessionId,
            desktopSessionId: null,
            iterm2SessionId,
            claudeConfigDir,
            transcriptPath,
            title: null,
            cwd: payload.cwd,
            archiveState: 'unknown',
            transcriptActivityAt: null,
            lastActivityAt: delivery.event.occurredAt,
            observedAt: delivery.event.occurredAt
          }]
        });
      } catch {
        // A path mismatch cannot reject otherwise valid content-free lifecycle evidence.
      }
    }
    if (!this.isClaudeProviderRuntimeCurrent(runtimeVersion)) {
      throw new Error('Claude hook observation changed before runtime persistence');
    }
    const hookLastUserPrompt = this.claudeHookLastUserPromptCandidate(
      delivery,
      lastUserPromptPreferenceEpoch
    );
    const persistence = await this.dependencies.repository.applyRuntimeEventDelivery({
      deliveryId: delivery.deliveryId,
      event,
      replayAuthority: 'current_listener',
      ...(hookLastUserPrompt === undefined ? {} : { hookLastUserPrompt })
    });
    if (this.isClaudeProviderRuntimeCurrent(runtimeVersion)) {
      if (persistence.completionAlert) this.notifyThreadCompleted(persistence.completionAlert);
      if (!persistence.duplicate) this.notify();
    }
    return { duplicate: persistence.duplicate };
  }

  canArmClaudeHookListener(): boolean {
    return this.isClaudeProviderAvailable() && this.claudeHookIntakeEnabled;
  }

  async reportClaudeHookCoverageGap(gap?: ClaudeHookOutboxCoverageGap): Promise<void> {
    if (!this.isClaudeProviderAvailable() || !this.claudeHookIntakeEnabled) return;
    if (gap && this.claudeProviderEnableCutoff !== null &&
      gap.lastDetectedAt <= this.claudeProviderEnableCutoff) return;
    const runtimeVersion = this.claudeProviderRuntimeVersion;
    this.claudeHookIntakeEnabled = false;
    this.dependencies.claudeBridge?.revokeObservationProof('coverage_gap');
    const result = await this.dependencies.repository.expireClaudeAgentStates({
      observedAt: this.now(),
      statusSources: ['claude_hook'],
      force: true
    });
    if (this.isClaudeProviderRuntimeCurrent(runtimeVersion) && result.changed) this.notify();
  }

  private runClaudeBridgeLifecycle<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.claudeBridgeLifecycleTail.then(operation, operation);
    this.claudeBridgeLifecycleTail = result.then(() => undefined, () => undefined);
    return result;
  }

  private runClaudeProviderIntent<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.claudeProviderIntentTail.then(operation, operation);
    this.claudeProviderIntentTail = result.then(() => undefined, () => undefined);
    return result;
  }

  private startClaudeProviderStop(operation: () => Promise<void> | undefined): Promise<void> {
    try {
      return operation() ?? Promise.resolve();
    } catch (error) {
      return Promise.reject(error);
    }
  }

  private async invalidateClaudeHookActiveStates(): Promise<void> {
    await this.dependencies.repository.expireClaudeAgentStates?.({
      observedAt: this.now(),
      statusSources: ['claude_hook'],
      force: true
    });
  }

  private currentClaudeBridgeInstallationId(): string | null {
    try {
      return this.dependencies.claudeBridge?.getInstallationId?.() ?? null;
    } catch {
      return null;
    }
  }

  private async readClaudeBridgeStatus(): Promise<EyesOnAgentsClaudeBridgeStatus> {
    const status = this.currentClaudeBridgeStatus();
    try {
      const receipts = await this.dependencies.repository.getRuntimeReceiptSummary({
        provider: 'claude'
      });
      return {
        ...status,
        firstReceiptAt: receipts.firstReceivedAt === null
          ? null : new Date(receipts.firstReceivedAt).toISOString(),
        lastReceiptAt: receipts.lastReceivedAt === null
          ? null : new Date(receipts.lastReceivedAt).toISOString()
      };
    } catch {
      return status;
    }
  }

  private currentClaudeBridgeStatus(): EyesOnAgentsClaudeBridgeStatus {
    return this.dependencies.claudeBridge?.getStatus() ?? {
      state: 'not_installed' as const,
      setupAction: 'enable' as const,
      configured: false,
      enabled: false,
      listening: false,
      listeningSince: null,
      firstReceiptAt: null,
      lastReceiptAt: null,
      lastInspectedAt: null,
      observationProof: 'none' as const,
      restartRequired: false,
      error: null
    };
  }

  async setLastUserPromptCaptureEnabled(
    params: { enabled: boolean }
  ): Promise<EyesOnAgentsSnapshot> {
    if (typeof params?.enabled !== 'boolean') {
      throw new Error('enabled must be a boolean');
    }
    if (params.enabled) {
      const preferenceChanged = this.lastUserPromptPreference.enable();
      if (preferenceChanged) {
        this.lastUserPromptPreferenceEpoch += 1;
      }
      let snapshot: EyesOnAgentsSnapshot;
      try {
        snapshot = await this.getSnapshot();
      } catch (error) {
        if (preferenceChanged) {
          try {
            this.lastUserPromptPreference.disable();
          } catch {
            // Best-effort rollback must preserve the original snapshot error.
          }
          this.lastUserPromptPreferenceEpoch += 1;
        }
        throw error;
      }
      if (preferenceChanged) this.notify();
      return snapshot;
    }

    const wasEnabled = this.lastUserPromptPreference.isEnabled();
    this.lastUserPromptPreferenceEpoch += 1;
    const preferenceChanged = this.lastUserPromptPreference.disable();
    const inFlightPromptWrites: Promise<unknown>[] = [];
    if (this.backgroundRefreshPromise) {
      inFlightPromptWrites.push(this.backgroundRefreshPromise);
    }
    if (this.observationContext) {
      inFlightPromptWrites.push(this.observationContext.hookWriteTail);
    }
    await Promise.allSettled(inFlightPromptWrites);
    let cleared: EyesOnAgentsRepositoryMutationResult;
    try {
      cleared = await this.dependencies.repository.clearLastUserPrompts({ providers: ['codex'] });
    } catch (error) {
      if (wasEnabled) {
        try {
          this.lastUserPromptPreference.enable();
        } catch {
          // Best-effort rollback must preserve the original clear error.
        }
        this.lastUserPromptPreferenceEpoch += 1;
      }
      throw error;
    }
    const snapshot = await this.getSnapshot();
    if (preferenceChanged || cleared.changed) this.notify();
    return snapshot;
  }

  async setClaudeLastUserPromptCaptureEnabled(
    params: { enabled: boolean }
  ): Promise<EyesOnAgentsSnapshot> {
    if (typeof params?.enabled !== 'boolean') {
      throw new Error('enabled must be a boolean');
    }
    if (!this.isClaudeProviderAvailable()) {
      throw new Error('Claude support is disabled');
    }
    if (params.enabled) {
      const preferenceChanged = this.claudeLastUserPromptPreference.enable();
      if (preferenceChanged) this.claudeLastUserPromptPreferenceEpoch += 1;
      let snapshot: EyesOnAgentsSnapshot;
      try {
        snapshot = await this.getSnapshot();
      } catch (error) {
        if (preferenceChanged) {
          try {
            this.claudeLastUserPromptPreference.disable();
          } catch {
            // Best-effort rollback must preserve the original snapshot error.
          }
          this.claudeLastUserPromptPreferenceEpoch += 1;
        }
        throw error;
      }
      if (preferenceChanged) this.notify();
      return snapshot;
    }

    const wasEnabled = this.claudeLastUserPromptPreference.isEnabled();
    this.claudeLastUserPromptPreferenceEpoch += 1;
    const preferenceChanged = this.claudeLastUserPromptPreference.disable();
    await Promise.allSettled([...this.activeClaudeHookOperations]);
    let cleared: EyesOnAgentsRepositoryMutationResult;
    try {
      cleared = await this.dependencies.repository.clearLastUserPrompts({ providers: ['claude'] });
    } catch (error) {
      if (wasEnabled) {
        try {
          this.claudeLastUserPromptPreference.enable();
        } catch {
          // Best-effort rollback must preserve the original clear error.
        }
        this.claudeLastUserPromptPreferenceEpoch += 1;
      }
      throw error;
    }
    const snapshot = await this.getSnapshot();
    if (preferenceChanged || cleared.changed) this.notify();
    return snapshot;
  }

  async reportCodexHookCoverageGap(gap: CodexHookOutboxCoverageGap): Promise<void> {
    this.hookCoverageGapGeneration += 1;
    this.pendingHookCoverageGap = {
      generation: this.hookCoverageGapGeneration,
      gap: {
        schemaVersion: gap.schemaVersion,
        reasons: [...gap.reasons],
        firstDetectedAt: gap.firstDetectedAt,
        lastDetectedAt: gap.lastDetectedAt,
        occurrences: gap.occurrences
      }
    };
    this.dependencies.desktopBridge.setOperationalError(
      new Error('Codex hook delivery coverage is incomplete')
    );
    const lifetime = this.currentHookListenerLifetime();
    if (lifetime) this.rejectHookListenerLifetime(lifetime);
    const context = this.observationContext;
    if (context && this.isObservationActive(context)) {
      await Promise.allSettled([context.hookWriteTail]);
    }
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
      this.foregroundAppServerOperationPending += 1;
      try {
        await this.joinBackgroundRefresh();
        if (!this.isAppServerActive(context)) return;
        await this.performSync(context);
      } finally {
        this.foregroundAppServerOperationPending -= 1;
      }
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
    const persistence = await this.dependencies.repository.applyRuntimeEvent({ event });
    if (persistence?.completionAlert) {
      this.notifyThreadCompleted(persistence.completionAlert);
    }
    if (this.isAppServerActive(context)) {
      this.notify();
      if (persistence?.titleMissing === true) {
        this.scheduleMissingThreadTitleEnrichment(threadId);
      }
    }
  }

  async applyCodexHookEvent(event: CodexHookEvent): Promise<void> {
    const context = this.observationContext;
    if (!context || !this.isObservationActive(context)) return;
    const operation = this.performApplyCodexHookEvent(context, {
      event,
      deliveryId: null,
      completion: null,
      lastUserPromptPreferenceEpoch: this.lastUserPromptPreferenceEpoch
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
      },
      lastUserPromptPreferenceEpoch: this.lastUserPromptPreferenceEpoch
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
        return await this.performPersistCodexHookEvent(admission, context);
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
    admission: PendingCodexHookEvent,
    context: ObservationContext
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
    const hookLastUserPrompt = this.hookLastUserPromptCandidate(admission);
    if (admission.deliveryId === null) {
      const persistence = await this.dependencies.repository.applyRuntimeEvent({
        event: runtimeEvent,
        ...(hookLastUserPrompt === undefined ? {} : { hookLastUserPrompt })
      });
      if (persistence?.completionAlert) {
        this.notifyThreadCompleted(persistence.completionAlert);
      }
      if (this.isObservationActive(context)) {
        this.notify();
        if (persistence?.titleMissing === true) {
          this.scheduleMissingThreadTitleEnrichment(runtimeEvent.threadId);
        }
      }
      return undefined;
    }
    const persistence = await this.dependencies.repository.applyRuntimeEventDelivery({
      deliveryId: admission.deliveryId,
      event: runtimeEvent,
      replayAuthority: 'current_listener',
      ...(hookLastUserPrompt === undefined ? {} : { hookLastUserPrompt })
    });
    if (persistence?.completionAlert) {
      this.notifyThreadCompleted(persistence.completionAlert);
    }
    if (this.isObservationActive(context)) {
      this.notify();
      if (!persistence.duplicate && persistence.titleMissing) {
        this.scheduleMissingThreadTitleEnrichment(runtimeEvent.threadId);
      }
    }
    return { duplicate: persistence.duplicate };
  }

  private hookLastUserPromptCandidate(
    admission: PendingCodexHookEvent
  ): EyesOnAgentsHookLastUserPromptCandidate | undefined {
    const { event } = admission;
    if (event.payload.hookEventName !== 'UserPromptSubmit') return undefined;
    if (
      admission.lastUserPromptPreferenceEpoch !== this.lastUserPromptPreferenceEpoch
    ) {
      return undefined;
    }
    try {
      if (!this.lastUserPromptPreference.isEnabled()) return undefined;
    } catch {
      return undefined;
    }
    if (
      event.schemaVersion === 2 &&
      event.payload.userPromptPreview !== undefined
    ) {
      return {
        preview: event.payload.userPromptPreview,
        truncated: event.payload.userPromptTruncated
      };
    }
    return { preview: null, truncated: false };
  }

  private claudeHookLastUserPromptCandidate(
    delivery: ClaudeHookDelivery,
    admissionEpoch: number
  ): EyesOnAgentsHookLastUserPromptCandidate | undefined {
    const { event } = delivery;
    if (event.payload.hookEventName !== 'UserPromptSubmit') return undefined;
    if (admissionEpoch !== this.claudeLastUserPromptPreferenceEpoch) return undefined;
    try {
      if (!this.claudeLastUserPromptPreference.isEnabled()) return undefined;
    } catch {
      return undefined;
    }
    if (
      event.schemaVersion === 2 &&
      event.payload.userPromptPreview !== undefined
    ) {
      return {
        preview: event.payload.userPromptPreview,
        truncated: event.payload.userPromptTruncated
      };
    }
    return { preview: null, truncated: false };
  }

  private notify(): void {
    this.dependencies.broadcastChanged?.();
  }

  private notifyThreadCompleted(intent: EyesOnAgentsCompletionAlertIntent): void {
    if (intent.provider === 'claude' && !this.isClaudeProviderAvailable()) return;
    try {
      const operation = this.dependencies.notifyThreadCompleted?.(intent);
      if (operation) {
        void Promise.resolve(operation).catch((error: unknown) => {
          console.error('[EyesOnAgentsService] Thread completion alert failed', error);
        });
      }
    } catch (error) {
      console.error('[EyesOnAgentsService] Thread completion alert failed', error);
    }
  }
}
