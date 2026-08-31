---
id: onlypreview-global-search-office-preview-092
scope: Render Office files inside Global Search with one independent bounded read lane and latest-only rapid-selection lifecycle
status: implemented; owner verification pending
depends-on:
  - onlypreview-global-search-file-content-preview-073
  - onlypreview-ooxml-viewer-runtime-repair-081
  - onlypreview-main-fs-boundary-audit-087
verify: focused non-Electron protocol/reader/scheduler/renderer source tests, typecheck/lint/format, yarn build, and git diff checks; no Electron/Playwright/E2E
---

# Global Search Office preview and rapid switching

## Objective

Render XLSX/XLSM, DOCX, and PPTX inside the Global Search bottom pane while making rapid pointer or
keyboard selection latest-only, resource-bounded, and independent of the main Preview Office lane.

## Context

- `docs/issues/onlypreview-global-search-office-preview-switching.md`
- `docs/plan/analysis/onlypreview-global-search-office-preview.md`
- `docs/design/onlypreview-global-search.md`
- `docs/design/onlypreview-format-coverage.md`
- `docs/features/onlypreview.md`

## Path

- shared Global Search Office preview/read contracts and parsers
- hidden file-search preload Search Office reader/runtime and Main bounded relay
- Global Search renderer client/store scheduler and lazy Office preview component
- Global Search CSP/build input and focused `tests/onlypreview/` coverage
- the documentation listed above plus `docs/INDEX.md` and `docs/plan/README.md`

## Contract

- Extend the result-preview union with a metadata-only `office` variant for XLSX/XLSM, DOCX, and
  PPTX. It exposes no absolute path and no file bytes.
- Resolve and read Office data only in a Search-dedicated hidden-preload lane. Keep stable identity,
  signature/package, size, one-shot grant, ordered 512KiB frame, cancellation, and fail-closed
  protocol checks. Main only validates and relays frames.
- Lazily mount a Search-specific Office component that delegates to `OnlyPreviewOfficeSession` but
  does not import the main Preview store or register current-file Find/readiness.
- Update selection immediately, clear/dispose the old pane, and use one 120ms leading-plus-trailing
  scheduler for preview dispatch. Keep only the final candidate inside the threshold.
- Key every accepted component by the preview revision/result token. Fence metadata, byte assembly,
  dynamic import, Worker, Viewer, and error settlement; stale work produces no UI mutation.
- Cancel timer/read/session on a new selection, query/scope/workspace change, result clear, and
  Search dismissal. At most one Search Office buffer/Worker/Viewer is live.
- Preserve all existing result layout, header/Open action, text/directory/info preview behavior,
  selected-row behavior, and main Preview selection.

## Verification

- Cover all four extensions and three OOXML adapters, separate lane/authority, ordered bounded
  chunk assembly, grant reuse/cancellation, and no Main filesystem API use.
- Cover leading single click, B/C coalescing to C, trailing dispatch, stale success/error, timer
  cancellation, unmount disposal, and format switches before prior load/layout completes.
- Cover narrow Search CSP/build wiring and verify Office dependencies remain lazy.
- Run focused Node/source tests, applicable typechecks, directed ESLint/Prettier, `yarn build`, and
  task-scoped `git diff --check`.
- Do not run Electron, Playwright, packaged smoke, or E2E. Ral owns live rapid-click and rendering
  acceptance.

## Delivery

- Global Search now returns a metadata-only Office preview for XLSX/XLSM, DOCX, and PPTX and reads
  it through a Search-owned hidden-preload reader. Main validates and relays exact ordered frames
  capped at 512KiB without filesystem I/O or a complete-package buffer.
- A Search-specific lazy component reuses `OnlyPreviewOfficeSession` for all three pinned OOXML
  viewers without importing the main Preview store or Find adapter. The Global Search CSP and build
  audit now authorize exactly the required local Worker/WASM runtime while preserving independent
  per-format chunks.
- Selection is immediate. One 120ms fixed-window leading/latest-trailing scheduler coalesces rapid
  navigation; revision/request/result fences and keyed containers make stale responses, errors,
  Workers, imports, load/layout completions, and `finally` blocks inert. Unmount cancels the Search
  read and synchronously disposes the Viewer/Workers.
- Independent review found and closed two P2 gaps: read exceptions now synchronously revoke the
  exact grant/handle, and Store-level ABA/stale/trailing cancellation now has behavioral coverage.
  [Review 1](../reviews/onlypreview-global-search-office-preview-092-1.md) records **PASS**.
- Backend focused tests passed 16/16, Renderer focused tests passed 34/34, the expanded behavior set
  passed 59/59, independent closure passed 25/25, `yarn typecheck:node`, directed ESLint,
  task-scoped `git diff --check`, and `yarn build` passed. Full web typecheck remains blocked by
  pre-existing unrelated project errors. Electron/Playwright/E2E was not run.

## Owner verification

- Open Global Search, click XLSX/XLSM, DOCX, and PPTX Files results, and confirm each renders inside
  the bottom Preview without changing the main Preview selection.
- Rapidly click several mixed Office/text/directory results and confirm only the final selection
  renders, the pending filename is current, and no late old Viewer/error flashes.
- Keep one Office file open in main Preview while rapidly previewing Office results in Search and
  confirm the main document remains loaded and usable.
