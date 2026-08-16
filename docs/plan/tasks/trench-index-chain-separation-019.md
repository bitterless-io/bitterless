---
id: trench-index-chain-separation-019
scope: shared/main/renderer/trench-io
status: done
depends-on: [trench-io-runtime-018]
---

# Trench INDEX Chain Separation

## Objective

Make chain an explicit INDEX partition in storage, ranking, typed snapshots, and the visible
workspace. Solana and BSC targets and wallets must never share one displayed list or compete for
the same `1..100` rank range, while one full-set analysis and one atomic publication remain.

## Context

- [`../../features/trench-index.md`](../../features/trench-index.md)
- [`../../features/trench-index-layout.md`](../../features/trench-index-layout.md)
- [`../analysis/trench-index-analysis.md`](../analysis/trench-index-analysis.md)
- [`trench-index-analysis-017.md`](trench-index-analysis-017.md)
- [`trench-io-runtime-018.md`](trench-io-runtime-018.md)

The current branch is `dev/current`; do not switch or create a branch. Preserve unrelated dirty
worktree changes. Keep the running DEBUG_PROD application/profile/database untouched.

## Path

- `docs/features/trench-index.md`
- `docs/features/trench-index-layout.md`
- `docs/plan/analysis/trench-index-analysis.md`
- `docs/plan/tasks/trench-index-chain-separation-019.md`
- `docs/plan/results/trench-index-chain-separation-019.md`
- `docs/plan/README.md`
- `package.json` only for the required monotonic migration version code
- `src/shared/trench/trenchIndex.type.ts`
- `src/shared/trench/trenchIndex.validation.ts`
- `src/main/coin/index/trenchIndex.normalize.ts`
- `src/main/coin/index/trenchIndex.orchestrator.ts` only if typed batch plumbing requires it
- `src/renderer/trench-io/trenchIo.migration.ts`
- `src/renderer/trench-io/trenchIo.repository.ts`
- `src/renderer/coin/src/views/index/**`
- `src/renderer/coin/src/components/TrenchIndexWorkspace/**`
- `src/renderer/common/i18n/en.ts`
- `src/renderer/common/i18n/zh.ts`
- `scripts/coin/trench-index-layout.test.mjs`
- `scripts/sqlite-migrations/auditRunner.ts`
- `tests/coin/**` where INDEX contracts, migration, repository, renderer, or E2E are covered

## Contract

1. One Add/Reanalyze job still snapshots every active target and publishes all represented chains
   in one transaction. This task does not introduce concurrent per-chain jobs.
2. Ranking groups only same-chain candidates. Each chain independently sorts by profit,
   profitable CA count, source CA count, best source rank, and canonical address, then publishes at
   most 100 contiguous `chainRank` values beginning at `1`.
3. `trench_index_wallets` persists an explicit chain discriminator and chain-local rank. Its unique
   rank constraint is `(run_id, chain, chain_rank)`. Wallet identity remains normalized in
   `trench_wallets`; no address/name/avatar/note duplication is allowed.
4. Add a monotonic, transaction-safe Trench schema migration. Existing rows are preserved and
   deterministically repartitioned/reranked from joined wallet chain and stored metrics. Fresh and
   supported-upgrade databases must converge to the same asserted schema.
5. The workspace wire schema becomes a new explicit version and returns ordered chain projections,
   each containing only its chain's targets and wallets. Mixed flat target/wallet arrays are not an
   accepted fallback.
6. SOL and BSC tabs are always visible and ordered SOL then BSC. Robinhood appears only when its
   projection contains a target or result. One selected tab filters both columns, headers, ranks,
   and empty states without provider calls or writes.
7. The selector stays inside the existing 32px INDEX module row and uses the accepted
   Todo-parity/Trench palette. Only a restrained 2px selected-chain rail uses SOL `#14b887` or BSC
   `#c89500`. It is a keyboard-accessible tablist and remains visible in standalone plus narrow
   Omni geometries.
8. `Reanalyze all` remains the full-set action. Header Refresh remains a local reread. Public MCP
   stays exactly 12 `trench.*` tools; legacy JSON data and `trench.db` path/key are unchanged.
9. Add CA is scoped to the selected chain. It filters structurally recognizable opposite-chain
   entries before the command and renders a live count warning naming the ignored chain. A mixed
   paste submits valid current-chain entries; an all-wrong-chain paste performs no XPC/provider/
   storage call and shows a selected-chain error. Ignored entries never auto-route to another tab.

## Verification

- Ranking unit fixtures prove BSC and Solana each publish `#1..#100`, cross-chain candidates never
  aggregate, per-chain ties are deterministic, and non-user filtering remains fail-closed.
- Native SQLCipher repository tests cover a fresh schema, upgrade from the 018 schema with existing
  current/history rows, explicit chain/rank constraints, chain-projected reads, and atomic failure
  retention.
- Migration audit covers the previous Trench baseline plus the new chain-partition baseline and
  confirms identical final schema/ledger state.
- Shared/runtime validation rejects mixed or mismatched chain projections, duplicate chain ranks,
  wrong-chain rows, over-100 partitions, and the obsolete v1 flat snapshot.
- Static UI/type/i18n checks prove accessible SOL/BSC tabs, exact chain colors, `Reanalyze all`, and
  localized ignored-chain counts, no-call all-wrong-chain handling, and no regression to menuBar
  height/background or the preload-only SQLite boundary.
- Fresh isolated DEBUG_DEV build and focused Electron E2E add one BSC plus one Solana CA, prove each
  tab shows one matching target and its own `#01` wallet, switch in standalone and Omni 800x568,
  398x568, and 800x282 without overflow, recover `trench-io`, and reanalyze all.
- Existing Coin/INDEX unit tests, native repository tests, focused typechecks, exact 12-tool MCP
  contract, `git diff --check`, and independent Verify review pass. DEBUG_PROD stays running and
  untouched.
