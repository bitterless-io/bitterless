# Omni root-axis collapse corrupts panel and window bounds

Status: implemented; owner verification pending (reopened 2026-07-26)

Implementation: [omni-layout-axis-collapse-002](../plan/tasks/omni-layout-axis-collapse-002.md)

## Report

Closing both cells in one first-level branch and then splitting a remaining cell above or below can
leave the layout control panel and the native `WebContentsView` cells with different horizontal and
vertical geometry. A representative failure starts with a vertical root whose top and bottom
children are horizontal splits. Removing both top leaves promotes the bottom horizontal split to
the root, after which a new vertical split exposes stale widths, offsets, and heights.

Browser and mini-app cells make the mismatch more visible because a browser has a 36px URL header
when layout mode is closed, while a mini app has no runtime URL header and fills its complete outer
cell bounds.

## 2026-07-26 Recurrence

The issue also reproduces without replacing the root axis:

```text
H[V(A,B),V(C,D)] -> close A -> H[B,V(C,D)]
                    split B above -> H[V(N,B),V(C,D)]
                    close N -> H[B,V(C,D)]
```

After closing `A` (column 1, row 1), the native views in column 2 become wider. Splitting the
remaining left leaf `B` above moves the column-2 Splitpanes border, but the native `C` and `D` views
do not follow it. Closing the newly inserted `N` makes the renderer and native views agree again.

The reopened source audit found that the previous resolution text and current branch diverged. The
current renderer still mutates leaves in place, leaves `handleClose()` outside the split guard,
accepts programmatic `resized` events, reuses the root component without a structural revision key,
and sends apply and save as separate XPC operations. The shared pure mutation/pixel helper and test
exist only as untracked additions while the production renderer and handler still contain the old
paths. This incomplete landing is the immediate reason the documented failure can recur unchanged.

## Root Cause

1. Collapsing `V(A,B)` replaces the root Splitpanes child's key from the split ID to leaf `B`.
   Splitting `B` again replaces it with another split ID. Splitpanes handles both as pane remove/add,
   recalculates its given-size pane registry, and emits a programmatic `resized` event without a
   native input `event`.
2. The old handler accepted every programmatic `resized`, did not validate event arity, and resolved
   `props.node.id` after the reactive tree had already changed. It could therefore write temporary
   pane-registry sizes into the current root or an inner node.
3. `handleClose()` had no structural guard and neither close nor split awaited `syncLayout()`. Old
   and new component callbacks could issue overlapping layout operations while Vue was removing and
   adding panes.
4. Each `syncLayout()` sent `updateLayout` and `saveLayout` as separate XPC calls. Concurrent syncs
   could interleave so one `updateLayout` set native bounds from tree X, then a later `saveLayout`
   replaced Main's tree with tree Y without applying Y. The control rendered Y while native views
   remained at X. Closing the newly added leaf sent another update and made them agree again, which
   exactly explains the reported self-healing step.
5. The intended prior fix existed in helper/test additions but the production renderer, XPC handler,
   and Main lifecycle paths in the current branch still contained the old implementation. The
   documentation and branch therefore disagreed, allowing the same failure to recur.
6. Browser URL-header and mini-app content bounds were computed separately from the renderer layout.
   Header presence must affect only the inner content rectangle, never a split leaf's outer bounds.

## Fix Contract

- Tree split/remove operations are structural transactions. Resize callbacks cannot mutate or save
  size vectors until the resulting Vue/Splitpanes tree has settled.
- Every structural mutation increments a renderer-only revision. The root pane tree is keyed by that
  revision so Splitpanes cannot reuse pane state across root promotion or axis changes.
- Both `resize` and `resized` ignore pre-mount, structural, stale, non-finite, non-positive, or
  wrong-arity size vectors. Programmatic Splitpanes `resized` events have no native input event and
  are never treated as user intent.
- Close and split await one canonical layout sync and always release the structural guard in a
  `finally` block.
- A committed layout crosses XPC once. Main serializes apply plus persistence, and replays its current
  normalized tree whenever the singleton layout editor loads or reopens.
- Tree collapse preserves and renormalizes the surviving sibling weights. Promoting one child keeps
  that child's own direction and size vector unchanged.
- Main computes native outer leaf bounds from the same normalized tree. Browser header bounds are
  carved out inside that outer rectangle; mini-app content receives the entire rectangle.
- The layout editor toolbar has a stable 36px outer height. It is an editing overlay and does not
  imply that a mini app gains a runtime URL header when layout mode closes.

## Acceptance

- Start with a horizontal root whose two columns are vertical two-row splits. Give the columns and
  their rows visibly different ratios.
- Close the top-left leaf. The left column collapses to its remaining leaf without changing the
  root's column widths or either right-column row height.
- Split the remaining left leaf above. The right-column divider and both native right-column views
  keep exactly the same x, width, y, and height. Close the inserted leaf and verify no geometry
  changes outside the left column.
- Start with a vertical root whose top and bottom branches are horizontal two-cell splits. Give the
  two branches visibly different width ratios.
- Close both top cells. The remaining bottom split becomes the horizontal root and retains its own
  ratio; no former vertical-root ratio is written into it.
- Split either remaining cell above and below. The control panel and native cells agree on x, y,
  width, and height after each operation.
- Repeat with browser and mini-app leaves. Closing layout mode keeps the browser URL header at 36px,
  gives mini apps no URL header, and does not change either leaf's outer split bounds.
- Reopen layout mode and continue resizing. The first lifecycle callback does not overwrite saved
  ratios, while a real user resize still applies and persists.
- Close and reopen the Omni BaseWindow, then open layout mode. The editor starts from Main's current
  normalized tree rather than stale singleton renderer state.
- Focused topology/geometry tests, Node type check, the renderer i18n check, build, and
  `git diff --check` pass. Web type checking reports no touched-file diagnostic; unrelated existing
  repository diagnostics remain recorded in the review.

## Previous Resolution (incomplete in current branch)

- Split and remove now use pure tree operations. Promoting a sole child keeps that child's axis and
  sizes instead of carrying parent-axis weights into the new root.
- Structural edits remount the Splitpanes tree and reject programmatic lifecycle resize events, so
  stale callbacks cannot write x/width values into y/height state or the reverse.
- Renderer preview and Main native views flatten the same normalized tree with the same 4px divider.
  Browser content alone receives the 36px URL-header inset; mini apps retain their full outer bounds.
- Main serializes apply plus SQLite persistence and replays its current layout to a reopened control
  window. Setting serialization preserves the complete JSON payload and enforces a 4 MiB UTF-8 limit
  rather than truncating it.
- Independent review passed after cancellation timing, immediate Cancel visibility, Vue template
  type narrowing, and UTF-8 limit findings were fixed. The remaining test boundary is documented in
  [the review](../plan/reviews/omni-layout-axis-collapse-002-1.md).

## 2026-07-26 Implementation

- Renderer split/remove now use immutable helpers. An inner split collapsing to one leaf preserves
  the root column weights and the untouched sibling split's row weights.
- Every structural mutation increments `structureRevision`, remounting the complete nested
  Splitpanes tree. Split and close share one guarded transaction and await commit plus render settle
  in `finally`-protected code.
- Resize handlers require a native input event, a mounted current component, matching child count,
  and finite positive sizes. Splitpanes' programmatic add/remove events cannot write or persist
  layout state.
- Renderer structure commits cross XPC once. Main serializes each apply-and-persist operation in one
  queue, so another mutation cannot interleave between native `setBounds()` and SQLite persistence.
- Main and tests use one 4px-aware pixel mapper. Browser cells carve a 36px URL header from their
  inner bounds; mini apps receive the complete outer leaf. Reopened control views receive Main's
  current normalized tree.
- The exact `H[V(A,B),V(C,D)]` close/split/close sequence asserts the right column's x, y, width, and
  height at every stage. A separate asynchronous test proves two commits cannot interleave apply and
  persistence, and source gates reject a return of the old mutation, event, or dual-XPC paths.
- Verified with `yarn test:omni-layout` (7/7), `yarn typecheck:node`, targeted ESLint,
  `yarn check:renderer-i18n`, `yarn build`, and `git diff --check`. Web type checking has no new Omni
  diagnostic and retains unrelated existing repository diagnostics. Per Ral's request, no recording
  or screenshot verification was performed.
