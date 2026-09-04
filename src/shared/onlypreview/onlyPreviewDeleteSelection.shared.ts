// One collapse authority for a multi-row Delete, shared by the Project renderer (which shows the
// confirmation copy) and the hidden preload (which performs the removals). Owner rule, 2026-09-03:
// 「删除 a1/b1/c1 和 a1/b1 以及 a2/ 时，实际要处理过滤然后只删除 a1/b1 和 a2」— a selection that
// contains both an ancestor and its descendant must remove the ancestor only, because removing the
// ancestor already removes everything under it. Deleting the descendant first would either fail or
// race the recursive removal of its parent.

export interface OnlyPreviewDeleteEntry {
  relativePath: string;
  nodeKind: 'file' | 'directory';
}

export type OnlyPreviewDeleteSelectionRejection = 'empty' | 'root-selected' | 'invalid-path';

export type OnlyPreviewDeletePlan =
  | {
      ok: true;
      // The entries to remove, in the order the caller listed them, with every descendant of another
      // entry dropped.
      entries: OnlyPreviewDeleteEntry[];
      // How many distinct selected paths these entries account for, so the confirmation can say what
      // the owner selected rather than only what the syscall count will be.
      selectedCount: number;
    }
  | { ok: false; reason: OnlyPreviewDeleteSelectionRejection };

// The workspace root is `''` in every OnlyPreview relative path, and it is not a deletable entry.
// A selection containing it cannot be collapsed — every other path is inside it — so it is refused
// rather than silently turned into "delete the project".
const isDeletableRelativePath = (value: unknown): value is string => {
  if (typeof value !== 'string' || !value) return false;
  if (value.startsWith('/') || value.endsWith('/') || value.includes('//')) return false;
  if (value.includes('\0') || value.includes('\\')) return false;
  const segments = value.split('/');
  for (const segment of segments) {
    if (!segment || segment === '.' || segment === '..') return false;
  }
  return true;
};

const ancestorPathsOf = (relativePath: string): string[] => {
  const segments = relativePath.split('/');
  const ancestors: string[] = [];
  let current = '';
  for (let index = 0; index < segments.length - 1; index += 1) {
    current = current ? `${current}/${segments[index]}` : segments[index];
    ancestors.push(current);
  }
  return ancestors;
};

export const collapseOnlyPreviewDeleteSelection = (
  selection: readonly OnlyPreviewDeleteEntry[]
): OnlyPreviewDeletePlan => {
  if (!Array.isArray(selection) || selection.length === 0) return { ok: false, reason: 'empty' };
  const deduplicated = new Map<string, OnlyPreviewDeleteEntry>();
  for (const entry of selection) {
    if (!entry || (entry.nodeKind !== 'file' && entry.nodeKind !== 'directory')) {
      return { ok: false, reason: 'invalid-path' };
    }
    if (typeof entry.relativePath === 'string' && !entry.relativePath) {
      return { ok: false, reason: 'root-selected' };
    }
    if (!isDeletableRelativePath(entry.relativePath)) return { ok: false, reason: 'invalid-path' };
    // A repeated path keeps its first occurrence, so the caller's order survives deduplication.
    if (!deduplicated.has(entry.relativePath)) {
      deduplicated.set(entry.relativePath, {
        relativePath: entry.relativePath,
        nodeKind: entry.nodeKind
      });
    }
  }
  // Only a directory can contain another entry. A file whose path happens to be a string prefix of
  // another path — impossible on a real filesystem, reachable through a stale row — must not swallow
  // it, so membership is tested against directories alone.
  const selectedDirectories = new Set<string>();
  for (const entry of deduplicated.values()) {
    if (entry.nodeKind === 'directory') selectedDirectories.add(entry.relativePath);
  }
  const entries: OnlyPreviewDeleteEntry[] = [];
  for (const entry of deduplicated.values()) {
    const covered = ancestorPathsOf(entry.relativePath).some((ancestor) =>
      selectedDirectories.has(ancestor)
    );
    if (!covered) entries.push(entry);
  }
  return { ok: true, entries, selectedCount: deduplicated.size };
};

/**
 * Did a delete run take this path with it?
 *
 * The tree uses this to drop what pointed *into* a removed folder — an expanded descendant, a
 * selection, the previewed row. Containment is tested per path segment, through the same ancestor
 * walk the collapse uses, so `a1/b10` is not read as living inside `a1/b1`.
 */
export const isOnlyPreviewPathRemoved = (
  removed: readonly string[],
  relativePath: string
): boolean => {
  if (typeof relativePath !== 'string' || !relativePath) return false;
  const gone = new Set(removed.filter((entry) => typeof entry === 'string' && entry));
  if (gone.size === 0) return false;
  if (gone.has(relativePath)) return true;
  return ancestorPathsOf(relativePath).some((ancestor) => gone.has(ancestor));
};
