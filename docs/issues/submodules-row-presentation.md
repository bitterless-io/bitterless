# Submodules row repeats the path and carries meaningless chrome

Status: fixed; owner verification pending

Feature: [Submodules mini app](../features/submodules.md)

## Report

1. Every Submodules row shows the same string twice: the title reads
   `projects/ai-scribe-eval-pipeline` and the subtitle underneath reads
   `projects/ai-scribe-eval-pipeline`. The title should carry only the submodule directory name and
   leave the relative path to the subtitle.
2. The row border adds nothing in either the resting or the hovered state, and the green left state
   dot carries no information the row does not already show.
3. The row packs identity, branch, warning, and action into one line. Owner-specified layout: line 1
   is the project name on the left with branch, commit, and the Open action on the right; line 2 is
   the relative path on the left with the `differs from .gitmodules` warning on the right. The Open
   action drops its `WebStorm` label and keeps the icon only, with the shared `IconBtn` treatment.

## Confirmed cause

`SubmoduleRow.vue` rendered `entry.name`, which the scanner fills from the `.gitmodules` section name
(`src/main/submodules/submoduleScanner.service.ts` — `name: section.name`). In this workspace every
section is declared as `[submodule "projects/<dir>"]`, so the section name is already the path and the
identity block printed it twice. The documented layout in
[features/submodules.md](../features/submodules.md) always specified a bare directory name on the
title line, so this was implementation drift, not a contract change.

The chrome is a design correction rather than a defect: the state dot duplicated the branch tag,
the mismatch warning, and the entry error, and the per-row border boxed a list that a hover tint and
an 8px gap already separate.

## Fix contract

- The row title is the leaf directory of the declared path, falling back to the section name when a
  section declares no path, so a row is never blank.
- The subtitle keeps the full declared relative path unchanged.
- The scanner keeps reporting the raw `.gitmodules` section name; the derivation is display-only and
  shared, so both hosts (standalone window and Omni cell) show the same title.
- No row carries a border in any state, and the state dot is removed. Remaining row-level state
  affordances: the hover background tint and the `missing`/`error` background. Per-entry state stays
  visible through the branch tag, the mismatch warning, and the entry error text.
  **Amended 2026-08-20 (owner):** the hover tint is dropped too — the row does not react to hover at
  all, and the `missing`/`error` background is the only row-level affordance left.
- A row is two lines. Line 1: directory name (left) · branch tag, short commit, Open action (right).
  Line 2: declared relative path (left) · mismatch warning and entry error (right). Neither warning
  appears on line 1, and neither the branch tag nor the action appears on line 2.
- The Open action is the shared `IconBtn` (icon-only, `type="text"`, hover fill) and keeps its
  accessible name through `title` and `aria-label`, so removing the visible label costs no
  screen-reader or tooltip affordance.

## Acceptance

- `projects/ai-scribe-eval-pipeline` renders as title `ai-scribe-eval-pipeline`, subtitle
  `projects/ai-scribe-eval-pipeline`.
- A resting and a hovered row both render without a border, and no row renders a state dot.
- A mismatched submodule shows `differs from .gitmodules` at the right end of line 2, never beside the
  branch tag on line 1.
- The Open action renders as an icon with no text and still exposes the `WebStorm` name on hover.
- `node --test tests/submodules/*.test.mjs` passes, covering the derivation, the two-line split, the
  icon-only action, and the removed chrome.
- `yarn typecheck` passes.

## Resolution

`submoduleDisplayName(entry)` in `src/shared/submodules/submodules.type.ts` derives the leaf directory
from `entry.path` (fallback `entry.name`), and `SubmoduleRow.vue` binds line 1 to that computed value
while line 2 binds `entry.path`. The `submodule-row__state-dot` element and all its LESS rules are
gone, and `SubmoduleRow.less` declares no `border` in the resting, hover, `missing`, or `error` state.

The row is now a column of two `submodule-row__line` flex lines: `submodules__row__primary` carries
the name plus the branch group (tag, commit, `IconBtn`), and `submodules__row__secondary` carries the
path plus `submodules__row__warning` (mismatch tooltip, entry error). The Open action is
`@renderer/common/components/IconBtn/IconBtn.vue` shrunk to 26px through
`.submodule-row__open.icon-btn.arco-btn`. Covered by `tests/submodules/submoduleRowIdentity.test.mjs`.
Remaining step is Ral's visual check in the running app.
