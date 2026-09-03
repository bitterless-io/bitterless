# Review 1 — eyes-on-agents-claude-multi-env-renderer-088

Reviewer: independent review pass (no source edits, no Electron / packaged / Playwright / E2E run).

**Verdict: `passed`** — with 7 non-blocking (P3) findings and 4 corrections to the task's own
Implementation-evidence/Verification-evidence text. No blocking defect found.

## Review method

Task 088's code landed through automated `chore: sync` commits plus one merge, so the diff was read
as `git diff ebd82eb..HEAD -- <path>` scoped to the task's declared Path (plus the three files it
touched outside that Path). `ebd82eb` is the last commit before task 088. The range also carries
unrelated synced OnlyPreview work (`onlypreview-*` tasks, `onlyPreview*` sources/tests,
`docs/plan/README.md`'s task-118 row, `package.json`'s `_version`/`name`/`version_code` packaging
bump, and the `previewShell.newFolder`/`rename*`/`menuBar.downloadingUpdate` i18n keys) — all
ignored as out of scope. The working tree's uncommitted `package.json` /
`onlyPreviewShell.store.ts` / `tsconfig.web.tsbuildinfo` / untracked `onlypreview-*` docs were not
touched, staged, or reverted.

Files actually changed by task 088 inside the eyesOnAgents surface:

```
src/shared/eyesOnAgents/eyesOnAgents.type.ts                              |  34 +-
src/main/eyesOnAgents/eyesOnAgents.service.ts                             | 145 +++++-
src/main/eyesOnAgents/claudeObservation.service.ts                        |   8 +-   (outside Path)
src/main/xpc/eyesOnAgents.handler.ts                                      |  37 +-   (outside Path)
src/renderer/eyesOnAgents/src/components/ConnectionPanel/ClaudeObservationCard.vue | 383 +++--
src/renderer/eyesOnAgents/src/components/ConnectionPanel/ConnectionPanel.less      |  37 +
src/renderer/eyesOnAgents/src/components/ThreadCard/ThreadCard.vue        |  13 +-
src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts                 | 110 +
src/renderer/common/i18n/en.ts / zh.ts                                    |  (claudeEnvironment block + 1 thread key each)
scripts/eyes-on-agents/claude-environment-render.test.mjs                 | 545 +++ (new)
scripts/eyes-on-agents/claude-setup-render.test.mjs                       |  21 +-
scripts/eyes-on-agents/thread-card-open-capability.test.mjs               |  39 +-
scripts/eyes-on-agents/ui-source.test.mjs                                 |  49 +-
package.json                                                              |  (ui suite wiring only)
docs/integrations/eyes-on-agents-layout.md                                |  95 +-
docs/features/eyes-on-agents-claude-multi-environment.md                  |  36 +   (outside Path)
docs/plan/backlog.md                                                      |  18 +   (outside Path)
```

No unexpected file inside the eyesOnAgents surface was touched.

## Verification I ran myself

| command | result |
|---|---|
| `yarn typecheck:eyes-on-agents:core` | **exit 0**, `tsc -p scripts/eyes-on-agents/tsconfig.strict.json`, `Done in 3.28s`, 0 errors |
| `yarn typecheck:eyes-on-agents:ui` | **exit 0**, 0 errors |
| `yarn test:eyes-on-agents:claude` | **exit 0** — 4 `node --test` groups `27 + 17 + 1 + 29 = 74` tests, `fail 0` in every group, plus 8 standalone `node` scripts all printing `… tests passed` (inventory, hook bridge, setup recovery, environment plugin install, directory config, environment config, directory runtime, directory race, multi-environment watcher) |
| `yarn test:eyes-on-agents:ui` (run 1) | `tests 98 / pass 97 / fail 1`, exit 1 |
| `yarn test:eyes-on-agents:ui` (run 2) | `tests 98 / pass 97 / fail 1`, exit 1 |
| `git diff --check` | clean, exit 0 |
| `yarn check:renderer-i18n` | fails identically to the logged pre-existing defect: `AssertionError [ERR_ASSERTION]: Tray must follow Home creation` |

The single UI failure in both runs is the already-logged, deterministic one:

```
test at scripts/eyes-on-agents/ui-source.test.mjs:30:1
✖ completed threads use one localized silent notification and bundled cross-platform tone
  AssertionError: The input did not match the regular expression
  /import\.meta\.env\.VITE_ENV === 'dev'\s*\?\s*'io\.bitterless\.desktop_dev'\s*:\s*'io\.bitterless\.desktop'/
```

i.e. the missing `electronApp.setAppUserModelId(...)` in `app.main.ts`, exactly as
`docs/plan/backlog.md:5-14` describes. The second known failure
(`thread-card-open-capability.test.mjs` "right-click opens the shared pointer menu …",
`backlog.md:71-87`) did **not** fire in either of my runs — consistent with the corrected "flaky,
~6/10" characterization, and not evidence of a fix. **No third failure appeared, and no failure
traces into task 088's own changes.** `claude-environment-render.test.mjs` passed 12/12 in both runs.

## Priority check 1 — the `EyesOnAgentsApi` / `EyesOnAgentsService` type conflict: **genuinely resolved, parameter is semantically live**

This was the highest-risk item and it is clean. There is **no** `any`, cast, `as unknown`,
`@ts-ignore`/`@ts-expect-error`, `eslint-disable`, or dropped parameter anywhere in task 088's
additions — verified by grepping every added (`^+`) line across
`eyesOnAgents.service.ts`, `claudeObservation.service.ts`, `eyesOnAgents.handler.ts`,
`eyesOnAgents.type.ts`, and the whole `src/renderer/eyesOnAgents/` tree: zero matches.

Interface (`src/shared/eyesOnAgents/eyesOnAgents.type.ts:589-617`): all 4 bridge methods plus
`retryClaudeDirectory` widened to `(params?: { environmentId?: string })`, and the 7 CRUD members
added (`listClaudeEnvironments` … `useAutomaticClaudeEnvironment`), each returning
`Promise<EyesOnAgentsClaudeEnvironment[]>` and matching `EyesOnAgentsHandler`'s task-084 shapes.

Service side is real resolution, not widening theatre:

- `EyesOnAgentsService.resolveClaudeBridgeConfigDirectory` (`eyesOnAgents.service.ts:3014-3019`)
  reads `this.dependencies.claudeDirectoryConfig.listEnvironments()`, then
  `resolveClaudeBridgeEnvironment(environments, params).configDirectory ?? undefined`. That helper
  (`src/main/eyesOnAgents/claudeBridgeEnvironment.resolver.ts:8-17`) targets `environments[0]` when
  `environmentId` is `undefined` and **throws** `'Claude environment was not found'` for an
  explicitly-supplied unknown id — no silent default fallback.
- The resolved value is genuinely **consumed**, not shadowed and dropped:
  `eyesOnAgents.service.ts:2887` `this.dependencies.claudeBridge?.install(configDirectory)`,
  `:2927` `.refresh(configDirectory)`, `:2988` `.remove(configDirectory)`. Because the new local
  `const configDirectory` keeps the old parameter's exact name, every pre-088 reference inside the
  otherwise-untouched method bodies resolves to it.
- `retryClaudeDirectory` (`:3135-3151`) resolves to an **id** rather than a directory
  (`resolveClaudeBridgeEnvironment(...).id`) and forwards it to
  `claudeObservation.retryDirectory(environmentId)` →
  `ClaudeObservationService.retryDirectory` (`claudeObservation.service.ts:225-233`) →
  `retryEnvironmentEntry(environmentId ?? this.resolveDefaultEnvironmentId())`, i.e. the watcher's
  pre-existing per-id entry point (`:647-658`). Correct: the retry target is an environment, not a
  CLI invocation directory.
- The dependency is really wired in production:
  `src/main/xpc/eyesOnAgents.handler.ts:281-282` injects `claudeDirectoryConfig` and
  `pickClaudeConfigDirectory` into the `EyesOnAgentsService` constructor — the same singleton the
  handler's own methods use (`:233`). Both are optional in
  `EyesOnAgentsServiceDependencies`, which is why every pre-088 zero-arg harness still passes
  (confirmed: `test:eyes-on-agents:claude` fully green, including
  `claude-provider-toggle.test.mjs`'s zero-arg `installClaudeBridge()`/`refreshClaudeBridgeStatus()`/
  `removeClaudeBridge()`/`getClaudeBridgeStatus()`/`retryClaudeDirectory()` call sites).
- End-to-end chain for a non-default environment is live: `ClaudeObservationCard.vue:155`
  `handleInstallForEnvironment(environment.id)` → `eyesOnAgents.store.ts:445`
  `installClaudeBridgeForEnvironment` → `eyesOnAgentsEmitter.installClaudeBridge({ environmentId })`
  (emitter is `createXpcRendererEmitter<EyesOnAgentsApi>('EyesOnAgentsHandler')`,
  `emitter/eyesOnAgents.emitter.ts:4-6`) → handler `:408-415` resolves and forwards
  `{ environmentId: environment.id }` → service resolves independently → `claudeBridge.install(dir)`.

`getClaudeBridgeStatus` is the one method widened in the interface but **not** at the service level
(it stays zero-parameter, which TypeScript accepts as an implementation of a wider optional
signature). The handler (`:460-473`) validates the id via `resolveClaudeBridgeEnvironment` and then
calls `eyesOnAgentsService.getClaudeBridgeStatus()` with no argument. So its `environmentId` is
validated-but-unused. This matches the task's own instruction ("needs the same interface/renderer-
facing shape for consistency even though it does not currently use `configDirectory` at all") and
task 086's shared-installation-identity Non-goal. Correctly disclosed; not a defect.

## Priority check 2 — restored per-row capability: **all three present and correctly row-scoped**

- Desktop-source count: `ClaudeObservationCard.vue:140` `environmentDesktopLabel(environment)` →
  `:532-535`, reading `environment.desktopDirectoryCount` off the `v-for` row (`:76`), reusing the
  never-removed `claudeDirectory.desktopDirectories` key.
- Last successful scan: `:141` → `:536-539`, `environment.lastSuccessfulScanAt`.
- Next retry (bonus, also gated): `:142` `v-if="environment.nextRetryAt"` → `:540-543`.
- Manual Retry: `:129-137`, gated by `canRetryEnvironment(environment)` (`:544-547`), which
  reproduces the pre-088 `canRetryDirectory` predicate one-for-one
  (`providerError.value !== null || ['waiting','degraded','retrying','error'].includes(environment.state)`).

All five read from the loop variable — **not** `environments[0]` and not a global. Verified there is
no `environmentRows.value[0]`, `environmentRows[0]`, or snapshot-level metadata read anywhere in the
row template.

Retry is row-scoped end to end: `handleRetryEnvironment(environment.id)` (`:624-630`) →
`eyesOnAgentsStore.retryClaudeDirectoryForEnvironment(id)` (`store:433-437`) →
`eyesOnAgentsEmitter.retryClaudeDirectory({ environmentId: id })` → handler `:494-501` →
service `:3144` → `claudeObservation.retryDirectory(id)` → `retryEnvironmentEntry(id)`. The
empty-id invalid-hydration sentinel row falls back to the legacy zero-arg
`retryClaudeDirectory()`, matching `handleChooseDirectory`/`handleUseAutomatic`.

Independently exercised by real-DOM behavioural tests (not source-pattern matching) in
`claude-environment-render.test.mjs`: "desktop directory count and last scan render per row, with a
next-retry note when scheduled", "Retry is offered only in a recoverable state, and retries the
clicked row" (asserts `calls.retry === [recovering.id]` after clicking the **second** row and that
the healthy first row has no Retry button), "a global Claude provider error offers Retry even on an
otherwise-healthy row", and the sentinel test's `calls.retryDirectory === 1` /
`calls.retry === []` assertions.

I also chased the adjacent risk the evidence does not mention: could an empty
`snapshot.claudeDirectory` leave the card with **no** row and therefore no recovery affordance,
where pre-088 the single block always rendered with `claudeDirectory.unavailable` + Change/Retry?
Answer: no. Every hydration failure path in `ClaudeObservationService.hydrateAndReconcile`
(`:323-354`) sets `invalidHydrationStatus`, and `getDirectoryStatus` (`:124-127`) then returns the
single synthetic sentinel row; `reconcileFromDirectoryConfig` (`:356-361`) explicitly refuses to
act on an empty list. Entries also persist across `stop()` (`:90-91`), so disabled environments keep
rendering a row and stay re-enableable. `[]` is only reachable in the pre-first-hydration boot
window. Not a regression.

## Priority check 3 — no regression to the shipped iTerm2 Open feature

- `ThreadCard.vue`: the diff is a **single hunk** touching only `folderLabel` and the new
  `environmentLabel` computed (`:189-199`).
  `git diff ebd82eb..HEAD -- …/ThreadCard.vue | grep -c 'canOpenThread\|openLabel\|canOpenInIterm2'`
  → **0**. Confirmed independently, matching the task's claim.
- `eyesOnAgents.store.ts`: the diff is **purely additive** —
  `git diff ebd82eb..HEAD -- …/eyesOnAgents.store.ts | grep -c '^-[^-]'` → **0**. No existing line
  (including `openThreadInIterm2` and the `desktopSessionId === null` fail-closed guard) was
  modified, so the Open/overflow contract cannot have shifted.
- `docs/features/eyes-on-agents-iterm2-open.md`: **no diff** in the range.
- The widened visibility rule is still documented as shipped in
  `docs/integrations/eyes-on-agents-layout.md:456-461`: "a Claude row with a captured
  `iterm2SessionId` additionally (or exclusively) offers **Open in iTerm2** … A Claude row with
  neither identity … does not render."
- All pre-existing tests in `thread-card-open-capability.test.mjs` are unmodified; `createStore`
  gained a defaulted `resolveClaudeEnvironmentLabel: () => null` and an `overrides` spread, and
  `createThread` gained `claudeConfigDir: null`, so every pre-088 `folderLabel` assertion is
  reproduced byte-identically. Both of my UI runs passed all iTerm2 Open tests.

## Priority check 4 — the ThreadCard environment label comparison

**Not addressed beyond trailing slashes; consequence is a MISSING label, never a wrong one.** This
is a genuine P3 (see P3-1), not a blocking defect.

`eyesOnAgents.store.ts:460-467`:

```ts
resolveClaudeEnvironmentLabel(claudeConfigDir: string | null): string | null {
  if (claudeConfigDir === null) return null;
  const normalized = normalizeClaudeConfigDirPath(claudeConfigDir);
  const match = (this.snapshot?.claudeDirectory ?? []).find((environment) =>
    environment.configuredDirectory !== null
    && normalizeClaudeConfigDirPath(environment.configuredDirectory) === normalized);
  return match?.label ?? null;
}
```

with `normalizeClaudeConfigDirPath = (value) => value.replace(/\/+$/u, '')` (`:11`).

The two sides being compared are asymmetric **by explicit design on both ends**, which makes the
mismatch structural rather than hypothetical:

- The thread's `claudeConfigDir` is read **verbatim** from the shell's env var —
  `readClaudeHookEnvironmentAttribution` (`src/shared/eyesOnAgents/claudeHookBridge.contract.ts:248-259`),
  whose own comment says "Read verbatim (no trim/normalize)"; the wire parser
  (`parseWireClaudeConfigDir`, `:298-303`) only checks non-empty + `isAbsolute`.
- The environment's stored `configDirectory` is **realpath-canonicalized** —
  `requireCanonicalClaudeConfigDirectory` (`src/main/eyesOnAgents/claudePath.resolver.ts:30-45`) →
  `canonicalClaudeDirectory` (`:18-28`), which calls `realpathSync.native(path)` and rejects
  symlinks outright.

So trailing-slash normalization covers the single most likely real-world case (a wrapper writing
`export CLAUDE_CONFIG_DIR="$HOME/.claude2/"`), but `/Users/ral/./.claude2`, a case-differing path on
a case-insensitive APFS volume (`.Claude2`), or a symlink path the user's wrapper uses will all
silently fail to match. Result: no label prefix, i.e. exactly the "no match renders as it does
today" behaviour the contract already sanctions
(`docs/features/eyes-on-agents-claude-multi-environment.md:437-441`).

**Mislabeling to the wrong environment is not reachable.** The only way `find` could return a
different environment than the one that ran is two environments whose `configuredDirectory` values
normalize to the same string — and duplicate directories are (a) not deduplicated
(`ClaudeDirectoryConfigService.addEnvironment`, `:201-222`, has no directory-uniqueness check) but
(b) an **explicit Non-goal**: "Migrating or deduplicating two configured environments that happen to
resolve to the same directory … treated as a user configuration error"
(`docs/features/eyes-on-agents-claude-multi-environment.md`, Non-goals). In that state both rows
name the same `CLAUDE_CONFIG_DIR`, so attribution is inherently ambiguous rather than wrong.
Verdict: **cosmetic**, correctly classified.

Separately: the automatic/default environment has `configuredDirectory: null` and is therefore never
matched. That is consistent — a session run without `CLAUDE_CONFIG_DIR` set produces
`claudeConfigDir: null` on the thread, so both sides agree on "no label". Correct per contract.

## Priority check 5 — `docs/integrations/eyes-on-agents-layout.md`

**Now accurate.** The single-directory block description, its ASCII diagram, and the directory-state
table were all replaced (`:288-355`):

- New prose describes the **Claude environments** list, the persistent **Add environment** action,
  per-row rename/change-directory/Use-automatic/Retry/enable-disable/remove, the last-remaining-
  environment Remove guard, and the always-visible guidance aside.
- The ASCII diagram (`:316-330`) shows a two-row list with `[Add environment]`, per-row
  desktop-count/last-scan/next-retry, `[Retry]`, `[Rename] [Remove]`, and the guidance note.
- The state table header changed from `directory state` to `row state`, rows now name the restored
  **Retry** affordance in `waiting`/`degraded`/`retrying`/`error`, and two rows were added for
  "last remaining environment" and "Claude provider error".
- The rail summary at `:216-219` no longer says "Session directories" — it says "the Claude
  environments list".
- The thread-card folder-tooltip paragraph (`:412-422`) now documents the `{label} · Working
  directory: {path}` prefix, the path-normalized match, and the live-resolution/no-persisted-
  foreign-key contract.

Grep for stale phrasing: the only remaining occurrence of "Session directories" is at `:292`
("replacing the earlier single Session directories block"), which is a deliberate historical
reference, not a description of current UI. The old "CLI-only Claude rows never render" rule is
**not** present anywhere; `:456-461` carries the correct post-081/083 widened rule. Good.

One residual mismatch, minor: the diagram shows `[Rename] [Remove]` only on the second row, whereas
the shipped template renders both on **every** row with a non-empty id (`ClaudeObservationCard.vue:170-195`),
with Remove merely `disabled` for the last one. And the doc's "one Claude environments list **before**
the state-driven setup action" does not mention that the setup action is also repeated **inside**
each row (`:147-169`). Folded into P3-3/P3-4.

## Priority check 6 — i18n discipline

Clean.

- `claudeEnvironment` block added to **both** `en.ts` (`:774-793`) and `zh.ts` (`:761-780`), sibling
  to `claudeBridge`/`claudeDirectory`, with **identical key sets in identical order** (17 keys:
  title, guidance, addEnvironment, addLabelPlaceholder, add, notConfigured, rename,
  renameLabelPlaceholder, save, cancel, changeDirectory, useAutomatic, enable, disable, remove,
  removeLastHint) — verified by direct diff comparison.
- `thread.workingDirectoryWithEnvironment` added to both (`en.ts:836`, `zh.ts:823`).
- `zh.ts` is declared `export const zh: typeof en`, so the clean UI typecheck is a structural proof
  of parity. Confirmed the annotation is present.
- Every one of the 17 new `claudeEnvironment.*` keys is referenced from source (grepped
  individually; counts 1-4 each, all outside the i18n files). No orphan among the new keys.
- No `$t(` and no `useI18n` in `ClaudeObservationCard.vue`, `ThreadCard.vue`, or
  `eyesOnAgents.store.ts` — all copy goes through `i18nHelper.*`.
- No hardcoded user-facing text in the new template. The only literals are the ` · ` separator glue
  at `:93` (a pre-088 pattern, also used at `ebd82eb`'s `:44-48`) and data bindings
  (`environment.label`, `environment.error`).

The one real i18n finding is in the opposite direction — five keys became orphans (P3-2).

## Priority check 7 — house conventions

- No `forEach` in any file task 088 touched (grepped `ClaudeObservationCard.vue`,
  `eyesOnAgents.store.ts`, `eyesOnAgents.service.ts`, `claude-environment-render.test.mjs`) — the new
  test uses `for (const key of […])`. ✔
- Semicolons present throughout new TS/Vue code. ✔
- Module-level functions are arrow consts (`normalizeClaudeConfigDirPath`, all `environment*` /
  `handle*` helpers); class methods stay method shorthand (`EyesOnAgentsState`,
  `EyesOnAgentsService`). ✔
- Static top-of-file imports; alias imports used (`@shared/eyesOnAgents/eyesOnAgents.type`,
  `@renderer/common/i18n/i18n.helper`); `import type` for type-only. ✔ (with the placement nit in
  P3-5)
- Business logic lives in `eyesOnAgents.store.ts`; the `.vue` only holds render-time label/eligibility
  helpers and thin `handle*` delegates — the same split the pre-088 file used. ✔
- Styles are in the sibling `ConnectionPanel.less`, no inline styles and no `<style>` block content
  added. New classes are **flat** (no `&` nesting), max one `__` separator
  (`eyes-connection-card__directories-add`, `__directories-list`, `__directory-row`), with a
  descendant selector between two existing BEM classes where depth required it
  (`.eyes-connection-card__directory-row .eyes-connection-card__directories-header`) — exactly the
  sanctioned escape hatch. Colors use `oklch(1 0 0 / 55%)`. ✔
- Every `a-button`/`a-input` uses `size="mini"`; `a-switch` uses `size="small"`, matching the
  pre-088 file (Arco `a-switch` has no `mini`). ✔
- Stable `name` attributes on the new structural/repeated nodes:
  `eyesOnAgents__connections__claudeEnvironmentRow` on the repeated row,
  `eyesOnAgents__connections__claudeEnvironmentGuidance` on the aside, and the pre-existing
  `eyesOnAgents__connections__claudeDirectories` section name retained. ✔
- Filenames camelCase with ≤2 dot suffixes (`claude-environment-render.test.mjs` follows the
  established kebab-case convention of the sibling `scripts/eyes-on-agents/*.test.mjs` files). ✔

## Priority check 8 — scope discipline

Three source/doc files were changed outside the declared Path. All three are justified, but only two
are disclosed:

1. `src/main/xpc/eyesOnAgents.handler.ts` — **forced.** Constructor injection of
   `claudeDirectoryConfig`/`pickClaudeConfigDirectory` is the only way the service can resolve
   `{ environmentId }`, and the 3 bridge call sites had to switch from a positional
   `configDirectory` to `{ environmentId }`. Disclosed in the evidence.
2. `src/main/eyesOnAgents/claudeObservation.service.ts` — **forced** by gap 1; an 8-line change
   (`retryDirectory(environmentId?: string)` + one `??` fallback). Disclosed.
3. `docs/features/eyes-on-agents-claude-multi-environment.md` and `docs/plan/backlog.md` — doc
   corrections, outside Path but plainly appropriate and disclosed.

`package.json`'s only task-088 change is adding `claude-environment-render.test.mjs` to
`test:eyes-on-agents:ui` — implied by the Path's test-file bullet. (Its `_version`/`name`/
`version_code` changes in this range belong to unrelated packaging work.)

Note: the task's **Path** says of `eyesOnAgents.service.ts` "thin delegating implementations of those
7 interface members **only** — do not touch any other existing method in this file", while its
**Required behavior** explicitly instructs changing `installClaudeBridge`/`refreshClaudeBridgeStatus`/
`removeClaudeBridge` in the same file. The delivery followed Required behavior, which is right; the
contradiction is in the task doc, not the code. No scope creep found.

## Blocking findings

**None.**

## Non-blocking (P3) findings — phrased for `docs/plan/backlog.md`

- Task 088 review: `eyesOnAgentsStore.resolveClaudeEnvironmentLabel`
  (`src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts:460-467`) compares a thread's
  `claudeConfigDir` — read **verbatim** from the shell env var by
  `readClaudeHookEnvironmentAttribution`
  (`src/shared/eyesOnAgents/claudeHookBridge.contract.ts:248-259`, whose comment states "no
  trim/normalize") — against an environment's `configuredDirectory`, which is
  **realpath-canonicalized** by `requireCanonicalClaudeConfigDirectory`
  (`src/main/eyesOnAgents/claudePath.resolver.ts:30-45` → `realpathSync.native`). Only trailing
  slashes are reconciled. A wrapper exporting `CLAUDE_CONFIG_DIR=/Users/ral/./.claude2`, a
  case-differing path on a case-insensitive APFS volume, or a symlink path therefore renders no
  environment label. Consequence is confined to a **missing** prefix (never a wrong one —
  same-directory duplicates are an explicit feature Non-goal), so it is cosmetic and inside the
  contract's "no match renders as it does today" allowance. Normalize both sides (e.g. `path.resolve`
  + platform-aware case folding, or canonicalize the hook-side value at ingest) if the label ever
  becomes load-bearing.

- Task 088 review: five `eyesOnAgents.claudeDirectory.*` i18n keys became orphans and two got
  duplicated copies. `claudeDirectory.title`, `.pathLabel`, `.unavailable`, `.change`, and
  `.useAutomatic` each had exactly one call site at `ebd82eb`
  (`ClaudeObservationCard.vue:42`, `:56`, `:383`, `:65`, `:87`) and now have **zero** in `src`/`scripts`,
  while new `claudeEnvironment.changeDirectory`/`.useAutomatic` keys were added carrying the same
  English/Chinese copy as the orphaned `claudeDirectory.change`/`.useAutomatic`. Delete the five dead
  keys from both `en.ts` and `zh.ts` (or reuse them instead of the duplicates) at the next touch of
  the Claude connection card.

- Task 088 review: the per-environment path input lost its accessible name. Pre-088 the read-only
  directory `a-input` carried `:aria-label="i18nHelper.eyesOnAgents.claudeDirectory.pathLabel"`
  (`ClaudeObservationCard.vue:56` at `ebd82eb`); the per-row replacement
  (`ClaudeObservationCard.vue:108-111`) is `<a-input :model-value="environmentPath(environment)"
  size="mini" readonly />` with no `aria-label`/`aria-labelledby`, so a screen reader announces an
  unlabeled text field once per environment row. The row's rename and add-form inputs both do carry
  `aria-label`, so this is an isolated omission. Re-add the label (reusing the now-orphaned
  `claudeDirectory.pathLabel`, closing the previous entry at the same time).

- Task 088 review: the plugin setup-action block is rendered once **per environment row**
  (`ClaudeObservationCard.vue:147-169`) while its content is driven by the single global
  `bridge.value?.setupAction` computed (`:388`), and the standalone card-level setup section
  (`:266-338`) still renders as well. With two environments and `setupAction: 'enable'` the user
  sees the identical "Enable" title plus three identical primary buttons on one screen; only the
  click target differs by row. The shared-status behaviour is a deliberate consequence of the
  feature's single-installation-identity Non-goal and is now documented
  (`docs/features/eyes-on-agents-claude-multi-environment.md`, "Implementation note (task 088)"),
  but the visual triplication is not — collapse the repeated block to a single card-level surface
  with a per-environment target selector, or drop the standalone section, next time this card is
  touched. Also note the task doc's own Required-behavior bullet still says the setup action is
  "evaluated per environment", now contradicted by the feature doc's correction; align the task doc
  when closing it out.

- Task 088 review: `docs/integrations/eyes-on-agents-layout.md`'s new environments ASCII diagram
  (`:316-330`) shows `[Rename] [Remove]` only on the second row and omits the per-row setup-action
  block, whereas the shipped template renders Rename/Remove on **every** row with a non-empty id
  (Remove merely `disabled` for the last remaining one, `ClaudeObservationCard.vue:170-195`) and
  repeats the setup action inside each row. Tighten the diagram at the next layout-doc pass.

- Task 088 review: the last-remaining-environment Remove guard is **re-derived in the renderer**
  (`:disabled="environmentRows.length <= 1"`, `ClaudeObservationCard.vue:186-190`) rather than
  surfaced from the service, which the task's Required behavior explicitly asked for ("surface this
  constraint from task 084's service rather than re-deriving it in the renderer"). Behaviour is
  correct today — `ClaudeDirectoryConfigService.removeEnvironment` still throws "The last remaining
  Claude environment cannot be removed" (`claudeDirectoryConfig.service.ts:237-246`) — and the
  predicates are trivially equivalent, but the two can drift if the service's rule ever gains a
  condition (e.g. "cannot remove the enabled default"). Add a `canRemove`/`removable` field to
  `EyesOnAgentsClaudeEnvironmentStatus` and bind the renderer to it if that rule changes.
  This deviation is not acknowledged in the task's Implementation evidence.

- Task 088 review: `eyesOnAgentsStore.resolveClaudeEnvironmentLabel`'s own matching/normalization
  logic has **no test coverage**. The new `thread-card-open-capability.test.mjs` test ("the folder
  tooltip gains the resolved environment label only when a match exists", `:788-814`) injects a
  **stubbed** `resolveClaudeEnvironmentLabel` through `createStore` overrides, so it verifies only
  `ThreadCard.vue`'s `folderLabel` branch, not the store's trailing-slash normalization,
  `configuredDirectory !== null` filter, or first-match ordering. `ui-source.test.mjs` adds no
  assertion for it either. Add a direct store-level test (matching path with/without trailing slash,
  non-matching path, `null` `configuredDirectory` on the automatic row) if this resolver is touched
  again. Also note the magic key `'__add__'` is duplicated as two independent literals
  (`eyesOnAgents.store.ts:10` `ADD_CLAUDE_ENVIRONMENT_KEY` and `ClaudeObservationCard.vue:493`
  `ADD_ENVIRONMENT_KEY`); a change to one silently breaks the Add button's loading state. Share one
  exported constant. Minor style nit in the same file: `eyesOnAgents.store.ts:10-11` places two
  `const` declarations **between** two `import` blocks, which reads against the "static top-of-file
  imports" convention even though hoisting makes it work.

## Task evidence: CONFIRMED vs INACCURATE

### Independently CONFIRMED

- The `EyesOnAgentsApi` widening and the 7 CRUD interface members exist exactly as described, with
  the shapes and return types claimed (`eyesOnAgents.type.ts:589-617`).
- `EyesOnAgentsService` gained 7 thin delegating CRUD implementations
  (`eyesOnAgents.service.ts:3035-3090`), each guarded by `requireClaudeDirectoryConfig()` throwing
  `'Claude environment configuration is unavailable'` (`:3021-3027`), each calling
  `claudeObservation?.applyEnvironments?.()` then `listEnvironments()`; `addClaudeEnvironment` calls
  the injected `pickClaudeConfigDirectory()` and is a no-op on `null`.
- `installClaudeBridge`/`refreshClaudeBridgeStatus`/`removeClaudeBridge` changed from
  `configDirectory?: string` to `params?: { environmentId?: string }` and resolve via the new
  `resolveClaudeBridgeConfigDirectory`, whose missing-dependency / empty-list branches return
  `undefined` and preserve pre-088 ambient behaviour. **Verified the resolved value is really
  consumed** at `:2887`, `:2927`, `:2988` — the parameter is not semantically dead.
- `getClaudeBridgeStatus` was **not** changed at the service level and the typecheck is still clean
  for exactly the assignability reason the evidence gives. Confirmed by reading both signatures and
  by `typecheck:eyes-on-agents:core` exiting 0.
- `EyesOnAgentsServiceDependencies` gained the optional `claudeDirectoryConfig` `Pick<…>`,
  `pickClaudeConfigDirectory`, and `claudeObservation.applyEnvironments?()`; every pre-088 harness
  still passes (`test:eyes-on-agents:claude` fully green).
- Gap 1 is real and complete: `retryClaudeDirectory` widened in the interface, handler, and service;
  `ClaudeObservationService.retryDirectory` gained the optional id with a one-line `??` fallback;
  the store gained `retryClaudeDirectoryForEnvironment` on the per-id gate; the card renders
  desktop-count/last-scan/next-retry and a per-row Retry with the exact pre-088 predicate.
- Gap 3 is real and complete: `docs/integrations/eyes-on-agents-layout.md` now describes the shipped
  environment list, the restored metadata/Retry surface, and the tooltip label contract, with no
  surviving description of the superseded single block or the pre-081 visibility rule.
- `ThreadCard.vue` changes only `folderLabel` + the new `environmentLabel`; `canOpenThread`,
  `openLabel`, `canOpenInIterm2` untouched (grep count **0**, as claimed). The store diff is
  additive-only (0 removed lines), which the evidence does not claim but which strengthens it.
- i18n parity: `claudeEnvironment` block and `thread.workingDirectoryWithEnvironment` present in both
  files with identical key sets/order; `zh.ts` is annotated `typeof en`.
- `git diff --check` clean, exit 0.
- The new `claude-environment-render.test.mjs` is a genuine real-DOM mount/click harness (JSDOM +
  esbuild SFC compile + Arco mount), 12 tests, all behavioural, all passing in both of my runs; it
  is wired into `test:eyes-on-agents:ui` in `package.json` immediately after
  `claude-setup-render.test.mjs`.
- The "74 tests" figure for `test:eyes-on-agents:claude` is accurate: `27 + 17 + 1 + 29` across its
  four `node --test` groups (the review brief's "29/29" refers only to the final group).
- Gap 2's corrected flake characterization holds up. The evidence's own retraction of the earlier
  "deterministic, not flaky, 4/4 reproductions" claim is correct: I saw the right-click test **pass**
  in both of my runs while the `ui-source.test.mjs` bundle-id failure fired in both.
- The **honest self-disclosure** in the evidence is accurate in both directions — the delivery pass
  correctly flagged its own dropped last-scan/desktop-count/Retry surface and its untouched layout
  doc as real gaps rather than glossing them, and the completion pass genuinely closed all three.

### INACCURATE / stale in the task's own evidence

1. **Delivery-pass "Test changes" bullet on `ui-source.test.mjs` is now stale.** It justifies
   removing `assert.match(claudeCard, /providerError\.value !== null \|\|/)` on the grounds that
   "the `canRetryDirectory` computed it targeted no longer exists". Gap 1 re-introduced that exact
   expression as `canRetryEnvironment` (`ClaudeObservationCard.vue:544-547`), so the stated
   justification no longer holds and the assertion was never restored. The behaviour *is* covered by
   the new "a global Claude provider error offers Retry even on an otherwise-healthy row" test, so
   coverage is not lost — but the evidence sentence should be corrected when closing the task.

2. **`yarn check:renderer-i18n` line citation is off by 14 lines.** The evidence (and
   `docs/plan/backlog.md:89-95`) cites
   `scripts/renderer-i18n/check-renderer-i18n.mjs:172`. My run reports the identical assertion at
   `…/check-renderer-i18n.mjs:186` (`AssertionError [ERR_ASSERTION]: Tray must follow Home
   creation`). Same defect, drifted line number — worth fixing in the backlog entry so the next
   reader can find it.

3. **`ConnectionPanel.less` bullet mis-describes the reuse count.** It says the
   `eyes-connection-card__directories-meta` class "is already reused twice per row for the
   plugin-setup meta". At `ebd82eb` it appeared twice in the *whole* card, once per concern; after
   gap 1 it is used twice **per row** (`:139` metadata, `:147` setup action) — which is the change
   the sentence is trying to justify, stated backwards. Cosmetic wording only; the CSS claim ("no
   new CSS needed") is correct.

4. **The Remove-guard deviation is undisclosed.** The evidence describes Remove as "disabled (with a
   `title` hint, `claudeEnvironment.removeLastHint`) when `environmentRows.length <= 1`" without
   noting that this is a renderer-side re-derivation, i.e. the opposite of the Required-behavior
   instruction "surface this constraint from task 084's service rather than re-deriving it in the
   renderer". Behaviour is correct; the contract deviation should be stated (see P3-6).

5. **Minor: `docs/features/eyes-on-agents-claude-multi-environment.md`'s row-content bullet was
   updated, but the task doc's own matching Required-behavior bullet was not.** The feature doc now
   carries an "Implementation note (task 088)" correcting "evaluated once per environment" for the
   setup action; `docs/plan/tasks/…-088.md:76-80` still reads as originally written. The two
   documents are now in tension on the same point.

Everything else in the Implementation evidence and Verification evidence that I could check
independently matched what the code and the commands actually do.

## Not run

- Electron, packaged builds, Playwright, and every `test:e2e:*` suite — per the standing owner
  instruction. Not attempted.
- The feature doc's owner-only two-real-environment manual verification (add a second
  `CLAUDE_CONFIG_DIR`, install its hook, start a session under it, confirm independent watcher/retry
  and the iTerm2 Open path) is **not run** and cannot be simulated from source. This remains the
  outstanding acceptance gate for the plan.
