id: eyes-on-agents-project-filter-003
scope: EyesOnAgents Project metadata and Uncategorized filtering
status: done
depends-on: [eyes-on-agents-focus-002]

# Objective

Derive and persist nearest-Git-worktree Project metadata for Codex threads, then add an
Uncategorized-only `All` / `No project` / per-Project filter without changing Focus or Domain
assignment.

# Context

- `docs/INDEX.md`
- `docs/features/eyes-on-agents-project-filter.md`
- `docs/integrations/eyes-on-agents.md`
- `docs/integrations/eyes-on-agents-layout.md`
- `docs/plan/analysis/eyes-on-agents.md`

# Path

- `src/main/eyesOnAgents/`
- `src/shared/eyesOnAgents/`
- `src/preload/sqlite/dao/eyesOnAgents.*`
- `src/preload/sqlite/sqlite.preload.ts`
- `src/renderer/eyesOnAgents/`
- `src/renderer/common/i18n/en.ts`
- `src/renderer/common/i18n/zh.ts`
- `scripts/eyes-on-agents/`
- `docs/features/eyes-on-agents-project-filter.md`
- `docs/integrations/eyes-on-agents.md`
- `docs/integrations/eyes-on-agents-layout.md`
- `docs/plan/tasks/eyes-on-agents-project-filter-003.md`
- `docs/plan/reviews/eyes-on-agents-project-filter-003-*.md`

# Verification

- Resolver tests cover repo root/child, nested repo, `.git` directory/file, symlink, non-Git,
  unavailable paths, and macOS/Windows key normalization.
- Repository tests cover fresh/old schema, idempotent migration, write/update/clear/preserve
  semantics, hook-created rows, and unchanged Domain assignment.
- Renderer tests cover `All`, `No project`, exact Project, counts, duplicate-name labels, zero-result
  state, and isolation from Focus/custom Domains.
- `yarn test:eyes-on-agents`
- `yarn typecheck:eyes-on-agents:core`
- `yarn typecheck:eyes-on-agents:ui`
- `yarn build`
- `git diff --check`
