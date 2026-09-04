# OnlyPreview browse targets and history

Status: designed; implementation in progress

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

The listing itself is not new work: `OnlyPreviewGlobalSearchPreview` already has a `directory`
variant carrying `name` and `entries: OnlyPreviewDirectoryPreviewEntry[]`
(`src/shared/onlypreview/onlyPreviewSearch.type.ts:257-260`), produced by
`src/preload/onlypreview/search/core/global-search-preview.mjs:218`, and the shell already renders it
in the Global Search flyout (`DirectorySearchPreview.vue`). The preview pane reuses both.

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
