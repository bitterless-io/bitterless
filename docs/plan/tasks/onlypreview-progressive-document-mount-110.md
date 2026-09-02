---
id: onlypreview-progressive-document-mount-110
scope: present a DOCX/PPTX preview at its first laid-out unit instead of holding it behind full pagination
status: implemented; owner verification pending
depends-on: [onlypreview-office-ooxml-renderers-077, onlypreview-ooxml-viewer-runtime-repair-081, onlypreview-action-diagnostics-103]
---

# Progressive Document Mount

## Objective

Stop `Preparing preview…` from covering the pagination of every remaining page. A large combined
document must show its first page while the rest lays out behind it.

## Required behavior

1. `mountDocx` and `mountPptx` resolve once the viewer reports at least one unit after `load()`.
   `viewer.waitUntilLayoutComplete()` is no longer on the presentation path.
2. When `load()` resolves with zero units, the session still awaits the full-document barrier and
   re-checks the count. A viewer that does not publish progressively therefore keeps exactly the
   previous behavior, and `DOCUMENT_EMPTY` / `PRESENTATION_EMPTY` are raised only after that
   fallback.
3. The session tracks the remaining layout in one promise that never rejects. A late layout failure
   routes through `handleViewerRuntimeError`, which reports the `layout` phase and fails closed.
   Disposal while layout is still running stays silent.
4. `executeQueuedFind` awaits that tracked promise **before** it starts `FIND_TIMEOUT_MS`, so the
   find deadline measures the find. `findText()` continues to enforce complete coverage inside the
   library, so `coverage` stays `complete`.
5. `runOfficePhase` emits one `[OnlyPreview][office]` record with `phase`, `elapsedMs`, and
   `outcome: 'slow'` for each phase slower than `OFFICE_SLOW_PHASE_MS` (1,000 ms), reusing the same
   sanitized renderer diagnostics channel as the existing failure record. Faster phases stay silent,
   and the record carries no path, content, or identity.
6. XLSX mounting, read, preflight, compatibility normalization, capability/revision fencing, Find
   semantics, and every rendered result are unchanged.

## Expected paths

- `docs/INDEX.md`
- `docs/design/onlypreview-format-coverage.md`
- `docs/issues/onlypreview-docx-waits-for-full-pagination.md`
- `docs/plan/README.md`
- `src/renderer/onlypreview/preview/src/onlyPreviewOfficeSession.service.ts`
- `tests/onlypreview/onlyPreviewOfficeOoxml.test.mjs`

## Verification

- Office session coverage proves: a viewer publishing one page resolves `mount()` without ever
  calling `waitUntilLayoutComplete`; a viewer publishing nothing falls back to the barrier and then
  mounts; a viewer that publishes nothing and completes empty raises `DOCUMENT_EMPTY`; a background
  layout rejection fails the session closed through the runtime-error path; disposal during layout
  reports nothing; and a find issued during layout waits for layout outside its deadline.
- The same fallback and empty behavior is proven for `.pptx`.
- `yarn typecheck:web` shows no new error in the touched file.
- Electron E2E is excluded; the owner verifies the real DOCX.
