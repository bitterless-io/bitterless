---
id: trench-sniping-workbench-026-1
target: current-worktree
---

# Findings

None.

# Resolved during Verify

1. **Resolved — P1 · The recursive desktop boundary accepted JWT and generic token aliases in
   renderer requests, Core responses, and sanitized Core issue paths.**
   - The original implementation denied selected compounds such as `coreToken` and `accessToken`
     but allowed normalized standalone `token`/`jwt`, credential-context aliases, concatenated
     aliases, and JWT-shaped values. That violated the renderer-input-cannot-supply-token and
     Coin-never-receives-customer-JWT boundary.
   - `src/main/sniping/snipingRequest.validation.ts:58-67,129-183` now applies NFKC/case/separator
     normalization, exact domain-token allowlisting, generic token/JWT denial, and JWT-shaped value
     denial through the shared recursive request/projection scanner. The relay reuses that semantic
     rule for issue paths at `src/main/sniping/snipingRelay.client.ts:17-38`.
   - Fresh independent matrix: **29/29** aliases were rejected recursively by both request and
     projection parsing, including standalone, NFKC, camel/snake/kebab/concatenated, customer,
     provider, auth, bearer, API, access, refresh, session, CSRF, ID and opaque-token forms. A
     JWT-shaped value under a benign key was rejected on both paths; **29/29** issue aliases were
     dropped. Required positives remained exact: `quote_token_address`, `token_address`,
     `token_symbol`, `token_decimals`, quote-token readiness/declared-decimal paths,
     `provider_reference_ids`, and the documented benign lexical boundaries.

2. **Resolved — P2 · Advanced JSON bypassed a release's generic non-derived `read_only` UI
   contract.**
   - The original generated control was disabled, but Advanced JSON could replace or inject the
     same read-only value and `payload()` returned it.
   - The compiler now records verified non-derived read-only ownership separately from derived
     ownership (`snipingSchema.service.ts:79-123,230-309`). `SnipingDraftController` preserves an
     existing baseline, deletes an absent-baseline injection, and strips derived values in both
     mutation and payload paths (`snipingDraft.service.ts:27-83`).
   - A fresh generic-form probe used a required read-only string with no JSON Schema `const`:
     generated-field and Advanced-JSON overwrite attempts both retained `"server"`; an absent
     baseline could not be injected; the derived field was absent from snapshot and payload.

3. **Resolved — P2 · Paging simulation history replaced the evidence rail's newest evidence.**
   - The original rail derived current evidence from the currently displayed history page, so page
     2 could describe an older run or no run.
   - `SnipingLatestEvidenceController` owns separately sequenced page-1/page-size-1 Exact and Shadow
     projections (`snipingEvidence.service.ts:97-153`). Store history refreshes load the requested
     page and the independent latest projection together without conflating their ownership
     (`sniping.store.ts:479-519,537-546`).
   - A fresh race probe interleaved an older history-page response and an older latest response with
     a newer page-3/latest intent. History stayed on page 3, the rail stayed on the newer page-one
     run, and both late responses were ignored. Focused tests also cover Exact and Shadow page
     independence.

4. **Resolved — P2 · A name-only owner draft was treated as clean and lost on Refresh.**
   - The original dirty state covered JSON only, so Refresh replaced a locally changed name and
     monitoring/simulation could proceed with an unsaved save-payload field.
   - The store now owns `nameBaseline` and exposes `ownerDraftChanged` across name plus JSON
     (`sniping.store.ts:85-87,121-135`). Refresh/conflict reads preserve the owner name while
     adopting current revision facts, and only successful Save establishes the new baseline
     (`:221-235,380-419,750-787`).
   - Fresh probe: a name-only edit became dirty; Start and simulation gates closed; same-revision
     Refresh retained it; a newer revision raised the CAS conflict while retaining it; Save sent
     `expected_revision: 6`, adopted revision 7, and only then cleared dirty state.

5. **Resolved — P2 · A failed detail refresh labelled retained facts stale but left remote
   mutations enabled.**
   - The original gate depended on catalog/list phase rather than freshness of the selected detail.
   - `detailRemoteReady` now requires the current detail provenance, and edit/Start/Stop/simulation
     gates consume it (`sniping.store.ts:104-135,173-178`). A failed current selection clears only
     detail freshness while retaining readable facts (`:247-278`).
   - Fresh probe: after `DETAIL_UNAVAILABLE`, stale=true and all four detail-dependent readiness/
     mutation gates were false; retained Exact history and Activity stayed visible; Activity could
     refresh independently without clearing or inheriting the Product error. A successful detail
     retry restored the gates in the focused regression.

6. **Resolved — P2 · Canonical empty `{}` UI hints could not reach Advanced JSON.**
   - The original ownership verifier treated no hints as unverified and disabled the otherwise
     valid generic release.
   - Exact `{}` now verifies as an intentional absence of derived/read-only ownership while malformed
     nonempty hints remain fail-closed (`snipingSchema.service.ts:84-123,230-259`).
   - Fresh probe: a closed valid object schema plus `{}` produced
     `supported=false, safeAdvanced=true`; `{ schema: "bl-sniping-ui-hints-v1" }` without its exact
     structure produced `safeAdvanced=false`. The read-only/derived ownership probe above remained
     closed.

7. **Resolved — P2 · Simulation report identity was not bound to the selected pinned
   configuration.**
   - The original store admitted report identity that disagreed with selected component, version,
     schema or chain, and a non-Flap identity could carry Flap evidence.
   - `simulationProjectionMatchesDetail()` now binds request kind/config/revision and every non-null
     report's config id/revision, component id/version, schema hash and chain; it also rejects Flap
     product evidence under a non-Flap identity (`snipingEvidence.service.ts:20-38`). History,
     independent-latest and direct-request adoption all apply this check and retain prior safe scoped
     projections on integrity failure (`sniping.store.ts:479-519,548-570,592-629`).
   - Fresh exhaustive matrix: **21/21** negative cases passed — six identity dimensions plus
     non-Flap-with-Flap-evidence, each through **history, latest and request** surfaces. Every case
     set `SNIPING_RESPONSE_INTEGRITY`, adopted no corrupt evidence, and retained both prior safe
     history and latest projections.

8. **Resolved — P3 · FE-1 evidence workflow state lived in the Vue view.**
   - The original SFC selected current runs and derived idle/ready/blocked/unknown/expired workflow
     states.
   - Workflow derivation is now pure service/store logic in
     `snipingEvidence.service.ts:40-95` and `sniping.store.ts:180-191`; `SnipingEvidenceRail.vue:15-29`
     only localizes and binds the prepared stages. The static FE-1 contract explicitly forbids the
     old report/state helpers in the SFC.

9. **Resolved — P3 · FE-1 Shadow/report business transforms lived in the run-list SFC.**
   - The original SFC selected accepted evidence and computed cohort outcome counts, policy summary
     and checkpoint summaries.
   - Those transforms now live in `snipingReport.service.ts:59-207`. The SFC maps runs through
     `buildSnipingSimulationRunDisplay()` and renders the resulting display model only
     (`SnipingSimulationRunList.vue:63-76`). The service keeps `duplicate` exclusively in the Flap
     cohort-count branch; position-derived fallback reports only executable/blocked/unknown.

10. **Resolved — P2 · The 800×282 detail layout could consume all height before its only scroll
    owner and clip primary actions.**
    - The original narrow detail kept `overflow:hidden` on the outer pane and placed Back, header,
      qualification, evidence and tabs before the nested scroll owner.
    - Below 920px, the whole detail owns vertical scrolling, all direct children retain their height,
      and the inner panel relinquishes nested scrolling (`SnipingWorkspace.less:698-725`). This puts
      Back, preamble, evidence, tabs and active panel actions on one ordered scroll path.
    - The fresh deterministic 800×282 CSS/DOM contract passed and verifies outer overflow, child
      shrink behavior, inner overflow relinquishment, DOM order, and primary-action reachability.
      Runtime visual confirmation remains Ral's manual acceptance gate as required.

# Verification evidence

- **Prerequisites:** independently reconfirmed the canonical Private task-013 review is **PASS**,
  including its 2026-08-14 Shadow projection follow-up: fresh/replay/list parity, zero versus unknown,
  exact omission, deterministic position order/count and fail-closed relation/count mismatch. The
  task-001 and task-012 prerequisite reviews remain PASS by their canonical review evidence.
- **Fresh security/schema/store matrices:** the 29-alias request/projection/issue-path probe,
  read-only baseline/no-injection and empty-UI probe, deliberately interleaved latest/history race,
  name-only dirty/CAS probe, failed-detail scoped-lock probe, and 21-case report-integrity cross
  product all passed without browser, Electron, persistence or network.
- **Focused and broad deterministic gates:**
  - `node tests/coin/run-sniping-unit.mjs` — **58/58 PASS**.
  - `node tests/coin/run-unit.mjs` — **242/242 PASS**.
  - combined Index + Sniping static contracts — **31/31 PASS**, including the Sniping 800×282,
    FE-1, bridge, sender, session, navigation, i18n and no-execution contracts.
  - `yarn test:customer-auth` — **20/20 PASS**.
  - strict Sniping TypeScript, focused Coin renderer `vue-tsc`, focused Trench renderer `vue-tsc`,
    and `yarn typecheck:node` — **PASS**.
  - `yarn check:renderer-i18n` — **PASS**.
  - `node --test tests/omni/trenchOmniEmbedding.test.mjs` — **6/6 PASS**.
  - scoped `git diff --check` — **PASS**.
- **Fresh artifact inspection:** the parent-owned DEBUG_DEV build was not rerun. Its preload and Coin
  chunks are newer than all remediated Sniping sources, contain version code `260813155645`, expose
  the exact fourteen-method frozen Sniping bridge with no customer/core token surface, and contain
  the current integrity, evidence and whole-detail-scroll implementations. The Omni test passed
  against this artifact.
- **Non-task broad diagnostics:** repository-wide `yarn typecheck:web` and the strict broad Trench
  node config still report established errors in Connector, Home, Poker, Maestro, OnlyPreview,
  Eyes-on-Agents and other non-Sniping files; neither reports a Sniping renderer/source error, while
  both focused renderer configurations and strict Sniping config pass. The historical
  `trench-import-audit.mjs` blanket-denies any Trench `ipcRenderer`/`resources`; that assertion
  predates and contradicts this task's required exact typed preload bridges, whose replacement
  task-specific static boundary passes.
- **Code-review rules:** task-owned TS/JS/Less files remain at or below 800 lines; standalone
  functions use the local arrow-const convention; no replaceable upward business emit was found;
  both FE-1 findings are resolved. No supplied backend rule applies to this desktop boundary.
- **Product-design acceptance:** Create, Read, Update and monitoring lifecycle closure are complete
  in source and deterministic verification. Empty-hint generic Create is available; latest and
  historical Read ownership is separate and truthful; name/JSON/read-only/CAS/stale-detail Update
  ownership is closed. Delete is N/A with the specified Disabled lifecycle substitute. Navigation,
  hierarchy, stable names, keyboard paths, i18n, narrow layout and no-execution semantics pass the
  static acceptance contract. Ral retains the expressly manual rendered runtime/visual acceptance.
- **Safety:** no Electron/browser E2E, screenshot, live Core/database/RPC/HTTP/provider/chain call,
  DEBUG_PROD, deploy, signer, transaction, broadcast or trade action was run.

# Conclusion

**pass**

All ten original findings are independently resolved. No open P1/P2/P3 finding remains, and the
fresh source, negative-probe, focused/broad deterministic and built-artifact evidence satisfies the
task's Verify gate subject only to Ral's explicitly manual runtime/visual acceptance.
