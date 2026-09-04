---
id: mcp-preview-edition-is-real-123
scope: treat the Preview edition as a real MCP instance across onboarding instructions, bundled skills, and setup docs
status: implemented; owner verification pending
depends-on: [release-preview-channel-007]
verify: yarn test:mcp:agent-onboarding && yarn test:todo:agent-skill-version && node --test tests/onlypreview/onlyPreviewAgentSkill.test.mjs tests/coin/trenchAgentGuide.test.mjs && yarn typecheck:node && git diff --check
---

# Make the Preview edition a real MCP instance for agents

## Objective

Let a machine with only the Preview edition installed run the Bitterless agent skills, without
weakening the rule that development builds are never registered as real instances.

## Context

- `docs/issues/preview-edition-treated-as-test-instance.md`
- `docs/features/desktop-release-channels.md` (Preview owns its own MCP endpoint)
- `src/shared/mcp/mcpBridge.shared.ts` (`getMcpServerName`)

## Path

- `src/shared/mcp/mcpBridge.shared.ts`
- `src/main/onlypreview/onlyPreviewAgentSkill.service.ts`
- `src/main/mcp/mcpAgentOnboarding.service.ts`
- `src/main/mcp/trenchAgentOnboarding.service.ts`
- `skills/bitterless-{preview,todo,trench}/SKILL.md` and their `references/mcp-setup.md`
- `src/shared/{onlypreview/onlyPreviewAgentSkillVersion,mcp/todoAgentSkillVersion,trench/trenchAgentSkillVersion}.shared.ts`
- `scripts/mcp/agent-onboarding.test.mjs`, `scripts/todo/todo-agent-skill-version.test.mjs`,
  `tests/onlypreview/onlyPreviewAgentSkill.test.mjs`, `tests/coin/trenchAgentGuide.test.mjs`
- overmind `CLAUDE.md` + `AGENTS.md` (outside this repo, same change)

## Contract

- One classifier decides which server names are real. The three onboarding services phrase the
  consequence in their own domain but never disagree about the classification.
- `bitterless` → production, `bitterless-preview` → preview, everything else → development. The
  development branch refuses registration under either real name.
- Guidance prefers `bitterless` when both editions are configured, and works when only one is.
- Setup documentation names each edition's concrete helper path for macOS and Windows, so a
  Preview-only machine needs no Production install to copy from.
- Bump every changed skill's `version_code` together with its paired shared constant, so an
  installed copy reports update-required.
- Sync each changed skill to `.claude/skills/`, `.agents/skills/`, `~/.codex/skills/`, and
  `areas/skills/` additively, and prove the trees match.
- Change `CLAUDE.md` and `AGENTS.md` in the same change, as the shared-rule convention requires.
- Do not change channel derivation, bridge endpoints, storage isolation, or any tool contract.

## Verification

- Onboarding fixtures prove a Preview server name yields a real-edition instruction with no
  "test instance" wording, in all three domains.
- Fixtures prove a development server name still yields the test-instance instruction and now
  refuses both real names.
- Skill-version fixtures prove the bumped codes and the frontmatter agree.
- `diff -qr` proves every skill tree matches the bundled source.
- Do not run Electron, Playwright, packaging, signing, or publication.

## Delivery

- Added `classifyMcpServerName()` / `McpServerKind` and a `preview` branch in all three services.
- Rewrote the server-name rules in the three `SKILL.md` files and their `references/mcp-setup.md`,
  adding a per-edition helper-path table plus separate Production and Preview registration commands.
- Bumped all three skills to `260904151653` with their paired constants and test literals.
- Synced and verified all four skill trees; updated `CLAUDE.md` and `AGENTS.md` together.
- `mcpAgentOnboarding.service.ts` imports the classifier by explicit relative `.ts` specifier, not by
  alias: `scripts/mcp/agent-onboarding.test.mjs` loads that file directly with raw Node, which
  resolves no path aliases and requires the extension. Noted inline so it is not "corrected" later.

## Verification result

- `yarn test:mcp:agent-onboarding` — passed, including the new Preview fixture.
- `yarn test:todo:agent-skill-version` — passed after bumping the pinned literals and the
  future-version fixture.
- `node --test tests/onlypreview/onlyPreviewAgentSkill.test.mjs tests/coin/trenchAgentGuide.test.mjs`
  — 12/12, including the two new Preview fixtures.
- `yarn typecheck:node` — 0 errors.
- `diff -qr` — all four skill trees byte-identical with the bundled source; frontmatter YAML parses
  everywhere except the pre-existing, unrelated `.agents/skills/3x-ui-admin/SKILL.md`.
- No Electron, Playwright, packaging, signing, or publication ran.

## Owner Verification

- On the Preview-only machine, open the Preview Guide, copy the instruction, and confirm it names
  `bitterless-preview` as a real edition rather than a test instance.
- Install the refreshed skills from that Guide and confirm an agent will preview a file and read or
  write a Todo without objecting to the server name.
