# SQLite Migration Release-Gate Analysis

## Problem

Core SQLite has historical ledger identifiers in three incompatible widths: 10-digit
`YYYYMMDDNN`, 8-digit `YYMMDDNN`, and Maestro's 12-digit `YYMMDDHHmmss`. Because pending migrations
are selected by numeric comparison, a client whose Core ledger ends at `2026040201` considers later
8-digit entries such as `26071603` older and skips them. Both current runners also catch a migration
error, record the failed version, and continue, making the failure non-retryable.

The corrected contract treats all version codes as strings and compares them only with the common
`compare-versions` package. New build and migration identifiers use `YYMMDDHHmmss`; historical
shorter values are accepted only as upgrade checkpoints.

## Module decomposition

| Module | Input | Output | Dependency |
|---|---|---|---|
| Shared migration runner | DB, ordered manifest, build version, existing/fresh flag | atomic applied ledger or typed failure | SQLite driver |
| Core release manifest | Core tables and idempotent upgrade runners | runtime/audit source of truth | Core DAO schemas |
| Maestro release manifest | Maestro latest schemas and upgrade runners | runtime/audit source of truth | Maestro persistence schema |
| Todoist sync release manifest | customer resource/outbox/state/event schema | runtime/audit source of truth | Core SQLite preload Todo repository |
| Audit CLI | all three manifests plus historical fixtures | pass/fail report for every baseline | esbuild + SQLite driver |
| Todo cipher smoke | production manifest + protected key | encrypted create/reopen and packaged-native proof | Electron ABI + `better-sqlite3-multiple-ciphers` |
| Packaging hook | production build request | audit gate before build/sign/upload | audit CLI |
| Version metadata | string `package.json.version_code` | compatibility string `versionCode` at runtime/manifests | `compare-versions` + package/update helpers |

## Integration enumeration

1. Core preload registers tables and migrations from the Core release manifest, then the manager
   delegates execution to the shared strict runner.
2. Maestro preload registers the Maestro manifest; its manager uses the same strict runner and the
   same latest-schema initializer used by audit.
3. The authenticated Core SQLite preload Todoist sync session resolves one customer file/key, applies the
   SQLCipher key, and executes its driver-neutral manifest through the same strict runner contract.
4. Audit bundles the real TypeScript manifests, builds historical fixtures, executes the shared
   runner, and verifies schema/data/ledger invariants.
5. A focused Electron-ABI smoke opens the Todo schema with the production cipher module, proves a
   wrong key cannot read it, reopens after restart, and inspects development/packaged native assets.
6. `publish.js --build` calls the audit and Todo cipher/asset gate before `rig`, `electron-vite`, `electron-builder`, signing,
   notarization, and OSS upload.
7. Package helpers translate canonical `version_code` to the existing runtime/update field
   `versionCode`, keeping current renderer and remote manifest names compatible while changing the
   value type to a 12-digit string.
8. Migration, update, packaging, and audit comparisons all call `compareVersions`; none infer
   ordering from JavaScript numbers or string width.
9. macOS DMG finalization imports the configured Developer ID P12 into an isolated temporary
   keychain, temporarily prepends it to the user keychain search list, selects the unique imported
   Developer ID identity matching the verified app Team ID, signs with an explicit `--keychain`,
   restores the exact prior search list, and always deletes the keychain. The publisher verifies
   both the app before signing and the DMG before notarization, then validates the stapled ticket.
   This avoids a hidden dependency on a certificate being installed in the user's login keychain
   while matching macOS `codesign` identity-discovery behavior.
10. Electron-builder's per-file signing calls run through a release-only preload that retries only
   Apple's exact transient `timestamp service is not available` failure with bounded backoff.
   Permanent signing failures still fail immediately, and the retry log contains no command path,
   signing identity, or credential.

## Delivery decision

Execution is one explicit serial chain. The existing shared runner, Core/Maestro manifests, audit
CLI, and packaging hook are the foundation already present in the worktree.
`todoist-sync-desktop-001` is the sole owner of the new Todo manifest, its fixed-password/native
fixtures, and registration into that audit. Only after it completes may
`sqlite-migration-release-gate-001` run the combined three-family audit and final production
package/publication proof. The final task consumes the Todo manifest; it does not copy or redefine
it.
