---
id: zellij-login-path-001
scope: main/zellij
status: done
depends-on: []
verify: code-passed; owner-fresh-session-passed
---

## Objective

Make the managed default macOS zsh load login startup files so packaged Zellij discovers
installed commands from the same environment as the user's login terminal.

## Context

- [Issue and repair contract](../../issues/zellij-packaged-shell-misses-login-path.md)
- [Automatic terminal startup](../../features/zellij-auto-open-directory.md)

## Path

- `src/main/zellij/zellijShellIntegration.service.ts`
- `tests/zellij/zellijShellIntegration.test.mjs`

## Verification

Isolated real zsh tests with minimal inherited PATH, shell runtime/environment regressions,
full Zellij suite, scoped TypeScript/lint, build and independent review. No Electron E2E.

Results: focused 39/39; full Zellij 191/191; scoped strict TypeScript, ESLint and build passed.
[Review](../reviews/zellij-login-path-001-1.md): pass. Owner will repackage/update and test a
fresh terminal; existing sessions retain their previous environment.

Update recheck: the installed Preview build includes this repair. Its retained panes predate
the update; read-only process/ownership inspection confirms app restart reattached them.
An isolated real native default-zsh test using installed Preview binary/shell assets and minimal
GUI PATH passed; removing the login fix reproduced missing fixture commands. No additional
source change was needed. See the issue's retained-pane evidence and verification details.

2026-09-17: owner confirmed rebuilding the Preview session restores command discovery.
Cmd+C is a separate open native-selection defect, not part of the login startup repair.
