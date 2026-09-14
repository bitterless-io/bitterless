# Maestro Sub-application

Status: Current delivery contract

### Control warm surface — 2026-09-10

BL/Cowork Control chat uses subtly warm white `#FFFCF7` against the unchanged cool gray
`#F8FAFC` outer rail. Card, header, messages and composer backing form one continuous surface;
transparent inner layers prevent white patches. Focused text input uses the same warm white.
Keep existing typography, geometry, cool message/control fills and blue focus shadow; no new
borders or global theme changes. Guard: `tests/maestro/controlWarmSurface.test.mjs`.

Upstream baseline: `projects/micromeet-cowork` commit
`689832d39e4b78f2717d5beedbe1c1c3f8db7f71` (2026-07-14).
Current MenuBar/fixed-local-tab parity reference: Cowork `dev/next` commit `19b0621`.
Current Control-chat parity source: Cowork `dev/next` commit
`67b056bc08ac345d223a69fb3f954613f3e588d3` (2026-08-31).

### Control-chat context structure — ported 2026-09-09 (Ral: 「bitterless 也做下,先做文档然后做」)

`/view_context_graph` 把「此刻的上下文」画成面板内一张半透明的竖向块栈:system prompt 起头,每块带
类型色轨 + 与字符数成比例的体量条,按**上下文回合**吸顶分组;点 user / assistant 块跳到聊天里那条消息
并闪 1.6s,界面上没有载体的块**不可点**。契约与八处刻意偏离见
[`maestro-context-graph.md`](./maestro-context-graph.md);cowork 侧的上游契约是
`micromeet-cowork/docs/features/cowork-context-graph.md`。

- 结构在 **main** 生成(`main/agent/contextGraph.service.ts`),渲染层一个字都不算 —— 渲染层的上下文
  投影是**预算账**,没有工具调用与工具返回的正文,而那是窗口里最大的一块。
- 压缩边界用**本仓自己的** `compactionBoundary()`,不移植 cowork 的 `absorbedBoundaryIndex()`:
  `firstKeptEntryId` 认不到任何条目时它退到上一条 compaction 之后(与 pi 一致),而 cowork 那版退成 0
  = 报告"什么都没被吸收"。**这条差异要回流给 cowork**(记在契约 #8)。
- 认领「哪一块对应界面上哪条消息」在 main 做:`user` 条目的正文是整块拼装后的 turn prompt,不是用户
  那句话,所以渲染层只送每条消息正文的前 200 字符(`CONTEXT_GRAPH_MATCH_HEAD_CHARS`,两侧共享一个数),
  main 用 `includes` + 只前进的游标认领,认领不到就留空 —— **错链比不可点糟得多**。
- 没有 jsonl 页脚:`setModelIoRoot()` 在本仓无调用点,那条证据链是死的
  (`docs/issues/maestro-model-io-chain-is-dead.md`)。
- 守卫 `scripts/maestro/check-context-graph.mjs`(18 个变异全部被捕获);umbrella 计数 42 → 43。

### Control-chat link policy — ported 2026-09-08 (Ral: 「做 A,把 bitterless cowork 同步做」)

A web link in a chat reply now becomes a **new tab in the operation view**. Before this, the Control
`WebContentsView` had **no** `setWindowOpenHandler` and **no** navigation fence — the only unfenced
surface of its kind here — so `markstream-vue`'s `target="_blank"` fell through to Electron's
built-in path and opened a **bare `BrowserWindow`**. That was nobody's decision, just the default of
a missing hook, and this is the worst view in the app to leave open: it carries `maestroCoach.js`
with `sandbox: false` on a persistent partition, so a window created off it inherits a preload that
exposes `xpcRenderer`.

As of the 2026-09-14 decision, opening or switching operation tabs keeps the selected chat and its
draft/history. Only explicit New Chat/history actions change the conversation. A later message
still receives the current page context and site instructions, including steering during a turn;
fixed system instructions and the model session are not rebuilt on tab changes. Link activation
also dismisses its URL tooltip. See [tab/chat and tooltip contract](../issues/reference-link-tab-chat-tooltip.md).

- Policy lives in `main/maestro/windows/main/maestroControlLinkPolicy.ts`, installed from
  `maestroControlView.service.ts` `create()` against the url the view actually loads.
- `http(s)` **and not the panel's own origin** → `openTab`; everything else (`file:`, `data:`,
  `javascript:`, `about:`, `bitterless-preview:`) is denied. The own-origin arm is load-bearing: a
  produced-file link's href is a bare absolute path, so a middle-click resolves it against the
  panel's origin and in dev that is http(s).
- `will-navigate` / `will-redirect` are fenced too, allowing only the panel reloading itself
  (exact url, or same origin when the origin is not the string `'null'` — `file://` origins are).
- **In main, not in the renderer's click handler**, because a delegated `click` listener never sees
  a middle-click (`auxclick`), a `Cmd`/`Ctrl`+click, `window.open()`, or a `<form target="_blank">`.
  The renderer is unchanged.
- Cowork is the parity source for this file. `scripts/maestro/check-control-link-policy.mjs` runs the
  real predicates and, when a cowork checkout is present, asserts the two policies are **byte-equal**
  after stripping comments and normalising the app name; the exported symbol names are deliberately
  identical in both repos so that equality is real rather than normalised away.
- Not covered: a `micromeet://`-style mini-app display url. Cowork denies it too — routing it needs
  `parseMiniappDisplayUrl` + `newTab({ kind: 'miniapp' })`, which is cowork-only and would break the
  byte-equality above. Design record: cowork `docs/features/cowork-reply-file-links.md` #6 and
  overmind `areas/agent-runtime/chat/links-in-message.html` #6.

## Purpose

The runtime originally migrated from Micromeet Cowork is now Bitterless's sole visible **primary
window**, whether the customer is signed in or signed out. The legacy Home renderer remains alive
as a permanently hidden authentication/bootstrap authority. Its token-free bridge drives the fixed
`bitterless://home` tab: signed-out and recovery states render the existing Login experience, while
only an active password-complete session renders the Mini Apps workspace. Dock activation, tray
Open, a second application launch, logout, and invalidation all keep Maestro visible and never
reveal the legacy Home `BrowserWindow`.

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
│  legacy Home renderer (token/auth/bootstrap authority; always hidden) │
│       │ token-free HomeShellBridge + AuthHandler lifecycle             │
│       ▼                                                                │
│  MaestroWindowHandler (sole visible primary singleton)                │
│       │                                                                │
│       ├── hidden Maestro SQLite BrowserWindow + isolated preload      │
│       │       └── config/tabs/chat/session/filter/injection DAOs       │
│       │                                                                │
│       └── Maestro BrowserWindow                                       │
│             ├── Home renderer (tabs, address bar, capture controls)    │
│             ├── fixed local Home (Login or Mini Apps / Connector)      │
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
| Bitterless startup, with or without a valid persisted session | Create Home only as a hidden compatibility/auth host; open fully ready Maestro as the sole visible primary window. Fixed Home subscribes, reads current auth state, and shows Login until an active session is confirmed. |
| Development hot reload or Main restart | Recreate/focus Maestro; never reveal the legacy Home `BrowserWindow`. |
| Session activation | Boot authenticated runtimes, keep legacy Home hidden, broadcast the token-free snapshot, and switch fixed Home from Login to Mini Apps. |
| Mini Apps renders | Render the localized Maestro card in Workbench Apps; Open focuses the current singleton. |
| Repeated Open | Restore/focus the existing Maestro window; never create a second graph. Record whether the request reused the singleton, joined a boot, or started a cold boot. |
| Window close | Hide and preserve the live Maestro window graph; Dock/tray/second-instance/Mini Apps Open restores and focuses the same singleton without a cold boot. |
| Bitterless auth invalidation/logout | Destroy authenticated secondary runtimes, recreate/focus Maestro when needed, and switch fixed Home to Login; legacy Home remains hidden. |
| Bitterless quit/update install | Stop Maestro schedulers/capture/agents and destroy Maestro windows before process exit. |
| `Cmd+Q` quit confirmation | Parent the dialog to the focused visible `BaseWindow`; never select or reveal hidden Home. If no visible owner exists, use an unparented app-modal dialog. |
| Home remains alive | Legacy Home retains customer-token, auth HTTP, Todo-readiness, and renderer/XPC responsibilities without ever becoming a visible native window. Fixed Home receives only strict presentation snapshots and addressed commands. |

Maestro keeps its large working size (`1360x900`) and never permits a window below `800x600`.
Window geometry follows the shared [top-level window state contract](window-state-persistence.md);
the legacy Cowork `cowork-main` entry is imported once when the unified Maestro key is absent.

Main emits a fixed `[maestro-open]` timing timeline into the existing profile `main.log`. One short
request ID and, for cold boots, one shared boot ID correlate cleanup, route selection, SQLite load
and preload readiness, Session, Shell, fixed Home, Control, Workbench, all-ready, and final show.
Only fixed enums and monotonic durations are recorded; URLs, paths, tabs, sessions, accounts,
tokens, renderer values, and raw errors are forbidden.

## Feature parity surface

### Browser shell

- Pinned local Bitterless Home tab, ordinary web tabs, title/favicon/progress,
  add/activate/reorder/duplicate/close,
  address navigation, history, reload, popup interception, and native context menus.
- Ordinary-browser per-tab debugger attachment, warm-tab LRU management, browser-tab persistence,
  sidebar collapse, and a singleton closable Workbench tab. The gear only opens it and has no
  selected state; its existing native view survives tab closure, preserving recording state. See
  [Workbench tab 167](../plan/tasks/maestro-workbench-tab-167.md).
- Composite Mini App tabs publish their registered display URL/title through the same navigation
  updates as ordinary tabs. OnlyPreview activation must not retain `bitterless://home`; see
  [composite tab address 145](../plan/tasks/onlypreview-composite-tab-address-145.md).
- Operation pages remain unprivileged and are automated through Chrome DevTools Protocol.

### Maestro chat and agents

- Persistent session/history management, per-session Turn lifecycle, streamed replies, in-turn
  steering, retry/status feedback, inactivity watchdog, abort, context compaction, Markdown,
  skill/replay cards, chronological task/confirmation entries, and generated file artifacts.
- The Cowork `67b056b` chat-core and file vertical slices are implemented under
  [tasks 089](../plan/tasks/maestro-cowork-chat-core-089.md) and
  [090](../plan/tasks/maestro-cowork-chat-files-090.md); both independent reviews report no
  unresolved P0-P2 findings, with runtime/E2E acceptance owned by Ral.
- Maestro Control omits the Local (`local`) choice. Previously saved targets remain labelled but
  disabled until an explicit provider selection; no automatic provider switch or configuration
  rewrite. Shared backend/Workbench providers are unaffected (task159).
  Other provider/model/effort/compression selection retains the existing login flows.
  Effort choices in Control and Workbench are ordered strongest first: max → xhigh → high → medium → low,
  showing only each model's supported levels; saved choices and declared defaults do not change.
  Codex choices, top to bottom, are GPT-6 Astra, GPT-5.6 Sol, GPT-5.6 Terra, and GPT-5.6 Luna
  (Ral 2026-09-14). The default remains Astra at medium. Saved GPT-5.4 Mini targets migrate to
  Luna with supported effort preserved; Mini is no longer selectable. See
  [retired Mini migration](../issues/cowork-codex-gpt54-mini-retired.md).
- Unified attachment cards and attach/drop/paste for supported files and directories, bounded image
  thumbnails, archive operations, bundled-CLI document conversion, workspace-scoped file
  search/read/write, and artifact open/reveal state.
- The composer workspace name opens that directory in OnlyPreview via the registered host opener,
  reusing a live tab/window or opening a tab in the current browser. Switching workspace has its
  own icon action; Clear and the empty-state Set workspace remain unchanged. The BL-only
  [composer cleanup 149](../plan/tasks/maestro-composer-cleanup-149.md) removes Refresh. The
  [workspace control 158](../plan/tasks/maestro-workspace-ui-158.md) now matches Cowork's fixed 26px
  height and 280px maximum width, truncating long names while preserving the full-path tooltip. See
  [workspace preview 138](../plan/tasks/onlypreview-cowork-workspace-preview-138.md).
- New/recovered empty BL chats do not insert a synthetic greeting. Real conversation and recovery
  messages remain intact; the existing composer remains the entry point for an empty chat.
- Maestro, Coach, and Delegate agent runtimes with host tool policy and approval history.

### Capture and Workbench

- UI/network/snapshot recording, debugger gating, filters, request-response folding, detail/timing/body
  inspection, replay, JSON/HAR export, curated evidence persistence, Preview, and Ingest.
- Skills browse/detail/import/export/open/delete/train/replay, domain injections, app-open
  schedules, host tools, models, About, and Log.
- `Apps`, `Connectors`, and `Settings` embed the former Home surfaces inside Workbench. Home owns
  customer authentication and Todo readiness through a bounded metadata/command bridge; it never
  copies its token or browser storage into Maestro's Chromium partition.
- Workbench `Settings` contains a dedicated inner `Account` category after `General`. It reads only
  the current email from the token-free Home bridge and owns the visible Logout action; General no
  longer mixes account lifecycle controls with preferences. Successful logout closes Workbench and
  leaves Maestro on its pinned fixed Home Login surface, never on a restored web or startup tab.
- `Configuration` owns metadata-only Claude subscription accounts, isolated Claude CLI login,
  routing enablement/status, and the fixed `Local` provider/model/effort controls. It exposes only
  `http://127.0.0.1:8741/v1`; no API key or configurable remote endpoint is accepted.

### Bundled external tools

Maestro's standalone executables and native document converter are application resources, not
JavaScript dependencies. `yarn tools:init` prepares the pinned Bun, ripgrep, fd, Ouch, Zellij, and
AnyDoc inventories for `mac_arm`, `mac_intel`, and `win` under the gitignored `external_tools/`
store, then stages/verifies the current host for development. Initialization verifies existing
payloads first and downloads only missing or invalid tool/archive units; valid stores and staged
dependencies remain untouched on repeated runs. The
[initialization/readiness contract](terminal-zellij-distribution.md) defines incremental repair.
Development and packaging never download tools: DEBUG dev/build/start ensures the host stage
offline, while packaging ensures its selected target at `build/maestro-tools`, which Electron
Builder installs as `Resources/maestro-tools`.

Only the target platform enters an application bundle. `external_tools/**` and the legacy
`prebuilt/**` cache are excluded from `app.asar`; macOS executable/native entries remain in the
explicit signing inventory. AnyDoc and Ouch consume these resource paths today. Bun, ripgrep, and
fd are pre-positioned for migrated Maestro capabilities but this packaging contract does not enable
pi builtins, change process-global pi offline/model behavior, or introduce a Bun skill runner.
Zellij `0.45.1` is pre-positioned for Terminal integration; distribution does not start a server
or change the default-off [Terminal setting](terminal-toggle.md).
Operator initialization, package ordering, upgrades, and recovery are defined in the
[Maestro CLI executable installation guide](../guides/maestro-cli-executable-installation.md).

Current upstream limitations are parity, not migration defects:

- Connectors retain their existing management UI and runtime behavior; a unified connector inbox is
  still outside this migration.
- Cowork's five-segment context-compaction replacement remains deferred in Maestro until its own
  real-session acceptance and projection contract are complete; this chat parity delivery preserves
  Maestro's current compaction behavior.

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

The hidden database XPC handler names are namespaced wherever they collide with Bitterless: a
Maestro DAO must never register under a channel name Bitterless already owns.

Existing standalone Micromeet Cowork data is not deleted. The embedded app starts with an isolated
profile; importing a live standalone profile is outside this delivery because copying an open
encrypted/WAL database is unsafe. Users may need to sign in once in the embedded profile.

The product name, source folders, TypeScript symbols, Vite entries, XPC feature handlers, tests, and
icon filenames use `Maestro`. The literals `userData/cowork`, `persist:bitterless-cowork`,
`cowork_chat_*`, chat source `cowork`, host-tool scope `cowork`, and CLI auth source `cowork` remain
only as compatibility identifiers. Renaming those values requires an explicit profile/schema
migration and is outside this source-layout change.

The vendored Micromeet CLI and its per-channel shim/credential layout were removed with the
AI-CRMS retirement (2026-09); Maestro no longer ships or invokes an external CLI. Maestro's handler
modules remain process-level imports and are not repeatedly registered by a retried open.

Because the embedded profile is new, it must not retain the standalone application's fixed legacy
SQLCipher fallback. If an embedded `config.db` exists without its generated key file, startup fails
closed with a recoverable error instead of trying a known key. Test-only key behavior must be
unavailable in packaged builds.

## Security and errors

- The pinned Home tab loads only the dedicated bundled/local Maestro Home-content renderer with an
  XPC-only preload in the Maestro partition. Its visible address is `bitterless://home`; it never
  exposes or navigates to the real dev/file target, and ordinary website tabs never receive its
  preload.
- The AI-CRMS provider was retired in 2026-09; its dedicated login tab, auth bridge, and credential
  chain are gone. The isolation contract they carried is archived in
  [AI-CRMS 退役前的安全契约](../issues/maestro-crms-retirement-security-record.md).
- Workspace/file tools retain root-boundary checks, size limits, explicit permissions, and approval
  policy. No credential value is written into the Bitterless repository or log output.
- Proxy credentials are never logged. When the user explicitly supplies an HTTP(S)/ALL proxy,
  Maestro may install its Undici dispatcher only for the lifetime of the Maestro runtime; teardown
  restores the previous dispatcher only when Maestro still owns the global slot. While Maestro is
  open, other Bitterless main-process Undici traffic follows that same explicit proxy setting.
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

### Workspace control appearance — 2026-09-08

Task158 follows Cowork's compact32px control rhythm,12px semibold name,6px icon gap,8px name
padding and28px action widths. Separate Open/path, Switch and Clear tooltips replace the group
tooltip. The screenshot follow-up uses Cowork's bright blue#165dff only for this workspace control,
with fine neutral borders, restrained hover and visible keyboard
focus. Name height remains content-driven and wraps without ellipsis, unlike Cowork's260px cap.
Only appearance changes; task149/155 actions, confirmation, guards and two-row footer remain.
The32px single-line outer box includes its border; internal segments are30px and square, with
rounded clipping owned only by the outer shell. The explicit workspace-content span owns the6px
icon/name gap, independent of Arco's internal DOM. Local selectors override shared Arco rounding
and ControlApp font weights without changing any global button theme.

```text
[folder full workspace name | switch | clear] [attach]
```

### Composer and history interaction parity — 2026-09-08

The later [slash-command contract](maestro-slash-commands.md) adds Cowork-style `/clear` and
`/view_context` above the composer. It preserves BL's prompt semantics;
it does not enable Cowork's separate JSONL audit subsystem.

Ral requested Cowork's bottom composer and Chat History interactions/shortcuts. Keep BL's
Royal Blue/i18n and existing model/turn persistence, migrate the UI interaction slice only.

```text
message input
[Choose workspace / full selected name] [Attach]
             [provider / model / effort] [Stop OR Send]
```

Use two stable rows at all Chat widths rather than container-dependent wrapping. Workspace
precedes attachment; the selected name stays fully readable/wrappable (task149), Refresh remains
absent, empty-state workspace has a meaningful Choose workspace action, and clearing the workspace
requires the same confirmation as Cowork. Stop and Send are mutually exclusive according to the
current turn state. Hide the redundant context meter to match Cowork; do not remove its data/model
logic. Existing provider/model/effort popup content stays unchanged.

History uses the current persisted BL list, with a distinct active-conversation marker and keyboard
cursor. Opening initializes the cursor at the current session (or first row); Up/Down wrap through
rows, Enter selects, Esc closes. Selecting the already active chat is a no-op; pointer hover does
not replace the keyboard cursor. History and New Chat shortcuts follow Cowork (Cmd/Ctrl+H and
Cmd/Ctrl+N); new chat focuses its composer. Scope handling to the active Maestro chat, respecting
IME and not stealing shortcuts from other app surfaces. The 2026-09-14
[New chat contract](../plan/tasks/browseruse-new-chat-003.md) removes the running-turn restriction
for New chat and its /clear alias; other turn-locked controls keep their existing behavior.
Do not invent unavailable unread/concurrent-turn or permanent-delete data. Delivery: task155.

Native shortcut arbitration is scoped to Maestro Control's `webContents`: exact Cmd/Ctrl+H/N
temporarily ignore application-menu accelerators while leaving DOM key events intact; other input
restores normal menu handling. This prevents macOS Hide from swallowing History without changing
the global menu. Use Electron's documented
[`before-input-event` / `setIgnoreMenuShortcuts`](https://www.electronjs.org/docs/latest/api/web-contents/#event-before-input-event).

### Chat width handle — 2026-09-08

Ral requested Cowork-equivalent resizing. The left edge of the Chat's own renderer contains an
8px-wide, full-height pointer handle. Width clamps to Cowork's current **380–480px** bounds;
Maestro retains its existing 480px default. Home owns the width preference and existing measured
rectangle channel to Main. Persist only the settled width, not every move. Closing/reopening keeps
the width; closed Chat retains zero drawable width and native invisibility.

```text
browser / mini-app | 8px handle | Maestro Chat (380–480px)
```

Reuse Maestro's existing #ffffff surface, #f8fafc canvas, #465467 text and #4e5882 Royal Blue
accent; no new typography or layout style. The handle is transparent at rest with subtle blue
hover/drag feedback and a column-resize cursor. Use pointer capture and screen coordinates so
moving the native view edge does not cancel the drag delta; up/cancel/lost-capture all end the
gesture. Renderer blur only updates the focus shadow, matching Cowork; it is not a pointer-end
signal. OnlyPreview geometry updates must not claim focus from sibling Chat (see
[resize/focus issue](../issues/maestro-chat-resize-interrupted-by-preview-focus.md)).
Disable width transition during dragging. No Home-only overlay, Main cursor polling,
new heavyweight I/O or separate bounds authority. Delivery: task154.

Ral also requested Cowork's active Chat shadow. The Chat renderer's own `document.hasFocus()`
initial value and window `focus`/`blur` events control a 2px blue card outline/shadow at 35% opacity.
Use Maestro's existing primary color, not Cowork's hard-coded blue. Losing focus removes it;
unmount releases listeners. No global-active-tab heuristic, IPC focus polling or persistent state.

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

The legacy Home `BrowserWindow` is created but never inherits the shared `ready-to-show`
auto-reveal and is never a visible fallback. Maestro startup is bounded and remains the only visible
primary. Its fixed Home subscribes to authentication changes before reading the hidden authority's
current token-free snapshot. Unknown or restoring state cannot mount Mini Apps; signed-out,
invalid, recovery-failed, and password-setup states render the shared Login surface inside Maestro.

Maestro's localized Home renderer reports a post-mount render tick to Main. The primary window may
be shown only after that fence and the existing operation, Control, and Workbench readiness chain.

```text
┌──────────────────────── Maestro 36px tab strip ────────────────────────┐
│ 4px inset                                                             │
│ macOS ● ● ●   rounded pinned/browser tabs · +      recording status   │
│ 3px inset + 1px divider                                               │
├──────────────────────── address/actions 42px ──────────────────────────┤
│ navigation · address · snapshot? · Control · Workbench · update       │
├────────────────────────────────────────────────────────────────────────┤
│ operation surface                                      │ Maestro Chat │
└────────────────────────────────────────────────────────┴──────────────┘
```

The top strip keeps Omni Browser's Royal Blue visual treatment at `#4e5882`, with a `#3d4666`
bottom divider, while using the follow-up compact 36px geometry. Its 28px tabs and tab-row wrappers
sit in a `4px` top / `3px` bottom content inset; the bottom divider supplies the fourth visible
bottom pixel. Every tab retains a complete border and uses a 6px radius on all four corners. On
macOS the native controls use `trafficLightPosition: { x: 12, y: 11 }` and content clears the same
78px traffic-light gutter. The address row is 42px, so total top chrome is 78px. Its navigation
group and address input share an exact 28px height; the navigation actions are 24px square inside
the group's 2px padding. DOM-measured placeholders remain the authoritative owner of operation and
Control native-view bounds after mount, while Main uses the same 78px total for the first frame.

The close action inside each closable tab and the adjacent New-tab action both use the shared
`IconBtn` primitive with Tabler SVG glyphs. The close control remains `20 × 20px` and the New-tab
control remains `28 × 28px`; shared flex centering removes font-baseline drift while preserving the
strip's existing Royal Blue hover contrast, pressed scale, focus visibility, and tab behavior.

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

The Control header exposes Maestro plus its close action; its obsolete Connector selector and Demo
menu are absent. This is an entry-only retirement: the fixed Home Connector action still opens the
Workbench Connector pane, and the Connector runtime plus Main Demo service/XPC contracts remain
available to their existing non-Control callers.

All Maestro renderer bootstraps that load Arco compile it through the repository's Less theme
pipeline rather than importing the precompiled Arcoblue CSS. Standard Arco Button states therefore
inherit the canonical Royal Blue mapping from `theme.ts`: `#4e5882` by default, `#606b9d` on hover,
and `#323955` while pressed. Danger, warning, success, loading, recording, and disabled semantics
retain their own colors.

The fixed first tab is a local `home` tab. Before authentication it renders the same Login presentation and interaction flow as the hidden Home route,
backed by an adapter over `HomeShellBridgeHandler`; it never imports `authStore`, persists a customer
token, or calls authentication HTTP directly. The bridge snapshot is explicit and token-free, and
window recreation subscribes before the initial read so authenticated content fails closed.

After an active password-complete session is confirmed, the dedicated renderer presents a simple
left-aligned application list without a navigation rail. Equal-width rows contain only an icon and
an uppercase app name; clicking the whole row opens the app, with the existing per-app loading and
duplicate-open guards. There are no card descriptions or separate Open buttons. The local Settings
route stays registered; Connector remains available in Workbench. Chat, MessageSearch, the
normal Home router, MenuBar, update polling, and Home singleton subscribers are absent. Todo
delegates to the hidden Home shell for authenticated readiness, and this no-Chat surface hides the
legacy Chat-menu setting. Password/OTP values exist only in addressed bridge commands and are never
logged or broadcast; token, session ID, device ID, and raw customer records never leave the hidden
authority. Login success changes fixed Home to `/mini-app`, while logout or invalidation changes it
back to Login without exposing the legacy native window.

The fixed view keeps an XPC-only preload, is pinned, address-locked, non-recordable, confined to the
local entry, and displays `bitterless://home` rather than a dev-server URL or packaged file path.
No provider's login code is allowed to navigate or replace this fixed tab.

The pinned Home tab favicon and the centered blank New-tab splash use one bundled Bitterless icon
derived from the canonical `build/icon.png` artwork. They do not reuse Maestro's blue `M` app logo;
arbitrary web tabs retain their page favicon or the existing generic fallback.

In a compiled debug runtime, the fixed Home view automatically opens one detached DevTools window
after its renderer finishes loading. The same guard runs when Home is reloaded or reactivated and
opens DevTools only when that view does not already have one, without stealing focus. Release and
E2E runtimes never auto-open fixed-Home DevTools; ordinary browser-tab debugging and the other
Maestro renderer DevTools policies remain independent.

This focused parity pass deliberately excludes Cowork's forked CRMS renderer, generic mini-app
page-type menus, update-progress protocol, and loading/crash tab-state expansion. Maestro's localized updater, Control chat, Local provider, and browser tabs remain
authoritative. The former visible Demo controls were retired by the Control-entry follow-up while
the Main-owned Demo service/XPC contract stayed intact.

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
  auth, and packaging paths
- Playwright Electron baseline launched through Bitterless and opening Maestro from Mini Apps

Manual/package gates:

- First Open and repeat-focus behavior; close/reopen without host impact.
- All four Maestro render surfaces load and resize correctly.
- Codex login, chat streaming/abort, attachments/workspace/artifacts, capture/replay/export,
  skills/injections/tools/models.
- macOS arm64/x64 and Windows packaged native SQLite ABI, external-tools extra resource,
  signing/entitlements, folder permissions, and update installation.
- Authentication invalidation and Bitterless quit clean up Maestro without leaking privileged content.
