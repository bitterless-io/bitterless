/**
 * Generate search text from message content
 * - Remove markdown syntax
 * - Remove extra whitespace
 * - Convert to lowercase for case-insensitive search
 */
export const generateSearchText = (content: string): string => {
  return content
    .replace(/\n/g, ' ')
    .trim()
    .toLowerCase();
};
