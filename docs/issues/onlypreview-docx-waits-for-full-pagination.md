# OnlyPreview Holds a Rendered Document Behind Full Pagination

Status: fixed; owner verification pending

## Symptom

`MTI_AI_Care_Command_Center_Indonesia_Sandbox_Governance_Submission_Candidate_v0.2.docx` sits on
`Preparing preview…` for a long time before anything appears, even though the file is only 300 KB on
disk.

## Evidence

The archive is small; its content is not.

| Measure | Value |
| --- | --- |
| archive | 300 KB |
| `word/document.xml` | 4.33 MB |
| `styles.xml` + `stylesWithEffects.xml` | 788 KB |
| paragraphs / runs | 9,491 / 11,297 |
| tables / rows / cells | 298 / 2,099 / 6,754 |
| XML inside `<w:tbl>` | 81.2% |
| section breaks (`<w:sectPr>`) | 27 |

The document is a combined master of 24 controlled documents, so it paginates as 24 documents in
one layout pass, and four fifths of its markup is table content — the most expensive layout path,
because column widths must be resolved and rows split across pages.

The cheap phases were measured, not assumed. Running the real `preflightOnlyPreviewOoxml` against
this exact file takes **37–51 ms**. The Office read broker uses 512 KB chunks
(`ONLY_PREVIEW_OFFICE_READ_CHUNK_BYTES`), so the whole 300 KB file arrives in a single chunk.
Neither is material.

## Root cause

`mountDocx` runs `load` and then blocks on the full-document layout:

```ts
await this.runOfficePhase('load', () => viewer.load(bytes));
await this.runOfficePhase('layout', () => viewer.waitUntilLayoutComplete());
if (viewer.pageCount === 0) throw DOCUMENT_EMPTY;
```

`OnlyPreviewPreviewStore.loading` clears only when `mount()` resolves, so `Preparing preview…`
covers that barrier.

The barrier is redundant for its stated purpose. `@silurus/ooxml` is already constructed with
`progressiveLayout: true`, and in the library's main-mode layout path the first layout publication
both records `pageCount` and resolves `load()`; every later publication reports through
`onLayoutPartial`. So by the time `load()` resolves, a laid-out, presentable first page normally
already exists — and `waitUntilLayoutComplete()` then waits for the remaining ~9,500 paragraphs and
298 tables before the owner is allowed to see any of it.

`.pptx` blocks the same way. `.xlsx` never did — `mountXlsx` awaits `load` only.

The empty check is the reason the barrier was introduced: `pageCount === 0` cannot be trusted before
something has been laid out. That is a real constraint, but it needs *one* published page, not the
whole document.

Finding a query is the one operation that genuinely needs complete layout, and the library already
enforces that itself: `DocxScrollViewer.findText()` awaits `waitUntilLayoutComplete()` when layout
is still running, so match coverage stays complete regardless of when a find is issued.

## Repair contract

- `mount()` resolves as soon as the viewer has a laid-out first page or slide. Remaining pages
  continue to lay out behind the presented preview.
- The full-document barrier remains as a fallback: when `load()` resolves with no published unit,
  the session still awaits `waitUntilLayoutComplete()` and re-checks. A viewer or document that
  never publishes early therefore behaves exactly as before.
- `DOCUMENT_EMPTY` / `PRESENTATION_EMPTY` keep their meaning. Empty is reported only after a unit
  count of zero survives the fallback barrier, never because layout was still running.
- A layout failure that arrives after `mount()` resolved is reported through the existing
  runtime-error path and fails the preview closed. It must never surface as an unhandled rejection.
- Find waits for complete layout outside its own deadline, so `FIND_TIMEOUT_MS` continues to measure
  the find and a first find during layout cannot be reported as a render timeout. Find coverage
  stays `complete`.
- A mount phase slower than one second records its elapsed time through the existing
  `[OnlyPreview][office]` renderer diagnostics channel, so the next slow preview is answerable from
  `main.log` instead of by hand. Faster phases stay silent.
- Read, preflight, XLSX compatibility, capability/revision fencing, disposal, and every rendered
  result are unchanged.

Delivery: [onlypreview-progressive-document-mount-110](../plan/tasks/onlypreview-progressive-document-mount-110.md).
