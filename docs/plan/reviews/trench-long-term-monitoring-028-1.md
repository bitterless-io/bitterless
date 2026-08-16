---
id: trench-long-term-monitoring-028-1
target: current-worktree
---

# Findings

No open P1, P2 or P3 findings.

# Verification evidence

## Contract and boundary matrix

- **Bridge isolation:** PASS. Monitoring is one separately frozen exact-seven preload surface while
  Sniping remains exact fourteen. Main alone maps the six reviewed Core routes, injects the fixed
  BSC / SG-primary / JP-standby topology and legal desired state, and reuses the memory-only
  authenticated session, sender/generation/401, redirect, HTTPS, UTF-8, JSON, 20-second and one-MiB
  relay boundaries. Coin Monitoring source contains no WebSocket, EventSource, GMGN, direct fetch,
  HTTP URL or renderer-owned provider surface.
- **Request and response closure:** PASS. Closed inputs and exact request-to-response binding reject
  unknown routing/configuration fields, malformed IDs/pages/cursors, secrets, JWTs, provider
  references, executable/module paths and endpoint-shaped text. The final normalized free-text
  probe rejected 35 forbidden alias/URL/path cases across list/save and list/detail/anomaly
  projections (175/175) while accepting eight benign Watch labels across the same surfaces (40/40).
- **Identity and lifecycle:** PASS. List page/search identity, first list-to-detail identity,
  current detail refresh and stale-edit reload fail closed on same-revision immutable drift while
  permitting runtime/readiness/latest evidence to evolve. Create/Edit/Start/Stop enforce canonical
  BSC CA, duplicate recovery, exact CAS +1, fresh WARMING revisions and pinned release/schema/
  topology. Available history is current-first, consecutive and exactly the newest `min(revision,
  500)` entries; retained revision desired state, creation time and sample availability cannot be
  rewritten or erased.
- **Samples and charts:** PASS. Initial history is two identity-bound pages of at most 250 rows each;
  page-two failure preserves the first verified page and retries its exact cursor. Later paging is
  descending, duplicate-free, race-fenced and bounded to 8,640 retained rows. Missing buckets break
  both chart series, null remains a gap, zero remains visible, Z threshold lines use the Z scale,
  historical revisions never borrow current identity, and WARMING readiness renders `n / 72`
  separately from the 288-sample detector window.
- **Anomalies and runtime truth:** PASS. Anomalies owns only the exact optional Watch and closed state
  filters, uses tuple-ordered cursors, retains verified rows on scoped failures, retries the failed
  cursor and enforces immutable revision identity across accumulated pages. Rows and drawers retain
  full bounded asset/release/schema/threshold/block/hash/aggregate/SG+JP evidence. Unknown, zero,
  paired, confirmed and unconfirmed remain distinct; only matched HIGH/LOW evidence is confirmed.
  Watches and Anomalies loading/error readiness are independent, and current SG/JP runtime lag,
  heartbeat, error and stale state are not confused with selected historical sample evidence.
- **UI and code review:** PASS. Source contracts cover 398×568 wrapped evidence rows and bounded
  dialogs, mutually exclusive 800×568 list/detail surfaces, and one internal detail scroll at
  800×282. Focus return, visible focus, localized accessible names (including all three custom close
  controls), stable structural/repeated-row names and EN/ZH parity are present. Business flow stays
  in the reactive store/services; the sample drawer emits only local close lifecycle events. No
  task-owned TS/JS/Less/test file exceeds 800 lines, and module-level functions use arrow constants.

## Deterministic gates

- `node tests/coin/run-monitoring-unit.mjs` — **PASS, 76/76**.
- `node --test scripts/coin/trench-monitoring-layout.test.mjs` — **PASS, 7/7**.
- `node tests/coin/run-sniping-unit.mjs` — **PASS, 58/58**.
- `yarn tsc --noEmit -p tests/coin/tsconfig.monitoring-unit.json --composite false` — **PASS**.
- `yarn vue-tsc --noEmit -p tests/coin/tsconfig.trench-renderer.json --composite false` — **PASS**.
- `yarn typecheck:node` and `yarn check:renderer-i18n` — **PASS**.
- Focused ESLint over the Monitoring contract, Main, preload, renderer, locale and test paths —
  **PASS, exit 0 / 0 errors**. It reports 12 Prettier warnings in the shared Trench preload; none is
  a code-review contract violation.
- Scoped `git diff --check`, including no-index checks for untracked task-owned files — **PASS**.
- Develop's final DEBUG_DEV build completed at version code `260813155645`. Verify independently
  confirmed `out/main/app.main.js` (08:18:29), `out/preload/trench.js` (08:18:31) and Coin renderer
  (08:18:45) are newer than their monitored sources; the source-newer-than-artifact scan is empty.
  `node --test tests/omni/trenchOmniEmbedding.test.mjs` — **PASS, 6/6** against those artifacts.

No Electron/browser E2E, screenshot, live Core/provider/database/RPC/HTTP/WS/GMGN/chain call,
DEBUG_PROD, deployment, signing, broadcast or trade was run.

# Resolved during Verify

Develop closed every issue found during the serial review, including latest-bucket omission,
no-evidence confirmation, Anomalies-header phase leakage, Create/detail contamination, list
query/page cache identity, exact sample and anomaly failed-cursor Retry, UTC-neutral formatting,
request and success-projection secret/URL/path boundaries, incomplete-range reverse invariants,
consecutive 500-revision history, mutation-history integrity, anomaly revision identity, complete
sample/anomaly drawers, narrow responsive evidence/modal behavior, stale timestamps, selected-action
isolation, initial-vs-older operation truth and workspace Refresh pending state.

The final targeted recheck also closed all five last-round findings: WARMING now presents `n / 72`;
strict Monitoring TypeScript is green; same-revision immutable identity drift fails closed across
list, detail and reload; repeated anomaly-region diagnostics have a stable name; and modal/drawer
close controls use the active Coin locale.

# Conclusion

**PASS**

Task 028 satisfies the independent Desktop implementation contract with no open P1/P2/P3. Its task
status correctly remains `in-progress` until Ral completes the documented standalone and Omni
runtime, responsive visual and interaction acceptance.
