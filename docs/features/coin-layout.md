# Coin Layout

Status: Analysis workspace implemented; owner verification pending

## Design principles

Coin is a repeated-use research console for one operator. It prioritizes scan speed, provenance,
comparison, and decisive actions over illustration or marketing composition.

- Use the Bitterless Royal Blue system from `docs/design/colors.md` for navigation, focus, and
  primary actions.
- Keep the main surface white with `#F3F5FC` utility bands, `#E2E4EB` separators, and 12px module
  spacing. Do not use a dark terminal theme, decorative gradient, or floating card sections.
- Use green only for `BUY`/positive evidence, amber for `HOLD`/stale evidence, and red for
  `SELL`/risk/error.
- Keep evidence receipts visible while results change. The signature element is the evidence strip:
  source, freshness, support, deterministic score, and confidence. AI output is follow-up scope.
- Coin contains no chat pane, messages, prompt composer, or draggable split.
- Font size is fixed by role, never viewport-scaled. Letter spacing is `0`.

## Overall structure

```text
┌────────────────────────────── Coin window ──────────────────────────────┐
│ Coin | active asset / chain       source status   AI status   _  □  × │ 40
├─────────────────────────────────────────────────────────────────────────┤
│ Monitor  Screener  Meme  Strategy  History              [Resources ⚙] │ 38
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│ Full-width local analysis workspace                                     │
│                                                                         │
│ input/action toolbar                                                     │
│ evidence strip                                                           │
│ result summary / table / analysis document / decision                   │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│ Sources / last refresh / AI run / active jobs                           │ 28
└─────────────────────────────────────────────────────────────────────────┘
```

The workspace owns all available width. Default size is `1360x860`; minimum size is `800x600`.
Tables scroll inside their own body at minimum width and never force the whole window wider.

## Window header

The 40px header is draggable; interactive controls are explicit `no-drag` regions.

| Element | Behavior |
|---|---|
| Coin label/icon | product identity, not a navigation link |
| Active context | symbol or shortened CA and chain; hidden before selection |
| Source status | opens Sources drawer and shows aggregate readiness |
| AI status | `Connected`, `Sign in required`, `Running`, or `Error`; opens Resources |
| Window controls | familiar minimize, maximize/restore, and close symbols |

On macOS, native traffic lights remain visible and header content leaves their required inset.

## Navigation

Monitor, Screener, Meme, Strategy, and History are compact Arco business tabs. Resources is a gear
icon plus label on the same bar and opens a full page; it is not a modal and is not mixed with
analysis results. Switching pages preserves draft input and the last result without restarting work.

### Monitor

```text
Symbols [BTCUSDT, ETHUSDT, ...]  Sort [Low multiple] [Refresh]
Evidence: Binance USD-M • live | observed 14:32:08 | WS connected
Symbol      Price       Low / High       Low x   Listed       Fresh
```

Symbol input tokenizes uppercase symbols and rejects duplicates. Refresh keeps the previous table,
marks it refreshing, and disables duplicate refresh. Missing symbols remain as error rows.

### Screener

```text
[Natural language query................................] [Parse]
Mode [Live public]  Symbols [All configured]             [Screen]
Parsed filters
436 scanned | 17 matched | 419 rejected | Binance + OKX | 14:32
Rank  Symbol  Evidence columns  Warnings
```

Parse and Screen have independent loading states. Explicit sample mode has an amber `Sample` label
in both evidence strip and result header.

### Meme

Meme uses a local segmented control for `Discover` and `Analyze`.

```text
Mode [Service | Local GMGN CLI]  Chain [BSC]  Contract address [0x...]  [Analyze] [Cancel]
Evidence: GMGN ready | age 18s | deterministic 72
Overview  Cohort overlap  EOA-only  Attention  Risks

Core distribution
Holders 3479 | Top10 15.04% | Top100 61.15% | Fresh 27.36% | ...

Cohort overlap
Library 22/100 · 18.84% | Robinhood 11/100 · 10.55% | ...

EOA-only
98 holders · 57.19% | library 20 · 14.88% | ...

Current concepts / attention thesis / key wallets / risks
```

Result sections use a slim section nav and flat document flow, not nested cards. Missing fields show
`Unavailable` with source/reason and never render as zero.

Discover layout:

```text
Chain / launch stage / time window / candidate limit / [Start polling]
Polling: next run, active source, last completed run, [Stop]
Candidate table: token, CA, age, fill stage, attention, overlap, risk, score
```

Polling is opt-in per window session and stops on close/logout.

### Strategy

```text
Asset / chain | analysis receipt | strategy v1
Market + risk inputs                     Position (optional)
price / liquidity / score / budget       entry / amount / peak / held
[Evaluate]
Decision: BUY | 78/100 | confidence 0.72
Reasons with evidence references
Invalidation conditions
```

Inputs use numeric fields, steppers, selects, and switches. `HOLD` is not a possible result until a
valid position is supplied. Deterministic risk gates can force `SELL`; no action places an order.

### History

```text
Type [All]  Chain [All]  Search [symbol / CA]  Date range
Time   Type   Asset   Result   Sources   Open
```

Opening a record restores its result without issuing a request. History deletion is out of initial
scope.

## Resources page

Resources is a dense settings page with one bordered list per category. Cards are not nested.

```text
┌ AI analysis ───────────────────────────────────────────────────────────┐
│ Codex   Connected as ...   gpt-5.5 / high   verified 14:20 [Disconnect]│
└────────────────────────────────────────────────────────────────────────┘
┌ Local data tool ──────────────────────────────────────────────────────┐
│ GMGN CLI  1.5.2  /path/to/gmgn-cli              [Recheck] [Guide]     │
│ API key   Configured • read-only                 [Replace] [Verify]   │
│ Missing: yarn global add gmgn-cli                 [Copy] [Recheck]     │
└────────────────────────────────────────────────────────────────────────┘
┌ Services ─────────────────────────────────────────────────────────────┐
│ Monitor / Screener / Meme API status, URL host only, last check       │
└────────────────────────────────────────────────────────────────────────┘
```

Behavior:

- Select and dropdown overlays remain open while the user moves into their options. They close only
  after selection, an outside click, or `Escape`; background persistence must not disable, remount,
  or replace the active control.
- Codex disconnected state has one **Connect Codex** action and optional Browser/Device method menu.
- GMGN absent state shows a copyable Yarn command; Bitterless does not silently install a global
  package. Guide opens in a local help modal with an official-doc external link.
- GMGN key modal masks input, saves via main process, never reads the stored key back, and explicitly
  states that no trading/private key is configured.
- Verify runs a fixed read-only probe and shows start/end time, exit/error class, and sanitized
  summary. No raw API key, command environment, or unbounded payload is shown.
- Every save/test/connect action has loading, duplicate-submit protection, success/error feedback,
  and keyboard-safe modal behavior.

## Sources drawer

Sources opens as an Arco drawer below the header over the workspace:

```text
Source             Configured   Support     Freshness    Last error
Binance filter     yes          read-only   4s           —
Coin screen        yes          read-only   2m           —
GMGN CLI           no           unavailable —            API key required
Owner cohorts      no           unavailable —            reviewed registry required
Strategy v1        yes          read-only   —            —
```

It contains diagnostics only. Credentials and complete secret-bearing endpoints are never shown.

## State variants

| State | Visual contract |
|---|---|
| Initial empty | relevant input form, no fabricated result, first input focused |
| Loading | prior result retained, refreshing marker, duplicate action disabled, cancel if supported |
| Unavailable | precise prerequisite and Resources action |
| Error | inline error next to failed region with Retry; inputs/prior data retained |
| Stale | amber timestamp/freshness label; data body stays neutral |
| No matches | parsed filter summary plus zero-match explanation |
| Codex disconnected | deterministic analysis remains usable; AI action points to Resources |
| Auth invalidated | window destroyed; no in-window Bitterless login overlay |

## Responsive constraints

- Default `1360x860`; minimum `800x600`.
- Workspace always uses full width. No pane overlays another and no horizontal body scrollbar.
- At `800px`, toolbars wrap into multiple rows before controls shrink below their stable size.
- The top tab bar may scroll horizontally; tab labels do not scale.
- Result/table bodies own scrolling and use `min-width: 0; min-height: 0`.
- Long CA, paths, endpoint hosts, and errors truncate with tooltip or wrap at safe boundaries.

## Size reference

| Element | Size |
|---|---|
| Header | 40px |
| Business tab bar | 38px |
| Footer/status bar | 28px |
| Module gap | 12px |
| Compact control | 28-32px |
| Icon button | 28x28px or 32x32px |
| List outer radius | 8px maximum; repeated rows use separators |

## Component tree

```text
CoinApp
├─ CoinWindowHeader
├─ CoinWorkspace
│  ├─ CoinBusinessTabs
│  ├─ MonitorView
│  ├─ ScreenerView
│  ├─ MemeView
│  ├─ StrategyView
│  ├─ HistoryView
│  ├─ CoinResourcesView
│  │  ├─ CodexResourceSection
│  │  ├─ GmgnCliResourceSection
│  │  └─ ServiceResourceSection
│  └─ SourcesDrawer
└─ CoinStatusBar
```

## Entry points

- Mini Apps card: `src/renderer/home/src/views/miniApp/`
- Main/window lifecycle: `src/main/coin/` and `src/main/xpc/coinWindow.handler.ts`
- Preload: `src/preload/coin/coin.preload.ts`
- Renderer: `src/renderer/coin/`
- Shared contracts: `src/shared/coin/`
