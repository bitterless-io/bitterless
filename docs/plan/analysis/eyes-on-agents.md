# EyesOnAgents Delivery Analysis

## Goal decomposition

Delivery is complete when Ral can open a standalone EyesOnAgents Mini App, connect a persistent
Codex App Server, see Codex-only threads grouped into Domains, use Focus to find active or newly
observed unread work, manually Refresh from any recoverable connection state, and open the exact
task in Codex with source snapshots, Domain, and read state preserved across restarts.

## Decisions resolved before implementation

| question | decision |
|---|---|
| provider scope | Codex only; remove Claude from active runtime/UI/tests |
| application surface | singleton standalone Mini App; remove old Home route |
| App Server ownership | Bitterless-managed persistent stdio process |
| Codex Desktop visibility | explicit global Codex observation capability, separate from App Server intent |
| Hook execution | dedicated `ELECTRON_RUN_AS_NODE` helper; never launch the full app main entry |
| Hook reliability | atomic offline outbox, commit-only ACK, and transactional persistent receipt |
| Hook trust | inspect with `hooks/list`; user approves in Codex; Bitterless never writes trust hashes |
| classification | dedicated Domain table with internal immutable `uncategorized` fallback; renderer exposes it through fixed `All` |
| source persistence | exact validated `thread/list` objects in a local-only snapshot table |
| Focus | derived unacknowledged active evidence + persistent unread projection |
| unread | active/list/terminal observations set; successful EyesOnAgents Open clears |
| opening | validated `codex://threads/<id>` in main process; acknowledge current active evidence and mark read only after success |
| messages | deferred; no false `queue` RPC abstraction |

## Module decomposition

| module | inputs | outputs |
|---|---|---|
| shared contract | App Server/hook lifecycle metadata | strict Codex-only DTOs and validators |
| SQLite repository | raw list objects, normalized threads, events, Domain mutations, opens | local source snapshots plus one board snapshot and durable annotations |
| App Server supervisor | installed Codex CLI, JSON-RPC | connection status, thread sync, lifecycle notifications |
| Desktop bridge | opt-in Codex hooks | bounded external lifecycle evidence |
| main XPC/window | renderer intents | allowlisted process/deep-link/window operations |
| standalone renderer | snapshot and broadcasts | Todo-like observation board |
| migration/retirement | legacy Codex rows and old feature paths | non-destructive Codex import; no Claude product path |

## Integration chains

| chain | acceptance evidence |
|---|---|
| Mini Apps card -> XPC -> BrowserWindow | one window is created; a second click focuses it |
| Connect -> spawn -> initialize | status reaches connected only after handshake |
| Sync -> paged `thread/list` -> SQLite | every validated non-archived Codex thread appears in All; new rows use the internal fallback Domain |
| active + archived inventories -> source table | latest validated raw objects survive restart and never reach renderer |
| reconnect/refresh -> upsert | existing Domain/open state remains; running observations set unread |
| App Server notification -> repository -> XPC broadcast | active and completion state updates without refresh |
| Codex hook -> local bridge -> repository | Desktop lifecycle appears with `codex_hook` source |
| hook while Bitterless is closed -> atomic outbox -> replay | event reaches SQLite after launch without opening Electron windows |
| commit -> lost ACK -> replay | persistent receipt prevents applying the same transition twice |
| Review in Codex -> Settings/Hooks -> activation recheck | trust becomes ready without rewriting the exact definitions |
| App Server Disconnect -> observation remains | global hooks and listener intent survive without persistent App Server reconnect |
| active observation/completion -> Focus | running or newly completed thread is unread; historical import does not flood Focus |
| Open -> exact deep link -> mark opened | successful open clears unread; failed open does not; later active observation restores unread |
| tiered metadata poll -> existing row | title/activity/authorized question may change; independent App Server status never replaces Desktop Hook evidence |
| header Refresh while disconnected/error -> connect + reconcile | manual recovery refreshes raw and normalized state without duplicate jobs |
| All Project filter -> renderer snapshot | Project counts span every visible non-archived thread without changing Domain assignment |
| Domain drag/menu -> repository | assignment survives renderer and application restart |
| delete Domain -> transaction | threads move to the internal fallback, remain visible in All, and Domain is soft-deleted |
| auth/app shutdown -> cleanup | window and Bitterless-owned App Server process close cleanly |

## Primary risks and controls

| risk | control |
|---|---|
| separate App Server is mistaken for Desktop state | label source; `notLoaded -> unknown`; retain optional hook source |
| independent metadata read overwrites Hook working | tiered `thread/read` never emits runtime patches; only lifecycle authorities update runtime |
| interrupted task remains working without an interrupt Hook | successful Open acknowledges the current active observation; never guess paused or use a TTL |
| old threads flood Focus | migration/sync never creates completion markers |
| running thread is opened, completes, or remains active | persist explicit unread marker and set it on every accepted attention observation |
| raw source payload leaks prompt preview | local-only table; no renderer DTO, logging, export, or `thread/read` |
| Domain deletion loses tasks | transactionally reassign before soft delete |
| stale runtime state looks live | persist observation time and apply freshness expiry |
| renderer launches arbitrary commands/URLs | renderer submits only validated IDs and allowlisted actions |
| refactor captures unrelated dirty worktree changes | edit surgically; stage only EyesOnAgents paths/hunks |
| global Hook runs while Bitterless is closed | durable bounded outbox plus visible corruption/overflow coverage error |
| re-review bypasses Codex consent | only re-enable exact disabled entries; never write `trusted_hash`; user clicks Trust |
| helper launches full Electron app per event | separate Node-mode build entry and stable shim |

## Delivery unit

The original vertical slice is tracked by [eyes-on-agents-001](../tasks/eyes-on-agents-001.md).
Source persistence, explicit unread transitions, and the manual recovery action are tracked by
[eyes-on-agents-sync-persistence-006](../tasks/eyes-on-agents-sync-persistence-006.md).
The global observation redesign ships as two ordered units: reliable lightweight delivery in
[eyes-on-agents-hook-delivery-007](../tasks/eyes-on-agents-hook-delivery-007.md), followed by
App Server-independent onboarding and trust review in
[eyes-on-agents-global-onboarding-008](../tasks/eyes-on-agents-global-onboarding-008.md). Both are
required for one releasable capability; task 008 must not ship on the previous lossy helper.
