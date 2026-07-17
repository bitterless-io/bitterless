# Desktop Helper Process Isolation Review — Round 7

Status: changes requested

Date: 2026-07-17

## Conclusion

**Blocked by two P1 verification-contract regressions.** The reviewed runtime implementation now
starts the SQLite renderer first but does not await target registration or Core readiness in the
foreground lane. Home starts with system-language fallback and default bounds; explicit Core and
dependent-stage failures enter revisioned, main-owned diagnostics; persisted language, layout,
MCP, and EyesOnAgents remain behind Core success. The Home menubar subscribes before fetching,
rejects stale revisions, and exposes localized hover/keyboard-focus content on the shared macOS and
Windows surface.

The task is not deliverable yet because every startup-related scripted verification entry still
encodes the superseded fatal 30-second gate. One script cannot import the renamed coordinator at
all, while two other required checks assert precisely the behavior the current design forbids.

## Findings

1. **P1 — blocking — `test:startup` imports a removed coordinator and continues to test the
   prohibited timeout/fatal-gate contract.** The package entry still runs
   `scripts/startup/core-gated-startup.test.mjs` (`package.json:21`), but that file imports
   `runCoreGatedGuiStartup`, which is no longer exported
   (`scripts/startup/core-gated-startup.test.mjs:11`; the implementation now exports
   `runSqliteFirstGuiStartup` at `src/main/startup/guiStartup.service.ts:30`). Its dependency
   fixture still supplies `waitForTargetPreloadRegistration`, `waitForCoreSqlite`, strict
   post-Core language ordering, and fatal timeout cases (`scripts/startup/core-gated-startup.test.mjs:41-239`).
   This conflicts with the non-blocking contract in `docs/features/startup-diagnostics.md` and
   leaves the task's required coordinator/diagnostics behavior uncovered. Replace it with tests
   proving an unresolved Core promise does not delay fallback/Home/shim/Tray, explicit failure is
   observed without rejecting foreground startup, Core success alone releases dependent work, and
   revisioned diagnostics replace/clear by stage.

2. **P1 — blocking — required MCP and renderer-i18n checks still reject the new startup design.**
   The MCP suite searches for `waitForTargetPreloadRegistration`, requires the Core guard before
   language/Home, and requires `timeoutMs: SQLITE_STARTUP_TIMEOUT_MS`
   (`scripts/mcp/multi-instance.test.mjs:799-824`). The renderer-i18n check likewise requires Core
   readiness to be awaited, forbids normal fallback initialization, requires Home after persisted
   language, and requires the deleted one-second pre-Home layout gate
   (`scripts/renderer-i18n/check-renderer-i18n.mjs:67-112`). These assertions directly contradict
   `docs/features/startup-diagnostics.md` and the task verification contract, so the documented
   release checks cannot pass against a correct implementation. Update both checks to assert
   SQLite launch-before-foreground ordering, no target/Core elapsed timeout, fallback-before-Home,
   default-bounds Home creation, post-Core durable hydration, and diagnostics
   subscribe-before-fetch/revision behavior.

## Non-blocking observations

- **P3 — non-blocking — package profile drift is present in the review worktree.**
  `package.json` changes `name` from `Bitterless_DEV_DEBUG` to `Bitterless_DEBUG`, which is unrelated
  to this task's runtime or diagnostics contract. Confirm that this is the intended checked-in
  profile before committing the task (`package.json:212`).

## Static contract assessment

- `runSqliteFirstGuiStartup()` invokes Core start before fallback/foreground work and does not await
  its result (`src/main/startup/guiStartup.service.ts:36-73`). No elapsed-time adapter remains on
  target registration/Core readiness, and normal GUI failure logging no longer calls `app.exit(1)`
  (`src/main/app.main.ts:352-429`, `src/main/app.main.ts:466-468`).
- Core create, preload, renderer, navigation, database, schema, and migration errors flow through
  the observed Core promise into the in-memory `core-sqlite` issue. Stage-specific dependent
  failures are replaced/cleared by stable code and monotonic revision
  (`src/main/startup/startupDiagnostics.service.ts:14-60`).
- Home is created without a persistence read; layout hydration and durable language initialize
  only after Core success (`src/main/windows/mainWindow.helper.ts:76-120`,
  `src/main/app.main.ts:410-422`). SQLite-dependent MCP/EyesOnAgents startup is also launched only
  from the Core-ready callback.
- The renderer subscribes before `getStartupDiagnostics()`, validates the snapshot, and ignores
  equal/stale revisions (`src/renderer/home/src/components/MenuBar/menuBar.store.ts:22-36`,
  `src/renderer/home/src/components/MenuBar/menuBar.store.ts:78-88`). The shared MenuBar control is
  no-border/background-led, hover-driven through Arco Tooltip, explicitly focus-controlled for
  keyboard users, and uses English/Chinese stage keys on both platform layouts
  (`src/renderer/home/src/components/MenuBar/MenuBar.vue:10-45`,
  `src/renderer/home/src/components/MenuBar/MenuBar.less:42-99`,
  `src/renderer/common/i18n/en.ts:14-30`, `src/renderer/common/i18n/zh.ts:16-32`).
- No definite `electron-xpc`, TypeScript, or Vue template type defect was found by static review.

## Verification

Per owner instruction, this review ran **no tests, build, typecheck, or Electron process**. Findings
are based only on source/design inspection. Only this review document was added by the reviewer.
