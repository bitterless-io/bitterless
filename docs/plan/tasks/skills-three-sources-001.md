# Skills three sources — design gate and delivery

Status: design prepared; waiting for Ral approval. Implementation not started.

Feature: [Skills 三层来源与实时上下文设计](../../features/skills-three-sources.md)
Visual: [Static design mockup](../../design/skills-three-sources.html)

## Owner request

Ral, 2026-09-16: BL and Cowork must expose userData global, workspace .agents Skills and institution distributed Skills as three tabs; chat must reference the fresh complete catalog, updates must reload automatically, and /view_context must let Ral inspect real loading. First submit the design and notify BotAndI; only develop after explicit confirmation.

## Design deliverables

- [x] Read-only source and official format audit; current gaps recorded in feature.
- [x] Complete and inspect the static mockup in both projects.
- [x] Validate design links, source rules, update states and acceptance matrix.
- [x] Commit design on existing dev/next and notify BotAndI with review artifacts.
- [ ] Ral approves the design. This blocks every implementation item below.

## Approved-development sequence (not started)

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

The production Bitterless Todo MCP bridge was unavailable, so no approval Todo was created. Approval remains pending in this task and in the delivered notice.

## Approval record

Pending. Notification delivery does not count as approval. Record Ral's exact confirmation and any design amendments here before implementation.
