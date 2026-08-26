---
id: onlypreview-global-search-data-preview-036
scope: Grouped Files/Contents search data and capability-bound result preview
status: implemented; owner verification pending
depends-on: [onlypreview-small-unknown-text-fallback-035]
verify: node --test tests/onlypreview/onlyPreviewGlobalSearchContract.test.mjs tests/onlypreview/onlyPreviewGlobalSearchEngine.test.mjs tests/onlypreview/onlyPreviewGlobalSearchPreview.test.mjs tests/onlypreview/onlyPreviewSearchUtilityRpc.test.mjs tests/onlypreview/onlyPreviewSearchWindowIntegration.test.mjs && yarn typecheck:node && yarn build && git diff --check
---

# Build grouped Global Search data and preview authority

## Objective

Replace the merged file-only Project Search result contract with independently capped Files and
Contents sections, include directories in Files, and add a latest-request capability-bound API for
bounded selected-result previews without filesystem I/O in Main or visible renderers.

## Context

- `docs/features/onlypreview.md`
- `docs/design/onlypreview-global-search.md`
- `docs/plan/analysis/onlypreview.md`

## Path

- `src/shared/onlypreview/onlyPreviewSearch.type.ts`
- `src/shared/onlypreview/onlyPreviewSearch.contract.ts`
- `src/shared/onlypreview/fileSearchRuntime.types.ts`
- `src/main/fileSearch/fileSearchRuntimeRelay.service.ts`
- `src/main/xpc/onlyPreviewSearchRuntime.handler.ts`
- `src/preload/fileSearch/fileSearch.preload.ts`
- `src/preload/fileSearch/fileSearchRuntime.ts`
- `src/preload/fileSearch/fileSearchCoordinator.ts`
- `src/preload/onlypreview/search/core/`
- `tests/onlypreview/onlyPreviewGlobalSearchContract.test.mjs`
- `tests/onlypreview/onlyPreviewGlobalSearchEngine.test.mjs`
- `tests/onlypreview/onlyPreviewGlobalSearchPreview.test.mjs`
- `tests/onlypreview/onlyPreviewSearchUtilityRpc.test.mjs`
- `tests/onlypreview/onlyPreviewSearchWindowIntegration.test.mjs`
- `docs/features/onlypreview.md`
- `docs/design/onlypreview-global-search.md`
- `docs/plan/analysis/onlypreview.md`
- `docs/plan/README.md`

## Contract

- Implement the exact grouped response and preview variants in the design doc. Files and Contents
  each cap at 250 with independent truncation; Files includes files/directories and never opens a
  body, Contents includes verified eligible text matches only.
- Preserve directory/project scope, first-build pending/completeness, latest-only cancellation,
  priority-lane early rows, candidate isolation, watch convergence, ordering, Unicode verification,
  and host/workspace/generation/request fencing.
- Retain only the latest request's at-most-500 opaque result tokens. Preview accepts an exact token,
  never an arbitrary path/offset, and revokes on every lifecycle named by the design.
- Text head preview is 256KiB maximum. Markdown and HTML are returned as text plus a typed adapter;
  sanitization/rendering remains renderer-owned in task 037. Non-text is metadata-only. Directory
  preview is one level, natural directory-first, maximum 200. Content context is bounded and
  reverified against the exact accepted result.
- Main only parses, validates, time-bounds, and relays. No absolute path, byte body, SQLite handle,
  or directory authority reaches a visible renderer outside the typed preview response.
- Keep touched production files below 800 lines by extracting focused services instead of growing
  the coordinator/engine/relay monoliths.

## Verification

- Cover strict shapes, independent cap/order/truncation, directory results, title/content separation,
  scope, early-priority replacement, cancellation, token lifecycle, forged/stale rejection,
  containment/depth/exclusion/symlink/no-I/O, file identity, 256KiB/200-entry bounds, and no Main I/O.
- Run listed focused tests, `yarn typecheck:node`, debug `yarn build`, `git diff --check`.
- No Electron/Playwright/E2E/real app; Ral owns runtime/resource acceptance.

## Owner Verification

- On a fresh large project, search a token shared by filenames and bodies; confirm both complete
  sections settle without duplicates or partial-candidate false negatives.
- Select text, Markdown, HTML, PDF/audio, directory, and content rows; confirm every returned preview
  is bounded and stale selections never replace the latest one.

## Delivery

- Hidden search returns independently capped Files/Contents groups (250 each), includes eligible
  directories in Files without body I/O, and keeps verified text-only Contents matches.
- One latest-request registry owns at most 500 opaque result tokens. Replacement, cancellation,
  initialize/refresh, promotion/failure, watch, and shutdown revoke them; Main only validates and
  relays strict bounded shapes.
- Token-only previews revalidate contained non-symlink file identity for every file-backed variant.
  Text heads cap at 256KiB, directory children at 200, Contents rereads at most the 1MiB indexed-text
  cap to confirm its accepted context, and non-text Info reads no body.
- The five focused suites pass 28/28, Node and strict Node TypeScript checks pass, `yarn build` and
  `git diff --check` pass. The build emitted only existing Vite dynamic/static import advisories.
- [Independent review 1](../reviews/onlypreview-global-search-data-preview-036-1.md) found three P1
  lifecycle/identity/cap defects and one P2 adapter drift; all were fixed with negative regressions.
  [Independent review 2](../reviews/onlypreview-global-search-data-preview-036-2.md) records **PASS**
  with no P0–P3 finding.
- Electron/Playwright/E2E/real-app/packaged smoke were not run; Ral owns the checks above.
