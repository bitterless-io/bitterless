# Coin Data Source Preparation

Status: Human setup guide

Coin enables an action only when its explicitly selected source mode reports **ready**. Missing
credentials or endpoints remain visible as unavailable; Bitterless never invents a result, changes
source mode after a failure, or silently switches to sample data.

## Prepare first

| Resource | Required for | Owner action |
|---|---|---|
| GMGN personal API credential | local Meme discovery, token metadata, security, holders, traders, and concepts | Obtain a credential whose terms allow the planned personal analysis workload. |
| Curated wallet cohort dataset | high-profit, Robinhood, BSC, PVP overlap scoring | Supply reviewed addresses, chain, label, provenance, confidence, and version. |
| Non-independent holder registry | exchange/custody, pool, bridge/router, treasury, and vesting exclusions | Supply reviewed public addresses, chain, exclusion class, provenance, confidence, and version. Never include signing material. |
| Coin source services | desktop Monitor/Screener and optional preferred Meme service requests | Deploy the applicable backend services and provide their public API bases. |
| Position data | position-aware `HOLD` decisions | Supply entry price, remaining amount, invested amount, and risk inputs for each analysis. |

Do not put API keys, RPC URLs containing keys, wallet lists with private annotations, or production
credentials in this repository. Bitterless is a `projects/` submodule and must be treated as public.
Store service credentials in the private parent workspace under `areas/keychain/` or
`ops/bitterless/`. Per-machine GMGN values may instead be entered through Resources, where the main
process stores them outside the repository.

For local desktop setup, use Coin's Resources page. It stores GMGN in the standard owner-only GMGN
config, which is not synchronized with Git. See the full [GMGN CLI setup guide](gmgn-cli.md).

## Deferred: Alchemy setup

Alchemy is not part of the current release and is not required for local discovery or analysis.
Its setup, Resources UI, renderer IPC, and analysis integration are deferred to a later tracked task;
there is nothing to configure for the GMGN-only release.

## GMGN setup

1. Install the CLI with `yarn global add gmgn-cli` and verify its version from Resources.
2. Obtain the personal API credential and confirm the allowed chains, rate limits, and permitted
   automation before enabling polling.
3. Configure the key through Resources or private ops/keychain. Never configure
   `GMGN_PRIVATE_KEY`; the initial integration is read-only.
4. Probe the exact fields needed by Coin: holder labels, fresh-wallet evidence, bot/degen evidence,
   entrapment evidence, wallet PnL/position evidence, timestamps, and pagination completeness.
5. Map absent fields to `null + reason`. Do not derive a zero from a missing label or incomplete
   page.
6. Coin's local adapter already enforces one GMGN process at a time, fixed command templates,
   timeout/output caps, cooldown/retry-after handling, cancellation, and source receipts. Discover
   additionally enforces a 60-second minimum interval and one trenches call per poll.

## Wallet cohorts

Each cohort release needs a version and review record. At minimum every entry contains:

```ts
interface CoinWalletCohortEntry {
  chain: 'robinhood' | 'bsc' | 'solana';
  address: string;
  cohort: 'high_profit' | 'robinhood' | 'bsc' | 'pvp';
  label: string;
  provenance: string;
  observedAt: number;
  confidence: number;
}
```

Normalize addresses by chain, deduplicate them, distinguish EOA from contracts/pools/burn addresses,
and retain the source used to assign each label. Cohorts are evidence, not a private-key or trading
wallet registry; never provide seed phrases or signing credentials.

## Holder-universe exclusions

Top-holder concentration and cohort overlap operate on independently attributable wallets only.
Current classification priority is chain-invariant address rules, explicit provider labels/tags,
then GMGN `addr_type` and `exchange`. GMGN `addr_type=0` identifies a regular wallet;
`addr_type=2` identifies an exchange or liquidity-pool address. RPC account kind and the reviewed
exclusion registry are deferred. Exclude known burn/null/system addresses,
exchange/custody wallets, pools, contracts/programs, bridges/routers, and explicitly labelled
treasury/vesting accounts. Preserve every exclusion as an auditable row with original source rank,
address, class, reason, and evidence.

Do not remove raw rank 1 merely because it is rank 1. It must be classified: excluded classes are
removed and eligible wallets are re-ranked; a verified independent wallet remains; an unknown rank
1 blocks holder concentration and holder-derived scoring until classification is available.

GMGN `token holders` currently returns at most 100 rows and exposes no holder pagination cursor. A
local result can therefore backfill filtered Top 10 from the returned window, but filtered Top 100
is unavailable whenever exclusions leave fewer than the required eligible rows and the complete
population is not known. A production Meme service should page/over-fetch until it has 100 eligible
wallets or proves that fewer exist.

## Service handoff

The desktop receives only source API bases:

```text
VITE_COIN_MONITOR_API_BASE
VITE_COIN_MONITOR_WS_BASE
VITE_COIN_SCREEN_API_BASE
VITE_COIN_MEME_API_BASE
```

The monitor and screen services may be enabled independently. A configured Meme service is the
preferred explicit service mode, but it is optional: explicit local mode uses the configured GMGN
CLI alone. There is no service-to-local fallback after a failed request.

The desktop currently calls these service contracts:

```text
GET  /binance/futures/symbol-feature-states?symbols=...
POST /binance/futures/symbol-feature-states/refresh
WS   configured monitor WebSocket base with selected symbols
POST /api/coin-filter/parse
POST /api/coin-filter/screen
POST /api/meme/discover
POST /api/meme/analyze
```

Screener `sample` is sent only after explicit selection. Meme service responses must identify
unsupported dimensions so the renderer can display `null + reason` rather than a zero.

## Readiness checklist

- [ ] Private ops inventory names the `ral` owner for every credential and deployed resource.
- [ ] GMGN terms/rate limits and required fields are verified.
- [ ] `gmgn-cli` is installed, the personal key is configured with mode `0600`, and the read-only
      probe passes without `GMGN_PRIVATE_KEY`.
- [ ] A reviewed, versioned wallet cohort is deployed.
- [ ] A reviewed, versioned non-independent holder registry is deployed and rank 1 is classified.
- [ ] Monitor and Screener bases use HTTPS in production; the optional Meme base does the same when selected.
- [ ] Missing source data returns `null + reason`, never a fabricated zero.
- [ ] Polling respects provider cooldowns and can be stopped without losing the last valid receipt.
- [ ] No wallet signing, swap, exchange order, or private key is available to Coin.

Implementation is complete for the desktop adapters, but every item above and every live response
shape remains owner-verification pending for `coin-analysis-workspace-003`.
