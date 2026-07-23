---
id: todo-mcp-domain-catalog-skill-version-007-1
target: HEAD-001dbae-plus-working-tree-2026-07-23
compared_with: todo-mcp-domain-catalog-skill-version-007
---

# Verdict

**PASS after resolving two P2 delivery-gate findings. No open P1, P2, or P3 finding remains.**

# Findings resolved

- **P2 — installed skill trees were stale:** the canonical `skills/bitterless-todo/` revision was
  initially newer than the workspace Codex/Claude trees and both user-level installed trees. The
  canonical tree was then copied additively to all four destinations. Final `diff -qr` checks are
  empty, and every copy parses with `metadata.version_code: "260723104233"` plus the single
  production `bitterless` stdio dependency.
- **P2 — archived-Domain update race:** the first implementation checked active state before the
  repository mutation, but `updateDomainDescription` could still update an archived Domain if an
  archive committed between that check and the write. The final implementation places
  `archived=0` on the update inside the Todoist Sync transaction, requires exactly one changed row,
  and throws so SQLite rolls back the version sequence and outbox when the precondition fails. The
  native test proves an archived rejection leaves description, outbox, and device sequence
  unchanged, then proves the same write succeeds after restore.

# Acceptance evidence

- `domain.list` keeps the `{ domains, focus }` contract, filters for `archived=0` and
  `is_deleted=0`, and validates every Domain row. The row guard requires the 20-digit ID, title,
  `description`, archive/delete flags, position, and integer timestamps.
- `domain.archived.list` exposes an empty-argument schema and exact `{ domains }` result. Its
  result contains only non-deleted `archived=1` rows, retains the same required fields including
  `description`, and has no virtual Focus member.
- `domain.description.update` requires a 20-digit decimal Snowflake ID and string description,
  trims the value, permits clearing, accepts 500 characters, and rejects 501 characters. It rejects
  archived, deleted, and missing rows, calls the real
  `TodoistSyncRepository.updateDomainDescription`, rereads through `getDomainById`, and validates
  the persisted active row before returning `{ domain }`.
- The native repository test proves a successful description update creates a pending
  `domain_update` outbox command with the updated description. The transactional active predicate
  additionally closes the archive race without changing title/archive/restore behavior.
- The read-only smoke path calls only `domain.list` and `domain.archived.list`; it never calls
  `domain.description.update` or any Todo write.
- The canonical skill frontmatter and application constant both use the quoted 12-digit revision
  `260723104233`. Export verification proves ZIP bytes match the complete canonical skill tree.
- Missing acknowledgement is atomically initialized with `INSERT ... ON CONFLICT DO NOTHING` and
  reread. A compare-and-set acknowledgment prevents two renderers from rolling a newer value back.
  The pure state checks cover baseline, old, equal, future, malformed, and non-string values. An
  additional runtime store check exercised concurrent initialization, current acknowledgment,
  future-version preservation, invalid storage, read failure, and compare-and-set failure.
- Initialization and refresh failures enter the visible `invalid` attention state instead of
  remaining in loading. A future stored revision returns before any write and is never downgraded.
- The renderer does not request MCP integration information to render the badge. Opening the guide
  requires the main-process `skillVersionCode` to exactly match the renderer constant; missing or
  stale responses are restart-required and cannot acknowledge the revision.
- Only `copyCompleteSetup` can acknowledge. It first requires a ready exact-version response and a
  successful clipboard write; clipboard failure returns before persistence. Modal open/close and
  the three detailed field-copy actions never call the acknowledgement store. Persistence failure
  leaves the attention state visible.
- Successful acknowledgment uses the dedicated
  `todo/agent-skill-version-updated` broadcast. Other Todo renderers refresh only the skill-version
  store; the subscriber does not reload Todo data or settings.
- The menubar uses Arco `a-badge` with its dot count driven by the attention state. The Robot
  button has state-specific localized tooltip/title/accessible text, so the warning does not rely
  on color alone.
- The Arco modal renders Complete setup directly below the summary/instance warning and before the
  visible Detailed instructions heading. Copy controls remain `IconBtn` with Tabler icons, styles
  remain in the sibling Less file with business BEM names, and all new text exists in English and
  Chinese i18n.
- Skill instructions preserve personal multi-device Todo semantics, production-only `bitterless`
  safety, duplicate avoidance, Focus policy, and explicit-only Domain creation. They define
  `domain.list` as the active semantic catalog, archived lookup as opt-in historical context, and
  description update as an explicit active-Domain-only write.

# Verification

- `yarn test:mcp:domain-catalog` — PASS, including public schemas, active/archive/deleted
  separation, required fields, trim/clear/500 limit, rejection paths, repository call, and reread.
- `yarn test:mcp:domain-create` — PASS.
- `yarn test:mcp:todo-smoke` — PASS, including exact read-only call history.
- `yarn test:mcp:agent-onboarding` — PASS.
- `yarn test:mcp:todo-skill-export` — PASS.
- `yarn test:todo:agent-skill-version` — PASS.
- Independent mocked-emitter runtime check for `todoAgentSkillStore` — PASS.
- `yarn test:todoist-sync` — PASS, 29/29 native tests after the transactional race fix.
- `yarn check:chat-composer` — PASS.
- `yarn check:renderer-i18n` — PASS.
- `yarn typecheck:mcp` — PASS after the race fix.
- `yarn typecheck:todo-web` — PASS.
- `yarn typecheck:node` — PASS after the race fix.
- Canonical plus four installed skill trees: `diff -qr` empty; SKILL frontmatter and
  `agents/openai.yaml` parsed with the project Node `yaml` library — PASS.
- `git diff --check` — PASS on the final shared working tree.

# Boundary and residual risk

The skill-creator Python quick validator could not start because the host Python lacks `PyYAML`;
the same frontmatter fields and OpenAI sidecar were parsed and asserted with the project's installed
Node `yaml` library instead. Per the task boundary, no Electron window, package, signing, publish,
or deployment command was run. Native visual placement and the operating-system clipboard remain
manual UI checks, but no source-, contract-, persistence-, or type-level blocker remains.
