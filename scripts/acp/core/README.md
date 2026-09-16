# Shared ACP transport verification

Run from the application package root with its Yarn dependencies installed:

```sh
yarn tsc -p scripts/acp/core/tsconfig.strict.json
node --import tsx --test scripts/acp/core/core.test.ts
```

The suite uses the pinned official ACP SDK 1.4.0 as an independent client. It creates temporary fixture sessions and real UNIX sockets, reconnects after server restart, spawns both helper subprocesses, and exercises malformed messages, permissions, cancellation, ownership, stale/live endpoints and replacement-safe shutdown. Its deterministic host substitutes model output only; production hosts are injected through `AcpHost` and have their own runtime/storage tests.

`bridge.entry.ts` is a test-only TypeScript entry. Applications bundle `runAcpStdioBridge` and `runAcpMcpBridge` into their own Node-compatible helper entries for shipping. Both accept `--socket ABSOLUTE_PATH` or `--descriptor ABSOLUTE_PATH`. They never print diagnostics to stdout.

The MCP adapter holds up to 64 runs, retaining completed runs until a later start evicts the oldest completed run. Polling uses event-offset cursors, returns at most 200 events per call, and supports waits of at most 25 seconds. Prompt execution has no generic RPC timeout. Each run has an 8 MiB/20,000-event limit; crossing it cancels the turn and reports an explicit error. Required permissions have a separate server timeout (120 seconds by default), and are never automatically approved.

The socket server accepts at most 16 connections, 128 pending requests per peer, 4 MiB frames, and 16 MiB of queued output. Overrides for connection, permission and shutdown limits are explicit server options. UNIX endpoints use a user-owned 0700 directory and 0600 socket. A lifetime lock serializes startup and stale-socket recovery. The published socket is a hard link to an immediately removed staging bind path, so libuv shutdown cannot unlink a replacement at the public path; explicit cleanup checks inode ownership.

Windows uses local named pipes and the operating system's default process-token DACL without `readableAll` or `writableAll`. POSIX permission bits do not enforce Windows pipe ACLs. Windows runtime/ACL behavior is not verified by the macOS test run.
