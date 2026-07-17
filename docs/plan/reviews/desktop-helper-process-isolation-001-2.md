# Desktop Helper Process Isolation Review — Round 2

Status: accepted

Date: 2026-07-17

## Conclusion

**Pass.** No P0, P1, or P2 issue remains in the Round 2 review. The Round 1 shutdown race is
closed: optional startup is represented by one retained promise, cleanup fences it synchronously
and joins it before stopping resources, and every later MCP shim/EyesOnAgents stage is guarded
after the preceding asynchronous boundary. Already-entered work settles before cleanup stops every
resource it could have initialized.

The rest of the delivery contract remains intact. Home is created after SQLite/language readiness
and before optional integrations; helper modes never acquire the GUI singleton; both bundled
helpers remain Node-only; packaged helper paths remain under `app.asar/out/main`; and exact
EyesOnAgents artifact migration still preserves hook configuration bytes, mode, and trust while
definition drift fails closed.

## Round 1 finding resolved

1. **Resolved P1 — optional startup can no longer outlive cleanup.**
   `OptionalStartupLifecycle` retains the first startup promise and makes later starts idempotent
   (`src/main/mcp/optionalStartupLifecycle.service.ts:3`). `fenceAndJoin()` sets its fence before its
   first `await`, so a concurrent or subsequent start observes the fence synchronously
   (`src/main/mcp/optionalStartupLifecycle.service.ts:19`). A start attempted after cleanup is a
   no-op.

   `startGui()` retains the exact lifecycle-owned promise and attaches its rejection handler
   immediately (`src/main/app.main.ts:269`). Cleanup first fences and joins that promise, then stops
   EyesOnAgents, MCP, and the remaining application resources (`src/main/app.main.ts:182`). Startup
   checks the fence before MCP start, after MCP start, after shim generation, and after the dynamic
   EyesOnAgents import (`src/main/app.main.ts:276`). Consequently:

   - a fence during MCP start allows that entered start to settle, skips the shim and Eyes stages,
     then stops MCP;
   - a fence during shim generation joins the write, skips Eyes, then stops MCP;
   - a fence during the Eyes import skips runtime startup;
   - a fence during Eyes startup joins initialization, then invokes the stopper that was assigned
     before the startup await.

   There is no circular lifecycle wait: startup never awaits cleanup, while cleanup only joins the
   retained startup operation before performing stops. Startup rejection is handled at its launch
   site and again tolerated by cleanup, so resource teardown continues without an unhandled
   rejection. The deterministic regression holds MCP startup open, begins cleanup, proves cleanup
   is waiting, releases startup, and observes MCP stop with no shim/Eyes stage; it separately proves
   that a pre-fenced lifecycle never invokes startup
   (`scripts/mcp/multi-instance.test.mjs:261`).

## Contract evidence rechecked

- The production build emits dedicated `out/main/mcpHelper.js` and
  `out/main/codexHookHelper.js` entries plus their relative chunks. MCP bundle metadata/source
  assertions exclude `app.main`, Electron, and `BrowserWindow` dependencies.
- POSIX and Windows Todo shims retain endpoint pinning and argument quoting, set
  `ELECTRON_RUN_AS_NODE=1`, and target `<app root>/out/main/mcpHelper.js`; the packaged root is
  `app.asar`.
- Legacy `--mcp-helper` and `--coding-agent-hook-helper` paths remain windowless, bypass the
  single-instance lock, and prohibit macOS activation. GUI mode alone owns the lock and focuses the
  existing Home window on a second launch.
- Home creation precedes the lifecycle start, MCP bridge, shim generation, and EyesOnAgents import.
  Optional failure remains logged without rejecting GUI startup.
- Exact installed EyesOnAgents definitions gate helper/shim refresh before listener startup.
  Artifact migration does not write `~/.codex/hooks.json`; the bridge regression compares the raw
  bytes and file mode before/after migration and covers fail-closed definition drift.
- Unrelated dirty Coin, login, SQLite, renderer, and documentation edits remained untouched.

## Verification

| Check | Result |
|---|---|
| `yarn test:mcp:multi-instance` | pass outside the workspace sandbox: lifecycle overlap, pre-fenced no-op, Node-only helper, shims, app.asar path, legacy modes, singleton, and Home ordering |
| rejected-startup lifecycle probe | pass: cleanup join observes the expected rejection and Node reports no `unhandledRejection` |
| `yarn test:eyes-on-agents:core` | pass |
| `yarn test:eyes-on-agents:bridge` | pass: artifact migration plus durable hook-delivery suites |
| `yarn typecheck:node` | pass |
| `yarn typecheck:eyes-on-agents:core` | pass |
| `yarn build` | pass; emitted both dedicated helpers and their relative chunks |
| compiled MCP RunAsNode smoke | pass: Electron binary with `ELECTRON_RUN_AS_NODE=1` and closed stdin started the compiled helper and exited naturally with status 0 |
| `git diff --check` | pass |

No Electron GUI process was launched during review.
