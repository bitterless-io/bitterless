---
id: trench-gmgn-settings-020
scope: BL Trench INDEX
status: done
depends-on: [trench-index-chain-separation-019]
---

# Trench GMGN Settings

## Objective

Make the existing Main-owned GMGN CLI/API-key configuration reachable from the Todo-parity Trench
menu bar and from actionable INDEX provider failures. Preserve one credential/process boundary,
find the documented Yarn global CLI from a desktop GUI launch, and let Ral save or replace the API
key, verify read-only access, then explicitly retry the preserved Add/Reanalyze operation.

## Context

- [`../../features/trench-index.md`](../../features/trench-index.md)
- [`../../features/trench-index-layout.md`](../../features/trench-index-layout.md)
- [`../../guides/gmgn-cli.md`](../../guides/gmgn-cli.md)
- [`../../guides/coin-data-sources.md`](../../guides/coin-data-sources.md)
- [`../analysis/trench-index-analysis.md`](../analysis/trench-index-analysis.md)
- [`trench-index-chain-separation-019.md`](trench-index-chain-separation-019.md)

The current branch is `dev/current`; do not switch, create a branch, or use a worktree. Preserve
all unrelated dirty worktree changes. The running DEBUG_PROD application/profile/database must
stay running and untouched; builds and Electron acceptance use an isolated DEBUG_DEV copy only.

## Path

- `docs/features/trench-index.md`
- `docs/features/trench-index-layout.md`
- `docs/plan/analysis/trench-index-analysis.md`
- `docs/plan/tasks/trench-gmgn-settings-020.md`
- `docs/plan/results/trench-gmgn-settings-020.md`
- `docs/plan/README.md`
- `src/main/app.main.ts`
- `src/main/coin/resources/gmgnCli.service.ts`
- `src/main/coin/coinIpc.service.ts`
- `src/main/coin/coinSender.guard.ts`
- `src/preload/trench/trench.preload.ts`
- `src/renderer/coin/src/App.vue`
- `src/renderer/coin/src/components/TrenchHeader/**`
- `src/renderer/coin/src/components/TrenchGmgnSettings/**`
- `src/renderer/coin/src/components/TrenchIndexWorkspace/**`
- `src/renderer/coin/src/views/resources/**` only when a narrow reusable GMGN controller is needed
- `src/renderer/common/i18n/en.ts`
- `src/renderer/common/i18n/zh.ts`
- `scripts/coin/trench-index-layout.test.mjs`
- `tests/coin/**` for focused service, renderer, and Electron coverage
- `tests/maestro/fixtures/bitterlessApp.fixture.ts`

## Contract

1. Add one gear action to the accepted 32px Trench menu bar after Refresh. It uses the existing
   28px Todo-style icon treatment, stable name, tooltip, title, and aria-label; header height,
   padding, background, status behavior, standalone traffic-light spacing, and Omni drag behavior
   remain unchanged.
2. The gear opens one Trench-specific GMGN settings modal. It shows only sanitized CLI detection,
   API-key configured state, last read-only probe, and typed recovery guidance. It provides
   Recheck, Verify existing key, Get API key, and Save and verify a replacement key. It does not
   expose unrelated Codex/service settings or restore the legacy Coin workspace.
3. Reuse the existing `window.coin.resources` contract, Coin resource IPC channels, and Main
   `GmgnCliService`; do not create a second credential file/store, direct renderer filesystem
   access, or Trench SQLite table. The Trench preload exposes only the four required GMGN methods
   (`detectGmgn`, `saveGmgnApiKey`, `verifyGmgn`, `openGmgnOfficialLink`), never the complete legacy
   Coin bridge. Those channels accept only a live built/loopback Trench main frame so standalone
   and Omni work without granting other renderers the credential surface. Main registers this
   four-handler subset during foreground startup without activating the dormant legacy Coin IPC
   surface. Existing keys are never read back. A newly typed key exists only in the password field
   and one typed save request, is
   cleared after the attempt, and never appears in logs, errors, status, screenshots, or receipts.
4. Main executable discovery considers sanitized `PATH` entries plus exact
   `<home>/.yarn/bin`, deduplicates them, and retains executable-file checks. Renderer input cannot
   choose a CLI path. Native executables run directly. An env-node launcher in the exact Yarn bin
   is delegated to packaged Electron Node mode only after its real path equals the `gmgn-cli`
   package's declared bin under a fixed Yarn global package root. The sanitized child `PATH`
   remains unchanged; no user Node directory, arbitrary script delegation, login shell, broad
   filesystem search, trading command, or private-key fallback is allowed.
5. `Save and verify` validates the input, completes the existing atomic owner-only credential
   write, refreshes sanitized status, then invokes the existing bounded read-only probe. Save or
   probe failure keeps the modal open and maps the exact typed code. Verification never triggers an
   INDEX request.
6. `PROVIDER_UNAVAILABLE` in Add CA and the workspace exposes `Configure GMGN`. It opens the same
   modal above Add without clearing CA text. Closing settings returns to Add; Ral explicitly retries
   `Add and analyze`. Other INDEX errors do not show this action.
7. The modal and menu action work in standalone and Omni, including 398x568 and 800x282. At narrow
   width the header status label yields first; Agent, Refresh, and Settings remain visible. Modal
   controls remain keyboard reachable, pending-safe, and free of root overflow.
8. INDEX ranking/storage/schema, `trench-io`, legacy JSON, environment paths, and the exact 12
   public `trench.*` MCP tools remain unchanged.

## Verification

- Unit tests prove executable discovery finds an executable in `<home>/.yarn/bin` when absent from
  `PATH`, rejects a non-executable candidate and an unverified env-node script, and preserves
  current PATH resolution/sanitized env. A real process-runner regression uses a realistic Yarn
  package/bin symlink fixture and `PATH=/usr/bin:/bin:/usr/sbin:/sbin` to execute `--version`.
- Renderer/store tests prove blank non-readback input, sanitized status mapping, save-before-verify,
  typed failures, input clearing, pending deduplication, and no INDEX call during configuration.
- Static layout/i18n tests prove the named settings action, exact 32px/Todo parity, one shared modal,
  contextual provider recovery only, and no secret/SQLite/MCP surface changes.
- Fresh isolated DEBUG_DEV build plus focused Electron E2E launches with the same minimal desktop
  `PATH`, discovers a realistic Yarn env-node fixture, proves packaged Electron Node-mode
  `--version` execution, opens settings from the menu, verifies a fixture key through the existing
  bridge, opens the same settings from an Add provider failure,
  preserves the four-CA textarea, explicitly retries, and renders without overflow in standalone
  1360x860 and Omni 800x568, 398x568, and 800x282.
- Focused typechecks, Coin/INDEX unit suites, exact 12-tool MCP contract, renderer i18n, Omni
  embedding tests, `git diff --check`, and independent Verify review pass. DEBUG_PROD remains
  running and untouched.
