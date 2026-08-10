---
id: onlypreview-search-scope-watch-013-1
status: pass
reviewed_task: onlypreview-search-scope-watch-013
target: working-tree-2026-08-10
base: cf9ca882649f17dd34b3dc4089ccf88ca2be2670
date: 2026-08-10
review_type: independent-static-pure-node-and-product-benchmark-no-electron-runtime
---

# Verdict

**PASS — implementation complete; owner runtime verification pending.** No open P1 or P2 finding
remains in the scoped search, visible-tree filtering, selected-preview watch route, or canonical
product benchmark evidence. This verdict does not claim Electron, XPC, renderer commit, packaged
startup, E2E, or build execution.

# Implemented Contract

- Project Search carries a strict project/directory scope, defaults to the captured current
  directory, returns files only, and fences scope changes through the 120ms leading/trailing,
  IME-safe, one-active/one-latest query path.
- Ordinary filtering snapshots pre-query visible rows, matches exact `entry.name`, retains visible
  context ancestors, and does not inspect collapsed descendants or mutate expansion.
- SQLite schema v7 persists project eligibility and applies scope pruning to title, FTS, literal,
  CJK, and long-query strategies. Text snippets retain the exact grapheme/highlight contract;
  non-text title matches remain summary-free.
- Worker traversal publishes direct children before descendants. Hidden-tree visibility, global
  project eligibility, explicit hidden-directory scope, hard excludes, result-cap truncation,
  recovery, reconciliation, cancellation, and stale generation behavior have focused pure tests.
- The committed 400ms trailing watch route is Content preload → PreviewHeader path/revision gate →
  existing reload control → PreviewContent generation/read. Main owns no search/watch I/O.

# Canonical Product Evidence

Artifact:
`areas/agent/runtime/human/preview/product-benchmark/results/PRODUCT-P00-2026-08-09T17-14-11.034Z-289c3f0152b8.json`

SHA-256: `289c3f0152b838512a7123acb2fd8ae3e9ad981a9125897a194c79fb976c00cd`

| Measure | Canonical result |
|---|---:|
| Recording / trend / performance eligibility | true / true / true |
| Stop | false — first current-product point |
| First build | 66,214.878ms |
| Fresh Worker reopen | 48.637ms; filesystem cache uncontrolled/likely warm |
| Reconcile | 12,033.667ms |
| Runtime peak | 852,492,288 bytes; below 1GiB advisory and 2GiB ceiling |
| SQLite peak / final | 691,402,296 / 642,551,808 bytes |
| Warm first-result p95 | all query families and scopes below 100ms |
| Warm complete p95 over 100ms | In Project CJK unigram 230.848ms; CJK bigram 214.035ms; combining text 114.643ms |
| Cancellation | 0.292ms to terminal; no late batch |
| Synthetic watch | commit 442.041ms; verify 489.881ms; `full=false`; `changedPathCount=1` |

The dynamic benchmark boundary is fresh child process → production Worker client → TypeScript
Worker → engine/result batcher → coordinator. Historical task-012/prototype rows, including the
roughly 1.412GB prototype disk result, are not used as current-product proof.

# Verification

| Check | Result |
|---|---|
| Focused independent search review | PASS — 66/66 |
| `node --test tests/onlypreview/*.test.mjs` | 120/121 — only unrelated stale Omni source-regex baseline failed |
| `yarn typecheck:node` | PASS |
| `yarn typecheck:web` comparison | Existing unrelated repository diagnostics; 0 OnlyPreview diagnostics |
| `yarn check:renderer-i18n` | PASS |
| Focused ESLint | PASS |
| Scoped `git diff --check` | PASS |
| Canonical PRODUCT-P00 artifact/hash/eligibility gates | PASS |

# Runtime Boundary

This implementation review did not launch Electron, Playwright, E2E, the full Bitterless
application, a build, Keychain, or Ops. `PRODUCT-P00` does not dynamically measure the Electron
preload/XPC hop, Shell's 120ms scheduling, PreviewHeader's selected-path/revision decision,
PreviewContent's renderer commit, or packaged startup. Ral retains final runtime acceptance for
those boundaries.
