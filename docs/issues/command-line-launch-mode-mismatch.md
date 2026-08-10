# Command-Line Launch Can Reuse Release Mode

Status: Fixed

Implementation:
[desktop-command-line-debug-mode-010](../plan/tasks/desktop-command-line-debug-mode-010.md)

## Symptom

An unpackaged Bitterless started from a terminal is not guaranteed to be a debug runtime. `dev` and
`dev:prod` select debug profiles, but `start`, a plain build followed by Playwright, and direct
Electron project launches can reuse whichever ignored `.env.rig` and `out/` were produced last.

Rig also writes its selected profile name as an initial `VITE_MODE` line before writing the
profile's own `VITE_MODE`. The current generated file therefore depends on duplicate-key order
instead of containing one authoritative `debug` or `release` value.

## Required behavior

`VITE_MODE` is a two-sided launch boundary, not a best-effort default:

| Runtime | Compiled `VITE_MODE` | Child process `VITE_MODE` | Result |
| --- | --- | --- | --- |
| unpackaged GUI from CLI | `debug` | `debug` | allowed |
| unpackaged E2E GUI | `debug` | `debug` | allowed |
| packaged application | `release` | not authoritative | allowed |
| unpackaged GUI with any release/missing side | other | other | fail before application-owned paths or windows |
| packaged application compiled as debug | `debug` | any | fail before application-owned paths or windows |

- Every supported package-manager GUI command selects its profile explicitly. It must not depend on
  a pre-existing `.env.rig` or parent-shell `VITE_MODE`.
- Generated `.env.rig` contains exactly one effective `VITE_MODE=debug|release`; `MODE` may retain
  the Rig profile identity such as `debug_prod`.
- Default local build/preview and all Playwright launch fixtures are debug. Every package builder,
  including test-backend `build_dev:*` artifacts, explicitly builds release mode.
- Main rejects a compiled/runtime mismatch in the first runtime-profile bootstrap, before userData,
  logging, SQLite, Keychain, or any BrowserWindow is reached.
- Debug Maestro SQLite uses the development/E2E key path even when `VITE_ENV=prod`; production
  Keychain selection is release-only. DevTools gates follow `VITE_MODE`, not the backend target.
- Dedicated `ELECTRON_RUN_AS_NODE=1` helper entries do not open the Bitterless GUI and retain the
  compiled mode of their source artifact.

## Acceptance

- Pure tests enumerate every GUI launch/build/package script and reject an implicit or stale mode.
- Runtime-profile tests reject packaged+debug, unpackaged+release, and unpackaged missing/non-debug
  process mode before any path mutation.
- Both E2E fixtures pass an isolated `VITE_MODE=debug`, and a release-built `out/` cannot be launched
  as E2E.
- `debug_prod` Maestro startup does not touch safeStorage/Keychain; packaged release keeps the
  production Keychain path.
- A fresh debug build and focused Electron E2E complete with mock Keychain and target-display
  routing; a release-mode negative probe fails before a visible window.
