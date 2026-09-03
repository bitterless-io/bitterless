import { sanitizeErrorCauseChain } from '@shared/diagnostics/diagnostic.service';

export interface OnlyPreviewLogFailure {
  operation: string;
  code: string;
  error: unknown;
}

// Renderer observation acknowledgements. Their failure is a supersede, not a fault: the preview
// renderer reports a ready/reset/error observation for a selection that a faster file switch has
// already replaced, Main correctly rejects it as stale, and the renderer swallows the rejection
// without surfacing anything. Recording those at `error` buried the real failures in noise and made
// a routine race look like a defect.
export const ONLY_PREVIEW_ACKNOWLEDGEMENT_OPERATIONS: ReadonlySet<string> = new Set([
  'reportPreviewReady',
  'reportPreviewReset',
  'reportPreviewError'
]);

export const isOnlyPreviewExpectedSupersede = (failure: OnlyPreviewLogFailure): boolean =>
  ONLY_PREVIEW_ACKNOWLEDGEMENT_OPERATIONS.has(failure.operation) &&
  failure.code === 'INVALID_INPUT';

// 23 is the shared diagnostics ceiling: the application sanitizer replaces any run of 24 or more
// token characters with `***`, so a longer operation name or error code would be erased entirely.
// All 40 Main operation names and all 47 OnlyPreview error codes stay unique at this width.
export const ONLY_PREVIEW_LOG_TOKEN_LIMIT = 23;

const safeToken = (value: unknown): string => {
  const token = typeof value === 'string' ? value.replace(/[^A-Za-z0-9._-]/g, '-') : '';
  return token.slice(0, ONLY_PREVIEW_LOG_TOKEN_LIMIT) || 'unknown';
};

// `[onlypreview]` becomes the record scope; the remaining fields stay fixed short tokens so the
// application-wide opaque-token redaction cannot erase the operation or the error code.
//
// The field must not be named `code`. The shared sanitizer treats `code=<value>` as a credential
// assignment and rewrites it to `code=***`, which would erase both the OnlyPreview error code and
// the `ENOENT`/`EACCES` class inside the cause chain — the two fields worth logging at all.
const withSafeCauseFields = (cause: string): string => cause.replace(/\bcode=/g, 'errorCode=');

export const formatOnlyPreviewFailureLine = (failure: OnlyPreviewLogFailure): string => {
  const cause = withSafeCauseFields(sanitizeErrorCauseChain(failure.error));
  const fields = [
    `operation=${safeToken(failure.operation)}`,
    `errorCode=${safeToken(failure.code)}`,
    `cause=${cause || 'unavailable'}`
  ];
  return `[onlypreview] ${fields.join(' ')}`;
};
