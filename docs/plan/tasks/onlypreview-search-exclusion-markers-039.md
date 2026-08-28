---
id: onlypreview-search-exclusion-markers-039
scope: Project tree Search-exclusion markers
status: implemented; owner verification pending
depends-on: [onlypreview-directory-selection-search-scope-038]
verify: node --test tests/onlypreview/onlyPreviewBrowseIndex.test.mjs tests/onlypreview/onlyPreviewSearchEngine.boundary.test.mjs tests/onlypreview/onlyPreviewSearchShell.test.mjs tests/onlypreview/onlyPreviewSourceIntegration.test.mjs tests/onlypreview/onlyPreviewAppWiring.test.mjs && yarn typecheck:node && yarn typecheck:web && yarn build && git diff --check
---

# Mark Search-excluded Project tree paths

## Objective

Make Search-excluded files, directories, and excluded descendants immediately recognizable in the
complete Project tree without changing browse coverage or search eligibility.

## Context

- `docs/features/onlypreview.md`
- `docs/design/onlypreview-global-search.md`
- `docs/design/colors.md`
- `docs/issues/onlypreview-search-exclusion-tree-markers.md`

## Path

- `src/shared/onlypreview/onlyPreviewSearch.type.ts`
- `src/preload/onlypreview/search/core/browse-index.mjs`
- `src/preload/onlypreview/search/core/search-engine.mjs`
- `src/main/fileSearch/fileSearchRuntimeRelay.service.ts`
- `src/renderer/onlypreview/shell/src/onlyPreviewBrowseListing.service.ts`
- `src/renderer/onlypreview/shell/src/onlyPreviewBrowseProjection.service.ts`
- `src/renderer/onlypreview/shell/src/onlyPreviewTree.service.ts`
- `src/renderer/onlypreview/shell/src/onlyPreviewShell.type.ts`
- `src/renderer/onlypreview/shell/src/App.vue`
- `src/renderer/onlypreview/shell/src/App.less`
- `tests/onlypreview/onlyPreviewBrowseIndex.test.mjs`
- `tests/onlypreview/onlyPreviewSearchEngine.boundary.test.mjs`
- `tests/onlypreview/onlyPreviewSearchShell.test.mjs`
- `tests/onlypreview/onlyPreviewSourceIntegration.test.mjs`
- `tests/onlypreview/onlyPreviewAppWiring.test.mjs`
- `docs/features/onlypreview.md`
- `docs/design/onlypreview-global-search.md`
- `docs/issues/onlypreview-search-exclusion-tree-markers.md`
- `docs/INDEX.md`
- `docs/plan/README.md`

## Contract

- Add an exact `searchExcluded` boolean to BrowseIndex entries only. Directory-preview and Global
  Search index records keep their existing contracts.
- Compute the flag from the active traversal policy during listing creation. Carry one
  ancestor-blocked boolean with each opaque directory token so a physically pruned directory's
  loaded descendants inherit exclusion even when the rule matched only the directory itself.
  Do not propagate through an excluded directory that remains traversable for a later ordered `!`
  re-inclusion; the re-included descendant must return to normal.
- Do not add filesystem calls, SQLite queries, recursive Renderer checks, or per-render path scans.
- Render excluded rows with pale orange in default, hover, and selected states. Use the canonical
  Bitterless accent orange `#C2410C` only for excluded directory icons. Keep the synthetic root and
  symlink treatments unchanged.
- Preserve browse completeness, opaque directory capabilities, watch refresh, selection, focus,
  expansion, context menus, Global Search eligibility, and result ordering.

## Verification

- Browse-index tests cover fixed, hidden, configured `/**`, exact configured-directory, inherited,
  and explicitly re-included paths.
- Boundary tests prove emitted and watch-refreshed listings carry the validated marker.
- Renderer/source tests cover row class binding, folder-icon class binding, root neutrality, and the
  three pale-orange interaction states.
- Run the listed focused tests, applicable typechecks, build, and `git diff --check`.
- Do not run Electron, Playwright, E2E, or the real application. Ral owns live visual verification.

## Owner Verification

- Expand `.git`, `node_modules`, another fixed output directory, and a configured excluded
  directory. Confirm every excluded loaded descendant keeps the pale-orange row background.
- Confirm excluded open/closed folder icons are solid orange, while excluded file icons stay normal.
- Select and hover excluded rows; confirm their status remains visible and selection remains clear.
- Confirm a path restored by an ordered `!` rule returns to normal Project colors and remains
  searchable.

## Delivery

- The hidden BrowseIndex now emits one strictly validated `searchExcluded` bit per visible browse
  entry. Its opaque directory capability carries one bounded `ancestorBlocked` bit so exact
  directory exclusions remain marked through arbitrarily deep demand-loaded descendants.
- An excluded directory that must stay traversable for a later ordered `!` rule does not propagate
  the ancestor bit, allowing the explicitly re-included subtree to return to normal.
- Main and Renderer boundaries validate the browse-only marker. Renderer projection builds one
  excluded-path `Set` in its existing listing pass, and tree-row rendering uses `Set.has()` without
  extra filesystem I/O, SQLite work, recursive checks, or per-render path scans.
- Project rows use pale-orange base, hover, and selected states. Excluded open and closed folder
  icons use the canonical Bitterless accent orange `#C2410C`; file icons, symlinks, the synthetic
  root, and the existing Royal Blue selection rail retain their established treatments.
- Refresh rollback restores the previous policy and republishes a fresh root capability, preventing
  candidate-policy markers from leaking after a failed refresh.
- [Independent review 1](../reviews/onlypreview-search-exclusion-markers-039-1.md) correctly blocked
  the first implementation on exact-directory descendant inheritance. The fix passed
  [independent review 2](../reviews/onlypreview-search-exclusion-markers-039-2.md) with no remaining
  P1, P2, or P3 findings.
- Verification passed: focused evidence **40/40**, file-search relay evidence **13/13**,
  `yarn typecheck:node`, OnlyPreview-directed `vue-tsc`, `yarn build`, and `git diff --check`.
  Repository-wide `yarn typecheck:web` still reports pre-existing errors in Poker, Connector, old
  Home, Maestro, Omni, and `pathHelper`; none are in this task's OnlyPreview files. Electron,
  Playwright, E2E, and the real app were intentionally not run; Ral owns live visual verification.
