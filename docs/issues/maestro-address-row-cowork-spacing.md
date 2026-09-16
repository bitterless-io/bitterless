# Maestro address row spacing and icons match Cowork

Status: implemented; code-verified, owner visual testing pending

## Request and evidence

Ral (2026-09-15): BL's URL row has noticeably different horizontal spacing and icon sizes;
use Cowork as the reference.

Cowork's `src/renderer/common/style.css` sets the root font to 13px. Its Tailwind spacing unit
is `0.25rem`, so `h-8/w-8` is 26px, `gap-2` is 6.5px, and `px-3` is 9.75px. The earlier
page-type comparison incorrectly assumed a 16px root font and called both buttons 32px.
Cowork's unlayered Arco button font reset also takes precedence over the layered `text-[16px]`
utility: its navigation icons inherit 13px. Tabler icons use explicit SVG dimensions.

BL currently uses fixed 32px action buttons, 24px grouped navigation buttons, an 8px row gap,
12px row padding, and a 4px actions gap. Its bare buttons also retain browser default padding,
which can shrink flex-child SVGs. The shared Arco IconBtn has a separate fixed 32px flex basis.

Evidence: the two projects' `MenuBar.vue`, BL `MenuBar.less` and shared `IconBtn.less`, Cowork's
`common/style.css`, Tailwind preflight, and the Arco global button reset. Confirm these derived
values in an isolated static Chromium rendering before declaring completion.

## Required behavior

Use these Cowork computed dimensions for BL's corresponding controls (CSS px):

| Element | Target |
| --- | --- |
| Address row horizontal padding / gap | 9.75 / 6.5 |
| Navigation group padding / gap | 1.625 / 1.625 |
| Navigation group total box | 84.5 × 29.25 |
| Navigation, page type, history, snapshot, sidebar, settings buttons | 26 × 26; zero button padding |
| Back / forward / refresh SVG | 13 × 13 |
| Page-type SVG | 24 × 24, stroke 2 |
| History / snapshot / sidebar / settings SVG | 18 × 18; preserve existing strokes |
| URL input height / horizontal padding | 26 / 8.125 |
| Trailing actions gap | 3.25 |
| Existing trailing separator | 1 × 16.25 |
| Update button height / horizontal padding | 22.75 / 11.375 |

Keep the existing 36px tab strip, 42px outer address row, and 78px native-view offset. Only
the address row's internal geometry changes. Keep current control visibility, labels, colors,
focus, history, keyboard and click behavior. Scope IconBtn overrides to this row's history
button; do not change the shared component or Cowork. Add no borders or new controls.

This supersedes the 28px input/group and 24px navigation-button portion of
[the earlier compact-row decision](maestro-address-row-too-tall.md), while retaining its outer
chrome height. It also corrects the container-size claim in
[page-type switcher §7](../features/maestro-page-type-switcher.md#7-按钮尺寸对齐-cowork2026-09-15).

## Verification and owner check

- Compile the Vue script/template and Less, and update/run the existing chrome geometry check.
- Render isolated fixtures from the actual address-row templates, components and styles with
  headless Chromium; compare computed gaps, buttons, input and SVG rectangles at multiple widths,
  including snapshot/update states. Do not boot either Electron app or run app E2E.
- Ral reloads BL and compares its URL row with Cowork at the same zoom: left navigation/page type,
  URL padding, history and trailing action spacing; then checks history opens and a single click
  navigates normally.

## Results

Only `MenuBar.less` and the existing `maestroAddressRowGeometry.test.mjs` changed in code.
No Vue event handler, shared IconBtn, Cowork file, or native-view offset changed.

- Existing chrome geometry tests: **3/3 passed**. Vue script/template and Less compilation passed;
  scoped `git diff --check` passed.
- Freshly compiled source styles and actual Vue address-row templates/components were rendered
  in a disposable, headless Chrome context with external requests blocked. At both 800px and
  1280px widths, ordinary and snapshot/update-visible states matched Cowork for corresponding
  button/SVG rectangles, input boxes, navigation group and horizontal gaps (tolerance 0.02 CSS px).
- The baseline confirmed BL's default padding squeezed navigation SVGs to **12 × 16** and the
  page-type SVG to **20 × 24**. After correction they measure **13 × 13** and **24 × 24**,
  respectively, matching Cowork. All common icon buttons measure **26 × 26**.
- The outer address row still measures **42px**. No Electron app, E2E suite, or packaged smoke
  test was launched. Full build/typecheck was not repeated for this local style change.

Reproducible temporary fixture and captured measurements:
`overmind/tmp/address-row-spacing/measure.cjs --assert`, `measurements.json`, `before.png`,
`cw.png`, and `after.png`. This checks static layout, not native-window interaction or app startup.
