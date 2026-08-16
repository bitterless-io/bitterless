# BL Trench INDEX Delivery Analysis

Status: INDEX implemented and independently verified; GMGN configuration reachability implemented,
awaiting independent verification

## Goal decomposition

The first INDEX phase is complete only when all statements are true together:

1. The visible product has one count-free `INDEX` module whose SOL/BSC chain selector changes both
   target-CA and wallet-ranking columns together.
2. Add CA resolves a bounded one-or-N CA batch, atomically persists its unique targets, and starts
   one full-set run; Reanalyze starts the same run for all active targets.
3. Every target reads token Meta and at most 100 top traders explicitly ordered by total profit.
4. Every valid provider row is auditable, while deterministic fail-closed aggregation publishes at
   most 300 explicitly classified user wallets independently per chain.
5. Wallet address and general metadata exist only in global `trench_wallets`; classification lives
   in chain accounts and module tables reference `wallet_account_id`.
6. A dedicated hidden renderer preload owns the encrypted Trench SQLite connection and migrations;
   Main owns orchestration but no SQL.
7. Only a fully successful run replaces the current INDEX; failures and crashes retain the last
   useful snapshot.
8. Existing 12 public `trench.*` MCP tools stay compatible, and old JSON bytes stay untouched.
9. Isolated tests prove storage, source arguments, ranking, runtime boundaries, standalone, and Omni
   without disturbing the running DEBUG_PROD instance.

## Module decomposition

| Module | Inputs | Outputs | Owner |
| --- | --- | --- | --- |
| Shared INDEX contracts | unknown XPC/provider/storage values | bounded typed commands, chain projections, batches, events | shared |
| Source adapter extension | chain, CA, explicit profit order | bounded GMGN token info/trader payloads | Main coin resource |
| INDEX analysis orchestrator | Add/Reanalyze command + active targets | normalized all-target batch or sanitized failure | Main |
| `trench-io` window | lifecycle capability + blank renderer target | ready/restart/unavailable state | Main window service |
| `trench-io` repository | typed private calls + normalized batch | encrypted schema, chain-local ranks, atomic current run | hidden preload |
| Shared wallet registry | normalized discovered identity/metadata | stable wallet IDs and joined display metadata | hidden preload |
| Public INDEX XPC | renderer commands/reads | discriminated snapshot/receipts | Main relay |
| INDEX renderer | chain projections/events/actions | selected-chain two-column standalone/Omni workspace | coin renderer |
| Trench GMGN settings | GMGN-only `window.coin.resources` bridge + guarded existing Coin IPC | menu/dialog status, save/verify, provider-error recovery | Trench preload + coin renderer + Main coin resource |
| Wallet avatar rendering | joined registry HTTPS URL + local wallet identity | remote image when available, deterministic initial on source/CSP/network failure | coin renderer |
| Migration/package gate | fresh/upgrade packaged DB matrix | fourth SQLite-family release proof | scripts/tests/docs |

## Data graph

```text
trench_index_targets
  └─ trench_index_target_snapshots ── run_id ── trench_index_runs
             │                                      │
             └─ trench_index_wallet_candidates ─────┤
                            │ wallet_account_id      │
                            v                        v
             trench_wallet_chain_accounts    trench_index_wallets
                            │                 chain/rank/metrics only
                            v
                     trench_wallets
                     global address/meta once
```

Token CAs are targets, not wallet identities. A wallet's chain/address/name/avatar/note/general
metadata is centralized. A module row represents a relationship or time-varying result and cannot
repeat those fields, including inside a persisted evidence JSON object.

## Command lifecycle

### Add CA

```text
renderer requestId + one-or-N CA items + auto/explicit chain per item
  -> Main validates the complete bounded batch and single-job availability
  -> GMGN token-info chain proof for every item; any failure rejects the batch
  -> hidden storage atomically and idempotently persists unique targets
  -> hidden storage creates one run snapshot from the complete active target list
  -> one full-set run
  -> success: atomic publish / failure: prior current run retained
```

### Reanalyze

```text
renderer requestId
  -> reject empty target set or concurrent job
  -> hidden storage creates running row from exact active target identities
  -> Main sequentially reads info + profit-sorted trader page for each target
  -> normalize, validate, aggregate
  -> hidden storage commits batch and current pointer in one transaction
  -> content-free revision event refreshes every standalone/Omni view
```

GMGN's existing cooldown/serialized read queue remains authoritative. INDEX does not create a
second unbounded process runner. The outer run is also serialized, and all failure messages are
mapped to stable UI codes without exposing stderr, paths, or credentials.

### Configure GMGN

```text
Trench menu gear or PROVIDER_UNAVAILABLE recovery action
  -> renderer loads sanitized CoinResourcesStatus.gmgn
  -> Main discovers native executables from PATH + ~/.yarn/bin
  -> exact Yarn env-node launcher must resolve to gmgn-cli's declared global-package bin
  -> verified Node entry runs via packaged Electron with ELECTRON_RUN_AS_NODE=1
     while the sanitized desktop PATH remains unchanged
  -> optional new API key -> existing typed save IPC -> ~/.config/gmgn/.env (0600)
  -> existing bounded read-only verify IPC
  -> renderer shows exact typed result; key input is cleared
  -> user explicitly retries Add/Reanalyze
```

This is a reachability and GUI-launch discovery task, not a new credential subsystem. The visible
Trench renderer gets no read API for the stored key and no arbitrary executable/path control. Its
sandboxed preload exposes exactly four GMGN methods beneath `window.coin.resources`; the matching
existing Coin IPC channels require a live built/loopback `/coin/index.html` main frame so standalone
and Omni share the boundary without opening it to another renderer. Main registers only this
four-handler subset during foreground startup; it does not activate the dormant legacy Coin IPC
surface or add GMGN methods to the broad Trench XPC handler. The existing Coin resource service
remains the single Main boundary.

## Storage integration enumeration

| Chain | Required proof |
| --- | --- |
| app startup -> hidden `trench-io` | dedicated blank target loads, capability/instance ready handshake completes before public reads |
| hidden crash -> Main | relay detaches, current renderer shows unavailable, bounded restart restores last committed run |
| safeStorage -> hidden preload | runtime key is encrypted/decrypted through a caller-bound capability; plaintext never crosses to visible renderer |
| migration -> DB | fresh schema and supported historical version migrate transactionally and record exact version code |
| Add target -> target table | idempotent unique chain/CA row; no duplicate target |
| provider wallet -> wallet registry | stable unique wallet row, no manual metadata overwrite |
| normalized candidate -> module table | only `wallet_account_id`, per-target/run metrics, and eligibility decision; no wallet identity/metadata/classification copy |
| full batch -> current run | all snapshots/candidates/results and current pointer commit together |
| failed/orphan run -> current run | prior pointer and prior INDEX remain unchanged |
| current snapshot -> visible UI | ordered chain projections keep target Meta and chain-local INDEX rows in one repository revision |
| wallet avatar URL -> visible row | Coin/Trench CSP admits HTTPS images only; remote load failure remains local and renders initials without script fetch/retry |
| Trench settings -> Coin resource IPC | GMGN-only preload surface and Trench-main-frame guard return sanitized status/save/verify receipts from the existing Main-owned service |
| GUI launch -> GMGN executable | deterministic `PATH` plus `~/.yarn/bin` discovery runs native binaries directly; only the fixed, package-declared Yarn env-node entry runs through packaged Electron Node mode, with the minimal desktop `PATH` unchanged and no login shell/user Node-dir injection |
| mutation -> all Trench views | content-free event triggers generation-fenced reread |
| packaging -> native SQLCipher | hidden preload and native module resolve in fresh debug and packaged builds |

## Failure policy

| Failure | Stored effect | Visible effect |
| --- | --- | --- |
| invalid CA batch/item | none | inline Add dialog error; no partial persistence |
| target not found | none | inline not-found error |
| target persisted, source later fails | target remains; failed run/error recorded | target row with error; prior INDEX retained |
| malformed/duplicate trader response | failed run, no candidate/current commit | explicit source-data failure |
| AMM/LP/CEX/contract/unknown trader | auditable candidate relation with exclusion reason | absent from every chain INDEX |
| analysis already running | no second run | disabled controls / stable busy result |
| hidden storage unavailable | no Main fallback SQL or JSON write | local repository unavailable state |
| renderer closes | Main job may finish; hidden storage remains owner | next view reads committed revision |
| app/hidden crash during transaction | SQLite rollback; orphan run repaired failed on boot | last complete INDEX |
| CLI/key/probe unavailable | no INDEX or SQLite mutation | typed settings state plus Configure GMGN recovery; CA input retained |

## Compatibility decisions

- Keep the exact existing public MCP tool list. INDEX Add/Reanalyze is first-party XPC, not a new
  development MCP mutation.
- Keep legacy Trench JSON repository code and bytes reachable by MCP in this phase, but remove the
  legacy three-module renderer navigation.
- Do not import old JSON into the new database automatically. It cannot satisfy the new all-target
  run/policy snapshot contract without an explicit migration decision.
- Reuse the verified GMGN read/process boundary and address identity proof; do not reactivate the
  broad legacy Coin analysis workspace.

## Delivery path

One serial task, [`trench-index-analysis-017`](../tasks/trench-index-analysis-017.md), owns the first
vertical slice because contracts, hidden storage lifecycle, analysis commit, and the visible
projection must agree atomically. Develop implements it on the current branch without switching;
Verify independently audits after implementation and writes a review report.

The chain-separation follow-up is one serial vertical task,
[`trench-index-chain-separation-019`](../tasks/trench-index-chain-separation-019.md). It owns the
schema migration, per-chain rank contract, typed snapshot projection, selector UI, and mixed-chain
storage/Electron acceptance together so the database and visible interpretation cannot diverge.

The resource-reachability follow-up is one serial renderer/Main integration task,
[`trench-gmgn-settings-020`](../tasks/trench-gmgn-settings-020.md). It reuses the existing Coin GMGN
credential/probe bridge, adds deterministic GUI discovery of the documented Yarn global binary,
and connects the Trench menu plus provider-error recovery to one dedicated dialog. It does not
change the INDEX schema, ranking, hidden runtime, or MCP surface.

The real-provider argv regression follow-up is the narrow Main/source task
[`trench-gmgn-electron-argv-021`](../tasks/trench-gmgn-electron-argv-021.md). It corrects the
Commander/Electron interpretation of a verified Yarn Node entry and adds a real provider probe
gate; task 020's synthetic CLI fixture proved process execution but did not reproduce Commander's
Electron/eval auto-detection.

The remote-avatar follow-up is the narrow renderer task
[`trench-remote-avatar-csp-022`](../tasks/trench-remote-avatar-csp-022.md). It admits HTTPS image
loads in the Coin/Trench CSP while keeping every non-image directive locked, and prevents a remote
origin failure from rendering a broken avatar glyph.

## Completion evidence

| Requirement | Evidence |
| --- | --- |
| source order | unit test asserts exact `--order-by profit --direction desc --limit 100` args |
| central wallet registry | migration schema audit plus query/test proving module tables have wallet_account_id and no duplicate metadata columns |
| deterministic top 100 | unit fixtures for duplicates, negative profits, ties, cross-chain identity, fewer-than-100, AMM, LP, CEX, contract, unknown, and user classification |
| atomic current run | hidden repository integration tests for success, target failure, transaction throw, orphan recovery |
| hidden owner | static import graph + runtime process identity; Main contains no SQLite import/SQL |
| encrypted independent DB | isolated runtime test with own path/key/migration ledger |
| UI contract | component/static assertions and standalone/Omni interaction screenshots |
| compatibility | existing MCP schema/tool count and focused Trench MCP tests remain green |
| environment safety | tests use temporary DEBUG_DEV/E2E userData; DEBUG_PROD process/profile untouched |
