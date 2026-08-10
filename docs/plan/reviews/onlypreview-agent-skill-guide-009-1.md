---
id: onlypreview-agent-skill-guide-009-1
status: pass
reviewed_task: onlypreview-agent-skill-guide-009
target: working-tree-2026-08-09
base: cf9ca882649f17dd34b3dc4089ccf88ca2be2670
date: 2026-08-09
review_type: independent-static-and-node-no-runtime
---

# Verdict

**PASS. No open P1, P2, or P3 finding.** Task 009 reaches code-delivery state; real window,
clipboard, installation, and agent-session behavior remain with Ral for manual verification.

# Findings

- P1 blocking: none.
- P2 blocking: none.
- P3 non-blocking: none.

One candidate P2 was resolved during review. The Guide originally imported the complete
`OnlyPreviewApi` renderer client, whose type also exposed the tokenless Home launch action. The
final implementation gives Guide an exact
`Pick<OnlyPreviewApi, 'getAgentSkillGuideInfo'>` client and source guards prohibit launch,
workspace, read, and external-open methods. Home's existing idempotent global launch remains
separate from Guide-token authority.

# Contract Evidence

- `skills/bitterless-preview/` contains exactly `SKILL.md`, `agents/openai.yaml`,
  `references/mcp-setup.md`, and `references/tools.md`; its production dependency is the stdio MCP
  server `bitterless` and its instructions permit only an explicit known absolute target.
- `preview.open` validates a single `path`, rejects malformed/relative/overlong input, delegates
  once to Main's existing OnlyPreview absolute-target orchestration, and returns only
  `{ opened: true }` without content, directory enumeration, mutation, or path echo.
- The MenuBar Robot opens a parented, non-modal singleton Guide. The Guide has a dedicated host,
  strict navigation fence, static sandboxed preload, size-only state restoration, and explicit
  cleanup. Its renderer receives only server name, skill version, and one English setup
  instruction.
- The Todo-inspired surface contains one `Complete setup instructions` card and one icon-only copy
  action. It contains no summary, detailed steps, individual path/config fields, badge, red dot, or
  acknowledgement state.
- Electron Builder copies the entire skill directory and the package audit rejects missing, empty,
  non-regular, or symlinked required files. Guide is registered in Vite, CSP/output checks, i18n,
  logging, and the retained MenuBar action inventory.

# Verification

| Check | Result |
|---|---|
| `node --test tests/onlypreview/*.test.mjs` | PASS — 62/62 |
| `node --test scripts/mcp/preview-open.test.mjs` | PASS — 1/1 |
| Focused Preview package-audit cases | PASS — 3/3 |
| Application diagnostics | PASS — 10/10 |
| `yarn typecheck:node` | PASS |
| `yarn typecheck:mcp` | PASS |
| Renderer i18n and focused ESLint | PASS |
| YAML/frontmatter validation through `js-yaml` | PASS |
| `git diff --check` | PASS |

The complete package-audit suite remains at 14/16 because of two unrelated shared-tree baselines
in dependency inventory and publish ordering. The full web typecheck reports only established
non-OnlyPreview errors. The skill-creator Python validator could not start because local Python
lacks PyYAML; the same frontmatter and sidecar structures were parsed and asserted through the
repository's installed `js-yaml`.

# Runtime Boundary

This review did not launch Electron, Playwright, E2E, the full Bitterless application, a build, or
any Keychain-capable path. Ral retains manual acceptance of the Robot entry, single-card Guide,
clipboard payload, complete skill installation, fresh agent session, and one explicit file/folder
open through `preview.open`.
