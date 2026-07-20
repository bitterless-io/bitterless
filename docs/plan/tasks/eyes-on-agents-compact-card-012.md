---
id: eyes-on-agents-compact-card-012
scope: compact EyesOnAgents Domain headers and thread-card metadata
status: done
depends-on: [eyes-on-agents-all-board-011]
---

# EyesOnAgents Compact Thread Card

## Objective

Remove redundant Domain counts and card status/meta rows so each Thread card uses its height for
the title and one compact action row only.

## Context

- [EyesOnAgents layout](../../integrations/eyes-on-agents-layout.md)
- [EyesOnAgents integration](../../integrations/eyes-on-agents.md)
- [EyesOnAgents Project filter](../../features/eyes-on-agents-project-filter.md)
- Todo row spacing and background hierarchy are the visual reference.

## Required behavior

```text
┌ Domain title                         […] ┐
│ ┌──────────────────────────────────────┐ │
│ │ Thread title                     [◌] │ │
│ │ now                         [⌂][↗][…]│ │
│ └──────────────────────────────────────┘ │
└──────────────────────────────────────────┘
```

- Remove every `agent-domain__count` element and selector, including Focus, All, custom Domain, and
  filtered All result counts. Keep Project option counts inside the Project filter.
- Remove the complete `thread-card__status-row`, visible runtime text, and `New` badge.
- Put the title and a compact loading indicator in one title row. Show loading only when
  `runtimeState === 'working'`; waiting, terminal, idle, failed, and unknown states do not reserve
  title-row space for another label.
- Remove `thread-card__meta`. Put relative time at the far left of `thread-card__actions`; group the
  working-directory folder icon, icon-only Open, and Domain overflow menu at the right.
- Render working-directory metadata as an icon with the full path in its tooltip/accessibility
  text. Do not retain a visible path string in the compact card.
- Express unread as a red dot at the Open control's upper-right only when `isUnread` is true and
  `runtimeState === 'idle'`. While working, show only the title loader; waiting, failed, ended, and
  unknown states also show no unread dot. Add unread context to the Open accessible label only when
  the dot is visible. Persisted unread, Focus, and opening/read semantics remain unchanged.
- Give `thread-card__title` an explicit 18px line height and one-line minimum height. Let wrapped
  content grow naturally, but cap it at 36px/two lines with the existing line clamp. Never reserve
  two lines for a one-line title. Preserve the renderer-global 10-second time source, drag behavior,
  double-click, keyboard Enter, move menu, and Open loading/disabled behavior.
- Reduce obsolete minimum heights and gaps without adding borders, extra badges, or another row.
- Remove the top padding from `eyesOnAgents__domainColumn__body` / `.agent-domain__body` while
  retaining 9px horizontal and bottom padding (`padding: 0 9px 9px`).
- Reduce every action glyph by 4px: folder `14px -> 10px`, Open `13px -> 9px`, and More
  `16px -> 12px`. Override the two icon-only Arco mini buttons and folder metadata box from 24px to
  20px so the action-row and card height actually shrink; do not change the title-side working
  loader.
- Update renderer source guards so removed count/status/meta DOM and selectors cannot return.

## Expected paths

- `docs/INDEX.md`
- `docs/integrations/eyes-on-agents-layout.md`
- `docs/integrations/eyes-on-agents.md`
- `docs/features/eyes-on-agents-project-filter.md`
- `docs/plan/README.md`
- `src/renderer/eyesOnAgents/src/components/AgentBoard/AgentBoard.vue`
- `src/renderer/eyesOnAgents/src/components/DomainColumn/DomainColumn.vue`
- `src/renderer/eyesOnAgents/src/components/DomainColumn/DomainColumn.less`
- `src/renderer/eyesOnAgents/src/components/ThreadCard/ThreadCard.vue`
- `src/renderer/eyesOnAgents/src/components/ThreadCard/ThreadCard.less`
- `src/renderer/common/i18n/en.ts`
- `src/renderer/common/i18n/zh.ts`
- `scripts/eyes-on-agents/ui-source.test.mjs`

## Verification

- Independent static review confirms no Domain count, status row, visible runtime label, New badge,
  or metadata row remains.
- Independent static review confirms working loading is title-aligned, unread is Open-aligned, and
  time/folder/Open/menu share one bottom row with correct left/right alignment.
- Independent static review confirms Open/read, movement, global time, and accessible labels remain.
- Independent static review confirms working unread has only the title loader, while idle unread
  alone gets the Open upper-right dot and matching accessible label.
- Independent static review confirms a one-line title occupies 18px and a wrapped title grows to at
  most 36px/two lines rather than reserving two lines by default.
- Independent static review confirms the three action glyphs are 10px/9px/12px and their control
  boxes are 20px rather than the Arco mini default of 24px.
- Independent static review confirms the Domain body has zero top padding and retains 9px on the
  other three sides.
- The owner performs the visual Electron check; no Electron process, build, formatter, or test is
  launched by the agent.
