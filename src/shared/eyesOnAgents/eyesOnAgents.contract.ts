import type {
  EyesOnAgentsBridgeState,
  EyesOnAgentsDesktopSessionId,
  EyesOnAgentsProvider,
  EyesOnAgentsSessionKey,
  EyesOnAgentsDiscoveredThread,
  EyesOnAgentsThreadRefreshPatch,
  EyesOnAgentsHookLastUserPromptCandidate,
  EyesOnAgentsProjectMetadata,
  EyesOnAgentsRuntimeEvent,
  EyesOnAgentsRuntimeState,
  EyesOnAgentsStatusSource
} from './eyesOnAgents.type';
// Reuse task 081's ITERM_SESSION_ID shape validator instead of redefining the pattern a
// third time (see the matching comment in claudeHookBridge.contract.ts).
import { CLAUDE_HOOK_ITERM2_SESSION_ID_PATTERN } from './claudeHookBridge.contract';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CLAUDE_DESKTOP_SESSION_ID_PATTERN = /^local_([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const CONTROL_CHARACTER_PATTERN = /[\0\r\n]/;
const NUL_CHARACTER_PATTERN = /\0/;
const MAX_LAST_USER_PROMPT_BYTES = 8_192;
const MAX_THREAD_TITLE_LENGTH = 300;
const UTF8_ENCODER = new TextEncoder();
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
const TERMINAL_STATES = new Set<EyesOnAgentsRuntimeState>([
  'idle',
  'failed',
  'ended'
]);
const PROVIDERS = new Set<EyesOnAgentsProvider>(['codex', 'claude']);

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

export const isEyesOnAgentsRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const hasOwn = (value: Record<string, unknown>, key: string): boolean => {
  return Object.prototype.hasOwnProperty.call(value, key);
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

export const parseEyesOnAgentsProvider = (value: unknown): EyesOnAgentsProvider => {
  if (typeof value !== 'string' || !PROVIDERS.has(value as EyesOnAgentsProvider)) {
    throw new Error('provider is unsupported');
  }
  return value as EyesOnAgentsProvider;
};

export const parseEyesOnAgentsDesktopSessionId = (
  value: unknown
): EyesOnAgentsDesktopSessionId | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new Error('desktopSessionId must be a string');
  const match = CLAUDE_DESKTOP_SESSION_ID_PATTERN.exec(value);
  if (!match) throw new Error('desktopSessionId must be a local Claude Desktop session ID');
  return `local_${parseEyesOnAgentsUuid(match[1], 'desktopSessionId')}`;
};

export const parseEyesOnAgentsIterm2SessionId = (
  value: unknown
): string | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new Error('iterm2SessionId must be a string');
  if (!CLAUDE_HOOK_ITERM2_SESSION_ID_PATTERN.test(value)) {
    throw new Error('iterm2SessionId must be a valid ITERM_SESSION_ID value');
  }
  return value;
};

export const buildEyesOnAgentsSessionKey = (
  provider: EyesOnAgentsProvider,
  threadId: unknown
): EyesOnAgentsSessionKey => {
  return `${parseEyesOnAgentsProvider(provider)}:${parseEyesOnAgentsUuid(threadId)}`;
};

export const parseEyesOnAgentsSessionKey = (value: unknown): EyesOnAgentsSessionKey => {
  if (typeof value !== 'string') throw new Error('sessionKey must be a string');
  const separator = value.indexOf(':');
  if (separator < 1 || value.indexOf(':', separator + 1) !== -1) {
    throw new Error('sessionKey is invalid');
  }
  const provider = parseEyesOnAgentsProvider(value.slice(0, separator));
  const threadId = parseEyesOnAgentsUuid(value.slice(separator + 1));
  const normalized = buildEyesOnAgentsSessionKey(provider, threadId);
  if (value !== normalized) throw new Error('sessionKey must be normalized');
  return normalized;
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

const providerThreadName = (value: unknown): string | null => {
  try {
    const name = parseEyesOnAgentsText(
      value,
      'thread name',
      MAX_THREAD_TITLE_LENGTH
    );
    if (name === null || hasUnpairedSurrogate(name)) return null;
    return name;
  } catch {
    return null;
  }
};

const providerThreadPreview = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  if (NUL_CHARACTER_PATTERN.test(value) || hasUnpairedSurrogate(value)) return null;
  const folded = value.replace(/\s+/gu, ' ').trim();
  if (!folded) return null;
  if (folded.length <= MAX_THREAD_TITLE_LENGTH) return folded;
  let end = MAX_THREAD_TITLE_LENGTH;
  const lastCodeUnit = folded.charCodeAt(end - 1);
  if (lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff) end -= 1;
  return folded.slice(0, end).trimEnd() || null;
};

export const normalizeEyesOnAgentsProviderThreadTitle = (
  value: unknown
): string | null => {
  if (!isEyesOnAgentsRecord(value)) return null;
  let name: unknown;
  try {
    name = value.name;
  } catch {
    name = null;
  }
  const normalizedName = providerThreadName(name);
  if (normalizedName !== null) return normalizedName;
  let preview: unknown;
  try {
    preview = value.preview;
  } catch {
    return null;
  }
  return providerThreadPreview(preview);
};

export const parseEyesOnAgentsLastUserPromptPreview = (value: unknown): string | null => {
  if (value === null) return null;
  if (typeof value !== 'string') throw new Error('last user prompt preview must be a string or null');
  if (!value.trim()) return null;
  if (NUL_CHARACTER_PATTERN.test(value) || hasUnpairedSurrogate(value)) {
    throw new Error('last user prompt preview contains a forbidden character');
  }
  if (UTF8_ENCODER.encode(value).byteLength > MAX_LAST_USER_PROMPT_BYTES) {
    throw new Error(`last user prompt preview must be at most ${MAX_LAST_USER_PROMPT_BYTES} UTF-8 bytes`);
  }
  return value;
};

export const parseEyesOnAgentsHookLastUserPromptCandidate = (
  value: unknown
): EyesOnAgentsHookLastUserPromptCandidate => {
  if (!isEyesOnAgentsRecord(value)) {
    throw new Error('hook last user prompt candidate must be an object');
  }
  assertOnlyKeys(value, ['preview', 'truncated'], 'hook last user prompt candidate');
  if (!hasOwn(value, 'preview') || value.preview === undefined) {
    throw new Error('hook last user prompt preview is required');
  }
  if (typeof value.truncated !== 'boolean') {
    throw new Error('hook last user prompt truncated must be a boolean');
  }
  const preview = parseEyesOnAgentsLastUserPromptPreview(value.preview);
  if (preview === null && value.truncated) {
    throw new Error('a missing hook last user prompt preview cannot be truncated');
  }
  return { preview, truncated: value.truncated };
};

export const parseEyesOnAgentsPath = (value: unknown): string | null => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value !== value.trim() || value.length > 4096) {
    throw new Error('cwd is invalid');
  }
  if (CONTROL_CHARACTER_PATTERN.test(value)) throw new Error('cwd is invalid');
  return value;
};

export const parseEyesOnAgentsProjectMetadata = (
  value: unknown
): EyesOnAgentsProjectMetadata | null => {
  if (value === null) return null;
  if (!isEyesOnAgentsRecord(value)) throw new Error('project metadata must be an object or null');
  assertOnlyKeys(value, ['projectKey', 'projectRoot', 'projectName'], 'project metadata');
  return {
    projectKey: parseEyesOnAgentsText(value.projectKey, 'projectKey', 4096, false) as string,
    projectRoot: parseEyesOnAgentsText(value.projectRoot, 'projectRoot', 4096, false) as string,
    projectName: parseEyesOnAgentsText(value.projectName, 'projectName', 300, false) as string
  };
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

export const isEyesOnAgentsTerminal = (
  runtimeState: EyesOnAgentsRuntimeState
): boolean => TERMINAL_STATES.has(runtimeState);

export const isEyesOnAgentsFocused = (
  runtimeState: EyesOnAgentsRuntimeState,
  isUnread: boolean
): boolean => isUnread || ACTIVE_STATES.has(runtimeState);

export const effectiveEyesOnAgentsRuntimeState = (
  params: {
    runtimeState: EyesOnAgentsRuntimeState;
    statusSource: EyesOnAgentsStatusSource;
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
  if (statusSource === 'app_server' || statusSource === 'app_server_turn') {
    return managedServerConnected ? runtimeState : 'unknown';
  }
  if (statusSource === 'claude_agent_view') return runtimeState;
  if (
    statusSource === 'codex_hook' &&
    hookBridgeState === 'installed' &&
    hookBridgeListening &&
    hookBridgeListeningSince !== null
  ) {
    return runtimeState;
  }
  return 'unknown';
};

export const buildEyesOnAgentsDeepLink = (threadId: unknown): string => {
  return `codex://threads/${parseEyesOnAgentsUuid(threadId)}`;
};

export const buildEyesOnAgentsClaudeDesktopDeepLink = (
  desktopSessionId: unknown
): string => {
  const parsed = parseEyesOnAgentsDesktopSessionId(desktopSessionId);
  if (parsed === null) throw new Error('Claude Desktop session ID is required');
  return `claude://claude.ai/epitaxy/${parsed}`;
};

export const buildEyesOnAgentsIterm2DeepLink = (
  iterm2SessionId: unknown
): string => {
  const parsed = parseEyesOnAgentsIterm2SessionId(iterm2SessionId);
  if (parsed === null) throw new Error('iTerm2 session ID is required');
  return `iterm2:///reveal?sessionid=${encodeURIComponent(parsed)}`;
};

export const parseEyesOnAgentsSessionKeyParams = (
  value: unknown
): { sessionKey: EyesOnAgentsSessionKey } => {
  if (!isEyesOnAgentsRecord(value)) throw new Error('session params must be an object');
  assertOnlyKeys(value, ['sessionKey'], 'session params');
  return { sessionKey: parseEyesOnAgentsSessionKey(value.sessionKey) };
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
): { sessionKey: EyesOnAgentsSessionKey; domainId: number } => {
  if (!isEyesOnAgentsRecord(value)) throw new Error('move params must be an object');
  assertOnlyKeys(value, ['sessionKey', 'domainId'], 'move params');
  return {
    sessionKey: parseEyesOnAgentsSessionKey(value.sessionKey),
    domainId: parsePositiveId(value.domainId, 'domainId')
  };
};

export const parseEyesOnAgentsSetThreadUnreadParams = (
  value: unknown
): { sessionKey: EyesOnAgentsSessionKey; isUnread: boolean } => {
  if (!isEyesOnAgentsRecord(value)) throw new Error('read state params must be an object');
  assertOnlyKeys(value, ['sessionKey', 'isUnread'], 'read state params');
  if (typeof value.isUnread !== 'boolean') throw new Error('isUnread must be a boolean');
  return {
    sessionKey: parseEyesOnAgentsSessionKey(value.sessionKey),
    isUnread: value.isUnread
  };
};

export const parseEyesOnAgentsSetLastUserPromptCaptureEnabledParams = (
  value: unknown
): { enabled: boolean } => {
  if (!isEyesOnAgentsRecord(value)) throw new Error('prompt capture params must be an object');
  assertOnlyKeys(value, ['enabled'], 'prompt capture params');
  if (typeof value.enabled !== 'boolean') throw new Error('enabled must be a boolean');
  return { enabled: value.enabled };
};

export const parseEyesOnAgentsSetClaudeProviderEnabledParams = (
  value: unknown
): { enabled: boolean } => {
  if (!isEyesOnAgentsRecord(value)) throw new Error('Claude provider params must be an object');
  assertOnlyKeys(value, ['enabled'], 'Claude provider params');
  if (typeof value.enabled !== 'boolean') throw new Error('enabled must be a boolean');
  return { enabled: value.enabled };
};

export const parseEyesOnAgentsThreadRefreshPatch = (
  value: unknown
): EyesOnAgentsThreadRefreshPatch => {
  if (!isEyesOnAgentsRecord(value)) throw new Error('thread refresh patch must be an object');
  assertOnlyKeys(
    value,
    [
      'threadId',
      'title',
      'lastActivityAt',
      'lastUserPrompt',
      'terminalTurn',
      'settledTurn',
      'recoveredTurn',
      'reclaimedTurn'
    ],
    'thread refresh patch'
  );
  const result: EyesOnAgentsThreadRefreshPatch = {
    threadId: parseEyesOnAgentsUuid(value.threadId)
  };
  if (hasOwn(value, 'title')) {
    if (value.title === undefined) throw new Error('title must not be undefined');
    result.title = parseEyesOnAgentsText(value.title, 'thread title', 300);
  }
  if (hasOwn(value, 'lastActivityAt')) {
    if (value.lastActivityAt === undefined) {
      throw new Error('lastActivityAt must not be undefined');
    }
    result.lastActivityAt = parseEyesOnAgentsTimestamp(
      value.lastActivityAt,
      'lastActivityAt',
      false
    ) as number;
  }
  if (hasOwn(value, 'lastUserPrompt')) {
    if (!isEyesOnAgentsRecord(value.lastUserPrompt)) {
      throw new Error('last user prompt patch must be an object');
    }
    assertOnlyKeys(
      value.lastUserPrompt,
      ['preview', 'turnId', 'observedAt', 'checkedAt', 'truncated', 'source'],
      'last user prompt patch'
    );
    if (value.lastUserPrompt.source !== 'app_server') {
      throw new Error('last user prompt source must be app_server');
    }
    if (typeof value.lastUserPrompt.truncated !== 'boolean') {
      throw new Error('last user prompt truncated must be a boolean');
    }
    if (!hasOwn(value.lastUserPrompt, 'preview') || value.lastUserPrompt.preview === undefined) {
      throw new Error('last user prompt preview is required');
    }
    if (!hasOwn(value.lastUserPrompt, 'turnId') || value.lastUserPrompt.turnId === undefined) {
      throw new Error('last user prompt turnId is required');
    }
    if (!hasOwn(value.lastUserPrompt, 'observedAt') || value.lastUserPrompt.observedAt === undefined) {
      throw new Error('last user prompt observedAt is required');
    }
    result.lastUserPrompt = {
      preview: parseEyesOnAgentsLastUserPromptPreview(value.lastUserPrompt.preview),
      turnId: parseEyesOnAgentsText(value.lastUserPrompt.turnId, 'last user prompt turnId', 200),
      observedAt: parseEyesOnAgentsTimestamp(
        value.lastUserPrompt.observedAt,
        'last user prompt observedAt'
      ),
      checkedAt: parseEyesOnAgentsTimestamp(
        value.lastUserPrompt.checkedAt,
        'last user prompt checkedAt',
        false
      ) as number,
      truncated: value.lastUserPrompt.truncated,
      source: value.lastUserPrompt.source
    };
  }
  if (hasOwn(value, 'terminalTurn')) {
    if (!isEyesOnAgentsRecord(value.terminalTurn)) {
      throw new Error('terminal turn patch must be an object');
    }
    assertOnlyKeys(
      value.terminalTurn,
      [
        'turnId',
        'outcome',
        'completedAt',
        'expectedActiveTurnId',
        'expectedStatusObservedAt',
        'expectedStatusSource',
        'source'
      ],
      'terminal turn patch'
    );
    if (value.terminalTurn.source !== 'app_server') {
      throw new Error('terminal turn source must be app_server');
    }
    if (
      value.terminalTurn.expectedStatusSource !== 'codex_hook' &&
      value.terminalTurn.expectedStatusSource !== 'app_server_turn'
    ) {
      throw new Error('expected status source must be codex_hook or app_server_turn');
    }
    if (!['completed', 'failed', 'interrupted'].includes(String(value.terminalTurn.outcome))) {
      throw new Error('terminal turn outcome is unsupported');
    }
    const turnId = parseEyesOnAgentsText(
      value.terminalTurn.turnId,
      'terminal turn id',
      200,
      false
    ) as string;
    const expectedActiveTurnId = parseEyesOnAgentsText(
      value.terminalTurn.expectedActiveTurnId,
      'expected active turn id',
      200,
      false
    ) as string;
    if (turnId !== expectedActiveTurnId) {
      throw new Error('terminal turn id must match the expected active turn id');
    }
    const completedAt = parseEyesOnAgentsTimestamp(
      value.terminalTurn.completedAt,
      'terminal turn completedAt',
      false
    ) as number;
    const expectedStatusObservedAt = parseEyesOnAgentsTimestamp(
      value.terminalTurn.expectedStatusObservedAt,
      'expected status observedAt',
      false
    ) as number;
    result.terminalTurn = {
      turnId,
      outcome: value.terminalTurn.outcome as 'completed' | 'failed' | 'interrupted',
      completedAt,
      expectedActiveTurnId,
      expectedStatusObservedAt,
      expectedStatusSource: value.terminalTurn.expectedStatusSource,
      source: value.terminalTurn.source
    };
  }
  if (hasOwn(value, 'settledTurn')) {
    if (!isEyesOnAgentsRecord(value.settledTurn)) {
      throw new Error('settled turn patch must be an object');
    }
    assertOnlyKeys(
      value.settledTurn,
      ['turnId', 'outcome', 'completedAt', 'expectedStatusObservedAt', 'source'],
      'settled turn patch'
    );
    if (value.settledTurn.source !== 'app_server') {
      throw new Error('settled turn source must be app_server');
    }
    if (!['completed', 'failed', 'interrupted'].includes(String(value.settledTurn.outcome))) {
      throw new Error('settled turn outcome is unsupported');
    }
    result.settledTurn = {
      turnId: parseEyesOnAgentsText(
        value.settledTurn.turnId,
        'settled turn id',
        200,
        false
      ) as string,
      outcome: value.settledTurn.outcome as 'completed' | 'failed' | 'interrupted',
      completedAt: parseEyesOnAgentsTimestamp(
        value.settledTurn.completedAt,
        'settled turn completedAt',
        false
      ) as number,
      expectedStatusObservedAt: parseEyesOnAgentsTimestamp(
        value.settledTurn.expectedStatusObservedAt,
        'expected status observedAt',
        false
      ) as number,
      source: value.settledTurn.source
    };
  }
  if (hasOwn(value, 'recoveredTurn')) {
    if (!isEyesOnAgentsRecord(value.recoveredTurn)) {
      throw new Error('recovered turn patch must be an object');
    }
    assertOnlyKeys(
      value.recoveredTurn,
      ['turnId', 'startedAt', 'expectedStatusObservedAt', 'source'],
      'recovered turn patch'
    );
    if (value.recoveredTurn.source !== 'app_server_turn') {
      throw new Error('recovered turn source must be app_server_turn');
    }
    result.recoveredTurn = {
      turnId: parseEyesOnAgentsText(
        value.recoveredTurn.turnId,
        'recovered turn id',
        200,
        false
      ) as string,
      startedAt: parseEyesOnAgentsTimestamp(
        value.recoveredTurn.startedAt,
        'recovered turn startedAt',
        false
      ) as number,
      expectedStatusObservedAt: parseEyesOnAgentsTimestamp(
        value.recoveredTurn.expectedStatusObservedAt,
        'expected status observedAt',
        false
      ) as number,
      source: value.recoveredTurn.source
    };
  }
  if (hasOwn(value, 'reclaimedTurn')) {
    if (!isEyesOnAgentsRecord(value.reclaimedTurn)) {
      throw new Error('reclaimed turn patch must be an object');
    }
    assertOnlyKeys(
      value.reclaimedTurn,
      [
        'turnId',
        'startedAt',
        'expectedActiveTurnId',
        'expectedStatusObservedAt',
        'expectedStatusSource',
        'source'
      ],
      'reclaimed turn patch'
    );
    if (value.reclaimedTurn.source !== 'app_server_turn') {
      throw new Error('reclaimed turn source must be app_server_turn');
    }
    if (value.reclaimedTurn.expectedStatusSource !== 'codex_hook') {
      throw new Error('reclaimed turn expected status source must be codex_hook');
    }
    const turnId = parseEyesOnAgentsText(
      value.reclaimedTurn.turnId,
      'reclaimed turn id',
      200,
      false
    ) as string;
    const expectedActiveTurnId = parseEyesOnAgentsText(
      value.reclaimedTurn.expectedActiveTurnId,
      'expected active turn id',
      200,
      false
    ) as string;
    if (turnId !== expectedActiveTurnId) {
      throw new Error('reclaimed turn id must match the expected active turn id');
    }
    result.reclaimedTurn = {
      turnId,
      startedAt: parseEyesOnAgentsTimestamp(
        value.reclaimedTurn.startedAt,
        'reclaimed turn startedAt',
        false
      ) as number,
      expectedActiveTurnId,
      expectedStatusObservedAt: parseEyesOnAgentsTimestamp(
        value.reclaimedTurn.expectedStatusObservedAt,
        'expected status observedAt',
        false
      ) as number,
      expectedStatusSource: value.reclaimedTurn.expectedStatusSource,
      source: value.reclaimedTurn.source
    };
  }
  const turnTransitions = [
    result.terminalTurn,
    result.settledTurn,
    result.recoveredTurn,
    result.reclaimedTurn
  ].filter((transition) => transition !== undefined).length;
  if (turnTransitions > 1) {
    throw new Error('a thread refresh patch must carry at most one turn transition');
  }
  return result;
};

export const parseEyesOnAgentsRuntimeEvent = (
  event: EyesOnAgentsRuntimeEvent
): EyesOnAgentsRuntimeEvent => {
  const threadId = parseEyesOnAgentsUuid(event.threadId);
  const observedAt = parseEyesOnAgentsTimestamp(event.observedAt, 'observedAt', false) as number;
  const cwd = event.cwd === undefined ? undefined : parseEyesOnAgentsPath(event.cwd);
  const project = event.project === undefined
    ? undefined
    : parseEyesOnAgentsProjectMetadata(event.project);
  const turnId = event.turnId === undefined
    ? undefined
    : parseEyesOnAgentsText(event.turnId, 'turnId', 200);
  if (
    event.source !== 'app_server'
    && event.source !== 'codex_hook'
    && event.source !== 'claude_hook'
  ) {
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
      project,
      turnId
    };
  }
  if (event.type === 'turn_completed') {
    if (!['completed', 'failed', 'interrupted'].includes(event.outcome)) {
      throw new Error('turn outcome is unsupported');
    }
    return { ...event, threadId, observedAt, cwd, project, turnId: turnId ?? null };
  }
  if (event.type === 'turn_started') {
    return { ...event, threadId, observedAt, cwd, project, turnId: turnId ?? null };
  }
  throw new Error('runtime event type is unsupported');
};
