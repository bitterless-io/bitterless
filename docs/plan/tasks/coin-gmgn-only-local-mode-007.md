---
id: coin-gmgn-only-local-mode-007
scope: Remove Alchemy from the active Coin release and make local Meme analysis GMGN-only
status: implemented-owner-verification-pending
depends-on: [coin-analysis-workspace-003, coin-holder-universe-filter-006]
---

# Coin GMGN-only Local Mode

## Objective

Let the current Coin release discover and analyze Meme tokens with the configured read-only GMGN
CLI alone. Alchemy is deferred and must not appear as a prerequisite, source row, Resources control,
or renderer IPC capability.

## Contract

- Local Meme readiness requires only an installed `gmgn-cli`, a configured personal API key, and no
  `GMGN_PRIVATE_KEY`.
- Local Discover and Analyze execute fixed GMGN read commands only. They do not call Alchemy or mark
  a successful GMGN result partial because Alchemy is absent.
- Resources and Sources omit Alchemy rows, setup counts, modals, and renderer-accessible save/test
  methods.
- Existing main-process Alchemy adapter and encrypted-store implementation may remain dormant for a
  future tracked task; no current renderer or analysis path can reach it.
- Persisted mode value `local_cli_rpc` remains readable for state compatibility, but every visible
  label describes the mode as local GMGN CLI.
- Holder filtering uses deterministic burn/system rules plus GMGN `addr_type`, `exchange`, `tags`,
  and `maker_token_tags`. GMGN regular wallets (`addr_type=0`) are eligible only after
  higher-precedence exclusions; exchange/pool rows (`addr_type=2`) are excluded and audited.
  Unknown rank 1 or incomplete eligible coverage keeps holder-derived values unavailable with a
  reason instead of assuming an address is independent.
- Chain identity, contract-kind, and complete account-kind verification remain explicitly deferred;
  they are unavailable dimensions, not request failures.

## Paths

- `src/main/coin/data/`
- `src/main/coin/resources/`
- `src/main/coin/coinIpc.service.ts`
- `src/preload/coin/`
- `src/shared/coin/`
- `src/renderer/coin/src/views/analysis/`
- `src/renderer/coin/src/views/resources/`
- `src/renderer/common/i18n/`
- `tests/coin/`
- `docs/features/`
- `docs/guides/`

## Verification

- Update source contracts so GMGN alone enables local mode and Alchemy is absent from renderer
  resources/source status.
- Keep focused GMGN-only normalization coverage, including truthful unknown-holder behavior.
- Update Electron contract expectations but do not run E2E, typecheck, build, or runtime verification
  under the owner's current local-verification instruction.
- Run only static diff/whitespace inspection before handoff.

## Result

- Local readiness, Discover, Analyze, source status, and result receipts now use GMGN alone.
- Resources and Sources no longer render Alchemy, and the renderer bridge no longer exposes its
  save/test channels or status payload.
- GMGN holder ratios, wallet PnL, address type, exchange/pool identity, and nested `stat` rates are
  normalized from their documented response fields. Black-hole/system, exchange, and pool rows are
  filtered before concentration is calculated.
- Chain/account verification remains a truthful deferred dimension; unknown rank 1 continues to
  block holder-derived concentration and scoring.
- The dormant main-process Alchemy adapter and encrypted store remain intact for the later task.
- Unit and Electron contract coverage was updated but not executed under the owner's instruction;
  owner runtime verification remains pending.
