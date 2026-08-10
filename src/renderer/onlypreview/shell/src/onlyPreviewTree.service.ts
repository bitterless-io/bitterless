import type {
  OnlyPreviewIndex,
  OnlyPreviewIndexEntry
} from '@shared/onlypreview/onlyPreview.types';
import type { OnlyPreviewTreeRow } from './onlyPreviewShell.type';

export const getOnlyPreviewParentPath = (relativePath: string): string => {
  const separator = relativePath.lastIndexOf('/');
  return separator < 0 ? '' : relativePath.slice(0, separator);
};

export const buildOnlyPreviewTreeRows = (
  index: OnlyPreviewIndex | null,
  rawQuery: string,
  expandedPaths: ReadonlySet<string>,
  visiblePathSnapshot?: ReadonlySet<string>
): OnlyPreviewTreeRow[] => {
  if (!index) return [];
  const entriesByParent = new Map<string, OnlyPreviewIndexEntry[]>();
  for (const entry of index.entries) {
    const siblings = entriesByParent.get(entry.parentRelativePath) || [];
    siblings.push(entry);
    entriesByParent.set(entry.parentRelativePath, siblings);
  }

  const rows: OnlyPreviewTreeRow[] = [];
  const visit = (parent: string, depth: number): void => {
    const children = entriesByParent.get(parent) || [];
    for (const entry of children) {
      const hasChildren = entry.nodeKind === 'directory';
      const expanded = expandedPaths.has(entry.relativePath);
      rows.push({ entry, depth, expanded, hasChildren });
      if (entry.nodeKind === 'directory' && expanded) {
        visit(entry.relativePath, depth + 1);
      }
    }
  };
  visit('', 0);
  const query = rawQuery.trim().normalize('NFKC').toLocaleLowerCase();
  if (!query) return rows;
  const visibleRows = visiblePathSnapshot
    ? rows.filter((row) => visiblePathSnapshot.has(row.entry.relativePath))
    : rows;

  const included = new Set<string>();
  for (const row of visibleRows) {
    if (!row.entry.name.normalize('NFKC').toLocaleLowerCase().includes(query)) continue;
    let current = row.entry.relativePath;
    while (current) {
      included.add(current);
      current = getOnlyPreviewParentPath(current);
    }
  }
  return visibleRows.filter((row) => included.has(row.entry.relativePath));
};

export const snapshotOnlyPreviewVisiblePaths = (
  index: OnlyPreviewIndex | null,
  expandedPaths: ReadonlySet<string>
): ReadonlySet<string> =>
  new Set(buildOnlyPreviewTreeRows(index, '', expandedPaths).map((row) => row.entry.relativePath));

class OnlyPreviewTreeFilter {
  private expandedPathSnapshot: ReadonlySet<string> | undefined;
  private visiblePathSnapshot: ReadonlySet<string> | undefined;
  private workspaceId = '';

  begin(index: OnlyPreviewIndex | null, expandedPaths: ReadonlySet<string>): void {
    if (this.expandedPathSnapshot) return;
    this.capture(index, expandedPaths);
  }

  private capture(index: OnlyPreviewIndex | null, expandedPaths: ReadonlySet<string>): void {
    this.expandedPathSnapshot = new Set(expandedPaths);
    this.visiblePathSnapshot = snapshotOnlyPreviewVisiblePaths(index, expandedPaths);
    this.workspaceId = index?.workspaceId || '';
  }

  end(expandedPaths: Set<string>): void {
    if (!this.expandedPathSnapshot) return;
    expandedPaths.clear();
    for (const relativePath of this.expandedPathSnapshot) expandedPaths.add(relativePath);
    this.expandedPathSnapshot = undefined;
    this.visiblePathSnapshot = undefined;
    this.workspaceId = '';
  }

  rows(
    index: OnlyPreviewIndex | null,
    query: string,
    expandedPaths: ReadonlySet<string>
  ): OnlyPreviewTreeRow[] {
    if (query.trim() && index && index.workspaceId !== this.workspaceId) {
      this.capture(index, expandedPaths);
    }
    return buildOnlyPreviewTreeRows(
      index,
      query,
      this.expandedPathSnapshot || expandedPaths,
      this.visiblePathSnapshot
    );
  }
}

export const onlyPreviewTreeFilter = new OnlyPreviewTreeFilter();
