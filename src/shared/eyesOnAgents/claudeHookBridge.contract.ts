import { createHash } from 'node:crypto';
import { isAbsolute, join, win32 } from 'node:path';
import type {
  ClaudeHookBridgeEndpoint,
  ClaudeHookCommitAcknowledgement,
  ClaudeHookDelivery,
  ClaudeHookEvent,
  ClaudeHookEventName,
  ClaudeHookEventPayloadBase,
  ClaudeHookEventV1,
  ClaudeHookEventV2,
  ClaudeHookEventV2Payload,
  ClaudeHookHelperArgs,
  ClaudeHookMetadataOnlyDelivery,
  ClaudeHookMetadataOnlyEvent
} from './claudeHookBridge.type';
import {
  isEyesOnAgentsRecord,
  parseEyesOnAgentsPath,
  parseEyesOnAgentsTimestamp,
  parseEyesOnAgentsUuid
} from './eyesOnAgents.contract';

export const CLAUDE_HOOK_LIVE_MAX_FRAME_BYTES = 64 * 1024;
export const CLAUDE_HOOK_OFFLINE_MAX_FILE_BYTES = 16 * 1024;
export const CLAUDE_HOOK_USER_PROMPT_MAX_BYTES = 8_192;
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
const NUL = /\0/;
const UTF8_ENCODER = new TextEncoder();
const BASE_PAYLOAD_KEYS = ['hookEventName', 'sessionId', 'transcriptPath', 'cwd'] as const;

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

const hasOwn = (value: Record<string, unknown>, key: string): boolean => {
  return Object.prototype.hasOwnProperty.call(value, key);
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

const parsePromptPreview = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Claude userPromptPreview must be a non-empty string');
  }
  if (NUL.test(value) || hasUnpairedSurrogate(value)) {
    throw new Error('Claude userPromptPreview contains a forbidden character');
  }
  if (UTF8_ENCODER.encode(value).byteLength > CLAUDE_HOOK_USER_PROMPT_MAX_BYTES) {
    throw new Error('Claude userPromptPreview is too large');
  }
  return value;
};

export const boundClaudeHookUserPrompt = (
  value: unknown
): { userPromptPreview: string; userPromptTruncated: boolean } | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized || NUL.test(normalized) || hasUnpairedSurrogate(normalized)) return null;
  const characters: string[] = [];
  let byteLength = 0;
  let userPromptTruncated = false;
  for (const character of normalized) {
    const characterBytes = UTF8_ENCODER.encode(character).byteLength;
    if (byteLength + characterBytes > CLAUDE_HOOK_USER_PROMPT_MAX_BYTES) {
      userPromptTruncated = true;
      break;
    }
    characters.push(character);
    byteLength += characterBytes;
  }
  return { userPromptPreview: characters.join(''), userPromptTruncated };
};

const parseEventIdentity = (params: {
  rawInput: Record<string, unknown>;
  eventId: unknown;
  occurredAt: unknown;
}): {
  eventId: string;
  occurredAt: number;
  payload: ClaudeHookEventPayloadBase;
} => {
  const hookEventName = parseEventName(params.rawInput.hook_event_name);
  const sessionId = parseEyesOnAgentsUuid(params.rawInput.session_id, 'Claude session ID');
  const rawTranscriptPath = parseEyesOnAgentsPath(params.rawInput.transcript_path);
  const transcriptPath = rawTranscriptPath !== null && isAbsolute(rawTranscriptPath)
    ? rawTranscriptPath
    : null;
  const rawCwd = parseEyesOnAgentsPath(params.rawInput.cwd);
  const cwd = rawCwd !== null && isAbsolute(rawCwd) ? rawCwd : null;
  return {
    eventId: parseEyesOnAgentsUuid(params.eventId, 'Claude event ID'),
    occurredAt: parseEyesOnAgentsTimestamp(params.occurredAt, 'occurredAt', false) as number,
    payload: { hookEventName, sessionId, transcriptPath, cwd }
  };
};

const toV2MetadataPayload = (
  payload: ClaudeHookEventPayloadBase
): ClaudeHookEventV2Payload => ({ ...payload }) as ClaudeHookEventV2Payload;

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
}): ClaudeHookEventV1 => {
  if (!isEyesOnAgentsRecord(params.rawInput)) throw new Error('Claude hook input must be an object');
  const parsed = parseEventIdentity({ ...params, rawInput: params.rawInput });
  return {
    schemaVersion: 1,
    eventId: parsed.eventId,
    occurredAt: parsed.occurredAt,
    payload: parsed.payload
  };
};

export const createClaudeHookEventV2 = (params: {
  rawInput: unknown;
  eventId: unknown;
  occurredAt: unknown;
  captureUserPrompt: boolean;
}): ClaudeHookEventV2 => {
  if (!isEyesOnAgentsRecord(params.rawInput)) throw new Error('Claude hook input must be an object');
  const parsed = parseEventIdentity({ ...params, rawInput: params.rawInput });
  if (parsed.payload.hookEventName !== 'UserPromptSubmit') {
    return { schemaVersion: 2, ...parsed, payload: toV2MetadataPayload(parsed.payload) };
  }
  const prompt = params.captureUserPrompt
    ? boundClaudeHookUserPrompt(params.rawInput.prompt)
    : null;
  return {
    schemaVersion: 2,
    eventId: parsed.eventId,
    occurredAt: parsed.occurredAt,
    payload: prompt
      ? { ...parsed.payload, hookEventName: 'UserPromptSubmit', ...prompt }
      : { ...parsed.payload, hookEventName: 'UserPromptSubmit' }
  };
};

export const parseClaudeHookEvent = (value: unknown): ClaudeHookEvent => {
  if (!isEyesOnAgentsRecord(value)) throw new Error('Claude hook event must be an object');
  exactKeys(value, ['schemaVersion', 'eventId', 'occurredAt', 'payload'], 'Claude hook event');
  if ((value.schemaVersion !== 1 && value.schemaVersion !== 2) || !isEyesOnAgentsRecord(value.payload)) {
    throw new Error('Claude hook event version is unsupported');
  }
  const hasPreview = hasOwn(value.payload, 'userPromptPreview');
  const hasTruncated = hasOwn(value.payload, 'userPromptTruncated');
  const hasPromptFields = hasPreview || hasTruncated;
  exactKeys(value.payload, hasPromptFields
    ? [...BASE_PAYLOAD_KEYS, 'userPromptPreview', 'userPromptTruncated']
    : [...BASE_PAYLOAD_KEYS], 'Claude hook payload');
  if (value.schemaVersion === 1 && hasPromptFields) {
    throw new Error('Claude V1 hook events must be metadata-only');
  }
  if (hasPreview !== hasTruncated) {
    throw new Error('Claude hook prompt fields must be provided together');
  }
  const transcriptPath = parseEyesOnAgentsPath(value.payload.transcriptPath);
  if (transcriptPath !== null && !isAbsolute(transcriptPath)) {
    throw new Error('Claude hook transcript path must be absolute');
  }
  const cwd = parseEyesOnAgentsPath(value.payload.cwd);
  if (cwd !== null && !isAbsolute(cwd)) throw new Error('Claude hook cwd must be absolute');
  const payload: ClaudeHookEventPayloadBase = {
    hookEventName: parseEventName(value.payload.hookEventName),
    sessionId: parseEyesOnAgentsUuid(value.payload.sessionId, 'Claude session ID'),
    transcriptPath,
    cwd
  };
  if (hasPromptFields && payload.hookEventName !== 'UserPromptSubmit') {
    throw new Error('Claude hook prompt fields are only allowed for UserPromptSubmit');
  }
  if (value.schemaVersion === 1) return {
    schemaVersion: 1,
    eventId: parseEyesOnAgentsUuid(value.eventId, 'Claude event ID'),
    occurredAt: parseEyesOnAgentsTimestamp(value.occurredAt, 'occurredAt', false) as number,
    payload
  };
  if (!hasPromptFields) return {
    schemaVersion: 2,
    eventId: parseEyesOnAgentsUuid(value.eventId, 'Claude event ID'),
    occurredAt: parseEyesOnAgentsTimestamp(value.occurredAt, 'occurredAt', false) as number,
    payload: toV2MetadataPayload(payload)
  };
  if (typeof value.payload.userPromptTruncated !== 'boolean') {
    throw new Error('Claude userPromptTruncated must be a boolean');
  }
  return {
    schemaVersion: 2,
    eventId: parseEyesOnAgentsUuid(value.eventId, 'Claude event ID'),
    occurredAt: parseEyesOnAgentsTimestamp(value.occurredAt, 'occurredAt', false) as number,
    payload: {
      ...payload,
      hookEventName: 'UserPromptSubmit',
      userPromptPreview: parsePromptPreview(value.payload.userPromptPreview),
      userPromptTruncated: value.payload.userPromptTruncated
    }
  };
};

export const toMetadataOnlyClaudeHookEvent = (
  value: ClaudeHookEvent
): ClaudeHookMetadataOnlyEvent => {
  const event = parseClaudeHookEvent(value);
  return {
    schemaVersion: event.schemaVersion,
    eventId: event.eventId,
    occurredAt: event.occurredAt,
    payload: {
      hookEventName: event.payload.hookEventName,
      sessionId: event.payload.sessionId,
      transcriptPath: event.payload.transcriptPath,
      cwd: event.payload.cwd
    }
  } as ClaudeHookMetadataOnlyEvent;
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

export const toMetadataOnlyClaudeHookDelivery = (
  value: ClaudeHookDelivery
): ClaudeHookMetadataOnlyDelivery => {
  const delivery = parseClaudeHookDelivery(value);
  return {
    schemaVersion: 1,
    deliveryId: delivery.deliveryId,
    installationId: delivery.installationId,
    event: toMetadataOnlyClaudeHookEvent(delivery.event)
  };
};

export const parseClaudeHookMetadataOnlyDelivery = (
  value: unknown
): ClaudeHookMetadataOnlyDelivery => {
  const delivery = parseClaudeHookDelivery(value);
  if (
    delivery.event.schemaVersion === 2 &&
    (hasOwn(delivery.event.payload, 'userPromptPreview') ||
      hasOwn(delivery.event.payload, 'userPromptTruncated'))
  ) {
    throw new Error('Offline Claude hook deliveries must be metadata-only');
  }
  return toMetadataOnlyClaudeHookDelivery(delivery);
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
