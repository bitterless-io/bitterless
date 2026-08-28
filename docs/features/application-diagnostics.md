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

Packaging is part of the profile contract. Every unpackaged GUI launch must compile and run with
`VITE_MODE=debug`; every packaged application must compile with `VITE_MODE=release`. `VITE_ENV`
continues to choose the test or production backend and does not grant release behavior to an
unpackaged process. Main validates this boundary in its first runtime-profile bootstrap, before any
application-owned path, logging, SQLite, Keychain, or window operation. Supported CLI/build scripts
select and canonicalize the profile explicitly, and E2E child environments also carry
`VITE_MODE=debug`; stale release output fails closed instead of opening as a local/E2E app.

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

Codex proxy setup uses the `codex-proxy` scope. A successful setup may expose only the fixed source,
`http`/`https` scheme, loopback host class, and port. A failure may expose only a fixed stage and
sanitized error name/message. Raw proxy URLs, credentials, headers, response bodies, and arbitrary
configuration values are forbidden.

Translator additionally owns a separate Main-written `translator/translator.log`. It uses the same
profile isolation, UTC NDJSON formatting, sanitizer, and 5 MB rotation policy as `main.log`, but
contains only translation execution lifecycle and sanitized translation failures. Shared Codex
status and login/logout lifecycle never enters this dedicated file. For debug profiles the file is
under `<userData>/logs/translator/translator.log`; packaged profiles place the `translator/`
directory below Electron's profile log root. Translator lifecycle fields use fixed short stage and
phase values so application opaque-token redaction cannot erase them. A failed translation may add
only the accepted provider-diagnostic fields documented by the Translator feature contract; raw
errors, request/response payloads, headers, identifiers, and authentication material remain
forbidden.

OnlyPreview startup and search timing uses the existing `main.log`, not a dedicated file. Every
record begins with `[onlypreview-search]`, producing `scope=onlypreview-search`; `proc` distinguishes
Main, the hidden `renderer:fileSearch`, and `renderer:onlypreviewShell`. Fixed events cover Preview
window/runtime readiness, SQLite reuse/open, count/candidate/reconcile/promotion, search gates,
first Files/Contents visibility, terminal response, XPC duration, and Shell acceptance. Events are
small aggregate strings and never contain queries, snippets, bodies, names, paths, workspace or
configuration identity, credentials/capabilities/tokens, or raw error objects.

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
