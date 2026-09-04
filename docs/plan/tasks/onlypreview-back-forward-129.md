---
id: onlypreview-back-forward-129
scope: add back/forward controls left of the preview name that move a visit stack and sync the tree
status: pending
depends-on: [onlypreview-history-tab-128]
verify: node --test tests/onlypreview/onlyPreviewHistory.test.mjs && yarn typecheck:node && yarn check:renderer-i18n && git diff --check
---

# Back and forward through the visit stack

## Objective

Put back/forward controls to the left of the name in the preview toolbar, moving through what this
window has visited and bringing the tree along.

## Context

- `docs/features/onlypreview-browse-history.md`
- `src/renderer/onlypreview/shell/src/components/PreviewToolbar/PreviewToolbar.vue`
- `src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts` (`centerTreeRow`)

## Contract

- Browser semantics: back moves a cursor; navigating to a **new** target truncates everything after
  the cursor. Navigating back and then to the same target is not a truncation.
- The stack is session state. Only the History list persists — do not restore a stack on startup.
- The stack and the History list are fed by the same visit but are not the same collection: History
  is "everywhere, newest first, deduplicated"; the stack is "where this window moved, in order".
- Navigating syncs the tree through the existing `centerTreeRow`, which already collapses the tree
  selection onto the row it anchors. Do not add a second way to move the anchor.
- A stack move must not record a new visit — otherwise going back would rewrite the history it is
  walking.
- Both controls are disabled at their ends, with an accessible label in both languages.
- Works for both target kinds: a directory in the stack navigates back to the directory preview.

## Verification

- Back, forward, and the truncate-on-new-target rule.
- Navigating the stack records no new visit.
- Ends disable their control.
- A directory entry in the stack restores the directory preview.
- The tree follows a stack move: scrolled, anchored, parents expanded, highlight on the row.
- Do not run Electron, Playwright, or packaging.
