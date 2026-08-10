---
id: onlypreview-dual-index-exclusion-watch-016
scope: Separate the local directory-name index from the excluded file/content Project Search index
status: in-progress
depends-on: [onlypreview-settings-category-navigation-015]
---

# Objective

Give OnlyPreview two explicit index boundaries. The ordinary Project tree/filter keeps local file
and directory names regardless of Project Search excludes. `Cmd/Ctrl+Shift+F` uses a separate
file-only filename/content index that never admits files below hidden directories or immutable
generated-output directories, and applies workspace config excludes before file bodies are opened.
Keep both indexes converged after project create, update, delete, and rename events.

# Context

- [OnlyPreview index contract](../../features/onlypreview.md#index-contract)
- [OnlyPreview delivery analysis](../analysis/onlypreview.md)
- [Search design](../../../../../areas/agent/runtime/human/preview/search-design.md)
- [Historical PRODUCT-P01 acceptance](onlypreview-search-performance-acceptance-014.md)

# Path

- `src/preload/onlypreview/search/core/traversal.mjs`
- `src/preload/onlypreview/search/core/search-engine.mjs`
- `src/preload/onlypreview/search/core/watch-controller.mjs`
- `src/preload/onlypreview/search/core/sqlite-index.mjs`
- `src/renderer/onlypreview/shell/src/onlyPreviewTree.service.ts`
- `src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts`
- `tests/onlypreview/onlyPreviewSearchEngine.traversal.test.mjs`
- `tests/onlypreview/onlyPreviewSearchEngine.scope.test.mjs`
- `tests/onlypreview/onlyPreviewSearchEngine.sqlite.test.mjs`
- `tests/onlypreview/onlyPreviewSearchShell.test.mjs`
- `tests/onlypreview/specs/onlyPreviewSearch.spec.ts`
- `areas/agent/runtime/human/preview/product-benchmark/`
- `docs/features/onlypreview.md`
- `docs/plan/analysis/onlypreview.md`
- `docs/plan/README.md`

# Data Flow

```text
workspace metadata traversal
        |
        +--> directory-name tier: file + directory metadata, ignores Project Search excludes
        |         `--> ordinary left filter: pre-query-visible entry.name only
        |
        `--> Project Search eligibility gate
                  hidden parent? / immutable output parent? / config excluded?
                         | yes: no body read, no SQLite/file-title row
                         ` no: file metadata + eligible text body -> SQLite
                                      `--> Cmd/Ctrl+Shift+F: filenames + file content only

400ms trailing watch hint -> one metadata decision -> update/delete both destinations as applicable
```

# Delivery

1. Treat `.git`, `node_modules`, `dist`, `build`, `out`, `output`, `.next`, `coverage`, `.cache`,
   `.turbo`, and every dot-prefixed directory as immutable Project Search exclusions at any depth.
   A workspace `!` rule cannot re-include them. Their directory names and descendants never enter
   the Project Search filename/content store, and excluded file bodies are never opened.
2. Apply `.bitterless/preview-config.yml` ordered excludes only to the Project Search store. The
   directory-name tier ignores both config and immutable Project Search exclusions, so entries such
   as `.bitterless` and `node_modules` remain ordinary tree/filter metadata. It does not read bodies.
3. Keep root dotfiles eligible unless an immutable sensitive-file rule or workspace config excludes
   them. A file below any hidden directory is always ineligible for Project Search, including an
   explicit `In Directory` query anchored there.
4. Keep Project Search file-only. It applies substring matching only to the file-basename field and
   eligible text content; it never returns or matches directory names or relative directory path
   text.
5. Route create/update/delete through one 400ms trailing commit. An eligible file is upserted into
   both tiers; an excluded file updates only tree metadata and is deleted from SQLite; deletion
   removes it from both; directory/type changes and rename hints force a bounded dual reconcile.
6. Bump the search-engine identity so a persisted database created under the hidden-inclusive
   policy cannot reopen as ready. Retain schema v7 unless stored data shape changes.
7. Retire PRODUCT-P01 only as current-policy acceptance: preserve its immutable history, but do not
   use its 726 physically indexed hidden-descendant files, latency, memory, or disk values to accept
   this policy. Record one new PRODUCT-P02 full point only after preflight proves structural
   exclusions and CRUD watch gates. Report directory-tier and Project Search resources separately.

# Acceptance

- `.bitterless`, `node_modules`, `dist`, `output`, and arbitrary hidden directories remain visible
  and name-filterable in the ordinary tree, including config-excluded names already present there.
- No file below those hard directories exists in SQLite, filename candidates, chunks, FTS, or short
  postings. Their directory names cannot appear in Project Search. A later config `!` cannot restore
  them.
- A config-excluded ordinary file remains tree-visible but cannot match Project Search by filename
  or content. Removing the exclude and refreshing adds it; adding an exclude deletes it.
- Project Search create, content update, delete, delete/recreate, and rename converge after the
  final 400ms trailing edge without a stale title, snippet, or row.
- Focused pure Node, type, renderer, static integration, and targeted Electron search acceptance
  pass. PRODUCT-P02 uses the real Overmind config/corpus, proves eligibility before any body open,
  records no forbidden path/query/snippet data, stays below the existing runtime budget, and
  reports a new current-policy latency/memory/disk point. Metadata-only tree `lstat` work remains
  allowed and is measured separately. PRODUCT-P02 runs the bundled current Utility runtime and
  product core in a fresh Node child; Electron UtilityProcess startup, Main relay, Shell scheduling,
  and renderer commit remain explicit targeted-Electron acceptance boundaries.

# Verification

- Screenshot/config timing audit: the supplied Overmind screenshot was created at
  `2026-08-09 20:52:26 +0800`; the root `.bitterless` directory was created at
  `2026-08-09 23:13:52 +0800`, so the screenshot predates it. The current root-owned
  `.bitterless/preview-config.yml` exists in the private Overmind repository and hashes to
  `5bfd1a07f394124d72ee7ad8d0dc56a47bfca12f77b79782985a34e695e6a0b6`.
- Focused product-core rerun:
  `node --test tests/onlypreview/onlyPreviewSearchEngine.{traversal,scope,sqlite,shortPosting,boundary}.test.mjs`
  → 33/33 PASS. Independent contract review additionally exercised the renderer/tree boundary and
  reported 46/46 PASS with no remaining product-contract blocker.
- Earlier broader pure-Node run: `node --test tests/onlypreview/*.test.mjs` → 136/137 PASS; the sole
  failure is the unrelated pre-existing Omni source guard for its changed `additionalArguments`
  contract.
- `yarn typecheck:node` → PASS.
- PRODUCT-P02 harness → 64/64 PASS; CLI preflight → PASS with `fullCorpusStarted=false`; bounded
  synthetic → PASS for the exact query/scope, dual-tier, CRUD/native-watch, cancellation, persisted
  index, and resource contracts. Independent fail-open review → GO. Final harness/source identity is
  `f96ea6d66864d53a789f57c6f997de6910bc46a1f87745b1dcd065ba399b8ead`; zero PRODUCT-P02 artifacts,
  temporary directories, or harness processes remain.
- The unique PRODUCT-P02 full run, `yarn build`, and updated OnlyPreview Electron E2E have not run;
  this task therefore remains `in-progress`.
