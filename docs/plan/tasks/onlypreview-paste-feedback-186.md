---
id: onlypreview-paste-feedback-186
scope: Move a paste name conflict to the alert layer, scroll to and flash the pasted row without opening the preview, and make the Copy-detail control a borderless tabler icon button — mirrored to micromeet-cowork
status: implemented; owner verification pending
depends-on: []
verify: node --test tests/onlypreview/onlyPreviewPasteFeedback.test.mjs tests/onlypreview/onlyPreviewErrorDetail.test.mjs tests/onlypreview/onlyPreviewBookmarks.test.mjs tests/onlypreview/onlyPreviewGlobalSearchShadow.test.mjs; yarn typecheck:web; no Electron/Playwright/E2E
---

# Paste feedback

Contract: [paste feedback](../../features/onlypreview-paste-feedback.md). Owner request 2026-09-18,
four items across two messages.

## What changed

1. **Conflict → alert layer.** `NAME_EXISTS` from a paste now raises the alert dialog instead of the
   Project rail's banner. `OnlyPreviewNoticeRequest` gains an optional `tone` so the existing
   renderer-callable path can ask for the error face rather than the notice one; no second API
   method, the two would differ by one field. Every other paste failure still uses the banner,
   because that is real breakage and Copy-detail is the right affordance for it.
2. **Reveal without preview.** `revealCreatedEntries` and the new `revealPastedEntries` share one
   private implementation; the only difference is the `selectedRelativePath` assignment, which *is*
   the previewed file. It returns the paths that actually reached the index.
3. **Scroll + flash.** `focusTreePath(path, true)` — Locate's existing centring scroll, not a second
   one — then a one-shot `--paste-flash` class animating transparent → `#d6e4ff` → transparent over
   900ms. Cleared by timer rather than `animationend`, because a row scrolled out of the DOM never
   fires one and a stuck path would re-flash on every later render. Disabled under
   `prefers-reduced-motion`, where the row is still scrolled to and still selected.
4. **Copy-detail as an icon button.** `IconCopy` / `IconCheck` from tabler, with the former text kept
   as `title`/`aria-label`. Its `border: 1px solid` had to go with it: the workspace rule is that
   icon buttons are borderless, so it now matches the sibling dismiss button's shape.

## Notes for whoever touches this next

- The flash colour is the literal `#d6e4ff`. The first attempt used
  `var(--onlypreview-project-selection)`, which **does not exist** — the selected row hardcodes that
  hex too. A `var()` to a missing token compiles to an empty value and the flash silently does
  nothing, which source-text review cannot see; the guard compiles the stylesheet and asserts the
  literal, and asserts no `var(` in the keyframes.
- The CSS guard strips comments before asserting. A comment explaining a declaration almost always
  quotes it, and the `doesNotMatch(/var\(/)` above was matched by the comment saying not to use
  `var()` — the same trap `onlyPreviewGlobalSearchShadow.test.mjs` already documents.
- **micromeet-cowork carries shell-render guards that BL does not**
  (`onlyPreviewTreeDensity`, `onlyPreviewProjectDeleteShortcut`, `onlyPreviewProjectLoadingGates`).
  They build a context object of every symbol the compiled template references, so a new import in
  `App.vue` fails them with `Cannot read properties of undefined` until it is stubbed there. Three
  stubs were added. Copying `App.vue` into cowork without running cowork's own unit tests will miss
  this.

## Pre-existing, not introduced here

- BL: `every banner message passes through the capture` — the shell store's 800-line budget.
- Cowork: six failures at its HEAD, two of which show it is running **older contracts than BL** —
  `总延伸量 ≤ 24px` is the shadow guard before its parser was fixed, and `cold Files … with project
  Files and directory Contents` is the Files-section test before the scope fence. Cowork's test files
  lag BL's; that drift is worth a separate pass.
