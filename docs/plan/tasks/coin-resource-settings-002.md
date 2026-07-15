---
id: coin-resource-settings-002
scope: Coin Resources page, secure configuration, and local GMGN probe
status: implemented-owner-verification-pending
depends-on: [coin-subapp-shell-001]
---

# Coin Resource Settings

## Objective

Make Resources operational for Codex account status, GMGN CLI installation/API-key verification,
Alchemy endpoints, and source-service readiness without exposing a secret or arbitrary command to
the renderer.

## Contract

- Follow the Resources contracts in [`coin.md`](../../features/coin.md),
  [`coin-layout.md`](../../features/coin-layout.md), and [`gmgn-cli.md`](../../guides/gmgn-cli.md).
- Extract a host-owned `CodexCredentialService`, preserving `userData/cowork/pi/auth.json`, and make
  Maestro delegate Codex status/connect/disconnect without changing AI-CRMS behavior.
- Resources is the only Coin page that starts Codex connect/disconnect. There is no chat UI or
  provider selector.
- Detect `gmgn-cli` path/version without a shell. Missing state shows a copyable
  `yarn global add gmgn-cli` command, Recheck, local guide, and official link.
- Save only `GMGN_API_KEY` to `~/.config/gmgn/.env` with directory `0700` and file `0600`. Never ask
  for, write, inherit, or execute with `GMGN_PRIVATE_KEY`.
- Verify GMGN with one fixed read-only command via shell-free process execution, sanitized env/error,
  timeout, output cap, cancellation, and a strict command allowlist. Renderer cannot supply command,
  path, flags, or environment.
- Encrypt Alchemy HTTP/WSS values with Electron `safeStorage` into an owner-only Coin resource file.
  Return only configured/masked/probe metadata. Validate chain and URL scheme.
- Validate non-secret service bases and report readiness. Production overrides require HTTPS.
- Every connect/save/recheck/test action has local loading, duplicate protection, and feedback.

## Paths

- `src/main/codex/`
- `src/main/maestro/llm/`
- `src/main/coin/resources/`
- `src/main/coin/coinIpc.service.ts`
- `src/shared/coin/`
- `src/preload/coin/`
- `src/renderer/coin/src/views/resources/`
- `src/renderer/coin/src/`
- `tests/coin/`
- `docs/guides/gmgn-cli.md`

## Verification

- Verify compatibility-path Codex auth and one login mutex across Maestro/Coin.
- Verify GMGN absent/installed/key-save/probe/timeout/error/cancel paths, exact file modes, redaction,
  fixed allowlist, shell false, and rejection of private-key/trading/arbitrary command inputs.
- Verify safeStorage unavailable/encrypt/decrypt/invalid-file/masked-status paths for Alchemy.
- Run focused tests, Coin renderer typecheck, `yarn typecheck:node`, `yarn check:maestro`, `yarn build`,
  `git diff --check`, and Resources screenshots at both target sizes.

## Result

- Added the shared Codex credential service and Maestro delegation while preserving the compatibility
  auth path and non-Codex provider behavior.
- Added sender-scoped Resources IPC, GMGN detection/key storage/fixed read-only probe, encrypted
  Alchemy endpoints/probes, validated service endpoints, masked status contracts, responsive
  bilingual UI, installation guide, and request loading states.
- Focused resource tests passed `31/31`; Coin renderer/Node/i18n checks and production build passed
  before the owner stopped further self-testing. `yarn check:maestro` retained six pre-existing alias
  findings in unchanged Maestro renderer files.
- The interrupted Electron run loaded Coin HTML but did not mount `.coin-app`. Static hardening now
  bounds language initialization to five seconds, mounts with an explicit degraded fallback instead
  of a blank window, and makes store/listener failures visible. Per owner instruction, no test command
  was run after this change.
- Final Electron/Resources verification is intentionally assigned to the owner's configured local
  run after GMGN and Alchemy setup.
