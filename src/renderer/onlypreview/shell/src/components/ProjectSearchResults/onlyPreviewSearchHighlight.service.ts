import type {
  OnlyPreviewSearchContentMatch,
  OnlyPreviewSearchResult
} from '@shared/onlypreview/onlyPreviewSearch.type';

export interface OnlyPreviewSearchHighlightParts {
  before: string;
  highlight: string;
  after: string;
}

export interface OnlyPreviewSearchDisplayRow {
  result: OnlyPreviewSearchResult;
  directory: string;
  snippet: OnlyPreviewSearchHighlightParts | null;
}

const segmenter =
  typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

const splitGraphemes = (value: string): string[] =>
  segmenter ? Array.from(segmenter.segment(value), (part) => part.segment) : Array.from(value);

export const splitOnlyPreviewSearchHighlight = (
  match: OnlyPreviewSearchContentMatch
): OnlyPreviewSearchHighlightParts | null => {
  const graphemes = splitGraphemes(match.snippetText);
  if (
    !Number.isSafeInteger(match.highlightStart) ||
    !Number.isSafeInteger(match.highlightLength) ||
    match.highlightStart < 0 ||
    match.highlightLength <= 0 ||
    match.highlightStart + match.highlightLength > graphemes.length
  ) {
    return null;
  }
  return {
    before: graphemes.slice(0, match.highlightStart).join(''),
    highlight: graphemes
      .slice(match.highlightStart, match.highlightStart + match.highlightLength)
      .join(''),
    after: graphemes.slice(match.highlightStart + match.highlightLength).join('')
  };
};

const directoryOf = (relativePath: string): string => {
  const separator = relativePath.lastIndexOf('/');
  return separator < 0 ? '' : relativePath.slice(0, separator);
};

export const buildOnlyPreviewSearchDisplayRows = (
  results: readonly OnlyPreviewSearchResult[]
): OnlyPreviewSearchDisplayRow[] =>
  results.map((result) => ({
    result,
    directory: directoryOf(result.relativePath),
    snippet:
      result.mediaType === 'text' && result.contentMatch
        ? splitOnlyPreviewSearchHighlight(result.contentMatch)
        : null
  }));
