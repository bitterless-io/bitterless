# EyesOnAgents Compact Card Review — Round 1

Status: accepted

Date: 2026-07-20

## Conclusion

**Pass.** The renderer removes every Domain-header count and collapses each thread card to a title
row plus one action row. Its working-only loader, relative time, folder metadata, icon-only Open,
unread dot, Domain menu, Open/read behavior, shared 10-second clock,
drag/double-click/keyboard interactions, compact spacing, reduced-motion rule, and Project-option
counts all match the task contract on static inspection.

The initial layout-document contradiction was corrected during review. The canonical board diagram
now shows the same compact title/action card shape as the implementation, with no visible runtime
or `New` row. No P1, P2, or P3 finding remains.

## Findings

No open P1, P2, or P3 finding remains.

The first review found a **P2 · blocking** contradiction in the canonical layout diagram: two cards
still showed `Idle` and `Finished · new` despite task 012 removing that visible status row. The
diagram now renders `Project notes` / `Fix migrations` as titles followed directly by relative time
and action icons (`docs/integrations/eyes-on-agents-layout.md:38-41`), consistent with both the
explicit card contract (`docs/integrations/eyes-on-agents-layout.md:79-82,156-180`) and the component
(`src/renderer/eyesOnAgents/src/components/ThreadCard/ThreadCard.vue:11-88`). The finding is closed.

## Static contract assessment

- No `agent-domain__count` DOM, selector, prop, or derived label remains in the EyesOnAgents
  renderer. The All-column `totalCount` path and its count-localization strings are also removed.
- `ProjectFilter` still renders each option's `option.count` and includes the count in the selected
  label, preserving the intentionally separate Project count contract.
- `ThreadCard` contains no `thread-card__status-row`, visible `runtimeLabel`, `New` badge,
  `thread-card__meta`, or visible path text. Only `runtimeState === 'working'` mounts the title-side
  loader; other runtime states reserve no status element.
- The action row places relative time first and a right-side controls group in folder, Open, menu
  order. The folder carries the localized full path in tooltip, title, and accessible label.
- Unread is a red dot over the Open wrapper. The dot is hidden from assistive technology while the
  Open button's localized accessible label adds localized unread context. Existing loading,
  disabled, click, successful-open/read, and error swallowing paths remain unchanged.
- The card retains its two-line title, draggable container behavior, double-click open, card-level
  Enter open, and control-level Enter isolation. Its relative time still depends on the single
  renderer-global clock started/stopped by `App.vue` at a 10-second interval.
- The obsolete card minimum height, title minimum height, Domain-header minimum height, and extra
  row gaps are removed. The working loader animation is disabled under `prefers-reduced-motion`.
- Renderer source guards cover the removed count/status/meta selectors, working-only loading,
  action-row order, folder accessibility, Open unread semantics, compact metrics, interaction
  preservation, reduced motion, and retained Project-option counts.

## Verification

Per owner instruction, this review ran no tests, build, formatter, typecheck, or Electron process.
The assessment used only the task/design contracts, current source, source guards, dependency
markup inspection, and `git diff`. Only this review document was added or updated by the reviewer.
