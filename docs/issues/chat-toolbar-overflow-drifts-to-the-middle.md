# The chat toolbar's `…` drifts to the middle, and Session tabs is hidden

**Status:** 🔧 Fixed — 2026-09-18, owner verification pending
**Reported:** 2026-09-18 (Ral), with a screenshot of the Maestro/Cowork chat toolbar
**Area:** `ChatPanel.vue` toolbar — bitterless `src/renderer/maestro/control/src/`, micromeet-cowork
`apps/cowork/src/renderer/control/src/`

## What Ral asked for

> session tabs 先隐藏 …距离右侧 new chat icon 应该只有 8px 靠在一起

Two things: hide the *Session tabs* control for now, and put the `…` overflow trigger 8px from the
`+` New chat button instead of stranded in the middle of the bar.

## Why `…` was in the middle

The toolbar is `justify-content: space-between`, and its own comment already said it **only works
with two children** — the left sessions group and New chat. It had grown to four:

```
[sessions group]   [AgentBrowserTabs]   [… Dropdown]   [+ New chat]
```

`space-between` distributes the free space *between* every pair, so the two middle children get
pushed to even thirds. The `gap: 8px` on the bar is irrelevant here: with free space to distribute,
`space-between` decides the spacing and the gap is only a floor.

So this is not a spacing bug — raising or lowering the gap could never have fixed it. The fix is to
restore the two-child invariant by grouping `…` and `+`:

```
[sessions group]                                    [… +]   ← one child, gap: 8px inside
```

## Change

- **Hidden, not deleted.** `<AgentBrowserTabs>` is commented out in both templates, and so is its
  `import` — leaving the import alone turns `noUnusedLocals` into a build error, so the two edits are
  a pair. The component, its store and its i18n keys are untouched; restoring it is uncommenting two
  lines per app.
- **New `chat-panel__toolbar-actions` group** holds `…` and `+` with an 8px gap. bitterless styles it
  in `ChatPanel.less`; cowork uses `flex shrink-0 items-center gap-2` plus the same BEM class, per the
  workspace rule that a Tailwind-styled node still carries a business class so it stays greppable.
- No borders added anywhere; the icon buttons stay borderless.

## Verification

- `yarn build` green in both apps (renderer compiles, no unused-import error).
- `yarn typecheck:web` (bitterless) and `yarn typecheck` (cowork) report only their pre-existing
  errors — 29 and 19 respectively, none in `ChatPanel.vue` or `AgentBrowserTabs.vue`.
- No Electron/Playwright/E2E run. The visual result needs Ral's eye.
