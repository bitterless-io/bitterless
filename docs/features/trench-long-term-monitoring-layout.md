# BL Trench Long-term Monitoring layout

Status: implemented by task 028; independent Desktop review and Ral runtime/visual acceptance pending

## Purpose

Long-term Monitoring is the fourth first-level Trench module. It keeps a durable watch on explicit
chain-qualified token contract addresses and surfaces statistically unusual on-chain activity. It
is not a sniper, trading screen, generic RPC console, or a synonym for the legacy in-memory Binance
symbol monitor.

The first product is deliberately narrow: BNB Chain ERC-20 `Transfer` event-count Z-score. A token
CA alone does not identify one market price, pool, quote asset or DEX, so v1 must not label its
metric as price, swap volume, buyer count or PnL. Pool price and GMGN snapshot adapters are later
products with their own source identity and evidence contract.

## Navigation

```text
┌──────────────────────── Trench ───── status · Agent · Refresh · ⚙ ┐
├───────────────┬─────────────────────────────────────────────────────┤
│ ▾ INDEX       │                                                     │
│   SOL         │                                                     │
│   BSC         │                                                     │
│   Robinhood   │                                                     │
│ ▾ Trenchers   │                                                     │
│   All traders │ selected module workspace                           │
│ ▾ Sniping     │                                                     │
│   Products    │                                                     │
│   Activity    │                                                     │
│ ▾ Monitoring  │                                                     │
│   Watches     │                                                     │
│   Anomalies   │                                                     │
└───────────────┴─────────────────────────────────────────────────────┘
```

- `Monitoring` is fourth, after Sniping. It is a distinct module even though its backend reuses the
  reviewed Sniping worker, config revision, runtime and authenticated relay foundations.
- `Watches` owns create/read/update/Start/Stop and current evidence. `Anomalies` owns the paged
  historical anomaly ledger across watches.
- Header Refresh rereads only the selected Monitoring scope. The global gear remains GMGN Settings;
  neither surface exposes provider URLs, credentials or a customer token.
- Navigation selection is local and causes no provider call until Monitoring first becomes active.

## Watches workspace

```text
│ MONITORING / WATCHES                                  [+ Add CA] │
├───────────────────────────┬──────────────────────────────────────┤
│ Search CA or label…       │ PEPE flow                 Monitoring│
│                           │ BSC · eip155:56:0x…                 │
│ ● PEPE flow               │ [Stop] [Edit disabled: stop first] │
│   BSC · Monitoring        ├──────────────────────────────────────┤
│   z +3.42 · HIGH          │ SG active · JP active · MATCH       │
│                           │ Last finalized bucket 17:35–17:40   │
│ ○ GME                     │                                      │
│   Warming 41 / 72         │ TRANSFER EVENT COUNT                 │
│                           │ latest finalized 187 · base 72/288  │
│ △ 0x71…                   │ z-score +3.42 · threshold ±3.00      │
│   Incomplete range        │ [latest 500: count + z-score]       │
│                           │                                      │
│ [Previous] 1 / 8 [Next]  │ Latest anomaly / gap / revision rows │
└───────────────────────────┴──────────────────────────────────────┘
```

### Watch list

- One Watch has one stable config ID plus one exact asset identity in its current revision. Historical
  revisions retain their own frozen asset identity and evidence. V1 asset identity is
  `eip155:56:<lowercase 20-byte address>`; checksum form is display-only. The same 20 bytes on another
  EVM chain is a different asset.
- `Add CA` opens one closed form: chain (BSC, fixed in v1), canonical non-zero CA, optional label and
  Z-score threshold (default `3.0`, server-validated `2.0..10.0`). Singapore and Japan observation
  are fixed requirements, shown read-only as `SG + JP`; the form never accepts provider IDs, URLs or
  credentials. Unsupported chains remain visible as future capability rather than being silently
  coerced to BSC.
- Create sends `expected_revision=0`, shows one in-button busy state, and on success creates Disabled
  revision 1 and selects its detail. A duplicate owned asset keeps the draft, says `Already watched`,
  and offers `Open existing watch`; it never overwrites or merges the existing watch.
- Rows show desired/observed state, baseline readiness, latest finalized bucket and latest Z-score.
  Missing or incomplete evidence is `Unknown`/`Incomplete`, never zero.
- Search and paging are server-owned. The renderer never loads all watches or performs a page-local
  anomaly sort.

### Watch detail

- `Start monitoring` and `Stop monitoring` are narrow revision-checked actions. The backend state
  `armed` is rendered as `Monitoring`; there is no Canary, signer, trade or financial Armed surface.
- Every Start/Stop CAS creates a new config revision. Stop preserves all historical revisions. Start
  opens a new Monitoring revision at `WARMING 0 / 72`; no previous revision can qualify its baseline,
  so the UI states that at least 72 new complete prior buckets are required.
- Edit is visibly disabled while Monitoring with `Stop monitoring before editing`. When Disabled,
  Edit uses the same BSC/CA/optional-label/threshold form and current revision. Changing CA or
  threshold creates a new revision and resets the active baseline to Warming. A stale CAS keeps the
  draft and offers `Reload server version`; it never retries against an unseen revision.
- Runtime shows SG and JP observer state, cursor lag, last finalized bucket, evidence fingerprint
  agreement and bounded failure reason. Region disagreement is `REGION_MISMATCH`, never averaged.
- The chart has aligned UTC five-minute buckets for raw `Transfer` event count and Z-score. A gap is
  visually discontinuous. It must not draw a zero-height point for `INCOMPLETE_RANGE`.
- Tooltip and summary always say `Transfer events`. Mint/burn logs are included in v1, so the value
  is not labelled transfers between traders, swaps, buys, sells, unique users or USD volume.
- Detector states are explicit:
  - `WARMING n / 72`: fewer than 72 complete prior buckets;
  - `READY`: baseline available and no current anomaly;
  - `HIGH|LOW`: `abs(z) >= threshold` for the finalized current bucket;
  - `BASELINE_FLAT`: prior complete buckets have zero standard deviation; no infinite Z-score;
  - `INCOMPLETE_RANGE`: provider range could not be proven complete;
  - `SINGLE_REGION|REGION_MISMATCH`: regional agreement facts, not detector values;
  - `DEGRADED|OFFLINE`: runtime facts, not metric values.
- A revision change resets the baseline to Warming. Previous samples remain historical evidence but
  cannot qualify the new revision.
- Detail exposes the current revision plus at most the latest 500 revision-history entries, matching
  the fixed Private contract and Desktop relay response-size boundary.

### Regional truth composition

Metric state and regional agreement are separate server-owned facts. The renderer applies this
closed presentation precedence without recomputing evidence:

| regional agreement | primary presentation | aggregate count / Z-score |
|---|---|---|
| `MATCHED` | render the paired metric state; only paired `HIGH|LOW` is a confirmed anomaly | server-paired values |
| `SINGLE_REGION` | `Single-region evidence · unconfirmed`; show the available region only inside diagnostics | `Unknown`; never promote its regional HIGH/LOW |
| `REGION_MISMATCH` | `Region mismatch · unconfirmed`; show both bounded regional fingerprints/values in diagnostics | `Unknown`; never average |

`INCOMPLETE_RANGE` has no count or Z-score. A verified `COMPLETE` count of `0` remains visually and
textually distinct from `Unknown`. Runtime `DEGRADED|OFFLINE` may accompany a last verified metric,
which is labelled stale with its exact finalized bucket time rather than replacing the metric state.

## Detector contract shown by the UI

- UTC bucket width is exactly five minutes.
- Baseline is the previous 288 complete buckets (24 hours); the current bucket is excluded.
- At least 72 complete prior buckets are required.
- Z-score uses the raw `transfer_event_count` population mean and standard deviation. When standard
  deviation is zero, state is `BASELINE_FLAT` and `z_score` is absent.
- Default threshold is `3.0`; accepted range and precision are server-owned and displayed next to
  the current value.
- A complete verified bucket containing no matching logs is a real zero. An unverified interval is
  incomplete and never participates in the baseline.
- Samples and anomaly rows include detector version, config revision, asset identity, bucket range,
  block/hash evidence and region agreement. The desktop does not recompute Z-score.

## Anomalies workspace

```text
│ MONITORING / ANOMALIES                                           │
├───────────────────────────────────────────────────────────────────┤
│ [All watches ▼] [State: all exceptions ▼]            [Retry]   │
├──────────┬─────────────────┬───────────┬─────────┬────────────────┤
│ Bucket   │ Watch / CA      │ Metric    │ Z-score │ State / reason │
│ 17:35    │ PEPE flow       │ transfers │ +3.42   │ HIGH           │
│ 14:20    │ GME             │ transfers │ —       │ BASELINE_FLAT  │
│ 11:05    │ 0x71…           │ transfers │ —       │ INCOMPLETE     │
└──────────┴─────────────────┴───────────┴─────────┴────────────────┘
```

- Rows come from one sanitized, customer-scoped server cursor. The filter sends optional exact
  `config_id` for one owned Watch (`All watches` omits it) and optional exact `states` from
  `WARMING`, `BASELINE_FLAT`, `HIGH`, `LOW`, `INCOMPLETE_RANGE`, `REGION_MISMATCH`,
  `SINGLE_REGION`. BSC is fixed and there is no renderer-side reason/address search. Changing either
  filter clears rows and cursor before the replacement request. The result includes anomaly, gap,
  baseline and region-conflict evidence; it is not built by joining renderer state.
- `Load older` follows `next_cursor={bucket_sequence,config_id,config_revision}`, appends only the matching response,
  and becomes `End of retained evidence` when null. It never invents Previous semantics or page-local
  ordering. A failed load preserves verified rows and exposes a retry at the failed cursor.
- Selecting a row opens a bounded detail drawer with raw count, baseline count/mean/stddev, Z-score,
  threshold, detector/config/release identity, bucket/block range and both bounded region
  fingerprints. The row and drawer preserve `SINGLE_REGION`/`REGION_MISMATCH` precedence and never
  present a regional HIGH/LOW as confirmed.
- No raw provider payload, endpoint, token, arbitrary JSON, transaction calldata or secret is
  returned. This module has no trade or profit row.

## States and lifecycle acceptance

| lifecycle | required UI closure |
|---|---|
| create | Add CA validates BSC/CA/optional label/threshold with fixed SG+JP, creates Disabled revision 1, selects it; duplicate offers Open existing |
| read | watch list, detail, latest sample, bounded series, runtimes and anomaly cursor are refreshable independently |
| update | Disabled edit uses current-revision CAS; Monitoring edit is disabled; conflict preserves draft and shows Reload server version |
| deactivate | Stop creates a fresh Disabled revision; history remains visible |
| resume | Start reruns release/dual-region readiness, creates a fresh Monitoring revision and shows WARMING 0 / 72 until at least 72 new complete prior buckets exist |

Loading, empty, offline, conflict and partial-region states retain already verified rows where safe
and label them stale. A failed detail refresh disables edit/Start/Stop but does not erase series or
disable an independent Anomalies retry.

| state | user-visible recovery |
|---|---|
| no Watches | `No watches yet` plus Add CA; no fabricated detail |
| search empty | `No watches match this search` plus Clear search; Add CA remains available |
| no anomaly rows | `No evidence exceptions for this watch and filter`; filters remain editable |
| Core offline | retain last verified rows with `Stale since <time>`; fixed-route Retry only |
| one region absent | show `SINGLE_REGION · unconfirmed`, available-region diagnostic and Retry; no aggregate Z/count |
| region mismatch | show `REGION_MISMATCH · unconfirmed`, both fingerprints and Retry; no average |
| list/detail/series error | keep other independently verified scopes; retry only the failed scope |
| CAS conflict | keep modal draft and offer Reload server version or Cancel |
| mutation busy/fails | lock only the submitted action; on failure restore it and keep the draft/detail |

## Responsive and accessibility

- Desktop uses a 260px minimum watch pane and a flexible detail pane with independent internal
  scrolling.
- Below 920px, Watches is one list/detail surface. Selecting a watch opens detail with a visible
  Back to watches action; every loading/error/empty detail state can return. The initial surface is
  the list unless the user already has a valid selected detail in this session.
- At 800×568 the same list/detail rule applies; switching surfaces does not reset search, pagination
  or selected Watch.
- At 800×282 the entire detail preamble and chart/action content share one reachable vertical scroll;
  fixed siblings cannot consume the short viewport. The app relies on its container height, not a
  686px/720px document height or outer-page scrolling.
- At 398×568, module rail labels remain visible, header actions wrap, filters scroll horizontally,
  and root horizontal overflow remains zero.
- The chart initially requests the latest 500 buckets, at most about 41h40m, and says exactly that;
  it is not labelled a 30-day chart. `Load older` follows `before_bucket_sequence` and may extend the
  loaded evidence up to the 8,640-slot retention bound. It never fills a gap or recomputes a metric.
- Chart is supplemental. Every loaded point/state also has textual count, Z-score/reason and an
  accessible, cursor-paged evidence table. Narrow layouts wrap a row; they never hide the Z-score.
- All structural/repeated elements and controls have stable business names (`monitoring__navigation`,
  `monitoring__watch__row`, `monitoring__watch__back`, `monitoring__watch__edit`,
  `monitoring__anomaly__row`, `monitoring__anomaly__load-older`, and equivalent scoped names).
  Implementation uses Arco menu/table/modal/drawer keyboard semantics, visible `:focus-visible`,
  selected-state ARIA and focus return to the invoking control after modal/drawer close.
- All new visible copy and accessible names use Coin locale keys. Raw backend codes map to localized
  labels without changing truth (`INCOMPLETE_RANGE` may display `Incomplete range`, never `0`).

## Trust boundary

The Coin renderer never opens a WebSocket or invokes GMGN CLI. Main owns only fixed authenticated
Core routes and receives no URL/header/token/provider input from the renderer. The Private
long-running worker owns provider WebSocket connections, bounded HTTP backfill, cursor/finality,
aggregation and detection. GMGN may later provide low-frequency enrichment through a separately
labelled polling adapter; it is never described as the streaming source.
