# Coin Sub-application Analysis

Status: shell/resources/analysis/background AI implemented; owner verification and integration pending

## Goal decomposition

Delivery is complete when an authenticated user can open one Coin desktop window, use a full-width
local business-tabbed analysis console, configure required accounts/resources on each machine, and
run evidence-grounded background Codex analysis without any chat surface. Documentation, lifecycle
cleanup, source truthfulness, credential isolation, and machine portability are product behavior.

## Module decomposition

| Module | Inputs | Outputs | Dependencies | Delivery task |
|---|---|---|---|---|
| Coin window lifecycle | Mini App Open, auth/quit, geometry | one focused local `BrowserWindow` | host lifecycle | `coin-subapp-shell-001` |
| Coin scoped bridge | typed local requests + sender identity | allowlisted replies/events | Electron IPC/contextBridge | all tasks |
| Renderer shell | locale, active page, source/AI status | full-width tabbed console | Arco, Royal Blue | `coin-subapp-shell-001` |
| Resource configuration | Codex login, GMGN key/CLI, Alchemy values | masked readiness/probe receipts | safeStorage, filesystem, execFile | `coin-resource-settings-002` |
| Coin state | drafts, watches, analyses, decisions, source receipts/history | atomic owner-only state | `userData/coin` | `coin-analysis-workspace-003` |
| Source adapters | configured sources + structured requests | typed results/unavailable/errors | filter/screen/meme/GMGN/Alchemy | `coin-analysis-workspace-003` |
| Strategy engine | evidence, risk, optional position | deterministic BUY/HOLD/SELL | versioned contract | `coin-analysis-workspace-003` |
| Codex credentials | browser/device login | app-wide auth state | Pi AuthStorage | `coin-ai-analysis-004` |
| Background AI | bounded evidence snapshot | validated analysis JSON/receipt | Codex credentials/runtime | `coin-ai-analysis-004` |
| Integration/E2E | complete implementation | lifecycle/security/visual evidence | all modules | `coin-subapp-integration-005` |

## Existing capabilities to reuse

| Existing implementation | Reuse decision |
|---|---|
| Home Mini Apps card/action | reuse with Coin launch emitter and per-card loading |
| Maestro singleton/cleanup lessons | reuse lifecycle semantics, not its multi-view graph |
| application language service | reuse before Coin Vue mount and for live updates |
| Pi auth at `userData/cowork/pi/auth.json` | preserve path; extract host credential ownership |
| Maestro Pi runtime behavior | reuse normalized runtime concepts only; no Maestro agents/tools/chat |
| filter monitor endpoints | typed host adapter |
| coin-filter parse/screen endpoints | typed host adapter |
| `areas/trench/earn/meme/strategy` contracts | result/decision fixtures and source boundaries |
| official `gmgn-cli` | fixed serial read-only templates for explicit local analysis/discovery mode |
| Electron `safeStorage` pattern | encrypted Alchemy/resource values in owner-only Coin state |

## Rejected architectures

### Visible Codex chat or split pane

Rejected by the owner. Coin is an analysis console. Codex is connected in Resources and invoked only
by explicit structured analysis actions. There is no message history, composer, free prompt, or
resizable right pane.

### Copy Maestro's window graph

Rejected. Coin's UI is first-party local content and needs none of Maestro's hidden SQLCipher,
operation `WebContentsView`, browser capture, CDP, or Workbench graph.

### Load deployed `coin-maestro` as a browser pane

Rejected. It creates another auth/session and weakens structured source/AI boundaries. Coin reuses
API contracts through host adapters.

### Reuse Maestro service/session directly

Rejected. It exposes AI-CRMS/provider selection and browser/skill tooling and could mutate Maestro
state. Only the Codex credential service is shared; Coin AI run state is independent.

### Let the renderer run a CLI or hold secrets

Rejected. Renderer input could become command injection and secrets would be inspectable. Main owns
credential files, safeStorage, fixed command templates, timeouts, output caps, and sender checks.

### Add hidden SQLite

Rejected for initial delivery. Versioned atomic JSON and encrypted resource state are sufficient.

## Integration enumeration

| Chain | Required evidence | Task |
|---|---|---|
| Mini Apps card → emitter → window handler | first Open creates one; repeated Open focuses same ID | shell/integration |
| handler → preload → local renderer | one local page, full-width console, no chat/remote view | shell/integration |
| language → Coin mount/live update | correct initial and changed locale | shell/integration |
| auth/quit → Coin abort/flush/destroy | no active polling/AI or orphan window | shell/integration |
| Resources → Codex credential service | one app-wide login mutex/status | resources/AI/integration |
| Resources → GMGN detector | version/path or precise missing state | resources/integration |
| GMGN key modal → main config writer | `0600`, never returned, no private key | resources/integration |
| Verify → fixed execFile command | shell false, allowlist, timeout/output cap | resources/integration |
| Alchemy modal → safeStorage | encrypted owner-only state, masked renderer response | resources/integration |
| data action → sender guard → source adapter | real local fixture request and typed result | analysis/integration |
| missing source → UI | unavailable state and no sample/network fallback | analysis/integration |
| result → state → reopen | prior result restores without re-request | analysis/integration |
| evidence/position → decision | deterministic BUY/HOLD/SELL and HOLD gate | analysis/integration |
| Analyze with AI → bounded snapshot → Codex | strict validated JSON receipt | AI/integration |
| AI invalid/cancelled/late result → UI | no stale overwrite; prior result retained | AI/integration |
| non-Coin sender → privileged IPC | request rejected | every task |

## Data and resource fallback matrix

```text
Configured + supported -> request -> typed response -> render + receipt
Configured + failed    -> prior valid result + error + retry/cooldown
Not configured         -> unavailable + Resources/setup action
Explicit sample mode   -> labelled sample result (Screener only)
AI disconnected        -> deterministic analysis remains usable
Any other missing data -> null + reason; never fabricated zero/sample
```

## Codex extraction seam

```text
src/main/codex/
├─ codexPaths.ts
├─ codexCredential.service.ts
└─ codexRuntime.service.ts      fixed Codex, tools disabled

MaestroLlmService
├─ AI-CRMS and Maestro state remain local
└─ Codex auth delegates to CodexCredentialService

CoinAiAnalysisService
├─ owns model/effort/run/cancel/receipt
├─ sends bounded evidence JSON
├─ validates coin-ai-analysis-v1
└─ never imports Maestro chat/agent/browser/tool contracts
```

## Delivery order

The shared dirty worktree and native dependencies require serial execution:

```text
coin-subapp-shell-001
          |
          v
coin-resource-settings-002
          |
          v
coin-analysis-workspace-003
          |
          v
coin-ai-analysis-004
          |
          v
coin-subapp-integration-005
```

Each develop task receives an independent verifier before the next task. No task may revert, format,
stage, or clean unrelated dirty files.

## Completion evidence

| Requirement | Proof |
|---|---|
| Coin is a Mini App | card source + Electron E2E |
| Analysis-only panel | full-width screenshot and absence of chat/composer/split code |
| Business tabs | all five tab controls and state tests |
| Accounts/resources page | Codex/GMGN/Alchemy/service rows and real status actions |
| Codex login but no chat | OAuth status/connect E2E plus bundle/accessibility audit |
| Bitterless uses AI | strict background AI fixture/live-path integration and persisted receipt |
| GMGN setup/install guide | in-app flow + `docs/guides/gmgn-cli.md` + read-only probe |
| Portable to another computer | code/docs synced; secrets excluded; Resources setup repeatable |
| Existing functionality continues | build, focused Maestro checks, lifecycle E2E |
