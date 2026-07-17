# Helper processes create extra Dock apps and delay the Home window

状态：已修复

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
- A follow-up live run exposed an earlier variant of the same failure: the hidden SQLite document
  can itself remain before `did-finish-load`. Bounding only DAO readiness and the saved-layout read
  still leaves Home permanently gated before either deadline begins.
- After bounding that wait, Home's renderer process was created but the window remained hidden
  because the shared helper waited indefinitely for `ready-to-show`. Degraded startup therefore
  also needs an explicit visibility fallback independent of renderer first paint.

## Required correction

1. Run Todo MCP and Codex hooks through dedicated entries with `ELECTRON_RUN_AS_NODE=1`.
2. Keep legacy generated helpers out of the Dock until their owned shims are refreshed.
3. Refresh exact owned EyesOnAgents artifacts without changing hook settings or trust.
   Todo MCP shim refresh must not depend on Core SQLite readiness, otherwise the failure that puts
   startup into degraded mode also prevents migration away from the legacy Electron app entry.
4. Acquire one GUI instance per profile and focus it on repeated launch.
5. Initialize the system-language fallback synchronously, then create Home after bounded attempts
   to load the hidden SQLite document and saved layout; neither may be an unbounded gate.
   When the hidden document is unavailable, show the background-backed Home shell immediately
   instead of waiting for `ready-to-show`.
6. Run Core SQLite readiness and persisted-language hydration after Home in the fenced optional
   lifecycle. A database/preload stall must leave a visible Home window with SQLite-dependent
   integrations disabled, never an infinite startup.
7. Initialize a safe system-language fallback before a readiness wait can block, so early quit and
   other main-process dialogs remain valid during degraded startup.

## Acceptance

- Concurrent Codex helper clients add no Bitterless/Electron Dock applications.
- Exact legacy hook artifacts migrate without changing hook configuration bytes or trust state.
- One profile exposes at most one GUI Dock application and repeated launch focuses Home.
- An unresolved EyesOnAgents initialization cannot block Home creation.
- An unresolved SQLite document load, Core readiness, layout request, or Home first paint cannot
  block a visible Home shell, and early quit does not produce an unhandled language-initialization
  rejection.
- Focused helper, lifecycle, typecheck, build, and source-order regressions pass.

## Resolution

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
