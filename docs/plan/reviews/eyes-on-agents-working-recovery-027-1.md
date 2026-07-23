# EyesOnAgents Working Recovery Review — Round 2

Status: accepted

Date: 2026-07-23

Task: [eyes-on-agents-working-recovery-027](../tasks/eyes-on-agents-working-recovery-027.md)

## Verdict

**Implementation: Closed.** Distinct `app_server_turn` provenance closes Round 1's manual Refresh
race without weakening process-local App Server invalidation, Hook precedence, Focus semantics, or
the connection gate for rendered active state. No open P1, P2, or P3 finding remains.

## Round 1 P2 resolution

Round 1 found that labelled Refresh's full inventory phase could replace a recovered App
Server-sourced active row with `discovery + unknown`, clear its exact turn ID, and leave the later
terminal detail pass unable to reconcile that turn.

The final implementation separates persisted newest-turn proof from process-local lifecycle state:

- Working recovery atomically records `working`, the exact ID and provider start time under
  `app_server_turn`; terminal reconciliation also writes `app_server_turn` and compares the selected
  source, exact active ID, and status watermark
  (`src/preload/sqlite/dao/eyesOnAgents.dao.ts:846-915`).
- Full discovery upsert may replace only existing `app_server` or `discovery` evidence. Its runtime,
  active flags, identity, source, and watermark branches therefore preserve `app_server_turn`
  (`src/preload/sqlite/dao/eyesOnAgents.dao.ts:998-1051`). Reconnect invalidation likewise targets
  only exact `app_server` rows (`src/preload/sqlite/dao/eyesOnAgents.dao.ts:943-959`).
- Real SQLite regressions recover an active turn, preserve it through newer `notLoaded` discovery
  and reconnect invalidation, reconcile its exact terminal result, then preserve that terminal
  state and completion identity through another full discovery sync and reconnect
  (`scripts/eyes-on-agents/repository.test.mjs:1675-1835`). This composes with the existing service
  regression proving labelled Refresh runs the detail repair after full sync
  (`scripts/eyes-on-agents/core.test.mjs:2104-2183`).
- `app_server_turn` remains metadata provenance rather than a runtime-event source. Snapshot
  projection renders its active state only while the managed App Server reader is connected
  (`src/shared/eyesOnAgents/eyesOnAgents.contract.ts:299-333`), with connected/disconnected and
  event-source rejection regressions in `scripts/eyes-on-agents/core.test.mjs:218-265`.

The task, issue, feature, and integration documents now consistently distinguish process-local
`app_server` lifecycle evidence from durable `app_server_turn` metadata and require preservation
across manual Refresh's sync-before-detail order.

## Findings resolved during Round 2

No open P1, P2, or P3 finding remains.

- Round 1's P2 is closed by the distinct persisted-turn provenance and preservation evidence above.
- A final P3 documentation sweep found two older integration statements that prohibited every
  tiered runtime patch. They now prohibit only process-local `thread/read.status` inference and
  explicitly allow guarded newest-turn working recovery and exact-ID terminal reconciliation
  (`docs/integrations/eyes-on-agents.md:214-218,262-265`).

## Required-behavior acceptance

| Required behavior | Evidence | Status |
|---|---|---|
| Focus membership semantics remain unchanged | `isEyesOnAgentsFocused` and the renderer Focus projection are untouched; recovery and terminal repository regressions remain unread and focused. | Pass |
| Candidate is exactly non-archived, unread, `discovery + unknown`, no active turn, with a concrete watermark | Selection is bounded by archive, unread, exact state/source, null identity, and non-null watermark predicates. | Pass |
| One descending, limit-one, `itemsView: notLoaded` metadata request for either recovery or active terminal work | The supervisor issues one content-free newest-turn request, projects only ID/status/start/completion, and rejects non-empty items. Core tests count one request per eligible candidate. | Pass |
| Recovery accepts only exact `inProgress` identity plus valid persisted non-future `startedAt` | Main requires a bounded real ID, exact status, safe integer provider seconds, and a converted timestamp no later than the captured poll time. Invalid shapes fail closed. | Pass |
| No `thread/list.status`, `thread/read.status`, content, transcript, or elapsed-time inference for recovery | Runtime recovery derives only from newest-turn metadata; a throwing `thread/read.status` getter is covered. Optional consented question capture remains independent. | Pass |
| Explicit shared refresh patch is validated | The shared parser allowlists all fields, requires `app_server_turn`, validates source/watermark/ID/timestamps, and rejects simultaneous recovery plus completion. | Pass |
| SQLite recovery is atomic against Open, archive, newer Hook/status, watermark change, replacement active turn, and completed same ID | One guarded update contains every required predicate, and real repository regressions exercise every named no-op. | Pass |
| Real Hook evidence supersedes recovered evidence | A newer Hook mutation changes source/state/identity; delayed recovery and terminal patches then fail their exact CAS. The repository test confirms Hook takeover. | Pass |
| Recovered App Server turns receive exact-ID terminal cleanup across polling, manual full sync, and reconnect | `app_server_turn` identity survives discovery/reconnect, remains selectable, and commits the mapped terminal outcome and completion metadata. | Pass |
| Hot-first/cold-round-robin paging, one request per selected task, cancellation fencing, silent polling, and field-level writes remain intact | The implementation reuses the existing batch/paging/cancellation pipeline; the full focused suite's paging, overlap, teardown, and silent-error regressions pass. | Pass |
| Polling and labelled manual Refresh share the repair path | Both reach `performRefreshThreadPages`; preserved provenance makes the existing sync-before-detail manual order safe for active and terminal proof. | Pass |
| Existing terminal-without-`completedAt` Stop contract is unchanged | Terminal parsing still requires persisted completion time and otherwise performs no mutation. | Pass |
| Canonical task, issue, feature, and integration contracts describe the implemented runtime repair consistently | All four sources distinguish forbidden process-local status inference from allowed guarded newest-turn working/terminal proof. | Pass |

## Verification

| Command | Result |
|---|---|
| `yarn test:eyes-on-agents` | Pass — Core, project resolver, repository, App Server, bridge/durable delivery, project filter, and 35 UI/activation source tests exited 0. |
| `yarn typecheck:node` | Pass. |
| `yarn typecheck:eyes-on-agents:core` | Still blocked only by the two pre-existing `rawInput: unknown` errors in unchanged `src/shared/eyesOnAgents/codexHookBridge.contract.ts:274,292`; no task-027 error was reported. |
| `git diff --check` | Pass against the final implementation and review diff. |

No Electron process, package, release, commit, or implementation mutation was run. Only this owned
review artifact was updated by the reviewer.

## Conclusion

**Pass / accepted.** The original manual Refresh terminal-loss race is closed with narrow persisted
turn provenance. Recovery remains metadata-only and fail-closed, exact identity survives the full
sync/reconnect boundaries that previously erased it, terminal cleanup retains its CAS guards,
disconnected active proof cannot render as live, and the canonical documents now match that behavior.
