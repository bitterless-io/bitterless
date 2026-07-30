---
id: eyes-on-agents-global-title-search-031-1
target: working-tree-2026-07-30-795ebe5ae28f
compared_with: eyes-on-agents-global-title-search-031
---

# Verdict

**BLOCKED. One P2 blocking finding and one P3 non-blocking finding remain. No P1 finding was
identified.**

# Findings

1. **P2 · blocking — typing in the Arco input loses the renderer-store receiver, so the global
   query does not update.** `ThreadSearch.vue` passes the prototype method directly as the
   component event callback
   (`src/renderer/eyesOnAgents/src/components/ThreadSearch/ThreadSearch.vue:30`). Vue compiles this
   to an `onUpdate:modelValue` property containing `eyesOnAgentsStore.setThreadSearchQuery`; when
   Arco emits the value, Vue invokes that function without its owning object. The first assignment
   in `setThreadSearchQuery` therefore runs with `this === undefined` and throws instead of updating
   the query or first selection
   (`src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts:207-210`). A Vue 3.5 receiver probe
   reproduced `TypeError: Cannot set properties of undefined`, while the focused harness passes
   because it calls `store.setThreadSearchQuery(...)` with the receiver intact
   (`scripts/eyes-on-agents/global-title-search.test.mjs:183,207`). Consequently empty-query
   browsing works, but the task's title filtering, query-change selection, and Clear-input path are
   not deliverable through the actual UI.

2. **P3 · non-blocking — the search combobox relies on placeholder text instead of a stable
   localized accessible label.** The input attributes provide combobox state and ownership but no
   `aria-label` or `aria-labelledby`
   (`src/renderer/eyesOnAgents/src/components/ThreadSearch/ThreadSearch.vue:107-114`); the only
   user-facing input description is the placeholder at lines 27-29. The result list and options do
   expose localized labels, active-descendant selection, title, runtime state, and unread state, so
   the task's explicit result-row accessibility clause is met. Adding a stable input/search label
   would align this finder with the existing All-column title search and avoid placeholder-only
   identification for assistive technology.

# Evidence

- `App.vue:109-142` owns one mounted/unmounted window `keydown` listener. It prevents and stops
  native Find, opens only when closed, and refocuses the exposed input on repeated shortcuts.
- Installed Arco Vue 2.57 source confirms that `visible`, `modal-class`, `body-class`,
  `unmount-on-close`, `cancel`, and `open` are valid Modal APIs; Arco Input exposes `focus()` and
  forwards native `keydown`. The invalid runtime boundary is specifically the unbound
  `update:model-value` callback described above.
- `ThreadSearch.less:1-70` constrains the complete `.arco-modal` box to a 200px minimum and `80vh`
  maximum, makes the header/input non-growing, and gives vertical overflow only to the flexed
  result list.
- `eyesOnAgents.store.ts:123-130` derives results directly from `allThreads`, returns the full
  current ordering for an empty query, and otherwise matches only non-null titles with trimmed
  locale-lowercased substring search. It does not consume `allProjectFilter`,
  `allTitleQuery`, Domain state, prompt/content, or raw snapshots.
- `eyesOnAgents.store.ts:195-241,453-466` selects the first result on open/query change, clamps
  arrows, retains selection by thread ID through snapshots/Open reordering, falls back only when
  the ID disappears, and opens through the existing `openThread` path without closing or clearing.
- `ThreadSearch.vue:39-83,143-200` uses dedicated non-draggable result buttons rather than
  `ThreadCard`, keeps active-descendant selection visible, preserves input focus after Enter/click,
  makes no-result Enter a no-op, and closes/resets on Escape.
- The new state exists only in the renderer store/component. No search-specific XPC, persistence,
  App Server request, polling loop, or All-filter mutation was added.

# Verification

| Check | Result |
|---|---|
| `node --test scripts/eyes-on-agents/global-title-search.test.mjs` | PASS — 7/7 |
| `node --test scripts/eyes-on-agents/ui-source.test.mjs` | PASS — 23/23 |
| `yarn check:renderer-i18n` | PASS |
| `yarn typecheck:eyes-on-agents:ui` | baseline-blocked only by the existing unresolved `@preload/eyesOnAgents/eyesOnAgents.preload` alias; no diagnostic references a changed search/i18n file |
| tracked and new-file whitespace checks | PASS |
| independent Vue/Arco callback-binding audit | FAIL — confirms P2 |

# Owner Runtime Boundary

No Electron process was launched, and this review does **not** claim runtime autofocus verification.
After the P2 is fixed and independently re-reviewed, Ral still owns packaged-runtime confirmation
of native Find suppression, initial/repeated input focus, Escape, complete-modal sizing and list
scrolling, and focus/query retention after opening a real Codex task.
