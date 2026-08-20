---
id: submodules-list-controls-063
scope: give the Submodules list a settings gear with a default-on differ-first switch, plus a controls row carrying a case-insensitive search and a name/recent sort selector
status: implemented; owner verification pending
verify: node --test tests/submodules/*.test.mjs && yarn check:renderer-i18n && yarn build
---

# Submodules list controls

## Objective

Make a 30-row submodule list navigable without scrolling it:

1. A **settings gear** in the menu bar holding one switch — **Show differ on top**, default **on** —
   which lists every submodule whose branch differs from `.gitmodules` before all other rows, each
   group ordered by project name in ASCII.
2. A **controls row** under the root summary carrying a case-insensitive **search** (EyesOnAgents
   matching semantics, focused by `Cmd+F` / `Alt+F` / `Ctrl+F`, placeholder stating the platform
   shortcut) and a **label-free sort selector** offering `Name` and `Update time`, whose dropdown
   shows each option in full.

## Context

- [Submodules mini app](../../features/submodules.md) contracts #7 and #8 are the contract this task
  implements; read them before changing any behavior here.
- Owner request 2026-08-20, including the explicit performance question about watching directory
  contents. Answered in contract #8: a bounded five-`stat` Git-state probe, never a recursive
  working-tree watch.

## Decisions

- **Main sorts, the renderer filters.** Order belongs to the snapshot so the standalone window and
  every Omni cell agree; search is per-view because it is a lookup, not a setting.
- **Controls persist beside the root** (`key = submodules_workspace`, `sub_key = view`) and ride the
  existing `submodules/snapshot` broadcast, so no second event and no second SQLite key were added.
  A stored row is sanitized field by field, so an older or hand-edited value cannot break the list.
- **ASCII, not `localeCompare`.** The owner asked for ASCII order on the project name; locale
  collation would fold case and put `alpha` before `Zed`.
- **`changedAt` is Git-state mtime**, newest of `<dir>`, `HEAD`, `index`, `packed-refs`, `refs`. It is
  in the snapshot fingerprint, and `HEAD`/`index` live inside the already-watched Git directory, so
  `updated` order reorders about 200ms after a commit, checkout, or `add` — measured, not assumed.
  Only a top-level file add/remove in a working tree waits for the 10-second safety poll.
- Settings switch has no local default: `createDefaultSubmodulesViewSettings()` is the only source,
  so the default cannot drift between Main and the popover.
- **Shortcut accepts three modifiers.** Chat's own search uses `Alt+F` on Windows while every other
  Windows list uses `Ctrl+F`; rather than pick one, `Cmd`/`Ctrl`/`Alt` + `F` all focus the box. The
  placeholder advertises one combo per platform (`⌘F` / `Alt+F`) so the 480px row stays readable.
  Matching leads with `event.code`, since macOS `Option+F` emits `key === 'ƒ'`.

## Verification

- `node --test tests/submodules/*.test.mjs` — 37 tests. `submoduleOrder.service.test.mjs` covers the
  default grouping, ASCII case order, the switch off, recent order with undated rows last, both
  controls composed, non-mismatch shapes (detached, unpinned), input immutability, and a guard that
  the service's inlined mismatch/display-name mirrors still agree with the shared helpers.
  `submodulesListControls.test.mjs` covers the controls row, the tokenizer, snapshot/persistence
  wiring, the gear popover, the filtered list with its empty-result escape, and both languages.
- `yarn check:renderer-i18n` ok, `yarn lint` clean for the touched trees, `yarn typecheck:node` and
  `yarn typecheck:web` report nothing for these files, `yarn build` succeeds.
- E2E not run (project rule: never on the agent's initiative).

## Owner verification

- Gear → switch is on by default; turning it off drops the differ group and leaves pure name order.
- Sort → `Update time` puts the repository last worked in at the top, and the dropdown shows both
  option labels without clipping.
- `Cmd+F` (and `Alt+F` / `Ctrl+F`) focuses the search box from anywhere in the view, and the
  placeholder reads `搜索 (⌘F)` on this machine. Typing `mono`, `MONO`, or `micromeet mono` all match
  `projects/micromeet-mono`; `Esc` clears it and keeps focus.
- The count reads `visible/total` while filtering.
- A control flipped in the standalone window reorders the Omni cell too.
