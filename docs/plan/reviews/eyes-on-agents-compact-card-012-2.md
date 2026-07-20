# EyesOnAgents Compact Card Action Sizing Review — Round 2

Status: accepted

Date: 2026-07-20

## Conclusion

**Pass.** The action-sizing follow-up reduces the Folder, Open, and More glyphs to 10px, 9px, and
12px and reduces all three action boxes from 24px to 20px. The scoped override matches the actual
Arco mini icon-only button classes with greater specificity than Arco's 24px default, so the
controls now establish a 20px action-row height rather than merely drawing smaller glyphs inside
24px buttons.

The title-side working loader remains 12px. Tooltip and accessibility text, unread signaling,
Open loading/disabled/read behavior, double-click and keyboard handling, and reduced-motion
behavior remain intact. No P1, P2, or P3 finding was found.

## Findings

No open P1, P2, or P3 finding remains.

## Static contract assessment

- `ThreadCard.vue` renders `IconFolder` at 10px, `IconExternalLink` at 9px, and `IconDots` at 12px
  (`src/renderer/eyesOnAgents/src/components/ThreadCard/ThreadCard.vue:28-68`). The only title-side
  `a-spin` remains explicitly 12px and remains gated by `runtimeState === 'working'`
  (`src/renderer/eyesOnAgents/src/components/ThreadCard/ThreadCard.vue:14-21`).
- The folder metadata box is explicitly 20×20px. The local
  `.thread-card__controls .arco-btn-size-mini.arco-btn-only-icon` rule sets both icon-only action
  buttons to 20×20px (`src/renderer/eyesOnAgents/src/components/ThreadCard/ThreadCard.less:87-102`).
- The installed Arco button contract gives `.arco-btn-size-mini.arco-btn-only-icon` a 24×24px box.
  Arco adds `arco-btn-only-icon` whenever the button has an icon slot and no default slot; both Open
  and More have exactly that shape. The ThreadCard selector has one additional class in its scope,
  so its 20px width and height override the 24px defaults without `!important` and without changing
  mini buttons elsewhere.
- The controls group is flex-aligned and its folder and two buttons are all 20px high. Arco Tooltip
  and Dropdown Trigger merge trigger attributes into the first child rather than adding a taller
  layout wrapper. The relative-time text is smaller than the controls, so the action row is now
  controlled by the 20px boxes rather than Arco's former 24px button height.
- Folder tooltip content, localized full-path `title` and `aria-label`, localized Open tooltip/title,
  unread-aware Open label, and the red dot over the Open wrapper are unchanged. The unread dot
  remains visual-only while unread context stays in the button's accessible label.
- Open still binds the same `openingThreadIds` expression to both `loading` and `disabled`, stops its
  click, and calls the existing `openThread` path. The Domain menu and move behavior remain present.
- Card double-click still ignores `.thread-card__control`; card Enter still opens; the controls group
  still stops Enter propagation. These interaction paths are unaffected by the size-only changes.
- The reduced-motion rule still removes the card transition and freezes the working loader's Arco
  loading icon. No sizing rule alters the 12px working loader.
- The renderer source guard now pins all three glyph sizes, the folder's 20×20px box, the scoped
  Arco icon-only 20×20px override, and the unchanged 12px working loader. Its existing assertions
  continue to cover tooltips/ARIA, unread dot, Open loading/disabled/click, double-click/Enter, and
  reduced motion.

## Verification

Per owner instruction, this review ran no tests, build, formatter, typecheck, or Electron process.
The assessment used only the task and layout contracts, current component/style/source-guard diff,
and static inspection of the installed Arco Button, Tooltip, Dropdown, and Trigger implementations.
Only this round-2 review document was added by the reviewer.
