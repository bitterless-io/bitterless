# BL Trench INDEX Layout

Status: Implemented

## Visual direction

INDEX keeps the existing Todo-parity 32px Royal Blue Trench menu bar and removes the former
record-vault hierarchy. It is a compact research index, not a trading dashboard: flat white/utility
surfaces, restrained borders, monospace addresses, no gradient, chart, KPI-card strip, or new color
system. Chain identity is the single visual signature: SOL uses a restrained `#14b887` rail and BSC
uses `#c89500`; the colors appear only on the INDEX column-header rail and compact chain badges,
never as large fills or decorative gradients. Module and chain ownership now follows
[`trench-navigation-layout.md`](trench-navigation-layout.md).

## Desktop and wide Omni

```text
┌──────────────────────── Trench ───── status · Agent · Refresh · ⚙ ┐
├───────────────┬─────────────────────────────────────────────────────┤
│ ▾ INDEX       │ [＋ Add CA] [↻ Reanalyze all] Last successful …     │
│   SOL         ├───────────────────────────┬─────────────────────────┤
│   BSC         │ SOL TARGET CAs            │ SOL INDEX WALLETS       │
│   Robinhood   │ Token name · SYMBOL       │ #001 wallet address     │
│ ▾ Trenchers   │ CA                        │ total profit            │
│   All traders │ Current MC · Highest      │ 3 CAs · best #2         │
│               │ Last success / error      │ name / note             │
│               │ …                         │ … up to 300             │
│               └───────────────────────────┴─────────────────────────┤
└─────────────────────────────────────────────────────────────────────┘
```

- The menu bar remains exactly the accepted Todo-parity contract in [`coin-layout.md`](coin-layout.md):
  32px, `#4e5882`, `#3d4666`, one `Trench` title, standalone traffic-light clearance, Omni no-drag,
  and always-reachable Agent/Refresh/GMGN settings actions. The settings action is the same 28px
  text-button/icon treatment as Todo and the other Trench actions; it adds no new header height,
  background, label row, or accent color.
- The Arco left rail contains INDEX children SOL, BSC, and Robinhood in that order. It is the only
  selected-chain owner; the old module/chain tab row does not render.
- Every menu child is keyboard reachable through Arco semantics. Selecting an INDEX child changes
  both columns atomically and never starts provider analysis or storage writes.
- A 40px action/status row contains `Add CA`, `Reanalyze all`, the last completed time, and a concise
  global running/failure status. Header `Refresh` remains local reread; its tooltip must not imply
  analysis.
- Content is a two-column CSS grid. Target CAs default to 42% with a 320px useful minimum; INDEX
  wallets take the remaining width. Each column owns its header and vertical scroll.
- There is no record detail pane in v1.

## Target CA rows

Rows use a stable business name and contain:

1. token name and symbol; the selected INDEX menu child and column header already identify chain;
2. the full CA as copyable monospace text with visual ellipsis only;
3. current market cap and, when available, `Highest MC`, `Estimated highest`, or
   `Highest observed`;
4. running state, last success time, or sanitized latest error.

Old successful Meta remains visible during refresh and after a failed run. Unknown values render
`—`; the UI never substitutes zero. The first phase does not add row delete, archive, or per-row run
actions.

## INDEX wallet rows

Rows contain contiguous chain rank, joined shared wallet address, optional shared name/avatar/note,
total profit, source CA count, and best source rank. Avatar absence does not reserve an empty
decorative block. Long addresses truncate visually and expose the full value to copy/title and
assistive technology. Ranks render `#001..#300`; BSC and SOL may truthfully both show `#001`
because ranks are chain-local.

When `avatarUrl` is present, the row reserves the existing 28px circular avatar frame and paints a
deterministic local initial from the wallet name (or address when unnamed) behind the remote image.
The image keeps an empty alt and `no-referrer`; a load error hides only that failed image for the
current renderer lifetime and leaves the initial visible. There is no automatic retry loop and no
broken-image glyph. A missing URL still reserves no avatar frame.

The fallback occupies exactly one Unicode code point. It takes the first code point of the trimmed
name, or of the trimmed canonical address after an EVM `0x` prefix is removed. Locale-independent
uppercase is used only when the mapped result remains one code point; expanding mappings retain the
original. Thus `i` renders `I`, `ß` renders `ß`, and emoji remain intact on every host locale.

Wallet metadata is read from the central wallet registry. The component must not accept a
module-local duplicate name/avatar/note field shape.

## Add CA dialog

- The dialog is scoped to the selected chain and names it in the title/input guidance. One labelled
  multiline CA input accepts a bounded batch, one address per line. Current-chain entries validate
  before submission; duplicate resolved identities collapse to one target.
- Structurally recognizable opposite-chain entries are removed from the outgoing command and shown
  immediately in one inline warning: BSC selected + Solana input says `包含 N 个 Solana 链的 CA，已忽略。`;
  SOL selected + EVM input says `包含 N 个 BSC 链的 CA，已忽略。` The English locale conveys the
  same count, chain, and ignored result. The count is input-entry based and updates with the text.
- A mixed paste still submits the retained current-chain entries. If no current-chain entry remains,
  the primary action performs no XPC/provider/storage call, the dialog stays open, and an inline
  error explains that the selected chain has no analyzable CA.
- Retained EVM input is submitted with the explicit selected BSC/Robinhood chain; retained Base58
  input is submitted as explicit Solana. The dialog never silently routes an ignored CA into a
  different chain INDEX.
- Primary action is `Add and analyze`; secondary action cancels without mutation.
- Validation, not-found, ambiguous-chain, busy, and provider failures render inline with focus
  returned to the relevant control.
- Submission is request-idempotent. The dialog closes only after the target is persisted; analysis
  continues visibly in the workspace.

## GMGN settings dialog

```text
Add CA dialog (preserved underneath, when opened from its error)
  └─ GMGN settings overlay
     ┌────────────────────────────────────────────────────┐
     │ GMGN settings                                  ×   │
     ├────────────────────────────────────────────────────┤
     │ CLI          Detected 1.5.2 / Not detected         │
     │ API key      Configured / Not configured           │
     │ Read access  Verified / typed last failure         │
     │                                                    │
     │ GMGN_API_KEY  [••••••••••••••••••••••••••••]     │
     │ Existing keys are never displayed.                 │
     │ [Get API key] [Recheck]       [Save and verify]    │
     └────────────────────────────────────────────────────┘
```

- The gear icon in the 32px menu bar is the primary entry and is keyboard-labelled `GMGN
  settings`. An inline `Configure GMGN` action appears only beside a `PROVIDER_UNAVAILABLE` Add or
  workspace error and opens the same dialog.
- Opening loads one sanitized resource status. The dialog distinguishes CLI missing, key missing,
  private-key blocked, unauthorized, rate-limited, timeout, invalid response, and verified states;
  it never renders a vague unavailable state when a typed probe code exists.
- The password field always starts blank and never shows the saved key. `Save and verify` validates
  non-empty input, saves through Main, clears the input, refreshes sanitized status, and runs the
  bounded read-only probe. The dialog stays open after success or failure so the result is visible.
- `Recheck` repeats CLI/status discovery without analysis. `Verify` is available for an already
  configured key without requiring replacement. `Get API key` uses the existing allowlisted
  official-link action. No control accepts a CLI path or private key.
- When opened over Add CA, closing settings returns to the still-open Add dialog with its CA batch
  unchanged. Verification never submits the batch; Ral explicitly chooses `Add and analyze` again.
- Initial focus enters the dialog heading/first available control; `Tab` stays within the modal and
  `Esc` closes only while no save/probe is pending. Pending actions disable duplicate submission and
  expose a visible loading state.

## Empty, busy, error, and stale states

| State | Target column | INDEX column | Actions |
| --- | --- | --- | --- |
| no targets on selected chain | compact chain-specific Add CA invitation | explain that this chain's INDEX appears after adding a CA | Add enabled; Reanalyze all follows global target availability |
| analyzing | current rows with per-target progress | previous current INDEX remains visible | Add/Reanalyze disabled |
| first run no result | target rows and truthful status | bounded progress skeleton, not sample wallets | local Refresh enabled |
| failed with prior result | failed targets retain old Meta | prior INDEX plus non-blocking failed-run notice | Reanalyze enabled |
| failed without result | target rows show reason | explicit unavailable state | Reanalyze enabled |
| storage unavailable | no fabricated data | one repository error surface | local Retry only |
| GMGN unavailable | prior target/INDEX data remains visible | typed provider guidance | Configure GMGN; no automatic analysis retry |

Running and completion changes use an `aria-live="polite"` region. Error notices use `role="alert"`
only for a newly actionable failure. Buttons expose stable `name` attributes and visible/tooltip
labels.

## Responsive behavior

- At wide desktop/Omni sizes the two columns remain side by side.
- Below 640px the columns stack in business order: Target CAs, then INDEX wallets.
- The left rail stays 148px on wide layouts and 112px below 560px; complete child labels remain
  visible and independently scrollable rather than collapsing to unlabeled icons.
- The action bar wraps without hiding either action. The menu status text may yield before the two
  header icon actions, preserving Agent, Refresh, and GMGN settings. At narrow width the status
  label hides before any icon action.
- At 398x568 and 800x282 Omni cells, every action remains reachable, each list owns scrolling, and
  the renderer root has no horizontal overflow or artificial 800x600 minimum.

## Acceptance

- Navigation contains `INDEX` with no count and no CA Records/Negative Wallets tabs.
- The first column is recognizably the selected-chain target CA set and the second its independent
  wallet ranking.
- Current/highest market-cap evidence has accurate labels and no false zero.
- SOL/BSC switching changes targets, wallets, empty states, headers, and ranks together without a
  provider call or mutation; mixed-chain results never render in the same column projection.
- Add CA and Reanalyze all are distinct, keyboard-reachable, and disabled only when their operation
  cannot safely start.
- GMGN settings is reachable from the menu bar in standalone and every accepted Omni geometry;
  provider failure offers the same recovery without clearing a pasted CA batch.
- Shared wallet name/avatar/note appears through joined registry data without modifying ranking
  layout when absent; a rejected or unavailable remote avatar shows a local initial rather than a
  broken image.
- Ral performs standalone 1360x860 and Omni 800x568, 398x568, and 800x282 visual acceptance; no
  automated screenshots or Electron E2E run for this delivery.
