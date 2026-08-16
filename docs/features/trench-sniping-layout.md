# BL Trench Sniping workbench layout

Status: Design proposed for owner review

## Design principles

Sniping is a first-level Trench module beside INDEX and Trenchers. The page is an operating console,
not a generic JSON admin screen: a user must always see what signal is watched, what can spend money,
which safety gate is blocking it, and what actually happened.

The visual system keeps Trench Royal Blue (`#4E5882`), 32px menu bar, white ledger surfaces, compact
Arco controls, and monospace addresses/amounts. The first delivery's signature element is the
**evidence rail**: `Signal → Canonical → Request → Exact call → Shadow`. It makes each read-only
decision and failure stage visible without implying that money moved. The later executable delivery
adds `Signal → Match → Risk → Intent → Trade → Receipt` only for a backend release that actually
exposes the verified execution contract.

## Delivery and semantic boundary

- Task 026 delivers catalog/config/runtime, monitor controls, exact/shadow simulation and Activity.
  Canary and financial Armed are explanatory locked stages with no command surface.
- The monitor-only backend stores `desired_state=armed` to mean observation is enabled. The desktop
  must render that state as **Monitoring**, never `Armed`, `Trading`, or a money-moving state. Its
  actions are `Start monitoring` and `Stop monitoring`.
- Task 027 adds Canary, financial Armed, execution controls and receipt reconciliation only after
  the separate backend execution tasks are independently verified. Renderer flags cannot unlock it.

## Overall structure

```text
┌──────────────────────── Trench ─ status · Agent · Refresh · ⚙ ┐
├───────────────┬────────────────────────────────────────────────┤
│ ▾ INDEX       │                                                │
│   SOL         │ selected module workspace                      │
│   BSC         │                                                │
│   Robinhood   │                                                │
│ ▾ Trenchers   │                                                │
│   All traders │                                                │
│ ▾ Sniping     │                                                │
│   Products    │                                                │
│   Activity    │                                                │
└───────────────┴────────────────────────────────────────────────┘
```

- Extend the existing Arco two-level navigation; do not add another top tab row.
- `Products` owns catalog, configured instances, configuration, monitor readiness and simulation.
- `Activity` owns the sanitized cross-product monitor/exact/shadow ledger available from
  `/sniping/activity/list`; it does not imply an execution history before the execution backend.
- Header Refresh reloads the selected Sniping projection. The existing global gear remains the GMGN
  settings entry; Sniping session/API reachability appears in the header status, and selected-config
  runtime facts appear in Products readiness. Neither surface reveals a token, private key, signer
  reference, or RPC URL.

## Products workspace

```text
│ SNIPING / PRODUCTS                                      [+ New product] │
├──────────────────────┬──────────────────────────────────────────────────┤
│ My products          │ Flap · SPCX test                  Monitoring     │
│ Search…              │ Monitor and simulate one exact quote-token config │
│                      │                                                  │
│ ● Flap · SPCX test   │ Monitor ✓ → Simulate ● → Canary 🔒 → Armed 🔒   │
│   Monitoring         ├──────────────────────────────────────────────────┤
│   BSC · 1 SPCX max   │ Signal ─ Canonical ─ Request ─ Exact call ─ Shadow│
│ ○ Flap · GME         │ [Configuration] [Simulation] [Versions]          │
│   Disabled · invalid │                                                  │
│                      │                                                  │
│                      │ Signal                                           │
│                      │ Chain BSC          Release flap-quote…@1.0.0    │
│                      │ Quote token [SPCX] [0x…]                         │
│ Catalog              │ Trigger finality [Finalized ▼]                   │
│  Flap quote          │ Monitor policy                                   │
│                      │ Entry                                            │
│ Roadmap              │ Spend [1] SPCX     Slippage [500 bps]           │
│  Launch/migration    │ Max gas units / max gas cost                    │
│  Wallet copy         │                                                  │
│  Twitter CA [blocked]│ Limits                                           │
│                      │ Readiness                                         │
│                      │ SG observer ✓  JP observer ✓  RPC ✓              │
│                      │                                                  │
│                      │ [Advanced JSON] [Validate] [Save] [Start monitoring]│
└──────────────────────┴──────────────────────────────────────────────────┘
```

The amounts and addresses in the wireframe are design placeholders, not live defaults. An actual
SPCX or GME contract, simulation amount and limits must be entered and validated by Ral.

### Product list

- `My products` uses paged `config/list` and shows only name, visible desired state, chain, current
  revision/release and updated time. Observed runtime, readiness, spend and health are loaded only
  from selected `config/detail`; the list does not guess or issue one request per row. Search never
  calls a chain provider.
- `Catalog` lists only available compiled releases returned by Core. Planned detector families live
  in a separate static `Roadmap` explanation and never masquerade as a release or configured row.
- Roadmap `Twitter CA` displays `Signal source unavailable`: installed `gmgn-cli 1.5.2` has no
  Twitter event feed and no DeBot/DBot CLI/API source is configured. Twitter profile/social metadata
  is not presented as a signal and the row has no Create/Start action.
- Creating a product starts a disabled draft. No catalog card can auto-arm.
- A configured Flap instance binds exactly one canonical quote-token contract. `Flap · SPCX test`
  and `Flap · GME` are separate instances with separate revisions, limits and evidence. The UI does
  not offer a mixed SPCX/GME allowlist.

### Product detail

- Header: human name, product description, component version, desired state, observed state, and
  exact chain.
- The five-step evidence rail is derived only from projections: Signal from selected runtime,
  Canonical from the selected eligible-event row, Request from the accepted request state, Exact
  call from its attempt/report, and Shadow from its latest request/report. Missing evidence is
  `idle|unknown`; stable timestamps/reasons appear only where the server projects them. The client
  never invents a canonical transition or upgrades a stage from local state.
- `Configuration` uses generated Arco fields for the release's closed JSON Schema. Advanced JSON is
  an alternate editor for the same value, not a second state owner.
- Generated fields honor only the backend's restricted versioned generic UI hints (group/order/
  label/unit and derived/read-only/advanced-only). Unknown hints fail closed. A derived field such
  as atomic spend is display-only and never becomes user JSON: it is stripped from catalog defaults
  and stored-detail values before either editor forms a validate/save payload, then Core derives it
  again from decimal amount and declared decimals. If a schema cannot be rendered by
  the supported generic subset, the UI uses Advanced JSON plus server validation rather than a
  hand-coded product form.
- Secret slots appear only in `Readiness` as labels and configured booleans. They are not editable
  JSON fields and the desktop never receives their references or values.
- `Validate` is read-only. Create/Save draft performs revision CAS only while Disabled. Monitoring
  must be explicitly stopped and the refreshed revision observed before editing or saving; Save
  never silently changes desired state.
- In task 026, Configuration shows only signal, policy, monitor readiness and revision controls.
  Exact reports and shadow cohorts live only in the dedicated `Simulation` tab; Activity rows live
  only in the first-level Sniping `Activity` workspace, not a product-detail tab. One page never
  mixes three independent state owners.
- A monitor-only release maps backend desired `armed` to visible `Monitoring`. It never renders the
  financial execution rail or an enabled Canary/Arm action. Locked stages explain `Execution module
  not installed` rather than suggesting a missing form field can unlock them.
- Lifecycle is not editable JSON. Task 026 exposes only narrow `Start monitoring` and
  `Stop monitoring`; Main translates those to monitor-only backend `armed|disabled`. Renderer never
  receives a generic Armed command. A four-stage qualification rail remains explanatory:
  `Monitor → Simulate → Canary locked → Armed locked`; local state cannot advance it.
- `Simulation` is a first-class tab and report. For a real matched Flap event, the backend builds the
  exact unsigned `swapExactInput` request and evaluates it against a pinned chain state. The report
  shows event/block identity, quote/output token, spend, expected output, minimum output, gas,
  policy decisions, revert/reason code, component/config/schema identity, Portal address/fingerprint
  and expiry. It never
  signs, broadcasts, changes allowance or spends funds.
- The event picker reads only `/sniping/simulation/event/list` for the selected config. It shows the
  backend-projected canonical key, token/quote, block and times; Activity rows and renderer-side
  event/intent joins are never treated as eligibility evidence.
- Exact-call reports use a finalized canonical block hash, the real public sender and no override.
  There is no counterfactual/latest/fallback UI; historical-state failure stays Blocked.
- The same tab has an explicitly requested `Shadow run` cohort view. Each bounded request applies
  the real detector, policy and request builder to reconciled SPCX events, showing match count,
  first-action latency,
  executable/blocked/unknown/duplicate rates and bounded later virtual valuations. Every row is
  labelled Simulated; missing history is Unknown, never zero, and no metric auto-advances a stage.
- Before `Start shadow run`, the owner supplies bounded `max_events`, ordered unique
  `checkpoint_blocks`, and `evidence_ttl_seconds`; no UI default is silently submitted. One user
  action gets one request id. Uncertain network retries reuse it until a terminal response or input
  change; a deliberate new run creates a new id.
- Those three shadow inputs are separate controls with their server bounds. The request id is shown
  read-only after submission; Retry reuses it only while the canonical inputs are unchanged, while
  `New shadow run` clears it and requests a new id. Config, exact and shadow lists each show their
  own page controls; Activity alone exposes `Load more` from its opaque cursor.
- Any edit to trigger, amount, slippage, gas, risk policy, Portal, component/schema/executor build or
  quote token invalidates the applicable simulation evidence. A quote-token change also forces fresh
  code/decimals/balance/allowance/quote checks.

## Full qualification and simulation (task 027)

Task 026 implements only Monitor and Simulate. The Canary and Armed rows below document the later
execution extension and are shown as locked explanatory stages until task 027.

| stage | money movement | server-enforced exit condition | primary UI action |
|---|---:|---|---|
| Observe | none | one or more canonical Flap events persisted/reconciled | `Advance to simulation` |
| Simulate | none | exact-request reports plus owner-approved bounded shadow cohort criteria pass | `Run / review shadow simulation` |
| Canary | one minimum-amount action | one confirmed receipt, expected balance delta, bounded spend/gas, no duplicate or ambiguity | `Start one canary` |
| Armed | bounded automatic actions | valid qualification plus current readiness and all configured limits | `Arm product` |

SPCX can qualify the exact component/executor/calldata build before GME is used. That evidence does
not prove GME token behavior: the separate GME instance must re-check contract code, decimals,
balance, allowance/permit, quote and exact transaction simulation. A failed, reverted, ambiguous,
duplicate, unreconciled or expired Canary never grants qualification.

## Canary confirmation (task 027 only)

```text
┌──────────────────── Start Flap · SPCX test canary ───────────────┐
│ This submits exactly one real transaction and does not arm loops.│
│                                                                  │
│ Trigger      One reconciled BSC Flap launch with exact SPCX quote│
│ Spend        Owner-entered minimum SPCX amount                    │
│ Limits       Exactly 1 successful action · short expiry           │
│ Price guard  5.00% max slippage · configured gas ceiling         │
│ Simulation   Fresh · exact config/build/Portal/block evidence     │
│ Authority    Singapore active · Tokyo standby · signer configured│
│                                                                  │
│ [ ] I reviewed this real minimum-amount one-action transaction.   │
│                                      [Cancel] [Start one canary]  │
└──────────────────────────────────────────────────────────────────┘
```

- Focus moves to the dialog title, then the acknowledgement checkbox.
- The final action uses `Start one canary` consistently. A successful receipt moves the instance to
  `Canary qualified`; it does not change desired state to Armed.
- Closing/canceling makes no change. A stale revision keeps the dialog open and reloads the changed
  summary before another confirmation.
- Disarm is one direct revision-checked action and remains available while providers are offline.
- Normal `Arm product` has a separate confirmation after qualification and summarizes maximum
  automatic exposure, finality, expiry, active/standby authority and kill-switch availability.

## Activity workspace

```text
│ SNIPING / ACTIVITY                                                  │
├─────────────────────────────────────────────────────────────────────┤
│ [All sources ▼] [All outcomes ▼] [BSC ▼] [Search token / reason] │
├──────────┬──────────────────┬──────────┬──────────┬────────┬────────┤
│ Time     │ Product / token  │ Source   │ Outcome  │ Reason          │
│ 17:42:08 │ Flap · SPCX test │ exact    │ blocked  │ CONFIG_FINGERPRINT_CHANGED │
│ 17:41:22 │ Flap · GME       │ monitor  │ hit      │ FLAP_LAUNCH_MATCH          │
│ 17:39:10 │ Flap · SPCX test │ shadow   │ unknown  │ SIMULATION_HISTORICAL_STATE_UNKNOWN │
└──────────┴──────────────────┴──────────┴──────────┴────────┴────────┘
```

- Table rows use stable outcomes and reason codes; human explanation is secondary.
- Rows come only from the authenticated, customer-scoped `/sniping/activity/list` cursor projection,
  which combines sanitized monitor intents and exact/shadow attempts. The renderer never joins raw
  event/config tables or performs page-local reordering.
- Configuration and exact/shadow histories use independent 1-based `page/page_size` state. Activity
  uses only its server `next_cursor`; any source/outcome/chain/search change clears that cursor.
  Activity `product` is displayed as Source (`Monitor|Exact|Shadow`), and no page is locally sorted.
- Task 026 has no submitted transaction row or hash. Task 027 may add a sanitized hash link only
  after the execution API exists. No raw calldata, signed payload, provider body, secret reference,
  or full config is shown.
- Selecting a row opens a right drawer showing only fields in that sanitized list row: product,
  config/release identity, canonical event key, token/quote, outcome/reason, attempt state and
  request fingerprint when present. Task 026 has no Activity-detail endpoint, so it does not invent
  an execution timeline, policy body, transaction/receipt status, or renderer-side table joins.
- Profit is shown only when a documented cost/proceeds projection exists; pending or unknown is `—`,
  never zero.
- `Versions` in task 026 shows only the current catalog release and current config/report identities.
  Historical revisions are not listed until a server endpoint explicitly projects them.

## Product capability catalog

| product family | UI availability |
|---|---|
| Flap quote-token simulation | first owned product; one configurable quote token per instance, with separate SPCX and GME monitoring/simulation |
| known-token auto sniper | Roadmap only: planned CA watch until exact trading/liquidity-open condition |
| launch/graduation/migration | Roadmap only: planned component |
| GMGN market signal | Roadmap only: planned where `gmgn-cli market signal` supplies the source |
| single-wallet / KOL / smart-money copy | Roadmap only: planned where chain or GMGN tracking supplies source |
| multi-wallet consensus | Roadmap only: planned chain detector |
| price/market-cap threshold | Roadmap only: planned entry/exit component |
| TP/SL/trailing/expiry/dev-sell | Roadmap only: planned reusable exit policies |
| Twitter/X CA | blocked and non-armable until a callable official event feed exists |

## States

| state | product list | detail/action |
|---|---|---|
| loading | compact skeletons | prior selected detail remains stale-labelled |
| empty | `No products yet` + `New product` | catalog explanation, no fabricated instance |
| invalid draft | row marked Draft | field errors + exact JSON pointer; Save/Arm disabled |
| backend offline | existing rows retained | controls disabled except local navigation; reconnect action |
| not ready | desired Disabled | readiness rows identify missing region/provider/finality/config evidence |
| observing | desired Disabled | canonical events and reconciliation visible; no transaction construction |
| simulating | desired Disabled | exact unsigned request/report visible; sign/broadcast surfaces absent |
| monitoring (monitor-only release) | backend desired `armed` | visible label is `Monitoring`; Start/Stop monitoring only; Canary/financial Armed locked |
| canary ready (task 027) | desired Disabled | one owner-confirmed minimum-amount action available |
| canary qualified (task 027) | desired Disabled | evidence/version/expiry visible; Arm may still be blocked by token-specific readiness |
| armed/active (task 027) | green health dot | Disarm visible; config edits create a new disabled revision |
| paused/expired | amber state | stable cause + revision-checked Resume after correction |
| error | red state | last safe config retained; retry/reconcile action is explicit |
| source unavailable | catalog row muted | explanation only; no Create/Arm action |

## Responsive and size constraints

- The module rail is 148px wide and becomes the existing 112px complete-text compact rail only below
  560px; it never changes at the 1120px product-layout breakpoint.
- Above 920px, Products uses a 260px instance/catalog pane plus detail. Below 920px, selection moves
  from product list to detail with a visible Back action. The pane is hidden only in detail state;
  list state hides the workspace instead, so the media query alone never traps navigation.
- At 398px width, the module rail remains; product detail is one column. The evidence rail becomes
  a vertical five-step list, labels never collapse to unlabeled dots, and actions wrap in priority
  order: Stop/Start monitoring, Save, Validate, Advanced JSON.
- At 800x282, the below-920 list/detail switch is active: rail, current list **or** detail, and modal
  body own independent vertical scroll. The root has no horizontal scroll and Back/primary actions
  remain reachable.
- Addresses may middle-elide visually but Copy always uses the exact canonical value. Amounts keep
  the token unit next to the value.

## Design acceptance closure

Acceptance object: design closure for Sniping configurations and their read-only simulation
evidence, managed by Ral from `Trench → Sniping`. The successful task-026 terminal state is a saved
Disabled or Monitoring config with inspectable exact/shadow evidence; it is never a financial Arm.

| operation | user path | system behavior | design status |
|---|---|---|---|
| create config | Available catalog release → New product → Validate → Save | creates a Disabled revision; duplicate name/schema/config errors remain actionable | Complete |
| read config | paged/searchable Products list → stable detail | list, detail, runtimes and current pinned identities use separate server projections | Complete |
| update config | Stop monitoring if needed → edit generated/JSON draft → Validate → CAS Save | stale revision keeps draft and reloads server facts; derived fields are server-owned | Complete |
| retire config | Stop monitoring | Disabled is the v1 lifecycle substitute; configs/evidence remain auditable because no archive API exists | N/A, justified |
| create evidence | select eligible event → exact request, or enter three shadow bounds → shadow request | stable request id replays identical input and conflicts on changed input | Complete |
| read evidence | independent exact/shadow pagers; Activity cursor | reports/positions remain immutable, sanitized and explicitly Simulated | Complete |
| update/delete evidence | none | append-only audit evidence is never edited or deleted by task 026 | N/A, justified |

Implementation closure additionally requires task 013 to pass independent Verify and task 026's
typed bridge/store/components to pass focused checks plus Ral's manual runtime/visual acceptance.

## Component tree and ownership

```text
App.vue
├─ TrenchHeader
├─ TrenchModuleNavigation
└─ SnipingWorkspace
   ├─ SnipingProductPane
   │  ├─ SnipingInstanceList
   │  └─ SnipingCatalogList
   ├─ SnipingProductDetail
   │  ├─ SnipingEvidenceRail
   │  ├─ SnipingGeneratedConfigForm
   │  ├─ SnipingAdvancedJsonEditor
   │  └─ SnipingReadiness
   ├─ SnipingActivityTable
   ├─ SnipingActivityDrawer
   └─ locked execution explanation (task 026)
```

Task 027 adds `SnipingExecutionRail`, `SnipingCanaryDialog` and `SnipingArmDialog` only after the
typed execution contract exists.

One reactive store owns catalog/config/runtime/activity reads, current product, revision, generated
form/JSON reconciliation, validation, and commands. Vue components bind/render only. All structural
and repeated controls use stable `name` attributes and shallow business BEM classes.

## Entry and verification boundary

The desktop calls Bitterless Private only through a Main-owned memory-only authenticated relay.
Home keeps the existing authenticated-session token and sends it only over a direct IPC accepted
from its live built/loopback main frame. That IPC activates the relay with `{coreToken, sessionId}`;
clear uses the captured `sessionId`, so a stale logout cannot clear a replacement session. Main owns
`{token, sessionId, generation, AbortController}`; replacement, logout, customer change, current-
generation 401, auth invalidation and quit abort and clear it. Coin preload exposes only the fourteen
fixed typed methods listed by task 026, while Main owns every route/header. The Coin renderer cannot
provide a URL/header/token/session id and receives typed sanitized results, never the customer JWT or
secret references.

The Coin bridge inventory is exact: `listComponents`, `listConfigs`, `getConfig`,
`validateConfig`, `saveConfig`, `startMonitoring`, `stopMonitoring`, `listRuntimes`,
`listSimulationEvents`, `requestExactSimulation`, `listExactSimulations`,
`requestShadowSimulation`, `listShadowSimulations`, and `listActivity`. It does not expose
`executionList`, generic desired-state mutation, arbitrary URL/request, Activity detail/history,
Canary, Arm, signer, or trade methods.
Implementation verification is focused unit/type/static/build plus independent review. Per Ral,
automated Electron/browser E2E and screenshot acceptance are not run; Ral performs runtime and
visual acceptance.
