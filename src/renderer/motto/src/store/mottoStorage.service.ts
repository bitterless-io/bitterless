export const MOTTO_STORAGE_KEY = 'bitterless.motto.items.v1' as const;

export interface MottoItem {
  id: string;
  title: string;
  subtitle: string;
}

export interface MottoStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type MottoStorageErrorCode = 'read-failed' | 'invalid-payload' | 'write-failed';

export class MottoStorageError extends Error {
  readonly code: MottoStorageErrorCode;

  constructor(code: MottoStorageErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'MottoStorageError';
    this.code = code;
  }
}

const expectMottoItem = (value: unknown, index: number): MottoItem => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new MottoStorageError(
      'invalid-payload',
      `Motto item at index ${index} must be an object.`
    );
  }

  const item = value as Record<string, unknown>;
  const keys = Object.keys(item).sort();
  if (keys.length !== 3 || keys[0] !== 'id' || keys[1] !== 'subtitle' || keys[2] !== 'title') {
    throw new MottoStorageError(
      'invalid-payload',
      `Motto item at index ${index} must contain exactly id, title, and subtitle.`
    );
  }

  if (
    typeof item.id !== 'string' ||
    typeof item.title !== 'string' ||
    typeof item.subtitle !== 'string'
  ) {
    throw new MottoStorageError(
      'invalid-payload',
      `Motto item at index ${index} has an invalid field.`
    );
  }

  const id = item.id.trim();
  const title = item.title.trim();
  const subtitle = item.subtitle.trim();
  if (!id || !title) {
    throw new MottoStorageError(
      'invalid-payload',
      `Motto item at index ${index} has an invalid field.`
    );
  }

  return { id, title, subtitle };
};

export const parseMottoItems = (value: unknown): MottoItem[] => {
  if (!Array.isArray(value)) {
    throw new MottoStorageError('invalid-payload', 'The persisted Motto value must be an array.');
  }

  const ids = new Set<string>();
  return value.map((item, index) => {
    const parsed = expectMottoItem(item, index);
    if (ids.has(parsed.id)) {
      throw new MottoStorageError(
        'invalid-payload',
        `Motto item at index ${index} has a duplicate ID.`
      );
    }
    ids.add(parsed.id);
    return parsed;
  });
};

export const loadMottoItems = (storage: MottoStorage): MottoItem[] => {
  let serialized: string | null;
  try {
    serialized = storage.getItem(MOTTO_STORAGE_KEY);
  } catch (error) {
    throw new MottoStorageError('read-failed', 'The persisted Motto value could not be read.', {
      cause: error
    });
  }
  if (serialized === null) return [];

  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch (error) {
    throw new MottoStorageError('invalid-payload', 'The persisted Motto value is malformed JSON.', {
      cause: error
    });
  }
  return parseMottoItems(value);
};

export const persistMottoItems = (
  storage: MottoStorage,
  items: readonly MottoItem[]
): MottoItem[] => {
  const validatedItems = parseMottoItems(items);
  const serialized = JSON.stringify(validatedItems);
  try {
    storage.setItem(MOTTO_STORAGE_KEY, serialized);
  } catch (error) {
    throw new MottoStorageError('write-failed', 'The Motto collection could not be persisted.', {
      cause: error
    });
  }
  return validatedItems;
};
