---
id: onlypreview-global-search-transparent-scrim-046
scope: Fully transparent Shell click shield while native Global Search is visible
status: implemented; owner verification pending
depends-on: [onlypreview-global-search-two-column-results-045]
verify: focused Global Search UI Node test, task-scoped formatting, yarn build, git diff --check; no Electron/Playwright/E2E
---

# Make the Global Search dismissal scrim fully transparent

## Objective

Keep the existing full-Shell click shield and click-to-close behavior while removing every visible
tint from the underlying OnlyPreview main window. Opening Global Search must not dim or otherwise
visually alter exposed Shell chrome.

## Context

- `docs/design/onlypreview-global-search.md`
- `docs/plan/tasks/onlypreview-global-search-dismiss-scrim-044.md`
- `docs/plan/tasks/onlypreview-global-search-two-column-results-045.md`

## Path

- `src/renderer/onlypreview/shell/src/App.less`
- `tests/onlypreview/onlyPreviewGlobalSearchUi.test.mjs`
- `docs/design/onlypreview-global-search.md`
- `docs/plan/README.md`

## Contract

- Keep the existing conditional full-Shell button, absolute positioning, full inset, z-index,
  non-focusable accessibility contract, `no-drag`, and `mode: 'opener'` dismissal path unchanged.
- Set the scrim background to exactly `transparent`. Do not use alpha colors, element opacity,
  pseudo-elements, gradients, shadows, blur/backdrop filters, animation, or transitions to create
  any visible treatment.
- The visually unchanged Shell remains pointer-blocked while Search is active. A click on exposed
  Shell chrome is consumed by the invisible shield, closes Search, and is not forwarded to the
  covered control.
- Native Search remains above the Shell shield and active Vue/Chrome Preview through the existing
  child-view ordering. Search content is not made transparent.
- Do not change visibility state, event revisions, focus restoration, Search rendering, result
  layout, Preview bounds, Main/XPC/preload/indexing behavior, or process/view counts.

## Layering

```text
Preview rectangle:  native Search → native Preview → invisible Shell click shield → Shell
Exposed Shell:      pointer click → invisible shield → close Search; no visual dimming
```

## Verification

- Source test proves the scrim keeps its full-window click-capture rules and uses exactly
  `background: transparent` with no alpha fill, opacity, filter, animation, or transition.
- Run the focused non-Electron Global Search UI test, task-scoped formatting, `yarn build`, and
  `git diff --check`. Do not run Electron, Playwright, E2E, packaged smoke, or the real app.

## Delivery

- The existing full-Shell dismissal button now uses exactly `background: transparent`; opening
  Global Search no longer changes the visible colors of Project, menu, toolbar, or status chrome.
- Positioning, pointer capture, native Search layering, accessibility label, visibility revisions,
  `mode: 'opener'` close behavior, and focus restoration remain unchanged.

## Verification Results

- Focused Global Search UI Node test: **PASS, 11/11**.
- Task-scoped ESLint and formatting comparison: **PASS**, no task-hunk finding.
- `yarn build`: **PASS**; validation-only package-name mutation restored afterward.
- `git diff --check`: **PASS**.
- [Independent review 1](../reviews/onlypreview-global-search-transparent-scrim-046-1.md):
  **PASS**, no P1, P2, or P3 finding.
- Electron, Playwright, E2E, packaged smoke, and the real application were not run, as required.

## Owner Verification

- Open Global Search above Vue and PDF/HTML Preview. Confirm the exposed Project/menu/toolbar/status
  regions keep their normal colors, yet clicking any of them closes Search without triggering the
  covered action.
