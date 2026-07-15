# External Integrations

## Purpose and boundary

This scope owns Bitterless integrations with external desktop applications and local developer
tools. It defines discovery, launch, lifecycle observation, persistence, and trust boundaries at
the Bitterless edge.

It does not own the external provider's model execution, authentication, transcript format,
permission UI, or conversation history. Provider-private files and undocumented application IPC
are not integration contracts.

```text
Bitterless renderer
       |
       v
main-process integration service
       |
       +---- documented URL / CLI / RPC contract ---- external application
       |
       +---- local-only lifecycle bridge <----------- provider hook/helper
```

## Ownership

| Concern | Owner |
|---|---|
| Provider-neutral records and status vocabulary | integration service |
| URL validation and process launch allowlist | main process |
| Provider discovery and event normalization | provider adapter |
| Persistent session references | dedicated SQLite repository |
| Integration setup, trust, and removal | explicit user action in Bitterless |
| Authentication, transcripts, and model execution | external provider |

## Modules

- [Coding-agent sessions](coding-agent-sessions.md) - Codex and Claude session discovery, opening,
  and status observation.

## Scope-wide constraints

- Use documented provider interfaces first; locally verified behavior is never promoted to a
  stable contract without an explicit compatibility fallback.
- Never parse provider transcript JSONL or private SQLite files for live state.
- All renderer-to-main calls use `electron-xpc` and each handler method accepts at most one
  parameter object.
- URL schemes, executable names, command arguments, and local bridge endpoints are allowlisted in
  the main process. The renderer cannot submit an arbitrary URL or command.
- Missing, stale, or contradictory provider evidence resolves to `unknown`, never to `idle` or
  `completed`.
