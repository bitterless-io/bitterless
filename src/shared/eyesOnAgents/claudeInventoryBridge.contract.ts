import { createHash } from 'node:crypto';
import { isAbsolute, join } from 'node:path';
import type {
  ClaudeInventoryBridgeEndpoint,
  ClaudeInventoryInvalidation,
  ClaudeInventoryInvalidationSource,
  ClaudeInventoryWatcherArgs,
  ClaudeInventoryWatcherReady
} from './claudeInventoryBridge.type';
import { isEyesOnAgentsRecord, parseEyesOnAgentsTimestamp } from './eyesOnAgents.contract';

export const CLAUDE_INVENTORY_MAX_FRAME_BYTES = 1024;
export const CLAUDE_INVENTORY_WATCHER_ARG = '--claude-inventory-watcher';
export const CLAUDE_INVENTORY_SOCKET_ARG = '--claude-inventory-socket';
export const CLAUDE_INVENTORY_ROOT_ARG = '--claude-inventory-root';
export const CLAUDE_INVENTORY_NONCE_ARG = '--claude-inventory-nonce';
export const CLAUDE_INVENTORY_WATCHER_READY: ClaudeInventoryWatcherReady = Object.freeze({
  schemaVersion: 1,
  type: 'ready'
});

const SOURCES = new Set<ClaudeInventoryInvalidationSource>(['desktop', 'transcripts']);
const CONTROL = /[\0\r\n]/;

const safeString = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !value || CONTROL.test(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value;
};

// A unix domain socket address is a fixed-size struct sockaddr_un: sun_path is 104 bytes on macOS
// and 108 on Linux, INCLUDING the terminating NUL, so the usable path is one byte shorter. bind(2)
// rejects anything longer with EINVAL. macOS is the tighter of the two and is what we budget for.
const UNIX_SOCKET_PATH_MAX_BYTES = 103;

// environmentId scopes the endpoint to one configured Claude environment (task 085): each
// environment now runs its own ClaudeWatcherSupervisor/child process, so without a distinct
// socket/pipe per environment, two simultaneously-running environments would collide on the same
// endpoint path. Omitting it (existing callers, existing tests) reproduces the exact pre-085 path.
//
// The scoped unix name is deliberately terse (`ci-<12 hex>.sock`, 20 chars) rather than the obvious
// `claude-inventory-<id>.sock`. The profile-scoped userData prefix already consumes 65-76 of the
// 103-byte budget, so on a debug/preview profile even a hashed `claude-inventory-<12 hex>.sock`
// (34 chars) overflows. Hashing alone is not enough here; the base name has to shrink too.
export const getClaudeInventoryBridgeEndpoint = (
  userDataPath: string,
  platform: NodeJS.Platform = process.platform,
  environmentId?: string
): ClaudeInventoryBridgeEndpoint => {
  const safe = safeString(userDataPath, 'userData path');
  const scope = environmentId === undefined ? '' : `-${safeString(environmentId, 'Claude environment id')}`;
  if (platform === 'win32') {
    const suffix = createHash('sha1').update(`${safe}${scope}`).digest('hex').slice(0, 12);
    return { transport: 'win32-named-pipe', path: `\\\\.\\pipe\\bitterless-claude-inventory-${suffix}` };
  }
  const fileName = environmentId === undefined
    ? 'claude-inventory.sock'
    : `ci-${createHash('sha1').update(scope).digest('hex').slice(0, 12)}.sock`;
  const path = join(safe, 'eyes-on-agents', fileName);
  // A long enough home directory can still overflow any fixed name. Fail with something actionable
  // instead of letting it surface as an opaque `listen EINVAL` on an environment's status row.
  if (Buffer.byteLength(path, 'utf8') > UNIX_SOCKET_PATH_MAX_BYTES) {
    throw new Error(
      `Claude inventory socket path is ${Buffer.byteLength(path, 'utf8')} bytes, over the `
      + `${UNIX_SOCKET_PATH_MAX_BYTES}-byte unix socket limit`
    );
  }
  return { transport: 'unix', path };
};

export const parseClaudeInventoryInvalidation = (
  value: unknown
): ClaudeInventoryInvalidation => {
  if (!isEyesOnAgentsRecord(value)) throw new Error('Claude invalidation must be an object');
  if (Object.keys(value).sort().join(',') !== 'nonce,observedAt,schemaVersion,source') {
    throw new Error('Claude invalidation fields are invalid');
  }
  if (value.schemaVersion !== 1 || !SOURCES.has(value.source as ClaudeInventoryInvalidationSource)) {
    throw new Error('Claude invalidation version or source is unsupported');
  }
  return {
    schemaVersion: 1,
    nonce: safeString(value.nonce, 'Claude invalidation nonce'),
    source: value.source as ClaudeInventoryInvalidationSource,
    observedAt: parseEyesOnAgentsTimestamp(value.observedAt, 'observedAt', false) as number
  };
};

export const parseClaudeInventoryWatcherReady = (
  value: unknown
): ClaudeInventoryWatcherReady => {
  if (!isEyesOnAgentsRecord(value) || Object.keys(value).sort().join(',') !== 'schemaVersion,type') {
    throw new Error('Claude inventory watcher ready frame is invalid');
  }
  if (value.schemaVersion !== 1 || value.type !== 'ready') {
    throw new Error('Claude inventory watcher ready frame is unsupported');
  }
  return CLAUDE_INVENTORY_WATCHER_READY;
};

export const parseClaudeInventoryWatcherArgs = (
  argv: readonly string[],
  platform: NodeJS.Platform = process.platform
): ClaudeInventoryWatcherArgs => {
  if (argv.filter((value) => value === CLAUDE_INVENTORY_WATCHER_ARG).length !== 1) {
    throw new Error('Claude inventory watcher mode must be provided exactly once');
  }
  const index = argv.indexOf(CLAUDE_INVENTORY_WATCHER_ARG);
  let socketPath: string | null = null;
  let nonce: string | null = null;
  const roots: ClaudeInventoryWatcherArgs['roots'] = [];
  for (let cursor = index + 1; cursor < argv.length; cursor += 2) {
    const flag = argv[cursor];
    const raw = argv[cursor + 1];
    if (raw === undefined) throw new Error(`${flag} requires a value`);
    if (flag === CLAUDE_INVENTORY_SOCKET_ARG) {
      if (socketPath !== null) throw new Error('Claude inventory socket may be provided only once');
      socketPath = safeString(raw, 'Claude inventory socket');
      continue;
    }
    if (flag === CLAUDE_INVENTORY_NONCE_ARG) {
      if (nonce !== null) throw new Error('Claude inventory nonce may be provided only once');
      nonce = safeString(raw, 'Claude inventory nonce');
      continue;
    }
    if (flag !== CLAUDE_INVENTORY_ROOT_ARG) throw new Error(`Unknown Claude watcher argument: ${flag}`);
    const separator = raw.indexOf('=');
    const source = raw.slice(0, separator) as ClaudeInventoryInvalidationSource;
    const path = safeString(raw.slice(separator + 1), 'Claude inventory root');
    if (!SOURCES.has(source) || !isAbsolute(path)) throw new Error('Claude inventory root is invalid');
    roots.push({ source, path });
  }
  if (socketPath === null) throw new Error('Claude inventory socket is required');
  if (nonce === null || !/^[0-9a-f]{32}$/i.test(nonce)) throw new Error('Claude inventory nonce is invalid');
  if (platform === 'win32') {
    if (!socketPath.startsWith('\\\\.\\pipe\\')) throw new Error('Claude watcher requires a named pipe');
  } else if (!isAbsolute(socketPath)) {
    throw new Error('Claude watcher requires an absolute Unix socket');
  }
  if (roots.length === 0 || roots.length > 8) throw new Error('Claude watcher roots are invalid');
  if (new Set(roots.map((root) => `${root.source}:${root.path}`)).size !== roots.length) {
    throw new Error('Claude watcher roots must be unique');
  }
  return {
    endpoint: { transport: platform === 'win32' ? 'win32-named-pipe' : 'unix', path: socketPath },
    nonce: nonce.toLowerCase(),
    roots
  };
};
