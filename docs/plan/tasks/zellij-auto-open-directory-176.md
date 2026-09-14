---
id: zellij-auto-open-directory-176
scope: open Zellij automatically with remembered cwd and ensured color defaults
status: done
depends-on: []
verify: runtime and cwd behavior, config native validation, settings retirement, i18n and type checks, build, independent review, focused authorized runtime verification
---

# Open Zellij directly with remembered working directories

Implement [the owner contract](../../features/zellij-auto-open-directory.md). It supersedes the
manual initialization/default-off Terminal preference, while preserving task 175's short socket
directory and process diagnostics.

## Scope

- Zellij runtime, session/cwd persistence, child process options, per-surface lifecycle and Omni
  preparation; common renderer toolbar/store/settings, retired preference API and settings UI.
- Default KDL/color ensure, versioned template replacement and related behavioral tests.
- Native terminal visibility while settings are open.
- A 48px terminal toolbar and gear navigation to shared Workbench Settings → Terminal.
- Default zsh input highlighting via a pinned bundled upstream plugin and scoped startup files;
  GUI terminal color defaults independent of inherited launcher suppression.
- English/Chinese strings, focused checks and any directly affected settings/surface tests.
- Current branch only; preserve all existing SQLite/tools/Zellij fixes. No global shell changes,
  token output, direct application DB access, packaging publication, or unrelated refactoring.

One implementation agent owns source changes; a separate agent owns review. Root owns design,
issue/task records and completion. Native capability and current-entrypoint research are separate
read-only subtasks.

## Acceptance

- Opening any supported Zellij host needs neither a toggle nor an Initialize click.
- Automatic initialization displays a loading animation until the terminal is ready; failure
  displays a localized error and Retry without restoring the retired controls.
- First session cwd is home regardless of launcher; new sessions use the most recently active
  pane cwd; split panes inherit source cwd; restart preserves directories without resetting
  existing sessions. Missing remembered directories use home.
- Configuration versions trigger validated, backed-up replacement on an older/unversioned file;
  same-version customization survives. ANSI/truecolor rendering works, and a second unchanged
  ensure performs no unnecessary write. Failed replacement cannot advance its version marker.
- Settings remain visible and interactive; hiding the native terminal preserves its session and
  restores correct visibility, bounds and focus afterward.
- Toolbar height is 48px. Settings live in the shared Workbench Terminal category; saving them
  updates all Zellij tabs without restoring the retired enable/initialize controls.
- Actual ANSI output and zsh typed-command highlighting are verified separately. Existing user
  startup files/custom shell choices survive, plugin assets work in development and packaging,
  and running legacy commands are not interrupted to change their environment.
- Shared startup and per-surface preparation are race-safe and preserve sibling terminals.
- Deliberate terminal tab/host closure ends only its exact session and panes, including a session
  still being created; app shutdown/reload preserves sessions for restoration.
- Focused tests/type/i18n/build and independent review pass, with limitations recorded honestly.

## Completion — 2026-09-13

- Independent [review 176-1](../reviews/zellij-auto-open-directory-176-1.md) passes. Final Zellij
  tests: 115/115; Maestro: 21/21; Omni: 22/22. Focused strict TS, scoped lint, i18n and diff checks
  pass. Full main TS retains 64 baseline diagnostics, with none attributed to these changes.
- Final DEBUG_PROD application build passed in 31.33s, followed by `yarn dev:prod` and focused
  actual Web-terminal verification: automatic open, 48px toolbar, shared settings without native
  occlusion, restored focus, native split/new-session cwd inheritance and exact tab-close cleanup.
- A fresh session visibly rendered green commands, yellow quoted strings, red invalid commands
  and ANSI/truecolor output. The pinned bundled highlighter works without editing global rc files.
- Real legacy KDL upgraded to version `260912233309` with one backup; subsequent opens/relaunch
  left its hash and mtime unchanged. Normal app quit/relaunch preserved all four original sessions.
  All owned test tabs were closed and absent from active/cached session lists; the original active
  tab was restored without typing into it.
- Automated Electron E2E, signed packaging and Windows GUI execution were not run. Existing
  running shells retain their environment; the new input/color integration applies to fresh
  sessions while their existing work remains intact.
