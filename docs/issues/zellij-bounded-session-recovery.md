# Issue — Bound native session recovery and rebuild within the same open operation

**Status:** Implemented and unit-verified (2026-09-17); packaged human acceptance pending.
**Request:** Ral: if a Zellij session cannot be recovered, stop retrying indefinitely and rebuild a session as the fallback.

## Contract

- One open/Retry operation tries its existing session identity once, and retries that same identity at most once for an eligible transient native IPC failure.
- If native session preparation still fails, the same operation creates exactly one fresh identity and attempts it once. A failure of that fresh attempt is shown to the user; no timer or recursive rebuild loop continues.
- Runtime startup, config, authentication, web bridge and renderer failures do not prove a native session broken and do not trigger reconstruction.
- Fresh reconstruction uses the directory service's remembered cwd and a random name with reserved suffix space, so it cannot resurrect the broken session cache or truncate back to its old name. Unknown old sessions are never killed or deleted by this fallback.
- Concurrent opens of one surface share one operation. Close/shutdown generations invalidate all remaining retries and rebuilds, including work waiting in the transient retry delay.
- After fresh native preparation succeeds, atomically persist the surface-to-session name in the app profile's private zellij/surface-sessions.json before bridge attachment. Restart, navigation failure and bridge failure can then reuse the recovered shell. A persistence failure remains visible.
- Explicit successful close removes the mapping; app quit retains it.

## Verification

Passed **45/45** targeted tests with:

`node --test tests/zellij/zellijSessionRemint.test.mjs tests/zellij/zellijGlobalLifecycle.test.mjs tests/zellij/zellijDirectory.test.mjs tests/zellij/zellijRuntime.test.mjs`

Run from the project root. The 14 recovery cases cover attempt budgets, working fresh fallback, transient recovery preserving identity, terminal fresh failure, concurrent callers, close/shutdown/disposal races, long names, restart mapping, persistence failure, bridge failure after native success, successful/failed close, stale old-session failure callbacks and non-native errors. The directory suite verifies remembered cwd handling.

No Electron, live user session, real Claude or packaged-app E2E was started. Packaged acceptance: a recoverable tab keeps its shell; an unrecoverable native session opens one fresh shell in the remembered cwd in the same operation; if that fresh attempt also fails, the error stays visible until an explicit Retry. After a successful rebuild, app restart reconnects that fresh session.
