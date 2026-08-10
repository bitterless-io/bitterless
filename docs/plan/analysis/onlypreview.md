# OnlyPreview MVP Delivery Analysis

## Goal

Deliver the accepted `docs/features/onlypreview.md` contract as a usable Bitterless Mini App,
standalone multi-`WebContentsView` window, app-specific Setting window, and OS file-open target.

## Module Decomposition

| Module                             | Inputs                                                 | Outputs                                                                                                 | Dependencies                                           | Verification                                                        |
| ---------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------- |
| Shared contracts                   | untrusted XPC/settings/index values                    | parsed types and discriminated result envelopes                                                         | none                                                   | pure contract tests                                                 |
| Host/workspace capability registry | Main-created views + native-dialog/OS absolute path    | host-bound opaque workspace + relative refs                                                             | Node fs/path, UUID                                     | host isolation/revocation/containment tests                         |
| Recent-directory service           | canonical workspace root + Core SQLite lifecycle       | latest directory candidate, per-host restore, fresh workspace capability                                | `SettingDao`, workspace/host registries                | latch/CAS/single-flight/order tests                                 |
| Search bootstrap capability        | attached host + opaque workspace                       | private root/database paths injected only into UtilityProcess initialization                            | host/workspace registries, user-data path              | token/revocation/no-renderer-path tests                             |
| Search UtilityProcess runtime      | private root/database paths, query/config/watch events | exclude-independent tree-name tier, excluded v7 SQLite file/content tier, file-only search results, aggregate telemetry | Electron utility process, `node:sqlite`, YAML, filesystem | dual-corpus/schema/query/snippet/watch/cancel/memory/recovery tests |
| File descriptor/text service       | authorized relative file ref                           | typed descriptor/text or explicit error                                                                 | workspace registry                                     | signature/binary/encoding/size tests                                |
| Asset protocol                     | authorized descriptor                                  | tokenized manual full/206 streaming response                                                            | Electron protocol, Node fs streams, token registry     | token/range/source guards + Electron smoke                          |
| Open router                        | macOS event or Windows argv                            | serialized standalone-open request                                                                      | app lifecycle, window handler                          | argv/early queue tests                                              |
| Standalone window graph            | folder-open/selection/bounds/settings/menu commands    | BaseWindow, Shell/Header/Content views, parented Setting window, native file menu                       | window state, renderer targets                         | lifecycle/source/E2E tests                                          |
| Agent skill and Guide              | explicit absolute file/folder + current helper/runtime | read-only `preview.open`, portable skill, parented Guide window                                         | MCP bridge, OnlyPreview open router, package resources | pure schema/dispatch/path/resource/source tests                     |
| Shell renderer                     | workspace/index/settings/scoped search batches         | pre-query-visible name filter, scoped file-only Project Search, preview-file locator, status, commands  | preload XPC, Arco, Tabler icons                        | renderer source/type tests                                          |
| Preview Header renderer            | display-only descriptor/control                        | fixed 43px file identity/type and Content render/reload/clear                                           | renderer-local XPC broadcasts                          | source/lifecycle tests                                              |
| Preview Content renderer/component | file ref/settings/watch revision                       | code/inert HTML+Markdown/PDF.js canvas+TextLayer/image/audio/video/fallback plus selected-file rerender | XPC, Monaco, DOMPurify, unpdf/pdfjs, asset scheme      | pure renderer/source tests + owner acceptance                       |
| Setting renderer                   | current settings + active category                     | left category navigation, one focused setting list, validated saved snapshot or cancel                   | XPC, Arco                                              | component/source/E2E tests                                          |
| Home integration                   | card click                                             | focus/create standalone window                                                                          | XPC handler                                            | catalog/i18n tests                                                  |
| Packaging integration              | verified extension catalog                             | alternate viewer associations                                                                           | electron-builder                                       | config audit + packaged manual check                                |

## Integration Enumeration

1. Home `MiniApp.vue` calls `OnlyPreviewWindowHandler.openOnlyPreviewWindow` and the handler
   creates/focuses the standalone graph.
2. macOS `open-file`, packaged Windows initial argv, and `second-instance` all call the same open
   router; the router waits for GUI/XPC readiness and calls the same handler with a Main-owned path.
3. Main pre-registers an unguessable host capability before creating a Shell, Header, Content, or
   Setting view and exposes it only through that view's preload context. Shell, Header, and Content share one
   content host; Setting uses a distinct settings-only host.
4. The handler asks the workspace registry to validate the target and bind it to the live host,
   then gives Shell only an opaque workspace snapshot. A private search-bootstrap capability stays
   in Main; after host/workspace validation Main enriches only the UtilityProcess initialization
   message with root/database paths. Descriptor/read methods retain host + workspace + relative-path
   containment, and no preload or page receives the bootstrap token or absolute paths.
5. Shell reports its preview-host rectangle; Main validates it, assigns its first 43px to Header,
   and assigns the remainder to Content.
6. Shell selection notifies Header and Content with a capability file ref. Header owns display and
   reload/clear control; Content owns descriptor/read/render and display-only metadata response.
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
11. Electron Vite produces the sandbox-safe shared preload, sandbox-safe Content preload, dedicated
    Main-side UtilityProcess entry, and five renderer entries through official watched inputs;
    logging/i18n/package audits recognize every emitted path in build and development mode.
12. The Shell renders the standalone 32px MenuBar and sends capability-scoped window-control
    intents through the OnlyPreview XPC handler; Main alone minimizes, toggles maximize, or closes
    the current `BaseWindow`, while Preview bounds begin immediately below that bar.
13. In the debug runtime profile, Main intercepts standard DevTools shortcuts on each standalone
    child `webContents` and toggles that exact Shell, Header, or Content target in a detached window. Release
    profiles keep the path disabled; no renderer API or capability is added.
14. The visible picker is folder-only. The Shell can locate its already-authorized current file
    locally, while file-row context menus cross the child-view boundary through a capability-scoped
    request and a Main-owned native `Menu` attached to the active `BaseWindow`.
15. The Setting `BrowserWindow` uses the active content host's `BaseWindow` as its parent and is
    centered/clamped from that current window whenever opened; persisted Setting size must not
    restore a stale independent screen position.
16. A successful folder open or Main-owned OS file target gives the recent-directory service only
    the canonical workspace root. The service stores version 1 under
    `onlypreview_workspace/last_directory` with `getStored` plus `insertIfAbsent`/`compareAndSet`;
    no file selection or capability identifier is persisted or logged.
17. `app.main.ts` resolves the recent-directory service's Core SQLite ready/failure latch. Shell
    and Preview `restoreWorkspace` calls share one per-host flight after that latch, reconstruct a
    fresh directory workspace at most once, and clear all coordination state when the host is
    revoked.
18. The OS-open path advances the explicit-target generation and suppresses history restore before
    `ensureStandalone()` mounts child renderers. The latest explicit request wins any late history
    read and is the only target allowed to update the remembered directory.
19. The production `bitterless` MCP exposes one `preview.open` tool. Its bridge validates an
    explicit absolute path, then calls the same Main-owned `openOnlyPreviewAbsoluteTarget` route as
    OS file-open; it returns only `{ opened: true }` and never exposes file bytes or directory data.
20. The MenuBar Robot action opens a non-modal singleton Guide `BrowserWindow` parented to the
    active standalone window. The Guide owns an isolated host role that can read only one English
    complete-setup instruction; the complete `bitterless-preview` directory is copied into
    packaged resources and referenced by that instruction together with the current MCP config.
    Its renderer constructs an exact info-only XPC client. Home's existing tokenless, idempotent
    `openOnlyPreviewWindow` endpoint remains an independent global launch action, not Guide-token
    authority.
21. Shell initializes and queries a narrow Main XPC proxy. Main validates the attached host, resolves
    the private bootstrap, supervises one host-bound UtilityProcess, and relays bounded calls without
    search I/O. Only the UtilityProcess walks directories, classifies media, reads searchable text,
    builds/reopens SQLite, applies 400ms trailing file updates, and executes/cancels queries. It owns
    one-active/one-latest execution and emits at most 500 exact file-only results with text-only
    grapheme snippets; Shell retains its 120ms leading-plus-trailing IME-aware scheduler.
22. Entering Project Search captures a stable current-directory anchor and sends a strict relative
    `In Directory` scope by default; the Shell selector can switch the same query to `In Project`.
    Ordinary filtering never enters that protocol: it matches only `entry.name` on the rows visible
    before the query and preserves expansion exactly.
23. After the UtilityProcess's final 400ms-trailing committed change, it raw-posts a fenced event to
    Main. Main whitelists and shape-validates the event, binds it to the attached `hostId`, and uses
    `xpcMain.broadcast`; PreviewHeader accepts only the current selected path and a newer revision,
    reuses its existing reload control, and PreviewContent advances its generation before reading.
    A stale workspace, selection, read, or revision cannot install; Main performs no watch or reload
    I/O.

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
`onlypreview-recent-directory-006` adds SQLite-backed last-directory restoration without
persisting a selected file or weakening the process-local capability boundary.
`onlypreview-e2e-keychain-isolation-007` retains full-application E2E while routing every macOS
launch through Chromium's mock Keychain and rejecting an incompletely isolated E2E Main process
before GUI startup.
`onlypreview-safe-markdown-selection-008` finishes the reader surface by rendering ordinary
Markdown through an explicit parser/sanitizer boundary and reporting grapheme-aware selections
from the Content view to the Shell-owned bottom status rail.
`onlypreview-agent-skill-guide-009` adds a portable read-only Preview skill, one production
`preview.open` MCP command that reuses the existing open router, and a parented MenuBar Guide whose
single copy action teaches an agent both MCP connection and skill installation.
`onlypreview-tree-html-preview-010` preserves complete deep Project names through intrinsic-width
horizontal scrolling and routes `.html`/`.htm` through a bounded, zero-attribute DOMPurify semantic
renderer before the Monaco source fallback.
`onlypreview-preview-debug-identity-011` makes the distinct Preview `webContents` immediately
inspectable after its initial debug load, while keeping Shell/Settings/Guide and E2E quiet; it also
uses the canonical workspace root name in the Project header and removes the redundant MenuBar
separator before the absolute path.
`onlypreview-search-worker-012` splits the right pane into sandboxed Header and trusted-preload
Content views, moves project traversal/index/query/watch work into a Content-owned Node Worker, and
adds persistent incremental file-only Project Search without exposing absolute paths or blocking
Shell input.
`onlypreview-search-scope-watch-013` then supplies the scope and current-directory semantics omitted
from 012, narrows the ordinary filter to pre-query-visible entry names without expansion, makes
root/dot visibility explicit, connects committed watch changes to selected-Preview rerender, and
requires a new current-product Overmind baseline instead of treating 012 or prototype evidence as
proof.
`onlypreview-search-performance-acceptance-014` closes the remaining canonical warm-search latency
families and aligns the dormant acceptance surface with the delivered three-view graph. Its E2E
contract distinguishes Shell, Header, and Content by `webContents.id`, treats OS renderer PIDs as
positive diagnostics rather than unique identities, verifies exact 43px Header/Content geometry and
per-view security/DevTools behavior, and removes the inert hidden-files Setting control while
retaining serialized compatibility. Canonical PRODUCT-P01 then proves same-attempt A-B-B-A semantic
equality (24/24) and the strict direct `<100ms` target (`stop=true`). The production runtime was
subsequently moved from Content-preload `worker_threads` to a host-bound UtilityProcess because the
Electron Content preload cannot safely provide that Node runtime. All visible views are now
sandboxed; Main owns only capability/private-bootstrap validation, spawn/lifecycle, time-bounded XPC
proxying, and validated host-bound event relay over raw `parentPort`. `yarn build` passes, and
`yarn test:e2e:onlypreview` passes 7/7; packaged release build/startup remains untested.
`onlypreview-settings-category-navigation-015` then replaces the stacked Setting cards with a fixed
left category rail and one right-hand settings list. The active category remains renderer-local;
Preview is the default, category changes preserve the shared draft, and global Cancel/Save behavior
is unchanged.
`onlypreview-dual-index-exclusion-watch-016` separates the ordinary tree-name data from Project
Search eligibility. The tree keeps file/directory metadata even for hidden, generated, and
workspace-config-excluded paths; the file/content SQLite branch physically rejects hidden-directory
descendants and immutable output directories before body reads. The same 400ms trailing watcher
converges create/update/delete/rename across both destinations.

## Main Risks And Decisions

| Risk                                                                     | Decision                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| XPC lacks sender identity                                                | Main-issued per-view host capability + host-bound workspace/media capabilities; relative paths only; realpath containment on every operation                                                                                                                                                                                                                                              |
| XPC handler swallows exceptions                                          | every fallible API returns a discriminated success/error envelope                                                                                                                                                                                                                                                                                                                         |
| `BaseWindow` child views or search runtime leak                          | host-bound UtilityProcess termination and pending-call rejection plus detach + `webContents.close()` for Shell, Header, and Content                                                                                                                                                                                                                                                       |
| large directories freeze UI                                              | cooperative UtilityProcess metadata traversal, time-sliced batches, Project Search fixed/ordered body-index exclusions, cancellation/generation fences                                                                                                                                                                                                                                    |
| media cannot seek                                                        | privileged streaming custom scheme + manual bounded 206 byte ranges                                                                                                                                                                                                                                                                                                                       |
| untrusted HTML/SVG executes                                              | `.html`/`.htm` use a 1 MiB zero-attribute semantic DOMPurify allowlist with active/resource/navigation tags and contents removed; no iframe/preload/asset URL is created; SVG remains only an image resource                                                                                                                                                                              |
| deep tree indentation and names are clipped                              | the tree viewport owns both axes; rows use intrinsic width with a viewport-width floor and names remain complete single-line content                                                                                                                                                                                                                                                      |
| Monaco intercepts shortcuts                                              | window-local `before-input-event`, prevent only matched app commands                                                                                                                                                                                                                                                                                                                      |
| Native window graph cannot fit one Omni cell                             | exclude OnlyPreview from Omni types, UI, runtime mapping, and persisted state                                                                                                                                                                                                                                                                                                             |
| Custom chrome controls the wrong process/window                          | Shell emits capability-scoped OnlyPreview intents; Main mutates only the active OnlyPreview `BaseWindow`                                                                                                                                                                                                                                                                                  |
| BaseWindow child views bypass BrowserWindow DevTools shortcuts           | bind debug-only standard shortcuts directly to each Shell/Header/Content `webContents`; always detach and toggle only the input owner                                                                                                                                                                                                                                                     |
| A DOM context menu is clipped or covered by sibling Header/Content views | Main owns a capability-scoped native `Menu` and attaches it to the active OnlyPreview `BaseWindow`                                                                                                                                                                                                                                                                                        |
| Setting restores an unrelated historic screen position                   | retain only its stored size; parent, center, and work-area clamp it from the currently authorized standalone window on every open                                                                                                                                                                                                                                                         |
| Shell and Content race to restore one persisted directory                | one per-host restore promise with workspace rechecks before and after the SQLite latch                                                                                                                                                                                                                                                                                                    |
| Search path capability leaks into a page                                 | Main-only bootstrap; root/database paths enter only the UtilityProcess initialization request and never contextBridge, renderer results, or logs                                                                                                                                                                                                                                          |
| Search I/O blocks Main or Shell typing                                   | Main performs no traversal/read/query/watch; UtilityProcess owns the runtime and Shell owns input                                                                                                                                                                                                                                                                                         |
| Watch events are lost, spoofed, or update only the index                 | 400ms trailing UtilityProcess commit → raw fenced event → Main validation/host binding/XPC broadcast → Header selection/revision gate → existing reload control → Content generation/read                                                                                                                                                                                                  |
| Local filter silently searches collapsed paths or expands the tree       | freeze the pre-query visible rows, match exact `entry.name` only, retain context ancestors, and never mutate expansion                                                                                                                                                                                                                                                                    |
| Project Search scope drifts with result selection                        | capture one relative directory before results replace the tree; default In Directory and switch explicitly to In Project                                                                                                                                                                                                                                                                  |
| Tree visibility and Project Search exclusions accidentally share policy  | keep an exclude-independent metadata/name tier for the ordinary tree; apply hidden/fixed/config policy only to the separate file/content SQLite tier before body reads                                                                                                                                                                                                                     |
| Non-text bytes enter full-text results                                   | persisted mediaType/isText gate; titles searchable for all files, body decode/index only for reviewed text                                                                                                                                                                                                                                                                                |
| Short/CJK candidates produce false positives                             | NFKC candidate generation plus exact normalized-original verification before snippet projection                                                                                                                                                                                                                                                                                           |
| Search memory/disk is misreported                                        | runtime >1GiB advisory; >2GiB sets `performanceAccepted=false` and `stop=false` without invalidating the artifact/method; SQLite footprint is recorded separately and never summed                                                                                                                                                                                                        |
| Benchmark/prototype evidence is reported as current product proof        | PRODUCT-P00/P01 remain immutable history for their hidden-inclusive physical corpus; the dual-index/hidden-pruned policy requires a new PRODUCT-P02 current point, while the roughly 1.412GB disk figure remains prototype history                                                                                                                        |
| A late history read replaces an OS-opened file                           | suppress history before `ensureStandalone()`, fence mutations by generation, and let the latest explicit target win                                                                                                                                                                                                                                                                       |
| SQLite is late or unavailable                                            | ready/failure latch; retain only the latest pre-ready write, return empty on failure, and never block explicit opens                                                                                                                                                                                                                                                                      |
| Invalid history or concurrent cleanup erases a newer path                | revalidate through `createForTarget` and CAS-clear only the exact observed invalid serialized value                                                                                                                                                                                                                                                                                       |
| Persisted path leaks authority or logs                                   | persist only the canonical directory in Main-owned SQLite; use only no-value-log DAO methods and mint fresh capabilities on restore                                                                                                                                                                                                                                                       |
| Full-application E2E prompts for the owner's macOS Keychain              | one shared launch-argument builder prepends `--use-mock-keychain`; E2E Main fails before GUI startup when the macOS switch is absent                                                                                                                                                                                                                                                      |
| Untrusted Markdown executes HTML, navigation, or remote loads            | current direct `marked` plus DOMPurify dependencies; raw HTML is escaped, output is allowlisted to semantic tags with zero attributes, and images/links receive no executable URL                                                                                                                                                                                                         |
| Preview and bottom rail live in sibling WebContentsViews                 | Preview broadcasts a host-scoped display-only selection count; Shell accepts only its matching host and resets on selection/workspace change                                                                                                                                                                                                                                              |
| UTF-16 length miscounts visible characters                               | count Unicode grapheme clusters with `Intl.Segmenter`, falling back to code points only when unavailable                                                                                                                                                                                                                                                                                  |
| Shell DOM Guide is covered by sibling native Header/Content views        | use one parented non-modal Guide `BrowserWindow`, not an in-Shell modal                                                                                                                                                                                                                                                                                                                   |
| Guide inherits file-reading authority                                    | issue a dedicated `guide` role whose only privileged call returns one fixed setup instruction                                                                                                                                                                                                                                                                                             |
| Agent skill invents a second file-open path                              | `preview.open` delegates to the existing Main-owned absolute-target router                                                                                                                                                                                                                                                                                                                |
| Packaged Markdown skill silently disappears                              | explicitly copy and validate the complete `bitterless-preview` directory through `extraResources`                                                                                                                                                                                                                                                                                         |
| Debug Preview errors are hidden behind the sibling Shell view            | auto-open only the initial Preview DevTools in a detached inactive window for a normal debug profile; retain manual per-view toggles                                                                                                                                                                                                                                                      |
| Workspace identity repeats or misstates path syntax                      | use Main-owned `rootName` for the Project label and render the absolute `displayPath` without an injected separator                                                                                                                                                                                                                                                                       |
| extension-only association omits unknown files                           | common associations plus macOS `public.data` Viewer/Alternate and a bounded Windows generic context-menu verb, never default ownership                                                                                                                                                                                                                                                    |
| Electron 40 file fetch/PDF embedding gaps                                | manual 206 file streaming and installed PDF.js `print` intent + disabled annotations canvas + selectable TextLayer, all runtime-probed                                                                                                                                                                                                                                                    |
| existing unrelated test failures                                         | record baseline and compare touched/focused gates; never relabel baseline failures                                                                                                                                                                                                                                                                                                        |

## Verification Layers

1. Pure unit tests for contracts, classifier, capability containment, visible-row filtering,
   directory/project scopes, persistent indexing, throttle/IME/cancellation, snippets, watch
   reconciliation plus selected-Preview rerender, and open-argument
   parsing, plus recent-directory codec, latch, CAS, generation, and per-host single-flight state.
2. Focused source/integration tests for host wiring and security preferences.
3. Node and web typechecks, renderer i18n guard, targeted ESLint, `git diff --check`.
4. Full Electron Vite build and output audit. Earlier UtilityProcess integration evidence has
   `yarn build` PASS with the official shared/Content preload and Main UtilityProcess entries;
   task 016 has not rerun the build.
5. Electron/Node unit tests simulate storage ready/failure, fresh hosts, concurrent restore, and
   explicit-target ordering. Retained full-application E2E launches through one shared argument
   builder; macOS prepends `--use-mock-keychain`, and Main rejects E2E mode without that switch
   before GUI startup. Earlier `yarn test:e2e:onlypreview` evidence is PASS (7/7) under the preceding
   search policy. Task 016 updates the E2E contract for independent tree metadata, physical
   hidden/core/config pruning, and watch CRUD/rename, but has not rerun Electron acceptance yet.
6. Separate packaged macOS/Windows association and codec verification if signing/build hosts are
   available; otherwise this remains an explicit human handoff and does not get misreported as
   automated proof.
7. Preview-skill delivery uses pure Node/schema/source/type/i18n/lint checks only. It does not start
   Electron, Playwright, the full application, a build, or Keychain-capable runtime; Ral performs
   the final Guide/install/agent-open acceptance manually.
8. Search-scope acceptance is backed by canonical Overmind `PRODUCT-P00`, artifact
   `areas/agent/runtime/human/preview/product-benchmark/results/PRODUCT-P00-2026-08-09T17-14-11.034Z-289c3f0152b8.json`
   (SHA-256 `289c3f0152b838512a7123acb2fd8ae3e9ad981a9125897a194c79fb976c00cd`).
   The run is recording/trend eligible and performance accepted; first build was 66,214.878ms,
   fresh Worker reopen was 48.637ms with filesystem cache uncontrolled/likely warm, reconcile was
   12,033.667ms, runtime peak was 852,492,288 bytes, and final SQLite was 642,551,808 bytes after a
   691,402,296-byte peak. All warm first-result p95 values were below 100ms; only In Project CJK
   unigram, CJK bigram, and combining-text complete-result p95 values exceeded 100ms. Cancellation
   completed in 0.292ms without a late batch, and synthetic watch commit/verification took
   442.041/489.881ms with one changed path and no full reconcile. As the first product point it
   remains `stop=false`. Its dynamic boundary is fresh child → production Worker client →
   TypeScript Worker → engine/result batcher → coordinator; Electron preload/XPC, Shell's 120ms
   scheduler, Header/Content commit, and packaged startup are outside that artifact. Later 7/7
   Electron E2E covers the unpackaged runtime path; packaged release remains untested. Task 012 and
   old prototype/R05/failed-R06 values remain historical or diagnostic.
9. Performance acceptance is backed by canonical same-attempt A-B-B-A `PRODUCT-P01`, artifact
   `areas/agent/runtime/human/preview/product-benchmark/results/PRODUCT-P01-2026-08-09T18-34-18.181Z-2ceb96275090.json`
   (SHA-256 `2ceb962750900c5fc588b895b592f68abb53d2cb8cbae7c6b498ecc7fcddbb6b`).
   Recording/trend eligibility and semantic equality pass (24/24); candidate worst complete p95 is
   82.523ms, runtime max is 873,267,200 bytes, and `directTargetPassed/stop=true`. This is not a
   cross-epoch plateau, and it does not dynamically cover Electron/XPC/Header/Content commit.
   This artifact remains immutable history only after task 016: its SQLite physically contains 726
   hidden-directory descendants, so it cannot accept the new hidden-pruned Project Search policy.
10. Task 016 requires a new PRODUCT-P02 current point after dual-index pure/Electron acceptance.
    It measures the bundled current Utility runtime and product core in a fresh Node child, records
    directory metadata and Project Search resources separately, proves zero
    hidden/fixed/config-excluded SQLite rows before any body read, and gates
    create/update/delete/rename convergence. Electron UtilityProcess startup, Main relay, Shell, and
    renderer timing remain outside PRODUCT-P02 and require targeted Electron acceptance.
    PRODUCT-P02 has not been run.
