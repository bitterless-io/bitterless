# SQLite Migration Release Gate

Status: implementation in progress

Date: 2026-07-16

## Objective

No signed Bitterless package may be built or published until the exact runtime migration manifests
prove that supported historical Core and Maestro databases can reach the current schema without
data loss, skipped versions, partial ledger writes, or Electron startup.

## Scope

The gate covers both persisted application databases:

| Database | Runtime owner | Upgrade surface |
|---|---|---|
| Core `main.db` | Core SQLite preload | Todo, Domain, Setting, legacy coding-agent import, EyesOnAgents |
| Maestro `config.db` | Maestro SQLite preload | capture rules, tabs, chat persistence, inject buttons |

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

## Historical upgrade matrix

The audit creates disposable SQLite databases through a pure-Node adapter matching the production
driver contract and exercises:

- fresh Core and Maestro databases;
- pre-ledger legacy databases;
- Core ledgers from the historical 10-digit series and the later 8-digit series;
- Core schemas before Setting `sub_key`, Todo columns, Domain metadata, and each EyesOnAgents schema
  increment;
- Maestro checkpoints before/after capture-filter rebuild and each chat/inject-button migration;
- direct jumps over several checkpoints, not only one-version upgrades.

Every case must finish with `integrity_check = ok`, an empty `foreign_key_check`, the complete current
column/index contract, every expected ledger entry, and preserved sentinel rows. The test must also
inject a failing migration and prove transaction rollback plus absence from the ledger.

## Packaging hook

`yarn audit:sqlite-migrations` is the reusable local/CI command. Production build entry points call
it before environment preparation, application compilation, signing, notarization, or upload.
`scripts/publish.js --build` is the authoritative all-platform release path and must fail closed if
the audit exits non-zero.

macOS DMG signing must work when the Developer ID certificate exists only as the configured P12,
not as a persistent login-keychain identity. The publisher imports that P12 into a private
temporary keychain, passes the keychain explicitly to `codesign`, never logs passwords, and deletes
the keychain in a `finally` path before notarization or upload can continue.

The audit is a pure Node process. It must not launch Electron, create an application window, touch a
real user database, read transcripts, or mutate production storage. It requires Node.js 22.5 or
newer so the disposable databases can use the built-in `node:sqlite` engine without another native
binary or an Electron ABI dependency.

## Release gate

Production publication may start only after:

1. migration audit passes;
2. focused audit tests and TypeScript checks pass;
3. the new release version and release notes are committed and synchronized;
4. each supported platform is built from that same commit and `version_code`;
5. publication compares the local and existing platform manifests with `compare-versions` and
   refuses a downgrade or a conflicting reuse of the same `version_code`;
6. signed/notarized artifacts and updater metadata are uploaded to the production platform prefix;
7. public manifests and artifact URLs are fetched back and matched to the local release metadata.

If any platform fails, do not claim an all-platform release. Preserve successful artifacts, report
the exact failed boundary, and retry only after the cause is corrected.
