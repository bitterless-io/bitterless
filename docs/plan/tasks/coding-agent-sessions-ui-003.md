---
id: coding-agent-sessions-ui-003
scope: authenticated Home dashboard, filters, row actions, registration, and integration setup
status: in-progress
depends-on: [coding-agent-sessions-bridge-002]
---

# Coding-agent Sessions UI

## Objective

Implement the authenticated Home route and the complete layout/interaction contract. Connect it to
the real main XPC handler; no mock rows, sample sessions, transcript content, arbitrary URLs, or
arbitrary commands may remain.

## Context

- `docs/integrations/coding-agent-sessions.md`
- `docs/integrations/coding-agent-sessions-layout.md`
- `docs/plan/analysis/coding-agent-sessions.md`

## Paths

- `src/renderer/home/src/router/defaultRoutes.ts`
- `src/renderer/home/src/views/codingAgentSessions/`
- `src/renderer/home/src/emitter/codingAgentSession.emitter.ts`
- `src/renderer/home/src/views/layout/components/homeMenu/`
- `src/renderer/common/assets/icons/`
- `src/renderer/common/i18n/en.ts`
- `src/renderer/common/i18n/zh.ts`
- `scripts/coding-agent/`
- `package.json`
- this task file

## Verification

- Renderer tests cover filters, empty/loading/error states, add validation, refresh retention,
  already-open Claude behavior, integration status, and event-driven reload.
- Run focused renderer typecheck, `yarn typecheck`, `yarn build`, and `git diff --check`.
