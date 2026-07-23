---
id: todo-note-editor-height-010
scope: make the Todo detail Note editor open at a 480px default height
status: done
depends-on: [todoist-sync-desktop-001]
---

# Todo Note editor default height

## Objective

Give longer Todo notes a useful editing canvas immediately by opening the existing Note textarea at
480px high while preserving its current visual treatment and vertical resize behavior.

## Implementation contract

- Set `.todo-detail__note` to a `480px` default height in its sibling Less file.
- Keep the existing business BEM class, background, typography, focus state, and vertical resize
  affordance. Do not introduce inline style or Tailwind classes.
- Preserve a bounded resize range and the Todo detail panel's existing scroll ownership so the
  footer and other fields remain reachable in smaller windows.
- Add a focused source regression that distinguishes default `height` from only a `min-height` or
  `max-height` constraint.

## Path

- `src/renderer/todo/src/components/TodoDetail/TodoDetail.less`
- `scripts/todo/`
- this task and its review artifact

## Verification

- focused Note-height regression;
- `yarn typecheck:todo-web`;
- `git diff --check`;
- independent source review before macOS ARM packaging.

## Result

- `.todo-detail__note` now opens at `480px` while retaining its `80px` minimum, `500px` maximum,
  and vertical resize affordance.
- The existing Todo detail body remains the scroll owner, so the taller editor and footer stay
  reachable in a small window without changing business BEM, Less ownership, or visual treatment.
- Review: [round 1](../reviews/todo-note-editor-height-010-1.md).

## Completion evidence

- `node --test scripts/todo/todo-note-editor-height.test.mjs` — pass, 2/2.
- `yarn typecheck:todo-web` — pass.
- Independent 800×600 headless layout probe confirms a computed `480px` Note and body-owned
  overflow with a reachable footer.
- `git diff --check` — pass.
