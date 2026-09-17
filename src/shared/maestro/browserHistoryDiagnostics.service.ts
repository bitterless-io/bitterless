const ERROR_NAMES = new Set([
  'Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'AbortError',
  'TimeoutError', 'SqliteError', 'ApplicationLanguageContractError',
]);
const ERROR_CODES = new Set([
  'SQLITE_ERROR', 'SQLITE_BUSY', 'SQLITE_LOCKED', 'SQLITE_READONLY', 'SQLITE_IOERR',
  'SQLITE_CORRUPT', 'SQLITE_FULL', 'SQLITE_CANTOPEN', 'SQLITE_CONSTRAINT', 'SQLITE_NOTADB',
  'ERR_SQLITE_ERROR', 'ERR_FILE_NOT_FOUND', 'ERR_FAILED', 'ERR_ABORTED',
  'ENOENT', 'EACCES', 'EPERM', 'ETIMEDOUT',
  'APP_LANGUAGE_REVISION_CONFLICT', 'APP_LANGUAGE_NOT_INITIALIZED',
]);

/** Only fixed error classifications cross this boundary; messages can contain browsing data. */
export const browserHistoryError = (error: unknown): { errorName: string; errorCode: string } => {
  const value = error && typeof error === 'object' ? error as { name?: unknown; code?: unknown } : {};
  return {
    errorName: typeof value.name === 'string' && ERROR_NAMES.has(value.name) ? value.name : 'unknown',
    errorCode: typeof value.code === 'string' && ERROR_CODES.has(value.code) ? value.code : 'unknown',
  };
};

/** Callers pass fixed stages/reasons and scalar counters/flags, never request or entry objects.
 * One string also survives Electron's console-message spy in renderer and preload processes. */
export const browserHistoryLog = (
  stage: string,
  fields: Record<string, boolean | number | string | undefined> = {},
): void => {
  console.info(`[browser-history] ${stage} ${JSON.stringify(fields)}`);
};
