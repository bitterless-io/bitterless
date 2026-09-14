---
id: zellij-socket-startup-diagnostics-175
scope: repair overlong macOS Zellij session sockets and preserve native startup diagnostics
status: done
depends-on: []
verify: native child and environment tests, logging boundary tests, strict helper typecheck, independent review, owner-requested actual startup diagnosis
---

# Restore Zellij session startup on macOS

## Contract

Follow [the diagnosed issue](../../issues/zellij-terminal-no-error-trace.md). The actual session
socket reaches 108 bytes on this machine; macOS Zellij permits at most 103. HTTP startup alone
passes and does not exercise the failing session path.

- Give both CLI and server children a stable short macOS socket directory, isolated by UID and
  existing runtime profile ID. Keep full socket paths within 103 UTF-8 bytes for every supported
  profile and maximum 48-character application session name.
- Keep global environment/TMPDIR and Windows behavior unchanged; preserve explicit overrides.
  Create private directories, reject unsafe existing directories, and retain existing sessions.
- Capture bounded sanitized native stderr, spawn OS error, exit code and signal. Distinguish
  requested shutdown from failure and never log token stdout or environment credentials.
- Recognize the allowed Zellij surface query in the first-party renderer log policy while
  retaining origin/path/credential checks.

## Files

Zellij runtime, child-process/environment helpers and tests; renderer log policy and its tests.
Preserve previous SQLite/external-tools work and the current branch. Root owns issue/task/index
updates; implementation and independent review are assigned to separate agents.

## Verification

- Focused Zellij and application-diagnostics suites, strict helper typecheck and scoped lint.
- Ordinary Node and a no-window Electron main-process startup comparison.
- Owner-requested real startup diagnosis: script native server, connect the existing Electron
  terminal, capture the original native error, then verify actual shell readiness with the
  repaired application startup. No automated Electron E2E suite or packaged smoke run.
- Stop only diagnostic-owned processes; retain the user's intended dev application.

## Progress

The original native error was reproduced with the real Electron terminal. A controlled short
directory reduced the actual path to 75 bytes and restored the visible shell prompt. Runtime
fix and diagnostic capture are implemented. Zellij 53/53 and application diagnostics 18/18 pass;
strict helper typechecking passes; scoped lint has zero errors and 22 pre-existing formatting
warnings in unchanged code. Independent review passed without blocking findings.

The temporary diagnostic server was stopped and the actual `yarn dev:prod` entry rebuilt and
restarted. The application then spawned its own Zellij child with no pre-existing listener;
four restored terminal surfaces connected and the visible terminal displayed a shell prompt.
Four real session socket paths are each 75 bytes. Structured main logging now records Zellij
spawn details and events from surface-query renderer URLs. The intended developer app remains
running; no automated Electron E2E suite or packaged-app smoke run was used.

Review: [independent review 1](../reviews/zellij-socket-startup-diagnostics-175-1.md).
