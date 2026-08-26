# OnlyPreview Draw.io read-only 032 · independent review

- Result: **BLOCKED**
- Date: 2026-08-26
- Scope: task 032 authored TypeScript/Vue/tests, pinned viewer assets, and the Draw.io delivery
  contract. Maestro/Home changes in the same worktree were excluded.
- Review rules: `TS-1`, `TS-2`, `FE-1`, `FE-2` only for the standard code-review section;
  task-contract, functional, security, and performance findings are reported separately.
- E2E/live app: intentionally not run; Ral owns runtime and visual acceptance.

## Code Review 报告

### 文件清单

| # | 文件 | 问题数 |
|---|------|--------|
| 1 | `src/shared/onlypreview/onlyPreview.types.ts` | 0 |
| 2 | `src/shared/onlypreview/onlyPreview.contract.ts` | 0 |
| 3 | `src/shared/onlypreview/onlyPreviewFind.registry.ts` | 0 |
| 4 | `src/main/onlypreview/onlyPreviewClassifier.service.ts` | 0 |
| 5 | `src/main/onlypreview/views/onlyPreviewPreviewRegion.service.ts` | 1 |
| 6 | `src/main/onlypreview/views/onlyPreviewPreviewView.service.ts` | 0 |
| 7 | `src/renderer/onlypreview/common/onlyPreviewI18n.ts` | 0 |
| 8 | `src/renderer/onlypreview/common/onlyPreviewPresentation.service.ts` | 0 |
| 9 | `src/renderer/onlypreview/preview/src/components/PreviewSurface/PreviewSurface.vue` | 0 |
| 10 | `src/renderer/onlypreview/preview/src/components/DrawioPreview/DrawioPreview.vue` | 2 |
| 11 | `src/renderer/onlypreview/preview/src/components/DrawioPreview/DrawioPreview.less` | 0 |
| 12 | `src/renderer/onlypreview/preview/src/onlyPreviewDrawio.service.ts` | 0 |
| 13 | `src/renderer/onlypreview/preview/src/onlyPreviewDrawioPreflight.service.ts` | 0 |
| 14 | `src/renderer/onlypreview/preview/src/workers/onlyPreviewDrawioPreflight.worker.ts` | 0 |
| 15 | `src/renderer/onlypreview/preview/src/workers/onlyPreviewDrawioWorker.contract.ts` | 0 |
| 16 | `src/renderer/onlypreview/preview/src/onlyPreviewPreview.store.ts` | 1 |
| 17 | `tests/onlypreview/onlyPreviewAdapterSource.test.mjs` | 0 |
| 18 | `tests/onlypreview/onlyPreviewDocumentProtocol.test.mjs` | 0 |
| 19 | `tests/onlypreview/onlyPreviewDrawioPreflight.test.mjs` | 0 |
| 20 | `tests/onlypreview/onlyPreviewDrawioSession.test.mjs` | 0 |
| 21 | `tests/onlypreview/onlyPreviewDrawioSource.test.mjs` | 0 |
| 22 | `tests/onlypreview/onlyPreviewFind.test.mjs` | 0 |
| 23 | `tests/onlypreview/onlyPreviewPreviewGuards.test.mjs` | 0 |
| 24 | `tests/onlypreview/onlyPreviewPreviewRegion.test.mjs` | 1 |
| 25 | `tests/onlypreview/onlyPreviewPreviewRegionTest.helper.mjs` | 0 |
| 26 | `tests/onlypreview/onlyPreviewRenderingTest.helper.mjs` | 0 |
| 27 | `tests/onlypreview/onlyPreviewSheetController.test.mjs` | 0 |
| 28 | `src/renderer/onlypreview/preview/src/vendor/drawio/viewer-static.min.js` | 0 (pinned third-party asset) |
| 29 | `src/renderer/onlypreview/preview/src/vendor/drawio/LICENSE` | 0 (third-party license) |

The pinned, byte-identical `viewer-static.min.js` is an immutable third-party build artifact, so it
is hash-audited rather than evaluated as authored source under `TS-1`/`TS-2`.

### 问题清单

#### 5. `src/main/onlypreview/views/onlyPreviewPreviewRegion.service.ts`

| # | 行 | 规则 | 问题 | 建议 |
|---|----|------|------|------|
| 5.1 | 1-828 | TS-1 | 当前文件 828 行，超过 800 行上限；task 032 继续将 Draw.io asset/watchdog/rebuild 流程写入该文件。 | 将 descriptor→adapter/asset policy 或 Vue runtime transition/rebuild 责任拆成独立 service，保留 Region 编排。 |

#### 10. `src/renderer/onlypreview/preview/src/components/DrawioPreview/DrawioPreview.vue`

| # | 行 | 规则 | 问题 | 建议 |
|---|----|------|------|------|
| 10.1 | 32-59 | FE-1 | SFC 内直接编排 viewer 异步创建、错误映射、stale 状态与 dispose 流程，不是主要做双向绑定。 | 新增 `DrawioPreview.store.ts`/controller 持有 mount/unmount/error 状态，SFC 仅绑定 DOM ref 和 lifecycle 入口。 |
| 10.2 | 27-30, 51 | FE-2 | 业务组件通过 `emit('error', reportingRevision, errorCode)` 向父级传业务参数。 | 与 `DocumentPreview`/`SheetPreview` 一致，由组件 controller 直接调用 Preview Store 的 revision-fenced 失败入口；不经父级转发。 |

#### 16. `src/renderer/onlypreview/preview/src/onlyPreviewPreview.store.ts`

| # | 行 | 规则 | 问题 | 建议 |
|---|----|------|------|------|
| 16.1 | 1-805 | TS-1 | task 032 加入 Draw.io session/state/branch 后文件达 805 行，超过 800 行上限。 | 将 Draw.io selection/session controller 拆到独立 `*.store.ts` 或将通用 asset-session 编排拆出，主 Store 只保留选中态。 |

#### 24. `tests/onlypreview/onlyPreviewPreviewRegion.test.mjs`

| # | 行 | 规则 | 问题 | 建议 |
|---|----|------|------|------|
| 24.1 | 1-864 | TS-1 | task 032 加入 Draw.io Region 测试后文件达 864 行，超过 800 行上限。 | 将 Draw.io watchdog/exit tests 移入聚焦的 `onlyPreviewDrawioPreviewRegion.test.mjs`，共用现有 harness。 |

`TS-2`: none. No authored task-032 function declaration/expression that can be replaced by an
arrow function was found.

## Task-contract / functional / performance audit

### Blocking findings

#### [P1] Worker preflight permits multi-hundred-MiB transient allocation for one admitted file

- Evidence:
  - `src/shared/onlypreview/onlyPreview.types.ts:218` admits 50MiB Draw.io files.
  - `src/renderer/onlypreview/preview/src/onlyPreviewDrawioPreflight.service.ts:78-128`
    creates a base64-compacted string, `atob` binary string, decoded `Uint8Array`, an array of up to
    64MiB inflate chunks, then a second contiguous 64MiB output while the chunks are still retained.
  - `src/renderer/onlypreview/preview/src/onlyPreviewDrawioPreflight.service.ts:131-165` then creates
    decoded page strings and a full `TextEncoder.encode(source)` allocation solely to count bytes.
  - `src/renderer/onlypreview/preview/src/onlyPreviewDrawio.service.ts:110-119` transfers the original
    bytes back and decodes another full XML string before the viewer parses/duplicates the model.
- Impact: a legal 50MiB/64MiB-bound input can transiently retain the original buffer/string,
  base64 intermediates, inflate chunks plus concatenated output, URI-decoded string, byte-count
  copy, and then the viewer DOM/model. The Worker deadline limits time but not instantaneous memory;
  this can OOM/kill the renderer or create system-wide memory pressure on a smaller device, directly
  violating the no-device-freeze delivery requirement.
- Required fix: make the compressed-page path genuinely streaming under one aggregate allocation
  budget: chunked base64 decode, stream inflate into a streaming fatal UTF-8/URI/XML validator,
  avoid the chunk-array + contiguous-output double buffer and `TextEncoder` recount, and return only
  the representation actually needed by the viewer. Add a peak-allocation/large-bound fixture audit
  before keeping the 50MiB file and 64MiB expanded limits.

#### [P1] Embedded image decode cost is not bounded before the viewer reaches Chromium/GPU

- Evidence:
  - `src/renderer/onlypreview/preview/src/onlyPreviewDrawioPreflight.service.ts:151-165` validates only
    graph wrapper, expanded XML bytes, and `mxCell` count; it does not inspect image sources, decoded
    payload size, raster dimensions, SVG complexity, or geometry.
  - `src/renderer/onlypreview/preview/src/onlyPreviewDrawio.service.ts:348-359` hands the entire accepted
    XML to the official viewer unchanged.
  - `src/renderer/onlypreview/preview/index.html:7` intentionally permits `data:` and `blob:` images.
- Impact: a small compressed PNG/WebP with extreme declared dimensions, or a complex embedded SVG,
  can pass the 64MiB XML and 20,000-cell caps and trigger a much larger decode/raster/GPU allocation
  on the Vue renderer's UI thread. The 30-second Main watchdog can destroy a stalled renderer later,
  but it cannot prevent the allocation/OOM event.
- Required fix: during Worker preflight, enumerate every image-bearing cell/style and either replace
  embedded/external images with bounded placeholders for this read-only phase, or decode headers and
  enforce aggregate encoded bytes, exact supported MIME types, conservative raster dimensions/pixel
  count, and bounded/sanitized SVG complexity before loading the viewer. Add hostile image-dimension
  and embedded-SVG fixtures.

### Passing contract checks

- One typed size-policy dictionary is present: 10MiB fallback, preserved existing overrides,
  50MiB `drawio-viewer`, explicit streaming `null` for audio/video. Classifier, asset issue, and
  Draw.io renderer admission call the same helper.
- `.drawio` routes by extension to `diagram`/`drawio-viewer`; `find: none` is exhaustive and the UI
  does not claim text search.
- The official viewer and license hashes match the task pins. The mount uses an ordinary owned DOM
  element; no application iframe/`innerHTML` path exists. CSP keeps `frame-src`/`object-src` and
  remote image/connect sources disabled, while the Main navigation fence denies popups/navigation.
- Viewer code is loaded only after the revision-bound asset passes Worker preflight. The production
  build emits the Worker, Draw.io SFC, and 4.15MiB viewer as separate artifacts and adds no viewer
  preload to `onlypreview/preview/index.html`.
- All format SFCs in `PreviewSurface.vue` are adapter-selected async components. Existing Shell and
  common Store startup remain eager as allowed by task 032.
- Worker settlement terminates the exact Worker; dispose settles a pending request immediately;
  response envelopes are host/runtime/revision/generation/request fenced.
- Main owns one non-renewing 30-second Draw.io loading watchdog. Draw.io exit destroys/recreates the
  exact Vue Preview view, preventing its document-global `GraphViewer` state from reaching another
  adapter or revision.
- Existing format and OnlyPreview regression tests pass. No task-032 diagnostics appeared in the
  known-broken web typecheck baseline.

## Verification evidence

| Command | Result |
|---------|--------|
| `node --test --test-reporter=spec tests/onlypreview/onlyPreviewDrawioPreflight.test.mjs tests/onlypreview/onlyPreviewDrawioSession.test.mjs tests/onlypreview/onlyPreviewDrawioSource.test.mjs tests/onlypreview/onlyPreviewPreviewRegion.test.mjs tests/onlypreview/onlyPreviewPreviewGuards.test.mjs tests/onlypreview/onlyPreviewFind.test.mjs` | PASS, 53/53 |
| `node --test --test-reporter=spec tests/onlypreview/*.test.mjs` | PASS, 352/352 |
| `yarn typecheck:node` | PASS |
| `yarn typecheck:web` | BASELINE BLOCKED: existing Poker globals, Connector/Home/Chat/Maestro/Omni window/module typing, and shared path-helper errors; zero OnlyPreview diagnostics |
| `yarn check:renderer-i18n` | BASELINE BLOCKED: existing `Tray must follow Home creation` assertion |
| Focused `yarn eslint --quiet ...` | PASS |
| Focused `yarn prettier --check ...` | PASS |
| `node scripts/environment/runWithRuntimeProfile.cjs debug_dev -- yarn electron-vite build` | PASS; separate format SFC chunks, 7.28kB Draw.io Worker, 2.4kB Draw.io SFC, 4,151.72kB viewer; no viewer preload |
| `git diff --check` | PASS |

## Non-code contract artifacts reviewed

- `docs/design/onlypreview-format-coverage.md`
- `docs/design/onlypreview-preview-merge-find.md`
- `docs/features/onlypreview.md`
- `docs/plan/analysis/onlypreview.md`
- `docs/plan/README.md`
- `docs/plan/tasks/onlypreview-drawio-readonly-032.md`

The documented 10MiB default / 50MiB Draw.io override, async SFC boundary, no-iframe/offline
viewer, `find: none`, 10-second Worker deadline, 30-second Main watchdog, and owner verification
checklist agree with the implementation. The two P1 performance findings above must be resolved or
the limits/feature contract narrowed before this review can pass.
