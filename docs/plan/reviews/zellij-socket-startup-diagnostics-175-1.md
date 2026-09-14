# Review: Zellij socket startup and native diagnostics 175

Date: 2026-09-12

Task: [zellij-socket-startup-diagnostics-175](../tasks/zellij-socket-startup-diagnostics-175.md)

## Findings

No P1/P2 blocking findings in the task-scoped implementation.

## Contract and integration evidence

- **Socket-path bound.** `src/main/zellij/zellijEnvironment.service.ts:4` gives macOS children
  `/tmp/bz<base36-uid>-<profile>`. The longest supported profile is `production-preview`; a
  maximum 32-bit UID uses seven base-36 digits. The base therefore uses at most 33 bytes,
  `/contract_version_1/` uses 20, and the existing session resolver generates at most 48 ASCII
  bytes: 101 total, within the documented 103-byte native limit. The environment tests exercise
  all five actual profiles, UID 0/501/0xffffffff and the real session-name resolver.
- **Environment scope and directory ownership.** The environment helper returns a copy only for
  macOS without an explicit nonempty override. It preserves global `process.env`, `TMPDIR` and
  unrelated variables. Windows and explicit overrides return the original environment. Managed
  directories are created with mode 0700 and checked with `lstat`: non-directories, symlinks,
  another UID and group/other permissions fail closed. Existing contents are retained and no
  cleanup or permission repair of another directory is attempted. Behavioral tests cover these
  cases. `zellijRuntime.service.ts:59` and line 62 both call the same preparation function for
  CLI and foreground server children; the production adapters actually receive its environment.
- **Native diagnostics.** `zellijChildProcess.service.ts:10` retains a 16 KiB stderr prefix,
  omits an incomplete final line when truncated, strips terminal control sequences, then applies
  the existing diagnostic redactor before exposure. CLI stdout is never logged; server stdout
  is ignored. Spawn/exit logging exposes only selected launch fields, sanitized OS code/syscall,
  exit code, signal and stderr. Arguments and environment values are not dumped. The application
  logger additionally applies its existing sanitizer to console messages.
- **Lifecycle.** Server exit/error marks the owned process ended once and notifies subscribers;
  `close` supplies drained stderr and distinguishes requested shutdown from unexpected exit or
  spawn error. Requested stop retains bounded SIGTERM/SIGKILL behavior. CLI completion uses
  `close` instead of `exit`, retaining the existing stdout cap and timeout. The runtime logs its
  public failure enum before publishing an ordinary snapshot, so a renderer exception is no
  longer required for a failure record. Existing runtime ownership tests still pass, including
  external-server reuse and cancellation.
- **Real adapter coverage.** `tests/zellij/zellijChildProcess.test.mjs` bundles the production
  adapter and spawns real Node child processes. It verifies nonzero exit, missing executable,
  signals, requested stop, split-chunk credentials, oversized/truncated stderr, private stdout,
  stdout overflow and supplied child environment. These are adapter/process-boundary tests,
  not mocks of the new implementation. Native Zellij session behavior is a separate live check.
- **Renderer log boundary.** `logPolicy.service.ts:58` permits exactly one valid `surface` query
  only for the recognized Zellij entry. Existing credentials, origin, port and path checks remain
  in place. Added behavioral coverage includes dev and packaged URLs, duplicate/unknown/empty
  parameters, invalid surface values, other renderers, remote origins, wrong ports and URL
  credentials.

## Independent verification

- `yarn test:zellij`: 53/53 passed. This includes the existing native configuration parser check;
  it does not start a Zellij server or terminal session.
- `yarn test:application-diagnostics`: 18/18 passed.
- Strict TypeScript check of both new helpers and their imported types passed using the private
  diagnostic tsconfig. This is a focused helper check, not a claim of whole-application typecheck.
- Scoped ESLint across the eight implementation/test files: zero errors, 22 formatting warnings.
  The warnings occur in unchanged blocks of the existing runtime and diagnostics-test files;
  the new helper/test files and changed log-policy block have no lint reports. No formatter or
  source mutation was performed by this review.
- `git diff --check` passed. The branch remains `dev/next`; no branch or sync operation occurred.

## Runtime evidence and limits

The root investigator supplied the original actual-Electron failure (108-byte socket path,
native exit 1), and a controlled short-directory run with a 75-byte path and a visible interactive
shell. Those observations explain why an HTTP-only startup probe previously passed. This review
checked their documented relationship to the production repair, but did not independently repeat
the live session or inspect user session contents.

The root subsequently completed the application-managed startup check. It stopped only its
diagnostic web-server process, normally quit the previous developer Electron process, and
relaunched the actual `yarn dev:prod` command using the original launcher environment held in
memory. Before Initialize, port 12879 had no listener. Clicking Initialize in the existing fourth
terminal tab caused the new Electron process (PID 67890) to spawn its own server (PID 68266,
parent PID 67890). All four surfaces reported Connected; the fourth displayed a stable interactive
shell prompt. Four real session sockets existed under
`/tmp/bzdx-production-debug/contract_version_1`, each with a 75-byte full path.

The root also observed the new structured `main.log` record for the application-owned server
spawn, including its binary/config/port fields. `proc:renderer:zellij` Vite events reached the
same log, establishing that the permitted surface query now passes the renderer capture policy.
No unexpected native exit was observed during the new launch. These live observations are
attributed to the root investigator; this reviewer did not operate the application or inspect
terminal contents independently.

This review did not launch Electron, an E2E suite, a native web server, token creation, a packaged
app or a user database operation. Windows runtime execution and packaged startup are not
established by these macOS checks. No automated E2E suite or signed packaging was performed in
the root's final live validation.

## Conclusion

**pass** — the implementation meets the task's socket-path, scoped environment, ownership and
diagnostic contracts. The root's final application-managed startup check also confirms actual
terminal readiness and both native/renderer logging paths.
