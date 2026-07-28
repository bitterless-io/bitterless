# SQLite Migration Release Gate

Status: implementation in progress

Date: 2026-07-16

## Objective

No signed Bitterless package may be built or published until the exact runtime migration manifests
prove that supported historical Core, Maestro, and customer Todo databases can reach the current
schema without data loss, skipped versions, partial ledger writes, or a blocked Electron startup.

## Scope

The gate covers all persisted application database families:

| Database | Runtime owner | Upgrade surface |
|---|---|---|
| Core `main.db` | Core SQLite preload | Todo, Domain, Setting, legacy coding-agent import, EyesOnAgents |
| Maestro `config.db` | Maestro SQLite preload | capture rules, tabs, chat persistence, inject buttons |
| Todoist sync `todoist-sync-v1/customer-<customerId>.db` | Core SQLite preload `todoistSync` session | synchronized Domain/Todo/SubTodo rows, outbox, sync state, local Todo events |

Linux is not a supported Bitterless release platform. A successful production release updates
macOS ARM64, macOS x64, and Windows x64.

## Migration contract

- `package.json.version_code` is the canonical build identifier. Packaging sets it to the local
  12-digit string `YYMMDDHHmmss`; version codes stay strings throughout application code.
- Runtime/UI/update manifests may continue exposing the compatibility field `versionCode`, derived
  from `version_code`; source package metadata must not depend on the legacy camelCase key.
- Every version-code ordering decision uses the shared `compare-versions` library. Raw numeric,
  lexical, subtraction, or width-based comparisons are forbidden.
- Each database owns one ordered migration manifest. Runtime boot and the release audit import the
  same manifest; a copied list in a test is not acceptable.
- The customer Todo database manifest is driver-neutral and lives under
  `src/preload/sqlite/todoistSync/`. The SQLite-preload SQLCipher owner and the pure-Node audit
  execute that same ordered manifest; the
  audit may create an unencrypted disposable adapter database but may not restate its DDL.
- Migration identifiers are unique, strictly increasing 12-digit `YYMMDDHHmmss` strings. Historical
  shorter ledger values remain valid upgrade starting points but no new migration may use them.
- One migration and its ledger insert run in the same SQLite transaction. A failure rolls back both,
  throws a version-labelled error, and leaves the migration retryable on the next startup.
- A failed migration is never logged as applied and later migrations never run after it.
- Fresh schemas are created at the latest shape and stamped with the current build version. Existing
  databases run every manifest entry newer than their maximum ledger value.
- Every migration is idempotent against a schema that may already contain its intended change. This
  is required because older releases used incompatible version-number widths and corrected entries
  must safely replay.

## Runtime Core readiness

- Core SQLite readiness is owned by the target SQLite preload, not renderer HTML
  `did-finish-load`.
- Only the real non-`about:blank` SQLite target preload registers the boot handler and broadcasts a
  generated `targetId`. Main observes `ready({ targetId })` in the background after that signal;
  the initial `about:blank` preload cannot satisfy or overwrite the lifecycle.
- After applying the SQLCipher key and database pragmas, runtime executes
  `SELECT COUNT(*) AS object_count FROM sqlite_master`. An empty new database returns `0`; an
  existing readable database returns a non-negative count. Query failure or an invalid result
  fails Core readiness and becomes a startup diagnostic without hiding Home.
- The ready result is successful only after the read probe, current tables, ordered migrations, and
  final Core schema verification all complete. Target registration and ready RPC have no elapsed-
  time failure threshold and never block foreground GUI startup.

## Runtime Todo readiness

- The authenticated Core SQLite preload `todoistSync` session is the only owner of a customer Todo
  database. UI, MCP, auth, and Main lifecycle code reach it through typed XPC clients and never open
  the file. Main's XPC center routes opaque payloads but registers no Todo storage handler.
- The SQLite session resolves a customer-isolated path and owns protected-key file IO. It requests
  only raw encryption/decryption from Main's Electron `safeStorage` capability, applies the
  SQLCipher key before any schema read, runs the shared Todo manifest,
  then executes `integrity_check`, `foreign_key_check`, and final schema verification before making
  the repository active.
- Migration/key/open failure leaves the existing file and outbox intact, closes the handle, and
  exposes a typed startup diagnostic. It must not fall back to `main.db`, create an unencrypted
  replacement, or invalidate an otherwise valid Core login.
- Account switches and logout close the current handle before another customer path can open. A
  stale session generation can never complete readiness for the newly active account.
- Automated/local database tests inject one fixed test password and never call `safeStorage` or the
  operating-system keychain. That password is test-only; an actual development/packaged app
  session still uses the runtime-protected random password.

## Historical upgrade matrix

The audit creates disposable SQLite databases through a pure-Node adapter matching the production
driver contract and exercises:

- fresh Core and Maestro databases;
- fresh/current-v2 customer Todo databases plus both observable v1 upgrade shapes, including every
  resource, outbox, state, event, index, foreign-key, and migration-ledger invariant;
- pre-ledger legacy databases;
- Core ledgers from the historical 10-digit series and the later 8-digit series;
- Core schemas before Setting `sub_key`, Todo columns, Domain metadata, and each EyesOnAgents schema
  increment;
- Maestro checkpoints before/after capture-filter rebuild and each chat/inject-button migration;
- direct jumps over several checkpoints, not only one-version upgrades.

Todoist sync deliberately ignores the legacy Todo rows in `main.db`. Its original v1 nevertheless
became observable in DEBUG before the baseline-parent fix, so the matrix now upgrades the immutable
pre-parent v1 and the development v1-ledger shape that already contains the parent column/index.
It also covers empty fresh v2, current-v2 reopen, an incomplete/invalid ledger, and injected v2/future
migration failures. There is no `main.db` import fixture. Every later released Todo schema adds its
real pre-upgrade checkpoint fixture to this matrix before packaging that change.

Every case must finish with `integrity_check = ok`, an empty `foreign_key_check`, the complete current
column/index contract, every expected ledger entry, and preserved sentinel rows. The test must also
inject a failing migration and prove transaction rollback plus absence from the ledger.

The pure-Node audit proves migration/schema behavior but does not pretend to open a SQLCipher file.
A separate Electron-ABI Todo cipher smoke uses the production native module and manifest to prove
create/reopen, wrong-key failure, restart preservation, and customer-path isolation. Runtime asset
inspection proves the same native module is present in development plus packaged macOS/Windows
outputs. Both checks are release gates.

## Packaging hook

`yarn audit:sqlite-migrations` is the reusable local/CI command. It covers all three database
families. Production build entry points call it before environment preparation, application
compilation, signing, notarization, or upload.
`scripts/publish.js --build` is the authoritative all-platform release path and must fail closed if
the audit exits non-zero.

The desktop runtime remains pinned to Electron `40.10.6` with
`better-sqlite3-multiple-ciphers@12.11.1`. The macOS ARM fast-publish shortcut synchronizes source
first, installs the checked-out Yarn lockfile with `--frozen-lockfile`, then runs the existing patch
preparation to increment `version`/`_version` and generate a fresh local `YYMMDDHHmmss`
`version_code`. Only then may it start the signed build. An install or patch failure stops the
command before packaging. This prevents a newly pulled Electron or SQLCipher dependency from being
omitted due to stale `node_modules`, and prevents a new fast-published version from reusing an older
release's build identifier.

macOS DMG signing must work when the Developer ID certificate exists only as the configured P12,
not as a persistent login-keychain identity. The publisher imports that P12 into a private
temporary keychain, passes the keychain explicitly to `codesign`, never logs passwords, and deletes
the keychain in a `finally` path before notarization or upload can continue.

macOS notarization uses an explicit reusable workflow instead of Electron Builder's built-in
notarization call. After Electron Builder signs the application, its `afterSign` hook recreates a
submission ZIP, submits it through Apple's default S3-accelerated route, waits on the returned
submission ID, then staples and validates the application before ZIP/DMG packaging. DMG publication
uses the same submit/wait helper and staples and validates the DMG before updater metadata or
production upload. Both flows stream progress and bounded retry decisions to the terminal, retry
only recognized network transport failures, and fail immediately for credentials, preflight,
`Invalid`, or `Rejected` results. A wait retry always reuses its existing submission ID rather than
uploading again.

The audit is a pure Node process. It must not launch Electron, create an application window, touch a
real user database, read transcripts, or mutate production storage. It requires Node.js 22.5 or
newer so the disposable databases can use the built-in `node:sqlite` engine without another native
binary or an Electron ABI dependency.

## Release gate

Production publication may start only after:

1. migration audit passes;
2. focused audit tests, Todo SQLCipher/asset smoke, and TypeScript checks pass;
3. the new release version and release notes are committed and synchronized;
4. each supported platform is built from that same commit and `version_code`;
5. publication compares the local and existing platform manifests with `compare-versions` and
   refuses a downgrade or a conflicting reuse of the same `version_code`;
6. signed/notarized artifacts and updater metadata are uploaded to the production platform prefix;
7. public manifests and artifact URLs are fetched back and matched to the local release metadata.

If any platform fails, do not claim an all-platform release. Preserve successful artifacts, report
the exact failed boundary, and retry only after the cause is corrected.
