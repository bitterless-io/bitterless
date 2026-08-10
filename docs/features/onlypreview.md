# OnlyPreview Sub-Application

Status: Accepted

## Purpose And Boundary

OnlyPreview is Bitterless's read-only local-file workbench. Its visible picker opens one directory,
the user navigates a bounded project index on the left, and the selected file is previewed on the
right without leaving Bitterless. Main-owned operating-system file-open routes may still target an
individual file and derive its containing workspace. The first delivery is optimized for source
code, text, PDF, image, audio, and video files used in development and ordinary desktop work.

OnlyPreview owns local file discovery, a persistent incremental search index, preview
classification, read-only rendering, its app-specific preferences, and the standalone window
graph. Search traversal, searchable content reads, SQLite indexing, watch reconciliation, and
queries run only in a dedicated Electron `UtilityProcess`; Electron Main validates capabilities,
privately enriches initialization with bootstrap paths, supervises the process, and performs a
bounded XPC relay without search I/O. OnlyPreview never edits, writes, creates, renames, moves, or
deletes user files. Unsupported local files still open to an explicit metadata surface with an
action to use the system application.

The public identity is `OnlyPreview`; stable code IDs, renderer directories, setting keys, and
window-state keys use `onlypreview`.

The product-level rationale and visual direction live in
`areas/only-preview/feature-design.md` in the private overmind parent. This document is the
implementation contract inside Bitterless and contains no private user data.

## Ownership

| Concern                                                                                      | Owner                                                                       |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Home card and launch action                                                                  | Home Mini Apps renderer                                                     |
| OS file-open queue and first/second-instance routing                                         | `app.main.ts` + OnlyPreview open router                                     |
| Standalone `BaseWindow`, child view bounds, Setting/Guide windows, cleanup                   | OnlyPreview window handler/helper                                           |
| Per-view host, search-bootstrap, workspace, and media ownership                              | Main OnlyPreview capability registries                                      |
| Workspace capabilities, selected-file containment, descriptor, preview text reads            | Main OnlyPreview file service                                               |
| Project traversal, media classification, filename tier, full-text SQLite, watch/update/query | dedicated OnlyPreview search `UtilityProcess`                               |
| Last canonical directory persistence and restore ordering                                    | Main OnlyPreview recent-directory service + Core SQLite `setting` table     |
| Media/PDF byte streaming                                                                     | Main token registry + manual Range-capable `bitterless-preview://` protocol |
| Tree, local filter, Project Search input/results, keyboard commands, selection               | OnlyPreview Shell renderer                                                  |
| Code/PDF/image/audio/video/unsupported presentation                                          | shared OnlyPreview Preview surface                                          |
| Monaco model/editor lifecycle                                                                | Preview surface                                                             |
| Preferences                                                                                  | Main handler backed by `SettingDao`                                         |
| Window geometry                                                                              | existing `windowStateService`                                               |
| Portable agent skill, setup Guide, and read-only agent open                                  | OnlyPreview skill service + local MCP bridge                                |

## Window And View Composition

### Standalone

```text
┌──────────────────────────── BaseWindow ───────────────────────────────┐
│ Shell WebContentsView                                                │
│ ┌──────────────────────────────────────────────────────────────────┐ │
│ │ 32px Royal Blue MenuBar + platform window controls              │ │
│ ├──────────────────────┬───────────────────────────────────────────┤ │
│ │ local filter/tree or │ preview host placeholder                  │ │
│ │ Project Search files │                                           │ │
│ │                      │                                           │ │
│ ├──────────────────────┴───────────────────────────────────────────┤ │
│ │ Index Rail / status                                              │ │
│ └──────────────────────────────────────────────────────────────────┘ │
│                        ┌────────────────────────────────────────────┐ │
│                        │ PreviewHeader WebContentsView · 43px      │ │
│                        ├────────────────────────────────────────────┤ │
│                        │ PreviewContent WebContentsView            │ │
│                        │ sandboxed, preview rendering only        │ │
│                        └────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘

Main capability/XPC supervisor ── raw parentPort ── search UtilityProcess

┌──────────────────── BrowserWindow ────────────────────┐
│ OnlyPreview Setting renderer                          │
└───────────────────────────────────────────────────────┘

┌──────────────── parented BrowserWindow ───────────────┐
│ Copy the skill to your agent                          │
└───────────────────────────────────────────────────────┘
```

- The Shell is added first and covers the content bounds. PreviewHeader is added second and
  PreviewContent third, so both native views cover only the Shell's right-side host.
- A `ResizeObserver` reports the Shell preview-host rectangle through a bounded XPC method. Main
  validates/clamps the rectangle, assigns its first 43px to Header, and assigns the remainder to
  Content. Both stop above the Shell-owned status rail and to the right of the resize handle.
- Header owns file identity/type and broadcasts render/reload/clear control; Content owns every
  actual preview body and returns display-only descriptor metadata. Neither message contains file
  content, an absolute path, or search-bootstrap authority.
- Shell input, Header control, Content rendering, and search I/O do not share an event loop. The
  UtilityProcess owns the search runtime; Main only validates and relays bounded messages.
- Closing the `BaseWindow` terminates the host-bound UtilityProcess, rejects pending relay calls,
  detaches all three child views, and closes all three child views' `webContents`.
- The standalone, Setting, and Agent Guide windows are singletons. Reopening focuses the existing
  instance. Setting and Guide are parented to the active standalone window.
- All three top-level windows use `windowStateService`, `minWidth: 800`, and `minHeight: 600`.
  Setting and Guide restore only their saved size, then center and clamp against the current parent
  display on every open.

### Standalone-only boundary

OnlyPreview is not an Omni mini app. Its usable surface owns a native `BaseWindow` graph containing
separate Shell, PreviewHeader, and PreviewContent `WebContentsView`s plus its app-specific Setting
window. Omni must not
list `onlypreview`, accept it in persisted cell state, map it to a runtime target, or load an
OnlyPreview preload. There is no embedded DOM Preview adapter or container mode.

## Renderer Entries

| Entry                       | Preload                 | Host mode       | Responsibility                                                                               |
| --------------------------- | ----------------------- | --------------- | -------------------------------------------------------------------------------------------- |
| `onlypreview/shell`         | `onlypreview.js`        | `shell`         | MenuBar, tree/local filter, Project Search input/results, status, native Preview bounds host |
| `onlypreview/previewHeader` | `onlypreview.js`        | `previewHeader` | 43px file identity/type and Content control surface                                          |
| `onlypreview/preview`       | `onlypreviewContent.js` | `preview`       | Content-only preview body                                                                    |
| `onlypreview/settings`      | `onlypreview.js`        | `settings`      | app-specific settings form                                                                   |
| `onlypreview/guide`         | `onlypreview.js`        | `guide`         | one-copy MCP and portable Preview-skill setup                                                |

Both preloads import `electron-xpc/preload` and expose only immutable mode/platform context plus the
Main-issued content host through `contextBridge`. Main creates and pre-registers one unguessable
`hostToken` before each OnlyPreview view is created, then passes it through
`additionalArguments`. Shell, Header, and Content share one content host; the Setting and Guide
windows each have their own narrow host. The search-bootstrap capability remains private in Main;
no preload or page receives its token, absolute workspace root, or database path.

Every visible OnlyPreview view uses `sandbox: true`, `contextIsolation: true`,
`nodeIntegration: false`, `webSecurity: true`, an exact navigation fence, and no Node or filesystem
bridge. The sandbox-safe `onlypreview.js` serves Shell, Header, Setting, and Guide;
`onlypreviewContent.js` serves Content and contains no search runtime or token. Every renderer
initializes language before Vue mount. All five HTML entries remain first-party local targets
registered in the application log policy and i18n checker.

## Workspace Capability Contract

`electron-xpc` Main dispatch does not retain a trustworthy sender identity and its handler boundary
does not preserve thrown typed errors. Therefore no renderer method accepts an arbitrary absolute
file path, and every privileged call supplies a Main-issued host capability and returns an explicit
result envelope.

```text
OS event or native Open dialog
        |
        v
Main validates live hostToken + realpath/stat
        |
        v
random workspaceId ──> Main-owned { hostToken, rootRealPath, selectedRelativePath? }
        |
        +── renderer receives workspaceId + display metadata
        |
        +── renderer requests { workspaceId, relativePath }
                                 |
                                 v
                         resolve + realpath + containment check
```

Required properties:

- A file target creates a workspace rooted at its parent and selects its basename. A directory
  target creates a workspace rooted at that directory.
- `workspaceId` is an unguessable opaque value. Main owns the absolute root.
- Renderer calls carry only `workspaceId` and normalized relative paths.
- Main rejects absolute relative-path inputs, `..` traversal, missing capabilities, devices,
  sockets, and post-`realpath` paths outside the root.
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
- Returned display paths are presentation metadata. They cannot be supplied back as read authority.

The Main API surface is read-only:

```ts
interface OnlyPreviewApi {
  openOnlyPreviewWindow(): Promise<OnlyPreviewResult<void>>;
  chooseFolder(params: HostRequest): Promise<OnlyPreviewResult<OnlyPreviewWorkspace | null>>;
  restoreWorkspace(params: HostRequest): Promise<OnlyPreviewResult<OnlyPreviewWorkspace | null>>;
  describeFile(
    params: HostRequest & OnlyPreviewFileRef
  ): Promise<OnlyPreviewResult<OnlyPreviewDescriptor>>;
  readText(
    params: HostRequest & OnlyPreviewFileRef
  ): Promise<OnlyPreviewResult<OnlyPreviewTextContent>>;
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

interface OnlyPreviewSearchPreloadApi {
  initialize(
    params: SearchHostRequest & { workspaceId: string }
  ): Promise<OnlyPreviewResult<OnlyPreviewSearchSnapshot>>;
  refresh(
    params: SearchHostRequest & { workspaceId: string }
  ): Promise<OnlyPreviewResult<OnlyPreviewSearchSnapshot>>;
  search(params: OnlyPreviewSearchRequest): Promise<OnlyPreviewResult<OnlyPreviewSearchResponse>>;
  cancel(params: SearchHostRequest & { requestId: string }): Promise<OnlyPreviewResult<void>>;
  shutdown(params: SearchHostRequest): Promise<OnlyPreviewResult<void>>;
}

type OnlyPreviewResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: OnlyPreviewErrorCode; message: string } };
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
enriches only the UtilityProcess initialization message with `{ rootPath, databasePath }`. The
UtilityProcess uses raw `parentPort` request/response messages; Main bounds pending requests,
rejects them on timeout/exit, and relays only whitelisted, shape-validated snapshot, batch, and watch
events after binding them to the attached `hostId`. Renderers receive those events through
`xpcMain.broadcast`, never through UtilityProcess XPC registration. There is no Main traversal,
index-build, query, or watch implementation.

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
- Shell and Content can request restore concurrently for the same content host. Main runs one
  per-host single-flight restore, rechecks whether that host already owns a workspace before and
  after the SQLite wait, and returns the same newly minted workspace to both callers. Host revoke,
  standalone teardown, auth invalidation, and quit remove that host's restore promise, generation,
  and transient remembered state.
- A persisted value is only a candidate. Main parses version 1, revalidates the directory through
  the normal `createForTarget` containment/stat path, and creates a fresh directory workspace with
  no selected file. Missing, malformed, non-directory, or permission-denied candidates fail closed
  to the empty state and are changed to `null` only with `compareAndSet` against the exact invalid
  serialized value, so cleanup cannot erase a concurrent newer path.
- An explicit OS target suppresses history restore before `ensureStandalone()` creates/focuses the
  Shell, Header, and Content views. Explicit opens and restore share one per-host mutation generation; a
  late history read cannot replace an explicit target, and among serialized explicit requests the
  latest explicit target remains visible and becomes the remembered directory.

## Index Contract

The UtilityProcess owns two independent indexes with different policy boundaries:

1. an in-memory directory-name tier containing file and directory metadata for the ordinary Project
   tree/filter; it ignores Project Search excludes and never reads file bodies; and
2. a persistent SQLite Project Search tier containing eligible file basenames plus content chunks
   only for eligible files whose stored `mediaType` is text.

The SQLite database lives below Bitterless user data and uses schema version 7: `files.in_project`
persists global-scope eligibility beside the versioned `contentless-full` FTS layout, stable
content-defined chunks, CJK short-code-point postings, exact original-text verification, and
per-file transaction-safe upsert/delete. NeDB and the native `simple` extension are not product
dependencies. Historical prototype evidence includes a roughly 12MiB filename-tier estimate,
under 17MiB retained heap delta, and about 1.412GB of SQLite disk footprint. Those prototype numbers
guide budgets only: they do not prove the current product scope UI, local-filter semantics,
UtilityProcess relay, or selected-Preview refresh. Disk footprint is not RAM and is never
summed into runtime memory.

| Constraint                             | Product value                                                                                                                                            |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Maximum visible Project Search results | 500 files                                                                                                                                                |
| Maximum traversal depth                | 32                                                                                                                                                       |
| Directory-name tier                    | file + directory metadata; ignores Project Search config/hard excludes; ordinary filter searches only the `entry.name` field with substring semantics    |
| Project Search hidden policy           | every file below any dot-prefixed directory is physically absent; root dotfiles remain eligible unless separately excluded                               |
| Project Search fixed exclusions        | `.git`, `node_modules`, `dist`, `build`, `out`, `output`, `.next`, `coverage`, `.cache`, `.turbo` at any depth; immutable against `!`                    |
| Workspace config                       | flat version-1 ordered `exclude` globs in `.bitterless/preview-config.yml`                                                                               |
| Symlink policy                         | leaf only, never recurse or index target content                                                                                                         |
| Filename/tree sort                     | directories first, then natural case-insensitive name order                                                                                              |
| Search normalization                   | NFKC plus established case policy, followed by original-text literal verification                                                                        |
| Watch reconcile                        | 400ms trailing per changed path; overflow/error/missing filename triggers full reconcile                                                                 |
| Runtime memory                         | strictly above 1GiB advisory; strictly above 2GiB sets `performanceAccepted=false` and `stop=false` without invalidating the recorded artifact or method |

Traversal starts in the dedicated UtilityProcess on first open and advances in bounded elapsed-time
slices, yielding between batches. It emits metadata into the directory-name tier independently of
Project Search eligibility. Before any file body is opened, the Project Search branch rejects every
file below a hidden/fixed directory and then applies ordered workspace excludes. Each tree record
stores relative path, parent, exact display name, node kind, size, modified time, preview hint,
`mediaType`, and `isText`; excluded tree records use metadata/path classification only. Only eligible
`isText` files are decoded and indexed for content. Strict decoding, maximum searchable size,
containment, opened-file identity, and post-read size checks are enforced before committing a file.

The ordinary Project field snapshots the rows visible from the current expansion state before a
non-empty query, then filters only those rows by Unicode-normalized literal `entry.name`. It may
match file or directory names, but it never reads `relativePath`, inspects collapsed descendants,
calls the project-search runtime, or adds expanded paths. Already-visible ancestors remain only as context;
clearing the query restores the unchanged expansion state.

Project Search is separate and returns files only. Every eligible filename is searchable; non-text
files can only produce title matches and never have a summary. Text content candidates are fetched
from the SQLite strategy appropriate to query length/script, then verified against normalized
original text before any result is emitted. Title/content duplicates merge by exact relative file
path and retain the first verified content match.

Project Search carries a strict scope:

```ts
type OnlyPreviewSearchScope = { kind: 'project' } | { kind: 'directory'; relativePath: string };
```

`Cmd/Ctrl+Shift+F` defaults to `In Directory` and captures one stable anchor before results replace
the tree: focused directory, focused file parent, selected Preview file parent, then workspace root
(`relativePath: ''`). The selector switches between that captured `In Directory` anchor and
`In Project`; result selection never silently changes it. Scope changes share the existing
generation/cancellation/throttle fences. Absolute/traversal paths and unknown scope shapes fail the
strict contract.

The tree publishes every directory's complete direct-child set before deeper traversal, including
root-level files, dot-prefixed entries, generated-output directories, and config-excluded entries.
Those names remain available to the ordinary local filter because it is not a Project Search query.
Both Project Search scopes use the same physical eligibility: a root-level hidden file remains
eligible unless separately excluded, while a file below any hidden/fixed directory or matched by
workspace config is absent. Anchoring `In Directory` at such a tree directory therefore returns no
excluded files and cannot bypass the policy.

The result contract is exact:

```ts
interface OnlyPreviewSearchResult {
  fileName: string;
  relativePath: string;
  mediaType: 'text' | 'image' | 'audio' | 'video' | 'pdf' | 'unknown';
  contentMatch: null | {
    snippetText: string;
    highlightStart: number;
    highlightLength: number;
  };
}
```

Snippet boundaries use Unicode graphemes and original text. Include at most 16 graphemes before
and after while capping normal snippets at 48 graphemes. If the verified match itself exceeds 48,
show the match alone. If the remaining context budget is odd, the leading side receives one more
grapheme. Newlines and composed/ZWJ sequences remain original text; highlight offsets address the
returned snippet.

Shell dispatches Project Search with a fixed 120ms leading-plus-trailing throttle. IME composition
never dispatches an intermediate composition string. The UtilityProcess runtime permits at most one
active query and one latest pending query, explicitly cancels superseded work, and fences every
batch/result by host, workspace, request, and generation. It flushes verified upserts while the query is
running at no more than 50 results per batch or a 16ms deadline; its terminal message carries only
metadata and canonical result order, so the full row payload is not serialized twice. The last
input is dispatched exactly once.

`fs.watch` updates are hints, not authority. After the 400ms trailing edge, the UtilityProcess
revalidates the changed relative path once, updates tree metadata regardless of Project Search
excludes, and upserts or deletes the SQLite file according to current eligibility. Create, update,
delete, delete/recreate, and exclusion transitions converge at that commit. Rename, directory/type
changes, lost/ambiguous events, and watch errors request a cooperative full dual reconcile. Manual
refresh uses the same path; it does not reintroduce a Main directory walk.

The committed trailing update also publishes a bounded host/workspace/relative-path/watch-revision
signal over raw `parentPort`. Main validates the event, binds it to the attached host, and broadcasts
it through `electron-xpc`; PreviewHeader accepts it only for its current selection and a newer
revision, then uses the existing reload control to notify PreviewContent.
Content advances its Preview load generation before reading, so an old workspace, selection, read,
or watch revision cannot install. Delete/rename renders the typed missing state; a later recreation
carries a newer revision and reloads. Full reconcile uses the same selection-safe invalidation when
the selected file may have changed. Header keeps its manual render/reload/clear controls; Main
performs no file watch, search I/O, or Preview polling.

### Product Overmind acceptance evidence

`PRODUCT-P00` and `PRODUCT-P01` below are immutable historical evidence for the former
hidden-inclusive physical SQLite policy. They indexed 726 hidden-directory descendant files and
therefore do not accept the dual-index, hidden-pruned policy introduced by task 016. Their recorded
latency/memory/disk values must not be presented as current-policy results. A fresh PRODUCT-P02
point using the bundled current Utility runtime and product core in a fresh Node child, separate
directory metadata tier, eligibility before file-body open, and create/update/delete/rename gates is
required and has not yet been run. Electron `utilityProcess.fork` startup, Main relay, Shell
scheduling, and renderer commit remain outside that timing boundary and require targeted Electron
acceptance. Metadata-only tree `lstat` work is allowed and must be reported separately rather than
described as zero I/O.

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
the Electron preload/XPC hop, Shell's 120ms scheduler, PreviewHeader's selection/revision gate,
PreviewContent's reload commit, or packaged startup. Later 7/7 Electron E2E covers the unpackaged
runtime/UI path; packaged release startup remains untested.

## Preview Classification And Rendering

| Kind              | MVP inputs                                                                                       | Renderer                                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `text`            | common source/config/prose/log types; extensionless or unknown sample that passes text detection | Monaco `vs`, `readOnly`, `domReadOnly`, selectable text, syntax map, find                                                      |
| `text` / Markdown | `.md`                                                                                            | centered semantic reading surface compiled by `marked` and sanitized by DOMPurify; `.markdown` and `.mdx` remain Monaco source |
| `text` / HTML     | `.html`, `.htm`                                                                                  | inert semantic document sanitized by DOMPurify; scripts, styles, attributes, navigation, and resources do not survive          |
| `pdf`             | `.pdf` with matching signature                                                                   | installed PDF.js (`unpdf/pdfjs`) canvas pages plus selectable TextLayer over tokenized bytes                                   |
| `image`           | PNG, JPEG, GIF, WebP, AVIF, BMP, ICO, SVG                                                        | `<img>` contain; SVG never becomes a top-level executable document                                                             |
| `audio`           | MP3, WAV, OGG, M4A, AAC, FLAC where Chromium has codec support                                   | `<audio controls>`, no autoplay                                                                                                |
| `video`           | MP4, WebM, OGV, MOV, M4V where Chromium has codec support                                        | `<video controls>`, no autoplay                                                                                                |
| `unsupported`     | unknown binary, Office/archive/executable in MVP                                                 | name/type/size/modified/display path + system-open action                                                                      |

- Text reads are complete-or-error with an 8 MiB maximum. They read at most 8 MiB + 1 byte from the
  verified handle to detect concurrent growth and are never silently truncated.
- Text detection samples bytes and rejects NUL/control-heavy payloads. UTF-8 and BOM-marked UTF-16
  are supported; invalid required decoding returns an explicit error.
- HTML is semantically rendered only for `.html` and `.htm`; XML, Vue SFCs, and other HTML-like
  source remain Monaco text. HTML above 1 MiB is rejected with a localized render-limit state.
  Rendering uses direct DOMPurify sanitization with an explicit semantic tag allowlist and zero
  attributes. Scripts, styles, templates, forms, frames, objects, embeds, SVG/MathML, media, event
  handlers, links, images, and remote/data/local resource or navigation paths cannot survive. It
  uses no iframe, `webview`, asset URL, Main method, XPC method, or preload expansion.
- Markdown is rendered only for `.md`. `.markdown` and `.mdx` remain source; expanding file
  associations or interpreting JSX/import semantics is outside this focused contract. Markdown
  source above 1 MiB is rejected with a localized render-limit state instead of falling back to
  raw source.
- Markdown compilation uses direct current `marked` and DOMPurify dependencies. Raw HTML is escaped
  as visible text before sanitization. Sanitized output allows only semantic text/list/table/code
  tags and no attributes; scripts, styles, forms, frames, SVG/MathML, event handlers, `href`, `src`,
  and remote/data/local resource loads cannot survive. Links remain readable but inert, and images
  become alt-text placeholders rather than loading a resource.
- A descriptor reports a mismatched signature or unsupported codec as a recoverable preview error.
- Monaco editor and model are both disposed on file changes and component unmount.
- Selection/copy/find remain enabled; mutation commands and ordinary keyboard input cannot modify
  the model. Electron E2E must prove a selected range can be copied and attempted input leaves the
  Monaco model byte-for-byte unchanged.
- A non-empty text selection reports its Unicode grapheme count in the Shell-owned bottom status
  rail. Monaco counts every non-empty editor selection; Markdown and PDF use a DOM selection only
  when both endpoints remain inside the preview body. Whitespace and line breaks count. Empty,
  outside, stale, loading, error, file-change, and unmount states report zero and hide the label.
- The selected-count payload remains exactly `{ hostId, characterCount }`. Shell owns an opaque
  per-content revision and sends it only through renderer-local transition/readiness messages;
  Preview fences component reports against that revision before Shell accepts a non-zero count.
  A host-only sync request resynchronizes the current revision after either renderer reloads. These
  lifecycle messages contain no path, selected text, file content, or capability and never cross
  Main or preload.
- A local file click rotates an unannounced pending revision before Main confirms the selection, so
  an older restore cannot re-arm the previous count. Main's native refresh event is converted by
  Shell into the same revision transition, which reloads Preview and rebuilds the index once.

## Tokenized Asset Protocol

Main registers `bitterless-preview` as a privileged, standard, secure, fetch-capable, streaming
scheme before `ready`, then installs `protocol.handle` after `ready`.

`describeFile` issues a random, bounded asset token only for files authorized by a workspace
capability. A URL contains exactly a 64-hex token and one matching encoded display filename, never
an absolute path; credentials, ports, query strings, fragments, and path aliases are rejected. The
handler resolves the token to a Main-owned real path only while its issuing host and workspace are
live. Unknown, expired, or malformed tokens return a non-content response.

Electron 40's `net.fetch(file:)` does not preserve Range semantics, so the handler must not delegate
file responses to it. Main parses one valid byte-range request, opens a bounded `fs` read stream,
and returns `206` with `Accept-Ranges`, `Content-Range`, exact `Content-Length`, and the authorized
MIME type. Full `GET`/`HEAD`, malformed/unsatisfiable range, and unsupported method behavior are
explicit and covered by focused protocol tests. This is required for real audio/video seeking.
Each live response stream remains registered to its asset. Request cancellation destroys the
stream, and token/workspace/host revocation destroys already-open streams before removing authority;
`HEAD`, error, and no-body responses close their verified file handle immediately.

PDF does not use a custom-scheme iframe: that path is not reliable on the pinned Electron runtime.
The Preview renderer fetches the authorized token bytes and uses the already installed
`unpdf/pdfjs` display API to render canvases with a matching selectable `TextLayer`. On the pinned
runtime the proven static path is `intent: 'print'` plus `AnnotationMode.DISABLE`; the default
display/annotation path can leave the render task pending. It creates no annotation/editor layer
and disposes the PDF loading task, document, render tasks, and text layers when the file changes or
the component unmounts. Electron acceptance checks both non-empty canvas pixels and text selection.

The registry evicts oldest tokens at its bound and clears on shutdown. CSP allows the custom scheme
only in the resource directives needed by image/media/PDF presentation; it keeps remote network,
forms, object injection, and unrequested navigation disabled.

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
│ Filter files…        ├───────────────────────────────────────────────────┤
│ ▾ src                │                                                   │
│   ▾ components       │ read-only preview surface                         │
│       FileTree.vue   │                                                   │
│   App.vue            │                                                   │
├──────────────────────┴───────────────────────────────────────────────────┤
│ INDEX READY                    SELECTED 24 CHARACTERS · UTF-8 · 18 KB   │
└──────────────────────────────────────────────────────────────────────────┘

Cmd/Ctrl+Shift+F:

┌ PROJECT SEARCH ────────────────────────┐
│ Search filenames and text…             │
│ Scope: [In Directory ▾]                 │
│ src/components                          │
│ FileTree.vue                      text │
│ src/components                         │
│ …before [matched text] after…           │
│ photo.png                         image│
│ assets                                 │
└────────────────────────────────────────┘
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
  DOM modal inside Shell, where the sibling native Header/Content views would cover it.
- Project headers and the status rail never display indexed file/item totals. The interface does
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
- The ordinary Project field filters only `entry.name` on rows visible before the query. It may
  match files or directories, retains already-visible ancestors for context, never searches a
  relative path or collapsed descendant, and never expands the tree. Project Search is entered with
  `Cmd/Ctrl+Shift+F`, defaults to the captured current directory, and replaces the tree viewport
  with a file-only result list plus one `In Directory` / `In Project` selector. The directory label
  is workspace-relative (or the workspace root name), never absolute. Each result shows the exact
  filename first, a muted relative directory second, a compact media type, and only for verified
  text-content matches a one-line original-text snippet with the matched range highlighted in Royal
  Blue. Title-only and non-text matches never reserve an empty snippet row.
- Project Search indexing, empty, no-match, error, and memory-advisory states use the existing quiet
  Project/status treatment; they do not add cards, indexed totals, verbose limit explanations, or a
  second visual theme.
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
- HTML uses the same white Preview canvas as a responsive semantic document with system text,
  Royal Blue headings, bordered tables, and monospace code. File-provided CSS and attributes are
  intentionally absent; this is an inert readable rendering, not a live browser page.
- The Index Rail is the single signature motion. It respects `prefers-reduced-motion`.
- Structural and repeated elements carry stable `name` attributes and `onlypreview`-rooted BEM
  classes with sibling Less files. No Tailwind utilities.
- Each column owns its scroll; root/grid children use `min-width: 0` and `min-height: 0`. The Project
  tree viewport owns both axes. Tree rows are at least the viewport width and expand to their full
  indentation-plus-name width, so deep single-line names are not ellipsized and become reachable
  with horizontal scrolling. Horizontal and vertical Project-tree scrollbars are both exactly 8px,
  with a transparent track/corner and no separating rule. The header/search stay fixed and
  horizontal position is not persisted.
- The 5px resize hit target remains operable at 800×600 but has no visible border, center rule, or
  contrasting fill. Main clamps reported and resized preview bounds to the actual 32px MenuBar,
  minimum 180px project column plus the functional 5px hit target, and 25px status rail, so a
  compromised renderer cannot cover Shell controls.

## Interaction Contract

| Input                            | Scope                                    | Behavior                                                                                                               |
| -------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `Alt+1`                          | Shell                                    | focus Project tree                                                                                                     |
| double `Shift`                   | Shell                                    | focus the local Project filter                                                                                         |
| `Cmd/Ctrl+Shift+F`               | Shell or Preview                         | enter Project Search in the captured current directory and focus its input                                             |
| scope selector                   | Project Search                           | switch the current query between the captured `In Directory` anchor and `In Project`                                   |
| `Space`                          | selected file in tree                    | preview selected file                                                                                                  |
| single click                     | tree                                     | preview only when setting is enabled; directories toggle                                                               |
| double click                     | tree                                     | preview file or toggle directory                                                                                       |
| crosshair                        | Project header                           | reveal and focus the currently previewed file in the tree                                                              |
| right click                      | file row                                 | open a Main-owned native file action menu at the pointer                                                               |
| Robot                            | MenuBar                                  | open or focus the parented `Copy the skill to your agent` Guide                                                        |
| copy card                        | Guide                                    | copy one complete English MCP-plus-skill setup instruction                                                             |
| `Cmd/Ctrl+O`                     | Shell or Preview                         | Open Folder                                                                                                            |
| `Cmd+,` or `Ctrl+Alt+S`          | Shell or Preview                         | open Setting window                                                                                                    |
| `F5` or `Cmd/Ctrl+R`             | Shell or Preview                         | reconcile the UtilityProcess index and refresh selected preview                                                        |
| `F12`                            | Shell, Header, or Content, debug profile | toggle detached DevTools for the view that received the shortcut                                                       |
| `Cmd+Option+I` or `Ctrl+Shift+I` | Shell, Header, or Content, debug profile | toggle detached DevTools for the view that received the shortcut                                                       |
| `Cmd/Ctrl+F`                     | Monaco                                   | find without invoking a Shell search                                                                                   |
| drag/select text                 | Monaco, Markdown, HTML, or PDF           | show the selected grapheme count in the bottom status rail; hide it when selection collapses or leaves preview content |
| `Esc`                            | Project Search / local filter / Setting  | clear query, return to tree / clear filter / close without save                                                        |
| double click                     | non-action MenuBar surface               | toggle maximize/restore                                                                                                |
| minimize / maximize / close      | Windows MenuBar controls                 | control the current standalone `BaseWindow` through Main                                                               |

Window-wide shortcuts use `before-input-event` on OnlyPreview webContents so they remain available
when Monaco has focus. Only matched commands prevent default; Monaco retains selection, copy, and
find behavior. On the initial successful Preview-view load, a normal debug profile automatically
opens that Preview `webContents` DevTools detached with `activate: false`; Shell, Settings, Guide,
release, and isolated E2E never auto-open. Manual DevTools shortcuts remain Main-owned and target
only the Shell, Header, or Content `webContents` that received the input. The same shortcut closes
that view's open DevTools. Auto-repeat is ignored.

## State And Error Contract

- **Empty:** the Open Folder action and shortcut are available; no Open File action is shown.
- **Indexing:** start or resume the UtilityProcess in the background, retain the last valid filename tier
  and search database, and animate the Index Rail without blocking Shell input.
- **Index partial:** show the returned prefix and `INDEX PARTIAL` status only; do not add
  explanatory copy beneath the tree.
- **Project Search pending:** retain the last accepted result set until the latest throttled request
  returns; stale or cancelled batches cannot replace it.
- **Project Search scope:** default to the captured current directory; changing scope cancels or
  supersedes the active generation and never derives a new directory from a clicked result.
- **Project Search no result:** show one compact localized empty state. Directory matches never
  appear in this mode.
- **Project Search title-only/non-text:** show filename, relative directory, and media type without
  a summary placeholder.
- **Index memory advisory:** runtime strictly above 1GiB may show/log one aggregate optimization
  advisory; strictly above 2GiB sets `performanceAccepted=false` and keeps `stop=false` for the next
  iteration without invalidating the benchmark artifact or method. Neither value includes the
  separately reported SQLite disk footprint, and no file/path/content is logged.
- **Loading preview:** retain stable bounds and show a quiet progress state.
- **Missing/permission denied:** distinguish `PATH_NOT_FOUND` from `PATH_PERMISSION_DENIED`; the
  latter uses the user-facing message “Bitterless does not have permission to read this file or
  folder.” without referring to a removed visible Refresh action.
- **Too large:** show file metadata and the 8 MiB text limit; do not show partial text.
- **Unsupported:** show metadata plus Open externally and Reveal in folder.
- **Native file menu:** only file rows expose Preview, Open in system app, and Reveal in folder.
  Main revalidates the host-bound file reference when a command runs and opens the menu with the
  active OnlyPreview `BaseWindow` as owner, so it can extend beyond the Shell child view.
- **Media/PDF error:** preserve the title and explain that Chromium codec/content support failed.
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

- Shell, Header, Content, Setting, and Guide all use `sandbox: true`, `contextIsolation: true`,
  `nodeIntegration: false`, `webSecurity: true`, exact local navigation fencing, and no `<webview>`.
- The search-bootstrap token stays private in Main and is never passed in preload `process.argv`,
  copied to `contextBridge`, renderer state, logs, or a result. Main validates the host/workspace and
  sends absolute root/database paths only inside the UtilityProcess initialization request. The
  UtilityProcess returns only relative metadata and aggregate telemetry.
- Never give arbitrary web content an OnlyPreview preload.
- HTML is sanitized into inert zero-attribute semantic markup inside the existing Preview renderer;
  it does not receive a nested browsing context, preload, resource URL, script, style, form, or
  navigation capability.
- Deny renderer top-level navigation and redirects away from its exact local target, and deny new
  windows.
- File operations are read-only and capability-scoped. No broad filesystem API is exposed. Main
  never traverses or reads searchable content; the UtilityProcess opens only contained
  workspace-relative paths and keeps its persistent database below application user data.
- Sensitive credential-like files (`.env`, `.env.*`, `.npmrc`, `.netrc`, `*.pem`, `*.key`) remain
  explicitly previewable through the existing selected-file capability but are title-only in
  Project Search unless a future reviewed contract states otherwise. Their bodies are not added to
  the content index.
- `preview.open` accepts one explicit absolute target and delegates to the same read-only Main open
  route. It exposes no content/list/write method and returns no path.
- The Guide renderer receives only the server name, one English instruction, and its expected version. It has a
  dedicated role and cannot call content, settings, external-open, native-menu, or window-control
  methods. Clipboard access requires an explicit click and is not exposed through preload.
- No file contents or absolute user paths are written to application logs.
- Search memory/status logging is aggregate-only. Runtime memory and SQLite disk footprint are
  measured and labelled separately; they are never added together.
- The one persisted recent-directory absolute path remains private inside Core SQLite. It is never
  broadcast, logged, or accepted back from a renderer, and carries no file selection or capability.
- Media tokens are high entropy, bounded, revocable, and never persisted.
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
  semantics.
- Search unit tests cover private bootstrap ownership, Main zero-search-I/O, strict scope parsing,
  directory-anchor precedence, root scope, pre-I/O excludes, symlink/containment, visible dot items,
  In Project hidden-directory exclusion, explicit hidden In Directory, root hidden files, media
  classification, strict decode/size limits, persistent schema/reopen, filename-tier hydration,
  content-defined boundary matches, trigram/CJK and short-query strategies, NFKC plus literal
  verification, exact file-only result shape, title/content merge, grapheme 16/48 snippets,
  exact result-cap truncation, direct-child-before-descendant traversal, transaction-safe
  upsert/delete, legacy-schema recovery, stat/read-race full reconciliation, 400ms watch trailing
  reconciliation, selected-Preview rerender, and separate runtime/disk telemetry.
- Runtime/coordinator tests use fake time and isolated engine fixtures to cover fixed 120ms
  leading-plus-trailing behavior, IME composition, scope changes, one-active/one-latest single
  flight, active cancellation, final query/scope exactly once, bounded batches, and stale
  host/workspace/request/watch fences.
- Router tests cover macOS early `open-file`, packaged Windows initial/second-instance argv, helper
  exclusions, development explicit arguments, and serialized queue behavior.
- Recent-directory tests cover schema parsing, ready/failure latching, pre-ready latest-write
  flushing, CAS conflict/stale-generation handling, invalid-candidate CAS clear, per-host
  Shell/Preview single flight, host cleanup, and an explicit OS target winning a late restore.
- Source/integration tests cover five renderer entries, official preload and UtilityProcess build
  entries, sandboxed Shell/Header/Content/Setting/Guide preferences, private Main-only bootstrap,
  raw-parent-port UtilityProcess transport, bounded pending rejection on cancel/timeout/exit, and
  whitelisted host-bound Main event relay,
  explicit three-child-view cleanup, hidden titlebar/traffic-light/window-control wiring, Content-only
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
  pre-query-visible `entry.name` filtering without expansion, root/dot row visibility, default
  `In Directory` plus scope switching, file-only Project Search, text-only highlighted summaries,
  title-only non-text rows, watch-selected Preview reload, indexing/search/error/memory states,
  tree/preview/settings states, intrinsic-width horizontal tree scrolling, inert HTML/Markdown
  routing and sanitizer boundaries, BEM/name markers, and keyboard routing.
- Canonical PRODUCT-P01 remains immutable history for the earlier hidden-inclusive physical corpus
  and deleted preload-Worker boundary; it is not current-policy acceptance. The dual-index,
  hidden-pruned Utility runtime requires a new canonical PRODUCT-P02 point, which has not run.
  PRODUCT-P02 covers the bundled current Utility runtime and product core in a fresh Node child;
  Electron UtilityProcess startup, Main relay, Shell scheduling, Header/Content commit, and packaged
  startup remain outside that artifact and require the targeted Electron/build acceptance below.
- Earlier UtilityProcess integration build acceptance has `yarn build` PASS, emitting all five
  renderer HTML files, `out/preload/onlypreview.js`, `out/preload/onlypreviewContent.js`, and
  `out/main/onlypreviewSearchUtility.js` through official Electron Vite inputs. Task 016 has not
  rerun the build.
- Earlier Electron acceptance has `yarn test:e2e:onlypreview` PASS (7/7) for three visible sandboxed
  views, exact 43px Header/Content geometry, detached per-view DevTools, media, Settings, Project
  Search, and selected-file watch reload. Task 016 has updated the E2E contract for independent tree
  metadata, physical hidden/core/config pruning, and watch CRUD/rename, but has not rerun Electron
  acceptance yet.
- Recent-directory restart behavior is verified in Electron/Node unit tests with simulated storage
  lifecycle and fresh host instances. Full-application Electron E2E may verify restart and explicit
  OS-target override only through the shared isolated launch-argument builder; on macOS that builder
  supplies `--use-mock-keychain`, and Main rejects an E2E launch that omits it. Owner manual
  verification remains the final acceptance of behavior in a normal application profile.
- Packaged release build/startup remains untested. Packaged manual verification is still required
  for OS association registration and the actual Chromium codec matrix on macOS and Windows.
