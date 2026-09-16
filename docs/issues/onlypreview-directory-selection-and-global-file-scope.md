# OnlyPreview directory selection and Global Search file scope

Status: tasks 038 and 072 implemented; **the Files half of this decision was reversed on
2026-09-16** - see [Reversal](#reversal-2026-09-16) below and
[task 178](../plan/tasks/onlypreview-files-section-scope-178.md). The tree-selection half stands.

## Problem

The Project tree currently toggles a directory on the first click but never gives the directory an
independent selected state. Global Search therefore derives Current directory from transient tree
focus instead of an explicit renderer state.

Global Search also applies that Current directory scope to both result groups. This makes a
project-level file or directory name such as `network` disappear whenever it is outside the
current directory, even though the Files group is the project-wide filename/directory lookup.

## Root Cause

- `selectedRelativePath` is the Main-owned Preview file selection and cannot represent a directory.
- the Shell has focus and expansion state, but no separate tree selection/current-directory state;
- the hidden search runtime already collects directory metadata in bounded, time-sliced
  `treeEntries`, but passes the same directory scope to Files and Contents;
- directories are intentionally absent from SQLite/FTS because they have no searchable body.

## Accepted Correction

```text
Project tree
  single click directory row body -> select it as Current directory
  double click directory row body -> keep it selected + toggle expansion once
  single click directory arrow    -> select it as Current directory + toggle expansion once
  file selection                  -> Current directory is its parent

Global Search
  Files    -> always search project-wide file + directory metadata   <- REVERSED 2026-09-16
  Contents -> Current directory by default; selector may switch to Project
```

The tree selection is renderer state scoped to the active workspace. It does not overwrite the
Preview file selection and is not persisted to disk. Directory-name search continues to use the
existing in-memory metadata tier: it must not add directory rows to SQLite/FTS, read directory
contents as text, or start a second full traversal for every query.

## Acceptance

- A directory has a visible and ARIA selected state after one click without expanding/collapsing.
- Double-clicking a directory row outside its arrow keeps it selected and changes its expansion
  state exactly once.
- Single-clicking a directory arrow selects/focuses that directory and changes its expansion state
  exactly once. The arrow consumes its click and double-click events, so a rapid double click cannot
  toggle twice or reach the row's double-click handler.
- Opening Global Search captures the explicit Current directory, not incidental roving focus.
- Files finds `network` anywhere in the project while Contents remains fenced to Current directory.
- During the first index build, the authoritative project-wide Files result waits for the existing
  full metadata candidate instead of launching another unbounded project scan.

## Resolution

Task [onlypreview-directory-selection-search-scope-038](../plan/tasks/onlypreview-directory-selection-search-scope-038.md)
implements the accepted correction. Its third independent review passed after closing both the
writer-starvation risk and the initial/reusable-index false-empty Files race. Live pointer,
keyboard, first-build, and large-project behavior remains for owner verification. Owner testing
then requested live directory rebinding while Global Search is already open; that follow-up is
tracked by
[onlypreview-global-search-concurrency-and-directory-ux](onlypreview-global-search-concurrency-and-directory-ux.md)
without rewriting task 038's completed history.

Task [onlypreview-tree-disclosure-toggle-072](../plan/tasks/onlypreview-tree-disclosure-toggle-072.md)
adds the narrow arrow-hit-target exception without changing task 038's completed selection model,
Global Search scope, or keyboard contract. Its
[first independent review](../plan/reviews/onlypreview-tree-disclosure-toggle-072-1.md) passed with
no finding.

## Reversal (2026-09-16)

Owner, 2026-09-16: 「files 的部分也要受到 Contents scope 的限制」. One scope now fences both
sections; the split above is no longer the shipped behavior.

The original reasoning is left intact above because it is still the honest account of the trade,
and it names exactly what is given up: a project-level name such as `network` no longer appears in
Files while the scope is a directory that does not contain it. The selector is the way back - it
switches both sections to Project at once - and it is relabelled from "Contents scope" to "Search
scope" because it no longer governs only Contents.

What moved the decision is that the two sections were answering questions about different subtrees
at the same time, which reads as a bug rather than as a feature: the same query showed bodies from
the current directory beside names from everywhere. The current design is recorded in
[the Global Search design](../design/onlypreview-global-search.md); the change itself is
[task 178](../plan/tasks/onlypreview-files-section-scope-178.md).

The tree-selection half of this issue - one-click directory selection, the row/arrow gesture split,
and file selection anchoring to its parent - is untouched and still current.
