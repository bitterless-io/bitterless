# EyesOnAgents Claude Desktop Visibility And Lifecycle — Independent Acceptance

Status: accepted for non-Electron scope; owner Claude Desktop runtime E2E pending

Date: 2026-08-18

## Verdict

**Implementation: PASS.** There are zero open P1, P2, or P3 findings. Main publishes only Claude
rows with a persisted validated Desktop route while retaining every unmapped row privately, and a
Hook-owned active response now survives thinking, command execution, transcript activity, ordinary
time passage, and Agent View terminal observations until an admitted Hook terminal or an explicit
provider/listener invalidation.

The implementation is accepted for the non-Electron scope. Ral still owns the live Claude Desktop
test required by task 052.

## Findings

- **P1 · blocking:** None.
- **P2 · blocking:** None.
- **P3 · non-blocking:** None.

## Contract matrix

| Contract | Independent result | Evidence |
|---|---|---|
| Mapped/unmapped projection | PASS | `eyesOnAgents.service.ts:799-898` reads the repository snapshot behind the provider-revision fence, preserves every Codex row, and admits a Claude row only while the provider projection is current and `desktopSessionId` is non-null |
| Main-private continuity | PASS | Filtering occurs after repository read and does not mutate SQLite; Domain, unread, latest-question, transcript, receipts, and identity evidence therefore remain available for later reconciliation |
| Cowork remap and ambiguity | PASS | `eyesOnAgents.dao.ts:2030-2224` clears the old capability on a partial identity change/collision and admits the replacement only after complete unique Desktop evidence; repository regressions cover reverse collision and complete remap without creating a second canonical row |
| Open fail-closed | PASS | `eyesOnAgents.service.ts:2227-2246` re-reads the Main-owned Claude target and rejects a missing Desktop identity even though ineligible rows never reach the renderer |
| Provider race fence | PASS | Main retries an asynchronous snapshot if the monotonic provider revision changes, includes that revision in the response, and the renderer store rejects an older revision; the disable-during-snapshot regression passes |
| Hook epoch without timeout | PASS | `eyesOnAgents.dao.ts:842-1023,2352-2384` persists Hook active states with no freshness deadline and excludes `claude_hook` from ordinary expiry; transcript inventory retains rather than renews/ends that epoch |
| Agent View authority | PASS | `eyesOnAgents.dao.ts:2229-2341` skips every Agent View state while a Claude Hook-owned row remains active; complete-snapshot omission expires only Agent View-owned leases |
| Active UI states | PASS | `ThreadCard.vue:15-25` renders the same accessible loader for `working`, `waiting_approval`, and `waiting_input`; rendered-DOM coverage verifies all three and idle absence |
| Older and duplicate terminal events | PASS | Repository timestamp comparison prevents an older Stop from replacing a newer Hook epoch; delivery receipts make replay duplicate-safe before persistence or alert side effects |
| Stop / StopFailure / SessionEnd | PASS | `eyesOnAgents.service.ts:2902-2933` maps Stop to successful completion, StopFailure to failed terminal state, and SessionEnd to ended; focused DAO coverage verifies each terminal boundary and a later valid Stop |
| Startup and resume | PASS | `eyesOnAgents.service.ts:2454-2558` force-invalidates persisted Hook-active rows before observation start, listener start, or outbox replay; failure closes intake and invalidates again |
| Setup, Repair, Refresh, Remove | PASS | The shared install/repair path plus refresh/remove paths stop intake, join/stop the listener, force-invalidate Hook-active state, and only then start/replay or mutate plugin state |
| Provider Off and listener failure | PASS | Disable joins admitted work then force-invalidates both Claude sources before hiding projection; start/replay failures stop intake/listener and force-invalidate without fabricating completion |
| Coverage loss | PASS | `eyesOnAgents.service.ts:2981-2994` closes intake, revokes observation proof, and force-invalidates Hook-active state in the ordered bridge commit chain before later delivery can be admitted |
| Codex preservation | PASS | Visibility and expiry branches are provider-qualified to Claude; every Codex row remains in the snapshot and the existing Codex Hook/App Server paths are untouched |
| Task-047 alert preservation | PASS | A distinct admitted Claude Stop retains its delivery UUID as turn identity and may alert without a preceding prompt or Desktop mapping; duplicate Stop and StopFailure remain silent |
| Task-051 deletion compatibility | PASS | Deleted rows remain excluded by repository projection/actions, late Hook delivery is receipt-first ACK-dropped, and tombstones still outrank JSONL, Agent View, and Hook evidence |

The bridge server's post-listen `error` handler is unchanged by task 052. The reviewed lifecycle
contract is satisfied by the explicit listener start/replay failure paths and ordered coverage-gap
callback; no new post-start transport-failure policy was introduced or required for this task.

## Independent verification

| Check | Result |
|---|---|
| `node --test scripts/eyes-on-agents/claude-visibility-lifecycle.test.mjs` | PASS — 2/2 |
| `node --test scripts/eyes-on-agents/claude-provider-snapshot-race.test.mjs scripts/eyes-on-agents/claude-provider-isolation.test.mjs` | PASS — 6/6 |
| `yarn test:eyes-on-agents:repository` | PASS |
| `node --test scripts/eyes-on-agents/thread-card-open-capability.test.mjs` | PASS — 6/6 |
| `yarn test:eyes-on-agents:claude` | PASS — complete Claude aggregate, including provider suite 25/25 |
| `yarn typecheck:eyes-on-agents:core` | PASS |
| `yarn typecheck:eyes-on-agents:ui` | PASS |
| `yarn check:renderer-i18n` | PASS |
| `git diff --check` | PASS |

`yarn test:eyes-on-agents:ui` passed 66/67 cases. Its only failure is the previously recorded
task-045 stale source assertion in `agent-connections-navigation.test.mjs`, which still requires the
removed `eyesOnAgentsStore.reviewCodexBridge(...)` action. The task-052 ThreadCard, store, activation,
search, provider-logo, project-filter, setup-render, and UI-source cases all passed; this unrelated
historical assertion is not a task-052 finding.

No Electron process, browser E2E, packaged app, Claude configuration mutation, build, commit, or sync
was run. This review changes only this acceptance file and intentionally leaves task 052 status
unchanged.

## Owner acceptance remaining

Run one mapped Claude Desktop Cowork conversation through thinking and a command. Confirm its card
stays in Focus with the loader until Stop, then exits loading and produces the existing one-time
completion alert. Confirm the older/unmapped Cowork row is absent everywhere, while the current
Desktop-mapped row still opens the intended Claude session.

## Conclusion

**PASS / accepted for the verified scope.** Desktop routing is now the admission boundary for every
Claude renderer surface, Hook activity is terminal-event-owned rather than timeout-owned, and the
change remains isolated from Codex, completion alerts, and deletion tombstones.
