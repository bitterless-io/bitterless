# EyesOnAgents All Title Search Review — Round 2

Status: accepted

Date: 2026-07-21

## Findings

No open P1, P2, or P3 finding remains.

Round 1's **P2 · blocking** layout contradiction is closed. The general Domain-header rule now
defines the three projections explicitly: custom Domain shows its management control, All shows
Search, and Focus has no action (`docs/integrations/eyes-on-agents-layout.md:159-166`). That rule
agrees with the later All-search contract at lines 182-189 and with the `all`-gated trigger in
`src/renderer/eyesOnAgents/src/components/DomainColumn/DomainColumn.vue:37-50`. The nearby statement
that Focus and All do not expose an editable cursor/input remains scoped to the immediately
preceding custom-title editing contract; it does not prohibit All's separate search row.

Round 1's **P3 · non-blocking** focus-return issue is also closed. The Search toggle ref now models
the Arco component's native `$el`, and close first clears the query, hides the row, waits for the DOM
update, then focuses that native button root
(`src/renderer/eyesOnAgents/src/components/DomainColumn/DomainColumn.vue:169,194-199`). This makes
Escape return keyboard focus to the still-visible toggle instead of silently calling a nonexistent
component `focus()` method. The source guard requires both the `$el` ref shape and native-root focus
call and rejects the former direct component call
(`scripts/eyes-on-agents/ui-source.test.mjs:462-475`).

## Static contract assessment

- Search remains available only from the fixed All header. Its mini input renders above the Project
  filter and receives focus after opening; Focus and custom Domain headers receive no search control
  (`DomainColumn.vue:37-99,189-208`; `AgentBoard.vue:13-37`).
- Explicit Clear empties only the title query, leaves the row open, and refocuses its input. Escape
  and toggle-close clear before hiding and return focus to the toggle; All-column unmount clears the
  query before a closed-state remount (`DomainColumn.vue:194-213,238-240`).
- The store applies Project filtering first, normalizes the trimmed query with locale-aware
  lowercase, and performs substring matching only against non-null `thread.title`. It does not
  search thread ID, cwd/path, Project metadata, prompt/preview, response, content, or task 016's
  planned `lastUserPrompt` (`src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts:92-103`).
- Project options and their counts still derive from full `allThreads`; Focus and custom Domain
  getters remain independent. Clear does not mutate `allProjectFilter`, so it restores the current
  Project selection's complete result (`eyesOnAgents.store.ts:77-89,111-166`).
- `allTitleQuery` remains renderer-store state. Snapshot application changes only the snapshot, so
  refreshes retain and recompute the query while renderer restart initialization resets it
  (`eyesOnAgents.store.ts:42-55,168-194,353-356`).
- Title-search empty messaging precedes Project-specific messaging. Search, Clear, placeholder, and
  empty-state labels remain localized in English and Chinese; labels, `aria-expanded`,
  `aria-controls`, search semantics, and keyboard focus treatment remain present
  (`DomainColumn.vue:37-97,173-184`; `src/renderer/common/i18n/en.ts:257-276`;
  `src/renderer/common/i18n/zh.ts:259-278`).
- Search styling remains compact and shallow-BEM, uses `oklch()` for new colors, and relies on
  background hierarchy without a decorative permanent border or shadow
  (`DomainColumn.less:109-174`).
- The task-specific source guard remains aligned with the implementation across placement, row
  order, focus/clear/close/unmount lifecycle, Project-first title-only filtering, forbidden fields,
  renderer-only ownership, snapshot retention, empty precedence, i18n, and styling. Existing task
  013-015 guards remain intact, including the single non-overlapping refresh poll; the title
  predicate continues to exclude task 016 content (`ui-source.test.mjs:58-128,367-584,586-872`).

## Conclusion

**Pass.** Both Round 1 findings are closed, no new P1/P2/P3 finding was found, and task 017 is ready
to proceed from static review. Ral's visual interaction check remains the runtime acceptance step
specified by the task.

## Verification

Per owner instruction, this review ran no tests, build, typecheck, formatter, or Electron process.
The assessment used only the current task/context documents, source, source guards, dependency
source needed to confirm the Arco native-root behavior, Round 1 findings, and `git diff`. Only this
Round 2 review document was added by the reviewer.
