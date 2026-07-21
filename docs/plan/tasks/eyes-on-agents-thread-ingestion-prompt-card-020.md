---
id: eyes-on-agents-thread-ingestion-prompt-card-020
scope: tolerant Codex thread admission, Hook-first title enrichment, latest-question card echo, and consent guide
status: implemented; owner verification pending
depends-on: [eyes-on-agents-tiered-all-polling-019, eyes-on-agents-last-user-prompt-016]
---

# EyesOnAgents Thread Ingestion And Prompt Card

## Objective

Repair the normalized-ingestion defect that can omit a valid Codex thread or leave a Hook-first row
untitled, then surface the already-authorized latest user question as one quiet optional line in the
compact card. Extend the Codex Connections guide so the separate content permission is explicit,
default-off, and reversible.

## Context

- [Existing-thread normalized-ingestion issue](../../issues/eyes-on-agents-thread-normalization-drops-existing-sessions.md)
- [Last user prompt contract](../../features/eyes-on-agents-last-user-prompt.md)
- [Codex observation contract](../../features/eyes-on-agents-codex-observation.md)
- [EyesOnAgents integration](../../integrations/eyes-on-agents.md)
- [EyesOnAgents layout](../../integrations/eyes-on-agents-layout.md)

## Required behavior

- Admit a provider row from its validated UUID independently of optional `name`, `preview`, `cwd`,
  status detail, or other display fields. One malformed optional field cannot drop the row.
- Resolve a display title name-first. Only when the name is unavailable may a preview be used; that
  fallback folds whitespace and is Unicode-safely truncated to the existing 300-character display
  bound. Raw provider objects remain unchanged in the source-snapshot table.
- When a lifecycle event first creates a normalized row, restore a missing title from its existing
  raw snapshot inside the same SQLite transaction. If no usable stored title exists and the already
  connected managed App Server context is available, schedule one thread-ID-deduplicated
  `thread/read({ includeTurns: false })` title-only repair after lifecycle persistence. Never delay a
  Hook acknowledgement, auto-connect, fetch turns, or overwrite runtime/activity evidence from that
  repair.
- A skipped or rejected title repair emits only a bounded reason enum, thread UUID, and time in
  Main diagnostics. Provider response/error/content text is never retained or logged. Full Refresh
  and later tiered polling remain retry paths.
- Render `lastUserPrompt.state === "available"` as one muted single-line question echo between title
  and actions. Render `pending` as the localized content-free status **last user question pending**;
  render `unavailable` as no row so the default-off card height remains unchanged. No icon, badge,
  border, background, or extra status row is added.
- Fold display whitespace only in the renderer; never rewrite the persisted 8 KiB preview. Keep the
  bounded preview in the native tooltip/accessibility label and state clearly when it is truncated.
- Rename the always-visible guide from Hook-only setup to Codex observation setup and add a fourth
  step for the independent **Store latest user question** switch. The step states that it is off by
  default, stores one bounded local preview only, and that turning it off clears saved previews.
  It must also state that replies, reasoning, tools, attachments, and history are not retained and
  that Hook trust does not grant this content permission.

## Card layout

```text
┌────────────────────────────────────────┐
│ Thread title, one or two lines       ◌ │
│ latest user question…                  │  available or pending only
│ now                         [⌂][↗][…] │
└────────────────────────────────────────┘
```

The optional question echo is the only new visual element. It is subordinate to the title, keeps
the existing action-row dimensions, and disappears completely when unavailable.

## Path

- `docs/INDEX.md`
- `docs/issues/eyes-on-agents-thread-normalization-drops-existing-sessions.md`
- `docs/features/eyes-on-agents-last-user-prompt.md`
- `docs/features/eyes-on-agents-codex-observation.md`
- `docs/integrations/eyes-on-agents.md`
- `docs/integrations/eyes-on-agents-layout.md`
- `docs/plan/README.md`
- `docs/plan/tasks/eyes-on-agents-last-user-prompt-016.md`
- `src/shared/eyesOnAgents/eyesOnAgents.contract.ts`
- `src/shared/eyesOnAgents/eyesOnAgents.type.ts`
- `src/main/eyesOnAgents/eyesOnAgents.service.ts`
- `src/preload/sqlite/dao/eyesOnAgents.dao.ts`
- `src/renderer/eyesOnAgents/src/components/ThreadCard/ThreadCard.vue`
- `src/renderer/eyesOnAgents/src/components/ThreadCard/ThreadCard.less`
- `src/renderer/eyesOnAgents/src/components/ConnectionPanel/ConnectionPanel.vue`
- `src/renderer/eyesOnAgents/src/components/ConnectionPanel/ConnectionPanel.less`
- `src/renderer/common/i18n/en.ts`
- `src/renderer/common/i18n/zh.ts`
- `scripts/eyes-on-agents/core.test.mjs`
- `scripts/eyes-on-agents/repository.test.mjs`
- `scripts/eyes-on-agents/ui-source.test.mjs`
- `docs/plan/reviews/eyes-on-agents-thread-ingestion-prompt-card-020-1.md`

## Verification

- Static contract coverage includes valid name plus invalid preview, name-less multiline/long
  preview fallback, invalid optional cwd, stored-snapshot title recovery, title-only targeted repair,
  duplicate lifecycle events, App Server absence/rejection, and bounded content-free diagnostics.
- Static UI guards cover available, pending, unavailable, truncated tooltip/accessibility wording,
  the compact one-line treatment, and the four-step default-off consent guide in both languages.
- An independent verify agent reviews the implementation against this task and the issue/feature
  contracts.
- Per owner instruction, this task does not launch Electron or run tests, builds, formatter, lint,
  or typecheck. Ral owns runtime verification, commit, and push.

## Result

Implemented tolerant UUID-first inventory admission, shared name-first title normalization,
transactional raw-snapshot recovery, non-blocking title-only Hook/App Server enrichment, bounded
drawer diagnostics, the compact latest-question card echo, and the four-step independent-consent
guide. Static contracts include the identified ingestion case, malformed snapshots, title CAS,
Hook ACK isolation, diagnostic/shutdown races, prompt presentation states, and bilingual guide
disclosure.

## Review

Accepted by independent static backend and UI review after both identified concurrency findings and
the documentation inventory finding were corrected:
[eyes-on-agents-thread-ingestion-prompt-card-020-1](../reviews/eyes-on-agents-thread-ingestion-prompt-card-020-1.md).
Runtime verification, commit, and push remain with Ral by request.
