# EyesOnAgents Global Title Search

Status: restored with full-card results; successful Open closes Search; owner verification pending

Tasks 031–033 first delivered this modal, task 055 retired it into a permanent Focus filter, and
[eyes-on-agents-search-modal-067](../plan/tasks/eyes-on-agents-search-modal-067.md) restores it as
the only search surface. Token matching is retained, but search no longer narrows the board and
results now reuse the complete normal thread card rather than a reduced row.

## Need

EyesOnAgents needs a temporary, keyboard-first task finder across every provider-visible thread,
without narrowing the complete Focus board or permanently occupying its header:

```text
Cmd+F / Ctrl+F
        |
        v
┌ Search tasks ───────────────────────────────┐
│ [ Search thread titles___________________ ] │
├─────────────────────────────────────────────┤
│         Type a title to search tasks        │
└─────────────────────────────────────────────┘

query: "ops git"
┌ Search tasks ─────────────────────────────────────┐
│ [ ops git______________________________________ ] │
├───────────────────────────────────────────────────┤
│ ╔ ◉ ops-git sync failures                    ● ═╗ │
│ ║ latest question                              ║ │
│ ║ 12m                                  [⌂][…] ║ │
│ ╚═══════════════════════════════════════════════╝ │
└───────────────────────────────────────────────────┘
```

## Resolution contract

- `Cmd+F` on macOS and `Ctrl+F` on Windows open one EyesOnAgents search modal and suppress
  Chromium's native page Find. Repeating the shortcut while it is open closes the modal.
- The input is focused when the modal opens. The input remains fixed above a separately scrolling
  result list.
- The complete modal stays between 200px and 80% of the current viewport height. Long results
  scroll inside the list instead of growing the modal or page.
- An empty query, a cleared query, or a query containing only separators presents no thread
  results and selects nothing. The modal shows a quiet prompt to start typing rather than exposing
  the full inventory.
- A non-empty query is normalized with Unicode NFKC and locale-aware lowercase, then split on
  whitespace and common title separators (`-`, `_`, `.`, `/`, `\`, `:`, and `|`). A title matches
  only when every query token occurs in at least one normalized title token; token order does not
  matter and partial-token matching remains available. Therefore `ops git` and `git ops` both
  match `ops-git`.
- Matching reads `thread.title` only; thread ID, cwd, Project, Domain, prompt, response, and raw
  snapshots are excluded.
- A meaningful query with matches selects the first result. Up/Down wrap through the current
  results, and selection is retained by provider-qualified session key while background snapshots
  or Open acknowledgement reorder the list. If the selected thread disappears, selection falls
  back to the first current match. Arrow and Enter first commit the latest input draft, so the
  throttled matcher cannot navigate or open stale results.
- Each result renders the existing complete `ThreadCard`; provider, runtime/loading, unread state,
  latest question, time, folder, Open, and overflow actions stay identical to the board.
- A single click selects a card. Enter and the card's existing Open affordances invoke the existing
  `openThread(sessionKey)` path. A successful Open closes the modal and clears its transient query
  and selection. A failed or guarded Open leaves Search unchanged so the owner can retry.
- Escape closes the modal and clears its renderer-only query and selection. No search state is
  persisted and no XPC, SQLite, App Server, or polling behavior is added.
- The Focus board stays complete behind the modal. Its header contains only one Search button;
  there is no permanent title input or visible **Read all** action.
- Vue component events must call the class-based EOA store through receiver-safe local wrappers;
  passing a store method directly as an Arco model-update or click callback loses `this` at runtime.

Delivery:
[eyes-on-agents-global-title-search-031](../plan/tasks/eyes-on-agents-global-title-search-031.md),
superseded for empty-query and matching semantics by
[eyes-on-agents-token-title-search-032](../plan/tasks/eyes-on-agents-token-title-search-032.md),
with result metadata refined by
[eyes-on-agents-search-result-domain-033](../plan/tasks/eyes-on-agents-search-result-domain-033.md),
and restored with the current full-card contract by
[eyes-on-agents-search-modal-067](../plan/tasks/eyes-on-agents-search-modal-067.md). The receiver
regression found in that restoration is repaired by
[eyes-on-agents-search-receiver-safety-069](../plan/tasks/eyes-on-agents-search-receiver-safety-069.md).
The successful-Open lifecycle is refined by
[eyes-on-agents-search-close-after-open-070](../plan/tasks/eyes-on-agents-search-close-after-open-070.md).
