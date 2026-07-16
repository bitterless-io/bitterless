import type {
  EyesOnAgentsBridgeState,
  EyesOnAgentsDiscoveredThread,
  EyesOnAgentsRuntimeEvent,
  EyesOnAgentsRuntimeState
} from './eyesOnAgents.type';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTROL_CHARACTER_PATTERN = /[\0\r\n]/;
const RUNTIME_STATES = new Set<EyesOnAgentsRuntimeState>([
  'working',
  'waiting_approval',
  'waiting_input',
  'idle',
  'failed',
  'ended',
  'unknown'
]);
const ACTIVE_FLAGS = new Set(['waitingOnApproval', 'waitingOnUserInput']);
const ACTIVE_STATES = new Set<EyesOnAgentsRuntimeState>([
  'working',
  'waiting_approval',
  'waiting_input'
]);

export const isEyesOnAgentsRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const assertOnlyKeys = (
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string
): void => {
  const allowedKeys = new Set(allowed);
  const unexpected = Object.keys(value).filter((key) => !allowedKeys.has(key));
  if (unexpected.length > 0) {
    throw new Error(`${label} contains unsupported field(s): ${unexpected.join(', ')}`);
  }
};

const parsePositiveId = (value: unknown, label: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value as number;
};

export const parseEyesOnAgentsUuid = (value: unknown, label = 'threadId'): string => {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new Error(`${label} must be a UUID`);
  }
  return value.toLowerCase();
};

export const parseEyesOnAgentsText = (
  value: unknown,
  label: string,
  maxLength: number,
  nullable = true
): string | null => {
  if (value === undefined || value === null) {
    if (nullable) return null;
    throw new Error(`${label} is required`);
  }
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  const normalized = value.trim();
  if (!normalized) {
    if (nullable) return null;
    throw new Error(`${label} is required`);
  }
  if (normalized.length > maxLength) {
    throw new Error(`${label} must be at most ${maxLength} characters`);
  }
  if (CONTROL_CHARACTER_PATTERN.test(normalized)) {
    throw new Error(`${label} contains a forbidden control character`);
  }
  return normalized;
};

export const parseEyesOnAgentsPath = (value: unknown): string | null => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value !== value.trim() || value.length > 4096) {
    throw new Error('cwd is invalid');
  }
  if (CONTROL_CHARACTER_PATTERN.test(value)) throw new Error('cwd is invalid');
  return value;
};

export const parseEyesOnAgentsTimestamp = (
  value: unknown,
  label: string,
  nullable = true
): number | null => {
  if (value === undefined || value === null) {
    if (nullable) return null;
    throw new Error(`${label} is required`);
  }
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value as number;
};

export const parseEyesOnAgentsRuntimeState = (value: unknown): EyesOnAgentsRuntimeState => {
  if (typeof value !== 'string' || !RUNTIME_STATES.has(value as EyesOnAgentsRuntimeState)) {
    throw new Error('runtimeState is unsupported');
  }
  return value as EyesOnAgentsRuntimeState;
};

export const parseEyesOnAgentsActiveFlags = (value: unknown): string[] => {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error('activeFlags must be a string array');
  }
  const unique = [...new Set(value)];
  if (!unique.every((item) => ACTIVE_FLAGS.has(item))) {
    throw new Error('activeFlags contains an unsupported flag');
  }
  return unique;
};

export const normalizeEyesOnAgentsThreadStatus = (
  value: unknown
): Pick<EyesOnAgentsDiscoveredThread, 'runtimeState' | 'activeFlags' | 'statusSource'> => {
  if (!isEyesOnAgentsRecord(value) || typeof value.type !== 'string') {
    return { runtimeState: 'unknown', activeFlags: [], statusSource: 'discovery' };
  }
  if (value.type === 'notLoaded') {
    return { runtimeState: 'unknown', activeFlags: [], statusSource: 'discovery' };
  }
  if (value.type === 'idle') {
    return { runtimeState: 'idle', activeFlags: [], statusSource: 'app_server' };
  }
  if (value.type === 'systemError') {
    return { runtimeState: 'failed', activeFlags: [], statusSource: 'app_server' };
  }
  if (value.type !== 'active') {
    return { runtimeState: 'unknown', activeFlags: [], statusSource: 'discovery' };
  }
  try {
    const activeFlags = parseEyesOnAgentsActiveFlags(value.activeFlags);
    const runtimeState = activeFlags.includes('waitingOnApproval')
      ? 'waiting_approval'
      : activeFlags.includes('waitingOnUserInput')
        ? 'waiting_input'
        : 'working';
    return { runtimeState, activeFlags, statusSource: 'app_server' };
  } catch {
    return { runtimeState: 'unknown', activeFlags: [], statusSource: 'discovery' };
  }
};

export const isEyesOnAgentsUnread = (value: {
  lastCompletedTurnId: string | null;
  lastCompletedAt: number | null;
  lastOpenedTurnId: string | null;
  lastOpenedAt: number | null;
}): boolean => {
  if (value.lastCompletedAt === null) return false;
  if (value.lastCompletedTurnId !== null && value.lastOpenedTurnId !== null) {
    return value.lastCompletedTurnId !== value.lastOpenedTurnId;
  }
  return value.lastOpenedAt === null || value.lastCompletedAt > value.lastOpenedAt;
};

export const isEyesOnAgentsFocused = (
  runtimeState: EyesOnAgentsRuntimeState,
  isUnread: boolean
): boolean => ACTIVE_STATES.has(runtimeState) || isUnread;

export const effectiveEyesOnAgentsRuntimeState = (
  params: {
    runtimeState: EyesOnAgentsRuntimeState;
    statusSource: 'app_server' | 'codex_hook' | 'discovery';
    statusObservedAt: number | null;
    managedServerConnected: boolean;
    hookBridgeState: EyesOnAgentsBridgeState;
    hookBridgeListening: boolean;
    hookBridgeListeningSince: number | null;
  }
): EyesOnAgentsRuntimeState => {
  const {
    runtimeState,
    statusSource,
    statusObservedAt,
    managedServerConnected,
    hookBridgeState,
    hookBridgeListening,
    hookBridgeListeningSince
  } = params;
  if (!ACTIVE_STATES.has(runtimeState)) return runtimeState;
  if (statusObservedAt === null) return 'unknown';
  if (statusSource === 'app_server') return managedServerConnected ? runtimeState : 'unknown';
  if (
    statusSource === 'codex_hook' &&
    hookBridgeState === 'installed' &&
    hookBridgeListening &&
    hookBridgeListeningSince !== null &&
    statusObservedAt >= hookBridgeListeningSince
  ) {
    return runtimeState;
  }
  return 'unknown';
};

export const buildEyesOnAgentsDeepLink = (threadId: unknown): string => {
  return `codex://threads/${parseEyesOnAgentsUuid(threadId)}`;
};

export const parseEyesOnAgentsThreadIdParams = (
  value: unknown
): { threadId: string } => {
  if (!isEyesOnAgentsRecord(value)) throw new Error('thread params must be an object');
  assertOnlyKeys(value, ['threadId'], 'thread params');
  return { threadId: parseEyesOnAgentsUuid(value.threadId) };
};

export const parseEyesOnAgentsCreateDomainParams = (
  value: unknown
): { title: string } => {
  if (!isEyesOnAgentsRecord(value)) throw new Error('Domain params must be an object');
  assertOnlyKeys(value, ['title'], 'Domain params');
  return {
    title: parseEyesOnAgentsText(value.title, 'Domain title', 80, false) as string
  };
};

export const parseEyesOnAgentsDomainParams = (
  value: unknown
): { domainId: number } => {
  if (!isEyesOnAgentsRecord(value)) throw new Error('Domain params must be an object');
  assertOnlyKeys(value, ['domainId'], 'Domain params');
  return { domainId: parsePositiveId(value.domainId, 'domainId') };
};

export const parseEyesOnAgentsRenameDomainParams = (
  value: unknown
): { domainId: number; title: string } => {
  if (!isEyesOnAgentsRecord(value)) throw new Error('Domain params must be an object');
  assertOnlyKeys(value, ['domainId', 'title'], 'Domain params');
  return {
    domainId: parsePositiveId(value.domainId, 'domainId'),
    title: parseEyesOnAgentsText(value.title, 'Domain title', 80, false) as string
  };
};

export const parseEyesOnAgentsReorderDomainsParams = (
  value: unknown
): { domainIds: number[] } => {
  if (!isEyesOnAgentsRecord(value)) throw new Error('Domain order params must be an object');
  assertOnlyKeys(value, ['domainIds'], 'Domain order params');
  if (!Array.isArray(value.domainIds) || value.domainIds.length > 100) {
    throw new Error('domainIds must be an array with at most 100 entries');
  }
  return {
    domainIds: value.domainIds.map((id) => parsePositiveId(id, 'domainId'))
  };
};

export const parseEyesOnAgentsMoveThreadParams = (
  value: unknown
): { threadId: string; domainId: number } => {
  if (!isEyesOnAgentsRecord(value)) throw new Error('move params must be an object');
  assertOnlyKeys(value, ['threadId', 'domainId'], 'move params');
  return {
    threadId: parseEyesOnAgentsUuid(value.threadId),
    domainId: parsePositiveId(value.domainId, 'domainId')
  };
};

export const parseEyesOnAgentsRuntimeEvent = (
  event: EyesOnAgentsRuntimeEvent
): EyesOnAgentsRuntimeEvent => {
  const threadId = parseEyesOnAgentsUuid(event.threadId);
  const observedAt = parseEyesOnAgentsTimestamp(event.observedAt, 'observedAt', false) as number;
  const cwd = event.cwd === undefined ? undefined : parseEyesOnAgentsPath(event.cwd);
  const turnId = event.turnId === undefined
    ? undefined
    : parseEyesOnAgentsText(event.turnId, 'turnId', 200);
  if (event.source !== 'app_server' && event.source !== 'codex_hook') {
    throw new Error('runtime event source is unsupported');
  }
  if (event.type === 'thread_status') {
    return {
      ...event,
      threadId,
      runtimeState: parseEyesOnAgentsRuntimeState(event.runtimeState),
      activeFlags: parseEyesOnAgentsActiveFlags(event.activeFlags),
      observedAt,
      cwd,
      turnId
    };
  }
  if (event.type === 'turn_completed') {
    if (!['completed', 'failed', 'interrupted'].includes(event.outcome)) {
      throw new Error('turn outcome is unsupported');
    }
    return { ...event, threadId, observedAt, cwd, turnId: turnId ?? null };
  }
  if (event.type === 'turn_started') {
    return { ...event, threadId, observedAt, cwd, turnId: turnId ?? null };
  }
  throw new Error('runtime event type is unsupported');
};
