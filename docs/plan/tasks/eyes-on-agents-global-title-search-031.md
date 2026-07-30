---
id: eyes-on-agents-global-title-search-031
scope: keyboard-first in-memory title search across every visible EyesOnAgents thread
status: implemented; owner verification pending
depends-on: [eyes-on-agents-all-title-search-017, eyes-on-agents-open-status-sync-029]
---

# EyesOnAgents Global Title Search

## Objective

Add one global `Cmd+F` / `Ctrl+F` search modal to EyesOnAgents so Ral can find and repeatedly open
current Codex tasks by title without changing the All column's Project or title filters.

## Context

- [EyesOnAgents global title search issue](../../issues/eyes-on-agents-global-title-search.md)
- [EyesOnAgents layout](../../integrations/eyes-on-agents-layout.md)
- [EyesOnAgents integration](../../integrations/eyes-on-agents.md)

## Required behavior

```text
┌ EyesOnAgents ────────────────────────────────────────────────────────────────┐
│                                                                            │
│        ┌ Search tasks ────────────────────────────────────────────┐         │
│        │ [ Search thread titles_______________________________ ] │ fixed   │
│        ├─────────────────────────────────────────────────────────┤         │
│        │ > First matching task                                  │         │
│        │   Second matching task                                 │ scroll  │
│        │   …                                                    │         │
│        └─────────────────────────────────────────────────────────┘         │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

- Register one window-level shortcut listener for the lifetime of the EyesOnAgents renderer.
  `Cmd+F` and `Ctrl+F` prevent the native page Find and open the modal; invoking the shortcut again
  focuses the existing search input instead of toggling or adding a listener.
- Keep the complete modal at least 200px high and no taller than `80vh`. The input region is fixed
  at the top; only the result list owns vertical overflow.
- Focus the Arco input whenever the modal opens. Escape closes and resets the transient search.
- Search the current renderer `allThreads` collection only. Empty input shows the full current
  collection; non-empty input uses trimmed locale-aware lowercase substring matching on non-null
  `thread.title` only.
- Store modal visibility, query, and selected thread ID as renderer-only state independent of
  `allTitleQuery`, `allProjectFilter`, Domain state, XPC, and SQLite.
- Select the first result on open/query change. Up/Down clamp at the result bounds. Keep selection
  by thread ID through snapshot refreshes and the attention-order change caused by opening an
  unread task; fall back to the first result only when the selection no longer exists.
- Render a compact dedicated result row, not a draggable Domain card. The row exposes its title and
  state accessibly and opens through the existing `eyesOnAgentsStore.openThread(threadId)`.
- Clicking a result or pressing Enter opens it without closing the modal, clearing the query, or
  losing input focus. Enter with no result is a no-op.
- Keep the All-column inline title search unchanged and independent.

## Interaction contract

| input | behavior |
|---|---|
| `Cmd+F` / `Ctrl+F` | prevent native Find; open the modal and focus its input |
| repeated `Cmd+F` / `Ctrl+F` | keep the modal open and refocus its input |
| query change | recompute title-only results and select the first result |
| `ArrowDown` | select the next result, clamped at the last row |
| `ArrowUp` | select the previous result, clamped at the first row |
| `Enter` | open the selected task; keep modal, query, and input active |
| click result | select and open that task; keep modal and query active |
| `Escape` | close the modal and clear its transient query/selection |

## Expected paths

- `docs/issues/eyes-on-agents-global-title-search.md`
- `docs/integrations/eyes-on-agents.md`
- `docs/integrations/eyes-on-agents-layout.md`
- `docs/plan/README.md`
- `docs/INDEX.md`
- `src/renderer/eyesOnAgents/src/App.vue`
- `src/renderer/eyesOnAgents/src/components/ThreadSearch/ThreadSearch.vue`
- `src/renderer/eyesOnAgents/src/components/ThreadSearch/ThreadSearch.less`
- `src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts`
- `src/renderer/common/i18n/en.ts`
- `src/renderer/common/i18n/zh.ts`
- `package.json`
- `scripts/eyes-on-agents/global-title-search.test.mjs`
- `scripts/eyes-on-agents/ui-source.test.mjs`

## Verification

- A pure renderer-store harness covers empty/full results, trimmed case-insensitive title-only
  matching, default/fallback selection, bounded Up/Down movement, live snapshot recomputation, and
  Open preserving modal/query/selection state.
- Source guards cover one mounted/unmounted window shortcut listener, native Find suppression,
  autofocus/refocus, Escape, accessible selection, fixed input plus scrollable results, the
  200px/80vh bound, and independent All-column filters.
- Run the focused Node tests, EyesOnAgents renderer typecheck, renderer i18n validation, and
  `git diff --check`. Do not launch Electron; Ral owns runtime UI verification.

## Review

- Round 1:
  [eyes-on-agents-global-title-search-031-1](../reviews/eyes-on-agents-global-title-search-031-1.md)
  blocked delivery because the Arco model-update callback passed an unbound class method and the
  combobox lacked a stable accessible label.
- Round 2:
  [eyes-on-agents-global-title-search-031-2](../reviews/eyes-on-agents-global-title-search-031-2.md)
  accepted the receiver-safe local callback, localized input label, and regression guards with no
  remaining P1, P2, or P3 finding.

## Delivery evidence

- Completed on 2026-07-30 with renderer-only global search state, a dedicated compact result
  modal, one mounted/unmounted shortcut listener, and no new XPC, persistence, or polling path.
- Follow-up
  [eyes-on-agents-token-title-search-032](eyes-on-agents-token-title-search-032.md) supersedes this
  task's empty-query inventory and simple substring-matching behavior.
- The store harness passes 7/7 cases and is wired into the normal EyesOnAgents UI command; the
  complete EyesOnAgents UI suite passes 44/44; renderer i18n and diff checks pass.
- The focused renderer typecheck remains blocked only by its pre-existing missing `@preload/*`
  alias for `eyesOnAgentsEnv.bridge.ts`; it reports no changed-file error.
- No Electron process was launched. Ral owns the final shortcut, autofocus, scrolling, and visual
  height check.
