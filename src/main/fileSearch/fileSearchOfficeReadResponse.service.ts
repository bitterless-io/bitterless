import { OnlyPreviewContractError } from '@shared/onlypreview/onlyPreview.contract';
import type { OnlyPreviewErrorCode } from '@shared/onlypreview/onlyPreview.types';

const OFFICE_READ_ERROR_CODES = new Set<OnlyPreviewErrorCode>([
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

export class OnlyPreviewOfficeReadProtocolError extends Error {
  constructor() {
    super('Office read response violated its private protocol.');
    this.name = 'OnlyPreviewOfficeReadProtocolError';
  }
}

export const unwrapOnlyPreviewOfficeReadReadyResponse = (value: unknown): boolean => {
  if (!isRecord(value) || typeof value.ok !== 'boolean') {
    throw new OnlyPreviewOfficeReadProtocolError();
  }
  if (value.ok) {
    if (!hasExactKeys(value, ['ok'])) throw new OnlyPreviewOfficeReadProtocolError();
    return true;
  }
  if (!hasExactKeys(value, ['error', 'ok']) || !isBoundedPathFreeMessage(value.error)) {
    throw new OnlyPreviewOfficeReadProtocolError();
  }
  return false;
};

export const unwrapOnlyPreviewOfficeReadResponse = (value: unknown): unknown => {
  if (!isRecord(value) || typeof value.ok !== 'boolean') {
    throw new OnlyPreviewOfficeReadProtocolError();
  }
  if (value.ok) {
    if (!hasExactKeys(value, ['ok', 'value'])) throw new OnlyPreviewOfficeReadProtocolError();
    return value.value;
  }
  if (!hasExactKeys(value, ['error', 'ok']) || !isRecord(value.error)) {
    throw new OnlyPreviewOfficeReadProtocolError();
  }
  if (
    !hasExactKeys(value.error, ['code', 'message']) ||
    !OFFICE_READ_ERROR_CODES.has(value.error.code as OnlyPreviewErrorCode) ||
    !isBoundedPathFreeMessage(value.error.message)
  ) {
    throw new OnlyPreviewOfficeReadProtocolError();
  }
  throw new OnlyPreviewContractError(value.error.code as OnlyPreviewErrorCode, value.error.message);
};
