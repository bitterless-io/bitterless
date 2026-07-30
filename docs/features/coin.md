# Trench Sub-application

Status: Analysis workspace and background Codex analysis implemented; Trench Mini Apps entry restored; owner verification pending

## Purpose

Trench is the user-visible name for the existing Coin runtime. It remains integrated as an
authenticated desktop workspace for trench research and decisions. Its Home Mini Apps card launches
the singleton Trench window while its runtime, window lifecycle, packaged resources, and persisted
data stay intact. Trench is one full-width local analysis panel organized by business tabs. It has
no chat region, message composer, remote browser, address bar, Workbench, or Maestro tools.

Trench provides source-backed Monitor, Screener, Meme, History, deterministic Strategy, and bounded
background Codex interpretation for stored structured results. The user never chats with Codex
inside Trench.

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
              +-- Monitor / Screener / Meme / Strategy / History
              +-- Resources (Codex, GMGN CLI, service readiness)

Coin preload -- allowlisted, sender-checked IPC --> main Coin services
       +-- CoinDataService
       +-- CoinStateService
       +-- CoinResourceService
       +-- CoinStrategyService

CoinAiAnalysisService
       +-- narrow host CodexRuntimeService

Host-owned CodexCredentialService
       +-- Coin background analysis consumes
       +-- Maestro delegates Codex auth to the same service
```

The renderer never receives Codex tokens, stored resource secrets, filesystem access, arbitrary IPC,
Node.js access, Maestro's preload, browser automation, wallet signing, or trading credentials.

## User entry and lifecycle

| Event | Required behavior |
|---|---|
| Mini Apps renders | Render the Trench card and route Open through the narrow Home `openCoinWindow` contract. |
| First Open | Create one Trench window, load persisted Coin runtime state, then show it. |
| Repeated Open | Await any active boot, restore/focus the same window, and never create a duplicate. |
| Window close | Abort active polling/data work, flush Coin state, and destroy the window. |
| Auth invalidation/logout | Lock new opens, abort work, and destroy Coin before the secondary-window sweep. |
| Auth activation | Unlock Coin opening; do not open it automatically. |
| Host quit/update | Await Coin cleanup before destroying host resources. |

Default size is `1360x860`; minimum size is `800x600`. Geometry follows the shared
[top-level window state contract](window-state-persistence.md); the legacy
`userData/coin/window-state.json` value is imported once when the unified Coin key is absent.

## Pages and tabs

| Page | Job | Current readiness |
|---|---|---|
| Monitor | Watch selected symbols, price/range, listing age, freshness, and connection state. | Implemented; requires configured HTTP and WebSocket bases. |
| Screener | Parse structured/natural-language filters and rank futures/spot symbols. | Implemented; live/sample selection is explicit. |
| Meme | Discover recently filled tokens or analyze one `chain + CA` with holder, cohort, and attention evidence. | Implemented in explicit service or local GMGN CLI mode. |
| Strategy | Convert structured evidence, risk, and optional position into exactly `BUY`, `HOLD`, or `SELL`. | Deterministic v1 implemented; no execution. |
| History | Reopen analyses, decisions, and source receipts. | Versioned owner-only JSON persistence implemented. |
| Resources | Configure and verify Codex, GMGN CLI, and service endpoints. | Local machine configuration; secrets never enter project files. |

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
  mode: 'service' | 'local';
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

Coin exposes one AI identity: **Codex** (`openai-codex`). There is no chat UI, free-form prompt,
provider selector, AI-CRMS entry, Anthropic entry, browser tool, skill tool, wallet tool, or trading
tool.

### Credential ownership

- `CodexCredentialService` is a main-process singleton for status, one login mutex, browser/device
  authorization, timeout cleanup, refresh, and logout.
- Existing credentials remain at `userData/cowork/pi/auth.json`; changing that path would orphan
  current logins.
- Maestro delegates Codex auth checks/login/logout to the same service. AI-CRMS remains
  Maestro-owned.
- Resources is the only Coin page that starts connect/disconnect. Disconnect is application-wide
  and the UI says so.

### Analysis ownership

`CoinAiAnalysisService` owns model/effort preference, one bounded analysis run at a time,
cancellation, schema validation, and AI receipts. It never changes Maestro's provider/model/session
state and never imports Maestro chat, agent, browser, or tool contracts.

The selectable Codex models are limited to the GPT-5.6 family: Luna, Sol, and Terra. Older persisted
preferences for GPT-5.5 or GPT-5.4 are normalized to `gpt-5.6-sol` on load/save; historical AI
receipts may still display the model that actually generated them. Luna and Terra expose `low`,
`medium`, `high`, and `xhigh`; Sol exposes `medium`, `high`, and `xhigh` only. `xhigh` is shown as
`Extra`.

Each explicit **Analyze with AI** action sends a size-bounded JSON snapshot containing the selected
asset, observed facts, deterministic scores, source receipts, warnings, missing dimensions, strategy
input, and evidence IDs. Codex runs with tools disabled and must return strict JSON:

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
labelled interpretation and cannot manufacture a source fact. Deterministic risk gates and the
position rule still control the final `BUY/HOLD/SELL` result.

## Resources page

### Codex

Show account state, Connect/Disconnect, GPT-5.6 model selection, model-specific effort selection,
last verification, and the application-wide disconnect consequence. Every action has loading and
duplicate-submit protection.

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
| `coin-state.json` | active page, source-safe drafts, watches, analyses, decisions, source receipts/history |
| `resources.enc` | Reserved encrypted resource values; dormant Alchemy data remains forward-compatible |
| `window-state.json` | validated geometry |

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
window.minimize / window.toggleMaximize / window.close

Future: ai.analyze / ai.cancel
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

Alchemy, X API, and Helius are optional follow-up sources. Wallet signing and exchange credentials
are not requested.

## Owner verification pending

Focused unit fixtures and Electron assertions were authored, but no test, typecheck, lint, build,
Electron, screenshot, git-diff, or other verification command was run for
`coin-analysis-workspace-003`, following the owner's explicit instruction. The remaining contract
below must be exercised by the owner/integration task before this feature is called verified.

- First/repeated Open, close/reopen, geometry, language, auth invalidation, and host-quit cleanup.
- One full-width local Coin renderer; no chat/composer, hidden Coin SQLite, browser, or remote view.
- All five analysis tabs plus Resources, Sources, loading/empty/unavailable/error states, and no
  automatic sample fallback.
- Resource credential masking, `safeStorage`, owner-only file modes, GMGN command allowlist, no
  shell execution, no private key, and install/probe error handling.
- Monitor/Screener real local HTTP fixture tests and complete Meme result rendering.
- Deterministic `BUY/HOLD/SELL` fixtures and position-dependent `HOLD` gate.
- Codex shared login and strict AI JSON/schema/evidence validation are implemented with no
  chat/provider/tool surface; runtime owner verification remains pending.
- Sender-denial tests for every privileged IPC group.
- `yarn typecheck:node`, focused renderer typecheck, `yarn build`, and Electron Playwright at
  `1360x860` and `800x600` with screenshot and overflow checks.
