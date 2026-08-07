# OnlyPreview Sub-Application

Status: Accepted

## Purpose And Boundary

OnlyPreview is Bitterless's read-only local-file workbench. A user opens a file or directory,
navigates a bounded project index on the left, and previews the selected file on the right without
leaving Bitterless. The first delivery is optimized for source code, text, PDF, image, audio, and
video files used in development and ordinary desktop work.

OnlyPreview owns local file discovery, a metadata-only directory index, preview classification,
read-only rendering, its app-specific preferences, and the standalone window graph. It never
edits, writes, creates, renames, moves, or deletes user files. Unsupported local files still open
to an explicit metadata surface with an action to use the system application.

The public identity is `OnlyPreview`; stable code IDs, Omni IDs, renderer directories, setting
keys, and window-state keys use `onlypreview`.

The product-level rationale and visual direction live in
`areas/only-preview/feature-design.md` in the private overmind parent. This document is the
implementation contract inside Bitterless and contains no private user data.

## Ownership

| Concern | Owner |
|---|---|
| Home card and launch action | Home Mini Apps renderer |
| OS file-open queue and first/second-instance routing | `app.main.ts` + OnlyPreview open router |
| Standalone `BaseWindow`, child view bounds, Setting window, cleanup | OnlyPreview window handler/helper |
| Per-view host capabilities and host/workspace/media ownership | Main OnlyPreview host registry |
| Workspace capabilities, containment, index, descriptor, text reads | Main OnlyPreview file service |
| Media/PDF byte streaming | Main token registry + manual Range-capable `bitterless-preview://` protocol |
| Tree, search, keyboard commands, selection | OnlyPreview Shell renderer |
| Code/PDF/image/audio/video/unsupported presentation | shared OnlyPreview Preview surface |
| Monaco model/editor lifecycle | Preview surface |
| Preferences | Main handler backed by `SettingDao` |
| Omni cell creation and bounds | existing `OmniWindowHelper` |
| Window geometry | existing `windowStateService` |

## Window And View Composition

### Standalone

```text
┌──────────────────────────── BaseWindow ───────────────────────────────┐
│ Shell WebContentsView                                                │
│ ┌──────────────────────────────────────────────────────────────────┐ │
│ │ top command bar                                                  │ │
│ ├──────────────────────┬───────────────────────────────────────────┤ │
│ │ index search + tree  │ preview host placeholder                  │ │
│ │                      │                                           │ │
│ ├──────────────────────┴───────────────────────────────────────────┤ │
│ │ Index Rail / status                                              │ │
│ └──────────────────────────────────────────────────────────────────┘ │
│                        ┌────────────────────────────────────────────┐ │
│                        │ Preview WebContentsView, bounded exactly  │ │
│                        │ over the Shell preview host               │ │
│                        └────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────── BrowserWindow ────────────────────┐
│ OnlyPreview Setting renderer                          │
└───────────────────────────────────────────────────────┘
```

- The Shell is added first and covers the content bounds. The Preview view is added second.
- A `ResizeObserver` reports the Shell preview-host rectangle through a bounded XPC method. Main
  validates/clamps the rectangle before changing native Preview bounds.
- The Preview view stops above the Shell-owned status rail and to the right of the resize handle.
- Closing the `BaseWindow` explicitly detaches and closes both child views' `webContents`.
- The standalone and Setting windows are singletons. Reopening focuses the existing instance.
- Both top-level windows use `windowStateService`, `minWidth: 800`, and `minHeight: 600`.

### Omni

Omni loads the OnlyPreview Shell as a normal first-party mini-app operation `WebContentsView` with
`--mode=omni`. The Shell renders the same Preview surface inside its own right-hand DOM region.
It does not add native child views across the cell boundary because Omni remains the sole owner of
cell bounds. It must hide standalone-only native window controls.

Standalone multi-view composition is the primary implementation. The embedded DOM fallback is an
explicit host adapter, not a different file/index contract.

## Renderer Entries

| Entry | Preload | Host mode | Responsibility |
|---|---|---|---|
| `onlypreview/shell` | `onlypreview.js` | `standalone` or `omni` | command bar, tree, search, status, embedded preview fallback |
| `onlypreview/preview` | `onlypreview.js` | `preview` | standalone preview surface only |
| `onlypreview/settings` | `onlypreview.js` | `settings` | app-specific settings form |

The preload imports `electron-xpc/preload` and exposes only immutable mode/platform context plus the
Main-issued host capability through `contextBridge`. Main creates and pre-registers one unguessable
`hostToken` before each OnlyPreview view is created, then passes it through
`additionalArguments`. Standalone Shell and Preview share one content host; the Setting window has
its own settings-only host; each Omni cell has its own content host. Every entry initializes
renderer language before Vue mount. All three entries are first-party local targets and must be
registered in the application log policy and i18n checker.
Because every OnlyPreview renderer is sandboxed, the production build rebundles this preload as one
self-contained file: it may require Electron, but it must not require a local generated chunk.

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
- `restoreWorkspace` returns only the latest workspace still owned by that same live host in the
  current process session. It never persists or reconstructs an absolute path across app restart.
- Returned display paths are presentation metadata. They cannot be supplied back as read authority.

The Main API surface is read-only:

```ts
interface OnlyPreviewApi {
  openOnlyPreviewWindow(): Promise<OnlyPreviewResult<void>>;
  chooseTarget(params: HostRequest & { kind: 'file' | 'directory' }): Promise<OnlyPreviewResult<OnlyPreviewWorkspace | null>>;
  restoreWorkspace(params: HostRequest): Promise<OnlyPreviewResult<OnlyPreviewWorkspace | null>>;
  buildIndex(params: HostRequest & { workspaceId: string }): Promise<OnlyPreviewResult<OnlyPreviewIndex>>;
  describeFile(params: HostRequest & OnlyPreviewFileRef): Promise<OnlyPreviewResult<OnlyPreviewDescriptor>>;
  readText(params: HostRequest & OnlyPreviewFileRef): Promise<OnlyPreviewResult<OnlyPreviewTextContent>>;
  selectStandaloneFile(params: HostRequest & OnlyPreviewFileRef): Promise<OnlyPreviewResult<void>>;
  updatePreviewBounds(params: HostRequest & OnlyPreviewBounds): Promise<OnlyPreviewResult<void>>;
  openExternally(params: HostRequest & OnlyPreviewFileRef): Promise<OnlyPreviewResult<void>>;
  revealInFolder(params: HostRequest & OnlyPreviewFileRef): Promise<OnlyPreviewResult<void>>;
  getSettings(params: HostRequest): Promise<OnlyPreviewResult<OnlyPreviewSettings>>;
  saveSettings(params: HostRequest & { settings: OnlyPreviewSettings }): Promise<OnlyPreviewResult<OnlyPreviewSettings>>;
  openSettings(params: HostRequest): Promise<OnlyPreviewResult<void>>;
  closeSettings(params: HostRequest): Promise<OnlyPreviewResult<void>>;
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

## Index Contract

The index is metadata-only and in-memory. It is neither a full-text database nor a long-running
watcher.

| Constraint | MVP value |
|---|---|
| Maximum returned entries | 20,000 |
| Maximum traversal depth | 32 |
| Default hidden-item policy | excluded |
| Fixed excluded directories | `.git`, `node_modules`, `dist`, `build`, `out`, `.next`, `coverage`, `.cache`, `.turbo` |
| Symlink policy | leaf only, never recurse |
| Sort | directories first, then natural case-insensitive name order |

The result is a flat typed record set with relative path, parent relative path, name, node kind,
size, modified time, and inexpensive extension-based preview hint. Search matches filename and
relative path only. Unknown types are sampled only when selected, not during the walk.
Before each directory read, Main requires a non-symlink directory, resolves it again, verifies the
root is unchanged or the child remains contained, and reads the canonical directory. Replacing the
workspace root or an indexed child with an outside symlink fails without exposing outside metadata.

If the bound is reached, Main returns the valid prefix with `truncated: true`; the Shell shows
`INDEX PARTIAL`. A newer index request supersedes stale renderer results. Refresh explicitly
rebuilds the index; no watcher is created in the MVP.

## Preview Classification And Rendering

| Kind | MVP inputs | Renderer |
|---|---|---|
| `text` | common source/config/prose/log types; extensionless or unknown sample that passes text detection | Monaco `vs`, `readOnly`, `domReadOnly`, selectable text, syntax map, find |
| `pdf` | `.pdf` with matching signature | installed PDF.js (`unpdf/pdfjs`) canvas pages plus selectable TextLayer over tokenized bytes |
| `image` | PNG, JPEG, GIF, WebP, AVIF, BMP, ICO, SVG | `<img>` contain; SVG never becomes a top-level executable document |
| `audio` | MP3, WAV, OGG, M4A, AAC, FLAC where Chromium has codec support | `<audio controls>`, no autoplay |
| `video` | MP4, WebM, OGV, MOV, M4V where Chromium has codec support | `<video controls>`, no autoplay |
| `unsupported` | unknown binary, Office/archive/executable in MVP | name/type/size/modified/display path + system-open action |

- Text reads are complete-or-error with an 8 MiB maximum. They read at most 8 MiB + 1 byte from the
  verified handle to detect concurrent growth and are never silently truncated.
- Text detection samples bytes and rejects NUL/control-heavy payloads. UTF-8 and BOM-marked UTF-16
  are supported; invalid required decoding returns an explicit error.
- HTML is displayed as source. User HTML never executes.
- A descriptor reports a mismatched signature or unsupported codec as a recoverable preview error.
- Monaco editor and model are both disposed on file changes and component unmount.
- Selection/copy/find remain enabled; mutation commands and ordinary keyboard input cannot modify
  the model. Electron E2E must prove a selected range can be copied and attempted input leaves the
  Monaco model byte-for-byte unchanged.

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
  showHiddenFiles: boolean;
  openFilesWithSingleClick: boolean;
}
```

Defaults are `light`, `13`, `false`, `false`, and `true`. A missing setting uses the defaults.
Malformed persisted settings are rejected, logged without values/paths, and recover to these
explicitly authorized defaults. `saveSettings` validates the entire value before one `SettingDao`
upsert and broadcasts the committed snapshot. Saving `showHiddenFiles` causes live Shells to
rebuild their current index; editor settings update live previews.

The Setting window has Preview, Project, and Appearance sections plus Cancel/Save. Appearance
shows Light as the only MVP theme. `Esc` closes without writing. The window is app-specific and
does not depend on Home Settings navigation.

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

### Packaged associations

`electron-builder.yml` registers the common verified MVP extensions. On macOS it also declares the
generic `public.data` document type with `role: Viewer` and `rank: Alternate`, so Finder can offer
OnlyPreview for files outside the extension list without claiming default ownership. Windows keeps
the common associations and the existing per-machine NSIS installer adds a generic
`*\\shell\\OnlyPreview` `Open in Bitterless` verb; uninstall removes exactly that verb. Runtime
routing accepts any regular file and shows its fallback surface for an unsupported type.

## Home And Omni Integration

- Home adds one visible `onlypreview` card and an XPC launch emitter. It uses the existing
  per-card in-flight guard.
- Auth invalidation and host quit explicitly destroy the standalone window, Setting window,
  views, workspaces, and tokens.
- Omni extends its typed mini-app allowlist, display URL map, runtime mapping, Control selection
  list, icon, i18n, contract tests, and documentation with `onlypreview`.
- Omni creates and registers a distinct OnlyPreview content `hostToken` per cell, loads
  `onlypreview/shell` with the OnlyPreview preload, `--mode=omni`, and that token, and uses
  `sandbox: true` for this mini app. Replace, close, renderer failure, and Omni destruction all
  revoke the cell host before closing its view. It fences top-level navigation and new-window
  requests exactly like every other privileged local mini app.
- The Omni instance does not open or depend on the standalone window.

## Layout And Visual Contract

```text
┌──────────────────────────────── OnlyPreview ─────────────────────────────┐
│ Open File · Open Folder   root/path                 Refresh · Settings   │
├──────────────────────┬───────────────────────────────────────────────────┤
│ PROJECT              │ selected/file.ts                 TypeScript · RO │
│ Search files…        ├───────────────────────────────────────────────────┤
│ ▾ src                │                                                   │
│   ▾ components       │ read-only preview surface                         │
│       FileTree.vue   │                                                   │
│   App.vue            │                                                   │
├──────────────────────┴───────────────────────────────────────────────────┤
│ INDEX READY · 1284 FILES                     UTF-8 · READ ONLY · 18 KB   │
└──────────────────────────────────────────────────────────────────────────┘
```

- Light-only canvas `#F6F7FA`, white preview surface, divider `#D9DDEA`, text `#25283A`, muted
  `#6F7487`, and canonical Bitterless Royal Blue `#4E5882` for focus/selection/Index Rail.
- UI uses platform system fonts at compact 12-13px sizing. Code uses `JetBrains Mono`, then
  `SFMono-Regular`, `Consolas`, and generic monospace fallbacks.
- The Index Rail is the single signature motion. It respects `prefers-reduced-motion`.
- Structural and repeated elements carry stable `name` attributes and `onlypreview`-rooted BEM
  classes with sibling Less files. No Tailwind utilities.
- Each column owns its scroll; root/grid children use `min-width: 0` and `min-height: 0`.
- The divider remains operable at 800×600. Main clamps reported and resized preview bounds to the
  actual 44px top bar, minimum 180px project column plus 5px divider, and 25px status rail, so a
  compromised renderer cannot cover Shell controls.

## Interaction Contract

| Input | Scope | Behavior |
|---|---|---|
| `Alt+1` | Shell | focus Project tree |
| double `Shift` | Shell | focus index search |
| `Space` | selected file in tree | preview selected file |
| single click | tree | preview only when setting is enabled; directories toggle |
| double click | tree | preview file or toggle directory |
| `Cmd/Ctrl+O` | Shell or Preview | Open File |
| `Cmd/Ctrl+Shift+O` | Shell or Preview | Open Folder |
| `Cmd+,` or `Ctrl+Alt+S` | Shell or Preview | open Setting window |
| `F5` or `Cmd/Ctrl+R` | Shell or Preview | rebuild index and refresh selected preview |
| `Cmd/Ctrl+F` | Monaco | find without invoking a Shell search |
| `Esc` | search / Setting | clear search / close without save |

Window-wide shortcuts use `before-input-event` on OnlyPreview webContents so they remain available
when Monaco has focus. Only matched commands prevent default; Monaco retains selection, copy, and
find behavior.

## State And Error Contract

- **Empty:** Open File/Open Folder actions and shortcuts are visible.
- **Indexing:** retain the last valid index and animate the Index Rail.
- **Index partial:** show the returned prefix and the fixed limit explanation.
- **Loading preview:** retain stable bounds and show a quiet progress state.
- **Missing/permission denied:** distinguish `PATH_NOT_FOUND` from `PATH_PERMISSION_DENIED`; the
  latter uses the user-facing message “Bitterless does not have permission to read this file or
  folder.” and offers index refresh where useful.
- **Too large:** show file metadata and the 8 MiB text limit; do not show partial text.
- **Unsupported:** show metadata plus Open externally and Reveal in folder.
- **Media/PDF error:** preserve the title and explain that Chromium codec/content support failed.
- **Stale async result:** ignore any result whose request generation is no longer current.
- **Explicit hidden file:** an explicitly opened file such as `.env` remains selected and
  previewable even while `showHiddenFiles` is false; the hidden policy applies to directory index
  discovery, not to the Main-authorized initial selection.

Required/unknown variants and invalid inputs fail with an explicit typed contract error. Optional
missing restoration returns `null`. Defaults/fallbacks are allowed only where this document names
them.

## Security And Privacy

- `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, `webSecurity: true`, and no
  `<webview>` for every OnlyPreview renderer.
- Never give arbitrary web content an OnlyPreview preload.
- Deny renderer top-level navigation and redirects away from its exact local target, and deny new
  windows.
- File operations are read-only and capability-scoped. No broad filesystem API is exposed.
- No file contents or absolute user paths are written to application logs.
- Media tokens are high entropy, bounded, revocable, and never persisted.
- The Content Security Policy is the first element in each built `<head>`. Its exact SHA-256 allows
  only Monaco's generated inline bootstrap, whose worker URLs resolve from nested OnlyPreview
  entries to the built root `monacoeditorwork` directory.
- The feature does not restore the removed historical broad filesystem window.

## Verification Contract

- Unit tests cover settings parsing, result-envelope preservation, host/workspace/media ownership
  and revocation, extension/signature/text classification, traversal bounds, ignore rules, natural
  sorting, path traversal, root/child replacement escapes, devices, missing versus permission
  errors, size limits, exact asset URL parsing, active stream revocation, and manual Range response
  semantics.
- Router tests cover macOS early `open-file`, packaged Windows initial/second-instance argv, helper
  exclusions, development explicit arguments, and serialized queue behavior.
- Source/integration tests cover three renderer entries, preload, sandboxed view preferences,
  explicit child-view cleanup, Home card, auth/quit cleanup, log policy, i18n registration, and
  Omni allowlist/runtime/UI mapping.
- Renderer verification covers stale-result suppression, read-only Monaco options and disposal,
  tree/preview/settings states, BEM/name markers, keyboard routing, and embedded-host adaptation.
- Electron E2E covers a fixture directory containing code, PDF, image, audio, video, and unknown
  files; verifies the standalone multi-view bounds, Setting singleton, Omni entry, and no edit path.
- `yarn build` must emit all three renderer HTML files and `out/preload/onlypreview.js`.
- Packaged manual verification remains required for OS association registration and the actual
  Chromium codec matrix on macOS and Windows.
