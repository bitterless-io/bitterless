---
id: onlypreview-global-search-workspace-037
scope: Global Search workspace, lazy result previews, and Project root row
status: implemented; owner verification pending
depends-on: [onlypreview-global-search-data-preview-036]
verify: node --test tests/onlypreview/onlyPreviewGlobalSearchShell.test.mjs tests/onlypreview/onlyPreviewGlobalSearchUi.test.mjs tests/onlypreview/onlyPreviewProjectRoot.test.mjs tests/onlypreview/onlyPreviewSearchShellUi.test.mjs tests/onlypreview/onlyPreviewSourceIntegration.test.mjs && yarn typecheck:node && yarn typecheck:web && yarn i18n:check && yarn build && git diff --check
---

# Build the Global Search workspace and Project root

## Objective

Remove the Project-sidebar search field, make `Shift+Cmd/Ctrl+F` open the right-side grouped Global
Search workspace, render Files/Contents with keyboard/pointer selection and lazy bounded bottom
previews, and present the workspace root as the Project tree's first interactive directory row.

## Context

- `docs/features/onlypreview.md`
- `docs/design/onlypreview-global-search.md`
- `docs/design/onlypreview-preview-merge-find.md`

## Path

- `src/main/onlypreview/`
- `src/main/windows/onlyPreviewWindow.helper.ts`
- `src/main/xpc/onlyPreview.handler.ts`
- `src/shared/onlypreview/onlyPreview.types.ts`
- `src/shared/onlypreview/onlyPreview.contract.ts`
- `src/renderer/onlypreview/common/onlyPreviewI18n.ts`
- `src/renderer/common/i18n/en.ts`
- `src/renderer/common/i18n/zh.ts`
- `src/renderer/onlypreview/shell/src/App.vue`
- `src/renderer/onlypreview/shell/src/App.less`
- `src/renderer/onlypreview/shell/src/components/GlobalSearch/`
- `src/renderer/onlypreview/shell/src/components/GlobalSearchPreview/`
- `src/renderer/onlypreview/shell/src/onlyPreviewGlobalSearch.store.ts`
- `src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts`
- `src/renderer/onlypreview/shell/src/onlyPreviewTree.service.ts`
- `tests/onlypreview/onlyPreviewGlobalSearchShell.test.mjs`
- `tests/onlypreview/onlyPreviewGlobalSearchUi.test.mjs`
- `tests/onlypreview/onlyPreviewProjectRoot.test.mjs`
- `tests/onlypreview/onlyPreviewSearchShellUi.test.mjs`
- `tests/onlypreview/onlyPreviewSourceIntegration.test.mjs`
- `docs/features/onlypreview.md`
- `docs/design/onlypreview-global-search.md`
- `docs/design/onlypreview-preview-merge-find.md`
- `docs/plan/README.md`
- `areas/agent-runtime/preview-roadmap/baseline.md`

## Contract

- Implement the exact wireframe, component states, responsive bounds, focus/keyboard table, stable
  captured scope, preview split, async component mapping, and security rendering boundary from the
  design doc.
- Remove the Project text field, ordinary local-filter state/restore/reveal behavior, and old
  ProjectSearchResults surface. `Cmd/Ctrl+F` remains current-file Find; only Shift+Cmd/Ctrl+F opens
  Global Search.
- Global Search lives in the right Shell work area. While active, report zero native Preview bounds;
  on close restore the live selected-file Preview bounds without reselect/reload.
- Add a synthetic root row for `workspace.rootName`/scope `''`, initially expanded, with correct
  ARIA/keyboard behavior and non-destructive directory context actions. Existing browse tokens and
  descendants remain unchanged.
- Files precedes Contents. Click/Enter selects and previews; double-click or Cmd/Ctrl+Enter opens/
  reveals and exits. Preview components load only for the current typed variant. Markdown and HTML
  use static allowlisted sanitization; no script/resource/navigation executes.
- Keep App/store/components below 800 lines through focused BEM-named components/services. Preserve
  existing Royal Blue tokens and native Preview/toolbar/status behavior outside Global Search.

## Verification

- Source/behavior tests cover input removal, shortcut split, root row, scope capture, result grouping,
  keyboard order, async preview mapping, stale fetch fences, zero/restore bounds, directory/info/
  text/Markdown/static-HTML/context states, sanitization, i18n, reduced motion, and 800px layout.
- Run listed focused tests, node/web typechecks, i18n, scoped lint/format if configured, debug build,
  and `git diff --check`.
- Do not run Electron/Playwright/E2E/real application. Ral owns the task's visual/keyboard/resource
  checklist.

## Owner Verification

- Verify the design doc's keyboard table in the real app, including IME, Esc twice, group collapse,
  preview resize, open/reveal, and current-directory → Project switching.
- Verify root row actions and selected-directory scope after interacting with a previous filename
  query/result; the search anchor must not drift.
- Verify plain/unknown text, Markdown, static HTML, directory, PDF/audio info, and content context at
  narrow and wide window sizes with no native Preview view covering the search workspace.

## Delivery

- Removed the Project text filter and old result surface. The rooted Project tree remains visible,
  and exact `Shift+Cmd/Ctrl+F` opens the right-workspace Global Search while plain `Cmd/Ctrl+F`
  remains current-file Find.
- Added the initially expanded synthetic workspace-root row and its separate root-only Main
  capability. Ordinary file references still reject an empty relative path, and the root menu has
  no Delete action.
- Added independently grouped Files/Contents results, keyboard and pointer selection, a persistent
  25–70% preview split, and six typed lazy preview components for plain text, Markdown/static HTML,
  directories, match context, and metadata-only files. Active HTML is reduced to a zero-attribute
  semantic allowlist.
- Global Search temporarily reports zero native Preview bounds and restores the live bounds without
  reloading the selected file. Find and Global Search are mutually exclusive, and close restores the
  exact live Shell/Vue/Chrome opener before documented fallbacks.
- [Independent review 1](../reviews/onlypreview-global-search-workspace-037-1.md) found one P1 focus
  trap, two P2 focus/state defects, and one P3 dead presentation surface. All were fixed with
  regressions. [Independent review 2](../reviews/onlypreview-global-search-workspace-037-2.md)
  records **PASS** with no remaining P0–P3 finding.
- Focused and adjacent task 037 tests pass 52/52 in independent review; final root regression passes
  46/46. `yarn typecheck:node`, Web SFC syntax/resolution checking, `yarn build`, and
  `git diff --check` pass. Full strict Web typecheck and renderer i18n remain blocked only by
  pre-existing non-OnlyPreview diagnostics. Electron/Playwright/E2E/real-app verification was not
  run; Ral owns the checklist above.
