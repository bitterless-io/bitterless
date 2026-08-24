import type {
  OnlyPreviewIndex,
  OnlyPreviewIndexEntry
} from '@shared/onlypreview/onlyPreview.types';
import type { OnlyPreviewTreeRow } from './onlyPreviewShell.type';

const EMPTY_ONLY_PREVIEW_REVEAL_ROOTS: ReadonlySet<string> = new Set();

export const getOnlyPreviewParentPath = (relativePath: string): string => {
  const separator = relativePath.lastIndexOf('/');
  return separator < 0 ? '' : relativePath.slice(0, separator);
};

export const hasOnlyPreviewRevealAncestor = (
  relativePath: string,
  revealRoots: ReadonlySet<string>
): boolean => {
  let current = getOnlyPreviewParentPath(relativePath);
  while (current) {
    if (revealRoots.has(current)) return true;
    current = getOnlyPreviewParentPath(current);
  }
  return false;
};

export const buildOnlyPreviewTreeRows = (
  index: OnlyPreviewIndex | null,
  rawQuery: string,
  expandedPaths: ReadonlySet<string>,
  visiblePathSnapshot?: ReadonlySet<string>,
  revealRoots: ReadonlySet<string> = EMPTY_ONLY_PREVIEW_REVEAL_ROOTS
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
  return rows.filter(
    (row) => {
      const relativePath = row.entry.relativePath;
      return (
        ((!visiblePathSnapshot || visiblePathSnapshot.has(relativePath)) &&
          included.has(relativePath)) ||
        (revealRoots.size > 0 && hasOnlyPreviewRevealAncestor(relativePath, revealRoots))
      );
    }
  );
};

export const snapshotOnlyPreviewVisiblePaths = (
  index: OnlyPreviewIndex | null,
  expandedPaths: ReadonlySet<string>
): ReadonlySet<string> =>
  new Set(buildOnlyPreviewTreeRows(index, '', expandedPaths).map((row) => row.entry.relativePath));

export class OnlyPreviewTreeFilter {
  private expandedPathSnapshot: ReadonlySet<string> | undefined;
  private visiblePathSnapshot: ReadonlySet<string> | undefined;
  private readonly revealRoots = new Set<string>();
  private readonly revealRootsByAncestor = new Map<string, Set<string>>();
  private workspaceId = '';

  begin(index: OnlyPreviewIndex | null, expandedPaths: ReadonlySet<string>): void {
    if (this.expandedPathSnapshot) return;
    this.capture(index, expandedPaths);
  }

  private capture(index: OnlyPreviewIndex | null, expandedPaths: ReadonlySet<string>): void {
    this.clearRevealRoots();
    this.expandedPathSnapshot = new Set(expandedPaths);
    this.visiblePathSnapshot = snapshotOnlyPreviewVisiblePaths(index, expandedPaths);
    this.workspaceId = index?.workspaceId || '';
  }

  end(expandedPaths: Set<string>): void {
    this.clearRevealRoots();
    if (!this.expandedPathSnapshot) return;
    expandedPaths.clear();
    for (const relativePath of this.expandedPathSnapshot) expandedPaths.add(relativePath);
    this.expandedPathSnapshot = undefined;
    this.visiblePathSnapshot = undefined;
    this.workspaceId = '';
  }

  transition(
    index: OnlyPreviewIndex | null,
    expandedPaths: Set<string>,
    previousQuery: string,
    nextQuery: string
  ): void {
    const wasActive = !!previousQuery.trim();
    const isActive = !!nextQuery.trim();
    if (!wasActive && isActive) this.begin(index, expandedPaths);
    else if (wasActive && !isActive) this.end(expandedPaths);
    else if (isActive && previousQuery !== nextQuery) this.clearRevealRoots();
  }

  clearRevealRoots(): void {
    this.revealRoots.clear();
    this.revealRootsByAncestor.clear();
  }

  toggleDirectory(query: string, relativePath: string, expandedPaths: Set<string>): boolean {
    if (query.trim()) {
      if (!this.revealRoots.has(relativePath)) {
        this.addRevealRoot(relativePath);
        expandedPaths.add(relativePath);
        return true;
      }
      this.collapseDirectory(relativePath, expandedPaths);
      return false;
    }
    if (expandedPaths.has(relativePath)) {
      expandedPaths.delete(relativePath);
      return false;
    }
    expandedPaths.add(relativePath);
    return true;
  }

  collapseDirectory(relativePath: string, expandedPaths: Set<string>): void {
    expandedPaths.delete(relativePath);
    const descendants = [...(this.revealRootsByAncestor.get(relativePath) || [])];
    for (const revealRoot of descendants) {
      this.revealRoots.delete(revealRoot);
      let current = revealRoot;
      while (current) {
        const indexed = this.revealRootsByAncestor.get(current);
        indexed?.delete(revealRoot);
        if (indexed?.size === 0) this.revealRootsByAncestor.delete(current);
        current = getOnlyPreviewParentPath(current);
      }
    }
  }

  private addRevealRoot(relativePath: string): void {
    this.revealRoots.add(relativePath);
    let current = relativePath;
    while (current) {
      const indexed = this.revealRootsByAncestor.get(current) || new Set<string>();
      indexed.add(relativePath);
      this.revealRootsByAncestor.set(current, indexed);
      current = getOnlyPreviewParentPath(current);
    }
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
      expandedPaths,
      this.visiblePathSnapshot,
      this.revealRoots
    );
  }
}

export const onlyPreviewTreeFilter = new OnlyPreviewTreeFilter();
