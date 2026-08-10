import { normalizeOnlyPreviewRelativePath } from '@shared/onlypreview/onlyPreview.contract';
import type { OnlyPreviewIndexEntry } from '@shared/onlypreview/onlyPreview.types';
import type { OnlyPreviewSearchSnapshotEvent } from '@shared/onlypreview/onlyPreviewSearch.type';

const EVENT_KEYS = ['hostId', 'snapshot'] as const;
const SNAPSHOT_KEYS = ['workspaceId', 'generation', 'state', 'index', 'memory'] as const;
const INDEX_KEYS = ['workspaceId', 'entries', 'truncated', 'limit'] as const;
const ENTRY_KEYS = [
  'relativePath',
  'parentRelativePath',
  'name',
  'nodeKind',
  'size',
  'modifiedAt',
  'previewHint',
  'mediaType',
  'isText'
] as const;
const MEMORY_KEYS = [
  'measurementComplete',
  'processRssBytes',
  'workerHeapUsedBytes',
  'workerExternalBytes',
  'treeMetadataEntryCount',
  'treeMetadataEstimatedBytes',
  'filenameTierEstimatedBytes',
  'diskIndexBytes',
  'runtimeOneGiBWarning',
  'runtimeTwoGiBLimitExceeded'
] as const;
const NODE_KINDS = new Set(['file', 'directory', 'symlink']);
const PREVIEW_HINTS = new Set(['text', 'pdf', 'image', 'audio', 'video', 'unsupported']);
const MEDIA_TYPES = new Set(['text', 'image', 'audio', 'video', 'pdf', 'unknown']);
const INDEX_STATES = new Set(['building', 'reconciling', 'ready']);
const MEMORY_NUMBER_KEYS = [
  'processRssBytes',
  'workerHeapUsedBytes',
  'workerExternalBytes',
  'treeMetadataEntryCount',
  'treeMetadataEstimatedBytes',
  'filenameTierEstimatedBytes',
  'diskIndexBytes'
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, expectedKeys: readonly string[]): boolean => {
  const keys = Reflect.ownKeys(value);
  return (
    keys.length === expectedKeys.length &&
    keys.every((key) => typeof key === 'string' && expectedKeys.includes(key))
  );
};

const isBoundedIdentifier = (value: unknown): value is string =>
  typeof value === 'string' && value.length >= 16 && value.length <= 256 && !value.includes('\0');

const isNonnegativeFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

const isNonnegativeSafeInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;

const isNormalizedRelativePath = (value: unknown, allowEmpty = false): value is string => {
  try {
    return normalizeOnlyPreviewRelativePath(value, { allowEmpty }) === value;
  } catch {
    return false;
  }
};

export const getOnlyPreviewSearchMediaType = (
  previewHint: OnlyPreviewIndexEntry['previewHint']
): OnlyPreviewIndexEntry['mediaType'] => (previewHint === 'unsupported' ? 'unknown' : previewHint);

const isOnlyPreviewIndexEntry = (value: unknown): value is OnlyPreviewIndexEntry => {
  if (!isRecord(value) || !hasExactKeys(value, ENTRY_KEYS)) return false;
  if (
    !isNormalizedRelativePath(value.relativePath) ||
    !isNormalizedRelativePath(value.parentRelativePath, true) ||
    typeof value.name !== 'string' ||
    !NODE_KINDS.has(value.nodeKind as string) ||
    !isNonnegativeFiniteNumber(value.size) ||
    !isNonnegativeFiniteNumber(value.modifiedAt) ||
    !PREVIEW_HINTS.has(value.previewHint as string) ||
    !MEDIA_TYPES.has(value.mediaType as string) ||
    typeof value.isText !== 'boolean'
  ) {
    return false;
  }

  const relativePath = value.relativePath;
  const separatorIndex = relativePath.lastIndexOf('/');
  const expectedParent = separatorIndex < 0 ? '' : relativePath.slice(0, separatorIndex);
  const expectedName = relativePath.slice(separatorIndex + 1);
  if (value.parentRelativePath !== expectedParent || value.name !== expectedName) return false;

  if (value.nodeKind !== 'file') {
    return value.previewHint === 'unsupported' && value.mediaType === 'unknown' && !value.isText;
  }
  return (
    value.mediaType ===
      getOnlyPreviewSearchMediaType(value.previewHint as OnlyPreviewIndexEntry['previewHint']) &&
    value.isText === (value.mediaType === 'text')
  );
};

const isOnlyPreviewIndexEntryArray = (value: unknown): value is OnlyPreviewIndexEntry[] => {
  if (!Array.isArray(value)) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1) return false;
  if (
    keys.some((key) => {
      if (key === 'length') return false;
      if (typeof key !== 'string') return true;
      const index = Number(key);
      return (
        !Number.isSafeInteger(index) || index < 0 || index >= value.length || String(index) !== key
      );
    })
  ) {
    return false;
  }
  return value.every(isOnlyPreviewIndexEntry);
};

const isOnlyPreviewSearchMemory = (value: unknown): boolean => {
  if (!isRecord(value) || !hasExactKeys(value, MEMORY_KEYS)) return false;
  if (
    typeof value.measurementComplete !== 'boolean' ||
    typeof value.runtimeOneGiBWarning !== 'boolean' ||
    typeof value.runtimeTwoGiBLimitExceeded !== 'boolean'
  ) {
    return false;
  }
  return MEMORY_NUMBER_KEYS.every(
    (key) => value[key] === null || isNonnegativeFiniteNumber(value[key])
  );
};

const isOnlyPreviewSearchSnapshot = (value: unknown): boolean => {
  if (!isRecord(value) || !hasExactKeys(value, SNAPSHOT_KEYS)) return false;
  if (
    !isBoundedIdentifier(value.workspaceId) ||
    !isNonnegativeSafeInteger(value.generation) ||
    !INDEX_STATES.has(value.state as string) ||
    !isRecord(value.index) ||
    !hasExactKeys(value.index, INDEX_KEYS) ||
    value.index.workspaceId !== value.workspaceId ||
    !isOnlyPreviewIndexEntryArray(value.index.entries) ||
    typeof value.index.truncated !== 'boolean' ||
    !isNonnegativeSafeInteger(value.index.limit) ||
    value.index.entries.length > value.index.limit
  ) {
    return false;
  }
  return isOnlyPreviewSearchMemory(value.memory);
};

export const isOnlyPreviewSearchSnapshotEvent = (
  value: unknown
): value is OnlyPreviewSearchSnapshotEvent => {
  try {
    return (
      isRecord(value) &&
      hasExactKeys(value, EVENT_KEYS) &&
      isBoundedIdentifier(value.hostId) &&
      isOnlyPreviewSearchSnapshot(value.snapshot)
    );
  } catch {
    return false;
  }
};
