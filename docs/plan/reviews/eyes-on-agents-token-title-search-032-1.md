---
id: eyes-on-agents-token-title-search-032-1
target: working-tree-2026-07-30-795ebe5ae28f-token-title-search-032
compared_with: eyes-on-agents-global-title-search-031-2
---

# Verdict

**PASS. No P1, P2, or P3 finding.** The source and focused non-Electron checks satisfy the task
contract; packaged-runtime interaction remains with Ral.

# Findings

- P1 blocking: none.
- P2 blocking: none.
- P3 non-blocking: none.

# Evidence

1. Empty, cleared, and separator-only queries are inventory-gated. The tokenizer returns no tokens
   for those inputs, `threadSearchResults` returns `[]`, and query assignment derives selection from
   the first current result, therefore leaving it `null`
   (`src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts:46-53,132-145,210-226`).
   The real-store harness exercises open, clear, all supported separators, selection recovery after
   typing again, and Enter no-op with no selection
   (`scripts/eyes-on-agents/global-title-search.test.mjs:138-171,388-406`).

2. Normalization and matching implement the specified Unicode/token contract. Query and title both
   pass through NFKC, locale-aware lowercase, and one Unicode regexp containing whitespace plus only
   `-`, `_`, `.`, `/`, `\`, `:`, and `|`. Matching is unordered AND: every query token must be a
   substring of some title token
   (`src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts:46-53,132-140`).
   Executing tests cover `ops git` and `git ops` against `ops-git`, mixed/repeated separators,
   full-width NFKC input, case folding, partial tokens, and unmatched-token rejection
   (`scripts/eyes-on-agents/global-title-search.test.mjs:173-230`).

3. Search scope remains title-only and independent from the All projection. The global getter reads
   only `thread.title` over `allThreads`; it does not consume `allProjectFilter`, `allTitleQuery`, or
   `filteredAllThreads` (`src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts:119-145`).
   The harness supplies matching text through ID, cwd, Project, and latest prompt while confirming
   only the title row matches, with conflicting All filters active
   (`scripts/eyes-on-agents/global-title-search.test.mjs:232-275`). The complementary source guard
   rejects other thread fields and cross-coupling in either projection
   (`scripts/eyes-on-agents/ui-source.test.mjs:999-1041`).

4. Selection lifecycle preserves the prior global-search behavior. Every raw query change selects
   the first match; clear selects nothing; snapshot application retains a matching selected thread
   ID or falls back to the first current result; Open delegates to the established `openThread`
   action without closing or clearing search state
   (`src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts:222-257,333-348,468-482`).
   The executable harness covers query reset, bounded arrow movement, a query entered before a
   snapshot, snapshot reorder/removal, Open acknowledgement reorder, and empty/unmatched Enter
   (`scripts/eyes-on-agents/global-title-search.test.mjs:277-406`).

5. The Vue surface distinguishes the two zero-row states: meaningful unmatched input uses localized
   no-match copy, while empty/clear/separator-only input uses localized start-typing guidance
   (`src/renderer/eyesOnAgents/src/components/ThreadSearch/ThreadSearch.vue:75-82,117-120`;
   `src/renderer/common/i18n/en.ts:381-387`;
   `src/renderer/common/i18n/zh.ts:382-388`). The input update remains receiver-safe, and existing
   listbox/option, keyboard, scroll, and focus hooks are unchanged
   (`src/renderer/eyesOnAgents/src/components/ThreadSearch/ThreadSearch.vue:22-36,39-73,144-212`).

6. Search state remains three renderer-store fields and has no search-specific emitter, persistence,
   App Server, or polling path. Opening a result is the one intended reuse of the existing
   `openThread(threadId)` action
   (`src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts:64-66,210-257`). The owner scan in the
   source suite confines `threadSearchQuery` to the store and component
   (`scripts/eyes-on-agents/ui-source.test.mjs:1062-1066`).

7. Test coverage is proportionate. Behavioral matching, selection, snapshot, and Open contracts run
   against the bundled production store with Vue's real reactive export; the source assertions are
   somewhat formatting-sensitive, but they guard Vue/accessibility/CSS ownership that the Node
   harness cannot render. They are complementary rather than substitutes for the executable store
   tests.

# Verification

| Check | Result |
|---|---|
| `yarn test:eyes-on-agents:ui` | PASS — 46/46; global search store contract 8/8 |
| `yarn check:renderer-i18n` | PASS |
| `yarn typecheck:eyes-on-agents:ui` | Baseline-blocked only by unresolved `@preload/eyesOnAgents/eyesOnAgents.preload`; no diagnostic references a reviewed search or i18n file |
| `git diff --check` | PASS |

# Owner Runtime Boundary

No Electron process was launched, and this review does not claim runtime autofocus. Ral retains the
packaged-runtime check for native Find suppression, initial and repeated input focus, visible
start-typing/no-match transitions, keyboard scrolling, and focus/query/selection retention after
opening a real Codex task.
