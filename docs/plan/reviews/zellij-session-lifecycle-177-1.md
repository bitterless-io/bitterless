# Review: Zellij session lifecycle 177

Date: 2026-09-13
Branch: dev/next

Task: [session lifecycle 177](../tasks/zellij-session-lifecycle-177.md)
Issue: [session enumeration timeout](../../issues/zellij-session-enumeration-timeout.md)

## Status

**Independent code and isolated integration review passed.** No confirmed finding remains open.
The final frozen source passes `yarn test:zellij`: **170/170, zero skips**, independently rerun in
8.43 seconds. Log: `/tmp/bl177-review-final-zellij.log`. The native half-shutdown, late-close and
bootstrap-timeout regressions are corrected and rechecked. Parent build and live-app acceptance
are recorded separately below; this review does not claim they were performed by the reviewer.

No Electron app or real user session was touched by the reviewer. Only this review document was
edited; all implementation corrections were made by the assigned developers.

## Reviewed files and checks

- Zellij ChildProcess, NativeOwner, NativeIpc/types/protocol, NativeSession, WebBridge, Directory,
  Process, Runtime/types and TerminalView under `src/main/zellij/`.
- Zellij-related lifecycle and failure callbacks in `src/main/windows/omniWindow.helper.ts`,
  standalone/composite Window/Surface integration, and the two teardown-order changes in
  `src/main/app.main.ts` and `src/main/xpc/auth.handler.ts`.
- Associated `tests/zellij/` fixtures; the complete suite also rechecks config, shell/environment,
  shared settings, keyboard, rendering-state and task176 behavior.

Independent focused results before the final full run: 39/39 across the final child-process,
owner, native-session and actual-web fixtures; 14/14 Directory/global lifecycle checks before the
final host-order assertion was added. That assertion passed in the final 170-case run. Earlier
scoped helper/IPC lint and strict TypeScript checks passed independently; final implementation
lint/type results and their limits are attributed below. Tests use isolated Node/native children,
temporary homes and socket namespaces, and production-method mocks.

The command classifier distinguishes version/config/list/attach/action/kill/delete/token calls,
skips recognized option values and does not log command payloads. Structured errors contain safe
metadata only. Timeout tests verify actual observed SIGKILL and distinguish an unobserved kill
request; bounded fallback destroys the diagnostic streams and unreferences the child.

## Finding corrected and rechecked

The one-second close fallback was also scheduled after a normal exit and destroyed still-open
streams without assigning a failure. An independent production-module probe reproduced exit 0
resolving the partial stdout as success.
The same probe with exit 1 and an initial exact empty-inventory message was classified no-sessions
even though stderr had not reached EOF and could still contain additional failure text.

The forced-drain path now assigns close-timeout before destroying streams unless a prior failure
reason already exists. It no longer produces success or no-sessions from incomplete streams.
Independent rechecking passed all three new regressions: partial success rejected, incomplete
empty-inventory prefix rejected, and delayed complete output accepted only after close. Existing
timeout tests still preserve their original reason and observed termination metadata. No remaining
CLI diagnostic finding is open; the reviewer made no source edit.

## Server-stop contract rechecked

Concurrent stop callers receive one shared pending promise. The helper sends SIGTERM, waits two
seconds, escalates to SIGKILL and waits another two seconds for observed exit. A kill request alone
does not resolve success. If death remains unobserved it rejects, retains exited=false and preserves
public onExit observers. Signal-delivery errors for a live PID do not count as death; a failed spawn
with no PID is safely treated as having no live process. Actual exit releases the stop operation,
with a separate one-second deadline for a retained stderr pipe.

Independent checks included the committed real Node server that ignores SIGTERM and exits under
SIGKILL. An additional production-module probe covered retry while the process is still live after
the first stop failed: the retry received a new shared promise, a late exit notified the original
observer once, later stop sent no extra signal, and no timer remained after close. All passed.

The process caller retains ownership after an unobserved stop and cannot borrow that child as a
healthy server on Retry. Runtime source retains the web namespace/tombstones until confirmed death;
a late exit triggers cleanup only for the same owned process and bridge. Global shutdown joins
bridge cleanup and accepted explicit closes, including the stop-failure path.

## Lifecycle acceptance covered

- A healthy target can open, inspect and close while an unrelated endpoint accepts but never
  replies. Explicit targeting must avoid native global enumeration in both CLI and web paths.
- An unhealthy active session cannot serialize New Tab behind cwd observation. Preserve the last
  valid cwd, bound the whole preparation/quit operation and release probes, timers and transports.
- Missing, refused, malformed and unresponsive endpoints remain distinguishable. Genuine failures
  reach only the affected surface's Error/Retry state, without a speculative duplicate creation.
- Initial detached creation preserves config, shell/environment, cwd and first-client behavior.
  Real web attachment/reconnection is required in addition to native IPC success.
- Close during preparation and close/reopen/close cannot leave late orphans. Exact cleanup must
  fence PID/start-time/socket-identity changes and never delete a healthy replacement or sibling.
- Application quit preserves healthy session/pane processes; a new service runtime reattaches
  them while tolerating a retained unrelated hung socket. Intentional close ends only its target.
- Closed/failed bridge tombstones remain until the web server is actually stopped, including when
  its stop promise rejects with exited=false and a later exit arrives.

The cases above are covered by source review, production-method regressions and isolated native/web
fixtures. Electron lifecycle entry points are source-tested; actual Electron focus/navigation and
packaged Windows/macOS behavior are not implied by those tests.

## Native IPC and web evidence

The native IPC service/types/protocol and their two fixtures passed independently: 10/10 tests,
zero skips, scoped lint without warnings and strict TypeScript with zero diagnostics. Field numbers,
layout URL field 3, CliAssets and ExitReason were checked against the pinned 0.45.1 contract.
Framing tests include fragmented/coalesced messages, size limits, total timeout despite continuing
irrelevant replies, pre-aborted/active cancellation, missing/refused endpoints, malformed/truncated
EOF and redacted native rejection payloads.
[Pinned native contract](https://github.com/zellij-org/zellij/blob/v0.45.1/zellij-utils/assets/prost_ipc/client_server_contract.rs).

The independent staged-native fixture created an exact session with FirstClientConnected, checked
its cwd and pane metadata, and killed it without contacting the unrelated hung socket. Its old
global CLI control timed out against that same fixture. These are isolated temporary-home/native
namespaces, not user sessions.

The final native lifecycle and actual HTTP/WebSocket fixtures passed independently:
6/6, zero skips. They cover profile/default/relative custom layouts, bridge discovery,
unchanged native PID across transport restart,
exact close/reopen cwd with a healthy sibling, a real half-shutdown blocked on fixture web-server
IPC, direct and Directory-level cancellation during bootstrap, actual WebSocket ANSI render and
input, and a tombstone rejecting reconnection without native auto-creation. All fixture resources
were cleaned by their teardown. This is native integration evidence, not Electron UI/E2E coverage.

## Lifecycle findings corrected and rechecked

1. Directory.stop cleared preparation promises without joining cancelled bootstrap cleanup.
   An independent production-module probe showed stop resolved while owned spawn cleanup was still
   incomplete. It now joins the captured preparation promises; the original deferred probe and
   actual native Directory-stop fixture both pass.
2. A new prepare could complete during the Directory phase of global runtime shutdown, before the
   process-level stop gate existed. The production-method probe reproduced URL success before the
   old runtime was stopped. A shared whole-shutdown barrier now queues reopening; the original
   deferred probe passes.
3. The first barrier fix captured surface generation only after waiting, allowing an explicitly
   closed queued open to create a late orphan. This was independently reproduced. Generation is
   now captured before waiting and checked afterward; the committed production-method regression
   passes independently.
4. Failed WebBridge.listen left an entry that made Retry resolve without a bound socket. A real
   temporary Unix EADDRINUSE probe reproduced the false success. The failed entry is now removed
   with an identity guard; the real Unix bind-failure/retry regression passes independently.
5. NativeSession.close needed socket identity verification immediately before destructive IPC and
   a fresh endpoint check after the final asynchronous process-liveness check, before cache removal.
   Independent production-method probes now reject a changed endpoint before KillSession and an
   endpoint appearing during the final liveness await before cache removal. A real Unix IPC probe
   confirms post-connect verification failure writes zero bytes to the endpoint.
6. A close accepted after Directory.stop captured its closing promises was not joined. An
   independent production-module probe resolved stop while that late explicit close was still
   pending. Dynamic draining now joins closes accepted during preparation cancellation and all
   web/bridge teardown stages, including failures. The independent 14-case subset passes.
   App quit and logout now dispose Maestro/Omni hosts before the final Zellij drain; standalone
   surfaces dispose synchronously immediately afterward. Source and the final AST regression
   confirm this closes the later host-input gap without turning generic disposal into native kill.

The final suite also verifies Windows retains its matching-server reuse behavior and many retired
bridges answer discovery promptly without contacting failed native targets.

## Executable ownership rechecked

An independent worker reproduced adoption of an unrelated Node socket server whose mutable argv
imitated the bundled Zellij command. The corrected helper now compares the first file-backed
executable image reported by Darwin lsof, the realpath of the expected binary, process/socket UID,
start time, command and socket device/inode. Signal fallback rechecks live identity and refuses
processes with children. Legacy persisted records without a verified image remain unknown; image
or UID mismatches cannot be interpreted as proof that the process died.

The reviewer independently ran the final corrected owner and diagnostic subsets together with
native/web integration: 39/39, zero skips (10 owner, 23 child-process, 5 native-session and 1 web).
Fixtures verify argv spoof rejection,
the actual image/UID, a binary symlink with spaces, legacy/mismatch refusal and confirmed death.
All processes were isolated fixture children. Native bootstrap is now classified as
session-bootstrap without exposing the socket or command payload in diagnostic logs; the helper's
explicit five-second bootstrap deadline has a direct regression.

The initial image audit exposed Darwin's transient `?E` state after SIGTERM, when argv has been
discarded but the process is not yet a zombie. The correction does not treat `E` alone as death:
bounded fresh lookups require absence, a different birth, or a same-UID zombie. A live image/UID
mismatch stays unknown. Both state-machine regressions and the actual half-shutdown fixture pass;
the independent focused half-shutdown run completed exact cleanup in 3.40 seconds.

## Other verification and limits

- Parent independently reports 25/25 related Maestro/Omni tests, zero skips, and renderer i18n
  passing (`task177-related-tests.log`, `task177-i18n.log`).
- Developer final frozen checks: native helper strict TypeScript zero diagnostics; scoped
  18-file ESLint zero errors/warnings. Whole-main TypeScript still has 64 pre-existing diagnostics,
  none in Zellij. Auth full-file lint retains the untouched line39 prefer-const error and six old
  formatting warnings. This is not a claim that repository-wide typecheck/lint is clean.
- No Electron E2E, packaged-app smoke, install/reinstall, Windows native execution or signing was
  run by the reviewer. Native fixture evidence is macOS with staged pinned Zellij 0.45.1.
- No real user daemon, shell, session, config or database was mutated by review checks. Temporary
  fixture teardown and cleanup assertions passed.

## Parent build and live-app acceptance

Parent reports the final `debug_prod` `_build:debug` build passed, exit 0 in 24.40 seconds
(`task177-build.log`). During normal GUI quit, the old Electron and owned web processes exited;
all five canonical native PIDs remained unchanged, including the original hung session. A fresh
`yarn dev:prod` was launched afterward.

The parent subsequently completed manual CUA verification in the current DEBUG_PROD app. These
are parent-observed results, separate from the reviewer's independent tests:

- The previously failing tab `6ecd` restored to Connected. A fresh owned tab `6779` created native
  PID 9519; Super+D produced two zsh panes, PIDs 9526 and 9727. Screenshots confirmed red/green/blue
  ANSI output and colored input. Closing that tab removed all three PIDs and its exact socket/cache.
- Another owned tab `b71` created native PID 9814 and zsh PID 9821, born at 16:47:02. Normal GUI quit
  stopped Electron PID 9243 and web PID 9283 while preserving all five original canonical PIDs,
  restored-tab PID 9292, and PID 9814 with its shell. After `yarn dev:prod` relaunched Electron as
  PID 10178, selecting `b71` returned to Connected with native/shell PIDs and birth times unchanged;
  the parent successfully typed colored `AFTER_RESTART_OK` input.
- Closing `b71` then removed PIDs 9814/9821 and its exact socket/cache. The parent opened fresh
  tab `9a91a3f623b9`, confirmed Connected, and left it selected for Ral.
- Configuration stayed unchanged throughout: SHA-256
  `49072550aeb3bf3de273b865eeb6849c7a6779f9810cb5ff22cd5ed3283861ec`,
  mtime `1789228022503.4246`.

Manual acceptance is complete. No Electron E2E suite or packaged-app test was run. The independent
review pass remains unchanged, and the live observations do not extend coverage to packaging or
other operating systems.
