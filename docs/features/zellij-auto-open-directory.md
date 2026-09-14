# Zellij opens directly and remembers the working directory

Status: implemented and verified, 2026-09-13
Owner decision: Ral, 2026-09-12

## Behavior

Opening Zellij is the request to start a terminal. Remove the Enable terminal preference and
the Initialize and open button. The Home/Workbench Terminal category contains shared terminal
configuration only; it must not restore the retired enable toggle.
Existing stored `terminalEnabled: false` must not prevent opening. This replaces the previous
default-off/manual-initialization contract in `terminal-toggle.md` and `zellij-miniapp.md`.

```text
Zellij   Opening… / Connected                  [settings icon]   (48px high)

[error message + Retry, only when opening failed]

terminal pane tree
```

During initialization, show an animated loading indicator with a localized "Opening terminal…"
message in the terminal region, then replace it with the live terminal. Expose a status/live
region and respect reduced-motion preferences. Errors replace the loading state with Retry;
normal startup never requires a button click. Ral explicitly requested this loading animation.

The toolbar is exactly 48 CSS pixels high. Its gear opens Workbench → Settings → Terminal;
remove the terminal's inline settings panel. Terminal settings edit the shared profile config,
including shortcuts and config-directory actions, and changes apply to every Zellij tab.
Opening settings from a standalone terminal must reach the same shared settings destination.

Settings must remain visible and interactive above the terminal. The terminal is a native
WebContentsView, so a DOM z-index cannot solve overlap. Suspend its native visibility while the
Workbench overlay is open, retain the session, and restore visibility and current bounds when
settings close. A hidden terminal must not keep keyboard focus or claim active cwd.

Opening a standalone window, Maestro Zellij tab, restored tab, or Omni Zellij cell automatically
ensures configuration, the shared web server/authentication, and that surface's named session.
Opening another surface must not reset or reload connected sibling terminals. Concurrent opens
share server startup while keeping separate session identities.

Ral additionally requires deliberate tab closure to end its sessions. Closing a Zellij tab ends
that tab's exact named session, including all its panes and terminal processes. Deliberately
closing a standalone terminal window or removing/replacing an Omni terminal cell follows the
same rule. Other terminal hosts and sessions remain intact. If a host closes while its session
is still being prepared, cleanup must also cover the eventual creation; do not leave a late
orphan session. Use exact native session names, never a global kill command or a prefix match.
After that session has exited, remove only its resurrection cache so reopening a fixed standalone
identity starts a fresh session from the remembered directory. Serialize this cleanup before a
same-identity reopen; native kill followed immediately by cache deletion is not an exit fence.

Application shutdown and non-user disposal (reload/crash recovery) preserve the named sessions
for restoration; shutdown stops only the application's owned web server. Keep user-close intent
separate from generic view disposal. This supersedes the old multi-tab decision to retain orphan
sessions after a tab is closed.

An unresponsive or partially stopped native session must not block healthy siblings or creation
of a new session. Bound native health/IPC and shutdown waits, distinguish unavailable state from
an empty session inventory, and surface genuine errors through Retry. Exact deliberate-close
cleanup must account for incomplete native shutdown. The same open/close behavior must hold after
restarting the application; see [repair task 177](../plan/tasks/zellij-session-lifecycle-177.md).

## Working directory

- On first use, start from the operating-system user's home directory in both development and
  packaged builds. Never inherit the Bitterless repository, process launcher, or installation cwd.
- Remember the most recently used active terminal pane's valid directory in profile-local
  application data. A new session/tab starts from that directory. Persist changes while the
  terminal is used, when focus changes, and on orderly shutdown; refresh the active pane before
  opening a new session so a recent `cd` is honored.
- Existing/restored named sessions keep their own pane tree and working directories. If a new
  session is needed after restart, use the remembered directory. If it has disappeared or is
  unusable, use home. Do not rewrite the user's shell startup files or run `cd` as injected input.
- A split/new pane inherits the active source pane's current directory through Zellij's native
  behavior. Do not pin split actions to the original session launch directory.
- Observe only the active surface's current native tab and visible pane layer. Background
  surfaces must not overwrite the most recently used directory. Native metadata unavailable
  during transitions does not erase a previously valid directory; diagnostics remain bounded.
- Use Zellij's structured native metadata, not terminal output scraping or shell-profile hooks.
  In pinned 0.45.1, `action current-tab-info --json` and `action list-panes --json` provide the
  active native tab/layer and live pane cwd. Prepare each named session with an explicit cwd
  before navigating its web client. Keep the existing short macOS socket-directory protection.

## Defaults and color

macOS split shortcuts follow Ral's 2026-09-13 adjustment: `Cmd+D` creates a pane to the right
(side by side), while `Cmd+Shift+D` creates one below (stacked). The corresponding native actions
are `NewPane "Right"` and `NewPane "Down"`. Template version `260913170717` applies this change
through the existing configuration upgrade mechanism; other platform shortcuts are unchanged.
The current DEBUG_PROD configuration was upgraded through the production config service, with
native KDL validation and a verified backup; a second initialization left its modification time
unchanged. The three targeted configuration suites passed independently (25/25), and the
debug_prod build passed. No Electron E2E or shortcut UI run was performed for this adjustment.

Each open checks a dedicated KDL `version_code` as well as file existence. The template version
is a timestamp version code changed deliberately when application defaults change; it is separate
from the application's automatically generated DEBUG build version. Development restarts and
overwrite installations both perform the same version check against profile-local state.

Ral's follow-up explicitly supersedes preserving old customizations across a template upgrade:
an unversioned/older configuration is backed up and replaced with the current complete template
before loading. Validate the replacement with the bundled binary, guard concurrent file edits,
then atomically replace the KDL and record the successful version. A validation/write failure must
not mark the upgrade complete. Keep version state associated with the actual resolved config file.

Within the same template version, retain user settings/comments/bindings and explicit custom
themes, and fill missing defaults structurally when needed. A complete unchanged file is not
rewritten. Preserve a backup before replacing existing content. Newer configuration versions
must not be silently downgraded by an older build.

Provide the full 16-color ANSI palette in the native `web_client { theme { ... } }` section,
plus foreground/background/cursor. Zellij's ordinary `themes` section alone does not configure
the embedded xterm palette. Provide a truecolor-capable terminal environment, including
normal TTY-aware color defaults for programs that support them. The GUI terminal owns its color
capabilities: remove inherited launcher-only suppression (`TERM=dumb`, `NO_COLOR`,
`NODE_DISABLE_COLORS`, forced-color flags), then allow explicit KDL environment settings and the
user's shell startup files to override these defaults. Do not force ANSI into redirected output.

Ral explicitly requires colored input too. For the default zsh, provide a Bitterless-scoped
startup integration that forwards the user's existing startup files and loads a pinned upstream
`zsh-syntax-highlighting` last. Bundle the dependency and its license for development and packaged
builds; never modify global `.zshrc` or invent a shell syntax parser. Preserve custom shell choices
and non-zsh behavior. Test actual interactive input highlighting as well as explicit ANSI output.

Already-running shell/program processes retain the environment they started with. Some legacy
sessions were created with `TERM=dumb` and `NO_COLOR=1`; a palette/config update cannot change
those processes. Keep their work intact. Fresh sessions receive the corrected environment and
shell integration; do not silently terminate active user commands to refresh their colors.

## Verification

Behavioral tests cover automatic and concurrent opening, existing ready siblings, cancellation
and stop/reopen races, home/saved/missing cwd, active native tab/layer selection, rapid `cd` then
new session, state persistence, per-surface identity including Omni, native split inheritance,
legacy/older-version replacement, same-version customization preservation, version-marker failure
handling and native KDL validation. Verify native view visibility while settings are open, and exact session cleanup
on deliberate close, isolation from sibling sessions, preservation on application shutdown, and
close-during-creation cleanup. Preserve navigation and
authentication protections. Check Vue/i18n/types, build and independent review. Prior explicit
startup-diagnostic authorization permits focused actual application verification in this session;
do not run an automated Electron E2E suite or packaged smoke run.

Completed verification: 115 Zellij tests, 21 Maestro checks and 22 Omni checks pass, alongside
focused strict TypeScript, scoped lint and renderer i18n checks. The final color build passed in
31.33 seconds. In the actual development Web terminal, a fresh session displayed green command
names, yellow quoted strings, red invalid commands and distinct ANSI/truecolor output.

Actual application checks also confirmed the 48px toolbar, unobscured shared Workbench settings
and restored terminal focus; native Cmd+D and a new session both inherited `/private/tmp` after
changing directory. Closing owned test tabs removed their exact live sessions and resurrection
caches while preserving all four original user sessions. Those original sessions also survived
normal application quit/relaunch. The existing KDL upgraded once to `260912233309`, retaining the
same hash, modification time and single backup across later opens and relaunches.

See the [independent review](../plan/reviews/zellij-auto-open-directory-176-1.md) for evidence and
coverage boundaries. The full main typecheck still reports 64 existing diagnostics; automated
Electron E2E, signed packaging and Windows GUI execution were not run. Existing shell processes
retain their startup environment; the corrected environment/input integration applies to fresh
sessions without interrupting existing work.
