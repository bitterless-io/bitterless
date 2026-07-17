# Helper processes create extra Dock apps and delay the Home window

状态：处理中

## Symptom

Starting the Bitterless development application appears to create several Electron applications in
the macOS Dock, while the expected Home window is absent or delayed indefinitely.

## Owner correction — SQLite-first, non-blocking startup

Normal GUI startup must begin by booting the independent Core SQLite renderer, then immediately
continue to the Home and other independent startup work. SQLite-first defines launch priority, not
a readiness barrier. SQLite-dependent integrations still wait for Core success in the background.
Explicit startup failures remain visible from the Home menubar instead of terminating the GUI.

## Confirmed cause

- The generated Todo MCP shim launches the project through the GUI Electron entry with
  `--mcp-helper`, so each Codex MCP client owns a windowless Dock application.
- An already-installed EyesOnAgents hook can retain a legacy shim that launches the removed
  app-main helper mode instead of the dedicated Node helper.
- Normal startup awaits optional Codex inspection and synchronization before creating Home.
- The GUI entry has no explicit single-instance lock.
- Live `yarn dev` verification exposed a second independent gate: the SQLite renderer can finish
  loading while `CoreSqliteBootDao.ready()` never resolves. Startup then owns only the SQLite
  renderer indefinitely; Home is never created. Quitting in this state also reaches the localized
  confirmation dialog before application language initialization and rejects its event handler.
- A follow-up live run exposed an earlier variant of the same failure: the hidden SQLite document
  can itself remain before `did-finish-load`. Bounding only DAO readiness and the saved-layout read
  still leaves Home permanently gated before either deadline begins.
- After bounding that wait, Home's renderer process was created but the window remained hidden
  because the shared helper waited indefinitely for `ready-to-show`. Degraded startup therefore
  also needs an explicit visibility fallback independent of renderer first paint.
- The current SQLite boot stops before table creation or migrations. Its preload unnecessarily
  requests package metadata back through XPC while main is waiting for the preload boot result,
  and message-server startup calls `sqliteManager.init()` a second time. The package-metadata XPC
  is not a structural event-loop deadlock, but it introduces an unbounded lost-reply path into the
  mandatory boot chain. Build-time `version_code` injection and exactly-once SQLite initialization
  remove both risks.
- `did-finish-load` proves only that the SQLite renderer document loaded; it is not the database
  readiness signal. `CoreSqliteBootDao.ready()` remains the authoritative success gate.
- A controlled DEBUG launch after the strict-order refactor still timed out after 30 seconds while
  waiting for `did-finish-load`. This confirms that document completion is not merely insufficient;
  it is an invalid prerequisite for preload-owned SQLite boot and must be removed from the gate.
  Main must wait for the target SQLite preload registration/readiness result directly. The initial
  `about:blank` preload evaluation must report "not target document" rather than a false boot
  failure so main can ignore it until the real preload replaces the handler.
- Removing the Core gate exposed two foreground races that the old serial order had masked. Home's
  renderer still awaited `ApplicationLanguageHandler/getCurrentLanguage` before importing App or
  mounting Vue, so a pending or failed early XPC request left only the BrowserWindow background.
  Separately, the internal SQLite BrowserWindow still showed itself outside release builds and
  could take focus after Home was created. The observed 5173-to-5174 fallback is not causal:
  electron-vite passes the actual selected port to the Electron child before launch.

## Required correction

1. Run Todo MCP and Codex hooks through dedicated entries with `ELECTRON_RUN_AS_NODE=1`.
2. Keep legacy generated helpers out of the Dock until their owned shims are refreshed.
3. Refresh exact owned EyesOnAgents artifacts without changing hook settings or trust.
4. Acquire one GUI instance per profile and focus it on repeated launch.
5. After only the minimum main/XPC/path prerequisites required by the SQLite preload, create the
   hidden SQLite window first. Observe its explicit successful Core SQLite boot result in the
   background; do not gate foreground startup on `did-finish-load`, target registration, Core
   readiness, or any elapsed-time threshold.
6. After applying the SQLCipher key, Core must execute
   `SELECT COUNT(*) AS object_count FROM sqlite_master`. A newly created empty database succeeds
   with `0`; an existing readable database succeeds with a non-negative count; a wrong key,
   corrupt file, or unreadable connection throws and fails Core readiness. Core readiness remains pending
   until this read probe, schema creation, migrations, and final schema verification all succeed.
7. Initialize an in-memory system-language fallback, create Home with default bounds, refresh
   helper artifacts, and initialize Tray without waiting for SQLite. SQLite failure must not exit or
   hide the GUI.
8. After SQLite succeeds, hydrate the durable application language and start SQLite-dependent MCP
   and EyesOnAgents integrations in the background.
9. Record explicit failures in main-owned in-memory startup diagnostics. Home's menubar shows a
   compact warning button only when issues exist; hover or keyboard focus lists the failing stages
   and messages. See [Startup diagnostics](../features/startup-diagnostics.md).
10. Keep the internal Core SQLite BrowserWindow hidden in development and production so it cannot
    cover or focus ahead of Home.
11. Start Home language subscribe/fetch before mount but never await it as a mount prerequisite.
    Mount with the explicit bootstrap locale and apply the main snapshot in place when available.

## Acceptance

- Concurrent Codex helper clients add no Bitterless/Electron Dock applications.
- Exact legacy hook artifacts migrate without changing hook configuration bytes or trust state.
- One profile exposes at most one GUI Dock application and repeated launch focuses Home.
- Behavioral coordinator and integration checks prove the SQLite renderer starts first while Home,
  Tray, and Todo shim proceed independently; persisted language, MCP, and EyesOnAgents await Core.
- An unresolved EyesOnAgents initialization cannot block Home creation.
- Home, helper refresh, and Tray continue while SQLite is pending or failed; SQLite-dependent
  integrations remain gated independently.
- The SQLite renderer never becomes a visible or focused application window.
- Home's menubar and routed shell render while the initial language XPC request is pending or
  rejected; a later snapshot updates the locale without reload.
- No target-preload/Core-ready timeout exists. Only explicit preload, renderer, navigation,
  database-read, schema, or migration failure creates a startup issue.
- The Home menubar warning is absent with no issues and lists localized failing stages plus concise
  error messages on hover or keyboard focus.
- The schema read probe succeeds for both an empty new database and an existing populated database,
  and fails closed for an unreadable/encryption-invalid database.
- Early quit does not produce an unhandled language-initialization rejection.
- Focused helper, lifecycle, typecheck, build, and source-order regressions pass.

## Superseded resolution

- Todo MCP and Codex hook helpers have dedicated build entries. Generated launchers use Electron
  only as a Node runtime through `ELECTRON_RUN_AS_NODE=1`; legacy app-entry modes are kept
  windowless until owned artifacts refresh.
- GUI mode owns a single-instance lock. A repeated launch focuses the existing Home window.
- System-language fallback is initialized before the first GUI await. Hidden SQLite document load,
  saved layout, Core readiness, and persisted language all have bounded or optional startup paths.
- Degraded startup skips SQLite-dependent integrations, uses default bounds, and shows Home
  immediately without waiting for `ready-to-show`.
- Todo shim refresh happens before SQLite readiness, so the same failure that triggers degraded
  startup cannot prevent migration to the Node-only helper.

Final live `yarn dev` evidence: one Bitterless top-level Electron process, two renderer children,
and one visible window titled `BitterLess`. The generated DEV_DEBUG shim exported
`ELECTRON_RUN_AS_NODE=1` and targeted `out/main/mcpHelper.js`; shutdown left no new GUI process or
uninitialized-language rejection.

This resolution was reopened again after the strict gate caused a 30-second target-registration
timeout and exited the GUI. The corrected delivery starts SQLite first without turning its
readiness into a foreground startup barrier.
