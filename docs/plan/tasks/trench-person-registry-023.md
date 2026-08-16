---
id: trench-person-registry-023
scope: BL Trench INDEX rank policy and person data layer
status: done
depends-on: [trench-remote-avatar-csp-022]
---

# Trench per-chain Top 300 and person registry

## Objective

Raise the final INDEX to at most 300 wallets independently per chain and add the encrypted person
registry, automatic published-wallet membership, X identity resolution, and typed read/manual-edit
API required by Trenchers. Preserve single-target GMGN Top 100 evidence and all current data.

## Context

- [`../../features/trench-index.md`](../../features/trench-index.md)
- [`../../features/trench-person-registry.md`](../../features/trench-person-registry.md)
- [`../analysis/trench-index-analysis.md`](../analysis/trench-index-analysis.md)
- [`../analysis/trench-person-registry-analysis.md`](../analysis/trench-person-registry-analysis.md)
- [`trench-index-chain-separation-019.md`](trench-index-chain-separation-019.md)

Current branch is `dev/current`; do not switch/create a branch or worktree. Preserve all unrelated
dirty changes. Do not touch DEBUG_PROD. Per Ral, do not run any Electron E2E.

## Path

- `docs/features/trench-index.md`
- `docs/features/trench-person-registry.md`
- task/result/README analysis docs for 023
- `package.json` version_code only
- `src/shared/trench/trenchIndex.*`
- new shared person types/validation/XPC contracts
- `src/main/coin/index/`
- `src/main/trench/trenchIoClient.service.ts`
- `src/main/trench/trenchIoWindow.service.ts` only when event relay requires it
- `src/main/xpc/trench.handler.ts`
- `src/renderer/trench-io/`
- focused migration/unit/type/static test paths
- `scripts/sqlite-migrations/auditRunner.ts`

## Contract

1. `TRENCH_INDEX_MAX_WALLETS` is 300 per chain. Candidate reads, candidate/source rank, best source
   rank, and legacy CA `topProfitWallets` stay capped at 100. Total current publication is at most
   900 over SOL/BSC/Robinhood with contiguous independent ranks.
2. Add immutable schema version `260813155644`. Fresh databases record 018, 019, and 023 ledger
   rows. A populated 019 database upgrades transactionally: rebuild the wallet registry into one
   global `(namespace,address)` table plus `(wallet_id,chain)` accounts, remap candidates/results to
   `wallet_account_id`, widen run/rank checks, and add exact person tables/indexes/FKs. Equal EVM
   addresses across chains converge without losing either chain result; every old row, metric, and
   current pointer survives. Unknown/future/partial schemas still fail closed. Package
   `version_code` is at least the schema version.
3. Implement the exact global-wallet/chain-account and person/profile/membership/external-identity/
   conflict model in the feature
   contract. Profile priority is field-specific; manual/agent evidence cannot be overwritten by
   GMGN/import/system enrichment.
4. `completeRun` reuses one global wallet across chains, preserves independent chain account facts,
   and ensures membership for every and only published eligible wallet in the same
   transaction as publication. Rollback leaves neither partial INDEX nor partial people. X handles
   normalize exactly; safe uncurated merges retain audit history, curated collisions record a
   conflict and do not move memberships.
5. Implement cursor-fenced person list/detail plus profile edit and existing-wallet attach/move with
   exact validation and expected-revision/current-membership CAS. Person summary profit is derived
   from the current run and labelled `wallet-sum-v1`; no transfer-aware claim or copied aggregate.
6. Main and visible renderer contain no SQL/SQLite import. All data operations remain capability-
   fenced in `trench-io`; mutations increment revision and emit content-free person change events.
7. Do not add MCP import or UI in this task. Legacy Trench JSON, GMGN credentials/process, ranking
   tie keys, and existing public MCP tools stay otherwise compatible.

## Verification

- Unit tests cover 301+ eligible addresses across multiple CAs, every-chain 300, deterministic tie
  keys, parser 300/301 boundaries, and unchanged per-target/source-rank 100 rejection.
- Native SQLCipher tests cover fresh v3, populated 019→023 row preservation, current pointer,
  checks/FKs/indexes, transaction rollback, person ensure, X merge, curated conflict, profile
  priority, cursor staleness, manual CAS, and current profit projection.
- Migration typecheck/audit, node and focused renderer/shared typechecks, static no-Main-SQL/event
  boundaries, fresh isolated DEBUG_DEV build, and `git diff --check` pass. No Electron E2E runs.
- Independent Verify writes `docs/plan/reviews/trench-person-registry-023-1.md`; Ral performs later
  UI/runtime acceptance.

## Development handoff

Implementation completed on 2026-08-13. The first independent Verify identified four blocking P2
findings; Develop has addressed their immutable-ledger, upgrade-backfill, profile-provenance, and
person-owned-X contracts with focused regressions. The final provenance fix includes blank
manual/agent/mixed wallets whose only curated facts are note/metadata, plus direct and later
shared-X collision fences. The task stays `in-progress` pending a fresh
independent reverify; it is not marked `done` and no owner UI/runtime acceptance is claimed. The
implementation evidence and intentionally deferred surfaces are recorded in
[`../results/trench-person-registry-023.md`](../results/trench-person-registry-023.md).
