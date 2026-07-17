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
| Audit CLI | both manifests plus historical fixtures | pass/fail report for every baseline | esbuild + SQLite driver |
| Packaging hook | production build request | audit gate before build/sign/upload | audit CLI |
| Version metadata | string `package.json.version_code` | compatibility string `versionCode` at runtime/manifests | `compare-versions` + package/update helpers |

## Integration enumeration

1. Core preload registers tables and migrations from the Core release manifest, then the manager
   delegates execution to the shared strict runner.
2. Maestro preload registers the Maestro manifest; its manager uses the same strict runner and the
   same latest-schema initializer used by audit.
3. Audit bundles the real TypeScript manifests, builds historical fixtures, executes the shared
   runner, and verifies schema/data/ledger invariants.
4. `publish.js --build` calls the audit before `rig`, `electron-vite`, `electron-builder`, signing,
   notarization, and OSS upload.
5. Package helpers translate canonical `version_code` to the existing runtime/update field
   `versionCode`, keeping current renderer and remote manifest names compatible while changing the
   value type to a 12-digit string.
6. Migration, update, packaging, and audit comparisons all call `compareVersions`; none infer
   ordering from JavaScript numbers or string width.
7. macOS DMG finalization imports the configured Developer ID P12 into an isolated temporary
   keychain, temporarily prepends it to the user keychain search list, selects the unique imported
   Developer ID identity matching the verified app Team ID, signs with an explicit `--keychain`,
   restores the exact prior search list, and always deletes the keychain. The publisher verifies
   both the app before signing and the DMG before notarization, then validates the stapled ticket.
   This avoids a hidden dependency on a certificate being installed in the user's login keychain
   while matching macOS `codesign` identity-discovery behavior.
8. Electron-builder's per-file signing calls run through a release-only preload that retries only
   Apple's exact transient `timestamp service is not available` failure with bounded backoff.
   Permanent signing failures still fail immediately, and the retry log contains no command path,
   signing identity, or credential.

## Delivery decision

Use one serial task because runner semantics, manifests, audit fixtures, release metadata, and
production entry points are one fail-closed integration boundary. Splitting them would permit a
package hook to call a copied or incomplete migration list.
