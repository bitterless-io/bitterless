// Row order is a property of the snapshot, not of one view: Main applies it once so the standalone
// window and every Omni cell show the same list. Types are `import type` only and the two predicates
// below are local, so this module resolves nothing at runtime and is unit-tested directly under
// `node --test`. Both mirror `@shared/submodules/submodules.type`, and a test asserts they agree.
import type { SubmoduleEntry, SubmodulesViewSettings } from '@shared/submodules/submodules.type';

/** Mirror of `submoduleDisplayName`: the leaf of the declared path, falling back to the section. */
const rowLabel = (entry: SubmoduleEntry): string => {
  const segments = (entry.path || entry.name).split('/').filter(Boolean);
  return segments[segments.length - 1] ?? entry.name;
};

/** Mirror of `isSubmoduleBranchMismatch`. */
const isMismatched = (entry: SubmoduleEntry): boolean =>
  Boolean(entry.configuredBranch && entry.branch && entry.configuredBranch !== entry.branch);

/** ASCII order on the displayed directory name, not the locale collation of the declared path. */
const byName = (left: SubmoduleEntry, right: SubmoduleEntry): number => {
  const leftLabel = rowLabel(left);
  const rightLabel = rowLabel(right);
  if (leftLabel !== rightLabel) return leftLabel < rightLabel ? -1 : 1;
  if (left.path === right.path) return 0;
  return left.path < right.path ? -1 : 1;
};

/** Newest first. A working copy with no readable timestamp sinks below every dated row. */
const byUpdated = (left: SubmoduleEntry, right: SubmoduleEntry): number => {
  const leftAt = left.changedAt ?? -1;
  const rightAt = right.changedAt ?? -1;
  if (leftAt === rightAt) return byName(left, right);
  return rightAt - leftAt;
};

/**
 * Both levels are ordered by the same rules, each within its own parent: a drifted child leads its
 * siblings but never lifts its parent above another top-level row, so the tree keeps its shape.
 */
export const orderSubmodules = (
  entries: readonly SubmoduleEntry[],
  settings: SubmodulesViewSettings
): SubmoduleEntry[] => {
  const compare = settings.sortMode === 'updated' ? byUpdated : byName;
  const ordered = entries.map((entry) =>
    entry.children.length
      ? { ...entry, children: orderSubmodules(entry.children, settings) }
      : entry
  );
  return ordered.sort((left, right) => {
    if (settings.showDiffOnTop) {
      const leftMismatch = isMismatched(left);
      const rightMismatch = isMismatched(right);
      if (leftMismatch !== rightMismatch) return leftMismatch ? -1 : 1;
    }
    return compare(left, right);
  });
};
