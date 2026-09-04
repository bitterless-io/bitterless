// The Project tree's multi-selection rules, kept out of the store so they can be checked without a
// renderer. Owner request, 2026-09-03: 「目录文件要支持多选 和多选的复制」.

export type OnlyPreviewSelectionIntent = 'replace' | 'toggle' | 'extend' | 'all';

export interface OnlyPreviewSelectionState {
  paths: readonly string[];
  // The row the preview belongs to. A multi-select gesture never moves it, which is what keeps a
  // shift-click across forty rows from starting forty previews.
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
    // Deselecting the last row leaves nothing selected, and the anchor goes with it.
    return { paths, anchor: paths.length ? target : null, previews: false };
  }
  const from = state.anchor ?? target;
  return { paths: withoutRoot(rangeBetween(rows, from, target)), anchor: state.anchor, previews: false };
};

/**
 * Drop selected rows that are no longer in the tree.
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
