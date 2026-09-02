import { OnlyPreviewContractError } from '@shared/onlypreview/onlyPreview.contract';
import type { OnlyPreviewErrorCode } from '@shared/onlypreview/onlyPreview.types';

const PREVIEW_READ_ERROR_CODES = new Set<OnlyPreviewErrorCode>([
  'INVALID_INPUT',
  'WORKSPACE_ACCESS_DENIED',
  'PATH_NOT_FOUND',
  'PATH_PERMISSION_DENIED',
  'PATH_OUTSIDE_WORKSPACE',
  'PATH_NOT_REGULAR_FILE',
  'PATH_UNSUPPORTED_DEVICE',
  'TEXT_TOO_LARGE',
  'OPERATION_FAILED',
  'PROTOCOL_ERROR'
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

export class OnlyPreviewPreviewReadProtocolError extends Error {
  constructor() {
    super('Preview Read response violated its private protocol.');
    this.name = 'OnlyPreviewPreviewReadProtocolError';
  }
}

export const unwrapOnlyPreviewPreviewReadReadyResponse = (value: unknown): boolean => {
  if (!isRecord(value) || typeof value.ok !== 'boolean') {
    throw new OnlyPreviewPreviewReadProtocolError();
  }
  if (value.ok) {
    if (!hasExactKeys(value, ['ok'])) throw new OnlyPreviewPreviewReadProtocolError();
    return true;
  }
  if (!hasExactKeys(value, ['error', 'ok']) || !isBoundedPathFreeMessage(value.error)) {
    throw new OnlyPreviewPreviewReadProtocolError();
  }
  return false;
};

export const unwrapOnlyPreviewPreviewReadResponse = (value: unknown): unknown => {
  if (!isRecord(value) || typeof value.ok !== 'boolean') {
    throw new OnlyPreviewPreviewReadProtocolError();
  }
  if (value.ok) {
    if (!hasExactKeys(value, ['ok', 'value'])) throw new OnlyPreviewPreviewReadProtocolError();
    return value.value;
  }
  if (!hasExactKeys(value, ['error', 'ok']) || !isRecord(value.error)) {
    throw new OnlyPreviewPreviewReadProtocolError();
  }
  if (
    !hasExactKeys(value.error, ['code', 'message']) ||
    !PREVIEW_READ_ERROR_CODES.has(value.error.code as OnlyPreviewErrorCode) ||
    !isBoundedPathFreeMessage(value.error.message)
  ) {
    throw new OnlyPreviewPreviewReadProtocolError();
  }
  throw new OnlyPreviewContractError(value.error.code as OnlyPreviewErrorCode, value.error.message);
};
