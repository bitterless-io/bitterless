---
id: eyes-on-agents-all-title-search-017
scope: simple title substring search in the EyesOnAgents All column
status: done
depends-on: [eyes-on-agents-refresh-polling-015]
---

# EyesOnAgents All Title Search

## Objective

Add one compact Search button to the All column so its threads can be filtered by a simple title
substring, with an explicit Clear control that restores the unsearched result.

## Context

- [EyesOnAgents layout](../../integrations/eyes-on-agents-layout.md)
- [EyesOnAgents integration](../../integrations/eyes-on-agents.md)
- [EyesOnAgents Project filter](../../features/eyes-on-agents-project-filter.md)

## Required behavior

```text
┌ All ────────────────────────────── [Search] ┐
│ [ Search titles____________________ ] [Clear] │
│ [ Project: All__________________________ ▾ ] │
│ thread cards                                      │
└─────────────────────────────────────────────────┘
```

- Render one icon-only Search button in the fixed All header only. Focus and custom Domain headers
  receive no search control.
- Opening Search renders one mini input above the Project filter and focuses it. Search updates as
  the user types; no submit action, persistence, debounce, XPC call, or new component store is added.
- Normalize with `trim()` plus locale-aware lowercase and match only non-null `thread.title` using
  substring inclusion. Do not search UUID, cwd, Project metadata, prompt preview, or response data.
- Compose title search with the existing Project filter. Clear restores all threads belonging to the
  current Project selection and must not reset that selection.
- Provide an explicit icon Clear button with an accessible English/Chinese label. Clear keeps the
  search row open and focuses the input. Escape or toggling Search closed clears before hiding it, so
  a hidden query never continues filtering. Unmounting the All column also clears the query before a
  later closed-state remount.
- Store the query only in the renderer store. Refreshing snapshots retains the current query and
  recomputes against new titles; restarting the renderer resets it.
- When title search produces no rows, show a title-search-specific empty message before existing
  Project-specific empty messaging.
- Use Arco mini controls, Tabler Search/X icons at compact sizes, accessible labels/expanded state,
  visible focus, shallow BEM, `oklch()` for new colors, background hierarchy, and no decorative
  permanent border or shadow.

## Path

- `docs/integrations/eyes-on-agents-layout.md`
- `docs/integrations/eyes-on-agents.md`
- `docs/plan/README.md`
- `docs/plan/tasks/eyes-on-agents-all-title-search-017.md`
- `src/renderer/eyesOnAgents/src/components/DomainColumn/DomainColumn.vue`
- `src/renderer/eyesOnAgents/src/components/DomainColumn/DomainColumn.less`
- `src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts`
- `src/renderer/common/i18n/en.ts`
- `src/renderer/common/i18n/zh.ts`
- `scripts/eyes-on-agents/ui-source.test.mjs`

## Verification

- Independent static review checks All-only placement, open/focus/close/clear/Escape lifecycle,
  case-insensitive title-only substring filtering, composition with Project filtering, scoped empty
  state, transient storage, accessibility, i18n, compact styling, and preservation of Focus/custom
  Domain lists.
- Source guards prohibit ID/path/Project/content matching and require the explicit Clear path to
  restore the currently selected Project result.
- Per owner instruction, do not launch Electron or run tests, builds, formatter, or typecheck; Ral
  performs the visual interaction check.

## Review

- Round 1: [eyes-on-agents-all-title-search-017-1](../reviews/eyes-on-agents-all-title-search-017-1.md)
  — blocked on a contradictory blanket header rule and found that the Arco Button ref could not
  return native keyboard focus after closing Search.
- Round 2: [eyes-on-agents-all-title-search-017-2](../reviews/eyes-on-agents-all-title-search-017-2.md)
  — accepted after the projection-specific header contract and native `$el` focus path were made
  explicit; no P1/P2/P3 finding remains.
