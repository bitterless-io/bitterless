# Zellij startup failure loses the native process error

Status: fixed and verified in the actual macOS developer application (2026-09-12)

## Report

After the external-tools preparation repair, Ral still sees:

> Zellij stopped or could not start. Choose Initialize and open to retry.

The initial investigation answered the root-cause request without a runtime repair. Ral's
follow-up asks for scripted native startup and diagnosis of the actual Electron startup path.

## Confirmed startup failure

A scripted web server on the real DEBUG_PROD port starts normally. When the existing Electron
window initializes its terminal surfaces, native stderr reports:

```text
Error: the IPC socket path is too long (108 bytes, max 103):
  <macOS TMPDIR>/zellij-501/contract_version_1/bitterless-debug-e2c8a7d27447

This is usually caused by a long $TMPDIR path.
```

The actual macOS temporary-directory prefix is 49 bytes; the complete path is 108 bytes.
The native web-server child exits with code 1 and no signal. Electron initially displays
Connected, then session reconnection errors. In the usual owned-process path, the exit becomes
the reported `start-failed` message.

The failure is session socket creation, not download/staging or basic HTTP server startup.
Both ordinary Node and a no-window Electron 40.10.6 main-process harness passed the HTTP version
probe because that probe does not create a terminal session. Connecting the actual Electron
surfaces to the scripted server is what reproduced the error and captured its native cause.

The repair gives macOS Zellij children a short, stable, user/profile-isolated socket directory
through `ZELLIJ_SOCKET_DIR`, consistently for server and CLI invocations. Preserve existing
session names, other environment values and global `TMPDIR`. Windows behavior is unchanged.
Ensure the managed directory belongs to the current user, is private, and does not follow a
pre-existing foreign/symlink directory; do not delete sockets or stop unrelated sessions.
Cover the longest application profile/session combination against the native byte limit.

The controlled repair diagnostic used `/tmp/bzdx-production-debug` for UID 501. With the same
session name its socket path is 75 bytes. The existing Electron terminal surfaces reconnected,
and the visible terminal displayed Connected and an interactive shell prompt. This validates
session creation, beyond the earlier HTTP-only checks. Application-managed startup was then
verified after rebuilding/restarting the same `yarn dev:prod` entry, as recorded below.

Pinned upstream semantics: [`consts.rs`](https://raw.githubusercontent.com/zellij-org/zellij/v0.45.1/zellij-utils/src/consts.rs)
uses the override as the base directory and appends the contract-version component;
[`client/lib.rs`](https://raw.githubusercontent.com/zellij-org/zellij/v0.45.1/zellij-client/src/lib.rs)
enforces the 103-byte macOS limit and exits 1 for an overlong session socket path.

## Confirmed cause of the missing explanation

- `src/main/zellij/zellijRuntime.service.ts:91` spawns the web server with `stdio: 'ignore'`.
  Lines 95–100 use the same callback for `exit` and `error`, retaining neither exit code/signal
  nor the OS spawn error. Native stdout/stderr are never captured.
- `src/main/zellij/zellijProcess.service.ts:161–170` maps any owned-child exit/error to
  `start-failed`. The same message can describe a startup failure or a later process exit;
  it does not establish that the exit code was nonzero.
- The catch at process-service line 199 returns a normal snapshot containing only the error
  enum. Consequently the renderer's IPC-error catch does not log this failure.
- A separate logging defect also affects this surface: `zellijSurface.ts:61–70` always adds
  `?surface=...`, while `src/main/logging/logPolicy.service.ts:56` rejects every URL containing
  a query. Renderer console errors from that URL cannot reach `main.log` through this policy.

These explain why the interface had no cause and why the application log could not recover it.
The subsequent live-session diagnostic above establishes the native cause independently.

## Initial local evidence and limits

Checked macOS ARM64, the running `debug_prod` developer process, and its profile configuration:

- The staged Zellij binary exists, is 41,421,856 bytes, and reports version `0.45.1`.
- The profile uses port `12879` and `<userData>/zellij/config.kdl`. No listener occupied this
  port before the diagnostics. No Zellij config/port override was identified at launch.
- Native `--config <file> setup --check` reports `[CONFIG FILE]: Well defined.`.
- Native `web --status --ip 127.0.0.1 --port 12879 --timeout 1` reports offline with exit 0.
- Two bounded native web-start diagnostics using the real binary/config/port printed
  `Web Server started on 127.0.0.1 port 12879`, with empty stderr. Each remained alive until
  the diagnostic harness ended its own process after five seconds. The second used the
  developer process's launch environment, read in memory without printing environment values.
- A final diagnostic used that launch environment and the same `shell: false`,
  `windowsHide: true`, `stdio: 'ignore'` spawn options as the adapter. `/info/version` returned
  HTTP 200 and `0.45.1`; the child had not exited. The harness then sent SIGTERM only to its own
  child and verified the port had no remaining listener.
- The existing DEBUG application log had no matching Zellij failure entry. The native Zellij
  log was empty when inspected, and no Zellij crash report was found in the standard user/system
  diagnostic-report directories.

Those initial native HTTP checks succeeded, but did not exercise session socket creation.
Another `tools:init` or another binary download would not shorten the socket path. The later
live-session diagnostic above resolves the previously unknown failure.

The initial investigation did not run Electron/E2E, terminal sessions, login, token creation,
or user database operations. The follow-up uses a no-window Electron diagnostic harness and
the existing application's Initialize button to reproduce its actual terminal-session startup.
It does not launch an Electron E2E suite or access the application database directly.

## Next repair and verification

Capture bounded native startup stderr and structured spawn/exit details in the main-process
adapter, redact sensitive values, and log the failure before reducing it to the public enum.
Do not log token-command stdout. Make the renderer log policy recognize the permitted Zellij
surface query without relaxing its origin/path checks. Cover these behaviors at the adapter and
log-policy boundaries; existing mocked process tests and native config parsing do not exercise
them. The root cause is now reproduced above; verify both native diagnostics and actual session
creation after shortening the socket directory.

Related: [external-tools preparation repair](zellij-debug-runtime-misses-initialized-tools.md).

## Follow-up execution contract

Compare bounded native startup from Node and from a real Electron main-process harness, without
opening a window, terminal session, or the full Bitterless app. Keep diagnostics under the
private workspace's `tmp/` directory and clean up only processes owned by the harness.

Repair the confirmed diagnostics defect in the production Zellij adapter. Capture bounded
stderr, child exit code/signal and spawn OS error, distinguish requested stop from unexpected
failure, and emit the diagnostic through the existing application logger. Retain the existing
public error codes. Never log token-command stdout, environment values, or authentication data;
sanitize native diagnostics before logging. Runtime-level failures must be logged even when the
renderer receives an ordinary error snapshot. Correct the known Zellij surface-query log filter
with an explicit allowed query and retain existing origin/path protections. Cover the adapter
and renderer-log-policy boundaries with non-Electron tests and obtain independent review.

## Final implementation and verification

- `zellijEnvironment.service.ts` supplies `/tmp/bz<base36 uid>-<profile id>` to both the CLI
  and server adapter. The worst supported UID/profile/session combination is 101 bytes.
  Managed directories are private and validated; explicit overrides and Windows are unchanged.
- `zellijChildProcess.service.ts` records actual spawn/exit diagnostics and sanitized bounded
  stderr through application logging. Token stdout and environment values are not logged.
- The log policy permits the known single Zellij surface query while retaining URL checks.
- Focused verification: 53 Zellij tests, 18 application-diagnostics tests, strict typechecking
  of the new helpers and independent review all pass. Scoped lint has zero errors; 22 existing
  formatting warnings remain in unchanged portions of the runtime and diagnostics test files.
- The temporary diagnostic web server was stopped. The existing developer application was
  normally quit and the same `yarn dev:prod` entry relaunched with its original launcher
  environment held only in memory. Main/preload development builds completed successfully.
- With no listener on port 12879, Initialize caused the new Electron main PID 67890 to spawn
  its own Zellij server PID 68266. All four restored surfaces displayed Connected; the visible
  terminal showed the shell prompt. Four real session sockets were present, each 75 bytes.
- Structured `main.log` contains `scope: zellij` with the owned spawn PID and `renderer:zellij`
  events from the surface-query URLs, confirming both diagnostic paths are active.
- Diagnostic-owned servers are stopped; the intended developer app and its owned Zellij server
  remain running. No automated Electron E2E suite, signed package, or direct application database
  operation was performed. Ordinary Initialize authentication/session behavior was exercised.

Task: [175](../plan/tasks/zellij-socket-startup-diagnostics-175.md).
Review: [independent review](../plan/reviews/zellij-socket-startup-diagnostics-175-1.md).
