# EyesOnAgents Delivery Analysis

## Goal decomposition

Delivery is complete when Ral can open a standalone EyesOnAgents Mini App, connect a persistent
Codex App Server, see Codex-only threads grouped into Domains, use Focus to find active or newly
completed unread work, and open the exact task in Codex with read state preserved across restarts.

## Decisions resolved before implementation

| question | decision |
|---|---|
| provider scope | Codex only; remove Claude from active runtime/UI/tests |
| application surface | singleton standalone Mini App; remove old Home route |
| App Server ownership | Bitterless-managed persistent stdio process |
| Codex Desktop visibility | optional existing Codex hook bridge, shown as a separate evidence source |
| classification | dedicated Domain table with immutable `Uncategorized` default |
| Focus | derived active + completed-unread projection |
| unread | completed/opened turn IDs first, timestamps as fallback |
| opening | validated `codex://threads/<id>` in main process; mark read only after success |
| messages | deferred; no false `queue` RPC abstraction |

## Module decomposition

| module | inputs | outputs |
|---|---|---|
| shared contract | App Server/hook lifecycle metadata | strict Codex-only DTOs and validators |
| SQLite repository | discovered threads, events, Domain mutations, opens | one board snapshot and durable read state |
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
| Sync -> paged `thread/list` -> SQLite | every validated Codex thread appears once in Uncategorized |
| reconnect/sync -> upsert | existing Domain/read state remains unchanged |
| App Server notification -> repository -> XPC broadcast | active and completion state updates without refresh |
| Codex hook -> local bridge -> repository | Desktop lifecycle appears with `codex_hook` source |
| completion -> Focus | newly completed unseen turn appears; historical import does not |
| Open -> exact deep link -> mark opened | successful open removes completed unread; failed open does not |
| Domain drag/menu -> repository | assignment survives renderer and application restart |
| delete Domain -> transaction | threads move to Uncategorized and Domain is soft-deleted |
| auth/app shutdown -> cleanup | window and Bitterless-owned App Server process close cleanly |

## Primary risks and controls

| risk | control |
|---|---|
| separate App Server is mistaken for Desktop state | label source; `notLoaded -> unknown`; retain optional hook source |
| old threads flood Focus | migration/sync never creates completion markers |
| active thread opened before completion becomes unread again | persist active/completed/opened turn identity |
| Domain deletion loses tasks | transactionally reassign before soft delete |
| stale runtime state looks live | persist observation time and apply freshness expiry |
| renderer launches arbitrary commands/URLs | renderer submits only validated IDs and allowlisted actions |
| refactor captures unrelated dirty worktree changes | edit surgically; stage only EyesOnAgents paths/hunks |

## Delivery unit

The vertical slice is tracked by
[eyes-on-agents-001](../tasks/eyes-on-agents-001.md). It intentionally covers data, runtime, window,
renderer, migration, retirement, and acceptance together because these pieces share one observable
contract and cannot be truthfully verified in isolation.
