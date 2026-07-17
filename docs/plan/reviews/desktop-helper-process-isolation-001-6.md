# Desktop Helper Process Isolation Review — Round 6

Status: acceptance pending live evidence

Date: 2026-07-17

## Conclusion

**No confirmed P0, P1, or P2 findings.** The Round 5 production defect and focused-test gaps are
closed. Post-Core layout hydration is bounded with a default-layout fallback; real timeout utility
behavior stops the coordinator before every later phase; null Core results fail explicitly;
single-flight SQLite initialization is behavior-tested across concurrent, sequential, and failed
calls; and message-server setup has no path that reopens SQLite.

No further source or focused-test change is blocking. Full acceptance is pending one controlled
real built-app startup because this review was explicitly prohibited from launching Electron. The
existing isolated Maestro Playwright baseline is sufficient evidence for the positive
CoreSqliteBootDao preload-to-main handshake; a separate spec is not required solely for this gate.

## Round 5 findings resolved

1. **Resolved P1 — post-Core layout hydration can no longer hold Home indefinitely.**
   `MainWindowHelper.create()` wraps `SettingDao.get()` in a one-second `withStartupTimeout`, warns
   and retains default bounds on rejection/timeout, then evaluates the shutdown guard before
   `super.create()` (`src/main/windows/mainWindow.helper.ts:82`). SQLite document/Core failures
   remain fatal; only the non-critical saved geometry has a fallback.

2. **Resolved P2 — the critical failure and single-flight behaviors now execute as tests.**

   - The startup suite runs the real `withStartupTimeout` implementation with a manual scheduler
     for never-resolving document and Core waits. After firing either deadline it asserts
     `StartupTimeoutError` and an exact event list containing no language, Home, shim, Tray, or
     optional-integration phase (`scripts/startup/core-gated-startup.test.mjs:165`).
   - Null Core results are accepted by the dependency boundary only so the coordinator can reject
     them explicitly with the same fatal no-later-phase behavior
     (`src/main/startup/guiStartup.service.ts:27`,
     `scripts/startup/core-gated-startup.test.mjs:145`).
   - `onceAsync` retains the first operation promise. Tests prove concurrent and later calls return
     that exact promise/result and that a rejected first attempt is cached rather than retried
     (`src/preload/sqlite/sqliteHelper/onceAsync.ts:1`,
     `scripts/startup/core-gated-startup.test.mjs:259`). `SqliteManager.init()` delegates directly
     to this one-shot operation (`src/preload/sqlite/sqliteHelper/sqlite.manager.ts:19`).
   - `initMessageServer()` no longer imports or invokes `sqliteManager`; it only idempotently
     registers chat handlers. Its sole production bootstrap follows a successful retained SQLite
     boot promise (`src/preload/sqlite/messageServer/messageServer.ts:101`,
     `src/preload/sqlite/sqlite.preload.ts:85`). Repeating message-server setup therefore cannot
     reopen the database.

## Real Core handshake assessment

The remaining concern is a **verification gap, not an observed production defect**:

- `test:e2e:maestro:baseline` rebuilds the current application before using the real Electron
  fixture (`package.json:43`).
- The fixture creates fresh isolated home and `userData` roots, supplies E2E network isolation but
  no SQLite bypass, launches the built application entry, and fails unless the Home renderer
  appears (`tests/maestro/fixtures/bitterlessApp.fixture.ts:218`,
  `tests/maestro/fixtures/bitterlessApp.fixture.ts:240`).
- In the production path, Home is unreachable until the hidden SQLite document loads and
  `coreSqliteBoot.ready()` returns `{ ok: true }`; only then do language and Home run
  (`src/main/app.main.ts:234`). The preload handler itself awaits the real database boot promise
  before replying (`src/preload/sqlite/sqlite.preload.ts:60`).

Therefore one passing `yarn test:e2e:maestro:baseline` run proves actual preload registration,
XPC dispatch/reply, SQLite initialization, explicit Core success, and post-Core Home creation. The
deterministic tests already cover timeout/failure branches, so no additional Electron test is
needed for those paths. Existing Playwright artifacts are dated 2026-07-15 and predate this build;
they are not counted as Round 6 evidence.

## Additional evidence

- Normal GUI startup contains no system-language fallback. The only fallback remains immediately
  before the early macOS quit dialog; durable language hydration occurs strictly after Core success.
- The preload build validates `package.json.version_code` as a 12-digit string and injects it at
  build time. The reviewed build emitted `sqliteManager.init("260716214318")` in
  `out/preload/sqlite.js`; the former runtime package-info request is absent.
- Hidden document and Core readiness retain 30-second fatal deadlines with no degraded-Home catch.
- Dedicated MCP/Codex helper bundles, RunAsNode shim generation, GUI-only singleton ownership,
  lifecycle fencing, and exact EyesOnAgents artifact safeguards remain intact.

## Verification

| Check | Result |
|---|---|
| `yarn test:startup` | pass: strict order, document/Core failures and deadlines, null Core, shutdown guard, and onceAsync success/failure caching |
| `yarn check:renderer-i18n` | pass: SQLite-first language/Home order, dialog-only fallback, and bounded layout source wiring |
| `yarn test:mcp:multi-instance` | pass after sandbox escalation for local Unix sockets |
| `yarn test:eyes-on-agents:bridge` | pass: bridge and durable hook-delivery suites |
| `yarn typecheck:node` | pass |
| SQLite migration typecheck, audit, and release-hook tests | pass: 11 Core + 7 Maestro baselines and 11 hook tests |
| `yarn build` | pass; main, dedicated helper, preload, and renderer outputs emitted |
| built SQLite preload inspection | pass: literal 12-digit version code injected; no runtime package-info hydration in the boot path |
| `git diff --check` | pass |
| `yarn test:e2e:maestro:baseline` | not run: it launches Electron, prohibited in this review; required once to close live handshake acceptance |

No Electron process was launched. Only this review document was added by the reviewer.
