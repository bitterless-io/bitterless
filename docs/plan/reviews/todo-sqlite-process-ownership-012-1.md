# Todo SQLite Process Ownership Review — Round 1

Status: implemented; owner verification pending

Date: 2026-07-23

## Findings and resolutions

- **Generic result semantics:** an early implementation tried to assign one acknowledgement shape
  to all writes. This was removed. Each method now keeps its own contract: required reads validate
  data, optional entity results stop dependent work when absent, void writes do not require an ACK,
  and boolean/entity writes retain their specific validation.
- **Transport `undefined` normalization:** the installed `electron-xpc@1.1.x` implementation uses
  `ret ?? null`, so a handler's `undefined` result arrives as `null`. Required collections and maps
  still reject absence. Optional MCP entity methods normalize transport `null` back to their public
  `undefined` absence contract; the Step-delete post-read regression exercises this exact path.
- **Nullable dependent work:** cross-Domain Todo movement no longer rewrites sort order after an
  absent moved entity, and Step creation no longer requests a refresh after an absent created row.
- **Transient session creation:** a failed lazy preload session promise is cleared, allowing a later
  activation to retry instead of retaining a permanently rejected singleton.
- **Hidden renderer recovery:** Main reloads the hidden Core SQLite renderer after an unexpected
  process exit. A new preload `targetId` invalidates the old Home activation generation and restores
  Todo polling for the current eligible account without restarting unrelated auth runtimes.
- **Lost in-flight replies:** renderer, Home, MCP, auth, and lifecycle Todo XPC clients now have a
  bounded wait. The wrapper preserves every settled value, including `null`; it only rejects a call
  whose target never replies. Best-effort shutdown uses a shorter bound. Final review found that an
  outer timeout alone could leave the cached preload session promise pending when Core boot, path,
  or password capabilities never replied. Core registration/ready and the preload's path,
  safeStorage, legacy Core-password, and system-settings clients are now bounded internally too.
  Legacy Core password timeout is rethrown and cannot trigger ciphertext removal or database reset.
- **Static preload imports:** the Todo modules are statically evaluated in the hidden preload to
  follow Bitterless's no-dynamic-import rule. The document guard controls handler registration,
  session construction, and database opening, so an initial non-target document does not own Todo
  state.

## Process-boundary assessment

- Core SQLite preload owns SQLCipher open/migrate/query/close, protected-key files, Snowflake state,
  repository transactions, outbox/reconciliation, HTTP synchronization, timer, status, clock, and
  Todo data broadcasts.
- Main owns only opaque XPC routing, the MCP socket, narrow safeStorage and Date & Time capabilities,
  and hidden-window lifecycle recovery. It imports no Todo database, migration, repository, HTTP
  coordinator, clock store, or preload-owned session runtime.
- Todo/Home renderers and Main MCP/lifecycle code are typed XPC clients. Commit broadcasts retain
  the initiating renderer origin, while MCP and remote synchronization use a null origin.

## Verification

- `yarn typecheck:todoist-sync`
- `yarn typecheck:todo-web`
- `yarn typecheck:mcp`
- `yarn typecheck:node`
- `yarn test:todoist-sync` — 56/56
- `yarn test:customer-auth` — 14/14
- `yarn test:startup`
- `yarn check:todo-sqlite-process-boundary` — 6/6
- `yarn test:mcp:domain-catalog`
- `yarn test:mcp:domain-create`
- `yarn test:mcp:todo-step-crud`
- `yarn test:mcp:multi-instance`
- `git diff --check`

## Owner verification

Ral will verify the Electron runtime: login, Todo CRUD and Step CRUD, MCP access, sync/Refresh,
hidden Core renderer crash/reload recovery, logout, and application restart. No Electron package or
runtime test is part of this automated review.

## Conclusion

All identified source-level findings are implemented. Electron behavior remains intentionally
handed to Ral for runtime acceptance.
