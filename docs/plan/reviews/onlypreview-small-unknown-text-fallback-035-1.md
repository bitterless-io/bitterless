# onlypreview-small-unknown-text-fallback-035 — Review 1

- Date: 2026-08-26
- Result: **BLOCKED**
- Scope: independent review of task 035 against the current dirty worktree, including Main Preview
  classification/reading, hidden-preload Search classification/reading, adapter precedence, explicit
  unsupported and sensitive-file policy, opened-file identity/race handling, focused tests, and the
  task-owned feature/design truth sources. Unrelated dirty-worktree changes were preserved and
  excluded.
- Method: task/design/source/diff inspection, focused plus supplemental traversal/SQLite Node tests,
  Node typecheck, line/function audit, and whole-worktree whitespace check.
- E2E/live app: intentionally not run. Build, Electron, Playwright/E2E, the real application, and
  packaged smoke were excluded by the assigned verification contract.

## Findings

### 1. P2 · blocking — canonical feature/design docs still publish the superseded unknown-file contract

- Required contract: `docs/plan/tasks/onlypreview-small-unknown-text-fallback-035.md:38-48` makes
  known specialized adapters authoritative and routes every remaining regular file to inert
  plaintext, with exact 8MiB Preview / 1MiB Search limits and no header sniff.
- Implemented behavior: `src/main/onlypreview/onlyPreviewClassifier.service.ts:202-220` preserves the
  known and explicit-unsupported branches, then returns `text`; lines 371-388 select Monaco for the
  fallback. `src/preload/onlypreview/search/core/classification.mjs:98-138` preserves metadata-only
  known formats and defaults the remainder to `text`.
- Contradictory feature truth: `docs/features/onlypreview.md:567-579` limits the text row to explicit
  extensions/basenames and says other unknown formats are unsupported; lines 590-593 say reads use
  8MiB + 1 and unknown files remain unsupported.
- Contradictory design truth: `docs/design/onlypreview-format-coverage.md:334-339` says unknown suffix
  → unsupported and `limit + 1`; lines 387-390 repeat both rules; lines 402-406 still require a
  `.zip` file not to enter the text adapter. The implementation and focused tests deliberately do
  the opposite for a small `.zip`.
- Impact: these are the current feature and format contract documents named by task 035, not merely
  historical task prose. A future implementation/review following them would revert the requested
  behavior or reintroduce an overread that this task explicitly removes. The feature documentation
  also reports incorrect user-visible Preview behavior today.
- Required correction: update both documents so specialized/explicit-unsupported extensions win
  first, every remaining regular file uses plaintext, Search retains only title metadata above
  1MiB, Preview rejects above 8MiB, exact-limit reads request no byte beyond the limit, and small
  binary/ZIP fallback may produce inert replacement characters without sniffing or execution.

No P1 production-code defect or device-freeze regression was found.

## Production contract audit

| Requirement | Evidence | Result |
|---|---|---|
| Known adapters win case-insensitively | Main checks explicit text, PDF, image, audio, video, XLSX/XLSM, DOCX, and Draw.io sets before fallback; Search mirrors known non-text categories. Upper-case adapter coverage passes. | pass |
| Explicit unsupported formats remain metadata-only | Main retains HEIC/HEIF/TIF/TIFF/RAW, MKV/AVI/WMV/FLV, and old `.doc`; Search keeps the same families plus Office/Draw.io metadata-only. No decoder/body read is issued. | pass |
| Unknown, extensionless, backup, and compound names use plaintext | Main fallback produces `kind: text`, `text/plain`, `language: plaintext`, then routes to Monaco. Search fallback produces `mediaType: text`. Coverage includes `extensionless`, `.bak`, `AGENTS.md.bak`, arbitrary unknown, and `.zip`. | pass |
| Preview 8MiB boundary is size-first and exact | Descriptor admission rejects `file.size > 8MiB` before body I/O. `readText()` requests at most `byteLimit`, then revalidates the opened identity. Exact 8MiB succeeds; 8MiB + 1 rejects without reading. | pass |
| Search 1MiB boundary is size-first and exact | `readClassifiedSearchContent()` rejects invalid/negative/greater-than-1MiB sizes before body I/O and calls the bounded reader with exactly 1MiB. The instrumented test proves the highest requested offset is exactly 1MiB; 1MiB + 1 performs zero reads. | pass |
| No byte sniff or execution for fallback | Unknown files bypass signature sampling and decode tolerantly as UTF-8/BOM UTF-16. The bytes are never imported, compiled, interpreted, or sent through HTML/Markdown adapters. ZIP/NUL/malformed UTF coverage returns inert text/replacement characters. | pass |
| Sensitive Search bodies remain excluded | `.env.production` remains title metadata with `contentIndexed: false` and zero body bytes. The unchanged sensitive patterns still cover `.env*`, `.npmrc`, `.netrc`, `.pem`, and `.key`. | pass |
| Identity/race behavior remains fail-closed | Main revalidates the exact opened file after the bounded read. Search compares dev/inode/size/mtime on the handle and traversal performs the existing canonical-path/current-stat fence; growth/replacement tests discard stale body while retaining current filename metadata. | pass |
| Memory and responsiveness stay bounded | Preview holds one current read capped at 8MiB; Search reads files serially in 64KiB chunks capped at 1MiB, yields through the existing background slicer, commits bounded batches, and retains no whole-project body collection in renderer memory. Broader eligibility can increase bounded index work/disk, but introduces no unbounded per-file allocation or synchronous renderer/Main I/O. | pass |

## Code Review 报告

- Rules: `TS-1`, `TS-2`. No task-scoped Vue SFC or backend implementation was authored, so `FE-*`
  and `BE-*` do not apply.

### 文件清单

| # | File / responsibility | Findings |
|---|---|---:|
| 1 | `src/main/onlypreview/onlyPreviewClassifier.service.ts` | 0 |
| 2 | `src/preload/onlypreview/search/core/classification.mjs` | 0 |
| 3 | Task-focused Preview/Search tests | 0 |
| 4 | `docs/features/onlypreview.md` | 1 |
| 5 | `docs/design/onlypreview-format-coverage.md` | 1 (same contract blocker) |

### 问题清单

The two documentation entries above are one P2 contract-truth finding. Every reviewed authored
TS/JS/test file is below 800 lines, and the task-scoped implementation adds no replaceable
`function` declaration or expression.

## Verification

| Command / audit | Result |
|---|---|
| Task-listed focused Node tests | **PASS, 40/40** |
| Supplemental `onlyPreviewSearchEngine.traversal/sqlite` Node tests | **PASS, 14/14** |
| `yarn typecheck:node` | **PASS** |
| `git diff --check` | **PASS** |
| Task-scoped line-count / `function` audit | **PASS:** all reviewed files < 800 lines; `TS-2` clean |
| `yarn build` | Not run; explicitly excluded from this independent review |
| Electron / Playwright / E2E / real app / packaged smoke | Not run, as required |

## Conclusion

**BLOCKED — the production implementation is bounded, race-fenced, non-executing, and passes all
54 reviewed tests, but task 035 cannot close while its canonical feature and format documents still
state the opposite unknown-file and read-bound behavior.**

