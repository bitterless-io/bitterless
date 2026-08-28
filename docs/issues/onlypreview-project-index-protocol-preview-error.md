# OnlyPreview Project index protocol failure is reported as a Preview stream error

Status: implemented; owner verification pending

## Symptom

Opening a directory can leave Project empty during initialization and only later show
`The preview data stream could not be opened.` The message points at the selected-file Preview
pipeline even though the failure belongs to Project search indexing.

## Root cause

The hidden file-search renderer classifies Office and Draw.io files with specialized Preview hints
while retaining the search index's intentionally narrower media type:

| format    | `previewHint`  | search `mediaType` |
| --------- | -------------- | ------------------ |
| XLSX/XLSM | `sheet`        | `unknown`          |
| DOCX      | `document`     | `unknown`          |
| PPTX      | `presentation` | `unknown`          |
| Draw.io   | `diagram`      | `unknown`          |

Main's file-search relay still required `mediaType === previewHint`, except for `unsupported`.
After the richer hints were introduced, a legitimate Project entry therefore failed relay
validation. Root listings and intermediate snapshots were silently discarded, while `publish`
still acknowledged them. Initialization continued until the terminal snapshot reached the same
validator, which finally raised the generic `PROTOCOL_ERROR`; the Shell then rendered the Preview
stream message attached to that generic code.

## Accepted repair

- Define the Main relay mapping explicitly: `text`, `pdf`, `image`, `audio`, and `video` retain the
  matching search media type; `sheet`, `document`, `presentation`, `diagram`, and `unsupported`
  require `unknown`. `isText` remains true only for `text`.
- Classify malformed current-generation file-search events and terminal values as a dedicated
  Project index protocol error. Do not change the generic Preview `PROTOCOL_ERROR` message.
- A malformed event for the active workspace and generation faults the attached search runtime
  immediately and rejects its pending/future calls. A structurally valid stale-generation event
  and a late batch for a superseded search remain ignorable races.
- Add regression coverage for rich-format listings/snapshots, invalid hint/media pairings, early
  current-generation failure, stale-event tolerance, and the Project-specific localized message.

## Acceptance

- A Project containing XLSX/XLSM, DOCX, PPTX, or Draw.io entries initializes and browses without a
  false protocol failure.
- A real current-generation contract violation is visible immediately instead of waiting for the
  terminal initialize response.
- The Project alert never describes this failure as a Preview data-stream problem.
- Existing selected-file Preview protocol failures retain their current generic Preview wording.

## Resolution

[Task 080](../plan/tasks/onlypreview-project-index-protocol-validation-080.md) now applies the
explicit rich-format mapping, reports `INDEX_PROTOCOL_ERROR` with Project-specific wording, and
wakes a pending call on the first malformed current-generation event. Its bounded retired-request
registry distinguishes active, cancelled, superseded, terminal, timed-out, and unknown request
IDs without allowing an old generation to pollute the current one. The final
[independent review 3](../plan/reviews/onlypreview-project-index-protocol-validation-080-3.md)
passed with no P1/P2/P3 finding; Ral's live Project initialization check remains.
