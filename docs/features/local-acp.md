# Local ACP agent access

Status: implementation in progress. Requested by Ral on 2026-09-16.

## Objective

Expose the existing Maestro agent inside Bitterless to external applications through a local Unix socket. Deliver a usable end-to-end integration, including persistent sessions, real runtime execution, streamed output, cancellation, permissions, standard ACP stdio interoperability, and an MCP adapter usable by Codex. Work stays on the requested isolated worktree and branch; do not merge or deploy as part of this task.

## Protocol and transports

Implement stable Agent Client Protocol v1 (JSON-RPC 2.0, UTF-8 newline-delimited messages). Current v2 is draft. Prefer official SDK types/validation when compatible with the existing build; pin the exact version. Socket transport is documented custom ACP transport, not HTTP or Codex App Server protocol. Provide a byte-transparent stdio helper and a separate MCP stdio helper forwarding to the same ACP server. Helpers must work from built/packaged app resources and an ordinary Node runtime, with protocol-only stdout and diagnostics on stderr. No configuration or credentials are changed in another app automatically.

| Surface | Contract |
|---|---|
| initialize | Negotiate v1, publish truthful capabilities and agent identity; reject malformed requests and requests before initialization |
| authenticate | Explicit supported local authentication state or typed auth failure; never silently bypass the existing app/provider login boundary |
| session/new | Validate absolute existing cwd, create a durable external session with unique identity, initialize real host runtime and bind workspace |
| session/list | Enumerate this integration's durable sessions with stable pagination and cwd filtering; do not expose unrelated local conversations |
| session/load | Reopen an existing external session after disconnect/restart, validate cwd, replay saved user/agent history before returning |
| session/prompt | Text and resource_link baseline support, other content only when real runtime supports it; persist prompt/reply, stream session/update; explicit errors for unsupported inputs or MCP configurations |
| session/cancel | Cancel in-flight runtime and outstanding permissions; prompt completes with cancelled stopReason; connection stays usable |
| session/update | Correct session identity on text/thought chunks, tool start/result/error, and real plan updates when present; no cross-session leakage |
| permissions | Relay required tool confirmations using session/request_permission; never automatically approve. Validate replies, cancel on disconnect; retain existing host permission policy |
| optional mode/model/config APIs | Expose only actual supported runtime controls with correct scope; no fake success, no global model mutation masquerading as session config |
| errors | JSON-RPC parse/invalid request/method/params and runtime errors remain explicit; notifications never receive replies |

The MCP adapter exposes discoverable tools for session create/list/load/prompt/cancel and explicit permission response if interactive client requests cannot be used. It must support long-running turns without preventing cancellation or permission resolution, preserve streamed evidence and stop reasons, reject unknown sessions/options, and never auto-approve tool requests. Document concrete Codex MCP setup and other ACP-client stdio setup.

## Runtime and persistence

Use existing Maestro runtime/controller and conversation storage, not an echo agent or a second LLM integration. Initialize the actual database/host prerequisites before exposing readiness. External sessions have an explicit namespace/owner and cannot be overwritten by stale renderer saves. Store cwd and replayable transcript durably. Reconstruct runtime conversation context on reload. Reuse existing XPC for main/preload/renderer communication. No native Electron IPC additions. External execution must preserve existing application/auth boundaries and existing tool confirmations.

Until shared browser/turn state is made per-session, serialize or explicitly reject overlapping turns across the application; do not silently race external clients or GUI turns. A session can have only one active owner/turn. On disconnect, cancel its turns/permissions, unsubscribe and release ownership while preserving durable history. On shutdown, close clients/server and clean only the socket owned by this process.

## Local endpoint lifecycle

Derive environment-specific endpoint from existing app userData/runtime directories. On macOS use a short .sock path under a user-only directory (0700), socket 0600; Windows uses a named pipe with owner-appropriate boundary. Publish an atomic discovery descriptor without secrets, separate release/development instances, and document overrides. Detect live endpoint and stale socket safely. Do not unlink arbitrary files, symlinks, a live server's endpoint, or a replacement owned by another process. Handle split UTF-8 frames, multiple lines per read, backpressure, bounded message sizes/connections, timeouts for peer permission replies and shutdown.

## Verification

- Strict focused TypeScript check (a --noCheck pass is insufficient).
- Real socket + protocol client tests: initialize, pre-init rejection, malformed requests, new/list/prompt/load/reconnect, streaming, persistence, cancellation, permission allow/deny/cancel, disconnect, busy sessions and cross-session isolation.
- Real stdio bridge subprocess and MCP adapter tests through the socket, including long-running prompt cancellation and deferred permission resolution.
- Runtime integration tests cover real adapter/controller and storage wiring; substitute only model/network output or Electron boundary when unavoidable and explicitly report it. No credentials or real business writes needed.
- Endpoint lifecycle tests cover stale/live/non-socket/symlink ownership, environment separation and shutdown.
- Build helper/main entries and run affected existing regression suites; record any pre-existing or environment failures accurately.
- Separate agent review, blocking fixes and re-verification.

## Sources

- [ACP v1 overview](https://agentclientprotocol.com/protocol/v1/overview)
- [Transports](https://agentclientprotocol.com/protocol/v1/transports)
- [Initialization](https://agentclientprotocol.com/protocol/v1/initialization)
- [Session setup](https://agentclientprotocol.com/protocol/v1/session-setup)
- [Prompt turn](https://agentclientprotocol.com/protocol/v1/prompt-turn)
- [Tool calls and permissions](https://agentclientprotocol.com/protocol/v1/tool-calls)
- [Cancellation](https://agentclientprotocol.com/protocol/v1/cancellation)

## Delivery evidence

To be completed after implementation and independent verification.
