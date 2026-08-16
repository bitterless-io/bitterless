---
id: trench-long-term-monitoring-028
scope: fourth first-level Long-term Monitoring navigation, fixed authenticated bridge, watch master-detail, charts and anomaly ledger
status: in-progress
depends-on:
  - trench-sniping-workbench-026
  - bitterless-private/sniping-monitoring-products-010
---

# Trench Long-term Monitoring

## Objective

Add Long-term Monitoring as Trench's fourth first-level module. Let Ral create one chain-qualified CA
watch, Start/Stop it, inspect finalized Transfer-event samples and Z-score readiness, and review a
cursor-paged anomaly/gap ledger without exposing provider or credential surfaces to Electron.

## Context

- [`../../features/trench-long-term-monitoring-layout.md`](../../features/trench-long-term-monitoring-layout.md)
- [`../analysis/trench-long-term-monitoring-analysis.md`](../analysis/trench-long-term-monitoring-analysis.md)
- [`../../features/trench-navigation-layout.md`](../../features/trench-navigation-layout.md)
- Bitterless Private `docs/features/long-term-monitoring.md`
- Bitterless Private `docs/plan/tasks/sniping-monitoring-products-010.md`

## Contract

1. Extend the single Arco module-navigation owner with fourth module `Monitoring`, scopes `Watches`
   and `Anomalies`. Preserve INDEX, Trenchers and Sniping state and lazy initialization.
2. Add a fixed typed Main/preload bridge for only the reviewed long-term monitor endpoints. Reuse the
   memory-only Sniping customer session and sender/generation/401/size/redirect guards; never accept
   a URL, header, token, provider reference, SQL, component/module path or arbitrary request.
3. Watches is server-paged master-detail. Create/save/Start/Stop use exact chain-qualified CA and
   current-revision CAS. The v1 form fixes chain to BSC and regions to SG+JP, accepts canonical CA,
   optional label and threshold, and exposes no provider reference. Duplicate CA preserves the draft
   and offers Open existing; unsupported chains fail visibly; editing is disabled while Monitoring.
   Every Start/Stop creates a revision: Stop retains history, while each Start begins `WARMING 0 / 72`
   and states that prior revisions cannot qualify the new baseline.
4. Render only server-computed finalized evidence. `WARMING`, `BASELINE_FLAT`, `INCOMPLETE_RANGE`,
   `REGION_MISMATCH`, Unknown and zero remain distinct. The client never recomputes Z-score or fills
   a missing bucket with zero. Only `MATCHED` server pairs may present HIGH/LOW as confirmed;
   `SINGLE_REGION` and `REGION_MISMATCH` suppress aggregate count/Z and remain unconfirmed.
5. Chart raw Transfer-event count and Z-score from the latest 500 bounded series rows (at most about
   41h40m) with cursor-driven Load older, not a fabricated 30-day projection. Every loaded point has
   equivalent textual evidence. Every visible label states this is ERC-20 Transfer activity, not
   price, swaps, buyers, volume, profit or trade execution.
6. Anomalies uses the backend cursor and sanitized detail projection. Its closed filters are optional
   owned `config_id` (`All watches` when omitted) and optional exact `states`; BSC is fixed and there
   is no renderer search. Preserve verified rows on transient errors, fence stale responses and keep
   Watches/Anomalies errors independently scoped.
7. Meet the layout's keyboard, stable-name, i18n, 398×568, 800×568 and 800×282 reachability
   contracts. Below 920px list and detail are mutually visible surfaces with a working Back action;
   the short viewport uses one internal detail scroll rather than fixed document height.

## Path

- `src/shared/monitoring/`
- `src/main/monitoring/`
- `src/preload/trench/trench.preload.ts`
- `src/renderer/coin/src/views/monitoring/`
- `src/renderer/coin/src/components/LongTermMonitoringWorkspace/`
- existing Trench app/header/navigation/i18n and focused tests
- this task, result, README and feature documents

## Verification

- Pure request/response validation tests cover exact methods, secrets/URL rejection, asset identity,
  sample/anomaly bounds, zero/incomplete and region-fingerprint states.
- Store tests cover create/read/update/Stop/Start lifecycle, CAS, latest-intent races, paged series,
  cursor reset, exact anomaly filters, regional truth precedence, stale retention and independent
  error scopes.
- Component tests cover Monitoring-disabled Edit, duplicate recovery, list/detail Back, accessible
  textual Z evidence, Load older/end states, drawer focus return and stable `name` attributes.
- Static/type/i18n/line-limit/Omni source and fresh DEBUG_DEV build pass.
- Do not run Electron/browser E2E, screenshots, live Core/provider/GMGN, database writes, deployment,
  trade or DEBUG_PROD. Ral performs runtime and visual acceptance.

## Exit criteria

The module is implemented and independently reviewed with no open P1/P2/P3. Final task status stays
`in-progress` until Ral confirms standalone and Omni runtime behavior.

## Develop checkpoint — 2026-08-14

- Implemented the separate exact-seven Monitoring bridge and reused the existing memory-only
  Sniping session, relay and sender/generation/401/size/redirect boundaries without changing the
  exact-fourteen Sniping surface.
- Implemented Monitoring → Watches/Anomalies, exact BSC/SG+JP form ownership, revision-CAS
  lifecycle, latest-intent fences, two bounded 250-row sample pages, strict cursors, independently
  scoped list/detail/sample/anomaly/filter-option errors, responsive Arco UI and paired EN/ZH text.
- Selected historical revisions render only their own sample asset, threshold, release and schema.
  Current observer runtime and selected-revision regional evidence are explicitly separated; an
  empty historical revision remains Unknown rather than borrowing current facts.
- Pinned every Desktop projection to the fixed SG-primary/JP-standby topology and immutable v1
  schema; added desired/observed runtime truth, bounded failure reasons, stale verified-evidence
  labeling, full sanitized anomaly evidence and exact-target detail Retry without cache masquerade.
- Private task 010's bounded 500-revision and canonical fixed-decimal follow-up passed independently;
  Desktop enforces the same 500 and 18-integer/12-fraction no-exponent projection bounds.
- Audit closure added exact list query/page retry identity, create-dialog error isolation, a strict
  8,640-sample retention ceiling, consecutive newest-500 revision history, normalized free-text
  secret/URL/path rejection, explicit no-evidence/paired/confirmed/unconfirmed truth and per-row
  sanitized evidence.
- Fresh focused verification passes `76/76` Monitoring unit tests, `58/58` Sniping regression tests,
  `7/7` static/layout checks, strict types, i18n and focused ESLint. DEBUG_DEV and the fresh Omni
  artifact gate pass; no E2E, screenshots, live services or DEBUG_PROD were run.
- Result: [`../results/trench-long-term-monitoring-028.md`](../results/trench-long-term-monitoring-028.md).
  Task remains `in-progress` for independent Desktop review and Ral's manual runtime/visual checks.
