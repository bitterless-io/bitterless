# OnlyPreview MVP Delivery Analysis

## Goal

Deliver the accepted `docs/features/onlypreview.md` contract as a usable Bitterless Mini App,
standalone multi-`WebContentsView` window, app-specific Setting window, and OS file-open target.

## Module Decomposition

| Module                             | Inputs                                                                             | Outputs                                                                                                                                                                     | Dependencies                                                                     | Verification                                                                                      |
| ---------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Shared contracts                   | untrusted XPC/settings/index values                                                | parsed types and discriminated result envelopes                                                                                                                             | none                                                                             | pure contract tests                                                                               |
| Host/workspace capability registry | Main-created views + native-dialog/OS absolute path                                | host-bound opaque workspace + relative refs                                                                                                                                 | Node fs/path, UUID                                                               | host isolation/revocation/containment tests                                                       |
| Recent-directory service           | canonical workspace root + Core SQLite lifecycle                                   | latest directory candidate, per-host restore, fresh workspace capability                                                                                                    | `SettingDao`, workspace/host registries                                          | latch/CAS/single-flight/order tests                                                               |
| Search bootstrap capability        | attached host + opaque workspace                                                   | private root/database paths injected only into hidden file-search preload initialization                                                                                    | host/workspace registries, user-data path                                        | token/revocation/no-visible-renderer-path tests                                                   |
| Background file-search renderer    | private root/database paths, browse/query/config/watch events                      | complete demand-loaded directory listings, exclude-independent tree-name tier, excluded v7 SQLite file/content tier, file-only search results, aggregate progress/telemetry | hidden BrowserWindow, trusted Node preload, XPC, `node:sqlite`, YAML, filesystem | lifecycle/XPC/browse/dual-corpus/schema/query/snippet/watch/progress/cancel/memory/recovery tests |
| File descriptor/text/clipboard service | authorized relative Project item ref                                            | typed descriptor/text, native item/text clipboard write, one identity-checked permanent unlink, or explicit error                                                           | workspace registry, Electron clipboard, bounded OS helper, Node fs               | signature/binary/encoding/size/copy/delete tests                                                  |
| Asset/document protocols           | authorized descriptor + Main selection revision                                    | exact asset streams or canonical-entry-contained HTML resources                                                                                                             | Electron protocol, Node streams, asset/document registries                       | identity/range/containment/revoke tests                                                           |
| Open router                        | macOS event or Windows argv                                                        | serialized standalone-open request                                                                                                                                          | app lifecycle, window handler                                                    | argv/early queue tests                                                                            |
| Standalone window graph            | folder-open/selection/bounds/settings/menu commands                                | BaseWindow, full Shell, one active Region content view, parented Setting window, native file menu/dialogs                                                                   | window state, renderer targets                                                   | lifecycle/source/E2E contracts                                                                    |
| Agent skill and Guide              | explicit absolute file/folder + current helper/runtime                             | read-only `preview.open`, portable skill, parented Guide window                                                                                                             | MCP bridge, OnlyPreview open router, package resources                           | pure schema/dispatch/path/resource/source tests                                                   |
| Shell renderer                     | workspace/listings/index/settings/scoped search batches/progress/Main presentation | complete tree, Project Search, one current-file Find Bar, 2px rail, 43px Preview toolbar/actions, status, inner bounds                                                      | preload XPC, Arco, Tabler icons                                                  | renderer source/type tests                                                                        |
| Main Preview Region                | selection/refresh/watch/restore/bounds/renderer/find observations                  | authoritative selection/find revisions, adapter, one active surface, readiness, native/content find routing, capability teardown                                            | WebContentsView, registries, session protocol, `findInPage()`                    | behavior lifecycle/race/security tests                                                            |
| Vue Preview renderer/component     | runtime-token-scoped Main snapshot/command + text/media/Office bytes               | presentation readiness, selected-text observations, complete Monaco find and accepted-model XLSX find                                                                       | XPC, Monaco, marked, DOMPurify, ExcelJS Worker, docx-preview, asset scheme       | renderer source/unit tests + owner acceptance                                                     |
| Raw Chromium Preview               | revision-bound document or PDF asset URL + Main find intent                        | executable contained HTML or built-in PDF viewer with native current-page find                                                                                              | disposable memory session, no preload/XPC, `findInPage()`                        | Region/document/find behavior tests + owner acceptance                                            |
| Setting renderer                   | current settings + active category                                                 | left category navigation, one focused setting list, validated saved snapshot or cancel                                                                                      | XPC, Arco                                                                        | component/source/E2E tests                                                                        |
| Home integration                   | card click                                                                         | focus/create standalone window                                                                                                                                              | XPC handler                                                                      | catalog/i18n tests                                                                                |
| Packaging integration              | verified extension catalog                                                         | alternate viewer associations                                                                                                                                               | electron-builder                                                                 | config audit + packaged manual check                                                              |

## Integration Enumeration

1. Home `MiniApp.vue` calls `OnlyPreviewWindowHandler.openOnlyPreviewWindow` and the handler
   creates/focuses the standalone graph.
2. macOS `open-file`, packaged Windows initial argv, and `second-instance` all call the same open
   router; the router waits for GUI/XPC readiness and calls the same handler with a Main-owned path.
3. Main pre-registers an unguessable host capability before creating a Shell, Vue Preview, or
   Setting view and exposes it only through that view's preload context. Shell and Vue share one
   content host; Vue also receives a rotating renderer-runtime token. Raw Chromium receives neither
   token nor a preload. Setting uses a distinct settings-only host.
4. The handler asks the workspace registry to validate the target and bind it to the live host,
   then gives Shell only an opaque workspace snapshot. A private search-bootstrap capability stays
   in Main; after host/workspace validation Main enriches only the hidden file-search preload's
   capability-bound XPC initialization
   message with root/database paths. Descriptor/read methods retain host + workspace + relative-path
   containment, and no preload or page receives the bootstrap token or absolute paths. The
   hidden file-search preload emits the root listing early and mints a generation-bound opaque token for each
   expandable directory. Shell expands with that token rather than a relative path; Main validates
   and relays but never resolves or walks the directory or reads searchable content.
5. Shell owns the fixed 43px Preview toolbar and reports only the inner content rectangle. Main
   clamps it below y=75 and creates/loads/attaches no content view until valid bounds arrive.
6. Shell selection submits one file intent to the Main Preview Region. Main increments the
   selection revision, revokes/aborts old authority, detaches/destroys the old surface, classifies,
   then chooses Vue or raw Chromium. Only exact current revision/runtime observations are accepted.
7. Image/media use exact bounded asset tokens in Vue. PDF uses a new raw Chromium view and the
   built-in viewer over a 100MiB-limited asset. HTML uses a separate document token bound to the
   canonical entry directory and exact directory/entry identity; inline and contained relative
   resources are allowed within 1MiB/25MiB/100MiB entry/resource/revision budgets.
8. Shell/Preview opens the Setting window through the same handler; save validates, persists in
   `SettingDao`, then broadcasts the committed snapshot to live OnlyPreview renderers.
9. Omni's shared mini-app parser, runtime registry, and Control selector all reject or omit
   `onlypreview`; OnlyPreview has no embedded container mode or cell lifecycle.
10. Standalone/Setting teardown revokes the exact host, its workspaces, document/asset tokens, open
    streams, raw-session protocol handlers/listeners/storage, and runtime tokens. Auth invalidation
    and host quit close every remaining child webContents, window, and capability.
11. Electron Vite produces the sandbox-safe shared preload, sandbox-safe Vue Preview preload,
    trusted `fileSearch` preload, four visible first-party renderer entries, and one invisible top-level `fileSearch`
    renderer entry through official watched inputs. No OnlyPreview UtilityProcess entry remains;
    logging/i18n/package audits recognize every emitted path in build and development mode.
12. The Shell renders the standalone 32px MenuBar and sends capability-scoped window-control
    intents through the OnlyPreview XPC handler; Main alone minimizes, toggles maximize, or closes
    the current `BaseWindow`, while Preview bounds begin immediately below that bar.
13. In the debug runtime profile, Main intercepts standard DevTools shortcuts on each standalone
    child `webContents` and toggles that exact Shell or active content target in a detached window. Release
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
17. `app.main.ts` resolves the recent-directory service's Core SQLite ready/failure latch. Shell's
    `restoreWorkspace` uses one per-host flight after that latch, reconstructs a fresh directory
    workspace at most once, and routes its selected file or empty state through the Main Region
    before returning. A restore generation prevents stale history from replacing a newer target.
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
    the private bootstrap, supervises one host-bound invisible `fileSearch` BrowserWindow, and
    relays bounded calls to its trusted preload through a private capability-bound XPC runtime
    without search I/O. Only that preload produces complete demand-loaded directory listings, owns the
    generation-local directory-token map, walks search candidates, classifies media, reads
    searchable text, builds/reopens SQLite, applies 400ms trailing file updates, and
    executes/cancels queries. It owns one-active/one-latest execution, emits at most 500 exact
    file-only results with text-only grapheme snippets, and publishes only aggregate
    workspace/generation/build-revision-fenced counting/indexing progress. Shell retains its 120ms
    leading-plus-trailing IME-aware scheduler and shows progress only as the 2px no-copy
    Project-bottom rail.
22. Entering Project Search captures a stable current-directory anchor and sends a strict relative
    `In Directory` scope by default; the Shell selector can switch the same query to `In Project`.
    Ordinary filtering never enters that protocol: it matches only `entry.name` on the rows visible
    before the query and preserves the pre-query expansion snapshot. A clicked visible directory may
    become a query-scoped reveal root whose already loaded descendants bypass the name filter via
    path-segment ancestor `Set` lookup; input change clears all roots before recomputation, and no
    reveal triggers recursive loading or Project Search I/O.
23. After the file-search preload's final 400ms-trailing committed change, it sends a fenced event
    through its internal XPC event path. Main whitelists and shape-validates the event, binds it to
    the attached host, and routes a matching selected path through the Preview Region transition.
    Main performs no watch/search read itself; it only advances the current presentation revision.
24. Region presentation broadcasts contain only `{ hostId }` as an untrusted nudge. Shell refetches
    the public URL-free snapshot; only the current Vue runtime token can refetch a Vue media URL.
    Both consumers use local fetch generations so forged revisions and late snapshot promises
    cannot replace Main-authoritative state.
25. A DOCX exact 25MiB revision asset is fetched only by `vuePreviewView` and transferred to a
    one-shot module Worker. The Worker reuses the pure OOXML preflight with DOCX required parts; a
    10-second adapter deadline terminates it, and `docx-preview@0.4.0` is dynamically imported only
    after success. Disposal terminates and immediately settles an awaiting old preflight without
    affecting the next revision. Stable `renderAsync()` writes detached body/style with the frozen
    safe options.
26. The DOCX sanitizer validates the complete detached DOM/CSS and all embedded blob image URLs
    before mount. Normal/stale teardown revokes registered blobs. Main arms one non-renewing
    30-second watchdog when document loading has an exact Vue view/runtime token; reset/resize do
    not extend it. A transition away from a still-loading DOCX closes that exact old Vue view and
    rotates its runtime before the new revision; only post-ready transitions may reuse the view.
    Engine rejection, incomplete output, sanitizer failure, or timeout reports one of
    `DOCUMENT_PARSE_FAILED`, `DOCUMENT_EMPTY`, `DOCUMENT_SANITIZE_FAILED`, or
    `DOCUMENT_RENDER_TIMEOUT` and destroys/recreates only the exact Vue surface where orphan URLs
    may remain. Runtime/view/revision fences prevent old work from killing a new presentation.
27. Image/audio/video stay explicit Vue adapters with no text-selection capability. Image uses an
    exact bounded GET, renderer-owned Blob, and off-DOM native decode before an accessible
    fit/zoom/reset/pan viewer mounts; Main then revokes its one-shot source asset. Audio/video use
    an exact HEAD preflight followed by the same selection-lived Range URL in native
    `preload="metadata"` controls, so later seeks do not fail at the legacy 30-minute TTL. The
    bounded registry still evicts oldest entries under global pressure.
28. Image empty/read/signature/decode and media empty/read/aborted/network/decode/source errors are
    typed independently. A media player that emits neither metadata nor an error reaches read
    failure after 30 seconds. Component generation plus selection revision fences reject stale
    ready/error events; Main accepts ready only from loading and lets a current media error demote
    loading or ready without allowing a late ready to resurrect unavailable state.
29. `Cmd/Ctrl+F` from Shell, Vue, or Chrome focuses one Shell Find Bar while excluding Shift and
    preserving Project Search. Main owns capability state and every accepted `findRevision`.
    HTML/PDF/Markdown/DOCX route through the exact active WebContents with Electron requestId plus
    WebContents generation/selection/revision fences. Monaco scans the full accepted model but
    retains only current/first/last offsets and one decoration; XLSX delegates to its bounded Worker
    model and alone may report partial coverage. Adapter commands prove the exact registered adapter;
    runtime-token-bound results never expose that token or a WebContents identity to Shell.
30. Main keeps `OnlyPreviewWorkspace.displayPath` exclusively in the Shell workspace snapshot. The
    selected-file descriptor and public/Vue presentation snapshots are reconstructed through an
    explicit field allowlist and expose only relative identity plus bounded file metadata. Direct
    unsupported and every descriptor-backed typed unavailable/error state feed one Vue metadata
    view model; the content surface shows name, type/extension, size, modified time, and the exact
    reason while the Shell toolbar remains the only native file-action owner.
31. A file-row menu's destructive item stays Main-private. It resolves the same host/workspace/
    relative-file capability, displays a parented native confirmation with Cancel as default, then
    identity-checks and directly unlinks exactly one contained regular file without reading it. Only
    after successful unlink does Main invalidate an exact matching pending selection and clear an
    exact matching selected file/Preview Region; failure and a newer/different selection preserve
    their generation and presentation, while the existing watcher converges browse/search rows.
32. File and directory rows share one Main-resolved Project-item capability. Main projects that
    authority into one pasteable native filesystem reference, canonical absolute-path text,
    workspace-relative-path text, or basename text without returning a path to Shell. Project-only
    keyboard copy intents are ignored for editable controls; the bounded macOS/Windows adapter never
    reads target bytes, while unsupported desktop integration fails truthfully.
33. Project Search accepts two exact Main-owned aliases from Shell, Vue Preview, and Chrome Preview:
    `Option/Alt+Cmd/Ctrl+F` and the retained `Shift+Cmd/Ctrl+F`. Exactly one secondary modifier must
    be present, so plain `Cmd/Ctrl+F` remains current-file Find and the combined Shift+Option/Alt
    chord remains unclaimed. Both aliases reuse the same host-scoped focus-search event and Shell
    input; no second renderer route or search state is introduced.

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
The 2026-08-10 `onlypreview-layered-index-browse-009` and
`onlypreview-index-progress-010` deliveries established complete browsing independent of search and
the 2px no-copy Project-bottom progress rail. Their reviewed Main-owned `listDirectory`/`buildIndex`,
100,000-entry, depth-20 implementation remains historical evidence; tasks 012–016 superseded that
architecture with the UtilityProcess, persistent SQLite, dual-tier eligibility, hard pruning, and
watch reconciliation while retaining both product intents.
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
families and aligns the dormant acceptance surface with the then-current three-view graph. Its
historical E2E contract distinguishes Shell, Header, and Content by `webContents.id`, treats OS
renderer PIDs as positive diagnostics rather than unique identities, verifies the former exact 43px
Header/Content geometry and
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
`onlypreview-search-during-index-017` supersedes the UtilityProcess transport with one invisible
top-level `fileSearch` BrowserWindow. Its trusted Node-context preload owns the same browse/index/
query/watch core and communicates through capability-bound XPC; Main retains bootstrap validation,
lifecycle, response/event validation, and public relay. The same delivery keeps the last complete
SQLite index queryable while a candidate builds and performs a complete scoped first-build
directory search without a SQL `LIKE` fallback.
`onlypreview-dual-preview-region-024` supersedes the remaining single Vue Preview topology. Shell
now owns the 43px toolbar, while one Main Preview Region attaches either the existing minimal Vue
content bundle or a fresh raw Chromium HTML/PDF view below it. Main is the sole revision/readiness
authority; presentation events are host-only refetch nudges. Raw sessions are disposable,
network-denied, preload-free, and protocol-scoped. Document and asset streams bind canonical
identity, abort on revoke/growth/replacement, and revalidate the current path at EOF. The old Vue
Header/FileActions/HTML/PDF/watch-reload paths are retired. Electron E2E was intentionally not run;
Ral retains runtime and visual acceptance.

`onlypreview-preview-guards-023` now makes extension/exact-basename and opened-file size the only
text admission gates. Main Preview text uses bounded tolerant UTF-8/BOM UTF-16 reads; Project Search
uses the same allowlist with its 1MiB body limit and retains metadata-only rows on growth/replacement.
Region is the sole revision-bound text/asset/document capability issuer, revalidates the exact opened
identity before presentation, and fences late reads. PDF/image/Office primitive gates are
100MiB/100MiB/25MiB; audio/video keep verified-size Range delivery. Parser-level Office preflight
remains owned by 020/021. Focused behavior tests cover parity, cap boundaries, malformed bytes,
same-handle/current-path races, search rebuild identity, revoke, and EOF validation.

`onlypreview-xlsx-grid-020` now implements the XLSX/XLSM half of that parser boundary. Region issues
one exact revision asset only for an admitted sheet descriptor; Vue fetches it and transfers the
`ArrayBuffer` to a disposable module Worker. Before dynamic ExcelJS import, reusable OOXML preflight
proves ZIP closure and safe namespaces, validates actual STORE/DEFLATE length plus CRC32 under exact
entry/byte/ratio limits, and rejects excessive worksheet merge records/expanded cells. The Worker
owns the deterministic bounded workbook/search model; Vue receives only a manifest and requested
viewport ranges for a read-only virtual grid. Formula search/display uses cached results only, and
only deterministic model caps may yield truthful `sheet-model-cap` partial coverage. Independent
reviews 1 through 4 each recorded `BLOCKED`: review 1 found implementation/UI defects, while reviews
2 through 4 found docs-ledger defects. Those findings are corrected, and
[independent review 5](../reviews/onlypreview-xlsx-grid-020-5.md) recorded **PASS**. The ledger is now
`implemented; owner verification pending`; Ral owns the remaining real-app workbook and visual
verification. Electron E2E was intentionally not run.

`onlypreview-docx-render-021` owns the DOCX half without moving parsing into Main or preload.
The one-shot preflight Worker remains hard-terminable, while `renderAsync()` itself has no
`AbortSignal`; normal transitions therefore use serial reset, detached output, exact stale-result
fences, and blob revocation rather than claiming library cancellation. Sanitized current DOM reports
ready only after mount plus `nextTick`, publishing the state task 019 now uses for
`webContents.findInPage()`; task 021 itself did not add Find Bar UI.
[Independent review round 2](../reviews/onlypreview-docx-render-021-2.md) recorded **PASS** after the
review-1 cleanup. Its ledger is now `implemented; owner verification pending`; Ral owns the
remaining real DOCX visual/runtime verification.

`onlypreview-media-truthful-state-022` replaces the raw image/audio/video tags with dedicated Vue
components and truthful lifecycle authority. The exact supported image/audio/video catalogs select
only a native adapter, while HEIC/HEIF/TIF/TIFF/RAW and MKV/AVI/WMV/FLV are explicitly recognized
unsupported categories that issue no asset. Images decode off-DOM from a bounded Blob and retain
only their revision-owned object URL; audio/video remain streaming on a selection-lived Range
capability after a CORS-readable HEAD preflight. Empty, read, decode, codec/source, timeout, and
stale-transition behavior are covered by focused service, real-SFC jsdom, classifier, protocol,
Region, and Store tests. No codec, transcoder, OCR, thumbnailer, waveform, or premature current-file
find capability is added.
[Independent review round 1](../reviews/onlypreview-media-truthful-state-022-1.md) recorded
**BLOCKED** on renderer-error family authorization; the exhaustive adapter discriminator and
negative Region behavior coverage fixed that finding.
[Independent review round 2](../reviews/onlypreview-media-truthful-state-022-2.md) recorded **PASS**.
The ledger is `implemented; owner verification pending`; Electron E2E is intentionally left to
Ral's manual image/media runtime and visual verification.

`onlypreview-find-in-file-019` is now `implemented; owner verification pending` after
[independent review round 2](../reviews/onlypreview-find-in-file-019-2.md) recorded **PASS**. One Shell-owned
Find Bar accepts IME-safe input from Shell, Vue, and raw Chromium shortcut entry; pending allows a
query to queue but disables case/navigation and never renders false `0/0`. Main owns capability,
`findRevision`, native request identity, routing, and cleanup. HTML/PDF/Markdown/DOCX use
`findInPage()` with `clearSelection`; Monaco counts the complete accepted model without the editor's
999-result ceiling or unbounded Range/decorations, then resolves the active highlight through an
original-model next/previous range so Unicode case-fold expansion cannot shift it. XLSX searches the Worker accepted model with
truthful partial coverage only for model caps. Exact host/selection/surface/revision, WebContents
generation/requestId, registered adapter, runtime token, and fetch-generation fences reject late or
forged state. Focused behavior, full OnlyPreview, type/i18n/lint/format, and safe source-build gates
passed; Electron/Playwright and the real app remain intentionally unrun. Ral owns the task's final
[runtime and visual checklist](../tasks/onlypreview-find-in-file-019.md#owner-verification).

`onlypreview-design-completion-025` closes the final cross-task audit gaps without changing the six
delivered Preview capabilities: descriptor snapshots no longer expose absolute selected-file paths,
all descriptor-backed typed failures reuse the truthful metadata surface, and task-modified OOXML,
XLSX, Search SQLite, Search Shell, and Electron-spec sources are split to the workspace 800-line
maximum without removing or weakening tests. It also repairs the affected task/design/README
ledgers. [Independent review 1](../reviews/onlypreview-design-completion-025-1.md) recorded **PASS**
with no P0–P2 finding: the focused descriptor/UI and split passes are 43/43 and 66/66, the combined
OnlyPreview suite is 318/318 with zero skip/todo, node typecheck/i18n/scoped lint/format/safe source
build pass, and web typecheck reports zero OnlyPreview diagnostics apart from the existing unrelated
repository baseline. The two designs are now closed at the documented non-E2E implementation level,
and the ledger is `implemented; owner verification pending`. Electron/Playwright E2E and the real app
remain intentionally unrun; only Ral's real-app/runtime/visual verification remains.

`onlypreview-permanent-delete-029` is now `implemented; owner verification pending`. Files and
directories share one Main-resolved Project-item capability for Reveal, pasteable filesystem copy,
and absolute/relative/name text copy; only regular files expose a separately grouped confirmed
Delete that performs one identity-revalidated direct `unlink`. Exact Project-row shortcuts preserve
ordinary text copy, and failed or superseded deletes do not disturb the latest selection. Two
independently found selection-generation races were corrected before
[independent review 3](../reviews/onlypreview-permanent-delete-029-3.md) recorded **PASS** with no
P0-P2 finding. Focused 40/40, full OnlyPreview 336/336, node typecheck, renderer i18n, scoped lint,
diff check, and build pass; Electron/Playwright, the real app, and live clipboard/delete operations
remain intentionally unrun for Ral's owner verification.

`onlypreview-project-search-shortcut-030` is `implemented; owner verification pending` after
[independent review 1](../reviews/onlypreview-project-search-shortcut-030-1.md) recorded **PASS**
with no P0-P2 finding. Main now accepts exact Option/Alt and Shift aliases for the existing
host-scoped Project Search focus route while plain `Cmd/Ctrl+F` remains current-file Find. Focused
14/14, full OnlyPreview 337/337, node typecheck, i18n, scoped lint, diff check, and build pass;
Electron/Playwright and the real app remain intentionally unrun.

`onlypreview-filter-directory-reveal-031` is `implemented; owner verification pending` after
[independent review 1](../reviews/onlypreview-filter-directory-reveal-031-1.md) recorded **PASS**
with no P0-P2 or workspace code-review finding. A local-query directory click now creates one
session-only reveal root; currently loaded descendants use segment-safe O(path depth) ancestor
`Set.has()` membership, nested directories retain ordinary lazy loading, and any raw input change
clears all markers before rows recompute. Focused 22/22, full OnlyPreview 338/338, i18n, scoped lint,
diff check, and build pass; web typecheck retains 76 unrelated baseline diagnostics and zero
OnlyPreview matches. Electron/Playwright and the real app remain intentionally unrun.

## Main Risks And Decisions

| Risk                                                                    | Decision                                                                                                                                                                                                                           |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| XPC lacks sender identity                                               | Main-issued per-view host capability + host-bound workspace/media capabilities; relative paths only; realpath containment on every operation                                                                                       |
| XPC handler swallows exceptions                                         | every fallible API returns a discriminated success/error envelope                                                                                                                                                                  |
| `BaseWindow` child views or search runtime leak                         | host-bound hidden file-search destruction plus Region-owned detach, protocol/listener/stream/session cleanup, and `webContents.close()` for Shell/current content                                                                  |
| large directories freeze UI                                             | cooperative background-preload metadata traversal, time-sliced batches, `backgroundThrottling: false`, Project Search fixed/ordered body-index exclusions, cancellation/generation fences                                          |
| media cannot seek                                                       | privileged streaming custom scheme + manual bounded 206 byte ranges; audio/video tokens follow selection rather than default TTL, while explicit revoke and bounded-registry eviction remain authoritative                         |
| raw HTML escapes local document authority                               | a fresh preload-free memory session; 1MiB entry, 25MiB resource, 100MiB revision budgets; canonical directory + directory/entry/resource identity; traversal/symlink/remote/popup/navigation/permission denial                     |
| deep tree indentation and names are clipped                             | the tree viewport owns both axes; rows use intrinsic width with a viewport-width floor and names remain complete single-line content                                                                                               |
| Monaco or raw content intercepts current-file find shortcut             | bind exact non-repeat plain `Cmd/Ctrl+F` to the Shell Find Bar; route exclusive Option/Alt or Shift variants to Project Search across Shell/Vue/Chrome, and never open Monaco's widget                                            |
| Late native/model find result overwrites the next file                  | Main-owned find revision plus host/selection/surface, WebContents identity/generation/requestId, registered-adapter/runtime, and result-coverage fences                                                                            |
| Dense Monaco text exhausts memory while counting                        | stream the literal count over the accepted 8MiB model, resolve only the current original-model range, and materialize at most one active decoration                                                                                |
| Native window graph cannot fit one Omni cell                            | exclude OnlyPreview from Omni types, UI, runtime mapping, and persisted state                                                                                                                                                      |
| Custom chrome controls the wrong process/window                         | Shell emits capability-scoped OnlyPreview intents; Main mutates only the active OnlyPreview `BaseWindow`                                                                                                                           |
| BaseWindow child views bypass BrowserWindow DevTools shortcuts          | bind debug-only standard shortcuts directly to Shell and the active content `webContents`; always detach and toggle only the input owner                                                                                           |
| A DOM context menu is clipped or covered by a native content view       | Main owns a capability-scoped native `Menu` and attaches it to the active OnlyPreview `BaseWindow`                                                                                                                                 |
| A destructive menu action deletes the wrong path or freezes on a large target | Main accepts only one contained regular-file capability, confirms with Cancel by default, revalidates opened identity immediately before one constant-space `unlink`, and never reads bytes, traverses, or recursively deletes |
| Copy File materializes a large file or hijacks editor copy                    | copy one native file/folder reference through a bounded Main-owned OS adapter; Project shortcuts require an exact focused item outside editable controls and never read file bytes                              |
| Setting restores an unrelated historic screen position                  | retain only its stored size; parent, center, and work-area clamp it from the currently authorized standalone window on every open                                                                                                  |
| history restore races an explicit folder/file target                    | one per-host restore promise plus generation/workspace rechecks before and after the SQLite latch; successful restore routes its selection/empty state through Region                                                              |
| Search or browse path capability leaks into a page                      | Main-only bootstrap; root/database paths enter only the private capability-bound hidden-preload initialization, while visible pages receive only opaque directory tokens and relative metadata                                     |
| Search I/O blocks Main or Shell typing                                  | Main performs no traversal/read/query/watch; the dedicated file-search renderer preload owns the runtime and Shell owns input                                                                                                      |
| XPC routes a visible renderer to the privileged search handler          | every private file-search request/event requires a Main-held capability and exact host/workspace/generation shape before path access or public relay                                                                               |
| Watch events are lost, spoofed, or update only the index                | 400ms trailing background-preload commit → private fenced XPC event → Main validation/host binding → matching selected-file Region transition and new authoritative revision                                                       |
| Local filter silently searches collapsed paths or expands the tree      | freeze pre-query visible rows and expansion, match exact `entry.name`, and permit only explicit query-scoped directory reveals that restore on filter exit                                                                        |
| A matched directory cannot expose its non-matching children efficiently | keep query-scoped reveal roots; admit loaded descendants through O(path depth) ancestor `Set.has()` checks, clear roots on input change, and retain lazy per-directory loading                                                     |
| Project Search scope drifts with result selection                       | capture one relative directory before results replace the tree; default In Directory and switch explicitly to In Project                                                                                                           |
| Tree visibility and Project Search exclusions accidentally share policy | keep an exclude-independent metadata/name tier for the ordinary tree; apply hidden/fixed/config policy only to the separate file/content SQLite tier before body reads                                                             |
| Non-text bytes enter full-text results                                  | persisted mediaType/isText gate; titles searchable for all files, body decode/index only for reviewed text                                                                                                                         |
| Short/CJK candidates produce false positives                            | NFKC candidate generation plus exact normalized-original verification before snippet projection                                                                                                                                    |
| Search memory/disk is misreported                                       | runtime >1GiB advisory; >2GiB sets `performanceAccepted=false` and `stop=false` without invalidating the artifact/method; SQLite footprint is recorded separately and never summed                                                 |
| Benchmark/prototype evidence is reported as current product proof       | PRODUCT-P00/P01 remain immutable history for their hidden-inclusive physical corpus; the dual-index/hidden-pruned policy requires a new PRODUCT-P02 current point, while the roughly 1.412GB disk figure remains prototype history |
| A late history read replaces an OS-opened file                          | suppress history before `ensureStandalone()`, fence mutations by generation, and let the latest explicit target win                                                                                                                |
| SQLite is late or unavailable                                           | ready/failure latch; retain only the latest pre-ready write, return empty on failure, and never block explicit opens                                                                                                               |
| Invalid history or concurrent cleanup erases a newer path               | revalidate through `createForTarget` and CAS-clear only the exact observed invalid serialized value                                                                                                                                |
| Persisted path leaks authority or logs                                  | persist only the canonical directory in Main-owned SQLite; use only no-value-log DAO methods and mint fresh capabilities on restore                                                                                                |
| Full-application E2E prompts for the owner's macOS Keychain             | one shared launch-argument builder prepends `--use-mock-keychain`; E2E Main fails before GUI startup when the macOS switch is absent                                                                                               |
| Untrusted Markdown executes HTML, navigation, or remote loads           | current direct `marked` plus DOMPurify dependencies; raw HTML is escaped, output is allowlisted to semantic tags with zero attributes, and images/links receive no executable URL                                                  |
| Vue content and bottom rail live in sibling WebContentsViews            | Main presentation carries selected-text availability; Vue reports counts only for its exact runtime token/revision; Chrome clears the capability; Shell resets on every Main revision                                              |
| renderer forges a higher presentation revision                          | presentation broadcast is only an exact host-id nudge; Shell/Vue refetch Main snapshots with local promise-generation fences and never accept event descriptors/revisions                                                          |
| raw Chrome leaks network or WebRTC                                      | response CSP + DNS-prefetch off, webRequest deny, awaited unusable loopback proxy, restricted WebRTC IP policy, denied permissions/windows/downloads/navigation                                                                    |
| UTF-16 length miscounts visible characters                              | count Unicode grapheme clusters with `Intl.Segmenter`, falling back to code points only when unavailable                                                                                                                           |
| Shell DOM Guide is covered by the native content view                   | use one parented non-modal Guide `BrowserWindow`, not an in-Shell modal                                                                                                                                                            |
| Guide inherits file-reading authority                                   | issue a dedicated `guide` role whose only privileged call returns one fixed setup instruction                                                                                                                                      |
| Agent skill invents a second file-open path                             | `preview.open` delegates to the existing Main-owned absolute-target router                                                                                                                                                         |
| Packaged Markdown skill silently disappears                             | explicitly copy and validate the complete `bitterless-preview` directory through `extraResources`                                                                                                                                  |
| Debug Preview errors are hidden behind the sibling Shell view           | auto-open only the initial Preview DevTools in a detached inactive window for a normal debug profile; retain manual per-view toggles                                                                                               |
| Workspace identity repeats or misstates path syntax                     | use Main-owned `rootName` for the Project label and render the absolute `displayPath` without an injected separator                                                                                                                |
| Absolute selected-file path leaks into Vue/public presentation          | keep workspace `displayPath` Shell-only; rebuild descriptor snapshots from an explicit allowlist containing only relative identity and bounded metadata                                                                            |
| A typed decoder/parser failure loses actionable file context            | one descriptor-backed metadata view model for unsupported and error variants; keep exact reason plus name/type/size/mtime, while Shell remains the only FileActions owner                                                          |
| extension-only association omits unknown files                          | common associations plus macOS `public.data` Viewer/Alternate and a bounded Windows generic context-menu verb, never default ownership                                                                                             |
| Electron 40 PDF embedding gaps                                          | fresh raw Chromium view navigates a revision-bound, 100MiB-limited exact asset URL and uses the built-in PDF viewer; Vue/pdf.js is retired                                                                                         |
| existing unrelated test failures                                        | record baseline and compare touched/focused gates; never relabel baseline failures                                                                                                                                                 |

## Verification Layers

1. Pure unit tests for contracts, classifier, capability containment, opaque browse-token ownership,
   early root listing, complete per-directory browsing, visible-row filtering, directory/project
   scopes, persistent indexing, bounded build progress, throttle/IME/cancellation, snippets, watch
   reconciliation plus selected-Preview rerender, and open-argument parsing, plus recent-directory
   codec, latch, CAS, generation, and per-host single-flight state.
2. Focused source/integration tests for host wiring, Main zero-search/browse-I/O, whitelisted
   browse/progress relay, 2px no-copy rail behavior, security preferences, descriptor/public/Vue
   snapshot path exclusion, real Store/SFC metadata states, image/media lifecycle, exact asset
   HEAD/GET truth, Range exposure, and Main readiness/error authority.
3. Node and web typechecks, renderer i18n guard, targeted ESLint, `git diff --check`.
4. Full Electron Vite build and output audit. Earlier UtilityProcess integration evidence remains
   historical. Task 017 must prove the official shared/Content/file-search preloads, top-level
   invisible `fileSearch` renderer, exact hidden-window security/lifecycle, and absence of a Main
   UtilityProcess entry.
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
   scheduler, the then-current Header/Content commit, and packaged startup are outside that artifact. Later 7/7
   Electron E2E covers the unpackaged runtime path; packaged release remains untested. Task 012 and
   old prototype/R05/failed-R06 values remain historical or diagnostic.
9. Performance acceptance is backed by canonical same-attempt A-B-B-A `PRODUCT-P01`, artifact
   `areas/agent/runtime/human/preview/product-benchmark/results/PRODUCT-P01-2026-08-09T18-34-18.181Z-2ceb96275090.json`
   (SHA-256 `2ceb962750900c5fc588b895b592f68abb53d2cb8cbae7c6b498ecc7fcddbb6b`).
   Recording/trend eligibility and semantic equality pass (24/24); candidate worst complete p95 is
   82.523ms, runtime max is 873,267,200 bytes, and `directTargetPassed/stop=true`. This is not a
   cross-epoch plateau, and it does not dynamically cover the then-current Electron/XPC/Header/Content commit.
   This artifact remains immutable history only after task 016: its SQLite physically contains 726
   hidden-directory descendants, so it cannot accept the new hidden-pruned Project Search policy.
10. Task 016 requires a new PRODUCT-P02 current point after dual-index pure/Electron acceptance.
    It measures the product core in a fresh Node child, records
    directory metadata and Project Search resources separately, proves zero
    hidden/fixed/config-excluded SQLite rows before any body read, and gates
    create/update/delete/rename convergence. Hidden file-search renderer/preload startup, Main XPC
    relay, Shell, and renderer timing remain outside PRODUCT-P02 and require targeted Electron
    acceptance.
    PRODUCT-P02 has not been run.
