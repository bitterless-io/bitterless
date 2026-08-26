import { normalizeOnlyPreviewRelativePath } from '@shared/onlypreview/onlyPreview.contract';
import {
  ONLY_PREVIEW_SEARCH_MAX_BATCH_RESULTS,
  type OnlyPreviewGlobalSearchContentResult,
  type OnlyPreviewGlobalSearchFileResult,
  type OnlyPreviewGlobalSearchResult,
  type OnlyPreviewSearchBatchEvent,
  type OnlyPreviewSearchContentMatch
} from '@shared/onlypreview/onlyPreviewSearch.type';

const mediaTypes = new Set(['text', 'image', 'audio', 'video', 'pdf', 'unknown']);
const previewHints = new Set([
  'text',
  'pdf',
  'image',
  'audio',
  'video',
  'sheet',
  'document',
  'diagram',
  'unsupported'
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, expected: readonly string[]): boolean => {
  const keys = Reflect.ownKeys(value);
  return (
    keys.length === expected.length &&
    keys.every((key) => typeof key === 'string' && expected.includes(key))
  );
};

const isToken = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 256 && !value.includes('\0');

const isPath = (value: unknown, allowEmpty = false): value is string => {
  try {
    return normalizeOnlyPreviewRelativePath(value, { allowEmpty }) === value;
  } catch {
    return false;
  }
};

const parentOf = (relativePath: string): string => {
  const separator = relativePath.lastIndexOf('/');
  return separator < 0 ? '' : relativePath.slice(0, separator);
};

const nameOf = (relativePath: string): string =>
  relativePath.slice(relativePath.lastIndexOf('/') + 1);

const isContentMatch = (value: unknown): value is OnlyPreviewSearchContentMatch =>
  isRecord(value) &&
  hasExactKeys(value, ['highlightLength', 'highlightStart', 'snippetText']) &&
  typeof value.snippetText === 'string' &&
  value.snippetText.length <= 65_536 &&
  !value.snippetText.includes('\0') &&
  Number.isSafeInteger(value.highlightStart) &&
  (value.highlightStart as number) >= 0 &&
  Number.isSafeInteger(value.highlightLength) &&
  (value.highlightLength as number) > 0;

const isFileResult = (value: unknown): value is OnlyPreviewGlobalSearchFileResult => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'mediaType',
      'name',
      'nodeKind',
      'parentRelativePath',
      'previewHint',
      'relativePath',
      'resultToken',
      'section'
    ]) ||
    value.section !== 'files' ||
    !isToken(value.resultToken) ||
    !isPath(value.relativePath) ||
    !isPath(value.parentRelativePath, true) ||
    value.parentRelativePath !== parentOf(value.relativePath) ||
    value.name !== nameOf(value.relativePath) ||
    (value.nodeKind !== 'file' && value.nodeKind !== 'directory') ||
    !previewHints.has(String(value.previewHint)) ||
    !mediaTypes.has(String(value.mediaType))
  ) {
    return false;
  }
  return (
    value.nodeKind === 'file' ||
    (value.previewHint === 'unsupported' && value.mediaType === 'unknown')
  );
};

const isContentResult = (value: unknown): value is OnlyPreviewGlobalSearchContentResult =>
  isRecord(value) &&
  hasExactKeys(value, [
    'contentMatch',
    'fileName',
    'mediaType',
    'parentRelativePath',
    'relativePath',
    'resultToken',
    'section'
  ]) &&
  value.section === 'contents' &&
  isToken(value.resultToken) &&
  isPath(value.relativePath) &&
  isPath(value.parentRelativePath, true) &&
  value.parentRelativePath === parentOf(value.relativePath) &&
  value.fileName === nameOf(value.relativePath) &&
  value.mediaType === 'text' &&
  isContentMatch(value.contentMatch);

export const isOnlyPreviewGlobalSearchBatchEvent = (
  value: unknown
): value is OnlyPreviewSearchBatchEvent => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['batch', 'hostId']) ||
    !isToken(value.hostId) ||
    !isRecord(value.batch)
  ) {
    return false;
  }
  const batch = value.batch;
  return (
    hasExactKeys(batch, ['contents', 'files', 'generation', 'requestId', 'workspaceId']) &&
    isToken(batch.workspaceId) &&
    Number.isSafeInteger(batch.generation) &&
    (batch.generation as number) >= 0 &&
    isToken(batch.requestId) &&
    Array.isArray(batch.files) &&
    Array.isArray(batch.contents) &&
    batch.files.length + batch.contents.length <= ONLY_PREVIEW_SEARCH_MAX_BATCH_RESULTS &&
    batch.files.every(isFileResult) &&
    batch.contents.every(isContentResult)
  );
};

export const replaceGlobalSearchResult = <T extends OnlyPreviewGlobalSearchResult>(
  results: T[],
  next: T
): void => {
  const index = results.findIndex((result) => result.relativePath === next.relativePath);
  if (index < 0) results.push(next);
  else results[index] = next;
};

export const sameGlobalSearchResult = (
  left: OnlyPreviewGlobalSearchResult,
  right: OnlyPreviewGlobalSearchResult
): boolean => left.section === right.section && left.resultToken === right.resultToken;

export const sameGlobalSearchPath = (
  left: OnlyPreviewGlobalSearchResult,
  right: OnlyPreviewGlobalSearchResult
): boolean => left.section === right.section && left.relativePath === right.relativePath;

export const splitOnlyPreviewContentMatch = (match: OnlyPreviewSearchContentMatch): {
  before: string;
  highlight: string;
  after: string;
} => {
  const graphemes = [...new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(
    match.snippetText
  )].map((segment) => segment.segment);
  const start = Math.min(graphemes.length, match.highlightStart);
  const end = Math.min(graphemes.length, start + match.highlightLength);
  return {
    before: graphemes.slice(0, start).join(''),
    highlight: graphemes.slice(start, end).join(''),
    after: graphemes.slice(end).join('')
  };
};
