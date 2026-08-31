import { OnlyPreviewContractError } from '@shared/onlypreview/onlyPreview.contract';
import type { OnlyPreviewErrorCode } from '@shared/onlypreview/onlyPreview.types';

const PROJECT_AUTHORITY_ERROR_CODES = new Set<OnlyPreviewErrorCode>([
  'INVALID_INPUT',
  'WORKSPACE_ACCESS_DENIED',
  'PATH_NOT_FOUND',
  'PATH_PERMISSION_DENIED',
  'PATH_OUTSIDE_WORKSPACE',
  'PATH_NOT_REGULAR_FILE',
  'PATH_UNSUPPORTED_DEVICE',
  'OPERATION_FAILED'
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const actual = Reflect.ownKeys(value);
  return (
    actual.length === keys.length &&
    actual.every((key) => typeof key === 'string' && keys.includes(key))
  );
};

const isBoundedPathFreeMessage = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length >= 1 &&
  value.length <= 240 &&
  value.trim() === value &&
  !/[\0\r\n/\\]/.test(value) &&
  !/\bfile:/i.test(value) &&
  !/(?:^|\s)[a-z]:/i.test(value);

export class OnlyPreviewProjectAuthorityProtocolError extends Error {
  constructor() {
    super('Project authority response violated its private protocol.');
    this.name = 'OnlyPreviewProjectAuthorityProtocolError';
  }
}

export const unwrapOnlyPreviewProjectAuthorityResponse = (value: unknown): unknown => {
  if (!isRecord(value) || typeof value.ok !== 'boolean') {
    throw new OnlyPreviewProjectAuthorityProtocolError();
  }
  if (value.ok) {
    if (!hasExactKeys(value, ['ok', 'value'])) {
      throw new OnlyPreviewProjectAuthorityProtocolError();
    }
    return value.value;
  }
  if (!hasExactKeys(value, ['error', 'ok']) || !isRecord(value.error)) {
    throw new OnlyPreviewProjectAuthorityProtocolError();
  }
  if (
    !hasExactKeys(value.error, ['code', 'message']) ||
    !PROJECT_AUTHORITY_ERROR_CODES.has(value.error.code as OnlyPreviewErrorCode) ||
    !isBoundedPathFreeMessage(value.error.message)
  ) {
    throw new OnlyPreviewProjectAuthorityProtocolError();
  }
  throw new OnlyPreviewContractError(value.error.code as OnlyPreviewErrorCode, value.error.message);
};
