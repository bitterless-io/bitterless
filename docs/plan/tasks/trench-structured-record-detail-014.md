---
id: trench-structured-record-detail-014
scope: Structured human-readable Trench record details in standalone and Omni
status: done
depends-on: [trench-record-browser-011, trench-omni-embedding-012]
---

# Trench Structured Record Detail

## Objective

Replace raw-JSON-first Trench details with a basic human-readable component hierarchy while
preserving exact canonical document copy, read-only repository semantics, responsive hosting, and
all truthful failure states.

## Context

- `docs/features/coin.md`
- `docs/features/coin-layout.md`
- `docs/issues/trench-raw-json-detail-hard-to-read.md`
- `docs/plan/results/trench-record-browser-011.md`
- `docs/plan/results/trench-omni-embedding-012.md`

## Path

- `src/renderer/coin/src/components/TrenchRecordDetail/`
- `src/renderer/coin/src/components/TrenchStructuredValue/`
- `src/renderer/coin/src/components/TrenchDocumentAction/`
- additional narrowly scoped `Trench*Detail` presentation components under
  `src/renderer/coin/src/components/`
- `src/renderer/coin/src/views/vault/`
- `src/renderer/common/i18n/en.ts`
- `src/renderer/common/i18n/zh.ts`
- `tests/coin/`
- `tests/omni/`

## Acceptance

- CA detail and Index source detail render envelope provenance plus canonical per-chain Token,
  Result, Top Profit Wallet, Index Exposure, and Negative Exposure sections.
- Negative detail renders human explanation, tag provenance, each holdings asset, and structured
  holdings result/evidence while preserving missing/invalid holdings isolation.
- Flexible plain-JSON values render as bounded key/value, list, and lazily expanded nested content;
  large strings/containers do not eagerly create an unbounded DOM.
- Raw JSON is absent from the normal visible preview. Analysis, tag, and holdings retain named exact
  copy actions that write the unmodified repository `document` string.
- Existing record/source selection, live refresh, error states, keyboard focus return, and all
  standalone/Omni responsive bounds remain intact.

## Verification

- Focused unit tests for flexible-value bounds, formatting, exact-copy state, and existing store
  races/refresh behavior.
- Focused renderer and Node typechecks, renderer i18n, ESLint, and `git diff --check`.
- Fresh production build plus standalone Trench Electron E2E covering structured CA/Index/Negative
  values, exact clipboard bytes, live refresh, 1360×860 and 800×600 screenshots.
- Focused Omni Electron E2E covering structured detail reachability at 800×568, 398×568, and 800×282.
- Every Electron run uses the configured target display, isolated DEBUG profile, mock Keychain, and
  zero `safeStorage` access.

## Implementation result

- Added dedicated structured views for CA analysis, Index Wallet detail, and Negative Wallet detail,
  plus a bounded recursive renderer for flexible evidence. The CA view is reused when an Index
  source is opened; raw JSON is no longer mounted in the normal detail.
- Exact canonical analysis, tag, and holdings documents remain in the existing read/store contract
  and are exposed only through named exact-copy actions. Electron acceptance compares the real OS
  clipboard with the repository-returned strings, including their terminal newline.
- Typed arrays render in bounded batches, nested JSON containers disclose lazily, and long strings
  remain collapsed until requested. Missing, empty, and corrupt optional holdings remain distinct.
- Updated the standalone, Omni, and real MCP/skill integration E2E contracts to assert structured
  fields, absence of raw previews, responsive reachability, and exact copy behavior.
- Developer gates passed: unit `16/16`, focused renderer/Node typechecks, i18n, focused ESLint,
  production DEBUG build, standalone Electron `1/1`, Omni Electron `1/1`, and skill integration
  Electron `1/1`. All GUI runs used the configured DELL display, mock Keychain, and zero
  `safeStorage` access. Full evidence is in
  [`../results/trench-structured-record-detail-014.md`](../results/trench-structured-record-detail-014.md).
- Independent Verify found no P1, P2, or P3 finding. The fresh DEBUG build, three focused Electron
  flows, exact clipboard assertions, responsive screenshots, and static accessibility/contract audit
  passed. See
  [`../reviews/trench-structured-record-detail-014-1.md`](../reviews/trench-structured-record-detail-014-1.md).
