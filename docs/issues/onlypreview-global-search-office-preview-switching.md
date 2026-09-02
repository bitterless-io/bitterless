# Global Search cannot preview Office files safely during rapid selection

Status: implemented; owner verification pending

## Problem

The Global Search bottom pane currently renders XLSX/XLSM, DOCX, and PPTX results as file
information only. Opening the same result in the main Preview can use `@silurus/ooxml`, but Search
has no Office byte-delivery capability and no format component.

Adding the Viewer directly would also create a race: parsing and layout are asynchronous, so a late
workbook/document/deck can replace the pane after the user has already selected another result.
Repeated clicks may otherwise retain multiple archives, Workers, Viewer instances, and full-file
buffers at once.

## Accepted correction

```text
select A ─ leading ───────────────> read/render A
  select B within 120ms ─────────> retire A; queue B
  select C within 120ms ─────────> replace queued B with C
trailing edge ───────────────────> read/render C only
A late ready/error ──────────────> stale revision; discard
```

- Add rich bottom-pane preview for `.xlsx`, `.xlsm`, `.docx`, and `.pptx` by reusing the existing
  lazy per-format `@silurus/ooxml` session, not the main Preview component or its Find state.
- Keep a Search-dedicated Office read lane in the hidden file-search preload. It must not reuse or
  cancel the current-file Preview lane. Main validates identities and relays bounded chunks only;
  it performs no file I/O and never buffers the complete package.
- Selection state changes immediately. Clear and dispose the prior preview before scheduling the
  replacement so the previous document is never displayed under the new selected row.
- Use one 120ms leading-plus-trailing scheduler: the first selection is responsive; intermediate
  selections inside the interval are coalesced; the last selection always runs.
- Fence metadata, byte reads, dynamic imports, Worker completion, Viewer load/layout, and errors by
  one monotonic preview revision. Stale work cannot mutate the pane.
- At most one Search Office read, full package buffer, format Worker, and Viewer session may be
  live. Query/scope/workspace changes and Search dismissal cancel the trailing timer and release
  them.

## Preview states

```text
┌─ PREVIEW ───────────────────────────────────────────── Open ↗ ─┐
│ switching/loading:  Preparing <selected filename>…             │
│ ready:              one scrollable OOXML Viewer                 │
│ failure:            compact current-file-only error             │
└─────────────────────────────────────────────────────────────────┘
```

The header, split geometry, selected row, keyboard order, main Preview selection, and existing
text/directory/info variants remain unchanged. Search does not register its Office viewer with the
current-file `Cmd/Ctrl+F` adapter.

## Acceptance

- Clicking or keyboard-selecting an XLSX/XLSM, DOCX, or PPTX Files result renders it inside the
  Global Search bottom pane without opening the main Preview.
- Rapidly selecting A → B → C never flashes A or B after C is selected, even when an older read,
  parser, Viewer, or error resolves late.
- The previous Viewer/Worker/read is disposed immediately; the trailing selection runs after the
  threshold and Search never retains parallel full Office packages.
- Main performs no filesystem I/O and never receives a chunk larger than the existing 512KiB Office
  frame limit. Main Preview Office rendering is unaffected.
- Focused non-Electron tests cover all Office adapters, the throttle/trailing state machine, stale
  success/error rejection, cleanup, chunk limits, capability fencing, and Search CSP/build inputs.

## Resolution

[Task 092](../plan/tasks/onlypreview-global-search-office-preview-092.md) implements the independent
Search Office lane, lazy OOXML component, and 120ms leading/latest-trailing selection lifecycle.
The first independent pass identified fail-closed read-error cleanup and Store-level race coverage
gaps; both were corrected before [review 1](../plan/reviews/onlypreview-global-search-office-preview-092-1.md)
recorded **PASS**. Ral's live mixed-format and rapid-selection check remains.
