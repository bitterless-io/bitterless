# Review: Zellij automatic opening and directory persistence 176

Date: 2026-09-12; shell follow-up reviewed 2026-09-13
Branch: dev/next

Task: [zellij-auto-open-directory-176](../tasks/zellij-auto-open-directory-176.md)
Contract: [automatic opening, directories and loading](../../features/zellij-auto-open-directory.md)

## Conclusion

**Pass for the reviewed scope.** Independent source, unit and real isolated PTY checks pass.
The parent completed the final application rebuild and observed green valid commands, yellow
quoted text and red invalid commands in a fresh native web session. The prior actual-application
checks cover ANSI output, settings visibility, cwd inheritance and exact session closure. These
parent-observed results are recorded separately below; no Electron E2E or packaged-app execution
coverage is claimed.

## Scope

- Zellij config/default generation, version marker, environment, process/runtime, directory
  persistence, surface/terminal/window lifecycle, handler and shared API.
- Zellij toolbar/loading/error UI; shared Home/Workbench Terminal settings and gear routing.
- Maestro composite visibility and Workbench native-view ordering; affected Omni preparation,
  loading/retry, native overlay ordering, current-cell guards and explicit-close paths.
- Related unit/source fixtures, renderer i18n and focused strict TypeScript/lint checks.
- Application-local zsh startup forwarding, bundled syntax-highlighting assets and session-only
  environment selection, including actual temporary-home shell/PTY tests.

Unrelated earlier SQLite, external-tools and diagnostics changes were not re-reviewed, except
where needed to understand the Zellij integration. The reviewer edited only this review document.

## Findings corrected and rechecked

1. A close → queued reopen → close sequence could create an orphan native session after both
   closes completed. An independent deferred-CLI probe reproduced it. Every close now invalidates
   its generation, and queued reopening checks the captured session/lifecycle before preparing.
2. Closing while chrome was loading could begin native preparation after closure. Loading chrome
   now requires a subsequent accepted host-open before preparation; the regression checks zero
   prepare calls, in addition to no late view attachment.
3. A valid bare web_client at EOF exposed colliding KDL insertion offsets. Ordering is corrected
   and both structural and native validation pass.
4. A successful settings save after startup failure could remove Retry or leave a stale editor
   revision. Save now returns the successful operation result/new revision while the published
   runtime snapshot retains its failure and Retry. Config-save errors do not poison ready siblings.
5. A composite mount finishing after Workbench opened could cover the settings view. The final
   mount reapplies the covered state, including cold restores; Workbench raises its native view.
   Hidden/pending terminals cannot claim focus, and returning restores the existing terminal.
6. Saving settings before the first terminal could be overwritten by later template initialization.
   An isolated actual-service probe reproduced Alt j becoming Super d. Shared settings now
   initialize only configuration first. Failed ensure exposes no editable revision and shows its
   error; no session/server starts from opening the settings page.
7. When Finder supplies no SHELL, selecting the OS zsh for integration without exporting it would
   disagree with Zellij's native /bin/sh fallback. Session preparation now supplies the OS shell
   only when SHELL is absent after the explicit KDL environment is applied. The actual runCli
   production-method fixture verifies the native environment and integration choose the same shell.

All items have passing behavioral regressions. Two existing Maestro navigation expectations were
updated for the intentional initial deactivate call; the related navigation suite now passes.

## Contract review

- First creation uses home rather than launcher cwd. Profile-local persistence accepts usable
  absolute directories and falls back to home. Native metadata selects the active native tab,
  visible floating/tiled layer and uniquely focused live terminal; stale background observations
  cannot overwrite the active directory. Preparing a new session takes a fresh sample.
- Concurrent surfaces share startup but have separate identities, preparation and error states.
  Loading persists through preparation/navigation; failures provide Retry. Removing a replaced
  Omni cell fences its late callbacks; ready siblings stay above normal-mode loading controls.
- Explicit Maestro tab close, standalone window close and Omni cell removal target the exact
  session. Cleanup joins pending creation, waits for exit, then removes only its resurrection
  cache. Generic disposal/application shutdown retains named sessions and stops only an owned
  shared web server. A fixed standalone identity consequently reopens fresh after intentional
  close, while app restoration can reuse a live session.
- The dedicated template version is 260912233309. Missing/older/foreign-file markers cause a
  validated full replacement with a private backup. Same-version custom settings survive
  structural completion. Comparison uses compare-versions; config and marker drift are checked,
  and the marker lands only after the validated config. Complete repeated ensure preserves
  inode/mtime and creates no extra backup. Newer versions are not fully replaced with an older
  template (source review).
- Defaults contain the separate web-client 16-color ANSI palette plus foreground/background/
  cursor. GUI-child startup normalizes TERM/COLORTERM/CLICOLOR and removes inherited NO_COLOR,
  NODE_DISABLE_COLORS, FORCE_COLOR and CLICOLOR_FORCE. Explicit KDL environment values are applied
  later, and user shell startup values remain authoritative. Native split actions contain no
  fixed cwd; actual split execution was observed by the parent as recorded below.
- The toolbar and initial native terminal offset are both 48px. The gear routes to Workbench →
  Settings → Terminal, including a request arriving before cold Workbench mount. The shared page
  owns shortcut/config controls, without an enable toggle or manual initialization button.

The pinned native client can resurrect cached pane trees for exited exact session names. That is
why kill completion precedes exact cache deletion here.
[Pinned attach implementation](https://github.com/zellij-org/zellij/blob/v0.45.1/src/commands.rs#L723),
[pinned kill/delete implementation](https://github.com/zellij-org/zellij/blob/v0.45.1/zellij-utils/src/sessions.rs#L281).

The native Unix default shell reads SHELL and otherwise falls back to /bin/sh; it does not query
the account shell itself.
[Pinned shell selection](https://github.com/zellij-org/zellij/blob/v0.45.1/zellij-server/src/pty.rs#L2325).

## Shell/color follow-up

The shim applies only to default zsh on macOS. Explicit KDL default_shell or env.ZDOTDIR bypasses
it, while an inherited user ZDOTDIR is forwarded. Configuration validation, metadata queries and
the shared web server do not parse the prior runtime KDL or initialize these shell files; only
native session attachment applies the merged KDL environment and shell integration.

Generated files are private, atomic and stable on repeated ensure. They restore the user's startup
directory before sourcing each phase, preserve unset/exported ZDOTDIR and startup changes, and
load the plugin after interactive user startup and widgets. Tests cover login/non-login ordering,
native logout, cwd, user PROMPT preservation, nounset, readonly ZDOTDIR, RCS opt-out, noninteractive
shells, nested shells, existing highlighters and explicit color opt-outs. Nested zsh restores the
user startup environment without adding another application hook; new native panes receive their
own session environment. No user startup file is edited and no prompt/theme is forcibly replaced.

The real temporary-home PTY test uses /usr/bin/expect and /bin/zsh. It types a valid command and an
invalid command, observes green/red SGR emitted before execution, then verifies all 16 emitted
ANSI output sequences. This establishes shell emission, separately from the parent's observation
of the actual native web renderer.

All 13 vendored files were independently checked against their SHA-256 manifest, Git blob IDs and
the official 0.8.0 commit db085e4661f6aafd24e5acb5b2e17e4dd5dddf3e, including the BSD license and
hidden version/revision files. The authoritative electron-builder.tmp.yml maps resources/zellij
to packaged zellij-shell outside app.asar. The installed builder matcher includes dotfiles; the
resource fixture copies and verifies the whole asset set. This is packaging source/fixture
verification, not a reviewer-run package build.
[Pinned official source](https://github.com/zsh-users/zsh-syntax-highlighting/tree/db085e4661f6aafd24e5acb5b2e17e4dd5dddf3e).

## Verification performed by the reviewer

| Check | Result |
|---|---|
| yarn test:zellij, final shell follow-up included | 115/115 passed; no skipped tests |
| Maestro ChatLayout, CompositeTabInstances, CompositeTabNavigation, WorkbenchTab | 21/21 passed |
| Omni LayoutLifecycle, OpenReadiness, RendererOpenStages | 22/22 passed |
| Config defaults/template subset, included above | 19/19 passed; actual bundled 0.45.1 setup --check on temporary configs |
| yarn check:renderer-i18n | Passed |
| Strict TS API check of six config/default/directory/environment/process entrypoints | 0 diagnostics; explicit Node types and noCheck: false |
| Scoped ESLint of 28 task implementation/test files | 0 errors, 0 warnings |
| Shell follow-up strict TS: environment and shell integration | 0 diagnostics; strict, noCheck: false and project shared-path alias |
| Shell follow-up ESLint of seven source/test files | 0 errors, 0 warnings |
| Real shell startup/PTY subset, included above | 9/9 passed with temporary HOME; no skipped tests |
| Shell resources and production runCli fixture subset, included above | 5/5 passed |
| git diff --check | Passed |

Vue chrome/shared-settings templates and cold/warm routing are exercised by isolated compiler,
store and production-method fixtures. Native view behavior is exercised with Electron mocks;
these checks do not establish rendered desktop appearance or native keyboard delivery.

The broader preexisting Zellij test lint set contains unrelated violations; it was not reported as
a clean repository-wide lint run. The implementation agent reports the full main TypeScript check
still has 64 baseline diagnostics, with none in the new Zellij/handler changes. The reviewer did
not independently establish a clean full main/web typecheck. The repository surface wrapper calls
npx, so it was not invoked; focused checks used the TypeScript API and Yarn without installation.

No Electron app, E2E suite, Zellij session or packaging build was launched by the reviewer.
No user configuration, session or database was mutated. Native validation and reproductions used
temporary files. Shell tests launched isolated zsh processes/PTYs with temporary HOME/startup files.
Windows runtime execution was not tested; platform default KDL was validated with the available
macOS binary.

## Parent build and actual-application verification

Color follow-up audit: the running 0.45.1 server on port 12879 serves terminal.js and websockets.js
byte-identical to the pinned source. Its KDL parser accepts all 19 configured palette fields;
SetConfigPayload converts bright_* to xterm camelCase, and the frontend applies the theme both at
creation and on SetConfig. Selected app/server environment fields contain xterm-256color/truecolor,
and the server has CLICOLOR=1; NO_COLOR, FORCE_COLOR, CLICOLOR_FORCE and NODE_DISABLE_COLORS are
unset. This rules out the inspected launch environment's color opt-out, not later shell overrides.
A palette supplies render colors but does not add program ANSI or ZLE syntax styling. Subsequent
parent observations below establish both actual ANSI rendering and the new shell input colors.
[Native palette conversion](https://github.com/zellij-org/zellij/blob/v0.45.1/zellij-client/src/web_client/control_message.rs#L124),
[frontend theme application](https://github.com/zellij-org/zellij/blob/v0.45.1/zellij-client/assets/terminal.js#L24),
[runtime theme updates](https://github.com/zellij-org/zellij/blob/v0.45.1/zellij-client/assets/websockets.js#L233).

Parent-observed results before the shell-highlighting follow-up:

- Full application build passed in 49.11 seconds. The updated running development app used PID
  91199 and native port 12879. A separately launched Yarn process exited via the single-instance
  guard, so verification used that already-running updated app.
- The legacy config upgraded to template 260912233309 with one backup; subsequent opens retained
  its hash and modification time.
- A newly created reviewer-owned tab automatically connected and displayed a 48px toolbar.
  Explicit ANSI output visibly rendered distinct red, green, blue and truecolor text.
- Its gear opened Workbench settings with Terminal selected and all three shortcut fields visible,
  without native-view occlusion. Closing Workbench restored focus to the same terminal input.
- In that owned session, changing to /tmp and pressing the actual Cmd+D shortcut produced two
  native terminal panes, both reporting /private/tmp on native tab 0. A second new application
  tab also started in /private/tmp.
- Closing the second tab and then the first two-pane tab removed both exact names from active and
  cached native session listings. All four original user sessions remained live. The parent
  restored the original user tab without typing into its existing session.

Parent-observed final shell/input acceptance:

- The final color build passed in 31.33 seconds, recorded in task176-build-colors.log. The parent
  checked that zellijShellIntegration.service.ts modification time (15:59:41.902 UTC) preceded
  out/main/app.main.js (16:00:27.812 UTC), establishing that the final shim changes entered the
  build. The restarted app used PID 96915 via yarn dev:prod and native port 12879.
- In a fresh parent-owned web session, bitterless-debug-852c29a2e4f5, the parent used CUA to type
  `echo "Bitterless input colors"`. The command visibly rendered green and quoted text yellow.
  After clearing it, `bitterless_invalid_command` visibly rendered red before execution.
  The same web view also visibly rendered red, green, blue and truecolor printf output.
- All four original user sessions remained live across normal application quit/relaunch and were
  untouched. The parent cleared its unsubmitted input, closed its test tab and restored the
  original e2c8a7d27447 tab without typing. Its read-only inspection at 16:07:18 UTC confirmed
  only the four original live sessions remained and 852c29a2e4f5 was absent from active and cached
  sessions. Config hash/mtime, template marker 260912233309 and the single backup were unchanged;
  the remembered cwd returned to the project directory. Cleanup evidence is parent-observed.

This closes the reported fresh-session input-color acceptance item. The application observations
and build results are supplied by the parent; the reviewer independently ran the isolated checks
listed above. These were focused interactions in newly created sessions, not an Electron E2E
suite. A distributable package was not executed; packaging evidence remains source/resource
fixture coverage. Retained sessions keep their existing shell process/environment, so these
color results apply to newly created sessions rather than retroactively modifying old shells.
