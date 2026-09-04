---
id: onlypreview-history-tab-128
scope: replace the static Project label with Project/History tabs backed by a per-workspace persisted visit list
status: pending
depends-on: [onlypreview-directory-preview-target-127]
verify: node --test tests/onlypreview/onlyPreviewHistory.test.mjs && yarn typecheck:node && yarn check:renderer-i18n && git diff --check
---

# Project and History tabs

## Objective

Turn the left panel's static `Project` heading into a two-tab header and add a History tab listing
where the owner has been in this Project, surviving a restart.

## Context

- `docs/features/onlypreview-browse-history.md`
- `src/renderer/onlypreview/shell/src/App.vue:104-125` (the header being replaced)
- `src/main/onlypreview/onlyPreviewRecentDirectory.service.ts` (the `SettingDao` persistence pattern)

## Contract

- A visit is `{ relativePath, nodeKind, visitedAt }`, recorded for both file opens and directory
  activations, scoped to the workspace.
- Re-visiting moves the entry to the front instead of appending a duplicate.
- Persisted per workspace through `SettingDao`, following the recent-directory service rather than
  inventing a second persistence shape.
- Bounded by a constant applied **on write**, so a long session cannot grow the stored value without
  limit.
- Switching tabs does not change the selection, the preview, or the tree's expansion state.
- A history row activates exactly like a tree row of the same kind; a row whose path is gone fails
  the same way any stale row does. History is a record, not an index.
- The Locate control stays in the header and stays bound to the Project tab.
- The shell store is at its enforced **800-line budget** — put the history model in its own module,
  as the tree-selection controller already is.
- Both languages get every new string.

## Verification

- A file visit and a directory visit are both recorded, newest first, with no duplicate on re-visit.
- The cap is enforced on write.
- Persistence round-trips per workspace, and one workspace's history never appears under another.
- Switching tabs leaves selection, preview, and expansion untouched.
- The shell store stays under 800 lines.
- Do not run Electron, Playwright, or packaging.
