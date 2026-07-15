# Coin Sub-application

Status: Planned delivery contract

## Purpose

Add **Coin** to Bitterless Mini Apps as an authenticated desktop workspace for cryptocurrency
research and decisions. Coin is one full-width local analysis panel organized by business tabs. It
has no chat region, message composer, remote browser, address bar, Workbench, or Maestro tools.

Codex remains an application resource: the user connects a Codex account from Coin's **Resources**
page, and Bitterless invokes it behind explicit analysis actions to transform structured evidence
into a validated structured result. The user never chats with Codex inside Coin.

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
              +-- Resources (Codex, GMGN CLI, Alchemy, service readiness)

Coin preload -- allowlisted, sender-checked IPC --> main Coin services
       +-- CoinDataService
       +-- CoinStateService
       +-- CoinResourceService
       +-- CoinAiAnalysisService

Host-owned CodexCredentialService
       +-- Coin background analysis consumes
       +-- Maestro delegates Codex auth to the same service
```

The renderer never receives Codex tokens, stored resource secrets, filesystem access, arbitrary IPC,
Node.js access, Maestro's preload, browser automation, wallet signing, or trading credentials.

## User entry and lifecycle

| Event | Required behavior |
|---|---|
| Mini Apps renders | Show a bilingual Coin card with its own icon and Open action. |
| First Open | Create one Coin window, load persisted Coin state, then show it. |
| Repeated Open | Await any active boot, restore/focus the same window, and never create a duplicate. |
| Window close | Abort active polling/data/AI work, flush Coin state, and destroy the window. |
| Auth invalidation/logout | Lock new opens, abort work, and destroy Coin before the secondary-window sweep. |
| Auth activation | Unlock Coin opening; do not open it automatically. |
| Host quit/update | Await Coin cleanup before destroying host resources. |

Default size is `1360x860`; minimum size is `800x600`. Geometry is persisted under
`userData/coin/window-state.json` and restored only when visible on a connected display.

## Pages and tabs

| Page | Job | Current readiness |
|---|---|---|
| Monitor | Watch selected symbols, price/range, listing age, freshness, and connection state. | Ready when filter API/WebSocket bases are configured. |
| Screener | Parse structured/natural-language filters and rank futures/spot symbols. | Existing parse/screen backend contracts are ready. |
| Meme | Discover recently filled tokens or analyze one `chain + CA` with holder, cohort, and attention evidence. | UI/contract in scope; live output requires configured GMGN/Alchemy or Meme service. |
| Strategy | Convert structured evidence, risk, and optional position into exactly `BUY`, `HOLD`, or `SELL`. | Local deterministic contract is in scope. |
| History | Reopen analyses, decisions, AI receipts, and source receipts. | Stored locally by Coin. |
| Resources | Configure and verify Codex, GMGN CLI, Alchemy, and service endpoints. | Local machine configuration; secrets never enter project files. |

Sources status is available from the header and Resources page. It shows configuration, support,
read-only status, freshness, cooldown, and the latest failure reason.

## Data contracts

### Source configuration

Non-secret service bases may be supplied by build/runtime configuration or a validated user
override. Secret-bearing GMGN/Alchemy configuration is owned by `CoinResourceService`.

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
  chain: 'robinhood' | 'bsc' | 'solana';
  contractAddress: string;
  position?: {
    entryPrice: number;
    remainingAmount: number;
    investedAmount: number;
    peakPrice?: number;
    heldMinutes?: number;
  };
  plannedEntryAmount?: number;
  riskBudget?: number;
}
```

The response must render at least:

- total holders and Top 10/Top 100 concentration;
- GMGN fresh-wallet, bot/degen, and entrapment-trader rates when supplied;
- Top 100 curated-library, Robinhood, BSC, and PVP hit counts plus holding share;
- EOA-only holder count/share and the same cohort breakdown after excluding contracts, pools, and
  black-hole addresses;
- ranked key wallets with label, cohort, holding share, realized/unrealized evidence, and reason;
- current popular concepts/narratives and attention-potential evidence;
- source names, observation times, unsupported fields, warnings, and confidence.

Every percentage has a numerator/denominator or source receipt. Missing evidence is `null` with a
reason, never `0`.

### Attention analysis

Attention potential is an evidence group, not an intuition-only score. It may include narrative fit,
mention velocity, unique-author growth, holder/address growth, liquidity/volume/imbalance velocity,
cohort accumulation, distribution change, creator history, pool state, and concentration/risk
penalties. The UI distinguishes observed facts, derived scores, AI interpretation, and unavailable
dimensions.

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

Show account state, Connect/Disconnect, model, effort, last verification, and the application-wide
disconnect consequence. Every action has loading and duplicate-submit protection.

### GMGN CLI

- Detect `gmgn-cli`, resolved executable path, and version without using a shell.
- When absent, show a copyable `yarn global add gmgn-cli` command and the installation guide.
- Open the personal API key page in the system browser; never scrape or embed GMGN web pages.
- Accept `GMGN_API_KEY` through a local credential modal and write only
  `~/.config/gmgn/.env` with mode `0600`. Never request or write `GMGN_PRIVATE_KEY`.
- Verify with an allowlisted read-only command such as `market trending`; run via `execFile`/spawn
  with `shell: false`, timeout, output cap, sanitized error, and no renderer-provided command.
- Production polling uses the HTTP adapter when deployed; the CLI remains a local setup/probe and
  fixture oracle rather than a per-request production subprocess.

### Alchemy and services

Alchemy HTTP/WSS endpoints are accepted only in the main process, encrypted with Electron
`safeStorage`, persisted in an owner-only file, and returned to the renderer only as masked readiness
metadata. Service base overrides are validated `https` URLs in production. The page reports chain
capability/probe status separately for Robinhood Chain, BSC, and Solana.

Detailed human steps live in [`coin-data-sources.md`](../guides/coin-data-sources.md) and
[`gmgn-cli.md`](../guides/gmgn-cli.md).

## State and persistence

Coin uses no hidden SQLite renderer. Main-process services write owner-only state below
`userData/coin/`:

| File | State |
|---|---|
| `coin-state.json` | active page, source-safe preferences, watches, analyses, decisions, AI receipts |
| `resources.enc` | Alchemy and other secret resource values encrypted by `safeStorage` |
| `window-state.json` | validated geometry |

Codex tokens remain in the shared Pi auth file. GMGN uses its standard owner-only config file and is
not copied into Coin state. Malformed state produces a visible recovery error; it is not silently
treated as valid empty history.

## IPC and security

Home uses the narrow `electron-xpc` launch emitter. The local Coin renderer uses a dedicated
`contextBridge` and sender-checked `ipcMain.handle` surface because generic XPC does not retain sender
identity for privileged resources.

```text
state.load / state.save
data.getSources / data.monitor / data.refreshMonitor / data.screen / data.analyzeMeme
resources.getStatus / resources.saveAlchemy / resources.detectGmgn
resources.saveGmgnApiKey / resources.verifyGmgn / resources.openGuide
codex.getStatus / codex.connect / codex.disconnect
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
- Source and AI receipt timestamps remain visible; stale data is labelled.
- Polling and AI analysis expose Stop/Cancel and cannot survive window close or auth invalidation.

## Human preparation

1. Connect a Codex account from Resources on each machine.
2. Install GMGN CLI, create a personal API key, and complete the read-only probe.
3. Create an Alchemy application for Robinhood Chain, BSC, and Solana and configure read-only
   endpoints through Resources/private ops.
4. Curate and version high-profit/control wallet cohorts and labels.
5. Run the seven-day Robinhood capability/sample-density probe before enabling its score.
6. Deploy/configure Monitor, Screener, and Meme service bases for production.
7. Supply actual position and risk inputs for position-aware `HOLD` decisions.

X API and Helius remain optional follow-up sources. Wallet signing and exchange credentials are not
requested.

## Verification contract

- First/repeated Open, close/reopen, geometry, language, auth invalidation, and host-quit cleanup.
- One full-width local Coin renderer; no chat/composer, hidden Coin SQLite, browser, or remote view.
- All five analysis tabs plus Resources, Sources, loading/empty/unavailable/error states, and no
  automatic sample fallback.
- Resource credential masking, `safeStorage`, owner-only file modes, GMGN command allowlist, no
  shell execution, no private key, and install/probe error handling.
- Monitor/Screener real local HTTP fixture tests and complete Meme result rendering.
- Deterministic `BUY/HOLD/SELL` fixtures and position-dependent `HOLD` gate.
- Codex shared login, one login mutex, strict AI JSON/schema/evidence validation, cancellation,
  Coin/Maestro isolation, and no chat/provider/tool surface.
- Sender-denial tests for every privileged IPC group.
- `yarn typecheck:node`, focused renderer typecheck, `yarn build`, and Electron Playwright at
  `1360x860` and `800x600` with screenshot and overflow checks.
