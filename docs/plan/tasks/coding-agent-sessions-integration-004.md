---
id: coding-agent-sessions-integration-004
scope: real storage/provider/bridge/XPC/UI chains and Electron acceptance
status: in-progress
depends-on: [coding-agent-sessions-ui-003]
---

# Coding-agent Sessions Integration

## Objective

Add real-boundary integration and Electron E2E coverage for the complete feature, fix any integration
gaps, and update the feature/task status only after all acceptance gates pass.

## Context

- `docs/integrations/coding-agent-sessions.md`
- `docs/integrations/coding-agent-sessions-layout.md`
- `docs/plan/analysis/coding-agent-sessions.md`

## Paths

- `tests/coding-agent/`
- `scripts/coding-agent/`
- `package.json`
- `docs/integrations/coding-agent-sessions.md`
- `docs/plan/README.md`
- all coding-agent implementation paths when integration fixes are required
- this task file

## Verification

- Exercise authenticated navigation, real SQLite persistence, fake installed provider executables,
  exact deep-link interception, background/foreground states, hook event ingress, refresh failure,
  soft removal, and restart persistence.
- Run all coding-agent tests, `yarn typecheck`, `yarn build`, relevant existing renderer/i18n checks,
  and `git diff --check`.
