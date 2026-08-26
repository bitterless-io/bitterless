---
id: maestro-local-home-devtools-010
scope: fixed Maestro Home renderer DevTools availability in debug runtimes
status: implemented; owner verification pending
depends-on: [maestro-local-home-branding-008]
verify: node scripts/maestro/check-devtools-debug.mjs && yarn typecheck:node && yarn build && git diff --check
---

# Keep fixed Home DevTools open in debug

## Objective

Automatically open detached DevTools for the bundled fixed Home `WebContentsView` in a compiled
debug runtime whenever it finishes loading or is reactivated without an existing DevTools window.
Do not expose DevTools in release or E2E runtimes and do not change ordinary browser-tab debugging.

## Context

- `docs/features/maestro.md`
- `docs/issues/maestro-local-home-still-shows-chat.md`
- `docs/plan/tasks/maestro-local-home-branding-008.md`

## Path

- `src/main/maestro/windows/main/maestroBrowserView.service.ts`
- `scripts/maestro/check-devtools-debug.mjs`
- `docs/features/maestro.md`
- `docs/plan/README.md`

## Contract

- Add an exported, pure fixed-Home DevTools policy that returns true only for compiled
  `VITE_MODE=debug` outside `BITTERLESS_E2E=1`. Runtime environment variables must not enable it in
  a compiled release build.
- The fixed Home view listens for every `did-finish-load`. If its web contents is still live and
  DevTools is not already open, open detached DevTools with `activate: false`.
- Re-selecting an already active Home tab and activating Home from another tab run the same
  idempotent guard, so manually closed DevTools returns when the user comes back to Home.
- Never open a duplicate DevTools window. Destroyed views, non-Home tabs, release builds, and E2E
  runs are no-ops. Report an Electron open failure through the existing Maestro trace surface.
- Preserve the fixed Home renderer/preload/partition, page load, navigation confinement, capture
  exclusion, tab UI, ordinary browser-tab DevTools policy, and Control/Workbench DevTools policies.

## Verification

- Extend the focused DevTools policy/source check to execute debug, release, and E2E policy cases
  and prove fixed Home load/reactivation call the idempotent detached opener.
- Run `yarn typecheck:node`, debug `yarn build`, and `git diff --check`.
- Do not launch Electron, Playwright/E2E, the real application, or packaged smoke. Ral owns final
  visual/runtime acceptance.

## Delivery

- Added the compiled-debug/non-E2E fixed-Home DevTools policy and one guarded opener shared by
  every completed Home load, active-Home re-selection, and cross-tab Home activation.
- The opener accepts only a live pinned Home view, avoids duplicates with `isDevToolsOpened()`,
  opens detached without stealing focus, and reports Electron failures through the Maestro trace
  surface.
- Release, E2E, ordinary browser tabs, Control, Workbench, renderer/preload/partition, capture, and
  tab lifecycle behavior remain unchanged.
- [Independent review 1](../reviews/maestro-local-home-devtools-010-1.md): PASS, no P1/P2/P3
  findings.
- Verification: focused DevTools check, `yarn typecheck:node`, debug `yarn build`, and
  `git diff --check` passed. Electron/E2E/real-app/packaged smoke were not run; Ral owns final
  runtime acceptance.
