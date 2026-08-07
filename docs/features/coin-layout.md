# Trench Workspace Layout

Status: Workspace MVP implemented; owner verification pending

## Design intent

Trench is a repeated-use research desk for one operator. The active token, incoming scan signals,
focus observations, and decision review must remain visible in one workspace. The old
Monitor/Screener/Meme/Strategy/History top-tab layout is superseded and may be removed.

The visual contract is intentionally restrained:

- Use Arco controls and the Bitterless Royal Blue tokens from [`../design/colors.md`](../design/colors.md).
- Use `#4E5882` for primary actions, `#1E2237` for text, white content surfaces, and `#F3F5FC` for
  utility backgrounds. Add no gradient, glow, decorative accent, or new palette.
- Keep the workspace flat. Use whitespace and selected-row backgrounds first; add one structural
  separator only where adjacent regions would otherwise be ambiguous.
- Do not wrap each region or row in a card. Do not nest cards, float page sections, or decorate the
  page with shadows.
- Do not add dashboard KPIs, candidate/watch totals, hit-rate summaries, decorative scores, or
  large-number statistics. Price, liquidity, wallet indices, freshness, and risk remain where they
  provide evidence for a token or action.
- Font sizes are fixed by role and letter spacing is `0`. Full contract addresses use monospace.

## Desktop structure

```text
┌────────────────────────────── Trench window ───────────────────────────────┐
│ Trench · active CA / chain                              source · AI · _ □ ×│
├─────────────────────────────────────────────────────────────────────────────┤
│ Chain │ CA input                         │ Paste+Analyze │ Terminal │ X      │
│ active run / error                Codex / Sign in │ model │ effort │ tools │
├───────────────────┬──────────────────────────────────┬──────────────────────┤
│ SCAN              │ ACTIVE TOKEN                     │ DECISION             │
│ candidate rows    │ identity / phase / freshness     │ pinned strategy      │
│ why now / risk    │ hard risks / evidence summary    │ user thesis          │
│                   │ wallet / market / holders / X    │ AI review / counter  │
│ FOCUS             │                                  │ evidence / invalid.  │
│ quiet / triggered │ current snapshot remains visible│ decision revision    │
└───────────────────┴──────────────────────────────────┴──────────────────────┤
│ selected sources · latest refresh · active job                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

Default window size is `1360x860`; minimum size is `800x600`. The command bar and status bar are
fixed. The center token canvas is the primary scroll owner; Scan, Focus, and Decision use their own
bounded scroll areas when expanded.

## Command bar

The command bar is the persistent start point for every investigation.

| Control | Contract |
|---|---|
| Chain | Arco Select. Required because identical address forms can exist on different chains. |
| CA | Editable input. Keeps the normalized address after paste; long values do not resize the bar. |
| Paste and analyze | Reads the clipboard on click, validates `chain + CA`, and immediately starts the default service analysis. No clipboard history is retained. |
| Terminal | Icon action with tooltip. Runs one explicit read-only `local_cli_rpc` analysis for the current input; it is not a fallback toggle. |
| X Chrome | Opens the current CA in X Latest using the menubar-selected display mode; without a CA it opens X home. |
| Active run | Shows the local stage and cancel action beside the command that started it. It is not a KPI strip. |
| Codex | Shows shared account state and an inline Sign in/Reconnect action. |
| Model / effort | Select the target for the next AI run. Unsupported combinations are omitted; no silent replacement or downgrade. |
| Tools | Icon menu for Resources, history, strategy management, synchronization, and logs. These are secondary surfaces, not core workflow tabs. |

At widths below 1280px, CA commands and AI session controls occupy two stable rows. Controls wrap
before their text or icons shrink.

## Scan and Focus rail

Scan and Focus share the left rail but keep separate scroll and ordering rules.

### Scan

Each row contains only information needed to decide whether to inspect it:

- symbol/name, chain, short CA, and freshness;
- one concise `why now` reason;
- necessary price/liquidity/volume evidence;
- hard-risk state and known evidence gaps;
- actions: open analysis, add to Focus, or ignore.

Clicking a row changes the active token in the center. It must not start AI or add the token to Focus
without an explicit action. No candidate total, scanned total, global score card, or chart thumbnail
appears above the list.

### Focus

Focus contains manually selected contracts and immutable trigger events. Quiet items show current
phase, next check, and last analysis. Triggered items move above quiet items and show the trigger
reason, time, and bounded before/after evidence. A trigger invites investigation; it never means
buy and never places an order.

The first trigger shape is `drawdown -> base -> breakout`, but its windows and thresholds belong to
the monitor strategy, not the renderer. The UI consumes versioned rule and trigger records.

## Active token canvas

The center is one flat analysis document:

```text
Token identity / full CA / source state / as-of
Hard risks and missing evidence
Market and liquidity
Filtered holder universe and concentration
Positive-wallet and negative-wallet indices
Narrative and attention evidence
X evidence and contradictions
Source receipts / snapshot revision
```

Sections use headings and whitespace, not individual cards. Missing values render `Unavailable`
with source/reason and never as zero. Refresh keeps the previous snapshot visible and marks only the
affected section as refreshing.

## Decision dock

The right dock is a bounded strategy review, not a generic chat client.

- It is always bound to the active token and pinned strategy revision.
- The user can enter a thesis, position context, risk budget, horizon, and question.
- AI receives the user text as an untrusted hypothesis and must compare it with the current evidence
  and strategy; it may not treat the thesis as a fact.
- The result shows recommendation, supporting evidence, counter-evidence, strategy conflicts,
  invalidation conditions, missing inputs, model, effort, and evidence revision.
- Every request creates a revision. New output never overwrites an earlier decision record.
- No trade, wallet-signing, or order action appears in v1.

An empty dock shows the thesis composer and current strategy name. It does not display tutorial copy,
example cards, or decorative statistics.

## X Chrome Display Mode

The custom window menubar contains one compact Arco switch with eye/eye-off state. `visible` launches
system Chrome with `channel: "chrome"` and `headless: false`; `hidden` uses the same channel and
profile with `headless: true`. Visible is the default and the preference persists with Coin workspace
state. The dedicated user-data directory remains under the Trench application-data boundary.

```text
closed -> launching -> login_required -> ready
                   \-> error
```

On first use, the visible browser opens X and the user completes login/2FA. The profile persists for
later visible or hidden launches. Trench persists only the display preference; it does not read
passwords, export cookies, or place browser status/profile contents in workspace synchronization,
logs, or evidence bundles.

Changing the switch while a Trench-managed browser is active closes that context and reopens the
same query in the selected mode. Hidden mode never falls back to visible. If login or a challenge is
required while hidden, Trench reports that visible mode is required for human action. For optional
external CDP attachment, Chrome visibility belongs to the external process and the switch is
disabled.

Playwright must not point at or copy the user's regular Chrome default profile. Current Chrome and
Playwright explicitly do not support that automation path safely. An optional loopback CDP endpoint
may connect only to a Chrome instance already launched by Trench with its dedicated non-default data
directory; failure is explicit and never falls back to another profile.

The later X extraction path must use accessibility locators to identify visible targets and fresh
bounding boxes. Every automated mouse movement, wheel, press, and release must be emitted through a
page CDP session. Challenge pages and expired sessions pause for human action; Trench does not
bypass them. This workspace iteration owns visible launch and persistent login state only.

## Shared Codex session

Trench reuses the host-owned `CodexCredentialService` already used by existing model-provider and
Coin facades. It must not create another token, cookie, login state, or callback listener.

Authentication is application-global. Model and effort are Trench workspace preferences and are
frozen into each run receipt. Changing a selector while a run is active affects only the next run.

## Secondary surfaces

Resources, history, wallet cohorts, strategy management, data synchronization, and logs open in an
Arco Drawer or secondary view. Closing them restores the same active token, list positions, draft,
and running task. Secondary surfaces do not restore the old core-workflow tabs.

## State variants

| State | Visual contract |
|---|---|
| Initial | Persistent command bar plus empty Scan/Focus and thesis composer; no fabricated result. |
| Loading/queued | Previous token and lists remain; the affected action shows stage and cancel. |
| Source unavailable | Show selected data path and exact missing prerequisite with Resources action. Never silently fall back. |
| Stale/insufficient | Keep old value with `asOf`, TTL, missing fields, and affected conclusion. |
| Schema failure | Show stable error code and phase; raw model output remains in protected logs. |
| Codex required/invalidated | Inline Sign in/Reconnect; deterministic evidence stays usable. |
| X login required | In visible mode focus Chrome; in hidden mode ask the user to switch to visible. Keep local analysis usable. |
| Profile busy | Explain that the Trench profile is already open and offer Focus/Retry; never create a second context on it. |
| Offline/sync conflict | Preserve both revisions and provide compare/retry; never silently overwrite human labels or strategy. |

## Responsive contract

| Content width | Signal rail | Token canvas | Decision dock | Command bar |
|---|---|---|---|---|
| `>=1280px` | expanded, about 280px | `minmax(520px, 1fr)` | expanded, about 340px | one row when content fits |
| `960-1279px` | expanded, about 240px | primary remaining width | right dock trigger | two rows |
| `800-959px` | left dock trigger | full remaining width | right dock trigger | two rows; utility actions become icons |

At 800-959px only one side dock may be open. Dock triggers show a semantic pending state dot when
needed, not a total count. No body-level horizontal scrollbar is permitted.

## Component target

```text
CoinApp
├─ CoinWindowHeader
├─ TrenchWorkspace
│  ├─ TrenchCommandBar
│  ├─ TrenchSignalRail
│  │  ├─ ScanQueue
│  │  └─ FocusQueue
│  ├─ MemeAnalysisPanel (embedded token canvas)
│  ├─ TrenchDecisionDock
│  └─ CoinResourcesView / secondary surfaces
└─ CoinStatusBar
```

Renderer state uses `reactive(new XxxState())`. Reactive class instances contain data only;
behavior remains on class prototypes, and timers/subscriptions/browser handles remain outside the
reactive object.

## Entry points

- Window lifecycle: `src/main/coin/` and `src/main/xpc/coinWindow.handler.ts`
- Privileged bridge: `src/shared/coin/`, `src/preload/coin/`, and `src/main/coin/coinIpc.service.ts`
- Renderer: `src/renderer/coin/`
- Theme reference: `docs/design/colors.md`
- Product contract: `docs/features/coin.md`
