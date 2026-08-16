# BL Trench module navigation and Trenchers layout

Status: INDEX/Trenchers/Sniping/Long-term Monitoring implemented; Ral runtime and visual acceptance pending

## Design direction

Trench remains a compact Royal Blue research ledger. Arco navigation encodes real ownership rather
than adding dashboard decoration: level one selects a module, level two selects that module's
working scope. The memorable element is the persistent left identity rail joining INDEX chain work
and person research in one map. Existing menu-bar height, palette, data typography, and flat white
surfaces remain unchanged.

## Overall structure

```text
┌──────────────────────── Trench ───── status · Agent · Refresh · ⚙ ┐
├───────────────┬─────────────────────────────────────────────────────┤
│ ▾ INDEX       │ selected module content                             │
│   SOL         │                                                     │
│   BSC         │                                                     │
│   Robinhood   │                                                     │
│               │                                                     │
│ ▾ Trenchers   │                                                     │
│   All traders │                                                     │
│               │                                                     │
│ ▾ Sniping     │                                                     │
│   Products    │                                                     │
│   Activity    │                                                     │
│               │                                                     │
│ ▾ Monitoring  │                                                     │
│   Watches     │                                                     │
│   Anomalies   │                                                     │
└───────────────┴─────────────────────────────────────────────────────┘
```

- Use Arco `a-menu`, `a-sub-menu`, and `a-menu-item`; do not hand-roll menu semantics.
- `INDEX` is first and initially open. Its children are SOL, BSC, Robinhood in that order. Selecting
  a child changes the existing two-column projection without provider calls or storage writes.
- `Trenchers` is second and initially open. Its v1 child is `All traders`.
- Task 026 adds `Sniping` third with `Products` and `Activity`. Products owns catalog/configuration/
  monitor/read-only simulation; Activity owns the sanitized server cursor. It does not add another
  navigation owner or expose financial execution controls.
- Task 028 adds `Monitoring` fourth with `Watches` and `Anomalies`. It owns durable explicit-CA
  observation and statistical evidence, not Sniping triggers or execution. Its first metric is
  finalized BSC ERC-20 Transfer-event count; it never relabels that evidence as price or trades.
- The old INDEX module/chain tab row is removed; there is one chain selection owner.
- Header Refresh rereads whichever module is selected. GMGN Settings remains global.

## INDEX page

```text
│ INDEX / BSC                                                    │
├────────────────────────────────────────────────────────────────┤
│ [＋ Add CA] [↻ Reanalyze all]  Last successful …               │
├───────────────────────────────┬────────────────────────────────┤
│ BSC TARGET CAs               │ BSC INDEX WALLETS              │
│ …                             │ #001 … #300                    │
└───────────────────────────────┴────────────────────────────────┘
```

The current INDEX behavior stays intact except the final wallet projection is at most 300 per
chain and ranks render as `#001..#300`. Each CA still reads only GMGN Top 100 traders.

## Trenchers page

```text
│ Trenchers / All traders                                            │
├────────────────────────────────┬───────────────────────────────────┤
│ Search traders…                │ Person profile             Edit  │
│                                │ Anonymous / resolved name         │
│ 王小二                          │ person note                       │
│ 2 wallets · BSC                │ X @… · profile provenance         │
│ INDEX wallet sum +$2.4M        ├───────────────────────────────────┤
│ note preview…                  │ Wallets                           │
│                                │ BSC  0x…  #007  +$2.0M            │
│ Anonymous                      │ SOL  …     —     —                │
│ 1 wallet · SOL                 │ wallet name/note · link source    │
│ …                              │                                   │
│ [previous] 1 / N [next]        │ [Move existing Trench wallet]     │
└────────────────────────────────┴───────────────────────────────────┘
```

### Person list

- The left pane owns query and cursor pagination; it never loads all 3,000+ people at once.
- Each row shows resolved/Anonymous name, a two-line note preview when present, wallet count, chain
  badges, and current `INDEX wallet sum`. Profit absent is `—`, never zero.
- Default order follows the authoritative cursor: profile update descending, then person ID.
  Current `wallet-sum-v1` profit remains visible on every row but the renderer never performs a
  misleading page-local profit sort. A future global profit leaderboard requires its own
  server-side aggregate cursor projection. Search matches person name/note and joined wallet
  address/name/note.
- Selection is stable by `personId`; refresh preserves it when still present and selects the first
  row otherwise.

### Person detail

- The right pane shows person-level display name, avatar, note, X identity, provenance, and one
  ordered address list.
- Wallet rows show chain, full copyable address, wallet-local name/note, current chain rank and
  wallet profit, link source, and last seen time.
- `Edit profile` opens an Arco modal for display name, HTTPS avatar URL, and note. Blank explicit
  fields clear; Cancel does nothing; stale revision keeps the dialog open with a conflict message.
- `Move existing Trench wallet` searches existing person-linked wallets by chain plus address,
  displays the exact source person/current membership, resolves the selected `walletId`, and uses
  expected-membership CAS. Published user INDEX wallets and imports already have a person. Unknown,
  unattached, non-user, or ambiguous matches are rejected; the action never creates a wallet,
  merges by name, or overwrites wallet metadata.
- `wallet-sum-v1` is labelled as a wallet aggregate. The page never calls it transfer-aware profit.

## States

| State | Left pane | Right pane |
| --- | --- | --- |
| loading | compact rows skeleton | selected profile remains stale-but-visible |
| empty | `No traders yet`; INDEX/import guidance | no fabricated profile |
| error | typed retry surface | prior detail retained where safe |
| conflict | list unchanged | edit/link modal stays open with exact recovery action |
| merged selection | redirect to active survivor | survivor profile and wallets |

## Responsive constraints

- The module rail is 148px on standalone/wide Omni and independently scrolls in low-height cells.
- Below 560px it compacts to 112px while keeping complete text labels; it never becomes an
  unlabeled icon rail.
- INDEX columns keep the existing below-640px stack inside the remaining content width.
- Trenchers uses a 38%/62% split with a 260px left minimum when room permits. Below 720px, selecting
  a person switches the content area from list to detail with a visible Back action; the module rail
  remains present.
- At 398x568 and 800x282, header actions, all module groups, list/detail controls, and internal
  scroll regions remain reachable with no root horizontal overflow.

## Component ownership

```text
App.vue
├─ TrenchHeader
├─ TrenchModuleNavigation        owns selected module/scope
└─ module viewport
   ├─ TrenchIndexWorkspace       receives selected chain
   ├─ TrenchersWorkspace
   │  ├─ TrenchPersonList
   │  └─ TrenchPersonDetail
   └─ SnipingWorkspace           task 026
      ├─ SnipingProductsWorkspace
      └─ SnipingActivityWorkspace
   └─ LongTermMonitoringWorkspace task 028
      ├─ MonitoringWatchesWorkspace
      └─ MonitoringAnomaliesWorkspace
```

Stores own reads, selection, cursor state, and mutations. Vue components bind/render only. All
structural and repeated controls retain stable `name` attributes and business BEM classes.
