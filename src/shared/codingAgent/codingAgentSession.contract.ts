import type {
  CodingAgentProvider,
  CodingAgentRuntimeState,
  CodingAgentSessionRecord,
  CodingAgentStatusSource,
  CodingAgentSurface,
  CodingAgentTurnState,
  NormalizedCodingAgentStatus,
  RegisterCodingAgentSessionParams
} from './codingAgentSession.type';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CLAUDE_JOB_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CONTROL_CHARACTER_PATTERN = /[\0\r\n]/;

const providers = new Set<CodingAgentProvider>(['codex', 'claude']);
const surfaces = new Set<CodingAgentSurface>([
  'codex-desktop',
  'codex-managed-app-server',
  'claude-code-background',
  'claude-code-cli',
  'claude-desktop-chat',
  'claude-desktop-code'
]);
const runtimeStates = new Set<CodingAgentRuntimeState>([
  'working',
  'waiting_approval',
  'waiting_input',
  'idle',
  'failed',
  'stopped',
  'ended',
  'unknown'
]);
const turnStates = new Set<CodingAgentTurnState>([
  'in_progress',
  'completed',
  'interrupted',
  'failed',
  'unknown'
]);
const statusSources = new Set<CodingAgentStatusSource>([
  'codex-app-server',
  'codex-hook',
  'claude-agents-cli',
  'claude-hook',
  'manual',
  'none'
]);
const terminalRuntimeStates = new Set<CodingAgentRuntimeState>(['failed', 'stopped', 'ended']);
const terminalTurnStates = new Set<CodingAgentTurnState>(['completed', 'interrupted', 'failed']);

export const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
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

export const parseUuid = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new Error(`${label} must be a UUID`);
  }
  return value.toLowerCase();
};

export const parseClaudeJobId = (value: unknown): string => {
  if (
    typeof value !== 'string' ||
    !CLAUDE_JOB_ID_PATTERN.test(value) ||
    value.startsWith('-') ||
    value.includes('..')
  ) {
    throw new Error('Claude background job id is invalid');
  }
  return value;
};

export const parseProvider = (value: unknown): CodingAgentProvider => {
  if (typeof value !== 'string' || !providers.has(value as CodingAgentProvider)) {
    throw new Error('provider must be codex or claude');
  }
  return value as CodingAgentProvider;
};

export const parseSurface = (value: unknown): CodingAgentSurface => {
  if (typeof value !== 'string' || !surfaces.has(value as CodingAgentSurface)) {
    throw new Error('surface is unsupported');
  }
  return value as CodingAgentSurface;
};

export const assertProviderSurface = (
  provider: CodingAgentProvider,
  surface: CodingAgentSurface
): void => {
  if (provider === 'codex' && !surface.startsWith('codex-')) {
    throw new Error(`surface ${surface} does not belong to Codex`);
  }
  if (provider === 'claude' && !surface.startsWith('claude-')) {
    throw new Error(`surface ${surface} does not belong to Claude`);
  }
};

export const parseNullableText = (
  value: unknown,
  label: string,
  maxLength: number
): string | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new Error(`${label} must be a string or null`);
  const normalized = value.trim();
  if (normalized.length === 0) return null;
  if (normalized.length > maxLength) {
    throw new Error(`${label} must be at most ${maxLength} characters`);
  }
  if (CONTROL_CHARACTER_PATTERN.test(normalized)) {
    throw new Error(`${label} contains a forbidden control character`);
  }
  return normalized;
};

export const parsePathText = (value: unknown, label = 'cwd'): string | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new Error(`${label} must be a string or null`);
  if (value.trim().length === 0) return null;
  if (value !== value.trim())
    throw new Error(`${label} must not have leading or trailing whitespace`);
  if (value.length > 4096) throw new Error(`${label} must be at most 4096 characters`);
  if (CONTROL_CHARACTER_PATTERN.test(value)) {
    throw new Error(`${label} contains a forbidden control character`);
  }
  return value;
};

export const parseRuntimeState = (value: unknown): CodingAgentRuntimeState => {
  if (typeof value !== 'string' || !runtimeStates.has(value as CodingAgentRuntimeState)) {
    throw new Error('runtime state is unsupported');
  }
  return value as CodingAgentRuntimeState;
};

export const parseTurnState = (value: unknown): CodingAgentTurnState => {
  if (typeof value !== 'string' || !turnStates.has(value as CodingAgentTurnState)) {
    throw new Error('turn state is unsupported');
  }
  return value as CodingAgentTurnState;
};

export const parseStatusSource = (value: unknown): CodingAgentStatusSource => {
  if (typeof value !== 'string' || !statusSources.has(value as CodingAgentStatusSource)) {
    throw new Error('status source is unsupported');
  }
  return value as CodingAgentStatusSource;
};

export const parseRegisterCodingAgentSessionParams = (
  value: unknown
): RegisterCodingAgentSessionParams => {
  if (!isPlainRecord(value)) throw new Error('registration params must be an object');
  assertOnlyKeys(
    value,
    ['provider', 'surface', 'externalSessionId', 'title', 'cwd'],
    'registration params'
  );
  const provider = parseProvider(value.provider);
  const surface = parseSurface(value.surface);
  assertProviderSurface(provider, surface);
  const externalSessionId = parseUuid(value.externalSessionId, 'externalSessionId');
  return {
    provider,
    surface,
    externalSessionId,
    title: parseNullableText(value.title, 'title', 300),
    cwd: parsePathText(value.cwd)
  };
};

export const parseCodingAgentListParams = (value: unknown): { includeUnknown?: boolean } => {
  if (value === undefined) return {};
  if (!isPlainRecord(value)) throw new Error('list params must be an object');
  assertOnlyKeys(value, ['includeUnknown'], 'list params');
  const includeUnknown = value.includeUnknown;
  if (includeUnknown !== undefined && typeof includeUnknown !== 'boolean') {
    throw new Error('includeUnknown must be a boolean');
  }
  if (includeUnknown === undefined) return {};
  return { includeUnknown: includeUnknown as boolean };
};

export const parseCodingAgentRefreshParams = (
  value: unknown
): { provider?: CodingAgentProvider } => {
  if (value === undefined) return {};
  if (!isPlainRecord(value)) throw new Error('refresh params must be an object');
  assertOnlyKeys(value, ['provider'], 'refresh params');
  return value.provider === undefined ? {} : { provider: parseProvider(value.provider) };
};

export const parseCodingAgentIdParams = (value: unknown): { id: string } => {
  if (!isPlainRecord(value)) throw new Error('session params must be an object');
  assertOnlyKeys(value, ['id'], 'session params');
  return { id: parseUuid(value.id, 'id') };
};

export const parseCodingAgentRenameParams = (
  value: unknown
): { id: string; title: string | null } => {
  if (!isPlainRecord(value)) throw new Error('rename params must be an object');
  assertOnlyKeys(value, ['id', 'title'], 'rename params');
  return {
    id: parseUuid(value.id, 'id'),
    title: parseNullableText(value.title, 'title', 300)
  };
};

const codexProviderState = (type: string, flags: string[]): string => {
  return flags.length === 0 ? type : `${type}:${flags.join(',')}`;
};

export const normalizeCodexThreadStatus = (
  value: unknown,
  options: {
    authoritative: boolean;
    lastTurnState?: CodingAgentTurnState;
  }
): NormalizedCodingAgentStatus => {
  if (!isPlainRecord(value) || typeof value.type !== 'string') {
    return { state: 'unknown', lastTurnState: 'unknown', providerState: null, recognized: false };
  }
  const type = value.type;
  const previousTurn = options.lastTurnState ?? 'unknown';
  if (type === 'notLoaded') {
    return {
      state: 'unknown',
      lastTurnState: terminalTurnStates.has(previousTurn) ? previousTurn : 'unknown',
      providerState: type,
      recognized: true
    };
  }
  if (type === 'idle') {
    return {
      state: options.authoritative ? 'idle' : 'unknown',
      lastTurnState: options.authoritative ? previousTurn : 'unknown',
      providerState: type,
      recognized: true
    };
  }
  if (type === 'systemError') {
    return {
      state: options.authoritative ? 'failed' : 'unknown',
      lastTurnState: options.authoritative ? previousTurn : 'unknown',
      providerState: type,
      recognized: true
    };
  }
  if (type !== 'active' || !Array.isArray(value.activeFlags)) {
    return { state: 'unknown', lastTurnState: 'unknown', providerState: type, recognized: false };
  }
  const flags = value.activeFlags;
  if (!flags.every((flag) => flag === 'waitingOnApproval' || flag === 'waitingOnUserInput')) {
    return {
      state: 'unknown',
      lastTurnState: 'unknown',
      providerState: codexProviderState(type, flags.map(String)),
      recognized: false
    };
  }
  if (!options.authoritative) {
    return {
      state: 'unknown',
      lastTurnState: 'unknown',
      providerState: codexProviderState(type, flags),
      recognized: true
    };
  }
  let state: CodingAgentRuntimeState = 'working';
  if (flags.includes('waitingOnApproval')) state = 'waiting_approval';
  else if (flags.includes('waitingOnUserInput')) state = 'waiting_input';
  return {
    state,
    lastTurnState: 'in_progress',
    providerState: codexProviderState(type, flags),
    recognized: true
  };
};

export const normalizeClaudeBackgroundState = (
  state: unknown,
  waitingFor: unknown
): NormalizedCodingAgentStatus => {
  const providerState = typeof state === 'string' ? state : null;
  if (state === 'working') {
    return { state: 'working', lastTurnState: 'in_progress', providerState, recognized: true };
  }
  if (state === 'blocked') {
    const reason = typeof waitingFor === 'string' ? waitingFor.toLowerCase() : '';
    return {
      state: reason.includes('permission') ? 'waiting_approval' : 'waiting_input',
      lastTurnState: 'in_progress',
      providerState,
      recognized: true
    };
  }
  if (state === 'done') {
    return { state: 'idle', lastTurnState: 'completed', providerState, recognized: true };
  }
  if (state === 'failed') {
    return { state: 'failed', lastTurnState: 'failed', providerState, recognized: true };
  }
  if (state === 'stopped') {
    return { state: 'stopped', lastTurnState: 'interrupted', providerState, recognized: true };
  }
  return { state: 'unknown', lastTurnState: 'unknown', providerState, recognized: false };
};

export const effectiveRuntimeState = (
  record: Pick<CodingAgentSessionRecord, 'state' | 'statusFreshUntil'>,
  now: number
): CodingAgentRuntimeState => {
  if (terminalRuntimeStates.has(record.state) || record.state === 'unknown') return record.state;
  if (record.statusFreshUntil === null || now > record.statusFreshUntil) return 'unknown';
  return record.state;
};
