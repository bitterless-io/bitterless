export type UnknownRecord = Record<string, unknown>;

export const isRecord = (value: unknown): value is UnknownRecord => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

export const hasStringFields = (value: UnknownRecord, fields: readonly string[]): boolean => (
  fields.every((field) => typeof value[field] === 'string')
);

export const hasNumberFields = (value: UnknownRecord, fields: readonly string[]): boolean => (
  fields.every((field) => typeof value[field] === 'number' && Number.isFinite(value[field]))
);

export const isNullableNumber = (value: unknown): boolean => (
  value === null || (typeof value === 'number' && Number.isFinite(value))
);

export const requireArray = <T>(
  value: unknown,
  label: string,
  isItem: (item: unknown) => item is T,
): T[] => {
  if (!Array.isArray(value) || !value.every(isItem)) {
    throw new Error(`[todo] ${label} returned an invalid required result`);
  }
  return value;
};

export const requireStringArray = (value: unknown, label: string): string[] => (
  requireArray(value, label, (item): item is string => typeof item === 'string')
);

export const requireVoidResult = (value: unknown, label: string): void => {
  if (value !== undefined && value !== null) {
    throw new Error(`[todo] ${label} returned an invalid void result`);
  }
};

export const requireOptionalItem = <T>(
  value: unknown,
  label: string,
  isItem: (item: unknown) => item is T,
): T | undefined => {
  if (value === undefined || value === null) return undefined;
  if (!isItem(value)) throw new Error(`[todo] ${label} returned an invalid optional result`);
  return value;
};

export const requireRecordMap = <T>(
  value: unknown,
  requiredKeys: readonly string[],
  label: string,
  isValue: (item: unknown) => item is T,
): Record<string, T> => {
  if (!isRecord(value) || !Object.values(value).every(isValue)) {
    throw new Error(`[todo] ${label} returned an invalid required result`);
  }
  for (const key of requiredKeys) {
    if (!Object.hasOwn(value, key) || !isValue(value[key])) {
      throw new Error(`[todo] ${label} omitted required key ${key}`);
    }
  }
  return value as Record<string, T>;
};
