---
id: application-diagnostics-010-2
target: f8b026e42d06158961f5bed357fb720bc124ce07
compared_with: application-diagnostics-010-1
status: blocked
---

# Verdict

**FAIL. The two findings from review 1 are closed, but one new blocking P2 prevents delivery.**

# Closed Findings

## Review 1 P2 — Modern Codex callback and token-exchange stages were not observable

Closed.

- `src/main/codex/codexTokenExchangeObserver.service.ts` observes the real Undici
  `request:create`, `request:headers`, and `request:error` diagnostics channels around
  `POST https://auth.openai.com/oauth/token`.
- It correlates events by request object identity and reads only method, origin, path, response
  status, and the error object. It never reads request/response headers or request body, and no URL
  query value is emitted.
- `start()` and `stop()` are idempotent and clear request tracking on stop.
- `src/main/codex/codexCredential.service.ts` starts the observer before the modern Pi login,
  records callback acceptance, token-exchange start/response/failure, and stops it in `finally`.
- The focused test publishes through the real diagnostics channels, uses throwing body/header
  getters, verifies start/stop idempotency, and checks sanitized failure output.

## Review 1 P2 — Raw global console and error capture could persist secrets

Closed.

- `src/main/logging/log.setup.ts` installs `sanitizeApplicationLogMessage` as a global
  electron-log hook before console replacement and error catching.
- The sanitizer handles Main console/errors and manually forwarded first-party Renderer messages
  before the file transport serializes them.
- The focused test writes Main, Renderer, nested Error, proxy URL, OAuth URL, and object payload
  cases through a real electron-log file transport and verifies that their secrets do not appear.

# Finding

## P2 blocking — Hash-router first-party Renderer logs are excluded

Design contract:

- `docs/features/application-diagnostics.md` requires first-party Renderer console messages to be
  persisted by the single Main writer with an entry-specific `proc` and `world=page`.
- The reference contract specifically includes Renderer `proc` / `world` classification.

Implementation evidence:

- `src/main/logging/log.setup.ts:46-60` resolves the current `webContents.getURL()` for every
  Renderer console message and drops the message when the resolver returns `null`.
- `src/main/logging/logPolicy.service.ts:43-50` returns `null` whenever `url.hash` is present.
- `src/renderer/home/src/router/index.ts:1-7` uses `createWebHashHistory()`. The home Renderer,
  including Settings, therefore has a normal current URL such as `.../home/index.html#/...` after
  router initialization.
- `src/renderer/maestro/workbench/src/workbench.router.ts:1-27` also uses
  `createWebHashHistory()`, so its normal routed URL is excluded in the same way.
- `scripts/diagnostics/applicationDiagnostics.test.ts:72-109` tests entry classification only
  with URLs that have no hash. It does not cover a real hash-router URL.

Impact: normal runtime console messages from the main home/Settings Renderer and Maestro
Workbench never reach the Main file pipeline after their hash routers initialize. The log may have
correct NDJSON fields and redaction, but it does not provide the required first-party Renderer
coverage or the promised `proc` / `world` evidence for these top-level entries.

# Reference Contract Verification

- UTC NDJSON: every serialized record contains `ts`, `level`, `profile`, `proc`, `world`, `scope`,
  `msg`, and `args`; `ts` uses `Date.toISOString()`. With no tag or explicit scope, `scope` remains
  present as an empty string.
- Main writer: application file logging is owned by `src/main/logging/log.setup.ts`; Renderer
  messages are forwarded into that Main logger.
- Renderer metadata: entry-specific `proc` and `world=page` are implemented, but the blocking
  hash-router filter prevents coverage for home and Maestro Workbench.
- Scope: the first `[tag]` is extracted as `scope` and removed from `msg`.
- Rotation: electron-log file `maxSize` is exactly `5 * 1024 * 1024`.
- File reveal: the dedicated Main action calls `shell.showItemInFolder(log.file)`; directory rows
  retain keyed allowlisted `shell.openPath` behavior.
- Documentation: the feature, issue, and task documents describe the NDJSON schema, single Main
  writer, Renderer metadata, 5 MB rotation, and log-file reveal action.

# Verification

- `yarn test:application-diagnostics` — 10/10 pass, but the hash-router URL gap above is not
  covered.
- Read-only source and diff review of `8849d6a..f8b026e`.
- `git diff --check 8849d6a..f8b026e` — pass.
- No app, build, package, or publish command was run.
