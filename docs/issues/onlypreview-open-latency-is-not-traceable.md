# OnlyPreview open latency is not fully traceable

Status: reopened; packaged hidden-Shell and missing-directory regressions confirmed; fix in progress

## Observed behavior

OnlyPreview can take many seconds to become usable, while its open operation exposes only coarse
startup records. One Preview log sample recorded a 15,996ms visible-window startup: the hidden
file-search runtime was ready after 182ms, followed by about 15.8 seconds inside the undivided Shell
renderer-load phase. Restoring an 86,314-item Project then took another 61.4 seconds, already broken
down by the existing search diagnostics.

An explicit file/folder open has a second gap: the request can pass target inspection, Project
authority/bind, presentation publication, and renderer rendering, but those stages do not share one
correlation record. A successful Main response also does not currently prove that Preview reported
the selected document ready.

The first packaged diagnostic run on Preview `0.0.86 / 260902155937` took 143,733ms from Open to
initialized Shell. The hidden file-search runtime took only 186ms; the hidden BaseWindow Shell
`loadFile()` then took 61,894ms, followed by an 80,108ms reconciliation of an 86,642-item Project.
The content Preview itself was ready in 45–183ms. The new window trace was unusable because cold
open began trace `w1` and immediately called teardown, which marked that same trace superseded after
3ms. Existing logs also cannot divide the 61.9-second Shell gap into navigation, DOM, module,
language, App import, and Vue mount stages.

## Required behavior

- Preserve the existing OnlyPreview search timing records and behavior.
- Add fixed, privacy-safe open diagnostics that distinguish request route, hidden runtime startup,
  native window/Shell construction, renderer load/mount, show, target inspection, workspace bind,
  presentation publication, and visible Preview ready where those stages exist.
- Use short process-local correlation tags and monotonic non-negative elapsed milliseconds.
- Record only fixed enums, bounded counts/booleans, stage durations, and success/failure/timeout.
  Never log paths, filenames, queries, content, workspace identity, capability tokens, URLs, raw
  errors, or renderer payloads.
- Diagnostics are best-effort and cannot add filesystem work, alter readiness, or delay open.
- Records remain available in the Preview profile logs so a packaged report can identify the slow
  stage without reproducing under a debugger.
- A cold open must retire any preceding runtime before beginning its new trace; its own defensive
  teardown cannot supersede the trace it just created.
- A diagnostic-only deadline must remain alive long enough to observe the known 143.7-second case,
  without changing or delaying window behavior.
- Shell WebContents lifecycle and renderer bootstrap acknowledgements divide load start, DOM ready,
  load finish, language readiness, App import, and Vue mount. Failure events use fixed enums only.
- The first-party Shell must not be background-throttled while the hidden native graph starts. Show
  the native window once the Shell view is attached so Chromium scheduling cannot create a hidden
  wait loop; Project restore/reconciliation remains progressive work after the UI is interactive.
- Retain first-visible, first-interactive, workspace-seed, and reconciliation timings after the
  optimization so future packaged regressions can be compared without a debugger.

## Acceptance

- Pure tests prove the schema allowlist, fake-clock timing, correlation, privacy exclusions, and
  swallowed writer failures.
- Source regressions prove window and explicit-target lifecycles emit one terminal record and do not
  change their existing success contract.
- Existing OnlyPreview search diagnostics and open behavior remain intact.
- The Preview Main bundle resolves the existing `openOnlyPreviewAbsoluteTarget` bootstrap import
  after the explicit-open implementation is extracted from the XPC handler.
- A fake-clock/source regression proves cold cleanup precedes trace begin and later Shell stages are
  retained; renderer acknowledgements remain capability/tag fenced and privacy-safe.
- Electron/E2E and packaged runtime verification remain with Ral.

Implementation task:
[onlypreview-open-diagnostics-114](../plan/tasks/onlypreview-open-diagnostics-114.md).

## Delivery

- Added a dedicated `[onlypreview-open]` timeline to the Preview profile
  `onlypreview/onlypreview.log` without mirroring routine stages into `main.log`.
- Window traces distinguish existing/cold, native graph, four hidden-runtime readiness gates,
  Shell load, post-i18n/import/Vue mount acknowledgement, show, timeout, failure, and supersession.
- Explicit target traces begin before FIFO serialization and correlate inspect, Project/external/
  directory authority, presentation acceptance, and a revision-local Vue/Chrome/Office trace.
- Preview revisions end exactly once on ready, renderer error, crash/watchdog, clear, destroy, or
  supersession. Main acceptance still does not wait for renderer readiness.
- Focused diagnostics/architecture tests passed 57/57 during develop; the final moved-service
  regression and related focused suites passed, Node/Web type checks passed, and
  [independent review 1](../plan/reviews/onlypreview-open-diagnostics-114-1.md) found no P0-P3 issue.

## Packaging regression resolution

The first owner Preview build of `0.0.85` exposed a static module-contract gap that the TypeScript
checks did not catch: `app.main.ts` still imports `openOnlyPreviewAbsoluteTarget` from the XPC
handler, while the extraction changed the handler to a private import without preserving that
public export. The handler now directly re-exports the service-owned function, preserving one
implementation, FIFO, and registry registration. A source regression locks that contract;
[independent review 2](../plan/reviews/onlypreview-open-diagnostics-114-2.md) passed with no finding,
and the complete Preview-profile Electron-Vite build passed for `0.0.85`.

## Preview 0.0.86 packaged evidence

- `16:17:53.726` — `window-start tag=w1 route=api mode=cold`.
- `16:17:53.728` — the same trace incorrectly ended `superseded` after 3ms.
- Hidden file-search runtime reached ready in 186ms, while visible Shell renderer load completed in
  61,894ms.
- Shell initialization then spent 14,095ms counting, 11,698ms preparing the SQLite candidate,
  47,601ms traversing/reconciling, and 1,109ms promoting it; total initialization was 80,108ms.
- The prior long-lived session performed about 70 full reconciliations of the same ~86k-item
  Project, so the existing search timings remain necessary alongside the repaired open trace.

## Working hypothesis after the packaged run

This remains an inference until the next diagnostic package records the missing lifecycle stages:
the visible Shell is attached to a hidden `BaseWindow`, while the fast file-search control renderer
explicitly disables background throttling. Process observations showed the hidden Shell at a much
lower scheduling priority even though its renderer process already existed. The next package should
therefore distinguish hidden-view navigation, DOM/load completion, and renderer bootstrap before any
performance behavior is changed. The 80-second Project reconciliation is a separate confirmed cost.

## Near-instant implementation

- Only the first-party Shell starts unthrottled while hidden, then an exact host + window + view
  lease restores normal throttling after its valid post-mount receipt or every current terminal
  failure path. Diagnostic supersession/timeout and stale destroyed views cannot alter that lease.
- The visible/interactive boundary no longer waits for restored-Project reconciliation. History
  restore publishes the workspace immediately and starts its initial index after a cancellable 750ms
  grace; native/manual refresh cancels the pending grace and starts exactly one refresh.
- The repaired `[onlypreview-open]` trace and existing `[onlypreview-search]` records retain the
  local Shell, first-visible, Vue interactive, workspace publication, deferred-index, and background
  reconciliation stages needed to compare future packaged runs.
- [Independent review 4](../plan/reviews/onlypreview-open-diagnostics-114-4.md) passed after its two
  startup-concurrency findings were resolved. The notarized macOS ARM Preview `0.0.86` package was
  rebuilt and passed codesign/stapler validation; live reproduction remains owner verification, not
  evidence already claimed by this source change.

## Preview packaged regression evidence

- The hidden file-search runtime is ready in about 200ms, but the attached hidden Shell waits 10.4
  seconds before its first renderer script executes; first-visible follows at 10.6 seconds.
- After mount, logs contain `restore-index-grace scheduled` but never `start`, XPC `initialize`, or a
  root browse listing, even while the process stays alive for minutes. The renderer-owned 750ms
  timer is the sole restored-Project kickoff and is suppressed after background throttling resumes.
- The search runtime already emits a root browse listing before its full count/traversal, so an
  immediate deterministic initialization can populate the directory progressively without gating
  first-visible on reconciliation.

[desktop-first-visible-performance-117](../plan/tasks/desktop-first-visible-performance-117.md)
shows the native graph immediately after Shell attachment and removes the renderer timer as the
only restored-Project initialization path.
