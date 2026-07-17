# Helper processes create extra Dock apps and delay the Home window

状态：待处理

## Symptom

Starting the Bitterless development application appears to create several Electron applications in
the macOS Dock, while the expected Home window is absent or delayed indefinitely.

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

## Required correction

1. Run Todo MCP and Codex hooks through dedicated entries with `ELECTRON_RUN_AS_NODE=1`.
2. Keep legacy generated helpers out of the Dock until their owned shims are refreshed.
3. Refresh exact owned EyesOnAgents artifacts without changing hook settings or trust.
4. Acquire one GUI instance per profile and focus it on repeated launch.
5. Create Home after SQLite/language readiness but before optional background integrations.
6. Bound Core SQLite readiness and saved-layout reads. A database/preload stall must fall back to a
   visible Home window with SQLite-dependent integrations disabled, never an infinite startup.
7. Initialize a safe system-language fallback before a readiness wait can block, so early quit and
   other main-process dialogs remain valid during degraded startup.

## Acceptance

- Concurrent Codex helper clients add no Bitterless/Electron Dock applications.
- Exact legacy hook artifacts migrate without changing hook configuration bytes or trust state.
- One profile exposes at most one GUI Dock application and repeated launch focuses Home.
- An unresolved EyesOnAgents initialization cannot block Home creation.
- An unresolved Core SQLite readiness or layout request cannot block Home creation, and early quit
  does not produce an unhandled language-initialization rejection.
- Focused helper, lifecycle, typecheck, build, and source-order regressions pass.
