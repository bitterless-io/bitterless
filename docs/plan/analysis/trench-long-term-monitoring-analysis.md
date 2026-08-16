# BL Trench Long-term Monitoring delivery analysis

## Request and decision

Ral requested a fourth first-level Trench module where explicit CAs can stay under long-term watch
and unusual changes such as a sudden Z-score move are visible. The selected architecture is a
customer-scoped desktop projection over the existing Bitterless Private long-running observer—not a
renderer socket, cron inside Electron, or a loop around `gmgn-cli`.

## GMGN capability audit — 2026-08-14

Local `gmgn-cli` is `1.5.2`; registry latest was independently checked as `1.5.6`. The current
published package has only `commander`, `dotenv`, `socks` and `undici` runtime dependencies. Its
market/token/track commands perform one REST `fetch`, parse one JSON response, print and exit. The
published source contains no WebSocket, EventSource, SSE, subscribe/watch/daemon command, stream
reader, heartbeat, interval loop or reconnect implementation.

Official documentation calls data “live on every query”. One `market hot-searches` response field
is named `version` and described as something to persist for WebSocket reconnect; this proves an
upstream subscription concept, not a usable CLI contract. The CLI exposes no endpoint, auth,
subscription request or reconnect consumer for that field.

Primary evidence:

- <https://github.com/GMGNAI/gmgn-skills/blob/v1.5.4/src/client/OpenApiClient.ts>
- <https://github.com/GMGNAI/gmgn-skills/blob/v1.5.4/src/commands/market.ts>
- <https://github.com/GMGNAI/gmgn-skills/blob/v1.5.4/src/commands/track.ts>
- <https://github.com/GMGNAI/gmgn-skills/blob/v1.5.4/Readme.md>
- <https://github.com/GMGNAI/gmgn-skills/blob/v1.5.4/skills/gmgn-market/SKILL.md>

Therefore:

- GMGN CLI is eligible only for bounded, explicitly labelled snapshot polling/enrichment.
- It cannot be the low-latency or completeness authority.
- A future official GMGN WS/SSE adapter requires published endpoint, authentication, subscription,
  cursor and reconnect contracts; the undocumented `version` field is insufficient.

## Why Private owns the stream

The verified Private `apps/sniper` runtime already owns the necessary correctness pattern:

```text
WebSocket signal → bounded buffer
                   ↓
persisted cursor → finalized-head snapshot → HTTP log-range backfill
                   ↓
chunk-end canonical hash → cursor commit → buffered signal drain
```

The socket is the fast path, not the ledger. A disconnect, silent subscription or process restart
must recover by bounded range reads. SG and JP may observe in parallel; deterministic fingerprints
must converge at persistence rather than being averaged in the desktop.

Core remains the authenticated control/read plane. Electron receives only sanitized projections
through fixed Main routes and its current memory-only customer session.

## Why v1 measures Transfer count, not price

A CA alone cannot determine:

- which pool or DEX is authoritative;
- base/quote orientation and token decimals;
- whether to aggregate multiple pools and how to reject manipulated/illiquid pools;
- the exact historical price source and outage semantics.

Calling an arbitrary snapshot “the token price” would be misleading. ERC-20 `Transfer` logs,
however, have one exact emitter/topic/value contract and can be completely recovered by block range.
V1 therefore computes only finalized five-minute `transfer_event_count` buckets. Volume atomic and
active-address aggregates may be retained as diagnostic fields but do not become v1 anomaly metrics.

Price is a later product requiring explicit pool/source identity. GMGN price/K-line can be a polling
source with rate limiting and cursor overlap, never a WebSocket claim.

## Asset and detector decisions

```text
asset_key = eip155:<numeric-chain-id>:<canonical-lowercase-address>
```

- V1 chain is BSC (`eip155:56`). Same address bytes on another chain are a different asset.
- One watch/config owns one CA. The worker multiplexes active watches into provider subscription
  shards; the UI does not make one renderer connection per CA.
- Bucket width is fixed at five UTC minutes.
- Baseline is the previous 288 complete buckets; current bucket is excluded.
- Minimum baseline is 72 complete buckets.
- Complete zero-event bucket is zero. Unverified range is `INCOMPLETE`, excluded from baseline.
- Population standard deviation zero yields `BASELINE_FLAT` and no numeric Z-score.
- Default anomaly threshold is absolute Z-score 3.0.
- Revision changes reset the active baseline; detector version and evidence fingerprint are stored.

## Data boundary

High-frequency transfer logs do not enter the existing launch-event transition ledger. Private task
010 adds a bounded per-region metric-slot ring and a sanitized anomaly projection while reusing
Sniping config/revision/runtime/release ownership. It also generalizes the EVM provider and runner
factory without changing the immutable Flap release behavior.

Desktop task 028 begins only after Private task 010 independently passes. It adds fixed Long-term
Monitoring methods and does not turn the existing Sniping relay into an arbitrary request channel.

## Desktop truth and interaction decisions

- SG and JP are fixed v1 observers. The form never asks a customer to choose provider IDs or weaken
  dual-region evidence.
- Only a server-paired `MATCHED` bucket can display confirmed HIGH/LOW. `SINGLE_REGION` and
  `REGION_MISMATCH` are primary unconfirmed states with no aggregate count or Z-score.
- The chart opens with the latest 500 buckets (at most about 41h40m). A user may explicitly Load
  older through the bounded sample cursor; 30-day retention is not misrepresented as an already
  loaded 30-day chart.
- Start and Stop both advance config revision. Stop leaves prior evidence readable; every later Start
  is a new detector baseline and begins `WARMING 0 / 72` rather than reusing old-revision buckets.
- Anomalies is a cross-watch ledger. Its only filters are optional owned `config_id` and exact state
  codes. BSC is fixed; address/reason search is not invented in the renderer.
- Below 920px Watches is an explicit list/detail state machine with Back. Both 800×568 and the
  800×282 Omni cell keep actions, evidence and recovery within the app's internal scroll ownership.

## Delivery sequence

1. Private task 010: contract/schema and immutable `erc20-transfer-activity-monitor` release.
2. General EVM log coordinator/provider calls, address sharding and Flap regression proof.
3. Finalized bucket aggregation, Z-score detector, bounded persistence and SG/JP convergence.
4. Customer-scoped monitor list/detail/save/lifecycle/sample/anomaly API.
5. Desktop task 028: fourth navigation module, fixed bridge and Watches/Anomalies UI.

Automated Electron E2E and screenshots are intentionally excluded; Ral performs runtime acceptance.
