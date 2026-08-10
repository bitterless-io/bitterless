---
id: onlypreview-search-performance-acceptance-014
scope: Close the remaining OnlyPreview search latency and acceptance-contract gaps
status: done
depends-on: [onlypreview-search-scope-watch-013]
---

# Objective

Bring every canonical Project Search family below the strict 100ms warm complete-result p95 target
without changing result order, snippets, scope, cancellation, truncation, or watch behavior. Preserve
the exact PRODUCT-P00 search implementation as an immutable control, record the optimized product
path with a same-attempt control/candidate comparison, and align the dormant Electron E2E and
Settings acceptance surfaces with the delivered three-view runtime.

# Context

- `docs/features/onlypreview.md`
- `docs/plan/analysis/onlypreview.md`
- `docs/plan/tasks/onlypreview-search-scope-watch-013.md`
- private Overmind `areas/agent/runtime/human/preview/search-design.md`
- private Overmind `areas/agent/runtime/human/preview/search-performance-history.md`

# Delivery

1. Freeze PRODUCT-P00's exact search sources, product config, dependency manifests, YAML parser,
   static integration sources, and benchmark sources into an immutable `wx` capsule with a SHA-256
   sidecar. Verify the canonical P00 receipt and reconstructed product source hash before using it.
2. Replace the repeated full-chunk grapheme scan with a verified direct-literal fast path that falls
   back to the existing projector for every normalization-ambiguous case.
3. Extend the existing short-query postings to normalized one- or two-codepoint queries containing
   non-ASCII text. Keep exact literal verification, projection, scope predicates, title enrichment,
   cancellation, stable ordering, and exact `truncated` semantics unchanged.
4. Record the optimized product path only through a same-corpus contemporaneous control/candidate
   comparison. Historical P00 remains valid absolute evidence but is not a same-corpus causal
   control after Bitterless source and documentation changes.
5. Update the dormant Electron E2E contract from two views to Shell + 43px PreviewHeader +
   PreviewContent. Require distinct `webContents.id` values; OS renderer PIDs are diagnostic because
   Chromium may reuse a renderer process.
6. Remove the inert `showHiddenFiles` control and mutation action from Settings while preserving the
   serialized field, decoder, default, and carry-through save behavior for backward compatibility.

# Acceptance

- Every result row, snippet highlight, result order, scope, batch, cancellation, and truncation
  fixture remains byte-for-byte equivalent between control and candidate.
- Every canonical query family's warm complete-result p95 is strictly below 100ms. A family at or
  above 100ms keeps `stop=false`; first-result latency alone cannot satisfy the target.
- Runtime memory above 1GiB is advisory. Runtime memory strictly above 2GiB prevents automatic stop
  but does not invalidate a methodologically sound measurement. SQLite disk remains separate.
- The three-view E2E contract asserts exact Header/Content geometry, `sandbox: true` for every visible
  view, a Content preload with no search token/Worker/Node authority, and UtilityProcess-only search
  I/O behind the bounded Main relay. The Settings source contains no hidden-files control or setter.
- Focused pure Node tests, Node typecheck, renderer i18n, focused lint, line-count, and diff checks
  pass. Later current-product evidence also records `yarn build` PASS and
  `yarn test:e2e:onlypreview` PASS (7/7).

# Delivery Evidence And Remaining Packaged Gate

- Canonical same-attempt A-B-B-A PRODUCT-P01:
  [`PRODUCT-P01-2026-08-09T18-34-18.181Z-2ceb96275090.json`](../../../../../areas/agent/runtime/human/preview/product-benchmark/results/PRODUCT-P01-2026-08-09T18-34-18.181Z-2ceb96275090.json),
  SHA-256 `2ceb962750900c5fc588b895b592f68abb53d2cb8cbae7c6b498ecc7fcddbb6b`.
- `recordingEligible=true`, `trendEligible=true`, semantic equality 24/24,
  `directTargetPassed=true`, and `stop=true`. Candidate worst complete-result warm p95 is 82.523ms;
  worst result-bearing first-result p95 is 25.636ms.
- In Project pooled complete p95 changed by 229.355→14.337ms for CJK unigram,
  217.210→13.784ms for CJK bigram, and 109.963→5.061ms for combining text. Candidate runtime max
  is 873,267,200 bytes (<1GiB); disk max is 703,982,720 bytes and remains a separate capacity signal.
- Cancellation/latest and control/candidate watch gates pass. The direct stop does not claim a
  cross-epoch plateau.
- PRODUCT-P00/P01 retain their historical measurement boundary: fresh child → production Worker
  client → TypeScript Worker → engine/result batcher → coordinator. The current Electron product
  runtime instead uses a raw-`parentPort` UtilityProcess supervised by Main; Main privately enriches
  initialization, bounds requests, rejects pending work on exit, and relays only validated host-bound
  events through `xpcMain.broadcast`. All visible views are sandboxed and Content preload carries no
  search token, Worker, or Node authority.
- `yarn build` PASS. `yarn test:e2e:onlypreview` PASS (7/7), covering the three-view security graph,
  exact 43px geometry, DevTools, media, Settings, Project Search scopes, filename plus highlighted
  summaries, CJK, hidden/config excludes, and a final 400ms watch commit that rerenders the selected
  file exactly once and a non-selected file zero times.
- Packaged release build/startup remains untested; the successful unpackaged build/E2E evidence does
  not claim that boundary.
