# Skills three sources — independent acceptance

Date: 2026-09-16. Reviewer: independent verification agent, separate from implementation. Contract: [approved feature](../../features/skills-three-sources.md). This review does not launch Electron and does not treat a screenshot fixture as authenticated application data.

## Findings and disposition

| ID | Impact | Finding | Disposition |
|---|---|---|---|
| BL-R1 | P2 | Workspace discovery used the folder name before YAML `name`; an OpenAI-format skill with a different folder/name could not be found by its canonical name. | Closed: canonical YAML name, folder name and optional display name have distinct behavior; the new real-files regression passes. |
| BL-R2 | P1 | Newly supported bare names/legacy aliases could reach institution recipes after `authorizeSkillReference` had already accepted the raw non-institution string. Run guards then carried no institution context. | Closed: `resolveAuthorizedSkill` pins the resolved source before authorization and supplies the same guard to script/replay. Bare-name/legacy-alias revocation and generation-switch regressions pass. |
| BL-R3 | P2 | `archiveSkill` / `overwriteSkill` did not enforce the read-only/managed metadata. The existing training API could modify a downloaded immutable package. | Closed: the registry-level `assertWritableSkill` gates archive, overwrite and delete; training checks before/after model work. Real-files read-only preservation and writable-local regressions pass. |

Verdict: **PASS within the verification boundaries below. All three reported findings are closed; no remaining blocking finding in this review.**

## Independently executed evidence

- `node --test tests/skillScopes/scope.test.mjs tests/skillScopes/execution.test.mjs tests/skillsThreeSources/*.test.mjs`: initial 27/27 passed; after the review fixes, the complete focused run passed **46/46**. Covers real filesystem composition, per-Chat workspaces, nearest Git/submodule boundary, linked skills and cycles, invalid YAML, resource revisions, watcher creation/rename, complete prompt, cloud hash/revision replacement, logout/late downloads, and scoped execution.
- Additional private harness `tmp/skills-three-sources-desktop-review/large-catalog.mjs` in the overmind workspace: **251 actual SKILL.md files** discovered by the real Registry; all 251 distinct references and names survive its prompt; a second Chat workspace contains none of the first Chat's skills.
- Inspected the request hook from `BaseAgent` through `PiRuntimeAdapter`: fresh catalog is appended to the ephemeral model request; history is retained. `copyNextTurnContext` uses the same catalog formatter and is explicitly a next-input preview. No provider call was made during this review.
- The actual `WorkbenchSkillsView.vue` was compiled and mounted in headless Chrome with a deterministic store fixture. Three source tabs, arrow-key selection, 800 × 600 without horizontal overflow, 700-pixel single-column detail, and Escape back-to-list passed without browser errors. Light/dark screenshots were visually inspected. No Electron process was started.

[Light](../../design/skills-three-sources-implementation/bl-skills-light.png) · [Dark](../../design/skills-three-sources-implementation/bl-skills-dark.png) · [800 × 600](../../design/skills-three-sources-implementation/bl-skills-800.png) · [Narrow detail](../../design/skills-three-sources-implementation/bl-skills-700-detail.png)

The rendering harness and its logs remain under `tmp/skills-three-sources-desktop-review/` in the private parent workspace; the screenshots above are real tracked project artifacts with synthetic content.

## Validation boundaries

Implementation evidence reports focused Node/Vue type checks passed, with the whole-main compiler's **64 existing diagnostics unchanged**. The standard `yarn build` launcher is blocked by the local dependency cache missing Electron's binary; the equivalent `debug_dev` `electron-vite build` compiled main, preload and all renderers. The whole i18n guard fails on the unchanged Maestro tab-alias assertion. These are not relabeled as passing whole-project checks.

The cloud API is verified separately in `bitterless-private`; this review does not claim real Electron IPC, an installed user profile, or Ral's planned `/view_context` human review. Electron E2E was deliberately not run under the workspace rule.

Post-sync integration check: remote Tab Alias/OnlyPreview changes were merged at 683a0cb8 with only the documentation index requiring both entries to be retained. The implementation worker reran all 46 Skills regressions, strict focused Node/Vue checks and the full Electron-Vite bundle successfully. The same i18n assertion still fails: the existing checker expects a dynamic import while the remote entrypoint intentionally uses static import for its documented file-URL/CSP issue; neither file differs from the merged remote baseline. No additional Skills source changes were made.
