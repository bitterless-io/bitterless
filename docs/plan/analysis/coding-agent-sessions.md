# Coding-agent Sessions Delivery Analysis

Status: historical; superseded by
[EyesOnAgents Delivery Analysis](eyes-on-agents.md).

## Goal decomposition

Delivery is complete when the authenticated Bitterless Home page can discover known local Codex
tasks and Claude Code sessions, register explicit provider references, show evidence-backed current
state, open/attach safely, and install/remove privacy-minimal lifecycle bridges.

## Module decomposition

| Module | Inputs | Outputs | Dependencies | Task |
|---|---|---|---|---|
| Shared contract | provider records, status evidence | strict types/validators | none | core-001 |
| SQLite repository | validated records/status mutations | active rows and soft delete | hidden SQLite preload | core-001 |
| Codex discovery/opening | installed CLI, thread store, validated ID | metadata rows, canonical deep link | short-lived App Server, Electron shell | core-001 |
| Claude discovery/opening | installed CLI, Agent View JSON | interactive/legacy-foreground and background rows, attach/resume | execFile, terminal launcher | core-001 |
| Lifecycle event bridge | provider hook JSON | minimal normalized events | local socket/named pipe, SQLite DAO | bridge-002 |
| Hook settings installer | explicit user action | merged/removable provider hooks | user config, pinned Codex shim / Claude exec-form handler | bridge-002 |
| Home renderer | XPC records/events | filters, rows, dialogs, actions | Arco, i18n | ui-003 |
| Integration/E2E | complete real call chains | acceptance evidence | all modules | integration-004 |

## Integration enumeration

| Chain | Required evidence | Task |
|---|---|---|
| hidden SQLite bootstrap -> table/DAO -> main XPC | persisted row survives renderer reload | core/integration |
| Refresh -> Codex App Server `thread/list` -> DAO | IDs/titles import; `notLoaded` stays unknown | core/integration |
| Refresh -> `claude agents --json` -> DAO | background state and `kind="interactive"` (legacy `foreground`) no-state entries are distinct | core/integration |
| Open -> provider adapter -> OS | exact Codex URL; validated Claude attach/resume template | core/integration |
| provider hook -> pinned helper invocation -> local bridge -> DAO | state changes without transcript content | bridge/integration |
| Install/remove -> provider settings | only Bitterless-owned hook entries change | bridge/integration |
| DAO/status change -> XPC broadcast -> renderer reload | visible row changes without payload leakage | ui/integration |
| auth/main window -> route | dashboard remains inside authenticated Home | ui/integration |

## Delivery order

```text
coding-agent-sessions-core-001
              |
              v
coding-agent-sessions-bridge-002
              |
              v
coding-agent-sessions-ui-003
              |
              v
coding-agent-sessions-integration-004
```

Tasks run serially because they share XPC contracts, the hidden SQLite preload, and the installed
native dependency tree. No task may stage, format, or rewrite unrelated Coin worktree changes.

## Completion evidence

| Requirement | Proof |
|---|---|
| every imported Codex ID has an open link | canonical URL unit/integration test |
| external App Server cannot fake Desktop state | `notLoaded -> unknown` contract test |
| Claude command is CLI, not Desktop | fixed `claude agents --json` invocation test and UI copy |
| provider statuses are truthful | normalizer tests and freshness expiry tests |
| no command injection | invalid ID/path tests and shell-free discovery |
| no transcript leakage | helper redaction test and bridge frame test |
| provider settings remain intact | install/remove round-trip fixtures |
| user can operate the feature | authenticated Electron E2E |
