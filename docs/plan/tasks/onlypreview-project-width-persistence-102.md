---
id: onlypreview-project-width-persistence-102
scope: Persist the throttled final width of the OnlyPreview Project directory pane
status: implemented; owner verification pending
depends-on:
  - onlypreview-menubar-003
verify: focused pure Node persistence and Shell source tests, typecheck:node, directed lint, build, and task-scoped git diff check; no Electron/Playwright/E2E
---

# Persist the Project directory width

## Objective

Restore the last user-adjusted Project pane width whenever the OnlyPreview Shell is recreated,
while keeping drag rendering immediate and bounding synchronous local-storage writes.

## Context

- [Project width is not persisted](../../issues/onlypreview-project-width-not-persisted.md)
- [OnlyPreview feature contract](../../features/onlypreview.md)
- [Standalone MenuBar and resize contract](onlypreview-menubar-003.md)

## Paths

- `src/renderer/onlypreview/shell/src/App.vue`
- `src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts`
- a focused renderer-local Project-width persistence service
- focused `tests/onlypreview/`
- `docs/features/onlypreview.md`
- `docs/issues/onlypreview-project-width-not-persisted.md`
- `docs/INDEX.md`
- `docs/plan/README.md`
- `docs/plan/tasks/onlypreview-project-width-persistence-102.md`
- `docs/plan/reviews/onlypreview-project-width-persistence-102-1.md`

## Contract

1. Store one global OnlyPreview Project-pane width in the Shell renderer's `localStorage`. It is a
   visual preference, not Project identity, filesystem metadata, or the Main-owned Settings form.
2. Parse only a finite integer width. Missing, malformed, out-of-range, or storage-error input
   falls back safely, then use the existing clamp: `180px` minimum, `480px` product maximum, and a
   viewport maximum of `window.innerWidth - 320px`.
3. Keep pointer-move layout updates and Preview bounds reporting immediate. Persistence uses one
   leading-plus-trailing throttle with a bounded interval, and every trailing commit reads the
   latest pending width rather than an earlier closure value.
4. Flush the pending final width synchronously on drag end, drag cancellation, and Shell teardown.
   A failed storage write is non-fatal and does not affect resizing.
5. Route keyboard separator resizing through the same store/persistence path. Keep the current
   separator semantics, accessibility values, geometry, colors, and resize cursor unchanged.

## Verification

- Pure Node tests cover missing/invalid/restored/clamped values, leading write, bounded writes,
  authoritative trailing value, explicit final flush, and storage exceptions.
- Focused source wiring proves pointer move schedules, pointer end/cancel flushes, teardown flushes,
  and keyboard resizing persists.
- Run focused non-Electron tests, `yarn typecheck:node`, directed lint, `yarn build`, and task-path
  `git diff --check`.
- Do not launch Electron, Playwright, packaged smoke, or E2E. Ral owns live drag/restart acceptance.

## Delivery

Implemented on 2026-09-01. The Shell now restores one renderer-local Project width before its
normal initialization, applies the existing product and viewport clamp, and schedules persistence
through a 200ms leading-plus-trailing service whose pending value is always authoritative.
Pointer completion/cancellation and the real document `pagehide` lifecycle synchronously flush the
last width; normal Vue unmount removes the listener and repeats the idempotent flush. Keyboard
separator adjustments use the same Store update path. Storage failures remain non-fatal and no
Main Settings/shared protocol field was added.

[Independent review 1](../reviews/onlypreview-project-width-persistence-102-1.md) passed after its
P2 teardown finding was corrected. The Project-width plus App-wiring suites passed 15/15,
`yarn typecheck:node`, directed ESLint with zero errors and no new warning, `yarn build`, the
strict Store line-cap, and task-scoped diff checks passed. Electron, Playwright, packaged smoke,
application launch, and E2E were not run; Ral owns live drag/recreate acceptance.
