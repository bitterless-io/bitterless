---
id: onlypreview-preview-header-merge-018
scope: Merge the PreviewHeader WebContentsView into the Preview view and collapse the header XPC protocol
status: superseded by onlypreview-dual-preview-region-024 (historical implementation retained)
depends-on: []
---

# Objective

> Historical delivery note (2026-08-20): this merge was implemented, but the resulting single Vue
> Preview topology is now superseded by task 024. The deleted third Header renderer remains deleted;
> task 024 moves the 43px toolbar into Shell and introduces mutually exclusive Chrome/Vue content
> views. The unresolved 018 Electron failure remains historical evidence and is not relabelled pass.

Reduce the OnlyPreview preview side from two sibling native views to one. Delete the
`previewHeader` renderer entry and its `WebContentsView`, and render the 43px header as DOM inside
the existing `preview` renderer. The merged header owns file identity, the file-type badge, and the
native file actions; it also reserves the place where the `Cmd+F` find bar will mount in task 019.
Collapse the header-only XPC protocol into same-process store reads, and keep every Shell-side
surface (MenuBar, tree, local file filter, Project Search) and the Shell status rail behavior
unchanged.

This task delivers structure only. No find bar, no find adapter, no `Cmd+F` command — those are
task 019's deliverable.

# Context

- [OnlyPreview preview view merge and find ownership](../../design/onlypreview-preview-merge-find.md)
  — #1 decision, #2 target topology, #3 header composition, #5 protocol ledger
- [OnlyPreview sub-application](../../features/onlypreview.md) — current window/view composition,
  renderer entries, interaction, security, and verification contracts to update in this delivery
- [Historical search architecture snapshot](../../design/onlypreview-search-architecture.md) — its
  #2/#4/PQ-1 "merge into Shell" decision is superseded by the design doc above

# Path

- `src/main/windows/onlyPreviewWindow.helper.ts`
- `src/main/fileSearch/fileSearchWindow.service.ts`
- `src/renderer/onlypreview/previewHeader/` (delete)
- `src/renderer/onlypreview/preview/index.html`
- `src/renderer/onlypreview/preview/src/App.vue`
- `src/renderer/onlypreview/preview/src/App.less`
- `src/renderer/onlypreview/preview/src/components/PreviewHeader/` (new)
- `src/renderer/onlypreview/preview/src/components/FileActions/`
- `src/renderer/onlypreview/preview/src/components/PreviewSurface/PreviewSurface.vue`
- `src/renderer/onlypreview/preview/src/onlyPreviewPreview.store.ts`
- `src/renderer/onlypreview/preview/src/onlyPreviewWatchReload.service.ts` (moved from previewHeader)
- `src/renderer/onlypreview/shell/src/App.vue`
- `src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts`
- `src/renderer/onlypreview/common/onlyPreviewI18n.ts`
- `src/shared/onlypreview/onlyPreview.types.ts`
- `src/preload/onlypreview/onlypreview.preload.type.ts`
- `src/preload/onlypreview/onlyPreviewEnv.preload.ts`
- `electron.vite.config.ts`
- `src/main/logging/logPolicy.service.ts`
- `scripts/renderer-i18n/check-renderer-i18n.mjs`
- `scripts/diagnostics/applicationDiagnostics.test.ts`
- `tests/onlypreview/onlyPreviewCore.test.mjs`
- `tests/onlypreview/onlyPreviewAgentSkill.test.mjs`
- `tests/onlypreview/fixtures/onlyPreviewApp.fixture.ts`
- `tests/onlypreview/specs/onlyPreview.spec.ts`
- `tests/onlypreview/specs/onlyPreviewSearch.spec.ts`
- `tests/onlypreview/searchBootstrap.runtime.entry.ts`
- `docs/features/onlypreview.md`
- `docs/plan/README.md`

Do not modify unrelated owner working-tree changes (EyesOnAgents sources/tests, `package.json`,
`yarn.lock`).

# Delivery

1. Remove `previewHeaderView` from `OnlyPreviewWindowHelper`: view creation, `addChildView`,
   `render-process-gone` binding, DevTools binding, load, bounds assignment, and teardown. Preview
   remains one `WebContentsView` created with `onlypreviewContent.js`, `sandbox: true`,
   `contextIsolation: true`, `nodeIntegration: false`, and the existing exact navigation fence.
2. Replace the 43px bounds split with a single clamped rectangle for the Preview view. `Cmd+F`
   routing is out of scope; existing window-wide shortcuts, native command routing, and the
   `previewHostBounds`/settings-bounds behavior keep working against two views instead of three.
3. Delete the `onlypreview/previewHeader` renderer entry, its `index.html`, `main.ts`, `App.vue`,
   `App.less`, and store. Remove `previewHeader` from the renderer mode unions
   (`OnlyPreviewRendererMode`, `OnlyPreviewEntryMode`, `resolveEntryMode`), the Vite entry map and
   mode loop, the log policy registry, and the renderer-i18n entry list.
4. Add `components/PreviewHeader/` inside the `preview` renderer. Header identity now changes
   atomically with the content it describes (both read one local descriptor), replacing the previous
   cross-view timing where the header blanked before the content reloaded. It renders file name, relative
   path (truncating with the complete value in `title`), the existing `descriptorType` badge, and
   `FileActions`, reading the local `onlyPreviewPreviewStore` directly. Keep the 43px height, the
   existing header visual treatment, and the existing i18n keys; add keys in both `en` and `zh` when
   new copy is required.
5. Move `FileActions` out of the content body's error and unsupported states into the header so one
   instance exists per selection. Preserve every current action, its native menu behavior, and its
   disabled/empty-selection handling. The header keys the actions and its identity off
   `currentRef`, not the descriptor: a failed describe leaves no descriptor, and the previous error
   state still offered the actions in that case.
6. Move the watch-reload orchestration into the preview renderer: `onlyPreviewWatchReload.service.ts`
   and the `ONLY_PREVIEW_SEARCH_WATCH_COMMIT_EVENT` / `ONLY_PREVIEW_REFRESH_EVENT` /
   `ONLY_PREVIEW_WORKSPACE_CHANGED_EVENT` subscriptions that decide `render` vs `reload`. The
   decision and the load now happen in one store; the preview no longer broadcasts a control event
   to itself.
7. Delete `ONLY_PREVIEW_HEADER_METADATA_EVENT`, `ONLY_PREVIEW_HEADER_SYNC_REQUEST_EVENT`, and the
   `OnlyPreviewHeaderMetadata`/`OnlyPreviewHeaderMetadataEvent` cross-process shapes together with
   their runtime validators. Keep `ONLY_PREVIEW_PREVIEW_CONTROL_EVENT` but make it one-directional:
   the Preview view broadcasts it when a render/reload transition starts, and no longer subscribes to
   it; the Shell keeps its existing handler because its character-count gate must learn about
   transitions whose revision originates on the Preview side (watch-driven reload). Keep
   `ONLY_PREVIEW_CHARACTER_COUNT_*` and the Shell-owned transition gate exactly as they are: the
   Shell status rail remains the only place selected-grapheme counts are displayed, and stale
   revisions must still be rejected.
8. Update `docs/features/onlypreview.md` in the same delivery: view-composition diagram and bullets,
   standalone-only boundary wording, renderer-entries table (four visible HTML entries), the
   watch/reload paragraph that names PreviewHeader, DevTools rows in the interaction contract,
   security-contract view list, and the verification contract's three-child-view statements.
9. Update the E2E fixture and specs, the diagnostics log-policy test, and the Node tests that assert
   three visible views, the `previewHeader` path, or the header/content protocol, so they assert the
   two-view topology and the same user-visible behavior.

# Acceptance

- The standalone window creates exactly two visible child views. `out/renderer/onlypreview/` after
  `yarn build` contains `shell`, `preview`, `settings`, `guide` and no `previewHeader` entry.
- Selecting a file shows name, relative path, and type badge in the merged header, with file actions
  available from the header for text, PDF, image, audio, video, and unsupported kinds.
- The preview body no longer renders a second `FileActions` instance in its error or unsupported
  states.
- Selected-text grapheme counts still appear in the Shell status rail for Monaco, Markdown, HTML, and
  PDF, and still clear when the selection collapses, the file changes, or the workspace changes.
- A watched external edit to the previewed file still reloads it; delete/rename still renders the
  typed missing state; a later recreation reloads. Manual refresh (`F5` / `Cmd/Ctrl+R`) behaves as
  before.
- Preview geometry matches the Shell host rectangle: it stops above the status rail, right of the
  resize handle, and below the MenuBar, with no 1px gap or overlap at the header/content seam during
  window resize and sidebar drag.
- `grep -r "previewHeader" src scripts electron.vite.config.ts` returns nothing.
- A file whose `describeFile` fails still shows its name/path and the native file actions in the
  header, matching the pre-merge error state.
- A dead Shell or Preview renderer, and an unexpected hidden file-search exit, each log a named
  reason before the standalone window closes, so a vanished window is diagnosable from the log.
- Debug-profile DevTools shortcuts toggle detached DevTools for whichever of the two views received
  the input; the debug auto-open still targets the Preview view once.
- Shell MenuBar, tree, local filter, Project Search, scope switching, and index rail behavior are
  unchanged.

# Verification

- `node --test tests/onlypreview/*.test.mjs`
- `yarn typecheck:node`
- `yarn check:renderer-i18n`
- Focused ESLint for the changed OnlyPreview TypeScript/Vue files
- `yarn build`
- Electron E2E (`yarn test:e2e:onlypreview`): owner-run on request. Per the overmind rule, agents must
  not launch Electron end-to-end suites unprompted; report them as not run instead.
- `git diff --check`

# Delivery Evidence

- Two visible views only: `yarn build` output contains `out/renderer/onlypreview/{shell,preview,settings,guide}`
  and no `previewHeader` entry. `grep -r previewHeader src scripts electron.vite.config.ts` returns only the
  merged component's own BEM/`name` strings.
- `node --test tests/onlypreview/*.test.mjs`: **164/164 passed**, including the rewritten two-view
  security/geometry guards, the merged store's transition/watch/refresh subscriptions, the
  `PREVIEW_CONTROL` direction flip, and the absence of the header metadata protocol.
- `yarn typecheck:node`, `yarn check:renderer-i18n` (inventory now 16 entries), focused ESLint on the
  changed OnlyPreview files, and `yarn build`: **passed**.
- `yarn typecheck:web` still fails on pre-existing errors in unrelated files (`chat`, `maestro`, `omni`,
  `pathHelper`, `onlyPreviewShell.store.ts` host-id nullability). None of them are in this delivery's
  diff; they are the branch's in-progress state.
- Electron E2E: one interrupted run reported **7 passed, 1 failed** —
  `renders immutable text, selectable PDF, image pixels, and seekable audio/video` failed at the audio
  `Range` request step with `OnlyPreview preview view is unavailable`, meaning the standalone window or
  its Preview view was gone at that instant. Root cause is **not established**, and the run was not
  repeated because the owner directed that Electron E2E must not be run unprompted. This task therefore
  stays open for owner E2E verification; treat that failure as unresolved until then.

## Post-review fixes (2026-08-18)

- **Header lost the file actions on a failed describe.** The first merge rendered the header only when
  a descriptor existed, but the pre-merge error state rendered `FileActions` whenever `currentRef`
  existed. `describeFile` failures produce no descriptor, so `Open externally` / `Reveal` disappeared
  exactly when they matter most. The header now derives identity and actions from `currentRef` with the
  descriptor as the preferred source, and the type badge renders only when the kind is known.
- **A vanished standalone window left no evidence.** `render-process-gone` and the hidden file-search
  lifecycle failure both closed the window silently, which surfaces downstream as
  `OnlyPreview preview view is unavailable` with no cause. Both paths now log the view and the exit
  reason (`fileSearchWindowService.start`'s `onUnexpectedExit` forwards the fence message) before
  teardown. This is the diagnostic for the open E2E failure above; it does not by itself explain it.
- Re-verified after both fixes: `node --test tests/onlypreview/*.test.mjs` **164/164**,
  `yarn typecheck:node`, focused ESLint, and `yarn build` **passed**. Electron E2E not run.
