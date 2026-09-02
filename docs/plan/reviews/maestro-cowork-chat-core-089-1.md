# maestro-cowork-chat-core-089 — Review 1

- Date: 2026-08-31
- Scope: independent source review of the Maestro Turn, steering/retry, response status, task,
  confirmation, persistence, renderer-recovery, and LLM-lock migration against task 089 and Cowork
  `67b056b`.
- Method: task/source/diff inspection and complete renderer → shared contract → Main/XPC → runtime
  call-chain audit only. Per the delivery contract, no checks/scripts, tests, typecheck, lint, build,
  Electron, Playwright/E2E, application launch, or network runtime probe was run.

## Findings

No unresolved P0-P2 findings.

The first implementation review identified lifecycle and recovery defects around root ownership,
bounded Stop, stale callbacks, assistant-segment sealing, model locking, tool-side-effect retry,
renderer recovery, and task/confirmation replay. Those findings were repaired before the final
review. The final pass then found one remaining P2: five new Turn terminal/error messages were still
hard-coded in English. They now use strictly matching `maestroControl.chat` English/Chinese keys
with callback-based placeholder interpolation, and the same independent reviewer approved the fix.

## Requirements evidence

| Requirement | Evidence | Result |
|---|---|---|
| Main owns one atomic root Turn | `coach.api.ts` exposes claim/recovery/ack plus explicit root/steering intent; `maestroAgent.service.ts` claims before setup, assigns a monotonic generation, rejects a second root, waits for root start before steering, and releases every undispatched reservation. | pass |
| Runtime events cannot cross Turn generations | Stream, thinking, activity, and retry payloads carry session, Turn, and generation identity. `BaseAgent.ts` fences callbacks/finally blocks by prompt generation, while Main captures nested host-tool identity with `AsyncLocalStorage`. | pass |
| Stop and retry preserve side-effect safety | Stop aborts the exact Turn with bounded waits and cannot let an old prompt clear a newer Turn. A failed model run is not retried after a tool call has executed. | pass |
| Timeline segments stay ordered and complete | The renderer flushes buffered deltas before sealing an assistant segment, tracks real stream coverage, avoids copying a whole final reply into an already sealed tail, and reconciles missed renderer stream prefixes from Main's terminal reply. | pass |
| Renderer recreation recovers ownership and completion | Main exposes revisioned active plus unacknowledged-finished snapshots. The renderer rejects stale snapshots, restores the exact active Turn, replays terminal results once, persists them, and acknowledges completion. | pass |
| Task and confirmation state survives reload | Persisted task/confirmation bindings are rebuilt before task snapshots are applied; snapshot query/broadcast races are fenced and unanswered confirmation cards are deduplicated. | pass |
| Active Turn configuration is immutable | Control and Workbench disable provider/model/effort changes from the revisioned Main Turn state, and Main refuses a changed LLM target while a Turn is active. | pass |
| Migrated UI is localized | Response status, task cards, confirmation cards/sheet, composer controls, steering failure, inactivity timeout, terminal states, interruption warning, and Stop fallback use strictly shaped English/Chinese i18n keys. | pass |
| Maestro boundaries remain intact | Existing Home, provider/Local/Claude paths, replay, compaction, Royal Blue/Arco/BEM presentation, and compatibility names remain. Connector, Demo, fixed AI-CRMS tab/login/profile, Cowork `ContextService`, and standalone lifecycle were not introduced. | pass |

## Verification

- Independent full-chain source review: completed.
- Final targeted i18n re-review: approved.
- Task-scoped `git diff --check`: clean.
- Checks/scripts, tests, typecheck, lint, build, Electron, Playwright/E2E, application launch, and
  network runtime probes: **not run**, as explicitly required. Ral owns runtime/E2E acceptance.

## Conclusion

**Approved — no P0-P2 findings.**

Task 089 now brings Cowork's current chat lifecycle into Maestro while retaining the fork's
provider, persistence, localization, visual, Home, and compaction boundaries.
