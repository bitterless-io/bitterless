# Trench Sniping workbench result

## Outcome

Trench now has a third first-level Arco module, `Sniping`, with `Products` and `Activity` scopes.
Products renders the available compiled catalog, separately revisioned configured instances,
runtime/readiness facts, one generated-form/Advanced-JSON draft, Monitoring Start/Stop, eligible
finalized events, exact simulation, bounded shadow simulation, and sanitized evidence. Activity
renders only the customer-scoped cursor ledger projected by Core. The existing global GMGN gear is
unchanged; Sniping session/API state is shown in the header and runtime facts stay in Products.

The desktop has no execution surface. Backend monitor-only `desired_state=armed` renders only as
`Monitoring`; Canary, financial Armed, signing, transaction construction, broadcast and trading
remain explanatory locks. Every result is labelled `SIMULATED`, and the source transaction is
labelled as a launch transaction rather than a submitted trade.

Implementation status: **implemented; independent Verify passed; owner acceptance pending**. Task
026 intentionally remains `in-progress`; Ral owns later runtime, visual and interaction acceptance.
No Electron/browser E2E,
automated screenshot, live Core/provider/database/chain call, DEBUG_PROD operation, deployment, or
trade was performed.

## Implementation

- Extended the single local Arco rail in the exact order INDEX → Trenchers → Sniping. Sniping owns
  Products/Activity only, reuses the 32px Royal Blue header, preserves the global Agent/Refresh/GMGN
  controls, and routes Refresh to the selected Sniping projection.
- Added a Home-only session activation/clear boundary. Only the exact live Home main frame may send
  the two direct IPC commands. Main keeps the customer token in memory, treats the same
  session/token pair idempotently, rejects same-session token substitution, aborts replaced
  generations, and fences stale clear and stale 401 continuations. A timed-out old activation that
  later completes clears only the stale session it may have installed, then restores the newest
  active/cleared intent. Optional relay failures never roll back an already validated Home login.
- Added one Main-owned fixed HTTPS relay and exact Coin bridge of fourteen methods. Main alone owns
  routes, headers and the token; redirects fail closed and responses are stream-bounded to one MiB.
  A current-generation 401 clears before response parsing, including malformed/oversized bodies.
  Built senders must match the exact application renderer target, development senders must match
  the configured origin/path, and Home navigation/redirects are fenced to that same target.
  Coin receives no token, session ID, URL, header, credential reference, RPC value, private key,
  mnemonic, signature, calldata, raw provider payload, database API or arbitrary request surface.
- Added recursive normalized semantic input scanning for credential/key/executable/URL/header
  aliases and URL-shaped values, while retaining only the compiled non-secret
  `provider_reference_ids` boundary. Responses use a separate sanitized projection policy so valid
  reason/code-ready evidence remains readable without exposing secret/provider/source material.
  Backend error messages are replaced locally and unsafe issue paths (including token/JWT/URL and
  normalized credential aliases) are discarded without hiding legitimate token-address pointers.
- Implemented exact runtime validators for catalog/config/runtime/event/exact/shadow/Activity wire
  projections. Known Flap evidence, event identity, checkpoint policy, request/report provenance and
  shadow positions are validated as a closed contract. The append-only attempt ledger accepts the
  real claimed→terminal rows, retry/expiry cycles and standalone pre-claim failure while rejecting
  impossible ordering, state, expiry, reason, accepted-report and request-lifecycle combinations.
  Component/build identities use strict bounded SemVer and shadow checkpoint lists stay within the
  exact one-to-eight ordered unique contract.
- Implemented a restricted versioned generic JSON Schema/UI-hint compiler. Unsupported keywords,
  compositions or ambiguous hints fall back to Advanced JSON; independently verified read-only
  derived keys are still stripped from every draft and validate/save payload. Generated fields and
  Advanced JSON mutate one canonical draft, including enum/const/array-item constraints.
- Added the Products catalog/list/detail controller with independent latest-intent fences for
  catalog, detail, runtimes, events, exact, shadow and actions. Workspace Refresh preserves a dirty
  owner draft; same revision refreshes safe facts without a false conflict, while changed immutable
  provenance sets a revision conflict and invalidates stale evidence. Loading, refreshing,
  unavailable, missing-release and missing-credential projections disable remote mutation.
- Added separate SPCX/GME-style configuration instances without a mixed quote-token allowlist.
  Available releases alone receive Configure; Twitter and future launch/copy products remain an
  inert Roadmap with no Create/Start command.
- Added exact eligible-event selection from `/sniping/simulation/event/list`, stable exact-value
  copy controls, independent 1-based event/exact/shadow pages, and explicit shadow policy inputs.
  Deliberate New runs get a new request ID; Retry appears only after an uncertain retryable failure
  with the exact unchanged config/revision/policy fingerprint.
- Added sanitized report presentation for event/block/release/config/schema/sender/build/protocol/
  call-policy identity, expected versus simulated output, units, readiness, reason and expiry.
  Shadow positions preserve nullable gross/net/checkpoint facts. Regional duplicate observations
  display from Flap `cohort_counts.duplicate`, never from a fabricated duplicate position outcome.
  Pending/non-reporting runs show localized Unknown/`—`, never a fabricated numeric zero; expired
  historical reports remain inspectable while their evidence rail is explicitly Expired.
- Added Activity cursor/filter ownership with stale-request fencing, selected-row detail limited to
  the sanitized list projection, and scope-specific Product/Activity errors so a failure in one
  workspace does not mark the other unavailable.
- Added responsive internal-scroll layouts, narrow master/detail Back behavior, horizontal compact
  action/tab strips, stable names, paired English/Chinese text, tablist Arrow/Home/End behavior,
  keyboard-selectable Activity rows and explicit idle/blocked/unknown/expired evidence states.
  Every task-touched TypeScript, JavaScript and Less file remains at or below 800 lines.
- Added an explicit esbuild alias to the existing sandboxed Trench preload packaging step so the
  frozen typed bridge is present in the fresh DEBUG_DEV artifact without changing sandbox,
  navigation or CSP boundaries.

## Verification

- PASS — `node tests/coin/run-sniping-unit.mjs`: `58/58`, including the real Private append-only
  attempt transition ledger, exact accepted-report selection, request/expiry lifecycle, current
  Flap evidence, checkpoint/provenance constraints, regional duplicate semantics, generic schema
  fallback/derived stripping, revision races, scope-isolated errors and Shadow retry identity.
- PASS — `node tests/coin/run-unit.mjs`: `242/242`, including Home/Main session fencing, relay
  redirect/body/401 safety, exact fourteen-method IPC, sender guards and all focused Sniping store
  and validator coverage.
- PASS — `node --test scripts/coin/trench-index-layout.test.mjs
  scripts/coin/trench-sniping-layout.test.mjs`: `31/31`, including navigation ownership, locked
  execution surfaces, secret-free bridge, stable names, i18n, responsive/accessibility contracts and
  the task path-based sub-800-line audit.
- PASS — strict Sniping unit TypeScript, focused Coin renderer `vue-tsc`, Node no-check integration
  typecheck, `yarn test:customer-auth` (`20/20`), and `yarn check:renderer-i18n`.
- PASS — fresh isolated DEBUG_DEV `yarn build`; the Main, sandboxed `trench.js` preload, Coin and
  Omni renderer targets were rebuilt successfully at version code `260813155645`.
- PASS — `node --test tests/omni/trenchOmniEmbedding.test.mjs`: `6/6` against the fresh artifact,
  including standalone/Omni sandbox, navigation and output freshness/CSP contracts.
- PASS — `git diff --check`.
- NOT RUN — Electron/browser E2E, automated screenshots or automated visual acceptance, per Ral's
  explicit instruction. Ral will test the rendered workbench and interactions.

Independent Verify passed in `docs/plan/reviews/trench-sniping-workbench-026-1.md`; all ten original
findings are preserved under `Resolved during Verify`, and no P1/P2/P3 remains open. The task stays
`in-progress` only for Ral's expressly manual rendered runtime/visual acceptance.

## Review-fix checkpoint — 2026-08-14

- Closed the confirmed review 026-1 P1 scanner gap without changing the review artifact. Request
  configs, Core response projections, and relay error issue paths now share NFKC/case/separator-aware
  JWT/token semantics. Standalone and contextual aliases fail closed recursively; JWT-shaped values
  fail under benign keys; arbitrary opaque evidence values remain allowed only when their key is not
  token-secret semantic.
- Exact domain fields remain readable/writable where contracted: `token_address`,
  `quote_token_address`, token symbol/decimals/label/count, quote token code/decimals readiness,
  declared quote-token decimals, Flap product evidence, and `provider_reference_ids`.
- PASS — `node tests/coin/run-sniping-unit.mjs`: `48/48`.
- PASS — strict Sniping unit TypeScript, `scripts/coin/trench-sniping-layout.test.mjs` (`12/12`),
  and scoped `git diff --check`.
- NOT RUN — build, E2E, screenshots, live Core/provider/database/chain calls, network work,
  DEBUG_PROD, deployment, signing, broadcast, or trade. The implementation is stable for a fresh
  independent re-verification; task status stays `in-progress`.

### Renderer contract closure

- Closed all confirmed review 026-1 renderer P2 gates. Advanced JSON can no longer overwrite or
  inject non-derived read-only ownership, while derived values remain absent; canonical empty UI
  hints retain the generic Advanced JSON fallback and malformed hints remain unusable.
- EvidenceRail reads separately fenced newest Exact/Shadow projections fetched with page 1 and
  page size 1. Browsing history changes only its list viewport. All non-null attempt reports are
  checked against the selected config/revision/release/schema/chain before any history or latest
  projection is adopted, including the non-Flap/Flap-evidence confusion case; integrity failure
  retains the prior safe projection and stays scoped to Exact or Shadow.
- Name and JSON are one owner save draft. Name-only edits are dirty, survive Refresh and revision
  conflict fact refresh, gate monitoring/simulation, and become the new baseline only after Save.
  Current-detail freshness is independently fenced: a failed refresh retains stale display facts
  but disables config/start/stop/simulation mutations until retry succeeds, without cross-disabling
  Activity or retained history.
- Moved EvidenceRail state derivation and SimulationRunList report/cohort/policy/checkpoint
  transforms to pure services. The 800×282 detail layout now has one vertical whole-detail scroll
  path covering Back through primary actions while preserving desktop and below-920 master/detail
  behavior. Every task-owned TS/JS/Less file remains below 800 lines.
- PASS — `node tests/coin/run-sniping-unit.mjs` (`58/58`).
- PASS — strict Sniping unit TypeScript and focused Coin renderer `vue-tsc`.
- PASS — `node --test scripts/coin/trench-sniping-layout.test.mjs` (`13/13`),
  `yarn check:renderer-i18n`, and scoped `git diff --check`.
- NOT RUN — build, full integration suite, Electron/browser E2E, screenshots, live Core/provider/
  database/chain calls, network work, DEBUG_PROD, deployment, signing, broadcast or trade. The
  parent delivery agent owns broader integration gates and fresh independent re-verification.

## Final verification checkpoint — 2026-08-14

- PASS — independent review 026-1; findings: none. The original P1, seven P2 and two P3/FE-1
  findings are retained with their closing evidence under `Resolved during Verify`.
- PASS — Sniping `58/58`, full Coin `242/242`, combined Index/Sniping static `31/31`, customer auth
  `20/20`, strict Sniping TypeScript, focused Coin/Trench renderer `vue-tsc`, Node no-check
  integration typecheck, renderer i18n, and `git diff --check`.
- PASS — fresh DEBUG_DEV `yarn build` at version code `260813155645`; Omni artifact verification
  `6/6` confirms the rebuilt sandboxed Trench preload, Coin renderer and exact Sniping bridge.
- NOT RUN — Electron/browser E2E, screenshots, live Core/database/RPC/provider/chain calls,
  DEBUG_PROD, deployment, signing, broadcast or trade. Ral owns those manual acceptance steps.
