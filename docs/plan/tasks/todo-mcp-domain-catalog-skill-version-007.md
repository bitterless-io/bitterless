---
id: todo-mcp-domain-catalog-skill-version-007
scope: active/archived MCP Domain discovery, Domain descriptions, and versioned Todo agent-skill onboarding
status: in-progress
depends-on: [todo-agent-skill-onboarding-002, todo-mcp-domain-create]
verify:
  - domain.list returns only active non-deleted Domains and includes description
  - domain.archived.list returns only archived non-deleted Domains and includes description
  - domain.description.update updates an active Domain through the sync repository and returns its reread
  - Todo startup atomically persists a missing skill-version baseline and derives the menubar attention state
  - successful Complete setup copy acknowledges the current skill revision; other modal actions do not
  - Complete setup instructions render before Detailed instructions
  - canonical and installed Codex/Claude bitterless-todo skill trees are byte-identical
  - yarn test:mcp:domain-catalog
  - yarn test:mcp:agent-onboarding
  - yarn test:mcp:todo-skill-export
  - yarn test:todo:agent-skill-version
  - yarn check:chat-composer
  - yarn check:renderer-i18n
  - yarn typecheck:mcp
  - yarn typecheck:todo-web
  - yarn typecheck:node
---

# MCP Domain Catalog And Todo Skill Revision

## Objective

Make active Domain discovery the safe MCP default, add an explicit archived catalog, allow an
agent to update an active Domain description, and version the portable `bitterless-todo` skill so
Todo can visibly prompt Ral when the current setup instructions need to be copied again.

## Context

- `docs/features/todo-mcp.md`
- `docs/plan/tasks/todo-mcp-domain-create.md`
- `docs/plan/tasks/todo-agent-skill-onboarding-002.md`
- `doc/plan/tasks/todo-domain-description-mcp-policy.md` (historical policy superseded by this task)
- `skills/bitterless-todo/`

## Path

- `src/main/mcp/mcpStdio.helper.ts`
- `src/main/mcp/mcpBridge.server.ts`
- `src/main/todoistSync/todoistSync.repository.ts` only if its existing public methods need a
  contract-safe adjustment; do not add direct MCP SQL
- `src/shared/mcp/**`
- `src/preload/sqlite/dao/setting.dao.ts`
- `src/renderer/todo/src/store/todoAgentSkill.store.ts`
- `src/renderer/todo/src/components/MenuBar/**`
- `src/renderer/todo/src/components/McpGuideModal/**`
- `src/renderer/todo/src/xpc/update.subscriber.ts`
- `src/renderer/common/i18n/en.ts`
- `src/renderer/common/i18n/zh.ts`
- `skills/bitterless-todo/**`
- focused MCP, onboarding, export, renderer, and skill-version tests under `scripts/`
- affected Yarn scripts only
- `.agents/skills/bitterless-todo/`, `.claude/skills/bitterless-todo/`,
  `~/.codex/skills/bitterless-todo/`, and `~/.claude/skills/bitterless-todo/` by additive copy after
  the canonical skill passes verification

## Public MCP contract

- Preserve `domain.list` input `{}` and output `{ domains, focus }`; add a regression gate proving
  it filters `archived=1` and deleted rows and retains `description` plus the other required fields.
- Add `domain.archived.list` with input `{}` and output `{ domains }`. It returns only
  `archived=1`, non-deleted rows and does not return the virtual Focus projection.
- Add `domain.description.update` with required `{ id, description }`. `id` is a 20-digit decimal
  Snowflake string; `description` is trimmed and limited to 500 characters, including an empty
  string for clearing.
- Description updates are active-Domain-only. Reject archived, deleted, and missing IDs. This keeps
  archived `updated_at` from being misrepresented by the existing UI as an archive timestamp.
- Execute updates through `TodoistSyncRepository.updateDomainDescription`, reread the row, validate
  the persisted description, and return `{ domain }`. This is required for the existing outbox,
  renderer refresh, and HTTP synchronization behavior.
- Preserve every existing tool name and response shape.

## Skill revision contract

- Set the current revision to the quoted 12-digit string `260723104233` in
  `SKILL.md` frontmatter under `metadata.version_code` and in one shared hard-coded application
  constant. The export test must prove they match.
- Persist local acknowledgement in the existing Core SQLite `setting` table at
  `todo_agent_skill / acknowledged_version_code`; no schema migration or new database is needed.
- On Todo startup, atomically insert baseline `000000000000` only when absent, reread it, and expose
  `loading`, `install-required`, `update-required`, `current`, and non-downgrading `future` states.
  Invalid/unreadable values retain attention and must not masquerade as current.
- Show the red dot for install/update/invalid attention. Tooltip and accessible name must explain
  the state instead of relying on color alone.
- Do not call `getIntegrationInfo()` merely to render the badge because it refreshes the helper
  shim. When the guide is opened, require the main process to return the exact current
  `skillVersionCode`; missing/mismatched values remain restart-required.
- Move Complete setup instructions directly below summary/warnings and before a visible Detailed
  instructions heading. Preserve the existing Arco Modal, `IconBtn`, Tabler icon, business BEM,
  constrained body scroll, and DEBUG-instance warning.
- A successful top-level Complete setup clipboard copy stores its exact version and clears the dot.
  Modal open/close, individual field copies, and clipboard/persistence failures do not acknowledge
  the revision. Never overwrite a stored future revision with an older application revision.
- Broadcast successful acknowledgement on a dedicated event so other Todo renderers reload only
  the skill-version state, not all Todo settings/data.

## Portable skill contract

- Explain that `domain.list` is the default active catalog and includes descriptions used for
  semantic placement.
- Document `domain.archived.list` as opt-in read-only historical context whose rows are not Todo
  targets.
- Document `domain.description.update` as an explicit, active-Domain-only write.
- Preserve personal multi-device Todo semantics, duplicate avoidance, Focus policy, explicit-only
  Domain creation, and the production-only `bitterless` MCP dependency.
- After tests pass, update installed copies additively. Restart/new Codex and Claude sessions are
  required to load the new skill text; no other skill directories may be removed.

## Verification

1. Exercise public stdio MCP schemas and structured responses against a deterministic repository
   fixture, including active/archive/deleted separation, required fields, trim/clear, limit,
   missing/archived rejection, and persisted reread.
2. Exercise version state and SQLite-write policy independently: baseline creation, older/equal/
   future/invalid values, no downgrade, clipboard failure, unrelated copies, persistence failure,
   exact-version acknowledgement, and cross-renderer refresh.
3. Guard modal ordering, Arco badge usage, accessible state text, stale-main rejection, skill
   metadata, export bytes, and mirror equality.
4. Run the focused commands in the frontmatter plus `git diff --check`. Do not start Electron,
   package, sign, publish, or deploy in this task.

## Result

Pending implementation and independent review.
