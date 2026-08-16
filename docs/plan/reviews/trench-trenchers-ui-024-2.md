# Re-review: trench-trenchers-ui-024

- Scope: current `dev/current` worktree paths owned by task 024, after the six fixes from review 024-1
- Date: 2026-08-13

## Findings

1. **P2 · blocking — A failed or emptied narrow-screen detail leaves Trenchers trapped with no
   Back action.** The responsive contract requires every below-720px person selection to switch to
   detail with a visible Back action and requires empty/error controls to remain reachable
   (`docs/features/trench-navigation-layout.md:97-117`; task contract
   `docs/plan/tasks/trench-trenchers-ui-024.md:42-47`). The store sets
   `detailPaneRequested = true` before the detail read succeeds
   (`src/renderer/coin/src/views/trenchers/trenchPerson.store.ts:128-131`), the workspace maps that
   flag directly to `trenchers--detail-open`
   (`src/renderer/coin/src/components/TrenchersWorkspace/TrenchersWorkspace.vue:2-6`), and the
   narrow CSS then hides the entire list
   (`src/renderer/coin/src/components/TrenchersWorkspace/TrenchersWorkspace.less:526-551`). But the
   Back button exists only inside the successful `store.detail` branch; both the initial-detail
   error branch and the no-detail/empty branch render before it
   (`src/renderer/coin/src/components/TrenchersWorkspace/TrenchPersonDetail.vue:2-31`). Therefore a
   failed row read—or a refresh/search that removes the selected person while the detail pane is
   requested—shows an error/empty detail with the list hidden and no way to return to another
   person. Keep Back reachable for every requested detail state (or reset the store presentation
   intent when no usable detail exists), and cover failed-read plus emptied-refresh narrow states.

2. **P2 · blocking — An older off-page preservation read can overwrite a newer search result and
   selection.** The list contract makes the left pane the query/cursor owner and requires selection
   to follow the current page unless a refresh is deliberately preserving an active person
   (`docs/features/trench-navigation-layout.md:69-80`; task verification
   `docs/plan/tasks/trench-trenchers-ui-024.md:50-53`). `loadPage` checks `listSequence` immediately
   after `listPersons`, but its off-page preservation branch then awaits an unfenced
   `getPerson(previousSelection)` and writes selection/detail without checking the sequence again
   (`src/renderer/coin/src/views/trenchers/trenchPerson.store.ts:376-421`). A delayed old
   `refresh(true)` can consequently resume after a newer `search()` has completed and replace the
   new query's selected/detail person with the old off-page person. An independent deferred-promise
   reproduction produced `query/pagePerson = new person` while `selected/detail = old person`.
   Fence every post-list asynchronous continuation with the active list/detail request identity
   and add a deterministic refresh-versus-search regression proving the latest intent wins.

3. **P3 · blocking — Pending profile and wallet-move modals remain dismissible by Escape, bypassing
   their pending guards.** Task 024 requires correct keyboard and conflict/error states, while the
   layout says a stale edit/link conflict stays open with its recovery action
   (`docs/plan/tasks/trench-trenchers-ui-024.md:46-47`;
   `docs/features/trench-navigation-layout.md:88-104`). Both new modals disable mask/close-button
   dismissal while pending but leave `esc-to-close` at the Arco default and provide no
   `on-before-cancel` veto
   (`src/renderer/coin/src/components/TrenchersWorkspace/TrenchPersonDetail.vue:128-158`). In the
   installed Arco implementation `escToClose` defaults to true, Escape calls `handleCancel`, and
   `handleCancel` emits `cancel` and then unconditionally closes unless `onBeforeCancel` rejects it
   (`node_modules/@arco-design/web-vue/es/modal/modal.vue_vue_type_script_lang.js:114-123,211-220,280-289`).
   Returning early from `closeEdit`/`closeMove` while pending cannot prevent that subsequent Arco
   close (`TrenchPersonDetail.vue:260-278`). Thus a conflict result can arrive behind a hidden edit
   dialog, and a confirmed membership mutation can finish behind a hidden move dialog. Bind Escape
   and before-cancel to the same pending fence and add a focused component/static regression.

## Six-fix re-verification

All six findings from `trench-trenchers-ui-024-1.md` are closed in the current source and are not
repeated above:

1. **Receiver-safe Arco path — closed.** The installed Arco menu emits one string key
   (`node_modules/@arco-design/web-vue/es/menu/base-menu.js:228-231`); the component binds that event
   to a closure created with the reactive navigation owner
   (`TrenchModuleNavigation.vue:3-11,31-37`), and the closure calls `navigation.select(key)` as a
   receiver-bearing member invocation (`trenchNavigation.store.ts:12-18`). The detached-dispatch
   regression proves BSC, Robinhood, and Trenchers (`tests/coin/unit/trenchNavigation.store.test.ts:34-47`).
2. **FE-1 profile flow — closed.** Draft initialization, normalization, changed-field calculation,
   editor-open revision pinning, CAS submission, conflict refresh, and rebase are store-owned
   (`trenchPerson.store.ts:137-209,355-374`). The SFC only binds fields/modal presentation and calls
   the store intent (`TrenchPersonDetail.vue:128-147,257-267`).
3. **FE-1 move flow — closed.** Canonical lookup, exact user-account filtering, ambiguity and
   already-owned rejection, source/target/revision capture, membership CAS, conflict refresh, and
   two-stage advance are store-owned (`trenchPerson.store.ts:212-343`). The SFC renders the
   candidate and calls one advance intent (`TrenchPersonDetail.vue:149-190,268-279`).
4. **Stable repeated address name — closed.** Every repeated copy control carries
   `name="trench__trenchers__wallet-address"`
   (`TrenchPersonDetail.vue:86-104`), and the static contract asserts it.
5. **FE-2 and mobile presentation ownership — closed.** `TrenchPersonList.vue` declares no business
   emit and sends the click intent directly to the store (`TrenchPersonList.vue:52-60,102-128`);
   `detailPaneRequested`, selection, and Back intent are store state/actions
   (`trenchPerson.store.ts:44-71,122-135`). Finding 1 is a state-completeness defect, not a return of
   the removed `personId` emit.
6. **TS-1 locale split and typed parity — closed.** The paired line counts are EN root/Coin/Trench
   `658/674/363` and ZH `645/658/363`; `zhCoin` and `zhTrench` are typed from their English peers,
   the root locales compose the paired modules, and `check:renderer-i18n` passes. Every reviewed
   touched/new TypeScript module is below 800 lines.

## Remaining contract evidence

- The source has one Arco vertical two-level rail in INDEX/SOL/BSC/Robinhood then
  Trenchers/All-traders order. Its store contains no client/emitter/network/storage boundary, and
  the INDEX workspace receives the selected chain rather than owning a second chain state.
- Header Refresh dispatches to the active INDEX or person store. Agent and GMGN Settings remain
  global 28px actions inside the unchanged 32px Royal Blue header.
- Person list reads remain cursor-paged and server-ordered. Anonymous, note preview, chain badges,
  wallet count, missing-profit `—`, `INDEX wallet sum`, stale-visible detail, typed errors, and
  merged-person redirect are represented without page-local profit sorting.
- Profile updates send changed optional fields only with the editor-open repository revision.
  Wallet movement searches only existing person-linked detail rows, accepts exactly one matching
  `user` account, shows source person/current membership, and submits wallet ID plus target
  revision/current-person CAS. Unknown, unattached, non-user, ambiguous, already-owned, partially
  unreadable, or stale inputs fail closed; no name merge, wallet/person creation, or transfer-aware
  profit claim was found.
- The new renderer paths contain no SQL/SQLite driver, direct HTTP/fetch, credential field, MCP
  write, or external scripted data acquisition. They retain the typed Trench XPC client and the
  content-free person-change event.
- Styles retain the 148px/112px independently scrolling rail, 38/62 wide master-detail split,
  internal list scrolling, shallow business classes, narrow list/detail switch, low-height rules,
  and Top-300 rank formatting. Ral's visual/interaction acceptance remains a separate manual gate.

## Code-review rule audit

### File list

| # | File | Problems |
|---|---|---:|
| 1 | `src/renderer/coin/src/App.vue` | 0 |
| 2 | `src/renderer/coin/src/App.less` | 0 |
| 3 | `src/renderer/coin/src/components/TrenchHeader/TrenchHeader.vue` | 0 |
| 4 | `src/renderer/coin/src/components/TrenchHeader/TrenchHeader.less` | 0 |
| 5 | `src/renderer/coin/src/components/TrenchIndexWorkspace/TrenchIndexWorkspace.vue` | 0 |
| 6 | `src/renderer/coin/src/components/TrenchIndexWorkspace/TrenchIndexWorkspace.less` | 0 |
| 7 | `src/renderer/coin/src/components/TrenchModuleNavigation/TrenchModuleNavigation.vue` | 0 |
| 8 | `src/renderer/coin/src/components/TrenchModuleNavigation/TrenchModuleNavigation.less` | 0 |
| 9 | `src/renderer/coin/src/components/TrenchersWorkspace/TrenchersWorkspace.vue` | 0 |
| 10 | `src/renderer/coin/src/components/TrenchersWorkspace/TrenchPersonList.vue` | 0 |
| 11 | `src/renderer/coin/src/components/TrenchersWorkspace/TrenchPersonDetail.vue` | 0 |
| 12 | `src/renderer/coin/src/components/TrenchersWorkspace/TrenchersWorkspace.less` | 0 |
| 13 | `src/renderer/coin/src/views/navigation/trenchNavigation.runtime.ts` | 0 |
| 14 | `src/renderer/coin/src/views/navigation/trenchNavigation.store.ts` | 0 |
| 15 | `src/renderer/coin/src/views/trenchers/trenchPerson.client.ts` | 0 |
| 16 | `src/renderer/coin/src/views/trenchers/trenchPerson.runtime.ts` | 0 |
| 17 | `src/renderer/coin/src/views/trenchers/trenchPerson.store.ts` | 0 |
| 18 | `src/renderer/common/i18n/en.ts` | 0 |
| 19 | `src/renderer/common/i18n/enCoin.ts` | 0 |
| 20 | `src/renderer/common/i18n/enTrench.ts` | 0 |
| 21 | `src/renderer/common/i18n/zh.ts` | 0 |
| 22 | `src/renderer/common/i18n/zhCoin.ts` | 0 |
| 23 | `src/renderer/common/i18n/zhTrench.ts` | 0 |
| 24 | `tests/coin/unit/trenchNavigation.store.test.ts` | 0 |
| 25 | `tests/coin/unit/trenchPerson.store.test.ts` | 0 |
| 26 | `tests/coin/run-unit.mjs` | 0 |
| 27 | `scripts/coin/trench-index-layout.test.mjs` | 0 |
| 28 | `tests/omni/trenchOmniEmbedding.test.mjs` | 0 |

No open **TS-1**, **TS-2**, **FE-1**, or **FE-2** rule violation was found. The three findings are
product-contract defects outside the narrow TS/FE catalog.

## Verification evidence

- `node tests/coin/run-unit.mjs` — **pass**, 167/167.
- `node --test scripts/coin/trench-index-layout.test.mjs` — **pass**, 18/18 before and after the
  fresh build.
- `yarn vue-tsc --noEmit -p tests/coin/tsconfig.trench-renderer.json --composite false` — **pass**.
- `yarn check:renderer-i18n` — **pass**.
- Focused ESLint over the 024 Vue/TS/locale/tests — exit **0**, 0 errors; 410 existing formatting
  warnings, and no zero-warning delivery gate is configured.
- `yarn build` through the repository DEBUG_DEV wrapper — **pass**, version code `260813155644`.
- `node --test tests/omni/trenchOmniEmbedding.test.mjs` after the fresh build — **pass**, 6/6.
- `git diff --check` — **pass** before and after the build.
- Read-only in-memory esbuild/deferred-promise reproduction of finding 2 — **reproduced**: the final
  query/page selected the new person while store selection/detail reverted to the old person.

## Safety and scope

- No Electron/browser E2E, browser automation, screenshot, or visual automation ran.
- No `DEBUG_PROD` command/process/profile, provider, live database, MCP, or production record was
  read or mutated. The DEBUG_DEV build did not launch the application.
- This Verify delivery authors only this new review file. It does not edit product code, task/result
  state, README, or the prior review, and it preserves all unrelated dirty worktree changes.

## Conclusion

**blocked** — the six original review findings are closed, but task 024 is not deliverable while
narrow error/empty detail can trap the user, stale refresh continuations can override a newer
search, and pending mutation modals can be dismissed by Escape. A Develop fix and fresh independent
re-verification are required; Ral's later visual/interaction acceptance remains intentionally
outside this review.
