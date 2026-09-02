---
id: maestro-local-home-auth-gate-096
scope: restore the original Bitterless Login experience inside Maestro fixed Home before Mini Apps
status: implemented; owner verification pending
depends-on: [maestro-local-home-navigation-007, maestro-hot-reload-home-visibility-012]
verify: focused Node source/contract tests, customer-auth regression, node typecheck, debug build, diff check, independent source review; no Electron/E2E
---

# Gate Maestro fixed Home with the hidden Home authentication authority

## Objective

Keep Maestro as the sole visible native primary while restoring the original Bitterless Login
experience inside its pinned `bitterless://home` tab. Mini Apps must render only after the hidden
Home authentication authority reports an active, password-complete customer session.

## Context

- `docs/features/maestro.md`
- `docs/issues/maestro-local-home-login-missing.md`
- `docs/issues/maestro-local-home-still-shows-chat.md`
- `docs/issues/maestro-hot-reload-reveals-legacy-home.md`
- `docs/plan/tasks/maestro-local-home-navigation-007.md`
- `docs/plan/tasks/maestro-hot-reload-home-visibility-012.md`

## Path

- `src/shared/home/homeShellBridge.contract.ts`
- `src/renderer/common/homeShellBridge.client.ts`
- `src/renderer/home/src/xpc/homeShellBridge.handler.ts`
- `src/renderer/home/src/views/login/`
- `src/renderer/maestro/localHome/src/`
- focused Home/Customer-auth source tests
- the linked feature, issue, task, indexes, and independent review artifact

## Contract

- The legacy Home renderer remains hidden and is the only customer-auth authority. It owns token
  persistence, `/auth/*` requests, session/device metadata, authenticated runtime activation, and
  Todo readiness.
- Extract the existing Login presentation/interaction flow into one reusable surface. The normal
  Home route adapts the existing `authStore`; fixed Home adapts the typed Home-shell bridge. Do not
  fork or partially reimplement the password, OTP, reset, password-setup, or recovery UI.
- The bridge exposes a strict, token-free snapshot with explicit unknown/signed-out/saved-session/
  restoring/password-setup/authenticated states and addressed authentication commands. All return
  payloads are strictly parsed. Errors are sanitized for visible presentation.
- Fixed Home subscribes to snapshot changes before requesting its initial snapshot. Until a valid
  authenticated snapshot exists, the Mini Apps/Connector layout is not mounted.
- A fixed-Home recreation always reads the current snapshot; no renderer-local credential or stale
  authenticated flag is trusted. Logout/invalidation broadcasts signed-out state and leaves Maestro
  visible on Login.
- Login success targets fixed Home `/mini-app`; the normal hidden Home wrapper may retain its
  compatibility route behavior. Never navigate fixed Home to legacy `/chat`.
- Keep the local Home preload XPC-only and keep password/OTP command parameters out of logs and
  broadcast events. Never return token, session ID, device ID, or raw customer payloads.
- Preserve fixed-tab browser/security rules, i18n initialization, Connector delegation, Mini Apps
  layout, and the legacy native Home hidden-only contract.

## Verification

- Add focused contract/source regressions for strict snapshot/result parsing, token exclusion,
  subscribe-before-read startup, fail-closed content selection, shared Login surface reuse, and
  hidden legacy Home visibility.
- Run the focused tests plus the existing customer-auth regression, `yarn typecheck:node`, a debug
  `yarn build`, and `git diff --check` when the dirty worktree permits an attributable result.
- Do not launch Electron, Playwright/E2E, a packaged app, signing, notarization, or publication.
  Ral owns runtime/visual E2E acceptance.

## Owner verification

- Start signed out: Maestro appears first and fixed Home shows Login without a Mini Apps flash.
- Verify password and OTP login, reset password, invited-account setup, saved-session recovery,
  recovery retry/cancel/switch account, logout, and invalidation.
- Reload/recreate the fixed Home while signed in and signed out; each recreation must immediately
  converge on the correct language and authentication surface.
- Confirm no legacy `BitterLess` / `New Chat` native window appears during startup or HMR.

## Delivery

- Added a strict Home-shell authentication contract with token-free presentation snapshots,
  addressed commands, fixed safe error messages, a persisted authority epoch, and monotonic
  revisions. Fixed Home keeps a high-water mark so older reads or command results cannot overwrite a
  newer logout/invalidation state.
- Added a fail-closed fixed-Home controller that subscribes before its initial read. Malformed
  broadcasts clear trusted state immediately; unavailable authority probing is bounded to 4.25
  seconds before the localized retry surface appears.
- Kept the hidden Home renderer as the only authentication authority and added a reactive
  presentation revision for token-only invalidation. Passwords and OTPs remain addressed command
  inputs; tokens, session/device identifiers, raw customer payloads, and raw backend errors never
  cross the bridge.
- Reused the complete existing Login UI through legacy and fixed-Home adapters. Shared saved-session
  recovery is single-flight with consumer leases; component teardown only stops that consumer,
  while the explicit Cancel action alone aborts the underlying recovery. Local Home owns its one
  post-auth route transition and preserves later Settings navigation.
- Focused Maestro/auth-gate regressions passed 14/14, `yarn typecheck:node` passed, task-scoped
  ESLint reported zero errors, the debug `yarn build` passed, and `git diff --check` passed.
  `yarn typecheck:web` remains blocked only by existing Poker/Chat/global-bridge/path errors outside
  this task. Customer-auth passed 19/20; its existing production-endpoint assertion still expects
  two Shanghai URL occurrences while the dirty worktree contains three.
- [Independent review 1](../reviews/maestro-local-home-auth-gate-096-1.md) found four P1 and three P2
  issues in its first pass. All were fixed and the second pass approved the final source with no
  unresolved P0-P2 findings.
- Electron, Playwright/E2E, packaged-app smoke, signing, notarization, publication, and network
  operations were not run. Ral owns runtime and visual acceptance.
