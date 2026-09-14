import type { BrowserHistoryEntry } from '@maestro-shared/browserHistory.api';

export const BROWSER_HISTORY_LIMIT = 1000;
export const BROWSER_HISTORY_SUGGESTION_LIMIT = 8;
const MAX_HISTORY_URL_LENGTH = 16384;
const MAX_HISTORY_FAVICON_LENGTH = 131072;

export const normalizeBrowserHistoryUrl = (input: string): string | null => {
  try {
    if (input.length > MAX_HISTORY_URL_LENGTH) return null;
    const url = new URL(input.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.username = '';
    url.password = '';
    return url.href.length <= MAX_HISTORY_URL_LENGTH ? url.href : null;
  } catch {
    return null;
  }
};

export const normalizeBrowserHistoryFavicon = (input: string | undefined): string => {
  const value = input?.trim() ?? '';
  if (value.length > MAX_HISTORY_FAVICON_LENGTH) return '';
  if (/^data:image\/(?:png|jpeg|gif|webp|x-icon|vnd\.microsoft\.icon|svg\+xml)(?:;|,)/i.test(value)) {
    return value;
  }
  return normalizeBrowserHistoryUrl(value) ?? '';
};

const decodeSearchText = (value: string): string =>
  value.replace(/(?:%[0-9a-f]{2})+/gi, (encoded) => {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  });

const searchText = (value: string): string => value.normalize('NFC').toLowerCase();

export const searchBrowserHistoryEntries = (
  entries: BrowserHistoryEntry[],
  query: string
): BrowserHistoryEntry[] => {
  const needle = searchText(query.trim().slice(0, 2048));
  const needles = [needle, searchText(decodeSearchText(needle))];
  return entries
    .map((entry) => {
      const url = searchText(entry.url);
      const title = searchText(entry.title);
      const fields = [url, url.replace(/^https?:\/\//, ''), title].flatMap((value) => [
        value,
        searchText(decodeSearchText(value))
      ]);
      const rank = !needle
        ? 0
        : fields.some((value) => needles.some((term) => value === term))
          ? 0
          : fields.some((value) => needles.some((term) => value.startsWith(term)))
            ? 1
            : fields.some((value) => needles.some((term) => value.includes(term)))
              ? 2
              : -1;
      return { entry, rank };
    })
    .filter(({ rank }) => rank >= 0)
    .sort((left, right) =>
      left.rank - right.rank ||
      right.entry.lastVisitedAt - left.entry.lastVisitedAt ||
      right.entry.visitCount - left.entry.visitCount ||
      (left.entry.url < right.entry.url ? -1 : left.entry.url > right.entry.url ? 1 : 0)
    )
    .slice(0, BROWSER_HISTORY_SUGGESTION_LIMIT)
    .map(({ entry }) => entry);
};
