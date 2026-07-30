# Packaged Failures Have No Persistent Application Log

Status: In progress

Implementation:
[application-diagnostics-010](../plan/tasks/application-diagnostics-010.md)

## Symptom

Translator can complete the browser-side Codex OAuth callback and still show
`Codex login did not complete.` Bitterless currently provides no persistent Main log that explains
whether credential promotion, token verification, or provider-state persistence failed.

The packaged app sends stdout and stderr to `/dev/null`. Existing debug output is available only in
the terminal that launched Electron. No application `main.log` exists under the OS logs directory
or userData.

## Root cause

- Bitterless has no logging transport; Main and Renderer use transient `console.*` only.
- The Codex credential boundary converts internal failures to a safe generic UI error without
  recording the underlying sanitized failure and lifecycle stage.
- Both `debug_prod` and `debug_dev` currently inherit the package name `Bitterless_DEBUG`, so
  runtime paths cannot accurately identify or isolate the target environment.

## Required behavior

- Persist Main, uncaught, rejection, and first-party Renderer logs through `electron-log`.
- Use Main as the single file writer and emit sanitized UTC NDJSON with `ts`, `level`, `profile`,
  `proc`, `world`, `scope`, `msg`, and `args`; rotate `main.log` at 5 MB.
- Give production, production-debug, test-debug, and test-release explicit runtime profiles and
  separate userData/log directories.
- Record sanitized Codex login lifecycle stages and errors without secrets or OAuth query values.
- Add Settings → Log immediately above About, based on Micromeet Cowork Workbench.
- Show the live log path, startup status, application directories, and allowlisted environment
  variable status; highlight the active log file through a dedicated Main action and expose only
  keyed directory-open actions for the directory list.

## Acceptance

- A packaged app writes `main.log` even when stdout/stderr point to `/dev/null`.
- Each line is valid UTC NDJSON, first-party Renderer entries have distinct `proc` values, and the
  file transport rotates at 5 MB.
- `debug_prod` resolves to `Bitterless_DEBUG_PROD`; `debug_dev` resolves to
  `Bitterless_DEBUG_DEV`.
- A failed Codex login leaves a stage-specific sanitized error in `main.log`.
- Settings → Log displays the exact active log path and the actual current profile.
- The main log button highlights `main.log`; directory rows still open only Main-allowlisted keys.
- No token, credential, authorization query, raw proxy value, or arbitrary environment value
  crosses XPC or enters diagnostic logs.
