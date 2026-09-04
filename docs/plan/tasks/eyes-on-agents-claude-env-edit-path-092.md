---
id: eyes-on-agents-claude-env-edit-path-092
scope: Change an existing environment's directory by editing its path inline, matching task 091's paste flow, instead of opening the native picker
status: done
depends-on: [eyes-on-agents-claude-env-paste-path-091]
verify: focused EyesOnAgents contract/service/render unit tests, Core strict typecheck, UI strict typecheck; no Electron
---

# EyesOnAgents Claude Environment Edit Path

## Objective

Task 091 replaced the native picker in **Add environment** with a pasted absolute path, for a
concrete reason: a Claude config directory is a hidden dotfile directory that the macOS dialog makes
awkward to reach. The per-row **Change directory** action still opens that same picker, so the exact
problem the owner reported survives on the repoint path, and the card now teaches two different
interactions for the same concept. Make **Change directory** an inline path edit too.

## Context

- `ClaudeDirectoryConfigService.chooseCustomDirectory({ id })`
  (`src/main/eyesOnAgents/claudeDirectoryConfig.service.ts:259-282`) calls
  `this.dependencies.pickDirectory()`, then validates with `requireCanonicalClaudeConfigDirectory`,
  and carries a **recovery branch**: when `this.environments === null` (fresh install that never
  persisted, or a saved value that failed to parse) it ignores the id and `resetTo`s a single
  known-good custom environment. That branch is a deliberate contract inherited from the pre-084
  single-directory design and must survive this task unchanged.
- A same-value selection short-circuits (`current.mode === 'custom' && current.configDirectory ===
  configDirectory` returns without persisting). Keep that — it avoids a pointless watcher restart.
- The row already has an inline-edit idiom: `renamingId` + a prefilled input + **Save**/**Cancel**
  (`ClaudeObservationCard.vue`). Mirror it rather than inventing a second shape.
- The empty-id sentinel row (invalid hydration) routes through the legacy zero-arg
  `changeClaudeDirectory()` (`ClaudeObservationCard.vue:682-688`), which goes to
  `ClaudeObservationService.changeDirectory()` and its own picker. See Non-goals.

## Required behavior

- **`chooseCustomDirectory({ id })` becomes `setCustomDirectory({ id, configDirectory })`** and no
  longer calls `pickDirectory()`. It keeps, unchanged: `requireCanonicalClaudeConfigDirectory`
  validation, the `environments === null` recovery reset, the unknown-id rejection, the
  same-value short-circuit, and the `directory-change` lifecycle log.
- **`chooseClaudeEnvironmentDirectory` takes `{ id, configDirectory }`** across `EyesOnAgentsApi`,
  the XPC handler, the service, and the renderer store. Add a params parser beside
  `parseEyesOnAgentsAddClaudeEnvironmentParams` that validates both fields with the same absolute-path
  rule task 091 established, and reuse that rule rather than duplicating the regex.
- **The label is NOT re-derived on a directory change.** Task 091 derives a label only at creation;
  a user who renamed `claude2` to `Work` must not silently get `claude3` back after repointing.
  State this in the code where it would otherwise be tempting.
- **Renderer:** **Change directory** switches that row into an inline path edit, prefilled with the
  row's current resolved path (empty when `Not configured`), with **Save**/**Cancel** mirroring
  Rename. Only one row edits at a time, and starting a directory edit cancels an in-progress rename
  on that row (and vice versa) rather than showing two inputs. Save is disabled while the field is
  empty. A rejected path keeps the editor open with the typed value and surfaces the error through
  the existing action-error line — same contract as 091's add form.
- i18n: add the Save/Cancel/placeholder/aria strings this needs under
  `eyesOnAgents.claudeEnvironment.*` in **both** `en.ts` and `zh.ts`, identical key order. Reuse
  existing `save`/`cancel` keys instead of adding near-duplicates. Remove any key this orphans.
- The **trust-boundary assertion** in `scripts/eyes-on-agents/ui-source.test.mjs` that task 091
  narrowed says repointing an existing environment must NOT accept a renderer-supplied path. This
  task deliberately changes that rule, so update the assertion to its new shape — the renderer still
  must never open a native dialog (`showOpenDialog|pickDirectory` stays forbidden), and Main still
  validates every path — and update the matching prose in
  `docs/features/eyes-on-agents-claude-multi-environment.md`. Do not simply delete the assertion.

## Non-goals

- The empty-id sentinel row's legacy `changeClaudeDirectory()`/`ClaudeObservationService.changeDirectory()`
  picker path. That row exists only when the persisted config failed to hydrate, has no environment
  id to address, and its picker is the recovery affordance of last resort. Leave it; note it.
- Removing `pickDirectory` from the dependency surface. After this task no Claude-environment caller
  uses it, but the sentinel path above and other callers may; deleting it is a separate cleanup.
- Any directory-existence checking in the renderer. Validation stays on the Main side.

## Path

- `src/main/eyesOnAgents/claudeDirectoryConfig.service.ts`
- `src/shared/eyesOnAgents/eyesOnAgents.contract.ts` (params parser; share 091's absolute-path rule)
- `src/shared/eyesOnAgents/eyesOnAgents.type.ts`
- `src/main/xpc/eyesOnAgents.handler.ts`
- `src/main/eyesOnAgents/eyesOnAgents.service.ts`
- `src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts`
- `src/renderer/eyesOnAgents/src/components/ConnectionPanel/ClaudeObservationCard.vue`
- `src/renderer/common/i18n/en.ts`, `src/renderer/common/i18n/zh.ts`
- `scripts/eyes-on-agents/` — parser tests, config-service tests covering the preserved recovery /
  unknown-id / same-value branches, and a render test for the inline edit
- `docs/features/eyes-on-agents-claude-multi-environment.md`,
  `docs/integrations/eyes-on-agents-layout.md`

## Verify

- `yarn typecheck:eyes-on-agents:core`, `yarn typecheck:eyes-on-agents:ui`
- `yarn test:eyes-on-agents:claude`, `yarn test:eyes-on-agents:ui`
- `yarn eslint` on each touched source file — no new errors.
- Do **not** run Electron, packaged builds, Playwright, or any `test:e2e:*` suite.
- Two pre-existing failures are not this task's: the deterministic `ui-source.test.mjs` bundle-id
  assertion, and the ~6/10 flaky `thread-card-open-capability.test.mjs` right-click test.
- Owner-only manual check: repoint an environment by pasting a path, confirm the row updates and its
  watcher restarts; confirm a bogus path errors without closing the editor; confirm the label is
  unchanged by the repoint.

## Implementation evidence

- **`ClaudeDirectoryConfigService`**: `setCustomDirectory({ id, configDirectory })` replaces the
  picker call with the pasted path and keeps every other branch byte-for-byte — the
  `environments === null` recovery reset, the unknown-id rejection, the same-value short-circuit,
  and the `directory-change` lifecycle log. `chooseCustomDirectory({ id })` survives as a **thin
  wrapper** (pick → return `null` on cancel → delegate to `setCustomDirectory`) because
  `ClaudeObservationService.changeDirectory()` — the synthetic invalid-hydration row's recovery
  path — still needs it, and that was a declared Non-goal. No persist logic is duplicated.
- **Label is not re-derived on repoint.** Derivation lives in `addEnvironment` only; a test asserts a
  renamed environment keeps its name across a directory change.
- **Shared path rule**: `parseEyesOnAgentsClaudeConfigDirectory` is now one private helper used by
  both `parseEyesOnAgentsAddClaudeEnvironmentParams` and the new
  `parseEyesOnAgentsSetClaudeEnvironmentDirectoryParams`, rather than a copied regex.
- **Signature threaded** through `EyesOnAgentsApi`, the handler, the service, and the store
  (`chooseClaudeEnvironmentDirectory(id, configDirectory)`).
- **Renderer**: `editingDirectoryId`/`directoryDraft` mirror `renamingId`/`renameLabelDraft`.
  **Change directory** swaps the row's read-only path field for an editable one prefilled with that
  row's configured directory (empty when unconfigured), with Save/Cancel. Starting a directory edit
  cancels an in-progress rename on that row and vice versa, so a row never shows two editors. Save
  is disabled while empty; a rejected path keeps the editor open with the typed value. The empty-id
  sentinel row still routes to the legacy zero-arg picker.
- **i18n**: no new keys — `save`/`cancel` and the existing directory placeholder / `pathLabel` aria
  string are reused, as the contract asked.

### The trust-boundary assertion, rewritten rather than relaxed again

Task 091's review showed its narrowed assertion could not prove exclusivity (a positive
`assert.match` on the allowed methods let a component sending `{ configDirectory: '/tmp/evil' }`
pass). This task legitimately adds a *second* path that carries a directory, so the assertion was
rebuilt as a **negative** check over the whole renderer tree: exactly two files —
`ClaudeObservationCard.vue` and `eyesOnAgents.store.ts` — may mention `configDirectory` at all, and
`useAutomaticClaudeEnvironment` still may not take a path. `showOpenDialog|pickDirectory` remains
forbidden renderer-wide. A new renderer file touching `configDirectory` now fails the suite by
construction rather than by someone remembering to add a matcher.

### Tests

- `claude-environment-config.test.mjs`: rewritten for the new `addEnvironment({ configDirectory })`
  shape (asserting the derived label `config-a`), plus `setCustomDirectory` coverage for the
  targeted-mutation, label-preservation, same-value-no-rewrite, unknown-id and nonexistent-directory
  branches, and the cancelled-picker no-op through the retained wrapper.
- `claude-environment-setup-command.test.mjs`: the new params parser shares the add parser's
  rejections (relative, tilde, empty), requires both fields, and rejects extra keys and a non-UUID id.
- `claude-environment-render.test.mjs`: Change directory opens an editor prefilled with that row's
  own path, and Save sends the trimmed path scoped to that row.
- `ui-source.test.mjs`: the sentinel check now reads `environment.id`, the store-call matcher follows
  the new signature, and the boundary assertion is the negative form described above.

### Verification

- `yarn typecheck:eyes-on-agents:core` — 0 errors. `yarn typecheck:eyes-on-agents:ui` — 0 errors.
- `yarn test:eyes-on-agents:claude` — all 4 groups `fail 0`.
- `yarn test:eyes-on-agents:ui` — 105 tests, 104 pass, 1 fail: only the already-logged deterministic
  `ui-source.test.mjs` bundle-id assertion (the flaky right-click test passed this run). Three
  failures appeared during the work — the obsolete empty-label rejection, the old picker-based render
  test, and two stale source matchers — each traced and fixed rather than suppressed.
- `yarn eslint` on all 8 touched source files — 0 new errors; the same 4 pre-existing ones remain
  (`prefer-const` ×3, `no-useless-escape` ×1).
- Electron, packaged builds, Playwright, `test:e2e:*` — not run.

## Review

Not yet independently reviewed. Delivered together with task 091's review fixes.
