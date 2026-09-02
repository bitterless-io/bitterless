---
id: onlypreview-retire-main-index-083
scope: Remove the dead OnlyPreview Main traversal and prevent it from returning
status: implemented
depends-on: [onlypreview-ooxml-viewer-runtime-repair-081]
verify: focused source/runtime tests, targeted typecheck/lint/build; no Electron/Playwright/E2E
---

# Retire the legacy Main-owned OnlyPreview index

## Objective

Delete the production-unwired `OnlyPreviewIndexService`, retire only its obsolete Main-traversal
tests, and add a source boundary guard that prevents a Main-owned OnlyPreview browse/index service
or filesystem import from being reintroduced.

## Context

- [`onlypreview-main-filesystem-io.md`](../../issues/onlypreview-main-filesystem-io.md)
- [`onlypreview-main-filesystem-preload-migration.md`](../analysis/onlypreview-main-filesystem-preload-migration.md)
- [`onlypreview.md`](../../features/onlypreview.md)

## Path

- `src/main/onlypreview/onlyPreviewIndex.service.ts` (delete)
- `tests/onlypreview/runtime.entry.ts`
- `tests/onlypreview/onlyPreviewWorkspaceCore.test.mjs`
- `tests/onlypreview/onlyPreviewAppWiring.test.mjs`
- `tests/onlypreview/onlyPreviewBrowseIndex.test.mjs`
- `tests/onlypreview/onlyPreviewSearchUtilityRpc.test.mjs`
- `tests/onlypreview/onlyPreviewMainFilesystemBoundary.test.mjs`
- `docs/{INDEX.md,issues,plan}/**`

## Contract

- Remove the dead Main `lstat`/`realpath`/`readdir` traversal implementation and its test-runtime
  export; production browse/index/search/watch remains exclusively in the hidden `fileSearch`
  preload.
- Remove only test cases whose subject is the deleted historical service. Preserve workspace,
  host, Preview guard and current preload-owned search coverage.
- Add a focused source guard proving the deleted module is absent and no production Main handler/
  service imports or instantiates `OnlyPreviewIndexService` or `onlyPreviewIndexService`.
- The guard must not claim the broader Main-fs migration is complete; Tasks 084–087 own the still
  reachable workspace/preview/auxiliary paths.
- Preserve all unrelated current-worktree changes.

## Verification

- Run the focused boundary, app-wiring and remaining workspace-core tests.
- Run targeted lint/typecheck, production build and task-scoped `git diff --check`.
- Obtain an independent review. Do not run Electron, Playwright/E2E, packaged smoke or launch the
  application.

## Delivery

- Deleted the production-unwired `OnlyPreviewIndexService` and removed its test-runtime export and
  only the historical Main-index test cases. Current preload-owned browse/search and workspace,
  classifier and asset coverage remain.
- Added a source boundary test that scans every production `src/main/onlypreview/**/*.ts` module and
  `onlyPreview.handler.ts`, keeps the retired file absent and forbids the old service from being
  referenced or reinstantiated without claiming the broader Tasks 084–087 migration is complete.
- Updated stale preload test fixtures to supply independent Search and Office capabilities and to
  verify both immediate and DOMContentLoaded-deferred handler registration.
- [Review 1](../reviews/onlypreview-retire-main-index-083-1.md) passed with no P1/P2/P3 findings.
  The combined focused suite passed 35/35, targeted ESLint passed with zero errors, Node typecheck
  passed, the production build passed, and task-scoped `git diff --check` passed.
- Electron, Playwright/E2E, packaged smoke and application launch were not run.
