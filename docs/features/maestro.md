# Maestro Sub-application

Status: Current delivery contract

Upstream baseline: `projects/micromeet-cowork` commit
`689832d39e4b78f2717d5beedbe1c1c3f8db7f71` (2026-07-14).
Current MenuBar/control and fixed-local-tab parity reference: Cowork `dev/next` commit `19b0621`.

## Purpose

The runtime originally migrated from Micromeet Cowork is now the authenticated Bitterless
**primary window**. Home remains alive as a hidden authentication/bootstrap shell; after session
activation prepares Maestro successfully, Main hides Home and presents the singleton Maestro
window. Dock activation, tray Open, and a second application launch return to Maestro while that
session is active. Logout or invalidation destroys authenticated windows and returns to Home login.

Maestro also remains visible in the Workbench Apps catalog. Its Open action focuses the same
singleton rather than creating another window graph. Runtime state, packaged resources, and
persisted data remain intact across a normal close/reopen cycle.

This is a runtime migration, not a visual rewrite. Maestro's existing browser, chat, agent, capture,
Workbench, skill, file, integration, and model behavior stays intact unless this document assigns a
host responsibility explicitly.

## Boundary

Maestro is not a Vue route or one renderer. The embedded unit is its complete Electron window graph:

```text
┌──────────────────── Bitterless process ────────────────────────────────┐
│                                                                        │
│  Home renderer (login, token, bootstrap; hidden after activation)      │
│       │ AuthHandler.activateSession                                    │
│       ▼                                                                │
│  MaestroWindowHandler (authenticated primary singleton)               │
│       │                                                                │
│       ├── hidden Maestro SQLite BrowserWindow + isolated preload      │
│       │       └── config/tabs/chat/session/filter/injection DAOs       │
│       │                                                                │
│       └── Maestro BrowserWindow                                       │
│             ├── Home renderer (tabs, address bar, capture controls)    │
│             ├── fixed local Home (Mini Apps / Connector / Settings)    │
│             ├── operation WebContentsViews (unprivileged web pages)    │
│             ├── Control WebContentsView (Maestro chat)                │
│             └── Workbench WebContentsView                              │
│                   ├── native Maestro panes                             │
│                   ├── Apps / Connectors / Settings                     │
│                   └── Configuration (Claude accounts + Local model)    │
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
| Bitterless startup, with or without a valid persisted session | Create Home only as a hidden compatibility/auth host; open fully ready Maestro as the sole visible primary window. |
| Development hot reload or Main restart | Recreate/focus Maestro; never reveal the legacy Home `BrowserWindow`. |
| Session activation | Boot the hidden Maestro database, wait for localized Home mount plus required operation/Control/Workbench readiness, show Maestro, then keep Home hidden. |
| Mini Apps renders | Render the localized Maestro card in Workbench Apps; Open focuses the current singleton. |
| Repeated Open | Restore/focus the existing Maestro window; never create a second graph. |
| Window close | Stop or preserve work safely without quitting Bitterless; Dock/tray/second-instance activation recreates Maestro for the active session. |
| Bitterless auth invalidation/logout | Destroy authenticated secondary runtimes, then recreate/focus Maestro; legacy Home remains hidden. |
| Bitterless quit/update install | Stop Maestro schedulers/capture/agents and destroy Maestro windows before process exit. |
| `Cmd+Q` quit confirmation | Parent the dialog to the focused visible `BaseWindow`; never select or reveal hidden Home. If no visible owner exists, use an unparented app-modal dialog. |
| Home remains alive | Home retains compatibility customer-token, Todo-readiness, and renderer/XPC responsibilities without ever becoming a visible native window. |

Maestro keeps its large working size (`1360x900`) and never permits a window below `800x600`.
Window geometry follows the shared [top-level window state contract](window-state-persistence.md);
the legacy Cowork `cowork-main` entry is imported once when the unified Maestro key is absent.

## Feature parity surface

### Browser shell

- Pinned local Bitterless Home tab, ordinary web tabs, title/favicon/progress,
  add/activate/reorder/duplicate/close,
  address navigation, history, reload, popup interception, and native context menus.
- Ordinary-browser per-tab debugger attachment, warm-tab LRU management, browser-tab persistence,
  sidebar collapse, and Workbench overlay.
- Operation pages remain unprivileged and are automated through Chrome DevTools Protocol.

### Maestro chat and agents

- Persistent session/history management, streamed replies, thinking/activity state, abort, context
  compaction, Markdown, skill/replay cards, and generated file artifacts.
- AI-CRMS and OpenAI Codex provider/model/effort/compression selection with existing login flows.
  GPT-5.5 remains selectable and a stored GPT-5.5 target is preserved alongside GPT-5.6 Luna, Sol,
  and Terra; the new-install Codex default may remain GPT-5.6 Luna.
- Attach/drop/paste for supported text, image, PDF, Excel/CSV/TSV, and Word inputs; workspace-scoped
  file search/read/write; artifact open/reveal state.
- Voice recording and AI-CRMS transcription within the upstream five-minute limit.
- Maestro, Coach, and Delegate agent runtimes with host tool policy and approval history.

### Capture and Workbench

- UI/network/snapshot recording, debugger gating, filters, request-response folding, detail/timing/body
  inspection, replay, JSON/HAR export, curated evidence persistence, Preview, and Ingest.
- Skills browse/detail/import/export/open/delete/train/replay, domain injections, integration targets,
  mappings, dry-run/apply/readiness flows, app-open schedules, host tools, models, About, and Log.
- `Apps`, `Connectors`, and `Settings` embed the former Home surfaces inside Workbench. Home owns
  customer authentication and Todo readiness through a bounded metadata/command bridge; it never
  copies its token or browser storage into Maestro's Chromium partition.
- `Configuration` owns metadata-only Claude subscription accounts, isolated Claude CLI login,
  routing enablement/status, and the fixed `Local` provider/model/effort controls. It exposes only
  `http://127.0.0.1:8741/v1`; no API key or configurable remote endpoint is accepted.
- Bundled Micromeet CLI invocation and credential synchronization remain available to integration
  flows in packaged builds.

Current upstream limitations are parity, not migration defects:

- Connectors retain their existing management UI and runtime behavior; a unified connector inbox is
  still outside this migration.
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
| Claude subscription account metadata | Main-owned `userData/claude-subscription`; renderer never receives profile paths or credentials. |
| Local provider route | Fixed loopback `127.0.0.1:8741`; Pi receives no bearer header and no remote URL override. |
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

- The pinned Home tab loads only the dedicated bundled/local Maestro Home-content renderer with an
  XPC-only preload in the Maestro partition. Its visible address is `bitterless://home`; it never
  exposes or navigates to the real dev/file target, and ordinary website tabs never receive its
  preload.
- AI-CRMS authentication uses one closable, non-persisted, non-recordable login tab with no preload.
  Main confines it to the trusted AI-CRMS host and accepts login/logout bindings only from that
  trusted main frame. Closing, cooling, auth cleanup, and native-window shutdown invalidate pending
  preparation and detach the auth bridge before detaching its debugger and closing the view.
- Workspace/file tools retain root-boundary checks, size limits, explicit permissions, and approval
  policy. No credential value is written into the Bitterless repository or log output.
- Proxy credentials are never logged. When the user explicitly supplies an HTTP(S)/ALL proxy,
  Maestro may install its Undici dispatcher only for the lifetime of the Maestro runtime; teardown
  restores the previous dispatcher only when Maestro still owns the global slot. While Maestro is
  open, other Bitterless main-process Undici traffic follows that same explicit proxy setting.
- Bundled Micromeet CLI credentials use a random local key protected with restrictive filesystem
  permissions and an
  authenticated encryption envelope shared by the embedded runtime and bundled CLI. They must not
  be decryptable from a public constant plus the account email.
- Claude subscription credentials remain owned by the unmodified Claude CLI and the operating
  system credential store. Bitterless persists only account metadata and managed profile paths; it
  never extracts, encrypts, exposes, or injects Claude.ai tokens.
- SQLite boot failure rejects `openMaestroWindow()` with an explicit error and leaves Bitterless usable.
- Maestro uses Electron `safeStorage`/the operating-system keychain only in a packaged
  `VITE_MODE=release` runtime. Every unpackaged `VITE_MODE=debug` profile, including
  `VITE_ENV=prod`, keeps its own random 32-byte SQLCipher key in the isolated Maestro data root with
  owner-only permissions; E2E keeps its process-ephemeral random key. A command-line development or
  E2E run must never prompt for or access the macOS Keychain.
- Renderer load, capture attach, agent, or CLI failures remain visible through the existing Maestro
  error surfaces and must not wedge the host process.
- Source `.env` files, generated binaries, build outputs, signing material, and standalone update
  credentials are never copied from `micromeet-cowork`.

## Layout contract

```text
┌──────────────────────────── Maestro window ────────────────────────────┐
│ tab strip · tabs · new tab                         recording status    │
├────────────────────────────────────────────────────────────────────────┤
│ back forward reload | address | snapshot? | Control | Workbench | update│
├───────────────────────────────────────────────┬────────────────────────┤
│ operation web page                            │ Control / Maestro chat │
│                                               │ (collapsible)          │
│ Workbench replaces this region when visible:                           │
│ Capture … Models · Configuration · Apps · Connectors · Settings        │
└───────────────────────────────────────────────┴────────────────────────┘
```

Home, Control, and Workbench retain the upstream loading, empty, busy, error, and constrained states.
The Mini App card and migrated Maestro shell controls follow Bitterless theme and shared `en`/`zh`
i18n rules; the fixed Home-tab label also follows the active renderer language.

### Startup visibility and MenuBar geometry

For a persisted authenticated session, Home's BrowserWindow is created but does not inherit the
shared `ready-to-show` auto-reveal. Home is shown explicitly only when the public Login route mounts
or the authenticated-primary boot path fails. Maestro startup is bounded; a timeout destroys its
partial window graph and returns to Home instead of leaving the application with no visible window.

Maestro's localized Home renderer reports a post-mount render tick to Main. The primary window may
be shown only after that fence and the existing operation, Control, and Workbench readiness chain.

```text
┌──────────────────────── Maestro 36px tab strip ────────────────────────┐
│ macOS ● ● ●   pinned tab · browser tabs · +       recording status    │
├──────────────────────── address/actions 48px ──────────────────────────┤
│ navigation · address · snapshot? · Control · Workbench · update       │
├────────────────────────────────────────────────────────────────────────┤
│ operation surface                                      │ Maestro Chat │
└────────────────────────────────────────────────────────┴──────────────┘
```

The top strip keeps Omni Browser's Royal Blue visual treatment at `#4e5882`, with a `#3d4666`
bottom divider, while using the follow-up compact 36px geometry. Tabs and tab-row wrappers are 28px.
On macOS the native controls use `trafficLightPosition: { x: 12, y: 10 }` and content clears the same
78px traffic-light gutter. The address row remains 48px, so total top chrome is 84px. DOM-measured
placeholders remain the only owner of operation and Control native-view bounds.

### Per-tab page loading indicator

Maestro follows Cowork's per-tab loading model. The old simulated 2px progress bar is absent.
Each Main-owned tab carries transient `loading` state that is projected through the authoritative
tab snapshot; while true, a 16px loader replaces that tab's favicon without moving its title or
close control.

```text
idle      [ favicon  title                         × ]
loading   [ loader   title                         × ]
settled   [ favicon  title                         × ]
```

Loading events update the owning tab even when it is not active. Stop, main-frame failure,
renderer exit, view teardown, and reset clear the state. Every start rearms a Main-process
30-second watchdog; expiry ends only the visual hint and logs a warning. Loading is not persisted,
and no timer may outlive its tab or window.

The visible action rules follow the current compatible Cowork implementation. Debugger remains a
per-tab capability but has no MenuBar button. Recording start/stop remains agent-owned; the tab row
reserves a non-interactive status slot that is empty while idle and shows a red pulsing dot while
recording. Snapshot stays conditional on recording. Control uses outline/filled Sparkles,
Workbench uses outline/filled Settings, and both express active state with blue color only. The
Control header can broadcast `coach/sidebar-close`; Home subscribes once, persists the closed state,
and the Sparkles action remains the reopen path. The chat composer does not duplicate the Skills
entry; the Settings Workbench toggle remains the visible route to that pane.

The fixed first tab is a local `home` tab rather than the legacy remote `ai-crms` tab. Its dedicated
renderer opens Mini Apps by default and presents the existing 56px Home rail with only Mini Apps
and Connector visible; the local Settings route remains registered without a rail button. A local
no-auth router mounts only the existing Mini App and Settings pages; the Connector rail action opens
the existing Workbench Connector pane so its
preload and renderer remain the single runtime/handler owner. Chat, MessageSearch, the normal Home
router/login shell, MenuBar, update polling, and Home singleton subscribers are absent. Todo
delegates to the hidden Home shell for authenticated readiness, and this no-Chat surface hides the
legacy Chat-menu setting. The fixed view keeps an XPC-only preload, is pinned, address-locked,
non-recordable, confined to the local entry, and displays `bitterless://home` rather than a
dev-server URL or packaged file path. AI-CRMS provider/login code is not allowed to navigate or
replace this fixed tab.

The pinned Home tab favicon and the centered blank New-tab splash use one bundled Bitterless icon
derived from the canonical `build/icon.png` artwork. They do not reuse Maestro's blue `M` app logo;
arbitrary web tabs retain their page favicon or the existing generic fallback.

In a compiled debug runtime, the fixed Home view automatically opens one detached DevTools window
after its renderer finishes loading. The same guard runs when Home is reloaded or reactivated and
opens DevTools only when that view does not already have one, without stealing focus. Release and
E2E runtimes never auto-open fixed-Home DevTools; ordinary browser-tab debugging and the other
Maestro renderer DevTools policies remain independent.

This focused parity pass deliberately excludes Cowork's forked CRMS renderer, AI-CRMS avatar/profile
UI, generic mini-app page-type menus, update-progress protocol, and loading/crash tab-state
expansion. Maestro's localized updater, Demo controls, Control chat, Local provider, and browser
tabs remain authoritative.

## Verification contract

For the current consolidation delivery, Ral owns runtime and automated verification. The source
handoff intentionally does not run tests, type checks, lint, builds, Electron, Claude CLI, browser,
or network probes.

Automated gates for Ral to run:

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
