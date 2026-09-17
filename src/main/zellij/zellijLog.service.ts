import { sanitizeDiagnostic } from '@shared/diagnostics/diagnostic.service';

/**
 * ONE grammar and ONE sanitizer-safe writer for everything under `src/main/zellij/`.
 *
 * Why a helper rather than bare `console.info` at each site: the application log sanitizes every
 * record TWICE (the electron-log hook plus the file-transport format, src/main/logging/log.setup.ts),
 * and two of its rules silently eat exactly the fields this subsystem needs —
 *
 *  - a field literally named `code` is a credential key, so `code=rejected` was written to
 *    main.log as `code=***` (see the `errorCode=` note in
 *    src/shared/diagnostics/diagnostic.service.ts);
 *  - any run of 24+ `[A-Za-z0-9_-]` characters is an opaque token, and a Preview session name
 *    (`bitterless-preview-<12 hex>`, 31 characters) matches it — while the Production form
 *    (23 characters) does not. A line printing session names therefore verifies green on dev and
 *    Production and turns into `***` on Preview, which is the channel Ral packages.
 *
 * So identity is logged as `surface=<tag>` + `profile=<id>` (the session name is derivable from the
 * two through `resolveZellijSessionName`), values are bounded below the token rule, and
 * `zellijDetail` carries free text as a SEPARATE console argument so a redaction inside it cannot
 * damage the structured half of the line.
 *
 * Scope stays `[zellij]`, the prefix the subsystem's existing lines already use, so one grep over
 * `scope=zellij` returns the whole story (docs/issues/zellij-update-restart-blocks-and-new-tab-fails.md #4 R3).
 */

const SCOPE = '[zellij]';

/** Below the sanitizer's 24-character opaque-token rule, so no value can be erased by it. */
const VALUE_LIMIT = 23;

/** Field names the log pipeline would redact. Renamed rather than dropped: a lost line is worse. */
const REDACTED_KEY =
  /^(access[_-]?token|refresh[_-]?token|id[_-]?token|token|authorization[_-]?code|oauth[_-]?code|code|client[_-]?secret|password|credential|api[_-]?key)$/iu;

const SAFE_VALUE = /^[A-Za-z0-9._:+-]{1,23}$/u;

export type ZellijLogField = string | number | boolean | null | undefined;

/**
 * A key the sanitizer would redact becomes `<key>Value`: `code=` → `codeValue=`. Nothing is
 * silently dropped, and the guard test asserts every key this subsystem uses survives both passes.
 */
const key = (name: string): string => (REDACTED_KEY.test(name) ? `${name}Value` : name);

const field = (input: ZellijLogField): string => {
  if (input === null || input === undefined) return 'none';
  if (typeof input === 'boolean') return input ? 'true' : 'false';
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return 'invalid';
    return String(Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(input))));
  }
  const trimmed = input.trim();
  if (!trimmed) return 'none';
  const collapsed = trimmed.replace(/[^A-Za-z0-9._:+-]+/gu, '-').replace(/^-+|-+$/gu, '');
  if (!collapsed) return 'unprintable';
  return collapsed.length > VALUE_LIMIT ? collapsed.slice(0, VALUE_LIMIT) : collapsed;
};

export const zellijLine = (event: string, fields: Record<string, ZellijLogField> = {}): string => {
  const parts = [`event=${field(event)}`];
  for (const [name, value] of Object.entries(fields)) parts.push(`${key(name)}=${field(value)}`);
  return `${SCOPE} ${parts.join(' ')}`;
};

/**
 * Which surface a line is about, in a form the token rule cannot erase: a Maestro tab's own 12-hex
 * `instanceId` survives as-is, while a longer or composite id (`omni-<cellId>`) is bounded.
 */
export const zellijSurfaceTag = (surfaceId: string): string => field(surfaceId);

/**
 * A session's identity for a log line: its LAST `-` separated segment, which by construction
 * (`resolveZellijSessionName`) is the surface's own id — `bitterless-preview-8f61a9105519` →
 * `8f61a9105519`. The full name cannot be logged: on Preview it is 31 characters and the sanitizer's
 * opaque-token rule erases it to `***`.
 */
export const zellijSessionTag = (session: string): string =>
  field(session.split('-').at(-1) ?? session);

/** Bounded free text — Zellij's own words, a path, an OS error — as its own console argument. */
export const zellijDetail = (value: unknown, limit = 160): string =>
  `detail=${sanitizeDiagnostic(typeof value === 'string' ? value : String(value ?? ''), limit) || 'none'}`;

const emit = (
  write: (message: string, ...rest: string[]) => void,
  event: string,
  fields: Record<string, ZellijLogField>,
  detail?: string
): void => {
  try {
    const line = zellijLine(event, fields);
    if (detail === undefined) write(line);
    else write(line, detail);
  } catch {
    /* Diagnostics never take down the operation they describe. */
  }
};

export const zellijLog = {
  info: (event: string, fields: Record<string, ZellijLogField> = {}, detail?: string): void =>
    emit(console.info, event, fields, detail),
  warn: (event: string, fields: Record<string, ZellijLogField> = {}, detail?: string): void =>
    emit(console.warn, event, fields, detail),
  error: (event: string, fields: Record<string, ZellijLogField> = {}, detail?: string): void =>
    emit(console.error, event, fields, detail)
};

/** Monotonic-enough elapsed for log lines; never negative, never fractional, never NaN. */
export const zellijElapsed = (startedAt: number, now = Date.now()): number =>
  !Number.isFinite(startedAt) || !Number.isFinite(now) || now < startedAt
    ? 0
    : Math.floor(now - startedAt);
