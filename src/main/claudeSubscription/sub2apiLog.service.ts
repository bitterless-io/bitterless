/**
 * Structured logging for the Sub2API endpoint.
 *
 * The logger is injected rather than imported. `ClaudeResponsesServer` and
 * `ClaudeResponsesRuntime` are deliberately free of Electron imports so the whole
 * request path can be assembled and exercised outside the app; reaching for
 * `electron-log` here would end that.
 *
 * The endpoint previously logged nothing at all, so a failing turn reached the client
 * as a bare 502 whose only detail was the generic message every failure shares. What
 * the request actually contained, which upstream took it, and what the real error was
 * all existed only in memory and were discarded.
 */
export type Sub2ApiLogLevel = 'info' | 'warn' | 'error';

export type Sub2ApiLogField = string | number | boolean | undefined;

export interface Sub2ApiLogEntry {
  level: Sub2ApiLogLevel;
  event: string;
  fields: Record<string, Sub2ApiLogField>;
}

export type Sub2ApiLogger = (entry: Sub2ApiLogEntry) => void;

export const NO_SUB2API_LOG: Sub2ApiLogger = () => undefined;

/** Keeps one field from turning a log line into a transcript dump. */
const FIELD_LIMIT = 400;

const renderValue = (value: string | number | boolean): string => {
  if (typeof value !== 'string') return String(value);
  const collapsed = value.replace(/\s+/gu, ' ').trim();
  const bounded =
    collapsed.length > FIELD_LIMIT ? `${collapsed.slice(0, FIELD_LIMIT)}…` : collapsed;
  return /[\s"=]/u.test(bounded) ? JSON.stringify(bounded) : bounded;
};

export const formatSub2ApiLogEntry = (entry: Sub2ApiLogEntry): string => {
  const fields = Object.entries(entry.fields)
    .filter((pair): pair is [string, string | number | boolean] => pair[1] !== undefined)
    .map(([key, value]) => `${key}=${renderValue(value)}`);
  return `[sub2api] ${entry.event}${fields.length ? ` ${fields.join(' ')}` : ''}`;
};

/**
 * Describes a thrown value for a log line. Errors arriving here are frequently not
 * `ClaudeSubscriptionError` — that is precisely the case worth recording, because the
 * response collapses every one of them into the same generic 502.
 */
export const describeSub2ApiError = (
  error: unknown
): { errorName: string; errorMessage: string; errorCause?: string } => {
  if (!(error instanceof Error)) {
    return { errorName: typeof error, errorMessage: String(error) };
  }
  const cause = (error as { cause?: unknown }).cause;
  return {
    errorName: error.name,
    errorMessage: error.message,
    ...(cause instanceof Error ? { errorCause: `${cause.name}: ${cause.message}` } : {})
  };
};
