# Trench Agent Skill And Integration Verification

Task: `trench-agent-skill-integration-013`

Status: **PASS**

Date: 2026-08-09

## Acceptance result

| Requirement | Independent evidence | Result |
|---|---|---|
| Portable skill | The source has exactly `SKILL.md`, `agents/openai.yaml`, and the three declared references. System `skill-creator` `quick_validate.py` passed with an isolated temporary PyYAML path. | PASS |
| Production MCP boundary | The sidecar declares one stdio MCP dependency, `bitterless`. The workflow forbids DEBUG aliases, direct `userData` writes, credential handling, and trading/signing. | PASS |
| CA workflow | The skill requires dictionary reads first, at most 100 contiguous top-profit wallets per chain, source-backed/unavailable truth, put, and identity/chain/hash reread. | PASS |
| Negative Wallet workflow | The skill requires a human-provided explanation, a separate holdings analysis/document, tag and holdings rereads, and final composite-state confirmation. | PASS |
| Chain contract | BSC and Robinhood are documented as lowercase EVM identities; Solana remains case-preserved base58. The shared `gmgn-token` and `gmgn-portfolio` mirrors carry the same Robinhood rule. | PASS |
| Additive mirrors | The portable source and all four workspace/user Codex/Claude copies are byte-identical real directories with no symlinks. Both updated GMGN skills are byte-identical across all four mirrors. | PASS |
| Export and packaging | The ZIP contains exactly the five portable files under one `bitterless-trench/` root and every entry matches the source bytes. Electron Builder copies the complete directory, and the package audit rejects missing files and file/directory symlinks. | PASS |
| Ops and credential boundary | A structure-only parse of the exact `ops/bitterless/ops.yml` found only `ral` owners and no GMGN resource. No keychain or alternative Ops source was read. Provider-dependent work therefore remains explicitly unavailable. | PASS |
| Built MCP integration | A fresh production build's `out/main/mcpHelper.js` initialized as `bitterless` `0.2.0`, listed the exact 12 `trench.*` tools, and accepted all synthetic writes through real NDJSON `tools/call` and the isolated local bridge. | PASS |
| Exact persistence | Analysis put/get matched record, document, and SHA-256 over the exact one-CA file. Negative tag and separate holdings put/get matched their exact UTF-8 files and individual plus composite hashes. | PASS |
| Live standalone and Omni | Both hosts were open before writes, rendered the same exact analysis/tag/holdings documents, and retained their original WebContents IDs and `performance.timeOrigin`; no reload or reopen occurred. | PASS |
| E2E isolation | Every visible E2E top-level window was on `DELL S2721QS`; macOS used `--use-mock-keychain`. The helper received an allowlisted isolated environment without the parent secret sentinel; safeStorage, denied/unexpected network, and renderer-error tripwires stayed empty. | PASS |
| Owner cleanup | The production checklist requires CAS archival of both synthetic records and confirmation that CA, Index, tag, and holdings disappear. Cleanup is not optional because V1 has no restore. | PASS |

## Commands rerun

- `yarn test:mcp:trench-skill-export` — passed.
- `yarn typecheck:mcp` — passed.
- Focused desktop package audit — 3/3 passed.
- Focused ESLint and Prettier checks — passed after the Develop remediation was frozen.
- Workspace skill YAML validation, portable/GMGN directory diffs, ZIP byte audit, sidecar constraints,
  credential/machine-path scan, and task-scoped `git diff --check` — passed.
- `yarn build` — fresh production build passed.
- `yarn playwright test -c tests/coin/playwright.config.ts tests/coin/specs/trench-skill-integration.spec.ts`
  — 1/1 passed twice, including once after the final remediation freeze.

## Handoff boundary

There is no blocker or important finding in task 013. Automated acceptance is synthetic and did not
use a live provider. Ral's installed production-session checklist in the implementation result is
still the final human validation; its archival cleanup step is required. Live GMGN research must
remain unavailable until an exact owner-matched GMGN resource is repaired in
`ops/bitterless/ops.yml`; no key should be supplied in chat and no keychain fallback is permitted.

This verification exercised the current macOS runtime. It does not claim a new Windows GUI runtime
execution result.
