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
| Workspace capabilities, containment, index, descriptor, text reads | Main OnlyPreview file service |
| Media/PDF byte streaming | Main token registry + `bitterless-preview://` protocol |
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

The preload imports `electron-xpc/preload` and exposes only immutable mode/platform context through
`contextBridge`. Every entry initializes renderer language before Vue mount. All three entries are
first-party local targets and must be registered in the application log policy and i18n checker.

## Workspace Capability Contract

`electron-xpc` Main dispatch does not retain a trustworthy sender identity. Therefore no renderer
method accepts an arbitrary absolute file path.

```text
OS event or native Open dialog
        |
        v
Main realpath/stat validation
        |
        v
random workspaceId ──> Main-owned { rootRealPath, selectedRelativePath? }
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
- Symbolic links may appear as leaf metadata but are never recursively indexed. Selecting a
  symlink whose target escapes the root fails with a typed containment error.
- Capabilities have a bounded count and are revoked when their host is destroyed or the
  application quits.
- Returned display paths are presentation metadata. They cannot be supplied back as read authority.

The Main API surface is read-only:

```ts
interface OnlyPreviewApi {
  chooseTarget(params: { kind: 'file' | 'directory' }): Promise<OnlyPreviewWorkspace | null>;
  restoreWorkspace(): Promise<OnlyPreviewWorkspace | null>;
  buildIndex(params: { workspaceId: string }): Promise<OnlyPreviewIndex>;
  describeFile(params: OnlyPreviewFileRef): Promise<OnlyPreviewDescriptor>;
  readText(params: OnlyPreviewFileRef): Promise<OnlyPreviewTextContent>;
  selectStandaloneFile(params: OnlyPreviewFileRef): Promise<void>;
  updatePreviewBounds(params: OnlyPreviewBounds): Promise<void>;
  openExternally(params: OnlyPreviewFileRef): Promise<void>;
  revealInFolder(params: OnlyPreviewFileRef): Promise<void>;
  getSettings(): Promise<OnlyPreviewSettings>;
  saveSettings(params: OnlyPreviewSettings): Promise<OnlyPreviewSettings>;
  openSettings(): Promise<void>;
  closeSettings(): Promise<void>;
}
```

Every method accepts zero or one object parameter to preserve the `electron-xpc` contract.

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

If the bound is reached, Main returns the valid prefix with `truncated: true`; the Shell shows
`INDEX PARTIAL`. A newer index request supersedes stale renderer results. Refresh explicitly
rebuilds the index; no watcher is created in the MVP.

## Preview Classification And Rendering

| Kind | MVP inputs | Renderer |
|---|---|---|
| `text` | common source/config/prose/log types; extensionless or unknown sample that passes text detection | Monaco `vs`, `readOnly`, `domReadOnly`, selectable text, syntax map, find |
| `pdf` | `.pdf` with matching signature | Chromium PDF surface over tokenized stream |
| `image` | PNG, JPEG, GIF, WebP, AVIF, BMP, ICO, SVG | `<img>` contain; SVG never becomes a top-level executable document |
| `audio` | MP3, WAV, OGG, M4A, AAC, FLAC where Chromium has codec support | `<audio controls>`, no autoplay |
| `video` | MP4, WebM, OGV, MOV, M4V where Chromium has codec support | `<video controls>`, no autoplay |
| `unsupported` | unknown binary, Office/archive/executable in MVP | name/type/size/modified/display path + system-open action |

- Text reads are complete-or-error with an 8 MiB maximum. They are never silently truncated.
- Text detection samples bytes and rejects NUL/control-heavy payloads. UTF-8 and BOM-marked UTF-16
  are supported; invalid required decoding returns an explicit error.
- HTML is displayed as source. User HTML never executes.
- A descriptor reports a mismatched signature or unsupported codec as a recoverable preview error.
- Monaco editor and model are both disposed on file changes and component unmount.
- Selection/copy/find remain enabled; mutation commands cannot modify the model.

## Tokenized Asset Protocol

Main registers `bitterless-preview` as a privileged, standard, secure, fetch-capable, streaming
scheme before `ready`, then installs `protocol.handle` after `ready`.

`describeFile` issues a random, bounded asset token only for files authorized by a workspace
capability. A URL contains the token and a display-only filename, never an absolute path. The
handler resolves the token to a Main-owned real path and delegates to `net.fetch(file:)`, forwarding
Range headers needed for audio/video seeking and PDF access. Unknown, expired, or malformed tokens
return a non-content response.

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

`electron-builder.yml` registers the verified MVP extensions. On macOS associations use
`role: Viewer` and `rank: Alternate`; Windows uses the existing per-machine NSIS install. The app
does not claim default ownership. Runtime routing still accepts an unsupported regular file and
shows its fallback surface.

## Home And Omni Integration

- Home adds one visible `onlypreview` card and an XPC launch emitter. It uses the existing
  per-card in-flight guard.
- Auth invalidation and host quit explicitly destroy the standalone window, Setting window,
  views, workspaces, and tokens.
- Omni extends its typed mini-app allowlist, display URL map, runtime mapping, Control selection
  list, icon, i18n, contract tests, and documentation with `onlypreview`.
- Omni loads `onlypreview/shell` with the OnlyPreview preload and `--mode=omni`. It fences top-level
  navigation and new-window requests exactly like every other privileged local mini app.
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
- The divider remains operable at 800×600. Shell preview bounds never become negative or overlap
  the status rail.

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
- **Missing/permission denied:** identify the exact category and offer index refresh where useful.
- **Too large:** show file metadata and the 8 MiB text limit; do not show partial text.
- **Unsupported:** show metadata plus Open externally and Reveal in folder.
- **Media/PDF error:** preserve the title and explain that Chromium codec/content support failed.
- **Stale async result:** ignore any result whose request generation is no longer current.

Required/unknown variants and invalid inputs fail with an explicit typed contract error. Optional
missing restoration returns `null`. Defaults/fallbacks are allowed only where this document names
them.

## Security And Privacy

- `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, `webSecurity: true`, and no
  `<webview>` for every OnlyPreview renderer.
- Never give arbitrary web content an OnlyPreview preload.
- Deny renderer top-level navigation away from its exact local target and deny new windows.
- File operations are read-only and capability-scoped. No broad filesystem API is exposed.
- No file contents or absolute user paths are written to application logs.
- Media tokens are high entropy, bounded, revocable, and never persisted.
- The feature does not restore the removed historical broad filesystem window.

## Verification Contract

- Unit tests cover settings parsing, extension/signature/text classification, traversal bounds,
  ignore rules, natural sorting, path traversal, symlink escape, devices, missing paths, and size
  limits.
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

