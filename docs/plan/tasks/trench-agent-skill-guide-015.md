---
id: trench-agent-skill-guide-015
scope: Current-instance MCP and bitterless-trench installation guide in standalone and Omni
status: done
depends-on: [trench-agent-skill-integration-013, trench-omni-embedding-012]
---

# Trench Agent Skill Guide

## Objective

Add a Todo-style Agent setup guide to the Trench header so a person can connect the current
Bitterless MCP instance, install the complete `bitterless-trench` skill, and restart/verify Codex or
Claude Code without reading project files or copying machine secrets.

## Context

- `docs/features/trench-mcp.md`
- `docs/features/coin-layout.md`
- `docs/plan/results/trench-agent-skill-integration-013.md`
- `docs/features/todo-mcp.md` (existing modal precedent, not a contract to copy verbatim)

## Path

- `src/main/mcp/`
- `src/main/xpc/mcp.handler.ts`
- `src/shared/mcp/`
- `src/shared/trench/`
- `src/renderer/coin/src/components/TrenchHeader/`
- `src/renderer/coin/src/components/TrenchAgentGuideModal/`
- `src/renderer/coin/src/views/vault/`
- `src/renderer/common/i18n/en.ts`
- `src/renderer/common/i18n/zh.ts`
- `tests/coin/`
- `tests/omni/`
- `docs/features/trench-mcp.md`
- `docs/features/coin-layout.md`

## Acceptance

- A stable Robot action is visible in standalone and Omni Trench and opens one viewport-safe Arco
  modal without creating a window, webview, provider request, or Trench mutation.
- Main returns the current server name, helper path, exact MCP JSON, readable complete bundled skill
  path, 12-digit skill version, and one English complete-setup instruction.
- The modal displays Connect MCP, Install skill, and Restart/verify sections plus complete and
  individual copy actions. Copy uses the exact Main-returned strings.
- Packaged and unpackaged paths resolve truthfully. Missing skill files, invalid/missing fields, and
  renderer/Main version mismatch fail explicitly with retry/restart guidance.
- DEBUG guides visibly retain their DEBUG server name and test-only warning; they never instruct an
  agent to register DEBUG as production `bitterless` or store real records there.
- 398×568 and 800×282 Omni cells keep the trigger, native close, every section, and copy action
  keyboard-reachable through modal-body scrolling with no document overflow.
- No guide path reads Keychain, `safeStorage`, provider credentials, Ops secrets, or Trench data.

## Verification

- Pure Main/shared tests for packaged/unpackaged path resolution, complete payload, DEBUG safety,
  missing files, version mismatch, and non-secret output.
- Focused renderer/Node typechecks, i18n, ESLint, and `git diff --check`.
- Fresh DEBUG build plus standalone and Omni Electron E2E on the configured target display. Verify
  exact OS clipboard content, 1360×860 / 800×600 / 398×568 / 800×282 reachability, mock Keychain,
  no `safeStorage` tripwire, no network/provider call, and no record mutation.

## Implementation result

Implemented and independently verified on 2026-08-09 with status **done**. Main returns one
strict current-instance Trench onboarding payload; standalone and Omni share the stable Robot trigger
and the ordered, responsive, exact-copy guide. Pure contracts, focused type/i18n/lint checks, a fresh
DEBUG build, standalone exact-clipboard E2E, Omni three-size keyboard/scroll E2E, and original PNG
inspection passed. See `docs/plan/results/trench-agent-skill-guide-015.md` for complete evidence.

## Verification result

Independent Verify passed with no blocking P1/P2 finding. One non-blocking TS-1 file-size finding is
tracked in the delivery backlog. See
[`../reviews/trench-agent-skill-guide-015-1.md`](../reviews/trench-agent-skill-guide-015-1.md).
