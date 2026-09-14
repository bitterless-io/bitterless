---
id: eyes-on-agents-restore-read-all-102
scope: Restore Read all immediately after Search and clear every visible unread red dot
status: implemented; owner verification pending
depends-on: [eyes-on-agents-focus-read-all-021, eyes-on-agents-search-modal-067]
verify: Focus interaction/store, bulk-read repository coverage, UI typecheck; no Electron
---

# Restore Focus Read all

Ral requested the visible action again on 2026-09-14. This supersedes the Search-only header
decision, not the Search modal or IME input contract.

```text
Focus header (right aligned)     [Search icon] [Read all]
                                existing scrolling thread cards
```

- Place a compact, localized, borderless text button immediately right of Search. Keep it visible
  and disabled when no visible non-active unread row exists; show loading and block duplicate
  writes while the action runs. Preserve Search, keyboard focus and the narrow 480px layout.
- Reuse the existing parameter-free `markAllRead` XPC and persistent repository mutation, across
  enabled providers, independent of Domain, scroll position and search query. Clear unread flags
  regardless of stored runtime state (including latent active flags). Preserve archived/deleted/
  provider exclusions. A stored working row may project as unknown after authority expires; a
  terminal-only SQL filter cannot clear its visible red dot. Bulk acknowledgement must not try to
  infer UI visibility from stored runtime or change runtime evidence to match the UI.
- Write only `is_unread`; never change runtime, activity timestamps, Open receipts, archive state
  or provider sessions. Read rows stay on Focus. A later real completion may create a new red dot.
- Apply the returned snapshot, using the existing mutation-generation fence so an older in-flight
  snapshot cannot restore cleared dots. Failures retain rows and use the existing action error;
  there is no optimistic clear, new fallback, new persistence path, or per-card loop.
- Tests cover placement, localization, disabled/loading, success/failure, no-op/duplicate calls,
  unknown and stored-active eligibility, archived/provider exclusions, old snapshot rejection and later unread.
  Run proportionate code checks only; no Electron/E2E, independent review, packaging or Git sync.

## Human check

In the updated app, create unread Codex/Claude cards (and retain a working card), then click Read
all to the right of Search. Red dots disappear, working keeps spinning, read cards remain, and a
subsequent completed response can show a new dot. Confirm cleared dots stay cleared after refresh.

## Code verification (2026-09-14)

- Focus store: 35/35 passed; real Arco header/Search/IME interactions: 15/15 passed.
- Repository suite passed, including all-state unread clearing, archived/provider exclusions,
  runtime/Open/timestamp preservation and a later completion becoming unread again.
- UI typecheck and three scoped source/actual renderer Less compilation assertions passed.
- Full UI aggregate: 128/131 passed. Existing Windows App ID-expression and user-edited Search
  section-ID source assertions still fail. The shared right-click pointer-menu case also failed
  in the aggregate but passed immediately in isolation; its cause is not established and its
  implementation/test files were not changed for this task.
- No Electron/E2E, independent review, build, packaging or Git sync was performed. All unrelated
  worktree changes were preserved; Ral owns the live check above.
