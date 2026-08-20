# EyesOnAgents Content Does Not Reflow When the Window Shrinks

Status: implemented; owner verification pending

## Symptom

After the window minimum dropped to 480px
([task 056](../plan/tasks/eyes-on-agents-focus-full-width-056.md)), dragging the window narrower
stops re-laying out the board: the header and cards keep their wide geometry and get clipped at the
right edge instead of shrinking with the window.

## Root cause

`src/renderer/eyesOnAgents/src/App.less` pins the renderer root at the **old** window floor:

```less
.eyes-on-agents {
  width: 100vw;
  min-width: 800px;   /* ← content stops shrinking here */
  min-height: 600px;
}
```

The root is the flex parent of the menu bar and the board. Once the viewport is narrower than
800px, `min-width` wins over `width: 100vw`, so the root stays 800px wide while the window is
smaller. The root's `overflow: hidden` then clips the overflow, which reads as "the content did not
relayout". Only the Omni embedding escaped it, because `.eyes-on-agents--omni` already resets both
floors to `0`.

The column itself was fine: it is `flex: 1 1 auto` with `min-width: 0`, so it tracks whatever width
its parent reports.

## Resolution contract

- The renderer root does not carry a width or height floor. The OS window
  (`minWidth: 480`, `minHeight: 600`) is the only size gate, and the standalone and Omni hosts then
  share one rule instead of maintaining two floors that can drift apart.
- The root keeps `width: 100vw`, `height: 100vh`, `display: flex`, and `overflow: hidden`, so the
  board always matches the viewport and only the column body scrolls.
- Every descendant that must shrink already carries `min-width: 0`; nothing may reintroduce a pixel
  floor above the window minimum.

Also cleaned up in the same pass: `.thread-card` still declared `cursor: grab` after card
drag-and-drop was removed in
[task 054](../plan/tasks/eyes-on-agents-focus-only-board-054.md). A non-draggable card must not
advertise a drag handle, so it uses the default cursor.

Delivery: [eyes-on-agents-focus-search-toggle-058](../plan/tasks/eyes-on-agents-focus-search-toggle-058.md)
