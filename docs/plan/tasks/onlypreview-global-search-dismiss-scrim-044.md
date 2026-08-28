---
id: onlypreview-global-search-dismiss-scrim-044
scope: Main-owned Global Search visibility and a Shell dismissal scrim behind its native child view
status: implemented; owner verification pending
depends-on: [onlypreview-cold-folders-native-search-overlay-043]
verify: focused OnlyPreview Node tests, yarn typecheck:node, directed vue-tsc, yarn build, git diff --check; no Electron/Playwright/E2E
---

# Add a click-to-dismiss scrim behind Global Search

## Objective

When Global Search is visible, tint and block the underlying OnlyPreview Shell with one transparent
scrim. Clicking any exposed Shell area closes Global Search and restores the live surface that
opened it, without reloading Preview or creating another native view/process.

## Contract

- Main owns the authoritative active state because it alone attaches and detaches the Search
  `WebContentsView`. It broadcasts an exact host-scoped `{ hostId, revision, active }` visibility
  event after show, close, renderer failure, and teardown.
- The existing context snapshot includes the same active state and monotonic revision, and a Shell
  context report replays the current visibility. This closes both sides of the startup/reload race:
  Shell can recover an already-attached Search, while a late/HMR Search renderer can recover a close
  event it missed. Older events and async snapshot responses cannot overwrite a newer state.
- Shell validates the event shape and host before updating one reactive `globalSearchActive`
  boolean. It never infers visibility from focus, Preview bounds, or local shortcut handling.
- While active, render one full-Shell button scrim behind the native Search child view. The Search
  view naturally remains above it; the exposed menu, Project pane, splitter, Preview toolbar, and
  status rail are visibly muted and do not receive their original click.
- Clicking the scrim calls the existing close command with `mode: 'opener'`. Main detaches Search
  first, then restores the captured Vue/Chrome opener, falling back to Project and Preview through
  the existing focus contract.
- Repeated close requests are idempotent. An already-inactive Search republishes `active: false`
  but never runs opener/Project/Preview focus fallback again.
- The warm Search renderer consumes `active: false` by exiting its workspace state, cancelling the
  live request, and clearing query/results. A later open captures the current directory afresh.
- Keep the visual treatment within the existing Royal/Ink palette. Use a light alpha fill only:
  no blur, animation, backdrop filter, shadow, extra component library, or native window/view.
- The scrim is not keyboard-focusable. Search already owns focus and `Esc`; the scrim has an
  accessible close label for pointer/accessibility inspection.

## Verification

- Main service tests prove visibility `true` on show, `false` on every close/failure/teardown, warm
  reopen, and current-state replay after a Shell context report.
- Source integration tests prove exact event validation/host isolation, reactive Shell state, one
  full-Shell scrim, `mode: 'opener'`, and a semi-transparent non-animated/non-blurred style.
- Run focused non-Electron tests, Node and directed Renderer type checks, `yarn build`, and
  `git diff --check`. Do not run Electron, Playwright, E2E, packaged smoke, or the real app.

## Delivery

- Main now owns one revisioned visibility state for the native Search child view. Show, close,
  context replay, renderer failure, and teardown publish the exact host-scoped state; repeated
  close requests do not repeat focus restoration.
- Shell consumes only current-revision visibility events and renders one non-focusable full-Shell
  button scrim. Its click is consumed and closes Search through the existing `mode: 'opener'`
  command, while native child-view ordering leaves Search itself unobscured.
- A late or hot-reloaded Search renderer recovers visibility from the context snapshot. Closing
  exits its warm workspace, cancels the live request, and clears stale query/results before the
  next open.

## Verification Results

- Focused task and integration tests: **PASS, 33/33**.
- `yarn typecheck:node`: **PASS**.
- `yarn vue-tsc --noEmit --noCheck -p tsconfig.web.json --composite false`: **PASS**.
- `yarn build`: **PASS**; the validation-only package-name mutation was restored afterward.
- Task-scoped ESLint and `git diff --check`: **PASS**.
- Independent final review: **PASS**, no P1, P2, or P3 finding.
- Electron, Playwright, E2E, packaged smoke, and the real application were not run, as required.

## Owner Verification

- Open Global Search over Vue Preview and PDF/HTML Preview. Confirm the exposed main-window chrome
  is lightly dimmed, Search stays fully visible, and one click on Project/menu/toolbar/status
  background closes Search without activating the control underneath.
- Confirm focus returns to the Preview surface that opened Search and reopening Search remains
  warm.
