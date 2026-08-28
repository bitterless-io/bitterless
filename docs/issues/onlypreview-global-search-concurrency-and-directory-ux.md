# OnlyPreview Global Search serial sections and stale directory context

Status: implemented; owner verification pending

## Problem

Owner verification exposed three connected gaps in the Global Search workspace:

- Files metadata finishes before Contents is allowed to start, so the two independent sections do
  not make progress together;
- Files results inherit traversal order, which can place files before matching folders; and
- while search is open, an explicit Project-tree directory selection does not update Current
  directory. A nested folder result can also close search without leaving every ancestor expanded
  and the target visibly focused. Directory rows expose the internal `mediaType: unknown` instead
  of the user-facing type `folder`.

## Accepted Correction

```text
one latest Global Search request
  ├─ Files metadata ── stable folders ── stable files ── cap 250
  └─ Contents SQLite ── live Current directory / Project ── cap 250
             \________________ terminal waits for both ________________/

Project tree while search is open
  click directory
    -> selected Current directory changes immediately
    -> Current-directory Contents cancels/restarts for the new directory

folder search result: double click / Cmd+Enter
  -> load + expand root / every ancestor / target
  -> select + center-focus target in Project
  -> close Global Search only after reveal succeeds

visible type: directory nodeKind -> folder; file -> existing mediaType
```

- Start the authoritative Files and Contents branches cooperatively after the existing promotion,
  first-build, and priority-lane gates. A terminal response waits until both branches have settled.
  On cancellation or failure, retain active-index ownership until both branches have stopped.
- Stable-partition every Files match before applying the 250-row cap: all directories first, then
  files. Preserve the existing natural traversal order inside each partition.
- While Global Search is open, a change in the explicit Project-tree Current directory updates the
  live directory path and label. If Contents is using Current directory and a non-empty query is
  active, supersede it through the existing latest-only scheduler. Project scope records the new
  directory for a later switch but does not run an equivalent query again. Roving focus and search
  result selection remain inert.
- A successful directory-result reveal expands every path segment including the target, selects it,
  scrolls it to the center, and focuses the Project row. A failed reveal keeps Global Search open.
- Keep directory `mediaType: unknown` inside the strict search protocol. The Renderer display
  adapter derives the visible lowercase `folder` label from `nodeKind: directory`.

## Performance And Safety

Concurrency remains cooperative inside the existing hidden `fileSearch` renderer. It does not add
another XPC request, renderer, worker, traversal, SQLite connection, or Main-process filesystem
work. Files still performs metadata-only time-sliced matching; Contents retains all body/index
bounds. Folder-first collection remains bounded to at most one section cap per partition while the
single existing metadata pass completes, and Renderer scope synchronization uses one scalar path
comparison.

## Acceptance

- Files and Contents both start before either authoritative branch is required to finish.
- Every returned folder precedes every returned file; order remains stable within both groups and
  truncation is truthful after the partition.
- Clicking a Project directory while search is open immediately changes Current directory and
  refreshes only directory-scoped Contents.
- Revealing a nested folder result leaves its full Project ancestry and the folder itself expanded,
  selected, centered, and focused.
- Directory rows display `folder`; ordinary files continue displaying their existing media type.

## Resolution

Task
[onlypreview-global-search-concurrency-directory-ux-040](../plan/tasks/onlypreview-global-search-concurrency-directory-ux-040.md)
implements this correction. Its
[first independent review](../plan/reviews/onlypreview-global-search-concurrency-directory-ux-040-1.md)
passed with no P1/P2/P3 finding; live interaction verification remains with Ral.
