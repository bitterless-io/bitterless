# Trench module navigation and Trenchers UI result

## Outcome

Trench now has one persistent Arco two-level navigation rail. INDEX owns SOL, BSC, and Robinhood;
Trenchers owns All traders. Selecting a navigation item is local-only, the old INDEX chain tab
owner is gone, and Header Refresh rereads the active module while Agent and GMGN Settings remain
global.

Trenchers now renders the independently verified person API as a cursor-paged master-detail
workspace. It keeps Anonymous identities explicit, shows person provenance and current
`wallet-sum-v1` evidence, exposes ordered wallet/account rows, supports manual profile CAS, and can
move one exact already person-linked user wallet with expected-revision/current-membership CAS.
The move confirmation shows its source person ID and current link source. It never creates an
unknown wallet, infers a person from a name, or claims transfer-aware profitability.

Implementation status: **implemented; independent Verify pending**. Task 024 intentionally remains
`in-progress`; Ral owns later visual and interaction acceptance.

## Implementation

- Added the single local navigation store and Arco `a-menu` rail with stable keys
  `index:solana`, `index:bsc`, `index:robinhood`, and `trenchers:all`. Both groups are visible and
  ordered, the rail scrolls independently, and complete labels remain at narrow widths.
- Replaced the INDEX-internal chain tabs with a `selectedChain` input. Existing Add CA,
  cross-chain paste rejection, analysis, projection, error recovery, and provider settings behavior
  remain in the INDEX workspace. Ranks render with three digits through the per-chain Top-300 cap.
- Routed Header Refresh to INDEX or Trenchers based on the active local module. Initial application
  mount still initializes INDEX; person reads start lazily only when Trenchers is selected.
- Added a renderer-only typed person client/store over the existing Trench XPC boundary. The store
  owns search, revision-fenced cursors, previous/next traversal, stale-cursor restart, selection
  preservation, merged-person redirect, stale-but-visible detail refresh, and typed empty/error
  states. It contains no SQL, SQLite import, direct HTTP, MCP, or credential handling.
- Added the person list with localized Anonymous state, two-line notes, wallet count, chain badges,
  and current `INDEX wallet sum`. Missing ranked evidence renders `—`. Rows retain the authoritative
  server order `updated_at DESC, person_id ASC`; the renderer does no page-local profit sort and
  makes no global leaderboard claim.
- Added person detail for avatar, display name, note, X identity, per-field profile provenance,
  wallet aggregate, full copyable addresses, wallet metadata/link source, chain rank/profit, and
  last-seen evidence. Remote avatar failure falls back to the deterministic local initial.
- Added profile editing that sends only changed optional fields, uses the current revision CAS, and
  keeps typed conflicts visible with refreshed current data. Blank changed fields clear; Cancel has
  no write.
- Added the scoped `Move existing Trench wallet` flow. Exact chain+address lookup searches only
  already person-linked rows, rereads exact details, accepts exactly one matching `user` account,
  shows source person/current membership, and moves by wallet ID plus target revision/source-person
  CAS. Unknown, unattached, non-user, ambiguous, already-owned, partially unreadable, or stale
  matches fail closed and are never created.
- Added English/Chinese strings, stable `name` attributes, semantic business classes, keyboard-
  reachable controls, focus treatment, internal scroll ownership, 38/62 wide master-detail, and
  narrow list/detail switching with a visible Back action. The 148px rail compacts to 112px below
  560px; low-height and narrow+low-height rules keep controls reachable.
- Closed all six findings from the first independent Verify without changing that review: the
  Arco menu event now uses a receiver-safe closure tested as a detached component callback;
  profile normalization/diff/revision/rebase and move lookup/confirm workflows live in the person
  store; list selection no longer emits a business identifier; every repeated wallet address has
  a stable `name`; and the English/Chinese Coin and Trench catalogs are paired typed modules with
  every touched TypeScript file below 800 lines. A fresh independent reverify is still required.
- Closed all three findings from the second independent Verify without changing that review. The
  narrow detail pane now exposes its store-owned Back action for loading, empty, error, and ready
  states; every list-owned awaited detail/off-page redirect read checks both list and detail intent
  before any post-await selection/detail mutation, while page state remains owned by the active
  list sequence; and pending profile/wallet-move dialogs reject
  Escape, mask, close-button, and Cancel dismissal while preserving the draft or exact confirmation.
  A deterministic deferred race proves a newer search cannot be overwritten by an older refresh.

## Verification

- PASS — `node tests/coin/run-unit.mjs`: `170/170`, including detached Arco component-event
  dispatch, local no-call navigation, store-owned mobile-detail intent, cursor
  restart/selection, Anonymous state, changed-field-only profile CAS, profile revision conflict,
  exact user-wallet lookup/move, non-user rejection, membership conflict refresh, all-state narrow
  Back intent, pending-dialog state preservation, and a deterministic stale-refresh/new-search race.
- PASS — `node --test scripts/coin/trench-index-layout.test.mjs`: `18/18`, including one Arco
  navigation owner, Header active-module refresh, Trenchers stable names/CAS boundaries,
  store/component ownership, paired sub-800-line locale modules, responsive/internal-scroll rules,
  Top-300 labels, i18n, and the unchanged 12-tool public Trench MCP surface.
- PASS — focused ESLint over all 024 Vue/TS/store tests.
- PASS — focused renderer `vue-tsc` project and `yarn check:renderer-i18n`.
- PASS — `node --test tests/omni/trenchOmniEmbedding.test.mjs`: `6/6`, including standalone/Omni
  source boundaries and current built renderer targets.
- PASS — isolated DEBUG_DEV `yarn build`; built version code is `260813155644`.
- PASS — `git diff --check`.
- NOT RUN — Electron/browser E2E, screenshot automation, or automated visual acceptance, per Ral's
  explicit instruction. Ral will test the rendered layout and interactions.

No DEBUG_PROD command, process, profile, database, or MCP record was touched. No production Trench
record was written. Develop did not author a review file; fresh independent Verify must write
`docs/plan/reviews/trench-trenchers-ui-024-3.md` before the task can be marked `done`.
