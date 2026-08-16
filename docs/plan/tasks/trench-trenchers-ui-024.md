---
id: trench-trenchers-ui-024
scope: BL Trench Arco module navigation and Trenchers renderer
status: done
depends-on: [trench-person-registry-023]
---

# Trench module navigation and Trenchers UI

## Objective

Replace the INDEX-only module tabs with one Arco two-level left navigation and deliver the
Trenchers person master-detail page, including manual profile edit and CAS movement of an existing
person-linked Trench wallet.

## Context

- [`../../features/trench-navigation-layout.md`](../../features/trench-navigation-layout.md)
- [`../../features/trench-person-registry.md`](../../features/trench-person-registry.md)
- [`../../features/trench-index-layout.md`](../../features/trench-index-layout.md)
- [`../analysis/trench-person-registry-analysis.md`](../analysis/trench-person-registry-analysis.md)
- [`trench-person-registry-023.md`](trench-person-registry-023.md)

Keep `dev/current`, preserve dirty work, and do not touch DEBUG_PROD. Per Ral, do not run Electron
E2E; owner visual acceptance is the handoff gate.

## Path

- layout/person/index feature docs and task/result/README docs for 024
- `src/renderer/coin/src/App.*`
- new module-navigation and Trenchers components/stores/types/styles
- existing `TrenchIndexWorkspace` chain-selection integration
- common i18n English/Chinese
- focused renderer/unit/static/Omni contract tests only

## Contract

1. Use Arco vertical menu semantics with first-level INDEX and Trenchers. INDEX children are SOL,
   BSC, Robinhood; Trenchers child is All traders. Remove the duplicate INDEX chain tab owner.
2. Navigation is local state only. INDEX child drives both columns/Add chain; Trenchers reads person
   API. Header Refresh routes to the active module; Agent and GMGN Settings remain global.
3. Render the person list/detail, cursor search, wallet aggregate labelling, profile edit CAS, and
   existing person-linked wallet search/move CAS exactly as the layout and person contracts specify.
   Reject unknown/unattached/non-user/ambiguous wallets; do not merge by name or fabricate
   transfer-aware profit.
4. Preserve 32px menu bar, Royal Blue visual tokens, stable `name` attributes, shallow business BEM,
   keyboard/focus/empty/error states, and standalone/Omni responsive constraints.
5. No SQL, direct database, new credential, scripted external fetch, or MCP work in the renderer.

## Verification

- Focused store/component tests cover route/chain selection, no-call navigation, cursor refresh,
  Anonymous state, selection preservation, stale profile/link mutation, and empty/error behavior.
- Static layout assertions prove Arco two-level structure, one chain-state owner, Top-300 labels,
  stable names, responsive scroll/overflow contracts, i18n, and unchanged menu-bar identity.
- Renderer typecheck, unit/static/Omni source checks, fresh isolated DEBUG_DEV build, and
  `git diff --check` pass. No Electron E2E or screenshot automation runs.
- Fresh independent Verify writes `docs/plan/reviews/trench-trenchers-ui-024-3.md`; Ral performs
  visual and interaction acceptance.

## Development handoff

Implementation completed on 2026-08-13. The renderer now has one Arco navigation owner, the
existing INDEX projection receives its selected chain, and Trenchers supplies a cursor-paged
person master-detail with manual profile CAS and explicit CAS movement of an existing
person-linked user wallet. Unknown, unattached, non-user, ambiguous, or stale memberships remain
rejected; no wallet/person is created from the move dialog.

The first independent Verify recorded six blocking findings. Develop has now bound the actual
Arco component event through a receiver-safe closure with a detached-dispatch regression; moved
profile-draft/CAS/conflict-rebase and move lookup/confirm orchestration into the reactive person
store; added the repeated wallet-address stable name; removed the business `personId` component
emit in favor of a store selection intent/presentation flag; and split both touched locale files
into paired typed Coin/Trench modules below 800 lines. The first review remains unchanged and its
findings were verified closed by the later review.

The second independent Verify recorded three further blocking findings. Develop has now kept the
narrow-screen Back action available while detail is loading, empty, failed, or ready; fenced every
list-owned awaited person read so an older refresh cannot overwrite a newer search/selection; and
blocked Escape, mask, close, and Cancel dismissal while either profile or wallet-move mutation is
pending. Deterministic store and source-contract regressions cover all three findings. Independent
Verify 3 passed with no open P1/P2/P3; neither prior review was edited.

Focused renderer/unit/static/type/i18n/Omni source checks and a DEBUG_DEV build pass. Electron E2E
and screenshot automation were intentionally not run per Ral. The implementation evidence and
manual-acceptance boundary are recorded in
[`../results/trench-trenchers-ui-024.md`](../results/trench-trenchers-ui-024.md). The task is
`done`; Ral's manual visual and interaction acceptance remains intentionally separate.
