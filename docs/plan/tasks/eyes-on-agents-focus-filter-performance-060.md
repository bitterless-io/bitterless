---
id: eyes-on-agents-focus-filter-performance-060
scope: decouple Focus search typing from filtering with a trailing-guaranteed scheduler and memoized matching
status: implemented; owner verification pending
depends-on: [eyes-on-agents-focus-search-toggle-058]
---

# EyesOnAgents Focus Filter Performance

## Objective

Keep typing in the Focus search responsive on a large board: the keystroke only updates a draft
value, filtering runs on a throttled schedule, and the trailing run guarantees the visible result set
matches the **last** thing typed. Make each filtering pass cheap by memoizing the sort and the title
tokenization instead of recomputing both per keystroke.

## Context

- [EyesOnAgents Focus-only board](../../features/eyes-on-agents-focus-board.md)
- [EyesOnAgents layout](../../integrations/eyes-on-agents-layout.md)
- `src/renderer/onlypreview/shell/src/onlyPreviewProjectSearch.store.ts` — the house
  `useThrottleFn(run, 120, true, true)` scheduler plus dispatch-latest pattern this mirrors

Today the input writes straight into `titleQuery`, and every read of `filteredFocusThreads` re-sorts
every visible thread and re-tokenizes every title. Reactive class getters are not cached, so one
keystroke can pay that cost more than once.

## Required behavior

- Two values: `titleDraft` (what the input shows, updated on every keystroke) and `titleQuery` (what
  filtering uses). The rendered list only reacts to `titleQuery`.
- `setTitleDraft` stores the draft and asks the configured scheduler to commit. The scheduler is
  `useThrottleFn(run, 120, true, true)` from `@vueuse/core` — leading plus trailing — per the project
  rule that forbids lodash or hand-rolled throttling.
- The commit reads the **current** draft rather than a captured argument, so the last keystroke always
  wins and no stale value can land after it.
- Without a configured scheduler the commit is synchronous, so tests and non-browser callers keep
  deterministic behavior.
- Closing or clearing resets draft and query together and immediately, so a pending trailing commit
  can only ever re-apply the empty query.
- Memoize per snapshot and per thread, outside the reactive object so caching cannot trigger renders:
  - sorted threads cached by snapshot identity — repeated reads of `focusThreads` for one snapshot
    return the same array;
  - title tokens cached per thread object and invalidated when that thread's title changes.
- Matching semantics do not change: NFKC, locale lowercase, the same separator split, order-independent
  token containment, title-only, separator-only queries are not filters, untitled threads never match.
- Ordering does not change; the comparator and its guards stay exactly as they are.
- Do not launch Electron E2E; Ral performs the visual check.

## Expected paths

- `docs/features/eyes-on-agents-focus-board.md`
- `docs/integrations/eyes-on-agents-layout.md`
- `docs/plan/README.md`
- `src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts`
- `src/renderer/eyesOnAgents/src/components/DomainColumn/DomainColumn.vue`
- `scripts/eyes-on-agents/focus-board-store.test.mjs`
- `scripts/eyes-on-agents/ui-source.test.mjs`

## Verification

- `yarn typecheck:eyes-on-agents:ui`
- `yarn test:eyes-on-agents`
- `yarn build`
- Store coverage: draft/commit split, trailing commit uses the newest draft, no scheduler means
  synchronous commit, close clears both, sorted-array identity is stable per snapshot and changes
  with a new snapshot, and token reuse survives a snapshot refresh while a changed title re-tokenizes.
- Static coverage: `useThrottleFn(..., 120, true, true)`, the input bound to the draft, and no direct
  `titleQuery` write from the template.

## Result

Implemented.

**Typing path.** The store gained `titleDraft`, `setTitleDraft`, `commitTitleQuery`, and
`configureTitleQueryScheduler`; the module bottom wires
`createEyesOnAgentsTitleQueryScheduler = (run) => useThrottleFn(run, TITLE_QUERY_THROTTLE_MS, true, true)`
with `TITLE_QUERY_THROTTLE_MS = 120`, mirroring `onlyPreviewProjectSearch.store.ts`. The input is now
`:model-value="eyesOnAgentsStore.titleDraft"` plus `@update:model-value="handleTitleInput"`, so a
keystroke no longer writes the filtering query directly. `commitTitleQuery` reads `this.titleDraft`
at fire time, which is what makes the trailing run authoritative — and also why a trailing run that
lands after a close is harmless, since `clearTitleQuery` zeroes draft and query together. An
unconfigured scheduler commits synchronously.

**Cost per pass.** `sortedThreadsBySnapshot` (WeakMap keyed by snapshot) makes repeated
`focusThreads` reads reuse one sorted array instead of re-sorting per template read, and
`titleTokensByThread` (WeakMap keyed by thread, guarded on the title string) stops re-tokenizing every
title on every keystroke. Both live outside the reactive object, so populating them cannot mutate
reactive state during render.

Matching semantics, ordering, `Read all`, and the toggle/close contract are unchanged.

New store coverage: scheduler-gated draft with a last-input-wins commit, unchanged-draft no-op,
synchronous fallback, clear-then-late-commit safety, stable sorted-array identity per snapshot with a
fresh array after `loadSnapshot`, and cache invalidation when a thread title changes.

Verified: `yarn typecheck:eyes-on-agents:ui`, `yarn test:eyes-on-agents` (67 UI assertions plus every
core/repository/bridge/Claude suite), `yarn build`. Electron E2E not run; Ral retains the interactive
check on a large board.
