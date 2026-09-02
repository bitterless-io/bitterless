---
task: motto-inline-edit-reorder-116
review: 1
status: passed
---

# Motto inline edit and reorder independent review 1

## Result

Passed with no P1, P2, or P3 finding. No blocking or non-blocking finding was identified.

## Findings

None.

## Requirements evidence

| Requirement | Evidence | Result |
|---|---|---|
| UI-only Add draft and Title focus | `src/renderer/motto/src/store/motto.store.ts:42-57` creates one `pendingDraft`, activates only its Title editor, and performs no persistence. Repeated Add while that draft is active reuses it. `src/renderer/motto/src/App.vue:32-45,131-171,212-218` renders the draft after the persisted draggable collection and focuses the exposed Arco Input on the next Vue tick. The installed Arco Input exposes a public `focus()` method at `node_modules/@arco-design/web-vue/es/input/input.js:314-318`. | pass |
| Required Title, optional Subtitle, Enter, blur, and Esc | `src/renderer/motto/src/App.vue:49-96,138-167` gives persisted Title and Subtitle separate clickable targets and conditionally renders only the selected inline editor. Both editors bind Enter, blur, and Esc. `src/renderer/motto/src/store/motto.store.ts:79-125` trims values, discards an empty new Title, restores an empty existing Title by leaving the persisted item unchanged, permits an empty Subtitle, and cancels without mutating an existing item. | pass |
| Failed Add/Edit persistence and write-before-commit | `src/renderer/motto/src/store/motto.store.ts:91-95,112-117,167-182` produces a complete next array, calls `persistMottoItems`, and assigns `items` only after the write returns. A failed write leaves `items`, `pendingDraft`, editor identity, and `draftValue` available for retry. Dynamic coverage at `tests/motto/mottoIntegration.test.mjs:161-283` verifies old-state observation during writes, failed reorder/edit retention, empty-title restoration/discard, optional empty Subtitle, and failed Add retry. | pass |
| Complete persistent drag reorder | `src/renderer/motto/src/App.vue:33-45,99-109,232-234` uses an explicit handle, immutable `modelValue`, stable `id` key, and one complete emitted array. `src/renderer/motto/src/store/motto.store.ts:134-154` rejects active editing, length changes, missing/duplicate IDs, and changed fields before persisting the complete reordered array. The installed `vuedraggable` implementation copies `modelValue`, restores the original DOM position, then emits the reordered copy (`node_modules/vuedraggable/dist/vuedraggable.common.js:4873-4883,4970-4983`), so a rejected/failed Store write retains the old rendered order. | pass |
| Editing disables dragging | `src/renderer/motto/src/App.vue:40-43,100-109` disables both Sortable and the explicit handle whenever the Store reports an active inline editor; `src/renderer/motto/src/store/motto.store.ts:23-25,134-136` independently rejects reorder intent during editing. | pass |
| Compact two-line presentation | `src/renderer/motto/src/App.less:103-113` applies exact `8px` card padding with no left accent or pseudo-element. `App.less:135-167` applies two-line WebKit clamping, hidden overflow, ellipsis, long-token wrapping, strong-red Title, and muted-red Subtitle to display targets. The updated contract is consistent at `docs/features/motto.md:83-96` and `docs/design/colors.md:66-75`. | pass |
| Delete-only menu and no modal | `src/renderer/motto/src/App.vue:110-126` contains one dropdown option, Delete. The Motto renderer contains no `a-modal`, `a-form`, pencil icon, modal editor state, or Edit-menu call. The UI contract at `docs/features/motto.md:98-104` matches the implementation. | pass |
| Documentation and localization | `docs/INDEX.md:219-220`, `docs/features/motto.md`, `docs/plan/analysis/motto.md:5-18`, and `docs/design/colors.md:66-75` consistently describe direct editing, UI-only draft ownership, no left rule, and persisted ordering. The new drag-handle accessible label exists in both English and Chinese at `src/renderer/common/i18n/en.ts:598` and `src/renderer/common/i18n/zh.ts:592`. | pass |

## Verification

- `yarn test:motto`: passed, 21/21 tests.
- Scoped ESLint for `App.vue`, `motto.store.ts`, and both Motto test files: passed.
- `yarn typecheck:node`: passed.
- `git diff --check`: passed.
- `yarn check:renderer-i18n`: blocked by the task-external existing assertion `Tray must follow Home creation`; the check still searches for the retired literal `trayHelper.init(mainWindowHelper)` while current unchanged startup code passes a callback object at `src/main/app.main.ts:534-548`.
- `yarn typecheck:web`: blocked by task-external existing errors in Poker GTO tests, Connector/Home/Maestro/Omni renderers, and `src/shared/pathHelper/main/pathMain.helper.ts`; no diagnostic names a Motto path.
- `yarn build`: blocked before renderer compilation by a concurrent task-external OnlyPreview change: `src/main/app.main.ts:62` imports `openOnlyPreviewAbsoluteTarget` from `src/main/xpc/onlyPreview.handler.ts`, while the current dirty handler imports rather than re-exports that symbol.
- Electron E2E and packaged-app smoke were not run, per repository and task instructions.

## Conclusion

**Pass.** The current task-scoped implementation satisfies the documented inline editing, compact
card, failure retention, and persistent ordering contracts. The three incomplete global gates are
caused by existing or concurrent changes outside this task's paths and do not identify a Motto
defect.
