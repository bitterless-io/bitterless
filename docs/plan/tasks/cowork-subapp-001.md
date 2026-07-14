---
id: cowork-subapp-001
scope: desktop Cowork sub-application runtime and host integration
status: done
depends-on: []
verify:
  - Mini Apps opens one independent Cowork window and repeated Open focuses it
  - Home, operation, Control, Workbench, and hidden SQLite render surfaces are wired
  - Cowork feature runtime from upstream commit 689832d is present
  - Cowork data, Chromium session, and XPC collision points are isolated
  - Fixed legacy SQLCipher keys, derivable CLI keys, credential-bearing proxy logs, and unrecoverable proxy side effects are absent
  - Bitterless owns update, quit, menu, shortcuts, auth cleanup, and packaging
  - Electron remains pinned to 40.10.6 and unrelated working-tree changes are preserved
  - yarn typecheck:node
  - yarn typecheck:web
  - yarn build
---

# Embed Cowork Runtime As A Bitterless Mini App

## Objective

Vendor and integrate the complete Micromeet Cowork main-window runtime from commit `689832d` as an
independent Bitterless Mini App. Preserve all currently implemented Cowork functions while replacing
standalone application lifecycle responsibilities with Bitterless-owned adapters.

## Context

- `docs/INDEX.md`
- `docs/features/README.md`
- `docs/features/cowork-subapp.md`
- `docs/plan/analysis/cowork-subapp-migration.md`
- Source: `../micromeet-cowork/apps/cowork/src/`
- Source CLI: `../micromeet-cowork/apps/cli/`
- Todo opening reference: `src/main/xpc/todoWindow.handler.ts`

## Path

- `docs/features/cowork-subapp.md`
- `docs/plan/analysis/cowork-subapp-migration.md`
- `docs/plan/tasks/cowork-subapp-001.md`
- `src/cowork/**` or an equivalently explicit Cowork namespace
- `src/main/app.main.ts`
- `src/main/xpc/xpc.helper.ts`
- `src/main/xpc/auth.handler.ts`
- `src/main/updateHelper/**`
- `src/renderer/home/src/views/miniApp/**`
- `src/renderer/home/src/emitter/**`
- `src/renderer/common/i18n/en.ts`
- `src/renderer/common/i18n/zh.ts`
- `src/renderer/common/assets/icons/**`
- `electron.vite.config.ts`
- `electron-builder.tmp.yml`
- `package.json`
- `yarn.lock`
- `packages/micromeet-cli/**`
- packaging/CLI preparation scripts required by this task

## Implementation constraints

- Do not copy or execute Cowork's standalone `app.main.ts` lifecycle.
- Do not copy `.env` files, generated `out/dist/release/build/tools`, credentials, signing data, or
  standalone publish configuration.
- Preserve the unrelated in-progress Electron compatibility edits in `package.json`, `yarn.lock`, and
  `docs/plan/tasks/pin-electron-sqlite-compatibility.md`. Electron must remain exactly `40.10.6`.
- Use Yarn for every package operation. Merge dependencies surgically; do not replace Bitterless's
  manifest or lockfile with Cowork's.
- Namespace Cowork aliases, persistent paths, Chromium partition, and colliding XPC handlers.
- Scope Cowork Cmd/Ctrl+T/W behavior to Cowork web contents. Cowork must not replace the application
  menu or own Cmd/Ctrl+Q.
- Adapt the Cowork Update surface to Bitterless's updater/feed and package identity.
- Start with a new encrypted Cowork profile: remove fixed legacy SQLCipher fallback and fail closed
  when a database exists without its generated key. Packaged builds must never accept test keys.
- Replace email/constant-derived CLI credential encryption with a random local key, restrictive file
  permissions, and an authenticated v2 envelope interoperable between main runtime and bundled CLI.
- Redact proxy credentials. Preserve upstream HTTP(S)/ALL proxy support with an idempotent Cowork
  lifecycle adapter that restores the prior Undici dispatcher only when it still owns the slot.
- Disable main bytecode as required by Cowork dynamic imports and CDP function serialization.
- Add the Cowork card with both English and Chinese translations.
- Preserve upstream layout and behavior; no opportunistic architecture rewrite of the large
  `coworkWindow.helper.ts` composition root.

## Verification

1. `git diff --check`
2. `yarn typecheck:node`
3. `yarn typecheck:web`
4. `yarn build`
5. Inspect build output for Cowork Home, Control, Workbench, SQLite, and preload entries.
6. Confirm no source credential/generated binary was added.
7. Confirm package/lock diff retains Electron `40.10.6` and the pre-existing package-name hunk.
