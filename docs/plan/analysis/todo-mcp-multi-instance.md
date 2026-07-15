# Todo MCP Multi-instance Analysis

## Problem

Production and DEBUG GUI processes already derive different local bridge endpoints from different
`userData` roots. Two remaining ambiguities prevent reliable simultaneous use:

1. every generated MCP config uses the same `bitterless` host key, so a DEBUG config can overwrite
   production in an MCP host;
2. a development shim launches the shared source tree without pinning its endpoint, so a later
   `before.js` environment switch can make that old shim recalculate another `userData` target.

The production probe also exposed a readiness race: main waits for the hidden SQLite document to
finish loading, but its preload initializes SQLite asynchronously afterward. The bridge can accept
`domain.list` before DAO storage is ready and currently leaks a null `.filter()` error.

## Module decomposition

| Module | Input | Output | Required change |
|---|---|---|---|
| Shared MCP routing | app identity, userData, argv | endpoint, host key, config JSON | stable host keys and strict pinned-endpoint parsing |
| Core SQLite preload | asynchronous DB bootstrap | typed readiness result | explicit ready handshake after DB initialization |
| GUI bridge lifecycle | ready result and endpoint | owned socket + shim | wait for storage, protect live socket ownership, auto-create shim |
| MCP stdio helper | pinned endpoint or legacy fallback | MCP tools over stdio | route every tool call to the pinned GUI |
| Smoke CLI | production/debug profile | helper process | explicit profile selection and target reporting |
| Agent skill | configured MCP dependency | production Todo operations | state that `bitterless` is production and DEBUG is test-only |

## Integration paths

1. Core SQLite preload → readiness emitter → app main → bridge start.
2. GUI userData → bridge endpoint → generated shim argument → stdio helper → the same bridge.
3. App identity → distinct MCP host key → integration modal JSON → Codex MCP namespace.
4. CLI profile → standard helper path → pinned shim → selected GUI bridge.
5. `bitterless-todo` skill → `bitterless` host key → production bridge only.

## Socket ownership

An existing Unix socket is probed before removal. A responsive endpoint is live and must cause the
second server to fail without affecting the first. A refused/stale endpoint may be removed before
listen. Shutdown removes the path only when it still identifies the socket created by that server.

## Verification strategy

- Pure routing/config/shim tests for all instance names and quoted paths.
- Concurrent temporary production/debug bridges and stdio helpers with distinct markers, including
  a deliberately wrong helper `userData` fallback to prove the pinned route wins.
- Live-socket takeover rejection and stale-socket recovery.
- SQLite readiness failure/recovery without null coercion.
- Smoke CLI profile/default/conflict tests and all existing MCP tests.
- Live production + DEBUG read-only checks in parallel; full lifecycle writes only in DEBUG.
