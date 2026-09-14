# Zellij session enumeration hangs and is logged as config-check

Status: fixed and verified, task 177
Reported by Ral, 2026-09-13
Related: [automatic opening and directories](../features/zellij-auto-open-directory.md)

## Observed failure

The web server spawned at 15:43:59.683. At 15:44:14.969 the application logged
`cli failed operation=config-check reason=timeout exitCode=null signal=none stderr=[empty]`,
while the terminal remained on Opening.

This is a session-enumeration failure. The configured binary and KDL validation both work.
An old native session accepts connections but does not answer its connection-status request.
The native CLI waits on that session while enumerating all sessions, affecting healthy siblings
and explicit-target CLI actions as well.

## Reproduction and isolation

Read-only probes used the staged Zellij 0.45.1 binary, the actual DEBUG_PROD configuration,
the production-debug socket namespace and the application's normalized terminal environment.

| Probe | Result |
|---|---|
| `--version` | Exit 0 in 9ms; 0.45.1 |
| `--config <actual-config> setup --check` | Exit 0 in 39ms; CONFIG FILE Well defined |
| `list-sessions --no-formatting` | No stdout/stderr; still blocked at the 6s probe deadline |
| Explicit `--session <name> action list-panes --json`, each of five sessions | Each blocked at the 4.5s probe deadline |
| Each real socket isolated behind a temporary transparent local Unix proxy | Four sessions replied in 10–29ms; one accepted the 6-byte request and sent no reply before 3s |

The unresponsive session was `bitterless-debug-e2c8a7d27447`, native PID 65453. It had no remaining
child shell processes. Sampling showed its main thread in `pthread_join`, no remaining pty/screen/
wasm/pty_writer workers, and a background_jobs worker blocked in `recvfrom`. Its listener still
accepted connections. The hung enumeration CLI was also blocked in `recvfrom`.

The shared native log records the wasm worker exiting and four plugins unloading at 15:32:03.
That log has no PID/session tag, so it supports the shutdown timing but does not independently
attribute those lines to this exact daemon. The inspected `web_server_bus` entry is a directory,
not a session socket; it is not the socket that blocked enumeration.

Only diagnostic CLI children and temporary proxy resources were stopped/removed. Existing
application/native-session processes, their real sockets, configuration and session caches were
left intact. Private sampling evidence is retained in the parent workspace's
`tmp/zellij-electron-start-diagnostic/` directory.

## Failure chain

1. The old native session is partway through shutdown but retains its listening socket.
2. Pinned native session enumeration checks sockets serially using a blocking ConnStatus receive
   without a read deadline. One unresponsive session blocks the entire enumeration. Explicit
   `--session` actions also perform this global enumeration before targeting their session.
3. `src/main/zellij/zellijChildProcess.service.ts` classifies every command other than token,
   action and attach as `config-check`. This incorrectly labels list/kill/delete operations.
   The application then terminates the blocked CLI after its 15s deadline.
4. `ZellijDirectoryService.listSessions()` catches every failure and returns an empty string,
   conflating timeout with the native no-sessions result. Preparation proceeds to attach and its
   metadata fallback, which can hit the same global blockage and prolong Opening.

The main-thread join and missing core workers establish incomplete shutdown. Pinned native code
drops session metadata (which joins background_jobs last) before unlinking the session socket.
One relevant blocking background path queries web-server IPC; the function accepts a timeout
argument but does not use it before a blocking read. This is consistent with the sampled worker,
but the stripped binary sample does not prove that connection's peer or the original trigger.
Do not label the deeper cause as a proven background self-ConnStatus deadlock: its session-list
refresh reads cached metadata rather than performing those probes.

Primary source review:

- [Session enumeration and connection-status probes](https://github.com/zellij-org/zellij/blob/v0.45.1/zellij-utils/src/sessions.rs)
- [Server worker joins and session cleanup](https://github.com/zellij-org/zellij/blob/v0.45.1/zellij-server/src/lib.rs)
- [Background web-server queries](https://github.com/zellij-org/zellij/blob/v0.45.1/zellij-server/src/background_jobs.rs)
- [Web-server IPC blocking read](https://github.com/zellij-org/zellij/blob/v0.45.1/zellij-utils/src/web_server_commands.rs)

## Repair requirements

- Make an unresponsive session unable to block healthy sessions; bound and isolate per-session
  health/IPC work. An explicit CLI target alone is insufficient with this pinned native version.
- Distinguish the documented no-sessions outcome from timeout, spawn and other failures; propagate
  genuine errors to the terminal's error/Retry state instead of treating them as an empty inventory.
- Log the actual operation and preserve useful timeout/termination metadata without token output.
- Address incomplete native shutdown and exact owned-session cleanup without terminating healthy
  user sessions or deleting unrelated session state.

The initial investigation changed documentation only. Ral subsequently authorized
[repair task 177](../plan/tasks/zellij-session-lifecycle-177.md), including normal tab opening and
closing both during one application run and after restarting it. Existing task 176 verification
did not cover a native daemon retaining a socket after its core workers exited; this case needs
a regression.

## Resolution and acceptance

Task 177 replaces Darwin's globally enumerating CLI session operations with bounded exact native
IPC, and isolates the native web server behind per-session bridges in its own temporary namespace.
An unrelated unresponsive canonical socket cannot block another terminal. Failed/closed bridges
remain tombstones until the owned web server exits, preventing native web reconnection from
creating a duplicate daemon. Genuine preparation failures reach Error/Retry with the actual
operation in diagnostics; hidden native creation is classified as `session-bootstrap`.

Deliberate tab closure audits the exact executable image, UID, process birth and socket identity,
then ends only that session and removes its exact resurrection state after confirmed death.
Bounded shutdown handles a native daemon whose core workers exited but whose background thread
and listener remain alive. On Darwin, transient `?E` process state is rechecked until death is
confirmed rather than being mistaken for a surviving unknown process or immediate successful exit.

Application quit preserves running native sessions, drains accepted create/close cleanup, stops
the owned web server, and releases its bridges. Host views stop accepting close intents before
the final drain. Restart rebuilds bridges for retained sessions. The original unhealthy session
was left intact during live acceptance; healthy/new terminals continued working beside it.

Verification: 170/170 Zellij tests passed independently with zero skips, including real native
half-shutdown and authenticated HTTP/WebSocket fixtures; 25 related Maestro/Omni tests, i18n and
the final debug_prod build passed. Manual application verification covered open, two-pane close,
open again, normal app quit/restart with unchanged native PID/shell, then close and open again.
Colored input/output were observed in the real terminal. The existing KDL hash and modification
time were unchanged. See [task 177](../plan/tasks/zellij-session-lifecycle-177.md) and
[independent review](../plan/reviews/zellij-session-lifecycle-177-1.md) for limits and evidence.
