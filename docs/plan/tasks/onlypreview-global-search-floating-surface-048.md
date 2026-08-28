---
id: onlypreview-global-search-floating-surface-048
scope: Transparent native Global Search canvas with one inset rounded floating workspace
status: implemented; owner verification pending
depends-on: [onlypreview-global-search-query-scope-fencing-047]
verify: focused non-Electron Global Search UI/store tests, relevant typecheck/lint/format, yarn build, git diff --check; no Electron/Playwright/E2E
---

# Float Global Search above the main window

## Objective

Turn the native Global Search child view into a transparent overlay whose HTML body leaves exactly
24px on every side, while the complete search workspace remains one opaque rounded surface with a
restrained shadow above the still-loaded Vue/Chrome Preview.

## Context

- `docs/design/onlypreview-global-search.md`
- `docs/plan/tasks/onlypreview-global-search-transparent-scrim-046.md`
- `docs/plan/tasks/onlypreview-global-search-query-scope-fencing-047.md`

## Path

- `src/main/windows/onlyPreviewWindow.helper.ts`
- `src/renderer/onlypreview/globalSearch/src/App.less`
- `src/renderer/onlypreview/globalSearch/src/App.vue`
- `src/renderer/onlypreview/shell/src/components/GlobalSearch/GlobalSearchWorkspace.less`
- `src/renderer/onlypreview/shell/src/onlyPreviewGlobalSearch.store.ts`
- `tests/onlypreview/onlyPreviewGlobalSearchUi.test.mjs`
- `tests/onlypreview/onlyPreviewGlobalSearchShell.test.mjs`
- `docs/design/onlypreview-global-search.md`
- `docs/INDEX.md`
- `docs/plan/README.md`

## Contract

- Keep the Search `WebContentsView` at the existing Preview bounds and z-order, but set only that
  native view background to fully transparent. Shell and Vue/Chrome Preview backgrounds and bounds
  remain unchanged.
- Make `html`, `body`, and `#app` transparent. Put exactly `24px` padding on `body`, not on an inner
  results/header component, so the complete workspace is uniformly inset on all four sides.
- The `.onlypreview-global-search` root fills the body's remaining content box, keeps the existing
  Canvas/Surface/Royal/Ink palette, clips its header/results/split/Preview to one `14px` outer
  radius, and adds one restrained two-layer Ink shadow. Do not add blur/backdrop-filter, gradient,
  animation, another component library, renderer, native view, or process.
- This outer workspace shadow is the only rule that supersedes task 045's historical “no new
  shadow” constraint. Result rows, result columns, Preview internals, and the Shell dismissal
  shield remain shadow-free.
- A click whose target is the transparent body gutter invokes the existing `mode: 'opener'` close
  path and is consumed. A click anywhere inside the rounded workspace keeps existing interaction
  behavior and must not dismiss Search.
- Keep query/scope behavior, two-column results, result/Preview sizing, keyboard navigation,
  visibility revision fencing, Shell click shield, focus restoration, and warm renderer lifecycle
  unchanged.

## Layout

```text
transparent native Search view (existing Preview bounds)
┌────────────────────────────────────────────────────────┐
│ 24px transparent body gutter                           │
│   ╭──────────── opaque search workspace ─────────────╮  │
│   │ Header                                           │  │
│   ├──────────────────────┬───────────────────────────┤  │
│   │ Contents             │ Files                     │  │
│   ├──────────────────────┴───────────────────────────┤  │
│   │ Preview                                          │  │
│   ╰────────── 14px radius + Ink shadow ─────────────╯  │
└────────────────────────────────────────────────────────┘
```

## Verification

- Source/UI tests prove the Search-only native transparent background, transparent HTML canvas,
  exact body-level 24px padding, 14px clipped workspace radius, and non-filter two-layer shadow.
- Interaction tests prove only a body-gutter click takes the opener-dismiss path; workspace clicks
  do not.
- Run focused non-Electron tests, relevant Renderer/Node typecheck, task-scoped lint/format,
  `yarn build`, and `git diff --check`. Do not run Electron, Playwright, E2E, packaged smoke, or the
  real application.

## Delivery

- Only the native Global Search `WebContentsView` now uses a fully transparent background. Its
  renderer makes `html`, `body`, and `#app` transparent, with exact body-level `24px` padding and a
  shadow-permitting app root.
- The complete Global Search workspace is one opaque `14px` rounded surface. It clips all internal
  regions and paints a bounded two-layer Ink shadow into the transparent gutter without changing
  the Shell scrim, Preview bounds, child-view ordering, renderer count, or search behavior.
- A renderer-lifecycle body listener consumes clicks only when the exact target is the transparent
  gutter and reuses the existing opener-dismiss path. Workspace clicks remain interactive, and
  empty-query Escape now reuses that same dismissal method.

## Verification Results

- Focused Global Search UI/store tests: **PASS, 26/26**.
- `yarn typecheck:node`: **PASS**.
- `yarn vue-tsc --noEmit --noCheck -p tsconfig.web.json --composite false`: **PASS**.
- Renderer production ESLint, focused test ESLint with inherited test-file rule debt excluded,
  task-scoped production/task-doc Prettier, and `git diff --check`: **PASS**.
- `yarn build`: **PASS**; the validation-only package-name mutation was restored afterward.
- [Independent review 1](../reviews/onlypreview-global-search-floating-surface-048-1.md): **PASS**
  with one P3 non-blocking test-file-size finding recorded in the delivery backlog.
- Electron, Playwright, E2E, packaged smoke, and the real application were not run, as required.

## Owner Verification

- Open Global Search over both Vue Preview and PDF/HTML Preview. Confirm the complete Search
  workspace floats 24px inside the Preview rectangle with visible rounded corners and a restrained
  shadow, while the underlying main window remains visible through the gutter.
- Click the transparent gutter and confirm Search closes and restores its opener. Reopen Search and
  confirm clicks inside the query, results, splitter, and Preview do not dismiss it.
