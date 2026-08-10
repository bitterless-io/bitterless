---
id: onlypreview-search-worker-012
scope: Historical Preview-preload Worker delivery; current product runtime superseded by UtilityProcess
status: done
depends-on: [onlypreview-tree-html-preview-010, onlypreview-preview-debug-identity-011]
---

# Objective

Turn the completed pure-JavaScript search experiments into the production OnlyPreview project
search: keep Shell typing responsive, move traversal/read/index/query work out of Electron Main,
persist a bounded SQLite content index, update only changed files, and render exact filename plus
text-snippet results in the Project column.

# Context

- `docs/INDEX.md`
- `docs/features/onlypreview.md`
- `docs/design/colors.md`
- `docs/plan/analysis/onlypreview.md`
- `docs/plan/tasks/onlypreview-tree-html-preview-010.md`
- `docs/plan/tasks/onlypreview-preview-debug-identity-011.md`
- private Overmind `areas/agent/runtime/human/preview/search-design.md`
- private Overmind `areas/agent/runtime/human/preview/search-performance-history.md`

# Current Product Supersession And Acceptance

Task 012 records the original Worker delivery and its original no-Electron verification boundary;
those facts remain historical and are not rewritten as UtilityProcess benchmark evidence. The
current production architecture supersedes only the Electron runtime placement:

- Shell, PreviewHeader, PreviewContent, Settings, and Guide are all `sandbox: true`. Content preload
  has no search token, Worker, Node, traversal, SQLite, query, or watch responsibility.
- Main validates the attached host/workspace, resolves the private bootstrap internally, spawns and
  owns the host-bound UtilityProcess lifecycle, and exposes a bounded XPC proxy. It performs no
  traversal, searchable file read, SQLite, query, or watch work.
- The UtilityProcess exclusively owns traversal, SQLite, query, cancellation, and watch. It uses raw
  `parentPort` request/response/events; Main rejects pending work on timeout/exit, validates and binds
  events to the attached `hostId`, then relays them with `xpcMain.broadcast`.
- `yarn build` PASS and `yarn test:e2e:onlypreview` PASS (7/7) close the later unpackaged Electron
  acceptance. The E2E suite covers the sandboxed three-view graph, 43px geometry, DevTools, media,
  Settings, Project Search scopes/filename/snippet/CJK/hidden-exclude behavior, and exactly one final
  selected-file rerender after the 400ms quiet edge with none for a non-selected file. Packaged
  release build/startup remains untested.

# Historical 012 Layout

```text
┌ Shell WebContentsView ─────────────────┬ PreviewHeader WebContentsView ─────┐
│ MenuBar                                │ file title / type                  │
│ Project                                ├────────────────────────────────────┤
│ ┌ filename/tree filter ──────────────┐ │ PreviewContent WebContentsView     │
│ └────────────────────────────────────┘ │ existing read-only preview surface │
│ Cmd/Ctrl+Shift+F → Project Search      │ trusted Content preload (Node)     │
│ ┌ fileName                      text ┐ │        │                           │
│ │ relative/path                      │ │        ▼                           │
│ │ …16 before [match] 16 after…       │ │ dedicated Worker + SQLite + watch │
│ └────────────────────────────────────┘ │                                    │
└────────────────────────────────────────┴────────────────────────────────────┘
```

# Path

- `src/main/onlypreview/`
- `src/main/windows/onlyPreviewWindow.helper.ts`
- `src/main/xpc/`
- `src/preload/onlypreview/`
- `src/renderer/onlypreview/common/`
- `src/renderer/onlypreview/shell/src/`
- `src/shared/onlypreview/`
- `electron.vite.config.ts`
- `tests/onlypreview/`
- `docs/features/onlypreview.md`
- `docs/plan/analysis/onlypreview.md`
- `docs/plan/README.md`

# Historical 012 Implementation Constraints

1. Electron Main may validate capabilities, compute a private database location, and control native
   views, but it must not traverse a project, read searchable file bodies, build the search index,
   execute search queries, or process result snippets.
2. Split the current Preview surface into a 43px `PreviewHeader` view and a remaining
   `PreviewContent` view while keeping Shell as the third sibling. Shell owns search input/results;
   Header owns file identity and controls render/reload/clear; Content owns file rendering. Only
   Content uses `sandbox: false` so its trusted preload can start a Node Worker. Every page keeps
   `contextIsolation: true`, `nodeIntegration: false`, `webSecurity: true`, exact navigation fences,
   and no `<webview>`. Shell, Header, Settings, and Guide remain sandboxed.
3. Main issues a separate unguessable search-bootstrap token only to the Content preload. The token
   is never exposed through `contextBridge`. It authorizes resolving the active opaque workspace to
   `{ rootPath, databasePath }` inside the preload only. Shell and arbitrary renderers must never
   receive either absolute path or a filesystem API.
4. The Content preload registers a narrow `XpcPreloadHandler`. It validates the shared content host
   and delegates initialization, refresh, search, watch updates, and shutdown to one dedicated
   Worker. Results contain only workspace-scoped relative metadata and aggregate telemetry.
5. The Worker owns recursive traversal, media classification, strict text decode, a filename tier,
   SQLite schema/versioning, content-defined chunks, CJK postings, query execution, snippets,
   `fs.watch`, and 400ms trailing reconciliation. First-open indexing is cooperative and yields by
   elapsed work time so Preview rendering remains responsive.
6. Persist the content index under the application user-data directory, never inside the opened
   workspace. Reopen hydrates the filename tier from SQLite and reconciles current metadata.
   File updates use per-file upsert/delete; a watch overflow, missing filename, or error schedules a
   bounded full reconcile rather than trusting incomplete events.
7. Product excludes are the immutable safety/output rules plus ordered globs from
   `.bitterless/preview-config.yml`. Exclusion is checked before stat/read where possible. Symlinks
   are leaf-only and never recursively followed. Do not import benchmark-only privacy paths into
   the public product policy.
8. Keep the ordinary Project search as a local tree/filename filter, including directory names.
   `Cmd/Ctrl+Shift+F` enters Project Search. Project Search returns files only: every file title can
   match, but content matching is allowed only for records classified as text. A non-text or
   title-only result has no content summary.
9. Project Search uses a fixed 120ms leading-plus-trailing throttle, IME composition fencing,
   single-flight latest-pending execution, explicit cancellation, and request/workspace generation
   fences. The final input is dispatched exactly once; stale batches never render.
10. Each result is exact `{ fileName, relativePath, mediaType, contentMatch }`, where `mediaType` is
    one of `text | image | audio | video | pdf | unknown`. `contentMatch` is `null` or exact
    `{ snippetText, highlightStart, highlightLength }` with grapheme-safe offsets. Include up to 16 graphemes before
    and 16 after, capped at 48 total. A match longer than 48 is shown alone; when remaining context
    is odd, the leading side receives the extra grapheme. Title and content hits merge by file,
    retaining the first verified content match.
11. Normalize candidates with NFKC and the established case policy, then verify every match against
    normalized original text before projecting the original snippet. Short non-CJK queries use the
    validated SQLite `instr` prefilter; CJK and trigram paths preserve their tested exact-verification
    fallback. Do not add NeDB or the native `simple` extension.
12. Record aggregate runtime memory and disk-index footprint separately. Runtime strictly above
    1GiB is an advisory; runtime strictly above 2GiB sets `performanceAccepted=false` and
    `stop=false` without invalidating the recorded artifact or method. The roughly 1.412GB SQLite
    footprint belongs to the historical prototype, is acceptable as disk evidence, and must never
    be presented or summed as RAM.
13. Preserve existing preview rendering, selection-count fencing, Guide, Settings, DevTools,
    recent-directory behavior, and unrelated dirty changes. Do not run Electron, Playwright, E2E,
    the full app, build, or Keychain/Ops paths in this task.

# Historical 012 Verification

- Pure Node tests for traversal/excludes, classifier, persistent reopen, schema migration, chunk
  boundary matching, CJK/ASCII/NFKC exactness, title/content merge, snippet budgets, update/delete,
  watch trailing behavior, throttle/IME/single-flight/cancel, generation fences, and memory flags.
- Source/integration guards for the Content-only trusted preload, private bootstrap capability,
  Worker build/output path, exact XPC surface, Main zero-search-I/O boundary, renderer result
  contract, keyboard routing, and absence of absolute paths/content in logs or bridges.
- `node --test tests/onlypreview/*.test.mjs`, `yarn typecheck:node`, `yarn typecheck:web` comparison,
  renderer i18n, focused ESLint, and `git diff --check`.
- No Electron/Playwright/E2E/full-app/build/Keychain execution. Ral performs final runtime
  acceptance for background indexing, live updates, shortcuts, memory telemetry, and packaging.

# Historical 012 Delivery Evidence

- OnlyPreview now uses three sibling `WebContentsView` instances: sandboxed Shell, sandboxed
  PreviewHeader, and PreviewContent. Only PreviewContent has the trusted non-sandboxed preload
  needed to start the dedicated search Worker; its page remains isolated with Node disabled.
- Main owns only the private bootstrap capability, workspace validation, stable user-data database
  location, and view lifecycle. Traversal, file-body reads, SQLite indexing, queries, snippets,
  watch reconciliation, and aggregate memory measurement stay in the Worker.
- At 012 delivery, SQLite v6 persisted the filename tier plus contentless FTS/chunk/CJK data. Task
  013 subsequently upgrades the current product schema to v7 with `files.in_project`; its recovery
  coverage destructively rebuilds the legacy v6 shape, while a file that disappears between stat
  and read triggers full reconciliation. Fresh builds finalize the filename tier once, interrupted
  committed batches resume through metadata reconciliation, incremental file changes update only
  their file/chunks, and failed watch work is retained as one bounded exponential-backoff full
  reconcile.
- Project Search implements the exact file-only result/media/snippet contract, fixed 120ms
  leading-plus-trailing IME-aware scheduling, one-active/one-latest execution, private Atomics
  cancellation, streamed batches of at most 50 rows or 16ms, and host/workspace/generation/request
  fences. Ordinary Project filtering continues to match directory names.
- Initial indexing emits one empty non-ready snapshot and one final full ready tree instead of
  repeatedly cloning the growing tree into Shell. Snapshot broadcasts are exact-validated down to
  paths, entries, enums, finite telemetry, and memory flags before renderer state accepts them.
- Runtime memory signals and the SQLite disk footprint remain separate. Strictly above 1GiB is an
  advisory; strictly above 2GiB sets `performanceAccepted=false` and `stop=false` without making
  the artifact or methodology invalid. The roughly 1.412GB disk index is prototype history and is
  not treated as RAM.
- Later canonical PRODUCT-P01 same-attempt A-B-B-A evidence records exact semantics for all 24
  cases, worst candidate complete p95 82.523ms, runtime max 873,267,200 bytes, and
  `directTargetPassed/stop=true`. It closes the product performance target without changing this
  task's historical verification boundary: Electron/Playwright/E2E were not run for 012.
- Focused 012 pure Node/source suite: PASS (40/40). `yarn typecheck:node`, renderer i18n,
  application diagnostics, focused TS/Vue ESLint, MJS syntax checks, and scoped diff checks: PASS.
- Full pure OnlyPreview suite: 107/108; the sole failure is an unrelated concurrent Omni source
  guard that still expects the removed literal `additionalArguments: ['--mode=omni']`. Web
  typecheck retains 78 unrelated repository-baseline diagnostics and reports no OnlyPreview search
  diagnostic.
- Independent review: `docs/plan/reviews/onlypreview-search-worker-012-1.md` — PASS, no open P1/P2
  finding after resolving first-build sorting/fanout, snapshot validation, watch retry, and
  interrupted-build resume findings.
- Electron, Playwright, E2E, full-app startup, build, Keychain, and Ops paths were not run during
  task 012 itself. The later current-product build/E2E evidence above closes the unpackaged runtime
  gate without changing that historical fact; packaged release remains outstanding.
