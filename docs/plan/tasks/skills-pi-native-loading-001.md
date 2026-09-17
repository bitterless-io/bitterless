---
id: skills-pi-native-loading-001
scope: Skills three-source discovery/reload mechanism (Main process)
status: done
depends-on: []
verify: passed
---

# Replace hand-rolled skill discovery/watching with Pi's native skill loader

Issue: [skill-catalog-watcher-reinvents-pi-native-loading](../../issues/skill-catalog-watcher-reinvents-pi-native-loading.md)
Design: [Skills 三层来源与实时上下文设计](../../features/skills-three-sources.md) — contract (three
tabs, references, completeness, institution auth, `/view_context`) is unchanged by this task; only the
discovery/parse/reload mechanism described there changes, per the 2026-09-17 addendum at the top of that
doc.

## Owner request

Ral, 2026-09-17: stop building our own skill directory-watching/registry-scanning solution — use the Pi
SDK's native skill-loading capability directly. Host only configures the skill *source* roots. Directory
watching caused performance problems before and must not happen again.

## Implementation decision (2026-09-17 handoff)

Use the installed Pi coding-agent SDK's synchronous `loadSkillsFromDir` separately for each configured source root. The registry's public callers are synchronous, and Pi's aggregate `loadSkills` deduplicates names; per-root native loading preserves the approved same-name, qualified-reference contract without converting unrelated IPC consumers to async. Host code retains root selection, sidecar metadata, package revisions and authorization; Pi owns discovery and skill parsing. No persistent directory watcher or local polling is permitted.

An institution is optional: without a valid authorized context, omit that root and refuse its references while retaining Global and Workspace discovery, authoring, tool use and normal chat. Do not wait for an institution authorization request solely to prepare local skills when the current authorized context is absent; normal background synchronization can establish a valid context later. A missing institution is not an owner-login prerequisite for this task. Stale institution packages remain on disk but are not exposed.

## Recovered authoring and execution requirement

The original Agent Skills request also requires ordinary skill creation and script use. Reuse Pi's enabled `read`, `write`, `edit` and `bash` tools, with a small dynamic instruction block instead of a separate `skill-generate` tool or management subsystem:

- With an explicitly selected Chat workspace, create `<workspace>/.agents/skills/<name>/SKILL.md`; without one, use the application/profile's `skill-library/shared/<name>/SKILL.md` global write root. Do not use the legacy `skills` directory for new packages, since unknown legacy entries require migration. Existing recording/import flows keep their approved destinations.
- Supply the absolute current authoring root so a running Pi session's older cwd cannot misroute the package. Produce valid name/description frontmatter, an instruction body and relative `scripts/` resources when useful.
- Prefer the bundled Bun executable for JS/TS scripts via existing `bash`; give its actual resolved absolute path and quote it. For other runtimes, follow the skill's own commands and available tools. Load the skill instructions before executing scripts. Do not require institution credentials for local authoring or execution.
- A new or edited package becomes discoverable at the next catalog refresh/turn. The existing recording recipe runner is distinct from ordinary script skills.

## Objective

In `src/main/maestro/skills/`:

1. Replace `discoverSkillFiles`, `describeSkillFile`, `workspaceSkillRoots`
   (`skillDiscovery.service.ts:1-101`) with calls into `@earendil-works/pi-agent-core`'s
   `loadSourcedSkills(env, inputs: Array<{path, source}>, mapSkill, context)` — one `{path, source}` entry
   per configured root (global write root, per-Chat workspace root(s), institution local package root),
   `source` carrying `layer` (`global|workspace|institution`) plus whatever else the registry's existing
   identity model needs (root identity for stable references). `mapSkill` is where the registry's own
   `SkillSummary` shape (id/reference/layer/kind/domain/etc.) gets built from Pi's plain `Skill` +
   `source` — this is the seam that keeps stable qualified references, institution auth binding, and
   legacy-alias resolution exactly as `docs/features/skills-three-sources.md` #1 requires.
2. Delete `SkillDirectoryWatcher` (`skillDiscovery.service.ts:116-151`) — the persistent `fs.watch` +
   `setInterval(..., 1000)` poll — entirely. No replacement persistent watcher, timer, or poll of any
   kind. Instead, `SkillRegistryService` (or its caller) calls Pi's `DefaultResourceLoader.reload()` (or
   the equivalent `loadSourcedSkills` re-invocation, since the registry's own state — not a raw
   `DefaultResourceLoader` instance — is the thing other code reads) at the safe-refresh points the
   design already lists in [#4](../../features/skills-three-sources.md#s4): before building the next-turn
   prompt / `/view_context` export, on explicit user refresh action, and after institution sync completes.
   Content-revision invalidation (`skillRevision`) keeps working off the file manifest + hash Pi/the
   registry already compute per skill package — it does not need a live watcher to stay correct, only a
   reload call before it's read.
3. Wire `createPiResourceLoader` (`src/main/agent/runtime/piRuntimeProtocol.ts:9-21`) so `getSkills`
   returns the registry's real current snapshot (mapped to Pi's `Skill[]` shape or passed through
   `formatSkillsForPrompt` directly) and `reload` calls the registry's real reload path, instead of the
   deliberate `{ skills: [], diagnostics: [] }` / no-op stub.
4. Use `formatSkillsForPrompt(skills, fileReadTool)` (from `pi-coding-agent`) for the system-prompt skill
   block in `src/main/agent/runtime/agentPrompt.ts: selectAgentSkillBriefs`, replacing the hand-formatted
   block, so the prompt matches the Agent Skills standard Pi already implements rather than a parallel
   format. Keep the "complete catalog, no domain/40-item truncation" requirement from design #3 — call
   `formatSkillsForPrompt` with the full three-layer list, not a filtered one.
5. Keep unchanged, because Pi has no equivalent and the approved design still requires them: stable
   qualified references (layer + root identity + relative path) and legacy-alias resolution, institution
   auth/scope fencing (`skillScope.storage.ts` / `skillScope.context.ts`), migration handling for
   unassigned recordings, and the "recording" skill kind's recipe storage/audit
   (`skillRecipe.types.ts`, `recipeRedact.ts`, `skillAudit.service.ts`, and the `buildSkillMarkdown` /
   `buildExternalSkillMarkdown` family in `skillRegistry.service.ts`) — these still emit plain
   `SKILL.md` files Pi's loader reads like any other skill; only their authoring/export path is
   host-owned, unaffected by this task. Local import/export/delete for owned (global + recording) skills
   are unaffected.

## Explicitly out of scope

- Institution cloud sync/download/authorization (`skillScope.storage.ts`'s cloud install path, backend
  `/skill/*` calls) — Pi has no concept of it; it stays fully host-owned and unmodified.
- The three-tab Workbench UI (`WorkbenchSkillsView.vue`, `workbench.store.ts`).
- The backend `/skill/*` API contract in `bitterless-private`.
- `micromeet-cowork`'s mirror of this change — tracked as its own task in that project per the paired
  bitterless/micromeet-cowork development rule; this task covers bitterless only.

## Context

- [docs/features/skills-three-sources.md](../../features/skills-three-sources.md) — #1 (source/identity
  rules), #3 (completeness contract for the prompt catalog), #4 (reload triggers, now mechanism-neutral
  per the 2026-09-17 addendum).
- [docs/issues/skill-catalog-watcher-reinvents-pi-native-loading.md](../../issues/skill-catalog-watcher-reinvents-pi-native-loading.md)
  — full file:line citations of the current implementation and the exact Pi APIs (`loadSkills`,
  `loadSourcedSkills`, `DefaultResourceLoader`, `formatSkillsForPrompt`) to use, read directly from
  `node_modules/@earendil-works/pi-agent-core/dist/harness/skills.d.ts`,
  `node_modules/@earendil-works/pi-coding-agent/dist/core/skills.d.ts`,
  `node_modules/@earendil-works/pi-coding-agent/docs/skills.md`, and
  `node_modules/@earendil-works/pi-coding-agent/examples/sdk/04-skills.ts`.

## Path

- `src/main/maestro/skills/skillDiscovery.service.ts`
- `src/main/maestro/skills/skillRegistry.service.ts`
- `src/main/agent/runtime/piRuntimeProtocol.ts`
- `src/main/agent/runtime/agentPrompt.ts`
- `tests/skillsThreeSources/*`
- `tests/skillScopes/*`
- `docs/features/skills-three-sources.md` (mechanism sections only, if the implementation needs a detail
  the addendum didn't already cover)

## Verification

- `node --test tests/skillScopes/scope.test.mjs tests/skillScopes/execution.test.mjs tests/skillsThreeSources/*.test.mjs`
  stays green (update fixtures/assertions for the new loader internals; do not weaken the 251-skill
  completeness, stable-reference, or authorization coverage those suites already carry).
- Focused strict typecheck for the touched modules (match the existing
  `yarn tsc --noEmit -p tests/skillsThreeSources/tsconfig.node.json --composite false` pattern).
- `grep -n "setInterval\|setTimeout" src/main/maestro/skills/skillDiscovery.service.ts` finds nothing —
  confirms no persistent timer/poll remains.
- `createPiResourceLoader`'s `getSkills`/`reload` are exercised by a real test (not left as the empty
  stub) — extend or add to `tests/skillsThreeSources/requestParity.test.mjs`.
- `yarn build` (or the existing `electron-vite build` verification path) still bundles cleanly.

## Appendix — three-source roots verified on the owner's Mac (2026-09-17)

Ral asked to see all three layers listed in Workbench with a real probe skill in each. A
`three-source-probe-<layer>` package was installed into each resolvable root and the **real**
`SkillRegistryService` was then run against them (temp copy of the data root so app data is
untouched; workspace root is the app's actual default workspace, whose discovery is read-only).
Harness: `overmind/tmp/agent-skills-probe/{install-probe-skills,verify-three-sources}.mjs`.

| layer | root formula (source) | Preview edition result |
|---|---|---|
| global | `<userData>/cowork/skill-library/shared` — `maestroDataRoot()` (`src/main/maestro/data/maestroDataRoot.ts:7`) + `SkillScopeStorage.shared`. `fields()` maps it to scope `shared` → layer `global`. | `count=1 probe=FOUND status=ready` |
| workspace | `<defaultWorkspaceRoot()>/.agents/skills` and every `.agents/skills` up to the git root (`skillDiscovery.service.ts: workspaceSkillRoots`); `~/.bitterless-<profileId>/default-workspace` (`files/defaultWorkspace.ts:21`) | `count=1 probe=FOUND status=ready` |
| institution | `<userData>/cowork/skill-library/<accountScope>/<institutionId>`, `accountScope = sha256(\`${baseUrl}\n${accountId}\`)`, `institutionId` numeric (`workflowLibrary.service.ts:159-161` → `assetScope` → `skillScope.context.ts`) | `count=1 probe=FOUND` **only with an injected authorized context** |

**The institution layer cannot be materialised offline in bitterless.** `customerSessionService`
holds the Core session **in memory only, by design** (`src/main/auth/customerSession.service.ts`:
「只放内存,不落盘」 — the token lives in the renderer's localStorage and is pushed to main on login),
and no institution has ever been authorized on this Mac: every edition's
`<userData>/cowork/institution-workflows/` contains only `shared/`, never a `<namespace>/<id>` pair.
So the namespace hash has no offline source. Once Ral signs in to BL Private and selects an
institution, `WorkflowPackageStorage` creates `institution-workflows/<namespace>/<id>`
(`workflowLibrary.service.ts:162`) — the **same** pair the skill library uses — and re-running the
installer auto-detects it. Until then the institution tab is correctly empty, not broken.

Also confirmed while checking: the three-tab Workbench UI (`WorkbenchSkillsView.vue:7-9`,
`store.skillLayers` / `store.skillCount(layer)`) and the three-layer `catalog()` grouping
(`skillRegistry.service.ts:48`) are already in place — this task changes the discovery/reload
*mechanism* underneath them, not the layering or the UI.

## Invariant this task must not break — no institution must not block normal function

Ral, 2026-09-17: 「bl 无机构的话也别阻塞 正常的功能」. With **no authorized institution** — never signed
in to BL Private, no institution membership, signed out, or the institution backend unreachable — the
Global and Workspace layers must keep working exactly as when signed in. Only institution-scoped things
may become unavailable.

Verified against the current implementation by running the **real** `SkillRegistryService` (2026-09-17):

| case | result |
|---|---|
| `skillScopeContext.current()` returns `null` | Global + Workspace still discovered, `layer` correct, packages `ready`, no error entries |
| a stale `skill-library/<account>/<institution>/` left on disk by a previous login | excluded from the catalog, the scan does not throw, the files are not deleted, the other two layers stay clean |
| `authorize()` **throws** (backend unreachable) | catalog unaffected — it is synchronous and never calls `authorize()`; only `authorizeSkillReference` on an `institution:` ref does, and it short-circuits for `shared:` / `workspace:` refs |
| creating/importing a skill while signed out | `creationRoot()` still returns the Shared root, so authoring has a destination |

This was previously unguarded for the **Workspace** layer: `tests/skillScopes/scope.test.mjs` only
covered a Shared *builtin* while logged out. New paired regression suite
**`tests/skillScopes/noInstitution.test.mjs`** (4 tests, body byte-identical to micromeet-cowork's copy,
run by `yarn test:skill-scopes`) now pins all four rows above. Baseline after adding it: **37/37 pass**
(was 33/33).

Two things the implementer should know:

1. Resolving a Workspace skill only works inside `registry.withWorkspace(path, …)` — `resolveSkill`
   reads the workspace from AsyncLocalStorage, not from the `catalog(workspace)` argument. The new test
   documents this; keep it true after the swap.
2. Pre-existing baseline failure, **not** caused by this work: `tests/skillsThreeSources/requestParity.test.mjs`
   fails at HEAD with `TypeError: Cannot read properties of undefined (reading 'inMemory')` (the test's
   esbuild stub does not provide `SessionManager`). 13/14 pass in that suite. There is no `yarn` script
   for `tests/skillsThreeSources/*`; it runs as `node --test tests/skillsThreeSources/*.test.mjs`.

> **Superseded refresh policy:** Ral’s subsequent request replaces every-turn rescans/forced prompt rebuilds with Pi-style cached resources and explicit reload; see [task 002](skills-pi-reload-cache-002.md). The original verification below did not cover electron-vite dependency externalization and does not prove dev startup; task 002 repairs and tests that boundary.

## Delivery (2026-09-17)

Implemented and code verified; owner application testing remains. Pi's native per-source discovery, parsing and prompt formatting replace the local walker/watcher. Registry skills and reload feed the real Pi session. Each next turn rebuilds its native system skill appendix; tests cover edits, logout and workspace changes without resetting tools or history, and host prompt replacement remains valid with the native appendix.

The narrow `scripts/maestro/piSkillSdk.plugin.ts` / `src/main/maestro/skills/piSkillSdk.ts` bridge bundles installed SDK skill APIs into Electron's CJS output without pulling in CLI initialization. Existing model/session imports remain dynamic ESM. `skillPrompt.ts` keeps the native prompt and qualified-reference metadata together; `runtime/skillAuthoring.ts` supplies the absolute workspace/global creation root and bundled Bun command. No generation service was added.

Without a valid institution context, that layer is excluded and chat/export/skill-list preparation makes zero institution authorization/cloud requests. Stale institution packages and nested private symlink aliases cannot enter the local catalog. Existing import, recording and valid-institution permission behavior is retained.

Verification run from the project root:

| Command | Result |
|---|---|
| `node --test tests/skillScopes/*.test.mjs tests/skillsThreeSources/*.test.mjs` | 59/59 passed, including native discovery, CJS execution, 251-skill completeness, no-institution and authoring |
| `node --test tests/skillsThreeSources/requestParity.test.mjs` | Final 2/2 passed after the Pi session integration fix; expanded checks for edits, logout, workspace switch, prompt replacement, tool/history preservation |
| `yarn tsc --noEmit -p tests/skillsThreeSources/tsconfig.node.json --composite false` | Passed after final code changes |
| `yarn build` | Passed; final run 34.00 s |
| `git diff --check` and discovery timer/watch scan | Passed; no directory watcher or local polling |

The earlier requestParity fixture failure noted in the appendix is resolved by updating the SDK shell fixture. No Electron/E2E or actual application launch, independent review, commit, branch switch, installation or release was performed. Existing unrelated edits remain.

### Human verification

Use a build containing these changes. With no valid institution, open Workbench → Skills and confirm Global/Workspace probes remain available, the Institution layer can be empty, normal chat responds, and `/view_context` excludes stale institution entries. Edit a skill and refresh/send again: the new content appears without restarting. Switch Chat workspaces and confirm only that Chat's sources change.

Ask the agent to create and run a simple JS/TS skill that prints `skills-ok`: with an explicit workspace it must create `.agents/skills/<name>`; without one it must use the profile's `skill-library/shared/<name>`, invoking bundled Bun via the existing command tool. Valid institution testing is optional when such authorization already exists; logging in is not required to accept the local paths.
