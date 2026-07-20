# EyesOnAgents Domain Body Spacing Review — Round 5

Status: accepted

Date: 2026-07-20

## Conclusion

**Pass.** `.agent-domain__body` now uses exactly `padding: 0 9px 9px`, which removes only the top
padding and retains 9px on the right, bottom, and left. The 600px Domain cap and internal body
scrolling remain intact, while the Project filter stays between the Domain header and scrollable
thread list and each `ThreadCard` remains the draggable list item.

The source guard pins the new padding contract and retains the prior board, Project-filter, and
compact-card assertions. The four preceding card-review contracts remain unchanged. No P1, P2, or
P3 finding was found.

## Findings

No open P1, P2, or P3 finding remains.

## Static contract assessment

- The task requires zero top padding with 9px horizontal and bottom padding, and its verification
  repeats the same four-side contract
  (`docs/plan/tasks/eyes-on-agents-compact-card-012.md:52-53,89-90`). The canonical layout likewise
  specifies that the Project filter or first thread begins directly below the header while retaining
  9px horizontal and bottom edge spacing
  (`docs/integrations/eyes-on-agents-layout.md:138-146`).
- `.agent-domain__body` contains the single declaration `padding: 0 9px 9px`; CSS three-value
  shorthand resolves to top `0`, right `9px`, bottom `9px`, and left `9px`. No later longhand,
  logical-padding declaration, media override, or duplicate body rule changes those sides
  (`src/renderer/eyesOnAgents/src/components/DomainColumn/DomainColumn.less:109-115`).
- The Domain shell still uses `max-height: 600px`, a column flex layout, `min-height: 0`, and hidden
  shell overflow. Its body remains a shrinkable flex child with `min-height: 0` and
  `overflow-y: auto`, so lists beyond the cap scroll inside the Domain instead of stretching the
  board row (`src/renderer/eyesOnAgents/src/components/DomainColumn/DomainColumn.less:1-14,109-123`).
- `ProjectFilter` remains conditional and directly after the Domain header; the scrollable body
  follows it, and its draggable list still renders one `ThreadCard` per item
  (`src/renderer/eyesOnAgents/src/components/DomainColumn/DomainColumn.vue:53-76`). The filter keeps
  its own zero-top, 9px-horizontal wrapper spacing and searchable Select, so the spacing follow-up
  did not change filter ownership or card nesting
  (`src/renderer/eyesOnAgents/src/components/ProjectFilter/ProjectFilter.less:1-4`;
  `src/renderer/eyesOnAgents/src/components/ProjectFilter/ProjectFilter.vue:1-25`).
- The board still wraps 280–300px Domains and owns vertical page scrolling. Focus and All remain the
  fixed projections, custom Domains remain the sortable items, and All alone still enables the
  Project filter (`src/renderer/eyesOnAgents/src/components/AgentBoard/AgentBoard.vue:1-43`;
  `src/renderer/eyesOnAgents/src/components/AgentBoard/AgentBoard.less:1-17`).
- The source guard extracts the `.agent-domain__body` rule, requires `overflow-y: auto` and the exact
  `padding: 0 9px 9px` declaration, rejects the former uniform `padding: 9px`, and continues to pin
  `max-height: 600px`, board wrapping, and the Project-filter/ThreadCard component paths
  (`scripts/eyes-on-agents/ui-source.test.mjs:296-395`).
- The first four review contracts are unaffected: Domain counts and separate status/meta rows remain
  absent; the title naturally occupies one 18px line and grows to at most 36px/two lines; only
  working shows the unchanged 12px title loader; only idle unread shows the Open red dot; time,
  folder, Open, and More remain one action row with 10px/9px/12px glyphs and 20px control boxes;
  tooltip/ARIA, Open loading, double-click/Enter, Domain movement, global reactive time, and reduced
  motion remain present (`src/renderer/eyesOnAgents/src/components/ThreadCard/ThreadCard.vue:1-167`;
  `src/renderer/eyesOnAgents/src/components/ThreadCard/ThreadCard.less:1-133`;
  `scripts/eyes-on-agents/ui-source.test.mjs:177-294,333-358`).

## Verification

Per owner instruction, this review ran no tests, build, formatter, typecheck, or Electron process.
The assessment used only the updated task/layout, current Domain/ProjectFilter/ThreadCard structure
and styles, and the renderer source guard. Only this round-5 review document was added by the
reviewer.
