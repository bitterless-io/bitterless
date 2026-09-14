# SQLite native ABI mismatch

Status: implemented; installed native dependency repaired and verified; app restart remains a human check.

## Symptom and evidence

The hidden SQLite preload cannot load `better-sqlite3-multiple-ciphers`, so database-backed features fail before any history query or migration can run.

Local inspection on 2026-09-14 found:

- Both the project manifest and installed Electron package specify **40.10.6**.
- Running that exact installed executable with `ELECTRON_RUN_AS_NODE=1` reports **Node 24.15.0**, **NODE_MODULE_VERSION 143**, **darwin arm64**.
- The installed `better-sqlite3-multiple-ciphers` package is **12.11.1**, but constructing an in-memory database fails because its native binary was compiled for **NODE_MODULE_VERSION 137**.
- The installed `node-abi` table identifies ABI 137 as ordinary Node 24 and ABI 143 as Electron 40. The dependency's install hook defaults to a Node prebuild; Bitterless previously rebuilt for Electron only during its root `postinstall`.
- The native binary is dated 2026-06-18. The available evidence establishes stale native output; it does not identify which earlier install or packaging command last replaced it.

This is a local native dependency mismatch, independent of the browser-history table and migration. JavaScript bundling and `node:sqlite` unit tests cannot detect this ABI failure.

## Repair contract

Rebuild the installed native dependency for the actual installed Electron version and architecture, without upgrading dependencies or touching application databases. Verify by loading the module and executing SQL in an in-memory database under the exact Electron executable in Node mode.

`scripts/ensure-native.cjs` now probes native loading before launching the app, repairs only when needed, and verifies again after repair. The `pre_dev:debug`, `pre_start:debug` and `pre_build:debug` Yarn hooks cover the internal DEBUG commands and their public aliases. `yarn prepare:native` runs the same guard directly. A compatible binary skips rebuilding. A broken Electron executable or failed repair stops startup with an actionable error. Release packaging retains its existing target-specific native rebuild flow.

Repair uses the installed `electron-rebuild` through Yarn, passing the actual runtime version and architecture and selecting only `better-sqlite3-multiple-ciphers`. The installed repair target was Electron 40.10.6 / arm64. No dependency version or lockfile changed.

The related Cowork `ensure-native.cjs` checks binary OS/architecture; that check alone does not catch a different Electron ABI on the same architecture. Bitterless needs the actual headless native-load probe.

## Verification

- `yarn test:native-abi`: **7 passed**, including no-op compatibility, same-architecture ABI repair, post-repair verification, failure handling, Windows Yarn entry resolution and DEBUG hook coverage.
- Existing environment/external-tool preparation and SQLite release-hook tests: **41 passed**.
- The exact Electron 40.10.6 executable now imports the native module and executes in-memory SQL at ABI 143 / arm64.
- A temporary SQLite file with a random key has an encrypted header, survives close/reopen with the same key, and rejects a different key. The file was removed; no real application database was opened and no key was logged.
- A subsequent `yarn prepare:native` reports that no rebuild is needed; native binary SHA-256 and modification time remain unchanged.
- No Electron GUI, app launch or E2E was run. Human check: restart the previously failing DEBUG app and confirm the SQLite preload reaches ready without a `NODE_MODULE_VERSION` error.
