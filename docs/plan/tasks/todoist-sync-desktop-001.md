---
id: todoist-sync-desktop-001
scope: independent Todoist-style desktop synchronization and complete UI/MCP/Electron cutover
status: in-progress
depends-on: []
---

# objective

Replace every PowerSync-specific desktop artifact with one independently buildable
`todoistSync` module and cut all authenticated Todo UI/MCP call sites over in the same task. Build
the new encrypted per-customer schema-v1 database, monotonic remote baseline, optimistic projection,
atomic outbox, strict HTTP client, working-set/reconciliation coordinator, renderer-triggered clock
gate, scheduler, session lifecycle, status UI, migration audit, and packaged native runtime. Ignore
legacy `main.db`: do not open, import, migrate, or delete it.

# context

- `docs/features/todoist-sync.md`
- `../../../../bitterless-private/docs/features/todoist-sync.md`
- `docs/features/todo-mcp.md`
- `docs/features/sqlite-migration-release-gate.md`
- `docs/plan/analysis/todoist-sync.md`

# path

- `package.json`
- `yarn.lock`
- `electron.vite.config.ts`
- `src/main/app.main.ts`
- `src/main/todoistSync/`
- `src/shared/todoistSync/`
- `src/main/todoSync/` (remove superseded PowerSync module)
- `src/main/xpc/`
- `src/main/xpc/todoPowerSync.handler.ts` (remove)
- `src/main/mcp/`
- `src/shared/mcp/`
- `src/renderer/home/src/stores/auth/`
- `src/renderer/todo/src/`
- `src/renderer/common/i18n/`
- `scripts/sqlite-migrations/`
- `scripts/todoist-sync/`
- `scripts/todo-powersync/` (remove)
- `scripts/mcp/`
- `skills/bitterless-todo/`
- `docs/features/todo-mcp.md`
- `docs/features/todoist-sync.md`
- `docs/plan/analysis/todoist-sync.md`
- `docs/plan/tasks/todoist-sync-desktop-001.md`

# implementation contract

- Use one ordered schema-v1 migration manifest from `src/main/todoistSync/` in both runtime and the
  SQLite release audit. Todo sync is unreleased: test fresh creation, current-v1 reopen/idempotence,
  incomplete/failed migration rollback, `integrity_check`, and `foreign_key_check`; do not invent a
  historical Todo chain or import fixture.
- Real Electron runtime generates a random per-customer password protected with `safeStorage`.
  Every automated/local database, repository, migration, and native cipher test injects a fixed
  test password. Install a tripwire mock that fails the test if Keychain, Credential Manager, or
  `safeStorage` is accessed.
- Store canonical remote baselines separately from visible optimistic projections. Greater remote
  revision replaces the baseline; equal revision only proves presence/clears reconciliation or ACK
  markers; lower revision has no effect. Never infer tombstones from absence and never orphan-clean.
- Implement exact durable states `pending`, `in_flight`, `acknowledged_waiting_resource`,
  `error_waiting_resource`, `clock_rejected`, `permanent_failed`,
  `blocked_by_failed_dependency`, `superseded`, and `discarded`. An OK ACK keeps its overlay until
  canonical resource proof at/after `ack_revision`. A permanent error with non-null canonical
  reference/revision does the same in `error_waiting_resource`; only null projection fields roll
  back immediately.
- After required canonical proof (or immediately for a null projection), permanent add/update/delete
  failures respectively hide the rejected new row, restore rejected fields, or restore the
  canonical live row, then replay later eligible overlays. Explicit retry revalidates and creates a
  new UUID/client timestamp/device sequence/base revision; discard changes no projection.
  Missing-parent dependents stay blocked and visible in sync diagnostics.
- Persist the device-global successful clock state atomically under `userData/todoist-sync/`, owned
  by Main. Todo renderer mount/focus/15-minute cadence invokes electron-xpc; Main queries both SNTP
  sources concurrently. Session, renderer request, and check generations fence stale results.
- On Core `CLOCK_SKEW`, quarantine the exact submitted UUID set as no-receipt `clock_rejected`,
  broadcast a typed generation-fenced request to Todo renderer, and continue pull-only sync. An
  unreachable check changes no marker and causes no global pause/banner. Only a successful wrong
  sample pauses. After a successful healthy sample, one SQLite transaction assigns new
  UUID/timestamp/sequence only to future-dated members of that exact rejected set, returns other
  members unchanged to pending, rebuilds projections, and immediately retries.
- UI and MCP use the same repository, emit one coalesced `todo/data_updated` refresh after local or
  remote commit, and both trigger immediate sync. Use Arco controls, business BEM/Less, and all
  language keys for the confirmed-clock banner and failed-sync actions.
- Remove `@powersync/node`, worker entry/assets, every `PowerSync` symbol, and old tests only after
  all auth/XPC/MCP/renderer imports are cut over in this same task. There is no intentionally broken
  intermediate task boundary.

# verification

- fixed-password encrypted fresh/create/reopen/wrong-password tests with explicit proof that tests
  never call `safeStorage` or OS credential APIs; assert the Todo module never opens/imports/deletes
  legacy `main.db`
- real schema-v1 runtime/audit manifest, rollback fixtures, `integrity_check`,
  `foreign_key_check`, and `yarn audit:sqlite-migrations`
- CRUD/outbox atomicity, soft-delete/cascade, reorder/repeat, event, and restart tests
- working-set-first bootstrap, reconcile, token paging/reset, pending replay, and proof that absence
  never runs orphan cleanup
- monotonic remote baseline cases: greater replaces, equal preserves fields while clearing allowed
  markers/proving ACK, lower cannot replace/clear/prove, and equal-revision payload mismatch fails
- exact outbox transition and crash tests, including ACK without resource, ACK with equal/newer
  canonical presence, newer overlay replay, lost response same-UUID retry, and `applied=false`
- permanent failed add/update/delete projection, canonical-reference page delay through
  `error_waiting_resource`, null-projection immediate rollback, missing-parent dependency, explicit
  new-UUID retry, discard, and restart persistence tests
- byte-for-field request/HTTP-200/permanent-status/400/409/503 fixtures shared with the backend
  contract, including common command version fields, `server_time_ms`, and canonical references
- client-time LWW, deterministic same-millisecond ties, late offline upload, tombstone finality, and
  ACK-waits-for-resource anti-overwrite tests
- renderer-triggered parallel SNTP tests for healthy, wrong, unreachable-without-prior-marker,
  unreachable-with-prior-wrong-marker, exact 180-second boundary, stale session/request/check result,
  typed Core-request broadcast, and macOS/Windows Date & Time actions
- far-future command batch test: Core applies/receipts none; persist the exact rejected UUID set;
  unreachable NTP leaves it quarantined while pull continues; later healthy check atomically gives
  only future members new UUID/timestamp/sequence and drains the outbox; an unexplained Core-clock
  disagreement remains quarantined
- configured 10/180-second bounds, completion-relative schedule, single flight/rerun, backoff,
  logout/account-switch generation fencing, and two separate customer databases
- UI and MCP real-boundary tests proving one repository, immediate sync, remote events/status, and
  one coalesced local/remote refresh
- non-production two-client Core/PostgreSQL HTTP contract smoke
- native cipher runtime smoke for macOS and Windows package configuration using the injected fixed
  test password, plus removal assertions for PowerSync dependency/worker/assets/symbols
- `yarn typecheck:node`
- `yarn typecheck:mcp`
- `yarn typecheck:web`
- `yarn check:todo-window-runtime`
- `yarn test:mcp:todo-smoke`
- `yarn build`
- `git diff --check`

# external completion prerequisite

Local module/UI/MCP implementation may proceed against strict fixtures. This task cannot be marked
done until the `bitterless-private` tasks `todoist-sync-backend-001` and
`todoist-sync-backend-integration-002` have passed and the non-production two-client HTTP smoke uses
their real Core/PostgreSQL endpoint.

# handoff checkpoint — 2026-07-21

The implementation is intentionally left `in-progress`. Electron was not launched, no Core API was
called, no production/test remote database was contacted, and the old `main.db` was not opened,
imported, migrated, or deleted.

## implemented

- Added strict shared Todoist-sync wire types and response/error parsing under
  `src/shared/todoistSync/`.
- Added the independent `src/main/todoistSync/` module: fresh schema-v1 migration manifest,
  per-customer `better-sqlite3-multiple-ciphers` database, isolated path, runtime random password
  protected by Electron `safeStorage`, Snowflake IDs, canonical baseline plus optimistic projection,
  atomic outbox, HTTP client, coordinator/session, parallel SNTP checks, and persistent clock state.
- Preserved the existing 32 Domain/Todo/SubTodo/event boundaries while routing renderer XPC and MCP
  through the same new repository. Auth activation/invalidation and app shutdown now own the new
  session lifecycle.
- Added Todo renderer mount/focus/15-minute clock requests, confirmed-clock warning UI, sync status,
  and failed-command retry/discard actions using Arco, BEM/Less, and shared i18n.
- Removed the PowerSync source path, worker, XPC handler, dependency, and its lockfile entries. A
  source scan found no remaining PowerSync symbol at the checkpoint.
- Actual runtime still uses `safeStorage`; the intended automated/local test boundary is an injected
  fixed password with a tripwire that fails on any OS credential or `safeStorage` access.

## evidence obtained

- `yarn typecheck:node` passed, but that project script contains `--noCheck` and therefore only
  proves build-level parsing.
- A strict `./node_modules/.bin/tsc --noEmit -p tsconfig.node.json --composite false` run was started
  and interrupted before it produced a result.
- No Electron GUI, real SQLite/SQLCipher operation, Core request, MCP smoke, web/MCP typecheck,
  SQLite release audit, or production build was run.

## remaining Todo

1. Run strict node TypeScript checking first and fix every error before adding more behavior.
2. Register the Todo schema-v1 manifest in `scripts/sqlite-migrations/auditRunner.ts` without adding
   a fabricated legacy chain.
3. Add `scripts/todoist-sync/` tests using one fixed injected password plus a hard tripwire against
   Keychain, Credential Manager, and `safeStorage`. Cover fresh/reopen/wrong-password/rollback,
   integrity and foreign-key checks, and prove legacy `main.db` is never touched.
4. Execute real repository/SQLCipher tests for SQL placeholders, CRUD/outbox atomicity, soft-delete
   cascades, baseline monotonicity, ACK/error waiting states, restart recovery, and event behavior.
5. Add strict wire fixtures shared with the backend, scheduler/session fencing, NTP healthy/wrong/
   unreachable/boundary/late-result tests, exact `CLOCK_SKEW` batch recovery, and Core-clock
   disagreement diagnostics.
6. Complete remote `actor=system` Todo events and verify a newly confirmed wrong clock stops or
   safely fences any already-running HTTP request.
7. Run all web/MCP/runtime/audit/build commands below. Validate the manually edited Yarn lockfile by
   a successful Yarn install when dependency access is available.
8. After the backend disposable-PostgreSQL gate passes, run the non-production two-client HTTP
   smoke; only then can this task leave `in-progress`.

## resume here

```bash
cd /Users/ral/Documents/projects/overmind/projects/bitterless
./node_modules/.bin/tsc --noEmit -p tsconfig.node.json --composite false
yarn typecheck:web
yarn typecheck:mcp
yarn audit:sqlite-migrations
yarn check:todo-window-runtime
yarn test:mcp:todo-smoke
yarn build
git diff --check
```

Do not start with Electron manual testing: first obtain strict typecheck and fixed-password SQLite
evidence. Ral will perform the Electron GUI pass after the code/build gates are clean.
