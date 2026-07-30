---
id: eyes-on-agents-global-title-search-031-2
target: working-tree-2026-07-30-795ebe5ae28f-round-2
compared_with: eyes-on-agents-global-title-search-031-1
---

# Verdict

**PASS. No P1, P2, or P3 finding remains.**

# Findings

- P1 blocking: none.
- P2 blocking: none.
- P3 non-blocking: none.

# Resolved Findings

1. Round 1's P2 callback-receiver finding is closed. The Arco input now emits to the local
   `handleQueryUpdate` arrow handler
   (`src/renderer/eyesOnAgents/src/components/ThreadSearch/ThreadSearch.vue:30,155-157`), and that
   handler invokes `eyesOnAgentsStore.setThreadSearchQuery(query)` through the owning store object.
   Vue's compiled template contains
   `onUpdate:modelValue: $setup.handleQueryUpdate`, not the former bare store method. The source
   guard requires this local handler, rejects any direct store-method event binding, and verifies
   the receiver-preserving call
   (`scripts/eyes-on-agents/ui-source.test.mjs:943-958`).

2. Round 1's P3 accessible-name finding is closed. The attributes applied to Arco's underlying
   combobox now include a stable localized `aria-label` from the search placeholder copy while
   retaining the list ownership, expanded state, and active-descendant relationship
   (`src/renderer/eyesOnAgents/src/components/ThreadSearch/ThreadSearch.vue:107-115`). The focused
   source guard protects that exact localized input attribute
   (`scripts/eyes-on-agents/ui-source.test.mjs:959-964`).

# Regression Assessment

- The fixes are confined to the input callback and its accessibility attributes plus the focused
  source guard. Query matching, first-result selection, clamped arrows, snapshot/Open ID retention,
  Escape reset, repeated Open behavior, dedicated non-draggable rows, modal bounds, and All-filter
  independence remain unchanged.
- The wrapper accepts Arco's string model value and introduces no asynchronous boundary or second
  state owner. Search state remains renderer-only; no IPC, persistence, App Server request, or poll
  was added.
- Arco Input still receives native keyboard handling and its exposed `focus()` ref; the localized
  label is applied to the real input via `input-attrs`.

# Verification

| Check | Result |
|---|---|
| `yarn test:eyes-on-agents:ui` | PASS — 44/44; the regular Eyes UI suite now executes `global-title-search.test.mjs` |
| `node --test scripts/eyes-on-agents/global-title-search.test.mjs` | PASS — 7/7 |
| `node --test scripts/eyes-on-agents/ui-source.test.mjs` | PASS — 23/23 |
| Vue SFC compile inspection | PASS — model update binds to `$setup.handleQueryUpdate` |
| `yarn check:renderer-i18n` | PASS |
| `yarn typecheck:eyes-on-agents:ui` | baseline-blocked only by the existing unresolved `@preload/eyesOnAgents/eyesOnAgents.preload` alias; no diagnostic references a changed search/i18n file |
| package/test wiring scope | PASS — only the Eyes UI script gains the harness; `name`, `version`, and `version_code` are unchanged, the earlier EOF-newline dirty state is preserved, and `yarn.lock` is untouched |
| tracked and new-file whitespace checks | PASS |

# Owner Runtime Boundary

No Electron process was launched, and this review does not claim runtime autofocus verification.
Ral retains the final packaged-runtime check for native Find suppression, initial/repeated focus,
Escape, modal sizing/list scrolling, and focus/query retention after opening a real Codex task.
