---
id: coin-holder-universe-filter-006
scope: Filter non-independent addresses before top-holder and cohort analysis
status: implemented-owner-verification-pending
depends-on: [coin-analysis-workspace-003]
---

# Coin Holder Universe Filter

## Objective

Prevent burn/null addresses, exchanges/custodians, pools, contracts/programs, bridges/routers, and
explicit treasury/vesting accounts from inflating Top 10/Top 100 concentration or entering key-wallet
and cohort analysis.

## Contract

- Classify every returned holder with evidence before inclusion in the eligible holder universe.
- Apply deterministic chain burn/system address rules, explicit GMGN labels/tags, and GMGN
  `addr_type`/`exchange` evidence in the current release. Account-kind RPC verification and a
  versioned owner exclusion registry are deferred.
- Require a classification decision for raw rank 1. Exclude it only when evidence identifies a
  non-independent class; retain a verified independent wallet; block holder-derived concentration
  and scores when rank 1 is unknown.
- Re-rank eligible wallets after exclusion. Compute Top 10/Top 100 and key wallets only from the
  re-ranked eligible set.
- Preserve an audit row for each exclusion: source rank, address, class, reason, and evidence refs.
- Expose source-row/eligible-row coverage. Never label an incomplete filtered set as Top 100; local
  GMGN mode must return `null + reason` when its non-pageable 100-row cap cannot backfill exclusions.
- Modern service payloads must attest that concentration uses the filtered universe. Legacy payloads
  without this evidence keep holder concentration unavailable rather than trusted.
- Add excluded-holder facts to bounded Codex evidence; AI may explain but cannot reintroduce an
  excluded address or manufacture missing coverage.

## Paths

- `src/shared/coin/coinAnalysis.type.ts`
- `src/main/coin/data/memeAnalysis.normalize.ts`
- `src/main/coin/state/coinState.schema.ts`
- `src/main/coin/ai/coinAiEvidence.service.ts`
- `src/renderer/coin/src/views/analysis/MemeAnalysisPanel.vue`
- `src/renderer/common/i18n/`
- `tests/coin/fixtures/`
- `tests/coin/unit/memeAnalysis.normalize.test.ts`

## Owner Verification

1. Analyze a fixture whose raw rank 1 is a burn/system address and rank 2 is a real wallet; confirm
   rank 1 appears only in the exclusion audit and the real wallet becomes eligible rank 1.
2. Repeat with raw rank 1 explicitly labelled as an exchange, pool, contract, and unknown address.
3. Confirm an independently attributable rank 1 remains included; rank alone never removes it.
4. Confirm filtered Top 10 backfills from later source rows and incomplete filtered Top 100 shows an
   unavailable reason plus coverage instead of a percentage.
5. Confirm key-wallet/cohort and Codex evidence contain no excluded address as an eligible wallet.

No agent-side runtime verification is required for this task per the owner's current instruction;
focused tests are authored for owner execution.
