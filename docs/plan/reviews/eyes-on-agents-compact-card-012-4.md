# EyesOnAgents Natural Title Height Review — Round 4

Status: accepted

Date: 2026-07-20

## Conclusion

**Pass.** `thread-card__title` now has an explicit 18px line height, an 18px one-line minimum, and
a 36px two-line maximum. It has no fixed height and retains its natural wrapping, hidden overflow,
vertical WebKit box, and two-line clamp, so a short title occupies one line while only wrapped
content grows to the second line.

The working loader, action dimensions, idle-unread presentation, accessibility, Open behavior,
double-click/keyboard handling, move menu, shared time source, and reduced-motion behavior remain
unchanged. No P1, P2, or P3 finding was found.

## Findings

No open P1, P2, or P3 finding remains.

## Static contract assessment

- The task and canonical layout both define a one-line 18px default/minimum with natural growth to
  a 36px/two-line maximum, explicitly forbidding preallocation of the second line
  (`docs/plan/tasks/eyes-on-agents-compact-card-012.md:35-55,74-86`;
  `docs/integrations/eyes-on-agents-layout.md:156-175,209-241`).
- `.thread-card__title` sets `line-height: 18px`, `min-height: 18px`, and `max-height: 36px`
  (`src/renderer/eyesOnAgents/src/components/ThreadCard/ThreadCard.less:47-62`). It does not set a
  fixed `height`; the card shell and title row also have no fixed title-height allocation.
- The title is an `h3` with `margin: 0` and no padding or border. A single line therefore resolves
  to its 18px line box/minimum. `max-height` constrains rather than allocates space, so it cannot
  reserve the unused second 18px line.
- `min-width: 0`, flexible width, `overflow-wrap: anywhere`, and normal text content preserve
  content-driven wrapping. `display: -webkit-box`, `-webkit-box-orient: vertical`, hidden overflow,
  and `-webkit-line-clamp: 2` remain together, so a wrapped title grows naturally but a third line
  is clipped at the documented 36px maximum.
- The title row still aligns its children at the start. The working indicator remains an 18px-high
  side box containing the unchanged 12px spinner, shown only for exact `working`; it aligns with
  the first title line and does not force a second line
  (`src/renderer/eyesOnAgents/src/components/ThreadCard/ThreadCard.vue:12-21`;
  `src/renderer/eyesOnAgents/src/components/ThreadCard/ThreadCard.less:41-74`).
- Folder/Open/More remain 10px/9px/12px with 20×20px action boxes. The title sizing rules do not
  touch the action row, tooltip, full-path accessibility metadata, Open loading/disabled state, or
  unread-dot positioning.
- `showUnreadDot` still requires exact `isUnread && runtimeState === 'idle'`, and the Open accessible
  label still uses the same computed value. Working retains only the title loader; waiting, failed,
  ended, and unknown retain no unread dot.
- The card still opens through the same double-click and card-Enter handlers, isolates control
  Enter events, excludes Open/More controls from double-click opening, retains the Domain move menu,
  and derives time from the renderer-global 10-second clock. Reduced motion still disables the card
  transition and working-loader animation.
- The source guard pins the 18px line height/minimum, 36px maximum, hidden overflow, natural
  anywhere wrapping, and two-line clamp. It rejects the old proportional line height, the old
  34/36px minimum, a fixed 36px height, and any fixed card-shell height while retaining all loader,
  action-size, idle-unread, accessibility, interaction, and reduced-motion assertions
  (`scripts/eyes-on-agents/ui-source.test.mjs:177-296`).

## Verification

Per owner instruction, this review ran no tests, build, formatter, typecheck, or Electron process.
The assessment used only the updated task/layout, current ThreadCard template and Less, and the
renderer source guard. Only this round-4 review document was added by the reviewer.
