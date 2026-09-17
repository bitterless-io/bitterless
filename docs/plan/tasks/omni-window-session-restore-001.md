---
id: omni-window-session-restore-001
scope: Omni open-state persistence and startup restore using existing display geometry
status: done
depends-on: []
verify:
  - Node lifecycle and persistence tests
  - Existing Omni and startup regression tests
  - Applicable Main typecheck and build
  - Independent code review; no Electron launch or E2E
---

# Omni window session restore

## Objective

Remember whether Omni is open and restore it on the next Bitterless launch at its saved physical
display, position and size, while retaining an explicit user close across launches.

## Context

- [Feature contract](../../features/omni-window-session-restore.md)
- [Shared geometry contract](../../features/window-state-persistence.md)
- [Omni layout and readiness](../../features/omni-miniapp-cells.md)

## Path

- `src/main/windows/omniWindow.helper.ts`
- `src/main/windows/windowState.service.ts` and any narrowly scoped session-state helper
- `src/shared/window/window.types.ts` if needed
- `src/main/app.main.ts`
- `tests/omni/` and existing window/startup test locations

## Verification

Verify fresh/legacy defaults, open then restart, manual close then restart, close then reopen,
quit/update teardown, failed/canceled quit, failed auto-open and shutdown races. Exercise the real
state persistence and display resolver with Node test doubles for Electron APIs; do not launch the
desktop. Preserve unrelated work and the current branch.

## Result

- Added the atomic Main-owned `omni-window-session.json` open flag; geometry remains in the
  existing shared state file. First presentation flushes geometry even without a move/resize.
- Core-ready startup restores one open session through the existing coordinator. Explicit close
  persists closed; internal teardown/quit preserves intent. App cleanup fences presentation and
  resets the fence after a failed cleanup attempt.
- Generation checks continue to accept valid renderer readiness receipts during reversible quit
  attempts. Presentation assertions prevent late windows during shutdown. Logout teardown still
  permits subsequent manual opening.
- `node --test tests/omni/*.test.mjs scripts/startup/core-gated-startup.test.mjs`: **74/74 passed**,
  including **18** session cases exercising real helper/coordinator/persistence code with Electron
  doubles, display changes, real renderer readiness fences and startup integration.
- `yarn electron-vite build`: **passed**, Main/preload/renderer. The direct build avoids changing
  unrelated package metadata through `scripts/before.js`.
- Strict typecheck of the new session service: **passed**. Main/shared typecheck: **65 diagnostics**;
  comparison against original task-modified source using a TypeScript CompilerHost overlay produced
  the identical diagnostic file/code/message set. The full Main check remains failing on existing
  errors; no new diagnostic was introduced.
- [Independent review](../reviews/omni-window-session-restore-001-1.md): **pass** after resolving
  the renderer-readiness finding.
- No Electron launch or E2E, per workspace instructions. Actual OS multi-monitor and fullscreen
  behavior has not been exercised. No package was installed or published.
