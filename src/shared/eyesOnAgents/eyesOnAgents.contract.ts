import { isAbsolute } from 'node:path';
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
// Task 089 (copyable per-environment setup command). Derivation, in this order: lowercase, replace
// every character outside [a-z0-9_] with _, collapse runs of _, fall back to claude_env when
// nothing usable survives (empty, or a single _) or the result is a reserved name, prefix _ when
// the result starts with a digit.
const CLAUDE_ENVIRONMENT_FUNCTION_NAME_FALLBACK = 'claude_env';
const CLAUDE_ENVIRONMENT_FUNCTION_NAME_UNSAFE_PATTERN = /[^a-z0-9_]+/gu;
const CLAUDE_ENVIRONMENT_FUNCTION_NAME_UNDERSCORE_RUN_PATTERN = /__+/gu;
const CLAUDE_ENVIRONMENT_FUNCTION_NAME_LEADING_DIGIT_PATTERN = /^[0-9]/u;
// Names the wrapper must never take, every one reachable from a label of the same text through the
// [a-z0-9_] sanitization above (reserved words made only of punctuation — `!`, `{`, `}`, `[[`, `]]`
// — sanitize to `_` and can never be derived, so they are deliberately absent).
//   - `command` is the wrapper's own escape hatch and a *regular* builtin, so a function named
//     `command` shadows it and `command claude "$@"` recurses: bash hangs outright, zsh aborts with
//     "maximum nested function level reached".
//   - the rest are the union of bash's and zsh's reserved-word tables restricted to [a-z0-9_]. Each
//     either fails to parse as a function definition (`if() { … }` is a syntax error in both shells;
//     `while`/`until`/`time`/`in`/`function` in bash; `repeat`/`foreach`/`end` in zsh) or parses as
//     a reserved word at the *call* site so the wrapper is unreachable (`while`/`until` loop forever
//     in zsh; `time`/`coproc`/`nocorrect` swallow the arguments). Verified in both shells.
const CLAUDE_ENVIRONMENT_FUNCTION_NAME_RESERVED = new Set([
  'command',
  'case', 'coproc', 'do', 'done', 'elif', 'else', 'end', 'esac', 'fi', 'for', 'foreach',
  'function', 'if', 'in', 'nocorrect', 'repeat', 'select', 'then', 'time', 'until', 'while'
]);
// A `#` comment runs to end of line, so a newline is the only character that can escape it — every
// whitespace/control run in the label folds to one space so the comment stays exactly one line.
// eslint-disable-next-line no-control-regex -- folding control characters out of a user label is the point
const CLAUDE_ENVIRONMENT_COMMENT_BLANK_PATTERN = /[\s\u0000-\u001f\u007f]+/gu;
// The directory is emitted inside 'single quotes', where bash and zsh both leave history expansion
// (`!`), parameter expansion, command substitution and backslash escapes inert — so `'` is the only
// character that needs escaping, in the standard close/escape/reopen form `'\''`. Double quotes
// would additionally require escaping `"`, `$`, `` ` `` and `\`, and would still leave a path
// containing `!` unpastable at an interactive bash *or* zsh prompt (`event not found`).
const CLAUDE_ENVIRONMENT_SINGLE_QUOTE_PATTERN = /'/gu;
const CLAUDE_ENVIRONMENT_SINGLE_QUOTE_ESCAPE = "'\\''";
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

// Raw CLAUDE_CONFIG_DIR path captured on SessionStart (schema V4). Independent from
// iterm2SessionId above; never a foreign key to an EyesOnAgentsClaudeEnvironment id.
export const parseEyesOnAgentsClaudeConfigDir = (
  value: unknown
): string | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !value || !isAbsolute(value)) {
    throw new Error('claudeConfigDir must be a non-empty absolute path');
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

// Task 089: derives the wrapper's shell function name from an environment label. Kept exported so
// the fallback/collision rules are testable on their own, independently of the emitted snippet.
export const deriveEyesOnAgentsClaudeEnvironmentFunctionName = (label: string): string => {
  const name = label
    .toLowerCase()
    .replace(CLAUDE_ENVIRONMENT_FUNCTION_NAME_UNSAFE_PATTERN, '_')
    .replace(CLAUDE_ENVIRONMENT_FUNCTION_NAME_UNDERSCORE_RUN_PATTERN, '_');
  if (name === '' || name === '_') return CLAUDE_ENVIRONMENT_FUNCTION_NAME_FALLBACK;
  // A name that shadows `command` or a bash/zsh reserved word cannot be a working wrapper, so it
  // takes the same documented fallback as "nothing usable survived" rather than a second name shape
  // (`command_env` would newly collide with the label `command env`, which already derives there).
  if (CLAUDE_ENVIRONMENT_FUNCTION_NAME_RESERVED.has(name)) {
    return CLAUDE_ENVIRONMENT_FUNCTION_NAME_FALLBACK;
  }
  return CLAUDE_ENVIRONMENT_FUNCTION_NAME_LEADING_DIGIT_PATTERN.test(name) ? `_${name}` : name;
};

// Task 089: the ready-to-paste CLAUDE_CONFIG_DIR shell wrapper for one custom Claude environment
// (see docs/features/eyes-on-agents-claude-multi-environment.md, "Copyable shell command"):
//
//   # Bitterless: Claude environment "claude2"
//   claude2() { CLAUDE_CONFIG_DIR='/Users/ral/.claude2' command claude "$@"; }
//
// `command claude` — never bare `claude` — so an environment labelled `claude` produces a wrapper
// that runs the `claude` *executable* instead of recursing into itself and hanging the user's shell.
// `command` skips function lookup for the name it is given, but it is itself a regular builtin and
// therefore shadowable, so this only holds while the wrapper is not named `command`; that one case
// is handled by CLAUDE_ENVIRONMENT_FUNCTION_NAME_RESERVED, not by `command`.
// Pure and Electron-free so it is unit-testable and has exactly one definition for every caller.
// The result embeds a real filesystem path and must never be logged; a user-initiated clipboard
// write is its only sanctioned egress.
export const buildEyesOnAgentsClaudeEnvironmentSetupCommand = (params: {
  label: string;
  configDirectory: string;
}): string => {
  if (!params.configDirectory || CONTROL_CHARACTER_PATTERN.test(params.configDirectory)) {
    throw new Error('Claude environment setup command requires a configured directory');
  }
  const functionName = deriveEyesOnAgentsClaudeEnvironmentFunctionName(params.label);
  const comment = params.label
    .replace(CLAUDE_ENVIRONMENT_COMMENT_BLANK_PATTERN, ' ')
    .trim() || functionName;
  const directory = params.configDirectory
    .replace(CLAUDE_ENVIRONMENT_SINGLE_QUOTE_PATTERN, CLAUDE_ENVIRONMENT_SINGLE_QUOTE_ESCAPE);
  return `# Bitterless: Claude environment "${comment}"\n`
    + `${functionName}() { CLAUDE_CONFIG_DIR='${directory}' command claude "$@"; }`;
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

export const parseEyesOnAgentsClaudeEnvironmentId = (value: unknown): string => {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new Error('Claude environment id must be a UUID');
  }
  return value.toLowerCase();
};

export const parseEyesOnAgentsClaudeEnvironmentLabel = (value: unknown): string => {
  return parseEyesOnAgentsText(value, 'Claude environment label', 80, false) as string;
};

// The one absolute-path rule shared by adding an environment (task 091) and repointing one
// (task 092). Deliberately does NOT touch the filesystem: existence/symlink/realpath checks stay in
// requireCanonicalClaudeConfigDirectory on the Main side, the only place allowed to stat.
const parseEyesOnAgentsClaudeConfigDirectory = (value: unknown): string => {
  const configDirectory = parseEyesOnAgentsText(
    value,
    'Claude config directory',
    4_096,
    false
  ) as string;
  if (!configDirectory.startsWith('/') && !/^[A-Za-z]:[\\/]/u.test(configDirectory)) {
    throw new Error('Claude config directory must be an absolute path');
  }
  return configDirectory;
};

// Task 091: an environment is added by pasting its absolute CLAUDE_CONFIG_DIR, not by naming it and
// then hunting for it in the native picker — a Claude config directory is a hidden dotfile directory,
// which the macOS dialog makes awkward to reach, while the absolute path is one paste. This parser
// deliberately does NOT touch the filesystem; existence/symlink/realpath checks stay in
// requireCanonicalClaudeConfigDirectory on the Main side, the only place allowed to stat.
export const parseEyesOnAgentsAddClaudeEnvironmentParams = (
  value: unknown
): { configDirectory: string } => {
  if (!isEyesOnAgentsRecord(value)) throw new Error('Claude environment params must be an object');
  assertOnlyKeys(value, ['configDirectory'], 'Claude environment params');
  return { configDirectory: parseEyesOnAgentsClaudeConfigDirectory(value.configDirectory) };
};

// Task 092: repointing an existing environment takes the same pasted-absolute-path shape as adding
// one, so both share this rule rather than duplicating the regex.
export const parseEyesOnAgentsSetClaudeEnvironmentDirectoryParams = (
  value: unknown
): { id: string; configDirectory: string } => {
  if (!isEyesOnAgentsRecord(value)) throw new Error('Claude environment params must be an object');
  assertOnlyKeys(value, ['id', 'configDirectory'], 'Claude environment params');
  return {
    id: parseEyesOnAgentsClaudeEnvironmentId(value.id),
    configDirectory: parseEyesOnAgentsClaudeConfigDirectory(value.configDirectory)
  };
};

// Names an environment from its own directory so the user does not have to label a thing they just
// identified by path: /Users/ral/.claude2 -> "claude2". Derive from the CANONICAL path so a trailing
// slash or a "/./" segment cannot produce a different label for the same directory. The label is not
// an identity (id is) and Rename always exists, so a duplicate or awkward derivation is correctable.
export const deriveEyesOnAgentsClaudeEnvironmentLabel = (configDirectory: string): string => {
  const segments = configDirectory.split(/[\\/]+/u).filter((segment) => segment.length > 0);
  const base = segments[segments.length - 1] ?? '';
  const stripped = base.startsWith('.') ? base.slice(1) : base;
  const label = stripped.length > 0 ? stripped : base;
  return label.length > 0 ? label.slice(0, 80) : 'Claude environment';
};

export const parseEyesOnAgentsClaudeEnvironmentIdParams = (
  value: unknown
): { id: string } => {
  if (!isEyesOnAgentsRecord(value)) throw new Error('Claude environment params must be an object');
  assertOnlyKeys(value, ['id'], 'Claude environment params');
  return { id: parseEyesOnAgentsClaudeEnvironmentId(value.id) };
};

// The Claude plugin bridge XPC methods (install/refresh/remove/status) accept an optional
// environmentId so a call with no params still targets the one automatic environment exactly as
// before task 086 (preserving every pre-existing zero-arg renderer call site unchanged); an
// explicitly supplied id is validated as a real Claude environment UUID and resolved/rejected by
// the handler, never silently substituted.
export const parseEyesOnAgentsClaudeBridgeEnvironmentParams = (
  value: unknown
): { environmentId?: string } => {
  if (value === undefined) return {};
  if (!isEyesOnAgentsRecord(value)) throw new Error('Claude bridge params must be an object');
  assertOnlyKeys(value, ['environmentId'], 'Claude bridge params');
  if (value.environmentId === undefined) return {};
  return { environmentId: parseEyesOnAgentsClaudeEnvironmentId(value.environmentId) };
};

export const parseEyesOnAgentsRenameClaudeEnvironmentParams = (
  value: unknown
): { id: string; label: string } => {
  if (!isEyesOnAgentsRecord(value)) throw new Error('Claude environment params must be an object');
  assertOnlyKeys(value, ['id', 'label'], 'Claude environment params');
  return {
    id: parseEyesOnAgentsClaudeEnvironmentId(value.id),
    label: parseEyesOnAgentsClaudeEnvironmentLabel(value.label)
  };
};

export const parseEyesOnAgentsSetClaudeEnvironmentEnabledParams = (
  value: unknown
): { id: string; enabled: boolean } => {
  if (!isEyesOnAgentsRecord(value)) throw new Error('Claude environment params must be an object');
  assertOnlyKeys(value, ['id', 'enabled'], 'Claude environment params');
  if (typeof value.enabled !== 'boolean') throw new Error('enabled must be a boolean');
  return { id: parseEyesOnAgentsClaudeEnvironmentId(value.id), enabled: value.enabled };
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
