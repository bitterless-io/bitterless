# OnlyPreview Dual Preview Region 024 — Independent Review 2

Status: **BLOCKED**

Date: 2026-08-20

## Verdict

Review 1's four implementation blockers are closed. The delayed document-issuance race is fenced
and exactly revoked, the persistent Vue view remains detached through a capability-bound reset
acknowledgement, only `.md` enters the Markdown adapter, and the retired character-count transition
channels are absent. The new behavior tests and the full non-E2E OnlyPreview suite pass.

Task 024 is still not ready to close because the governing format design and the task Path ledger
remain internally false. Both open P2 findings below are blocking under the docs-sprint contract.

## Findings

### P2 · blocking

1. **The format design's delivery ledger still describes superseded topology and PDF ownership as
   current.**

   - Paths: `docs/design/onlypreview-format-coverage.md:204-210,323-331`;
     `docs/plan/tasks/onlypreview-find-in-file-019.md:1-31`;
     `docs/plan/tasks/onlypreview-preview-guards-023.md:1-17`
   - Evidence: the format design says a signature mismatch prevents bytes reaching "播放器与
     pdf.js", although task 024 removed the active Vue/pdf.js PDF route and Chromium now consumes
     the bounded PDF asset. Its delivery footer still says task 019 is based on the old single
     Preview renderer and "必须先重写", but the current 019 task already specifies a Shell-owned
     Find Bar, Main-owned revisions, `chromePreviewView`/`vuePreviewView`, and the Region dependency.
     The same footer labels 023 as the preceding PDF-limit task even though 023 now depends on 024
     and explicitly treats the 100 MiB Chromium PDF boundary as introduced by 024.
   - Impact: the top-level G1/G2/G3/G5/G7 and #7/#7.2/#7.3/#7.5 status labels are now truthful, but
     readers reaching the format delivery handoff are told to redo work that is already rewritten
     and are given the retired PDF engine/ownership. This leaves review-1 finding 5 only partially
     closed.
   - Required correction: name Chromium's built-in PDF viewer instead of pdf.js; record 024's PDF
     limit/dual-surface foundation as complete; state that 019 is **already rewritten but remains
     pending implementation**; and describe 023 only as the remaining text/non-text guard work.

2. **Task 024's Path is complete for the previously omitted files, but it still includes two
   untouched planned paths without saying they were reused unchanged.**

   - Path: `docs/plan/tasks/onlypreview-dual-preview-region-024.md:56-112`, specifically lines 73
     and 78
   - Evidence: `src/renderer/onlypreview/common/onlyPreviewI18n.ts` and
     `src/renderer/onlypreview/shell/src/onlyPreviewShell.type.ts` have no working-tree diff, while
     every actual review-1 omission (both designs, `docs/INDEX.md`, classifier, workspace registry,
     env preload/type, and `MarkdownPreview.vue`) is now listed. `git diff --quiet` returns clean for
     both untouched files.
   - Impact: the ledger still cannot distinguish task-owned changes from existing dependencies.
     Review 1 explicitly required removing or annotating planned paths that were not changed; adding
     the missing paths alone does not close that requirement.
   - Required correction: remove the two unchanged files from `# Path`, or move them to an explicit
     "reused unchanged" note outside the changed-file ledger.

## Review-1 closure matrix

| Review-1 blocker | Result | Independent evidence |
|---|---|---|
| Delayed HTML document issue can overwrite a new selection | **CLOSED** | Region rechecks exact runtime/revision immediately after `issue()` and revokes that exact late document revision; deferred issue regression passes |
| Persistent Vue view reattaches before reset | **CLOSED** | Main clears the acknowledged revision on every transition and refuses attach until exact token/revision reset; Vue clears state, crosses `nextTick()`, then acknowledges; first bounds, Vue→Vue, file→empty, stale ack, Chrome/Vue crash, runtime-token rotation, and ack-before-ready behavior pass source and behavior review |
| `.mdx` incorrectly routes to Markdown | **CLOSED** | Region and surface select Markdown only for exact `.md`; `.mdx` and `.markdown` fall through to Monaco; negative contract coverage passes |
| Retired character-count revision channels remain exported | **CLOSED** | repository search finds the retired names only in the negative test and the design deletion record; shared types export neither event |
| Design status contradicts 024 implementation | **PARTIAL / BLOCKING** | preview design and top format status are corrected, but the format delivery handoff still contains the stale statements in finding 1 |
| Task Path omits actual 024 files | **PARTIAL / BLOCKING** | all former omissions are present, but two unchanged planned files remain unannotated in the changed-file ledger |

## Independent verification

| Check | Result |
|---|---|
| `node --test tests/onlypreview/onlyPreviewPreviewRegion.test.mjs tests/onlypreview/onlyPreviewDocumentProtocol.test.mjs` | PASS — 25/25 |
| `node --test tests/onlypreview/*.test.mjs` | PASS — 187/187 |
| `yarn typecheck:node` | PASS |
| `yarn check:renderer-i18n` | PASS |
| focused ESLint on Region, handler, shared contract/types, Vue store/surface, and focused tests | PASS |
| `yarn test:application-diagnostics` | PASS — 12/12 |
| `node scripts/environment/runWithRuntimeProfile.cjs debug_dev -- yarn electron-vite build` | PASS |
| `git diff --check` plus task-file whitespace check | PASS |

The strict `--noCheck false` TypeScript command was not repeated in review 2; both independent
review-1 attempts exhausted 4 GiB and 8 GiB heaps without emitting a diagnostic. `typecheck:web`
was also not repeated because review 1 isolated its failures to the existing non-OnlyPreview
baseline. Electron/Playwright E2E, the real app, and packaged smoke testing were not run, per Ral's
instruction.

## Conclusion

**BLOCKED.** The implementation fixes are accepted. Correct the two small but contract-significant
documentation ledgers, then request review 3; no implementation change or E2E run is required for
these remaining findings.
