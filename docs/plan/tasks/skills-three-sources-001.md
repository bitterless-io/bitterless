---
status: done
depends-on: []
verify: independent focused regression, actual Vue component checks and A10 full-payload integration passed; see reviews 001-3 and 001-4
---

# Skills three sources — design gate and delivery

Status: implemented and independently verified within the documented boundaries (2026-09-16).

Feature: [Skills 三层来源与实时上下文设计](../../features/skills-three-sources.md)
Visual: [Static design mockup](../../design/skills-three-sources.html)

## Owner request

Ral, 2026-09-16: BL and Cowork must expose userData global, workspace .agents Skills and institution distributed Skills as three tabs; chat must reference the fresh complete catalog, updates must reload automatically, and /view_context must let Ral inspect real loading. First submit the design and notify BotAndI; only develop after explicit confirmation.

## Design deliverables

- [x] Read-only source and official format audit; current gaps recorded in feature.
- [x] Complete and inspect the static mockup in both projects.
- [x] Validate design links, source rules, update states and acceptance matrix.
- [x] Commit design on existing dev/next and notify BotAndI with review artifacts.
- [x] Ral approves the design: 2026-09-16, “按此设计开发”.

## Approved-development sequence

| Step | Scope | Completion evidence |
|---|---|---|
| 1 | Three-source catalog, source-aware identity, read-only workspace discovery and migration compatibility | A2/A3/A6; no project writes during scanning |
| 2 | Necessary backend compatibility + content revision and private archive install flow | A7/A8; real target API and legacy client checks |
| 3 | File watcher, immutable revisions, safe-point refresh, continuous cloud checks | A5/A7/A8; stale and same-version update cases |
| 4 | Three source tabs, details/actions, both themes and constrained layout | A1/A9; actual component screenshots and keyboard evidence |
| 5 | Complete prompt catalog, explicit reference resolver and view_context | A4/A10; actual send versus exported pending comparison |
| 6 | Independent verification, docs evidence, task-scoped commits and authorized sync/notification | No unreported failed checks or unavailable deployment |

Do not modify Workflow behavior as a side effect. Preserve source files and conversation history. Source tests/builds apply after implementation; design-only artifact checks are not runtime acceptance.

Design-only review: [review 1](../reviews/skills-three-sources-001-1.md).

## Design delivery

2026-09-16: The review ZIP (both page designs, light/dark screenshots, contracts and tasks) was sent to BotAndI before the Chinese Markdown approval notice. Delivery was verified as a file message and a native Markdown post. Both design changes are committed locally on dev/next; remote sync and the parent gitlink update were not performed because the root repository submodule-alignment preflight found uninitialized registered submodules. Exact notification receipts remain in the private parent workspace temporary delivery folder.

The production Bitterless Todo MCP bridge was unavailable, so no approval Todo was created. The design notice requested approval at that time; the approval record below supersedes that pending state.

## Approval record

Ral confirmed on 2026-09-16: “按此设计开发”. This authorizes the submitted design and necessary backend compatibility work. Implementation and verification are now required; approval does not imply completion.

## Implementation handoff (2026-09-16)

The first implementation is ready for independent review; it is not yet a release acceptance claim.

- Three fixed source tabs replace Domains/scope navigation. The current selected Chat sends its workspace identity to the Workbench; source tabs only filter UI. The view retains local import/export/delete and a separate legacy-assignment entry, with source paths, status, revisions, Markdown preview and package file listing.
- Read-only workspace discovery walks from the Chat's effective CWD to the nearest Git root and supports linked package deduplication. App-owned maintenance never runs against workspace roots or immutable cloud packages. Local source IDs are path-qualified with unambiguous legacy aliases. Workspace links into the app's institution cache cannot become workspace/global entries, and owned roots do not follow package directory links.
- A directory watcher with a 300 ms debounce plus one-second metadata fallback notices missing-root creation, renames and auxiliary changes. Snapshots include content hashes and current context generation. More than forty Skills remain in the catalog; invalid packages are diagnosed and excluded from available instructions. Chat request boundaries append fresh catalogs without rewriting history. `/view_context` uses the same catalog formatter; body reads are paged with actual revision/offset metadata.
- BL now uses the Customer Skills catalog and private download endpoints for GLOBAL/current INSTITUTION. Complete paginated catalogs are checked every 60 seconds; source changes fence old responses. ZIP bytes, SHA-256, local ZIP headers, decompression bounds, CRCs, path collisions and package frontmatter are validated before immutable installation and atomic activation. Same-version content changes update; failed downloads keep the previous package; withdrawal removes only the active mapping. Global packages remain across account changes. Existing `check-updates` is not required by this client because each poll exhausts the complete catalog and compares reliable content revisions directly.

Implementation validation:

| Check | Result |
|---|---|
| `node --test tests/skillScopes/scope.test.mjs tests/skillScopes/execution.test.mjs tests/skillsThreeSources/*.test.mjs` | 27 passed (17 existing scope/execution, 10 new catalog/watch/cloud/request cases) |
| `yarn tsc --noEmit -p tests/skillsThreeSources/tsconfig.node.json --composite false` | Passed, strict focused Node check |
| `yarn vue-tsc --noEmit -p tests/skillScopes/tsconfig.web.json --composite false` | Passed, actual Skills/Workbench Vue dependency graph |
| Full Main TypeScript against the unchanged HEAD via read-only compiler-host source substitution | 64 existing diagnostics before and after, no added diagnostic; full Main is not a clean baseline |
| `node scripts/environment/runWithRuntimeProfile.cjs debug_dev -- yarn electron-vite build` | Main/preload/renderers bundled successfully |
| `yarn build` | Blocked before compilation by the dependency tree's missing Electron binary (`ensure-native`); no app launched |
| `yarn check:renderer-i18n` | Existing failure: `maestroTabAlias must start language initialization before evaluating product UI`; this change does not edit that entrypoint |
| `git diff --check` | Passed |
| Electron E2E / packaged app smoke | Not run: Ral has not requested Electron E2E |

The existing `scripts/typecheck/surfaces.mjs` prints a false green when its internal tool executable cannot run; that output was discarded. Only the actual compiler exit codes and HEAD diagnostic comparison above count. Dependencies were reused from an existing local installation after checking that its packages contained no links to workspace/source repositories; all source entries and aliases resolve this checkout.

Independent source review and actual component visual/keyboard verification remain pending at this handoff. No cloud release, Git commit or push was performed by the implementation worker.

Independent-review follow-up: fixed workspace Skills whose directory basename, YAML `name` and sidecar `display_name` differ. Canonical names now drive standard Skill lookup/catalog identity; sidecar labels are separate UI presentation. Existing recording business names remain compatible and also accept their canonical YAML name. Two added regression cases pass; the focused suite is now 29/29, and strict Node plus Vue typechecks remain passing.

### Independent-review fixes: authorization aliases and read-only writes (2026-09-16)

- Every Skill read/run/manage entrypoint now resolves bare names and legacy aliases to one qualified reference before authorization. `resolveAuthorizedSkill` pins that reference, scope generation and revision; recipe/body reads use the pinned reference. Script/replay guards continue across API approval, UI actions and replay's final delay. A later account/institution change cannot reinterpret the original alias.
- Registry archive, overwrite and delete reject managed, workspace, institutional and other read-only sources. Training checks writability before its model call and again after that await; global local recordings retain archive/overwrite behavior. Institutional summaries expose the same read-only status to the UI.
- Regression: **46/46** Node tests pass (`node --test tests/skillScopes/scope.test.mjs tests/skillScopes/execution.test.mjs tests/skillsThreeSources/*.test.mjs`). New coverage checks bare-name and legacy-alias authorization across ten public entrypoints, actual script/replay cancellation on logout/institution switch/same-account generation changes, post-model writability recheck, all read-only source classes leaving files unchanged, and local recording writes remaining available. Log: `/tmp/bl-skills-alltests.log`.
- Focused strict Node (`yarn tsc --noEmit -p tests/skillsThreeSources/tsconfig.node.json --composite false`) and Vue (`yarn vue-tsc --noEmit -p tests/skillScopes/tsconfig.web.json --composite false`) pass. Full Main compiler comparison against HEAD remains **64 baseline / 64 current diagnostics, zero new**; no pre-existing diagnostics were suppressed. Independent verification remains owned by the reviewer.
- Final source-freeze bundle: `node scripts/environment/runWithRuntimeProfile.cjs debug_dev -- yarn electron-vite build` passes (Main, Preload and renderer bundles), log `/tmp/bl-skills-bundle.log`. This does not launch Electron. The standard `yarn build` native precheck limitation and pre-existing i18n failure recorded above remain unchanged; Electron E2E was not run.

## Delivery closure (2026-09-16)

Independent [review 3](../reviews/skills-three-sources-001-3.md) passed after all blocking findings were fixed and retested. The complete three-source implementation and actual component evidence are delivered on dev/next. The corresponding authorized backend release passed 23 real HTTP checks and cleaned every fixture; code and release evidence are synchronized separately in the backend repository. Whole-project baseline type/native/i18n limitations remain explicitly recorded above and in the independent report. No Electron app was started or provider called.

### Post-merge verification — `683a0cb8` (2026-09-16)

After merging remote `dev/next` (`37f76ab6`), the Skills implementation was revalidated without changing application source:

| Check | Result |
|---|---|
| `node --test tests/skillScopes/scope.test.mjs tests/skillScopes/execution.test.mjs tests/skillsThreeSources/*.test.mjs` | **46/46 passed**, `/tmp/bl-skills-merged-tests.log` |
| `yarn tsc --noEmit -p tests/skillsThreeSources/tsconfig.node.json --composite false` | Passed, `/tmp/bl-skills-merged-node.log` |
| `yarn vue-tsc --noEmit -p tests/skillScopes/tsconfig.web.json --composite false` | Passed, `/tmp/bl-skills-merged-web.log` |
| `node scripts/environment/runWithRuntimeProfile.cjs debug_dev -- yarn electron-vite build` | Main/Preload/renderers passed in 33.23 seconds, `/tmp/bl-skills-merged-bundle.log` |
| `yarn check:renderer-i18n` | Still fails the existing `maestroTabAlias must start language initialization before evaluating product UI` assertion, `/tmp/bl-skills-merged-i18n.log` |

The i18n failure is an existing checker/entrypoint mismatch: the checker requires a dynamic `import('./…')`, while `src/renderer/maestro/tabAlias/src/tabAlias.ts` intentionally uses a static component import to avoid the documented `file://` CSS-preload/CSP failure. Its bootstrap still awaits language initialization before Vue mounting. Both this entrypoint and `scripts/renderer-i18n/check-renderer-i18n.mjs` are unchanged between remote `37f76ab6` and merged `683a0cb8`; this is not a Skills or merge regression. The earlier full-Main diagnostic comparison is historical evidence and was not relabeled as a fresh post-merge comparison. No Electron app or E2E was run; no application code was changed during this verification.

## A10 final payload audit

Final completion audit adds [review 4](../reviews/skills-three-sources-001-4.md): execute the actual next-input export and request wrappers with full catalog comparison. Existing source tests and review 3 are retained; the supplemental integration check and independent review passed. Both desktop suites now pass 47/47. No new product scope or cloud deployment is required.

### A10 integration evidence follow-up (2026-09-16)

Added `tests/skillsThreeSources/requestParity.test.mjs` to replace the prior helper-only inference with actual call-path evidence. It compiles unchanged production modules and executes `MaestroAgentService.copyNextTurnContext`, real export/prompt assembly, and clipboard output. The real `handleAgentTurn` idle-steering branch registers the Skills provider; real `BaseAgent.init` and `PiRuntimeAdapter.createSession` install the production `transformContext` request hook. Only desktop/cloud boundaries and the external SDK session shell are mocked; no Electron process, provider request, credentials or new dependencies are involved.

The same actual Registry contains **251 Skills across global/workspace/institution**, including three identical canonical names with distinct references. Assertions compare every exported/request catalog JSON payload byte-for-byte, then compare each latest entry's identity, description, source, reference, path, content revision and implicit-invocation policy with the actual snapshot. A metadata plus auxiliary-resource update changes only the intended Skill: the next real export and request share the new snapshot revision, prior catalog/history bytes are preserved, the native transform remains chained, and the SDK session is created only once.

`node --test tests/skillScopes/scope.test.mjs tests/skillScopes/execution.test.mjs tests/skillsThreeSources/*.test.mjs` now passes **47/47** on source HEAD `f0468d3c` plus these test changes (`/tmp/bl-skills-a10-alltests.log`); the new isolated integration case also passes (`/tmp/bl-skills-request-parity.log`). `git diff --check` passes. The older helper test was renamed to describe its actual scope. No production logic was changed; independent A10 evidence review passed in review 4.

The supplemental test and evidence are a local follow-up commit pending remote synchronization. Root `.gitmodules` now specifies `main` for `bitterless-private` and `micromeet-bruno`, while their checkouts remain `dev/next`; root policy blocks further pull/push/gitlink updates until Ral chooses the branch alignment. Already-pushed product code and cloud deployment remain unchanged.
