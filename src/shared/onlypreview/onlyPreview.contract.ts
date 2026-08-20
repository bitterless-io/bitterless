import type {
  OnlyPreviewBounds,
  OnlyPreviewErrorCode,
  OnlyPreviewErrorPayload,
  OnlyPreviewFileRef,
  OnlyPreviewResult,
  OnlyPreviewPreviewErrorRequest,
  OnlyPreviewPreviewRuntimeRequest,
  OnlyPreviewPreviewRevisionRequest,
  OnlyPreviewTextReadRequest,
  OnlyPreviewSettings
} from './onlyPreview.types';

export class OnlyPreviewContractError extends Error {
  constructor(
    readonly code: OnlyPreviewErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'OnlyPreviewContractError';
  }
}

export const isOnlyPreviewPermissionError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  return code === 'EACCES' || code === 'EPERM';
};

export const DEFAULT_ONLY_PREVIEW_SETTINGS: Readonly<OnlyPreviewSettings> = Object.freeze({
  theme: 'light',
  editorFontSize: 13,
  wordWrap: false,
  showHiddenFiles: true,
  openFilesWithSingleClick: true
});

const expectRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new OnlyPreviewContractError('INVALID_INPUT', `${label} must be an object.`);
  }
  return value as Record<string, unknown>;
};

const expectBoundedToken = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.length < 16 || value.length > 256) {
    throw new OnlyPreviewContractError('INVALID_INPUT', `${label} is invalid.`);
  }
  return value;
};

export const parseOnlyPreviewHostToken = (value: unknown): string =>
  expectBoundedToken(value, 'Host capability');

export const normalizeOnlyPreviewRelativePath = (
  value: unknown,
  options: { allowEmpty?: boolean } = {}
): string => {
  if (typeof value !== 'string' || value.length > 16_384 || value.includes('\0')) {
    throw new OnlyPreviewContractError('INVALID_INPUT', 'Relative path is invalid.');
  }
  if (value === '' && options.allowEmpty) return '';
  if (
    value === '' ||
    value.startsWith('/') ||
    value.startsWith('\\') ||
    /^[a-zA-Z]:/.test(value) ||
    value.includes('\\')
  ) {
    throw new OnlyPreviewContractError(
      'INVALID_INPUT',
      'Relative path must stay inside its workspace.'
    );
  }
  const segments = value.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new OnlyPreviewContractError('INVALID_INPUT', 'Relative path must be normalized.');
  }
  return segments.join('/');
};

export const parseOnlyPreviewFileRef = (value: unknown): OnlyPreviewFileRef => {
  const record = expectRecord(value, 'File reference');
  return {
    workspaceId: expectBoundedToken(record.workspaceId, 'Workspace capability'),
    relativePath: normalizeOnlyPreviewRelativePath(record.relativePath)
  };
};

export const parseOnlyPreviewSettings = (value: unknown): OnlyPreviewSettings => {
  const record = expectRecord(value, 'OnlyPreview settings');
  const allowedKeys = new Set([
    'theme',
    'editorFontSize',
    'wordWrap',
    'showHiddenFiles',
    'openFilesWithSingleClick'
  ]);
  if (Object.keys(record).some((key) => !allowedKeys.has(key))) {
    throw new OnlyPreviewContractError(
      'SETTINGS_INVALID',
      'OnlyPreview settings contain an unknown field.'
    );
  }
  if (
    record.theme !== 'light' ||
    !Number.isInteger(record.editorFontSize) ||
    (record.editorFontSize as number) < 11 ||
    (record.editorFontSize as number) > 24 ||
    typeof record.wordWrap !== 'boolean' ||
    typeof record.showHiddenFiles !== 'boolean' ||
    typeof record.openFilesWithSingleClick !== 'boolean'
  ) {
    throw new OnlyPreviewContractError('SETTINGS_INVALID', 'OnlyPreview settings are invalid.');
  }
  return {
    theme: 'light',
    editorFontSize: record.editorFontSize as number,
    wordWrap: record.wordWrap,
    showHiddenFiles: record.showHiddenFiles,
    openFilesWithSingleClick: record.openFilesWithSingleClick
  };
};

export const cloneDefaultOnlyPreviewSettings = (): OnlyPreviewSettings => ({
  ...DEFAULT_ONLY_PREVIEW_SETTINGS
});

export const parseOnlyPreviewBounds = (value: unknown): OnlyPreviewBounds => {
  const record = expectRecord(value, 'Preview bounds');
  const values = [record.x, record.y, record.width, record.height];
  if (values.some((entry) => typeof entry !== 'number' || !Number.isFinite(entry))) {
    throw new OnlyPreviewContractError('INVALID_INPUT', 'Preview bounds must be finite numbers.');
  }
  const [x, y, width, height] = values as number[];
  if (x < 0 || y < 0 || width < 0 || height < 0) {
    throw new OnlyPreviewContractError('INVALID_INPUT', 'Preview bounds cannot be negative.');
  }
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height)
  };
};

export const parseOnlyPreviewSelectionRevision = (value: unknown): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new OnlyPreviewContractError('INVALID_INPUT', 'Preview selection revision is invalid.');
  }
  return value as number;
};

export const parseOnlyPreviewPreviewRuntimeRequest = (
  value: unknown
): OnlyPreviewPreviewRuntimeRequest => {
  const record = expectRecord(value, 'Preview runtime request');
  return {
    hostToken: expectBoundedToken(record.hostToken, 'Host capability'),
    previewRuntimeToken: expectBoundedToken(
      record.previewRuntimeToken,
      'Preview runtime capability'
    )
  };
};

export const parseOnlyPreviewPreviewRevisionRequest = (
  value: unknown
): OnlyPreviewPreviewRevisionRequest => {
  const request = parseOnlyPreviewPreviewRuntimeRequest(value);
  const record = expectRecord(value, 'Preview revision request');
  return {
    ...request,
    selectionRevision: parseOnlyPreviewSelectionRevision(record.selectionRevision)
  };
};

export const parseOnlyPreviewTextReadRequest = (value: unknown): OnlyPreviewTextReadRequest => {
  const request = parseOnlyPreviewPreviewRevisionRequest(value);
  const fileRef = parseOnlyPreviewFileRef(value);
  const record = expectRecord(value, 'Preview text request');
  if (record.adapterId !== 'monaco' && record.adapterId !== 'markdown-dom') {
    throw new OnlyPreviewContractError('INVALID_INPUT', 'Preview text adapter is invalid.');
  }
  return { ...request, ...fileRef, adapterId: record.adapterId };
};

export const parseOnlyPreviewPreviewErrorRequest = (
  value: unknown
): OnlyPreviewPreviewErrorRequest => {
  const request = parseOnlyPreviewPreviewRevisionRequest(value);
  const record = value as Record<string, unknown>;
  const errorCodes = new Set([
    'INVALID_INPUT',
    'HOST_NOT_FOUND',
    'HOST_ROLE_DENIED',
    'WORKSPACE_NOT_FOUND',
    'WORKSPACE_ACCESS_DENIED',
    'PATH_NOT_FOUND',
    'PATH_PERMISSION_DENIED',
    'PATH_OUTSIDE_WORKSPACE',
    'PATH_NOT_REGULAR_FILE',
    'PATH_UNSUPPORTED_DEVICE',
    'TEXT_TOO_LARGE',
    'SIGNATURE_MISMATCH',
    'SETTINGS_INVALID',
    'INDEX_FAILED',
    'OPERATION_FAILED',
    'PROTOCOL_ERROR'
  ]);
  if (typeof record.errorCode !== 'string' || !errorCodes.has(record.errorCode)) {
    throw new OnlyPreviewContractError('INVALID_INPUT', 'Preview error code is invalid.');
  }
  return { ...request, errorCode: record.errorCode as OnlyPreviewPreviewErrorRequest['errorCode'] };
};

export const toOnlyPreviewErrorPayload = (error: unknown): OnlyPreviewErrorPayload => {
  if (error instanceof OnlyPreviewContractError) {
    return { code: error.code, message: error.message };
  }
  return {
    code: 'OPERATION_FAILED',
    message: 'OnlyPreview could not complete this operation.'
  };
};

export const onlyPreviewSuccess = <T>(value: T): OnlyPreviewResult<T> => ({ ok: true, value });

export const onlyPreviewFailure = (error: unknown): OnlyPreviewResult<never> => ({
  ok: false,
  error: toOnlyPreviewErrorPayload(error)
});

export const unwrapOnlyPreviewResult = <T>(value: OnlyPreviewResult<T> | null): T => {
  if (!value) {
    throw new OnlyPreviewContractError(
      'OPERATION_FAILED',
      'OnlyPreview did not receive a valid response.'
    );
  }
  if (!value.ok) throw new OnlyPreviewContractError(value.error.code, value.error.message);
  return value.value;
};
