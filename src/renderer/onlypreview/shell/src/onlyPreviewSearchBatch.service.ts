import {
  ONLY_PREVIEW_SEARCH_MAX_BATCH_RESULTS,
  type OnlyPreviewSearchBatchEvent,
  type OnlyPreviewSearchContentMatch,
  type OnlyPreviewSearchMediaType,
  type OnlyPreviewSearchResult
} from '@shared/onlypreview/onlyPreviewSearch.type';
import { normalizeOnlyPreviewRelativePath } from '@shared/onlypreview/onlyPreview.contract';

const SEARCH_MEDIA_TYPES = new Set<OnlyPreviewSearchMediaType>([
  'text',
  'image',
  'audio',
  'video',
  'pdf',
  'unknown'
]);

const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};

const isContentMatch = (value: unknown): value is OnlyPreviewSearchContentMatch => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const match = value as Record<string, unknown>;
  return (
    hasExactKeys(match, ['highlightLength', 'highlightStart', 'snippetText']) &&
    typeof match.snippetText === 'string' &&
    Number.isSafeInteger(match.highlightStart) &&
    (match.highlightStart as number) >= 0 &&
    Number.isSafeInteger(match.highlightLength) &&
    (match.highlightLength as number) > 0
  );
};

const isSearchResult = (value: unknown): value is OnlyPreviewSearchResult => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  if (
    !hasExactKeys(result, ['contentMatch', 'fileName', 'mediaType', 'relativePath']) ||
    typeof result.relativePath !== 'string'
  ) {
    return false;
  }
  try {
    normalizeOnlyPreviewRelativePath(result.relativePath);
  } catch {
    return false;
  }
  return (
    typeof result.fileName === 'string' &&
    result.fileName === result.relativePath.slice(result.relativePath.lastIndexOf('/') + 1) &&
    typeof result.mediaType === 'string' &&
    SEARCH_MEDIA_TYPES.has(result.mediaType as OnlyPreviewSearchMediaType) &&
    (result.contentMatch === null ||
      (result.mediaType === 'text' && isContentMatch(result.contentMatch)))
  );
};

export const isOnlyPreviewSearchBatchEvent = (
  value: unknown
): value is OnlyPreviewSearchBatchEvent => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  if (
    !hasExactKeys(event, ['batch', 'hostId']) ||
    typeof event.hostId !== 'string' ||
    !event.hostId ||
    event.hostId.length > 128 ||
    !event.batch ||
    typeof event.batch !== 'object' ||
    Array.isArray(event.batch)
  ) {
    return false;
  }
  const batch = event.batch as Record<string, unknown>;
  return (
    hasExactKeys(batch, ['generation', 'requestId', 'results', 'workspaceId']) &&
    typeof batch.workspaceId === 'string' &&
    !!batch.workspaceId &&
    batch.workspaceId.length <= 256 &&
    Number.isSafeInteger(batch.generation) &&
    (batch.generation as number) >= 0 &&
    typeof batch.requestId === 'string' &&
    !!batch.requestId &&
    batch.requestId.length <= 256 &&
    Array.isArray(batch.results) &&
    batch.results.length <= ONLY_PREVIEW_SEARCH_MAX_BATCH_RESULTS &&
    batch.results.every(isSearchResult)
  );
};

const sameContentMatch = (
  left: OnlyPreviewSearchContentMatch | null,
  right: OnlyPreviewSearchContentMatch | null
): boolean =>
  left === right ||
  (!!left &&
    !!right &&
    left.snippetText === right.snippetText &&
    left.highlightStart === right.highlightStart &&
    left.highlightLength === right.highlightLength);

export const areOnlyPreviewSearchResultsEqual = (
  left: readonly OnlyPreviewSearchResult[],
  right: readonly OnlyPreviewSearchResult[]
): boolean =>
  left.length === right.length &&
  left.every((result, index) => {
    const candidate = right[index];
    return (
      result.fileName === candidate.fileName &&
      result.relativePath === candidate.relativePath &&
      result.mediaType === candidate.mediaType &&
      sameContentMatch(result.contentMatch, candidate.contentMatch)
    );
  });
