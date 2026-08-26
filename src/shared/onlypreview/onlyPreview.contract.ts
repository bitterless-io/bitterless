import type {
  OnlyPreviewBounds,
  OnlyPreviewDescriptor,
  OnlyPreviewErrorCode,
  OnlyPreviewErrorPayload,
  OnlyPreviewFindCoverage,
  OnlyPreviewFindIntent,
  OnlyPreviewFindResult,
  OnlyPreviewFindResultRequest,
  OnlyPreviewFileRef,
  OnlyPreviewGlobalSearchFocusRequest,
  OnlyPreviewResult,
  OnlyPreviewPreviewErrorRequest,
  OnlyPreviewPreviewReadyRequest,
  OnlyPreviewPreviewRuntimeRequest,
  OnlyPreviewPreviewRevisionRequest,
  OnlyPreviewProjectItemCopyRequest,
  OnlyPreviewProjectRootCopyRequest,
  OnlyPreviewProjectRootRequest,
  OnlyPreviewTextReadRequest,
  OnlyPreviewSettings
} from './onlyPreview.types';

export const cloneOnlyPreviewDescriptor = (
  descriptor: OnlyPreviewDescriptor,
  options: { includeAsset?: boolean } = {}
): OnlyPreviewDescriptor => {
  const clone: OnlyPreviewDescriptor = {
    workspaceId: descriptor.workspaceId,
    relativePath: descriptor.relativePath,
    name: descriptor.relativePath.split('/').at(-1) || descriptor.name,
    extension: descriptor.extension,
    kind: descriptor.kind,
    mimeType: descriptor.mimeType,
    language: descriptor.language,
    size: descriptor.size,
    modifiedAt: descriptor.modifiedAt
  };
  if (options.includeAsset !== false && descriptor.assetUrl) clone.assetUrl = descriptor.assetUrl;
  if (descriptor.unsupportedCategory) clone.unsupportedCategory = descriptor.unsupportedCategory;
  if (descriptor.previewError) clone.previewError = { ...descriptor.previewError };
  return clone;
};

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

const expectExactKeys = (
  record: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = []
): void => {
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((key) => !Object.prototype.hasOwnProperty.call(record, key)) ||
    Object.keys(record).some((key) => !allowed.has(key))
  ) {
    throw new OnlyPreviewContractError('INVALID_INPUT', 'OnlyPreview request shape is invalid.');
  }
};

const expectNonNegativeSafeInteger = (value: unknown, label: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new OnlyPreviewContractError('INVALID_INPUT', `${label} is invalid.`);
  }
  return value as number;
};

export const parseOnlyPreviewFindCoverage = (value: unknown): OnlyPreviewFindCoverage => {
  const record = expectRecord(value, 'Find coverage');
  if (record.kind === 'complete') {
    expectExactKeys(record, ['kind']);
    return { kind: 'complete' };
  }
  expectExactKeys(record, ['kind', 'reason', 'acceptedSheets', 'acceptedCells']);
  if (
    record.kind !== 'partial' ||
    record.reason !== 'sheet-model-cap' ||
    !Number.isSafeInteger(record.acceptedSheets) ||
    (record.acceptedSheets as number) < 1 ||
    !Number.isSafeInteger(record.acceptedCells) ||
    (record.acceptedCells as number) < 0
  ) {
    throw new OnlyPreviewContractError('INVALID_INPUT', 'Find coverage is invalid.');
  }
  return {
    kind: 'partial',
    reason: 'sheet-model-cap',
    acceptedSheets: record.acceptedSheets as number,
    acceptedCells: record.acceptedCells as number
  };
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

export const parseOnlyPreviewProjectItemCopyRequest = (
  value: unknown
): OnlyPreviewProjectItemCopyRequest => {
  const record = expectRecord(value, 'Project item copy request');
  expectExactKeys(record, ['hostToken', 'workspaceId', 'relativePath', 'copyKind']);
  if (
    record.copyKind !== 'item' &&
    record.copyKind !== 'absolute-path' &&
    record.copyKind !== 'relative-path' &&
    record.copyKind !== 'name'
  ) {
    throw new OnlyPreviewContractError('INVALID_INPUT', 'Project item copy kind is invalid.');
  }
  return {
    hostToken: expectBoundedToken(record.hostToken, 'Host capability'),
    ...parseOnlyPreviewFileRef(record),
    copyKind: record.copyKind
  };
};

export const parseOnlyPreviewProjectRootRequest = (
  value: unknown
): OnlyPreviewProjectRootRequest => {
  const record = expectRecord(value, 'Project root request');
  expectExactKeys(record, ['hostToken', 'workspaceId']);
  return {
    hostToken: expectBoundedToken(record.hostToken, 'Host capability'),
    workspaceId: expectBoundedToken(record.workspaceId, 'Workspace capability')
  };
};

export const parseOnlyPreviewProjectRootCopyRequest = (
  value: unknown
): OnlyPreviewProjectRootCopyRequest => {
  const record = expectRecord(value, 'Project root copy request');
  expectExactKeys(record, ['hostToken', 'workspaceId', 'copyKind']);
  if (
    record.copyKind !== 'item' &&
    record.copyKind !== 'absolute-path' &&
    record.copyKind !== 'relative-path' &&
    record.copyKind !== 'name'
  ) {
    throw new OnlyPreviewContractError('INVALID_INPUT', 'Project root copy kind is invalid.');
  }
  return {
    ...parseOnlyPreviewProjectRootRequest({
      hostToken: record.hostToken,
      workspaceId: record.workspaceId
    }),
    copyKind: record.copyKind
  };
};

export const parseOnlyPreviewGlobalSearchFocusRequest = (
  value: unknown
): OnlyPreviewGlobalSearchFocusRequest => {
  const record = expectRecord(value, 'Global Search focus request');
  expectExactKeys(record, ['hostToken', 'mode']);
  if (record.mode !== 'opener' && record.mode !== 'preview' && record.mode !== 'discard') {
    throw new OnlyPreviewContractError('INVALID_INPUT', 'Global Search focus mode is invalid.');
  }
  return {
    hostToken: expectBoundedToken(record.hostToken, 'Host capability'),
    mode: record.mode
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

export const parseOnlyPreviewPreviewReadyRequest = (
  value: unknown
): OnlyPreviewPreviewReadyRequest => {
  const request = parseOnlyPreviewPreviewRevisionRequest(value);
  const record = expectRecord(value, 'Preview ready request');
  expectExactKeys(
    record,
    ['hostToken', 'previewRuntimeToken', 'selectionRevision'],
    ['findCoverage', 'findAdapter']
  );
  if (
    record.findAdapter !== undefined &&
    record.findAdapter !== 'monaco' &&
    record.findAdapter !== 'sheet'
  ) {
    throw new OnlyPreviewContractError('INVALID_INPUT', 'Preview find adapter is invalid.');
  }
  return {
    ...request,
    ...(record.findCoverage === undefined
      ? {}
      : { findCoverage: parseOnlyPreviewFindCoverage(record.findCoverage) }),
    ...(record.findAdapter === undefined
      ? {}
      : { findAdapter: record.findAdapter as 'monaco' | 'sheet' })
  };
};

export const parseOnlyPreviewFindIntent = (value: unknown): OnlyPreviewFindIntent => {
  const record = expectRecord(value, 'Preview find intent');
  expectExactKeys(record, [
    'hostToken',
    'selectionRevision',
    'surface',
    'query',
    'caseSensitive',
    'direction',
    'findNext'
  ]);
  if (
    (record.surface !== 'chrome' && record.surface !== 'vue') ||
    typeof record.query !== 'string' ||
    record.query.length > 4096 ||
    record.query.includes('\0') ||
    typeof record.caseSensitive !== 'boolean' ||
    (record.direction !== 'forward' && record.direction !== 'backward') ||
    typeof record.findNext !== 'boolean'
  ) {
    throw new OnlyPreviewContractError('INVALID_INPUT', 'Preview find intent is invalid.');
  }
  return {
    hostToken: expectBoundedToken(record.hostToken, 'Host capability'),
    selectionRevision: parseOnlyPreviewSelectionRevision(record.selectionRevision),
    surface: record.surface,
    query: record.query,
    caseSensitive: record.caseSensitive,
    direction: record.direction,
    findNext: record.findNext
  };
};

export const parseOnlyPreviewFindResult = (value: unknown): OnlyPreviewFindResult => {
  const record = expectRecord(value, 'Preview find result');
  expectExactKeys(record, [
    'hostId',
    'selectionRevision',
    'surface',
    'findRevision',
    'activeMatchOrdinal',
    'matches',
    'finalUpdate',
    'coverage'
  ]);
  const matches = expectNonNegativeSafeInteger(record.matches, 'Find match count');
  const activeMatchOrdinal = expectNonNegativeSafeInteger(
    record.activeMatchOrdinal,
    'Active find match'
  );
  if (
    typeof record.hostId !== 'string' ||
    record.hostId.length < 1 ||
    record.hostId.length > 256 ||
    (record.surface !== 'chrome' && record.surface !== 'vue') ||
    typeof record.finalUpdate !== 'boolean' ||
    (matches === 0
      ? activeMatchOrdinal !== 0
      : activeMatchOrdinal < 1 || activeMatchOrdinal > matches)
  ) {
    throw new OnlyPreviewContractError('INVALID_INPUT', 'Preview find result is invalid.');
  }
  return {
    hostId: record.hostId,
    selectionRevision: parseOnlyPreviewSelectionRevision(record.selectionRevision),
    surface: record.surface,
    findRevision: expectNonNegativeSafeInteger(record.findRevision, 'Find revision'),
    activeMatchOrdinal,
    matches,
    finalUpdate: record.finalUpdate,
    coverage: parseOnlyPreviewFindCoverage(record.coverage)
  };
};

export const parseOnlyPreviewFindResultRequest = (value: unknown): OnlyPreviewFindResultRequest => {
  const record = expectRecord(value, 'Preview find result request');
  expectExactKeys(record, ['hostToken', 'previewRuntimeToken', 'result']);
  return {
    hostToken: expectBoundedToken(record.hostToken, 'Host capability'),
    previewRuntimeToken: expectBoundedToken(
      record.previewRuntimeToken,
      'Preview runtime capability'
    ),
    result: parseOnlyPreviewFindResult(record.result)
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
    'OOXML_ARCHIVE_LIMIT',
    'OOXML_ENCRYPTED',
    'OOXML_ARCHIVE_INVALID',
    'SHEET_PARSE_FAILED',
    'SHEET_EMPTY',
    'SHEET_RENDER_TIMEOUT',
    'DOCUMENT_PARSE_FAILED',
    'DOCUMENT_EMPTY',
    'DOCUMENT_SANITIZE_FAILED',
    'DOCUMENT_RENDER_TIMEOUT',
    'DIAGRAM_PARSE_FAILED',
    'DIAGRAM_EMPTY',
    'DIAGRAM_LIMIT',
    'DIAGRAM_RENDER_TIMEOUT',
    'IMAGE_EMPTY',
    'IMAGE_READ_FAILED',
    'IMAGE_DECODE_FAILED',
    'MEDIA_EMPTY',
    'MEDIA_READ_FAILED',
    'MEDIA_ABORTED',
    'MEDIA_NETWORK_FAILED',
    'MEDIA_DECODE_FAILED',
    'MEDIA_SOURCE_UNSUPPORTED',
    'SETTINGS_INVALID',
    'INDEX_FAILED',
    'PDF_VIEWER_UNAVAILABLE',
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
  if (value.ok === false) {
    throw new OnlyPreviewContractError(value.error.code, value.error.message);
  }
  return value.value;
};
