---
id: onlypreview-project-search-shortcut-030
scope: Project Search Option/Alt shortcut alias across Shell and Preview WebContents
status: implemented; owner verification pending
depends-on: [onlypreview-search-scope-watch-013, onlypreview-find-in-file-019]
verify: node --test tests/onlypreview/onlyPreviewFindRenderer.test.mjs tests/onlypreview/onlyPreviewSearchShellUi.test.mjs && yarn typecheck:node && yarn check:renderer-i18n && yarn build
---

# Project Search Option/Alt shortcut

## Objective

Add `Option+Cmd+F` on macOS, with `Alt+Ctrl+F` as the cross-platform equivalent, as a second
shortcut for entering the existing Project Search and focusing its input. Keep
`Shift+Cmd/Ctrl+F` as an accepted alias and keep plain `Cmd/Ctrl+F` exclusively assigned to the
current-file Find Bar.

## Context

- [`../../features/onlypreview.md`](../../features/onlypreview.md) — current Project Search and
  interaction contract.
- [`../../design/onlypreview-preview-merge-find.md`](../../design/onlypreview-preview-merge-find.md) —
  Main-owned shortcut routing across Shell, Vue Preview, and Chrome Preview.
- [`onlypreview-search-scope-watch-013`](onlypreview-search-scope-watch-013.md) — scoped Project
  Search behavior.
- [`onlypreview-find-in-file-019`](onlypreview-find-in-file-019.md) — current-file Find Bar ownership
  and separation from Project Search.

## Path

- `src/main/windows/onlyPreviewWindow.helper.ts`
- `tests/onlypreview/onlyPreviewFindRenderer.test.mjs`
- `tests/onlypreview/onlyPreviewSearchShellUi.test.mjs`
- `docs/features/onlypreview.md`
- `docs/design/onlypreview-preview-merge-find.md`
- `docs/plan/analysis/onlypreview.md`
- `docs/plan/README.md`
- `docs/plan/tasks/onlypreview-project-search-shortcut-030.md`
- `docs/plan/reviews/onlypreview-project-search-shortcut-030-1.md`

## Contract

1. Main's existing `before-input-event` route accepts Project Search only for a non-repeating
   `keyDown` of `F`, the platform primary modifier (`Cmd` on macOS, `Ctrl` elsewhere), no opposite
   primary modifier, and exactly one secondary modifier: either Shift or Option/Alt.
2. `Option+Cmd+F` / `Alt+Ctrl+F` and the retained `Shift+Cmd/Ctrl+F` both focus the Shell
   WebContents, publish the existing host-scoped focus-search event, enter Project Search with its
   captured current-directory scope, and focus the existing search input.
3. Plain `Cmd/Ctrl+F` remains the current-file Find Bar shortcut. Shift+Option/Alt plus the primary
   modifier, auto-repeat, key-up, wrong keys, missing primary modifier, and mixed Cmd+Ctrl chords
   remain unmatched and do not call `preventDefault()`.
4. The alias works identically when focus starts in Shell, Vue Preview, or raw Chromium because it
   reuses the existing Main-owned shortcut binding. No renderer API, new event, new input, or visual
   state is added.

## Verification

1. Shortcut contract tests pin the exclusive Shift-or-Option/Alt predicate, retained Shift alias,
   new Option/Alt alias, plain current-file find separation, and rejection of the combined
   Shift+Option/Alt chord.
2. Source integration tests preserve the existing `focus-search` event route and Shell input focus
   behavior without a second renderer implementation.
3. Run the focused Node tests, `yarn typecheck:node`, renderer i18n validation, focused error-level
   ESLint, `git diff --check`, and `yarn build`.
4. Electron/Playwright E2E is not run. Ral owns live verification from the Shell, Vue Preview, and
   HTML/PDF Chrome Preview surfaces.

## Verification Evidence

- Focused shortcut and Shell UI tests: **PASS — 14/14**.
- `node --test tests/onlypreview/*.test.mjs`: **PASS — 337/337**.
- `yarn typecheck:node`, renderer i18n, scoped error-level ESLint, `git diff --check`, and
  `yarn build`: **PASS**.
- [Independent review 1](../reviews/onlypreview-project-search-shortcut-030-1.md) recorded **PASS**
  with no P0-P2 finding and confirmed the tests execute the production predicate source.
- Electron/Playwright E2E and the real app were intentionally not run.

## Owner Verification

- From Shell, Vue Preview, and HTML/PDF Chrome Preview, verify `Option+Cmd+F` opens and focuses the
  existing Project Search input. On Windows/Linux, verify `Alt+Ctrl+F`.
- Confirm `Shift+Cmd/Ctrl+F` still opens Project Search, plain `Cmd/Ctrl+F` still opens current-file
  Find, and Shift+Option/Alt plus the primary modifier remains unclaimed.
