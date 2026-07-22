# Maestro Sub-application

Status: Current delivery contract

Upstream baseline: `projects/micromeet-cowork` commit
`689832d39e4b78f2717d5beedbe1c1c3f8db7f71` (2026-07-14).

## Purpose

The runtime originally migrated from Micromeet Cowork remains integrated as the Bitterless
**Maestro** Mini App, but its authenticated Home card and launch action are temporarily hidden.
The runtime, window graph, packaged resources, and persisted data stay intact for later reopening.
When the entry is restored, clicking **Open** creates one independent top-level window, and
subsequent clicks focus that same instance.

This is a runtime migration, not a visual rewrite. Maestro's existing browser, chat, agent, capture,
Workbench, skill, file, integration, and model behavior stays intact unless this document assigns a
host responsibility explicitly.

## Boundary

Maestro is not a Vue route or one renderer. The embedded unit is its complete Electron window graph:

```text
┌──────────────────── Bitterless process ────────────────────────────────┐
│                                                                        │
│  Home renderer / Mini Apps                                             │
│       │ Open                                                           │
│       ▼                                                                │
│  MaestroWindowHandler (singleton/focus/auth cleanup)                  │
│       │                                                                │
│       ├── hidden Maestro SQLite BrowserWindow + isolated preload      │
│       │       └── config/tabs/chat/session/filter/injection DAOs       │
│       │                                                                │
│       └── Maestro BrowserWindow                                       │
│             ├── Home renderer (tabs, address bar, capture controls)    │
│             ├── operation WebContentsViews (unprivileged web pages)    │
│             ├── Control WebContentsView (Maestro chat)                │
│             └── Workbench WebContentsView (overlay)                    │
│                                                                        │
│  Bitterless owns app/update/menu/quit/signing/installer lifecycle      │
└────────────────────────────────────────────────────────────────────────┘
```

The standalone Micromeet Cowork `app.main.ts` is not embedded. Maestro runtime initialization is
invoked through Bitterless's existing `app.whenReady()` and XPC center.

## Source layout

Maestro follows the existing Electron process architecture. There is no mixed-process
`src/cowork` or `src/maestro` root.

| Boundary | Source root |
|---|---|
| Main process | `src/main/maestro/` |
| Preload process | `src/preload/maestro/` |
| Renderer process | `src/renderer/maestro/` |
| Cross-process contracts | `src/shared/maestro/` |

The four renderer entries are `maestroHome`, `maestroControl`, `maestroWorkbench`, and
`maestroSqlite`, sourced directly from `src/renderer/maestro/`.

## User entry and lifecycle

| Event | Required behavior |
|---|---|
| Mini Apps renders | Do not render the Maestro card or Home launch action while the entry is dormant. |
| First Open | Boot the hidden Maestro database, then show the Maestro window only after required renderers are ready. |
| Repeated Open | Restore/focus the existing Maestro window; never create a second graph. |
| Window close | Stop or preserve work safely without quitting Bitterless; a later Open must produce a usable Maestro window. |
| Bitterless auth invalidation/logout | Destroy or lock the Maestro graph so authenticated content is not left visible. |
| Bitterless quit/update install | Stop Maestro schedulers/capture/agents and destroy Maestro windows before process exit. |
| Main app remains open | Closing Maestro must not close Todo, Omni Browser, or Bitterless Home. |

Maestro keeps its large working size (`1360x900`) and never permits a window below `800x600`.
Window geometry follows the shared [top-level window state contract](window-state-persistence.md);
the legacy Cowork `cowork-main` entry is imported once when the unified Maestro key is absent.

## Feature parity surface

### Browser shell

- Pinned AI-CRMS tab, ordinary web tabs, title/favicon/progress, add/activate/reorder/duplicate/close,
  address navigation, history, reload, popup interception, and native context menus.
- Per-tab debugger attachment, warm-tab LRU management, tab persistence, sidebar collapse, and
  Workbench overlay.
- Operation pages remain unprivileged and are automated through Chrome DevTools Protocol.

### Maestro chat and agents

- Persistent session/history management, streamed replies, thinking/activity state, abort, context
  compaction, Markdown, skill/replay cards, and generated file artifacts.
- AI-CRMS and OpenAI Codex provider/model/effort/compression selection with existing login flows.
- Attach/drop/paste for supported text, image, PDF, Excel/CSV/TSV, and Word inputs; workspace-scoped
  file search/read/write; artifact open/reveal state.
- Voice recording and AI-CRMS transcription within the upstream five-minute limit.
- Maestro, Coach, and Delegate agent runtimes with host tool policy and approval history.

### Capture and Workbench

- UI/network/snapshot recording, debugger gating, filters, request-response folding, detail/timing/body
  inspection, replay, JSON/HAR export, curated evidence persistence, Preview, and Ingest.
- Skills browse/detail/import/export/open/delete/train/replay, domain injections, integration targets,
  mappings, dry-run/apply/readiness flows, app-open schedules, host tools, models, About, and Log.
- Bundled Micromeet CLI invocation and credential synchronization remain available to integration
  flows in packaged builds.

Current upstream limitations are parity, not migration defects:

- Connector is a visible placeholder, not a completed connector inbox.
- Voice scribe audio over five minutes remains unsupported.

## Host substitutions

| Former standalone Cowork responsibility | Embedded contract |
|---|---|
| `app.whenReady`, app id, window-all-closed | Bitterless owns. |
| Maestro updater/feed and quit-and-install | Bitterless updater owns the executable; Maestro update UI consumes host update events. |
| Application menu and global Cmd/Ctrl shortcuts | Bitterless owns the menu; tab shortcuts are scoped to Maestro web contents only. |
| Global console replacement | Bitterless owns process logging; Maestro Log view resolves the host-approved log location. |
| Standalone `userData` root | Maestro uses a namespaced directory and persistent Chromium partition under Bitterless. |
| Standalone packaging/signing | Bitterless packaging includes Maestro renderers, native dependencies, CLI resource, permissions, and entitlements. |

Maestro's main bundle depends on runtime `import()` and `Function.prototype.toString()` for parser and
CDP injection paths. Therefore the Bitterless main build must not apply Electron V8 bytecode to this
bundle. This is a functional requirement, not an optional optimization.

## State and isolation

Maestro state must not collide with existing Bitterless paths such as `skills/`, `db/`, or the
default renderer session.

| State | Embedded owner/path rule |
|---|---|
| Maestro encrypted SQLite/key/bootstrap token | Legacy-compatible `userData/cowork` directory. |
| Skills, API profiles, traces, attachments, artifacts, demo data | Same legacy-compatible data root. |
| Browser cookies/storage/cache | Legacy-compatible `persist:bitterless-cowork` partition. |
| Pi auth/model files | Maestro data root; never Bitterless chat model files. |
| Window and pane preferences | Legacy-compatible Maestro keys/files. |
| CLI shim/credential envelope | existing `~/.micromeet` contract, initialized idempotently. |

The hidden database XPC handler names are namespaced wherever they collide with Bitterless. In
particular, Maestro's auth-session DAO must not register as Bitterless's existing `SessionDao`.

Existing standalone Micromeet Cowork data is not deleted. The embedded app starts with an isolated
profile; importing a live standalone profile is outside this delivery because copying an open
encrypted/WAL database is unsafe. Users may need to sign in once in the embedded profile.

The product name, source folders, TypeScript symbols, Vite entries, XPC feature handlers, tests, and
icon filenames use `Maestro`. The literals `userData/cowork`, `persist:bitterless-cowork`,
`cowork_chat_*`, chat source `cowork`, host-tool scope `cowork`, and CLI auth source `cowork` remain
only as compatibility identifiers. Renaming those values requires an explicit profile/schema
migration and is outside this source-layout change.

Because the embedded profile is new, it must not retain the standalone application's fixed legacy
SQLCipher fallback. If an embedded `config.db` exists without its generated key file, startup fails
closed with a recoverable error instead of trying a known key. Test-only key behavior must be
unavailable in packaged builds.

## Security and errors

- The AI-CRMS document-start auth bridge attaches only to the pinned trusted AI-CRMS host.
- Workspace/file tools retain root-boundary checks, size limits, explicit permissions, and approval
  policy. No credential value is written into the Bitterless repository or log output.
- Proxy credentials are never logged. When the user explicitly supplies an HTTP(S)/ALL proxy,
  Maestro may install its Undici dispatcher only for the lifetime of the Maestro runtime; teardown
  restores the previous dispatcher only when Maestro still owns the global slot. While Maestro is
  open, other Bitterless main-process Undici traffic follows that same explicit proxy setting.
- CLI credentials use a random local key protected with restrictive filesystem permissions and an
  authenticated encryption envelope shared by the embedded runtime and bundled CLI. They must not
  be decryptable from a public constant plus the account email.
- SQLite boot failure rejects `openMaestroWindow()` with an explicit error and leaves Bitterless usable.
- Maestro uses Electron `safeStorage`/the operating-system keychain only when `VITE_ENV=prod`.
  Development profiles keep their own random 32-byte SQLCipher key in the isolated Maestro data
  root with owner-only permissions; E2E keeps its process-ephemeral random key. A development run
  must never prompt for or access the macOS Keychain.
- Renderer load, capture attach, agent, or CLI failures remain visible through the existing Maestro
  error surfaces and must not wedge the host process.
- Source `.env` files, generated binaries, build outputs, signing material, and standalone update
  credentials are never copied from `micromeet-cowork`.

## Layout contract

```text
┌──────────────────────────── Maestro window ────────────────────────────┐
│ tab strip                                                              │
├────────────────────────────────────────────────────────────────────────┤
│ back forward reload | address | debugger capture sidebar workbench     │
├───────────────────────────────────────────────┬────────────────────────┤
│ operation web page                            │ Control / Maestro chat │
│                                               │ (collapsible)          │
│ Workbench replaces this region when visible   │                        │
└───────────────────────────────────────────────┴────────────────────────┘
```

Home, Control, and Workbench retain the upstream loading, empty, busy, error, and constrained states.
The Mini App card itself follows Bitterless theme and `en`/`zh` i18n rules. The migrated Maestro UI
keeps its current upstream English copy during parity migration; localization is a separate product
change and must not block runtime parity.

## Verification contract

Automated gates:

- `git diff --check`
- `yarn typecheck:node`
- `yarn typecheck:web`
- `yarn build`
- `yarn check:maestro` parity checks for startup, tabs, capture, chat, files, skills, agents,
  auth, integrations, and packaging paths
- Playwright Electron baseline launched through Bitterless and opening Maestro from Mini Apps

Manual/package gates:

- First Open and repeat-focus behavior; close/reopen without host impact.
- All four Maestro render surfaces load and resize correctly.
- AI-CRMS/Codex login, chat streaming/abort, attachments/workspace/artifacts, capture/replay/export,
  skills/injections/integrations/tools/models.
- macOS arm64/x64 and Windows packaged native SQLite ABI, CLI extra resource, signing/entitlements,
  folder/microphone permissions, and update installation.
- Authentication invalidation and Bitterless quit clean up Maestro without leaking privileged content.
