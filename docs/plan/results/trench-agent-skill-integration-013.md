# Trench Agent Skill And Integration Result

Task: `trench-agent-skill-integration-013`

Status: **implemented-awaiting-verification**

Date: 2026-08-09

## Implemented

- Created the portable `skills/bitterless-trench/` package with a concise workflow plus direct
  references for MCP setup, all 12 Trench tools, and the two persisted record schemas.
- Declared one sidecar dependency only: the production stdio MCP server named `bitterless`.
- Encoded dictionary-first CA analysis, no more than 100 contiguous top-profit wallets per chain,
  explicit human reasons for Negative tags, separate holdings documents, timeout recovery, and
  put-then-get identity/hash proof.
- Kept provider use read-only and optional. The skill never writes local files, uses a DEBUG MCP,
  trades/signs, or requests/reads/transmits credentials. Provider failure remains an explicit
  unavailable result instead of invented evidence.
- Documented Robinhood consistently as EVM in the shared `gmgn-token` and `gmgn-portfolio` skills.
  Their `.agents`, `.claude`, Codex-user, and Claude-user copies are byte-identical.
- Installed complete additive copies of `bitterless-trench` into workspace `.agents`/`.claude` and
  user Codex/Claude skill directories without deleting other skills.
- Added a version constant, deterministic ZIP exporter, focused export/policy/credential tests,
  Electron Builder resource, and packaged-app real-file/symlink audit.
- Generated the ignored handoff artifact at `dist/skills/bitterless-trench.zip`; it contains exactly
  the five portable skill files under one `bitterless-trench/` directory.

## Provider availability truth

The exact `ops/bitterless/ops.yml` inventory is `ral`-owned but currently has no GMGN resource.
No keychain, provider config, environment credential, or other project's Ops file was read. Until
Ral adds or repairs an exact owner-matched GMGN resource there, provider-dependent analysis must be
reported unavailable. Synthetic automated acceptance remains valid and needs no live provider.

## Verification run

Passed:

- Required `skill-creator` `quick_validate.py` using an isolated temporary PyYAML dependency path:
  `Skill is valid!` No global Python package was installed.
- `yarn test:mcp:trench-skill-export` — portable file set, version, production dependency, workflow
  policy, schema/setup contract, credential scan, ZIP entries, and byte equality passed.
- `yarn typecheck:mcp` — passed.
- Focused desktop package audit for a passing synthetic package, Trench missing/symlink rejection,
  and Builder registration — 3/3 passed.
- Workspace-wide shared-skill frontmatter validation — no YAML findings.
- Byte-for-byte directory diffs for all four `bitterless-trench` installed mirrors and all updated
  GMGN mirrors — no differences.
- Focused credential/machine-path scan — no credential material, private key block, assignment, or
  absolute user path.
- Focused `git diff --check` for the task-owned source/config — passed.

The broad `yarn test:desktop-package-audit` ran 19/21 tests successfully, including every new
Trench package gate. Its two failures are outside task 013: the dirty worktree's dependency fixture
does not yet include existing `dompurify`, `electron-log`, and `marked`, and the unrelated publish
script no longer matches its pre-existing order assertion. Neither file was changed to hide those
failures.

## Integration E2E evidence

`yarn playwright test -c tests/coin/playwright.config.ts
tests/coin/specs/trench-skill-integration.spec.ts` passed 1/1 against freshness-audited DEBUG build
outputs. The scenario opens standalone and Omni Trench before any evidence write, spawns the built
`out/main/mcpHelper.js` over stdio against the fixture's isolated bridge, completes initialize and
the exact 12-tool list contract, and performs every Trench mutation through `tools/call`. It proves
independent SHA-256 hashes over exact UTF-8 analysis, tag, and holdings files, the composite Negative
Wallet reread hash, and no-reload live rendering of the same documents in both already-open hosts.
The child receives an allowlisted zero-credential environment, exits cleanly in `finally`, and the
run reports mock Keychain, no safeStorage tripwire, no denied/unexpected network, no renderer error,
and target-display placement. Task 013 remains `implemented-awaiting-verification` pending the
independent requirement-by-requirement acceptance pass.

## Ral production acceptance checklist

1. Start the production Bitterless profile. In the Guide, confirm the generated helper remains
   registered under the exact MCP server name `bitterless`; keep the app running.
2. Install the entire packaged `bitterless-trench/` directory into the target agent's skill folder.
   Copy contents additively, then start a fresh Codex or Claude Code session.
3. Confirm `tools/list` exposes all 12 `trench.*` tools and invoke `$bitterless-trench` in Codex or
   `/bitterless-trench` in Claude Code. Do not use a DEBUG helper for this production check.
4. Ask the skill to store one clearly labelled synthetic BSC fixture CA at
   `0x0000000000000000000000000000000000000001`, with no live-provider claim, and require the
   put-then-get analysis ID/address/chain/hash comparison.
5. Ask it to tag synthetic Robinhood wallet
   `0x0000000000000000000000000000000000000004` with the explicit explanation
   `Owner acceptance fixture; not a real negative classification`, then store a separate synthetic
   empty holdings snapshot whose result states that it is an owner acceptance fixture. Require tag,
   holdings, and composite rereads.
6. Open standalone BL Trench and one Omni Trench cell. Confirm both already-open hosts refresh and
   show the same CA and Negative Wallet documents without reopening or showing analysis controls.
7. Repeat the exact same IDs/content and confirm `changed: false` with no duplicate row. Submit a
   strictly newer fixture analysis ID/time and confirm the same CA row updates rather than creating
   another active record.
8. Before ending acceptance, get the current IDs and hashes, then explicitly archive both synthetic
   records. Confirm the CA, derived Index evidence, Negative tag, and Negative holdings disappear
   from both hosts. This cleanup is required because V1 has no MCP restore.

If live GMGN research is also desired, first repair the exact `ral`-owned GMGN resource in
`ops/bitterless/ops.yml`; do not provide a key in chat and do not authorize keychain fallback.
