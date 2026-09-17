# Packaged Zellij cannot find installed shell commands

Status: implemented; independently verified and owner confirmed fresh-session recovery.
Owner request: 2026-09-16.

## Defect and evidence

On a newly installed or updated macOS app, the default Zellij terminal must discover commands
available through the user's normal login shell, including `claude` and `claude2`.
The reported terminal says `command not found` for both while iTerm2 can run them.

The native Zellij 0.45.1 default pane starts the selected shell without `-l`. Main inherits
the GUI launcher's limited PATH, and the generated zsh startup integration preserves that
non-login mode. Consequently `/etc/zprofile` and the user's `.zprofile` never run.
An isolated environment probe on the affected machine confirmed that `zsh -ic` cannot locate
either command while `zsh -lic` finds both; Homebrew initialization lives in `.zprofile`.
The existing integration test explicitly expected only `.zshenv` and `.zshrc` for `-i`.

## Repair contract

- The app-managed default interactive zsh starts in login mode even when Zellij omits `-l`.
  Use zsh's native startup sequence, including system and user profile files, exactly once.
  Do not hard-code command locations or install commands that are absent from the device.
- Set the default before forwarding user `.zshenv`, so an explicit user `unsetopt login`
  remains effective. Preserve RCS opt-out, noninteractive startup, cwd, original ZDOTDIR,
  user themes/widgets and the final highlighter ordering.
- Explicit KDL `default_shell` / `ZDOTDIR` and non-zsh behavior retain their existing opt-outs.
  Never rewrite user dotfiles, change global process environment, or kill existing sessions.
- Generate the corrected private shims for fresh sessions in development and packaged builds.
  Existing running shells retain their environment; a fresh terminal session is required after
  updating. Saved/live session lifecycle and resurrection behavior are unchanged.
- Mirror the same repair in Micromeet Cowork under its own tracked issue and tests.

## Verification

Use isolated HOME/dotfiles and a GUI-like PATH. Verify installed executable stubs, a `.zshrc`
wrapper/function, full startup order without duplicate sourcing, existing login shells,
ZDOTDIR changes, explicit opt-outs, noninteractive shells and nested shell behavior.
Run the Zellij regression suite, scoped TypeScript/lint and a build. Do not run Electron E2E
or launch packaged apps. Ral will rebuild/update both clients and verify fresh terminals.

Delivery: [task](../plan/tasks/zellij-login-path-001.md).

Completed 2026-09-16: the GUI PATH regression failed against the old source and passed after
the five-line startup repair. Focused checks passed 39/39; the complete `yarn test:zellij`
suite passed 191/191 with zero skips. Scoped strict TypeScript, ESLint, `git diff --check`
and `yarn build` passed; the compiled main bundle contains the corrected startup script.
[Independent review](../plan/reviews/zellij-login-path-001-1.md) passed, including a separate
HEAD/current negative control. Verification build metadata was restored; no installer was
generated and no Electron E2E or real Claude invocation was performed. Ral will repackage,
update and test a fresh terminal opened from Finder/Dock.

## Update recheck: retained pane versus development launch

Owner reported that Preview still cannot use `claude2` after updating while `yarn dev:prod`
works. Read-only inspection on 2026-09-16 found:

- Installed Preview build `260916230030` already includes the guarded login startup repair;
  all 14 shell assets are present and the pinned binary reports Zellij 0.45.1.
- Preview started at 23:13, but its owned native session and two zsh panes started at
  22:37/22:38, before the repair was installed. The private `.zshenv` was regenerated at
  23:13 and contains the repair; writing that file cannot rerun an already-running shell.
- Preview inherits the GUI PATH containing only system command directories. The development
  launch inherits iTerm's Homebrew/local command directories and uses a separate debug profile.
  Development success therefore does not establish the environment of the retained Preview pane.
- `ZellijDirectoryService.prepareSession` reattaches an existing session; native `stop` only
  cancels IPC and intentionally retains the session and its programs across app updates.

This is consistent with retained pre-fix shell state, rather than a missing packaged patch.
Preserve ongoing work. Verify a genuinely new Preview terminal, or let the owner refresh an
idle old pane with `exec /bin/zsh -l`; restarting the app alone does not restart that shell.
Distinguish `command not found` from a later error after Claude starts before attributing a
different symptom to this cause.

The isolated native default-zsh recheck passed using the installed Preview Zellij binary and
shell assets, the production integration helper, disposable dotfiles and a system-only initial
PATH. Without the login repair, startup traced env -> rc and could not find a harmless fixture
executable named `claude2`. With the repair, startup traced env -> profile -> rc -> login once,
the bundled highlighter loaded, and that fixture executable ran successfully. Both native
sessions were shut down and process death verified. No real Claude, Electron, user configuration
or live user session was used or changed. This closes the native-boundary verification gap;
it does not claim a new pane was opened inside the owner's running Preview app.

Owner acceptance, 2026-09-17: rebuilding the session restores `claude2`. Direct inspection of
the previous idle pane showed login mode off and no Homebrew/local command directories in PATH.
The installed current shim and real user startup files resolve the commands in a fresh login
shell. The owner separately confirmed that Cmd+C remains broken; track that independent defect
in [native selection copy](zellij-terminal-cmd-copy-paste.md).
