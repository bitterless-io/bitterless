# Trench Logging

Status: discussion; no implementation has been approved.

Trench needs a module-owned diagnostic stream that explains data-path readiness, workspace-state
persistence, market-data operations, and AI analysis without mixing those events into the global
application chronology alone. This document records the diagnosed failures and the proposed logging
contract. It does not authorize code or storage-path changes.

## #0 Goals

| Goal | Status | Acceptance signal |
| --- | --- | --- |
| Explain the two current errors from concrete runtime evidence | Confirmed | Each message maps to a distinct prerequisite or code failure |
| Give Trench a predictable, profile-isolated log directory | Pending approval | One canonical path works in development and packaged builds |
| Preserve event chronology while making failures machine-readable | Pending approval | One bounded NDJSON stream uses stable event codes and categories |
| Keep credentials, strategies, prompts, and provider payloads out of logs | Pending approval | Only allowlisted metadata reaches the writer |

## #1 Current Diagnosis

### Discovery data path

`Discovery is unavailable for the selected data path` is a readiness guard, not an application
crash. Trench keeps the selected mode strict and deliberately does not switch to another source.

- `service` mode is unavailable until a Meme service endpoint is configured.
- `local_cli_rpc` mode is unavailable until GMGN CLI is installed, `GMGN_API_KEY` is configured,
  and no `GMGN_PRIVATE_KEY` is present in the read-only process environment.
- The owner must prepare the selected source or explicitly select a different configured source.
  The application must never fall back silently.

### Workspace state save

`Could not save the trench workspace state` is an implementation defect. The renderer wraps the
workspace state in Vue `reactive`, then passes that Proxy directly to `structuredClone` before the
state IPC call. Chromium rejects the Proxy with `DOMException` / `DataCloneError`.

Runtime evidence from the production application log:

```json
{"level":"error","proc":"renderer:coin","scope":"Coin","msg":"State save failed: [object DOMException]"}
```

No `coin-state.json` was created in the inspected application profiles, which is consistent with the
failure occurring before Main receives the save request. Restarting, reselecting the mode, or
deleting local state cannot repair this code path. The future fix must build a plain, schema-owned
snapshot before cloning and sending it to Main.

## #2 Proposed Directory

Decision status: pending owner approval; not implemented.

Canonical module log root:

```text
<applicationLogDirectory>/
├── main.log
└── trench/
    ├── trench.log
    ├── trench.1.log
    ├── trench.2.log
    └── trench.3.log
```

`<applicationLogDirectory>` is the directory already selected by the application logging policy.
For packaged production on macOS the proposed file is
`~/Library/Logs/Bitterless/trench/trench.log`. Debug profiles remain isolated under their own
`<userData>/logs/trench/trench.log`; Windows uses the corresponding per-user application log
directory.

The recommendation is one chronological `trench.log`, encoded as one JSON object per line, rather
than separate state/source/AI files. A `category` field provides filtering without making one user
operation span several files. Main is the sole file writer.

The existing workspace state at `<userData>/coin/coin-state.json` stays unchanged in this logging
phase. Renaming or migrating persisted state into the Trench root is a separate compatibility
decision.

### Retention

- Rotate each file at 5 MiB.
- Keep the active file plus three archives, for a hard size bound of about 20 MiB.
- Remove archives older than 14 days at application startup.
- Use owner-only filesystem permissions where the platform supports them.

## #3 Event Contract

Decision status: pending owner approval; not implemented.

Every event uses a stable envelope:

```json
{
  "ts": "2026-08-03T08:55:53.328Z",
  "level": "error",
  "profile": "production",
  "module": "trench",
  "origin": "renderer",
  "category": "state",
  "event": "workspace.save.failed",
  "operationId": "01...",
  "code": "STATE_PROXY_NOT_CLONEABLE",
  "context": {
    "revision": 0,
    "durationMs": 2
  }
}
```

Allowed categories are `lifecycle`, `state`, `source`, `market`, and `ai`. `context` is parsed through
an allowlist schema; it may contain mode, source, chain, revision, byte count, duration, readiness
status, and bounded result counts.

The log must not contain API keys, private keys, authorization headers, full endpoint query strings,
raw provider responses, wallet holdings, natural-language strategies, prompts, or AI output. Errors
are normalized to a stable code plus safe name/message; raw Error objects are not serialized.

### Logging policy

- Record state load/save/recovery start, success, and failure.
- Record source readiness only when its status or unmet prerequisite changes.
- Record discovery, market-data, and AI operation start, completion, cancellation, and failure with
  duration and bounded counts.
- Do not log every successful polling tick. Log session start/stop, status transitions, throttling,
  and aggregated failure summaries.
- Keep the existing global `main.log` as the app-wide chronology; high-value Trench events may appear
  in both streams with the same `operationId`.

## #4 Diagnostics Access

Decision status: pending owner approval; not implemented.

Settings > Log should expose the resolved Trench log path and a Reveal action beside the existing
global log. User-facing Trench errors should include the stable event code so the corresponding log
line can be found without exposing implementation details in the main UI.

## #pending-questions

| ID | Blocking | Recommendation | Alternative | Decision | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- |
| PQ-1 | Yes | Approve `<applicationLogDirectory>/trench/trench.log`, one NDJSON chronology, 5 MiB x 4 files, 14-day cleanup | Split logs by category | Pending | Ral | Open |
| PQ-2 | No | Keep `<userData>/coin/coin-state.json` unchanged in this phase | Migrate state into `<userData>/trench/state/` now | Pending | Ral | Deferred |

## Implementation Boundary

After approval, implementation is expected to touch only the Trench logger, typed event boundary,
diagnostics path exposure, workspace-state plain snapshot fix, and focused documentation. It must not
change trading behavior, data-source fallback semantics, or credential storage.
