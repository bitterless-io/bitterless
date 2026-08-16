# Trench Long-term Monitoring result

## Outcome

Trench now has a fourth first-level `Monitoring` module with `Watches` and `Anomalies`. Ral can
create one canonical BSC CA watch, edit it while stopped, Start/Stop with revision CAS, inspect up to
500 recent finalized five-minute Transfer-event samples, page older evidence, select immutable
revision history, and review the sanitized anomaly ledger. The v1 chain/observer topology is fixed
to BSC with primary SG and standby JP; renderer inputs never own the chain, regions, desired state,
route, URL, header, token or provider reference.

Implementation status: **implemented; independent Desktop review and owner acceptance pending**.
Task 028 intentionally remains `in-progress`. No Electron/browser E2E, screenshots, live Core/
provider/GMGN/chain/database calls, DEBUG_PROD operation, deployment, signing, broadcast or trade
was performed.

## Implementation

- Added a separate frozen `window.monitoring` exact-seven bridge: list/get/save/start/stop,
  listSamples and listAnomalies. Main maps only fixed reviewed routes, injects SG/JP and the exact
  lifecycle desired state, and reuses the existing memory-only session, sender, generation, stale
  401, abort, HTTPS, redirect, UTF-8, JSON, 20-second and one-MiB relay guards. Sniping remains its
  exact fourteen methods and no Coin renderer receives customer/session credentials.
- Added closed prototype-safe request/response validation, sanitized error issue paths and exact
  request↔response binding. Asset identity is BSC `eip155:56`, lifecycle results must advance CAS by
  exactly one into a fresh WARMING revision, mutation identity cannot drift, and forged regions,
  cursors, releases, schema, provider material or private payloads fail closed. Every projection
  pins the reviewed SG-primary/JP-standby topology and immutable v1 schema hash.
- Matched Private's canonical fixed-decimal domain (18 integer digits, 12 fraction digits, no
  exponent, negative zero or noncanonical trailing zero), Int32 Transfer counts and maximum 500
  available revisions. Recursive sample agreement validation keeps zero numeric, distinguishes
  warming/flat/incomplete states, and exposes aggregate facts only for an exact SG+JP match.
- Added server-paged Watches master-detail with search, duplicate recovery, disabled-only editing,
  Start/Stop, retained stale facts and independently scoped errors. Header Refresh stays pending
  through list/detail work without treating a partial sample page as whole-module failure.
- Added two cursor-fenced 250-row requests for the initial latest 500 series so a valid response
  remains under the shared one-MiB guard. A second-page failure retains and labels the verified first
  250 and Retry resumes at that exact cursor; every further page must strictly advance, stay within
  8,640 retained rows, preserve config/revision/release identity and never mask duplicates.
- Added pure presentation models plus accessible chart and textual evidence. Count and Z lines have
  independent null gaps, missing bucket sequences break both lines, threshold lines share the actual
  Z scale, and historical revisions use their own asset, threshold, release and schema. With no
  historical sample those identities remain Unknown. Watch rows expose desired and SG/JP observed
  state; region cards separate current runtime/error from selected-revision sample evidence and mark
  retained metrics stale when the current runtime is degraded or offline.
- Every series row opens a keyboard-reachable sanitized evidence drawer with its exact revision,
  asset, release/schema/detector identity, threshold, agreement, bucket/block/hash, aggregate facts
  and SG/JP fingerprints. UTC evidence uses locale-neutral calendar dates and times.
- Added the cursor-ordered Anomalies workspace with exact closed state filters, sanitized drawer,
  null/zero/paired/confirmed truth, bounded aggregate baseline/release/regional diagnostics and
  focus return. Anomaly rows and watch-filter options have separate latest-intent/loading/error
  scopes; failed older pages retry the exact cursor and retained evidence carries a scoped stale
  timestamp.
- Added selected-target detail recovery: a failed cross-watch request keeps prior verified data only
  as a private cache, never displays it as the requested watch, and offers a scoped Retry for the
  exact failed target.
- Extended the single Arco navigation owner and global header, preserved lazy module initialization,
  and added stable `name` attributes, keyboard/focus states, EN/ZH copy and responsive reachability
  for 398×568, 800×568 and 800×282. Task-owned TS/JS/Less stays within 800 lines.

## Verification checkpoint

- PASS — `node tests/coin/run-monitoring-unit.mjs`: `76/76`, including exact-seven/fourteen
  boundaries, request/response integrity, 250/500 size fencing, sample/anomaly cursor progress,
  immutable topology/schema, historical identity, missing-bucket/chart gaps and scales, runtime
  stale/error truth, 8,640 retention, bounded row/anomaly evidence, cross-watch detail recovery,
  exact list retry/query cache identity, full Create/Edit/Start/Stop lifecycle, immutable revision
  overlap, CAS reload/races, scoped retained-evidence recovery and Create isolation. The fresh
  runner exited naturally with no residual process.
- PASS — `node scripts/coin/trench-monitoring-layout.test.mjs`: `7/7`, covering Arco
  navigation, stable names, responsive contracts, i18n, header scope and sub-800-line limits.
- PASS — strict Monitoring TypeScript, focused Coin renderer `vue-tsc`, focused ESLint,
  `yarn check:renderer-i18n`, Sniping `58/58` regression tests and scoped `git diff --check`.
- PASS — fresh DEBUG_DEV `yarn build` rebuilt Main, preloads, Coin and Omni renderer targets at
  version code `260813155645`; `node --test tests/omni/trenchOmniEmbedding.test.mjs` passed `6/6`
  against the fresh artifacts, including the Monitoring source-freshness set.
- NOT RUN — Electron/browser E2E, screenshots, live services, database/chain calls, DEBUG_PROD,
  deployment, signing, broadcast or trade, per Ral's instruction.

## Acceptance boundary

Independent Desktop code review must have no open P1/P2/P3 before Develop can be considered stable.
Ral then owns standalone and Omni rendered runtime, responsive visual and interaction acceptance;
only that manual acceptance can move task 028 from `in-progress` to done.
