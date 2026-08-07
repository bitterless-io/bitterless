# OnlyPreview MVP Delivery Analysis

## Goal

Deliver the accepted `docs/features/onlypreview.md` contract as a usable Bitterless Mini App,
standalone multi-`WebContentsView` window, Omni mini app, app-specific Setting window, and OS file
open target.

## Module Decomposition

| Module | Inputs | Outputs | Dependencies | Verification |
|---|---|---|---|---|
| Shared contracts | untrusted XPC/settings/index values | parsed types and typed errors | none | pure contract tests |
| Workspace capability registry | native-dialog/OS absolute path | opaque workspace + relative refs | Node fs/path, UUID | containment/symlink/device tests |
| Index service | authorized workspace, settings | bounded flat metadata index | workspace registry | fixture traversal/sort/limit tests |
| File descriptor/text service | authorized relative file ref | typed descriptor/text or explicit error | workspace registry | signature/binary/encoding/size tests |
| Asset protocol | authorized descriptor | tokenized streaming URL | Electron protocol/net, token registry | token/range/source guards + Electron smoke |
| Open router | macOS event or Windows argv | serialized standalone-open request | app lifecycle, window handler | argv/early queue tests |
| Standalone window graph | open/selection/bounds/settings commands | BaseWindow, Shell/Preview views, Setting window | window state, renderer targets | lifecycle/source/E2E tests |
| Shell renderer | workspace/index/settings | searchable tree, bounds, status, commands | XPC, Arco | renderer source/type/E2E tests |
| Preview renderer/component | file ref/settings | code/PDF/image/audio/video/fallback | XPC, Monaco, asset scheme | renderer/E2E fixtures |
| Setting renderer | current settings | validated saved snapshot or cancel | XPC, Arco | component/source/E2E tests |
| Home integration | card click | focus/create standalone window | XPC handler | catalog/i18n tests |
| Omni integration | typed mini-app selection | embedded Shell renderer | Omni runtime/config | existing + focused Omni tests |
| Packaging integration | verified extension catalog | alternate viewer associations | electron-builder | config audit + packaged manual check |

## Integration Enumeration

1. Home `MiniApp.vue` calls `OnlyPreviewWindowHandler.openOnlyPreviewWindow` and the handler
   creates/focuses the standalone graph.
2. macOS `open-file`, packaged Windows initial argv, and `second-instance` all call the same open
   router; the router waits for GUI/XPC readiness and calls the same handler with a Main-owned path.
3. The handler asks the workspace registry to validate the target, then gives the Shell only an
   opaque workspace snapshot.
4. Shell calls index/descriptor/read methods with capability + relative path; every service call
   re-enters workspace containment checks.
5. Shell reports its preview-host rectangle; handler validates it and changes only the standalone
   Preview `WebContentsView` bounds.
6. Standalone selection reloads/notifies the dedicated Preview view with a capability file ref;
   Omni selection renders the same Preview surface inside its cell renderer.
7. Descriptor authorizes a media token; HTML media/PDF requests the internal scheme; protocol
   resolves the token and streams the Main-owned file with Range support.
8. Shell/Preview opens the Setting window through the same handler; save validates, persists in
   `SettingDao`, then broadcasts the committed snapshot to live OnlyPreview renderers.
9. `OMNI_MINI_APP_IDS` feeds parsing/persistence while `OmniPane.vue` and
   `OMNI_MINI_APP_RUNTIME` independently expose/load OnlyPreview; tests must cross-check all three.
10. Auth invalidation and host quit call the handler cleanup, which closes all child webContents,
    windows, capabilities, and media tokens.
11. Electron Vite produces one preload and three renderer entries; logging/i18n/package audits
    recognize every emitted path.

No integration boundary may remain a stub or a source-only declaration.

## Delivery Shape

The modules share one capability model, one handler, one renderer component tree, and the same
Vite/Omni registries. Splitting them into parallel tasks would create overlapping contracts and a
period where a privileged file API exists without its complete host fencing. The MVP is therefore
one serial, atomic task: `onlypreview-mvp-001`.

## Main Risks And Decisions

| Risk | Decision |
|---|---|
| XPC lacks sender identity | opaque workspace capabilities; relative paths only; realpath containment on every operation |
| `BaseWindow` child views leak | explicit detach + `webContents.close()` for Shell and Preview |
| large directories freeze UI | async bounded walk, fixed ignored outputs, request generation, partial result state |
| media cannot seek | privileged streaming custom scheme + forwarded Range request |
| untrusted HTML/SVG executes | HTML is Monaco source; SVG only an image resource; local target navigation fenced |
| Monaco intercepts shortcuts | window-local `before-input-event`, prevent only matched app commands |
| Omni child view crosses cell | embedded host uses in-renderer Preview surface; Omni alone owns native bounds |
| broad file association hijacks defaults | declare only verified MVP extensions, Viewer/Alternate on macOS |
| existing unrelated test failures | record baseline and compare touched/focused gates; never relabel baseline failures |

## Verification Layers

1. Pure unit tests for contracts, classifier, capability containment, indexing, and open-argument
   parsing.
2. Focused source/integration tests for host wiring and security preferences.
3. Node and web typechecks, renderer i18n guard, targeted ESLint, `git diff --check`.
4. Full Electron Vite build and output audit.
5. Playwright/Electron fixture flow plus screenshots at normal and minimum window size.
6. Separate packaged macOS/Windows association and codec verification if signing/build hosts are
   available; otherwise this remains an explicit human handoff and does not get misreported as
   automated proof.

