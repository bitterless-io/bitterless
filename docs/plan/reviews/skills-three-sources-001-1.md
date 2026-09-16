# Skills three sources — design review 1

Date: 2026-09-16
Result: design review passed; waiting for Ral approval. No implementation or runtime acceptance.

## Reviewed artifacts

- [Feature contract](../../features/skills-three-sources.md)
- [Static page design](../../design/skills-three-sources.html)
- [Delivery task and approval gate](../tasks/skills-three-sources-001.md)

## Evidence

Read-only audits covered both desktop registries, workspace resolution, source identities, UI, cloud synchronization, runtime prompt assembly and view_context; backend audits covered current Mono and BL Private Skill APIs. Official OpenAI local Skill format/discovery documentation is cited in the feature.

An independent review checked the six owner requirements against the design. Follow-up corrections preserve global Export/Delete, use background/spacing instead of borders for hierarchy, remove an undesigned enable/disable setting from the budget fallback, remove the workspace Import action, and distinguish BL userData/cowork paths from Cowork userData paths.

Static HTML was rendered with existing headless Chrome, without launching Electron. Both products were checked in light/dark mode, at desktop and constrained widths, including 390px preview, with keyboard source switching. Each selected source shows exactly one panel; no horizontal overflow was observed. HTML contains no script or external resource dependency. Source buttons other than the CSS tab and details controls are explicitly design demonstrations.

Root artifact checks verified local document links, explicit anchor targets, identical shared contract sections across the two feature files, and git diff whitespace checks. Screenshots and machine-readable rendering checks are private temporary artifacts under overmind tmp/skills-three-sources-design; no actual Skill inventory or personal institution data was captured.

## Limits and approval

No application source, backend, cloud configuration, real Skill files or local databases were changed. No source test/build result is claimed for this design-only change. Actual source integration, current online API behavior, timing targets, model-input correctness and migration behavior require the A1–A10 implementation acceptance matrix after Ral approves.

Only Ral's explicit confirmation can open the development gate; a commit or delivered BotAndI message is not approval.
