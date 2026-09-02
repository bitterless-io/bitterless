---
task: onlypreview-global-search-office-preview-092
round: 1
result: PASS
reviewer: independent Codex explorer
date: 2026-08-31
verification: 114 focused non-Electron tests before fixes, 25 focused closure tests after fixes, typecheck:node, directed ESLint, and source review; no Electron/Playwright/E2E
---

# Task 092 independent review 1

## Result

**PASS** after two P2 findings were corrected and independently rechecked. No P0/P1 or residual
finding remains.

## Findings and closure

1. The first pass found that a current Search Office grant could retain its reader/handle after an
   invalid-offset or read-I/O exception if the Renderer disappeared before its best-effort cancel.
   `readOfficeChunk` now atomically clears only the exact active grant, awaits the targeted hidden
   reader cancellation, and then rethrows the original error. Tests cover invalid offset, simulated
   I/O failure, exactly-once cancellation, closed handle, and rejection of later read/open reuse.
2. The first pass found that the core rapid-selection contract was covered mostly below the Store
   boundary. A real Store harness with fake time and deferred client responses now covers A→B→C,
   A→B→A ABA fencing, stale success/error/finally, and query/scope/workspace/exit/shutdown trailing
   cancellation. Existing behavioral Office-session tests cover disposal during pending
   import/load/layout and exactly-once runtime failure cleanup; the thin Search component retains
   direct read-cancel/unmount plus lazy/key integration coverage.

## Verified invariants

- XLSX/XLSM, DOCX, and PPTX upgrade from stable-token `info` authority to metadata-only `office`
  preview; no absolute path or complete package crosses the public preview contract.
- Search owns an independent hidden-preload `FileSearchOfficeReader`; it cannot cancel the main
  Preview Office lane.
- Main performs no filesystem I/O, validates exact identities, and relays at most one ordered
  512KiB frame. The Renderer caps the complete buffer at 25MiB.
- The 120ms fixed-window scheduler is leading plus latest trailing. Revision/request/result fences,
  keyed containers, synchronous Viewer/Worker disposal, and stale settlement guards prevent an old
  document or error from replacing the latest selection.
- Global Search alone receives the required OOXML Worker/WASM CSP beside the existing Preview, is
  included in the build security audit, and retains per-format lazy chunks.

## Evidence

- Backend implementation pass: 16/16 focused tests, `yarn typecheck:node`, directed ESLint, and
  `git diff --check` passed.
- Renderer implementation pass: 34/34 focused tests and the first `yarn build` passed; the build
  emitted independent XLSX/DOCX/PPTX/Office-session/Global-Search chunks.
- Review first pass: 114 focused non-Electron tests passed before the two P2 corrections.
- Review closure: 25/25 focused tests passed after both corrections; the expanded Store/Renderer
  behavior set passed 59/59.
- Directed ESLint reported no errors. Full web typecheck remains blocked by pre-existing
  poker/Home/Connector/Maestro errors outside Task 092; no Task 092 path appeared in that failure.
- Electron, Playwright, packaged smoke, app launch, and E2E were not run. Ral owns live acceptance.
