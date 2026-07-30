# EyesOnAgents Global Title Search

Status: two-line result metadata implemented; owner verification pending

## Need

The existing title filter belongs only to the All column and is composed with its Project filter.
EyesOnAgents also needs a window-wide, keyboard-first task finder that can open any visible Codex
thread without navigating to a particular column:

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
┌ Search tasks ───────────────────────────────┐
│ [ ops git_______________________________ ] │
├─────────────────────────────────────────────┤
│ > ops-git                                   │
│   git_ops release                           │
└─────────────────────────────────────────────┘
```

## Resolution contract

- `Cmd+F` on macOS and `Ctrl+F` on Windows open one EyesOnAgents search modal and suppress
  Chromium's native page Find. Repeating the shortcut while it is open focuses the input.
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
- Open/clear keeps selection empty. A meaningful query with matches selects the first result.
  Up/Down move within the current result bounds, and selection is retained by thread ID while
  background snapshots or Open acknowledgement reorder the list. If the selected thread
  disappears, selection falls back to the first current match.
- Each result uses two compact lines. The first line contains only the thread title. The second
  line contains its custom Domain title at the left and runtime state at the right.
- The system `uncategorized` storage fallback is not a user classification and therefore displays
  `-` as the Domain. A missing Domain row, a stale `domain_id`, or a blank resolved title also
  displays `-`.
- Enter and clicking a row invoke the existing `openThread(threadId)` path. Opening does not close
  the modal or clear its query, so repeated task lookup remains available.
- Escape closes the modal and clears its renderer-only query and selection. No search state is
  persisted and no XPC, SQLite, App Server, or polling behavior is added.
- The existing All-column Project/title filters remain independent and unchanged.

Delivery:
[eyes-on-agents-global-title-search-031](../plan/tasks/eyes-on-agents-global-title-search-031.md),
superseded for empty-query and matching semantics by
[eyes-on-agents-token-title-search-032](../plan/tasks/eyes-on-agents-token-title-search-032.md),
with result metadata refined by
[eyes-on-agents-search-result-domain-033](../plan/tasks/eyes-on-agents-search-result-domain-033.md).
