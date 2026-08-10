---
id: desktop-command-line-debug-mode-010
scope: Deterministic debug CLI/E2E launches and release-only packaged Bitterless artifacts
status: done
depends-on: []
---

# Desktop Command-Line Debug Mode Boundary

## Objective

Guarantee that every unpackaged Bitterless GUI launched from a command line is explicitly
`VITE_MODE=debug`, while every packaged application is compiled as `VITE_MODE=release`. Fail closed
before application-owned paths, Keychain, SQLite, logging, or windows when those sides disagree.

## Context

- `docs/issues/command-line-launch-mode-mismatch.md`
- `docs/features/application-diagnostics.md`
- `docs/issues/e2e-target-display-routing.md`
- `docs/features/onlypreview.md`

## Path

- `env.rig.json5`
- `package.json`
- `electron.vite.config.ts`
- `scripts/before.js`
- `src/main/environment/`
- `src/main/security/`
- `src/main/maestro/security/sqliteKey.service.ts`
- `src/main/windows/`
- `src/shared/maestro/pathHelper/main/pathMain.helper.ts`
- `src/shared/mcp/mcpBridge.shared.ts`
- `scripts/mcp/todo-smoke.mjs`
- `tests/maestro/fixtures/bitterlessApp.fixture.ts`
- `tests/onlypreview/fixtures/onlyPreviewApp.fixture.ts`
- focused runtime-mode/config/Maestro/OnlyPreview tests
- the referenced design, issue, task, review, and plan-index documents

## Contract

1. Preserve all four backend/mode profiles, but allow `debug_*` only for unpackaged GUI and
   `release_*` only for packaged GUI.
2. Normalize Rig output so `.env.rig` has one authoritative `VITE_MODE`; do not trust duplicate-key
   order or a parent-shell override.
3. Make `dev`, `dev:prod`, `start`, the default local/E2E build, every Playwright fixture, and direct
   unpackaged project launch debug or fail closed.
4. Make every package-building alias explicitly select `release_dev` or `release_prod` and invoke an
   internal build command that cannot reset it to debug.
5. Assert compiled mode plus unpackaged child-process mode in the first runtime-profile bootstrap.
   Do not create an empty/default fallback.
6. Select debug-only SQLite/DevTools behavior from `VITE_MODE`, never from `VITE_ENV` or a missing
   `process.env.VITE_MODE` fallback. Keep packaged release Keychain behavior unchanged.
7. Keep production Node-only helpers functional; they do not launch the GUI and inherit their
   packaged release artifact. Align existing debug helper paths/names with the active
   `Bitterless_DEBUG_PROD` and `Bitterless_DEBUG_DEV` profiles.
8. Preserve the E2E mock-Keychain, isolated HOME/userData, network guard, and DELL target-display
   contracts.

## Verification

- Pure configuration test enumerates all supported GUI launch and packaging aliases, the canonical
  `.env.rig` normalization, dotenv precedence, and both fixture child environments.
- Runtime-profile unit tests cover every allowed and rejected packaging/mode combination and prove
  rejection precedes path mutation.
- Maestro focused tests prove debug_prod/E2E never reaches safeStorage and packaged release still
  uses the production key path.
- SafeStorage policy tests allow access only for packaged release, and MCP route tests cover the
  active debug profile identities without changing the production `bitterless` route.
- Existing diagnostics, OnlyPreview, target-display, and relevant package-script tests pass.
- Fresh `yarn build`, focused Electron E2E, typecheck/lint, and `git diff --check` pass.
- Independent Verify writes `docs/plan/reviews/desktop-command-line-debug-mode-010-1.md`; only then
  may this task and its issue be marked done/fixed.

## Implementation result

- Added one runtime-profile wrapper for Rig normalization, hostile parent-shell override, exact
  debug/release child environments, and a single canonical `VITE_MODE` in `.env.rig`.
- Routed unpackaged GUI/default build/E2E commands through debug profiles and every package builder
  through an explicit release profile without a nested debug build reset.
- Added compiled/process/package assertions before application path mutation. Invalid Electron GUI
  launches now print the mode mismatch and terminate with exit code 1 at the bootstrap boundary.
- Made safeStorage, SQLite-key selection, DevTools, runtime paths, package audits, E2E fixtures, and
  active Todo MCP debug identities consume the authoritative compiled/runtime-mode contract.
- Focused verification passed: runtime profiles (7), diagnostics (12), package audit (22), display
  routing (8), OnlyPreview core (26), Maestro embedded-host, Todo MCP smoke/onboarding/multi-instance,
  Node and strict E2E typechecks, narrow task lint, and `git diff --check`.
- A fresh hostile-parent `yarn build` produced the exact `debug_dev` build marker. The focused Trench
  Electron E2E passed on `DELL S2721QS` with isolated HOME/userData, mock Keychain enabled, and no
  safeStorage tripwire. An invalid release-process launch against that debug build exited 1 before
  GUI startup.
- Full `yarn typecheck:web` remains blocked by pre-existing unrelated connector SDK, Poker test
  global, renderer alias/type, eyes-on-agents, and shared path-helper errors; no task-owned file was
  reported. The independent Verify result is recorded below.

## Verification result

- Independent review: [desktop-command-line-debug-mode-010-1](../reviews/desktop-command-line-debug-mode-010-1.md)
  — **pass**, with no open P1, P2, or P3 finding.
- Verify re-audited the full launch/package alias matrix, canonical Rig environment, build marker,
  first-bootstrap mismatch assertion, safeStorage boundary, compiled-mode paths, active MCP debug
  identities, and Node-only helpers.
- The initial Maestro DevTools release-bypass finding was corrected across Main window, Control,
  Workbench, and operation views. The final matrix rejects hostile `COACH_*` flags in both release
  profiles and all debug E2E while retaining explicit debug-only opt-ins.
- Fresh hostile-parent release and debug builds, the release-mode negative Electron probe, and one
  mock-Keychain Electron E2E on `DELL S2721QS` passed. The E2E used isolated HOME/userData, emitted
  no safeStorage tripwire, and left no project Electron or Playwright process.
- Focused unit/config/diagnostics/Maestro/MCP/package/type/lint checks and `git diff --check` passed.
  Full web typecheck and broad Maestro aggregation remain unrelated baselines documented in the
  review; neither reports a task-file defect.
