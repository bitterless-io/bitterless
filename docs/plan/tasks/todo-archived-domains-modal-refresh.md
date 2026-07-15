---
id: todo-archived-domains-modal-refresh
scope: Todo archived domains modal
status: done
depends-on: [renderer-arco-bem-controls]
---

# Todo Archived Domains Modal Refresh

## Objective

Bring the Archived domains modal into the compact Arco contract used by the rest of Bitterless,
make loading the archive list explicit and reliable, and let the user restore an archived domain.

## Layout contract

```text
┌──────────── Arco modal (viewport-safe width) ────────────┐
│ Archived domains                                       x│ native Arco close
├──────────────────────────────────────────────────────────┤
│ [search archived domains...]                            │ fixed toolbar
│ ┌──────────────────────────────────────────────────────┐ │
│ │ archive  Domain title                      [Restore] │ │
│ │          Archived at ...                             │ │
│ │          Optional description                       │ │
│ ├──────────────────────────────────────────────────────┤ │
│ │ ...                                                  │ │ scroll owner
│ └──────────────────────────────────────────────────────┘ │
│ Empty / no-match state when there are no visible rows   │
└──────────────────────────────────────────────────────────┘
```

## Contract

- Use the global compact Arco modal header and native close affordance from
  `src/renderer/common/assets/style/arco/modal.less`; do not add an eyebrow, oversized title,
  content-level close button, tinted full-body surface, or card grid.
- Use the Royal Blue palette documented in `docs/design/colors.md`. The toolbar and list use a
  12px gap, while repeated domains form one bordered list with row separators instead of individual
  cards. The search toolbar stays fixed and only the domain list scrolls.
- Keep title/description filtering and reset the search query when the modal closes.
- Each archived row exposes Restore. The request has a row-local loading state, updates active and
  archived domain state on success, and shows localized success/failure feedback. Permanent delete
  remains outside this modal.
- Restore and create writes enforce the 17-active-domain limit inside their SQLite statements so
  stale windows cannot exceed the cap. A successful database restore remains a success if follow-up
  reads fail; only the restored domain is reconciled incrementally, existing board state is retained,
  and a cross-window refresh is broadcast.
- Use an Archive icon, an accessible label, and a visible loading state on the Todo menu trigger.
  Loading failures show a localized error and do not open a stale modal.
- Keep English and Chinese loading and restore feedback synchronized without overwriting other
  in-progress localization edits.

## Paths

- `src/renderer/todo/src/components/ArchivedDomainsModal/`
- `src/renderer/todo/src/components/MenuBar/MenuBar.vue`
- `src/renderer/common/i18n/en.ts`
- `src/renderer/common/i18n/zh.ts`
- `docs/plan/reviews/todo-archived-domains-modal-refresh-1.md`

## Verification

- Run a focused source contract check for one native modal header, Royal Blue colors, responsive
  sizing, accessible archive trigger, and list-loading state.
- Run the applicable renderer TypeScript/build checks and `git diff --check`.
- Inspect the modal at compact Todo-window dimensions and confirm search, list-only scrolling,
  restore loading/success/failure, empty-state, Escape, mask-close, and native close behavior.

## Result

Completed and independently reviewed in
[`todo-archived-domains-modal-refresh-2.md`](../reviews/todo-archived-domains-modal-refresh-2.md).
The modal now uses the standard compact Arco shell, keeps search fixed while the domain list scrolls,
and exposes a row-local Restore action. Create and restore writes share a database-enforced 17-active
domain cap, while restore reconciliation updates only the affected domain and preserves the rest of
the board when a follow-up read fails.
