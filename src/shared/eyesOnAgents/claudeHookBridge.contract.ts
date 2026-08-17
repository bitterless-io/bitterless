import { createHash } from 'node:crypto';
import { isAbsolute, join, win32 } from 'node:path';
import type {
  ClaudeHookBridgeEndpoint,
  ClaudeHookCommitAcknowledgement,
  ClaudeHookDelivery,
  ClaudeHookEvent,
  ClaudeHookEventName,
  ClaudeHookHelperArgs
} from './claudeHookBridge.type';
import {
  isEyesOnAgentsRecord,
  parseEyesOnAgentsPath,
  parseEyesOnAgentsTimestamp,
  parseEyesOnAgentsUuid
} from './eyesOnAgents.contract';

export const CLAUDE_HOOK_MAX_FRAME_BYTES = 16 * 1024;
export const CLAUDE_HOOK_HELPER_ARG = '--claude-hook-helper';
export const CLAUDE_HOOK_SOCKET_ARG = '--claude-hook-socket';
export const CLAUDE_HOOK_INSTALLATION_ARG = '--claude-hook-installation';
export const CLAUDE_HOOK_OUTBOX_ARG = '--claude-hook-outbox';

const EVENT_NAMES = new Set<ClaudeHookEventName>([
  'SessionStart',
  'UserPromptSubmit',
  'PermissionRequest',
  'Stop',
  'StopFailure',
  'SessionEnd'
]);
const CONTROL = /[\0\r\n]/;

const exactKeys = (value: Record<string, unknown>, keys: string[], label: string): void => {
  if (Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) {
    throw new Error(`${label} fields are invalid`);
  }
};

const safeArgument = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !value || value !== value.trim() || CONTROL.test(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value;
};

const parseEventName = (value: unknown): ClaudeHookEventName => {
  if (typeof value !== 'string' || !EVENT_NAMES.has(value as ClaudeHookEventName)) {
    throw new Error('Claude hook event name is unsupported');
  }
  return value as ClaudeHookEventName;
};

export const getClaudeHookBridgeEndpoint = (
  userDataPath: string,
  platform: NodeJS.Platform = process.platform
): ClaudeHookBridgeEndpoint => {
  const safe = safeArgument(userDataPath, 'userData path');
  if (platform === 'win32') {
    const suffix = createHash('sha256').update(safe).digest('hex').slice(0, 16);
    return { transport: 'win32-named-pipe', path: `\\\\.\\pipe\\bitterless-claude-hook-${suffix}` };
  }
  return { transport: 'unix', path: join(safe, 'eyes-on-agents', 'claude-hook.sock') };
};

export const getClaudeHookOutboxPath = (
  userDataPath: string,
  installationId?: string
): string => {
  const root = join(safeArgument(userDataPath, 'userData path'), 'eyes-on-agents', 'claude-hook-outbox');
  return installationId === undefined
    ? root
    : join(root, parseEyesOnAgentsUuid(installationId, 'Claude installation ID'));
};

export const createClaudeHookEvent = (params: {
  rawInput: unknown;
  eventId: unknown;
  occurredAt: unknown;
}): ClaudeHookEvent => {
  if (!isEyesOnAgentsRecord(params.rawInput)) throw new Error('Claude hook input must be an object');
  const hookEventName = parseEventName(params.rawInput.hook_event_name);
  const sessionId = parseEyesOnAgentsUuid(params.rawInput.session_id, 'Claude session ID');
  const rawTranscriptPath = parseEyesOnAgentsPath(params.rawInput.transcript_path);
  const transcriptPath = rawTranscriptPath !== null && isAbsolute(rawTranscriptPath)
    ? rawTranscriptPath
    : null;
  const rawCwd = parseEyesOnAgentsPath(params.rawInput.cwd);
  const cwd = rawCwd !== null && isAbsolute(rawCwd) ? rawCwd : null;
  return {
    schemaVersion: 1,
    eventId: parseEyesOnAgentsUuid(params.eventId, 'Claude event ID'),
    occurredAt: parseEyesOnAgentsTimestamp(params.occurredAt, 'occurredAt', false) as number,
    payload: { hookEventName, sessionId, transcriptPath, cwd }
  };
};

export const parseClaudeHookEvent = (value: unknown): ClaudeHookEvent => {
  if (!isEyesOnAgentsRecord(value)) throw new Error('Claude hook event must be an object');
  exactKeys(value, ['schemaVersion', 'eventId', 'occurredAt', 'payload'], 'Claude hook event');
  if (value.schemaVersion !== 1 || !isEyesOnAgentsRecord(value.payload)) {
    throw new Error('Claude hook event version is unsupported');
  }
  exactKeys(
    value.payload,
    ['hookEventName', 'sessionId', 'transcriptPath', 'cwd'],
    'Claude hook payload'
  );
  const transcriptPath = parseEyesOnAgentsPath(value.payload.transcriptPath);
  if (transcriptPath !== null && !isAbsolute(transcriptPath)) {
    throw new Error('Claude hook transcript path must be absolute');
  }
  const cwd = parseEyesOnAgentsPath(value.payload.cwd);
  if (cwd !== null && !isAbsolute(cwd)) throw new Error('Claude hook cwd must be absolute');
  return {
    schemaVersion: 1,
    eventId: parseEyesOnAgentsUuid(value.eventId, 'Claude event ID'),
    occurredAt: parseEyesOnAgentsTimestamp(value.occurredAt, 'occurredAt', false) as number,
    payload: {
      hookEventName: parseEventName(value.payload.hookEventName),
      sessionId: parseEyesOnAgentsUuid(value.payload.sessionId, 'Claude session ID'),
      transcriptPath,
      cwd
    }
  };
};

export const parseClaudeHookDelivery = (value: unknown): ClaudeHookDelivery => {
  if (!isEyesOnAgentsRecord(value)) throw new Error('Claude hook delivery must be an object');
  exactKeys(
    value,
    ['schemaVersion', 'deliveryId', 'installationId', 'event'],
    'Claude hook delivery'
  );
  if (value.schemaVersion !== 1) throw new Error('Claude hook delivery version is unsupported');
  const deliveryId = parseEyesOnAgentsUuid(value.deliveryId, 'Claude delivery ID');
  const event = parseClaudeHookEvent(value.event);
  if (event.eventId !== deliveryId) throw new Error('Claude hook event identity is invalid');
  return {
    schemaVersion: 1,
    deliveryId,
    installationId: parseEyesOnAgentsUuid(value.installationId, 'Claude installation ID'),
    event
  };
};

export const parseClaudeHookAcknowledgement = (
  value: unknown,
  expectedDeliveryId: string
): ClaudeHookCommitAcknowledgement => {
  if (!isEyesOnAgentsRecord(value)) throw new Error('Claude hook acknowledgement must be an object');
  exactKeys(value, ['schemaVersion', 'deliveryId', 'status'], 'Claude hook acknowledgement');
  if (value.schemaVersion !== 1 || value.status !== 'committed') {
    throw new Error('Claude hook acknowledgement is unsupported');
  }
  const deliveryId = parseEyesOnAgentsUuid(value.deliveryId, 'Claude delivery ID');
  if (deliveryId !== expectedDeliveryId) throw new Error('Claude hook acknowledgement identity changed');
  return { schemaVersion: 1, deliveryId, status: 'committed' };
};

export const parseClaudeHookHelperArgs = (
  argv: readonly string[],
  platform: NodeJS.Platform = process.platform
): ClaudeHookHelperArgs => {
  const markerCount = argv.filter((value) => value === CLAUDE_HOOK_HELPER_ARG).length;
  if (markerCount !== 1) throw new Error('Claude hook helper mode must be provided exactly once');
  const start = argv.indexOf(CLAUDE_HOOK_HELPER_ARG);
  const values = new Map<string, string>();
  for (let index = start + 1; index < argv.length; index += 2) {
    const flag = argv[index];
    const raw = argv[index + 1];
    if (raw === undefined || values.has(flag)) throw new Error('Claude hook helper arguments are invalid');
    if (![CLAUDE_HOOK_SOCKET_ARG, CLAUDE_HOOK_INSTALLATION_ARG, CLAUDE_HOOK_OUTBOX_ARG].includes(flag)) {
      throw new Error('Claude hook helper argument is unsupported');
    }
    values.set(flag, safeArgument(raw, flag));
  }
  const path = values.get(CLAUDE_HOOK_SOCKET_ARG);
  const installationId = values.get(CLAUDE_HOOK_INSTALLATION_ARG);
  const outboxPath = values.get(CLAUDE_HOOK_OUTBOX_ARG);
  if (!path || !installationId || !outboxPath || values.size !== 3) {
    throw new Error('Claude hook helper arguments are incomplete');
  }
  const isAbsoluteForPlatform = platform === 'win32' ? win32.isAbsolute : isAbsolute;
  if (platform === 'win32') {
    if (!path.startsWith('\\\\.\\pipe\\') || !win32.isAbsolute(outboxPath)) {
      throw new Error('Claude hook Windows paths are invalid');
    }
  } else if (!isAbsoluteForPlatform(path) || !isAbsoluteForPlatform(outboxPath)) {
    throw new Error('Claude hook paths must be absolute');
  }
  return {
    endpoint: { transport: platform === 'win32' ? 'win32-named-pipe' : 'unix', path },
    installationId: parseEyesOnAgentsUuid(installationId, 'Claude installation ID'),
    outboxPath
  };
};
