# Global Search bottom Preview shows match context instead of the file

Status: implemented through independent review; owner verification pending

## Problem

Selecting a Contents result currently repeats the row's short highlighted match context in the
bottom Preview. This makes the Preview pane look like an enlarged search snippet instead of a
read-only preview of the selected file. Markdown, source, and static HTML therefore behave
differently depending on whether the same file was selected from Contents or Files.

## Root Cause

The hidden search runtime branches on `result.section === 'contents'` and returns a dedicated
`before / match / after` payload. The visible Global Search renderer then loads a context-only
component. The result row already owns the reason-for-match snippet, so this second context surface
duplicates information and bypasses the file's preview adapter.

## Accepted Correction

```text
Selected result
  result row    -> filename + relative directory + highlighted match snippet
  bottom Preview
    text/code   -> bounded read-only source preview
    Markdown    -> bounded VuePreview-style rendered document
    static HTML -> bounded sanitized reading surface; no scripts/resources/navigation
    directory   -> direct children
    non-text    -> file information + Open
```

- Files and Contents tokens for the same text file resolve to the same bounded file-head preview
  semantics. Contents selection no longer returns a match-context-only payload.
- The row-level grapheme-safe snippet and highlight remain unchanged; they explain why the row
  matched. The bottom Preview starts at the file beginning and never jumps to or enlarges the
  search match.
- Preserve the 256KiB text cap, one-preview-payload limit, latest-only selection fencing,
  containment, exclusion, no-symlink, stable-identity, and opaque-token boundaries. Main performs
  no filesystem I/O.
- Do not add another native Preview view or another Monaco runtime to the independent Search
  renderer for this correction. Reuse the safe Markdown renderer and Vue Preview reading/source
  visual language inside the existing bottom pane.
- Directory and metadata-only non-text behavior remain unchanged. Rich Vue asset adapters for
  image/media/Office/Draw.io require a separate capability-owned asset delivery task and are not
  implied by this correction.

## Acceptance

- Selecting the same `.md`, source, or static HTML file from Files or Contents yields the same
  adapter and bounded file-head content in the bottom Preview.
- A query whose only match occurs after the first 256KiB still shows its match in the result row,
  while the bottom Preview truthfully shows the file beginning and reports truncation.
- No `context` preview variant or context-only component remains accepted by the live contract.
- Markdown uses the Vue Preview reading column and typography; source uses its read-only editor
  typography; static HTML remains fully sanitized.
- Query/scope/token replacement cannot allow an older preview to replace the current selection.

## Resolution

Task [onlypreview-global-search-file-content-preview-073](../plan/tasks/onlypreview-global-search-file-content-preview-073.md)
supersedes only the historical Contents context-preview sub-contract from tasks 036/037. Their
result-row snippet, token authority, directory/info, and bounded-data guarantees remain intact.
[Independent review 1](../plan/reviews/onlypreview-global-search-file-content-preview-073-1.md)
passed with no blocking or P1–P3 finding.
