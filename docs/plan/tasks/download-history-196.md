---
id: download-history-196
scope: persistent download history + read-only paged download_history tool
status: pending
depends-on: [builtin-wait-197]
---

Paired with `micromeet-cowork` `docs/plan/tasks/download-history-001.md` (Cowork copies the two shared net files from here byte-for-byte).
Bitterless style: semicolons, `for…of` (no `forEach`), static alias imports. Contract changed at 2026-09-24 10:51 (Ral, in person) —
`docs/features/browser-downloads.md` **#6 as rewritten** is the source of truth (boolean `complete`, generic `wait`, full URL).

# Download history + `download_history`

## Objective

Implement `docs/features/browser-downloads.md` **#6** in this repo:

- `APP_DATA_DIRS.downloadHistory = 'download-history'` + purpose in `src/main/paths/appData.ts`; path via `appDataDir('downloadHistory')`.
- New shared module `src/main/net/downloadHistory.ts`: JSONL records (#6.3, boolean `complete`, full URL), start/end writes with
  tmp + rename atomic rewrite, serialized write queue, 1000-record cap by `started_at`, file mode `0600`, startup recovery
  (leftover `ended_at: null` gets the discovery time so it reads as ended-not-complete). Host-agnostic: the directory is injected.
- `src/main/net/downloadManager.ts`: `configureDownloadManager({ downloadDir, historyDir })`; write the record on start and end;
  NOTE lines carry the record `id`; in-flight NOTE hints `wait {ms}` then `download_history {id}`. Stays byte-identical with Cowork's copy.
- Inject `historyDir` at the `configureDownloadManager` call in `src/main/app.main.ts`.
- Read-only tool `download_history` (#6.6: `id` / `complete` / `query` / `page` — 20 per page, newest first, `{items, page, page_size, total, has_more}`; `file_exists`; local ISO times; no wait params)
  in the Maestro tool table + `src/main/agent/hostToolCatalog.ts`.
- `download_history` declares `downloadSettleMs: 0` (the field comes from builtin-wait-197). The generic `wait` tool itself is
  builtin-wait-197 — **not** this task (`docs/features/builtin-wait-tool.md`).

## Context

- `docs/features/browser-downloads.md` (#1.2 current NOTE/ledger, #3.1/#3.6/#3.7 decisions, **#6 contract**)
- overmind `areas/agent-runtime/browser-use/browser-use-tools.html` #2.2 (design rationale, 10:51 decisions)

## Path

- `src/main/paths/appData.ts`
- `src/main/net/downloadHistory.ts` (new), `src/main/net/downloadManager.ts`
- `src/main/app.main.ts`
- `src/main/maestro/windows/main/maestroWindow.controller.ts` (download_history registration only)
- `src/main/agent/hostToolCatalog.ts`
- the existing `check:download-destination` guard (two new assertions, #6.9), download tests (`yarn test:downloads`), appData contract test

## Verification

- Unit tests listed in #6.9.
- `yarn test:downloads`, `yarn check:download-destination`, `yarn typecheck` (pre-existing diagnostics reported separately — changed files must have 0).
- No E2E.
