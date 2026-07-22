# Todoist Sync Desktop Review 5

Commit reviewed: `a20daa097654541d3d6d874e866cc21b6cfa9a38`

## PASS

The requested focused hardening slice passes independent verification.

- Schema-v1 audit uses the runtime `todoistSyncMigrations` manifest and validates fresh creation, current-v1 reopen/idempotence, incomplete-schema rollback, invalid-ledger fail-closed behavior, injected future-migration rollback, integrity, and foreign-key checks.
- Native tests use the Electron ABI with `better-sqlite3-multiple-ciphers`, fixed injected passwords, real encrypted reopen/wrong-password behavior, CRUD/outbox atomicity, soft-delete cascades, events, monotonic baselines, ACK/error resource waiting, retry/discard, and restart recovery.
- The native test bundle tripwires Electron `safeStorage`, OS credential commands, and legacy `main.db` filesystem access. The production first-start path creates the protected directory, obtains the runtime password through `safeStorage`, and opens an isolated per-customer database.
- Outbox `in_flight` rows recover to `pending` on repository initialization while preserving command UUIDs and projections.
- `typecheck:todoist-sync` is strict and scoped to the Todoist-sync module/shared types/tests; `typecheck:mcp` remains strict while the legacy numeric DAOs are no longer coupled to the string-ID MCP API types.

## BLOCKED

The Todo sync feature is not complete and cannot be marked PASS for the task. The task document explicitly remains `in-progress`; Todo 5-8 and the external backend prerequisite are outstanding.

## Findings

No new blocking finding was identified in the requested schema-v1, native SQLCipher/password boundary, first-start, outbox restart, strict type-scope, or legacy DAO type-only change review.

## Results

- `yarn typecheck:todoist-sync` — PASS
- `yarn typecheck:sqlite-migrations` — PASS
- `yarn typecheck:mcp` — PASS
- `yarn test:todoist-sync` — PASS, 5/5 native tests
- `yarn test:sqlite-migrations` — PASS, 11/11 tests
- `yarn audit:sqlite-migrations` — PASS, 11 Core + 7 Maestro + 5 Todoist-sync baselines
- `git diff --check` — PASS

Full project tsc, UI/web checks, build, Electron GUI, remote HTTP, and two-client Core/PostgreSQL smoke were intentionally not run.

## Remaining Scope

- Add strict shared wire fixtures, scheduler/session fencing, NTP boundary/late-result coverage, exact `CLOCK_SKEW` batch recovery, and Core-clock disagreement diagnostics.
- Complete remote `actor=system` events and verify clock confirmation fences already-running HTTP work.
- Run the remaining web/runtime/build gates and the backend-dependent non-production two-client HTTP smoke.
- The `bitterless-private` backend tasks `todoist-sync-backend-001` and `todoist-sync-backend-integration-002` must pass before this task may leave `in-progress`.
