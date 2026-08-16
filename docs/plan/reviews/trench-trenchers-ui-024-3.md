# Final re-review: trench-trenchers-ui-024

- Scope: current `dev/current` worktree paths owned by task 024, after the three fixes from review
  024-2
- Date: 2026-08-13

## Findings

None. No open P1, P2, or P3 finding remains in the reviewed task contract.

## Review 024-2 closure

All three findings from `trench-trenchers-ui-024-2.md` are closed in the current source:

1. **All-state narrow Back action — closed.** The Back control is the first child of the detail
   section and sits outside the error, empty/loading, and successful-detail branches
   (`src/renderer/coin/src/components/TrenchersWorkspace/TrenchPersonDetail.vue:2-23`). It is
   governed only by the store-owned `detailPaneRequested` intent and invokes the store-owned return
   action. The narrow rules display that control whenever the requested detail pane replaces the
   list (`src/renderer/coin/src/components/TrenchersWorkspace/TrenchersWorkspace.less:526-558`).
   Focused coverage exercises a failed requested read and a requested selection removed by an
   empty refresh, then proves the return intent remains actionable in both states
   (`tests/coin/unit/trenchPerson.store.test.ts:160-192`). Loading uses the same unconditional
   control path; ready detail retains it as well.
2. **Latest list intent after every relevant await — closed.** `loadPage` captures one list
   sequence before its list read and rejects a superseded result immediately. Its selected-row
   detail read carries that parent sequence into `loadDetail`; the off-page/merged preservation
   read checks both the list sequence and its own detail sequence after the await; and the fallback
   first-row detail read again carries the parent sequence
   (`src/renderer/coin/src/views/trenchers/trenchPerson.store.ts:376-445`). A newer list intent also
   invalidates an older stale-cursor response before it can recurse. No post-await list/detail
   mutation in this path is left unfenced. The deterministic deferred regression was rerun: an old
   refresh pauses in its off-page person read, a newer search completes with person B, and the late
   person-A response cannot replace the new query, page, selection, or detail
   (`tests/coin/unit/trenchPerson.store.test.ts:194-229`). The selected-in-page and first-row
   continuations use the same parent-list guard and were audited source-to-write.
3. **Pending mutation modal fence — closed.** Both profile and wallet-move modals bind
   `mask-closable`, `closable`, and `esc-to-close` to the inverse pending flag and bind
   `on-before-cancel` to a synchronous pending veto
   (`src/renderer/coin/src/components/TrenchersWorkspace/TrenchPersonDetail.vue:129-163`). Their
   cancel handlers and store cancel actions independently return without changing visibility,
   drafts, address, or confirmation state while pending
   (`TrenchPersonDetail.vue:265-285`;
   `src/renderer/coin/src/views/trenchers/trenchPerson.store.ts:152-156,324-328`). The installed
   Arco Modal checks `escToClose` at key dispatch, routes mask and Cancel/X through
   `handleCancel`, and closes/emits only when `onBeforeCancel` accepts
   (`node_modules/@arco-design/web-vue/es/modal/modal.vue_vue_type_script_lang.js:212-225,237-244,280-300`).
   A read-only JSDOM component probe mounted that actual Arco Modal, opened it normally, toggled
   pending, and proved Escape, mask, Cancel, and X produce no `cancel` or `update:visible` while
   pending; after pending cleared, Escape closed normally. The focused store regression separately
   proves profile draft and exact move-candidate preservation
   (`tests/coin/unit/trenchPerson.store.test.ts:364-392`).

## Prior-review and full-contract audit

- All six findings from review 024-1 remain closed: the Arco menu event uses the receiver-safe
  closure and detached-dispatch regression; profile and move workflows remain store-owned; the
  repeated wallet copy control retains its stable name; person selection has no business payload
  emit; and every touched locale/TypeScript module remains below 800 lines.
- One local Arco navigation owner retains INDEX/SOL/BSC/Robinhood followed by Trenchers/All
  traders. Navigation contains no call or persistence boundary, the INDEX workspace receives the
  selected chain, and Header Refresh rereads only the active module. Agent and GMGN Settings remain
  global within the unchanged 32px Royal Blue header.
- Person reads remain revision-fenced and cursor-paged in authoritative server order. Search,
  cursor restart, stable selection, merged-person redirect, stale-visible detail, Anonymous,
  missing-profit, empty, and typed error states remain explicit; no renderer profit sort or global
  leaderboard claim was introduced.
- Profile submission sends only changed optional fields with the editor-open revision. Wallet
  movement canonicalizes explicit chain plus address, searches only existing person-linked detail
  rows, accepts one exact `user` chain account, shows source person/current membership, and submits
  wallet ID plus revision/current-person CAS. Unknown, unattached, non-user, ambiguous,
  already-owned, partially unreadable, and stale inputs still fail closed. The source contains no
  person/wallet creation, name merge, or transfer-aware-profit fabrication.
- The visible task paths contain no SQL/SQLite driver, direct HTTP/fetch, credential field, MCP
  write, or external acquisition path. They retain the typed Trench XPC client plus the
  content-free person revision event.
- The responsive source retains independently scrolling 148px/112px navigation, 38/62 wide
  master-detail, below-720px list/detail switching, low-height rules, internal scroll ownership,
  stable business names, keyboard-native controls, and `#001..#300` rank formatting. Rendered
  geometry and visual acceptance remain Ral's manual gate as specified.

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

No open **TS-1**, **TS-2**, **FE-1**, or **FE-2** rule violation was found. Every reviewed
TypeScript module is below 800 lines; standalone functions use arrow constants; business
read/mutation orchestration stays in the paired store; and the business components declare no
payload emit.

## Verification evidence

- `node tests/coin/run-unit.mjs` — **pass**, 170/170, including the deterministic deferred
  refresh/search race, all-state narrow Back intent, pending mutation preservation, menu receiver,
  cursor/CAS/error behavior, and person contract tests.
- Actual installed Arco Modal JSDOM probe — **pass** for pending Escape, mask, X, and Cancel fencing
  and post-pending Escape closure. This was a component-level unit probe, not Electron/browser E2E.
- `node --test scripts/coin/trench-index-layout.test.mjs` — **pass**, 18/18 before and after the
  fresh build.
- `yarn vue-tsc --noEmit -p tests/coin/tsconfig.trench-renderer.json --composite false` — **pass**.
- `yarn check:renderer-i18n` — **pass**.
- Focused ESLint over the task 024 Vue/TS/locale/tests — exit **0**, 0 errors; 382 formatting or
  ignored-file warnings, with no zero-warning delivery gate configured.
- `yarn build` through the isolated DEBUG_DEV wrapper — **pass**, version code `260813155644`; it
  built but did not launch the application.
- `node --test tests/omni/trenchOmniEmbedding.test.mjs` after the fresh build — **pass**, 6/6.
- `git diff --check` plus an explicit final-newline/trailing-whitespace audit of this untracked
  review file — **pass** after authoring the review.

## Safety and scope

- No Electron/browser E2E, browser automation, screenshot, or visual automation ran.
- No DEBUG_PROD command/process/profile, provider, live database, MCP, or production record was
  read or mutated.
- This Verify delivery adds only this review file. It does not edit product code, task/result
  status, README, or either prior review, and it preserves unrelated dirty worktree changes.

## Conclusion

**pass** — task 024 satisfies its documented renderer contract and has no open P1/P2/P3 finding.
The task may proceed to closure/full-plan bookkeeping by the parent orchestrator. Ral's standalone
and Omni visual/interaction acceptance remains intentionally manual and was not claimed here.
