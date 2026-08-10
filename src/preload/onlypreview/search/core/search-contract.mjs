import { MAX_RESULTS } from './constants.mjs';

const RESULT_KEYS = ['contentMatch', 'fileName', 'mediaType', 'relativePath'];
const MATCH_KEYS = ['highlightLength', 'highlightStart', 'snippetText'];
const MEDIA_TYPES = new Set(['text', 'image', 'audio', 'video', 'pdf', 'unknown']);
const graphemeSegmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });

const hasExactKeys = (value, keys) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
};

export const isOnlyPreviewSearchContentMatch = (value) => {
  if (!hasExactKeys(value, MATCH_KEYS) ||
      typeof value.snippetText !== 'string' ||
      !Number.isInteger(value.highlightStart) || value.highlightStart < 0 ||
      !Number.isInteger(value.highlightLength) || value.highlightLength < 1) return false;
  const length = [...graphemeSegmenter.segment(value.snippetText)].length;
  return value.highlightStart + value.highlightLength <= length;
};

export const isOnlyPreviewSearchResult = (value) =>
  hasExactKeys(value, RESULT_KEYS) &&
  typeof value.fileName === 'string' &&
  typeof value.relativePath === 'string' &&
  MEDIA_TYPES.has(value.mediaType) &&
  (value.contentMatch === null || isOnlyPreviewSearchContentMatch(value.contentMatch));

export const createOnlyPreviewSearchResult = ({
  fileName,
  relativePath,
  mediaType,
  contentMatch = null,
}) => {
  const result = {
    fileName: String(fileName ?? ''),
    relativePath: String(relativePath ?? ''),
    mediaType: String(mediaType ?? 'unknown'),
    contentMatch: contentMatch === null ? null : {
      snippetText: String(contentMatch.snippetText ?? ''),
      highlightStart: contentMatch.highlightStart,
      highlightLength: contentMatch.highlightLength,
    },
  };
  if (!isOnlyPreviewSearchResult(result)) throw new TypeError('Invalid search result');
  return result;
};

export const compareOnlyPreviewSearchResults = (left, right) => {
  const leftPath = left.relativePath.normalize('NFC');
  const rightPath = right.relativePath.normalize('NFC');
  if (leftPath < rightPath) return -1;
  if (leftPath > rightPath) return 1;
  return left.relativePath.localeCompare(right.relativePath, 'und');
};

export const clampSearchResultLimit = (value) => {
  if (!Number.isFinite(value)) return MAX_RESULTS;
  return Math.max(0, Math.min(MAX_RESULTS, Math.trunc(value)));
};
