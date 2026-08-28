import { normalizeOnlyPreviewRelativePath } from '@shared/onlypreview/onlyPreview.contract';
import type {
  OnlyPreviewBrowseEntry,
  OnlyPreviewBrowseListing,
  OnlyPreviewBrowseListingEvent
} from '@shared/onlypreview/onlyPreviewSearch.type';

const LISTING_KEYS = [
  'workspaceId',
  'generation',
  'directoryToken',
  'relativePath',
  'entries'
] as const;
const ENTRY_KEYS = [
  'relativePath',
  'parentRelativePath',
  'name',
  'nodeKind',
  'size',
  'modifiedAt',
  'previewHint',
  'mediaType',
  'isText',
  'directoryToken',
  'searchExcluded'
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, expected: readonly string[]): boolean => {
  const keys = Reflect.ownKeys(value);
  return (
    keys.length === expected.length &&
    keys.every((key) => typeof key === 'string' && expected.includes(key))
  );
};

const isBoundedIdentifier = (value: unknown): value is string =>
  typeof value === 'string' && value.length >= 1 && value.length <= 256 && !value.includes('\0');

const isNonnegativeFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

const isNonnegativeSafeInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;

const isNormalizedPath = (value: unknown, allowEmpty = false): value is string => {
  try {
    return normalizeOnlyPreviewRelativePath(value, { allowEmpty }) === value;
  } catch {
    return false;
  }
};

const isBrowseEntry = (value: unknown, parentPath: string): value is OnlyPreviewBrowseEntry => {
  if (!isRecord(value) || !hasExactKeys(value, ENTRY_KEYS)) return false;
  if (
    !isNormalizedPath(value.relativePath) ||
    value.parentRelativePath !== parentPath ||
    typeof value.name !== 'string' ||
    !['file', 'directory', 'symlink'].includes(String(value.nodeKind)) ||
    !isNonnegativeFiniteNumber(value.size) ||
    !isNonnegativeFiniteNumber(value.modifiedAt) ||
    !['text', 'pdf', 'image', 'audio', 'video', 'unsupported'].includes(
      String(value.previewHint)
    ) ||
    !['text', 'image', 'audio', 'video', 'pdf', 'unknown'].includes(String(value.mediaType)) ||
    typeof value.isText !== 'boolean' ||
    typeof value.searchExcluded !== 'boolean'
  ) {
    return false;
  }
  const separator = value.relativePath.lastIndexOf('/');
  const expectedParent = separator < 0 ? '' : value.relativePath.slice(0, separator);
  const expectedName = value.relativePath.slice(separator + 1);
  if (expectedParent !== parentPath || value.name !== expectedName) return false;
  if (value.nodeKind === 'directory') {
    return (
      isBoundedIdentifier(value.directoryToken) &&
      value.size === 0 &&
      value.previewHint === 'unsupported' &&
      value.mediaType === 'unknown' &&
      !value.isText
    );
  }
  if (value.directoryToken !== null) return false;
  if (value.nodeKind === 'symlink') {
    return (
      value.size === 0 &&
      value.previewHint === 'unsupported' &&
      value.mediaType === 'unknown' &&
      !value.isText &&
      value.searchExcluded === false
    );
  }
  const expectedMediaType = value.previewHint === 'unsupported' ? 'unknown' : value.previewHint;
  return value.mediaType === expectedMediaType && value.isText === (value.mediaType === 'text');
};

export const isOnlyPreviewBrowseListing = (value: unknown): value is OnlyPreviewBrowseListing => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, LISTING_KEYS) ||
    !isBoundedIdentifier(value.workspaceId) ||
    !isNonnegativeSafeInteger(value.generation) ||
    !isBoundedIdentifier(value.directoryToken) ||
    !isNormalizedPath(value.relativePath, true) ||
    !Array.isArray(value.entries)
  ) {
    return false;
  }
  const keys = Reflect.ownKeys(value.entries);
  if (
    keys.length !== value.entries.length + 1 ||
    keys.some((key) => {
      if (key === 'length') return false;
      if (typeof key !== 'string') return true;
      const index = Number(key);
      return !Number.isSafeInteger(index) || index < 0 || String(index) !== key;
    })
  ) {
    return false;
  }
  const parentPath = value.relativePath;
  const paths = new Set<string>();
  const tokens = new Set<string>([value.directoryToken]);
  return value.entries.every((entry) => {
    if (!isBrowseEntry(entry, parentPath) || paths.has(entry.relativePath)) return false;
    paths.add(entry.relativePath);
    if (entry.directoryToken) {
      if (tokens.has(entry.directoryToken)) return false;
      tokens.add(entry.directoryToken);
    }
    return true;
  });
};

export const isOnlyPreviewBrowseListingEvent = (
  value: unknown
): value is OnlyPreviewBrowseListingEvent =>
  isRecord(value) &&
  hasExactKeys(value, ['hostId', 'listing']) &&
  isBoundedIdentifier(value.hostId) &&
  isOnlyPreviewBrowseListing(value.listing);
