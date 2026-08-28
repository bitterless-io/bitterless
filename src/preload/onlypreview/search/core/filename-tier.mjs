import { filenameFromPath, normalizeRelativePath, normalizeSearchText } from './normalization.mjs';

const compareRecords = (left, right) => {
  const leftPath = left.relativePath.normalize('NFC');
  const rightPath = right.relativePath.normalize('NFC');
  if (leftPath < rightPath) return -1;
  if (leftPath > rightPath) return 1;
  return left.relativePath.localeCompare(right.relativePath, 'und');
};

const recordBytes = (record) =>
  64 + 2 * (record.relativePath.length + record.fileName.length +
    record.normalizedPath.length + record.normalizedTitle.length + record.mediaType.length);

const mergeSortedRecords = (leftRecords, rightRecords) => {
  const merged = [];
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < leftRecords.length && rightIndex < rightRecords.length) {
    if (compareRecords(leftRecords[leftIndex], rightRecords[rightIndex]) <= 0) {
      merged.push(leftRecords[leftIndex]);
      leftIndex += 1;
    } else {
      merged.push(rightRecords[rightIndex]);
      rightIndex += 1;
    }
  }
  while (leftIndex < leftRecords.length) {
    merged.push(leftRecords[leftIndex]);
    leftIndex += 1;
  }
  while (rightIndex < rightRecords.length) {
    merged.push(rightRecords[rightIndex]);
    rightIndex += 1;
  }
  return merged;
};

export const hasHiddenDirectory = (relativePath) => {
  const segments = relativePath.replaceAll('\\', '/').split('/');
  segments.pop();
  return segments.some((segment) => segment.startsWith('.'));
};

export const hasHiddenPathSegment = (relativePath) =>
  relativePath.replaceAll('\\', '/').split('/').some((segment) => segment.startsWith('.'));

export const prepareFilenameRecord = (entry, id) => {
  const relativePath = entry.relativePath.replaceAll('\\', '/');
  return {
    id: Number(id),
    relativePath,
    fileName: filenameFromPath(relativePath),
    normalizedPath: normalizeRelativePath(relativePath),
    normalizedTitle: normalizeSearchText(filenameFromPath(relativePath)),
    mediaType: entry.mediaType,
    contentIndexed: entry.contentIndexed === true,
    inProject: !hasHiddenDirectory(relativePath),
    size: Number(entry.size),
    modifiedMs: Math.trunc(entry.modifiedMs),
  };
};

export class FilenameTier {
  constructor() {
    this.records = new Map();
    this.sortedVisibleRecords = [];
    this.estimatedBytes = 0;
  }

  replace(records) {
    this.records = new Map(records.map((record) => [record.relativePath, record]));
    this.rebuild();
  }

  clear() {
    this.records = new Map();
    this.sortedVisibleRecords = [];
    this.estimatedBytes = 0;
  }

  rebuild() {
    this.estimatedBytes = 0;
    this.sortedVisibleRecords = [];
    for (const record of this.records.values()) {
      this.estimatedBytes += recordBytes(record);
      if (!hasHiddenDirectory(record.relativePath)) this.sortedVisibleRecords.push(record);
    }
    this.sortedVisibleRecords.sort(compareRecords);
  }

  applyBatch({ upserts = [], deletePaths = [] }) {
    const upsertsByPath = new Map(upserts.map((record) => [record.relativePath, record]));
    const affectedPaths = new Set([...deletePaths, ...upsertsByPath.keys()]);
    if (affectedPaths.size === 0) return;

    for (const relativePath of affectedPaths) {
      const previous = this.records.get(relativePath);
      if (previous) this.estimatedBytes -= recordBytes(previous);
      this.records.delete(relativePath);
    }
    for (const record of upsertsByPath.values()) {
      this.records.set(record.relativePath, record);
      this.estimatedBytes += recordBytes(record);
    }

    const retainedVisibleRecords = this.sortedVisibleRecords.filter(
      (record) => !affectedPaths.has(record.relativePath)
    );
    const insertedVisibleRecords = [...upsertsByPath.values()]
      .filter((record) => !hasHiddenDirectory(record.relativePath))
      .sort(compareRecords);
    this.sortedVisibleRecords = mergeSortedRecords(
      retainedVisibleRecords,
      insertedVisibleRecords
    );
    this.estimatedBytes = Math.max(0, this.estimatedBytes);
  }

  upsert(record) {
    this.applyBatch({ upserts: [record] });
  }

  delete(relativePath) {
    this.applyBatch({ deletePaths: [relativePath] });
  }

  get(relativePath) {
    return this.records.get(relativePath);
  }

  visible() {
    return this.sortedVisibleRecords;
  }

  forScope(scope) {
    if (scope?.kind === 'project' ||
        (scope?.kind === 'directory' && scope.relativePath === '')) {
      return this.sortedVisibleRecords;
    }
    if (scope?.kind !== 'directory' || typeof scope.relativePath !== 'string') {
      throw new TypeError('Invalid search scope');
    }
    const prefix = `${scope.relativePath}/`;
    const source = hasHiddenPathSegment(scope.relativePath)
      ? this.records.values()
      : this.sortedVisibleRecords;
    return [...source]
      .filter((record) => record.relativePath.startsWith(prefix))
      .sort(compareRecords);
  }

  isVisible(relativePath) {
    return this.records.get(relativePath)?.inProject === true;
  }

  statistics() {
    return {
      recordCount: this.records.size,
      visibleRecordCount: this.sortedVisibleRecords.length,
      estimatedBytes: Math.max(0, this.estimatedBytes),
    };
  }
}
