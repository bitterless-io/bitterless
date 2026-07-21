# EyesOnAgents All Title Search Review — Round 1

Status: blocked

Date: 2026-07-21

## Findings

1. **P2 · blocking — the layout contract still says every Domain header contains only its title
   and management control.** The blanket header rule remains at
   `docs/integrations/eyes-on-agents-layout.md:159-165`, while the same document later requires an
   icon-only Search control in the All header at lines 181-188. The task requires that control at
   `docs/plan/tasks/eyes-on-agents-all-title-search-017.md:31-32`, and the implementation correctly
   renders it at `src/renderer/eyesOnAgents/src/components/DomainColumn/DomainColumn.vue:37-50`.
   Consequently the source agrees with the task-specific rule but the governing layout document is
   internally contradictory. Amend the earlier general rule to state the per-projection controls
   explicitly (custom Domain management; All Search; Focus none) so the delivered UI has one
   unambiguous source of truth.

2. **P3 · non-blocking — Escape does not actually return keyboard focus to the Search toggle.**
   `titleSearchButtonRef` is a ref to Arco's `a-button`, but it is typed as though that component
   exposed an optional `focus()` method
   (`src/renderer/eyesOnAgents/src/components/DomainColumn/DomainColumn.vue:169`). Arco Button's
   public component instance exposes no such method, so the optional call at lines 194-199 is a
   silent no-op after Escape removes the focused input. Clear/hide behavior remains correct, and
   focus return is not an explicit acceptance clause, so this does not independently block the
   task; using the component instance's native `$el` (with an accurate ref type) would preserve a
   visible logical focus position for keyboard users.

## Static contract assessment

- The Search trigger is gated by `all` and occupies the All header; Focus and custom Domain callers
  do not receive it. The conditional search row precedes `ProjectFilter`, uses a mini Arco input,
  and opening it waits for render before focusing the input
  (`DomainColumn.vue:37-50,70-99,189-208`).
- Explicit Clear empties only `allTitleQuery`, keeps the row mounted, and refocuses the Arco input.
  Escape and toggle-close clear before hiding; All-column unmount clears synchronously before a
  later closed-state remount (`DomainColumn.vue:194-213,238-240`).
- `filteredAllThreads` applies the existing Project filter first, trims and locale-lowercases the
  query, and then checks only non-null `thread.title` with locale-lowercased substring inclusion.
  It does not consult thread ID, cwd/path, Project metadata, latest-prompt/preview, response, or
  content fields (`src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts:92-103`).
- Project choices and counts continue to derive from unsearched `allThreads`; Focus and custom
  Domain getters remain independent. Clearing the title query never changes `allProjectFilter`
  (`eyesOnAgents.store.ts:77-89,111-166`; `AgentBoard.vue:13-37`).
- The query is initialized only in the renderer store and `applySnapshot()` replaces only the
  snapshot, so normal snapshot refreshes retain and recompute the query while a renderer restart
  resets it (`eyesOnAgents.store.ts:42-55,168-194,353-356`).
- The title-search empty label precedes Project-specific empty labels. English and Chinese provide
  Search, Clear, placeholder, and scoped-empty copy
  (`DomainColumn.vue:173-184`; `src/renderer/common/i18n/en.ts:257-276`;
  `src/renderer/common/i18n/zh.ts:259-278`).
- The new controls expose localized labels, expanded/control relationships, search semantics, and
  visible focus rules. New color declarations use `oklch()`; the compact trigger, row, input, and
  Clear styles use background hierarchy without a permanent decorative border or shadow
  (`DomainColumn.vue:37-97`; `DomainColumn.less:109-174`).
- The task-specific source guard checks All-only placement, row order, input/clear lifecycle,
  Project-first title-only matching, forbidden ID/path/Project/prompt/content fields, renderer-only
  ownership, snapshot retention, empty-label precedence, i18n, and compact styling. Existing guards
  for tasks 013-015 remain present, including the single non-overlapping polling interval and the
  menubar/Hook-guide contracts; the predicate explicitly excludes task 016's planned
  `lastUserPrompt` field (`scripts/eyes-on-agents/ui-source.test.mjs:58-128,367-575,603-847`).

## Conclusion

**Blocked.** No P1 finding exists, and the implemented All-title filtering behavior is otherwise
consistent with the task, integration contract, Project filter, and current source guards. The P2
layout contradiction must be corrected before the task can pass; the P3 focus-return issue may be
fixed in the same round or recorded as non-blocking follow-up.

## Verification

Per owner instruction, this review ran no tests, build, typecheck, formatter, or Electron process.
The assessment used only the current task/context documents, source, dependency source needed to
confirm the Arco ref behavior, source guards, and `git diff`. Only this review document was added by
the reviewer.
