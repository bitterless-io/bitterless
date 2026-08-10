# Trench Agent Skill Guide Result

Task: `trench-agent-skill-guide-015`

Status: **PASS**

Date: 2026-08-09

## Implemented

- Added a Main-owned Trench onboarding service and `McpHandler/getTrenchIntegrationInfo`. The
  response uses the current application's actual MCP server name and helper path, exact MCP config,
  complete bundled `bitterless-trench` directory, 12-digit skill version, bridge metadata, and one
  ordered English setup instruction.
- Validated the full five-file skill bundle for packaged and unpackaged applications. The directory,
  nested directories, and files must be readable plain filesystem entries; missing, empty, or
  symlinked content fails closed.
- Kept DEBUG identity exact. DEBUG output visibly identifies the current server as test-only and
  explicitly forbids aliasing it to production `bitterless` or storing real Trench records there.
- Added a strict shared renderer boundary. Invalid payloads and Main/renderer skill-version mismatch
  become explicit restart-required states rather than partially rendering stale instructions.
- Added a dedicated reactive guide store with generation-fenced load/retry state and exact complete,
  helper, config, and skill clipboard actions. The store has no Trench repository, provider, or
  credential dependency.
- Added the stable Robot trigger to the shared Trench header used by standalone and Omni, plus a
  Trench-specific Arco modal. Its ordered Connect MCP, Install skill, and Restart/verify document
  retains the existing Royal Blue/white utility language and a single numbered dependency rail.
- Made the modal body the scroll owner at narrow and low viewports. The native Arco close control is
  promoted into keyboard order, receives focus after opening, and returns focus to the Robot trigger
  after closing.
- Added English and Chinese Trench-only i18n keys without changing the current Todo guide contract.

## Safety and exactness evidence

- The guide creates no BrowserWindow, WebContentsView, provider request, or Trench mutation.
- Main is the sole source for all four copied strings. Standalone Electron E2E compares the operating
  system clipboard to the exact Main-returned bytes for complete/helper/config/skill actions.
- Focused policy tests reject credential vocabulary, private-key material, Keychain, `safeStorage`,
  provider credentials, and Trench repository dependencies in the onboarding/store path.
- The E2E fixture reported `e2e: 1`, `packaged: false`, and `mockKeychain: true`; it observed no
  `safeStorage` tripwire, unexpected/denied network request, renderer error, new window, child view,
  or record-count change.

## Verification run

Passed:

- `node tests/coin/trenchAgentGuide.test.mjs` — 6/6 pure Main/shared/store/wiring tests.
- `node tests/coin/run-trench-unit.mjs` — 16/16 focused Trench unit tests.
- `node --test tests/omni/trenchOmniEmbedding.test.mjs` — 6/6 Omni contract tests.
- `yarn tsc -p tests/coin/tsconfig.trench-node.json`.
- `yarn vue-tsc --noEmit -p tests/coin/tsconfig.trench-renderer.json --composite false`.
- `yarn tsc -p tests/e2e/tsconfig.strict.json`.
- `yarn check:renderer-i18n`.
- Focused ESLint — zero errors. The repository formatting profile emitted 158 Prettier warnings; no
  unrelated bulk formatting was applied.
- Focused `git diff --check` and new-file trailing-whitespace scan.
- Fresh DEBUG `yarn build` after the final renderer source change.
- `BITTERLESS_E2E_DISPLAY_LABEL='DELL S2721QS' yarn playwright test -c
  tests/coin/playwright.config.ts trench-vault.spec.ts --workers=1` — 1/1 passed.
- `BITTERLESS_E2E_DISPLAY_LABEL='DELL S2721QS' yarn playwright test -c
  tests/coin/playwright.config.ts trench-omni.spec.ts --workers=1` — 1/1 passed.

## Viewport and visual evidence

The final E2E run refreshed and the implementation pass inspected the original PNGs:

- `out/playwright/coin/screenshots/trench-agent-guide-1360x860.png`
- `out/playwright/coin/screenshots/trench-agent-guide-800x600.png`
- `out/playwright/coin/screenshots/trench-agent-guide-omni-800x568.png`
- `out/playwright/coin/screenshots/trench-agent-guide-omni-398x568.png`
- `out/playwright/coin/screenshots/trench-agent-guide-omni-800x282.png`

The 398×568 and 800×282 captures preserve the modal title, focused native close, body scrollbar,
wrapped paths, and complete Restart/verify step without horizontal document overflow. Omni E2E also
focuses the trigger, all four copy controls, and native close, then proves close returns focus to the
trigger at all three exercised sizes.

## Development-run corrections

The first standalone run exposed an Arco attribute-forwarding issue: the warning rendered correctly
but its stable `name` was attached to the component rather than owned DOM. A named wrapper fixed the
selector without weakening the assertion. The first Omni run also exposed a test-only prefix selector
that counted four `copy-status-*` nodes with the four copy actions; it was replaced by four exact action
selectors. Screenshot capture now waits for Arco's enter transition so the PNG is visual evidence of
the modal rather than a valid DOM captured at opacity zero.

## Independent verification

Independent Verify reran the focused Main/shared/store, Trench unit, Omni contract, package-audit,
Node/renderer/E2E type, i18n, task-scoped lint/diff, fresh DEBUG build, and both exact-display
Electron gates. All passed. It also inspected all five refreshed PNGs at original resolution and
confirmed the mock-Keychain, no-`safeStorage`, no-network/provider, no-new-surface, no-record-mutation,
keyboard-focus, and responsive-scroll evidence.

The accepted review is
[`../reviews/trench-agent-skill-guide-015-1.md`](../reviews/trench-agent-skill-guide-015-1.md). It
records one non-blocking TS-1 follow-up for the 921-line Omni E2E spec; no blocking finding remains.
