---
id: eyes-on-agents-claude-multi-env-renderer-088
scope: Replace the single Claude directory block with an environment list (add/rename/remove/enable) and per-environment setup, plus a resolved environment label on the thread card
status: pending
depends-on: [eyes-on-agents-claude-multi-env-data-model-084, eyes-on-agents-claude-multi-env-watcher-085, eyes-on-agents-claude-multi-env-plugin-install-086, eyes-on-agents-claude-multi-env-hook-attribution-087]
verify: focused EyesOnAgents UI-source/store tests, renderer i18n check, UI strict typecheck; no Electron; manual multi-environment verification is owner-only
---

# EyesOnAgents Claude Multi-Environment Renderer

## Objective

Replace `ClaudeObservationCard.vue`'s single directory block with a list of configured
`EyesOnAgentsClaudeEnvironment` rows (add/rename/remove/enable/disable, per-environment directory
picker or "Use automatic", per-environment watcher status pill, per-environment plugin setup
action), add the "each environment needs its own hook install" guidance note, and show a resolved
environment label on `ThreadCard.vue` when a thread's `claude_config_dir` matches a currently
configured environment. This is the last task in this plan; after it, the feature doc's Acceptance
section (excluding the owner-only manual two-environment check) should be fully satisfiable.

## Context

- `docs/features/eyes-on-agents-claude-multi-environment.md` — "Renderer" section is the exact
  contract; its "Acceptance" section is what this task's combined result with 084-087 must satisfy.
- `docs/features/claude-subscription-accounts-layout.md` — the already-shipped multi-account list
  UI pattern (add/rename/remove/enable, one row per named account) this task's environment list
  should structurally mirror, not reinvent.
- `docs/features/eyes-on-agents-iterm2-open.md`'s "Renderer" section — precedent for adding a small,
  additive change to `ThreadCard.vue`'s existing tooltip/dropdown without touching
  `canOpenThread`/`openLabel`/the primary Open contract.

## Required behavior

- **Close the `EyesOnAgentsApi` gap left by task 084.** Task 084 deliberately registered its 7 new
  XPC methods (`listClaudeEnvironments`, `addClaudeEnvironment`, `renameClaudeEnvironment`,
  `removeClaudeEnvironment`, `setClaudeEnvironmentEnabled`, `chooseClaudeEnvironmentDirectory`,
  `useAutomaticClaudeEnvironment`) without adding them to the shared `EyesOnAgentsApi` interface in
  `src/shared/eyesOnAgents/eyesOnAgents.type.ts`, to avoid an out-of-scope ripple into the
  ~3,700-line `EyesOnAgentsService` (`src/main/eyesOnAgents/eyesOnAgents.service.ts`), which also
  `implements EyesOnAgentsApi`. The renderer's typed XPC emitter
  (`src/renderer/eyesOnAgents/src/emitter/eyesOnAgents.emitter.ts`) is typed nominally against
  `EyesOnAgentsApi`, not structurally against the handler class, so this task genuinely cannot call
  those 7 methods in a type-safe way until the interface is extended and `EyesOnAgentsService`
  implements the new members (thin delegating methods to the existing
  `ClaudeDirectoryConfigService`/handler logic task 084 already wrote — this is a mechanical
  interface-satisfaction step, not new business logic). Do this first, before writing any Vue/store
  code that depends on it.

- `ClaudeObservationCard.vue`'s current single directory block (path/mode/state/last-scan/actions)
  becomes a list, one row per `EyesOnAgentsClaudeEnvironment`/`EyesOnAgentsClaudeEnvironmentStatus`
  pair: label, resolved path or "not configured", mode, the existing status pill values
  (`watching`/`waiting`/`degraded`/`retrying`/`error`/`stopped`), and the existing per-environment
  plugin setup action (`enable`/`finish`/`reload`/`retry`/`repair`) evaluated per environment via
  task 086's `{ environmentId }`-scoped XPC methods — the setup-action state machine's own logic is
  unchanged, it is simply invoked once per environment instead of once globally.
- Row actions: rename (inline or small dialog), change directory (existing native picker) or "Use
  automatic" for the one eligible environment, enable/disable toggle, remove (disabled/hidden when
  it is the last remaining environment — surface this constraint from task 084's service rather than
  re-deriving it in the renderer).
- A persistent "Add environment" action opens a small form (label text input + directory picker),
  always creating a `mode: 'custom'` entry via task 084's `addEnvironment`.
- One short, always-visible guidance note (following the existing `eyes-connection-panel__boundary`
  aside pattern already used for the App Server "Desktop note"): "Each environment needs its own
  hook install. Point Bitterless at your environment's `CLAUDE_CONFIG_DIR`, then Install — and make
  sure the shell command you use for that environment (e.g. a `claude2` wrapper) sets
  `CLAUDE_CONFIG_DIR` before invoking `claude`." Add the localized copy under both `en.ts` and
  `zh.ts`, in both languages, sibling to the existing `claudeBridge`/`claudeDirectory` i18n blocks.
- `ThreadCard.vue`'s existing folder tooltip text gains the resolved environment label when the
  thread's `claudeConfigDir` matches (path-normalized) a currently configured environment's
  `configDirectory` — resolve this in the renderer store/computed layer (matching thread
  `claudeConfigDir` against the current environments list from the snapshot), not as a persisted
  foreign key. A thread with no match, or in a single-environment setup, renders exactly as it does
  today — no visible change for a user who never adds a second environment.
- Do not change `canOpenThread`, `openLabel`, `canOpenInIterm2`, or any existing Open-button/dropdown
  behavior on `ThreadCard.vue` — this task only touches tooltip text and the Connections drawer.

## Path

- `src/shared/eyesOnAgents/eyesOnAgents.type.ts` (extend `EyesOnAgentsApi` with the 7 environment-CRUD
  methods task 084 registered on the handler but left off this interface)
- `src/main/eyesOnAgents/eyesOnAgents.service.ts` (thin delegating implementations of those 7
  interface members only — do not touch any other existing method in this file)
- `src/renderer/eyesOnAgents/src/components/ConnectionPanel/ClaudeObservationCard.vue`
- `src/renderer/eyesOnAgents/src/components/ConnectionPanel/ConnectionPanel.less` (new list-row
  styles; reuse existing card/row classes where they already fit)
- `src/renderer/eyesOnAgents/src/components/ThreadCard/ThreadCard.vue` (tooltip text only)
- `src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts` (new environment CRUD store methods
  mirroring the existing `openThread`/`openThreadInIterm2` call/error-handling pattern; a computed
  or helper resolving a thread's environment label from the snapshot)
- `src/renderer/common/i18n/en.ts` / `zh.ts`
- `scripts/eyes-on-agents/thread-card-open-capability.test.mjs` and/or a new focused test file for
  the environment list component/store logic
- `docs/integrations/eyes-on-agents-layout.md` (update the Connection drawer / Claude pane
  description and the thread-card tooltip contract in the same change)

## Verification

- New/extended tests cover: the environment list renders one row per configured environment with
  correct status/actions; add/rename/remove/enable call the correct store methods with the correct
  payload; remove is disabled/rejected for the last remaining environment; the thread-card tooltip
  shows the resolved environment label only when a match exists, and is unchanged (no label) for a
  single-default-environment snapshot or a non-matching `claudeConfigDir`.
- Run `yarn test:eyes-on-agents:ui`, `yarn check:renderer-i18n` (note: this check is currently
  broken by a pre-existing, unrelated defect logged in `docs/plan/backlog.md` from the iTerm2 Open
  delivery — confirm your change doesn't introduce a NEW i18n mismatch, but do not expect this
  command to exit 0 today; if it has since been fixed, then it must exit 0), `yarn
  typecheck:eyes-on-agents:ui`, and `git diff --check`.
- Confirm every existing `ThreadCard.vue`/`eyesOnAgents.store.ts` test from the iTerm2 Open delivery
  (081-083) still passes unmodified.
- Do not launch Electron. The real two-environment manual verification from the feature doc's
  Acceptance section is owner-only and out of scope for this task's automated verification — note it
  as not run rather than attempting to simulate it.
