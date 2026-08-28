# OnlyPreview directory selection and Global Search file scope

Status: tasks 038 and 072 implemented; owner verification pending

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
  Files    -> always search project-wide file + directory metadata
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
