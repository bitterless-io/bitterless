---
id: motto-inline-edit-reorder-116
scope: omni-motto
status: done
depends-on: [motto-miniapp-001]
---

# Objective

Replace Motto's Add/Edit modal with direct card Title and Subtitle editing, make Add create and
focus a Title draft, compact every card to `8px` padding with no left rule and two-line ellipsis,
and persist drag reordering through the existing whole-array localStorage boundary.

# Context

- `docs/features/motto.md`
- `docs/plan/analysis/motto.md`
- `docs/design/colors.md`

# Path

- `docs/INDEX.md`
- `docs/design/colors.md`
- `docs/features/motto.md`
- `docs/plan/README.md`
- `docs/plan/analysis/motto.md`
- `docs/plan/tasks/motto-inline-edit-reorder-116.md`
- `src/renderer/motto/src/App.vue`
- `src/renderer/motto/src/App.less`
- `src/renderer/motto/src/store/motto.store.ts`
- `src/renderer/common/i18n/en.ts`
- `src/renderer/common/i18n/zh.ts`
- `tests/motto/mottoIntegration.test.mjs`
- `tests/motto/mottoStorage.test.mjs`

# Verification

- Verify Header and empty-state Add create one UI-only trailing item and focus its Title editor;
  the item reaches storage only after its trimmed Title becomes non-empty.
- Verify clicking a persisted Title or Subtitle activates only that inline editor. `Enter` and blur
  persist valid changes, `Esc` restores existing content, an empty existing Title restores its old
  value, and Subtitle can be persisted as an empty string.
- Verify a failed Add/Edit write keeps the last persisted collection unchanged and leaves the draft
  available for retry.
- Verify the Edit menu option and Add/Edit modal no longer exist while the Delete dropdown remains.
- Verify every card has `8px` padding, no left accent or pseudo-element, and display-mode Title and
  Subtitle each clamp to at most two lines with an ellipsis.
- Verify dragging persisted cards by an explicit handle creates one complete reordered array,
  preserves each item unchanged, writes before reactive state commit, and retains the old order on
  failure. Disable dragging while an inline editor is active.
- Run `yarn test:motto`, `yarn check:renderer-i18n`, scoped ESLint, Node/Web type checks, `yarn build`,
  and `git diff --check`. Record unrelated baseline failures precisely. Do not run Electron E2E.

# Delivery Evidence

- Implemented UI-only Add drafts, direct Title/Subtitle editing, Delete-only card actions, compact
  two-line cards, and handle-based persistent ordering.
- [Independent review 1](../reviews/motto-inline-edit-reorder-116-1.md) passed with no finding.
- `yarn test:motto` passed 21/21; scoped ESLint, Node typecheck, Motto-scoped Web typecheck, and
  `git diff --check` passed.
- Global renderer i18n, Web typecheck, and build remain blocked by task-external dirty-worktree
  failures recorded in review 1; no diagnostic names a Motto path.
- Electron E2E and packaged-app smoke were not run by repository rule.
