# Todo MCP Important Intent Review — Round 1

Status: accepted

Date: 2026-07-24

## Findings and resolutions

No open P1, P2, or P3 finding remains.

- **Create intent:** explicit star, important, priority, 重点, and Focus-placement language maps to
  `important: true`. A due date, reminder, or ordinary backlog item does not imply importance.
- **Edit intent:** `important: true` stars, `important: false` unstars, and omission preserves the
  existing state during unrelated edits.
- **Focus contract:** Focus remains a virtual view of active important Todos; no redundant star tool
  was added.
- **Portable skill:** the MCP metadata, skill guidance, tool reference, and Codex picker prompt use
  the same policy. Skill revision `260724175151` matches the application constant and version
  contract test.
- **Installed copies:** the canonical skill folder is byte-identical to both workspace copies and
  the installed Codex and Claude copies.

## Verification

- `yarn typecheck:mcp`
- `yarn test:mcp:todo-step-crud`
- `yarn test:mcp:domain-catalog`
- `yarn test:mcp:agent-onboarding`
- `yarn test:mcp:todo-skill-export`
- `yarn test:todo:agent-skill-version`
- Skill YAML validation
- Four canonical-to-destination `diff -qr` checks
- `git diff --check`

## Conclusion

**Pass.** MCP clients can create or edit starred Todos through the existing `important` field,
including explicit removal from Focus, without changing Todo storage or synchronization. Electron
runtime acceptance remains with Ral as requested.
