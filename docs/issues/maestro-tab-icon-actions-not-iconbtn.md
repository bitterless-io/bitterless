# Maestro tab icon actions do not use the shared IconBtn

Status: implemented; owner verification pending

## Observed behavior

The closable Maestro browser tab renders a raw text `×` inside a hand-styled native button. Its
font baseline makes the mark read lower than the tab's visual center. The adjacent New-tab `+`
also uses a separate native-button implementation, so its hover, pressed, and keyboard-focus
feedback does not come from the renderer-wide icon-action primitive.

```text
current
╭ favicon · title ────────────── [ text × ↓ ] ╮   [ custom + ]
╰──────────────────────────────────────────────╯
```

## Required behavior

```text
shared icon-action language
╭ favicon · title ─────────────── [IconBtn X] ╮   [IconBtn +]
╰──────────────────────────────────────────────╯
                         centered 20px             centered 28px
```

- Render both actions through the shared `IconBtn` component required by the Bitterless design
  system. Use real Tabler `IconX` and `IconPlus` SVG glyphs; do not retain a text multiplication
  character or depend on font-baseline positioning.
- Keep the tab close action at `20 × 20px`, centered at the existing `right: 4px`, and preserve its
  current visibility rule: active or hovered closable tabs only. The icon itself is centered by
  `IconBtn`'s `.arco-btn-icon` flex container.
- Keep the New-tab action at `28 × 28px`, centered in its existing wrapper. It inherits the same
  shared hover, active-scale, and focus-visible behavior, while its Royal Blue strip colors remain
  unchanged.
- Preserve close click propagation, locked-width consecutive closing, drag suppression, new-tab
  creation, tab compression, labels, favicons/loading, strip geometry, and macOS native controls.

## Acceptance

- The X and plus glyphs are optically centered and use the shared icon-button interaction states.
- No raw tab action `<button>` or text `×` remains for these two controls.
- The established `36/28/48/84px` MenuBar geometry and all tab behavior remain unchanged.

Implementation task:
[maestro-tab-iconbtn-controls-078](../plan/tasks/maestro-tab-iconbtn-controls-078.md).

[Review 1](../plan/reviews/maestro-tab-iconbtn-controls-078-1.md) passed with no findings.
