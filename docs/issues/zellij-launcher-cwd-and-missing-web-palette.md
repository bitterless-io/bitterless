# Zellij inherits the launcher cwd and lacks a default Web terminal palette

Status: fixed and verified, 2026-09-13 (task 176)
Reported by Ral, 2026-09-12

## Evidence

The previously repaired DEBUG_PROD terminal starts in the Bitterless repository. The web-server
spawn adapter supplies no cwd, so it inherits the `yarn dev:prod` launcher directory. Zellij
0.45.1's Web session creation supplies no explicit cwd either. The native read-only pane query
confirmed the active terminal's `pane_cwd` is the repository path.

The existing profile KDL contains only `keybinds`, `themes`, `theme`, `explicit_theme_hue`, and
`default_layout`, with theme `bitterless`. It contains no `web_client` section. The ordinary
Zellij theme supplies UI colors and Web foreground/background fallback, while the Web client's
16 ANSI colors require `web_client { theme { ... } }` entries. The configuration service exits
early for any existing file, so it never supplies those missing defaults to an existing profile.

The old Enable terminal/Initialize controls follow the previous owner contract. Ral now requests
their removal, automatic startup with loading animation, remembered working directories and
proper default colors. The follow-up also requires deliberate terminal-tab closure to end only
that tab's exact session and all panes, while application shutdown retains restorable sessions.
These intentional behavior changes are specified in
[automatic opening and working-directory memory](../features/zellij-auto-open-directory.md).

Additional reports: the native terminal covers settings, and template changes never replace an
already initialized config during development/reinstallation. The accepted fix adds explicit
native-view visibility during settings and a dedicated KDL `version_code`. An older/unversioned
file is backed up and replaced with validated current defaults; same-version edits are retained.
This replaces the earlier requirement to preserve customization through every template upgrade.
The toolbar is also reduced to 48px, and its settings gear opens the shared Workbench Terminal
settings category instead of expanding an inline panel above each terminal.

## Color follow-up from actual runtime

The upgraded configuration and new Web terminal render explicit red/green/blue/truecolor ANSI
correctly. Read-only inspection found some retained native sessions still carry `TERM=dumb`
and `NO_COLOR=1`, while the current application/server/new session have normal color capabilities.
KDL replacement cannot update a running process's environment. The user's zsh startup already
provides colored prompts and directory listings, but no input syntax-highlighting plugin is loaded.

The follow-up therefore removes launcher-only suppression from new GUI terminal environments
and adds a scoped zsh startup integration with pinned upstream syntax highlighting. User rc files
and explicit shell/KDL choices remain authoritative. Existing running commands are preserved;
the old environment remains a per-process limitation until a fresh session/program is started.

Follow-up, 2026-09-13: the owner still saw monochrome after restarting Electron. Direct inspection
confirmed the visible restored tab was attached to a pre-fix native daemon with `TERM=dumb` and
`NO_COLOR=1`; the new application/web server had the corrected environment. In
`zellijDirectory.service.ts`, preparation returns early for an already-live named session, so the
session-only shell/environment initialization in `zellijRuntime.service.ts` does not run again.
Restarting the application therefore does not restart its preserved terminal processes.

A fresh tab in that same running application visibly rendered green command names, yellow
quoted strings and red/green/blue/truecolor output. It was left open and selected with an empty
command line for the owner, while all four original tabs remained intact. Previous verification
had closed its fresh test tabs and returned to an old tab; that handoff concealed the working new
session behavior. No additional palette or runtime source change was needed for this observation.
Updating old process environments requires replacing/reinitializing those shells; do not silently
terminate user tasks to refresh their colors.

## Native integration details

- Create/reattach a stable named session before Web navigation, with an explicit process cwd.
  Avoid a fixed `default_cwd` option that would interfere with native new-pane inheritance.
- `current-tab-info --json` identifies `tab_id` and `are_floating_panes_visible`. Filter
  `list-panes --json` by that tab/layer and a focused, live, selectable non-plugin pane. The
  actual default layout includes both a focused hidden floating plugin and a focused terminal;
  selecting the first `is_focused` record is incorrect.
- Pinned 0.45.1 detached creation does not reliably forward nested attach options. Ensure the
  effective KDL has the default `web_sharing "on"` and `web_server false`; do not depend on a
  nested `--default-cwd`/`--web-sharing` override. Preserve explicit custom settings and surface
  incompatible user configuration instead of silently overriding it.
- `list-sessions --short` includes exited/resurrectable sessions and strips their status. Do not
  use membership in that list as proof of a running session.
- Only parse the needed native metadata; responses can contain running command arguments and
  must not be dumped to logs. Persist cwd under profile-local userData, not the repository.

Sources: [Web session creation](https://github.com/zellij-org/zellij/blob/v0.45.1/zellij-client/src/web_client/session_management.rs#L90),
[Web theme schema](https://github.com/zellij-org/zellij/blob/v0.45.1/zellij-utils/src/input/web_client.rs#L12),
[Web theme conversion](https://github.com/zellij-org/zellij/blob/v0.45.1/zellij-client/src/web_client/control_message.rs#L125),
[pane metadata](https://github.com/zellij-org/zellij/blob/v0.45.1/zellij-utils/src/data.rs#L2357),
[cwd inheritance](https://github.com/zellij-org/zellij/blob/v0.45.1/zellij-server/src/pty.rs#L971),
[detached creation](https://github.com/zellij-org/zellij/blob/v0.45.1/zellij-client/src/lib.rs#L1696).

## Verification

Task [176](../plan/tasks/zellij-auto-open-directory-176.md) is complete; the independent
[review](../plan/reviews/zellij-auto-open-directory-176-1.md) records 115 passing Zellij tests,
21 Maestro and 22 Omni checks, focused TS/lint/i18n checks, and a successful final application
build. Actual development-app verification confirmed a 48px header, shared Workbench Terminal
settings without occlusion, native split/new-session cwd inheritance, exact test-session cleanup,
and preservation of the four original sessions across quit/relaunch. The legacy KDL upgraded to
`260912233309` once with one backup, then stayed unchanged on subsequent opens/relaunch.

A fresh Web session displayed green command names, yellow quoted strings and red invalid
commands before execution, plus distinct red/green/blue/truecolor output. Existing sessions keep
their startup environment and current work; the corrected environment and input highlighter
apply to fresh sessions. Programs still control their own ANSI output, without forced escape
sequences in redirected output. Full main TS retains 64 baseline diagnostics; automated Electron
E2E, signed packaging and Windows GUI execution were not run.
