# Context-window lookup logs a timeout after successful completion

Status: fixed; independent source review and behavioral tests passed. Paired Cowork report,
2026-09-17. Running app not restarted or E2E-tested.

`src/main/maestro/llm/maestroLlm.service.ts` has the same defect as Cowork: its
`withResolvedContextWindows` timer logs inside the losing `Promise.race` arm and is never cleared.
A fast successful lookup therefore still logs a timeout after three seconds. A rejected lookup
also leaves the timer active. The warning alone is not evidence of a slow Pi import/runtime.

This corrects the attribution in [the earlier fallback issue](llm-context-window-timeout-downgrades-presets.md).
See Cowork's `docs/issues/context-window-timeout-false-warning.md` for the report and full contract.

Repair: clear each call's timer in `finally`; preserve the three-second deadline, successful
resolved values, configured-window fallback and `refreshOnCreate: false`. No compression or
provider policy changes. Verify successful, rejected, pending, late and concurrent resolutions
against the real service method and rerun configured-window fallback tests. No Electron E2E.

Verification: `node --test tests/maestro/maestroContextWindowFallback.test.mjs` — 8/8,
independently rerun. Covers real-method success, failure, genuine timeout, late success/rejection,
concurrent timers and the existing configured-window fallback checks. Three timer regressions
failed before the source fix and passed after it. Paired Cowork suite passed 8/8. No Electron E2E.
Scoped TypeScript checking of the service and its dependency graph passed with zero diagnostics.
