# Trench Raw JSON Detail Is Hard To Read

Status: Fixed

Implementation:
[trench-structured-record-detail-014](../plan/tasks/trench-structured-record-detail-014.md)

## Symptom

The Trench record list is usable, but selecting a CA or Negative Wallet primarily opens its
canonical JSON file. The document is exact and useful for machine verification, yet it makes a
person repeatedly parse schema keys, nested chain blocks, wallet arrays, exposure objects, and
holdings by eye.

## Required behavior

- The normal detail preview is a structured evidence document, not a raw JSON viewer.
- CA analysis is split into envelope provenance and per-chain Token, Result, Top Profit Wallet,
  Index Exposure, and Negative Exposure components.
- Index source CA opens the same structured CA detail.
- Negative Wallet is split into human explanation, tag provenance, holdings assets, and holdings
  result/evidence.
- Flexible result/evidence values remain readable through a bounded generic key/value, list, and
  disclosure renderer; no valid field is silently discarded because it lacks a product-specific
  component.
- Exact canonical JSON remains available through a compact copy action and retains byte/hash E2E
  proof, but is not shown as the primary preview.
- Existing loading, invalid, missing, refresh, responsive, standalone, and Omni behavior remains.

## Acceptance

- A two-chain CA visibly renders two independent chain sections and the expected token, verdict,
  top wallet, Index exposure, and Negative exposure values without opening raw JSON.
- Negative detail visibly renders the human explanation and every holdings asset; missing or invalid
  holdings remains truthful and isolated.
- Nested object/array/long-string evidence can be expanded in bounded increments with keyboard
  access and no body-level overflow.
- Exact-copy actions for analysis, tag, and holdings still place the repository-returned document on
  the clipboard and report success/failure.
- Standalone 1360×860 and 800×600 plus Omni 800×568, 398×568, and 800×282 remain usable with mock
  Keychain and target-display routing.

## Verification

Independent Verify passed with no P1, P2, or P3 finding. CA, Index-source, and Negative details use
structured components; exact analysis/tag/holdings document copy remains byte-for-byte; bounded
flexible evidence and every required standalone/Omni size passed fresh DEBUG Electron acceptance on
the configured DELL display with mock Keychain and no `safeStorage` access.
