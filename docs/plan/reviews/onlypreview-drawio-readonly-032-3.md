# OnlyPreview Draw.io read-only 032 · final independent re-review 3

- Result: **PASS**
- Date: 2026-08-26
- Scope: task 032 authored TypeScript/Vue/tests, the hash-pinned official viewer assets, and the
  remediation of every blocker recorded in reviews 1 and 2. Unrelated Maestro/Home changes in the
  working tree were excluded.
- Review rules: `TS-1`, `TS-2`, `FE-1`, and `FE-2` for the standard code-review section;
  delivery-contract, security, performance, and behavioral verification are reported separately.
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
| 26 | `tests/onlypreview/onlyPreviewDrawioViewer.test.mjs` | 0 |
| 27 | `tests/onlypreview/onlyPreviewFind.test.mjs` | 0 |
| 28 | `tests/onlypreview/onlyPreviewPreviewGuards.test.mjs` | 0 |
| 29 | `tests/onlypreview/onlyPreviewPreviewRegionTest.helper.mjs` | 0 |
| 30 | `tests/onlypreview/onlyPreviewRenderingTest.helper.mjs` | 0 |
| 31 | `tests/onlypreview/onlyPreviewSheetController.test.mjs` | 0 |
| 32 | `tests/onlypreview/onlyPreviewSourceIntegration.test.mjs` | 0 |
| 33 | `src/renderer/onlypreview/preview/src/vendor/drawio/viewer-static.min.js` | 0 (pinned third-party asset) |
| 34 | `src/renderer/onlypreview/preview/src/vendor/drawio/LICENSE` | 0 (third-party license) |

The byte-identical vendored viewer is an immutable third-party build artifact. It is hash-audited
instead of treated as authored source under `TS-1`/`TS-2`.

### 问题清单

None. Every reviewed authored TS/JS/SFC is at or below 800 lines. No replaceable `function`
declaration/expression, Vue business flow left in the Draw.io SFC, or parameterized business
`emit` was found. Review 1's `TS-1`, `FE-1`, and `FE-2` blockers remain closed.

## Task-contract / functional / performance audit

### Review 1 blocker closure

- **Bounded memory and backpressure: PASS.** Draw.io admission is 20MiB, expanded graph XML is
  capped at an aggregate 32MiB, and page/cell counts are capped at 128/20,000. Outer UTF-8 input,
  URL-safe base64, raw DEFLATE output, percent/fatal-UTF-8 decoding, and XML scanning are fixed-size
  streaming stages. `DecompressionStream` writer/read work runs concurrently with backpressure; no
  full base64 string, `atob` binary string, inflate chunk array plus contiguous copy,
  `decodeURIComponent` page copy, or `TextEncoder` recount remains. The 10-second Worker deadline
  bounds adversarial CPU work outside the UI thread.
- **Image decode/GPU fence: PASS.** The Worker rejects image shapes/sources, external URLs,
  embedded raster/SVG/data/blob content, `mxImage`/`image`/SVG markup, and tested hostile dimensions
  before the official viewer can run. The viewer receives no partial model.
- **Structure and Vue ownership: PASS.** Region/adapter, Draw.io selection/controller, and focused
  tests are split below 800 lines. `DrawioPreview.vue` contains only DOM/lifecycle binding; its
  store owns viewer workflow and reports by revision without a parameterized emit.

### Review 2 blocker closure

- **XML entity image bypass: PASS.** Every graph tag receives one strict, bounded XML predefined /
  decimal / hexadecimal character-reference canonicalization pass before semantic image scanning.
  Unknown entities and illegal XML 1.0 code points fail closed. Authored coverage rejects mixed
  decimal/hexadecimal, upper-case `X`, zero-padded, direct, outer-escaped, and compressed variants.
  An independent additional probe rejected nine malicious representation combinations, including
  entity-obfuscated `shape`, `image`, `stencil`, `data:`, `blob:`, and external-source semantics;
  a semantically literal double escape remained accepted rather than being over-decoded.
- **Executed viewer lifecycle coverage: PASS.** The jsdom/`GraphViewer` double executes the mount,
  verifies the exact `data-mxgraph` read-only config and callback restoration, proves click /
  auxclick / dragstart external actions are prevented, verifies rejection cleanup, and proves
  idempotent disposal destroys the graph exactly once and removes owned listeners/classes/DOM.
  Entity rejection also proves neither `processElements` nor the script loader is invoked.

### Remaining contract checks

- One typed file-size dictionary supplies the exact 10MiB fallback, preserved existing adapter
  overrides, the 20MiB Draw.io override, and explicit `null` streaming policies for audio/video.
  Classifier admission, asset issuance, and renderer admission all consume the shared helper.
- `.drawio` routes only to `diagram` / `drawio-viewer`; `find: none` keeps current-file Find
  truthfully unavailable in this phase.
- All Vue format SFCs are adapter-selected `defineAsyncComponent` imports. The approximately 4MiB
  viewer is loaded only after revision-bound bytes pass Worker preflight; Preview HTML contains no
  preload for it.
- The viewer mounts directly into an owned DOM element with DOM attributes—no iframe, webview, or
  `innerHTML`. The packaged viewer/license hashes match their pins. CSP is frame-free and remote-
  free for image/connect sources, and Main denies Preview navigation/popups.
- Worker disposal immediately settles pending work, terminates the exact Worker, and fences host /
  runtime / revision / generation / request identities. Main owns one non-renewing 30-second
  Draw.io loading watchdog. Leaving Draw.io destroys/recreates the exact Vue Preview WebContents,
  fencing document-global viewer state from the next adapter or revision.

No new correctness, security, or device-freeze blocker was found. Final visual/runtime acceptance
remains the owner's step because Electron E2E and the real app were intentionally excluded.

## Verification evidence

| Command / audit | Result |
|-----------------|--------|
| Focused Draw.io/Region/Find/guard suite | **PASS, 38/38** |
| Independent entity/image probe | **PASS:** 9 malicious representations rejected; one semantically literal double escape accepted |
| `node --test --test-reporter=spec tests/onlypreview/*.test.mjs` | **PASS, 360/360**; zero failed/cancelled/skipped/todo |
| `yarn typecheck:node` | **PASS** |
| Authored TS/JS/SFC line-count and `function` audit | **PASS** |
| Viewer/license SHA-256 audit | **PASS:** `2fabaaa3...93a297`, `43070e2d...379c1` |
| `git diff --check` | **PASS** |

`yarn typecheck:web`, renderer-i18n, and the production build were not repeated in this final
review; the task's final evidence already records the unrelated web/i18n baselines and a passing
debug-dev build with separate Worker, Draw.io component, and viewer artifacts. Electron/Playwright
E2E and the real application were not run.
