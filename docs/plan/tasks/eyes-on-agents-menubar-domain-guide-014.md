---
id: eyes-on-agents-menubar-domain-guide-014
scope: menubar Domain creation and always-visible Codex Hook guide
status: done
depends-on: [eyes-on-agents-hook-guide-013]
---

# EyesOnAgents Menubar Domain Creation And Connection Guide

[Task 020](eyes-on-agents-thread-ingestion-prompt-card-020.md) preserves this task's always-visible
guide and extends its historical three-step Hook setup with a fourth independent, default-off
latest-question consent step.

## Objective

Move Domain creation out of the wrapping board and into the EyesOnAgents menubar, and keep the
complete Codex Hook setup guide visible whenever the Codex connections drawer is open.

## Context

- [EyesOnAgents layout](../../integrations/eyes-on-agents-layout.md)
- [Codex observation contract](../../features/eyes-on-agents-codex-observation.md)
- [Hook guide](eyes-on-agents-hook-guide-013.md)
- Existing Todo and EyesOnAgents menubar sizing, button, and background hierarchy are the visual
  reference; do not import Todo-private state or components.
- Codex content capability does not broaden this task: Hooks and App Server can expose message
  content, but EyesOnAgents keeps its metadata-only projection and does not add a last-question
  preview, transcript read, or completion-driven read receipt.

## Required behavior

```text
┌ EyesOnAgents ───── [+ Add Domain] [● Connections] [↻ Refresh] [Plug] […] ┐
│                    ┌ Add Domain ─────────────────────┐                    │
│                    │ [Domain name__________________] │                    │
│                    │                    [Cancel] [Create]                 │
│                    └─────────────────────────────────┘                    │
├───────────────────────────────────────────────────────────────────────────┤
│ [Focus] [All] [Custom Domain] [Custom Domain] …                           │
│ No standalone Add Domain column                                            │
└───────────────────────────────────────────────────────────────────────────┘
```

### Menubar Domain creation

- Render one labelled `Add Domain` control with a plus icon inside the menubar action region.
- Clicking it opens a compact anchored form below the control. Opening focuses the input; Escape,
  Cancel, outside dismissal, or successful creation closes and resets the form.
- Preserve the existing creation contract: trim the title, require a non-empty value, reject
  case-insensitive duplicates and the reserved `All` name, call the existing store create action,
  and retain the form when creation fails.
- Disable or show busy state through the existing `domain-create` action; do not create another
  store, XPC method, modal, or Domain persistence path.
- Remove the board footer, `AddDomainColumn` component, and every `add-domain-column` selector. The
  wrapping draggable list contains only Focus, All, and custom Domain columns; ordering behavior is
  unchanged.
- Use `size="mini"`, accessible labels, visible keyboard focus, `oklch()` colors for new CSS, and a
  compact background-led popup without a decorative permanent border.

### Always-visible Hook guide

```text
┌ Codex Hook setup ───────────────────────────────────────────┐
│ 1 Install or repair                                         │
│   Enable when absent; Repair only when definitions drift.   │
│ 2 Review only when requested                                │
│   Needs review → Settings/Hooks → Trust flagged items.      │
│ 3 Verify status                                             │
│   Check again while pending; Check status after install.    │
└─────────────────────────────────────────────────────────────┘
```

- Render the guide whenever the connections drawer is open, including `not_installed`, `drifted`,
  `needs_trust`, `error`, and `installed`; do not gate the guide itself on review state.
- Make the steps a fixed conditional lifecycle that remains truthful across states. Step 1 says to
  use `Enable observation` only when absent and `Repair` only for drift. Step 2 says to use
  `Review in Codex` / `Re-enable and review` only when the status requests review, then open
  Settings → Hooks, Trust only Codex-flagged definitions, or use CLI `/hooks`. Step 3 says to use
  `Check again` while review/status is pending and `Check status` after installation.
- Keep the reason-specific live summary only for `needs_trust` and `error`. The guide is normal
  document content, not a live region.
- Preserve the current per-state action matrix and every existing store handler. Do not expose a
  trust RPC, write trust hashes, or claim that Bitterless grants trust.
- Use a quiet neutral background for the always-visible guide so an installed bridge does not look
  like a warning. Reserve the amber treatment for the conditional review/error summary. Keep
  ordered-list semantics, English/Chinese i18n, and no decorative guide border or shadow.

## Path

- `docs/features/eyes-on-agents-codex-observation.md`
- `docs/integrations/eyes-on-agents-layout.md`
- `docs/plan/README.md`
- `docs/plan/tasks/eyes-on-agents-menubar-domain-guide-014.md`
- `src/renderer/eyesOnAgents/src/components/AgentBoard/AgentBoard.vue`
- `src/renderer/eyesOnAgents/src/components/EyesOnAgentsMenuBar/`
- `src/renderer/eyesOnAgents/src/components/AddDomainPopover/`
- `src/renderer/eyesOnAgents/src/components/AddDomainColumn/` (remove)
- `src/renderer/eyesOnAgents/src/components/ConnectionPanel/ConnectionPanel.vue`
- `src/renderer/common/i18n/en.ts`
- `src/renderer/common/i18n/zh.ts`
- `scripts/eyes-on-agents/ui-source.test.mjs`

## Verification

- Independent static review checks component placement, form lifecycle and validation, draggable
  ordering preservation, guide visibility in every bridge state, action wiring, i18n, accessibility,
  `oklch()` use, absence of a renderer trust mutation path, and preservation of the metadata-only
  observation boundary.
- Source guards require the menubar control and prohibit the old board footer/component contract;
  they also require the unconditional three-step guide and conditional summary.
- Per owner instruction, do not launch Electron or run tests, builds, formatter, or typecheck; Ral
  performs the visual interaction check.

## Review

- Round 1: [eyes-on-agents-menubar-domain-guide-014-1](../reviews/eyes-on-agents-menubar-domain-guide-014-1.md)
  — blocked on the layout document still describing the removed Add Domain column; it also found
  that the Hook guide source guards did not precisely enforce unconditional guide visibility and
  the `needs_trust`/`error` summary predicate.
- Round 2: [eyes-on-agents-menubar-domain-guide-014-2](../reviews/eyes-on-agents-menubar-domain-guide-014-2.md)
  — accepted after the layout contract was corrected and both source guards were made exact; no
  implementation or acceptance finding remains.
