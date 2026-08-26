# OnlyPreview Draw.io read-only 032 · independent re-review 2

- Result: **BLOCKED**
- Date: 2026-08-26
- Scope: task 032 authored TypeScript/Vue/tests plus the hash-pinned viewer assets. Unrelated
  Maestro/Home worktree changes were excluded.
- Review rules: `TS-1`, `TS-2`, `FE-1`, and `FE-2` for the standard code-review section;
  delivery-contract, security, performance, and test findings are reported separately.
- E2E/live app: intentionally not run; Ral owns runtime and visual acceptance.

## Code Review 报告

### 文件清单

| # | 文件 | 问题数 |
|---|------|--------|
| 1 | `src/shared/onlypreview/onlyPreview.types.ts` | 0 |
| 2 | `src/shared/onlypreview/onlyPreview.contract.ts` | 0 |
| 3 | `src/shared/onlypreview/onlyPreviewFind.registry.ts` | 0 |
| 4 | `src/main/onlypreview/onlyPreviewClassifier.service.ts` | 0 |
| 5 | `src/main/onlypreview/views/onlyPreviewPreviewAdapter.service.ts` | 0 |
| 6 | `src/main/onlypreview/views/onlyPreviewPreviewRegion.service.ts` | 0 |
| 7 | `src/main/onlypreview/views/onlyPreviewPreviewView.service.ts` | 0 |
| 8 | `src/renderer/onlypreview/common/onlyPreviewI18n.ts` | 0 |
| 9 | `src/renderer/onlypreview/common/onlyPreviewPresentation.service.ts` | 0 |
| 10 | `src/renderer/onlypreview/preview/src/components/PreviewSurface/PreviewSurface.vue` | 0 |
| 11 | `src/renderer/onlypreview/preview/src/components/DrawioPreview/DrawioPreview.vue` | 0 |
| 12 | `src/renderer/onlypreview/preview/src/components/DrawioPreview/DrawioPreview.store.ts` | 0 |
| 13 | `src/renderer/onlypreview/preview/src/components/DrawioPreview/DrawioPreview.less` | 0 |
| 14 | `src/renderer/onlypreview/preview/src/onlyPreviewDrawio.service.ts` | 0 |
| 15 | `src/renderer/onlypreview/preview/src/onlyPreviewDrawioPreflight.service.ts` | 0 |
| 16 | `src/renderer/onlypreview/preview/src/onlyPreviewDrawioSelection.store.ts` | 0 |
| 17 | `src/renderer/onlypreview/preview/src/workers/onlyPreviewDrawioPreflight.worker.ts` | 0 |
| 18 | `src/renderer/onlypreview/preview/src/workers/onlyPreviewDrawioWorker.contract.ts` | 0 |
| 19 | `src/renderer/onlypreview/preview/src/onlyPreviewPreview.store.ts` | 0 |
| 20 | `tests/onlypreview/onlyPreviewAdapterSource.test.mjs` | 0 |
| 21 | `tests/onlypreview/onlyPreviewDocumentProtocol.test.mjs` | 0 |
| 22 | `tests/onlypreview/onlyPreviewDrawioPreflight.test.mjs` | 0 |
| 23 | `tests/onlypreview/onlyPreviewDrawioPreviewRegion.test.mjs` | 0 |
| 24 | `tests/onlypreview/onlyPreviewDrawioSession.test.mjs` | 0 |
| 25 | `tests/onlypreview/onlyPreviewDrawioSource.test.mjs` | 0 |
| 26 | `tests/onlypreview/onlyPreviewFind.test.mjs` | 0 |
| 27 | `tests/onlypreview/onlyPreviewPreviewGuards.test.mjs` | 0 |
| 28 | `tests/onlypreview/onlyPreviewPreviewRegionTest.helper.mjs` | 0 |
| 29 | `tests/onlypreview/onlyPreviewRenderingTest.helper.mjs` | 0 |
| 30 | `tests/onlypreview/onlyPreviewSheetController.test.mjs` | 0 |
| 31 | `tests/onlypreview/onlyPreviewSourceIntegration.test.mjs` | 0 |
| 32 | `src/renderer/onlypreview/preview/src/vendor/drawio/viewer-static.min.js` | 0 (pinned third-party asset) |
| 33 | `src/renderer/onlypreview/preview/src/vendor/drawio/LICENSE` | 0 (third-party license) |

The byte-identical vendored viewer is an immutable third-party build artifact. It was hash-audited
rather than treated as authored source under `TS-1`/`TS-2`.

### 问题清单

None. Every authored implementation and focused test file is at or below 800 lines; no replaceable
`function` declaration/expression, Vue business-flow-in-SFC, or parameterized business `emit` was
found. Review 1's four `TS-1`/`FE-1`/`FE-2` findings are remediated.

## Task-contract / functional / performance audit

### Blocking finding

#### [P1] XML character references bypass the pre-viewer image rejection fence

- Evidence:
  - `src/renderer/onlypreview/preview/src/onlyPreviewDrawioPreflight.service.ts:164-177` and
    `:218` classify image-bearing tags by applying regular expressions to the raw XML token. They
    do not decode legal XML character references in attribute names/values before evaluating the
    rendered semantics.
  - The valid payload
    `style="shape&#61;image&#59;image&#61;data&#58;image/png;base64,AAAA"` is accepted by
    `preflightOnlyPreviewDrawio`. Independent execution confirmed acceptance through all three
    required page representations: direct, XML-escaped, and compressed.
  - When the official viewer parses the same original XML, those numeric references become
    `shape=image;image=data:image/png;base64,AAAA`; the resource therefore reaches Chromium/GPU
    despite phase one's mandatory image rejection.
  - `tests/onlypreview/onlyPreviewDrawioPreflight.test.mjs:110-139` covers raw image syntax only.
    It does not cover entity-normalized attributes or the escaped image-bearing page path, so its
    "every image-bearing graph" claim passes while the fence is bypassable.
- Impact: an admitted file can still carry embedded or external image resources, including hostile
  raster/SVG decode work. This reopens the exact renderer/GPU allocation risk task 032 is intended
  to prevent before viewer load.
- Required fix: canonicalize every relevant XML attribute value with a strict bounded XML-entity
  decoder before image/style/source classification (or reject character references in those
  semantics), then add behavior tests for direct, escaped, and compressed pages with named/numeric,
  mixed-case, zero-padded, and double-escaped variants. The test must also prove the viewer loader
  was not invoked.

### Non-blocking test finding

#### [P2] Viewer mount/teardown acceptance is asserted from source text, not executed behavior

- Evidence: `tests/onlypreview/onlyPreviewDrawioSource.test.mjs:10-50` and `:79-116` use regex/source
  assertions for `data-mxgraph`, `GraphViewer.processElements`, CSP, async components, readiness,
  and teardown wiring. No test executes `renderOnlyPreviewDrawio` or `DrawioPreviewStore` against a
  controlled DOM/GraphViewer double.
- Impact: callback ordering, no-mount-before-runtime, `viewerInitialized` capture, external-action
  prevention, stale handle disposal, one-time graph destruction, and failure cleanup can break
  while the source-pattern suite stays green. This falls short of task 032's focused viewer
  loader/teardown verification requirement.
- Suggested fix: add a behavioral DOM/GraphViewer harness that observes those lifecycle effects;
  retain source/hash checks only for immutable asset, CSP, and build-boundary properties.

### Passing contract checks

- File admission uses one typed dictionary with a 10MiB fallback, preserved existing overrides,
  and a 20MiB Draw.io override; classifier, asset issuance, and renderer admission share the helper.
- Outer XML and compressed pages now form a genuinely chunked bounded pipeline: fixed-size UTF-8
  input decoding, quartet base64 decoding, `DecompressionStream` backpressure, streaming percent /
  fatal UTF-8 decoding, and bounded XML scanning. No whole base64 string, `atob`, inflate-chunk
  array, contiguous inflated page, `decodeURIComponent`, `TextEncoder` recount, or `join` copy is
  present. The aggregate decoded XML cap remains 32MiB with 128-page and 20,000-cell caps.
- Worker cancellation, immediate pending settlement, response identity fences, the non-renewing
  ten-second preflight deadline, the exact 30-second Main watchdog, and stale-revision fences are
  present. Draw.io exit destroys/recreates the exact Vue Preview view.
- Every Vue format SFC is adapter-selected through `defineAsyncComponent`; the 4.15MiB pinned viewer
  is loaded only after Worker preflight. The production output contains separate Draw.io SFC,
  Worker, and viewer artifacts with no viewer preload in Preview HTML.
- The viewer mounts into owned DOM without iframe/`innerHTML`; Preview CSP and the Main navigation
  fence remain remote/frame-free. `drawio-viewer` correctly registers `find: none`.
- Viewer and license SHA-256 values match the task pins.

## Verification evidence

| Command | Result |
|---------|--------|
| `node --test --test-reporter=spec tests/onlypreview/*.test.mjs` | PASS, 356/356 |
| Focused Draw.io/Region/Find/guard suite | PASS, 34/34 |
| Independent direct/escaped/compressed entity-image probe | **FAIL contract:** all three bypasses accepted |
| `yarn typecheck:node` | PASS |
| `yarn typecheck:web` | BASELINE BLOCKED; existing Poker/Home/Chat/Maestro/Omni/path-helper diagnostics only, zero OnlyPreview diagnostics |
| `yarn check:renderer-i18n` | BASELINE BLOCKED: existing `Tray must follow Home creation` assertion |
| `node scripts/environment/runWithRuntimeProfile.cjs debug_dev -- yarn electron-vite build` | PASS; separate 19.32kB Worker, 2.8kB Draw.io SFC, and 4,151.72kB viewer artifacts; no viewer preload |
| Viewer/license SHA-256 audit | PASS |
| `git diff --check` | PASS |

Electron/Playwright E2E and the real app were not run.
