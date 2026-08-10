export const TRENCH_STRUCTURED_VALUE_PAGE_SIZE = 20;
export const TRENCH_STRUCTURED_STRING_PREVIEW_CODE_POINTS = 280;

export type TrenchStructuredValueKind =
  | 'array'
  | 'boolean'
  | 'null'
  | 'number'
  | 'object'
  | 'string';

export interface TrenchStructuredEntry {
  key: string;
  path: string;
  value: unknown;
}

export const trenchStructuredValueKind = (value: unknown): TrenchStructuredValueKind => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'object';
};

export const trenchStructuredEntries = (value: unknown, path: string): TrenchStructuredEntry[] => {
  if (Array.isArray(value)) {
    return value.map((item, index) => ({
      key: String(index + 1),
      path: `${path}[${index}]`,
      value: item
    }));
  }
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value as Record<string, unknown>).map(([key, item]) => ({
    key,
    path: path ? `${path}.${key}` : key,
    value: item
  }));
};

export const trenchStructuredStringPreview = (
  value: string
): {
  shortened: boolean;
  text: string;
} => {
  const codePoints = Array.from(value);
  if (codePoints.length <= TRENCH_STRUCTURED_STRING_PREVIEW_CODE_POINTS) {
    return { shortened: false, text: value };
  }
  return {
    shortened: true,
    text: `${codePoints.slice(0, TRENCH_STRUCTURED_STRING_PREVIEW_CODE_POINTS).join('')}…`
  };
};
