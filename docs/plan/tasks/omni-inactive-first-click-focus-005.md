---
id: omni-inactive-first-click-focus-005
scope: Omni macOS BaseWindow first-click focus routing across WebContentsViews
status: implemented; owner verification pending
depends-on: []
verify:
  - the Omni BaseWindow enables first-mouse delivery on macOS
  - one activation click reaches the exact child WebContentsView under the pointer
  - no renderer click synthesis, timing workaround, or remembered-cell refocus is introduced
  - Windows behavior is unchanged
  - build and git diff checks pass; Electron E2E is not run
---

# Omni Inactive First-Click Focus

## Objective

Make the first click after returning from another macOS application both activate Omni and focus the
input clicked in another Omni cell, without changing focus behavior on Windows or adding renderer
workarounds.

## Context

- `docs/features/omni-miniapp-cells.md`
- `docs/issues/omni-inactive-window-first-click-focus.md`
- Electron `BaseWindowConstructorOptions.acceptFirstMouse`

## Path

- `src/main/windows/omniWindow.helper.ts`
- `docs/features/omni-miniapp-cells.md`
- `docs/issues/omni-inactive-window-first-click-focus.md`
- `docs/plan/tasks/omni-inactive-first-click-focus-005.md`
- `docs/INDEX.md`
- `docs/plan/README.md`

## Verification

1. Inspect the Omni `BaseWindow` constructor options and confirm `acceptFirstMouse` is scoped to
   macOS.
2. Confirm no new focus/click listener targets a remembered cell or injects a renderer event.
3. Run `yarn build` and `git diff --check`.
4. Do not run Electron E2E; Ral performs the live A → external app → B input acceptance sequence.

## Result

- Added the macOS-only `BaseWindowConstructorOptions.acceptFirstMouse` option at the one native
  Omni window boundary. Website chrome/content and Mini App views are all covered.
- Independent review:
  `docs/plan/reviews/omni-inactive-first-click-focus-005-1.md` — pass, no findings.
- `yarn build` and `git diff --check` passed.
- Electron E2E was not run. Owner live verification remains pending.
