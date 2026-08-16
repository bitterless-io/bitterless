# BL Trench Record Vault Layout

Status: Superseded below the already-delivered Todo-parity menu bar by
[`trench-index-layout.md`](trench-index-layout.md)

## Visual direction

Trench is a dense research evidence vault, not a trading dashboard or a JSON file previewer. It
keeps the existing Royal Blue system, flat white/utility surfaces, restrained borders, compact
Arco controls, and monospace identities. It adds no gradients, score cards, KPI strip, decorative
chart, or new palette.

The main visual signature is a continuous document canvas: a quiet module bar, a bounded record
index on the left, and one legible evidence document on the right.

## Desktop and wide Omni layout

```text
┌────────────────────────────── BL Trench ───────────────────────────────────┐
│ Trench                               ● synced locally · agent · refresh     │
├─────────────────────────────────────────────────────────────────────────────┤
│ [ CA Records ] [ Index Wallets ] [ Negative Wallets ]                     │
├───────────────────────────┬─────────────────────────────────────────────────┤
│ Search records…           │ CA / wallet identity          generated time   │
│                           │ source / matched chains / schema  [Copy exact]  │
│ selected record           ├─────────────────────────────────────────────────┤
│ chain · symbol · time     │ BSC · TOKEN IDENTITY                            │
│                           │ Analysis result                                  │
│ next record               │ Top profit wallets                              │
│ chain · symbol · time     │ Index exposure · Negative exposure              │
│                           │ ROBINHOOD · TOKEN IDENTITY                       │
│ empty/error/loading row   │ structured evidence sections                    │
└───────────────────────────┴─────────────────────────────────────────────────┘
```

- Header/menu bar: the same 32px Royal Blue shell as Todo in every host, with `#4e5882`
  background, `#3d4666` bottom border, 12px horizontal padding, a 13px semibold near-white title,
  and a right-aligned action group using 28px icon buttons with 8px gaps. Standalone macOS keeps
  78px left traffic-light clearance; Omni uses 12px padding and removes the drag region.
- Header identity is the single `Trench` title. The old `BL` mark and `local record vault` subtitle
  are removed so the information hierarchy and baseline match Todo. The live local/loading/error
  status remains Trench's one domain-specific signature, grouped with the right-side actions; its
  text yields at narrow widths before either required action clips.
- Header Agent and Refresh actions are icon-only buttons with the same near-white, hover, tooltip,
  and focus treatment as Todo. Agent opens the current instance's Trench skill/MCP setup guide;
  Refresh preserves its existing repository reload behavior and disabled/loading semantics.
- Module bar: one semantic navigation row, keyboard roving focus, active underline/background.
- Left pane: 288px default, 240–360px bounded; its own vertical scroll.
- Right pane: flexible, `min-width: 0`; metadata stays compact and one continuous structured
  evidence document owns scrolling.
- Search matches CA/wallet address, symbol/name, chain, explanation, and source CA.
- Long addresses truncate only in list rows; detail identities preserve the full value and exact
  document actions copy the canonical source bytes without showing raw JSON as the primary view.

## Module-specific detail

### CA Records

The left pane lists one row per active CA file, newest first. The right pane first shows envelope
identity and provenance, then one section per chain in canonical order. Each chain section renders
token identity, structured result fields, Top Profit Wallets, Index Wallet Exposure, and Negative
Wallet Exposure as named components. Multi-chain EVM records show both chain sections without
splitting the history row.

Known domain fields use labels, tables, and semantic status text. Flexible `result` and `evidence`
objects use a generic structured value view: object keys become rows, arrays become indexed lists,
nested containers are expandable on demand, long strings are initially shortened, and large
containers reveal bounded chunks. It never substitutes `JSON.stringify(...)` as the visible
preview. Empty arrays/objects display a truthful empty value.

### Index Wallets

The left pane is a unique `{chain,address}` dictionary with source count and best observed rank.
The right pane pages bounded source-CA rank/profit/win-rate/hash summaries and any exposure
measurements already present in those CA records. Opening a source CA reveals the same structured CA
detail used by CA Records; Index detail never duplicates unbounded evidence. There is no positive-tag
edit action.

### Negative Wallets

The left pane shows chain, address, and the first line of the human explanation. The right pane keeps
the human explanation and tag provenance visually separate from the independently generated
holdings snapshot. Holdings render as asset rows followed by structured result/evidence fields.
Missing holdings is a truthful empty state, not zero holdings.

## Exact-document actions

Every persisted document retains a compact `Copy exact JSON` action near its structured section:
one action for a CA analysis, and separate actions for a Negative tag and holdings snapshot. The
action writes the repository-returned `document` string directly and reports success/failure inline.
The raw document is not rendered as the normal preview. Repository/MCP tests, not a second visual
representation, prove that the copied bytes produce the displayed content hash.

## Responsive behavior

| Available content size | Contract                                                                                                    |
| ---------------------- | ----------------------------------------------------------------------------------------------------------- |
| width >= 760px         | list and detail remain side by side                                                                         |
| width 480–759px        | left pane narrows to 220px; metadata and evidence tables wrap or scroll only inside their section           |
| width < 480px          | list and detail become mutually exclusive views; selecting a row opens detail with an explicit Back control |
| height < 360px         | header remains 32px and module row compacts; content keeps independent vertical scroll and actions reachable |

`html`, `body`, `#app`, and the embedded Trench root use `min-width: 0; min-height: 0`. Only the native
standalone `BrowserWindow` retains the platform 800×600 minimum. No layout state relies on hover.

## Interaction and state variants

| State                  | Presentation                                                                                    |
| ---------------------- | ----------------------------------------------------------------------------------------------- |
| Loading                | stable list/detail skeletons; old valid data may remain visibly marked as refreshing            |
| Empty module           | concise explanation that an agent writes records through Bitterless MCP                         |
| No search match        | query-preserving no-results row                                                                 |
| Selected               | one high-contrast list marker and matching detail identity                                      |
| Invalid stored file    | quarantined/error row with safe filename key and validation message; never partial JSON         |
| Repository unavailable | persistent error banner and Retry; no sample fallback                                           |
| MCP update             | live refresh preserves selection when identity remains; otherwise selects the first current row |
| Exact-document copy    | copies the exact canonical selected document and reports success/failure inline                 |
| Agent guide loading    | modal opens with a bounded loading state while Main resolves current-instance setup              |
| Agent guide invalid    | explicit restart-required error and Retry; no guessed helper or skill path                      |

## Agent setup guide

The setup surface reuses the project's proven Arco modal proportions and Royal Blue controls. Its
numbered rail encodes a real installation sequence rather than decoration.

```text
┌────────────── Agent Trench access ──────────────┐
│ LOCAL MCP                                      ×│
├─────────────────────────────────────────────────┤
│ [test-instance warning when applicable]         │
│ Complete setup instructions                [⧉] │
│ Copies MCP + skill + restart instructions.      │
│                                                 │
│ ① CONNECT MCP                                  │
│    Helper path                            [⧉] │
│    ┌─────────────────────────────────────────┐  │
│    │ current profile helper                  │  │
│    └─────────────────────────────────────────┘  │
│    MCP config                             [⧉] │
│                                                 │
│ ② INSTALL BITTERLESS-TRENCH                    │
│    Bundled skill folder                    [⧉] │
│    Codex / Claude Code destinations             │
│                                                 │
│ ③ RESTART AND VERIFY                           │
│    New session · 13 trench.* tools · invocation │
└─────────────────────────────────────────────────┘
```

- The modal uses one native Arco close action; Escape and overlay close work normally.
- The body owns vertical scrolling and remains usable in standalone 800×600 and Omni 398×568 /
  800×282 cells. Code blocks wrap/scroll internally without widening the document body.
- Every icon-only copy action has a localized tooltip/accessible label and reports success/failure.
- The guide is local instructional UI only: opening/copying it does not mutate Trench records,
  acknowledge installation, call a provider, or access Keychain/safeStorage.

## Component boundary

```text
TrenchApp
├─ TrenchHeader                  Todo-aligned 32px host-aware menu bar
│  └─ TrenchAgentGuide trigger   current-instance skill/MCP setup
├─ TrenchAgentGuideModal
│  └─ trenchAgentGuide.store     load/copy/error state
├─ TrenchModuleBar               CA / Index / Negative
└─ TrenchRecordWorkspace
   ├─ TrenchRecordList           module-specific search + rows
   └─ TrenchRecordDetail
      ├─ TrenchRecordMeta
      ├─ TrenchAnalysisDetail    per-chain result/wallet/exposure sections
      ├─ TrenchIndexDetail       paged source evidence
      ├─ TrenchNegativeDetail    explanation/tag/holdings sections
      ├─ TrenchStructuredValue   bounded flexible JSON-value renderer
      └─ TrenchDocumentAction    copy exact canonical document

trenchVault.store.ts
├─ module/search/selection state
├─ XPC list/get orchestration
├─ data-changed refresh fencing
└─ no analysis, provider, clipboard, AI, or browser method
```

## Accessibility and automation

- Module controls use buttons/tabs with visible focus, selected state, and localized accessible names.
- List rows are keyboard selectable and expose full identity through accessible text/title.
- Tables, disclosures, lists, and status text use native semantics; color is not the only
  schema/error signal. Structured disclosures are keyboard operable and expose their labels.
- Stable automation names include `trench__module__ca`, `trench__module__index-wallets`,
  `trench__module__negative-wallets`, `trench__records__search`, `trench__records__row`,
  `trench__detail__analysis`, `trench__detail__chain`, `trench__detail__top-wallets`,
  `trench__detail__holdings`, `trench__detail__copy-analysis`, and `trench__detail__back`.
- Guide automation names include `trench__header__agent-guide`, `trench__agent-guide`,
  `trench__agent-guide__copy-complete`, `trench__agent-guide__helper`,
  `trench__agent-guide__config`, and `trench__agent-guide__skill`.

## Visual acceptance

Capture standalone 1360×860 and 800×600, plus Omni cells at 800×568, 398×568, and 800×282. Every
capture must show a usable module choice, record selection or truthful empty state, and bounded
detail. Verify no legacy analysis control, overlap, clipped required action, body scrollbar, or
horizontal cell overflow.
