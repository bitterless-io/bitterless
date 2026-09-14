---
id: zellij-session-lifecycle-177
scope: isolate unhealthy native sessions and make terminal open-close reliable across application restart
status: done
depends-on: []
verify: bounded IPC and error regressions, isolated native open-close and service-restart fixtures, related Zellij tests, focused TS/lint/i18n, build and independent review
---

# Reliable Zellij session lifecycle

Ral authorized this repair on 2026-09-13 after the
[session-enumeration timeout diagnosis](../../issues/zellij-session-enumeration-timeout.md).
Opening and closing terminals must work while the app runs and after quitting/restarting it.

## Acceptance

- A session that accepts a connection but never answers cannot block opening, inspecting or
  deliberately closing another session, including creation of a new session.
- Deliberate tab closure ends only its exact session and panes and cleans its resurrection state,
  even when native shutdown leaves a process/socket behind. Closing during preparation and
  immediate reopening remain race-safe.
- Application shutdown preserves live sessions. The next application runtime restores their
  identities and can create/close terminals normally. Existing healthy user tasks remain intact.
- Native session checks and shutdown work have bounded waits and release diagnostic/IPC resources.
  Ownership and process identity must be verified before any cleanup. Preserve explicit overrides
  and supported platform behavior; never use global kill or prefix-based deletion.
- No-sessions is distinguished from timeout/spawn/other errors. Genuine failures reach Error/Retry
  without another speculative attach attempt. Log the actual operation and useful failure details,
  without raw tokens, command payloads or environments.
- Reproduce the half-stopped-socket case in isolated native fixtures and demonstrate the corrected
  behavior; source-only tests or a happy-path ANSI probe do not satisfy this regression.
- Run the focused checks and build; a separate agent reviews the implementation and evidence.
  Do not run an automated Electron E2E suite or packaged-app smoke test.

Root owns the issue/task and completion records. The implementation agent owns the Zellij source
and associated tests; the independent verifier owns review 177-1. Work on the current branch and
preserve the earlier SQLite, external-tools, startup, settings and color changes.

## Implementation boundary

Keep real native session endpoints in the existing canonical namespace. On Unix, use the pinned
native protocol with bounded exact-endpoint requests for health, metadata, creation and shutdown;
ordinary explicit-target CLI commands still enumerate every session and cannot provide isolation.
The native proof created a session in 194ms, read panes in 2ms and closed it in 33ms without
contacting an unrelated accept/no-reply socket; a legacy global-list control reached its deadline.

The native web client also performs global discovery. Give only the web server a private ephemeral
namespace of application-owned bridges for prepared sessions. Bridges forward normal traffic to
the exact canonical native endpoint. Internal ConnStatus describes the bridge's availability;
the application separately verifies actual session health and surfaces failures through Error/Retry.
Keep closed/failed bridge tombstones until that web server stops so late native reconnects cannot
auto-create duplicate daemons in the bridge namespace. Quit closes the web server and bridges,
while restart rebuilds bridges for retained canonical sessions.

Pin and test the protocol against the distributed binary; do not introduce a general serializer or
replace the native distribution. Preserve the supported Windows path and its platform-specific
transport. Exact cleanup must verify process and socket identity, including legacy sessions,
before escalation after a bounded graceful stop.

## Verification evidence

Isolated fixtures use temporary homes, configuration, authentication, caches and socket namespaces;
they do not modify the existing user sessions. The pinned 0.45.1 native binary was exercised directly.

- Native lifecycle fixtures reproduce an accepting/nonreply sibling and a partially stopped native
  daemon. Exact creation, metadata and close avoid the sibling; bounded cleanup removes the owned
  daemon, socket and resurrection cache. Stopping during creation cleans the unfinished daemon.
- A real native web server authenticates and renders ANSI output over paired terminal/control
  WebSockets through the production bridge. Input receives output without contacting the hung
  sibling. Recreating the web server and bridges reconnects the same native PID. A retired bridge
  rejects late web attachment without allowing the native web server to create another daemon.
- Independent review reproduced shutdown/preparation, queued-open cancellation, late-close drain
  and failed-bind Retry races. All were corrected and independently rechecked. Host quit/logout
  dispose the Maestro/Omni entry points before draining accepted terminal work.
- Native ownership requires the actual executable image, UID, process birth and exact socket
  identity. An argv-spoofing process is rejected. Darwin's transient `?E` exit state is boundedly
  rechecked until death is confirmed; unknown ownership never authorizes cleanup.
- Final Zellij suite: 170/170 passed, zero skips, both developer and independent verifier.
- Related Maestro/Omni source tests: 25/25 passed. Renderer i18n check passed.
- New native helper strict TypeScript and scoped core ESLint passed. Whole-main TypeScript retains
  64 unrelated existing diagnostics; the auth handler retains unrelated existing lint findings.
- Final `debug_prod` `_build:debug` build passed in 24.40s. No packaging, signing or publishing.

## Actual application acceptance

The parent agent manually verified the real `yarn dev:prod` application through its UI on
2026-09-13. The previously failing restored tab reached Connected. A separate temporary tab
accepted input and displayed red/green/blue output; splitting it created two shell processes.
Closing that tab ended its native daemon and both shells and removed its exact socket and cache.
Opening another tab succeeded.

A second normal GUI quit stopped Electron and its owned web server while preserving the native
test session and all five pre-existing native sessions. After relaunch, the test tab reconnected
to the same daemon and shell with unchanged process birth times, accepted input and displayed
colored output. Closing it again removed its processes, socket and cache. A fresh connected tab
was then left selected for Ral's requested testing. Both temporary closed sessions were cleaned.
The existing KDL file's SHA-256 and modification time remained unchanged across both restarts.

[Independent review 177-1](../reviews/zellij-session-lifecycle-177-1.md) passed. The live UI checks
above are parent-agent manual acceptance, separate from the independent native fixtures. No
automated Electron E2E suite, packaged-app smoke test or Windows native run was performed.
