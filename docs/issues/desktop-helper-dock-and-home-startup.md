# Helper processes create extra Dock apps and delay the Home window

状态：处理中

## Symptom

Starting the Bitterless development application appears to create several Electron applications in
the macOS Dock, while the expected Home window is absent or delayed indefinitely.

## Owner correction — SQLite-first startup

The degraded Home behavior delivered in the previous resolution is rejected. Normal GUI startup
must begin by booting Core SQLite and must not initialize language, Home, Tray, helper artifacts,
MCP, EyesOnAgents, or any other application work until SQLite returns an explicit successful boot
result. A SQLite failure is a startup failure, not permission to continue with a partial shell.

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

## Required correction

1. Run Todo MCP and Codex hooks through dedicated entries with `ELECTRON_RUN_AS_NODE=1`.
2. Keep legacy generated helpers out of the Dock until their owned shims are refreshed.
3. Refresh exact owned EyesOnAgents artifacts without changing hook settings or trust.
4. Acquire one GUI instance per profile and focus it on repeated launch.
5. After only the minimum main/XPC/path prerequisites required by the SQLite preload, create the
   hidden SQLite window and await the target preload's explicit successful Core SQLite boot result.
   Do not gate database readiness on `did-finish-load`; ignore the initial `about:blank` preload
   registration and wait for the real SQLite document handler.
6. After applying the SQLCipher key, Core must execute
   `SELECT COUNT(*) AS object_count FROM sqlite_master`. A newly created empty database succeeds
   with `0`; an existing readable database succeeds with a non-negative count; a wrong key,
   corrupt file, or unreadable connection throws and fails startup. Core readiness remains pending
   until this read probe, schema creation, migrations, and final schema verification all succeed.
7. If SQLite load or initialization fails, abort GUI startup with an explicit error. Do not create
   Home or initialize language, Tray, helper artifacts, MCP, EyesOnAgents, or other application work.
8. Only after SQLite succeeds, strictly hydrate the durable application language, create Home with
   its persisted layout, refresh helper artifacts, and start the remaining integrations.
9. An early quit/error dialog may install an in-memory language fallback for that dialog only; the
   normal startup path must not expose fallback application state before SQLite succeeds.

## Acceptance

- Concurrent Codex helper clients add no Bitterless/Electron Dock applications.
- Exact legacy hook artifacts migrate without changing hook configuration bytes or trust state.
- One profile exposes at most one GUI Dock application and repeated launch focuses Home.
- Behavioral coordinator and integration tests prove SQLite success precedes language, Home, Tray,
  Todo shim, MCP, and EyesOnAgents initialization.
- An unresolved EyesOnAgents initialization cannot block Home creation.
- A SQLite load/init failure produces no partial Home/Tray/helper/integration startup.
- A target-preload registration/Core-ready timeout is fatal and produces no partial startup;
  `did-finish-load` is not part of the readiness contract.
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

This resolution was reopened because it allowed Home, Tray, and helper initialization after a
SQLite timeout. The new delivery must repair the SQLite boot dependency and restore strict
SQLite-first sequencing.
