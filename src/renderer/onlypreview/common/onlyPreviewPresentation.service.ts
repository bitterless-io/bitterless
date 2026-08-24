import type {
  OnlyPreviewDescriptor,
  OnlyPreviewErrorPayload,
  OnlyPreviewFileRef,
  OnlyPreviewPreviewPresentation
} from '@shared/onlypreview/onlyPreview.types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};

const hasRequiredAndOptionalKeys = (
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[]
): boolean => {
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => Object.prototype.hasOwnProperty.call(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key))
  );
};

export const isOnlyPreviewPresentationNudge = (value: unknown): value is { hostId: string } =>
  isRecord(value) &&
  hasExactKeys(value, ['hostId']) &&
  typeof value.hostId === 'string' &&
  value.hostId.length > 0;

const isNullableBoundedString = (value: unknown, maxLength: number): boolean =>
  value === null ||
  (typeof value === 'string' && value.length <= maxLength && !value.includes('\0'));

const isFileRef = (value: unknown): value is OnlyPreviewFileRef => {
  if (!isRecord(value) || !hasExactKeys(value, ['relativePath', 'workspaceId'])) return false;
  return (
    typeof value.workspaceId === 'string' &&
    value.workspaceId.length >= 16 &&
    value.workspaceId.length <= 256 &&
    typeof value.relativePath === 'string' &&
    value.relativePath.length > 0 &&
    value.relativePath.length <= 16_384
  );
};

const DESCRIPTOR_ERROR_CODES = new Set([
  'TEXT_TOO_LARGE',
  'SIGNATURE_MISMATCH',
  'UNSUPPORTED_CODEC',
  'OOXML_ENCRYPTED',
  'IMAGE_EMPTY',
  'MEDIA_EMPTY'
]);

const isDescriptorError = (value: unknown): boolean =>
  isRecord(value) &&
  hasExactKeys(value, ['code', 'message']) &&
  typeof value.code === 'string' &&
  DESCRIPTOR_ERROR_CODES.has(value.code) &&
  typeof value.message === 'string' &&
  value.message.length <= 1_024 &&
  !value.message.includes('\0');

const isNormalizedRelativePath = (value: unknown): value is string => {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 16_384 ||
    value.startsWith('/') ||
    value.startsWith('\\') ||
    /^[a-zA-Z]:/u.test(value) ||
    value.includes('\\') ||
    value.includes('\0')
  ) {
    return false;
  }
  return value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
};

const isDescriptor = (value: unknown): value is OnlyPreviewDescriptor => {
  if (!isRecord(value)) return false;
  if (
    !hasRequiredAndOptionalKeys(
      value,
      [
        'workspaceId',
        'relativePath',
        'name',
        'extension',
        'kind',
        'mimeType',
        'language',
        'size',
        'modifiedAt'
      ],
      ['assetUrl', 'unsupportedCategory', 'previewError']
    )
  ) {
    return false;
  }
  const hasValidUnsupportedCategory =
    value.unsupportedCategory === undefined ||
    (value.kind === 'unsupported' &&
      (value.unsupportedCategory === 'image-format' ||
        value.unsupportedCategory === 'video-container'));
  return (
    typeof value.workspaceId === 'string' &&
    isNormalizedRelativePath(value.relativePath) &&
    typeof value.name === 'string' &&
    value.name.length > 0 &&
    value.name === value.relativePath.split('/').at(-1) &&
    typeof value.extension === 'string' &&
    (value.kind === 'text' ||
      value.kind === 'pdf' ||
      value.kind === 'image' ||
      value.kind === 'audio' ||
      value.kind === 'video' ||
      value.kind === 'sheet' ||
      value.kind === 'document' ||
      value.kind === 'unsupported') &&
    typeof value.mimeType === 'string' &&
    typeof value.language === 'string' &&
    Number.isSafeInteger(value.size) &&
    (value.size as number) >= 0 &&
    Number.isFinite(value.modifiedAt) &&
    (value.assetUrl === undefined ||
      (typeof value.assetUrl === 'string' &&
        value.assetUrl.length <= 16_384 &&
        !value.assetUrl.includes('\0'))) &&
    (value.previewError === undefined || isDescriptorError(value.previewError)) &&
    hasValidUnsupportedCategory
  );
};

const isErrorPayload = (value: unknown): value is OnlyPreviewErrorPayload =>
  isRecord(value) && typeof value.code === 'string' && typeof value.message === 'string';

export const isOnlyPreviewPresentation = (
  value: unknown
): value is OnlyPreviewPreviewPresentation => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'adapterId',
      'descriptor',
      'error',
      'fileRef',
      'hostId',
      'selectedTextAvailable',
      'selectionRevision',
      'status',
      'surface',
      'workspaceId'
    ])
  ) {
    return false;
  }
  return (
    typeof value.hostId === 'string' &&
    isNullableBoundedString(value.workspaceId, 256) &&
    Number.isSafeInteger(value.selectionRevision) &&
    (value.selectionRevision as number) >= 0 &&
    (value.surface === 'chrome' || value.surface === 'vue') &&
    (value.adapterId === 'monaco' ||
      value.adapterId === 'markdown-dom' ||
      value.adapterId === 'html-page' ||
      value.adapterId === 'chromium-pdf' ||
      value.adapterId === 'image' ||
      value.adapterId === 'audio' ||
      value.adapterId === 'video' ||
      value.adapterId === 'xlsx-grid' ||
      value.adapterId === 'docx-dom' ||
      value.adapterId === 'unsupported') &&
    (value.status === 'empty' ||
      value.status === 'loading' ||
      value.status === 'ready' ||
      value.status === 'unavailable') &&
    (value.fileRef === null || isFileRef(value.fileRef)) &&
    (value.descriptor === null || isDescriptor(value.descriptor)) &&
    (value.error === null || isErrorPayload(value.error)) &&
    typeof value.selectedTextAvailable === 'boolean'
  );
};

export const sameOnlyPreviewSelection = (
  left: OnlyPreviewPreviewPresentation,
  right: OnlyPreviewPreviewPresentation
): boolean =>
  left.workspaceId === right.workspaceId &&
  left.fileRef?.workspaceId === right.fileRef?.workspaceId &&
  left.fileRef?.relativePath === right.fileRef?.relativePath;
