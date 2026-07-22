---
id: eyes-on-agents-focus-read-all-021
scope: persistent Focus Read all action without falsifying Codex opens
status: implemented; owner verification pending
depends-on: [eyes-on-agents-sync-persistence-006, eyes-on-agents-compact-card-012]
---

# EyesOnAgents Focus Read All

## Objective

Add one compact `Read all` action to the right side of the fixed Focus header so Ral can clear every
completed unread attention item at once and immediately remove its red Open dot from all board
projections.

## Context

- [EyesOnAgents integration](../../integrations/eyes-on-agents.md)
- [EyesOnAgents layout](../../integrations/eyes-on-agents-layout.md)

## Required behavior

- Render a labelled mini `Read all` action only in the Focus header. Keep it visible but disabled
  when no completed Focus thread is unread so the header does not move and the capability remains
  discoverable.
- On click, use one semantic parameter-free XPC operation and one bounded SQLite UPDATE to clear
  `is_unread` for every non-archived, non-running unread thread. Do not derive the operation from
  mounted cards, scroll position, Domain assignment, Project/title filters, or renderer-supplied IDs.
- Return and apply the latest snapshot before clearing the loading state. Each red Open dot must
  disappear for the same thread in Focus, All, and custom Domains without local optimistic mutation.
- Clear only `is_unread`. Never call the Codex deep link and never modify `last_opened_turn_id` or
  `last_opened_at`, because Read all is not evidence that a thread was opened in Codex.
- Idle rows that were focused only because they were unread leave Focus. Working/waiting rows stay
  in Focus and retain their unread marker so a later idle observation remains visible even if a
  terminal event is missed. A later accepted event may set a cleared thread unread again.
- Use the existing Focus background hierarchy, a transparent borderless text action, Arco mini
  loading/disabled behavior, visible keyboard focus, and localized English/Chinese labels. Add no
  count, icon, card, divider, border, or shadow.
- Avoid a no-op SQLite write and board broadcast when no eligible unread row exists.

## Path

- `docs/integrations/eyes-on-agents.md`
- `docs/integrations/eyes-on-agents-layout.md`
- `docs/plan/README.md`
- `docs/plan/tasks/eyes-on-agents-focus-read-all-021.md`
- `src/shared/eyesOnAgents/eyesOnAgents.type.ts`
- `src/main/eyesOnAgents/eyesOnAgents.service.ts`
- `src/main/xpc/eyesOnAgents.handler.ts`
- `src/preload/sqlite/dao/eyesOnAgents.dao.ts`
- `src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts`
- `src/renderer/eyesOnAgents/src/components/DomainColumn/DomainColumn.vue`
- `src/renderer/eyesOnAgents/src/components/DomainColumn/DomainColumn.less`
- `src/renderer/common/i18n/en.ts`
- `src/renderer/common/i18n/zh.ts`
- `scripts/eyes-on-agents/core.test.mjs`
- `scripts/eyes-on-agents/repository.test.mjs`
- `scripts/eyes-on-agents/ui-source.test.mjs`
- `docs/plan/reviews/eyes-on-agents-focus-read-all-021-1.md`

## Verification

- Contract coverage checks Focus-only placement, permanent disabled discoverability, loading state,
  i18n, and the renderer action applying the returned snapshot.
- Repository/service coverage checks atomic eligible-row clearing, no-op reporting, preservation of
  `last_opened_*`, active marker preservation, and later activity becoming unread again.
- Do not launch Electron. Ral performs the visual and runtime interaction check.

## Result

Implemented one Focus-only `Read all` action backed by a parameter-free Main/SQLite XPC path. The
repository atomically changes only `is_unread` for non-archived, non-running unread rows; it
preserves active and archived attention, Open evidence, activity ordering, and no-op silence. The
returned snapshot updates every board projection before loading ends.

The repository suite passes and the renderer-specific typecheck passes. The new Main and UI source
assertions pass before their existing unrelated suite failures: Core later fails its pre-existing
stale-broadcast assertion, UI source retains two pre-existing regex failures, and strict Core
typecheck retains two pre-existing `codexHookBridge.contract.ts` `rawInput` errors. No Electron
process was launched.

## Review

Accepted after an independent reviewer found and then verified the fix for one P2: `Read all`
initially also updated `updated_at`, which could reorder inactive threads. The final SQL changes only
`is_unread`, and regression coverage preserves `updated_at`:
[eyes-on-agents-focus-read-all-021-1](../reviews/eyes-on-agents-focus-read-all-021-1.md).
