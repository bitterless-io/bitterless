---
id: onlypreview-xlsx-compatibility-repair-088-1
target: working-tree-2026-08-31-after-73316b0
compared_with: onlypreview-xlsx-compatibility-repair-088
---

# Verdict

**PASS. No blocking P1 or P2 finding.** Task 088 now generates deterministic valid benchmark XLSX
packages and repairs the reported single-empty-sheet producer form before the one final
`@silurus/ooxml/xlsx` Viewer load, without adding Main-process content I/O or weakening ordinary
Office admission.

# Findings

## P1 — blocking

None.

## P2 — blocking

None.

The review initially rejected four boundaries, all repaired before this verdict:

- ZIP fixture timestamps now use canonical raw DOS time/date fields and produce the same hash in
  UTC, Asia/Shanghai, and America/Los_Angeles.
- The trusted descriptor extension is carried through the renderer store into the Office Session;
  only exact `.xlsx` may enter normalization, so `.xlsm` stays out even if package ContentType text
  is entity-encoded or malformed.
- Office preflight and compatibility Worker response error codes use runtime allowlists; malformed
  codes become the current format's typed parse failure.
- The new `sheetData` scanner is exercised across the 64 KiB streaming boundary with a namespace
  prefix, comment/CDATA decoys, and a prefixed duplicate failure.

# Requirements evidence

| Requirement                        | Evidence                                                                                                                                                                                                                                                                                                       | Result |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Valid deterministic benchmark XLSX | The corpus constructs one six-part OOXML buffer, canonicalizes every local/central ZIP timestamp, reuses the buffer for all `.xlsx` entries, and bumps the signature revision to 4. ExcelJS, Office preflight, and `@silurus/ooxml/node` open it.                                                              | pass   |
| Narrow compatibility trigger       | Preflight streams worksheet XML and records worksheet/`sheetData` counts. Session requires trusted source extension `.xlsx`, one worksheet, one missing `sheetData`, no detected macro ContentType, at most 4 MiB compressed and 8 MiB inflated. Multi-sheet, duplicate, XLSM, or oversized cases fail closed. | pass   |
| Bounded Worker lifecycle           | The renderer Worker receives one transferred path-free `ArrayBuffer`, dynamically loads ExcelJS only on the exceptional path, caps output at 4 MiB, has a non-renewing 10-second deadline, validates response identity/error codes, and terminates on success, failure, timeout, disposal, or replacement.     | pass   |
| Single final Viewer and Find       | Normalized bytes pass the complete Office preflight again. Recursion is forbidden, and only then is one `XlsxViewer` constructed and loaded. Existing model-backed `findText`/next/previous/highlight behavior remains the active Office adapter.                                                              | pass   |
| Main I/O boundary                  | The existing hidden-preload Office read is unchanged. Main receives no new path, file buffer, parser, filesystem call, or compatibility operation. The original workbook is never written.                                                                                                                     | pass   |
| Failure and stale fencing          | Unknown Worker/preflight messages map to typed failures; timeouts, disposal, late identities, normalization failure, second-preflight incompatibility, and final Viewer failure cannot publish ready state or start another normalization.                                                                     | pass   |

# Verification

| Check                                        | Result                                                                                                                                                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Final OnlyPreview focused suites             | PASS, 68/68                                                                                                                                                                                |
| Indexing regression suite                    | PASS, 7/7                                                                                                                                                                                  |
| Task-targeted ESLint and Prettier            | PASS                                                                                                                                                                                       |
| `yarn typecheck:node`                        | PASS                                                                                                                                                                                       |
| `git diff --check`                           | PASS                                                                                                                                                                                       |
| `yarn build`                                 | PASS; compatibility Worker 2,057 B and ExcelJS 1,446,082 B in a separate lazy chunk                                                                                                        |
| `yarn typecheck:web`                         | Baseline-blocked by 71 existing GTO/Home/Connector/Control/path-helper errors; no Task 088, OnlyPreview, or indexing path appears                                                          |
| Reported reimbursement workbook              | PASS through production compatibility Worker: 17,931 B / 16,233 B inflated, `sheetData` 0 → 1, normalized output 6,093 B, second preflight accepted, `@silurus/ooxml/node` opened `Sheet1` |
| Electron / Playwright / packaged smoke / E2E | Not run — explicitly reserved for Ral                                                                                                                                                      |

# Conclusion

**Approved — PASS.** The reported real workbook is covered by a tightly bounded pre-Viewer
compatibility path, final rendering and search remain OOXML-owned, and the benchmark no longer
manufactures invalid XLSX files. Ral retains live visual acceptance in the Electron app.

The old revision-3 cache path under `10d146bb9edf61bc` intentionally remains an invalid generated
fixture and is not mutated or deleted. Revision 4 creates a new valid corpus; the old absolute path
must not be used as evidence for the new generator.
