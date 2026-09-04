// The Project tree's multi-selection rules, kept out of the store so they can be checked without a
// renderer. Owner request, 2026-09-03: 「目录文件要支持多选 和多选的复制」.

export type OnlyPreviewSelectionIntent = 'replace' | 'toggle' | 'extend' | 'all';

export interface OnlyPreviewSelectionState {
  paths: readonly string[];
  /**
   * The row a Shift range runs from: the last row the owner clicked, plainly or with Cmd/Ctrl.
   *
   * Owner rule, 2026-09-03: 「shift 就是 选中和最后一次选中文件之间的可见文件」. A Shift click does not
   * move it, so ranging again from the same anchor re-aims the range instead of walking it — after
   * Cmd-clicking 2 then 6, Shift on 1 gives 1-6 and Shift on 3 then gives 3-6.
   *
   * It is not the previewed row. A Cmd click moves the anchor without loading a document.
   */
  anchor: string | null;
}

export interface OnlyPreviewSelectionResult {
  paths: string[];
  anchor: string | null;
  // Whether the preview should follow. Only a plain click or an arrow key says yes.
  previews: boolean;
}

// The workspace root row. It is never part of a multi-selection: it cannot be deleted, and letting
// it in would turn every plan into "delete the project".
const ROOT_PATH = '';

const rangeBetween = (rows: readonly string[], from: string, to: string): string[] => {
  const start = rows.indexOf(from);
  const end = rows.indexOf(to);
  if (start === -1 || end === -1) return [to];
  const [low, high] = start <= end ? [start, end] : [end, start];
  return rows.slice(low, high + 1);
};

const withoutRoot = (paths: readonly string[]): string[] =>
  paths.filter((path) => path !== ROOT_PATH);

export const resolveOnlyPreviewSelection = (
  intent: OnlyPreviewSelectionIntent,
  state: OnlyPreviewSelectionState,
  target: string | null,
  rows: readonly string[]
): OnlyPreviewSelectionResult => {
  if (intent === 'all') {
    const paths = withoutRoot(rows);
    return { paths, anchor: state.anchor, previews: false };
  }
  if (target === null) return { paths: [...state.paths], anchor: state.anchor, previews: false };
  if (intent === 'replace') return { paths: [target], anchor: target, previews: true };
  if (intent === 'toggle') {
    // The root has no multi-select behaviour of its own, so toggling it selects it alone rather than
    // adding it to a plan that would then be refused. A range that merely reaches it drops it.
    if (target === ROOT_PATH) return { paths: [target], anchor: target, previews: false };
    const present = state.paths.includes(target);
    const paths = present
      ? state.paths.filter((path) => path !== target)
      : [...withoutRoot(state.paths), target];
    // The anchor follows the click even when the toggle empties the selection: it is the last row
    // the owner clicked, and a Shift click after that should still range from there.
    return { paths, anchor: target, previews: false };
  }
  const from = state.anchor ?? target;
  return {
    paths: withoutRoot(rangeBetween(rows, from, target)),
    anchor: state.anchor,
    previews: false
  };
};

/**
 * Drop selected rows that are no longer in the tree.
 *
 * `rows` is the tree's one-dimensional topology — the flattened visible order, which is what the
 * owner sees and what a range runs over. It is recomputed from the tree on every call, so expanding
 * or collapsing a folder re-aims the next range without any state to keep in step.
 *
 * A selection that outlives its rows would let an action target a path that is not there any more —
 * after a delete, an external change, or a workspace swap.
 */
export const retainOnlyPreviewSelection = (
  state: OnlyPreviewSelectionState,
  rows: readonly string[]
): OnlyPreviewSelectionState => {
  const visible = new Set(rows);
  const paths = state.paths.filter((path) => visible.has(path));
  if (paths.length === state.paths.length) return state;
  return { paths, anchor: state.anchor && visible.has(state.anchor) ? state.anchor : null };
};
