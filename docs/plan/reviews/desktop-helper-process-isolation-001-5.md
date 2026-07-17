# Desktop Helper Process Isolation Review — Round 5

Status: changes requested

Date: 2026-07-17

## Conclusion

**Blocked by one P1 startup regression and one P2 verification gap.** The strict Core SQLite gate,
normal-language ordering, build-time `version_code`, removal of the boot-time package XPC call,
single-flight SQLite initialization, and message-server no-reopen changes are directionally correct.
Document/Core failure propagates out of the coordinator before language, Home, shim, Tray, MCP, or
EyesOnAgents stages, while the system-language fallback remains confined to the early macOS quit
dialog.

Home can still be lost indefinitely after a successful Core boot, however, because the persisted
layout RPC was made unbounded again. The new pure coordinator suite also does not behaviorally
exercise the production 30-second document/Core timeout adapters, so the task's fatal-timeout and
zero-side-effect acceptance remains insufficiently protected.

## Findings

1. **P1 — blocking — a lost persisted-layout reply can still prevent Home forever after Core
   succeeds.** `MainWindowHelper.create()` directly awaits `this.loadLayout()` with no deadline
   (`src/main/windows/mainWindow.helper.ts:79` in the reviewed snapshot). `loadLayout()` converts a
   rejection to `null`, but it cannot recover when the `SettingDao.get()` XPC request never settles;
   the `canCreate` shutdown guard and `super.create()` are both after that await. This recreates the
   original missing-Home failure class after the mandatory SQLite gate has already succeeded.

   SQLite-first does not make saved geometry a mandatory database-readiness condition. Restore a
   bounded layout read after Core success and fall back to default bounds on timeout/rejection,
   while keeping hidden-document and Core readiness timeouts fatal. Add a deterministic
   never-settling layout test proving Home proceeds with defaults, plus a shutdown-wins case proving
   the delayed request cannot revive Home.

2. **P2 — blocking — the production handshake, fatal deadlines, and exactly-once storage boundary
   are source-checked rather than behavior-tested.** `scripts/startup/core-gated-startup.test.mjs:21`
   supplies entirely fake coordinator dependencies. Its failure cases inject an immediate document
   rejection or Core `ok: false`/rejection (`scripts/startup/core-gated-startup.test.mjs:94` and
   `scripts/startup/core-gated-startup.test.mjs:126`); none exercises the real preload-to-main
   `CoreSqliteBootDao.ready()` handshake required by the task. Consequently the suite cannot prove
   handler registration precedes the call or cover a missing/null runtime result before the
   coordinator dereferences `.ok`.

   The same suite never invokes the `withStartupTimeout` adapters from
   `src/main/app.main.ts:249`, fires a deterministic deadline, asserts the 30,000 ms value, or proves
   that a real timeout reaches the fatal `startGui()` rejection path with zero
   language/Home/shim/Tray/MCP/Eyes effects. Production ordering is otherwise guarded mainly by
   source-string indexes in the MCP/i18n scripts, while the SQLite exactly-once/no-reopen assertions
   at `scripts/startup/core-gated-startup.test.mjs:175` merely match implementation spellings. They
   never call concurrent/repeated `SqliteManager.init()` or repeated `initMessageServer()` and would
   miss a behaviorally broken implementation that retained those strings.

   Add an exported/testable production dependency builder or equivalent adapter seam. With a manual
   scheduler, cover never-resolving hidden-document and Core waits, assert a 30-second
   `StartupTimeoutError`, assert coordinator rejection, and assert that every post-Core side-effect
   spy remains untouched. Add behavior tests for null Core results, concurrent success/failure
   single-flight initialization, and idempotent message-server registration. The same boundary
   should prove only SQLite-required XPC/path prerequisites run before Core and that early-quit
   localization does not initialize normal application language state. Keep source checks only as
   supplemental wiring guards.

## Accepted evidence rechecked

- `runCoreGatedGuiStartup()` orders prerequisites, hidden-document completion, explicit Core
  success, durable language, Home, shim, Tray, and optional integrations, with a shutdown check
  after every awaited stage (`src/main/startup/guiStartup.service.ts:18`). Document rejection and
  Core rejection/`ok: false` stop before every post-Core stage.
- Normal `startGui()` no longer installs fallback language. The only remaining fallback call in the
  GUI lifecycle is immediately before the early macOS quit confirmation dialog
  (`src/main/app.main.ts:362`).
- Both hidden-document and authoritative Core readiness waits are wrapped by the same 30-second
  fatal timeout; neither catch continues into a degraded shell (`src/main/app.main.ts:249` and
  `src/main/app.main.ts:256`).
- `electron.vite.config.ts` reads `package.json.version_code`, requires a 12-digit string, and injects
  its literal into preload builds. Core passes that build constant to `SqliteManager.init()` and no
  longer requests package metadata through XPC.
- The reviewed SQLite manager retains one initialization operation, including failure, and
  `initMessageServer()` no longer calls `sqliteManager.init()`; its handler registration is guarded
  independently. Thus message-server startup cannot reopen the database.
- Dedicated Node-only helper entries, `ELECTRON_RUN_AS_NODE=1` shims, pinned endpoints, GUI-only
  singleton ownership, and EyesOnAgents exact-artifact safeguards remain present in the unchanged
  helper paths.

## Verification

| Check | Result |
|---|---|
| `yarn typecheck:node` | pass |
| `git diff --check` | pass |
| `yarn test:startup` | failed while the shared worktree was already receiving follow-up edits: its source regex still required the earlier `initPromise` spelling while the manager had moved to `onceAsync`; this independently demonstrates the brittleness described in finding #2 |
| `yarn check:renderer-i18n` | failed during the same concurrent follow-up: its exact source assertion for the layout implementation no longer matched the in-progress bounded-layout fix |
| independent `yarn build` / socket helper suite | not rerun before this blocking review was closed; the implementation pass had reported them green, but that is not counted as stable Round 5 reviewer evidence because the worktree changed during verification |

No Electron GUI process was launched. Only this review document was added by the reviewer.
