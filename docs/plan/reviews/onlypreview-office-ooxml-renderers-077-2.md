# Task 077 independent review round 2 — Office OOXML renderers

- Date: 2026-08-28
- Scope: fixes following review 1 for `.xlsx` / `.xlsm` / `.docx` / `.pptx`, Office Find,
  legacy Office boundaries, OOXML resource limits, Vue rebuild, CSP and production output
- Result: **PASS — no remaining P1/P2 blocker found**
- Electron / Playwright / packaged-app E2E: not run (explicitly excluded)

## Findings

No new P1, P2 or P3 finding was identified in the reviewed Task 077 production and test paths.

## Review 1 closure audit

### Closed — post-ready viewer errors now fail closed

- All three lazy constructors install `onError` and retain worker mode, local-only rendering,
  explicit resource limits and persistent Find colors
  (`src/renderer/onlypreview/preview/src/onlyPreviewOfficeSession.service.ts:233-310`).
- The first asynchronous viewer error makes the session terminal, clears Find, destroys the exact
  viewer, removes generated content and reports one typed format error. Duplicate and post-dispose
  callbacks are fenced (`:525-546`). The constructor-time microtask path also avoids losing a
  synchronous callback before `this.viewer` is assigned.
- The runtime error reaches Store/Main, and Main now includes XLSX parse/empty/timeout failures in
  the same Vue-rebuild boundary as DOCX/PPTX
  (`src/main/onlypreview/views/onlyPreviewPreviewAdapter.service.ts:9-25` and
  `src/main/onlypreview/views/onlyPreviewPreviewRegion.service.ts:486-507`).
- Focused tests trigger `onError` twice for every format and prove one error report, one viewer
  destroy, one DOM teardown and rejection of later Find work.

### Closed — a superseded Find deadline cannot erase replacement highlights

- Every real Find timeout is now terminal even if that command was superseded: the typed
  format timeout calls `failClosed()`, disposes the viewer and prevents queued work from continuing
  on it (`src/renderer/onlypreview/preview/src/onlyPreviewOfficeSession.service.ts:312-352`).
- A late completion is generation-fenced; cleanup against an already destroyed stale viewer is
  caught locally (`:515-522`). A replacement session owns a different viewer, so the stale
  completion cannot clear its highlights.
- The controlled timeout test covers query A pending, query B queued, A deadline, terminal stale
  teardown, replacement query B highlights, and A settling late without touching the replacement.

### Closed — legacy Office formats are metadata-only and unsupported

- Main explicitly classifies `.doc`, `.xls` and `.ppt` as unsupported before the default text
  fallback (`src/main/onlypreview/onlyPreviewClassifier.service.ts:117-120,205-223`).
- Search classifies all three as metadata-only and does not read or index their bodies
  (`src/preload/onlypreview/search/core/classification.mjs:98-116`).
- Focused classifier/traversal tests prove the unsupported preview hint and zero body reads. The
  modern boundary remains exact: `.xlsx`/`.xlsm`, `.docx`, and `.pptx` only.

### Closed for code admission — inflated archive envelope is reduced and consistently enforced

- The app preflight is now capped at 25 MiB compressed, 5,000 entries, 64 MiB per inflated entry,
  128 MiB aggregate inflation, 200:1 ratio and ten seconds
  (`src/renderer/onlypreview/preview/src/onlyPreviewOoxmlPreflight.type.ts:1-9`).
- Preflight validates central/local ZIP agreement, actual streamed sizes and CRC, encryption,
  required format parts, ratios, XLSX merge expansion and deadline. The same entry/aggregate/count
  limits are passed into every library viewer, so later lazy part access cannot bypass admission.
- Parsing/layout/rendering remain in disposable Workers, while fetch abort, preflight termination,
  viewer timeout, Find timeout, session destroy and Main's 30-second Vue watchdog provide layered
  teardown. The installed library also applies hard decoded-raster limits.
- These limits materially close the review-1 200 MiB admission concern. They cannot mathematically
  guarantee zero OOM on every device because JS/WASM models, canvas/GPU backing stores and browser
  decode overhead are outside ZIP accounting; owner testing on the minimum supported machine
  remains the correct final fidelity/performance acceptance, not a code-review blocker.

## Confirmed integration and output

- Modern formats route coherently to `ooxml-xlsx`, `ooxml-docx`, and `ooxml-pptx`; the Preview
  session dynamically imports only `@silurus/ooxml/xlsx`, `/docx`, or `/pptx` after fetch and
  one-shot preflight. There is no live production `pptx-renderer` or root-package import.
- Native model Find remains complete for all formats: `findText`, next/previous, all-match and active
  colors, one-based ordinal, empty/query-change/selection/teardown clear, plus generation fencing.
- The production build passed. Preview HTML directly references no Office asset; its 1,325-byte
  bootstrap contains no OOXML symbol. XLSX, DOCX and PPTX emit separate lazy JS chunks, three
  parser WASM files, three render workers and a separate 34.78 KiB preflight Worker.
- Preview alone retains the narrow same-origin `'wasm-unsafe-eval'` capability. Its built CSP keeps
  workers same-origin/blob, network limited to self plus `bitterless-preview:`, and blocks frames,
  objects, forms and base URL changes.
- `@silurus/ooxml` is exactly pinned at `0.83.0`, excluded from Vite dependency optimization, and
  package tests reject either PPTX-renderer package.

## Code-review rules check

The reviewed Task 077 code has no `TS-1`, `TS-2`, `FE-1` or `FE-2` violation. The Office session is
560 lines, and the Office component delegates orchestration to the session service and emits only
component lifecycle state.

## Verification performed

- Focused non-Electron Node suites covering Office session, preflight, rendering/adapters,
  protocol, Main region/rebuild, guards, classifier/search boundary and Find: **128/128 passed**.
- `node --test scripts/package/desktopPackageAudit.test.mjs`: **18/18 passed**.
- `yarn typecheck:node`: passed.
- `yarn build`: passed; lazy chunks, WASM/worker assets, Preview bootstrap and built CSP inspected.
- `git diff --check`: passed.
- `yarn typecheck:web`: still fails only on the repository's pre-existing unrelated Poker, old
  Home, Maestro, connector and path-helper baseline errors; no Task 077 / Office file appears in
  the diagnostics.

## Conclusion

**PASS.** The two P1 and two P2 findings from review 1 are closed in production behavior and are
covered by focused regression tests. Task 077 is ready for Ral's live Office fidelity, scrolling,
Find/highlight and minimum-device acceptance.
