---
id: onlypreview-open-diagnostics-114
scope: Correlated privacy-safe OnlyPreview window and explicit-target open timing
status: implemented; Preview rebuild and owner runtime verification pending
depends-on: [onlypreview-search-startup-diagnostics-041, onlypreview-action-diagnostics-103]
verify: node --test tests/onlypreview/onlyPreviewOpenDiagnostics.test.mjs tests/onlypreview/onlyPreviewExplicitOpenSerialization.test.mjs tests/onlypreview/onlyPreviewAppWiring.test.mjs && yarn typecheck:node && node scripts/environment/runWithRuntimeProfile.cjs release_preview -- yarn _build:release && git diff --check
---

# Trace OnlyPreview open from request to visible readiness

## Objective

Extend existing Preview diagnostics so a packaged log identifies whether a slow open is native
window creation, hidden runtime startup, Shell loading/mounting, Project binding, presentation, or
the selected renderer becoming ready.

## Context

- `docs/features/onlypreview.md`
- `docs/features/application-diagnostics.md`
- `docs/issues/onlypreview-open-latency-is-not-traceable.md`
- `docs/plan/tasks/onlypreview-search-startup-diagnostics-041.md`
- `docs/plan/tasks/onlypreview-action-diagnostics-103.md`

## Path

- `src/main/xpc/onlyPreview.handler.ts`
- `src/main/windows/onlyPreviewWindow.helper.ts`
- `src/main/onlypreview/`
- `src/main/logging/onlyPreviewLog*.ts`
- `src/shared/onlypreview/`
- OnlyPreview Shell/Preview readiness emitters where required
- `tests/onlypreview/`

## Contract

- Reuse the existing OnlyPreview/application logging policy and existing search diagnostics rather
  than duplicating its indexing/search stages.
- Add one fixed allowlisted open schema with short process-local correlation tags and monotonic,
  clamped elapsed/stage milliseconds.
- Window open distinguishes request route, native graph construction, hidden runtime, Shell load,
  Shell mount/initialization boundary, show/focus, and terminal success/failure/timeout.
- Explicit target open distinguishes target kind, inspection, Project/external authority or bind,
  presentation publication, and Preview-ready acknowledgement when the current contract exposes it.
  Do not make Main wait for a renderer-ready event merely for logging.
- Never record paths, filenames, queries, snippets/content, workspace/config identity, database
  paths, capabilities/tokens, URLs, raw errors/objects, or renderer payloads.
- Diagnostics are best-effort, fixed-volume, and add no filesystem/SQLite/body work, new polling, or
  behavior-changing wait.
- Cold cleanup happens before the new window trace begins. No new cold trace may self-terminate as
  `superseded` through `destroyStandalone()`.
- Keep the diagnostic timer non-blocking/unreferenced and long enough to retain the observed
  143,733ms startup. It remains observation only and must not delay or cancel window work.
- Emit allowlisted Shell WebContents lifecycle stages plus capability/tag-fenced renderer stages for
  script entry, language readiness, dynamic App import, and Vue mount. Log no target path, URL,
  capability, token, raw error, or renderer payload.
- Extracting the explicit-open implementation must preserve the XPC handler's existing public
  `openOnlyPreviewAbsoluteTarget` export consumed by the Main bootstrap and MCP/OS-open wiring.

## Verification

- Pure fake-clock/writer tests cover schema allowlists, correlation, duration clamp, terminal
  once-only behavior, forbidden-field exclusion, and swallowed writer failures.
- Source/integration regressions cover existing-window and cold-window routes plus Project/external
  target routing without changing response ordering.
- Run a real Preview-profile Electron-Vite build so Rollup validates the Main module export graph.
- Add regression coverage for cold cleanup-before-begin, long diagnostic timing, lifecycle stage
  allowlists, renderer stage validation, and once-only terminal behavior.
- Run focused diagnostics/search tests, Node and directed renderer type checks, and `git diff --check`.
- Do not launch Electron, Playwright/E2E, packaged smoke, or the real app. Ral owns live acceptance.

## Owner verification

- Package/run Preview, open OnlyPreview once without a target, then open one Project file and one
  external file.
- Filter Preview profile logs by the new OnlyPreview open scope and compare the correlated stages
  with existing `[onlypreview-search]` records.
- Confirm no filename, path, query, content, workspace identity, or capability appears in the log.

## Delivery

- Added one allowlisted shared diagnostic formatter/trace coordinator with short tags, monotonic
  clamped durations, once-only terminal records, and swallowed clock/writer failures.
- Added dedicated-log delivery plus window, hidden-runtime, non-blocking Shell post-mount,
  pre-queue explicit-target, and revision-local Preview instrumentation.
- Extracted explicit target routing into a service so the Main handler stays at 744 lines and the
  existing FIFO/project/external behavior remains testable.
- Vue, Chrome, and Office surfaces are explicit; crash, watchdog, load error, clear, destroy, and
  supersede paths terminate the correct revision without letting stale callbacks finish a newer one.
- Focused diagnostics/architecture tests passed 57/57 during develop; final External-file/source
  regressions passed, Node/Web type checks and task-scoped diff checks passed. Electron/E2E/build/
  packaged runtime were not run.
- [Independent review 1](../reviews/onlypreview-open-diagnostics-114-1.md) passed with no P0-P3
  finding.

## Reopened build finding

- Owner Preview packaging reached Electron-Vite and failed because `app.main.ts` imports
  `openOnlyPreviewAbsoluteTarget` from `onlyPreview.handler.ts`, but the extraction imported without
  re-exporting it.
- Restore that compatibility contract without duplicating the implementation or changing runtime
  registration, then add source coverage and complete independent review 2.

## Build repair delivery

- `onlyPreview.handler.ts` directly re-exports the service-owned
  `openOnlyPreviewAbsoluteTarget`; Main, OS file-open, and MCP receive the same function identity.
- The focused source regression requires that public handler export alongside the service-owned
  serialized implementation and single explicit-target registration.
- Focused task tests passed 22/22, Node typecheck passed, and the full Preview-profile
  Electron-Vite build passed for `0.0.85` without launching Electron.
- [Independent review 2](../reviews/onlypreview-open-diagnostics-114-2.md) passed with no P1-P3
  finding. Electron/E2E, signing, packaging, and upload were not run.

## Preview 0.0.86 follow-up

- Owner packaged logs proved the hidden runtime is fast (186ms), Shell load is slow (61,894ms), and
  the restored 86,642-item Project adds another 80,108ms before initialization completes.
- The window trace ended itself as superseded after 3ms because `ensureStandalone()` began it before
  calling `destroyStandalone()`.
- Reopen develop/verify to fix trace ownership, split the Shell renderer gap, and then build a new
  macOS ARM Preview package for owner reproduction. Do not infer a performance fix until the new
  lifecycle evidence identifies the shared packaged-renderer delay.

## Near-instant open follow-up

Preview `0.0.86` supplied enough additional process evidence to act on the first-paint path. The
Shell renderer process existed immediately but ran at background priority while attached to the
hidden `BaseWindow`; the file-search control renderer explicitly disables background throttling and
loaded in 186ms. Ral now requires the implementation to approach a one-second open experience, not
only collect another trace.

- Keep the local Shell renderer runnable while its native window is hidden and show the native
  window as soon as the Shell graph is safely attached; do not wait for Project reconciliation.
- Keep the existing Project restore/index work asynchronous after Vue mount. A restored large
  Project may progressively populate, but it cannot hold first-visible or first-interactive open
  completion.
- Preserve durable performance records for native visible, DOM/load completion, Vue interactive,
  workspace restore/seed publication, and background reconciliation terminal stages. Use only fixed
  enums, booleans, bounded counts, and elapsed times.
- Do not log a Project path/name/identity, selected file, URL, token/capability, or raw error.
- Add source/pure regressions proving the Shell startup preference and first-visible ordering, and
  that Project initialization remains outside the renderer mount/open terminal.

## Near-instant open delivery

- The first-party Shell alone starts with Chromium background throttling disabled while its hidden
  native graph boots. One exact host + window + view lease restores the preference after the valid
  renderer receipt or any current failure/close/destroy path; diagnostic expiry and stale callbacks
  cannot strand or mutate a replacement view.
- The native window becomes visible after the local Shell load boundary, and the post-mount receipt
  records the interactive boundary without waiting for Project reconciliation.
- Initial history restore publishes the workspace immediately and schedules Project indexing after
  a cancellable 750ms grace. Manual/native refresh cancels that grace before starting one immediate
  index, while workspace changes retain their established immediate behavior.
- The fixed-schema timeline retains first-visible, interactive, deferred-index scheduling/start/
  cancellation, and existing bounded reconciliation stages without recording Project identity,
  paths, files, URLs, tokens, or raw errors.
- Focused regressions, Node typecheck, and directed Web typecheck passed. The two startup-concurrency
  findings from review 4 were fixed, then the same
  [independent review 4](../reviews/onlypreview-open-diagnostics-114-4.md) passed with no remaining
  P0-P3 finding. Build, Electron/E2E, and packaged runtime were not run in this task stage.
