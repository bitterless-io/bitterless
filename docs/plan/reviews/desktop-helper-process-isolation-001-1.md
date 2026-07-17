# Desktop Helper Process Isolation Review — Round 1

Status: changes requested

Date: 2026-07-17

## Conclusion

**Blocked by one P1 startup/shutdown race.** The dedicated MCP and Codex hook helper entries build
as Node-only artifacts, their POSIX/Windows shims set `ELECTRON_RUN_AS_NODE=1`, the packaged helper
paths resolve below `app.asar/out/main`, legacy app-main flags avoid the GUI singleton path, and
Home is created before optional MCP/EyesOnAgents initialization. Exact installed EyesOnAgents
definitions also gate artifact-only refresh without rewriting `~/.codex/hooks.json`.

The Home-first change is not yet lifecycle-safe, however: optional integration startup is detached
from application cleanup. A quit during that startup can let MCP or EyesOnAgents resources start
after cleanup has already passed them, so this task is not deliverable until startup and shutdown
are serialized and the overlap has a regression test.

## Findings

1. **P1 — blocking — detached optional startup can outlive shutdown cleanup.** The task requires
   Home-before-optional-integrations ordering without introducing shutdown races. `startGui()`
   correctly creates Home first, but then starts `startOptionalIntegrations()` with `void` and does
   not retain or cancel its promise (`src/main/app.main.ts:248`, `src/main/app.main.ts:261`).
   `cleanupResources()` independently stops the current MCP server and calls
   `stopEyesOnAgentsRuntime` only when that callback has already been assigned
   (`src/main/app.main.ts:177`, `src/main/app.main.ts:182`, `src/main/app.main.ts:185`). A quit can
   therefore interleave as follows:

   ```text
   startOptionalIntegrations: await mcpBridgeServer.start() / dynamic EyesOnAgents import
   before-quit:               cleanupResources() stops what currently exists and completes
   startOptionalIntegrations: resumes, assigns stopEyesOnAgentsRuntime, and starts the listener
   ```

   The analogous MCP overlap can call `stop()` before an in-flight `start()` finishes. This permits
   post-cleanup sockets/listeners and can prevent a clean quit or leave the application lifecycle in
   a state cleanup no longer owns. Retain and coordinate the optional-startup operation with
   cleanup (including a quit fence so no later stage starts once shutdown begins), then add a
   controlled deferred-start regression proving shutdown joins or rolls back every partially
   started integration. The current MCP source-order assertions prove Home ordering but do not
   exercise this overlap.

## Contract evidence reviewed

- `electron.vite.config.ts` emits separate `mcpHelper.js` and `codexHookHelper.js` entries. The
  production build places their relative dependencies in `out/main/chunks/`; the MCP bundle has no
  Electron application/window import.
- Todo shims quote executable/helper/endpoint arguments, set `ELECTRON_RUN_AS_NODE=1` on POSIX and
  Windows, pin the bridge endpoint, and target `<app root>/out/main/mcpHelper.js`, which becomes
  `<app.asar>/out/main/mcpHelper.js` in a packaged application.
- Legacy `--mcp-helper` and `--coding-agent-hook-helper` modes bypass
  `requestSingleInstanceLock()`. macOS marks both prohibited from activation before readiness; the
  retired Codex mode exits without creating a window, while legacy MCP drains stdio naturally.
- GUI-only execution acquires the single-instance lock after profile-specific E2E `userData`
  configuration and focuses the existing Home window on `second-instance`.
- Home creation follows SQLite and language readiness and precedes MCP bridge/shim work and the
  EyesOnAgents dynamic import.
- An installed EyesOnAgents bridge refreshes the exact helper closure and stable shim before
  listener startup only when all four owned definitions remain exact. Definition drift fails
  closed. Artifact refresh does not write `hooks.json`, preserving its bytes, file mode, and Codex
  trust-bearing definition hashes.
- Unrelated dirty Coin, login, SQLite, renderer, and documentation edits remained untouched.

## Verification

| Check | Result |
|---|---|
| `yarn test:mcp:multi-instance` | pass after rerun outside the workspace sandbox; initial run could not bind its local Unix-socket fixture (`EPERM`) |
| `yarn test:eyes-on-agents:core` | pass |
| `yarn test:eyes-on-agents:bridge` | pass: bridge plus durable hook-delivery suites |
| `yarn typecheck:node` | pass |
| `yarn typecheck:eyes-on-agents:core` | pass |
| `yarn build` | pass; emitted `out/main/mcpHelper.js`, `out/main/codexHookHelper.js`, and their relative chunks |
| compiled helper source inspection | pass: emitted MCP/Codex helper closure contains no `app.main`, `BrowserWindow`, or Electron import |
| `git diff --check` | pass |

No Electron GUI process was launched during review.
