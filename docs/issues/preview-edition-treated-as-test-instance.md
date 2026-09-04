# Agent onboarding calls the Preview edition a test instance

Status: implemented; owner verification pending

## Observed behavior

Ral is planning a machine with **only** the Preview edition installed and asked whether agents can
use Bitterless there. The channel isolation is complete, but every piece of guidance told the agent
not to use it.

The MCP server name is derived from `app.getName()`
(`src/shared/mcp/mcpBridge.shared.ts:27-37`), which `scripts/before.js` sets per channel:

| Channel | app name | MCP server name |
|---|---|---|
| Stable | `Bitterless` | `bitterless` |
| Preview | `Bitterless_PREVIEW` | `bitterless-preview` |
| Development | `Bitterless_DEV` | `bitterless-dev` |
| Debug | `Bitterless_DEBUG_PROD` / `Bitterless_DEBUG_DEV` | `bitterless-debug-prod` / `bitterless-debug-dev` |

Each edition serves its own bridge under its own `userData`
(`<userData>/mcp/bridge.sock`, or a `userData`-hashed named pipe on Windows), so two editions can
never share a socket. Verified on disk: both
`~/Library/Application Support/Bitterless/bin/bitterless-mcp` and
`~/Library/Application Support/Bitterless_PREVIEW/bin/bitterless-mcp` exist and belong to their own
edition.

Three things then classified `bitterless-preview` as development-only.

1. **The copied setup instruction contradicted the Guide window.** `App.vue:84-86` already branched
   on `serverName === 'bitterless-preview'` to show `previewChannelMountGuide`. But the text the
   agent actually receives is `info.instruction`
   (`onlyPreviewGuide.store.ts:61` copies exactly that), and
   `createInstanceSafetyInstruction` branched only on `serverName === 'bitterless'`, so Preview fell
   into: *"The current `bitterless-preview` MCP server is a test instance for development
   verification only. Do not register it as `bitterless`."* The same two-branch shape existed in
   `mcpAgentOnboarding.service.ts:44-52` (Todo) and `trenchAgentOnboarding.service.ts:68-76`.
2. **The bundled skills pinned production to `bitterless`.** `bitterless-preview/SKILL.md` stated
   "The production MCP server name is `bitterless`" and "Use `bitterless` for real work"; the Todo
   and Trench skills said the same, and `bitterless-todo/references/mcp-setup.md` went further:
   "The production server name must remain `bitterless` because the portable skill depends on that
   exact name." On a Preview-only machine a compliant agent had no sanctioned server.
3. **The workspace rules pinned it too.** overmind `CLAUDE.md` / `AGENTS.md` required "the
   production `bitterless` MCP" for both preview and Todo work.

## Required behavior

- `bitterless` and `bitterless-preview` are both real, shipped editions holding the user's own data
  in separate storage. Agent guidance accepts either, and prefers `bitterless` when both are
  configured.
- `bitterless-dev`, `bitterless-debug-prod`, and `bitterless-debug-dev` stay test-only, and nothing
  may be registered under a real name.
- Which names are real has **one** definition. The three onboarding services phrase the consequence
  in their own domain — Preview, Todo, Trench — but may never disagree about the classification.
- The setup documentation names each edition's concrete helper path, so a Preview-only machine can
  be configured without a Production install to copy from.

## Delivery

- Added `classifyMcpServerName()` / `McpServerKind` to `src/shared/mcp/mcpBridge.shared.ts` as the
  single classifier, and gave all three onboarding services a `preview` branch that states the
  edition is real, names its own storage, and points at `bitterless` for a later Production install.
- The development branch now refuses registration under **either** real name.
- Rewrote the server-name rules in all three bundled `SKILL.md` files and their
  `references/mcp-setup.md`, including a per-edition helper-path table and separate Production and
  Preview registration commands for macOS and Windows.
- Bumped all three skill `version_code` values to `260904151653` with their paired shared constants,
  so an already-installed skill reports update-required and the Guide reinstalls it.
- Synced the three skills to `.claude/skills/`, `.agents/skills/`, `~/.codex/skills/` and
  `areas/skills/bitterless-preview/`, verified byte-identical with `diff -qr`.
- Updated overmind `CLAUDE.md` and `AGENTS.md` together, as the shared-rule convention requires.

Deliberately **not** changed: `App.vue:84-86` still compares the literal `'bitterless-preview'`
rather than calling the shared classifier, because a source-level test pins that exact line. It is a
second literal for the same rule and worth folding in when that test is next touched.

## Acceptance

| Scenario | Expectation |
|---|---|
| Preview Guide's copied instruction | Names Preview a real edition; no "test instance" wording |
| Todo / Trench Guide on Preview | Same, in each domain's own words |
| Any `bitterless-dev*` / `bitterless-debug*` | Still "test instance"; refuses both real names |
| Preview-only machine | Setup docs give the `Bitterless_PREVIEW` helper path directly |
| Both editions configured | Guidance prefers `bitterless` |

Implementation task:
[mcp-preview-edition-is-real-123](../plan/tasks/mcp-preview-edition-is-real-123.md).
