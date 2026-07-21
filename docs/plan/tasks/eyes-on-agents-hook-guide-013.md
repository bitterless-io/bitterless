---
id: eyes-on-agents-hook-guide-013
scope: actionable Codex Hook trust guide inside the EyesOnAgents connection drawer
status: done
depends-on: [eyes-on-agents-compact-card-012, eyes-on-agents-global-onboarding-008]
---

# EyesOnAgents Codex Hook Trust Guide

## Objective

Replace the connection drawer's single-line Hook review hint with a compact, actionable guide that
shows exactly how the user opens Codex, trusts the Bitterless Hook definitions, and confirms the
result back in EyesOnAgents.

## Context

- [Codex observation contract](../../features/eyes-on-agents-codex-observation.md)
- [EyesOnAgents layout](../../integrations/eyes-on-agents-layout.md)
- [Global Codex observation onboarding](eyes-on-agents-global-onboarding-008.md)
- Official Codex Hooks contract: non-managed command Hooks run only after the user reviews and
  trusts the exact current definition; changed definitions require review again; `/hooks` opens the
  CLI review surface.

## Required behavior

```text
┌ Allow Bitterless Hooks ────────────────────────────────┐
│ 1  Open Codex Settings                                │
│    Select Review in Codex below.                      │
│ 2  Review the Bitterless Hooks                        │
│    Settings → Hooks → Trust items Codex flags         │
│    CLI: /hooks                                        │
│ 3  Confirm in Bitterless                              │
│    Return here and select Check again.                │
│                                                       │
│ Only Codex grants trust; Bitterless never bypasses it.│
└───────────────────────────────────────────────────────┘
```

- Show the guide when the current review guidance is shown: `needs_trust` or an inspection `error`
  that still requires manual Codex review. Keep it hidden after Codex reports every exact Hook as
  enabled and trusted/managed.
- Keep the current reason-specific summary for disabled, modified, untrusted, or unavailable trust
  state above the steps.
- Step 1 points to the existing semantic `Review in Codex` / `Re-enable and review` action. It may
  safely re-enable only fresh exact disabled Bitterless entries before opening `codex://settings`.
- Step 2 tells the user to open Codex Settings → Hooks and inspect each Bitterless definition, then
  choose `Trust` for each item Codex marks for review; CLI users may enter `/hooks`. A disabled Hook
  may retain trust and require only re-enabling, so the guide must not claim all four definitions
  always need a new Trust action.
- Step 3 tells the user to return to Bitterless and select `Check again`; window activation may
  perform the same recheck automatically.
- State clearly that only Codex records trust. Bitterless never clicks Trust, writes a trust hash,
  or bypasses review.
- Use the existing amber trust background, a real numbered sequence, and background contrast. Do
  not add decorative borders, shadows, a new modal, or another settings surface.
- Add complete English and Chinese copy through `i18nHelper`; do not hardcode user-facing text in
  the Vue component.

## Path

- `docs/features/eyes-on-agents-codex-observation.md`
- `docs/integrations/eyes-on-agents-layout.md`
- `docs/plan/README.md`
- `docs/plan/tasks/eyes-on-agents-hook-guide-013.md`
- `src/renderer/eyesOnAgents/src/components/ConnectionPanel/ConnectionPanel.vue`
- `src/renderer/eyesOnAgents/src/components/ConnectionPanel/ConnectionPanel.less`
- `src/renderer/common/i18n/en.ts`
- `src/renderer/common/i18n/zh.ts`
- `scripts/eyes-on-agents/ui-source.test.mjs`

## Verification

- Independent static review checks the rendered structure, state visibility, English/Chinese copy,
  existing Review/Check action wiring, and absence of a renderer trust mutation path.
- Source guards require the three ordered steps and the Codex-only trust boundary.
- Per owner instruction, do not launch Electron or run tests, builds, formatter, or typecheck; Ral
  performs the visual interaction check.

## Review

- Round 1: [eyes-on-agents-hook-guide-013-1](../reviews/eyes-on-agents-hook-guide-013-1.md) — one
  blocking CSS color-format finding required the new guide colors to use `oklch()` or inheritance.
- Round 2: [eyes-on-agents-hook-guide-013-2](../reviews/eyes-on-agents-hook-guide-013-2.md) — accepted;
  the color-contract finding is closed and no P1/P2/P3 finding remains.
