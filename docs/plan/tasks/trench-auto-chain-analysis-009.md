---
id: trench-auto-chain-analysis-009
scope: Chain-agnostic CA paste, bounded three-chain resolution, and Electron acceptance
status: superseded-by-trench-record-browser-011
depends-on: [trench-single-page-workspace-008, coin-gmgn-only-local-mode-007]
verify: focused Coin unit/type checks and a real Electron clipboard smoke
---

# Trench Automatic Chain Analysis

> Historical contract. Automatic in-app analysis is superseded by the external-agent/MCP record
> workflow and is not retained in the Trench renderer or preload.

## Objective

Remove the chain selector from Trench. Ral pastes one contract address and Trench searches the
supported scope — BSC, Solana, and Robinhood Chain — then opens the analysis without asking which
chain to use.

This task supersedes only the manual-chain and Paste-routing portions of
`trench-single-page-workspace-008`. Existing persisted chain values remain result identity and
migration data; they are no longer user input in the command bar.

## Confirmed decisions

- The command bar has no chain selector before or during a search.
- Paste and analyze reads one bounded clipboard value, extracts exactly one address candidate, and
  runs the current read-only local GMGN path. Enter on the editable CA field runs the same flow.
- A Solana-shaped address searches Solana. An EVM-shaped address probes both BSC and Robinhood Chain;
  address syntax alone never chooses between them.
- Chain resolution uses a bounded token-identity probe before full holder/trader analysis. A market
  list response alone is not proof that the CA exists on a chain.
- Probe failures are not silently reclassified as "not found". The result distinguishes no match,
  source unavailable, cancelled, and provider failure.
- When one chain matches, Trench performs the full analysis, persists the detected chain, and shows
  it as a non-interactive result label.
- When the same EVM address genuinely matches both chains, Trench records both results, activates the
  first match in stable `bsc`, then `robinhood` order, and visibly reports both detected chains. It
  does not restore a pre-search chain selector.
- Once automatic lookup starts on local GMGN, it never switches to the deployed Meme service after
  an error. Existing explicit known-chain service analysis remains an internal compatibility path.
- No wallet, private key, swap, order, or signing capability is added.

## Workspace contract

```text
┌ CA input (BSC / Solana / Robinhood Chain) │ Paste+Analyze │ Terminal │ X ─┐
│ detecting BSC + Robinhood… / found BSC / source error                 │
│                           Codex / model / effort / tools              │
├──────────────────┬────────────────────────────┬─────────────────────┐
│ Scan             │ Active token               │ Decision            │
│ Focus            │ detected chain + evidence  │ thesis review       │
└──────────────────┴────────────────────────────┴─────────────────────┘
```

The removed selector gives its width to the monospace CA input. The one visual signature is the
small detected-chain evidence label that appears only after the system has proved a match; it is
status, not decoration or a control. Existing Royal Blue tokens, typography, and flat surfaces stay
unchanged.

## Implementation scope

### Shared contract, Main, and bridge

- Add a chainless automatic-analysis request and a result that carries every detected match.
- Keep the supported scope closed to `bsc`, `solana`, and `robinhood`.
- Validate and normalize the clipboard/input in Main as well as Renderer.
- Probe only typed, fixed GMGN token-info commands; retain the serial bounded process queue,
  cancellation, timeout, output limit, cooldown, and sanitized receipts.
- Run the existing full local analysis only for positive chain matches.
- Keep the previous result visible while detection or refresh is active.

### Renderer

- Remove `trench__commandBar__chain` and expand the CA input into the released width.
- Route Paste, Enter, and the explicit Terminal action through automatic chain resolution.
- Render detecting/found/multi-match/not-found/source-error state without asking for a chain.
- Update the internal draft chain only from a resolved result or an existing Scan/Focus/history item.

### Persistence

- Do not add a user-selected chain preference.
- Existing stored analyses, Focus items, decisions, and historical draft chain values remain
  readable. The detected chain continues to identify every stored result.

## Acceptance

- No chain select control exists in the Trench command bar at 1360x860 or 800x600.
- A Solana CA from the clipboard performs only the Solana identity probe, updates the input, resolves
  `solana`, and starts full analysis.
- A BSC CA probes BSC and Robinhood, resolves the mocked BSC identity, and starts BSC analysis without
  user selection.
- A Robinhood CA probes BSC and Robinhood, resolves the mocked Robinhood identity, and starts
  Robinhood analysis without user selection.
- An EVM CA returned by both probes records both chain results and reports the multi-match without
  reintroducing a pre-search selector.
- Empty, invalid, zero-match, source-unavailable, provider-error, and cancelled searches create no
  fabricated successful analysis and show a recovery-directed error.
- Clipboard contents containing zero or more than one address candidate do not start a lookup.
- The minimum real Electron smoke writes a CA through Electron's clipboard, clicks the single Paste
  action, observes the mocked source calls, and asserts the detected chain and rendered result.

## Verification

- Focused shared/Main unit tests for address extraction, candidate-chain generation, probe outcome,
  multi-match ordering, cancellation, and no-match/error truthfulness.
- Coin renderer typecheck plus focused Main typecheck for touched contracts.
- Real Electron/Playwright smoke for selector absence and Solana, BSC, and Robinhood clipboard flows.
- `git diff --check` and an independent verify-agent review before handoff.

## Implementation result

- Trench now accepts one chainless CA request across Renderer, preload, sender-checked IPC, and Main.
  Solana probes only `solana`; EVM probes run in stable `bsc`, then `robinhood` order. Only a strict
  top-level token-info address match can start the full local analysis.
- The command-bar selector is removed. Paste, Enter, and Terminal share automatic resolution;
  detected chains are status evidence, and dual EVM matches are both recorded with BSC active.
- Address extraction is bounded to 2,048 characters and rejects embedded or multiple candidates.
  Provider-error JSON, unavailable source, cancellation, and a proven zero-match remain separate;
  no automatic request falls back to the Meme service.
- Focused auto-chain unit tests pass `10/10`. The full Coin unit run passes `84/85`; the sole failure
  remains the pre-existing `GMGN regular-wallet rank 1 is retained as independent` expectation.
- `yarn build`, `yarn typecheck:node`, the Coin renderer typecheck, and `git diff --check` pass. The
  focused Electron test passes `1/1` using Electron's clipboard and an isolated read-only fake GMGN
  CLI for Solana, BSC, Robinhood, and a dual EVM match at both 1360x860 and 800x600.
- Screenshots are written to `out/playwright/coin/screenshots/trench-auto-chain-1360x860.png` and
  `out/playwright/coin/screenshots/trench-auto-chain-800x600.png`.

## Operational verification pending

- The current top-level `ops/` snapshot has no GMGN or other multi-chain CA provider credential;
  its only crypto API entry is Binance read-only, which cannot verify these CAs. No keychain source
  was read. A live-provider smoke therefore waits for the exact GMGN ops path or a refreshed ops
  inventory; this does not block the deterministic Electron acceptance above.
