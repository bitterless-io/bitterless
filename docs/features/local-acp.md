# Local ACP agent access

Status: implementation in progress. Requested by Ral on 2026-09-16.

## Objective

Expose the existing Maestro agent inside Bitterless to external applications through a local Unix socket. Deliver a usable end-to-end integration, including persistent sessions, real runtime execution, streamed output, cancellation, permissions, standard ACP stdio interoperability, and an MCP adapter usable by Codex. Implement in the requested isolated worktree; after implementation and independent verification, merge into the original checkout's attached branch (release/2608), as explicitly requested by Ral in the same session. Re-check destination branch and worktree before merging. Ral also requested Git synchronization: sync the merged branch upstream after verification. Application release/deployment is out of scope.

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

## Usage

The server starts with the Bitterless GUI and remains locked until the normal Bitterless login and Maestro AI Login are ready. The first session request initializes the real Maestro SQLite preload and browser/tools runtime. Maestro may open its usual window because browser tools act on that live window. External sessions are separate from GUI conversations; they retain their workspace, conversation context, and ACP transcript in Maestro's existing SQLite store.

Production macOS discovery is `~/Library/Application Support/Bitterless/acp/production.json`. Other runtime profiles use their existing isolated userData directory and profile name (`production-debug`, `test-debug`, or `test-release`). The descriptor contains the actual short `.sock` path. `BITTERLESS_ACP_SOCKET` and `BITTERLESS_ACP_DESCRIPTOR` override the endpoint/discovery locations at app startup; their parent directories must be owned by the current user and mode 0700. A socket override must be absolute and shorter than 104 UTF-8 bytes on Unix.

For an ACP client with a command/args setting, use an ordinary Node 22+ runtime and the packaged byte-transparent bridge:

```json
{
  "command": "node",
  "args": [
    "/Applications/Bitterless.app/Contents/Resources/acp/acpStdio.cjs",
    "--descriptor",
    "/Users/YOUR_USER/Library/Application Support/Bitterless/acp/production.json"
  ]
}
```

For Codex, add this MCP server configuration to the desired Codex config, replacing the username and app location with the installed paths:

```toml
[mcp_servers.bitterless_acp]
command = "node"
args = ["/Applications/Bitterless.app/Contents/Resources/acp/acpMcp.cjs", "--descriptor", "/Users/YOUR_USER/Library/Application Support/Bitterless/acp/production.json"]
```

The MCP workflow is `acp_session_new` (absolute `cwd`) → `acp_prompt_start` → repeated `acp_prompt_poll` with the returned `runId`. Poll returns streamed updates, pending permission requests and final stop reason/error. Use `acp_permission_respond` with an explicitly chosen option from the pending request; no permission is approved automatically. `acp_session_cancel` remains callable while a prompt waits or runs. Reconnect using `acp_session_list` and `acp_session_load` with the saved session ID/cwd. This is ACP through MCP; Codex's native App Server protocol and `--remote unix://` are different protocols.

Development helpers are built by `yarn build:acp-helpers` into `build/acp/`. The normal Electron build also rebuilds these standalone helpers, and packaging copies them outside `app.asar` into `Resources/acp/`, so ordinary Node does not need Electron's ASAR loader. Helpers write only protocol messages to stdout. A direct ACP socket client can also connect to the descriptor's socket and send UTF-8 newline-delimited JSON-RPC 2.0.

Supported baseline: ACP v1 initialization/authentication, persistent new/list/load sessions, text/resource links, streamed text/thoughts/tool calls/results, host-policy permission requests, cancellation and transient session close. Runtime errors are protocol errors. The runtime's selected app model is used; there is no fake per-session model/config mode. Client-supplied MCP servers, image/audio prompts and embedded resources are rejected explicitly. No invented plan updates are emitted because the native Maestro runtime has no structured plan event.

Only one shared Maestro turn runs at a time across external clients, GUI chat, trainer/delegate and direct skill replay. Overlap returns an explicit busy error. Cancellation/disconnect stops the model and denies pending permissions. A host tool already executing cannot undo its effects; turn ownership is retained until underlying tool execution drains, including a tool whose model-facing timeout has expired. Logout cancels external turns and waits for final persistence before closing SQLite. Streamed transcript checkpoints are saved at most once per second and flushed on normal completion/cancellation; an abrupt process crash can lose the latest checkpoint interval.

Current verification: strict ACP TypeScript, 12 transport/helper integration tests, native Maestro/SQLite integration, full Electron build, customer-auth regressions and startup checks passed. See the [delivery task](../plan/tasks/acp-local-001.md) for exact commands, pre-existing Maestro test failures and environment limits. No live provider call or signed installer was required for this implementation; Windows-specific runtime/ACL behavior still needs a Windows execution environment.

Large MCP transcripts are paginated. `acp_session_load` returns the first `history` page with `replayId`, `cursor`, and `hasMore`; continue with `acp_session_history({replayId,cursor})` while `hasMore` is true. Likewise continue polling event pages even after a run completes. Oversized updates appear as `eventReferences`: follow `acp_event_read({eventId,offset})`, concatenate decoded base64 fragments using `nextOffset`, then parse the resulting UTF-8 JSON. Merge normal entries and references by their absolute indices. Replay retention is bounded; an overflow is an explicit tool error, and the stdio bridge can stream larger histories directly.

Logout fences the complete accepted prompt lifetime, including pending initial SQLite reads/writes and final persistence. A monotonic invalidation generation also rejects setup work that crosses logout and a fast re-login; an old accepted prompt cannot resume under the new login.
