# Omni Open returns before the browser is ready

Status: reopened; packaged hidden-renderer scheduling regression confirmed; fix in progress

## Observed behavior

Clicking **Open** for Omni Browser twice can leave the opened browser unable to search. The current
Home and Workbench cards already disable their own button while `openOmniWindow()` is pending, but
Main resolves that request before the Omni MenuBar and initial browser cells are ready.

A Preview log sample shows the request returning about 6.6 seconds before the top MenuBar finished
loading and showed the window. A second request therefore focused a half-created window. The Omni
cell address field also binds both a raw Enter key handler and Arco's `press-enter`, so one Enter can
dispatch two navigations; the second load can abort the first with `ERR_ABORTED (-3)`.

## Required behavior

```text
idle [Open]
   │ click
   ▼
opening [spinner + disabled Open]
   │ Main single-flight: MenuBar + initial browser chrome ready, window shown/focused
   ├── success toast ──► idle [Open]
   └── failure/timeout toast ──► idle [Open]
```

- Every concurrent Open request joins one Main-owned readiness promise.
- Main does not report success merely because the native window object exists.
- Success means the top MenuBar and initial browser-cell chrome have loaded and the window has been
  shown and focused. A bounded timeout rejects instead of leaving Open pending forever.
- Home and Workbench keep their existing visual language and card layout. Their Arco Open button
  stays in its existing Royal Blue loading state until Main confirms readiness, then shows a
  localized opened message before clearing loading.
- One Enter in an Omni browser address field dispatches exactly one navigation.
- A ready existing Omni window still focuses immediately and does not create another window graph.
- Main records fixed, privacy-safe lifecycle stages for top MenuBar, initial browser chrome, and
  Control local renderers, plus renderer bootstrap stages and the exact readiness categories still
  pending at timeout. It never logs URLs, cell IDs, tokens, or raw errors.
- First-party local chrome must remain runnable while the native graph is hidden. The initial native
  graph becomes visible before remote pages and nonessential Control startup can consume the cold
  path; saved cells then finish progressively without losing their layout or navigation target.
- Performance records remain after the fix: first-visible/interactive, restored cell counts,
  deferred remote-load and Control stages, plus fixed failure/pending categories.

## Acceptance

- Source/unit regressions prove concurrent callers share one readiness promise and cannot succeed
  before the initial views are ready and the window is visible.
- Source regression proves the address field has one Enter navigation path.
- Both Mini Apps surfaces show loading until success/failure feedback.
- Packaged logs distinguish load/navigation failure, renderer exit/unresponsive, DOM/load finish,
  language/App import/Vue mount, rejected receipt, and a timeout's pending load/mount counts.
- Electron/E2E and packaged runtime verification remain with Ral.

Implementation task:
[omni-open-readiness-112](../plan/tasks/omni-open-readiness-112.md).

## Delivery

- Main now owns a generation-isolated single-flight coordinator with one 30-second deadline and
  once-only cleanup.
- Top and initial browser-cell chrome report readiness only after language initialization, dynamic
  import, Vue mount, and `nextTick`; token, generation, role, and cell identity fence every report.
- Home and Workbench keep loading through the Main result, show localized success only for
  `{ opened: true }`, and retain the existing error state for failure.
- One Enter now dispatches one navigation. A delayed old-generation restore cannot clear a newer
  generation's readiness collector.
- Focused behavior/source regressions passed 10/10, Node and Renderer type checks passed, and
  [independent review 1](../plan/reviews/omni-open-readiness-112-1.md) found no P0-P3 issue.

## Preview 0.0.86 packaged evidence

- `16:17:44.103` — Open began; six cells were restored by `16:17:44.147`, including one browser
  cell, and Main began waiting for initial mounted chrome.
- No top/cell load or mount success, load failure, or renderer-exit event was available before the
  29,997ms timeout destroyed the graph.
- The non-gating local Control renderer did not call `loadLayout` until `16:19:13.619`, about 89.5
  seconds after creation. During the same run, OnlyPreview Shell load took 61.9 seconds.
- This proves a shared packaged local-renderer startup/scheduling/resource gap rather than only a
  rejected ready token, but the current logs cannot distinguish the remaining lifecycle stage.

## Working hypothesis after the packaged run

This remains an inference until the next package captures the missing lifecycle stages. Omni creates
its local `WebContentsView`s under a hidden `BaseWindow`, restores six cells in one burst, and waits
for renderer readiness before showing the window. Process observations showed those hidden renderers
at a low scheduling priority, while the fast file-search renderer explicitly disables background
throttling. The next package should verify that boundary with fixed lifecycle/state records before
changing visibility, throttling, or restore order.

## Near-instant implementation

- Initial first-party top/browser chrome stays runnable while hidden and must complete load plus Vue
  mount before the native window shows and Open succeeds. Remote browser/mini-app content and Control
  begin only on a cancellable 16ms event-loop turn after that visible/interactive boundary.
- Repeated Open joins the same graph without replacing a pending deferred batch. Browser concurrency
  resources, timers, and listeners are exact-once and generation-safe across success, failure,
  timeout, close, and retry.
- Fixed-schema `[omni-open]` records now divide native restore, renderer lifecycle, language/import/
  mount, accepted/rejected receipt, first-visible/interactive, Control layout readiness, deferred
  content, and bounded timeout-pending categories without logging user or renderer payload data.
- [Independent review 2](../plan/reviews/omni-open-readiness-112-2.md) passed with no P0-P2 after the
  startup, receipt, deferred-content, and semaphore cleanup races were resolved.
- The notarized macOS ARM Preview `0.0.86` package was rebuilt and passed codesign/stapler
  validation. Packaged runtime latency and interaction remain owner verification.

## Preview packaged regression evidence

- Native restore of six cells finishes in 54--71ms.
- While the BaseWindow remains hidden, the first-party top/browser renderer scripts take 18.3
  seconds to start in one run and never start before the 30-second timeout in another.
- Remote browser/Mini App navigation starts only after first-visible and completes quickly, so it is
  not the observed first-window bottleneck.

[desktop-first-visible-performance-117](../plan/tasks/desktop-first-visible-performance-117.md)
therefore moves native show/focus immediately after restore/view attachment, while retaining the
shared in-flight readiness promise so rapid repeated Open still joins one graph until local chrome
is usable.
