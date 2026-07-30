---
id: application-diagnostics-010-3
target: 9d16f60a5cbbf8e752ca92edd5aa5a71e9c24653
compared_with: application-diagnostics-010-2
status: passed
---

# Verdict

**PASS. The remaining hash-router P2 is closed, and the two earlier P2 fixes have not regressed.**

# Findings

None.

# Closed Finding

## Review 2 P2 — Hash-router first-party Renderer logs were excluded

Closed.

- `src/main/logging/logPolicy.service.ts` no longer rejects a first-party Renderer solely because
  its current URL contains a hash route.
- Entry matching still uses the exact pathname. HTTP development entries must still match the
  configured first-party origin; packaged file entries must still reside under `/out/renderer/`.
- URLs containing a query, username, or password remain rejected.
- `scripts/diagnostics/applicationDiagnostics.test.ts` now covers both development and packaged
  first-party URLs containing `#/…`, while retaining remote-origin and query rejection coverage.

# Regression Check

- Modern Pi browser OAuth remains observed through the real Undici diagnostics channels with
  idempotent start/stop and without reading request body or request/response headers.
- Token-exchange lifecycle output remains stage-specific and sanitized.
- Main and first-party Renderer messages still pass through the global electron-log sanitizer
  before the UTC NDJSON file transport.
- The real file-pipeline test still verifies fixed fields, Main/Renderer metadata, scope, 5 MB
  rotation, nested-error redaction, URL/proxy redaction, and object-payload redaction.

# Verification

- `yarn test:application-diagnostics` — pass, 10/10 tests.
- Read-only source and diff review of `0dba7ad..9d16f60`.
- No app, build, package, or publish command was run.
