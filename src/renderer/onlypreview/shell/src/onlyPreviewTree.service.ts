import type {
  OnlyPreviewIndex,
  OnlyPreviewIndexEntry
} from '@shared/onlypreview/onlyPreview.types';
import type { OnlyPreviewTreeRow } from './onlyPreviewShell.type';

export const getOnlyPreviewParentPath = (relativePath: string): string => {
  const separator = relativePath.lastIndexOf('/');
  return separator < 0 ? '' : relativePath.slice(0, separator);
};

/**
 * 状态栏左侧的面包屑 —— **从项目目录本身开始,一直指到当前选中的那个文件或文件夹**
 * (Ral 2026-09-09)。
 *
 * 与 `resolveOnlyPreviewCurrentDirectory` 的两点关键区别,都是刻意的:
 *
 *   1. **不把文件折叠成它的父目录。** 那个函数回答「当前目录是哪个」,所以选中一个文件时
 *      它返回父目录;这里要求「选中什么就指到什么」,所以文件是终点本身。
 *   2. **不需要索引。** 那个函数要查 `nodeKind` 才能分辨选中的是文件还是目录;这里两者
 *      一视同仁,所以不查 —— 于是索引还没就绪时面包屑**已经是对的**,而不是先空着再补上。
 *      这一点省掉的不只是一次查找,还有一整类「索引未就绪时显示什么」的边界情况。
 *
 * 选中优先级:树的选中优先(它可以是目录,`''` 表示根目录本身),没有树选中时退回被预览的文件,
 * 两者都没有时只显示项目目录 —— 因为要求是「从 project 目录本身开始」,所以空选中不是空面包屑。
 */
export interface OnlyPreviewBreadcrumb {
  /** 第一段恒为项目目录名;至少一段。 */
  segments: string[];
  /** 完整路径,给 `title` 用 —— 段被截断时鼠标悬停仍然读得出完整位置。 */
  title: string;
}

export const resolveOnlyPreviewBreadcrumb = (
  workspace: { rootName: string; displayPath: string } | null,
  treeSelectedRelativePath: string | null,
  previewSelectedRelativePath: string
): OnlyPreviewBreadcrumb | null => {
  if (!workspace) return null;
  const relative =
    treeSelectedRelativePath !== null ? treeSelectedRelativePath : previewSelectedRelativePath;
  // 过滤空段:前导/尾随/重复的 `/` 都不该变成一个空面包屑。
  const tail = String(relative || '')
    .split('/')
    .filter((segment) => segment.length > 0);
  const root = workspace.rootName || workspace.displayPath || '';
  return {
    segments: [root, ...tail],
    title: [workspace.displayPath, ...tail].join('/')
  };
};

/** Footer identity follows the presented target; tree selection is only an empty-preview fallback. */
export const resolveOnlyPreviewStatusBreadcrumb = (state: {
  workspace: { workspaceId: string; rootName: string; displayPath: string } | null;
  treeSelectedRelativePath: string | null;
  selectedRelativePath: string;
  previewPresentation: {
    fileRef: { workspaceId: string; relativePath: string } | null;
    fileDisplayPath?: string;
    directory?: { workspaceId: string; relativePath: string } | null;
  } | null;
}): OnlyPreviewBreadcrumb | null => {
  const presentation = state.previewPresentation;
  const target = presentation?.fileRef ?? presentation?.directory;
  if (target && target.workspaceId === state.workspace?.workspaceId) {
    return resolveOnlyPreviewBreadcrumb(state.workspace, target.relativePath, '');
  }
  if (presentation?.fileDisplayPath) {
    return {
      segments: presentation.fileDisplayPath.split(/[\\/]/).filter(Boolean),
      title: presentation.fileDisplayPath
    };
  }
  return resolveOnlyPreviewBreadcrumb(
    state.workspace, state.treeSelectedRelativePath, state.selectedRelativePath
  );
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

// The tree row a deleted selection hands its selection to: the next surviving visible row, then the
// previous one, then the closest surviving ancestor, and finally the synthetic workspace root.
export const resolveOnlyPreviewDeletedSelection = (
  previousRows: readonly OnlyPreviewTreeRow[],
  deletedRelativePath: string,
  hasEntry: (relativePath: string) => boolean
): string => {
  const survives = (relativePath: string): boolean =>
    relativePath !== deletedRelativePath &&
    !relativePath.startsWith(`${deletedRelativePath}/`) &&
    hasEntry(relativePath);
  const deletedIndex = previousRows.findIndex(
    (row) => row.entry.relativePath === deletedRelativePath
  );
  if (deletedIndex >= 0) {
    for (let offset = deletedIndex + 1; offset < previousRows.length; offset += 1) {
      if (survives(previousRows[offset].entry.relativePath)) {
        return previousRows[offset].entry.relativePath;
      }
    }
    for (let offset = deletedIndex - 1; offset > 0; offset -= 1) {
      if (survives(previousRows[offset].entry.relativePath)) {
        return previousRows[offset].entry.relativePath;
      }
    }
  }
  let ancestor = getOnlyPreviewParentPath(deletedRelativePath);
  while (ancestor) {
    if (hasEntry(ancestor)) return ancestor;
    ancestor = getOnlyPreviewParentPath(ancestor);
  }
  return '';
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
