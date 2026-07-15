---
id: coin-subapp-shell-001
scope: Coin window, scoped bridge, and local renderer shell
status: in-progress
depends-on: []
---

# Coin Sub-application Shell

## Objective

Add Coin to Mini Apps and deliver one authenticated singleton desktop window with a full-width local
analysis console. Establish lifecycle, geometry, language, security, navigation, and build entry
points without adding live analysis, resource writes, or a Codex runtime yet.

## Contract

- Follow [`coin.md`](../../features/coin.md), [`coin-layout.md`](../../features/coin-layout.md), and
  [`coin-subapp.md`](../analysis/coin-subapp.md).
- Add one bilingual Coin Mini App card, icon, and Open action with per-card loading. First Open boots
  once; repeated Open awaits/focuses the same window.
- Create one local Coin `BrowserWindow`, default `1360x860`, minimum `800x600`, with context
  isolation and no hidden SQLite window, browser view, remote page, Maestro preload, or Node access.
- Persist validated visible-display geometry and restore it on reopen. Initialize locale before Vue
  mount and follow Home language changes while alive.
- Add a minimal `window.coin` bridge and sender validation owned by the live Coin window. This task
  may expose typed state/window and placeholder status calls, but no arbitrary IPC or URL.
- Abort boot and destroy Coin explicitly on auth invalidation; await cleanup on quit/update.
- Render the five business tabs, full Resources page shell, Sources action, AI/source status,
  status footer, and responsive states from the layout contract. Placeholder content must be
  labelled unavailable, never presented as real analysis.
- Remove the superseded `CoinCodexPane`, split divider, chat copy, chat E2E assertions, and chat
  sizing. There must be no message list, composer, or visible Codex conversation surface.

## Paths

- `electron.vite.config.ts`
- `src/main/coin/`
- `src/main/xpc/coinWindow.handler.ts`
- `src/main/xpc/xpc.helper.ts`
- `src/main/xpc/auth.handler.ts`
- `src/main/app.main.ts`
- `src/preload/coin/`
- `src/shared/coin/`
- `src/renderer/coin/`
- `src/renderer/home/src/views/miniApp/`
- `src/renderer/home/src/emitter/`
- `src/renderer/common/i18n/`
- `tests/coin/`

## Verification

- Run focused singleton, sender-denial, geometry, language, auth-cleanup, and quit-cleanup tests.
- Run `yarn typecheck:node`, focused Coin renderer typecheck, `yarn build`, and `git diff --check`.
- Launch through Home and inspect screenshots at `1360x860` and `800x600`; verify one full-width local
  renderer, all controls fit, and no chat/split/remote/browser UI exists.
