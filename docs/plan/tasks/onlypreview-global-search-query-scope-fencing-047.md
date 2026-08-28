---
id: onlypreview-global-search-query-scope-fencing-047
scope: Exact Global Search query identity and immediate Contents scope reruns
status: implemented; owner verification pending
depends-on: [onlypreview-global-search-transparent-scrim-046]
verify: focused non-Electron search engine and Global Search store tests, relevant typecheck/lint/format, yarn build, git diff --check; no Electron/Playwright/E2E
---

# Fence Global Search rows by exact query and scope

## Objective

Prevent accepted results from an unfinished query such as `ag` from remaining visible after the
input becomes `agent-runtime`, and make every Current directory / Project scope switch immediately
rerun the current non-empty query.

## Context

- `docs/design/onlypreview-global-search.md`
- `docs/issues/onlypreview-global-search-concurrency-and-directory-ux.md`
- `docs/plan/tasks/onlypreview-global-search-two-column-results-045.md`

## Path

- `src/renderer/onlypreview/shell/src/onlyPreviewGlobalSearch.store.ts`
- `src/preload/onlypreview/search/core/normalization.mjs`
- `src/preload/onlypreview/search/core/sqlite-content-search.mjs`
- `src/preload/onlypreview/search/core/sqlite-index.mjs`
- `tests/onlypreview/onlyPreviewGlobalSearchShell.test.mjs`
- focused OnlyPreview SQLite/search contract test chosen during implementation
- `docs/design/onlypreview-global-search.md`
- `docs/plan/README.md`

## Contract

- Contents and Files keep the existing Unicode-normalized literal-substring semantics. The complete
  normalized query is authoritative, including punctuation; `agent-runtime` cannot accept or
  highlight a row containing only `ag`, `agent`, or separate `agent` / `runtime` tokens.
- When the edited query value changes, cancel the previous request and immediately clear its Files,
  Contents, selection, preview, truncation, and error state. Preserve the 120ms latest-only debounce
  for the replacement query and preserve IME composition fencing.
- When the scope selector changes between Current directory and Project with a non-empty query,
  cancel and clear the previous request, then dispatch the replacement search immediately without
  waiting for the typing debounce. Both selector directions must work.
- An empty query never dispatches merely because scope changed. Selecting a new Current directory
  while Project scope is active only records that directory for a later switch, as before.
- Same-query/same-scope warm snapshot rows may remain while fresh reconciliation replaces them;
  query/scope identity changes may not reuse those rows or preview capabilities.
- Keep Files project-wide, Contents scope behavior, one-active/one-latest cancellation, result caps,
  Search child view, two-column layout, transparent Shell click shield, and process count unchanged.

## Flow

```text
query edit
  -> cancel old request -> clear old rows/preview -> 120ms latest-only dispatch

scope change with query
  -> cancel old request -> clear old rows/preview -> immediate dispatch with new scope

scope change without query
  -> update selector only -> no request
```

## Verification

- Prove the SQLite content path treats `agent-runtime` as one exact literal and rejects content that
  contains only `ag`, `agent`, or separated tokens while returning/highlighting the exact phrase.
- Prove a query edit removes accepted prefix rows synchronously before the replacement dispatch.
- Prove Directory -> Project and Project -> Directory each dispatch immediately with the current
  query and exact scope, while an empty query does not dispatch.
- Run focused non-Electron Node tests, relevant typecheck/lint/format, `yarn build`, and
  `git diff --check`. Do not run Electron, Playwright, E2E, packaged smoke, or the real app.

## Delivery

- Every changed query now cancels its predecessor and synchronously clears both result sections,
  truncation flags, selection, preview, and errors before the existing 120ms latest-only typing
  scheduler runs.
- Current directory / Project selector changes and live Current-directory changes now clear the
  previous scope and dispatch the current non-empty query immediately. Empty queries and IME
  composition remain fenced.
- The search engine was not changed. A real in-memory SQLite regression proves the existing FTS
  candidate path plus literal verification accepts only the complete `agent-runtime` substring and
  highlights all 13 graphemes.

## Verification Results

- Focused Global Search Store and SQLite tests: **PASS, 17/17**.
- Task-scoped ESLint: **PASS** for the Store; focused JS tests pass with their existing repository
  explicit-return-type and Prettier debt excluded.
- `yarn build`: **PASS**; validation-only package-name mutation restored afterward.
- `yarn typecheck:web`: attempted, but the repository's existing unrelated Poker Jest globals and
  legacy Home/Connector type errors prevent a clean global result; no error points to a task file.
- `git diff --check`: **PASS**.
- [Independent review 1](../reviews/onlypreview-global-search-query-scope-fencing-047-1.md):
  **PASS**, no P1, P2, or P3 finding.
- Electron, Playwright, E2E, packaged smoke, and the real application were not run, as required.

## Owner Verification

- Search `ag`, then continue typing `agent-runtime`; confirm the `ag`-only row disappears as soon as
  the input changes and only exact full-query matches can appear.
- With a non-empty query, switch Current directory -> Project -> Current directory and confirm each
  switch immediately replaces the Contents result set for the selected scope.
