---
id: eyes-on-agents-claude-multi-env-renderer-088
scope: Replace the single Claude directory block with an environment list (add/rename/remove/enable) and per-environment setup, plus a resolved environment label on the thread card
status: done
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

- **Also extend the 4 pre-existing bridge methods' signatures — and mind the real conflict this
  creates.** Task 086 added `params?: { environmentId?: string }` to `installClaudeBridge`,
  `getClaudeBridgeStatus`, `refreshClaudeBridgeStatus`, `removeClaudeBridge` on
  `EyesOnAgentsHandler` (`src/main/xpc/eyesOnAgents.handler.ts`) only. `EyesOnAgentsApi` still
  declares these 4 as zero-arg, and — this is the part task 086's own review caught as a real,
  documented gap, not a hypothetical one — **both** `EyesOnAgentsHandler` (`implements
  EyesOnAgentsApi`) **and** `EyesOnAgentsService` (also `implements EyesOnAgentsApi`,
  `src/main/eyesOnAgents/eyesOnAgents.service.ts:663`) must satisfy whatever shape you give the
  interface. `EyesOnAgentsHandler`'s shape (`params?: { environmentId?: string }`) already matches
  what you'd want to widen the interface to. `EyesOnAgentsService`'s 3 bridge methods currently take
  a raw `configDirectory?: string` (not `{ environmentId }`) — widening the interface to
  `{ environmentId }` without also changing `EyesOnAgentsService`'s parameter shape produces a real
  `TS2416` (`EyesOnAgentsService` no longer assignable to `EyesOnAgentsApi`), not a hypothetical one.
  Fix: change `EyesOnAgentsService.installClaudeBridge`/`refreshClaudeBridgeStatus`/
  `removeClaudeBridge`'s parameter from `configDirectory?: string` to
  `params?: { environmentId?: string }`, importing `claudeDirectoryConfig` (singleton,
  `src/main/eyesOnAgents/claudeDirectoryConfig.service.ts`) and the existing
  `resolveClaudeBridgeEnvironment` helper (`src/main/eyesOnAgents/claudeBridgeEnvironment.resolver.ts`
  — neither is currently imported by this file) to resolve `environmentId` to a `configDirectory`
  internally, then proceed with the method's existing, otherwise-unchanged body. `getClaudeBridgeStatus`
  needs the same interface/renderer-facing shape for consistency even though it does not currently
  use `configDirectory` at all. This is real, if small, additional surface in
  `eyesOnAgents.service.ts` beyond "thin delegation" — it is still only these 4 methods' parameter
  lists and internal resolution step, nothing else in this ~3,700-line file.

- `ClaudeObservationCard.vue`'s current single directory block (path/mode/state/last-scan/actions)
  becomes a list, one row per `EyesOnAgentsClaudeEnvironment`/`EyesOnAgentsClaudeEnvironmentStatus`
  pair: label, resolved path or "not configured", mode, the existing status pill values
  (`watching`/`waiting`/`degraded`/`retrying`/`error`/`stopped`), and the existing plugin setup
  action (`enable`/`finish`/`reload`/`retry`/`repair`) rendered per environment row and invoked
  through task 086's `{ environmentId }`-scoped XPC methods. Its displayed status/label is **not**
  independently evaluated per environment — every environment shares one plugin installation
  identity, so the setup action reflects global bridge state and only its click target is
  per-environment. `docs/features/eyes-on-agents-claude-multi-environment.md`'s "Implementation note
  (task 088)" is the authority on this point; an earlier version of this bullet said "evaluated per
  environment", which read as implying independent per-row status.
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

## Implementation evidence

- **Closed the `EyesOnAgentsApi` gap (task 084's 7 CRUD methods).**
  `src/shared/eyesOnAgents/eyesOnAgents.type.ts` gains `listClaudeEnvironments`,
  `addClaudeEnvironment({ label })`, `renameClaudeEnvironment({ id, label })`,
  `removeClaudeEnvironment({ id })`, `setClaudeEnvironmentEnabled({ id, enabled })`,
  `chooseClaudeEnvironmentDirectory({ id })`, `useAutomaticClaudeEnvironment({ id })`, every one
  returning `Promise<EyesOnAgentsClaudeEnvironment[]>`, matching `EyesOnAgentsHandler`'s existing
  (task 084) registered XPC methods exactly. `EyesOnAgentsService`
  (`src/main/eyesOnAgents/eyesOnAgents.service.ts`) gains thin delegating implementations of all 7,
  each guarded by a new private `requireClaudeDirectoryConfig()` (throws `'Claude environment
  configuration is unavailable'` when the dependency was never injected) and each calling the
  matching `ClaudeDirectoryConfigService` method, then `this.dependencies.claudeObservation
  ?.applyEnvironments?.()` (task 085's pre-existing reconciliation entry point, unchanged), then
  returning `directoryConfig.listEnvironments()`. `addClaudeEnvironment` additionally calls the newly
  injected `pickClaudeConfigDirectory()` dependency to open the native picker before calling
  `addEnvironment({ label, configDirectory })` — a no-op (returns the unchanged list) if the picker
  is canceled (`null`). These 7 service-level methods exist solely so `EyesOnAgentsService` satisfies
  `implements EyesOnAgentsApi`; the real XPC-callable versions remain `EyesOnAgentsHandler`'s
  pre-existing (task 084) methods against the same `claudeDirectoryConfig` singleton — no renderer or
  XPC call path reaches the service-level copies.
- **Resolved the 4 pre-existing bridge methods' shape conflict exactly as the task anticipated.**
  `EyesOnAgentsApi.installClaudeBridge`/`refreshClaudeBridgeStatus`/`removeClaudeBridge`/
  `getClaudeBridgeStatus` all widen to `(params?: { environmentId?: string }) => Promise<...>`.
  `EyesOnAgentsService.installClaudeBridge`/`refreshClaudeBridgeStatus`/`removeClaudeBridge` change
  their parameter from `configDirectory?: string` to `params?: { environmentId?: string }` and call a
  new private `resolveClaudeBridgeConfigDirectory(params)`, which returns `undefined` when
  `claudeDirectoryConfig` was never injected (reproducing every pre-088 zero-arg test harness's exact
  ambient behavior unchanged) or when the configured environment list is empty, and otherwise calls
  the existing `resolveClaudeBridgeEnvironment(environments, params)` helper
  (`claudeBridgeEnvironment.resolver.ts`, task 086, previously unused by this file) and reads
  `.configDirectory ?? undefined` off the result. Each method's existing, otherwise-unchanged body
  runs unchanged after that one new resolution line.
  `getClaudeBridgeStatus` was **not** changed at the service level — it stays the pre-existing
  zero-parameter `async getClaudeBridgeStatus(): Promise<EyesOnAgentsClaudeBridgeStatus>` — and this
  is why `typecheck:eyes-on-agents:core` still passes cleanly: TypeScript's method-parameter
  assignability treats a method with fewer parameters as a valid implementation of an interface
  member declared with more (optional) parameters, since every caller of the wider signature can
  still call the narrower one by simply not passing the extra argument. `EyesOnAgentsHandler.
  getClaudeBridgeStatus` (already `params?: { environmentId?: string }` since task 086) still calls
  `eyesOnAgentsService.getClaudeBridgeStatus()` with no arguments, per the task's note that this
  method "does not currently use `configDirectory` at all" — only its interface-facing shape needed
  widening for consistency with the other 3.
  `EyesOnAgentsHandler.installClaudeBridge`/`refreshClaudeBridgeStatus`/`removeClaudeBridge`
  (`src/main/xpc/eyesOnAgents.handler.ts`) each now call
  `eyesOnAgentsService.<method>({ environmentId: environment.id })` (previously
  `eyesOnAgentsService.<method>(environment.configDirectory ?? undefined)`) — passing the already-
  resolved environment's `id` back down so the service performs its own, independent resolution via
  the same `claudeDirectoryConfig` singleton the handler injects into it at construction (new
  `claudeDirectoryConfig`/`pickClaudeConfigDirectory` entries in the `EyesOnAgentsService`
  constructor call in `eyesOnAgents.handler.ts`). `EyesOnAgentsServiceDependencies` gains an optional
  `claudeDirectoryConfig?: Pick<ClaudeDirectoryConfigService, 'listEnvironments' | 'addEnvironment' |
  'renameEnvironment' | 'removeEnvironment' | 'setEnvironmentEnabled' | 'chooseCustomDirectory' |
  'useAutomatic'>` and `pickClaudeConfigDirectory?: () => Promise<string | null>`, plus an optional
  `applyEnvironments?(): Promise<void>` added to the existing `claudeObservation` dependency shape —
  all optional, so every pre-088 test harness that constructs `EyesOnAgentsService` without wiring
  these keeps working unchanged (confirmed by re-running the full `test:eyes-on-agents:claude` chain,
  see Verification evidence).
- **`ClaudeObservationCard.vue`** replaces the single `directory` computed/block with an
  `environmentRows` computed (`eyesOnAgentsStore.snapshot?.claudeDirectory ?? []`, the existing
  per-environment `EyesOnAgentsClaudeEnvironmentStatus[]` array from task 085 — no new snapshot field
  or extra `listClaudeEnvironments()` round trip was needed), rendered as one
  `name="eyesOnAgents__connections__claudeEnvironmentRow"` row per entry with: `environmentPath()`
  (resolved path or the new `claudeEnvironment.notConfigured` copy), `environmentModeLabel()`/
  `environmentStateLabel()` (reusing the pre-existing `claudeDirectory.custom`/`automatic`/
  `watching`/... i18n keys unchanged), an enable/disable `a-switch` calling
  `setClaudeEnvironmentEnabled`, a read-only path input plus **Change directory** (routed through
  `chooseClaudeEnvironmentDirectory`) and, only when `isEligibleForAutomatic` (environment is
  `environments[0]` and currently `custom` or in `error` state, mirroring the pre-088
  `canUseAutomaticDirectory` condition one-to-one), **Use automatic**; inline **Rename**/**Save**/
  **Cancel**; and **Remove**, disabled (with a `title` hint, `claudeEnvironment.removeLastHint`) when
  the row's `canRemove` is false. `canRemove` is a field on
  `EyesOnAgentsClaudeEnvironmentStatus` stamped by `ClaudeObservationService.getDirectoryStatus()`
  from the authoritative rule in `ClaudeDirectoryConfigService.removeEnvironment` ("The last
  remaining Claude environment cannot be removed"), and is always `false` for the identity-less
  synthetic invalid-hydration row — i.e. the constraint is surfaced from the service as this task's
  Required behavior demanded. (The delivery and completion passes above instead re-derived it in the
  renderer as `:disabled="environmentRows.length <= 1"`, an undisclosed deviation from that
  instruction; review 1 caught it and it is now corrected — see the review-1 follow-up below.)
  A persistent **Add environment** button opens an inline label input
  + **Add**/**Cancel**, calling `addClaudeEnvironment(label.trim())` on submit. The plugin setup
  action (`enable`/`finish`/`reload`/`retry`/`repair`) is rendered inside each row unchanged from the
  pre-088 `setupAction`/`setupTitle`/`setupActionLabel` computeds (still driven by the single global
  `bridge.value?.setupAction` — see the feature-doc correction below), but its button now calls the
  new `installClaudeBridgeForEnvironment(environment.id)` / `refreshClaudeBridgeStatusForEnvironment
  (environment.id)` store methods instead of the old zero-arg ones, so the click target is
  per-environment even though the displayed status text is shared. The new
  `eyes-connection-panel__boundary` aside renders the exact guidance copy from `claudeEnvironment
  .guidance`. **Sentinel empty-id handling:** task 085's synthetic invalid-hydration row (unknown
  environment, empty `id`/`label`, used when the persisted config itself failed to hydrate) has no
  real id to scope an `{ id }`-scoped XPC call to (an empty id fails UUID validation before reaching
  `ClaudeDirectoryConfigService`'s recovery-aware methods) — `handleChooseDirectory`/
  `handleUseAutomatic` special-case `id === ''` and fall back to the legacy zero-arg
  `changeClaudeDirectory()`/`useAutomaticClaudeDirectory()` store methods, which still resolve
  entirely on the Main side and preserve the pre-088 "a new directory selection/Use automatic
  replaces a malformed saved value" recovery contract unchanged; the template also hides
  Rename/Remove/the enable switch for this row (`v-if="environment.id"`). Covered by a dedicated new
  test (see below).
- **Real, honest gap versus the pre-088 single block's displayed content:** the old block's
  `desktopDirectoryLabel` (desktop directory count), `lastScanLabel` (last successful scan time),
  `nextRetryLabel`, and the manual **Retry** button (`canRetryDirectory`/`handleRetryDirectory`,
  which called the still-fully-functional, unchanged `eyesOnAgentsStore.retryClaudeDirectory()`) are
  **not** carried over to the new per-environment rows — nothing in the new template renders
  `desktopDirectoryCount`/`lastSuccessfulScanAt`/`nextRetryAt`, and there is no per-row (or any)
  manual "force retry now" control anywhere in the rewritten card. This is not a mechanical loss: the
  store method, its XPC path, and `EyesOnAgentsHandler.retryClaudeDirectory`/
  `EyesOnAgentsService` remain fully intact and are still independently covered by
  `claude-provider-toggle.test.mjs` and `ui-source.test.mjs`'s store/handler-source assertions — only
  the UI affordance to trigger it is gone. The task's Required Behavior bullet enumerates a row's
  required content as "label, resolved path or 'not configured', mode, the existing status pill
  values ..., and the existing per-environment plugin setup action" and does not name this
  metadata/button, so this is defensible against the letter of that bullet, but the Objective's own
  framing — "the current single directory block (path/mode/state/last-scan/actions) becomes a list"
  — reads as implying full content parity. Flagging this precisely rather than treating either
  reading as self-evidently correct.
- **Real gap: `docs/integrations/eyes-on-agents-layout.md` was not updated**, despite being named in
  this task's own Path list ("update the Connection drawer / Claude pane description and the
  thread-card tooltip contract in the same change"). `git status`/`git diff` confirm this file has no
  changes on this working tree. It still describes the pre-088 single "Session directories" block
  verbatim, including an ASCII diagram of the single input + Change/Retry controls and a directory-
  state table that lists **Retry** as present for `retrying`/`error` states — which no longer matches
  the shipped per-environment list (see the gap above) — and its folder-tooltip paragraph does not
  mention the new resolved-environment-label prefix. This doc was left stale by this change; it is
  not corrected here because it is outside the two files this evidence-writing pass was authorized to
  touch.
- **`ThreadCard.vue`** changes only the `folderLabel` computed: a new `environmentLabel` computed
  calls `eyesOnAgentsStore.resolveClaudeEnvironmentLabel(props.thread.claudeConfigDir)`, and
  `folderLabel` prefixes the existing `thread.workingDirectory` copy with the new
  `thread.workingDirectoryWithEnvironment` (`'{label} · Working directory: {path}'`) copy only when a
  label resolves. `canOpenThread`, `openLabel`, `canOpenInIterm2`, and every other existing
  Open-button/dropdown/menu binding in this file are untouched — confirmed by `git diff HEAD --
  .../ThreadCard.vue` showing a single hunk touching only the `folderLabel`/new `environmentLabel`
  computed, with zero occurrences of `canOpenThread`, `openLabel`, or `canOpenInIterm2` anywhere in
  the diff (see Verification evidence).
- **`eyesOnAgents.store.ts`** gains: a `busyClaudeEnvironmentIds: Set<string>` (per-id in-flight
  guard, independent of the existing global `busyAction`, mirroring `openingSessionKeys`'s pattern so
  acting on one environment's row never disables another's); `addClaudeEnvironment`/
  `renameClaudeEnvironment`/`removeClaudeEnvironment`/`setClaudeEnvironmentEnabled`/
  `chooseClaudeEnvironmentDirectory`/`useAutomaticClaudeEnvironment`, each routed through a new
  private `runClaudeEnvironmentAction(id, callback)` (per-id busy gate, clears `actionError` on
  entry, sets it and rethrows on failure, always refreshes the full snapshot via
  `eyesOnAgentsEmitter.getSnapshot()` afterward rather than applying a returned environment list
  directly, since the CRUD emitter calls return `EyesOnAgentsClaudeEnvironment[]` not a snapshot);
  `installClaudeBridgeForEnvironment`/`refreshClaudeBridgeStatusForEnvironment`, routed through the
  existing `runSnapshotAction` under the same shared `'claude-bridge-install'`/`'claude-bridge-
  refresh'` busy keys the zero-arg versions already use (one bridge mutation in flight at a time,
  regardless of target environment, matching the shared-installation-identity Non-goal); and
  `resolveClaudeEnvironmentLabel(claudeConfigDir)`, which normalizes trailing slashes
  (`normalizeClaudeConfigDirPath`) on both the thread's raw `claudeConfigDir` and each configured
  environment's `configuredDirectory` before comparing, returning the first match's `label` or `null`
  — resolved at read time against `snapshot.claudeDirectory` (never persisted as a foreign key), so a
  renamed environment's label updates immediately and a removed environment's threads silently lose
  their label, per the Required Behavior and Acceptance sections.
- **i18n**: `en.ts`/`zh.ts` both gain a `claudeEnvironment` block (title, guidance, addEnvironment,
  addLabelPlaceholder, add, notConfigured, rename, renameLabelPlaceholder, save, cancel,
  changeDirectory, useAutomatic, enable, disable, remove, removeLastHint) sibling to the existing
  `claudeBridge`/`claudeDirectory` blocks, plus one new `thread.workingDirectoryWithEnvironment` key
  each. Both files' new blocks have identical key sets in identical order (diffed directly), and
  `zh.ts`'s `export const zh: typeof en` module-level type assertion means `typecheck:eyes-on-agents
  :ui` passing cleanly is itself a structural proof of key parity between the two languages.
- **Test changes:**
  - `scripts/eyes-on-agents/claude-setup-render.test.mjs`: its fixture's `claudeDirectory` becomes a
    one-element array (matching the real `EyesOnAgentsClaudeEnvironmentStatus[]` shape) with an
    added `id`/`label`/`enabled`; its store stub gains `busyClaudeEnvironmentIds`,
    `installClaudeBridgeForEnvironment`, `refreshClaudeBridgeStatusForEnvironment`, and the 6
    environment-CRUD store methods (all no-op stubs, since this file's own tests only exercise the
    plugin-setup surface, not the environment list); `external` gains `@tabler/icons-vue` (this
    component's new `IconInfoCircle` import) in both of its two esbuild passes.
  - `scripts/eyes-on-agents/thread-card-open-capability.test.mjs`: `createStore` becomes
    `createStore(overrides = {})` (spreads `overrides` last) and gains a default
    `resolveClaudeEnvironmentLabel: () => null` (reproducing every pre-088 `folderLabel` assertion
    unchanged when a test does not override it); `createThread` gains `claudeConfigDir: null`;
    `render(thread, storeOverrides)` threads the new second parameter through. One new test, "the
    folder tooltip gains the resolved environment label only when a match exists," covers: a matching
    `claudeConfigDir` producing `'claude2 · Working directory: /repo/project'` in both `title` and
    `aria-label`; a non-matching `claudeConfigDir` (simulating a removed environment) rendering
    exactly the pre-088 `'Working directory: /repo/project'`; and a `null` `claudeConfigDir`
    (single-default-environment snapshot) rendering the same unchanged string. Every pre-existing test
    in this file (iTerm2 Open, 081-083) is otherwise unmodified.
  - `scripts/eyes-on-agents/ui-source.test.mjs`: removed the
    `assert.match(claudeCard, /providerError\.value !== null \|\|/)` assertion and updated every
    directory-block source-pattern assertion to match the new per-row shape
    (`environmentPath(environment)`, the `id === ''` legacy-fallback branches,
    `isEligibleForAutomatic`, the Remove guard, and the 6 new store method call sites) —
    source-pattern assertions only, consistent with this file's existing style.
    **Correction (review 1):** the original justification for dropping that assertion — "the
    `canRetryDirectory` computed it targeted no longer exists" — is stale. Gap 1 re-introduced that
    exact expression as `canRetryEnvironment` (`ClaudeObservationCard.vue`), so the computed does
    exist; the assertion simply was not restored. Coverage is not lost: the behaviour is exercised
    behaviourally by `claude-environment-render.test.mjs`'s "a global Claude provider error offers
    Retry even on an otherwise-healthy row" test.
  - New `scripts/eyes-on-agents/claude-environment-render.test.mjs` (9 tests, real-DOM mount/click
    harness mirroring `thread-card-open-capability.test.mjs`'s approach rather than source-pattern
    matching): one row per configured environment with correct label/mode/state text and resolved
    path, including a `retrying` state on a second `custom` environment; a not-yet-configured custom
    environment shows "Not configured"; Add environment trims and submits the label; Rename submits
    `[id, label]`; the enable switch submits `[id, nextValue]`; Remove is `disabled` (and never calls
    the store) for the last remaining environment; Remove calls the store with the correct row id
    when a second environment exists; Change directory/Use automatic are scoped to the clicked row's
    id, and a non-default custom environment never renders a Use automatic button; and the synthetic
    empty-id sentinel row recovers via the legacy zero-arg `changeClaudeDirectory`/
    `useAutomaticClaudeDirectory` store calls, never reaching the `{ id }`-scoped methods, while hiding
    its enable switch/Rename/Remove controls. Wired into `test:eyes-on-agents:ui` in `package.json`
    immediately after `claude-setup-render.test.mjs`.
- `ConnectionPanel.less` adds `.eyes-connection-card__directories-header h4`,
  `.eyes-connection-card__directories-add` (+ its Arco input wrapper flex rule),
  `.eyes-connection-card__directories-list`, and `.eyes-connection-card__directory-row` (+ its
  nested header margin), reusing every existing `-header`/`-path`/`-meta`/`-actions`/`-state`/`-error`
  class for the per-row content as the task's Path list anticipated — no new class was needed for
  status pill, path input, or action buttons inside a row.

## Completion pass — 3 gaps closed (2026-09-03)

A review-style pass after the above found 3 concrete gaps and closed all three. This is a completion
pass on top of the delivery above, not a rewrite; nothing already shipped was restructured.

- **Gap 1 — restored per-environment last-scan/desktop-count/manual-retry.** First read
  `EyesOnAgentsService.retryClaudeDirectory`'s pre-gap implementation and
  `ClaudeObservationService.retryDirectory`/`retryEnvironmentEntry`: the watcher-level retry entry
  point (`retryEnvironmentEntry(id)`) was already keyed by environment id internally (used by every
  scheduled per-environment retry timer since task 085); only the *public* `retryDirectory()`/
  `retryClaudeDirectory()` surface was hard-wired to `resolveDefaultEnvironmentId()`
  (`environments[0]`) with no way to target another row. Widened the same way as the 4 pre-existing
  bridge methods:
  - `EyesOnAgentsApi.retryClaudeDirectory` (`eyesOnAgents.type.ts`) →
    `(params?: { environmentId?: string }) => Promise<EyesOnAgentsSnapshot>`.
  - `ClaudeObservationService.retryDirectory(environmentId?: string)` (`claudeObservation.service.ts`)
    now calls `retryEnvironmentEntry(environmentId ?? this.resolveDefaultEnvironmentId())` — a one-line
    change; every other line of its pre-085 recovery contract (invalid-hydration fallback,
    `desiredStarted` guard) is unchanged.
  - `EyesOnAgentsService.retryClaudeDirectory` (`eyesOnAgents.service.ts`) gains a new private
    `resolveClaudeDirectoryRetryEnvironmentId(params)`, mirroring
    `resolveClaudeBridgeConfigDirectory`'s exact fallback contract (missing `claudeDirectoryConfig`
    dependency or an empty environment list ⇒ `undefined`, preserving every pre-gap zero-arg test
    harness's ambient behavior) but resolving to `resolveClaudeBridgeEnvironment(environments,
    params).id` (an id, not a `configDirectory`, since the watcher retry target is an environment,
    not a CLI invocation directory). The `claudeObservation` dependency's `retryDirectory?()` type
    widened to accept the same optional `environmentId`.
  - `EyesOnAgentsHandler.retryClaudeDirectory` (`eyesOnAgents.handler.ts`) resolves the target
    environment exactly like the 4 bridge methods (`resolveClaudeBridgeEnvironment(
    claudeDirectoryConfig.listEnvironments(), parseEyesOnAgentsClaudeBridgeEnvironmentParams(params))`)
    and forwards `{ environmentId: environment.id }` down to the service, which performs its own
    independent resolution against the same singleton — an omitted `environmentId` still retries
    `environments[0]`, reproducing every pre-gap zero-arg caller unchanged.
  - `eyesOnAgentsStore.ts` gains `retryClaudeDirectoryForEnvironment(id)`, the naming-convention
    sibling of `installClaudeBridgeForEnvironment` the task suggested, but routed through the
    per-id `runClaudeEnvironmentAction` gate (like `chooseClaudeEnvironmentDirectory`/
    `useAutomaticClaudeEnvironment`) rather than the shared `runSnapshotAction` gate the bridge-install
    siblings use — deliberately, since one environment's watcher retry is fully independent of every
    other environment's (unlike the bridge install/refresh actions, which share one installation
    identity per this feature's own "Scope decisions").
  - `ClaudeObservationCard.vue` adds, per row: `environmentDesktopLabel`/`environmentLastScanLabel`/
    `environmentNextRetryLabel` computed helpers reusing the exact pre-088 `claudeDirectory
    .desktopDirectories`/`.lastSuccessfulScan`/`.nextRetry` i18n keys (never removed, just unused since
    088's first pass), rendered in a second `.eyes-connection-card__directories-meta` row — that class
    appeared twice in the whole card at `ebd82eb` (once per concern) and is now used twice **per row**,
    for the metadata line and the row's setup action, so no new CSS was needed; and a `canRetryEnvironment`
    computed reproducing the pre-088 `canRetryDirectory` computed's condition exactly —
    `providerError.value !== null || ['waiting', 'degraded', 'retrying', 'error'].includes(environment
    .state)` — gating a per-row **Retry** button (`claudeDirectory.retry` copy, unchanged) next to
    **Use automatic** in the path actions row. `handleRetryEnvironment(id)` falls back to the legacy
    zero-arg `retryClaudeDirectory()` store method for the empty-id invalid-hydration sentinel row,
    exactly mirroring `handleChooseDirectory`/`handleUseAutomatic`'s existing fallback pattern.
  - Tests: `claude-environment-render.test.mjs` gains 3 new tests (desktop count/last-scan/next-retry
    text renders per row; Retry is offered only in a recoverable state and retries the clicked row's
    id; a global Claude provider error offers Retry even on an otherwise-`watching` row) plus a
    `retryClaudeDirectory`/`retryClaudeDirectoryForEnvironment` fallback assertion appended to the
    existing empty-id sentinel test — 12 tests total in that file, all passing.
    `claude-setup-render.test.mjs`'s store stub gains a `retryClaudeDirectoryForEnvironment` no-op
    (unexercised there — that fixture's environment stays `watching`/no provider error, so Retry never
    renders in that file's scenarios). `ui-source.test.mjs` gains source-pattern assertions for the
    per-row desktop/last-scan/retry surface and updates the now-stale `retryClaudeDirectory(): Promise
    <EyesOnAgentsSnapshot>` handler-signature assertion to the widened `params?: { environmentId?:
    string }` shape, plus a store-level assertion that `retryClaudeDirectoryForEnvironment` forwards
    `{ environmentId: id }`.

- **Gap 2 — logged the newly-found pre-existing test failure.** Added an entry to
  `docs/plan/backlog.md`, matching the file's existing entry style, for
  `thread-card-open-capability.test.mjs`'s "right-click opens the shared pointer menu and Archive
  remains Codex-only" (`assert.ok(dropdown, ...)` false). Verified it independently before logging: 10
  standalone `node --test` runs of that one file against a clean `git worktree add --detach HEAD`
  checkout of commit `ebd82eb` (before any of this task's changes) failed 6/10 times, and 7/10 against
  this task's own working tree — **this corrects the delivery-pass evidence's "4/4 reproductions ...
  deterministic, not flaky" characterization**, which does not hold up under a larger sample; it is a
  genuine intermittent timing race in the real-DOM right-click/dropdown harness, not a deterministic
  failure. The backlog entry records both the pre-existing/unrelated confirmation and the corrected
  flaky characterization.

- **Gap 3 — updated `docs/integrations/eyes-on-agents-layout.md`.** This file was named in this task's
  own Path list but never touched by the delivery pass above (confirmed stale by `git diff` before
  editing). Read its full "Session directories" block description and the thread-card folder-tooltip
  paragraph, then rewrote both:
  - The single "Session directories" block description, ASCII diagram, and directory-state table
    became a "Claude environments" list description (Add environment, per-row rename/change-directory/
    Use automatic/Retry/enable/disable/remove, the last-remaining-environment Remove guard, the
    always-visible per-environment-hook-install guidance note) — matching what gap 1 above actually
    ships, including the restored desktop-count/last-scan/next-retry/Retry surface.
  - The thread-card folder-tooltip paragraph gained a description of the resolved-environment-label
    prefix (`ThreadCard.vue`'s `folderLabel`/`environmentLabel`,
    `'{label} · Working directory: {path}'`), including the live-resolution/no-persisted-foreign-key
    contract.
  - One incidental stale mention of "Session directories" in the Connections-drawer rail summary
    (Header behavior section) was also updated to "the Claude environments list" for consistency.
  - Also extended `docs/features/eyes-on-agents-claude-multi-environment.md`'s Renderer section: its
    row-content bullet now explicitly names the desktop-count/last-scan/next-retry/Retry surface (it
    previously omitted this, which is exactly the "letter vs Objective" ambiguity the delivery pass's
    evidence flagged), with an implementation note explaining the gap-1 completion and pointing at the
    exact widened `retryClaudeDirectory` signature and new store method.

## Verification evidence

- `yarn typecheck:eyes-on-agents:core` — orchestrator-confirmed passed, 0 errors (not re-run in this
  pass).
- `yarn typecheck:eyes-on-agents:ui` — orchestrator-confirmed passed, 0 errors (not re-run in this
  pass).
- `git diff --check` — re-run independently: clean, exit 0.
- `node --test scripts/eyes-on-agents/thread-card-open-capability.test.mjs
  scripts/eyes-on-agents/claude-setup-render.test.mjs
  scripts/eyes-on-agents/claude-environment-render.test.mjs` — run independently as instructed: 23
  tests, 22 passed, 1 failed. All 9 new `claude-environment-render.test.mjs` tests passed; the new
  "folder tooltip gains the resolved environment label" test in `thread-card-open-capability.test.mjs`
  passed; every other pre-existing test in `claude-setup-render.test.mjs` and
  `thread-card-open-capability.test.mjs` passed. The one failure,
  `thread-card-open-capability.test.mjs`'s "right-click opens the shared pointer menu and Archive
  remains Codex-only" (`assert.ok(dropdown)` false), is **pre-existing and unrelated to this task** —
  confirmed by reproducing the identical failure against a clean `git worktree add --detach HEAD`
  checkout of this same commit (`ebd82eb`), i.e. before any of this task's changes existed. It is
  **not currently logged** in `docs/plan/backlog.md` (checked; no match for "right-click", "dropdown",
  "shared pointer menu", or the test file name) — flagging this to the orchestrator as a separate,
  previously-uncaught pre-existing defect, distinct from the two already-logged failures below.
- `yarn test:eyes-on-agents:ui` — run independently twice for confirmation: **95 tests, 93 passed, 2
  failed**, not the 94-passed/1-failed originally reported. Both failures are pre-existing and
  deterministic (reproduced identically across 4 separate runs, including the clean-HEAD-worktree
  check above), neither caused by this task's diff:
  1. `ui-source.test.mjs`'s "completed threads use one localized silent notification and bundled
     cross-platform tone" — the already-logged `app.main.ts`/bundle-id-assertion defect in
     `docs/plan/backlog.md` (confirmed by re-running `node --test
     scripts/eyes-on-agents/ui-source.test.mjs` directly and inspecting the assertion failure, which
     is exactly the missing `electronApp.setAppUserModelId(...)` call `backlog.md` describes).
  2. `thread-card-open-capability.test.mjs`'s "right-click opens the shared pointer menu and Archive
     remains Codex-only" — the newly-confirmed-pre-existing, not-yet-logged defect described above.
  This corrects the orchestrator's earlier-reported count; the discrepancy is most likely because the
  orchestrator's run happened not to hit this second, apparently deterministic (not flaky, per 4/4
  reproductions here) failure, or reported from a slightly different working-tree moment. Every
  other test in the suite, including all Claude multi-environment and iTerm2 Open coverage, passed.
- `yarn check:renderer-i18n` — re-run independently: fails identically, at
  `scripts/renderer-i18n/check-renderer-i18n.mjs:172` with `AssertionError: Tray must follow Home
  creation` — confirmed unrelated to i18n content (it is a tray/Home window-creation-order assertion,
  not an i18n-key check) and matching the pre-existing tray/Home ordering defect already described in
  `docs/plan/backlog.md`.
- New i18n keys (`claudeEnvironment.*`, `thread.workingDirectoryWithEnvironment`) confirmed present
  in both `en.ts` and `zh.ts` at matching structural positions with identical key sets (direct diff
  inspection); `zh.ts`'s `typeof en` type assertion makes the clean UI typecheck a structural proof of
  parity.
- `git diff HEAD -- src/renderer/eyesOnAgents/src/components/ThreadCard/ThreadCard.vue | grep -c
  'canOpenThread\|openLabel\|canOpenInIterm2'` — 0 matches: confirmed `canOpenThread`, `openLabel`,
  and `canOpenInIterm2` are byte-for-byte unchanged by this task's diff, satisfying the task's
  non-negotiable constraint.
- Also run for extra confidence (not required by this task, given `eyesOnAgents.service.ts`'s bridge-
  method parameter-shape change): `yarn test:eyes-on-agents:core` (passed) and `yarn
  test:eyes-on-agents:claude` (29 tests, all passed, including `claude-provider-toggle.test.mjs`,
  which calls `installClaudeBridge()`/`refreshClaudeBridgeStatus()`/`removeClaudeBridge()`/
  `getClaudeBridgeStatus()` directly on the service with zero arguments) — confirmed no existing test
  anywhere in the suite calls any of the 4 bridge methods with a positional `configDirectory` string
  argument, so the parameter-shape change from `configDirectory?: string` to `params?: {
  environmentId?: string }` has no silent-behavior-change call sites.
- Electron, packaged-app, and end-to-end tests were not run, per the task's explicit instruction. The
  owner-only two-real-environment manual verification from the feature doc's Acceptance section was
  not attempted.

### Completion-pass verification (2026-09-03, gaps 1-3)

- `yarn typecheck:eyes-on-agents:core` — re-run: 0 errors.
- `yarn typecheck:eyes-on-agents:ui` — re-run: 0 errors (includes `ClaudeObservationCard.vue`'s new
  `environmentDesktopLabel`/`environmentLastScanLabel`/`environmentNextRetryLabel`/
  `canRetryEnvironment`/`handleRetryEnvironment`).
- `git diff --check` — re-run: clean, exit 0.
- `yarn test:eyes-on-agents:ui` — re-run 3 times for confirmation: **98 tests**; pass/fail varied
  **96/2, 97/1, 96/2** across the 3 runs (12 new tests vs. the 95 pre-existing per the delivery-pass
  evidence: 3 in `claude-environment-render.test.mjs`, 9 already counted there). The only ever-observed
  failures across all 3 runs were the 2 already-known pre-existing ones — never a third:
  1. `ui-source.test.mjs`'s bundle-id assertion (deterministic every run).
  2. `thread-card-open-capability.test.mjs`'s right-click/dropdown assertion — **confirmed flaky, not
     deterministic** (see Gap 2 above): present in 2 of the 3 runs here, absent in the third (97/1
     run). A green run of this suite showing only 1 failure is expected behavior for this known flake,
     not evidence of a fix.
  No new failure appeared in any run, in either `claude-environment-render.test.mjs` (12/12 passed
  every run) or `claude-setup-render.test.mjs` (unaffected by the new stub).
- `yarn test:eyes-on-agents:claude` — re-run: 74 tests across its chained sub-suites, all passed
  (27 + 17 + 1 + 29 across its 4 `node --test`/`node` groups), including `claude-provider-toggle
  .test.mjs`'s `retryClaudeDirectory()` zero-arg call sites (unaffected by the widened optional
  parameter) and the `retryDirectory: async () => calls.push('directory-retry')` mock (ignores its now
  always-`undefined` argument in that harness, since it never wires a `claudeDirectoryConfig`
  dependency — exactly the pre-gap ambient behavior preserved).
- `yarn test:eyes-on-agents:core` — re-run: passed.
- `docs/plan/backlog.md` gained the gap-2 entry (see above); `docs/integrations/eyes-on-agents-layout
  .md` and `docs/features/eyes-on-agents-claude-multi-environment.md` gained the gap-3/gap-1
  documentation corrections described above — both re-read in full after editing to confirm no
  contradiction with the shipped renderer/store/service code.
- Electron, packaged-app, and end-to-end tests were not run in this completion pass either, per the
  task's standing instruction.

## Review-1 follow-up (2026-09-03)

`docs/plan/reviews/eyes-on-agents-claude-multi-env-renderer-088-1.md` passed the task with 7 P3
findings and 4 evidence corrections. Every item that was cleanup of this task's own change, or its
own unmet contract, is closed here; the two genuinely deferred ones stay in `docs/plan/backlog.md`.

- **Restored the per-environment path input's accessible name.** The read-only row directory
  `a-input` in `ClaudeObservationCard.vue` regained
  `:aria-label="i18nHelper.eyesOnAgents.claudeDirectory.pathLabel"` — the same binding the pre-088
  single-directory input carried, reusing the existing key rather than adding a new one.
- **Deleted 4 orphaned i18n keys** from both `en.ts` and `zh.ts`: `eyesOnAgents.claudeDirectory`'s
  `title`, `unavailable`, `change`, `useAutomatic`. `pathLabel` is kept (the aria-label above) and
  every remaining `claudeDirectory.*` key is still live. Each deletion was proven to have no dotted
  reference and no dynamic/computed access anywhere in `src/` or `scripts/`; the only survivors were
  two `ui-source.test.mjs` i18n-copy assertions on the block title, retargeted to the live
  `claudeEnvironment.title` copy.
- **One `'__add__'` literal.** `eyesOnAgents.store.ts` now exports `ADD_CLAUDE_ENVIRONMENT_KEY` and
  `ClaudeObservationCard.vue` imports it; the card's independent `ADD_ENVIRONMENT_KEY` duplicate is
  gone. `ui-source.test.mjs` asserts the export, the import, and that the card declares no copy.
- **Import ordering in `eyesOnAgents.store.ts`.** The emitter `import` block moved above the two
  `const` declarations, so all static imports are contiguous at the top of the file.
- **Remove guard now comes from the service** (this task's Required behavior; see the corrected
  `ClaudeObservationCard.vue` bullet above). `EyesOnAgentsClaudeEnvironmentStatus` gains
  `canRemove: boolean`; `ClaudeObservationService.getDirectoryStatus()` stamps it from
  `this.environments.size > 1`, mirroring `ClaudeDirectoryConfigService.removeEnvironment`'s guard,
  and hard-codes `false` for the synthetic invalid-hydration entry. Because `canRemove` is a property
  of the environment list rather than of one watcher, the service's internal per-environment status
  is typed against the new `EyesOnAgentsClaudeEnvironmentWatcherStatus`
  (`Omit<EyesOnAgentsClaudeEnvironmentStatus, 'canRemove'>`) so only the array-assembly point sets
  it. The renderer binds `:disabled="!environment.canRemove"` and the `removeLastHint` title to the
  same flag.
- **Direct coverage for `resolveClaudeEnvironmentLabel`.** `focus-board-store.test.mjs` gains
  "resolveClaudeEnvironmentLabel resolves a thread's claudeConfigDir against the snapshot" (real
  store module, not a stub): exact match, trailing slash on either side, non-match, `null`
  `claudeConfigDir`, the automatic row's `null` `configuredDirectory` being skipped rather than
  compared (it is deliberately first in the fixture, so a missing null-filter would throw there), and
  first-match ordering when two environments normalize to the same directory. `createSnapshot` gained
  an optional `claudeDirectory` argument for it.
- **`docs/integrations/eyes-on-agents-layout.md`'s environments diagram corrected** to what ships:
  Rename/Remove on every row with a real id, and the per-row setup-action block repeated inside each
  row (with a prose sentence noting the block also appears card-level and shows shared status because
  of the single installation identity).
- **`docs/plan/backlog.md`'s `check:renderer-i18n` line citation** corrected from
  `check-renderer-i18n.mjs:172` to `:186`, the assertion's actual current line.

Deliberately **not** closed here: the `resolveClaudeEnvironmentLabel` verbatim-vs-canonicalized
path-normalization asymmetry (cosmetic missing label, never a wrong one), and collapsing the visually
triplicated per-row setup-action block into a single card-level surface. Both are now recorded as
entries in `docs/plan/backlog.md` as part of closing this task out.

### Review-1 follow-up verification (2026-09-03)

- `yarn typecheck:eyes-on-agents:core` — 0 errors.
- `yarn typecheck:eyes-on-agents:ui` — 0 errors.
- `yarn test:eyes-on-agents:claude` — all groups pass, `fail 0`.
- `yarn test:eyes-on-agents:ui` — 99 tests (98 + the new store test), 97 pass, 2 fail: only the two
  already-logged pre-existing failures (`ui-source.test.mjs`'s deterministic bundle-id assertion and
  `thread-card-open-capability.test.mjs`'s flaky right-click/dropdown assertion). No third failure.
- `yarn check:renderer-i18n` — still fails at the same pre-existing tray/Home ordering assertion
  (`check-renderer-i18n.mjs:186`), which is not an i18n-content check.
- Electron, packaged builds, Playwright, and every `test:e2e:*` suite — not run, per the standing
  owner instruction. The owner-only two-real-environment manual verification is still not run.

## Review

[Independent review 1](../reviews/eyes-on-agents-claude-multi-env-renderer-088-1.md) passed with no
blocking findings, after two earlier attempts at this review were killed mid-run by session limits.
It independently re-ran every scoped check rather than trusting this task's writeup, and settled the
plan's highest-risk item: the `EyesOnAgentsApi` / `EyesOnAgentsService` type conflict is genuinely
resolved, with **no** `any`, cast, `@ts-ignore`, or silently-dropped parameter anywhere in this
task's additions, and the resolved `configDirectory` is actually consumed by
`install()`/`refresh()`/`remove()` rather than being a type-clean dead parameter. It also confirmed
the three restored per-row capabilities (last-scan, Desktop count, Retry) are bound to the `v-for`
loop variable rather than `environments[0]`, that Retry is row-scoped end to end, and that the
shipped iTerm2 Open feature does not regress (the ThreadCard diff is one hunk, the store diff is
purely additive, and the widened visibility rule is intact).

Seven P3 findings and five corrections to this task's own evidence came out of it. Everything that
was cleanup of this task's own change, or its own unmet contract, was fixed before close-out and is
recorded in the "Review-1 follow-up" section above: the lost per-row `aria-label`, four i18n keys
this task orphaned, the duplicated `'__add__'` literal, the import/const ordering, the missing
`resolveClaudeEnvironmentLabel` store test, the layout-doc ASCII diagram, and — the one real
contract deviation — the last-remaining-environment Remove guard, which was re-derived in the
renderer instead of being surfaced from the service as this task's Required behavior demanded. That
guard now ships as a service-stamped `canRemove` field on
`EyesOnAgentsClaudeEnvironmentStatus`. The two genuinely-deferred findings (path-normalization
asymmetry, setup-action visual triplication) are logged in `docs/plan/backlog.md`.

One correction to the review itself: it reported the flaky right-click test passing in both of its
runs, which is consistent with (not evidence against) the ~6/10 flake rate already recorded in
backlog — the orchestrator's own post-fix run did see it fire, alongside the deterministic bundle-id
failure, for the expected 99 tests / 97 pass / 2 fail. No third failure appeared in any run, and no
failure traces into this task's changes.
[Independent review 2](../reviews/eyes-on-agents-claude-multi-env-renderer-088-2.md) was produced
concurrently on another machine, without knowledge of review 1, and independently also concluded
`pass` with no blocking findings. Both reviews were written against the same commit and merged here
rather than one being discarded — two independent passes agreeing on the highest-risk item is worth
more than either alone. Review 2 adds what review 1 did not have: a bullet-by-bullet
**Acceptance-criteria satisfaction table** against the feature doc's Acceptance section (9 of 9
satisfied, with the production `yarn build` bullet scope-limited to typecheck because a real build
risks launching Electron, and the manual two-environment check correctly left to the owner). It
reached the `EyesOnAgentsApi`/`EyesOnAgentsService` conclusion by a different route — tracing all 11
widened/added interface members and noting that the 7 CRUD delegates on `EyesOnAgentsService` are
`implements`-satisfying dead code, with the live handler still calling `claudeDirectoryConfig`
directly — and confirmed `claude-provider-toggle.test.mjs`, the oldest pre-088 test in this area,
still exercises the zero-dependency ambient fallback unchanged. It corroborated the flakiness
finding with far more samples than review 1 or the completion pass had (11/15 and 10/15 failure
rates on two different commits, same single assertion).

Two notes on where review 2 and this task's final state diverge, both resolved in this task's
favor because review 2 was written against the pre-fix commit:

- Review 2's P3-1 observed that the Remove guard's last-remaining-environment constraint "was not
  literally followed, but there is nothing to surface," since no task from 084 onward added a
  `canRemove`/`isLast` field. That is accurate for the commit it reviewed, and it is exactly what
  the "Review-1 follow-up" above then implemented: `EyesOnAgentsClaudeEnvironmentStatus.canRemove`
  is now stamped by the service, so the renderer no longer re-derives the rule. Review 2's
  corresponding `docs/plan/backlog.md` entry was stale on arrival and has been removed as part of
  this merge.
- Review 2's P3-2 is a finding review 1 did **not** make and which still stands:
  `resolveClaudeEnvironmentLabel` cannot label a session captured under the *automatic*
  environment's own inherited `CLAUDE_CONFIG_DIR`, because `configuredDirectory` is unconditionally
  `null` for the single `mode: 'automatic'` environment. It is consistent with the design doc's own
  field semantics and outside every Acceptance bullet, so it is informational — it is now logged in
  `docs/plan/backlog.md` alongside review 1's related path-normalization entry.

With this task done, the entire Claude Multi-Environment plan (084 → 085 → 086 → 087 → 088) is
complete; the feature doc's Acceptance section is satisfied except the explicitly owner-only manual
two-real-environment verification.
