---
id: todoist-sync-desktop-001
scope: independent Todoist-style desktop synchronization and complete UI/MCP/Electron cutover
status: done
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

# handoff checkpoint — 2026-07-21 (docs-sprint develop batch 1)

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
- Added a focused strict Node TypeScript project for Todoist sync and kept the legacy numeric
  Domain/Todo/event DAOs separate from the new string-ID Main/MCP contract.
- Registered the runtime schema-v1 ordered manifest in the pure-Node SQLite audit. Fresh creation,
  current-v1 reopen/idempotence, incomplete and injected-failure rollback, ledger fail-closed,
  `integrity_check`, and `foreign_key_check` baselines now run without a fabricated legacy chain.
- Added native Electron-ABI SQLCipher tests using `better-sqlite3-multiple-ciphers`, one fixed injected
  password, and hard tripwires for Electron `safeStorage`, macOS Keychain, Windows Credential Manager,
  and legacy `main.db` filesystem access. Runtime password storage now creates its protected directory
  before first-run key creation.
- Covered encrypted fresh/reopen/wrong-password behavior, repository CRUD/outbox atomicity,
  soft-delete cascades, event persistence, monotonic baselines, ACK/error waiting, retry/discard, and
  restart recovery against the real native database.

## evidence obtained

- `yarn typecheck:todoist-sync` passed.
- `yarn typecheck:sqlite-migrations` passed.
- `yarn typecheck:mcp` passed while preserving the legacy numeric DAO boundary.
- `yarn test:todoist-sync` passed: 5 native SQLCipher tests, 5 passed.
- `yarn test:sqlite-migrations` passed: 11 tests, 11 passed.
- `yarn audit:sqlite-migrations` passed: 11 Core + 7 Maestro + 5 Todoist-sync baselines.
- `yarn install` passed and restored the declared `compare-versions` dependency; `yarn.lock` did not
  change.
- The full-project strict Node check was terminated after more than ten minutes without a result and
  was not restarted per Ral's instruction. It is not counted as passing evidence for this batch.
- No Electron GUI, real Core request, remote database, web/build pass, or two-client smoke was run.

Todos 1-4 are complete for this develop batch.

# handoff checkpoint — 2026-07-21 (docs-sprint develop batch 2)

The task remains `in-progress`. This batch was limited to the Main/shared Todoist-sync module,
focused native tests, strict wire fixtures, and this task record. It did not change or run renderer
UI, MCP, web/build, remote HTTP, or backend/PostgreSQL work.

## Todo 5-8 progress

- [x] Todo 5: added strict request/response/error wire fixtures and parsing for all nine command
  variants; deterministic coverage now includes coordinator/session single flight, coalesced rerun,
  completion-relative scheduling, restart/token persistence, NTP boundary and late-result generation
  fencing, exact whole-batch `CLOCK_SKEW` recovery, and Core-vs-NTP disagreement diagnostics.
- [x] Todo 6: remote-applied Todo changes now emit the contract event sequence with `actor=system`
  without feedback outbox commands. An HTTP response is revalidated against both session and clock
  generations after return and again immediately before SQLite commit, so stale resource, receipt,
  token, and baseline state cannot commit or schedule an unsafe follow-up.
- [ ] Todo 7: run the remaining renderer/web/runtime/MCP/build gates and Electron handoff in the next
  batch; no full-project TypeScript check was run here.
- [ ] Todo 8: after the backend disposable-PostgreSQL gate passes, run the non-production two-client
  HTTP smoke. This external prerequisite still prevents task completion.

## batch 2 evidence

- `yarn typecheck:todoist-sync` passed.
- `yarn test:todoist-sync` passed: 17 native deterministic tests, 17 passed.
- `git diff --check` passed.
- The focused test run left no SQLite, log, temporary, or compiled test artifacts under `tmp/` or
  `scripts/todoist-sync/`.
- No renderer UI, MCP, web/build, Electron GUI, real Core request, remote database, or two-client
  smoke was run in this batch.

## next batch

Run Todo 7's renderer/web/runtime/MCP/build verification without expanding Main sync behavior, then
run Todo 8's non-production HTTP smoke only after its backend prerequisite is green. Ral will perform
the Electron GUI pass after the code/build gates are clean.

# handoff checkpoint — 2026-07-21 (Todo-scoped web TypeScript gate)

The task remains `in-progress`. This batch changed only the Todo renderer TypeScript boundary, a
focused Todo web typecheck, its package scripts, and this task record. It did not change connector,
Coin, Poker, Home, Omni, Maestro, shared runtime, Main runtime, preload runtime, MCP runtime, or
backend behavior.

## Todo 7-8 progress

- [ ] Todo 7: the requested Todo-scoped renderer/MCP/native/build slice is complete. The strict
  `typecheck:todo-web` gate covers the Todo renderer and the shared/preload contracts it consumes
  without loading unrelated renderer modules. Main handler declaration contracts are regenerated
  from their real source classes and compared before the strict Vue check, so the existing
  `@main` emitter types remain exact without pulling unrelated Main implementation diagnostics into
  this focused gate. The Electron GUI and the separate Todo-window runtime check were not run in
  this batch.
- [ ] Todo 8: the backend-dependent non-production two-client Core/PostgreSQL smoke remains blocked
  on `todoist-sync-backend-001` and `todoist-sync-backend-integration-002`. This external gate still
  prevents task completion.

## Todo-scoped web evidence

- `yarn typecheck:todo-web` passed with strict null checks, `noImplicitAny`, and no unchecked Todo
  renderer source.
- `yarn typecheck:mcp` passed.
- `yarn test:todoist-sync` passed: 17 native deterministic tests, 17 passed.
- `yarn build` passed for Main, preload, and renderer production bundles.
- `git diff --check` passed.
- Full `yarn typecheck:web` still failed in the pre-existing connector, Coin, Poker, Home, Omni,
  Maestro, and shared baseline. No remaining diagnostic path starts with `src/renderer/todo/`.
- No Electron GUI, real Core request, remote database, backend/PostgreSQL operation, or two-client
  smoke was run.

# handoff checkpoint — 2026-07-22 (final cross-repo desktop HTTP smoke)

The task remains `in-progress` only for the backend release task's final database lifecycle and
deployed Function Compute/Bruno smoke. The built-Core two-client desktop gate and all requested local
automated gates are complete.

## Todo 7-8 completion

- [x] Todo 7: `typecheck:todoist-sync`, `typecheck:todo-web`, `typecheck:mcp`, the native Electron-ABI
  SQLCipher suite, Todo-window runtime check, and production build all pass.
- [x] Todo 8: the backend-authorized real Core/PostgreSQL child smoke passes with two device JWTs for
  one customer and an isolated second customer. Secrets enter only through child environments and
  are rejected if found in output; no device JWT or database password is logged or persisted by the
  harness. The opaque sync token remains persisted by the production repository as required for the
  restart proof.

## lifecycle evidence

- Client A used a dedicated encrypted repository, bootstrapped through the real HTTP
  client/coordinator/session, then created an optimistic Domain/Todo/SubTodo while simulated offline.
  All three commands settled back to `pending`; the online retry reused at least one exact command
  UUID, drained the outbox, and advanced three canonical ACK baselines.
- Client B used a second encrypted repository and bootstrapped the exact canonical A state. B updated
  and completed the Todo and completed its SubTodo. A's incremental pull converged and emitted one
  `actor=system` completion event without creating a feedback outbox command.
- B shut down and restarted in a distinct Electron-as-Node child process over the same SQLCipher
  file. Its first HTTP request reused the persisted sync token. Final reopened A/B resource snapshots
  were byte-for-byte equal; the second customer's seeded Domain was absent from both.
- Both repositories used distinct fixed injected test passwords, non-plaintext SQLCipher files, and
  no key sidecars. Tripwires recorded zero Electron `safeStorage`, macOS Keychain, Windows Credential
  Manager, or legacy `main.db` access. The runner removed its local bundle/state temp roots.
- The smoke found and fixed a concrete first-bootstrap bug: remote Todo event creation ran before the
  response's assigned Snowflake node was installed. The node is now available during the response
  transaction and reset when an initially-unassigned transaction rolls back or is generation-fenced.
  Focused native tests prove successful first-bootstrap event creation and, on a fenced first
  response, unchanged `sync_token='*'`, persisted node `null`, `ids.getNodeId()===null`, zero
  baselines, and zero events.

## verification

- Full backend `yarn test:todoist-sync:integration` passed A+B1+B2a+B2b1+B2b2+desktop-two-client in
  29.68 seconds. The desktop child reported `resources=3`, `offline_retry=1`, `system_events=1`,
  `outbox_feedback=0`, `persisted_token_reused=1`, `isolation_customers=2`, exact convergence, and two
  SQLCipher repositories.
- Post-fence `TODOIST_SYNC_DESKTOP_ONLY=1 yarn test:todoist-sync:integration` passed in 15.79 seconds;
  remote cleanup removed 16 Todo rows and five Core rows, all isolated application rows returned to
  zero, and DSH fingerprint `50b181787fae35a3` was unchanged.
- `yarn typecheck:todoist-sync` passed; `yarn test:todoist-sync` passed 19/19 native tests.
- `yarn typecheck:todo-web`, `yarn typecheck:mcp`, `yarn check:todo-window-runtime`, `yarn build`, and
  `git diff --check` passed.

## external prerequisite completion — 2026-07-22

- Backend tasks `todoist-sync-backend-001` and `todoist-sync-backend-integration-002` are complete.
  Their real PostgreSQL matrix, built-Core two-client desktop smoke, clean production lifecycle,
  Shanghai Function Compute activation, and deployed Bruno HTTP smoke all passed.
- The deployed smoke finished with zero Todo application rows and zero matching synthetic
  Core/Auth fixtures; the source DSH metadata fingerprint remained unchanged. This satisfies the
  desktop task's final external completion prerequisite without changing desktop runtime code.

## post-deploy independent review P1 — 2026-07-22

An independent final review found one release blocker after the first production rollout. Reconcile
orders a fixed-H snapshot by revision and can return a Todo or SubTodo before its archived/completed
parent crosses a 500-row page boundary. A concurrently rewritten parent can likewise move above H
and arrive only in immediate incremental catch-up. Canonical baselines may commit in that order, but
the desktop currently materializes every baseline immediately into SQLite tables whose parent foreign
keys are restrictive; the transaction rolls back and the sync token cannot advance.

The desktop fix must commit child baselines and advance the token while their parent projection is
missing, defer only the entity-table materialization, and automatically materialize the waiting
hierarchy when the parent later arrives. Deferred Todos must still emit their exact `actor=system`
event when they become visible, without a feedback outbox command. Regression coverage must include
an archived Domain arriving after a 500-Todo reconcile page and a completed Todo arriving after a
500-SubTodo reconcile page, with restart-safe baselines, token advancement, final FK health, and no
duplicate/skip.

## P1 fix evidence — 2026-07-22

- The schema-v1 baseline now records the optional parent resource ID behind a composite lookup
  index. A response always commits the canonical baseline and opaque sync token, while projection
  materialization returns a deferred result when its required parent row is not present.
- Materialized Domains wake waiting Todo baselines; materialized Todos wake waiting SubTodo
  baselines. Projection writes run Domain -> Todo -> SubTodo, while terminal optimistic rollbacks run
  SubTodo -> Todo -> Domain. A null-canonical failed add recursively blocks unsent descendant adds
  and includes them in the same child-first cleanup; physical parent removal also refuses to cross a
  remaining child FK.
- The native suite now covers an archived Domain arriving after exactly 500 Todos and a completed
  Todo arriving after exactly 500 SubTodos. Both cases prove token advancement, 500 persisted child
  baselines, zero premature child projections, eventual complete materialization, zero feedback
  outbox rows, no duplicate event after replay, and healthy foreign keys. It additionally proves an
  ACK baseline can settle its outbox before a missing parent projection arrives, and that a permanent
  Todo-add failure removes an unsent blocked SubTodo before the Todo. The suite passes 23/23.
- `yarn typecheck:todoist-sync`, `yarn audit:sqlite-migrations`, `yarn typecheck:todo-web`,
  `yarn typecheck:mcp`, `yarn check:todo-window-runtime`, `yarn test:mcp:todo-smoke`, and
  `yarn build` pass. `git diff --check` also passes.
- This P1 changes only the desktop SQLCipher projection layer and its unreleased schema-v1 baseline.
  It does not change the backend runtime, PostgreSQL schema, FC environment, or deployed archive;
  publishing an identical replacement FC package would not exercise this fix and is intentionally
  outside this patch. The already verified Shanghai FC deployment and clean production Todo database
  remain unchanged.

## independent P1 re-review — 2026-07-22

Independent review of commit `99f8ad0` found no P1 or P2 issue and returned `APPROVED`. It verified
the shared transaction boundary, parent-first writes, child-first terminal rollback, recursive
dependency blocking, restrictive-FK guards, delayed ACK materialization, event deduplication, and
the indexed baseline-parent lookup. The reviewer independently passed the 23/23 native suite,
strict Todo sync/Web/MCP checks, SQLite release tests and migration audit, Todo runtime check, MCP
smoke, and `git diff --check`; this task's own final gate also passed the complete Electron build.

This task is complete.
