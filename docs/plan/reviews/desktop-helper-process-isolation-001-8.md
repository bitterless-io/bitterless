# Desktop Helper Process Isolation Review — Round 8

Status: changes requested

Date: 2026-07-17

## Conclusion

**Blocked by one P2 verification gap.** Both Round 7 P1 contract-drift defects are substantially
fixed: the three startup-related scripts now reference `runSqliteFirstGuiStartup`, contain no
positive assertion for target/Core elapsed timeouts, and assert SQLite launch-before-fallback plus
foreground independence. The reviewed runtime files have no new blocking defect.

The Round 7 requested diagnostics coverage is still absent, however. The task explicitly requires
checks for subscribe-before-fetch, revision ordering, and stage replacement/clearing; current
scripts only source-match one `core-sqlite` report call. This leaves the new user-visible failure
path unprotected and keeps the task from its documented verification contract.

## Findings

1. **P2 — blocking — startup diagnostics revision and delivery behavior remains unverified.**
   `scripts/startup/core-gated-startup.test.mjs` now behavior-tests a pending Core promise,
   foreground continuation after Core rejection, and deferral of the Core-ready callback until Home
   exists (`scripts/startup/core-gated-startup.test.mjs:71-122`). After that, it only asserts that
   `app.main.ts` contains `startupDiagnosticsService.report('core-sqlite', err)`
   (`scripts/startup/core-gated-startup.test.mjs:180`). Neither this script nor the MCP/i18n checks
   exercise or source-guard:

   - same-stage replacement and no duplicate stage entries;
   - monotonic revision increments and clearing a recovered stage;
   - renderer subscription before snapshot fetch;
   - rejection of a stale fetch after a newer broadcast.

   These are required by `docs/plan/tasks/desktop-helper-process-isolation-001.md` and
   `docs/features/startup-diagnostics.md`. Add deterministic service/store-level checks (or focused
   source guards where Electron-bound behavior cannot be imported) for all four contracts. No
   Electron launch is needed.

## Round 7 findings rechecked

- **Resolved P1:** `test:startup` imports `runSqliteFirstGuiStartup`; old
  `runCoreGatedGuiStartup`, `waitForTargetPreloadRegistration`, `waitForCoreSqlite`,
  `StartupTimeoutError`, and positive 30-second timeout cases are gone.
- **Resolved P1:** MCP and renderer-i18n checks now require SQLite launch before fallback/Home,
  `void` observation of Core, no startup timeout adapter, no `app.exit(1)`, default-bounds Home,
  and post-Core dependent initialization wiring. Their remaining `timeoutMs` occurrence belongs to
  an unrelated MCP transport case, not GUI startup.

## Runtime recheck

No runtime source changed in a way that introduces a new blocker after Round 7. SQLite registration
and Core readiness remain background-observed; explicit failures feed the in-memory service; Home
uses fallback language/default bounds; durable language, layout, MCP bridge, and EyesOnAgents start
from Core success; and the MenuBar still implements the intended cross-platform hover/focus/i18n
surface.

## Verification

Per instruction, no tests, build, typecheck, or Electron process was run. This was a focused static
re-review. Only this review document was added by the reviewer.
