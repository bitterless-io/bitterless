---
id: onlypreview-project-copy-shortcuts-116
scope: make Copy Path and Copy Name window-wide Main-owned shortcuts so they work with focus in any view
status: implemented; owner verification pending
depends-on: []
---

# Project Copy Shortcuts

## Objective

`Shift+Cmd+C` must copy the selected Project item's absolute path regardless of which OnlyPreview
view holds focus.

Issue: [`onlypreview-copy-shortcut-requires-tree-focus.md`](../../issues/onlypreview-copy-shortcut-requires-tree-focus.md).

## Required behavior

1. `isProjectItemCopyShortcut` sits beside `isGlobalSearchShortcut` and `isCurrentFileFindShortcut`
   and follows the same modifier discipline, including the opposite-platform modifier exclusion.
   Exactly one of Shift/Alt qualifies.
2. `resolveNativeCommand` returns `copy-project-path` / `copy-project-name` only for the standalone
   host and only while Global Search is inactive.
3. `bindNativeShortcuts` broadcasts `ONLY_PREVIEW_COPY_PROJECT_ITEM_EVENT` and does not move focus.
4. The shell resolves the target from its own tree selection and reuses the existing
   `copyProjectItem` path, so the clipboard behavior and the Main-side authority fences are
   unchanged.
5. Plain `Cmd+C` remains renderer-owned; the renderer handler returns early for Shift/Alt.

## Verification

- `onlyPreviewFindRenderer.test.mjs` executes the new predicate for both platforms: Shift and Alt
  each qualify, plain Cmd+C does not, Shift+Alt does not, auto-repeat and keyUp do not, a non-C key
  does not, and holding the opposite platform modifier does not.
- `yarn build`, `tsc --noEmit -p tsconfig.node.json` and `vue-tsc --noEmit` are clean for OnlyPreview.
- Electron E2E excluded; the owner verifies by selecting a file, clicking into the preview, then
  pressing Shift+Cmd+C.
