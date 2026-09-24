# Tab reorder animation

Status: code complete and code-verified, 2026-09-24; human interaction testing pending.
Paired with micromeet-cowork.

## Request and evidence

Ral: dragging tab A into tab B's position should visibly move B into its new position.
The existing `MenuBar/tab.store.ts` already previews order changes during `dragOver` and commits
the final order through `reorderTabs`. `MenuBar.vue` renders these changes in a plain flex list;
there is no move transition, so neighbouring tabs jump to their new positions.

## Interaction contract

```text
Before:       [Pinned] [Workbench] [A] [B] [C]  +
Drag A → C:   [Pinned] [Workbench] [B ←] [C ←] [A]  +
After drop:   [Pinned] [Workbench] [B] [C] [A]  +
```

- Use Vue's built-in `TransitionGroup` and stable element keys. No new drag library is needed.
- Reordered neighbours slide to their new positions over 180ms using a transform-only ease-out
  transition. No bounce, entrance fade, or delayed removal is introduced.
- Pinned tabs and the Workbench slot keep their existing constraints. Tab widths, native drag
  behaviour, close controls, active-tab identity and persistence remain governed by existing code.
- Repeated dragover events that leave the order unchanged must not restart list updates.
- With `prefers-reduced-motion: reduce`, reordering remains immediate.

## Verification and handoff

Compile the changed Vue template and styles; exercise reordering in both directions, unchanged
hover positions, pinned-tab guards and drop persistence with code-level checks. Electron E2E is
owned by Ral and is not run automatically.

Human check in BL and Cowork: with at least three movable tabs, drag A across B and C and back;
neighbours should slide smoothly, pinned/Workbench slots should stay fixed, and dropping should
retain the chosen order. Repeat with compressed tabs and reduced motion enabled.

### Code verification (2026-09-24)

- Actual Vue SFC/script/style compilation passed in both projects.
- Isolated checks using the actual stores passed for left/right moves, no-op array identity,
  pinned guards, return-to-original order, and a single commit on drop/dragend.
- Actual tab templates mounted in jsdom retained DOM identities, applied move classes to displaced
  tabs, kept pinned/Workbench nodes stationary, cleaned up completed transitions and skipped
  motion under the reduced-motion preference. Layout and CSS timing were simulated; this does
  not certify native Electron drag feel.
- `node --test tests/maestro/maestroWorkbenchTab.test.mjs tests/maestro/maestroTabIconButtons.test.mjs`:
  7/7 passed. `git diff --check` passed.
- Temporary paired harness: overmind `tmp/tab-reorder-animation-check/check.cjs`.
- Electron E2E and full application builds were not run. Changes remain in the current `dev/next`
  worktree for Ral's manual testing; no commit, packaging or release was performed.

Reference: [Vue TransitionGroup](https://vuejs.org/guide/built-ins/transition-group.html).
