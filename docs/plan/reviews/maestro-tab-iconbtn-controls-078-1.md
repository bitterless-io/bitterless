# maestro-tab-iconbtn-controls-078 — Review 1

- Date: 2026-08-31
- Scope: independent review of the current-worktree implementation against
  `docs/plan/tasks/maestro-tab-iconbtn-controls-078.md`.
- Method: task/design/source/diff inspection, focused source-contract test, targeted ESLint and
  Prettier checks, and task-scoped `git diff --check`. Electron, Playwright/E2E, packaged smoke,
  and application launch were not run.

## Findings

- **P1 · blocking:** None.
- **P2 · blocking:** None.
- **P3 · non-blocking:** None.

## Requirements evidence

| Requirement | Evidence | Result |
|---|---|---|
| Both tab actions consume the real shared primitive | `MenuBar.vue:9-22` imports Tabler `IconPlus`/`IconX` and the existing shared `IconBtn`. The close and New-tab actions are `IconBtn` instances at `MenuBar.vue:161-172,185-194`; no action-local clone of the Arco wrapper or shared styles was introduced. `IconBtn.vue:5-18` keeps `inheritAttrs: false`, forwards the action classes, ARIA attributes, drag attribute, and listeners through `$attrs`, and renders the shared Arco `Button` with `html-type="button"`. The shared file has no task diff. | pass |
| Real SVG glyphs replace font-baseline symbols | The close slot renders Tabler `IconX` at 14px and the New-tab slot renders Tabler `IconPlus` at 16px (`MenuBar.vue:171,192`), both with explicit stroke and `aria-hidden`; each enclosing `IconBtn` retains its localized `aria-label`. No raw multiplication character or raw `button` for either tab action remains, as also guarded by `maestroTabIconButtons.test.mjs:21-51`. | pass |
| Shared IconBtn interaction and centering styles genuinely apply | The forwarded action class and `IconBtn`'s own `icon-btn` class reach Arco's root `.arco-btn`. The component-scoped selectors use the required three-class qualification (`MenuBar.less:69-93`), so they override the shared 32px geometry without replacing shared behavior. The primitive still owns no-drag, transitions, `:active` scale, `:focus-visible`, and the `.arco-btn-icon` inline-flex centering (`IconBtn.less:1-41`). Local hover rules only restore the established Royal Blue contrast and no local active transform masks the shared pressed scale. | pass |
| Exact `20 × 20px` close geometry, visibility, and transform-safe centering | The close selector fixes width, minimum width, height, and flex basis to 20px, keeps `right: 4px`, and uses `top: 4px` inside the unchanged 28px tab (`MenuBar.less:37-51,69-82`). That leaves four pixels above and below while avoiding the former `translateY(-50%)`, which would conflict with the shared `transform: scale(0.95)`. It remains `display: none` until the tab is hovered or the close action has the active-tab modifier, where it becomes `inline-flex` (`MenuBar.less:73,84-87`). | pass |
| Exact `28 × 28px` New-tab geometry | The existing wrapper remains 28px, centered, non-shrinking, and outside the compressible tab list (`MenuBar.vue:182-194`; `MenuBar.less:91`). Its qualified `IconBtn` override fixes width, minimum width, height, and flex basis to 28px while retaining the established circular shape and strip colors (`MenuBar.less:92-93`). | pass |
| Close click, locked width, drag suppression, and New-tab creation are preserved | The task diff leaves the locked-width state and `onCloseClick` logic intact (`MenuBar.vue:71-82`). The converted close action retains `v-if="!tab.pinned && tabStore.tabs.length > 1"`, active visibility, `draggable="false"`, `@click.stop="onCloseClick($event, tab.id)"`, and `@dragstart.stop.prevent` (`MenuBar.vue:161-172`). The converted New-tab action retains its wrapper and `@click="tabStore.newTab()"` (`MenuBar.vue:185-194`). Shared `IconBtn` forwards these listeners/attributes to Arco, whose click event carries the original `MouseEvent`, so `currentTarget.parentElement` still resolves the tab used for width locking. | pass |
| Existing tab/favicon/loading/label behavior is untouched | Outside comments and the two action replacements, the focused Vue diff does not alter initialization, activation, context menu, reorder handlers, tab width classes, locked-width style, 16px favicon/loading slot, label computation/ellipsis, pinned behavior, divider, or recording slot (`MenuBar.vue:37-100,119-209`). | pass |
| Task 077 geometry and shape remain intact | The MenuBar parent remains 84px, the strip remains 36px with 4px top / 3px bottom padding and its 1px divider, tabs and row wrappers remain 28px, and the address row remains 48px (`MenuBar.less:1-45,89-100`). Four-corner 6px tab radii, centered tab-list/divider/New-tab/capture wrappers, 78px macOS gutter, existing widths, and state colors also remain (`MenuBar.less:24-60,89-95`). Task 078 introduces no native-window source change, so Task 077's reviewed traffic-light adjustment is outside and unaffected by this diff. | pass |
| Focused regression contract | `tests/maestro/maestroTabIconButtons.test.mjs` checks the real shared import, both Tabler glyphs, absence of the raw symbol/buttons, close/New-tab event wiring, high-specificity 20/28px overrides, `display: none` plus hover/active reveal, transform-safe `top: 4px`, shared SVG centering, pressed scale, and keyboard focus. `node --test tests/maestro/maestroTabIconButtons.test.mjs` passed 3/3. | pass |

## Verification

- Focused source-contract test: **passed, 3/3**.
- Targeted ESLint on `MenuBar.vue` and the focused test: **exit 0, no errors**. It reported 49
  Prettier warnings in the long-standing `MenuBar.vue` formatting baseline.
- Targeted Prettier check: the new focused test passes; `MenuBar.vue` and `MenuBar.less` report
  formatting drift. Both corresponding `HEAD` files are already Prettier-nonconforming, so this is
  recorded as the unrelated file baseline rather than an implementation finding; no broad
  formatting rewrite was made.
- Task-scoped `git diff --check`: **passed after this review was created**.
- Electron, Playwright/E2E, packaged smoke, and application launch: **not run**, as required. Ral
  owns final visual acceptance of optical centering in the real window.

## Conclusion

**pass — no blocking or non-blocking findings.**

The current implementation uses the shared `IconBtn` end to end for both tab actions, preserves
the exact 20px/28px action geometry and every existing tab interaction, and keeps Task 077's
36px/28px/48px/84px chrome contract intact. The source and focused test establish the CSS and event
contracts; real-window optical acceptance remains with Ral.
