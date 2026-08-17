import { createHash } from 'node:crypto';
import { isAbsolute, join, win32 } from 'node:path';
import type {
  CodexHookBridgeEndpoint,
  CodexHookDelivery,
  CodexHookDeliveryAck,
  CodexHookEvent,
  CodexHookEventName,
  CodexHookEventPayloadBase,
  CodexHookEventV1,
  CodexHookEventV2,
  CodexHookEventV2Payload,
  CodexHookHelperArgs,
  CodexHookMetadataOnlyDelivery,
  CodexHookMetadataOnlyEvent
} from './codexHookBridge.type';
import {
  isEyesOnAgentsRecord,
  parseEyesOnAgentsPath,
  parseEyesOnAgentsText,
  parseEyesOnAgentsUuid
} from './eyesOnAgents.contract';

export const CODEX_HOOK_BRIDGE_MAX_FRAME_BYTES = 64 * 1024;
export const CODEX_HOOK_USER_PROMPT_MAX_BYTES = 8_192;
export const CODEX_HOOK_HELPER_ARG = '--coding-agent-hook-helper';
export const CODEX_HOOK_BRIDGE_PATH_ARG = '--coding-agent-bridge-path';
export const CODEX_HOOK_PROVIDER_ARG = '--coding-agent-provider';
export const CODEX_HOOK_INSTALLATION_ID_ARG = '--coding-agent-installation-id';
export const CODEX_HOOK_OUTBOX_PATH_ARG = '--coding-agent-outbox-path';

const CODEX_EVENTS = new Set<CodexHookEventName>([
  'SessionStart',
  'UserPromptSubmit',
  'PermissionRequest',
  'Stop'
]);
const CONTROL_CHARACTER_PATTERN = /[\0\r\n]/;
const NUL_CHARACTER_PATTERN = /\0/;
const UTF8_ENCODER = new TextEncoder();
const BASE_EVENT_PAYLOAD_KEYS = ['cwd', 'hookEventName', 'sessionId', 'turnId'] as const;
const EVENT_ENVELOPE_KEYS = [
  'eventId',
  'installationId',
  'occurredAt',
  'payload',
  'schemaVersion'
] as const;

const hasOwn = (value: Record<string, unknown>, key: string): boolean => {
  return Object.prototype.hasOwnProperty.call(value, key);
};

const hasExactKeys = (
  value: Record<string, unknown>,
  keys: readonly string[]
): boolean => {
  return Object.keys(value).sort().join(',') === [...keys].sort().join(',');
};

const assertSafeArgument = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !value || CONTROL_CHARACTER_PATTERN.test(value)) {
    throw new Error(`${label} must be a non-empty single-line string`);
  }
  return value;
};

const parseEventName = (value: unknown): CodexHookEventName => {
  if (typeof value !== 'string' || !CODEX_EVENTS.has(value as CodexHookEventName)) {
    throw new Error('Unsupported Codex hook event');
  }
  return value as CodexHookEventName;
};

const parseTurnId = (value: unknown): string | null => {
  return parseEyesOnAgentsText(value, 'turn_id', 200);
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

const parseEventIdentity = (params: {
  rawInput: Record<string, unknown>;
  installationId: unknown;
  eventId: unknown;
  occurredAt: unknown;
}): {
  installationId: string;
  eventId: string;
  occurredAt: number;
  payload: CodexHookEventPayloadBase;
} => {
  if (!Number.isSafeInteger(params.occurredAt) || (params.occurredAt as number) < 0) {
    throw new Error('occurredAt must be a non-negative integer');
  }
  return {
    installationId: parseEyesOnAgentsUuid(params.installationId, 'installationId'),
    eventId: parseEyesOnAgentsUuid(params.eventId, 'eventId'),
    occurredAt: params.occurredAt as number,
    payload: {
      sessionId: parseEyesOnAgentsUuid(params.rawInput.session_id, 'session_id'),
      cwd: parseEyesOnAgentsPath(params.rawInput.cwd),
      hookEventName: parseEventName(params.rawInput.hook_event_name),
      turnId: parseTurnId(params.rawInput.turn_id)
    }
  };
};

const parsePromptPreview = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('userPromptPreview must be a non-empty string');
  }
  if (NUL_CHARACTER_PATTERN.test(value) || hasUnpairedSurrogate(value)) {
    throw new Error('userPromptPreview contains a forbidden character');
  }
  if (UTF8_ENCODER.encode(value).byteLength > CODEX_HOOK_USER_PROMPT_MAX_BYTES) {
    throw new Error(
      `userPromptPreview must be at most ${CODEX_HOOK_USER_PROMPT_MAX_BYTES} UTF-8 bytes`
    );
  }
  return value;
};

const toV2MetadataPayload = (
  payload: CodexHookEventPayloadBase
): CodexHookEventV2Payload => {
  const base = {
    sessionId: payload.sessionId,
    cwd: payload.cwd,
    turnId: payload.turnId
  };
  if (payload.hookEventName === 'UserPromptSubmit') {
    return { ...base, hookEventName: 'UserPromptSubmit' };
  }
  if (payload.hookEventName === 'PermissionRequest') {
    return { ...base, hookEventName: 'PermissionRequest' };
  }
  if (payload.hookEventName === 'Stop') {
    return { ...base, hookEventName: 'Stop' };
  }
  return { ...base, hookEventName: 'SessionStart' };
};

export const boundCodexHookUserPrompt = (
  value: unknown
): { userPromptPreview: string; userPromptTruncated: boolean } | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized || NUL_CHARACTER_PATTERN.test(normalized) || hasUnpairedSurrogate(normalized)) {
    return null;
  }
  const characters: string[] = [];
  let byteLength = 0;
  let userPromptTruncated = false;
  for (const character of normalized) {
    const characterBytes = UTF8_ENCODER.encode(character).byteLength;
    if (byteLength + characterBytes > CODEX_HOOK_USER_PROMPT_MAX_BYTES) {
      userPromptTruncated = true;
      break;
    }
    characters.push(character);
    byteLength += characterBytes;
  }
  return {
    userPromptPreview: characters.join(''),
    userPromptTruncated
  };
};

export const getCodexHookBridgeEndpoint = (
  userDataPath: string,
  platform: NodeJS.Platform = process.platform
): CodexHookBridgeEndpoint => {
  const safePath = assertSafeArgument(userDataPath, 'userData path');
  if (platform === 'win32') {
    const suffix = createHash('sha1').update(safePath).digest('hex').slice(0, 12);
    return {
      transport: 'win32-named-pipe',
      path: `\\\\.\\pipe\\bitterless-coding-agent-${suffix}`
    };
  }
  return { transport: 'unix', path: join(safePath, 'coding-agent', 'bridge.sock') };
};

export const parseCodexHookHelperArgs = (
  argv: string[],
  platform: NodeJS.Platform = process.platform
): CodexHookHelperArgs => {
  const helperIndexes = argv.flatMap((value, index) =>
    value === CODEX_HOOK_HELPER_ARG ? [index] : []
  );
  if (helperIndexes.length !== 1) {
    throw new Error(`${CODEX_HOOK_HELPER_ARG} must be provided exactly once`);
  }
  const knownFlags = new Set([
    CODEX_HOOK_BRIDGE_PATH_ARG,
    CODEX_HOOK_PROVIDER_ARG,
    CODEX_HOOK_INSTALLATION_ID_ARG,
    CODEX_HOOK_OUTBOX_PATH_ARG
  ]);
  const values = new Map<string, string>();
  for (let index = helperIndexes[0] + 1; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!knownFlags.has(flag)) throw new Error(`Unknown Codex hook helper argument: ${flag}`);
    if (values.has(flag)) throw new Error(`${flag} may be provided only once`);
    const next = argv[index + 1];
    if (next === undefined || knownFlags.has(next) || next === CODEX_HOOK_HELPER_ARG) {
      throw new Error(`${flag} requires a value`);
    }
    values.set(flag, assertSafeArgument(next, flag));
    index += 1;
  }
  for (const flag of [
    CODEX_HOOK_BRIDGE_PATH_ARG,
    CODEX_HOOK_INSTALLATION_ID_ARG,
    CODEX_HOOK_OUTBOX_PATH_ARG
  ]) {
    if (!values.has(flag)) throw new Error(`${flag} is required`);
  }
  const provider = values.get(CODEX_HOOK_PROVIDER_ARG);
  if (provider !== undefined && provider !== 'codex') {
    throw new Error(`${CODEX_HOOK_PROVIDER_ARG} only accepts codex`);
  }
  const path = values.get(CODEX_HOOK_BRIDGE_PATH_ARG) as string;
  const installationId = parseEyesOnAgentsUuid(
    values.get(CODEX_HOOK_INSTALLATION_ID_ARG),
    'installationId'
  );
  const outboxPath = values.get(CODEX_HOOK_OUTBOX_PATH_ARG) as string;
  if (platform === 'win32') {
    if (!path.startsWith('\\\\.\\pipe\\')) {
      throw new Error(`${CODEX_HOOK_BRIDGE_PATH_ARG} must be a local Windows named pipe`);
    }
    if (!win32.isAbsolute(outboxPath)) {
      throw new Error(`${CODEX_HOOK_OUTBOX_PATH_ARG} must be an absolute Windows path`);
    }
    return {
      endpoint: { transport: 'win32-named-pipe', path },
      installationId,
      outboxPath
    };
  }
  if (!path.startsWith('/')) {
    throw new Error(`${CODEX_HOOK_BRIDGE_PATH_ARG} must be an absolute Unix socket path`);
  }
  if (!isAbsolute(outboxPath)) {
    throw new Error(`${CODEX_HOOK_OUTBOX_PATH_ARG} must be an absolute Unix path`);
  }
  return { endpoint: { transport: 'unix', path }, installationId, outboxPath };
};

export const getCodexHookOutboxPath = (userDataPath: string): string => {
  return join(assertSafeArgument(userDataPath, 'userData path'), 'eyes-on-agents', 'codex-hook-outbox');
};

export const createCodexHookEvent = (params: {
  rawInput: unknown;
  installationId: string;
  eventId: string;
  occurredAt: number;
}): CodexHookEventV1 => {
  if (!isEyesOnAgentsRecord(params.rawInput)) throw new Error('Hook input must be an object');
  const parsed = parseEventIdentity({ ...params, rawInput: params.rawInput });
  return {
    schemaVersion: 1,
    installationId: parsed.installationId,
    eventId: parsed.eventId,
    occurredAt: parsed.occurredAt,
    payload: parsed.payload
  };
};

export const createCodexHookEventV2 = (params: {
  rawInput: unknown;
  installationId: string;
  eventId: string;
  occurredAt: number;
  captureUserPrompt: boolean;
}): CodexHookEventV2 => {
  if (!isEyesOnAgentsRecord(params.rawInput)) throw new Error('Hook input must be an object');
  const parsed = parseEventIdentity({ ...params, rawInput: params.rawInput });
  if (parsed.payload.hookEventName !== 'UserPromptSubmit') {
    return {
      schemaVersion: 2,
      installationId: parsed.installationId,
      eventId: parsed.eventId,
      occurredAt: parsed.occurredAt,
      payload: toV2MetadataPayload(parsed.payload)
    };
  }
  let prompt: ReturnType<typeof boundCodexHookUserPrompt> = null;
  if (params.captureUserPrompt) {
    try {
      prompt = boundCodexHookUserPrompt(params.rawInput.prompt);
    } catch {
      prompt = null;
    }
  }
  return {
    schemaVersion: 2,
    installationId: parsed.installationId,
    eventId: parsed.eventId,
    occurredAt: parsed.occurredAt,
    payload: prompt
      ? {
          ...parsed.payload,
          hookEventName: 'UserPromptSubmit',
          userPromptPreview: prompt.userPromptPreview,
          userPromptTruncated: prompt.userPromptTruncated
        }
      : {
          ...parsed.payload,
          hookEventName: 'UserPromptSubmit'
        }
  };
};

export const parseCodexHookEvent = (value: unknown): CodexHookEvent => {
  if (
    !isEyesOnAgentsRecord(value) ||
    (value.schemaVersion !== 1 && value.schemaVersion !== 2) ||
    !isEyesOnAgentsRecord(value.payload)
  ) {
    throw new Error('Invalid Codex hook envelope');
  }
  if (!hasExactKeys(value, EVENT_ENVELOPE_KEYS)) {
    throw new Error('Codex hook envelope contains unsupported fields');
  }
  const parsed = parseEventIdentity({
    rawInput: {
      session_id: value.payload.sessionId,
      cwd: value.payload.cwd,
      hook_event_name: value.payload.hookEventName,
      turn_id: value.payload.turnId
    },
    installationId: value.installationId as string,
    eventId: value.eventId as string,
    occurredAt: value.occurredAt as number
  });
  if (value.schemaVersion === 1) {
    if (!hasExactKeys(value.payload, BASE_EVENT_PAYLOAD_KEYS)) {
      throw new Error('Codex hook envelope contains unsupported fields');
    }
    return {
      schemaVersion: 1,
      installationId: parsed.installationId,
      eventId: parsed.eventId,
      occurredAt: parsed.occurredAt,
      payload: parsed.payload
    };
  }
  const hasPreview = hasOwn(value.payload, 'userPromptPreview');
  const hasTruncated = hasOwn(value.payload, 'userPromptTruncated');
  const hasPromptFields = hasPreview || hasTruncated;
  const expectedKeys = hasPromptFields
    ? [...BASE_EVENT_PAYLOAD_KEYS, 'userPromptPreview', 'userPromptTruncated']
    : BASE_EVENT_PAYLOAD_KEYS;
  if (!hasExactKeys(value.payload, expectedKeys)) {
    throw new Error('Codex hook envelope contains unsupported fields');
  }
  if (hasPreview !== hasTruncated) {
    throw new Error('Codex hook prompt fields must be provided together');
  }
  if (parsed.payload.hookEventName !== 'UserPromptSubmit') {
    if (hasPromptFields) {
      throw new Error('Codex hook prompt fields are only allowed for UserPromptSubmit');
    }
    return {
      schemaVersion: 2,
      installationId: parsed.installationId,
      eventId: parsed.eventId,
      occurredAt: parsed.occurredAt,
      payload: toV2MetadataPayload(parsed.payload)
    };
  }
  if (!hasPromptFields) {
    return {
      schemaVersion: 2,
      installationId: parsed.installationId,
      eventId: parsed.eventId,
      occurredAt: parsed.occurredAt,
      payload: {
        ...parsed.payload,
        hookEventName: 'UserPromptSubmit'
      }
    };
  }
  if (typeof value.payload.userPromptTruncated !== 'boolean') {
    throw new Error('userPromptTruncated must be a boolean');
  }
  return {
    schemaVersion: 2,
    installationId: parsed.installationId,
    eventId: parsed.eventId,
    occurredAt: parsed.occurredAt,
    payload: {
      ...parsed.payload,
      hookEventName: 'UserPromptSubmit',
      userPromptPreview: parsePromptPreview(value.payload.userPromptPreview),
      userPromptTruncated: value.payload.userPromptTruncated
    }
  };
};

export const toMetadataOnlyCodexHookEvent = (
  value: CodexHookEvent
): CodexHookMetadataOnlyEvent => {
  const event = parseCodexHookEvent(value);
  const payload: CodexHookEventPayloadBase = {
    sessionId: event.payload.sessionId,
    cwd: event.payload.cwd,
    hookEventName: event.payload.hookEventName,
    turnId: event.payload.turnId
  };
  if (event.schemaVersion === 1) {
    return {
      schemaVersion: 1,
      installationId: event.installationId,
      eventId: event.eventId,
      occurredAt: event.occurredAt,
      payload
    };
  }
  return {
    schemaVersion: 2,
    installationId: event.installationId,
    eventId: event.eventId,
    occurredAt: event.occurredAt,
    payload
  };
};

export const createCodexHookDelivery = (params: {
  deliveryId: string;
  event: CodexHookEvent;
}): CodexHookDelivery => {
  return {
    schemaVersion: 1,
    deliveryId: parseEyesOnAgentsUuid(params.deliveryId, 'deliveryId'),
    event: parseCodexHookEvent(params.event)
  };
};

export const parseCodexHookDelivery = (value: unknown): CodexHookDelivery => {
  if (
    !isEyesOnAgentsRecord(value) ||
    value.schemaVersion !== 1 ||
    Object.keys(value).sort().join(',') !== 'deliveryId,event,schemaVersion'
  ) {
    throw new Error('Invalid Codex hook delivery envelope');
  }
  return createCodexHookDelivery({
    deliveryId: value.deliveryId as string,
    event: value.event as CodexHookEvent
  });
};

export const toMetadataOnlyCodexHookDelivery = (
  value: CodexHookDelivery
): CodexHookMetadataOnlyDelivery => {
  const delivery = parseCodexHookDelivery(value);
  return {
    schemaVersion: 1,
    deliveryId: delivery.deliveryId,
    event: toMetadataOnlyCodexHookEvent(delivery.event)
  };
};

export const parseCodexHookMetadataOnlyDelivery = (
  value: unknown
): CodexHookMetadataOnlyDelivery => {
  const delivery = parseCodexHookDelivery(value);
  if (
    delivery.event.schemaVersion === 2 &&
    (
      hasOwn(delivery.event.payload, 'userPromptPreview') ||
      hasOwn(delivery.event.payload, 'userPromptTruncated')
    )
  ) {
    throw new Error('Offline Codex hook deliveries must be metadata-only');
  }
  return toMetadataOnlyCodexHookDelivery(delivery);
};

export const parseCodexHookDeliveryAck = (value: unknown): CodexHookDeliveryAck => {
  if (
    !isEyesOnAgentsRecord(value) ||
    value.status !== 'committed' ||
    Object.keys(value).length !== 1
  ) {
    throw new Error('Invalid Codex hook delivery acknowledgement');
  }
  return { status: 'committed' };
};

const shellQuote = (value: string): string => {
  const safe = assertSafeArgument(value, 'POSIX shim argument');
  return `'${safe.replace(/'/g, `'\\''`)}'`;
};

const windowsQuote = (value: string): string => {
  const safe = assertSafeArgument(value, 'Windows shim argument');
  if (safe.includes('"')) throw new Error('Windows shim arguments cannot contain quotes');
  return `"${safe.replace(/%/g, '%%')}"`;
};

export const createCodexHookCommand = (
  shimPath: string,
  platform: NodeJS.Platform = process.platform
): string => platform === 'win32' ? windowsQuote(shimPath) : shellQuote(shimPath);

export const createCodexHookHelperArguments = (
  endpointPath: string,
  installationId: string,
  outboxPath: string
): string[] => [
  CODEX_HOOK_HELPER_ARG,
  CODEX_HOOK_BRIDGE_PATH_ARG,
  assertSafeArgument(endpointPath, 'endpoint path'),
  CODEX_HOOK_PROVIDER_ARG,
  'codex',
  CODEX_HOOK_INSTALLATION_ID_ARG,
  parseEyesOnAgentsUuid(installationId, 'installationId'),
  CODEX_HOOK_OUTBOX_PATH_ARG,
  assertSafeArgument(outboxPath, 'outbox path')
];

export const createCodexHookShim = (params: {
  execPath: string;
  helperPath: string;
  endpointPath: string;
  installationId: string;
  outboxPath: string;
  platform?: NodeJS.Platform;
}): string => {
  const platform = params.platform ?? process.platform;
  const quote = platform === 'win32' ? windowsQuote : shellQuote;
  const command = [
    quote(params.execPath),
    quote(params.helperPath),
    ...createCodexHookHelperArguments(
      params.endpointPath,
      params.installationId,
      params.outboxPath
    ).map(quote)
  ].join(' ');
  return platform === 'win32'
    ? `@echo off\r\nsetlocal DisableDelayedExpansion\r\nset "ELECTRON_RUN_AS_NODE=1"\r\n${command} >nul 2>nul\r\nexit /b 0\r\n`
    : `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 ${command} >/dev/null 2>/dev/null || true\nexit 0\n`;
};
