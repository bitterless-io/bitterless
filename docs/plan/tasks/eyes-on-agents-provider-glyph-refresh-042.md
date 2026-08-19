---
id: eyes-on-agents-provider-glyph-refresh-042
scope: Replace the cramped Codex and awkward Claude provider marks with cleaner Tabler glyphs
status: done
superseded-by: eyes-on-agents-official-provider-logos-043
depends-on: [eyes-on-agents-claude-setup-recovery-041]
---

# EyesOnAgents Provider Glyph Refresh

> Superseded by `eyes-on-agents-official-provider-logos-043` after owner visual review rejected the
> Tabler approximations. This file and its reviews retain the historical 042 implementation record.

## Objective

Replace the current small OpenAI knot and asymmetric asterisk with a clearer Tabler pair that stays
legible in task-card and search-result title lines without changing layout height or provider state.

## Context

- `docs/integrations/eyes-on-agents-layout.md`
- `docs/features/eyes-on-agents-claude-observation.md`
- `src/renderer/eyesOnAgents/src/components/ProviderGlyph/`

## Visual contract

The board is a compact daylight operations surface for Ral supervising mixed coding-agent tasks.
Provider identity remains its one title-line signature:

```text
│ [>_] Codex task title      │   Tabler IconPrompt
│ [✦·] Claude task title     │   Tabler IconSparkles
```

- Codex uses `IconPrompt`: one directional command mark that remains readable at 13px.
- Claude uses `IconSparkles`: a balanced three-spark mark that avoids another cramped brand knot.
- Both icons render at 13px inside the existing fixed `13 × 18px` shell.
- Preserve the muted cool Codex color, warm Claude color, tooltip, localized accessible label,
  no background, no border, no shadow, and no additional card/search row.
- The icons must remain distinguishable without relying on color.

## Path

- `docs/features/eyes-on-agents-claude-observation.md`
- `docs/integrations/eyes-on-agents-layout.md`
- `docs/plan/README.md`
- `src/renderer/eyesOnAgents/src/components/ProviderGlyph/ProviderGlyph.vue`
- `scripts/eyes-on-agents/ui-source.test.mjs`

## Verification

- Source tests require `IconPrompt` for Codex and `IconSparkles` for Claude at 13px.
- Existing tests continue to require one fixed 13×18 shell, tooltip, localized ARIA label, and no
  border/background/shadow decoration.
- Run the EyesOnAgents UI aggregate, strict UI typecheck, renderer i18n check, and
  `git diff --check` without launching Electron.
- Independent review must report no open P1, P2, or P3 before completion.

## Implementation evidence

- `ProviderGlyph.vue` now imports Tabler `IconPrompt` for Codex and `IconSparkles` for Claude.
- Both SVGs render at 13px inside the unchanged 13×18px shell. Existing provider colors,
  localized tooltip/ARIA, title-line placement, and decoration-free CSS remain untouched.
- The exact source contract was updated so future UI changes cannot silently restore the old
  OpenAI knot or asymmetric asterisk.

## Verification evidence

- `yarn test:eyes-on-agents:ui` — passed 56/56, including task-card, global-search, compact-shell,
  accessible-label, and decoration guard assertions.
- `yarn typecheck:eyes-on-agents:ui` — passed.
- `yarn check:renderer-i18n` — passed.
- `git diff --check` — passed.
- Electron was not launched; final in-app optical balance remains with Ral.

## Review

- Independent UI acceptance:
  [eyes-on-agents-provider-glyph-refresh-042-1](../reviews/eyes-on-agents-provider-glyph-refresh-042-1.md)
  — accepted with no open P1, P2, or P3 finding.
- Standard code review:
  [eyes-on-agents-provider-glyph-refresh-042-code-review](../reviews/eyes-on-agents-provider-glyph-refresh-042-code-review.md)
  — no task-introduced TS-1, TS-2, FE-1, or FE-2 finding; the pre-existing oversized UI source
  test remains recorded outside this task.
