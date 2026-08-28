import type {
  OnlyPreviewIndex,
  OnlyPreviewIndexEntry
} from '@shared/onlypreview/onlyPreview.types';
import type { OnlyPreviewTreeRow } from './onlyPreviewShell.type';

export const getOnlyPreviewParentPath = (relativePath: string): string => {
  const separator = relativePath.lastIndexOf('/');
  return separator < 0 ? '' : relativePath.slice(0, separator);
};

export const resolveOnlyPreviewCurrentDirectory = (
  index: OnlyPreviewIndex | null,
  treeSelectedRelativePath: string | null,
  previewSelectedRelativePath: string
): string => {
  if (treeSelectedRelativePath === '') return '';
  if (treeSelectedRelativePath !== null) {
    const selectedEntry = index?.entries.find(
      (entry) => entry.relativePath === treeSelectedRelativePath
    );
    if (selectedEntry?.nodeKind === 'directory') return treeSelectedRelativePath;
    if (selectedEntry) return getOnlyPreviewParentPath(treeSelectedRelativePath);
  }
  return getOnlyPreviewParentPath(previewSelectedRelativePath);
};

export const resolveOnlyPreviewTreeFocusPath = (
  rows: readonly OnlyPreviewTreeRow[],
  focusedRelativePath: string,
  selectedRelativePath: string | null
): string => {
  if (rows.some((row) => row.entry.relativePath === focusedRelativePath)) {
    return focusedRelativePath;
  }
  if (
    selectedRelativePath !== null &&
    rows.some((row) => row.entry.relativePath === selectedRelativePath)
  ) {
    return selectedRelativePath;
  }
  return rows[0]?.entry.relativePath || '';
};

const buildOnlyPreviewChildRows = (
  index: OnlyPreviewIndex,
  expandedPaths: ReadonlySet<string>,
  searchExcludedPaths: ReadonlySet<string>
): OnlyPreviewTreeRow[] => {
  const entriesByParent = new Map<string, OnlyPreviewIndexEntry[]>();
  for (const entry of index.entries) {
    const siblings = entriesByParent.get(entry.parentRelativePath) || [];
    siblings.push(entry);
    entriesByParent.set(entry.parentRelativePath, siblings);
  }
  const rows: OnlyPreviewTreeRow[] = [];
  const visit = (parent: string, depth: number): void => {
    for (const entry of entriesByParent.get(parent) || []) {
      const expanded = expandedPaths.has(entry.relativePath);
      rows.push({
        entry,
        depth,
        expanded,
        hasChildren: entry.nodeKind === 'directory',
        searchExcluded: searchExcludedPaths.has(entry.relativePath)
      });
      if (entry.nodeKind === 'directory' && expanded) visit(entry.relativePath, depth + 1);
    }
  };
  visit('', 1);
  return rows;
};

export const buildOnlyPreviewRootedTreeRows = (
  index: OnlyPreviewIndex | null,
  rootName: string,
  expandedPaths: ReadonlySet<string>,
  searchExcludedPaths: ReadonlySet<string> = new Set()
): OnlyPreviewTreeRow[] => {
  if (!index || !rootName) return [];
  const expanded = expandedPaths.has('');
  const rootEntry: OnlyPreviewIndexEntry = {
    relativePath: '',
    parentRelativePath: '',
    name: rootName,
    nodeKind: 'directory',
    size: 0,
    modifiedAt: 0,
    previewHint: 'unsupported',
    mediaType: 'unknown',
    isText: false
  };
  return [
    { entry: rootEntry, depth: 0, expanded, hasChildren: true, searchExcluded: false },
    ...(expanded ? buildOnlyPreviewChildRows(index, expandedPaths, searchExcludedPaths) : [])
  ];
};

export type OnlyPreviewTreeNavigationKey =
  | 'ArrowDown'
  | 'ArrowUp'
  | 'ArrowLeft'
  | 'ArrowRight'
  | 'Home'
  | 'End';

export const moveOnlyPreviewTreeFocus = (
  rows: readonly OnlyPreviewTreeRow[],
  currentPath: string,
  key: OnlyPreviewTreeNavigationKey
): { relativePath: string; toggleDirectory?: string } => {
  if (!rows.length) return { relativePath: '' };
  const currentIndex = Math.max(
    0,
    rows.findIndex((row) => row.entry.relativePath === currentPath)
  );
  const current = rows[currentIndex];
  if (key === 'ArrowDown') {
    return { relativePath: rows[Math.min(rows.length - 1, currentIndex + 1)].entry.relativePath };
  }
  if (key === 'ArrowUp') {
    return { relativePath: rows[Math.max(0, currentIndex - 1)].entry.relativePath };
  }
  if (key === 'Home') return { relativePath: rows[0].entry.relativePath };
  if (key === 'End') return { relativePath: rows.at(-1)?.entry.relativePath || '' };
  if (key === 'ArrowRight' && current.entry.nodeKind === 'directory') {
    if (current.hasChildren && !current.expanded) {
      return {
        relativePath: current.entry.relativePath,
        toggleDirectory: current.entry.relativePath
      };
    }
    const firstChild = rows[currentIndex + 1];
    if (firstChild && firstChild.depth > current.depth) {
      return { relativePath: firstChild.entry.relativePath };
    }
  }
  if (key === 'ArrowLeft') {
    if (current.entry.nodeKind === 'directory' && current.expanded) {
      return {
        relativePath: current.entry.relativePath,
        toggleDirectory: current.entry.relativePath
      };
    }
    if (current.entry.relativePath !== '') {
      const parent = rows.find(
        (row) => row.entry.relativePath === current.entry.parentRelativePath
      );
      if (parent) return { relativePath: parent.entry.relativePath };
    }
  }
  return { relativePath: current.entry.relativePath };
};
