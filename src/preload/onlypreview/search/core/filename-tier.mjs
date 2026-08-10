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

  upsert(record) {
    this.records.set(record.relativePath, record);
    this.rebuild();
  }

  delete(relativePath) {
    this.records.delete(relativePath);
    this.rebuild();
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
