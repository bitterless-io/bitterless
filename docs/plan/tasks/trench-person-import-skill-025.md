---
id: trench-person-import-skill-025
scope: BL Trench person import MCP and portable skill
status: done
depends-on: [trench-person-registry-023, trench-trenchers-ui-024]
---

# Trench non-overwriting person import and skill

## Objective

Add one staged, atomic, non-overwriting person-wallet import tool and update the full portable
`bitterless-trench` skill so an agent can convert a human-supplied messy JSON file into bounded MCP
chunks, finalize it through Bitterless, and verify the aggregate receipt without direct DB access.

## Context

- [`../../features/trench-person-registry.md`](../../features/trench-person-registry.md)
- [`../../features/trench-mcp.md`](../../features/trench-mcp.md)
- [`../analysis/trench-person-registry-analysis.md`](../analysis/trench-person-registry-analysis.md)
- [`trench-person-registry-023.md`](trench-person-registry-023.md)

Keep `dev/current`, preserve dirty work, and do not touch DEBUG_PROD. The supplied file is read-only
input. Its EVM syntax does not authorize choosing a chain. No Electron E2E.

## Path

- person/MCP/skill feature docs and task/result/README docs for 025
- shared person import contract/validation and `trenchMcp.schema.ts`
- `src/main/mcp/mcpBridge.server.ts`, stdio helper, onboarding count/version text
- hidden `trench-io` import staging/finalization repository and Main client/XPC integration
- `skills/bitterless-trench/` entire directory
- additive synchronized copies in overmind `.agents/skills`, `.claude/skills`, and
  `~/.codex/skills/bitterless-trench`
- focused MCP/skill/native/unit/static tests

## Contract

1. Add exactly `trench.person.import`; tools/list exposes 13 `trench.*` tools. It accepts structured
   chunks only—never a path/raw file—and follows the staged/finalize contract in the person feature.
2. Chain and `walletKind: user` are explicit. Each chunk contains at most 250 rows and exact hashes.
   Missing/out-of-order/conflicting chunks fail closed; complete finalization is one hidden SQLite
   transaction and returns a value-free aggregate receipt.
3. Existing wallet/person/profile/note/classification/metadata is never overwritten. Existing
   unlinked wallets receive only membership; new rows receive import-source metadata. Equal names
   never merge people. Retry/fingerprint behavior is deterministic.
4. Update `bitterless-trench` version code to `260813155645`. Add a deterministic Node converter
   script for strict UTF-8 JSON arrays shaped like `{address, rename, emoji}`: exact keys/types,
   NFC, explicit chain, canonical dedupe, conflict rejection, stable sorting, source/chunk/content
   hashes, 250-row chunks, and aggregate-only stdout. It never reads credentials or DB files.
5. Skill instructions call only production `bitterless`, stage/finalize through the tool, reread or
   compare the returned completed import receipt, delete temporary chunk files after completion,
   and never substitute DEBUG aliases. Preserve existing CA/Negative workflows.
6. Synchronize the complete skill additively to all required trees, validate YAML/openai metadata,
   and update onboarding payload/version/tool count. Do not delete any other skill.
7. Use `/Users/ral/Downloads/message.txt` only as a converter fixture/read-only forward check. Its
   expected aggregate shape is 3,120 unique EVM rows, 13 chunks, no emoji; do not import it into
   DEBUG_PROD or any live production database during automated verification.

## Verification

- Converter unit/CLI tests cover the supplied aggregate, canonical ordering, exact duplicate
  collapse, conflicting duplicate rejection, invalid chain/address/key/type/UTF-8/length, stable
  hashes/request IDs, and payload secrecy.
- Native repository tests cover missing/conflicting/replayed chunks, atomic finalize rollback,
  inserted/unlinked-existing/already-linked paths, field preservation, receipt replay, and revision.
- Exact 13-tool MCP schema/dispatch/stdio tests and portable-skill install/guide/schema references
  pass. YAML validation and three-tree `diff -qr` pass.
- Node/MCP/hidden-runtime typechecks, migration audit, fresh isolated DEBUG_DEV build, secret scan,
  and `git diff --check` pass. No Electron E2E runs and no live import occurs.
- Independent Verify writes `docs/plan/reviews/trench-person-import-skill-025-1.md`; Ral later runs
  the production import with the explicit source chain.

## Development handoff

Implementation completed on 2026-08-13 and is recorded in
[`../results/trench-person-import-skill-025.md`](../results/trench-person-import-skill-025.md).
The immutable 025 ledger, hidden atomic insert-only repository, exact 13th MCP tool, deterministic
converter, production-only portable skill, three additive installed copies, focused tests, migration
audit, and isolated DEBUG_DEV build are implemented. The supplied file was checked only through an
aggregate converter fixture and was never imported.

The task intentionally remains `in-progress` pending fresh independent Verify. Develop did not
author a review, run Electron E2E, touch DEBUG_PROD, or perform a live/production import. Ral's later
production run still requires his explicit chain choice.

Review-fix pass 2 aligns all three public boundaries: the portable converter now Base58-decodes
Solana input, requires exactly 32 bytes, and verifies its canonical re-encoding; the canonical
feature/analysis ledger now preserves the exact ordered 018/019/023/025 identities; and
`displayEmoji` is capped at 16 Unicode code points in both `tools/list` and runtime parsing. Focused
regressions cover accepted 32-byte Solana addresses, rejected 31/33-byte and `z` × 44 boundaries,
and accepted/rejected 16/17-code-point MCP values. Fresh independent Verify is still required.
