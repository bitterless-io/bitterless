---
id: miniapp-entry-visibility-001
scope: authenticated Home Mini Apps entry visibility
status: done
depends-on: []
---

# Temporarily hide Maestro and Coin entries

## Objective

Temporarily remove the Maestro and Coin cards and launch actions from the authenticated Mini Apps
page. Keep both sub-application runtimes, window handlers, renderer entries, packaging resources,
and persisted data intact so the entries can be restored later with a small source change.

## Context

- `docs/features/README.md`
- `docs/features/maestro.md`
- `docs/features/coin.md`
- `docs/INDEX.md`

## Path

- `src/renderer/home/src/views/miniApp/miniApps.constant.ts`
- `src/renderer/home/src/views/miniApp/MiniApp.vue`
- `scripts/maestro/check-embedded-host.mjs`
- `docs/features/README.md`
- `docs/features/maestro.md`
- `docs/features/coin.md`
- `docs/plan/README.md`
- `docs/plan/tasks/miniapp-entry-visibility-001.md`
- `docs/plan/reviews/miniapp-entry-visibility-001-1.md`

## Verification

- Inspect the active Mini Apps source after stripping comments and prove that neither `maestro`
  nor `coin` is present as a rendered card or callable Home launch action.
- `yarn typecheck:web`
- `yarn check:maestro`
- Confirm Todo, EyesOnAgents, and Omni Browser remain in the Mini Apps collection.

## Completion

- Maestro and Coin card definitions remain in source but are block-commented out.
- Home-to-XPC callbacks and both integrated runtimes remain intact.
- Independent review passed with no findings:
  `docs/plan/reviews/miniapp-entry-visibility-001-1.md`.
- Focused visibility and comment-scanner checks plus `git diff --check` passed. Project-wide web
  typecheck and Maestro checks remain blocked by task-unrelated baseline errors recorded in the
  review.
