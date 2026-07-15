---
id: todo-mcp-smoke-cli-and-skill
scope: todo MCP operator tooling
status: done
depends-on: []
---

# Todo MCP Smoke CLI And Agent Skill

## Objective

Provide a deterministic CLI that verifies Bitterless Todo writes through the public MCP stdio
boundary, then package the operating rules as a `bitterless-todo` skill so Codex can discover and
use the MCP tools correctly without re-reading the implementation.

## Context

- `src/main/mcp/mcpStdio.helper.ts` defines the public MCP tool names and schemas.
- `src/main/mcp/mcpBridge.server.ts` dispatches MCP calls into the running Bitterless GUI and DAO.
- `src/main/xpc/mcp.handler.ts` generates the stable `bitterless-mcp` helper shim.
- `doc/bitterless-mcp-communication.html` describes the local-only stdio-to-bridge architecture.
- The overmind root `AGENTS.md` defines three-way skill mirroring and YAML validation rules.

## Path

- Add a dependency-free Node CLI under `scripts/mcp/` and expose it through a Yarn script.
- Talk to the configured `bitterless-mcp` command over MCP stdio; never read SQLite directly.
- Resolve an existing domain with `domain.list` before writing. Do not create or modify domains.
- Run create, get, update, complete, status, uncomplete, and delete checks in sequence.
- Use a unique non-important smoke title and clean up the created todo by default; support `--keep`
  for visual inspection in the Bitterless UI.
- Fail with a non-zero exit code and a concrete recovery message on missing helper, unavailable GUI
  bridge, ambiguous/missing domain, protocol error, assertion failure, or timeout.
- Create the `bitterless-todo` skill under overmind `.agents/skills/`, mirror it byte-for-byte into
  `.claude/skills/`, and sync it into `~/.codex/skills/` with Codex UI metadata.

## Verification

- CLI `--help` and invalid-input checks.
- Automated MCP lifecycle test using a deterministic stdio fixture.
- Read-only handshake against the real development helper when available.
- Live write lifecycle against a running Bitterless bridge when available; otherwise report the
  exact external runtime blocker.
- `yarn build`.
- `git diff --check` in both the Bitterless submodule and overmind root.
- Skill quick validation, strict YAML parsing, and byte-identical three-way directory comparison.

## Result

- Added `yarn mcp:todo:smoke`, a dependency-free MCP stdio CLI with read-only probing, configurable
  existing-domain selection, a full Todo write lifecycle, default cleanup, and optional `--keep`.
- Added deterministic fixtures for the happy path, uncertain/malformed create responses, delayed
  commits, wrong response IDs, unrelated same-title rows, ambiguous owned rows, non-zero helper
  exits, and helpers that do not terminate after stdin closes.
- Made cleanup ownership-safe with a full UUID marker in title and note, read-before-delete checks,
  an 11-second default bridge settlement window, delete/status confirmation, and fail-closed
  ambiguity handling.
- Aligned MCP note clearing with the existing `NOT NULL` storage contract: notes are strings and an
  empty string clears them.
- Added and three-way mirrored the `bitterless-todo` skill with the Todo tool contract, domain and
  Focus policy, event cursors, recovery rules, and Codex MCP dependency metadata.
- Passed the expanded fixture suite, targeted script lint, `node --check`, `yarn typecheck:node`,
  strict skill YAML validation, three-way directory diffs, patch hygiene, and three independent
  review rounds. The final review passed with no P1/P2/P3 findings.
- `yarn build` remains externally blocked before task code loads because the existing local
  `node_modules` is missing the already-declared `@tailwindcss/vite` dependency.
