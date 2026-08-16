# Review: trench-trenchers-ui-024

- Scope: current `dev/current` worktree paths owned by task 024
- Date: 2026-08-13

## Findings

1. **P1 · blocking — Every Arco menu-item click loses the navigation-store receiver, so the new
   module rail cannot switch chain or open Trenchers.** The layout contract requires the one Arco
   rail to own INDEX chain selection and the Trenchers route
   (`docs/features/trench-navigation-layout.md:16-26`; task contract
   `docs/plan/tasks/trench-trenchers-ui-024.md:38-41`). The template passes the class method as a
   bare handler (`src/renderer/coin/src/components/TrenchModuleNavigation/TrenchModuleNavigation.vue:3-12`),
   while that method writes through `this` (`src/renderer/coin/src/views/navigation/trenchNavigation.store.ts:24-27`).
   Vue's compiler lowers the binding to `onMenuItemClick: _ctx.navigation.select`; component-event
   dispatch invokes that detached function, so `this` is `undefined` and the first supported click
   throws before changing `selectedKey`. The focused unit test calls `store.select(...)` as a bound
   property access and therefore does not cover the real event path. Wrap the event in an inline
   call (or otherwise bind it) and add a component/event-boundary regression that proves BSC,
   Robinhood, and Trenchers selections actually update the rendered owner.

2. **P2 · blocking — Profile editing and wallet-move workflow orchestration remains in the Vue
   component instead of the Trenchers store.** The layout contract says stores own reads,
   selection, cursor state, and mutations while components bind/render only
   (`docs/features/trench-navigation-layout.md:119-133`). `TrenchPersonDetail.vue` owns draft
   normalization, changed-field calculation, editor revision pinning, conflict rebasing, and the
   lookup-versus-confirm move state machine around XPC-backed store calls
   (`src/renderer/coin/src/components/TrenchersWorkspace/TrenchPersonDetail.vue:216-225,260-320`).
   This also violates **FE-1**. Move this business state progression into the paired
   `trenchPerson.store.ts` (or a paired business store) so the SFC binds fields and invokes one
   store action per user intent; keep component-only visibility/focus presentation local where it
   has no business effect.

3. **P3 · blocking — The repeated wallet-address copy control has no stable `name`.** Task 024
   explicitly requires stable names, and the layout requires them on every structural and repeated
   control (`docs/plan/tasks/trench-trenchers-ui-024.md:46-47`;
   `docs/features/trench-navigation-layout.md:132-133`). The repeated address button has only a
   class and accessible labels
   (`src/renderer/coin/src/components/TrenchersWorkspace/TrenchPersonDetail.vue:86-103`). Add one
   business-stable name such as `trench__trenchers__wallet-address` and make the static contract
   assert it.

4. **P3 · blocking — A business list component emits a person identifier to its parent.**
   `TrenchPersonList.vue` declares and emits `select(personId)`, which the parent converts into
   selection plus mobile-detail state
   (`src/renderer/coin/src/components/TrenchersWorkspace/TrenchPersonList.vue:50-58,109-111`;
   `src/renderer/coin/src/components/TrenchersWorkspace/TrenchersWorkspace.vue:12-15,27-31`). This
   violates **FE-2**. Let the business store own the selected-person intent and expose presentation
   state the workspace can bind, without passing the domain identifier through a component emit.

5. **P3 · blocking — The touched English locale module is 1,690 lines.** This violates **TS-1**
   (`src/renderer/common/i18n/en.ts:1-1690`). Split locale business modules behind the existing
   typed locale export so no TypeScript module exceeds 800 lines.

6. **P3 · blocking — The touched Chinese locale module is 1,658 lines.** This violates **TS-1**
   (`src/renderer/common/i18n/zh.ts:1-1658`). Apply the same typed module split as English and keep
   the locale-tree parity check intact.

## Contract evidence

- The source otherwise has one local navigation store, one Arco two-level rail in the documented
  INDEX/SOL/BSC/Robinhood then Trenchers/All-traders order, and no INDEX-local chain tab owner.
  `TrenchIndexWorkspace` receives the selected chain and retains explicit-chain Add behavior.
- Person list pages preserve the repository's authoritative `updated_at DESC, person_id ASC`
  order; no renderer sort or global-profit-leaderboard claim was found. Anonymous, missing-profit,
  empty, stale-visible detail, and typed error states are explicit.
- Cursor staleness restarts at page one; refresh preserves an active off-page selection; a merged
  identifier is resolved through `getPerson` and replaces the selected ID with the survivor.
- Profile mutations carry the editor-open revision and refresh current data on conflict. Wallet
  movement canonicalizes chain plus address, searches already person-linked details, accepts one
  exact `user` chain account, shows source person and membership source, and submits wallet ID plus
  expected revision/current person. Unknown, unattached, non-user, ambiguous, already-owned, or
  partially unreadable matches fail closed.
- List/detail profit is labelled `wallet-sum-v1` / INDEX wallet sum and explicitly not
  transfer-aware. No page-local profit sort or fabricated transfer-aware calculation was found.
- The reviewed visible renderer paths import no SQLite library, contain no SQL, add no credential
  field, perform no external fetch, and retain the typed Trench XPC boundary plus content-free
  person-change event.
- Source styles preserve the 32px Royal Blue header, 148px/112px independently scrolling rail,
  38/62 master-detail split, narrow list/detail switch, Back action, internal scroll ownership,
  shallow business classes, and keyboard-native buttons/Arco controls. Visual acceptance remains
  Ral's manual gate; this review makes no screenshot or rendered-geometry claim.

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
| 10 | `src/renderer/coin/src/components/TrenchersWorkspace/TrenchPersonList.vue` | 1 |
| 11 | `src/renderer/coin/src/components/TrenchersWorkspace/TrenchPersonDetail.vue` | 1 |
| 12 | `src/renderer/coin/src/components/TrenchersWorkspace/TrenchersWorkspace.less` | 0 |
| 13 | `src/renderer/coin/src/views/navigation/trenchNavigation.runtime.ts` | 0 |
| 14 | `src/renderer/coin/src/views/navigation/trenchNavigation.store.ts` | 0 |
| 15 | `src/renderer/coin/src/views/trenchers/trenchPerson.client.ts` | 0 |
| 16 | `src/renderer/coin/src/views/trenchers/trenchPerson.runtime.ts` | 0 |
| 17 | `src/renderer/coin/src/views/trenchers/trenchPerson.store.ts` | 0 |
| 18 | `src/renderer/common/i18n/en.ts` | 1 |
| 19 | `src/renderer/common/i18n/zh.ts` | 1 |
| 20 | `tests/coin/unit/trenchNavigation.store.test.ts` | 0 |
| 21 | `tests/coin/unit/trenchPerson.store.test.ts` | 0 |
| 22 | `scripts/coin/trench-index-layout.test.mjs` | 0 |
| 23 | `tests/omni/trenchOmniEmbedding.test.mjs` | 0 |

### Problem list

#### 10. `src/renderer/coin/src/components/TrenchersWorkspace/TrenchPersonList.vue`

| # | Line | Rule | Problem | Recommendation |
|---|---|---|---|---|
| 10.1 | 50-58, 109-111 | FE-2 | Business component emits `personId` to its parent. | Route selection through the business store without a payload emit. |

#### 11. `src/renderer/coin/src/components/TrenchersWorkspace/TrenchPersonDetail.vue`

| # | Line | Rule | Problem | Recommendation |
|---|---|---|---|---|
| 11.1 | 216-225, 260-320 | FE-1 | Profile-CAS and two-stage wallet-move orchestration is implemented in the SFC. | Move business workflow state/actions into the paired store and leave binding/rendering in Vue. |

#### 18. `src/renderer/common/i18n/en.ts`

| # | Line | Rule | Problem | Recommendation |
|---|---|---|---|---|
| 18.1 | 1-1690 | TS-1 | File exceeds the 800-line limit. | Split typed locale modules by business area. |

#### 19. `src/renderer/common/i18n/zh.ts`

| # | Line | Rule | Problem | Recommendation |
|---|---|---|---|---|
| 19.1 | 1-1658 | TS-1 | File exceeds the 800-line limit. | Mirror the English typed locale-module split. |

No applicable **TS-2** or backend-rule finding was found in the reviewed scope. The P1 menu-event
receiver failure and stable-name contract gap are product-contract findings outside the narrow
TS/FE rule catalog above.

## Verification evidence

- `node tests/coin/run-unit.mjs` — **pass**, 165/165. This suite does not exercise the detached
  Arco component-event handler described in finding 1.
- `node --test scripts/coin/trench-index-layout.test.mjs` — **pass**, 17/17, rerun after the build.
  Its navigation assertion is source-shape only and likewise does not dispatch a menu event.
- `yarn vue-tsc --noEmit -p tests/coin/tsconfig.trench-renderer.json --composite false` — **pass**.
- `yarn check:renderer-i18n` — **pass**.
- Focused ESLint over the 024 Vue/TS/store tests — exit **0** with 0 errors and 301 formatting
  warnings; it does not enforce FE-1/FE-2 or a zero-warning gate.
- `yarn build` under the repository's DEBUG_DEV wrapper — **pass**, version code
  `260813155644`.
- `node --test tests/omni/trenchOmniEmbedding.test.mjs` — **pass**, 6/6 after the fresh build.
- `git diff --check` — **pass**.

## Safety and scope

- No Electron/browser E2E, browser automation, screenshot, or visual automation ran.
- No `DEBUG_PROD` command/process/profile, provider, live application database, MCP, or production
  record was read or mutated.
- This Verify delivery adds only this review file. It does not edit product code, task/result state,
  README, or another review, and it preserves all unrelated dirty worktree changes.

## Conclusion

**blocked** — task 024 is not deliverable while the primary Arco navigation event fails at runtime.
The store-ownership, stable-name, FE-2, and two touched over-limit locale-module findings also remain
open. A separate Develop fix and fresh independent re-verification are required; Ral's later manual
visual/interaction acceptance remains intentionally outside this review.
