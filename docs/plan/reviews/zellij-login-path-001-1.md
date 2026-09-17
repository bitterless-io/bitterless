# Review: packaged Zellij login PATH 001

Date: 2026-09-16. Reviewer: independent verification agent, separate from implementation.
Baseline: `dev/next`, `35c3c51b`; reviewed the current uncommitted change.

Task: [zellij-login-path-001](../tasks/zellij-login-path-001.md)
Contract: [packaged shell command discovery](../../issues/zellij-packaged-shell-misses-login-path.md)

## Result

**PASS for the source and shell behavior reviewed.** No blocking or nonblocking findings.
The reviewer changed only this review document in this repository.

## Scope and contract

- Reviewed `src/main/zellij/zellijShellIntegration.service.ts` and its shell integration tests.
  The runtime change is exactly five added lines in the generated `.zshenv`; there is no
  hard-coded PATH, global environment change, dotfile edit or session lifecycle change.
- Interactive/RCS startup sets login before forwarding user `.zshenv`. Native zsh then chooses
  its profile, rc and login phases, and user `unsetopt login` remains authoritative. Existing
  highlighter placement stays after user login widgets, with the user's ZDOTDIR restored.
- Unchanged runtime routing still bypasses the integration for explicit KDL ZDOTDIR; the helper
  still bypasses explicit default_shell and non-zsh shells. Development and packaged sessions
  use the same helper. Existing shells are not modified or restarted.
- Implementation matches Cowork after normalizing application names and variable prefixes.
  Both copies' tests exercise actual `/bin/zsh`, isolated dotfiles and minimal inherited PATH;
  the executable/function test resolves fixture paths before executing its harmless stubs.

## Independent verification

- Selected shell regression tests: **9/9 passed, zero skipped** using:
  `node --test --test-name-pattern='GUI PATH|interactive startup|follows ZDOTDIR|user env can opt out|the -f startup|RCS opt-out|nested zsh' tests/zellij/zellijShellIntegration.test.mjs`.
  Covers executable and rc-function discovery, `-i`/`-il` startup once, native logout, cwd/theme,
  changing ZDOTDIR, highlighter order, login/RCS opt-outs, noninteractive and nested shells.
- Separate in-memory baseline/current probe loaded the actual helper from HEAD and the worktree,
  generated private shims under a temporary HOME, and ran `/bin/zsh` with minimal PATH.
  HEAD `-ic` could not locate the unique fixture command and traced `env → rc`.
  Worktree `-ic` and `-ilc` located it and traced `env → profile → rc → login → logout` once.
  Noninteractive startup traced only env; `-f` traced nothing; user login opt-out traced env/rc.
  Explicit default_shell and non-zsh returned the original environment without generating shims.
  Caller environment stayed unchanged. The same independent matrix passed for Cowork.
- Scoped `git diff --check`: passed. Temporary fixture files were removed.

## Limits

This review does not claim Electron E2E, an installed/packaged-app launch, actual Claude execution,
or validation of real user startup files. No such actions were performed. Full suites, strict
TypeScript/lint and builds are the parent's separate verification work. After updating the
client, a fresh terminal is required; already-running shells retain their environment.

## Subsequent parent verification

The parent reports the full Bitterless Zellij suite passed **191/191**. This is separate from
the reviewer's independently executed shell tests and baseline/current probe above. Cowork's
full suite has two independently attributed pre-existing harness/staging failures, recorded in
its corresponding review; they do not change this source-and-shell review result.
