# Zellij text selection is indistinguishable from the terminal background

Status: implemented; source and isolated renderer verified; owner package testing pending.
Owner request: 2026-09-16; also provide a rendered image.

## Evidence

Both clients use a dark terminal background `#1a1b26` and a legacy session theme with the same
`bg 26 27 38`. Zellij 0.45.1 converts that legacy palette into `text_selected.background` using
the palette's bg; its native grid uses that style to draw mouse selections. The selected region
therefore has exactly the same background as the surrounding terminal.

The separate web-client theme also omits the supported `selection_background`,
`selection_foreground` and `selection_inactive_background` keys, leaving browser/Shift selections
to defaults. Native selection and xterm selection must both be considered.

## Design and behavior

Keep the existing terminal layout, monospace type, ANSI palette and dark background. Change the
selection colors only: active background `#7aa2f7`, selected text `#15161e`, inactive browser
selection background `#6686c2`. Active/inactive backgrounds contrast with the terminal by 6.79:1
and 4.68:1; selected text contrasts with those backgrounds by 7.16:1 and 4.94:1.

```text
Dark terminal, existing prompt and ANSI colors
  ordinary text   [ blue selected text with dark foreground ]   ordinary text
Focus leaves terminal: retain a visible, muted-blue browser selection
```

- Convert the application session theme to Zellij's semantic style format, retaining every
  legacy-derived style value except `text_selected.base` / `text_selected.background`.
  A partial semantic block alongside legacy keys is unsafe: the parser switches the entire
  theme mode. Merely changing legacy `bg` would also recolor table/list selections while leaving
  selected text too light. Configure the three browser selection keys explicitly as well.
  Preserve native copy/selection interactions and all unselected content/ANSI colors.
- Cover fresh installs and application-managed configuration upgrades through the existing
  validated, backed-up configuration flow; do not mutate real user configurations for testing.
  Bump the dedicated template version for the native theme migration; preserve explicit custom
  values within the same template version. Native config watching can publish the updated theme
  to attached clients without killing sessions; do not claim an installed update was tested.
- Keep Bitterless and Cowork behavior equivalent. Do not kill live sessions or alter user text.
- Produce an actual renderer before/after image from isolated fixture data, with its provenance
  stated accurately. Do not present a hand-drawn mock as an installed-client screenshot.

## Verification

Validate the generated KDL with the bundled Zellij 0.45.1 and verify the resolved native theme,
browser palette, color contrast, upgrade/default completion behavior, and BL/Cowork parity.
Use isolated native/web fixtures and headless browser rendering. No Electron E2E or installed
client launch. Preserve the earlier login-PATH repair and unrelated package metadata edits.

Delivery: [task](../plan/tasks/zellij-selection-contrast-001.md).

## Verification result

- Template `260916230933` contains the complete semantic native theme and three browser
  selection keys. The two clients differ only in product names.
- Focused configuration tests: 23/23, including bundled Zellij 0.45.1 parsing, exact preservation
  of other styles/ANSI colors, contrast thresholds, upgrade backups and same-version custom colors.
  Scoped strict TypeScript and ESLint pass. Full Zellij suite: 195/195.
- Actual ordinary mouse drag in an isolated native session rendered the old background at
  `#1a1b26` and the new background at `#7aa2f7`, with `#15161e` glyphs. Pixel measurements:
  region contrast 1.00 -> 6.79; selected text 7.16. Browser selection rendered the same active
  colors and the configured inactive color (region 4.68, text 4.94). No page errors.
- The delivery image `before-after.png` combines unmodified real-renderer screenshots with
  Chinese labels. Rendering used fixture text, production native/web-bridge services and
  headless Chrome; only fixture shell/layout and a 20px viewing font differed. All isolated
  sessions and processes were cleaned up. No installed client or Electron E2E was launched.
- No new application build/package was produced for this palette change; the earlier login-PATH
  builds predate it. Repackage/update and confirm the final installed appearance manually.
