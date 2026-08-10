---
id: onlypreview-search-worker-012-1
status: pass
reviewed_task: onlypreview-search-worker-012
target: working-tree-2026-08-09
base: cf9ca882649f17dd34b3dc4089ccf88ca2be2670
date: 2026-08-09
review_type: independent-static-and-node-no-runtime
---

# Verdict

**PASS. No open P1 or P2 finding.** Independent review initially found first-build filename-tier
sorting and full-tree snapshot fanout, shallow renderer snapshot validation, dropped failed watch
work, and incomplete-build restart behavior. All five were corrected and independently rechecked.
One existing TS-1 test-file-size baseline remains P3 non-blocking.

# File Inventory

| # | File(s) | Findings |
|---|---|---:|
| 1 | `docs/plan/tasks/onlypreview-search-worker-012.md` | 0 |
| 2 | `docs/features/onlypreview.md` | 0 |
| 3 | `docs/plan/analysis/onlypreview.md` | 0 |
| 4 | `docs/plan/README.md` | 0 |
| 5 | `electron.vite.config.ts` | 0 |
| 6 | `src/main/windows/onlyPreviewWindow.helper.ts` | 0 |
| 7 | `src/main/onlypreview/onlyPreviewSearchBootstrap.registry.ts` | 0 |
| 8 | `src/main/xpc/onlyPreviewSearchAuthority.handler.ts` | 0 |
| 9 | `src/preload/onlypreview/onlypreviewContent.preload.ts` | 0 |
| 10 | `src/shared/onlypreview/onlyPreviewSearch.type.ts`, `onlyPreviewSearch.contract.ts`, `onlyPreviewSearchBootstrap.types.ts`, `onlyPreview.types.ts` | 0 |
| 11 | `src/preload/onlypreview/search/core/constants.mjs`, `classification.mjs`, `normalization.mjs`, `search-contract.mjs`, `chunking.mjs`, `glob-config.mjs`, `workspace-config.mjs` | 0 |
| 12 | `src/preload/onlypreview/search/core/traversal.mjs`, `work-slicer.mjs`, `watch-controller.mjs` | 0 |
| 13 | `src/preload/onlypreview/search/core/filename-tier.mjs`, `sqlite-schema.mjs`, `sqlite-index.mjs`, `search-engine.mjs` | 0 |
| 14 | `src/preload/onlypreview/search/core/result-batcher.mjs`, `single-flight.mjs`, `worker-client.mjs` | 0 |
| 15 | `src/preload/onlypreview/search/onlyPreviewSearchWorker.protocol.ts`, `onlyPreviewSearchWorker.entry.ts`, `onlyPreviewSearchWorker.client.ts`, `onlyPreviewSearchRuntime.handler.ts` | 0 |
| 16 | `src/renderer/onlypreview/previewHeader/index.html`, `src/App.vue`, `src/App.less`, `src/main.ts`, `src/onlyPreviewPreviewHeader.store.ts` | 0 |
| 17 | `src/renderer/onlypreview/shell/src/App.vue`, `App.less`, `onlyPreviewShell.store.ts`, `onlyPreviewProjectSearch.store.ts` | 0 |
| 18 | `src/renderer/onlypreview/shell/src/onlyPreviewSearch.client.ts`, `onlyPreviewSearchBatch.service.ts`, `onlyPreviewSearchSnapshot.service.ts` | 0 |
| 19 | `src/renderer/onlypreview/shell/src/components/ProjectSearchResults/ProjectSearchResults.vue`, `ProjectSearchResults.less`, `onlyPreviewSearchHighlight.service.ts` | 0 |
| 20 | `tests/onlypreview/onlyPreviewSearchEngine.contract.test.mjs`, `onlyPreviewSearchEngine.sqlite.test.mjs`, `onlyPreviewSearchEngine.traversal.test.mjs`, `onlyPreviewSearchEngine.worker.test.mjs` | 0 |
| 21 | `tests/onlypreview/onlyPreviewSearchShell.test.mjs`, `onlyPreviewSearchWindowIntegration.test.mjs` | 0 |
| 22 | `tests/onlypreview/onlyPreviewCore.test.mjs` | 1 |

# Findings

## 22. `tests/onlypreview/onlyPreviewCore.test.mjs`

| # | Severity | Delivery | Lines | Rule | Finding | Recommendation |
|---|---|---|---|---|---|---|
| 22.1 | P3 | non-blocking | 1-2001 | TS-1 | The shared OnlyPreview source-test file is 2,001 lines, above the 800-line rule. It was already 1,937 lines before task 012; this delivery adds focused integration guards but does not create the oversized-file condition. | Split the shared source guards by capability in a separate maintenance task instead of broadening this search delivery. |

# Resolved During Review

- Fresh SQLite builds now collect filename records and finalize/sort the tier once. Bulk reconcile
  similarly suppresses per-file tier rebuilding and hydrates once after changed, missing, and stale
  rows converge. Deterministic tests assert one rebuild rather than relying on wall-clock timing.
- Initial indexing emits one empty `building`/`reconciling` snapshot and one full `ready` snapshot;
  it no longer structured-clones the growing tree every 500 files.
- Shell accepts a search snapshot event only after exact nested validation of event, snapshot,
  index, dense entries, normalized contained paths, enums, finite values, and memory telemetry.
- A rejected watch reconciliation is promoted to one retained full-reconcile latch with capped
  exponential backoff. New paths coalesce while it is pending, and only success or close clears it.
- Matching `building` or `reconciling` databases preserve committed rows on reopen. Metadata
  reconciliation reuses unchanged content, updates/newly indexes changed rows, deletes stale rows,
  and marks the database ready only after convergence.

# Contract Evidence

- Shell, PreviewHeader, and PreviewContent are distinct sibling `WebContentsView` instances.
  PreviewContent alone uses `sandbox: false`; every page retains context isolation, disabled page
  Node integration, web security, and exact navigation fences
  (`src/main/windows/onlyPreviewWindow.helper.ts:560-669`).
- The private Content-only bootstrap resolves the current workspace to absolute root/database paths
  inside preload authority. Renderer contracts expose only opaque workspace IDs, relative metadata,
  exact search rows, and aggregate telemetry
  (`src/main/onlypreview/onlyPreviewSearchBootstrap.registry.ts`,
  `src/main/xpc/onlyPreviewSearchAuthority.handler.ts`).
- The Worker owns traversal, strict classification/decode, SQLite v6, chunks, CJK postings,
  short-query `instr`, exact verification, snippets, watch, and memory measurement. Main performs no
  project traversal or searchable body I/O.
- Search scheduling is fixed 120ms leading plus trailing and IME-aware. Content preload permits one
  active and one latest pending request, while the Worker observes private Atomics cancellation and
  streams verified upserts in batches capped at 50 rows or 16ms.
- Project Search returns files only, searches all titles, indexes content only for text, and keeps
  title-only/non-text rows summary-free. Snippets retain original graphemes under the exact 16/48
  budget and are rendered as text plus `<mark>`, never HTML.
- Runtime signals are evaluated independently at strict 1GiB/2GiB thresholds. SQLite footprint is
  labelled separately and never summed into RAM.

# Code Review Rules

- TS-1: all new 012 production files are below 800 lines; the single shared-test baseline is
  recorded above.
- TS-2: no replaceable standalone `function` declaration was introduced. Generator expressions use
  generator syntax because JavaScript has no generator-arrow equivalent.
- FE-1: Project Search scheduling/state/actions live in `onlyPreviewProjectSearch.store.ts`; Vue
  components remain presentation and event binding.
- FE-2: the result component does not emit business events upward; it invokes its imported store
  controller.

# Verification

| Check | Result |
|---|---|
| Focused 012 Node/source suite | PASS — 40/40 |
| `node --test tests/onlypreview/*.test.mjs` | 107/108 — only unrelated concurrent Omni literal-regex baseline fails |
| `yarn typecheck:node` | PASS |
| `yarn typecheck:web` comparison | Existing 78 repository diagnostics; 0 OnlyPreview search diagnostics |
| `yarn check:renderer-i18n` | PASS |
| `yarn test:application-diagnostics` | PASS — 12/12 |
| Focused TS/Vue ESLint | PASS |
| Search-core `node --check` | PASS |
| Scoped whitespace / `git diff --check` | PASS |

The repository ESLint configuration does not disable TypeScript-only explicit-return rules for
`.mjs`, so directly linting the pure-JavaScript engine surface produces existing configuration
noise. The engine is instead covered by `node --check` and the pure Node contract suites; this
review does not hide that tooling caveat by adding fake TypeScript annotations to JavaScript.

# Runtime Boundary

This review did not launch Electron, Playwright, E2E, the full Bitterless application, a build, or
any Keychain/Ops path. Ral retains manual acceptance for first-open background indexing, live file
updates, shortcuts, incremental rendering, memory indicators, and packaged Worker/SQLite loading.
