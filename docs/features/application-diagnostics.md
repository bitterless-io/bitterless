# Application Logging and Diagnostics

Status: Accepted

## Purpose

Bitterless persists one chronological application log and exposes the live runtime paths and
configuration status in Settings. A packaged failure must remain diagnosable after stdout and
stderr disappear, while debug production and debug test runs must never share user data or logs.

The diagnostics surface is read-only except for keyed `Open` actions. It never returns arbitrary
environment values, credentials, tokens, authorization URLs, or database content to Renderer.

## Runtime Profiles

Main resolves the profile from the compile-time `VITE_MODE` and `VITE_ENV` pair before any
application-owned path is read:

| `VITE_MODE` | `VITE_ENV` | Profile          | App/userData name       |
| ----------- | ---------- | ---------------- | ----------------------- |
| `release`   | `prod`     | production       | `Bitterless`            |
| `debug`     | `prod`     | production debug | `Bitterless_DEBUG_PROD` |
| `debug`     | `dev`      | test debug       | `Bitterless_DEBUG_DEV`  |
| `release`   | `dev`      | test release     | `Bitterless_DEV`        |

On macOS the corresponding user data root is
`~/Library/Application Support/<App/userData name>`. Windows uses Electron's `appData` root.
E2E may replace the resolved userData path only through its existing explicit isolated override.

## Persistent Logging

Main initializes `electron-log` before normal startup:

```text
Main console.* ────────────────┐
uncaught / unhandled rejection ├─► one profile-tagged main.log
first-party renderer console.* ┘
```

Main is the only file writer. First-party Renderer console messages are classified by their exact
entry (`renderer:home`, `renderer:translator`, `renderer:omniControl`, and so on) and recorded with
`world=page`; Main records use `proc=main` and `world=main`.

The file is UTC NDJSON, one JSON object per line:

```json
{
  "ts": "2026-07-30T06:12:03.123Z",
  "level": "info",
  "profile": "production-debug",
  "proc": "renderer:translator",
  "world": "page",
  "scope": "codex",
  "msg": "token exchange started",
  "args": []
}
```

Every record contains `ts`, `level`, `profile`, `proc`, `world`, `scope`, `msg`, and `args`.
The first `[tag]` in a message becomes `scope`. Data passes through the global sanitizer before
serialization, so URL query/hash values, OAuth/secret/proxy credentials, error cause chains, and
raw objects cannot enter the file. `main.log` rotates at 5 MB through electron-log's file
transport.

Log locations:

| Runtime               | Log file                                                        |
| --------------------- | --------------------------------------------------------------- |
| packaged production   | Electron OS log root, e.g. `~/Library/Logs/Bitterless/main.log` |
| packaged test release | Electron OS log root under `Bitterless_DEV`                     |
| production debug      | `<appData>/Bitterless_DEBUG_PROD/logs/main.log`                 |
| test debug            | `<appData>/Bitterless_DEBUG_DEV/logs/main.log`                  |

Only first-party renderer URLs are captured. Omni remote pages and other third-party web contents
are excluded. Existing `console.*` calls keep working. Codex login logs lifecycle stages and
sanitized error names/messages, but never query strings, authorization codes, access tokens,
refresh tokens, or credential values.

## Diagnostics Contract

Renderer calls a Main-owned XPC handler:

```text
Settings / Log
  └─ DiagnosticsHandler
       ├─ getSnapshot() ─► profile + log + startup + directories + env status
       └─ openDirectory({ key }) ─► allowlisted directory only
```

The snapshot includes:

- profile name, `VITE_ENV`, `VITE_MODE`, packaging state, application version, and version code;
- resolved log file and directory;
- current startup diagnostic issues;
- Electron paths (`app`, `userData`, `sessionData`, `logs`, `cache`, `crashDumps`, `temp`,
  `home`, `documents`, and `downloads`);
- Bitterless paths (`db`, `skills`, `plugins`, `rigchat`, `cowork`, Codex auth directory,
  `coin`, `todoist-sync`, `eyes-on-agents`, `mcp`, `bin`, and generated artifacts);
- a fixed allowlist of relevant environment keys with `configured` / `not configured` status.

Only `VITE_ENV`, `VITE_MODE`, the resolved profile, platform, architecture, and safe endpoint
origins may expose a value. Proxy, credential, E2E, signing, and service-secret variables expose
presence only.

## Settings Layout

`Log` is a top-level Settings item immediately above `About`.

```text
┌──────── Settings ────────┬──────────────────────────────────────────────────┐
│ Proxy                    │ LOG · production debug · ready                   │
│ General                  │                                                  │
│ Model                    │ main.log                                         │
│ System Prompt            │ /…/Bitterless_DEBUG_PROD/logs/main.log   [Open] │
│ Log                 ◀    │                                                  │
│ About                    │ Application directories                          │
│                          │ ● App data       /…/Bitterless_DEBUG_PROD [Open] │
│                          │ ○ Artifacts      /…/artifacts     not created     │
│                          │                                                  │
│                          │ Environment                                      │
│                          │ VITE_ENV    configured   prod                    │
│                          │ HTTPS_PROXY configured   value hidden            │
└──────────────────────────┴──────────────────────────────────────────────────┘
```

The content is a compact diagnostic ledger: status dots carry existence/configuration state,
paths use selectable monospace text, and every `Open` action targets a Main-defined directory key.
The main log action calls Main-owned `shell.showItemInFolder(logFile)` so Finder or Explorer
highlights the active file; directory rows continue to use keyed directory-open actions.
Loading shows an Arco spinner; load/open failures show an actionable inline error and keep the
last valid snapshot visible. The page scrolls inside the existing Settings content region.

## Entry Points

- `src/main/logging/`
- `src/main/environment/`
- `src/main/diagnostics/`
- `src/main/xpc/diagnostics.handler.ts`
- `src/shared/diagnostics/`
- `src/renderer/home/src/views/setting/components/LogSetting/`
