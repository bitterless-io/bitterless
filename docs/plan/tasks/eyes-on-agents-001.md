---
id: eyes-on-agents-001
scope: Codex-only standalone observation board, persistent App Server, Domains, Focus, and unread state
status: done
depends-on: []
---

# EyesOnAgents Vertical Slice

## Objective

Replace Coding-agent Sessions with a Codex-only EyesOnAgents Mini App that opens in a standalone
window, maintains a persistent managed App Server connection, classifies threads into Domains, and
derives Focus from running and newly completed unread work.

## Context

- `docs/integrations/eyes-on-agents.md`
- `docs/integrations/eyes-on-agents-layout.md`
- `docs/plan/analysis/eyes-on-agents.md`
- `docs/design/colors.md`
- Todo and Omni are interaction/window references only; their business stores and tables are not
  shared with EyesOnAgents.
- The working tree contains unrelated Todo/MCP changes. Preserve them and do not stage, format, or
  rewrite unrelated files or hunks.

## Required implementation

### Runtime and data

- Add dedicated EyesOnAgents shared types, validators, tables, DAO/repository, and idempotent legacy
  Codex import.
- Seed immutable `Uncategorized`; preserve assignment during sync; transactionally reassign on
  custom Domain deletion.
- Replace short-lived Codex discovery with one main-owned App Server supervisor using a shell-free
  stdio JSON-RPC handshake, paged thread sync, lifecycle notifications, connection status, and
  clean shutdown.
- Keep only the Codex portion of the optional lifecycle hook bridge and make its evidence source
  explicit.
- Persist completed/opened turn IDs and timestamps; derive Focus and unread exactly as specified.
- Validate every thread UUID and mark opened only after the canonical deep link succeeds.

### Window and renderer

- Add a singleton `EyesOnAgentsWindowHandler`, preload, renderer entry, Electron Vite inputs, auth
  cleanup, and app lifecycle integration.
- Add an EyesOnAgents Mini Apps card and remove the obsolete Home `coding-agents` route/page.
- Implement the horizontal board, fixed Focus projection, immutable Uncategorized column, custom
  Domain create/rename/reorder/delete, thread move, fallback Domain selector, connection panel, and
  truthful empty/error/loading states.
- Follow Electron-XPC, stable `name` attributes, shallow business BEM, sibling Less, Arco control,
  minimum-window, and reduced-motion conventions.
- Remove Claude UI copy, adapters, terminal/resume logic, hook setup branches, and tests from the
  active feature without touching unrelated `src/main/codex/*` runtime code.

### Documentation and cleanup

- Keep historical Coding-agent Sessions documents marked superseded.
- Update task status only after independent review and acceptance checks pass.
- Do not add a message composer, `turn/steer`, or a fake App Server queue method in this delivery.

## Expected paths

- `src/shared/eyesOnAgents/`
- `src/preload/sqlite/dao/eyesOnAgents*`
- `src/preload/eyesOnAgents/`
- `src/main/eyesOnAgents/`
- `src/main/xpc/eyesOnAgents*`
- `src/renderer/eyesOnAgents/`
- `src/renderer/home/src/views/miniApp/`
- `src/renderer/home/src/router/defaultRoutes.ts`
- `src/main/xpc/xpc.helper.ts`
- `src/main/xpc/auth.handler.ts`
- `src/main/app.main.ts`
- `src/preload/sqlite/sqlite.preload.ts`
- `electron.vite.config.ts`
- focused tests/scripts under `tests/` or `scripts/eyes-on-agents/`
- this task and its review documents

Legacy coding-agent paths may be deleted or reduced when no longer referenced. Do not modify
`src/main/codex/*`; it belongs to the Coin/Maestro runtime.

## Verification

- Unit/integration tests cover UUID/deep-link validation, JSON-RPC framing/handshake, paged sync,
  `notLoaded -> unknown`, active flags, completion/open identity, first-sync no-unread behavior,
  Domain persistence, Domain deletion reassignment, and process exit/error handling.
- Source/runtime tests cover singleton window creation, production-safe preload/renderer paths,
  XPC method arity, auth/app shutdown, Mini Apps launch, and no active Claude imports/copy.
- Renderer acceptance covers Focus ordering, successful-open read transition, drag/menu Domain
  movement, loading/empty/error states, minimum window size, and reduced motion.
- Run focused EyesOnAgents tests, related existing coding-agent/SQLite tests where retained,
  `yarn typecheck`, `yarn build`, `git diff --check`, and an Electron visual smoke check.
- Independent review must record findings in `docs/plan/reviews/eyes-on-agents-001-1.md`; blocking
  findings require a fix and a new review artifact.
