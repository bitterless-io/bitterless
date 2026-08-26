import {
  ONLY_PREVIEW_GLOBAL_SEARCH_PREVIEW_MAX_DIRECTORY_ENTRIES,
  ONLY_PREVIEW_GLOBAL_SEARCH_PREVIEW_MAX_TEXT_BYTES,
  ONLY_PREVIEW_GLOBAL_SEARCH_SECTION_MAX_RESULTS
} from '@shared/onlypreview/onlyPreviewSearch.type';

interface SearchExpectation {
  workspaceId: string | null;
  generation: number | null;
  requestId: string | null;
  maxResults?: number | null;
}

const MEDIA_TYPES = new Set(['text', 'image', 'audio', 'video', 'pdf', 'unknown']);
const PREVIEW_HINTS = new Set([
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
const NODE_KINDS = new Set(['file', 'directory', 'symlink']);
const segmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const exactKeys = (value: Record<string, unknown>, expected: readonly string[]): boolean => {
  const keys = Reflect.ownKeys(value);
  return (
    keys.length === expected.length &&
    keys.every((key) => typeof key === 'string' && expected.includes(key))
  );
};

const boundedString = (value: unknown, maximum = 16_384): value is string =>
  typeof value === 'string' && value.length <= maximum && !value.includes('\0');

const boundedToken = (value: unknown): value is string =>
  boundedString(value, 256) && value.length > 0;

const relativePath = (value: unknown, allowEmpty = false): value is string => {
  if (!boundedString(value) || (!allowEmpty && !value)) return false;
  if (value.startsWith('/') || value.includes('\\') || /^[a-zA-Z]:/u.test(value)) return false;
  if (!value) return allowEmpty;
  return !value.split('/').some((segment) => !segment || segment === '.' || segment === '..');
};

const parentOf = (value: string): string =>
  value.includes('/') ? value.slice(0, value.lastIndexOf('/')) : '';

const basenameOf = (value: string): string => value.slice(value.lastIndexOf('/') + 1);

const contentMatch = (value: unknown): boolean => {
  if (
    !isRecord(value) ||
    !exactKeys(value, ['highlightLength', 'highlightStart', 'snippetText']) ||
    !boundedString(value.snippetText, 65_536) ||
    !Number.isSafeInteger(value.highlightStart) ||
    (value.highlightStart as number) < 0 ||
    !Number.isSafeInteger(value.highlightLength) ||
    (value.highlightLength as number) < 1
  ) {
    return false;
  }
  const length = [...segmenter.segment(value.snippetText)].length;
  return (value.highlightStart as number) + (value.highlightLength as number) <= length;
};

const fileResult = (
  value: unknown
): value is Record<string, unknown> & { relativePath: string } => {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
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
    !boundedToken(value.resultToken) ||
    !relativePath(value.relativePath) ||
    !relativePath(value.parentRelativePath, true) ||
    value.parentRelativePath !== parentOf(value.relativePath) ||
    !boundedString(value.name, 4_096) ||
    value.name !== basenameOf(value.relativePath) ||
    (value.nodeKind !== 'file' && value.nodeKind !== 'directory') ||
    !PREVIEW_HINTS.has(String(value.previewHint)) ||
    !MEDIA_TYPES.has(String(value.mediaType))
  ) {
    return false;
  }
  return (
    (value.nodeKind === 'directory' &&
      value.previewHint === 'unsupported' &&
      value.mediaType === 'unknown') ||
    value.nodeKind === 'file'
  );
};

const contentResult = (
  value: unknown
): value is Record<string, unknown> & { relativePath: string } =>
  isRecord(value) &&
  exactKeys(value, [
    'contentMatch',
    'fileName',
    'mediaType',
    'parentRelativePath',
    'relativePath',
    'resultToken',
    'section'
  ]) &&
  value.section === 'contents' &&
  boundedToken(value.resultToken) &&
  relativePath(value.relativePath) &&
  relativePath(value.parentRelativePath, true) &&
  value.parentRelativePath === parentOf(value.relativePath) &&
  boundedString(value.fileName, 4_096) &&
  value.fileName === basenameOf(value.relativePath) &&
  value.mediaType === 'text' &&
  contentMatch(value.contentMatch);

const resultArray = (
  value: unknown,
  maximum: number,
  validate: (candidate: unknown) => candidate is Record<string, unknown> & { relativePath: string }
): boolean => {
  if (
    !Array.isArray(value) ||
    value.length > maximum ||
    Reflect.ownKeys(value).length !== value.length + 1
  ) {
    return false;
  }
  const paths = new Set<string>();
  const tokens = new Set<string>();
  return value.every((candidate) => {
    if (!validate(candidate) || paths.has(candidate.relativePath)) return false;
    const token = candidate.resultToken as string;
    if (tokens.has(token)) return false;
    paths.add(candidate.relativePath);
    tokens.add(token);
    return true;
  });
};

const commonEnvelope = (value: Record<string, unknown>, expectation: SearchExpectation): boolean =>
  value.workspaceId === expectation.workspaceId &&
  value.generation === expectation.generation &&
  value.requestId === expectation.requestId;

export const isOnlyPreviewGlobalSearchResponse = (
  value: unknown,
  expectation: SearchExpectation
): boolean => {
  const sectionMaximum = Math.min(
    ONLY_PREVIEW_GLOBAL_SEARCH_SECTION_MAX_RESULTS,
    expectation.maxResults ?? ONLY_PREVIEW_GLOBAL_SEARCH_SECTION_MAX_RESULTS
  );
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      'contents',
      'contentsTruncated',
      'files',
      'filesTruncated',
      'generation',
      'requestId',
      'workspaceId'
    ]) ||
    !commonEnvelope(value, expectation) ||
    typeof value.filesTruncated !== 'boolean' ||
    typeof value.contentsTruncated !== 'boolean' ||
    !resultArray(value.files, sectionMaximum, fileResult) ||
    !resultArray(value.contents, sectionMaximum, contentResult)
  ) {
    return false;
  }
  const tokens = [
    ...(value.files as Record<string, unknown>[]),
    ...(value.contents as Record<string, unknown>[])
  ].map((result) => result.resultToken);
  return new Set(tokens).size === tokens.length;
};

export const isOnlyPreviewGlobalSearchBatch = (
  value: unknown,
  expectation: SearchExpectation,
  maximum: number
): boolean =>
  isRecord(value) &&
  exactKeys(value, ['contents', 'files', 'generation', 'requestId', 'workspaceId']) &&
  commonEnvelope(value, expectation) &&
  resultArray(value.files, maximum, fileResult) &&
  resultArray(value.contents, maximum, contentResult) &&
  (value.files as unknown[]).length + (value.contents as unknown[]).length <= maximum;

const browseEntry = (value: unknown): boolean => {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      'directoryToken',
      'isText',
      'mediaType',
      'modifiedAt',
      'name',
      'nodeKind',
      'parentRelativePath',
      'previewHint',
      'relativePath',
      'size'
    ]) ||
    !relativePath(value.relativePath) ||
    !relativePath(value.parentRelativePath, true) ||
    value.parentRelativePath !== parentOf(value.relativePath) ||
    !boundedString(value.name, 4_096) ||
    value.name !== basenameOf(value.relativePath) ||
    !NODE_KINDS.has(String(value.nodeKind)) ||
    !Number.isSafeInteger(value.size) ||
    (value.size as number) < 0 ||
    !Number.isSafeInteger(value.modifiedAt) ||
    (value.modifiedAt as number) < 0 ||
    !PREVIEW_HINTS.has(String(value.previewHint)) ||
    !MEDIA_TYPES.has(String(value.mediaType)) ||
    typeof value.isText !== 'boolean'
  ) {
    return false;
  }
  return value.directoryToken === null;
};

export const isOnlyPreviewGlobalSearchPreview = (value: unknown): boolean => {
  if (!isRecord(value) || !boundedString(value.name, 4_096)) return false;
  if (value.kind === 'text') {
    return (
      exactKeys(value, ['adapter', 'kind', 'name', 'text', 'truncated']) &&
      (value.adapter === 'plain' ||
        value.adapter === 'markdown' ||
        value.adapter === 'html-static') &&
      boundedString(value.text, ONLY_PREVIEW_GLOBAL_SEARCH_PREVIEW_MAX_TEXT_BYTES) &&
      typeof value.truncated === 'boolean'
    );
  }
  if (value.kind === 'directory') {
    return (
      exactKeys(value, ['entries', 'kind', 'name', 'truncated']) &&
      Array.isArray(value.entries) &&
      value.entries.length <= ONLY_PREVIEW_GLOBAL_SEARCH_PREVIEW_MAX_DIRECTORY_ENTRIES &&
      Reflect.ownKeys(value.entries).length === value.entries.length + 1 &&
      value.entries.every(browseEntry) &&
      typeof value.truncated === 'boolean'
    );
  }
  if (value.kind === 'context') {
    return (
      exactKeys(value, ['after', 'before', 'kind', 'match', 'name', 'truncated']) &&
      boundedString(value.before, 65_536) &&
      boundedString(value.match, 65_536) &&
      value.match.length > 0 &&
      boundedString(value.after, 65_536) &&
      value.before.length + value.match.length + value.after.length <= 65_536 &&
      typeof value.truncated === 'boolean'
    );
  }
  return (
    value.kind === 'info' &&
    exactKeys(value, ['kind', 'mediaType', 'modifiedAt', 'name', 'previewHint', 'size']) &&
    PREVIEW_HINTS.has(String(value.previewHint)) &&
    MEDIA_TYPES.has(String(value.mediaType)) &&
    Number.isSafeInteger(value.size) &&
    (value.size as number) >= 0 &&
    Number.isSafeInteger(value.modifiedAt) &&
    (value.modifiedAt as number) >= 0
  );
};
