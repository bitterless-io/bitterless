---
id: onlypreview-search-during-index-017
scope: Replace the search UtilityProcess with a hidden XPC renderer and keep search available during indexing
status: done
depends-on: []
---

# Objective

Replace the dedicated search UtilityProcess with one invisible top-level `fileSearch` renderer whose
Node-context preload owns browsing, traversal, SQLite, search, and watch work over XPC. Prevent
Project Search from reporting false empty results while counting or building an index: keep the last
complete SQLite index searchable while a separate candidate is built, and give a first-build
`In Directory` request one complete same-policy scoped scan instead of searching only rows already
indexed.

# Context

- [OnlyPreview index and search contract](../../features/onlypreview.md#index-contract)
- [OnlyPreview delivery analysis](../analysis/onlypreview.md)
- [Dual browse/search index delivery](onlypreview-dual-index-exclusion-watch-016.md)

# Path

- `src/main/fileSearch/`
- `src/preload/fileSearch/`
- `src/renderer/fileSearch/`
- `src/utility/onlypreview/`
- `src/preload/onlypreview/search/core/`
- `src/main/windows/onlyPreviewWindow.helper.ts`
- `src/main/xpc/onlyPreviewSearchRuntime.handler.ts`
- `src/main/logging/logPolicy.service.ts`
- `src/main/onlypreview/onlyPreviewSearchUtilityLifecycle.service.ts`
- `src/main/onlypreview/onlyPreviewSearchUtilityRpc.service.ts`
- `src/shared/onlypreview/onlyPreviewSearchUtility.types.ts`
- `src/shared/onlypreview/fileSearchRuntime.types.ts`
- `electron.vite.config.ts`
- `src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts`
- `src/renderer/onlypreview/shell/src/onlyPreviewProjectSearch.store.ts`
- `tests/onlypreview/onlyPreviewSearchEngine.sqlite.test.mjs`
- `tests/onlypreview/onlyPreviewSearchEngine.scope.test.mjs`
- `tests/onlypreview/onlyPreviewSearchEngine.recovery.test.mjs`
- `tests/onlypreview/onlyPreviewSearchEngine.boundary.test.mjs`
- `tests/onlypreview/onlyPreviewCore.test.mjs`
- `tests/onlypreview/onlyPreviewSearchUtilityRpc.test.mjs`
- `tests/onlypreview/onlyPreviewSearchShell.test.mjs`
- `tests/onlypreview/onlyPreviewSearchWindowIntegration.test.mjs`
- `tests/onlypreview/searchBootstrap.runtime.entry.ts`
- `tests/onlypreview/fixtures/onlyPreviewApp.fixture.ts`
- `tests/onlypreview/specs/onlyPreviewSearch.spec.ts`
- `docs/features/onlypreview.md`
- `docs/plan/analysis/onlypreview.md`
- `docs/plan/README.md`

Do not modify the unrelated owner changes in `package.json` or `yarn.lock`.

# Delivery

1. Add one `src/renderer/fileSearch/` HTML entry backed by a dedicated
   `src/preload/fileSearch/fileSearch.preload.ts`. Main owns its invisible `BrowserWindow` lifecycle
   from `src/main/fileSearch/`; the window is never shown or placed under the OnlyPreview renderer
   tree. Keep `contextIsolation: true`, `nodeIntegration: false`, `webSecurity: true`, exact local
   navigation fencing, `backgroundThrottling: false`, and use `sandbox: false` only for the trusted
   Node-context preload that requires filesystem and `node:sqlite` access.
2. Replace UtilityProcess `parentPort` transport and build entries completely. Main calls the
   background preload through typed `electron-xpc`; the preload returns events through an internal
   capability-bound XPC path, and Main validates/binds them before broadcasting the existing public
   Shell events. No visible renderer receives root/database paths or the private search capability.
3. Preserve the current Main security boundary: only Main resolves the host/workspace bootstrap and
   sends absolute root/database paths to the background preload. XPC's missing sender identity is
   never trusted; every runtime request/event is capability-, host-, workspace-, generation-, and
   shape-validated. Crash, load failure, navigation, close, auth invalidation, and app quit reject
   pending calls and destroy the hidden renderer without leaving a second owner.
4. Separate the complete active SQLite index from a candidate build. Queries use only the active
   index until a completed candidate is atomically promoted; partial candidate rows are never
   queryable.
5. Preserve the active index and its query availability across candidate counting, indexing,
   cancellation, and failure. Clean candidate artifacts without deleting or corrupting the active
   database.
6. When no complete active index exists, let `In Directory` perform one complete traversal rooted at
   its captured scope. Apply the same hard/config exclusions, text eligibility, decoding,
   containment, normalization, snippets, stable ordering, cancellation, and result limit as the
   normal project index. Let the background project build continue independently.
7. Keep first-build `In Project` pending until promotion. It must not resolve to an empty result
   merely because the candidate is incomplete.
8. Decouple index progress from renderer search readiness. Counting/indexing progress must not
   suspend an existing search, cancel an accepted request, clear accepted results, or weaken the
   existing host/workspace/request/generation fences.
9. Do not add a `LIKE` fallback or any other query over incomplete candidate rows. `LIKE` can only
   inspect already persisted rows and cannot recover files the traversal has not reached.

# Acceptance

- With a complete active index, filename and content searches return its stable result set while a
  candidate emits both counting and indexing progress.
- A file present only in a partial candidate is invisible until promotion. After successful atomic
  promotion, a later query sees the new complete index.
- Candidate cancellation or failure leaves the prior active index queryable and removes temporary
  candidate artifacts.
- With no active index, `In Directory` finds eligible filename and content matches anywhere below
  the captured scope even when the background project traversal has not reached them. It does not
  admit hard/config-excluded files or publish a partial result set.
- With no active index, `In Project` waits for the complete candidate and never publishes a false
  no-result state.
- Index progress does not clear accepted rows or cancel an active query, and stale lifecycle events
  still fail the exact host/workspace/request/generation fences.
- The official build contains `renderer/fileSearch/index.html` and `preload/fileSearch.js`, contains
  no OnlyPreview search UtilityProcess entry, and has exactly one hidden file-search owner while the
  standalone window is alive.
- All file-search requests and events use XPC with a private Main-held capability. Direct calls from
  visible renderers without that capability fail before workspace/path access; no absolute path,
  file body, or database path reaches their state or public events.
- File-search load failure, preload failure, navigation, render-process exit, window close, host
  revoke, auth invalidation, and app quit deterministically reject pending work and clean the owner.
- Focused tests prove real build/query overlap, first-build scoped completeness, candidate failure,
  atomic promotion, cancellation, exclusion parity, XPC fencing/lifecycle, and the absence of SQL
  `LIKE` fallback.

# Verification

- `node --test tests/onlypreview/onlyPreviewSearchEngine.{sqlite,scope,recovery}.test.mjs tests/onlypreview/onlyPreviewSearchShell.test.mjs tests/onlypreview/onlyPreviewSearchWindowIntegration.test.mjs`
- `node --test tests/onlypreview/*.test.mjs`
- `yarn typecheck:node`
- `yarn check:renderer-i18n`
- Focused ESLint for changed file-search/OnlyPreview TypeScript/Vue files.
- `yarn build`
- `git diff --check`

# Delivery Evidence

- Independent third-round review: [PASS](../reviews/onlypreview-search-during-index-017-3.md),
  with no P0/P1/P2 findings. The retained P3 is limited to `electron-xpc` not exposing a safe
  unregister API for old capability-named registry entries; stopped owners and stale capabilities
  have no live authorization path.
- Focused Node behavior suite: **45/45 passed**.
- Full OnlyPreview Node suite: **164/164 passed**.
- `yarn typecheck:node`, `yarn check:renderer-i18n`, focused ESLint, and `git diff --check`: **passed**.
- Final `yarn build`: **passed**. Output contains `out/preload/fileSearch.js` and
  `out/renderer/fileSearch/index.html`, with no old OnlyPreview search UtilityProcess entry.
- Final `yarn test:e2e:onlypreview`: **8/8 passed**. The three critical search paths were also
  repeated independently during development for **9/9 passed**; that repeat result is reported
  evidence because the later full run replaced its standalone report.
- The existing owner-generated `package.json` profile remains `Bitterless_DEBUG_PROD`; unrelated
  Coin, Trench, and Omni working-tree changes were excluded from this delivery.
