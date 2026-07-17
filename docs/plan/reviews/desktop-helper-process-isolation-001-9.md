# Desktop Helper Process Isolation Review — Round 9

Status: pass

Date: 2026-07-17

## Conclusion

**Pass. No P1, P2, or P3 blocking findings remain in the reviewed scope.** Round 8's diagnostics
verification gap is closed with a pure shared state model and snapshot-selection function reused by
the production main service and Home store. The startup script now behaviorally covers same-stage
deduplication/replacement, monotonic revision, missing-stage no-op, recovery clearing, and
older/equal/newer renderer selection. It also source-guards subscription before snapshot fetch.

The prior non-blocking startup contract remains intact: SQLite starts first, target/Core readiness
is observed only in the background, foreground fallback/Home/shim/Tray do not wait, explicit Core
failure remains diagnostic rather than process-fatal, and Core success releases persisted language,
layout, MCP, and EyesOnAgents work.

## Round 8 finding resolved

1. **Resolved P2 — diagnostics state and delivery contracts are now protected.**

   - `StartupDiagnosticsState` owns immutable snapshots, stable-stage replacement, duplicate no-op,
     revision increments, and clearing (`src/shared/startup/startupDiagnostics.ts:76-113`).
   - `selectNewerStartupDiagnosticsSnapshot()` validates incoming snapshots and accepts only a
     strictly newer revision (`src/shared/startup/startupDiagnostics.ts:115-121`).
   - The main service delegates mutation to the shared state and broadcasts only when revision
     changes (`src/main/startup/startupDiagnostics.service.ts:14-36`).
   - The Home store subscribes before fetching, then applies both paths through the shared selector
     (`src/renderer/home/src/components/MenuBar/menuBar.store.ts:22-36`,
     `src/renderer/home/src/components/MenuBar/menuBar.store.ts:78-90`).
   - The startup script covers initial state, report, duplicate report, replacement, missing-stage
     clear, successful clear, and stale/equal/newer selection. It also asserts subscription appears
     before the getter in the production store source
     (`scripts/startup/core-gated-startup.test.mjs:128-162`,
     `scripts/startup/core-gated-startup.test.mjs:225-229`).

## Runtime recheck

No new blocking runtime issue was introduced by extracting the pure state. The service preserves
main ownership and `electron-xpc` broadcast delivery; the store preserves validated revision
ordering and localized MenuBar presentation. Startup remains free of the superseded Core timeout,
old coordinator API, and GUI `app.exit(1)` failure path.

## Verification

Per instruction, no tests, build, typecheck, or Electron process was run. This conclusion is based
on focused static source/design review. Only this review document was added by the reviewer.
