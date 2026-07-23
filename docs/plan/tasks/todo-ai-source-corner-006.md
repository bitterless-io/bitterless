---
id: todo-ai-source-corner-006
scope: compact AI source marker inside Todo items
status: done
depends-on: [todo-domain-board-layout-005]
---

# Todo AI Source Corner Marker

## Objective

Remove the AI source label's dedicated metadata row and render the same label as an absolute
top-left corner marker. Match the Todo item's outer top-left curve, keep the marker's top-right and
bottom-left square, and retain a rounded bottom-right corner so AI provenance stays visible without
increasing item height.

## Context

- `docs/features/todo-layout.md`
- `docs/design/colors.md`
- `docs/INDEX.md`

## Path

- `src/renderer/todo/src/components/TodoRow/TodoRow.vue`
- `src/renderer/todo/src/components/TodoRow/TodoRow.less`
- `scripts/todo/todo-ai-source-corner.test.mjs`
- `package.json`
- `docs/plan/reviews/todo-ai-source-corner-006-1.md`
- the referenced task and feature docs

## Verification

- AI source label is a direct absolute child of the Todo item at its top-left corner.
- Marker uses `border-radius: 6px 0 4px 0`, retains the existing color/type treatment, and does not
  intercept pointer input.
- The Todo item establishes the positioning context; no metadata row or reserved source-label
  height remains.
- Human Todo layout and existing selection/edit/completion/subtitle/star interactions remain wired.
- `yarn test:todo-ai-source`
- `yarn typecheck:todo-web`
- `yarn check:renderer-i18n`
- `git diff --check`
- Independent source review passes.

## Completion

- The AI source label is now the Todo row's direct absolute child and no longer creates a metadata
  row or changes item height.
- The marker uses `top: 0`, `left: 0`, `border-radius: 6px 0 4px 0`, and
  `pointer-events: none`, while retaining its existing color, type, height, and padding.
- Focused tests preserve human Todo layout plus selection, editing, completion, subtitle, star,
  active, newly-created, and hover behavior.
- `docs/plan/reviews/todo-ai-source-corner-006-1.md` records the independent PASS with no
  P1/P2/P3 findings.
