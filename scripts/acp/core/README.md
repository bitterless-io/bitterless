# Shared ACP transport verification

Run from the application package root with its Yarn dependencies installed:

```sh
yarn tsc -p scripts/acp/core/tsconfig.strict.json
node --import tsx --test scripts/acp/core/core.test.ts
```

The suite uses the pinned official ACP SDK 1.4.0 as an independent client. It creates temporary fixture sessions and real UNIX sockets, reconnects after server restart, spawns both helper subprocesses, and exercises malformed messages, permissions, cancellation, ownership, stale/live endpoints and replacement-safe shutdown. Its deterministic host substitutes model output only; production hosts are injected through `AcpHost` and have their own runtime/storage tests.

`bridge.entry.ts` is a test-only TypeScript entry. Applications bundle `runAcpStdioBridge` and `runAcpMcpBridge` into their own Node-compatible helper entries for shipping. Both accept `--socket ABSOLUTE_PATH` or `--descriptor ABSOLUTE_PATH`. They never print diagnostics to stdout.

The MCP adapter holds up to 64 runs, retaining completed runs until a later start evicts the oldest completed run. Polling uses event-offset cursors, returns at most 200 event positions per call, and supports waits of at most 25 seconds. Continue paging whenever `hasMore` is true, including completed runs. Prompt execution has no generic RPC timeout. Each run has an 8 MiB/20,000-event limit; crossing it cancels the turn and reports an explicit error. Required permissions have a separate server timeout (120 seconds by default), and are never automatically approved.

The socket server accepts at most 16 connections, 128 pending requests per peer, request IDs of at most 1,024 characters, 4 MiB frames, and 16 MiB of queued output. Overrides for connection, permission and shutdown limits are explicit server options. UNIX endpoints use a user-owned 0700 directory and 0600 socket. A lifetime lock serializes startup and stale-socket recovery. The published socket is a hard link to an immediately removed staging bind path, so libuv shutdown cannot unlink a replacement at the public path; explicit cleanup checks inode ownership.

Windows uses local named pipes and the operating system's default process-token DACL without `readableAll` or `writableAll`. POSIX permission bits do not enforce Windows pipe ACLs. Windows runtime/ACL behavior is not verified by the macOS test run.

## MCP history and oversized event paging

`acp_session_load` returns `history` as its first bounded page, plus `replayId`, `historyIndices`, `eventReferences`, `fromCursor`, `cursor`, `hasMore`, and `totalEvents`. While `hasMore` is true, call `acp_session_history({replayId, cursor})`. The eight most recent successful replay handles are retained. Each replay is limited to 8 MiB and 20,000 events; overflow drains the ACP replay and returns an explicit failed tool response with no partial history. The session remains loaded and the helper remains usable. Use the ACP stdio bridge to stream history beyond these retention limits.

Normal updates remain unchanged in `history` or `events`; their absolute transcript positions are in matching `historyIndices` or `eventIndices`. Large updates are listed separately as `eventReferences: [{index,eventId,byteLength}]`. Merge both collections by their absolute index within the page range `[fromCursor,cursor)`. Reconstruct each reference by calling `acp_event_read({eventId,offset:0})`, decoding each base64 `data` fragment, following `nextOffset` until `hasMore=false`, concatenating those bytes, and parsing the resulting UTF-8 JSON. Each read returns at most 64 KiB of original bytes. Permission requests can similarly return `requestReference` when their payload is large.

Page size checks measure the serialized destination MCP envelope, including the nested JSON text escaping. Pages target 1 MiB; all tool responses have a 3 MiB wire-size guard below the transport's 4 MiB frame limit. Oversized non-pageable metadata returns a recoverable failed tool response rather than disconnecting the helper.
