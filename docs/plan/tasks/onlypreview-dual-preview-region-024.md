---
id: onlypreview-dual-preview-region-024
scope: Split Preview into mutually exclusive Chromium-direct and Vue content views under one Shell-owned toolbar
status: implemented; owner verification pending
depends-on: [onlypreview-search-during-index-017]
---

# Objective

Establish the target OnlyPreview content boundary before adding new format engines or current-file
find. Move file identity and native file actions from the Vue Preview renderer into a fixed 43px
Preview toolbar inside the existing Shell. Below that toolbar, let one Main-owned Preview Region
attach exactly one of two content views:

- `chromePreviewView` for raw `.html` / `.htm` and Chromium's built-in PDF viewer;
- `vuePreviewView` for Monaco, Markdown, image, audio, video, unsupported, loading, and error states.

Raw local HTML may execute its own inline and contained relative JavaScript, CSS, images, fonts, and
media, but it receives no preload, XPC, Node, Electron, Bitterless session, remote network, popup,
permission, or filesystem authority. Every Chrome selection revision creates a fresh disposable
view and memory session. This task creates the Main-owned selection/surface/readiness foundation
that tasks 023, 020, 021, 022, and 019 extend; it does not add the Find Bar itself.

# Context

- [OnlyPreview dual preview views and find ownership](../../design/onlypreview-preview-merge-find.md)
  — current contract #7, especially #7.2, #7.3, and #7.5
- [OnlyPreview preview format coverage](../../design/onlypreview-format-coverage.md) — #1 read and
  parse boundary, #7 engine loading, #8/G7 direct PDF boundary
- [OnlyPreview sub-application](../../features/onlypreview.md) — current product/security contract,
  which this delivery must update from the historical single Vue Preview topology
- [Historical Preview Header merge](onlypreview-preview-header-merge-018.md) — implemented history;
  its single-Preview target is superseded by this task, while its removal of the third Header
  renderer remains valid
- [Current-file find](onlypreview-find-in-file-019.md) — downstream consumer of the Region state

# Frontend Design

The subject is a compact local-file workbench, not a document dashboard. Preserve the current light
Bitterless palette, system typography, 32px Royal Blue MenuBar, 25px status rail, and existing tree
geometry. The Preview toolbar is a quiet 43px utility strip with file identity on the left and type /
native actions on the right; it introduces no card, shadow, gradient, or new color system.

```text
Shell right column
┌ 43px toolbar: file name · relative path                 [TYPE] [actions] ┐
├ inner content host (one native content view; never covers the toolbar)   ┤
└ existing 25px Shell status rail                                           ┘
```

At narrow widths, the relative path truncates before type/actions. Focus, hover, disabled, and error
states reuse existing OnlyPreview controls. Structural and repeated nodes use stable `name`
attributes and `onlypreview`-rooted BEM classes. Motion is limited to existing focus/transition
feedback and respects reduced-motion preferences.

# Path

- `docs/INDEX.md`
- `docs/design/onlypreview-preview-merge-find.md`
- `docs/design/onlypreview-format-coverage.md`
- `src/main/onlypreview/views/onlyPreviewPreviewRegion.service.ts` (new)
- `src/main/onlypreview/onlyPreviewDocument.registry.ts` (new)
- `src/main/onlypreview/onlyPreviewAsset.registry.ts`
- `src/main/onlypreview/onlyPreviewClassifier.service.ts`
- `src/main/onlypreview/onlyPreviewProtocol.service.ts`
- `src/main/onlypreview/onlyPreviewWorkspace.registry.ts`
- `src/main/windows/onlyPreviewWindow.helper.ts`
- `src/main/xpc/onlyPreview.handler.ts`
- `src/preload/onlypreview/onlyPreviewEnv.preload.ts`
- `src/preload/onlypreview/onlypreview.preload.type.ts`
- `src/shared/onlypreview/onlyPreview.types.ts`
- `src/shared/onlypreview/onlyPreview.contract.ts`
- `src/renderer/onlypreview/common/onlyPreviewPresentation.service.ts` (new)
- `src/renderer/onlypreview/shell/src/App.vue`
- `src/renderer/onlypreview/shell/src/App.less`
- `src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts`
- `src/renderer/onlypreview/shell/src/onlyPreviewShellEvents.service.ts`
- `src/renderer/onlypreview/shell/src/components/PreviewToolbar/` (new)
- `src/renderer/onlypreview/shell/src/components/FileActions/` (moved from Preview)
- `src/renderer/onlypreview/preview/src/App.vue`
- `src/renderer/onlypreview/preview/src/App.less`
- `src/renderer/onlypreview/preview/src/onlyPreviewPreview.store.ts`
- `src/renderer/onlypreview/preview/src/onlyPreviewWatchReload.service.ts` (delete)
- `src/renderer/onlypreview/preview/src/components/PreviewSurface/PreviewSurface.vue`
- `src/renderer/onlypreview/preview/src/components/PreviewHeader/` (delete)
- `src/renderer/onlypreview/preview/src/components/FileActions/` (move)
- `src/renderer/onlypreview/preview/src/components/MarkdownPreview/MarkdownPreview.vue`
- `src/renderer/onlypreview/preview/src/components/HtmlPreview/` (delete)
- `src/renderer/onlypreview/preview/src/onlyPreviewHtml.service.ts` (delete)
- `src/renderer/onlypreview/preview/src/components/PdfPreview/` (delete)
- `tests/onlypreview/onlyPreviewCore.test.mjs`
- `tests/onlypreview/onlyPreviewRendering.test.mjs`
- `tests/onlypreview/onlyPreviewSearchShell.test.mjs`
- `tests/onlypreview/onlyPreviewSearchShellUi.test.mjs` (Task 025 split)
- `tests/onlypreview/onlyPreviewSearchShellTest.helper.mjs` (Task 025 split)
- `tests/onlypreview/onlyPreviewSearchWindowIntegration.test.mjs`
- `tests/onlypreview/searchBootstrap.runtime.entry.ts`
- `tests/onlypreview/onlyPreviewPreviewRegion.test.mjs` (new)
- `tests/onlypreview/onlyPreviewDocumentProtocol.test.mjs` (new)
- `tests/onlypreview/fixtures/createOnlyPreviewFixtures.ts`
- `tests/onlypreview/fixtures/onlyPreviewApp.fixture.ts`
- `tests/onlypreview/specs/onlyPreview.spec.ts`
- `tests/onlypreview/specs/onlyPreviewPreview.spec.ts` (Task 025 split)
- `tests/onlypreview/specs/onlyPreviewActions.spec.ts` (Task 025 split)
- `tests/onlypreview/specs/onlyPreviewTest.helper.ts` (Task 025 split)
- `tests/onlypreview/specs/onlyPreviewSearch.spec.ts`
- `docs/features/onlypreview.md`
- `docs/plan/analysis/onlypreview.md`
- `docs/plan/README.md`
- `docs/plan/tasks/onlypreview-preview-header-merge-018.md`
- `docs/plan/tasks/onlypreview-find-in-file-019.md`
- `docs/plan/tasks/onlypreview-xlsx-grid-020.md`
- `docs/plan/tasks/onlypreview-docx-render-021.md`
- `docs/plan/tasks/onlypreview-media-truthful-state-022.md`
- `docs/plan/tasks/onlypreview-preview-guards-023.md`
- `docs/plan/tasks/onlypreview-dual-preview-region-024.md`

Do not modify or revert unrelated owner working-tree changes, especially EyesOnAgents, Submodules,
Codex/model-provider sources, `package.json`, or `yarn.lock`. Keep the existing
`onlypreview/preview/index.html` renderer entry and `onlypreviewContent.js` preload for the
app-owned Vue view; the Chrome view has no renderer bundle or preload.

# Delivery

1. Add `OnlyPreviewPreviewRegionService` as the sole Main owner of `selectionRevision`, current
   descriptor/adapter, `activePreviewSurface`, content bounds, `vuePreviewView`,
   `chromePreviewView`, direct document/asset capabilities, and surface readiness. Shell, watch,
   and Vue code submit intents/observations; none may mint an accepted selection revision.
2. Make `OnlyPreviewWindowHelper` retain BaseWindow, Shell, Settings/Guide, window state, and total
   teardown only. It delegates content bounds, present/reload/workspace reset, crash handling, and
   content teardown to the Region service. Shell renderer failure may still close the standalone
   window; a Vue/Chrome renderer failure must invalidate that surface and publish a recoverable,
   truthful content state without closing the BaseWindow.
3. Change the Shell's right column to a fixed 43px `PreviewToolbar` plus a flexing inner content host.
   Move the bounds ref and `ResizeObserver` to the inner host. Main must not attach either content
   view before the first valid host bounds arrive, so no startup frame can cover the toolbar.
4. Move `PreviewHeader` and `FileActions` into the Shell toolbar. Preserve fallback identity and
   native actions when describe/render fails. Publish Main-authoritative presentation state to Shell
   with exact host + workspace + selection revision fencing; do not restore the deleted
   PreviewHeader renderer or its metadata events. Keep selected-text metadata in the existing Shell
   status rail; switching to Chrome clears/hides it because raw content has no preload.
5. Retain `/onlypreview/preview/index.html` as `vuePreviewView`. It uses the existing sandboxed
   `onlypreviewContent.js` preload and exact app navigation fence, but its DOM contains only the
   content surface. Each selection reset disposes the active Monaco/model/selection state and any
   current Vue renderer work. Main keeps the persistent view detached until that exact runtime token
   acknowledges the current numeric selection revision reset; final render ready/error is a separate
   observation. Remove the Vue HTML and PDF routes/components.
6. Create a fresh `chromePreviewView` for every HTML/PDF selection revision, including HTML→HTML,
   PDF→PDF, HTML↔PDF, watch reload, and manual refresh. Set `sandbox: true`,
   `contextIsolation: true`, `nodeIntegration: false`, `webSecurity: true`, and PDF plugin support;
   omit preload and host arguments entirely. Use a unique non-persistent memory partition. Deny
   permission checks/requests, popups, unexpected top-level navigation/redirection, `file:` access,
   and external HTTP/HTTPS/network requests. Destroy the old view/session before attaching the new
   one; the two content views must never be attached together.
7. Add a document-scoped registry separate from the exact single-file asset token. Its URL contains
   only a high-entropy token plus a contained relative resource path. Bind the token to exact host,
   workspace generation, selection revision, canonical entry directory, and resource budget. On
   every request, decode exactly once; reject empty/dot/dot-dot/absolute/backslash/encoded separator,
   query, fragment, symlink escape, device, replacement, and non-GET/HEAD input; reopen and revalidate
   through the workspace registry before streaming. Install the required asset/document handlers on
   the Chrome view's own session, and unregister/revoke/abort them on revision teardown.
8. HTML entry bytes remain capped at 1MiB; each contained relative JS/CSS/image/font/media resource
   is capped at 25MiB; one selection revision is capped at 100MiB total accepted response bytes.
   Inline and contained relative scripts may run. A resource failure is contained to that resource
   and cannot widen the root or budget. Remote network remains denied pending a future explicit
   decision.
9. Navigate `.pdf` to Chromium's built-in viewer through a bounded, revision-bound exact asset URL;
   do not use Vue/pdf.js. Enforce the 100MiB PDF byte ceiling before navigation and again at stream
   time. Scanned PDFs may later report zero find matches; OCR is not part of this delivery.
10. Route successful file selection, selected-file watch commit, manual refresh, workspace change,
    restore, host revocation, and window teardown through the same Region transition. The atomic
    order is: increment revision; revoke/abort old assets and clear selection metadata; teardown old
    surface; choose adapter/surface; attach/load only after valid bounds; accept ready/error only for
    the exact current revision.
11. Keep Project tree/filter/Search/index behavior unchanged. Update source/unit tests and E2E
    fixture/spec contracts for Shell + one active content view, but do not launch Electron E2E.
12. Update the feature/analysis/plan documents in the same delivery. Mark the historical single Vue
    topology and Vue HTML/pdf.js behavior as superseded; record the exact implementation, limits,
    verification evidence, and owner manual-test handoff without claiming E2E coverage.

# Acceptance

- Shell remains attached full-window; exactly one content view is attached below the 43px toolbar.
  Neither content view exists above or covers the toolbar, including the first frame and resize.
- A persistent Vue view is never reattached for a new file or empty workspace until its exact
  capability-bound reset acknowledgement; stale acknowledgements and ready/error observations are
  rejected and cannot expose the preceding DOM/model/media below the new Shell identity.
- Source/Markdown/image/audio/video/unsupported states use the app-owned Vue bundle and its minimal
  preload. HTML/PDF use a separate disposable raw view with no preload, additional host arguments,
  Node, Electron, XPC, shared cookies/cache/storage, or remote network.
- An HTML fixture executes inline and contained relative JS, loads contained CSS and images, and
  renders their resulting DOM. `../`, encoded traversal, symlink escape, absolute/file URLs, HTTPS,
  popup, redirect, and permissions remain denied.
- Every Chrome selection/reload destroys the previous WebContents and revokes its protocol handlers,
  tokens, active streams, session data, timers, and find state. A stale load/crash/ready cannot
  replace the current revision.
- A PDF is displayed by Chromium's built-in viewer, not Vue/pdf.js, and an over-limit or growing PDF
  fails before unbounded bytes reach Chromium.
- File identity, type, and native actions remain visible in the Shell toolbar even when content
  loading or classification fails. Chrome selections hide selected-character metadata rather than
  displaying a fabricated zero.
- A content renderer crash preserves the standalone Shell/toolbar and publishes a recoverable error;
  Shell crash, host revoke, and window close still clean all views and authority.
- `HtmlPreview`, `PdfPreview`, the Vue `PreviewHeader`, and Vue `FileActions` paths no longer represent
  active product code; no third toolbar renderer or Chrome preload/build entry is introduced.
- Project Search, ordinary tree filtering, browsing, index progress, settings, Guide, and recent
  directory behavior remain unchanged.

# Verification

- Focused Node tests for Region lifecycle, document protocol, asset limits/revocation, classifier
  routing, Shell toolbar source/state, and Vue reset
- `node --test tests/onlypreview/*.test.mjs`
- `yarn typecheck:node`
- `yarn typecheck:web` (report unrelated baseline failures separately; no new OnlyPreview error)
- `yarn check:renderer-i18n`
- Focused ESLint for changed OnlyPreview TypeScript/Vue/config/test files
- `yarn test:application-diagnostics` when the script exists
- `node scripts/environment/runWithRuntimeProfile.cjs debug_dev -- yarn electron-vite build`
- `git diff --check`
- Electron/Playwright E2E: **do not run**. Ral will perform the final runtime/visual verification.

# Delivery Evidence

- Main now owns the selection revision, adapter, active surface, readiness, bounds, and all direct
  document/asset authority through `OnlyPreviewPreviewRegionService`. Selection, watch refresh,
  manual refresh, restore, crash, host revoke, and teardown use that one transition boundary.
- The Shell owns the fixed 43px `PreviewToolbar` and native file actions. Its inner host begins at
  y=75 after the 32px MenuBar, and Main independently clamps that lower bound. Neither Vue nor raw
  Chromium is created, loaded, or attached before the first valid inner-host bounds arrive.
- HTML/PDF use a fresh disposable raw Chromium view and memory session for every revision. The view
  has no preload or host argument; proxy, WebRTC, permission, popup, navigation, download, and
  protocol boundaries are installed before load. Only that session resolves document URLs.
- The document registry binds the canonical entry directory and exact size/device/inode/real-path
  identity. Asset and document responses use bounded pipelines, abort on revoke, and revalidate the
  open handle plus current canonical path at EOF so growth and same-size replacement cannot finish
  as a valid response.
- Presentation broadcasts are host-only nudges. Shell and Vue independently refetch their
  Main-authoritative snapshots with local generation fences; Shell never receives an asset URL,
  while only the current runtime-token-bound Vue renderer can receive its current image/media URL.
- Vue presentation changes clear renderer state and cross a `nextTick()` before the runtime reports
  reset. Main attaches only when that runtime token and numeric revision exactly match; a delayed HTML
  document issuance is likewise fenced after `issue()` and its stale revision is explicitly revoked.
- The Vue entry now contains only `PreviewSurface`. The former Vue header/actions, HTML, PDF, HTML
  service, and watch-reload service are removed. Markdown and media readiness/errors report against
  the exact current Main revision/runtime token.
- Focused Region/document behavior tests: **25/25 passed**, including delayed document issuance and
  detached-until-reset-ack Vue transitions. Full OnlyPreview Node suite: **187/187 passed**.
- `yarn typecheck:node`, strict node TypeScript (`--noCheck false`), renderer i18n, focused ESLint,
  the non-mutating Electron Vite source build, and `git diff --check`: **passed**.
- `yarn typecheck:web` still reports the pre-existing non-OnlyPreview DingTalk/Feishu/Wechat,
  Poker, Home/Connector/Maestro, and nullable-path baseline errors; it reports no OnlyPreview error.
- Task 025 keeps the Region at 798 lines after extracting its existing raw-view/find ownership,
  explicitly whitelists descriptors for both public and runtime-bound Vue snapshots, and keeps
  `OnlyPreviewWorkspace.displayPath` in Shell only. Search Shell tests and the dormant Electron spec
  source are split by responsibility with all assertions discoverable; `FileActions` remains only in
  the Shell toolbar. The combined OnlyPreview suite passes 318/318 with no skip/only/todo.
- Electron/Playwright E2E and the real application were not run. Ral retains final visual/runtime
  acceptance for toolbar geometry, live HTML/PDF behavior, refresh, crash recovery, and find.
