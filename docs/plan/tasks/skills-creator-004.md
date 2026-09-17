---
id: skills-creator-004
scope: Lightweight standard skill creator workflow
status: done
depends-on: [skills-p0-completeness-003]
verify: passed
---

# Implement approved P1-5 lightweight skill creator

Ral, 2026-09-17: after P0, also implement the current assessment's P1-5 (standard skill creator). The separate Git/GitHub/npm/ref installation request is design-only this turn and is excluded from this implementation.

## Contract

- Provide a dedicated, discoverable lightweight standard skill creation workflow in both BL and Cowork, without a new management UI or training platform. Reuse existing native/host file and process tools, Pi parsing and destination rules.
- Include a small instruction-only and script-oriented template/initializer path, creating only requested useful resources. Use the explicitly selected Chat workspace .agents/skills, otherwise profile Shared; institution packages stay managed/read-only. Do not overwrite a same-name existing package implicitly.
- Add a callable fast format check for generated/edited packages, using native Pi discovery/parser semantics plus narrowly scoped authoring checks (required name/description, unfinished template markers, referenced entry/resource existence where explicitly declared). Avoid replacing Pi's discovery with a new scanning framework or copying Codex-only metadata restrictions.
- Creator instructions must ask only essential missing task information, select representative input and expected observable outcome when useful, and use existing tools to verify that outcome. Do not run arbitrary/generated scripts just to label every skill tested; preserve host approvals and scope checks.
- Report generated, format-checked and behavior-verified as separate states. Never imply a successful parse proves runtime behavior; unexecuted behavior must be recorded as not verified. Sidecar remains optional.
- Cowork creator works with both Pi and the new AI-CRMS standard skill tools, including Shared with no selected workspace. Preserve reload/cache/New Chat and no-institution behavior.

## Verification

After P0 in this project is code-verified, implement this task serially on the current branch. Test instruction-only and script template creation, validation failures, existing destination preservation, selected workspace/Shared and approved representative execution results with no live model. Run scoped types and relevant build. No Electron/E2E or independent review. Update task/feature/index and send precise evidence to root for the HTML matrix update. Completed P1-5 is removed from chapter 3, with outcome retained in chapter 1 and evidence history.

## Implementation — 2026-09-17

- `skillCreator.ts` provides the shared BL/Cowork helper contract: `initializeSkill({root,name,description,template})` and `checkSkill(directory)`. It uses native Pi `loadSkillsFromDir`/`parseFrontmatter`, small instruction/script templates, hidden staging and explicit collision refusal. The script template is an unfinished JSON-argument stub; it cannot silently run a sample and imply the requested behavior exists.
- `skillCreatorTools.ts` adds the discoverable `skill_creator` action `init`/`check` to the existing host tool policy path. It chooses the actual current Chat workspace or profile Shared, without institution authorization calls. Configured root and real-path checks exclude institution/cloud-managed packages and symlink escapes. No new UI, model worker or installer was added.
- `init` creates only the requested useful template, marks `generated:true`, and leaves `formatChecked:false` while TODOs remain. Native metadata failures clean the stage and leave no published package. Existing packages are never implicitly overwritten. Successful init invalidates the cached catalog.
- `check` is read-only. Native diagnostics, missing explicit name/description, unfinished `SKILL_CREATOR_TODO` markers and invalid/missing optional `entry`/`resources` files keep `formatChecked:false`. Ordinary standard packages need neither creator hints nor a sidecar. The optional frontmatter hints are local existence checks, not a new loader or runtime execution contract.
- Both actions always return `behaviorVerified:false`; a caller cannot turn it true by assertion. Tool and Chat instructions require separate evidence from existing execution tools when a representative behavior check is useful and authorized. External edits retain the explicit Skills Refresh or new Chat discovery boundary.

Code verification and owner Chat acceptance are recorded below; no Electron launch, E2E, live model or independent review is part of this task.

## Verification results — 2026-09-17

| Command | Result |
|---|---|
| `node --test tests/skillsThreeSources/creator.test.mjs` | 6/6 passed. Real helper/tool/registry checks cover instruction and script templates, Shared without institution, explicit workspace, separate evidence states, native YAML/name/description diagnostics, TODOs, entry/resources, existing and broken-link collisions, cleanup, scope/link protection, host confirmation/disable policies and cached ordinary reads. |
| `node --test tests/skillScopes/*.test.mjs tests/skillsThreeSources/catalog.test.mjs tests/skillsThreeSources/cloud.test.mjs tests/skillsThreeSources/requestParity.test.mjs tests/skillsThreeSources/nativeReload.test.mjs` | Initial run: 63/64 passed. The cloud fixture rebuilt ZIPs with the current entry timestamp, causing a same-content hash change across the ZIP time boundary. Fixed only the fixture timestamp; no cloud production changes. All other no-institution, source/auth/cache/New Chat/request/native authoring checks passed. |
| `node --test tests/skillsThreeSources/cloud.test.mjs` | 5/5 passed after the deterministic fixture fix, including the previously failing repeated-refresh download count. |
| `yarn tsc --noEmit -p tests/skillsThreeSources/tsconfig.node.json --composite false` | Passed (5.50 s); includes the new creator helper/tool. |
| `yarn build` | Passed (77.02 s); `/tmp/bl-creator-build.log`. Actual `out/.bitterless-runtime-profile.json`: `debug_dev`, release channel `dev`, Vite mode `debug`. |
| Scoped `git diff --check` for creator source, controller/prompt/catalog integration, tests and task/feature/index docs | Passed. |

The script fixture was deliberately completed in the test, then executed locally with Node from outside its package directory. Input `{"name":"Fixture"}` and a relative reference file produced the observed `{"greeting":"Hello Fixture"}`. This is separate execution evidence; subsequent creator checks still return `behaviorVerified:false`, including when a caller supplies a false claim of verification. Ordinary Pi/Bun authoring instructions remain covered by the existing regressions.

Owner acceptance remains a live Chat check: with an explicitly selected workspace, request a small instruction skill and then a useful script skill with a representative input/expected result; confirm the package location, template completion, format result and separate observed behavior evidence. Repeat with no selected workspace/no institution and confirm profile Shared. An existing name must not be replaced. After ordinary file-tool edits, use Skills Refresh or a new Chat for catalog discovery. Root owns this human handoff and the cross-project assessment update. There is no remote installer, automatic arbitrary-script execution or general evaluation platform in this delivery.
