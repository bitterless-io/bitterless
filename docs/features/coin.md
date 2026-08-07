# Trench Sub-application

Status: Single-page Trench workspace and selectable visible/hidden X Chrome implemented; owner verification pending

## Purpose

Trench is the user-visible name for the existing Coin runtime. It remains integrated as an
authenticated desktop workspace for trench research and decisions. Its Home Mini Apps card launches
the singleton Trench window while its runtime, window lifecycle, packaged resources, and persisted
data stay intact. The target interface is one full-width workspace: persistent CA commands, Scan and
Focus queues, the active token evidence canvas, and a bounded decision assistant share one context.
The previous Monitor/Screener/Meme/Strategy/History top tabs are superseded.

Trench provides source-backed discovery and CA analysis, deterministic strategy checks, bounded
Codex review of the user's thesis, and a Playwright-managed Chrome session for low-frequency X
research. The thesis composer is not a general chat client: it is bound to one token, one strategy
revision, one evidence snapshot, and one decision record. Trench has no address bar, Workbench,
Maestro tools, wallet signer, or order execution.

## Boundary

```text
Home / Mini Apps
       |
       | openCoinWindow (small XPC launch contract)
       v
CoinWindowHandler --------------------------- auth / quit cleanup
       |
       +-- Coin BrowserWindow (one local renderer, minimum 800x600)
              |
              +-- Command bar (CA, terminal, X Chrome, Codex target)
              +-- Scan + Focus / active token / Decision
              +-- Resources and History (secondary surfaces)

Coin preload -- allowlisted, sender-checked IPC --> main Coin services
       +-- CoinDataService
       +-- CoinStateService
       +-- CoinResourceService
       +-- CoinStrategyService
       +-- CoinXBrowserService

CoinAiAnalysisService
       +-- narrow host CodexRuntimeService

Host-owned CodexCredentialService
       +-- Coin background analysis consumes
       +-- Maestro delegates Codex auth to the same service
```

The renderer never receives Codex tokens, stored resource secrets, filesystem access, arbitrary IPC,
Node.js access, Maestro's preload, Playwright/CDP objects, wallet signing, or trading credentials.
It receives only bounded X-browser state and commands through the Coin bridge.

## User entry and lifecycle

| Event | Required behavior |
|---|---|
| Mini Apps renders | Render the Trench card and route Open through the narrow Home `openCoinWindow` contract. |
| First Open | Create one Trench window, load persisted Coin runtime state, then show it. |
| Repeated Open | Await any active boot, restore/focus the same window, and never create a duplicate. |
| Window close | Abort active polling/data work, flush Coin state, close the Trench-owned browser context, and destroy the window. |
| Auth invalidation/logout | Lock new opens, abort work, and destroy Coin before the secondary-window sweep. |
| Auth activation | Unlock Coin opening; do not open it automatically. |
| Host quit/update | Await Coin cleanup before destroying host resources. |

Default size is `1360x860`; minimum size is `800x600`. Geometry follows the shared
[top-level window state contract](window-state-persistence.md); the legacy
`userData/coin/window-state.json` value is imported once when the unified Coin key is absent.

## Single-page workspace

The detailed visual and responsive contract is [`coin-layout.md`](coin-layout.md). These are
concurrent regions, not mutually exclusive pages.

| Region | Job | Current readiness |
|---|---|---|
| Command bar | Paste/validate `chain + CA`, start service or terminal analysis, open X Chrome in the selected display mode, and select Codex model/effort. | Implemented; owner verification pending. |
| Scan | Recommend recently discovered tokens with `why now`, hard risk, freshness, and only necessary evidence. | GMGN Discover queue presentation implemented; richer ranking remains later scope. |
| Focus | Hold manually selected CAs and surface immutable monitoring triggers such as drawdown/base/breakout. | Manual Focus implemented; trigger rules/events remain later scope. |
| Active token | Render holder, wallet cohort, market, attention, risk, X, and source evidence for the selected CA. | Existing Meme evidence embedded in the single-page canvas. |
| Decision | Compare a user's thesis and position context with the pinned strategy and evidence snapshot. | Bounded thesis audit and immutable AI receipt implemented. |
| Secondary surfaces | Configure Resources and reopen History without losing workspace context. | Resources and History secondary navigation implemented. |

Sources status is available from the header and Resources page. It shows configuration, support,
read-only status, freshness, cooldown, and the latest failure reason.

## Data contracts

### Source configuration

Non-secret service bases may be supplied by build/runtime configuration or a validated user
override. Secret-bearing GMGN configuration is owned by `CoinResourceService`.

| Value | Purpose |
|---|---|
| `VITE_COIN_MONITOR_API_BASE` | Binance symbol state and refresh API base |
| `VITE_COIN_MONITOR_WS_BASE` | monitor WebSocket base |
| `VITE_COIN_SCREEN_API_BASE` | coin-filter parse/screen API base |
| `VITE_COIN_MEME_API_BASE` | deployed meme discover/analyze API base |

Missing configuration is a supported **unavailable** state. Coin must not silently substitute
fixtures, sample candidates, stale responses, zeros, or invented analysis.

### Monitor and Screener

Monitor reads the existing filter endpoints:

```text
GET  /binance/futures/symbol-feature-states?symbols=...
POST /binance/futures/symbol-feature-states/refresh
```

Rows include symbol, venue, current/low/high price, low multiple, listing time, observed time,
freshness, and explicit missing/error state. Screener uses:

```text
POST /api/coin-filter/parse
POST /api/coin-filter/screen
```

It renders parsed conditions, integration mode, scanned/matched/rejected counts, ranked matches,
source receipts, and warnings. `sample` is allowed only when explicitly selected and visibly
labelled; it is never an automatic fallback.

### Meme analysis

```ts
interface MemeAnalyzeInput {
  requestId: string;
  mode: 'service' | 'local_cli_rpc';
  chain: 'robinhood' | 'bsc' | 'solana';
  contractAddress: string;
  holderLimit: number;
  traderLimit: number;
}
```

The response must render at least:

- total holders and filtered Top 10/Top 100 concentration over independently attributable wallets;
- GMGN fresh-wallet, bot/degen, and entrapment-trader rates when supplied;
- Top 100 curated-library, Robinhood, BSC, and PVP hit counts plus holding share;
- EOA-only holder count/share and the same cohort breakdown after excluding contracts, pools, and
  black-hole addresses;
- the excluded-address audit: original source rank, address, exclusion class, reason, and evidence;
- ranked key wallets with label, cohort, holding share, realized/unrealized evidence, and reason;
- current popular concepts/narratives and attention-potential evidence;
- source names, observation times, unsupported fields, warnings, and confidence.

Every percentage has a numerator/denominator or source receipt. Missing evidence is `null` with a
reason, never `0`.

Holder concentration and wallet-cohort analysis MUST use the filtered holder universe, not the raw
provider ranking. Before re-ranking, exclude chain burn/null/system addresses, labelled exchange or
custody wallets, liquidity pools, contracts/programs, bridges/routers, and explicitly labelled
project treasury or vesting accounts. Excluded balances remain visible in the audit and risk output;
they are not silently discarded.

In local mode, GMGN `addr_type=0` is explicit regular-wallet evidence and `addr_type=2` is explicit
exchange/pool evidence. `exchange`, `tags`, and `maker_token_tags` refine the exclusion class and
take precedence over treating a row as eligible.

Raw rank 1 has a mandatory classification gate. If it is an excluded class, remove it and backfill
from subsequent source rows. If it is independently attributable, retain it. Rank alone is never a
reason to delete a real whale. If rank 1 remains unknown, filtered Top 10/Top 100 and holder-derived
scores are unavailable rather than calculated from a misleading universe.

After exclusions, eligible wallets are re-ranked from 1. A concentration depth is complete only
when the source window contains enough classified eligible wallets to fill it, or the complete
holder population is known to be smaller. GMGN local mode exposes at most 100 holder rows without a
holder cursor; when exclusions prevent backfilling a complete Top 100, return `null + reason` and
show the eligible/source-row coverage. A deployed Meme service may satisfy the contract by paging or
over-fetching before returning its filtered Top 100.

### Attention analysis

Attention potential is an evidence group, not an intuition-only score. It may include narrative fit,
mention velocity, unique-author growth, holder/address growth, liquidity/volume/imbalance velocity,
cohort accumulation, distribution change, creator history, pool state, and concentration/risk
penalties. The current UI distinguishes observed facts, inferred/derived evidence, and unavailable
dimensions. AI interpretation is reserved for `coin-ai-analysis-004`.

### Strategy decision

```ts
type CoinDecision = 'BUY' | 'HOLD' | 'SELL';

interface CoinDecisionResult {
  schema: 'coin-decision-v1';
  decision: CoinDecision;
  score: number;
  confidence: number;
  reasons: Array<{ code: string; text: string; evidenceRefs: string[] }>;
  invalidation: string[];
  generatedAt: number;
}
```

`HOLD` is valid only when position inputs are present. Without a position, the result is `BUY` or
`SELL`. A result never places an order and never claims certainty beyond its evidence.

## Background Codex analysis

`coin-ai-analysis-004` implements this optional interpretation path. Deterministic analysis and
Strategy remain usable without Codex.

Coin exposes one AI identity: **Codex** (`openai-codex`). There is no general chat UI, unbound prompt,
provider selector, AI-CRMS entry, Anthropic entry, browser tool, skill tool, wallet tool, or trading
tool. The Decision dock contains one bounded thesis field; it is a structured input to the
current token review, not a conversational transcript or general prompt surface.

### Credential ownership

- `CodexCredentialService` is a main-process singleton for status, one login mutex, browser/device
  authorization, timeout cleanup, refresh, and logout.
- Existing credentials remain at `userData/cowork/pi/auth.json`; changing that path would orphan
  current logins.
- Maestro delegates Codex auth checks/login/logout to the same service. AI-CRMS remains
  Maestro-owned.
- The command bar may start Connect/Reconnect. Disconnect remains in Resources, is
  application-wide, and the UI says so.

### Analysis ownership

`CoinAiAnalysisService` owns model/effort preference, one bounded analysis run at a time,
cancellation, schema validation, and AI receipts. It never changes Maestro's provider/model/session
state and never imports Maestro chat, agent, browser, or tool contracts.

The selectable Codex models are GPT-5.5 plus the GPT-5.6 family: Luna, Sol, and Terra. A persisted
GPT-5.5 preference remains GPT-5.5; older GPT-5.4 preferences normalize to `gpt-5.6-sol` on
load/save, while historical AI receipts may still display the model that actually generated them.
GPT-5.5, Luna, and Terra expose `low`, `medium`, `high`, and `xhigh`; Sol exposes `medium`, `high`,
and `xhigh` only. `xhigh` is shown as `Extra`.

Each explicit **Review thesis** action sends a size-bounded JSON snapshot containing the selected
asset, the user's verbatim thesis and supplied position/risk context, observed facts, deterministic
scores, source receipts, warnings, missing dimensions, the pinned strategy revision, and evidence
IDs. User text is an untrusted hypothesis and cannot become evidence. Codex runs with tools disabled
and must return strict JSON:

```ts
interface CoinAiAnalysisResult {
  schema: 'coin-ai-analysis-v1';
  summary: string;
  attentionThesis: string[];
  risks: string[];
  evidenceRefs: string[];
  unsupportedClaims: string[];
  confidence: number;
}
```

The host rejects invalid JSON/schema/evidence references and shows an actionable error. AI text is
labelled interpretation and cannot manufacture a source fact. The UI must present counter-evidence,
unsupported claims, and missing inputs beside the recommendation. Deterministic risk gates and the
position rule still control the final `BUY/HOLD/SELL` result.

## X Research Browser

`CoinXBrowserService` owns one Chrome context in Electron main. The menubar preference selects
`visible` (`headless: false`) or `hidden` (`headless: true`) for Playwright
`launchPersistentContext`, using system Chrome and one dedicated directory below
`userData/coin/x-research-profile/`. The directory is machine-local, secret-bearing browser state;
it is never persisted in Coin JSON, synchronized, logged, or included in evidence exports. Only the
non-secret display preference is persisted in Coin state.

The first visible launch opens X for manual login and two-factor completion. Later visible or hidden
launches reuse that dedicated session. Changing the display preference while active restarts the
same query. A hidden login requirement asks for visible mode and never silently changes mode. The
service exposes only bounded states (`closed`, `launching`, `login_required`, `ready`, `error`) and
operations (`getStatus`, `open`, `focus`, `close`) to the renderer. External CDP attachment controls
its own visibility, so the menubar switch is disabled in that mode.

The service must not point Playwright at the regular Chrome default user-data directory, copy its
Cookie database, or require the user to close daily Chrome. Chrome 136 and Playwright do not support
that default-profile automation path. Optional CDP attachment is loopback-only and may target only a
Chrome process already launched for the Trench non-default profile. A configured CDP connection
that fails returns an error; it never falls back to a different profile or source.

When X collection is implemented, accessibility locators identify targets and read fresh bounding
boxes. All mouse move, wheel, press, and release events are issued through `CDPSession` input calls.
Login expiry or challenge pages pause for user action in the visible Chrome; the system does not
bypass them.

## Resources page

### Codex

Show account state, Connect/Disconnect, GPT-5.5 plus GPT-5.6 model selection, model-specific effort
selection, last verification, and the application-wide disconnect consequence. Every action has
loading and duplicate-submit protection.

### GMGN CLI

- Detect `gmgn-cli`, resolved executable path, and version without using a shell.
- When absent, show a copyable `yarn global add gmgn-cli` command and the installation guide.
- Open the personal API key page in the system browser; never scrape or embed GMGN web pages.
- Accept `GMGN_API_KEY` through a local credential modal and write only
  `~/.config/gmgn/.env` with mode `0600`. Never request or write `GMGN_PRIVATE_KEY`.
- Verify with an allowlisted read-only command such as `market trending`; run via `execFile`/spawn
  with `shell: false`, timeout, output cap, sanitized error, and no renderer-provided command.
- A configured deployed Meme service is preferred in explicit `service` mode. Explicit `local`
  mode runs only fixed read-only templates for trending, hot searches, trenches, token info,
  security, holders, and traders. Commands are serial, cancellable, cooldown-limited, bounded by
  timeout/output caps, and always use `shell: false`.
- Local Discover starts at most one trenches command per polling interval and enforces a 60-second
  minimum. It never fans out one process per candidate.

### Services and deferred sources

Service base overrides are validated `https` URLs in production. Alchemy is deferred from the
current release: it is not a local-mode prerequisite, is not shown in Resources or Sources, and has
no renderer IPC capability. The existing main-process adapter and encrypted-store implementation
remain dormant for a future tracked task.

Detailed human steps live in [`coin-data-sources.md`](../guides/coin-data-sources.md) and
[`gmgn-cli.md`](../guides/gmgn-cli.md).

## State and persistence

Coin uses no hidden SQLite renderer. Main-process services write owner-only state below
`userData/coin/`:

| File | State |
|---|---|
| `coin-state.json` | active token, source-safe drafts, Scan/Focus state, analyses, decisions, AI receipts, and history; legacy active-page values are migration input only |
| `resources.enc` | Reserved encrypted resource values; dormant Alchemy data remains forward-compatible |
| `window-state.json` | validated geometry |
| `x-research-profile/` | Chrome-owned session state shared by visible/hidden Trench modes; machine-local and excluded from app JSON/sync/logs |

Codex tokens remain in the shared Pi auth file. GMGN uses its standard owner-only config file and is
not copied into Coin state. Malformed state produces a visible recovery error; it is not silently
treated as valid empty history.

Renderer stores are `reactive` wrappers around class instances. Instance fields contain only
renderable or serializable state; function-valued listeners, unsubscribe callbacks, timers, and
other lifecycle handles remain module-scoped outside the reactive class instance. Class behavior
uses prototype methods.

## IPC and security

Home uses the narrow `electron-xpc` launch emitter. The local Coin renderer uses a dedicated
`contextBridge` and sender-checked `ipcMain.handle` surface because generic XPC does not retain sender
identity for privileged resources.

```text
state.load / state.save / state.recover
data.getSources / data.monitor / data.refreshMonitor / data.parseScreener / data.screen
data.analyzeMeme / data.startDiscover / data.stopDiscover / data.cancel
strategy.evaluate
resources.getStatus / resources.detectGmgn
resources.saveGmgnApiKey / resources.verifyGmgn / resources.openGuide
codex.getStatus / codex.connect / codex.disconnect
clipboard.readText
xBrowser.getStatus / xBrowser.open / xBrowser.focus / xBrowser.close
ai.analyze / ai.cancel
window.minimize / window.toggleMaximize / window.close
```

Main rejects calls not sent by the live Coin window. Secrets and full credential-bearing endpoints
are never returned. Resource operations accept typed values, not arbitrary commands or paths.

No wallet private key, seed phrase, signing request, swap, leverage order, or automated trading is
in scope. Coin provides analysis and decisions only.

## Loading and error states

- Every request-triggering button has a visible loading state and ignores duplicate submissions.
- Current results stay visible during refresh and receive a refreshing marker.
- Empty, unavailable, error, and stale are distinct states with different recovery actions.
- Source receipt timestamps remain visible; stale data is labelled.
- Polling/data requests expose Stop/Cancel and cannot survive window close or auth invalidation.

## Human preparation

1. Install GMGN CLI, create a personal API key, and complete the read-only probe.
2. Curate and version high-profit/control wallet cohorts and labels.
3. Run the seven-day Robinhood capability/sample-density probe before enabling its score.
4. Deploy/configure Monitor and Screener service bases. A deployed Meme service is optional when
   explicit local GMGN mode is configured, and preferred when a Meme base is configured.
5. Supply actual position and risk inputs for position-aware `HOLD` decisions.
6. Connect Codex only when exercising optional structured AI interpretation.
7. Select visible X mode once and complete X login/2FA in the Trench-managed profile; hidden mode can
   reuse that session afterward.

Alchemy, X API, and Helius are optional follow-up sources. The regular Chrome profile, wallet
signing, and exchange credentials are not requested.

## Verification contract

The single-page layout, thesis flow, clipboard command, and selectable X browser display mode remain
owner-verification pending.

- First/repeated Open, close/reopen, geometry, language, auth invalidation, and host-quit cleanup.
- One flat Trench workspace with no core tabs, decorative cards, KPI strip, or body overflow.
- Persistent Paste and analyze, one-shot Terminal, menubar visible/hidden X mode, shared Codex
  status, model, and effort controls.
- Scan, Focus, active token, and bounded Decision remain in one context; Resources/History restore
  that context after closing.
- X uses a dedicated persistent profile, requires one manual login, survives close/reopen, and never
  mounts or copies the regular Chrome profile.
- The menubar display preference survives restart; switching an active managed context reopens the
  same query, while hidden login requirements remain explicit.
- Loading/empty/unavailable/error states retain the previous snapshot and never automatically fall
  back to another source or profile.
- Resource credential masking, `safeStorage`, owner-only file modes, GMGN command allowlist, no
  shell execution, no private key, and install/probe error handling.
- Monitor/Screener real local HTTP fixture tests and complete Meme result rendering.
- Deterministic `BUY/HOLD/SELL` fixtures and position-dependent `HOLD` gate.
- Codex shared login plus strict thesis/JSON/schema/evidence validation with no general
  chat/provider/tool surface.
- Sender-denial tests for every privileged IPC group.
- `yarn typecheck:node`, focused renderer typecheck, `yarn build`, and Electron Playwright at
  `1360x860` and `800x600` with screenshot and overflow checks.
