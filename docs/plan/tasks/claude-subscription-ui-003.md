---
id: claude-subscription-ui-003
scope: Maestro entry, Workbench Configuration tab, and Bitterless lifecycle integration
status: implemented; owner verification pending
depends-on: [claude-subscription-auth-002]
---

# Objective

Restore the authenticated Maestro Mini App entry so it is visible and opens the existing singleton
Maestro window. Add a localized **Configuration** tab to Maestro Workbench for Claude subscription
account metadata, actions, authorization progress, the Codex profile handoff, and local model
configuration. Add **Local** as a selectable Maestro model provider backed only by Bitterless's
loopback Responses endpoint and accepted Claude model aliases. Wire the local Claude runtime into
optional app startup and cleanup without changing existing AI-CRMS, Codex, or Translator behavior.

Use the `frontend-design` workflow before implementation: derive the visual direction from
Maestro's browser/agent-control subject, define compact tokens and a Workbench-specific signature,
self-critique the result against generic settings-card patterns, then implement within the existing
Workbench design system.

# Context

- `docs/features/claude-subscription-accounts.md`
- `docs/features/claude-subscription-accounts-layout.md`
- `docs/features/model-provider.md`
- `docs/plan/analysis/claude-subscription-accounts.md`

# Path

- `src/main/app.main.ts`
- `src/main/claudeSubscription/`
- Maestro Mini App entry and `openMaestroWindow` launch surface
- `src/renderer/maestro/workbench/`
- `src/shared/maestro/`
- Maestro LLM catalog/service and persisted `LlmConfig` normalization
- `src/main/maestro/xpc/`
- `src/renderer/common/i18n/en.ts`
- `src/renderer/common/i18n/zh.ts`
- `tests/claudeSubscription/`
- `docs/INDEX.md`
- `docs/plan/README.md`
- `docs/features/claude-subscription-accounts.md`
- `docs/features/claude-subscription-accounts-layout.md`
- `docs/plan/tasks/claude-subscription-ui-003.md`

# Verification

- Maestro is visible in authenticated Mini Apps and its Open action reaches the existing singleton
  `openMaestroWindow` boundary without duplicating the window graph.
- Workbench Models lists Local as an explicit provider, persists a supported local model/effort,
  and rejects stale or unknown local models without changing existing providers.
- Configuration exposes the fixed loopback endpoint and supported model aliases, provides a model
  configuration entry, and never accepts a remote URL or credential.
- Workbench renderer store tests cover initial/broadcast ordering, add/reconnect/cancel/manual code,
  enable/test/rename/remove, copy feedback, and action fencing.
- UI/source tests cover the new Configuration tab, stable `name` attributes, business-rooted BEM
  classes with sibling Less, empty/error/busy/limited/reconnect states, destructive
  confirmation, keyboard focus, reduced motion, and no credential-shaped fields.
- Source integration proves optional startup calls runtime start and cleanup awaits runtime stop.
- `yarn typecheck:node`
- `yarn typecheck:web`
- Targeted ESLint on task TypeScript/Vue paths.
- All Claude subscription tests.
- `yarn build`
- `git diff --check`
- The implementation handoff does not run any verification command. Ral owns automated checks,
  Electron/runtime behavior, and live Claude login acceptance for this delivery.
