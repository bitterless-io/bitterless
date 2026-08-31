# OnlyPreview Sub-Application

Status: Accepted; tasks 032–048, 072, 073, 076, 077, and 078 implemented; owner verification
pending

## Purpose And Boundary

OnlyPreview is Bitterless's read-only local-file workbench. Its visible picker opens one directory,
the user navigates a complete demand-loaded project tree on the left, and the selected file is
previewed on the right without leaving Bitterless. Main-owned operating-system file-open routes may
still target an individual file and derive its containing workspace. The current delivery covers
source code, text, PDF, XLSX/XLSM workbooks, DOCX documents, PPTX presentations, Draw.io diagrams,
image, audio, and video files used in development and ordinary desktop work.

OnlyPreview owns local file discovery, a persistent incremental search index, preview
classification, read-only rendering, its app-specific preferences, and the standalone window
graph. Search traversal, searchable content reads, SQLite indexing, watch reconciliation, and
queries run only in the trusted Node-context preload of a dedicated invisible `fileSearch`
`BrowserWindow`; Electron Main validates capabilities, privately enriches initialization with
bootstrap paths, supervises that renderer, and performs a bounded XPC relay without search I/O.
OnlyPreview never edits file contents or creates, renames, or moves user files. Its one explicit
filesystem mutation is a hidden-preload-owned, capability-scoped permanent Delete action in the
native file menu: Main owns the parented destructive confirmation and native reveal/open/clipboard
effects, but the hidden `fileSearch` preload authorizes their canonical targets. Delete uses a
two-phase identity-bound grant and unlinks exactly one still-current regular file from disk rather
than moving it to Trash. Unsupported local files still open to an explicit metadata surface with an
action to use the system application.

The public identity is `OnlyPreview`; its visible code IDs, renderer directories, setting keys, and
window-state keys use `onlypreview`. The reusable invisible search owner is the independent
top-level `fileSearch` renderer domain.

The product-level rationale and visual direction live in
`areas/only-preview/feature-design.md` in the private overmind parent. This document is the
implementation contract inside Bitterless and contains no private user data.

## Ownership

| Concern                                                                                          | Owner                                                                   |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| Home card and launch action                                                                      | Home Mini Apps renderer                                                 |
| OS file-open queue and first/second-instance routing                                             | `app.main.ts` + OnlyPreview open router                                 |
| Standalone `BaseWindow`, Shell, Setting/Guide windows, total cleanup                             | OnlyPreview window handler/helper                                       |
| Preview selection revision, inner bounds, active surface, readiness, teardown                    | Main `OnlyPreviewPreviewRegionService`                                  |
| Current-file find state/revision, capability routing, native request/result fencing              | Main `OnlyPreviewFindService` inside the Preview Region                 |
| Per-view host, search-bootstrap, workspace identity, and media ownership                         | Main OnlyPreview capability registries                                  |
| Canonical Project root/item authority, containment, metadata, and two-phase Delete               | invisible top-level `fileSearch` renderer's Node-context preload        |
| Native dialogs, shell open/reveal, and clipboard effects after preload authorization             | Main OnlyPreview handler/clipboard services                             |
| Project traversal, media classification, filename tier, full-text SQLite, watch/update/query     | invisible top-level `fileSearch` renderer's Node-context preload        |
| Last canonical directory persistence and restore ordering                                        | Main OnlyPreview recent-directory service + Core SQLite `setting` table |
| Asset/document tokens, Range/CSP routing and session-scoped `bitterless-preview://`              | Main in-memory asset/document protocol registries                       |
| Non-Office selection identity, text and asset/PDF/media/HTML byte sessions                       | invisible top-level `fileSearch` renderer's Node-context preload        |
| Rooted Project tree, Global Search, Preview toolbar/actions/Find Bar, status, inner bounds       | OnlyPreview Shell renderer                                              |
| Monaco/Markdown/XLSX/DOCX/PPTX/Draw.io/image/audio/video/unsupported presentation                | app-owned Vue Preview surface                                           |
| Executable contained HTML and Chromium PDF presentation                                          | disposable raw Chromium Preview surface                                 |
| Monaco model/editor lifecycle and Vue readiness observations                                     | Vue Preview surface, fenced by Main revision/runtime token              |
| Monaco/OOXML current-file find execution and active/all-match highlight                          | Vue Preview model adapters, fenced by Main command/runtime revision     |
| Preferences                                                                                      | Main handler backed by `SettingDao`                                     |
| Window geometry                                                                                  | existing `windowStateService`                                           |
| Portable agent skill, setup Guide, and read-only agent open                                      | OnlyPreview skill service + local MCP bridge                            |

## Window And View Composition

### Standalone

```text
┌──────────────────────────── BaseWindow ───────────────────────────────┐
│ Shell WebContentsView                                                │
│ ┌──────────────────────────────────────────────────────────────────┐ │
│ │ 32px Royal Blue MenuBar + platform window controls              │ │
│ ├──────────────────────┬───────────────────────────────────────────┤ │
│ │ rooted Project tree  │ 43px Preview toolbar                      │ │
│ │                      │ identity/path  Find Bar    type/actions   │ │
│ │                      ├───────────────────────────────────────────┤ │
│ │                      │ inner content host                        │ │
│ │ ━ 2px index rail     │                                           │ │
│ ├──────────────────────┴───────────────────────────────────────────┤ │
│ │ selected-file metadata status                                    │ │
│ └──────────────────────────────────────────────────────────────────┘ │
│                        ┌────────────────────────────────────────────┐ │
│                        │ exactly one Main-owned content view       │ │
│                        │ Vue app surface OR raw Chromium surface   │ │
│                        └────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘

Main capability/XPC supervisor ── private typed XPC ── hidden fileSearch renderer preload

┌──────────────────── BrowserWindow ────────────────────┐
│ OnlyPreview Setting renderer                          │
└───────────────────────────────────────────────────────┘

┌──────────────── parented BrowserWindow ───────────────┐
│ Copy the skill to your agent                          │
└───────────────────────────────────────────────────────┘
```

- The Shell remains attached across the full window and owns the 43px Preview toolbar. A
  `ResizeObserver` reports only the inner content-host rectangle below it. Main independently
  validates/clamps the rectangle to begin at or below y=75 (32px MenuBar + 43px toolbar), and does
  not create, load, or attach a content view before the first valid bounds arrive.
- Main's Preview Region owns one monotonically increasing selection revision and attaches exactly
  one content view: the app-owned Vue surface for code/Markdown/XLSX/DOCX/PPTX/Draw.io/image/media/fallback states,
  or a fresh raw Chromium surface for HTML/PDF. A transition first revokes old authority and detaches the
  old surface; resize cannot reattach it while the next descriptor is pending.
- One Shell-owned Find Bar serves Shell, Vue, and raw Chromium shortcut entry. Main owns the only
  accepted `findRevision`: HTML/PDF/Markdown use the active view's `findInPage()`, Monaco uses its
  complete accepted model with one active decoration, and XLSX/XLSM/DOCX/PPTX use the active
  `@silurus/ooxml` viewer's complete model with all matches highlighted plus a distinct active
  match. Draw.io phase one, image/audio/video, and
  unsupported expose no text capability and do not open a fake session.
- File identity, type, and native file actions stay in the Shell toolbar even when classification,
  loading, or a content renderer fails. Presentation events carry only `{ hostId }` as an untrusted
  nudge; Shell and Vue refetch their own capability-scoped Main snapshots with local generation
  fences. Shell never receives an asset/document URL.
- Shell input, Preview rendering, and search I/O do not share an event loop. The hidden `fileSearch`
  renderer preload owns the search runtime; Main only validates and relays bounded XPC messages.
- Closing the `BaseWindow` destroys the host-bound hidden `fileSearch` renderer, rejects pending
  relay calls, revokes active streams/protocol handlers, detaches the active content view, and
  closes Shell and all content `webContents`.
- The standalone, Setting, and Agent Guide windows are singletons. Reopening focuses the existing
  instance. Setting and Guide are parented to the active standalone window.
- All three top-level windows use `windowStateService`, `minWidth: 800`, and `minHeight: 600`.
  Setting and Guide restore only their saved size, then center and clamp against the current parent
  display on every open.

### Standalone-only boundary

OnlyPreview is not an Omni mini app. Its usable surface owns a native `BaseWindow` graph containing
one Shell and one mutually exclusive Preview Region content view plus its app-specific Setting
window. Omni must not
list `onlypreview`, accept it in persisted cell state, map it to a runtime target, or load an
OnlyPreview preload. There is no embedded DOM Preview adapter or container mode.

## Renderer Entries

| Entry                  | Preload                 | Host mode    | Responsibility                                                                                      |
| ---------------------- | ----------------------- | ------------ | --------------------------------------------------------------------------------------------------- |
| `onlypreview/shell`    | `onlypreview.js`        | `shell`      | MenuBar, tree/search, Preview toolbar/actions, status, and inner content-host bounds                |
| `onlypreview/preview`  | `onlypreviewContent.js` | `preview`    | Vue-only Monaco/Markdown/XLSX/DOCX/PPTX/Draw.io/image/audio/video/unsupported/loading/error surface |
| raw Chromium view      | none                    | none         | disposable contained HTML or built-in PDF viewer; no first-party renderer entry or host token       |
| `onlypreview/settings` | `onlypreview.js`        | `settings`   | app-specific settings form                                                                          |
| `onlypreview/guide`    | `onlypreview.js`        | `guide`      | one-copy MCP and portable Preview-skill setup                                                       |
| `fileSearch`           | `fileSearch.js`         | `background` | invisible page whose trusted Node-context preload owns Project authority/delete, browse/index/search/watch, and bounded current-file read sessions |

Both visible preloads import `electron-xpc/preload` and expose only immutable mode/platform context plus the
Main-issued content host through `contextBridge`. Main creates and pre-registers one unguessable
`hostToken` before each first-party OnlyPreview view is created, then passes it through
`additionalArguments`. Shell and Vue Preview share one content host, while Vue also receives a
rotating runtime token used only for its privileged presentation snapshot/readiness observations.
The raw Chromium view receives neither token nor a preload. Setting and Guide windows each have
their own narrow host. The search-bootstrap capability remains private in Main;
no visible page receives its token, absolute workspace root, or database path. Only the trusted
`fileSearch` preload receives paths. A second independent capability binds its Office reader to an
exact one-shot Main grant; a third pairwise-distinct capability owns Project root/item authorization
and identity-fenced Delete. The Vue content preload keeps its Office broker capability in its
isolated world and exposes only a path-free current-revision read method.

Every visible OnlyPreview view uses `sandbox: true`, `contextIsolation: true`,
`nodeIntegration: false`, `webSecurity: true`, an exact navigation fence, and no Node or filesystem
bridge. The sandbox-safe `onlypreview.js` serves Shell, Setting, and Guide; `onlypreviewContent.js`
serves the Preview view and contains no search runtime or token. Every renderer initializes language
before Vue mount. All four HTML entries remain first-party local targets registered in the
application log policy and i18n checker.

The invisible top-level `fileSearch` renderer is not a visible OnlyPreview view. It uses
`sandbox: false`, `contextIsolation: true`, `nodeIntegration: false`, `webSecurity: true`, exact
local navigation fencing, `backgroundThrottling: false`, and no window-open or external-navigation
capability. Its empty page has no business UI; all privileged work stays in `fileSearch.js`. Main
destroys it on host revoke, auth invalidation, standalone close, load/preload/navigation failure,
renderer exit, or app quit.

## Workspace Capability Contract

`electron-xpc` Main dispatch does not retain a trustworthy sender identity and its handler boundary
does not preserve thrown typed errors. Therefore no renderer method accepts an arbitrary absolute
file path, and every privileged call supplies a Main-issued host capability and returns an explicit
result envelope.

```text
OS event or native Open dialog
        |
        v
hidden preload inspects target + canonical root identity
        |
        v
random workspaceId ──> Main-owned host/workspace ref + hidden-preload root authority
        |
        +── renderer receives workspaceId + display metadata
        |
        +── renderer requests { workspaceId, relativePath }
                                 |
                                 v
                 Main validates live host/workspace ref
                                 |
                                 v
                 hidden preload resolves + revalidates identity/containment
```

Required properties:

- A file target creates a workspace rooted at its parent and selects its basename. A directory
  target creates a workspace rooted at that directory.
- `workspaceId` is an unguessable opaque value. Main may retain the canonical root string only as
  private in-memory bootstrap state; the hidden preload owns live root identity and path authority.
- Renderer calls carry only `workspaceId` and normalized relative paths.
- Main rejects missing host/workspace capabilities before dispatch. The hidden preload rejects
  absolute relative-path inputs, `..` traversal, devices, sockets, stale root identity, and
  post-`realpath` paths outside the root.
- Content reads open the authorized canonical path with read-only/no-follow flags where supported,
  verify the opened handle is a regular file, then recheck post-open containment and device/inode
  identity. Sampling, bounded text reads, and protocol streams consume that same handle rather than
  reopening the validated path.
- Symbolic links may appear as leaf metadata but are never recursively indexed. Selecting a
  symlink whose target escapes the root fails with a typed containment error.
- Host capabilities and workspaces have bounded counts. Workspaces and media tokens are bound to
  their issuing live host and are revoked when that host is destroyed or the application quits.
- `restoreWorkspace` first returns the latest workspace still owned by that same live host. When a
  fresh host has no workspace, it may reconstruct one from the persisted last canonical directory
  under the recent-directory contract below; the reconstruction always mints a new `workspaceId`.
- `OnlyPreviewWorkspace.displayPath` is Shell-only workspace presentation metadata. It cannot be
  supplied back as read authority and is never copied into `OnlyPreviewDescriptor`, the public
  selected-file presentation, or the runtime-token-bound Vue snapshot. Those snapshots carry only
  workspace-relative file identity plus bounded type/size/modified metadata; no visible content
  renderer receives a canonical root or absolute selected-file path.

The renderer-visible surfaces are read-only. The Main API intentionally has no directory-listing or
index-build method; browse/search requests use the narrow supervised search-runtime proxy:

```ts
interface OnlyPreviewApi {
  openOnlyPreviewWindow(): Promise<OnlyPreviewResult<void>>;
  chooseFolder(params: HostRequest): Promise<OnlyPreviewResult<OnlyPreviewWorkspace | null>>;
  restoreWorkspace(params: HostRequest): Promise<OnlyPreviewResult<OnlyPreviewWorkspace | null>>;
  readText(params: OnlyPreviewTextReadRequest): Promise<OnlyPreviewResult<OnlyPreviewTextContent>>;
  selectStandaloneFile(params: HostRequest & OnlyPreviewFileRef): Promise<OnlyPreviewResult<void>>;
  updatePreviewBounds(params: HostRequest & OnlyPreviewBounds): Promise<OnlyPreviewResult<void>>;
  minimizeWindow(params: HostRequest): Promise<OnlyPreviewResult<void>>;
  toggleMaximizeWindow(params: HostRequest): Promise<OnlyPreviewResult<void>>;
  closeWindow(params: HostRequest): Promise<OnlyPreviewResult<void>>;
  showFileContextMenu(params: HostRequest & OnlyPreviewFileRef): Promise<OnlyPreviewResult<void>>;
  openExternally(params: HostRequest & OnlyPreviewFileRef): Promise<OnlyPreviewResult<void>>;
  revealInFolder(params: HostRequest & OnlyPreviewFileRef): Promise<OnlyPreviewResult<void>>;
  getSettings(params: HostRequest): Promise<OnlyPreviewResult<OnlyPreviewSettings>>;
  saveSettings(
    params: HostRequest & { settings: OnlyPreviewSettings }
  ): Promise<OnlyPreviewResult<OnlyPreviewSettings>>;
  openSettings(params: HostRequest): Promise<OnlyPreviewResult<void>>;
  closeSettings(params: HostRequest): Promise<OnlyPreviewResult<void>>;
  openAgentSkillGuide(params: HostRequest): Promise<OnlyPreviewResult<void>>;
  getAgentSkillGuideInfo(
    params: HostRequest
  ): Promise<OnlyPreviewResult<OnlyPreviewAgentSkillGuideInfo>>;
}

interface OnlyPreviewSearchRuntimeApi {
  initialize(
    params: OnlyPreviewSearchInitializeRequest
  ): Promise<OnlyPreviewResult<OnlyPreviewSearchSnapshot>>;
  refresh(
    params: OnlyPreviewSearchRefreshRequest
  ): Promise<OnlyPreviewResult<OnlyPreviewSearchSnapshot>>;
  browseDirectory(
    params: OnlyPreviewBrowseDirectoryRequest
  ): Promise<OnlyPreviewResult<OnlyPreviewBrowseListing>>;
  search(params: OnlyPreviewSearchRequest): Promise<OnlyPreviewResult<OnlyPreviewSearchResponse>>;
  cancel(params: OnlyPreviewSearchCancelRequest): Promise<OnlyPreviewResult<void>>;
  shutdown(params: OnlyPreviewSearchShutdownRequest): Promise<OnlyPreviewResult<void>>;
}

type OnlyPreviewResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: OnlyPreviewErrorCode; message: string } };

type OnlyPreviewSearchBuildProgress =
  | {
      workspaceId: string;
      generation: number;
      buildRevision: number;
      phase: 'counting';
    }
  | {
      workspaceId: string;
      generation: number;
      buildRevision: number;
      phase: 'indexing';
      completed: number;
      total: number;
    };
```

Every method accepts zero or one object parameter to preserve the `electron-xpc` contract.
The handler catches all fallible service work and converts it to this discriminated envelope; a
renderer never interprets XPC's `null` exception fallback as a valid optional result. Content-host
methods reject settings hosts, settings-only methods reject unrelated hosts where applicable, and
unknown/revoked tokens fail before any workspace lookup.
`openAgentSkillGuide` accepts only the active content host, while `getAgentSkillGuideInfo` accepts
only the active Guide host. The Guide role has no workspace, file, settings, native-menu, external
open, recent-directory, or standalone-window capability. Its renderer constructs a narrow XPC
client containing only `getAgentSkillGuideInfo`; it does not import the full content client. The
existing tokenless `openOnlyPreviewWindow` call used by Home remains a separate global, idempotent
launch action and is not part of Guide-token authority.

Shell calls a narrow Main XPC runtime proxy with the shared content host and opaque workspace ID.
Main rejects any other host/workspace generation, resolves the private bootstrap internally, and
enriches only the private `FileSearchRuntime` XPC initialization call with
`{ rootPath, databasePath }`. The hidden preload registers the capability-bound runtime through
`electron-xpc`; Main bounds pending requests, rejects them on timeout/exit, and relays only
whitelisted, shape-validated snapshot, browse-listing, batch, progress, and watch events after
binding them to the attached `hostId`. Visible renderers receive those events only through the
existing Main broadcast surface. There is no Main traversal, index-build, query, or watch
implementation, and a visible renderer cannot call the private runtime without Main's capability.

Index-entry validation preserves the distinction between Preview routing and search media types.
`text`, `pdf`, `image`, `audio`, and `video` use the same value in both fields; `sheet`, `document`,
`presentation`, `diagram`, and `unsupported` use search `mediaType: 'unknown'`, and only `text` has
`isText: true`. A malformed event for the attached workspace's current generation faults the
file-search runtime immediately with the Project index protocol error and wakes pending calls. A
well-formed stale workspace/generation event and a late batch for a superseded search remain normal
ignored races. The generic Preview stream protocol error is not used for Project index failures.

## Recent Directory Persistence

OnlyPreview remembers the last successfully opened directory in the existing Core SQLite `setting`
table. Main owns this state; no new renderer storage or path-bearing API is added.

| Field         | Value                                   |
| ------------- | --------------------------------------- |
| `key`         | `onlypreview_workspace`                 |
| `sub_key`     | `last_directory`                        |
| stored value  | `{ version: 1, directoryPath: string }` |
| cleared value | `null`                                  |

- Persist only the canonical workspace root returned after `createForTarget` succeeds. A folder
  target stores that canonical directory; an OS-opened file stores its canonical parent directory.
  Never persist the selected file, relative file selection, `workspaceId`, `hostId`, `hostToken`,
  asset token, raw picker input, or an unvalidated path.
- Storage access uses only the value-free-log `SettingDao.getStored`, `insertIfAbsent`, and
  `compareAndSet` methods. Writes use insert-if-absent or compare-and-set against the exact observed
  serialized value; a stale mutation generation cannot overwrite a newer explicit target. The
  path/value must never be written to application logs.
- Core SQLite startup is represented by one ready/failure latch. A history restore waits for the
  latch. A successful ready signal permits the initial read and flushes the latest pending write;
  a failure signal resolves restore to `null` and leaves explicit folder/file opening usable.
  Successful opens before readiness update current Main memory and retain only the latest pending
  canonical directory for a later ready flush.
- Shell owns the restore request for the content host. Main runs one per-host single-flight restore,
  rechecks whether that host already owns a workspace before and after the SQLite wait, and routes
  the restored selection or empty workspace through the Preview Region before returning. Host revoke,
  standalone teardown, auth invalidation, and quit remove that host's restore promise, generation,
  and transient remembered state.
- A persisted value is only a candidate. Main parses version 1, revalidates the directory through
  the normal `createForTarget` containment/stat path, and creates a fresh directory workspace with
  no selected file. Missing, malformed, non-directory, or permission-denied candidates fail closed
  to the empty state and are changed to `null` only with `compareAndSet` against the exact invalid
  serialized value, so cleanup cannot erase a concurrent newer path.
- An explicit OS target suppresses history restore before `ensureStandalone()` creates/focuses the
  Shell and Preview views. Explicit opens and restore share one per-host mutation generation; a
  late history read cannot replace an explicit target, and among serialized explicit requests the
  latest explicit target remains visible and becomes the remembered directory.

## Browse And Search Index Contract

Tasks 035–037 replace the former Project-sidebar filter/Project Search presentation with the
[Global Search contract](../design/onlypreview-global-search.md). The implementation may retain
internal `OnlyPreviewProjectSearch*` names during migration, but the product contract below is
authoritative: the Project pane contains only the rooted browse tree, and `Shift+Cmd/Ctrl+F` opens
the right-workspace Files/Contents Global Search. Older Project-filter reveal and merged-result UI
paragraphs in completed task history are historical, not extension points for the new surface.

The hidden `fileSearch` preload owns two policy-separated views:

1. a demand-loaded in-memory Browse index containing every rooted Project child, including entries
   excluded from Global Search; it never reads file bodies; and
2. a committed Global Search snapshot containing eligible file metadata, persisted eligible
   directory/symlink metadata, and SQLite content chunks only for eligible text files. Files reads
   the snapshot's filename/tree tiers; Contents reads its FTS tier.

The SQLite database lives below Bitterless user data and uses schema version 8. It retains schema-7
`files.in_project`, the versioned `contentless-full` FTS layout, stable content-defined chunks, CJK
short-code-point postings, exact original-text verification, and per-file transaction-safe
upsert/delete. Schema 8 additively persists non-file Search tree entries, maximum traversal depth,
and a tree-ready build marker bound to the same committed content build. A valid schema-7 database
is migrated in place without dropping files, chunks, or FTS; its missing tree marker intentionally
permits file/Contents warm results but not synthetic or incomplete folder results until one full
reconcile commits the tree tier. NeDB and the native `simple` extension are not product
dependencies. This file-search database is intentionally ordinary, completely unencrypted SQLite
opened through `node:sqlite`; it receives no SQLCipher key, credential, Keychain material, or Core
database encryption wrapper. It is a disposable/rebuildable local index and may contain plaintext
eligible file basenames, searchable text chunks, and relative Search tree metadata. Historical
prototype evidence includes a roughly 12MiB filename-tier estimate, under 17MiB retained heap
delta, and about 1.412GB of SQLite disk footprint. Those prototype numbers guide budgets only: they
do not prove the current product scope UI, local-filter semantics, background-renderer XPC relay,
or selected-Preview refresh. Disk footprint is not RAM and is never summed into runtime memory.

| Constraint                            | Product value                                                                                                                                            |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Maximum visible Global Search results | 250 Files plus 250 Contents rows                                                                                                                         |
| Global Search traversal depth         | 32; complete demand-loaded directory browsing is independent and has no global depth cap                                                                 |
| Directory-name tier                   | rooted file + directory metadata; Global Search Files matches eligible names without opening bodies                                                      |
| Search SQLite encryption              | none; persistent Contents index is completely unencrypted, disposable, and rebuilt from workspace files                                                  |
| Global Search hidden policy           | every result below any dot-prefixed directory is physically absent; root dotfiles remain eligible unless separately excluded                             |
| Global Search fixed exclusions        | `.git`, `node_modules`, `dist`, `build`, `out`, `output`, `.next`, `coverage`, `.cache`, `.turbo` at any depth; immutable against `!`                    |
| Workspace config                      | flat version-1 ordered `exclude` globs in `.bitterless/preview-config.yml`                                                                               |
| Symlink policy                        | leaf only, never recurse or index target content                                                                                                         |
| Project tree/directory-preview sort   | directories first, then natural case-insensitive name order                                                                                              |
| Global Search Files sort              | stable global partition: all matching folders first, then matching files; cap after partition                                                            |
| Search normalization                  | NFKC plus established case policy, followed by original-text literal verification                                                                        |
| Watch reconcile                       | 400ms trailing per changed path; overflow/error/missing filename triggers full reconcile                                                                 |
| Runtime memory                        | strictly above 1GiB advisory; strictly above 2GiB sets `performanceAccepted=false` and `stop=false` without invalidating the recorded artifact or method |

Traversal starts in the dedicated hidden `fileSearch` preload on first open and advances in bounded elapsed-time
slices, yielding between batches. It emits metadata into the directory-name tier independently of
Global Search eligibility. Before any file body is opened, the Global Search branch rejects every
file below a hidden/fixed directory and then applies ordered workspace excludes. Each tree record
stores relative path, parent, exact display name, node kind, size, modified time, preview hint,
`mediaType`, and `isText`; excluded tree records use metadata/path classification only. Only eligible
`isText` files are decoded and indexed for content. Strict decoding, maximum searchable size,
containment, opened-file identity, and post-read size checks are enforced before committing a file.

The Project pane has no text-search field. It renders one synthetic workspace-root directory row
above the demand-loaded listing and owns only browsing, focus, expansion, locate-current-file, and
native item actions. Global Search Files separately returns eligible file and directory name
matches; Contents returns verified text-body matches. A path may appear once in each section because
the sections answer different questions. Exact-path deduplication occurs only within a section.

Global Search carries a strict scope:

```ts
type OnlyPreviewSearchScope = { kind: 'project' } | { kind: 'directory'; relativePath: string };
```

`Shift+Cmd/Ctrl+F` starts Current directory from the explicit tree selection: a selected directory
(including the synthetic root), selected file parent, selected Preview file parent, then root
(`relativePath: ''`). While Global Search remains open, explicit Project-tree selection updates
that directory live; roving focus and search-result selection cannot change it. Files always
searches project-wide file and directory metadata. Contents defaults to the live directory and its
selector switches between that directory and Project. A live directory change cancels and
reschedules only Current-directory Contents; Project scope records the new directory for later
without issuing an equivalent query. Scope changes share generation/cancellation/throttle fences.
Absolute/traversal paths and unknown scope shapes fail the strict contract.

The tree publishes every directory's complete direct-child set before deeper traversal, including
root-level files, dot-prefixed entries, generated-output directories, and config-excluded entries.
Those names remain available to rooted browsing even when they are ineligible for Global Search.
Each emitted browse entry carries one policy-derived `searchExcluded` boolean. The hidden
`fileSearch` preload computes it while building the listing and carries one ancestor-blocked bit in
each opaque directory token. A directory excluded without a possible later `!` re-inclusion marks
every loaded descendant even when the original glob matched only that directory; a traversable
excluded directory still permits a later explicitly re-included descendant to return to normal.
This adds no filesystem I/O or Renderer ancestor scan. Excluded files, directories, and excluded
descendants use a pale-orange Project-row background. Excluded open and closed folder icons use the
canonical solid accent orange `#C2410C`; file icons remain unchanged. Hover and selected variants
stay orange while the existing Royal Blue selection rail remains visible. The synthetic root and
symlinks retain their existing treatments.
The hidden `fileSearch` preload publishes the complete root listing early in initialization and mints opaque
directory tokens for expandable rows. Shell requests an expansion with only the current host,
workspace, generation, and `directoryToken`; it never sends a relative or absolute directory path.
The hidden `fileSearch` preload alone maps that token back to a contained relative path and returns relative
metadata. Main validates and relays without performing the directory walk. The initial or
incremental Global Search traversal bound cannot remove a root row or an expanded directory child
from ordinary browsing. Refresh and workspace replacement discard stale listings and token maps,
reload the root, and fence every late listing by host, workspace, generation, and token ownership.
Both Global Search scopes use the same physical eligibility: a root-level hidden file remains
eligible unless separately excluded, while a file below any hidden/fixed directory or matched by
workspace config is absent. Anchoring `In Directory` at such a tree directory therefore returns no
excluded files and cannot bypass the policy.

Files metadata and Contents SQLite branches start cooperatively. When a reusable committed snapshot
exists, they first read that snapshot immediately instead of waiting for startup candidate
reconciliation. Their batches are accepted warm results while the request remains pending. After
successful promotion, the same request reacquires the fresh committed snapshot, reruns both
branches, and terminal-replaces all warm rows and tokens. A legacy index without a valid persisted
tree marker may warm-return ordinary files and Contents but withholds folders; a true first build
preserves the existing readiness gate. Failure or cancellation does not release snapshot ownership
until both sibling branches settle. Files matches are stable-partitioned into folders then files
before their 250-row cap. This uses the same time-sliced metadata pass and SQLite connection; it adds
no renderer, worker, traversal, XPC call, or Main-process I/O.

The grouped result, opaque `resultToken`, and selected-result preview contracts are exact and live
in [OnlyPreview Global Search and result preview](../design/onlypreview-global-search.md). The
hidden preload retains only the latest request's bounded token map. Main validates and relays a
preview request; it never reads the filesystem. Text heads cap at 256KiB, directories at 200 direct
children, and non-text results are metadata-only. Files and Contents selections for the same text
file use the same bounded file-head preview; only the Contents result row retains the verified
match snippet. The bottom pane never enlarges or jumps to that match.

Snippet boundaries use Unicode graphemes and original text. Include at most 16 graphemes before
and after while capping normal snippets at 48 graphemes. If the verified match itself exceeds 48,
show the match alone. If the remaining context budget is odd, the leading side receives one more
grapheme. Newlines and composed/ZWJ sequences remain original text; highlight offsets address the
returned snippet.

Shell dispatches Global Search with a fixed 120ms leading-plus-trailing throttle. IME composition
never dispatches an intermediate composition string. The background file-search runtime permits at most one
active query and one latest pending query, explicitly cancels superseded work, and fences every
batch/result by host, workspace, request, and generation. It flushes verified upserts while the query is
running at no more than 50 results per batch or a 16ms deadline; its terminal message carries only
metadata and canonical result order, so the full row payload is not serialized twice. The last
input is dispatched exactly once.

Manual file activation also sends the current host/workspace/generation and exact relative file path
to a dedicated priority lane in that same hidden runtime. Main only validates and relays this
request. While a build or reconcile is active, the lane retains at most the latest requested file,
reads it through the ordinary Global Search containment/exclusion/classification/size/identity
guards, and builds one complete in-memory file index. A newer selection revokes the older read;
workspace/build replacement, promotion, failure, or shutdown closes the lane. Selection and Preview
never wait for it, and a priority failure cannot become a Preview error.

During an active initial build or full reconcile, the hidden file-search preload publishes bounded aggregate
`counting` and `indexing` progress through `onlypreview/search-progress`. Each event is fenced by
`workspaceId`, `generation`, and opaque `buildRevision`; Main shape-validates and relays only the
attached current generation without doing search I/O. Shell accepts only its current revision,
rejects regressing or inconsistent counts, clamps the determinate ratio to `0..1`, and clears the
rail when that build settles, fails, or is superseded. The event contains no path, filename, file
content, setting, or absolute filesystem metadata.

The same hidden runtime emits a separate fixed-stage timing timeline under application-log scope
`[onlypreview-search]`. It distinguishes reusable SQLite open/hydration, count, candidate backup,
traversal, rebuild/reconcile, promotion, initial-tree-metadata search wait, first Files/Contents
result, section completion, terminal response, Main XPC duration, and Shell acceptance. Each process
uses its own monotonic clock; no cross-process timestamp subtraction is presented as a duration.
Diagnostics reuse existing aggregate counters and add no filesystem/SQLite/body work or protocol
fields. They never run inside entry, file, chunk, result, batch, or progress loops.

Index progress and Global Search availability are independent. When a complete SQLite index
already exists, it remains the active read-only query authority while a separate candidate index is
counted and built. Each query phase acquires a reader lease that captures one internally consistent
index plus Search-tree snapshot. Promotion first announces a writer gate, waits for every reader to
settle, atomically swaps/closes snapshots, and then releases fresh readers; it cannot close an index
between sibling branches or combine old SQLite with new tree metadata. A query never observes
partially written candidate rows. Cancellation or candidate failure discards the candidate and
leaves the active snapshot searchable. The complete one-file priority lane remains an additional
early source for a matching manually opened file. After successful promotion the request begins a
new result-token session, reruns against the fresh snapshot, and terminal-replaces the warm batch
projection; exact relative-path deduplication prevents duplicates. Starting, replacing, failing, or
completing a build does not cancel an accepted query or clear its accepted results.

On the first build, before any complete active index exists, Current directory Contents performs one
complete scope-bounded traversal with the same hidden/fixed-directory, workspace-exclude, file
classification, decoding, containment, cancellation, result-ordering, and maximum-result rules as
the project index. It may stream scoped Contents while the background project build continues.
Project-wide Files waits for that existing build's complete metadata candidate; it never starts a
second whole-project traversal. Neither section queries an incomplete candidate or uses SQL `LIKE`:
`LIKE` can only inspect rows already written to SQLite and would still turn unindexed files into
false negatives. First-build terminal results remain pending until the complete candidate is
promoted and must never publish a false empty Files result merely because indexing is in progress.

`fs.watch` updates are hints, not authority. After the 400ms trailing edge, the hidden file-search preload
revalidates the changed relative path once, updates tree metadata regardless of Global Search
excludes, and upserts or deletes the SQLite file according to current eligibility. Before a bounded
watch mutation it clears the persisted Search-tree ready marker; only a successful file/tree commit
restores the marker for the active build. A crash, interruption, or build-marker mismatch therefore
fails closed to file/Contents-only warm search on the next launch rather than exposing a mixed tree.
The bounded path completes metadata and depth preflight before reading any body, selects changed
paths and parents in one retained-tree pass, and reads/commits at most ten bounded bodies per chunk.
Even the 512-path ceiling therefore avoids a 512MiB retained-body spike and per-file transactions;
any partial failure leaves tree readiness invalid and forces the next event through full reconcile.
Create, update, delete, delete/recreate, and exclusion transitions converge at that commit. Rename,
directory/type changes, lost/ambiguous events, and watch errors request a cooperative full dual
reconcile. Manual refresh uses the same path; it does not reintroduce a Main directory walk.

The committed trailing update also publishes a bounded host/workspace/relative-path/watch-revision
signal through the private capability-bound XPC event channel. Main validates the event, binds it to
the attached host, and routes a matching selected-file change through the Main Preview Region. The
Region advances its selection revision, revokes the old surface authority and streams, then
reclassifies and mounts only the newly selected revision. Delete/rename renders the typed missing
state; a later recreation carries a newer revision and reloads. Full reconcile and manual refresh
use the same selection-safe transition. Main still performs no file watch, search traversal, index
query, or Preview polling; it only owns the selected-file presentation transition.

### Product Overmind acceptance evidence

`PRODUCT-P00` and `PRODUCT-P01` below are immutable historical evidence for the former
hidden-inclusive physical SQLite policy. They indexed 726 hidden-directory descendant files and
therefore do not accept the dual-index, hidden-pruned policy introduced by task 016. Their recorded
latency/memory/disk values must not be presented as current-policy results. A fresh PRODUCT-P02
point using the product core in a fresh Node child, separate
directory metadata tier, eligibility before file-body open, and create/update/delete/rename gates is
required and has not yet been run. The hidden file-search BrowserWindow/preload startup, XPC relay,
Shell scheduling, and renderer commit remain outside that timing boundary and require targeted
Electron acceptance. Metadata-only tree `lstat` work is allowed and must be reported separately
rather than described as zero I/O.

The current development Overmind workspace supplies an actual flat
`<workspace>/.bitterless/preview-config.yml` outside this public submodule. It excludes Keychain,
Ops, the mutable Preview benchmark observer tree, common generated output, and reviewed
credential-bearing filenames before body reads. The profile-shaped Preview
`benchmark/benchmark-config.yml` remains benchmark input and is not accepted as the product file.
OnlyPreview itself stays read-only and never creates workspace config. The product shape is:

```yaml
version: 1
exclude:
  - '**/.git/**'
  - '**/node_modules/**'
  - '**/dist/**'
  - '**/output/**'
```

The canonical same-attempt `PRODUCT-P01` A-B-B-A acceptance result is recorded at
`areas/agent/runtime/human/preview/product-benchmark/results/PRODUCT-P01-2026-08-09T18-34-18.181Z-2ceb96275090.json`
with SHA-256
`2ceb962750900c5fc588b895b592f68abb53d2cb8cbae7c6b498ecc7fcddbb6b`.
Recording/trend eligibility, all control/candidate semantic gates (24/24), cancellation/latest/watch
gates, and `directTargetPassed` are true; therefore `stop=true`. Candidate worst complete-result warm
p95 was 82.523ms and worst result-bearing first-result p95 was 25.636ms. Pooled In Project complete
p95 improved from control to candidate by 229.355→14.337ms for CJK unigram, 217.210→13.784ms for
CJK bigram, and 109.963→5.061ms for combining text.

Candidate B1/B2 builds took 66,383.169/67,052.931ms versus control A1/A2 at
65,252.320/63,552.320ms. CJK/short postings increased 1,658,980→2,298,772. Candidate runtime max
was 873,267,200 bytes, below 1GiB; disk max was 703,982,720 bytes versus control 686,013,232 bytes.
Disk remains separate from runtime memory and from the accepted historical roughly 1.412GB prototype
index. This is a direct `<100ms` acceptance stop, not a cross-epoch plateau claim.

The historical canonical `PRODUCT-P00` baseline is recorded at
`areas/agent/runtime/human/preview/product-benchmark/results/PRODUCT-P00-2026-08-09T17-14-11.034Z-289c3f0152b8.json`
with SHA-256
`289c3f0152b838512a7123acb2fd8ae3e9ad981a9125897a194c79fb976c00cd`.
`recordingEligible`, `trendEligible`, and `performanceAccepted` are all true; this is the first
current-product point, so `stop=false` rather than a plateau claim. On the configured Overmind
corpus, first build took 66,214.878ms, fresh Worker reopen took 48.637ms with filesystem cache
uncontrolled and likely warm, and reconciliation took 12,033.667ms. Every warm first-result p95
was below 100ms. Complete-result p95 exceeded 100ms only for In Project CJK unigram (230.848ms),
CJK bigram (214.035ms), and combining-text (114.643ms); PRODUCT-P01 subsequently closed these
targets. Cancellation reached terminal in 0.292ms with no late batch. The
synthetic incremental watch committed in 442.041ms and verified in 489.881ms with `full=false` and
`changedPathCount=1`.

Peak runtime memory was 852,492,288 bytes, below both the 1GiB advisory and 2GiB ceiling. SQLite
peaked at 691,402,296 bytes and finished at 642,551,808 bytes; disk remains reported separately
from RAM. Task 012 PASS and old prototype/R03/R04/R05/failed-R06 figures, including the historical
roughly 1.412GB prototype disk footprint, remain historical rather than substitutes for current
product evidence. The P00/P01 dynamic boundary is fresh child process → production Worker client →
TypeScript Worker → search engine/result batcher → coordinator. It does not dynamically measure
the Electron preload/XPC hop, Shell's 120ms scheduler, the Main Region's selection/surface commit,
Vue readiness, or packaged startup. The earlier 7/7 Electron E2E covers only its historical
single-Vue unpackaged
runtime/UI path; packaged release startup remains untested.

## Preview Classification And Rendering

| Kind              | MVP inputs                                                                                                                                                    | Surface / renderer                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `text`            | known source/config/prose/log extensions (including `.js` / `.mjs` / `.cjs`) plus every remaining regular file after specialized/explicit-unsupported routing | Vue: Monaco `vs`, `readOnly`, `domReadOnly`, selectable text, known syntax map or `plaintext`, find                          |
| `text` / Markdown | `.md`                                                                                                                                                         | Vue: centered semantic reading surface compiled by `marked` and sanitized by DOMPurify; `.markdown` and `.mdx` remain Monaco |
| `html`            | `.html`, `.htm`                                                                                                                                               | raw Chromium: executable entry document plus contained relative JS/CSS/image/font/media resources                            |
| `pdf`             | `.pdf` with matching signature                                                                                                                                | raw Chromium: built-in PDF viewer over one exact revision-bound bounded asset                                                |
| `image`           | PNG, JPEG, GIF, WebP, AVIF, BMP, ICO, SVG                                                                                                                     | Vue: bounded Blob + off-DOM decode, then an accessible fit/zoom/reset/pan viewer                                             |
| `audio`           | MP3, WAV, OGG, M4A, AAC, FLAC; actual codec support remains Chromium-owned                                                                                    | Vue: HEAD preflight, then `<audio controls preload="metadata">`, no autoplay                                                 |
| `video`           | MP4, WebM, OGV, MOV, M4V; actual codec support remains Chromium-owned                                                                                         | Vue: HEAD preflight, then `<video controls preload="metadata">`, no autoplay                                                 |
| `sheet`           | `.xlsx`, `.xlsm` with bounded OOXML ZIP structure                                                                                                             | Vue: one-shot preflight Worker + lazy `@silurus/ooxml/xlsx` `XlsxViewer`                                                     |
| `document`        | `.docx` with bounded OOXML ZIP structure                                                                                                                      | Vue: one-shot preflight Worker + lazy `@silurus/ooxml/docx` `DocxScrollViewer`                                               |
| `presentation`    | `.pptx` with bounded OOXML ZIP structure                                                                                                                      | Vue: one-shot preflight Worker + lazy `@silurus/ooxml/pptx` `PptxScrollViewer`                                               |
| `diagram`         | `.drawio` with bounded XML/compressed-page structure                                                                                                          | Vue: one-shot preflight Worker + locally pinned official viewer mounted directly into an owned DOM element                   |
| `unsupported`     | exact recognized HEIC/HEIF/TIF/TIFF/RAW, MKV/AVI/WMV/FLV, and legacy `.doc`                                                                                   | Vue: typed image/media/document unsupported reason; system actions remain in the Shell toolbar                               |

- File admission uses one shared typed adapter-size policy, not scattered format constants. The
  fallback is 10MiB. Existing overrides remain Monaco 8MiB, Markdown/HTML 1MiB, Office 25MiB,
  Draw.io 20MiB, and PDF/image 100MiB. Audio/video explicitly use streaming policy: no product cap,
  while each capability still binds the finite verified selected-file size. Classifier admission
  and asset issuance consume the same helper so they cannot drift.
- Every Vue format component is selected with an async component/dynamic import from the current
  adapter. Opening one format does not load the components for the others. Heavy engines keep a
  second lazy boundary: the selected `@silurus/ooxml` format subpath loads only after its current
  preflight, and the pinned
  Draw.io viewer runtime loads only after the current diagram Worker preflight succeeds.
- Text reads are complete-or-error with an 8 MiB maximum. Metadata rejects a file above the limit
  before body I/O; an admitted read requests at most exactly 8 MiB from the verified handle, then
  revalidates identity/size/mtime and is never silently truncated.
- Text routing is extension-first and size-first. Known specialized and exact unsupported adapters
  win; every remaining regular file, including unknown, extensionless, backup, compound-extension,
  and `.zip` names, uses inert Monaco `plaintext`. Admitted UTF-8 and BOM-marked UTF-16 decode
  tolerantly, including NUL and replacement characters. No fallback content is executed or promoted
  to HTML/Markdown because of its bytes.
- HTML is routed directly only for `.html` and `.htm`; XML, Vue SFCs, and other HTML-like source
  remain Monaco text. The entry is capped at 1 MiB. Each revision receives a new raw Chromium view on
  the dedicated persistent preview partition, plus its own document token. Inline scripts/styles and contained relative
  JS/CSS/image/font/media resources may run/load; traversal, symlink escape, absolute/file URLs,
  remote network, popups, redirects, downloads, and permissions remain denied. The document has no
  preload, XPC, Electron/Node API, Bitterless cookies/storage, or broad filesystem authority.
- Markdown is rendered only for `.md`. `.markdown` and `.mdx` remain source; expanding file
  associations or interpreting JSX/import semantics is outside this focused contract. Markdown
  source above 1 MiB is rejected with a localized render-limit state instead of falling back to
  raw source.
- Markdown compilation uses direct current `marked` and DOMPurify dependencies. Raw HTML is escaped
  as visible text before sanitization. Sanitized output allows only semantic text/list/table/code
  tags and no attributes; scripts, styles, forms, frames, SVG/MathML, event handlers, `href`, `src`,
  and remote/data/local resource loads cannot survive. Links remain readable but inert, and images
  become alt-text placeholders rather than loading a resource.
- Image admission checks extension, the 100 MiB limit, and a bounded signature probe. Common SVG
  XML declaration/comment/DOCTYPE prologs, AAC `ADIF`, and plausible MOV/QuickTime
  `ftyp/moov/mdat/wide/free/skip` first atoms are accepted by their respective gates. An admitted
  image is fetched completely with exact response-length verification, converted to a
  renderer-owned Blob URL, and decoded off-DOM before a live `<img>` appears. The viewer starts in
  non-upscaling Fit, uses a 1.25 zoom factor, an effective minimum
  `min(0.1, currentFitScale)`, an `8` maximum, exact 100% Reset, centered pan clamps, ResizeObserver,
  primary-pointer capture/cancel, and focusable viewport arrow-key pan. Empty, read, signature, and
  decoder failures remain distinct; every created Blob URL is revoked exactly once.
- Audio/video stay on the revision-bound Range asset instead of buffering the full file. A HEAD
  preflight requires the exact expected `Content-Length` plus CORS-visible `Accept-Ranges: bytes`;
  only then does a native `preload="metadata"` player mount. `loadedmetadata` is the first ready
  signal. `MediaError` codes 1/2/3/4 map to aborted/network/decode/source-unsupported states, a
  missing error object maps to read failure, and a 30-second no-metadata/no-error deadline removes
  the dead player with the same typed read failure. Ready may later demote on a playback error.
- A descriptor reports a mismatched signature or one exact recognized unsupported image/media
  category as a recoverable preview state. Container extensions never assert codec support;
  Chromium's native player supplies the actual codec/source result.
- Task 022 is `implemented; owner verification pending`.
  [Independent review round 1](../plan/reviews/onlypreview-media-truthful-state-022-1.md) recorded
  **BLOCKED** on renderer-error family authorization; the exhaustive adapter discriminator and
  negative Region behavior coverage fixed that finding.
  [Independent review round 2](../plan/reviews/onlypreview-media-truthful-state-022-2.md) recorded
  **PASS**. Ral owns the remaining real-app image/media runtime and visual verification.
- Monaco editor and model are both disposed on file changes and component unmount.
- Selection/copy/find remain enabled; mutation commands and ordinary keyboard input cannot modify
  the model. Electron E2E must prove a selected range can be copied and attempted input leaves the
  Monaco model byte-for-byte unchanged.
- A non-empty Vue text selection reports its Unicode grapheme count in the Shell-owned bottom
  status rail. Monaco counts every non-empty editor selection; Markdown uses a DOM selection only
  when both endpoints remain inside the preview body. Raw Chromium HTML/PDF has no preload and
  therefore clears/hides this metadata. Whitespace and line breaks count. Empty,
  outside, stale, loading, error, file-change, and unmount states report zero and hide the label.
- Task 077 supersedes the historical Task 020 ExcelJS/self-owned-grid and Task 021
  `docx-preview` renderer paths while preserving their 25MiB/signature/OOXML preflight boundary.
  After the one-shot Worker returns the exact transferred bytes, Vue dynamically imports only the
  selected pinned `@silurus/ooxml@0.83.0` subpath and creates `XlsxViewer`, `DocxScrollViewer`, or
  `PptxScrollViewer` in the library's `mode: 'main'`: host 2D painting stays inside the isolated Vue
  Preview renderer while the package's parser Worker continues OOXML/WASM parsing. Main and preload
  never import or execute an Office parser.
- The common Office adapter disables Google Fonts and hyperlinks, passes explicit archive limits,
  relies on pinned 0.83.0's built-in decoded-image guards, and destroys the exact viewer on
  replacement, failure, timeout, or unmount. The library exposes no app-configurable raster/decode
  options, so Bitterless does not claim to pass them.
  For `.xlsx` only, Task 088 adds one narrow producer-compatibility path inside the original archive
  preflight: while worksheet XML is already streamed, exactly one non-macro worksheet with zero
  `sheetData` marks the in-memory preview copy for one disposable ExcelJS normalization Worker;
  multi-sheet cases and more than one `sheetData` remain invalid. The exceptional rewrite has a
  tighter 4 MiB archive / 8 MiB inflated ceiling, and normalized output is capped at 4 MiB before
  archive preflight runs again and the single
  `@silurus/ooxml/xlsx` Viewer is constructed. This pre-Viewer gate is required because the pinned
  package paints that worksheet parser error instead of rejecting `load()`. The original file is
  untouched, Main performs no content I/O, and arbitrary/encrypted/limited/XLSM failures never enter
  this path. Final rendering and Find/highlight remain owned by the OOXML Viewer.
  Legacy `.xls`, `.doc`, and `.ppt` remain unsupported. XLSM is read-only and macros are never
  executed. XLSX generally presents saved formula results, with the documented upstream exception
  that `TODAY()` and `NOW()` are evaluated against the current clock; no Excel-perfect calculation,
  Word-perfect pagination, or PowerPoint-perfect animation/fidelity is promised.
- The same Office content adapter owns current-file Find for all three viewers. A new query calls
  `findText(query, { caseSensitive })`, then `findNext()` or `findPrev()` to activate and navigate
  one result; subsequent navigation wraps through the viewer model. `findText()` keeps all matches
  highlighted and the active match distinct across sheets and virtualized DOCX pages/PPTX slides.
  Empty query, Find close, file/revision replacement, load failure, and teardown call `clearFind()`;
  generation fences reject late search results from a previous query or viewer.
- Task 032 routes only `.drawio` to `diagram` / `drawio-viewer`. It pins the official draw.io
  `viewer-static.min.js` from commit `85a95c9066d8db7e90a2a2aa25f1179945d08ab6` and its Apache-2.0
  license by SHA-256, loads neither at runtime from the network, and mounts the viewer directly into
  a component-owned `.mxgraph` element without an iframe or editor. A one-shot Worker scans fixed
  outer XML chunks and streams URL-safe base64, DEFLATE, percent/fatal-UTF-8, and page XML. It first
  rejects empty/non-Draw.io XML, DOCTYPE/ENTITY, malformed compressed pages, more than 32MiB expanded
  XML, more than 128 pages, more than 20,000 cells, any embedded/external raster/SVG/data/blob image
  resource, image shape/source, `mxImage`/`image` markup, or a non-renewing 10-second deadline. Main separately
  owns a non-renewing 30-second loading watchdog that can rebuild the exact blocked Vue view.
  Success supplies read-only page/layer/fit/zoom controls; teardown terminates Worker/fetch and
  destroys generated viewer state before another adapter mounts. Image-bearing graphs are rejected
  as `DIAGRAM_LIMIT` before viewer/GPU work; remote stencils, fonts, navigation, popups, downloads,
  and permissions remain blocked. Phase one registers `find: none`;
  complete cell-label search and location/highlight are a later task rather than an incomplete
  `findInPage()` result.
- Main alone mints the numeric selection revision. Vue readiness/error/selection observations must
  carry both the exact current revision and rotating Vue runtime token; Main rejects an old or
  foreign renderer even when it knows the shared host. Presentation events contain only `{ hostId }`
  and are treated as refetch nudges, never authoritative revision/descriptor payloads. Shell and
  Vue use independent fetch generations so an older snapshot promise cannot overwrite a newer one.
- A local file click, Main-native refresh, selected-file watch commit, restore, and workspace change
  enter the same Main transition. Each clears stale selection metadata and resets/disposes the old
  Vue component/model before the new exact revision can report ready.

## Tokenized Asset Protocol

Main registers `bitterless-preview` as a privileged, standard, secure, fetch-capable, streaming
scheme before `ready`. The normal app session handles only exact asset tokens. A raw Chromium
session installs its own asset plus document handlers before navigation and removes both on teardown;
the normal session never resolves document URLs.

The hidden Preview Read runtime prepares each non-Office selection against the exact active Project
workspace generation and returns only a descriptor plus opaque identity-pinned selection grant.
Main then issues every random, revision-bound asset/document token against that path-free grant. A
URL contains exactly a 64-hex token and one matching encoded display filename, never an absolute
path; credentials, ports, query strings, fragments, and path aliases are rejected. One-shot image
and Draw.io tokens keep the 30-minute TTL. Audio/video tokens use selection lifetime so a long-running
player can seek after 30 minutes; selection, workspace, host, shutdown, or explicit revoke still
invalidates them, and the bounded registry may evict its oldest entry under global pressure.
Unknown, expired, revoked, or malformed tokens return a non-content response.

Main parses and validates one byte-range request, then asks the hidden preload to open that exact
range against the selection grant. It returns `206` with `Accept-Ranges`, `Content-Range`, exact
`Content-Length`, and the authorized MIME type. Full `GET`/`HEAD`, malformed/unsatisfiable range,
and unsupported method behavior remain explicit. Responses expose `Accept-Ranges` to the renderer's
CORS fetch so media HEAD preflight can verify seek support.
Each live response owns one preload session with at most one pending read. Main's
`ReadableStream.pull()` requests and awaits exactly one bounded frame of at most 512 KiB, preserving
Chromium backpressure without a whole-file XPC result. PDF/audio/video may own multiple concurrent
Range sessions; no global read tail serializes them. Abort, token revoke, replacement and timeout
generation-revoke the exact session, close its handle independently and reject late frames. The
preload rechecks the pinned handle/current identity before successful EOF, so growth and same-size
replacement abort instead of returning a valid old prefix. `HEAD`, error and no-body responses hold
no live body session.

PDF navigates a fresh raw Chromium view to one exact asset URL and uses Chromium's built-in PDF
viewer; the Vue/pdf.js path is retired. The selection grant is rejected before navigation when the
verified file exceeds 100 MiB and its concurrent Range sessions remain identity/size fenced.
Teardown revokes the token, aborts active sessions, removes session handlers, clears session data,
and destroys the view.

HTML uses a separate Main token/router whose opaque URL contains one token plus a contained relative
resource path. Its hidden-preload document grant binds the host, non-reused workspace generation,
selection revision, exact entry-directory identity, exact entry identity and total budget. Every
request is decoded once, contained relative to that pinned directory and opened as a transient
resource session. Entry bytes are capped at 1 MiB, each relative resource at 25 MiB, all accepted
body ranges for the revision are atomically reserved against 100 MiB and never refunded, while HEAD
does not spend that byte budget. The distinct resource-identity table is separately bounded so
zero-byte and HEAD probes cannot grow it without limit.

The registries evict oldest tokens at their bounds and clear on shutdown. Raw HTML responses set a
restrictive CSP and `X-DNS-Prefetch-Control: off`; the raw session rejects remote HTTP(S)/WS/file
requests, awaits a fixed unavailable loopback proxy before load, and sets WebRTC IP handling to
`disable_non_proxied_udp`. Forms, frames, objects, workers, base changes, and unrequested navigation
remain disabled while contained same-document scripts/styles/resources are allowed.

## Settings Contract

```ts
interface OnlyPreviewSettings {
  theme: 'light';
  editorFontSize: number; // integer, 11..24
  wordWrap: boolean;
  showHiddenFiles: boolean; // legacy serialized field; no longer changes tree visibility
  openFilesWithSingleClick: boolean;
}
```

Defaults are `light`, `13`, `false`, `true`, and `true`. A missing setting uses the defaults.
Malformed persisted settings are rejected, logged without values/paths, and recover to these
explicitly authorized defaults. `saveSettings` validates the entire value before one `SettingDao`
upsert and broadcasts the committed snapshot. The legacy `showHiddenFiles` member remains accepted
and serialized for compatibility, but hidden entries are always part of the tree contract and this
legacy value cannot suppress discovery or rebuild the search index. The Setting renderer exposes
no hidden-files row or mutation action; save still carries the complete loaded draft, including the
legacy field, through unchanged. Editor settings update live previews.

The Setting window keeps Preview, Project, and Appearance as a left-hand category list and displays
only the selected category's setting rows in the right pane. Preview is selected initially;
switching categories never mutates or saves the draft. Appearance shows Light as the only MVP
theme. Cancel/Save remain fixed at the bottom, and `Esc` closes without writing. The window is app-specific and
does not depend on Home Settings navigation. Every open request is authorized by the active
standalone content host; the Setting `BrowserWindow` is parented to that `BaseWindow`, centered
within its current bounds, and clamped to the matching display work area instead of restoring an
unrelated saved screen position.

```text
Header
┌──────────────────┬───────────────────────────────────────────┐
│ Preview          │ Preview                                   │
│ Project          │ Editor font size                    [13]   │
│ Appearance       │ Wrap long lines                    [off]   │
│                  │                                           │
│ fixed categories │ selected category scrolls independently  │
└──────────────────┴───────────────────────────────────────────┘
Cancel                                              Save changes
```

Preview contains editor font size and word wrap, Project contains single-click preview, and
Appearance contains the disabled Light-theme row. Exactly one category panel is rendered at a
time. The category rail and global actions stay fixed while the right pane owns any vertical
overflow.

## Agent Skill And Guide

The canonical portable skill is `skills/bitterless-preview/`. It contains `SKILL.md`,
`agents/openai.yaml`, `references/mcp-setup.md`, and `references/tools.md`. Its Codex dependency is
the production stdio MCP server named `bitterless`; DEBUG aliases remain explicit test-only
instances. The skill teaches an agent to call Preview only for an explicit local file/folder or an
artifact it has just produced for the user, to resolve one absolute path without guessing or broad
filesystem discovery, and to treat OnlyPreview as a read-only human inspection handoff.

The production MCP tool catalog adds exactly:

```ts
preview.open({ path: absoluteFileOrFolderPath }) -> { opened: true }
```

The bridge rejects unknown keys, empty/multiline/NUL/relative paths, and overlong values. It calls
the same `openOnlyPreviewAbsoluteTarget` route used by Main-owned OS file-open instead of creating a
parallel window or filesystem path. It never returns or reads file content, lists a directory,
mutates a target, or echoes the absolute path in its success result. Main injects this opener into
the bridge; a missing injection fails explicitly and remains independently testable without
creating Electron windows.

The Shell MenuBar places a Tabler Robot action between Open Folder and Settings. It opens one
non-modal Guide `BrowserWindow` parented to the active standalone `BaseWindow`; repeated clicks
focus the same window. The Guide uses its own `guide` host, exact local navigation fence, sandboxed
shared preload, and stable `onlypreview-guide` window-state key. It restores only saved size, then
centers and clamps against the current parent display on every open. Native close, renderer failure,
parent close, auth invalidation, and host quit all revoke that exact Guide host.

The Guide intentionally has one short surface only:

- eyebrow `LOCAL MCP`;
- title `Copy the skill to your agent`;
- the existing test-instance warning when the current server is not `bitterless`;
- one `Complete setup instructions` copy card with `Copy these instructions to your agent. They
include the skill and MCP setup.`

It does not show the former explanatory MCP-versus-skill paragraph, detailed steps, helper/config
fields, skill path field, installation badge, red dot, or acknowledgement state. At load time Main
ensures the current MCP helper, derives its server/config, resolves the fixed dev or packaged skill
directory, and verifies every required skill file is a readable regular non-symlink file. The Guide
renderer receives only the server name, expected skill version, and one complete English
instruction. That text contains the current MCP config, complete skill directory, Codex/Claude
install destinations, production-versus-DEBUG warning, and new-session guidance. Clipboard access
occurs only after the user clicks the copy card; success/failure/restart-required feedback is
localized. The Guide's renderer-side XPC client is an exact
`Pick<OnlyPreviewApi, 'getAgentSkillGuideInfo'>`; the separate Home launch endpoint is not reachable
through that client or authorized by the Guide token.

Normal package rules exclude Markdown, so `extraResources` copies the complete skill directory to
`Resources/agent-skills/bitterless-preview`. Copying only `SKILL.md` is invalid because the sidecar
and references are part of the installable package. The existing desktop `afterPack` audit rejects
a package when any of those four required files is missing, empty, non-regular, or a symlink.

## File Open Lifecycle

### Application entry

- Register macOS `open-file` before `app.whenReady()`, call `preventDefault()`, and queue the path.
- Helper modes never inspect GUI file arguments.
- In packaged Windows startup, parse the initial process arguments after removing executable and
  Chromium flags. During `second-instance`, inspect that event's argv/working directory.
- Development only accepts an explicit `--onlypreview-open=<path>` test/development argument; it
  must not mistake the repository path or Electron entrypoint for a user file.
- Queue entries are consumed only after the GUI/XPC runtime is ready.
- Opening another file focuses the singleton and replaces its workspace/selection. Multiple
  simultaneous requests are serialized; the latest completed request becomes visible.
- The explicit-target generation is advanced before standalone creation, so newly mounted Shell
  and Preview renderers cannot restore an older directory ahead of the queued file target.

### Packaged associations

`electron-builder.yml` registers the common verified MVP extensions. On macOS it also declares the
generic `public.data` document type with `role: Viewer` and `rank: Alternate`, so Finder can offer
OnlyPreview for files outside the extension list without claiming default ownership. Windows keeps
the common associations and the existing per-machine NSIS installer adds a generic
`*\\shell\\OnlyPreview` `Open in Bitterless` verb; uninstall removes exactly that verb. Runtime
routing accepts any regular file and shows its fallback surface for an unsupported type.

## Home Integration And Omni Exclusion

- Home adds one visible `onlypreview` card and an XPC launch emitter. It uses the existing
  per-card in-flight guard.
- Opening OnlyPreview from Home with a fresh content host restores the last valid directory after
  Core SQLite becomes ready. It restores no file selection; a missing/unavailable candidate keeps
  the ordinary empty Open Folder state.
- Auth invalidation and host quit explicitly destroy the standalone window, Setting/Guide windows,
  views, workspaces, and tokens.
- Omni's typed mini-app allowlist, persisted cell contract, runtime mapping, Control selection,
  renderer preload map, and cell lifecycle must exclude `onlypreview`.
- A persisted Omni leaf with `miniAppId: 'onlypreview'` is unsupported input and follows Omni's
  existing fail-closed layout recovery instead of opening or silently substituting another app.

## Layout And Visual Contract

```text
┌──────────────────────────────── OnlyPreview ─────────────────────────────┐
│ ▣ OnlyPreview  root/path                 Open Folder · Robot · Settings │
├──────────────────────┬───────────────────────────────────────────────────┤
│ PROJECT           ⊕  │ selected/file.ts                    TypeScript   │
│ ▾ workspace-root     ├───────────────────────────────────────────────────┤
│   ▾ src              │                                                   │
│     ▾ components     │ read-only preview surface                         │
│         FileTree.vue │                                                   │
│     App.vue          │                                                   │
│ ━━━━━━━ Index Rail   │                                                   │
├──────────────────────┴───────────────────────────────────────────────────┤
│                                SELECTED 24 CHARACTERS · UTF-8 · 18 KB   │
└──────────────────────────────────────────────────────────────────────────┘

Shift+Cmd/Ctrl+F:

┌──────────────────────── GLOBAL SEARCH ─────────────────────────┐
│ Search filenames and contents…  Contents: [Current directory ▾]│
├ FILES ─────────────────────────────────────────────────────────┤
│ FileTree.vue                         src/components            │
│ photo.png                            assets                    │
├ CONTENTS ──────────────────────────────────────────────────────┤
│ …before [matched text] after…        src/components/FileTree.vue│
├ RESULT PREVIEW ────────────────────────────────────────────────┤
│ selected file head / direct children / file information      │
└────────────────────────────────────────────────────────────────┘
```

- The 32px Shell-owned MenuBar follows the established EyesOnAgents standalone-window pattern:
  Royal Blue background, light identity/action content, one dark bottom divider, compact 27px
  controls, and no decorative shadow. It reuses the visual and process contract, not
  EyesOnAgents-private components, stores, connection state, Domain actions, or always-on-top state.
- The non-interactive MenuBar surface is the drag region. Every action is `no-drag`; double-clicking
  the remaining drag surface toggles maximize. macOS keeps native traffic lights at `{ x: 12, y: 8 }`
  and a 78px left gutter. Windows renders MenuBar minimize, maximize/restore, and close controls.
- `Open Folder` is the only visible picker action. Settings remains icon-only with a localized
  tooltip/accessibility label. There is no visible Open File or Refresh action. Native refresh
  shortcuts remain available for changed content without adding chrome. Hover, active, and
  keyboard-focus states use the same translucent-light treatment as EyesOnAgents; disabled actions
  remain legible.
- The icon-only Tabler Robot action sits immediately before Settings and uses the localized direct
  label `Copy the skill to your agent`. It opens/focuses the parented Guide; it does not mount a
  DOM modal inside Shell, where the sibling native Preview view would cover it.
- Project headers and the status rail never display index status, phase labels, percentages,
  indexed file/item totals, partial-index explanations, or other index copy. The interface does
  not repeat a visible `READ ONLY` badge or status label; the actual editor and content authority
  remain read-only.
- The Project header shows the current workspace's case-preserving `rootName`, truncates only when
  necessary, and exposes the complete absolute path as its title. With no workspace it falls back
  to the localized `Project` label. The MenuBar identity renders `OnlyPreview` followed directly by
  the exact absolute path; it inserts no separator glyph before a POSIX path's own leading slash.
- The status rail conditionally inserts `Selected {count} characters` / `已选择 {count} 个字符`
  before the current file type and size. It stays hidden at zero and truncates as one right-aligned
  metadata group rather than increasing the fixed 25px rail height.
- The Project header has a Tabler crosshair action. It is disabled when no previewed file exists;
  otherwise it clears search, expands the selected file's ancestors, scrolls the corresponding tree
  row to the center, and focuses it without reloading the preview.
- The Project pane has no search/filter input. Its first row is the case-preserving workspace root,
  initially expanded; descendants retain demand-loaded vertical and horizontal tree behavior.
- `Shift+Cmd/Ctrl+F` opens Global Search in the right workspace without replacing the Project tree.
  Files always searches project-wide names and presents every folder before every file. Contents
  defaults to the live Current directory and offers Project scope. Explicit Project-tree selection
  updates that directory even while search is open. Files and Contents are separate collapsible
  groups; keyboard or pointer
  selection updates the bounded bottom result preview. Markdown and static sanitized HTML use lazy
  adapters, ordinary text stays plain, directories show direct children with 13px semibold names,
  and non-text results show file information only. The exact layout, token, preview, and
  open-vs-select behavior is defined in the Global Search design.
- Global Search indexing, pending, empty, no-match, error, and memory-advisory states use the
  existing quiet Project/status treatment; they do not add cards, indexed totals, verbose limit
  explanations, or a second visual theme.
- The MenuBar stays in the Shell renderer process. Capability-scoped typed XPC methods request
  minimize, maximize/restore, or close from Main; the Preview renderer never owns window chrome.
- Light-only canvas `#F6F7FA`, white preview surface, divider `#D9DDEA`, text `#25283A`, muted
  `#6F7487`, and canonical Bitterless Royal Blue `#4E5882` for focus/selection/Index Rail.
- UI uses platform system fonts at compact 12-13px sizing. Code uses `JetBrains Mono`, then
  `SFMono-Regular`, `Consolas`, and generic monospace fallbacks.
- Markdown uses the same system body family in a centered reading column no wider than 860px, with
  restrained heading rhythm, Royal Blue blockquote/link accents, bordered tables, and monospace
  code blocks. It is a document-reading surface inside the existing white Preview canvas, not a
  second card/dashboard theme.
- The Shell Preview toolbar is a fixed 43px utility strip: file identity/path on the left and type
  plus native actions on the right. The relative path truncates first at narrow widths. A raw HTML
  document controls its own content presentation below that strip; it cannot cover or replace the
  Shell toolbar.
- The 2px Index Rail sits at the bottom edge of the Project directory pane and is the single
  signature motion. The counting phase uses an indeterminate Royal Blue sweep; the indexing phase
  uses a determinate fill from `completed / total`. It has an accessible non-visible label, renders
  no visible text or number, reserves no space when idle, disappears immediately after the current
  build settles, and respects `prefers-reduced-motion`.
- Structural and repeated elements carry stable `name` attributes and `onlypreview`-rooted BEM
  classes with sibling Less files. No Tailwind utilities.
- Each column owns its scroll; root/grid children use `min-width: 0` and `min-height: 0`. The Project
  tree viewport owns both axes. Tree rows are at least the viewport width and expand to their full
  indentation-plus-name width, so deep single-line names are not ellipsized and become reachable
  with horizontal scrolling. Horizontal and vertical Project-tree scrollbars are both exactly 8px,
  with a transparent track/corner and no separating rule. The header stays fixed and horizontal
  position is not persisted.
- The 5px resize hit target remains operable at 800×600 but has no visible border, center rule, or
  contrasting fill. Main clamps reported and resized content bounds to the 32px MenuBar plus 43px
  Preview toolbar, minimum 180px project column plus the functional 5px hit target, and 25px status
  rail, so a compromised or stale Shell cannot let a native content view cover Shell controls.

## Interaction Contract

| Input                            | Scope                                       | Behavior                                                                                                                |
| -------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `Alt+1`                          | Shell                                       | focus Project tree                                                                                                      |
| `Shift+Cmd/Ctrl+F`               | Shell or Preview                            | open Global Search in the right workspace at the current explicit directory and focus its input                         |
| Contents scope selector          | Global Search                               | switch Contents between the live Current directory and Project; Files remains project-wide                              |
| `ArrowUp` / `ArrowDown`          | Global Search                               | move across visible Files and Contents result rows and refresh the bottom preview                                       |
| click / `Enter`                  | Global Search result                        | select the row and show its bounded file-content preview from the beginning without changing the main Preview selection |
| double click / `Cmd/Ctrl+Enter`  | Global Search result                        | open a file, or expand/select/center-focus a directory in Project; close only after success                             |
| `Space`                          | selected file in tree                       | preview selected file                                                                                                   |
| single click                     | tree row outside directory arrow            | select the row; preview a file only when enabled; update live Current directory without toggling a directory            |
| double click                     | tree row outside directory arrow            | preview a file or keep a directory selected while toggling its expansion exactly once                                   |
| single click                     | directory arrow hit target                  | select/focus that directory as Current directory and toggle its expansion exactly once                                  |
| crosshair                        | Project header                              | reveal and focus the currently previewed file in the tree                                                               |
| right click                      | Project file/directory row                  | open the type-specific Main-owned native reveal/copy/file-action menu at the pointer                                    |
| `Cmd/Ctrl+C`                     | focused Project item, outside text controls | copy the file or folder as a pasteable native filesystem item                                                           |
| `Shift+Cmd/Ctrl+C`               | focused Project item, outside text controls | copy its canonical absolute path as plain text                                                                          |
| `Option/Alt+Cmd/Ctrl+C`          | focused Project item, outside text controls | copy its basename as plain text                                                                                         |
| Robot                            | MenuBar                                     | open or focus the parented `Copy the skill to your agent` Guide                                                         |
| copy card                        | Guide                                       | copy one complete English MCP-plus-skill setup instruction                                                              |
| `Cmd/Ctrl+O`                     | Shell or Preview                            | Open Folder                                                                                                             |
| `Cmd+,` or `Ctrl+Alt+S`          | Shell or Preview                            | open Setting window                                                                                                     |
| `F5` or `Cmd/Ctrl+R`             | Shell or Preview                            | reconcile the background file-search index and refresh selected preview                                                 |
| `F12`                            | Shell or Preview, debug profile             | toggle detached DevTools for the view that received the shortcut                                                        |
| `Cmd+Option+I` or `Ctrl+Shift+I` | Shell or Preview, debug profile             | toggle detached DevTools for the view that received the shortcut                                                        |
| `Cmd/Ctrl+F`                     | Shell, Vue Preview, or raw Chromium         | focus the one Shell Find Bar for the current file; never invoke Global Search or Monaco's own find widget               |
| drag/select text                 | Monaco or Markdown                          | show the selected grapheme count in the bottom status rail; hide it when selection collapses or leaves preview content  |
| `Esc`                            | Find Bar / Global Search / Setting          | clear current-file find and restore content focus / clear query then close Global Search / close Setting without save   |
| double click                     | non-action MenuBar surface                  | toggle maximize/restore                                                                                                 |
| minimize / maximize / close      | Windows MenuBar controls                    | control the current standalone `BaseWindow` through Main                                                                |

Window-wide shortcuts use `before-input-event` on OnlyPreview webContents so they remain available
when Monaco has focus. Only matched commands prevent default; Monaco retains selection, copy, and
all other unmatched editor behavior. On the initial successful Preview-view load, a normal debug profile automatically
opens that Preview `webContents` DevTools detached with `activate: false`; Shell, Settings, Guide,
release, and isolated E2E never auto-open. Manual DevTools shortcuts remain Main-owned and target
only the Shell or Preview `webContents` that received the input. The same shortcut closes
that view's open DevTools. Auto-repeat is ignored.

Task 030 is `implemented; owner verification pending` after
[independent review 1](../plan/reviews/onlypreview-project-search-shortcut-030-1.md) recorded
**PASS** with no P0-P2 finding. The review confirms both Project Search aliases reuse the same
Main-owned route and that plain current-file Find remains separate; only Ral's live shortcut check
across Shell/Vue/Chrome remains. Task 037 supersedes this presentation and removes the Option/Alt
alias while retaining the reviewed host-wide routing boundary.

Task 031 is `implemented; owner verification pending` after
[independent review 1](../plan/reviews/onlypreview-filter-directory-reveal-031-1.md) recorded
**PASS** with no P0-P2 finding. The ordinary filter keeps only clicked reveal roots plus their
ancestor cleanup index, admits each loaded candidate through O(path depth) `Set.has()` checks, and
does no recursive load or row-by-root scan. Only Ral's large-tree pointer/keyboard verification
remains. Task 037 removes this now-historical Project filter/reveal surface entirely.

Task 034 is `implemented; owner verification pending` after
[independent review 3](../plan/reviews/onlypreview-selected-file-index-priority-034-3.md) recorded
**PASS**. The selected-file lane is latest-only and bounded to one complete in-memory row, applies
the same depth/admission policy before I/O, cannot poison later search after an internal failure,
and never exposes partial candidate rows. Ral's remaining check is the task's fresh-large-directory
owner verification.

Tasks 035–037 are `implemented; owner verification pending`. Task 035 makes unknown, extensionless,
backup, and compound-extension files bounded inert plaintext only after known specialized adapters
win; [review 2](../plan/reviews/onlypreview-small-unknown-text-fallback-035-2.md) records **PASS**.
Task 036 supplies independently capped Files/Contents data and latest-request token-only result
previews; [review 2](../plan/reviews/onlypreview-global-search-data-preview-036-2.md) records
**PASS**. Task 037 delivers the rooted Project tree and right-workspace Global Search; its
[review 2](../plan/reviews/onlypreview-global-search-workspace-037-2.md) closes all focus/state/dead
surface findings with no remaining P0–P3 issue. Ral's remaining work is the real-app keyboard,
format, large-directory resource, locator, and file-association verification in the cutoff baseline.

## State And Error Contract

- **Empty:** the Open Folder action and shortcut are available; no Open File action is shown.
- **Counting index:** keep loaded directory listings browsable and show only the indeterminate
  Project-bottom Index Rail.
- **Indexing:** retain the last valid directory-name tier and search database, keep browsing
  available, and show only the determinate Project-bottom Index Rail. Hide it as soon as the current
  generation settles.
- **Search while indexing:** query the last complete active snapshot immediately without exposing
  candidate rows. Warm Files and Contents batches may appear before startup reconcile completes;
  successful promotion reruns the same request and terminal-replaces rows/tokens from the fresh
  snapshot. Legacy snapshots without a valid tree marker omit warm folders. A manually opened file
  may also publish from the bounded complete one-file priority lane. If no complete index exists, a
  same-policy Current directory scan may stream Contents, while project-wide Files and the terminal
  response wait for the existing candidate promotion. Build progress never clears or cancels
  accepted search results.
- **Index partial:** keep directory browsing complete and expose no visible partial state,
  explanation, count, or warning.
- **Global Search pending:** retain the last accepted grouped result set until the latest throttled request
  returns; stale or cancelled batches cannot replace it.
- **Global Search scope:** Contents defaults to the live explicit Current directory and may switch
  to Project; Files stays project-wide. Explicit Project-tree selection refreshes directory-scoped
  Contents, while focus and clicked search results never derive a new directory.
- **Global Search execution:** Files and Contents advance cooperatively within one leased snapshot;
  promotion waits for readers and terminal settlement waits for both. Files uses one stable
  folders-then-files partition before its cap; a directory row displays `folder` from `nodeKind`,
  never its internal unknown media type.
- **Global Search no result:** preserve the Files and Contents group labels and show one compact
  localized empty state within each empty group.
- **Global Search result preview:** keep the previously accepted preview until the latest result-token
  request settles. Invalid/stale tokens fail closed. Unsupported/non-text files show filename,
  relative directory, media type, size, and icon without reading their bodies.
- **Index memory advisory:** runtime strictly above 1GiB may show/log one aggregate optimization
  advisory; strictly above 2GiB sets `performanceAccepted=false` and keeps `stop=false` for the next
  iteration without invalidating the benchmark artifact or method. Neither value includes the
  separately reported SQLite disk footprint, and no file/path/content is logged.
- **Loading preview:** retain stable bounds and show a quiet progress state.
- **Current-file find pending:** the one Shell input and close action remain available so a draft
  query can queue; case/navigation stay disabled and no false `0/0` is rendered. Exact ready
  dispatches that queued query once.
- **Current-file find unavailable:** image/audio/video/unsupported/oversize/render failure do not
  open the bar; Shell shows one compact reason. Close/Esc/selection/workspace/reload/crash clears
  native selection or the model highlight before a new capability can report.
- **Current-file find delivery:** task 019 is `implemented; owner verification pending` after
  [independent review round 2](../plan/reviews/onlypreview-find-in-file-019-2.md) recorded **PASS**.
  Ral's remaining real-app checks are the task's
  [Owner Verification checklist](../plan/tasks/onlypreview-find-in-file-019.md#owner-verification).
- **Missing/permission denied:** distinguish `PATH_NOT_FOUND` from `PATH_PERMISSION_DENIED`; the
  latter uses the user-facing message “Bitterless does not have permission to read this file or
  folder.” without referring to a removed visible Refresh action.
- **Too large:** show file metadata and the 8 MiB text limit; do not show partial text.
- **Unsupported:** show metadata plus a primary in-page Open in default app action; Reveal in folder
  remains in the Shell toolbar.
- **Typed Preview failure:** direct unsupported plus image/media/Office/parser/signature/empty/size
  unavailable states reuse the same compact content metadata block: file name, localized type or
  extension, size, and modified time. The exact failure reason stays above it. Every file-backed
  metadata failure state mounts one primary Open in default app recovery action, while Reveal and
  the complete native `FileActions` group remain only in the Shell toolbar.
  [Task 078](../plan/tasks/onlypreview-unsupported-default-app-078.md) supersedes only Task 025's
  earlier content-surface action-placement decision; its unified relative-only metadata contract
  remains authoritative.
  [Task 025's completion audit](../plan/reviews/onlypreview-design-completion-025-1.md) recorded
  **PASS** for this relative-only descriptor and unified metadata contract. Both OnlyPreview designs
  are therefore closed at the documented non-E2E implementation level; the ledger is
  `implemented; owner verification pending`, with only Ral's real-app/runtime/visual verification
  remaining.
- **Native Project item menu:** ordinary file rows expose Preview/Open/Reveal, pasteable Copy File,
  Copy Path, Copy Relative Path, Copy Name, and a separately grouped `Delete…`; directory rows expose
  Reveal plus Copy Folder/the three text-copy actions, but never recursive Delete. Main opens the menu
  and every confirmation/error dialog with
  the active OnlyPreview `BaseWindow` as owner, so they can extend beyond the Shell child view.
  Copy Path resolves the canonical absolute path only inside the hidden preload and returns it only
  to Main's private native-action call, which writes it directly to the system clipboard; the
  renderer receives no path result. Project-item copy uses a bounded native OS
  clipboard adapter so Finder/Explorer receives a pasteable file/folder reference without reading
  file bytes. Project-tree/search-result shortcuts are active only for a focused item outside
  editable controls, preserving ordinary text copy everywhere else. Delete is never exposed as a
  renderer filesystem API: Main validates the host/workspace ref, asks the hidden preload to prepare
  one opaque regular-file identity grant, then shows the explicit destructive confirmation with
  Cancel as default. Cancel revokes the grant; confirmation asks the preload to atomically isolate
  the directory entry in a high-entropy same-parent private quarantine, recheck its pinned identity
  and active generation, then unlink only that matching isolated entry. A mismatch is restored only
  by a no-overwrite hard link or retained for recovery; it never overwrites a concurrent candidate
  or copies a potentially large file. Main never opens or unlinks the target, and
  directories/recursive removal remain forbidden. Success clears selection/Preview only when the
  deleted file was selected; failure leaves
  current state intact and discloses no absolute path. Task 029 is
  `implemented; owner verification pending` after two independently found selection-generation
  races were corrected and
  [independent review 3](../plan/reviews/onlypreview-permanent-delete-029-3.md) recorded **PASS**
  with no P0-P2 finding. Electron/Playwright and live clipboard/delete operations remain
  intentionally unrun; Ral owns the task's
  [real-OS acceptance checklist](../plan/tasks/onlypreview-permanent-delete-029.md#owner-verification).
- **Media/PDF error:** preserve toolbar identity/actions and explain that Chromium codec/content
  support failed. A content crash does not close the Shell; it publishes a recoverable unavailable
  state under a newer revision.
- **Office error:** distinguish parser/empty/timeout failures from host-viewer failures
  (`SHEET_RENDER_FAILED`, `DOCUMENT_RENDER_FAILED`, `PRESENTATION_RENDER_FAILED`) and existing
  byte/signature/ZIP admission errors. Preserve Shell file identity/actions, never retain a partial
  viewer, and fence an old timer or renderer result from changing a newer revision/view.
- **Draw.io error:** distinguish oversize admission, `DIAGRAM_EMPTY`, `DIAGRAM_PARSE_FAILED`,
  `DIAGRAM_LIMIT`, and `DIAGRAM_RENDER_TIMEOUT`. `DIAGRAM_LIMIT` also truthfully covers the phase-one
  rejection of image-bearing graphs. Worker/viewer failures never mount a partial graph; Shell
  identity/actions remain available, and an old Worker, callback, watchdog, or viewer result cannot
  change a newer revision/runtime.
- **Stale async result:** ignore any result whose host/workspace/request generation is no longer
  current; the coordinator starts only the latest pending query after the active request exits.
- **Hidden item:** dot files/directories remain visible in the tree. A sensitive file such as `.env`
  remains explicitly previewable and filename-searchable where its scope permits, but its body is
  title-only and never enters the content index.
- **Selected file changed:** after the final 400ms-trailing committed watch revision, automatically
  rerender that file if it is still selected; stale reads and prior selections/workspaces cannot
  install, and delete/recreate progresses through typed missing then the newer content.
- **Unavailable recent directory:** a missing, invalid, non-directory, or unreadable stored
  candidate is CAS-cleared to `null` and returns the empty state without exposing its path.
- **SQLite unavailable:** recent-directory restore returns `null`; explicit folder and OS file
  targets still open normally, and no retry loop blocks the standalone window.
- **Guide unavailable/stale:** show a restart-required state instead of leaving a permanent loading
  indicator; a failed clipboard write shows a local error and never reports success.

Required/unknown variants and invalid inputs fail with an explicit typed contract error. Optional
missing restoration returns `null`. Defaults/fallbacks are allowed only where this document names
them.

## Security And Privacy

- Shell, Vue Preview, Setting, and Guide all use `sandbox: true`, `contextIsolation: true`,
  `nodeIntegration: false`, `webSecurity: true`, exact local navigation fencing, and no `<webview>`.
- The search-bootstrap token stays private in Main and is never passed in preload `process.argv`,
  copied to `contextBridge`, visible renderer state, logs, or a result. Main validates the
  host/workspace and sends absolute root/database paths only inside the private capability-bound
  file-search XPC initialization request. The hidden preload returns only relative metadata and
  aggregate telemetry.
- Project native actions use a third pairwise-distinct preload capability bound to the exact hidden
  runtime instance and workspace generation. Main accepts no renderer-supplied absolute path and
  performs no Project `lstat`/`realpath`/`stat`/`open`/`unlink`; it consumes a strictly validated
  private authorization result only for the immediate native effect. Prepared Delete grants are
  bounded, one-shot, pin a read-only handle, use same-parent quarantine isolation and are actively
  revoked on cancel, rebind, runtime replacement, timeout, unload, or host close. Portable Node has
  no unlink-by-handle primitive, so this contract covers ordinary replacement races and an untrusted
  renderer; it does not claim absolute protection from a hostile same-UID local process that can
  discover and replace the private quarantine entry itself.
- Office uses a separate unguessable preload capability and one-shot grant. Main validates only the
  in-memory host/runtime/selection/adapter and performs no `fs` open/stat/realpath/read/stream or
  Office parsing. The hidden preload owns containment, identity and the asynchronous bounded read;
  the visible bridge has
  no arbitrary path method and returns only the exact current revision's bytes or a typed error.
  Reads are single-generation, capped at 25 MiB, `O_NOFOLLOW`, regular-file/containment checked and
  identity checked before and after. Existing XPC structured-clones results through its Main broker,
  so the preload uses serial bounded frames rather than one whole-file response; parallel reads and
  stale full-buffer retention are forbidden.
- Never give arbitrary web content an OnlyPreview preload. Raw HTML/PDF receives no preload,
  `additionalArguments`, host/runtime token, XPC, Node, or Electron API, and never shares the
  Bitterless application session.
- Every HTML/PDF revision uses a new raw view on the one dedicated persistent partition
  `persist:onlypreview-chrome`. Chromium renders a PDF through its PDF viewer component extension,
  which never creates its document frame in an in-memory session, so this partition must stay
  persistent — and must stay a single constant name, because each distinct `persist:` name leaves a
  `userData/Partitions/<name>` directory behind. Session hardening is installed once and is never
  removed by a per-selection teardown. Revision isolation comes from the session-scoped protocol
  handlers, which expose only that revision's exact asset or canonical-entry-contained document
  resources, are generation-guarded so a late teardown cannot unhandle a newer revision, and are
  removed with all streams/tokens revoked before the view is destroyed; the session's connections,
  storage, and cache are discarded whenever no raw view is mounted on it.
- A PDF is served through the same session-scoped custom protocol as other assets. Main validates
  the token and Range contract but receives no path or handle; the hidden preload opens and
  re-verifies the admitted range and supplies pull-driven bounded frames. Concurrent Chromium Range
  sessions are independent and remain selection-generation fenced.
- `chromium-pdf` becomes `ready` only once the viewer's own document frame exists at the navigation
  URL. A finished navigation alone is not readiness — a blank viewer also finishes loading — and a
  bounded wait that never sees the frame publishes `PDF_VIEWER_UNAVAILABLE`.
- Raw HTML may execute inline and contained relative code, but remote network is denied by request
  filtering, response CSP, disabled DNS prefetch, an awaited unavailable proxy, and restricted
  WebRTC IP policy. Permissions, popups, downloads, redirects, `file:`, traversal, encoded
  separators, symlink escape, and forms/frames/objects/workers remain denied.
- Public presentation snapshots and events never contain an asset/document URL. Events are
  host-only nudges; Shell refetches a public snapshot, and only the exact current runtime-token-bound
  Vue renderer can refetch its media asset URL. No renderer-authored revision is trusted.
- Project-content operations are capability-scoped. No broad filesystem API is exposed. Main does
  not open, read, buffer, stream or mutate potentially large project files; the hidden file-search
  preload opens only contained workspace-relative search paths, Project-authorized native-action
  targets, exact current Office grants, or exact non-Office selection/source sessions, and keeps
  its persistent database below application user data. Existing small bounded window-state,
  settings, shim and logging persistence remains in Main. The only project mutation is the
  separately confirmed, identity-fenced Project Delete contract above. The final data-path audit
  and [independent review](../plan/reviews/onlypreview-main-fs-boundary-audit-087-1.md) passed with
  no P1, P2 or P3 finding.
- The file-search SQLite database is deliberately plaintext. It never requests or inherits the
  Core SQLite/SQLCipher key, and its database/WAL/SHM files rely only on the user's local OS file
  permissions. This exception applies only to the rebuildable search index; it does not downgrade
  encrypted Core/Todo/customer databases.
- Sensitive credential-like files (`.env`, `.env.*`, `.npmrc`, `.netrc`, `*.pem`, `*.key`) remain
  explicitly previewable through the existing selected-file capability but are title-only in
  Global Search unless a future reviewed contract states otherwise. Their bodies are not added to
  the content index.
- `preview.open` accepts one explicit absolute target and delegates to the same read-only Main open
  route. It exposes no content/list/write method and returns no path.
- The Guide renderer receives only the server name, one English instruction, and its expected version. It has a
  dedicated role and cannot call content, settings, external-open, native-menu, or window-control
  methods. Clipboard access requires an explicit click and is not exposed through preload.
- No file contents or absolute user paths are written to application logs.
- OnlyPreview search diagnostics additionally forbid queries, snippets, file/directory names,
  relative paths, workspace/config identity, database paths, exclusion rules, capabilities/tokens,
  and raw errors or objects. Only fixed enums/booleans, bounded aggregate counts, generations/build
  revisions, short local correlation tags, sanitized error codes, and elapsed milliseconds are
  allowed.
- Search memory/status logging is aggregate-only. Runtime memory and SQLite disk footprint are
  measured and labelled separately; they are never added together.
- The one persisted recent-directory absolute path remains private inside Core SQLite. It is never
  broadcast, logged, or accepted back from a renderer, and carries no file selection or capability.
- Media tokens are high entropy, bounded, revocable, and never persisted. Audio/video authority is
  selection-lived for long seek; image source authority is one-shot and revoked once the renderer's
  bounded Blob is ready or any terminal failure occurs.
- DOCX output is untrusted even though it came from an app-owned renderer. Only sanitizer-approved
  detached DOM/CSS and verified embedded-image blob URLs enter the live document; macros, OLE,
  altChunk HTML, navigation, remote resources, and custom/file URL schemes never do.
- The Content Security Policy is the first element in each built `<head>`. Its exact SHA-256 allows
  only Monaco's generated inline bootstrap, whose worker URLs resolve from nested OnlyPreview
  entries to the built root `monacoeditorwork` directory.
- The feature does not restore the removed historical broad filesystem window.
- Only the `debug` runtime profile automatically opens Preview DevTools. Release profiles never
  auto-open or register the Shell/Preview shortcuts. The unpackaged-only `BITTERLESS_E2E=1`
  harness may enable manual shortcut verification but explicitly suppresses auto-open; packaged
  startup rejects that harness mode.
- Every macOS full-application E2E launch must place Chromium's `--use-mock-keychain` switch before
  the application path. An unpackaged `BITTERLESS_E2E=1` Main process fails before GUI startup when
  that switch is absent, so automated verification cannot read or prompt for the user's Keychain.

## Verification Contract

- Unit tests cover settings parsing, result-envelope preservation, host/workspace/media ownership
  and revocation, extension/signature/text classification, traversal bounds, ignore rules, natural
  sorting, path traversal, root/child replacement escapes, devices, missing versus permission
  errors, size limits, exact asset URL parsing, active stream revocation, and manual Range response
  semantics. Region/document behavior tests additionally cover first-bounds gating, mutually
  exclusive surfaces, transition/crash/load cleanup, delayed-proxy races, runtime-token/revision
  fencing, forged presentation nudges, public/private URL disclosure, canonical-entry symlink
  containment, same-size replacement, real growth/replacement during streaming, and consumer-body
  abort on revocation.
- Office unit/source tests cover all three adapter IDs and extensions, each format's required OOXML
  part, preflight-before-import, ArrayBuffer transfer, the 10-second Worker timeout, the three exact
  dynamic subpath imports/viewer constructors, host-2D/offline/resource options, typed
  parse/empty/render/render-timeout failures, lifecycle destruction, current runtime/revision fencing, and
  `findText` plus next/previous/clear with persistent all-match/active highlighting. Production
  build audit proves the engine and per-format WASM/worker assets remain outside the initial Vue
  chunk.
- Current-file find behavior/source tests cover the exhaustive registry, exact parsers, pending
  queue and one-time ready dispatch, native Electron option mapping, requestId plus WebContents
  generation/selection/find-revision fences, destroyed/throw failures, exact content-adapter ready
  handshake, stale result rejection, XLSX partial truth, rapid Shell draft races, a Main snapshot
  arriving during IME composition, narrow Preview panes, and an 8MiB dense Monaco model with
  complete count but at most one decoration and no editor selection mutation. The Monaco suite also
  covers length-changing Unicode case folding (`İx` / `x`) and verifies the active range stays on the
  original model.
- Image/media unit and real-SFC jsdom tests additionally cover exact supported/recognized-
  unsupported catalogs, empty-before-signature admission, SVG/AAC/MOV signature variants, image
  GET length/body/decode failures, Blob URL revoke-once and stale revision fences, responsive fit/
  zoom/reset/pan accessibility, media HEAD and CORS-visible Range truth, the metadata deadline,
  `MediaError` mapping, post-ready demotion, exact teardown order, and default-TTL versus
  selection-lifetime asset revocation. Source build audit confirms no decoder/player engine was
  added.
- Search unit tests cover private bootstrap ownership, Main zero-search-I/O, strict scope parsing,
  early complete root listing, opaque directory-token ownership/generation fencing, complete
  per-directory browsing independent of Global Search exclusions and bounds, directory-anchor
  precedence, root scope, pre-I/O excludes, symlink/containment, visible dot items, In Project
  hidden-directory exclusion, explicit hidden In Directory, root hidden files, media classification,
  tolerant UTF-8/BOM UTF-16 decode with size-first body limits, persistent schema/reopen, filename-tier hydration,
  content-defined boundary matches, trigram/CJK and short-query strategies, NFKC plus literal
  verification, exact file-only result shape, title/content merge, grapheme 16/48 snippets,
  exact result-cap truncation, direct-child-before-descendant traversal, transaction-safe
  upsert/delete, legacy-schema recovery, stat/read-race full reconciliation, 400ms watch trailing
  reconciliation, selected-Preview rerender, bounded monotonic build progress, and separate
  runtime/disk telemetry.
- Runtime/coordinator tests use fake time and isolated engine fixtures to cover fixed 120ms
  leading-plus-trailing behavior, IME composition, scope changes, one-active/one-latest single
  flight, active cancellation, final query/scope exactly once, bounded batches, and stale
  host/workspace/request/build-revision/browse-token/watch fences.
- Search diagnostics tests use fake monotonic clocks and captured string writers to cover startup
  phase ordering, reusable-index assessment, build-gate wait, first Files/Contents visibility,
  terminal/cancel/failure behavior, fixed log-count bounds, and forbidden-field exclusion.
- Router tests cover macOS early `open-file`, packaged Windows initial/second-instance argv, helper
  exclusions, development explicit arguments, and serialized queue behavior.
- Recent-directory tests cover schema parsing, ready/failure latching, pre-ready latest-write
  flushing, CAS conflict/stale-generation handling, invalid-candidate CAS clear, per-host
  restore single flight, Region presentation/clear routing, host cleanup, and an explicit OS target
  winning a late restore.
- Source/integration tests cover the four first-party visible renderer entries plus the invisible top-level
  `fileSearch` entry, official preloads, no UtilityProcess build entry, sandboxed
  Shell/Vue Preview/Setting/Guide preferences, the raw Chromium no-preload boundary, the background preload's bounded sandbox
  exception, private Main-only bootstrap, capability-bound XPC transport, bounded pending rejection
  on cancel/timeout/exit,
  whitelisted host-bound snapshot/browse/progress/watch relay, and the absence of a Main browse or
  index-build path,
  one active Region content view and cleanup, hidden titlebar/traffic-light/window-control wiring, Vue Preview-only
  initial debug DevTools auto-open plus detached manual shortcut wiring, workspace identity labels,
  exact 32px Preview offset, Home card, auth/quit cleanup, log policy, i18n registration, and the
  absence of OnlyPreview from Omni's allowlist/runtime/UI mapping.
- Agent-skill tests cover the complete portable directory, sidecar dependency, dev/packaged
  resolution, non-symlink file checks, English setup instruction, packaged resource copy,
  `preview.open` validation/dispatch, composition-root opener injection, exact success envelope,
  narrow Guide role, MenuBar action, singleton parent/bounds/teardown, one-card UI, and the absence
  of user paths or file contents from the Guide response.
- Native chrome acceptance completely exits the current Electron Main and launches a fresh Main;
  renderer HMR cannot verify creation-time `BaseWindow` options. Electron E2E compares native
  window/content bounds for zero titlebar origin or height gap and requires the top-middle band of
  each native capture to contain a majority of OnlyPreview Royal Blue `#4E5882` pixels.
- Renderer verification covers stale-result suppression, read-only Monaco options and disposal,
  synthetic-root/dot row visibility, explicit tree Current directory, Contents directory/Project
  scope switching, project-wide Files,
  independent Files/Contents groups, keyboard/pointer selection, bounded lazy result-preview
  adapters, info-only non-text rows, watch-selected Preview reload, complete demand-loaded browsing,
  current-build progress fencing, the 2px no-copy Project-bottom rail,
  indexing/search/error/memory states, tree/preview/settings states, intrinsic-width horizontal tree
  scrolling, direct-HTML/built-in-PDF versus Vue routing, Markdown sanitizer boundaries, Shell
  toolbar/content-host BEM/name markers, and keyboard routing.
- Canonical PRODUCT-P01 remains immutable history for the earlier hidden-inclusive physical corpus
  and deleted preload-Worker boundary; it is not current-policy acceptance. The dual-index,
  hidden-pruned runtime requires a new canonical PRODUCT-P02 point, which has not run.
  PRODUCT-P02 covers the bundled product core in a fresh Node child; hidden file-search renderer
  startup, Main XPC relay, Shell scheduling, Preview commit, and packaged startup remain
  outside that artifact and require the targeted Electron/build acceptance below.
- Earlier UtilityProcess integration build acceptance has `yarn build` PASS, emitting all five
  renderer HTML files, `out/preload/onlypreview.js`, `out/preload/onlypreviewContent.js`, and
  `out/main/onlypreviewSearchUtility.js` through official Electron Vite inputs. It is historical
  evidence only; task 017 must replace it with `fileSearch` renderer/preload build evidence.
- Earlier Electron acceptance has `yarn test:e2e:onlypreview` PASS (7/7) for the then-current single
  Vue Preview topology with its 43px DOM header. It is historical evidence and does not verify the
  Shell toolbar or dual Region. Task 024 updated the E2E fixture/spec source contract but did not
  launch Electron; Ral retains final runtime/visual acceptance.
- Recent-directory restart behavior is verified in Electron/Node unit tests with simulated storage
  lifecycle and fresh host instances. Full-application Electron E2E may verify restart and explicit
  OS-target override only through the shared isolated launch-argument builder; on macOS that builder
  supplies `--use-mock-keychain`, and Main rejects an E2E launch that omits it. Owner manual
  verification remains the final acceptance of behavior in a normal application profile.
- Packaged release build/startup remains untested. Packaged manual verification is still required
  for OS association registration and the actual Chromium codec matrix on macOS and Windows.
