# Task 077 independent review — Office OOXML renderers

- Date: 2026-08-28
- Scope: Task 077 production path for `.xlsx` / `.xlsm` / `.docx` / `.pptx`, Office Find, OOXML admission, CSP and bundling
- Result: **changes required**
- Electron / Playwright / packaged-app E2E: not run (explicitly excluded)

## Findings

### P1 — post-ready viewer errors are not connected to the Preview error lifecycle

**Evidence**

- `src/renderer/onlypreview/preview/src/onlyPreviewOfficeSession.service.ts:235-245`
  constructs `XlsxViewer` without `onError`.
- The DOCX and PPTX constructors at `:257-271` and `:284-298` also omit `onError`.
- The pinned package exposes `onError` on `XlsxSheetViewerOptions`,
  `DocxScrollViewerOptions`, and `PptxScrollViewerOptions`. Its virtualized viewers can report a
  later page/slide/cell render error after `load()` and `waitUntilLayoutComplete()` have resolved.
- `src/main/onlypreview/views/onlyPreviewPreviewRegion.service.ts:426-470` clears the 30-second
  watchdog once the renderer reports ready. Therefore a later scroll/virtual-page failure is not
  caught by the external watchdog either.

**Impact**

The affected viewer can remain published as `ready` while later virtualized content fails and the
library only writes its default console error. Find capability and selected-text truth then remain
advertised against a partially failed viewer. Repeated lazy render attempts may also keep spending
CPU after the user-visible content has failed.

**Recommendation**

Pass a generation-fenced `onError` to all three constructors. On the first error, map to the
format-specific parse/render error, make the session terminal, destroy the exact viewer, and invoke
the existing `onRuntimeError` route so Store/Main demote truth and rebuild where required. Add a
test that triggers `onError` after ready and proves one error report, one destroy, Find clear, and no
late callback from an old selection.

### P1 — a timed-out superseded Find can later erase the newest query's highlights

**Evidence**

- `src/renderer/onlypreview/preview/src/onlyPreviewOfficeSession.service.ts:194-202` serializes
  commands, but `Promise.race()` at `:308-343` cannot cancel the viewer's underlying `findText()`.
- If query A is superseded by query B, A's generation is already stale. When A reaches its
  10-second timeout, `:329-330` rethrows without clearing/reporting/poisoning the viewer because A is
  no longer current; the queue is then free to execute B on the same viewer.
- If A's still-running `findText()` settles after B, `requireCurrentFind()` at `:507-515` calls
  `viewer.clearFind()` unconditionally. That clears B's installed highlights after B may already
  have reported its result.

**Impact**

Under a slow or adversarial Office model, the UI can show a valid count/ordinal for query B while
all B highlights disappear, or briefly expose query A's stale internal state. This violates the
task's stale-generation and persistent-highlight contract.

**Recommendation**

Treat any Find deadline as a terminal viewer/session failure even when that command has since been
superseded: prevent later queued work from running on the same viewer, destroy it, and route the
typed timeout through `onRuntimeError`. Do not let a late stale completion call `clearFind()` on a
viewer that has accepted a newer query. Add a controlled timeout test covering A timeout → B start
→ A late settlement.

### P2 — legacy `.xls` and `.ppt` still fall through to plaintext

**Evidence**

- `src/main/onlypreview/onlyPreviewClassifier.service.ts:117-120` recognizes only `.doc` as an
  unsupported legacy document. The default at `:223` classifies every other unknown suffix as
  `text`, so `.xls` and `.ppt` route to Monaco rather than the unsupported/system-open surface.
- `src/preload/onlypreview/search/core/classification.mjs:98-114` likewise lists `.doc` but not
  `.xls` / `.ppt` as metadata-only; `:138-139` therefore indexes both as text.
- This conflicts with Task 077's format boundary and `docs/features/onlypreview.md:712`, which say
  legacy `.xls`, `.doc`, and `.ppt` remain unsupported.

**Impact**

Small binary XLS/PPT files are decoded and indexed as replacement-character text, producing
garbage preview/search matches instead of the explicit unsupported state and system-open action.

**Recommendation**

Add `.xls` and `.ppt` to the exact unsupported/metadata-only extension sets and cover all three
legacy suffixes in Main classifier, search classification, and system-action tests.

### P2 — accepted peak-memory envelope still needs an explicit low-end-device decision

**Evidence**

- `src/renderer/onlypreview/preview/src/onlyPreviewOoxmlPreflight.type.ts:1-6` accepts 25 MiB
  compressed input, 128 MiB per inflated entry, and 200 MiB total inflated content.
- Those same limits are forwarded to every library viewer at
  `src/renderer/onlypreview/preview/src/onlyPreviewOfficeSession.service.ts:78-83`.
- The pinned package documents that XML trees, JS models, WASM memory, canvas backing stores,
  decoder/GPU state and SVG storage can consume several times the measured archive budget, and
  explicitly notes that a Worker is not an OS-process memory sandbox
  (`node_modules/@silurus/ooxml/README.md:1020-1024`).

**Impact**

The implementation removes unbounded ZIP expansion and keeps heavy parsing off the renderer UI
thread, but the current accepted envelope can still create a high transient working set on an
8-GiB or already pressured machine. The limits prevent an arbitrary zip bomb; they do not by
themselves prove that the desktop cannot stall or be killed for memory pressure.

**Recommendation**

Before calling the device-safety goal complete, benchmark worst accepted DOCX/XLSX/PPTX fixtures on
the minimum supported device and record renderer/worker peak RSS, time-to-ready, scroll and Find.
If no evidence supports 200 MiB, lower the total inflated limit (and possibly the compressed Office
override) or introduce a conservative low-memory policy. Keep the current preflight/worker/timeouts
regardless.

## Confirmed paths

- Classification and adapter routing for modern formats are coherent:
  `.xlsx` / `.xlsm` → `ooxml-xlsx`, `.docx` → `ooxml-docx`, `.pptx` → `ooxml-pptx`.
- `src/renderer/onlypreview/preview/src/onlyPreviewOfficeSession.service.ts:232-306` uses only the
  three dynamic package subpaths and constructs `XlsxViewer`, `DocxScrollViewer`, and
  `PptxScrollViewer` after fetch + one-shot preflight. There is no root `@silurus/ooxml` import and
  no live `pptx-renderer` import in production source.
- All viewers use worker mode, disable Google Fonts, hyperlinks and comments, and receive explicit
  archive limits. PPTX also disables media playback. DOCX/PPTX use virtualized scroll viewers.
- OOXML preflight validates exact ZIP structure, CRC, entry count, per-entry/aggregate inflation,
  compression ratio, encryption, required package parts, and a 10-second deadline in a disposable
  Worker. PPTX requires `ppt/presentation.xml`.
- Native Office Find is correctly wired for the non-timeout path: all-match search, distinct active
  highlight colors, first active navigation, next/previous, empty-query clear, selection teardown,
  and complete coverage.
- `@silurus/ooxml` is exactly pinned at `0.83.0`; Vite excludes it from dependency optimization;
  only the Preview HTML gets narrow `'wasm-unsafe-eval'`; worker/network/frame/object CSP remains
  bounded.

## Code-review rules check

The reviewed task files have no `TS-1`, `TS-2`, `FE-1`, or `FE-2` violation. The largest reviewed
task file is the 783-line Preview Region service, below the 800-line limit; the new Office SFC keeps
the viewer orchestration in the session service and emits only component lifecycle state.

## Verification performed

- `git diff --check` — passed.
- `node --test` over Office OOXML, preflight, rendering/adapters, classifier/guards and Find suites —
  75/75 passed.
- `node --test scripts/package/desktopPackageAudit.test.mjs` — 18/18 passed.
- `yarn typecheck:web` — failed on the repository's existing unrelated Poker/Home/Maestro/path
  baseline errors; no Task 077 / Office source error appeared.
- Production build/chunk inspection was not repeated in this independent pass; it remains required
  after the findings above are fixed.
