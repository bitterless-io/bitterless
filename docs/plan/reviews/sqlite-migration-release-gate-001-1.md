# Review: sqlite-migration-release-gate-001 (round 1)

Baseline: `2a940f3` plus the release-gate implementation for Bitterless `0.0.33`

## Conclusion

**pass for production release** — Core and Maestro now share one fail-closed transaction runner,
runtime and audit import the same migration manifests, historical-width ledgers can advance to the
12-digit series, and every packaging entry reaches the audit before Electron packaging or upload.

This review was performed in the primary session without another review agent or Electron launch,
following the owner's requirement that verification must not create extra Electron helpers.

## Contract review

- Canonical `package.json.version_code` is the string `260716183946`; package generation, runtime
  metadata, update manifests, and UI compatibility fields derive from it.
- Migration and update ordering call `compareVersions`. The release publisher uses the same library
  to reject an OSS manifest downgrade or conflicting reuse of a version code.
- Core corrects the historical 8/10-digit mismatch with idempotent 12-digit entries, including
  recovery of the old Setting `setting_new` partial state without overwriting newer live values.
- Each migration runner and its ledger insert execute in one transaction. The first error is
  version-labelled, rolls back, is not recorded, and prevents later migrations from running.
- Fresh databases receive the latest table shape, final indexes, and current build stamp without
  replaying ALTER migrations.
- The audit uses disposable `node:sqlite` databases and the exact runtime manifests. It does not
  open a user database, import Electron, create a window, read Codex transcripts, sign, or upload.
- `publish.js`, direct build lifecycle hooks, and `signedBuild.js` all fail closed on the audit.

## Verification

| Check | Result |
|---|---|
| `yarn audit:sqlite-migrations` | pass: 9 Core + 7 Maestro historical/fresh baselines |
| Failure injection | pass: DDL/data/ledger rollback; later migration did not run |
| `yarn test:sqlite-migrations` | pass: 5 hook/version/source tests |
| `yarn typecheck:sqlite-migrations` | pass: strict TypeScript boundary |
| `yarn typecheck:node` | pass |
| `yarn test:eyes-on-agents` | pass |
| `node scripts/maestro/check-inject-button.mjs` | pass |
| `yarn build` | pass |
| `git diff --check` | pass |
| Process audit | pass after terminating only the two Bitterless MCP helpers owned by this Codex session; no audit/build process remained |

The repository-wide `yarn typecheck:web` still fails in unrelated existing Connector, Coin, Poker,
legacy Chat, Omni, and Todo surfaces. `yarn check:maestro` also stops at the existing shared-i18n
alias-boundary findings before individual checks run; the migration-adjacent inject-button check
passes directly. No failure points to a file or type changed by this task.
