# Coin Data Source Preparation

Status: Human setup guide

Coin can ship and be tested with typed local fixtures, but production analysis is enabled only when
the corresponding source reports **ready**. Missing credentials or endpoints remain visible as
unavailable; Bitterless never invents a result or silently switches to sample data.

## Prepare first

| Resource | Required for | Owner action |
|---|---|---|
| Alchemy account and applications | EVM/Solana holder, transfer, and activity collection | Create read-only endpoints for every supported chain and run the capability probe below. |
| GMGN personal API credential | Meme wallet labels and GMGN-derived rates | Obtain a credential whose terms allow the planned personal analysis workload. |
| Curated wallet cohort dataset | high-profit, Robinhood, BSC, PVP overlap scoring | Supply reviewed addresses, chain, label, provenance, confidence, and version. |
| Coin source services | desktop Monitor, Screener, and Meme requests | Deploy the backend services and provide their public API bases. |
| Position data | position-aware `HOLD` decisions | Supply entry price, remaining amount, invested amount, and risk inputs for each analysis. |

Do not put API keys, RPC URLs containing keys, wallet lists with private annotations, or production
credentials in this repository. Bitterless is a `projects/` submodule and must be treated as public.
Store them in the private parent workspace under `areas/keychain/` or `ops/bitterless/`, then inject
them only into the backend service environment.

For local desktop setup, use Coin's Resources page. It stores GMGN in the standard owner-only GMGN
config and encrypts Alchemy values with Electron `safeStorage`; neither credential is synchronized
with Git. See the full [GMGN CLI setup guide](gmgn-cli.md).

## Alchemy setup

1. Sign in to Alchemy and create a workspace dedicated to personal Bitterless coin research.
2. Create separate applications/endpoints for BSC, Solana, and Robinhood Chain when each network is
   available to the account. Separate apps make quota, failures, and later credential rotation
   attributable by chain.
3. Choose the production network for each chain. Record the HTTPS endpoint and, when required by the
   collection service, the WebSocket endpoint in the private Bitterless ops inventory.
4. Keep the key server-side. The desktop renderer and any `VITE_*` value must never contain an
   Alchemy endpoint with a secret.
5. From the future Meme collection service, run read-only probes for chain identity, latest block or
   slot, token transfers, token balances/holders, transaction history, and request-rate behavior.
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
6. Add bounded concurrency, cooldown, retry-after handling, and source receipts before enabling the
   discover/recently-filled polling loop.

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

## Service handoff

The desktop receives only source API bases:

```text
VITE_COIN_MONITOR_API_BASE
VITE_COIN_MONITOR_WS_BASE
VITE_COIN_SCREEN_API_BASE
VITE_COIN_MEME_API_BASE
```

The monitor and screen services may be enabled independently. The Meme service is ready only when
its health/status response identifies supported chains, enabled providers, cohort version, latest
successful observation, and unavailable dimensions. Production APIs use `GET` without request
parameters and `POST` with a JSON body.

## Readiness checklist

- [ ] Private ops inventory names the `ral` owner for every credential and deployed resource.
- [ ] Alchemy endpoints are server-only and capability probes are recorded per chain.
- [ ] GMGN terms/rate limits and required fields are verified.
- [ ] `gmgn-cli` is installed, the personal key is configured with mode `0600`, and the read-only
      probe passes without `GMGN_PRIVATE_KEY`.
- [ ] A reviewed, versioned wallet cohort is deployed.
- [ ] Monitor, Screener, and Meme bases expose health/status and use HTTPS in production.
- [ ] Missing source data returns `null + reason`, never a fabricated zero.
- [ ] Polling respects provider cooldowns and can be stopped without losing the last valid receipt.
- [ ] No wallet signing, swap, exchange order, or private key is available to Coin.
