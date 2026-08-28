// Search and expansion are view state, so the tree the list renders is derived here rather than in
// Main. Types are `import type` only and the leaf-name derivation is local, so this module resolves
// nothing at runtime and is unit-tested directly under `node --test`; a test guards the mirror
// against `submoduleDisplayName`.
import type { SubmoduleEntry } from '@shared/submodules/submodules.type';

/** Same shape as the EyesOnAgents title filter: NFKC, case-folded, split on path/word separators. */
const SEARCH_SEPARATOR_PATTERN = /[\s\-_./\\:|]+/u;

export interface SubmoduleTreeRow {
  entry: SubmoduleEntry;
  /** Children to render under this row: none while collapsed, the matches while searching. */
  children: SubmoduleEntry[];
  /** The row declares submodules of its own, so it owns the expand/collapse control. */
  expandable: boolean;
  /** How the control renders. A search forces it open for the rows it matched. */
  expanded: boolean;
}

export const searchTokens = (value: string): string[] =>
  value.normalize('NFKC').toLocaleLowerCase().split(SEARCH_SEPARATOR_PATTERN).filter(Boolean);

/** Mirror of `submoduleDisplayName`: the leaf of the declared path, falling back to the section. */
const rowLabel = (entry: SubmoduleEntry): string => {
  const segments = (entry.path || entry.name).split('/').filter(Boolean);
  return segments[segments.length - 1] ?? entry.name;
};

const matches = (entry: SubmoduleEntry, tokens: readonly string[]): boolean => {
  const haystack = searchTokens(`${rowLabel(entry)} ${entry.path}`);
  return tokens.every((token) => haystack.some((part) => part.includes(token)));
};

/**
 * Two levels, one pass:
 * - No query — every top-level row, its children only while expanded.
 * - A parent matches — the parent with all of its children, so its subtree is browsable.
 * - Only children match — the parent is kept as context and shows just the matching children.
 * A search always renders the surviving children, whatever the collapsed state was: hiding a hit
 * behind a chevron would make the search look broken.
 */
export const filterSubmoduleTree = (
  entries: readonly SubmoduleEntry[],
  options: { query: string; expandedPaths: ReadonlySet<string> }
): SubmoduleTreeRow[] => {
  const tokens = searchTokens(options.query);
  const rows: SubmoduleTreeRow[] = [];

  for (const entry of entries) {
    const expandable = entry.children.length > 0;
    if (!tokens.length) {
      const expanded = expandable && options.expandedPaths.has(entry.absolutePath);
      rows.push({ entry, children: expanded ? entry.children : [], expandable, expanded });
      continue;
    }

    const parentMatches = matches(entry, tokens);
    const matchedChildren = parentMatches
      ? entry.children
      : entry.children.filter((child) => matches(child, tokens));
    if (!parentMatches && !matchedChildren.length) continue;
    rows.push({
      entry,
      children: matchedChildren,
      expandable,
      expanded: matchedChildren.length > 0
    });
  }

  return rows;
};

/** Rendered rows, parents and children alike — what the `visible/total` count reports. */
export const countTreeRows = (rows: readonly SubmoduleTreeRow[]): number =>
  rows.reduce((total, row) => total + 1 + row.children.length, 0);

/** Every submodule in the inventory, both levels. */
export const countEntries = (entries: readonly SubmoduleEntry[]): number =>
  entries.reduce((total, entry) => total + 1 + entry.children.length, 0);
