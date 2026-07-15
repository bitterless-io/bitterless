# Coin Data Source Preparation

Status: Human setup guide

Coin enables an action only when its explicitly selected source mode reports **ready**. Missing
credentials or endpoints remain visible as unavailable; Bitterless never invents a result, changes
source mode after a failure, or silently switches to sample data.

## Prepare first

| Resource | Required for | Owner action |
|---|---|---|
| Alchemy account and applications | local chain identity/contract/account checks and future activity collection | Create read-only endpoints for every supported chain and run the capability probe below. |
| GMGN personal API credential | local Meme discovery, token metadata, security, holders, traders, and concepts | Obtain a credential whose terms allow the planned personal analysis workload. |
| Curated wallet cohort dataset | high-profit, Robinhood, BSC, PVP overlap scoring | Supply reviewed addresses, chain, label, provenance, confidence, and version. |
| Non-independent holder registry | exchange/custody, pool, bridge/router, treasury, and vesting exclusions | Supply reviewed public addresses, chain, exclusion class, provenance, confidence, and version. Never include signing material. |
| Coin source services | desktop Monitor/Screener and optional preferred Meme service requests | Deploy the applicable backend services and provide their public API bases. |
| Position data | position-aware `HOLD` decisions | Supply entry price, remaining amount, invested amount, and risk inputs for each analysis. |

Do not put API keys, RPC URLs containing keys, wallet lists with private annotations, or production
credentials in this repository. Bitterless is a `projects/` submodule and must be treated as public.
Store service credentials in the private parent workspace under `areas/keychain/` or
`ops/bitterless/`. Per-machine GMGN/Alchemy values may instead be entered through Resources, where
the main process stores them outside the repository.

For local desktop setup, use Coin's Resources page. It stores GMGN in the standard owner-only GMGN
config and encrypts Alchemy values with Electron `safeStorage`; neither credential is synchronized
with Git. See the full [GMGN CLI setup guide](gmgn-cli.md).

## Alchemy setup

1. Sign in to Alchemy and create a workspace dedicated to personal Bitterless coin research.
2. Create separate applications/endpoints for BSC, Solana, and Robinhood Chain when each network is
   available to the account. Separate apps make quota, failures, and later credential rotation
   attributable by chain.
3. Choose the production network for each chain. Enter the HTTPS endpoint through Resources for
   local mode, or record it in the private Bitterless ops inventory for a deployed service.
4. Keep the key in the main process. Resources encrypts the endpoint with Electron `safeStorage`;
   the renderer receives only masked readiness metadata, and no `VITE_*` value may contain it.
5. The implemented local adapter performs read-only chain identity plus contract/account checks
   where supported: `eth_chainId` and `eth_getCode` for EVM chains, and Solana health/account-info
   calls for Solana. Holder/activity coverage still comes from GMGN or a deployed Meme service.
6. Record each capability as `supported`, `unsupported`, or `degraded`, with the observed timestamp
   and error. An RPC that answers a health call is not proof that it can produce the holder metrics.
7. For Robinhood Chain, collect at least seven days of sample density, transfer coverage, and rate
   behavior before enabling a score. Keep its UI source state unavailable until that gate passes.

Use one credential per service environment where possible. Rotation means updating the private
backend environment and ops inventory, redeploying the collector, then verifying the source status;
it must not require a desktop release.

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
Classification priority is chain-invariant address rules, explicit provider labels/tags, Alchemy
account kind, then the reviewed exclusion registry. Exclude burn/null/system addresses,
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
preferred explicit mode, but it is optional: explicit local mode uses configured GMGN CLI plus the
selected chain's Alchemy endpoint. There is no service-to-local fallback after a failed request.

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
- [ ] Alchemy endpoints are main-process-only or server-only and capability probes are recorded per chain.
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
