---
id: eyes-on-agents-claude-iterm2-section-093
scope: Split the Connections rail into a third "Claude in iTerm2" section that owns the environment list, leaving the Claude section to own the provider toggle, plugin/hook setup, listener and Desktop metadata
status: done
depends-on: [eyes-on-agents-claude-env-edit-path-092]
verify: focused EyesOnAgents UI-source/render unit tests, UI strict typecheck, Core strict typecheck; no Electron
---

# EyesOnAgents Claude in iTerm2 Section

## Objective

Owner feedback (2026-09-04), after configuring `claude2` and seeing nothing appear: the UI does not
reflect that a CLI Claude environment is *an iTerm2 thing*. The environment list sits inside
**Local Claude observation**, next to Claude Desktop concerns it has nothing to do with, and the
card never says the one thing that actually decides whether a session shows up — that it has to be
started inside iTerm2.

Add a third rail section, **Claude in iTerm2**, that owns the environment list. The **Claude**
section keeps the provider toggle, the plugin/hook setup, the listener, the Desktop metadata
directories, and troubleshooting.

## Why this decomposition is right (not just a preference)

The rail currently splits by *provider*. The better axis — and the one the code already keys on — is
**how a session is observed and opened**:

- `eyesOnAgents.service.ts:854-858` renders a Claude thread only when it has `desktopSessionId`
  **or** `iterm2SessionId`. Those are the two routes, and they are exactly the two Claude sections.
- `resolveClaudeDesktopRoots` (`src/main/eyesOnAgents/claudePath.resolver.ts:47-65`) is
  **platform-fixed** — `~/Library/Application Support/Claude/claude-code-sessions`, derived from
  platform/home/env only. It never consults an environment's `configDirectory`. So Desktop
  discovery does not depend on the environment list at all, and the environment list is purely a
  CLI concern. Moving it out of the Claude card removes a false coupling rather than creating one.
- The plugin/hook machinery stays shared because Claude Desktop sessions are Claude Code sessions
  too: they load the same plugin hooks from their config directory. Only the *choice of which
  directories to install into* is per-environment.

## Required behavior

- **Rail gains a third tab.** `ConnectionProvider` (`ConnectionPanel.vue:287`) is a provider union
  and the third entry is not a provider, so introduce a section union — e.g.
  `type ConnectionSection = 'codex' | 'claude' | 'claude-iterm2'` — and drive the rail, the
  `activeProvider` ref, `getProviderTabId`/`getProviderPanelId`, `selectProvider` and
  `handleProviderKeydown` off it. Keyboard nav must wrap over **three** tabs (Arrow up/down, Home,
  End) and keep the existing roving-tabindex and `aria-selected`/`aria-controls` wiring intact.
  Keep the provider union for anything genuinely provider-shaped (logo choice).
- **Tab identity:** label from a new i18n key; reuse the existing Claude Spark logo — it is still
  Claude, and the label carries the distinction. Do not invent a new image asset.
- **Move the environment list** out of `ClaudeObservationCard.vue` into a new
  `ClaudeIterm2Card.vue` in the same folder, rendered in the new panel. It moves whole: add / rename
  / remove / enable-disable, the inline path edit (task 092), per-environment plugin presence and
  its Install/Check action (task 090), per-environment Retry, Copy setup command, Use automatic, and
  the "each environment needs its own hook install" guidance note. Styles stay in the shared
  `ConnectionPanel.less`, matching how the sibling cards already work.
- **Move `Desktop metadata directories: N` out of the environment rows** into the Claude section,
  shown **once**. It is the same platform-fixed global fact repeated per row today (every
  environment's watcher watches the same Desktop directory), so per-row display is misleading.
  Read it from the environments array rather than adding a new field, and note the underlying
  redundancy for the backlog rather than fixing the watcher here.
- **Add the missing explanation** to the new section — the thing whose absence cost the owner a
  debugging session: a CLI Claude session is only visible once the hook reports an identity, so it
  must be started **inside iTerm2** (a session in Terminal.app or an editor's terminal, with no
  Claude Desktop match, will never appear), and an already-running session needs
  `/reload-plugins` or a fresh session before its hook is loaded.
- **Gating is unchanged:** the new section is governed by the same single `Claude support` provider
  toggle that lives in the Claude section. When Claude support is off, the new section shows the
  same paused state rather than an interactive but dead list.
- i18n: new keys for the tab label and the iTerm2 explanation in **both** `en.ts` and `zh.ts`,
  identical key order. Reuse every existing `claudeEnvironment.*` key the moved markup already uses.

## Non-goals

- Changing what the environment rows *do*. This is a relocation plus one new explanatory note, not a
  redesign of the controls inside them.
- De-duplicating the Desktop watcher (N environments each watching the same Desktop directory).
  Real, but a watcher change; log it.
- Supporting non-iTerm2 terminals. The new section explains the current limitation; widening it is
  the separate WezTerm/Ghostty question already recorded as a feature Non-goal.
- Renaming the `claudeDirectory` snapshot field or any Main-side contract. This is a renderer-only
  restructure.

## Path

- `src/renderer/eyesOnAgents/src/components/ConnectionPanel/ConnectionPanel.vue` (rail + new panel)
- `src/renderer/eyesOnAgents/src/components/ConnectionPanel/ClaudeIterm2Card.vue` (new)
- `src/renderer/eyesOnAgents/src/components/ConnectionPanel/ClaudeObservationCard.vue` (environment
  list removed; Desktop metadata line added)
- `src/renderer/eyesOnAgents/src/components/ConnectionPanel/ConnectionPanel.less` (only if the moved
  markup needs a class the file does not already have)
- `src/renderer/common/i18n/en.ts`, `src/renderer/common/i18n/zh.ts`
- `scripts/eyes-on-agents/` — rail tests (three tabs, keyboard wrap, panel association), the
  environment render tests retargeted at the new component, and `ui-source.test.mjs`
- `docs/integrations/eyes-on-agents-layout.md`,
  `docs/features/eyes-on-agents-claude-multi-environment.md`

## Verify

- `yarn typecheck:eyes-on-agents:core`, `yarn typecheck:eyes-on-agents:ui`
- `yarn test:eyes-on-agents:claude`, `yarn test:eyes-on-agents:ui`
- `yarn eslint` on each touched source file — no new errors.
- **`ui-source.test.mjs`'s `configDirectory` exclusivity assertion will fail by design**: it lists
  exactly the two renderer files allowed to mention a config directory, and this task adds a third.
  Extend that list to the new component — do not weaken the assertion into a positive match, which
  is the failure mode task 091's review already caught once.
- Do **not** run Electron, packaged builds, Playwright, or any `test:e2e:*` suite.
- Two pre-existing failures are not this task's: the deterministic `ui-source.test.mjs` bundle-id
  assertion, and the ~6/10 flaky `thread-card-open-capability.test.mjs` right-click test.
- Owner-only manual check: the rail shows three tabs; the environment list appears only under
  **Claude in iTerm2**; `Desktop metadata directories` appears once, under **Claude**; and the new
  note states the iTerm2 requirement.

## Implementation evidence

### Rail: a section union, not a third provider

`ConnectionPanel.vue:304` adds `type ConnectionSection = 'codex' | 'claude' | 'claude-iterm2'`
beside the retained `ConnectionProvider` union (`:300`). `connectionSections`
(`ConnectionPanel.vue:306-310`) replaces `connectionProviders` and drives the `v-for`
(`:29`), `activeProvider` (`:311`, now `ref<ConnectionSection>`), `getProviderTabId` /
`getProviderPanelId` (`:323`, `:325`), `selectProvider` (`:327`), `focusProvider` (`:330`) and
`handleProviderKeydown` (`:338-361`). The provider union survives only for the logo, through the new
`getSectionProvider` (`:314-315`), used at `:45` — both Claude sections render the existing
`claudeLogo`, and no new image asset was added. `getProviderLabel` became a switch (`:316-322`) so
the third tab reads its own i18n key.

New panel: `ConnectionPanel.vue:275-284`, `name="eyesOnAgents__connections__claudeIterm2Panel"`,
`v-show="activeProvider === 'claude-iterm2'"`, `role="tabpanel"`,
`:aria-labelledby="getProviderTabId('claude-iterm2')"`, rendering `<ClaudeIterm2Card />`
(imported at `:295`). It sits beside the two existing `v-show` panes, so all three stay mounted and
keep independent scrolling and local state.

**Three-tab keyboard nav.** `handleProviderKeydown` was left structurally identical — it already did
modulo arithmetic over the section array, so widening the array from 2 to 3 is the whole change; the
identifiers were renamed `provider*` → `section*` to match the new union. Concretely, with three
entries: `ArrowDown` from index 1 lands on index 2 and only wraps from index 2 → 0
(`(i + 1) % 3`); `ArrowUp` from index 0 wraps to index 2 (`(i - 1 + 3) % 3`); `Home` destructures the
first entry; `End` takes `length - 1` = the iTerm2 tab. Roving tabindex and
`aria-selected`/`aria-controls` are per-section expressions (`:35-39`) rather than hard-coded pairs,
so they extended without edits. All of this is asserted on real DOM — see the navigation test below.

### `ClaudeIterm2Card.vue` (new, 543 lines)

The environment list moved **whole and unmodified**. Template `:24-249` is the former
`ClaudeObservationCard.vue` `eyesOnAgents__connections__claudeDirectories` section byte-for-byte
except for the one removed metadata `<span>` (below), including the same section `name`, the
`claudeEnvironmentRow` / `claudeEnvironmentCopySetup` / `claudeEnvironmentPlugin` /
`claudeEnvironmentGuidance` names, the Add form, the inline rename and path editors, the four-value
plugin-presence pill with its Install / row-scoped-setup-action / Check precedence, per-row Retry,
Copy setup command, Use automatic, enable switch and Remove-with-hint. Script `:259-436` carries the
same computeds and the rest of the block the same handlers, comments included, so the one-editor-at-a-time rule,
the `environment.id === ''` sentinel fallbacks and the busy-key behavior are unchanged. No control
changed what it does.

Additions that are genuinely new, and only these:

- header (`:6-13`) reusing `claudeBridge.eyebrow` with the new `claudeIterm2.title`;
- the requirement note (`:16-22`), `name="eyesOnAgents__connections__claudeIterm2Requirement"`, in
  the existing `eyes-connection-panel__boundary` aside treatment;
- gating (`:15`, `:251-255`): `providerEnabled` (`:275`) mirrors `ClaudeObservationCard.vue`
  exactly — `<template v-if="providerEnabled">` around everything interactive, and the same
  `eyes-connection-card__provider-paused` / `providerPausedCopy` line otherwise (`:253-255`). The
  provider switch itself was **not** duplicated; it stays in the Claude section.

Three small helpers are duplicated across the two cards because both need them:
`setupActionLabel`/`setupAction` (the per-row scoped setup button's label comes from the one
profile-wide `bridge.setupAction`), `providerPausedCopy`, and `formatTimestamp`. Extracting them
into a shared module was out of scope for a relocation task.

### `ClaudeObservationCard.vue` (381 lines, was 839)

- The whole directories section and the guidance aside are gone from the template; the unused
  `IconInfoCircle` / `EyesOnAgentsClaudeEnvironmentStatus` / `ADD_CLAUDE_ENVIRONMENT_KEY` imports and
  the `directoryTitleId` const are gone with them (imports now `:208-210`).
- `Desktop metadata directories: N` renders once, `ClaudeObservationCard.vue:34-40`
  (`name="eyesOnAgents__connections__claudeDesktopDirectories"`), above the facts list.
- **How the count is sourced** (`:320-335`): `desktopDirectoryCount` reads
  `eyesOnAgentsStore.snapshot?.claudeDirectory ?? []`, destructures the **first** environment and
  returns its `desktopDirectoryCount` only when it is a finite `number`, else `null`. No Main-side
  field was added (a Non-goal). Taking row 0 rather than a max/sum is correct precisely because the
  value is platform-fixed and identical on every row: `resolveClaudeDesktopRoots`
  (`claudePath.resolver.ts:47-65`) derives from platform/home/env and never reads a
  `CLAUDE_CONFIG_DIR`. `desktopDirectoryLabel` (`:332-335`) returns `null` when the count is `null`,
  and the template `v-if`s on the label — so an empty array or an unusable value renders **nothing**,
  not `0` and not `undefined`. The remaining per-row metadata (last successful scan, next retry) is
  genuinely per-environment and stayed on the rows.
- The redundant watching itself was not touched; it is logged in `docs/plan/backlog.md` and as a new
  Non-goal in the feature doc.

### Styles

One new flat-BEM rule, `ConnectionPanel.less:301-308`
(`.eyes-connection-card .eyes-connection-card__desktop-meta`), matching the existing
`.eyes-connection-card__directories-error` specificity idiom so it wins over `.eyes-connection-card p`.
No `&` nesting, two `__` maximum. Every moved class already existed in this file, so the moved markup
needed nothing else — as the contract expected.

### i18n (3 new keys, identical order in both catalogs)

| key | en | zh |
|---|---|---|
| `eyesOnAgents.provider.claudeIterm2` | `iTerm2` | `iTerm2` |
| `eyesOnAgents.claudeIterm2.title` | `Claude in iTerm2` | `iTerm2 中的 Claude` |
| `eyesOnAgents.claudeIterm2.requirement` | the iTerm2 + `/reload-plugins` explanation | same, translated |

`en.ts:664` / `zh.ts:658` for the tab label; the `claudeIterm2` namespace at `en.ts:830-837` /
`zh.ts:817-823`, placed immediately after `claudeEnvironment` in both. The rail label is the short
`iTerm2` deliberately: the tab is 52px wide with a 9px font, so `Claude in iTerm2` would overflow;
the Claude Spark logo above it supplies "Claude", and the card heading spells the full name. Every
other string the moved markup uses is a reused existing `claudeEnvironment.*` / `claudeDirectory.*`
key — nothing was re-worded. Key order was verified by bundling both catalogs with esbuild and
comparing `Object.keys()` recursively over the entire tree: **identical, all namespaces**
(`yarn check:renderer-i18n` still dies at its pre-existing `trayHelper.init` probe before reaching
any i18n content, per `docs/plan/backlog.md`).

### Test retargeting

**`ui-source.test.mjs`** — `claudeIterm2Card` is read at `:873-875`, and every assertion about
relocated markup was **retargeted, none deleted**:

| retargeted to `claudeIterm2Card` | line |
|---|---|
| `claudeDirectories` section name | `:971` |
| read-only path `a-input` | `:977-981` |
| `environment.id === ''` → `changeClaudeDirectory()` sentinel | `:987-990` |
| `id === ''` → `useAutomaticClaudeDirectory()` sentinel | `:991-994` |
| `isEligibleForAutomatic` signature + condition | `:995-999` |
| `:disabled="!environment.canRemove` | `:1003-1007` |
| negative `environmentRows.length <= 1` | `:1008-1012` |
| `ADD_CLAUDE_ENVIRONMENT_KEY` import + negative `= '__add__'` | `:1018-1026` |
| `chooseClaudeEnvironmentDirectory(id, configDirectory)` | `:1028-1031` |
| `useAutomaticClaudeEnvironment` / `removeClaudeEnvironment` | `:1032-1033` |
| `addClaudeEnvironment(configDirectory)` + negative `addEnvironmentLabel` | `:1036-1038` |
| `renameClaudeEnvironment` / `setClaudeEnvironmentEnabled` | `:1039-1040` |
| retry sentinel + `retryClaudeDirectoryForEnvironment` | `:1043-1045` |
| `environmentLastScanLabel` / `environment.lastSuccessfulScanAt` / `canRetryEnvironment` | `:1046-1048` |

Added: `<ClaudeIterm2Card />` in the panel (`:908`); a negative assertion that the Claude card no
longer names the directories section, an environment row or the guidance aside (`:972-976`); the
Desktop-count contract — negative on the rows plus the sourcing/`null`/markup/CSS assertions
(`:1049-1072`); the gating assertions (`:1163-1177`); and the new section-identity plus i18n-key assertions
(`:1157-1187`).

**One assertion changed shape rather than target — the `configDirectory` exclusivity check**
(`:1105-1114`). It remains the **negative**, exhaustive-file-list form (a positive match cannot
prove exclusivity — task 091's review 1 caught exactly that, letting a rogue component sending
`{ configDirectory: '/tmp/evil' }` pass). What changed is only *which* files are allowed: the two
directory-carrying call sites left `ClaudeObservationCard.vue` for `ClaudeIterm2Card.vue`, so the
list is `[ClaudeIterm2Card.vue, eyesOnAgents.store.ts]` — still exactly two, not three. The task
brief expected three; that assumed the Claude card would retain a mention, and it does not. One
knock-on: an explanatory comment I first wrote in `ClaudeObservationCard.vue` used the word
`configDirectory` and tripped this file-level grep, which is the check working as designed — the
comment now says `CLAUDE_CONFIG_DIR`.

**`claude-environment-render.test.mjs`** — the esbuild entry point, outfile, imported binding and
`h(...)` call now target `ClaudeIterm2Card.vue` (`:223-249`). The stub harness needed **no**
structural change: it resolves `@renderer/common/i18n/i18n.helper` and `/eyesOnAgents\.store$/` by
pattern, and the new component imports both by the same specifiers (including
`ADD_CLAUDE_ENVIRONMENT_KEY` from the store, which the stub already exports). All 18 pre-existing
tests were kept; one was **narrowed** and one added:

- `desktop directory count and last scan render per row…` → `last scan renders per row with a
  next-retry note, and no per-row desktop count`: keeps both surviving assertions and inverts the
  desktop-count one (`:645-665`). The removed positive assertion is not lost coverage — it moved to
  `claude-setup-render.test.mjs` as a "renders exactly once" check.
- new: `the section states the iTerm2 requirement and folds to the paused line when Claude is off`
  (`:667-697`), asserting the requirement note's real text and that provider-Off renders zero
  environment rows plus the paused copy. `createStore` gained a `providerEnabled` option
  (`:169-171`, `:189`) for the second half.

Suite total: **18 → 19 tests**, all passing.

**`claude-setup-render.test.mjs`** — the fixture environment array became a named
`defaultEnvironments` const and a `createStore`/`render` parameter (`:114-135`, `:181`), so the same
SSR harness can render the Claude card with no hydrated environment. Added (`:256-278`): the
environment list no longer renders inside the Claude card; exactly **one**
`claudeDesktopDirectories` node exists and reads `Desktop metadata directories: 1`; and with
`claudeDirectory: []` that node is absent entirely. No test count change (this file is one script,
not `node --test` cases).

**`agent-connections-navigation.test.mjs`** — `ClaudeIterm2Card.vue` gets its own stub
(`:91-94`, `:121-136`) exposing `data-provider-enabled` like the Claude stub. Source assertions
extended for a third `v-show` tabpanel and the `claudeIterm2Panel` → `<ClaudeIterm2Card />` order
(`:319-330`), plus new assertions for the `ConnectionSection` union, the three-entry
`connectionSections` array, `getSectionProvider`, a negative check that no new iTerm2 image asset
appears, and the new label key (`:331-352`). The DOM test now resolves tabs by **id** rather than by
a label substring — two of three tabs are Claude tabs (`:446-456`) — asserts three tabs with their
exact labels, full `aria-selected` / `tabindex` / `aria-controls` / `aria-labelledby` /
`display` wiring for all three, that the environment list stub renders only in the iTerm2 pane, and
that the iTerm2 pane stays selectable with Claude support Off (`:457-506`). The keyboard block
(`:529-549`) now distinguishes a middle-tab move from an end-tab wrap in both directions, and checks
the roving tabindex across three tabs. Still 2 `node --test` cases in this file.

No other test touches the moved markup: `claude-provider-toggle.test.mjs:775` and
`claude-hook.test.mjs:883` read `ClaudeObservationCard.vue` only for the provider switch and the
`repair` setup label, both of which stayed. Nothing under `tests/` references the drawer at all.

### Verification (final output lines)

- `yarn typecheck:eyes-on-agents:core` → `$ tsc -p scripts/eyes-on-agents/tsconfig.strict.json` /
  `Done in 1.35s.` (0 errors)
- `yarn typecheck:eyes-on-agents:ui` →
  `$ vue-tsc --noEmit -p scripts/eyes-on-agents/tsconfig.ui.json --composite false` / `Done in 2.30s.`
  (0 errors; `tsconfig.ui.json`'s glob already covers the new component)
- `yarn test:eyes-on-agents:claude` → `ℹ tests 46 · ℹ pass 46 · ℹ fail 0` (plus the four
  script-style groups each printing their own `… tests passed`), `Done in 13.28s.`
- `yarn test:eyes-on-agents:ui` → `ℹ tests 106 · ℹ pass 105 · ℹ fail 1`; the single failure is the
  pre-existing deterministic `ui-source.test.mjs` bundle-id assertion. **Total moved 105 → 106**
  (+1: the new iTerm2-requirement/paused-gating render test). An earlier run of the same suite also
  hit the logged flaky `thread-card-open-capability.test.mjs` right-click test; that file passes
  3/3 in isolation and is unrelated to this change. Both failures are in `docs/plan/backlog.md`.
- `yarn eslint` per touched source file — **0 errors** on all of them:
  `ClaudeIterm2Card.vue` 44 warnings, `ClaudeObservationCard.vue` 30 (was 71 before the move),
  `ConnectionPanel.vue` 33 (was 27), `en.ts` 26 (was 24), `zh.ts` 21 (was 19),
  `ConnectionPanel.less` clean. Every warning is `prettier/prettier` formatting preference, the same
  rule that already fires across these files at HEAD (baselines measured by linting
  `git show HEAD:<path>` copies). The three pre-existing errors named in the brief are in files this
  task did not touch.
- Electron, packaged builds, Playwright, `test:e2e:*` — **not run**.
- Owner-only manual check (rail shows three tabs; the environment list appears only under Claude in
  iTerm2; `Desktop metadata directories` appears once under Claude; the note states the iTerm2
  requirement) — not performed; it needs a running app.

### Docs

- `docs/integrations/eyes-on-agents-layout.md`: the rail is described as three sections with the
  observed-and-opened split and the shared Claude Spark mark; the rail ASCII diagram gained the third
  tab; the tablist paragraph says navigation wraps over three entries with three `v-show` panes; a
  new **Claude in iTerm2** section states the requirement note and the shared gating; the Claude
  section gained the shown-once `Desktop metadata directories` paragraph; the environment-list
  paragraphs, the row-state table, the `Claude provider disabled` row and the ASCII mock were updated
  to drop the per-row desktop count and show the two cards; the component-boundary tree now lists
  `ClaudeObservationCard` and `ClaudeIterm2Card`.
- `docs/features/eyes-on-agents-claude-multi-environment.md`: a task-093 implementation note at the
  top of *Renderer*, and two Non-goals (the widened-terminal-support pointer, and the Desktop-watcher
  de-duplication with its backlog pointer).
- `docs/plan/backlog.md`: the redundant per-environment Desktop watcher, with the file/line evidence
  and why it stayed out of scope.
