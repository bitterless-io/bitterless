# OnlyPreview MVP Delivery Analysis

## Goal

Deliver the accepted `docs/features/onlypreview.md` contract as a usable Bitterless Mini App,
standalone multi-`WebContentsView` window, app-specific Setting window, and OS file-open target.

## Module Decomposition

| Module | Inputs | Outputs | Dependencies | Verification |
|---|---|---|---|---|
| Shared contracts | untrusted XPC/settings/index values | parsed types and discriminated result envelopes | none | pure contract tests |
| Host/workspace capability registry | Main-created views + native-dialog/OS absolute path | host-bound opaque workspace + relative refs | Node fs/path, UUID | host isolation/revocation/containment tests |
| Index service | authorized workspace, settings | bounded flat metadata index | workspace registry | fixture traversal/sort/limit tests |
| File descriptor/text service | authorized relative file ref | typed descriptor/text or explicit error | workspace registry | signature/binary/encoding/size tests |
| Asset protocol | authorized descriptor | tokenized manual full/206 streaming response | Electron protocol, Node fs streams, token registry | token/range/source guards + Electron smoke |
| Open router | macOS event or Windows argv | serialized standalone-open request | app lifecycle, window handler | argv/early queue tests |
| Standalone window graph | folder-open/selection/bounds/settings/menu commands | BaseWindow, Shell/Preview views, parented Setting window, native file menu | window state, renderer targets | lifecycle/source/E2E tests |
| Shell renderer | workspace/index/settings | searchable tree, preview-file locator, count-free status, commands | XPC, Arco, Tabler icons | renderer source/type/E2E tests |
| Preview renderer/component | file ref/settings | code/PDF.js canvas+TextLayer/image/audio/video/fallback | XPC, Monaco, unpdf/pdfjs, asset scheme | renderer/E2E fixtures |
| Setting renderer | current settings | validated saved snapshot or cancel | XPC, Arco | component/source/E2E tests |
| Home integration | card click | focus/create standalone window | XPC handler | catalog/i18n tests |
| Packaging integration | verified extension catalog | alternate viewer associations | electron-builder | config audit + packaged manual check |

## Integration Enumeration

1. Home `MiniApp.vue` calls `OnlyPreviewWindowHandler.openOnlyPreviewWindow` and the handler
   creates/focuses the standalone graph.
2. macOS `open-file`, packaged Windows initial argv, and `second-instance` all call the same open
   router; the router waits for GUI/XPC readiness and calls the same handler with a Main-owned path.
3. Main pre-registers an unguessable host capability before creating a Shell, Preview, or Setting
   view and exposes it only through that view's preload context. Shell and Preview share one
   content host; Setting uses a distinct settings-only host.
4. The handler asks the workspace registry to validate the target and bind it to the live host,
   then gives the Shell only an opaque workspace snapshot. Shell calls index/descriptor/read
   methods with host + workspace + relative path; every service call re-enters host ownership and
   containment checks and returns a result envelope rather than relying on thrown XPC errors.
5. Shell reports its preview-host rectangle; handler validates it and changes only the standalone
   Preview `WebContentsView` bounds.
6. Shell selection reloads/notifies the dedicated Preview view with a capability file ref.
7. Descriptor authorizes a host-bound asset token. Image/media requests use the internal scheme;
   protocol resolves the token and manually returns full or correct single-range stream responses.
   PDF fetches the same authorized bytes and renders PDF.js canvases plus selectable TextLayers.
8. Shell/Preview opens the Setting window through the same handler; save validates, persists in
   `SettingDao`, then broadcasts the committed snapshot to live OnlyPreview renderers.
9. Omni's shared mini-app parser, runtime registry, and Control selector all reject or omit
   `onlypreview`; OnlyPreview has no embedded container mode or cell lifecycle.
10. Standalone/Setting teardown revokes the exact host, its workspaces, and media tokens. Auth
    invalidation and host quit close every remaining child webContents, window, capability, and
    token.
11. Electron Vite produces one preload and three renderer entries; logging/i18n/package audits
    recognize every emitted path.
12. The Shell renders the standalone 32px MenuBar and sends capability-scoped window-control
    intents through the OnlyPreview XPC handler; Main alone minimizes, toggles maximize, or closes
    the current `BaseWindow`, while Preview bounds begin immediately below that bar.
13. In the debug runtime profile, Main intercepts standard DevTools shortcuts on each standalone
    child `webContents` and toggles that exact Shell or Preview target in a detached window. Release
    profiles keep the path disabled; no renderer API or capability is added.
14. The visible picker is folder-only. The Shell can locate its already-authorized current file
    locally, while file-row context menus cross the child-view boundary through a capability-scoped
    request and a Main-owned native `Menu` attached to the active `BaseWindow`.
15. The Setting `BrowserWindow` uses the active content host's `BaseWindow` as its parent and is
    centered/clamped from that current window whenever opened; persisted Setting size must not
    restore a stale independent screen position.

No integration boundary may remain a stub or a source-only declaration.

## Delivery Shape

The original MVP was delivered atomically as `onlypreview-mvp-001`. Product correction
`onlypreview-standalone-only-002` removes the incompatible Omni adapter and its second rendering
mode while preserving the standalone capability model, renderer entries, settings, and OS-open
path as one focused follow-up delivery. `onlypreview-menubar-003` then aligns the Shell-owned
window chrome with the EyesOnAgents standalone pattern without sharing its private renderer state
or changing the multi-view process graph. `onlypreview-devtools-004` restores per-view development
inspection without changing release behavior or adding a renderer-to-Main API.
`onlypreview-shell-ux-005` then removes redundant picker/status chrome, adds in-tree current-file
location and a native file action menu, and anchors Settings to the active standalone window.

## Main Risks And Decisions

| Risk | Decision |
|---|---|
| XPC lacks sender identity | Main-issued per-view host capability + host-bound workspace/media capabilities; relative paths only; realpath containment on every operation |
| XPC handler swallows exceptions | every fallible API returns a discriminated success/error envelope |
| `BaseWindow` child views leak | explicit detach + `webContents.close()` for Shell and Preview |
| large directories freeze UI | async bounded walk, fixed ignored outputs, request generation, partial result state |
| media cannot seek | privileged streaming custom scheme + manual bounded 206 byte ranges |
| untrusted HTML/SVG executes | HTML is Monaco source; SVG only an image resource; local target navigation fenced |
| Monaco intercepts shortcuts | window-local `before-input-event`, prevent only matched app commands |
| Native window graph cannot fit one Omni cell | exclude OnlyPreview from Omni types, UI, runtime mapping, and persisted state |
| Custom chrome controls the wrong process/window | Shell emits capability-scoped OnlyPreview intents; Main mutates only the active OnlyPreview `BaseWindow` |
| BaseWindow child views bypass BrowserWindow DevTools shortcuts | bind debug-only standard shortcuts directly to each Shell/Preview `webContents`; always detach and toggle only the input owner |
| A DOM context menu is clipped or covered by the sibling Preview view | Main owns a capability-scoped native `Menu` and attaches it to the active OnlyPreview `BaseWindow` |
| Setting restores an unrelated historic screen position | retain only its stored size; parent, center, and work-area clamp it from the currently authorized standalone window on every open |
| extension-only association omits unknown files | common associations plus macOS `public.data` Viewer/Alternate and a bounded Windows generic context-menu verb, never default ownership |
| Electron 40 file fetch/PDF embedding gaps | manual 206 file streaming and installed PDF.js `print` intent + disabled annotations canvas + selectable TextLayer, all runtime-probed |
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
