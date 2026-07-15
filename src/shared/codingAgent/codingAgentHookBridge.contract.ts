import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type {
  CodingAgentBridgeEndpoint,
  CodingAgentHookEvent,
  CodingAgentHookEventName,
  CodingAgentHookHelperArgs,
  CodingAgentHookNotificationType,
  CodingAgentHookStatusEvidence
} from './codingAgentHookBridge.type';
import type { CodingAgentProvider } from './codingAgentSession.type';
import {
  isPlainRecord,
  parsePathText,
  parseProvider,
  parseUuid
} from './codingAgentSession.contract';

export const CODING_AGENT_BRIDGE_MAX_FRAME_BYTES = 64 * 1024;
export const CODING_AGENT_HOOK_HELPER_ARG = '--coding-agent-hook-helper';
export const CODING_AGENT_BRIDGE_PATH_ARG = '--coding-agent-bridge-path';
export const CODING_AGENT_PROVIDER_ARG = '--coding-agent-provider';
export const CODING_AGENT_INSTALLATION_ID_ARG = '--coding-agent-installation-id';

const CODEX_EVENTS = new Set<CodingAgentHookEventName>([
  'SessionStart',
  'UserPromptSubmit',
  'PermissionRequest',
  'Stop'
]);
const CLAUDE_EVENTS = new Set<CodingAgentHookEventName>([
  'SessionStart',
  'UserPromptSubmit',
  'PermissionRequest',
  'Notification',
  'Stop',
  'StopFailure',
  'SessionEnd'
]);
const NOTIFICATION_TYPES = new Set<CodingAgentHookNotificationType>([
  'permission_prompt',
  'idle_prompt'
]);
const CONTROL_CHARACTER_PATTERN = /[\0\r\n]/;

const assertSafeArgument = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !value || CONTROL_CHARACTER_PATTERN.test(value)) {
    throw new Error(`${label} must be a non-empty single-line string`);
  }
  return value;
};

const parseOpaqueId = (value: unknown, label: string): string | null => {
  if (value === undefined || value === null) return null;
  const text = assertSafeArgument(value, label);
  if (text.length > 200) throw new Error(`${label} must be at most 200 characters`);
  return text;
};

const parseEventName = (
  value: unknown,
  provider: CodingAgentProvider
): CodingAgentHookEventName => {
  if (typeof value !== 'string') throw new Error('hook_event_name must be a string');
  const allowed = provider === 'codex' ? CODEX_EVENTS : CLAUDE_EVENTS;
  if (!allowed.has(value as CodingAgentHookEventName)) {
    throw new Error(`Unsupported ${provider} hook event`);
  }
  return value as CodingAgentHookEventName;
};

const parseNotificationType = (
  value: unknown,
  eventName: CodingAgentHookEventName
): CodingAgentHookNotificationType | null => {
  if (eventName !== 'Notification') return null;
  if (
    typeof value !== 'string' ||
    !NOTIFICATION_TYPES.has(value as CodingAgentHookNotificationType)
  ) {
    throw new Error('Unsupported Claude notification type');
  }
  return value as CodingAgentHookNotificationType;
};

export const getCodingAgentBridgeEndpoint = (
  userDataPath: string,
  platform: NodeJS.Platform = process.platform
): CodingAgentBridgeEndpoint => {
  const safeUserDataPath = assertSafeArgument(userDataPath, 'userData path');
  if (platform === 'win32') {
    const suffix = createHash('sha1').update(safeUserDataPath).digest('hex').slice(0, 12);
    return {
      transport: 'win32-named-pipe',
      path: `\\\\.\\pipe\\bitterless-coding-agent-${suffix}`
    };
  }
  return {
    transport: 'unix',
    path: join(safeUserDataPath, 'coding-agent', 'bridge.sock')
  };
};

export const parseCodingAgentHookHelperArgs = (
  argv: string[],
  platform: NodeJS.Platform = process.platform
): CodingAgentHookHelperArgs => {
  const helperIndexes = argv.flatMap((value, index) =>
    value === CODING_AGENT_HOOK_HELPER_ARG ? [index] : []
  );
  if (helperIndexes.length !== 1) {
    throw new Error(`${CODING_AGENT_HOOK_HELPER_ARG} must be provided exactly once`);
  }
  const knownFlags = new Set([
    CODING_AGENT_BRIDGE_PATH_ARG,
    CODING_AGENT_PROVIDER_ARG,
    CODING_AGENT_INSTALLATION_ID_ARG
  ]);
  const values = new Map<string, string>();
  for (let index = helperIndexes[0] + 1; index < argv.length; index += 1) {
    const flag = argv[index];
    if ([...knownFlags].some((known) => flag.startsWith(`${known}=`))) {
      throw new Error(`${flag.split('=')[0]} must be followed by a separate argument`);
    }
    if (!knownFlags.has(flag)) throw new Error(`Unknown coding-agent helper argument: ${flag}`);
    if (values.has(flag)) throw new Error(`${flag} may be provided only once`);
    const next = argv[index + 1];
    if (next === undefined || knownFlags.has(next) || next === CODING_AGENT_HOOK_HELPER_ARG) {
      throw new Error(`${flag} requires a value`);
    }
    values.set(flag, assertSafeArgument(next, flag));
    index += 1;
  }
  for (const flag of knownFlags) {
    if (!values.has(flag)) throw new Error(`${flag} is required`);
  }

  const path = values.get(CODING_AGENT_BRIDGE_PATH_ARG) as string;
  const provider = parseProvider(values.get(CODING_AGENT_PROVIDER_ARG));
  const installationId = parseUuid(
    values.get(CODING_AGENT_INSTALLATION_ID_ARG),
    'installationId'
  );
  if (platform === 'win32') {
    if (!path.startsWith('\\\\.\\pipe\\')) {
      throw new Error(`${CODING_AGENT_BRIDGE_PATH_ARG} must be a local Windows named pipe`);
    }
    return { endpoint: { transport: 'win32-named-pipe', path }, provider, installationId };
  }
  if (!path.startsWith('/')) {
    throw new Error(`${CODING_AGENT_BRIDGE_PATH_ARG} must be an absolute Unix socket path`);
  }
  return { endpoint: { transport: 'unix', path }, provider, installationId };
};

export const createCodingAgentHookEvent = (params: {
  rawInput: unknown;
  provider: CodingAgentProvider;
  installationId: string;
  eventId: string;
  occurredAt: number;
}): CodingAgentHookEvent => {
  if (!isPlainRecord(params.rawInput)) throw new Error('Hook input must be a JSON object');
  const provider = parseProvider(params.provider);
  const hookEventName = parseEventName(params.rawInput.hook_event_name, provider);
  const notificationType = parseNotificationType(
    params.rawInput.notification_type,
    hookEventName
  );
  if (!Number.isSafeInteger(params.occurredAt) || params.occurredAt < 0) {
    throw new Error('occurredAt must be a non-negative integer');
  }
  return {
    schemaVersion: 1,
    provider,
    installationId: parseUuid(params.installationId, 'installationId'),
    eventId: parseUuid(params.eventId, 'eventId'),
    occurredAt: params.occurredAt,
    payload: {
      sessionId: parseUuid(params.rawInput.session_id, 'session_id'),
      cwd: parsePathText(params.rawInput.cwd),
      hookEventName,
      turnId: provider === 'codex' ? parseOpaqueId(params.rawInput.turn_id, 'turn_id') : null,
      notificationType
    }
  };
};

export const parseCodingAgentHookEvent = (value: unknown): CodingAgentHookEvent => {
  if (!isPlainRecord(value) || value.schemaVersion !== 1 || !isPlainRecord(value.payload)) {
    throw new Error('Invalid coding-agent hook envelope');
  }
  const envelopeKeys = Object.keys(value).sort().join(',');
  const payloadKeys = Object.keys(value.payload).sort().join(',');
  if (
    envelopeKeys !== 'eventId,installationId,occurredAt,payload,provider,schemaVersion' ||
    payloadKeys !== 'cwd,hookEventName,notificationType,sessionId,turnId'
  ) {
    throw new Error('Coding-agent hook envelope contains unsupported fields');
  }
  return createCodingAgentHookEvent({
    rawInput: {
      session_id: value.payload.sessionId,
      cwd: value.payload.cwd,
      hook_event_name: value.payload.hookEventName,
      turn_id: value.payload.turnId,
      notification_type: value.payload.notificationType
    },
    provider: parseProvider(value.provider),
    installationId: parseUuid(value.installationId, 'installationId'),
    eventId: parseUuid(value.eventId, 'eventId'),
    occurredAt: value.occurredAt as number
  });
};

export const normalizeCodingAgentHookEvent = (
  event: CodingAgentHookEvent
): CodingAgentHookStatusEvidence => {
  const { hookEventName, notificationType } = event.payload;
  let state: CodingAgentHookStatusEvidence['state'];
  let lastTurnState: CodingAgentHookStatusEvidence['lastTurnState'];
  if (hookEventName === 'UserPromptSubmit') {
    state = 'working';
    lastTurnState = 'in_progress';
  } else if (
    hookEventName === 'PermissionRequest' ||
    (hookEventName === 'Notification' && notificationType === 'permission_prompt')
  ) {
    state = 'waiting_approval';
    lastTurnState = 'in_progress';
  } else if (hookEventName === 'StopFailure') {
    state = 'failed';
    lastTurnState = 'failed';
  } else if (hookEventName === 'SessionEnd') {
    state = 'ended';
    lastTurnState = null;
  } else if (
    hookEventName === 'Stop' ||
    (hookEventName === 'Notification' && notificationType === 'idle_prompt')
  ) {
    state = 'idle';
    lastTurnState = 'completed';
  } else {
    state = 'idle';
    lastTurnState = null;
  }
  return {
    provider: event.provider,
    externalSessionId: event.payload.sessionId,
    cwd: event.payload.cwd,
    state,
    lastTurnState,
    providerState: `hook:${hookEventName}${notificationType ? `:${notificationType}` : ''}`,
    statusSource: event.provider === 'codex' ? 'codex-hook' : 'claude-hook',
    observedAt: event.occurredAt
  };
};

const shellQuote = (value: string): string => {
  const safe = assertSafeArgument(value, 'POSIX shim argument');
  return `'${safe.replace(/'/g, `'\\''`)}'`;
};

const windowsBatchQuote = (value: string): string => {
  const safe = assertSafeArgument(value, 'Windows shim argument');
  if (safe.includes('"')) throw new Error('Windows shim arguments cannot contain double quotes');
  return `"${safe.replace(/%/g, '%%')}"`;
};

export const createCodingAgentHookCommand = (
  shimPath: string,
  platform: NodeJS.Platform = process.platform
): string => platform === 'win32' ? windowsBatchQuote(shimPath) : shellQuote(shimPath);

const helperArguments = (
  provider: CodingAgentProvider,
  endpointPath: string,
  installationId: string
): string[] => [
  CODING_AGENT_HOOK_HELPER_ARG,
  CODING_AGENT_BRIDGE_PATH_ARG,
  endpointPath,
  CODING_AGENT_PROVIDER_ARG,
  parseProvider(provider),
  CODING_AGENT_INSTALLATION_ID_ARG,
  parseUuid(installationId, 'installationId')
];

export const createPosixCodingAgentHookShim = (params: {
  execPath: string;
  appPath: string | null;
  endpointPath: string;
  provider: CodingAgentProvider;
  installationId: string;
}): string => {
  const command = [
    shellQuote(params.execPath),
    ...(params.appPath ? [shellQuote(params.appPath)] : []),
    ...helperArguments(
      params.provider,
      params.endpointPath,
      params.installationId
    ).map(shellQuote)
  ].join(' ');
  return `#!/bin/sh\n${command} >/dev/null 2>/dev/null || true\nexit 0\n`;
};

export const createWindowsCodingAgentHookShim = (params: {
  execPath: string;
  appPath: string | null;
  endpointPath: string;
  provider: CodingAgentProvider;
  installationId: string;
}): string => {
  const command = [
    windowsBatchQuote(params.execPath),
    ...(params.appPath ? [windowsBatchQuote(params.appPath)] : []),
    ...helperArguments(
      params.provider,
      params.endpointPath,
      params.installationId
    ).map(windowsBatchQuote)
  ].join(' ');
  return `@echo off\r\nsetlocal DisableDelayedExpansion\r\n${command} >nul 2>nul\r\nexit /b 0\r\n`;
};
