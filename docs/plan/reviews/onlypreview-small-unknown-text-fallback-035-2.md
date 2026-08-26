# onlypreview-small-unknown-text-fallback-035 — Review 2

- Date: 2026-08-26
- Result: **PASS**
- Scope: independent re-review of Review 1's documentation-truth blocker and the current-worktree
  task 035 boundary. Unrelated dirty-worktree changes were preserved and excluded.
- Method: task/prior-review/current feature and design truth/source inspection, stale-contract search,
  focused Preview/Search guard tests, and whitespace check. Review 1's broader 54-test and Node
  typecheck evidence was reused because the remediation changed documentation only.
- E2E/live app: intentionally not run. Build, Electron, Playwright/E2E, the real application, and
  packaged smoke remain excluded by the assigned verification contract.

## Findings

No P0, P1, P2, or P3 finding remains.

## Review 1 blocker closure

### Canonical feature truth: closed

- `docs/features/onlypreview.md:567-579` now states that known specialized and explicit-unsupported
  routes win and every remaining regular file uses Monaco with a known language or `plaintext`;
  recognized unsupported media and legacy `.doc` remain explicit.
- Lines 590-597 now state the exact behavior implemented by task 035: size metadata rejects above
  8MiB before I/O, an admitted read requests at most exactly 8MiB, identity/size/mtime is revalidated,
  and unknown/extensionless/backup/compound/`.zip` names use inert plaintext without byte sniffing,
  execution, or promotion to HTML/Markdown.

### Canonical format design truth: closed

- `docs/design/onlypreview-format-coverage.md:332-339` replaces the former unknown-unsupported and
  `limit + 1` statements with specialized/explicit-unsupported-first fallback and exact-`limit`
  bounded reading.
- Lines 362-375 preserve the distinct 8MiB Preview and 1MiB Global Search boundaries and explicitly
  document a `.zip` file kept under its own suffix as inert plaintext/garbage rather than unsupported.
- Lines 388-408 freeze no-head-sniff classification, exact-limit plus post-read identity fencing,
  `AGENTS.md.bak`, `.zip`, malformed-byte tolerance, and non-execution as the current regression
  contract.
- The only remaining `limit + 1` reference is at lines 507-518 inside the explicitly labelled
  `#rejected` historical ZIP/strict-decoding proposal. It cannot be mistaken for the current
  contract and is correctly retained as decision history.

The task, feature truth, format design, Global Search design, analysis ledger, implementation, and
tests now agree on the same routing and byte-bound behavior.

## Production contract re-audit

The source paths audited in Review 1 remain unchanged in substance:

- Main checks known adapters and explicit unsupported sets before its final `text` fallback, assigns
  `plaintext` when no known language exists, enforces 8MiB from verified metadata, reads at most the
  exact limit, and revalidates the opened file.
- Search keeps known non-text/unsupported families metadata-only, defaults the remainder to text,
  excludes sensitive bodies, rejects above 1MiB before reading, reads at most exactly 1MiB, and
  discards a body after identity change.
- Unknown content remains inert tolerant text; no new import, compile, HTML/Markdown render,
  signature sniff, or synchronous renderer/Main file I/O path exists.
- Per-file memory remains bounded to 8MiB Preview / 1MiB Search with the existing serial background
  traversal and bounded SQLite batching. No new device-freeze path was introduced.

## Verification

| Command / evidence | Result |
|---|---|
| Re-review focused `onlyPreviewPreviewGuards` tests | **PASS, 9/9** |
| Review 1 task-listed focused tests | **PASS, 40/40** |
| Review 1 supplemental traversal/SQLite tests | **PASS, 14/14** |
| Review 1 `yarn typecheck:node` | **PASS** |
| Current documentation stale-contract search | **PASS:** current sections clean; one historical `limit + 1` remains only under `#rejected` |
| `git diff --check` for corrected truth docs/reviews | **PASS** |
| `yarn build` | Not run; explicitly excluded from this independent review |
| Electron / Playwright / E2E / real app / packaged smoke | Not run, as required |

## Conclusion

**PASS — Review 1's documentation-truth blocker is fully closed.**

Task 035's code, tests, feature truth, and format design now consistently preserve known adapters,
default every remaining small regular file to non-executing plaintext, enforce zero-overread 8MiB /
1MiB gates, and retain sensitive, explicit-unsupported, identity, and bounded-resource protections.

