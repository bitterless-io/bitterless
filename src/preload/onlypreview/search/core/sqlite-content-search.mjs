import { MAX_RESULTS, SEARCH_WORK_SLICE_MS } from './constants.mjs';
import { createPlainTextSnippet, normalizeSearchText } from './normalization.mjs';
import { clampSearchResultLimit, createOnlyPreviewSearchResult } from './search-contract.mjs';

export const searchOnlyPreviewIndexedContents = async (
  index,
  queryValue,
  { maxResults = MAX_RESULTS, isCancelled = () => false, onResult, scope } = {}
) => {
  const normalizedQuery = normalizeSearchText(queryValue);
  const cap = clampSearchResultLimit(maxResults);
  const scopePlan = index.scopePlan(scope);
  if (!normalizedQuery || cap === 0) {
    return { results: [], truncated: false, cancelled: false };
  }
  const selected = [];
  const matchedPaths = new Set();
  let candidatesSinceYield = 0;
  let searchSliceStartedAt = performance.now();
  const yieldIfDue = async () => {
    candidatesSinceYield += 1;
    if (
      candidatesSinceYield < 128 &&
      performance.now() - searchSliceStartedAt < SEARCH_WORK_SLICE_MS
    ) {
      return;
    }
    candidatesSinceYield = 0;
    await new Promise((resolveYield) => setImmediate(resolveYield));
    searchSliceStartedAt = performance.now();
  };
  const accept = (result) => {
    if (!result || matchedPaths.has(result.relativePath)) return false;
    matchedPaths.add(result.relativePath);
    if (selected.length >= cap) return true;
    selected.push(result);
    onResult?.(result);
    return false;
  };
  const { engine, rows } = index.candidateIterator(normalizedQuery, scopePlan);
  if (engine === 'exact-file-fallback') {
    for (const file of index.selectContentFiles[scopePlan.key].iterate(...scopePlan.params)) {
      await yieldIfDue();
      if (isCancelled()) return { results: [], truncated: false, cancelled: true };
      const source = [...index.selectCoreTextByFile.iterate(file.id)]
        .map((row) => row.core_text)
        .join('');
      if (!normalizeSearchText(source).includes(normalizedQuery)) continue;
      const contentMatch = createPlainTextSnippet(source, normalizedQuery);
      if (!contentMatch) continue;
      if (
        accept(
          createOnlyPreviewSearchResult({
            fileName: file.file_name,
            relativePath: file.relative_path,
            mediaType: file.media_type,
            contentMatch
          })
        )
      ) {
        return { results: selected, truncated: true, cancelled: false, engine };
      }
    }
  } else {
    for (const candidate of rows) {
      await yieldIfDue();
      if (isCancelled()) return { results: [], truncated: false, cancelled: true };
      if (matchedPaths.has(candidate.relative_path)) continue;
      if (accept(index.contentResult(candidate, normalizedQuery))) {
        return { results: selected, truncated: true, cancelled: false, engine };
      }
    }
  }
  return { results: selected, truncated: false, cancelled: false, engine };
};
