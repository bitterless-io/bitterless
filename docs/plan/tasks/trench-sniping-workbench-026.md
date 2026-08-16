---
id: trench-sniping-workbench-026
scope: BL Trench monitor and read-only simulation product/configuration/activity UI
status: in-progress
depends-on: [trench-trenchers-ui-024]
---

# Trench Sniping workbench

## Objective

Add Sniping as the third first-level Arco module and implement the clear product catalog, configured
product list/detail, generated form plus Advanced JSON, monitor readiness, canonical exact/shadow
simulation, and sanitized cross-product Activity ledger. Canary, financial Armed state, signing and
broadcast remain visibly locked until task 027 and the separately verified execution backend exist.

## Context

- [`../../features/trench-sniping-layout.md`](../../features/trench-sniping-layout.md)
- [`../../features/trench-navigation-layout.md`](../../features/trench-navigation-layout.md)
- Bitterless Private `docs/features/sniping.md`
- Bitterless Private `docs/features/sniping-flap-quote-product.md`
- Bitterless Private `docs/features/sniping-product-parity.md`

Keep `dev/current`, preserve dirty work, and do not touch DEBUG_PROD. The task cannot enter Develop
until `trench-trenchers-ui-024` is done and Bitterless Private tasks 001, 012 and 013 are independently
verified, including `/sniping/activity/list`. Per Ral, do not run Electron/browser E2E; owner visual
acceptance is the handoff gate.

## Path

- Sniping/navigation layout docs and task/result/README docs for 026
- `src/renderer/coin/src/App.*`
- Trench module navigation integration
- new Sniping views/components/stores/types/styles
- typed Main authenticated relay, narrow preload/IPC contracts, and sanitized error mapping
- common i18n English/Chinese
- focused renderer/unit/static/Omni source checks only

## Contract

1. Extend the single Arco two-level navigation with Sniping → Products/Activity. Do not add a second
   module or chain navigation owner.
2. Render only generic catalog/schema/config/runtime/activity projections. Component releases appear
   without a component-specific Core endpoint or hand-coded form; structured form and Advanced JSON
   share one canonical draft.
3. Implement the monitor/evidence rail, readiness booleans, revision CAS, read-only Validate,
   disabled draft Save, Start/Stop monitoring, canonical exact-request and shadow-cohort reports,
   stable reason codes, and responsive list/detail behavior exactly as the layout specifies.
   Monitor-only backend `desired_state=armed` must be projected as `Monitoring`, never as financial
   `Armed`. Canary/financial Armed stages stay server-disabled explanatory locks with no command.
   Renderer receives only narrow Start/Stop monitoring methods; editing/saving is disabled while
   Monitoring and requires an explicit Stop plus refreshed revision first.
4. Each Flap configuration binds exactly one quote token. SPCX and GME monitoring/simulation are
   rendered as separate instances with separate revisions/limits/evidence; no mixed-token allowlist
   or UI-only stage advancement exists.
5. Twitter CA remains visibly unavailable and non-armable while the backend exposes no callable
   Twitter event source. Social/profile metadata never changes that state.
6. The Coin/Trench renderer never receives or stores customer JWTs, private keys, mnemonics,
   API/RPC values, secret references, signatures, calldata, raw provider payloads, or database
   access. Home keeps its existing authenticated-session token and, after login/session restore,
   passes it only through a Home-main-frame-guarded direct IPC that activates a Main-memory-only
   Sniping session with a generation token;
   logout, customer change, 401 or generation replacement aborts in-flight work and clears it. Coin
   preload exposes only fixed typed Sniping methods. Main owns every route/header and the customer
   JWT; renderer input cannot supply a URL, header, token or credential reference.
7. Preserve 32px menu bar, Royal Blue tokens, Arco mini controls, stable names, shallow BEM,
   keyboard/focus/empty/error states, and standalone/Omni size contracts.
8. Exact simulation chooses its event only from Private
   `POST /sniping/simulation/event/list`; it never infers eligibility from Activity or joins raw
   event/intent data. Activity detail is limited to the selected sanitized list row because task 026
   has no activity-detail endpoint. Versions means current pinned release/config revision identities,
   not a fabricated revision-history API.
9. Config and exact/shadow histories use independent 1-based pagination. Activity alone uses its
   opaque next cursor and clears it on every filter change. Shadow request has explicit owner-entered
   `max_events`, ordered unique `checkpoint_blocks`, and `evidence_ttl_seconds`; uncertain retries
   reuse one request id, while a deliberate new run creates another.
10. Server Catalog renders available releases only. Planned products, including Twitter, are an
   inert Roadmap section with no Create/Start command and can never appear as configured/active.
11. The Coin preload exposes exactly fourteen Sniping methods: component/config list and detail,
   validate/save, narrow Start/Stop monitoring, runtime list, eligible-event list, exact request/list,
   shadow request/list and Activity list. It never exposes execution list, generic desired-state,
   arbitrary URL/request, Activity detail/history, Canary, Arm, signer or trade methods.

## Verification

- Store/component tests cover catalog/config projection, form/JSON single ownership, exact schema
  errors, revision conflict, monitor readiness/start/stop, `armed`→`Monitoring` semantic projection,
  simulation evidence expiry/config invalidation, shadow simulated/unknown values and no
  auto-advance, separate SPCX/GME instances, locked Canary/financial Armed, Activity cursor/filtering,
  and unavailable Twitter source.
- Static checks prove one primary navigation owner, secret-free renderer bridge, stable names,
  responsive scroll contracts, i18n, and no direct HTTP/JWT/database/credential access.
- Focused renderer/node typecheck, unit/static/Omni source checks, fresh isolated DEBUG_DEV build,
  and `git diff --check` pass.
- Independent Verify writes `docs/plan/reviews/trench-sniping-workbench-026-1.md`. Do not run E2E or
  automated screenshots; Ral performs runtime/visual acceptance.

## Review-fix checkpoint — 2026-08-14

- Fixed review 026-1 P1: the recursive request and response projection boundary now rejects
  normalized standalone/token-context JWT and token aliases, JWT-shaped values, and the same
  sensitive aliases in relay error issue paths. Exact Sniping token-domain projection keys remain
  allowed.
- Focused Sniping unit, strict Sniping TypeScript, Sniping static layout, and scoped diff checks pass.
  Task remains `in-progress` for fresh independent re-verification and the other review gates.
- Fixed the confirmed review 026-1 P2 renderer contracts: generic non-derived `read_only` values
  retain only their server/catalog baseline through generated fields, Advanced JSON and payloads;
  exact `{}` UI hints safely select Advanced JSON while malformed nonempty hints fail closed.
- Exact and Shadow histories now have independent page-one/size-one latest projections with their
  own stale-intent fencing. Every report-bearing attempt is pinned to the selected config, revision,
  component, component version, schema and chain before history/latest evidence is adopted; a
  non-Flap report cannot claim Flap product evidence. History pagination cannot redefine the rail.
- Product name now participates in the canonical owner-draft baseline. Name-only edits survive
  same-revision and conflicting Refresh, block monitoring/simulation until saved, and reset only
  after a successful Save. A failed current detail fetch retains display facts but marks the detail
  stale and disables only detail-dependent mutations; Activity and history remain independently
  viewable, and a successful retry restores the gates.
- Evidence/report transformations now live in renderer services rather than Vue SFCs. At 800×282,
  Back, preamble, evidence, tabs and the active panel share one whole-detail scroll path so primary
  configuration actions remain reachable without a nested page scroll.
- PASS — focused Sniping unit `58/58`, strict Sniping unit TypeScript, focused Coin renderer
  `vue-tsc`, Sniping static layout `13/13`, renderer i18n and scoped `git diff --check`. Build,
  E2E, screenshots, live calls and DEBUG_PROD remain intentionally not run in this fix pass.
- PASS — fresh post-fix integration: full Coin `242/242`, combined Index/Sniping static `31/31`,
  customer auth `20/20`, fresh DEBUG_DEV build at version code `260813155645`, and Omni `6/6`.
- Independent review 026-1 is **pass** with no open P1/P2/P3; all ten original findings remain
  recorded under `Resolved during Verify`.
- Task remains `in-progress` only for Ral's manual rendered runtime/visual acceptance. E2E,
  screenshots, live calls and DEBUG_PROD were not run.
