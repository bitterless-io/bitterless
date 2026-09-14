/** Keep the original text as Google's query, including Unicode, spaces, percent and ampersands. */
export const googleSearchUrl = (query: string): string => query.trim()
  ? `https://www.google.com/search?q=${encodeURIComponent(query)}`
  : '';

/** The existing main navigation remains the authority for URLs and local preview paths. */
export const addressSubmissionTarget = (input: string): string => {
  const value = input.trim();
  if (!value) return '';
  if (/^(?:[a-z][a-z\d+.-]*:\/\/|\/|~\/|[a-z]:[\\/]|\\\\)/i.test(value)) return value;
  if (/^(?:localhost|\[[a-f\d:]+\]|(?:[^\s./:]+\.)+[^\s./:]+|[^\s/:]+:\d+)(?::\d+)?(?:[/?#].*)?$/i.test(value)) return value;
  return googleSearchUrl(input);
};
