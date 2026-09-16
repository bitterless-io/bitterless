---
id: workbench-institution-workflows-001
scope: Institution Kimchi workflow library, synchronization and visual Workbench
status: in-progress
depends-on: []
verify: pending
---

## objective

Implement the approved list/detail/flowchart and safe institution workflow synchronization contract. Work on an isolated branch from dev/next; merge and sync dev/next after independent verification.

## context

- ../../features/workbench-institution-workflows.md
- ../../features/kimchi-workflow.md
- ../../INDEX.md

## path

- src/main/ (workflow library/auth integration only)
- src/preload/ (workflow package boundary if required)
- src/shared/ (typed workflow library API)
- src/renderer/ (Workbench Workflow, its styles/stores/i18n)
- tests/ or apps/cowork/tests/ (focused workflow tests)
- docs/features/workbench-institution-workflows.md
- docs/plan/tasks/workbench-institution-workflows-001.md

## verification

Follow the feature contract: real API/storage/parser/UI wiring, focused tests, typecheck/build, rendered visual review, independent source review and verified sample Kimchi execution. No unapproved desktop distribution/restart required.

## Approved scope expansion (2026-09-16)

Implement the Shared and institution scopes section for both Skill and Workflow storage, Workbench lists/details and real Agent discovery/reference resolution. Include the canonical offline demo in the shared workflow catalog, plus explicit local shared package import. Final merge, commit and push target is dev/next; parent will send BotAndI completion notice. Expanded code paths include existing skill sync/storage/catalog/prompt/tool routing and their focused tests.

## Workflow implementation checkpoint (2026-09-16)

Workflow library and Workbench are implemented; Skills expansion and independent review remain in progress. Shared packages include the byte-exact canonical offline sample and explicit local ZIP import. Institution installs use `<library>/<backend-account-sha256>/<institution_id>/<workflow-id>-<uuid>` with immutable directories and an atomic catalog. JSON previews never import TypeScript. Main resolves qualified `shared:<id>` / `institution:<institution_id>:<id>` references and rechecks managed-path authorization before and after preparing the execution runtime. Existing Kimchi builtins remain shared catalog entries.

Verification:

- `yarn test:workflow-library`: 16/16, covering ZIP/manifest bounds, no-execution preview, rollback, logout/institution races, shared preservation, separate literal institution parents, same-name runtime references, direct-path revocation, 60-second polling/disposal, real SFC/Less compilation and renderer state fences.
- `yarn typecheck:workflow-library` and `yarn tsc -p tests/workflowEngine/tsconfig.json`: passed.
- `yarn node --test --test-skip-pattern='both apps ship the same summary service and contract' tests/workflowEngine/*.test.mjs tests/workflowUi/*.test.mjs tests/workflowHost/*.test.cjs`: 152/152 executed tests passed. The excluded legacy parity test hardcodes the other repository's old release checkout, which has no Kimchi source; no unrelated checkout was switched.
- Independent adversarial ZIP fixture set: all 31 cases met their expected acceptance/rejection, including rejection of inconsistent local/central sizes and preview of a deliberately throwing TypeScript entry without execution.
- `yarn electron-vite build`: passed with a local synthetic release_prod profile containing only public endpoint/mode values. No Rig deployment, credential copy, running-app restart or desktop publication.
- `yarn node tests/workflowLibrary/visual.mjs`: real Workbench view, store and flow component rendered with explicitly labelled fixture data. Keyboard node selection, zoom/fit and Details passed. Desktop 1260×780 and constrained 660×860 screenshots in `tmp/workflow-visual/{desktop,narrow}-{light,dark}.png`; inspected visually and corrected constrained-width institution selector visibility.

The host's existing explicit execution permissions remain unchanged. Immutable old revisions are retained so active runs keep their files; removing a cloud item removes only its active catalog mapping. Shared installation is explicit and never inferred from institutional downloads.

## Independent review follow-up (2026-09-16)

Cowork's implementation author independently identified two bounded Workflow corrections: repeat the host stop/disposal fence after the final asynchronous managed-path authorization, and omit installations whose entry file is missing so Retry can download the same revision again. Add regressions for stopping during final authorization and repairing a missing entry while preserving unrelated installs. Skills changes remain owned by their separate implementation worker.

Both corrections are implemented. `yarn test:workflow-library` now passes 17/17; focused host integration passes 17/17, including the delayed final authorization stop regression. Scoped Node/Vue types and workflow-engine types pass. Final combined build follows the Skills implementation checkpoint.

Visual review also requires whole-graph fit on graph changes and viewport resize, while retaining a user's manual zoom until Fit is requested again. Extend the real-component harness with branch/loop and long graphs, resize fit and manual-zoom preservation; the diagram remains scrollable when zoomed in.

Fit follow-up verified: actual component render passes automatic resize fit, manual zoom preservation, branch/loop rendering and whole-graph bounds for both 200-node horizontal and vertical layouts. Existing desktop/narrow light/dark screenshots and new `branch-loop.png` are refreshed under `tmp/workflow-visual/`. Scoped types and 17/17 library tests pass after this bounded visual correction; page layout is unchanged.

The independent branch/loop screenshot review found that cycle fallback ranks put mutually exclusive branch nodes in a serial row, hiding long connectors behind intermediate cards. Exclude DFS backedges only when computing topological ranks, retain every rendered edge, and verify the branch paths share a column with the join after both. Keep existing sizing, styling and manual zoom behavior.

Corrected cycle ranking and routed return connectors below all node cards. The new regression verifies alternatives share a column, join/repeat ordering, all edges remain present and the return connector stays clear of cards within the canvas. `yarn test:workflow-library` passes 18/18, scoped types pass and actual render checks pass; the refreshed branch/loop screenshot was inspected again.
