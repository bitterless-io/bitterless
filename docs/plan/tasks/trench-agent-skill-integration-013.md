---
id: trench-agent-skill-integration-013
scope: Portable bitterless-trench skill, export/install contract, and end-to-end acceptance
status: done
depends-on: [trench-record-store-mcp-010, trench-record-browser-011, trench-omni-embedding-012]
---

# Trench Agent Skill And Integration

## Objective

Ship the portable `bitterless-trench` skill and prove the external-analysis → production MCP → local
JSON → standalone/Omni preview flow with synthetic automated evidence and Ral's installed-state test.

## Scope

- Add the portable skill, Codex sidecar, MCP dependency, tool/schema/setup references, version code,
  export script, builder resources, and onboarding information without changing Todo skill identity.
- Encode CA analysis and human-authorized negative-wallet workflows, including put-reread proof,
  dictionary lookup before analysis, provider-unavailable truthfulness, and no credential/trading
  behavior.
- Align the shared `gmgn-token`/`gmgn-portfolio` skill contracts for Robinhood's EVM address shape.
  Provider CLIs may use their own configured credential, but the Trench skill never reads/transmits
  it. Workspace setup resolves an exact `ral`-owned Ops resource and never reads keychain.
- Install additive workspace/Codex copies and verify they match the portable source.
- Add DEBUG E2E that writes synthetic records through the real helper/bridge and observes both UI
  hosts live.
- Produce an exact production manual checklist for Ral; do not require a real provider for automated
  acceptance.

## Acceptance

- Export contains one complete `bitterless-trench/` directory and no credentials, user data, or
  machine-specific helper path.
- Sidecar depends on MCP server `bitterless`; the skill never writes disk itself or names a DEBUG
  server for real work.
- Skill instructions require explicit negative reason, maximum top-100 evidence, dictionary reads,
  separate negative holdings, and persisted reread verification.
- Robinhood validation is consistently documented as EVM; missing owner-matched Ops configuration
  produces an unavailable result instead of a keychain lookup or fabricated holdings.
- Fresh DEBUG E2E proves MCP put → exact local file → live standalone + Omni rendering.
- Ral receives and can execute the production helper, skill load, CA put, negative tag/holdings, and
  dual-host visual checklist.

## Verification

- Skill frontmatter/YAML/version/dependency/export/package resource tests.
- Byte-for-byte/additive mirror checks for application source and installed workspace/Codex copies.
- Focused MCP integration and Electron E2E.
- Independent requirement-by-requirement acceptance report before owner handoff.

## Implementation result

The portable package, production-only MCP dependency, additive mirrors, Robinhood EVM guidance,
export/package gates, and owner checklist are implemented. See
[the implementation result](../results/trench-agent-skill-integration-013.md). The fresh DEBUG
integration opens standalone and Omni Trench before writes, spawns the built production stdio
helper against the isolated fixture bridge, and proves the 12-tool MCP contract, exact UTF-8 disk
documents and hashes, no-reload dual-host rendering, display routing, and zero-credential runtime
boundary with synthetic evidence. The independent requirement-by-requirement pass is recorded in
[the verification report](../results/trench-agent-skill-integration-013-verify.md).
