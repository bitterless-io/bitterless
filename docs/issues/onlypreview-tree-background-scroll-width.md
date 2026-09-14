# Project tree backgrounds stop at the viewport width

Status: Implemented; code verification complete; owner visual testing pending — 2026-09-14.

## Defect and expected behavior

The screenshot shows hover and selected backgrounds ending before overflowing filenames.
Scrolling Project horizontally exposes content without the row background. This violates
[the existing full-row contract](../features/onlypreview-search-shadow-and-row-width.md).

```text
Project viewport       horizontally scrollable content
| selected row background continues to the widest row edge |
| short filename                                         |
| deeply/nested/long-filename.html                        |
```

Every visible file/folder row must share the widest content width, with a minimum of the
viewport content width. Hover, selection and search-excluded backgrounds cover that width;
22px row heights and compact vertical spacing remain unchanged.

## Root cause and repair

- Both copies of `src/renderer/onlypreview/shell/src/App.less` currently specify
  `grid-template-columns: minmax(100%, max-content)` on the scroll container.
- The 2026-09-11 change removed per-row sizing, but its checks only assert CSS declarations.
  They do not measure whether the grid track grows to fit overflowing filenames.
- The old grid track stays at the viewport content width. `max-content` as the upper bound does
  not force the track to accommodate the overflowing, non-wrapping row labels.
- Replace the track definition with `minmax(max-content, 1fr)`: content determines the minimum,
  while `1fr` fills the viewport when all names are short. Mirror the stylesheet to COWORK.

An isolated headless Chromium fixture using the compiled shell stylesheet reproduced the defect:

| Panel | Old row width | New row width, mixed long/deep names |
| --- | --- | --- |
| 220px | 210px | 707.06px |
| 520px | 510px | 707.06px |

In the 220px case, old `scrollWidth` was 705px while the deepest name exceeded its row background
by 490.06px. The repaired row encloses the complete name with 7px trailing padding; `scrollWidth`
is 717px including container padding. Short-only rows remain 210px/510px with no horizontal
overflow. All row right edges align at both scroll endpoints; heights remain 22px with zero gaps.
These measurements validate the CSS fixture, not the installed Electron apps.

## Verification and human acceptance

- BL compiled stylesheet: 16 layout snapshots (8 old, 8 fixed) covering mixed short/long/deep names,
  220px/520px panels and both horizontal scroll endpoints. Fixed-state geometry assertions passed.
- COWORK stylesheet is byte-identical; its own Less/source checks passed 13/13:
  `node --test tests/unit/onlyPreviewGlobalSearchShadow.test.mjs tests/unit/onlyPreviewTreeDensity.test.mjs`
  from `apps/cowork`.
- BL: `node --test tests/onlypreview/onlyPreviewGlobalSearchShadow.test.mjs tests/onlypreview/onlyPreviewAdapterSource.test.mjs tests/onlypreview/onlyPreviewTreeDensity.test.mjs tests/onlypreview/onlyPreviewSearchShellUi.test.mjs`
  passed 21/22. The sole pre-existing failure requires `App.vue` to be under 800 lines; HEAD has
  882 lines and the current shared worktree has 879. This repair did not edit that file.
- Changed code passes `git diff --check`. No full build, packaging or Electron E2E was run;
  the bounded CSS change was verified through Less compilation and isolated layout measurements.

Ral should verify the rebuilt BL and COWORK apps by
selecting a short row in a directory containing long names, scrolling fully right, and checking
selected, hovered and search-excluded backgrounds reach the common row edge.
