

2026-09-14 update: [External file tabs and current-preview identity](../issues/onlypreview-external-file-tab-and-current-preview.md) supersedes the OS/file-tab routing below: OS regular files open a new main-window file tab, and all file tabs stay outside OnlyPreview Recents. MCP remains in OnlyPreview. Its footer and current-file Recents background follow the live preview, independently from tree/keyboard selection.
# OnlyPreview browse targets and history

Status: current Recents contract implemented in BL and Cowork, 2026-09-07; owner testing pending.

## Current delivery: external files, Recents, and Markdown links

This contract supersedes the earlier History-list / separate visit-stack design below for the
file-history work. Delivery: [task 150](../plan/tasks/onlypreview-recents-navigation-150.md), with
a narrow canonical port to Cowork `mini-020`. Directory preview task 127 remains separate.

### State and persistence

- Clarification, 2026-09-08: agent/MCP **file** preview is not a Project-selection gesture. Preserve
  the active Project binding, directory/file selection, current directory, expansion and browse
  state for both inside-Project and external targets. Update the preview and that Project's
  Recents; a later explicit Locate can select/reveal an inside-Project target. A directory target
  still explicitly opens/switches Project, and normal tree/search/OS/Markdown behavior is unchanged.
  This refines the general inside-project rule below specifically for agent/MCP calls.
  Main still tracks the currently previewed internal file; Shell's independent browsing selection
  is not overwritten. Agent opens omit the tree-selection notification while retaining normal
  presentation/Recents notifications. Locate resolves the live same-Project preview reference,
  even when that file's parent listing has not yet loaded, and expands only on that explicit click.

- Preserve the active Project root, index, expansion, selection/current directory and loaded tree
  listings when previewing an external file. External files receive existing **single-file**
  preview authority; they and their parent directories never enter Project indexing/browsing.
  A live external presentation also survives Shell restore/state refresh. Inside-project opens
  still select their real Project entry; preserve pending-authority and same-root reopen fixes.
- Recents records **files only**, deduplicated by canonical path, newest explicit open first,
  capped at **100** on read/write, and persisted through existing settings storage. No file-body
  copies, eager file checks for all history rows, asset/runtime tokens or workspace IDs are stored.
- Owner confirmed 2026-09-07: **one list per active Project**, including files outside that Project.
  An external file opened while A is active belongs only to A's Recents, never B's unless explicitly
  opened while B is active too. No-Project file opens use a separate unbound list, not a shared
  fallback that leaks records into a later Project. Persist scope by canonical Project identity,
  not the external file's parent or an ephemeral workspace ID.
- Shell receives opaque recent IDs, file names and display paths relative to its current Project
  (including `../` paths). With no Project or no relative path possible across volumes, show the
  absolute path as display-only metadata. Paths are never accepted back as read authority.
- Main owns bounded persistence/order and per-host navigation identity. Shell owns panel selection
  and transient loading state. Stale/deleted recent paths remain listed and surface the existing
  typed error while preserving the current preview; do not silently remove data, fabricate
  successful opens, or index missing paths.

### Layout and interaction

```text
┌ Project | Recents      [Collapse] [Locate] ┬ [Back] [Forward] [Reload] file.md ┐
│ report.md                                │                                │
│ ../other-project/report.md                │       existing preview         │
│ notes.md                                 │                                │
│ docs/notes.md                             │                                │
└──────────────────────────────────────────┴────────────────────────────────┘
```

- Tabs live at `onlypreview__projectHeader`; switching panels does not alter preview, Project
  selection/current directory, expansion, loaded caches or tree scroll. Keep Collapse/Locate and
  their current behavior; in Recents, Locate can reveal an inside-project preview in Project.
  External Locate is unavailable/no-op and cannot switch roots or clear the current Project.
- Each recent row has filename as title, relative path as subtitle and full display-path tooltip.
  Clicking selects; double-click/Enter opens the file as history navigation without promoting or
  reordering it (Ral confirmed 2026-09-07). Keep accessible
  tabs, keyboard focus, localized labels and loading/empty/error states. Reuse existing Royal Blue,
  white surface, muted text, divider, selection and IconBtn styling without redesign.
- Left of `onlypreview__previewToolbar` identity: Back walks to the next older item in the current
  Recents order; Forward walks to the newer item. They move a cursor through **that same list**,
  not a second browser stack, and never reorder/truncate/promote it. Disable at list boundaries.
- Reload reclassifies/reloads the current file through the preview lane only, including external
  files, without refreshing the Project index or changing Recents order.
- Accepted explicit file opens from MCP/OS/agent, tree double-click/Enter, enabled single-click
  preview, committed global-search opens and Markdown file links promote once.
  Hover, selection-only gestures, inline search previews, directory toggles, presentation/Find
  updates, watch reload, restore, host relocation, Recents double-click/Enter, Back/Forward and
  Reload never promote. Opening a recent still updates the active cursor and button boundaries.
- A default tree double-click must still promote if single-click-open is enabled, without loading
  the same expensive preview twice. Rapid opens/navigations use existing host serialization and
  revision fencing; only accepted current intent updates the visible cursor/presentation.

### Markdown file links

- Main Markdown preview supports document-relative paths (including sibling-project `../`), local
  absolute paths, and local `file:` URLs. Resolve against the **currently authorized source file**,
  not Project root, current directory selection, process cwd, or renderer-supplied source paths.
- Validate source runtime/selection revision and host before resolving a link. Main can normalize
  URL/path strings, but canonicalization/stat/read remain in preload. The resolved file uses the
  same explicit-file pipeline and single-file external authority, and promotes Recents.
- Preserve same-document fragments/anchors without file re-open or promotion. File links with
  fragments open the target file and locate its anchor when available; a missing anchor leaves
  the target readable. Properly handle URL-encoded names, spaces and Unicode.
- Restore only narrowly sanitized link metadata/event handling; raw HTML remains inert. Never
  navigate the renderer to arbitrary local URLs, loosen resource grants, execute `javascript:` /
  `data:` or accept remote `file:` hosts. No automatic I/O just for rendering a link.
- Shared search Markdown must not accidentally resolve links relative to the main preview file.
  If links are exposed there, use the actual selected search-result authority and stale-result
  fencing. HTML/PDF navigation behavior and dedicated directory-preview work are not expanded.

Implemented boundary: interactive local links are enabled only in the authorized main Markdown
preview. Search Markdown remains inert. Project changes during an asynchronous explicit open are
fenced before/after inspection and presentation, so an A request cannot become a B recent or preview.
Cowork uses its existing settings adapter; BL uses its existing SQLite-ready settings lifecycle.

## Archived 2026-09-04 design (not the current file-history contract)

Requested by Ral 2026-09-04, with three decisions taken the same day:

1. History persists across restarts, **per Project**.
2. Back/forward **syncs the tree** — scroll, select, expand parents — like Locate.
3. A directory in the preview pane shows **name + full path + its child entries**.

## Why directories need a contract change

Today a directory cannot reach the preview pane at all. `selectStandaloneFile`
(`src/main/xpc/onlyPreview.handler.ts:286-289`) rejects anything that is not a regular file:

```ts
if (file.nodeKind !== 'file') {
  throw new OnlyPreviewContractError('PATH_NOT_REGULAR_FILE', …);
}
```

That guard is load-bearing — everything downstream of a selection (the read broker, asset grants,
Office sessions, Find) assumes a regular file. So directories get a **sibling** selection path rather
than a loosened guard, and a presentation form that carries no file authority at all.

The listing itself is not new work — but the producer is **`browseDirectory`**, not the Global
Search directory preview. The Global Search variant
(`onlyPreviewSearch.type.ts:257-261`, produced by `global-search-preview.mjs:218`) needs a
`resultToken` minted by a search result, which a tree row does not have. `browseDirectory`
(`onlyPreviewSearchRuntime.handler.ts:141-150`) returns an `OnlyPreviewBrowseListing` for any path,
is already fenced on workspace and generation, and is how the tree enumerates a directory today.

So: data from the browse listing, presentation from `DirectorySearchPreview.vue`'s existing shape.

## Layout

```
┌─ MenuBar ─────────────────────────────────────────────────────────────────────┐
├───────────────────────┬───────────────────────────────────────────────────────┤
│ ┌───────┬─────────┐ ⌖ │ ◀ ▶  name.ext                              [TYPE] ⋯   │  ← preview toolbar
│ │Project│ History │   ├───────────────────────────────────────────────────────┤
│ └───────┴─────────┘   │                                                       │
│ ▾ src                 │                    preview surface                    │
│   ▸ main              │                                                       │
│   ▾ renderer          │                                                       │
│     • App.vue    ←sel │                                                       │
│                       │                                                       │
└───────────────────────┴───────────────────────────────────────────────────────┘
   ▲ tabs replace the                ▲ back/forward sit left of the name
     static "Project" label
```

History tab, same panel:

```
┌───────┬─────────┐ ⌖
│Project│ History │
└───────┴─────────┘
  • App.vue                 2m ago     ← file visit
  ▸ src/renderer            5m ago     ← directory visit
  • onlyPreview.handler.ts  12m ago
  …                                    ← capped, newest first
```

Directory in the preview pane:

```
 src/renderer/onlypreview                        ← name, large
 src/renderer/onlypreview                        ← full relative path, muted
 ─────────────────────────────────────
 ▸ common          ▸ globalSearch
 ▸ guide           ▸ preview
 ▸ settings        ▸ shell
 • index.html
                          12 items
```

## Contract

### Visit

One visit is `{ relativePath, nodeKind: 'file' | 'directory', visitedAt }`, scoped to a workspace.
Both a file open and a directory activation record one. Re-visiting an entry moves it to the front
rather than appending a duplicate.

### History

- Persisted per workspace through `SettingDao`, the same layer
  `onlyPreviewRecentDirectory.service.ts` already uses.
- Bounded. The cap is a constant, applied on write, so a long session cannot grow the stored value
  without limit.
- A visit whose path no longer exists stays in the list and fails on activation like any other stale
  row; history is a record of where the owner has been, not an index.

### Back/forward

- A visit stack with browser semantics: navigating back moves a cursor, navigating to a *new* target
  truncates everything after the cursor.
- Distinct from the History tab list: the tab is "everywhere you have been, newest first"; the stack
  is "where this window has moved". Both are fed by the same visit.
- Navigating syncs the tree through the existing `centerTreeRow`, which collapses the tree selection
  onto the row it anchors
  ([`onlypreview-locate-file-leaves-no-highlight`](../issues/onlypreview-locate-file-leaves-no-highlight.md)).
- The stack is session state. Only the History list persists.

### Directory presentation

- A directory selection produces a presentation with no `fileRef` authority, so no read broker
  grant, no asset URL, and no Find coverage is issued for it.
- The preview toolbar shows the directory name where a file name would be; the trailing type badge
  and file actions do not apply.
- Selecting a directory does not change what "the previewed file" means for Locate or for the
  OnlyPreview MCP `preview.open` contract.

## Out of scope

- Reordering, pinning, or manually deleting individual history rows.
- Searching within History.
- Restoring the back/forward stack across restarts.

## Delivery

| Task | Scope |
|---|---|
| [onlypreview-directory-preview-target-127](../plan/tasks/onlypreview-directory-preview-target-127.md) | directory selection path, presentation form, preview + toolbar rendering |
| [onlypreview-history-tab-128](../plan/tasks/onlypreview-history-tab-128.md) | Project/History tabs, per-workspace persisted visit list |
| [onlypreview-back-forward-129](../plan/tasks/onlypreview-back-forward-129.md) | visit stack, toolbar controls, tree sync |
