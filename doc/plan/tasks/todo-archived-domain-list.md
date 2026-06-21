---
id: todo-archived-domain-list
scope: todo
status: done
depends-on: [todo-mcp-active-list-only]
---

# Todo Archived Domain List

## Objective

Add a top-right archive/trash entry in the Todo window that opens a centered modal listing archived domains with simple text filtering.

## MCP Check

MCP already supports reading incomplete todos for one domain through `todo.list({ domainId })`. Because `todo.list` now only returns incomplete todos from unarchived domains, no new MCP tool is needed.

## Layout

```text
Todo window
┌──────────────────────────────────────────────┐
│ Todo                         [archive] [...] │
├──────────────────────────────────────────────┤
│ active domain board                          │
└──────────────────────────────────────────────┘

Archive modal
┌────────────────────────────────────┐
│ Archived Domains              [x]  │
│ [search input]                    │
│ ┌ domain title                  ┐ │
│ │ description / archived time   │ │
│ └───────────────────────────────┘ │
│ empty state when no results       │
└────────────────────────────────────┘
```

## Path

- Keep the main Todo board limited to active domains.
- Wire the existing domain archive field into the domain context menu.
- Store archived domains separately in the todo store.
- Add a `ArchivedDomainsModal` component with a centered Arco modal and text filter.
- Add a top-right menu bar archive button to open the modal.
- Add i18n labels for the button, search field, empty state, and metadata.

## Verification

- `yarn build`
- `git diff --check`

## Result

- Confirmed MCP can read incomplete todos in a specific domain with `todo.list({ domainId })`; no new MCP tool was added.
- Main Todo board now keeps archived domains out of the active domain list.
- Added a top-right archive button in the Todo menu bar.
- Added a centered archived-domain modal with title/description text filtering.
- Added domain context-menu archiving through the existing `domain.archived` field.
