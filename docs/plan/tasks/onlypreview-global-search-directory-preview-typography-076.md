---
id: onlypreview-global-search-directory-preview-typography-076
scope: Increase Global Search bottom directory Preview row typography by one pixel and use semibold weight
status: implemented; owner verification pending
depends-on:
  - onlypreview-global-search-file-content-preview-073
verify: focused non-Electron Global Search UI source test, directed Renderer typecheck, focused lint/format, git diff --check; no Electron/Playwright/E2E
---

# Global Search directory Preview typography

## Objective

Make direct-child names in the bottom directory Preview easier to scan by changing the inherited
12px regular text to 13px semibold text. Do not change the Project tree, result lists, icons, row
height, spacing, directory data, or interactions.

## Context

- [OnlyPreview Global Search and result preview](../../design/onlypreview-global-search.md)
- [OnlyPreview feature contract](../../features/onlypreview.md)
- [Task 073](onlypreview-global-search-file-content-preview-073.md)

## Path

- `src/renderer/onlypreview/shell/src/components/GlobalSearchPreview/GlobalSearchPreview.less`
- `tests/onlypreview/onlyPreviewGlobalSearchUi.test.mjs`
- canonical docs listed above plus `docs/plan/README.md`

## Contract

```text
┌─ Directory Preview ───────────────────────────────┐
│ [folder] direct-child directory   13px / 600      │
│ [file]   direct-child file        13px / 600      │
└───────────────────────────────────────────────────┘
```

- Apply `font-size: 13px` and `font-weight: 600` to each
  `.onlypreview-search-preview__directory-entry`.
- Keep the current 28px row height, 14px icons, padding, divider, ordering, truncation, and
  directory-only scope unchanged.

## Verification

- A focused source test asserts the exact 13px/600 typography on directory Preview entries.
- Run the focused non-Electron UI test, directed Renderer typecheck, focused lint/format, and
  task-path `git diff --check`.
- Do not run Electron, Playwright, packaged smoke, or E2E. Owner performs the live visual check.

## Delivery

- Bottom directory Preview entries now use `font-size: 13px` and `font-weight: 600`.
- The 28px row height, 14px icons, padding, dividers, ordering, data, and interactions are
  unchanged. The dedicated selector does not affect the Project tree or Files/Contents result rows.

## Verification Results

- [Independent review 1](../reviews/onlypreview-global-search-directory-preview-typography-076-1.md):
  **PASS**, no blocking or P1–P3 finding.
- Focused Global Search UI test: **13/13 PASS**.
- Directed Renderer typecheck, focused lint/format, Less compilation, and task-path
  `git diff --check`: **PASS**.
- Electron, Playwright, packaged smoke, and E2E were not run, as required.

## Owner Verification

- Select a directory search result and confirm folder/file child names in the bottom Preview are
  one pixel larger and semibold while row height and icons remain unchanged.
