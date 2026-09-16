# Workflow cleanup and history retention

Status: implemented; targeted code verification passed; owner runtime acceptance pending.

## Problem

A workflow could report stopped while descendants remained alive. Stopping before a worker acquired its PID could still dispatch its start message and cache an unretryable failure. Engine snapshots replaced tool history. Root chat Stop could release the turn before resource cleanup was confirmed.

## Implemented behavior

- Each disposable worker registers all native asynchronous spawn/execFile/exec/fork processes. On macOS/POSIX, independent groups remain owned until confirmed gone, including after a parent exits.
- Supervisor fences initial dispatch synchronously when stopping, handles a late PID, drains late ownership messages, and allows cleanup retry after failure.
- Root Stop requires a positive IPC acknowledgement after workflow and root cancellation complete; errors retain the turn and enable retry. Normal replies cannot finish a stopping turn.
- Application quit/update stops workflows before destroying windows, SQLite or bridges. Cleanup failure keeps the app open and the shutdown operation retryable.
- Task bar remains above the existing response status bar. Stopping errors allow retry, including a run that has not yet created an Agent row. Work logs survive terminal snapshots, with stable ordering, deduplication and a 40-entry cap.

## Verification and owner acceptance

Run the workflow Node suites, relevant chat concurrency tests, module/UI type checks, i18n validation and electron-vite build. No product Electron/E2E or live model calls are part of this code verification.

Manual: run mini-demo; run an external TS; inspect logs after completion; single-stop a long-running Agent while its sibling continues; stop all and root Stop; repeat after stopping; confirm the Task bar/status bar order and bounded scrolling; exercise the five built-ins.

Windows tree cleanup fails closed when taskkill cannot confirm descendants after a parent has exited. Windows/Linux and signed-package behavior require platform testing; macOS Node process tests do not establish cross-platform support.
