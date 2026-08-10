---
id: onlypreview-search-scope-watch-013
scope: Complete scoped Project Search, visible-tree filtering, and selected-preview watch refresh
status: done
depends-on: [onlypreview-search-worker-012]
---

# Objective

Close the product gaps left after the Worker/index delivery: make `Cmd/Ctrl+Shift+F` search the
current directory by default with an explicit `In Directory` / `In Project` selector, make the
ordinary Project field filter only names already visible before the query without expanding the
tree, keep root and hidden-item behavior deterministic, and rerender the currently selected Preview
after the final 400ms-trailing file change without moving I/O back into Electron Main.

# Context

- `docs/INDEX.md`
- `docs/features/onlypreview.md`
- `docs/plan/analysis/onlypreview.md`
- `docs/plan/tasks/onlypreview-search-worker-012.md`
- private Overmind `areas/agent/runtime/human/preview/search-design.md`
- private Overmind `areas/agent/runtime/human/preview/search-performance-history.md`
- private Overmind `areas/agent/runtime/human/preview/benchmark/benchmark-config.yml`

# Layout

```text
ordinary Project mode                 Cmd/Ctrl+Shift+F
┌ PROJECT ───────────────────────┐    ┌ PROJECT SEARCH ──────────────────┐
│ Filter displayed names…       │    │ Search filenames and text…       │
│ ▾ .hidden                     │    │ Scope: [In Directory ▾]          │
│   notes.md                    │    │ current/folder                   │
│ root-file.txt                 │    │                                  │
│ ▸ collapsed                  │    │ file.ts                      text │
└───────────────────────────────┘    │ path/to                          │
  match entry.name only              │ …before [match] after…            │
  preserve pre-query visible rows    └──────────────────────────────────┘
  never auto-expand                    selector: In Directory/In Project

watch(relative path, revision)
  ── 400ms trailing UtilityProcess commit ──► raw parentPort event
       latest revision must arrive            ──► Main validate + host bind + XPC broadcast
                                               ──► Header selection/revision gate
                                               ──► existing reload control
                                               ──► Content generation/read
```

# Path

- `src/shared/onlypreview/onlyPreviewSearch.type.ts`
- `src/utility/onlypreview/`
- `src/main/onlypreview/onlyPreviewSearchUtilityRpc.service.ts`
- `src/preload/onlypreview/search/`
- `src/renderer/onlypreview/common/`
- `src/renderer/onlypreview/shell/src/`
- `src/renderer/onlypreview/previewHeader/src/`
- `src/renderer/onlypreview/preview/src/`
- `tests/onlypreview/`
- `docs/features/onlypreview.md`
- `docs/plan/analysis/onlypreview.md`
- `docs/plan/README.md`

# Delivery Evidence And Remaining Gates

- The strict `{ kind: 'project' } | { kind: 'directory'; relativePath }` scope now crosses the
  renderer/Main-proxy/UtilityProcess protocol. The Shell captures the deterministic directory anchor before
  results replace the tree, renders the `In Directory` / `In Project` selector, and fences scope
  changes with the existing latest-query generation.
- The ordinary Project filter now freezes the pre-query visible rows, matches only each exact
  `entry.name`, retains visible context ancestors, and restores the unchanged expansion set on
  clear. It neither inspects collapsed descendants nor enters Project Search.
- UtilityProcess traversal processes every directory's direct children before descending. Scope tests cover
  root and dot entries, hidden-directory eligibility, explicit hidden-directory scope, and hard
  excludes, so a deep subtree cannot hide later root siblings.
- Exact result-cap tests exercise every query strategy and prove that a content-only match outside
  the first 500 title candidates sets `truncated`; selected text and non-text scope variants are
  covered without emitting directory rows.
- The committed watch path is UtilityProcess raw event → Main validation/host binding/XPC broadcast →
  PreviewHeader selection/revision gate → existing reload control → PreviewContent generation/read.
  Behavior tests reject malformed, wrong-host, stale
  session/workspace/generation/selection/revision events and cover selected/unselected paths,
  delete/recreate, duplicate revisions, and full reconciliation.
- The current SQLite schema is v7 with `files.in_project`. Recovery tests rebuild a legacy v6 table
  shape and force full reconciliation when a file disappears between its metadata stat and content
  read, instead of retaining a stale partial update.
- Task 012 and its review remain historical evidence for the narrower v6 Worker/index/result
  delivery. Historical prototype/R05 values, including the roughly 1.412GB disk footprint, are
  background only and do not prove the current product path.
- Canonical `PRODUCT-P00` is recorded at
  `areas/agent/runtime/human/preview/product-benchmark/results/PRODUCT-P00-2026-08-09T17-14-11.034Z-289c3f0152b8.json`
  with SHA-256 `289c3f0152b838512a7123acb2fd8ae3e9ad981a9125897a194c79fb976c00cd`.
  It is recording/trend eligible and performance accepted. First build was 66,214.878ms, fresh
  Worker reopen was 48.637ms with filesystem cache uncontrolled/likely warm, reconcile was
  12,033.667ms, runtime peak was 852,492,288 bytes, SQLite peaked at 691,402,296 bytes and finished
  at 642,551,808 bytes, and every warm first-result p95 stayed below 100ms. Complete-result p95
  exceeded 100ms only for In Project CJK unigram (230.848ms), CJK bigram (214.035ms), and combining
  text (114.643ms). Cancellation completed in 0.292ms with no late batch; synthetic watch committed
  and verified in 442.041/489.881ms with `full=false` and `changedPathCount=1`. As the first product
  point, it remains `stop=false`.
- P00's dynamic boundary ends at fresh child process → production Worker client → TypeScript Worker
  → engine/result batcher → coordinator. That historical measurement boundary is unchanged by the
  later product UtilityProcess migration.
- Canonical same-attempt A-B-B-A `PRODUCT-P01` is recorded at
  `areas/agent/runtime/human/preview/product-benchmark/results/PRODUCT-P01-2026-08-09T18-34-18.181Z-2ceb96275090.json`
  with SHA-256 `2ceb962750900c5fc588b895b592f68abb53d2cb8cbae7c6b498ecc7fcddbb6b`.
  Recording/trend eligibility, semantic equality (24/24), cancellation/latest/watch gates, and
  `directTargetPassed` are true; candidate worst complete p95 is 82.523ms and `stop=true`. This is a
  direct acceptance result, not a cross-epoch plateau, and it retains P00's dynamic boundary.
- Current unpackaged product acceptance also passes: `yarn build` PASS and
  `yarn test:e2e:onlypreview` PASS (7/7). Electron coverage includes the sandboxed three-view graph,
  exact 43px Header/Content geometry, per-view DevTools, media, Settings, both Project Search scopes,
  filename plus highlighted text summaries, CJK, hidden/config excludes, and exactly one rerender for
  the selected file after the final 400ms quiet edge with none for a non-selected file. Packaged
  release build/startup remains untested.

# Historical 013 Implementation Constraints

1. Add one strict scope discriminator to the renderer/preload/Worker request contract:

   ```ts
   type OnlyPreviewSearchScope =
     | { kind: 'project' }
     | { kind: 'directory'; relativePath: string };
   ```

   `relativePath: ''` means the workspace root. Reject absolute paths, traversal, separators outside
   the normalized relative-path grammar, unknown variants, and extra fields. Scope stays a relative
   capability value; no renderer receives an absolute search root.
2. `Cmd/Ctrl+Shift+F` defaults to `In Directory` and captures one stable directory anchor before the
   tree viewport is replaced: focused directory -> itself; focused file -> its parent; otherwise the
   selected Preview file's parent; otherwise workspace root. The user can switch between
   `In Directory` and `In Project`. Returning to `In Directory` restores the captured anchor rather
   than deriving it from a result row.
3. A scope change increments the input/request generation, cancels or supersedes active work, and
   dispatches the latest non-composing query through the existing fixed 120ms leading-plus-trailing
   scheduler. The last query/scope pair must run exactly once; stale batches cannot replace it.
4. Project Search returns files only. `In Directory` restricts filename and verified text-content
   matches to the anchored subtree; `In Project` uses the workspace-wide eligible tier. Directory
   names never become Project Search results. The existing exact filename/media/text-only snippet
   and safe text-node highlight contract remains unchanged.
5. The ordinary Project field is not Project Search. Snapshot the rows visible from the current
   `expandedPaths` immediately before the non-empty query, then case/NFKC literal-match only each
   row's exact `entry.name`. Keep already-visible ancestors needed for context, but do not inspect a
   collapsed descendant, match `relativePath`, traverse the filesystem, call Main/Worker search, or
   add to `expandedPaths`. Clearing the query restores the same expansion state.
6. Tree inventory publishes every current directory's complete direct-child set before deeper work,
   including files beside directories at workspace root and dot-prefixed files/directories. Local
   filtering can match every such already-visible name. A deep subtree, result cap, or traversal
   order cannot consume root siblings first.
7. Hidden visibility and global eligibility are separate. Hidden entries remain visible in the tree.
   `In Project` excludes files whose parent chain contains a hidden directory, while root-level
   hidden files remain eligible unless workspace config excludes them. Explicitly
   anchoring `In Directory` at a hidden directory permits that subtree. Product config/core excludes
   remain hard exclusions in both global scopes and cannot be bypassed by selecting a hidden
   directory.
8. Remove `showHiddenFiles` from operative tree/index filtering: hidden files and directories are
   always present in the tree contract. If the legacy setting remains serialized for backward
   compatibility, it cannot suppress discovery, local filtering, or an explicitly authorized file.
   Do not make a settings save trigger a search-index rebuild for this inert field.
9. After a Worker-owned 400ms trailing reconciliation commits the latest create/change/delete/
   rename state, the Content preload broadcasts a bounded host/workspace/path/watch-revision event.
   PreviewHeader accepts it only for its current selection and a newer revision, then sends its
   existing reload control to PreviewContent. Content advances the Preview load generation before
   reading; a stale read, prior workspace, prior selection, or prior watch revision cannot install.
   Delete/rename renders the existing typed missing state; a later recreate gets a newer revision
   and reloads. Ambiguous events/full reconcile must use the same route when the selected path may
   have changed.
10. Header retains its manual `render` / `reload` / `clear` control; automatic watch reload reuses
    that narrow control rather than introducing a generic page event bus. The preload event exposes
    no filesystem authority, absolute path, or file content. Electron Main performs no traversal,
    searchable content read, search query, watch processing, or Preview file-change polling.
11. Product workspace config is the current flat version-1 contract at
    `<workspace>/.bitterless/preview-config.yml`:

    ```yaml
    version: 1
    exclude:
      - "**/.git/**"
      - "**/node_modules/**"
      - "**/dist/**"
      - "**/output/**"
    ```

    Globs use workspace-relative POSIX paths and apply before file-body I/O. OnlyPreview remains
    read-only and never creates this file. The profile-shaped
    `areas/agent/runtime/human/preview/benchmark/benchmark-config.yml` is benchmark input, not a
    product config and cannot substitute for it.
12. Canonical Overmind `PRODUCT-P00` ran in a fresh child process through the production Worker
    client, TypeScript Worker entry, search engine/result batcher, and coordinator against the
    current corpus. Its receipt records the exact commit/dirty identity, platform, product-config
    bytes/hash
    (or explicitly `no workspace config; bundled defaults`, which cannot satisfy a configured-exclude
    claim), included file/text counts, first build/fresh-Worker reopen, first and complete query
    latency for both scopes, cancellation, incremental update, committed watch delivery to the
    coordinator, runtime heap/RSS, and SQLite disk bytes. This artifact does not dynamically measure
    Electron preload/XPC, the Shell 120ms scheduler, PreviewHeader's selected/revision gate,
    PreviewContent's commit, or packaged startup; source guards and Ral runtime acceptance cover
    those boundaries.
13. Keep performance history append-only and comparable. Historical R05 remains `stop=false` and is
    not the eligibility control for a new product run; old prototype/R03/R04/failed-R06 values remain
    diagnostic only. Do not claim a trend, platform point, or product acceptance from those rows.
    Runtime strictly above 1GiB is an optimization advisory. Strictly above 2GiB sets
    `performanceAccepted=false` and `stop=false` but does not invalidate the artifact or benchmark
    methodology. SQLite disk is reported separately from RAM; the roughly 1.412GB value is accepted
    historical prototype disk evidence, not a current product measurement.
14. Preserve current preview renderers, result-row layout, Guide, Settings window, DevTools,
    recent-directory behavior, and unrelated dirty changes. Do not start Electron, Playwright, E2E,
    the full app, a build, Keychain, or Ops during this delivery; Ral performs final runtime UI
    acceptance.

# Verification

- Pure tree tests build root-level files, folders, dot entries, and collapsed descendants; prove
  that local filtering uses only the pre-query visible rows' `entry.name`, keeps context ancestors,
  never matches a hidden `relativePath` segment, never expands, and restores expansion on clear.
- Pure scope/parser/engine tests cover strict variants, root `relativePath: ''`, directory anchor
  precedence, stable captured anchor, In Directory boundaries, In Project hidden-directory
  exclusion, explicit hidden-directory scope, root hidden files, hard excludes in both scopes, and
  folder-name non-results.
- Fake-time coordinator tests cover scope changes, 120ms leading/trailing plus IME, one-active/
  one-latest cancellation, final query/scope exactly once, and stale result fencing.
- Fake-time watch/Preview tests cover repeated changes resetting 400ms, final revision delivery,
  selected versus unselected paths, workspace/selection changes during read, atomic rename,
  delete/recreate, full reconcile, and exactly one final rerender after quiet.
- Source guards prove the selector and localized labels exist, the request carries scope, the
  UtilityProcess → validated host-bound Main relay → Header gate → Content reload path is connected,
  Main owns no search/watch I/O, every visible view is sandboxed, and no absolute path/content
  crosses the renderer boundary.
- Preserve the canonical Overmind baseline through the fresh-child production Worker/coordinator
  boundary and its exact flat config identity. Runtime memory and SQLite bytes remain separate;
  legacy rows are not current-product evidence. Shell/XPC/Header/Content runtime behavior and
  packaged startup remain explicit owner acceptance outside that artifact.
- Run focused pure Node tests, `yarn typecheck:node`, `yarn typecheck:web` comparison, renderer i18n,
  focused lint, and `git diff --check`. Do not run Electron/Playwright/E2E/full-app/build/Keychain.

# Acceptance

- Opening Project Search starts in `In Directory` for the deterministic captured directory; the
  selector can run the same query `In Project`, and returning restores the original directory.
- Ordinary filtering changes only already-visible rows by `entry.name` and never changes expansion.
- Root files and hidden entries stay visible; global hidden/config rules behave exactly as specified.
- Saving the selected file repeatedly causes one final automatic Preview rerender after the 400ms
  quiet edge, with no stale-content flash and no Main-process filesystem I/O.
- Canonical `PRODUCT-P00` remains the historical product baseline; canonical same-attempt
  `PRODUCT-P01` records exact 24/24 semantics, `recordingEligible=true`, `trendEligible=true`,
  `directTargetPassed=true`, and `stop=true` without reusing prototype figures as proof.
- Later 7/7 Electron E2E verifies the unpackaged XPC, Shell scheduling, Header/Content watch commit,
  and selected-only rerender boundaries that the product benchmarks intentionally do not execute.
  Packaged release startup remains untested.

# Review

- [Implementation review PASS](../reviews/onlypreview-search-scope-watch-013-1.md); later build and
  7/7 Electron E2E close unpackaged runtime acceptance.
