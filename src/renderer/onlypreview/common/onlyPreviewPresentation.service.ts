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

const isDescriptor = (value: unknown): value is OnlyPreviewDescriptor => {
  if (!isRecord(value)) return false;
  return (
    typeof value.workspaceId === 'string' &&
    typeof value.relativePath === 'string' &&
    typeof value.name === 'string' &&
    typeof value.displayPath === 'string' &&
    typeof value.extension === 'string' &&
    (value.kind === 'text' ||
      value.kind === 'pdf' ||
      value.kind === 'image' ||
      value.kind === 'audio' ||
      value.kind === 'video' ||
      value.kind === 'unsupported') &&
    typeof value.mimeType === 'string' &&
    typeof value.language === 'string' &&
    Number.isSafeInteger(value.size) &&
    (value.size as number) >= 0 &&
    Number.isFinite(value.modifiedAt)
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
