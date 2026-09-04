---
id: eyes-on-agents-drop-setup-command-096
scope: Remove the Copy setup command action and replace it with a correct, complete wrapper recipe in the guidance note
status: ready
depends-on: [eyes-on-agents-claude-title-provenance-095]
verify: focused EyesOnAgents contract/service/render unit tests, Core strict typecheck, UI strict typecheck; no Electron
---

# EyesOnAgents Drop Copy Setup Command

## Objective

Owner verdict, twice (2026-09-04): the **Copy setup command** action task 089 shipped is pointless —
「setup cmd 是这样的有意义么我感觉没意义」. He is right, and it is worse than pointless:

- **It is incomplete in the way that matters.** His real wrapper (`/usr/local/bin/claude2`) also
  `unset`s `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` and `CLAUDE_CODE_OAUTH_TOKEN` so the second
  environment authenticates with its **own** Claude login. The emitted snippet does not. A user with
  a shell-level API key who pastes it gets a `claude2` that silently runs as the **first** account —
  defeating the single reason multi-environment exists ("一台机器登录多个 claude").
- **It assumes a shape most setups do not use.** It emits a shell *function* for a profile: a hard
  syntax error in fish and nushell, invisible to non-interactive spawns, and not what the owner
  actually uses (a `PATH` script, which is shell-agnostic and works from anywhere).
- Bitterless cannot install a wrapper anyway; it only ever put text on the clipboard. Shipping a
  subtly-wrong convenience is worse than shipping none.

Remove the action. Put the **correct and complete** recipe in the guidance note, as text to read.

## Required behavior

- Delete the action end to end: the `Copy setup command` button and its handler/copied-state in
  `ClaudeEnvironmentCard.vue`, `copyClaudeEnvironmentSetupCommand` from the renderer store, the
  `EyesOnAgentsApi` member, the XPC handler method, the `EyesOnAgentsService` method, and
  `buildEyesOnAgentsClaudeEnvironmentSetupCommand` /
  `deriveEyesOnAgentsClaudeEnvironmentFunctionName` and their reserved-word/quoting helpers from
  `eyesOnAgents.contract.ts`. Remove `scripts/eyes-on-agents/claude-environment-setup-command.test.mjs`'s
  setup-command tests and its `package.json` wiring **only if** nothing else in that file survives —
  task 091/092's parser and label-derivation tests live there and **must be kept**.
- Remove the i18n keys the deletion orphans (`copySetupCommand`, and `copied` **only** if the
  `/reload-plugins` copy action no longer uses it — check before deleting) from both `en.ts` and
  `zh.ts`, keeping key order identical.
- **Rewrite the guidance note** (`claudeEnvironment.guidance`) so it carries what a user actually
  needs, in both languages. It must state: each environment needs its own hook install; the command
  used for that environment must set `CLAUDE_CONFIG_DIR` before invoking `claude`; **and** that it
  should clear `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` / `CLAUDE_CODE_OAUTH_TOKEN` so the
  environment uses its own login rather than inheriting a shell-level credential. Keep it short
  enough for the existing aside — if the full recipe does not fit as prose, prefer a compact
  `PATH`-script form over a shell function, because that shape works from any shell and from
  non-interactive callers.
- Do not reintroduce a picker, a file writer, or any "install this for me" affordance. Bitterless
  states the requirement; the user owns their shell.

## Non-goals

- Detecting whether a wrapper already exists, or validating the user's shell configuration. Task
  090's per-environment plugin probe already answers "is this directory set up"; the wrapper is
  outside what Bitterless can observe.
- Changing anything about the environment list, the inline path editor, or the plugin probe.
- Reverting task 091's `parseEyesOnAgentsAddClaudeEnvironmentParams` /
  `deriveEyesOnAgentsClaudeEnvironmentLabel` — those are the add flow and stay.

## Path

- `src/shared/eyesOnAgents/eyesOnAgents.contract.ts`, `src/shared/eyesOnAgents/eyesOnAgents.type.ts`
- `src/main/eyesOnAgents/eyesOnAgents.service.ts`, `src/main/xpc/eyesOnAgents.handler.ts`
- `src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts`
- `src/renderer/eyesOnAgents/src/components/ConnectionPanel/ClaudeEnvironmentCard.vue`
- `src/renderer/common/i18n/en.ts`, `src/renderer/common/i18n/zh.ts`
- `scripts/eyes-on-agents/claude-environment-setup-command.test.mjs`,
  `scripts/eyes-on-agents/claude-environment-render.test.mjs`,
  `scripts/eyes-on-agents/ui-source.test.mjs`, `package.json` (test wiring, only if a file is removed)
- `docs/plan/tasks/eyes-on-agents-claude-env-copy-setup-089.md` (record that it was removed and why),
  `docs/features/eyes-on-agents-claude-multi-environment.md`,
  `docs/integrations/eyes-on-agents-layout.md`, `docs/plan/backlog.md` (drop the now-moot 089 entries)

## Verify

- `yarn typecheck:eyes-on-agents:core`, `yarn typecheck:eyes-on-agents:ui`
- `yarn test:eyes-on-agents:claude`, `yarn test:eyes-on-agents:ui`
- `yarn eslint` on each touched file — no new errors.
- `ui-source.test.mjs` asserts things about this action and about the `configDirectory` exclusivity
  file list. Update them to the post-removal truth; **do not** weaken the negative exclusivity
  assertion into a positive match (task 091's review caught that failure mode once already).
- Confirm no orphaned i18n key and no dead export remains: grep for `setupCommand`,
  `SetupCommand`, `FunctionName` across `src/` and `scripts/` and report the result.
- Do **not** run Electron, packaged builds, Playwright, or any `test:e2e:*` suite.
- Two pre-existing failures are not this task's: the deterministic `ui-source.test.mjs` bundle-id
  assertion, and the ~6/10 flaky `thread-card-open-capability.test.mjs` right-click test.
