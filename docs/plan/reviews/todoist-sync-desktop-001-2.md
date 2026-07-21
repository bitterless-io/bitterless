# Todoist-style Desktop Synchronization Review — Round 2

Status: blocked

Date: 2026-07-21

Task: [todoist-sync-desktop-001](../tasks/todoist-sync-desktop-001.md)

## Findings

1. **P1 · blocking — the desktop's exact wire examples still reject or omit fields required by
   Core.** The desktop request example at `docs/features/todoist-sync.md:91-106` omits
   `client_updated_at`, `client_sequence`, and `base_revision`, although its own mutation contract at
   `:198-203` and the backend's strict command contract at
   `../bitterless-private/docs/features/todoist-sync.md:144-180` require all three on every add,
   update, and delete. The desktop HTTP 200 example and status definition at `:117-141` omit both
   required `server_time_ms` and each successful status's `canonical_resource`; Core requires those
   fields in every success response at the backend contract's `:220-249` and `:425-441`. The root
   overview also repeats an incomplete success status without `canonical_resource`
   (`areas/agent-runtime/todo/todo-sync.html:327-342`), although its request-level 409 envelope now
   matches Core. A strict desktop DTO, Bruno fixture, and backend can therefore implement mutually
   incompatible shapes. Make the desktop examples/status union byte-for-field consistent with the
   backend, add the backend contract
   to the desktop task context, and verify exact request, HTTP 200, permanent-status, 400, 409, and
   503 fixtures.

2. **P1 · blocking — permanent-error resource waiting still has incompatible projection
   semantics.** Desktop changes every permanent error immediately to non-projecting
   `permanent_failed` and reconstructs from its already stored baseline
   (`docs/features/todoist-sync.md:216-254`; task contract `:63-69`). Core instead says an error with
   non-null `canonical_resource`/`sync_revision` remains a non-sendable, pull-only overlay until that
   exact resource revision arrives, and only an error with null projection fields rolls back
   immediately (`../bitterless-private/docs/features/todoist-sync.md:443-470`). The root overview
   describes a third shape, a typed error carrying a canonical "snapshot/null"
   (`areas/agent-runtime/todo/todo-sync.html:382`), while Core returns only a resource reference and
   revision. These differ whenever the command's freshly stamped canonical row is not in the same
   response page. Choose one contract: either add an error-waiting-resource state that keeps the
   overlay until resource proof, or return/apply a complete canonical snapshot atomically. Then make
   failed add/update/delete, restart, page delay, retry, and discard tests assert that one result.

3. **P2 · blocking — the root clock overview contradicts the corrected no-receipt quarantine
   flow.** Desktop and backend now agree that a `CLOCK_SKEW` batch becomes exact durable
   `clock_rejected`, is excluded from upload while pull-only synchronization continues, and may be
   re-UUIDed/re-versioned only after a successful healthy renderer-triggered check
   (`docs/features/todoist-sync.md:304-331`;
   `../bitterless-private/docs/features/todoist-sync.md:343-363`). The root overview instead says an
   unreachable NTP result leaves the original commands on ordinary backoff retry
   (`areas/agent-runtime/todo/todo-sync.html:401`), which would repeatedly resend the still-future
   timestamps and receive 409. It also names the typed event `todo/sync_clock_check_requested`, while
   the desktop contract names `todoist-sync/clock-check-requested`. The same overview first says the
   client accepts only higher remote revisions (`:258`) although its later merge table and the
   project contracts correctly allow equal revision to prove presence without replacing fields.
   Align the overview with the generation-fenced quarantine/pull-only flow, one event name, and the
   greater/equal/lower baseline rules.

4. **P2 · blocking — migration-audit delivery has two simultaneous owners and no executable
   dependency order.** The project declares serial execution (`docs/plan/README.md:3-5`), yet
   `todoist-sync-desktop-001` is `ready` with no dependency (`:20`) while
   `sqlite-migration-release-gate-001` is already `in-progress` with no dependency (`:61`). Both
   tasks own `src/main/todoistSync/`, `scripts/sqlite-migrations/`, `scripts/todoist-sync/`, the same
   production manifest, cipher smoke, and audit evidence
   (`docs/plan/tasks/todoist-sync-desktop-001.md:24-55`, `:86-117`;
   `docs/plan/tasks/sqlite-migration-release-gate-001.md:22-60`). The SQLite analysis says its one
   task owns all three manifests (`docs/plan/analysis/sqlite-migration-release-gate.md:59-63`), while
   the Todo analysis says the Todo task owns release-audit integration
   (`docs/plan/analysis/todoist-sync.md:109-115`). The existing SQLite task cannot finish its newly
   added third-family checks before the Todo module exists, while the Todo task cannot safely run
   beside the in-progress owner. Assign the shared-runner foundation and Todo-manifest extension to
   one ordered task chain. Also record the non-production HTTP smoke's external prerequisite on
   `bitterless-private` backend tasks, which are currently `ready`/`pending`, before desktop task 001
   can be marked done.

## Round-1 resolution assessment

- **New database and migration safety: contract resolved.** Todo uses only the new per-customer
  database; legacy `main.db` is never opened, imported, migrated, or deleted. The three-family
  release gate now uses the runtime Todo manifest for fresh/current-v1, rollback, integrity, foreign
  key, native cipher, and packaged-asset checks. Finding 4 is about task ownership, not the resulting
  storage contract.
- **Automated/local credentials: resolved.** Database, repository, migration, and native cipher
  tests inject a fixed test password and install a tripwire against `safeStorage`, Keychain, and
  Credential Manager. Only the real application password provider may use `safeStorage`.
- **Future-clock recovery: resolved in the two project contracts.** Core preflights the whole batch
  without receipts; desktop persists its exact UUID set, keeps normal pull available, and after a
  healthy sample atomically replaces only proven future members with new versions. Finding 3 is the
  stale root-overview contradiction.
- **Buildable cutover: resolved.** One desktop task now owns module creation plus all auth, XPC, UI,
  MCP, dependency, asset, typecheck, and Electron cutover paths, so deleting PowerSync no longer
  creates the earlier intentionally broken intermediate tree.
- **Clock marker and invocation: resolved in the desktop contract.** Main owns an atomic
  device-global record, Todo renderer owns check cadence, parallel SNTP failures change no marker,
  stale results are generation-fenced, and Core's 409 uses a typed Main-to-renderer recheck request.
- **Baseline anti-overwrite: resolved.** Canonical baselines are separate from visible projections;
  greater/equal/lower revisions have monotonic effects, local active overlays replay in order, ACKs
  wait for resource proof, page absence never creates a tombstone, and UI/MCP share one repository
  plus coalesced refresh. Permanent-error resource proof remains open in finding 2.

## Conclusion

**Blocked.** The storage boundary, fixed-password test seam, two-phase bootstrap, pending overlay,
ACK/resource proof, client-time LWW, clock marker, and future-time recovery are now sufficiently
specified. Implementation should still wait until the exact desktop/backend wire shapes,
permanent-error projection lifecycle, root clock overview, and migration-task ownership are
consistent.

## Verification boundary

This was a read-only contract review of the current desktop feature/analysis/task and delivery plan,
the three-database SQLite release-gate feature/analysis/task, the root Todo sync HTML overview, and
the current backend feature/analysis/tasks/review. No product or design document was changed beyond
this review artifact. No test, typecheck, build, Electron process, database operation, credential
access, or network request was run.
