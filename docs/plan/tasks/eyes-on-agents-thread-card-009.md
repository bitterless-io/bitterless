---
id: eyes-on-agents-thread-card-009
scope: simplify EyesOnAgents thread-card status and open controls
status: done
depends-on: [eyes-on-agents-global-onboarding-008]
---

# EyesOnAgents Thread Card Simplification

## Objective

Remove card decoration that does not help Ral identify or open a Codex thread. Keep status readable
as text and make the Open action an accessible icon-only control.

## Context

- [EyesOnAgents layout](../../integrations/eyes-on-agents-layout.md)
- [EyesOnAgents integration](../../integrations/eyes-on-agents.md)
- Todo thread-item background and spacing are the visual reference.

## Required behavior

```text
┌────────────────────────────────┐
│ WORKING   NEW                  │
│ Thread title                   │
│ folder project/path · now      │
│                         [↗] […]│
└────────────────────────────────┘
```

- Remove the entire signal rail/dot DOM and its state colors, pulse animation, and reduced-motion
  exception.
- Remove the source badge, tooltip, initials, and renderer-only source label computations.
- Preserve the runtime text, unread badge, title, path, activity time, Domain menu, keyboard Enter,
  double-click, drag behavior, and persisted source metadata.
- Render Open as only the external-link icon. Preserve its loading/disabled behavior and expose the
  localized Open text through tooltip, `title`, and `aria-label`.
- Keep the unbordered Todo-style background hierarchy; do not replace removed decoration with a new
  border, badge, rail, or animation.
- Update the focused renderer source guard so removed elements cannot silently return.

## Expected paths

- `docs/integrations/eyes-on-agents-layout.md`
- `src/renderer/eyesOnAgents/src/components/ThreadCard/ThreadCard.vue`
- `src/renderer/eyesOnAgents/src/components/ThreadCard/ThreadCard.less`
- `scripts/eyes-on-agents/ui-source.test.mjs`

## Verification

- Static source review confirms there is no `thread-card__signal` or `thread-card__source` markup,
  selector, runtime helper, or animation.
- Static source review confirms the Open button has no visible text and retains localized tooltip,
  `title`, `aria-label`, loading, disabled, and click behavior.
- The owner performs the visual Electron check; no Electron process is launched by the agent.
