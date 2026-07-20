---
id: eyes-on-agents-all-board-011
scope: reshape EyesOnAgents Domain board navigation and editing
status: done
depends-on: [eyes-on-agents-reactive-time-010]
---

# EyesOnAgents All And Wrapping Domain Board

## Objective

Replace the user-visible Uncategorized column with a fixed All projection, make custom Domain
titles directly editable like Todo, and wrap columns into multiple rows with a 600px per-column
height ceiling and internal thread scrolling.

## Context

- [EyesOnAgents layout](../../integrations/eyes-on-agents-layout.md)
- [EyesOnAgents integration](../../integrations/eyes-on-agents.md)
- [EyesOnAgents Project filter](../../features/eyes-on-agents-project-filter.md)
- Todo `DomainColumn` title editing is the interaction and input-sizing reference.

## Required behavior

```text
┌ Focus ──────────┐ ┌ All ─────────────┐ ┌ Bitterless ─────┐
│ focused threads │ │ every thread      │ │ assigned threads │
│       ↕ scroll  │ │ Project filter    │ │       ↕ scroll  │
└─────────────────┘ └───────────────────┘ └──────────────────┘

┌ Research ───────┐ ┌ Release ─────────┐ ┌ + Domain ────────┐
│ assigned threads │ │ assigned threads │ │                  │
└─────────────────┘ └───────────────────┘ └──────────────────┘
```

- Keep the persisted `domain_key = 'uncategorized'` row and all repository fallback/delete
  behavior unchanged. Its renderer label is `All`.
- All displays every non-archived thread from the renderer snapshot, regardless of `domain_id`.
  Focus and custom Domain contents retain their existing definitions.
- The Project filter appears only in All. Its options, counts, total, and results use all visible
  threads, so changing or deleting a Domain does not remove a thread from the filter universe.
- All is a clone-safe projection: it cannot be sorted or receive drops, and dragging from it clones
  the card into a custom Domain. Moving a thread to the system fallback remains available from the
  thread Domain menu as All. Focus keeps its current clone-source behavior.
- Reserve the visible name `All`: Add Domain and custom Domain rename must reject case-insensitive
  duplicates of All as well as existing Domain titles.
- Focus and All are fixed and cannot be renamed, reordered, or deleted.
- Clicking a custom Domain title enters inline editing. Match Todo's title/input metrics and measure
  the input from its content within 40–200px. Focus/select on entry; Enter blurs and submits; blur
  trims and submits a valid change; Escape cancels. Keep the existing duplicate and empty guards.
- Remove Rename from the Domain overflow menu and remove its unused icon/string. Delete remains.
- Put Focus, All, custom Domains, and Add Domain in one wrapping container. Remove the obsolete
  horizontal-scroll jump-to-Focus control.
- A Domain column is 300px wide (280px at the existing compact breakpoint), grows only as needed,
  and never exceeds 600px high. Its thread body owns vertical overflow. The board owns vertical
  scrolling across wrapped rows and does not depend on horizontal scrolling.
- Preserve custom Domain ordering, deletion confirmation, thread opening/read semantics, Project
  search, and the background-led Todo visual hierarchy.

## Expected paths

- `docs/INDEX.md`
- `docs/plan/analysis/eyes-on-agents.md`
- `docs/integrations/eyes-on-agents.md`
- `docs/integrations/eyes-on-agents-layout.md`
- `docs/features/eyes-on-agents-project-filter.md`
- `src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts`
- `src/renderer/eyesOnAgents/src/components/AgentBoard/`
- `src/renderer/eyesOnAgents/src/components/DomainColumn/`
- `src/renderer/eyesOnAgents/src/components/ProjectFilter/ProjectFilter.vue`
- `src/renderer/eyesOnAgents/src/components/ThreadCard/ThreadCard.vue`
- `src/renderer/eyesOnAgents/src/components/AddDomainColumn/`
- `src/renderer/common/i18n/en.ts`
- `src/renderer/common/i18n/zh.ts`
- `scripts/eyes-on-agents/ui-source.test.mjs`
- `scripts/eyes-on-agents/project-filter-render.test.mjs`

## Verification

- Static review confirms All and its Project filter use all snapshot threads while Focus/custom
  Domain getters are unchanged.
- Static review confirms All is clone-only/no-put/no-sort and no per-Domain data is duplicated in
  persistence.
- Static review confirms only custom titles expose click-to-edit, dynamic 40–200px sizing, Enter,
  blur, Escape, duplicate, and empty handling; no Rename menu item remains.
- Static review confirms one wrapping container, no horizontal jump control, 600px maximum column
  height, and column-body vertical scrolling.
- The owner performs visual/drag/runtime Electron verification; the agent does not launch Electron.
