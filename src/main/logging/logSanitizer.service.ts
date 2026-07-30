import {
  sanitizeDiagnostic,
  sanitizeErrorCauseChain
} from '@shared/diagnostics/diagnostic.service';

export interface ApplicationLogMessage {
  data: unknown[];
  date?: Date;
  level?: string;
  scope?: string;
  variables?: Record<string, unknown>;
}

export const sanitizeApplicationLogData = (value: unknown): unknown => {
  if (typeof value === 'string') return sanitizeDiagnostic(value);
  if (value instanceof Error) {
    const cause = sanitizeErrorCauseChain(value);
    return cause ? `[error ${cause}]` : '[redacted-error]';
  }
  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'bigint') return value.toString();
  if (value === undefined) return '[undefined]';
  if (Array.isArray(value)) return `[redacted-array length=${value.length}]`;
  if (typeof value === 'object') return '[redacted-object]';
  return `[redacted-${typeof value}]`;
};

export const sanitizeApplicationLogMessage = <T extends ApplicationLogMessage>(message: T): T => {
  const profile = sanitizeDiagnostic(message.variables?.profile, 64);
  const proc = sanitizeDiagnostic(message.variables?.proc ?? message.variables?.processType, 64);
  const world = sanitizeDiagnostic(message.variables?.world, 32);
  return {
    ...message,
    data: message.data.map((value) => sanitizeApplicationLogData(value)),
    scope: message.scope ? sanitizeDiagnostic(message.scope, 64) : message.scope,
    variables: {
      profile: profile || 'unknown',
      proc: proc || 'main',
      world: world || 'main'
    }
  };
};

const parseScopePrefix = (value: string): { scope: string; message: string } | null => {
  const match = value.match(/^\[([^\]\r\n]{1,64})\]\s*/);
  if (!match) return null;
  return {
    scope: sanitizeDiagnostic(match[1], 64),
    message: value.slice(match[0].length)
  };
};

export const formatApplicationLogMessage = (message: ApplicationLogMessage): string[] => {
  const safe = sanitizeApplicationLogMessage(message);
  const first = safe.data[0];
  const tagged = typeof first === 'string' ? parseScopePrefix(first) : null;
  const variables = safe.variables ?? {};
  const record = {
    ts: (safe.date ?? new Date()).toISOString(),
    level: sanitizeDiagnostic(safe.level, 16) || 'info',
    profile: sanitizeDiagnostic(variables.profile, 64) || 'unknown',
    proc: sanitizeDiagnostic(variables.proc, 64) || 'main',
    world: sanitizeDiagnostic(variables.world, 32) || 'main',
    scope: tagged?.scope ?? sanitizeDiagnostic(safe.scope, 64),
    msg: typeof first === 'string' ? (tagged?.message ?? first) : '',
    args: typeof first === 'string' ? safe.data.slice(1) : safe.data
  };
  return [JSON.stringify(record)];
};
