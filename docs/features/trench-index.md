# BL Trench INDEX

Status: Implemented; authoritative for the first INDEX phase

## Purpose

Trench INDEX turns a user-maintained set of target token contracts into current, reproducible
chain-scoped sets of at most 300 best-performing wallets per chain. Ral adds one or more CAs.
Bitterless resolves each chain, reads token metadata and the provider's top 100 traders ordered by
total profit, aggregates wallet performance across active CAs on the same chain, and atomically
publishes every chain INDEX from one full-set run.

This contract supersedes the three-tab read-only record-browser UI in [`coin.md`](coin.md). The
the original 12 public `trench.*` MCP tools and their legacy JSON repository remain compatible in this
phase; they do not become the source of the new INDEX workspace and no new public MCP tool is added.

## Product boundary

The visible Trench workspace exposes INDEX as the first module in the shared Arco navigation. Its
SOL/BSC/Robinhood child is the chain selector and drives two columns scoped to that chain:

| Column | Content |
| --- | --- |
| Target CAs | Active analysis targets on the selected chain with token name, symbol, CA, current market cap, best available highest-market-cap value, last success, and current error/state |
| INDEX wallets | The most recent fully successful run's selected-chain ranks `1..300`, joined to the shared wallet address/metadata registry and person membership |

The module navigation never renders record counts. `Add CA` accepts a bounded batch of one or more CAs,
scopes the pasted entries to the currently selected chain, validates and resolves the retained
batch, atomically persists its unique targets, and then starts exactly one analysis of the complete
active target set. Structurally recognizable opposite-chain entries are counted and ignored before
submission, with a visible warning naming the ignored chain; they do not reject valid current-chain
entries or become targets on another chain. A malformed, unresolved, or ambiguous retained item
rejects the retained batch before persistence. `Reanalyze` refreshes the complete set. Header
`Refresh` only rereads the local SQLite snapshot; it never calls GMGN.

The Trench menu bar also exposes one `GMGN settings` action. It opens a Trench-owned configuration
dialog backed by the existing Coin resource boundary; it does not restore the legacy Coin
workspace. The sandboxed Trench preload exposes only `detectGmgn`, `saveGmgnApiKey`, `verifyGmgn`,
and `openGmgnOfficialLink` beneath `window.coin.resources`. The existing Coin IPC channels use a
dedicated main-frame URL guard for built and loopback Trench renderers, covering standalone and
Omni without admitting Home, another local renderer, a subframe, or remote content.
Main registers only this four-handler subset during foreground startup; it does not activate the
dormant legacy Coin IPC surface. The same dialog is reachable from an actionable
`PROVIDER_UNAVAILABLE` error while preserving the Add CA text underneath. It reports CLI discovery,
API-key presence, and the last read-only probe,
supports replacement plus verification of the personal API key, and never returns an existing key
to the renderer.

Wallet avatar metadata remains the provider-supplied bounded HTTPS URL stored by the shared wallet
registry; Trench does not copy image bytes into SQLite. The Coin/Trench renderer deliberately
allows remote HTTPS image loads with the exact CSP image directive
`img-src 'self' data: https:`. This exception is image-only: script, connection, object, frame,
base, and form restrictions remain unchanged, and plain HTTP images stay blocked. A permitted URL
can still fail at its origin (for example, an expired link or an HTTP 403), so the wallet row must
show a deterministic local initials fallback instead of a broken-image glyph. The renderer does
not proxy, retry, or fetch the image through script in this phase.

The local fallback is exactly one Unicode code point. Trench trims the shared wallet name and uses
it when non-empty; otherwise it trims the canonical address and removes an EVM `0x` prefix. It
selects that source's first Unicode code point, applies locale-independent `toUpperCase()`, and uses
the uppercase form only when it is still exactly one code point. An expanding mapping keeps the
original code point. Therefore `i` becomes `I`, `ß` remains `ß`, and an emoji is not split into a
surrogate half; the host OS locale cannot change the result.

There is exactly one in-process INDEX analysis job. Controls are disabled while it runs, so two
runs cannot overlap. The phase does not include CA deletion, per-CA analysis, scheduled refresh,
trading, AI Markdown analysis, Negative Wallets, or a wallet metadata editor.

## Source contract

Only the existing read-only GMGN CLI adapter is used. It must never receive a private key or invoke
a trading/signing command.

Main remains the only credential/file and process owner. The API key is accepted through the
existing typed Coin resource IPC, written only to `~/.config/gmgn/.env` with owner-only permissions,
never stored in Trench SQLite, and cleared from visible input state after each save attempt. Status
responses expose only booleans, bounded CLI identity, timestamps, and typed probe codes; they never
expose the key, CLI stdout/stderr, or environment values. `Save and verify` first completes the
atomic credential write and then runs the existing bounded read-only probe. A failed probe keeps the
dialog open with an actionable typed result and does not start or retry an INDEX run automatically.

Desktop launches may have a smaller `PATH` than an interactive shell. Executable discovery checks
the sanitized current `PATH` plus the exact user Yarn global binary directory `~/.yarn/bin`,
deduplicates candidates, and still requires a real executable file. Native executables run
directly. An exact `~/.yarn/bin/gmgn-cli` `#!/usr/bin/env node` launcher is accepted only when its
real path equals the `gmgn-cli` package's declared bin entry under a fixed Yarn global package
root; Main then runs that verified entry with the packaged Electron runtime in Node mode. The
fixed bootstrap clears only the child runtime's `process.execArgv`, sets
`process.defaultApp = true`, and imports the already verified entry before its user arguments are
parsed. This is required because Commander otherwise treats the entry path itself as an Electron
eval user command; `--version` alone does not expose that failure. The sanitized child `PATH` stays
unchanged, and the adapter never adds a user Node directory, hands an
arbitrary script to Electron, executes a login shell, accepts a renderer-supplied path, searches
arbitrary directories, or falls back to a trading binary. This makes the documented
`yarn global add gmgn-cli` installation reachable from packaged and debug GUI launches.
On Windows, a `.cmd` launcher is never trusted by filename alone. It must be the exact expected
`LOCALAPPDATA/Yarn/bin/gmgn-cli.cmd` or `APPDATA/npm/gmgn-cli.cmd`, contain only a bounded known
Yarn/npm launcher scaffold, and invoke the real package-declared entry exactly once under the
matching fixed global package root. The exact allowed `node_modules` installation root is
realpathed first and is the containment trust anchor: relocating that parent root as one unit is
allowed, while a `gmgn-cli` package root or entry escaping it is rejected. Package name/bin,
realpath containment, entry existence, and the exact
env-node shebang remain mandatory; a blank, unrelated, extra-command, missing, or cross-root
launcher fails closed. A native `gmgn-cli.exe` remains direct.

For every active target, one run reads:

```text
gmgn-cli token info
  --chain <resolved-chain> --address <canonical-ca> --raw

gmgn-cli token traders
  --chain <resolved-chain> --address <canonical-ca>
  --order-by profit --direction desc --limit 100 --raw
```

`GmgnReadInput` therefore exposes the bounded `orderBy: 'profit'` and `direction: 'desc'` contract
for `token-traders`; relying on the CLI default `amount_percentage` is invalid for INDEX.

The token-trader response must be an object with a bounded `list` array. Every valid source row has
a valid wallet address and finite `profit`; all such rows are preserved as candidate relations for
audit. The normalizer may also retain finite `realized_profit`, `unrealized_profit`, source rank,
and bounded non-identity evidence. Only a row explicitly classified as a user wallet is eligible
for aggregation. AMM/liquidity-pool, exchange/CEX, contract, and unknown rows are retained with an
`eligibility` decision and `exclusion_reason` but cannot enter the materialized INDEX.

Classification uses bounded authoritative GMGN markers. An explicit contract, AMM/LP, or
exchange/CEX marker wins over other fields. `addr_type === 0` with no non-user evidence proves a
user wallet; `addr_type === 2` proves non-user but does not guess whether an otherwise unlabelled
row is an AMM or exchange. Missing or unsupported classification evidence is `unknown` and fails
closed. A duplicate canonical wallet in one target response, an invalid address, a non-finite
profit, an over-limit list, or an unexpected shape fails that target rather than silently
manufacturing a rank.

## Chain resolution

- A decoded 32-byte Base58 address probes `solana` only.
- A 20-byte EVM address probes `bsc` and `robinhood` through `token info`.
- Exactly one provider identity match resolves automatically.
- Zero matches returns `TOKEN_NOT_FOUND`.
- Multiple automatic matches return `CHAIN_AMBIGUOUS`; the visible Add flow is already scoped by
  the selected INDEX menu child and submits that explicit chain. The application never chooses the
  first response silently.

CA uniqueness is `(chain, canonical_address)`. EVM values canonicalize to lowercase. Solana values
preserve the validated Base58 spelling. Adding an already active target does not create a duplicate;
it starts the same full-set reanalysis when the job is idle.

## Token metadata and market cap

The latest successful `token info` supplies `name`, `symbol`, price, supply, and ATH evidence.
Current market cap uses a direct provider field when present; otherwise it is
`price.price * circulating_supply`. Highest market cap follows this ordered evidence policy:

1. a direct provider historical-highest-market-cap value;
2. `ath_price * circulating_supply`, labelled `estimated-ath`;
3. the greatest current-market-cap snapshot observed locally, labelled `observed`;
4. unavailable.

The stored `highest_market_cap_kind` is `provider-ath | estimated-ath | observed | unavailable`.
The UI says `Highest MC`, `Estimated highest`, or `Highest observed` accordingly; it never labels an
estimate as a provider fact. Market caps and P&L are finite SQLite `REAL` analytics values, not
financial-ledger amounts. A failed refresh preserves the target's previous successful metadata and
adds a sanitized current error.

## Shared wallet registry

`trench_wallets` is the only normalized source for a global address, name, avatar, note, and
cross-module metadata. `trench_wallet_chain_accounts` owns chain-specific classification and
presence. INDEX and every future Trench module reference `wallet_account_id`; they do not copy
wallet identity or general metadata into module result tables.

| Field | Contract |
| --- | --- |
| `wallet_id` | UUID primary key used by person membership and chain accounts |
| `address_namespace` + `canonical_address` | unique global identity; namespace is `evm | solana` |
| `address` | canonical display spelling |
| `name` | optional shared display name, max 200 Unicode code points |
| `avatar_url` | optional bounded HTTPS URL; images are not stored as SQLite blobs |
| `note` | optional shared human/agent note, max 2,000 Unicode code points |
| `metadata_json` | canonical bounded JSON object for general, cross-module metadata only |
| `metadata_source` | `manual | gmgn | agent | mixed` |
| timestamps | first seen, last seen, and metadata updated times |

Each `trench_wallet_chain_accounts` row has its own UUID `wallet_account_id`, global `wallet_id`,
chain, `wallet_kind`, classification source/time, and chain first/last-seen instants. It is unique
by `(wallet_id, chain)`. One lowercase 20-byte EVM address therefore has one global wallet and may
have both BSC and Robinhood accounts without collapsing their classification, rank, or profit.

Provider discovery inserts a missing identity and updates `last_seen_at`. Provider enrichment may
fill empty name/avatar/general metadata but never overwrites a populated manual value. Only an
explicit future wallet-metadata operation may edit name, avatar, or note. Module commits cannot
clear or rewrite general metadata.

Provider evidence persisted in an INDEX table must remove wallet address, name, avatar, note,
wallet kind/classification provenance, and other registry-owned fields before canonicalization.
This prevents the same wallet identity or reusable classification from being hidden again inside a
module JSON blob. Module-owned values include source rank, profit, realized/unrealized profit,
eligibility/exclusion reason, INDEX rank, and later module-specific analysis conclusions.

Cross-module address filters join account -> global wallet. Common address/name/note predicates use
structured columns and indexes, not comma-separated metadata or module-local copies. A future tag
filter receives a normalized relation table when required; v1 does not prebuild it.

## Chain-scoped ranking contract

Each target contributes at most 100 provider-ranked candidate relations, including excluded rows
for audit. Only candidates whose joined registry classification is explicitly `user` and whose
run-time eligibility is true are aggregated over the same run and the same chain. A BSC candidate
can never contribute to a Solana wallet aggregate or consume a Solana INDEX rank:

```text
total_profit_usd      = SUM(candidate.profit_usd)
source_ca_count       = COUNT(DISTINCT target_id)
profitable_ca_count   = COUNT(candidate.profit_usd > 0)
best_source_rank      = MIN(candidate.source_rank)
realized_profit_usd   = SUM(known realized_profit_usd)
unrealized_profit_usd = SUM(known unrealized_profit_usd)
```

Within each chain partition, the deterministic order is:

1. `total_profit_usd DESC`;
2. `profitable_ca_count DESC`;
3. `source_ca_count DESC`;
4. `best_source_rank ASC`;
5. joined wallet `canonical_address ASC`.

The first 300 in each chain partition become that chain's materialized INDEX. `chain_rank` is
contiguous and unique within `(run_id, chain)`; rank numbering restarts from `1` for every chain.
If fewer than 100 finite eligible wallets exist for a chain, the UI truthfully shows fewer. This
phase intentionally avoids an opaque composite score. New runs record `profit-sum-v2`; historical
`profit-sum-v1` runs retain their stored metrics while v2 changes only the final per-chain cap from
100 to 300 and keeps every sort/aggregate key unchanged.

## Dedicated encrypted SQLite

The environment-specific database is `userData/trench/trench.db`, independently encrypted and
migrated from Core/Todo/Maestro SQLite. It is opened only by the dedicated hidden `trench-io`
renderer preload using `better-sqlite3-multiple-ciphers`.

The schema family starts with these tables:

| Table | Purpose and required keys |
| --- | --- |
| `trench_schema_migrations` | migration ledger keyed by `version_code` |
| `trench_repository_state` | single row `id=1`, monotonic `revision`, nullable `current_run_id` |
| `trench_index_targets` | target CA and last successful Meta; unique `(chain, canonical_address)` |
| `trench_wallets` | global wallet registry; unique `(address_namespace, canonical_address)` |
| `trench_wallet_chain_accounts` | unique chain presence/classification for `(wallet_id, chain)` |
| `trench_index_runs` | one full-set job with trigger, lifecycle, counts, policy version, error |
| `trench_index_target_snapshots` | one token Meta snapshot per `(run_id, target_id)` |
| `trench_index_wallet_candidates` | one module relation per `(run_id, target_id, wallet_account_id)` with eligibility/exclusion reason and unique source rank |
| `trench_index_wallets` | one materialized result per `(run_id, wallet_account_id)`, carrying explicit `chain` and a unique `(run_id, chain, chain_rank)` |
| `trench_persons` and person relations | active/merged profiles, one-person-to-many-wallet membership, X identity and conflict audit |

All foreign keys are enforced. Candidate and result tables contain `wallet_account_id`, never wallet
address/name/avatar/note. Run, target, wallet, rank, finite numeric, enum, timestamp, string, JSON
depth/size, and count bounds are validated both at the typed boundary and in database constraints
where SQLite can enforce them.

## Hidden process ownership

```text
Visible Trench renderer
  -> typed public Trench XPC
Electron Main
  -> validates commands, owns one analysis queue, invokes read-only GMGN
  -> typed capability-scoped private storage XPC
Hidden `trench-io` renderer preload
  -> owns migration, SQLCipher connection, transactions, queries, recovery, broadcast
```

Main must not import a SQLite driver, execute SQL, or own the Trench database connection. It may
expose narrowly scoped `safeStorage` encryption/decryption and environment-isolated `userData`
capabilities. The hidden runtime owns its encrypted key envelope and database files. It is
`show:false`, skipped from the taskbar, navigation-fenced, popup-denied, capability/instance bound,
and started before the visible Trench read facade becomes ready.

The process identity is exactly `trench-io`. Its complete source lives under
`src/renderer/trench-io/`: a CSP-locked blank `index.html` plus the preload-owned database,
migration, repository, and key-envelope runtime. The HTML body contains no UI or script and the
process is never user-visible.

The preload requires `sandbox:false` for the native SQLite module while retaining
`contextIsolation:true`, `nodeIntegration:false`, `webSecurity:true`, and no renderer page API.
Development and packaged builds have explicit `trench-io` preload and renderer entries. The source
location does not change the execution boundary: native SQLite remains available only in the hidden
renderer's preload context, never the page context or Main.

## Atomic run and recovery

The storage runtime persists a new target before starting the full-set run, so an analysis failure
does not lose the target. It then records `queued -> running`. A successful normalized batch is
committed with one `BEGIN IMMEDIATE` transaction:

1. upsert target snapshots and successful Meta;
2. upsert shared wallet identities without overwriting manual metadata;
3. insert target candidate relations;
4. insert the deterministic Top 300 relations independently for every represented chain;
5. ensure a person membership for every published global user wallet and resolve safe X evidence;
6. mark the run completed;
7. switch `trench_repository_state.current_run_id` and increment `revision`.

Only after commit does the runtime emit a content-free data-changed event. Any target failure marks
the run failed, persists sanitized per-target error state, and leaves `current_run_id` and the prior
INDEX untouched. A `running` row orphaned by process/app exit is marked failed at next boot; it never
becomes current. An empty target set cannot start a run.

## Renderer read and command API

The public renderer contract is discriminated and bounded:

```ts
interface TrenchIndexApi {
  getIndexWorkspace(): Promise<Result<TrenchIndexWorkspaceSnapshot>>;
  addIndexTargets(input: {
    requestId: string;
    targets: Array<{
      contractAddress: string;
      chain?: 'auto' | 'bsc' | 'solana' | 'robinhood';
    }>;
  }): Promise<Result<TrenchIndexCommandReceipt>>;
  reanalyzeIndex(input: { requestId: string }): Promise<Result<TrenchIndexCommandReceipt>>;
}
```

The workspace snapshot returns the revision, current run summary, active job state, and an ordered
array of chain projections. Each projection owns one chain discriminator plus only that chain's
target rows and current INDEX wallet rows already joined with registry metadata. The snapshot never
returns one ambiguous mixed-chain wallet list, SQL, paths, encryption material, unbounded provider
JSON, or legacy Trench documents. Requests and late responses are generation-fenced in the
renderer. Changed events contain only revision and job state.

## Compatibility and migration

- Existing `userData/trench/analyses` and `negative-wallets` JSON bytes are not deleted or rewritten.
- The original 12 `trench.*` MCP tools remain available under the exact configured server name and keep
  their current contract in this phase.
- The visible renderer no longer lists the legacy CA/Index/Negative JSON modules.
- No automatic JSON-to-SQLite import is performed in v1. A later migration must be separately
  bounded, idempotent, and auditable.
- The SQLite release gate becomes a four-family audit and must cover the Trench database in debug,
  packaged, fresh-install, and supported-upgrade checks.

## Acceptance

- The first Arco module reads `INDEX`, its three chain children own scope, and no item displays a
  numeric count.
- Adding one or N supported CAs atomically persists the unique batch and triggers one full-set
  analysis; N targets produce one target list and one global INDEX, not N sequential runs or
  separate visible result modules.
- Every target request asks GMGN for `profit DESC, limit 100`; a test proves the adapter no longer
  relies on `amount_percentage` for INDEX.
- Target rows show name, CA, current market cap and accurately labelled highest/estimated/observed
  market cap when evidence exists.
- Every chain ranking follows the five deterministic sort keys, contains unique
  `wallet_account_id`s and chain-local ranks `1..N`, and never exceeds 300 per chain. Mixed
  BSC/Solana input proves that both
  chains can publish `#01` in the same run without cross-chain competition.
- `trench_wallets` is the only schema table containing wallet address/name/avatar/note; INDEX tables
  use chain-account foreign keys and queries join the global registry.
- Main has no Trench SQLite driver/connection/SQL import. The hidden runtime owns encryption,
  migration, transaction, recovery, and read projection.
- A provider failure, duplicate row, malformed payload, hidden renderer crash, or app restart does
  not replace the last fully successful INDEX.
- The Todo-parity menu bar exposes a keyboard-labelled GMGN settings icon. The dialog can detect a
  CLI installed in `~/.yarn/bin`, configure/replace only `GMGN_API_KEY`, run the bounded read-only
  verification, and recover directly from Add/Reanalyze `PROVIDER_UNAVAILABLE` without losing CA
  input or auto-starting a command.
- Renderer state, logs, IPC receipts, screenshots, and Trench SQLite never contain or return the
  saved GMGN API key; unsuccessful validation remains explicit and retryable.
- Standalone and Omni render the same revision and selected-chain projection; switching SOL/BSC
  changes both columns together, while wide and narrow layouts retain reachable controls and no
  body-level overflow.
- Unit, storage integration, static process-boundary, focused typecheck, and fresh DEBUG_DEV build
  pass without touching the running DEBUG_PROD profile or writing real Trench records to a
  development MCP instance. Ral owns standalone and Omni visual acceptance; no Electron E2E is run
  for the Trenchers delivery.
